//! Restart-time, journaled native backup restoration (DESK-073).
//!
//! The live library is never replaced while its connection is managed by Tauri. The
//! running process validates the selected backup, takes a pre-restore backup while it
//! holds one maintenance permit, and durably publishes a native-only intent. The next
//! process calls [`recover_pending`] after acquiring `InstanceGuard` and before opening
//! SQLite. Recovery is forward-only: an ambiguous or damaged generation fails closed
//! while preserving the journal and quarantined old generation for diagnosis.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::backup::{self, BackupError, BackupSummary};
use crate::library::LocalLibrary;
use crate::maintenance::{MaintenancePermit, MaintenanceRejection};

const INTENT_FILE: &str = "restore.intent";
const STAGING_ROOT: &str = ".restore-staging";
const OLD_ROOT: &str = ".restore-old";
const JOURNAL_ROOT: &str = ".restore-journal";
const SQLITE_FILE: &str = "library.sqlite";
const SQLITE_WAL_FILE: &str = "library.sqlite-wal";
const SQLITE_SHM_FILE: &str = "library.sqlite-shm";
const BLOBS_DIRECTORY: &str = "blobs";
const INTENT_VERSION: u32 = 1;
const MARKER_VERSION: u32 = 1;
const MAX_JOURNAL_FILE_BYTES: u64 = 16 * 1024;

static RESTORE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// IPC projection for an accepted restore request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRestoreResponse {
    pub restore_id: String,
    pub backup_id: String,
    pub pre_restore_backup_id: String,
}

/// Successful preparation owns the maintenance permit until the caller exits.
///
/// The permit is intentionally not serializable. The Tauri command stores it in its
/// pending-restore state and serializes only `response`; dropping it before process exit
/// would reopen writes while an intent is waiting to replace the library.
pub struct PreparedRestore {
    pub response: PrepareRestoreResponse,
    pub permit: MaintenancePermit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RestoreError {
    InvalidBackupId,
    BackupIncomplete,
    BackupUnsupportedVersion,
    BackupCorrupt,
    BackupSourceUnavailable,
    BackupFailed,
    MaintenanceBusy,
    Pending,
    InvalidIntent,
    Failed,
    #[cfg(test)]
    Interrupted,
}

impl RestoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidBackupId => "invalid-backup-id",
            Self::BackupIncomplete => "backup-incomplete",
            Self::BackupUnsupportedVersion => "backup-unsupported-version",
            Self::BackupCorrupt => "backup-corrupt",
            Self::BackupSourceUnavailable => "backup-source-unavailable",
            Self::BackupFailed => "backup-failed",
            Self::MaintenanceBusy => "maintenance-busy",
            Self::Pending => "restore-pending",
            Self::InvalidIntent => "restore-invalid-intent",
            Self::Failed => "restore-failed",
            #[cfg(test)]
            Self::Interrupted => "restore-interrupted",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::InvalidBackupId => "backup id is invalid",
            Self::BackupIncomplete => "backup is incomplete",
            Self::BackupUnsupportedVersion => "backup format version is unsupported",
            Self::BackupCorrupt => "backup contents failed integrity verification",
            Self::BackupSourceUnavailable => "local backup storage is unavailable",
            Self::BackupFailed => "backup operation failed",
            Self::MaintenanceBusy => "the local library is being maintained",
            Self::Pending => "a restore is already pending",
            Self::InvalidIntent => "the pending restore intent is invalid",
            Self::Failed => "restore recovery failed; local data was not opened",
            #[cfg(test)]
            Self::Interrupted => "restore recovery was interrupted by a test fault",
        }
    }
}

impl Serialize for RestoreError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("RestoreError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

impl From<BackupError> for RestoreError {
    fn from(error: BackupError) -> Self {
        match error {
            BackupError::InvalidBackupId => Self::InvalidBackupId,
            BackupError::Incomplete => Self::BackupIncomplete,
            BackupError::UnsupportedVersion => Self::BackupUnsupportedVersion,
            BackupError::Corrupt => Self::BackupCorrupt,
            BackupError::SourceUnavailable => Self::BackupSourceUnavailable,
            BackupError::MaintenanceBusy => Self::MaintenanceBusy,
            BackupError::Failed => Self::BackupFailed,
        }
    }
}

impl From<MaintenanceRejection> for RestoreError {
    fn from(_: MaintenanceRejection) -> Self {
        Self::MaintenanceBusy
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RestoreIntent {
    version: u32,
    backup_id: String,
    restore_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalMarker {
    version: u32,
    restore_id: String,
    backup_id: String,
    phase: String,
}

/// Validate the selected backup, create a safety backup and publish the restore intent
/// while one maintenance window remains held by the returned value.
pub fn prepare_restore(
    library: &LocalLibrary,
    backup_id: &str,
) -> Result<PreparedRestore, RestoreError> {
    let permit = library.enter_maintenance("restore")?;
    let root = library.data_root();
    ensure_plain_directory(root)?;
    if read_intent(root)?.is_some() {
        return Err(RestoreError::Pending);
    }

    // Revalidate under the same permit used for the safety snapshot. No filesystem path
    // from the renderer is accepted; backup_id is validated by backup's native resolver.
    backup::verify_backup(root, backup_id)?;
    let pre_restore = backup::create_backup_in_window(library, &permit)?;
    let restore_id = allocate_restore_id(root)?;
    let intent = RestoreIntent {
        version: INTENT_VERSION,
        backup_id: backup_id.to_string(),
        restore_id: restore_id.clone(),
    };
    publish_intent(root, &intent)?;

    Ok(PreparedRestore {
        response: PrepareRestoreResponse {
            restore_id,
            backup_id: backup_id.to_string(),
            pre_restore_backup_id: pre_restore.backup_id,
        },
        permit,
    })
}

/// Replay a pending restore before `LocalLibrary::open` or any migration can run.
pub fn recover_pending(data_root: &Path) -> Result<(), RestoreError> {
    recover_pending_with_hook(data_root, &mut |_| Ok(()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HookBoundary {
    Before,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RecoveryEvent {
    action: &'static str,
    boundary: HookBoundary,
    kind: RecoveryAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveryAction {
    Rename,
    Marker,
    ClearIntent,
}

fn recover_pending_with_hook(
    data_root: &Path,
    hook: &mut impl FnMut(RecoveryEvent) -> Result<(), RestoreError>,
) -> Result<(), RestoreError> {
    ensure_plain_directory(data_root)?;
    let Some(intent) = read_intent(data_root)? else {
        return Ok(());
    };
    validate_intent(&intent)?;

    // A committed marker is the durable boundary. Once present, never reapply the
    // snapshot: the user may already have opened the new library and made later writes.
    if marker_matches(data_root, &intent, "committed")? {
        clear_intent_after_commit(data_root, hook)?;
        return Ok(());
    }

    let backup_summary = backup::verify_backup(data_root, &intent.backup_id)?;
    let stage = staging_path(data_root, &intent.restore_id);
    let old = old_generation_path(data_root, &intent.restore_id);
    ensure_native_scratch_root(data_root, STAGING_ROOT)?;
    ensure_native_scratch_root(data_root, OLD_ROOT)?;
    ensure_native_scratch_root(data_root, JOURNAL_ROOT)?;
    ensure_native_id_directory(&stage)?;
    ensure_native_id_directory(&old)?;
    let journal = journal_path(data_root, &intent.restore_id);
    ensure_native_id_directory(&journal)?;

    stage_backup(data_root, &intent, &backup_summary, &stage)?;
    ensure_marker(data_root, &journal, &intent, "staged", hook)?;
    verify_restore_payload(data_root, &journal, &intent, &stage)?;

    // Quarantine the complete old generation before the first new file is installed.
    // The aggregate marker makes a later replay distinguish a newly installed live DB
    // from the old DB that used to occupy the same fixed path.
    if marker_matches(data_root, &intent, "old-quarantined")? {
        validate_old_generation(data_root, &intent, &old)?;
    } else {
        for (name, label, required) in [
            (SQLITE_FILE, "old-sqlite-main", true),
            (SQLITE_WAL_FILE, "old-sqlite-wal", false),
            (SQLITE_SHM_FILE, "old-sqlite-shm", false),
        ] {
            move_and_mark(
                data_root,
                &intent,
                &data_root.join(name),
                &old.join(name),
                label,
                required,
                hook,
            )?;
        }
        move_and_mark(
            data_root,
            &intent,
            &data_root.join(BLOBS_DIRECTORY),
            &old.join(BLOBS_DIRECTORY),
            "old-blobs",
            true,
            hook,
        )?;
        validate_old_generation(data_root, &intent, &old)?;
        ensure_marker(data_root, &journal, &intent, "old-quarantined", hook)?;
    }

    for name in [SQLITE_WAL_FILE, SQLITE_SHM_FILE] {
        if safe_metadata(&data_root.join(name))?.is_some() {
            return Err(RestoreError::Failed);
        }
    }
    if safe_metadata(&data_root.join(SQLITE_FILE))?.is_some()
        && safe_metadata(&stage.join(backup::BACKUP_DATABASE_FILE))?.is_some()
    {
        return Err(RestoreError::Failed);
    }
    if safe_metadata(&data_root.join(BLOBS_DIRECTORY))?.is_some()
        && safe_metadata(&stage.join(backup::BACKUP_BLOBS_DIRECTORY))?.is_some()
    {
        return Err(RestoreError::Failed);
    }

    move_and_mark(
        data_root,
        &intent,
        &stage.join(backup::BACKUP_DATABASE_FILE),
        &data_root.join(SQLITE_FILE),
        "new-sqlite-main",
        true,
        hook,
    )?;
    verify_restore_payload(data_root, &journal, &intent, &stage)?;
    move_and_mark(
        data_root,
        &intent,
        &stage.join(backup::BACKUP_BLOBS_DIRECTORY),
        &data_root.join(BLOBS_DIRECTORY),
        "new-blobs",
        true,
        hook,
    )?;

    // Never let an old WAL/SHM be paired with the installed main database. The old
    // family now lives together under the retained rollback generation.
    for name in [SQLITE_WAL_FILE, SQLITE_SHM_FILE] {
        if safe_metadata(&data_root.join(name))?.is_some() {
            return Err(RestoreError::Failed);
        }
    }

    verify_restore_payload(data_root, &journal, &intent, &stage)?;
    ensure_marker(data_root, &journal, &intent, "verified", hook)?;
    ensure_marker(data_root, &journal, &intent, "committed", hook)?;
    clear_intent_after_commit(data_root, hook)
}

fn validate_intent(intent: &RestoreIntent) -> Result<(), RestoreError> {
    if intent.version != INTENT_VERSION || !valid_restore_id(&intent.restore_id) {
        return Err(RestoreError::InvalidIntent);
    }
    Ok(())
}

fn allocate_restore_id(root: &Path) -> Result<String, RestoreError> {
    for _ in 0..32 {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| RestoreError::Failed)?
            .as_millis();
        let sequence = RESTORE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let value = format!("restore-{millis}-{}-{sequence}", std::process::id());
        if !valid_restore_id(&value) {
            return Err(RestoreError::Failed);
        }
        let stage = staging_path(root, &value);
        let old = old_generation_path(root, &value);
        let journal = journal_path(root, &value);
        if safe_metadata(&stage)?.is_none()
            && safe_metadata(&old)?.is_none()
            && safe_metadata(&journal)?.is_none()
        {
            return Ok(value);
        }
    }
    Err(RestoreError::Failed)
}

fn valid_restore_id(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("restore-") else {
        return false;
    };
    let mut parts = rest.split('-');
    let valid_decimal = |part: Option<&str>| {
        part.is_some_and(|value| {
            !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
        })
    };
    value.len() <= 128
        && valid_decimal(parts.next())
        && valid_decimal(parts.next())
        && valid_decimal(parts.next())
        && parts.next().is_none()
}

fn staging_path(root: &Path, restore_id: &str) -> PathBuf {
    root.join(STAGING_ROOT).join(restore_id)
}

fn old_generation_path(root: &Path, restore_id: &str) -> PathBuf {
    root.join(OLD_ROOT).join(restore_id)
}

fn journal_path(root: &Path, restore_id: &str) -> PathBuf {
    root.join(JOURNAL_ROOT).join(restore_id)
}

fn read_intent(root: &Path) -> Result<Option<RestoreIntent>, RestoreError> {
    let path = root.join(INTENT_FILE);
    let Some(metadata) = safe_metadata(&path)? else {
        return Ok(None);
    };
    if !metadata.is_file() {
        return Err(RestoreError::InvalidIntent);
    }
    if metadata.len() > MAX_JOURNAL_FILE_BYTES {
        return Err(RestoreError::InvalidIntent);
    }
    let bytes = fs::read(path).map_err(|_| RestoreError::InvalidIntent)?;
    let intent: RestoreIntent =
        serde_json::from_slice(&bytes).map_err(|_| RestoreError::InvalidIntent)?;
    validate_intent(&intent)?;
    Ok(Some(intent))
}

fn publish_intent(root: &Path, intent: &RestoreIntent) -> Result<(), RestoreError> {
    let bytes = serde_json::to_vec(intent).map_err(|_| RestoreError::Failed)?;
    if publish_noclobber(root, &root.join(INTENT_FILE), &bytes).is_err() {
        // If publication completed but the platform reported an error during its final
        // bookkeeping, keep the maintenance permit by treating the exact durable intent
        // as success. Returning failure here would drop the permit while recovery waits.
        let published = read_intent(root)?;
        if !published.is_some_and(|published| {
            published.backup_id == intent.backup_id && published.restore_id == intent.restore_id
        }) {
            return Err(RestoreError::Failed);
        }
    }
    sync_directory_best_effort(root);
    Ok(())
}

fn marker_matches(root: &Path, intent: &RestoreIntent, phase: &str) -> Result<bool, RestoreError> {
    let path = journal_path(root, &intent.restore_id).join(phase);
    reject_reparse_components(root, &path)?;
    let Some(metadata) = safe_metadata(&path)? else {
        return Ok(false);
    };
    if !metadata.is_file() {
        return Err(RestoreError::Failed);
    }
    if metadata.len() > MAX_JOURNAL_FILE_BYTES {
        return Err(RestoreError::Failed);
    }
    let bytes = fs::read(path).map_err(|_| RestoreError::Failed)?;
    let marker: JournalMarker = serde_json::from_slice(&bytes).map_err(|_| RestoreError::Failed)?;
    if marker.version != MARKER_VERSION
        || marker.restore_id != intent.restore_id
        || marker.backup_id != intent.backup_id
        || marker.phase != phase
    {
        return Err(RestoreError::Failed);
    }
    Ok(true)
}

fn ensure_marker(
    root: &Path,
    journal: &Path,
    intent: &RestoreIntent,
    phase: &'static str,
    hook: &mut impl FnMut(RecoveryEvent) -> Result<(), RestoreError>,
) -> Result<(), RestoreError> {
    if marker_matches(root, intent, phase)? {
        return Ok(());
    }
    hook(RecoveryEvent {
        action: phase,
        boundary: HookBoundary::Before,
        kind: RecoveryAction::Marker,
    })?;
    let marker = JournalMarker {
        version: MARKER_VERSION,
        restore_id: intent.restore_id.clone(),
        backup_id: intent.backup_id.clone(),
        phase: phase.to_string(),
    };
    let bytes = serde_json::to_vec(&marker).map_err(|_| RestoreError::Failed)?;
    publish_noclobber(journal, &journal.join(phase), &bytes)?;
    sync_directory_best_effort(journal);
    hook(RecoveryEvent {
        action: phase,
        boundary: HookBoundary::After,
        kind: RecoveryAction::Marker,
    })
}

fn move_and_mark(
    root: &Path,
    intent: &RestoreIntent,
    source: &Path,
    destination: &Path,
    label: &'static str,
    required: bool,
    hook: &mut impl FnMut(RecoveryEvent) -> Result<(), RestoreError>,
) -> Result<(), RestoreError> {
    reject_reparse_components(root, source)?;
    reject_reparse_components(root, destination)?;
    let source_exists = safe_metadata(source)?.is_some();
    let destination_exists = safe_metadata(destination)?.is_some();
    let marker_exists = marker_matches(root, intent, label)?;

    match (source_exists, destination_exists) {
        (true, false) => {
            if marker_exists {
                return Err(RestoreError::Failed);
            }
            hook(RecoveryEvent {
                action: label,
                boundary: HookBoundary::Before,
                kind: RecoveryAction::Rename,
            })?;
            fs::rename(source, destination).map_err(|_| RestoreError::Failed)?;
            sync_directory_best_effort(source.parent().ok_or(RestoreError::Failed)?);
            sync_directory_best_effort(destination.parent().ok_or(RestoreError::Failed)?);
            hook(RecoveryEvent {
                action: label,
                boundary: HookBoundary::After,
                kind: RecoveryAction::Rename,
            })?;
        }
        (false, true) => {}
        (false, false) if !required => {}
        (true, true) if label.starts_with("new-") => {
            let source_is_directory = fs::metadata(source)
                .map_err(|_| RestoreError::Failed)?
                .is_dir();
            let identical = if source_is_directory {
                trees_equal(source, destination)?
            } else {
                files_equal(source, destination)
            };
            if !identical {
                return Err(RestoreError::Failed);
            }
        }
        _ => return Err(RestoreError::Failed),
    }

    if marker_exists {
        return Ok(());
    }
    ensure_marker(
        root,
        &journal_path(root, &intent.restore_id),
        intent,
        label,
        hook,
    )
}

fn stage_backup(
    root: &Path,
    intent: &RestoreIntent,
    summary: &BackupSummary,
    stage: &Path,
) -> Result<(), RestoreError> {
    let source = root.join("backups").join(&intent.backup_id);
    reject_reparse_components(root, &source)?;
    ensure_plain_directory(&source)?;
    let staged_marker = marker_matches(root, intent, "staged")?;
    if staged_marker {
        return verify_restore_payload(
            root,
            &journal_path(root, &intent.restore_id),
            intent,
            stage,
        );
    }

    ensure_plain_directory(stage)?;
    let staged_summary = copy_backup_tree(&source, stage, &intent.backup_id)?;
    if staged_summary.backup_id != summary.backup_id
        || staged_summary.database_bytes != summary.database_bytes
        || staged_summary.blob_count != summary.blob_count
        || staged_summary.blob_bytes != summary.blob_bytes
    {
        return Err(RestoreError::Failed);
    }
    verify_staged_backup(stage, &intent.backup_id)
}

fn verify_staged_backup(stage: &Path, backup_id: &str) -> Result<(), RestoreError> {
    reject_reparse_tree(stage)?;
    backup::verify_backup_directory(stage, backup_id)?;
    Ok(())
}

fn validate_old_generation(
    root: &Path,
    intent: &RestoreIntent,
    old: &Path,
) -> Result<(), RestoreError> {
    for (name, phase, required) in [
        (SQLITE_FILE, "old-sqlite-main", true),
        (SQLITE_WAL_FILE, "old-sqlite-wal", false),
        (SQLITE_SHM_FILE, "old-sqlite-shm", false),
        (BLOBS_DIRECTORY, "old-blobs", true),
    ] {
        if !marker_matches(root, intent, phase)? {
            return Err(RestoreError::Failed);
        }
        let old_exists = safe_metadata(&old.join(name))?.is_some();
        if required && !old_exists {
            return Err(RestoreError::Failed);
        }
        if !required && !old_exists && safe_metadata(&root.join(name))?.is_some() {
            return Err(RestoreError::Failed);
        }
    }
    Ok(())
}

/// Verify one coherent backup generation when its DB or blobs may already have been
/// atomically moved from staging to the live path. The old generation must be fully
/// quarantined before either live path can stand in for a missing staged resource.
fn verify_restore_payload(
    root: &Path,
    _journal: &Path,
    intent: &RestoreIntent,
    stage: &Path,
) -> Result<(), RestoreError> {
    let staged_database = stage.join(backup::BACKUP_DATABASE_FILE);
    let live_database = root.join(SQLITE_FILE);
    let staged_blobs = stage.join(backup::BACKUP_BLOBS_DIRECTORY);
    let live_blobs = root.join(BLOBS_DIRECTORY);
    let staged_db_exists = safe_metadata(&staged_database)?.is_some();
    let live_db_exists = safe_metadata(&live_database)?.is_some();
    let staged_blobs_exist = safe_metadata(&staged_blobs)?.is_some();
    let live_blobs_exist = safe_metadata(&live_blobs)?.is_some();
    let old_quarantined = marker_matches(root, intent, "old-quarantined")?;
    let manifest = stage.join(backup::BACKUP_MANIFEST_FILE);
    if safe_metadata(&manifest)?.is_none() {
        return Err(RestoreError::Failed);
    }

    if !staged_db_exists && (!old_quarantined || !live_db_exists) {
        return Err(RestoreError::Failed);
    }
    if !staged_blobs_exist && (!old_quarantined || !live_blobs_exist) {
        return Err(RestoreError::Failed);
    }
    if live_db_exists && !staged_db_exists && !old_quarantined {
        return Err(RestoreError::Failed);
    }
    if live_blobs_exist && !staged_blobs_exist && !old_quarantined {
        return Err(RestoreError::Failed);
    }

    let database = if staged_db_exists {
        staged_database
    } else {
        live_database
    };
    let blobs = if staged_blobs_exist {
        staged_blobs
    } else {
        live_blobs
    };
    reject_reparse(&database)?;
    reject_reparse(&blobs)?;
    reject_reparse(&manifest)?;
    backup::verify_backup_components(&database, &blobs, &manifest, &intent.backup_id)?;
    Ok(())
}

fn copy_backup_tree(
    source: &Path,
    destination: &Path,
    backup_id: &str,
) -> Result<BackupSummary, RestoreError> {
    let blob_names = backup::verified_blob_names(source, backup_id)?;
    reject_reparse_tree(source)?;
    let source_manifest = source.join(backup::BACKUP_MANIFEST_FILE);
    let source_database = source.join(backup::BACKUP_DATABASE_FILE);
    let source_blobs = source.join(backup::BACKUP_BLOBS_DIRECTORY);
    ensure_plain_directory(&source_blobs)?;
    ensure_plain_directory(destination)?;
    cleanup_copy_temporaries(destination)?;
    for (source_file, target_file) in [
        (
            source_manifest,
            destination.join(backup::BACKUP_MANIFEST_FILE),
        ),
        (
            source_database,
            destination.join(backup::BACKUP_DATABASE_FILE),
        ),
    ] {
        copy_file_resumable(&source_file, &target_file)?;
    }
    let destination_blobs = destination.join(backup::BACKUP_BLOBS_DIRECTORY);
    ensure_native_id_directory(&destination_blobs)?;
    cleanup_copy_temporaries(&destination_blobs)?;
    for name in blob_names {
        copy_file_resumable(&source_blobs.join(&name), &destination_blobs.join(name))?;
    }
    backup::verify_backup_directory(destination, backup_id).map_err(Into::into)
}

fn copy_file_resumable(source: &Path, destination: &Path) -> Result<(), RestoreError> {
    reject_reparse(source)?;
    let source_metadata = safe_metadata(source)?.ok_or(RestoreError::Failed)?;
    if !source_metadata.is_file() {
        return Err(RestoreError::Failed);
    }
    if safe_metadata(destination)?.is_some() {
        return files_equal(source, destination)
            .then_some(())
            .ok_or(RestoreError::Failed);
    }
    let mut input = File::open(source).map_err(|_| RestoreError::Failed)?;
    let parent = destination.parent().ok_or(RestoreError::Failed)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".restore-copy-")
        .tempfile_in(parent)
        .map_err(|_| RestoreError::Failed)?;
    std::io::copy(&mut input, &mut temporary).map_err(|_| RestoreError::Failed)?;
    temporary.flush().map_err(|_| RestoreError::Failed)?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| RestoreError::Failed)?;
    match temporary.persist_noclobber(destination) {
        Ok(_) => sync_directory_best_effort(parent),
        Err(_) if safe_metadata(destination)?.is_some() && files_equal(source, destination) => {}
        Err(_) => return Err(RestoreError::Failed),
    }
    if !files_equal(source, destination) {
        return Err(RestoreError::Failed);
    }
    Ok(())
}

fn cleanup_copy_temporaries(directory: &Path) -> Result<(), RestoreError> {
    ensure_plain_directory(directory)?;
    for entry in fs::read_dir(directory).map_err(|_| RestoreError::Failed)? {
        let entry = entry.map_err(|_| RestoreError::Failed)?;
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(".restore-copy-")
        {
            continue;
        }
        if !entry
            .file_type()
            .map_err(|_| RestoreError::Failed)?
            .is_file()
        {
            return Err(RestoreError::Failed);
        }
        reject_reparse(&entry.path())?;
        fs::remove_file(entry.path()).map_err(|_| RestoreError::Failed)?;
    }
    sync_directory_best_effort(directory);
    Ok(())
}

fn files_equal(left: &Path, right: &Path) -> bool {
    let Ok(mut left) = File::open(left) else {
        return false;
    };
    let Ok(mut right) = File::open(right) else {
        return false;
    };
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let Ok(left_count) = left.read(&mut left_buffer) else {
            return false;
        };
        let Ok(right_count) = right.read(&mut right_buffer) else {
            return false;
        };
        if left_count != right_count || left_buffer[..left_count] != right_buffer[..right_count] {
            return false;
        }
        if left_count == 0 {
            return true;
        }
    }
}

fn trees_equal(left: &Path, right: &Path) -> Result<bool, RestoreError> {
    reject_reparse_tree(left)?;
    reject_reparse_tree(right)?;
    let mut left_entries = fs::read_dir(left)
        .map_err(|_| RestoreError::Failed)?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name())
                .map_err(|_| RestoreError::Failed)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut right_entries = fs::read_dir(right)
        .map_err(|_| RestoreError::Failed)?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name())
                .map_err(|_| RestoreError::Failed)
        })
        .collect::<Result<Vec<_>, _>>()?;
    left_entries.sort();
    right_entries.sort();
    if left_entries != right_entries {
        return Ok(false);
    }
    for name in left_entries {
        let left_path = left.join(&name);
        let right_path = right.join(&name);
        let left_type = fs::symlink_metadata(&left_path)
            .map_err(|_| RestoreError::Failed)?
            .file_type();
        let right_type = fs::symlink_metadata(&right_path)
            .map_err(|_| RestoreError::Failed)?
            .file_type();
        if left_type.is_dir() && right_type.is_dir() {
            if !trees_equal(&left_path, &right_path)? {
                return Ok(false);
            }
        } else if left_type.is_file() && right_type.is_file() {
            if !files_equal(&left_path, &right_path) {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }
    }
    Ok(true)
}

fn clear_intent_after_commit(
    root: &Path,
    hook: &mut impl FnMut(RecoveryEvent) -> Result<(), RestoreError>,
) -> Result<(), RestoreError> {
    hook(RecoveryEvent {
        action: "clear-intent",
        boundary: HookBoundary::Before,
        kind: RecoveryAction::ClearIntent,
    })?;
    match fs::remove_file(root.join(INTENT_FILE)) {
        Ok(()) => sync_directory_best_effort(root),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        // Commit is already durable. A failed cleanup is safe: a later startup sees the
        // committed marker and skips the restore rather than replaying it.
        Err(_) => {
            eprintln!("mahoshojo: restore 已提交，但 pending intent 清理失败；下次启动将跳过恢复并重试清理");
            return Ok(());
        }
    }
    hook(RecoveryEvent {
        action: "clear-intent",
        boundary: HookBoundary::After,
        kind: RecoveryAction::ClearIntent,
    })
}

fn publish_noclobber(directory: &Path, target: &Path, bytes: &[u8]) -> Result<(), RestoreError> {
    ensure_plain_directory(directory)?;
    if safe_metadata(target)?.is_some() {
        return Err(RestoreError::Failed);
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| RestoreError::Failed)?;
    temporary
        .write_all(bytes)
        .map_err(|_| RestoreError::Failed)?;
    temporary.flush().map_err(|_| RestoreError::Failed)?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| RestoreError::Failed)?;
    temporary
        .persist_noclobber(target)
        .map_err(|_| RestoreError::Failed)?;
    Ok(())
}

fn ensure_native_scratch_root(root: &Path, name: &str) -> Result<PathBuf, RestoreError> {
    let path = root.join(name);
    match safe_metadata(&path)? {
        Some(metadata) if metadata.is_dir() => Ok(path),
        Some(_) => Err(RestoreError::Failed),
        None => {
            fs::create_dir(&path).map_err(|_| RestoreError::Failed)?;
            reject_reparse(&path)?;
            Ok(path)
        }
    }
}

fn ensure_native_id_directory(path: &Path) -> Result<(), RestoreError> {
    match safe_metadata(path)? {
        Some(metadata) if metadata.is_dir() => Ok(()),
        Some(_) => Err(RestoreError::Failed),
        None => fs::create_dir(path).map_err(|_| RestoreError::Failed),
    }
}

fn ensure_plain_directory(path: &Path) -> Result<(), RestoreError> {
    let metadata = safe_metadata(path)?.ok_or(RestoreError::Failed)?;
    if !metadata.is_dir() {
        return Err(RestoreError::Failed);
    }
    reject_reparse(path)
}

fn safe_metadata(path: &Path) -> Result<Option<fs::Metadata>, RestoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if is_reparse_or_symlink(&metadata) {
                return Err(RestoreError::Failed);
            }
            Ok(Some(metadata))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(RestoreError::Failed),
    }
}

fn reject_reparse(path: &Path) -> Result<(), RestoreError> {
    if let Some(metadata) = safe_metadata(path)? {
        if is_reparse_or_symlink(&metadata) {
            return Err(RestoreError::Failed);
        }
    }
    Ok(())
}

fn reject_reparse_components(root: &Path, path: &Path) -> Result<(), RestoreError> {
    let relative = path.strip_prefix(root).map_err(|_| RestoreError::Failed)?;
    let mut current = root.to_path_buf();
    reject_reparse(&current)?;
    for component in relative.components() {
        current.push(component);
        reject_reparse(&current)?;
    }
    Ok(())
}

fn reject_reparse_tree(root: &Path) -> Result<(), RestoreError> {
    ensure_plain_directory(root)?;
    for entry in fs::read_dir(root).map_err(|_| RestoreError::Failed)? {
        let entry = entry.map_err(|_| RestoreError::Failed)?;
        let path = entry.path();
        reject_reparse(&path)?;
        if entry
            .file_type()
            .map_err(|_| RestoreError::Failed)?
            .is_dir()
        {
            reject_reparse_tree(&path)?;
        }
    }
    Ok(())
}

fn is_reparse_or_symlink(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn sync_directory_best_effort(path: &Path) {
    // Rust has no portable directory fsync API. On Unix this strengthens ordering; on
    // Windows directory handles need FILE_FLAG_BACKUP_SEMANTICS, so do not claim this is
    // a power-loss durability guarantee. Every marker file itself is synced before its
    // no-clobber publication, and restart recovery always checks marker plus file facts.
    #[cfg(unix)]
    if let Ok(directory) = File::open(path) {
        let _ = directory.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup;
    use crate::library::LocalLibrary;
    use crate::maintenance::MaintenanceRejection;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn scratch(label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-restore-{label}-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create restore test root");
        root
    }

    fn write_profile(library: &LocalLibrary, id: &str, value: &str) {
        let permit = library.enter_write().expect("write permit");
        let document = serde_json::json!({ "value": value }).to_string();
        library
            .profiles()
            .put(id, &document, "2026-10-03T00:00:00.000Z")
            .expect("write profile");
        drop(permit);
    }

    fn base_fixture(label: &str) -> (PathBuf, String) {
        let root = scratch(label);
        let library = LocalLibrary::open(&root).expect("open fixture library");
        write_profile(&library, "state", "target-generation");
        let target = backup::create_backup(&library).expect("create target backup");
        write_profile(&library, "state", "current-generation");
        drop(library);
        (root, target.backup_id)
    }

    fn clone_tree(source: &Path, destination: &Path) {
        fs::create_dir(destination).expect("create cloned root");
        for entry in fs::read_dir(source).expect("read fixture") {
            let entry = entry.expect("read fixture entry");
            let metadata = entry.file_type().expect("fixture type");
            let target = destination.join(entry.file_name());
            if metadata.is_dir() {
                clone_tree(&entry.path(), &target);
            } else {
                assert!(metadata.is_file(), "fixture contains only plain files");
                fs::copy(entry.path(), target).expect("copy fixture file");
            }
        }
    }

    fn clone_fixture(source: &Path, label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let target = std::env::temp_dir().join(format!(
            "mahoshojo-restore-{label}-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&target);
        clone_tree(source, &target);
        target
    }

    fn inject_old_sidecars(root: &Path) {
        fs::write(root.join(SQLITE_WAL_FILE), b"retained-old-wal").expect("write old wal");
        fs::write(root.join(SQLITE_SHM_FILE), b"retained-old-shm").expect("write old shm");
    }

    fn write_intent(root: &Path, backup_id: &str, restore_id: &str) {
        publish_intent(
            root,
            &RestoreIntent {
                version: INTENT_VERSION,
                backup_id: backup_id.to_string(),
                restore_id: restore_id.to_string(),
            },
        )
        .expect("write restore intent");
    }

    fn assert_restored_target(root: &Path) {
        let library = LocalLibrary::open(root).expect("open restored library");
        let document = library
            .profiles()
            .get("state")
            .expect("read restored profile")
            .expect("restored profile exists");
        let document: serde_json::Value = serde_json::from_str(&document).expect("parse profile");
        assert_eq!(document["value"], "target-generation");
    }

    fn event(action: &'static str, boundary: HookBoundary, kind: RecoveryAction) -> RecoveryEvent {
        RecoveryEvent {
            action,
            boundary,
            kind,
        }
    }

    fn fault_matrix() -> Vec<RecoveryEvent> {
        let mut cases = Vec::new();
        for phase in [
            "staged",
            "old-sqlite-main",
            "old-sqlite-wal",
            "old-sqlite-shm",
            "old-blobs",
            "old-quarantined",
            "new-sqlite-main",
            "new-blobs",
            "verified",
            "committed",
        ] {
            cases.push(event(phase, HookBoundary::Before, RecoveryAction::Marker));
            cases.push(event(phase, HookBoundary::After, RecoveryAction::Marker));
        }
        for action in [
            "old-sqlite-main",
            "old-sqlite-wal",
            "old-sqlite-shm",
            "old-blobs",
            "new-sqlite-main",
            "new-blobs",
        ] {
            cases.push(event(action, HookBoundary::Before, RecoveryAction::Rename));
            cases.push(event(action, HookBoundary::After, RecoveryAction::Rename));
        }
        cases
    }

    fn assert_old_generation_retained(root: &Path, restore_id: &str) {
        let old = old_generation_path(root, restore_id);
        assert!(
            old.join(SQLITE_FILE).is_file(),
            "old main DB must be retained"
        );
        assert!(
            old.join(SQLITE_WAL_FILE).is_file(),
            "old WAL must be retained"
        );
        assert!(
            old.join(SQLITE_SHM_FILE).is_file(),
            "old SHM must be retained"
        );
        assert!(
            old.join(BLOBS_DIRECTORY).is_dir(),
            "old blobs must be retained"
        );
    }

    #[test]
    fn prepare_validates_and_keeps_the_same_maintenance_window_until_drop() {
        let (root, target_backup) = base_fixture("prepare");
        let library = LocalLibrary::open(&root).expect("open library");
        let before = backup::list_backups(&root).expect("list existing backups");
        let prepared = prepare_restore(&library, &target_backup).expect("prepare restore");

        assert!(valid_restore_id(&prepared.response.restore_id));
        assert_eq!(prepared.response.backup_id, target_backup);
        assert_ne!(prepared.response.pre_restore_backup_id, target_backup);
        assert_eq!(
            library.enter_write().err(),
            Some(MaintenanceRejection::MaintenanceBusy),
            "the successful result must retain the maintenance permit"
        );
        let intent: RestoreIntent =
            serde_json::from_slice(&fs::read(root.join(INTENT_FILE)).expect("read intent"))
                .expect("parse intent");
        assert_eq!(intent.restore_id, prepared.response.restore_id);
        assert_eq!(intent.backup_id, target_backup);
        let after = backup::list_backups(&root).expect("list target and safety backups");
        assert_eq!(after.backups.len(), before.backups.len() + 1);

        drop(prepared);
        assert!(
            library.enter_write().is_ok(),
            "dropping the permit reopens writes"
        );
        drop(library);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn shared_restore_fixture_matches_native_response_ids_and_error_codes() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../fixtures/desktop-restore.json"))
                .expect("shared restore fixture");
        let response = PrepareRestoreResponse {
            restore_id: "restore-1790990400000-1234-0".to_string(),
            backup_id: "local-library-20261003T040000Z".to_string(),
            pre_restore_backup_id: "local-library-20261003T040000Z-2".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&response).expect("serialize response"),
            fixture["response"]
        );
        for id in fixture["validIds"].as_array().expect("valid IDs") {
            assert!(valid_restore_id(id.as_str().expect("string ID")));
        }
        for id in fixture["invalidIds"].as_array().expect("invalid IDs") {
            assert!(!valid_restore_id(id.as_str().expect("string ID")));
        }
        let expected = [
            "invalid-backup-id",
            "backup-incomplete",
            "backup-unsupported-version",
            "backup-corrupt",
            "backup-source-unavailable",
            "backup-failed",
            "maintenance-busy",
            "restore-pending",
            "restore-invalid-intent",
            "restore-failed",
        ];
        let actual = fixture["errorCodes"]
            .as_array()
            .expect("error codes")
            .iter()
            .map(|value| value.as_str().expect("string code"))
            .collect::<Vec<_>>();
        assert_eq!(actual, expected);
    }

    #[test]
    fn invalid_backup_does_not_create_safety_backup_or_intent() {
        let (root, _) = base_fixture("invalid-backup");
        let library = LocalLibrary::open(&root).expect("open library");
        let before = backup::list_backups(&root).expect("list backups");
        let error = match prepare_restore(&library, "../../library.sqlite") {
            Ok(_) => panic!("path-shaped backup id must be rejected"),
            Err(error) => error,
        };
        assert_eq!(error.code(), "invalid-backup-id");
        assert!(!root.join(INTENT_FILE).exists());
        let after = backup::list_backups(&root).expect("list backups after rejection");
        assert_eq!(after.backups.len(), before.backups.len());
        drop(library);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_stage_copy_discards_only_its_partial_temporary_files_and_retries() {
        let (base, backup_id) = base_fixture("partial-copy-base");
        let root = clone_fixture(&base, "partial-copy");
        let restore_id = format!("restore-1-{}-700", std::process::id());
        write_intent(&root, &backup_id, &restore_id);
        let stage = staging_path(&root, &restore_id);
        fs::create_dir_all(stage.join(BLOBS_DIRECTORY)).expect("create partial stage");
        fs::write(
            stage.join(".restore-copy-interrupted"),
            b"truncated database",
        )
        .expect("write partial db temp");
        fs::write(
            stage
                .join(BLOBS_DIRECTORY)
                .join(".restore-copy-interrupted"),
            b"truncated blob",
        )
        .expect("write partial blob temp");

        recover_pending(&root).expect("replay removes only owned partial files");
        assert_restored_target(&root);
        assert!(!stage.join(".restore-copy-interrupted").exists());
        assert!(!stage
            .join(BLOBS_DIRECTORY)
            .join(".restore-copy-interrupted")
            .exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn every_rename_and_marker_boundary_replays_to_one_complete_generation() {
        let (base, backup_id) = base_fixture("fault-base");
        for (index, fault) in fault_matrix().into_iter().enumerate() {
            let root = clone_fixture(&base, "fault-case");
            inject_old_sidecars(&root);
            let restore_id = format!("restore-1-{}-{}", std::process::id(), index + 1);
            write_intent(&root, &backup_id, &restore_id);
            let mut reached = false;
            let first = recover_pending_with_hook(&root, &mut |actual| {
                if actual == fault && !reached {
                    reached = true;
                    Err(RestoreError::Interrupted)
                } else {
                    Ok(())
                }
            });
            assert!(reached, "fault point not reached: {fault:?}");
            assert_eq!(first, Err(RestoreError::Interrupted), "fault {fault:?}");

            recover_pending(&root).unwrap_or_else(|error| panic!("replay {fault:?}: {error:?}"));
            assert!(
                !root.join(INTENT_FILE).exists(),
                "intent cleared at {fault:?}"
            );
            assert!(
                !root.join(SQLITE_WAL_FILE).exists(),
                "no old WAL beside new DB"
            );
            assert!(
                !root.join(SQLITE_SHM_FILE).exists(),
                "no old SHM beside new DB"
            );
            assert_old_generation_retained(&root, &restore_id);
            assert_restored_target(&root);
            let _ = fs::remove_dir_all(root);
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn committed_pending_intent_is_not_replayed_over_later_user_writes() {
        let (base, backup_id) = base_fixture("committed-base");
        let root = clone_fixture(&base, "committed-pending");
        inject_old_sidecars(&root);
        let restore_id = format!("restore-1-{}-777", std::process::id());
        write_intent(&root, &backup_id, &restore_id);

        let mut reached = false;
        let interrupted = recover_pending_with_hook(&root, &mut |actual| {
            if actual == event("committed", HookBoundary::After, RecoveryAction::Marker) && !reached
            {
                reached = true;
                Err(RestoreError::Interrupted)
            } else {
                Ok(())
            }
        });
        assert!(reached, "committed marker must be written");
        assert_eq!(interrupted, Err(RestoreError::Interrupted));
        assert!(
            root.join(INTENT_FILE).is_file(),
            "simulated crash leaves intent"
        );

        // On the next start the committed marker wins; cleanup does not reapply the
        // snapshot. A later write must still be present on the following start.
        recover_pending(&root).expect("committed intent cleanup");
        let library = LocalLibrary::open(&root).expect("open committed generation");
        write_profile(&library, "later-write", "after-commit");
        drop(library);
        recover_pending(&root).expect("no pending restore after later write");
        let library = LocalLibrary::open(&root).expect("reopen after later write");
        let later = library
            .profiles()
            .get("later-write")
            .expect("read later write")
            .expect("later write survives");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&later).unwrap()["value"],
            "after-commit"
        );
        assert_old_generation_retained(&root, &restore_id);
        drop(library);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn damaged_installed_generation_fails_closed_and_keeps_old_generation() {
        let (base, backup_id) = base_fixture("damaged-base");
        let root = clone_fixture(&base, "damaged-install");
        inject_old_sidecars(&root);
        let restore_id = format!("restore-1-{}-778", std::process::id());
        write_intent(&root, &backup_id, &restore_id);

        let mut reached = false;
        let interrupted = recover_pending_with_hook(&root, &mut |actual| {
            if actual
                == event(
                    "new-sqlite-main",
                    HookBoundary::After,
                    RecoveryAction::Rename,
                )
                && !reached
            {
                reached = true;
                Err(RestoreError::Interrupted)
            } else {
                Ok(())
            }
        });
        assert!(reached);
        assert_eq!(interrupted, Err(RestoreError::Interrupted));
        fs::write(root.join(SQLITE_FILE), b"damaged new database").expect("corrupt new DB");

        let error = recover_pending(&root).expect_err("damaged generation must fail closed");
        assert_eq!(error.code(), "backup-corrupt");
        assert!(
            root.join(INTENT_FILE).is_file(),
            "failed recovery keeps intent"
        );
        assert_old_generation_retained(&root, &restore_id);
        assert_eq!(
            fs::read(root.join(SQLITE_FILE)).unwrap(),
            b"damaged new database"
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn restore_scratch_symlink_is_rejected_before_formal_paths_change() {
        use std::os::unix::fs::symlink;

        let (base, backup_id) = base_fixture("symlink-base");
        let root = clone_fixture(&base, "symlink-rejected");
        let outside = scratch("symlink-outside");
        let _ = fs::remove_dir_all(root.join(STAGING_ROOT));
        symlink(&outside, root.join(STAGING_ROOT)).expect("create staging symlink");
        let restore_id = format!("restore-1-{}-779", std::process::id());
        write_intent(&root, &backup_id, &restore_id);

        assert_eq!(recover_pending(&root).unwrap_err().code(), "restore-failed");
        assert!(root.join(SQLITE_FILE).is_file());
        assert!(root.join(BLOBS_DIRECTORY).is_dir());
        assert!(outside.read_dir().unwrap().next().is_none());
        let _ = fs::remove_file(root.join(STAGING_ROOT));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        let _ = fs::remove_dir_all(base);
    }
}
