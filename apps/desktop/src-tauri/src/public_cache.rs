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

/// `?id=` 单卡 404 响应里确认「业务级不可用」的稳定错误码
/// （`DESK-CACHE-006`：可识别业务响应才允许撤回，任意 404 不算）。
/// 由 `/api/public-data-cards` 回写 `code` 字段，与
/// `fixtures/desktop-cloud.json` 的 `publicReadCache.withdrawalErrorCode`
/// 同源对拍。
pub const WITHDRAWAL_ERROR_CODE: &str = "PUBLIC_DATA_CARD_NOT_FOUND";

/// 撤回失效占位的容量边界：它不参与 LRU 淘汰也不是可回收内容，因此
/// 数量本身必须受限——超出上限时只回收最旧的失效标记，不动任何正缓存
/// 记录（`DESK-CACHE-003`「负缓存限量回收，不据此回收旧正卡」）。
const MAX_WITHDRAWN_MARKERS: i64 = 1024;

/// 写盘失败后的熔断窗口：窗口内正/负写入直接报告 `unavailable`，不让
/// 每次公开请求都重撞同一个磁盘错误（`DESK-CACHE-003`：IO 失败暂停增长，
/// 不靠无限重试占满磁盘）。`clear`/stats 不受限——用户显式重试随时可行。
const WRITE_FAILURE_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(30);

/* ── 公开投影白名单（fixture `cardLibrary.publicReadCache` 镜像） ──────── */

/// 摘要响应允许持久化的字段。账号关系字段（`favorited_at` 等）刻意不在内：
/// 公开源里它们恒为 null，但白名单保证即使服务端变化它们也进不了缓存。
/// `pub(crate)`：cloud.rs 的 fixture 对拍测试直接引用这份名单。
pub(crate) const SUMMARY_FIELDS: &[&str] = &[
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
pub(crate) const CARD_FIELDS: &[&str] = &[
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
    /// 进程内初始态是「策略尚未确认」，不是配置默认值：config.json 读取
    /// 与 renderer 策略推送完成之前一律暂停正缓存（`DESK-CACHE-008` 的
    /// 降级姿态）。否则「用户已关闭捕获」或「配置损坏需降级」时，启动到
    /// 首次推送之间会留下一段按默认开启捕获的窗口。renderer 首次推送
    /// 后这里的内容即被覆盖。
    fn default() -> Self {
        Self {
            capture_enabled: false,
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
    /// 最近一次写盘失败的熔断截止时刻；窗口内需要写盘的捕获/撤回直接
    /// 报告 `unavailable` 而不重撞同一磁盘错误。`clear` 成功后复位。
    write_cooldown_until: Option<std::time::Instant>,
}

/// native 侧共享状态本体：`Mutex` 保证单连接单写者。
#[derive(Debug)]
struct PublicReadCacheShared {
    path: PathBuf,
    inner: Mutex<CacheInner>,
}

/// 一次在途公开请求拿到的并发快照。见模块头的 epoch/revision 说明。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObserveTicket {
    epoch: i64,
    mutation_seq: i64,
}

/// Tauri managed state：固定路径 + 进程内唯一互斥——单连接单写者。
/// `Clone` 是 `Arc` 级共享：异步云端通路克隆一个句柄进
/// `spawn_blocking`，与命令面看到的是同一份连接与策略。
#[derive(Clone)]
pub struct PublicReadCache {
    shared: std::sync::Arc<PublicReadCacheShared>,
}

impl PublicReadCache {
    /// `data_root` 由 native 在 setup 产生；这里只负责拼固定文件名。
    pub fn at(data_root: &Path) -> Self {
        Self {
            shared: std::sync::Arc::new(PublicReadCacheShared {
                path: data_root.join(PUBLIC_READ_CACHE_FILE),
                inner: Mutex::new(CacheInner {
                    conn: ConnState::Closed,
                    policy: PublicCachePolicyDto::default(),
                    write_cooldown_until: None,
                }),
            }),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, CacheInner>, PublicCacheError> {
        self.shared
            .inner
            .lock()
            .map_err(|_| PublicCacheError::new(PublicCacheErrorCode::InternalError, "缓存锁已中毒"))
    }

    /// `public_read_cache_apply_policy`：登记当前生效策略。
    ///
    /// `captureEnabled` 任一方向的转换都推进 `write_epoch`：禁用使「禁用
    /// 窗口前发出的响应」失效；启用同样使「禁用/未确认窗口内发出的响应」
    /// 失效——它们是在捕获关闭的世界里取得的票据，不能在重新开启后悄悄
    /// 回填。关闭期间必要的撤回失效处理仍允许（`captureEnabled` 只暂停
    /// 正缓存，不暂停失效）。
    ///
    /// epoch 推进失败不再静默：连接随即标记为不可用并返回错误——宁可让
    /// 缓存降级，也不能让「在途隔离已生效」变成一个无法验证的假设。
    pub fn apply_policy(&self, policy: PublicCachePolicyDto) -> Result<(), PublicCacheError> {
        let mut inner = self.lock()?;
        let transition = inner.policy.capture_enabled != policy.capture_enabled;
        inner.policy = policy;
        if transition {
            // 库还没开过 ⇒ 没有任何在途 ticket，bump 无从谈起。
            let bump_failed = match &inner.conn {
                ConnState::Open(conn) => bump_meta(conn, META_WRITE_EPOCH).is_err(),
                _ => false,
            };
            if bump_failed {
                inner.conn = ConnState::Failed(OpenFailure::Storage);
                return Err(PublicCacheError::new(
                    PublicCacheErrorCode::StorageUnavailable,
                    "缓存策略切换的并发隔离更新失败，缓存已停用",
                ));
            }
        }
        Ok(())
    }

    /// 公开请求发送前的并发快照。缓存不可用时返回 `None`——调用方仍走在线
    /// 路径，只是本次响应带 `cache.outcome = 'unavailable'`。
    pub fn begin_observe(&self) -> Option<ObserveTicket> {
        let mut inner = self.shared.inner.lock().ok()?;
        let conn = ensure_open(&mut inner, &self.shared.path)?;
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
        let Ok(mut inner) = self.shared.inner.lock() else {
            return CacheOutcome::unavailable();
        };
        // 经 `MutexGuard` 取字段会把借用记在整个 guard 上——先 deref 一次，
        // 让 `conn` 与 `write_cooldown_until` 成为互不干扰的字段级借用。
        let inner_ref = &mut *inner;
        let policy = inner_ref.policy;
        // 写盘熔断窗口：需要写盘的捕获/撤回直接报告不可用，不再逐次重撞
        // 同一磁盘错误；不产生写盘的 Ignore 判定不受影响。
        let cooling = inner_ref
            .write_cooldown_until
            .is_some_and(|deadline| deadline > std::time::Instant::now());
        let ConnState::Open(conn) = &mut inner_ref.conn else {
            return CacheOutcome::unavailable();
        };
        let now = now_rfc3339();
        match verdict {
            PublicVerdict::Ignore => CacheOutcome::simple(CacheOutcomeKind::Ignored),
            PublicVerdict::Withdraw(card_id) => {
                if cooling {
                    return CacheOutcome::unavailable();
                }
                match withdraw_card(conn, scope, &card_id, ticket, &now) {
                    Ok(outcome) => outcome,
                    Err(_) => {
                        inner_ref.write_cooldown_until =
                            Some(std::time::Instant::now() + WRITE_FAILURE_COOLDOWN);
                        CacheOutcome::unavailable()
                    }
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
                if cooling {
                    return CacheOutcome::unavailable();
                }
                match commit_captures(conn, scope, items, invalid, ticket, &policy, &now) {
                    Ok(outcome) => outcome,
                    Err(_) => {
                        inner_ref.write_cooldown_until =
                            Some(std::time::Instant::now() + WRITE_FAILURE_COOLDOWN);
                        CacheOutcome::unavailable()
                    }
                }
            }
            PublicVerdict::Card(item) => {
                if !policy.capture_enabled {
                    return CacheOutcome {
                        outcome: CacheOutcomeKind::Disabled,
                        captured: 0,
                        skipped: 1,
                    };
                }
                if cooling {
                    return CacheOutcome::unavailable();
                }
                match commit_captures(conn, scope, vec![item], 0, ticket, &policy, &now) {
                    Ok(outcome) => outcome,
                    Err(_) => {
                        inner_ref.write_cooldown_until =
                            Some(std::time::Instant::now() + WRITE_FAILURE_COOLDOWN);
                        CacheOutcome::unavailable()
                    }
                }
            }
        }
    }

    /// `public_read_cache_stats`：如实报告状态；文件还没建过就是 `empty`，
    /// 不为「看一眼统计」先造一个库。
    pub fn stats(&self) -> Result<PublicCacheStats, PublicCacheError> {
        let mut inner = self.lock()?;
        let path = self.shared.path.to_string_lossy().to_string();
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
        if matches!(inner.conn, ConnState::Closed) && !self.shared.path.exists() {
            return Ok(base("empty", policy));
        }
        match ensure_open(&mut inner, &self.shared.path) {
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
    /// 在途响应一律按 stale 丢弃，不会在清理后回填。显式清理同时是
    /// 写盘熔断的手动复位：成功后允许缓存立即重试写盘。
    pub fn clear(&self) -> Result<PublicCacheClearResult, PublicCacheError> {
        let mut inner = self.lock()?;
        if matches!(inner.conn, ConnState::Closed) && !self.shared.path.exists() {
            return Ok(PublicCacheClearResult {
                removed_entries: 0,
                freed_bytes: 0,
            });
        }
        let Some(conn) = ensure_open(&mut inner, &self.shared.path) else {
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
        // 清理成功说明磁盘写路径可用——熔断到此为止，后续捕获正常重试。
        inner.write_cooldown_until = None;
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
    // 先读 `user_version` 再执行任何可持久化的写：journal_mode=WAL 本身
    // 会改写数据库头，若先设 WAL 后查版本，「未知新版库」就可能已被本
    // 进程修改——违背 DESK-CACHE-002「保留原库并禁用」的承诺。裸打开 +
    // 一条读 pragma 不触碰文件内容，版本确认后才进入写路径。
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| OpenFailure::Storage)?;
    if version > SCHEMA_VERSION {
        // 来自更新版本应用的库：不读不写不删，本次进程停用缓存。
        return Err(OpenFailure::UnsupportedSchema);
    }
    // 与正式库同一组 PRAGMA 理由：WAL 读写不互阻塞；FULL sync 保证崩溃一致性。
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|_| OpenFailure::Storage)?;

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

/// 单卡响应的公开性最低门槛：自声明公开、已过公开审核、正文为字符串、
/// id 与请求一致。服务端契约意外变化（例如未审核记录混进公开面）时，
/// native 宁可不缓存，也不把不该留的数据落盘。
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
    if text_field(card, "review_status") != Some("approved") {
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

/// 摘要条目的公开性最低门槛：自声明公开 + 已过公开审核 + 基本展示
/// 字段在场（同 `project_card` 的防御性复核理由）。
fn project_summary(card: &serde_json::Value) -> Option<CaptureItem> {
    let card = card.as_object()?;
    let id = text_field(card, "id")?;
    text_field(card, "type")?;
    text_field(card, "name")?;
    if card.get("is_public").and_then(serde_json::Value::as_i64) != Some(1) {
        return None;
    }
    if text_field(card, "review_status") != Some("approved") {
        return None;
    }
    Some(CaptureItem {
        card_id: id.to_string(),
        updated_at: text_field(card, "updated_at").map(str::to_string),
        summary: project(card, SUMMARY_FIELDS),
        card: None,
    })
}

/// 固定公开路由的响应分类（`DESK-CACHE-004`/`006`）：
///
/// - `?id=` + 404 `{success:false, code: PUBLIC_DATA_CARD_NOT_FOUND}` 是
///   **业务级不可用**——唯一允许移除缓存的信号；仅凭 404 + success:false
///   不够：路由/版本错误也可能长成这个形状（503、HTML 404、401、网络
///   错误本来就不是——非 JSON 响应在 `read_bounded_json` 已被拒）。
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

    // 撤回信号不受存储许可约束——失效处理不是「把响应存起来」。证据必须
    // 是服务端登记的业务错误码，不是「碰巧 404 且 success 为 false」。
    if let Some(id) = single_id {
        if status == 404
            && body.get("success") == Some(&serde_json::Value::Bool(false))
            && body.get("code") == Some(&serde_json::Value::String(WITHDRAWAL_ERROR_CODE.into()))
        {
            return PublicVerdict::Withdraw(id.clone());
        }
    }
    if !cache_permits_storage(cache_control) {
        return PublicVerdict::Ignore;
    }

    if let Some(id) = single_id {
        if status != 200 || body.get("success") != Some(&serde_json::Value::Bool(true)) {
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

/// 满额 LRU 的**候选**计算：只按 LRU 顺序挑够 `need` 的旧条目，不删除。
/// 调用方先确认可回收量足够，再交 `evict_rows` 真正执行——「新写入失败
/// 时保留已有快照」要求淘汰与写入成功绑定，不能腾了空间却写不进去。
/// 只回收 `availability='known'` 的条目（撤回占位不是可回收内容），跳过
/// 本批次将要写的卡——否则会出现「刚腾出空间又被自己写回」的空转。
fn lru_eviction_candidates(
    conn: &Connection,
    need: u64,
    exclude: &BTreeSet<String>,
) -> CacheResult<Vec<(String, String, i64)>> {
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

    let mut picked = Vec::new();
    let mut reclaimable = 0u64;
    for (card_id, scope, bytes) in candidates {
        if reclaimable >= need {
            break;
        }
        if exclude.contains(&card_id) {
            continue;
        }
        reclaimable += bytes.max(0) as u64;
        picked.push((card_id, scope, bytes));
    }
    Ok(picked)
}

/// 真正删除候选行，返回回收的字节数。只在 `lru_eviction_candidates`
/// 确认可回收量足够、且所属写入确定继续时调用。
fn evict_rows(conn: &Connection, candidates: &[(String, String, i64)]) -> CacheResult<u64> {
    let mut freed = 0u64;
    for (card_id, scope, bytes) in candidates {
        conn.execute(
            "DELETE FROM cards WHERE card_id = ?1 AND source_scope = ?2",
            params![card_id, scope],
        )
        .map_err(|_| Failure)?;
        freed += (*bytes).max(0) as u64;
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
        // 替换记账是「旧记录字节出、新记录字节入」——旧行被更短正文
        // 替换时用量必须下降，只算正向 delta 会把缩小当成不增不减。
        let old_bytes = existing
            .as_ref()
            .map_or(0u64, |r| r.row_bytes.max(0) as u64);
        if let CacheBudget::Limited(budget) = policy.max_bytes {
            if built.row_bytes > budget {
                // 单条记录超过整个预算：拒绝写入而不是清空缓存去迁就它。
                skipped += 1;
                budget_skip = true;
                continue;
            }
            let required = usage
                .saturating_sub(old_bytes)
                .saturating_add(built.row_bytes);
            if required > budget {
                match policy.when_full {
                    CacheWhenFull::EvictLeastRecentlyUsed => {
                        let need = required - budget;
                        // 先只计算候选、确认可回收量足够，再删除——回收
                        // 与随后这条写入同生共死，不会出现「腾了空间却没
                        // 写进去」的白丢旧缓存。
                        let candidates = lru_eviction_candidates(&tx, need, &batch_ids)?;
                        let reclaimable: u64 = candidates
                            .iter()
                            .map(|(_, _, bytes)| (*bytes).max(0) as u64)
                            .sum();
                        if reclaimable < need {
                            skipped += 1;
                            budget_skip = true;
                            continue;
                        }
                        let freed = evict_rows(&tx, &candidates)?;
                        usage = usage.saturating_sub(freed);
                    }
                    CacheWhenFull::Pause => {
                        skipped += 1;
                        budget_skip = true;
                        continue;
                    }
                }
            }
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
        usage = usage
            .saturating_sub(old_bytes)
            .saturating_add(built.row_bytes);
        captured += 1;
    }
    tx.commit().map_err(|_| Failure)?;

    // 分类如实归因：被跳过的原因决定 outcome——容量暂停不是「整页投影
    // 全废」的挡箭牌，全是坏条目时应报告 ignored 而不是 paused。
    let kind = if captured > 0 {
        if skipped > 0 {
            CacheOutcomeKind::Partial
        } else {
            CacheOutcomeKind::Captured
        }
    } else if skipped == 0 {
        CacheOutcomeKind::Captured
    } else if budget_skip {
        CacheOutcomeKind::Paused
    } else if stale_skip {
        CacheOutcomeKind::Stale
    } else {
        CacheOutcomeKind::Ignored
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
///
/// 只对**已有缓存行**的卡写占位：负记录不参与 LRU 淘汰也不是可回收
/// 内容，为从未缓存过的 ID 无限量建档会让缓存文件持续增长（`DESK-CACHE-003`
/// 负缓存限量）。从未缓存的卡 404 如实报告 withdrawn，但不落任何行——
/// 迟到旧响应即使写入，也只是普通的可淘汰正缓存，不构成复活撤回态。
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
    let Some(row) = read_row(&tx, scope, card_id)? else {
        return Ok(CacheOutcome::simple(CacheOutcomeKind::Withdrawn));
    };
    if row.revision > ticket.mutation_seq {
        // 已有更新的证据（更新的成功读取）——404 是迟到的旧响应。
        return Ok(CacheOutcome::simple(CacheOutcomeKind::Stale));
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
    enforce_withdrawn_cap(&tx, MAX_WITHDRAWN_MARKERS)?;
    tx.commit().map_err(|_| Failure)?;
    Ok(CacheOutcome::simple(CacheOutcomeKind::Withdrawn))
}

/// 撤回占位的容量边界：标记数量超限时只回收最旧的失效信息，不触碰任何
/// 正缓存记录（`DESK-CACHE-003`：负缓存可限量回收，不得据此回收旧正卡）。
fn enforce_withdrawn_cap(conn: &Connection, limit: i64) -> CacheResult<()> {
    conn.execute(
        "DELETE FROM cards WHERE availability = 'withdrawn' AND rowid NOT IN (
            SELECT rowid FROM cards WHERE availability = 'withdrawn'
            ORDER BY last_attempt_at DESC, card_id DESC, source_scope DESC
            LIMIT ?1
        )",
        params![limit],
    )
    .map_err(|_| Failure)?;
    Ok(())
}

fn query_stats(conn: &Connection) -> CacheResult<PublicCacheStats> {
    // `entryCount` 的契约口径是「可见条目数」——撤回占位单独计数，
    // 不混入可见集合（与 desktop-ipc 的字段注释一致）。
    conn.query_row(
        "SELECT COALESCE(SUM(row_bytes), 0),
                COALESCE(SUM(CASE WHEN availability != 'withdrawn' THEN 1 ELSE 0 END), 0),
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

    /// native 初始态是「策略尚未确认」——正缓存在第一次策略推送之前一律
    /// 暂停。需要正写入的用例必须先显式确认策略。
    fn enable_capture(cache: &PublicReadCache) {
        cache
            .apply_policy(PublicCachePolicyDto {
                capture_enabled: true,
                max_bytes: CacheBudget::Limited(DEFAULT_BUDGET_BYTES),
                when_full: CacheWhenFull::Pause,
            })
            .expect("apply capture-enabled policy");
    }

    /// 业务级不可用响应：404 + 稳定错误码（`DESK-CACHE-006`）。
    fn withdraw_body() -> serde_json::Value {
        json!({"success": false, "code": WITHDRAWAL_ERROR_CODE})
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
        enable_capture(&cache);
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
        enable_capture(&cache);
        for mut item in [
            summary_item("p", "n", "2026-10-02T00:00:00Z"),
            summary_item("p2", "n", "2026-10-02T00:00:00Z"),
            summary_item("p3", "n", "2026-10-02T00:00:00Z"),
            summary_item("p4", "n", "2026-10-02T00:00:00Z"),
        ] {
            match item["id"].as_str().unwrap() {
                "p" => set_field(&mut item, "is_public", json!(0)),
                "p2" => remove_field(&mut item, "is_public"),
                "p3" => set_field(&mut item, "review_status", json!("pending")),
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
        // 200 但 success:false 不是「业务成功」——不缓存。
        let outcome = observe(
            &cache,
            &single_query("card-x"),
            Some(PUBLIC_CC),
            200,
            &json!({"success": false, "card": {"id": "card-x", "is_public": 1, "data": "{}", "review_status": "approved"}}),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Ignored);
        // 未过公开审核的单卡不落盘。
        let mut card = single_card("card-x", "{}", "2026-10-02T00:00:00Z");
        card["card"]["review_status"] = json!("pending");
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
        enable_capture(&cache);
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
        enable_capture(&cache);
        observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            200,
            &single_card("card-a", "{}", "2026-10-02T00:00:00Z"),
        );
        // 503 / 401 / 无稳定错误码的 404 都不是撤回信号。
        for (status, body) in [
            (503u16, json!({"success": false, "error": "maintenance"})),
            (401u16, json!({"success": false, "error": "unauthorized"})),
            // 仅凭 404 + success:false 不足以确认业务撤回——缺稳定错误码。
            (404u16, json!({"success": false})),
            (
                404u16,
                json!({"success": false, "code": "SOME_OTHER_ERROR"}),
            ),
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
            assert_eq!(
                availability, "known",
                "status={status} body={body} 不得撤回"
            );
            assert!(card.is_some());
        }
        // 业务级 404 + 稳定错误码：正文清掉、保留失效占位。
        let outcome = observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            404,
            &withdraw_body(),
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
        enable_capture(&cache);
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
            &withdraw_body(),
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
        enable_capture(&cache);
        observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            200,
            &single_card("card-a", "v1", "2026-10-02T00:00:00Z"),
        );
        observe(
            &cache,
            &single_query("card-a"),
            Some(PUBLIC_CC),
            404,
            &withdraw_body(),
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
        enable_capture(&cache);
        // 已缓存行的撤回失效处理不受捕获开关影响——先捕获再禁用再撤回。
        observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", "{}", "2026-10-02T00:00:00Z"),
        );
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
        assert_eq!(open_row(&root, SCOPE, "a").unwrap().0, "known");
        let outcome = observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            404,
            &withdraw_body(),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Withdrawn);
        assert_eq!(open_row(&root, SCOPE, "a").unwrap().0, "withdrawn");
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
        enable_capture(&cache);
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
        enable_capture(&cache);
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
        enable_capture(&cache);
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

    /* ── K1-r1：策略门禁、撤回证据边界与故障收口 ────────────────────── */

    #[test]
    fn capture_stays_paused_until_policy_is_confirmed() {
        // 「策略尚未确认」的进程初始态不得按默认开启捕获：用户已关闭捕获
        // 或配置需降级时，启动到首次推送之间不允许出现提前捕获窗口。
        let root = scratch("unconfirmed");
        let cache = PublicReadCache::at(&root);
        let outcome = observe(
            &cache,
            &summary_query(),
            Some(PUBLIC_CC),
            200,
            &summary_page(vec![summary_item("a", "A", "2026-10-02T00:00:00Z")]),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Disabled);
        assert!(open_row(&root, SCOPE, "a").is_none());
        let stats = cache.stats().expect("stats");
        assert!(!stats.applied_policy.capture_enabled);

        // 首次推送「开启」后才允许正写入。
        enable_capture(&cache);
        let outcome = observe(
            &cache,
            &summary_query(),
            Some(PUBLIC_CC),
            200,
            &summary_page(vec![summary_item("a", "A", "2026-10-02T00:00:00Z")]),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn responses_sent_before_enable_cannot_refill_afterwards() {
        // 请求发出时捕获尚未确认——即使随后开启，该响应的票据也应被
        // transition 的 epoch 推进作废，不能把「禁用世界里取得的响应」
        // 回填进缓存。
        let root = scratch("pre-enable-ticket");
        let cache = PublicReadCache::at(&root);
        let stale_ticket = cache.begin_observe().expect("ticket while disabled");
        enable_capture(&cache);
        let outcome = cache.observe_response(
            &stale_ticket,
            SCOPE,
            Some(&summary_query()),
            Some(PUBLIC_CC),
            200,
            &summary_page(vec![summary_item("a", "A", "2026-10-02T00:00:00Z")]),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Stale);
        assert!(open_row(&root, SCOPE, "a").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn inflight_during_disabled_window_stays_dead_after_reenable() {
        // 开→关→开：禁用窗口里发出的票据在重新开启后依然是死票——
        // 两个方向的 transition 都必须推进 epoch。
        let root = scratch("disable-reenable");
        let cache = PublicReadCache::at(&root);
        enable_capture(&cache);
        cache
            .apply_policy(PublicCachePolicyDto {
                capture_enabled: false,
                max_bytes: CacheBudget::Limited(DEFAULT_BUDGET_BYTES),
                when_full: CacheWhenFull::Pause,
            })
            .expect("disable");
        let stale_ticket = cache.begin_observe().expect("ticket while disabled");
        enable_capture(&cache);
        let outcome = cache.observe_response(
            &stale_ticket,
            SCOPE,
            Some(&single_query("a")),
            Some(PUBLIC_CC),
            200,
            &single_card("a", "{}", "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Stale);
        assert!(open_row(&root, SCOPE, "a").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn shrinking_a_row_frees_budget_for_the_next_write() {
        // 替换为更短正文时容量记账必须回扣旧记录字节，否则满额判定
        // 会按只增不减的幻觉拒绝后续本可放下的写入。
        let root = scratch("shrink-delta");
        let cache = PublicReadCache::at(&root);
        cache
            .apply_policy(PublicCachePolicyDto {
                capture_enabled: true,
                max_bytes: CacheBudget::Limited(MIN_BUDGET_BYTES),
                when_full: CacheWhenFull::Pause,
            })
            .expect("apply policy");
        let big = "x".repeat(600 * 1024);
        let outcome = observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", &big, "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        // a 换成 ~100KiB：旧行字节必须出账，usage 回落。
        let small = "y".repeat(100 * 1024);
        let outcome = observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", &small, "2026-10-03T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        let stats = cache.stats().expect("stats");
        assert!(
            stats.usage_bytes < 200 * 1024,
            "usage={}",
            stats.usage_bytes
        );
        // 900KiB 新卡：100K + 900K < 1MiB——若旧占用没回扣必然误满。
        let bigger = "z".repeat(900 * 1024);
        let outcome = observe(
            &cache,
            &single_query("b"),
            Some(PUBLIC_CC),
            200,
            &single_card("b", &bigger, "2026-10-04T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Captured);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn withdrawal_without_an_existing_row_writes_no_marker() {
        // 负记录不回收、不参与 LRU——为从未缓存的 ID 无限量建档会让缓存
        // 文件持续增长。404 如实报告撤回，但不落任何行。
        let root = scratch("no-marker");
        let cache = PublicReadCache::at(&root);
        enable_capture(&cache);
        let outcome = observe(
            &cache,
            &single_query("never-cached"),
            Some(PUBLIC_CC),
            404,
            &withdraw_body(),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Withdrawn);
        assert!(open_row(&root, SCOPE, "never-cached").is_none());
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.withdrawn_count, 0);
        assert_eq!(stats.entry_count, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn withdrawn_markers_are_bounded_without_touching_live_rows() {
        let root = scratch("marker-cap");
        let cache = PublicReadCache::at(&root);
        enable_capture(&cache);
        for id in ["a", "b", "c", "d", "e"] {
            observe(
                &cache,
                &single_query(id),
                Some(PUBLIC_CC),
                200,
                &single_card(id, "{}", "2026-10-02T00:00:00Z"),
            );
        }
        // a/b 撤回成占位；c/d/e 保留正缓存。
        for id in ["a", "b"] {
            let outcome = observe(
                &cache,
                &single_query(id),
                Some(PUBLIC_CC),
                404,
                &withdraw_body(),
            );
            assert_eq!(outcome.outcome, CacheOutcomeKind::Withdrawn);
        }
        // 直接按小上限触发回收：最旧的占位被清掉，正缓存一行不动。
        // 用固定老时间戳保证 a 必然最旧，不依赖测试运行的真实时钟。
        let conn = Connection::open(root.join(PUBLIC_READ_CACHE_FILE)).expect("open cache file");
        conn.execute(
            "UPDATE cards SET last_attempt_at = '2020-01-01T00:00:00Z' WHERE card_id = 'a'",
            [],
        )
        .unwrap();
        enforce_withdrawn_cap(&conn, 1).expect("cap");
        assert!(
            open_row(&root, SCOPE, "a").is_none(),
            "最旧的失效占位先回收"
        );
        assert_eq!(open_row(&root, SCOPE, "b").unwrap().0, "withdrawn");
        for id in ["c", "d", "e"] {
            assert_eq!(open_row(&root, SCOPE, id).unwrap().0, "known");
        }
        // 统计口径：可见条目与撤回占位分开计数。
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.entry_count, 3);
        assert_eq!(stats.withdrawn_count, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn write_failure_trips_cooldown_instead_of_retrying_every_request() {
        // 写路径故障后熔断：窗口内的写盘尝试直接报告不可用，不让每次
        // 公开请求都重撞同一个磁盘错误（DESK-CACHE-003 故障暂停）。
        // 用第二个连接持写锁制造确定性的写入失败——读路径不受影响，
        // 票据照常签发，失败精确落在写盘事务里。
        let root = scratch("cooldown");
        let cache = PublicReadCache::at(&root);
        enable_capture(&cache);
        cache.begin_observe().expect("open the db first");
        let blocker = Connection::open(root.join(PUBLIC_READ_CACHE_FILE)).expect("open cache file");
        blocker
            .execute_batch("BEGIN IMMEDIATE")
            .expect("hold write lock");
        let outcome = observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", "{}", "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Unavailable);
        // 熔断窗口内第二次需要写盘的观察直接不可用——不再重撞同一写锁。
        let outcome = observe(
            &cache,
            &single_query("b"),
            Some(PUBLIC_CC),
            200,
            &single_card("b", "{}", "2026-10-02T00:00:00Z"),
        );
        assert_eq!(outcome.outcome, CacheOutcomeKind::Unavailable);
        blocker.execute_batch("ROLLBACK").expect("release lock");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stats_counts_visible_entries_separately_from_withdrawn_markers() {
        let root = scratch("stats-split");
        let cache = PublicReadCache::at(&root);
        enable_capture(&cache);
        observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            200,
            &single_card("a", "{}", "2026-10-02T00:00:00Z"),
        );
        observe(
            &cache,
            &single_query("a"),
            Some(PUBLIC_CC),
            404,
            &withdraw_body(),
        );
        let stats = cache.stats().expect("stats");
        assert_eq!(stats.entry_count, 0, "撤回占位不计入可见条目");
        assert_eq!(stats.withdrawn_count, 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
