//! 产品公告的 native 快照与受控刷新（D5.1-P1，`DESK-PARITY-003`）。
//!
//! Desktop 的公告取数走两条互不相识的窄路：
//!
//! - **内置快照**：`content/announcements.json` 经同步清单落进 `dist/`，renderer 用
//!   同源 `fetch('/announcements.json')` 读它——自定义协议伺服本地文件，不是网络请求；
//! - **native 快照 + 刷新**：本模块。`announcements_get_cached` 读上次成功刷新的落盘
//!   快照，`announcements_refresh` 向固定 origin 发一次条件 GET（有 ETag 时），成功才
//!   原子替换快照。renderer 决定何时调用（默认启动一次 + 手动刷新），失败路径上
//!   native 不碰旧快照——「失败保留旧公告」由两条命令的读写顺序共同保证，而不是
//!   靠 renderer 自觉。
//!
//! native 校验**不放宽**：远端 JSON 必须与 `contracts/announcements` 的严格形状一致，
//! 多一个字段、少一个必填、空 id、非法日期都按 `invalid-response` 处理——宁可整条
//! 公告源作废，也不把半截结构写进快照。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// 远端公告的固定路径；origin 由 `cloud::cloud_origin()` 提供（生产固定、dev 编译期可覆写）。
const ANNOUNCEMENTS_PATH: &str = "/announcements.json";
/// 缓存文件名——位于应用数据目录，路径完全由 native 决定。
const CACHE_FILE_NAME: &str = "announcements-cache.json";
/// 公告资源的真实量级是几十 KiB；超过 1 MiB 的响应按异常处理，不往快照里写。
const MAX_ANNOUNCEMENTS_BODY_BYTES: usize = 1024 * 1024;
/// 契约上限：列表至多 200 条。
const MAX_ANNOUNCEMENTS: usize = 200;
const ANNOUNCEMENTS_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnnouncementsErrorCode {
    NetworkError,
    InvalidResponse,
    StorageUnavailable,
    InternalError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementsError {
    pub code: AnnouncementsErrorCode,
    pub message: String,
}

impl AnnouncementsError {
    fn new(code: AnnouncementsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid_response(context: &str) -> Self {
        Self::new(
            AnnouncementsErrorCode::InvalidResponse,
            format!("{context} 返回了无法识别的响应"),
        )
    }
}

/// 单条公告——`contracts/announcements` `AnnouncementSchema`（`.strict()`）的 Rust 镜像。
/// `deny_unknown_fields` 不是洁癖：远端多出的字段在 renderer 端同样过不了 zod，
/// 在这里就拒绝能避免「native 缓存了 renderer 永远拒绝的快照」。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnouncementRecord {
    pub id: String,
    /// `YYYY-MM-DD`；格式由 `valid_announcement_date` 复核。
    pub date: String,
    pub title: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
}

fn valid_announcement_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

/// 与契约字段级校验保持同一判定：id/title/content 非空、长度上界一致。
fn validate_announcement(record: &AnnouncementRecord) -> bool {
    !record.id.is_empty()
        && record.id.len() <= 200
        && valid_announcement_date(&record.date)
        && !record.title.is_empty()
        && record.title.len() <= 500
        && !record.content.is_empty()
        && record.content.len() <= 100_000
        && record.publisher.as_ref().is_none_or(|p| !p.is_empty() && p.len() <= 200)
}

/// 把远端 JSON 解析成已校验的公告数组。结构与字段校验都在这一步，返回 `None`
/// 等价于「公告源不合法」——调用方按 invalid-response 处理，不做部分保留。
pub fn parse_announcement_list(raw: &[u8]) -> Option<Vec<AnnouncementRecord>> {
    let parsed: Vec<AnnouncementRecord> = serde_json::from_slice(raw).ok()?;
    if parsed.len() > MAX_ANNOUNCEMENTS {
        return None;
    }
    if parsed.iter().all(validate_announcement) {
        Some(parsed)
    } else {
        None
    }
}

/// 渲染层消费的快照形状（`desktop-ipc` 契约的 Rust 镜像）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementsSnapshot {
    /// 快照取回时刻的 RFC3339 时间——远端响应或上次缓存写入的同一语义。
    pub fetched_at: String,
    pub announcements: Vec<AnnouncementRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementsRefreshResult {
    pub status: RefreshStatus,
    pub snapshot: AnnouncementsSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefreshStatus {
    Updated,
    NotModified,
}

/// 落盘快照文件。`version` 让将来的形状变更可以显式判读旧文件而不是猜。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CachedFile {
    version: u8,
    fetched_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
    announcements: Vec<AnnouncementRecord>,
}

fn cache_path(data_root: &Path) -> PathBuf {
    data_root.join(CACHE_FILE_NAME)
}

/// 读取并校验缓存。任何一步不合法都返回 `None`——损坏快照与没有快照对
/// 调用方是同一件事：回退到内置快照。
fn read_cache(data_root: &Path) -> Option<CachedFile> {
    let bytes = fs::read(cache_path(data_root)).ok()?;
    let file: CachedFile = serde_json::from_slice(&bytes).ok()?;
    if file.version != 1
        || file.announcements.len() > MAX_ANNOUNCEMENTS
        || !file.announcements.iter().all(validate_announcement)
        || time::OffsetDateTime::parse(&file.fetched_at, &time::format_description::well_known::Rfc3339)
            .is_err()
    {
        return None;
    }
    Some(file)
}

/// 原子写缓存：同目录 tempfile → sync → rename。写失败是 `storage-unavailable`，
/// 已经成功的响应也按失败上报——快照没保住就不宣称已更新。
fn write_cache(data_root: &Path, file: &CachedFile) -> Result<(), AnnouncementsError> {
    let bytes = serde_json::to_vec(file).map_err(|error| {
        AnnouncementsError::new(
            AnnouncementsErrorCode::InternalError,
            format!("公告快照序列化失败：{error}"),
        )
    })?;

    let target = cache_path(data_root);
    let mut temp = tempfile::NamedTempFile::new_in(data_root).map_err(|error| {
        AnnouncementsError::new(
            AnnouncementsErrorCode::StorageUnavailable,
            format!("无法创建公告快照临时文件：{error}"),
        )
    })?;
    use std::io::Write;
    temp.write_all(&bytes).map_err(|error| {
        AnnouncementsError::new(
            AnnouncementsErrorCode::StorageUnavailable,
            format!("公告快照写入失败：{error}"),
        )
    })?;
    temp.flush().ok();
    temp.persist(&target).map_err(|error| {
        AnnouncementsError::new(
            AnnouncementsErrorCode::StorageUnavailable,
            format!("公告快照落盘失败：{error}"),
        )
    })?;
    Ok(())
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// HTTP client：与 cloud 通路同一加固口径——不信任环境代理、不跟随重定向
/// （公告资源是固定路径，重定向意味着被劫持或配置漂移）、只设连接超时，
/// 总时限在请求上显式给出。
pub struct AnnouncementsState {
    client: reqwest::Client,
}

impl AnnouncementsState {
    pub fn new() -> Result<Self, AnnouncementsError> {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(ANNOUNCEMENTS_REQUEST_TIMEOUT)
            .build()
            .map_err(|error| {
                AnnouncementsError::new(
                    AnnouncementsErrorCode::InternalError,
                    format!("公告请求客户端初始化失败：{error}"),
                )
            })?;
        Ok(Self { client })
    }
}

/// `announcements_get_cached`：返回上次成功刷新的快照；没有或损坏返回 `None`。
pub fn get_cached(app: &tauri::AppHandle) -> Option<AnnouncementsSnapshot> {
    let data_root = app.path().app_data_dir().ok()?;
    read_cache(&data_root).map(|file| AnnouncementsSnapshot {
        fetched_at: file.fetched_at,
        announcements: file.announcements,
    })
}

/// `announcements_refresh`：一次条件 GET，成功才替换快照。
///
/// 语义刻意保守：
/// - 远端 304 → 回显既有快照（它之所以有 ETag 就是因为上次完整拿到过）；
/// - 远端 200 → 校验整条列表 → 原子写缓存 → 回显新快照；
/// - 其他任何状态、网络失败、结构不合法 → 错误；旧快照原样保留。
pub async fn refresh(
    app: &tauri::AppHandle,
    state: &AnnouncementsState,
) -> Result<AnnouncementsRefreshResult, AnnouncementsError> {
    let data_root = app.path().app_data_dir().map_err(|error| {
        AnnouncementsError::new(
            AnnouncementsErrorCode::StorageUnavailable,
            format!("无法解析应用数据目录：{error}"),
        )
    })?;

    let cached = read_cache(&data_root);

    let mut request = state
        .client
        .get(format!("{}{}", crate::cloud::cloud_origin(), ANNOUNCEMENTS_PATH))
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(ANNOUNCEMENTS_REQUEST_TIMEOUT);
    if let Some(etag) = cached.as_ref().and_then(|file| file.etag.clone()) {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }

    let response = request.send().await.map_err(|error| {
        AnnouncementsError::new(
            AnnouncementsErrorCode::NetworkError,
            format!("公告刷新请求失败：{error}"),
        )
    })?;

    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        let Some(cached) = cached else {
            return Err(AnnouncementsError::invalid_response("公告服务"));
        };
        return Ok(AnnouncementsRefreshResult {
            status: RefreshStatus::NotModified,
            snapshot: AnnouncementsSnapshot {
                fetched_at: cached.fetched_at,
                announcements: cached.announcements,
            },
        });
    }

    if !response.status().is_success() {
        return Err(AnnouncementsError::new(
            AnnouncementsErrorCode::InvalidResponse,
            format!("公告服务返回了异常状态：{}", response.status()),
        ));
    }

    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let body = response.bytes().await.map_err(|error| {
        AnnouncementsError::new(
            AnnouncementsErrorCode::NetworkError,
            format!("公告响应读取失败：{error}"),
        )
    })?;
    if body.len() > MAX_ANNOUNCEMENTS_BODY_BYTES {
        return Err(AnnouncementsError::invalid_response("公告服务"));
    }

    let announcements = parse_announcement_list(&body)
        .ok_or_else(|| AnnouncementsError::invalid_response("公告服务"))?;

    let fetched_at = now_rfc3339();
    write_cache(
        &data_root,
        &CachedFile {
            version: 1,
            fetched_at: fetched_at.clone(),
            etag,
            announcements: announcements.clone(),
        },
    )?;

    Ok(AnnouncementsRefreshResult {
        status: RefreshStatus::Updated,
        snapshot: AnnouncementsSnapshot {
            fetched_at,
            announcements,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str) -> AnnouncementRecord {
        AnnouncementRecord {
            id: id.to_string(),
            date: "2026-01-01".to_string(),
            title: format!("标题 {id}"),
            content: "正文".to_string(),
            publisher: None,
            pinned: None,
        }
    }

    #[test]
    fn parses_a_valid_list() {
        let raw = serde_json::to_vec(&vec![record("a"), record("b")]).unwrap();
        let parsed = parse_announcement_list(&raw).expect("valid list");
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn rejects_extra_fields_and_bad_values() {
        let mut value = serde_json::to_value(record("a")).unwrap();
        value["platform"] = serde_json::json!("desktop");
        assert!(parse_announcement_list(&serde_json::to_vec(&vec![value]).unwrap()).is_none());

        for mutate in [
            |v: &mut serde_json::Value| v["id"] = serde_json::json!(""),
            |v: &mut serde_json::Value| v["date"] = serde_json::json!("2026/01/01"),
            |v: &mut serde_json::Value| v["title"] = serde_json::json!(""),
            |v: &mut serde_json::Value| v["content"] = serde_json::json!(""),
            |v: &mut serde_json::Value| v["pinned"] = serde_json::json!("yes"),
        ] {
            let mut value = serde_json::to_value(record("a")).unwrap();
            mutate(&mut value);
            assert!(
                parse_announcement_list(&serde_json::to_vec(&vec![value]).unwrap()).is_none()
            );
        }
    }

    #[test]
    fn cache_roundtrip_and_corruption() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_cache(dir.path()).is_none());

        let file = CachedFile {
            version: 1,
            fetched_at: "2026-10-06T12:00:00Z".to_string(),
            etag: Some("\"abc\"".to_string()),
            announcements: vec![record("x")],
        };
        write_cache(dir.path(), &file).unwrap();
        let loaded = read_cache(dir.path()).expect("cache reads back");
        assert_eq!(loaded.announcements[0].id, "x");
        assert_eq!(loaded.etag.as_deref(), Some("\"abc\""));

        // 损坏的缓存按「没有快照」处理，而不是半恢复。
        fs::write(cache_path(dir.path()), b"{not json").unwrap();
        assert!(read_cache(dir.path()).is_none());
    }

    #[test]
    fn rejects_unknown_versions() {
        let dir = tempfile::tempdir().unwrap();
        let file = CachedFile {
            version: 2,
            fetched_at: "2026-10-06T12:00:00Z".to_string(),
            etag: None,
            announcements: vec![record("x")],
        };
        fs::write(
            cache_path(dir.path()),
            serde_json::to_vec(&file).unwrap(),
        )
        .unwrap();
        assert!(read_cache(dir.path()).is_none());
    }
}
