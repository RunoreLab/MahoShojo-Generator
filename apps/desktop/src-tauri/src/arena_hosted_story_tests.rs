//! Real SQLite + production Native transport against synthetic loopback servers.
//! Synthetic account/provider credentials never leave loopback. Direct admission
//! tests below are intentionally distinct from HTTP/SSE integration evidence.
use super::*;
use crate::arena_story::pending::WriteOptions;
use crate::arena_story::{pending, StoryError};
use crate::library::LocalLibrary;
use serde_json::value::RawValue;
use std::collections::BTreeMap;
use std::sync::Barrier;

const RAW_CARD: &str = r#"{"name":"原始角色","apiKey":"ordinary-business-field","isolated":"\ud800","decimal":1.2300e+2}"#;

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
fn story_actor(account: bool) -> Actor {
    if account {
        Actor::Account {
            expected_user_id: 42,
        }
    } else {
        Actor::Anonymous
    }
}
fn story_input(write_roles: bool) -> String {
    let combatants = format!(
        r#"[{{"type":"magical-girl","data":{RAW_CARD},"isPreset":false,"filename":"original.json","arenaRoomKey":"original-room","characterGuidance":"original-local-only"}}]"#
    );
    format!(
        r#"{{"version":1,"sessionId":"native-story","generationRequestId":"{RID}","action":"start","chapterIndex":1,"chapterContext":{{"recentWindow":[],"workingCombatants":{combatants}}},"seed":{{"combatants":{combatants},"mode":"classic","storyLength":"default","language":"zh-CN","settings":{{"readArenaHistory":false,"writeArenaHistory":{write_roles},"readCurrentState":false,"writeCurrentState":{write_roles},"readNarrativeHistory":false,"writeNarrativeHistory":false}}}}}}"#
    )
}
fn candidate(
    product: Product,
    account: bool,
    write_roles: bool,
    input: String,
) -> (
    pending::PendingManifest,
    Vec<(pending::PendingKind, String)>,
) {
    let manifest = pending::PendingManifest {
        version: 1,
        product: story::product(product),
        request_id: RID.into(),
        actor: story::actor(&story_actor(account)),
        pending_revision: 1,
        session_id: "native-story".into(),
        operation_id: "native-story-chapter-1".into(),
        output_checkpoint_id: "native-story-checkpoint-1".into(),
        initial_checkpoint_id: Some("native-story-checkpoint-0".into()),
        created_at: 100,
        expected_revision: 0,
        expected_last_chapter_id: None,
        last_input_checkpoint_id: "native-story-checkpoint-0".into(),
        input_digest: digest(input.as_bytes()),
        write_options: WriteOptions {
            write_arena_history: write_roles,
            write_current_state: write_roles,
            write_narrative_history: false,
        },
        model_completed: false,
        role_state: pending::RoleState::NotRequested,
        role_input_digest: None,
        parts: vec![pending::PendingPart {
            kind: pending::PendingKind::Input,
            byte_length: input.len() as u64,
            digest: digest(input.as_bytes()),
        }],
        commit_manifest: None,
    };
    (manifest, vec![(pending::PendingKind::Input, input)])
}
fn upload(
    state: &ArenaState,
    manifest: &pending::PendingManifest,
    parts: &[(pending::PendingKind, String)],
) -> String {
    let token = state.stories.pending_begin(manifest.clone()).unwrap().token;
    for (kind, raw) in parts {
        for (index, bytes) in raw.as_bytes().chunks(64 * 1024).enumerate() {
            state
                .stories
                .pending_append(&token, *kind, (index * 64 * 1024) as u64, bytes)
                .unwrap();
        }
    }
    token
}
fn seal(
    state: &ArenaState,
    manifest: &pending::PendingManifest,
    parts: &[(pending::PendingKind, String)],
) -> pending::PendingSnapshot {
    let token = upload(state, manifest, parts);
    seal_story_pending(state, state.stories.as_ref(), &token).unwrap()
}
fn default_funding(byok: bool) -> pending::NativeFunding {
    pending::NativeFunding {
        mode: if byok {
            pending::FundingMode::Preset
        } else {
            pending::FundingMode::System
        },
        provider_id: if byok { "kourichat" } else { "system" }.into(),
        model_id: if byok { "gemini-3.8-flash" } else { "default" }.into(),
        generation_overrides: None,
    }
}
fn story_request(manifest: &pending::PendingManifest, byok: bool) -> ArenaRequest {
    let mut value = json!({
        "operation":"create-story-stream", "product":manifest.product,
        "requestId":manifest.request_id, "actor":manifest.actor,
        "pendingRevision":manifest.pending_revision, "inputDigest":manifest.input_digest,
        "clientBodyHash":story::intent_hash(&manifest.input_digest, &default_funding(byok)).unwrap()
    });
    if byok {
        value["presetConfig"] = json!({"providerId":"kourichat","modelId":"gemini-3.8-flash"});
    }
    serde_json::from_value(value).unwrap()
}
fn story_control(manifest: &pending::PendingManifest, operation: &str) -> ArenaRequest {
    let mut value = json!({"operation":operation,"product":manifest.product,
        "requestId":manifest.request_id,"actor":manifest.actor});
    if matches!(operation, "resume" | "status" | "reconcile-story") {
        value["generationId"] = json!(gid());
    }
    if operation == "reconcile-story" {
        value["pendingRevision"] = json!(manifest.pending_revision);
        value["inputDigest"] = json!(manifest.input_digest);
    }
    serde_json::from_value(value).unwrap()
}
fn story_capability() -> Reply {
    let mut reply = capability();
    reply.headers.push((
        story::PROTOCOL_HEADER.into(),
        story::PROTOCOL_VERSION.into(),
    ));
    reply
}
fn story_sse() -> Reply {
    let mut reply = Reply::sse(standard_wire());
    reply.headers.push((
        story::PROTOCOL_HEADER.into(),
        story::PROTOCOL_VERSION.into(),
    ));
    reply
        .headers
        .push(("X-Mahoshojo-Generation-Payload-Hash".into(), "b".repeat(64)));
    reply
}
fn rec_capability() -> Reply {
    Reply::json(
        200,
        json!({"ok":true,"contractVersion":reconciliation::PROTOCOL_VERSION,
        "expectedUserIdAssertion":"v1","ownership":"generation-actor","effects":"frozen-manifest-v1"}),
    )
}
fn role_response() -> String {
    json!({"version":reconciliation::PROTOCOL_VERSION,"generationId":gid(),"success":true,
        "updatedCombatants":[{"combatantIndex":0,"data":{"name":"更新角色","signature":"synthetic-role-signature"},"isNative":true}],
        "warnings":[]}).to_string()
}
fn completion_revision(
    manifest: &pending::PendingManifest,
    parts: &[(pending::PendingKind, String)],
) -> (
    pending::PendingManifest,
    Vec<(pending::PendingKind, String)>,
) {
    let mut next = manifest.clone();
    next.pending_revision += 1;
    next.model_completed = true;
    next.role_state = pending::RoleState::Unresolved;
    let root: BTreeMap<String, &RawValue> = serde_json::from_str(&parts[0].1).unwrap();
    let context: BTreeMap<String, &RawValue> =
        serde_json::from_str(root["chapterContext"].get()).unwrap();
    next.role_input_digest = Some(digest(context["workingCombatants"].get().as_bytes()));
    (next, parts.to_vec())
}

async fn wait_for_requests(requests: &Arc<Mutex<Vec<Request>>>, count: usize) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while requests.lock().unwrap().len() < count {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
}

fn request_trace(requests: &[Request]) -> String {
    requests
        .iter()
        .map(|request| format!("{} {}", request.method, request.path))
        .collect::<Vec<_>>()
        .join(" | ")
}

#[derive(Default)]
struct SlotResolveFailure {
    inner: Secrets,
    fail_slot: AtomicBool,
}
impl SecretStore for SlotResolveFailure {
    fn set(&self, key: &str, value: &str) -> Result<(), SecretStoreError> {
        self.inner.set(key, value)
    }
    fn resolve(&self, key: &str) -> Result<Option<String>, SecretStoreError> {
        if key == Product::Battle.slot() && self.fail_slot.load(Ordering::SeqCst) {
            return Err(SecretStoreError::failure_for_test());
        }
        self.inner.resolve(key)
    }
    fn exists(&self, key: &str) -> Result<bool, SecretStoreError> {
        self.inner.exists(key)
    }
    fn delete(&self, key: &str) -> Result<(), SecretStoreError> {
        self.inner.delete(key)
    }
}

#[test]
fn story_client_body_intent_matches_all_cross_runtime_golden_bytes() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-story-client-body-intent.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut funding = input
            .get("funding")
            .cloned()
            .unwrap_or_else(|| json!({"mode":"system","providerId":"system","modelId":"default"}));
        // The trusted resolver normalizes empty overrides before persistence.
        if funding
            .get("generationOverrides")
            .and_then(Value::as_object)
            .is_some_and(|v| v.is_empty())
        {
            funding
                .as_object_mut()
                .unwrap()
                .remove("generationOverrides");
        }
        let funding: pending::NativeFunding = serde_json::from_value(funding).unwrap();
        let digest = input["inputDigest"].as_str().unwrap();
        let bytes = story::encode_intent(digest, &funding).unwrap();
        let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        assert_eq!(hex, case["encodedHex"], "{}", case["name"]);
        assert_eq!(
            story::intent_hash(digest, &funding).unwrap(),
            case["clientBodyHash"],
            "{}",
            case["name"]
        );
    }
}

#[tokio::test]
async fn story_real_sqlite_loopback_product_actor_funding_matrix_preserves_raw_input_and_sse() {
    for product in [Product::Battle, Product::Arena] {
        for account in [false, true] {
            for byok in [false, true] {
                let srv = server(3, move |i, request| match i {
                    0 => story_capability(),
                    1 if account => story_sse(),
                    1 => token_reply(story_sse(), request),
                    _ => status("completed"),
                })
                .await;
                let state = ArenaState::with_origin(srv.origin.clone());
                let (manifest, parts) = candidate(product, account, false, story_input(false));
                seal(&state, &manifest, &parts);
                let secrets = Secrets::default();
                if account {
                    login(&secrets, 42);
                }
                if byok {
                    secrets.set("preset:kourichat:api-key", KEY).unwrap();
                }
                let cloud = CloudState::new().unwrap();
                let sink = Sink::default();
                stream(
                    &state,
                    &cloud,
                    &secrets,
                    story_request(&manifest, byok),
                    &sink,
                )
                .await
                .unwrap();
                control(
                    &state,
                    &cloud,
                    &secrets,
                    story_control(&manifest, "lookup-request"),
                )
                .await
                .unwrap();
                srv.task.await.unwrap();
                let requests = srv.requests.lock().unwrap();
                assert_eq!(requests[0].method, "GET");
                assert_eq!(requests[0].path, CAPABILITY_PATH);
                assert!(!requests[0].headers.contains_key("cookie"));
                assert!(!requests[0].headers.contains_key(ACTOR_HEADER));
                let sent = &requests[1];
                assert_eq!(sent.method, "POST");
                assert_eq!(sent.path, "/api/arena/session/generate-next");
                assert_eq!(sent.headers[story::PROTOCOL_HEADER], "arena-story-v1");
                assert_eq!(sent.headers["accept"], "text/event-stream");
                assert_eq!(sent.headers.contains_key("cookie"), account);
                assert_eq!(sent.headers.contains_key(EXPECTED_USER_HEADER), account);
                assert_eq!(sent.headers.contains_key(ACTOR_HEADER), !account);
                if account {
                    assert_eq!(sent.headers[EXPECTED_USER_HEADER], "v1:42");
                }
                assert_eq!(sent.body.contains(KEY), byok);
                let original: BTreeMap<&str, &RawValue> =
                    serde_json::from_str(&parts[0].1).unwrap();
                let body: BTreeMap<&str, &RawValue> = serde_json::from_str(&sent.body).unwrap();
                for (key, value) in original {
                    assert_eq!(body[key].get(), value.get(), "{key}");
                }
                assert_eq!(body.contains_key("customProvider"), byok);
                assert!(sent.body.contains(RAW_CARD));
                assert_eq!(
                    requests[2].path,
                    format!("/api/arena/generation-requests/{RID}")
                );
                assert!(requests[2].body.is_empty());
                assert_eq!(sink.wire(), standard_wire());
                assert!(!sink.wire().contains("session_meta"));
                let snapshot = state
                    .stories
                    .pending_describe(manifest.product)
                    .unwrap()
                    .unwrap();
                let claim = snapshot.create_claim.unwrap();
                assert_eq!(claim.funding, default_funding(byok));
                assert_eq!(claim.input_digest, manifest.input_digest);
                assert_eq!(
                    claim.observed_generation.unwrap().server_payload_hash,
                    Some("b".repeat(64))
                );
                let public = serde_json::to_string(&*sink.events.lock().unwrap()).unwrap();
                assert!(!public.contains(KEY));
                assert!(!public.contains(COOKIE));
                assert!(!public.contains("SYNTHETIC-SIGNATURE"));
                eprintln!("STORY_HTTP_MATRIX pid={} product={product:?} actor={} funding={} requests={} post_count=1 sealed_input_bytes={} request_wire_bytes={} sse_bytes={} original_members_byte_exact=true sse_byte_exact=true trace=[{}]", std::process::id(), if account { "synthetic-account" } else { "synthetic-anonymous" }, if byok { "preset" } else { "system" }, requests.len(), parts[0].1.len(), sent.body.len(), sink.wire().len(), request_trace(&requests));
            }
        }
    }
}

#[tokio::test]
async fn story_missing_capability_or_bad_intent_never_claims_or_posts() {
    for bad_hash in [false, true] {
        let srv = server(if bad_hash { 0 } else { 1 }, |_, _| capability()).await;
        let state = ArenaState::with_origin(srv.origin.clone());
        let (manifest, parts) = candidate(Product::Battle, false, false, story_input(false));
        let before = seal(&state, &manifest, &parts);
        let mut request = story_request(&manifest, false);
        if let ArenaRequest::CreateStoryStream {
            client_body_hash, ..
        } = &mut request
        {
            if bad_hash {
                *client_body_hash = "a".repeat(64);
            }
        }
        let result = stream(
            &state,
            &CloudState::new().unwrap(),
            &Secrets::default(),
            request,
            &Sink::default(),
        )
        .await
        .unwrap_err();
        assert_eq!(result.dispatch_state, "not-dispatched");
        assert_eq!(
            state.stories.pending_describe(manifest.product).unwrap(),
            Some(before)
        );
        assert!(state.flights.lock().unwrap().is_empty());
        srv.task.await.unwrap();
        assert!(srv
            .requests
            .lock()
            .unwrap()
            .iter()
            .all(|r| r.method != "POST"));
    }
}

#[tokio::test]
async fn story_missing_create_echo_burns_claim_but_does_not_deliver_untrusted_sse() {
    let srv = server(2, |i, _| {
        if i == 0 {
            story_capability()
        } else {
            Reply::sse(standard_wire())
        }
    })
    .await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let (manifest, parts) = candidate(Product::Battle, true, false, story_input(false));
    seal(&state, &manifest, &parts);
    let secrets = Secrets::default();
    login(&secrets, 42);
    let cloud = CloudState::new().unwrap();
    let sink = Sink::default();
    assert!(stream(
        &state,
        &cloud,
        &secrets,
        story_request(&manifest, false),
        &sink
    )
    .await
    .is_err());
    assert!(sink.events.lock().unwrap().is_empty());
    assert!(state
        .stories
        .pending_describe(manifest.product)
        .unwrap()
        .unwrap()
        .create_claim
        .is_some());
    assert_eq!(
        stream(
            &state,
            &cloud,
            &secrets,
            story_request(&manifest, false),
            &Sink::default()
        )
        .await
        .unwrap_err()
        .code,
        "create-already-attempted"
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
async fn story_frozen_role_writes_require_next_preflight_before_claim_or_secret_slot() {
    let hono = server(1, |_, _| story_capability()).await;
    let next = server(1, |_, request| {
        assert_eq!(request.path, reconciliation::PATH);
        assert_eq!(request.method, "GET");
        assert!(!request.headers.contains_key("cookie"));
        assert!(!request.headers.contains_key(ACTOR_HEADER));
        Reply::json(200, json!({"ok":false}))
    })
    .await;
    let mut state = ArenaState::with_origin(hono.origin.clone());
    state.reconciliation_origin = next.origin.clone();
    let (manifest, parts) = candidate(Product::Arena, false, true, story_input(true));
    let before = seal(&state, &manifest, &parts);
    let secrets = Secrets::default();
    let result = stream(
        &state,
        &CloudState::new().unwrap(),
        &secrets,
        story_request(&manifest, false),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(result.code, "reconciliation-capability-unavailable");
    assert_eq!(result.dispatch_state, "not-dispatched");
    assert_eq!(
        state.stories.pending_describe(manifest.product).unwrap(),
        Some(before)
    );
    assert!(state.flights.lock().unwrap().is_empty());
    assert!(secrets.values.lock().unwrap().is_empty());
    hono.task.await.unwrap();
    next.task.await.unwrap();
    assert!(hono
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|request| request.method == "GET"));
}

#[tokio::test]
async fn story_detach_during_either_capability_probe_is_zero_claim_secret_and_post() {
    for next_probe in [false, true] {
        let srv = server(if next_probe { 2 } else { 1 }, move |index, request| {
            assert_eq!(request.method, "GET");
            let mut reply = if index == 0 {
                story_capability()
            } else {
                rec_capability()
            };
            if index == usize::from(next_probe) {
                reply.delay = Duration::from_millis(100);
            }
            reply
        })
        .await;
        let mut state = ArenaState::with_origin(srv.origin.clone());
        state.reconciliation_origin = srv.origin.clone();
        let (manifest, parts) =
            candidate(Product::Battle, false, next_probe, story_input(next_probe));
        let before = seal(&state, &manifest, &parts);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        let sink = Sink::default();
        let (result, ()) = tokio::join!(
            stream(
                &state,
                &cloud,
                &secrets,
                story_request(&manifest, false),
                &sink
            ),
            async {
                wait_for_requests(&srv.requests, if next_probe { 2 } else { 1 }).await;
                assert!(state.flights.lock().unwrap().contains_key(&Product::Battle));
                assert!(state
                    .stories
                    .pending_describe(manifest.product)
                    .unwrap()
                    .unwrap()
                    .create_claim
                    .is_none());
                assert!(secrets.values.lock().unwrap().is_empty());
                assert!(detach(
                    &state,
                    DetachRequest {
                        product: Product::Battle,
                        request_id: RID.into()
                    }
                )
                .unwrap());
            }
        );
        assert_eq!(result.unwrap_err().code, "detached");
        assert_eq!(
            state.stories.pending_describe(manifest.product).unwrap(),
            Some(before)
        );
        assert!(state.flights.lock().unwrap().is_empty());
        assert!(secrets.values.lock().unwrap().is_empty());
        assert!(sink.events.lock().unwrap().is_empty());
        srv.task.await.unwrap();
        assert!(srv
            .requests
            .lock()
            .unwrap()
            .iter()
            .all(|r| r.method == "GET"));
    }
}

#[tokio::test]
async fn story_single_poll_reservation_detach_before_capability_observation_restores_prior_arc() {
    // Direct Future boundary, not a server round-trip claim: poll once installs
    // the production reservation, before this loopback task observes any GET.
    let srv = server(1, |_, _| story_capability()).await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    let mut ordinary = create(true, false);
    if let ArenaRequest::CreateStream { request_id, .. } = &mut ordinary {
        *request_id = "prior_request_1234".into();
    }
    let prior = state.prepare(&ordinary, &cloud, &secrets).unwrap();
    prior.lock().unwrap().terminal = true;
    let (manifest, parts) = candidate(Product::Battle, true, false, story_input(false));
    let before = seal(&state, &manifest, &parts);
    let original_secrets = secrets.values.lock().unwrap().clone();
    let sink = Sink::default();
    let mut future = Box::pin(stream(
        &state,
        &cloud,
        &secrets,
        story_request(&manifest, false),
        &sink,
    ));
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    assert!(std::future::Future::poll(future.as_mut(), &mut context).is_pending());
    assert!(srv.requests.lock().unwrap().is_empty());
    assert!(!Arc::ptr_eq(
        &prior,
        &state.flights.lock().unwrap()[&Product::Battle]
    ));
    assert!(detach(
        &state,
        DetachRequest {
            product: Product::Battle,
            request_id: RID.into()
        }
    )
    .unwrap());
    assert_eq!(future.await.unwrap_err().code, "detached");
    assert!(Arc::ptr_eq(
        &prior,
        &state.flights.lock().unwrap()[&Product::Battle]
    ));
    assert_eq!(
        state.stories.pending_describe(manifest.product).unwrap(),
        Some(before)
    );
    assert_eq!(*secrets.values.lock().unwrap(), original_secrets);
    assert!(srv.requests.lock().unwrap().is_empty());
    srv.task.abort();
    assert!(srv.task.await.unwrap_err().is_cancelled());
    eprintln!("STORY_DIRECT_PREFLIGHT_CANCEL pid={} single_poll=true capability_observed=false exact_prior_arc_restored=true claim_count=0 post_count=0", std::process::id());
}

#[tokio::test]
async fn story_postclaim_secret_failure_removes_only_prior_terminal_flight_and_allows_original_lookup(
) {
    let srv = server(3, |index, request| {
        if index < 2 {
            return story_capability();
        }
        assert_eq!(request.method, "GET");
        assert_eq!(
            request.path,
            format!("/api/arena/generation-requests/{RID}")
        );
        Reply::json(404, json!({"error":"synthetic generation not found"}))
    })
    .await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let cloud = CloudState::new().unwrap();
    let secrets = SlotResolveFailure::default();
    login(&secrets.inner, 42);
    let mut ordinary = create(true, false);
    if let ArenaRequest::CreateStream { request_id, .. } = &mut ordinary {
        *request_id = "prior_request_1234".into();
    }
    let prior = state.prepare(&ordinary, &cloud, &secrets).unwrap();
    prior.lock().unwrap().terminal = true;
    let (manifest, parts) = candidate(Product::Battle, true, false, story_input(false));
    seal(&state, &manifest, &parts);
    let before_secrets = secrets.inner.values.lock().unwrap().clone();
    secrets.fail_slot.store(true, Ordering::SeqCst);
    assert!(stream(
        &state,
        &cloud,
        &secrets,
        story_request(&manifest, false),
        &Sink::default()
    )
    .await
    .is_err());
    assert!(state
        .stories
        .pending_describe(manifest.product)
        .unwrap()
        .unwrap()
        .create_claim
        .is_some());
    assert!(state.flights.lock().unwrap().is_empty());
    assert_eq!(*secrets.inner.values.lock().unwrap(), before_secrets);
    secrets.fail_slot.store(false, Ordering::SeqCst);
    let mut lookup = story_control(&manifest, "lookup-request");
    if let ArenaRequest::LookupRequest {
        restore_session, ..
    } = &mut lookup
    {
        *restore_session = true;
    }
    assert_eq!(
        control(&state, &cloud, &secrets, lookup)
            .await
            .unwrap()
            .status,
        404
    );
    assert_eq!(
        stream(
            &state,
            &cloud,
            &secrets,
            story_request(&manifest, false),
            &Sink::default()
        )
        .await
        .unwrap_err()
        .code,
        "create-already-attempted"
    );
    srv.task.await.unwrap();
    let requests = srv.requests.lock().unwrap();
    assert!(requests.iter().all(|request| request.method == "GET"));
    eprintln!("STORY_POSTCLAIM_SECRET_FAILURE pid={} durable_claim=true prior_terminal_arc_removed=true original_lookup_status=404 post_count=0 trace=[{}]", std::process::id(), request_trace(&requests));
}

#[tokio::test]
async fn story_detach_during_maintenance_still_cancels_delayed_probe_without_dispatch() {
    let srv = server(1, |_, request| {
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, CAPABILITY_PATH);
        let mut reply = story_capability();
        reply.delay = Duration::from_millis(100);
        reply
    })
    .await;
    let root = tempfile::tempdir().unwrap();
    let library = LocalLibrary::open(root.path()).unwrap();
    let mut state = ArenaState::new(library.shared_stories()).unwrap();
    state.origin = srv.origin.clone();
    let (manifest, parts) = candidate(Product::Battle, false, false, story_input(false));
    let before = seal(&state, &manifest, &parts);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let sink = Sink::default();
    let (result, ()) = tokio::join!(
        stream(
            &state,
            &cloud,
            &secrets,
            story_request(&manifest, false),
            &sink
        ),
        async {
            wait_for_requests(&srv.requests, 1).await;
            let maintenance = library.enter_maintenance("synthetic-backup").unwrap();
            assert!(detach(
                &state,
                DetachRequest {
                    product: Product::Battle,
                    request_id: RID.into()
                }
            )
            .unwrap());
            drop(maintenance);
        }
    );
    assert_eq!(result.unwrap_err().code, "detached");
    assert_eq!(
        state.stories.pending_describe(manifest.product).unwrap(),
        Some(before)
    );
    assert!(state.flights.lock().unwrap().is_empty());
    assert!(secrets.values.lock().unwrap().is_empty());
    assert!(sink.events.lock().unwrap().is_empty());
    srv.task.await.unwrap();
    assert!(srv
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|request| request.method == "GET"));
}

#[tokio::test]
async fn story_preflight_probe_failure_actor_change_and_late_flight_use_exact_restore_cas() {
    for action in ["probe-failure", "actor-change", "later-flight"] {
        let srv = server(1, move |_, _| {
            let mut reply = if action == "probe-failure" {
                capability()
            } else {
                story_capability()
            };
            reply.delay = Duration::from_millis(100);
            reply
        })
        .await;
        let state = ArenaState::with_origin(srv.origin.clone());
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        login(&secrets, 42);
        let mut ordinary = create(true, false);
        if let ArenaRequest::CreateStream { request_id, .. } = &mut ordinary {
            *request_id = "prior_request_1234".into();
        }
        let prior = state.prepare(&ordinary, &cloud, &secrets).unwrap();
        prior.lock().unwrap().terminal = true;
        let (manifest, parts) = candidate(Product::Battle, true, false, story_input(false));
        let before = seal(&state, &manifest, &parts);
        let sink = Sink::default();
        let (result, (expected_flight, expected_secrets)) = tokio::join!(
            stream(
                &state,
                &cloud,
                &secrets,
                story_request(&manifest, false),
                &sink
            ),
            async {
                wait_for_requests(&srv.requests, 1).await;
                let reserved = state.flights.lock().unwrap()[&Product::Battle].clone();
                assert!(!Arc::ptr_eq(&prior, &reserved));
                let expected = if action == "later-flight" {
                    // Direct fixture injection isolates Drop's identity-CAS invariant;
                    // ordinary production create remains blocked by this pending row.
                    let other = ArenaState::isolated();
                    if let ArenaRequest::CreateStream { request_id, .. } = &mut ordinary {
                        *request_id = "later_request_1234".into();
                    }
                    let later = other.prepare(&ordinary, &cloud, &secrets).unwrap();
                    state
                        .flights
                        .lock()
                        .unwrap()
                        .insert(Product::Battle, later.clone());
                    later
                } else {
                    if action == "actor-change" {
                        login(&secrets, 99);
                    }
                    prior.clone()
                };
                (expected, secrets.values.lock().unwrap().clone())
            }
        );
        assert!(result.is_err(), "{action}");
        assert!(
            Arc::ptr_eq(
                &state.flights.lock().unwrap()[&Product::Battle],
                &expected_flight
            ),
            "{action}"
        );
        assert_eq!(*secrets.values.lock().unwrap(), expected_secrets);
        assert_eq!(
            state.stories.pending_describe(manifest.product).unwrap(),
            Some(before)
        );
        assert!(sink.events.lock().unwrap().is_empty());
        srv.task.await.unwrap();
        assert!(srv
            .requests
            .lock()
            .unwrap()
            .iter()
            .all(|r| r.method == "GET"));
    }
}

#[tokio::test]
async fn story_detach_after_preparation_cancels_promoted_token_without_reissuing_claim() {
    // Direct boundary test: prepare has completed its real capability GET, while
    // no stream POST has been entered. The same cancellation token is promoted.
    let srv = server(1, |_, _| story_capability()).await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let (manifest, parts) = candidate(Product::Battle, false, false, story_input(false));
    seal(&state, &manifest, &parts);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    let prepared = story::prepare(&state, &cloud, &secrets, &story_request(&manifest, false))
        .await
        .unwrap();
    assert!(!prepared.token.is_cancelled());
    assert!(detach(
        &state,
        DetachRequest {
            product: Product::Battle,
            request_id: RID.into()
        }
    )
    .unwrap());
    assert!(prepared.token.is_cancelled());
    assert!(prepared.flight.lock().unwrap().subscription.is_none());
    assert!(state
        .stories
        .pending_describe(manifest.product)
        .unwrap()
        .unwrap()
        .create_claim
        .is_some());
    let original_secrets = secrets.values.lock().unwrap().clone();
    assert_eq!(
        stream(
            &state,
            &cloud,
            &secrets,
            story_request(&manifest, false),
            &Sink::default()
        )
        .await
        .unwrap_err()
        .code,
        "create-already-attempted"
    );
    assert_eq!(*secrets.values.lock().unwrap(), original_secrets);
    srv.task.await.unwrap();
    assert!(srv
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|r| r.method == "GET"));
}

#[test]
fn story_native_request_cannot_supply_business_body_credentials_or_reconcile_roles() {
    let (manifest, _) = candidate(Product::Battle, false, false, story_input(false));
    let create = json!({"operation":"create-story-stream","product":"battle","requestId":RID,
        "actor":{"kind":"anonymous"},"pendingRevision":1,"inputDigest":manifest.input_digest,
        "clientBodyHash":story::intent_hash(&manifest.input_digest, &default_funding(false)).unwrap()});
    let mut reconcile = create.clone();
    reconcile["operation"] = json!("reconcile-story");
    reconcile.as_object_mut().unwrap().remove("clientBodyHash");
    reconcile["generationId"] = json!(gid());
    for base in [create, reconcile] {
        serde_json::from_value::<ArenaRequest>(base.clone())
            .unwrap()
            .validate()
            .unwrap();
        for key in [
            "body",
            "url",
            "headers",
            "secretRef",
            "apiKey",
            "internalGuidance",
            "combatants",
            "createClaim",
            "notSent",
            "retryAllowed",
        ] {
            let mut injected = base.clone();
            injected[key] = json!("forbidden");
            assert!(
                serde_json::from_value::<ArenaRequest>(injected).is_err(),
                "{key}"
            );
        }
    }
}

#[tokio::test]
async fn story_active_pending_blocks_ordinary_sse_json_and_terminal_role_pending_preserves_secrets()
{
    for terminal in [false, true] {
        let srv = server(if terminal { 2 } else { 0 }, |i, request| {
            if i == 0 {
                story_capability()
            } else {
                token_reply(story_sse(), request)
            }
        })
        .await;
        let state = ArenaState::with_origin(srv.origin.clone());
        let (manifest, parts) = candidate(Product::Battle, false, false, story_input(false));
        seal(&state, &manifest, &parts);
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        if terminal {
            stream(
                &state,
                &cloud,
                &secrets,
                story_request(&manifest, false),
                &Sink::default(),
            )
            .await
            .unwrap();
            let (next, parts) = completion_revision(&manifest, &parts);
            seal(&state, &next, &parts);
            assert!(
                state.flights.lock().unwrap()[&Product::Battle]
                    .lock()
                    .unwrap()
                    .terminal
            );
        }
        let before = secrets.values.lock().unwrap().clone();
        let flight_before = state.flights.lock().unwrap().get(&Product::Battle).cloned();
        for op in ["create-stream", "create-json"] {
            let mut value = fixture()["validOperations"][0].clone();
            value["operation"] = json!(op);
            value["requestId"] = json!("replacement_request_1234");
            value["replaceRequestId"] = json!(RID);
            value["actor"] = json!({"kind":"anonymous"});
            let request: ArenaRequest = serde_json::from_value(value).unwrap();
            assert_eq!(
                stream(&state, &cloud, &secrets, request, &Sink::default())
                    .await
                    .unwrap_err()
                    .code,
                "recovery-conflict"
            );
            assert_eq!(*secrets.values.lock().unwrap(), before);
        }
        if let Some(before) = flight_before {
            assert!(Arc::ptr_eq(
                &before,
                &state.flights.lock().unwrap()[&Product::Battle]
            ));
        }
        assert_eq!(
            state
                .stories
                .pending_describe(manifest.product)
                .unwrap()
                .unwrap()
                .manifest
                .request_id,
            RID
        );
        srv.task.await.unwrap();
        assert_eq!(
            srv.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.method == "POST")
                .count(),
            usize::from(terminal)
        );
    }
}

#[test]
fn story_first_seal_and_ordinary_prepare_share_real_concurrent_admission_barrier() {
    // A common start barrier exercises both contenders in separate OS threads.
    // The production gate must permit exactly one regardless of scheduler order.
    for _ in 0..12 {
        let state = ArenaState::isolated();
        let cloud = CloudState::new().unwrap();
        let secrets = Secrets::default();
        let (manifest, parts) = candidate(Product::Battle, false, false, story_input(false));
        let token = upload(&state, &manifest, &parts);
        let barrier = Barrier::new(3);
        let (sealed, prepared) = std::thread::scope(|scope| {
            let a = scope.spawn(|| {
                barrier.wait();
                seal_story_pending(&state, state.stories.as_ref(), &token)
            });
            let b = scope.spawn(|| {
                barrier.wait();
                state.prepare(&create(false, false), &cloud, &secrets)
            });
            barrier.wait();
            (a.join().unwrap(), b.join().unwrap())
        });
        assert_ne!(sealed.is_ok(), prepared.is_ok());
        match sealed {
            Ok(_) => {
                assert_eq!(prepared.err().unwrap().code, "recovery-conflict");
                assert!(state.flights.lock().unwrap().is_empty());
            }
            Err(error) => {
                assert_eq!(error, StoryError::Conflict);
                assert!(state
                    .stories
                    .pending_describe(manifest.product)
                    .unwrap()
                    .is_none());
            }
        }
    }
}

#[tokio::test]
async fn story_controls_cannot_steal_identity_and_withdrawn_story_capability_allows_original_resume(
) {
    let srv = server(5, |i, _| match i {
        0 => story_capability(),
        1 => story_sse(),
        2 => capability(), // Story capability was withdrawn after the original create.
        3 => status("completed"),
        _ => Reply::sse(standard_wire()), // No story echo on an existing generation stream.
    })
    .await;
    let root = tempfile::tempdir().unwrap();
    let library = LocalLibrary::open(root.path()).unwrap();
    let mut state = ArenaState::new(library.shared_stories()).unwrap();
    state.origin = srv.origin.clone();
    let (manifest, parts) = candidate(Product::Battle, true, false, story_input(false));
    seal(&state, &manifest, &parts);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    stream(
        &state,
        &cloud,
        &secrets,
        story_request(&manifest, false),
        &Sink::default(),
    )
    .await
    .unwrap();
    drop(state);
    drop(library);
    let library = LocalLibrary::open(root.path()).unwrap();
    let mut state = ArenaState::new(library.shared_stories()).unwrap();
    state.origin = srv.origin.clone();
    let mut intruder = manifest.clone();
    intruder.request_id = "unrelated_request_1234".into();
    assert!(control(
        &state,
        &cloud,
        &secrets,
        story_control(&intruder, "lookup-request")
    )
    .await
    .is_err());
    intruder = manifest.clone();
    intruder.actor = pending::Actor::Anonymous;
    assert!(control(
        &state,
        &cloud,
        &secrets,
        story_control(&intruder, "lookup-request")
    )
    .await
    .is_err());
    assert!(state.flights.lock().unwrap().is_empty());
    control(
        &state,
        &cloud,
        &secrets,
        story_control(&manifest, "lookup-request"),
    )
    .await
    .unwrap();
    let sink = Sink::default();
    stream(
        &state,
        &cloud,
        &secrets,
        story_control(&manifest, "resume"),
        &sink,
    )
    .await
    .unwrap();
    assert_eq!(sink.wire(), standard_wire());
    assert_eq!(
        stream(
            &state,
            &cloud,
            &secrets,
            story_request(&manifest, false),
            &Sink::default()
        )
        .await
        .unwrap_err()
        .code,
        "create-already-attempted"
    );
    srv.task.await.unwrap();
    let requests = srv.requests.lock().unwrap();
    assert_eq!(requests.iter().filter(|r| r.method == "POST").count(), 1);
    assert_eq!(
        requests[4].path,
        format!("/api/arena/generations/{}/stream", gid())
    );
    assert!(!requests[4].headers.contains_key(story::PROTOCOL_HEADER));
}

#[tokio::test]
async fn story_reconciliation_reads_original_roles_then_accepted_revision_is_local_readback() {
    let hono = server(3, |i, _| match i {
        0 => story_capability(),
        1 => story_sse(),
        _ => status("completed"),
    })
    .await;
    let next = server(3, |i, request| {
        assert_eq!(request.path, reconciliation::PATH);
        if i < 2 {
            return rec_capability();
        }
        assert_eq!(request.method, "POST");
        assert_eq!(request.headers[EXPECTED_USER_HEADER], "v1:42");
        assert_eq!(
            request.headers[reconciliation::PROTOCOL_HEADER],
            reconciliation::PROTOCOL_VERSION
        );
        assert!(request.body.contains(RAW_CARD));
        assert!(request
            .body
            .contains(r#""roomCombatantKey":"primary-room""#));
        assert!(request.body.contains(r#""filename":"original\ud800.json""#));
        assert!(request
            .body
            .contains(r#""sourceDataCardId":"source-first""#));
        assert!(!request.body.contains("ignored-fallback"));
        assert!(!request.body.contains("ignored-room"));
        assert!(!request.body.contains("arenaRoomKey"));
        assert!(!request.body.contains("characterGuidance"));
        assert!(!request.body.contains(r#""\ud800":"#));
        assert!(!request.body.contains(r#""unused":"#));
        assert!(!request.body.contains(KEY));
        let mut reply = Reply::json(200, serde_json::from_str(&role_response()).unwrap());
        reply.headers.push((
            reconciliation::PROTOCOL_HEADER.into(),
            reconciliation::PROTOCOL_VERSION.into(),
        ));
        reply
    })
    .await;
    let mut state = ArenaState::with_origin(hono.origin.clone());
    state.reconciliation_origin = next.origin.clone();
    let input = story_input(true).replace(
        r#""filename":"original.json","arenaRoomKey":"original-room""#,
        r#""filename":"\ufeff original\ud800.json\u00a0","sourceDataCardId":"\ufeff source-first\u0020","dataCardId":"ignored-fallback","roomCombatantKey":" primary-room\ufeff","arenaRoomKey":"ignored-room""#,
    )
    .replace("\"chapterContext\"", r#""\u0063hapterContext""#)
    .replace("\"workingCombatants\"", r#""working\u0043ombatants""#)
    .replace("\"type\"", r#""\u0074ype""#)
    .replace("\"data\"", r#""\u0064ata""#)
    .replace(
        r#""characterGuidance":"original-local-only""#,
        r#""characterGuidance":"original-local-only","\ud800":1,"unused":1,"unused":2"#,
    );
    let (manifest, parts) = candidate(Product::Arena, true, true, input);
    seal(&state, &manifest, &parts);
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    stream(
        &state,
        &cloud,
        &secrets,
        story_request(&manifest, false),
        &Sink::default(),
    )
    .await
    .unwrap();
    let (mut completed, mut parts) = completion_revision(&manifest, &parts);
    seal(&state, &completed, &parts);
    let sink = Sink::default();
    stream(
        &state,
        &cloud,
        &secrets,
        story_control(&completed, "reconcile-story"),
        &sink,
    )
    .await
    .unwrap();
    let original = sink
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "json-fragment")
        .map(|v| v["text"].as_str().unwrap())
        .collect::<String>();
    assert_eq!(original, role_response());
    completed.pending_revision += 1;
    completed.role_state = pending::RoleState::Accepted;
    completed.parts.push(pending::PendingPart {
        kind: pending::PendingKind::RoleResponse,
        byte_length: original.len() as u64,
        digest: digest(original.as_bytes()),
    });
    parts.push((pending::PendingKind::RoleResponse, original.clone()));
    let mut mismatched = completed.clone();
    let mut mismatched_parts = parts.clone();
    let wrong_response = original.replace(&gid(), &format!("arena_{}", "c".repeat(64)));
    let bad_part = mismatched.parts.last_mut().unwrap();
    bad_part.byte_length = wrong_response.len() as u64;
    bad_part.digest = digest(wrong_response.as_bytes());
    mismatched_parts.last_mut().unwrap().1 = wrong_response;
    let bad_token = upload(&state, &mismatched, &mismatched_parts);
    assert!(
        seal_story_pending(&state, state.stories.as_ref(), &bad_token).is_err(),
        "a response from generation B must not be accepted by generation A's claim"
    );
    state.stories.pending_abort(&bad_token).unwrap();
    seal(&state, &completed, &parts);
    hono.task.await.unwrap();
    next.task.await.unwrap();
    let accepted = Sink::default();
    stream(
        &state,
        &cloud,
        &secrets,
        story_control(&completed, "reconcile-story"),
        &accepted,
    )
    .await
    .unwrap();
    let reread = accepted
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "json-fragment")
        .map(|v| v["text"].as_str().unwrap())
        .collect::<String>();
    assert_eq!(reread, original);
    let mut wrong_request = story_control(&completed, "reconcile-story");
    if let ArenaRequest::ReconcileStory { generation_id, .. } = &mut wrong_request {
        *generation_id = format!("arena_{}", "c".repeat(64));
    }
    let refused = Sink::default();
    assert!(stream(&state, &cloud, &secrets, wrong_request, &refused)
        .await
        .is_err());
    assert!(refused.events.lock().unwrap().is_empty());
    assert_eq!(
        next.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.method == "POST")
            .count(),
        1
    );
    eprintln!("STORY_RECONCILIATION_HTTP pid={} role_source_data_bytes={} accepted_response_bytes={} role_data_byte_exact=true accepted_response_byte_exact=true accepted_second_post_count=0 hono_trace=[{}] next_trace=[{}]", std::process::id(), RAW_CARD.len(), original.len(), request_trace(&hono.requests.lock().unwrap()), request_trace(&next.requests.lock().unwrap()));
}

#[tokio::test]
#[ignore = "independent 12 MiB + funding Native wire capacity chain"]
async fn story_exact_input_budget_plus_native_funding_overflow_keeps_original_without_claim_or_post(
) {
    let srv = server(0, |_, _| unreachable!()).await;
    let state = ArenaState::with_origin(srv.origin.clone());
    let raw = story_input(false);
    let prefix = &raw[..raw.len() - 1];
    let overhead = format!(r#"{prefix},"userGuidance":""}}"#).len();
    let input = format!(
        r#"{prefix},"userGuidance":"{}"}}"#,
        "x".repeat(INPUT_BYTES - overhead)
    );
    assert_eq!(input.len(), INPUT_BYTES);
    let (manifest, parts) = candidate(Product::Battle, true, false, input);
    let before = seal(&state, &manifest, &parts);
    let secrets = Secrets::default();
    login(&secrets, 42);
    secrets.set("preset:kourichat:api-key", KEY).unwrap();
    let err = stream(
        &state,
        &CloudState::new().unwrap(),
        &secrets,
        story_request(&manifest, true),
        &Sink::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, "invalid-request");
    assert_eq!(err.dispatch_state, "not-dispatched");
    assert_eq!(
        state.stories.pending_describe(manifest.product).unwrap(),
        Some(before)
    );
    assert!(state.flights.lock().unwrap().is_empty());
    srv.task.await.unwrap();
    assert!(srv.requests.lock().unwrap().is_empty());
    let mut restored = Vec::new();
    while restored.len() < parts[0].1.len() {
        let chunk = state
            .stories
            .pending_read(
                &manifest.key(),
                pending::PendingKind::Input,
                restored.len() as u64,
                64 * 1024,
            )
            .unwrap();
        assert!(!chunk.is_empty());
        restored.extend(chunk);
    }
    assert_eq!(restored, parts[0].1.as_bytes());
    eprintln!("STORY_FUNDING_CAPACITY pid={} sealed_input_bytes={} native_wire_limit={} final_wire_over_limit=true retained_input_byte_exact=true claim_count=0 post_count=0", std::process::id(), parts[0].1.len(), INPUT_BYTES);
}

// This test is also an exact-filter child-process entrypoint. No inherited
// in-memory Flight, CloudState, SQLite connection, or credentials are used.
#[tokio::test]
async fn story_process_child() {
    let Ok(mode) = std::env::var("ARENA_STORY_PROCESS_MODE") else {
        return;
    };
    let root = std::path::PathBuf::from(std::env::var("ARENA_STORY_PROCESS_ROOT").unwrap());
    let origin = std::env::var("ARENA_STORY_PROCESS_ORIGIN").unwrap();
    assert!(origin.starts_with("http://127.0.0.1:"));
    let library = LocalLibrary::open(&root).unwrap();
    let mut state = ArenaState::new(library.shared_stories()).unwrap();
    state.origin = origin;
    let manifest = state
        .stories
        .pending_describe(pending::Product::Battle)
        .unwrap()
        .unwrap()
        .manifest;
    let cloud = CloudState::new().unwrap();
    let secrets = Secrets::default();
    login(&secrets, 42);
    match mode.as_str() {
        "claim-before-post" => {
            let prepared =
                story::prepare(&state, &cloud, &secrets, &story_request(&manifest, false))
                    .await
                    .unwrap();
            assert!(state
                .stories
                .pending_describe(manifest.product)
                .unwrap()
                .unwrap()
                .create_claim
                .is_some());
            drop(prepared);
        }
        "post-before-head" => {
            let wait_for_server = async {
                while !root.join("synthetic-post-observed").exists() {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                // Abrupt process exit after the server received POST but before
                // it sends headers: no destructor or success callback runs.
                std::process::exit(77);
            };
            let sink = Sink::default();
            tokio::select! {
                _ = wait_for_server => unreachable!(),
                result = stream(&state, &cloud, &secrets, story_request(&manifest, false), &sink) => panic!("response unexpectedly arrived before process exit: {result:?}"),
            }
        }
        "restart-lookup-only" => {
            assert_eq!(
                stream(
                    &state,
                    &cloud,
                    &secrets,
                    story_request(&manifest, false),
                    &Sink::default()
                )
                .await
                .unwrap_err()
                .code,
                "create-already-attempted"
            );
            for _ in 0..2 {
                let found = control(
                    &state,
                    &cloud,
                    &secrets,
                    story_control(&manifest, "lookup-request"),
                )
                .await
                .unwrap();
                assert_eq!(found.status, 404);
                assert_eq!(
                    stream(
                        &state,
                        &cloud,
                        &secrets,
                        story_request(&manifest, false),
                        &Sink::default()
                    )
                    .await
                    .unwrap_err()
                    .code,
                    "create-already-attempted"
                );
            }
        }
        _ => panic!("unknown synthetic process mode"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn story_real_process_exit_before_post_or_headers_is_durable_and_404_never_reposts() {
    for first_mode in ["claim-before-post", "post-before-head"] {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join("synthetic-post-observed");
        let post_expected = first_mode == "post-before-head";
        let srv = server(if post_expected { 5 } else { 4 }, move |_, request| {
            if request.path == CAPABILITY_PATH {
                return story_capability();
            }
            if request.method == "POST" {
                assert_eq!(request.path, story::CREATE_PATH);
                assert!(post_expected);
                std::fs::write(&marker, b"POST received before headers").unwrap();
                let mut reply = story_sse();
                reply.delay = Duration::from_millis(500);
                return reply;
            }
            assert_eq!(request.method, "GET");
            assert_eq!(
                request.path,
                format!("/api/arena/generation-requests/{RID}")
            );
            Reply::json(404, json!({"error":"synthetic generation not found"}))
        })
        .await;
        {
            let library = LocalLibrary::open(root.path()).unwrap();
            let state = ArenaState::new(library.shared_stories()).unwrap();
            let (manifest, parts) = candidate(Product::Battle, true, false, story_input(false));
            seal(&state, &manifest, &parts);
        }
        for mode in [first_mode, "restart-lookup-only"] {
            let root_path = root.path().to_path_buf();
            let origin = srv.origin.clone();
            let (child_pid, output) = tokio::task::spawn_blocking(move || {
                let child = std::process::Command::new(std::env::current_exe().unwrap())
                    .arg(format!(
                        "{}::story_process_child",
                        module_path!().split_once("::").unwrap().1
                    ))
                    .args(["--exact", "--nocapture"])
                    .env("ARENA_STORY_PROCESS_MODE", mode)
                    .env("ARENA_STORY_PROCESS_ROOT", root_path)
                    .env("ARENA_STORY_PROCESS_ORIGIN", origin)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .unwrap();
                let pid = child.id();
                (pid, child.wait_with_output().unwrap())
            })
            .await
            .unwrap();
            if mode == "post-before-head" {
                assert_eq!(
                    output.status.code(),
                    Some(77),
                    "{}",
                    String::from_utf8_lossy(&output.stderr)
                );
            } else {
                assert!(
                    output.status.success(),
                    "{}\n{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                assert!(
                    String::from_utf8_lossy(&output.stdout).contains("1 passed"),
                    "the exact child test must actually run"
                );
            }
            eprintln!("STORY_PROCESS_BOUNDARY parent_pid={} child_pid={child_pid} mode={mode} exit_code={:?}", std::process::id(), output.status.code());
        }
        srv.task.await.unwrap();
        let requests = srv.requests.lock().unwrap();
        assert_eq!(
            requests.iter().filter(|r| r.method == "POST").count(),
            usize::from(post_expected)
        );
        assert_eq!(
            requests
                .iter()
                .filter(|r| r.path == format!("/api/arena/generation-requests/{RID}"))
                .count(),
            2
        );
        let library = LocalLibrary::open(root.path()).unwrap();
        assert!(library
            .stories()
            .pending_describe(pending::Product::Battle)
            .unwrap()
            .unwrap()
            .create_claim
            .is_some());
        eprintln!("STORY_PROCESS_HTTP parent_pid={} first_mode={first_mode} requests={} total_post_count={} lookup_404_count=2 durable_claim_after_reopen=true trace=[{}]", std::process::id(), requests.len(), requests.iter().filter(|r| r.method == "POST").count(), request_trace(&requests));
    }
}
