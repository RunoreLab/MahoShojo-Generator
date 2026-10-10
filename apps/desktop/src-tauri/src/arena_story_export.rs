//! Dedicated full-story Markdown sink. The shared TypeScript writer owns rendering;
//! native owns scope, bounded raw writes, integrity and no-clobber publication.
//!
//! Lock order is export mutex -> short write permit -> connection. Traversal and
//! upload never hold a maintenance permit. Only the final scope check + publication
//! excludes maintenance, after the potentially slow file sync has finished.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use super::{
    random_id, valid_digest, valid_id, StoryError, StoryStore, CANDIDATE_FRAME_BYTES,
    MAX_SAFE_INTEGER,
};
use crate::export::ExportPaths;
use crate::store::lock_connection;

const TEMP_PREFIX: &str = ".story-markdown-";
const TEMP_SUFFIX: &str = ".partial";
const IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryMarkdownExportManifest {
    pub session_id: String,
    pub revision: u64,
    pub expected_head: String,
    pub chapter_count: u64,
    pub expected_byte_length: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryMarkdownExportBegin {
    pub token: String,
    pub expected_byte_length: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryMarkdownExportAppend {
    pub token: String,
    pub received_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryMarkdownExportEnd {
    pub token: String,
    pub absolute_path: String,
    pub byte_length: u64,
}

struct ExportSession {
    token: String,
    manifest: StoryMarkdownExportManifest,
    temporary: NamedTempFile,
    target: PathBuf,
    received: u64,
    hash: Sha256,
    last_progress: Instant,
}

pub struct StoryMarkdownExport {
    paths: ExportPaths,
    session: Mutex<Option<ExportSession>>,
}

impl StoryMarkdownExport {
    /// Called only while the owning library has its existing single-instance lock.
    /// Never reclaim the archive export's temporaries or follow an own-name symlink.
    pub fn open(paths: ExportPaths) -> Result<Self, StoryError> {
        fs::create_dir_all(paths.root()).map_err(|_| StoryError::Io)?;
        require_directory(paths.root())?;
        for entry in fs::read_dir(paths.root()).map_err(|_| StoryError::Io)? {
            let entry = entry.map_err(|_| StoryError::Io)?;
            let name = entry.file_name();
            if !name
                .to_str()
                .is_some_and(|name| name.starts_with(TEMP_PREFIX) && name.ends_with(TEMP_SUFFIX))
            {
                continue;
            }
            if !entry.file_type().map_err(|_| StoryError::Io)?.is_file() {
                return Err(StoryError::Io);
            }
            fs::remove_file(entry.path()).map_err(|_| StoryError::Io)?;
        }
        Ok(Self {
            paths,
            session: Mutex::new(None),
        })
    }
}

fn require_directory(path: &Path) -> Result<(), StoryError> {
    if !fs::symlink_metadata(path)
        .map_err(|_| StoryError::Io)?
        .file_type()
        .is_dir()
    {
        return Err(StoryError::Io);
    }
    Ok(())
}

impl StoryMarkdownExportManifest {
    fn validate(&self) -> Result<(), StoryError> {
        if !valid_id(&self.session_id)
            || !valid_id(&self.expected_head)
            || self.revision == 0
            || self.revision > MAX_SAFE_INTEGER
            || self.chapter_count == 0
            || self.chapter_count > MAX_SAFE_INTEGER
            || self.expected_byte_length == 0
        {
            return Err(StoryError::Invalid);
        }
        if self.expected_byte_length > MAX_SAFE_INTEGER {
            return Err(StoryError::TooLarge);
        }
        Ok(())
    }
}

fn assert_scope(
    connection: &Connection,
    manifest: &StoryMarkdownExportManifest,
) -> Result<(), StoryError> {
    let actual: Option<(u64, String, u64)> = connection
        .query_row(
            "SELECT revision,last_chapter_id,chapter_count FROM arena_story_session WHERE id=?1",
            [&manifest.session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| StoryError::Io)?;
    let (revision, head, count) = actual.ok_or(StoryError::Missing)?;
    if revision != manifest.revision
        || head != manifest.expected_head
        || count != manifest.chapter_count
    {
        return Err(StoryError::Stale);
    }
    Ok(())
}

fn add_bound(left: u64, right: u64) -> u64 {
    left.saturating_add(right).min(MAX_SAFE_INTEGER)
}

/// A native-only conservative allocation bound, not a second Markdown renderer.
/// Raw JSON covers user strings; fixed overhead is 4096 + 64 per chapter/item;
/// each finite positive depth contributes four spaces per floored depth.
/// All arithmetic saturates at the JS exact-integer boundary, never a story-size cap.
fn derived_byte_bound(
    connection: &Connection,
    manifest: &StoryMarkdownExportManifest,
) -> Result<u64, StoryError> {
    assert_scope(connection, manifest)?;
    let (recorded, actual, valid): (u64, u64, bool) = connection.query_row(
        "SELECT document_bytes,length(CAST(document AS BLOB)),json_valid(document) FROM arena_story_session WHERE id=?1",
        [&manifest.session_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    ).map_err(|_| StoryError::Io)?;
    if recorded != actual || !valid {
        return Err(StoryError::Corrupt);
    }
    let mut bound = add_bound(actual, 4096);
    let mut chapters = connection.prepare(
        "SELECT id,chapter_index,document_bytes,length(CAST(document AS BLOB)),json_valid(document) FROM arena_story_chapter WHERE session_id=?1 ORDER BY chapter_index,id",
    ).map_err(|_| StoryError::Io)?;
    let mut rows = chapters
        .query([&manifest.session_id])
        .map_err(|_| StoryError::Io)?;
    let mut count = 0_u64;
    let mut head = String::new();
    // Guard both the outer document and each array item's type. json_each.value
    // for a string is not JSON, so passing it unguarded to json_type would throw.
    let mut depths = connection.prepare(
        "SELECT CASE WHEN item.type='object' THEN CASE WHEN json_type(item.value,'$.depth') IN ('integer','real') THEN json_extract(item.value,'$.depth') END END FROM arena_story_chapter AS chapter, json_each(CASE WHEN json_valid(chapter.document) THEN CASE WHEN json_type(chapter.document,'$.cardSnapshot.adjudicationResults')='array' THEN json_extract(chapter.document,'$.cardSnapshot.adjudicationResults') ELSE '[]' END ELSE '[]' END) AS item WHERE chapter.id=?1 AND chapter.session_id=?2",
    ).map_err(|_| StoryError::Io)?;
    while let Some(row) = rows.next().map_err(|_| StoryError::Io)? {
        head = row.get(0).map_err(|_| StoryError::Corrupt)?;
        let index: u64 = row.get(1).map_err(|_| StoryError::Corrupt)?;
        let recorded_bytes: u64 = row.get(2).map_err(|_| StoryError::Corrupt)?;
        let actual_bytes: u64 = row.get(3).map_err(|_| StoryError::Corrupt)?;
        let valid_json: bool = row.get(4).map_err(|_| StoryError::Corrupt)?;
        count = count.checked_add(1).ok_or(StoryError::TooLarge)?;
        if index != count || recorded_bytes != actual_bytes || !valid_json {
            return Err(StoryError::Corrupt);
        }
        bound = add_bound(bound, add_bound(actual_bytes, 64));
        let mut items = depths
            .query(rusqlite::params![head, manifest.session_id])
            .map_err(|_| StoryError::Io)?;
        while let Some(item) = items.next().map_err(|_| StoryError::Io)? {
            bound = add_bound(bound, 64);
            let depth: Option<f64> = item.get(0).map_err(|_| StoryError::Corrupt)?;
            if let Some(depth) = depth.filter(|depth| depth.is_finite() && *depth > 0.0) {
                let spaces = (depth.floor() as u64).saturating_mul(4);
                bound = add_bound(bound, spaces);
            }
        }
    }
    if count != manifest.chapter_count || head != manifest.expected_head {
        return Err(StoryError::Corrupt);
    }
    Ok(bound)
}

fn expire(session: &mut Option<ExportSession>, now: Instant) {
    if session
        .as_ref()
        .is_some_and(|session| now.saturating_duration_since(session.last_progress) >= IDLE_TIMEOUT)
    {
        session.take();
    }
}

fn require_token(session: &Option<ExportSession>, token: &str) -> Result<(), StoryError> {
    if !session
        .as_ref()
        .is_some_and(|session| session.token == token)
    {
        return Err(StoryError::Stale);
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum IoPoint {
    Write,
    Sync,
    Persist,
}

impl StoryStore {
    pub fn begin_markdown_export(
        &self,
        manifest: StoryMarkdownExportManifest,
        now: Instant,
    ) -> Result<StoryMarkdownExportBegin, StoryError> {
        self.begin_markdown_export_with_space(manifest, now, &mut |root| {
            fs4::available_space(root).map_err(|_| StoryError::Io)
        })
    }

    fn begin_markdown_export_with_space(
        &self,
        manifest: StoryMarkdownExportManifest,
        now: Instant,
        available_space: &mut impl FnMut(&Path) -> Result<u64, StoryError>,
    ) -> Result<StoryMarkdownExportBegin, StoryError> {
        manifest.validate()?;
        let mut session = self
            .markdown_export
            .session
            .lock()
            .map_err(|_| StoryError::Io)?;
        expire(&mut session, now);
        if session.is_some() {
            return Err(StoryError::Busy);
        }
        let connection = lock_connection(&self.connection).map_err(|_| StoryError::Io)?;
        if manifest.expected_byte_length > derived_byte_bound(&connection, &manifest)? {
            return Err(StoryError::TooLarge);
        }
        drop(connection);
        require_directory(self.markdown_export.paths.root())?;
        if available_space(self.markdown_export.paths.root())? < manifest.expected_byte_length {
            return Err(StoryError::ExportNoSpace);
        }
        let nonce = random_id()?;
        let token = format!("{}-{nonce}", self.instance);
        let target = self
            .markdown_export
            .paths
            .root()
            .join(format!("story-markdown-{nonce}.md"));
        let temporary = tempfile::Builder::new()
            .prefix(TEMP_PREFIX)
            .suffix(TEMP_SUFFIX)
            .tempfile_in(self.markdown_export.paths.root())
            .map_err(|_| StoryError::Io)?;
        let expected_byte_length = manifest.expected_byte_length;
        *session = Some(ExportSession {
            token: token.clone(),
            manifest,
            temporary,
            target,
            received: 0,
            hash: Sha256::new(),
            last_progress: now,
        });
        Ok(StoryMarkdownExportBegin {
            token,
            expected_byte_length,
        })
    }

    pub fn append_markdown_export(
        &self,
        token: &str,
        offset: u64,
        bytes: &[u8],
        now: Instant,
    ) -> Result<StoryMarkdownExportAppend, StoryError> {
        self.append_markdown_export_with_hook(token, offset, bytes, now, &mut |_, _| Ok(()))
    }

    fn append_markdown_export_with_hook(
        &self,
        token: &str,
        offset: u64,
        bytes: &[u8],
        now: Instant,
        hook: &mut impl FnMut(IoPoint, &mut File) -> Result<(), StoryError>,
    ) -> Result<StoryMarkdownExportAppend, StoryError> {
        let mut guard = self
            .markdown_export
            .session
            .lock()
            .map_err(|_| StoryError::Io)?;
        // A late token cannot cancel, expire or otherwise alter the current export.
        require_token(&guard, token)?;
        expire(&mut guard, now);
        let session = guard.as_mut().ok_or(StoryError::Stale)?;
        if bytes.is_empty() || bytes.len() > CANDIDATE_FRAME_BYTES {
            return Err(StoryError::TooLarge);
        }
        if offset != session.received {
            return Err(StoryError::Invalid);
        }
        if bytes.len() as u64 > session.manifest.expected_byte_length - session.received {
            return Err(StoryError::TooLarge);
        }
        if hook(IoPoint::Write, session.temporary.as_file_mut()).is_err()
            || session.temporary.as_file_mut().write_all(bytes).is_err()
        {
            guard.take();
            return Err(StoryError::Io);
        }
        session.hash.update(bytes);
        session.received += bytes.len() as u64;
        session.last_progress = now.max(session.last_progress);
        Ok(StoryMarkdownExportAppend {
            token: token.to_owned(),
            received_bytes: session.received,
        })
    }

    /// Timer checks are token-scoped: an older export's timer cannot reap a new one.
    pub fn expire_markdown_export(
        &self,
        token: &str,
        now: Instant,
    ) -> Result<Option<Duration>, StoryError> {
        let mut guard = self
            .markdown_export
            .session
            .lock()
            .map_err(|_| StoryError::Io)?;
        if require_token(&guard, token).is_err() {
            return Ok(None);
        }
        expire(&mut guard, now);
        Ok(guard.as_ref().map(|session| {
            IDLE_TIMEOUT.saturating_sub(now.saturating_duration_since(session.last_progress))
        }))
    }

    pub fn abort_markdown_export(&self, token: &str) -> Result<(), StoryError> {
        let mut session = self
            .markdown_export
            .session
            .lock()
            .map_err(|_| StoryError::Io)?;
        if session
            .as_ref()
            .is_some_and(|session| session.token == token)
        {
            session.take();
        }
        Ok(())
    }

    pub fn end_markdown_export(
        &self,
        token: &str,
        expected_digest: &str,
        now: Instant,
    ) -> Result<StoryMarkdownExportEnd, StoryError> {
        self.end_markdown_export_with_hook(token, expected_digest, now, &mut |_, _| Ok(()))
    }

    fn end_markdown_export_with_hook(
        &self,
        token: &str,
        expected_digest: &str,
        now: Instant,
        hook: &mut impl FnMut(IoPoint, &mut File) -> Result<(), StoryError>,
    ) -> Result<StoryMarkdownExportEnd, StoryError> {
        let mut guard = self
            .markdown_export
            .session
            .lock()
            .map_err(|_| StoryError::Io)?;
        require_token(&guard, token)?;
        expire(&mut guard, now);
        let session = guard.as_mut().ok_or(StoryError::Stale)?;
        if !valid_digest(expected_digest) {
            return Err(StoryError::Invalid);
        }
        if session.received != session.manifest.expected_byte_length {
            return Err(StoryError::Incomplete);
        }
        let prepare = (|| {
            if format!("sha256:{:x}", session.hash.clone().finalize()) != expected_digest {
                return Err(StoryError::Corrupt);
            }
            require_directory(self.markdown_export.paths.root())?;
            if !fs::symlink_metadata(session.temporary.path())
                .map_err(|_| StoryError::Io)?
                .file_type()
                .is_file()
                || session
                    .temporary
                    .as_file()
                    .metadata()
                    .map_err(|_| StoryError::Io)?
                    .len()
                    != session.received
            {
                return Err(StoryError::Corrupt);
            }
            hook(IoPoint::Sync, session.temporary.as_file_mut())?;
            session
                .temporary
                .as_file()
                .sync_all()
                .map_err(|_| StoryError::Io)
        })();
        if let Err(error) = prepare {
            guard.take();
            return Err(error);
        }
        // A maintenance refusal leaves the fully synced private temp retryable.
        // No maintenance permit is held during traversal, upload or fsync.
        let permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        let connection = lock_connection(&self.connection).map_err(|_| StoryError::Io)?;
        if let Err(error) = assert_scope(&connection, &session.manifest) {
            guard.take();
            return Err(error);
        }
        if let Err(error) = hook(IoPoint::Persist, session.temporary.as_file_mut()) {
            guard.take();
            return Err(error);
        }
        let session = guard.take().ok_or(StoryError::Stale)?;
        let absolute_path = session.target.to_str().ok_or(StoryError::Io)?.to_owned();
        // Keep the connection through this short publication: append/delete/restore
        // cannot invalidate the checked head between the check and visibility.
        session
            .temporary
            .persist_noclobber(&session.target)
            .map_err(|error| {
                if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                    StoryError::Conflict
                } else {
                    StoryError::Io
                }
            })?;
        drop(connection);
        drop(permit);
        // Match archive export's best-effort directory durability. After publication
        // never return failure claiming no output; file content was already synced.
        sync_parent_dir(self.markdown_export.paths.root());
        Ok(StoryMarkdownExportEnd {
            token: session.token,
            absolute_path,
            byte_length: session.received,
        })
    }
}

#[cfg(unix)]
fn sync_parent_dir(parent: &Path) {
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
}
#[cfg(not(unix))]
fn sync_parent_dir(_parent: &Path) {}

#[cfg(test)]
#[path = "arena_story_export_tests.rs"]
mod tests;
