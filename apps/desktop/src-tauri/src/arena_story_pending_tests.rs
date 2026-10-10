use super::*;
use crate::library::LocalLibrary;
use serde_json::json;

fn input(session: &str, request: &str) -> String {
    json!({"version":1,"sessionId":session,"generationRequestId":request,"action":"start","chapterIndex":1,"chapterContext":{"recentWindow":[],"workingCombatants":[{"data":{"name":"角色"}}]},"seed":{"combatants":[{"data":{"name":"角色"}}],"mode":"classic","storyLength":"default","language":"zh-CN","settings":{"readArenaHistory":false,"writeArenaHistory":true,"readCurrentState":true,"writeCurrentState":true,"readNarrativeHistory":false,"writeNarrativeHistory":false}}}).to_string()
}
fn candidate(product: Product, frozen: bool) -> (PendingManifest, Vec<(PendingKind, String)>) {
    let request = "request-story-1";
    let session = "story";
    let mut parts = vec![
        (PendingKind::Input, input(session, request)),
        (PendingKind::Markdown, "正文🙂\0".to_string()),
        (PendingKind::Reasoning, "推理保留\n".to_string()),
    ];
    let mut commits = super::super::tests::fixture(session, 1);
    let checkpoint: serde_json::Value = serde_json::from_str(
        &commits
            .iter()
            .find(|(k, _)| *k == PartKind::Checkpoint0)
            .unwrap()
            .1,
    )
    .unwrap();
    let mut input_value: serde_json::Value = serde_json::from_str(&parts[0].1).unwrap();
    input_value["chapterContext"]["workingCombatants"] = checkpoint["combatants"].clone();
    input_value["seed"]["combatants"] = checkpoint["combatants"].clone();
    parts[0].1 = input_value.to_string();
    let chapter = commits
        .iter_mut()
        .find(|(k, _)| *k == PartKind::Chapter)
        .unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&chapter.1).unwrap();
    value["cardSnapshot"]["aiReasoning"] =
        json!({"status":"done","source":"provider","text":parts[2].1});
    value["cardSnapshot"]["storyRoleSync"] =
        json!({"version":1,"state":"not-requested","warnings":[]});
    chapter.1 = value.to_string();
    let commit_manifest = frozen.then(|| super::super::tests::manifest(session, 1, &commits));
    if frozen {
        parts.extend(
            commits
                .into_iter()
                .map(|(k, s)| (PendingKind::from_commit(k), s)),
        );
    }
    let manifest = PendingManifest {
        version: 1,
        product,
        request_id: request.into(),
        actor: Actor::Anonymous,
        pending_revision: 1,
        session_id: session.into(),
        operation_id: "story-chapter-1".into(),
        output_checkpoint_id: "story-checkpoint-1".into(),
        initial_checkpoint_id: Some("story-checkpoint-0".into()),
        created_at: 100,
        expected_revision: 0,
        expected_last_chapter_id: None,
        last_input_checkpoint_id: "story-checkpoint-0".into(),
        input_digest: digest(parts[0].1.as_bytes()),
        write_options: WriteOptions {
            write_arena_history: true,
            write_current_state: true,
            write_narrative_history: false,
        },
        model_completed: true,
        role_state: RoleState::NotRequested,
        role_input_digest: None,
        parts: parts
            .iter()
            .map(|(kind, body)| PendingPart {
                kind: *kind,
                byte_length: body.len() as u64,
                digest: digest(body.as_bytes()),
            })
            .collect(),
        commit_manifest,
    };
    (manifest, parts)
}
fn upload(store: &StoryStore, m: &PendingManifest, parts: &[(PendingKind, String)]) -> String {
    let token = store.pending_begin(m.clone()).unwrap().token;
    for (kind, body) in parts {
        for (i, bytes) in body.as_bytes().chunks(31).enumerate() {
            store
                .pending_append(&token, *kind, (i * 31) as u64, bytes)
                .unwrap();
        }
    }
    token
}
fn fixture() -> (tempfile::TempDir, LocalLibrary) {
    let root = tempfile::tempdir().unwrap();
    let lib = LocalLibrary::open(root.path()).unwrap();
    (root, lib)
}
fn frozen(store: &StoryStore) -> (PendingKey, String) {
    let (m, parts) = candidate(Product::Battle, true);
    let t = upload(store, &m, &parts);
    store.pending_seal(&t).unwrap();
    (m.key(), m.commit_manifest.unwrap().wire_digest().unwrap())
}
#[test]
fn originals_exact_reopen_offsets_and_slot_ownership() {
    let (root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = candidate(Product::Battle, false);
    let token = upload(store, &m, &parts);
    assert_eq!(store.pending_begin(m.clone()).unwrap().token, token);
    let snapshot = store.pending_seal(&token).unwrap();
    assert_eq!(store.pending_seal(&token).unwrap(), snapshot);
    store.pending_abort(&token).unwrap();
    assert_eq!(
        store.pending_describe(Product::Battle).unwrap(),
        Some(snapshot.clone())
    );
    let mut other = m.clone();
    other.request_id = "request-other-1".into();
    other.pending_revision = 2;
    assert_eq!(store.pending_begin(other), Err(StoryError::Conflict));
    drop(lib);
    let lib = LocalLibrary::open(root.path()).unwrap();
    assert_eq!(
        lib.stories().pending_describe(Product::Battle).unwrap(),
        Some(snapshot)
    );
    for (kind, body) in parts {
        let bytes = lib
            .stories()
            .pending_read(&m.key(), kind, 0, CANDIDATE_FRAME_BYTES)
            .unwrap();
        assert_eq!(bytes, body.as_bytes());
    }
    audit(&lock_connection(lib.connection()).unwrap()).unwrap();
}
#[test]
fn input_and_authority_carriers_are_validated_before_any_bytes_reach_database() {
    let (_root, lib) = fixture();
    let (mut m, mut parts) = candidate(Product::Battle, false);
    parts[0].1 = parts[0].1.replace(
        "\"version\":1",
        "\"customProvider\":{\"apiKey\":\"SECRET_CANARY\"},\"version\":1",
    );
    m.parts[0].byte_length = parts[0].1.len() as u64;
    m.parts[0].digest = digest(parts[0].1.as_bytes());
    m.input_digest = m.parts[0].digest.clone();
    let token = lib.stories().pending_begin(m).unwrap().token;
    let bytes = parts[0].1.as_bytes();
    let split = bytes.len() - 1;
    lib.stories()
        .pending_append(&token, PendingKind::Input, 0, &bytes[..split])
        .unwrap();
    assert_eq!(
        lib.stories().pending_upload(&token).unwrap().received_bytes[0].received_bytes,
        0
    );
    assert_eq!(
        lib.stories()
            .pending_append(&token, PendingKind::Input, split as u64, &bytes[split..]),
        Err(StoryError::Invalid)
    );
    let conn = lock_connection(lib.connection()).unwrap();
    let stored: Vec<u8> = conn
        .query_row(
            "SELECT payload FROM arena_story_pending_part WHERE token=?1 AND kind='input'",
            [&token],
            |r| r.get(0),
        )
        .unwrap();
    assert!(stored.iter().all(|b| *b == 0));
    assert!(validate_carrier(
        br#"{"reportFormat":"markdown","Authorization":"secret"}"#,
        PendingKind::Header,
        &candidate(Product::Battle, false).0
    )
    .is_err());
    assert!(validate_carrier(br#"{"event":"meta","id":"1-0","data":{"parseOk":true,"meta":{},"raw":"","rawTruncated":false},"token":"secret"}"#,PendingKind::Meta,&candidate(Product::Battle,false).0).is_err());
}
#[test]
fn append_ack_replay_is_exact_and_hash_failure_preserves_active() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = candidate(Product::Battle, false);
    let token = upload(store, &m, &parts);
    store.pending_seal(&token).unwrap();
    let (mut next, next_parts) = candidate(Product::Battle, true);
    next.pending_revision = 2;
    let token = store.pending_begin(next.clone()).unwrap().token;
    let body = &next_parts[1].1;
    store
        .pending_append(&token, PendingKind::Markdown, 0, body.as_bytes())
        .unwrap();
    store
        .pending_append(&token, PendingKind::Markdown, 0, body.as_bytes())
        .unwrap();
    assert_eq!(
        store.pending_append(&token, PendingKind::Markdown, 0, b"wrong"),
        Err(StoryError::Conflict)
    );
    for (kind, body) in &next_parts {
        store
            .pending_append(&token, *kind, 0, body.as_bytes())
            .unwrap();
    }
    {
        let conn = lock_connection(lib.connection()).unwrap();
        let (id, _, _, _) = part_row(&conn, &token, PendingKind::Markdown).unwrap();
        let mut b = conn
            .blob_open("main", "arena_story_pending_part", "payload", id, false)
            .unwrap();
        b.write_all(b"X").unwrap();
    }
    assert_eq!(store.pending_seal(&token), Err(StoryError::Corrupt));
    assert_eq!(
        store
            .pending_describe(Product::Battle)
            .unwrap()
            .unwrap()
            .manifest,
        m
    );
}
#[test]
fn sealing_faults_preserve_old_or_publish_exact_whole_revision() {
    for boundary in [
        "validated",
        "old-removed",
        "before-seal-commit",
        "after-seal-commit",
    ] {
        let (root, lib) = fixture();
        let (m, parts) = candidate(Product::Battle, false);
        let t = upload(lib.stories(), &m, &parts);
        lib.stories().pending_seal(&t).unwrap();
        let (mut next, parts) = candidate(Product::Battle, true);
        next.pending_revision = 2;
        let t = upload(lib.stories(), &next, &parts);
        assert!(lib
            .stories()
            .pending_seal_with_hook(&t, &mut |point| if point == boundary {
                Err(StoryError::Io)
            } else {
                Ok(())
            })
            .is_err());
        drop(lib);
        let lib = LocalLibrary::open(root.path()).unwrap();
        let actual = lib
            .stories()
            .pending_describe(Product::Battle)
            .unwrap()
            .unwrap();
        assert_eq!(
            actual.manifest,
            if boundary == "after-seal-commit" {
                next
            } else {
                m
            }
        );
        audit(&lock_connection(lib.connection()).unwrap()).unwrap();
    }
}
#[test]
fn save_reuses_exact_commit_writer_and_deletes_pending_in_receipt_transaction() {
    for boundary in [
        "cas",
        "session",
        "seed",
        "chapter",
        "checkpoint0",
        "checkpoint1",
        "pending-removed",
        "before-commit",
        "after-commit",
    ] {
        let (root, lib) = fixture();
        let (key, wire) = frozen(lib.stories());
        let attempt = lib.stories().pending_prepare_save(&key, &wire).unwrap();
        let result =
            lib.stories()
                .pending_save_with_hook(&key, &wire, &attempt.attempt_id, &mut |point| {
                    if point == boundary {
                        Err(StoryError::Io)
                    } else {
                        Ok(())
                    }
                });
        assert!(result.is_err());
        drop(lib);
        let lib = LocalLibrary::open(root.path()).unwrap();
        if boundary == "after-commit" {
            assert_eq!(result, Err(StoryError::CommitUnknown));
            assert!(lib
                .stories()
                .pending_describe(Product::Battle)
                .unwrap()
                .is_none());
            assert_eq!(
                lib.stories()
                    .receipt("story", "story-chapter-1")
                    .unwrap()
                    .unwrap()
                    .wire_digest,
                wire
            );
        } else {
            assert!(lib
                .stories()
                .receipt("story", "story-chapter-1")
                .unwrap()
                .is_none());
            let pending = lib
                .stories()
                .pending_describe(Product::Battle)
                .unwrap()
                .unwrap();
            assert!(pending.save_attempt_id.is_none());
            let fresh = lib.stories().pending_prepare_save(&key, &wire).unwrap();
            lib.stories()
                .pending_save(&key, &wire, &fresh.attempt_id)
                .unwrap();
        }
        super::super::audit_relations(&lock_connection(lib.connection()).unwrap()).unwrap();
    }
}
#[test]
fn direct_and_pending_share_stage_count_and_byte_budget() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let (m, _) = candidate(Product::Battle, false);
    let a = store.pending_begin(m).unwrap();
    let parts = super::super::tests::fixture("direct", 1);
    let manifest = super::super::tests::manifest("direct", 1, &parts);
    let b = store.begin(manifest.clone(), Instant::now()).unwrap();
    assert_eq!(
        store.begin(manifest.clone(), Instant::now()),
        Err(StoryError::Busy)
    );
    store.pending_abort(&a.token).unwrap();
    assert!(store.begin(manifest, Instant::now()).is_ok());
    store.abort(&b.token).unwrap();
}
#[test]
fn exact_limits_and_control_metadata_cannot_hide_payload() {
    let (mut m, _) = candidate(Product::Battle, false);
    m.parts.truncate(1);
    m.parts[0].byte_length = INPUT_BYTES;
    assert!(m.validate().is_ok());
    m.parts[0].byte_length += 1;
    assert_eq!(m.validate(), Err(StoryError::TooLarge));
    let (mut m, _) = candidate(Product::Battle, true);
    let overhead: u64 = m
        .parts
        .iter()
        .filter(|p| p.kind != PendingKind::Chapter)
        .map(|p| p.byte_length)
        .sum();
    m.parts
        .iter_mut()
        .find(|p| p.kind == PendingKind::Chapter)
        .unwrap()
        .byte_length = CANDIDATE_COMMIT_BYTES - overhead;
    m.commit_manifest
        .as_mut()
        .unwrap()
        .parts
        .iter_mut()
        .find(|p| p.kind == PartKind::Chapter)
        .unwrap()
        .byte_length = CANDIDATE_COMMIT_BYTES - overhead;
    assert_eq!(m.validate(), Ok(CANDIDATE_COMMIT_BYTES));
    m.parts
        .iter_mut()
        .find(|p| p.kind == PendingKind::Chapter)
        .unwrap()
        .byte_length += 1;
    assert_eq!(m.validate(), Err(StoryError::TooLarge));
    let mut value = serde_json::to_value(candidate(Product::Battle, false).0).unwrap();
    value["body"] = json!("bypass");
    assert!(serde_json::from_value::<PendingManifest>(value).is_err());
}
#[test]
fn sqlite_full_leaves_existing_candidate_and_no_reservation_leak() {
    let (root, lib) = fixture();
    let (m, parts) = candidate(Product::Battle, false);
    let t = upload(lib.stories(), &m, &parts);
    lib.stories().pending_seal(&t).unwrap();
    let (mut next, _) = candidate(Product::Battle, true);
    next.pending_revision = 2;
    next.parts
        .iter_mut()
        .find(|p| p.kind == PendingKind::Chapter)
        .unwrap()
        .byte_length = INPUT_BYTES;
    next.commit_manifest
        .as_mut()
        .unwrap()
        .parts
        .iter_mut()
        .find(|p| p.kind == PartKind::Chapter)
        .unwrap()
        .byte_length = INPUT_BYTES;
    {
        let conn = lock_connection(lib.connection()).unwrap();
        let pages: u64 = conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .unwrap();
        conn.pragma_update(None, "max_page_count", pages).unwrap();
    }
    assert_eq!(lib.stories().pending_begin(next), Err(StoryError::Io));
    assert_eq!(
        upload_reservations(&lock_connection(lib.connection()).unwrap()).unwrap(),
        (0, 0)
    );
    drop(lib);
    let lib = LocalLibrary::open(root.path()).unwrap();
    assert_eq!(
        lib.stories()
            .pending_describe(Product::Battle)
            .unwrap()
            .unwrap()
            .manifest,
        m
    );
}

// A new OS process produces each outcome. No in-memory store/token survives the
// boundary. This complements transaction rollback hooks rather than simulating restart.
#[test]
fn process_boundary_child() {
    let Ok(root) = std::env::var("STORY_PENDING_TEST_ROOT") else {
        return;
    };
    let mode = std::env::var("STORY_PENDING_TEST_MODE").unwrap();
    if mode == "restore" {
        crate::restore::recover_pending(Path::new(&root)).unwrap();
        std::process::exit(0);
    }
    let lib = LocalLibrary::open(Path::new(&root)).unwrap();
    if mode == "seal" {
        let (m, parts) = candidate(Product::Battle, true);
        let token = upload(lib.stories(), &m, &parts);
        lib.stories()
            .pending_seal_with_hook(&token, &mut |point| {
                if point == "after-seal-commit" {
                    std::process::exit(0);
                }
                Ok(())
            })
            .unwrap();
        panic!("expected process exit after durable seal");
    }
    let (key, wire) = frozen(lib.stories());
    let attempt = lib.stories().pending_prepare_save(&key, &wire).unwrap();
    if mode == "attempt" {
        std::process::exit(0);
    }
    lib.stories()
        .pending_save_with_hook(&key, &wire, &attempt.attempt_id, &mut |point| {
            if point
                == if mode == "precommit" {
                    "before-commit"
                } else {
                    "after-commit"
                }
            {
                std::process::exit(0);
            }
            Ok(())
        })
        .unwrap();
    panic!("expected process exit at commit boundary");
}
fn run_boundary_child(root: &Path, mode: &str) {
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "arena_story::pending::tests::process_boundary_child",
            "--nocapture",
        ])
        .env("STORY_PENDING_TEST_ROOT", root)
        .env("STORY_PENDING_TEST_MODE", mode)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let pid = child.id();
    let result = child.wait_with_output().unwrap();
    println!(
        "pending process boundary: pid={pid} mode={mode} exit={}",
        result.status
    );
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
#[test]
fn real_process_restart_keeps_attempt_unknown_and_exact_receipt() {
    for mode in ["seal", "attempt", "precommit", "commit"] {
        let root = tempfile::tempdir().unwrap();
        run_boundary_child(root.path(), mode);
        let lib = LocalLibrary::open(root.path()).unwrap();
        let (m, _) = candidate(Product::Battle, true);
        let wire = m.commit_manifest.as_ref().unwrap().wire_digest().unwrap();
        if mode == "commit" {
            assert!(lib
                .stories()
                .pending_describe(Product::Battle)
                .unwrap()
                .is_none());
            assert_eq!(
                lib.stories()
                    .receipt("story", "story-chapter-1")
                    .unwrap()
                    .unwrap()
                    .wire_digest,
                wire
            );
        } else {
            let snapshot = lib
                .stories()
                .pending_describe(Product::Battle)
                .unwrap()
                .unwrap();
            assert_eq!(snapshot.manifest, m);
            if mode == "attempt" || mode == "precommit" {
                assert!(snapshot.save_attempt_id.is_some());
                assert_eq!(
                    lib.stories().pending_prepare_save(&m.key(), &wire),
                    Err(StoryError::CommitUnknown)
                );
                assert_eq!(
                    lib.stories().pending_save(
                        &m.key(),
                        &wire,
                        snapshot.save_attempt_id.as_deref().unwrap()
                    ),
                    Err(StoryError::CommitUnknown)
                );
                assert!(lib
                    .stories()
                    .receipt("story", "story-chapter-1")
                    .unwrap()
                    .is_none());
            }
        }
    }
}
#[test]
fn restoring_old_backup_fences_frozen_package_even_when_old_receipt_is_absent() {
    let (root, lib) = fixture();
    let (key, wire) = frozen(lib.stories());
    let backup = crate::backup::create_backup(&lib).unwrap();
    let attempt = lib.stories().pending_prepare_save(&key, &wire).unwrap();
    lib.stories()
        .pending_save(&key, &wire, &attempt.attempt_id)
        .unwrap();
    let prepared = crate::restore::prepare_restore(&lib, &backup.backup_id).unwrap();
    drop(prepared);
    drop(lib);
    run_boundary_child(root.path(), "restore");
    let lib = LocalLibrary::open(root.path()).unwrap();
    let snapshot = lib
        .stories()
        .pending_describe(Product::Battle)
        .unwrap()
        .unwrap();
    assert!(snapshot.restored);
    assert!(lib
        .stories()
        .receipt("story", "story-chapter-1")
        .unwrap()
        .is_none());
    assert_eq!(
        lib.stories().pending_prepare_save(&key, &wire),
        Err(StoryError::CommitUnknown)
    );
    drop(lib);
    run_boundary_child(root.path(), "restore");
    let lib = LocalLibrary::open(root.path()).unwrap();
    assert!(
        lib.stories()
            .pending_describe(Product::Battle)
            .unwrap()
            .unwrap()
            .restored
    );
}

#[test]
fn json_lone_surrogates_and_opaque_extensions_survive_without_new_domain_limits() {
    let (_root, lib) = fixture();
    let (mut m, mut parts) = candidate(Product::Battle, true);
    parts[0].1 = parts[0].1.replace("角色", r"角色\ud800");
    for (kind, body) in &mut parts {
        if matches!(
            kind,
            PendingKind::Seed | PendingKind::Checkpoint0 | PendingKind::Checkpoint1
        ) {
            *body = body.replace("角色", r"角色\ud800");
        }
    }
    // TextEncoder's raw body is U+FFFD; the frozen JSON retains the original escape.
    parts[1].1 = "�".into();
    let chapter = parts
        .iter_mut()
        .find(|(k, _)| *k == PendingKind::Chapter)
        .unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&chapter.1).unwrap();
    value["markdown"] = json!("LONE_MARKER");
    value["markdownByteLength"] = json!(3);
    chapter.1 = value.to_string().replace("LONE_MARKER", r"\ud800");
    for (kind, body) in &parts {
        let p = m.parts.iter_mut().find(|p| p.kind == *kind).unwrap();
        p.byte_length = body.len() as u64;
        p.digest = digest(body.as_bytes());
        if let Some(k) = kind.commit() {
            let p = m
                .commit_manifest
                .as_mut()
                .unwrap()
                .parts
                .iter_mut()
                .find(|p| p.kind == k)
                .unwrap();
            p.byte_length = body.len() as u64;
            p.digest = digest(body.as_bytes());
        }
    }
    m.input_digest = m.parts[0].digest.clone();
    let token = upload(lib.stories(), &m, &parts);
    lib.stories().pending_seal(&token).unwrap();
    assert_eq!(
        lib.stories()
            .pending_read(&m.key(), PendingKind::Input, 0, CANDIDATE_FRAME_BYTES)
            .unwrap(),
        parts[0].1.as_bytes()
    );
    let wire = m.commit_manifest.as_ref().unwrap().wire_digest().unwrap();
    let attempt = lib.stories().pending_prepare_save(&m.key(), &wire).unwrap();
    lib.stories()
        .pending_save(&m.key(), &wire, &attempt.attempt_id)
        .unwrap();
    let conn = lock_connection(lib.connection()).unwrap();
    let actual: String = conn
        .query_row(
            "SELECT document FROM arena_story_chapter WHERE id='story-chapter-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        actual,
        parts
            .iter()
            .find(|(k, _)| *k == PendingKind::Chapter)
            .unwrap()
            .1
    );
}

#[test]
fn nullable_control_fields_are_required_and_text_limits_match_javascript_units() {
    for field in [
        "initialCheckpointId",
        "expectedLastChapterId",
        "roleInputDigest",
        "commitManifest",
    ] {
        let mut value = serde_json::to_value(candidate(Product::Battle, false).0).unwrap();
        value.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<PendingManifest>(value).is_err());
    }
    let m = candidate(Product::Battle, false).0;
    let event = |raw: String| {
        json!({"id":"1-0","event":"meta","data":{"parseOk":true,"meta":{},"raw":raw,"rawTruncated":false}}).to_string()
    };
    assert!(validate_carrier(event("🙂".repeat(4000)).as_bytes(), PendingKind::Meta, &m).is_ok());
    assert!(validate_carrier(
        event("🙂".repeat(4000) + "x").as_bytes(),
        PendingKind::Meta,
        &m
    )
    .is_err());
}

fn refresh(m: &mut PendingManifest, parts: &[(PendingKind, String)]) {
    m.parts = parts
        .iter()
        .map(|(kind, body)| PendingPart {
            kind: *kind,
            byte_length: body.len() as u64,
            digest: digest(body.as_bytes()),
        })
        .collect();
    m.input_digest = m.parts[0].digest.clone();
    if let Some(commit) = &mut m.commit_manifest {
        commit.parts = m
            .parts
            .iter()
            .filter_map(|p| {
                p.kind.commit().map(|kind| PartDeclaration {
                    kind,
                    byte_length: p.byte_length,
                    digest: p.digest.clone(),
                })
            })
            .collect();
    }
}
fn upload_large(
    store: &StoryStore,
    m: &PendingManifest,
    parts: &[(PendingKind, String)],
) -> String {
    let token = store.pending_begin(m.clone()).unwrap().token;
    for (kind, body) in parts {
        for (i, bytes) in body.as_bytes().chunks(CANDIDATE_FRAME_BYTES).enumerate() {
            store
                .pending_append(&token, *kind, (i * CANDIDATE_FRAME_BYTES) as u64, bytes)
                .unwrap();
        }
    }
    token
}
fn pad_document(raw: &str, field_name: &str, target: usize) -> String {
    let mut value: serde_json::Value = serde_json::from_str(raw).unwrap();
    value[field_name] = json!("");
    let overhead = value.to_string().len();
    assert!(target >= overhead);
    value[field_name] = json!("x".repeat(target - overhead));
    let out = value.to_string();
    assert_eq!(out.len(), target);
    out
}
fn disk(root: &Path, label: &str, logical: u64) {
    let size = |name: &str| fs::metadata(root.join(name)).map(|m| m.len()).unwrap_or(0);
    println!(
        "{}",
        json!({"measurement":label,"logicalPayloadBytes":logical,"databaseBytes":size("library.sqlite"),"walBytes":size("library.sqlite-wal"),"shmBytes":size("library.sqlite-shm")})
    );
}
fn exact_slot(product: Product) -> (PendingManifest, Vec<(PendingKind, String)>) {
    let (mut m, mut parts) = candidate(product, true);
    let other: usize = parts
        .iter()
        .filter(|(k, _)| *k != PendingKind::Chapter)
        .map(|(_, s)| s.len())
        .sum();
    let chapter = parts
        .iter_mut()
        .find(|(k, _)| *k == PendingKind::Chapter)
        .unwrap();
    chapter.1 = pad_document(
        &chapter.1,
        "capacityExtension",
        CANDIDATE_COMMIT_BYTES as usize - other,
    );
    refresh(&mut m, &parts);
    assert_eq!(m.validate(), Ok(CANDIDATE_COMMIT_BYTES));
    (m, parts)
}

/// Serial opt-in real-byte measurement, intentionally excluded from ordinary tests.
/// The external runner samples the complete scratch tree and child RSS. No model,
/// Tauri, source fixtures or persistent user files are used.
#[test]
#[ignore = "run serially in the reserved Native capacity window"]
fn measured_capacity() {
    let case = std::env::var("STORY_PENDING_CAPACITY_CASE").unwrap();
    let root = std::env::var("STORY_PENDING_CAPACITY_ROOT").unwrap();
    let root = Path::new(&root);
    let lib = LocalLibrary::open(root).unwrap();
    disk(root, "opened", 0);
    if case == "typical" {
        let (mut m, mut parts) = candidate(Product::Battle, true);
        // Real strict carriers with 32 records and exact serialized byte counts.
        let mut input_value: serde_json::Value = serde_json::from_str(&parts[0].1).unwrap();
        let roster = |n: usize| {
            (0..32).map(|i|json!({"type":"magical-girl","data":{"name":format!("角色{i}"),"content":"x".repeat(n)}})).collect::<Vec<_>>()
        };
        input_value["seed"]["combatants"] = json!(roster(6 * 1024 * 1024 / 32 - 128));
        input_value["chapterContext"]["workingCombatants"] =
            json!(roster(4 * 1024 * 1024 / 32 - 128));
        parts[0].1 = pad_document(&input_value.to_string(), "userGuidance", 10 * 1024 * 1024);
        parts[1].1 = "m".repeat(2 * 1024 * 1024);
        let mut chapter: serde_json::Value = serde_json::from_str(
            &parts
                .iter()
                .find(|(k, _)| *k == PendingKind::Chapter)
                .unwrap()
                .1,
        )
        .unwrap();
        chapter["markdown"] = json!(parts[1].1);
        chapter["markdownByteLength"] = json!(parts[1].1.len());
        let meta_value = json!({"id":"1-0","event":"meta","data":{"parseOk":true,"meta":{"text":"x".repeat(256*1024-128)},"raw":"","rawTruncated":false}});
        let header = pad_document(r#"{"reportFormat":"markdown"}"#, "userGuidance", 64 * 1024);
        let header_value: serde_json::Value = serde_json::from_str(&header).unwrap();
        let updates=(0..32).map(|i|json!({"combatantIndex":i,"data":{"name":format!("角色{i}"),"content":"x".repeat(6*1024*1024/32-256)},"isNative":false})).collect::<Vec<_>>();
        let role_value = json!({"version":"arena-reconciliation-v1","generationId":"generation-story-1","success":true,"updatedCombatants":updates,"warnings":[]});
        chapter["reportJson"] = meta_value["data"]["meta"].clone();
        chapter["generationId"] = json!("generation-story-1");
        chapter["cardSnapshot"]["userGuidance"] = header_value["userGuidance"].clone();
        chapter["cardSnapshot"]["streamUpdateMetaDebug"] =
            json!({"source":"sse","parseOk":true,"raw":"","rawTruncated":false});
        chapter["cardSnapshot"]["storyRoleSync"] =
            json!({"version":1,"state":"accepted","warnings":[]});
        for (kind, body) in &mut parts {
            let target = match kind {
                PendingKind::Session => 64 * 1024,
                PendingKind::Seed => 6 * 1024 * 1024,
                PendingKind::Chapter => 4 * 1024 * 1024,
                PendingKind::Checkpoint0 => 4 * 1024 * 1024,
                PendingKind::Checkpoint1 => 6 * 1024 * 1024,
                _ => continue,
            };
            let mut value: serde_json::Value = serde_json::from_str(body).unwrap();
            match kind {
                PendingKind::Chapter => value = chapter.clone(),
                PendingKind::Seed => {
                    value["combatants"] = input_value["seed"]["combatants"].clone()
                }
                PendingKind::Checkpoint0 => {
                    value["combatants"] = input_value["chapterContext"]["workingCombatants"].clone()
                }
                PendingKind::Checkpoint1 => {
                    value["combatants"] =
                        input_value["chapterContext"]["workingCombatants"].clone();
                    for update in role_value["updatedCombatants"].as_array().unwrap() {
                        let i = update["combatantIndex"].as_u64().unwrap() as usize;
                        value["combatants"][i]["data"] = update["data"].clone();
                        value["combatants"][i]["isNative"] = update["isNative"].clone();
                    }
                }
                _ => {}
            }
            *body = pad_document(&value.to_string(), "capacityExtension", target);
        }
        parts.extend([
            (PendingKind::Meta, meta_value.to_string()),
            (PendingKind::Header, header),
            (PendingKind::RoleResponse, role_value.to_string()),
        ]);
        parts.sort_by_key(|(k, _)| k.order());
        m.role_state = RoleState::Accepted;
        m.role_input_digest = Some(digest(r#"[{"name":"角色"}]"#.as_bytes()));
        refresh(&mut m, &parts);
        let mut original = m.clone();
        original.commit_manifest = None;
        original.role_state = RoleState::NotRequested;
        original.role_input_digest = None;
        let first: Vec<_> = parts
            .iter()
            .filter(|(k, _)| *k == PendingKind::Input)
            .cloned()
            .collect();
        refresh(&mut original, &first);
        original.model_completed = false;
        let token = upload_large(lib.stories(), &original, &first);
        lib.stories().pending_seal(&token).unwrap();
        disk(root, "input-sealed", original.validate().unwrap());
        let before_role: Vec<_> = parts
            .iter()
            .filter(|(k, _)| k.commit().is_none() && *k != PendingKind::RoleResponse)
            .cloned()
            .collect();
        original.pending_revision = 2;
        original.model_completed = true;
        original.role_state = RoleState::Unresolved;
        original.role_input_digest = m.role_input_digest.clone();
        refresh(&mut original, &before_role);
        let token = upload_large(lib.stories(), &original, &before_role);
        lib.stories().pending_seal(&token).unwrap();
        disk(root, "body-sealed", original.validate().unwrap());
        let role_parts: Vec<_> = parts
            .iter()
            .filter(|(k, _)| k.commit().is_none())
            .cloned()
            .collect();
        original.pending_revision = 3;
        original.role_state = RoleState::Accepted;
        refresh(&mut original, &role_parts);
        let token = upload_large(lib.stories(), &original, &role_parts);
        lib.stories().pending_seal(&token).unwrap();
        disk(root, "role-sealed", original.validate().unwrap());
        m.pending_revision = 4;
        let token = upload_large(lib.stories(), &m, &parts);
        disk(
            root,
            "frozen-upload-before-publish",
            m.validate().unwrap() + original.validate().unwrap(),
        );
        lib.stories().pending_seal(&token).unwrap();
        disk(root, "frozen-published", m.validate().unwrap());
        let wire = m.commit_manifest.as_ref().unwrap().wire_digest().unwrap();
        let attempt = lib.stories().pending_prepare_save(&m.key(), &wire).unwrap();
        lib.stories()
            .pending_save(&m.key(), &wire, &attempt.attempt_id)
            .unwrap();
        disk(root, "committed", 0);
        let backup = crate::backup::create_backup(&lib).unwrap();
        println!(
            "{}",
            json!({"backupDatabaseBytes":backup.database_bytes,"parts":m.parts,"commitBytes":m.commit_manifest.as_ref().unwrap().validate().unwrap()})
        );
    } else if case == "escape-expanded" {
        let (mut m, mut parts) = candidate(Product::Battle, true);
        let reasoning_bytes = parts
            .iter()
            .find(|(k, _)| *k == PendingKind::Reasoning)
            .map_or(0, |(_, text)| text.len());
        let markdown = "\0".repeat(4 * 1024 * 1024 - reasoning_bytes);
        parts
            .iter_mut()
            .find(|(k, _)| *k == PendingKind::Markdown)
            .unwrap()
            .1 = markdown.clone();
        let chapter = parts
            .iter_mut()
            .find(|(k, _)| *k == PendingKind::Chapter)
            .unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&chapter.1).unwrap();
        value["markdown"] = json!(markdown);
        value["markdownByteLength"] = json!(markdown.len());
        chapter.1 = value.to_string();
        let chapter_bytes = chapter.1.len();
        assert!(chapter_bytes >= 6 * markdown.len());
        refresh(&mut m, &parts);
        let token = upload_large(lib.stories(), &m, &parts);
        lib.stories().pending_seal(&token).unwrap();
        disk(root, "escape-expanded-sealed", m.validate().unwrap());
        let wire = m.commit_manifest.as_ref().unwrap().wire_digest().unwrap();
        let attempt = lib.stories().pending_prepare_save(&m.key(), &wire).unwrap();
        lib.stories()
            .pending_save(&m.key(), &wire, &attempt.attempt_id)
            .unwrap();
        let backup = crate::backup::create_backup(&lib).unwrap();
        println!(
            "{}",
            json!({"rawBodyBytes":markdown.len()+reasoning_bytes,"escapedChapterBytes":chapter_bytes,"pendingBytes":m.validate().unwrap(),"backupDatabaseBytes":backup.database_bytes})
        );
    } else if case == "full-slot" {
        let (m, parts) = exact_slot(Product::Battle);
        let token = upload_large(lib.stories(), &m, &parts);
        disk(root, "full-slot-upload", m.validate().unwrap());
        lib.stories().pending_seal(&token).unwrap();
        disk(root, "full-slot-sealed", m.validate().unwrap());
        let wire = m.commit_manifest.as_ref().unwrap().wire_digest().unwrap();
        let attempt = lib.stories().pending_prepare_save(&m.key(), &wire).unwrap();
        lib.stories()
            .pending_save(&m.key(), &wire, &attempt.attempt_id)
            .unwrap();
        disk(root, "full-slot-committed", 0);
        let backup = crate::backup::create_backup(&lib).unwrap();
        println!(
            "{}",
            json!({"backupDatabaseBytes":backup.database_bytes,"frozenCommitBytes":m.commit_manifest.as_ref().unwrap().validate().unwrap(),"pendingBytes":m.validate().unwrap()})
        );
    } else if case == "three-pools" {
        for product in [Product::Battle, Product::Arena] {
            let (m, parts) = exact_slot(product);
            let token = upload_large(lib.stories(), &m, &parts);
            lib.stories().pending_seal(&token).unwrap();
            disk(
                root,
                product.sql(),
                if product == Product::Battle {
                    CANDIDATE_COMMIT_BYTES
                } else {
                    2 * CANDIDATE_COMMIT_BYTES
                },
            );
        }
        let mut parts = super::super::tests::fixture("direct", 1);
        let other: usize = parts
            .iter()
            .filter(|(k, _)| *k != PartKind::Chapter)
            .map(|(_, s)| s.len())
            .sum();
        let part = parts
            .iter_mut()
            .find(|(k, _)| *k == PartKind::Chapter)
            .unwrap();
        part.1 = pad_document(
            &part.1,
            "capacityExtension",
            CANDIDATE_COMMIT_BYTES as usize - other,
        );
        let m = super::super::tests::manifest("direct", 1, &parts);
        let token = lib
            .stories()
            .begin(m.clone(), Instant::now())
            .unwrap()
            .token;
        for (kind, body) in &parts {
            for (i, bytes) in body.as_bytes().chunks(CANDIDATE_FRAME_BYTES).enumerate() {
                lib.stories()
                    .append(
                        &token,
                        *kind,
                        (i * CANDIDATE_FRAME_BYTES) as u64,
                        bytes,
                        Instant::now(),
                    )
                    .unwrap();
            }
        }
        assert_eq!(
            lib.stories().begin(m, Instant::now()),
            Err(StoryError::Busy)
        );
        disk(root, "three-pools-full", 3 * CANDIDATE_COMMIT_BYTES);
        let backup = crate::backup::create_backup(&lib).unwrap();
        println!(
            "{}",
            json!({"backupDatabaseBytes":backup.database_bytes,"directStageBytes":CANDIDATE_COMMIT_BYTES,"logicalPayloadBytes":3*CANDIDATE_COMMIT_BYTES})
        );
        lib.stories().abort(&token).unwrap();
    } else if case == "full-commit-rejected" {
        let (old, parts) = candidate(Product::Battle, false);
        let token = upload_large(lib.stories(), &old, &parts);
        lib.stories().pending_seal(&token).unwrap();
        let (mut m, mut parts) = candidate(Product::Battle, true);
        m.pending_revision = 2;
        let commit_other: usize = parts
            .iter()
            .filter(|(k, _)| k.commit().is_some() && *k != PendingKind::Chapter)
            .map(|(_, s)| s.len())
            .sum();
        let part = parts
            .iter_mut()
            .find(|(k, _)| *k == PendingKind::Chapter)
            .unwrap();
        part.1 = pad_document(
            &part.1,
            "capacityExtension",
            CANDIDATE_COMMIT_BYTES as usize - commit_other,
        );
        refresh(&mut m, &parts);
        assert_eq!(
            m.commit_manifest.as_ref().unwrap().validate(),
            Ok(CANDIDATE_COMMIT_BYTES)
        );
        assert_eq!(lib.stories().pending_begin(m), Err(StoryError::TooLarge));
        assert_eq!(
            lib.stories()
                .pending_describe(Product::Battle)
                .unwrap()
                .unwrap()
                .manifest,
            old
        );
        disk(
            root,
            "full-commit-rejected-originals-retained",
            old.validate().unwrap(),
        );
    } else {
        panic!("unknown capacity case");
    }
    audit(&lock_connection(lib.connection()).unwrap()).unwrap();
    super::super::audit_relations(&lock_connection(lib.connection()).unwrap()).unwrap();
}

#[test]
fn abort_holds_input_lock_until_upload_deletion_so_append_cannot_orphan_buffer() {
    let (_root, lib) = fixture();
    let (m, parts) = candidate(Product::Battle, false);
    let token = lib.stories().pending_begin(m).unwrap().token;
    lib.stories()
        .pending_append(&token, PendingKind::Input, 0, &parts[0].1.as_bytes()[..8])
        .unwrap();
    let connection = lock_connection(lib.connection()).unwrap();
    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        let token_ref = &token;
        let abort = scope.spawn(|| {
            lib.stories()
                .pending_abort_with_hook(token_ref, &mut || locked_tx.send(()).unwrap())
        });
        locked_rx.recv().unwrap();
        assert!(
            lib.stories().pending_inputs.try_lock().is_err(),
            "abort must retain the buffer mutex while blocked on SQLite"
        );
        let append = scope.spawn(|| {
            lib.stories().pending_append(
                token_ref,
                PendingKind::Input,
                8,
                &parts[0].1.as_bytes()[8..16],
            )
        });
        drop(connection);
        abort.join().unwrap().unwrap();
        assert_eq!(append.join().unwrap(), Err(StoryError::Stale));
    });
    assert!(lib.stories().pending_inputs.lock().unwrap().is_empty());
    assert_eq!(
        upload_reservations(&lock_connection(lib.connection()).unwrap()).unwrap(),
        (0, 0)
    );
}

#[test]
fn pending_strictness_does_not_relax_inside_the_legacy_commit_manifest() {
    let mut value = serde_json::to_value(candidate(Product::Battle, true).0).unwrap();
    value["commitManifest"]
        .as_object_mut()
        .unwrap()
        .remove("expectedLastChapterId");
    assert!(serde_json::from_value::<PendingManifest>(value).is_err());
}
#[test]
fn backup_audit_rejects_corrupt_active_and_nonzero_unvalidated_json_upload() {
    for active in [false, true] {
        let (_root, lib) = fixture();
        let (m, parts) = candidate(Product::Battle, false);
        let token = if active {
            let t = upload(lib.stories(), &m, &parts);
            lib.stories().pending_seal(&t).unwrap();
            t
        } else {
            lib.stories().pending_begin(m).unwrap().token
        };
        {
            let conn = lock_connection(lib.connection()).unwrap();
            let (id, _, _, _) = part_row(&conn, &token, PendingKind::Input).unwrap();
            let mut blob = conn
                .blob_open("main", "arena_story_pending_part", "payload", id, false)
                .unwrap();
            blob.write_all(b"SECRET_CANARY").unwrap();
        }
        assert_eq!(
            audit(&lock_connection(lib.connection()).unwrap()),
            Err(StoryError::Corrupt)
        );
        assert!(crate::backup::create_backup(&lib).is_err());
        assert_eq!(
            lib.stories()
                .pending_describe(Product::Battle)
                .unwrap()
                .is_some(),
            active
        );
    }
}

fn golden_candidates() -> Vec<(PendingManifest, Vec<(PendingKind, String)>)> {
    let golden: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-story-pending-storage.json"
    ))
    .unwrap();
    let telemetry: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-story-pending-telemetry.json"
    ))
    .unwrap();
    golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(telemetry["cases"].as_array().unwrap().iter())
        .map(|case| {
            let commit: CommitManifest = serde_json::from_value(case["manifest"].clone()).unwrap();
            let original = &case["originals"];
            let input = &original["input"];
            let mut parts = vec![(PendingKind::Input, input.to_string())];
            for (kind, name) in [
                (PendingKind::Markdown, "markdown"),
                (PendingKind::Reasoning, "reasoning"),
            ] {
                if let Some(text) = original[name].as_str().filter(|s| !s.is_empty()) {
                    parts.push((kind, text.into()));
                }
            }
            for (kind, name) in [
                (PendingKind::Meta, "meta"),
                (PendingKind::Header, "header"),
                (PendingKind::RoleResponse, "roleResponse"),
                (PendingKind::Telemetry, "telemetry"),
            ] {
                if original.get(name).is_some() {
                    parts.push((kind, original[name].to_string()));
                }
            }
            for part in case["parts"].as_array().unwrap() {
                parts.push((
                    PendingKind::parse(part["kind"].as_str().unwrap()).unwrap(),
                    part["document"].as_str().unwrap().into(),
                ));
            }
            let chapter: serde_json::Value = serde_json::from_str(
                &parts
                    .iter()
                    .find(|(k, _)| *k == PendingKind::Chapter)
                    .unwrap()
                    .1,
            )
            .unwrap();
            let checkpoint: serde_json::Value = serde_json::from_str(
                &parts
                    .iter()
                    .find(|(k, _)| *k == PendingKind::Checkpoint0)
                    .unwrap()
                    .1,
            )
            .unwrap();
            let output: serde_json::Value = serde_json::from_str(
                &parts
                    .iter()
                    .find(|(k, _)| *k == PendingKind::Checkpoint1)
                    .unwrap()
                    .1,
            )
            .unwrap();
            let state: RoleState = serde_json::from_value(case["roleState"].clone()).unwrap();
            let mut m = PendingManifest {
                version: 1,
                product: Product::Battle,
                request_id: input["generationRequestId"].as_str().unwrap().into(),
                actor: Actor::Anonymous,
                pending_revision: 1,
                session_id: commit.session_id.clone(),
                operation_id: commit.operation_id.clone(),
                output_checkpoint_id: output["id"].as_str().unwrap().into(),
                initial_checkpoint_id: Some(checkpoint["id"].as_str().unwrap().into()),
                created_at: chapter["createdAt"].as_u64().unwrap(),
                expected_revision: 0,
                expected_last_chapter_id: None,
                last_input_checkpoint_id: checkpoint["id"].as_str().unwrap().into(),
                input_digest: digest(parts[0].1.as_bytes()),
                write_options: WriteOptions {
                    write_arena_history: input["seed"]["settings"]["writeArenaHistory"]
                        .as_bool()
                        .unwrap(),
                    write_current_state: input["seed"]["settings"]["writeCurrentState"]
                        .as_bool()
                        .unwrap(),
                    write_narrative_history: input["seed"]["settings"]["writeNarrativeHistory"]
                        .as_bool()
                        .unwrap(),
                },
                model_completed: true,
                role_state: state,
                role_input_digest: if state == RoleState::NotRequested {
                    None
                } else {
                    Some(digest(
                        input["chapterContext"]["workingCombatants"]
                            .to_string()
                            .as_bytes(),
                    ))
                },
                parts: vec![],
                commit_manifest: Some(commit),
            };
            refresh(&mut m, &parts);
            assert_eq!(
                m.commit_manifest.as_ref().unwrap().wire_digest().unwrap(),
                case["wireDigest"].as_str().unwrap()
            );
            (m, parts)
        })
        .collect()
}
#[test]
fn real_shared_projection_and_storage_wire_preserve_content_roles_and_warning_originals() {
    for (m, parts) in golden_candidates() {
        let (root, lib) = fixture();
        let token = upload(lib.stories(), &m, &parts);
        lib.stories().pending_seal(&token).unwrap();
        let wire = m.commit_manifest.as_ref().unwrap().wire_digest().unwrap();
        let attempt = lib.stories().pending_prepare_save(&m.key(), &wire).unwrap();
        lib.stories()
            .pending_save(&m.key(), &wire, &attempt.attempt_id)
            .unwrap();
        drop(lib);
        let lib = LocalLibrary::open(root.path()).unwrap();
        let conn = lock_connection(lib.connection()).unwrap();
        for kind in [PendingKind::Chapter, PendingKind::Checkpoint1] {
            let original = &parts.iter().find(|(k, _)| *k == kind).unwrap().1;
            let sql = if kind == PendingKind::Chapter {
                "SELECT document FROM arena_story_chapter WHERE id=?1"
            } else {
                "SELECT document FROM arena_story_checkpoint WHERE id=?1"
            };
            let id = if kind == PendingKind::Chapter {
                &m.operation_id
            } else {
                &m.output_checkpoint_id
            };
            let actual: String = conn.query_row(sql, [id], |r| r.get(0)).unwrap();
            assert_eq!(&actual, original);
        }
        audit(&conn).unwrap();
    }
}
#[test]
fn missing_truncated_swapped_or_downgraded_content_never_replaces_saved_originals() {
    for fault in [
        "reasoning",
        "meta-extension",
        "header",
        "role-index",
        "warnings",
        "unchanged-role",
    ] {
        let (root, lib) = fixture();
        let (mut m, mut parts) = golden_candidates().remove(0);
        let mut original = m.clone();
        original.commit_manifest = None;
        let originals: Vec<_> = parts
            .iter()
            .filter(|(k, _)| k.commit().is_none())
            .cloned()
            .collect();
        refresh(&mut original, &originals);
        let token = upload(lib.stories(), &original, &originals);
        lib.stories().pending_seal(&token).unwrap();
        let kind = if matches!(fault, "role-index" | "unchanged-role") {
            PendingKind::Checkpoint1
        } else {
            PendingKind::Chapter
        };
        let part = parts.iter_mut().find(|(k, _)| *k == kind).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&part.1).unwrap();
        match fault {
            "reasoning" => value["cardSnapshot"]["aiReasoning"]["text"] = json!("cut"),
            "meta-extension" => {
                value["reportJson"] = json!({});
            }
            "header" => value["cardSnapshot"]["userGuidance"] = json!("changed"),
            "role-index" => value["combatants"].as_array_mut().unwrap().swap(0, 2),
            "warnings" => value["cardSnapshot"]["storyRoleSync"]["warnings"] = json!([]),
            "unchanged-role" => value["combatants"][1]["data"] = json!({"lost":true}),
            _ => unreachable!(),
        }
        part.1 = value.to_string();
        m.pending_revision = 2;
        refresh(&mut m, &parts);
        let token = upload(lib.stories(), &m, &parts);
        assert_eq!(
            lib.stories().pending_seal(&token),
            Err(StoryError::OriginalsUncovered),
            "{fault}"
        );
        drop(lib);
        let lib = LocalLibrary::open(root.path()).unwrap();
        assert_eq!(
            lib.stories()
                .pending_describe(Product::Battle)
                .unwrap()
                .unwrap()
                .manifest,
            original
        );
    }
}

#[test]
fn actual_rollback_failure_fences_uncommitted_receipts_until_database_reopen() {
    use std::ffi::{c_char, c_int, c_void, CStr};
    // Real SQLite authorization failure, not a simulated returned StoryError.
    // The callback is static and retains no borrowed data beyond this invocation.
    unsafe extern "C" fn deny_rollback(
        _: *mut c_void,
        action: c_int,
        first: *const c_char,
        _: *const c_char,
        _: *const c_char,
        _: *const c_char,
    ) -> c_int {
        if action == rusqlite::ffi::SQLITE_TRANSACTION
            && !first.is_null()
            && unsafe { CStr::from_ptr(first) }.to_bytes() == b"ROLLBACK"
        {
            rusqlite::ffi::SQLITE_DENY
        } else {
            rusqlite::ffi::SQLITE_OK
        }
    }
    let (root, lib) = fixture();
    let (key, wire) = frozen(lib.stories());
    let attempt = lib.stories().pending_prepare_save(&key, &wire).unwrap();
    {
        let connection = lock_connection(lib.connection()).unwrap();
        // SAFETY: this live handle stays under the shared connection mutex while
        // installing a stateless function pointer; no concurrent SQLite call occurs.
        assert_eq!(
            unsafe {
                rusqlite::ffi::sqlite3_set_authorizer(
                    connection.handle(),
                    Some(deny_rollback),
                    std::ptr::null_mut(),
                )
            },
            rusqlite::ffi::SQLITE_OK
        );
    }
    assert_eq!(
        lib.stories()
            .pending_save_with_hook(&key, &wire, &attempt.attempt_id, &mut |point| {
                if point == "pending-removed" {
                    Err(StoryError::Io)
                } else {
                    Ok(())
                }
            }),
        Err(StoryError::CommitUnknown)
    );
    {
        // Test-only raw lock observes the dangerous state that every public store
        // boundary must reject: a receipt exists only in the uncommitted transaction.
        let connection = lib.connection().lock().unwrap();
        assert!(!connection.is_autocommit());
        assert!(read_receipt(&connection, "story", "story-chapter-1")
            .unwrap()
            .is_some());
    }
    assert_eq!(
        lib.stories().receipt("story", "story-chapter-1"),
        Err(StoryError::ConnectionUnresolved)
    );
    assert_eq!(
        lib.stories().pending_describe(Product::Battle),
        Err(StoryError::ConnectionUnresolved)
    );
    let failure = lock_connection(lib.connection()).unwrap_err();
    assert_eq!(failure, crate::store::StoreError::TransactionUnresolved);
    assert_eq!(failure.code(), "store-failure");
    assert!(failure.message().contains("restart"));
    let failure = serde_json::to_value(StoryError::ConnectionUnresolved).unwrap();
    assert_eq!(failure["code"], "story-commit-unknown");
    assert_eq!(failure["writeEvidence"], "unknown");
    assert!(failure["message"].as_str().unwrap().contains("重启"));
    drop(lib);
    let lib = LocalLibrary::open(root.path()).unwrap();
    assert!(lib
        .stories()
        .receipt("story", "story-chapter-1")
        .unwrap()
        .is_none());
    let snapshot = lib
        .stories()
        .pending_describe(Product::Battle)
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.save_attempt_id, Some(attempt.attempt_id));
    assert_eq!(
        lib.stories().pending_prepare_save(&key, &wire),
        Err(StoryError::CommitUnknown)
    );
}

#[test]
fn duplicate_closed_carrier_keys_never_reach_blob_or_replace_active() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-story-pending-content.json"
    ))
    .unwrap();
    for case in fixtures["invalidRawCarriers"].as_array().unwrap() {
        let (root, lib) = fixture();
        let kind = PendingKind::parse(case["kind"].as_str().unwrap()).unwrap();
        let (mut next, mut parts) = golden_candidates().remove(0);
        let mut old = next.clone();
        old.product = if kind == PendingKind::Input {
            Product::Arena
        } else {
            Product::Battle
        };
        old.commit_manifest = None;
        old.model_completed = false;
        old.role_state = RoleState::NotRequested;
        old.role_input_digest = None;
        let old_parts = vec![parts[0].clone()];
        refresh(&mut old, &old_parts);
        let token = upload(lib.stories(), &old, &old_parts);
        lib.stories().pending_seal(&token).unwrap();
        next.pending_revision = if old.product == next.product { 2 } else { 1 };
        let document = case["document"].as_str().unwrap();
        parts.iter_mut().find(|(k, _)| *k == kind).unwrap().1 = document.into();
        refresh(&mut next, &parts);
        let token = lib.stories().pending_begin(next).unwrap().token;
        assert_eq!(
            lib.stories()
                .pending_append(&token, kind, 0, document.as_bytes()),
            Err(StoryError::Invalid),
            "{}",
            case["name"]
        );
        {
            let connection = lock_connection(lib.connection()).unwrap();
            let (id, length, received, _) = part_row(&connection, &token, kind).unwrap();
            assert_eq!(received, 0);
            let mut blob = connection
                .blob_open("main", "arena_story_pending_part", "payload", id, true)
                .unwrap();
            let mut bytes = vec![1; length as usize];
            blob.read_exact(&mut bytes).unwrap();
            assert!(
                bytes.iter().all(|b| *b == 0),
                "unvalidated duplicate carrier bytes were persisted"
            );
        }
        drop(lib);
        let lib = LocalLibrary::open(root.path()).unwrap();
        assert_eq!(
            lib.stories()
                .pending_describe(old.product)
                .unwrap()
                .unwrap()
                .manifest,
            old
        );
        assert_eq!(
            upload_reservations(&lock_connection(lib.connection()).unwrap()).unwrap(),
            (0, 0)
        );
    }
}

#[test]
fn opaque_user_json_duplicate_keys_and_lone_surrogates_remain_original_bytes() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/desktop-story-pending-content.json"
    ))
    .unwrap();
    let document = fixtures["validOpaqueRawInput"].as_str().unwrap();
    let (root, lib) = fixture();
    let (mut m, _) = golden_candidates().remove(0);
    m.commit_manifest = None;
    m.model_completed = false;
    m.role_state = RoleState::NotRequested;
    m.role_input_digest = None;
    let parts = vec![(PendingKind::Input, document.to_string())];
    refresh(&mut m, &parts);
    let token = upload(lib.stories(), &m, &parts);
    lib.stories().pending_seal(&token).unwrap();
    drop(lib);
    let lib = LocalLibrary::open(root.path()).unwrap();
    assert_eq!(
        lib.stories()
            .pending_read(&m.key(), PendingKind::Input, 0, document.len())
            .unwrap(),
        document.as_bytes()
    );
}

fn unstarted(product: Product) -> (PendingManifest, Vec<(PendingKind, String)>) {
    let (mut m, parts) = candidate(product, false);
    m.model_completed = false;
    (m, parts)
}
fn native_funding() -> NativeFunding {
    NativeFunding {
        mode: FundingMode::System,
        provider_id: "system".into(),
        model_id: "default".into(),
        generation_overrides: None,
    }
}
#[test]
fn native_claim_is_single_use_durable_and_survives_revision_without_token_binding() {
    let (root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = unstarted(Product::Battle);
    let token = upload(store, &m, &parts);
    store.pending_seal(&token).unwrap();
    let guard = store.pending_admission(m.product).unwrap();
    let original = store
        .pending_native_input(&guard, &m.key(), &m.actor, &m.input_digest)
        .unwrap();
    assert_eq!(original.input, parts[0].1);
    let permit = store
        .pending_claim_create(
            &guard,
            &m.key(),
            &m.actor,
            &m.input_digest,
            &"a".repeat(64),
            native_funding(),
        )
        .unwrap();
    assert_eq!(
        store
            .pending_claim_create(
                &guard,
                &m.key(),
                &m.actor,
                &m.input_digest,
                &"a".repeat(64),
                native_funding()
            )
            .err(),
        Some(StoryError::Conflict)
    );
    let claim = store
        .pending_consume_create(&guard, &m.key(), &m.actor, &m.input_digest, permit)
        .unwrap();
    drop(guard);
    let mut next = m.clone();
    next.pending_revision = 2;
    let token2 = upload(store, &next, &parts);
    assert_ne!(token, token2);
    let snapshot = store.pending_seal(&token2).unwrap();
    assert_eq!(snapshot.create_claim, Some(claim.clone()));
    let guard = store.pending_admission(m.product).unwrap();
    assert_eq!(
        store
            .pending_native_input(&guard, &m.key(), &m.actor, &m.input_digest)
            .err(),
        Some(StoryError::Stale)
    );
    let observed = store
        .pending_observe_generation(
            &guard,
            &next.key(),
            &m.actor,
            &m.input_digest,
            &claim.attempt_id,
            ("generation-story-1", Some(&"b".repeat(64))),
        )
        .unwrap();
    assert_eq!(
        store.pending_observe_generation(
            &guard,
            &next.key(),
            &m.actor,
            &m.input_digest,
            &claim.attempt_id,
            ("generation-other", None)
        ),
        Err(StoryError::Conflict)
    );
    assert_eq!(
        store.pending_observe_generation(
            &guard,
            &next.key(),
            &m.actor,
            &m.input_digest,
            &claim.attempt_id,
            ("generation-story-1", Some(&"c".repeat(64)))
        ),
        Err(StoryError::Conflict)
    );
    assert_eq!(
        store
            .pending_observe_generation(
                &guard,
                &next.key(),
                &m.actor,
                &m.input_digest,
                &claim.attempt_id,
                ("generation-story-1", None)
            )
            .unwrap(),
        observed
    );
    drop(guard);
    drop(lib);
    let reopened = LocalLibrary::open(root.path()).unwrap();
    let store = reopened.stories();
    let guard = store.pending_admission(m.product).unwrap();
    assert_eq!(
        store
            .pending_describe_admitted(&guard)
            .unwrap()
            .unwrap()
            .create_claim,
        Some(observed)
    );
    assert_eq!(
        store
            .pending_claim_create(
                &guard,
                &next.key(),
                &m.actor,
                &m.input_digest,
                &"a".repeat(64),
                native_funding()
            )
            .err(),
        Some(StoryError::Conflict)
    );
}
#[test]
fn native_claim_before_post_failure_never_reissues_permit_and_checks_identity() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = unstarted(Product::Arena);
    let token = upload(store, &m, &parts);
    store.pending_seal(&token).unwrap();
    let wrong_guard = store.pending_admission(Product::Battle).unwrap();
    assert_eq!(
        store
            .pending_native_input(&wrong_guard, &m.key(), &m.actor, &m.input_digest)
            .err(),
        Some(StoryError::Stale)
    );
    drop(wrong_guard);
    let guard = store.pending_admission(m.product).unwrap();
    assert_eq!(
        store
            .pending_native_input(
                &guard,
                &m.key(),
                &Actor::Account {
                    expected_user_id: 7
                },
                &m.input_digest
            )
            .err(),
        Some(StoryError::Stale)
    );
    let permit = store
        .pending_claim_create(
            &guard,
            &m.key(),
            &m.actor,
            &m.input_digest,
            &"a".repeat(64),
            native_funding(),
        )
        .unwrap();
    drop(permit); // Failure after durable claim, before even one POST.
    assert_eq!(
        store
            .pending_claim_create(
                &guard,
                &m.key(),
                &m.actor,
                &m.input_digest,
                &"a".repeat(64),
                native_funding()
            )
            .err(),
        Some(StoryError::Conflict)
    );
}
#[test]
fn native_claim_metadata_budget_is_checked_before_any_write() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = unstarted(Product::Battle);
    let token = upload(store, &m, &parts);
    store.pending_seal(&token).unwrap();
    let mut metadata = serde_json::to_string(&m).unwrap();
    metadata.push_str(&" ".repeat(METADATA_BYTES - metadata.len()));
    lock_connection(lib.connection())
        .unwrap()
        .execute(
            "UPDATE arena_story_pending SET metadata=?2 WHERE token=?1",
            params![token, metadata],
        )
        .unwrap();
    let before = store.pending_describe(m.product).unwrap();
    let guard = store.pending_admission(m.product).unwrap();
    assert_eq!(
        store
            .pending_claim_create(
                &guard,
                &m.key(),
                &m.actor,
                &m.input_digest,
                &"a".repeat(64),
                native_funding()
            )
            .err(),
        Some(StoryError::TooLarge)
    );
    assert_eq!(store.pending_describe_admitted(&guard).unwrap(), before);
    let raw: String = lock_connection(lib.connection())
        .unwrap()
        .query_row(
            "SELECT metadata FROM arena_story_pending WHERE token=?1",
            [&token],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, metadata);
}
#[test]
fn schema_six_active_pending_audits_without_new_column_then_migrates() {
    let (_root, lib) = fixture();
    let (m, parts) = unstarted(Product::Battle);
    let token = upload(lib.stories(), &m, &parts);
    lib.stories().pending_seal(&token).unwrap();
    let old = Connection::open_in_memory().unwrap();
    crate::store::migrate_to_version_for_test(&old, 6);
    old.execute("INSERT INTO arena_story_pending(token,product,request_id,revision,active,metadata,total_bytes) VALUES(?1,'battle',?2,1,1,?3,?4)", params![token,m.request_id,serde_json::to_string(&m).unwrap(),m.validate().unwrap()]).unwrap();
    for (kind, body) in parts {
        old.execute("INSERT INTO arena_story_pending_part(token,kind,byte_length,received_bytes,digest,payload) VALUES(?1,?2,?3,?3,?4,?5)", params![token,kind.sql(),body.len() as u64,digest(body.as_bytes()),body.as_bytes()]).unwrap();
    }
    audit(&old).unwrap();
    crate::store::migrate(&old).unwrap();
    audit(&old).unwrap();
    assert!(active(&old, Product::Battle)
        .unwrap()
        .unwrap()
        .snapshot
        .create_claim
        .is_none());
}

#[test]
fn telemetry_preserves_original_shape_null_boolean_and_success_only_domain() {
    let m = candidate(Product::Battle, false).0;
    for raw in [
        r#"{}"#,
        r#"{"version":1,"aiModel":"custom / arbitrary model","usage":{"promptTokens":null,"completionTokens":0,"reasoningTokens":2e1,"cachedTokens":9007199254740991,"completionTokensIncludesReasoning":false},"narrativeHistoryReadCount":0}"#,
        r#"{"aiModel":"\ud800"}"#,
        r#"{"narrativeHistoryReadCount":1e30}"#,
    ] {
        validate_carrier(raw.as_bytes(), PendingKind::Telemetry, &m).unwrap();
    }
    for raw in [
        r#"{"reportFormat":"markdown","narrativeHistoryReadCount":1e30}"#,
        r#"{"reportFormat":"markdown","narrativeHistoryReadCount":2e1}"#,
    ] {
        validate_carrier(raw.as_bytes(), PendingKind::Header, &m).unwrap();
    }
    let big_model = json!({"aiModel":"m".repeat(65537)}).to_string();
    validate_carrier(big_model.as_bytes(), PendingKind::Telemetry, &m).unwrap();
    for raw in [
        r#"{"errorClass":"upstream"}"#,
        r#"{"usage":{"promptTokens":-1}}"#,
        r#"{"usage":{"totalTokens":9007199254740992}}"#,
        r#"{"usage":{"completionTokensIncludesReasoning":null}}"#,
        r#"{"version":2}"#,
        r#"{"usage":{"apiKey":"SECRET"}}"#,
        r#"{"aiModel":null}"#,
        r#"{"narrativeHistoryReadCount":null}"#,
        r#"{"usage":{"promptTokens":1,"promptTokens":2}}"#,
    ] {
        assert!(
            validate_carrier(raw.as_bytes(), PendingKind::Telemetry, &m).is_err(),
            "{raw}"
        );
    }
}
fn telemetry_candidate(frozen: bool, count: u64) -> (PendingManifest, Vec<(PendingKind, String)>) {
    let (mut m, mut parts) = candidate(Product::Battle, frozen);
    let telemetry = json!({"version":1,"aiModel":"m".repeat(300),"usage":{"promptTokens":null,"completionTokens":2,"completionTokensIncludesReasoning":false},"narrativeHistoryReadCount":count});
    parts.push((
        PendingKind::Header,
        json!({"reportFormat":"markdown","narrativeHistoryReadCount":4}).to_string(),
    ));
    parts.push((PendingKind::Telemetry, telemetry.to_string()));
    if frozen {
        let chapter = parts
            .iter_mut()
            .find(|(k, _)| *k == PendingKind::Chapter)
            .unwrap();
        let mut document: serde_json::Value = serde_json::from_str(&chapter.1).unwrap();
        document["cardSnapshot"]["aiModel"] = telemetry["aiModel"].clone();
        document["cardSnapshot"]["aiUsage"] = telemetry["usage"].clone();
        document["cardSnapshot"]["narrativeHistoryReadCount"] =
            telemetry["narrativeHistoryReadCount"].clone();
        chapter.1 = document.to_string();
    }
    parts.sort_by_key(|(kind, _)| kind.order());
    refresh(&mut m, &parts);
    (m, parts)
}
#[test]
fn telemetry_coverage_rejects_missing_null_boolean_or_conflicting_count_without_replacing_originals(
) {
    for mutation in ["none", "aiModel", "null", "boolean", "count"] {
        let (_root, lib) = fixture();
        let store = lib.stories();
        let (m, parts) = telemetry_candidate(false, if mutation == "count" { 5 } else { 4 });
        let token = upload(store, &m, &parts);
        let before = store.pending_seal(&token).unwrap();
        let (mut next, mut next_parts) =
            telemetry_candidate(true, if mutation == "count" { 5 } else { 4 });
        next.pending_revision = 2;
        let chapter = next_parts
            .iter_mut()
            .find(|(k, _)| *k == PendingKind::Chapter)
            .unwrap();
        let mut document: serde_json::Value = serde_json::from_str(&chapter.1).unwrap();
        match mutation {
            "aiModel" => {
                document["cardSnapshot"]
                    .as_object_mut()
                    .unwrap()
                    .remove("aiModel");
            }
            "null" => {
                document["cardSnapshot"]["aiUsage"]
                    .as_object_mut()
                    .unwrap()
                    .remove("promptTokens");
            }
            "boolean" => {
                document["cardSnapshot"]["aiUsage"]["completionTokensIncludesReasoning"] =
                    json!(true);
            }
            _ => {}
        }
        chapter.1 = document.to_string();
        refresh(&mut next, &next_parts);
        let token = upload(store, &next, &next_parts);
        if mutation == "none" {
            store.pending_seal(&token).unwrap();
            let wire = next
                .commit_manifest
                .as_ref()
                .unwrap()
                .wire_digest()
                .unwrap();
            let attempt = store.pending_prepare_save(&next.key(), &wire).unwrap();
            store
                .pending_save(&next.key(), &wire, &attempt.attempt_id)
                .unwrap();
        } else {
            assert_eq!(
                store.pending_seal(&token),
                Err(StoryError::OriginalsUncovered),
                "{mutation}"
            );
            assert_eq!(
                store.pending_describe(Product::Battle).unwrap(),
                Some(before)
            );
        }
    }
}

#[test]
fn native_exact_input_retains_lone_surrogate_json_bytes() {
    let (_root, lib) = fixture();
    let (mut m, mut parts) = unstarted(Product::Battle);
    parts[0].1 = parts[0].1.replace("角色", r"角色\ud800");
    refresh(&mut m, &parts);
    let token = upload(lib.stories(), &m, &parts);
    lib.stories().pending_seal(&token).unwrap();
    let guard = lib.stories().pending_admission(m.product).unwrap();
    let input = lib
        .stories()
        .pending_native_input(&guard, &m.key(), &m.actor, &m.input_digest)
        .unwrap();
    assert_eq!(input.input.as_bytes(), parts[0].1.as_bytes());
}
#[test]
fn restored_backup_retains_native_claim_and_never_authorizes_another_create() {
    let (root, lib) = fixture();
    let (m, parts) = unstarted(Product::Battle);
    let token = upload(lib.stories(), &m, &parts);
    lib.stories().pending_seal(&token).unwrap();
    let guard = lib.stories().pending_admission(m.product).unwrap();
    let permit = lib
        .stories()
        .pending_claim_create(
            &guard,
            &m.key(),
            &m.actor,
            &m.input_digest,
            &"a".repeat(64),
            native_funding(),
        )
        .unwrap();
    drop(permit);
    let claim = lib
        .stories()
        .pending_describe_admitted(&guard)
        .unwrap()
        .unwrap()
        .create_claim;
    drop(guard);
    let backup = crate::backup::create_backup(&lib).unwrap();
    let prepared = crate::restore::prepare_restore(&lib, &backup.backup_id).unwrap();
    drop(prepared);
    drop(lib);
    run_boundary_child(root.path(), "restore");
    let lib = LocalLibrary::open(root.path()).unwrap();
    let guard = lib.stories().pending_admission(m.product).unwrap();
    let snapshot = lib
        .stories()
        .pending_describe_admitted(&guard)
        .unwrap()
        .unwrap();
    assert!(snapshot.restored);
    assert_eq!(snapshot.create_claim, claim);
    assert_eq!(
        lib.stories()
            .pending_claim_create(
                &guard,
                &m.key(),
                &m.actor,
                &m.input_digest,
                &"a".repeat(64),
                native_funding()
            )
            .err(),
        Some(StoryError::CommitUnknown)
    );
    // Read-only evidence/original access remains possible after the restore fence.
    assert_eq!(
        lib.stories()
            .pending_native_input(&guard, &m.key(), &m.actor, &m.input_digest)
            .unwrap()
            .input,
        parts[0].1
    );
}

#[test]
fn native_claim_guard_is_store_bound_and_serializes_only_its_product() {
    let (_root, lib) = fixture();
    let (_other_root, other) = fixture();
    let store = lib.stories();
    let guard = store.pending_admission(Product::Battle).unwrap();
    assert_eq!(
        other.stories().pending_describe_admitted(&guard),
        Err(StoryError::Stale)
    );
    let arena = store.pending_admission(Product::Arena).unwrap();
    assert_eq!(arena.product(), Product::Arena);
    drop(arena);
    std::thread::scope(|scope| {
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (admitted_tx, admitted_rx) = std::sync::mpsc::channel();
        scope.spawn(move || {
            started_tx.send(()).unwrap();
            let _next = store.pending_admission(Product::Battle).unwrap();
            admitted_tx.send(()).unwrap();
        });
        started_rx.recv().unwrap();
        assert!(admitted_rx.recv_timeout(Duration::from_millis(20)).is_err());
        drop(guard);
        admitted_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    });
}
#[test]
fn native_claim_backup_audit_rejects_hidden_authority_and_unpublished_claims() {
    for fault in [
        "unknown",
        "duplicate",
        "null",
        "input",
        "inactive",
        "budget",
    ] {
        let (_root, lib) = fixture();
        let store = lib.stories();
        let (m, parts) = unstarted(Product::Battle);
        let token = upload(store, &m, &parts);
        store.pending_seal(&token).unwrap();
        let guard = store.pending_admission(m.product).unwrap();
        drop(
            store
                .pending_claim_create(
                    &guard,
                    &m.key(),
                    &m.actor,
                    &m.input_digest,
                    &"a".repeat(64),
                    native_funding(),
                )
                .unwrap(),
        );
        drop(guard);
        let connection = lock_connection(lib.connection()).unwrap();
        let original: String = connection
            .query_row(
                "SELECT create_claim FROM arena_story_pending WHERE token=?1",
                [&token],
                |r| r.get(0),
            )
            .unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&original).unwrap();
        match fault {
            "unknown" => value["funding"]["apiKey"] = json!("SECRET_CANARY"),
            "null" => value["funding"]["generationOverrides"] = serde_json::Value::Null,
            "input" => value["inputDigest"] = json!(format!("sha256:{}", "f".repeat(64))),
            _ => {}
        }
        let document = if fault == "duplicate" {
            original.replace("\"modelId\":\"default\"", "\"modelId\":\"default\",\"generationOverrides\":{\"temperature\":\"SECRET_CANARY\",\"temperature\":1}")
        } else if fault == "budget" {
            format!("{original}{}", " ".repeat(METADATA_BYTES))
        } else {
            value.to_string()
        };
        connection
            .execute(
                "UPDATE arena_story_pending SET create_claim=?2 WHERE token=?1",
                params![token, document],
            )
            .unwrap();
        if fault == "inactive" {
            connection
                .execute(
                    "UPDATE arena_story_pending SET active=0 WHERE token=?1",
                    [&token],
                )
                .unwrap();
        }
        assert!(audit(&connection).is_err(), "{fault}");
    }
}

#[test]
fn inherited_claim_budget_rejection_preserves_both_previous_active_and_upload() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = unstarted(Product::Battle);
    let token = upload(store, &m, &parts);
    store.pending_seal(&token).unwrap();
    let guard = store.pending_admission(m.product).unwrap();
    drop(
        store
            .pending_claim_create(
                &guard,
                &m.key(),
                &m.actor,
                &m.input_digest,
                &"a".repeat(64),
                native_funding(),
            )
            .unwrap(),
    );
    let before = store.pending_describe_admitted(&guard).unwrap();
    drop(guard);
    let mut next = m.clone();
    next.pending_revision = 2;
    let next_token = upload(store, &next, &parts);
    let mut metadata = serde_json::to_string(&next).unwrap();
    metadata.push_str(&" ".repeat(METADATA_BYTES - metadata.len()));
    lock_connection(lib.connection())
        .unwrap()
        .execute(
            "UPDATE arena_story_pending SET metadata=?2 WHERE token=?1",
            params![next_token, metadata],
        )
        .unwrap();
    assert_eq!(store.pending_seal(&next_token), Err(StoryError::TooLarge));
    assert_eq!(store.pending_describe(m.product).unwrap(), before);
    assert_eq!(store.pending_upload(&next_token).unwrap().manifest, next);
}
#[test]
fn native_accepted_role_originals_remain_readable_when_frozen_or_restored() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = golden_candidates().remove(0);
    assert_eq!(m.role_state, RoleState::Accepted);
    let expected = &parts
        .iter()
        .find(|(k, _)| *k == PendingKind::RoleResponse)
        .unwrap()
        .1;
    let token = upload(store, &m, &parts);
    store.pending_seal(&token).unwrap();
    let guard = store.pending_admission(m.product).unwrap();
    assert_eq!(
        store
            .pending_native_input(&guard, &m.key(), &m.actor, &m.input_digest)
            .unwrap()
            .role_response
            .as_deref(),
        Some(expected.as_str())
    );
    lock_connection(lib.connection())
        .unwrap()
        .execute(
            "UPDATE arena_story_pending SET restored=1 WHERE token=?1",
            [&token],
        )
        .unwrap();
    assert_eq!(
        store
            .pending_native_input(&guard, &m.key(), &m.actor, &m.input_digest)
            .unwrap()
            .role_response
            .as_deref(),
        Some(expected.as_str())
    );
}

#[test]
fn native_claim_reserves_unknown_generation_and_hash_before_any_dispatch() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let (m, parts) = unstarted(Product::Battle);
    let token = upload(store, &m, &parts);
    store.pending_seal(&token).unwrap();
    let hypothetical = CreateClaim {
        version: 1,
        attempt_id: format!("{}-{}", "0".repeat(32), "0".repeat(32)),
        story_protocol_version: "arena-story-v1".into(),
        input_digest: m.input_digest.clone(),
        client_body_hash: "a".repeat(64),
        funding: native_funding(),
        observed_generation: None,
    };
    let actual_claim_length = serde_json::to_string(&hypothetical).unwrap().len();
    let mut metadata = serde_json::to_string(&m).unwrap();
    metadata.push_str(&" ".repeat(METADATA_BYTES - actual_claim_length - metadata.len()));
    assert_eq!(metadata.len() + actual_claim_length, METADATA_BYTES);
    lock_connection(lib.connection())
        .unwrap()
        .execute(
            "UPDATE arena_story_pending SET metadata=?2 WHERE token=?1",
            params![token, metadata],
        )
        .unwrap();
    let guard = store.pending_admission(m.product).unwrap();
    assert_eq!(
        store
            .pending_claim_create(
                &guard,
                &m.key(),
                &m.actor,
                &m.input_digest,
                &"a".repeat(64),
                native_funding()
            )
            .err(),
        Some(StoryError::TooLarge)
    );
    assert!(store
        .pending_describe_admitted(&guard)
        .unwrap()
        .unwrap()
        .create_claim
        .is_none());
    // Exactly enough reserved space remains usable for the maximum observation.
    let mut reserved = serde_json::to_value(&hypothetical).unwrap();
    reserved["observedGeneration"] =
        json!({"generationId":"g".repeat(128),"serverPayloadHash":"b".repeat(64)});
    let reserve_length = reserved.to_string().len();
    let mut metadata = serde_json::to_string(&m).unwrap();
    metadata.push_str(&" ".repeat(METADATA_BYTES - reserve_length - metadata.len()));
    lock_connection(lib.connection())
        .unwrap()
        .execute(
            "UPDATE arena_story_pending SET metadata=?2 WHERE token=?1",
            params![token, metadata],
        )
        .unwrap();
    let permit = store
        .pending_claim_create(
            &guard,
            &m.key(),
            &m.actor,
            &m.input_digest,
            &"a".repeat(64),
            native_funding(),
        )
        .unwrap();
    let claim = store
        .pending_consume_create(&guard, &m.key(), &m.actor, &m.input_digest, permit)
        .unwrap();
    store
        .pending_observe_generation(
            &guard,
            &m.key(),
            &m.actor,
            &m.input_digest,
            &claim.attempt_id,
            (&"g".repeat(128), Some(&"b".repeat(64))),
        )
        .unwrap();
}

#[test]
fn native_observed_generation_binds_accepted_roles_and_frozen_chapter() {
    for fault in [
        "none",
        "missing-observation",
        "different-observation",
        "chapter-only",
        "accepted-unfrozen",
        "accepted-foreign-unfrozen",
    ] {
        let (_root, lib) = fixture();
        let store = lib.stories();
        let (mut final_manifest, mut final_parts) = golden_candidates().remove(0);
        let role: serde_json::Value = serde_json::from_str(
            &final_parts
                .iter()
                .find(|(k, _)| *k == PendingKind::RoleResponse)
                .unwrap()
                .1,
        )
        .unwrap();
        let generation = role["generationId"].as_str().unwrap();
        let mut initial = final_manifest.clone();
        initial.model_completed = false;
        initial.role_state = RoleState::NotRequested;
        initial.role_input_digest = None;
        initial.commit_manifest = None;
        let originals: Vec<_> = final_parts
            .iter()
            .filter(|(k, _)| k.commit().is_none() && *k != PendingKind::RoleResponse)
            .cloned()
            .collect();
        refresh(&mut initial, &originals);
        let token = upload(store, &initial, &originals);
        store.pending_seal(&token).unwrap();
        let guard = store.pending_admission(initial.product).unwrap();
        drop(
            store
                .pending_claim_create(
                    &guard,
                    &initial.key(),
                    &initial.actor,
                    &initial.input_digest,
                    &"a".repeat(64),
                    native_funding(),
                )
                .unwrap(),
        );
        let claim = store
            .pending_describe_admitted(&guard)
            .unwrap()
            .unwrap()
            .create_claim
            .unwrap();
        if !matches!(fault, "missing-observation" | "accepted-unfrozen") {
            let id = if matches!(fault, "different-observation" | "accepted-foreign-unfrozen") {
                "generation-other"
            } else {
                generation
            };
            store
                .pending_observe_generation(
                    &guard,
                    &initial.key(),
                    &initial.actor,
                    &initial.input_digest,
                    &claim.attempt_id,
                    (id, None),
                )
                .unwrap();
        }
        let before = store.pending_describe_admitted(&guard).unwrap();
        drop(guard);
        if fault == "chapter-only" {
            let chapter = final_parts
                .iter_mut()
                .find(|(k, _)| *k == PendingKind::Chapter)
                .unwrap();
            let mut document: serde_json::Value = serde_json::from_str(&chapter.1).unwrap();
            document["generationId"] = json!("generation-other");
            chapter.1 = document.to_string();
        }
        if matches!(fault, "accepted-unfrozen" | "accepted-foreign-unfrozen") {
            final_manifest.commit_manifest = None;
            final_parts.retain(|(kind, _)| kind.commit().is_none());
        }
        final_manifest.pending_revision = 2;
        refresh(&mut final_manifest, &final_parts);
        let token = upload(store, &final_manifest, &final_parts);
        if fault == "none" {
            store.pending_seal(&token).unwrap();
        } else {
            assert_eq!(
                store.pending_seal(&token),
                Err(StoryError::OriginalsUncovered),
                "{fault}"
            );
            assert_eq!(store.pending_describe(initial.product).unwrap(), before);
        }
    }
}

#[test]
fn native_memory_cancellation_uses_same_admission_during_maintenance() {
    let (_root, lib) = fixture();
    let store = lib.stories();
    let maintenance = lib.enter_maintenance("backup").unwrap();
    let cancel = store.pending_cancel_admission(Product::Battle).unwrap();
    assert!(matches!(
        store.pending_admission[0].try_lock(),
        Err(std::sync::TryLockError::WouldBlock)
    ));
    let other_product = store.pending_cancel_admission(Product::Arena).unwrap();
    drop(other_product);
    drop(cancel);
    assert_eq!(
        store.pending_admission(Product::Battle).err(),
        Some(StoryError::Maintenance)
    );
    drop(maintenance);
    assert!(store.pending_admission(Product::Battle).is_ok());
}

#[test]
fn raw_role_projection_keeps_selected_bytes_and_uses_json_parse_member_semantics() {
    let text = r#"{"\ud800":1,"\ud800":2,"data":{"name":"old"},"d\u0061ta":{"name":"new\ud800","apiKey":"business","x":1,"x":2},"isNative":false,"isNative":true,"extension":{"token":"opaque"}}"#;
    let raw = parse_raw(text).unwrap();
    let fields = raw_projection_fields(raw, &["data", "isNative", "source"]).unwrap();
    assert_eq!(fields.len(), 2);
    assert_eq!(
        fields["data"].get(),
        r#"{"name":"new\ud800","apiKey":"business","x":1,"x":2}"#
    );
    assert_eq!(fields["isNative"].get(), "true");
    assert!(raw_projection_fields(parse_raw("[]").unwrap(), &["data"]).is_err());
    assert!(
        raw_object(raw).is_err(),
        "closed authority parsing must still reject duplicate keys"
    );
}
