//! Device-owned, append-only Direct story persistence candidate.
//!
//! No model, prompt, character-effect, D4 capability or arbitrary-path API lives here.
//! The evaluated ceilings below are NOT a promise that every legal generation fits.
//! Tauri binds only the narrow feature operations after the original-byte gates;
//! full product release remains gated by the complete journey. Staging is not backup.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::maintenance::MaintenanceGate;
use crate::store::{lock_connection, SharedConnection};

// Candidate resource policies, independently measured before any product entry opens.
pub const CANDIDATE_COMMIT_BYTES: u64 = 128 * 1024 * 1024;
pub const CANDIDATE_FRAME_BYTES: usize = 4 * 1024 * 1024;
pub const CANDIDATE_PAGE_BYTES: usize = 128 * 1024;
pub const MAX_STAGES: usize = 2;
// Total reserved bytes across all stages, not a per-stage multiplier.
const STAGING_BYTES: u64 = CANDIDATE_COMMIT_BYTES;
pub(crate) const STAGE_LIFETIME: Duration = Duration::from_secs(15 * 60);
const STAGING_DIRECTORY: &str = ".arena-story-staging";
const TEMP_PREFIX: &str = "story-";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) const MIGRATION_5: &str = r#"
CREATE TABLE arena_story_session (
    id TEXT PRIMARY KEY NOT NULL,
    document TEXT NOT NULL, document_bytes INTEGER NOT NULL, document_digest TEXT NOT NULL,
    seed_document TEXT NOT NULL, seed_bytes INTEGER NOT NULL, seed_digest TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    title_preview TEXT NOT NULL, title_truncated INTEGER NOT NULL CHECK(title_truncated IN (0,1)),
    mode TEXT NOT NULL, chapter_plan TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    chapter_count INTEGER NOT NULL CHECK(chapter_count > 0),
    last_chapter_id TEXT NOT NULL, working_checkpoint_id TEXT NOT NULL, last_input_checkpoint_id TEXT NOT NULL,
    FOREIGN KEY(id,last_chapter_id) REFERENCES arena_story_chapter(session_id,id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(id,working_checkpoint_id) REFERENCES arena_story_checkpoint(session_id,id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(id,last_input_checkpoint_id) REFERENCES arena_story_checkpoint(session_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX arena_story_session_updated ON arena_story_session(updated_at DESC,id DESC);
CREATE TABLE arena_story_chapter (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, chapter_index INTEGER NOT NULL CHECK(chapter_index > 0),
    action TEXT NOT NULL CHECK(action IN ('start','continue')), source_chapter_id TEXT,
    title_preview TEXT NOT NULL, title_truncated INTEGER NOT NULL CHECK(title_truncated IN (0,1)),
    created_at INTEGER NOT NULL, markdown_bytes INTEGER NOT NULL CHECK(markdown_bytes >= 0),
    document TEXT NOT NULL, document_bytes INTEGER NOT NULL, document_digest TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE, operation_digest TEXT NOT NULL, receipt TEXT NOT NULL,
    UNIQUE(session_id,id), UNIQUE(session_id,chapter_index),
    FOREIGN KEY(session_id) REFERENCES arena_story_session(id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(session_id,source_chapter_id) REFERENCES arena_story_chapter(session_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE arena_story_checkpoint (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, boundary_index INTEGER NOT NULL CHECK(boundary_index >= 0),
    chapter_id TEXT, document TEXT NOT NULL, document_bytes INTEGER NOT NULL, document_digest TEXT NOT NULL,
    UNIQUE(session_id,id), UNIQUE(session_id,boundary_index),
    FOREIGN KEY(session_id) REFERENCES arena_story_session(id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(session_id,chapter_id) REFERENCES arena_story_chapter(session_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoryError {
    Invalid,
    TooLarge,
    Busy,
    Stale,
    Incomplete,
    Conflict,
    OperationMismatch,
    OriginalsUncovered,
    Missing,
    Maintenance,
    Io,
    ExportNoSpace,
    Corrupt,
    /// COMMIT failed without a receipt: never claim that disk state is known.
    CommitUnknown,
    /// The shared connection still contains an unresolved transaction.
    ConnectionUnresolved,
}
impl StoryError {
    fn from_store(error: crate::store::StoreError) -> Self {
        match error {
            crate::store::StoreError::TransactionUnresolved => Self::ConnectionUnresolved,
            _ => Self::Io,
        }
    }
}
impl Serialize for StoryError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let code = match self {
            Self::Invalid => "story-invalid",
            Self::TooLarge => "story-too-large",
            Self::Busy => "story-staging-busy",
            Self::Stale => "story-stale",
            Self::Incomplete => "story-incomplete",
            Self::Conflict => "story-conflict",
            Self::OperationMismatch => "story-operation-mismatch",
            Self::OriginalsUncovered => "story-originals-uncovered",
            Self::Missing => "story-missing",
            Self::Maintenance => "maintenance-busy",
            Self::Io => "story-io",
            Self::ExportNoSpace => "story-export-no-space",
            Self::Corrupt => "story-corrupt",
            Self::CommitUnknown | Self::ConnectionUnresolved => "story-commit-unknown",
        };
        let mut result = serializer.serialize_struct("StoryError", 3)?;
        result.serialize_field("code", code)?;
        result.serialize_field(
            "message",
            if matches!(self, Self::ConnectionUnresolved) {
                "本地连接事务未恢复；请重启应用后仅查询原精确回执，勿重复保存"
            } else if matches!(self, Self::OriginalsUncovered) {
                "保存包未完整覆盖必要作品内容；已保留未保存原件"
            } else if matches!(self, Self::ExportNoSpace) {
                "可用磁盘空间不足，完整故事未导出；原记录未修改"
            } else {
                "Local story operation did not complete; retain the unsaved result"
            },
        )?;
        result.serialize_field(
            "writeEvidence",
            if matches!(self, Self::CommitUnknown | Self::ConnectionUnresolved) {
                "unknown"
            } else {
                "not-written"
            },
        )?;
        result.end()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PartKind {
    Session,
    Seed,
    Chapter,
    Checkpoint0,
    Checkpoint1,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartDeclaration {
    pub kind: PartKind,
    pub byte_length: u64,
    pub digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitManifest {
    pub version: u32,
    pub operation_id: String,
    pub session_id: String,
    pub expected_revision: u64,
    pub expected_last_chapter_id: Option<String>,
    pub parts: Vec<PartDeclaration>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryReceipt {
    pub version: u32,
    pub operation_id: String,
    pub session_id: String,
    pub chapter_id: String,
    pub chapter_index: u64,
    pub revision: u64,
    pub chapter_count: u64,
    pub checkpoint_ids: Vec<String>,
    /// Separate protocol identity: SHA-256 of a prefixed canonical *small manifest*.
    /// This is not domain/arena-story-commit's complete logical-value identity.
    pub wire_digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginOutcome {
    pub token: String,
    pub total_bytes: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppendOutcome {
    pub token: String,
    pub kind: PartKind,
    pub received_bytes: u64,
}

struct StagePart {
    declaration: PartDeclaration,
    file: NamedTempFile,
    received: u64,
    hash: Sha256,
}
struct Stage {
    manifest: CommitManifest,
    parts: Vec<StagePart>,
    current: usize,
    created_at: Instant,
    total: u64,
}
pub struct StoryStore {
    pub(super) connection: SharedConnection,
    gate: Arc<MaintenanceGate>,
    staging_root: PathBuf,
    stages: Mutex<HashMap<String, Stage>>,
    pending_admission: [Mutex<()>; 2],
    pending_attempts: Mutex<HashMap<String, String>>,
    pending_inputs: Mutex<HashMap<(String, pending::PendingKind), Vec<u8>>>,
    markdown_export: markdown_export::StoryMarkdownExport,
    /// Every process/restore generation has a new identity; descriptors cannot cross it.
    pub(super) instance: String,
}

pub(super) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn valid_digest(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
pub(super) fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
fn random_id() -> Result<String, StoryError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| StoryError::Io)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
impl CommitManifest {
    fn validate(&self) -> Result<u64, StoryError> {
        if self.version != 1
            || !valid_id(&self.operation_id)
            || !valid_id(&self.session_id)
            || self.expected_revision >= MAX_SAFE_INTEGER
            || self
                .expected_last_chapter_id
                .as_deref()
                .is_some_and(|id| !valid_id(id))
            || (self.expected_revision == 0) != self.expected_last_chapter_id.is_none()
        {
            return Err(StoryError::Invalid);
        }
        let expected: &[PartKind] = if self.expected_revision == 0 {
            &[
                PartKind::Session,
                PartKind::Seed,
                PartKind::Chapter,
                PartKind::Checkpoint0,
                PartKind::Checkpoint1,
            ]
        } else {
            &[PartKind::Session, PartKind::Chapter, PartKind::Checkpoint1]
        };
        if self.parts.iter().map(|p| p.kind).collect::<Vec<_>>() != expected {
            return Err(StoryError::Invalid);
        }
        let mut total = 0_u64;
        for part in &self.parts {
            if part.byte_length == 0 || !valid_digest(&part.digest) {
                return Err(StoryError::Invalid);
            }
            total = total
                .checked_add(part.byte_length)
                .ok_or(StoryError::TooLarge)?;
            if total > CANDIDATE_COMMIT_BYTES {
                return Err(StoryError::TooLarge);
            }
        }
        Ok(total)
    }
    pub fn wire_digest(&self) -> Result<String, StoryError> {
        // Explicit sorted field order, independent of serde_json's optional
        // preserve_order feature in the full Tauri dependency graph.
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CanonicalPart<'a> {
            byte_length: u64,
            digest: &'a str,
            kind: PartKind,
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CanonicalManifest<'a> {
            expected_last_chapter_id: &'a Option<String>,
            expected_revision: u64,
            operation_id: &'a str,
            parts: Vec<CanonicalPart<'a>>,
            session_id: &'a str,
            version: u32,
        }
        let canonical = CanonicalManifest {
            expected_last_chapter_id: &self.expected_last_chapter_id,
            expected_revision: self.expected_revision,
            operation_id: &self.operation_id,
            parts: self
                .parts
                .iter()
                .map(|part| CanonicalPart {
                    byte_length: part.byte_length,
                    digest: &part.digest,
                    kind: part.kind,
                })
                .collect(),
            session_id: &self.session_id,
            version: self.version,
        };
        let mut hash = Sha256::new();
        hash.update(b"arena-story-wire-v1\n");
        hash.update(serde_json::to_vec(&canonical).map_err(|_| StoryError::Invalid)?);
        Ok(format!("sha256:{:x}", hash.finalize()))
    }
}

impl StoryStore {
    pub fn open(
        root: &Path,
        connection: SharedConnection,
        gate: Arc<MaintenanceGate>,
    ) -> Result<Self, StoryError> {
        let staging_root = root.join(STAGING_DIRECTORY);
        fs::create_dir_all(&staging_root).map_err(|_| StoryError::Io)?;
        if !fs::symlink_metadata(&staging_root)
            .map_err(|_| StoryError::Io)?
            .file_type()
            .is_dir()
        {
            return Err(StoryError::Io);
        }
        // Called only after the library's single-instance lock. Never follow symlinks,
        // renderer paths or unrelated files; reclaim only this feature's own temp names.
        for entry in fs::read_dir(&staging_root).map_err(|_| StoryError::Io)? {
            let entry = entry.map_err(|_| StoryError::Io)?;
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(TEMP_PREFIX))
            {
                if !entry.file_type().map_err(|_| StoryError::Io)?.is_file() {
                    return Err(StoryError::Io);
                }
                fs::remove_file(entry.path()).map_err(|_| StoryError::Io)?;
            }
        }
        pending::recover_uploads(&*lock_connection(&connection).map_err(StoryError::from_store)?)?;
        Ok(Self {
            connection,
            gate,
            staging_root,
            markdown_export: markdown_export::StoryMarkdownExport::open(
                crate::export::ExportPaths::under(root),
            )?,
            stages: Mutex::new(HashMap::new()),
            pending_admission: [Mutex::new(()), Mutex::new(())],
            pending_attempts: Mutex::new(HashMap::new()),
            pending_inputs: Mutex::new(HashMap::new()),
            instance: random_id()?,
        })
    }
    pub fn begin(
        &self,
        manifest: CommitManifest,
        now: Instant,
    ) -> Result<BeginOutcome, StoryError> {
        let total = manifest.validate()?;
        let mut stages = self.stages.lock().map_err(|_| StoryError::Io)?;
        stages.retain(|_, stage| now.saturating_duration_since(stage.created_at) < STAGE_LIFETIME);
        let reserved: u64 = stages.values().map(|stage| stage.total).sum();
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let (pending_count, pending_bytes) = pending::upload_reservations(&connection)?;
        if stages.len() + pending_count >= MAX_STAGES
            || total > STAGING_BYTES.saturating_sub(reserved + pending_bytes)
        {
            return Err(StoryError::Busy);
        }
        let mut parts = Vec::new();
        for declaration in &manifest.parts {
            parts.push(StagePart {
                declaration: declaration.clone(),
                file: tempfile::Builder::new()
                    .prefix(TEMP_PREFIX)
                    .tempfile_in(&self.staging_root)
                    .map_err(|_| StoryError::Io)?,
                received: 0,
                hash: Sha256::new(),
            });
        }
        let token = format!("{}-{}", self.instance, random_id()?);
        stages.insert(
            token.clone(),
            Stage {
                manifest,
                parts,
                current: 0,
                created_at: now,
                total,
            },
        );
        Ok(BeginOutcome {
            token,
            total_bytes: total,
        })
    }
    pub fn append(
        &self,
        token: &str,
        kind: PartKind,
        offset: u64,
        bytes: &[u8],
        now: Instant,
    ) -> Result<AppendOutcome, StoryError> {
        if bytes.is_empty() || bytes.len() > CANDIDATE_FRAME_BYTES {
            return Err(StoryError::TooLarge);
        }
        let mut stages = self.stages.lock().map_err(|_| StoryError::Io)?;
        stages.retain(|_, stage| now.saturating_duration_since(stage.created_at) < STAGE_LIFETIME);
        let stage = stages.get_mut(token).ok_or(StoryError::Stale)?;
        let part = stage
            .parts
            .get_mut(stage.current)
            .ok_or(StoryError::Incomplete)?;
        if part.declaration.kind != kind || part.received != offset {
            return Err(StoryError::Invalid);
        }
        if bytes.len() as u64 > part.declaration.byte_length - part.received {
            return Err(StoryError::TooLarge);
        }
        if part.file.as_file_mut().write_all(bytes).is_err() {
            stages.remove(token); // Unknown partial file writes must never be retried at an assumed offset.
            return Err(StoryError::Io);
        }
        part.hash.update(bytes);
        part.received += bytes.len() as u64;
        let received_bytes = part.received;
        if part.received == part.declaration.byte_length {
            stage.current += 1;
        }
        Ok(AppendOutcome {
            token: token.to_string(),
            kind,
            received_bytes,
        })
    }
    pub fn abort(&self, token: &str) -> Result<(), StoryError> {
        self.stages
            .lock()
            .map_err(|_| StoryError::Io)?
            .remove(token);
        Ok(())
    }
    pub fn receipt(
        &self,
        session_id: &str,
        operation_id: &str,
    ) -> Result<Option<StoryReceipt>, StoryError> {
        if !valid_id(session_id) || !valid_id(operation_id) {
            return Err(StoryError::Invalid);
        }
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        read_receipt(&connection, session_id, operation_id)
    }
    pub fn end(&self, token: &str, now: Instant) -> Result<StoryReceipt, StoryError> {
        self.end_with_hook(token, now, &mut |_| Ok(()))
    }
    fn end_with_hook(
        &self,
        token: &str,
        now: Instant,
        hook: &mut impl FnMut(&str) -> Result<(), StoryError>,
    ) -> Result<StoryReceipt, StoryError> {
        // Keep reservation registered through validation/transaction: concurrent begin
        // cannot exceed the aggregate disk budget while this end still owns temp files.
        let mut stages = self.stages.lock().map_err(|_| StoryError::Io)?;
        stages.retain(|_, stage| now.saturating_duration_since(stage.created_at) < STAGE_LIFETIME);
        let stage = stages.get_mut(token).ok_or(StoryError::Stale)?;
        if stage.current != stage.parts.len() {
            return Err(StoryError::Incomplete);
        }
        let validated = validate_stage(stage)?;
        hook("validated")?;
        let _permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        let mut connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let transaction = connection.transaction().map_err(|_| StoryError::Io)?;
        // Exact replay precedes stale CAS, but compares native-computed wire identity.
        if let Some(receipt) = read_receipt(
            &transaction,
            &stage.manifest.session_id,
            &stage.manifest.operation_id,
        )? {
            if receipt.wire_digest != validated.receipt.wire_digest {
                return Err(StoryError::OperationMismatch);
            }
            drop(transaction);
            stages.remove(token);
            return Ok(receipt);
        }
        check_cas(&transaction, &stage.manifest, &validated)?;
        hook("cas")?;
        write_stage(&transaction, stage, &validated, hook)?;
        hook("before-commit")?;
        transaction
            .commit()
            .map_err(|_| StoryError::CommitUnknown)?;
        let receipt = validated.receipt;
        stages.remove(token);
        Ok(receipt)
    }
}

fn check_cas(
    connection: &Connection,
    manifest: &CommitManifest,
    validated: &Validated,
) -> Result<(), StoryError> {
    let current = connection.query_row(
            "SELECT revision,last_chapter_id,chapter_count,working_checkpoint_id,created_at,updated_at FROM arena_story_session WHERE id=?1",
            [&manifest.session_id], |row| Ok((row.get::<_,u64>(0)?,row.get::<_,String>(1)?,row.get::<_,u64>(2)?,row.get::<_,String>(3)?,row.get::<_,u64>(4)?,row.get::<_,u64>(5)?))
        ).optional().map_err(|_| StoryError::Io)?;
    match current {
        None if manifest.expected_revision == 0 => {}
        Some((revision, head, count, checkpoint, created, updated))
            if revision == manifest.expected_revision
                && Some(&head) == manifest.expected_last_chapter_id.as_ref()
                && count.checked_add(1) == Some(validated.session.chapter_count)
                && checkpoint == validated.session.last_input_checkpoint_id
                && created == validated.session.created_at
                && updated <= validated.session.updated_at => {}
        _ => return Err(StoryError::Conflict),
    }
    Ok(())
}

fn read_receipt(
    connection: &Connection,
    session_id: &str,
    operation_id: &str,
) -> Result<Option<StoryReceipt>, StoryError> {
    let row: Option<(String,Option<String>,String,u64,String)> = connection.query_row(
        "SELECT session_id,CASE WHEN length(CAST(receipt AS BLOB))<=2048 THEN receipt ELSE NULL END,id,chapter_index,operation_digest FROM arena_story_chapter WHERE operation_id=?1", [operation_id],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional().map_err(|_| StoryError::Io)?;
    row.map(|(stored_session, document, chapter_id, index, wire_digest)| {
        if stored_session != session_id { return Err(StoryError::OperationMismatch); }
        let receipt:StoryReceipt=serde_json::from_str(&document.ok_or(StoryError::Corrupt)?).map_err(|_|StoryError::Corrupt)?;
        let mut statement=connection.prepare("SELECT id FROM arena_story_checkpoint WHERE session_id=?1 AND (boundary_index=?2 OR (?2=1 AND boundary_index=0)) ORDER BY boundary_index").map_err(|_|StoryError::Corrupt)?;
        let checkpoint_ids=statement.query_map(params![session_id,index],|row|row.get::<_,String>(0)).map_err(|_|StoryError::Corrupt)?.collect::<Result<Vec<_>,_>>().map_err(|_|StoryError::Corrupt)?;
        if receipt.version!=1 || receipt.operation_id!=operation_id || receipt.session_id!=session_id
            || receipt.chapter_id!=chapter_id || chapter_id!=operation_id || receipt.chapter_index!=index
            || receipt.revision!=index || receipt.chapter_count!=index || receipt.wire_digest!=wire_digest
            || !valid_digest(&wire_digest) || checkpoint_ids.len()!=if index==1 {2}else{1}
            || receipt.checkpoint_ids!=checkpoint_ids {return Err(StoryError::Corrupt);}
        Ok(receipt)
    }).transpose()
}

fn reject_embedded<'de, D: serde::Deserializer<'de>>(_: D) -> Result<(), D::Error> {
    Err(serde::de::Error::custom(
        "embedded snapshots are not stored in session",
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryChapterPlan {
    pub total_chapters: u64,
    pub source: String,
    pub locked: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct SourceIndex {
    mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIndex {
    id: String,
    revision: u64,
    chapter_count: u64,
    last_chapter_id: String,
    working_checkpoint_id: String,
    last_input_checkpoint_id: String,
    title_preview: String,
    title_truncated: bool,
    mode: String,
    source: SourceIndex,
    #[serde(default)]
    chapter_plan: Option<StoryChapterPlan>,
    created_at: u64,
    updated_at: u64,
    // Explicitly reject accidental logical-session copies. They defeat the storage
    // contract and can multiply large character histories before the write starts.
    #[serde(default, deserialize_with = "reject_embedded", rename = "seed")]
    _seed: (),
    #[serde(
        default,
        deserialize_with = "reject_embedded",
        rename = "workingCombatants"
    )]
    _working_combatants: (),
    #[serde(
        default,
        deserialize_with = "reject_embedded",
        rename = "lastChapterInputCombatants"
    )]
    _last_chapter_input_combatants: (),
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChapterIndex {
    id: String,
    session_id: String,
    index: u64,
    action: String,
    status: String,
    #[serde(default)]
    source_chapter_id: Option<String>,
    title_preview: String,
    title_truncated: bool,
    created_at: u64,
    markdown_byte_length: u64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointIndex {
    id: String,
    session_id: String,
    boundary_index: u64,
    #[serde(default)]
    chapter_id: Option<String>,
}
struct Validated {
    session: SessionIndex,
    chapter: ChapterIndex,
    checkpoints: Vec<CheckpointIndex>,
    receipt: StoryReceipt,
}
fn read_part(part: &mut StagePart) -> Result<String, StoryError> {
    part.file
        .as_file_mut()
        .seek(SeekFrom::Start(0))
        .map_err(|_| StoryError::Io)?;
    let mut document = String::new();
    document
        .try_reserve_exact(part.declaration.byte_length as usize)
        .map_err(|_| StoryError::TooLarge)?;
    part.file
        .as_file_mut()
        .take(part.declaration.byte_length + 1)
        .read_to_string(&mut document)
        .map_err(|_| StoryError::Invalid)?;
    if document.len() as u64 != part.declaration.byte_length
        || digest(document.as_bytes()) != part.declaration.digest
    {
        return Err(StoryError::Corrupt);
    }
    Ok(document)
}
fn preview_valid(preview: &str) -> bool {
    preview.len() <= 192
}
fn validate_stage(stage: &mut Stage) -> Result<Validated, StoryError> {
    for part in &stage.parts {
        if part.received != part.declaration.byte_length
            || format!("sha256:{:x}", part.hash.clone().finalize()) != part.declaration.digest
        {
            return Err(StoryError::Corrupt);
        }
    }
    validate_documents(&stage.manifest, &mut |kind| {
        read_part(
            stage
                .parts
                .iter_mut()
                .find(|p| p.declaration.kind == kind)
                .ok_or(StoryError::Invalid)?,
        )
    })
}
fn validate_documents(
    manifest: &CommitManifest,
    read: &mut impl FnMut(PartKind) -> Result<String, StoryError>,
) -> Result<Validated, StoryError> {
    manifest.validate()?;
    let mut session = None;
    let mut chapter = None;
    let mut checkpoints = Vec::new();
    for part in &manifest.parts {
        let document = read(part.kind)?;
        if document.len() as u64 != part.byte_length || digest(document.as_bytes()) != part.digest {
            return Err(StoryError::Corrupt);
        }
        // Validate JSON carrier shapes while borrowing the raw values. Business
        // schemas/effects remain TS-owned and unknown JSON fields remain byte-exact.
        match part.kind {
            PartKind::Chapter => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct Shape<'a> {
                    #[serde(borrow)]
                    markdown: &'a RawValue,
                    #[serde(borrow)]
                    report_json: &'a RawValue,
                    #[serde(borrow)]
                    deterministic_digest: &'a RawValue,
                }
                let shape: Shape<'_> =
                    serde_json::from_str(&document).map_err(|_| StoryError::Invalid)?;
                if !shape.markdown.get().starts_with('"')
                    || !shape.report_json.get().starts_with('{')
                    || !shape.deterministic_digest.get().starts_with('{')
                {
                    return Err(StoryError::Invalid);
                }
            }
            PartKind::Checkpoint0 | PartKind::Checkpoint1 => {
                #[derive(Deserialize)]
                struct Shape<'a> {
                    #[serde(borrow)]
                    combatants: &'a RawValue,
                }
                let shape: Shape<'_> =
                    serde_json::from_str(&document).map_err(|_| StoryError::Invalid)?;
                if !shape.combatants.get().starts_with('[') {
                    return Err(StoryError::Invalid);
                }
            }
            _ => {}
        }
        match part.kind {
            PartKind::Session => {
                let value: SessionIndex =
                    serde_json::from_str(&document).map_err(|_| StoryError::Invalid)?;
                if value.id != manifest.session_id
                    || value.revision != manifest.expected_revision + 1
                    || !valid_id(&value.last_chapter_id)
                    || !valid_id(&value.working_checkpoint_id)
                    || !valid_id(&value.last_input_checkpoint_id)
                    || !preview_valid(&value.title_preview)
                    || !["classic", "kizuna", "daily", "scenario"].contains(&value.mode.as_str())
                    || value.source.mode != value.mode
                    || value.chapter_plan.as_ref().is_some_and(|plan| {
                        !(1..=20).contains(&plan.total_chapters)
                            || !["user", "scenario"].contains(&plan.source.as_str())
                    })
                    || value.chapter_count == 0
                    || value.chapter_count > MAX_SAFE_INTEGER
                    || value.created_at > value.updated_at
                    || value.updated_at > MAX_SAFE_INTEGER
                {
                    return Err(StoryError::Invalid);
                }
                session = Some(value);
            }
            PartKind::Chapter => {
                let value: ChapterIndex =
                    serde_json::from_str(&document).map_err(|_| StoryError::Invalid)?;
                if value.id != manifest.operation_id
                    || value.session_id != manifest.session_id
                    || value.status != "active"
                    || !preview_valid(&value.title_preview)
                    || value.index == 0
                    || value.index > MAX_SAFE_INTEGER
                    || value.created_at > MAX_SAFE_INTEGER
                    || value.markdown_byte_length > MAX_SAFE_INTEGER
                    || value.source_chapter_id != manifest.expected_last_chapter_id
                    || value.action
                        != if manifest.expected_revision == 0 {
                            "start"
                        } else {
                            "continue"
                        }
                {
                    return Err(StoryError::Invalid);
                }
                chapter = Some(value);
            }
            PartKind::Checkpoint0 | PartKind::Checkpoint1 => {
                let value: CheckpointIndex =
                    serde_json::from_str(&document).map_err(|_| StoryError::Invalid)?;
                if !valid_id(&value.id)
                    || value.session_id != manifest.session_id
                    || value.boundary_index > MAX_SAFE_INTEGER
                    || (part.kind == PartKind::Checkpoint0
                        && (value.boundary_index != 0 || value.chapter_id.is_some()))
                {
                    return Err(StoryError::Invalid);
                }
                checkpoints.push(value);
            }
            PartKind::Seed => {
                #[derive(Deserialize)]
                struct Seed<'a> {
                    #[serde(borrow)]
                    combatants: &'a RawValue,
                }
                let seed: Seed<'_> =
                    serde_json::from_str(&document).map_err(|_| StoryError::Invalid)?;
                if !seed.combatants.get().starts_with('[') {
                    return Err(StoryError::Invalid);
                }
            }
        }
    }
    let session = session.ok_or(StoryError::Invalid)?;
    let chapter = chapter.ok_or(StoryError::Invalid)?;
    let output = checkpoints.last().ok_or(StoryError::Invalid)?;
    if session.last_chapter_id != chapter.id
        || session.chapter_count != chapter.index
        || session.updated_at != chapter.created_at
        || session.working_checkpoint_id != output.id
        || output.boundary_index != chapter.index
        || output.chapter_id.as_ref() != Some(&chapter.id)
        || (manifest.expected_revision == 0
            && (chapter.index != 1
                || session.last_input_checkpoint_id != checkpoints[0].id
                || checkpoints[0].id == output.id))
    {
        return Err(StoryError::Invalid);
    }
    let receipt = StoryReceipt {
        version: 1,
        operation_id: manifest.operation_id.clone(),
        session_id: session.id.clone(),
        chapter_id: chapter.id.clone(),
        chapter_index: chapter.index,
        revision: session.revision,
        chapter_count: session.chapter_count,
        checkpoint_ids: checkpoints.iter().map(|c| c.id.clone()).collect(),
        wire_digest: manifest.wire_digest()?,
    };
    Ok(Validated {
        session,
        chapter,
        checkpoints,
        receipt,
    })
}
fn write_stage(
    connection: &Connection,
    stage: &mut Stage,
    validated: &Validated,
    hook: &mut impl FnMut(&str) -> Result<(), StoryError>,
) -> Result<(), StoryError> {
    write_documents(
        connection,
        &stage.manifest,
        validated,
        &mut |kind| {
            read_part(
                stage
                    .parts
                    .iter_mut()
                    .find(|p| p.declaration.kind == kind)
                    .ok_or(StoryError::Invalid)?,
            )
        },
        hook,
    )
}
fn write_documents(
    connection: &Connection,
    manifest: &CommitManifest,
    validated: &Validated,
    read: &mut impl FnMut(PartKind) -> Result<String, StoryError>,
    hook: &mut impl FnMut(&str) -> Result<(), StoryError>,
) -> Result<(), StoryError> {
    let s = &validated.session;
    let c = &validated.chapter;
    for part in &manifest.parts {
        let document = read(part.kind)?;
        let bytes = part.byte_length;
        let digest = &part.digest;
        match part.kind {
            PartKind::Session => {
                if manifest.expected_revision == 0 {
                    connection.execute("INSERT INTO arena_story_session (id,document,document_bytes,document_digest,seed_document,seed_bytes,seed_digest,revision,title_preview,title_truncated,mode,chapter_plan,created_at,updated_at,chapter_count,last_chapter_id,working_checkpoint_id,last_input_checkpoint_id) VALUES (?1,?2,?3,?4,'',0,'',?5,?6,?7,?8,?15,?9,?10,?11,?12,?13,?14)",
                        params![s.id,document,bytes,digest,s.revision,s.title_preview,s.title_truncated,s.mode,s.created_at,s.updated_at,s.chapter_count,s.last_chapter_id,s.working_checkpoint_id,s.last_input_checkpoint_id,s.chapter_plan.as_ref().map(serde_json::to_string).transpose().map_err(|_|StoryError::Invalid)?]).map_err(|_| StoryError::Io)?;
                } else {
                    let changed = connection.execute("UPDATE arena_story_session SET document=?2,document_bytes=?3,document_digest=?4,revision=?5,title_preview=?6,title_truncated=?7,mode=?8,chapter_plan=?16,updated_at=?9,chapter_count=?10,last_chapter_id=?11,working_checkpoint_id=?12,last_input_checkpoint_id=?13 WHERE id=?1 AND revision=?14 AND last_chapter_id=?15",
                        params![s.id,document,bytes,digest,s.revision,s.title_preview,s.title_truncated,s.mode,s.updated_at,s.chapter_count,s.last_chapter_id,s.working_checkpoint_id,s.last_input_checkpoint_id,manifest.expected_revision,manifest.expected_last_chapter_id,s.chapter_plan.as_ref().map(serde_json::to_string).transpose().map_err(|_|StoryError::Invalid)?]).map_err(|_| StoryError::Io)?;
                    if changed != 1 {
                        return Err(StoryError::Conflict);
                    }
                }
                hook("session")?;
            }
            PartKind::Seed => {
                connection.execute("UPDATE arena_story_session SET seed_document=?2,seed_bytes=?3,seed_digest=?4 WHERE id=?1", params![s.id,document,bytes,digest]).map_err(|_| StoryError::Io)?;
                hook("seed")?;
            }
            PartKind::Chapter => {
                let receipt =
                    serde_json::to_string(&validated.receipt).map_err(|_| StoryError::Invalid)?;
                connection.execute("INSERT INTO arena_story_chapter (id,session_id,chapter_index,action,source_chapter_id,title_preview,title_truncated,created_at,markdown_bytes,document,document_bytes,document_digest,operation_id,operation_digest,receipt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                    params![c.id,c.session_id,c.index,c.action,c.source_chapter_id,c.title_preview,c.title_truncated,c.created_at,c.markdown_byte_length,document,bytes,digest,validated.receipt.operation_id,validated.receipt.wire_digest,receipt]).map_err(|_| StoryError::Io)?;
                let actual_markdown_bytes:u64=connection.query_row("SELECT length(CAST(json_extract(document,'$.markdown') AS BLOB)) FROM arena_story_chapter WHERE id=?1",[&c.id],|row|row.get(0)).map_err(|_|StoryError::Invalid)?;
                if actual_markdown_bytes != c.markdown_byte_length {
                    return Err(StoryError::Invalid);
                }
                hook("chapter")?;
            }
            PartKind::Checkpoint0 | PartKind::Checkpoint1 => {
                let checkpoint = if part.kind == PartKind::Checkpoint0 {
                    &validated.checkpoints[0]
                } else {
                    validated.checkpoints.last().ok_or(StoryError::Invalid)?
                };
                connection.execute("INSERT INTO arena_story_checkpoint (id,session_id,boundary_index,chapter_id,document,document_bytes,document_digest) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![checkpoint.id,checkpoint.session_id,checkpoint.boundary_index,checkpoint.chapter_id,document,bytes,digest]).map_err(|_| StoryError::Io)?;
                hook(if part.kind == PartKind::Checkpoint0 {
                    "checkpoint0"
                } else {
                    "checkpoint1"
                })?;
            }
        }
    }
    Ok(())
}

/// Backup verifies relationships, not only SQLite's structural integrity. All old
/// schema versions bypass this audit; v5 requires the complete append-only chain.
pub(crate) fn audit_relations(connection: &Connection) -> Result<(), StoryError> {
    // The same bounded metadata accepted by end must remain bounded after restore;
    // never fetch an attacker-sized preview before applying the page byte policy.
    for sql in [
        "SELECT EXISTS(SELECT 1 FROM arena_story_session WHERE length(id) NOT BETWEEN 1 AND 128 OR id GLOB '*[^A-Za-z0-9_-]*' OR revision NOT BETWEEN 1 AND 9007199254740991 OR chapter_count NOT BETWEEN 1 AND 9007199254740991 OR created_at NOT BETWEEN 0 AND 9007199254740991 OR updated_at NOT BETWEEN created_at AND 9007199254740991 OR length(CAST(title_preview AS BLOB))>192 OR title_truncated NOT IN (0,1) OR mode NOT IN ('classic','kizuna','daily','scenario') OR length(CAST(chapter_plan AS BLOB))>512 OR (chapter_plan IS NOT NULL AND (NOT json_valid(chapter_plan) OR json_type(chapter_plan,'$.totalChapters') IS NOT 'integer' OR json_extract(chapter_plan,'$.totalChapters') NOT BETWEEN 1 AND 20 OR json_type(chapter_plan,'$.source') IS NOT 'text' OR json_extract(chapter_plan,'$.source') NOT IN ('user','scenario') OR json_type(chapter_plan,'$.locked') IS NULL OR json_type(chapter_plan,'$.locked') NOT IN ('true','false'))))",
        "SELECT EXISTS(SELECT 1 FROM arena_story_chapter WHERE length(id) NOT BETWEEN 1 AND 128 OR id GLOB '*[^A-Za-z0-9_-]*' OR chapter_index NOT BETWEEN 1 AND 9007199254740991 OR created_at NOT BETWEEN 0 AND 9007199254740991 OR markdown_bytes NOT BETWEEN 0 AND 9007199254740991 OR length(CAST(title_preview AS BLOB))>192 OR title_truncated NOT IN (0,1) OR action NOT IN ('start','continue'))",
        "SELECT EXISTS(SELECT 1 FROM arena_story_checkpoint WHERE length(id) NOT BETWEEN 1 AND 128 OR id GLOB '*[^A-Za-z0-9_-]*' OR boundary_index NOT BETWEEN 0 AND 9007199254740991)",
    ] { if connection.query_row(sql,[],|row|row.get::<_,bool>(0)).map_err(|_|StoryError::Corrupt)? { return Err(StoryError::Corrupt); } }

    let invalid: bool = connection.query_row(r#"SELECT EXISTS(
        SELECT 1 FROM arena_story_session s
        LEFT JOIN arena_story_chapter h ON h.session_id=s.id AND h.id=s.last_chapter_id
        LEFT JOIN arena_story_checkpoint w ON w.session_id=s.id AND w.id=s.working_checkpoint_id
        LEFT JOIN arena_story_checkpoint i ON i.session_id=s.id AND i.id=s.last_input_checkpoint_id
        WHERE h.chapter_index IS NOT s.chapter_count OR w.boundary_index IS NOT s.chapter_count
           OR w.chapter_id IS NOT h.id OR i.boundary_index IS NOT s.chapter_count-1
           OR s.chapter_count != (SELECT count(*) FROM arena_story_chapter c WHERE c.session_id=s.id)
           OR s.chapter_count+1 != (SELECT count(*) FROM arena_story_checkpoint p WHERE p.session_id=s.id)
           OR s.seed_bytes <= 0 OR s.revision != s.chapter_count
        UNION ALL
        SELECT 1 FROM arena_story_chapter c
        LEFT JOIN arena_story_chapter p ON p.session_id=c.session_id AND p.chapter_index=c.chapter_index-1
        WHERE (c.chapter_index=1 AND (c.action!='start' OR c.source_chapter_id IS NOT NULL))
           OR (c.chapter_index>1 AND (c.action!='continue' OR c.source_chapter_id IS NOT p.id OR p.id IS NULL))
        UNION ALL
        SELECT 1 FROM arena_story_checkpoint p
        LEFT JOIN arena_story_chapter c ON c.session_id=p.session_id AND c.id=p.chapter_id
        WHERE (p.boundary_index=0 AND p.chapter_id IS NOT NULL)
           OR (p.boundary_index>0 AND (c.chapter_index IS NOT p.boundary_index))
    )"#, [], |row| row.get(0)).map_err(|_| StoryError::Corrupt)?;
    if invalid {
        return Err(StoryError::Corrupt);
    }
    // Fail closed on a backup whose JSON disagrees with the indexed relationship,
    // including forged receipts. Unknown payload fields are never normalized.
    for sql in [
        "SELECT EXISTS(SELECT 1 FROM arena_story_session WHERE NOT json_valid(document) OR NOT json_valid(seed_document) OR json_extract(document,'$.id') IS NOT id OR json_extract(document,'$.revision') IS NOT revision OR json_extract(document,'$.chapterCount') IS NOT chapter_count OR json_extract(document,'$.lastChapterId') IS NOT last_chapter_id OR json_extract(document,'$.workingCheckpointId') IS NOT working_checkpoint_id OR json_extract(document,'$.lastInputCheckpointId') IS NOT last_input_checkpoint_id OR json_extract(document,'$.titlePreview') IS NOT title_preview OR json_extract(document,'$.titleTruncated') IS NOT title_truncated OR json_extract(document,'$.mode') IS NOT mode OR json_extract(document,'$.source.mode') IS NOT mode OR json_extract(document,'$.createdAt') IS NOT created_at OR json_extract(document,'$.updatedAt') IS NOT updated_at OR json_extract(document,'$.chapterPlan.totalChapters') IS NOT json_extract(chapter_plan,'$.totalChapters') OR json_extract(document,'$.chapterPlan.source') IS NOT json_extract(chapter_plan,'$.source') OR json_extract(document,'$.chapterPlan.locked') IS NOT json_extract(chapter_plan,'$.locked') OR json_type(document,'$.seed') IS NOT NULL OR json_type(document,'$.workingCombatants') IS NOT NULL OR json_type(document,'$.lastChapterInputCombatants') IS NOT NULL OR json_type(seed_document,'$.combatants') IS NOT 'array')",
        "SELECT EXISTS(SELECT 1 FROM arena_story_chapter WHERE NOT json_valid(document) OR NOT json_valid(receipt) OR json_extract(document,'$.id') IS NOT id OR json_extract(document,'$.sessionId') IS NOT session_id OR json_extract(document,'$.index') IS NOT chapter_index OR json_extract(document,'$.action') IS NOT action OR json_extract(document,'$.sourceChapterId') IS NOT source_chapter_id OR json_extract(document,'$.status') IS NOT 'active' OR json_extract(document,'$.titlePreview') IS NOT title_preview OR json_extract(document,'$.titleTruncated') IS NOT title_truncated OR json_extract(document,'$.createdAt') IS NOT created_at OR json_extract(document,'$.markdownByteLength') IS NOT markdown_bytes OR length(CAST(json_extract(document,'$.markdown') AS BLOB)) IS NOT markdown_bytes OR operation_id IS NOT id OR json_extract(receipt,'$.operationId') IS NOT operation_id OR json_extract(receipt,'$.sessionId') IS NOT session_id OR json_extract(receipt,'$.chapterId') IS NOT id OR json_extract(receipt,'$.chapterIndex') IS NOT chapter_index OR json_extract(receipt,'$.revision') IS NOT chapter_index OR json_extract(receipt,'$.chapterCount') IS NOT chapter_index OR json_extract(receipt,'$.wireDigest') IS NOT operation_digest)",
        "SELECT EXISTS(SELECT 1 FROM arena_story_checkpoint WHERE NOT json_valid(document) OR json_extract(document,'$.id') IS NOT id OR json_extract(document,'$.sessionId') IS NOT session_id OR json_extract(document,'$.boundaryIndex') IS NOT boundary_index OR json_extract(document,'$.chapterId') IS NOT chapter_id OR json_type(document,'$.combatants') IS NOT 'array')",
    ] {
        if connection.query_row(sql,[],|row|row.get::<_,bool>(0)).map_err(|_|StoryError::Corrupt)? { return Err(StoryError::Corrupt); }
    }
    {
        let mut statement = connection
            .prepare("SELECT session_id,operation_id FROM arena_story_chapter")
            .map_err(|_| StoryError::Corrupt)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| StoryError::Corrupt)?;
        for row in rows {
            let (session_id, operation_id) = row.map_err(|_| StoryError::Corrupt)?;
            read_receipt(connection, &session_id, &operation_id)
                .map_err(|_| StoryError::Corrupt)?
                .ok_or(StoryError::Corrupt)?;
        }
    }
    // Hash one fixed column through SQLite's incremental read API. Backup validation
    // never accumulates all stories, all records or a large binary+Value duplicate.
    for (table, column, length_column, digest_column) in [
        (
            "arena_story_session",
            "document",
            "document_bytes",
            "document_digest",
        ),
        (
            "arena_story_session",
            "seed_document",
            "seed_bytes",
            "seed_digest",
        ),
        (
            "arena_story_chapter",
            "document",
            "document_bytes",
            "document_digest",
        ),
        (
            "arena_story_checkpoint",
            "document",
            "document_bytes",
            "document_digest",
        ),
    ] {
        let mut statement = connection
            .prepare(&format!(
                "SELECT rowid,{length_column},{digest_column} FROM {table}"
            ))
            .map_err(|_| StoryError::Corrupt)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| StoryError::Corrupt)?;
        for row in rows {
            let (rowid, length, expected) = row.map_err(|_| StoryError::Corrupt)?;
            if length == 0 || length > CANDIDATE_COMMIT_BYTES || !valid_digest(&expected) {
                return Err(StoryError::Corrupt);
            }
            let mut blob = connection
                .blob_open("main", table, column, rowid, true)
                .map_err(|_| StoryError::Corrupt)?;
            if blob.len() as u64 != length {
                return Err(StoryError::Corrupt);
            }
            let mut hash = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let n = blob.read(&mut buffer).map_err(|_| StoryError::Corrupt)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            if format!("sha256:{:x}", hash.finalize()) != expected {
                return Err(StoryError::Corrupt);
            }
        }
    }
    Ok(())
}

#[path = "arena_story_read.rs"]
pub mod read;
#[cfg(test)]
#[path = "arena_story_tests.rs"]
mod tests;

#[path = "arena_story_ipc.rs"]
pub mod ipc;
#[path = "arena_story_export.rs"]
pub mod markdown_export;

#[path = "arena_story_pending.rs"]
pub mod pending;
