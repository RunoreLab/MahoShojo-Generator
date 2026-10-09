//! Direct AI 执行核的端到端测试。
//!
//! 这里启动一个**进程内**的 OpenAI-compatible SSE 服务，再通过真实的 `reqwest` 客户端驱动
//! `stream_direct_ai`。目的不是测 HTTP 库，而是证明三条产品级不变量：
//!
//! 1. 事件序列以 `started` 开始、`sequence` 连续、**终态恰好一次**；
//! 2. 取消**真正中止上游 body** —— 由服务端观察到客户端断连来证明，而不是只看本地返回值；
//! 3. 上游缺少 `[DONE]` 时不会被当成成功。
//!
//! 用进程内服务而不是 mock，是因为"上游是否真的被断开"只能在真实 socket 上观察到。

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::ai::{
    stream_direct_ai, AiExecutionMessage, AiExecutionMode, AiExecutionRequest, AiExecutionResult,
    AiStreamEvent, EventSink, RequestRegistry,
};
use crate::secret::{SecretStore, SecretStoreError};
use crate::store::LocalStore;

/// 服务端在测试结束时观察到的事实。
#[derive(Debug, Clone, PartialEq, Eq)]
struct ServerObservation {
    /// 是否观察到客户端断连（读到 EOF）。这是"上游 body 真的被中止"的证据。
    client_disconnected: bool,
    /// 收到的请求行，用于确认端点路径拼接正确。
    request_line: String,
    /// 收到的 Authorization header 是否存在。
    saw_authorization: bool,
}

#[derive(Debug, Clone)]
enum Scenario {
    /// 正常流：三段正文 + usage + `[DONE]`。
    Complete,
    /// 发一段正文后永久挂起，用于验证取消。
    Hang,
    /// 发正文与 `[DONE]` 后保持 socket 打开，终态不能依赖 HTTP EOF。
    DoneHang,
    /// 发一段正文后直接断开且不发 `[DONE]`。
    Truncated,
    /// 接受请求后延迟 response headers，用于验证 headers 未到时可以取消 send。
    DelayHeaders,
    /// 逐字节 HTTP chunk，用于覆盖 UTF-8 字符与传输分块边界互不对齐。
    ByteChunks(Vec<u8>),
    /// 完整 SSE 载荷，覆盖大帧但不把每个字节扩成独立 HTTP chunk。
    RawBytes(Vec<u8>),
}

struct TestServer {
    base_url: String,
    observation: oneshot::Receiver<ServerObservation>,
    request_received: oneshot::Receiver<()>,
}

async fn spawn_sse_server(scenario: Scenario) -> TestServer {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test server must bind to an ephemeral port");
    let port = listener
        .local_addr()
        .expect("local address must resolve")
        .port();
    let (tx, rx) = oneshot::channel();
    let (request_received_tx, request_received_rx) = oneshot::channel();

    tokio::spawn(async move {
        let observation = serve_one(listener, scenario, request_received_tx).await;
        let _ = tx.send(observation);
    });

    TestServer {
        base_url: format!("http://127.0.0.1:{port}/v1"),
        observation: rx,
        request_received: request_received_rx,
    }
}

async fn serve_one(
    listener: TcpListener,
    scenario: Scenario,
    request_received: oneshot::Sender<()>,
) -> ServerObservation {
    let (mut stream, _) = match listener.accept().await {
        Ok(accepted) => accepted,
        Err(_) => {
            return ServerObservation {
                client_disconnected: false,
                request_line: String::new(),
                saw_authorization: false,
            };
        }
    };

    let (request_line, saw_authorization) = read_request_head(&mut stream).await;
    let _ = request_received.send(());

    if matches!(&scenario, Scenario::DelayHeaders) {
        // Deliberately withhold response headers. The client must be able to cancel
        // the in-flight send after registration without waiting for a response.
        return observe_disconnect(stream, request_line, saw_authorization).await;
    }

    if let Scenario::ByteChunks(bytes) = &scenario {
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await;
        for byte in bytes {
            if stream
                .write_all(&[b'1', b'\r', b'\n', *byte, b'\r', b'\n'])
                .await
                .is_err()
            {
                break;
            }
        }
        let _ = stream.write_all(b"0\r\n\r\n").await;
        let _ = stream.shutdown().await;
        return observe_disconnect(stream, request_line, saw_authorization).await;
    }

    write_response_head(&mut stream).await;

    match scenario {
        Scenario::Complete => {
            for payload in [
                r#"{"choices":[{"delta":{"content":"魔法"},"index":0}]}"#,
                r#"{"choices":[{"delta":{"content":"少女"},"index":0}]}"#,
                r#"{"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"input_tokens":7,"output_tokens":2,"total_tokens":9}}"#,
            ] {
                if write_sse_frame(&mut stream, payload).await.is_err() {
                    return observe_disconnect(stream, request_line, saw_authorization).await;
                }
            }
            let _ = write_sse_raw(&mut stream, "data: [DONE]\n\n").await;
            let _ = stream.shutdown().await;
            observe_disconnect(stream, request_line, saw_authorization).await
        }
        Scenario::Truncated => {
            let _ = write_sse_frame(
                &mut stream,
                r#"{"choices":[{"delta":{"content":"半截"},"index":0}]}"#,
            )
            .await;
            let _ = stream.shutdown().await;
            observe_disconnect(stream, request_line, saw_authorization).await
        }
        Scenario::Hang => {
            let _ = write_sse_frame(
                &mut stream,
                r#"{"choices":[{"delta":{"content":"开头"},"index":0}]}"#,
            )
            .await;
            observe_disconnect(stream, request_line, saw_authorization).await
        }
        Scenario::DoneHang => {
            let _ = write_sse_frame(
                &mut stream,
                r#"{"choices":[{"delta":{"content":"完成"},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}"#,
            )
            .await;
            let _ = write_sse_raw(&mut stream, "data: [DONE]\n\n").await;
            observe_disconnect(stream, request_line, saw_authorization).await
        }
        Scenario::DelayHeaders => unreachable!("handled before writing response headers"),
        Scenario::ByteChunks(_) => unreachable!("handled before writing response headers"),
        Scenario::RawBytes(bytes) => {
            let _ = stream.write_all(&bytes).await;
            let _ = stream.shutdown().await;
            observe_disconnect(stream, request_line, saw_authorization).await
        }
    }
}

/// 一直读到客户端断开为止。
///
/// 这是本文件的核心证据：只有客户端真的 drop 了 response body，这里才会返回。
async fn observe_disconnect(
    mut stream: TcpStream,
    request_line: String,
    saw_authorization: bool,
) -> ServerObservation {
    let mut buffer = [0_u8; 256];
    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(20), stream.read(&mut buffer))
            .await
        {
            // 读到 0 字节 = 对端关闭了写方向，也就是我们的 response body 被中止了。
            Ok(Ok(0)) => {
                return ServerObservation {
                    client_disconnected: true,
                    request_line,
                    saw_authorization,
                };
            }
            Ok(Ok(_)) => continue,
            Ok(Err(_)) => {
                return ServerObservation {
                    client_disconnected: true,
                    request_line,
                    saw_authorization,
                };
            }
            // 超时仍未断开：对挂起场景来说意味着测试没能证明取消生效。
            Err(_) => {
                return ServerObservation {
                    client_disconnected: false,
                    request_line,
                    saw_authorization,
                };
            }
        }
    }
}

async fn read_request_head(stream: &mut TcpStream) -> (String, bool) {
    let mut head = Vec::new();
    let mut chunk = [0_u8; 1024];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => head.extend_from_slice(&chunk[..read]),
        }
    }

    let text = String::from_utf8_lossy(&head).to_string();
    let request_line = text.lines().next().unwrap_or_default().trim().to_string();
    (
        request_line,
        text.to_ascii_lowercase().contains("authorization:"),
    )
}

/// 响应头刻意**不**声明 Content-Length 或 chunked 编码，而是靠关闭连接表示结束。
///
/// 这样服务端可以持续增量写出而不必预知总长度，也避免了手写 chunk 分帧出错；
/// 代价是"正常结束"必须显式 shutdown，"被取消"则表现为客户端断开——而后者正是
/// `observe_disconnect` 要观察的东西。
async fn write_response_head(stream: &mut TcpStream) {
    let _ = stream
        .write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        )
        .await;
    let _ = stream.flush().await;
}

async fn write_sse_frame(stream: &mut TcpStream, payload: &str) -> std::io::Result<()> {
    write_sse_raw(stream, &format!("data: {payload}\n\n")).await
}

async fn write_sse_raw(stream: &mut TcpStream, raw: &str) -> std::io::Result<()> {
    stream.write_all(raw.as_bytes()).await?;
    stream.flush().await
}

/// 收集事件的测试用汇。
#[derive(Default)]
struct CollectingSink {
    events: Mutex<Vec<AiStreamEvent>>,
}

impl CollectingSink {
    fn snapshot(&self) -> Vec<AiStreamEvent> {
        self.events.lock().expect("sink lock").clone()
    }
}

impl EventSink for CollectingSink {
    fn send(&self, event: AiStreamEvent) -> Result<(), ()> {
        self.events.lock().map_err(|_| ())?.push(event);
        Ok(())
    }
}

#[derive(Default)]
struct TerminalFailingSink {
    attempts: Mutex<Vec<AiStreamEvent>>,
    accepted: Mutex<Vec<AiStreamEvent>>,
}

impl EventSink for TerminalFailingSink {
    fn send(&self, event: AiStreamEvent) -> Result<(), ()> {
        self.attempts.lock().map_err(|_| ())?.push(event.clone());
        if matches!(event, AiStreamEvent::Result { .. }) {
            return Err(());
        }
        self.accepted.lock().map_err(|_| ())?.push(event);
        Ok(())
    }
}

#[derive(Default)]
struct TestSecretStore {
    values: Mutex<BTreeMap<String, String>>,
}

impl SecretStore for TestSecretStore {
    fn set(&self, secret_ref: &str, value: &str) -> Result<(), SecretStoreError> {
        self.values
            .lock()
            .map_err(|_| SecretStoreError::failure_for_test())?
            .insert(secret_ref.to_string(), value.to_string());
        Ok(())
    }

    fn exists(&self, secret_ref: &str) -> Result<bool, SecretStoreError> {
        Ok(self
            .values
            .lock()
            .map_err(|_| SecretStoreError::failure_for_test())?
            .contains_key(secret_ref))
    }

    fn delete(&self, secret_ref: &str) -> Result<(), SecretStoreError> {
        self.values
            .lock()
            .map_err(|_| SecretStoreError::failure_for_test())?
            .remove(secret_ref);
        Ok(())
    }

    fn resolve(&self, secret_ref: &str) -> Result<Option<String>, SecretStoreError> {
        Ok(self
            .values
            .lock()
            .map_err(|_| SecretStoreError::failure_for_test())?
            .get(secret_ref)
            .cloned())
    }
}

fn stored_profile(id: &str, base_url: &str, with_api_key: bool) -> String {
    serde_json::json!({
        "version": 1,
        "id": id,
        "name": "Loopback",
        "adapter": "openai-compatible",
        "baseUrl": base_url,
        "modelId": "test-model",
        "createdAt": "2026-09-30T00:00:00.000Z",
        "updatedAt": "2026-09-30T00:00:00.000Z",
        "apiKeyRef": if with_api_key { Some(format!("provider:{id}:api-key")) } else { None },
    })
    .to_string()
}

fn request(request_id: &str) -> AiExecutionRequest {
    AiExecutionRequest {
        request_id: request_id.to_string(),
        contract_version: 1,
        mode: AiExecutionMode::DirectLocal,
        messages: vec![AiExecutionMessage {
            role: "user".to_string(),
            content: "hello".to_string(),
        }],
        model_id: None,
        max_output_tokens: None,
        temperature: None,
        response_format: None,
    }
}

fn sequences(events: &[AiStreamEvent]) -> Vec<u32> {
    events
        .iter()
        .map(|event| match event {
            AiStreamEvent::Started { sequence, .. }
            | AiStreamEvent::TextDelta { sequence, .. }
            | AiStreamEvent::ReasoningDelta { sequence, .. }
            | AiStreamEvent::Usage { sequence, .. }
            | AiStreamEvent::Result { sequence, .. } => *sequence,
        })
        .collect()
}

fn terminals(events: &[AiStreamEvent]) -> Vec<&AiExecutionResult> {
    events
        .iter()
        .filter_map(|event| match event {
            AiStreamEvent::Result { result, .. } => Some(result),
            _ => None,
        })
        .collect()
}

fn assert_well_formed(events: &[AiStreamEvent], request_id: &str) {
    assert!(
        matches!(events.first(), Some(AiStreamEvent::Started { .. })),
        "the first event must be started, got {:?}",
        events.first()
    );

    let expected: Vec<u32> = (0..events.len() as u32).collect();
    assert_eq!(
        sequences(events),
        expected,
        "sequence must be continuous and start at 0"
    );

    assert_eq!(
        terminals(events).len(),
        1,
        "exactly one terminal event is allowed, got {}",
        terminals(events).len()
    );

    for event in events {
        let (id, version, _) = event.identity();
        assert_eq!(
            id, request_id,
            "every event must carry the request identity"
        );
        assert_eq!(version, 1);
    }
}

#[tokio::test]
async fn done_marker_completes_and_disconnects_without_waiting_for_http_eof() {
    let server = spawn_sse_server(Scenario::DoneHang).await;
    let store = LocalStore::open_in_memory().unwrap();
    store
        .put(
            "done-open",
            &stored_profile("done-open", &server.base_url, false),
            "t",
        )
        .unwrap();
    let sink = CollectingSink::default();
    let registry = RequestRegistry::default();
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        stream_direct_ai(
            "done-open",
            request("req-done-open"),
            &store,
            &TestSecretStore::default(),
            &registry,
            &sink,
        ),
    )
    .await;
    assert!(
        result.is_ok(),
        "[DONE] must terminate an otherwise open HTTP body"
    );
    result.unwrap().unwrap();
    let events = sink.snapshot();
    assert_well_formed(&events, "req-done-open");
    assert!(
        matches!(terminals(&events)[0], AiExecutionResult::Completed(result)
        if result.output.text.as_deref() == Some("完成") && result.usage.as_ref().and_then(|usage| usage.total_tokens) == Some(5))
    );
    assert!(server.observation.await.unwrap().client_disconnected);
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn unicode_http_byte_chunks_preserve_text_and_reject_malformed_or_incomplete_utf8() {
    let text = "魔法少女・かなé🪄";
    let good = format!(
        "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{text}\"}}}}]}}\n\ndata: [DONE]\n\n"
    )
    .into_bytes();
    let invalid = vec![0xff];
    // DONE 是应用协议终态：此前不完整 UTF-8 必须失败；此后字节不再消费。
    let mut after_done = good.clone();
    after_done.extend_from_slice(&[0xf0, 0x9f]);
    let incomplete = vec![0xf0, 0x9f];
    for (wire, expected_text) in [
        (good, Some(text)),
        (invalid, None),
        (incomplete, None),
        (after_done, Some(text)),
    ] {
        let server = spawn_sse_server(Scenario::ByteChunks(wire)).await;
        let store = LocalStore::open_in_memory().expect("in-memory store");
        store
            .put(
                "loopback",
                &stored_profile("loopback", &server.base_url, false),
                "t",
            )
            .expect("put");
        let registry = RequestRegistry::default();
        let sink = CollectingSink::default();
        stream_direct_ai(
            "loopback",
            request("req-utf8"),
            &store,
            &TestSecretStore::default(),
            &registry,
            &sink,
        )
        .await
        .expect("terminal event delivered");
        let events = sink.snapshot();
        assert_well_formed(&events, "req-utf8");
        match (terminals(&events)[0], expected_text) {
            (AiExecutionResult::Completed(result), Some(expected)) => {
                assert_eq!(result.output.text.as_deref(), Some(expected))
            }
            (AiExecutionResult::Failed(result), None) => {
                assert_eq!(result.error.code, "invalid-response")
            }
            (result, expected) => {
                panic!("unexpected terminal {result:?}, expected text {expected:?}")
            }
        }
        assert_eq!(registry.len(), 0);
        assert!(
            server
                .observation
                .await
                .expect("server observation")
                .client_disconnected
        );
    }
}

#[tokio::test]
async fn streams_a_complete_response_with_exactly_one_terminal() {
    let server = spawn_sse_server(Scenario::Complete).await;
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();

    store
        .put(
            "loopback",
            &stored_profile("loopback", &server.base_url, true),
            "t",
        )
        .expect("put");
    secrets
        .set("provider:loopback:api-key", "sk-test")
        .expect("set secret");

    stream_direct_ai(
        "loopback",
        request("req-complete"),
        &store,
        &secrets,
        &registry,
        &sink,
    )
    .await
    .expect("stream must succeed");

    let events = sink.snapshot();
    assert_well_formed(&events, "req-complete");

    let text: String = events
        .iter()
        .filter_map(|event| match event {
            AiStreamEvent::TextDelta { delta, .. } => Some(delta.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        text.contains("魔法少女"),
        "text deltas must be forwarded, got {text:?}"
    );

    assert!(
        events
            .iter()
            .any(|event| matches!(event, AiStreamEvent::Usage { .. })),
        "the usage event must be forwarded when the provider reports it"
    );

    match terminals(&events)[0] {
        AiExecutionResult::Completed(result) => {
            assert_eq!(result.output.text.as_deref(), Some("魔法少女"));
            assert_eq!(result.usage.as_ref().and_then(|u| u.total_tokens), Some(9));
            assert_eq!(
                result.resolved_model_id.as_deref(),
                Some("test-model"),
                "omitting request.modelId must report the Profile model used for dispatch"
            );
        }
        other => panic!("expected a completed terminal, got {other:?}"),
    }

    let observation = server.observation.await.expect("observation must arrive");
    assert!(
        observation.request_line.contains("/v1/chat/completions"),
        "the endpoint must be built from the profile base URL, got {}",
        observation.request_line
    );
    assert!(
        observation.saw_authorization,
        "a stored API key must reach the provider as an Authorization header"
    );
    assert_eq!(
        registry.len(),
        0,
        "the request must be released from the registry when it finishes"
    );
}

#[tokio::test]
async fn terminal_sink_failure_does_not_retry_with_a_duplicate_terminal() {
    let server = spawn_sse_server(Scenario::Complete).await;
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = TerminalFailingSink::default();

    store
        .put(
            "loopback",
            &stored_profile("loopback", &server.base_url, false),
            "t",
        )
        .expect("put");

    let error = stream_direct_ai(
        "loopback",
        request("req-sink-failure"),
        &store,
        &secrets,
        &registry,
        &sink,
    )
    .await
    .expect_err("a closed event sink must fail the command");

    let accepted = sink.accepted.lock().expect("accepted events").clone();
    let attempts = sink.attempts.lock().expect("event attempts").clone();
    assert!(matches!(
        accepted.first(),
        Some(AiStreamEvent::Started { sequence: 0, .. })
    ));
    assert_eq!(
        accepted.len(),
        3,
        "started, usage, and text are delivered before terminal delivery fails"
    );
    assert!(matches!(
        accepted.get(1),
        Some(AiStreamEvent::Usage { sequence: 1, .. })
    ));
    assert!(matches!(
        accepted.get(2),
        Some(AiStreamEvent::TextDelta { sequence: 2, .. })
    ));
    assert!(matches!(
        attempts.get(3),
        Some(AiStreamEvent::Result { sequence: 3, .. })
    ));
    assert_eq!(
        attempts.len(),
        4,
        "the wrapper must not retry a failed terminal at an earlier sequence"
    );
    assert!(format!("{error:?}").contains("Cancelled"));
    assert_eq!(registry.len(), 0, "the failed request must be released");
    let _ = server
        .observation
        .await
        .expect("server observation must arrive");
}

#[tokio::test]
async fn cancelling_really_aborts_the_upstream_body() {
    let server = spawn_sse_server(Scenario::Hang).await;
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = Arc::new(CollectingSink::default());

    store
        .put(
            "loopback",
            &stored_profile("loopback", &server.base_url, false),
            "t",
        )
        .expect("put");

    let store = Arc::new(store);
    let secrets = Arc::new(secrets);
    let handle = {
        let sink = Arc::clone(&sink);
        let store = Arc::clone(&store);
        let secrets = Arc::clone(&secrets);
        let registry = registry.clone();
        tokio::spawn(async move {
            stream_direct_ai(
                "loopback",
                request("req-cancel"),
                &store,
                secrets.as_ref(),
                &registry,
                sink.as_ref(),
            )
            .await
        })
    };

    // 等到第一段正文到达后再取消，确保取消发生在流进行中而不是 dispatch 之前。
    let mut observed_delta = false;
    for _ in 0..200 {
        if sink
            .snapshot()
            .iter()
            .any(|event| matches!(event, AiStreamEvent::TextDelta { .. }))
        {
            observed_delta = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(
        observed_delta,
        "the test must cancel while the stream is running"
    );

    assert!(
        registry.cancel("req-cancel"),
        "cancel must hit the in-flight request"
    );

    handle
        .await
        .expect("the streaming task must not panic")
        .expect("a cancelled stream is still a successful command");

    let events = sink.snapshot();
    assert_well_formed(&events, "req-cancel");
    match terminals(&events)[0] {
        AiExecutionResult::Cancelled(result) => {
            assert_eq!(result.reason.as_deref(), Some("aborted"))
        }
        other => panic!("expected a cancelled terminal, got {other:?}"),
    }

    // 关键证据：服务端观察到客户端断连，说明 body 真的被中止，而不是仅仅停止投递。
    let observation = server.observation.await.expect("observation must arrive");
    assert!(
        observation.client_disconnected,
        "cancelling must abort the upstream body, not just stop forwarding events"
    );
    assert_eq!(
        registry.len(),
        0,
        "the cancelled request must be released from the registry"
    );
}

#[tokio::test]
async fn cancellation_after_registration_works_while_response_headers_are_delayed() {
    let server = spawn_sse_server(Scenario::DelayHeaders).await;
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();

    store
        .put(
            "loopback",
            &stored_profile("loopback", &server.base_url, false),
            "t",
        )
        .expect("put");

    let stream = stream_direct_ai(
        "loopback",
        request("req-delayed-headers"),
        &store,
        &secrets,
        &registry,
        &sink,
    );
    tokio::pin!(stream);

    tokio::select! {
        result = &mut stream => panic!("stream completed before the delayed response headers: {result:?}"),
        received = server.request_received => received.expect("provider must receive the request"),
    }

    let events = sink.snapshot();
    assert!(
        matches!(
            events.first(),
            Some(AiStreamEvent::Started { sequence: 0, .. })
        ),
        "registration must be announced before waiting for HTTP response headers, got {events:?}"
    );
    assert!(registry.cancel("req-delayed-headers"));

    stream
        .await
        .expect("cancellation must be represented by a terminal event");
    let events = sink.snapshot();
    assert_well_formed(&events, "req-delayed-headers");
    assert!(matches!(
        terminals(&events).first(),
        Some(AiExecutionResult::Cancelled(result)) if result.reason.as_deref() == Some("aborted")
    ));

    let observation = server
        .observation
        .await
        .expect("server observation must arrive");
    assert!(
        observation.client_disconnected,
        "cancelling a request while headers are delayed must drop the pending HTTP send"
    );
    assert_eq!(registry.len(), 0, "the cancelled request must be released");
}

#[tokio::test]
async fn a_truncated_stream_is_reported_as_a_failure_not_a_success() {
    let server = spawn_sse_server(Scenario::Truncated).await;
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();

    store
        .put(
            "loopback",
            &stored_profile("loopback", &server.base_url, false),
            "t",
        )
        .expect("put");

    stream_direct_ai(
        "loopback",
        request("req-truncated"),
        &store,
        &secrets,
        &registry,
        &sink,
    )
    .await
    .expect("the command itself succeeds; the failure is carried by the terminal event");

    let events = sink.snapshot();
    assert_well_formed(&events, "req-truncated");
    match terminals(&events)[0] {
        AiExecutionResult::Failed(result) => {
            assert!(
                result
                    .error
                    .message
                    .as_deref()
                    .unwrap_or_default()
                    .contains("terminal marker"),
                "the failure must explain that the stream ended early, got {:?}",
                result.error
            );
        }
        other => panic!("a stream without [DONE] must not be reported as completed, got {other:?}"),
    }
}

#[tokio::test]
async fn a_missing_secret_fails_before_any_request_is_dispatched() {
    let server = spawn_sse_server(Scenario::Complete).await;
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();

    // Profile 声明了 apiKeyRef，但凭据存储里没有对应条目。
    store
        .put(
            "loopback",
            &stored_profile("loopback", &server.base_url, true),
            "t",
        )
        .expect("put");

    stream_direct_ai(
        "loopback",
        request("req-missing-secret"),
        &store,
        &secrets,
        &registry,
        &sink,
    )
    .await
    .expect("the post-registration failure must be carried by a terminal event");

    let events = sink.snapshot();
    assert_well_formed(&events, "req-missing-secret");
    assert!(
        matches!(terminals(&events).first(), Some(AiExecutionResult::Failed(result)) if result.error.code == "authentication-failed"),
        "the failure must be attributable to the missing secret, got {events:?}"
    );
}

#[tokio::test]
async fn an_unknown_profile_fails_without_touching_the_network() {
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();

    let error = stream_direct_ai(
        "missing",
        request("req-missing-profile"),
        &store,
        &secrets,
        &registry,
        &sink,
    )
    .await
    .expect_err("an unknown profile must fail");

    assert!(format!("{error:?}").contains("ProfileNotFound"));
    assert!(sink.snapshot().is_empty());
}

#[tokio::test]
async fn hosted_and_authoritative_modes_are_refused_by_the_direct_path() {
    let store = LocalStore::open_in_memory().expect("in-memory store");
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();

    for mode in [AiExecutionMode::Hosted, AiExecutionMode::Authoritative] {
        let mut req = request("req-wrong-mode");
        req.mode = mode;
        let error = stream_direct_ai("any", req, &store, &secrets, &registry, &sink)
            .await
            .expect_err("only direct modes may use the Direct executor");
        assert!(format!("{error:?}").contains("UnsupportedRequest"));
    }
}

#[tokio::test]
async fn a_preset_requires_no_profile_and_fails_closed_without_its_own_secret() {
    let store = LocalStore::open_in_memory().unwrap();
    let secrets = TestSecretStore::default();
    let registry = RequestRegistry::default();
    let sink = CollectingSink::default();
    let mut req = request("req-preset-missing-secret");
    req.model_id = Some("deepseek-chat".into());
    crate::ai::stream_target_ai(
        crate::provider_target::ProviderTarget::Preset {
            provider_id: "deepseek".into(),
        },
        req,
        &store,
        &secrets,
        &registry,
        &sink,
    )
    .await
    .unwrap();
    let events = sink.snapshot();
    assert_well_formed(&events, "req-preset-missing-secret");
    assert!(
        matches!(terminals(&events).first(), Some(AiExecutionResult::Failed(result))
        if result.error.code == "authentication-failed")
    );
    assert!(store.get("preset:deepseek").unwrap().is_none());
    assert!(store.get("deepseek").unwrap().is_none());
}

#[tokio::test]
async fn target_custom_preserves_legacy_model_ids_above_new_input_limit() {
    let server = spawn_sse_server(Scenario::Complete).await;
    let store = LocalStore::open_in_memory().unwrap();
    store
        .put(
            "legacy",
            &stored_profile("legacy", &server.base_url, false),
            "t",
        )
        .unwrap();
    let sink = CollectingSink::default();
    let mut req = request("req-legacy-target");
    req.model_id = Some("a".repeat(256));
    crate::ai::stream_target_ai(
        crate::provider_target::ProviderTarget::Custom {
            profile_id: "legacy".into(),
        },
        req,
        &store,
        &TestSecretStore::default(),
        &RequestRegistry::default(),
        &sink,
    )
    .await
    .unwrap();
    let events = sink.snapshot();
    assert!(
        matches!(terminals(&events).first(), Some(AiExecutionResult::Completed(result))
        if result.resolved_model_id.as_deref() == Some("a".repeat(256).as_str()))
    );
}

/// Read the full request, including a POST body, before closing a redirect socket.
async fn read_full_request(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let read = stream
            .read(&mut buffer)
            .await
            .expect("read fixture request");
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&bytes[..end]);
            let length = head
                .lines()
                .filter_map(|line| line.split_once(':'))
                .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                .map(|(_, value)| value.trim().parse::<usize>().unwrap())
                .unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                break;
            }
        }
    }
    String::from_utf8(bytes).expect("UTF-8 fixture request")
}

#[tokio::test]
async fn cross_origin_redirect_never_transmits_prompt_or_secret_header() {
    for status in [307, 308] {
        let source = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source_url = format!("http://{}/v1", source.local_addr().unwrap());
        let destination_url = format!("http://{}/leaked", destination.local_addr().unwrap());
        let redirected = tokio::spawn(async move {
            let accepted =
                tokio::time::timeout(std::time::Duration::from_millis(500), destination.accept())
                    .await;
            if let Ok(Ok((mut stream, _))) = accepted {
                let request = read_full_request(&mut stream).await;
                write_response_head(&mut stream).await;
                write_sse_raw(&mut stream, "data: [DONE]\n\n")
                    .await
                    .unwrap();
                stream.shutdown().await.unwrap();
                Some(request)
            } else {
                None
            }
        });
        let origin = tokio::spawn(async move {
            let (mut stream, _) = source.accept().await.unwrap();
            let request = read_full_request(&mut stream).await;
            stream
            .write_all(format!("HTTP/1.1 {status} Redirect\r\nLocation: {destination_url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes())
            .await
            .unwrap();
            request
        });
        let store = LocalStore::open_in_memory().unwrap();
        let mut profile: serde_json::Value =
            serde_json::from_str(&stored_profile("redirect", &source_url, false)).unwrap();
        profile["transport"] = serde_json::json!({ "maxRedirects": 1 });
        profile["secretHeaderRefs"] =
            serde_json::json!({ "x-api-key": "provider:redirect:custom-key" });
        store.put("redirect", &profile.to_string(), "t").unwrap();
        let secrets = TestSecretStore::default();
        secrets
            .set("provider:redirect:custom-key", "fixture-private-key")
            .unwrap();
        let sink = CollectingSink::default();
        let registry = RequestRegistry::default();
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            stream_direct_ai(
                "redirect",
                request("req-redirect"),
                &store,
                &secrets,
                &registry,
                &sink,
            ),
        )
        .await
        .expect("redirect result must be bounded")
        .unwrap();
        let origin_request = origin.await.unwrap();
        assert!(origin_request.contains("fixture-private-key"));
        assert!(origin_request.contains("hello"));
        assert!(
            redirected.await.unwrap().is_none(),
            "a cross-origin redirect must not send any request, prompt or custom secret header"
        );
        let events = sink.snapshot();
        assert_well_formed(&events, "req-redirect");
        assert!(matches!(
            terminals(&events)[0],
            AiExecutionResult::Failed(_)
        ));
        assert_eq!(registry.len(), 0);
    }
}

#[tokio::test]
async fn same_origin_redirects_preserve_headers_and_respect_the_configured_limit() {
    for (limit, redirects, succeeds) in [(0, 1, false), (1, 1, true), (1, 2, false), (2, 2, true)] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/start", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for index in 0..=redirects {
                let Ok(Ok((mut stream, _))) =
                    tokio::time::timeout(std::time::Duration::from_millis(500), listener.accept())
                        .await
                else {
                    break;
                };
                requests.push(read_full_request(&mut stream).await);
                let response = if index < redirects {
                    format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: /next/{index}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                } else {
                    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
                };
                stream.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            crate::ai::build_http_client(limit)
                .unwrap()
                .get(url)
                .header("x-api-key", "same-origin-key")
                .send(),
        )
        .await
        .unwrap();
        assert_eq!(
            response
                .as_ref()
                .is_ok_and(|response| response.status().is_success()),
            succeeds,
            "limit={limit}, redirects={redirects}"
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), (usize::from(limit) + 1).min(redirects + 1));
        assert!(requests
            .iter()
            .all(|request| request.contains("x-api-key: same-origin-key")));
    }
}

#[tokio::test]
async fn eof_tail_preserves_reasoning_usage_and_classifies_protocol_errors() {
    for (suffix, expected_code, has_usage) in [
        (
            r#"data: {"error":{"type":"rate_limit_error","message":"try later"}}"#,
            "rate-limited",
            false,
        ),
        ("data: {\"choices\":", "invalid-response", false),
        (
            r#"data: {"choices":[{"delta":{"reasoning_content":"tail thought","content":"tail text"},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}"#,
            "internal-error",
            true,
        ),
    ] {
        let server = spawn_sse_server(Scenario::ByteChunks(suffix.as_bytes().to_vec())).await;
        let store = LocalStore::open_in_memory().unwrap();
        store
            .put(
                "tail",
                &stored_profile("tail", &server.base_url, false),
                "t",
            )
            .unwrap();
        let sink = CollectingSink::default();
        stream_direct_ai(
            "tail",
            request("req-tail"),
            &store,
            &TestSecretStore::default(),
            &RequestRegistry::default(),
            &sink,
        )
        .await
        .unwrap();
        let events = sink.snapshot();
        assert_well_formed(&events, "req-tail");
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == expected_code),
            "{events:?}"
        );
        if has_usage {
            assert!(events.iter().any(|event| matches!(event, AiStreamEvent::ReasoningDelta { delta, .. } if delta == "tail thought")));
            assert!(events.iter().any(|event| matches!(event, AiStreamEvent::TextDelta { delta, .. } if delta == "tail text")));
            assert!(events.iter().any(|event| matches!(event, AiStreamEvent::Usage { usage, .. } if usage.total_tokens == Some(5))));
        }
    }
}

#[tokio::test]
async fn done_without_nonblank_output_preserves_the_reason_in_a_valid_failure() {
    for (finish_reason, expected_code, expected_message) in [
        (None, "invalid-response", "without nonblank output"),
        (Some("stop"), "invalid-response", "without nonblank output"),
        (Some("content_filter"), "content-filtered", "content filter"),
        (
            Some("tool_calls"),
            "invalid-response",
            "unsupported tool calls",
        ),
        (Some("length"), "output-too-large", "token limit"),
    ] {
        let chunk = serde_json::json!({
            "choices": [{"delta": {"reasoning_content": "thought", "content": "  "}, "finish_reason": finish_reason}]
        });
        let wire = format!("data: {chunk}\n\ndata: [DONE]\n\n");
        let server = spawn_sse_server(Scenario::ByteChunks(wire.as_bytes().to_vec())).await;
        let store = LocalStore::open_in_memory().unwrap();
        store
            .put(
                "empty",
                &stored_profile("empty", &server.base_url, false),
                "t",
            )
            .unwrap();
        let sink = CollectingSink::default();
        stream_direct_ai(
            "empty",
            request("req-empty"),
            &store,
            &TestSecretStore::default(),
            &RequestRegistry::default(),
            &sink,
        )
        .await
        .unwrap();
        let events = sink.snapshot();
        assert_well_formed(&events, "req-empty");
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Failed(result)
            if result.error.code == expected_code && result.error.message.as_deref().is_some_and(|message| message.contains(expected_message))),
            "{events:?}"
        );
        if let Ok(directory) = std::env::var("MAHO_NATIVE_EVENT_FIXTURE_DIR") {
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                std::path::Path::new(&directory)
                    .join(format!("empty-{}.json", finish_reason.unwrap_or("other"))),
                serde_json::to_vec_pretty(&events).unwrap(),
            )
            .unwrap();
        }
    }
}

#[tokio::test]
async fn text_output_keeps_each_upstream_finish_reason() {
    for (wire_reason, canonical_reason) in [
        ("stop", "stop"),
        ("length", "length"),
        ("content_filter", "content-filter"),
        ("tool_calls", "tool-calls"),
        ("other", "other"),
    ] {
        let chunk = serde_json::json!({
            "choices": [{"delta": {"content": "partial output"}, "finish_reason": wire_reason}]
        });
        let wire = format!("data: {chunk}\n\ndata: [DONE]\n\n");
        let server = spawn_sse_server(Scenario::ByteChunks(wire.as_bytes().to_vec())).await;
        let store = LocalStore::open_in_memory().unwrap();
        store
            .put(
                "reasons",
                &stored_profile("reasons", &server.base_url, false),
                "t",
            )
            .unwrap();
        let sink = CollectingSink::default();
        stream_direct_ai(
            "reasons",
            request("req-reasons"),
            &store,
            &TestSecretStore::default(),
            &RequestRegistry::default(),
            &sink,
        )
        .await
        .unwrap();
        let events = sink.snapshot();
        assert_well_formed(&events, "req-reasons");
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Completed(result)
            if serde_json::to_value(result.finish_reason).unwrap() == canonical_reason),
            "{events:?}"
        );
    }
}

#[tokio::test]
async fn a_bare_done_marker_is_a_single_invalid_response_terminal() {
    let server = spawn_sse_server(Scenario::ByteChunks(b"data: [DONE]\n\n".to_vec())).await;
    let store = LocalStore::open_in_memory().unwrap();
    store
        .put(
            "bare",
            &stored_profile("bare", &server.base_url, false),
            "t",
        )
        .unwrap();
    let sink = CollectingSink::default();
    stream_direct_ai(
        "bare",
        request("req-bare"),
        &store,
        &TestSecretStore::default(),
        &RequestRegistry::default(),
        &sink,
    )
    .await
    .unwrap();
    let events = sink.snapshot();
    assert_well_formed(&events, "req-bare");
    assert_eq!(events.len(), 2);
    assert!(
        matches!(terminals(&events)[0], AiExecutionResult::Failed(result) if result.error.code == "invalid-response")
    );
}

async fn assert_large_delta_preserves_text_within_utf16_limits(
    label: &str,
    text: String,
    reasoning: String,
) {
    let chunk = serde_json::json!({
        "choices": [{"delta": {"content": text, "reasoning_content": reasoning}, "finish_reason": "stop"}]
    });
    let wire = format!("data: {chunk}\n\ndata: [DONE]\n\n");
    let server = spawn_sse_server(Scenario::RawBytes(wire.into_bytes())).await;
    let store = LocalStore::open_in_memory().unwrap();
    store
        .put(
            "large",
            &stored_profile("large", &server.base_url, false),
            "t",
        )
        .unwrap();
    let sink = CollectingSink::default();
    let registry = RequestRegistry::default();
    stream_direct_ai(
        "large",
        request("req-large"),
        &store,
        &TestSecretStore::default(),
        &registry,
        &sink,
    )
    .await
    .unwrap();
    let events = sink.snapshot();
    assert_well_formed(&events, "req-large");
    let text_deltas: Vec<&str> = events
        .iter()
        .filter_map(|event| match event {
            AiStreamEvent::TextDelta { delta, .. } => Some(delta.as_str()),
            _ => None,
        })
        .collect();
    let reasoning_deltas: Vec<&str> = events
        .iter()
        .filter_map(|event| match event {
            AiStreamEvent::ReasoningDelta { delta, .. } => Some(delta.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        text_deltas.concat(),
        text,
        "text must not be lost or reordered"
    );
    assert_eq!(
        reasoning_deltas.concat(),
        reasoning,
        "reasoning must not be lost or reordered"
    );
    assert!(
        matches!(terminals(&events)[0], AiExecutionResult::Completed(result)
        if result.output.text.as_deref() == Some(text.as_str()) && result.output.reasoning.as_deref() == Some(reasoning.as_str()))
    );
    if let Ok(directory) = std::env::var("MAHO_NATIVE_EVENT_FIXTURE_DIR") {
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            std::path::Path::new(&directory).join(format!("large-{label}.json")),
            serde_json::to_vec(&events).unwrap(),
        )
        .unwrap();
    }
    for delta in text_deltas.iter().chain(reasoning_deltas.iter()) {
        assert!(!delta.is_empty());
        assert!(
            delta.encode_utf16().count() <= 65_536,
            "{label}: emitted delta has {} UTF-16 units, beyond the canonical 65,536 limit",
            delta.encode_utf16().count()
        );
    }
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn oversized_ascii_provider_delta_is_split_without_truncation() {
    assert_large_delta_preserves_text_within_utf16_limits(
        "ascii",
        "a".repeat(65_537),
        "b".repeat(65_539),
    )
    .await;
}

#[tokio::test]
async fn oversized_astral_provider_delta_is_split_at_utf16_boundaries() {
    assert_large_delta_preserves_text_within_utf16_limits(
        "astral",
        format!("{}🪄终", "a".repeat(65_535)),
        "🧠".repeat(40_000),
    )
    .await;
}

#[tokio::test]
async fn delta_at_the_exact_utf16_limit_is_preserved() {
    assert_large_delta_preserves_text_within_utf16_limits(
        "exact",
        "a".repeat(65_536),
        "🧠".repeat(32_768),
    )
    .await;
}

#[tokio::test]
async fn reasoning_usage_prefers_standard_nested_tokens_and_falls_back_to_legacy() {
    for (index, (usage, expected_tokens)) in [
        (
            serde_json::json!({"completion_tokens_details": {"reasoning_tokens": 7}}),
            7,
        ),
        (serde_json::json!({"reasoning_tokens": 5}), 5),
        (
            serde_json::json!({"reasoning_tokens": 5, "completion_tokens_details": {"reasoning_tokens": 7}}),
            7,
        ),
        (
            serde_json::json!({"reasoning_tokens": 5, "completion_tokens_details": {"reasoning_tokens": 0}}),
            0,
        ),
        (
            serde_json::json!({"reasoning_tokens": 5, "completion_tokens_details": {}}),
            5,
        ),
        (
            serde_json::json!({"reasoning_tokens": 5, "completion_tokens_details": null}),
            5,
        ),
        (
            serde_json::json!({"reasoning_tokens": 5, "completion_tokens_details": {"reasoning_tokens": null}}),
            5,
        ),
    ].into_iter().enumerate() {
        let chunk = serde_json::json!({
            "choices": [{"delta": {"content": "answer"}, "finish_reason": "stop"}], "usage": usage,
        });
        let wire = format!("data: {chunk}\n\ndata: [DONE]\n\n");
        let server = spawn_sse_server(Scenario::RawBytes(wire.into_bytes())).await;
        let store = LocalStore::open_in_memory().unwrap();
        store
            .put(
                "usage",
                &stored_profile("usage", &server.base_url, false),
                "t",
            )
            .unwrap();
        let sink = CollectingSink::default();
        stream_direct_ai(
            "usage",
            request("req-usage"),
            &store,
            &TestSecretStore::default(),
            &RequestRegistry::default(),
            &sink,
        )
        .await
        .unwrap();
        let events = sink.snapshot();
        if let Ok(directory) = std::env::var("MAHO_NATIVE_EVENT_FIXTURE_DIR") {
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                std::path::Path::new(&directory).join(format!("usage-{index}.json")),
                serde_json::to_vec_pretty(&events).unwrap(),
            ).unwrap();
        }
        assert_well_formed(&events, "req-usage");
        assert!(events.iter().any(|event| matches!(event, AiStreamEvent::Usage { usage, .. } if usage.reasoning_tokens == Some(expected_tokens))), "expected reasoningTokens={expected_tokens} for {usage}, got {events:?}");
        assert!(
            matches!(terminals(&events)[0], AiExecutionResult::Completed(result)
            if result.usage.as_ref().and_then(|usage| usage.reasoning_tokens) == Some(expected_tokens))
        );
    }
}
