//! Non-secret durable Hosted story candidates. No transport, credentials or jobs.
//! P: two product slots ×128MiB. T: existing Direct stages + unpublished uploads,
//! at most two and 128MiB total. Metadata is closed and separately bounded.
use super::*;

pub const METADATA_BYTES: usize = 64 * 1024;
const INPUT_BYTES: u64 = 12 * 1024 * 1024;
const OUTPUT_BYTES: u64 = 4 * 1024 * 1024;
const ROLE_BYTES: u64 = 16 * 1024 * 1024;

pub(crate) const MIGRATION_6: &str = r#"
CREATE TABLE arena_story_pending (
 token TEXT PRIMARY KEY NOT NULL,
 product TEXT NOT NULL CHECK(product IN ('battle','arena')),
 request_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 metadata TEXT NOT NULL CHECK(length(CAST(metadata AS BLOB))<=65536),
 total_bytes INTEGER NOT NULL CHECK(total_bytes>0 AND total_bytes<=134217728),
 save_attempt TEXT, restored INTEGER NOT NULL DEFAULT 0 CHECK(restored IN (0,1))
) STRICT;
CREATE UNIQUE INDEX arena_story_pending_product ON arena_story_pending(product) WHERE active=1;
CREATE TABLE arena_story_pending_part (
 id INTEGER PRIMARY KEY, token TEXT NOT NULL, kind TEXT NOT NULL,
 byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=134217728),
 received_bytes INTEGER NOT NULL CHECK(received_bytes>=0 AND received_bytes<=byte_length),
 digest TEXT NOT NULL, payload BLOB NOT NULL CHECK(length(payload)=byte_length),
 UNIQUE(token,kind), FOREIGN KEY(token) REFERENCES arena_story_pending(token) ON DELETE CASCADE
) STRICT;
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Product {
    Battle,
    Arena,
}
impl Product {
    fn sql(self) -> &'static str {
        match self {
            Self::Battle => "battle",
            Self::Arena => "arena",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Actor {
    Anonymous,
    Account {
        #[serde(rename = "expectedUserId")]
        expected_user_id: u64,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PendingKind {
    Input,
    Markdown,
    Reasoning,
    Meta,
    Header,
    RoleResponse,
    Session,
    Seed,
    Chapter,
    Checkpoint0,
    Checkpoint1,
}
impl PendingKind {
    pub fn parse(value: &str) -> Result<Self, StoryError> {
        serde_json::from_value(serde_json::Value::String(value.into()))
            .map_err(|_| StoryError::Invalid)
    }
    fn sql(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Markdown => "markdown",
            Self::Reasoning => "reasoning",
            Self::Meta => "meta",
            Self::Header => "header",
            Self::RoleResponse => "roleResponse",
            Self::Session => "session",
            Self::Seed => "seed",
            Self::Chapter => "chapter",
            Self::Checkpoint0 => "checkpoint0",
            Self::Checkpoint1 => "checkpoint1",
        }
    }
    fn order(self) -> usize {
        self as usize
    }
    fn commit(self) -> Option<PartKind> {
        match self {
            Self::Session => Some(PartKind::Session),
            Self::Seed => Some(PartKind::Seed),
            Self::Chapter => Some(PartKind::Chapter),
            Self::Checkpoint0 => Some(PartKind::Checkpoint0),
            Self::Checkpoint1 => Some(PartKind::Checkpoint1),
            _ => None,
        }
    }
    fn from_commit(kind: PartKind) -> Self {
        match kind {
            PartKind::Session => Self::Session,
            PartKind::Seed => Self::Seed,
            PartKind::Chapter => Self::Chapter,
            PartKind::Checkpoint0 => Self::Checkpoint0,
            PartKind::Checkpoint1 => Self::Checkpoint1,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingPart {
    pub kind: PendingKind,
    pub byte_length: u64,
    pub digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteOptions {
    pub write_arena_history: bool,
    pub write_current_state: bool,
    pub write_narrative_history: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoleState {
    NotRequested,
    Unresolved,
    Accepted,
    OldRoles,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingManifest {
    pub version: u32,
    pub product: Product,
    pub request_id: String,
    pub actor: Actor,
    pub pending_revision: u64,
    pub session_id: String,
    pub operation_id: String,
    pub output_checkpoint_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub initial_checkpoint_id: Option<String>,
    pub created_at: u64,
    pub expected_revision: u64,
    #[serde(deserialize_with = "required_nullable")]
    pub expected_last_chapter_id: Option<String>,
    pub last_input_checkpoint_id: String,
    pub input_digest: String,
    pub write_options: WriteOptions,
    pub model_completed: bool,
    pub role_state: RoleState,
    #[serde(deserialize_with = "required_nullable")]
    pub role_input_digest: Option<String>,
    pub parts: Vec<PendingPart>,
    #[serde(deserialize_with = "required_commit_manifest")]
    pub commit_manifest: Option<CommitManifest>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingKey {
    pub product: Product,
    pub request_id: String,
    pub pending_revision: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingSnapshot {
    pub manifest: PendingManifest,
    pub save_attempt_id: Option<String>,
    pub restored: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingOffset {
    pub kind: PendingKind,
    pub received_bytes: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingUpload {
    pub token: String,
    pub manifest: PendingManifest,
    pub received_bytes: Vec<PendingOffset>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingAppend {
    pub token: String,
    pub kind: PendingKind,
    pub received_bytes: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavePreparation {
    pub attempt_id: String,
}

fn required_commit_manifest<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<CommitManifest>, D::Error> {
    let raw = Option::<Box<RawValue>>::deserialize(deserializer)?;
    raw.map(|raw| {
        let fields: Object<'_> =
            serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)?;
        if !fields.contains_key("expectedLastChapterId") {
            return Err(serde::de::Error::custom(
                "expectedLastChapterId must be explicit",
            ));
        }
        serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)
    })
    .transpose()
}

fn required_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}

fn request_id(value: &str) -> bool {
    (8..=128).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
impl PendingManifest {
    pub fn validate(&self) -> Result<u64, StoryError> {
        if serde_json::to_vec(self)
            .map_err(|_| StoryError::Invalid)?
            .len()
            > METADATA_BYTES
        {
            return Err(StoryError::TooLarge);
        }
        if self.version != 1
            || !request_id(&self.request_id)
            || !(1..=MAX_SAFE_INTEGER).contains(&self.pending_revision)
            || self.created_at > MAX_SAFE_INTEGER
            || self.expected_revision >= MAX_SAFE_INTEGER
            || ![
                &self.session_id,
                &self.operation_id,
                &self.output_checkpoint_id,
                &self.last_input_checkpoint_id,
            ]
            .iter()
            .all(|s| valid_id(s))
            || self
                .initial_checkpoint_id
                .as_deref()
                .is_some_and(|s| !valid_id(s))
            || self
                .expected_last_chapter_id
                .as_deref()
                .is_some_and(|s| !valid_id(s))
            || (self.expected_revision == 0) != self.expected_last_chapter_id.is_none()
            || (self.expected_revision == 0) != self.initial_checkpoint_id.is_some()
            || self.initial_checkpoint_id.as_ref().is_some_and(|s| {
                s != &self.last_input_checkpoint_id || s == &self.output_checkpoint_id
            })
            || matches!(self.actor,Actor::Account{expected_user_id} if expected_user_id==0 || expected_user_id>MAX_SAFE_INTEGER)
            || !valid_digest(&self.input_digest)
            || self
                .role_input_digest
                .as_deref()
                .is_some_and(|s| !valid_digest(s))
            || self.parts.is_empty()
            || self.parts.len() > 11
        {
            return Err(StoryError::Invalid);
        }
        let mut total = 0u64;
        let mut output = 0u64;
        for (index, p) in self.parts.iter().enumerate() {
            if p.byte_length == 0
                || !valid_digest(&p.digest)
                || (index > 0 && self.parts[index - 1].kind.order() >= p.kind.order())
            {
                return Err(StoryError::Invalid);
            }
            let limit = match p.kind {
                PendingKind::Input => INPUT_BYTES,
                PendingKind::Markdown | PendingKind::Reasoning => OUTPUT_BYTES,
                PendingKind::Meta => 6 * OUTPUT_BYTES + 65536,
                PendingKind::Header => 65536,
                PendingKind::RoleResponse => ROLE_BYTES,
                _ => CANDIDATE_COMMIT_BYTES,
            };
            if p.byte_length > limit {
                return Err(StoryError::TooLarge);
            }
            total = total
                .checked_add(p.byte_length)
                .ok_or(StoryError::TooLarge)?;
            if matches!(p.kind, PendingKind::Markdown | PendingKind::Reasoning) {
                output += p.byte_length;
            }
        }
        if total > CANDIDATE_COMMIT_BYTES || output > OUTPUT_BYTES {
            return Err(StoryError::TooLarge);
        }
        if self.parts[0].kind != PendingKind::Input
            || self.parts[0].digest != self.input_digest
            || (self.role_state == RoleState::Accepted)
                != self
                    .parts
                    .iter()
                    .any(|p| p.kind == PendingKind::RoleResponse)
            || (self.role_state == RoleState::NotRequested) != self.role_input_digest.is_none()
        {
            return Err(StoryError::Invalid);
        }
        let commits: Vec<_> = self
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
        match &self.commit_manifest {
            None if !commits.is_empty() => return Err(StoryError::Invalid),
            Some(m) => {
                m.validate()?;
                if m.parts != commits
                    || m.session_id != self.session_id
                    || m.operation_id != self.operation_id
                    || m.expected_revision != self.expected_revision
                    || m.expected_last_chapter_id != self.expected_last_chapter_id
                    || !self.model_completed
                    || self.role_state == RoleState::Unresolved
                {
                    return Err(StoryError::Invalid);
                }
            }
            _ => {}
        }
        Ok(total)
    }
    fn key(&self) -> PendingKey {
        PendingKey {
            product: self.product,
            request_id: self.request_id.clone(),
            pending_revision: self.pending_revision,
        }
    }
}
struct Stored {
    token: String,
    snapshot: PendingSnapshot,
    active: bool,
    total: u64,
}
fn load(connection: &Connection, token: &str) -> Result<Stored, StoryError> {
    let row:Option<(String,bool,u64,Option<String>,bool)>=connection.query_row("SELECT CASE WHEN length(CAST(metadata AS BLOB))<=65536 THEN metadata ELSE NULL END,active,total_bytes,save_attempt,restored FROM arena_story_pending WHERE token=?1",[token],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(|_|StoryError::Corrupt)?;
    let (document, active, total, save_attempt_id, restored) = row.ok_or(StoryError::Stale)?;
    let manifest: PendingManifest =
        serde_json::from_str(&document).map_err(|_| StoryError::Corrupt)?;
    if manifest.validate()? != total {
        return Err(StoryError::Corrupt);
    }
    Ok(Stored {
        token: token.into(),
        snapshot: PendingSnapshot {
            manifest,
            save_attempt_id,
            restored,
        },
        active,
        total,
    })
}
fn active(connection: &Connection, product: Product) -> Result<Option<Stored>, StoryError> {
    let token: Option<String> = connection
        .query_row(
            "SELECT token FROM arena_story_pending WHERE product=?1 AND active=1",
            [product.sql()],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| StoryError::Io)?;
    token.map(|t| load(connection, &t)).transpose()
}
fn exact(connection: &Connection, key: &PendingKey) -> Result<Stored, StoryError> {
    let row = active(connection, key.product)?.ok_or(StoryError::Missing)?;
    if row.snapshot.manifest.key() != *key {
        return Err(StoryError::Stale);
    }
    Ok(row)
}
pub(super) fn upload_reservations(connection: &Connection) -> Result<(usize, u64), StoryError> {
    connection
        .query_row(
            "SELECT count(*),coalesce(sum(total_bytes),0) FROM arena_story_pending WHERE active=0",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| StoryError::Io)
}
pub(super) fn recover_uploads(connection: &Connection) -> Result<(), StoryError> {
    connection
        .execute("DELETE FROM arena_story_pending WHERE active=0", [])
        .map_err(|_| StoryError::Io)?;
    Ok(())
}
fn compatible(old: &PendingSnapshot, next: &PendingManifest) -> Result<(), StoryError> {
    let m = &old.manifest;
    if old.restored || old.save_attempt_id.is_some() {
        return Err(StoryError::CommitUnknown);
    }
    if m.commit_manifest.is_some()
        || m.pending_revision.checked_add(1) != Some(next.pending_revision)
        || m.product != next.product
        || m.request_id != next.request_id
        || m.actor != next.actor
        || m.session_id != next.session_id
        || m.operation_id != next.operation_id
        || m.output_checkpoint_id != next.output_checkpoint_id
        || m.initial_checkpoint_id != next.initial_checkpoint_id
        || m.created_at != next.created_at
        || m.expected_revision != next.expected_revision
        || m.expected_last_chapter_id != next.expected_last_chapter_id
        || m.last_input_checkpoint_id != next.last_input_checkpoint_id
        || m.input_digest != next.input_digest
        || m.write_options != next.write_options
        || (m.model_completed && !next.model_completed)
        || (m.role_input_digest.is_some() && m.role_input_digest != next.role_input_digest)
        || (m.role_state == RoleState::Unresolved && next.role_state == RoleState::NotRequested)
        || (matches!(m.role_state, RoleState::Accepted | RoleState::OldRoles)
            && (next.role_state != m.role_state || next.role_input_digest != m.role_input_digest))
        || m.parts.iter().any(|p| !next.parts.contains(p))
    {
        return Err(StoryError::Conflict);
    }
    Ok(())
}
fn check_candidate(connection: &Connection, m: &PendingManifest) -> Result<(), StoryError> {
    match active(connection, m.product)? {
        Some(old) => compatible(&old.snapshot, m),
        None if m.pending_revision == 1 => Ok(()),
        _ => Err(StoryError::Conflict),
    }
}
fn no_space(root: &Path, bytes: u64) -> Result<(), StoryError> {
    if fs4::available_space(root).map_err(|_| StoryError::Io)? < bytes {
        return Err(StoryError::ExportNoSpace);
    }
    Ok(())
}
fn part_row(
    connection: &Connection,
    token: &str,
    kind: PendingKind,
) -> Result<(i64, u64, u64, String), StoryError> {
    connection.query_row("SELECT id,byte_length,received_bytes,digest FROM arena_story_pending_part WHERE token=?1 AND kind=?2",params![token,kind.sql()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|_|StoryError::Io)?.ok_or(StoryError::Missing)
}
fn read_blob(
    connection: &Connection,
    token: &str,
    kind: PendingKind,
) -> Result<String, StoryError> {
    let (id, length, received, expected) = part_row(connection, token, kind)?;
    if length != received {
        return Err(StoryError::Incomplete);
    }
    let mut blob = connection
        .blob_open("main", "arena_story_pending_part", "payload", id, true)
        .map_err(|_| StoryError::Io)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(length as usize)
        .map_err(|_| StoryError::TooLarge)?;
    blob.read_to_end(&mut bytes).map_err(|_| StoryError::Io)?;
    if bytes.len() as u64 != length || digest(&bytes) != expected {
        return Err(StoryError::Corrupt);
    }
    String::from_utf8(bytes).map_err(|_| StoryError::Invalid)
}
fn hash_blob(
    connection: &Connection,
    id: i64,
    length: u64,
    expected: &str,
) -> Result<(), StoryError> {
    let mut blob = connection
        .blob_open("main", "arena_story_pending_part", "payload", id, true)
        .map_err(|_| StoryError::Corrupt)?;
    if blob.len() as u64 != length {
        return Err(StoryError::Corrupt);
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
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
    Ok(())
}

impl StoryStore {
    pub fn pending_begin(&self, manifest: PendingManifest) -> Result<BeginOutcome, StoryError> {
        let total = manifest.validate()?;
        let _permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        let mut stages = self.stages.lock().map_err(|_| StoryError::Io)?;
        stages.retain(|_, s| s.created_at.elapsed() < STAGE_LIFETIME);
        let mut connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let metadata = serde_json::to_string(&manifest).map_err(|_| StoryError::Invalid)?;
        let existing: Option<String> = connection
            .query_row(
                "SELECT token FROM arena_story_pending WHERE active=0 AND metadata=?1",
                [&metadata],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| StoryError::Io)?;
        if let Some(token) = existing {
            return Ok(BeginOutcome {
                token,
                total_bytes: total,
            });
        }
        check_candidate(&connection, &manifest)?;
        let (count, bytes) = upload_reservations(&connection)?;
        let reserved: u64 = stages.values().map(|s| s.total).sum();
        if count + stages.len() >= MAX_STAGES
            || total > STAGING_BYTES.saturating_sub(bytes + reserved)
        {
            return Err(StoryError::Busy);
        }
        no_space(&self.staging_root, total)?;
        let token = format!("{}-{}", self.instance, random_id()?);
        let tx = connection.transaction().map_err(|_| StoryError::Io)?;
        tx.execute("INSERT INTO arena_story_pending(token,product,request_id,revision,active,metadata,total_bytes) VALUES(?1,?2,?3,?4,0,?5,?6)",params![token,manifest.product.sql(),manifest.request_id,manifest.pending_revision,metadata,total]).map_err(|_|StoryError::Io)?;
        for p in &manifest.parts {
            tx.execute("INSERT INTO arena_story_pending_part(token,kind,byte_length,received_bytes,digest,payload) VALUES(?1,?2,?3,0,?4,zeroblob(?3))",params![token,p.kind.sql(),p.byte_length,p.digest]).map_err(|_|StoryError::Io)?;
        }
        tx.commit().map_err(|_| StoryError::Io)?;
        Ok(BeginOutcome {
            token,
            total_bytes: total,
        })
    }
    pub fn pending_upload(&self, token: &str) -> Result<PendingUpload, StoryError> {
        ipc::token(Some(token))?;
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = load(&connection, token)?;
        let received_bytes = row
            .snapshot
            .manifest
            .parts
            .iter()
            .map(|p| {
                part_row(&connection, token, p.kind).map(|(_, _, received, _)| PendingOffset {
                    kind: p.kind,
                    received_bytes: received,
                })
            })
            .collect::<Result<_, _>>()?;
        Ok(PendingUpload {
            token: token.into(),
            manifest: row.snapshot.manifest,
            received_bytes,
        })
    }
    pub fn pending_append(
        &self,
        token: &str,
        kind: PendingKind,
        offset: u64,
        bytes: &[u8],
    ) -> Result<PendingAppend, StoryError> {
        ipc::token(Some(token))?;
        if bytes.is_empty() || bytes.len() > CANDIDATE_FRAME_BYTES {
            return Err(StoryError::TooLarge);
        }
        let _permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        let mut inputs = self.pending_inputs.lock().map_err(|_| StoryError::Io)?;
        let mut connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = load(&connection, token)?;
        if row.active {
            return Err(StoryError::Stale);
        }
        let (id, length, received, _) = part_row(&connection, token, kind)?;
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or(StoryError::TooLarge)?;
        if end > length {
            return Err(StoryError::TooLarge);
        }
        // Replayed acknowledgement is accepted only for byte-identical committed range.
        if end <= received {
            let mut blob = connection
                .blob_open("main", "arena_story_pending_part", "payload", id, true)
                .map_err(|_| StoryError::Io)?;
            blob.seek(SeekFrom::Start(offset))
                .map_err(|_| StoryError::Io)?;
            let mut existing = vec![0; bytes.len()];
            blob.read_exact(&mut existing).map_err(|_| StoryError::Io)?;
            if existing != bytes {
                return Err(StoryError::Conflict);
            }
            return Ok(PendingAppend {
                token: token.into(),
                kind,
                received_bytes: received,
            });
        }
        let owned;
        let (write_offset, write_bytes) = if buffered(kind) {
            let input = inputs.entry((token.into(), kind)).or_default();
            if offset < input.len() as u64 && end <= input.len() as u64 {
                if &input[offset as usize..end as usize] != bytes {
                    return Err(StoryError::Conflict);
                }
                return Ok(PendingAppend {
                    token: token.into(),
                    kind,
                    received_bytes: input.len() as u64,
                });
            }
            if offset != input.len() as u64 {
                return Err(StoryError::Invalid);
            }
            input.extend_from_slice(bytes);
            if end < length {
                return Ok(PendingAppend {
                    token: token.into(),
                    kind,
                    received_bytes: end,
                });
            }
            owned = inputs.remove(&(token.into(), kind)).ok_or(StoryError::Io)?;
            validate_carrier(&owned, kind, &row.snapshot.manifest)?;
            (0, owned.as_slice())
        } else {
            if received != offset {
                return Err(StoryError::Invalid);
            }
            (offset, bytes)
        };
        let tx = connection.transaction().map_err(|_| StoryError::Io)?;
        {
            let mut blob = tx
                .blob_open("main", "arena_story_pending_part", "payload", id, false)
                .map_err(|_| StoryError::Io)?;
            blob.seek(SeekFrom::Start(write_offset))
                .map_err(|_| StoryError::Io)?;
            blob.write_all(write_bytes).map_err(|_| StoryError::Io)?;
        }
        tx.execute(
            "UPDATE arena_story_pending_part SET received_bytes=?2 WHERE id=?1",
            params![id, end],
        )
        .map_err(|_| StoryError::Io)?;
        tx.commit().map_err(|_| StoryError::Io)?;
        Ok(PendingAppend {
            token: token.into(),
            kind,
            received_bytes: end,
        })
    }
    pub fn pending_abort(&self, token: &str) -> Result<(), StoryError> {
        self.pending_abort_with_hook(token, &mut || {})
    }
    fn pending_abort_with_hook(
        &self,
        token: &str,
        hook: &mut impl FnMut(),
    ) -> Result<(), StoryError> {
        ipc::token(Some(token))?;
        let _permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        // Keep the same inputs → connection lock order as append. Holding both
        // through deletion prevents an append from recreating an orphan buffer.
        let mut inputs = self.pending_inputs.lock().map_err(|_| StoryError::Io)?;
        hook();
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        connection
            .execute(
                "DELETE FROM arena_story_pending WHERE token=?1 AND active=0",
                [token],
            )
            .map_err(|_| StoryError::Io)?;
        inputs.retain(|(id, _), _| id != token);
        Ok(())
    }
    pub fn pending_seal(&self, token: &str) -> Result<PendingSnapshot, StoryError> {
        self.pending_seal_with_hook(token, &mut |_| Ok(()))
    }
    fn pending_seal_with_hook(
        &self,
        token: &str,
        hook: &mut impl FnMut(&str) -> Result<(), StoryError>,
    ) -> Result<PendingSnapshot, StoryError> {
        ipc::token(Some(token))?;
        let _permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        // Same order as Direct begin/end; the reservation and P/T transition are atomic.
        let _stages = self.stages.lock().map_err(|_| StoryError::Io)?;
        let mut connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = load(&connection, token)?;
        if row.active {
            return Ok(row.snapshot);
        }
        validate_payload(&connection, &row)?;
        check_candidate(&connection, &row.snapshot.manifest)?;
        hook("validated")?;
        let tx = connection.transaction().map_err(|_| StoryError::Io)?;
        tx.execute(
            "DELETE FROM arena_story_pending WHERE product=?1 AND active=1",
            [row.snapshot.manifest.product.sql()],
        )
        .map_err(|_| StoryError::Io)?;
        hook("old-removed")?;
        tx.execute(
            "UPDATE arena_story_pending SET active=1 WHERE token=?1",
            [token],
        )
        .map_err(|_| StoryError::Io)?;
        hook("before-seal-commit")?;
        tx.commit().map_err(|_| StoryError::Io)?;
        hook("after-seal-commit")?;
        Ok(row.snapshot)
    }
    pub fn pending_describe(
        &self,
        product: Product,
    ) -> Result<Option<PendingSnapshot>, StoryError> {
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        Ok(active(&connection, product)?.map(|r| r.snapshot))
    }
    pub fn pending_read(
        &self,
        key: &PendingKey,
        kind: PendingKind,
        offset: u64,
        length: usize,
    ) -> Result<Vec<u8>, StoryError> {
        if length == 0 || length > CANDIDATE_FRAME_BYTES {
            return Err(StoryError::TooLarge);
        }
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = exact(&connection, key)?;
        let (id, bytes, received, _) = part_row(&connection, &row.token, kind)?;
        if received != bytes || offset >= bytes {
            return Err(StoryError::Invalid);
        }
        let mut blob = connection
            .blob_open("main", "arena_story_pending_part", "payload", id, true)
            .map_err(|_| StoryError::Io)?;
        blob.seek(SeekFrom::Start(offset))
            .map_err(|_| StoryError::Io)?;
        let mut result = vec![0; length.min((bytes - offset) as usize)];
        blob.read_exact(&mut result).map_err(|_| StoryError::Io)?;
        Ok(result)
    }
    pub fn pending_prepare_save(
        &self,
        key: &PendingKey,
        wire_digest: &str,
    ) -> Result<SavePreparation, StoryError> {
        let _permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        let mut attempts = self.pending_attempts.lock().map_err(|_| StoryError::Io)?;
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = exact(&connection, key)?;
        if row.snapshot.restored || row.snapshot.save_attempt_id.is_some() {
            return Err(StoryError::CommitUnknown);
        }
        let manifest = row
            .snapshot
            .manifest
            .commit_manifest
            .as_ref()
            .ok_or(StoryError::Incomplete)?;
        if manifest.wire_digest() != Ok(wire_digest.into()) {
            return Err(StoryError::OperationMismatch);
        }
        let attempt_id = format!("{}-{}", self.instance, random_id()?);
        connection
            .execute(
                "UPDATE arena_story_pending SET save_attempt=?2 WHERE token=?1",
                params![row.token, attempt_id],
            )
            .map_err(|_| StoryError::CommitUnknown)?;
        attempts.insert(attempt_id.clone(), row.token);
        Ok(SavePreparation { attempt_id })
    }
    pub fn pending_save(
        &self,
        key: &PendingKey,
        wire_digest: &str,
        attempt_id: &str,
    ) -> Result<StoryReceipt, StoryError> {
        self.pending_save_with_hook(key, wire_digest, attempt_id, &mut |_| Ok(()))
    }
    fn pending_save_with_hook(
        &self,
        key: &PendingKey,
        wire_digest: &str,
        attempt_id: &str,
        hook: &mut impl FnMut(&str) -> Result<(), StoryError>,
    ) -> Result<StoryReceipt, StoryError> {
        let _permit = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        let token = self
            .pending_attempts
            .lock()
            .map_err(|_| StoryError::Io)?
            .remove(attempt_id)
            .ok_or(StoryError::CommitUnknown)?;
        let mut connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = exact(&connection, key)?;
        if row.token != token
            || row.snapshot.restored
            || row.snapshot.save_attempt_id.as_deref() != Some(attempt_id)
        {
            return Err(StoryError::CommitUnknown);
        }
        let m = row
            .snapshot
            .manifest
            .commit_manifest
            .as_ref()
            .ok_or(StoryError::Incomplete)?;
        if m.wire_digest() != Ok(wire_digest.into()) {
            return Err(StoryError::OperationMismatch);
        }
        let result = (|| {
            no_space(&self.staging_root, m.validate()?)?;
            validate_content_coverage(&connection, &row)?;
            let validated = validate_documents(m, &mut |kind| {
                read_blob(&connection, &token, PendingKind::from_commit(kind))
            })?;
            let tx = connection.transaction().map_err(|_| StoryError::Io)?;
            let staged = (|| {
                let receipt =
                    if let Some(receipt) = read_receipt(&tx, &m.session_id, &m.operation_id)? {
                        if receipt.wire_digest != wire_digest {
                            return Err(StoryError::OperationMismatch);
                        }
                        receipt
                    } else {
                        check_cas(&tx, m, &validated)?;
                        hook("cas")?;
                        write_documents(
                            &tx,
                            m,
                            &validated,
                            &mut |kind| read_blob(&tx, &token, PendingKind::from_commit(kind)),
                            hook,
                        )?;
                        validated.receipt
                    };
                tx.execute(
                    "DELETE FROM arena_story_pending WHERE token=?1 AND active=1",
                    [&token],
                )
                .map_err(|_| StoryError::Io)?;
                hook("pending-removed")?;
                hook("before-commit")?;
                Ok(receipt)
            })();
            let receipt = match staged {
                Ok(receipt) => receipt,
                Err(error) => {
                    // Drop cannot report rollback errors. Positive rollback evidence
                    // is required before the outer path may clear this attempt.
                    tx.rollback().map_err(|_| StoryError::CommitUnknown)?;
                    return Err(error);
                }
            };
            tx.commit().map_err(|_| StoryError::CommitUnknown)?;
            // A post-COMMIT failure must never clear the earlier durable attempt.
            hook("after-commit").map_err(|_| StoryError::CommitUnknown)?;
            Ok(receipt)
        })();
        if result.as_ref().is_err_and(|e| {
            !matches!(
                e,
                StoryError::CommitUnknown | StoryError::ConnectionUnresolved
            )
        }) {
            // The transaction rolled back. Only this same live attempt can be ended;
            // failure to persist that proof stays unknown across process restart.
            connection.execute("UPDATE arena_story_pending SET save_attempt=NULL WHERE token=?1 AND save_attempt=?2 AND restored=0",params![token,attempt_id]).map_err(|_|StoryError::CommitUnknown)?;
        }
        result
    }
}

// Borrow payloads to preserve arbitrary card extensions and JavaScript lone-surrogate
// escapes. Closed authority objects reject network carriers before any SQLite write.
type Object<'a> = std::collections::BTreeMap<String, &'a RawValue>;
fn object<'a>(
    raw: &'a RawValue,
    allowed: &[&str],
    required: &[&str],
) -> Result<Object<'a>, StoryError> {
    // Reject duplicate decoded keys before selecting fields. A last-wins map
    // could validate the final seed/data while persisting hidden earlier bytes.
    // Only closed control objects pass here; opaque user card JSON stays opaque.
    let mut map = Object::new();
    for (key, value) in raw_object(raw)? {
        let name = allowed
            .iter()
            .find(|name| key.iter().copied().eq(name.encode_utf16()))
            .ok_or(StoryError::Invalid)?;
        map.insert((*name).to_string(), value);
    }
    if required.iter().any(|key| !map.contains_key(*key)) {
        return Err(StoryError::Invalid);
    }
    Ok(map)
}
fn field<'a>(map: &Object<'a>, name: &str) -> Result<&'a RawValue, StoryError> {
    map.get(name).copied().ok_or(StoryError::Invalid)
}
fn string(raw: &RawValue) -> Result<String, StoryError> {
    serde_json::from_str(raw.get()).map_err(|_| StoryError::Invalid)
}
fn integer(raw: &RawValue) -> Result<u64, StoryError> {
    let n: u64 = serde_json::from_str(raw.get()).map_err(|_| StoryError::Invalid)?;
    if n > MAX_SAFE_INTEGER {
        return Err(StoryError::Invalid);
    }
    Ok(n)
}
fn boolean(raw: &RawValue) -> Result<bool, StoryError> {
    serde_json::from_str(raw.get()).map_err(|_| StoryError::Invalid)
}
fn array(raw: &RawValue, minimum: usize, maximum: usize) -> Result<Vec<&RawValue>, StoryError> {
    let a: Vec<&RawValue> = serde_json::from_str(raw.get()).map_err(|_| StoryError::Invalid)?;
    if !(minimum..=maximum).contains(&a.len()) {
        return Err(StoryError::Invalid);
    }
    Ok(a)
}
fn text_field(map: &Object<'_>, key: &str) -> Result<(), StoryError> {
    if map.get(key).is_some_and(|v| !v.get().starts_with('"')) {
        return Err(StoryError::Invalid);
    }
    Ok(())
}
fn one_of(raw: &RawValue, values: &[&str]) -> Result<(), StoryError> {
    if !values.contains(&string(raw)?.as_str()) {
        return Err(StoryError::Invalid);
    }
    Ok(())
}
// Match JavaScript string length/TextEncoder without rejecting a legal lone
// surrogate escape in an opaque JSON original. Stored bytes are never rewritten.
fn string_units(raw: &RawValue) -> Result<Vec<u16>, StoryError> {
    let raw = raw.get();
    if !raw.starts_with('"') || !raw.ends_with('"') {
        return Err(StoryError::Invalid);
    }
    let mut chars = raw[1..raw.len() - 1].chars();
    let mut units = Vec::new();
    while let Some(c) = chars.next() {
        if c == '\\' {
            let unit = match chars.next().ok_or(StoryError::Invalid)? {
                'u' => {
                    let mut n = 0;
                    for _ in 0..4 {
                        n = (n << 4)
                            | chars
                                .next()
                                .and_then(|c| c.to_digit(16))
                                .ok_or(StoryError::Invalid)? as u16;
                    }
                    n
                }
                '"' => 34,
                '\\' => 92,
                '/' => 47,
                'b' => 8,
                'f' => 12,
                'n' => 10,
                'r' => 13,
                't' => 9,
                _ => return Err(StoryError::Invalid),
            };
            units.push(unit);
        } else {
            let mut buf = [0; 2];
            units.extend_from_slice(c.encode_utf16(&mut buf));
        }
    }
    Ok(units)
}
fn text_length(raw: &RawValue, min: usize, max: usize) -> Result<(), StoryError> {
    let units = string_units(raw)?;
    if !(min..=max).contains(&units.len()) {
        return Err(StoryError::Invalid);
    }
    Ok(())
}

fn json_object(raw: &RawValue) -> Result<(), StoryError> {
    if !raw.get().starts_with('{') {
        return Err(StoryError::Invalid);
    }
    Ok(())
}
fn validate_input(bytes: &[u8], m: &PendingManifest) -> Result<(), StoryError> {
    if bytes.len() as u64 > INPUT_BYTES {
        return Err(StoryError::TooLarge);
    }
    let raw: &RawValue = serde_json::from_slice(bytes).map_err(|_| StoryError::Invalid)?;
    let map = object(
        raw,
        &[
            "version",
            "sessionId",
            "generationRequestId",
            "action",
            "chapterIndex",
            "sourceChapterId",
            "chapterPlan",
            "chapterContext",
            "seed",
            "userGuidance",
        ],
        &[
            "version",
            "sessionId",
            "generationRequestId",
            "action",
            "chapterIndex",
            "chapterContext",
            "seed",
        ],
    )?;
    if integer(field(&map, "version")?)? != 1
        || string(field(&map, "sessionId")?)? != m.session_id
        || string(field(&map, "generationRequestId")?)? != m.request_id
        || integer(field(&map, "chapterIndex")?)? != m.expected_revision + 1
        || string(field(&map, "action")?)?
            != if m.expected_revision == 0 {
                "start"
            } else {
                "continue"
            }
        || map.get("sourceChapterId").map(|v| string(v)).transpose()? != m.expected_last_chapter_id
    {
        return Err(StoryError::Invalid);
    }
    text_field(&map, "userGuidance")?;
    if let Some(plan) = map.get("chapterPlan") {
        let p = object(plan, &["totalChapters"], &["totalChapters"])?;
        let total = integer(field(&p, "totalChapters")?)?;
        if !(1..=20).contains(&total) || m.expected_revision + 1 > total {
            return Err(StoryError::Invalid);
        }
    }
    let context = object(
        field(&map, "chapterContext")?,
        &["sessionSummary", "recentWindow", "workingCombatants"],
        &["recentWindow", "workingCombatants"],
    )?;
    text_field(&context, "sessionSummary")?;
    array(field(&context, "workingCombatants")?, 1, 32)?;
    let recent = array(field(&context, "recentWindow")?, 0, 12)?;
    let mut last = 0;
    let mut head = None;
    let mut ids = std::collections::HashSet::new();
    for item in recent {
        let r = object(
            item,
            &[
                "chapterId",
                "chapterIndex",
                "title",
                "mode",
                "text",
                "truncated",
            ],
            &[
                "chapterId",
                "chapterIndex",
                "title",
                "mode",
                "text",
                "truncated",
            ],
        )?;
        let id = string(field(&r, "chapterId")?)?;
        let index = integer(field(&r, "chapterIndex")?)?;
        if !valid_id(&id) || index <= last || !ids.insert(id.clone()) {
            return Err(StoryError::Invalid);
        }
        last = index;
        head = Some(id);
        one_of(field(&r, "mode")?, &["full", "digest"])?;
        text_field(&r, "title")?;
        text_field(&r, "text")?;
        boolean(field(&r, "truncated")?)?;
    }
    if last != m.expected_revision || head != m.expected_last_chapter_id {
        return Err(StoryError::Invalid);
    }
    let seed = object(
        field(&map, "seed")?,
        &[
            "combatants",
            "scenario",
            "auxScenarios",
            "materials",
            "adjudicationEvents",
            "questionnaires",
            "mode",
            "storyLength",
            "customStoryLength",
            "language",
            "settings",
        ],
        &["combatants", "mode", "storyLength", "language", "settings"],
    )?;
    array(field(&seed, "combatants")?, 1, 32)?;
    if let Some(v) = seed.get("scenario") {
        if v.get() != "null" {
            json_object(v)?
        }
    }
    for key in [
        "auxScenarios",
        "materials",
        "adjudicationEvents",
        "questionnaires",
    ] {
        if let Some(v) = seed.get(key) {
            let items = array(
                v,
                0,
                if key == "adjudicationEvents" {
                    100
                } else {
                    256
                },
            )?;
            for item in items {
                if key == "auxScenarios" {
                    json_object(item)?
                }
                if key == "questionnaires" {
                    let q = object(
                        item,
                        &["id", "title", "kind", "useLore", "loreMarkdown"],
                        &["id", "title", "kind"],
                    )?;
                    for k in ["id", "title", "loreMarkdown"] {
                        text_field(&q, k)?
                    }
                    text_length(field(&q, "id")?, 1, usize::MAX)?;
                    text_length(field(&q, "title")?, 1, usize::MAX)?;
                    one_of(field(&q, "kind")?, &["magical-girl", "canshou"])?;
                    if let Some(v) = q.get("useLore") {
                        boolean(v)?;
                    }
                }
            }
        }
    }
    one_of(
        field(&seed, "mode")?,
        &["classic", "kizuna", "daily", "scenario"],
    )?;
    one_of(
        field(&seed, "storyLength")?,
        &["default", "short", "standard", "detailed", "long"],
    )?;
    text_field(&seed, "customStoryLength")?;
    text_field(&seed, "language")?;
    let settings = object(
        field(&seed, "settings")?,
        &[
            "readArenaHistory",
            "readArenaHistoryLimit",
            "isArenaHistoryUnlimited",
            "writeArenaHistory",
            "readCurrentState",
            "writeCurrentState",
            "readNarrativeHistory",
            "readNarrativeHistoryLimit",
            "isNarrativeHistoryUnlimited",
            "writeNarrativeHistory",
        ],
        &[
            "readArenaHistory",
            "writeArenaHistory",
            "readCurrentState",
            "writeCurrentState",
            "readNarrativeHistory",
            "writeNarrativeHistory",
        ],
    )?;
    for (key, value) in &settings {
        if key.ends_with("Limit") {
            if !(1..=999).contains(&integer(value)?) {
                return Err(StoryError::Invalid);
            }
        } else {
            boolean(value)?;
        }
    }
    if boolean(field(&settings, "writeArenaHistory")?)? != m.write_options.write_arena_history
        || boolean(field(&settings, "writeCurrentState")?)? != m.write_options.write_current_state
        || boolean(field(&settings, "writeNarrativeHistory")?)?
            != m.write_options.write_narrative_history
    {
        return Err(StoryError::Invalid);
    }
    Ok(())
}
fn validate_carrier(
    bytes: &[u8],
    kind: PendingKind,
    m: &PendingManifest,
) -> Result<(), StoryError> {
    if kind == PendingKind::Input {
        return validate_input(bytes, m);
    }
    let raw: &RawValue = serde_json::from_slice(bytes).map_err(|_| StoryError::Invalid)?;
    match kind {
        PendingKind::Header => {
            let h = object(
                raw,
                &[
                    "reportFormat",
                    "mode",
                    "scenarioDisplayName",
                    "language",
                    "storyLength",
                    "outputContract",
                    "reporterInfo",
                    "userGuidance",
                    "characterGuidances",
                    "adjudicationResults",
                    "narrativeHistoryReadCount",
                ],
                &["reportFormat"],
            )?;
            one_of(field(&h, "reportFormat")?, &["markdown"])?;
            if let Some(v) = h.get("mode") {
                one_of(v, &["classic", "kizuna", "daily", "scenario"])?;
            }
            if let Some(v) = h.get("outputContract") {
                one_of(v, &["stream-markdown"])?;
            }
            for key in [
                "scenarioDisplayName",
                "language",
                "storyLength",
                "userGuidance",
            ] {
                text_field(&h, key)?;
            }
            if let Some(v) = h.get("reporterInfo") {
                json_object(v)?;
            }
            for (key, max) in [("characterGuidances", 32), ("adjudicationResults", 100)] {
                if let Some(v) = h.get(key) {
                    array(v, 0, max)?;
                }
            }
            if let Some(v) = h.get("narrativeHistoryReadCount") {
                integer(v)?;
            }
        }
        PendingKind::Meta => {
            let e = object(raw, &["id", "event", "data"], &["id", "event", "data"])?;
            let cursor = string(field(&e, "id")?)?;
            if cursor.len() > 128
                || cursor.split('-').count() != 2
                || cursor
                    .split('-')
                    .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
            {
                return Err(StoryError::Invalid);
            }
            match string(field(&e, "event")?)?.as_str() {
                "meta" => {
                    let d = object(
                        field(&e, "data")?,
                        &["parseOk", "meta", "raw", "rawTruncated"],
                        &["parseOk", "meta", "raw", "rawTruncated"],
                    )?;
                    if !boolean(field(&d, "parseOk")?)? {
                        return Err(StoryError::Invalid);
                    }
                    json_object(field(&d, "meta")?)?;
                    text_length(field(&d, "raw")?, 0, 8000)?;
                    boolean(field(&d, "rawTruncated")?)?;
                }
                "meta_error" => {
                    let d = object(
                        field(&e, "data")?,
                        &["parseOk", "error", "raw", "rawTruncated"],
                        &["parseOk", "error"],
                    )?;
                    if boolean(field(&d, "parseOk")?)? {
                        return Err(StoryError::Invalid);
                    }
                    text_length(field(&d, "error")?, 0, 2048)?;
                    if let Some(v) = d.get("raw") {
                        text_length(v, 0, 8000)?;
                    }
                    if let Some(v) = d.get("rawTruncated") {
                        boolean(v)?;
                    }
                }
                _ => return Err(StoryError::Invalid),
            }
        }
        PendingKind::RoleResponse => {
            let r = object(
                raw,
                &[
                    "version",
                    "generationId",
                    "success",
                    "updatedCombatants",
                    "warnings",
                ],
                &[
                    "version",
                    "generationId",
                    "success",
                    "updatedCombatants",
                    "warnings",
                ],
            )?;
            one_of(field(&r, "version")?, &["arena-reconciliation-v1"])?;
            if !boolean(field(&r, "success")?)? || !request_id(&string(field(&r, "generationId")?)?)
            {
                return Err(StoryError::Invalid);
            }
            let mut indexes = std::collections::HashSet::new();
            for item in array(field(&r, "updatedCombatants")?, 0, 32)? {
                let c = object(
                    item,
                    &["combatantIndex", "data", "isNative"],
                    &["combatantIndex", "data", "isNative"],
                )?;
                let index = integer(field(&c, "combatantIndex")?)?;
                if index >= 32 || !indexes.insert(index) {
                    return Err(StoryError::Invalid);
                }
                json_object(field(&c, "data")?)?;
                if boolean(field(&c, "isNative")?)? {
                    let data: Object<'_> = serde_json::from_str(field(&c, "data")?.get())
                        .map_err(|_| StoryError::Invalid)?;
                    if string(field(&data, "signature")?)?.trim().is_empty() {
                        return Err(StoryError::Invalid);
                    }
                }
            }
            for item in array(field(&r, "warnings")?, 0, 96)? {
                let w: Object<'_> =
                    serde_json::from_str(item.get()).map_err(|_| StoryError::Invalid)?;
                let code = string(field(&w, "code")?)?;
                let allowed = match code.as_str() {
                    "ARENA_RECONCILIATION_COMBATANT_UNMATCHED" => {
                        vec!["combatantIndex", "code", "message"]
                    }
                    "ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING" => {
                        vec!["rosterIndex", "characterName", "code", "message"]
                    }
                    "ARENA_RECONCILIATION_IMPACT_AMBIGUOUS" => {
                        vec!["characterName", "code", "message"]
                    }
                    _ => return Err(StoryError::Invalid),
                };
                let w = object(item, &allowed, &allowed)?;
                text_field(&w, "message")?;
                for key in ["combatantIndex", "rosterIndex"] {
                    if let Some(v) = w.get(key) {
                        if integer(v)? >= 32 {
                            return Err(StoryError::Invalid);
                        }
                    }
                }
                if let Some(v) = w.get("characterName") {
                    if v.get() != "null" && !v.get().starts_with('"') {
                        return Err(StoryError::Invalid);
                    }
                }
            }
        }
        _ => return Err(StoryError::Invalid),
    }
    Ok(())
}
fn buffered(kind: PendingKind) -> bool {
    matches!(
        kind,
        PendingKind::Input | PendingKind::Header | PendingKind::Meta | PendingKind::RoleResponse
    )
}
fn validate_payload(connection: &Connection, row: &Stored) -> Result<(), StoryError> {
    let m = &row.snapshot.manifest;
    for p in &m.parts {
        let (id, length, received, d) = part_row(connection, &row.token, p.kind)?;
        if length != p.byte_length || d != p.digest || received != length {
            return Err(StoryError::Incomplete);
        }
        hash_blob(connection, id, length, &d)?;
        if buffered(p.kind) {
            let raw = read_blob(connection, &row.token, p.kind)?;
            validate_carrier(raw.as_bytes(), p.kind, m)?;
        } else if matches!(p.kind, PendingKind::Markdown | PendingKind::Reasoning) {
            read_blob(connection, &row.token, p.kind)?;
        }
    }
    let count: u64 = connection
        .query_row(
            "SELECT count(*) FROM arena_story_pending_part WHERE token=?1",
            [&row.token],
            |r| r.get(0),
        )
        .map_err(|_| StoryError::Corrupt)?;
    if count != m.parts.len() as u64 {
        return Err(StoryError::Corrupt);
    }
    if let Some(commit) = &m.commit_manifest {
        validate_content_coverage(connection, row)?;
        let validated = validate_documents(commit, &mut |kind| {
            read_blob(connection, &row.token, PendingKind::from_commit(kind))
        })?;
        if validated.chapter.created_at != m.created_at
            || validated.session.last_input_checkpoint_id != m.last_input_checkpoint_id
            || validated.session.working_checkpoint_id != m.output_checkpoint_id
            || validated.checkpoints.first().is_some_and(|c| {
                m.initial_checkpoint_id
                    .as_ref()
                    .is_some_and(|id| id != &c.id)
            })
        {
            return Err(StoryError::Invalid);
        }
        if m.parts.iter().any(|p| p.kind == PendingKind::Markdown) {
            let chapter = read_blob(connection, &row.token, PendingKind::Chapter)?;
            let map: Object<'_> =
                serde_json::from_str(&chapter).map_err(|_| StoryError::Invalid)?;
            if String::from_utf16_lossy(&string_units(field(&map, "markdown")?)?)
                != read_blob(connection, &row.token, PendingKind::Markdown)?
            {
                return Err(StoryError::Invalid);
            }
        }
    }
    Ok(())
}
/// Audit active works without repairing them. Unpublished upload holes remain
/// structurally checked, never become a recovered work, and are reclaimed at open.
pub(crate) fn audit(connection: &Connection) -> Result<(), StoryError> {
    let invalid:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM arena_story_pending WHERE product NOT IN ('battle','arena') OR active NOT IN (0,1) OR restored NOT IN(0,1) OR length(CAST(metadata AS BLOB))>65536 OR total_bytes NOT BETWEEN 1 AND 134217728 OR (active=0 AND (save_attempt IS NOT NULL OR restored!=0)))",[],|r|r.get(0)).map_err(|_|StoryError::Corrupt)?;
    if invalid {
        return Err(StoryError::Corrupt);
    }
    let mut stmt = connection
        .prepare("SELECT token,product,request_id,revision FROM arena_story_pending")
        .map_err(|_| StoryError::Corrupt)?;
    let records = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, u64>(3)?,
            ))
        })
        .map_err(|_| StoryError::Corrupt)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StoryError::Corrupt)?;
    if records.len() > 4 {
        return Err(StoryError::Corrupt);
    }
    let mut active_count = 0;
    let mut active_bytes = 0;
    let mut products = std::collections::HashSet::new();
    for (token, product, request, revision) in records {
        ipc::token(Some(&token))?;
        let row = load(connection, &token)?;
        let m = &row.snapshot.manifest;
        if row.snapshot.save_attempt_id.is_some() && m.commit_manifest.is_none() {
            return Err(StoryError::Corrupt);
        }
        if product != m.product.sql()
            || request != m.request_id
            || revision != m.pending_revision
            || row
                .snapshot
                .save_attempt_id
                .as_deref()
                .is_some_and(|s| ipc::token(Some(s)).is_err())
        {
            return Err(StoryError::Corrupt);
        }
        if row.active {
            active_count += 1;
            active_bytes += row.total;
            if !products.insert(product) {
                return Err(StoryError::Corrupt);
            }
            validate_payload(connection, &row)?;
            if let Some(receipt) = read_receipt(connection, &m.session_id, &m.operation_id)? {
                if m.commit_manifest
                    .as_ref()
                    .map(CommitManifest::wire_digest)
                    .transpose()?
                    .as_deref()
                    != Some(receipt.wire_digest.as_str())
                {
                    return Err(StoryError::Corrupt);
                }
            }
        } else {
            let count: u64 = connection
                .query_row(
                    "SELECT count(*) FROM arena_story_pending_part WHERE token=?1",
                    [&token],
                    |r| r.get(0),
                )
                .map_err(|_| StoryError::Corrupt)?;
            if count != m.parts.len() as u64 {
                return Err(StoryError::Corrupt);
            }
            for p in &m.parts {
                let (id, length, received, d) = part_row(connection, &token, p.kind)?;
                if length != p.byte_length || d != p.digest || received > length {
                    return Err(StoryError::Corrupt);
                }
                let actual: u64 = connection
                    .query_row(
                        "SELECT length(payload) FROM arena_story_pending_part WHERE id=?1",
                        [id],
                        |r| r.get(0),
                    )
                    .map_err(|_| StoryError::Corrupt)?;
                if actual != length {
                    return Err(StoryError::Corrupt);
                }
                if buffered(p.kind) && received == 0 {
                    let mut blob = connection
                        .blob_open("main", "arena_story_pending_part", "payload", id, true)
                        .map_err(|_| StoryError::Corrupt)?;
                    let mut buffer = [0u8; 65536];
                    loop {
                        let n = blob.read(&mut buffer).map_err(|_| StoryError::Corrupt)?;
                        if n == 0 {
                            break;
                        }
                        if buffer[..n].iter().any(|b| *b != 0) {
                            return Err(StoryError::Corrupt);
                        }
                    }
                }
                if buffered(p.kind) && received != 0 && received != length {
                    return Err(StoryError::Corrupt);
                }
                if received == length {
                    hash_blob(connection, id, length, &d)?;
                    if buffered(p.kind) {
                        validate_carrier(
                            read_blob(connection, &token, p.kind)?.as_bytes(),
                            p.kind,
                            m,
                        )?;
                    }
                }
            }
        }
    }
    let (count, bytes) = upload_reservations(connection)?;
    if active_count > 2
        || active_bytes > 2 * CANDIDATE_COMMIT_BYTES
        || count > MAX_STAGES
        || bytes > STAGING_BYTES
    {
        return Err(StoryError::Corrupt);
    }
    Ok(())
}
/// Called only after restore's committed journal marker, before clearing intent.
/// Reapplying the fence is safe; the next startup cannot treat rolled-back evidence
/// as authorization to POST a model or apply a saved package again.
pub(crate) fn fence_restored_database(path: &Path) -> Result<(), StoryError> {
    let connection = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|_| StoryError::Io)?;
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| StoryError::Corrupt)?;
    if version >= 6 {
        connection.execute_batch("PRAGMA synchronous=FULL; BEGIN IMMEDIATE; UPDATE arena_story_pending SET restored=1 WHERE active=1; COMMIT;").map_err(|_|StoryError::Io)?;
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|_| StoryError::Io)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "arena_story_pending_tests.rs"]
mod tests;

// Equality of JSON values, including unknown object members and lone UTF-16
// surrogate escapes. No Value tree, string normalization or name-based role match.
fn members(raw: &RawValue) -> Result<Vec<&str>, StoryError> {
    let text = raw.get();
    if !matches!(text.as_bytes().first(), Some(b'{' | b'[')) {
        return Err(StoryError::Invalid);
    }
    let inner = &text[1..text.len() - 1];
    if inner.trim().is_empty() {
        return Ok(vec![]);
    }
    let mut result = Vec::new();
    let mut quote = false;
    let mut escape = false;
    let mut depth = 0usize;
    let mut start = 0;
    for (index, byte) in inner.bytes().enumerate() {
        if quote {
            if escape {
                escape = false
            } else if byte == b'\\' {
                escape = true
            } else if byte == b'"' {
                quote = false
            }
            continue;
        }
        match byte {
            b'"' => quote = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth -= 1,
            b',' if depth == 0 => {
                result.push(inner[start..index].trim());
                start = index + 1;
            }
            _ => {}
        }
    }
    result.push(inner[start..].trim());
    Ok(result)
}
fn raw_object(
    raw: &RawValue,
) -> Result<std::collections::BTreeMap<Vec<u16>, &RawValue>, StoryError> {
    if !raw.get().starts_with('{') {
        return Err(StoryError::Invalid);
    }
    let mut map = std::collections::BTreeMap::new();
    for item in members(raw)? {
        let mut quote = false;
        let mut escape = false;
        let mut colon = None;
        for (index, byte) in item.bytes().enumerate() {
            if quote {
                if escape {
                    escape = false
                } else if byte == b'\\' {
                    escape = true
                } else if byte == b'"' {
                    quote = false
                }
            } else if byte == b'"' {
                quote = true
            } else if byte == b':' {
                colon = Some(index);
                break;
            }
        }
        let index = colon.ok_or(StoryError::Invalid)?;
        let key: &RawValue =
            serde_json::from_str(item[..index].trim()).map_err(|_| StoryError::Invalid)?;
        let value: &RawValue =
            serde_json::from_str(item[index + 1..].trim()).map_err(|_| StoryError::Invalid)?;
        if map.insert(string_units(key)?, value).is_some() {
            return Err(StoryError::Invalid);
        }
    }
    Ok(map)
}
fn raw_get<'a>(raw: &'a RawValue, key: &str) -> Result<Option<&'a RawValue>, StoryError> {
    Ok(raw_object(raw)?
        .get(&key.encode_utf16().collect::<Vec<_>>())
        .copied())
}
fn needed<'a>(raw: &'a RawValue, key: &str) -> Result<&'a RawValue, StoryError> {
    raw_get(raw, key)?.ok_or(StoryError::OriginalsUncovered)
}
fn equivalent(a: &RawValue, b: &RawValue) -> Result<bool, StoryError> {
    if a.get() == b.get() {
        return Ok(true);
    }
    match (a.get().as_bytes()[0], b.get().as_bytes()[0]) {
        (b'"', b'"') => Ok(string_units(a)? == string_units(b)?),
        (b'{', b'{') => {
            let a = raw_object(a)?;
            let b = raw_object(b)?;
            if a.len() != b.len() {
                return Ok(false);
            }
            for (key, value) in a {
                let Some(other) = b.get(&key) else {
                    return Ok(false);
                };
                if !equivalent(value, other)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        (b'[', b'[') => {
            let a = array(a, 0, usize::MAX)?;
            let b = array(b, 0, usize::MAX)?;
            if a.len() != b.len() {
                return Ok(false);
            }
            for (a, b) in a.into_iter().zip(b) {
                if !equivalent(a, b)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        (b'-' | b'0'..=b'9', b'-' | b'0'..=b'9') => {
            let a = a.get().parse::<f64>().map_err(|_| StoryError::Invalid)?;
            let b = b.get().parse::<f64>().map_err(|_| StoryError::Invalid)?;
            Ok(a.is_finite() && b.is_finite() && a == b)
        }
        _ => Ok(false),
    }
}
fn covered(expected: &RawValue, actual: &RawValue) -> Result<(), StoryError> {
    if !equivalent(expected, actual)? {
        return Err(StoryError::OriginalsUncovered);
    }
    Ok(())
}
fn parse_raw(document: &str) -> Result<&RawValue, StoryError> {
    serde_json::from_str(document).map_err(|_| StoryError::Invalid)
}
fn validate_content_coverage(connection: &Connection, row: &Stored) -> Result<(), StoryError> {
    let m = &row.snapshot.manifest;
    let chapter_document = read_blob(connection, &row.token, PendingKind::Chapter)?;
    let chapter = parse_raw(&chapter_document)?;
    let snapshot = needed(chapter, "cardSnapshot")?;
    let input_document = read_blob(connection, &row.token, PendingKind::Input)?;
    let input = parse_raw(&input_document)?;
    let has = |kind| m.parts.iter().any(|p| p.kind == kind);
    if has(PendingKind::Reasoning) {
        let expected = read_blob(connection, &row.token, PendingKind::Reasoning)?;
        let actual = needed(needed(snapshot, "aiReasoning")?, "text")?;
        if String::from_utf16_lossy(&string_units(actual)?) != expected {
            return Err(StoryError::OriginalsUncovered);
        }
    }
    let mut header_guidance = false;
    if has(PendingKind::Header) {
        let text = read_blob(connection, &row.token, PendingKind::Header)?;
        let header = parse_raw(&text)?;
        for key in [
            "reporterInfo",
            "userGuidance",
            "characterGuidances",
            "adjudicationResults",
            "narrativeHistoryReadCount",
            "scenarioDisplayName",
        ] {
            if let Some(expected) = raw_get(header, key)? {
                covered(expected, needed(snapshot, key)?)?;
                if key == "userGuidance" {
                    header_guidance = true;
                }
            }
        }
        let session_document = read_blob(connection, &row.token, PendingKind::Session)?;
        let source = needed(parse_raw(&session_document)?, "source")?;
        for key in ["mode", "language", "storyLength"] {
            if let Some(expected) = raw_get(header, key)? {
                covered(expected, needed(source, key)?)?;
            }
        }
    }
    if !header_guidance {
        if let Some(expected) = raw_get(input, "userGuidance")? {
            covered(expected, needed(snapshot, "userGuidance")?)?;
        }
    }
    if has(PendingKind::Meta) {
        let text = read_blob(connection, &row.token, PendingKind::Meta)?;
        let event = parse_raw(&text)?;
        let data = needed(event, "data")?;
        let debug = needed(snapshot, "streamUpdateMetaDebug")?;
        if string(needed(debug, "source")?)? != "sse" {
            return Err(StoryError::OriginalsUncovered);
        }
        for key in ["parseOk", "error", "raw", "rawTruncated"] {
            if let Some(expected) = raw_get(data, key)? {
                covered(expected, needed(debug, key)?)?;
            }
        }
        if let Some(meta) = raw_get(data, "meta")? {
            covered(meta, needed(chapter, "reportJson")?)?;
        }
    }
    let sync = needed(snapshot, "storyRoleSync")?;
    let sync_fields = object(
        sync,
        &["version", "state", "warnings", "reason"],
        &["version", "state", "warnings"],
    )?;
    let expected_state = match m.role_state {
        RoleState::NotRequested => "not-requested",
        RoleState::Accepted => "accepted",
        RoleState::OldRoles => "old-roles",
        RoleState::Unresolved => return Err(StoryError::OriginalsUncovered),
    };
    if integer(field(&sync_fields, "version")?)? != 1
        || string(field(&sync_fields, "state")?)? != expected_state
    {
        return Err(StoryError::OriginalsUncovered);
    }
    if m.role_state == RoleState::OldRoles {
        one_of(
            field(&sync_fields, "reason").map_err(|_| StoryError::OriginalsUncovered)?,
            &["http-failure", "user-kept-original"],
        )?;
    } else if sync_fields.contains_key("reason") {
        return Err(StoryError::OriginalsUncovered);
    }
    let input_roster = array(
        needed(needed(input, "chapterContext")?, "workingCombatants")?,
        1,
        32,
    )?;
    let checkpoint_document = read_blob(connection, &row.token, PendingKind::Checkpoint1)?;
    let output_roster = array(
        needed(parse_raw(&checkpoint_document)?, "combatants")?,
        1,
        32,
    )?;
    if input_roster.len() != output_roster.len() {
        return Err(StoryError::OriginalsUncovered);
    }
    let role_document = if has(PendingKind::RoleResponse) {
        Some(read_blob(
            connection,
            &row.token,
            PendingKind::RoleResponse,
        )?)
    } else {
        None
    };
    let mut updates = std::collections::BTreeMap::new();
    if let Some(document) = role_document.as_deref() {
        let response = parse_raw(document)?;
        covered(
            needed(response, "generationId")?,
            needed(chapter, "generationId")?,
        )?;
        covered(
            needed(response, "warnings")?,
            field(&sync_fields, "warnings")?,
        )?;
        for update in array(needed(response, "updatedCombatants")?, 0, 32)? {
            let index = integer(needed(update, "combatantIndex")?)? as usize;
            if index >= input_roster.len() || updates.insert(index, update).is_some() {
                return Err(StoryError::OriginalsUncovered);
            }
        }
    } else if !array(field(&sync_fields, "warnings")?, 0, 96)?.is_empty() {
        return Err(StoryError::OriginalsUncovered);
    }
    for (index, (original, output)) in input_roster.into_iter().zip(output_roster).enumerate() {
        if let Some(update) = updates.get(&index) {
            covered(needed(update, "data")?, needed(output, "data")?)?;
            covered(needed(update, "isNative")?, needed(output, "isNative")?)?;
            let old = raw_object(original)?;
            let new = raw_object(output)?;
            for (key, value) in old {
                if key == "data".encode_utf16().collect::<Vec<_>>()
                    || key == "isNative".encode_utf16().collect::<Vec<_>>()
                {
                    continue;
                }
                covered(value, new.get(&key).ok_or(StoryError::OriginalsUncovered)?)?;
            }
        } else {
            covered(original, output)?;
        }
    }
    Ok(())
}
