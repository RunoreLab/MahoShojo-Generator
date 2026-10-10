//! Fixed Next reconciliation only. No model/provider, arbitrary target, or new credential slot.
//! Response JSON is validated in full before any IPC; the C2 report parser is never involved.
use super::*;
use serde_json::value::RawValue;

pub(super) const ORIGIN: &str = "https://mahoshojo.colanns.me";
pub(super) const PATH: &str = "/api/arena/update-combatants-after-stream";
pub(super) const PROTOCOL_HEADER: &str = "x-mahoshojo-arena-reconciliation-protocol";
pub(super) const PROTOCOL_VERSION: &str = "arena-reconciliation-v1";
pub(super) const WIRE_BYTES: usize = 16 * 1024 * 1024;
const MAX_COMBATANTS: usize = 32;
const MAX_ISSUES: usize = 96;

#[derive(Clone, Copy, Deserialize)]
pub enum Version {
    #[serde(rename = "arena-reconciliation-v1")]
    V1,
}

pub(super) fn validate_input(generation_id: &str, combatants: &[Value]) -> Result<(), ArenaError> {
    if combatants.is_empty() || combatants.len() > MAX_COMBATANTS {
        return Err(invalid());
    }
    for value in combatants {
        let map = value.as_object().ok_or_else(invalid)?;
        if map.keys().any(|k| {
            ![
                "type",
                "data",
                "isPreset",
                "filename",
                "sourceDataCardId",
                "dataCardId",
                "roomCombatantKey",
            ]
            .contains(&k.as_str())
        }) || !map.get("data").is_some_and(Value::is_object)
            || !map.get("type").is_some_and(Value::is_string)
            || map.get("isPreset").is_some_and(|v| !v.is_boolean())
        {
            return Err(invalid());
        }
        for key in [
            "filename",
            "sourceDataCardId",
            "dataCardId",
            "roomCombatantKey",
        ] {
            if map.get(key).is_some_and(|v| !v.is_string()) {
                return Err(invalid());
            }
        }
    }
    if serialized_size(&json!({"generationId":generation_id,"combatants":combatants}))?
        > INPUT_BYTES
    {
        return Err(invalid());
    }
    Ok(())
}

pub(super) async fn capability(
    state: &ArenaState,
    product: Product,
    flight: &Arc<Mutex<Flight>>,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
) -> Result<(), ArenaError> {
    state.is_current(product, flight, cloud, secrets)?;
    probe_capability(state).await?;
    state.is_current(product, flight, cloud, secrets)?;
    Ok(())
}
pub(super) async fn probe_capability(state: &ArenaState) -> Result<(), ArenaError> {
    // Never cached: a server rollback must close the gate on every new POST.
    // This client has no cookie store or default authorization headers.
    let response = state
        .http
        .get(format!("{}{PATH}", state.reconciliation_origin))
        .timeout(SHORT_TIMEOUT)
        .send()
        .await
        .map_err(|_| unavailable())?;
    if response.status().as_u16() != 200 || !json_content_type(&response) {
        return Err(unavailable());
    }
    let value = read_json(response, HEADER_BYTES)
        .await
        .map_err(|_| unavailable())?;
    if value
        != json!({
            "ok":true,
            "contractVersion":PROTOCOL_VERSION,
            "expectedUserIdAssertion":"v1",
            "ownership":"generation-actor",
            "effects":"frozen-manifest-v1"
        })
    {
        return Err(unavailable());
    }
    Ok(())
}
fn unavailable() -> ArenaError {
    error(
        "reconciliation-capability-unavailable",
        "角色更新服务能力未确认，保留原报告与角色",
    )
}
fn json_content_type(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(';').next().map(str::trim) == Some("application/json"))
}
fn authenticated(
    state: &ArenaState,
    flight: &Arc<Mutex<Flight>>,
) -> Result<reqwest::RequestBuilder, ArenaError> {
    let f = flight.lock().map_err(|_| stale())?;
    let builder = state
        .http
        .post(format!("{}{PATH}", state.reconciliation_origin))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION);
    match &f.actor {
        Actor::Account { expected_user_id } => Ok(builder
            .header(
                reqwest::header::COOKIE,
                f.cookie.as_deref().ok_or_else(stale)?,
            )
            .header(EXPECTED_USER_HEADER, format!("v1:{expected_user_id}"))),
        Actor::Anonymous => {
            let record = f.anonymous.as_ref().ok_or_else(storage)?;
            validate_anonymous_lifetime(record)?;
            // Bootstrap is only for the original Hono lookup, where a signed original token
            // can be recovered. Next must never issue a new actor or use the current login.
            let token = record.token.as_deref().ok_or_else(|| {
                error(
                    "recovery-unavailable",
                    "原匿名生成令牌未恢复，角色更新未派发",
                )
            })?;
            if token.is_empty()
                || token.len() > 6 * 1024
                || !token
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            {
                return Err(error(
                    "recovery-unavailable",
                    "原匿名生成令牌无效，角色更新未派发",
                ));
            }
            Ok(builder.header(ACTOR_HEADER, token))
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Success<'a> {
    version: String,
    generation_id: String,
    success: bool,
    #[serde(borrow)]
    updated_combatants: Vec<Update<'a>>,
    #[serde(borrow)]
    warnings: Vec<Issue<'a>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Update<'a> {
    combatant_index: usize,
    #[serde(borrow)]
    data: &'a RawValue,
    is_native: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Failure<'a> {
    version: String,
    #[serde(default, deserialize_with = "non_null")]
    generation_id: Option<String>,
    code: String,
    #[serde(borrow)]
    error: &'a RawValue,
    #[serde(default, borrow, deserialize_with = "optional_issues")]
    errors: Option<Vec<Issue<'a>>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Issue<'a> {
    code: String,
    #[serde(borrow)]
    message: &'a RawValue,
    #[serde(default, deserialize_with = "non_null")]
    combatant_index: Option<usize>,
    #[serde(default, deserialize_with = "non_null")]
    roster_index: Option<usize>,
    #[serde(default, borrow, deserialize_with = "present_raw")]
    character_name: Option<&'a RawValue>,
}
fn present_raw<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<&'de RawValue>, D::Error> {
    <&'de RawValue>::deserialize(d).map(Some)
}
fn optional_issues<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<Issue<'de>>>, D::Error> {
    Vec::<Issue<'de>>::deserialize(d).map(Some)
}
fn string(raw: &RawValue) -> bool {
    raw.get().starts_with('"')
}
fn nullable_string(raw: &RawValue) -> bool {
    raw.get() == "null" || string(raw)
}
fn validate_issues(issues: &[Issue<'_>], count: usize) -> Result<(), ArenaError> {
    if issues.len() > MAX_ISSUES {
        return Err(protocol());
    }
    for issue in issues {
        if !string(issue.message) {
            return Err(protocol());
        }
        let valid = match issue.code.as_str() {
            "ARENA_RECONCILIATION_COMBATANT_UNMATCHED" => {
                issue.combatant_index.is_some_and(|i| i < count)
                    && issue.roster_index.is_none()
                    && issue.character_name.is_none()
            }
            "ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING" => {
                issue.roster_index.is_some_and(|i| i < MAX_COMBATANTS)
                    && issue.combatant_index.is_none()
                    && issue.character_name.is_some_and(nullable_string)
            }
            "ARENA_RECONCILIATION_IMPACT_AMBIGUOUS" => {
                issue.combatant_index.is_none()
                    && issue.roster_index.is_none()
                    && issue.character_name.is_some_and(nullable_string)
            }
            _ => false,
        };
        if !valid {
            return Err(protocol());
        }
    }
    Ok(())
}
#[derive(Deserialize)]
struct NativeSignature {
    signature: String,
}
pub(super) fn validate_response(
    raw: &str,
    success: bool,
    generation_id: &str,
    count: usize,
) -> Result<(), ArenaError> {
    if count == 0 || count > MAX_COMBATANTS || raw.len() > WIRE_BYTES {
        return Err(protocol());
    }
    if success {
        let envelope: Success<'_> = serde_json::from_str(raw).map_err(|_| protocol())?;
        if envelope.version != PROTOCOL_VERSION
            || envelope.generation_id != generation_id
            || !envelope.success
            || envelope.updated_combatants.len() > count
        {
            return Err(protocol());
        }
        let mut indexes = [false; MAX_COMBATANTS];
        for update in &envelope.updated_combatants {
            if update.combatant_index >= count
                || update.combatant_index >= MAX_COMBATANTS
                || indexes[update.combatant_index]
                || !update.data.get().starts_with('{')
            {
                return Err(protocol());
            }
            indexes[update.combatant_index] = true;
            if update.is_native {
                let signed: NativeSignature =
                    serde_json::from_str(update.data.get()).map_err(|_| protocol())?;
                if signed
                    .signature
                    .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
                    .is_empty()
                {
                    return Err(protocol());
                }
            }
        }
        validate_issues(&envelope.warnings, count)?;
    } else {
        let envelope: Failure<'_> = serde_json::from_str(raw).map_err(|_| protocol())?;
        if envelope.version != PROTOCOL_VERSION
            || envelope
                .generation_id
                .as_deref()
                .is_some_and(|id| id != generation_id)
            || envelope.code.is_empty()
            || !string(envelope.error)
            || envelope.error.get().len() <= 2
        {
            return Err(protocol());
        }
        if let Some(issues) = &envelope.errors {
            validate_issues(issues, count)?;
        }
    }
    Ok(())
}

async fn read_wire(
    response: reqwest::Response,
    check: impl Fn() -> Result<(), ArenaError>,
) -> Result<String, ArenaError> {
    let too_large = || {
        error(
            "reconciliation-output-too-large",
            "角色更新超过 16 MiB，保留原报告与角色",
        )
    };
    let declared = response.content_length().unwrap_or(0);
    if declared > WIRE_BYTES as u64 {
        return Err(too_large());
    }
    let mut bytes = Vec::with_capacity((declared as usize).min(WIRE_BYTES));
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| network())?;
        check()?;
        let length = bytes.len().checked_add(chunk.len()).ok_or_else(too_large)?;
        if length > WIRE_BYTES {
            return Err(too_large());
        }
        if length > bytes.capacity() {
            let capacity = bytes
                .capacity()
                .saturating_mul(2)
                .max(length)
                .min(WIRE_BYTES);
            bytes.reserve_exact(capacity - bytes.len());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| protocol())
}

pub(super) async fn run(
    state: &ArenaState,
    cloud: &CloudState,
    secrets: &dyn SecretStore,
    request: ArenaRequest,
    sink: &dyn EventSink,
) -> Result<(), ArenaError> {
    let (product, request_id, _) = request.scope();
    let request_id = request_id.to_string();
    let generation_id = request.generation_id().ok_or_else(invalid)?.to_string();
    let is_story = matches!(&request, ArenaRequest::ReconcileStory { .. });
    let input = if is_story {
        story::role_input(state, &request)?
    } else {
        let ArenaRequest::Reconcile { combatants, .. } = &request else {
            return Err(invalid());
        };
        validate_input(&generation_id, combatants)?;
        story::RoleInput {
            wire: serde_json::to_vec(
                &json!({"generationId":generation_id,"combatants":combatants}),
            )
            .map_err(|_| invalid())?,
            count: combatants.len(),
            accepted: None,
        }
    };
    let flight = state.prepare(&request, cloud, secrets)?;
    let token = Arc::new(CancellationToken::new());
    {
        let mut f = flight.lock().map_err(|_| stale())?;
        if f.subscription.is_some() {
            return Err(error("subscription-in-progress", "此请求已有本机订阅"));
        }
        f.subscription = Some(token.clone());
    }
    let _guard = SubscriptionGuard {
        flight: flight.clone(),
        token: token.clone(),
    };
    let check = || {
        state.is_current(product, &flight, cloud, secrets)?;
        if token.is_cancelled() {
            return Err(error(
                "detached",
                "本机角色订阅已关闭，服务器更新结果未撤销",
            ));
        }
        Ok(())
    };
    let mut dispatched = false;
    let operation = async {
        let (status, wire) = if let Some(accepted) = input.accepted.as_ref() {
            (200, accepted.clone())
        } else {
            state
                .capability(product, &flight, cloud, secrets, false, false)
                .await?;
            // Always bind through the original request. This also captures its signed token when
            // only bootstrap remains, without handing bootstrap to Next or minting another actor.
            let lookup = state.lookup_bound(product, &flight, cloud, secrets).await?;
            if lookup.status != 200 {
                return Err(error(
                    "generation-unavailable",
                    "原生成尚未找到，角色更新未派发",
                ));
            }
            state
                .bind_generation(product, &generation_id, &flight, cloud, secrets)
                .await?;
            capability(state, product, &flight, cloud, secrets).await?;
            check()?;
            if is_story {
                if lookup.body.get("status").and_then(Value::as_str) != Some("completed") {
                    return Err(error(
                        "generation-unavailable",
                        "原故事模型尚未确认完成，角色更新未派发",
                    ));
                }
                story::recheck_role(state, &request)?;
            }
            let builder = authenticated(state, &flight)?
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(input.wire.clone())
                .timeout(SHORT_TIMEOUT);
            check()?;
            dispatched = true;
            let response = builder.send().await.map_err(|_| network())?;
            check()?;
            let status = response.status().as_u16();
            if (300..400).contains(&status)
                || !json_content_type(&response)
                || response
                    .headers()
                    .get(PROTOCOL_HEADER)
                    .and_then(|v| v.to_str().ok())
                    != Some(PROTOCOL_VERSION)
            {
                return Err(protocol());
            }
            let wire = read_wire(response, check).await?;
            (status, wire)
        };
        check()?;
        validate_response(
            &wire,
            (200..300).contains(&status),
            &generation_id,
            input.count,
        )?;
        json_delivery::reject_json_secret_echo(&wire, &flight)?;
        check()?;
        let recovery_credential_state = flight.lock().map_err(|_| stale())?.credential_state();
        emit(
            sink,
            ChannelEvent::JsonResponse {
                request_id: request_id.clone(),
                sequence: 0,
                status,
                generation_id: Some(generation_id.clone()),
                generation_request_id: Some(request_id.clone()),
                payload_hash: None,
                recovery_credential_state,
            },
            &flight,
        )?;
        let mut start = 0;
        let mut sequence = 1;
        while start < wire.len() {
            check()?;
            let mut end = (start + IPC_TEXT_BYTES).min(wire.len());
            while !wire.is_char_boundary(end) {
                end -= 1;
            }
            emit(
                sink,
                ChannelEvent::JsonFragment {
                    request_id: request_id.clone(),
                    sequence,
                    text: wire[start..end].to_string(),
                    r#final: end == wire.len(),
                },
                &flight,
            )?;
            start = end;
            sequence += 1;
        }
        check()?;
        emit(
            sink,
            ChannelEvent::JsonEnd {
                request_id: request_id.clone(),
                sequence,
            },
            &flight,
        )?;
        check()?;
        // This operation does not change generation terminal state or its report/replay budget.
        Ok(())
    };
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(error("detached", "本机角色订阅已关闭，服务器更新结果未撤销")),
        result = operation => result,
    };
    result.map_err(|mut e| {
        if dispatched {
            e.dispatch_state = "unknown";
        }
        e
    })
}
