//! Production command macros, app ACL and Channel serialization with isolated state.
use super::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};

#[derive(Default)]
struct MemorySecrets {
    values: Mutex<HashMap<String, String>>,
    resolved_refs: Arc<Mutex<Vec<String>>>,
}

impl secret::SecretStore for MemorySecrets {
    fn set(&self, key: &str, value: &str) -> Result<(), secret::SecretStoreError> {
        self.values.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
    fn exists(&self, key: &str) -> Result<bool, secret::SecretStoreError> {
        Ok(self.values.lock().unwrap().contains_key(key))
    }
    fn delete(&self, key: &str) -> Result<(), secret::SecretStoreError> {
        self.values.lock().unwrap().remove(key);
        Ok(())
    }
    fn resolve(&self, key: &str) -> Result<Option<String>, secret::SecretStoreError> {
        self.resolved_refs.lock().unwrap().push(key.to_string());
        Ok(self.values.lock().unwrap().get(key).cloned())
    }
}

#[derive(Debug)]
struct CapturedEvent {
    webview: String,
    callback: u32,
    index: usize,
    body: Value,
}

struct Transport {
    main: tauri::WebviewWindow<MockRuntime>,
    untrusted: tauri::WebviewWindow<MockRuntime>,
    events: Arc<Mutex<Vec<CapturedEvent>>>,
    resolved_refs: Arc<Mutex<Vec<String>>>,
    _app: tauri::App<MockRuntime>,
    _root: tempfile::TempDir,
}

impl Transport {
    fn new(origin: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let library = LocalLibrary::open(root.path()).unwrap();
        for (id, requires_key) in [("local", false), ("missing-key", true)] {
            let profile = json!({
                "version": 1, "id": id, "name": "Synthetic loopback",
                "adapter": "openai-compatible", "baseUrl": origin,
                "modelId": "test-model",
                "createdAt": "2026-09-30T00:00:00.000Z",
                "updatedAt": "2026-09-30T00:00:00.000Z",
                "apiKeyRef": requires_key.then(|| format!("provider:{id}:api-key")),
            });
            library
                .profiles()
                .put(id, &profile.to_string(), "t")
                .unwrap();
        }
        let arena = arena_hosted::ArenaState::with_story_loopback_origins(
            library.shared_stories(),
            origin,
            origin,
        )
        .unwrap();
        let resolved_refs = Arc::new(Mutex::new(Vec::new()));
        let secrets: SharedSecretStore = Arc::new(MemorySecrets {
            resolved_refs: resolved_refs.clone(),
            ..Default::default()
        });
        secrets
            .set(
                "account-session:web-v1",
                &json!({
                    "cookie": "better-auth.session_token=SYNTHETIC-CHANNEL-TEST",
                    "activityToken": "eyJ2IjoxLCJ1c2VySWQiOjQyLCJpc3N1ZWRBdCI6IjIwMjYtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiOTk5OS0wMS0wMVQwMDowMDowMFoiLCJzaWduYXR1cmUiOiJTWU5USEVUSUMtTk9ULUEtVkFMSUQtU0lHTkFUVVJFIn0",
                    "sessionExpiresAt": null,
                    "account": {"userId": 42, "username": "synthetic", "displayName": null},
                })
                .to_string(),
            )
            .unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let app = mock_builder()
            .manage(library)
            .manage(secrets)
            .manage(ai::RequestRegistry::default())
            .manage(siwc::State::new(root.path()))
            .manage(arena)
            .manage(cloud::CloudState::new().unwrap())
            .channel_interceptor(move |webview, callback, index, body| {
                let InvokeResponseBody::Json(body) = body else {
                    panic!("stream events must use JSON");
                };
                captured.lock().unwrap().push(CapturedEvent {
                    webview: webview.label().to_string(),
                    callback: callback.0,
                    index,
                    body: serde_json::from_str(body).unwrap(),
                });
                true
            })
            .invoke_handler(tauri::generate_handler![
                stream_direct_ai,
                stream_target_ai,
                arena_hosted_stream,
            ])
            // The real context is required: mock_context omits the app ACL.
            .build(tauri::generate_context!())
            .unwrap();
        let main = tauri::WebviewWindowBuilder::new(&app, "main-ui", Default::default())
            .build()
            .unwrap();
        let untrusted = tauri::WebviewWindowBuilder::new(&app, "untrusted", Default::default())
            .build()
            .unwrap();
        Self {
            main,
            untrusted,
            events,
            resolved_refs,
            _app: app,
            _root: root,
        }
    }

    fn call(
        &self,
        command: &str,
        args: Value,
        trusted: bool,
        remote: bool,
    ) -> Result<Value, Value> {
        let local = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        get_ipc_response(
            if trusted { &self.main } else { &self.untrusted },
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: if remote {
                    "https://example.invalid"
                } else {
                    local
                }
                .parse()
                .unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<Value>().unwrap())
    }
}

fn direct_args(command: &str, request_id: &str, profile_id: &str) -> Value {
    let mut args = json!({
        "request": {"requestId": request_id, "contractVersion": 1,
            "mode": "direct-local", "messages": [{"role": "user", "content": "hello"}]},
        "onEvent": "__CHANNEL__:17",
    });
    if command == "stream_target_ai" {
        args["target"] = json!({"kind": "custom", "profileId": profile_id});
    } else {
        args["profileId"] = json!(profile_id);
    }
    args
}

fn hosted_args() -> Value {
    json!({"request": {"operation": "lookup-request", "product": "battle",
        "requestId": "arena_request_1234", "actor": {"kind": "account", "expectedUserId": 42}},
        "onEvent": "__CHANNEL__:17"})
}

fn assert_receipt(receipt: Value, events: &[CapturedEvent], request_id: &str) {
    assert_eq!(
        receipt,
        json!({"requestId": request_id, "channelEventCount": events.len()})
    );
    assert!(!events.is_empty());
    for (index, event) in events.iter().enumerate() {
        assert_eq!(event.webview, "main-ui");
        assert_eq!(event.callback, 17);
        assert_eq!(event.index, index);
        assert_eq!(event.body["sequence"], index);
        assert_eq!(event.body["requestId"], request_id);
        assert!(event.body.get("request_id").is_none());
    }
}

#[test]
fn direct_commands_return_per_invocation_receipts_for_accepted_terminal_events() {
    let transport = Transport::new("http://127.0.0.1:1");
    for (command, request_id) in [
        ("stream_direct_ai", "first-request"),
        ("stream_target_ai", "second-request"),
    ] {
        transport.events.lock().unwrap().clear();
        // The missing synthetic secret ends the stream before HTTP dispatch.
        let receipt = transport
            .call(
                command,
                direct_args(command, request_id, "missing-key"),
                true,
                false,
            )
            .unwrap();
        let events = transport.events.lock().unwrap();
        assert_receipt(receipt, &events, request_id);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].body["type"], "started");
        assert_eq!(events[1].body["type"], "result");
        assert_eq!(events[1].body["result"]["status"], "failed");
        assert_eq!(
            events[1].body["result"]["error"]["code"],
            "authentication-failed"
        );
    }
}

#[test]
fn preset_command_resolves_trusted_model_before_missing_secret_terminal() {
    let transport = Transport::new("http://127.0.0.1:1");
    let request_id = "preset-missing-key";
    let mut args = direct_args("stream_target_ai", request_id, "unused");
    args["target"] = json!({"kind": "preset", "providerId": "agnes-ai"});
    args["request"]["modelId"] = json!("agnes-2.0-flash");
    args["request"]["mode"] = json!("direct-remote");
    // The production preset/model resolver reaches the isolated missing-key gate.
    // Header construction fails before HTTP dispatch; no provider key is supplied.
    let receipt = transport
        .call("stream_target_ai", args, true, false)
        .unwrap();
    let events = transport.events.lock().unwrap();
    assert_receipt(receipt, &events, request_id);
    assert!(events
        .iter()
        .all(|event| event.body["mode"] == "direct-remote"));
    assert_eq!(
        *transport.resolved_refs.lock().unwrap(),
        vec!["preset:agnes-ai:api-key"]
    );
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].body["type"], "started");
    assert_eq!(events[1].body["type"], "result");
    assert_eq!(events[1].body["result"]["status"], "failed");
    assert_eq!(
        events[1].body["result"]["error"]["code"],
        "authentication-failed"
    );
}

#[test]
fn chatgpt_target_requires_its_own_session_before_dispatch() {
    let transport = Transport::new("http://127.0.0.1:1");
    let request_id = "chatgpt-missing-grant";
    let mut args = direct_args("stream_target_ai", request_id, "unused");
    args["target"] = json!({"kind": "chatgpt-plan", "connectionId": "a".repeat(32)});
    args["request"]["modelId"] = json!("plan-model");
    args["request"]["mode"] = json!("direct-remote");
    let receipt = transport
        .call("stream_target_ai", args.clone(), true, false)
        .unwrap();
    assert!(transport
        .call("stream_target_ai", args, false, false)
        .is_err());
    let events = transport.events.lock().unwrap();
    assert_receipt(receipt, &events, request_id);
    assert_eq!(events.len(), 2);
    assert_eq!(
        events[1].body["result"]["error"]["code"],
        "authentication-failed"
    );
    assert!(transport.resolved_refs.lock().unwrap().is_empty());
}

#[test]
fn stream_command_macros_enforce_channel_payload_casing_and_real_app_acl() {
    let transport = Transport::new("http://127.0.0.1:1");
    for command in [
        "stream_direct_ai",
        "stream_target_ai",
        "arena_hosted_stream",
    ] {
        let args = if command == "arena_hosted_stream" {
            hosted_args()
        } else {
            direct_args(command, "macro-request", "absent-profile")
        };
        // Valid camelCase parameters reach the production validation error, not a macro error.
        let native_error = transport
            .call(command, args.clone(), true, false)
            .unwrap_err();
        assert!(
            native_error["code"].is_string(),
            "{command}: {native_error}"
        );
        assert!(native_error.get("channelEventCount").is_none());
        for (trusted, remote) in [(false, false), (true, true)] {
            assert!(transport
                .call(command, args.clone(), trusted, remote)
                .unwrap_err()
                .is_string());
        }
        for invalid_channel in [
            json!(17),
            json!({"id": 17}),
            json!("17"),
            json!("__CHANNEL__:invalid"),
        ] {
            let mut invalid = args.clone();
            invalid["onEvent"] = invalid_channel;
            assert!(transport
                .call(command, invalid, true, false)
                .unwrap_err()
                .is_string());
        }
        let mut wrong_case = args.clone();
        let channel = wrong_case
            .as_object_mut()
            .unwrap()
            .remove("onEvent")
            .unwrap();
        wrong_case["on_event"] = channel;
        assert!(transport
            .call(command, wrong_case, true, false)
            .unwrap_err()
            .is_string());
    }
    let mut args = direct_args("stream_direct_ai", "case-request", "missing-key");
    let profile = args.as_object_mut().unwrap().remove("profileId").unwrap();
    args["profile_id"] = profile;
    assert!(transport
        .call("stream_direct_ai", args, true, false)
        .unwrap_err()
        .is_string());
    assert!(transport
        .call("streamDirectAi", json!({}), true, false)
        .is_err());
    assert!(transport.events.lock().unwrap().is_empty());
}

struct Reply {
    content_type: &'static str,
    headers: Vec<(String, String)>,
    body: String,
}

fn loopback(replies: Vec<Reply>) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for reply in replies {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("loopback request missing: {error}"),
                }
            };
            // Windows can inherit the listener's nonblocking mode on accepted sockets.
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let header_end = loop {
                let mut buffer = [0; 4096];
                let read = stream.read(&mut buffer).unwrap();
                assert_ne!(read, 0);
                bytes.extend_from_slice(&buffer[..read]);
                if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let header = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
            let content_length: usize = header
                .lines()
                .find_map(|line| {
                    let (key, value) = line.split_once(':')?;
                    key.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse().unwrap())
                })
                .unwrap_or(0);
            while bytes.len() < header_end + content_length {
                let mut buffer = [0; 4096];
                let read = stream.read(&mut buffer).unwrap();
                assert_ne!(read, 0);
                bytes.extend_from_slice(&buffer[..read]);
            }
            requests.push(header.lines().next().unwrap().to_string());
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n", reply.content_type, reply.body.len()).unwrap();
            for (key, value) in reply.headers {
                write!(stream, "{key}: {value}\r\n").unwrap();
            }
            write!(stream, "\r\n{}", reply.body).unwrap();
        }
        requests
    });
    (origin, server)
}

#[test]
fn direct_command_macro_counts_real_loopback_sse_events() {
    let (origin, server) = loopback(vec![Reply {
        content_type: "text/event-stream",
        headers: Vec::new(),
        body: "data: {\"choices\":[{\"delta\":{\"content\":\"完成🪄\"}}]}\n\ndata: [DONE]\n\n"
            .into(),
    }]);
    let transport = Transport::new(&origin);
    let receipt = transport
        .call(
            "stream_direct_ai",
            direct_args("stream_direct_ai", "loopback-request", "local"),
            true,
            false,
        )
        .unwrap();
    let events = transport.events.lock().unwrap();
    assert_receipt(receipt, &events, "loopback-request");
    assert_eq!(events.first().unwrap().body["type"], "started");
    let terminal = &events.last().unwrap().body;
    assert_eq!(terminal["type"], "result");
    assert_eq!(terminal["result"]["status"], "completed");
    assert_eq!(terminal["result"]["output"]["text"], "完成🪄");
    assert_eq!(server.join().unwrap(), ["POST /chat/completions HTTP/1.1"]);
}

#[test]
fn hosted_command_macro_counts_real_loopback_sse_events() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-arena-hosted.json"
    ))
    .unwrap();
    let generation_id = format!("arena_{}", "a".repeat(64));
    let (origin, server) = loopback(vec![
        Reply { content_type: "application/json", headers: Vec::new(), body: fixture["capability"].to_string() },
        Reply {
            content_type: "text/event-stream",
            headers: vec![
                ("X-Mahoshojo-Generation-Id".into(), generation_id),
                ("X-Mahoshojo-Generation-Request-Id".into(), "arena_request_1234".into()),
            ],
            body: "id: 1-0\nevent: markdown\ndata: {\"chunk\":\"完成🪄\"}\n\nid: 2-0\nevent: done\ndata: {\"ok\":true,\"status\":\"completed\"}\n\n".into(),
        },
    ]);
    let transport = Transport::new(&origin);
    let receipt = transport
        .call(
            "arena_hosted_stream",
            json!({"request": fixture["validOperations"][0], "onEvent": "__CHANNEL__:17"}),
            true,
            false,
        )
        .unwrap();
    let events = transport.events.lock().unwrap();
    assert_receipt(receipt, &events, "arena_request_1234");
    assert_eq!(events.first().unwrap().body["kind"], "response");
    assert_eq!(events.last().unwrap().body["kind"], "stream-end");
    assert!(events
        .iter()
        .any(|event| event.body["kind"] == "sse-fragment"));
    assert_eq!(
        server.join().unwrap(),
        [
            "GET /api/hosted/dr-readiness HTTP/1.1",
            "POST /api/arena/generate-stream?format=sse HTTP/1.1"
        ]
    );
}

#[test]
fn counting_sink_excludes_failed_sends_and_preserves_channel_errors() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let attempts = AtomicUsize::new(0);
    let channel = tauri::ipc::Channel::new(move |_| {
        if attempts.fetch_add(1, Ordering::Relaxed) == 0 {
            Ok(())
        } else {
            Err(tauri::Error::Io(std::io::Error::other(
                "synthetic closed channel",
            )))
        }
    });
    let direct = ipc_stream::CountingEventSink::new(channel);
    let event = ai::AiStreamEvent::Started {
        request_id: "sink-request".into(),
        contract_version: 1,
        mode: ai::AiExecutionMode::DirectLocal,
        sequence: 0,
    };
    assert!(ai::EventSink::send(&direct, event.clone()).is_ok());
    assert!(ai::EventSink::send(&direct, event).is_err());
    assert_eq!(
        serde_json::to_value(direct.receipt("sink-request".into())).unwrap(),
        json!({"requestId": "sink-request", "channelEventCount": 1})
    );

    let channel = tauri::ipc::Channel::new(|_| {
        Err(tauri::Error::Io(std::io::Error::other(
            "synthetic closed channel",
        )))
    });
    let hosted = ipc_stream::CountingEventSink::new(channel);
    let error = arena_hosted::EventSink::send(
        &hosted,
        arena_hosted::ChannelEvent::StreamEnd {
            request_id: "sink-request".into(),
            sequence: 0,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "detached");
    assert_eq!(
        serde_json::to_value(hosted.receipt("sink-request".into())).unwrap(),
        json!({"requestId": "sink-request", "channelEventCount": 0})
    );
}
