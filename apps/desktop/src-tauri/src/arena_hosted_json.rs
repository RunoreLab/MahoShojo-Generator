//! C2 transport validation only. Business report semantics remain the shared TS contract.
//! RawValue preserves legal JSON lone-surrogate escapes without a second parsed report tree.
use super::*;
use serde_json::value::RawValue;

pub(super) const CREATE_PATH: &str = "/api/generate-battle-story";
pub(super) const PROTOCOL_HEADER: &str = "x-mahoshojo-arena-companion-protocol";
pub(super) const PROTOCOL_VERSION: &str = "arena-companion-v1";
const WIRE_BYTES: usize = 76_711_888;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope<'a> {
    #[serde(borrow)]
    version: &'a RawValue,
    body: &'a RawValue,
    metadata: &'a RawValue,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SuccessBody<'a> {
    #[serde(borrow)]
    report: &'a RawValue,
    updated_combatants: &'a RawValue,
    generation_id: &'a RawValue,
    adjudication_results: Option<&'a RawValue>,
    impacts: Option<&'a RawValue>,
}
fn object(raw: &RawValue) -> bool {
    raw.get().starts_with('{')
}
fn array(raw: &RawValue) -> bool {
    raw.get().starts_with('[')
}
fn identity(raw: &RawValue) -> Result<String, ArenaError> {
    if raw.get().len() > 1024 {
        return Err(protocol());
    }
    serde_json::from_str(raw.get()).map_err(|_| protocol())
}

// Already-validated JSON string escapes are counted without converting lone surrogate
// code units into Rust String or allocating another diagnostic value.
fn escaped_unit(chars: &mut std::str::Chars<'_>) -> Result<u16, ArenaError> {
    Ok(match chars.next().ok_or_else(protocol)? {
        'u' => {
            let mut n = 0;
            for _ in 0..4 {
                n = (n << 4)
                    | chars
                        .next()
                        .and_then(|c| c.to_digit(16))
                        .ok_or_else(protocol)? as u16;
            }
            n
        }
        '"' => b'"' as u16,
        '\\' => b'\\' as u16,
        '/' => b'/' as u16,
        'b' => 8,
        'f' => 12,
        'n' => 10,
        'r' => 13,
        't' => 9,
        _ => return Err(protocol()),
    })
}
fn public_text(raw: &RawValue) -> bool {
    let raw = raw.get();
    if !raw.starts_with('"') || !raw.ends_with('"') {
        return false;
    }
    let mut chars = raw[1..raw.len() - 1].chars();
    let mut count = 0;
    while let Some(c) = chars.next() {
        count += if c == '\\' {
            if escaped_unit(&mut chars).is_err() {
                return false;
            }
            1
        } else {
            c.len_utf16()
        };
        if count > 2048 {
            return false;
        }
    }
    true
}
/// A small, finite public error map. Free text stays borrowed raw so all JS strings survive.
fn validate_error(raw: &RawValue, flight: &Arc<Mutex<Flight>>) -> Result<bool, ArenaError> {
    if raw.get().len() > HEADER_BYTES {
        return Err(protocol());
    }
    let map: std::collections::BTreeMap<String, &RawValue> =
        serde_json::from_str(raw.get()).map_err(|_| protocol())?;
    if !map.contains_key("code") && !map.contains_key("error") {
        return Err(protocol());
    }
    for (key, v) in &map {
        let valid = match key.as_str() {
            "generationId" => identity(v).is_ok_and(|s| generation_id_valid(&s)),
            "generationRequestId" => identity(v).is_ok_and(|s| request_id_valid(&s)),
            "code" => identity(v).is_ok_and(|s| public_code_valid(&s)),
            "error" | "message" => public_text(v),
            "status" => identity(v).is_ok_and(|s| status_valid(&s) || s == "cancelling"),
            "cancelled" | "resumable" | "finalAuthoritative" | "resultAvailable"
            | "replayUnavailable" => matches!(v.get(), "true" | "false"),
            "lastEventId" => v.get() == "null" || identity(v).is_ok_and(|s| cursor_valid(&s)),
            "updatedAt" => identity(v).is_ok_and(|s| timestamp_valid(&s)),
            "resultRef" => v.get() == "null" || public_text(v),
            "persistenceWarning" => identity(v).is_ok_and(|s| {
                matches!(
                    s.as_str(),
                    "OUTPUT_NOT_ARCHIVED" | "PERSISTENCE_UNAVAILABLE"
                )
            }),
            "contentRetention" => identity(v).is_ok_and(|s| s == "expired"),
            _ => false,
        };
        if !valid {
            return Err(protocol());
        }
    }
    let f = flight.lock().map_err(|_| stale())?;
    if map
        .get("generationRequestId")
        .is_some_and(|v| identity(v).is_ok_and(|id| id != f.request_id))
        || map.get("generationId").is_some_and(|v| {
            identity(v).is_ok_and(|id| f.generation_id.as_deref() != Some(id.as_str()))
        })
    {
        return Err(protocol());
    }
    Ok(map.contains_key("generationId")
        && map
            .get("status")
            .is_some_and(|v| identity(v).is_ok_and(|s| terminal_status(&s))))
}
pub(super) fn validate_envelope(
    raw: &str,
    success: bool,
    flight: &Arc<Mutex<Flight>>,
) -> Result<bool, ArenaError> {
    let envelope: Envelope<'_> = serde_json::from_str(raw).map_err(|_| protocol())?;
    if identity(envelope.version)? != PROTOCOL_VERSION
        || (!object(envelope.metadata) && (success || envelope.metadata.get() != "null"))
    {
        return Err(protocol());
    }
    let terminal = if success {
        let body: SuccessBody<'_> =
            serde_json::from_str(envelope.body.get()).map_err(|_| protocol())?;
        let id = identity(body.generation_id)?;
        let empty = body
            .updated_combatants
            .get()
            .chars()
            .filter(|c| !c.is_ascii_whitespace())
            .eq("[]".chars());
        if !generation_id_valid(&id)
            || !object(body.report)
            || !empty
            || body.adjudication_results.is_some_and(|v| !array(v))
            || body.impacts.is_some_and(|v| !array(v))
            || flight.lock().map_err(|_| stale())?.generation_id.as_deref() != Some(id.as_str())
        {
            return Err(protocol());
        }
        true
    } else {
        validate_error(envelope.body, flight)?
    };
    reject_json_secret_echo(raw, flight)?;
    Ok(terminal)
}

// A lexical security filter over already serde-validated JSON, not a second JSON parser.
// Decode only JSON string escapes into UTF-16 matcher units; never allocate decoded strings,
// replace unpaired surrogates, concatenate across strings, or retain a second report tree.
struct SecretMatcher {
    units: Vec<u16>,
    prefix: Vec<usize>,
    matched: usize,
}
impl SecretMatcher {
    fn new(secret: &str) -> Self {
        let units: Vec<u16> = secret.encode_utf16().collect();
        let mut prefix = vec![0; units.len()];
        for i in 1..units.len() {
            let mut j = prefix[i - 1];
            while j > 0 && units[i] != units[j] {
                j = prefix[j - 1];
            }
            if units[i] == units[j] {
                j += 1;
            }
            prefix[i] = j;
        }
        Self {
            units,
            prefix,
            matched: 0,
        }
    }
    fn push(&mut self, unit: u16) -> bool {
        while self.matched > 0 && self.units[self.matched] != unit {
            self.matched = self.prefix[self.matched - 1];
        }
        if self.units[self.matched] == unit {
            self.matched += 1;
        }
        self.matched == self.units.len()
    }
}
fn reject_json_secret_echo(raw: &str, flight: &Arc<Mutex<Flight>>) -> Result<(), ArenaError> {
    let mut patterns: Vec<SecretMatcher> = {
        let f = flight.lock().map_err(|_| stale())?;
        let mut values: Vec<&str> = f.secrets_to_redact.iter().map(String::as_str).collect();
        // The cookie value and bootstrap UUID are independently usable credentials too.
        if let Some(cookie) = &f.cookie {
            values.extend(
                cookie
                    .split(';')
                    .filter_map(|part| part.trim().split_once('=').map(|(_, value)| value)),
            );
        }
        if let Some(record) = &f.anonymous {
            values.extend(record.bootstrap.strip_prefix("bootstrap."));
        }
        values
            .into_iter()
            .filter(|s| !s.is_empty())
            .map(SecretMatcher::new)
            .collect()
    };
    let mut chars = raw.chars();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if !in_string {
            if c == '"' {
                in_string = true;
                for p in &mut patterns {
                    p.matched = 0;
                }
            }
            continue;
        }
        if c == '"' {
            in_string = false;
            continue;
        }
        let mut buffer = [0; 2];
        let units: &[u16] = if c == '\\' {
            buffer[0] = escaped_unit(&mut chars)?;
            &buffer[..1]
        } else {
            c.encode_utf16(&mut buffer)
        };
        for &unit in units {
            for pattern in &mut patterns {
                if pattern.push(unit) {
                    return Err(protocol());
                }
            }
        }
    }
    Ok(())
}

async fn read_wire(
    response: reqwest::Response,
    check_scope: impl Fn() -> Result<(), ArenaError>,
) -> Result<String, ArenaError> {
    let declared = response.content_length().unwrap_or(0);
    if declared > WIRE_BYTES as u64 {
        return Err(error(
            "output-too-large",
            "Arena 完整报告超过受支持传输预算，可恢复原请求正文",
        ));
    }
    let mut bytes = Vec::with_capacity((declared as usize).min(WIRE_BYTES));
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| network())?;
        check_scope()?;
        let length = bytes.len().checked_add(chunk.len()).ok_or_else(protocol)?;
        if length > WIRE_BYTES {
            return Err(error(
                "output-too-large",
                "Arena 完整报告超过受支持传输预算，可恢复原请求正文",
            ));
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

pub(super) struct Delivery<'a> {
    pub state: &'a ArenaState,
    pub cloud: &'a CloudState,
    pub secrets: &'a dyn SecretStore,
    pub product: Product,
    pub flight: &'a Arc<Mutex<Flight>>,
    pub token: &'a CancellationToken,
    pub request_id: &'a str,
    pub sink: &'a dyn EventSink,
}
pub(super) struct ResponseIdentity {
    pub generation_id: Option<String>,
    pub generation_request_id: Option<String>,
    pub payload_hash: Option<String>,
}
pub(super) async fn deliver(
    delivery: Delivery<'_>,
    response: reqwest::Response,
    identity: ResponseIdentity,
) -> Result<(), ArenaError> {
    let Delivery {
        state,
        cloud,
        secrets,
        product,
        flight,
        token,
        request_id,
        sink,
    } = delivery;
    let ResponseIdentity {
        generation_id,
        generation_request_id,
        payload_hash,
    } = identity;
    // Outer select cannot interrupt synchronous validation or a synchronous EventSink callback.
    // Fence the exact captured subscription, never a later replacement in Flight.subscription.
    let check = || {
        state.is_current(product, flight, cloud, secrets)?;
        if token.is_cancelled() {
            return Err(error("detached", "本机订阅已关闭，未请求服务器停止"));
        }
        Ok(())
    };
    let status = response.status().as_u16();
    let success = (200..300).contains(&status);
    if response
        .headers()
        .get(PROTOCOL_HEADER)
        .and_then(|v| v.to_str().ok())
        != Some(PROTOCOL_VERSION)
        || response.headers().contains_key("x-mahoshojo-stream-meta")
        || response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_none_or(|v| v.split(';').next().map(str::trim) != Some("application/json"))
        || (success
            && (generation_id.is_none() || generation_request_id.as_deref() != Some(request_id)))
    {
        return Err(protocol());
    }
    let wire = read_wire(response, check).await?;
    check()?;
    let terminal = validate_envelope(&wire, success, flight)?;
    check()?;
    let recovery_credential_state = flight.lock().map_err(|_| stale())?.credential_state();
    emit(
        sink,
        ChannelEvent::JsonResponse {
            request_id: request_id.to_string(),
            sequence: 0,
            status,
            generation_id,
            generation_request_id,
            payload_hash,
            recovery_credential_state,
        },
        flight,
    )?;
    let mut sequence = 1;
    let mut start = 0;
    while start < wire.len() {
        check()?;
        let mut end = (start + IPC_TEXT_BYTES).min(wire.len());
        while !wire.is_char_boundary(end) {
            end -= 1;
        }
        emit(
            sink,
            ChannelEvent::JsonFragment {
                request_id: request_id.to_string(),
                sequence,
                text: wire[start..end].to_string(),
                r#final: end == wire.len(),
            },
            flight,
        )?;
        sequence += 1;
        start = end;
    }
    check()?;
    emit(
        sink,
        ChannelEvent::JsonEnd {
            request_id: request_id.to_string(),
            sequence,
        },
        flight,
    )?;
    // HTTP success with the matching finite companion envelope proves producer completion;
    // the renderer still validates the entire shared report contract before exposing a result.
    check()?;
    if terminal {
        flight.lock().map_err(|_| stale())?.terminal = true;
    }
    Ok(())
}
