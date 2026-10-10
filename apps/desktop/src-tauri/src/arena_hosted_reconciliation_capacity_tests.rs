//! Opt-in serial recipe for the exact Next producer wire -> Native -> TS artifact chain.
//! The producer's files stay outside Git. No remote endpoint, real credential, or model is used.
use super::*;
use std::io::{Read, Write};

struct ReconciliationFileSinkState {
    writer: std::io::BufWriter<std::fs::File>,
    sequence: u64,
    bytes: usize,
    finals: usize,
    ended: bool,
    hasher: Sha256,
}
struct ReconciliationFileSink {
    state: Mutex<ReconciliationFileSinkState>,
    status: u16,
}
impl EventSink for ReconciliationFileSink {
    fn send(&self, event: ChannelEvent) -> Result<(), ArenaError> {
        let mut state = self.state.lock().unwrap();
        assert!(!state.ended, "no late event may follow json-end");
        let sequence = match &event {
            ChannelEvent::JsonResponse {
                request_id,
                sequence,
                status,
                generation_id,
                generation_request_id,
                payload_hash,
                ..
            } => {
                assert_eq!(state.sequence, 0);
                assert_eq!(*status, self.status);
                assert_eq!(request_id, RID);
                assert_eq!(generation_id.as_deref(), Some(gid().as_str()));
                assert_eq!(generation_request_id.as_deref(), Some(RID));
                assert!(payload_hash.is_none());
                *sequence
            }
            ChannelEvent::JsonFragment {
                request_id,
                sequence,
                text,
                r#final,
            } => {
                assert!(state.sequence > 0);
                assert_eq!(state.finals, 0, "no fragment may follow the final fragment");
                assert_eq!(request_id, RID);
                assert!(!text.is_empty() && text.len() <= IPC_TEXT_BYTES);
                state.bytes += text.len();
                assert!(state.bytes <= rec::WIRE_BYTES);
                state.hasher.update(text.as_bytes());
                state.finals += usize::from(*r#final);
                *sequence
            }
            ChannelEvent::JsonEnd {
                request_id,
                sequence,
            } => {
                assert_eq!(request_id, RID);
                assert_eq!(state.finals, 1);
                state.ended = true;
                *sequence
            }
            _ => panic!("reconciliation must only emit the existing JSON Channel family"),
        };
        assert_eq!(sequence, state.sequence);
        let line = serde_json::to_vec(&event).unwrap();
        assert!(line.len() <= IPC_BYTES);
        state.writer.write_all(&line).unwrap();
        state.writer.write_all(b"\n").unwrap();
        state.sequence += 1;
        Ok(())
    }
}

fn file_sha256(path: &std::path::Path) -> String {
    let mut reader = std::io::BufReader::new(std::fs::File::open(path).unwrap());
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; IPC_TEXT_BYTES];
    loop {
        let count = reader.read(&mut buffer).unwrap();
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    format!("{:x}", hasher.finalize())
}

/// Required environment:
/// - ARENA_RECONCILIATION_CAPACITY_INPUT: the Next handler/producer's original JSON file
/// - ARENA_RECONCILIATION_CAPACITY_OUTPUT: destination NDJSON of actual Native Channel events
/// Optional ARENA_RECONCILIATION_CAPACITY_STATUS is 200 (default), or 503 for the handler's
/// explicit RESPONSE_TOO_LARGE error. A producer wire above 16 MiB must yield zero IPC.
/// All producer fixtures use arena_<64 a>, one readable combatant, and synthetic identities.
#[tokio::test]
#[ignore = "explicit serial window; env-selected original Next producer fixture and NDJSON output"]
async fn reconciliation_producer_fixture_crosses_native_channel_byte_exact() {
    let input = std::path::PathBuf::from(
        std::env::var("ARENA_RECONCILIATION_CAPACITY_INPUT").expect("producer fixture required"),
    );
    let output = std::path::PathBuf::from(
        std::env::var("ARENA_RECONCILIATION_CAPACITY_OUTPUT")
            .expect("Channel NDJSON output required"),
    );
    assert_ne!(input, output, "never replace the original producer fixture");
    let http_status: u16 = std::env::var("ARENA_RECONCILIATION_CAPACITY_STATUS")
        .unwrap_or_else(|_| "200".into())
        .parse()
        .unwrap();
    assert!(matches!(http_status, 200 | 503));
    let expected_bytes = std::fs::metadata(&input).unwrap().len() as usize;
    assert!(expected_bytes > 0 && expected_bytes <= rec::WIRE_BYTES + 1);
    let expected_hash = file_sha256(&input);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let next_origin = format!("http://{}", listener.local_addr().unwrap());
    let next = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_concurrent_request(&mut socket).await;
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, rec::PATH);
        assert!(!request.headers.contains_key("cookie"));
        assert!(!request.headers.contains_key(ACTOR_HEADER));
        write_reply(&mut socket, rec_capability()).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_concurrent_request(&mut socket).await;
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, rec::PATH);
        assert_eq!(request.headers[rec::PROTOCOL_HEADER], rec::PROTOCOL_VERSION);
        assert_eq!(request.headers[EXPECTED_USER_HEADER], "v1:42");
        assert!(!request.headers.contains_key(ACTOR_HEADER));
        assert!(!request.body.contains(KEY));
        let body: Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["generationId"], gid());
        assert_eq!(body["combatants"].as_array().unwrap().len(), 1);
        let head = format!(
            "HTTP/1.1 {http_status} Fixture\r\nContent-Length: {expected_bytes}\r\nContent-Type: application/json\r\n{}: {}\r\nConnection: close\r\n\r\n",
            rec::PROTOCOL_HEADER, rec::PROTOCOL_VERSION,
        );
        socket.write_all(head.as_bytes()).await.unwrap();
        // Stream the same file, with no retained producer Value/tree or full wire clone.
        let mut file = std::fs::File::open(input).unwrap();
        let mut buffer = [0u8; IPC_TEXT_BYTES];
        loop {
            let count = file.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            if socket.write_all(&buffer[..count]).await.is_err() {
                assert!(expected_bytes > rec::WIRE_BYTES);
                break;
            }
        }
    });
    let hono = server(2, |i, request| {
        if i == 0 {
            assert_eq!(request.path, CAPABILITY_PATH);
            capability()
        } else {
            assert_eq!(
                request.path,
                format!("/api/arena/generation-requests/{RID}")
            );
            status("completed")
        }
    })
    .await;
    let state = rec_state(hono.origin, next_origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    let sink = ReconciliationFileSink {
        status: http_status,
        state: Mutex::new(ReconciliationFileSinkState {
            writer: std::io::BufWriter::new(std::fs::File::create(&output).unwrap()),
            sequence: 0,
            bytes: 0,
            finals: 0,
            ended: false,
            hasher: Sha256::new(),
        }),
    };
    let result = stream(&state, &cloud, &secrets, rec_request(true), &sink).await;
    next.await.unwrap();
    hono.task.await.unwrap();
    let mut captured = sink.state.lock().unwrap();
    captured.writer.flush().unwrap();
    if expected_bytes > rec::WIRE_BYTES {
        assert_eq!(result.unwrap_err().code, "reconciliation-output-too-large");
        assert_eq!(captured.sequence, 0);
        assert_eq!(std::fs::metadata(output).unwrap().len(), 0);
        eprintln!("ARENA_RECONCILIATION_PRODUCER_CHAIN rejected_bytes={expected_bytes} source_sha256={expected_hash} channel_messages=0");
    } else {
        result.unwrap();
        assert_eq!(captured.bytes, expected_bytes);
        assert!(captured.ended);
        assert_eq!(captured.finals, 1);
        assert_eq!(
            format!("{:x}", captured.hasher.clone().finalize()),
            expected_hash
        );
        eprintln!("ARENA_RECONCILIATION_PRODUCER_CHAIN status={http_status} bytes={expected_bytes} sha256={expected_hash} channel_messages={}", captured.sequence);
    }
}
