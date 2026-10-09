use crate::ai::{
    AiExecutionFinishReason, AiExecutionMode, AiExecutionResult, AiStreamEvent, RequestRegistry,
    AI_STREAM_MAX_DELTA_UTF16_UNITS, STREAM_FIXTURE,
};

#[test]
fn native_delta_limit_matches_the_shared_typescript_fixture() {
    let fixture: serde_json::Value = serde_json::from_str(STREAM_FIXTURE).unwrap();
    assert_eq!(
        fixture["maxDeltaChars"]
            .as_u64()
            .expect("shared delta limit"),
        AI_STREAM_MAX_DELTA_UTF16_UNITS as u64,
    );
}

#[test]
fn every_finish_reason_uses_the_canonical_kebab_case_wire_value() {
    let fixture: serde_json::Value =
        serde_json::from_str(STREAM_FIXTURE).expect("shared fixture must be valid JSON");
    let completed_event = fixture["events"]
        .as_array()
        .expect("events array")
        .iter()
        .find(|event| event["result"]["status"] == "completed")
        .expect("fixture must contain a completed result");

    let reasons = [
        AiExecutionFinishReason::Stop,
        AiExecutionFinishReason::Length,
        AiExecutionFinishReason::ContentFilter,
        AiExecutionFinishReason::ToolCalls,
        AiExecutionFinishReason::Other,
    ];
    let wire_values = fixture["finishReasons"]
        .as_array()
        .expect("shared finish reasons");
    assert_eq!(reasons.len(), wire_values.len());
    for (reason, wire) in reasons.into_iter().zip(wire_values) {
        assert_eq!(serde_json::to_value(reason).unwrap(), *wire);
        let mut event = completed_event.clone();
        event["result"]["finishReason"] = serde_json::json!(wire);
        let parsed: AiStreamEvent = serde_json::from_value(event.clone())
            .expect("every canonical finish reason must deserialize");
        assert_eq!(serde_json::to_value(parsed).unwrap(), event);
    }

    for legacy_wire in ["contentFilter", "toolCalls"] {
        assert!(
            serde_json::from_value::<AiExecutionFinishReason>(serde_json::json!(legacy_wire))
                .is_err()
        );
    }
}

#[test]
fn deserializes_every_event_shape_from_the_shared_typescript_fixture() {
    let fixture: serde_json::Value =
        serde_json::from_str(STREAM_FIXTURE).expect("shared fixture must be valid JSON");
    let raw_events = fixture["events"]
        .as_array()
        .expect("fixture must contain an events array");
    assert!(
        raw_events.len() >= 5,
        "fixture must cover every event variant"
    );

    let mut parsed: Vec<AiStreamEvent> = Vec::new();
    for raw in raw_events {
        parsed.push(
            serde_json::from_value(raw.clone())
                .unwrap_or_else(|error| panic!("failed to parse {raw}: {error}")),
        );
    }

    // 事件种类覆盖度：started / text-delta / reasoning-delta / usage / result 三种终态。
    assert!(parsed
        .iter()
        .any(|event| matches!(event, AiStreamEvent::Started { .. })));
    assert!(parsed
        .iter()
        .any(|event| matches!(event, AiStreamEvent::TextDelta { .. })));
    assert!(parsed
        .iter()
        .any(|event| matches!(event, AiStreamEvent::ReasoningDelta { .. })));
    assert!(parsed
        .iter()
        .any(|event| matches!(event, AiStreamEvent::Usage { .. })));

    let terminals: Vec<&AiExecutionResult> = parsed
        .iter()
        .filter_map(|event| match event {
            AiStreamEvent::Result { result, .. } => Some(result),
            _ => None,
        })
        .collect();
    assert_eq!(
        terminals.len(),
        3,
        "fixture must cover all terminal statuses"
    );
    assert!(terminals
        .iter()
        .any(|result| matches!(result, AiExecutionResult::Completed(_))));
    assert!(terminals
        .iter()
        .any(|result| matches!(result, AiExecutionResult::Failed(_))));
    assert!(terminals
        .iter()
        .any(|result| matches!(result, AiExecutionResult::Cancelled(_))));
}

#[test]
fn round_trips_events_without_dropping_fields() {
    let fixture: serde_json::Value =
        serde_json::from_str(STREAM_FIXTURE).expect("shared fixture must be valid JSON");

    for raw in fixture["events"].as_array().expect("events array") {
        let parsed: AiStreamEvent = serde_json::from_value(raw.clone()).expect("event must parse");
        let echoed = serde_json::to_value(&parsed).expect("event must serialize");
        assert_eq!(
            echoed, *raw,
            "re-serializing {raw} must reproduce the original document"
        );
    }
}

#[test]
fn identity_is_extractable_from_every_variant() {
    let fixture: serde_json::Value =
        serde_json::from_str(STREAM_FIXTURE).expect("shared fixture must be valid JSON");
    for raw in fixture["events"].as_array().expect("events array") {
        let parsed: AiStreamEvent = serde_json::from_value(raw.clone()).expect("event must parse");
        let (request_id, contract_version, mode) = parsed.identity();
        assert_eq!(request_id, raw["requestId"].as_str().expect("requestId"));
        assert_eq!(
            contract_version,
            raw["contractVersion"].as_u64().expect("version") as u32
        );
        assert_eq!(
            mode,
            match raw["mode"].as_str().expect("mode") {
                "direct-local" => AiExecutionMode::DirectLocal,
                "direct-remote" => AiExecutionMode::DirectRemote,
                other => panic!("fixture uses an unhandled mode: {other}"),
            }
        );
    }
}

#[test]
fn documents_that_unknown_event_fields_are_ignored_rather_than_rejected() {
    // serde 不支持在 internally tagged enum 上使用 deny_unknown_fields，未知字段会被
    // 静默忽略。这不是我们想要的性质，但当前无法在类型层面强制。
    //
    // 实际风险由另外两道门禁兜住：事件字段集合由 TypeScript 侧的 zod schema 单点定义，
    // 且任何字段改名都会让跨运行时 fixture 的双向断言失败。
    let event = serde_json::json!({
        "type": "started",
        "requestId": "req-1",
        "contractVersion": 1,
        "mode": "direct-local",
        "sequence": 0,
        "unexpected": true
    });
    let parsed: AiStreamEvent =
        serde_json::from_value(event).expect("internally tagged enums ignore unknown fields");
    assert_eq!(parsed.identity().0, "req-1");
}

#[test]
fn registry_rejects_duplicate_in_flight_request_ids() {
    let registry = RequestRegistry::default();
    let _token = registry
        .register("req-1")
        .expect("first register must succeed");
    assert!(registry.register("req-1").is_err());
    assert_eq!(registry.len(), 1);
}

#[test]
fn registry_cancel_reports_whether_it_hit_an_in_flight_request() {
    let registry = RequestRegistry::default();
    assert!(!registry.cancel("never-registered"));

    let token = registry.register("req-1").expect("register");
    assert!(!token.is_cancelled());
    assert!(registry.cancel("req-1"));
    assert!(
        token.is_cancelled(),
        "cancel must reach the upstream handle"
    );
}

#[test]
fn registry_finish_releases_the_entry_so_the_id_can_be_reused() {
    let registry = RequestRegistry::default();
    registry.register("req-1").expect("register");
    registry.finish("req-1");
    assert_eq!(registry.len(), 0);
    assert!(!registry.cancel("req-1"));
    registry
        .register("req-1")
        .expect("id must be reusable after finish");
}
