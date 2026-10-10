//! D2.4a native local-library backup creation and verification.
//!
//! A backup is only published when its SQLite snapshot and every blob are present and
//! verified. The final manifest is the completion marker; its contents are checked
//! against the database and files whenever a backup is listed or used for restore.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::blob::{blob_path, parse_digest, BlobPaths};
use crate::library::LocalLibrary;
use crate::maintenance::MaintenancePermit;
use crate::store::{lock_connection, SCHEMA_VERSION};

const BACKUPS_DIRECTORY: &str = "backups";
const DATABASE_FILE: &str = "library.sqlite";
const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_VERSION: u32 = 2;
const BACKUP_ID_LIMIT: usize = 128;
const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_BLOB_ENTRIES: usize = 200_000;
pub const BACKUP_DATABASE_FILE: &str = DATABASE_FILE;
pub const BACKUP_MANIFEST_FILE: &str = MANIFEST_FILE;
pub const BACKUP_BLOBS_DIRECTORY: &str = "blobs";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupSummary {
    pub backup_id: String,
    pub created_at: String,
    pub absolute_path: String,
    pub directory: String,
    pub database_bytes: u64,
    pub blob_count: u64,
    pub blob_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupList {
    pub backups: Vec<BackupSummary>,
    pub invalid_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackupError {
    InvalidBackupId,
    Incomplete,
    UnsupportedVersion,
    Corrupt,
    SourceUnavailable,
    MaintenanceBusy,
    Failed,
}

impl BackupError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidBackupId => "invalid-backup-id",
            Self::Incomplete => "backup-incomplete",
            Self::UnsupportedVersion => "backup-unsupported-version",
            Self::Corrupt => "backup-corrupt",
            Self::SourceUnavailable => "backup-source-unavailable",
            Self::MaintenanceBusy => "maintenance-busy",
            Self::Failed => "backup-failed",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::InvalidBackupId => "backup id is invalid",
            Self::Incomplete => "backup is incomplete",
            Self::UnsupportedVersion => "backup format version is unsupported",
            Self::Corrupt => "backup contents failed integrity verification",
            Self::SourceUnavailable => "local library or backup storage is unavailable",
            Self::MaintenanceBusy => "the local library is being maintained",
            Self::Failed => "backup operation failed",
        }
    }
}

impl Serialize for BackupError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("BackupError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupManifest {
    format_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    schema_version: Option<i64>,
    backup_id: String,
    created_at: String,
    database: ManifestFile,
    blobs: Vec<ManifestBlob>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestFile {
    path: String,
    byte_length: u64,
    digest: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestBlob {
    digest: String,
    byte_length: u64,
}

#[derive(Debug, Clone)]
struct BlobRow {
    digest: String,
    byte_length: u64,
}

/// Enter a maintenance window and create a point-in-time backup.
pub fn create_backup(library: &LocalLibrary) -> Result<BackupSummary, BackupError> {
    let _window = library
        .enter_maintenance("backup")
        .map_err(|_| BackupError::MaintenanceBusy)?;
    create_backup_in_window(library, &_window)
}

/// Create a backup while the caller holds the library maintenance permit.
///
/// The permit argument makes the intended call shape explicit. Restore uses this after
/// taking one window for both its safety backup and preparation work.
pub fn create_backup_in_window(
    library: &LocalLibrary,
    _window: &MaintenancePermit,
) -> Result<BackupSummary, BackupError> {
    let root = library.data_root().join(BACKUPS_DIRECTORY);
    require_real_directory(library.data_root())?;
    if !root.exists() {
        fs::create_dir(&root).map_err(|_| BackupError::SourceUnavailable)?;
    }
    require_real_directory(&root)?;
    let (backup_id, directory) = reserve_backup_directory(&root)?;

    // The directory is intentionally retained on failure. It has no final manifest and
    // therefore cannot be treated as restorable; list_backups reports it as invalid.
    let summary = build_backup(library, &directory, backup_id)?;
    Ok(summary)
}

pub fn list_backups(root: &Path) -> Result<BackupList, BackupError> {
    let backups_root = root.join(BACKUPS_DIRECTORY);
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BackupList {
                backups: Vec::new(),
                invalid_count: 0,
            })
        }
        _ => require_real_directory(root)?,
    }
    match fs::symlink_metadata(&backups_root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BackupList {
                backups: Vec::new(),
                invalid_count: 0,
            })
        }
        _ => require_real_directory(&backups_root)?,
    }
    let entries = match fs::read_dir(&backups_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BackupList {
                backups: Vec::new(),
                invalid_count: 0,
            })
        }
        Err(_) => return Err(BackupError::SourceUnavailable),
    };

    let mut backups = Vec::new();
    let mut invalid_count = 0_u64;
    for entry in entries {
        let entry = entry.map_err(|_| BackupError::SourceUnavailable)?;
        let file_type = entry
            .file_type()
            .map_err(|_| BackupError::SourceUnavailable)?;
        if !file_type.is_dir() {
            continue;
        }
        let Some(backup_id) = entry.file_name().to_str().map(str::to_owned) else {
            invalid_count += 1;
            continue;
        };
        match verify_backup(root, &backup_id) {
            Ok(summary) => backups.push(summary),
            Err(_) => invalid_count += 1,
        }
    }
    backups.sort_by(|left, right| right.backup_id.cmp(&left.backup_id));
    Ok(BackupList {
        backups,
        invalid_count,
    })
}

/// Validate the complete backup before restore consumes it.
pub fn verify_backup(root: &Path, backup_id: &str) -> Result<BackupSummary, BackupError> {
    if !valid_backup_id(backup_id) {
        return Err(BackupError::InvalidBackupId);
    }
    require_real_directory(root)?;
    require_real_directory(&root.join(BACKUPS_DIRECTORY))?;
    verify_backup_directory(&root.join(BACKUPS_DIRECTORY).join(backup_id), backup_id)
}

/// Validate a completed backup layout at an explicit native-selected directory.
/// Used by restore staging before it is installed into the application data root.
pub fn verify_backup_directory(
    directory: &Path,
    backup_id: &str,
) -> Result<BackupSummary, BackupError> {
    if !valid_backup_id(backup_id) {
        return Err(BackupError::InvalidBackupId);
    }
    require_real_directory(directory)?;
    verify_backup_components(
        &directory.join(BACKUP_DATABASE_FILE),
        &directory.join(BACKUP_BLOBS_DIRECTORY),
        &directory.join(BACKUP_MANIFEST_FILE),
        backup_id,
    )
}

/// Verify an existing SQLite file, blob directory, and manifest as one backup generation.
/// Restore uses this both before and after replacing the live files.
pub fn verify_backup_components(
    database_path: &Path,
    blobs_root: &Path,
    manifest_path: &Path,
    backup_id: &str,
) -> Result<BackupSummary, BackupError> {
    verify_components(database_path, blobs_root, manifest_path, backup_id)
        .map(|(summary, _)| summary)
}

fn verify_components(
    database_path: &Path,
    blobs_root: &Path,
    manifest_path: &Path,
    backup_id: &str,
) -> Result<(BackupSummary, Vec<String>), BackupError> {
    if !valid_backup_id(backup_id) {
        return Err(BackupError::InvalidBackupId);
    }
    require_real_directory(database_path.parent().ok_or(BackupError::Corrupt)?)?;
    require_real_directory(blobs_root)?;
    if !is_regular_file(manifest_path) {
        return Err(BackupError::Incomplete);
    }
    let manifest_size = fs::metadata(manifest_path)
        .map_err(|_| BackupError::Incomplete)?
        .len();
    if manifest_size > MAX_MANIFEST_BYTES {
        return Err(BackupError::Corrupt);
    }
    let manifest_bytes = fs::read(manifest_path).map_err(|_| BackupError::Incomplete)?;
    let manifest: BackupManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| BackupError::Corrupt)?;
    if !matches!(manifest.format_version, 1 | MANIFEST_VERSION) {
        return Err(BackupError::UnsupportedVersion);
    }
    if manifest.backup_id != backup_id || !valid_backup_id(&manifest.backup_id) {
        return Err(BackupError::Corrupt);
    }
    if manifest.database.path != DATABASE_FILE || !valid_rfc3339(&manifest.created_at) {
        return Err(BackupError::Corrupt);
    }

    if !is_regular_file(database_path) {
        return Err(BackupError::Incomplete);
    }
    let (database_bytes, database_digest) = digest_file(database_path)?;
    if database_bytes != manifest.database.byte_length
        || database_digest != manifest.database.digest
    {
        return Err(BackupError::Corrupt);
    }

    let database = open_immutable_database(database_path)?;
    let schema_version = verify_sqlite(&database)?;
    match (manifest.format_version, manifest.schema_version) {
        (1, None) => {} // Original V1 backups predate an explicit schema version.
        (_, Some(version)) if version == schema_version => {}
        _ => return Err(BackupError::Corrupt),
    }
    if schema_version >= 4 {
        verify_no_package_without_reference(&database)?;
    }
    let db_blobs = if schema_version >= 3 {
        read_blob_rows(&database)?
    } else {
        Vec::new()
    };
    if db_blobs.len() > MAX_BLOB_ENTRIES || db_blobs.len() != manifest.blobs.len() {
        return Err(BackupError::Corrupt);
    }
    verify_blob_directory(blobs_root, &db_blobs)?;
    let mut blob_bytes = 0_u64;
    for (expected, recorded) in db_blobs.iter().zip(&manifest.blobs) {
        if expected.digest != recorded.digest || expected.byte_length != recorded.byte_length {
            return Err(BackupError::Corrupt);
        }
        let hex = parse_digest(&recorded.digest).map_err(|_| BackupError::Corrupt)?;
        let path = blobs_root.join(hex);
        if !is_regular_file(&path) {
            return Err(BackupError::Corrupt);
        }
        let (length, digest) = digest_file(&path)?;
        if length != recorded.byte_length || digest != recorded.digest {
            return Err(BackupError::Corrupt);
        }
        blob_bytes = blob_bytes.checked_add(length).ok_or(BackupError::Corrupt)?;
    }

    let blob_names = db_blobs
        .iter()
        .map(|blob| {
            parse_digest(&blob.digest)
                .map(str::to_owned)
                .map_err(|_| BackupError::Corrupt)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((
        BackupSummary {
            backup_id: manifest.backup_id,
            created_at: manifest.created_at,
            absolute_path: display_path(database_path.parent().ok_or(BackupError::Corrupt)?),
            directory: display_path(
                database_path
                    .parent()
                    .and_then(Path::parent)
                    .ok_or(BackupError::Corrupt)?,
            ),
            database_bytes,
            blob_count: manifest.blobs.len() as u64,
            blob_bytes,
        },
        blob_names,
    ))
}

fn build_backup(
    library: &LocalLibrary,
    directory: &Path,
    backup_id: String,
) -> Result<BackupSummary, BackupError> {
    let created_at = timestamp_now()?;
    let database_target = directory.join(DATABASE_FILE);
    let database_temp = tempfile::Builder::new()
        .prefix(".library.sqlite.partial-")
        .tempfile_in(directory)
        .map_err(|_| BackupError::SourceUnavailable)?
        .into_temp_path();
    let database_temp_path = database_temp.to_path_buf();

    // Maintenance blocks all mutating IPC while VACUUM INTO reads the live database.
    // The connection lock serializes this snapshot with every SQL operation as well.
    {
        let connection = lock_connection(library.connection()).map_err(|_| BackupError::Failed)?;
        let page_count: u64 = connection
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .map_err(|_| BackupError::Failed)?;
        let page_size: u64 = connection
            .query_row("PRAGMA page_size", [], |row| row.get(0))
            .map_err(|_| BackupError::Failed)?;
        let blob_bytes = read_blob_rows(&connection)?
            .iter()
            .try_fold(0_u64, |sum, row| {
                sum.checked_add(row.byte_length).ok_or(BackupError::Failed)
            })?;
        let minimum = page_count
            .checked_mul(page_size)
            .and_then(|n| n.checked_add(blob_bytes))
            .ok_or(BackupError::Failed)?;
        if fs4::available_space(directory).map_err(|_| BackupError::SourceUnavailable)? < minimum {
            return Err(BackupError::SourceUnavailable);
        }
        let path = database_temp_path.to_str().ok_or(BackupError::Failed)?;
        connection
            .execute("VACUUM INTO ?1", rusqlite::params![path])
            .map_err(|_| BackupError::Failed)?;
    }

    let snapshot = open_immutable_database(&database_temp_path)?;
    verify_sqlite(&snapshot)?;
    let blobs = read_blob_rows(&snapshot)?;
    verify_no_package_without_reference(&snapshot)?;
    let (database_bytes, database_digest) = digest_file(&database_temp_path)?;
    drop(snapshot);
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&database_temp_path)
        .and_then(|file| file.sync_all())
        .map_err(|_| BackupError::Failed)?;
    database_temp
        .persist_noclobber(&database_target)
        .map_err(|_| BackupError::Failed)?;

    let source_paths = BlobPaths::under(library.data_root());
    let destination_paths = BlobPaths::under(directory);
    require_real_directory(source_paths.root())?;
    fs::create_dir_all(destination_paths.root()).map_err(|_| BackupError::SourceUnavailable)?;
    let mut manifest_blobs = Vec::with_capacity(blobs.len());
    let mut blob_bytes = 0_u64;
    for blob in blobs {
        let source = blob_path(&source_paths, &blob.digest).map_err(|_| BackupError::Corrupt)?;
        let destination =
            blob_path(&destination_paths, &blob.digest).map_err(|_| BackupError::Corrupt)?;
        let (actual_length, actual_digest) = copy_and_digest(&source, &destination)?;
        if actual_length != blob.byte_length || actual_digest != blob.digest {
            return Err(BackupError::Corrupt);
        }
        blob_bytes = blob_bytes
            .checked_add(actual_length)
            .ok_or(BackupError::Failed)?;
        manifest_blobs.push(ManifestBlob {
            digest: blob.digest,
            byte_length: actual_length,
        });
    }

    // Reopen and validate the published snapshot and all copied blobs before writing the
    // final completion marker. verify_backup also compares the metadata table to manifest.
    let manifest = BackupManifest {
        format_version: MANIFEST_VERSION,
        schema_version: Some(SCHEMA_VERSION),
        backup_id: backup_id.clone(),
        created_at: created_at.clone(),
        database: ManifestFile {
            path: DATABASE_FILE.to_string(),
            byte_length: database_bytes,
            digest: database_digest,
        },
        blobs: manifest_blobs,
    };
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|_| BackupError::Failed)?;
    let mut manifest_temp =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| BackupError::SourceUnavailable)?;
    manifest_temp
        .as_file_mut()
        .write_all(&manifest_bytes)
        .map_err(|_| BackupError::Failed)?;
    manifest_temp
        .as_file()
        .sync_all()
        .map_err(|_| BackupError::Failed)?;
    manifest_temp
        .persist_noclobber(directory.join(MANIFEST_FILE))
        .map_err(|_| BackupError::Failed)?;
    sync_directory(directory)?;

    let summary = verify_backup(library.data_root(), &backup_id)?;
    if summary.database_bytes != database_bytes || summary.blob_bytes != blob_bytes {
        return Err(BackupError::Corrupt);
    }
    Ok(summary)
}

fn read_blob_rows(connection: &Connection) -> Result<Vec<BlobRow>, BackupError> {
    let mut statement = connection
        .prepare("SELECT digest, byte_length FROM blob ORDER BY digest")
        .map_err(|_| BackupError::Corrupt)?;
    let rows = statement
        .query_map([], |row| {
            Ok(BlobRow {
                digest: row.get(0)?,
                byte_length: row.get::<_, i64>(1)?.try_into().map_err(|_| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Integer,
                        "negative blob length".into(),
                    )
                })?,
            })
        })
        .map_err(|_| BackupError::Corrupt)?;
    let mut blobs = Vec::new();
    for row in rows {
        let row = row.map_err(|_| BackupError::Corrupt)?;
        parse_digest(&row.digest).map_err(|_| BackupError::Corrupt)?;
        if blobs.len() >= MAX_BLOB_ENTRIES {
            return Err(BackupError::Corrupt);
        }
        blobs.push(row);
    }
    Ok(blobs)
}

// Enumerate at most the declared bounded set plus one unexpected entry. A backup
// is a closed payload: even a valid digest-named orphan must never enter restore.
fn verify_blob_directory(root: &Path, blobs: &[BlobRow]) -> Result<(), BackupError> {
    let mut expected: HashSet<&str> = blobs
        .iter()
        .map(|blob| parse_digest(&blob.digest).map_err(|_| BackupError::Corrupt))
        .collect::<Result<_, _>>()?;
    for (index, entry) in fs::read_dir(root)
        .map_err(|_| BackupError::Corrupt)?
        .enumerate()
    {
        if index >= blobs.len() || index >= MAX_BLOB_ENTRIES {
            return Err(BackupError::Corrupt);
        }
        let entry = entry.map_err(|_| BackupError::Corrupt)?;
        let name = entry.file_name();
        let name = name.to_str().ok_or(BackupError::Corrupt)?;
        if !expected.remove(name) || !is_regular_file(&entry.path()) {
            return Err(BackupError::Corrupt);
        }
    }
    if !expected.is_empty() {
        return Err(BackupError::Corrupt);
    }
    Ok(())
}

/// Return only the manifest allowlist after full source validation. Staging is
/// verified again after copying, so later source mutation cannot publish a backup.
pub(crate) fn verified_blob_names(
    directory: &Path,
    backup_id: &str,
) -> Result<Vec<String>, BackupError> {
    require_real_directory(directory)?;
    verify_components(
        &directory.join(DATABASE_FILE),
        &directory.join(BACKUP_BLOBS_DIRECTORY),
        &directory.join(MANIFEST_FILE),
        backup_id,
    )
    .map(|(_, names)| names)
}

fn verify_sqlite(connection: &Connection) -> Result<i64, BackupError> {
    let version = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|_| BackupError::Corrupt)?;
    if !(1..=SCHEMA_VERSION).contains(&version) {
        return Err(BackupError::UnsupportedVersion);
    }
    let mut statement = connection
        .prepare("SELECT version FROM schema_migration ORDER BY version")
        .map_err(|_| BackupError::Corrupt)?;
    let rows = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|_| BackupError::Corrupt)?;
    let mut versions = Vec::new();
    for row in rows {
        if versions.len() >= version as usize {
            return Err(BackupError::Corrupt);
        }
        versions.push(row.map_err(|_| BackupError::Corrupt)?);
    }
    if versions != (1..=version).collect::<Vec<_>>() {
        return Err(BackupError::Corrupt);
    }
    // Check the actual tables/columns for this historical schema, not just its labels.
    for (introduced, table, columns) in [
        (1, "schema_migration", "version, applied_at"),
        (1, "provider_profile", "id, document, updated_at"),
        (2, "local_card", "id, document, card_type, updated_at, updated_at_sort, deleted_at, content_digest"),
        (3, "blob", "digest, byte_length, created_at, last_referenced_at"),
        (4, "local_web_package", "id, document, ref_digest, updated_at, updated_at_sort, deleted_at, archive_byte_length"),
        (4, "web_package_archive_ref", "package_id, digest"),
        (5, "arena_story_session", "id, document, document_bytes, document_digest, seed_document, seed_bytes, seed_digest, revision, title_preview, title_truncated, mode, chapter_plan, created_at, updated_at, chapter_count, last_chapter_id, working_checkpoint_id, last_input_checkpoint_id"),
        (5, "arena_story_chapter", "id, session_id, chapter_index, action, source_chapter_id, title_preview, title_truncated, created_at, markdown_bytes, document, document_bytes, document_digest, operation_id, operation_digest, receipt"),
        (5, "arena_story_checkpoint", "id, session_id, boundary_index, chapter_id, document, document_bytes, document_digest"),
        (6, "arena_story_pending", "token,product,request_id,revision,active,metadata,total_bytes,save_attempt,restored"),
        (6, "arena_story_pending_part", "id,token,kind,byte_length,received_bytes,digest,payload"),
    ] {
        if version >= introduced {
            let is_table: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [table], |row| row.get(0),
            ).map_err(|_| BackupError::Corrupt)?;
            if !is_table { return Err(BackupError::Corrupt); }
            connection.prepare(&format!("SELECT {columns} FROM {table} LIMIT 0"))
                .map_err(|_| BackupError::Corrupt)?;
        } else {
            let exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = ?1)",
                [table], |row| row.get(0),
            ).map_err(|_| BackupError::Corrupt)?;
            if exists { return Err(BackupError::Corrupt); }
        }
    }
    // v7 extends the existing v6 table. Do not add another table-presence
    // tuple above: that would incorrectly reject every historical v6 backup.
    if version >= 6 {
        let claim_column: Option<(String, bool)> = connection.query_row(
            r#"SELECT type, "notnull" FROM pragma_table_info('arena_story_pending') WHERE name='create_claim'"#,
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional().map_err(|_| BackupError::Corrupt)?;
        if if version >= 7 {
            claim_column != Some(("TEXT".into(), false))
        } else {
            claim_column.is_some()
        } {
            return Err(BackupError::Corrupt);
        }
    }
    let integrity = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|_| BackupError::Corrupt)?;
    if integrity != "ok" {
        return Err(BackupError::Corrupt);
    }
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|_| BackupError::Corrupt)?;
    let mut rows = statement.query([]).map_err(|_| BackupError::Corrupt)?;
    if rows.next().map_err(|_| BackupError::Corrupt)?.is_some() {
        return Err(BackupError::Corrupt);
    }
    if version >= 5 {
        crate::arena_story::audit_relations(connection).map_err(|_| BackupError::Corrupt)?;
    }
    if version >= 6 {
        crate::arena_story::pending::audit(connection).map_err(|_| BackupError::Corrupt)?;
    }
    Ok(version)
}

fn verify_no_package_without_reference(connection: &Connection) -> Result<(), BackupError> {
    let orphan = connection
        .query_row(
            "SELECT 1 FROM local_web_package AS package
             LEFT JOIN web_package_archive_ref AS reference
               ON reference.package_id = package.id
             WHERE reference.package_id IS NULL LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()
        .map_err(|_| BackupError::Corrupt)?;
    if orphan.is_some() {
        return Err(BackupError::Corrupt);
    }
    Ok(())
}

fn reserve_backup_directory(root: &Path) -> Result<(String, PathBuf), BackupError> {
    let stem = format!("local-library-{}", backup_stamp()?);
    for suffix in 0_u64.. {
        let backup_id = if suffix == 0 {
            stem.clone()
        } else {
            format!("{stem}-{}", suffix + 1)
        };
        if !valid_backup_id(&backup_id) {
            return Err(BackupError::Failed);
        }
        let directory = root.join(&backup_id);
        match fs::create_dir(&directory) {
            Ok(()) => return Ok((backup_id, directory)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(BackupError::SourceUnavailable),
        }
    }
    Err(BackupError::Failed)
}

fn valid_backup_id(value: &str) -> bool {
    if !value.is_ascii() || value.len() > BACKUP_ID_LIMIT {
        return false;
    }
    let Some(rest) = value.strip_prefix("local-library-") else {
        return false;
    };
    if rest.len() < 16 || !valid_timestamp(&rest[..16]) {
        return false;
    }
    let suffix = &rest[16..];
    if suffix.is_empty() {
        return true;
    }
    let Some(suffix) = suffix.strip_prefix('-') else {
        return false;
    };
    !suffix.is_empty()
        && suffix.bytes().all(|byte| byte.is_ascii_digit())
        && !suffix.starts_with('0')
        && (suffix.len() > 1 || suffix.as_bytes()[0] >= b'2')
}

fn valid_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 16
        && bytes[0..8].iter().all(u8::is_ascii_digit)
        && bytes[8] == b'T'
        && bytes[9..15].iter().all(u8::is_ascii_digit)
        && bytes[15] == b'Z'
}

fn valid_rfc3339(value: &str) -> bool {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).is_ok()
}

fn timestamp_now() -> Result<String, BackupError> {
    let now = time::OffsetDateTime::now_utc();
    now.format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| BackupError::Failed)
}

fn backup_stamp() -> Result<String, BackupError> {
    let now = time::OffsetDateTime::now_utc();
    Ok(format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    ))
}

fn digest_file(path: &Path) -> Result<(u64, String), BackupError> {
    let mut file = File::open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            BackupError::Incomplete
        } else {
            BackupError::SourceUnavailable
        }
    })?;
    let mut hasher = Sha256::new();
    let mut length = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| BackupError::Failed)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        length = length
            .checked_add(count as u64)
            .ok_or(BackupError::Failed)?;
    }
    Ok((length, digest_string(hasher.finalize().as_slice())))
}

fn open_immutable_database(path: &Path) -> Result<Connection, BackupError> {
    let mut uri = url::Url::from_file_path(path).map_err(|_| BackupError::Corrupt)?;
    uri.query_pairs_mut().append_pair("immutable", "1");
    Connection::open_with_flags(
        uri.as_str(),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| BackupError::Corrupt)
}

fn copy_and_digest(source: &Path, destination: &Path) -> Result<(u64, String), BackupError> {
    let mut source = File::open(source).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            BackupError::Corrupt
        } else {
            BackupError::SourceUnavailable
        }
    })?;
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| BackupError::SourceUnavailable)?;
    let mut hasher = Sha256::new();
    let mut length = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = source.read(&mut buffer).map_err(|_| BackupError::Failed)?;
        if count == 0 {
            break;
        }
        destination
            .write_all(&buffer[..count])
            .map_err(|_| BackupError::Failed)?;
        hasher.update(&buffer[..count]);
        length = length
            .checked_add(count as u64)
            .ok_or(BackupError::Failed)?;
    }
    destination.sync_all().map_err(|_| BackupError::Failed)?;
    Ok((length, digest_string(hasher.finalize().as_slice())))
}

fn digest_string(bytes: &[u8]) -> String {
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("sha256:{hex}")
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn require_real_directory(path: &Path) -> Result<(), BackupError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(BackupError::Corrupt),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(BackupError::Incomplete),
        Err(_) => Err(BackupError::SourceUnavailable),
    }
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), BackupError> {
    let directory = File::open(path).map_err(|_| BackupError::SourceUnavailable)?;
    directory.sync_all().map_err(|_| BackupError::Failed)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), BackupError> {
    // Windows 首发环境不提供与 Unix 等价的目录句柄 fsync；此处只承诺文件已 sync，
    // rename 后的目录项抗进程崩溃，不声称已验证断电持久性。
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maintenance::InstanceGuard;
    use crate::store::{open_in_memory_connection, LocalStorePaths};

    fn scratch() -> tempfile::TempDir {
        tempfile::tempdir().expect("scratch directory")
    }

    fn test_library(root: &Path) -> LocalLibrary {
        LocalLibrary::open_with_connection(
            root,
            open_in_memory_connection().expect("open in-memory connection"),
        )
        .expect("library")
    }

    fn save_probe_package(library: &LocalLibrary) -> String {
        let document = serde_json::json!({
            "id": "wp_0123456789abcdef0123456789abcdef",
            "schemaVersion": 1,
            "storageLocation": "local",
            "entityKind": "web-package",
            "title": "backup probe",
            "summary": "backup-probe@1.0.0",
            "ref": {"id":"backup-probe","version":"1.0.0","digest":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
            "manifest": {"name":"backup-probe","files":[]},
            "contentDigest":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "archiveByteLength":4,
            "provenance":{"kind":"unsigned"},
            "createdAt":"2026-10-03T00:00:00.000Z",
            "updatedAt":"2026-10-03T00:00:00.000Z"
        })
        .to_string();
        let index = crate::web_package::WebPackageIndex {
            id: "wp_0123456789abcdef0123456789abcdef".into(),
            updated_at: "2026-10-03T00:00:00.000Z".into(),
            deleted_at: None,
            content_digest:
                "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        };
        library
            .packages()
            .save(
                library.blobs(),
                &document,
                &index,
                b"PK\x03\x04",
                "2026-10-03T00:00:00.000Z",
            )
            .expect("save web package");
        crate::blob::digest_of(b"PK\x03\x04")
    }

    fn historical_backup(root: &Path, version: i64, format_version: u32) -> String {
        let id = "local-library-20261003T000000Z";
        let directory = root.join(BACKUPS_DIRECTORY).join(id);
        fs::create_dir_all(directory.join("blobs")).expect("backup directories");
        let database_path = directory.join(DATABASE_FILE);
        let database = Connection::open(&database_path).expect("historical database");
        crate::store::migrate_to_version_for_test(&database, version);
        database
            .execute(
                "INSERT INTO provider_profile VALUES ('historical', '{}', '2026-10-03T00:00:00Z')",
                [],
            )
            .expect("historical profile");
        let mut blobs = Vec::new();
        if version >= 3 {
            let bytes = b"historical blob";
            let digest = crate::blob::digest_of(bytes);
            database.execute("INSERT INTO blob VALUES (?1, ?2, '2026-10-03T00:00:00Z', '2026-10-03T00:00:00Z')",
                rusqlite::params![digest, bytes.len() as i64]).expect("historical blob metadata");
            fs::write(
                directory.join("blobs").join(parse_digest(&digest).unwrap()),
                bytes,
            )
            .unwrap();
            blobs.push(ManifestBlob {
                digest,
                byte_length: bytes.len() as u64,
            });
        }
        drop(database);
        let (byte_length, digest) = digest_file(&database_path).unwrap();
        let manifest = BackupManifest {
            format_version,
            schema_version: if format_version == 1 {
                None
            } else {
                Some(version)
            },
            backup_id: id.into(),
            created_at: "2026-10-03T00:00:00Z".into(),
            database: ManifestFile {
                path: DATABASE_FILE.into(),
                byte_length,
                digest,
            },
            blobs,
        };
        fs::write(
            directory.join(MANIFEST_FILE),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        id.into()
    }

    #[test]
    fn historical_schemas_restore_then_migrate_with_legacy_and_versioned_manifests() {
        for version in 1..=SCHEMA_VERSION {
            for format in [1, MANIFEST_VERSION] {
                let temp = scratch();
                let root = temp.path();
                let _instance = InstanceGuard::acquire(root).expect("instance lock");
                let library = LocalLibrary::open(root).expect("current live library");
                let id = historical_backup(root, version, format);
                let source = root.join(BACKUPS_DIRECTORY).join(&id).join(DATABASE_FILE);
                let original = fs::read(&source).unwrap();
                assert!(
                    verify_backup(root, &id).is_ok(),
                    "schema {version}, format {format}"
                );
                let prepared = crate::restore::prepare_restore(&library, &id)
                    .expect("prepare historical restore");
                drop(prepared);
                drop(library);
                crate::restore::recover_pending(root).expect("install historical generation");
                let restored = LocalLibrary::open(root).expect("migrate restored generation");
                let connection = restored.connection().lock().unwrap();
                assert_eq!(verify_sqlite(&connection).unwrap(), SCHEMA_VERSION);
                let document: String = connection
                    .query_row(
                        "SELECT document FROM provider_profile WHERE id='historical'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(document, "{}");
                assert_eq!(
                    read_blob_rows(&connection).unwrap().len(),
                    if version >= 3 { 1 } else { 0 }
                );
                drop(connection);
                restored
                    .profiles()
                    .put(
                        "after-restore",
                        r#"{"id":"after-restore"}"#,
                        "2026-10-03T01:00:00Z",
                    )
                    .expect("write migrated database");
                assert_eq!(
                    fs::read(&source).unwrap(),
                    original,
                    "verification and migration must not mutate backup"
                );
            }
        }
    }

    #[test]
    fn version_metadata_and_missing_historical_tables_fail_closed() {
        for case in [
            "future",
            "zero",
            "missing-table",
            "journal",
            "journal-view",
            "journal-missing-column",
            "manifest-mismatch",
            "missing-schema",
        ] {
            let temp = scratch();
            let id = historical_backup(temp.path(), 2, MANIFEST_VERSION);
            let directory = temp.path().join(BACKUPS_DIRECTORY).join(&id);
            let path = directory.join(DATABASE_FILE);
            let database = Connection::open(&path).unwrap();
            match case {
                "future" => database
                    .execute_batch(&format!("PRAGMA user_version = {}", SCHEMA_VERSION + 1))
                    .unwrap(),
                "zero" => database.execute_batch("PRAGMA user_version = 0").unwrap(),
                "missing-table" => database.execute_batch("DROP TABLE local_card").unwrap(),
                "journal-view" => database.execute_batch(
                    "ALTER TABLE schema_migration RENAME TO saved_journal;
                     CREATE VIEW schema_migration AS SELECT version, applied_at FROM saved_journal;"
                ).unwrap(),
                "journal-missing-column" => database.execute_batch(
                    "ALTER TABLE schema_migration DROP COLUMN applied_at;"
                ).unwrap(),
                "journal" => database
                    .execute_batch("DELETE FROM schema_migration WHERE version=2")
                    .unwrap(),
                _ => {}
            }
            drop(database);
            let manifest_path = directory.join(MANIFEST_FILE);
            let mut manifest: BackupManifest =
                serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
            let (length, digest) = digest_file(&path).unwrap();
            manifest.database.byte_length = length;
            manifest.database.digest = digest;
            if case == "manifest-mismatch" {
                manifest.schema_version = Some(3);
            }
            if case == "missing-schema" {
                manifest.schema_version = None;
            }
            fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
            assert_eq!(
                verify_backup(temp.path(), &id),
                Err(if matches!(case, "future" | "zero") {
                    BackupError::UnsupportedVersion
                } else {
                    BackupError::Corrupt
                }),
                "{case}"
            );
        }
    }

    #[test]
    fn undeclared_blob_entries_are_rejected_before_restore_preparation() {
        for case in ["valid-orphan", "wrong-digest", "directory", "invalid-name"] {
            let temp = scratch();
            let root = temp.path();
            let library = test_library(root);
            let summary = create_backup(&library).unwrap();
            let directory = root
                .join(BACKUPS_DIRECTORY)
                .join(&summary.backup_id)
                .join("blobs");
            let digest = crate::blob::digest_of(b"orphan");
            let path = directory.join(parse_digest(&digest).unwrap());
            match case {
                "valid-orphan" => fs::write(path, b"orphan").unwrap(),
                "wrong-digest" => fs::write(path, b"wrong").unwrap(),
                "directory" => fs::create_dir(path).unwrap(),
                "invalid-name" => fs::write(directory.join("unexpected.txt"), b"bad").unwrap(),
                _ => unreachable!(),
            }
            assert_eq!(
                verify_backup(root, &summary.backup_id),
                Err(BackupError::Corrupt),
                "{case}"
            );
            assert!(crate::restore::prepare_restore(&library, &summary.backup_id).is_err());
            assert_eq!(
                fs::read_dir(root.join(BACKUPS_DIRECTORY)).unwrap().count(),
                1,
                "rejected source must not create a safety backup"
            );
        }
    }

    #[test]
    fn backup_is_published_with_a_verified_snapshot_and_blob() {
        let temp = scratch();
        let root = temp.path();
        let library = test_library(root);
        save_probe_package(&library);
        let profile = r#"{"id":"provider-1","secretRef":"provider-secret-ref-no-value"}"#;
        library
            .profiles()
            .put("provider-1", profile, "2026-10-03T00:00:00Z")
            .expect("save profile");
        {
            let connection = library.connection().lock().expect("connection");
            connection
                .execute(
                    "INSERT INTO local_card
                        (id, document, card_type, updated_at, updated_at_sort, deleted_at, content_digest)
                     VALUES (?1, ?2, 'character', '2026-10-03T00:00:00Z', 1790985600000, ?3, ?4)",
                    rusqlite::params![
                        "lc_backup_probe",
                        r#"{"id":"lc_backup_probe","deletedAt":"2026-10-03T00:00:00Z"}"#,
                        "2026-10-03T00:00:00Z",
                        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    ],
                )
                .expect("insert tombstoned card");
            connection
                .execute(
                    "UPDATE local_web_package SET deleted_at='2026-10-03T00:00:00Z'
                     WHERE id='wp_0123456789abcdef0123456789abcdef'",
                    [],
                )
                .expect("tombstone package");
        }

        let summary = create_backup(&library).expect("create backup");
        assert_eq!(summary.blob_count, 1);
        assert_eq!(summary.blob_bytes, 4);
        assert_eq!(verify_backup(root, &summary.backup_id), Ok(summary.clone()));
        assert_eq!(
            summary.absolute_path,
            display_path(&root.join("backups").join(&summary.backup_id))
        );
        assert_eq!(summary.directory, display_path(&root.join("backups")));
        let snapshot = open_immutable_database(
            &root
                .join(BACKUPS_DIRECTORY)
                .join(&summary.backup_id)
                .join(DATABASE_FILE),
        )
        .expect("open verified snapshot");
        let saved_profile: String = snapshot
            .query_row(
                "SELECT document FROM provider_profile WHERE id='provider-1'",
                [],
                |row| row.get(0),
            )
            .expect("profile preserved");
        assert_eq!(saved_profile, profile);
        assert!(!saved_profile.contains("secretValue"));
        let card_tombstone: Option<String> = snapshot
            .query_row(
                "SELECT deleted_at FROM local_card WHERE id='lc_backup_probe'",
                [],
                |row| row.get(0),
            )
            .expect("card preserved");
        let package_tombstone: Option<String> = snapshot
            .query_row(
                "SELECT deleted_at FROM local_web_package WHERE id='wp_0123456789abcdef0123456789abcdef'",
                [],
                |row| row.get(0),
            )
            .expect("package preserved");
        assert_eq!(card_tombstone.as_deref(), Some("2026-10-03T00:00:00Z"));
        assert_eq!(package_tombstone.as_deref(), Some("2026-10-03T00:00:00Z"));
        let listed = list_backups(root).expect("list backups");
        assert_eq!(listed.backups, vec![summary]);
        assert_eq!(listed.invalid_count, 0);
    }

    #[test]
    fn incomplete_or_path_shaped_backup_ids_are_never_restorable() {
        let temp = scratch();
        let root = temp.path();
        let backup_root = root.join(BACKUPS_DIRECTORY);
        fs::create_dir_all(backup_root.join("local-library-20261003T000000Z"))
            .expect("reserve incomplete directory");
        assert_eq!(
            verify_backup(root, "local-library-20261003T000000Z"),
            Err(BackupError::Incomplete)
        );
        assert_eq!(
            verify_backup(root, "../library.sqlite"),
            Err(BackupError::InvalidBackupId)
        );
        let listed = list_backups(root).expect("list backups");
        assert!(listed.backups.is_empty());
        assert_eq!(listed.invalid_count, 1);
    }

    #[test]
    fn ids_and_ipc_shapes_match_the_shared_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../fixtures/desktop-backup.json"))
                .expect("shared backup fixture");
        for id in fixture["validIds"].as_array().expect("valid ids") {
            assert!(valid_backup_id(id.as_str().expect("string id")), "{id}");
        }
        for id in fixture["invalidIds"].as_array().expect("invalid ids") {
            assert!(!valid_backup_id(id.as_str().expect("string id")), "{id}");
        }
        assert!(!valid_backup_id("local-library-20261003T000000Z🪄"));

        let summary: BackupSummary = serde_json::from_value(fixture["summary"].clone())
            .expect("fixture summary matches Rust DTO");
        assert_eq!(summary.backup_id, "local-library-20261003T040000Z-2");
        for code in fixture["errorCodes"].as_array().expect("error codes") {
            let code = code.as_str().expect("string code");
            assert!(
                [
                    "invalid-backup-id",
                    "backup-incomplete",
                    "backup-unsupported-version",
                    "backup-corrupt",
                    "backup-source-unavailable",
                    "backup-failed",
                    "maintenance-busy",
                ]
                .contains(&code),
                "unexpected code {code}"
            );
        }
    }

    #[test]
    fn tampering_with_database_manifest_or_blob_is_rejected() {
        let temp = scratch();
        let root = temp.path();
        let library = test_library(root);
        let digest = save_probe_package(&library);
        let summary = create_backup(&library).expect("create backup");
        let directory = root.join(BACKUPS_DIRECTORY).join(&summary.backup_id);

        let blob_path = blob_path(&BlobPaths::under(&directory), &digest).expect("blob path");
        let valid_blob = fs::read(&blob_path).expect("read blob");
        fs::write(&blob_path, b"bad!").expect("tamper blob");
        assert_eq!(
            verify_backup(root, &summary.backup_id),
            Err(BackupError::Corrupt)
        );
        fs::write(&blob_path, valid_blob).expect("restore blob");

        let database_path = directory.join(DATABASE_FILE);
        let valid_database = fs::read(&database_path).expect("read database");
        let mut bad_database = valid_database.clone();
        bad_database[0] ^= 1;
        fs::write(&database_path, bad_database).expect("tamper database");
        assert_eq!(
            verify_backup(root, &summary.backup_id),
            Err(BackupError::Corrupt)
        );
        fs::write(&database_path, valid_database).expect("restore database");

        let manifest_path = directory.join(MANIFEST_FILE);
        let valid_manifest = fs::read(&manifest_path).expect("read manifest");
        fs::write(&manifest_path, b"{}").expect("tamper manifest");
        assert_eq!(
            verify_backup(root, &summary.backup_id),
            Err(BackupError::Corrupt)
        );
        fs::write(&manifest_path, valid_manifest).expect("restore manifest");
        assert!(verify_backup(root, &summary.backup_id).is_ok());
    }

    #[test]
    fn corrupted_source_blob_fails_without_publishing_a_manifest_or_changing_sqlite() {
        let temp = scratch();
        let root = temp.path();
        let library = test_library(root);
        let digest = save_probe_package(&library);
        let source_blob = blob_path(&BlobPaths::under(root), &digest).expect("source blob path");
        fs::write(&source_blob, b"bad!").expect("corrupt source blob");

        assert_eq!(create_backup(&library), Err(BackupError::Corrupt));
        let backups = list_backups(root).expect("list failed backup");
        assert!(backups.backups.is_empty());
        assert_eq!(backups.invalid_count, 1);
        assert!(library
            .packages()
            .get("wp_0123456789abcdef0123456789abcdef")
            .expect("live record remains readable")
            .is_some());
        assert!(
            !library.enter_maintenance("probe").is_err(),
            "failed backup releases its permit"
        );
    }

    #[test]
    fn same_second_backups_reserve_distinct_directories_without_overwrite() {
        let temp = scratch();
        let root = temp.path();
        let library = test_library(root);
        let first = create_backup(&library).expect("first backup");
        let second = create_backup(&library).expect("second backup");
        assert_ne!(first.backup_id, second.backup_id);
        assert!(verify_backup(root, &first.backup_id).is_ok());
        assert!(verify_backup(root, &second.backup_id).is_ok());
    }

    #[test]
    fn disk_backup_captures_uncheckpointed_wal_state() {
        let temp = scratch();
        let root = temp.path();
        let _instance = InstanceGuard::acquire(root).expect("instance guard");
        let library = LocalLibrary::open(root).expect("disk library");
        let database_path = LocalStorePaths::under(root).database().to_path_buf();
        library
            .connection()
            .lock()
            .expect("connection")
            .execute_batch("PRAGMA wal_autocheckpoint=0;")
            .expect("disable wal checkpoint");
        let profile = r#"{"id":"p1","secretRef":"provider-secret-ref-no-value"}"#;
        library
            .profiles()
            .put("p1", profile, "2026-10-03T00:00:00Z")
            .expect("write profile into WAL");
        let wal_path = PathBuf::from(format!("{}-wal", database_path.display()));
        assert!(fs::metadata(wal_path).expect("WAL exists").len() > 0);

        let summary = create_backup(&library).expect("backup captures WAL");
        let snapshot =
            open_immutable_database(&Path::new(&summary.absolute_path).join(DATABASE_FILE))
                .expect("open snapshot");
        let saved: String = snapshot
            .query_row(
                "SELECT document FROM provider_profile WHERE id='p1'",
                [],
                |row| row.get(0),
            )
            .expect("profile is in snapshot");
        assert_eq!(saved, profile);
        assert!(!saved.contains("secretValue"));
    }
}
