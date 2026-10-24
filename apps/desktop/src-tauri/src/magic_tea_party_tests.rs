use super::*;
use crate::library::LocalLibrary;
use serde_json::json;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-magic-tea-party.json"
    ))
    .unwrap()
}
fn setup() -> (SharedConnection, TeaStore) {
    let c = crate::store::open_in_memory_connection().unwrap();
    let store = TeaStore::open(Arc::clone(&c), MaintenanceGate::shared()).unwrap();
    (c, store)
}
fn session(sid: &str) -> Value {
    let mut value = fixture()["session"].clone();
    value["id"] = json!(sid);
    value
}
fn message(sid: &str, mid: &str, role: &str, text: &str) -> Value {
    json!({"id":mid,"sessionId":sid,"role":role,"content":text,"createdAt":2,"status":"done"})
}
fn request(value: Value) -> Value {
    json!({"version":1,"request":value})
}
fn create(store: &TeaStore, sid: &str) -> Value {
    store
        .mutate(request(json!({"action":"create","session":session(sid)})))
        .unwrap()["result"]
        .clone()
}
fn head(store: &TeaStore, sid: &str) -> Value {
    store
        .read(request(
            json!({"action":"session","sessionId":sid,"expectedCatalogRevision":null}),
        ))
        .unwrap()["result"]["record"]
        .clone()
}
fn list(store: &TeaStore) -> Value {
    store
        .read(request(
            json!({"action":"list","cursor":null,"expectedCatalogRevision":null,"limit":50}),
        ))
        .unwrap()["result"]
        .clone()
}
fn pages(
    store: &TeaStore,
    sid: &str,
    head: &Value,
    cursor: Value,
    limit: usize,
) -> Result<Value, TeaError> {
    store.read(request(json!({"action":"messages","sessionId":sid,"instance":head["instance"],"expectedRevision":head["revision"],"cursor":cursor,"expectedCatalogRevision":null,"limit":limit})))
}
fn target_request(action: &str, sid: &str, head: &Value) -> Value {
    json!({"action":action,"sessionId":sid,"instance":head["instance"],"expectedRevision":head["revision"]})
}
fn import(sid: &str) -> Value {
    request(
        json!({"action":"import","operationId":format!("import-{sid}"),"entries":[{"session":session(sid),"messages":[message(sid,&format!("m-{sid}"),"user","保留正文")]}]}),
    )
}
fn receipt(store: &TeaStore, write: Value) -> Result<Value, TeaError> {
    store.read(request(json!({"action":"receipt","write":write})))
}
fn begin(store: &TeaStore, sid: &str) -> (Value, Value) {
    let h = head(store, sid);
    let mut begin = target_request("begin-generation", sid, &h);
    begin["operationId"] = json!(format!("begin-{sid}"));
    begin["session"] = h["session"].clone();
    begin["userMessage"] = message(sid, &format!("user-{sid}"), "user", "你好");
    begin["assistantMessage"] = json!({"id":format!("assistant-{sid}"),"sessionId":sid,"role":"assistant","content":"","createdAt":3,"status":"streaming"});
    let wire = request(begin);
    let result = store.mutate(wire.clone()).unwrap()["result"].clone();
    (wire, result)
}
fn finish(sid: &str, h: &Value, content: &str) -> Value {
    let mut finish = target_request("finish-generation", sid, h);
    finish["operationId"] = json!(format!("finish-{sid}"));
    finish["beginOperationId"] = json!(format!("begin-{sid}"));
    finish["session"] = session(sid);
    finish["assistantMessage"] = json!({"id":format!("assistant-{sid}"),"sessionId":sid,"role":"assistant","content":content,"createdAt":3,"status":"done"});
    request(finish)
}
fn snapshot(c: &SharedConnection) -> String {
    let c = lock_connection(c).unwrap();
    let mut result = Vec::new();
    for table in [
        "magic_tea_session",
        "magic_tea_message",
        "magic_tea_receipt",
        "magic_tea_catalog",
    ] {
        let mut query = c
            .prepare(&format!("SELECT * FROM {table} ORDER BY 1"))
            .unwrap();
        let cols = query.column_count();
        let rows = query
            .query_map([], |row| {
                (0..cols)
                    .map(|i| row.get::<_, rusqlite::types::Value>(i))
                    .collect::<Result<Vec<_>, _>>()
            })
            .unwrap();
        result.push(format!(
            "{table}:{:?}",
            rows.collect::<Result<Vec<_>, _>>().unwrap()
        ));
    }
    result.join("\n")
}

#[test]
fn shared_fixture_documents_round_trip_and_two_commands_are_closed() {
    let (_, store) = setup();
    let write = import("fixture");
    let result = store.mutate(write.clone()).unwrap();
    assert_eq!(result["result"]["action"], "import");
    assert_eq!(head(&store, "fixture")["session"], session("fixture"));
    assert_eq!(
        receipt(&store, write).unwrap()["result"]["receipt"]["result"],
        result["result"]
    );
    assert_eq!(
        store.read(request(json!({"action":"arbitrary","sql":"SELECT 1"}))),
        Err(TeaError::Invalid)
    );
    assert_eq!(store.mutate(json!({"version":1,"request":{"action":"create","session":session("b"),"path":"elsewhere"}})),Err(TeaError::Invalid));
    assert_eq!(
        store.mutate(json!({"version":2,"request":{"action":"create","session":session("b")}})),
        Err(TeaError::Invalid)
    );
}
#[test]
fn import_receipt_is_atomic_exact_and_survives_deletion_without_resurrection() {
    let (c, store) = setup();
    let write = import("a");
    let first = store.mutate(write.clone()).unwrap();
    let before = snapshot(&c);
    assert_eq!(store.mutate(write.clone()).unwrap(), first);
    assert_eq!(snapshot(&c), before);
    let mut changed = write.clone();
    changed["request"]["entries"][0]["messages"][0]["content"] = json!("changed");
    assert_eq!(
        receipt(&store, changed.clone()),
        Err(TeaError::OperationMismatch)
    );
    assert_eq!(store.mutate(changed), Err(TeaError::OperationMismatch));
    assert_eq!(snapshot(&c), before);
    let h = head(&store, "a");
    store
        .mutate(request(target_request("delete", "a", &h)))
        .unwrap();
    let deleted = snapshot(&c);
    assert_eq!(store.mutate(write.clone()).unwrap(), first);
    assert_eq!(
        receipt(&store, write).unwrap()["result"]["receipt"]["result"],
        first["result"]
    );
    assert_eq!(snapshot(&c), deleted);
    assert!(head(&store, "a").is_null());
    verify_schema(&lock_connection(&c).unwrap(), 11).unwrap();
    let miss = receipt(&store, import("absent")).unwrap();
    assert!(miss["result"]["receipt"].is_null());
    assert_eq!(snapshot(&c), deleted);
}
#[test]
fn import_preflight_and_late_sql_failure_roll_back_entire_batch() {
    let (c, store) = setup();
    let initial = snapshot(&c);
    let mut write = import("a");
    write["request"]["entries"]
        .as_array_mut()
        .unwrap()
        .push(json!({"session":session("b"),"messages":[message("b","m-b","user","other")]}));
    let mut invalid = write.clone();
    invalid["request"]["entries"][1]["messages"][0]["sessionId"] = json!("a");
    assert_eq!(store.mutate(invalid), Err(TeaError::Invalid));
    assert_eq!(snapshot(&c), initial);
    let mut duplicate = write.clone();
    duplicate["request"]["entries"][1]["messages"][0]["id"] = json!("m-a");
    assert_eq!(store.mutate(duplicate), Err(TeaError::Invalid));
    assert_eq!(snapshot(&c), initial);
    lock_connection(&c).unwrap().execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON magic_tea_message WHEN NEW.session_id='b' BEGIN SELECT RAISE(ABORT,'synthetic'); END;").unwrap();
    assert_eq!(store.mutate(write.clone()), Err(TeaError::Io));
    assert_eq!(snapshot(&c), initial);
    lock_connection(&c)
        .unwrap()
        .execute_batch("DROP TRIGGER fail_import")
        .unwrap();
    assert_eq!(
        store.mutate(write).unwrap()["result"]["sessions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn begin_commit_precedes_generation_finish_and_stale_or_deleted_results_cannot_write() {
    let (c, store) = setup();
    create(&store, "a");
    let (wire, started) = begin(&store, "a");
    let rows = pages(&store, "a", &started, Value::Null, 100).unwrap();
    assert_eq!(rows["result"]["rows"].as_array().unwrap().len(), 2);
    assert_eq!(rows["result"]["rows"][1]["message"]["status"], "streaming");
    let before = snapshot(&c);
    assert_eq!(store.mutate(wire).unwrap()["result"], started);
    assert_eq!(snapshot(&c), before);
    let mut wrong = finish("a", &started, "answer");
    wrong["request"]["assistantMessage"]["id"] = json!("wrong");
    assert_eq!(store.mutate(wrong), Err(TeaError::Stale));
    assert_eq!(snapshot(&c), before);
    let final_write = finish("a", &started, "已完成 🍵");
    let done = store.mutate(final_write.clone()).unwrap()["result"].clone();
    assert_eq!(done["revision"], 3);
    assert_eq!(
        pages(&store, "a", &done, Value::Null, 100).unwrap()["result"]["rows"][1]["message"]
            ["content"],
        "已完成 🍵"
    );
    store
        .mutate(request(target_request("delete", "a", &done)))
        .unwrap();
    let deleted = snapshot(&c);
    assert_eq!(store.mutate(final_write).unwrap()["result"], done);
    assert_eq!(snapshot(&c), deleted);
    let fresh = create(&store, "a");
    assert_ne!(fresh["instance"], done["instance"]);
    assert_eq!(
        store.mutate(finish("a", &started, "late")),
        Err(TeaError::OperationMismatch)
    );
}
#[test]
fn current_write_failure_retains_placeholder_and_exact_storage_retry_does_not_rebegin() {
    let (c, store) = setup();
    create(&store, "a");
    let (_, started) = begin(&store, "a");
    let before = snapshot(&c);
    let write = finish("a", &started, "保存重试");
    lock_connection(&c).unwrap().execute_batch("CREATE TRIGGER fail_finish BEFORE UPDATE ON magic_tea_message BEGIN SELECT RAISE(ABORT,'synthetic'); END;").unwrap();
    assert_eq!(store.mutate(write.clone()), Err(TeaError::Io));
    assert_eq!(snapshot(&c), before);
    assert!(receipt(&store, write.clone()).unwrap()["result"]["receipt"].is_null());
    lock_connection(&c)
        .unwrap()
        .execute_batch("DROP TRIGGER fail_finish")
        .unwrap();
    store.mutate(write.clone()).unwrap();
    assert_eq!(
        pages(&store, "a", &head(&store, "a"), Value::Null, 100).unwrap()["result"]["rows"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(receipt(&store, write).unwrap()["result"]["receipt"].is_object());
}
#[test]
fn restart_recovers_streaming_and_invalidates_old_finish_without_reissuing_begin() {
    let (c, store) = setup();
    create(&store, "a");
    let (wire, started) = begin(&store, "a");
    let old_catalog = list(&store)["catalogRevision"].as_i64().unwrap();
    drop(store);
    let reopened = TeaStore::open(Arc::clone(&c), MaintenanceGate::shared()).unwrap();
    let h = head(&reopened, "a");
    assert_eq!(h["revision"], 3);
    let rows = pages(&reopened, "a", &h, Value::Null, 100).unwrap();
    let recovered = &rows["result"]["rows"][1]["message"];
    assert_eq!(recovered["status"], "error");
    assert_eq!(recovered["meta"]["completion"], "interrupted");
    assert_eq!(list(&reopened)["catalogRevision"], old_catalog + 1);
    assert_eq!(
        reopened.mutate(finish("a", &started, "late")),
        Err(TeaError::Stale)
    );
    let before = snapshot(&c);
    assert_eq!(reopened.mutate(wire).unwrap()["result"], started);
    assert_eq!(snapshot(&c), before);
    verify_schema(&lock_connection(&c).unwrap(), 11).unwrap();
}
#[test]
fn generation_placeholder_rejects_extensions_without_creating_unrecoverable_rows() {
    let (c, store) = setup();
    create(&store, "a");
    let h = head(&store, "a");
    let mut operation = target_request("begin-generation", "a", &h);
    operation["operationId"] = json!("begin-a");
    operation["session"] = session("a");
    operation["userMessage"] = Value::Null;
    operation["assistantMessage"] = json!({"id":"assistant-a","sessionId":"a","role":"assistant","createdAt":3,"status":"streaming","content":"","meta":{"future":"not-a-placeholder"}});
    let before = snapshot(&c);
    assert_eq!(store.mutate(request(operation)), Err(TeaError::Invalid));
    assert_eq!(snapshot(&c), before);
    assert!(verify_schema(&lock_connection(&c).unwrap(), 11).is_ok());
}
#[test]
fn omitted_and_null_optional_user_have_same_native_receipt_normalization() {
    let (c, store) = setup();
    create(&store, "a");
    let h = head(&store, "a");
    let mut operation = target_request("begin-generation", "a", &h);
    operation["operationId"] = json!("begin-a");
    operation["session"] = session("a");
    operation["assistantMessage"] = json!({"id":"assistant-a","sessionId":"a","role":"assistant","createdAt":3,"status":"streaming","content":""});
    let write = request(operation);
    let done = store.mutate(write.clone()).unwrap();
    let before = snapshot(&c);
    assert_eq!(
        receipt(&store, write.clone()).unwrap()["result"]["receipt"]["result"],
        done["result"]
    );
    let mut null = write;
    null["request"]["userMessage"] = Value::Null;
    assert_eq!(
        receipt(&store, null.clone()).unwrap()["result"]["receipt"]["result"],
        done["result"]
    );
    assert_eq!(store.mutate(null).unwrap(), done);
    assert_eq!(snapshot(&c), before);
    assert!(verify_schema(&lock_connection(&c).unwrap(), 11).is_ok());
}
#[test]
fn catalog_and_session_cursors_fence_every_page_and_same_id_recreation() {
    let (_, store) = setup();
    store.mutate(import("a")).unwrap();
    let first = list(&store);
    let h = head(&store, "a");
    let page = pages(&store, "a", &h, Value::Null, 1).unwrap();
    assert!(page["result"]["nextCursor"].is_null());
    let mut update = target_request("update", "a", &h);
    update["session"] = h["session"].clone();
    update["session"]["title"] = json!("changed");
    store.mutate(request(update)).unwrap();
    assert_eq!(pages(&store, "a", &h, Value::Null, 1), Err(TeaError::Stale));
    assert_eq!(store.read(request(json!({"action":"list","cursor":null,"expectedCatalogRevision":first["catalogRevision"],"limit":1}))),Err(TeaError::Stale));
    let h2 = head(&store, "a");
    store
        .mutate(request(target_request("delete", "a", &h2)))
        .unwrap();
    create(&store, "a");
    assert_eq!(
        pages(&store, "a", &h2, Value::Null, 1),
        Err(TeaError::Stale)
    );
    assert_eq!(
        pages(&store, "a", &head(&store, "a"), Value::Null, 1).unwrap()["result"]["rows"],
        json!([])
    );
}
#[test]
fn unsafe_keys_media_depth_and_wrong_relationships_fail_before_writes() {
    let (c, store) = setup();
    let before = snapshot(&c);
    for bad in [
        json!({"tachieAssets":[]}),
        serde_json::from_str(r#"{"future":{"__proto__":{"x":1}}}"#).unwrap(),
    ] {
        let mut doc = session("a");
        for (k, v) in bad.as_object().unwrap() {
            doc[k] = v.clone();
        }
        assert_eq!(
            store.mutate(request(json!({"action":"create","session":doc}))),
            Err(TeaError::Invalid)
        );
    }
    let mut write = import("a");
    write["request"]["entries"][0]["messages"][0]["tachieId"] = json!("image");
    assert_eq!(store.mutate(write), Err(TeaError::Invalid));
    assert_eq!(snapshot(&c), before);
    assert!(serde_json::from_str::<Value>(r#"{"text":"\ud800"}"#).is_err());
    assert!(serde_json::from_str::<Value>(r#"{"\udfff":"key"}"#).is_err());
}
#[test]
fn backup_shape_rejects_corrupt_receipts_but_accepts_historical_deleted_sessions() {
    let (c, store) = setup();
    store.mutate(import("a")).unwrap();
    verify_schema(&lock_connection(&c).unwrap(), 11).unwrap();
    lock_connection(&c)
        .unwrap()
        .execute(
            "UPDATE magic_tea_receipt SET result=?1",
            [r#"{"action":"import","operationId":"import-a","sessions":[{}]}"#],
        )
        .unwrap();
    assert_eq!(
        verify_schema(&lock_connection(&c).unwrap(), 11),
        Err(StoreError::InvalidDocument)
    );
}
#[test]
fn maintenance_and_safe_integer_overflow_fail_without_partial_commit() {
    let c = crate::store::open_in_memory_connection().unwrap();
    let gate = MaintenanceGate::shared();
    let store = TeaStore::open(Arc::clone(&c), Arc::clone(&gate)).unwrap();
    let permit = gate.enter_maintenance("synthetic").unwrap();
    assert_eq!(store.mutate(import("a")), Err(TeaError::Maintenance));
    drop(permit);
    lock_connection(&c)
        .unwrap()
        .execute("UPDATE magic_tea_catalog SET revision=?1", [MAX_SAFE])
        .unwrap();
    let before = snapshot(&c);
    assert_eq!(store.mutate(import("a")), Err(TeaError::TooLarge));
    assert_eq!(snapshot(&c), before);
    assert!(verify_schema(&lock_connection(&c).unwrap(), 11).is_ok());
}

fn padded_message(sid: &str, mid: &str, bytes: usize) -> Value {
    let mut value = message(sid, mid, "assistant", "");
    let overhead = encoded(&value).unwrap().len();
    value["content"] = json!("a".repeat(bytes - overhead));
    assert_eq!(encoded(&value).unwrap().len(), bytes);
    value
}
#[test]
fn exact_document_and_full_write_budgets_still_allow_original_body_receipt_and_progressing_pages() {
    let (_, store) = setup();
    let sid = "s".repeat(128);
    let first_id = "a".repeat(128);
    let second_id = "b".repeat(128);
    let first = padded_message(&sid, &first_id, MESSAGE_BYTES);
    let mut second = message(&sid, &second_id, "assistant", "");
    let mut write = request(
        json!({"action":"import","operationId":"o".repeat(128),"entries":[{"session":session(&sid),"messages":[first,second]}]}),
    );
    let missing = WRITE_BYTES - encoded(&json!({"request":&write})).unwrap().len();
    second = write["request"]["entries"][0]["messages"][1].clone();
    second["content"] = json!("b".repeat(missing));
    write["request"]["entries"][0]["messages"][1] = second;
    assert_eq!(
        encoded(&json!({"request":&write})).unwrap().len(),
        WRITE_BYTES
    );
    assert!(
        encoded(&write["request"]["entries"][0]["messages"][1])
            .unwrap()
            .len()
            <= MESSAGE_BYTES
    );
    let result = store.mutate(write.clone()).unwrap();
    let query = request(json!({"action":"receipt","write":&write}));
    let query_bytes = encoded(&json!({"request":&query})).unwrap().len();
    assert!(query_bytes > WRITE_BYTES && query_bytes <= RECEIPT_READ_BYTES);
    assert_eq!(
        store.read(query).unwrap()["result"]["receipt"]["result"],
        result["result"]
    );
    let h = head(&store, &sid);
    let one = pages(&store, &sid, &h, Value::Null, 100).unwrap();
    assert_eq!(one["result"]["rows"].as_array().unwrap().len(), 1);
    assert!(encoded(&one).unwrap().len() <= PAGE_BYTES);
    assert_eq!(one["result"]["rows"][0]["message"]["id"], first_id);
    let two = pages(&store, &sid, &h, one["result"]["nextCursor"].clone(), 100).unwrap();
    assert_eq!(two["result"]["rows"].as_array().unwrap().len(), 1);
    assert_eq!(two["result"]["rows"][0]["message"]["id"], second_id);
    assert!(two["result"]["nextCursor"].is_null());
    let original = write["request"]["entries"][0]["messages"][1]["content"]
        .as_str()
        .unwrap()
        .to_owned();
    write["request"]["entries"][0]["messages"][1]["content"] = json!(original + "x");
    assert_eq!(store.mutate(write), Err(TeaError::TooLarge));
    let too_large = padded_message("small", "message", MESSAGE_BYTES + 1);
    assert_eq!(
        validate_message(&too_large, "small"),
        Err(TeaError::TooLarge)
    );
}
#[test]
fn large_short_line_projection_fits_declared_nodes_without_changing_its_segments() {
    let mut message = message("large", "m-large", "assistant", &"a\n".repeat(500_000));
    message["segments"] = Value::Array(
        (0..500_000)
            .map(|_| json!({"type":"narration","text":"a"}))
            .collect(),
    );
    let text = validate_message(&message, "large").unwrap();
    assert!(text.len() > 16 * 1024 * 1024);
    assert!(text.len() < MESSAGE_BYTES);
    assert_eq!(message["segments"].as_array().unwrap().len(), 500_000);
}
#[test]
fn nonempty_tea_backup_restores_records_receipts_and_recovers_interrupted_generation() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let guard = crate::maintenance::InstanceGuard::acquire(root).unwrap();
    let library = LocalLibrary::open(root).unwrap();
    let imported = import("a");
    library.tea().mutate(imported.clone()).unwrap();
    begin(library.tea(), "a");
    // The public backup API snapshots the same SQLite file with the Tea tables included.
    let backup = crate::backup::create_backup(&library).unwrap();
    let verified = crate::backup::verify_backup(root, &backup.backup_id).unwrap();
    assert_eq!(verified.backup_id, backup.backup_id);
    let stored = head(library.tea(), "a");
    create(library.tea(), "after-backup");
    let prepared = crate::restore::prepare_restore(&library, &backup.backup_id).unwrap();
    drop(library);
    drop(prepared.permit);
    drop(guard);
    let _restart_guard = crate::maintenance::InstanceGuard::acquire(root).unwrap();
    crate::restore::recover_pending(root).unwrap();
    let reopened = LocalLibrary::open(root).unwrap();
    assert!(head(reopened.tea(), "after-backup").is_null());
    let recovered = head(reopened.tea(), "a");
    assert_eq!(
        recovered["revision"].as_i64().unwrap(),
        stored["revision"].as_i64().unwrap() + 1
    );
    assert!(receipt(reopened.tea(), imported).unwrap()["result"]["receipt"].is_object());
}
#[test]
fn actual_native_tea_wire_is_emitted_only_from_real_storage_results() {
    let (c, store) = setup();
    let mut wire = import("tea-fixture");
    wire["request"]["entries"][0]["messages"] = fixture()["messages"].clone();
    let imported = store.mutate(wire.clone()).unwrap();
    let actual_list = store
        .read(request(
            json!({"action":"list","cursor":null,"expectedCatalogRevision":null,"limit":50}),
        ))
        .unwrap();
    let session_query = request(
        json!({"action":"session","sessionId":"tea-fixture","expectedCatalogRevision":null}),
    );
    let actual_session = store.read(session_query.clone()).unwrap();
    let record = head(&store, "tea-fixture");
    let messages = pages(&store, "tea-fixture", &record, Value::Null, 100).unwrap();
    let import_query = request(json!({"action":"receipt","write":wire}));
    let imported_receipt = store.read(import_query.clone()).unwrap();
    let (begin_wire, started) = begin(&store, "tea-fixture");
    let begin_response = response(started.clone(), DIRECTORY_BYTES).unwrap();
    let begin_query = request(json!({"action":"receipt","write":begin_wire}));
    let begin_receipt = store.read(begin_query.clone()).unwrap();
    let finish_wire = finish("tea-fixture", &started, "真实已保存文本 🍵");
    let finished = store.mutate(finish_wire.clone()).unwrap();
    let finish_query = request(json!({"action":"receipt","write":finish_wire}));
    let finish_receipt = store.read(finish_query.clone()).unwrap();
    let mut stale = target_request("update", "tea-fixture", &record);
    stale["session"] = session("tea-fixture");
    let stale_wire = request(stale);
    let stale_error = store.mutate(stale_wire.clone()).unwrap_err();
    assert_eq!(stale_error, TeaError::Stale);
    verify_schema(&lock_connection(&c).unwrap(), 11).unwrap();
    if let Some(directory) = std::env::var_os("MAGIC_TEA_PARTY_NATIVE_WIRE_OUTPUT") {
        let directory = std::path::PathBuf::from(directory);
        assert!(directory.is_dir());
        let rows = [
            ("import-request", wire),
            ("import", imported),
            ("list", actual_list),
            ("session", actual_session),
            ("messages", messages),
            ("receipt-request", import_query),
            ("receipt", imported_receipt),
            ("begin-request", begin_wire),
            ("begin", begin_response),
            ("begin-receipt-request", begin_query),
            ("begin-receipt", begin_receipt),
            ("finish-request", finish_wire),
            ("finish", finished),
            ("finish-receipt-request", finish_query),
            ("finish-receipt", finish_receipt),
            ("stale-request", stale_wire),
            ("stale-error", serde_json::to_value(stale_error).unwrap()),
        ];
        for (name, value) in rows {
            std::fs::write(
                directory.join(format!("{name}.json")),
                serde_json::to_vec(&value).unwrap(),
            )
            .unwrap();
        }
    }
}

#[test]
fn escaped_directory_previews_paginate_by_actual_wire_without_loss_or_empty_loops() {
    let (_, store) = setup();
    for index in 0..50 {
        let sid = format!("session-{index:02}");
        let mut doc = session(&sid);
        doc["title"] = json!("\u{1}".repeat(192));
        doc["roles"] = json!((0..8).map(|role| json!({"id":format!("role-{role}"),"name":"\u{2}".repeat(192),"source":"local","card":{}})).collect::<Vec<_>>());
        doc["scenario"] =
            json!({"id":"scenario","title":"\u{3}".repeat(192),"source":"local","card":{}});
        store
            .mutate(request(json!({"action":"create","session":doc})))
            .unwrap();
    }
    let mut cursor = Value::Null;
    let mut seen = HashSet::new();
    let mut count = 0;
    loop {
        let page = store
            .read(request(
                json!({"action":"list","cursor":cursor,"expectedCatalogRevision":null,"limit":50}),
            ))
            .unwrap();
        assert!(encoded(&page).unwrap().len() <= DIRECTORY_BYTES);
        let rows = page["result"]["rows"].as_array().unwrap();
        assert!(!rows.is_empty());
        for row in rows {
            assert!(seen.insert(row["id"].as_str().unwrap().to_owned()));
        }
        count += 1;
        assert!(count <= 50);
        cursor = page["result"]["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    assert_eq!(seen.len(), 50);
    assert!(count > 1);
}
fn nested_json(depth: usize) -> Value {
    let mut value = json!("leaf");
    for _ in 0..depth {
        value = json!({"nested":value});
    }
    value
}
#[test]
fn deepest_admitted_begin_user_and_finish_message_are_readable_with_fixed_response_shell() {
    let (_, store) = setup();
    create(&store, "deep");
    let h = head(&store, "deep");
    let mut operation = target_request("begin-generation", "deep", &h);
    operation["operationId"] = json!("begin-deep");
    operation["session"] = session("deep");
    let mut user = message("deep", "user-deep", "user", "text");
    user["future"] = nested_json(60);
    operation["userMessage"] = user;
    operation["assistantMessage"] = json!({"id":"assistant-deep","sessionId":"deep","role":"assistant","createdAt":3,"status":"streaming","content":""});
    let write = request(operation);
    assert!(json_boundary(&json!({"request":&write}), WRITE_BYTES, ENVELOPE_NODES).is_ok());
    let mut beyond = write.clone();
    beyond["request"]["userMessage"]["future"] = nested_json(61);
    assert_eq!(store.mutate(beyond), Err(TeaError::TooLarge));
    let started = store.mutate(write).unwrap()["result"].clone();
    assert!(pages(&store, "deep", &started, Value::Null, 100).is_ok());
    let mut finish = finish("deep", &started, "done");
    finish["request"]["assistantMessage"]["future"] = nested_json(60);
    let done = store.mutate(finish).unwrap()["result"].clone();
    let page = pages(&store, "deep", &done, Value::Null, 100).unwrap();
    assert!(json_boundary(&page, PAGE_BYTES, ENVELOPE_NODES).is_err());
    assert!(json_boundary_depth(&page, PAGE_BYTES, ENVELOPE_NODES, 68).is_ok());
}
#[test]
fn real_deferred_commit_failure_rolls_back_all_tables_and_allows_exact_storage_retry() {
    let (c, store) = setup();
    let before = snapshot(&c);
    lock_connection(&c).unwrap().execute_batch("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(parent INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fault_commit AFTER INSERT ON magic_tea_session BEGIN INSERT INTO fault_child(parent) VALUES(999); END;").unwrap();
    let write = import("deferred");
    assert_eq!(store.mutate(write.clone()), Err(TeaError::CommitUnknown));
    assert_eq!(snapshot(&c), before);
    assert!(lock_connection(&c).unwrap().is_autocommit());
    assert!(receipt(&store, write.clone()).unwrap()["result"]["receipt"].is_null());
    lock_connection(&c)
        .unwrap()
        .execute_batch(
            "DROP TRIGGER fault_commit; DROP TABLE fault_child; DROP TABLE fault_parent;",
        )
        .unwrap();
    let committed = store.mutate(write.clone()).unwrap();
    let after = snapshot(&c);
    assert_eq!(
        receipt(&store, write.clone()).unwrap()["result"]["receipt"]["result"],
        committed["result"]
    );
    assert_eq!(store.mutate(write).unwrap(), committed);
    assert_eq!(snapshot(&c), after);
}

#[path = "magic_tea_party_journey_tests.rs"]
mod journey;

fn pin_write(store: &TeaStore, sid: &str, pinned: bool, operation: &str) -> Value {
    let mut value = target_request("set-pin", sid, &head(store, sid));
    value["operationId"] = json!(operation);
    value["pinned"] = json!(pinned);
    request(value)
}
fn selected_write(store: &TeaStore, ids: &[&str], operation: &str) -> Value {
    request(
        json!({"action":"delete-selected","operationId":operation,"targets":ids.iter().map(|sid| {
        let h = head(store, sid); json!({"sessionId":sid,"instance":h["instance"],"expectedRevision":h["revision"]})
    }).collect::<Vec<_>>()}),
    )
}
#[test]
fn organization_pin_is_narrow_receipted_and_busy_safe() {
    let (c, store) = setup();
    create(&store, "a");
    create(&store, "b");
    let original = head(&store, "a")["session"].clone();
    let write = pin_write(&store, "a", true, "pin-a");
    let result = store.mutate(write.clone()).unwrap();
    assert!(result["result"]["pinnedAt"].as_i64().unwrap() > 0);
    let mut updated = head(&store, "a")["session"].clone();
    updated.as_object_mut().unwrap().remove("pinnedAt");
    updated.as_object_mut().unwrap().remove("pinnedOrder");
    assert_eq!(updated, original);
    assert_eq!(store.mutate(write.clone()).unwrap(), result);
    assert_eq!(
        receipt(&store, write.clone()).unwrap()["result"]["receipt"]["result"],
        result["result"]
    );
    let mut changed = write;
    changed["request"]["pinned"] = json!(false);
    assert_eq!(
        store.mutate(changed).unwrap_err(),
        TeaError::OperationMismatch
    );
    store
        .mutate(pin_write(&store, "a", false, "unpin-a"))
        .unwrap();
    assert_eq!(head(&store, "a")["session"], original);
    begin(&store, "b");
    let before = snapshot(&c);
    assert_eq!(
        store
            .mutate(pin_write(&store, "b", true, "busy-pin"))
            .unwrap_err(),
        TeaError::Busy
    );
    assert_eq!(
        store
            .mutate(request(target_request("delete", "b", &head(&store, "b"))))
            .unwrap_err(),
        TeaError::Busy
    );
    assert_eq!(snapshot(&c), before);
    assert!(verify_schema(&lock_connection(&c).unwrap(), 11).is_ok());
}
#[test]
fn selected_cleanup_checks_entire_batch_before_writing_and_replays_only_receipt() {
    let (c, store) = setup();
    create(&store, "a");
    create(&store, "b");
    let stale = selected_write(&store, &["a", "b"], "stale");
    store.mutate(pin_write(&store, "b", true, "pin")).unwrap();
    let before = snapshot(&c);
    assert_eq!(store.mutate(stale).unwrap_err(), TeaError::Stale);
    assert_eq!(
        store
            .mutate(selected_write(&store, &["a", "b"], "pinned"))
            .unwrap_err(),
        TeaError::Invalid
    );
    assert_eq!(snapshot(&c), before);
    store
        .mutate(pin_write(&store, "b", false, "unpin"))
        .unwrap();
    begin(&store, "b");
    let before = snapshot(&c);
    assert_eq!(
        store
            .mutate(selected_write(&store, &["a", "b"], "busy"))
            .unwrap_err(),
        TeaError::Busy
    );
    assert_eq!(snapshot(&c), before);
    let h = head(&store, "b");
    store.mutate(finish("b", &h, "done")).unwrap();
    let write = selected_write(&store, &["a", "b"], "delete-both");
    let result = store.mutate(write.clone()).unwrap();
    assert!(list(&store)["rows"].as_array().unwrap().is_empty());
    create(&store, "a"); // receipt replay must not delete a new instance with the same ID.
    assert_eq!(store.mutate(write.clone()).unwrap(), result);
    assert!(!head(&store, "a").is_null());
    assert_eq!(
        receipt(&store, write).unwrap()["result"]["receipt"]["result"],
        result["result"]
    );
}
#[test]
fn organization_keyset_spans_pinned_pages_and_preserves_legacy_json_and_preview() {
    let (c, store) = setup();
    for i in 0..112 {
        let mut doc = session(&format!("s{i:03}"));
        doc["updatedAt"] = json!(i + 1);
        if i < 61 {
            doc["pinnedAt"] = json!(100);
            doc["pinnedOrder"] = json!(i + 1);
        }
        if i == 111 {
            doc["pinnedAt"] = json!("legacy-invalid");
            doc["pinnedOrder"] = json!({"keep":true});
        }
        store
            .mutate(request(json!({"action":"create","session":doc})))
            .unwrap();
    }
    let before = head(&store, "s111")["session"].clone();
    let mut cursor = Value::Null;
    let mut ids = Vec::new();
    loop {
        let page = store
            .read(request(
                json!({"action":"list","cursor":cursor,"expectedCatalogRevision":null,"limit":17}),
            ))
            .unwrap();
        ids.extend(
            page["result"]["rows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r["id"].as_str().unwrap().to_owned()),
        );
        cursor = page["result"]["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    let expected: Vec<_> = (0..61)
        .rev()
        .chain((61..112).rev())
        .map(|i| format!("s{i:03}"))
        .collect();
    assert_eq!(ids, expected);
    assert_eq!(head(&store, "s111")["session"], before);
    assert!(verify_schema(&lock_connection(&c).unwrap(), 11).is_ok());
    let cursor = list(&store)["nextCursor"].clone();
    store
        .mutate(pin_write(&store, "s111", true, "pin-last"))
        .unwrap();
    assert_eq!(list(&store)["rows"][0]["id"], "s111");
    assert_eq!(
        store
            .read(request(
                json!({"action":"list","cursor":cursor,"expectedCatalogRevision":null,"limit":50})
            ))
            .unwrap_err(),
        TeaError::Stale
    );
}
#[test]
fn directory_matches_shared_web_organization_order_fixture() {
    let (_, store) = setup();
    let fixture = fixture();
    for fields in fixture["organizationOrder"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
    {
        let mut doc = session(fields["id"].as_str().unwrap());
        for (key, value) in fields.as_object().unwrap() {
            doc[key] = value.clone();
        }
        store
            .mutate(request(json!({"action":"create","session":doc})))
            .unwrap();
    }
    let actual: Vec<_> = list(&store)["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].clone())
        .collect();
    assert_eq!(json!(actual), fixture["organizationExpected"]);
}

// Explicit synthetic evaluation, not a constant-time promise or a user-library benchmark.
#[test]
#[ignore]
fn organization_directory_query_cost() {
    for (count, bytes) in [(2000, 1024), (2000, 65536), (128, 1048576)] {
        let (c, store) = setup();
        {
            let c = lock_connection(&c).unwrap();
            transaction(&c, true, || {
                for i in 0..count {
                    let mut doc = session(&format!("perf-{i:06}"));
                    doc["padding"] = json!("x".repeat(bytes));
                    doc["pinnedAt"] = json!(i % 2 * 10);
                    doc["pinnedOrder"] = json!(i);
                    insert_session(&c, &doc)?;
                }
                Ok(())
            })
            .unwrap();
            let sql = format!("EXPLAIN QUERY PLAN {}", directory_sql());
            let mut query = c.prepare(&sql).unwrap();
            let plan = query
                .query_map(params![false, 0, 0, 0, "", 51], |r| r.get::<_, String>(3))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            eprintln!("Tea directory query plan ({count} x {bytes}): {plan:?}");
        }
        let start = std::time::Instant::now();
        let first = list(&store);
        let first_ms = start.elapsed().as_millis();
        let start = std::time::Instant::now();
        let second = store.read(request(json!({"action":"list","cursor":first["nextCursor"],"expectedCatalogRevision":null,"limit":50}))).unwrap();
        eprintln!(
            "Tea directory synthetic {count} x {bytes} bytes: first {first_ms}ms, second {}ms",
            start.elapsed().as_millis()
        );
        assert_eq!(first["rows"].as_array().unwrap().len(), 50);
        assert_eq!(second["result"]["rows"].as_array().unwrap().len(), 50);
    }
}
#[test]
fn selected_cleanup_late_sql_failure_rolls_back_first_delete_and_receipt() {
    let (c, store) = setup();
    create(&store, "a");
    create(&store, "b");
    let write = selected_write(&store, &["a", "b"], "late-cleanup");
    let before = snapshot(&c);
    lock_connection(&c).unwrap().execute_batch("CREATE TRIGGER fail_selected BEFORE DELETE ON magic_tea_session WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT,'synthetic'); END;").unwrap();
    assert_eq!(store.mutate(write.clone()).unwrap_err(), TeaError::Io);
    assert_eq!(snapshot(&c), before);
    assert!(receipt(&store, write.clone()).unwrap()["result"]["receipt"].is_null());
    lock_connection(&c)
        .unwrap()
        .execute_batch("DROP TRIGGER fail_selected")
        .unwrap();
    store.mutate(write).unwrap();
    assert!(list(&store)["rows"].as_array().unwrap().is_empty());
    verify_schema(&lock_connection(&c).unwrap(), 12).unwrap();
}

fn fork_request(store: &TeaStore, sid: &str, anchor: &str, target: &str) -> Value {
    let mut fork = target_request("fork", sid, &head(store, sid));
    fork["operationId"] = json!(format!("fork-{target}"));
    fork["anchorMessageId"] = json!(anchor);
    fork["editedContent"] = json!("  编辑后的内容  ");
    fork["targetSessionId"] = json!(target);
    request(fork)
}
fn fork_source(store: &TeaStore, count: usize) {
    let mut doc = session("source");
    doc["draft"] = json!("未发送草稿");
    doc["autoSummaryState"] = json!({"pending":true});
    doc["settings"]["autoSummaryEnabled"] = json!(true);
    doc["pinnedAt"] = json!(7);
    doc["pinnedOrder"] = json!(9);
    let messages: Vec<_> = (0..count)
        .map(|i| {
            let mut m = message(
                "source",
                &format!("m-{i}"),
                if i % 2 == 0 { "user" } else { "assistant" },
                "原文",
            );
            // All timestamps tie, IDs do not sort like ordinals.
            if i > 0 {
                m["sourceMessageId"] = json!(format!("m-{}", i - 1));
                m["revisionOf"] = json!("external");
            }
            m
        })
        .collect();
    store.mutate(request(json!({"action":"import","operationId":"seed","entries":[{"session":doc,"messages":messages}]}))).unwrap();
}
fn session_bytes(c: &SharedConnection, sid: &str) -> Vec<String> {
    let c = lock_connection(c).unwrap();
    let mut q = c.prepare("SELECT document FROM magic_tea_session WHERE id=?1 UNION ALL SELECT document FROM magic_tea_message WHERE session_id=?1 ORDER BY document").unwrap();
    q.query_map([sid], |r| r.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}
#[test]
fn fork_first_middle_and_long_prefix_are_atomic_ordinal_branches() {
    for anchor in [0, 4, 104] {
        let (c, store) = setup();
        fork_source(&store, 108);
        let before = session_bytes(&c, "source");
        let source_head = head(&store, "source");
        let catalog_before = catalog(&lock_connection(&c).unwrap()).unwrap();
        let wire = fork_request(&store, "source", &format!("m-{anchor}"), "branch");
        let result = store.mutate(wire.clone()).unwrap();
        assert_eq!(result["result"]["action"], "fork");
        assert_eq!(result["result"]["revision"], 1);
        assert_ne!(result["result"]["instance"], source_head["instance"]);
        assert_eq!(store.mutate(wire.clone()).unwrap(), result);
        assert_eq!(
            receipt(&store, wire).unwrap()["result"]["receipt"]["result"],
            result["result"]
        );
        assert_eq!(session_bytes(&c, "source"), before);
        assert_eq!(head(&store, "source"), source_head);
        let branch = head(&store, "branch");
        assert_eq!(branch["session"]["draft"], "未发送草稿");
        assert_eq!(branch["session"]["pinnedOrder"], 9);
        assert_eq!(branch["session"]["settings"]["autoSummaryEnabled"], false);
        assert!(branch["session"].get("autoSummaryState").is_none());
        let c = lock_connection(&c).unwrap();
        assert_eq!(catalog(&c).unwrap(), catalog_before + 1);
        let mut q = c
            .prepare(
                "SELECT document FROM magic_tea_message WHERE session_id='branch' ORDER BY ordinal",
            )
            .unwrap();
        let messages: Vec<Value> = q
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| serde_json::from_str(&r.unwrap()).unwrap())
            .collect();
        assert_eq!(messages.len(), anchor + 1);
        for i in 0..anchor {
            assert_ne!(messages[i]["id"], format!("m-{i}"));
            if i > 0 {
                assert_eq!(messages[i]["sourceMessageId"], messages[i - 1]["id"]);
                assert_eq!(messages[i]["revisionOf"], "external");
            }
        }
        assert_eq!(messages[anchor]["revisionOf"], format!("m-{anchor}"));
        assert_eq!(messages[anchor]["content"], "编辑后的内容");
        verify_schema(&c, 11).unwrap();
    }
}
#[test]
fn fork_rejects_invalid_stale_busy_duplicate_and_mismatched_receipts_without_writes() {
    let (c, store) = setup();
    fork_source(&store, 6);
    let base = fork_request(&store, "source", "m-2", "branch");
    for (field, value, error) in [
        ("anchorMessageId", json!("missing"), TeaError::Missing),
        ("anchorMessageId", json!("m-1"), TeaError::Invalid),
        ("editedContent", json!(" \n "), TeaError::Invalid),
        ("expectedRevision", json!(99), TeaError::Stale),
        (
            "instance",
            json!("00000000000000000000000000000000"),
            TeaError::Stale,
        ),
        ("targetSessionId", json!("source"), TeaError::Invalid),
    ] {
        let before = snapshot(&c);
        let mut bad = base.clone();
        bad["request"][field] = value;
        assert_eq!(store.mutate(bad).unwrap_err(), error);
        assert_eq!(snapshot(&c), before);
    }
    store.mutate(base.clone()).unwrap();
    let before = snapshot(&c);
    let mut duplicate = base.clone();
    duplicate["request"]["operationId"] = json!("duplicate");
    assert_eq!(store.mutate(duplicate).unwrap_err(), TeaError::Stale);
    let mut mismatch = base;
    mismatch["request"]["editedContent"] = json!("changed");
    assert_eq!(
        store.mutate(mismatch.clone()).unwrap_err(),
        TeaError::OperationMismatch
    );
    assert_eq!(
        receipt(&store, mismatch).unwrap_err(),
        TeaError::OperationMismatch
    );
    assert_eq!(snapshot(&c), before);
    begin(&store, "source");
    let busy = fork_request(&store, "source", "m-2", "busy");
    let before = snapshot(&c);
    assert_eq!(store.mutate(busy).unwrap_err(), TeaError::Busy);
    assert_eq!(snapshot(&c), before);
}
#[test]
fn fork_failure_after_partial_insert_rolls_back_catalog_receipt_and_target() {
    let (c, store) = setup();
    fork_source(&store, 6);
    lock_connection(&c).unwrap().execute_batch("CREATE TRIGGER fail_fork BEFORE INSERT ON magic_tea_message WHEN NEW.session_id='branch' AND NEW.ordinal=2 BEGIN SELECT RAISE(ABORT,'fault'); END;").unwrap();
    let before = snapshot(&c);
    let wire = fork_request(&store, "source", "m-4", "branch");
    assert_eq!(store.mutate(wire.clone()).unwrap_err(), TeaError::Io);
    assert_eq!(snapshot(&c), before);
    assert!(receipt(&store, wire.clone()).unwrap()["result"]["receipt"].is_null());
    lock_connection(&c)
        .unwrap()
        .execute_batch("DROP TRIGGER fail_fork")
        .unwrap();
    store.mutate(wire).unwrap();
}
#[test]
fn fork_summary_coverage_remaps_or_clears_all_summary_fields() {
    for (to, selected, retained) in [
        ("m-1", "m-0", true),
        ("m-4", "m-0", false),
        ("m-1", "m-4", false),
        ("missing", "m-0", true),
        ("m-1", "missing", false),
    ] {
        let (c, store) = setup();
        fork_source(&store, 6);
        let h = head(&store, "source");
        let mut doc = h["session"].clone();
        doc["summary"] = json!("summary");
        doc["summarySections"] = json!({"plot":"plot"});
        doc["summaryMeta"] = json!({"fromMessageId":"m-0","toMessageId":to,"coverage":{"selectedMessageIds":[selected],"clippedMessageIds":["m-1"],"other":"preserve"}});
        let mut update = target_request("update", "source", &h);
        update["session"] = doc;
        store.mutate(request(update)).unwrap();
        store
            .mutate(fork_request(&store, "source", "m-2", "branch"))
            .unwrap();
        let branch = head(&store, "branch");
        let doc = &branch["session"];
        if retained {
            assert_eq!(doc["summary"], "summary");
            let c = lock_connection(&c).unwrap();
            let text: String = c.query_row("SELECT document FROM magic_tea_message WHERE session_id='branch' AND ordinal=1",[],|r|r.get(0)).unwrap();
            let first: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(doc["summaryMeta"]["fromMessageId"], first["id"]);
            assert_eq!(
                doc["summaryMeta"]["coverage"]["selectedMessageIds"][0],
                first["id"]
            );
            assert_eq!(doc["summaryMeta"]["coverage"]["other"], "preserve");
        } else {
            for key in ["summary", "summaryMeta", "summarySections"] {
                assert!(doc.get(key).is_none());
            }
        }
    }
}

#[test]
fn fork_shared_web_summary_golden_vectors() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-tea-branch-summary.json"
    ))
    .unwrap();
    let (c, store) = setup();
    create(&store, "source");
    let c = lock_connection(&c).unwrap();
    for (index, id) in fixture["messageIds"].as_array().unwrap().iter().enumerate() {
        insert_message(
            &c,
            "source",
            index as i64 + 1,
            &message("source", id.as_str().unwrap(), "user", "x"),
        )
        .unwrap();
    }
    let ids: HashMap<String, String> =
        serde_json::from_value(fixture["clonedMessageIds"].clone()).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let mut doc = case["session"].clone();
        fork_summary(
            &c,
            &mut doc,
            "source",
            case["replaceFromIndex"].as_i64().unwrap() + 1,
            &ids,
        )
        .unwrap();
        assert_eq!(doc, case["expected"], "{}", case["name"]);
    }
}
#[test]
fn fork_count_and_total_import_budget_reject_before_target_creation() {
    for huge in [false, true] {
        let (c, store) = setup();
        create(&store, "source");
        {
            let c = lock_connection(&c).unwrap();
            let count = if huge { 9 } else { 10_001 };
            let body = if huge {
                "x".repeat(8 * 1024 * 1024)
            } else {
                "x".to_owned()
            };
            c.execute_batch("BEGIN").unwrap();
            for i in 0..count {
                insert_message(
                    &c,
                    "source",
                    i + 1,
                    &message("source", &format!("m-{i}"), "user", &body),
                )
                .unwrap();
            }
            c.execute_batch("COMMIT").unwrap();
        }
        let wire = fork_request(
            &store,
            "source",
            if huge { "m-8" } else { "m-10000" },
            "branch",
        );
        let before = catalog(&lock_connection(&c).unwrap()).unwrap();
        assert_eq!(store.mutate(wire.clone()).unwrap_err(), TeaError::TooLarge);
        assert!(head(&store, "branch").is_null());
        assert_eq!(catalog(&lock_connection(&c).unwrap()).unwrap(), before);
        assert!(receipt(&store, wire).unwrap()["result"]["receipt"].is_null());
    }
}

#[test]
fn fork_commit_failure_is_reconcilable_and_aba_replacement_is_stale() {
    let (c, store) = setup();
    fork_source(&store, 4);
    let wire = fork_request(&store, "source", "m-2", "branch");
    lock_connection(&c).unwrap().execute_batch("CREATE TABLE fork_fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fork_fault_child(parent INTEGER REFERENCES fork_fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fork_fault_commit AFTER INSERT ON magic_tea_session WHEN NEW.id='branch' BEGIN INSERT INTO fork_fault_child(parent) VALUES(999); END;").unwrap();
    let before = snapshot(&c);
    assert_eq!(
        store.mutate(wire.clone()).unwrap_err(),
        TeaError::CommitUnknown
    );
    assert_eq!(snapshot(&c), before);
    assert!(receipt(&store, wire.clone()).unwrap()["result"]["receipt"].is_null());
    lock_connection(&c).unwrap().execute_batch("DROP TRIGGER fork_fault_commit; DROP TABLE fork_fault_child; DROP TABLE fork_fault_parent;").unwrap();
    let source = head(&store, "source");
    store
        .mutate(request(target_request("delete", "source", &source)))
        .unwrap();
    create(&store, "source");
    assert_eq!(head(&store, "source")["revision"], source["revision"]);
    let before = snapshot(&c);
    assert_eq!(store.mutate(wire).unwrap_err(), TeaError::Stale);
    assert_eq!(snapshot(&c), before);
}

#[test]
fn fork_uses_web_unicode_trim_and_player_identity() {
    assert_eq!(branch_trim("\u{feff} x \u{feff}"), "x");
    assert_eq!(branch_trim("\u{0085}"), "\u{0085}");
    let (_c, store) = setup();
    fork_source(&store, 4);
    let h = head(&store, "source");
    let mut doc = h["session"].clone();
    doc["roles"] =
        json!([{"id":"player","name":"\u{feff} 玩家 \u{feff}","card":{},"source":"local"}]);
    doc["playerRoleId"] = json!("player");
    let mut update = target_request("update", "source", &h);
    update["session"] = doc;
    store.mutate(request(update)).unwrap();
    let mut fork = fork_request(&store, "source", "m-0", "branch");
    fork["request"]["editedContent"] = json!("\u{feff} 改写 \u{feff}");
    store.mutate(fork).unwrap();
    let h = head(&store, "branch");
    let page = pages(&store, "branch", &h, Value::Null, 10).unwrap();
    let m = &page["result"]["rows"][0]["message"];
    assert_eq!(m["content"], "改写");
    assert_eq!(m["speakerId"], "player");
    assert_eq!(m["meta"]["speakerName"], "玩家");
}

#[path = "magic_tea_party_merge_tests.rs"]
mod merge_tests;
