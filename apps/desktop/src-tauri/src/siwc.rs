//! 官方 ChatGPT 订阅仅供 Native Direct 执行使用。

mod oauth;
mod vault;

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use oauth::{Authorization, TokenReply, PLAN_SCOPE};
use vault::{Connection, Grant, Saved};

pub(crate) const RESPONSES: &str = "https://api.openai.com/v1/responses";
const MODELS: &str = "https://api.openai.com/v1/models";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ErrorCode {
    UnsupportedPlatform,
    Busy,
    Storage,
    #[cfg(not(test))]
    Browser,
    Cancelled,
    Timeout,
    InvalidResponse,
    InvalidIdentity,
    ConsentDeclined,
    ConsentRequired,
    ReauthorizationRequired,
    Ineligible,
    RateLimited,
    ModelUnavailable,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Error {
    pub(crate) code: ErrorCode,
    pub(crate) message: &'static str,
}

pub(crate) fn error(code: ErrorCode) -> Error {
    use ErrorCode::*;
    let message = match code {
        UnsupportedPlatform => "ChatGPT 订阅当前仅在 Windows 桌面端提供。",
        Busy => "请先完成当前 ChatGPT 授权，或断开已连接的账户。",
        Storage => "无法读取或保存本机保护的 ChatGPT 会话。请检查系统用户和应用数据目录。",
        #[cfg(not(test))]
        Browser => "无法打开系统浏览器。请检查默认浏览器设置后重试。",
        Cancelled => "已取消连接 ChatGPT。",
        Timeout => "等待 ChatGPT 授权超时，请重新连接。",
        InvalidResponse => "OpenAI 返回了无法使用的订阅响应。",
        InvalidIdentity => "无法确认 ChatGPT 账户身份，请重新连接。",
        ConsentDeclined => "本次 ChatGPT 授权未完成。",
        ConsentRequired => "请在连接设置中授权使用 ChatGPT 订阅。",
        ReauthorizationRequired => "ChatGPT 会话需要在 AI 连接设置中重新授权。",
        Ineligible => "当前 ChatGPT 账户、工作区或地区无法使用此订阅渠道。",
        RateLimited => "已达到 ChatGPT 用量或请求限制。可在 ChatGPT 设置中管理用量。",
        ModelUnavailable => "所选模型当前不在此 ChatGPT 账户的可用目录中。",
        Unavailable => "暂时无法连接 OpenAI，请稍后重试。",
    };
    Error { code, message }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Model {
    id: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    supported: bool,
    connected: bool,
    consent_required: bool,
    connection_id: Option<String>,
    account_label: Option<String>,
    models: Vec<Model>,
    revocation_unconfirmed: bool,
}

#[derive(Default)]
struct Runtime {
    saved: Option<Saved>,
    models: Vec<Model>,
    active: CancellationToken,
}

impl Runtime {
    fn load(&mut self, path: &Path) -> Result<&Saved, Error> {
        if self.saved.is_none() {
            self.saved = Some(Saved::load(path)?);
        }
        Ok(self.saved.as_ref().expect("loaded ChatGPT state"))
    }

    fn commit(&mut self, path: &Path, saved: Saved) -> Result<(), Error> {
        saved.save(path)?;
        self.saved = Some(saved);
        Ok(())
    }

    fn change_connection(&mut self) {
        self.active.cancel();
        self.active = CancellationToken::new();
        self.models.clear();
    }

    fn status(&self) -> Status {
        let connection = self
            .saved
            .as_ref()
            .and_then(|saved| saved.connection.as_ref());
        Status {
            supported: cfg!(windows),
            connected: connection.is_some_and(|connection| connection.grant.is_some()),
            consent_required: connection.is_some_and(|connection| {
                connection.grant.is_none() && connection.identity_hint.is_some()
            }),
            connection_id: connection.map(|connection| connection.id.clone()),
            account_label: connection.map(|connection| connection.label.clone()),
            models: self.models.clone(),
            revocation_unconfirmed: false,
        }
    }
}

pub(crate) struct State {
    path: PathBuf,
    runtime: tokio::sync::Mutex<Runtime>,
    flow: Mutex<Option<CancellationToken>>,
}

pub(crate) struct Lease {
    pub(crate) token: Zeroizing<String>,
    pub(crate) cancelled: CancellationToken,
}

struct Flow<'a>(&'a Mutex<Option<CancellationToken>>);

impl Drop for Flow<'_> {
    fn drop(&mut self) {
        if let Ok(mut flow) = self.0.lock() {
            *flow = None;
        }
    }
}

impl State {
    pub(crate) fn new(data_root: &Path) -> Self {
        Self {
            path: data_root.join("chatgpt-session.dpapi"),
            runtime: tokio::sync::Mutex::default(),
            flow: Mutex::new(None),
        }
    }

    pub(crate) async fn status(&self) -> Result<Status, Error> {
        let mut runtime = self.runtime.lock().await;
        if cfg!(windows) {
            runtime.load(&self.path)?;
        }
        Ok(runtime.status())
    }

    pub(crate) fn cancel_connect(&self) {
        if let Ok(flow) = self.flow.lock() {
            if let Some(cancel) = flow.as_ref() {
                cancel.cancel();
            }
        }
    }

    pub(crate) async fn connect(&self, different_account: bool) -> Result<Status, Error> {
        if !cfg!(windows) {
            return Err(error(ErrorCode::UnsupportedPlatform));
        }
        let cancel = CancellationToken::new();
        let _flow = {
            let mut pending = self.flow.lock().map_err(|_| error(ErrorCode::Busy))?;
            if pending.is_some() {
                return Err(error(ErrorCode::Busy));
            }
            *pending = Some(cancel.clone());
            Flow(&self.flow)
        };
        let mut saved = {
            let mut runtime = self.runtime.lock().await;
            let saved = runtime.load(&self.path)?.clone();
            if saved
                .connection
                .as_ref()
                .is_some_and(|connection| connection.grant.is_some())
            {
                return Err(error(ErrorCode::Busy));
            }
            // Persist the installation ID before OpenAI can register it.
            runtime.commit(&self.path, saved.clone())?;
            saved
        };
        let previous = saved.connection.as_ref().filter(|_| !different_account);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| error(ErrorCode::Unavailable))?;
        let port = listener
            .local_addr()
            .map_err(|_| error(ErrorCode::Unavailable))?
            .port();
        let auth = Authorization::new(
            port,
            &saved.host_id,
            previous.map(|connection| {
                (
                    connection.client_id.as_str(),
                    connection.identity_hint.as_deref(),
                )
            }),
        )?;
        let http = oauth::client()?;
        if cancel.is_cancelled() {
            return Err(error(ErrorCode::Cancelled));
        }
        #[cfg(not(test))]
        open::that_detached(auth.url.as_str()).map_err(|_| error(ErrorCode::Browser))?;
        #[cfg(test)]
        let _ = &auth.url;
        let (id, identity, grant, hint) = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(error(ErrorCode::Cancelled)),
            result = tokio::time::timeout(Duration::from_secs(300), async {
                let (code, id) = auth.listen(listener).await?;
                let mut reply = auth.exchange(&http, &code, &id).await?;
                let hint = reply.id_token.take().ok_or_else(|| error(ErrorCode::InvalidIdentity))?;
                let identity = oauth::verify_identity(&http, &hint, &id, &auth.nonce, previous.map(|value| value.subject.as_str()), true).await?;
                let grant = grant_from_reply(reply, "")?;
                Ok((id, identity, grant, hint))
            }) => result.map_err(|_| error(ErrorCode::Timeout))??,
        };
        let mut runtime = self.runtime.lock().await;
        if cancel.is_cancelled() {
            return Err(error(ErrorCode::Cancelled));
        }
        let label = identity
            .email
            .as_deref()
            .and_then(safe_label)
            .or_else(|| identity.name.as_deref().and_then(safe_label))
            .unwrap_or_else(|| "ChatGPT".into());
        saved.connection = Some(Connection {
            id: uuid::Uuid::new_v4().simple().to_string(),
            client_id: id,
            subject: identity.sub,
            label,
            nonce: auth.nonce,
            identity_hint: Some(hint),
            grant,
        });
        runtime.commit(&self.path, saved)?;
        runtime.change_connection();
        Ok(runtime.status())
    }

    pub(crate) async fn models(&self) -> Result<Status, Error> {
        let http = oauth::client()?;
        let mut runtime = self.runtime.lock().await;
        let Some(id) = runtime
            .load(&self.path)?
            .connection
            .as_ref()
            .filter(|connection| connection.grant.is_some())
            .map(|connection| connection.id.clone())
        else {
            return Ok(runtime.status());
        };
        let token = self.access_token(&http, &mut runtime, &id).await?;
        runtime.models = fetch_models(&http, &token).await?;
        Ok(runtime.status())
    }

    pub(crate) async fn lease(&self, connection_id: &str, model_id: &str) -> Result<Lease, Error> {
        let http = oauth::client()?;
        let mut runtime = self.runtime.lock().await;
        let token = self
            .access_token(&http, &mut runtime, connection_id)
            .await?;
        if runtime.models.is_empty() {
            runtime.models = fetch_models(&http, &token).await?;
        }
        if !runtime.models.iter().any(|model| model.id == model_id) {
            return Err(error(ErrorCode::ModelUnavailable));
        }
        Ok(Lease {
            token,
            cancelled: runtime.active.child_token(),
        })
    }

    pub(crate) async fn disconnect(&self, connection_id: &str) -> Result<Status, Error> {
        self.cancel_connect();
        let mut runtime = self.runtime.lock().await;
        let mut saved = runtime.load(&self.path)?.clone();
        let connection = saved
            .connection
            .as_mut()
            .filter(|connection| connection.id == connection_id)
            .ok_or_else(|| error(ErrorCode::ReauthorizationRequired))?;
        let grant = connection.grant.take();
        let client_id = connection.client_id.clone();
        connection.identity_hint = None;
        runtime.commit(&self.path, saved)?;
        runtime.change_connection();
        let mut status = runtime.status();
        if let Some(grant) = grant {
            let refresh = Zeroizing::new(grant.refresh);
            status.revocation_unconfirmed = match oauth::client() {
                Ok(http) => oauth::revoke(&http, &client_id, &refresh).await.is_err(),
                Err(_) => true,
            };
        }
        Ok(status)
    }

    async fn access_token(
        &self,
        http: &reqwest::Client,
        runtime: &mut Runtime,
        id: &str,
    ) -> Result<Zeroizing<String>, Error> {
        let mut saved = runtime.load(&self.path)?.clone();
        let connection = saved
            .connection
            .as_mut()
            .filter(|connection| connection.id == id)
            .ok_or_else(|| error(ErrorCode::ReauthorizationRequired))?;
        let grant = connection.grant.as_ref().ok_or_else(|| {
            error(if connection.identity_hint.is_some() {
                ErrorCode::ConsentRequired
            } else {
                ErrorCode::ReauthorizationRequired
            })
        })?;
        if grant.pending_identity.is_none()
            && (now().saturating_add(60) < grant.expires_at || now() < grant.earliest_refresh_at)
        {
            return if now() < grant.expires_at {
                Ok(Zeroizing::new(grant.access.clone()))
            } else {
                Err(error(ErrorCode::Unavailable))
            };
        }
        if grant.pending_identity.is_none() {
            let reply = match oauth::refresh(http, &connection.client_id, &grant.refresh).await {
                Ok(reply) => reply,
                Err(failure) => {
                    if failure.code == ErrorCode::ReauthorizationRequired {
                        connection.grant = None;
                        connection.identity_hint = None;
                        runtime.commit(&self.path, saved)?;
                        runtime.change_connection();
                    }
                    return Err(failure);
                }
            };
            connection.grant = grant_from_reply(reply, &grant.scope)?;
            // Write the successor before checking a refreshed ID token over the network.
            runtime.commit(&self.path, saved.clone())?;
        }
        let connection = saved.connection.as_mut().expect("checked connection");
        let grant = connection
            .grant
            .as_mut()
            .ok_or_else(|| error(ErrorCode::ConsentRequired))?;
        if let Some(token) = grant.pending_identity.as_ref() {
            match oauth::verify_identity(
                http,
                token,
                &connection.client_id,
                &connection.nonce,
                Some(&connection.subject),
                false,
            )
            .await
            {
                Ok(_) => connection.identity_hint = grant.pending_identity.take(),
                Err(failure) if failure.code == ErrorCode::InvalidIdentity => {
                    connection.grant = None;
                    connection.identity_hint = None;
                    runtime.commit(&self.path, saved)?;
                    runtime.change_connection();
                    return Err(failure);
                }
                Err(failure) => return Err(failure),
            }
            let token = Zeroizing::new(grant.access.clone());
            let expired = now() >= grant.expires_at;
            runtime.commit(&self.path, saved)?;
            return if expired {
                Err(error(ErrorCode::Unavailable))
            } else {
                Ok(token)
            };
        }
        Ok(Zeroizing::new(grant.access.clone()))
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn safe_label(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.chars().count() <= 200 && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

fn grant_from_reply(reply: TokenReply, previous_scope: &str) -> Result<Option<Grant>, Error> {
    let scope = reply.scope.unwrap_or_else(|| previous_scope.to_owned());
    if !scope
        .split_ascii_whitespace()
        .any(|scope| scope == PLAN_SCOPE)
    {
        return Ok(None);
    }
    let invalid = || error(ErrorCode::InvalidResponse);
    if !reply
        .token_type
        .as_deref()
        .is_some_and(|kind| kind.eq_ignore_ascii_case("Bearer"))
    {
        return Err(invalid());
    }
    let access = reply
        .access_token
        .filter(|token| oauth::valid_token(token))
        .ok_or_else(invalid)?;
    let refresh = reply
        .refresh_token
        .filter(|token| oauth::valid_token(token))
        .ok_or_else(invalid)?;
    let lifetime = reply
        .expires_in
        .filter(|lifetime| (1..=86_400).contains(lifetime))
        .ok_or_else(invalid)?;
    let earliest_refresh_at = match reply.earliest_refresh_at {
        None => 0,
        Some(serde_json::Value::Number(value)) => value.as_u64().ok_or_else(invalid)?,
        Some(serde_json::Value::String(value)) => u64::try_from(
            time::OffsetDateTime::parse(&value, &time::format_description::well_known::Rfc3339)
                .map_err(|_| invalid())?
                .unix_timestamp(),
        )
        .map_err(|_| invalid())?,
        _ => return Err(invalid()),
    };
    Ok(Some(Grant {
        access,
        refresh,
        scope,
        expires_at: now().saturating_add(lifetime),
        earliest_refresh_at,
        pending_identity: reply.id_token,
    }))
}

async fn fetch_models(http: &reqwest::Client, token: &str) -> Result<Vec<Model>, Error> {
    #[derive(Deserialize)]
    struct Offering {
        slug: String,
        display_name: Option<String>,
        visibility: String,
    }
    #[derive(Deserialize)]
    struct Catalog {
        models: Vec<Offering>,
    }
    let response = http
        .get(MODELS)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| error(ErrorCode::Unavailable))?;
    let catalog: Catalog = match response.status().as_u16() {
        200 => oauth::json_body(response, 2 * 1024 * 1024).await?,
        401 => return Err(error(ErrorCode::ReauthorizationRequired)),
        403 => return Err(error(ErrorCode::Ineligible)),
        429 => return Err(error(ErrorCode::RateLimited)),
        _ => return Err(error(ErrorCode::Unavailable)),
    };
    let mut seen = HashSet::new();
    Ok(catalog
        .models
        .into_iter()
        .filter_map(|model| {
            let id = crate::provider_target::normalize_model_id(&model.slug).ok()?;
            if model.visibility != "list" || id != model.slug || !seen.insert(id.clone()) {
                return None;
            }
            let label = model
                .display_name
                .as_deref()
                .and_then(safe_label)
                .unwrap_or_else(|| id.clone());
            Some(Model { id, label })
        })
        .take(256)
        .collect())
}
