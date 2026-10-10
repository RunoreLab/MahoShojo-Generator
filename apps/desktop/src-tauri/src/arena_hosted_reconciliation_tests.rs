//! Real Native HTTP and Channel against separate synthetic Hono/Next loopbacks.
use super::*;
use crate::arena_hosted::reconciliation as rec;

fn rec_capability() -> Reply {
    rec_reply(
        200,
        json!({"ok":true,"contractVersion":rec::PROTOCOL_VERSION,
        "expectedUserIdAssertion":"v1","ownership":"generation-actor","effects":"frozen-manifest-v1"}),
    )
}
fn rec_reply(status: u16, body: Value) -> Reply {
    let mut reply = Reply::json(status, body);
    reply
        .headers
        .push((rec::PROTOCOL_HEADER.into(), rec::PROTOCOL_VERSION.into()));
    reply
}
fn rec_success() -> Value {
    json!({"version":rec::PROTOCOL_VERSION,"generationId":gid(),"success":true,
        "updatedCombatants":[{"combatantIndex":0,"data":{"name":"更新🪄","signature":"synthetic-server-signature"},"isNative":true}],
        "warnings":[]})
}
fn rec_request(account: bool) -> ArenaRequest {
    serde_json::from_value(json!({"operation":"reconcile","product":"battle","requestId":RID,
        "actor":if account {json!({"kind":"account","expectedUserId":42})} else {json!({"kind":"anonymous"})},
        "generationId":gid(),"combatants":[{"type":"magical-girl","data":{"name":"原卡"}}]})).unwrap()
}
fn versioned_create(
    account: bool,
    json: bool,
    byok: bool,
    history: bool,
    current: bool,
) -> ArenaRequest {
    let mut request = if json {
        create_json(account, byok)
    } else {
        create(account, byok)
    };
    match &mut request {
        ArenaRequest::CreateStream {
            body,
            reconciliation_version,
            ..
        }
        | ArenaRequest::CreateJson {
            body,
            reconciliation_version,
            ..
        } => {
            *reconciliation_version = Some(rec::Version::V1);
            body["writeArenaHistory"] = json!(history);
            body["writeCurrentState"] = json!(current);
        }
        _ => unreachable!(),
    }
    request
}
fn rec_state(hono: String, next: String) -> ArenaState {
    assert!(next.starts_with("http://127.0.0.1:"));
    let mut state = ArenaState::with_origin(hono);
    state.reconciliation_origin = next;
    state
}

#[test]
fn reconciliation_request_is_narrow_and_legacy_create_writes_stay_closed() {
    assert_eq!(
        ArenaState::new().unwrap().reconciliation_origin,
        "https://mahoshojo.colanns.me"
    );
    assert_eq!(rec::PATH, "/api/arena/update-combatants-after-stream");
    for operation in ["create-stream", "create-json"] {
        let mut request = fixture()["validOperations"][0].clone();
        request["operation"] = json!(operation);
        request["body"]["writeArenaHistory"] = json!(true);
        assert!(validate_body(&request["body"]).is_err());
        for invalid_version in [Value::Null, json!("v2"), json!(true)] {
            request["reconciliationVersion"] = invalid_version;
            assert!(serde_json::from_value::<ArenaRequest>(request.clone()).is_err());
        }
        request["reconciliationVersion"] = json!(rec::PROTOCOL_VERSION);
        serde_json::from_value::<ArenaRequest>(request.clone())
            .unwrap()
            .validate()
            .unwrap();
        validate_body_with_reconciliation(&request["body"], true).unwrap();
        request["body"]["writeCurrentState"] = json!("true");
        assert!(validate_body_with_reconciliation(&request["body"], true).is_err());
    }
    let request = json!({"operation":"reconcile","product":"battle","requestId":RID,
        "actor":{"kind":"anonymous"},"generationId":gid(),"combatants":[{"type":"card","data":{}}]});
    for key in [
        "url",
        "headers",
        "apiKey",
        "systemConfig",
        "presetConfig",
        "body",
        "writeArenaHistory",
    ] {
        let mut bad = request.clone();
        bad[key] = json!("forbidden");
        assert!(
            serde_json::from_value::<ArenaRequest>(bad).is_err(),
            "{key}"
        );
    }
    for key in [
        "apiKey",
        "isNative",
        "isValid",
        "characterGuidance",
        "arenaRoomKey",
        "templateId",
    ] {
        let mut bad = request.clone();
        bad["combatants"][0][key] = json!("forbidden");
        assert!(
            serde_json::from_value::<ArenaRequest>(bad)
                .unwrap()
                .validate()
                .is_err(),
            "{key}"
        );
    }
    assert!(rec::validate_input(&gid(), &[]).is_err());
    assert!(rec::validate_input(&gid(), &vec![json!({"type":"card","data":{}}); 33]).is_err());
    assert!(rec::validate_input(
        &gid(),
        &[json!({"type":"card","data":{"text":"x".repeat(INPUT_BYTES)}})]
    )
    .is_err());
}

#[test]
fn reconciliation_response_checks_identity_indexes_issues_and_entire_json() {
    let good = rec_success();
    rec::validate_response(&good.to_string(), true, &gid(), 1).unwrap();
    for index in [
        json!(-1),
        json!(0.5),
        json!(1),
        json!(32),
        Value::Null,
        json!("0"),
    ] {
        let mut bad = good.clone();
        bad["updatedCombatants"][0]["combatantIndex"] = index;
        assert!(rec::validate_response(&bad.to_string(), true, &gid(), 1).is_err());
    }
    let mut bad = good.clone();
    bad["updatedCombatants"] = json!([good["updatedCombatants"][0], good["updatedCombatants"][0]]);
    assert!(rec::validate_response(&bad.to_string(), true, &gid(), 2).is_err());
    for (key, value) in [
        ("version", json!("arena-companion-v1")),
        ("generationId", json!(format!("arena_{}", "b".repeat(64)))),
        ("success", json!(false)),
        ("extra", json!(true)),
    ] {
        let mut bad = good.clone();
        bad[key] = value;
        assert!(rec::validate_response(&bad.to_string(), true, &gid(), 1).is_err());
    }
    for issue in [
        json!({"code":"ARENA_RECONCILIATION_COMBATANT_UNMATCHED","combatantIndex":0,"message":"未对应"}),
        json!({"code":"ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING","rosterIndex":0,"characterName":null,"message":"缺少角色"}),
        json!({"code":"ARENA_RECONCILIATION_IMPACT_AMBIGUOUS","characterName":"角色","message":"同名"}),
    ] {
        let mut body = good.clone();
        body["warnings"] = json!([issue]);
        rec::validate_response(&body.to_string(), true, &gid(), 1).unwrap();
        body["warnings"][0]["extra"] = json!(true);
        assert!(rec::validate_response(&body.to_string(), true, &gid(), 1).is_err());
    }
    let error = json!({"version":rec::PROTOCOL_VERSION,"code":"ARENA_RECONCILIATION_FINALIZATION_PENDING","error":"稍后重试"});
    rec::validate_response(&error.to_string(), false, &gid(), 1).unwrap();
    let mut bad = error;
    bad["errors"] = Value::Null;
    assert!(rec::validate_response(&bad.to_string(), false, &gid(), 1).is_err());
    assert!(rec::validate_response(&(good.to_string() + "{}"), true, &gid(), 1).is_err());
}

#[tokio::test]
async fn versioned_create_checks_next_and_freezes_each_write_choice_on_hono() {
    for (account, json_mode, history, current) in [
        (false, false, true, false),
        (false, true, false, true),
        (true, false, true, true),
        (true, true, false, false),
    ] {
        let next = server(usize::from(history || current), |_, r| {
            assert_eq!(r.method, "GET");
            assert_eq!(r.path, rec::PATH);
            assert!(!r.headers.contains_key("cookie") && !r.headers.contains_key(ACTOR_HEADER));
            assert!(!r.headers.contains_key(EXPECTED_USER_HEADER));
            assert!(!r.body.contains(KEY));
            rec_capability()
        })
        .await;
        let hono = server(2, move |i, r| {
            if i == 0 {
                return if json_mode {
                    let mut reply = json_capability();
                    if history || current {
                        reply
                            .headers
                            .push((rec::PROTOCOL_HEADER.into(), rec::PROTOCOL_VERSION.into()));
                    }
                    reply
                } else {
                    capability()
                };
            }
            let body: Value = serde_json::from_str(&r.body).unwrap();
            assert_eq!(body["writeArenaHistory"], history);
            assert_eq!(body["writeCurrentState"], current);
            assert_eq!(
                r.headers.get(rec::PROTOCOL_HEADER).map(String::as_str),
                if json_mode && (history || current) {
                    Some(rec::PROTOCOL_VERSION)
                } else {
                    None
                }
            );
            assert!(r.body.contains(KEY));
            assert!(!body
                .as_object()
                .unwrap()
                .contains_key("reconciliationVersion"));
            let reply = if json_mode {
                json_reply(200, json_fixture()["successEnvelopes"][0].to_string())
            } else {
                Reply::sse(standard_wire())
            };
            if account {
                reply
            } else {
                token_reply(reply, r)
            }
        })
        .await;
        let secrets = Secrets::default();
        if account {
            login(&secrets, 42);
        }
        secrets.set("preset:kourichat:api-key", KEY).unwrap();
        let state = rec_state(hono.origin, next.origin);
        let cloud = CloudState::new().unwrap();
        stream(
            &state,
            &cloud,
            &secrets,
            versioned_create(account, json_mode, true, history, current),
            &Sink::default(),
        )
        .await
        .unwrap();
        hono.task.await.unwrap();
        next.task.await.unwrap();
    }
}

#[tokio::test]
async fn original_anonymous_token_only_reaches_fixed_next_without_provider_or_cookie() {
    for account in [false, true] {
        let next = server(2, move |i, r| {
            assert_eq!(r.path, rec::PATH);
            assert!(!r.body.contains(KEY));
            if i == 0 {
                assert_eq!(r.method, "GET");
                assert!(!r.headers.contains_key(ACTOR_HEADER));
                assert!(!r.headers.contains_key("cookie"));
                return rec_capability();
            }
            assert_eq!(r.method, "POST");
            assert_eq!(r.headers[rec::PROTOCOL_HEADER], rec::PROTOCOL_VERSION);
            assert_eq!(r.headers.contains_key("cookie"), account);
            assert_eq!(r.headers.contains_key(ACTOR_HEADER), !account);
            if account {
                assert_eq!(r.headers[EXPECTED_USER_HEADER], "v1:42");
            } else {
                assert!(!r.headers[ACTOR_HEADER].starts_with("bootstrap."));
            }
            let body: Value = serde_json::from_str(&r.body).unwrap();
            assert_eq!(body.as_object().unwrap().len(), 2);
            assert_eq!(body["generationId"], gid());
            rec_reply(200, rec_success())
        })
        .await;
        let hono = server(3, move |i, r| match i {
            0 => capability(),
            1 => {
                if account {
                    Reply::sse(standard_wire())
                } else {
                    token_reply(Reply::sse(standard_wire()), r)
                }
            }
            _ => {
                assert!(r.path.contains("generation-requests"));
                status("completed")
            }
        })
        .await;
        let secrets = Secrets::default();
        if account {
            login(&secrets, 42);
        }
        secrets.set("preset:kourichat:api-key", KEY).unwrap();
        let state = rec_state(hono.origin, next.origin);
        let cloud = CloudState::new().unwrap();
        // Legacy false creation is preserved. Server remains the authority for frozen write flags.
        stream(
            &state,
            &cloud,
            &secrets,
            create(account, true),
            &Sink::default(),
        )
        .await
        .unwrap();
        let before = load_anonymous(Product::Battle, &secrets)
            .unwrap()
            .and_then(|v| v.token);
        let sink = Sink::default();
        stream(&state, &cloud, &secrets, rec_request(account), &sink)
            .await
            .unwrap();
        assert_eq!(collected_json(&sink), rec_success().to_string());
        let events = sink.events.lock().unwrap().clone();
        assert_eq!(events[0]["kind"], "json-response");
        assert_eq!(events[0]["generationId"], gid());
        assert_eq!(events.last().unwrap()["kind"], "json-end");
        if let Some(token) = before {
            assert_eq!(
                next.requests.lock().unwrap()[1].headers[ACTOR_HEADER],
                token
            );
        }
        assert_eq!(secrets.values.lock().unwrap().len(), 2); // provider + existing actor/account slot
        hono.task.await.unwrap();
        next.task.await.unwrap();
    }
}

#[tokio::test]
async fn next_capability_is_mandatory_before_create_and_rechecked_after_rollback() {
    for json_mode in [false, true] {
        let next = server(1, |_, _| {
            let mut reply = rec_capability();
            let mut value: Value = serde_json::from_str(&reply.body).unwrap();
            value["contractVersion"] = json!("old");
            reply.body = value.to_string();
            reply
        })
        .await;
        let hono = server(0, |_, _| {
            panic!("unsupported Next must prevent any create or Hono capability")
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let secrets = Secrets::default();
        let cloud = CloudState::new().unwrap();
        let err = stream(
            &state,
            &cloud,
            &secrets,
            versioned_create(false, json_mode, false, true, true),
            &Sink::default(),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, "reconciliation-capability-unavailable");
        assert_eq!(err.dispatch_state, "not-dispatched");
        assert!(
            !state.flights.lock().unwrap()[&Product::Battle]
                .lock()
                .unwrap()
                .dispatched
        );
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
    let next = server(3, |i, _| match i {
        0 => rec_capability(),
        1 => rec_reply(200, rec_success()),
        _ => Reply::json(503, json!({"ok":false})),
    })
    .await;
    let hono = server(3, |i, _| {
        if i == 0 {
            capability()
        } else {
            status("completed")
        }
    })
    .await;
    let state = rec_state(hono.origin, next.origin);
    let secrets = Secrets::default();
    login(&secrets, 42);
    let cloud = CloudState::new().unwrap();
    stream(
        &state,
        &cloud,
        &secrets,
        rec_request(true),
        &Sink::default(),
    )
    .await
    .unwrap();
    let sink = Sink::default();
    let err = stream(&state, &cloud, &secrets, rec_request(true), &sink)
        .await
        .unwrap_err();
    assert_eq!(err.code, "reconciliation-capability-unavailable");
    assert_eq!(err.dispatch_state, "not-dispatched");
    assert!(sink.events.lock().unwrap().is_empty());
    assert_eq!(
        next.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.method == "POST")
            .count(),
        1
    );
    next.task.await.unwrap();
    hono.task.await.unwrap();
}

#[tokio::test]
async fn redirects_from_both_next_operations_never_forward_credentials_or_follow_location() {
    for redirect_post in [false, true] {
        let target = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let location = format!("http://{}/capture", target.local_addr().unwrap());
        let next = server(if redirect_post { 2 } else { 1 }, move |i, _| {
            if redirect_post && i == 0 {
                return rec_capability();
            }
            let mut reply = rec_reply(307, json!({}));
            reply.headers.push(("Location".into(), location.clone()));
            reply
        })
        .await;
        let hono = server(2, |i, _| {
            if i == 0 {
                capability()
            } else {
                status("completed")
            }
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let secrets = Secrets::default();
        login(&secrets, 42);
        let cloud = CloudState::new().unwrap();
        let sink = Sink::default();
        assert!(stream(&state, &cloud, &secrets, rec_request(true), &sink)
            .await
            .is_err());
        assert!(sink.events.lock().unwrap().is_empty());
        assert!(
            tokio::time::timeout(Duration::from_millis(30), target.accept())
                .await
                .is_err()
        );
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

#[tokio::test]
async fn original_bootstrap_recovers_signed_token_on_hono_after_login_and_never_reaches_next() {
    let original = Arc::new(Mutex::new(String::new()));
    let check_original = original.clone();
    let hono = server(3, move |i, r| {
        if i == 0 {
            return capability();
        }
        assert_eq!(r.path, format!("/api/arena/generation-requests/{RID}"));
        assert!(!r.headers.contains_key("cookie"));
        if i == 1 {
            assert_eq!(r.headers[ACTOR_HEADER], *check_original.lock().unwrap());
            token_reply(status("completed"), r)
        } else {
            assert!(!r.headers[ACTOR_HEADER].starts_with("bootstrap."));
            status("completed")
        }
    })
    .await;
    let next = server(2, |i, r| {
        assert!(!r.headers.contains_key("cookie"));
        assert!(!r.headers.contains_key(EXPECTED_USER_HEADER));
        if i == 0 {
            assert!(!r.headers.contains_key(ACTOR_HEADER));
            rec_capability()
        } else {
            assert!(!r.headers[ACTOR_HEADER].starts_with("bootstrap."));
            rec_reply(200, rec_success())
        }
    })
    .await;
    let secrets = Secrets::default();
    let cloud = CloudState::new().unwrap();
    let prior = ArenaState::new().unwrap();
    prior
        .prepare(&create(false, false), &cloud, &secrets)
        .unwrap();
    *original.lock().unwrap() = load_anonymous(Product::Battle, &secrets)
        .unwrap()
        .unwrap()
        .bootstrap;
    // New Native process, logged in to a different current actor; explicit restore keeps anonymous owner.
    login(&secrets, 99);
    let state = rec_state(hono.origin, next.origin);
    let mut restore = operation("lookup-request", false);
    if let ArenaRequest::LookupRequest {
        restore_session, ..
    } = &mut restore
    {
        *restore_session = true;
    }
    control(&state, &cloud, &secrets, restore).await.unwrap();
    stream(
        &state,
        &cloud,
        &secrets,
        rec_request(false),
        &Sink::default(),
    )
    .await
    .unwrap();
    let next_requests = next.requests.lock().unwrap().clone();
    assert_eq!(
        next_requests[1].headers[ACTOR_HEADER],
        load_anonymous(Product::Battle, &secrets)
            .unwrap()
            .unwrap()
            .token
            .unwrap()
    );
    assert_eq!(secrets.values.lock().unwrap().len(), 2);
    hono.task.await.unwrap();
    next.task.await.unwrap();
}

#[tokio::test]
async fn absent_original_token_and_mismatched_generation_do_not_post_to_next() {
    for mismatched in [false, true] {
        let next = server(if mismatched { 0 } else { 1 }, |_, r| {
            assert_eq!(r.method, "GET");
            rec_capability()
        })
        .await;
        let hono = server(2, move |i, _| {
            if i == 0 {
                return capability();
            }
            let mut reply = status("completed");
            if mismatched {
                let mut value: Value = serde_json::from_str(&reply.body).unwrap();
                value["generationId"] = json!(format!("arena_{}", "b".repeat(64)));
                reply.body = value.to_string();
            }
            reply // Deliberately no signed token, must never fall back to bootstrap on Next.
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let secrets = Secrets::default();
        let cloud = CloudState::new().unwrap();
        state
            .prepare(&create(false, false), &cloud, &secrets)
            .unwrap();
        let sink = Sink::default();
        let err = stream(&state, &cloud, &secrets, rec_request(false), &sink)
            .await
            .unwrap_err();
        assert_eq!(
            err.code,
            if mismatched {
                "invalid-request"
            } else {
                "recovery-unavailable"
            }
        );
        assert_eq!(err.dispatch_state, "not-dispatched");
        assert!(sink.events.lock().unwrap().is_empty());
        assert!(next
            .requests
            .lock()
            .unwrap()
            .iter()
            .all(|r| r.method == "GET"));
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

#[tokio::test]
async fn duplicate_reconcile_is_singleflight_and_detach_does_not_send_generation_cancel() {
    let posted = Arc::new(tokio::sync::Notify::new());
    let notify = posted.clone();
    let next = server(2, move |i, _| {
        if i == 0 {
            return rec_capability();
        }
        notify.notify_one();
        let mut reply = rec_reply(200, rec_success());
        reply.delay = Duration::from_millis(150);
        reply
    })
    .await;
    let hono = server(2, |i, _| {
        if i == 0 {
            capability()
        } else {
            status("completed")
        }
    })
    .await;
    let state = Arc::new(rec_state(hono.origin, next.origin));
    let cloud = Arc::new(CloudState::new().unwrap());
    let secrets = Arc::new(Secrets::default());
    login(&secrets, 42);
    let sink = Arc::new(Sink::default());
    let (s, c, k, o) = (state.clone(), cloud.clone(), secrets.clone(), sink.clone());
    let work =
        tokio::spawn(
            async move { stream(&s, &c, k.as_ref(), rec_request(true), o.as_ref()).await },
        );
    posted.notified().await;
    let err = stream(
        &state,
        &cloud,
        secrets.as_ref(),
        rec_request(true),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, "subscription-in-progress");
    assert!(detach(
        &state,
        DetachRequest {
            product: Product::Battle,
            request_id: RID.into()
        }
    )
    .unwrap());
    assert_eq!(work.await.unwrap().unwrap_err().code, "detached");
    assert!(sink.events.lock().unwrap().is_empty());
    assert_eq!(hono.requests.lock().unwrap().len(), 2);
    assert_eq!(
        next.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.method == "POST")
            .count(),
        1
    );
    next.task.await.unwrap();
    hono.task.await.unwrap();
}

#[tokio::test]
async fn account_switch_during_next_get_or_post_fences_dispatch_and_late_response() {
    for switch_during_post in [false, true] {
        let observed = Arc::new(tokio::sync::Notify::new());
        let notify = observed.clone();
        let next = server(if switch_during_post { 2 } else { 1 }, move |i, r| {
            let mut reply = if i == 0 {
                rec_capability()
            } else {
                assert_eq!(r.headers[EXPECTED_USER_HEADER], "v1:42");
                assert_eq!(r.headers["cookie"], COOKIE);
                rec_reply(200, rec_success())
            };
            if switch_during_post == (i == 1) {
                notify.notify_one();
                reply.delay = Duration::from_millis(100);
            }
            reply
        })
        .await;
        let hono = server(2, |i, _| {
            if i == 0 {
                capability()
            } else {
                status("completed")
            }
        })
        .await;
        let state = Arc::new(rec_state(hono.origin, next.origin));
        let cloud = Arc::new(CloudState::new().unwrap());
        let secrets = Arc::new(Secrets::default());
        login(&secrets, 42);
        let sink = Arc::new(Sink::default());
        let (s, c, k, o) = (state.clone(), cloud.clone(), secrets.clone(), sink.clone());
        let work =
            tokio::spawn(
                async move { stream(&s, &c, k.as_ref(), rec_request(true), o.as_ref()).await },
            );
        observed.notified().await;
        login(&secrets, 99);
        assert_eq!(work.await.unwrap().unwrap_err().code, "scope-changed");
        assert!(sink.events.lock().unwrap().is_empty());
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

#[tokio::test]
async fn complete_reconciliation_raw_json_surrogates_fragmentation_and_error_keep_report_budget() {
    for success in [false, true] {
        let mut body = if success {
            rec_success()
        } else {
            json!({"version":rec::PROTOCOL_VERSION,"generationId":gid(),"code":"ARENA_RECONCILIATION_FINALIZATION_PENDING","error":"角色同步稍后重试"})
        };
        if success {
            body["updatedCombatants"][0]["data"]["text"] = json!("魔🪄".repeat(32_768));
            body["updatedCombatants"][0]["data"]["lone"] = json!("SURROGATE_MARKER");
        }
        let wire = body.to_string().replace("SURROGATE_MARKER", "\\ud800");
        let sent = wire.clone();
        let next = server(2, move |i, _| {
            if i == 0 {
                rec_capability()
            } else {
                let mut reply = rec_reply(if success { 200 } else { 503 }, json!({}));
                reply.body = sent.clone();
                reply
            }
        })
        .await;
        let hono = server(2, |i, _| {
            if i == 0 {
                capability()
            } else {
                status("completed")
            }
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        login(&secrets, 42);
        let flight = state
            .prepare(&operation("lookup-request", true), &cloud, &secrets)
            .unwrap();
        {
            let mut f = flight.lock().unwrap();
            f.budget.markdown_bytes = 123;
            f.budget.reasoning_bytes = 45;
            f.budget.cursor = Some("8-0".into());
            f.budget.observed = true;
        }
        let sink = Sink::default();
        stream(&state, &cloud, &secrets, rec_request(true), &sink)
            .await
            .unwrap();
        assert_eq!(collected_json(&sink), wire);
        {
            let f = flight.lock().unwrap();
            assert_eq!(f.budget.markdown_bytes, 123);
            assert_eq!(f.budget.reasoning_bytes, 45);
            assert_eq!(f.budget.cursor.as_deref(), Some("8-0"));
        }
        let events = sink.events.lock().unwrap().clone();
        for (i, event) in events.iter().enumerate() {
            assert_eq!(event["sequence"], i);
            assert!(event.to_string().len() <= IPC_BYTES);
            if let Some(text) = event["text"].as_str() {
                assert!(text.len() <= IPC_TEXT_BYTES);
            }
        }
        assert_eq!(events[0]["status"], if success { 200 } else { 503 });
        assert_eq!(events.last().unwrap()["kind"], "json-end");
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

#[tokio::test]
async fn oversized_invalid_and_secret_echo_replies_fail_before_any_ipc() {
    for variant in [
        "oversized",
        "duplicate",
        "wrong-generation",
        "bad-json",
        "cookie-value",
        "provider-key",
        "missing-header",
    ] {
        let next = server(2, move |i, _| {
            if i == 0 {
                return rec_capability();
            }
            let mut body = rec_success();
            match variant {
                "oversized" => {
                    body["updatedCombatants"][0]["data"]["text"] =
                        json!("x".repeat(rec::WIRE_BYTES))
                }
                "duplicate" => {
                    body["updatedCombatants"] =
                        json!([body["updatedCombatants"][0], body["updatedCombatants"][0]])
                }
                "wrong-generation" => {
                    body["generationId"] = json!(format!("arena_{}", "b".repeat(64)))
                }
                "cookie-value" => {
                    body["updatedCombatants"][0]["data"]["text"] = json!("SYNTHETIC-COOKIE-CANARY")
                }
                "provider-key" => body["updatedCombatants"][0]["data"]["text"] = json!(KEY),
                _ => (),
            }
            let mut reply = rec_reply(200, body);
            if variant == "bad-json" {
                reply.body.push('{');
            }
            if variant == "cookie-value" {
                reply.body = reply
                    .body
                    .replace("SYNTHETIC-COOKIE-CANARY", "\\u0053YNTHETIC-COOKIE-CANARY");
            }
            if variant == "missing-header" {
                reply.headers.retain(|(k, _)| k != rec::PROTOCOL_HEADER);
            }
            reply
        })
        .await;
        let hono = server(2, |i, _| {
            if i == 0 {
                capability()
            } else {
                status("completed")
            }
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        login(&secrets, 42);
        let flight = state
            .prepare(&operation("lookup-request", true), &cloud, &secrets)
            .unwrap();
        flight.lock().unwrap().secrets_to_redact.push(KEY.into());
        let sink = Sink::default();
        let err = stream(&state, &cloud, &secrets, rec_request(true), &sink)
            .await
            .unwrap_err();
        assert_eq!(
            err.code,
            if variant == "oversized" {
                "reconciliation-output-too-large"
            } else {
                "invalid-response"
            },
            "{variant}"
        );
        assert!(sink.events.lock().unwrap().is_empty(), "{variant}");
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

#[test]
fn native_authority_requires_fresh_signature_and_issues_are_bounded() {
    for signature in [Value::Null, json!(false), json!(""), json!(" \t\u{feff} ")] {
        let mut body = rec_success();
        body["updatedCombatants"][0]["data"]["signature"] = signature;
        assert!(rec::validate_response(&body.to_string(), true, &gid(), 1).is_err());
        body["updatedCombatants"][0]["isNative"] = json!(false);
        rec::validate_response(&body.to_string(), true, &gid(), 1).unwrap();
    }
    let mut missing = rec_success();
    missing["updatedCombatants"][0]["data"]
        .as_object_mut()
        .unwrap()
        .remove("signature");
    assert!(rec::validate_response(&missing.to_string(), true, &gid(), 1).is_err());
    let issue = json!({"code":"ARENA_RECONCILIATION_COMBATANT_UNMATCHED","combatantIndex":0,"message":"未对应"});
    let mut body = rec_success();
    body["warnings"] = json!(vec![issue.clone(); 96]);
    rec::validate_response(&body.to_string(), true, &gid(), 1).unwrap();
    body["warnings"] = json!(vec![issue; 97]);
    assert!(rec::validate_response(&body.to_string(), true, &gid(), 1).is_err());
    let mut error = json!({"version":rec::PROTOCOL_VERSION,"code":"CODE","error":""});
    assert!(rec::validate_response(&error.to_string(), false, &gid(), 1).is_err());
    error["error"] = json!("Failure");
    error["code"] = json!("");
    assert!(rec::validate_response(&error.to_string(), false, &gid(), 1).is_err());
}

#[tokio::test]
async fn synchronous_detach_fences_remaining_reconciliation_fragments_and_end() {
    for after in [1, 2] {
        let next = server(2, |i, _| {
            if i == 0 {
                rec_capability()
            } else {
                let mut body = rec_success();
                body["updatedCombatants"][0]["data"]["text"] =
                    json!("x".repeat(3 * IPC_TEXT_BYTES));
                rec_reply(200, body)
            }
        })
        .await;
        let hono = server(2, |i, _| {
            if i == 0 {
                capability()
            } else {
                status("completed")
            }
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        login(&secrets, 42);
        let sink = DetachingJsonSink {
            state: &state,
            after,
            events: Mutex::new(Vec::new()),
        };
        let err = stream(&state, &cloud, &secrets, rec_request(true), &sink)
            .await
            .unwrap_err();
        assert_eq!(err.code, "detached");
        assert_eq!(err.dispatch_state, "unknown");
        assert_eq!(sink.events.lock().unwrap().len(), after);
        assert!(sink
            .events
            .lock()
            .unwrap()
            .iter()
            .all(|v| v["kind"] != "json-end"));
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

#[tokio::test]
async fn bounded_chunked_next_response_stops_without_content_length() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let next_origin = format!("http://{}", listener.local_addr().unwrap());
    let next = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_concurrent_request(&mut socket).await;
        assert_eq!(request.method, "GET");
        write_reply(&mut socket, rec_capability()).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_concurrent_request(&mut socket).await;
        assert_eq!(request.method, "POST");
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{}: {}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",rec::PROTOCOL_HEADER,rec::PROTOCOL_VERSION).as_bytes()).await.unwrap();
        let chunk = "x".repeat(128 * 1024);
        for _ in 0..=(rec::WIRE_BYTES / chunk.len()) {
            if socket
                .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                .await
                .is_err()
            {
                break;
            }
            if socket.write_all(chunk.as_bytes()).await.is_err() {
                break;
            }
            if socket.write_all(b"\r\n").await.is_err() {
                break;
            }
        }
        let _ = socket.write_all(b"0\r\n\r\n").await;
    });
    let hono = server(2, |i, _| {
        if i == 0 {
            capability()
        } else {
            status("completed")
        }
    })
    .await;
    let state = rec_state(hono.origin, next_origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    let sink = Sink::default();
    let err = stream(&state, &cloud, &secrets, rec_request(true), &sink)
        .await
        .unwrap_err();
    assert_eq!(err.code, "reconciliation-output-too-large");
    assert!(sink.events.lock().unwrap().is_empty());
    next.await.unwrap();
    hono.task.await.unwrap();
}

#[tokio::test]
async fn reconciliation_exact_wire_limit_is_accepted_without_truncation() {
    let mut body = rec_success();
    body["updatedCombatants"][0]["data"]["text"] = json!("");
    let padding = rec::WIRE_BYTES - body.to_string().len();
    body["updatedCombatants"][0]["data"]["text"] = json!("x".repeat(padding));
    let wire = body.to_string();
    assert_eq!(wire.len(), rec::WIRE_BYTES);
    let hash = Sha256::digest(wire.as_bytes());
    let next = server(2, move |i, _| {
        if i == 0 {
            rec_capability()
        } else {
            let mut r = rec_reply(200, json!({}));
            r.body = wire.clone();
            r
        }
    })
    .await;
    let hono = server(2, |i, _| {
        if i == 0 {
            capability()
        } else {
            status("completed")
        }
    })
    .await;
    let state = rec_state(hono.origin, next.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    let sink = Sink::default();
    stream(&state, &cloud, &secrets, rec_request(true), &sink)
        .await
        .unwrap();
    let received = collected_json(&sink);
    assert_eq!(received.len(), rec::WIRE_BYTES);
    assert_eq!(Sha256::digest(received.as_bytes()), hash);
    assert_eq!(
        sink.events.lock().unwrap().last().unwrap()["kind"],
        "json-end"
    );
    next.task.await.unwrap();
    hono.task.await.unwrap();
}

#[tokio::test]
async fn versioned_read_only_reports_do_not_depend_on_next_availability() {
    for json_mode in [false, true] {
        let next = server(0, |_, _| {
            panic!("both frozen writes are false; do not contact Next")
        })
        .await;
        let hono = server(2, move |i, r| {
            if i == 0 {
                return if json_mode {
                    json_capability()
                } else {
                    capability()
                };
            }
            let body: Value = serde_json::from_str(&r.body).unwrap();
            assert_eq!(body["writeArenaHistory"], false);
            assert_eq!(body["writeCurrentState"], false);
            if json_mode {
                json_reply(200, json_fixture()["successEnvelopes"][0].to_string())
            } else {
                Reply::sse(standard_wire())
            }
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        login(&secrets, 42);
        let sink = Sink::default();
        stream(
            &state,
            &cloud,
            &secrets,
            versioned_create(true, json_mode, false, false, false),
            &sink,
        )
        .await
        .unwrap();
        assert_eq!(
            sink.events.lock().unwrap().last().unwrap()["kind"],
            if json_mode { "json-end" } else { "stream-end" }
        );
        assert!(next.requests.lock().unwrap().is_empty());
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

#[path = "arena_hosted_reconciliation_capacity_tests.rs"]
mod producer_capacity_tests;

#[tokio::test]
async fn c2_true_writes_require_installed_hono_reconciliation_protocol() {
    for announced in [None, Some("old-reconciliation-version")] {
        let next = server(1, |_, _| rec_capability()).await;
        let hono = server(1, move |_, request| {
            assert_eq!(request.method, "GET");
            assert_eq!(request.path, CAPABILITY_PATH);
            let mut reply = json_capability();
            if let Some(version) = announced {
                reply
                    .headers
                    .push((rec::PROTOCOL_HEADER.into(), version.into()));
            }
            reply
        })
        .await;
        let state = rec_state(hono.origin, next.origin);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        login(&secrets, 42);
        let sink = Sink::default();
        let error = stream(
            &state,
            &cloud,
            &secrets,
            versioned_create(true, true, false, true, false),
            &sink,
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "capability-unavailable");
        assert_eq!(error.dispatch_state, "not-dispatched");
        assert!(sink.events.lock().unwrap().is_empty());
        assert!(hono
            .requests
            .lock()
            .unwrap()
            .iter()
            .all(|r| r.method == "GET"));
        next.task.await.unwrap();
        hono.task.await.unwrap();
    }
}

/// Optional small, synthetic request fixture for the real companion runtime/SQLite/Next
/// integration consumer. Export the HTTP request actually observed by the loopback;
/// never reconstruct its body or headers from the request DTO.
#[tokio::test]
async fn actual_native_create_json_request_can_feed_the_server_integration_consumer() {
    let output = std::env::var("ARENA_RECONCILIATION_CREATE_REQUEST_OUTPUT").ok();
    let next = server(1, |_, request| {
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, rec::PATH);
        assert!(!request.headers.contains_key("cookie"));
        rec_capability()
    })
    .await;
    let hono = server(2, move |i, request| {
        if i == 0 {
            assert_eq!(request.path, CAPABILITY_PATH);
            let mut reply = json_capability();
            reply
                .headers
                .push((rec::PROTOCOL_HEADER.into(), rec::PROTOCOL_VERSION.into()));
            return reply;
        }
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, json_delivery::CREATE_PATH);
        assert_eq!(
            request.headers[json_delivery::PROTOCOL_HEADER],
            json_delivery::PROTOCOL_VERSION
        );
        assert_eq!(request.headers[rec::PROTOCOL_HEADER], rec::PROTOCOL_VERSION);
        assert_eq!(request.headers[EXPECTED_USER_HEADER], "v1:123");
        assert_eq!(request.headers["cookie"], COOKIE);
        assert!(!request.headers.contains_key(ACTOR_HEADER));
        assert!(!request.body.contains(KEY));
        let body: Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["generationRequestId"], RID);
        assert_eq!(body["writeArenaHistory"], true);
        assert_eq!(body["writeCurrentState"], true);
        assert!(!body.as_object().unwrap().contains_key("customProvider"));
        if let Some(path) = &output {
            let fixture = json!({
                "version": 1,
                "syntheticCredentialsOnly": true,
                "source": "actual-native-create-json-http-request",
                "expectedUserId": 123,
                "requestId": RID,
                "method": request.method,
                "path": request.path,
                "headers": request.headers,
                "body": request.body,
            });
            std::fs::write(path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();
        }
        json_reply(200, json_fixture()["successEnvelopes"][0].to_string())
    })
    .await;
    let state = rec_state(hono.origin, next.origin);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 123);
    let mut request = versioned_create(true, true, false, true, true);
    if let ArenaRequest::CreateJson { actor, .. } = &mut request {
        *actor = Actor::Account {
            expected_user_id: 123,
        };
    }
    stream(&state, &cloud, &secrets, request, &Sink::default())
        .await
        .unwrap();
    next.task.await.unwrap();
    hono.task.await.unwrap();
}
