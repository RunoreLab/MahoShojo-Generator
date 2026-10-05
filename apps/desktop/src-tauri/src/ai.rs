//! Direct AI 的 native 执行核。
//!
//! 冻结的边界（`ADR-desktop-tauri-v1` 第 5 条、`SPEC-desktop-client-v1` DESK-030..033）：
//!
//! - 出站请求只由 Rust 发起，renderer 不获得任何 fetch 能力；
//! - endpoint 与 header 只能来自已保存 Profile 的窄投影，请求 DTO **不携带** endpoint、
//!   header 字面量或 secret 明文，只带 `profileId`；
//! - 重定向默认关闭（Profile 未声明时为 0），且跨 origin 绝不携带凭据；
//! - 长流走 `Channel<AiStreamEvent>`，并保证单一终态；
//! - 取消必须真正中止上游 HTTP body，而不只是停止向 renderer 投递。
//!
//! `AiStreamEvent` 与 `AiExecutionResult` 在这里用 serde 镜像 `@mahoshojo/ai-core` 的定义。
//! 镜像体量本身就是风险，因此两侧共用一份 fixture：TypeScript 用 zod schema 校验，
//! Rust 在编译期 `include_str!` 读入并断言不回环丢字段。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::provider_profile::DirectProviderExecutionProfile;
use crate::secret::SecretStore;
use crate::sse::{SseFrame, SseFrameParser};
use crate::store::LocalStore;
use futures_util::StreamExt;

/// 单个 delta 事件的聚合阈值。太小会把 IPC 变成瓶颈，太大则让首字延迟变差。
const DELTA_FLUSH_CHARS: usize = 48;
const DELTA_FLUSH_INTERVAL: Duration = Duration::from_millis(40);

#[cfg(test)]
pub(crate) const STREAM_FIXTURE: &str =
    include_str!("../../../../packages/contracts/fixtures/ai-stream-events.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiExecutionMode {
    DirectLocal,
    DirectRemote,
    Hosted,
    Authoritative,
}

/// 与 `@mahoshojo/ai-core` 的 `AiStreamEvent` 一一对应。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AiStreamEvent {
    Started {
        request_id: String,
        contract_version: u32,
        mode: AiExecutionMode,
        sequence: u32,
    },
    TextDelta {
        request_id: String,
        contract_version: u32,
        mode: AiExecutionMode,
        sequence: u32,
        delta: String,
    },
    ReasoningDelta {
        request_id: String,
        contract_version: u32,
        mode: AiExecutionMode,
        sequence: u32,
        delta: String,
    },
    Usage {
        request_id: String,
        contract_version: u32,
        mode: AiExecutionMode,
        sequence: u32,
        usage: AiExecutionUsage,
    },
    Result {
        request_id: String,
        contract_version: u32,
        mode: AiExecutionMode,
        sequence: u32,
        result: AiExecutionResult,
    },
}

impl AiStreamEvent {
    #[cfg(test)]
    pub(crate) fn identity(&self) -> (&str, u32, AiExecutionMode) {
        match self {
            AiStreamEvent::Started {
                request_id,
                contract_version,
                mode,
                ..
            }
            | AiStreamEvent::TextDelta {
                request_id,
                contract_version,
                mode,
                ..
            }
            | AiStreamEvent::ReasoningDelta {
                request_id,
                contract_version,
                mode,
                ..
            }
            | AiStreamEvent::Usage {
                request_id,
                contract_version,
                mode,
                ..
            }
            | AiStreamEvent::Result {
                request_id,
                contract_version,
                mode,
                ..
            } => (request_id, *contract_version, *mode),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionUsage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiExecutionFinishReason {
    Stop,
    Length,
    ContentFilter,
    ToolCalls,
    Other,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionOutput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionCompletedResult {
    pub request_id: String,
    pub contract_version: u32,
    pub mode: AiExecutionMode,
    pub output: AiExecutionOutput,
    pub finish_reason: AiExecutionFinishReason,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<AiExecutionUsage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionErrorPayload {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionFailedResult {
    pub request_id: String,
    pub contract_version: u32,
    pub mode: AiExecutionMode,
    pub error: AiExecutionErrorPayload,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionCancelledResult {
    pub request_id: String,
    pub contract_version: u32,
    pub mode: AiExecutionMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AiExecutionResult {
    Completed(AiExecutionCompletedResult),
    Failed(AiExecutionFailedResult),
    Cancelled(AiExecutionCancelledResult),
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecutionMessage {
    pub role: String,
    pub content: String,
}

/// 与 `@mahoshojo/contracts` 的 `AiExecutionRequest` 对应。
///
/// 标了 `deny_unknown_fields`：renderer 不得携带 native 不解析的字段。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiExecutionRequest {
    pub request_id: String,
    pub contract_version: u32,
    pub mode: AiExecutionMode,
    pub messages: Vec<AiExecutionMessage>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub response_format: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DirectAiErrorCode {
    ProfileNotFound,
    ProfileRejected,
    MissingSecret,
    UnsupportedRequest,
    UpstreamUnavailable,
    UpstreamRejected,
    StreamProtocol,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectAiError {
    pub code: DirectAiErrorCode,
    pub message: String,
    /// 上游自述映射出的契约错误码。仅在能从 Provider 响应中确定时存在。
    pub contract_code: Option<String>,
}

impl DirectAiError {
    fn new(code: DirectAiErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            contract_code: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 取消注册表
// ---------------------------------------------------------------------------

/// `requestId -> CancellationToken`。
///
/// 取消必须真正中止上游 HTTP body，因此需要 Rust 侧持有可 drop 的取消句柄，
/// 而不是依赖"renderer 不再监听 Channel"。
#[derive(Clone, Default)]
pub struct RequestRegistry {
    entries: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl RequestRegistry {
    pub fn register(&self, request_id: &str) -> Result<CancellationToken, DirectAiError> {
        let mut guard = self.entries.lock().map_err(|_| {
            DirectAiError::new(DirectAiErrorCode::Failed, "request registry poisoned")
        })?;
        if guard.contains_key(request_id) {
            return Err(DirectAiError::new(
                DirectAiErrorCode::UnsupportedRequest,
                "request id is already in flight",
            ));
        }
        let token = CancellationToken::new();
        guard.insert(request_id.to_string(), token.clone());
        Ok(token)
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut guard) = self.entries.lock() {
            guard.remove(request_id);
        }
    }

    /// 取消一个在途请求。返回是否命中。
    pub fn cancel(&self, request_id: &str) -> bool {
        match self.entries.lock() {
            Ok(guard) => match guard.get(request_id) {
                Some(token) => {
                    token.cancel();
                    true
                }
                None => false,
            },
            Err(_) => false,
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.lock().map(|guard| guard.len()).unwrap_or(0)
    }
}

// ---------------------------------------------------------------------------
// 上游事件映射
// ---------------------------------------------------------------------------

/// 上游 usage 的原始形状。
///
/// **不能**直接用 `AiExecutionUsage` 反序列化：OpenAI-compatible 家族实际发送的是
/// `prompt_tokens` / `completion_tokens` 这类 snake_case 字段，而我们的契约形状是
/// camelCode 的 `inputTokens` / `outputTokens`。直接反序列化会因为 `#[serde(default)]`
/// 而静默变成全 None——一个不会报错、只会让 token 统计消失的缺陷。
#[derive(Debug, Clone, Default, Deserialize)]
struct UpstreamUsage {
    #[serde(default)]
    prompt_tokens: Option<u64>,
    #[serde(default)]
    completion_tokens: Option<u64>,
    #[serde(default)]
    reasoning_tokens: Option<u64>,
    #[serde(default)]
    total_tokens: Option<u64>,
    #[serde(default)]
    prompt_tokens_details: Option<UpstreamPromptTokensDetails>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct UpstreamPromptTokensDetails {
    #[serde(default)]
    cached_tokens: Option<u64>,
}

impl UpstreamUsage {
    fn into_contract(self) -> AiExecutionUsage {
        AiExecutionUsage {
            input_tokens: self.prompt_tokens,
            output_tokens: self.completion_tokens,
            reasoning_tokens: self.reasoning_tokens,
            cached_input_tokens: self
                .prompt_tokens_details
                .and_then(|details| details.cached_tokens),
            total_tokens: self.total_tokens,
        }
    }
}

#[derive(Debug, Deserialize)]
struct UpstreamChunk {
    #[serde(default)]
    choices: Vec<UpstreamChoice>,
    #[serde(default)]
    usage: Option<UpstreamUsage>,
    #[serde(default)]
    error: Option<UpstreamError>,
}

#[derive(Debug, Deserialize)]
struct UpstreamChoice {
    #[serde(default)]
    delta: UpstreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct UpstreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    reasoning: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpstreamError {
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    code: Option<String>,
}

fn map_finish_reason(value: Option<&str>) -> AiExecutionFinishReason {
    match value {
        Some("stop") => AiExecutionFinishReason::Stop,
        Some("length") => AiExecutionFinishReason::Length,
        Some("content_filter") => AiExecutionFinishReason::ContentFilter,
        Some("tool_calls") => AiExecutionFinishReason::ToolCalls,
        _ => AiExecutionFinishReason::Other,
    }
}

fn map_error_code(value: Option<&str>) -> String {
    match value {
        Some("rate_limit_exceeded") | Some("rate_limit_error") => "rate-limited",
        Some("invalid_api_key") | Some("authentication_error") | Some("unauthorized") => {
            "authentication-failed"
        }
        Some("permission_denied") => "permission-denied",
        Some("content_filter") | Some("content_policy_violation") => "content-filtered",
        Some("context_length_exceeded") | Some("model_length") => "output-too-large",
        _ => "internal-error",
    }
    .to_string()
}

// ---------------------------------------------------------------------------
// 出站执行
// ---------------------------------------------------------------------------

/// 构造 OpenAI-compatible 的 chat completions 请求体。
fn build_request_body(
    profile: &DirectProviderExecutionProfile,
    request: &AiExecutionRequest,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": request.model_id.as_deref().unwrap_or(&profile.model_id),
        "messages": request
            .messages
            .iter()
            .map(|message| serde_json::json!({ "role": message.role, "content": message.content }))
            .collect::<Vec<_>>(),
        "stream": true,
        "stream_options": { "include_usage": true },
    });

    if let Some(max_tokens) = request.max_output_tokens {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if request.response_format.as_deref() == Some("json") {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    body
}

fn build_endpoint(profile: &DirectProviderExecutionProfile) -> Result<url::Url, DirectAiError> {
    let mut endpoint = url::Url::parse(&profile.base_url).map_err(|_| {
        DirectAiError::new(
            DirectAiErrorCode::ProfileRejected,
            "profile base URL is invalid",
        )
    })?;
    // 必须按路径**追加**而不是用 Url::join：base 形如 `.../v1` 时，join 会把 `v1`
    // 当成文件名替换掉，得到 `/chat/completions`，从而丢掉 OpenAI-compatible 根路径。
    let base_path = endpoint.path().trim_end_matches('/');
    endpoint.set_path(&format!("{base_path}/chat/completions"));
    // Profile 的 baseUrl 是 API 根。显式清空 query 与 fragment，避免用户误配的查询参数
    // 把凭据带到意料之外的位置。
    endpoint.set_query(None);
    endpoint.set_fragment(None);
    Ok(endpoint)
}

/// 组装出站 header。
///
/// 凭据只在这里、只在 Rust 内部被解引用。返回值不进入日志、不进入事件流。
fn build_headers(
    profile: &DirectProviderExecutionProfile,
    secrets: &dyn SecretStore,
) -> Result<reqwest::header::HeaderMap, DirectAiError> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("text/event-stream"),
    );
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    for (name, value) in profile.public_headers.clone().unwrap_or_default() {
        let header_name =
            reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
                DirectAiError::new(
                    DirectAiErrorCode::ProfileRejected,
                    "invalid public header name",
                )
            })?;
        let header_value = reqwest::header::HeaderValue::from_str(&value).map_err(|_| {
            DirectAiError::new(
                DirectAiErrorCode::ProfileRejected,
                "invalid public header value",
            )
        })?;
        headers.insert(header_name, header_value);
    }

    if let Some(secret_ref) = &profile.api_key_ref {
        let value = secrets
            .resolve(secret_ref)
            .map_err(|_| {
                DirectAiError::new(
                    DirectAiErrorCode::MissingSecret,
                    "cannot read the stored API key",
                )
            })?
            .ok_or_else(|| {
                DirectAiError::new(
                    DirectAiErrorCode::MissingSecret,
                    "no API key is stored for this profile",
                )
            })?;
        headers.insert(
            reqwest::header::AUTHORIZATION,
            reqwest::header::HeaderValue::from_str(&format!("Bearer {value}")).map_err(|_| {
                DirectAiError::new(
                    DirectAiErrorCode::ProfileRejected,
                    "stored API key is not a valid header value",
                )
            })?,
        );
    }

    for (name, secret_ref) in profile.secret_header_refs.clone().unwrap_or_default() {
        let value = secrets
            .resolve(&secret_ref)
            .map_err(|_| {
                DirectAiError::new(
                    DirectAiErrorCode::MissingSecret,
                    "cannot read a stored secret header",
                )
            })?
            .ok_or_else(|| {
                DirectAiError::new(
                    DirectAiErrorCode::MissingSecret,
                    "no secret is stored for a configured header",
                )
            })?;
        let header_name =
            reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
                DirectAiError::new(
                    DirectAiErrorCode::ProfileRejected,
                    "invalid secret header name",
                )
            })?;
        let header_value = reqwest::header::HeaderValue::from_str(&value).map_err(|_| {
            DirectAiError::new(
                DirectAiErrorCode::ProfileRejected,
                "stored secret header is not a valid header value",
            )
        })?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
}

/// 构造一个 `reqwest::Client`。重定向策略由 Profile 决定，缺省为完全不跟随。
pub fn build_http_client(max_redirects: u8) -> Result<reqwest::Client, DirectAiError> {
    let mut builder = reqwest::Client::builder()
        // 不读取环境代理：Direct 出站不应被机器上的 HTTP_PROXY 改写目标。
        .no_proxy()
        // Direct 不占用本站服务器资源，默认不设应用层连接或总时长硬超时；
        // 等待响应头和读取 body 都由同一取消令牌中止。
        .user_agent(concat!("MahoShojo-Desktop/", env!("CARGO_PKG_VERSION")));
    builder = if max_redirects == 0 {
        builder.redirect(reqwest::redirect::Policy::none())
    } else {
        builder.redirect(reqwest::redirect::Policy::limited(max_redirects as usize))
    };
    builder
        .build()
        .map_err(|_| DirectAiError::new(DirectAiErrorCode::Failed, "cannot build the HTTP client"))
}

fn map_http_status(status: reqwest::StatusCode) -> DirectAiErrorCode {
    // 5xx 视为"上游暂时不可用"（可重试），其余非 2xx 视为"上游拒绝"（换凭据或换参数才有用）。
    if status.is_server_error() {
        DirectAiErrorCode::UpstreamUnavailable
    } else {
        DirectAiErrorCode::UpstreamRejected
    }
}

/// 流事件的汇。
///
/// 抽象成 trait 而不是直接用 `Channel`：流折叠逻辑（delta 聚合、单一终态、取消）必须能在
/// 没有 Tauri 运行时的测试里被完整驱动。把 IPC 留在实现层，才能对"取消真的中止了上游"
/// 写端到端断言，而不是只能靠 code review。
pub trait EventSink: Sync {
    // 需要 Sync：\&dyn EventSink\ 会跨 await 点被持有，因此必须随 future 一起是 Send。
    fn send(&self, event: AiStreamEvent) -> Result<(), ()>;
}

impl EventSink for Channel<AiStreamEvent> {
    fn send(&self, event: AiStreamEvent) -> Result<(), ()> {
        Channel::send(self, event).map_err(|_| ())
    }
}

fn emit_event(on_event: &dyn EventSink, event: AiStreamEvent) -> Result<(), DirectAiError> {
    on_event.send(event).map_err(|_| {
        DirectAiError::new(DirectAiErrorCode::Cancelled, "the event channel was closed")
    })
}

#[allow(clippy::too_many_arguments)]
fn emit_terminal(
    on_event: &dyn EventSink,
    request_id: &str,
    contract_version: u32,
    mode: AiExecutionMode,
    sequence: u32,
    result: AiExecutionResult,
) -> Result<(), DirectAiError> {
    emit_event(
        on_event,
        AiStreamEvent::Result {
            request_id: request_id.to_string(),
            contract_version,
            mode,
            sequence,
            result,
        },
    )
}

/// HTTP chunk 不保证落在字符边界，只保留尚未完整的 UTF-8 尾部（最多 3 字节）。
///
/// `pub(crate)`：hosted 生成通路（cloud.rs）同样按 SSE over HTTP 消费文本帧，
/// 同一份解码器保持两条通路对截断多字节字符的行为一致。
#[derive(Default)]
pub(crate) struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Result<String, DirectAiError> {
        let bytes = if self.pending.is_empty() {
            std::borrow::Cow::Borrowed(chunk)
        } else {
            let mut bytes = std::mem::take(&mut self.pending);
            bytes.extend_from_slice(chunk);
            std::borrow::Cow::Owned(bytes)
        };
        match std::str::from_utf8(&bytes) {
            Ok(text) => Ok(text.to_owned()),
            Err(error) if error.error_len().is_none() => {
                let valid = error.valid_up_to();
                self.pending = bytes[valid..].to_vec();
                Ok(std::str::from_utf8(&bytes[..valid])
                    .expect("validated UTF-8 prefix")
                    .to_owned())
            }
            Err(_) => Err(DirectAiError::new(
                DirectAiErrorCode::StreamProtocol,
                "upstream stream contains invalid UTF-8",
            )),
        }
    }

    pub(crate) fn finish(&self) -> Result<(), DirectAiError> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(DirectAiError::new(
                DirectAiErrorCode::StreamProtocol,
                "upstream stream ended with incomplete UTF-8",
            ))
        }
    }
}

/// 把上游 SSE 帧折叠成事件序列，并通过 Channel 投递。
///
/// 保证：
///
/// - 首个事件恒为 `started`，`sequence` 连续；
/// - 终态**恰好一次**（正常结束、上游报错、取消、超时都收敛到同一个 result 事件）；
/// - 取消会真正 drop 上游 body。
pub async fn run_stream(
    upstream: reqwest::Response,
    request: &AiExecutionRequest,
    resolved_model_id: &str,
    token: CancellationToken,
    on_event: &dyn EventSink,
) -> Result<(), DirectAiError> {
    let request_id = request.request_id.clone();
    let contract_version = request.contract_version;
    let mode = request.mode;

    // `started` is emitted by `stream_direct_ai` immediately after registering the
    // cancellation token, before request preparation or network dispatch.
    let mut sequence: u32 = 1;

    let mut parser = SseFrameParser::new();
    let mut decoder = Utf8StreamDecoder::default();
    let mut text = String::new();
    let mut reasoning = String::new();
    let mut usage: Option<AiExecutionUsage> = None;
    let mut finish_reason = AiExecutionFinishReason::Other;
    let mut pending_text = String::new();
    let mut pending_reasoning = String::new();
    let mut saw_done = false;
    // 定时器必须独立于 chunk 到达：否则上游一旦停顿（例如本地模型首 token 很慢），
    // 已经缓冲的正文会一直留在缓冲区里，用户看不到任何输出。
    let mut flush_tick = tokio::time::interval(DELTA_FLUSH_INTERVAL);
    flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let flush = |pending_text: &mut String,
                 pending_reasoning: &mut String,
                 sequence: &mut u32|
     -> Result<(), DirectAiError> {
        if !pending_reasoning.is_empty() {
            let delta = std::mem::take(pending_reasoning);
            on_event
                .send(AiStreamEvent::ReasoningDelta {
                    request_id: request_id.clone(),
                    contract_version,
                    mode,
                    sequence: *sequence,
                    delta,
                })
                .map_err(|_| {
                    DirectAiError::new(DirectAiErrorCode::Cancelled, "the event channel was closed")
                })?;
            *sequence += 1;
        }
        if !pending_text.is_empty() {
            let delta = std::mem::take(pending_text);
            on_event
                .send(AiStreamEvent::TextDelta {
                    request_id: request_id.clone(),
                    contract_version,
                    mode,
                    sequence: *sequence,
                    delta,
                })
                .map_err(|_| {
                    DirectAiError::new(DirectAiErrorCode::Cancelled, "the event channel was closed")
                })?;
            *sequence += 1;
        }
        Ok(())
    };

    let mut stream = upstream.bytes_stream();
    let mut failure: Option<DirectAiError> = None;

    loop {
        let chunk = tokio::select! {
            biased;
            _ = token.cancelled() => {
                failure = Some(DirectAiError::new(DirectAiErrorCode::Cancelled, "cancelled by the client"));
                break;
            }
            _ = flush_tick.tick() => {
                if let Err(error) = flush(&mut pending_text, &mut pending_reasoning, &mut sequence) {
                    failure = Some(error);
                    break;
                }
                continue;
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk) = chunk else { break };
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                failure = Some(DirectAiError::new(
                    DirectAiErrorCode::UpstreamUnavailable,
                    format!("upstream stream failed: {error}"),
                ));
                break;
            }
        };

        let text_chunk = match decoder.push(&chunk) {
            Ok(value) => value,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };

        let parsed = match parser.push(&text_chunk) {
            Ok(frames) => frames,
            Err(error) => {
                failure = Some(DirectAiError::new(
                    DirectAiErrorCode::StreamProtocol,
                    format!("upstream stream exceeded parser limits: {error}"),
                ));
                break;
            }
        };

        for frame in parsed {
            saw_done = parser.is_done();
            match frame {
                SseFrame::Data(payload) => {
                    let chunk: UpstreamChunk = match serde_json::from_str(&payload) {
                        Ok(chunk) => chunk,
                        Err(error) => {
                            failure = Some(DirectAiError::new(
                                DirectAiErrorCode::StreamProtocol,
                                format!("upstream sent an unreadable event: {error}"),
                            ));
                            break;
                        }
                    };

                    if let Some(error) = chunk.error {
                        // 上游自述的错误类型映射成稳定契约码，便于客户端按 code 分支处理，
                        // 而不是把供应商私有字符串透传给用户。
                        failure = Some(DirectAiError {
                            code: DirectAiErrorCode::UpstreamRejected,
                            message: error
                                .message
                                .unwrap_or_else(|| "upstream reported an error".to_string()),
                            contract_code: Some(map_error_code(
                                error.r#type.as_deref().or(error.code.as_deref()),
                            )),
                        });
                        break;
                    }

                    if let Some(reported_usage) = chunk.usage {
                        let contract_usage = reported_usage.into_contract();
                        emit_event(
                            on_event,
                            AiStreamEvent::Usage {
                                request_id: request_id.clone(),
                                contract_version,
                                mode,
                                sequence,
                                usage: contract_usage.clone(),
                            },
                        )?;
                        sequence += 1;
                        usage = Some(contract_usage);
                    }

                    for choice in chunk.choices {
                        if let Some(delta) =
                            choice.delta.reasoning_content.or(choice.delta.reasoning)
                        {
                            reasoning.push_str(&delta);
                            pending_reasoning.push_str(&delta);
                        }
                        if let Some(delta) = choice.delta.content {
                            if !delta.is_empty() {
                                text.push_str(&delta);
                                pending_text.push_str(&delta);
                            }
                        }
                        if choice.finish_reason.is_some() {
                            finish_reason = map_finish_reason(choice.finish_reason.as_deref());
                        }
                    }
                }
            }
        }

        if failure.is_some() {
            break;
        }

        // 达到阈值就立即冲刷，不等下一个 tick：长正文下阈值触发比定时更关键。
        let due = pending_text.chars().count() >= DELTA_FLUSH_CHARS
            || pending_reasoning.chars().count() >= DELTA_FLUSH_CHARS;
        if due {
            if let Err(error) = flush(&mut pending_text, &mut pending_reasoning, &mut sequence) {
                failure = Some(error);
                break;
            }
        }
    }

    if failure.is_none() {
        failure = decoder.finish().err();
    }

    // 冲刷没有空行收尾的最后一帧，再收掉 body。
    // drop body 是"取消真正中止上游"的关键：只停止投递不算取消。
    let tail = match parser.finish() {
        Ok(frames) => frames,
        Err(error) => {
            if failure.is_none() {
                failure = Some(DirectAiError::new(
                    DirectAiErrorCode::StreamProtocol,
                    format!("upstream stream exceeded parser limits: {error}"),
                ));
            }
            Vec::new()
        }
    };
    for frame in tail {
        saw_done = saw_done || parser.is_done();
        let SseFrame::Data(payload) = frame;
        if let Ok(chunk) = serde_json::from_str::<UpstreamChunk>(&payload) {
            for choice in chunk.choices {
                if let Some(delta) = choice.delta.content {
                    text.push_str(&delta);
                    pending_text.push_str(&delta);
                }
            }
        }
    }
    saw_done = saw_done || parser.is_done();
    drop(stream);

    if let Some(error) = failure {
        flush(&mut pending_text, &mut pending_reasoning, &mut sequence).ok();
        let result = match error.code {
            DirectAiErrorCode::Cancelled => {
                AiExecutionResult::Cancelled(AiExecutionCancelledResult {
                    request_id: request_id.clone(),
                    contract_version,
                    mode,
                    reason: Some("aborted".to_string()),
                })
            }
            _ => AiExecutionResult::Failed(AiExecutionFailedResult {
                request_id: request_id.clone(),
                contract_version,
                mode,
                error: AiExecutionErrorPayload {
                    code: error
                        .contract_code
                        .unwrap_or_else(|| error_code_string(error.code).to_string()),
                    message: Some(error.message),
                    retryable: None,
                    retry_after_ms: None,
                },
            }),
        };
        return emit_terminal(
            on_event,
            &request_id,
            contract_version,
            mode,
            sequence,
            result,
        );
    }

    flush(&mut pending_text, &mut pending_reasoning, &mut sequence)?;
    if !saw_done {
        // 上游没有 `[DONE]` 就断流：按"缺少终态"处理，而不是把半截正文当成功。
        let failed = AiExecutionResult::Failed(AiExecutionFailedResult {
            request_id: request_id.clone(),
            contract_version,
            mode,
            error: AiExecutionErrorPayload {
                code: "internal-error".to_string(),
                message: Some("upstream stream ended without a terminal marker".to_string()),
                retryable: None,
                retry_after_ms: None,
            },
        });
        return emit_terminal(
            on_event,
            &request_id,
            contract_version,
            mode,
            sequence,
            failed,
        );
    }

    let completed = AiExecutionResult::Completed(AiExecutionCompletedResult {
        request_id: request_id.clone(),
        contract_version,
        mode,
        output: AiExecutionOutput {
            text: Some(text.clone()).filter(|value| !value.is_empty()),
            reasoning: Some(reasoning.clone()).filter(|value| !value.is_empty()),
        },
        finish_reason,
        resolved_model_id: Some(resolved_model_id.to_string()),
        usage: usage.clone(),
    });
    emit_terminal(
        on_event,
        &request_id,
        contract_version,
        mode,
        sequence,
        completed,
    )
}

pub fn error_code_string(code: DirectAiErrorCode) -> &'static str {
    match code {
        DirectAiErrorCode::ProfileNotFound => "invalid-request",
        DirectAiErrorCode::ProfileRejected => "invalid-request",
        DirectAiErrorCode::MissingSecret => "authentication-failed",
        DirectAiErrorCode::UnsupportedRequest => "invalid-request",
        DirectAiErrorCode::UpstreamUnavailable => "service-unavailable",
        DirectAiErrorCode::UpstreamRejected => "permission-denied",
        DirectAiErrorCode::StreamProtocol => "invalid-response",
        DirectAiErrorCode::Cancelled => "cancelled",
        DirectAiErrorCode::Failed => "internal-error",
    }
}

fn emit_pre_stream_error_terminal(
    request: &AiExecutionRequest,
    error: DirectAiError,
    on_event: &dyn EventSink,
) -> Result<(), DirectAiError> {
    let result = match error.code {
        DirectAiErrorCode::Cancelled => AiExecutionResult::Cancelled(AiExecutionCancelledResult {
            request_id: request.request_id.clone(),
            contract_version: request.contract_version,
            mode: request.mode,
            reason: Some("aborted".to_string()),
        }),
        _ => AiExecutionResult::Failed(AiExecutionFailedResult {
            request_id: request.request_id.clone(),
            contract_version: request.contract_version,
            mode: request.mode,
            error: AiExecutionErrorPayload {
                code: error
                    .contract_code
                    .unwrap_or_else(|| error_code_string(error.code).to_string()),
                message: Some(error.message),
                retryable: None,
                retry_after_ms: None,
            },
        }),
    };
    emit_terminal(
        on_event,
        &request.request_id,
        request.contract_version,
        request.mode,
        1,
        result,
    )
}

/// 端到端入口：读 Profile、取 secret、发请求、跑流。
pub async fn stream_direct_ai(
    profile_id: &str,
    request: AiExecutionRequest,
    store: &LocalStore,
    secrets: &dyn SecretStore,
    registry: &RequestRegistry,
    on_event: &dyn EventSink,
) -> Result<(), DirectAiError> {
    if request.mode != AiExecutionMode::DirectLocal && request.mode != AiExecutionMode::DirectRemote
    {
        return Err(DirectAiError::new(
            DirectAiErrorCode::UnsupportedRequest,
            "Direct execution only accepts direct-local or direct-remote",
        ));
    }
    if request.messages.is_empty() || request.contract_version != 1 {
        return Err(DirectAiError::new(
            DirectAiErrorCode::UnsupportedRequest,
            "unsupported AI execution request",
        ));
    }

    let document = store
        .get(profile_id)
        .map_err(|error| DirectAiError::new(DirectAiErrorCode::Failed, error.message()))?
        .ok_or_else(|| {
            DirectAiError::new(
                DirectAiErrorCode::ProfileNotFound,
                "no such provider profile",
            )
        })?;

    let profile = crate::provider_profile::parse_stored_profile(&document).map_err(|error| {
        DirectAiError::new(
            DirectAiErrorCode::ProfileRejected,
            error.message().to_string(),
        )
    })?;

    let token = registry.register(&request.request_id)?;
    if let Err(error) = emit_event(
        on_event,
        AiStreamEvent::Started {
            request_id: request.request_id.clone(),
            contract_version: request.contract_version,
            mode: request.mode,
            sequence: 0,
        },
    ) {
        registry.finish(&request.request_id);
        return Err(error);
    }

    let result = stream_direct_ai_inner(&profile, &request, secrets, token, on_event).await;
    registry.finish(&request.request_id);
    result
}

async fn stream_direct_ai_inner(
    profile: &DirectProviderExecutionProfile,
    request: &AiExecutionRequest,
    secrets: &dyn SecretStore,
    token: CancellationToken,
    on_event: &dyn EventSink,
) -> Result<(), DirectAiError> {
    let client = match build_http_client(profile.max_redirects()) {
        Ok(client) => client,
        Err(error) => return emit_pre_stream_error_terminal(request, error, on_event),
    };
    let endpoint = match build_endpoint(profile) {
        Ok(endpoint) => endpoint,
        Err(error) => return emit_pre_stream_error_terminal(request, error, on_event),
    };
    let headers = match build_headers(profile, secrets) {
        Ok(headers) => headers,
        Err(error) => return emit_pre_stream_error_terminal(request, error, on_event),
    };
    let body = build_request_body(profile, request);

    let upstream = tokio::select! {
        biased;
        _ = token.cancelled() => {
            return emit_pre_stream_error_terminal(
                request,
                DirectAiError::new(DirectAiErrorCode::Cancelled, "cancelled before dispatch"),
                on_event,
            );
        }
        result = client.post(endpoint).headers(headers).json(&body).send() => result,
    };

    let upstream = match upstream {
        Ok(response) => response,
        Err(error) => {
            return emit_pre_stream_error_terminal(
                request,
                DirectAiError::new(
                    DirectAiErrorCode::UpstreamUnavailable,
                    format!("cannot reach the provider endpoint: {error}"),
                ),
                on_event,
            );
        }
    };

    if !upstream.status().is_success() {
        // 不回显上游响应体：它可能包含供应商侧的内部标识，且对用户排障无帮助。
        return emit_pre_stream_error_terminal(
            request,
            DirectAiError::new(
                map_http_status(upstream.status()),
                format!(
                    "provider endpoint returned HTTP {}",
                    upstream.status().as_u16()
                ),
            ),
            on_event,
        );
    }

    let resolved_model_id = request.model_id.as_deref().unwrap_or(&profile.model_id);
    run_stream(upstream, request, resolved_model_id, token, on_event)
        .await
        .map(|_| ())
}

#[cfg(test)]
mod utf8_tests {
    use super::{DirectAiErrorCode, Utf8StreamDecoder};
    use crate::sse::{SseFrame, SseFrameParser};

    #[test]
    fn decodes_unicode_sse_at_every_byte_boundary() {
        let payload = "魔法少女・かなé🪄";
        let wire = format!("data: {payload}\r\n\r\ndata: [DONE]\r\n\r\n");
        for split in 0..=wire.len() {
            let mut decoder = Utf8StreamDecoder::default();
            let mut parser = SseFrameParser::new();
            let mut frames = Vec::new();
            for bytes in [&wire.as_bytes()[..split], &wire.as_bytes()[split..]] {
                frames.extend(
                    parser
                        .push(&decoder.push(bytes).expect("valid UTF-8 stream"))
                        .expect("within SSE limits"),
                );
                assert!(decoder.pending.len() <= 3);
            }
            decoder.finish().expect("complete UTF-8 stream");
            frames.extend(parser.finish().expect("within SSE limits"));
            assert_eq!(frames, vec![SseFrame::Data(payload.to_string())]);
            assert!(parser.is_done());
        }
    }

    #[test]
    fn decodes_one_byte_chunks_without_replacement_characters() {
        let source = "魔法少女・かなé🪄";
        let mut decoder = Utf8StreamDecoder::default();
        let mut decoded = String::new();
        for byte in source.as_bytes() {
            decoded.push_str(&decoder.push(&[*byte]).expect("valid byte sequence"));
            assert!(decoder.pending.len() <= 3);
        }
        decoder.finish().expect("complete UTF-8 stream");
        assert_eq!(decoded, source);
    }

    #[test]
    fn rejects_invalid_utf8_instead_of_replacing_it() {
        for bytes in [vec![0xff], vec![0xc0, 0xaf], vec![0xed, 0xa0, 0x80]] {
            let error = Utf8StreamDecoder::default().push(&bytes).unwrap_err();
            assert_eq!(error.code, DirectAiErrorCode::StreamProtocol);
        }
        let mut decoder = Utf8StreamDecoder::default();
        assert_eq!(decoder.push(&[0xe9]).unwrap(), "");
        assert_eq!(
            decoder.push(b"x").unwrap_err().code,
            DirectAiErrorCode::StreamProtocol
        );
    }

    #[test]
    fn rejects_incomplete_unicode_at_eof() {
        for character in ["é", "魔", "🪄"] {
            for split in 1..character.len() {
                let mut decoder = Utf8StreamDecoder::default();
                assert_eq!(decoder.push(&character.as_bytes()[..split]).unwrap(), "");
                assert_eq!(
                    decoder.finish().unwrap_err().code,
                    DirectAiErrorCode::StreamProtocol
                );
            }
        }
    }
}
