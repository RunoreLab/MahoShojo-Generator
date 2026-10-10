//! Narrow Hosted story adapter. Sealed originals own business JSON; Native owns
//! funding, actor, durable create authority and the two fixed service destinations.
use super::*;
use crate::arena_story::StoryError;
use serde_json::value::RawValue;
use std::collections::BTreeMap;

pub(super) const PROTOCOL_HEADER: &str = "x-mahoshojo-arena-story-protocol";
pub(super) const PROTOCOL_VERSION: &str = "arena-story-v1";
pub(super) const CREATE_PATH: &str = "/api/arena/session/generate-next";

#[derive(Clone)]
pub(super) struct Binding {
    pub attempt_id: String,
    pub input_digest: String,
}
pub(super) fn product(value: Product) -> story_pending::Product {
    match value {
        Product::Battle => story_pending::Product::Battle,
        Product::Arena => story_pending::Product::Arena,
    }
}
pub(super) fn actor(value: &Actor) -> story_pending::Actor {
    match value {
        Actor::Anonymous => story_pending::Actor::Anonymous,
        Actor::Account { expected_user_id } => story_pending::Actor::Account {
            expected_user_id: *expected_user_id,
        },
    }
}
fn transport_product(value: story_pending::Product) -> Product {
    match value {
        story_pending::Product::Battle => Product::Battle,
        story_pending::Product::Arena => Product::Arena,
    }
}
pub(super) fn storage_error(value: StoryError) -> ArenaError {
    match value {
        StoryError::TooLarge => error(
            "invalid-request",
            "故事原件与创建元数据超出既有预算，未派发且原件已保留",
        ),
        StoryError::Stale | StoryError::Missing => stale(),
        StoryError::Conflict | StoryError::Busy | StoryError::CommitUnknown => error(
            "recovery-conflict",
            "故事候选仍占用原请求，请保留原件并仅恢复或查询原回执",
        ),
        StoryError::Invalid
        | StoryError::Incomplete
        | StoryError::OperationMismatch
        | StoryError::OriginalsUncovered => invalid(),
        _ => storage(),
    }
}
fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn input_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(hex)
}
pub(super) fn validate_request(request: &ArenaRequest) -> Result<(), ArenaError> {
    let scope = match request {
        ArenaRequest::CreateStoryStream {
            pending_revision,
            input_digest,
            ..
        }
        | ArenaRequest::ReconcileStory {
            pending_revision,
            input_digest,
            ..
        } => Some((*pending_revision, input_digest)),
        _ => None,
    };
    if scope.is_some_and(|(revision, digest)| {
        revision == 0 || revision > 9_007_199_254_740_991 || !input_digest(digest)
    }) {
        return Err(invalid());
    }
    if let ArenaRequest::CreateStoryStream {
        client_body_hash,
        system_config,
        preset_config,
        ..
    } = request
    {
        if !hex(client_body_hash) || (system_config.is_some() && preset_config.is_some()) {
            return Err(invalid());
        }
    }
    Ok(())
}
pub(super) fn key(request: &ArenaRequest) -> Result<story_pending::PendingKey, ArenaError> {
    let (p, id, _) = request.scope();
    let revision = match request {
        ArenaRequest::CreateStoryStream {
            pending_revision, ..
        }
        | ArenaRequest::ReconcileStory {
            pending_revision, ..
        } => *pending_revision,
        _ => return Err(invalid()),
    };
    Ok(story_pending::PendingKey {
        product: product(p),
        request_id: id.into(),
        pending_revision: revision,
    })
}
fn declared_digest(request: &ArenaRequest) -> Result<&str, ArenaError> {
    match request {
        ArenaRequest::CreateStoryStream { input_digest, .. }
        | ArenaRequest::ReconcileStory { input_digest, .. } => Ok(input_digest),
        _ => Err(invalid()),
    }
}
fn exact_snapshot(
    snapshot: &story_pending::PendingSnapshot,
    request: &ArenaRequest,
) -> Result<(), ArenaError> {
    let (p, id, a) = request.scope();
    if snapshot.manifest.product != product(p)
        || snapshot.manifest.request_id != id
        || snapshot.manifest.actor != actor(a)
    {
        return Err(stale());
    }
    if matches!(
        request,
        ArenaRequest::CreateStoryStream { .. } | ArenaRequest::ReconcileStory { .. }
    ) && (snapshot.manifest.key() != key(request)?
        || snapshot.manifest.input_digest != declared_digest(request)?)
    {
        return Err(stale());
    }
    Ok(())
}
/// Every operation that may create/rebind a Flight enters this same admission lock.
/// A terminal model is never permission to replace a still-active pending story.
pub(super) fn admit(
    state: &ArenaState,
    guard: &story_pending::AdmissionGuard<'_>,
    request: &ArenaRequest,
    allow_story_create: bool,
) -> Result<(), ArenaError> {
    let pending = state
        .stories
        .pending_describe_admitted(guard)
        .map_err(storage_error)?;
    match pending {
        Some(snapshot) => {
            if matches!(
                request,
                ArenaRequest::CreateStream { .. }
                    | ArenaRequest::CreateJson { .. }
                    | ArenaRequest::Reconcile { .. }
            ) {
                return Err(error(
                    "recovery-conflict",
                    "原故事正文、角色或保存结果尚未处理，此产品的原身份仍受保护",
                ));
            }
            exact_snapshot(&snapshot, request)?;
            if matches!(request, ArenaRequest::CreateStoryStream { .. }) {
                if !allow_story_create {
                    return Err(invalid());
                }
                if snapshot.create_claim.is_some() {
                    return Err(error(
                        "create-already-attempted",
                        "原故事已有耐久创建记录，仅可查找或恢复；未派发也不会自动重新创建",
                    ));
                }
                if snapshot.restored
                    || snapshot.save_attempt_id.is_some()
                    || snapshot.manifest.commit_manifest.is_some()
                    || snapshot.manifest.model_completed
                {
                    return Err(error(
                        "recovery-conflict",
                        "原故事候选不能再次创建，原件已保留",
                    ));
                }
            } else if snapshot.create_claim.is_none() {
                return Err(error(
                    "recovery-unavailable",
                    "该故事没有原生创建身份，不能绑定另一个生成任务",
                ));
            }
        }
        None if matches!(
            request,
            ArenaRequest::CreateStoryStream { .. } | ArenaRequest::ReconcileStory { .. }
        ) =>
        {
            return Err(stale())
        }
        None => {}
    }
    Ok(())
}
pub(super) fn bind_existing(
    state: &ArenaState,
    guard: &story_pending::AdmissionGuard<'_>,
    request: &ArenaRequest,
    flight: &Arc<Mutex<Flight>>,
) -> Result<(), ArenaError> {
    if let Some(snapshot) = state
        .stories
        .pending_describe_admitted(guard)
        .map_err(storage_error)?
    {
        exact_snapshot(&snapshot, request)?;
        let claim = snapshot.create_claim.ok_or_else(stale)?;
        let mut f = flight.lock().map_err(|_| stale())?;
        if f.story.as_ref().is_some_and(|b| {
            b.attempt_id != claim.attempt_id || b.input_digest != claim.input_digest
        }) {
            return Err(stale());
        }
        if let Some(generation) = &claim.observed_generation {
            if f.generation_id
                .as_ref()
                .is_some_and(|id| id != &generation.generation_id)
            {
                return Err(stale());
            }
            // Controls still perform original request lookup when restoring; this is only
            // a conflict assertion, not server ownership or permission to skip lookup.
        }
        f.story = Some(Binding {
            attempt_id: claim.attempt_id,
            input_digest: claim.input_digest,
        });
    }
    Ok(())
}

pub(super) fn seal_pending(
    state: &ArenaState,
    stories: &StoryStore,
    token: &str,
) -> Result<story_pending::PendingSnapshot, StoryError> {
    if !std::ptr::eq(stories, state.stories.as_ref()) {
        return Err(StoryError::Stale);
    }
    let p = stories.pending_upload_product(token)?;
    let guard = stories.pending_admission(p)?;
    let upload = stories.pending_upload(token)?;
    if upload.manifest.product != p {
        return Err(StoryError::Stale);
    }
    if stories.pending_describe_admitted(&guard)?.is_none() {
        let flights = state.flights.lock().map_err(|_| StoryError::Io)?;
        if let Some(flight) = flights.get(&transport_product(p)) {
            let f = flight.lock().map_err(|_| StoryError::Io)?;
            if !f.terminal || f.request_id == upload.manifest.request_id {
                return Err(StoryError::Conflict);
            }
        }
    }
    stories.pending_seal_admitted(&guard, token)
}

fn check_actor(
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    expected: &Actor,
    epoch: &str,
) -> Result<(), ArenaError> {
    let current = cloud::arena_account_snapshot(cloud, secrets).map_err(|_| stale())?;
    if current.fingerprint != epoch
        || match expected {
            Actor::Anonymous => current.user_id.is_some(),
            Actor::Account { expected_user_id } => current.user_id != Some(*expected_user_id),
        }
    {
        return Err(stale());
    }
    Ok(())
}
fn captured_funding(
    provider: Option<&Value>,
    preset: bool,
) -> Result<story_pending::NativeFunding, ArenaError> {
    let funding = story_pending::NativeFunding {
        mode: if preset {
            story_pending::FundingMode::Preset
        } else {
            story_pending::FundingMode::System
        },
        provider_id: provider
            .and_then(|p| p.get("providerId"))
            .and_then(Value::as_str)
            .unwrap_or("system")
            .into(),
        model_id: provider
            .and_then(|p| p.get("modelId"))
            .and_then(Value::as_str)
            .unwrap_or("default")
            .into(),
        generation_overrides: provider.and_then(|p| p.get("generationOverrides")).cloned(),
    };
    funding.validate().map_err(storage_error)?;
    Ok(funding)
}
/// A deliberately narrow, versioned intent codec. Business JSON enters only as its
/// original byte digest; numbers are binary64 rather than cross-language JSON text.
pub(super) fn encode_intent(
    digest: &str,
    funding: &story_pending::NativeFunding,
) -> Result<Vec<u8>, ArenaError> {
    if !input_digest(digest) {
        return Err(invalid());
    }
    funding.validate().map_err(storage_error)?;
    let mut bytes = b"desktop-arena-story-client-body-v1\0arena-story-v1\0".to_vec();
    for i in (7..71).step_by(2) {
        bytes.push(u8::from_str_radix(&digest[i..i + 2], 16).map_err(|_| invalid())?);
    }
    bytes.push(if funding.mode == story_pending::FundingMode::System {
        0
    } else {
        1
    });
    for text in [&funding.provider_id, &funding.model_id] {
        bytes.extend_from_slice(&(text.len() as u32).to_be_bytes());
        bytes.extend_from_slice(text.as_bytes());
    }
    let overrides = funding
        .generation_overrides
        .as_ref()
        .and_then(Value::as_object);
    let get = |name: &str| overrides.and_then(|v| v.get(name));
    bytes.push(
        u8::from(get("maxOutputTokens").is_some())
            | (u8::from(get("temperature").is_some()) << 1)
            | (u8::from(get("thinking").is_some()) << 2),
    );
    if let Some(v) = get("maxOutputTokens") {
        bytes.extend_from_slice(&(v.as_f64().ok_or_else(invalid)? as u32).to_be_bytes());
    }
    if let Some(v) = get("temperature") {
        let number = v.as_f64().ok_or_else(invalid)?;
        bytes.extend_from_slice(&(if number == 0.0 { 0.0_f64 } else { number }).to_be_bytes());
    }
    if let Some(v) = get("thinking") {
        bytes.push(match v.get("mode").and_then(Value::as_str) {
            Some("default") => 0,
            Some("disabled") => 1,
            Some("enabled") => 2,
            _ => return Err(invalid()),
        });
        if v.get("mode").and_then(Value::as_str) == Some("enabled") {
            bytes.push(match v.get("effort").and_then(Value::as_str) {
                None => 0,
                Some("minimal") => 1,
                Some("low") => 2,
                Some("medium") => 3,
                Some("high") => 4,
                Some("xhigh") => 5,
                Some("max") => 6,
                _ => return Err(invalid()),
            });
        }
    }
    Ok(bytes)
}
pub(super) fn intent_hash(
    digest: &str,
    funding: &story_pending::NativeFunding,
) -> Result<String, ArenaError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(encode_intent(digest, funding)?)
    ))
}
fn wire_body(raw: &str, provider: Option<Value>) -> Result<Vec<u8>, ArenaError> {
    let mut fields: BTreeMap<String, Box<RawValue>> =
        serde_json::from_str(raw).map_err(|_| invalid())?;
    if fields.contains_key("customProvider") {
        return Err(invalid());
    }
    if let Some(provider) = provider {
        fields.insert(
            "customProvider".into(),
            serde_json::value::to_raw_value(&provider).map_err(|_| invalid())?,
        );
    }
    let bytes = serde_json::to_vec(&fields).map_err(|_| invalid())?;
    if bytes.len() > INPUT_BYTES {
        return Err(error(
            "invalid-request",
            "故事请求注入资金配置后超过12 MiB，未派发且完整原件已保留",
        ));
    }
    Ok(bytes)
}
/// Reuses the sole Flight slot solely to make preflight cancellable. No bootstrap,
/// Cookie or durable authority is installed. Preclaim failure restores only the
/// exact prior Arc. Postclaim failure releases that exact old slot for original
/// lookup, preserving durable claim and secrets. Neither CAS touches a newer task.
struct Preflight<'a> {
    state: &'a ArenaState,
    product: Product,
    flight: Arc<Mutex<Flight>>,
    prior: Option<Arc<Mutex<Flight>>>,
    token: Arc<CancellationToken>,
    active: bool,
    claimed: bool,
}
impl Drop for Preflight<'_> {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        self.token.cancel();
        if let Ok(mut flights) = self.state.flights.lock() {
            let reserved = flights
                .get(&self.product)
                .is_some_and(|f| Arc::ptr_eq(f, &self.flight));
            let exact_prior = self.prior.as_ref().is_some_and(|prior| {
                flights
                    .get(&self.product)
                    .is_some_and(|f| Arc::ptr_eq(f, prior))
            });
            if self.claimed && (reserved || exact_prior) {
                flights.remove(&self.product);
            } else if reserved {
                if let Some(prior) = &self.prior {
                    flights.insert(self.product, prior.clone());
                } else {
                    flights.remove(&self.product);
                }
            }
        }
    }
}
fn reserve_preflight<'a>(
    state: &'a ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: &ArenaRequest,
    epoch: &str,
) -> Result<Preflight<'a>, ArenaError> {
    let (p, id, a) = request.scope();
    let guard = state
        .stories
        .pending_admission(product(p))
        .map_err(storage_error)?;
    admit(state, &guard, request, true)?;
    check_actor(cloud, secrets, a, epoch)?;
    let mut flights = state.flights.lock().map_err(|_| stale())?;
    let prior = flights.get(&p).cloned();
    if let Some(prior) = &prior {
        let old = prior.lock().map_err(|_| stale())?;
        if old.request_id == id || !old.terminal {
            return Err(error(
                "subscription-in-progress",
                "此产品已有原生创建或订阅准备，未再次派发",
            ));
        }
    }
    let token = Arc::new(CancellationToken::new());
    let flight = Arc::new(Mutex::new(Flight {
        story: None,
        request_id: id.into(),
        actor: a.clone(),
        account_fingerprint: epoch.into(),
        cookie: None,
        anonymous: None,
        memory_only: false,
        capability_verified: false,
        json_capability_verified: false,
        dispatched: false,
        terminal: false,
        generation_id: None,
        budget: Budget::default(),
        subscription: Some(token.clone()),
        secrets_to_redact: Vec::new(),
    }));
    flights.insert(p, flight.clone());
    Ok(Preflight {
        state,
        product: p,
        flight,
        prior,
        token,
        active: true,
        claimed: false,
    })
}
pub(super) struct Prepared {
    pub wire: Vec<u8>,
    pub key_guard: Option<(String, String)>,
    pub flight: Arc<Mutex<Flight>>,
    pub permit: story_pending::CreatePermit,
    pub token: Arc<CancellationToken>,
}
pub(super) async fn prepare(
    state: &ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: &ArenaRequest,
) -> Result<Prepared, ArenaError> {
    let ArenaRequest::CreateStoryStream {
        product: p,
        actor: a,
        input_digest,
        client_body_hash,
        system_config,
        preset_config,
        ..
    } = request
    else {
        return Err(invalid());
    };
    let epoch = cloud::arena_account_snapshot(cloud, secrets)
        .map_err(|_| stale())?
        .fingerprint;
    check_actor(cloud, secrets, a, &epoch)?;
    let key = key(request)?;
    let native = {
        let guard = state
            .stories
            .pending_admission(product(*p))
            .map_err(storage_error)?;
        admit(state, &guard, request, true)?;
        state
            .stories
            .pending_native_input(&guard, &key, &actor(a), input_digest)
            .map_err(storage_error)?
    };
    check_actor(cloud, secrets, a, &epoch)?;
    let provider =
        cloud::arena_provider_config(system_config.clone(), preset_config.clone(), secrets)
            .map_err(|_| invalid())?;
    let funding = captured_funding(provider.as_ref(), preset_config.is_some())?;
    if intent_hash(input_digest, &funding)? != *client_body_hash {
        return Err(invalid());
    }
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
    let wire = wire_body(&native.input, provider)?;
    check_actor(cloud, secrets, a, &epoch)?;
    // Register a cancellable reservation in the existing Flight slot before any
    // await. Preclaim errors leave both durable claim and secret slot unchanged.
    let mut preflight = reserve_preflight(state, cloud, secrets, request, &epoch)?;
    let probes = async {
        state.probe_capability(false, false, true).await?;
        check_actor(cloud, secrets, a, &epoch)?;
        let options = &native.snapshot.manifest.write_options;
        if options.write_arena_history
            || options.write_current_state
            || options.write_narrative_history
        {
            reconciliation::probe_capability(state).await?;
            check_actor(cloud, secrets, a, &epoch)?;
        }
        Ok::<(), ArenaError>(())
    };
    tokio::select! {
        biased;
        _ = preflight.token.cancelled() => return Err(error("detached", "本机故事创建准备已关闭，未派发")),
        result = probes => result?,
    }
    let (flight, permit) = {
        let guard = state
            .stories
            .pending_admission(product(*p))
            .map_err(storage_error)?;
        check_actor(cloud, secrets, a, &epoch)?;
        state.is_current(*p, &preflight.flight, cloud, secrets)?;
        if preflight.token.is_cancelled() {
            return Err(error("detached", "本机故事创建准备已关闭，未派发"));
        }
        admit(state, &guard, request, true)?;
        let current = state
            .stories
            .pending_native_input(&guard, &key, &actor(a), input_digest)
            .map_err(storage_error)?;
        if current.snapshot != native.snapshot {
            return Err(stale());
        }
        check_key(secrets, key_guard.as_ref())?;
        let permit = state
            .stories
            .pending_claim_create(
                &guard,
                &key,
                &actor(a),
                input_digest,
                client_body_hash,
                funding,
            )
            .map_err(storage_error)?;
        preflight.claimed = true;
        // From this point failures are conservatively recovery-only, even before POST.
        // Detach takes the same admission lock, so no cancellation can fall through
        // the temporary swap from this preflight reservation to the real Flight.
        {
            let mut flights = state.flights.lock().map_err(|_| stale())?;
            if flights
                .get(p)
                .is_none_or(|f| !Arc::ptr_eq(f, &preflight.flight))
            {
                return Err(stale());
            }
            if let Some(prior) = &preflight.prior {
                flights.insert(*p, prior.clone());
            } else {
                flights.remove(p);
            }
        }
        let flight = state.prepare_unchecked(request, cloud, secrets)?;
        flight.lock().map_err(|_| stale())?.subscription = Some(preflight.token.clone());
        check_actor(cloud, secrets, a, &epoch)?;
        if flight.lock().map_err(|_| stale())?.account_fingerprint != epoch {
            return Err(stale());
        }
        bind_existing(state, &guard, request, &flight)?;
        flight.lock().map_err(|_| stale())?.capability_verified = true;
        preflight.active = false;
        (flight, permit)
    };
    Ok(Prepared {
        wire,
        key_guard,
        flight,
        permit,
        token: preflight.token.clone(),
    })
}
pub(super) fn check_key(
    secrets: &dyn SecretStore,
    guard: Option<&(String, String)>,
) -> Result<(), ArenaError> {
    if let Some((reference, key)) = guard {
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
    Ok(())
}
pub(super) fn dispatch(
    state: &ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: &ArenaRequest,
    flight: &Arc<Mutex<Flight>>,
    permit: Option<story_pending::CreatePermit>,
) -> Result<(), ArenaError> {
    let (p, _, a) = request.scope();
    let guard = state
        .stories
        .pending_admission(product(p))
        .map_err(storage_error)?;
    state.is_current(p, flight, cloud, secrets)?;
    if matches!(request, ArenaRequest::CreateStoryStream { .. }) {
        let claim = state
            .stories
            .pending_consume_create(
                &guard,
                &key(request)?,
                &actor(a),
                declared_digest(request)?,
                permit.ok_or_else(invalid)?,
            )
            .map_err(storage_error)?;
        let f = flight.lock().map_err(|_| stale())?;
        if f.story
            .as_ref()
            .is_none_or(|b| b.attempt_id != claim.attempt_id)
        {
            return Err(stale());
        }
    } else {
        admit(state, &guard, request, false)?;
    }
    let mut f = flight.lock().map_err(|_| stale())?;
    if f.dispatched {
        return Err(error(
            "create-already-attempted",
            "原请求已经派发，仅可查找或恢复",
        ));
    }
    f.dispatched = true;
    Ok(())
}
/// Observe only identity verified by the existing actor/response path. Unknown or
/// restored local work is never rewritten from a current page's selection.
pub(super) fn observe(
    state: &ArenaState,
    p: Product,
    flight: &Arc<Mutex<Flight>>,
    generation_id: &str,
    payload_hash: Option<&str>,
) -> Result<(), ArenaError> {
    let (binding, request_id, original_actor) = {
        let f = flight.lock().map_err(|_| stale())?;
        (f.story.clone(), f.request_id.clone(), f.actor.clone())
    };
    let Some(binding) = binding else {
        return Ok(());
    };
    let guard = state
        .stories
        .pending_admission(product(p))
        .map_err(storage_error)?;
    let Some(snapshot) = state
        .stories
        .pending_describe_admitted(&guard)
        .map_err(storage_error)?
    else {
        return Err(stale());
    };
    if snapshot.manifest.request_id != request_id
        || snapshot.manifest.actor != actor(&original_actor)
        || snapshot.manifest.input_digest != binding.input_digest
    {
        return Err(stale());
    }
    if snapshot.restored || snapshot.save_attempt_id.is_some() {
        if snapshot
            .create_claim
            .as_ref()
            .and_then(|c| c.observed_generation.as_ref())
            .is_some_and(|g| {
                g.generation_id != generation_id
                    || g.server_payload_hash
                        .as_deref()
                        .zip(payload_hash)
                        .is_some_and(|(old, new)| old != new)
            })
        {
            return Err(protocol());
        }
        return Ok(());
    }
    state
        .stories
        .pending_observe_generation(
            &guard,
            &snapshot.manifest.key(),
            &actor(&original_actor),
            &binding.input_digest,
            &binding.attempt_id,
            (generation_id, payload_hash),
        )
        .map_err(storage_error)?;
    Ok(())
}

pub(super) struct RoleInput {
    pub wire: Vec<u8>,
    pub count: usize,
    pub accepted: Option<String>,
}
fn role_ready(snapshot: &story_pending::PendingSnapshot) -> Result<(), ArenaError> {
    if snapshot.restored
        || snapshot.save_attempt_id.is_some()
        || snapshot.manifest.commit_manifest.is_some()
        || !snapshot.manifest.model_completed
        || snapshot.manifest.role_state != story_pending::RoleState::Unresolved
        || snapshot.create_claim.is_none()
    {
        return Err(error(
            "recovery-conflict",
            "原故事角色更新尚不具备派发条件，保留完整原件",
        ));
    }
    Ok(())
}
fn js_space(c: u32) -> bool {
    matches!(c, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
/// Match the shared TS optional matching-hint trim without decoding opaque cards,
/// replacing lone surrogates, or expanding their original JSON escape spelling.
fn trimmed_hint(raw: &RawValue) -> Option<Box<RawValue>> {
    let text = raw.get();
    if !text.starts_with('"') {
        return None;
    }
    let mut i = 1;
    let mut first = None;
    let mut last = 1;
    while i < text.len() - 1 {
        let start = i;
        let c = text[i..].chars().next()?;
        i += c.len_utf8();
        let point = if c == '\\' {
            let escape = *text.as_bytes().get(i)?;
            i += 1;
            if escape == b'u' {
                let value = u32::from_str_radix(text.get(i..i + 4)?, 16).ok()?;
                i += 4;
                value
            } else {
                match escape {
                    b'n' => 10,
                    b'r' => 13,
                    b't' => 9,
                    b'f' => 12,
                    b'b' => 8,
                    _ => u32::from(escape),
                }
            }
        } else {
            c as u32
        };
        if !js_space(point) {
            first.get_or_insert(start);
            last = i;
        }
    }
    let first = first?;
    RawValue::from_string(format!("\"{}\"", &text[first..last])).ok()
}
pub(super) fn role_input(
    state: &ArenaState,
    request: &ArenaRequest,
) -> Result<RoleInput, ArenaError> {
    let (_, _, a) = request.scope();
    let key = key(request)?;
    let guard = state
        .stories
        .pending_admission(key.product)
        .map_err(storage_error)?;
    let native = state
        .stories
        .pending_native_input(&guard, &key, &actor(a), declared_digest(request)?)
        .map_err(storage_error)?;
    exact_snapshot(&native.snapshot, request)?;
    let root: BTreeMap<String, &RawValue> =
        serde_json::from_str(&native.input).map_err(|_| invalid())?;
    let context: BTreeMap<String, &RawValue> =
        serde_json::from_str(root.get("chapterContext").ok_or_else(invalid)?.get())
            .map_err(|_| invalid())?;
    let combatants: Vec<&RawValue> =
        serde_json::from_str(context.get("workingCombatants").ok_or_else(invalid)?.get())
            .map_err(|_| invalid())?;
    if combatants.is_empty() || combatants.len() > 32 {
        return Err(invalid());
    }
    let count = combatants.len();
    if let Some(observed) = native
        .snapshot
        .create_claim
        .as_ref()
        .and_then(|claim| claim.observed_generation.as_ref())
    {
        if request.generation_id() != Some(observed.generation_id.as_str()) {
            return Err(stale());
        }
    }
    if let Some(accepted) = native.role_response {
        // Already accepted data is local readback; neither capability nor network
        // response uncertainty can authorize a second role POST.
        return Ok(RoleInput {
            wire: Vec::new(),
            count,
            accepted: Some(accepted),
        });
    }
    role_ready(&native.snapshot)?;
    let mut projected = Vec::with_capacity(count);
    for raw in combatants {
        // Opaque wrapper extensions can contain lone UTF-16 keys or repeated
        // unknown members. Select only the shared projection's keys, preserving
        // JSON.parse last-member semantics without decoding any card data.
        let fields = story_pending::raw_projection_fields(
            raw,
            &[
                "type",
                "data",
                "isPreset",
                "filename",
                "sourceDataCardId",
                "dataCardId",
                "roomCombatantKey",
                "arenaRoomKey",
            ],
        )
        .map_err(storage_error)?;
        let mut item: BTreeMap<&str, Box<RawValue>> = BTreeMap::new();
        let kind = fields.get("type").ok_or_else(invalid)?;
        let data = fields.get("data").ok_or_else(invalid)?;
        if !kind.get().starts_with('"') || !data.get().starts_with('{') {
            return Err(invalid());
        }
        item.insert("type", (*kind).to_owned());
        item.insert("data", (*data).to_owned());
        if let Some(value) = fields.get("isPreset") {
            if !matches!(value.get(), "true" | "false") {
                return Err(invalid());
            }
            item.insert("isPreset", (*value).to_owned());
        }
        // Mirror the existing projectArenaReconciliationCombatants projection.
        // Only public matching hints are trimmed; card JSON stays byte-exact RawValue.
        if let Some(value) = fields.get("filename").and_then(|v| trimmed_hint(v)) {
            item.insert("filename", value);
        }
        if let Some(value) = fields.get("sourceDataCardId").and_then(|v| trimmed_hint(v)) {
            item.insert("sourceDataCardId", value);
        } else if let Some(value) = fields.get("dataCardId").and_then(|v| trimmed_hint(v)) {
            item.insert("dataCardId", value);
        }
        if let Some(value) = fields
            .get("roomCombatantKey")
            .and_then(|v| trimmed_hint(v))
            .or_else(|| fields.get("arenaRoomKey").and_then(|v| trimmed_hint(v)))
        {
            item.insert("roomCombatantKey", value);
        }
        projected.push(item);
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Wire<'a> {
        generation_id: &'a str,
        combatants: Vec<BTreeMap<&'a str, Box<RawValue>>>,
    }
    let wire = serde_json::to_vec(&Wire {
        generation_id: request.generation_id().ok_or_else(invalid)?,
        combatants: projected,
    })
    .map_err(|_| invalid())?;
    if wire.len() > INPUT_BYTES {
        return Err(invalid());
    }
    Ok(RoleInput {
        wire,
        count,
        accepted: None,
    })
}
pub(super) fn recheck_role(state: &ArenaState, request: &ArenaRequest) -> Result<(), ArenaError> {
    let (_, _, a) = request.scope();
    let key = key(request)?;
    let guard = state
        .stories
        .pending_admission(key.product)
        .map_err(storage_error)?;
    let snapshot = state
        .stories
        .pending_describe_admitted(&guard)
        .map_err(storage_error)?
        .ok_or_else(stale)?;
    exact_snapshot(&snapshot, request)?;
    if snapshot.manifest.actor != actor(a) {
        return Err(stale());
    }
    role_ready(&snapshot)
}
