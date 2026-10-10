//! Synthetic credentials, real production C2 HTTP/raw/envelope/Channel transport.
use super::*;

fn json_fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/arena-companion.json"
    ))
    .unwrap()
}
fn create_json(account: bool, byok: bool) -> ArenaRequest {
    let mut value = fixture()["validOperations"][0].clone();
    value["operation"] = json!("create-json");
    if !account {
        value["actor"] = json!({"kind":"anonymous"});
    }
    if byok {
        value["presetConfig"] = json!({"providerId":"kourichat","modelId":"gemini-3.8-flash"});
    }
    serde_json::from_value(value).unwrap()
}
fn json_capability() -> Reply {
    let mut reply = capability();
    reply.headers.push((
        json_delivery::PROTOCOL_HEADER.into(),
        json_delivery::PROTOCOL_VERSION.into(),
    ));
    reply
}
fn json_reply(status: u16, wire: String) -> Reply {
    let mut reply = Reply::sse(wire);
    reply.status = status;
    reply.headers.retain(|(k, _)| k != "Content-Type");
    reply
        .headers
        .push(("Content-Type".into(), "application/json".into()));
    reply.headers.push((
        json_delivery::PROTOCOL_HEADER.into(),
        json_delivery::PROTOCOL_VERSION.into(),
    ));
    reply
}
fn collected_json(sink: &Sink) -> String {
    sink.events
        .lock()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "json-fragment")
        .map(|v| v["text"].as_str().unwrap())
        .collect()
}
#[test]
fn canonical_json_create_and_channel_fixtures_match_native_transport_limits() {
    let value: Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-arena-hosted-json.json"
    ))
    .unwrap();
    assert_eq!(json_fixture()["limits"]["wireBytes"], 76_711_888);
    // Create semantics are inherited from the existing C1 create-only authority.
    create_json(false, false).validate().unwrap();
    let request: ArenaRequest = serde_json::from_value(value["createRequest"].clone()).unwrap();
    request.validate().unwrap();
}
#[tokio::test]
async fn json_identity_funding_and_complete_body_remain_original_across_channel() {
    for (account, byok) in [(false, false), (false, true), (true, false), (true, true)] {
        let original = json_fixture()["successEnvelopes"][0].to_string();
        let sent = original.clone();
        let srv = server(2, move |i, r| {
            if i == 0 {
                json_capability()
            } else {
                assert_eq!(r.path, json_delivery::CREATE_PATH);
                assert_eq!(
                    r.headers[json_delivery::PROTOCOL_HEADER],
                    json_delivery::PROTOCOL_VERSION
                );
                assert_eq!(r.body.contains(KEY), byok);
                assert_eq!(r.headers.contains_key("cookie"), account);
                if account {
                    json_reply(200, sent.clone())
                } else {
                    token_reply(json_reply(200, sent.clone()), r)
                }
            }
        })
        .await;
        let secrets = Secrets::default();
        if account {
            login(&secrets, 42);
        }
        if byok {
            secrets.set("preset:kourichat:api-key", KEY).unwrap();
        }
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let sink = Sink::default();
        stream(&state, &cloud, &secrets, create_json(account, byok), &sink)
            .await
            .unwrap();
        assert_eq!(collected_json(&sink), original);
        {
            let events = sink.events.lock().unwrap();
            assert_eq!(events[0]["kind"], "json-response");
            assert_eq!(events.last().unwrap()["kind"], "json-end");
            for (i, event) in events.iter().enumerate() {
                assert_eq!(event["sequence"], i);
                assert!(serde_json::to_vec(event).unwrap().len() <= IPC_BYTES);
            }
        }
        assert!(
            state.flights.lock().unwrap()[&Product::Battle]
                .lock()
                .unwrap()
                .terminal
        );
        assert_eq!(
            stream(
                &state,
                &cloud,
                &secrets,
                create_json(account, byok),
                &Sink::default()
            )
            .await
            .unwrap_err()
            .code,
            "create-already-attempted"
        );
        srv.task.await.unwrap();
    }
}
#[tokio::test]
async fn json_capability_is_create_only_and_rollback_does_not_block_stop() {
    let srv = server(4, |i, _| match i {
        0 => capability(),
        1 => capability(),
        2 => status("running"),
        _ => Reply::json(
            202,
            json!({"generationId":gid(),"status":"cancelling","cancelled":true}),
        ),
    })
    .await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    let e = stream(
        &state,
        &cloud,
        &secrets,
        create_json(true, false),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(e.code, "capability-unavailable");
    assert_eq!(e.dispatch_state, "not-dispatched");
    assert_eq!(e.intent_ownership, "current-owned");
    control(&state, &cloud, &secrets, operation("lookup-request", true))
        .await
        .unwrap();
    let mut stop_request = operation("stop", true);
    if let ArenaRequest::Stop { generation_id, .. } = &mut stop_request {
        *generation_id = Some(gid());
    }
    let stop = control(&state, &cloud, &secrets, stop_request)
        .await
        .unwrap();
    assert_eq!(stop.status, 202);
    srv.task.await.unwrap();
    assert!(srv
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|r| r.path != json_delivery::CREATE_PATH));
}
#[tokio::test]
async fn json_protocol_and_identity_failures_deliver_no_raw_fragments() {
    for failure in [
        "truncated",
        "identity",
        "unknown-envelope",
        "unknown-body",
        "writes",
        "secret",
        "protocol-header",
        "legacy-meta",
    ] {
        let mut envelope = json_fixture()["successEnvelopes"][0].clone();
        match failure {
            "identity" => {
                envelope["body"]["generationId"] = json!(format!("arena_{}", "b".repeat(64)))
            }
            "unknown-envelope" => envelope["private"] = json!(true),
            "unknown-body" => envelope["body"]["private"] = json!(true),
            "writes" => envelope["body"]["updatedCombatants"] = json!([{}]),
            "secret" => envelope["body"]["report"]["headline"] = json!(KEY),
            _ => {}
        }
        let mut raw = envelope.to_string();
        if failure == "truncated" {
            raw.pop();
        }
        let srv = server(2, move |i, _| {
            if i == 0 {
                json_capability()
            } else {
                let mut r = json_reply(200, raw.clone());
                if failure == "protocol-header" {
                    r.headers
                        .retain(|(k, _)| k != json_delivery::PROTOCOL_HEADER);
                }
                if failure == "legacy-meta" {
                    r.headers
                        .push(("X-Mahoshojo-Stream-Meta".into(), "%7B%7D".into()));
                }
                r
            }
        })
        .await;
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        secrets.set("preset:kourichat:api-key", KEY).unwrap();
        let sink = Sink::default();
        let e = stream(&state, &cloud, &secrets, create_json(false, true), &sink)
            .await
            .unwrap_err();
        assert_eq!(e.dispatch_state, "unknown");
        assert!(sink.events.lock().unwrap().is_empty(), "{failure}");
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
}
#[test]
fn json_secret_scanner_checks_unicode_escapes_and_preserves_lone_surrogates() {
    let state = ArenaState::isolated();
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let flight = state
        .prepare(&create_json(false, false), &cloud, &secrets)
        .unwrap();
    flight.lock().unwrap().generation_id = Some(gid());
    let base = json_fixture()["successEnvelopes"][0].clone();
    for secret in ["ASCII-SECRET", "前缀🪄后缀", "a\\b\"c\nd"] {
        flight.lock().unwrap().secrets_to_redact = vec![secret.into()];
        let mut object = base.clone();
        object["body"]["report"]["headline"] = json!(secret);
        let raw = object.to_string();
        assert!(json_delivery::validate_envelope(&raw, true, &flight).is_err());
        let encoded = secret
            .encode_utf16()
            .map(|u| format!("\\u{u:04x}"))
            .collect::<String>();
        let raw = raw.replace(
            &serde_json::to_string(secret).unwrap(),
            &format!("\"{encoded}\""),
        );
        assert!(json_delivery::validate_envelope(&raw, true, &flight).is_err());
    }
    flight.lock().unwrap().secrets_to_redact = vec!["ABCXYZ".into()];
    let mut escaped = base.clone();
    escaped["body"]["report"]["headline"] = json!("ABCXYZ");
    let mixed = escaped.to_string().replace("ABCXYZ", r"A\u0042CXYZ");
    assert!(json_delivery::validate_envelope(&mixed, true, &flight).is_err());
    escaped["body"]["report"]["headline"] = json!(r"\u0041BCXYZ");
    json_delivery::validate_envelope(&escaped.to_string(), true, &flight).unwrap();
    escaped["body"]["report"]["ABCXYZ"] = json!("field name echo");
    assert!(json_delivery::validate_envelope(&escaped.to_string(), true, &flight).is_err());
    flight.lock().unwrap().secrets_to_redact = vec!["do-not-join".into()];
    let mut object = base;
    object["body"]["report"]["headline"] = json!("do-not-");
    object["body"]["report"]["article"]["body"] = json!("join");
    json_delivery::validate_envelope(&object.to_string(), true, &flight).unwrap();
    let raw = object.to_string().replace("do-not-", r"\ud83d");
    json_delivery::validate_envelope(&raw, true, &flight).unwrap();
    assert!(serde_json::from_str::<Value>(&raw).is_err());
}
#[tokio::test]
async fn json_real_companion_utf16_fixture_stays_byte_exact() {
    let raw = include_str!("../../../../packages/contracts/fixtures/arena-companion-utf16.json");
    assert!(raw.contains(r"\ud83d"));
    assert!(serde_json::from_str::<Value>(raw).is_err());
    let srv = server(2, move |i, _| {
        if i == 0 {
            json_capability()
        } else {
            json_reply(200, raw.into())
        }
    })
    .await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    stream(&state, &cloud, &secrets, create_json(false, false), &sink)
        .await
        .unwrap();
    assert_eq!(collected_json(&sink), raw);
    if let Ok(path) = std::env::var("ARENA_JSON_UTF16_EVENTS_OUTPUT") {
        std::fs::write(
            path,
            serde_json::to_vec(&*sink.events.lock().unwrap()).unwrap(),
        )
        .unwrap();
    }
    srv.task.await.unwrap();
}

#[tokio::test]
async fn json_public_error_envelope_is_preserved_but_never_a_report() {
    for index in 0..2 {
        let mut envelope = json_fixture()["errorEnvelopes"][index].clone();
        if index == 1 {
            envelope["body"]["generationRequestId"] = json!(RID);
            envelope["body"]["status"] = json!("completed");
        }
        let original = envelope.to_string();
        let raw = original.clone();
        let srv = server(2, move |i, _| {
            if i == 0 {
                json_capability()
            } else {
                json_reply(503, raw.clone())
            }
        })
        .await;
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        let sink = Sink::default();
        stream(&state, &cloud, &secrets, create_json(false, false), &sink)
            .await
            .unwrap();
        assert_eq!(collected_json(&sink), original);
        assert_eq!(sink.events.lock().unwrap()[0]["status"], 503);
        assert_eq!(
            state.flights.lock().unwrap()[&Product::Battle]
                .lock()
                .unwrap()
                .terminal,
            index == 1
        );
        srv.task.await.unwrap();
    }
}

async fn read_concurrent_request(stream: &mut tokio::net::TcpStream) -> Request {
    let mut bytes = Vec::new();
    let header_end;
    loop {
        let mut chunk = [0u8; 4096];
        let n = stream.read(&mut chunk).await.unwrap();
        assert_ne!(n, 0);
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(i) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            header_end = i + 4;
            break;
        }
    }
    let header = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
    let mut lines = header.lines();
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
    Request {
        method,
        path,
        headers,
        body: String::from_utf8(bytes[header_end..header_end + length].to_vec()).unwrap(),
    }
}
async fn write_reply(stream: &mut tokio::net::TcpStream, reply: Reply) {
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
#[tokio::test]
async fn json_header_wait_exceeds_fifteen_seconds_while_same_actor_lookup_stop_remains_live() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let posted = Arc::new(tokio::sync::Notify::new());
    let notify = posted.clone();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let captured = seen.clone();
    let server = tokio::spawn(async move {
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let notify = notify.clone();
            let captured = captured.clone();
            tasks.push(tokio::spawn(async move {
                let request = read_concurrent_request(&mut socket).await;
                let path = request.path.clone();
                captured.lock().unwrap().push(request);
                let reply = if path == CAPABILITY_PATH {
                    json_capability()
                } else if path == json_delivery::CREATE_PATH {
                    notify.notify_one();
                    tokio::time::sleep(Duration::from_millis(15_300)).await;
                    json_reply(200, json_fixture()["successEnvelopes"][0].to_string())
                } else if path.ends_with("/cancel") {
                    Reply::json(
                        202,
                        json!({"generationId":gid(),"status":"cancelling","cancelled":true}),
                    )
                } else {
                    status("running")
                };
                write_reply(&mut socket, reply).await;
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
    });
    let state = Arc::new(ArenaState::with_origin(origin));
    let cloud = Arc::new(CloudState::new().unwrap());
    let secrets = Arc::new(Secrets::default());
    login(&secrets, 42);
    let sink = Arc::new(Sink::default());
    let (f_state, f_cloud, f_secrets, f_sink) =
        (state.clone(), cloud.clone(), secrets.clone(), sink.clone());
    let create = tokio::spawn(async move {
        stream(
            &f_state,
            &f_cloud,
            f_secrets.as_ref(),
            create_json(true, false),
            f_sink.as_ref(),
        )
        .await
    });
    posted.notified().await;
    let lookup = control(
        &state,
        &cloud,
        secrets.as_ref(),
        operation("lookup-request", true),
    )
    .await
    .unwrap();
    assert_eq!(lookup.body["generationId"], gid());
    let mut request = operation("stop", true);
    if let ArenaRequest::Stop { generation_id, .. } = &mut request {
        *generation_id = Some(gid());
    }
    let stop = control(&state, &cloud, secrets.as_ref(), request)
        .await
        .unwrap();
    assert_eq!(stop.status, 202);
    assert!(!create.is_finished());
    assert!(
        !state.flights.lock().unwrap()[&Product::Battle]
            .lock()
            .unwrap()
            .terminal
    );
    create.await.unwrap().unwrap();
    server.await.unwrap();
    assert_eq!(
        sink.events.lock().unwrap().last().unwrap()["kind"],
        "json-end"
    );
    let requests = seen.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.path == json_delivery::CREATE_PATH)
            .count(),
        1
    );
    assert!(requests
        .iter()
        .filter(|r| r.path != CAPABILITY_PATH)
        .all(|r| r.headers.get("cookie").map(String::as_str) == Some(COOKIE)));
}

#[tokio::test]
async fn json_late_scope_and_local_detach_never_deliver_or_retry() {
    for change_account in [true, false] {
        let secrets = Arc::new(Secrets::default());
        login(&secrets, 42);
        let cloud = CloudState::new().unwrap();
        let holder: Arc<Mutex<Option<Arc<ArenaState>>>> = Arc::new(Mutex::new(None));
        let holder_copy = holder.clone();
        let secret_copy = secrets.clone();
        let srv = server(2, move |i, _| {
            if i == 0 {
                json_capability()
            } else {
                if change_account {
                    login(secret_copy.as_ref(), 99);
                } else {
                    detach(
                        holder_copy.lock().unwrap().as_ref().unwrap(),
                        DetachRequest {
                            product: Product::Battle,
                            request_id: RID.into(),
                        },
                    )
                    .unwrap();
                }
                let mut reply = json_reply(200, json_fixture()["successEnvelopes"][0].to_string());
                reply.delay = Duration::from_millis(30);
                reply
            }
        })
        .await;
        let state = Arc::new(ArenaState::with_origin(srv.origin));
        *holder.lock().unwrap() = Some(state.clone());
        let sink = Sink::default();
        let e = stream(
            &state,
            &cloud,
            secrets.as_ref(),
            create_json(true, false),
            &sink,
        )
        .await
        .unwrap_err();
        assert_eq!(e.dispatch_state, "unknown");
        assert!(sink.events.lock().unwrap().is_empty());
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
}
#[tokio::test]
async fn json_unknown_delivery_recovers_original_structured_snapshot_without_posting_again() {
    let raw_report = json_fixture()["successEnvelopes"][0]["body"]["report"].to_string();
    let captured = raw_report.clone();
    let srv=server(4,move|i,_|match i {
        0=>json_capability(),1=>json_reply(200,"{\"version\":".into()),2=>status("running"),_=>{
            let mut reply=Reply::sse(event("1-0","snapshot",json!({"status":"completed","markdown":captured,"reasoning":"","lastEventId":null,"updatedAt":"2026-10-10T00:00:00.000Z"}))+&event("2-0","done",json!({"ok":true,"status":"completed"})));
            reply.headers.push(("X-Mahoshojo-Stream-Meta".into(),percent_encoding::utf8_percent_encode(r#"{"reportFormat":"markdown","outputContract":"structured-report"}"#,percent_encoding::NON_ALPHANUMERIC).to_string()));reply
        }
    }).await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let e = stream(
        &state,
        &cloud,
        &secrets,
        create_json(false, false),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(e.dispatch_state, "unknown");
    control(&state, &cloud, &secrets, operation("lookup-request", false))
        .await
        .unwrap();
    let sink = Sink::default();
    stream(&state, &cloud, &secrets, operation("resume", false), &sink)
        .await
        .unwrap();
    assert_eq!(sink.events.lock().unwrap()[0]["metadataState"], "invalid");
    let raw = sink.wire();
    let first = raw.split("\n\n").next().unwrap();
    let parsed = parse_frame(first).unwrap().unwrap();
    assert_eq!(parsed.data["markdown"], raw_report);
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
async fn json_declared_wire_limit_plus_one_is_rejected_before_channel() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        for i in 0..2 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_concurrent_request(&mut socket).await;
            if i == 0 {
                assert_eq!(request.path, CAPABILITY_PATH);
                write_reply(&mut socket, json_capability()).await;
            } else {
                assert_eq!(request.path, json_delivery::CREATE_PATH);
                let head=format!("HTTP/1.1 200 Test\r\nContent-Length: 76711889\r\nContent-Type: application/json\r\nX-Mahoshojo-Arena-Companion-Protocol: arena-companion-v1\r\nX-Mahoshojo-Generation-Id: {}\r\nX-Mahoshojo-Generation-Request-Id: {RID}\r\nConnection: close\r\n\r\n",gid());
                socket.write_all(head.as_bytes()).await.unwrap();
            }
        }
    });
    let state = ArenaState::with_origin(origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    let error = stream(&state, &cloud, &secrets, create_json(false, false), &sink)
        .await
        .unwrap_err();
    assert_eq!(error.code, "output-too-large");
    assert_eq!(error.dispatch_state, "unknown");
    assert!(sink.events.lock().unwrap().is_empty());
    server.await.unwrap();
}

#[derive(Default)]
struct CapacitySinkState {
    sequence: u64,
    bytes: usize,
    finals: usize,
    ended: bool,
    hasher: Sha256,
}
struct CapacitySink {
    state: Mutex<CapacitySinkState>,
    output: Mutex<Option<std::io::BufWriter<std::fs::File>>>,
}
impl Default for CapacitySink {
    fn default() -> Self {
        Self {
            state: Mutex::new(CapacitySinkState::default()),
            output: Mutex::new(
                std::env::var("ARENA_JSON_CAPACITY_EVENTS_OUTPUT")
                    .ok()
                    .map(|p| std::io::BufWriter::new(std::fs::File::create(p).unwrap())),
            ),
        }
    }
}
impl EventSink for CapacitySink {
    fn send(&self, event: ChannelEvent) -> Result<(), ArenaError> {
        if let Some(writer) = self.output.lock().unwrap().as_mut() {
            use std::io::Write;
            serde_json::to_writer(&mut *writer, &event).unwrap();
            writer.write_all(b"\n").unwrap();
        }
        assert!(serde_json::to_vec(&event).unwrap().len() <= IPC_BYTES);
        let mut state = self.state.lock().unwrap();
        let sequence = match event {
            ChannelEvent::JsonResponse {
                sequence,
                status,
                generation_id,
                generation_request_id,
                ..
            } => {
                assert_eq!(status, 200);
                assert_eq!(generation_id.as_deref(), Some(gid().as_str()));
                assert_eq!(generation_request_id.as_deref(), Some(RID));
                sequence
            }
            ChannelEvent::JsonFragment {
                sequence,
                text,
                r#final,
                ..
            } => {
                assert!(text.len() <= IPC_TEXT_BYTES);
                state.hasher.update(text.as_bytes());
                state.bytes += text.len();
                state.finals += usize::from(r#final);
                sequence
            }
            ChannelEvent::JsonEnd { sequence, .. } => {
                state.ended = true;
                sequence
            }
            _ => panic!("wrong capacity channel family"),
        };
        assert_eq!(sequence, state.sequence);
        state.sequence += 1;
        Ok(())
    }
}
#[tokio::test]
#[ignore = "explicit serial window; separate file-stream loopback process supplies canonical maximum envelope"]
async fn json_capacity_consumer_measures_native_alone_without_retained_channel_copies() {
    let origin = std::env::var("ARENA_JSON_CAPACITY_ORIGIN").unwrap();
    let expected_bytes = std::env::var("ARENA_JSON_CAPACITY_BYTES")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    let expected_hash = std::env::var("ARENA_JSON_CAPACITY_SHA256").unwrap();
    let baseline = std::fs::read_to_string("/proc/self/status").unwrap();
    let state = ArenaState::with_origin(origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = CapacitySink::default();
    stream(&state, &cloud, &secrets, create_json(false, false), &sink)
        .await
        .unwrap();
    let output = sink.state.lock().unwrap();
    assert_eq!(output.bytes, expected_bytes);
    assert!(output.ended);
    assert_eq!(output.finals, 1);
    assert_eq!(
        format!("{:x}", output.hasher.clone().finalize()),
        expected_hash
    );
    let measured = std::fs::read_to_string("/proc/self/status").unwrap();
    eprintln!(
        "ARENA_JSON_NATIVE_CAPACITY bytes={} channel_messages={} baseline={} peak={} retained={}",
        output.bytes,
        output.sequence,
        baseline.lines().find(|l| l.starts_with("VmRSS:")).unwrap(),
        measured.lines().find(|l| l.starts_with("VmHWM:")).unwrap(),
        measured.lines().find(|l| l.starts_with("VmRSS:")).unwrap()
    );
}

struct DetachingJsonSink<'a> {
    state: &'a ArenaState,
    after: usize,
    events: Mutex<Vec<Value>>,
}
impl EventSink for DetachingJsonSink<'_> {
    fn send(&self, event: ChannelEvent) -> Result<(), ArenaError> {
        let mut events = self.events.lock().unwrap();
        events.push(serde_json::to_value(event).unwrap());
        if events.len() == self.after {
            detach(
                self.state,
                DetachRequest {
                    product: Product::Battle,
                    request_id: RID.into(),
                },
            )?;
        }
        Ok(())
    }
}
#[tokio::test]
async fn json_synchronous_sink_detach_fences_remaining_fragments_end_and_terminal() {
    for after in [1, 2] {
        let mut envelope = json_fixture()["successEnvelopes"][0].clone();
        envelope["body"]["report"]["headline"] = json!("x".repeat(3 * IPC_TEXT_BYTES));
        let wire = envelope.to_string();
        let srv = server(2, move |i, _| {
            if i == 0 {
                json_capability()
            } else {
                json_reply(200, wire.clone())
            }
        })
        .await;
        let state = ArenaState::with_origin(srv.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        let sink = DetachingJsonSink {
            state: &state,
            after,
            events: Mutex::new(Vec::new()),
        };
        let error = stream(&state, &cloud, &secrets, create_json(false, false), &sink)
            .await
            .unwrap_err();
        assert_eq!(error.code, "detached");
        assert_eq!(error.dispatch_state, "unknown");
        assert_eq!(sink.events.lock().unwrap().len(), after);
        assert!(
            !state.flights.lock().unwrap()[&Product::Battle]
                .lock()
                .unwrap()
                .terminal
        );
        srv.task.await.unwrap();
    }
}

#[tokio::test]
async fn json_real_error_writer_utf16_fields_remain_original_and_keep_http_status() {
    let raw =
        include_str!("../../../../packages/contracts/fixtures/arena-companion-error-utf16.json");
    assert!(serde_json::from_str::<Value>(raw).is_err());
    let srv = server(2, move |i, _| {
        if i == 0 {
            json_capability()
        } else {
            let mut reply = json_reply(502, raw.into());
            for (k, v) in &mut reply.headers {
                if k.eq_ignore_ascii_case("x-mahoshojo-generation-request-id") {
                    *v = "request-capacity-fixture".into();
                }
            }
            reply
        }
    })
    .await;
    let state = ArenaState::with_origin(srv.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    let mut request = create_json(false, false);
    if let ArenaRequest::CreateJson { request_id, .. } = &mut request {
        *request_id = "request-capacity-fixture".into();
    }
    stream(&state, &cloud, &secrets, request, &sink)
        .await
        .unwrap();
    assert_eq!(collected_json(&sink), raw);
    assert_eq!(sink.events.lock().unwrap()[0]["status"], 502);
    if let Ok(path) = std::env::var("ARENA_JSON_ERROR_UTF16_EVENTS_OUTPUT") {
        std::fs::write(
            path,
            serde_json::to_vec(&*sink.events.lock().unwrap()).unwrap(),
        )
        .unwrap();
    }
    srv.task.await.unwrap();
}

#[path = "arena_hosted_reconciliation_tests.rs"]
mod reconciliation_tests;
