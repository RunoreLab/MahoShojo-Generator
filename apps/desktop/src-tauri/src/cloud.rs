//! Desktop ↔ 项目服务云通路（D5.0c，`SPEC-desktop-client-v1` DESK-090..094）。
//!
//! 冻结的边界：
//!
//! - Desktop 访问项目自有服务的**唯一**通路是本模块：固定 origin、固定路由、
//!   不跟随重定向、只注入账号会话 cookie。renderer 拿不到任意 URL / header 的
//!   请求能力，也拿不到凭据明文。
//! - 登录走 `desktop-auth-v1`：系统浏览器授权页 → loopback `127.0.0.1:<port>/callback`
//!   一次性回跳（PKCE S256 + state）→ `/api/auth/native/exchange` 建立会话。
//! - 账号会话凭据存 OS 凭据存储的 `account-session:*` 命名空间，与
//!   `provider-key:*` 完全隔离；不存在读取凭据的 IPC。
//! - `unreachable`（网络/服务不可用）**不会**删除本地凭据——它与"服务端明确拒绝
//!   会话"是两个不同状态，否则一次断网就等于登出。
//! - 兼容探测只发生在主动使用在线能力时，不阻塞离线启动；hosted 生成在
//!   dispatch 前由 native 强制过这道门禁，而不是靠调用方先自查（DESK-094）。

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::secret::{SecretStore, SecretStoreError};

/// 项目服务的固定生产 origin。renderer 与本模块内任何命令都不能改写它。
const CLOUD_ORIGIN_PRODUCTION: &str = "https://mahoshojo.colanns.me";

/// 开发构建允许经编译期环境变量 `MAHOSHOJO_CLOUD_ORIGIN` 覆盖 origin（DESK-093）。
/// `option_env!` 在构建时把值固化进二进制，运行中设置同名变量不生效；
/// release 构建永远使用生产 origin。
///
/// `pub(crate)`：公告刷新的固定远端也是这个 origin——它同样不得由 renderer 改写。
pub(crate) fn cloud_origin() -> String {
    #[cfg(debug_assertions)]
    {
        if let Some(origin) = option_env!("MAHOSHOJO_CLOUD_ORIGIN") {
            let trimmed = origin.trim();
            if is_allowed_dev_origin(trimmed) {
                return trimmed.to_string();
            }
        }
    }
    CLOUD_ORIGIN_PRODUCTION.to_string()
}

/// 开发 origin 覆盖的安全边界：只允许 https 或 loopback http。
/// 防止开发期把凭据发到明文非 loopback 地址。
#[cfg(debug_assertions)]
fn is_allowed_dev_origin(origin: &str) -> bool {
    if let Ok(url) = url::Url::parse(origin) {
        if url.scheme() == "https" {
            return true;
        }
        if url.scheme() == "http" {
            let host = url.host_str().unwrap_or_default();
            return host == "127.0.0.1" || host == "localhost" || host == "::1";
        }
    }
    false
}

// 与 `packages/contracts/fixtures/desktop-cloud.json` 同源的路径/协议常量；
// 一致性由本文件的 fixture 测试断言，不允许单侧漂移（DESK-033 同款门禁）。
const AUTHORIZE_PATH: &str = "/auth/desktop";
const EXCHANGE_PATH: &str = "/api/auth/native/exchange";
const GET_SESSION_PATH: &str = "/api/auth/get-session";
const SIGN_OUT_PATH: &str = "/api/auth/sign-out";
const DR_READINESS_PATH: &str = "/api/hosted/dr-readiness";
const HOSTED_GENERATE_DETAILS_STREAM_PATH: &str = "/api/generate-magical-girl-details-stream";
const HOSTED_ROUTE_DETAILS_STREAM: &str = "generate-magical-girl-details-stream";
const HOSTED_GENERATE_DETAILS_PATH: &str = "/api/generate-magical-girl-details";
const HOSTED_ROUTE_DETAILS: &str = "generate-magical-girl-details";
const PROTOCOL_VERSION: &str = "desktop-auth-v1";
const LOOPBACK_CALLBACK_PATH: &str = "/callback";
const HOSTED_CONTRACT_VERSION: &str = "g25e1-v1";

/// 账号会话凭据的 keyring 引用。与 `provider-key:*` 命名空间完全隔离（DESK-092）。
const ACCOUNT_SESSION_REF: &str = "account-session:web-v1";

/// hosted 流允许转发的事件名（与 fixture `hostedGenerationEventNames` 同源）。
const HOSTED_EVENT_NAMES: &[&str] = &[
    "markdown",
    "reasoning",
    "reasoning_done",
    "telemetry",
    "done",
    "error",
];

/// 登录流程总时限。用户需要在浏览器里完成登录/授权，15 分钟是宽松上限。
const LOGIN_DEADLINE: Duration = Duration::from_secs(15 * 60);
/// 短请求（exchange / 状态 / 注销 / 探测）的总请求超时，兼作 client 连接超时。
/// 绝不能套用到 hosted SSE：reqwest 的 `timeout` 是从连接一直到 response
/// body 完成的总 deadline，长流会被强制截断；流的时限由服务端 idle/total
/// 上限与取消令牌负责。
const SHORT_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// loopback 回调请求的最大读取量。合法请求只有一行 GET + 少量 header。
const CALLBACK_MAX_BYTES: usize = 16 * 1024;
/// 单次回调读取超时：防本地进程占着连接不发数据。
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CloudErrorCode {
    NotAuthenticated,
    FlowNotFound,
    FlowInProgress,
    Cancelled,
    Timeout,
    StateMismatch,
    ProtocolMismatch,
    NetworkError,
    ServerUnavailable,
    InvalidResponse,
    StorageUnavailable,
    InvalidRequest,
    InternalError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudError {
    pub code: CloudErrorCode,
    pub message: String,
}

impl CloudError {
    pub fn new(code: CloudErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn from_secret_store(error: &SecretStoreError) -> Self {
        Self::new(
            CloudErrorCode::StorageUnavailable,
            format!("操作系统凭据存储不可用：{}", error.message),
        )
    }

    fn network(context: &str, error: &reqwest::Error) -> Self {
        Self::new(
            CloudErrorCode::NetworkError,
            format!("{context} 网络请求失败：{error}"),
        )
    }

    fn invalid_response(context: &str) -> Self {
        Self::new(
            CloudErrorCode::InvalidResponse,
            format!("{context} 返回了无法识别的响应"),
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudLoginBeginResponse {
    pub flow_id: String,
    pub authorize_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAccountSummary {
    pub user_id: u64,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CloudLoginOutcome {
    SignedIn {
        account: CloudAccountSummary,
        session_expires_at: String,
    },
    Cancelled,
    Failed {
        code: CloudErrorCode,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CloudSessionStatus {
    SignedOut,
    Active {
        account: CloudAccountSummary,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_expires_at: Option<String>,
    },
    Expired,
    Unreachable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSignOutResult {
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudOnlineStatus {
    pub reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_version: Option<String>,
    pub compatible: Option<bool>,
}

/* ── 存储在 keyring 里的会话记录 ───────────────────────────────────────── */

/// `ACCOUNT_SESSION_REF` 下的 JSON 载荷。credential（cookie）与展示元数据
/// 原子读写，避免"凭据还在但账号摘要丢失"的中间态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    /// `name=value` 形式的完整会话 cookie 对（BA 签名值）。
    cookie: String,
    session_expires_at: Option<String>,
    account: CloudAccountRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudAccountRecord {
    user_id: u64,
    username: String,
    display_name: Option<String>,
}

impl From<&CloudAccountRecord> for CloudAccountSummary {
    fn from(record: &CloudAccountRecord) -> Self {
        Self {
            user_id: record.user_id,
            username: record.username.clone(),
            display_name: record.display_name.clone(),
        }
    }
}

fn store_session(secrets: &dyn SecretStore, session: &StoredSession) -> Result<(), CloudError> {
    let value = serde_json::to_string(session)
        .map_err(|_| CloudError::new(CloudErrorCode::InternalError, "会话记录序列化失败"))?;
    secrets
        .set(ACCOUNT_SESSION_REF, &value)
        .map_err(|error| CloudError::from_secret_store(&error))
}

fn load_session(secrets: &dyn SecretStore) -> Result<Option<StoredSession>, CloudError> {
    let raw = secrets
        .resolve(ACCOUNT_SESSION_REF)
        .map_err(|error| CloudError::from_secret_store(&error))?;
    let Some(raw) = raw else { return Ok(None) };
    match serde_json::from_str::<StoredSession>(&raw) {
        Ok(session) => Ok(Some(session)),
        // 记录损坏视为未登录而不是崩溃：损坏数据不可用，但也不该再留着误导后续判断。
        Err(_) => {
            let _ = secrets.delete(ACCOUNT_SESSION_REF);
            Ok(None)
        }
    }
}

fn clear_session(secrets: &dyn SecretStore) -> Result<(), CloudError> {
    secrets
        .delete(ACCOUNT_SESSION_REF)
        .map_err(|error| CloudError::from_secret_store(&error))
}

/* ── HTTP 客户端与请求构造 ─────────────────────────────────────────────── */

fn build_cloud_client() -> Result<reqwest::Client, CloudError> {
    reqwest::Client::builder()
        // 与 Direct 通路一致：不信任环境代理（凭据不经过第三方转发）。
        .no_proxy()
        // 项目 API 不应发生重定向；跟随重定向可能把 cookie 带到未审计目标。
        .redirect(reqwest::redirect::Policy::none())
        // 只保留连接超时。client 级 `timeout` 是「连接 + 整个 response body」
        // 的总 deadline——hosted SSE 超过它会被 reqwest 主动截断；短请求的
        // 总时限在各 RequestBuilder 上显式设置（SHORT_REQUEST_TIMEOUT）。
        .connect_timeout(SHORT_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| {
            CloudError::new(
                CloudErrorCode::InternalError,
                format!("cloud client 初始化失败：{error}"),
            )
        })
}

fn base_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    origin: &str,
    path: &str,
) -> reqwest::RequestBuilder {
    // Origin 固定为服务 origin：BA originCheck 只在带 Cookie 时校验，而 baseURL
    // origin 恒为 trusted，因此该值对带凭据请求始终合法，对无凭据请求无害。
    client
        .request(method, format!("{origin}{path}"))
        .header(reqwest::header::ORIGIN, origin)
        .header(reqwest::header::ACCEPT, "application/json")
}

fn authed_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    origin: &str,
    path: &str,
    session: &StoredSession,
) -> reqwest::RequestBuilder {
    base_request(client, method, origin, path).header(reqwest::header::COOKIE, &session.cookie)
}

/* ── PKCE / state / 随机数 ─────────────────────────────────────────────── */

fn random_base64url(byte_count: usize) -> Result<String, CloudError> {
    let mut bytes = vec![0u8; byte_count];
    getrandom::fill(&mut bytes)
        .map_err(|_| CloudError::new(CloudErrorCode::InternalError, "无法生成登录所需的随机数"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn build_authorize_url(origin: &str, state: &str, challenge: &str, redirect_uri: &str) -> String {
    let mut url = url::Url::parse(&format!("{origin}{AUTHORIZE_PATH}"))
        .expect("fixed authorize path must parse");
    url.query_pairs_mut()
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("redirect_uri", redirect_uri);
    url.to_string()
}

/* ── loopback 回跳监听 ─────────────────────────────────────────────────── */

#[derive(Debug)]
struct CallbackOutcome {
    code: String,
}

const CALLBACK_OK_HTML: &str = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>MahoShojo</title></head><body style=\"font-family:sans-serif;text-align:center;padding-top:4em\"><h2>授权完成</h2><p>可以关闭本页并返回 MahoShojo 桌面客户端。</p></body></html>";
const CALLBACK_REJECT_HTML: &str = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>MahoShojo</title></head><body style=\"font-family:sans-serif;text-align:center;padding-top:4em\"><h2>授权失败</h2><p>回跳参数无效，请返回桌面客户端重新发起登录。</p></body></html>";

fn parse_callback_request(
    request_head: &str,
    expected_state: &str,
) -> Result<CallbackOutcome, CloudError> {
    let request_line = request_head
        .lines()
        .next()
        .ok_or_else(|| CloudError::new(CloudErrorCode::InvalidResponse, "空的回跳请求"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" {
        return Err(CloudError::new(
            CloudErrorCode::InvalidResponse,
            "回跳只接受 GET 请求",
        ));
    }
    let parsed = url::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| CloudError::new(CloudErrorCode::InvalidResponse, "回跳目标无法解析"))?;
    if parsed.path() != LOOPBACK_CALLBACK_PATH {
        return Err(CloudError::new(
            CloudErrorCode::InvalidResponse,
            "回跳路径不匹配",
        ));
    }
    let mut code = None;
    let mut state = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        // state 不匹配 = 跨站伪造或串流的证据，fail closed 立即终止本次登录。
        return Err(CloudError::new(
            CloudErrorCode::StateMismatch,
            "回跳 state 与本次登录不匹配",
        ));
    }
    let code =
        code.ok_or_else(|| CloudError::new(CloudErrorCode::InvalidResponse, "回跳缺少授权码"))?;
    if code.len() != 43
        || !code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(CloudError::new(
            CloudErrorCode::InvalidResponse,
            "回跳授权码形态非法",
        ));
    }
    Ok(CallbackOutcome { code })
}

async fn write_callback_response(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// 监听单次 loopback 回跳。
///
/// 只接受一次有效回调就关闭监听；任何非匹配请求也立即终止流程（state 校验
/// 失败是 CSRF 证据，继续等待只会让攻击面变长而不是更安全）。
async fn run_callback_listener(
    listener: tokio::net::TcpListener,
    expected_state: String,
    cancel: CancellationToken,
    deadline: Instant,
    sender: oneshot::Sender<Result<CallbackOutcome, CloudError>>,
) {
    let outcome = async {
        let accept = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                return Err(CloudError::new(CloudErrorCode::Cancelled, "登录已取消"));
            }
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => {
                return Err(CloudError::new(CloudErrorCode::Timeout, "等待浏览器授权超时"));
            }
            result = listener.accept() => result,
        };
        let (mut stream, _peer): (tokio::net::TcpStream, SocketAddr) = accept.map_err(|error| {
            CloudError::new(
                CloudErrorCode::InternalError,
                format!("回跳监听失败：{error}"),
            )
        })?;

        let mut buffer = Vec::with_capacity(1024);
        let head = loop {
            if buffer.len() >= CALLBACK_MAX_BYTES {
                return Err(CloudError::new(
                    CloudErrorCode::InvalidResponse,
                    "回跳请求超出大小上限",
                ));
            }
            let read = tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    return Err(CloudError::new(CloudErrorCode::Cancelled, "登录已取消"));
                }
                result = tokio::time::timeout(CALLBACK_READ_TIMEOUT, stream.read_buf(&mut buffer)) => {
                    result.map_err(|_| {
                        CloudError::new(CloudErrorCode::Timeout, "回跳请求读取超时")
                    })?
                    .map_err(|error| {
                        CloudError::new(CloudErrorCode::NetworkError, format!("回跳读取失败：{error}"))
                    })?
                }
            };
            if read == 0 {
                return Err(CloudError::new(
                    CloudErrorCode::InvalidResponse,
                    "回跳连接被对端关闭",
                ));
            }
            if let Some(end) = find_subslice(&buffer, b"\r\n\r\n") {
                break String::from_utf8_lossy(&buffer[..end]).to_string();
            }
        };

        match parse_callback_request(&head, &expected_state) {
            Ok(outcome) => {
                write_callback_response(&mut stream, "200 OK", CALLBACK_OK_HTML).await;
                Ok(outcome)
            }
            Err(error) => {
                write_callback_response(&mut stream, "400 Bad Request", CALLBACK_REJECT_HTML).await;
                Err(error)
            }
        }
    }
    .await;

    let _ = sender.send(outcome);
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/* ── 登录流程状态 ──────────────────────────────────────────────────────── */

struct LoginFlow {
    /// PKCE verifier 只存在于 native 内存，从不进 IPC 返回值。
    verifier: String,
    cancel: CancellationToken,
    deadline: Instant,
    receiver: Mutex<Option<oneshot::Receiver<Result<CallbackOutcome, CloudError>>>>,
}

/// 云通路的 managed state：HTTP client、origin 与进行中的登录流程表。
pub struct CloudState {
    http: reqwest::Client,
    origin: String,
    flows: Mutex<HashMap<String, Arc<LoginFlow>>>,
}

impl CloudState {
    pub fn new() -> Result<Self, CloudError> {
        Ok(Self {
            http: build_cloud_client()?,
            origin: cloud_origin(),
            flows: Mutex::new(HashMap::new()),
        })
    }

    /// 测试专用：把 origin 指向 mock server。
    #[cfg(test)]
    fn with_origin(origin: &str) -> Self {
        Self {
            http: build_cloud_client().expect("test cloud client"),
            origin: origin.to_string(),
            flows: Mutex::new(HashMap::new()),
        }
    }

    fn lookup_flow(&self, flow_id: &str) -> Result<Arc<LoginFlow>, CloudError> {
        self.flows
            .lock()
            .map_err(|_| CloudError::new(CloudErrorCode::InternalError, "登录流程表不可用"))?
            .get(flow_id)
            .cloned()
            .ok_or_else(|| CloudError::new(CloudErrorCode::FlowNotFound, "登录流程不存在或已结束"))
    }

    fn remove_flow(&self, flow_id: &str) {
        if let Ok(mut flows) = self.flows.lock() {
            flows.remove(flow_id);
        }
    }
}

/* ── exchange 响应解析 ─────────────────────────────────────────────────── */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeResponse {
    #[allow(dead_code)]
    protocol_version: Option<String>,
    account: ExchangeAccount,
    session_expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeAccount {
    user_id: u64,
    username: String,
    display_name: Option<String>,
}

/// 从 `Set-Cookie` 中提取 Better Auth 会话 cookie 对（`name=value`）。
/// 兼容 `__Secure-` 前缀名；其余 cookie（session_data 缓存等）不存。
fn extract_ba_session_cookie(headers: &reqwest::header::HeaderMap) -> Option<String> {
    for value in headers.get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        let Some(pair) = text.split(';').next() else {
            continue;
        };
        let pair = pair.trim();
        if pair.starts_with("better-auth.session_token=")
            || pair.starts_with("__Secure-better-auth.session_token=")
        {
            return Some(pair.to_string());
        }
    }
    None
}

async fn exchange_grant(
    state: &CloudState,
    code: &str,
    verifier: &str,
) -> Result<StoredSession, CloudError> {
    let body = serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "code": code,
        "codeVerifier": verifier,
    });
    let response = base_request(
        &state.http,
        reqwest::Method::POST,
        &state.origin,
        EXCHANGE_PATH,
    )
    .header(reqwest::header::CONTENT_TYPE, "application/json")
    .json(&body)
    .timeout(SHORT_REQUEST_TIMEOUT)
    .send()
    .await
    .map_err(|error| CloudError::network("会话交换", &error))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let code = match status {
            400 | 401 | 403 => CloudErrorCode::NotAuthenticated,
            429 => CloudErrorCode::ServerUnavailable,
            _ => CloudErrorCode::ServerUnavailable,
        };
        return Err(CloudError::new(
            code,
            format!("会话交换被拒绝（HTTP {status}），请重新发起登录"),
        ));
    }

    let cookie = extract_ba_session_cookie(response.headers()).ok_or_else(|| {
        CloudError::new(CloudErrorCode::InvalidResponse, "交换响应缺少会话 cookie")
    })?;

    let payload = response
        .json::<ExchangeResponse>()
        .await
        .map_err(|_| CloudError::invalid_response("会话交换"))?;

    if payload.protocol_version.as_deref() != Some(PROTOCOL_VERSION) {
        return Err(CloudError::new(
            CloudErrorCode::ProtocolMismatch,
            "服务端授权协议版本与客户端不匹配，请升级应用",
        ));
    }

    Ok(StoredSession {
        cookie,
        session_expires_at: Some(payload.session_expires_at),
        account: CloudAccountRecord {
            user_id: payload.account.user_id,
            username: payload.account.username,
            display_name: payload.account.display_name,
        },
    })
}

/* ── 命令实现 ──────────────────────────────────────────────────────────── */

/// 打开系统浏览器到授权页。测试构建不触碰宿主浏览器（单测不能弹出 UI）。
#[cfg(not(test))]
fn open_authorize_url(authorize_url: &str) {
    if let Err(error) = open::that(authorize_url) {
        eprintln!("mahoshojo: 自动打开系统浏览器失败（{error}），授权 URL 已提供给用户手动访问");
    }
}

#[cfg(test)]
fn open_authorize_url(_authorize_url: &str) {}

/// `cloud_login_begin`：绑定 loopback listener、生成 state+PKCE、打开系统浏览器。
pub async fn cloud_login_begin(state: &CloudState) -> Result<CloudLoginBeginResponse, CloudError> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| {
            CloudError::new(
                CloudErrorCode::InternalError,
                format!("无法绑定回跳监听：{error}"),
            )
        })?;
    let port = listener
        .local_addr()
        .map_err(|error| {
            CloudError::new(
                CloudErrorCode::InternalError,
                format!("无法读取回跳端口：{error}"),
            )
        })?
        .port();

    let flow_id = random_base64url(16)?;
    let pkce_state = random_base64url(32)?;
    let verifier = random_base64url(48)?;
    let challenge = pkce_challenge(&verifier);
    let redirect_uri = format!("http://127.0.0.1:{port}{LOOPBACK_CALLBACK_PATH}");
    let authorize_url = build_authorize_url(&state.origin, &pkce_state, &challenge, &redirect_uri);

    let cancel = CancellationToken::new();
    let (sender, receiver) = oneshot::channel();
    let deadline = Instant::now() + LOGIN_DEADLINE;

    tokio::spawn(run_callback_listener(
        listener,
        pkce_state,
        cancel.clone(),
        deadline,
        sender,
    ));

    state
        .flows
        .lock()
        .map_err(|_| CloudError::new(CloudErrorCode::InternalError, "登录流程表不可用"))?
        .insert(
            flow_id.clone(),
            Arc::new(LoginFlow {
                verifier,
                cancel,
                deadline,
                receiver: Mutex::new(Some(receiver)),
            }),
        );

    // 浏览器打开失败不致命：URL 已返回给 renderer，用户可手动复制。
    open_authorize_url(&authorize_url);

    Ok(CloudLoginBeginResponse {
        flow_id,
        authorize_url,
    })
}

/// `cloud_login_await`：等待回跳 → 交换会话 → 存凭据。每个 flow 只消费一次。
pub async fn cloud_login_await(
    state: &CloudState,
    flow_id: &str,
    secrets: &dyn SecretStore,
) -> Result<CloudLoginOutcome, CloudError> {
    let flow = state.lookup_flow(flow_id)?;

    // 只有取到 receiver 的消费者才有资格在 terminal path 移除 flow——重复 await
    // 只返回 FlowInProgress，不得碰仍在进行的登录（否则后续 cancel 找不到 flow）。
    let receiver = {
        let mut slot = flow
            .receiver
            .lock()
            .map_err(|_| CloudError::new(CloudErrorCode::InternalError, "登录流程状态不可用"))?;
        slot.take().ok_or_else(|| {
            CloudError::new(CloudErrorCode::FlowInProgress, "该登录流程已在等待中")
        })?
    };

    let outcome = async {
        let callback = tokio::select! {
            biased;
            _ = flow.cancel.cancelled() => {
                return Err(CloudError::new(CloudErrorCode::Cancelled, "登录已取消"));
            }
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(flow.deadline)) => {
                return Err(CloudError::new(CloudErrorCode::Timeout, "等待浏览器授权超时"));
            }
            result = receiver => {
                result.map_err(|_| {
                    CloudError::new(CloudErrorCode::InternalError, "回跳通道被意外关闭")
                })?
            }
        }?;

        let session = tokio::select! {
            biased;
            _ = flow.cancel.cancelled() => {
                return Err(CloudError::new(CloudErrorCode::Cancelled, "登录已取消"));
            }
            result = exchange_grant(state, &callback.code, &flow.verifier) => result,
        }?;

        store_session(secrets, &session)?;
        Ok(session)
    }
    .await;

    state.remove_flow(flow_id);

    Ok(match outcome {
        Ok(session) => CloudLoginOutcome::SignedIn {
            account: CloudAccountSummary::from(&session.account),
            session_expires_at: session.session_expires_at.unwrap_or_default(),
        },
        Err(error) if error.code == CloudErrorCode::Cancelled => CloudLoginOutcome::Cancelled,
        Err(error) => CloudLoginOutcome::Failed {
            code: error.code,
            message: error.message,
        },
    })
}

/// `cloud_login_cancel`：显式取消一个进行中的登录流程。
pub fn cloud_login_cancel(state: &CloudState, flow_id: &str) -> bool {
    let flow = match state.lookup_flow(flow_id) {
        Ok(flow) => flow,
        Err(_) => return false,
    };
    flow.cancel.cancel();
    state.remove_flow(flow_id);
    true
}

/* ── 会话状态 / 注销 / 在线探测 ────────────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct GetSessionResponse {
    session: Option<serde_json::Value>,
    #[allow(dead_code)]
    user: Option<serde_json::Value>,
}

/// `cloud_auth_status`：本地凭据 + 服务端确认，区分 unreachable / expired。
pub async fn cloud_auth_status(
    state: &CloudState,
    secrets: &dyn SecretStore,
) -> Result<CloudSessionStatus, CloudError> {
    let Some(session) = load_session(secrets)? else {
        return Ok(CloudSessionStatus::SignedOut);
    };

    let response = authed_request(
        &state.http,
        reqwest::Method::GET,
        &state.origin,
        GET_SESSION_PATH,
        &session,
    )
    .timeout(SHORT_REQUEST_TIMEOUT)
    .send()
    .await;

    let response = match response {
        Ok(response) => response,
        Err(_) => return Ok(CloudSessionStatus::Unreachable),
    };

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        // 服务端明确否认会话：本地凭据已无意义，清掉并如实报告。
        clear_session(secrets)?;
        return Ok(CloudSessionStatus::Expired);
    }
    if !response.status().is_success() {
        return Ok(CloudSessionStatus::Unreachable);
    }

    let payload = response
        .json::<GetSessionResponse>()
        .await
        .map_err(|_| CloudError::invalid_response("会话状态查询"))?;

    match payload.session {
        Some(session_value) if !session_value.is_null() => Ok(CloudSessionStatus::Active {
            account: CloudAccountSummary::from(&session.account),
            session_expires_at: session.session_expires_at.clone(),
        }),
        _ => {
            clear_session(secrets)?;
            Ok(CloudSessionStatus::Expired)
        }
    }
}

/// `cloud_sign_out`：本地凭据无条件删除；服务端注销失败只影响 `revoked` 标记。
pub async fn cloud_sign_out(
    state: &CloudState,
    secrets: &dyn SecretStore,
) -> Result<CloudSignOutResult, CloudError> {
    let session = load_session(secrets)?;
    let mut revoked = false;
    if let Some(session) = session {
        let response = authed_request(
            &state.http,
            reqwest::Method::POST,
            &state.origin,
            SIGN_OUT_PATH,
            &session,
        )
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({}))
        .timeout(SHORT_REQUEST_TIMEOUT)
        .send()
        .await;
        revoked = response.map(|r| r.status().is_success()).unwrap_or(false);
    }
    clear_session(secrets)?;
    Ok(CloudSignOutResult { revoked })
}

/* ── hosted 契约版本兼容（复用 g25eN-vM 规则） ─────────────────────────── */

fn parse_hosted_contract_version(value: &str) -> Option<(u32, u32)> {
    let rest = value.strip_prefix("g25e")?;
    let (family_str, version_str) = rest.split_once("-v")?;
    let family = family_str.parse::<u32>().ok()?;
    let version = version_str.parse::<u32>().ok()?;
    Some((family, version))
}

/// 与 `isHostedDrContractVersionCompatible` 同规则：family 相同且版本差 ≤1。
pub fn is_hosted_contract_compatible(runtime_version: &str, client_version: &str) -> bool {
    match (
        parse_hosted_contract_version(runtime_version),
        parse_hosted_contract_version(client_version),
    ) {
        (Some((rf, rv)), Some((cf, cv))) => rf == cf && rv.abs_diff(cv) <= 1,
        _ => false,
    }
}

/// `dr-readiness` 探测的内部结论。`cloud_online_status` 只把它投影给 UI；
/// `stream_hosted_ai` 在 dispatch 前用它做强制门禁（DESK-094：探测不可达或
/// 契约不兼容时对应在线操作 MUST 停止），调用方不能只靠 UI 先自查。
enum HostedCompatibility {
    /// 传输失败或非 2xx：不可达，不下兼容结论。
    Unreachable,
    /// 可达且服务端声明的契约版本与客户端兼容。
    Ready { contract_version: String },
    /// 可达但声明的契约版本与客户端不兼容。
    Incompatible { contract_version: String },
    /// 可达但未声明 `contractVersion`（或字段不是字符串）：无法确认兼容性，
    /// 所有消费方必须按 fail-closed 处理，不能当作「兼容」。
    VersionUnknown,
}

async fn probe_hosted_compatibility(
    state: &CloudState,
    session: Option<&StoredSession>,
) -> Result<HostedCompatibility, CloudError> {
    let request = match session {
        Some(session) => authed_request(
            &state.http,
            reqwest::Method::GET,
            &state.origin,
            DR_READINESS_PATH,
            session,
        ),
        None => base_request(
            &state.http,
            reqwest::Method::GET,
            &state.origin,
            DR_READINESS_PATH,
        ),
    };

    let response = match request.timeout(SHORT_REQUEST_TIMEOUT).send().await {
        Ok(response) => response,
        Err(_) => return Ok(HostedCompatibility::Unreachable),
    };

    if !response.status().is_success() {
        return Ok(HostedCompatibility::Unreachable);
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| CloudError::invalid_response("在线状态探测"))?;

    let contract_version = payload
        .get("contractVersion")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    Ok(match contract_version {
        None => HostedCompatibility::VersionUnknown,
        Some(version) if is_hosted_contract_compatible(&version, HOSTED_CONTRACT_VERSION) => {
            HostedCompatibility::Ready {
                contract_version: version,
            }
        }
        Some(version) => HostedCompatibility::Incompatible {
            contract_version: version,
        },
    })
}

/// `cloud_online_status`：主动使用在线能力时的最小探测（`/api/hosted/dr-readiness`）。
/// 只是 `probe_hosted_compatibility` 的 UI 投影——探测本身不改变任何本地数据。
pub async fn cloud_online_status(
    state: &CloudState,
    secrets: &dyn SecretStore,
) -> Result<CloudOnlineStatus, CloudError> {
    let session = load_session(secrets)?;
    Ok(
        match probe_hosted_compatibility(state, session.as_ref()).await? {
            HostedCompatibility::Unreachable => CloudOnlineStatus {
                reachable: false,
                contract_version: None,
                compatible: None,
            },
            HostedCompatibility::VersionUnknown => CloudOnlineStatus {
                reachable: true,
                contract_version: None,
                compatible: None,
            },
            HostedCompatibility::Ready { contract_version } => CloudOnlineStatus {
                reachable: true,
                contract_version: Some(contract_version),
                compatible: Some(true),
            },
            HostedCompatibility::Incompatible { contract_version } => CloudOnlineStatus {
                reachable: true,
                contract_version: Some(contract_version),
                compatible: Some(false),
            },
        },
    )
}

/* ── hosted 生成适配（当前只开放系统默认通道） ────────────────────────────
 *
 * renderer 只能声明 requestId / routeId / body：
 * - `body` 不得携带 `customProvider`——native 是唯一注入方；
 * - 服务器 BYOK 在 native 持有并校验的 Provider 绑定落地前保持关闭（DESK-093）：
 *   `byok`/`secretRef`/`providerId`/`modelId` 等字段由 `deny_unknown_fields`
 *   在 IPC 反序列化时直接拒绝，renderer 没有自选服务端凭据的通道。
 * - native 不依赖 renderer 侧的 schema 校验，输入在 Rust 侧独立 fail-closed。
 */

/// hosted 生成请求 body 序列化后的字节上限（bounded input）。
const HOSTED_BODY_MAX_BYTES: usize = 256 * 1024;
/// hosted SSE 单帧上限：帧超过即视为上游协议异常。
const HOSTED_SSE_MAX_FRAME_BYTES: usize = 512 * 1024;
/// hosted SSE 待解析缓冲上限（未闭合残帧不得无限堆积）。
const HOSTED_SSE_MAX_BUFFER_BYTES: usize = 1024 * 1024;
/// 非 SSE 错误响应体的最大读取量。
const HOSTED_ERROR_BODY_MAX_BYTES: usize = 64 * 1024;
/// hosted 非流式 JSON 响应正文上限：生成卡 + aiMeta 包装远小于它。
const HOSTED_JSON_RESPONSE_MAX_BYTES: usize = 4 * 1024 * 1024;
/// 非流式生成的传输总时限：模型生成是秒级到分钟级操作，不能套用
/// SHORT_REQUEST_TIMEOUT；仍保持有界——挂死连接不能永久占用 requestId。
const HOSTED_JSON_REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
/// 要求服务端在 JSON 响应里携带 `{data, aiMeta}` 包装的请求头（与 Web
/// 客户端一致），让非流式结果也能带模型/用量/推理信息。
const HOSTED_AI_META_HEADER: &str = "x-mahoshojo-ai-meta";
const HOSTED_AI_META_VALUE: &str = "1";

/// hosted SSE 事件：名称 + JSON 载荷，与 `HostedGenerationEventSchema` 同形。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedSseEvent {
    pub event: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudHostedGenerateRequest {
    pub request_id: String,
    pub route_id: String,
    pub body: serde_json::Value,
}

fn invalid_request(message: impl Into<String>) -> CloudError {
    CloudError::new(CloudErrorCode::InvalidRequest, message)
}

/// 组装最终请求体：校验业务 body 形态与大小。
/// renderer 提供的 body 里出现 `customProvider` 一律拒绝（凭据注入只发生在
/// native 侧，当前无开放通道，更不允许 renderer 预置）。
fn build_hosted_request_body(
    request: &CloudHostedGenerateRequest,
) -> Result<serde_json::Value, CloudError> {
    let serde_json::Value::Object(body) = &request.body else {
        return Err(invalid_request("生成请求 body 必须是 JSON 对象"));
    };
    if body.contains_key("customProvider") {
        return Err(invalid_request(
            "customProvider 只能由 native 注入，renderer 不得携带",
        ));
    }
    let size = serde_json::to_vec(&request.body)
        .map_err(|_| invalid_request("生成请求 body 无法序列化"))?
        .len();
    if size > HOSTED_BODY_MAX_BYTES {
        return Err(invalid_request("生成请求 body 超出大小上限"));
    }
    Ok(request.body.clone())
}

/// 增量 SSE 帧解析器：按 `\n\n` 或 `\r\n\r\n` 切帧，每帧取 `event:`/`data:` 行。
/// 只转发 `HOSTED_EVENT_NAMES` 中的事件名；未知事件按契约忽略，
/// data 非 JSON 的帧跳过（不强行接受未来格式，也不中断整条流）。
/// 缓冲与单帧均有上限：对端不发送帧边界的流不能无限占用内存。
struct HostedSseParser {
    buffer: String,
}

/// 查找最早的帧边界（标准 SSE 允许 `\n\n` 与 `\r\n\r\n` 两种分隔）。
/// 返回 `(帧尾偏移, 分隔符长度)`。
fn find_sse_frame_boundary(buffer: &str) -> Option<(usize, usize)> {
    let lf = buffer.find("\n\n").map(|index| (index, 2));
    let crlf = buffer.find("\r\n\r\n").map(|index| (index, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (a, None) => a,
        (None, b) => b,
    }
}

impl HostedSseParser {
    fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    fn push(&mut self, chunk: &str, sink: &mut Vec<HostedSseEvent>) -> Result<(), CloudError> {
        self.buffer.push_str(chunk);
        while let Some((end, delimiter)) = find_sse_frame_boundary(&self.buffer) {
            if end > HOSTED_SSE_MAX_FRAME_BYTES {
                return Err(CloudError::new(
                    CloudErrorCode::InvalidResponse,
                    "生成流单帧超出大小上限",
                ));
            }
            let frame = self.buffer[..end].to_string();
            self.buffer.drain(..end + delimiter);
            let mut event_name = None;
            let mut data_lines: Vec<&str> = Vec::new();
            for line in frame.lines() {
                if let Some(name) = line.strip_prefix("event:") {
                    event_name = Some(name.trim().to_string());
                } else if let Some(data) = line.strip_prefix("data:") {
                    data_lines.push(data.trim_start());
                }
            }
            let Some(name) = event_name else { continue };
            if !HOSTED_EVENT_NAMES.contains(&name.as_str()) {
                continue;
            }
            let data_text = data_lines.join("\n");
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_text) {
                sink.push(HostedSseEvent { event: name, data });
            }
        }
        if self.buffer.len() > HOSTED_SSE_MAX_BUFFER_BYTES {
            return Err(CloudError::new(
                CloudErrorCode::InvalidResponse,
                "生成流缓冲超出大小上限",
            ));
        }
        Ok(())
    }

    /// 流尾可能有一帧没有结尾分隔符的残帧——按同样规则尝试消费。
    fn finish(&mut self, sink: &mut Vec<HostedSseEvent>) -> Result<(), CloudError> {
        if !self.buffer.trim().is_empty() {
            self.buffer.push('\n');
            self.push("\n", sink)?;
        }
        Ok(())
    }
}

fn hosted_error_event(message: &str, code: &str) -> HostedSseEvent {
    HostedSseEvent {
        event: "error".to_string(),
        data: serde_json::json!({
            "ok": false,
            "error": message,
            "code": code,
        }),
    }
}

/// 服务端 `done`/`error` 是流上唯一的两种终态。
fn is_hosted_terminal_event(event: &HostedSseEvent) -> bool {
    matches!(event.event.as_str(), "done" | "error")
}

/// 有界读取错误响应体：诊断信息不需要完整 body，超限部分直接截断。
async fn read_bounded_text(response: reqwest::Response, max_bytes: usize) -> String {
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    while buffer.len() < max_bytes {
        let Some(chunk) = stream.next().await else {
            break;
        };
        let Ok(chunk) = chunk else { break };
        let remaining = max_bytes - buffer.len();
        buffer.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
    String::from_utf8_lossy(&buffer).to_string()
}

/// hosted 事件汇。与 `ai::EventSink` 同模式：IPC Channel 只是实现之一，
/// 测试用内存 sink 驱动整条流而不需要 Tauri 运行时。
pub(crate) trait HostedEventSink: Sync {
    fn send(&self, event: HostedSseEvent) -> Result<(), ()>;
}

impl HostedEventSink for tauri::ipc::Channel<HostedSseEvent> {
    fn send(&self, event: HostedSseEvent) -> Result<(), ()> {
        tauri::ipc::Channel::send(self, event).map_err(|_| ())
    }
}

/// hosted 生成的公共 dispatch 前导：路由白名单、requestId 形态、body 边界
/// 校验（`customProvider` 注入拒绝 + 大小上限）、会话装载与 DESK-094 契约
/// 兼容门禁。流式与非流式两条命令共用——门禁失败在 requestId 注册之前返回，
/// 不产生注册表残留。
///
/// DESK-094 门禁收在 dispatch 本身：任何调用方发起 hosted 生成前都必须先过
/// 契约兼容探测，而不是依赖 UI 自觉先点「检查连通性」。探测只发生在用户主动
/// 开始在线生成时，符合「冷启动零项目请求」的冻结原则；不可达 / 已声明不兼容
/// / 未声明版本一律 fail-closed，不发送生成请求。
async fn prepare_hosted_dispatch(
    state: &CloudState,
    secrets: &dyn SecretStore,
    request: &CloudHostedGenerateRequest,
    allowed_route: &str,
) -> Result<(serde_json::Value, Option<StoredSession>), CloudError> {
    if request.route_id != allowed_route {
        return Err(invalid_request("未知的 hosted 生成路由"));
    }
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err(invalid_request("requestId 非法"));
    }
    let body = build_hosted_request_body(request)?;
    let session = load_session(secrets)?;
    match probe_hosted_compatibility(state, session.as_ref()).await? {
        HostedCompatibility::Ready { .. } => {}
        HostedCompatibility::Unreachable => {
            return Err(CloudError::new(
                CloudErrorCode::ServerUnavailable,
                "项目服务暂不可达，在线生成已停止",
            ));
        }
        HostedCompatibility::Incompatible { contract_version } => {
            return Err(CloudError::new(
                CloudErrorCode::ProtocolMismatch,
                format!(
                    "服务端契约版本 {contract_version} 与客户端 {HOSTED_CONTRACT_VERSION} 不兼容，请升级客户端"
                ),
            ));
        }
        HostedCompatibility::VersionUnknown => {
            return Err(CloudError::new(
                CloudErrorCode::ProtocolMismatch,
                "服务端未声明 hosted 契约版本，无法确认兼容性，在线生成已停止",
            ));
        }
    }
    Ok((body, session))
}

/// `stream_hosted_ai`：固定路由的 hosted 生成流（当前只开放系统默认通道）。
///
/// - 会话 cookie 只在已登录时附加（该路由对匿名也按公开规则放行）；
/// - 取消经 `ai::RequestRegistry`，drop 上游连接立即生效；
/// - 单一终态：服务端 `done`/`error` 或传输失败合成的 `error`，之后不再发事件；
///   首个终态到达后立即停止读取上游；EOF 前未见终态是上游协议异常，
///   合成一个 `invalid-response` error 而不是静默按成功结束。
pub async fn stream_hosted_ai(
    state: &CloudState,
    secrets: &dyn SecretStore,
    registry: &crate::ai::RequestRegistry,
    request: CloudHostedGenerateRequest,
    on_event: &dyn HostedEventSink,
) -> Result<(), CloudError> {
    let (body, session) =
        prepare_hosted_dispatch(state, secrets, &request, HOSTED_ROUTE_DETAILS_STREAM).await?;

    let token = registry
        .register(&request.request_id)
        .map_err(|_| CloudError::new(CloudErrorCode::InvalidRequest, "requestId 已在执行中"))?;

    let emit = |event: HostedSseEvent| on_event.send(event).ok();

    let outcome = async {
        // SSE 模式由 `?format=sse` 选定（与 Web `DetailsPage` 一致），
        // query 作为固定路由的一部分，不由 renderer 提供。
        let path = format!("{HOSTED_GENERATE_DETAILS_STREAM_PATH}?format=sse");
        let builder = match &session {
            Some(session) => authed_request(
                &state.http,
                reqwest::Method::POST,
                &state.origin,
                &path,
                session,
            ),
            None => base_request(&state.http, reqwest::Method::POST, &state.origin, &path),
        };
        // `?format=sse` 是主选择器；Accept 是服务端识别的第二信号（与 Web 客户端一致）。
        let request_builder = builder
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(&body).map_err(|_| {
                CloudError::new(CloudErrorCode::InternalError, "生成请求序列化失败")
            })?);

        let response = tokio::select! {
            biased;
            _ = token.cancelled() => {
                emit(HostedSseEvent {
                    event: "error".to_string(),
                    data: serde_json::json!({"ok": false, "error": "已取消", "code": "cancelled"}),
                });
                return Ok(());
            }
            result = request_builder.send() => result,
        };

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                emit(hosted_error_event(
                    &format!("生成请求发送失败：{error}"),
                    "network-error",
                ));
                return Ok(());
            }
        };

        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        if !status.is_success() || !content_type.contains("text/event-stream") {
            // 错误 body 只用于诊断信息提取，读取必须有界——异常响应不得撑爆内存。
            let text = read_bounded_text(response, HOSTED_ERROR_BODY_MAX_BYTES).await;
            let message = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|value| {
                    value
                        .get("error")
                        .and_then(|error| error.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| format!("生成服务拒绝请求（HTTP {status}）"));
            emit(hosted_error_event(&message, "server-rejected"));
            return Ok(());
        }

        let mut parser = HostedSseParser::new();
        let mut decoder = crate::ai::Utf8StreamDecoder::default();
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        // 终态机：Streaming → Done | Error。首个 done/error 到达即终态——
        // 直接返回（不落入 EOF 残帧处理），后续帧不再转发，上游连接随 body drop 关闭。
        loop {
            let next = tokio::select! {
                biased;
                _ = token.cancelled() => {
                    // 取消即终态：合成 error，服务端不会再收到后续读取（drop body）。
                    emit(hosted_error_event("已取消", "cancelled"));
                    return Ok(());
                }
                item = stream.next() => item,
            };
            let Some(chunk_result) = next else { break };
            let chunk = match chunk_result {
                Ok(chunk) => chunk,
                Err(error) => {
                    emit(hosted_error_event(
                        &format!("流读取中断：{error}"),
                        "network-error",
                    ));
                    return Ok(());
                }
            };
            let text = match decoder.push(&chunk) {
                Ok(text) => text,
                Err(_) => {
                    emit(hosted_error_event("流包含非法 UTF-8", "invalid-response"));
                    return Ok(());
                }
            };
            let mut events = Vec::new();
            if let Err(error) = parser.push(&text, &mut events) {
                emit(hosted_error_event(&error.message, "invalid-response"));
                return Ok(());
            }
            for event in events {
                let terminal = is_hosted_terminal_event(&event);
                if emit(event).is_none() {
                    // renderer 已断开：视同取消，中止上游。
                    return Ok(());
                }
                if terminal {
                    return Ok(());
                }
            }
        }

        if decoder.finish().is_err() {
            emit(hosted_error_event(
                "流以不完整 UTF-8 结束",
                "invalid-response",
            ));
            return Ok(());
        }
        let mut events = Vec::new();
        if parser.finish(&mut events).is_err() {
            emit(hosted_error_event(
                "生成流残帧超出大小上限",
                "invalid-response",
            ));
            return Ok(());
        }
        // 终态检查只覆盖正常 EOF 路径（上面遇到终态已提前退出循环）。
        let mut terminal_seen = false;
        for event in events {
            terminal_seen |= is_hosted_terminal_event(&event);
            if emit(event).is_none() {
                return Ok(());
            }
        }
        if !terminal_seen {
            // 服务端协议保证 done/error 关闭流；EOF 前没有终态是可诊断的上游异常，
            // 合成 error 让 UI 能收敛——不合成假 done 冒充成功。
            emit(hosted_error_event(
                "生成流未送达终态事件",
                "invalid-response",
            ));
        }
        Ok(())
    }
    .await;

    registry.finish(&request.request_id);
    outcome
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudHostedJsonResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

/// `hosted_ai_request`：hosted 非流式 JSON 生成（D5.1a，`/details` 双执行的
/// 服务器端非流式通路）。与 `stream_hosted_ai` 同一边界：固定 origin/路由、
/// 凭据字段 IPC 层拒绝、`customProvider` 注入拒绝、DESK-094 门禁、
/// RequestRegistry 取消。
///
/// 差别只在传输形态：请求/响应代替 SSE。native 返回「HTTP 状态 + JSON 正文」
/// 透传——`{data, aiMeta}` 解包、`{error, retryAfterSeconds}` 诊断与签名结果
/// 识别都在 renderer 适配层完成。2xx 必须给出 JSON 正文（否则视为协议异常）；
/// 非 2xx 允许非 JSON 错误页（网关 524 HTML 等），此时 body 投影为 null，
/// HTTP status 本身就是诊断信号，绝不合成业务成功。
///
/// `x-mahoshojo-ai-meta: 1` 请求头与 Web 客户端一致：服务端据此回
/// `{data, aiMeta}` 包装，使非流式结果也能携带模型/用量/推理信息。
pub async fn hosted_ai_request(
    state: &CloudState,
    secrets: &dyn SecretStore,
    registry: &crate::ai::RequestRegistry,
    request: CloudHostedGenerateRequest,
) -> Result<CloudHostedJsonResponse, CloudError> {
    let (body, session) =
        prepare_hosted_dispatch(state, secrets, &request, HOSTED_ROUTE_DETAILS).await?;

    let token = registry
        .register(&request.request_id)
        .map_err(|_| CloudError::new(CloudErrorCode::InvalidRequest, "requestId 已在执行中"))?;

    let outcome = async {
        let builder = match &session {
            Some(session) => authed_request(
                &state.http,
                reqwest::Method::POST,
                &state.origin,
                HOSTED_GENERATE_DETAILS_PATH,
                session,
            ),
            None => base_request(
                &state.http,
                reqwest::Method::POST,
                &state.origin,
                HOSTED_GENERATE_DETAILS_PATH,
            ),
        };
        let request_builder = builder
            .header(HOSTED_AI_META_HEADER, HOSTED_AI_META_VALUE)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(&body).map_err(|_| {
                CloudError::new(CloudErrorCode::InternalError, "生成请求序列化失败")
            })?);

        let response = tokio::select! {
            biased;
            _ = token.cancelled() => {
                return Err(CloudError::new(CloudErrorCode::Cancelled, "已取消"));
            }
            result = request_builder
                .timeout(HOSTED_JSON_REQUEST_TIMEOUT)
                .send() => result,
        };
        let response = response.map_err(|error| CloudError::network("生成请求", &error))?;

        let status = response.status().as_u16();
        let body = if (200..300).contains(&status) {
            read_bounded_json(response, "生成请求", HOSTED_JSON_RESPONSE_MAX_BYTES).await?
        } else {
            let text = read_bounded_text(response, HOSTED_JSON_RESPONSE_MAX_BYTES).await;
            serde_json::from_str::<serde_json::Value>(&text).unwrap_or(serde_json::Value::Null)
        };
        Ok(CloudHostedJsonResponse { status, body })
    }
    .await;

    registry.finish(&request.request_id);
    outcome
}

/* ── 数据卡库固定路由通路（D5.0e，`DESK-ONLINE-010`） ────────────────────
 *
 * 数据卡列表/详情/收藏/标签/统计/上传副本都是「窄 HTTP + JSON 正文」的服务端
 * API。它们共用同一条边界：renderer 只给 `routeId` + `query` + `body`；
 * method、path、会话 cookie 全部由这里的固定路由表注入。白名单之外的标识
 * 在 IPC 反序列化（枚举拒绝）与查表两处都失败；renderer 没有携带 URL、
 * header 或凭据字段的通道。
 */

/// 卡库响应正文上限：列表页与单卡正文都远小于它，超限视为异常流量。
const CARD_LIBRARY_RESPONSE_MAX_BYTES: usize = 4 * 1024 * 1024;
/// 请求 body 传输上限：服务端的产品级正文限制是 `MAX_DATA_CARD_BYTES`（1 MiB，
/// 权威校验在服务端）。这里是 transport 上限——JSON 包装（type/name/description/
/// isPublic + 转义开销）叠在 1 MiB 正文之上，取 ~2 MiB 既不放行明显畸形载荷，
/// 也不会把服务端仍在受理的边界请求拦在 IPC 层（D5.0e-r1）。
const CARD_LIBRARY_BODY_MAX_BYTES: usize = 2 * 1024 * 1024;
const CARD_LIBRARY_QUERY_MAX_PAIRS: usize = 32;
const CARD_LIBRARY_QUERY_KEY_MAX: usize = 64;
const CARD_LIBRARY_QUERY_VALUE_MAX: usize = 1024;

/// 路由的凭据语义：
/// - `Required`：无已存会话即 `not-authenticated` fail-closed（「我的」「收藏」
///   「卡组」「创建」入口）；服务端明确回 401 时按会话被拒处理（清本地凭据）；
/// - `Optional`：有会话附带、没有则匿名（公开列表/标签/统计上报）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CardRouteAuth {
    Required,
    Optional,
}

struct CardLibraryRoute {
    id: &'static str,
    method: reqwest::Method,
    path: &'static str,
    auth: CardRouteAuth,
}

// 与 `packages/contracts/fixtures/desktop-cloud.json` 的 `cardLibrary.routes`
// 同源对拍：任一侧改动未同步，fixture 测试必须失败（DESK-033 同款漂移防护）。
const CARD_LIBRARY_ROUTES: &[CardLibraryRoute] = &[
    CardLibraryRoute {
        id: "data-cards.query",
        method: reqwest::Method::GET,
        path: "/api/data-cards",
        auth: CardRouteAuth::Required,
    },
    CardLibraryRoute {
        id: "data-cards.create",
        method: reqwest::Method::POST,
        path: "/api/data-cards",
        auth: CardRouteAuth::Required,
    },
    CardLibraryRoute {
        id: "favorites.query",
        method: reqwest::Method::GET,
        path: "/api/favorites",
        auth: CardRouteAuth::Required,
    },
    CardLibraryRoute {
        id: "favorites.add",
        method: reqwest::Method::POST,
        path: "/api/favorites",
        auth: CardRouteAuth::Required,
    },
    CardLibraryRoute {
        id: "favorites.remove",
        method: reqwest::Method::DELETE,
        path: "/api/favorites",
        auth: CardRouteAuth::Required,
    },
    CardLibraryRoute {
        id: "decks.query",
        method: reqwest::Method::GET,
        path: "/api/decks",
        auth: CardRouteAuth::Required,
    },
    CardLibraryRoute {
        id: "deck-cards.query",
        method: reqwest::Method::GET,
        path: "/api/deck-cards",
        auth: CardRouteAuth::Required,
    },
    CardLibraryRoute {
        id: "public-data-cards.query",
        method: reqwest::Method::GET,
        path: "/api/public-data-cards",
        auth: CardRouteAuth::Optional,
    },
    CardLibraryRoute {
        id: "tags.query",
        method: reqwest::Method::GET,
        path: "/api/tags",
        auth: CardRouteAuth::Optional,
    },
    CardLibraryRoute {
        id: "data-card-stats.report",
        method: reqwest::Method::POST,
        path: "/api/data-card-stats",
        auth: CardRouteAuth::Optional,
    },
    CardLibraryRoute {
        id: "data-card-meta-batch.query",
        method: reqwest::Method::POST,
        path: "/api/data-card-meta-batch",
        auth: CardRouteAuth::Optional,
    },
    CardLibraryRoute {
        id: "badges-batch.query",
        method: reqwest::Method::POST,
        path: "/api/badges/batch",
        auth: CardRouteAuth::Optional,
    },
];

fn lookup_card_library_route(route_id: &str) -> Option<&'static CardLibraryRoute> {
    CARD_LIBRARY_ROUTES
        .iter()
        .find(|route| route.id == route_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudCardLibraryRequest {
    pub route_id: String,
    #[serde(default)]
    pub query: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCardLibraryResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

/// 有界读取响应正文并解析为 JSON。空正文按 `null` 处理（204/HEAD 兼容）；
/// 超限或非 JSON 都是「响应无法识别」而不是「业务失败」。
async fn read_bounded_json(
    response: reqwest::Response,
    context: &str,
    max_bytes: usize,
) -> Result<serde_json::Value, CloudError> {
    use futures_util::StreamExt;

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| CloudError::network(context, &error))?;
        if buffer.len() + chunk.len() > max_bytes {
            return Err(CloudError::new(
                CloudErrorCode::InvalidResponse,
                format!("{context} 响应正文超出大小上限"),
            ));
        }
        buffer.extend_from_slice(&chunk);
    }
    if buffer.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_slice(&buffer).map_err(|_| CloudError::invalid_response(context))
}

/// `cloud_card_library_request`：数据卡库的固定路由窄请求。
///
/// - `query`/`body` 只是业务参数——renderer 携带 URL/path/header/凭据字段的
///   尝试在 `deny_unknown_fields` 处被拒；
/// - Required 路由在本地无会话时直接 `not-authenticated`，不产生网络请求；
///   服务端对 Required 路由回 401 时按「会话被服务端否认」清除本地凭据
///   （与 `cloud_auth_status` 同一语义），响应仍原样回给 renderer；
/// - 任何传输失败都是 `network-error`/`server-unavailable`，绝不伪装成
///   业务成功。
pub async fn cloud_card_library_request(
    state: &CloudState,
    secrets: &dyn SecretStore,
    request: CloudCardLibraryRequest,
) -> Result<CloudCardLibraryResponse, CloudError> {
    let route = lookup_card_library_route(&request.route_id)
        .ok_or_else(|| invalid_request("未知的数据卡路由标识"))?;

    if request.body.is_some() && route.method == reqwest::Method::GET {
        return Err(invalid_request("GET 路由不允许携带请求体"));
    }
    if let Some(query) = &request.query {
        if query.len() > CARD_LIBRARY_QUERY_MAX_PAIRS {
            return Err(invalid_request("查询参数过多"));
        }
        for (key, value) in query {
            if key.is_empty()
                || key.len() > CARD_LIBRARY_QUERY_KEY_MAX
                || value.len() > CARD_LIBRARY_QUERY_VALUE_MAX
            {
                return Err(invalid_request("查询参数超出大小约束"));
            }
        }
    }
    let body_bytes = match &request.body {
        None => None,
        Some(body) => {
            let bytes =
                serde_json::to_vec(body).map_err(|_| invalid_request("请求体不是可序列化 JSON"))?;
            if bytes.is_empty() || bytes.len() > CARD_LIBRARY_BODY_MAX_BYTES {
                return Err(invalid_request("请求体超出大小约束"));
            }
            Some(bytes)
        }
    };

    let session = load_session(secrets)?;
    if route.auth == CardRouteAuth::Required && session.is_none() {
        return Err(CloudError::new(
            CloudErrorCode::NotAuthenticated,
            "该操作需要登录云端账号",
        ));
    }

    let mut url = url::Url::parse(&format!("{}{}", state.origin, route.path))
        .map_err(|_| CloudError::new(CloudErrorCode::InternalError, "固定路由 URL 组装失败"))?;
    if let Some(query) = &request.query {
        url.query_pairs_mut().extend_pairs(query.iter());
    }

    let mut builder = state
        .http
        .request(route.method.clone(), url)
        .header(reqwest::header::ORIGIN, &state.origin)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(session) = &session {
        builder = builder.header(reqwest::header::COOKIE, &session.cookie);
    }
    if let Some(bytes) = body_bytes {
        builder = builder
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(bytes);
    }

    let response = builder
        .timeout(SHORT_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|error| CloudError::network("数据卡请求", &error))?;

    let status = response.status().as_u16();
    // 服务端对 Required 路由明确 401 = 本地凭据已被否认：与 `cloud_auth_status`
    // 一致地清除会话，但响应原样透传给 renderer（业务错误不是传输失败）。
    if route.auth == CardRouteAuth::Required && status == 401 {
        clear_session(secrets)?;
    }

    let body = read_bounded_json(response, "数据卡请求", CARD_LIBRARY_RESPONSE_MAX_BYTES).await?;
    Ok(CloudCardLibraryResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secret::{SecretStore, SecretStoreError};
    use std::collections::BTreeMap;

    /* ── in-memory secret store ─────────────────────────────────────── */

    struct MemorySecrets {
        entries: Mutex<BTreeMap<String, String>>,
    }

    impl MemorySecrets {
        fn new() -> Self {
            Self {
                entries: Mutex::new(BTreeMap::new()),
            }
        }
    }

    impl SecretStore for MemorySecrets {
        fn set(&self, secret_ref: &str, value: &str) -> Result<(), SecretStoreError> {
            self.entries
                .lock()
                .unwrap()
                .insert(secret_ref.to_string(), value.to_string());
            Ok(())
        }
        fn exists(&self, secret_ref: &str) -> Result<bool, SecretStoreError> {
            Ok(self.entries.lock().unwrap().contains_key(secret_ref))
        }
        fn delete(&self, secret_ref: &str) -> Result<(), SecretStoreError> {
            self.entries.lock().unwrap().remove(secret_ref);
            Ok(())
        }
        fn resolve(&self, secret_ref: &str) -> Result<Option<String>, SecretStoreError> {
            Ok(self.entries.lock().unwrap().get(secret_ref).cloned())
        }
    }

    /* ── 纯逻辑测试 ─────────────────────────────────────────────────── */

    #[test]
    fn callback_parse_accepts_valid_request() {
        let head = "GET /callback?code=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&state=st-1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let outcome = parse_callback_request(head, "st-1").expect("valid callback must parse");
        assert_eq!(outcome.code, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ");
    }

    #[test]
    fn callback_parse_rejects_state_mismatch() {
        let head = "GET /callback?code=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&state=other HTTP/1.1\r\n\r\n";
        let error = parse_callback_request(head, "st-1").expect_err("state mismatch must fail");
        assert_eq!(error.code, CloudErrorCode::StateMismatch);
    }

    #[test]
    fn callback_parse_rejects_wrong_path_and_method() {
        let wrong_path =
            "GET /other?code=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&state=st HTTP/1.1\r\n\r\n";
        assert_eq!(
            parse_callback_request(wrong_path, "st").unwrap_err().code,
            CloudErrorCode::InvalidResponse
        );
        let post = "POST /callback?code=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&state=st HTTP/1.1\r\n\r\n";
        assert_eq!(
            parse_callback_request(post, "st").unwrap_err().code,
            CloudErrorCode::InvalidResponse
        );
    }

    #[test]
    fn callback_parse_rejects_bad_code_shape() {
        let head = "GET /callback?code=short&state=st HTTP/1.1\r\n\r\n";
        assert_eq!(
            parse_callback_request(head, "st").unwrap_err().code,
            CloudErrorCode::InvalidResponse
        );
    }

    #[test]
    fn pkce_challenge_is_s256_base64url() {
        let verifier = "v".repeat(50);
        let challenge = pkce_challenge(&verifier);
        assert_eq!(challenge.len(), 43);
        assert!(challenge
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn authorize_url_carries_required_params() {
        let url = build_authorize_url(
            "https://example.test",
            "st",
            "ch",
            "http://127.0.0.1:9/callback",
        );
        let parsed = url::Url::parse(&url).unwrap();
        assert_eq!(parsed.path(), AUTHORIZE_PATH);
        let pairs: HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(pairs.get("state").map(String::as_str), Some("st"));
        assert_eq!(pairs.get("code_challenge").map(String::as_str), Some("ch"));
        assert_eq!(
            pairs.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            pairs.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:9/callback")
        );
    }

    #[test]
    fn extracts_session_cookie_pair_only() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.append(
            reqwest::header::SET_COOKIE,
            "better-auth.session_data=abc; Path=/; HttpOnly"
                .parse()
                .unwrap(),
        );
        headers.append(
            reqwest::header::SET_COOKIE,
            "__Secure-better-auth.session_token=tok.signed; Path=/; HttpOnly"
                .parse()
                .unwrap(),
        );
        assert_eq!(
            extract_ba_session_cookie(&headers),
            Some("__Secure-better-auth.session_token=tok.signed".to_string())
        );
        assert_eq!(
            extract_ba_session_cookie(&reqwest::header::HeaderMap::new()),
            None
        );
    }

    #[test]
    fn hosted_contract_compatibility_matches_ts_rule() {
        assert!(is_hosted_contract_compatible("g25e1-v1", "g25e1-v1"));
        assert!(is_hosted_contract_compatible("g25e1-v2", "g25e1-v1"));
        assert!(is_hosted_contract_compatible("g25e1-v1", "g25e1-v2"));
        assert!(!is_hosted_contract_compatible("g25e1-v3", "g25e1-v1"));
        assert!(!is_hosted_contract_compatible("g26e1-v1", "g25e1-v1"));
        assert!(!is_hosted_contract_compatible("garbage", "g25e1-v1"));
        assert!(!is_hosted_contract_compatible("g25e1-v1", "garbage"));
    }

    #[test]
    fn session_record_roundtrip_and_corrupt_cleanup() {
        let secrets = MemorySecrets::new();
        let record = StoredSession {
            cookie: "better-auth.session_token=tok".to_string(),
            session_expires_at: Some("2026-10-12T00:00:00Z".to_string()),
            account: CloudAccountRecord {
                user_id: 7,
                username: "homura".to_string(),
                display_name: None,
            },
        };
        store_session(&secrets, &record).expect("store must succeed");
        let loaded = load_session(&secrets)
            .expect("load must succeed")
            .expect("record must exist");
        assert_eq!(loaded.account.username, "homura");
        assert_eq!(loaded.cookie, "better-auth.session_token=tok");

        // 损坏记录 → 视为未登录且清除，不让坏数据反复误导。
        secrets
            .set(ACCOUNT_SESSION_REF, "{broken json")
            .expect("write must succeed");
        assert!(load_session(&secrets).unwrap().is_none());
        assert!(!secrets.exists(ACCOUNT_SESSION_REF).unwrap());
    }

    /* ── mock HTTP 服务（手写最小 HTTP/1.1） ────────────────────────── */

    struct MockResponse {
        status: u16,
        headers: Vec<(String, String)>,
        body: String,
    }

    struct MockServer {
        origin: String,
        last_exchange_body: Mutex<Option<serde_json::Value>>,
        last_generate_body: Mutex<Option<serde_json::Value>>,
        last_generate_headers: Mutex<Option<String>>,
        get_session_ok: std::sync::atomic::AtomicBool,
        hosted_sse_body: Mutex<Option<String>>,
        /// `Some((status, body))` 时 readiness 路由返回覆盖响应（测门禁分支）。
        readiness_override: Mutex<Option<(u16, String)>>,
        /// `Some((status, body))` 时非流式生成路由返回覆盖响应（测错误页/透传分支）。
        hosted_json_response: Mutex<Option<(u16, String)>>,
        /// 最近一次命中数据卡路由表路径的请求（target、原始 head、JSON body）。
        last_card_request: Mutex<Option<(String, String, Option<serde_json::Value>)>>,
        /// `Some((status, body))` 时卡库路由返回覆盖响应（测 401/错误分支）。
        card_response_override: Mutex<Option<(u16, String)>>,
        shutdown: CancellationToken,
    }

    fn spawn_mock_server() -> Arc<MockServer> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind mock");
        listener.set_nonblocking(true).expect("nonblocking");
        let port = listener.local_addr().unwrap().port();
        let server = Arc::new(MockServer {
            origin: format!("http://127.0.0.1:{port}"),
            last_exchange_body: Mutex::new(None),
            last_generate_body: Mutex::new(None),
            last_generate_headers: Mutex::new(None),
            get_session_ok: std::sync::atomic::AtomicBool::new(true),
            hosted_sse_body: Mutex::new(None),
            readiness_override: Mutex::new(None),
            hosted_json_response: Mutex::new(None),
            last_card_request: Mutex::new(None),
            card_response_override: Mutex::new(None),
            shutdown: CancellationToken::new(),
        });
        let handle = server.clone();
        std::thread::spawn(move || loop {
            if handle.shutdown.is_cancelled() {
                return;
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let server = handle.clone();
                    std::thread::spawn(move || {
                        use std::io::{Read, Write};
                        // Windows 上 accept 的 socket 会继承 listener 的 nonblocking
                        // 标志：不设回阻塞模式，read 会在数据到达前直接 WouldBlock。
                        if stream.set_nonblocking(false).is_err() {
                            return;
                        }
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut buf = Vec::new();
                        let mut chunk = [0u8; 4096];
                        let deadline = std::time::Instant::now() + Duration::from_secs(5);
                        let head_end = loop {
                            if std::time::Instant::now() > deadline {
                                return;
                            }
                            match stream.read(&mut chunk) {
                                Ok(0) => return,
                                Ok(n) => {
                                    buf.extend_from_slice(&chunk[..n]);
                                    if let Some(end) = find_subslice(&buf, b"\r\n\r\n") {
                                        break end;
                                    }
                                }
                                Err(_) => return,
                            }
                        };
                        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                        let line = head.lines().next().unwrap_or_default().to_string();
                        let mut parts = line.split_whitespace();
                        let _method = parts.next().unwrap_or_default();
                        let target = parts.next().unwrap_or_default().to_string();

                        let content_length = head
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        while buf.len() < head_end + 4 + content_length {
                            match stream.read(&mut chunk) {
                                Ok(0) => break,
                                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                                Err(_) => return,
                            }
                        }
                        let body_bytes = &buf[head_end + 4..];

                        let response = server.route(&target, &head, body_bytes);
                        let mut reply = format!(
                            "HTTP/1.1 {}\r\nContent-Length: {}\r\n",
                            response.status,
                            response.body.len()
                        );
                        for (name, value) in &response.headers {
                            reply.push_str(&format!("{name}: {value}\r\n"));
                        }
                        reply.push_str("\r\n");
                        reply.push_str(&response.body);
                        let _ = stream.write_all(reply.as_bytes());
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(_) => return,
            }
        });
        server
    }

    impl MockServer {
        fn route(&self, target: &str, head: &str, body: &[u8]) -> MockResponse {
            let json = |payload: serde_json::Value| MockResponse {
                status: 200,
                headers: vec![("Content-Type".to_string(), "application/json".to_string())],
                body: payload.to_string(),
            };
            match target.split('?').next().unwrap_or(target) {
                EXCHANGE_PATH => {
                    let parsed: serde_json::Value =
                        serde_json::from_slice(body).unwrap_or(serde_json::json!({}));
                    *self.last_exchange_body.lock().unwrap() = Some(parsed.clone());
                    if parsed["codeVerifier"].is_null() || parsed["code"].is_null() {
                        return MockResponse {
                            status: 401,
                            headers: vec![],
                            body: r#"{"error":"invalid grant","code":"invalid-grant"}"#.to_string(),
                        };
                    }
                    MockResponse {
                        status: 200,
                        headers: vec![
                            ("Content-Type".to_string(), "application/json".to_string()),
                            (
                                "Set-Cookie".to_string(),
                                "better-auth.session_token=native.tok; Path=/; HttpOnly"
                                    .to_string(),
                            ),
                        ],
                        body: serde_json::json!({
                            "protocolVersion": "desktop-auth-v1",
                            "account": {"userId": 7, "username": "homura", "displayName": "homura"},
                            "sessionExpiresAt": "2026-10-12T00:00:00.000Z"
                        })
                        .to_string(),
                    }
                }
                GET_SESSION_PATH => {
                    if self
                        .get_session_ok
                        .load(std::sync::atomic::Ordering::SeqCst)
                    {
                        json(serde_json::json!({
                            "session": {"id": "s1", "userId": "au_1", "expiresAt": "2026-10-12T00:00:00Z"},
                            "user": {"id": "au_1"}
                        }))
                    } else {
                        json(serde_json::json!({"session": null, "user": null}))
                    }
                }
                SIGN_OUT_PATH => json(serde_json::json!({"success": true})),
                // 数据卡路由表里的所有 path：记录请求后回 `{"success": true}`，
                // 覆盖响应优先（测 401 / 错误分支）。
                path if CARD_LIBRARY_ROUTES.iter().any(|route| route.path == path) => {
                    *self.last_card_request.lock().unwrap() = Some((
                        target.to_string(),
                        head.to_string(),
                        serde_json::from_slice(body).ok(),
                    ));
                    if let Some((status, override_body)) =
                        self.card_response_override.lock().unwrap().clone()
                    {
                        return MockResponse {
                            status,
                            headers: vec![(
                                "Content-Type".to_string(),
                                "application/json".to_string(),
                            )],
                            body: override_body,
                        };
                    }
                    json(serde_json::json!({"success": true}))
                }
                DR_READINESS_PATH => {
                    let override_response = self.readiness_override.lock().unwrap().clone();
                    match override_response {
                        Some((status, body)) => MockResponse {
                            status,
                            headers: vec![(
                                "Content-Type".to_string(),
                                "application/json".to_string(),
                            )],
                            body,
                        },
                        None => json(serde_json::json!({
                            "ok": true,
                            "contractVersion": "g25e1-v1"
                        })),
                    }
                }
                HOSTED_GENERATE_DETAILS_STREAM_PATH => {
                    *self.last_generate_headers.lock().unwrap() = Some(head.to_string());
                    *self.last_generate_body.lock().unwrap() = serde_json::from_slice(body).ok();
                    let sse = self
                        .hosted_sse_body
                        .lock()
                        .unwrap()
                        .clone()
                        .unwrap_or_else(|| {
                            let mut sse = String::new();
                            for (name, data) in [
                                (
                                    "reasoning",
                                    r#"{"source":"sdk","status":"thinking","chunk":"让我想想"}"#,
                                ),
                                ("reasoning_done", r#"{"source":"sdk","status":"done"}"#),
                                ("markdown", r#"{"chunk":"一段正文"}"#),
                                ("telemetry", r#"{"version":1,"aiModel":"glm-5.3-flash"}"#),
                                ("done", r#"{"ok":true}"#),
                            ] {
                                sse.push_str(&format!("event: {name}\ndata: {data}\n\n"));
                            }
                            sse
                        });
                    MockResponse {
                        status: 200,
                        headers: vec![
                            (
                                "Content-Type".to_string(),
                                "text/event-stream; charset=utf-8".to_string(),
                            ),
                            ("Cache-Control".to_string(), "no-store".to_string()),
                        ],
                        body: sse,
                    }
                }
                HOSTED_GENERATE_DETAILS_PATH => {
                    *self.last_generate_headers.lock().unwrap() = Some(head.to_string());
                    *self.last_generate_body.lock().unwrap() = serde_json::from_slice(body).ok();
                    if let Some((status, override_body)) =
                        self.hosted_json_response.lock().unwrap().clone()
                    {
                        return MockResponse {
                            status,
                            headers: vec![(
                                "Content-Type".to_string(),
                                "application/json".to_string(),
                            )],
                            body: override_body,
                        };
                    }
                    json(serde_json::json!({
                        "data": {"codename": "homura", "signature": "sig.v1"},
                        "aiMeta": {"aiModel": "glm-5.3-flash", "aiReasoning": {"status": "done", "source": "sdk"}}
                    }))
                }
                _ => MockResponse {
                    status: 404,
                    headers: vec![],
                    body: "{}".to_string(),
                },
            }
        }
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime")
    }

    /// 完整链路：begin → 模拟浏览器回跳 → await → exchange → 凭据入库。
    /// 回放在测试侧验证 PKCE verifier 与 authorize_url 中的 challenge 构成
    /// S256 关系，证明两端协议一致。
    #[test]
    fn login_flow_end_to_end() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();

            let begin = cloud_login_begin(&state).await.expect("begin must succeed");
            let authorize = url::Url::parse(&begin.authorize_url).unwrap();
            let query: HashMap<_, _> = authorize.query_pairs().into_owned().collect();
            let redirect_uri = url::Url::parse(query["redirect_uri"].as_str()).unwrap();
            let callback_url = format!(
                "{}?code={}&state={}",
                redirect_uri,
                "c".repeat(43),
                query["state"].as_str()
            );
            let challenge = query["code_challenge"].to_string();

            // 并发：await 等回跳；模拟浏览器 GET loopback callback。
            let (outcome, callback_response) = tokio::join!(
                cloud_login_await(&state, &begin.flow_id, &secrets),
                reqwest::Client::new().get(&callback_url).send(),
            );
            assert!(callback_response
                .expect("callback request")
                .status()
                .is_success());
            let outcome = outcome.expect("await must succeed");

            let CloudLoginOutcome::SignedIn {
                account,
                session_expires_at,
            } = outcome
            else {
                panic!("login must succeed: {outcome:?}");
            };
            assert_eq!(account.username, "homura");
            assert_eq!(session_expires_at, "2026-10-12T00:00:00.000Z");

            // PKCE：服务端视角验证 verifier → challenge 是同一个 S256。
            let exchange = server.last_exchange_body.lock().unwrap().clone().unwrap();
            assert_eq!(exchange["code"].as_str(), Some("c".repeat(43).as_str()));
            assert_eq!(
                exchange["protocolVersion"].as_str(),
                Some("desktop-auth-v1")
            );
            let verifier = exchange["codeVerifier"].as_str().unwrap();
            assert_eq!(pkce_challenge(verifier), challenge);

            // 凭据已入库（cookie 对）且命名空间正确。
            let stored = load_session(&secrets).unwrap().expect("session stored");
            assert_eq!(stored.cookie, "better-auth.session_token=native.tok");
            assert_eq!(stored.account.user_id, 7);

            // 状态查询：active。
            match cloud_auth_status(&state, &secrets).await.unwrap() {
                CloudSessionStatus::Active { account, .. } => {
                    assert_eq!(account.username, "homura");
                }
                other => panic!("expected active status, got {other:?}"),
            }

            // 服务端否认会话 → expired + 本地凭据被清。
            server
                .get_session_ok
                .store(false, std::sync::atomic::Ordering::SeqCst);
            match cloud_auth_status(&state, &secrets).await.unwrap() {
                CloudSessionStatus::Expired => {}
                other => panic!("expected expired status, got {other:?}"),
            }
            assert!(!secrets.exists(ACCOUNT_SESSION_REF).unwrap());

            // 重新放入凭据 → sign_out：本地凭据无条件删除，revoked 反映服务端结果。
            store_session(&secrets, &stored).unwrap();
            let sign_out = cloud_sign_out(&state, &secrets).await.unwrap();
            assert!(sign_out.revoked);
            assert!(!secrets.exists(ACCOUNT_SESSION_REF).unwrap());

            // 在线探测：reachable + compatible。
            let online = cloud_online_status(&state, &secrets).await.unwrap();
            assert!(online.reachable);
            assert_eq!(online.contract_version.as_deref(), Some("g25e1-v1"));
            assert_eq!(online.compatible, Some(true));
        });
    }

    #[test]
    fn login_cancel_and_state_mismatch_are_diagnosable() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();

            // 未知 flow → flow-not-found。
            let error = cloud_login_await(&state, "missing", &secrets)
                .await
                .expect_err("missing flow must fail");
            assert_eq!(error.code, CloudErrorCode::FlowNotFound);

            // 取消进行中 await → cancelled。await 持有 flow Arc，取消后由 listener
            // 的 cancel token 结束等待。
            let begin = cloud_login_begin(&state).await.unwrap();
            let (outcome, _) =
                tokio::join!(cloud_login_await(&state, &begin.flow_id, &secrets), async {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    assert!(cloud_login_cancel(&state, &begin.flow_id));
                });
            match outcome.unwrap() {
                CloudLoginOutcome::Cancelled => {}
                other => panic!("expected cancelled outcome, got {other:?}"),
            }

            // state 不匹配：回跳被拒，await 收到 failed。
            let begin = cloud_login_begin(&state).await.unwrap();
            let authorize = url::Url::parse(&begin.authorize_url).unwrap();
            let query: HashMap<_, _> = authorize.query_pairs().into_owned().collect();
            let redirect_uri = url::Url::parse(query["redirect_uri"].as_str()).unwrap();
            let bad_callback = format!("{}?code={}&state=forged", redirect_uri, "c".repeat(43));
            let (outcome, response) = tokio::join!(
                cloud_login_await(&state, &begin.flow_id, &secrets),
                reqwest::Client::new().get(&bad_callback).send(),
            );
            assert_eq!(response.unwrap().status().as_u16(), 400);
            match outcome.unwrap() {
                CloudLoginOutcome::Failed { code, .. } => {
                    assert_eq!(code, CloudErrorCode::StateMismatch);
                }
                other => panic!("expected state-mismatch failure, got {other:?}"),
            }
        });
    }

    #[test]
    fn unreachable_status_keeps_local_credentials() {
        rt().block_on(async {
            // 指向一个不可达的 origin（已关闭的端口）。
            let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = dead.local_addr().unwrap().port();
            drop(dead);
            let state = CloudState::with_origin(&format!("http://127.0.0.1:{port}"));
            let secrets = MemorySecrets::new();
            store_session(
                &secrets,
                &StoredSession {
                    cookie: "better-auth.session_token=tok".to_string(),
                    session_expires_at: None,
                    account: CloudAccountRecord {
                        user_id: 1,
                        username: "u".to_string(),
                        display_name: None,
                    },
                },
            )
            .unwrap();

            match cloud_auth_status(&state, &secrets).await.unwrap() {
                CloudSessionStatus::Unreachable => {}
                other => panic!("expected unreachable, got {other:?}"),
            }
            // 不可达绝不等于已注销：凭据必须保留。
            assert!(secrets.exists(ACCOUNT_SESSION_REF).unwrap());

            let online = cloud_online_status(&state, &secrets).await.unwrap();
            assert!(!online.reachable);
            assert_eq!(online.compatible, None);
        });
    }

    /// fixture 一致性门禁：路径/协议常量与 `desktop-cloud.json` 同源。
    #[test]
    fn protocol_constants_match_shared_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/desktop-cloud.json"
        ))
        .expect("shared fixture must be valid JSON");

        assert_eq!(fixture["protocolVersion"].as_str(), Some(PROTOCOL_VERSION));
        assert_eq!(fixture["paths"]["authorize"].as_str(), Some(AUTHORIZE_PATH));
        assert_eq!(fixture["paths"]["exchange"].as_str(), Some(EXCHANGE_PATH));
        assert_eq!(
            fixture["paths"]["getSession"].as_str(),
            Some(GET_SESSION_PATH)
        );
        assert_eq!(fixture["paths"]["signOut"].as_str(), Some(SIGN_OUT_PATH));
        assert_eq!(
            fixture["paths"]["hostedDrReadiness"].as_str(),
            Some(DR_READINESS_PATH)
        );
        assert_eq!(
            fixture["paths"]["loopbackCallback"].as_str(),
            Some(LOOPBACK_CALLBACK_PATH)
        );
        assert_eq!(fixture["limits"]["grantTtlSeconds"].as_u64(), Some(120));
        assert_eq!(
            fixture["paths"]["hostedGenerateDetailsStream"].as_str(),
            Some(HOSTED_GENERATE_DETAILS_STREAM_PATH)
        );
        assert_eq!(
            fixture["paths"]["hostedGenerateDetails"].as_str(),
            Some(HOSTED_GENERATE_DETAILS_PATH)
        );
        let event_names: Vec<&str> = fixture["hostedGenerationEventNames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();
        for name in HOSTED_EVENT_NAMES {
            assert!(event_names.contains(name), "fixture 缺少事件名 {name}");
        }
        assert_eq!(event_names.len(), HOSTED_EVENT_NAMES.len());

        // 非流式路由白名单与 fixture `hostedJsonRouteIds` 同源对拍。
        let json_routes: Vec<&str> = fixture["hostedJsonRouteIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();
        assert_eq!(json_routes, [HOSTED_ROUTE_DETAILS]);

        // Rust `CloudErrorCode` 全量序列化值与共享 contract 错误码枚举逐一相等——
        // 防止两侧各自手抄一份列表发生漂移。
        let rust_codes: Vec<String> = [
            CloudErrorCode::NotAuthenticated,
            CloudErrorCode::FlowNotFound,
            CloudErrorCode::FlowInProgress,
            CloudErrorCode::Cancelled,
            CloudErrorCode::Timeout,
            CloudErrorCode::StateMismatch,
            CloudErrorCode::ProtocolMismatch,
            CloudErrorCode::NetworkError,
            CloudErrorCode::ServerUnavailable,
            CloudErrorCode::InvalidResponse,
            CloudErrorCode::StorageUnavailable,
            CloudErrorCode::InvalidRequest,
            CloudErrorCode::InternalError,
        ]
        .iter()
        .map(|code| {
            serde_json::to_value(code)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
        let fixture_codes: Vec<String> = fixture["ipcErrorCodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect();
        assert_eq!(rust_codes, fixture_codes);

        // 数据卡库路由表与 fixture `cardLibrary.routes` 同源对拍：route id、
        // method、path、凭据语义四项都必须逐一相等，任一侧漂移即失败。
        let fixture_routes = fixture["cardLibrary"]["routes"]
            .as_object()
            .expect("fixture cardLibrary.routes must be an object");
        assert_eq!(
            fixture_routes.len(),
            CARD_LIBRARY_ROUTES.len(),
            "卡库路由表与 fixture 条目数不一致"
        );
        for route in CARD_LIBRARY_ROUTES {
            let entry = &fixture_routes[route.id];
            assert!(
                entry.is_object(),
                "fixture 缺少卡库路由 {id}",
                id = route.id
            );
            assert_eq!(
                entry["method"].as_str(),
                Some(route.method.as_str()),
                "卡库路由 {id} method 不一致",
                id = route.id
            );
            assert_eq!(
                entry["path"].as_str(),
                Some(route.path),
                "卡库路由 {id} path 不一致",
                id = route.id
            );
            let expected_auth = match route.auth {
                CardRouteAuth::Required => "required",
                CardRouteAuth::Optional => "optional",
            };
            assert_eq!(
                entry["auth"].as_str(),
                Some(expected_auth),
                "卡库路由 {id} 凭据语义不一致",
                id = route.id
            );
        }
    }

    /* ── hosted 生成适配 ─────────────────────────────────────────────── */

    struct VecSink {
        events: Mutex<Vec<HostedSseEvent>>,
    }

    impl VecSink {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }
    }

    impl HostedEventSink for VecSink {
        fn send(&self, event: HostedSseEvent) -> Result<(), ()> {
            self.events.lock().map_err(|_| ())?.push(event);
            Ok(())
        }
    }

    fn hosted_request() -> CloudHostedGenerateRequest {
        CloudHostedGenerateRequest {
            request_id: "req-1".to_string(),
            route_id: HOSTED_ROUTE_DETAILS_STREAM.to_string(),
            body: serde_json::json!({"answers": [{"questionId": "q1", "answer": "a"}]}),
        }
    }

    /// 完整登录链路里重复 await 的竞态：第二次 await 只应得到 FlowInProgress，
    /// 不得把仍在进行的 flow 从注册表删掉（后续 cancel 必须仍然找得到它）。
    #[test]
    fn duplicate_await_keeps_flow_cancellable() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let begin = cloud_login_begin(&state).await.unwrap();

            let (first_outcome, second_result, _) = tokio::join!(
                cloud_login_await(&state, &begin.flow_id, &secrets),
                async {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    cloud_login_await(&state, &begin.flow_id, &secrets).await
                },
                async {
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    assert!(
                        cloud_login_cancel(&state, &begin.flow_id),
                        "重复 await 不得移除仍可取消的 flow"
                    );
                }
            );
            assert_eq!(
                second_result.unwrap_err().code,
                CloudErrorCode::FlowInProgress
            );
            match first_outcome.unwrap() {
                CloudLoginOutcome::Cancelled => {}
                other => panic!("expected cancelled outcome, got {other:?}"),
            }
        });
    }

    #[test]
    fn hosted_body_injection_guards() {
        // renderer 预置 customProvider → 拒绝（native 是唯一注入方）。
        let mut smuggled = hosted_request();
        smuggled.body = serde_json::json!({
            "answers": [],
            "customProvider": {"providerId": "deepseek", "apiKey": "stolen"}
        });
        let error = build_hosted_request_body(&smuggled).unwrap_err();
        assert_eq!(error.code, CloudErrorCode::InvalidRequest);

        // body 必须是 JSON 对象。
        let mut non_object = hosted_request();
        non_object.body = serde_json::json!("not-an-object");
        assert_eq!(
            build_hosted_request_body(&non_object).unwrap_err().code,
            CloudErrorCode::InvalidRequest
        );

        // body 序列化超限 → 拒绝（bounded input，不依赖 renderer schema）。
        let mut oversized = hosted_request();
        oversized.body = serde_json::json!({"pad": "x".repeat(HOSTED_BODY_MAX_BYTES)});
        assert_eq!(
            build_hosted_request_body(&oversized).unwrap_err().code,
            CloudErrorCode::InvalidRequest
        );

        // 系统默认通道：不携带 customProvider，业务字段原样保留。
        let body = build_hosted_request_body(&hosted_request()).unwrap();
        assert!(!body.as_object().unwrap().contains_key("customProvider"));
        assert!(body["answers"].is_array());
    }

    /// BYOK 在 native Provider 绑定落地前保持关闭：`deny_unknown_fields`
    /// 让任何凭据字段在 IPC 反序列化阶段就 fail-closed，进不了命令体。
    #[test]
    fn hosted_request_denies_credential_fields() {
        let with_byok = serde_json::json!({
            "requestId": "req-1",
            "routeId": HOSTED_ROUTE_DETAILS_STREAM,
            "body": {"answers": []},
            "byok": {
                "providerId": "deepseek",
                "modelId": "deepseek-v4-flash",
                "secretRef": "provider-key:abc"
            }
        });
        assert!(serde_json::from_value::<CloudHostedGenerateRequest>(with_byok).is_err());

        let with_secret_ref = serde_json::json!({
            "requestId": "req-1",
            "routeId": HOSTED_ROUTE_DETAILS_STREAM,
            "body": {"answers": []},
            "secretRef": "provider-key:abc"
        });
        assert!(serde_json::from_value::<CloudHostedGenerateRequest>(with_secret_ref).is_err());
    }

    #[test]
    fn hosted_sse_parser_filters_and_joins() {
        let mut parser = HostedSseParser::new();
        let mut events = Vec::new();
        // 分片到达 + 未知事件名 + 非 JSON data 都不得中断流。
        parser
            .push("event: markdown\ndata: {\"chunk\":\"一", &mut events)
            .unwrap();
        parser
            .push(
                "段\"}\n\nevent: unknown_future\ndata: {}\n\nevent: markdown\ndata: not-json\n\n",
                &mut events,
            )
            .unwrap();
        parser
            .push("event: done\ndata: {\"ok\":true}\n\n", &mut events)
            .unwrap();
        parser.finish(&mut events).unwrap();
        let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
        assert_eq!(names, ["markdown", "done"]);
        assert_eq!(events[0].data["chunk"], "一段");
    }

    /// 标准 SSE 的 CRLF 帧边界与行尾同样必须被消费。
    #[test]
    fn hosted_sse_parser_accepts_crlf() {
        let mut parser = HostedSseParser::new();
        let mut events = Vec::new();
        parser
            .push(
                "event: markdown\r\ndata: {\"chunk\":\"一\"}\r\n\r\n",
                &mut events,
            )
            .unwrap();
        parser
            .push("event: done\r\ndata: {\"ok\":true}\r\n\r\n", &mut events)
            .unwrap();
        let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
        assert_eq!(names, ["markdown", "done"]);
        assert_eq!(events[0].data["chunk"], "一");
    }

    /// 缓冲与单帧上限：不发送帧边界的流不得无限占用内存。
    #[test]
    fn hosted_sse_parser_bounds_buffer_and_frame() {
        let mut parser = HostedSseParser::new();
        let mut events = Vec::new();
        // 无帧边界的超大分片 → 缓冲超限。
        let flood = "x".repeat(HOSTED_SSE_MAX_BUFFER_BYTES + 1);
        let error = parser.push(&flood, &mut events).unwrap_err();
        assert_eq!(error.code, CloudErrorCode::InvalidResponse);

        // 有边界但单帧超限 → 同样拒绝。
        let mut parser = HostedSseParser::new();
        let frame = format!(
            "event: markdown\ndata: \"{}\"\n\n",
            "y".repeat(HOSTED_SSE_MAX_FRAME_BYTES)
        );
        let error = parser.push(&frame, &mut events).unwrap_err();
        assert_eq!(error.code, CloudErrorCode::InvalidResponse);
    }

    #[test]
    fn hosted_stream_end_to_end() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();
            let sink = VecSink::new();

            // 已登录会话：cookie 应随生成请求一起发出。
            store_session(
                &secrets,
                &StoredSession {
                    cookie: "better-auth.session_token=native.tok".to_string(),
                    session_expires_at: None,
                    account: CloudAccountRecord {
                        user_id: 7,
                        username: "homura".to_string(),
                        display_name: None,
                    },
                },
            )
            .unwrap();

            stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .expect("stream must complete");

            // 服务端视角：系统通道不带 customProvider，账号 cookie 在 header。
            let sent = server.last_generate_body.lock().unwrap().clone().unwrap();
            assert!(!sent.as_object().unwrap().contains_key("customProvider"));
            let headers = server
                .last_generate_headers
                .lock()
                .unwrap()
                .clone()
                .unwrap();
            assert!(headers
                .to_lowercase()
                .contains("cookie: better-auth.session_token=native.tok"));
            assert!(headers.to_lowercase().contains("accept: text/event-stream"));

            // renderer 视角：五个事件原样转发、done 为终态。
            let events = sink.events.lock().unwrap();
            let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
            assert_eq!(
                names,
                [
                    "reasoning",
                    "reasoning_done",
                    "markdown",
                    "telemetry",
                    "done"
                ]
            );
            assert_eq!(events.last().unwrap().data["ok"], true);
        });
    }

    /// 首个终态到达后立即停止：done 之后的上游帧不再转发。
    #[test]
    fn hosted_stream_stops_after_terminal() {
        rt().block_on(async {
            let server = spawn_mock_server();
            *server.hosted_sse_body.lock().unwrap() = Some(
                concat!(
                    "event: done\ndata: {\"ok\":true}\n\n",
                    "event: markdown\ndata: {\"chunk\":\"迟到\"}\n\n",
                )
                .to_string(),
            );
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();
            let sink = VecSink::new();

            stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .unwrap();
            let events = sink.events.lock().unwrap();
            let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
            assert_eq!(names, ["done"]);
        });
    }

    /// EOF 前未收到 done/error 是上游协议异常：合成 invalid-response error，
    /// 不合成假 done 冒充成功。
    #[test]
    fn hosted_stream_eof_without_terminal_is_diagnosed() {
        rt().block_on(async {
            let server = spawn_mock_server();
            *server.hosted_sse_body.lock().unwrap() =
                Some("event: markdown\ndata: {\"chunk\":\"半段\"}\n\n".to_string());
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();
            let sink = VecSink::new();

            stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .unwrap();
            let events = sink.events.lock().unwrap();
            let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
            assert_eq!(names, ["markdown", "error"]);
            assert_eq!(events.last().unwrap().data["code"], "invalid-response");
        });
    }

    #[test]
    fn hosted_stream_anonymous_and_system_channel() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();
            let sink = VecSink::new();

            // 未登录 + 系统默认通道：不带 cookie、不带 customProvider。
            stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .unwrap();
            let sent = server.last_generate_body.lock().unwrap().clone().unwrap();
            assert!(!sent.as_object().unwrap().contains_key("customProvider"));
            let headers = server
                .last_generate_headers
                .lock()
                .unwrap()
                .clone()
                .unwrap();
            assert!(!headers.to_lowercase().contains("cookie:"));
        });
    }

    #[test]
    fn hosted_stream_rejects_unknown_route_and_duplicate_inflight_request_id() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();
            let sink = VecSink::new();

            let mut bad_route = hosted_request();
            bad_route.route_id = "arbitrary-internal-route".to_string();
            let error = stream_hosted_ai(&state, &secrets, &registry, bad_route, &sink)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);

            // 同一 requestId 并发 → 第二次被拒绝。
            let first = hosted_request();
            let mut second = hosted_request();
            second.request_id = "req-1".to_string();
            registry.register("req-1").unwrap();
            let error = stream_hosted_ai(&state, &secrets, &registry, second, &sink)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);
            registry.finish("req-1");
            // 干净后可以再次使用。
            stream_hosted_ai(&state, &secrets, &registry, first, &sink)
                .await
                .unwrap();
        });
    }

    /// DESK-094：hosted dispatch 前必须过契约兼容门禁。不可达 / 已声明不兼容 /
    /// 未声明版本都 fail-closed，生成请求不得发出；门禁失败不得占用 requestId。
    #[test]
    fn hosted_stream_requires_compatible_contract_before_dispatch() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();
            let sink = VecSink::new();

            // 已声明但不兼容的版本 → protocol-mismatch，生成请求未发出。
            *server.readiness_override.lock().unwrap() = Some((
                200,
                serde_json::json!({"ok": true, "contractVersion": "g99e9-v9"}).to_string(),
            ));
            let error = stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::ProtocolMismatch);
            assert!(
                server.last_generate_body.lock().unwrap().is_none(),
                "incompatible contract must stop before dispatch"
            );

            // 可达但未声明 contractVersion → 同样 fail-closed，不能当兼容放行。
            *server.readiness_override.lock().unwrap() =
                Some((200, serde_json::json!({"ok": true}).to_string()));
            let error = stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::ProtocolMismatch);
            assert!(server.last_generate_body.lock().unwrap().is_none());
            // UI 投影同样如实表达「无法确认」而不是「兼容」。
            let online = cloud_online_status(&state, &secrets).await.unwrap();
            assert!(online.reachable);
            assert_eq!(online.contract_version, None);
            assert_eq!(online.compatible, None);

            // readiness 非 2xx → 不可达。
            *server.readiness_override.lock().unwrap() = Some((503, "{}".to_string()));
            let error = stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::ServerUnavailable);
            assert!(server.last_generate_body.lock().unwrap().is_none());

            // 服务完全不可达（已关闭端口）→ 同样 server-unavailable。
            let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let dead_origin = format!("http://127.0.0.1:{}", dead.local_addr().unwrap().port());
            drop(dead);
            let dead_state = CloudState::with_origin(&dead_origin);
            let error = stream_hosted_ai(&dead_state, &secrets, &registry, hosted_request(), &sink)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::ServerUnavailable);
            assert!(sink.events.lock().unwrap().is_empty());

            // 门禁失败不产生 requestId 残留：同名请求可重新发起。
            *server.readiness_override.lock().unwrap() = None;
            stream_hosted_ai(&state, &secrets, &registry, hosted_request(), &sink)
                .await
                .expect("compatible probe must let the request through");
        });
    }

    /* ── hosted 非流式 JSON 生成（D5.1a） ────────────────────────────── */

    fn hosted_json_request() -> CloudHostedGenerateRequest {
        CloudHostedGenerateRequest {
            request_id: "req-json-1".to_string(),
            route_id: HOSTED_ROUTE_DETAILS.to_string(),
            body: serde_json::json!({
                "answers": [{"questionId": "q1", "answer": "a"}],
                "allowNativeSignature": true,
            }),
        }
    }

    #[test]
    fn hosted_json_end_to_end() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();
            store_session(
                &secrets,
                &StoredSession {
                    cookie: "better-auth.session_token=native.tok".to_string(),
                    session_expires_at: None,
                    account: CloudAccountRecord {
                        user_id: 7,
                        username: "homura".to_string(),
                        display_name: None,
                    },
                },
            )
            .unwrap();

            let response = hosted_ai_request(&state, &secrets, &registry, hosted_json_request())
                .await
                .expect("request must complete");
            assert_eq!(response.status, 200);
            // `{data, aiMeta}` 包装原样透传——签名结果与推理元数据都在 body 里。
            assert_eq!(response.body["data"]["codename"], "homura");
            assert_eq!(response.body["data"]["signature"], "sig.v1");
            assert_eq!(response.body["aiMeta"]["aiModel"], "glm-5.3-flash");

            // 服务端视角：aiMeta 请求头、会话 cookie、无 customProvider、
            // allowNativeSignature 业务字段原样上行。
            let headers = server
                .last_generate_headers
                .lock()
                .unwrap()
                .clone()
                .unwrap()
                .to_lowercase();
            assert!(headers.contains("x-mahoshojo-ai-meta: 1"));
            assert!(headers.contains("cookie: better-auth.session_token=native.tok"));
            let sent = server.last_generate_body.lock().unwrap().clone().unwrap();
            assert!(!sent.as_object().unwrap().contains_key("customProvider"));
            assert_eq!(sent["allowNativeSignature"], true);
        });
    }

    #[test]
    fn hosted_json_rejects_unknown_route_and_duplicate_inflight() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();

            // 流式路由不属于非流式白名单——两侧枚举独立钉死。
            let mut bad_route = hosted_json_request();
            bad_route.route_id = HOSTED_ROUTE_DETAILS_STREAM.to_string();
            let error = hosted_ai_request(&state, &secrets, &registry, bad_route)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);
            assert!(server.last_generate_body.lock().unwrap().is_none());

            registry.register("req-json-1").unwrap();
            let error = hosted_ai_request(&state, &secrets, &registry, hosted_json_request())
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);
            registry.finish("req-json-1");
        });
    }

    /// DESK-094 对非流式通路同样强制：契约不兼容在 dispatch 前 fail-closed。
    #[test]
    fn hosted_json_requires_compatible_contract_before_dispatch() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();

            *server.readiness_override.lock().unwrap() = Some((
                200,
                serde_json::json!({"ok": true, "contractVersion": "g99e9-v9"}).to_string(),
            ));
            let error = hosted_ai_request(&state, &secrets, &registry, hosted_json_request())
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::ProtocolMismatch);
            assert!(
                server.last_generate_body.lock().unwrap().is_none(),
                "incompatible contract must stop before dispatch"
            );
        });
    }

    /// 非 2xx 不做业务解读：JSON 错误体原样透传，非 JSON 错误页（网关 HTML）
    /// 投影为 null 正文——HTTP status 本身就是诊断信号。
    #[test]
    fn hosted_json_error_status_passthrough() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();

            *server.hosted_json_response.lock().unwrap() = Some((
                429,
                serde_json::json!({"error": "rate limited", "retryAfterSeconds": 60}).to_string(),
            ));
            let response = hosted_ai_request(&state, &secrets, &registry, hosted_json_request())
                .await
                .expect("non-2xx is a business projection, not a transport failure");
            assert_eq!(response.status, 429);
            assert_eq!(response.body["retryAfterSeconds"], 60);

            *server.hosted_json_response.lock().unwrap() =
                Some((524, "<html><body>Origin Time-out</body></html>".to_string()));
            let response = hosted_ai_request(&state, &secrets, &registry, hosted_json_request())
                .await
                .unwrap();
            assert_eq!(response.status, 524);
            assert!(response.body.is_null());
        });
    }

    /// 2xx 必须是 JSON——成功状态却读不出正文是协议异常，不能投影为成功。
    #[test]
    fn hosted_json_success_requires_json_body() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            let registry = crate::ai::RequestRegistry::default();

            *server.hosted_json_response.lock().unwrap() = Some((200, "not-json".to_string()));
            let error = hosted_ai_request(&state, &secrets, &registry, hosted_json_request())
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidResponse);
        });
    }

    /* ── 数据卡库固定路由通路（D5.0e） ────────────────────────────────── */

    fn card_request(route_id: &str) -> CloudCardLibraryRequest {
        CloudCardLibraryRequest {
            route_id: route_id.to_string(),
            query: None,
            body: None,
        }
    }

    fn stored_test_session() -> StoredSession {
        StoredSession {
            cookie: "better-auth.session_token=native.tok".to_string(),
            session_expires_at: Some("2026-10-12T00:00:00Z".to_string()),
            account: CloudAccountRecord {
                user_id: 7,
                username: "homura".to_string(),
                display_name: None,
            },
        }
    }

    #[test]
    fn card_library_rejects_unknown_route_and_get_body() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            store_session(&secrets, &stored_test_session()).unwrap();

            let error = cloud_card_library_request(
                &state,
                &secrets,
                card_request("arbitrary-internal-route"),
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);
            assert!(server.last_card_request.lock().unwrap().is_none());

            // GET 路由携带 body 被拒：方法语义由路由表独占，renderer 不能扩展。
            let error = cloud_card_library_request(
                &state,
                &secrets,
                CloudCardLibraryRequest {
                    route_id: "public-data-cards.query".to_string(),
                    query: None,
                    body: Some(serde_json::json!({"x": 1})),
                },
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);
            assert!(server.last_card_request.lock().unwrap().is_none());
        });
    }

    #[test]
    fn card_library_required_route_without_session_fails_closed() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();

            let error =
                cloud_card_library_request(&state, &secrets, card_request("data-cards.query"))
                    .await
                    .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::NotAuthenticated);
            // fail-closed 不能产生网络请求。
            assert!(server.last_card_request.lock().unwrap().is_none());
        });
    }

    #[test]
    fn card_library_optional_route_works_anonymously_and_attaches_session() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();

            // 无会话：公开路由匿名成功，不带 Cookie。
            let mut request = card_request("public-data-cards.query");
            request.query = Some(std::collections::BTreeMap::from([
                ("type".to_string(), "character".to_string()),
                ("limit".to_string(), "12".to_string()),
            ]));
            let response = cloud_card_library_request(&state, &secrets, request)
                .await
                .expect("optional route must work anonymously");
            assert_eq!(response.status, 200);
            assert_eq!(response.body["success"], serde_json::json!(true));
            let (target, head, _) =
                server.last_card_request.lock().unwrap().clone().unwrap();
            assert!(target.contains("type=character"), "query 必须透传：{target}");
            assert!(target.contains("limit=12"));
            assert!(
                !head.to_ascii_lowercase().contains("\r\ncookie:"),
                "无会话时不得携带 Cookie：{head}"
            );

            // 有会话：Required 路由附带 Cookie 并把 body 原样送达。
            store_session(&secrets, &stored_test_session()).unwrap();
            let response = cloud_card_library_request(
                &state,
                &secrets,
                CloudCardLibraryRequest {
                    route_id: "data-cards.create".to_string(),
                    query: None,
                    body: Some(serde_json::json!({
                        "type": "character", "name": "n", "description": "", "data": {}, "isPublic": 0,
                    })),
                },
            )
            .await
            .unwrap();
            assert_eq!(response.status, 200);
            let (_, head, body) = server.last_card_request.lock().unwrap().clone().unwrap();
            assert!(
                head.to_ascii_lowercase().contains("cookie: better-auth.session_token=native.tok"),
                "已登录请求必须附带会话 cookie：{head}"
            );
            assert_eq!(body.unwrap()["name"], serde_json::json!("n"));
        });
    }

    #[test]
    fn card_library_required_401_clears_stored_session() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            store_session(&secrets, &stored_test_session()).unwrap();

            *server.card_response_override.lock().unwrap() =
                Some((401, r#"{"success":false,"error":"未登录"}"#.to_string()));
            let response =
                cloud_card_library_request(&state, &secrets, card_request("favorites.query"))
                    .await
                    .expect("401 是业务响应而不是传输失败");
            assert_eq!(response.status, 401);
            // 服务端明确否认会话 → 本地凭据清除（与 cloud_auth_status 同语义）。
            assert!(load_session(&secrets).unwrap().is_none());
        });
    }

    #[test]
    fn card_library_bounds_query_and_body() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();
            store_session(&secrets, &stored_test_session()).unwrap();

            // 超长 query value 拒绝。
            let mut request = card_request("data-cards.query");
            request.query = Some(std::collections::BTreeMap::from([(
                "search".to_string(),
                "x".repeat(CARD_LIBRARY_QUERY_VALUE_MAX + 1),
            )]));
            let error = cloud_card_library_request(&state, &secrets, request)
                .await
                .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);

            // 1 MiB 产品上限内的正文连同 JSON 包装必须放行——服务端是唯一权威裁决者
            //（D5.0e-r1：native transport cap 对齐 1MiB 产品限制 + 包装余量）。
            *server.card_response_override.lock().unwrap() =
                Some((200, r#"{"success":true}"#.to_string()));
            let response = cloud_card_library_request(
                &state,
                &secrets,
                CloudCardLibraryRequest {
                    route_id: "data-cards.create".to_string(),
                    query: None,
                    body: Some(serde_json::json!({
                        "type": "character", "name": "n", "description": "",
                        "data": "x".repeat(1024 * 1024), "isPublic": 0,
                    })),
                },
            )
            .await
            .expect("1MiB 正文加 JSON 包装必须能透传到服务端");
            assert_eq!(response.status, 200);
            assert!(server.last_card_request.lock().unwrap().is_some());

            // 超限 body 拒绝。
            *server.card_response_override.lock().unwrap() = None;
            *server.last_card_request.lock().unwrap() = None;
            let error = cloud_card_library_request(
                &state,
                &secrets,
                CloudCardLibraryRequest {
                    route_id: "data-cards.create".to_string(),
                    query: None,
                    body: Some(serde_json::json!({
                        "data": "x".repeat(CARD_LIBRARY_BODY_MAX_BYTES),
                    })),
                },
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidRequest);
            assert!(server.last_card_request.lock().unwrap().is_none());
        });
    }

    #[test]
    fn card_library_rejects_oversize_response() {
        rt().block_on(async {
            let server = spawn_mock_server();
            let state = CloudState::with_origin(&server.origin);
            let secrets = MemorySecrets::new();

            *server.card_response_override.lock().unwrap() =
                Some((200, "x".repeat(CARD_LIBRARY_RESPONSE_MAX_BYTES + 8)));
            let error = cloud_card_library_request(
                &state,
                &secrets,
                card_request("public-data-cards.query"),
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, CloudErrorCode::InvalidResponse);
        });
    }
}
