use super::*;

fn merge_preview(store: &TeaStore) -> Value {
    let h = head(store, "branch");
    store.read(request(json!({"action":"merge-preview","source":{"sessionId":"branch","instance":h["instance"],"expectedRevision":h["revision"]}}))).unwrap()["result"].clone()
}
fn merge_request(store: &TeaStore) -> Value {
    let p = merge_preview(store);
    request(
        json!({"action":"merge","operationId":"merge-branch","source":p["source"],"parent":p["parent"],"anchorMessageId":p["anchorMessageId"],"editedMessageId":p["editedMessageId"]}),
    )
}
fn seed(store: &TeaStore, count: usize, anchor: usize) {
    fork_source(store, count);
    store
        .mutate(fork_request(
            store,
            "source",
            &format!("m-{anchor}"),
            "branch",
        ))
        .unwrap();
}
fn messages(c: &SharedConnection, sid: &str) -> Vec<Value> {
    let c = lock_connection(c).unwrap();
    let mut q = c
        .prepare("SELECT document FROM magic_tea_message WHERE session_id=?1 ORDER BY ordinal,id")
        .unwrap();
    q.query_map([sid], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|s| serde_json::from_str(&s.unwrap()).unwrap())
        .collect()
}
fn replace_message(c: &SharedConnection, message: &Value) {
    let text = validate_message(message, message["sessionId"].as_str().unwrap()).unwrap();
    lock_connection(c).unwrap().execute("UPDATE magic_tea_message SET document=?1,document_bytes=?2,document_digest=?3 WHERE id=?4",params![text,text.len(),digest(&text),message["id"].as_str().unwrap()]).unwrap();
}
fn replace_session(store: &TeaStore, sid: &str, edit: impl FnOnce(&mut Value)) {
    let h = head(store, sid);
    let mut doc = h["session"].clone();
    edit(&mut doc);
    let mut write = target_request("update", sid, &h);
    write["session"] = doc;
    store.mutate(request(write)).unwrap();
}
#[test]
fn merge_first_middle_last_cross_page_preserves_history_source_and_receipt() {
    for anchor in [0, 4, 106] {
        let (c, store) = setup();
        seed(&store, 108, anchor);
        let preview = merge_preview(&store);
        assert_eq!(preview["replacedMessageCount"], 108 - anchor);
        assert_eq!(preview["copiedMessageCount"], 1);
        let source = session_bytes(&c, "branch");
        let source_head = head(&store, "branch");
        let before = messages(&c, "source");
        let parent = head(&store, "source");
        let catalog_before = list(&store)["catalogRevision"].as_i64().unwrap();
        let wire = merge_request(&store);
        let result = store.mutate(wire.clone()).unwrap();
        assert_eq!(
            result["result"]["revision"],
            parent["revision"].as_i64().unwrap() + 1
        );
        assert_eq!(list(&store)["catalogRevision"], catalog_before + 1);
        assert_eq!(session_bytes(&c, "branch"), source);
        assert_eq!(head(&store, "branch"), source_head);
        let after = messages(&c, "source");
        assert_eq!(after.len(), 109);
        assert_eq!(after[..anchor], before[..anchor]);
        for (old, new) in before[anchor..].iter().zip(&after[anchor..108]) {
            assert_eq!(old["id"], new["id"]);
            assert_eq!(old["content"], new["content"]);
            assert_eq!(new["meta"]["superseded"], true);
            assert_eq!(new["meta"]["supersededBySessionId"], "branch");
        }
        assert_eq!(after[108]["revisionOf"], format!("m-{anchor}"));
        assert_ne!(after[108]["id"], preview["editedMessageId"]);
        assert_eq!(
            after[108]["createdAt"],
            messages(&c, "branch").last().unwrap()["createdAt"]
        );
        assert_eq!(head(&store, "source")["session"]["draft"], "未发送草稿");
        assert_eq!(
            head(&store, "source")["session"]["settings"]["autoSummaryEnabled"],
            true
        );
        assert!(head(&store, "source")["session"]
            .get("autoSummaryState")
            .is_none());
        let stable = snapshot(&c);
        assert_eq!(store.mutate(wire.clone()).unwrap(), result);
        assert_eq!(snapshot(&c), stable);
        let mut changed = wire.clone();
        changed["request"]["editedMessageId"] = json!("different");
        assert_eq!(store.mutate(changed), Err(TeaError::OperationMismatch));
        assert_eq!(
            receipt(&store, wire.clone()).unwrap()["result"]["receipt"]["result"],
            result["result"]
        );
        for sid in ["source", "branch"] {
            let h = head(&store, sid);
            store
                .mutate(request(target_request("delete", sid, &h)))
                .unwrap();
            assert_eq!(
                receipt(&store, wire.clone()).unwrap()["result"]["receipt"]["result"],
                result["result"]
            );
            assert_eq!(store.mutate(wire.clone()).unwrap(), result);
            assert!(head(&store, sid).is_null());
            verify_schema(&lock_connection(&c).unwrap(), 12).unwrap();
        }
    }
}
#[test]
fn merge_references_ordinal_and_superseded_attribution_are_precise() {
    let (c, store) = setup();
    seed(&store, 6, 2);
    let edited = messages(&c, "branch").last().unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut old = messages(&c, "source")[3].clone();
    old["meta"] = json!({"superseded":true,"supersededBy":"other","supersededBySessionId":"earlier","supersededAt":17});
    replace_message(&c, &old);
    let mut child = message("branch", "tail-1", "assistant", "child tail");
    child["createdAt"] = json!(0);
    child["sourceMessageId"] = json!(edited);
    child["revisionOf"] = json!("m-0");
    child["opaque"] = json!({"id":"tail-1"});
    let mut child2 = message("branch", "tail-2", "assistant", "old child");
    child2["sourceMessageId"] = json!("external");
    child2["revisionOf"] = json!(messages(&c, "branch")[0]["id"]);
    child2["meta"] = json!({"superseded":true,"supersededBySessionId":"earlier-child"});
    {
        let c = lock_connection(&c).unwrap();
        insert_message(&c, "branch", 4, &child).unwrap();
        insert_message(&c, "branch", 5, &child2).unwrap();
    }
    replace_session(&store, "source", |d| {
        d["lastChoices"] = json!([{ "id": "old", "text": "old" }]);
        d["opaque"] = json!({"retain":true});
    });
    let before = session_bytes(&c, "branch");
    store.mutate(merge_request(&store)).unwrap();
    assert_eq!(session_bytes(&c, "branch"), before);
    let after = messages(&c, "source");
    assert_eq!(after[3], old);
    assert_eq!(after[7]["sourceMessageId"], after[6]["id"]);
    assert_eq!(after[7]["revisionOf"], "m-0");
    assert_eq!(after[7]["createdAt"], 0);
    assert_eq!(after[7]["opaque"], child["opaque"]);
    assert!(after[8].get("sourceMessageId").is_none());
    assert!(after[8].get("revisionOf").is_none());
    assert_eq!(after[8]["meta"], child2["meta"]);
    assert!(head(&store, "source")["session"]
        .get("lastChoices")
        .is_none());
    assert_eq!(
        head(&store, "source")["session"]["opaque"],
        json!({"retain":true})
    );
}
#[test]
fn merge_revalidates_both_targets_relationship_and_exact_unique_active_user_anchors() {
    for scenario in [
        "parent-stale",
        "source-stale",
        "parent-aba",
        "source-aba",
        "parent-busy",
        "source-busy",
        "wrong-parent",
        "wrong-anchor",
        "missing-relation",
        "missing-parent-anchor",
        "non-user-parent",
        "missing-edited",
        "ambiguous-edited",
        "non-user-edited",
        "superseded-parent",
        "superseded-edited",
        "wrong-edited",
    ] {
        let (c, store) = setup();
        seed(&store, 6, 2);
        let mut wire = merge_request(&store);
        match scenario {
            "parent-stale" => {
                replace_session(&store, "source", |d| d["title"] = json!("changed"));
            }
            "source-stale" => {
                replace_session(&store, "branch", |d| d["title"] = json!("changed"));
            }
            "parent-aba" | "source-aba" => {
                let sid = if scenario == "parent-aba" {
                    "source"
                } else {
                    "branch"
                };
                let h = head(&store, sid);
                store
                    .mutate(request(target_request("delete", sid, &h)))
                    .unwrap();
                create(&store, sid);
            }
            "parent-busy" | "source-busy" => {
                let sid = if scenario == "parent-busy" {
                    "source"
                } else {
                    "branch"
                };
                begin(&store, sid);
                wire["request"][if sid == "source" { "parent" } else { "source" }]
                    ["expectedRevision"] = head(&store, sid)["revision"].clone();
            }
            "wrong-parent" | "wrong-anchor" | "missing-relation" => {
                replace_session(&store, "branch", |d| {
                    if scenario == "wrong-parent" {
                        d["forkedFrom"]["sessionId"] = json!("other");
                    } else if scenario == "wrong-anchor" {
                        d["forkedFrom"]["messageId"] = json!("m-0");
                    } else {
                        d.as_object_mut().unwrap().remove("forkedFrom");
                    }
                });
                wire["request"]["source"]["expectedRevision"] =
                    head(&store, "branch")["revision"].clone();
            }
            "missing-parent-anchor" => {
                lock_connection(&c)
                    .unwrap()
                    .execute("DELETE FROM magic_tea_message WHERE id='m-2'", [])
                    .unwrap();
            }
            "missing-edited" => {
                lock_connection(&c)
                    .unwrap()
                    .execute(
                        "DELETE FROM magic_tea_message WHERE id=?1",
                        [wire["request"]["editedMessageId"].as_str().unwrap()],
                    )
                    .unwrap();
            }
            "wrong-edited" => {
                wire["request"]["editedMessageId"] = json!("m-0");
            }
            "ambiguous-edited" => {
                let mut m = message("branch", "duplicate-edit", "user", "duplicate");
                m["revisionOf"] = json!("m-2");
                insert_message(&lock_connection(&c).unwrap(), "branch", 4, &m).unwrap();
            }
            _ => {
                let parent = scenario.ends_with("parent");
                let mut m = if parent {
                    messages(&c, "source")[2].clone()
                } else {
                    messages(&c, "branch").last().unwrap().clone()
                };
                if scenario.starts_with("non-user") {
                    m["role"] = json!("assistant");
                } else {
                    m["meta"] = json!({"superseded":true});
                }
                replace_message(&c, &m);
            }
        }
        let before = snapshot(&c);
        assert!(store.mutate(wire).is_err(), "{scenario}");
        assert_eq!(snapshot(&c), before, "{scenario}");
    }
}
#[test]
fn merge_every_write_failure_rolls_back_and_commit_unknown_recovers_original_receipt() {
    for trigger in [
        "CREATE TRIGGER fail BEFORE UPDATE ON magic_tea_message WHEN NEW.id='m-3' BEGIN SELECT RAISE(ABORT,'fault'); END;",
        "CREATE TRIGGER fail BEFORE INSERT ON magic_tea_message WHEN NEW.session_id='source' BEGIN SELECT RAISE(ABORT,'fault'); END;",
        "CREATE TRIGGER fail BEFORE UPDATE ON magic_tea_session BEGIN SELECT RAISE(ABORT,'fault'); END;",
        "CREATE TRIGGER fail BEFORE UPDATE ON magic_tea_catalog BEGIN SELECT RAISE(ABORT,'fault'); END;",
        "CREATE TRIGGER fail BEFORE INSERT ON magic_tea_receipt BEGIN SELECT RAISE(ABORT,'fault'); END;",
        "CREATE TABLE fault_parent(id INTEGER PRIMARY KEY);CREATE TABLE fault_child(parent INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER fail AFTER UPDATE ON magic_tea_session BEGIN INSERT INTO fault_child(parent) VALUES(999); END;",
    ] {
        let(c,store)=setup();seed(&store,6,2);let wire=merge_request(&store);let before=snapshot(&c);
        lock_connection(&c).unwrap().execute_batch(trigger).unwrap();let error=store.mutate(wire.clone()).unwrap_err();
        assert_eq!(error,if trigger.contains("DEFERRABLE"){TeaError::CommitUnknown}else{TeaError::Io});assert_eq!(snapshot(&c),before);
        assert!(receipt(&store,wire.clone()).unwrap()["result"]["receipt"].is_null());
        lock_connection(&c).unwrap().execute_batch("DROP TRIGGER fail").unwrap();assert!(store.mutate(wire).is_ok());
    }
}
#[test]
fn merge_summary_uses_retained_prefix_not_sparse_coverage_as_watermark() {
    for (to, selected, clipped, clear) in [
        ("m-0", "m-0", "m-1", false),
        ("m-2", "m-0", "m-1", true),
        ("m-4", "m-0", "m-1", true),
        ("unknown", "m-0", "m-1", false),
        ("m-0", "m-2", "m-1", true),
        ("m-0", "m-0", "missing", true),
    ] {
        let (_, store) = setup();
        seed(&store, 6, 2);
        replace_session(&store, "source", |d| {
            d["summary"] = json!("summary");
            d["summarySections"] = json!({"recap":"recap"});
            d["summaryMeta"] = json!({"updatedAt":1,"toMessageId":to,"coverage":{"version":1,"sourceMessageCount":4,"selectedMessageIds":[selected],"clippedMessageIds":[clipped],"omittedMessageCount":3}});
        });
        store.mutate(merge_request(&store)).unwrap();
        let doc = head(&store, "source")["session"].clone();
        assert_eq!(
            doc.get("summary").is_none(),
            clear,
            "{to}/{selected}/{clipped}"
        );
        if clear {
            assert!(doc.get("summaryMeta").is_none());
            assert!(doc.get("summarySections").is_none());
        } else {
            assert_eq!(
                doc["summaryMeta"]["coverage"]["selectedMessageIds"][0],
                selected
            );
        }
    }
    let (_, store) = setup();
    seed(&store, 6, 2);
    replace_session(&store, "source", |d| {
        d["summary"] = json!("legacy");
        d["summaryMeta"] = json!({"updatedAt":1,"toMessageId":"unknown"});
    });
    store.mutate(merge_request(&store)).unwrap();
    assert_eq!(head(&store, "source")["session"]["summary"], "legacy");
}
#[test]
fn merge_wire_is_closed_and_same_parent_is_invalid() {
    let (_, store) = setup();
    seed(&store, 4, 2);
    let wire = merge_request(&store);
    let mut same = wire.clone();
    same["request"]["parent"] = same["request"]["source"].clone();
    assert_eq!(store.mutate(same), Err(TeaError::Invalid));
    let mut extra = wire.clone();
    extra["request"]["messages"] = json!([]);
    assert_eq!(store.mutate(extra), Err(TeaError::Invalid));
    let mut extra = wire;
    extra["request"]["source"]["extra"] = json!(true);
    assert_eq!(store.mutate(extra), Err(TeaError::Invalid));
}
#[test]
fn merge_rejects_count_total_bytes_and_marker_growth_without_writes() {
    let (c, store) = setup();
    seed(&store, 10_000, 0);
    let h = head(&store, "branch");
    let before = snapshot(&c);
    assert_eq!(store.read(request(json!({"action":"merge-preview","source":{"sessionId":"branch","instance":h["instance"],"expectedRevision":h["revision"]}}))),Err(TeaError::TooLarge));
    assert_eq!(snapshot(&c), before);
    drop(store);
    drop(c);
    for total in [false, true] {
        let (c, store) = setup();
        seed(&store, 2, 0);
        let wire = merge_request(&store);
        if total {
            for (sid, index) in [("source", 0), ("source", 1), ("branch", 0)] {
                let mut m = messages(&c, sid)[index].clone();
                m["content"] = json!("x".repeat(22 * 1024 * 1024));
                replace_message(&c, &m);
            }
        } else {
            let mut m = messages(&c, "source")[0].clone();
            m["content"] = json!("");
            let overhead = encoded(&m).unwrap().len();
            m["content"] = json!("x".repeat(MESSAGE_BYTES - overhead));
            replace_message(&c, &m);
        }
        // Hash snapshots avoid duplicating hundreds of MiB just for a rejection assertion.
        let before = digest(&snapshot(&c));
        assert_eq!(store.mutate(wire), Err(TeaError::TooLarge));
        assert_eq!(digest(&snapshot(&c)), before);
    }
}
#[test]
fn merge_shared_domain_summary_golden_vectors() {
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
    for case in fixture["cases"].as_array().unwrap() {
        let mut doc = case["session"].clone();
        branch_summary(
            &c,
            &mut doc,
            "source",
            case["replaceFromIndex"].as_i64().unwrap() + 1,
            None,
        )
        .unwrap();
        assert_eq!(doc, case["expectedMerge"], "{}", case["name"]);
    }
}
#[test]
fn nested_merge_rejects_replaced_middle_anchor_without_following_revision_chain() {
    let (c, store) = setup();
    seed(&store, 6, 2);
    let mut child_merge = merge_request(&store);
    let child_edited = child_merge["request"]["editedMessageId"]
        .as_str()
        .unwrap()
        .to_owned();
    store
        .mutate(fork_request(&store, "branch", &child_edited, "grandchild"))
        .unwrap();
    let h = head(&store, "grandchild");
    let p=store.read(request(json!({"action":"merge-preview","source":{"sessionId":"grandchild","instance":h["instance"],"expectedRevision":h["revision"]}}))).unwrap()["result"].clone();
    store.mutate(request(json!({"action":"merge","operationId":"merge-grandchild","source":p["source"],"parent":p["parent"],"anchorMessageId":p["anchorMessageId"],"editedMessageId":p["editedMessageId"]}))).unwrap();
    // Even a fresh CAS cannot authorize guessing that the new grandchild text is
    // a replacement for the original parent's anchor: the direct edit is obsolete.
    child_merge["request"]["source"]["expectedRevision"] =
        head(&store, "branch")["revision"].clone();
    let before = snapshot(&c);
    assert_eq!(store.mutate(child_merge), Err(TeaError::Stale));
    let h = head(&store, "branch");
    assert_eq!(store.read(request(json!({"action":"merge-preview","source":{"sessionId":"branch","instance":h["instance"],"expectedRevision":h["revision"]}}))),Err(TeaError::Stale));
    assert_eq!(snapshot(&c), before);
}
#[test]
fn merge_nonce_failure_occurs_before_any_parent_change() {
    let (c, store) = setup();
    seed(&store, 4, 0);
    let wire = merge_request(&store);
    let before = snapshot(&c);
    FAIL_NEXT_NONCE.with(|fail| fail.set(true));
    assert_eq!(store.mutate(wire.clone()), Err(TeaError::Io));
    assert_eq!(snapshot(&c), before);
    assert!(receipt(&store, wire.clone()).unwrap()["result"]["receipt"].is_null());
    store.mutate(wire).unwrap();
}
#[test]
fn merge_aggregate_marker_growth_exceeding_write_budget_is_atomic() {
    let (c, store) = setup();
    seed(&store, 2, 0);
    let wire = merge_request(&store);
    let mut parent_doc = head(&store, "source")["session"].clone();
    parent_doc
        .as_object_mut()
        .unwrap()
        .remove("autoSummaryState");
    // Match the current 13-digit persisted timestamp width without depending on a
    // particular instant. Both source and destination ids have identical lengths.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    parent_doc["updatedAt"] = json!(now);
    let mut parents = messages(&c, "source");
    for m in &mut parents {
        m["content"] = json!("");
    }
    let mut copied = messages(&c, "branch");
    copied[0]["sessionId"] = json!("source");
    let overhead = encoded(&json!({"session":parent_doc,"replaced":parents,"copied":copied}))
        .unwrap()
        .len();
    let padding = WRITE_BYTES - 64 - overhead;
    parents[0]["content"] = json!("x".repeat(padding / 2));
    parents[1]["content"] = json!("y".repeat(padding - padding / 2));
    for m in &parents {
        assert!(encoded(m).unwrap().len() < MESSAGE_BYTES);
        replace_message(&c, m);
    }
    // Original payload plus the exact envelope fits. Only merge's marker growth
    // (not a pre-existing oversized record or source-byte sum) pushes it over.
    assert_eq!(
        encoded(&json!({"session":parent_doc,"replaced":parents,"copied":copied}))
            .unwrap()
            .len(),
        WRITE_BYTES - 64
    );
    let total: i64 = lock_connection(&c)
        .unwrap()
        .query_row(
            "SELECT SUM(document_bytes) FROM magic_tea_message",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(total < WRITE_BYTES as i64);
    drop(parents);
    drop(copied);
    let before = digest(&snapshot(&c));
    assert_eq!(store.mutate(wire.clone()), Err(TeaError::TooLarge));
    assert_eq!(digest(&snapshot(&c)), before);
    assert!(receipt(&store, wire).unwrap()["result"]["receipt"].is_null());
}
