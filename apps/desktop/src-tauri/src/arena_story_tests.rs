use super::read::*;
use super::*;
use crate::library::LocalLibrary;
use serde_json::{json, Value};

fn library() -> (tempfile::TempDir, LocalLibrary) {
    let root = tempfile::tempdir().unwrap();
    let library = LocalLibrary::open(root.path()).unwrap();
    (root, library)
}
pub(super) fn fixture(session: &str, index: u64) -> Vec<(PartKind, String)> {
    let chapter = format!("{session}-chapter-{index}");
    let checkpoint = format!("{session}-checkpoint-{index}");
    let previous = format!("{session}-chapter-{}", index - 1);
    let input = format!("{session}-checkpoint-{}", index - 1);
    let mut result = vec![(PartKind::Session,json!({
        "id":session,"revision":index,"title":"完整故事𠮷","titlePreview":"完整故事𠮷","titleTruncated":false,
        "mode":"classic","createdAt":90,"updatedAt":99+index,"source":{"mode":"classic","providerMode":"direct","providerId":"non-secret","modelId":"test"},
        "chapterCount":index,"lastChapterId":chapter,"workingCheckpointId":checkpoint,"lastInputCheckpointId":input,
        "sessionSummary":"未截断的完整摘要","summaryMeta":{"coveredUntilChapterIndex":index,"coveredChapterIds":[chapter],"mode":"deterministic-fallback","refreshedAt":99+index},
        "extension":{"unknown":{"keep":true}}
    }).to_string())];
    let combatants = json!([{"data":{"name":"角色","extension":{"array":[null,true,"🙂"],"signature":"nested-user-field"},"arena_history":{"attributes":{"world_line_id":"w"},"entries":[{"id":1,"metadata":{"user_guidance":"保留"}}]}}}]);
    if index == 1 {
        result.push((
            PartKind::Seed,
            json!({"combatants":combatants,"settings":{"writeArenaHistory":true}}).to_string(),
        ));
    }
    result.push((PartKind::Chapter,json!({"id":chapter,"sessionId":session,"index":index,"action":if index==1 {"start"} else {"continue"},"status":"active","sourceChapterId":if index==1 {Value::Null} else {json!(previous)},"title":"标题","titlePreview":"标题","titleTruncated":false,"markdown":"正文🙂\u{0000}","markdownByteLength":11,"reportJson":{"raw":"保留"},"deterministicDigest":{"chapterTitle":"标题"},"cardSnapshot":{"unknown":"完整"},"createdAt":99+index}).to_string()));
    if index == 1 {
        result.push((PartKind::Checkpoint0,json!({"id":input,"sessionId":session,"boundaryIndex":0,"combatants":combatants,"createdAt":100}).to_string()));
    }
    result.push((PartKind::Checkpoint1,json!({"id":checkpoint,"sessionId":session,"boundaryIndex":index,"chapterId":chapter,"combatants":combatants,"createdAt":99+index}).to_string()));
    result
}
pub(super) fn manifest(session: &str, index: u64, parts: &[(PartKind, String)]) -> CommitManifest {
    CommitManifest {
        version: 1,
        operation_id: format!("{session}-chapter-{index}"),
        session_id: session.to_string(),
        expected_revision: index - 1,
        expected_last_chapter_id: if index == 1 {
            None
        } else {
            Some(format!("{session}-chapter-{}", index - 1))
        },
        parts: parts
            .iter()
            .map(|(kind, document)| PartDeclaration {
                kind: *kind,
                byte_length: document.len() as u64,
                digest: digest(document.as_bytes()),
            })
            .collect(),
    }
}
fn upload(store: &StoryStore, session: &str, index: u64, parts: &[(PartKind, String)]) -> String {
    let now = Instant::now();
    let token = store
        .begin(manifest(session, index, parts), now)
        .unwrap()
        .token;
    for (kind, document) in parts {
        for (chunk, bytes) in document.as_bytes().chunks(17).enumerate() {
            let outcome = store
                .append(&token, *kind, (chunk * 17) as u64, bytes, now)
                .unwrap();
            assert_eq!(outcome.received_bytes, (chunk * 17 + bytes.len()) as u64);
        }
    }
    token
}
fn commit(store: &StoryStore, session: &str, index: u64) -> StoryReceipt {
    let parts = fixture(session, index);
    let token = upload(store, session, index, &parts);
    store.end(&token, Instant::now()).unwrap()
}
fn raw(store: &StoryStore, descriptor: &RecordDescriptor) -> Vec<u8> {
    let mut bytes = Vec::new();
    while (bytes.len() as u64) < descriptor.byte_length {
        bytes.extend(
            store
                .read_record_chunk(descriptor, bytes.len() as u64, 13)
                .unwrap(),
        );
    }
    assert_eq!(digest(&bytes), descriptor.digest);
    bytes
}
#[test]
fn first_append_exact_bytes_reopen_and_receipt() {
    let (root, library) = library();
    let receipt = commit(library.stories(), "story", 1);
    for (kind, document) in fixture("story", 1) {
        let (read_kind, id) = match kind {
            PartKind::Session => (RecordKind::Session, "story"),
            PartKind::Seed => (RecordKind::Seed, "story"),
            PartKind::Chapter => (RecordKind::Chapter, "story-chapter-1"),
            PartKind::Checkpoint0 => (RecordKind::Checkpoint, "story-checkpoint-0"),
            PartKind::Checkpoint1 => (RecordKind::Checkpoint, "story-checkpoint-1"),
        };
        let descriptor = library
            .stories()
            .describe_record("story", 1, read_kind, id)
            .unwrap();
        assert_eq!(raw(library.stories(), &descriptor), document.as_bytes());
    }
    let old = library
        .stories()
        .describe_record("story", 1, RecordKind::Chapter, "story-chapter-1")
        .unwrap();
    drop(library);
    let reopened = LocalLibrary::open(root.path()).unwrap();
    assert_eq!(
        reopened
            .stories()
            .receipt("story", "story-chapter-1")
            .unwrap(),
        Some(receipt)
    );
    assert_eq!(
        reopened.stories().read_record_chunk(&old, 0, 13),
        Err(StoryError::Stale)
    );
    let second = commit(reopened.stories(), "story", 2);
    assert_eq!(second.revision, 2);
    audit_relations(&lock_connection(reopened.connection()).unwrap()).unwrap();
}
#[test]
fn replay_precedes_cas_and_changed_operation_is_rejected() {
    let (_root, library) = library();
    let store = library.stories();
    let receipt = commit(store, "story", 1);
    commit(store, "story", 2);
    let token = upload(store, "story", 1, &fixture("story", 1));
    assert_eq!(store.end(&token, Instant::now()).unwrap(), receipt);
    let mut changed = fixture("story", 1);
    changed[2].1 = changed[2].1.replace("保留", "变更");
    let token = upload(store, "story", 1, &changed);
    assert_eq!(
        store.end(&token, Instant::now()),
        Err(StoryError::OperationMismatch)
    );
    assert_eq!(
        store
            .list_chapters("story", 2, None, None)
            .unwrap()
            .rows
            .len(),
        2
    );
}
#[test]
fn concurrent_append_conflicts_and_stale_read_never_returns_another_identity() {
    let (_root, library) = library();
    let store = library.stories();
    commit(store, "story", 1);
    let old = store
        .describe_record("story", 1, RecordKind::Chapter, "story-chapter-1")
        .unwrap();
    let first = upload(store, "story", 2, &fixture("story", 2));
    let mut alternative = fixture("story", 2);
    for (_, document) in &mut alternative {
        *document = document
            .replace("story-chapter-2", "other-chapter-2")
            .replace("story-checkpoint-2", "other-checkpoint-2");
    }
    let mut m = manifest("story", 2, &alternative);
    m.operation_id = "other-chapter-2".to_string();
    let second = store.begin(m, Instant::now()).unwrap().token;
    for (kind, document) in alternative {
        store
            .append(&second, kind, 0, document.as_bytes(), Instant::now())
            .unwrap();
    }
    store.end(&first, Instant::now()).unwrap();
    assert_eq!(
        store.end(&second, Instant::now()),
        Err(StoryError::Conflict)
    );
    assert_eq!(store.read_record_chunk(&old, 0, 13), Err(StoryError::Stale));
    let mut fake = store
        .describe_record("story", 2, RecordKind::Chapter, "story-chapter-1")
        .unwrap();
    fake.record_id = "story-chapter-2".to_string();
    assert_eq!(
        store.read_record_chunk(&fake, 0, 13),
        Err(StoryError::Stale)
    );
}
#[test]
fn every_transaction_step_rolls_back_first_and_append() {
    for index in [1, 2] {
        for failure in [
            "validated",
            "cas",
            "session",
            "seed",
            "chapter",
            "checkpoint0",
            "checkpoint1",
            "before-commit",
        ] {
            if index == 2 && ["seed", "checkpoint0"].contains(&failure) {
                continue;
            }
            let (_root, library) = library();
            let store = library.stories();
            if index == 2 {
                commit(store, "story", 1);
            }
            let token = upload(store, "story", index, &fixture("story", index));
            assert_eq!(
                store.end_with_hook(&token, Instant::now(), &mut |step| if step == failure {
                    Err(StoryError::Io)
                } else {
                    Ok(())
                }),
                Err(StoryError::Io),
                "{index}:{failure}"
            );
            assert!(store
                .receipt("story", &format!("story-chapter-{index}"))
                .unwrap()
                .is_none());
            let connection = lock_connection(library.connection()).unwrap();
            for table in [
                "arena_story_session",
                "arena_story_chapter",
                "arena_story_checkpoint",
            ] {
                let count: u64 = connection
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(
                    count,
                    if index == 1 {
                        0
                    } else if table == "arena_story_checkpoint" {
                        2
                    } else {
                        1
                    },
                    "{index}:{failure}:{table}"
                );
            }
            drop(connection);
            // Same fixed package retries the local save; nothing creates a new generation.
            assert_eq!(
                store.end(&token, Instant::now()).unwrap().chapter_index,
                index
            );
        }
    }
}
#[test]
fn maintenance_rejects_end_but_does_not_lock_upload_or_lose_stage() {
    let (_root, library) = library();
    let store = library.stories();
    let permit = library.enter_maintenance("test").unwrap();
    let token = upload(store, "story", 1, &fixture("story", 1));
    assert_eq!(
        store.end(&token, Instant::now()),
        Err(StoryError::Maintenance)
    );
    assert!(store.list_sessions(None, None).unwrap().rows.is_empty());
    drop(permit);
    assert_eq!(store.end(&token, Instant::now()).unwrap().revision, 1);
}
#[test]
fn declarations_frames_offsets_order_expiry_and_total_reserved_are_bounded() {
    let (_root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let parts = fixture("story", 1);
    let mut m = manifest("story", 1, &parts);
    m.parts[0].byte_length = CANDIDATE_COMMIT_BYTES;
    assert_eq!(
        store.begin(m.clone(), now).unwrap_err(),
        StoryError::TooLarge
    );
    m.parts[0].byte_length =
        CANDIDATE_COMMIT_BYTES - m.parts[1..].iter().map(|p| p.byte_length).sum::<u64>();
    let max = store.begin(m, now).unwrap();
    assert_eq!(
        store.begin(manifest("story", 1, &parts), now).unwrap_err(),
        StoryError::Busy
    );
    store.abort(&max.token).unwrap();
    let token = store
        .begin(manifest("story", 1, &parts), now)
        .unwrap()
        .token;
    assert_eq!(store.end(&token, now), Err(StoryError::Incomplete));
    assert_eq!(
        store.append(&token, PartKind::Chapter, 0, b"x", now),
        Err(StoryError::Invalid)
    );
    assert_eq!(
        store.append(&token, PartKind::Session, 1, b"x", now),
        Err(StoryError::Invalid)
    );
    assert_eq!(
        store.append(
            &token,
            PartKind::Session,
            0,
            &vec![0; CANDIDATE_FRAME_BYTES + 1],
            now
        ),
        Err(StoryError::TooLarge)
    );
    assert_eq!(
        store.append(&token, PartKind::Session, 0, b"x", now + STAGE_LIFETIME),
        Err(StoryError::Stale)
    );
    assert!(store.stages.lock().unwrap().is_empty());
}
#[test]
fn partial_file_write_failure_discards_only_that_token() {
    let (_root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let token = store
        .begin(manifest("story", 1, &fixture("story", 1)), now)
        .unwrap()
        .token;
    {
        let mut stages = store.stages.lock().unwrap();
        let part = &mut stages.get_mut(&token).unwrap().parts[0];
        let read_only = fs::OpenOptions::new()
            .read(true)
            .open(part.file.path())
            .unwrap();
        *part.file.as_file_mut() = read_only;
    }
    assert_eq!(
        store.append(&token, PartKind::Session, 0, b"x", now),
        Err(StoryError::Io)
    );
    assert_eq!(
        store.append(&token, PartKind::Session, 0, b"x", now),
        Err(StoryError::Stale)
    );
    assert!(store.list_sessions(None, None).unwrap().rows.is_empty());
}
#[test]
fn invalid_json_relations_digest_and_embedded_snapshots_never_write() {
    for case in [
        "json",
        "relationship",
        "digest",
        "embedded",
        "checkpoint",
        "missing-markdown",
    ] {
        let (_root, library) = library();
        let store = library.stories();
        let mut parts = fixture("story", 1);
        match case {
            "json" => parts[2].1 = "{broken".to_string(),
            "relationship" => {
                parts[0].1 = parts[0].1.replace("story-checkpoint-1", "other-checkpoint")
            }
            "embedded" => {
                let mut value: Value = serde_json::from_str(&parts[0].1).unwrap();
                value["workingCombatants"] = json!([]);
                parts[0].1 = value.to_string();
            }
            "checkpoint" => {
                let mut value: Value = serde_json::from_str(&parts[4].1).unwrap();
                value["combatants"] = json!({});
                parts[4].1 = value.to_string();
            }
            "missing-markdown" => {
                let mut value: Value = serde_json::from_str(&parts[2].1).unwrap();
                value.as_object_mut().unwrap().remove("markdown");
                parts[2].1 = value.to_string();
            }
            _ => {}
        }
        let token = upload(store, "story", 1, &parts);
        if case == "digest" {
            store.stages.lock().unwrap().get_mut(&token).unwrap().parts[0]
                .declaration
                .digest = digest(b"other");
        }
        assert!(store.end(&token, Instant::now()).is_err(), "{case}");
        assert!(store.list_sessions(None, None).unwrap().rows.is_empty());
    }
}
#[test]
fn pagination_reads_all_chapters_without_loading_checkpoints_and_recent_window_is_twelve() {
    let (_root, library) = library();
    let store = library.stories();
    for index in 1..=63 {
        commit(store, "story", index);
    }
    let mut ids = Vec::new();
    let mut cursor = None;
    loop {
        let page = store.list_chapters("story", 63, cursor, Some(25)).unwrap();
        ids.extend(page.rows.into_iter().map(|r| r.id));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids.len(), 63);
    assert_eq!(ids[62], "story-chapter-63");
    let resume = store
        .continue_descriptors("story", 63, "story-chapter-63")
        .unwrap();
    assert_eq!(resume.recent_chapters.len(), 12);
    assert_eq!(resume.recent_chapters[0].record_id, "story-chapter-52");
    assert_eq!(resume.checkpoint.record_id, "story-checkpoint-63");
    assert_eq!(
        store.list_chapters("story", 62, None, None).unwrap_err(),
        StoryError::Stale
    );
    assert_eq!(
        store.list_sessions(None, Some(51)).unwrap_err(),
        StoryError::Invalid
    );
    audit_relations(&lock_connection(library.connection()).unwrap()).unwrap();
}
#[test]
fn session_keyset_and_title_preview_page_do_not_return_full_records() {
    let (_root, library) = library();
    let store = library.stories();
    for i in 0..53 {
        commit(store, &format!("s-{i:03}"), 1);
    }
    let first = store.list_sessions(None, Some(50)).unwrap();
    assert_eq!(first.rows.len(), 50);
    let encoded = serde_json::to_string(&first).unwrap();
    assert!(
        !encoded.contains("seed")
            && !encoded.contains("combatants")
            && !encoded.contains("sessionSummary")
    );
    let next = store.list_sessions(first.next_cursor, Some(50)).unwrap();
    assert_eq!(next.rows.len(), 3);
    assert!(next.next_cursor.is_none());
}
#[test]
fn sqlite_full_rolls_back_and_retains_exact_retryable_stage() {
    let (_root, library) = library();
    let store = library.stories();
    commit(store, "story", 1);
    let mut parts = fixture("story", 2);
    let mut value: Value = serde_json::from_str(&parts[1].1).unwrap();
    value["extension"] = json!("x".repeat(512 * 1024));
    parts[1].1 = value.to_string();
    let token = upload(store, "story", 2, &parts);
    {
        let c = lock_connection(library.connection()).unwrap();
        let pages: u64 = c.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
        c.execute_batch(&format!("PRAGMA max_page_count={pages}"))
            .unwrap();
    }
    assert_eq!(store.end(&token, Instant::now()), Err(StoryError::Io));
    assert_eq!(
        store
            .list_chapters("story", 1, None, None)
            .unwrap()
            .rows
            .len(),
        1
    );
    assert!(store.receipt("story", "story-chapter-2").unwrap().is_none());
    lock_connection(library.connection())
        .unwrap()
        .execute_batch("PRAGMA max_page_count=1000000")
        .unwrap();
    assert_eq!(store.end(&token, Instant::now()).unwrap().revision, 2);
}
#[test]
fn old_v4_migration_failure_rolls_back_ddl_and_legacy_data() {
    let c = Connection::open_in_memory().unwrap();
    crate::store::migrate_to_version_for_test(&c, 4);
    c.execute(
        "INSERT INTO provider_profile VALUES ('legacy','{}','2026-10-10')",
        [],
    )
    .unwrap();
    c.execute_batch("CREATE TABLE arena_story_chapter (blocker TEXT)")
        .unwrap();
    assert!(crate::store::migrate(&c).is_err());
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, u64>(0))
            .unwrap(),
        4
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='arena_story_session'",
            [],
            |r| r.get::<_, u64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        c.query_row(
            "SELECT document FROM provider_profile WHERE id='legacy'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "{}"
    );
}
#[test]
fn backup_restore_contains_stories_but_never_uncommitted_staging() {
    let (root, library) = library();
    commit(library.stories(), "story", 1);
    let token = upload(library.stories(), "story", 2, &fixture("story", 2));
    let backup = crate::backup::create_backup(&library).unwrap();
    library.stories().end(&token, Instant::now()).unwrap();
    let prepared = crate::restore::prepare_restore(&library, &backup.backup_id).unwrap();
    assert!(
        library
            .stories()
            .begin(manifest("other", 1, &fixture("other", 1)), Instant::now())
            .unwrap()
            .total_bytes
            > 0
    );
    let token = upload(library.stories(), "third", 1, &fixture("third", 1));
    assert_eq!(
        library.stories().end(&token, Instant::now()),
        Err(StoryError::Maintenance)
    );
    drop(prepared);
    drop(library);
    crate::restore::recover_pending(root.path()).unwrap();
    let restored = LocalLibrary::open(root.path()).unwrap();
    assert_eq!(
        restored
            .stories()
            .list_chapters("story", 1, None, None)
            .unwrap()
            .rows
            .len(),
        1
    );
    assert!(restored
        .stories()
        .receipt("story", "story-chapter-2")
        .unwrap()
        .is_none());
    assert_eq!(
        restored.stories().end(&token, Instant::now()),
        Err(StoryError::Stale)
    );
    assert!(fs::read_dir(root.path().join(STAGING_DIRECTORY))
        .unwrap()
        .next()
        .is_none());
}
#[test]
fn relational_audit_rejects_head_count_and_checkpoint_corruption() {
    for sql in [
        "UPDATE arena_story_session SET chapter_count=2",
        "UPDATE arena_story_checkpoint SET boundary_index=3 WHERE boundary_index=1",
        "UPDATE arena_story_chapter SET action='continue'",
    ] {
        let (_root, library) = library();
        commit(library.stories(), "story", 1);
        let c = lock_connection(library.connection()).unwrap();
        c.execute_batch(sql).unwrap();
        assert_eq!(audit_relations(&c), Err(StoryError::Corrupt));
    }
}

#[test]
fn receipt_version_checkpoint_identity_and_oversize_corruption_fail_closed() {
    for update in ["json_set(receipt,'$.version',23)","json_set(receipt,'$.checkpointIds[0]','other-session-cp')","json_set(receipt,'$.checkpointIds',json('[]'))","json_set(receipt,'$.wireDigest','sha256:0000000000000000000000000000000000000000000000000000000000000000')"] {
        let (_root,library)=library();commit(library.stories(),"story",1);
        {let c=lock_connection(library.connection()).unwrap();c.execute_batch(&format!("UPDATE arena_story_chapter SET receipt={update}")).unwrap();assert_eq!(audit_relations(&c),Err(StoryError::Corrupt));}
        assert_eq!(library.stories().receipt("story","story-chapter-1"),Err(StoryError::Corrupt));
    }
}

#[test]
fn backup_rejects_corrupted_summary_metadata_even_with_valid_record_hash() {
    for sql in [
        "UPDATE arena_story_session SET title_preview=printf('%0200d',1)",
        "UPDATE arena_story_session SET revision=9007199254740992",
        "UPDATE arena_story_session SET mode='unexpected'",
        "UPDATE arena_story_chapter SET markdown_bytes=999",
    ] {
        let (_root, library) = library();
        commit(library.stories(), "story", 1);
        let c = lock_connection(library.connection()).unwrap();
        c.execute_batch(sql).unwrap();
        assert_eq!(audit_relations(&c), Err(StoryError::Corrupt));
    }
}

#[test]
fn opaque_lone_surrogate_and_proto_extension_bytes_survive_native_roundtrip() {
    let (_root, library) = library();
    let store = library.stories();
    let mut parts = fixture("story", 1);
    parts[2].1 = parts[2].1.replacen(
        "{",
        r#"{"__proto__":{"kept":true},"unknownLone":"\ud800","#,
        1,
    );
    let token = upload(store, "story", 1, &parts);
    store.end(&token, Instant::now()).unwrap();
    let descriptor = store
        .describe_record("story", 1, RecordKind::Chapter, "story-chapter-1")
        .unwrap();
    assert_eq!(raw(store, &descriptor), parts[2].1.as_bytes());
    audit_relations(&lock_connection(library.connection()).unwrap()).unwrap();
}

#[test]
fn backup_plan_missing_fields_and_wrong_types_are_rejected() {
    for plan in [
        r#"{"totalChapters":5}"#,
        r#"{"totalChapters":5,"source":"user"}"#,
        r#"{"totalChapters":5,"source":null,"locked":false}"#,
        r#"{"totalChapters":5,"source":"user","locked":1}"#,
    ] {
        let (_root, library) = library();
        commit(library.stories(), "story", 1);
        let c = lock_connection(library.connection()).unwrap();
        c.execute("UPDATE arena_story_session SET chapter_plan=?1,document=json_set(document,'$.chapterPlan',json(?1))", [plan]).unwrap();
        let doc: String = c
            .query_row("SELECT document FROM arena_story_session", [], |row| {
                row.get(0)
            })
            .unwrap();
        c.execute(
            "UPDATE arena_story_session SET document_bytes=?1,document_digest=?2",
            params![doc.len() as u64, digest(doc.as_bytes())],
        )
        .unwrap();
        assert_eq!(audit_relations(&c), Err(StoryError::Corrupt));
    }
}
