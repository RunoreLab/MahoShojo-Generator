//! 本地数据卡的 SQLite 存储。
//!
//! 职责边界（`ADR-desktop-tauri-v1` 第 7 条）：TypeScript 负责记录组装与校验，Rust 只做
//! 存储机制。因此本模块**不理解**卡的内容语义——它存取经过校验的 opaque JSON 文档。
//!
//! ## 为什么同时存 document 与索引列
//!
//! `local_card` 同时持有 opaque `document` 与 `card_type` / `updated_at` / `deleted_at` /
//! `content_digest` 四个索引列。业务语义仍然只在 TypeScript：这些值由 TypeScript 提供，Rust
//! 不解释它们的含义，只用它们做 SQL 选择器（排序、类型过滤、软删过滤）。
//!
//! 若只存 document，Rust 就无法在不解析业务 JSON 的前提下分页与过滤，只能把整表读进内存
//! 排序切片——那正是 Web 端 offset 分页的现状，Desktop 没有理由继承这个局限。
//!
//! ## 索引列的独立复核
//!
//! 写入前 Rust 从 document 中重新提取这四个字段，并与调用方声明的值逐项比对，不一致即拒
//! 绝。这复用了 D1 在 Provider Profile 上已验证的"保存前让 native 独立表态"模式：两侧理解
//! 不一致时**不落盘**，而不是写入一行自相矛盾的记录。
//!
//! ## 为什么 `data` 用 RawValue 而不是 Value
//!
//! `DESK-062` 禁止把宿主语言默认 JSON 解析成功当作 opaque document 的落盘前提。实测
//! `serde_json` 会**拒绝** `"\ud800"` 这类孤立代理项转义，而 JavaScript 侧的
//! `JSON.stringify` 会产出它、Web 的 IndexedDB 也照常保存它。若在这里解析成
//! `serde_json::Value`，桌面端就会静默拒收 Web 已有的合法数据。
//!
//! `Box<RawValue>` 保留原始文本而不实例化 `String`，因此自由载荷里的孤立代理项被逐字节保留
//! （见本模块的兼容性测试）。索引字段仍然按契约要求是 ASCII，继续用 `String` 提取——
//! surrogate 出现在 `id` / `cardType` / 时间戳 / 摘要里是真的非法，不是收窄可表示域。
//!
//! ## blob 可达性
//!
//! 本模块只处理结构化记录。blob 引用与孤儿 GC 属 D2.1 / D2.2：`DESK-055` 规定 soft delete
//! 不改变 blob 可达性，因此那两张表与本表是独立演进的。

use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde_json::value::RawValue;

use crate::store::{LocalStorePaths, StoreError};

/// 单条本地卡文档的 UTF-8 字节上限。
///
/// Web 侧云端硬上限是 1 MiB（`apps/web/lib/data-card-size.ts`），但本地库不受卡槽配额约束，
/// 因此这里取一个宽松但有界的值：它存在的意义是拒绝"契约合法却大到无法渲染或导出"的输入，
/// 而不是复刻线上配额。超限以可诊断错误失败，不静默截断。
pub const MAX_LOCAL_CARD_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;

/// 单次 `list` 允许的页大小上限，与 `MAX_LOCAL_CARD_PAGE_SIZE` 对齐。
pub const MAX_LOCAL_CARD_PAGE_SIZE: i64 = 100;

pub const MIGRATION_2: &str = r#"
CREATE TABLE IF NOT EXISTS local_card (
    id             TEXT PRIMARY KEY NOT NULL,
    document       TEXT NOT NULL,
    card_type      TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    content_digest TEXT NOT NULL
) STRICT;

-- keyset 分页与"排除 tombstone"的主力索引。
-- 顺序与 list 的 ORDER BY 完全一致，否则分页会退化成对全表排序。
CREATE INDEX IF NOT EXISTS local_card_by_updated
    ON local_card (updated_at DESC, id ASC);

-- 类型过滤。Web 端的等价能力是按 cardType 过滤，这里由 SQLite 承担。
CREATE INDEX IF NOT EXISTS local_card_by_type
    ON local_card (card_type, updated_at DESC, id ASC);
"#;

/// 从 document 中提取的索引列。
///
/// 字段名与 `LocalCardRecordV1` 的 camelCase 一致。`data` 是 `Box<RawValue>`：保留原始文本而
/// 不实例化 `String`，从而接受 JavaScript 可产出、`serde_json::Value` 会拒绝的输入。
///
/// 刻意**不加** `deny_unknown_fields`：记录会随 schema 演进，Rust 不该因为出现新字段就拒收
/// 一条 TypeScript 侧合法的记录。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalCardIndexProjection {
    id: String,
    card_type: String,
    updated_at: String,
    #[serde(default)]
    deleted_at: Option<String>,
    content_digest: String,
    /// 自由载荷。**刻意不读它**：这个字段存在的唯一目的是让 serde 跳过载荷、保留原始
    /// 文本，而不是实例化成 `String`——后者会在遇到 `\ud800` 时直接失败。
    ///
    /// 因此它没有构造值用途；若哪天真的开始读它，说明这条约束已被破坏，需要重新评估。
    #[serde(default, rename = "data")]
    _data: Option<Box<RawValue>>,
}

/// 调用方声明的索引列。Rust 逐项与 document 中的实际值复核。
///
/// `camelCase` 与 `LocalCardRecordV1` 的字段名一致，因此 IPC 侧不需要额外映射层；
/// `deny_unknown_fields` 刻意不加：多带一个无害字段不应让整次保存失败。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCardIndex {
    pub id: String,
    pub card_type: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub content_digest: String,
}

/// keyset 游标：`(updated_at, id)`。
///
/// 用 keyset 而非 offset 是因为 offset 游标在两次翻页之间的写入或删除下会重复或漏掉行。
/// 游标本身对调用方保持 opaque（`repository.ts` 只要求它是不超过 512 字符的字符串），
/// 使 Web 的 IndexedDB adapter 未来可以独立改进而不必跟随本实现。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LocalCardCursor {
    pub updated_at: String,
    pub id: String,
}

/// 本地卡分页查询。
#[derive(Debug, Clone, Default)]
pub struct LocalCardQuery {
    /// 包含 tombstone。默认 false，与 `CardRepository` 契约一致。
    pub include_deleted: bool,
    /// 限定卡类型；`None` 或空表示不筛选。契约层已拒绝重复值。
    pub card_types: Vec<String>,
    /// 期望条数，1..=`MAX_LOCAL_CARD_PAGE_SIZE`。
    pub limit: i64,
    /// keyset 续读起点。
    pub cursor: Option<LocalCardCursor>,
}

/// 一页本地卡。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCardPage {
    pub documents: Vec<String>,
    /// 还有下一页时给出续读游标。
    pub next_cursor: Option<LocalCardCursor>,
}

/// 本地库中本地卡的存储。
pub struct LocalCardStore {
    connection: Mutex<Connection>,
}

impl LocalCardStore {
    /// 在给定的应用数据目录布局上打开本地库。
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

        Self::from_connection(connection)
    }

    /// 打开内存库。供测试使用，不触碰用户数据目录。
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::from_connection(Connection::open_in_memory().map_err(|_| StoreError::Unavailable)?)
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

    /// 按 id 读取一条 document。缺失返回 `Ok(None)`，不视为错误。
    pub fn get(&self, id: &str) -> Result<Option<String>, StoreError> {
        if id.trim().is_empty() {
            return Err(StoreError::InvalidDocument);
        }
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare("SELECT document FROM local_card WHERE id = ?1")
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

    /// 写入或覆盖一条本地卡。
    ///
    /// 写入前独立复核索引列：`document` 里提取出的 `id` / `cardType` / `updatedAt` /
    /// `deletedAt` / `contentDigest` 必须与 `index` 声明的完全一致，否则拒绝。这让
    /// TypeScript 与 Rust 两侧对同一条记录的理解不一致时**不落盘**。
    ///
    /// 另有一条写入顺序不变量：`put` **不得**清除既有 tombstone。复活必须走显式 `restore`，
    /// 否则"删除"与"保存"会混成同一个不可区分的动作。
    pub fn put(&self, document: &str, index: &LocalCardIndex) -> Result<(), StoreError> {
        let declared = validate_and_extract(document, index)?;
        if declared.id.trim().is_empty() {
            return Err(StoreError::InvalidDocument);
        }
        if document.len() > MAX_LOCAL_CARD_DOCUMENT_BYTES {
            return Err(StoreError::DocumentTooLarge);
        }

        self.with_connection(|connection| {
            let existing: Option<(String, Option<String>)> = connection
                .query_row(
                    "SELECT updated_at, deleted_at FROM local_card WHERE id = ?1",
                    rusqlite::params![declared.id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .ok();

            if let Some((existing_updated_at, tombstone)) = existing {
                if tombstone.is_some() && index.deleted_at.is_none() {
                    return Err(StoreError::Tombstoned);
                }
                // 覆盖写入不得让 updated_at 回退。keyset 分页按 updated_at DESC 排序，
                // 一次回退会让已翻过的页再次出现新行，或让正在读的那一页漏掉行。
                // 时钟回拨（NTP 校正、用户改时间）会造出这种输入，因此在存储层挡住。
                if declared.updated_at.as_str() < existing_updated_at.as_str() {
                    return Err(StoreError::NonMonotonicTimestamp);
                }
            }

            connection
                .execute(
                    "INSERT INTO local_card
                        (id, document, card_type, updated_at, deleted_at, content_digest)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(id) DO UPDATE SET
                        document = excluded.document,
                        card_type = excluded.card_type,
                        updated_at = excluded.updated_at,
                        deleted_at = excluded.deleted_at,
                        content_digest = excluded.content_digest",
                    rusqlite::params![
                        declared.id,
                        document,
                        declared.card_type,
                        declared.updated_at,
                        index.deleted_at,
                        declared.content_digest,
                    ],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    /// 幂等软删：只写 `deleted_at`，保留 document。缺失或已删除同样成功。
    pub fn soft_delete(&self, id: &str, deleted_at: &str) -> Result<(), StoreError> {
        self.with_connection(|connection| {
            let existing: Option<(String, Option<String>)> = connection
                .query_row(
                    "SELECT updated_at, deleted_at FROM local_card WHERE id = ?1",
                    rusqlite::params![id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .ok();
            let Some((updated_at, tombstone)) = existing else {
                return Ok(());
            };
            if tombstone.is_some() {
                return Ok(());
            }
            if deleted_at < updated_at.as_str() {
                return Err(StoreError::InvalidDocument);
            }
            connection
                .execute(
                    "UPDATE local_card SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                    rusqlite::params![id, deleted_at],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    /// 显式移除 tombstone，使记录重新可见。幂等。
    pub fn restore(&self, id: &str) -> Result<(), StoreError> {
        self.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_card SET deleted_at = NULL WHERE id = ?1",
                    rusqlite::params![id],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    /// 彻底删除一条记录。幂等：缺失 id 同样成功。
    pub fn purge(&self, id: &str) -> Result<(), StoreError> {
        self.with_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM local_card WHERE id = ?1",
                    rusqlite::params![id],
                )
                .map_err(|_| StoreError::Failure)?;
            Ok(())
        })
    }

    /// keyset 分页。
    ///
    /// 顺序固定为 `updated_at DESC, id ASC`，与 `local_card_by_updated` 索引一致。游标表示
    /// "最后一条已返回的行"，下一页从它之后继续。
    pub fn list(&self, query: &LocalCardQuery) -> Result<LocalCardPage, StoreError> {
        if query.limit < 1 || query.limit > MAX_LOCAL_CARD_PAGE_SIZE {
            return Err(StoreError::InvalidQuery);
        }

        let has_type_filter = !query.card_types.is_empty();
        let include_deleted = query.include_deleted;

        self.with_connection(|connection| {
            // 多取一条用于判断是否还有下一页——比先查 count 再查数据少一次扫描，
            // 也避免两次查询之间状态变化导致页数判断出错。
            let fetch = query.limit + 1;

            let mut statement = connection
                .prepare_cached(
                    "SELECT id, document, updated_at FROM local_card
                     WHERE (:include_deleted = 1 OR deleted_at IS NULL)
                       AND (
                            :has_type_filter = 0
                            OR card_type IN (SELECT value FROM json_each(:type_filter))
                       )
                       AND (
                            :has_cursor = 0
                            OR (updated_at < :cursor_updated_at)
                            OR (updated_at = :cursor_updated_at AND id > :cursor_id)
                       )
                     ORDER BY updated_at DESC, id ASC
                     LIMIT :fetch",
                )
                .map_err(|_| StoreError::Failure)?;

            // 参数**全部**具名：`?1` 这类编号参数与具名参数混用时，SQLite 按出现顺序分配
            // 索引，会让先出现的具名参数与后出现的 `?1` 撞同一个槽位。这类错误只在运行期
            // 表现为一条无消息的 Failure，因此从结构上避免混用。
            //
            // 类型筛选走 `json_each` 而不是拼接 `IN (?, ?, ?)`：绑定一个 JSON 数组避免了
            // 动态构造 SQL，而 SQL 选择器仍完全由本模块决定（ADR 第 7 条）。
            let type_filter = serde_json::to_string(&query.card_types)
                .map_err(|_| StoreError::InvalidQuery)?;

            let cursor = query.cursor.as_ref();

            let rows = statement
                .query_map(
                    rusqlite::named_params! {
                        ":type_filter": type_filter,
                        ":cursor_updated_at": cursor.map(|value| value.updated_at.as_str()).unwrap_or(""),
                        ":cursor_id": cursor.map(|value| value.id.as_str()).unwrap_or(""),
                        ":fetch": fetch,
                        ":include_deleted": i64::from(include_deleted),
                        ":has_type_filter": i64::from(has_type_filter),
                        ":has_cursor": i64::from(cursor.is_some()),
                    },
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .map_err(|_| StoreError::Failure)?;

            let mut documents: Vec<String> = Vec::new();
            // 游标取**最后一条已返回的行**，不是那条多取出来的行。
            // 两者混用会让下一页从"已返回的最后一行之后"开始，从而每页漏掉一行——
            // 这个错误在页大小为 1 时表现为恰好丢掉一半的行，很容易被误读成性能问题。
            let mut last_returned: Option<LocalCardCursor> = None;
            let mut has_more = false;

            for row in rows {
                let (id, document, updated_at) = row.map_err(|_| StoreError::Failure)?;
                if documents.len() == query.limit as usize {
                    has_more = true;
                    break;
                }
                last_returned = Some(LocalCardCursor { updated_at, id });
                documents.push(document);
            }

            let next_cursor = if has_more { last_returned } else { None };
            Ok(LocalCardPage { documents, next_cursor })
        })
    }
}

/// 复核 document 中的索引字段并返回它们。
///
/// 失败一律映射到 `InvalidDocument`：调用方拿到的错误码稳定，且不含任何用户数据。
fn validate_and_extract(
    document: &str,
    index: &LocalCardIndex,
) -> Result<LocalCardIndex, StoreError> {
    if document.len() > MAX_LOCAL_CARD_DOCUMENT_BYTES {
        return Err(StoreError::DocumentTooLarge);
    }

    // 只提取索引字段，data 走 RawValue 以保留原始文本。
    let projection: LocalCardIndexProjection =
        serde_json::from_str(document).map_err(|_| StoreError::InvalidDocument)?;

    let extracted = LocalCardIndex {
        id: projection.id,
        card_type: projection.card_type,
        updated_at: projection.updated_at,
        deleted_at: projection.deleted_at,
        content_digest: projection.content_digest,
    };

    if extracted != *index {
        return Err(StoreError::IndexMismatch);
    }
    Ok(extracted)
}

#[cfg(test)]
mod tests {
    use super::{
        LocalCardCursor, LocalCardIndex, LocalCardQuery, LocalCardStore, StoreError,
        MAX_LOCAL_CARD_DOCUMENT_BYTES, MAX_LOCAL_CARD_PAGE_SIZE,
    };
    use crate::store::LocalStorePaths;

    /// 造一条与 `LocalCardRecordV1` 形状一致的 document，并返回它与配套的索引列。
    ///
    /// 用 `format!` 而不是 `serde_json::json!`：后者会重新序列化，从而丢掉
    /// "document 文本必须原样落盘"这一前提——本模块承诺的是字节级往返。
    fn card(id: &str, card_type: &str, updated_at: &str, data: &str) -> (String, LocalCardIndex) {
        let document = format!(
            r#"{{"id":"{id}","schemaVersion":1,"storageLocation":"local","cardType":"{card_type}","title":"t","data":{data},"contentDigest":"sha256:{}","provenance":{{"kind":"unsigned","execution":"imported"}},"createdAt":"{updated_at}","updatedAt":"{updated_at}"}}"#,
            "a".repeat(64)
        );
        let index = LocalCardIndex {
            id: id.to_string(),
            card_type: card_type.to_string(),
            updated_at: updated_at.to_string(),
            deleted_at: None,
            content_digest: format!("sha256:{}", "a".repeat(64)),
        };
        (document, index)
    }

    fn store() -> LocalCardStore {
        LocalCardStore::open_in_memory().expect("in-memory card store must open")
    }

    fn page_of(store: &LocalCardStore, query: &LocalCardQuery) -> Vec<String> {
        store.list(query).expect("list must succeed").documents
    }

    fn default_query(limit: i64) -> LocalCardQuery {
        LocalCardQuery {
            include_deleted: false,
            card_types: Vec::new(),
            limit,
            cursor: None,
        }
    }

    #[test]
    fn round_trips_a_card_and_reports_absence_without_error() {
        let store = store();
        let (document, index) = card("lc_a", "character", "2026-09-30T00:00:00Z", r#"{"n":1}"#);

        store.put(&document, &index).expect("put must succeed");
        assert_eq!(store.get("lc_a").expect("get must succeed"), Some(document));
        assert_eq!(store.get("missing").expect("get must succeed"), None);
    }

    #[test]
    fn preserves_a_document_byte_for_byte_including_key_order_and_escapes() {
        let store = store();
        // 故意不按字母序写键，并混入转义：opaque 文档的字节序必须原样落盘。
        let (document, index) = card(
            "lc_order",
            "scenario",
            "2026-09-30T00:00:00Z",
            r#"{"z":1,"a":{"quote\"":"back\\slash"},"emoji":"😀"}"#,
        );
        store.put(&document, &index).expect("put must succeed");
        assert_eq!(
            store.get("lc_order").expect("get must succeed"),
            Some(document)
        );
    }

    /// `DESK-062` 的兼容性用例。
    ///
    /// `JSON.stringify` 会产出 `"\ud800"`，Web 的 IndexedDB 照常保存它，而 `serde_json` 解析成
    /// `Value` 会直接拒绝。若桌面端沿用那条校验，用户在 Web 侧存下的卡到桌面端会静默写不进去。
    #[test]
    fn accepts_a_document_whose_payload_contains_a_lone_surrogate_escape() {
        let store = store();
        let (document, index) = card(
            "lc_surrogate",
            "character",
            "2026-09-30T00:00:00Z",
            r#"{"note":"\ud800"}"#,
        );
        let expected = document.clone();

        store.put(&document, &index).expect("put must succeed");
        assert_eq!(
            store.get("lc_surrogate").expect("get must succeed"),
            Some(expected.clone()),
            "document 必须逐字节保留，包括 serde_json::Value 会拒绝的转义",
        );

        let listed = page_of(&store, &default_query(10));
        assert_eq!(listed, vec![expected], "分页读取同样不得丢失该转义");
    }

    #[test]
    fn rejects_an_index_that_disagrees_with_the_document() {
        let store = store();
        let (document, mut index) = card("lc_mismatch", "character", "2026-09-30T00:00:00Z", "{}");

        index.card_type = "scenario".to_string();
        assert_eq!(store.put(&document, &index), Err(StoreError::IndexMismatch));

        let mut wrong_id = index.clone();
        wrong_id.card_type = "character".to_string();
        wrong_id.id = "lc_other".to_string();
        assert_eq!(
            store.put(&document, &wrong_id),
            Err(StoreError::IndexMismatch)
        );

        let mut wrong_digest = index.clone();
        wrong_digest.id = "lc_mismatch".to_string();
        wrong_digest.content_digest = format!("sha256:{}", "b".repeat(64));
        assert_eq!(
            store.put(&document, &wrong_digest),
            Err(StoreError::IndexMismatch)
        );

        // 拒绝之后必须什么都没写。
        assert_eq!(store.get("lc_mismatch").expect("get must succeed"), None);
    }

    #[test]
    fn rejects_documents_that_are_not_json_or_exceed_the_ceiling() {
        let store = store();
        let (_, index) = card("lc_x", "character", "2026-09-30T00:00:00Z", "{}");

        assert_eq!(
            store.put("not json", &index),
            Err(StoreError::InvalidDocument)
        );
        assert_eq!(store.put("", &index), Err(StoreError::InvalidDocument));

        let (huge, huge_index) = card(
            "lc_huge",
            "character",
            "2026-09-30T00:00:00Z",
            &format!(
                r#"{{"blob":"{}"}}"#,
                "x".repeat(MAX_LOCAL_CARD_DOCUMENT_BYTES)
            ),
        );
        assert_eq!(
            store.put(&huge, &huge_index),
            Err(StoreError::DocumentTooLarge)
        );
    }

    #[test]
    fn refuses_to_resurrect_a_tombstone_through_a_normal_put() {
        let store = store();
        let (document, index) = card("lc_tomb", "character", "2026-09-30T00:00:00Z", "{}");
        store.put(&document, &index).expect("put");
        store
            .soft_delete("lc_tomb", "2026-09-30T01:00:00Z")
            .expect("soft delete");

        // 文档与索引必须成对更新：只改索引会被 IndexMismatch 先拒掉，测不到 tombstone 规则。
        let (newer_document, newer_index) =
            card("lc_tomb", "character", "2026-09-30T02:00:00Z", "{}");
        assert_eq!(
            store.put(&newer_document, &newer_index),
            Err(StoreError::Tombstoned),
        );

        store.restore("lc_tomb").expect("restore");
        store
            .put(&newer_document, &newer_index)
            .expect("restore 后才能覆盖写入");
    }

    #[test]
    fn refuses_a_backwards_timestamp_so_keyset_order_stays_stable() {
        let store = store();
        let (document, index) = card("lc_time", "character", "2026-09-30T05:00:00Z", "{}");
        store.put(&document, &index).expect("put");

        // 时钟回拨（NTP 校正、用户改时间）会造出这种输入。
        let (earlier_document, earlier_index) =
            card("lc_time", "character", "2026-09-30T01:00:00Z", "{}");
        assert_eq!(
            store.put(&earlier_document, &earlier_index),
            Err(StoreError::NonMonotonicTimestamp),
        );
        assert_eq!(
            store.get("lc_time").expect("get must succeed"),
            Some(document),
            "被拒的写入不得改动既有行",
        );
    }

    #[test]
    fn soft_delete_is_idempotent_and_restore_brings_the_document_back() {
        let store = store();
        let (document, index) = card("lc_soft", "character", "2026-09-30T00:00:00Z", "{}");
        let expected = document.clone();
        store.put(&document, &index).expect("put");

        store
            .soft_delete("lc_soft", "2026-09-30T01:00:00Z")
            .expect("soft delete");
        store
            .soft_delete("lc_soft", "2026-09-30T02:00:00Z")
            .expect("repeat must be idempotent");
        store
            .soft_delete("missing", "2026-09-30T02:00:00Z")
            .expect("missing must be idempotent");

        assert!(
            page_of(&store, &default_query(10)).is_empty(),
            "tombstone 默认不可见"
        );
        // soft delete 不删文档：restore 因此能真正恢复，而不是留下"记录在、字节缺"的行。
        assert_eq!(
            store.get("lc_soft").expect("get must succeed"),
            Some(expected)
        );

        let including = LocalCardQuery {
            include_deleted: true,
            ..default_query(10)
        };
        assert_eq!(page_of(&store, &including).len(), 1);

        store.restore("lc_soft").expect("restore");
        store
            .restore("lc_soft")
            .expect("repeat restore must be idempotent");
        assert_eq!(page_of(&store, &default_query(10)).len(), 1);
    }

    #[test]
    fn purge_removes_the_row_and_stays_idempotent() {
        let store = store();
        let (document, index) = card("lc_purge", "character", "2026-09-30T00:00:00Z", "{}");
        store.put(&document, &index).expect("put");

        store.purge("lc_purge").expect("purge");
        assert_eq!(store.get("lc_purge").expect("get must succeed"), None);
        store
            .purge("lc_purge")
            .expect("repeat purge must be idempotent");
    }

    #[test]
    fn lists_newest_first_with_a_deterministic_tie_break() {
        let store = store();
        for (id, updated_at) in [
            ("lc_b", "2026-09-01T00:00:00Z"),
            ("lc_a", "2026-09-02T00:00:00Z"),
            ("lc_c", "2026-09-02T00:00:00Z"),
        ] {
            let (document, index) = card(id, "character", updated_at, "{}");
            store.put(&document, &index).expect("put");
        }

        let listed = page_of(&store, &default_query(10));
        let ids: Vec<String> = listed
            .iter()
            .map(|document| {
                serde_json::from_str::<serde_json::Value>(document)
                    .expect("row is json")
                    .get("id")
                    .and_then(|value| value.as_str().map(str::to_string))
                    .expect("row has id")
            })
            .collect();
        assert_eq!(ids, vec!["lc_a", "lc_c", "lc_b"]);
    }

    #[test]
    fn keyset_pagination_covers_every_row_exactly_once_across_page_sizes() {
        let store = store();
        // 1000 行正对应 ACCEPT-004 的规模。用分钟粒度造出唯一的 updated_at，
        // 于是分页正确性只取决于 keyset 逻辑，不依赖时间戳碰撞。
        let total = 1000i64;
        for n in 0..total {
            let id = format!("lc_{n:04}");
            let minute = n % 60;
            let hour = n / 60;
            let updated_at = format!("2026-09-30T{hour:02}:{minute:02}:00Z");
            let (document, index) = card(&id, "character", &updated_at, "{}");
            store.put(&document, &index).expect("put");
        }

        for page_size in [1_i64, 7, 100, MAX_LOCAL_CARD_PAGE_SIZE] {
            let mut seen: Vec<String> = Vec::new();
            let mut cursor: Option<LocalCardCursor> = None;
            loop {
                let query = LocalCardQuery {
                    cursor: cursor.clone(),
                    ..default_query(page_size)
                };
                let page = store.list(&query).expect("list must succeed");
                for document in &page.documents {
                    let id = serde_json::from_str::<serde_json::Value>(document)
                        .expect("row is json")
                        .get("id")
                        .and_then(|value| value.as_str().map(str::to_string))
                        .expect("row has id");
                    seen.push(id);
                }
                match page.next_cursor {
                    Some(next) => cursor = Some(next),
                    None => break,
                }
                assert!(seen.len() <= total as usize, "分页不得重复返回行");
            }

            assert_eq!(
                seen.len(),
                total as usize,
                "page_size={page_size} 必须覆盖全部行"
            );
            let unique: std::collections::HashSet<&String> = seen.iter().collect();
            assert_eq!(
                unique.len(),
                seen.len(),
                "page_size={page_size} 不得返回重复行"
            );
        }
    }

    #[test]
    fn pagination_is_unaffected_by_writes_that_land_between_pages() {
        let store = store();
        for n in 0..6i64 {
            let updated_at = format!("2026-01-01T00:0{n}:00Z");
            let (document, index) = card(&format!("lc_{n}"), "character", &updated_at, "{}");
            store.put(&document, &index).expect("put");
        }

        let first = store.list(&default_query(3)).expect("first page");
        assert_eq!(first.documents.len(), 3);
        let cursor = first.next_cursor.expect("there must be a next page");

        // 翻页之间插入一条**更早**的记录：keyset 不会把它塞进已读过的区间，
        // 而 offset 游标会因此重复或漏掉行。
        let (document, index) = card("lc_new", "character", "2020-01-01T00:00:00Z", "{}");
        store.put(&document, &index).expect("insert between pages");

        let second = store
            .list(&LocalCardQuery {
                cursor: Some(cursor),
                ..default_query(3)
            })
            .expect("second page");
        let mut seen: Vec<String> = first
            .documents
            .iter()
            .chain(second.documents.iter())
            .map(|document| {
                serde_json::from_str::<serde_json::Value>(document)
                    .expect("row is json")
                    .get("id")
                    .and_then(|value| value.as_str().map(str::to_string))
                    .expect("row has id")
            })
            .collect();
        seen.sort();

        // 原本的 6 行必须全部出现且各一次；新插入的行只可能出现在后续页，不会挤掉任何一行。
        for n in 0..6i64 {
            let id = format!("lc_{n}");
            assert_eq!(
                seen.iter().filter(|value| **value == id).count(),
                1,
                "{id} 必须恰好出现一次"
            );
        }
    }

    #[test]
    fn filters_by_card_type_without_exposing_the_sql_shape_to_callers() {
        let store = store();
        for (id, card_type) in [
            ("lc_c1", "character"),
            ("lc_s1", "scenario"),
            ("lc_c2", "character"),
            ("lc_h1", "history"),
        ] {
            let updated_at = format!("2026-09-30T00:00:0{}Z", id.chars().last().unwrap());
            let (document, index) = card(id, card_type, &updated_at, "{}");
            store.put(&document, &index).expect("put");
        }

        let characters = LocalCardQuery {
            card_types: vec!["character".to_string()],
            ..default_query(10)
        };
        assert_eq!(page_of(&store, &characters).len(), 2);

        let two_types = LocalCardQuery {
            card_types: vec!["character".to_string(), "history".to_string()],
            ..default_query(10)
        };
        assert_eq!(page_of(&store, &two_types).len(), 3);

        // 空列表表示不筛选，而不是"什么都匹配不到"。
        assert_eq!(page_of(&store, &default_query(10)).len(), 4);
    }

    #[test]
    fn rejects_a_page_size_outside_the_contract_range() {
        let store = store();
        for limit in [0_i64, -1, MAX_LOCAL_CARD_PAGE_SIZE + 1] {
            assert_eq!(
                store.list(&default_query(limit)),
                Err(StoreError::InvalidQuery),
                "limit={limit} 必须被拒绝",
            );
        }
    }

    #[test]
    fn survives_reopening_the_same_database_file() {
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-desktop-card-store-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);

        let paths = LocalStorePaths::under(&root);
        let (document, index) = card(
            "lc_persist",
            "character",
            "2026-09-30T00:00:00Z",
            r#"{"n":1}"#,
        );
        {
            let store = LocalCardStore::open(&paths).expect("open");
            store.put(&document, &index).expect("put");
        }

        let reopened = LocalCardStore::open(&paths).expect("reopen");
        assert_eq!(
            reopened.get("lc_persist").expect("get must succeed"),
            Some(document)
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn error_projection_is_stable_and_carries_no_user_data() {
        for error in [
            StoreError::IndexMismatch,
            StoreError::Tombstoned,
            StoreError::NonMonotonicTimestamp,
            StoreError::InvalidQuery,
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
}
