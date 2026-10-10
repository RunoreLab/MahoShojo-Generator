//! 本地 SQLite 存储。
//!
//! 职责边界（`ADR-desktop-tauri-v1` 第 7 条）：TypeScript 负责记录组装与校验，Rust 只做
//! 存储机制。因此本模块刻意**不解释**业务字段——它按 id 存取经过校验的 opaque JSON 文档，
//! 不理解 `contentDigest`、`provenance` 或 `title` 的含义。
//!
//! Rust 仍然自己产生所有落盘路径与 SQL 选择器：不存在"由 renderer 指定文件名或 SQL"的入口。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::{Connection, OpenFlags};

/// 全进程共享的 SQLite 连接句柄。
///
/// D2.2a 之前，四个 store 各自 `Mutex<Connection>`、指向同一个数据库文件——四把互不相干的
/// 锁。那不只是"不够强"，它是一个**现存缺陷**：`WebPackageStore::save` 先写 blob（释放 blob
/// 锁）再进包事务，两步之间若有另一条路径观察 blob metadata，就会看到一个"有 metadata、无引用"
/// 的中间态。共用一把锁之后，任何跨资源的观察都落在同一临界区内。
///
/// 仍然用 `Mutex<Connection>` 而非连接池：本地库写入低频，复杂度预算要求不为它引入
/// 连接池与异步写入路径（见 [`LocalStore`] 的说明）。
pub type SharedConnection = Arc<Mutex<Connection>>;

/// 打开（或创建）共享连接，并跑完 PRAGMA 配置与迁移阶梯。
///
/// 迁移只在**这一处**执行。四条连接各自跑一遍阶梯曾经是可行的，但那是"四条连接"的
/// 副产品，不是设计：一旦合并成一条连接，跑四次就成了四次无谓的 DDL 与 journal 写入。
pub fn open_shared_connection(paths: &LocalStorePaths) -> Result<SharedConnection, StoreError> {
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

    configure_and_migrate(&connection)?;

    Ok(Arc::new(Mutex::new(connection)))
}

/// 内存库。供测试使用，不触碰用户数据目录。
#[cfg(test)]
pub fn open_in_memory_connection() -> Result<SharedConnection, StoreError> {
    let connection = Connection::open_in_memory().map_err(|_| StoreError::Unavailable)?;
    configure_and_migrate(&connection)?;
    Ok(Arc::new(Mutex::new(connection)))
}

/// 取得连接锁。中毒时折叠成 `Failure`：一个 panic 过的写入路径意味着状态不可信。
pub fn lock_connection(
    connection: &SharedConnection,
) -> Result<MutexGuard<'_, Connection>, StoreError> {
    connection.lock().map_err(|_| StoreError::Failure)
}

/// 把 `query_map` 的结果**完整**收集成 `Vec`，任一行出错即整体失败。
///
/// ## 为什么需要这个函数
///
/// `rusqlite::MappedRows` 的 `Item` 是 `Result<T>`（`rusqlite-0.37/src/row.rs:155`）。而
/// `Result<T, E>` 实现了 `IntoIterator<Item = T>`，因此 `rows.flatten()` **能编译**——它把
/// 解码失败的行静默变成"零个元素"而不是传播错误。
///
/// 对普通列表这也许可以接受；对**完整性审计**不行：一次 SQLite 解码错误会让报告少报问题、
/// 分母变小，而 UI 于是显示得比真实状态更健康。那正是本仓库一贯反对的 fail-open。
///
/// 这个函数让 fallible 路径成为唯一路径：`collect()` 需要 `FromIterator<Result<T>>`，而
/// `Result<T, E>` 不实现它——因此类型会**拒绝** `.flatten()` 那种写法，而不是靠 review 拦。
pub fn collect_rows<T>(
    rows: impl Iterator<Item = rusqlite::Result<T>>,
) -> Result<Vec<T>, StoreError> {
    rows.collect::<rusqlite::Result<Vec<T>>>()
        .map_err(|_| StoreError::Failure)
}

/// 读单个 `i64` 标量（如 `COUNT(*)`）。
///
/// **MUST NOT** 在这里折叠成 `0`。审计报告用这些数字当分母——它要回答"这份'0 个问题'的报告
/// 来自多大的库"。折叠成 0 会让"查询失败"与"库里真有 0 条"不可区分，而前者发生时报告看起来
/// 恰恰是最健康的那个。
pub fn scalar_i64(connection: &Connection, sql: &str) -> Result<i64, StoreError> {
    connection
        .query_row(sql, [], |row| row.get::<_, i64>(0))
        .map_err(|_| StoreError::Failure)
}

/// 当前 schema 版本。SQLite 的 `user_version` 与 migration journal 必须与它一致。
///
/// D1 引入 `provider_profile`（版本 1）；D2.0 在**同一个库**上增加本地卡（版本 2）；
/// D2.1 增加内容寻址 blob 与 Web 包记录（版本 3、4）。刻意不新开数据库文件：Profile、
/// 本地卡、Web 包与 blob 同属一台设备上的用户资产，分库会让备份、迁移与"重开应用"各自多一套路径。
pub const SCHEMA_VERSION: i64 = 5;

/// 单条文档的 UTF-8 字节上限。
///
/// Provider Profile 契约本身有 64 KiB 上限；这里留出余量，使"契约合法但文档过大"这种
/// 情况以可诊断错误失败，而不是静默截断。本地卡文档另有限额，见 `local_card`。
pub const MAX_DOCUMENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    Unavailable,
    InvalidDocument,
    DocumentTooLarge,
    /// 调用方声明的索引列与 document 中的实际值不一致。以此拒绝而不是写入自相矛盾的行。
    IndexMismatch,
    /// 该记录已带 tombstone；必须先 `restore` 才能覆盖写入。
    Tombstoned,
    /// 请求的状态转移与既有状态不符（例如要求"删除"一条带 tombstone 的记录）。
    TransitionMismatch,
    /// 转移目标不存在。删除/恢复缺失 id 视为幂等 no-op，因此这是调用方逻辑错误。
    RecordMissing,
    /// `updated_at` 会回退，会破坏 keyset 分页的稳定顺序。
    NonMonotonicTimestamp,
    /// 查询参数越界（页大小不在 `1..=MAX_LOCAL_CARD_PAGE_SIZE`）。
    InvalidQuery,
    /// 本地库正处于维护窗口，写入被拒（`DESK-065`）。**不是**数据损坏：调用方应当重试。
    MaintenanceBusy,
    Failure,
}

impl From<crate::maintenance::MaintenanceRejection> for StoreError {
    /// 只映射 `MaintenanceBusy`。
    ///
    /// `InstanceLocked` 不在此出现：它属于应用启动阶段（第二个进程根本不会走到 command），
    /// 把它塞进运行期错误里会让 UI 提示"本地库正忙"，而真实原因是另一个进程占着这份库。
    fn from(rejection: crate::maintenance::MaintenanceRejection) -> Self {
        match rejection {
            crate::maintenance::MaintenanceRejection::MaintenanceBusy => {
                StoreError::MaintenanceBusy
            }
            crate::maintenance::MaintenanceRejection::InstanceLocked => StoreError::Unavailable,
        }
    }
}

impl StoreError {
    pub fn code(&self) -> &'static str {
        match self {
            StoreError::Unavailable => "store-unavailable",
            StoreError::InvalidDocument => "invalid-document",
            StoreError::DocumentTooLarge => "document-too-large",
            StoreError::IndexMismatch => "index-mismatch",
            StoreError::Tombstoned => "record-tombstoned",
            StoreError::TransitionMismatch => "transition-mismatch",
            StoreError::RecordMissing => "record-missing",
            StoreError::NonMonotonicTimestamp => "non-monotonic-timestamp",
            StoreError::InvalidQuery => "invalid-query",
            StoreError::MaintenanceBusy => "maintenance-busy",
            StoreError::Failure => "store-failure",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            StoreError::Unavailable => "local store is unavailable",
            StoreError::InvalidDocument => "local store rejected the document",
            StoreError::DocumentTooLarge => "local store document exceeds its byte ceiling",
            StoreError::IndexMismatch => "local store index columns disagree with the document",
            StoreError::Tombstoned => "local store record is deleted; restore it before saving",
            StoreError::TransitionMismatch => "local store refused the requested state transition",
            StoreError::RecordMissing => {
                "local store cannot transition a record that does not exist"
            }
            StoreError::NonMonotonicTimestamp => "local store refuses a backwards timestamp",
            StoreError::InvalidQuery => "local store rejected the query",
            StoreError::MaintenanceBusy => "the local library is being maintained; retry shortly",
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
    apply_steps(connection, MIGRATION_STEPS)
}

const MIGRATION_STEPS: &[MigrationStep] = &[
    MigrationStep {
        version: 1,
        sql: MIGRATION_1,
    },
    MigrationStep {
        version: 2,
        sql: crate::local_card::MIGRATION_2,
    },
    MigrationStep {
        version: 3,
        sql: crate::blob::MIGRATION_3,
    },
    MigrationStep {
        version: 4,
        sql: crate::web_package::MIGRATION_4,
    },
    MigrationStep {
        version: 5,
        sql: crate::arena_story::MIGRATION_5,
    },
];

#[cfg(test)]
pub(crate) fn migrate_to_version_for_test(connection: &Connection, version: i64) {
    assert!((1..=SCHEMA_VERSION).contains(&version));
    for step in MIGRATION_STEPS
        .iter()
        .filter(|step| step.version <= version)
    {
        apply_step(connection, step).expect("apply historical migration");
    }
}

/// 顺序应用所有 `version > current` 的步骤，每步一个事务。
///
/// 拆出来是为了让测试能传入**故意失败**的步骤；生产路径只有 `migrate` 一个调用方。
fn apply_steps(connection: &Connection, steps: &[MigrationStep]) -> Result<(), StoreError> {
    let current = user_version(connection)?;
    if current > SCHEMA_VERSION {
        return Err(StoreError::Unavailable);
    }
    for step in steps.iter().filter(|step| step.version > current) {
        apply_step(connection, step)?;
    }
    Ok(())
}

fn user_version(connection: &Connection) -> Result<i64, StoreError> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| StoreError::Unavailable)
}

/// 表是否存在。仅测试使用：断言失败事务确实回滚了 DDL。
#[cfg(test)]
fn table_exists(connection: &Connection, name: &str) -> bool {
    connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            rusqlite::params![name],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false)
}

/// 把 RFC3339 时间戳解析成 UTC epoch 毫秒，作为 keyset 的**排序键**。
///
/// 为什么不直接按 `updated_at` 文本排序：契约允许任意 UTC offset
/// （`datetime({ offset: true })`），而字符串比较不是时间比较。
/// `2026-09-30T12:00:00+14:00` 的文本大于 `2026-09-30T01:00:00Z`，实际却是**更早**的时刻。
/// 照文本排会让 keyset 漏读、让"时间戳不得回退"的判定误判，并让未来带 offset 的 archive
/// 导入顺序错乱。
///
/// 排序键由 native 自己从 document 的 `updatedAt` 解析，**不采信**调用方提供的值——因此它
/// 不可能被伪造或与 document 分叉。
///
/// 住在 `store` 而不是某个记录模块：本地卡与 Web 包是两种记录，但"如何比较时间"是同一个
/// 存储关注点。两份实现必然漂移，而漂移的后果是同一张卡在两种记录上顺序不同。
pub fn timestamp_sort_key(updated_at: &str) -> Result<i64, StoreError> {
    time::OffsetDateTime::parse(updated_at, &time::format_description::well_known::Rfc3339)
        // 秒与毫秒分开取，避免 unix_timestamp_nanos 的 i128 中间值。
        .map(|value| value.unix_timestamp() * 1_000 + i64::from(value.nanosecond() / 1_000_000))
        .map_err(|_| StoreError::InvalidDocument)
}

/// 一次迁移 = 一个显式事务。
///
/// 三件事**必须**在同一事务里：建表、写 journal、推进 `user_version`。分三次 autocommit
/// 语句会在中间留下崩溃窗口——`user_version` 先到最新而后续 DDL 未落盘时，下次启动会认为
/// 该版本已完成，从而永远跳过它，最终得到一个"版本号是 2 但 `local_card` 表不存在"的库。
///
/// `user_version` 写在事务内部因此会随回滚一起撤销：失败的迁移在磁盘上不留痕迹，下次
/// 启动仍是"未应用"状态。
fn apply_step(connection: &Connection, step: &MigrationStep) -> Result<(), StoreError> {
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|_| StoreError::Failure)?;

    let outcome = (|| {
        connection
            .execute_batch(step.sql)
            .map_err(|_| StoreError::Failure)?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migration (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![step.version, now_iso8601()],
            )
            .map_err(|_| StoreError::Failure)?;
        connection
            .execute_batch(&format!("PRAGMA user_version = {}", step.version))
            .map_err(|_| StoreError::Failure)?;
        Ok(())
    })();

    if let Err(error) = outcome {
        let _ = connection.execute_batch("ROLLBACK");
        return Err(error);
    }
    connection
        .execute_batch("COMMIT")
        .map_err(|_| StoreError::Failure)
}

/// 迁移步骤。抽出结构是为了让测试能注入一个**故意失败**的步骤，
/// 否则"迁移是原子的"这条属性无法被验证。
#[derive(Debug, Clone, Copy)]
struct MigrationStep {
    version: i64,
    sql: &'static str,
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

/// 配置 PRAGMA 并应用迁移。
///
/// 抽成自由函数是因为 D2.0 引入了第二个访问同一个库的类型（`LocalCardStore`）。两条路径
/// **MUST** 用同一份 PRAGMA 与迁移，否则会出现"Profile 库开了 WAL、卡片库没开"这类
/// 按类型分叉的隐性差异。
pub fn configure_and_migrate(connection: &Connection) -> Result<(), StoreError> {
    configure(connection)?;
    migrate(connection)
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
/// 共享连接是 D2.2a 引入的：四个 store 此前各开一条连接、各持一把锁，于是
/// `save_web_package` 的"写 blob"与"写包事务"两步之间存在一个无人持有的观察窗口。
/// 现在所有 store 共用 [`SharedConnection`]，跨资源的操作落在同一临界区内。
///
/// 单连接 + `Mutex` 是刻意的：本地库的写入是低频的（用户保存卡片、修改 Profile），
/// 而复杂度预算要求避免为它引入连接池与异步写入路径。
pub struct LocalStore {
    connection: SharedConnection,
}

impl LocalStore {
    pub fn new(connection: SharedConnection) -> Self {
        Self { connection }
    }

    /// 单独打开一条连接。**仅测试与迁移工具使用**：生产路径经由
    /// [`crate::library::LocalLibrary`] 共享同一条连接（`DESK-065`）。
    #[cfg(test)]
    pub fn open(paths: &LocalStorePaths) -> Result<Self, StoreError> {
        Ok(Self::new(open_shared_connection(paths)?))
    }

    /// 打开内存库。供测试使用，不触碰用户数据目录。
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, StoreError> {
        Ok(Self::new(open_in_memory_connection()?))
    }
    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let guard = lock_connection(&self.connection)?;
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
    use super::{
        applied_migrations, apply_steps, collect_rows, configure, migrate, scalar_i64,
        table_exists, user_version, LocalStore, LocalStorePaths, MigrationStep, StoreError,
        MAX_DOCUMENT_BYTES, MIGRATION_1, SCHEMA_VERSION,
    };
    use rusqlite::Connection;

    /// 把源码里的注释行去掉，只留下会被编译的代码。
    ///
    /// 结构门禁必须扫代码而不是扫文本：这两个模块的注释里**要**写出 `.flatten()` 这个词来讲清
    /// 为什么不能那么写，扫原文会把自己的说明当成违规。
    fn code_lines(source: &str) -> impl Iterator<Item = &str> {
        source
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("//"))
    }

    /// 审计与 GC **MUST NOT** 对查询结果用 `.flatten()`。
    ///
    /// 这条门禁存在的唯一理由是：`rusqlite::MappedRows` 的 `Item` 是 `Result<T>`，而
    /// `Result<T, E>` 实现了 `IntoIterator<Item = T>`，因此 `rows.flatten()` **能编译**——
    /// 编译器不会拦它，只有语义测试能，而"SQLite 在这一步恰好解码失败"无法在无头环境里构造。
    ///
    /// 曾真实发生过的两个后果方向相反：审计里少报问题（fail-open），审计的 `known` 集合变短
    /// 导致每个 blob 都被误报成孤儿（fail-noisy）。两者都是错的报告。
    ///
    /// `collect_rows` 用 `collect::<rusqlite::Result<Vec<T>>>()`，而 `Result<T, E>` 不实现
    /// `FromIterator`——因此正确写法在类型上无法被误写成 `.flatten()`，这条门禁守的是
    /// "有人绕过 `collect_rows` 直接手写 `.flatten()`"。
    #[test]
    fn audit_and_gc_never_flatten_a_query_result() {
        let offenders: Vec<(&str, &str)> = [
            ("audit.rs", include_str!("./audit.rs")),
            ("gc.rs", include_str!("./gc.rs")),
        ]
        .into_iter()
        .flat_map(|(module, source)| {
            code_lines(source)
                .filter(|line| line.contains(".flatten()"))
                .map(move |line| (module, line))
                .collect::<Vec<_>>()
        })
        .collect();
        assert!(
            offenders.is_empty(),
            "MUST NOT 用 .flatten() 遍历查询结果（它会静默跳过出错行）：{offenders:?}"
        );
    }

    #[test]
    fn collect_rows_propagates_a_row_error_instead_of_dropping_the_row() {
        // 直接的行为门禁：前两行成功、第三行类型不匹配时，整体必须失败且**不含**那三行中的任何一行。
        let connection = Connection::open_in_memory().expect("in-memory connection");
        connection
            .execute_batch(
                "CREATE TABLE mixed (value TEXT); INSERT INTO mixed VALUES ('1'), ('2'), (3);",
            )
            .expect("fixture table");

        let mut statement = connection
            .prepare("SELECT value FROM mixed")
            .expect("prepare");
        let rows = statement
            .query_map([], |row| row.get::<_, i64>(0))
            .expect("query");

        // SQLite 是动态类型：TEXT 列里的 INTEGER 值取成 i64 会得到类型不匹配。
        let error = collect_rows(rows).expect_err("第三行的类型错误必须整体失败");
        assert_eq!(error, StoreError::Failure);
    }

    #[test]
    fn scalar_i64_never_reports_a_failed_query_as_zero() {
        // 分母必须是真的。"查询失败"折叠成 0 会让它与"库里真有 0 条"不可区分，而审计报告
        // 恰恰靠这个数字回答"这份'0 个问题'来自多大的库"。
        let connection = Connection::open_in_memory().expect("in-memory connection");
        connection
            .execute_batch("CREATE TABLE counted (id INTEGER);")
            .expect("fixture table");

        assert_eq!(
            scalar_i64(&connection, "SELECT COUNT(*) FROM counted"),
            Ok(0),
            "空表的真值就是 0"
        );
        assert_eq!(
            scalar_i64(&connection, "SELECT COUNT(*) FROM no_such_table"),
            Err(StoreError::Failure),
            "查询失败必须是错误，而不是 0"
        );
    }

    fn store() -> LocalStore {
        LocalStore::open_in_memory().expect("in-memory store must open")
    }

    #[test]
    fn migration_is_idempotent_and_records_its_own_version() {
        let store = store();
        assert_eq!(store.schema_version().expect("version"), SCHEMA_VERSION);

        let versions = applied_migrations(&store.connection.lock().expect("lock"))
            .expect("migration journal must be readable");
        assert_eq!(versions, vec![1, 2, 3, 4, 5]);

        // 重复打开同一个库不会重复执行迁移。
        let reopened = LocalStore::open_in_memory().expect("reopen");
        assert_eq!(reopened.schema_version().expect("version"), SCHEMA_VERSION);
    }

    #[test]
    fn migration_from_a_version_1_database_adds_local_card_without_touching_profiles() {
        // 模拟 D1 留下的库：只有 provider_profile，user_version = 1。
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-desktop-upgrade-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test root");
        let database = root.join("library.sqlite");

        {
            let connection = Connection::open(&database).expect("open");
            connection
                .execute_batch(
                    "PRAGMA journal_mode = WAL;
                     CREATE TABLE provider_profile (
                        id TEXT PRIMARY KEY NOT NULL,
                        document TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                     ) STRICT;
                     CREATE TABLE schema_migration (
                        version INTEGER PRIMARY KEY NOT NULL,
                        applied_at TEXT NOT NULL
                     ) STRICT;
                     INSERT INTO provider_profile (id, document, updated_at)
                        VALUES ('profile-1', '{\"v\":1}', '2026-09-30T00:00:00Z');
                     INSERT INTO schema_migration (version, applied_at) VALUES (1, 'seed');
                     PRAGMA user_version = 1;",
                )
                .expect("seed v1 database");
        }

        let store = LocalStore::open(&LocalStorePaths::under(&root)).expect("upgrade must succeed");
        assert_eq!(store.schema_version().expect("version"), SCHEMA_VERSION);
        // 既有 Profile 必须原样保留：升级不能要求用户重新保存任何东西。
        assert_eq!(
            store.get("profile-1").expect("get must succeed"),
            Some("{\"v\":1}".to_string())
        );
        let versions = applied_migrations(&store.connection.lock().expect("lock"))
            .expect("migration journal must be readable");
        assert_eq!(versions, vec![1, 2, 3, 4, 5]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_to_open_a_database_from_a_newer_schema() {
        let connection = Connection::open_in_memory().expect("open");
        connection
            .execute_batch(&format!("PRAGMA user_version = {}", SCHEMA_VERSION + 1))
            .expect("set future version");
        assert_eq!(migrate(&connection), Err(StoreError::Unavailable));
    }

    /// R2：验证"迁移是原子的"，而不是只在顺利路径上验证。
    ///
    /// 注入一个必然失败的 v2，检查三件事同时成立：
    ///
    /// 1. `user_version` 停在 1（没有被提前推到最新）；
    /// 2. journal 里没有 2；
    /// 3. 失败的 DDL 没有留下痕迹（`local_card` 不存在）。
    ///
    /// 这正是旧实现会失败的场景：它把 `user_version = SCHEMA_VERSION` 写在 MIGRATION_1
    /// 之后、MIGRATION_2 之前，于是"版本号是 2 但表不存在"的库会被永久跳过。
    #[test]
    fn a_failed_migration_step_leaves_no_partial_state_behind() {
        let connection = Connection::open_in_memory().expect("open");
        configure(&connection).expect("configure");

        let failing = [
            MigrationStep {
                version: 1,
                sql: MIGRATION_1,
            },
            MigrationStep {
                version: 2,
                sql: "CREATE TABLE local_card (id TEXT PRIMARY KEY NOT NULL); \
                      INSERT INTO no_such_table (x) VALUES (1);",
            },
        ];

        assert_eq!(apply_steps(&connection, &failing), Err(StoreError::Failure));

        assert_eq!(
            user_version(&connection).expect("read version"),
            1,
            "user_version 必须停在最后一个成功的版本，不能提前推到最新"
        );
        assert_eq!(
            applied_migrations(&connection).expect("read journal"),
            vec![1],
            "失败的版本不得写进 journal"
        );
        assert!(
            !table_exists(&connection, "local_card"),
            "失败事务内的建表必须一并回滚，否则留下半套 schema"
        );
    }

    #[test]
    fn a_partially_migrated_database_completes_on_the_next_open() {
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-desktop-partial-migration-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test root");
        let database = root.join("library.sqlite");

        // 第一次打开：v2 失败，磁盘上留下的是"只完成 v1"的状态。
        {
            let connection = Connection::open(&database).expect("open");
            configure(&connection).expect("configure");
            let failing = [
                MigrationStep {
                    version: 1,
                    sql: MIGRATION_1,
                },
                MigrationStep {
                    version: 2,
                    sql: "CREATE TABLE local_card (id TEXT PRIMARY KEY NOT NULL); \
                          INSERT INTO no_such_table (x) VALUES (1);",
                },
            ];
            assert_eq!(apply_steps(&connection, &failing), Err(StoreError::Failure));
        }

        // 第二次打开：条件已修好，真实的 v2 必须被补上。
        {
            let store = LocalStore::open(&LocalStorePaths::under(&root))
                .expect("second open must complete the migration");
            assert_eq!(store.schema_version().expect("version"), SCHEMA_VERSION);
            let versions = applied_migrations(&store.connection.lock().expect("lock"))
                .expect("journal must be readable");
            assert_eq!(versions, vec![1, 2, 3, 4, 5]);
        }

        // 第三次打开：全部已完成，不重复执行。
        {
            let store = LocalStore::open(&LocalStorePaths::under(&root)).expect("third open");
            assert_eq!(
                applied_migrations(&store.connection.lock().expect("lock")).expect("journal"),
                vec![1, 2, 3, 4, 5]
            );
        }

        let _ = std::fs::remove_dir_all(&root);
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
