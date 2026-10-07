//! D5.1-K1 公开资料持久只读缓存（`DESK-CACHE-001`..`008`）。
//!
//! 与正式本地库 `library.sqlite` 物理隔离的独立 SQLite 文件
//! `public-read-cache.sqlite`——同目录、同进程锁，但独立连接、独立
//! `user_version` 与独立迁移阶梯。它是**派生快照**，不是正式本地资产：
//!
//! - 只缓存两类内容：实际成功读取的公开摘要投影，与用户实际打开且成功
//!   读取的完整正文投影。没有后台扫描、整站镜像或预取；
//! - 缓存的来源只允许固定的 `public-data-cards.query` 路由，且响应必须带
//!   `Cache-Control: public` 存储许可——`no-store`/`private`/缺失一律不
//!   落盘；持久化前经白名单投影，收藏关系、账号元数据与未知字段进不来；
//! - 缓存写失败**永远不**让在线请求失败：在线结果照常回给 renderer，失败
//!   只投影为响应上的 `cache.outcome`；
//! - 缓存库自身损坏/未知 schema 时降级停用（stats 如实报告），不影响正式
//!   本地库与应用启动。
//!
//! ## 并发守卫：epoch + per-row revision
//!
//! 每条在途公开请求在发送前取一张 [`ObserveTicket`]——记下当时的
//! `write_epoch` 与 `mutation_seq` 快照。提交时：
//!
//! - `write_epoch` 不匹配 ⇒ 期间发生过整库清理或捕获被禁用——整批丢弃；
//! - 目标行 `revision > ticket.mutation_seq` ⇒ 该行在请求发出后已被更新的
//!   证据改写（更新的捕获、撤回标记）——跳过该行，不用旧响应复活新状态。
//!
//! `mutation_seq` 就是规格要求的「本地并发控制 revision」：它按 mutation
//! 事务单调分配，充当每条行的全局可比较版本号。
//!
//! ## 预算与淘汰
//!
//! `maxBytes` 是逻辑预算：`unlimited` 只能由显式字符串表达；`whenFull`
//! 默认 `pause`（满额暂停新增/增长，不自动删旧数据），用户可显式开启
//! `evict-least-recently-used`——淘汰只在新写入确实需要空间时发生，且只
//! 回收最少的旧条目。撤回占位（`availability='withdrawn'`）不参与淘汰：
//! 它是「该卡已不可用」的失效证据，不是可回收内容。

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// 与正式库同目录的独立缓存文件。备份/恢复/manifest 只认 `library.sqlite`
/// 与 blobs，这个文件因此天然不进入 D2 portable archive。
pub const PUBLIC_READ_CACHE_FILE: &str = "public-read-cache.sqlite";

/// K1 schema 版本。更高的磁盘版本 = 来自更新版本的应用——拒绝读写而不是
/// 降级破坏（`DESK-CACHE-002`：未知 schema 不影响正式本地库）。
const SCHEMA_VERSION: i64 = 1;

/// 每条缓存行的固定开销估算（主键、时间戳、索引）。逻辑预算按
/// `summary_bytes + body_bytes + 固定行开销` 计量，不假装做磁盘级精算。
const ROW_OVERHEAD_BYTES: u64 = 192;

/// `publicLibraryCache.maxBytes` 的合法域——与 contracts/desktop-config 一致。
pub const MIN_BUDGET_BYTES: u64 = 1_048_576;
pub const DEFAULT_BUDGET_BYTES: u64 = 268_435_456;
pub const MAX_BUDGET_BYTES: u64 = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER

const META_WRITE_EPOCH: &str = "write_epoch";
const META_MUTATION_SEQ: &str = "mutation_seq";

/* ── 公开投影白名单（fixture `cardLibrary.publicReadCache` 镜像） ──────── */

/// 摘要响应允许持久化的字段。账号关系字段（`favorited_at` 等）刻意不在内：
/// 公开源里它们恒为 null，但白名单保证即使服务端变化它们也进不了缓存。
const SUMMARY_FIELDS: &[&str] = &[
    "id",
    "user_id",
    "type",
    "name",
    "description",
    "is_public",
    "review_status",
    "created_at",
    "updated_at",
    "usage_count",
    "like_count",
    "favorite_count",
    "is_recommended",
    "username",
    "roleType",
    "nativeAllowed",
    "has_pending_update",
    "tag_ids",
    "isLegacyQuestionnaire",
];

/// 单卡完整响应允许持久化的字段。`deleted_at`（软删内部状态）与一切身份/
/// 凭据字段刻意不在内。
const CARD_FIELDS: &[&str] = &[
    "id",
    "user_id",
    "type",
    "name",
    "description",
    "data",
    "is_public",
    "public_since",
    "review_status",
    "is_recommended",
    "usage_count",
    "like_count",
    "favorite_count",
    "created_at",
    "updated_at",
    "username",
    "tag_ids",
    "tagIds",
];

/* ── wire 形状（与 contracts/desktop-ipc、desktop-cloud 一致） ─────────── */

/// `publicLibraryCache.maxBytes`：有限预算或显式 `"unlimited"`。
/// `0`/负数/未知字符串在反序列化阶段就是非法——不会被当作无限放行。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheBudget {
    Limited(u64),
    Unlimited,
}

impl Serialize for CacheBudget {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Limited(bytes) => serializer.serialize_u64(*bytes),
            Self::Unlimited => serializer.serialize_str("unlimited"),
        }
    }
}

impl<'de> Deserialize<'de> for CacheBudget {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error as _;
        match serde_json::Value::deserialize(deserializer)? {
            serde_json::Value::Number(number) => number
                .as_u64()
                .filter(|bytes| *bytes >= MIN_BUDGET_BYTES && *bytes <= MAX_BUDGET_BYTES)
                .map(Self::Limited)
                .ok_or_else(|| D::Error::custom("maxBytes 超出合法域")),
            serde_json::Value::String(text) if text == "unlimited" => Ok(Self::Unlimited),
            _ => Err(D::Error::custom(
                "maxBytes 必须是 >= 1MiB 的整数或 \"unlimited\"",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CacheWhenFull {
    Pause,
    EvictLeastRecentlyUsed,
}

/// `public_read_cache_apply_policy` 的推送体：renderer 已把 config.json 的
/// 归一结果（含降级收口）折叠成这三个字段，native 不做第二次域判定。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicCachePolicyDto {
    pub capture_enabled: bool,
    pub max_bytes: CacheBudget,
    pub when_full: CacheWhenFull,
}

impl Default for PublicCachePolicyDto {
    /// 与 `DESKTOP_CONFIG_DEFAULTS` 一致：缺文件即「首次默认」——捕获开启、
    /// 256 MiB、满额暂停。renderer 推送会覆盖这份进程内默认。
    fn default() -> Self {
        Self {
            capture_enabled: true,
            max_bytes: CacheBudget::Limited(DEFAULT_BUDGET_BYTES),
            when_full: CacheWhenFull::Pause,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CacheOutcomeKind {
    Captured,
    Partial,
    Paused,
    Disabled,
    Unavailable,
    Withdrawn,
    Stale,
    Ignored,
}

/// `CloudRouteResponse.cache`：本次响应与持久缓存的关系。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheOutcome {
    pub outcome: CacheOutcomeKind,
    pub captured: u64,
    pub skipped: u64,
}

impl CacheOutcome {
    fn simple(kind: CacheOutcomeKind) -> Self {
        Self {
            outcome: kind,
            captured: 0,
            skipped: 0,
        }
    }

    pub fn unavailable() -> Self {
        Self::simple(CacheOutcomeKind::Unavailable)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCacheStats {
    /// 'empty' | 'ready' | 'unavailable' | 'unsupported-schema'
    pub status: &'static str,
    pub path: String,
    pub usage_bytes: u64,
    pub entry_count: u64,
    pub summary_count: u64,
    pub body_count: u64,
    pub withdrawn_count: u64,
    pub applied_policy: PublicCachePolicyDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCacheClearResult {
    pub removed_entries: u64,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicCacheErrorCode {
    /// 契约错误码全集（与 contracts/desktop-ipc 一致）。`invalid-request`
    /// 目前仅由 serde `deny_unknown_fields`/域校验在参数层拒绝——Rust 侧
    /// 到达这里的入参已合法，因此该变体暂不构造；保留它是为 wire 契约
    /// 与后续命令语义留完整枚举面。
    #[allow(dead_code)]
    InvalidRequest,
    StorageUnavailable,
    InternalError,
}

#[derive(Debug)]
pub struct PublicCacheError {
    pub code: PublicCacheErrorCode,
    pub message: String,
}

impl PublicCacheError {
    fn new(code: PublicCacheErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// spawn_blocking join 失败等调度层错误的构造入口（lib.rs 命令壳）。
    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new(PublicCacheErrorCode::InternalError, message)
    }
}

impl Serialize for PublicCacheError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct as _;
        let code = match self.code {
            PublicCacheErrorCode::InvalidRequest => "invalid-request",
            PublicCacheErrorCode::StorageUnavailable => "storage-unavailable",
            PublicCacheErrorCode::InternalError => "internal-error",
        };
        let mut state = serializer.serialize_struct("PublicCacheError", 2)?;
        state.serialize_field("code", code)?;
        state.serialize_field("message", &self.message)?;
        state.end()
    }
}

/* ── 内部存储 ──────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenFailure {
    /// 打开/迁移/读写失败：缓存停用但库文件保留。
    Storage,
    /// 磁盘上是比本进程更新的 schema：不写不删。
    UnsupportedSchema,
}

#[derive(Debug)]
enum ConnState {
    /// 尚未打开（首个公开读取/清理动作才会建文件）。
    Closed,
    Open(Connection),
    Failed(OpenFailure),
}

#[derive(Debug)]
struct CacheInner {
    conn: ConnState,
    policy: PublicCachePolicyDto,
}

/// 一次在途公开请求拿到的并发快照。见模块头的 epoch/revision 说明。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObserveTicket {
    epoch: i64,
    mutation_seq: i64,
}

/// Tauri managed state：固定路径 + 进程内唯一互斥——单连接单写者。
pub struct PublicReadCache {
    path: PathBuf,
    inner: Mutex<CacheInner>,
}

impl PublicReadCache {
    /// `data_root` 由 native 在 setup 产生；这里只负责拼固定文件名。
    pub fn at(data_root: &Path) -> Self {
        Self {
            path: data_root.join(PUBLIC_READ_CACHE_FILE),
            inner: Mutex::new(CacheInner {
                conn: ConnState::Closed,
                policy: PublicCachePolicyDto::default(),
            }),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, CacheInner>, PublicCacheError> {
        self.inner
            .lock()
            .map_err(|_| PublicCacheError::new(PublicCacheErrorCode::InternalError, "缓存锁已中毒"))
    }

    /// `public_read_cache_apply_policy`：登记当前生效策略。
    ///
    /// `captureEnabled` 由开到关的转换会推进 `write_epoch`——禁用窗口前发出
    /// 的响应因此不会在其后悄悄回填。关闭期间必要的撤回失效处理仍允许
    /// （`captureEnabled` 只暂停正缓存，不暂停失效）。
    pub fn apply_policy(&self, policy: PublicCachePolicyDto) -> Result<(), PublicCacheError> {
        let mut inner = self.lock()?;
        let was_enabled = inner.policy.capture_enabled;
        inner.policy = policy;
        if was_enabled && !policy.capture_enabled {
            // 库还没开过 ⇒ 没有任何在途 ticket，bump 无从谈起。
            if let ConnState::Open(conn) = &inner.conn {
                let _ = bump_meta(conn, META_WRITE_EPOCH);
            }
        }
        Ok(())
    }

    /// 公开请求发送前的并发快照。缓存不可用时返回 `None`——调用方仍走在线
    /// 路径，只是本次响应带 `cache.outcome = 'unavailable'`。
    pub fn begin_observe(&self) -> Option<ObserveTicket> {
        let mut inner = self.inner.lock().ok()?;
        let conn = ensure_open(&mut inner, &self.path)?;
        Some(ObserveTicket {
            epoch: meta_i64(conn, META_WRITE_EPOCH).ok()?,
            mutation_seq: meta_i64(conn, META_MUTATION_SEQ).ok()?,
        })
    }

    /// 响应到达后的捕获收口：分类 → 投影 → 并发守卫 → 预算 → 写盘。
    /// 任何一步失败都只改变返回值，不影响已回给 renderer 的在线结果。
    pub fn observe_response(
        &self,
        ticket: &ObserveTicket,
        scope: &str,
        query: Option<&BTreeMap<String, String>>,
        cache_control: Option<&str>,
        status: u16,
        body: &serde_json::Value,
    ) -> CacheOutcome {
        let verdict = classify(query, cache_control, status, body);
        let Ok(mut inner) = self.inner.lock() else {
            return CacheOutcome::unavailable();
        };
        let policy = inner.policy;
        let ConnState::Open(conn) = &mut inner.conn else {
            return CacheOutcome::unavailable();
        };
        let now = now_rfc3339();
        match verdict {
            PublicVerdict::Ignore => CacheOutcome::simple(CacheOutcomeKind::Ignored),
            PublicVerdict::Withdraw(card_id) => {
                match withdraw_card(conn, scope, &card_id, ticket, &now) {
                    Ok(outcome) => outcome,
                    Err(_) => CacheOutcome::unavailable(),
                }
            }
            PublicVerdict::Summaries(items, invalid) => {
                if !policy.capture_enabled {
                    return CacheOutcome {
                        outcome: CacheOutcomeKind::Disabled,
                        captured: 0,
                        skipped: items.len() as u64 + invalid,
                    };
                }
                commit_captures(conn, scope, items, invalid, ticket, &policy, &now)
                    .unwrap_or_else(|_| CacheOutcome::unavailable())
            }
            PublicVerdict::Card(item) => {
                if !policy.capture_enabled {
                    return CacheOutcome {
                        outcome: CacheOutcomeKind::Disabled,
                        captured: 0,
                        skipped: 1,
                    };
                }
                commit_captures(conn, scope, vec![item], 0, ticket, &policy, &now)
                    .unwrap_or_else(|_| CacheOutcome::unavailable())
            }
        }
    }

    /// `public_read_cache_stats`：如实报告状态；文件还没建过就是 `empty`，
    /// 不为「看一眼统计」先造一个库。
    pub fn stats(&self) -> Result<PublicCacheStats, PublicCacheError> {
        let mut inner = self.lock()?;
        let path = self.path.to_string_lossy().to_string();
        let base = |status: &'static str, policy: PublicCachePolicyDto| PublicCacheStats {
            status,
            path: path.clone(),
            usage_bytes: 0,
            entry_count: 0,
            summary_count: 0,
            body_count: 0,
            withdrawn_count: 0,
            applied_policy: policy,
        };
        let policy = inner.policy;
        match &inner.conn {
            ConnState::Failed(OpenFailure::UnsupportedSchema) => {
                return Ok(base("unsupported-schema", policy));
            }
            ConnState::Failed(OpenFailure::Storage) => {
                return Ok(base("unavailable", policy));
            }
            _ => {}
        }
        if matches!(inner.conn, ConnState::Closed) && !self.path.exists() {
            return Ok(base("empty", policy));
        }
        match ensure_open(&mut inner, &self.path) {
            Some(conn) => {
                let stats = query_stats(conn).map_err(|_| {
                    PublicCacheError::new(
                        PublicCacheErrorCode::StorageUnavailable,
                        "缓存统计查询失败",
                    )
                })?;
                Ok(PublicCacheStats {
                    status: "ready",
                    ..stats
                }
                .with_path_and_policy(path, policy))
            }
            None => {
                let status = match inner.conn {
                    ConnState::Failed(OpenFailure::UnsupportedSchema) => "unsupported-schema",
                    _ => "unavailable",
                };
                Ok(base(status, policy))
            }
        }
    }

    /// `public_read_cache_clear`：清空全部缓存行并推进 `write_epoch`——
    /// 在途响应一律按 stale 丢弃，不会在清理后回填。
    pub fn clear(&self) -> Result<PublicCacheClearResult, PublicCacheError> {
        let mut inner = self.lock()?;
        if matches!(inner.conn, ConnState::Closed) && !self.path.exists() {
            return Ok(PublicCacheClearResult {
                removed_entries: 0,
                freed_bytes: 0,
            });
        }
        let Some(conn) = ensure_open(&mut inner, &self.path) else {
            return Err(PublicCacheError::new(
                PublicCacheErrorCode::StorageUnavailable,
                "缓存库不可用，无法清理",
            ));
        };
        let tx = conn.transaction().map_err(|_| {
            PublicCacheError::new(PublicCacheErrorCode::InternalError, "清理事务开启失败")
        })?;
        let (removed, freed): (u64, u64) = tx
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(row_bytes), 0) FROM cards",
                [],
                |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, i64>(1)? as u64)),
            )
            .map_err(|_| {
                PublicCacheError::new(PublicCacheErrorCode::InternalError, "清理统计失败")
            })?;
        tx.execute("DELETE FROM cards", []).map_err(|_| {
            PublicCacheError::new(PublicCacheErrorCode::InternalError, "清理删除失败")
        })?;
        bump_meta(&tx, META_WRITE_EPOCH).map_err(|_| {
            PublicCacheError::new(PublicCacheErrorCode::InternalError, "清理 epoch 推进失败")
        })?;
        bump_meta(&tx, META_MUTATION_SEQ).map_err(|_| {
            PublicCacheError::new(PublicCacheErrorCode::InternalError, "清理 seq 推进失败")
        })?;
        tx.commit().map_err(|_| {
            PublicCacheError::new(PublicCacheErrorCode::InternalError, "清理提交失败")
        })?;
        Ok(PublicCacheClearResult {
            removed_entries: removed,
            freed_bytes: freed,
        })
    }
}

impl PublicCacheStats {
    fn with_path_and_policy(mut self, path: String, policy: PublicCachePolicyDto) -> Self {
        self.path = path;
        self.applied_policy = policy;
        self
    }
}

/* ── 打开与迁移 ────────────────────────────────────────────────────────── */

fn ensure_open<'a>(inner: &'a mut CacheInner, path: &Path) -> Option<&'a mut Connection> {
    if matches!(inner.conn, ConnState::Closed) {
        inner.conn = match open_cache(path) {
            Ok(conn) => ConnState::Open(conn),
            Err(failure) => ConnState::Failed(failure),
        };
    }
    match &mut inner.conn {
        ConnState::Open(conn) => Some(conn),
        _ => None,
    }
}

fn open_cache(path: &Path) -> Result<Connection, OpenFailure> {
    let conn = Connection::open(path).map_err(|_| OpenFailure::Storage)?;
    // 与正式库同一组 PRAGMA 理由：WAL 读写不互阻塞；FULL sync 保证崩溃一致性。
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|_| OpenFailure::Storage)?;

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| OpenFailure::Storage)?;
    if version > SCHEMA_VERSION {
        // 来自更新版本应用的库：不读不写不删，本次进程停用缓存。
        return Err(OpenFailure::UnsupportedSchema);
    }
    if version < SCHEMA_VERSION {
        migrate(&conn, version)?;
    }
    Ok(conn)
}

fn migrate(conn: &Connection, _from: i64) -> Result<(), OpenFailure> {
    // 一次迁移 = 一个显式事务：建表、seed 计数器与 user_version 必须同生共死，
    // 否则崩溃窗口会留下「版本到位但表缺失」的库（store.rs 同一纪律）。
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|_| OpenFailure::Storage)?;
    let outcome = (|| {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS cache_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cards (
                card_id TEXT NOT NULL,
                source_scope TEXT NOT NULL,
                availability TEXT NOT NULL DEFAULT 'known'
                    CHECK (availability IN ('known', 'withdrawn')),
                revision INTEGER NOT NULL,
                summary_json TEXT,
                card_json TEXT,
                summary_bytes INTEGER NOT NULL DEFAULT 0,
                body_bytes INTEGER NOT NULL DEFAULT 0,
                row_bytes INTEGER NOT NULL DEFAULT 0,
                summary_updated_at TEXT,
                body_updated_at TEXT,
                first_captured_at TEXT NOT NULL,
                last_success_at TEXT,
                last_attempt_at TEXT NOT NULL,
                last_used_at TEXT,
                PRIMARY KEY (card_id, source_scope)
            );
            CREATE INDEX IF NOT EXISTS idx_cards_eviction
                ON cards (availability, last_used_at);
            INSERT OR IGNORE INTO cache_meta (key, value) VALUES
                ('write_epoch', '1'),
                ('mutation_seq', '1');",
        )
        .map_err(|_| OpenFailure::Storage)?;
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(|_| OpenFailure::Storage)
    })();
    match outcome {
        Ok(()) => conn
            .execute_batch("COMMIT")
            .map_err(|_| OpenFailure::Storage),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

/* ── meta 计数器 ───────────────────────────────────────────────────────── */

fn meta_i64(conn: &Connection, key: &str) -> Result<i64, ()> {
    conn.query_row(
        "SELECT CAST(value AS INTEGER) FROM cache_meta WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .map_err(|_| ())
}

fn bump_meta(conn: &Connection, key: &str) -> Result<i64, ()> {
    conn.execute(
        "UPDATE cache_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = ?1",
        [key],
    )
    .map_err(|_| ())?;
    meta_i64(conn, key)
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/* ── 响应分类与安全投影 ────────────────────────────────────────────────── */

enum PublicVerdict {
    /// 响应对缓存不可分类：不写任何东西。
    Ignore,
    /// 业务级不可用（`?id=` 单卡 404 `{success:false}`）——撤回该卡。
    Withdraw(String),
    /// 摘要页投影（第二项为投影失败的条目数）。
    Summaries(Vec<CaptureItem>, u64),
    /// 单卡完整响应投影。
    Card(CaptureItem),
}

struct CaptureItem {
    card_id: String,
    /// 服务端 `updated_at`——摘要/正文版本提示，分开记账。
    updated_at: Option<String>,
    /// 摘要视图投影（该响应对摘要字段贡献的键值）。
    summary: serde_json::Map<String, serde_json::Value>,
    /// 完整正文投影；摘要页响应为 `None`。
    card: Option<serde_json::Map<String, serde_json::Value>>,
}

/// 存储许可：必须有 `public` token，且不得出现 `no-store`/`private`/`no-cache`。
/// 缺头、未知策略与「看起来像 public 但还写着 no-store」的响应一律不落盘
/// （`DESK-CACHE-004`：只缓存服务端明确允许存储的公开响应）。
fn cache_permits_storage(cache_control: Option<&str>) -> bool {
    let Some(header) = cache_control else {
        return false;
    };
    let tokens: BTreeSet<String> = header
        .split(',')
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| !token.is_empty())
        .collect();
    tokens.contains("public")
        && !tokens.contains("no-store")
        && !tokens.contains("private")
        && !tokens.contains("no-cache")
}

fn project(
    source: &serde_json::Map<String, serde_json::Value>,
    fields: &[&str],
) -> serde_json::Map<String, serde_json::Value> {
    fields
        .iter()
        .filter_map(|key| {
            source
                .get(*key)
                .map(|value| ((*key).to_string(), value.clone()))
        })
        .collect()
}

fn text_field<'a>(
    source: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<&'a str> {
    source.get(key).and_then(serde_json::Value::as_str)
}

/// 单卡响应的公开性最低门槛：自声明公开 + 正文为字符串 + id 与请求一致。
fn project_card(
    requested_id: &str,
    card: &serde_json::Map<String, serde_json::Value>,
) -> Option<CaptureItem> {
    if text_field(card, "id") != Some(requested_id) {
        return None;
    }
    if card.get("is_public").and_then(serde_json::Value::as_i64) != Some(1) {
        return None;
    }
    let data = card.get("data")?;
    if !data.is_string() {
        return None;
    }
    Some(CaptureItem {
        card_id: requested_id.to_string(),
        updated_at: text_field(card, "updated_at").map(str::to_string),
        summary: project(card, SUMMARY_FIELDS),
        card: Some(project(card, CARD_FIELDS)),
    })
}

/// 摘要条目的公开性最低门槛：自声明公开 + 基本展示字段在场。
fn project_summary(card: &serde_json::Value) -> Option<CaptureItem> {
    let card = card.as_object()?;
    let id = text_field(card, "id")?;
    text_field(card, "type")?;
    text_field(card, "name")?;
    if card.get("is_public").and_then(serde_json::Value::as_i64) != Some(1) {
        return None;
    }
    Some(CaptureItem {
        card_id: id.to_string(),
        updated_at: text_field(card, "updated_at").map(str::to_string),
        summary: project(card, SUMMARY_FIELDS),
        card: None,
    })
}

/// 固定公开路由的响应分类（`DESK-CACHE-004`）：
///
/// - `?id=` + 404 `{success:false}` 是**业务级不可用**——唯一允许移除缓存
///   的信号；503、HTML 404、401、网络错误都不是（它们到不了这里：非 JSON
///   响应在 `read_bounded_json` 已被拒）。
/// - `?id=` + 200 `{success:true, card:{…}}` 且 card.id 与请求一致 → 正文投影；
/// - `view=summary` + 200 `{success:true, cards:[…]}` → 摘要投影；
/// - 一切其它形状、状态码与非 `public` 存储许可 → `Ignore`。
fn classify(
    query: Option<&BTreeMap<String, String>>,
    cache_control: Option<&str>,
    status: u16,
    body: &serde_json::Value,
) -> PublicVerdict {
    let Some(query) = query else {
        return PublicVerdict::Ignore;
    };
    let single_id = query.get("id").filter(|id| !id.is_empty());

    // 撤回信号不受存储许可约束——失效处理不是「把响应存起来」。
    if let Some(id) = single_id {
        if status == 404 && body.get("success") == Some(&serde_json::Value::Bool(false)) {
            return PublicVerdict::Withdraw(id.clone());
        }
    }
    if !cache_permits_storage(cache_control) {
        return PublicVerdict::Ignore;
    }

    if let Some(id) = single_id {
        if status != 200 {
            return PublicVerdict::Ignore;
        }
        let Some(card) = body.get("card").and_then(|v| v.as_object()) else {
            return PublicVerdict::Ignore;
        };
        return match project_card(id, card) {
            Some(item) => PublicVerdict::Card(item),
            None => PublicVerdict::Ignore,
        };
    }

    if query.get("view").map(String::as_str) == Some("summary") && status == 200 {
        if body.get("success") != Some(&serde_json::Value::Bool(true)) {
            return PublicVerdict::Ignore;
        }
        let Some(cards) = body.get("cards").and_then(|v| v.as_array()) else {
            return PublicVerdict::Ignore;
        };
        let mut items = Vec::with_capacity(cards.len());
        let mut invalid = 0u64;
        for card in cards {
            match project_summary(card) {
                Some(item) => items.push(item),
                // 单条投影失败不否决整页——坏条目被跳过，好条目照常缓存。
                None => invalid += 1,
            }
        }
        return PublicVerdict::Summaries(items, invalid);
    }
    PublicVerdict::Ignore
}

/* ── 写盘路径 ──────────────────────────────────────────────────────────── */

#[derive(Debug)]
struct Failure;

impl From<()> for Failure {
    fn from(_: ()) -> Self {
        Failure
    }
}

type CacheResult<T> = Result<T, Failure>;

struct ExistingRow {
    revision: i64,
    summary_json: Option<String>,
    card_json: Option<String>,
    row_bytes: i64,
    /// 摘要写入必须保留的旧正文版本提示——「新摘要不得给旧正文盖新章」。
    body_updated_at: Option<String>,
    first_captured_at: String,
}

fn read_row(conn: &Connection, scope: &str, card_id: &str) -> CacheResult<Option<ExistingRow>> {
    conn.query_row(
        "SELECT revision, summary_json, card_json, row_bytes,
                body_updated_at, first_captured_at
         FROM cards WHERE card_id = ?1 AND source_scope = ?2",
        params![card_id, scope],
        |row| {
            Ok(ExistingRow {
                revision: row.get(0)?,
                summary_json: row.get(1)?,
                card_json: row.get(2)?,
                row_bytes: row.get(3)?,
                body_updated_at: row.get(4)?,
                first_captured_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|_| Failure)
}

fn total_usage(conn: &Connection) -> CacheResult<u64> {
    conn.query_row("SELECT COALESCE(SUM(row_bytes), 0) FROM cards", [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|value| value.max(0) as u64)
    .map_err(|_| Failure)
}

fn merge_summary_json(
    old: Option<&str>,
    new: &serde_json::Map<String, serde_json::Value>,
) -> String {
    let mut merged = old
        .and_then(|text| {
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(text).ok()
        })
        .unwrap_or_default();
    for (key, value) in new {
        merged.insert(key.clone(), value.clone());
    }
    serde_json::to_string(&serde_json::Value::Object(merged)).unwrap_or_else(|_| "{}".to_string())
}

fn serialize_projection(projection: &serde_json::Map<String, serde_json::Value>) -> String {
    serde_json::to_string(&serde_json::Value::Object(projection.clone()))
        .unwrap_or_else(|_| "{}".to_string())
}

struct BuiltRow {
    card_id: String,
    scope: String,
    summary_json: String,
    card_json: Option<String>,
    summary_updated_at: Option<String>,
    body_updated_at: Option<String>,
    first_captured_at: String,
    row_bytes: u64,
    summary_bytes: u64,
    body_bytes: u64,
}

/// 由捕获条目与现有行计算新行状态。
///
/// 摘要/正文分开记账：摘要写入不动 `card_json` 与 `body_updated_at`——
/// 新摘要不得把旧正文伪装成新版本（`DESK-CACHE-005` 的版本口径）。
fn build_row(
    scope: &str,
    item: &CaptureItem,
    existing: Option<&ExistingRow>,
    now: &str,
) -> BuiltRow {
    let summary_json = match &item.card {
        // 正文响应：其贡献的摘要键与既有摘要归并（response 里没有的派生键
        // ——roleType/nativeAllowed 等——保留旧值，不被清空）。
        Some(_) => merge_summary_json(
            existing.and_then(|r| r.summary_json.as_deref()),
            &item.summary,
        ),
        // 摘要响应：服务端当前真相，整体替换。
        None => serialize_projection(&item.summary),
    };
    let (card_json, body_updated_at) = match &item.card {
        Some(card) => (Some(serialize_projection(card)), item.updated_at.clone()),
        None => (
            existing.and_then(|r| r.card_json.clone()),
            existing.and_then(|r| r.body_updated_at.clone()),
        ),
    };
    let summary_bytes = summary_json.len() as u64;
    let body_bytes = card_json.as_ref().map_or(0, |json| json.len() as u64);
    BuiltRow {
        card_id: item.card_id.clone(),
        scope: scope.to_string(),
        summary_json,
        card_json,
        summary_updated_at: item.updated_at.clone(),
        body_updated_at,
        first_captured_at: existing
            .map_or_else(|| now.to_string(), |r| r.first_captured_at.clone()),
        row_bytes: summary_bytes + body_bytes + ROW_OVERHEAD_BYTES,
        summary_bytes,
        body_bytes,
    }
}

fn write_row(conn: &Connection, row: &BuiltRow, revision: i64, now: &str) -> CacheResult<()> {
    conn.execute(
        "INSERT INTO cards (
            card_id, source_scope, availability, revision,
            summary_json, card_json, summary_bytes, body_bytes, row_bytes,
            summary_updated_at, body_updated_at,
            first_captured_at, last_success_at, last_attempt_at, last_used_at
        ) VALUES (?1, ?2, 'known', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12)
        ON CONFLICT(card_id, source_scope) DO UPDATE SET
            availability = 'known',
            revision = excluded.revision,
            summary_json = excluded.summary_json,
            card_json = excluded.card_json,
            summary_bytes = excluded.summary_bytes,
            body_bytes = excluded.body_bytes,
            row_bytes = excluded.row_bytes,
            summary_updated_at = excluded.summary_updated_at,
            body_updated_at = excluded.body_updated_at,
            last_success_at = excluded.last_success_at,
            last_attempt_at = excluded.last_attempt_at,
            last_used_at = excluded.last_used_at",
        params![
            row.card_id,
            row.scope,
            revision,
            row.summary_json,
            row.card_json,
            row.summary_bytes as i64,
            row.body_bytes as i64,
            row.row_bytes as i64,
            row.summary_updated_at,
            row.body_updated_at,
            row.first_captured_at,
            now,
        ],
    )
    .map_err(|_| Failure)?;
    Ok(())
}

/// 满额 LRU 淘汰：只回收 `availability='known'` 的条目（撤回占位不是可回收
/// 内容），跳过本批次将要写的卡——否则会出现「刚腾出空间又被自己写回」的
/// 空转。返回回收的字节数。
fn evict_lru(conn: &Connection, need: u64, exclude: &BTreeSet<String>) -> CacheResult<u64> {
    let mut stmt = conn
        .prepare(
            "SELECT card_id, source_scope, row_bytes FROM cards
             WHERE availability = 'known'
             ORDER BY COALESCE(last_used_at, '') ASC, card_id ASC",
        )
        .map_err(|_| Failure)?;
    let candidates: Vec<(String, String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|_| Failure)?
        .collect::<Result<_, _>>()
        .map_err(|_| Failure)?;
    drop(stmt);

    let mut freed = 0u64;
    for (card_id, scope, bytes) in candidates {
        if freed >= need {
            break;
        }
        if exclude.contains(&card_id) {
            continue;
        }
        conn.execute(
            "DELETE FROM cards WHERE card_id = ?1 AND source_scope = ?2",
            params![card_id, scope],
        )
        .map_err(|_| Failure)?;
        freed += bytes as u64;
    }
    Ok(freed)
}

fn commit_captures(
    conn: &mut Connection,
    scope: &str,
    items: Vec<CaptureItem>,
    invalid_skipped: u64,
    ticket: &ObserveTicket,
    policy: &PublicCachePolicyDto,
    now: &str,
) -> CacheResult<CacheOutcome> {
    let tx = conn.transaction().map_err(|_| Failure)?;
    if meta_i64(&tx, META_WRITE_EPOCH)? != ticket.epoch {
        // 清理/禁用捕获发生在请求在途期间——整批丢弃，不回填旧证据。
        return Ok(CacheOutcome::simple(CacheOutcomeKind::Stale));
    }

    let mut usage = total_usage(&tx)?;
    let batch_ids: BTreeSet<String> = items.iter().map(|item| item.card_id.clone()).collect();
    let mut captured = 0u64;
    let mut skipped = invalid_skipped;
    let mut stale_skip = false;
    let mut budget_skip = false;
    let mut write_seq: Option<i64> = None;

    for item in &items {
        let existing = read_row(&tx, scope, &item.card_id)?;
        if let Some(row) = &existing {
            if row.revision > ticket.mutation_seq {
                // 行在请求发出后被更新的证据改写（更新的捕获或撤回标记）。
                skipped += 1;
                stale_skip = true;
                continue;
            }
        }
        let built = build_row(scope, item, existing.as_ref(), now);
        if let CacheBudget::Limited(budget) = policy.max_bytes {
            if built.row_bytes > budget {
                // 单条记录超过整个预算：拒绝写入而不是清空缓存去迁就它。
                skipped += 1;
                budget_skip = true;
                continue;
            }
            let delta = built
                .row_bytes
                .saturating_sub(existing.map_or(0, |r| r.row_bytes as u64));
            if delta > 0 && usage.saturating_add(delta) > budget {
                match policy.when_full {
                    CacheWhenFull::EvictLeastRecentlyUsed => {
                        let need = usage + delta - budget;
                        let freed = evict_lru(&tx, need, &batch_ids)?;
                        usage = usage.saturating_sub(freed);
                        if usage.saturating_add(delta) > budget {
                            skipped += 1;
                            budget_skip = true;
                            continue;
                        }
                    }
                    CacheWhenFull::Pause => {
                        skipped += 1;
                        budget_skip = true;
                        continue;
                    }
                }
            }
            usage = usage.saturating_add(delta);
        }

        let seq = match write_seq {
            Some(seq) => seq,
            None => {
                let seq = bump_meta(&tx, META_MUTATION_SEQ)?;
                write_seq = Some(seq);
                seq
            }
        };
        write_row(&tx, &built, seq, now)?;
        captured += 1;
    }
    tx.commit().map_err(|_| Failure)?;

    let kind = if captured > 0 {
        if skipped > 0 {
            CacheOutcomeKind::Partial
        } else {
            CacheOutcomeKind::Captured
        }
    } else if skipped == 0 {
        CacheOutcomeKind::Captured
    } else if stale_skip && !budget_skip {
        CacheOutcomeKind::Stale
    } else {
        CacheOutcomeKind::Paused
    };
    Ok(CacheOutcome {
        outcome: kind,
        captured,
        skipped,
    })
}

/// 业务确认撤回：把卡移出公开可见/可选集合并清掉缓存正文，保留最小失效
/// 信息（行本身 + availability 标记）——既阻止更旧的响应把它复活，也让
/// 「这张卡曾经公开、后来撤回了」这个事实可诊断。
fn withdraw_card(
    conn: &mut Connection,
    scope: &str,
    card_id: &str,
    ticket: &ObserveTicket,
    now: &str,
) -> CacheResult<CacheOutcome> {
    let tx = conn.transaction().map_err(|_| Failure)?;
    if meta_i64(&tx, META_WRITE_EPOCH)? != ticket.epoch {
        return Ok(CacheOutcome::simple(CacheOutcomeKind::Stale));
    }
    if let Some(row) = read_row(&tx, scope, card_id)? {
        if row.revision > ticket.mutation_seq {
            // 已有更新的证据（更新的成功读取）——404 是迟到的旧响应。
            return Ok(CacheOutcome::simple(CacheOutcomeKind::Stale));
        }
    }
    let seq = bump_meta(&tx, META_MUTATION_SEQ)?;
    tx.execute(
        "INSERT INTO cards (
            card_id, source_scope, availability, revision,
            summary_json, card_json, summary_bytes, body_bytes, row_bytes,
            summary_updated_at, body_updated_at,
            first_captured_at, last_success_at, last_attempt_at, last_used_at
        ) VALUES (?1, ?2, 'withdrawn', ?3, NULL, NULL, 0, 0, ?4, NULL, NULL, ?5, NULL, ?5, NULL)
        ON CONFLICT(card_id, source_scope) DO UPDATE SET
            availability = 'withdrawn',
            revision = excluded.revision,
            summary_json = NULL,
            card_json = NULL,
            summary_bytes = 0,
            body_bytes = 0,
            row_bytes = excluded.row_bytes,
            summary_updated_at = NULL,
            body_updated_at = NULL,
            last_attempt_at = excluded.last_attempt_at",
        params![card_id, scope, seq, ROW_OVERHEAD_BYTES as i64, now],
    )
    .map_err(|_| Failure)?;
    tx.commit().map_err(|_| Failure)?;
    Ok(CacheOutcome::simple(CacheOutcomeKind::Withdrawn))
}

fn query_stats(conn: &Connection) -> CacheResult<PublicCacheStats> {
    conn.query_row(
        "SELECT COALESCE(SUM(row_bytes), 0),
                COUNT(*),
                COALESCE(SUM(CASE WHEN summary_json IS NOT NULL THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN card_json IS NOT NULL THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN availability = 'withdrawn' THEN 1 ELSE 0 END), 0)
         FROM cards",
        [],
        |row| {
            Ok(PublicCacheStats {
                status: "ready",
                path: String::new(),
                usage_bytes: row.get::<_, i64>(0)?.max(0) as u64,
                entry_count: row.get::<_, i64>(1)?.max(0) as u64,
                summary_count: row.get::<_, i64>(2)?.max(0) as u64,
                body_count: row.get::<_, i64>(3)?.max(0) as u64,
                withdrawn_count: row.get::<_, i64>(4)?.max(0) as u64,
                applied_policy: PublicCachePolicyDto::default(),
            })
        },
    )
    .map_err(|_| Failure)
}

/* ── 测试 ──────────────────────────────────────────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    const SCOPE: &str = "https://mahoshojo.example.test";
    const PUBLIC_CC: &str = "public, max-age=15";

    fn scratch(label: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-public-cache-{label}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create scratch dir");
        root
    }

    fn summary_query() -> BTreeMap<String, String> {
        BTreeMap::from([("view".to_string(), "summary".to_string())])
    }

    fn single_query(id: &str) -> BTreeMap<String, String> {
        BTreeMap::from([("id".to_string(), id.to_string())])
    }

    fn summary_item(id: &str, name: &str, updated_at: &str) -> serde_json::Value {
        json!({
            "id": id,
            "user_id": 1,
            "type": "character",
            "name": name,
            "description": "desc",
            "is_public": 1,
            "review_status": "approved",
            "created_at": "2026-10-01T00:00:00Z",
            "updated_at": updated_at,
            "usage_count": 5,
            "like_count": 2,
            "favorite_count": 1,
            "is_recommended": 0,
            "username": "author",
            "roleType": "magical-girl",
            "nativeAllowed": true,
            "has_pending_update": false,
            "tag_ids": ["t1"],
            "favorited_at": null,
            "isLegacyQuestionnaire": false
        })
    }

    fn summary_page(cards: Vec<serde_json::Value>) -> serde_json::Value {
        json!({ "success": true, "cards": cards, "total": cards.len(), "nextOffset": null })
    }

    fn single_card(id: &str, data: &str, updated_at: &str) -> serde_json::Value {
        json!({
            "success": true,
            "card": {
                "id": id,
                "user_id": 1,
                "type": "character",
                "name": "card-name",
                "description": "desc",
                "data": data,
                "is_public": 1,
                "public_since": "2026-10-01T00:00:00Z",
                "review_status": "approved",
                "is_recommended": 0,
                "usage_count": 5,
                "like_count": 2,
                "favorite_count": 1,
                "created_at": "2026-10-01T00:00:00Z",
                "updated_at": updated_at,
                "deleted_at": null,
                "username": "author",
                "tag_ids": ["t1"],
                "tagIds": ["t1"]
            }
        })
    }

    fn observe(
        cache: &PublicReadCache,
        query: &BTreeMap<String, String>,
        cache_control: Option<&str>,
        status: u16,
        body: &serde_json::Value,
    ) -> CacheOutcome {
        let ticket = cache.begin_observe().expect("ticket");
        cache.observe_response(&ticket, SCOPE, Some(query), cache_control, status, body)
    }

    /// 直接开第二个只读连接查行（WAL 允许多连接）。
    fn open_row(
        root: &Path,
        scope: &str,
        card_id: &str,
    ) -> Option<(String, Option<String>, Option<String>)> {
        let conn = Connection::open(root.join(PUBLIC_READ_CACHE_FILE)).expect("open cache file");
        conn.query_row(
            "SELECT availability, summary_json, card_json FROM cards
             WHERE card_id = ?1 AND source_scope = ?2",
            params![card_id, scope],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .expect("read row")
    }

    fn read_versions(root: &Path, card_id: &str) -> (Option<String>, Option<String>) {
        let conn = Connection::open(root.join(PUBLIC_READ_CACHE_FILE)).expect("open cache file");
        conn.query_row(
            "SELECT summary_updated_at, body_updated_at FROM cards
             WHERE card_id = ?1 AND source_scope = ?2",
            params![card_id, SCOPE],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .expect("read versions")
        .unwrap_or((None, None))
    }

    fn set_field(item: &mut serde_json::Value, key: &str, value: serde_json::Value) {
        item.as_object_mut().unwrap().insert(key.to_string(), value);
    }

    fn remove_field(item: &mut serde_json::Value, key: &str) {
        item.as_object_mut().unwrap().remove(key);
    }

    #[test]
    fn opens_lazily_and_migrates_idempotently() {
        let root = scratch("lazy-open");
        let cache = PublicReadCache::at(&root);
        // 未产生任何公开读取前：统计必须是 empty，且不得造文件。
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.status, "empty");
        assert!(!root.join(PUBLIC_READ_CACHE_FILE).exists());

        let ticket = cache.begin_observe().expect("first observe creates the db");
        assert!(root.join(PUBLIC_READ_CACHE_FILE).exists());
        assert!(ticket.epoch >= 1 && ticket.mutation_seq >= 1);

        let stats = cache.stats().expect("stats after open");
        assert_eq!(stats.status, "ready");
        drop(cache);
        // 模拟重启再开：迁移幂等，计数器不回退。
        let cache2 = PublicReadCache::at(&root);
        let ticket2 = cache2.begin_observe().expect("reopen");
        assert!(ticket2.epoch >= ticket.epoch);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unsupported_schema_disables_cache_without_touching_file() {
        let root = scratch("future-schema");
        {
            let cache = PublicReadCache::at(&root);
            cache.begin_observe().expect("initial open");
        }
        // 模拟「更新版本的应用」把 user_version 写到未来。
        let conn = Connection::open(root.join(PUBLIC_READ_CACHE_FILE)).expect("open");
        conn.execute_batch("PRAGMA user_version = 99")
            .expect("bump version");
        drop(conn);

        let cache = PublicReadCache::at(&root);
        assert!(cache.begin_observe().is_none());
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.status, "unsupported-schema");
        // 文件内容未被本进程改写：版本仍是 99。
        let conn = Connection::open(root.join(PUBLIC_READ_CACHE_FILE)).expect("reopen raw");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 99);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn captures_summary_page_and_single_card_with_projection() {
        let root = scratch("capture");
        let cache = PublicReadCache::at(&root);
        let mut item_a = summary_item("card-a", "Alpha", "2026-10-02T00:00:00Z");
        set_field(&mut item_a, "viewerSecret", json!("must-not-persist"));
        set_field(&mut item_a, "favorited_at", json!("2026-10-03T00:00:00Z"));
        let page = summary_page(vec![
            item_a,
            summary_item("card-b", "Beta", "2026-10-02T00:00:00Z"),
        ]);

        let outcome = observe(&cache, &summary_query(), Some(PUBLIC_CC), 200, &page);
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        assert_eq!(outcome.captured, 2);

        let (availability, summary, card) = open_row(&root, SCOPE, "card-a").expect("row a");
        assert_eq!(availability, "known");
        assert!(card.is_none(), "只有摘要时不得声称正文可用");
        let parsed: serde_json::Value = serde_json::from_str(&summary.unwrap()).unwrap();
        let obj = parsed.as_object().unwrap();
        assert_eq!(obj["name"], json!("Alpha"));
        assert!(obj.get("viewerSecret").is_none(), "非白名单字段不得落盘");
        assert!(obj.get("favorited_at").is_none(), "账号关系字段不得落盘");

        let outcome = observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            200,
            &single_card("card-a", "{\"k\":1}", "2026-10-03T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        let (_, _, card) = open_row(&root, SCOPE, "card-a").expect("row a");
        let card_json: serde_json::Value = serde_json::from_str(&card.expect("body")).unwrap();
        assert_eq!(card_json["data"], json!("{\"k\":1}"));
        assert!(card_json.get("deleted_at").is_none(), "软删字段不得落盘");

        let stats = cache.stats().expect("stats");
        assert_eq!(stats.status, "ready");
        assert_eq!(stats.summary_count, 2);
        assert_eq!(stats.body_count, 1);
        assert!(stats.usage_bytes > 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_non_public_or_degenerate_projections() {
        let root = scratch("projection-gate");
        let cache = PublicReadCache::at(&root);
        for mut item in [
            summary_item("p", "n", "2026-10-02T00:00:00Z"),
            summary_item("p2", "n", "2026-10-02T00:00:00Z"),
            summary_item("p3", "n", "2026-10-02T00:00:00Z"),
        ] {
            match item["id"].as_str().unwrap() {
                "p" => set_field(&mut item, "is_public", json!(0)),
                "p2" => remove_field(&mut item, "is_public"),
                _ => remove_field(&mut item, "name"),
            }
            let outcome = observe(
                &cache,
                &summary_query(),
                Some(PUBLIC_CC),
                200,
                &summary_page(vec![item]),
            );
            assert_eq!(outcome.captured, 0);
            assert_eq!(outcome.skipped, 1);
        }
        // 单卡响应 id 与请求不一致 → 不得按响应里的 id 落盘。
        let outcome = observe(
            &cache,
            &single_query("card-x"),
            Some(PUBLIC_CC),
            200,
            &single_card("card-y", "{}", "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Ignored);
        // 非字符串 data（私有形状或损坏）不落盘。
        let mut card = single_card("card-x", "{}", "2026-10-02T00:00:00Z");
        card["card"]["data"] = json!({"structured": true});
        let outcome = observe(&cache, &single_query("card-x"), Some(PUBLIC_CC), 200, &card);
        assert_eq!(outcome.outcome, CacheOutcomeKind::Ignored);
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.entry_count, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn storage_permission_gates_everything() {
        let root = scratch("cache-control");
        let cache = PublicReadCache::at(&root);
        let page = summary_page(vec![summary_item("card-a", "A", "2026-10-02T00:00:00Z")]);
        for header in [
            None,
            Some("no-store"),
            Some("private, max-age=10"),
            Some("no-cache"),
            Some("public, no-store"),
            Some("max-age=15"),
        ] {
            let outcome = observe(&cache, &summary_query(), header, 200, &page);
            assert_eq!(
                outcome.outcome,
                CacheOutcomeKind::Ignored,
                "header={header:?} 不得写入"
            );
        }
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.entry_count, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn business_404_withdraws_but_service_errors_do_not() {
        let root = scratch("withdrawal");
        let cache = PublicReadCache::at(&root);
        observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            200,
            &single_card("card-a", "{}", "2026-10-02T00:00:00Z"),
        );
        // 503 / 401 不是撤回信号。
        for (status, body) in [
            (503u16, json!({"success": false, "error": "maintenance"})),
            (401u16, json!({"success": false, "error": "unauthorized"})),
        ] {
            let outcome = observe(
                &cache,
                &single_query("card-a"),
                Some(PUBLIC_CC),
                status,
                &body,
            );
            assert_ne!(outcome.outcome, CacheOutcomeKind::Withdrawn);
            let (availability, _, card) = open_row(&root, SCOPE, "card-a").unwrap();
            assert_eq!(availability, "known", "status={status} 不得撤回");
            assert!(card.is_some());
        }
        // 业务级 404：正文清掉、保留失效占位。
        let outcome = observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            404,
            &json!({"success": false}),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Withdrawn);
        let (availability, summary, card) = open_row(&root, SCOPE, "card-a").unwrap();
        assert_eq!(availability, "withdrawn");
        assert!(summary.is_none() && card.is_none());
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.withdrawn_count, 1);
        assert_eq!(stats.body_count, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stale_responses_cannot_resurrect_after_clear_or_withdrawal() {
        let root = scratch("fencing");
        let cache = PublicReadCache::at(&root);
        observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            200,
            &single_card("card-a", "v1", "2026-10-02T00:00:00Z"),
        );

        // 在途响应早于「撤回」：撤回先落盘，迟到的旧成功响应不得复活正文。
        let stale_ticket = cache.begin_observe().expect("stale ticket");
        let fresh_ticket = cache.begin_observe().expect("fresh ticket");
        let outcome = cache.observe_response(
            &fresh_ticket,
            SCOPE,
            Some(&single_query("card-a")),
            Some(PUBLIC_CC),
            404,
            &json!({"success": false}),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Withdrawn);
        cache.observe_response(
            &stale_ticket,
            SCOPE,
            Some(&single_query("card-a")),
            Some(PUBLIC_CC),
            200,
            &single_card("card-a", "v1", "2026-10-02T00:00:00Z"),
        );
        let (availability, _, card) = open_row(&root, SCOPE, "card-a").unwrap();
        assert_eq!(availability, "withdrawn", "stale 响应不得复活撤回标记");
        assert!(card.is_none());

        // 清理后的在途响应：不得回填。
        let stale_ticket = cache.begin_observe().expect("stale ticket 2");
        let cleared = cache.clear().expect("clear");
        assert!(cleared.removed_entries >= 1);
        let outcome = cache.observe_response(
            &stale_ticket,
            SCOPE,
            Some(&single_query("card-b")),
            Some(PUBLIC_CC),
            200,
            &single_card("card-b", "v1", "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Stale);
        assert!(
            open_row(&root, SCOPE, "card-b").is_none(),
            "清理后 stale 不得回填"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn fresh_fetch_can_republish_a_withdrawn_card() {
        let root = scratch("republish");
        let cache = PublicReadCache::at(&root);
        observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            404,
            &json!({"success": false}),
        );
        assert_eq!(open_row(&root, SCOPE, "card-a").unwrap().0, "withdrawn");
        // 撤回之后到达的新响应（新票据）可以把它带回——那是真实的新证据。
        let outcome = observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            200,
            &single_card("card-a", "v2", "2026-10-05T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        let (availability, _, card) = open_row(&root, SCOPE, "card-a").unwrap();
        assert_eq!(availability, "known");
        assert!(card.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn disabled_capture_blocks_positive_writes_but_not_withdrawal() {
        let root = scratch("disabled");
        let cache = PublicReadCache::at(&root);
        cache
            .apply_policy(PublicCachePolicyDto {
                capture_enabled: false,
                max_bytes: CacheBudget::Limited(DEFAULT_BUDGET_BYTES),
                when_full: CacheWhenFull::Pause,
            })
            .expect("apply policy");
        let outcome = observe(
            &cache,
            &summary_query(),
            Some(PUBLIC_CC),
            200,
            &summary_page(vec![summary_item("a", "A", "2026-10-02T00:00:00Z")]),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Disabled);
        assert!(open_row(&root, SCOPE, "a").is_none());
        // 撤回失效处理不受捕获开关影响。
        let outcome = observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            404,
            &json!({"success": false}),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Withdrawn);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pause_policy_keeps_existing_and_rejects_growth() {
        let root = scratch("pause-budget");
        let cache = PublicReadCache::at(&root);
        // 默认 256 MiB 预算放宽前先模拟「已满」：1 MiB 预算放得下一张
        // ~700 KiB 的卡，放不下两张 → 第二张必须被拒。
        cache
            .apply_policy(PublicCachePolicyDto {
                capture_enabled: true,
                max_bytes: CacheBudget::Limited(MIN_BUDGET_BYTES),
                when_full: CacheWhenFull::Pause,
            })
            .expect("apply policy");
        let payload = "x".repeat(700 * 1024);
        let first = observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", &payload, "2026-10-02T00:00:00Z"),
        );
        assert_eq!(first.outcome, CacheOutcomeKind::Captured);
        let second = observe(
            &cache,
            &single_query("b"),
            Some(PUBLIC_CC),
            200,
            &single_card("b", &payload, "2026-10-02T00:00:00Z"),
        );
        assert_eq!(second.outcome, CacheOutcomeKind::Paused);
        assert!(
            open_row(&root, SCOPE, "a").is_some(),
            "满额暂停不得淘汰旧数据"
        );
        assert!(open_row(&root, SCOPE, "b").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn evict_mode_reclaims_least_recently_used_only_as_needed() {
        let root = scratch("evict");
        let cache = PublicReadCache::at(&root);
        cache
            .apply_policy(PublicCachePolicyDto {
                capture_enabled: true,
                max_bytes: CacheBudget::Limited(2 * 1024 * 1024),
                when_full: CacheWhenFull::EvictLeastRecentlyUsed,
            })
            .expect("apply evict policy");
        let payload = "x".repeat(800 * 1024);
        for id in ["a", "b"] {
            let outcome = observe(
                &cache,
                &single_query(id),
                Some(PUBLIC_CC),
                200,
                &single_card(id, &payload, "2026-10-02T00:00:00Z"),
            );
            assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        }
        // 让 LRU 顺序确定：a 最旧。
        {
            let conn = Connection::open(root.join(PUBLIC_READ_CACHE_FILE)).unwrap();
            conn.execute(
                "UPDATE cards SET last_used_at = '2026-10-01T00:00:00Z' WHERE card_id = 'a'",
                [],
            )
            .unwrap();
        }
        let outcome = observe(
            &cache,
            &single_query("c"),
            Some(PUBLIC_CC),
            200,
            &single_card("c", &payload, "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        assert!(open_row(&root, SCOPE, "a").is_none(), "最久未使用先回收");
        assert!(open_row(&root, SCOPE, "b").is_some());
        assert!(open_row(&root, SCOPE, "c").is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn single_record_over_budget_is_rejected_not_drained() {
        let root = scratch("whale");
        let cache = PublicReadCache::at(&root);
        cache
            .apply_policy(PublicCachePolicyDto {
                capture_enabled: true,
                max_bytes: CacheBudget::Limited(MIN_BUDGET_BYTES),
                when_full: CacheWhenFull::EvictLeastRecentlyUsed,
            })
            .expect("apply policy");
        let outcome = observe(
            &cache,
            &single_query("whale"),
            Some(PUBLIC_CC),
            200,
            &single_card(
                "whale",
                &"x".repeat(2 * 1024 * 1024),
                "2026-10-02T00:00:00Z",
            ),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Paused);
        assert_eq!(outcome.skipped, 1);
        assert!(open_row(&root, SCOPE, "whale").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn newer_summary_does_not_relabel_the_old_body() {
        let root = scratch("version-split");
        let cache = PublicReadCache::at(&root);
        observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", "body-v1", "2026-10-02T00:00:00Z"),
        );
        // 稍后摘要页显示服务端已有 T3 版本，但正文刷新还没成功：
        // 缓存必须仍按「摘要 T3 / 正文 T1」记账。
        let outcome = observe(
            &cache,
            &summary_query(),
            Some(PUBLIC_CC),
            200,
            &summary_page(vec![summary_item("a", "A-renamed", "2026-10-03T00:00:00Z")]),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        let (summary_at, body_at) = read_versions(&root, "a");
        assert_eq!(summary_at.as_deref(), Some("2026-10-03T00:00:00Z"));
        assert_eq!(body_at.as_deref(), Some("2026-10-02T00:00:00Z"));
        let (_, _, card) = open_row(&root, SCOPE, "a").unwrap();
        let card_json: serde_json::Value = serde_json::from_str(&card.unwrap()).unwrap();
        assert_eq!(card_json["data"], json!("body-v1"), "旧正文必须原样保留");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn policy_deserialization_rejects_bad_budget_and_strategy() {
        for raw in [
            r#"{"captureEnabled":true,"maxBytes":0,"whenFull":"pause"}"#,
            r#"{"captureEnabled":true,"maxBytes":"512MiB","whenFull":"pause"}"#,
            r#"{"captureEnabled":true,"maxBytes":"unlimited","whenFull":"evict"}"#,
            r#"{"captureEnabled":true,"maxBytes":268435456,"whenFull":"pause","path":"/tmp/x"}"#,
        ] {
            assert!(
                serde_json::from_str::<PublicCachePolicyDto>(raw).is_err(),
                "{raw} 必须被拒"
            );
        }
        assert!(serde_json::from_str::<PublicCachePolicyDto>(
            r#"{"captureEnabled":true,"maxBytes":"unlimited","whenFull":"pause"}"#
        )
        .is_ok());
    }

    #[test]
    fn source_scope_keeps_origins_separate() {
        let root = scratch("scopes");
        let cache = PublicReadCache::at(&root);
        let ticket = cache.begin_observe().expect("ticket");
        let outcome = cache.observe_response(
            &ticket,
            "https://other-origin.example.test",
            Some(&single_query("a")),
            Some(PUBLIC_CC),
            200,
            &single_card("a", "{}", "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        assert!(open_row(&root, "https://other-origin.example.test", "a").is_some());
        assert!(open_row(&root, SCOPE, "a").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn clear_reports_counts_and_empties_the_cache() {
        let root = scratch("clear");
        let cache = PublicReadCache::at(&root);
        observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", &"x".repeat(4096), "2026-10-02T00:00:00Z"),
        );
        let result = cache.clear().expect("clear");
        assert_eq!(result.removed_entries, 1);
        assert!(result.freed_bytes > 4096);
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.entry_count, 0);
        assert_eq!(stats.usage_bytes, 0);
        let _ = std::fs::remove_dir_all(&root);
    }
}
