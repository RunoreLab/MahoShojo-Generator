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
//! - 兼容探测只发生在主动使用在线能力时，不阻塞离线启动。

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

/// 开发构建允许经编译期环境变量把 origin 指向 loopback 联调环境；
/// release 构建永远使用生产 origin，环境变量不生效。
fn cloud_origin() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(origin) = std::env::var("MAHOSHOJO_CLOUD_ORIGIN") {
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
const PROTOCOL_VERSION: &str = "desktop-auth-v1";
const LOOPBACK_CALLBACK_PATH: &str = "/callback";
const HOSTED_CONTRACT_VERSION: &str = "g25e1-v1";

/// 账号会话凭据的 keyring 引用。与 `provider-key:*` 命名空间完全隔离（DESK-092）。
const ACCOUNT_SESSION_REF: &str = "account-session:web-v1";

/// 登录流程总时限。用户需要在浏览器里完成登录/授权，15 分钟是宽松上限。
const LOGIN_DEADLINE: Duration = Duration::from_secs(15 * 60);
/// 单次 HTTP 请求超时：状态查询/交换都是小请求。
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
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
        .timeout(HTTP_TIMEOUT)
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

    let receiver = {
        let mut slot = flow.receiver.lock().map_err(|_| {
            state.remove_flow(flow_id);
            CloudError::new(CloudErrorCode::InternalError, "登录流程状态不可用")
        })?;
        slot.take().ok_or_else(|| {
            state.remove_flow(flow_id);
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

/// `cloud_online_status`：主动使用在线能力时的最小探测（`/api/hosted/dr-readiness`）。
pub async fn cloud_online_status(
    state: &CloudState,
    secrets: &dyn SecretStore,
) -> Result<CloudOnlineStatus, CloudError> {
    let session = load_session(secrets)?;
    let request = match &session {
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

    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => {
            return Ok(CloudOnlineStatus {
                reachable: false,
                contract_version: None,
                compatible: None,
            })
        }
    };

    if !response.status().is_success() {
        return Ok(CloudOnlineStatus {
            reachable: false,
            contract_version: None,
            compatible: None,
        });
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| CloudError::invalid_response("在线状态探测"))?;

    let contract_version = payload
        .get("contractVersion")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let compatible = contract_version
        .as_deref()
        .map(|runtime| is_hosted_contract_compatible(runtime, HOSTED_CONTRACT_VERSION));

    Ok(CloudOnlineStatus {
        reachable: true,
        contract_version,
        compatible,
    })
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
        get_session_ok: std::sync::atomic::AtomicBool,
        shutdown: CancellationToken,
    }

    fn spawn_mock_server() -> Arc<MockServer> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind mock");
        listener.set_nonblocking(true).expect("nonblocking");
        let port = listener.local_addr().unwrap().port();
        let server = Arc::new(MockServer {
            origin: format!("http://127.0.0.1:{port}"),
            last_exchange_body: Mutex::new(None),
            get_session_ok: std::sync::atomic::AtomicBool::new(true),
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

                        let response = server.route(&target, body_bytes);
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
        fn route(&self, target: &str, body: &[u8]) -> MockResponse {
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
                DR_READINESS_PATH => json(serde_json::json!({
                    "ok": true,
                    "contractVersion": "g25e1-v1"
                })),
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
    }
}
