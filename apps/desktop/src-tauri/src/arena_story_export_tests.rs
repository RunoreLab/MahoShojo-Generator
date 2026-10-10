use super::*;
use crate::arena_story::{digest, CommitManifest, PartDeclaration, PartKind};
use crate::library::LocalLibrary;
use serde_json::{json, Value};

fn library() -> (tempfile::TempDir, LocalLibrary) {
    let root = tempfile::tempdir().unwrap();
    let library = LocalLibrary::open(root.path()).unwrap();
    commit(library.stories(), 1, json!({}));
    (root, library)
}

fn commit(store: &StoryStore, index: u64, snapshot: Value) {
    let chapter = format!("story-chapter-{index}");
    let checkpoint = format!("story-checkpoint-{index}");
    let input = format!("story-checkpoint-{}", index - 1);
    let previous = (index > 1).then(|| format!("story-chapter-{}", index - 1));
    let mut parts = vec![(
        PartKind::Session,
        json!({
            "id":"story","revision":index,"chapterCount":index,"lastChapterId":chapter,
            "workingCheckpointId":checkpoint,"lastInputCheckpointId":input,
            "title":"完整故事🙂","titlePreview":"完整故事🙂","titleTruncated":false,
            "mode":"classic","source":{"mode":"classic","language":"zh-CN"},
            "createdAt":1,"updatedAt":index
        })
        .to_string(),
    )];
    if index == 1 {
        parts.push((PartKind::Seed, json!({"combatants":[]}).to_string()));
    }
    parts.push((
        PartKind::Chapter,
        json!({
            "id":chapter,"sessionId":"story","index":index,
            "action":if index == 1 {"start"} else {"continue"},"sourceChapterId":previous,
            "status":"active","titlePreview":"标题","titleTruncated":false,
            "createdAt":index,"markdownByteLength":5,"markdown":"A🙂",
            "reportJson":{},"deterministicDigest":{},"cardSnapshot":snapshot
        })
        .to_string(),
    ));
    if index == 1 {
        parts.push((
            PartKind::Checkpoint0,
            json!({
                "id":input,"sessionId":"story","boundaryIndex":0,"combatants":[]
            })
            .to_string(),
        ));
    }
    parts.push((
        PartKind::Checkpoint1,
        json!({
            "id":checkpoint,"sessionId":"story","boundaryIndex":index,
            "chapterId":chapter,"combatants":[]
        })
        .to_string(),
    ));
    let manifest = CommitManifest {
        version: 1,
        operation_id: chapter,
        session_id: "story".into(),
        expected_revision: index - 1,
        expected_last_chapter_id: previous,
        parts: parts
            .iter()
            .map(|(kind, document)| PartDeclaration {
                kind: *kind,
                byte_length: document.len() as u64,
                digest: digest(document.as_bytes()),
            })
            .collect(),
    };
    let now = Instant::now();
    let token = store.begin(manifest, now).unwrap().token;
    for (kind, document) in parts {
        store
            .append(&token, kind, 0, document.as_bytes(), now)
            .unwrap();
    }
    store.end(&token, now).unwrap();
}

fn manifest(bytes: &[u8], index: u64) -> StoryMarkdownExportManifest {
    StoryMarkdownExportManifest {
        session_id: "story".into(),
        revision: index,
        expected_head: format!("story-chapter-{index}"),
        chapter_count: index,
        expected_byte_length: bytes.len() as u64,
    }
}

fn begin(store: &StoryStore, bytes: &[u8], now: Instant) -> String {
    store
        .begin_markdown_export(manifest(bytes, 1), now)
        .unwrap()
        .token
}

fn entries(root: &Path) -> Vec<PathBuf> {
    fs::read_dir(root.join("exports"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect()
}

fn target(store: &StoryStore) -> PathBuf {
    store
        .markdown_export
        .session
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .target
        .clone()
}

#[test]
fn exact_raw_bytes_hash_and_publication_only_after_explicit_end() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let bytes = "# 故事🙂\n\0second\n".as_bytes();
    let token = begin(store, bytes, now);
    assert!(token.starts_with(&format!("{}-", store.instance)));
    assert_eq!(token.len(), 65);
    assert!(token.split('-').all(|part| part.len() == 32
        && part
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())));
    let final_path = target(store);
    for (number, chunk) in bytes.chunks(3).enumerate() {
        assert_eq!(
            store
                .append_markdown_export(&token, (number * 3) as u64, chunk, now)
                .unwrap()
                .received_bytes,
            (number * 3 + chunk.len()) as u64
        );
        assert!(!final_path.exists());
    }
    assert_eq!(entries(root.path()).len(), 1);
    let result = store
        .end_markdown_export(&token, &digest(bytes), now)
        .unwrap();
    assert_eq!(result.token, token);
    assert_eq!(result.byte_length, bytes.len() as u64);
    assert_eq!(Path::new(&result.absolute_path), final_path);
    assert!(final_path.is_absolute());
    assert_eq!(fs::read(final_path).unwrap(), bytes);
    assert_eq!(entries(root.path()).len(), 1);
    assert_eq!(
        store.end_markdown_export(&token, &digest(b"abc"), now),
        Err(StoryError::Stale)
    );
}

#[test]
fn busy_wrong_and_old_tokens_preserve_current_export() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let old = begin(store, b"first", now);
    assert_eq!(
        store.begin_markdown_export(manifest(b"new", 1), now),
        Err(StoryError::Busy)
    );
    store.abort_markdown_export(&old).unwrap();
    assert!(entries(root.path()).is_empty());
    let current = begin(store, b"second", now);
    assert_eq!(
        store.append_markdown_export(&old, 0, b"late", now),
        Err(StoryError::Stale)
    );
    assert_eq!(
        store.end_markdown_export(&old, &digest(b"first"), now),
        Err(StoryError::Stale)
    );
    store.abort_markdown_export(&old).unwrap();
    assert_eq!(
        store.expire_markdown_export(&old, now + IDLE_TIMEOUT),
        Ok(None)
    );
    store
        .append_markdown_export(&current, 0, b"second", now)
        .unwrap();
    assert!(store
        .end_markdown_export(&current, &digest(b"second"), now)
        .is_ok());
}

#[test]
fn offset_empty_frame_and_declared_length_rejections_do_not_write() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let token = begin(store, b"abc", now);
    assert_eq!(
        store.append_markdown_export(&token, 1, b"a", now),
        Err(StoryError::Invalid)
    );
    assert_eq!(
        store.append_markdown_export(&token, 0, b"", now),
        Err(StoryError::TooLarge)
    );
    assert_eq!(
        store.append_markdown_export(&token, 0, &vec![0; CANDIDATE_FRAME_BYTES + 1], now),
        Err(StoryError::TooLarge)
    );
    assert_eq!(
        store.append_markdown_export(&token, 0, b"abcd", now),
        Err(StoryError::TooLarge)
    );
    assert_eq!(fs::metadata(&entries(root.path())[0]).unwrap().len(), 0);
    assert_eq!(
        store.end_markdown_export(&token, &digest(b"abc"), now),
        Err(StoryError::Incomplete)
    );
    store
        .append_markdown_export(&token, 0, b"abc", now)
        .unwrap();
    assert!(store
        .end_markdown_export(&token, &digest(b"abc"), now)
        .is_ok());
}

#[test]
fn begin_validates_scope_digest_safe_integer_and_derived_budget() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    for mutation in [0, 1, 2, 3, 4, 5] {
        let mut request = manifest(b"a", 1);
        let expected = match mutation {
            0 => {
                request.revision = 2;
                StoryError::Stale
            }
            1 => {
                request.expected_head = "different".into();
                StoryError::Stale
            }
            2 => {
                request.chapter_count = 2;
                StoryError::Stale
            }
            3 => {
                request.expected_byte_length = MAX_SAFE_INTEGER + 1;
                StoryError::TooLarge
            }
            4 => {
                request.expected_byte_length = 0;
                StoryError::Invalid
            }
            _ => {
                request.expected_byte_length = 1_000_000;
                StoryError::TooLarge
            }
        };
        assert_eq!(store.begin_markdown_export(request, now), Err(expected));
        assert!(entries(root.path()).is_empty());
    }
}

#[test]
fn depth_bound_is_fixed_path_floored_finite_numeric_and_saturating() {
    let (_root, library) = library();
    let store = library.stories();
    commit(
        store,
        2,
        json!({"adjudicationResults":[
        null, "not JSON", 2, true, [], {}, {"depth":"900"}, {"depth":-9},
        {"depth":2.9}, {"depth":3}, {"nested":{"depth":900000}}, {"depth":0}
    ],"unknown":{"depth":900000}}),
    );
    let connection = lock_connection(&store.connection).unwrap();
    let raw: u64 = connection.query_row("SELECT (SELECT sum(document_bytes) FROM arena_story_chapter WHERE session_id='story')+(SELECT document_bytes FROM arena_story_session WHERE id='story')", [], |row| row.get(0)).unwrap();
    assert_eq!(
        derived_byte_bound(&connection, &manifest(b"a", 2)).unwrap(),
        raw + 4096 + 64 * (2 + 12) + 4 * 5
    );
    drop(connection);
    commit(store, 3, json!({"adjudicationResults":[{"depth":1e300}]}));
    assert_eq!(
        derived_byte_bound(
            &lock_connection(&store.connection).unwrap(),
            &manifest(b"a", 3)
        ),
        Ok(MAX_SAFE_INTEGER)
    );
    let request = StoryMarkdownExportManifest {
        expected_byte_length: MAX_SAFE_INTEGER,
        ..manifest(b"a", 3)
    };
    let token = store
        .begin_markdown_export_with_space(request, Instant::now(), &mut |_| Ok(MAX_SAFE_INTEGER))
        .unwrap()
        .token;
    store.abort_markdown_export(&token).unwrap();
}

#[test]
fn missing_and_malformed_optional_adjudication_fields_do_not_throw_sql_json_errors() {
    let (_root, library) = library();
    let store = library.stories();
    let snapshots = [
        Value::Null,
        json!("text"),
        json!({"adjudicationResults":null}),
        json!({"adjudicationResults":"not JSON"}),
        json!({"adjudicationResults":{}}),
        json!({"adjudicationResults":[{"depth":{}},{"depth":[]},{"depth":true}]}),
    ];
    for (position, snapshot) in snapshots.into_iter().enumerate() {
        let index = position as u64 + 2;
        commit(store, index, snapshot);
        let token = store
            .begin_markdown_export(manifest(b"a", index), Instant::now())
            .unwrap()
            .token;
        store.abort_markdown_export(&token).unwrap();
    }
}

#[test]
fn nonfinite_sql_numeric_depth_adds_no_spaces() {
    let (_root, library) = library();
    let store = library.stories();
    let connection = lock_connection(&store.connection).unwrap();
    let document: String = connection
        .query_row(
            "SELECT document FROM arena_story_chapter WHERE id='story-chapter-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let document = document.replace(
        "\"cardSnapshot\":{}",
        "\"cardSnapshot\":{\"adjudicationResults\":[{\"depth\":1e999}]}",
    );
    connection.execute("UPDATE arena_story_chapter SET document=?1,document_bytes=?2 WHERE id='story-chapter-1'", rusqlite::params![document, document.len() as u64]).unwrap();
    let raw: u64 = connection.query_row("SELECT (SELECT document_bytes FROM arena_story_chapter WHERE id='story-chapter-1')+(SELECT document_bytes FROM arena_story_session WHERE id='story')", [], |row| row.get(0)).unwrap();
    assert_eq!(
        derived_byte_bound(&connection, &manifest(b"a", 1)),
        Ok(raw + 4096 + 128)
    );
}

#[test]
fn idle_timeout_reaps_partial_and_late_calls_are_stale() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let token = begin(store, b"abc", now);
    store.append_markdown_export(&token, 0, b"a", now).unwrap();
    assert_eq!(
        store.expire_markdown_export(&token, now + IDLE_TIMEOUT - Duration::from_secs(1)),
        Ok(Some(Duration::from_secs(1)))
    );
    assert_eq!(
        store.expire_markdown_export(&token, now + IDLE_TIMEOUT),
        Ok(None)
    );
    assert!(entries(root.path()).is_empty());
    assert_eq!(
        store.append_markdown_export(&token, 1, b"bc", now + IDLE_TIMEOUT),
        Err(StoryError::Stale)
    );
    assert_eq!(
        store.end_markdown_export(&token, &digest(b"abc"), now + IDLE_TIMEOUT),
        Err(StoryError::Stale)
    );
}

#[test]
fn successful_progress_extends_lifetime_beyond_fifteen_minutes() {
    let (_root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let token = begin(store, b"abc", now);
    for (index, minute) in [14, 28, 42].into_iter().enumerate() {
        let time = now + Duration::from_secs(minute * 60);
        store
            .append_markdown_export(&token, index as u64, &b"abc"[index..index + 1], time)
            .unwrap();
        assert_eq!(
            store.expire_markdown_export(&token, time),
            Ok(Some(IDLE_TIMEOUT))
        );
    }
    assert!(store
        .end_markdown_export(&token, &digest(b"abc"), now + Duration::from_secs(56 * 60))
        .is_ok());
}

#[test]
fn rejected_frames_and_incomplete_end_do_not_refresh_idle_timeout() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let token = begin(store, b"abc", now);
    let late = now + Duration::from_secs(14 * 60);
    assert_eq!(
        store.append_markdown_export(&token, 1, b"a", late),
        Err(StoryError::Invalid)
    );
    assert_eq!(
        store.end_markdown_export(&token, &digest(b"abc"), late),
        Err(StoryError::Incomplete)
    );
    assert_eq!(
        store.expire_markdown_export(&token, now + IDLE_TIMEOUT),
        Ok(None)
    );
    assert!(entries(root.path()).is_empty());
}

#[test]
fn changed_or_missing_head_after_begin_cannot_publish() {
    for delete in [false, true] {
        let (root, library) = library();
        let store = library.stories();
        let now = Instant::now();
        let token = begin(store, b"abc", now);
        store
            .append_markdown_export(&token, 0, b"abc", now)
            .unwrap();
        if delete {
            let connection = lock_connection(&store.connection).unwrap();
            connection
                .execute_batch(
                    "PRAGMA foreign_keys=OFF; DELETE FROM arena_story_session WHERE id='story';",
                )
                .unwrap();
        } else {
            commit(store, 2, json!({}));
        }
        assert_eq!(
            store.end_markdown_export(&token, &digest(b"abc"), now),
            Err(if delete {
                StoryError::Missing
            } else {
                StoryError::Stale
            })
        );
        assert!(entries(root.path()).is_empty());
    }
}

#[test]
fn maintenance_refusal_preserves_private_temp_and_retry_succeeds() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let token = begin(store, b"abc", now);
    store
        .append_markdown_export(&token, 0, b"abc", now)
        .unwrap();
    let final_path = target(store);
    let permit = library.enter_maintenance("test-export").unwrap();
    assert_eq!(
        store.end_markdown_export(&token, &digest(b"abc"), now),
        Err(StoryError::Maintenance)
    );
    assert!(!final_path.exists());
    assert_eq!(entries(root.path()).len(), 1);
    drop(permit);
    assert!(store
        .end_markdown_export(&token, &digest(b"abc"), now)
        .is_ok());
}

#[test]
fn integrity_failures_discard_private_temp() {
    for truncate in [false, true] {
        let (root, library) = library();
        let store = library.stories();
        let now = Instant::now();
        let token = begin(store, b"abc", now);
        store
            .append_markdown_export(&token, 0, if truncate { b"abc" } else { b"xyz" }, now)
            .unwrap();
        if truncate {
            store
                .markdown_export
                .session
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .temporary
                .as_file()
                .set_len(1)
                .unwrap();
        }
        assert_eq!(
            store.end_markdown_export(&token, &digest(b"abc"), now),
            Err(StoryError::Corrupt)
        );
        assert!(entries(root.path()).is_empty());
    }
}

#[test]
fn injected_partial_write_sync_and_persist_errors_never_publish() {
    for failure in [IoPoint::Write, IoPoint::Sync, IoPoint::Persist] {
        let (root, library) = library();
        let store = library.stories();
        let now = Instant::now();
        let token = begin(store, b"abc", now);
        let mut hook = |point, file: &mut File| {
            if point != failure {
                return Ok(());
            }
            if point == IoPoint::Write {
                file.write_all(b"partial").unwrap();
            }
            Err(StoryError::Io)
        };
        if failure == IoPoint::Write {
            assert_eq!(
                store.append_markdown_export_with_hook(&token, 0, b"abc", now, &mut hook),
                Err(StoryError::Io)
            );
        } else {
            store
                .append_markdown_export(&token, 0, b"abc", now)
                .unwrap();
            assert_eq!(
                store.end_markdown_export_with_hook(&token, &digest(b"abc"), now, &mut hook),
                Err(StoryError::Io)
            );
        }
        assert!(entries(root.path()).is_empty());
        assert_eq!(
            store.end_markdown_export(&token, &digest(b"abc"), now),
            Err(StoryError::Stale)
        );
    }
}

#[test]
fn no_clobber_preserves_occupied_target_and_discards_temp() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let token = begin(store, b"abc", now);
    let occupied = target(store);
    fs::write(&occupied, b"do not overwrite").unwrap();
    store
        .append_markdown_export(&token, 0, b"abc", now)
        .unwrap();
    assert_eq!(
        store.end_markdown_export(&token, &digest(b"abc"), now),
        Err(StoryError::Conflict)
    );
    assert_eq!(fs::read(&occupied).unwrap(), b"do not overwrite");
    assert_eq!(entries(root.path()), vec![occupied]);
}

#[test]
fn startup_reclaims_only_own_names_and_reopen_rejects_old_tokens() {
    let (root, library) = library();
    let now = Instant::now();
    let old = begin(library.stories(), b"abc", now);
    let instance = library.stories().instance.clone();
    drop(library);
    let exports = root.path().join("exports");
    fs::write(exports.join(".story-markdown-dead.partial"), b"old").unwrap();
    for name in [
        ".local-library-1.partial",
        "story.md",
        ".story-markdown-keep.other",
        "other.partial",
    ] {
        fs::write(exports.join(name), b"keep").unwrap();
    }
    let reopened = LocalLibrary::open(root.path()).unwrap();
    assert_ne!(instance, reopened.stories().instance);
    assert_eq!(entries(root.path()).len(), 4);
    let token = begin(reopened.stories(), b"abc", now);
    assert_eq!(
        reopened
            .stories()
            .append_markdown_export(&old, 0, b"abc", now),
        Err(StoryError::Stale)
    );
    reopened
        .stories()
        .append_markdown_export(&token, 0, b"abc", now)
        .unwrap();
    reopened
        .stories()
        .end_markdown_export(&token, &digest(b"abc"), now)
        .unwrap();
}

#[cfg(unix)]
#[test]
fn startup_rejects_own_name_symlinks_and_export_directory_symlink() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("exports")).unwrap();
    let victim = outside.path().join("keep");
    fs::write(&victim, b"keep").unwrap();
    let link = root.path().join("exports/.story-markdown-evil.partial");
    symlink(&victim, &link).unwrap();
    assert!(matches!(
        StoryMarkdownExport::open(ExportPaths::under(root.path())),
        Err(StoryError::Io)
    ));
    assert_eq!(fs::read(&victim).unwrap(), b"keep");
    fs::remove_file(link).unwrap();
    fs::remove_dir(root.path().join("exports")).unwrap();
    symlink(outside.path(), root.path().join("exports")).unwrap();
    assert!(matches!(
        StoryMarkdownExport::open(ExportPaths::under(root.path())),
        Err(StoryError::Io)
    ));
}

#[test]
fn insufficient_available_space_fails_before_allocating_any_temp() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    assert_eq!(
        store.begin_markdown_export_with_space(manifest(b"abc", 1), now, &mut |_| Ok(2)),
        Err(StoryError::ExportNoSpace)
    );
    assert!(entries(root.path()).is_empty());
    assert_eq!(
        store.begin_markdown_export_with_space(manifest(b"abc", 1), now, &mut |_| Err(
            StoryError::Io
        )),
        Err(StoryError::Io)
    );
    assert!(entries(root.path()).is_empty());
    let token = store
        .begin_markdown_export_with_space(manifest(b"abc", 1), now, &mut |_| Ok(3))
        .unwrap()
        .token;
    store
        .append_markdown_export(&token, 0, b"abc", now)
        .unwrap();
    assert_eq!(
        store.end_markdown_export(&token, "sha256:bad", now),
        Err(StoryError::Invalid)
    );
    assert!(store
        .end_markdown_export(&token, &digest(b"abc"), now)
        .is_ok());
}

#[test]
fn exact_derived_bound_is_admitted_but_one_extra_byte_is_not() {
    let (root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let bound = derived_byte_bound(
        &lock_connection(&store.connection).unwrap(),
        &manifest(b"a", 1),
    )
    .unwrap();
    let mut request = manifest(b"a", 1);
    request.expected_byte_length = bound;
    let token = store
        .begin_markdown_export_with_space(request.clone(), now, &mut |_| Ok(MAX_SAFE_INTEGER))
        .unwrap()
        .token;
    store.abort_markdown_export(&token).unwrap();
    request.expected_byte_length += 1;
    assert_eq!(
        store.begin_markdown_export_with_space(request, now, &mut |_| Ok(MAX_SAFE_INTEGER)),
        Err(StoryError::TooLarge)
    );
    assert!(entries(root.path()).is_empty());
}

#[test]
fn begin_checks_actual_chapter_rows_instead_of_trusting_stored_count() {
    let (root, library) = library();
    let store = library.stories();
    lock_connection(&store.connection)
        .unwrap()
        .execute(
            "UPDATE arena_story_session SET chapter_count=2 WHERE id='story'",
            [],
        )
        .unwrap();
    let request = StoryMarkdownExportManifest {
        chapter_count: 2,
        ..manifest(b"a", 1)
    };
    assert_eq!(
        store.begin_markdown_export(request, Instant::now()),
        Err(StoryError::Corrupt)
    );
    assert!(entries(root.path()).is_empty());
}

#[test]
fn traversal_and_upload_do_not_hold_a_maintenance_permit() {
    let (_root, library) = library();
    let store = library.stories();
    let now = Instant::now();
    let permit = library.enter_maintenance("test-upload").unwrap();
    let token = begin(store, b"abc", now);
    store
        .append_markdown_export(&token, 0, b"abc", now)
        .unwrap();
    assert_eq!(
        store.end_markdown_export(&token, &digest(b"abc"), now),
        Err(StoryError::Maintenance)
    );
    drop(permit);
    assert!(store
        .end_markdown_export(&token, &digest(b"abc"), now)
        .is_ok());
}
