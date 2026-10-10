//! Real production transport + synthetic loopback; no OS keyring, remote endpoint or Tauri facade.
use super::*;
use crate::secret::SecretStoreError;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const RID: &str = "arena_request_1234";
const KEY: &str = "SYNTHETIC-PROVIDER-KEY-CANARY";
const COOKIE: &str = "better-auth.session_token=SYNTHETIC-COOKIE-CANARY";
fn gid() -> String {
    format!("arena_{}", "a".repeat(64))
}
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-arena-hosted.json"
    ))
    .unwrap()
}
#[derive(Default)]
struct Secrets {
    values: Mutex<HashMap<String, String>>,
    fail_set: AtomicBool,
    fail_resolve: AtomicBool,
}
impl SecretStore for Secrets {
    fn set(&self, k: &str, v: &str) -> Result<(), SecretStoreError> {
        if self.fail_set.load(Ordering::SeqCst) {
            return Err(SecretStoreError::failure_for_test());
        }
        self.values
            .lock()
            .unwrap()
            .insert(k.to_string(), v.to_string());
        Ok(())
    }
    fn resolve(&self, k: &str) -> Result<Option<String>, SecretStoreError> {
        if self.fail_resolve.load(Ordering::SeqCst) {
            return Err(SecretStoreError::failure_for_test());
        }
        Ok(self.values.lock().unwrap().get(k).cloned())
    }
    fn exists(&self, k: &str) -> Result<bool, SecretStoreError> {
        Ok(self.values.lock().unwrap().contains_key(k))
    }
    fn delete(&self, k: &str) -> Result<(), SecretStoreError> {
        self.values.lock().unwrap().remove(k);
        Ok(())
    }
}
fn login(secrets: &Secrets, user: u64) {
    secrets.set("account-session:web-v1",&json!({"cookie":COOKIE,"sessionExpiresAt":null,"account":{"userId":user,"username":"synthetic","displayName":null}}).to_string()).unwrap();
}
#[derive(Default)]
struct Sink {
    events: Mutex<Vec<Value>>,
}
impl EventSink for Sink {
    fn send(&self, event: ChannelEvent) -> Result<(), ArenaError> {
        self.events
            .lock()
            .unwrap()
            .push(serde_json::to_value(event).unwrap());
        Ok(())
    }
}
impl Sink {
    fn wire(&self) -> String {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|v| v["kind"] == "sse-fragment")
            .map(|v| v["text"].as_str().unwrap())
            .collect()
    }
}
#[derive(Clone)]
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}
struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
    delay: Duration,
}
impl Reply {
    fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: body.to_string(),
            delay: Duration::ZERO,
        }
    }
    fn sse(body: String) -> Self {
        Self {
            status: 200,
            headers: vec![
                ("Content-Type".into(), "text/event-stream".into()),
                ("X-Mahoshojo-Generation-Id".into(), gid()),
                ("X-Mahoshojo-Generation-Request-Id".into(), RID.into()),
            ],
            body,
            delay: Duration::ZERO,
        }
    }
}
struct Server {
    origin: String,
    requests: Arc<Mutex<Vec<Request>>>,
    task: tokio::task::JoinHandle<()>,
}
async fn server(
    count: usize,
    handler: impl Fn(usize, &Request) -> Reply + Send + Sync + 'static,
) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = requests.clone();
    let task = tokio::spawn(async move {
        for i in 0..count {
            let (mut stream, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept())
                .await
                .unwrap()
                .unwrap();
            let mut bytes = Vec::new();
            let header_end;
            loop {
                let mut chunk = [0u8; 4096];
                let n = stream.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = i + 4;
                    break;
                }
            }
            let text = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
            let mut lines = text.lines();
            let mut first = lines.next().unwrap().split_whitespace();
            let method = first.next().unwrap().to_string();
            let path = first.next().unwrap().to_string();
            let headers: HashMap<String, String> = lines
                .filter_map(|l| {
                    l.split_once(':')
                        .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_string()))
                })
                .collect();
            let length = headers
                .get("content-length")
                .map(|s| s.parse::<usize>().unwrap())
                .unwrap_or(0);
            while bytes.len() < header_end + length {
                let mut chunk = [0u8; 4096];
                let n = stream.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                bytes.extend_from_slice(&chunk[..n]);
            }
            let request = Request {
                method,
                path,
                headers,
                body: String::from_utf8(bytes[header_end..header_end + length].to_vec()).unwrap(),
            };
            let reply = handler(i, &request);
            seen.lock().unwrap().push(request);
            if !reply.delay.is_zero() {
                tokio::time::sleep(reply.delay).await;
            }
            let mut head = format!(
                "HTTP/1.1 {} Test\r\nContent-Length: {}\r\nConnection: close\r\n",
                reply.status,
                reply.body.len()
            );
            for (k, v) in reply.headers {
                head.push_str(&format!("{k}: {v}\r\n"));
            }
            head.push_str("\r\n");
            let _ = stream.write_all(head.as_bytes()).await;
            let _ = stream.write_all(reply.body.as_bytes()).await;
        }
    });
    Server {
        origin,
        requests,
        task,
    }
}
fn create(account: bool, byok: bool) -> ArenaRequest {
    let mut v = fixture()["validOperations"][0].clone();
    if !account {
        v["actor"] = json!({"kind":"anonymous"});
    }
    if byok {
        v["presetConfig"] = json!({"providerId":"kourichat","modelId":"gemini-3.8-flash"});
    }
    serde_json::from_value(v).unwrap()
}
fn operation(name: &str, account: bool) -> ArenaRequest {
    let mut v = json!({"operation":name,"product":"battle","requestId":RID,"actor":if account{json!({"kind":"account","expectedUserId":42})}else{json!({"kind":"anonymous"})}});
    if matches!(name, "resume" | "status") {
        v["generationId"] = json!(gid());
    }
    if name == "stop" {
        v["reason"] = json!("user");
    }
    serde_json::from_value(v).unwrap()
}
fn event(id: &str, name: &str, data: Value) -> String {
    format!("id: {id}\nevent: {name}\ndata: {data}\n\n")
}
fn standard_wire() -> String {
    event("1-0", "markdown", json!({"chunk":"正文🪄"}))
        + &event("2-0", "done", json!({"ok":true,"status":"completed"}))
}
fn capability() -> Reply {
    Reply::json(200, fixture()["capability"].clone())
}
fn status(status: &str) -> Reply {
    Reply::json(
        200,
        json!({"generationId":gid(),"generationRequestId":RID,"status":status,"resumable":status=="running","lastEventId":"1-0","updatedAt":"2026-10-10T00:00:00.000Z"}),
    )
}
fn token_reply(mut reply: Reply, request: &Request) -> Reply {
    let bootstrap = request.headers.get(ACTOR_HEADER).unwrap();
    let anonymous_id = bootstrap.strip_prefix("bootstrap.").unwrap();
    let token=URL_SAFE_NO_PAD.encode(json!({"v":1,"anonymousId":anonymous_id,"issuedAt":"2026-10-10T00:00:00Z","expiresAt":time::OffsetDateTime::from_unix_timestamp((now_ms()/1000+3600)as i64).unwrap().format(&time::format_description::well_known::Rfc3339).unwrap(),"signature":"SYNTHETIC-SIGNATURE"}).to_string());
    reply.headers.push((ACTOR_HEADER.into(), token));
    reply
}
#[test]
fn fixture_operations_limits_and_all_server_event_families_match_native() {
    let f = fixture();
    for v in f["validOperations"].as_array().unwrap() {
        let r: ArenaRequest = serde_json::from_value(v.clone()).unwrap();
        r.validate().unwrap();
    }
    assert_eq!(f["limits"]["requestBodyBytes"], INPUT_BYTES);
    assert_eq!(f["limits"]["outputContentBytes"], OUTPUT_BYTES);
    assert_eq!(f["limits"]["eventWireBytes"], EVENT_BYTES);
    assert_eq!(f["limits"]["ipcTextBytes"], IPC_TEXT_BYTES);
    assert_eq!(f["limits"]["ipcEnvelopeBytes"], IPC_BYTES);
    let mut budget = Budget::default();
    for v in f["validSseEvents"].as_array().unwrap() {
        let wire = event(
            v["id"].as_str().unwrap(),
            v["event"].as_str().unwrap(),
            v["data"].clone(),
        );
        let mut parsed = parse_frame(&wire).unwrap().unwrap();
        assert!(budget.accept(&mut parsed).unwrap());
    }
}
#[tokio::test]
async fn real_loopback_four_identity_funding_combinations_create_only_keys() {
    for account in [false, true] {
        for byok in [false, true] {
            let srv = server(4, move |i, r| match i {
                0 => capability(),
                1 => {
                    if account {
                        Reply::sse(standard_wire())
                    } else {
                        token_reply(Reply::sse(standard_wire()), r)
                    }
                }
                2 => status("completed"),
                _ => Reply::json(
                    202,
                    json!({"generationId":gid(),"status":"cancelling","cancelled":true}),
                ),
            })
            .await;
            let secrets = Secrets::default();
            if account {
                login(&secrets, 42);
            }
            if byok {
                secrets.set("preset:kourichat:api-key", KEY).unwrap();
            }
            let state = ArenaState::with_origin(srv.origin.clone());
            let cloud = CloudState::new().unwrap();
            let sink = Sink::default();
            stream(&state, &cloud, &secrets, create(account, byok), &sink)
                .await
                .unwrap();
            control(
                &state,
                &cloud,
                &secrets,
                operation("lookup-request", account),
            )
            .await
            .unwrap();
            let stop = control(&state, &cloud, &secrets, operation("stop", account))
                .await
                .unwrap();
            assert_eq!(stop.status, 202);
            assert_eq!(stop.body["status"], "cancelling");
            srv.task.await.unwrap();
            let requests = srv.requests.lock().unwrap().clone();
            assert_eq!(requests[0].path, CAPABILITY_PATH);
            assert!(!requests[0].headers.contains_key("cookie"));
            assert!(!requests[0].headers.contains_key(ACTOR_HEADER));
            for (i, r) in requests.iter().enumerate() {
                if i > 0 {
                    assert_eq!(r.headers.contains_key("cookie"), account);
                    assert_eq!(r.headers.contains_key(EXPECTED_USER_HEADER), account);
                    assert_eq!(r.headers.contains_key(ACTOR_HEADER), !account);
                }
                assert_eq!(r.body.contains(KEY), i == 1 && byok);
            }
            assert!(requests[1].path.starts_with(CREATE_PATH));
            assert_eq!(requests[1].method, "POST");
            assert_eq!(requests[3].method, "DELETE");
            let raw = serde_json::to_string(&*sink.events.lock().unwrap()).unwrap();
            for secret in [KEY, COOKIE, "SYNTHETIC-SIGNATURE", "bootstrap."] {
                assert!(!raw.contains(secret));
            }
            assert!(sink.wire().contains("正文🪄"));
            assert_eq!(
                stream(
                    &state,
                    &cloud,
                    &secrets,
                    create(account, byok),
                    &Sink::default()
                )
                .await
                .unwrap_err()
                .code,
                "create-already-attempted"
            );
        }
    }
}
#[tokio::test]
async fn missing_capability_and_wrong_account_are_zero_create() {
    let srv = server(1, |_, _| {
        Reply::json(200, json!({"ok":true,"contractVersion":"g25e1-v1"}))
    })
    .await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let e = stream(
        &state,
        &cloud,
        &secrets,
        create(false, false),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(e.code, "capability-unavailable");
    assert_eq!(e.dispatch_state, "not-dispatched");
    srv.task.await.unwrap();
    assert_eq!(srv.requests.lock().unwrap().len(), 1);
    let state = ArenaState::with_origin("http://127.0.0.1:1".into());
    login(&secrets, 99);
    assert_eq!(
        stream(
            &state,
            &cloud,
            &secrets,
            create(true, false),
            &Sink::default()
        )
        .await
        .unwrap_err()
        .code,
        "scope-changed"
    );
}
#[tokio::test]
async fn restart_anonymous_under_logged_in_account_uses_original_token_without_cookie() {
    let srv = server(6, |i, r| match i {
        0 | 2 => capability(),
        1 => token_reply(
            Reply::sse(event("1-0", "markdown", json!({"chunk":"old"}))),
            r,
        ),
        3 => status("running"),
        4 => Reply::sse(standard_wire()),
        _ => status("completed"),
    })
    .await;
    let secrets = Secrets::default();
    let cloud = CloudState::new().unwrap();
    let old = ArenaState::with_origin(srv.origin.clone());
    stream(
        &old,
        &cloud,
        &secrets,
        create(false, false),
        &Sink::default(),
    )
    .await
    .unwrap();
    drop(old);
    let record = load_anonymous(Product::Battle, &secrets).unwrap().unwrap();
    let token = record.token.unwrap();
    login(&secrets, 42);
    let fresh = ArenaState::with_origin(srv.origin.clone());
    control(&fresh, &cloud, &secrets, operation("lookup-request", false))
        .await
        .unwrap();
    let sink = Sink::default();
    stream(&fresh, &cloud, &secrets, operation("resume", false), &sink)
        .await
        .unwrap();
    control(&fresh, &cloud, &secrets, operation("status", false))
        .await
        .unwrap();
    srv.task.await.unwrap();
    let requests = srv.requests.lock().unwrap().clone();
    assert_eq!(requests.iter().filter(|r| r.method == "POST").count(), 1);
    for r in &requests[3..] {
        assert_eq!(r.headers.get(ACTOR_HEADER), Some(&token));
        assert!(!r.headers.contains_key("cookie"));
        assert!(!r.body.contains(KEY));
    }
    assert!(!sink.wire().contains(&token));
}
#[tokio::test]
async fn key_or_login_changes_during_public_probe_abort_before_post() {
    for change_key in [false, true] {
        let secrets = Arc::new(Secrets::default());
        secrets.set("preset:kourichat:api-key", KEY).unwrap();
        let captured = secrets.clone();
        let srv = server(1, move |_, _| {
            if change_key {
                captured
                    .set("preset:kourichat:api-key", "NEW-SYNTHETIC-KEY")
                    .unwrap();
            } else {
                login(&captured, 99);
            }
            capability()
        })
        .await;
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let e = stream(
            &state,
            &cloud,
            secrets.as_ref(),
            create(false, true),
            &Sink::default(),
        )
        .await
        .unwrap_err();
        assert_eq!(e.code, "scope-changed");
        assert_eq!(e.dispatch_state, "not-dispatched");
        srv.task.await.unwrap();
        assert_eq!(srv.requests.lock().unwrap().len(), 1);
    }
}

#[test]
fn maximum_source_backed_snapshot_and_escaped_ipc_are_bounded_and_lossless() {
    let f = fixture();
    let recipe = &f["boundaryRecipes"]["snapshot"];
    let content = recipe["character"]
        .as_str()
        .unwrap()
        .repeat(recipe["repeat"].as_u64().unwrap() as usize);
    let raw = event(
        recipe["id"].as_str().unwrap(),
        "snapshot",
        json!({"status":"completed","markdown":content,"reasoning":"","lastEventId":null,"updatedAt":recipe["updatedAt"],"telemetry":{"version":1,"aiModel":"fixture-model"}}),
    );
    assert!(raw.len() <= EVENT_BYTES);
    assert!(raw.len() > 6 * OUTPUT_BYTES);
    let mut parser = ArenaParser::default();
    let mut events = Vec::new();
    for chunk in raw.as_bytes().chunks(65531) {
        events.extend(parser.push(chunk).unwrap());
    }
    parser.finish().unwrap();
    assert_eq!(events.len(), 1);
    let mut budget = Budget::default();
    assert!(budget.accept(&mut events[0]).unwrap());
    assert_eq!(budget.markdown_bytes, OUTPUT_BYTES);
    assert!(!budget.accept(&mut events[0]).unwrap()); // duplicate consumes no decoded budget
    let mut snapshot = parse_frame(&event(
        "9999999999999-1",
        "snapshot",
        events[0].data.clone(),
    ))
    .unwrap()
    .unwrap();
    assert!(budget.accept(&mut snapshot).unwrap());
    assert_eq!(budget.markdown_bytes, OUTPUT_BYTES);
    let mut overflow = parse_frame(&event("9999999999999-2", "reasoning", json!({"chunk":"!"})))
        .unwrap()
        .unwrap();
    assert_eq!(
        budget.accept(&mut overflow).unwrap_err().code,
        "output-too-large"
    );
    let state = ArenaState::isolated();
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let flight = state
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    let sink = Sink::default();
    let mut sequence = 0;
    emit_block(&sink, RID, &mut sequence, &raw, &flight).unwrap();
    assert_eq!(sink.wire(), raw);
    let envelopes = sink.events.lock().unwrap();
    for (i, v) in envelopes.iter().enumerate() {
        assert_eq!(v["sequence"], i);
        assert!(v["text"].as_str().unwrap().len() <= IPC_TEXT_BYTES);
        assert!(serde_json::to_vec(v).unwrap().len() <= IPC_BYTES);
        assert_eq!(v["final"], i + 1 == envelopes.len());
    }
    let escape = ChannelEvent::SseFragment {
        request_id: RID.into(),
        sequence: 0,
        text: "\u{1}".repeat(IPC_TEXT_BYTES),
        r#final: true,
    };
    let max_envelope = serde_json::to_vec(&escape).unwrap().len();
    assert!(max_envelope > 6 * IPC_TEXT_BYTES);
    assert!(max_envelope < IPC_BYTES);
    let unicode = "😀".repeat(IPC_TEXT_BYTES);
    let sink = Sink::default();
    emit_block(&sink, RID, &mut 0, &unicode, &flight).unwrap();
    assert_eq!(sink.wire(), unicode);
    eprintln!("ARENA_BOUNDARY snapshot_wire_bytes={} fragments={} max_ipc_serialized_bytes={} unicode_bytes={}",raw.len(),envelopes.len(),max_envelope,unicode.len());
}
#[test]
fn rejects_bad_cursor_partial_utf8_and_unknown_authority_fields() {
    for raw in [
        "id: bad\nevent: markdown\ndata: {\"chunk\":\"x\"}\n\n",
        "id: 1-0\nid: 2-0\nevent: markdown\ndata: {\"chunk\":\"x\"}\n\n",
        "id: 1-0\nevent: unknown\ndata: {}\n\n",
    ] {
        assert!(parse_frame(raw).is_err());
    }
    let mut p = ArenaParser::default();
    assert!(p
        .push(b"id: 1-0\nevent: markdown\ndata: {\"chunk\":\"")
        .unwrap()
        .is_empty());
    assert_eq!(p.finish().unwrap_err().code, "stream-truncated");
    let raw = event("1-0", "markdown", json!({"chunk":"🪄"}));
    for split in 0..raw.len() {
        let mut parser = ArenaParser::default();
        let mut parsed = parser.push(&raw.as_bytes()[..split]).unwrap();
        parsed.extend(parser.push(&raw.as_bytes()[split..]).unwrap());
        assert_eq!(parsed.len(), 1);
    }
    let mut value = fixture()["validOperations"][0].clone();
    for key in [
        "customProvider",
        "adjudicationResults",
        "generationRequestId",
        "roomId",
        "authority",
        "apiKey",
    ] {
        value["body"][key] = json!("CANARY");
        assert!(validate_body(&value["body"]).is_err());
        value["body"].as_object_mut().unwrap().remove(key);
    }
    for key in ["endpoint", "headers", "secretRef", "cookie", "apiKey"] {
        let mut v = fixture()["validOperations"][0].clone();
        v[key] = json!("CANARY");
        assert!(serde_json::from_value::<ArenaRequest>(v).is_err());
    }
    for slot in [Product::Battle.slot(), Product::Arena.slot()] {
        assert!(crate::provider_target::validate_provider_secret_ref_scope(slot).is_err());
    }
}
#[test]
fn optional_header_metadata_distinguishes_missing_invalid_oversized() {
    let mut h = reqwest::header::HeaderMap::new();
    assert_eq!(header_metadata(&h).1, "missing");
    h.insert("x-mahoshojo-stream-meta", "%GG".parse().unwrap());
    assert_eq!(header_metadata(&h).1, "invalid");
    h.insert(
        "x-mahoshojo-stream-meta",
        "x".repeat(HEADER_BYTES + 1).parse().unwrap(),
    );
    assert_eq!(header_metadata(&h).1, "oversized");
    h.insert("x-mahoshojo-stream-meta",percent_encoding::utf8_percent_encode(&json!({"reportFormat":"markdown","outputContract":"stream-markdown","userGuidance":"合成测试","cookie":"NEVER-EXPOSE"}).to_string(),percent_encoding::NON_ALPHANUMERIC).to_string().parse().unwrap());
    let (meta, status) = header_metadata(&h);
    assert_eq!(status, "available");
    assert_eq!(meta.as_ref().unwrap()["userGuidance"], "合成测试");
    assert!(!meta.unwrap().to_string().contains("NEVER-EXPOSE"));
}
#[tokio::test]
async fn unknown_initial_response_lookup_resume_and_cursor_never_reposts() {
    let srv=server(4,|i,_|match i{0=>capability(),1=>Reply::sse(event("1-0","markdown",json!({"chunk":"A"}))+"id: 2-0\nevent: markdown\ndata: {\"chunk\":\""),2=>status("running"),_=>Reply::sse(event("1-0","markdown",json!({"chunk":"A"}))+&event("2-0","snapshot",json!({"status":"completed","markdown":"AB","reasoning":"","lastEventId":"2-0","updatedAt":"2026-10-10T00:00:00Z"}))+&event("3-0","done",json!({"ok":true,"status":"completed"})))}).await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let first = Sink::default();
    let error = stream(&state, &cloud, &secrets, create(false, false), &first)
        .await
        .unwrap_err();
    assert_eq!(error.dispatch_state, "unknown");
    assert_eq!(error.code, "stream-truncated");
    control(&state, &cloud, &secrets, operation("lookup-request", false))
        .await
        .unwrap();
    let mut r = serde_json::to_value(&fixture()["validOperations"][3]).unwrap();
    r["actor"] = json!({"kind":"anonymous"});
    r["after"] = json!("1-0");
    let second = Sink::default();
    stream(
        &state,
        &cloud,
        &secrets,
        serde_json::from_value(r).unwrap(),
        &second,
    )
    .await
    .unwrap();
    assert!(second.wire().contains("id: 1-0")); // C0, not Native, owns renderer delivery deduplication
    assert!(second.wire().contains("AB"));
    srv.task.await.unwrap();
    let requests = srv.requests.lock().unwrap().clone();
    assert_eq!(requests.iter().filter(|r| r.method == "POST").count(), 1);
    assert!(requests[3].path.ends_with("/stream?after=1-0"));
}
#[tokio::test]
async fn stop_202_409_404_are_distinct_and_detach_never_stops_server() {
    let srv=server(5,|i,_|match i{0=>capability(),1=>Reply::sse(event("1-0","markdown",json!({"chunk":"partial"}))),2=>Reply::json(202,json!({"generationId":gid(),"status":"cancelling","cancelled":true})),3=>Reply::json(409,json!({"generationId":gid(),"status":"finalizing","cancelled":false,"code":"GENERATION_FINALIZATION_IN_PROGRESS"})),_=>Reply::json(404,json!({"code":"GENERATION_NOT_FOUND","error":KEY}))}).await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    stream(
        &state,
        &cloud,
        &secrets,
        create(false, false),
        &Sink::default(),
    )
    .await
    .unwrap();
    assert!(!detach(
        &state,
        DetachRequest {
            product: Product::Battle,
            request_id: RID.into()
        }
    )
    .unwrap());
    for expected in [202, 409, 404] {
        let response = control(&state, &cloud, &secrets, operation("stop", false))
            .await
            .unwrap();
        assert_eq!(response.status, expected);
        assert!(!response.body.to_string().contains(KEY));
    }
    assert!(
        !state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .terminal
    );
    srv.task.await.unwrap();
}
#[tokio::test]
async fn redirect_and_error_diagnostics_do_not_leak_or_follow() {
    let srv = server(2, |i, _| {
        if i == 0 {
            capability()
        } else {
            Reply {
                status: 307,
                headers: vec![("Location".into(), "http://127.0.0.1:1/secret-target".into())],
                body: KEY.into(),
                delay: Duration::ZERO,
            }
        }
    })
    .await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    let e = stream(&state, &cloud, &secrets, create(false, false), &sink)
        .await
        .unwrap_err();
    assert_eq!(e.code, "invalid-response");
    assert_eq!(e.dispatch_state, "unknown");
    assert!(!serde_json::to_string(&e).unwrap().contains(KEY));
    assert!(sink.events.lock().unwrap().is_empty());
    srv.task.await.unwrap();
    assert_eq!(srv.requests.lock().unwrap().len(), 2);
}
#[test]
fn persisted_actor_corruption_expiry_and_scope_cas_do_not_replace_credentials() {
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let state = ArenaState::isolated();
    let first = state
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    let raw = secrets.resolve(Product::Battle.slot()).unwrap().unwrap();
    let mut request = fixture()["validOperations"][0].clone();
    request["actor"] = json!({"kind":"anonymous"});
    request["requestId"] = json!("new_request_5678");
    request["replaceRequestId"] = json!("wrong_request_0000");
    assert!(state
        .prepare(
            &serde_json::from_value(request.clone()).unwrap(),
            &cloud,
            &secrets
        )
        .is_err());
    assert_eq!(
        secrets.resolve(Product::Battle.slot()).unwrap().unwrap(),
        raw
    );
    request["replaceRequestId"] = json!(RID);
    state
        .prepare(&serde_json::from_value(request).unwrap(), &cloud, &secrets)
        .unwrap();
    assert!(state
        .is_current(Product::Battle, &first, &cloud, &secrets)
        .is_err());
    let mut record = load_anonymous(Product::Battle, &secrets).unwrap().unwrap();
    record.first_dispatched_at = now_ms() - BOOTSTRAP_LIFETIME_MS - 1;
    assert_eq!(
        validate_anonymous_lifetime(&record).unwrap_err().code,
        "recovery-expired"
    );
    record.token = Some("expired-token".into());
    record.token_expires_at = Some(now_ms() - 1);
    assert_eq!(
        validate_anonymous_lifetime(&record).unwrap_err().code,
        "recovery-expired"
    );
    secrets.set(Product::Battle.slot(), "malformed").unwrap();
    assert!(load_anonymous(Product::Battle, &secrets).is_err());
    assert_eq!(
        secrets.resolve(Product::Battle.slot()).unwrap().as_deref(),
        Some("malformed")
    );
}
#[test]
fn input_twelve_mib_boundary_is_independent_from_provider_envelope() {
    let mut body = fixture()["validOperations"][0]["body"].clone();
    body["userGuidance"] = json!("");
    let overhead = serialized_size(&body).unwrap();
    body["userGuidance"] = json!("x".repeat(INPUT_BYTES - overhead));
    assert_eq!(serialized_size(&body).unwrap(), INPUT_BYTES);
    validate_body(&body).unwrap();
    body["userGuidance"].as_str().unwrap();
    body["userGuidance"] = json!("x".repeat(INPUT_BYTES - overhead + 1));
    assert!(validate_body(&body).is_err());
}
#[test]
fn async_production_operations_are_send_for_tauri() {
    fn check<T: Send>(_: T) {}
    let state = ArenaState::isolated();
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    check(stream(
        &state,
        &cloud,
        &secrets,
        create(false, false),
        &sink,
    ));
    check(control(
        &state,
        &cloud,
        &secrets,
        operation("lookup-request", false),
    ));
}

#[tokio::test]
async fn signed_token_save_failure_stays_in_memory_and_never_recreates() {
    let secrets = Arc::new(Secrets::default());
    let captured = secrets.clone();
    let srv = server(3, move |i, r| match i {
        0 => capability(),
        1 => {
            captured.fail_set.store(true, Ordering::SeqCst);
            token_reply(Reply::sse(standard_wire()), r)
        }
        _ => status("completed"),
    })
    .await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let sink = Sink::default();
    stream(
        &state,
        &cloud,
        secrets.as_ref(),
        create(false, false),
        &sink,
    )
    .await
    .unwrap();
    assert_eq!(
        sink.events.lock().unwrap()[0]["recoveryCredentialState"],
        "memory-only"
    );
    let response = control(
        &state,
        &cloud,
        secrets.as_ref(),
        operation("lookup-request", false),
    )
    .await
    .unwrap();
    assert_eq!(response.recovery_credential_state, "memory-only");
    srv.task.await.unwrap();
    let requests = srv.requests.lock().unwrap();
    assert!(requests[1].headers[ACTOR_HEADER].starts_with("bootstrap."));
    assert!(!requests[2].headers[ACTOR_HEADER].starts_with("bootstrap."));
    assert_eq!(requests.iter().filter(|r| r.method == "POST").count(), 1);
}
#[tokio::test]
async fn initial_secret_store_failure_is_zero_requests_and_zero_post() {
    let secrets = Secrets::default();
    secrets.fail_set.store(true, Ordering::SeqCst);
    let state = ArenaState::with_origin("http://127.0.0.1:1".into());
    let cloud = CloudState::new().unwrap();
    let error = stream(
        &state,
        &cloud,
        &secrets,
        create(false, false),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "storage-unavailable");
    assert_eq!(error.dispatch_state, "not-dispatched");
}
#[tokio::test]
async fn detach_during_inflight_response_only_closes_local_subscription() {
    let srv = server(2, |i, _| {
        if i == 0 {
            capability()
        } else {
            let mut reply = Reply::sse(standard_wire());
            reply.delay = Duration::from_millis(100);
            reply
        }
    })
    .await;
    let state = Arc::new(ArenaState::with_origin(srv.origin.clone()));
    let cloud = Arc::new(CloudState::new().unwrap());
    let secrets = Arc::new(Secrets::default());
    let sink = Arc::new(Sink::default());
    let task = {
        let state = state.clone();
        let cloud = cloud.clone();
        let secrets = secrets.clone();
        let sink = sink.clone();
        tokio::spawn(async move {
            stream(
                &state,
                &cloud,
                secrets.as_ref(),
                create(false, false),
                sink.as_ref(),
            )
            .await
        })
    };
    while srv.requests.lock().unwrap().len() < 2 {
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert!(detach(
        &state,
        DetachRequest {
            product: Product::Battle,
            request_id: RID.into()
        }
    )
    .unwrap());
    let e = task.await.unwrap().unwrap_err();
    assert_eq!(e.code, "detached");
    assert_eq!(e.dispatch_state, "unknown");
    srv.task.await.unwrap();
    assert_eq!(srv.requests.lock().unwrap().len(), 2);
    assert!(sink.events.lock().unwrap().is_empty());
    assert!(
        !state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .terminal
    );
}
#[tokio::test]
async fn logout_or_scope_change_rejects_late_response_and_further_controls() {
    let secrets = Arc::new(Secrets::default());
    login(&secrets, 42);
    let captured = secrets.clone();
    let srv = server(2, move |i, _| {
        if i == 0 {
            capability()
        } else {
            captured.delete("account-session:web-v1").unwrap();
            Reply::sse(standard_wire())
        }
    })
    .await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let sink = Sink::default();
    let error = stream(&state, &cloud, secrets.as_ref(), create(true, false), &sink)
        .await
        .unwrap_err();
    assert_eq!(error.code, "scope-changed");
    assert_eq!(error.dispatch_state, "unknown");
    assert!(sink.events.lock().unwrap().is_empty());
    login(&secrets, 99);
    assert_eq!(
        control(
            &state,
            &cloud,
            secrets.as_ref(),
            operation("lookup-request", true)
        )
        .await
        .unwrap_err()
        .code,
        "scope-changed"
    );
    srv.task.await.unwrap();
    assert_eq!(srv.requests.lock().unwrap().len(), 2);
}
#[test]
fn snapshot_and_meta_replacement_are_not_session_cumulative_wire_budgets() {
    let mut budget = Budget::default();
    for i in 0..12 {
        let content = "x".repeat(3 * 1024 * 1024);
        let mut event=parse_frame(&event(&format!("{i}-0"),"snapshot",json!({"status":"running","markdown":content,"reasoning":"","lastEventId":null,"updatedAt":"2026-10-10T00:00:00Z"}))).unwrap().unwrap();
        budget.accept(&mut event).unwrap();
        assert_eq!(budget.markdown_bytes, 3 * 1024 * 1024);
    }
    let data = json!({"version":1,"aiModel":"synthetic","usage":{"completionTokens":15,"reasoningTokens":5,"textTokens":10,"completionTokensIncludesReasoning":true}});
    assert_eq!(project_telemetry(&data).unwrap()["usage"], data["usage"]);
    assert_eq!(
        project_telemetry(&json!({"errorClass":"Error"})).unwrap(),
        json!({"errorClass":"Error"})
    );
}

#[tokio::test]
async fn detach_during_preparation_is_zero_post_and_not_dispatched() {
    let srv = server(1, |_, _| {
        let mut r = capability();
        r.delay = Duration::from_millis(100);
        r
    })
    .await;
    let state = Arc::new(ArenaState::with_origin(srv.origin.clone()));
    let cloud = Arc::new(CloudState::new().unwrap());
    let secrets = Arc::new(Secrets::default());
    let sink = Arc::new(Sink::default());
    let task = {
        let state = state.clone();
        let cloud = cloud.clone();
        let secrets = secrets.clone();
        let sink = sink.clone();
        tokio::spawn(async move {
            stream(
                &state,
                &cloud,
                secrets.as_ref(),
                create(false, false),
                sink.as_ref(),
            )
            .await
        })
    };
    while srv.requests.lock().unwrap().is_empty() {
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert!(detach(
        &state,
        DetachRequest {
            product: Product::Battle,
            request_id: RID.into()
        }
    )
    .unwrap());
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(error.code, "detached");
    assert_eq!(error.dispatch_state, "not-dispatched");
    srv.task.await.unwrap();
    assert_eq!(srv.requests.lock().unwrap().len(), 1);
    assert!(
        !state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .dispatched
    );
}
#[tokio::test]
async fn wrong_or_missing_public_identity_never_binds_a_control_response() {
    for wrong in [true, false] {
        let srv=server(2,move|i,_|if i==0{capability()}else{Reply::json(200,if wrong{json!({"generationId":gid(),"generationRequestId":"different_request_6789","status":"running"})}else{json!({"status":"running"})})}).await;
        let secrets = Secrets::default();
        login(&secrets, 42);
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let error = control(&state, &cloud, &secrets, operation("lookup-request", true))
            .await
            .unwrap_err();
        assert_eq!(error.code, "invalid-response");
        srv.task.await.unwrap();
        assert!(state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .generation_id
            .is_none());
    }
}
#[test]
fn canonical_reference_budget_keeps_51_plus_51_and_256() {
    let mut body = fixture()["validOperations"][0]["body"].clone();
    body["questionnaires"] = json!(vec![json!({}); 51]);
    body["narrativeHistory"] = json!(vec![json!({}); 51]);
    validate_body(&body).unwrap();
    body["materials"] = json!(vec![json!({}); 154]);
    validate_body(&body).unwrap();
    body["materials"] = json!(vec![json!({}); 155]);
    assert!(validate_body(&body).is_err());
}

#[tokio::test]
async fn maximum_utf8_escaped_snapshot_traverses_real_http_and_channel() {
    let srv=server(2,|i,_|if i==0{capability()}else{
        let f=fixture();let r=&f["boundaryRecipes"]["snapshot"];
        let snapshot=event(r["id"].as_str().unwrap(),"snapshot",json!({"status":"completed","markdown":r["character"].as_str().unwrap().repeat(r["repeat"].as_u64().unwrap()as usize),"reasoning":"","lastEventId":null,"updatedAt":r["updatedAt"],"telemetry":{"version":1,"aiModel":"fixture-model"}}));
        Reply::sse(snapshot+&event("9999999999999-1","done",json!({"ok":true,"status":"completed"})))
    }).await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    stream(&state, &cloud, &secrets, create(false, false), &sink)
        .await
        .unwrap();
    srv.task.await.unwrap();
    let events = sink.events.lock().unwrap();
    assert_eq!(events[0]["kind"], "response");
    assert_eq!(events.last().unwrap()["kind"], "stream-end");
    for (i, value) in events.iter().enumerate() {
        assert_eq!(value["sequence"], i);
        assert!(serde_json::to_vec(value).unwrap().len() <= IPC_BYTES);
    }
    assert_eq!(
        state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .budget
            .markdown_bytes,
        OUTPUT_BYTES
    );
    if let Ok(path) = std::env::var("ARENA_NATIVE_EVENTS_OUTPUT") {
        std::fs::write(path, serde_json::to_vec(&*events).unwrap()).unwrap();
    }
    eprintln!(
        "ARENA_HTTP_BOUNDARY channel_messages={} decoded_utf8_bytes={OUTPUT_BYTES}",
        events.len()
    );
}

#[tokio::test]
async fn renderer_consumed_cursor_can_lag_native_emitted_cursor_without_losing_replay() {
    let srv = server(3, |i, _| match i {
        0 => capability(),
        1 => Reply::sse(
            event("1-0", "markdown", json!({"chunk":"A"}))
                + &event("2-0", "markdown", json!({"chunk":"B"}))
                + "id: 3-0\nevent: markdown\ndata: {",
        ),
        _ => Reply::sse(
            event("2-0", "markdown", json!({"chunk":"B"}))
                + &event("3-0", "markdown", json!({"chunk":"C"}))
                + &event("4-0", "done", json!({"ok":true,"status":"completed"})),
        ),
    })
    .await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let first = Sink::default();
    stream(&state, &cloud, &secrets, create(false, false), &first)
        .await
        .unwrap_err();
    assert!(first.wire().contains("id: 2-0")); // native sent it, renderer only acknowledged 1-0
    let request = json!({"operation":"resume","product":"battle","requestId":RID,"actor":{"kind":"anonymous"},"generationId":gid(),"after":"1-0"});
    let sink = Sink::default();
    stream(
        &state,
        &cloud,
        &secrets,
        serde_json::from_value(request).unwrap(),
        &sink,
    )
    .await
    .unwrap();
    assert!(sink.wire().contains("id: 2-0"));
    assert!(sink.wire().contains("id: 3-0"));
    assert_eq!(
        state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .budget
            .markdown_bytes,
        3
    );
    srv.task.await.unwrap();
    assert_eq!(
        srv.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.method == "POST")
            .count(),
        1
    );
}
#[tokio::test]
async fn lost_first_token_header_can_be_reissued_two_minutes_later_without_extending_lifetime() {
    let srv=server(3,|i,r|match i{0=>capability(),1=>Reply::sse(event("1-0","markdown",json!({"chunk":"A"}))),_=>{
        let mut reply=status("running");let id=r.headers[ACTOR_HEADER].strip_prefix("bootstrap.").unwrap();
        let token=json!({"v":1,"anonymousId":id,"issuedAt":time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),"expiresAt":time::OffsetDateTime::from_unix_timestamp((now_ms()/1000+TOKEN_LIFETIME_MS/1000)as i64).unwrap().format(&time::format_description::well_known::Rfc3339).unwrap(),"signature":"synthetic-valid-shape"});
        reply.headers.push((ACTOR_HEADER.into(),URL_SAFE_NO_PAD.encode(token.to_string())));reply
    }}).await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    stream(
        &state,
        &cloud,
        &secrets,
        create(false, false),
        &Sink::default(),
    )
    .await
    .unwrap();
    // Advance the persisted first-dispatch age without delaying the test's real clock.
    let first = {
        let flights = state.flights.lock().unwrap();
        let mut f = flights[&Product::Battle].lock().unwrap();
        let record = f.anonymous.as_mut().unwrap();
        record.first_dispatched_at -= 120_000;
        save_anonymous(record, &secrets).unwrap();
        record.first_dispatched_at
    };
    control(&state, &cloud, &secrets, operation("lookup-request", false))
        .await
        .unwrap();
    let record = load_anonymous(Product::Battle, &secrets).unwrap().unwrap();
    assert!(record.token.is_some());
    assert!(record.token_expires_at.unwrap() <= first + TOKEN_LIFETIME_MS);
    srv.task.await.unwrap();
    assert_eq!(
        srv.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.method == "POST")
            .count(),
        1
    );
}

#[tokio::test]
async fn explicit_same_actor_restore_rebinds_scope_without_lending_new_cookie_to_old_flight() {
    for account in [true, false] {
        let srv = server(5, move |i, r| match i {
            0 | 2 => capability(),
            1 => {
                if account {
                    Reply::sse(event("1-0", "markdown", json!({"chunk":"old"})))
                } else {
                    token_reply(
                        Reply::sse(event("1-0", "markdown", json!({"chunk":"old"}))),
                        r,
                    )
                }
            }
            3 => status("running"),
            _ => Reply::sse(standard_wire()),
        })
        .await;
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        if account {
            login(&secrets, 42);
        }
        stream(
            &state,
            &cloud,
            &secrets,
            create(account, false),
            &Sink::default(),
        )
        .await
        .unwrap();
        let old = state.flights.lock().unwrap()[&Product::Battle].clone();
        let old_token = old
            .lock()
            .unwrap()
            .anonymous
            .as_ref()
            .and_then(|r| r.token.clone());
        login(&secrets, 42);
        let current = secrets
            .resolve("account-session:web-v1")
            .unwrap()
            .unwrap()
            .replace(COOKIE, "better-auth.session_token=NEW-SYNTHETIC-SESSION");
        secrets.set("account-session:web-v1", &current).unwrap();
        assert_eq!(
            control(
                &state,
                &cloud,
                &secrets,
                operation("lookup-request", account)
            )
            .await
            .unwrap_err()
            .code,
            "scope-changed"
        );
        let restore = json!({"operation":"lookup-request","product":"battle","requestId":RID,"actor":if account{json!({"kind":"account","expectedUserId":42})}else{json!({"kind":"anonymous"})},"restoreSession":true});
        control(
            &state,
            &cloud,
            &secrets,
            serde_json::from_value(restore).unwrap(),
        )
        .await
        .unwrap();
        assert!(state
            .is_current(Product::Battle, &old, &cloud, &secrets)
            .is_err());
        let current = state.flights.lock().unwrap()[&Product::Battle].clone();
        assert!(!Arc::ptr_eq(&old, &current));
        assert!(!current.lock().unwrap().budget.observed);
        assert_eq!(
            current
                .lock()
                .unwrap()
                .anonymous
                .as_ref()
                .and_then(|r| r.token.clone()),
            old_token
        );
        stream(
            &state,
            &cloud,
            &secrets,
            operation("resume", account),
            &Sink::default(),
        )
        .await
        .unwrap();
        srv.task.await.unwrap();
        let requests = srv.requests.lock().unwrap();
        assert_eq!(requests.iter().filter(|r| r.method == "POST").count(), 1);
        for r in &requests[3..] {
            if account {
                assert_eq!(
                    r.headers.get("cookie").unwrap(),
                    "better-auth.session_token=NEW-SYNTHETIC-SESSION"
                );
            } else {
                assert!(!r.headers.contains_key("cookie"));
                assert_eq!(r.headers.get(ACTOR_HEADER), old_token.as_ref());
            }
        }
    }
}
#[test]
fn explicit_restore_keeps_memory_only_signed_actor_instead_of_old_bootstrap_slot() {
    let state = ArenaState::isolated();
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let prior = state
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    {
        let mut f = prior.lock().unwrap();
        let record = f.anonymous.as_mut().unwrap();
        record.token = Some("synthetic-memory-signed-token".into());
        record.token_expires_at = Some(now_ms() + 60_000);
        f.memory_only = true;
    }
    login(&secrets, 42);
    let restore = json!({"operation":"lookup-request","product":"battle","requestId":RID,"actor":{"kind":"anonymous"},"restoreSession":true});
    let next = state
        .prepare(&serde_json::from_value(restore).unwrap(), &cloud, &secrets)
        .unwrap();
    assert_eq!(
        next.lock()
            .unwrap()
            .anonymous
            .as_ref()
            .unwrap()
            .token
            .as_deref(),
        Some("synthetic-memory-signed-token")
    );
    assert!(next.lock().unwrap().memory_only);
    assert!(load_anonymous(Product::Battle, &secrets)
        .unwrap()
        .unwrap()
        .token
        .is_none());
}

#[tokio::test]
async fn replay_subscription_error_never_authorizes_discarding_unconfirmed_producer() {
    for code in [
        "GENERATION_TERMINAL_RECONCILIATION_PENDING",
        "REPLAY_WINDOW_LOST",
        "REPLAY_STREAM_MISSING",
        "GENERATION_STATE_LOST",
        "GENERATION_TERMINAL_EVIDENCE_MISSING",
    ] {
        let srv=server(2,move|i,_|if i==0{capability()}else{Reply::sse(event("1-0","error",json!({"status":if code=="GENERATION_STATE_LOST"{"producer_lost"}else{"failed"},"code":code})))}).await;
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        stream(
            &state,
            &cloud,
            &secrets,
            create(false, false),
            &Sink::default(),
        )
        .await
        .unwrap();
        assert!(
            !state.flights.lock().unwrap()[&Product::Battle]
                .lock()
                .unwrap()
                .terminal
        );
        let mut next = fixture()["validOperations"][0].clone();
        next["actor"] = json!({"kind":"anonymous"});
        next["requestId"] = json!("another_request_5678");
        assert_eq!(
            state
                .prepare(&serde_json::from_value(next).unwrap(), &cloud, &secrets)
                .err()
                .unwrap()
                .code,
            "recovery-conflict"
        );
        srv.task.await.unwrap();
    }
}

fn replacement_request(request_id: &str, replace_id: &str) -> Value {
    let mut value = fixture()["validOperations"][0].clone();
    value["actor"] = json!({"kind":"anonymous"});
    value["requestId"] = json!(request_id);
    value["replaceRequestId"] = json!(replace_id);
    value
}
#[tokio::test]
async fn prepared_pointer_rollback_requires_proven_prior_ownership_not_dispatch_state() {
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let state = ArenaState::with_origin("http://127.0.0.1:1".into());
    state
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    let old_slot = secrets.resolve(Product::Battle.slot()).unwrap();
    for failure in ["provider", "body", "final-envelope"] {
        let mut value = replacement_request("next_request_5678", RID);
        match failure {
            "provider" => {
                value["presetConfig"] =
                    json!({"providerId":"kourichat","modelId":"gemini-3.8-flash"})
            }
            "body" => value["body"]["writeCurrentState"] = json!(true),
            _ => {
                value["body"]["userGuidance"] = json!("");
                let size = serialized_size(&value["body"]).unwrap();
                value["body"]["userGuidance"] = json!("x".repeat(INPUT_BYTES - size));
                validate_body(&value["body"]).unwrap();
            }
        }
        let error = stream(
            &state,
            &cloud,
            &secrets,
            serde_json::from_value(value).unwrap(),
            &Sink::default(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.dispatch_state, "not-dispatched");
        assert_eq!(error.intent_ownership, "prior-retained");
        assert_eq!(secrets.resolve(Product::Battle.slot()).unwrap(), old_slot);
        assert_eq!(
            state.flights.lock().unwrap()[&Product::Battle]
                .lock()
                .unwrap()
                .request_id,
            RID
        );
    }
    // Same not-dispatched state, different ownership: capability fails after new slot commit.
    let secrets = Secrets::default();
    let srv = server(1, |_, _| Reply::json(200, json!({"ok":true}))).await;
    let state = ArenaState::with_origin(srv.origin);
    state
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    let error = stream(
        &state,
        &cloud,
        &secrets,
        serde_json::from_value(replacement_request("next_request_5678", RID)).unwrap(),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.dispatch_state, "not-dispatched");
    assert_eq!(error.intent_ownership, "current-owned");
    assert_eq!(
        load_anonymous(Product::Battle, &secrets)
            .unwrap()
            .unwrap()
            .request_id,
        "next_request_5678"
    );
    srv.task.await.unwrap();
}
#[tokio::test]
async fn uncertain_credential_read_does_not_claim_prior_pointer_can_be_restored() {
    let state = ArenaState::isolated();
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    state
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    secrets.fail_resolve.store(true, Ordering::SeqCst);
    let mut value = replacement_request("next_request_5678", RID);
    value["body"]["writeCurrentState"] = json!(true);
    let error = stream(
        &state,
        &cloud,
        &secrets,
        serde_json::from_value(value).unwrap(),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.dispatch_state, "not-dispatched");
    assert_eq!(error.intent_ownership, "unknown");
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains("bootstrap."));
}
#[tokio::test]
async fn concurrent_product_replacement_never_authorizes_rolling_back_an_older_pointer() {
    let secrets = Arc::new(Secrets::default());
    let cloud = Arc::new(CloudState::new().unwrap());
    let state_holder: Arc<Mutex<Option<Arc<ArenaState>>>> = Arc::new(Mutex::new(None));
    let captured = state_holder.clone();
    let captured_secrets = secrets.clone();
    let captured_cloud = cloud.clone();
    let srv = server(1, move |_, _| {
        let state = captured.lock().unwrap().clone().unwrap();
        state
            .prepare(
                &serde_json::from_value(replacement_request(
                    "third_request_9012",
                    "next_request_5678",
                ))
                .unwrap(),
                &captured_cloud,
                captured_secrets.as_ref(),
            )
            .unwrap();
        capability()
    })
    .await;
    let state = Arc::new(ArenaState::with_origin(srv.origin));
    *state_holder.lock().unwrap() = Some(state.clone());
    state
        .prepare(&create(false, false), &cloud, secrets.as_ref())
        .unwrap();
    let error = stream(
        &state,
        &cloud,
        secrets.as_ref(),
        serde_json::from_value(replacement_request("next_request_5678", RID)).unwrap(),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "detached");
    assert_eq!(error.dispatch_state, "not-dispatched");
    assert_eq!(error.intent_ownership, "unknown");
    assert_eq!(
        load_anonymous(Product::Battle, secrets.as_ref())
            .unwrap()
            .unwrap()
            .request_id,
        "third_request_9012"
    );
    srv.task.await.unwrap();
}
#[test]
fn recovery_hint_projects_only_fixed_public_identity_and_keeps_account_isolation() {
    let state = ArenaState::isolated();
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    assert_eq!(
        serde_json::to_value(recovery_hint(
            &state,
            &cloud,
            &secrets,
            RecoveryHintRequest {
                product: Product::Battle
            }
        ))
        .unwrap(),
        json!({"state":"none","product":"battle"})
    );
    login(&secrets, 42);
    state
        .prepare(&create(true, false), &cloud, &secrets)
        .unwrap();
    let own = serde_json::to_value(recovery_hint(
        &state,
        &cloud,
        &secrets,
        RecoveryHintRequest {
            product: Product::Battle,
        },
    ))
    .unwrap();
    assert_eq!(
        own,
        json!({"state":"available","product":"battle","requestId":RID,"actorKind":"account"})
    );
    login(&secrets, 99);
    assert_eq!(
        serde_json::to_value(recovery_hint(
            &state,
            &cloud,
            &secrets,
            RecoveryHintRequest {
                product: Product::Battle
            }
        ))
        .unwrap(),
        json!({"state":"none","product":"battle"})
    );
    secrets.delete("account-session:web-v1").unwrap();
    assert_eq!(
        serde_json::to_value(recovery_hint(
            &state,
            &cloud,
            &secrets,
            RecoveryHintRequest {
                product: Product::Battle
            }
        ))
        .unwrap(),
        json!({"state":"none","product":"battle"})
    );
    assert_eq!(
        serde_json::to_value(recovery_hint(
            &state,
            &cloud,
            &secrets,
            RecoveryHintRequest {
                product: Product::Arena
            }
        ))
        .unwrap(),
        json!({"state":"none","product":"arena"})
    );
    for value in [
        json!({"product":"battle","secretRef":Product::Battle.slot()}),
        json!({"product":"battle","requestId":RID}),
        json!({"product":"custom"}),
    ] {
        assert!(serde_json::from_value::<RecoveryHintRequest>(value).is_err());
    }
}
#[tokio::test]
async fn lost_public_pointer_can_hint_exact_anonymous_id_then_replace_with_explicit_consent() {
    let secrets = Secrets::default();
    let cloud = CloudState::new().unwrap();
    let original = ArenaState::isolated();
    original
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    let old_value = secrets.resolve(Product::Battle.slot()).unwrap();
    drop(original);
    // Simulates a cleared malformed/unknown-version public pointer after an app restart.
    let srv = server(1, |_, _| Reply::json(200, json!({"ok":true}))).await;
    let state = ArenaState::with_origin(srv.origin);
    login(&secrets, 42);
    let hint = serde_json::to_value(recovery_hint(
        &state,
        &cloud,
        &secrets,
        RecoveryHintRequest {
            product: Product::Battle,
        },
    ))
    .unwrap();
    assert_eq!(
        hint,
        json!({"state":"available","product":"battle","requestId":RID,"actorKind":"anonymous"})
    );
    assert_eq!(secrets.resolve(Product::Battle.slot()).unwrap(), old_value);
    assert!(state.flights.lock().unwrap().is_empty());
    // A new logged-in intent still requires consent naming the exact old anonymous id.
    let mut next = fixture()["validOperations"][0].clone();
    next["requestId"] = json!("next_request_5678");
    assert_eq!(
        stream(
            &state,
            &cloud,
            &secrets,
            serde_json::from_value(next.clone()).unwrap(),
            &Sink::default()
        )
        .await
        .unwrap_err()
        .code,
        "recovery-conflict"
    );
    next["replaceRequestId"] = hint["requestId"].clone();
    let error = stream(
        &state,
        &cloud,
        &secrets,
        serde_json::from_value(next).unwrap(),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.intent_ownership, "current-owned");
    assert_eq!(error.dispatch_state, "not-dispatched");
    assert_eq!(
        state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .request_id,
        "next_request_5678"
    );
    srv.task.await.unwrap();
}
#[test]
fn recovery_hint_expired_and_unavailable_never_mutate_or_expose_actor_credentials() {
    let state = ArenaState::isolated();
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let f = state
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    {
        let mut f = f.lock().unwrap();
        let record = f.anonymous.as_mut().unwrap();
        record.first_dispatched_at -= BOOTSTRAP_LIFETIME_MS + 1;
        save_anonymous(record, &secrets).unwrap();
    }
    let raw = secrets.resolve(Product::Battle.slot()).unwrap().unwrap();
    let hint = serde_json::to_value(recovery_hint(
        &state,
        &cloud,
        &secrets,
        RecoveryHintRequest {
            product: Product::Battle,
        },
    ))
    .unwrap();
    assert_eq!(
        hint,
        json!({"state":"expired","product":"battle","requestId":RID,"actorKind":"anonymous"})
    );
    assert!(!hint.to_string().contains("bootstrap"));
    assert_eq!(
        secrets.resolve(Product::Battle.slot()).unwrap().unwrap(),
        raw
    );
    let empty = ArenaState::isolated();
    secrets
        .set(Product::Arena.slot(), "corrupt-SYNTHETIC-secret")
        .unwrap();
    assert_eq!(
        serde_json::to_value(recovery_hint(
            &empty,
            &cloud,
            &secrets,
            RecoveryHintRequest {
                product: Product::Arena
            }
        ))
        .unwrap(),
        json!({"state":"unavailable","product":"arena"})
    );
    assert_eq!(
        secrets.resolve(Product::Arena.slot()).unwrap().as_deref(),
        Some("corrupt-SYNTHETIC-secret")
    );
    secrets.fail_resolve.store(true, Ordering::SeqCst);
    assert_eq!(
        serde_json::to_value(recovery_hint(
            &empty,
            &cloud,
            &secrets,
            RecoveryHintRequest {
                product: Product::Battle
            }
        ))
        .unwrap(),
        json!({"state":"unavailable","product":"battle"})
    );
}

#[tokio::test]
async fn final_post_envelope_with_request_id_and_key_accepts_exact_limit_rejects_one_more() {
    let secrets = Secrets::default();
    login(&secrets, 42);
    secrets.set("preset:kourichat:api-key", KEY).unwrap();
    let cloud = CloudState::new().unwrap();
    let mut request = fixture()["validOperations"][0].clone();
    request["presetConfig"] = json!({"providerId":"kourichat","modelId":"gemini-3.8-flash"});
    request["body"]["userGuidance"] = json!("");
    // Use the production provider projector, including the selected synthetic Key.
    let provider = cloud::arena_provider_config(
        None,
        Some(serde_json::from_value(request["presetConfig"].clone()).unwrap()),
        &secrets,
    )
    .unwrap()
    .unwrap();
    let mut envelope = request["body"].clone();
    envelope["generationRequestId"] = json!(RID);
    envelope["customProvider"] = provider;
    let overhead = serialized_size(&envelope).unwrap();
    request["body"]["userGuidance"] = json!("x".repeat(INPUT_BYTES - overhead));
    let srv = server(2, |i, r| {
        if i == 0 {
            return capability();
        }
        assert_eq!(r.method, "POST");
        assert_eq!(r.body.len(), INPUT_BYTES);
        assert_eq!(r.headers["content-length"], INPUT_BYTES.to_string());
        let actual: Value = serde_json::from_str(&r.body).unwrap();
        assert_eq!(actual["generationRequestId"], RID);
        assert_eq!(actual["customProvider"]["apiKey"], KEY);
        Reply::sse(standard_wire())
    })
    .await;
    let state = ArenaState::with_origin(srv.origin.clone());
    stream(
        &state,
        &cloud,
        &secrets,
        serde_json::from_value(request.clone()).unwrap(),
        &Sink::default(),
    )
    .await
    .unwrap();
    srv.task.await.unwrap();
    assert_eq!(srv.requests.lock().unwrap().len(), 2);
    request["body"]["userGuidance"] = json!("x".repeat(INPUT_BYTES - overhead + 1));
    let untouched = ArenaState::with_origin(srv.origin);
    let error = stream(
        &untouched,
        &cloud,
        &secrets,
        serde_json::from_value(request).unwrap(),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "invalid-request");
    assert_eq!(error.dispatch_state, "not-dispatched");
    assert_eq!(error.intent_ownership, "prior-retained");
    assert!(untouched.flights.lock().unwrap().is_empty());
    assert_eq!(srv.requests.lock().unwrap().len(), 2);
    eprintln!(
        "ARENA_FINAL_POST_BOUNDARY accepted_bytes={INPUT_BYTES} rejected_bytes={} post_count=1",
        INPUT_BYTES + 1
    );
}

#[tokio::test]
async fn source_limit_meta_recipe_traverses_real_http_and_channel_without_loss() {
    let f = fixture();
    let recipe = &f["boundaryRecipes"]["meta"];
    let headline = recipe["headlineCharacter"]
        .as_str()
        .unwrap()
        .repeat(recipe["headlineRepeat"].as_u64().unwrap() as usize);
    let meta = json!({"report":{"headline":headline}});
    let source = format!("<!-- MAHOSHOJO_ARENA_META {meta} -->");
    assert_eq!(
        source.len(),
        recipe["sourceBytes"].as_u64().unwrap() as usize
    );
    let data = json!({"parseOk":true,"meta":meta,"raw":&source[..recipe["rawCodeUnits"].as_u64().unwrap() as usize],"rawTruncated":true});
    let wire = if let Ok(path) = std::env::var("ARENA_NATIVE_META_WIRE_INPUT") {
        // Optional cross-language evidence uses the untouched real TS projector/encoder output.
        std::fs::read_to_string(path).unwrap()
    } else {
        event(recipe["id"].as_str().unwrap(), "meta", data.clone())
    };
    assert_eq!(wire.len(), recipe["wireBytes"].as_u64().unwrap() as usize);
    let parsed = parse_frame(&wire).unwrap().unwrap();
    assert_eq!(parsed.id, recipe["id"].as_str().unwrap());
    assert_eq!(parsed.name, "meta");
    assert_eq!(parsed.data, data);
    let wire_bytes = wire.len();
    let srv = server(2, move |i, _| {
        if i == 0 {
            capability()
        } else {
            Reply::sse(
                wire.clone() + &event("3-0", "done", json!({"ok":true,"status":"completed"})),
            )
        }
    })
    .await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    stream(&state, &cloud, &secrets, create(false, false), &sink)
        .await
        .unwrap();
    srv.task.await.unwrap();
    let output = sink.wire();
    let mut parser = ArenaParser::default();
    let mut blocks = Vec::new();
    for chunk in output.as_bytes().chunks(IPC_TEXT_BYTES) {
        blocks.extend(parser.push(chunk).unwrap());
    }
    parser.finish().unwrap();
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0].id, recipe["id"].as_str().unwrap());
    assert_eq!(blocks[0].data, data);
    assert_eq!(blocks[1].name, "done");
    let events = sink.events.lock().unwrap();
    assert_eq!(events[0]["kind"], "response");
    assert_eq!(events.last().unwrap()["kind"], "stream-end");
    for (i, item) in events.iter().enumerate() {
        assert_eq!(item["sequence"], i);
        assert!(serde_json::to_vec(item).unwrap().len() <= IPC_BYTES);
        if let Some(text) = item["text"].as_str() {
            assert!(text.len() <= IPC_TEXT_BYTES);
        }
    }
    if let Ok(path) = std::env::var("ARENA_NATIVE_META_EVENTS_OUTPUT") {
        std::fs::write(path, serde_json::to_vec(&*events).unwrap()).unwrap();
    }
    eprintln!("ARENA_META_HTTP_BOUNDARY source_bytes={} wire_bytes={wire_bytes} channel_messages={} raw_utf16_units={}", source.len(), events.len(), data["raw"].as_str().unwrap().encode_utf16().count());
}

#[path = "arena_hosted_json_tests.rs"]
mod json_tests;

#[path = "arena_hosted_story_tests.rs"]
mod story_tests;
