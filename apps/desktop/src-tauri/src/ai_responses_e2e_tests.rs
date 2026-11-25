//! Official-shaped synthetic Responses streams over real loopback HTTP.
//! These tests exercise saved profiles, secret resolution, transport, cancellation,
//! aggregation and the normalized consumer contract; no real provider is contacted.
use super::*;
use serde_json::{json, Value};

const FIXTURE: &str =
    include_str!("../../../../packages/contracts/fixtures/openai-responses-stream.json");

#[derive(Default)]
struct Wire {
    bytes: Vec<u8>,
    byte_chunks: bool,
    hold_open: bool,
    delay_headers: bool,
    http_status: Option<u16>,
}

struct ResponsesServer {
    base_url: String,
    observed: oneshot::Receiver<(ServerObservation, Value)>,
    request_received: oneshot::Receiver<()>,
}

async fn responses_server(wire: Wire) -> ResponsesServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (tx, observed) = oneshot::channel();
    let (received_tx, request_received) = oneshot::channel();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut received = Vec::new();
        let mut buffer = [0_u8; 2048];
        let header_end = loop {
            let n = stream.read(&mut buffer).await.unwrap();
            assert!(n > 0, "request ended before headers");
            received.extend_from_slice(&buffer[..n]);
            if let Some(pos) = received.windows(4).position(|v| v == b"\r\n\r\n") {
                break pos + 4;
            }
            assert!(
                received.len() < 64 * 1024,
                "test request headers are bounded"
            );
        };
        let head = String::from_utf8(received[..header_end].to_vec()).unwrap();
        let length: usize = head
            .lines()
            .find_map(|line| {
                let (key, value) = line.split_once(':')?;
                key.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse().unwrap())
            })
            .expect("JSON POST carries a content length");
        while received.len() < header_end + length {
            let n = stream.read(&mut buffer).await.unwrap();
            assert!(n > 0, "request ended before body");
            received.extend_from_slice(&buffer[..n]);
        }
        let body: Value =
            serde_json::from_slice(&received[header_end..header_end + length]).unwrap();
        let line = head.lines().next().unwrap().to_string();
        let auth = head
            .to_ascii_lowercase()
            .contains("authorization: bearer synthetic-responses-key");
        let _ = received_tx.send(());
        if !wire.delay_headers {
            if wire.byte_chunks {
                stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
                for byte in &wire.bytes {
                    if stream
                        .write_all(&[b'1', b'\r', b'\n', *byte, b'\r', b'\n'])
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                if !wire.hold_open {
                    let _ = stream.write_all(b"0\r\n\r\n").await;
                }
            } else {
                let status = wire.http_status.unwrap_or(200);
                let head = format!("HTTP/1.1 {status} Test\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(&wire.bytes).await;
            }
            let _ = stream.flush().await;
            if !wire.hold_open {
                let _ = stream.shutdown().await;
            }
        }
        let mut observation = observe_disconnect(stream, line, auth).await;
        while let Ok(Ok(_)) =
            tokio::time::timeout(std::time::Duration::from_millis(25), listener.accept()).await
        {
            observation.request_count += 1;
        }
        let _ = tx.send((observation, body));
    });
    ResponsesServer {
        base_url,
        observed,
        request_received,
    }
}

fn fixture_cases() -> Vec<Value> {
    serde_json::from_str::<Value>(FIXTURE).unwrap()["cases"]
        .as_array()
        .unwrap()
        .clone()
}
fn wire_events(events: &[Value], multiline: bool) -> Vec<u8> {
    events
        .iter()
        .map(|event| {
            if multiline {
                // SSE joins all data lines with a newline, preserving JSON whitespace.
                let pretty = serde_json::to_string_pretty(event).unwrap();
                format!(
                    "event: {}\n{}\n",
                    event["type"].as_str().unwrap(),
                    pretty
                        .lines()
                        .map(|line| format!("data: {line}\n"))
                        .collect::<String>()
                )
            } else {
                format!("data: {event}\n\n")
            }
        })
        .collect::<String>()
        .into_bytes()
}
fn profile(base_url: &str) -> String {
    let mut value: Value =
        serde_json::from_str(&stored_profile("responses", base_url, true)).unwrap();
    value["adapter"] = json!("openai-responses");
    value.to_string()
}
fn text_delta(events: &[AiStreamEvent]) -> String {
    events
        .iter()
        .filter_map(|event| {
            if let AiStreamEvent::TextDelta { delta, .. } = event {
                Some(delta.as_str())
            } else {
                None
            }
        })
        .collect()
}
fn reasoning_delta(events: &[AiStreamEvent]) -> String {
    events
        .iter()
        .filter_map(|event| {
            if let AiStreamEvent::ReasoningDelta { delta, .. } = event {
                Some(delta.as_str())
            } else {
                None
            }
        })
        .collect()
}
async fn execute(
    wire: Wire,
    req: AiExecutionRequest,
) -> (Vec<AiStreamEvent>, ServerObservation, Value) {
    let server = responses_server(wire).await;
    let store = LocalStore::open_in_memory().unwrap();
    store
        .put("responses", &profile(&server.base_url), "t")
        .unwrap();
    let secrets = TestSecretStore::default();
    secrets
        .set("provider:responses:api-key", "synthetic-responses-key")
        .unwrap();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();
    let identity = req.request_id.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        stream_direct_ai("responses", req, &store, &secrets, &registry, &sink),
    )
    .await
    .expect("protocol terminal must not wait for HTTP EOF")
    .unwrap();
    let events = sink.snapshot();
    assert_well_formed(&events, &identity);
    assert_eq!(registry.len(), 0);
    let (observation, body) = server.observed.await.unwrap();
    assert!(observation.client_disconnected);
    assert_eq!(observation.request_count, 1, "no silent retry");
    assert!(observation.request_line.starts_with("POST /v1/responses "));
    assert!(observation.saw_authorization);
    assert_eq!(body["stream"], true);
    assert_eq!(body["store"], false);
    for field in [
        "messages",
        "stream_options",
        "max_tokens",
        "response_format",
        "previous_response_id",
        "conversation",
        "background",
        "tools",
    ] {
        assert!(
            body.get(field).is_none(),
            "unexpected request field {field}"
        );
    }
    (events, observation, body)
}

#[tokio::test]
async fn responses_official_shaped_fixture_maps_requests_and_existing_consumer_results() {
    for case in fixture_cases() {
        let req: AiExecutionRequest = serde_json::from_value(case["request"].clone()).unwrap();
        let upstream = case["upstreamEvents"].as_array().unwrap();
        let (events, _, body) = execute(
            Wire {
                bytes: wire_events(upstream, false),
                hold_open: true,
                ..Wire::default()
            },
            req,
        )
        .await;
        assert_eq!(body["model"], "fixture-model");
        assert_eq!(body["input"], case["request"]["messages"]);
        assert_eq!(body["max_output_tokens"], 256);
        assert_eq!(body["temperature"], 0.25);
        if case["name"] == "json" {
            assert_eq!(body["text"]["format"], json!({"type":"json_object"}));
        } else {
            assert!(body.get("text").is_none());
        }
        let expected = case["events"].as_array().unwrap().last().unwrap()["result"].clone();
        assert_eq!(
            serde_json::to_value(terminals(&events)[0]).unwrap(),
            expected
        );
        assert_eq!(text_delta(&events), expected["output"]["text"]);
        assert_eq!(
            reasoning_delta(&events),
            expected["output"]["reasoning"].as_str().unwrap_or("")
        );
        assert!(!serde_json::to_string(&events)
            .unwrap()
            .contains("synthetic-opaque"));
        if let Ok(directory) = std::env::var("MAHO_NATIVE_EVENT_FIXTURE_DIR") {
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                std::path::Path::new(&directory)
                    .join(format!("responses-{}.json", case["name"].as_str().unwrap())),
                serde_json::to_vec_pretty(&events).unwrap(),
            )
            .unwrap();
        }
    }
}

#[tokio::test]
async fn responses_nonblank_output_matches_the_existing_js_contract() {
    for (text, completed) in [("\u{0085}", true), ("\u{feff}", false)] {
        let mut case = fixture_cases()[0].clone();
        let events = case["upstreamEvents"].as_array_mut().unwrap();
        let mut sent_text = false;
        for event in events.iter_mut() {
            match event["type"].as_str().unwrap() {
                "response.output_text.delta" => {
                    event["delta"] = json!(if sent_text { "" } else { text });
                    sent_text = true;
                }
                "response.output_text.done" => event["text"] = json!(text),
                "response.content_part.done" => event["part"]["text"] = json!(text),
                "response.output_item.done" => event["item"]["content"][0]["text"] = json!(text),
                "response.completed" => {
                    event["response"]["output"][0]["content"][0]["text"] = json!(text)
                }
                _ => {}
            }
        }
        let (received, _, _) = execute(
            Wire {
                bytes: wire_events(events, false),
                ..Wire::default()
            },
            request("responses-whitespace"),
        )
        .await;
        assert_eq!(
            matches!(terminals(&received)[0], AiExecutionResult::Completed(_)),
            completed
        );
        assert_eq!(text_delta(&received), text);
    }
}

#[tokio::test]
async fn responses_utf8_every_byte_and_multiline_data_preserve_content() {
    let case = &fixture_cases()[0];
    let req: AiExecutionRequest = serde_json::from_value(case["request"].clone()).unwrap();
    let (events, _, _) = execute(
        Wire {
            bytes: wire_events(case["upstreamEvents"].as_array().unwrap(), true),
            byte_chunks: true,
            ..Wire::default()
        },
        req,
    )
    .await;
    assert!(
        matches!(terminals(&events)[0], AiExecutionResult::Completed(result) if result.output.text.as_deref() == Some("魔法少女・かなé🪄"))
    );
}

#[tokio::test]
async fn responses_metadata_preserves_text_and_leaves_the_outcome_to_the_terminal() {
    let cases = fixture_cases();
    let upstream = cases[0]["upstreamEvents"].as_array().unwrap();
    let (terminal, before_terminal) = upstream.split_last().unwrap();
    let sequence = terminal["sequence_number"].as_u64().unwrap();
    let mut prefix = wire_events(before_terminal, false);
    prefix.extend(wire_events(
        &[json!({
            "type": "response.metadata",
            "sequence_number": sequence,
            "metadata": {"sample": "synthetic-responses-metadata"},
        })],
        false,
    ));

    let mut completed = terminal.clone();
    completed["sequence_number"] = json!(sequence + 1);
    let filtered = json!({
        "type": "response.incomplete",
        "sequence_number": sequence + 1,
        "response": {"status": "incomplete", "incomplete_details": {"reason": "content_filter"}},
    });

    for ending in [completed, filtered] {
        let expect_completed = ending["type"] == "response.completed";
        let mut bytes = prefix.clone();
        bytes.extend(wire_events(&[ending], false));
        let (events, _, _) = execute(
            Wire {
                bytes,
                hold_open: true,
                ..Wire::default()
            },
            request("responses-metadata"),
        )
        .await;
        let result = terminals(&events)[0];
        if expect_completed {
            assert!(matches!(result, AiExecutionResult::Completed(result)
                if result.output.text.as_deref() == Some("魔法少女・かなé🪄")));
        } else {
            assert!(matches!(result, AiExecutionResult::Failed(result)
                if result.error.code == "content-filtered"));
        }
        assert_eq!(text_delta(&events), "魔法少女・かなé🪄");
        assert!(!serde_json::to_string(&events)
            .unwrap()
            .contains("synthetic-responses-metadata"));
    }
}

#[tokio::test]
async fn responses_failures_keep_partial_text_and_do_not_accept_chat_done_as_terminal() {
    let case = &fixture_cases()[0];
    let all = case["upstreamEvents"].as_array().unwrap();
    let partial: Vec<Value> = all
        .iter()
        .take_while(|event| event["type"] != "response.output_text.done")
        .cloned()
        .collect();
    let mut wrong_status = all.last().unwrap().clone();
    wrong_status["response"]["status"] = json!("in_progress");
    let failure_cases = [
        ("eof", None, "invalid-response"),
        ("done", Some(json!("[DONE]")), "invalid-response"),
        (
            "error",
            Some(
                json!({"type":"error","sequence_number":99,"code":"rate_limit_exceeded","message":"synthetic-responses-key"}),
            ),
            "rate-limited",
        ),
        (
            "failed",
            Some(
                json!({"type":"response.failed","sequence_number":99,"response": {"id":"resp_fixture","status":"failed","error":{"code":"server_error","message":"synthetic-responses-key"},"output":[]}}),
            ),
            "internal-error",
        ),
        (
            "length",
            Some(
                json!({"type":"response.incomplete","sequence_number":99,"response":{"id":"resp_fixture","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[]}}),
            ),
            "output-too-large",
        ),
        (
            "filter",
            Some(
                json!({"type":"response.incomplete","sequence_number":99,"response":{"id":"resp_fixture","status":"incomplete","incomplete_details":{"reason":"content_filter"},"output":[]}}),
            ),
            "content-filtered",
        ),
        (
            "other",
            Some(
                json!({"type":"response.incomplete","sequence_number":99,"response":{"id":"resp_fixture","status":"incomplete","incomplete_details":{"reason":"unknown"},"output":[]}}),
            ),
            "invalid-response",
        ),
        ("wrong-status", Some(wrong_status), "invalid-response"),
    ];
    for (name, ending, code) in failure_cases {
        let mut bytes = wire_events(&partial, false);
        if let Some(event) = ending {
            if event.is_string() {
                bytes.extend_from_slice(b"data: [DONE]\n\n");
            } else {
                bytes.extend_from_slice(&wire_events(&[event], false));
            }
        }
        let req = request(&format!("responses-{name}"));
        let (events, _, _) = execute(
            Wire {
                bytes,
                ..Wire::default()
            },
            req.clone(),
        )
        .await;
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == code),
            "{name}: {:?}",
            terminals(&events)[0]
        );
        assert_eq!(
            text_delta(&events),
            "魔法少女・かなé🪄",
            "{name}: keep partial output"
        );
        assert!(!serde_json::to_string(&events)
            .unwrap()
            .contains("synthetic-responses-key"));
        if let Ok(directory) = std::env::var("MAHO_NATIVE_EVENT_FIXTURE_DIR") {
            std::fs::create_dir_all(&directory).unwrap();
            let packet = json!({ "request": req, "events": events, "expectedCode": code });
            std::fs::write(
                std::path::Path::new(&directory).join(format!("responses-failure-{name}.json")),
                serde_json::to_vec_pretty(&packet).unwrap(),
            )
            .unwrap();
        }
    }
}

#[tokio::test]
async fn responses_chat_done_before_valid_terminal_is_not_a_success_or_a_stream_cutoff() {
    let case = &fixture_cases()[0];
    let all = case["upstreamEvents"].as_array().unwrap();
    let mut bytes = wire_events(&all[..all.len() - 1], false);
    bytes.extend_from_slice(b"data: [DONE]\n\n");
    bytes.extend_from_slice(&wire_events(&all[all.len() - 1..], false));
    let (events, _, _) = execute(
        Wire {
            bytes,
            ..Wire::default()
        },
        request("responses-done-before-completed"),
    )
    .await;
    // A Chat-only marker is not valid Responses data; it must not turn a partial
    // response into a completed result or silently hide subsequent protocol data.
    assert!(
        matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == "invalid-response")
    );
}

#[tokio::test]
async fn responses_completed_is_exactly_once_and_late_events_do_not_mutate_output() {
    let case = &fixture_cases()[0];
    let all = case["upstreamEvents"].as_array().unwrap();
    let mut events_wire = all.clone();
    events_wire.push(all.last().unwrap().clone());
    events_wire.push(json!({"type":"response.output_text.delta","item_id":"msg_fixture_0","output_index":0,"content_index":0,"delta":"late"}));
    events_wire.push(json!({"type":"error","code":"server_error","message":"late"}));
    let (events, _, _) = execute(
        Wire {
            bytes: wire_events(&events_wire, false),
            hold_open: true,
            ..Wire::default()
        },
        request("responses-late"),
    )
    .await;
    assert!(
        matches!(terminals(&events)[0], AiExecutionResult::Completed(result) if result.output.text.as_deref() == Some("魔法少女・かなé🪄"))
    );
    assert_eq!(text_delta(&events), "魔法少女・かなé🪄");
}

#[tokio::test]
async fn responses_mixed_unsupported_items_or_content_fail_instead_of_silently_succeeding() {
    for unsupported in [
        json!({"id":"call_fixture","type":"function_call","call_id":"call_1","name":"unsupported","arguments":"{}","status":"completed"}),
        json!({"id":"image_fixture","type":"image_generation_call","result":"synthetic-image","status":"completed"}),
    ] {
        let case = &fixture_cases()[0];
        let mut upstream = case["upstreamEvents"].as_array().unwrap().clone();
        upstream.last_mut().unwrap()["response"]["output"]
            .as_array_mut()
            .unwrap()
            .push(unsupported);
        let (events, _, _) = execute(
            Wire {
                bytes: wire_events(&upstream, false),
                ..Wire::default()
            },
            request("responses-mixed-final"),
        )
        .await;
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == "invalid-response")
        );
        assert_eq!(text_delta(&events), "魔法少女・かなé🪄");
    }
    for event in [
        json!({"type":"response.output_item.added","sequence_number":99,"output_index":1,"item":{"id":"call_fixture","type":"function_call","call_id":"call_1","name":"unsupported","arguments":"","status":"in_progress"}}),
        json!({"type":"response.output_item.added","sequence_number":99,"output_index":1,"item":{"id":"image_fixture","type":"image_generation_call","result":null,"status":"in_progress"}}),
        json!({"type":"response.refusal.delta","sequence_number":99,"item_id":"msg_fixture_0","output_index":0,"content_index":0,"delta":"not available"}),
    ] {
        let case = &fixture_cases()[0];
        let all = case["upstreamEvents"].as_array().unwrap();
        let mut partial = all[..all.len() - 1].to_vec();
        let refusal = event["type"] == "response.refusal.delta";
        partial.push(event);
        let (events, _, _) = execute(
            Wire {
                bytes: wire_events(&partial, false),
                ..Wire::default()
            },
            request("responses-mixed-added"),
        )
        .await;
        let expected = if refusal {
            "content-filtered"
        } else {
            "invalid-response"
        };
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == expected)
        );
        assert_eq!(text_delta(&events), "魔法少女・かなé🪄");
    }
}

#[tokio::test]
async fn responses_invalid_utf8_and_non_success_http_are_honest_failures_without_retry() {
    for bytes in [vec![0xff], vec![0xf0, 0x9f]] {
        let (events, _, _) = execute(
            Wire {
                bytes,
                byte_chunks: true,
                ..Wire::default()
            },
            request("responses-invalid-utf8"),
        )
        .await;
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == "invalid-response")
        );
    }
    for (status, code) in [
        (401, "authentication-failed"),
        (403, "permission-denied"),
        (429, "rate-limited"),
    ] {
        let (events, _, _) = execute(
            Wire {
                bytes: b"synthetic-responses-key".to_vec(),
                http_status: Some(status),
                ..Wire::default()
            },
            request("responses-http-error"),
        )
        .await;
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == code)
        );
        assert!(!serde_json::to_string(&events)
            .unwrap()
            .contains("synthetic-responses-key"));
    }
}

#[tokio::test]
async fn responses_cancellation_drops_body_and_pending_headers_with_partial_output_retained() {
    for delay_headers in [false, true] {
        let case = &fixture_cases()[0];
        let all = case["upstreamEvents"].as_array().unwrap();
        let partial: Vec<Value> = all
            .iter()
            .take_while(|event| event["type"] != "response.output_text.done")
            .cloned()
            .collect();
        let server = responses_server(Wire {
            bytes: wire_events(&partial, false),
            hold_open: true,
            delay_headers,
            ..Wire::default()
        })
        .await;
        let store = LocalStore::open_in_memory().unwrap();
        store
            .put("responses", &profile(&server.base_url), "t")
            .unwrap();
        let secrets = TestSecretStore::default();
        secrets
            .set("provider:responses:api-key", "synthetic-responses-key")
            .unwrap();
        let registry = RequestRegistry::default();
        let sink = CollectingSink::default();
        let stream = stream_direct_ai(
            "responses",
            request("responses-cancel"),
            &store,
            &secrets,
            &registry,
            &sink,
        );
        tokio::pin!(stream);
        tokio::select! {
            result = &mut stream => panic!("unexpected completion before cancellation: {result:?}"),
            _ = async {
                server.request_received.await.unwrap();
                if !delay_headers {
                    tokio::time::timeout(std::time::Duration::from_secs(5), async {
                        while text_delta(&sink.snapshot()).is_empty() {
                            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                        }
                    }).await.expect("partial text must flush while body is idle");
                }
            } => {}
        }
        assert!(registry.cancel("responses-cancel"));
        tokio::time::timeout(std::time::Duration::from_secs(5), stream)
            .await
            .unwrap()
            .unwrap();
        let events = sink.snapshot();
        assert_well_formed(&events, "responses-cancel");
        assert!(matches!(
            terminals(&events)[0],
            AiExecutionResult::Cancelled(_)
        ));
        assert_eq!(
            text_delta(&events),
            if delay_headers {
                ""
            } else {
                "魔法少女・かなé🪄"
            }
        );
        let (observation, _) = server.observed.await.unwrap();
        assert!(observation.client_disconnected);
        assert_eq!(observation.request_count, 1);
        assert_eq!(registry.len(), 0);
    }
}

fn text_events(text: &str) -> Vec<Value> {
    let case = &fixture_cases()[0];
    let mut upstream = case["upstreamEvents"].as_array().unwrap().clone();
    // Keep a tiny accepted prefix so overflow must preserve earlier deltas.
    let deltas = upstream
        .iter_mut()
        .filter(|event| event["type"] == "response.output_text.delta")
        .collect::<Vec<_>>();
    for (index, event) in deltas.into_iter().enumerate() {
        event["delta"] = if index == 0 {
            json!(&text[..1])
        } else {
            json!(&text[1..])
        };
    }
    for event in &mut upstream {
        match event["type"].as_str().unwrap() {
            "response.output_text.done" => event["text"] = json!(text),
            "response.content_part.done" => event["part"]["text"] = json!(text),
            "response.output_item.done" => event["item"]["content"][0]["text"] = json!(text),
            "response.completed" => {
                event["response"]["output"][0]["content"][0]["text"] = json!(text)
            }
            _ => {}
        }
    }
    upstream
}

#[tokio::test]
async fn responses_arena_large_output_uses_fixed_budget_and_bounded_ipc_deltas() {
    for (size, accepted) in [
        (crate::ai::ARENA_OUTPUT_CONTENT_BYTES, true),
        (crate::ai::ARENA_OUTPUT_CONTENT_BYTES + 1, false),
    ] {
        let text = "x".repeat(size);
        let bytes = wire_events(&text_events(&text), false);
        let (events, _, _) = execute(
            Wire {
                bytes,
                ..Wire::default()
            },
            arena_request("responses-arena-budget"),
        )
        .await;
        if accepted {
            assert!(
                matches!(terminals(&events)[0], AiExecutionResult::Completed(result) if result.output.text.as_deref() == Some(text.as_str()))
            );
            assert_eq!(text_delta(&events).len(), size);
            assert!(events.iter().all(|event| match event {
                AiStreamEvent::TextDelta { delta, .. } =>
                    delta.encode_utf16().count() <= crate::ai::AI_STREAM_MAX_DELTA_UTF16_UNITS,
                _ => true,
            }));
        } else {
            assert!(
                matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == "output-too-large")
            );
            assert_eq!(text_delta(&events), "x");
        }
    }
}
