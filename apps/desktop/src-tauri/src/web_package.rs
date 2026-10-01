//! 本地 Web 包存储（D2.1）。
//!
//! V1 的唯一 blob 消费者是 **Web Package 原始 ZIP 字节**（`DESK-054`）。图片、附件等消费者
//! 等到出现真实需求再扩展，因此本模块不预建 image metadata、缩略图管线或引用角色。
//!
//! ## 引用关系用真实外键（`DESK-055`）
//!
//! `web_package_archive_ref` 同时对 `local_web_package(id)` 与 `blob(digest)` 建真实外键。
//! 刻意**不**用 `owner_kind` + `owner_id` 的多态引用：那种形态下数据库只能确认
//! "digest 存在"，无法确认"owner_kind='web-package'、owner_id='xxx'"真的指向一条记录。
//!
//! 第二个 blob 消费者出现时**新增**一张引用表，而不是把已有表泛化。
//!
//! ## 写入顺序
//!
//! ```text
//! blob（文件 → sync → rename → metadata）
//!   ↓ 事务
//! local_web_package 行 + web_package_archive_ref 行
//! ```
//!
//! 后两行在**同一个事务**里，因此不会出现"有引用行却没有包记录"的中间态；而 blob 先写，
//! 于是崩溃最多留下孤儿 blob——那是被允许、被审计回收的状态。
//!
//! ## 可达性（`DESK-055`）
//!
//! - soft delete **不**动引用行，因此 `restore` 能真正恢复可用状态；
//! - purge 删除包记录，`ON DELETE CASCADE` 顺带移除引用；
//! - blob 的实际回收由 GC（D2.2）依据引用表统一判断。

use std::sync::Mutex;

use rusqlite::Connection;
use serde::Deserialize;

use crate::blob::BlobStore;
use crate::store::{timestamp_sort_key, LocalStorePaths, StoreError};

/// 本地库当前 schema 版本。版本 4 增加 Web 包记录与它到 blob 的真实外键引用。
pub const MIGRATION_4: &str = r#"
CREATE TABLE IF NOT EXISTS local_web_package (
    id                  TEXT PRIMARY KEY NOT NULL,
    document            TEXT NOT NULL,
    ref_digest          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    updated_at_sort     INTEGER NOT NULL,
    deleted_at          TEXT,
    archive_byte_length INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS web_package_archive_ref (
    package_id TEXT PRIMARY KEY NOT NULL
        REFERENCES local_web_package(id) ON DELETE CASCADE,
    digest     TEXT NOT NULL REFERENCES blob(digest)
) STRICT;

-- keyset 分页；排序列是排序键而非时间戳文本，理由见 store::timestamp_sort_key。
CREATE INDEX IF NOT EXISTS local_web_package_by_updated
    ON local_web_package (updated_at_sort DESC, id ASC);

-- 审计与 GC 都要按 digest 反查引用方，因此 digest 侧也需要索引。
CREATE INDEX IF NOT EXISTS web_package_archive_ref_by_digest
    ON web_package_archive_ref (digest);
"#;

/// 一次状态变更的方向。合法组合与本地卡一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Transition {
    Delete,
    Restore,
}

/// 调用方声明的索引列。Rust 逐项与 document 中的实际值复核。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPackageIndex {
    pub id: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    /// Web 包 manifest 的内容摘要。必须等于 document 里的 `contentDigest`。
    pub content_digest: String,
}

/// 从 document 中提取的索引字段。
///
/// 自由载荷 `manifest` 与 `ref` 走 `RawValue`：Web 包的 manifest 字段随预设演进，Rust 不该
/// 因为出现新字段就拒收一条 TypeScript 侧合法的记录（同 `DESK-062` 的理由）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebPackageIndexProjection {
    id: String,
    updated_at: String,
    #[serde(default)]
    deleted_at: Option<String>,
    content_digest: String,
    /// 记录里声明的归档长度。native 拿它与**实际字节数**复核（见 `save`）。
    archive_byte_length: i64,
    #[serde(default, rename = "ref")]
    _ref: Option<Box<serde_json::value::RawValue>>,
    #[serde(default, rename = "manifest")]
    _manifest: Option<Box<serde_json::value::RawValue>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPackageCursor {
    #[serde(default)]
    pub updated_at_sort: i64,
    pub updated_at: String,
    pub id: String,
}

#[derive(Debug, Clone, Default)]
pub struct WebPackageQuery {
    pub include_deleted: bool,
    pub limit: i64,
    pub cursor: Option<WebPackageCursor>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebPackagePage {
    pub documents: Vec<String>,
    pub next_cursor: Option<WebPackageCursor>,
}

/// 保存一条本地 Web 包的结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveWebPackageOutcome {
    /// blob 写入的结果。`Repaired` 必须透传给调用方，否则存储损坏在 UI 上完全不可见。
    pub blob: crate::blob::BlobWriteOutcome,
    pub id: String,
}

/// 保存一条 Web 包可能失败在两处，因此需要能区分它们。
///
/// 两者都是"调用方或存储状态有问题"，但 code 必须能区分：`index-mismatch` 是两侧对记录
/// 的理解不一致（渲染层 bug），`blob-digest-mismatch` 是交来的字节与声明的摘要不符
/// （也是渲染层 bug，但成因不同），`blob-corrupt` 是存储损坏。把它们一律压成
/// `store-failure` 会让诊断信息在 IPC 边界就丢光。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SaveWebPackageError {
    Store(StoreError),
    Blob(crate::blob::BlobError),
}

impl SaveWebPackageError {
    pub fn code(&self) -> &'static str {
        match self {
            SaveWebPackageError::Store(error) => error.code(),
            SaveWebPackageError::Blob(error) => error.code(),
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            SaveWebPackageError::Store(error) => error.message(),
            SaveWebPackageError::Blob(error) => error.message(),
        }
    }
}

impl From<StoreError> for SaveWebPackageError {
    fn from(error: StoreError) -> Self {
        SaveWebPackageError::Store(error)
    }
}

impl From<crate::blob::BlobError> for SaveWebPackageError {
    fn from(error: crate::blob::BlobError) -> Self {
        SaveWebPackageError::Blob(error)
    }
}

impl serde::Serialize for SaveWebPackageError {
    /// 投影成与其它本地库错误**同一形状**的 `{code, message}`，使渲染层只需一个错误解析器。
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("SaveWebPackageError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

/// 本地 Web 包存储。与 [`LocalCardStore`](crate::local_card::LocalCardStore) 同构，但多一条
/// 到 blob 的真实外键引用。
pub struct WebPackageStore {
    connection: Mutex<Connection>,
}

impl WebPackageStore {
    /// 在给定的应用数据目录布局上打开本地库。
    pub fn open(paths: &LocalStorePaths) -> Result<Self, StoreError> {
        if let Some(parent) = paths.database().parent() {
            std::fs::create_dir_all(parent).map_err(|_| StoreError::Unavailable)?;
        }
        let connection = Connection::open_with_flags(
            paths.database(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| StoreError::Unavailable)?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, StoreError> {
        crate::store::configure_and_migrate(&connection)?;
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

    /// 保存一条 Web 包记录及其 ZIP 字节。
    ///
    /// 顺序：先落 blob（文件 → metadata），再在一个事务里写包记录与引用行。
    /// `foreign_keys = ON` 因此能真正约束"引用必须指向存在的 blob 与存在的包"。
    /// 保存一条 Web 包记录，并把它指向的原始 ZIP 字节落进内容寻址存储。
    ///
    /// ## 两种摘要不是一回事
    ///
    /// 这里同时出现两个摘要，**它们本来就不相等**，不要试图把它们对齐：
    ///
    /// - `contentDigest`（= `ref.digest`）是 **manifest** 的摘要，见
    ///   `packages/web-package/src/verify.ts` 里 `digest(canonicalize(manifest))`。
    ///   它是领域身份：Web 端的包 id 由它派生，改一个字节就换一个包。
    /// - `archive_digest` 是**归档字节自身**的摘要，只用作 blob 的存储地址与完整性校验。
    ///
    /// ZIP 里除了 manifest 还有文件，所以两者的值必然不同。归档字节是否真的属于这份 manifest，
    /// 由 TypeScript 侧 `unpackWebPackageZip` 负责核对（它会重算 `ref.digest` 再比对）——native
    /// 不做这件事，也不该做：那需要在 Rust 里重建一遍 ZIP 与 manifest 的规范化逻辑
    /// （同 `DESK-062` 的分工理由）。
    pub fn save(
        &self,
        blobs: &BlobStore,
        document: &str,
        index: &WebPackageIndex,
        archive: &[u8],
        now: &str,
    ) -> Result<SaveWebPackageOutcome, SaveWebPackageError> {
        let ValidatedWebPackage {
            index: declared,
            archive_byte_length,
        } = validate_and_extract(document, index)?;
        let updated_at_sort = timestamp_sort_key(&declared.updated_at)?;
        let archive_digest = crate::blob::digest_of(archive);

        // 记录自称的长度必须等于实际字节数。否则"这个包多大"这个问题在详情页和磁盘上会给出
        // 两个答案，而下载、进度与配额估算都建立在这个数字上。
        if archive_byte_length != archive.len() as i64 {
            return Err(SaveWebPackageError::Store(StoreError::IndexMismatch));
        }

        let existing = self.existing_state(&declared.id)?;
        if let Some((true, _)) = existing {
            if index.deleted_at.is_none() {
                return Err(SaveWebPackageError::Store(StoreError::Tombstoned));
            }
        }
        if let Some((_, existing_sort)) = existing {
            if updated_at_sort < existing_sort {
                return Err(SaveWebPackageError::Store(
                    StoreError::NonMonotonicTimestamp,
                ));
            }
        }

        // blob 先写。崩溃在这一步之后、事务之前 → 孤儿 blob（允许）。
        let blob_outcome = blobs.write(&archive_digest, archive, now)?;

        self.with_connection(|connection| {
            let transaction = connection
                .unchecked_transaction()
                .map_err(|_| StoreError::Failure)?;
            transaction
                .execute(
                    "INSERT INTO local_web_package
                        (id, document, ref_digest, updated_at, updated_at_sort, deleted_at, archive_byte_length)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(id) DO UPDATE SET
                        document = excluded.document,
                        ref_digest = excluded.ref_digest,
                        updated_at = excluded.updated_at,
                        updated_at_sort = excluded.updated_at_sort,
                        deleted_at = excluded.deleted_at,
                        archive_byte_length = excluded.archive_byte_length",
                    rusqlite::params![
                        declared.id,
                        document,
                        declared.content_digest,
                        declared.updated_at,
                        updated_at_sort,
                        declared.deleted_at,
                        archive.len() as i64,
                    ],
                )
                .map_err(|_| StoreError::Failure)?;
            // 引用行覆盖写：重新导入同一份 ZIP 是幂等的，而换 digest 时旧引用必须被替换，
            // 否则一个包会同时"可达"两个 blob，让 GC 无法判断该删哪个。
            transaction
                .execute(
                    "INSERT INTO web_package_archive_ref (package_id, digest) VALUES (?1, ?2)
                     ON CONFLICT(package_id) DO UPDATE SET digest = excluded.digest",
                    rusqlite::params![declared.id, archive_digest],
                )
                .map_err(|_| StoreError::Failure)?;
            transaction.commit().map_err(|_| StoreError::Failure)
        })?;

        Ok(SaveWebPackageOutcome {
            blob: blob_outcome,
            id: declared.id,
        })
    }

    /// (是否有 tombstone, 排序键)
    fn existing_state(&self, id: &str) -> Result<Option<(bool, i64)>, StoreError> {
        self.with_connection(|connection| {
            let row = connection
                .query_row(
                    "SELECT deleted_at IS NOT NULL, updated_at_sort FROM local_web_package WHERE id = ?1",
                    rusqlite::params![id],
                    |row| Ok((row.get::<_, i64>(0)? != 0, row.get::<_, i64>(1)?)),
                )
                .ok();
            Ok(row)
        })
    }

    pub fn get(&self, id: &str) -> Result<Option<String>, StoreError> {
        if id.trim().is_empty() {
            return Err(StoreError::InvalidDocument);
        }
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare("SELECT document FROM local_web_package WHERE id = ?1")
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

    /// 该包当前引用的 blob 摘要。
    pub fn archive_digest(&self, id: &str) -> Result<Option<String>, StoreError> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare("SELECT digest FROM web_package_archive_ref WHERE package_id = ?1")
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

    pub fn list(&self, query: &WebPackageQuery) -> Result<WebPackagePage, StoreError> {
        if query.limit < 1 || query.limit > crate::local_card::MAX_LOCAL_CARD_PAGE_SIZE {
            return Err(StoreError::InvalidQuery);
        }
        let fetch = query.limit + 1;
        let cursor = query.cursor.as_ref();

        self.with_connection(|connection| {
            let mut statement = connection
                .prepare_cached(
                    "SELECT id, document, updated_at, updated_at_sort FROM local_web_package
                     WHERE (:include_deleted = 1 OR deleted_at IS NULL)
                       AND (
                            :has_cursor = 0
                            OR (updated_at_sort < :cursor_sort)
                            OR (updated_at_sort = :cursor_sort AND id > :cursor_id)
                       )
                     ORDER BY updated_at_sort DESC, id ASC
                     LIMIT :fetch",
                )
                .map_err(|_| StoreError::Failure)?;

            let rows = statement
                .query_map(
                    rusqlite::named_params! {
                        ":cursor_sort": cursor.map(|value| value.updated_at_sort).unwrap_or(i64::MAX),
                        ":cursor_id": cursor.map(|value| value.id.as_str()).unwrap_or(""),
                        ":fetch": fetch,
                        ":include_deleted": i64::from(query.include_deleted),
                        ":has_cursor": i64::from(cursor.is_some()),
                    },
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .map_err(|_| StoreError::Failure)?;

            let mut documents: Vec<String> = Vec::new();
            let mut last_returned: Option<WebPackageCursor> = None;
            let mut has_more = false;
            for row in rows {
                let (id, document, updated_at, updated_at_sort) = row.map_err(|_| StoreError::Failure)?;
                if documents.len() == query.limit as usize {
                    has_more = true;
                    break;
                }
                last_returned = Some(WebPackageCursor { updated_at_sort, updated_at, id });
                documents.push(document);
            }
            Ok(WebPackagePage {
                documents,
                next_cursor: if has_more { last_returned } else { None },
            })
        })
    }

    /// 幂等软删：整行写入调用方组装好的 tombstone 记录。**不动引用行**，使 restore 能真正恢复。
    pub fn delete(&self, document: &str, index: &WebPackageIndex) -> Result<(), StoreError> {
        let ValidatedWebPackage {
            index: declared, ..
        } = validate_and_extract(document, index)?;
        if index.deleted_at.is_none() {
            return Err(StoreError::TransitionMismatch);
        }
        self.write_transition(document, &declared, Transition::Delete)
    }

    pub fn restore(&self, document: &str, index: &WebPackageIndex) -> Result<(), StoreError> {
        let ValidatedWebPackage {
            index: declared, ..
        } = validate_and_extract(document, index)?;
        if index.deleted_at.is_some() {
            return Err(StoreError::TransitionMismatch);
        }
        self.write_transition(document, &declared, Transition::Restore)
    }

    fn write_transition(
        &self,
        document: &str,
        declared: &WebPackageIndex,
        transition: Transition,
    ) -> Result<(), StoreError> {
        let Some((has_tombstone, existing_sort)) = self.existing_state(&declared.id)? else {
            return Err(StoreError::RecordMissing);
        };
        match transition {
            Transition::Delete if has_tombstone => return Ok(()),
            Transition::Restore if !has_tombstone => return Ok(()),
            _ => {}
        }
        let updated_at_sort = timestamp_sort_key(&declared.updated_at)?;
        if updated_at_sort < existing_sort {
            return Err(StoreError::NonMonotonicTimestamp);
        }
        self.upsert_row(document, declared, updated_at_sort)
    }

    /// 彻底删除一条记录与其引用行。幂等。
    ///
    /// 引用行由 `ON DELETE CASCADE` 移除，因此不会出现"包没了但 blob 仍被标记为可达"。
    pub fn purge(&self, id: &str) -> Result<(), StoreError> {
        self.with_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM local_web_package WHERE id = ?1",
                    rusqlite::params![id],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    fn upsert_row(
        &self,
        document: &str,
        declared: &WebPackageIndex,
        updated_at_sort: i64,
    ) -> Result<(), StoreError> {
        let byte_length: i64 = self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT archive_byte_length FROM local_web_package WHERE id = ?1",
                    rusqlite::params![declared.id],
                    |row| row.get(0),
                )
                .map_err(|_| StoreError::RecordMissing)
        })?;
        self.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_web_package SET
                        document = ?2, ref_digest = ?3, updated_at = ?4,
                        updated_at_sort = ?5, deleted_at = ?6, archive_byte_length = ?7
                     WHERE id = ?1",
                    rusqlite::params![
                        declared.id,
                        document,
                        declared.content_digest,
                        declared.updated_at,
                        updated_at_sort,
                        declared.deleted_at,
                        byte_length,
                    ],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    /// 在同一个连接上跑一段原始 SQL。**仅测试使用**：外键约束无法从公开 API 触达，
    /// 而"外键真的会拒绝"正是选用真实外键而非多态引用的理由，必须能直接验证。
    #[cfg(test)]
    pub fn probe(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<usize, StoreError> {
        self.with_connection(|connection| {
            connection
                .execute(sql, params)
                .map_err(|_| StoreError::Failure)
        })
    }

    /// schema 版本断言，供集成测试确认迁移阶梯确实落到了 web 包表。
    #[cfg(test)]
    pub fn schema_version(&self) -> Result<i64, StoreError> {
        self.with_connection(|connection| {
            connection
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|_| StoreError::Failure)
        })
    }
}

/// document 中与索引列对应、且 native 需要复核的字段。
struct ValidatedWebPackage {
    index: WebPackageIndex,
    /// 记录自称的归档长度。只在 `save` 里与实际字节数比对。
    archive_byte_length: i64,
}

fn validate_and_extract(
    document: &str,
    index: &WebPackageIndex,
) -> Result<ValidatedWebPackage, StoreError> {
    let projection: WebPackageIndexProjection =
        serde_json::from_str(document).map_err(|_| StoreError::InvalidDocument)?;

    let extracted = WebPackageIndex {
        id: projection.id,
        updated_at: projection.updated_at,
        deleted_at: projection.deleted_at,
        content_digest: projection.content_digest,
    };
    if extracted != *index {
        return Err(StoreError::IndexMismatch);
    }
    Ok(ValidatedWebPackage {
        index: extracted,
        archive_byte_length: projection.archive_byte_length,
    })
}

#[cfg(test)]
mod tests {
    use super::{SaveWebPackageOutcome, WebPackageIndex, WebPackageQuery, WebPackageStore};
    use crate::blob::{digest_of, BlobPaths, BlobStore, BlobWriteOutcome};
    use crate::store::StoreError;

    const NOW: &str = "2026-09-30T12:00:00Z";
    const DIGEST: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    /// 绝大多数测试共用的归档字节。长度与 package_of_len 声明的一致。
    const TEST_ARCHIVE: &[u8] = b"PK\x03\x04zip";
    /// Web 包记录与它的 blob 存储。
    ///
    /// 用**真实临时文件**而不是两个 `open_in_memory()`：`open_in_memory` 给每个连接一份私有
    /// 数据库，于是 blob 的 metadata 对包记录不可见，外键会误报失败。生产路径里四个存储共享
    /// 同一个文件，fixture 必须与之一致，否则测的是一个不存在的拓扑。
    fn fixture() -> (WebPackageStore, BlobStore, std::path::PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-webpkg-test-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let paths = crate::store::LocalStorePaths::under(&root);

        let packages = WebPackageStore::open(&paths).expect("packages");

        let blob_connection =
            rusqlite::Connection::open(paths.database()).expect("blob connection");
        crate::store::configure_and_migrate(&blob_connection).expect("migrate");
        let blobs = crate::blob::open(BlobPaths::under(&root), blob_connection).expect("blobs");

        (packages, blobs, root)
    }

    /// 造一条 document。`archive_len` 是它**自称**的归档长度，用来测试它与实际字节数的复核。
    fn package_document(id: &str, updated_at: &str, tombstone: &str, archive_len: i64) -> String {
        format!(
            r#"{{"id":"{id}","schemaVersion":1,"storageLocation":"local","entityKind":"web-package","title":"包","summary":"s","ref":{{"digest":"{DIGEST}","id":"local.x","version":"1.0.0"}},"manifest":{{"format":"mahoshojo-web-package","formatVersion":1,"id":"local.x","version":"1.0.0","name":"包","entry":"index.html","capabilities":[],"files":[{{"path":"index.html","mediaType":"text/html","digest":"{DIGEST}","size":2}}]}},"contentDigest":"{DIGEST}","archiveByteLength":{archive_len},"provenance":{{"kind":"unsigned","execution":"imported"}},"createdAt":"{updated_at}","updatedAt":"{updated_at}"{tombstone}}}"#
        )
    }

    /// 一条与 `archive` 自洽的记录。
    ///
    /// 刻意让归档**先于**记录出现：分开传两个长度时，测试夹具迟早会写下对不上的数字，而
    /// `save` 会（正确地）拒绝它——那时失败的其实是夹具，不是被测行为。
    fn package_for(
        id: &str,
        updated_at: &str,
        deleted_at: Option<&str>,
        archive: &[u8],
    ) -> (String, WebPackageIndex) {
        let tombstone = match deleted_at {
            Some(value) => format!(r#","deletedAt":"{value}""#),
            None => String::new(),
        };
        let document = package_document(id, updated_at, &tombstone, archive.len() as i64);
        let index = WebPackageIndex {
            id: id.to_string(),
            updated_at: updated_at.to_string(),
            deleted_at: deleted_at.map(str::to_string),
            content_digest: DIGEST.to_string(),
        };
        (document, index)
    }

    /// 不涉及字节差异的记录（列表、分页、纯状态转移测试用）。
    ///
    /// `archiveByteLength` 说的是 `TEST_ARCHIVE` 的长度——把这两者绑在一起，就不可能再写出
    /// 一条"自称 4 字节、实际 10 字节"的夹具，然后困惑于 `save` 为什么拒绝它。
    fn package_of_len(
        id: &str,
        updated_at: &str,
        deleted_at: Option<&str>,
    ) -> (String, WebPackageIndex) {
        package_for(id, updated_at, deleted_at, TEST_ARCHIVE)
    }

    fn package(id: &str, updated_at: &str) -> (String, WebPackageIndex) {
        package_of_len(id, updated_at, None)
    }

    fn default_query(limit: i64) -> WebPackageQuery {
        WebPackageQuery {
            include_deleted: false,
            limit,
            cursor: None,
        }
    }

    #[test]
    fn saving_stores_the_record_its_bytes_and_a_real_foreign_key() {
        let (packages, blobs, _root) = fixture();
        let archive = TEST_ARCHIVE.to_vec();
        let (document, index) = package_for("wp_1", NOW, None, &archive);

        // 迁移阶梯确实落到了含 blob 与 web 包表的版本。
        assert_eq!(
            packages.schema_version().expect("version"),
            crate::store::SCHEMA_VERSION,
        );

        let outcome = packages
            .save(&blobs, &document, &index, &archive, NOW)
            .expect("save must succeed");

        assert_eq!(
            outcome,
            SaveWebPackageOutcome {
                blob: BlobWriteOutcome::Stored,
                id: "wp_1".to_string()
            }
        );
        assert_eq!(
            packages.get("wp_1").expect("get must succeed"),
            Some(document)
        );

        // 引用行指向真实存在的 blob 与包，不是字符串型多态引用。
        let digest = packages
            .archive_digest("wp_1")
            .expect("digest must be readable")
            .expect("must exist");
        assert_eq!(digest, digest_of(&archive));
        assert_eq!(blobs.read(&digest).expect("read must succeed"), archive);
    }

    #[test]
    fn re_importing_identical_bytes_is_idempotent_not_a_second_row() {
        let (packages, blobs, _root) = fixture();
        let archive = b"PK\x03\x04same".to_vec();
        let (document, index) = package_for("wp_same", NOW, None, &archive);

        packages
            .save(&blobs, &document, &index, &archive, NOW)
            .expect("first");
        let second = packages
            .save(&blobs, &document, &index, &archive, "2026-10-01T00:00:00Z")
            .expect("second");

        assert_eq!(second.blob, BlobWriteOutcome::AlreadyPresent);
        assert_eq!(
            packages
                .list(&default_query(10))
                .expect("list")
                .documents
                .len(),
            1
        );
    }

    #[test]
    fn the_foreign_key_actually_rejects_a_reference_to_a_missing_blob() {
        // 这是"用真实外键而不是多态引用"的全部理由：数据库自己能拦住这种引用。
        let (packages, blobs, _root) = fixture();
        let (document, index) = package("wp_fk", NOW);
        packages
            .save(&blobs, &document, &index, TEST_ARCHIVE, NOW)
            .expect("save");

        // 直接把引用指向一个不存在的 blob，必须被外键拒绝。
        let missing = format!("sha256:{}", "f".repeat(64));
        let outcome = packages.probe(
            "INSERT INTO web_package_archive_ref (package_id, digest) VALUES (?1, ?2)
             ON CONFLICT(package_id) DO UPDATE SET digest = excluded.digest",
            &[&"wp_fk", &missing],
        );
        assert!(outcome.is_err(), "指向不存在 blob 的引用 MUST 被外键拒绝");
    }

    #[test]
    fn soft_delete_keeps_the_reference_so_restore_really_restores() {
        // DESK-055：soft delete MUST NOT 改变 blob 可达性。
        let (packages, blobs, _root) = fixture();
        let archive = b"PK\x03\x04soft".to_vec();
        let (document, index) = package_for("wp_soft", NOW, None, &archive);
        packages
            .save(&blobs, &document, &index, &archive, NOW)
            .expect("save");

        let (tombstone_doc, tombstone_index) = package_of_len(
            "wp_soft",
            "2026-09-30T13:00:00Z",
            Some("2026-09-30T13:00:00Z"),
        );
        packages
            .delete(&tombstone_doc, &tombstone_index)
            .expect("delete");

        assert!(
            packages
                .archive_digest("wp_soft")
                .expect("digest")
                .is_some(),
            "软删 MUST NOT 移除引用，否则 GC 会回收一个仍被记录指向的 blob"
        );
        assert!(packages
            .list(&default_query(10))
            .expect("list")
            .documents
            .is_empty());
        let including = WebPackageQuery {
            include_deleted: true,
            ..default_query(10)
        };
        assert_eq!(packages.list(&including).expect("list").documents.len(), 1);

        let (restored_doc, restored_index) = package("wp_soft", "2026-09-30T14:00:00Z");
        packages
            .restore(&restored_doc, &restored_index)
            .expect("restore");
        assert_eq!(
            packages
                .list(&default_query(10))
                .expect("list")
                .documents
                .len(),
            1
        );
        assert_eq!(
            blobs.read(&digest_of(&archive)).expect("read"),
            archive,
            "恢复后字节必须仍在"
        );
    }

    #[test]
    fn purge_removes_the_record_and_its_reference_together() {
        let (packages, blobs, _root) = fixture();
        let (document, index) = package("wp_purge", NOW);
        packages
            .save(&blobs, &document, &index, TEST_ARCHIVE, NOW)
            .expect("save");

        packages.purge("wp_purge").expect("purge");
        assert_eq!(packages.get("wp_purge").expect("get must succeed"), None);
        assert!(
            packages
                .archive_digest("wp_purge")
                .expect("digest")
                .is_none(),
            "CASCADE 必须顺带移除引用行，否则 blob 会被永久标记为可达"
        );
        packages
            .purge("wp_purge")
            .expect("repeat purge must be idempotent");
    }

    #[test]
    fn get_returns_a_tombstone_that_really_carries_deleted_at() {
        let (packages, blobs, _root) = fixture();
        let (document, index) = package("wp_tomb", NOW);
        packages
            .save(&blobs, &document, &index, TEST_ARCHIVE, NOW)
            .expect("save");

        let (tombstone_doc, tombstone_index) = package_of_len(
            "wp_tomb",
            "2026-09-30T13:00:00Z",
            Some("2026-09-30T13:00:00Z"),
        );
        packages
            .delete(&tombstone_doc, &tombstone_index)
            .expect("delete");

        let read_back = packages
            .get("wp_tomb")
            .expect("get")
            .expect("row must exist");
        let parsed: serde_json::Value = serde_json::from_str(&read_back).expect("json");
        assert_eq!(
            parsed.get("deletedAt").and_then(|value| value.as_str()),
            Some("2026-09-30T13:00:00Z"),
            "get 返回的 document 必须带 deletedAt（CardRepository 同款契约）"
        );
    }

    #[test]
    fn refuses_a_normal_save_that_would_clear_a_tombstone() {
        let (packages, blobs, _root) = fixture();
        let (document, index) = package("wp_revive", NOW);
        packages
            .save(&blobs, &document, &index, TEST_ARCHIVE, NOW)
            .expect("save");
        let (tombstone_doc, tombstone_index) = package_of_len(
            "wp_revive",
            "2026-09-30T13:00:00Z",
            Some("2026-09-30T13:00:00Z"),
        );
        packages
            .delete(&tombstone_doc, &tombstone_index)
            .expect("delete");

        let (revived_doc, revived_index) = package("wp_revive", "2026-09-30T15:00:00Z");
        assert_eq!(
            packages.save(
                &blobs,
                &revived_doc,
                &revived_index,
                TEST_ARCHIVE,
                "2026-09-30T15:00:00Z"
            ),
            Err(super::SaveWebPackageError::Store(StoreError::Tombstoned)),
        );
    }

    #[test]
    fn refuses_an_index_that_disagrees_with_the_document() {
        let (packages, blobs, _root) = fixture();
        let (document, mut index) = package("wp_mismatch", NOW);
        index.content_digest = format!("sha256:{}", "b".repeat(64));
        assert_eq!(
            packages.save(&blobs, &document, &index, TEST_ARCHIVE, NOW),
            Err(super::SaveWebPackageError::Store(StoreError::IndexMismatch)),
        );
        assert_eq!(packages.get("wp_mismatch").expect("get must succeed"), None);
    }

    #[test]
    fn rejects_a_transition_against_the_wrong_direction_or_a_missing_record() {
        let (packages, blobs, _root) = fixture();
        let (document, index) = package("wp_dir", NOW);
        packages
            .save(&blobs, &document, &index, TEST_ARCHIVE, NOW)
            .expect("save");

        // 对不带 deletedAt 的记录执行 delete
        assert_eq!(
            packages.delete(&document, &index),
            Err(StoreError::TransitionMismatch),
        );
        let (tombstone_doc, tombstone_index) = package_of_len(
            "wp_dir",
            "2026-09-30T13:00:00Z",
            Some("2026-09-30T13:00:00Z"),
        );
        packages
            .delete(&tombstone_doc, &tombstone_index)
            .expect("delete");
        // 对带 deletedAt 的记录执行 restore
        assert_eq!(
            packages.restore(&tombstone_doc, &tombstone_index),
            Err(StoreError::TransitionMismatch),
        );
        // 转移目标不存在
        let (ghost_doc, ghost_index) =
            package_of_len("wp_ghost", NOW, Some("2026-09-30T13:00:00Z"));
        assert_eq!(
            packages.delete(&ghost_doc, &ghost_index),
            Err(StoreError::RecordMissing),
        );
    }

    #[test]
    fn refuses_a_backwards_timestamp() {
        let (packages, blobs, _root) = fixture();
        let (document, index) = package("wp_time", "2026-09-30T05:00:00Z");
        packages
            .save(&blobs, &document, &index, TEST_ARCHIVE, NOW)
            .expect("save");

        let (earlier_doc, earlier_index) = package("wp_time", "2026-09-30T01:00:00Z");
        assert_eq!(
            packages.save(&blobs, &earlier_doc, &earlier_index, TEST_ARCHIVE, NOW),
            Err(super::SaveWebPackageError::Store(
                StoreError::NonMonotonicTimestamp
            )),
        );
    }

    #[test]
    fn the_archive_address_is_derived_from_the_bytes_not_declared_by_the_caller() {
        // 与 blob 层不同：Web 包保存路径**自己**算摘要，调用方无处声明地址。因此不存在
        // "声明与内容不符"这种输入——同一份字节永远落在同一个地址，改一个字节则换地址。
        let (packages, blobs, _root) = fixture();
        let archive = b"PK\x03\x04first".to_vec();
        let (document, index) = package_for("wp_addr", NOW, None, &archive);

        packages
            .save(&blobs, &document, &index, &archive, NOW)
            .expect("save");
        let first = packages
            .archive_digest("wp_addr")
            .expect("digest")
            .expect("must exist");
        assert_eq!(first, crate::blob::digest_of(&archive));

        // 不同字节 → 不同地址；同一份字节 → 仍是同一地址。
        let other_archive = b"PK\x03\x04second".to_vec();
        let (other_doc, other_index) =
            package_for("wp_addr", "2026-09-30T13:00:00Z", None, &other_archive);
        packages
            .save(
                &blobs,
                &other_doc,
                &other_index,
                &other_archive,
                "2026-09-30T13:00:00Z",
            )
            .expect("save with different bytes");
        let second = packages
            .archive_digest("wp_addr")
            .expect("digest")
            .expect("must exist");
        assert_ne!(first, second);
        assert_eq!(
            blobs.read(&second).expect("read"),
            b"PK\x03\x04second".to_vec()
        );
    }

    #[test]
    fn keyset_pagination_covers_every_row_once_across_page_sizes() {
        let (packages, blobs, _root) = fixture();
        for n in 0..25i64 {
            let updated_at = format!("2026-09-30T{:02}:{:02}:00Z", n / 60, n % 60);
            // 每行一份不同字节，因此地址也不同——顺带覆盖"多条记录指向不同 blob"。
            let archive = format!("PK{n}").into_bytes();
            let (document, index) = package_for(&format!("wp_{n:03}"), &updated_at, None, &archive);
            packages
                .save(&blobs, &document, &index, &archive, &updated_at)
                .expect("save");
        }

        for page_size in [1_i64, 4, 100] {
            let mut seen: Vec<String> = Vec::new();
            let mut cursor = None;
            loop {
                let page = packages
                    .list(&WebPackageQuery {
                        cursor: cursor.clone(),
                        ..default_query(page_size)
                    })
                    .expect("list must succeed");
                for document in &page.documents {
                    let value: serde_json::Value = serde_json::from_str(document).expect("json");
                    seen.push(
                        value
                            .get("id")
                            .and_then(|id| id.as_str())
                            .unwrap_or("?")
                            .to_string(),
                    );
                }
                match page.next_cursor {
                    Some(next) => cursor = Some(next),
                    None => break,
                }
            }
            seen.sort();
            assert_eq!(seen.len(), 25, "page_size={page_size} 必须覆盖全部行");
        }
    }

    #[test]
    fn rejects_a_page_size_outside_the_contract_range() {
        let (packages, _blobs, _root) = fixture();
        for limit in [0_i64, -1, 101] {
            assert_eq!(
                packages.list(&default_query(limit)),
                Err(StoreError::InvalidQuery),
                "limit={limit} 必须被拒绝"
            );
        }
    }

    #[test]
    fn the_error_projection_stays_one_shape_across_store_and_blob_failures() {
        let (packages, blobs, _root) = fixture();
        let (document, index) = package("wp_err", NOW);

        // 一个 blob 侧失败：archive 超过 blob 上限。
        //
        // 记录必须**如实声明**这个长度，否则 `save` 会先在"声明长度 ≠ 实际字节数"上失败，
        // 那样测到的就不是 blob 的错误投影了。
        let oversized = vec![0_u8; crate::blob::MAX_BLOB_BYTES + 1];
        let (big_document, big_index) = package_for("wp_err", NOW, None, &oversized);
        let blob_failure = packages
            .save(&blobs, &big_document, &big_index, &oversized, NOW)
            .expect_err("must fail");
        // 一个 store 侧失败：索引列与 document 不一致。
        let mut bad = index.clone();
        bad.content_digest = format!("sha256:{}", "c".repeat(64));
        let store_failure = packages
            .save(&blobs, &document, &bad, TEST_ARCHIVE, NOW)
            .expect_err("must fail");
        // 一个 store 侧失败：记录自称的长度与实际字节数不符。
        let length_failure = packages
            .save(
                &blobs,
                &document,
                &index,
                b"PK\x03\x04different length",
                NOW,
            )
            .expect_err("must fail");

        assert!(matches!(blob_failure, super::SaveWebPackageError::Blob(_)));
        assert!(matches!(
            store_failure,
            super::SaveWebPackageError::Store(_)
        ));
        assert_eq!(
            length_failure,
            super::SaveWebPackageError::Store(StoreError::IndexMismatch)
        );

        for error in [blob_failure, store_failure] {
            let value = serde_json::to_value(&error).expect("must serialize");
            assert_eq!(
                value.as_object().expect("object").len(),
                2,
                "两种来源的错误 MUST 投影成同一形状，渲染层只需一个解析器"
            );
            assert!(!value["message"].as_str().expect("message").is_empty());
        }
    }
}
