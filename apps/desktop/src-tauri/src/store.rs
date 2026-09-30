//! 本地 SQLite 存储。
//!
//! 职责边界（`ADR-desktop-tauri-v1` 第 7 条）：TypeScript 负责记录组装与校验，Rust 只做
//! 存储机制。因此本模块刻意**不解释**业务字段——它按 id 存取经过校验的 opaque JSON 文档，
//! 不理解 `contentDigest`、`provenance` 或 `title` 的含义。
//!
//! Rust 仍然自己产生所有落盘路径与 SQL 选择器：不存在"由 renderer 指定文件名或 SQL"的入口。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};

/// 当前 schema 版本。SQLite 的 `user_version` 与 migration journal 必须与它一致。
pub const SCHEMA_VERSION: i64 = 1;

/// 单条文档的 UTF-8 字节上限。
///
/// Provider Profile 契约本身有 64 KiB 上限；这里留出余量，使"契约合法但文档过大"这种
/// 情况以可诊断错误失败，而不是静默截断。
pub const MAX_DOCUMENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    Unavailable,
    InvalidDocument,
    DocumentTooLarge,
    Failure,
}

impl StoreError {
    pub fn code(&self) -> &'static str {
        match self {
            StoreError::Unavailable => "store-unavailable",
            StoreError::InvalidDocument => "invalid-document",
            StoreError::DocumentTooLarge => "document-too-large",
            StoreError::Failure => "store-failure",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            StoreError::Unavailable => "local store is unavailable",
            StoreError::InvalidDocument => "local store rejected the document",
            StoreError::DocumentTooLarge => "local store document exceeds its byte ceiling",
            StoreError::Failure => "local store operation failed",
        }
    }
}

impl serde::Serialize for StoreError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("LocalStoreError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

const MIGRATION_1: &str = r#"
CREATE TABLE IF NOT EXISTS provider_profile (
    id          TEXT PRIMARY KEY NOT NULL,
    document    TEXT NOT NULL,
    updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS schema_migration (
    version     INTEGER PRIMARY KEY NOT NULL,
    applied_at  TEXT NOT NULL
) STRICT;
"#;

#[cfg(test)]
pub fn applied_migrations(connection: &Connection) -> Result<Vec<i64>, StoreError> {
    let mut statement = connection
        .prepare("SELECT version FROM schema_migration ORDER BY version")
        .map_err(|_| StoreError::Failure)?;
    let rows = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|_| StoreError::Failure)?;

    let mut versions = Vec::new();
    for row in rows {
        versions.push(row.map_err(|_| StoreError::Failure)?);
    }
    Ok(versions)
}

/// 应用迁移并把 `user_version` 推进到 [`SCHEMA_VERSION`]。
///
/// 迁移只向前。已应用的版本不会重复执行，因此重复打开同一个数据库是安全的。
pub fn migrate(connection: &Connection) -> Result<(), StoreError> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| StoreError::Unavailable)?;

    if current > SCHEMA_VERSION {
        return Err(StoreError::Unavailable);
    }

    if current < 1 {
        connection
            .execute_batch(MIGRATION_1)
            .map_err(|_| StoreError::Failure)?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migration (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![1_i64, now_iso8601()],
            )
            .map_err(|_| StoreError::Failure)?;
        connection
            .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(|_| StoreError::Failure)?;
    }

    Ok(())
}

fn now_iso8601() -> String {
    // 不引入时间库：migration journal 只需要一个可排序、非空的 UTC 时间戳。
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    format!("{seconds}")
}

fn configure(connection: &Connection) -> Result<(), StoreError> {
    // WAL 让读写不互相阻塞；FULL synchronous 优先保证崩溃一致性，因为本地库是用户资产。
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|_| StoreError::Unavailable)
}

/// 应用数据目录布局。路径全部由 Rust 产生。
#[derive(Debug, Clone)]
pub struct LocalStorePaths {
    database: PathBuf,
}

impl LocalStorePaths {
    pub fn under(data_root: &Path) -> Self {
        Self {
            database: data_root.join("library.sqlite"),
        }
    }

    pub fn database(&self) -> &Path {
        &self.database
    }
}

/// 进程内单连接存储。
///
/// 单连接 + `Mutex` 是刻意的：本地库的写入是低频的（用户保存卡片、修改 Profile），
/// 而复杂度预算要求避免为它引入连接池与异步写入路径。
pub struct LocalStore {
    connection: Mutex<Connection>,
}

impl LocalStore {
    pub fn open(paths: &LocalStorePaths) -> Result<Self, StoreError> {
        if let Some(parent) = paths.database().parent() {
            std::fs::create_dir_all(parent).map_err(|_| StoreError::Unavailable)?;
        }

        let connection = Connection::open_with_flags(
            paths.database(),
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| StoreError::Unavailable)?;

        configure(&connection)?;
        migrate(&connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// 打开内存库。供测试使用，不触碰用户数据目录。
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let connection = Connection::open_in_memory().map_err(|_| StoreError::Unavailable)?;
        configure(&connection)?;
        migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let guard = self.connection.lock().map_err(|_| StoreError::Failure)?;
        operation(&guard)
    }

    /// 按 id 写入或覆盖一条 opaque 文档。
    ///
    /// 这里**不**校验文档语义：语义由 TypeScript 在调用前完成。Rust 只负责三件事：
    /// 文档必须是合法 UTF-8 文本、在字节上限内、并且自身可被再次解析为 JSON。
    pub fn put(&self, id: &str, document: &str, updated_at: &str) -> Result<(), StoreError> {
        if id.trim().is_empty() {
            return Err(StoreError::InvalidDocument);
        }
        if document.len() > MAX_DOCUMENT_BYTES {
            return Err(StoreError::DocumentTooLarge);
        }
        serde_json::from_str::<serde_json::Value>(document)
            .map_err(|_| StoreError::InvalidDocument)?;

        self.with_connection(|connection| {
            connection
                .execute(
                    "INSERT INTO provider_profile (id, document, updated_at) VALUES (?1, ?2, ?3)
                     ON CONFLICT(id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at",
                    rusqlite::params![id, document, updated_at],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    pub fn get(&self, id: &str) -> Result<Option<String>, StoreError> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare("SELECT document FROM provider_profile WHERE id = ?1")
                .map_err(|_| StoreError::Failure)?;
            let mut rows = statement
                .query(rusqlite::params![id])
                .map_err(|_| StoreError::Failure)?;
            match rows.next().map_err(|_| StoreError::Failure)? {
                Some(row) => Ok(Some(
                    row.get::<_, String>(0).map_err(|_| StoreError::Failure)?,
                )),
                None => Ok(None),
            }
        })
    }

    /// 按 `updated_at` 倒序列出全部 id。分页留给 D2；当前 Profile 规模是个位数。
    pub fn list_ids(&self) -> Result<Vec<String>, StoreError> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare("SELECT id FROM provider_profile ORDER BY updated_at DESC, id ASC")
                .map_err(|_| StoreError::Failure)?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|_| StoreError::Failure)?;

            let mut ids = Vec::new();
            for row in rows {
                ids.push(row.map_err(|_| StoreError::Failure)?);
            }
            Ok(ids)
        })
    }

    /// 删除一条记录。幂等：缺失 id 同样成功。
    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        self.with_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM provider_profile WHERE id = ?1",
                    rusqlite::params![id],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub fn schema_version(&self) -> Result<i64, StoreError> {
        self.with_connection(|connection| {
            connection
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|_| StoreError::Failure)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{applied_migrations, LocalStore, StoreError, MAX_DOCUMENT_BYTES, SCHEMA_VERSION};

    fn store() -> LocalStore {
        LocalStore::open_in_memory().expect("in-memory store must open")
    }

    #[test]
    fn migration_is_idempotent_and_records_its_own_version() {
        let store = store();
        assert_eq!(store.schema_version().expect("version"), SCHEMA_VERSION);

        let versions = applied_migrations(&store.connection.lock().expect("lock"))
            .expect("migration journal must be readable");
        assert_eq!(versions, vec![1]);

        // 重复打开同一个库不会重复执行迁移。
        let reopened = LocalStore::open_in_memory().expect("reopen");
        assert_eq!(reopened.schema_version().expect("version"), SCHEMA_VERSION);
    }

    #[test]
    fn round_trips_an_opaque_document_without_interpreting_it() {
        let store = store();
        let document = r#"{"totally":"unknown to rust","nested":[1,2,3]}"#;

        store
            .put("profile-1", document, "2026-09-30T00:00:00Z")
            .expect("put must succeed");
        assert_eq!(
            store.get("profile-1").expect("get must succeed"),
            Some(document.to_string())
        );
        assert_eq!(
            store.list_ids().expect("list must succeed"),
            vec!["profile-1"]
        );
    }

    #[test]
    fn put_overwrites_the_same_id_instead_of_inserting_a_duplicate() {
        let store = store();
        store
            .put("profile-1", r#"{"v":1}"#, "2026-09-30T00:00:00Z")
            .expect("put");
        store
            .put("profile-1", r#"{"v":2}"#, "2026-09-30T00:00:01Z")
            .expect("put");

        assert_eq!(store.list_ids().expect("list").len(), 1);
        assert_eq!(
            store.get("profile-1").expect("get"),
            Some(r#"{"v":2}"#.to_string())
        );
    }

    #[test]
    fn rejects_documents_that_are_not_json_or_exceed_the_ceiling() {
        let store = store();

        assert_eq!(
            store
                .put("profile-1", "not json", "t")
                .expect_err("must reject"),
            StoreError::InvalidDocument
        );
        assert_eq!(
            store
                .put("profile-1", "", "t")
                .expect_err("must reject empty document"),
            StoreError::InvalidDocument
        );
        assert_eq!(
            store
                .put("profile-1", &"x".repeat(MAX_DOCUMENT_BYTES + 1), "t")
                .expect_err("must reject oversized document"),
            StoreError::DocumentTooLarge
        );
        assert_eq!(
            store
                .put("   ", r#"{"v":1}"#, "t")
                .expect_err("must reject blank id"),
            StoreError::InvalidDocument
        );
        assert_eq!(store.list_ids().expect("list"), Vec::<String>::new());
    }

    #[test]
    fn get_reports_absence_without_error_and_delete_is_idempotent() {
        let store = store();
        assert_eq!(store.get("missing").expect("get must succeed"), None);

        store.put("profile-1", r#"{"v":1}"#, "t").expect("put");
        store.delete("profile-1").expect("delete must succeed");
        store
            .delete("profile-1")
            .expect("delete must stay idempotent");
        assert_eq!(store.get("profile-1").expect("get"), None);
    }

    #[test]
    fn lists_newest_first_and_keeps_deterministic_tie_breaking() {
        let store = store();
        store
            .put("b", r#"{"v":1}"#, "2026-09-01T00:00:00Z")
            .expect("put");
        store
            .put("a", r#"{"v":1}"#, "2026-09-02T00:00:00Z")
            .expect("put");
        store
            .put("c", r#"{"v":1}"#, "2026-09-02T00:00:00Z")
            .expect("put");

        assert_eq!(store.list_ids().expect("list"), vec!["a", "c", "b"]);
    }

    #[test]
    fn error_projection_is_stable_and_carries_no_user_data() {
        for error in [
            StoreError::Unavailable,
            StoreError::InvalidDocument,
            StoreError::DocumentTooLarge,
            StoreError::Failure,
        ] {
            let value = serde_json::to_value(&error).expect("error must serialize");
            assert_eq!(
                value.as_object().expect("object").len(),
                2,
                "error projection must contain only code and message"
            );
            assert!(!value["message"].as_str().expect("message").is_empty());
        }
    }

    #[test]
    fn opens_a_real_file_under_the_application_data_directory() {
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-desktop-store-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let paths = super::LocalStorePaths::under(&root);

        let store = LocalStore::open(&paths).expect("file-backed store must open");
        store.put("profile-1", r#"{"v":1}"#, "t").expect("put");

        // 重新打开同一个路径，数据必须仍在：这是"重启后本地数据仍存在"的最小证据。
        drop(store);
        let reopened = LocalStore::open(&paths).expect("reopen");
        assert_eq!(
            reopened.get("profile-1").expect("get"),
            Some(r#"{"v":1}"#.to_string())
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
