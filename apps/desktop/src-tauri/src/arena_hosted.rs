//! Arena C1/C2 plus fixed Next reconciliation: native-only actors, bounded replay and IPC.
//! Does not share the six-family Hosted parser/budgets or expose arbitrary HTTP.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::cloud::{self, CloudHostedPresetConfig, CloudHostedSystemConfig, CloudState};
use crate::secret::{SecretStore, MAX_SECRET_VALUE_BYTES};

const ORIGIN: &str = "https://homura.colanns.me";
const CAPABILITY_PATH: &str = "/api/hosted/dr-readiness";
const CREATE_PATH: &str = "/api/arena/generate-stream";
const ACTOR_HEADER: &str = "x-mahoshojo-generation-actor-token";
const EXPECTED_USER_HEADER: &str = "x-mahoshojo-arena-expected-user-id";
const INPUT_BYTES: usize = 12 * 1024 * 1024;
const OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const EVENT_BYTES: usize = 6 * OUTPUT_BYTES + 64 * 1024;
const IPC_TEXT_BYTES: usize = 64 * 1024;
const IPC_BYTES: usize = 512 * 1024;
const HEADER_BYTES: usize = 64 * 1024;
const SHORT_TIMEOUT: Duration = Duration::from_secs(15);
const BOOTSTRAP_LIFETIME_MS: u64 = 15 * 60 * 1000;
const TOKEN_LIFETIME_MS: u64 = 90 * 24 * 60 * 60 * 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaError {
    pub dispatch_state: &'static str,
    pub intent_ownership: &'static str,
    pub code: &'static str,
    pub message: &'static str,
}
fn error(code: &'static str, message: &'static str) -> ArenaError {
    ArenaError {
        dispatch_state: "not-dispatched",
        intent_ownership: "unknown",
        code,
        message,
    }
}
fn invalid() -> ArenaError {
    error("invalid-request", "Arena 请求不符合受支持协议")
}
fn protocol() -> ArenaError {
    error(
        "invalid-response",
        "Arena 服务响应不符合协议；保留已收到内容，仅可查找或恢复",
    )
}
fn storage() -> ArenaError {
    error("storage-unavailable", "Arena 恢复凭据存储不可用")
}
fn stale() -> ArenaError {
    error("scope-changed", "账号或生成范围已改变，原请求未继续派发")
}
fn network() -> ArenaError {
    error(
        "network-error",
        "Arena 网络结果未知，请查找原请求；不要重新创建",
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Product {
    Battle,
    Arena,
}
impl Product {
    fn slot(self) -> &'static str {
        match self {
            Self::Battle => "account-session:arena-anonymous:battle:v1",
            Self::Arena => "account-session:arena-anonymous:arena:v1",
        }
    }
}
#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Actor {
    Anonymous,
    Account {
        #[serde(rename = "expectedUserId")]
        expected_user_id: u64,
    },
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetachRequest {
    pub product: Product,
    pub request_id: String,
}
#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ArenaRequest {
    CreateStream {
        product: Product,
        request_id: String,
        actor: Actor,
        body: Value,
        #[serde(default, deserialize_with = "non_null")]
        reconciliation_version: Option<reconciliation::Version>,
        #[serde(default, deserialize_with = "non_null")]
        system_config: Option<CloudHostedSystemConfig>,
        #[serde(default, deserialize_with = "non_null")]
        preset_config: Option<CloudHostedPresetConfig>,
        #[serde(default, deserialize_with = "non_null")]
        replace_request_id: Option<String>,
    },
    CreateJson {
        product: Product,
        request_id: String,
        actor: Actor,
        body: Value,
        #[serde(default, deserialize_with = "non_null")]
        reconciliation_version: Option<reconciliation::Version>,
        #[serde(default, deserialize_with = "non_null")]
        system_config: Option<CloudHostedSystemConfig>,
        #[serde(default, deserialize_with = "non_null")]
        preset_config: Option<CloudHostedPresetConfig>,
        #[serde(default, deserialize_with = "non_null")]
        replace_request_id: Option<String>,
    },
    Reconcile {
        product: Product,
        request_id: String,
        actor: Actor,
        generation_id: String,
        combatants: Vec<Value>,
    },
    LookupRequest {
        product: Product,
        request_id: String,
        actor: Actor,
        #[serde(default, deserialize_with = "true_only")]
        restore_session: bool,
    },
    Status {
        product: Product,
        request_id: String,
        actor: Actor,
        generation_id: String,
    },
    Resume {
        product: Product,
        request_id: String,
        actor: Actor,
        generation_id: String,
        #[serde(default, deserialize_with = "non_null")]
        after: Option<String>,
    },
    Stop {
        product: Product,
        request_id: String,
        actor: Actor,
        #[serde(default, deserialize_with = "non_null")]
        generation_id: Option<String>,
        reason: String,
    },
}
fn true_only<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    if Value::deserialize(d)? != Value::Bool(true) {
        return Err(serde::de::Error::custom("only explicit true is supported"));
    }
    Ok(true)
}
fn non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = Value::deserialize(d)?;
    if value.is_null() {
        return Err(serde::de::Error::custom("explicit null is not supported"));
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(serde::de::Error::custom)
}
impl ArenaRequest {
    fn scope(&self) -> (Product, &str, &Actor) {
        match self {
            Self::CreateStream {
                product,
                request_id,
                actor,
                ..
            }
            | Self::CreateJson {
                product,
                request_id,
                actor,
                ..
            }
            | Self::Reconcile {
                product,
                request_id,
                actor,
                ..
            }
            | Self::LookupRequest {
                product,
                request_id,
                actor,
                ..
            }
            | Self::Status {
                product,
                request_id,
                actor,
                ..
            }
            | Self::Resume {
                product,
                request_id,
                actor,
                ..
            }
            | Self::Stop {
                product,
                request_id,
                actor,
                ..
            } => (*product, request_id, actor),
        }
    }
    fn generation_id(&self) -> Option<&str> {
        match self {
            Self::Status { generation_id, .. }
            | Self::Resume { generation_id, .. }
            | Self::Reconcile { generation_id, .. } => Some(generation_id),
            Self::Stop { generation_id, .. } => generation_id.as_deref(),
            _ => None,
        }
    }
    fn validate(&self) -> Result<(), ArenaError> {
        let (_, id, actor) = self.scope();
        if !request_id_valid(id) {
            return Err(invalid());
        }
        if let Actor::Account { expected_user_id } = actor {
            if *expected_user_id == 0 || *expected_user_id > 9_007_199_254_740_991 {
                return Err(invalid());
            }
        }
        if self
            .generation_id()
            .is_some_and(|id| !generation_id_valid(id))
        {
            return Err(invalid());
        }
        if let Self::Resume {
            after: Some(after), ..
        } = self
        {
            if !cursor_valid(after) {
                return Err(invalid());
            }
        }
        if let Self::Stop { reason, .. } = self {
            if reason != "user" && reason != "content_policy" {
                return Err(invalid());
            }
        }
        if let Self::Reconcile {
            generation_id,
            combatants,
            ..
        } = self
        {
            reconciliation::validate_input(generation_id, combatants)?;
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ChannelEvent {
    Response {
        request_id: String,
        sequence: u64,
        status: u16,
        #[serde(skip_serializing_if = "Option::is_none")]
        generation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        generation_request_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload_hash: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        header_meta: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        body: Option<Value>,
        metadata_state: &'static str,
        recovery_credential_state: &'static str,
    },
    JsonResponse {
        request_id: String,
        sequence: u64,
        status: u16,
        #[serde(skip_serializing_if = "Option::is_none")]
        generation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        generation_request_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload_hash: Option<String>,
        recovery_credential_state: &'static str,
    },
    JsonFragment {
        request_id: String,
        sequence: u64,
        text: String,
        r#final: bool,
    },
    JsonEnd {
        request_id: String,
        sequence: u64,
    },
    SseFragment {
        request_id: String,
        sequence: u64,
        text: String,
        r#final: bool,
    },
    StreamEnd {
        request_id: String,
        sequence: u64,
    },
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResponse {
    pub status: u16,
    pub body: Value,
    pub recovery_credential_state: &'static str,
}
pub trait EventSink: Send + Sync {
    fn send(&self, event: ChannelEvent) -> Result<(), ArenaError>;
}
impl EventSink for tauri::ipc::Channel<ChannelEvent> {
    fn send(&self, event: ChannelEvent) -> Result<(), ArenaError> {
        self.send(event)
            .map_err(|_| error("detached", "本机订阅已关闭，服务器生成状态未改变"))
    }
}

// No Debug: these values contain replay credentials and never enter diagnostics or IPC.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnonymousRecord {
    version: u8,
    product: Product,
    request_id: String,
    bootstrap: String,
    first_dispatched_at: u64,
    token: Option<String>,
    token_expires_at: Option<u64>,
}
struct Flight {
    request_id: String,
    actor: Actor,
    account_fingerprint: String,
    cookie: Option<String>,
    anonymous: Option<AnonymousRecord>,
    memory_only: bool,
    capability_verified: bool,
    json_capability_verified: bool,
    dispatched: bool,
    terminal: bool,
    generation_id: Option<String>,
    budget: Budget,
    subscription: Option<Arc<CancellationToken>>,
    secrets_to_redact: Vec<String>,
}
impl Flight {
    fn credential_state(&self) -> &'static str {
        if self.memory_only {
            "memory-only"
        } else {
            "stored"
        }
    }
}
// Only identity and a one-way digest are retained as the error ownership witness.
// Neither the witness nor a secret value is serialized or sent to the renderer.
struct OwnershipWitness {
    flight: Option<Arc<Mutex<Flight>>>,
    anonymous_slot_digest: Option<[u8; 32]>,
}
fn secret_digest(value: Option<&str>) -> Option<[u8; 32]> {
    value.map(|v| Sha256::digest(v.as_bytes()).into())
}
impl OwnershipWitness {
    fn capture(state: &ArenaState, product: Product, secrets: &dyn SecretStore) -> Option<Self> {
        let flights = state.flights.lock().ok()?;
        let raw = secrets.resolve(product.slot()).ok()?;
        Some(Self {
            flight: flights.get(&product).cloned(),
            anonymous_slot_digest: secret_digest(raw.as_deref()),
        })
    }
    fn classify(
        prior: Option<&Self>,
        state: &ArenaState,
        product: Product,
        request_id: &str,
        actor: &Actor,
        secrets: &dyn SecretStore,
    ) -> &'static str {
        let Ok(flights) = state.flights.lock() else {
            return "unknown";
        };
        let current = flights.get(&product);
        if let Some(flight) = current {
            let Ok(flight) = flight.lock() else {
                return "unknown";
            };
            if flight.request_id == request_id && flight.actor == *actor {
                return "current-owned";
            }
        }
        let Ok(raw) = secrets.resolve(product.slot()) else {
            return "unknown";
        };
        // A write that returned an error may nevertheless have changed the store.
        // Only a coherent, otherwise unoccupied persisted actor can prove ownership.
        if current.is_none()
            && *actor == Actor::Anonymous
            && raw
                .as_deref()
                .and_then(|s| serde_json::from_str::<AnonymousRecord>(s).ok())
                .is_some_and(|r| {
                    r.version == 1 && r.product == product && r.request_id == request_id
                })
        {
            return "current-owned";
        }
        let Some(prior) = prior else { return "unknown" };
        let same_flight = match (prior.flight.as_ref(), current) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        };
        if same_flight && secret_digest(raw.as_deref()) == prior.anonymous_slot_digest {
            "prior-retained"
        } else {
            "unknown"
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryHintRequest {
    pub product: Product,
}
#[derive(Debug, Serialize)]
#[serde(
    tag = "state",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum RecoveryHint {
    None {
        product: Product,
    },
    Unavailable {
        product: Product,
    },
    Available {
        product: Product,
        request_id: String,
        actor_kind: &'static str,
    },
    Expired {
        product: Product,
        request_id: String,
        actor_kind: &'static str,
    },
}

pub struct ArenaState {
    http: reqwest::Client,
    origin: String,
    reconciliation_origin: String,
    flights: Mutex<HashMap<Product, Arc<Mutex<Flight>>>>,
}
impl ArenaState {
    pub fn new() -> Result<Self, ArenaError> {
        let http = reqwest::Client::builder()
            // Fixed credential-bearing origins must not inherit a third-party environment proxy.
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(SHORT_TIMEOUT)
            .build()
            .map_err(|_| network())?;
        Ok(Self {
            http,
            origin: ORIGIN.to_string(),
            reconciliation_origin: reconciliation::ORIGIN.to_string(),
            flights: Mutex::new(HashMap::new()),
        })
    }
    #[cfg(test)]
    fn with_origin(origin: String) -> Self {
        assert!(origin.starts_with("http://127.0.0.1:"));
        Self {
            origin,
            ..Self::new().unwrap()
        }
    }
    fn is_current(
        &self,
        product: Product,
        flight: &Arc<Mutex<Flight>>,
        cloud: &CloudState,
        secrets: &dyn SecretStore,
    ) -> Result<(), ArenaError> {
        let current = self
            .flights
            .lock()
            .map_err(|_| stale())?
            .get(&product)
            .cloned()
            .ok_or_else(stale)?;
        if !Arc::ptr_eq(&current, flight) {
            return Err(stale());
        }
        let fingerprint = cloud::arena_account_snapshot(cloud, secrets)
            .map_err(|_| stale())?
            .fingerprint;
        if flight.lock().map_err(|_| stale())?.account_fingerprint != fingerprint {
            return Err(stale());
        }
        Ok(())
    }
    fn prepare(
        &self,
        request: &ArenaRequest,
        cloud: &CloudState,
        secrets: &dyn SecretStore,
    ) -> Result<Arc<Mutex<Flight>>, ArenaError> {
        request.validate()?;
        let (product, request_id, actor) = request.scope();
        let snapshot = cloud::arena_account_snapshot(cloud, secrets).map_err(|_| stale())?;
        let create = matches!(
            request,
            ArenaRequest::CreateStream { .. } | ArenaRequest::CreateJson { .. }
        );
        if let Actor::Account { expected_user_id } = actor {
            if snapshot.user_id != Some(*expected_user_id) {
                return Err(stale());
            }
        } else if create && snapshot.user_id.is_some() {
            return Err(stale());
        }
        let mut flights = self.flights.lock().map_err(|_| stale())?;
        if let Some(prior) = flights.get(&product) {
            let old = prior.lock().map_err(|_| stale())?;
            if old.request_id == request_id {
                if old.actor != *actor {
                    return Err(stale());
                }
                if create {
                    return Err(error(
                        "create-already-attempted",
                        "原请求已准备或派发，只能查找或恢复，不能再次创建",
                    ));
                }
                if matches!(
                    request,
                    ArenaRequest::LookupRequest {
                        restore_session: true,
                        ..
                    }
                ) {
                    if let Some(record) = &old.anonymous {
                        validate_anonymous_lifetime(record)?;
                    }
                    if let Some(cancel) = &old.subscription {
                        cancel.cancel();
                    }
                    let cookie = if matches!(actor, Actor::Account { .. }) {
                        snapshot.cookie
                    } else {
                        None
                    };
                    let mut secrets_to_redact = old.secrets_to_redact.clone();
                    if let Some(old_cookie) = &old.cookie {
                        secrets_to_redact.retain(|s| s != old_cookie);
                    }
                    if let Some(cookie) = &cookie {
                        secrets_to_redact.push(cookie.clone());
                    }
                    let next = Arc::new(Mutex::new(Flight {
                        request_id: old.request_id.clone(),
                        actor: old.actor.clone(),
                        account_fingerprint: snapshot.fingerprint,
                        cookie,
                        anonymous: old.anonymous.clone(),
                        memory_only: old.memory_only,
                        capability_verified: false,
                        json_capability_verified: false,
                        dispatched: old.dispatched,
                        terminal: old.terminal,
                        generation_id: old.generation_id.clone(),
                        budget: Budget::default(),
                        subscription: None,
                        secrets_to_redact,
                    }));
                    drop(old);
                    flights.insert(product, next.clone());
                    return Ok(next);
                }
                if old.account_fingerprint != snapshot.fingerprint {
                    return Err(stale());
                }
                return Ok(prior.clone());
            }
            let replace_id = match request {
                ArenaRequest::CreateStream {
                    replace_request_id, ..
                }
                | ArenaRequest::CreateJson {
                    replace_request_id, ..
                } => replace_request_id.as_deref(),
                _ => None,
            };
            if !create || (!old.terminal && replace_id != Some(old.request_id.as_str())) {
                return Err(error(
                    "recovery-conflict",
                    "此页面还有可恢复请求，请先明确放弃其恢复",
                ));
            }
            if let Some(cancel) = &old.subscription {
                cancel.cancel();
            }
        }
        // A newly logged-in create must not silently discard an older anonymous pointer.
        if create && matches!(actor, Actor::Account { .. }) {
            if let Some(old) = load_anonymous(product, secrets)? {
                let replacement = match request {
                    ArenaRequest::CreateStream {
                        replace_request_id, ..
                    }
                    | ArenaRequest::CreateJson {
                        replace_request_id, ..
                    } => replace_request_id.as_deref(),
                    _ => None,
                };
                let terminal = flights.get(&product).is_some_and(|flight| {
                    flight
                        .lock()
                        .is_ok_and(|f| f.terminal && f.request_id == old.request_id)
                });
                if !terminal && replacement != Some(old.request_id.as_str()) {
                    return Err(error(
                        "recovery-conflict",
                        "此页面的原匿名恢复身份尚未明确放弃",
                    ));
                }
                secrets.delete(product.slot()).map_err(|_| storage())?;
            }
        }
        let anonymous = if *actor == Actor::Anonymous {
            let stored = load_anonymous(product, secrets)?;
            if create {
                if let Some(old) = &stored {
                    if old.request_id == request_id {
                        return Err(error(
                            "create-already-attempted",
                            "此匿名请求已有恢复身份，请查找原请求",
                        ));
                    }
                    let replace_id = match request {
                        ArenaRequest::CreateStream {
                            replace_request_id, ..
                        }
                        | ArenaRequest::CreateJson {
                            replace_request_id, ..
                        } => replace_request_id.as_deref(),
                        _ => None,
                    };
                    // A terminal in-memory flight is authoritative only for its own stored slot.
                    let terminal = flights.get(&product).is_some_and(|f| {
                        f.lock()
                            .is_ok_and(|f| f.terminal && f.request_id == old.request_id)
                    });
                    if !terminal && replace_id != Some(old.request_id.as_str()) {
                        return Err(error("recovery-conflict", "原匿名恢复凭据尚未放弃"));
                    }
                }
                let record = AnonymousRecord {
                    version: 1,
                    product,
                    request_id: request_id.to_string(),
                    bootstrap: bootstrap_uuid()?,
                    first_dispatched_at: now_ms(),
                    token: None,
                    token_expires_at: None,
                };
                save_anonymous(&record, secrets)?;
                Some(record)
            } else {
                let record = stored
                    .filter(|r| r.request_id == request_id)
                    .ok_or_else(|| error("recovery-unavailable", "原匿名恢复凭据已丢失或不匹配"))?;
                validate_anonymous_lifetime(&record)?;
                Some(record)
            }
        } else {
            None
        };
        let cookie = if matches!(actor, Actor::Account { .. }) {
            snapshot.cookie
        } else {
            None
        };
        let secrets_to_redact = cookie
            .iter()
            .cloned()
            .chain(anonymous.iter().flat_map(|r| {
                [Some(r.bootstrap.clone()), r.token.clone()]
                    .into_iter()
                    .flatten()
            }))
            .collect();
        let flight = Arc::new(Mutex::new(Flight {
            request_id: request_id.to_string(),
            actor: actor.clone(),
            account_fingerprint: snapshot.fingerprint,
            cookie,
            anonymous,
            memory_only: false,
            capability_verified: false,
            json_capability_verified: false,
            dispatched: !create,
            terminal: false,
            generation_id: None,
            budget: Budget::default(),
            subscription: None,
            secrets_to_redact,
        }));
        flights.insert(product, flight.clone());
        Ok(flight)
    }
    async fn capability(
        &self,
        product: Product,
        flight: &Arc<Mutex<Flight>>,
        cloud: &CloudState,
        secrets: &dyn SecretStore,
        require_json: bool,
        require_json_reconciliation: bool,
    ) -> Result<(), ArenaError> {
        self.is_current(product, flight, cloud, secrets)?;
        {
            let f = flight.lock().map_err(|_| stale())?;
            if f.capability_verified
                && (!require_json || f.json_capability_verified)
                && !require_json_reconciliation
            {
                return Ok(());
            }
        }
        // Deliberately a fresh public GET: no Cookie, actor token, Provider Key or renderer headers.
        let response = self
            .http
            .get(format!("{}{CAPABILITY_PATH}", self.origin))
            .timeout(SHORT_TIMEOUT)
            .send()
            .await
            .map_err(|_| error("capability-unavailable", "Arena 服务能力未确认，未派发创建"))?;
        self.is_current(product, flight, cloud, secrets)?;
        if response.status().as_u16() != 200 {
            return Err(error(
                "capability-unavailable",
                "Arena 服务尚未支持本客户端的身份协议",
            ));
        }
        let json_capable = response
            .headers()
            .get(json_delivery::PROTOCOL_HEADER)
            .and_then(|v| v.to_str().ok())
            == Some(json_delivery::PROTOCOL_VERSION);
        if require_json && !json_capable {
            return Err(error(
                "capability-unavailable",
                "Arena 服务尚未支持完整非流报告协议",
            ));
        }
        // This is the installed companion service's own opt-in, separate from the
        // fixed Next service's capability. Old C2 servers must never receive true writes.
        if require_json_reconciliation
            && response
                .headers()
                .get(reconciliation::PROTOCOL_HEADER)
                .and_then(|v| v.to_str().ok())
                != Some(reconciliation::PROTOCOL_VERSION)
        {
            return Err(error(
                "capability-unavailable",
                "Arena 完整报告服务尚未支持冻结角色写入选择",
            ));
        }
        let value = read_json(response, HEADER_BYTES).await?;
        let expected = json!({"contractVersion":"arena-hosted-sse-v1","expectedUserIdAssertion":"v1","stream":"sse-v1"});
        if value.get("ok") != Some(&Value::Bool(true))
            || value.get("placement").and_then(Value::as_str) != Some("hono-primary")
            || value.get("databaseProvider").and_then(Value::as_str) != Some("hono-d1-primary")
            || value.get("consistency").and_then(Value::as_str) != Some("replica-ok")
            || value.get("contractVersion").and_then(Value::as_str) != Some("g25e1-v1")
            || value.get("arenaHosted") != Some(&expected)
        {
            return Err(error(
                "capability-unavailable",
                "Arena 服务尚未支持本客户端的身份协议",
            ));
        }
        self.is_current(product, flight, cloud, secrets)?;
        let mut f = flight.lock().map_err(|_| stale())?;
        f.capability_verified = true;
        f.json_capability_verified = json_capable;
        Ok(())
    }
    fn authenticated(
        &self,
        method: reqwest::Method,
        path: &str,
        flight: &Arc<Mutex<Flight>>,
    ) -> Result<reqwest::RequestBuilder, ArenaError> {
        let f = flight.lock().map_err(|_| stale())?;
        let mut builder = self.http.request(method, format!("{}{path}", self.origin));
        match &f.actor {
            Actor::Account { expected_user_id } => {
                builder = builder
                    .header(
                        reqwest::header::COOKIE,
                        f.cookie.as_deref().ok_or_else(stale)?,
                    )
                    .header(EXPECTED_USER_HEADER, format!("v1:{expected_user_id}"));
            }
            Actor::Anonymous => {
                let record = f.anonymous.as_ref().ok_or_else(storage)?;
                validate_anonymous_lifetime(record)?;
                builder = builder.header(
                    ACTOR_HEADER,
                    record.token.as_deref().unwrap_or(&record.bootstrap),
                );
            }
        }
        Ok(builder)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn request_id_valid(id: &str) -> bool {
    (8..=128).contains(&id.len())
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn generation_id_valid(id: &str) -> bool {
    id.len() == 70
        && id.starts_with("arena_")
        && id[6..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn cursor_valid(id: &str) -> bool {
    id.len() <= 128
        && id.split_once('-').is_some_and(|(a, b)| {
            !a.is_empty()
                && !b.is_empty()
                && a.bytes().all(|b| b.is_ascii_digit())
                && b.bytes().all(|b| b.is_ascii_digit())
        })
}
fn cursor_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let decimal = |a: &str, b: &str| {
        let a = a.trim_start_matches('0');
        let b = b.trim_start_matches('0');
        a.len().cmp(&b.len()).then_with(|| a.cmp(b))
    };
    let (a1, a2) = a.split_once('-').unwrap();
    let (b1, b2) = b.split_once('-').unwrap();
    decimal(a1, b1).then_with(|| decimal(a2, b2))
}
fn bootstrap_uuid() -> Result<String, ArenaError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| storage())?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "bootstrap.{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}
fn save_anonymous(record: &AnonymousRecord, secrets: &dyn SecretStore) -> Result<(), ArenaError> {
    let value = serde_json::to_string(record).map_err(|_| storage())?;
    if value.len() > MAX_SECRET_VALUE_BYTES {
        return Err(storage());
    }
    secrets
        .set(record.product.slot(), &value)
        .map_err(|_| storage())
}
fn load_anonymous(
    product: Product,
    secrets: &dyn SecretStore,
) -> Result<Option<AnonymousRecord>, ArenaError> {
    let raw = secrets.resolve(product.slot()).map_err(|_| storage())?;
    raw.map(|raw| {
        if raw.len() > MAX_SECRET_VALUE_BYTES {
            return Err(storage());
        }
        let record: AnonymousRecord = serde_json::from_str(&raw).map_err(|_| storage())?;
        let uuid = record
            .bootstrap
            .strip_prefix("bootstrap.")
            .ok_or_else(storage)?;
        if record.version != 1
            || record.product != product
            || !request_id_valid(&record.request_id)
            || uuid.len() != 36
            || uuid.chars().enumerate().any(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    c != '-'
                } else {
                    !c.is_ascii_hexdigit()
                }
            })
            || uuid.as_bytes()[14] != b'4'
            || !b"89abAB".contains(&uuid.as_bytes()[19])
            || record.token.is_some() != record.token_expires_at.is_some()
        {
            return Err(storage());
        }
        Ok(record)
    })
    .transpose()
}
fn validate_anonymous_lifetime(record: &AnonymousRecord) -> Result<(), ArenaError> {
    let now = now_ms();
    let expires = record.token_expires_at.unwrap_or_else(|| {
        record
            .first_dispatched_at
            .saturating_add(BOOTSTRAP_LIFETIME_MS)
    });
    if record.first_dispatched_at > now
        || expires <= now
        || now - record.first_dispatched_at > TOKEN_LIFETIME_MS
    {
        return Err(error(
            "recovery-expired",
            "原匿名恢复身份已过期，不能为原请求更换身份",
        ));
    }
    Ok(())
}
fn capture_token(
    headers: &reqwest::header::HeaderMap,
    flight: &Arc<Mutex<Flight>>,
    secrets: &dyn SecretStore,
) -> Result<(), ArenaError> {
    let Some(raw) = headers.get(ACTOR_HEADER) else {
        return Ok(());
    };
    let token = raw.to_str().map_err(|_| protocol())?;
    if token.is_empty()
        || token.len() > 6 * 1024
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(protocol());
    }
    let decoded = URL_SAFE_NO_PAD.decode(token).map_err(|_| protocol())?;
    let value: Value = serde_json::from_slice(&decoded).map_err(|_| protocol())?;
    let mut f = flight.lock().map_err(|_| stale())?;
    let Some(record) = f.anonymous.as_mut() else {
        return Err(protocol());
    };
    let expires = value
        .get("expiresAt")
        .and_then(Value::as_str)
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .and_then(|t| u64::try_from(t.unix_timestamp_nanos() / 1_000_000).ok())
        .ok_or_else(protocol)?;
    if value.get("v") != Some(&json!(1))
        || value.get("anonymousId").and_then(Value::as_str)
            != record.bootstrap.strip_prefix("bootstrap.")
        || value
            .get("signature")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        || expires <= now_ms()
        || expires > now_ms().saturating_add(TOKEN_LIFETIME_MS + 60_000)
    {
        return Err(protocol());
    }
    // Never fall back to bootstrap after accepting a signed token, including persistence failure.
    let prior_token = record.token.clone();
    record.token = Some(token.to_string());
    record.token_expires_at =
        Some(expires.min(record.first_dispatched_at.saturating_add(TOKEN_LIFETIME_MS)));
    let saved = save_anonymous(record, secrets).is_ok();
    if let Some(prior) = prior_token {
        f.secrets_to_redact.retain(|s| s != &prior);
    }
    if !f.secrets_to_redact.iter().any(|s| s == token) {
        f.secrets_to_redact.push(token.to_string());
    }
    f.memory_only = !saved;
    Ok(())
}
fn validate_body(body: &Value) -> Result<(), ArenaError> {
    validate_body_with_reconciliation(body, false)
}
fn validate_body_with_reconciliation(body: &Value, reconciliation: bool) -> Result<(), ArenaError> {
    let map = body.as_object().ok_or_else(invalid)?;
    const KEYS: &[&str] = &[
        "reportFormat",
        "combatants",
        "mode",
        "webPackageRef",
        "webPackagePromptProjection",
        "arenaFreeRankingEnabled",
        "userGuidance",
        "scenario",
        "auxScenarios",
        "materials",
        "scenarioTitle",
        "scenarioFileName",
        "scenarioSourceDataCardId",
        "scenarioSourceDataCardUpdatedAt",
        "teams",
        "teamNames",
        "language",
        "readArenaHistory",
        "arenaHistoryReadLimit",
        "writeArenaHistory",
        "readCurrentState",
        "writeCurrentState",
        "readNarrativeHistory",
        "writeNarrativeHistory",
        "narrativeHistoryReadLimit",
        "narrativeHistory",
        "isDowngrade",
        "adjudicationEvents",
        "storyLength",
        "customStoryLength",
        "questionnaireSelections",
        "questionnaires",
    ];
    if map.keys().any(|k| !KEYS.contains(&k.as_str())) || serialized_size(body)? > INPUT_BYTES {
        return Err(invalid());
    }
    let mode = map
        .get("mode")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let minimum = match mode {
        "classic" | "kizuna" => 2,
        "daily" | "scenario" => 1,
        _ => return Err(invalid()),
    };
    let combatants = map
        .get("combatants")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if combatants.len() < minimum
        || combatants.len() > 32
        || combatants.iter().any(|v| !v.is_object())
    {
        return Err(invalid());
    }
    if mode == "scenario" && !map.get("scenario").is_some_and(Value::is_object) {
        return Err(invalid());
    }
    let format = map
        .get("reportFormat")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if !matches!(format, "markdown" | "web")
        || (format != "web"
            && (map.contains_key("webPackageRef")
                || map.contains_key("webPackagePromptProjection")))
    {
        return Err(invalid());
    }
    for key in ["writeArenaHistory", "writeCurrentState"] {
        if !map.get(key).is_some_and(Value::is_boolean)
            || (!reconciliation && map.get(key) != Some(&Value::Bool(false)))
        {
            return Err(invalid());
        }
    }
    for key in ["isDowngrade", "arenaFreeRankingEnabled"] {
        if map.get(key).is_some_and(|v| v != &Value::Bool(false)) {
            return Err(invalid());
        }
    }
    for key in [
        "readArenaHistory",
        "readCurrentState",
        "readNarrativeHistory",
        "writeNarrativeHistory",
    ] {
        if map.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(invalid());
        }
    }
    for key in [
        "userGuidance",
        "scenarioSourceDataCardId",
        "scenarioSourceDataCardUpdatedAt",
        "language",
        "storyLength",
        "customStoryLength",
    ] {
        if map.get(key).is_some_and(|v| !v.is_string()) {
            return Err(invalid());
        }
    }
    for key in ["scenarioTitle", "scenarioFileName"] {
        if map.get(key).is_some_and(|v| !v.is_string() && !v.is_null()) {
            return Err(invalid());
        }
    }
    for key in [
        "scenario",
        "teams",
        "teamNames",
        "webPackageRef",
        "webPackagePromptProjection",
    ] {
        if map.get(key).is_some_and(|v| !v.is_object()) {
            return Err(invalid());
        }
    }
    for key in ["arenaHistoryReadLimit", "narrativeHistoryReadLimit"] {
        if map.get(key).is_some_and(|v| {
            !v.is_null()
                && v.as_u64()
                    .is_none_or(|n| n == 0 || n > 9_007_199_254_740_991)
        }) {
            return Err(invalid());
        }
    }
    let mut references = 0;
    for key in [
        "auxScenarios",
        "materials",
        "questionnaires",
        "narrativeHistory",
        "questionnaireSelections",
        "adjudicationEvents",
    ] {
        if let Some(v) = map.get(key) {
            let a = v.as_array().ok_or_else(invalid)?;
            if key == "adjudicationEvents" && a.len() > 100 {
                return Err(invalid());
            }
            if matches!(
                key,
                "auxScenarios" | "materials" | "questionnaires" | "narrativeHistory"
            ) {
                references += a.len();
            }
        }
    }
    if references > 256 {
        return Err(invalid());
    }
    if let Some(value) = map.get("webPackageRef") {
        validate_package_ref(value).map_err(|_| invalid())?;
    }
    if let Some(value) = map.get("webPackagePromptProjection") {
        validate_prompt_projection(value)?;
    }
    Ok(())
}
fn validate_prompt_projection(value: &Value) -> Result<(), ArenaError> {
    let map = value.as_object().ok_or_else(invalid)?;
    if map.keys().any(|k| {
        ![
            "package",
            "entry",
            "target",
            "instructions",
            "schema",
            "assetCatalog",
            "example",
        ]
        .contains(&k.as_str())
    }) {
        return Err(invalid());
    }
    let package = map
        .get("package")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    let reference = json!({"id":package.get("id"),"version":package.get("version"),"digest":package.get("digest")});
    validate_package_ref(&reference).map_err(|_| invalid())?;
    if package
        .get("name")
        .and_then(Value::as_str)
        .is_none_or(|s| s.is_empty() || s.encode_utf16().count() > 256)
    {
        return Err(invalid());
    }
    if !map
        .get("entry")
        .and_then(Value::as_str)
        .is_some_and(crate::package_path::is_valid_package_path)
    {
        return Err(invalid());
    }
    let target = map
        .get("target")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    if target.get("mode") != Some(&json!("replace")) {
        return Err(invalid());
    }
    validate_artifact(&json!({"packageRef":reference,"targetPath":target.get("path"),"targetMediaType":target.get("mediaType"),"generatedDigest":package.get("digest")})).map_err(|_|invalid())?;
    for (key, max) in [
        ("instructions", 131_072),
        ("schema", 262_144),
        ("assetCatalog", 131_072),
        ("example", 131_072),
    ] {
        if let Some(value) = map.get(key) {
            if matches!(key, "instructions" | "example") && !value.is_string()
                || serialized_size(value)? > max
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
fn serialized_size(value: &impl Serialize) -> Result<usize, ArenaError> {
    serde_json::to_vec(value)
        .map(|v| v.len())
        .map_err(|_| protocol())
}
async fn read_json(response: reqwest::Response, max: usize) -> Result<Value, ArenaError> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| network())?;
        if bytes.len() + chunk.len() > max {
            return Err(protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| protocol())?;
    if !value.is_object() {
        return Err(protocol());
    }
    Ok(value)
}
fn reject_secret_echo(value: &str, flight: &Arc<Mutex<Flight>>) -> Result<(), ArenaError> {
    if flight
        .lock()
        .map_err(|_| stale())?
        .secrets_to_redact
        .iter()
        .any(|s| {
            !s.is_empty()
                && (value.contains(s)
                    || serde_json::to_string(s)
                        .is_ok_and(|escaped| value.contains(&escaped[1..escaped.len() - 1])))
        })
    {
        return Err(protocol());
    }
    Ok(())
}
fn public_control(value: Value, flight: &Arc<Mutex<Flight>>) -> Result<Value, ArenaError> {
    let map = value.as_object().ok_or_else(protocol)?;
    let mut out = serde_json::Map::new();
    for key in [
        "generationId",
        "generationRequestId",
        "status",
        "lastEventId",
        "updatedAt",
        "resultRef",
        "resumable",
        "finalAuthoritative",
        "resultAvailable",
        "persistenceWarning",
        "replayUnavailable",
        "contentRetention",
        "cancelled",
        "code",
    ] {
        if let Some(v) = map.get(key) {
            let valid = match key {
                "generationId" => v.as_str().is_some_and(generation_id_valid),
                "generationRequestId" => v.as_str().is_some_and(request_id_valid),
                "code" => v.as_str().is_some_and(public_code_valid),
                "updatedAt" => v.as_str().is_some_and(timestamp_valid),
                "resultRef" => {
                    v.is_null() || v.as_str().is_some_and(|s| s.encode_utf16().count() <= 2048)
                }
                "persistenceWarning" => v.as_str().is_some_and(|s| {
                    matches!(s, "OUTPUT_NOT_ARCHIVED" | "PERSISTENCE_UNAVAILABLE")
                }),
                "contentRetention" => v == &json!("expired"),
                "status" => v
                    .as_str()
                    .is_some_and(|v| status_valid(v) || v == "cancelling"),
                "lastEventId" => v.is_null() || v.as_str().is_some_and(cursor_valid),
                "resumable" | "finalAuthoritative" | "resultAvailable" | "replayUnavailable"
                | "cancelled" => v.is_boolean(),
                "retryAfterSeconds" => v.as_u64().is_some_and(|n| n <= 86400),
                _ => v
                    .as_str()
                    .is_some_and(|s| s.len() <= 512 && !s.chars().any(char::is_control)),
            };
            if !valid {
                return Err(protocol());
            }
            out.insert(key.to_string(), v.clone());
        }
    }
    if map.contains_key("error") || map.contains_key("message") {
        out.insert(
            "error".to_string(),
            json!("Arena 服务未完成此请求，请按状态检查或恢复"),
        );
    }
    if !out.contains_key("status") && !out.contains_key("code") && !out.contains_key("error") {
        return Err(protocol());
    }
    let value = Value::Object(out);
    reject_secret_echo(&value.to_string(), flight)?;
    Ok(value)
}
fn public_code_valid(s: &str) -> bool {
    (2..=128).contains(&s.len())
        && s.as_bytes()[0].is_ascii_uppercase()
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}
fn timestamp_valid(s: &str) -> bool {
    s.len() <= 128
        && time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).is_ok()
}
fn status_valid(s: &str) -> bool {
    matches!(
        s,
        "reserved"
            | "running"
            | "finalizing"
            | "completed"
            | "failed"
            | "cancelled"
            | "producer_lost"
    )
}
fn terminal_status(s: &str) -> bool {
    matches!(s, "completed" | "failed" | "cancelled" | "producer_lost")
}
fn accept_control_identity(value: &Value, flight: &Arc<Mutex<Flight>>) -> Result<(), ArenaError> {
    let mut f = flight.lock().map_err(|_| stale())?;
    if value
        .get("generationRequestId")
        .and_then(Value::as_str)
        .is_some_and(|id| id != f.request_id)
    {
        return Err(protocol());
    }
    if let Some(id) = value.get("generationId").and_then(Value::as_str) {
        if f.generation_id.as_deref().is_some_and(|old| old != id) {
            return Err(protocol());
        }
        f.generation_id = Some(id.to_string());
    }
    if value
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(terminal_status)
    {
        f.terminal = true;
    }
    Ok(())
}
impl ArenaState {
    fn capture_response_token(
        &self,
        product: Product,
        flight: &Arc<Mutex<Flight>>,
        cloud: &CloudState,
        secrets: &dyn SecretStore,
        headers: &reqwest::header::HeaderMap,
    ) -> Result<(), ArenaError> {
        // Serialize against replacement: a late response cannot overwrite a newer product slot.
        let flights = self.flights.lock().map_err(|_| stale())?;
        if flights
            .get(&product)
            .is_none_or(|current| !Arc::ptr_eq(current, flight))
        {
            return Err(stale());
        }
        let current = cloud::arena_account_snapshot(cloud, secrets).map_err(|_| stale())?;
        if flight.lock().map_err(|_| stale())?.account_fingerprint != current.fingerprint {
            return Err(stale());
        }
        capture_token(headers, flight, secrets)
    }
    async fn lookup_bound(
        &self,
        product: Product,
        flight: &Arc<Mutex<Flight>>,
        cloud: &CloudState,
        secrets: &dyn SecretStore,
    ) -> Result<ControlResponse, ArenaError> {
        self.is_current(product, flight, cloud, secrets)?;
        let id = flight.lock().map_err(|_| stale())?.request_id.clone();
        let response = self
            .authenticated(
                reqwest::Method::GET,
                &format!("/api/arena/generation-requests/{id}"),
                flight,
            )?
            .timeout(SHORT_TIMEOUT)
            .send()
            .await
            .map_err(|_| network())?;
        self.is_current(product, flight, cloud, secrets)?;
        self.capture_response_token(product, flight, cloud, secrets, response.headers())?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            return Err(protocol());
        }
        let body = public_control(read_json(response, HEADER_BYTES).await?, flight)?;
        self.is_current(product, flight, cloud, secrets)?;
        if status == 200
            && (body.get("generationId").and_then(Value::as_str).is_none()
                || body.get("generationRequestId").and_then(Value::as_str) != Some(id.as_str()))
        {
            return Err(protocol());
        }
        accept_control_identity(&body, flight)?;
        Ok(ControlResponse {
            status,
            body,
            recovery_credential_state: flight.lock().map_err(|_| stale())?.credential_state(),
        })
    }
    async fn bind_generation(
        &self,
        product: Product,
        id: &str,
        flight: &Arc<Mutex<Flight>>,
        cloud: &CloudState,
        secrets: &dyn SecretStore,
    ) -> Result<(), ArenaError> {
        if flight.lock().map_err(|_| stale())?.generation_id.is_none() {
            let result = self.lookup_bound(product, flight, cloud, secrets).await?;
            if result.status != 200 {
                return Err(error(
                    "generation-unavailable",
                    "原请求尚未找到可恢复生成，请按原 requestId 查找",
                ));
            }
        }
        if flight.lock().map_err(|_| stale())?.generation_id.as_deref() != Some(id) {
            return Err(invalid());
        }
        Ok(())
    }
}
pub async fn control(
    state: &ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: ArenaRequest,
) -> Result<ControlResponse, ArenaError> {
    if matches!(
        request,
        ArenaRequest::CreateStream { .. }
            | ArenaRequest::CreateJson { .. }
            | ArenaRequest::Resume { .. }
            | ArenaRequest::Reconcile { .. }
    ) {
        return Err(invalid());
    }
    let (product, _, _) = request.scope();
    let flight = state.prepare(&request, cloud, secrets)?;
    state
        .capability(product, &flight, cloud, secrets, false, false)
        .await?;
    if let Some(id) = request.generation_id() {
        state
            .bind_generation(product, id, &flight, cloud, secrets)
            .await?;
    }
    if matches!(request, ArenaRequest::LookupRequest { .. }) {
        return state.lookup_bound(product, &flight, cloud, secrets).await;
    }
    let is_status = matches!(request, ArenaRequest::Status { .. });
    let (method, path, body) = match request {
        ArenaRequest::Status { generation_id, .. } => (
            reqwest::Method::GET,
            format!("/api/arena/generations/{generation_id}"),
            None,
        ),
        ArenaRequest::Stop {
            generation_id: Some(id),
            reason,
            ..
        } => (
            reqwest::Method::POST,
            format!("/api/arena/generations/{id}/cancel"),
            Some(json!({"reason":reason})),
        ),
        ArenaRequest::Stop {
            generation_id: None,
            reason,
            request_id,
            ..
        } => (
            reqwest::Method::DELETE,
            CREATE_PATH.to_string(),
            Some(json!({"generationRequestId":request_id,"reason":reason})),
        ),
        _ => return Err(invalid()),
    };
    state.is_current(product, &flight, cloud, secrets)?;
    let mut builder = state
        .authenticated(method, &path, &flight)?
        .timeout(SHORT_TIMEOUT);
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder.send().await.map_err(|_| network())?;
    state.is_current(product, &flight, cloud, secrets)?;
    state.capture_response_token(product, &flight, cloud, secrets, response.headers())?;
    let status = response.status().as_u16();
    if (300..400).contains(&status) {
        return Err(protocol());
    }
    let body = public_control(read_json(response, HEADER_BYTES).await?, &flight)?;
    state.is_current(product, &flight, cloud, secrets)?;
    if status == 200
        && is_status
        && (body.get("generationId").is_none()
            || body.get("generationRequestId").and_then(Value::as_str)
                != Some(flight.lock().map_err(|_| stale())?.request_id.as_str()))
    {
        return Err(protocol());
    }
    if matches!(status, 200 | 202 | 409) && body.get("generationId").is_none() {
        return Err(protocol());
    }
    accept_control_identity(&body, &flight)?;
    let recovery_credential_state = flight.lock().map_err(|_| stale())?.credential_state();
    Ok(ControlResponse {
        status,
        body,
        recovery_credential_state,
    })
}
pub fn detach(state: &ArenaState, request: DetachRequest) -> Result<bool, ArenaError> {
    if !request_id_valid(&request.request_id) {
        return Err(invalid());
    }
    let flights = state.flights.lock().map_err(|_| stale())?;
    let Some(flight) = flights.get(&request.product) else {
        return Ok(false);
    };
    let mut f = flight.lock().map_err(|_| stale())?;
    if f.request_id != request.request_id {
        return Ok(false);
    }
    if let Some(cancel) = f.subscription.take() {
        cancel.cancel();
        return Ok(true);
    }
    Ok(false)
}

#[derive(Default, Clone)]
struct Budget {
    cursor: Option<String>,
    markdown_bytes: usize,
    reasoning_bytes: usize,
    observed: bool,
}
struct ParsedEvent {
    id: String,
    name: String,
    data: Value,
}
impl Budget {
    fn accept(&mut self, event: &mut ParsedEvent) -> Result<bool, ArenaError> {
        // Emitted is not acknowledged. Validate and forward old replay IDs for C0,
        // but account their decoded content only once at the native high-water mark.
        let advances = self
            .cursor
            .as_deref()
            .is_none_or(|id| cursor_cmp(&event.id, id) == std::cmp::Ordering::Greater);
        let data = event.data.as_object_mut().ok_or_else(protocol)?;
        let mut markdown = self.markdown_bytes;
        let mut reasoning = self.reasoning_bytes;
        match event.name.as_str() {
            "markdown" | "reasoning" => {
                let text = data
                    .get("chunk")
                    .and_then(Value::as_str)
                    .ok_or_else(protocol)?;
                if text.len() > OUTPUT_BYTES {
                    return Err(protocol());
                }
                if advances {
                    if event.name == "markdown" {
                        markdown = markdown.checked_add(text.len()).ok_or_else(protocol)?;
                    } else {
                        reasoning = reasoning.checked_add(text.len()).ok_or_else(protocol)?;
                    }
                }
                data.retain(|k, _| {
                    if event.name == "markdown" {
                        k == "chunk"
                    } else {
                        ["chunk", "source", "status"].contains(&k.as_str())
                    }
                });
                if event.name == "reasoning"
                    && (data.get("source").is_some_and(|v| v != &json!("sdk"))
                        || data.get("status").is_some_and(|v| v != &json!("thinking")))
                {
                    return Err(protocol());
                }
            }
            "snapshot" => {
                markdown = data
                    .get("markdown")
                    .and_then(Value::as_str)
                    .ok_or_else(protocol)?
                    .len();
                reasoning = data
                    .get("reasoning")
                    .and_then(Value::as_str)
                    .ok_or_else(protocol)?
                    .len();
                if !data
                    .get("status")
                    .and_then(Value::as_str)
                    .is_some_and(status_valid)
                    || data
                        .get("lastEventId")
                        .is_none_or(|v| !v.is_null() && !v.as_str().is_some_and(cursor_valid))
                    || data
                        .get("updatedAt")
                        .and_then(Value::as_str)
                        .is_none_or(|v| !timestamp_valid(v))
                {
                    return Err(protocol());
                }
                if data.get("terminalResultRef").is_some_and(|v| {
                    !v.is_null() && !v.as_str().is_some_and(|s| s.encode_utf16().count() <= 2048)
                }) || data.get("persistenceWarning").is_some_and(|v| {
                    !v.is_null()
                        && !v.as_str().is_some_and(|s| {
                            matches!(s, "OUTPUT_NOT_ARCHIVED" | "PERSISTENCE_UNAVAILABLE")
                        })
                }) {
                    return Err(protocol());
                }
                if let Some(value) = data.get_mut("telemetry") {
                    if !value.is_null() {
                        *value = project_telemetry(value)?;
                    }
                }
                data.retain(|k, _| {
                    [
                        "status",
                        "markdown",
                        "reasoning",
                        "lastEventId",
                        "updatedAt",
                        "telemetry",
                        "terminalResultRef",
                        "persistenceWarning",
                    ]
                    .contains(&k.as_str())
                });
            }
            "telemetry" => {
                event.data = project_telemetry(&event.data)?;
            }
            "meta" => {
                if data.get("parseOk") != Some(&Value::Bool(true))
                    || !data.get("meta").is_some_and(Value::is_object)
                {
                    return Err(protocol());
                }
                validate_meta_tail(data, 8000)?;
                if !data.get("raw").is_some_and(Value::is_string)
                    || !data.get("rawTruncated").is_some_and(Value::is_boolean)
                {
                    return Err(protocol());
                }
                if let Some(value) = data.get("webPackage") {
                    validate_artifact(value)?;
                }
                data.retain(|k, _| {
                    ["parseOk", "meta", "raw", "rawTruncated", "webPackage"].contains(&k.as_str())
                });
            }
            "meta_error" => {
                if data.get("parseOk") != Some(&Value::Bool(false)) {
                    return Err(protocol());
                }
                validate_meta_tail(data, 8000)?;
                data.retain(|k, _| ["parseOk", "raw", "rawTruncated"].contains(&k.as_str()));
                data.insert("error".to_string(), json!("Arena 附加元数据解析失败"));
            }
            "done" => {
                let status = data
                    .get("status")
                    .and_then(Value::as_str)
                    .ok_or_else(protocol)?;
                if !matches!(status, "completed" | "cancelled")
                    || data.get("ok") != Some(&Value::Bool(status == "completed"))
                {
                    return Err(protocol());
                }
                if let Some(artifact) = data.get("webPackage") {
                    validate_artifact(artifact)?;
                }
                data.retain(|k, _| {
                    [
                        "ok",
                        "status",
                        "code",
                        "resultRef",
                        "webPackage",
                        "persistenceWarning",
                        "replayUnavailable",
                        "resultAvailable",
                        "contentRetention",
                    ]
                    .contains(&k.as_str())
                });
                validate_terminal_fields(data)?;
            }
            "error" => {
                let status = data
                    .get("status")
                    .and_then(Value::as_str)
                    .ok_or_else(protocol)?;
                if !matches!(status, "failed" | "producer_lost")
                    || data.get("ok").is_some_and(|v| v != &Value::Bool(false))
                {
                    return Err(protocol());
                }
                data.retain(|k, _| {
                    [
                        "ok",
                        "status",
                        "code",
                        "persistenceWarning",
                        "resultAvailable",
                        "replayUnavailable",
                    ]
                    .contains(&k.as_str())
                });
                validate_terminal_fields(data)?;
                data.insert(
                    "error".to_string(),
                    json!("Arena 生成未完成，已收到的内容仍可查看和导出"),
                );
            }
            "reasoning_done" => {
                if data.get("source") != Some(&json!("sdk"))
                    || !data
                        .get("status")
                        .and_then(Value::as_str)
                        .is_some_and(|s| matches!(s, "done" | "unavailable"))
                {
                    return Err(protocol());
                }
                data.retain(|k, _| ["source", "status"].contains(&k.as_str()));
            }
            _ => return Err(protocol()),
        }
        if markdown
            .checked_add(reasoning)
            .is_none_or(|sum| sum > OUTPUT_BYTES)
        {
            return Err(error(
                "output-too-large",
                "Arena 当前正文与推理超过 4 MiB，已停止本机接收，未重新生成",
            ));
        }
        if advances {
            self.markdown_bytes = markdown;
            self.reasoning_bytes = reasoning;
            self.cursor = Some(event.id.clone());
            self.observed = true;
        }
        Ok(advances)
    }
}
fn validate_meta_tail(data: &serde_json::Map<String, Value>, max: usize) -> Result<(), ArenaError> {
    if data
        .get("raw")
        .is_some_and(|v| v.as_str().is_none_or(|s| s.encode_utf16().count() > max))
        || data.get("rawTruncated").is_some_and(|v| !v.is_boolean())
    {
        return Err(protocol());
    }
    Ok(())
}
fn validate_terminal_fields(data: &serde_json::Map<String, Value>) -> Result<(), ArenaError> {
    if data
        .get("code")
        .is_some_and(|v| !v.as_str().is_some_and(public_code_valid))
    {
        return Err(protocol());
    }
    if data.get("resultRef").is_some_and(|v| {
        !v.is_null() && !v.as_str().is_some_and(|s| s.encode_utf16().count() <= 2048)
    }) {
        return Err(protocol());
    }
    if data.get("persistenceWarning").is_some_and(|v| {
        !v.as_str()
            .is_some_and(|s| matches!(s, "OUTPUT_NOT_ARCHIVED" | "PERSISTENCE_UNAVAILABLE"))
    }) {
        return Err(protocol());
    }
    if data
        .get("contentRetention")
        .is_some_and(|v| v != &json!("expired"))
    {
        return Err(protocol());
    }
    for key in ["resultAvailable", "replayUnavailable"] {
        if data.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(protocol());
        }
    }
    Ok(())
}
fn digest_valid(s: &str) -> bool {
    s.len() == 71
        && s.starts_with("sha256:")
        && s[7..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate_package_ref(value: &Value) -> Result<(), ArenaError> {
    let map = value.as_object().ok_or_else(protocol)?;
    if map.len() != 3
        || !map
            .get("digest")
            .and_then(Value::as_str)
            .is_some_and(digest_valid)
    {
        return Err(protocol());
    }
    for key in ["id", "version"] {
        let s = map.get(key).and_then(Value::as_str).ok_or_else(protocol)?;
        if s.is_empty()
            || s.len() > 128
            || !s.as_bytes()[0].is_ascii_alphanumeric()
            || !s
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        {
            return Err(protocol());
        }
    }
    Ok(())
}
fn validate_artifact(value: &Value) -> Result<(), ArenaError> {
    let map = value.as_object().ok_or_else(protocol)?;
    if map.len() != 4
        || !map
            .get("generatedDigest")
            .and_then(Value::as_str)
            .is_some_and(digest_valid)
    {
        return Err(protocol());
    }
    validate_package_ref(map.get("packageRef").ok_or_else(protocol)?)?;
    let path = map
        .get("targetPath")
        .and_then(Value::as_str)
        .ok_or_else(protocol)?;
    if path.len() > 2048
        || path.eq_ignore_ascii_case("web-package.json")
        || !crate::package_path::is_valid_package_path(path)
    {
        return Err(protocol());
    }
    if !map
        .get("targetMediaType")
        .and_then(Value::as_str)
        .is_some_and(|s| {
            [
                "text/html",
                "text/plain",
                "text/markdown",
                "text/css",
                "text/javascript",
                "application/javascript",
                "application/json",
                "image/svg+xml",
            ]
            .contains(&s)
        })
    {
        return Err(protocol());
    }
    Ok(())
}
fn project_telemetry(value: &Value) -> Result<Value, ArenaError> {
    let map = value.as_object().ok_or_else(protocol)?;
    if let Some(error_class) = map.get("errorClass") {
        let class = error_class.as_str().ok_or_else(protocol)?;
        if map.len() != 1
            || class.is_empty()
            || class.encode_utf16().count() > 256
            || class.chars().any(char::is_control)
        {
            return Err(protocol());
        }
        return Ok(json!({"errorClass":class}));
    }

    let mut out = serde_json::Map::new();
    out.insert("version".to_string(), json!(1));
    if let Some(v) = map.get("aiModel").or_else(|| map.get("model")) {
        let s = v.as_str().ok_or_else(protocol)?;
        if s.len() > EVENT_BYTES {
            return Err(protocol());
        }
        out.insert("aiModel".to_string(), json!(s));
    }
    if let Some(v) = map.get("narrativeHistoryReadCount") {
        if v.as_u64().is_none() {
            return Err(protocol());
        }
        out.insert("narrativeHistoryReadCount".to_string(), v.clone());
    }
    if let Some(v) = map.get("usage") {
        if !v.is_null() {
            let usage = v.as_object().ok_or_else(protocol)?;
            let mut p = serde_json::Map::new();
            for key in [
                "promptTokens",
                "completionTokens",
                "reasoningTokens",
                "totalTokens",
                "cachedTokens",
                "textTokens",
            ] {
                if let Some(v) = usage.get(key) {
                    if !v.is_null() && v.as_u64().is_none() {
                        return Err(protocol());
                    }
                    p.insert(key.to_string(), v.clone());
                }
            }
            if let Some(value) = usage.get("completionTokensIncludesReasoning") {
                if !value.is_boolean() {
                    return Err(protocol());
                }
                p.insert(
                    "completionTokensIncludesReasoning".to_string(),
                    value.clone(),
                );
            }
            out.insert("usage".to_string(), Value::Object(p));
        }
    }
    Ok(Value::Object(out))
}
#[derive(Default)]
struct ArenaParser {
    buffer: Vec<u8>,
    scan_from: usize,
}
impl ArenaParser {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<ParsedEvent>, ArenaError> {
        // Caller caps each feed at 64 KiB. A single incomplete frame is the only retained wire.
        if chunk.len() > IPC_TEXT_BYTES {
            return Err(protocol());
        }
        self.buffer.extend_from_slice(chunk);
        let mut events = Vec::new();
        loop {
            let lf = self.buffer[self.scan_from..]
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|i| (i + self.scan_from, 2));
            let crlf = self.buffer[self.scan_from..]
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .map(|i| (i + self.scan_from, 4));
            let boundary = match (lf, crlf) {
                (Some(a), Some(b)) => Some(if a.0 < b.0 { a } else { b }),
                (a, None) => a,
                (None, b) => b,
            };
            let Some((end, delimiter)) = boundary else {
                self.scan_from = self.buffer.len().saturating_sub(3);
                break;
            };
            self.scan_from = 0;
            if end + delimiter > EVENT_BYTES {
                return Err(protocol());
            }
            let frame = String::from_utf8(self.buffer.drain(..end + delimiter).collect())
                .map_err(|_| protocol())?;
            if let Some(event) = parse_frame(&frame)? {
                events.push(event);
            }
        }
        if self.buffer.len() > EVENT_BYTES {
            return Err(protocol());
        }
        Ok(events)
    }
    fn finish(&self) -> Result<(), ArenaError> {
        if self.buffer.iter().all(u8::is_ascii_whitespace) {
            Ok(())
        } else {
            Err(error(
                "stream-truncated",
                "Arena 流在完整事件边界前中断，可用最后完整游标恢复",
            ))
        }
    }
}
fn parse_frame(frame: &str) -> Result<Option<ParsedEvent>, ArenaError> {
    let mut id = None;
    let mut name = None;
    let mut data = Vec::new();
    for line in frame.lines() {
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let Some((field, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "id" => {
                if id.replace(value.to_string()).is_some() {
                    return Err(protocol());
                }
            }
            "event" => {
                if name.replace(value.to_string()).is_some() {
                    return Err(protocol());
                }
            }
            "data" => data.push(value),
            "retry" => {}
            _ => {}
        }
    }
    if data.is_empty() {
        return Ok(None);
    }
    let id = id.ok_or_else(protocol)?;
    if !cursor_valid(&id) {
        return Err(protocol());
    }
    let name = name.ok_or_else(protocol)?;
    if ![
        "markdown",
        "reasoning",
        "reasoning_done",
        "telemetry",
        "snapshot",
        "meta",
        "meta_error",
        "done",
        "error",
    ]
    .contains(&name.as_str())
    {
        return Err(protocol());
    }
    let data: Value = serde_json::from_str(&data.join("\n")).map_err(|_| protocol())?;
    if !data.is_object() {
        return Err(protocol());
    }
    Ok(Some(ParsedEvent { id, name, data }))
}
fn header_metadata(headers: &reqwest::header::HeaderMap) -> (Option<Value>, &'static str) {
    let Some(raw) = headers.get("x-mahoshojo-stream-meta") else {
        return (None, "missing");
    };
    if raw.as_bytes().len() > HEADER_BYTES {
        return (None, "oversized");
    };
    let Ok(raw) = raw.to_str() else {
        return (None, "invalid");
    };
    if !raw.is_ascii() {
        return (None, "invalid");
    }
    // percent_decode_str accepts malformed percent escapes; reject them explicitly first.
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len()
                || !bytes[i + 1].is_ascii_hexdigit()
                || !bytes[i + 2].is_ascii_hexdigit()
            {
                return (None, "invalid");
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    let Ok(decoded) = percent_encoding::percent_decode_str(raw).decode_utf8() else {
        return (None, "invalid");
    };
    if decoded.len() > HEADER_BYTES {
        return (None, "oversized");
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&decoded) else {
        return (None, "invalid");
    };
    let mut out = serde_json::Map::new();
    for (key, value) in map {
        let allowed = match key.as_str() {
            "reportFormat" => value
                .as_str()
                .is_some_and(|s| matches!(s, "markdown" | "web")),
            "mode" => value
                .as_str()
                .is_some_and(|s| matches!(s, "classic" | "kizuna" | "daily" | "scenario")),
            "scenarioDisplayName" | "language" | "storyLength" | "userGuidance" => {
                value.is_string()
            }
            "outputContract" => value.as_str().is_some_and(|s| {
                matches!(s, "stream-markdown" | "web-document" | "web-package-target")
            }),
            "webPackageRef" => validate_package_ref(&value).is_ok(),
            "reporterInfo" => value.is_object(),
            "characterGuidances" => value.as_array().is_some_and(|a| a.len() <= 32),
            "adjudicationResults" => value.as_array().is_some_and(|a| a.len() <= 100),
            "narrativeHistoryReadCount" => value.as_u64().is_some(),
            _ => continue,
        };
        if !allowed {
            return (None, "invalid");
        }
        out.insert(key, value);
    }
    if !out.contains_key("reportFormat") {
        return (None, "invalid");
    }
    (Some(Value::Object(out)), "available")
}
fn checked_header(
    headers: &reqwest::header::HeaderMap,
    key: &str,
    valid: fn(&str) -> bool,
) -> Result<Option<String>, ArenaError> {
    headers
        .get(key)
        .map(|v| {
            let s = v.to_str().map_err(|_| protocol())?;
            if !valid(s) {
                return Err(protocol());
            }
            Ok(s.to_string())
        })
        .transpose()
}
fn emit(
    sink: &dyn EventSink,
    event: ChannelEvent,
    flight: &Arc<Mutex<Flight>>,
) -> Result<(), ArenaError> {
    let json = serde_json::to_string(&event).map_err(|_| protocol())?;
    if json.len() > IPC_BYTES {
        return Err(protocol());
    }
    reject_secret_echo(&json, flight)?;
    sink.send(event)
}
fn emit_block(
    sink: &dyn EventSink,
    request_id: &str,
    sequence: &mut u64,
    block: &str,
    flight: &Arc<Mutex<Flight>>,
) -> Result<(), ArenaError> {
    if block.len() > EVENT_BYTES {
        return Err(protocol());
    }
    reject_secret_echo(block, flight)?;
    let mut start = 0;
    while start < block.len() {
        let mut end = (start + IPC_TEXT_BYTES).min(block.len());
        while !block.is_char_boundary(end) {
            end -= 1;
        }
        emit(
            sink,
            ChannelEvent::SseFragment {
                request_id: request_id.to_string(),
                sequence: *sequence,
                text: block[start..end].to_string(),
                r#final: end == block.len(),
            },
            flight,
        )?;
        *sequence += 1;
        start = end;
    }
    Ok(())
}
struct SubscriptionGuard {
    flight: Arc<Mutex<Flight>>,
    token: Arc<CancellationToken>,
}
impl Drop for SubscriptionGuard {
    fn drop(&mut self) {
        if let Ok(mut f) = self.flight.lock() {
            if f.subscription
                .as_ref()
                .is_some_and(|token| Arc::ptr_eq(token, &self.token))
            {
                f.subscription = None;
            }
        }
    }
}

pub async fn stream(
    state: &ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: ArenaRequest,
    sink: &dyn EventSink,
) -> Result<(), ArenaError> {
    let (product, request_id, actor) = request.scope();
    let request_id = request_id.to_string();
    let actor = actor.clone();
    let witness = OwnershipWitness::capture(state, product, secrets);
    stream_inner(state, cloud, secrets, request, sink)
        .await
        .map_err(|mut error| {
            error.intent_ownership = OwnershipWitness::classify(
                witness.as_ref(),
                state,
                product,
                &request_id,
                &actor,
                secrets,
            );
            error
        })
}

/// Read-only projection of the one fixed product slot. It neither probes the network
/// nor clears credentials, changes ownership, creates an actor, or reveals a secret.
pub fn recovery_hint(
    state: &ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: RecoveryHintRequest,
) -> RecoveryHint {
    let product = request.product;
    let Ok(flights) = state.flights.lock() else {
        return RecoveryHint::Unavailable { product };
    };
    if let Some(flight) = flights.get(&product) {
        let Ok(f) = flight.lock() else {
            return RecoveryHint::Unavailable { product };
        };
        match &f.actor {
            Actor::Account { expected_user_id } => {
                let Ok(current) = cloud::arena_account_snapshot(cloud, secrets) else {
                    return RecoveryHint::Unavailable { product };
                };
                if current.user_id != Some(*expected_user_id) {
                    return RecoveryHint::None { product };
                }
                return RecoveryHint::Available {
                    product,
                    request_id: f.request_id.clone(),
                    actor_kind: "account",
                };
            }
            Actor::Anonymous => {
                let Some(record) = &f.anonymous else {
                    return RecoveryHint::Unavailable { product };
                };
                return if validate_anonymous_lifetime(record).is_ok() {
                    RecoveryHint::Available {
                        product,
                        request_id: f.request_id.clone(),
                        actor_kind: "anonymous",
                    }
                } else {
                    RecoveryHint::Expired {
                        product,
                        request_id: f.request_id.clone(),
                        actor_kind: "anonymous",
                    }
                };
            }
        }
    }
    match load_anonymous(product, secrets) {
        Ok(None) => RecoveryHint::None { product },
        Err(_) => RecoveryHint::Unavailable { product },
        Ok(Some(record)) => {
            if validate_anonymous_lifetime(&record).is_ok() {
                RecoveryHint::Available {
                    product,
                    request_id: record.request_id,
                    actor_kind: "anonymous",
                }
            } else {
                RecoveryHint::Expired {
                    product,
                    request_id: record.request_id,
                    actor_kind: "anonymous",
                }
            }
        }
    }
}

async fn stream_inner(
    state: &ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: ArenaRequest,
    sink: &dyn EventSink,
) -> Result<(), ArenaError> {
    request.validate()?;
    if matches!(&request, ArenaRequest::Reconcile { .. }) {
        return reconciliation::run(state, cloud, secrets, request, sink).await;
    }
    let (product, id, _) = request.scope();
    let request_id = id.to_string();
    // Capture provider selection and plaintext before the first network await; never re-resolve on controls.
    let (body, key_guard) = if let ArenaRequest::CreateStream {
        body,
        system_config,
        preset_config,
        reconciliation_version,
        ..
    }
    | ArenaRequest::CreateJson {
        body,
        system_config,
        preset_config,
        reconciliation_version,
        ..
    } = &request
    {
        if reconciliation_version.is_some() {
            validate_body_with_reconciliation(body, true)?;
        } else {
            validate_body(body)?;
        }
        let provider =
            cloud::arena_provider_config(system_config.clone(), preset_config.clone(), secrets)
                .map_err(|_| invalid())?;
        let key_guard = if let Some(config) = preset_config {
            Some((
                crate::provider_target::preset_secret_ref(&config.provider_id)
                    .map_err(|_| invalid())?,
                provider
                    .as_ref()
                    .and_then(|v| v.get("apiKey"))
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?
                    .to_string(),
            ))
        } else {
            None
        };
        let mut body = body.clone();
        body["generationRequestId"] = json!(request_id);
        if let Some(provider) = provider {
            body["customProvider"] = provider;
        }
        if serialized_size(&body)? > INPUT_BYTES {
            return Err(invalid());
        }
        (Some(body), key_guard)
    } else if matches!(request, ArenaRequest::Resume { .. }) {
        (None, None)
    } else {
        return Err(invalid());
    };
    let flight = state.prepare(&request, cloud, secrets)?;
    let token = Arc::new(CancellationToken::new());
    {
        let mut f = flight.lock().map_err(|_| stale())?;
        if f.subscription.is_some() {
            return Err(error("subscription-in-progress", "此请求已有本机订阅"));
        }
        if let ArenaRequest::Resume {
            after: Some(after), ..
        } = &request
        {
            if !f.budget.observed
                || f.budget
                    .cursor
                    .as_deref()
                    .is_none_or(|high| cursor_cmp(after, high) == std::cmp::Ordering::Greater)
            {
                return Err(error(
                    "resume-cursor-mismatch",
                    "首次恢复须从完整快照开始；热重连游标不得超前",
                ));
            }
        }
        if let Some((_, key)) = &key_guard {
            f.secrets_to_redact.push(key.clone());
        }
        f.subscription = Some(token.clone());
    }
    let _guard = SubscriptionGuard {
        flight: flight.clone(),
        token: token.clone(),
    };
    let is_json = matches!(&request, ArenaRequest::CreateJson { .. });
    let requires_reconciliation = match &request {
        ArenaRequest::CreateStream {
            reconciliation_version: Some(_),
            body,
            ..
        }
        | ArenaRequest::CreateJson {
            reconciliation_version: Some(_),
            body,
            ..
        } => {
            body.get("writeArenaHistory") == Some(&Value::Bool(true))
                || body.get("writeCurrentState") == Some(&Value::Bool(true))
        }
        _ => false,
    };
    let operation = async {
        if requires_reconciliation {
            reconciliation::capability(state, product, &flight, cloud, secrets).await?;
        }
        state
            .capability(
                product,
                &flight,
                cloud,
                secrets,
                is_json,
                is_json && requires_reconciliation,
            )
            .await?;
        if let Some(id) = request.generation_id() {
            state
                .bind_generation(product, id, &flight, cloud, secrets)
                .await?;
        }
        state.is_current(product, &flight, cloud, secrets)?;
        if let Some((reference, key)) = &key_guard {
            if secrets
                .resolve(reference)
                .map_err(|_| storage())?
                .as_deref()
                .map(str::trim)
                != Some(key.as_str())
            {
                return Err(stale());
            }
        }
        let builder = match &request {
            ArenaRequest::CreateStream { .. } | ArenaRequest::CreateJson { .. } => {
                let mut f = flight.lock().map_err(|_| stale())?;
                if f.dispatched {
                    return Err(invalid());
                }
                f.dispatched = true;
                drop(f);
                state
                    .authenticated(
                        reqwest::Method::POST,
                        &if is_json {
                            json_delivery::CREATE_PATH.to_string()
                        } else {
                            format!("{CREATE_PATH}?format=sse")
                        },
                        &flight,
                    )?
                    .json(body.as_ref().ok_or_else(invalid)?)
            }
            ArenaRequest::Resume {
                generation_id,
                after,
                ..
            } => {
                let path = format!(
                    "/api/arena/generations/{generation_id}/stream{}",
                    after
                        .as_ref()
                        .map(|v| format!("?after={v}"))
                        .unwrap_or_default()
                );
                state.authenticated(reqwest::Method::GET, &path, &flight)?
            }
            _ => return Err(invalid()),
        };
        // Companion returns headers after generation/finalization: only connection is timed.
        // Shared host soft deadlines may prompt, but never cancel/recreate this POST.
        let response = if is_json {
            let mut builder = builder
                .header(reqwest::header::ACCEPT, "application/json")
                .header(
                    json_delivery::PROTOCOL_HEADER,
                    json_delivery::PROTOCOL_VERSION,
                );
            if requires_reconciliation {
                builder = builder.header(
                    reconciliation::PROTOCOL_HEADER,
                    reconciliation::PROTOCOL_VERSION,
                );
            }
            builder.send().await.map_err(|_| network())?
        } else {
            tokio::time::timeout(
                SHORT_TIMEOUT,
                builder
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .send(),
            )
            .await
            .map_err(|_| network())?
            .map_err(|_| network())?
        };
        state.is_current(product, &flight, cloud, secrets)?;
        state.capture_response_token(product, &flight, cloud, secrets, response.headers())?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            return Err(protocol());
        }
        let generation_id = checked_header(
            response.headers(),
            "x-mahoshojo-generation-id",
            generation_id_valid,
        )?;
        let generation_request_id = checked_header(
            response.headers(),
            "x-mahoshojo-generation-request-id",
            request_id_valid,
        )?;
        let payload_hash = checked_header(
            response.headers(),
            "x-mahoshojo-generation-payload-hash",
            |s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            },
        )?;
        if generation_request_id
            .as_deref()
            .is_some_and(|id| id != request_id)
        {
            return Err(protocol());
        }
        if let Some(id) = &generation_id {
            accept_control_identity(
                &json!({"generationId":id,"generationRequestId":request_id}),
                &flight,
            )?;
        }
        if is_json {
            return json_delivery::deliver(
                json_delivery::Delivery {
                    state,
                    cloud,
                    secrets,
                    product,
                    flight: &flight,
                    token: &token,
                    request_id: &request_id,
                    sink,
                },
                response,
                json_delivery::ResponseIdentity {
                    generation_id,
                    generation_request_id,
                    payload_hash,
                },
            )
            .await;
        }
        let (header_meta, metadata_state) = header_metadata(response.headers());
        let recovery_credential_state = flight.lock().map_err(|_| stale())?.credential_state();
        let success = (200..300).contains(&status);
        if success
            && (generation_id.is_none()
                || response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .is_none_or(|s| {
                        s.split(';').next().map(str::trim) != Some("text/event-stream")
                    }))
        {
            return Err(protocol());
        }
        let mut sequence = 0;
        if !success {
            let body = public_control(
                tokio::time::timeout(SHORT_TIMEOUT, read_json(response, HEADER_BYTES))
                    .await
                    .map_err(|_| network())??,
                &flight,
            )?;
            state.is_current(product, &flight, cloud, secrets)?;
            emit(
                sink,
                ChannelEvent::Response {
                    request_id: request_id.clone(),
                    sequence,
                    status,
                    generation_id,
                    generation_request_id,
                    payload_hash,
                    header_meta,
                    body: Some(body),
                    metadata_state,
                    recovery_credential_state,
                },
                &flight,
            )?;
            emit(
                sink,
                ChannelEvent::StreamEnd {
                    request_id: request_id.clone(),
                    sequence: 1,
                },
                &flight,
            )?;
            return Ok(());
        }
        emit(
            sink,
            ChannelEvent::Response {
                request_id: request_id.clone(),
                sequence,
                status,
                generation_id,
                generation_request_id,
                payload_hash,
                header_meta,
                body: None,
                metadata_state,
                recovery_credential_state,
            },
            &flight,
        )?;
        sequence += 1;
        let mut bytes = response.bytes_stream();
        let mut parser = ArenaParser::default();
        let mut terminal = false;
        while let Some(chunk) = bytes.next().await {
            let chunk = chunk.map_err(|_| network())?;
            state.is_current(product, &flight, cloud, secrets)?;
            for chunk in chunk.chunks(IPC_TEXT_BYTES) {
                for mut event in parser.push(chunk)? {
                    let mut budget = flight.lock().map_err(|_| stale())?.budget.clone();
                    budget.accept(&mut event)?;
                    let block = format!(
                        "id: {}\nevent: {}\ndata: {}\n\n",
                        event.id, event.name, event.data
                    );
                    emit_block(sink, &request_id, &mut sequence, &block, &flight)?;
                    flight.lock().map_err(|_| stale())?.budget = budget;
                    if matches!(event.name.as_str(), "done" | "error") {
                        terminal = true;
                        let replay_failure =
                            event.name == "error"
                                && event.data.get("code").and_then(Value::as_str).is_some_and(
                                    |code| {
                                        matches!(
                                            code,
                                            "GENERATION_TERMINAL_RECONCILIATION_PENDING"
                                                | "REPLAY_WINDOW_LOST"
                                                | "REPLAY_STREAM_MISSING"
                                                | "GENERATION_STATE_LOST"
                                                | "GENERATION_TERMINAL_EVIDENCE_MISSING"
                                        )
                                    },
                                );
                        if !replay_failure {
                            flight.lock().map_err(|_| stale())?.terminal = true;
                        }
                        break;
                    }
                }
                if terminal {
                    break;
                }
            }
            if terminal {
                break;
            }
        }
        if !terminal {
            parser.finish()?;
        }
        state.is_current(product, &flight, cloud, secrets)?;
        emit(
            sink,
            ChannelEvent::StreamEnd {
                request_id: request_id.clone(),
                sequence,
            },
            &flight,
        )?;
        Ok(())
    };
    let result = tokio::select! {biased;_ = token.cancelled()=>Err(error("detached","本机订阅已关闭，未请求服务器停止")),result=operation=>result};
    result.map_err(|mut error| {
        if flight.lock().is_ok_and(|f| f.dispatched) {
            error.dispatch_state = "unknown";
        }
        error
    })
}

#[cfg(test)]
#[path = "arena_hosted_tests.rs"]
mod tests;

#[path = "arena_hosted_json.rs"]
mod json_delivery;

#[path = "arena_hosted_reconciliation.rs"]
mod reconciliation;
