//! Device-owned text Tea storage. Documents are inert JSON; no AI, path or network authority.
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::maintenance::MaintenanceGate;
use crate::store::{lock_connection, SharedConnection, StoreError};

pub const MESSAGE_BYTES: usize = 32 * 1024 * 1024;
pub const SESSION_BYTES: usize = 8 * 1024 * 1024;
pub const WRITE_BYTES: usize = 64 * 1024 * 1024;
pub const PAGE_BYTES: usize = 33 * 1024 * 1024;
pub const DIRECTORY_BYTES: usize = 128 * 1024;
const DOCUMENT_NODES: usize = 2_000_000;
const ENVELOPE_NODES: usize = 4_000_000;
const RECEIPT_READ_BYTES: usize = WRITE_BYTES + 1024;
const MAX_SAFE: i64 = 9_007_199_254_740_991;
const ERROR_MESSAGE: &str =
    "Local tea storage did not complete; retain the input or unsaved result";

pub(crate) const MIGRATION_11: &str = r#"
CREATE TABLE magic_tea_session (
 id TEXT PRIMARY KEY NOT NULL, instance TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL CHECK(revision > 0 AND revision <= 9007199254740991),
 document TEXT NOT NULL CHECK(json_valid(document)), document_bytes INTEGER NOT NULL CHECK(document_bytes=length(CAST(document AS BLOB))),
 document_digest TEXT NOT NULL, preview TEXT NOT NULL CHECK(json_valid(preview)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 active_begin TEXT, active_message TEXT,
 CHECK((active_begin IS NULL)=(active_message IS NULL))
) STRICT;
CREATE INDEX magic_tea_session_updated ON magic_tea_session(updated_at DESC,id DESC);
CREATE TABLE magic_tea_message (
 id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal > 0 AND ordinal <= 9007199254740991),
 document TEXT NOT NULL CHECK(json_valid(document)), document_bytes INTEGER NOT NULL CHECK(document_bytes=length(CAST(document AS BLOB))), document_digest TEXT NOT NULL,
 UNIQUE(session_id,ordinal), FOREIGN KEY(session_id) REFERENCES magic_tea_session(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX magic_tea_message_session ON magic_tea_message(session_id,ordinal,id);
CREATE TABLE magic_tea_receipt (
 operation_id TEXT PRIMARY KEY NOT NULL, request_digest TEXT NOT NULL,
 result TEXT NOT NULL CHECK(json_valid(result))
) STRICT;
CREATE TABLE magic_tea_catalog (
 singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
 revision INTEGER NOT NULL CHECK(revision > 0 AND revision <= 9007199254740991)
) STRICT;
INSERT INTO magic_tea_catalog(singleton,revision) VALUES(1,1);
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeaError {
    Invalid,
    TooLarge,
    Missing,
    Stale,
    Busy,
    OperationMismatch,
    Corrupt,
    Io,
    CommitUnknown,
    Maintenance,
}
impl Serialize for TeaError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let code = match self {
            Self::Invalid => "tea-invalid",
            Self::TooLarge => "tea-too-large",
            Self::Missing => "tea-missing",
            Self::Stale => "tea-stale",
            Self::Busy => "tea-busy",
            Self::OperationMismatch => "tea-operation-mismatch",
            Self::Corrupt => "tea-corrupt",
            Self::Io => "tea-io",
            Self::CommitUnknown => "tea-commit-unknown",
            Self::Maintenance => "maintenance-busy",
        };
        json!({"code":code,"message":ERROR_MESSAGE,"writeEvidence":if *self==Self::CommitUnknown {"unknown"}else{"not-written"}}).serialize(serializer)
    }
}
impl From<rusqlite::Error> for TeaError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Io
    }
}
fn from_store(error: StoreError) -> TeaError {
    if error == StoreError::TransactionUnresolved {
        TeaError::CommitUnknown
    } else {
        TeaError::Io
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListCursor {
    pub catalog_revision: i64,
    pub pinned_at: i64,
    pub pinned_order: i64,
    pub updated_at: i64,
    pub id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MessageCursor {
    pub ordinal: i64,
    pub id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ReadOperation {
    #[serde(rename_all = "camelCase")]
    List {
        cursor: Option<ListCursor>,
        expected_catalog_revision: Option<i64>,
        limit: usize,
    },
    #[serde(rename_all = "camelCase")]
    Session {
        session_id: String,
        expected_catalog_revision: Option<i64>,
    },
    #[serde(rename_all = "camelCase")]
    Messages {
        session_id: String,
        instance: String,
        expected_revision: i64,
        cursor: Option<MessageCursor>,
        expected_catalog_revision: Option<i64>,
        limit: usize,
    },
    #[serde(rename_all = "camelCase")]
    Receipt {
        write: WriteRequest,
    },
    MergePreview {
        source: SessionTarget,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadRequest {
    pub version: u32,
    pub request: ReadOperation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportEntry {
    pub session: Value,
    pub messages: Vec<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionTarget {
    pub session_id: String,
    pub instance: String,
    pub expected_revision: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum WriteOperation {
    Create {
        session: Value,
    },
    #[serde(rename_all = "camelCase")]
    Update {
        session_id: String,
        instance: String,
        expected_revision: i64,
        session: Value,
    },
    #[serde(rename_all = "camelCase")]
    Delete {
        session_id: String,
        instance: String,
        expected_revision: i64,
    },
    #[serde(rename_all = "camelCase")]
    SetPin {
        session_id: String,
        instance: String,
        expected_revision: i64,
        operation_id: String,
        pinned: bool,
    },
    #[serde(rename_all = "camelCase")]
    DeleteSelected {
        operation_id: String,
        targets: Vec<SessionTarget>,
    },
    #[serde(rename_all = "camelCase")]
    Import {
        operation_id: String,
        entries: Vec<ImportEntry>,
    },
    #[serde(rename_all = "camelCase")]
    Fork {
        operation_id: String,
        session_id: String,
        instance: String,
        expected_revision: i64,
        anchor_message_id: String,
        edited_content: String,
        target_session_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Merge {
        operation_id: String,
        source: SessionTarget,
        parent: SessionTarget,
        anchor_message_id: String,
        edited_message_id: String,
    },
    #[serde(rename_all = "camelCase")]
    BeginGeneration {
        session_id: String,
        instance: String,
        expected_revision: i64,
        operation_id: String,
        session: Value,
        user_message: Option<Value>,
        assistant_message: Value,
    },
    #[serde(rename_all = "camelCase")]
    FinishGeneration {
        session_id: String,
        instance: String,
        expected_revision: i64,
        operation_id: String,
        begin_operation_id: String,
        session: Value,
        assistant_message: Value,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteRequest {
    pub version: u32,
    pub request: WriteOperation,
}

// Read-only projections: never change persisted preview or legacy archive JSON.
const PIN_AT_SQL: &str = "CASE WHEN json_type(document,'$.pinnedAt') IN ('integer','real') AND json_extract(document,'$.pinnedAt') BETWEEN 1 AND 9007199254740991 AND CAST(json_extract(document,'$.pinnedAt') AS INTEGER)=json_extract(document,'$.pinnedAt') THEN CAST(json_extract(document,'$.pinnedAt') AS INTEGER) ELSE 0 END";
const PIN_ORDER_SQL: &str = "CASE WHEN json_type(document,'$.pinnedOrder') IN ('integer','real') AND json_extract(document,'$.pinnedOrder') BETWEEN 1 AND 9007199254740991 AND CAST(json_extract(document,'$.pinnedOrder') AS INTEGER)=json_extract(document,'$.pinnedOrder') THEN CAST(json_extract(document,'$.pinnedOrder') AS INTEGER) ELSE 0 END";
fn directory_sql() -> String {
    format!("WITH projected AS MATERIALIZED (SELECT id,instance,revision,preview,created_at,updated_at,({PIN_AT_SQL}) AS pin,({PIN_ORDER_SQL}) AS pin_order FROM magic_tea_session), ordered AS (SELECT *,CASE WHEN pin>0 THEN pin_order ELSE 0 END AS sort_order FROM projected) SELECT id,instance,revision,preview,created_at,updated_at,(SELECT COUNT(*) FROM magic_tea_message m WHERE m.session_id=ordered.id),pin,sort_order FROM ordered WHERE ?1=0 OR ((pin>0),sort_order,pin,updated_at,id)<((?2>0),?3,?2,?4,?5) ORDER BY (pin>0) DESC,sort_order DESC,pin DESC,updated_at DESC,id DESC LIMIT ?6")
}
fn valid_pin(document: &Value, key: &str) -> i64 {
    document
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && *v >= 1.0 && *v <= MAX_SAFE as f64 && v.fract() == 0.0)
        .map(|v| v as i64)
        .unwrap_or(0)
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn instance(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_revision(value: i64) -> bool {
    (1..=MAX_SAFE).contains(&value)
}
fn integer(value: &Value, key: &str) -> Result<i64, TeaError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .filter(|v| (0..=MAX_SAFE).contains(v))
        .ok_or(TeaError::Invalid)
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, TeaError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(TeaError::Invalid)
}
fn checked_id<'a>(value: &'a Value, key: &str) -> Result<&'a str, TeaError> {
    let text = string(value, key)?;
    if id(text) {
        Ok(text)
    } else {
        Err(TeaError::Invalid)
    }
}
fn encoded(value: &Value) -> Result<String, TeaError> {
    serde_json::to_string(value).map_err(|_| TeaError::Invalid)
}
fn digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn json_boundary(value: &Value, bytes: usize, nodes: usize) -> Result<String, TeaError> {
    json_boundary_depth(value, bytes, nodes, 64)
}
fn json_boundary_depth(
    value: &Value,
    bytes: usize,
    nodes: usize,
    max_depth: usize,
) -> Result<String, TeaError> {
    let text = encoded(value)?;
    if text.len() > bytes {
        return Err(TeaError::TooLarge);
    }
    let mut stack = vec![(value, 0)];
    let mut visited = 0;
    while let Some((value, depth)) = stack.pop() {
        visited += 1;
        if visited > nodes || depth > max_depth {
            return Err(TeaError::TooLarge);
        }
        match value {
            Value::Object(object) => {
                for (key, child) in object {
                    if matches!(key.as_str(), "__proto__" | "prototype" | "constructor") {
                        return Err(TeaError::Invalid);
                    }
                    stack.push((child, depth + 1));
                }
            }
            Value::Array(array) => {
                for child in array {
                    stack.push((child, depth + 1));
                }
            }
            _ => {}
        }
    }
    Ok(text)
}
fn object(value: &Value) -> Result<(), TeaError> {
    if value.is_object() {
        Ok(())
    } else {
        Err(TeaError::Invalid)
    }
}
fn validate_session(value: &Value) -> Result<String, TeaError> {
    let text = json_boundary(value, SESSION_BYTES, DOCUMENT_NODES)?;
    object(value)?;
    checked_id(value, "id")?;
    string(value, "title")?;
    integer(value, "createdAt")?;
    integer(value, "updatedAt")?;
    if value.get("tachieAssets").is_some() {
        return Err(TeaError::Invalid);
    }
    let settings = value.get("settings").ok_or(TeaError::Invalid)?;
    object(settings)?;
    string(settings, "providerId")?;
    string(settings, "modelId")?;
    for role in value
        .get("roles")
        .and_then(Value::as_array)
        .ok_or(TeaError::Invalid)?
    {
        validate_card(role, "name")?;
    }
    if let Some(card) = value.get("scenario") {
        validate_card(card, "title")?;
    }
    if let Some(cards) = value.get("auxScenarios") {
        for card in cards.as_array().ok_or(TeaError::Invalid)? {
            validate_card(card, "title")?;
        }
    }
    for field in ["summaryMeta", "protocolShadow", "updateSnapshot"] {
        if let Some(meta) = value.get(field) {
            object(meta)?;
        }
    }
    if let Some(summary) = value.get("summary") {
        if !summary.is_string() {
            return Err(TeaError::Invalid);
        }
    }
    if let Some(sections) = value.get("summarySections") {
        if !sections
            .as_object()
            .ok_or(TeaError::Invalid)?
            .values()
            .all(Value::is_string)
        {
            return Err(TeaError::Invalid);
        }
    }
    if let Some(fork) = value.get("forkedFrom") {
        checked_id(fork, "sessionId")?;
        checked_id(fork, "messageId")?;
        integer(fork, "createdAt")?;
    }
    if let Some(draft) = value.get("draft") {
        if !draft.is_string() {
            return Err(TeaError::Invalid);
        }
    }
    if let Some(choices) = value.get("lastChoices") {
        validate_choices(choices)?;
    }
    Ok(text)
}
fn validate_card(value: &Value, title: &str) -> Result<(), TeaError> {
    object(value)?;
    checked_id(value, "id")?;
    string(value, title)?;
    object(value.get("card").ok_or(TeaError::Invalid)?)?;
    if !matches!(
        string(value, "source")?,
        "local" | "cloud" | "public" | "tavern" | "random" | "preset"
    ) {
        return Err(TeaError::Invalid);
    }
    Ok(())
}
fn validate_choices(value: &Value) -> Result<(), TeaError> {
    for item in value.as_array().ok_or(TeaError::Invalid)? {
        object(item)?;
        string(item, "id")?;
        string(item, "text")?;
    }
    Ok(())
}
fn validate_message(value: &Value, session_id: &str) -> Result<String, TeaError> {
    let text = json_boundary(value, MESSAGE_BYTES, DOCUMENT_NODES)?;
    object(value)?;
    checked_id(value, "id")?;
    if checked_id(value, "sessionId")? != session_id || value.get("tachieId").is_some() {
        return Err(TeaError::Invalid);
    }
    if !matches!(string(value, "role")?, "user" | "assistant" | "system") {
        return Err(TeaError::Invalid);
    }
    string(value, "content")?;
    integer(value, "createdAt")?;
    if let Some(status) = value.get("status") {
        if !matches!(
            status.as_str(),
            Some("streaming" | "done" | "error" | "blocked")
        ) {
            return Err(TeaError::Invalid);
        }
    }
    for field in ["sourceMessageId", "revisionOf"] {
        if value.get(field).is_some() {
            checked_id(value, field)?;
        }
    }
    if let Some(meta) = value.get("meta") {
        object(meta)?;
    }
    if let Some(error) = value.get("error") {
        object(error)?;
        string(error, "code")?;
        string(error, "message")?;
    }
    if let Some(choices) = value.get("choices") {
        validate_choices(choices)?;
    }
    if let Some(segments) = value.get("segments") {
        for segment in segments.as_array().ok_or(TeaError::Invalid)? {
            match string(segment, "type")? {
                "narration" => {
                    string(segment, "text")?;
                }
                "dialogue" => {
                    string(segment, "text")?;
                    string(segment, "speakerId")?;
                    if let Some(name) = segment.get("speakerName") {
                        if !name.is_string() {
                            return Err(TeaError::Invalid);
                        }
                    }
                }
                "choices" => validate_choices(segment.get("items").ok_or(TeaError::Invalid)?)?,
                _ => return Err(TeaError::Invalid),
            }
        }
    }
    Ok(text)
}
fn validate_target_fields(sid: &str, inst: &str, revision: i64) -> Result<(), TeaError> {
    if id(sid) && instance(inst) && valid_revision(revision) {
        Ok(())
    } else {
        Err(TeaError::Invalid)
    }
}
// ECMAScript String.trim whitespace, including BOM but excluding NEL.
fn branch_trim(value: &str) -> &str {
    value.trim_matches(|c: char| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'))
}
fn validate_write(operation: &WriteOperation) -> Result<(), TeaError> {
    match operation {
        WriteOperation::Create { session } => {
            validate_session(session)?;
        }
        WriteOperation::Update {
            session_id,
            instance,
            expected_revision,
            session,
        } => {
            validate_target_fields(session_id, instance, *expected_revision)?;
            validate_session(session)?;
            if session["id"] != *session_id {
                return Err(TeaError::Invalid);
            }
        }
        WriteOperation::Delete {
            session_id,
            instance,
            expected_revision,
        } => validate_target_fields(session_id, instance, *expected_revision)?,
        WriteOperation::SetPin {
            session_id,
            instance,
            expected_revision,
            operation_id,
            ..
        } => {
            validate_target_fields(session_id, instance, *expected_revision)?;
            if !id(operation_id) {
                return Err(TeaError::Invalid);
            }
        }
        WriteOperation::DeleteSelected {
            operation_id,
            targets,
        } => {
            if !id(operation_id) || targets.is_empty() || targets.len() > 50 {
                return Err(TeaError::Invalid);
            }
            let mut ids = HashSet::new();
            for row in targets {
                validate_target_fields(&row.session_id, &row.instance, row.expected_revision)?;
                if !ids.insert(&row.session_id) {
                    return Err(TeaError::Invalid);
                }
            }
        }
        WriteOperation::Import {
            operation_id,
            entries,
        } => {
            if !id(operation_id) {
                return Err(TeaError::Invalid);
            }
            if entries.is_empty()
                || entries.len() > 128
                || entries.iter().map(|e| e.messages.len()).sum::<usize>() > 10_000
            {
                return Err(TeaError::TooLarge);
            }
            let mut sids = HashSet::new();
            let mut mids = HashSet::new();
            for entry in entries {
                validate_session(&entry.session)?;
                let sid = checked_id(&entry.session, "id")?;
                if !sids.insert(sid) {
                    return Err(TeaError::Invalid);
                }
                for message in &entry.messages {
                    validate_message(message, sid)?;
                    if message["status"] == "streaming" || !mids.insert(checked_id(message, "id")?)
                    {
                        return Err(TeaError::Invalid);
                    }
                }
            }
        }
        WriteOperation::Fork {
            operation_id,
            session_id,
            instance,
            expected_revision,
            anchor_message_id,
            edited_content,
            target_session_id,
        } => {
            validate_target_fields(session_id, instance, *expected_revision)?;
            if !id(operation_id)
                || !id(anchor_message_id)
                || !id(target_session_id)
                || target_session_id == session_id
                || branch_trim(edited_content).is_empty()
            {
                return Err(TeaError::Invalid);
            }
            if edited_content.len() > MESSAGE_BYTES {
                return Err(TeaError::TooLarge);
            }
        }
        WriteOperation::Merge {
            operation_id,
            source,
            parent,
            anchor_message_id,
            edited_message_id,
        } => {
            validate_target_fields(
                &source.session_id,
                &source.instance,
                source.expected_revision,
            )?;
            validate_target_fields(
                &parent.session_id,
                &parent.instance,
                parent.expected_revision,
            )?;
            if source.session_id == parent.session_id
                || !id(operation_id)
                || !id(anchor_message_id)
                || !id(edited_message_id)
            {
                return Err(TeaError::Invalid);
            }
        }
        WriteOperation::BeginGeneration {
            session_id,
            instance,
            expected_revision,
            operation_id,
            session,
            user_message,
            assistant_message,
        } => {
            validate_target_fields(session_id, instance, *expected_revision)?;
            if !id(operation_id) {
                return Err(TeaError::Invalid);
            }
            validate_session(session)?;
            validate_message(assistant_message, session_id)?;
            if session["id"] != *session_id
                || !exact_keys(
                    assistant_message,
                    &["id", "sessionId", "role", "content", "createdAt", "status"],
                )
                || assistant_message["role"] != "assistant"
                || assistant_message["status"] != "streaming"
                || assistant_message["content"] != ""
            {
                return Err(TeaError::Invalid);
            }
            if let Some(user) = user_message {
                validate_message(user, session_id)?;
                if user["role"] != "user"
                    || user["status"] == "streaming"
                    || user["id"] == assistant_message["id"]
                {
                    return Err(TeaError::Invalid);
                }
            }
        }
        WriteOperation::FinishGeneration {
            session_id,
            instance,
            expected_revision,
            operation_id,
            begin_operation_id,
            session,
            assistant_message,
        } => {
            validate_target_fields(session_id, instance, *expected_revision)?;
            if !id(operation_id) || !id(begin_operation_id) {
                return Err(TeaError::Invalid);
            }
            validate_session(session)?;
            validate_message(assistant_message, session_id)?;
            if session["id"] != *session_id
                || assistant_message["role"] != "assistant"
                || !matches!(
                    assistant_message["status"].as_str(),
                    Some("done" | "error" | "blocked")
                )
            {
                return Err(TeaError::Invalid);
            }
        }
    }
    Ok(())
}
fn exact_keys(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}
fn validate_saved(value: &Value) -> Result<(), TeaError> {
    checked_id(value, "sessionId")?;
    if !instance(string(value, "instance")?) || !valid_revision(integer(value, "revision")?) {
        return Err(TeaError::Corrupt);
    }
    Ok(())
}
fn validate_result(value: &Value) -> Result<(), TeaError> {
    let action = string(value, "action")?;
    match action {
        "create" | "update" | "delete" => {
            if !exact_keys(value, &["action", "sessionId", "instance", "revision"]) {
                return Err(TeaError::Corrupt);
            }
            validate_saved(value)?;
        }
        "fork" => {
            if !exact_keys(
                value,
                &["action", "sessionId", "instance", "revision", "operationId"],
            ) || value["revision"] != 1
            {
                return Err(TeaError::Corrupt);
            }
            validate_saved(value)?;
            checked_id(value, "operationId")?;
        }
        "merge" => {
            if !exact_keys(
                value,
                &[
                    "action",
                    "sessionId",
                    "instance",
                    "revision",
                    "operationId",
                    "source",
                ],
            ) || !exact_keys(&value["source"], &["sessionId", "instance", "revision"])
                || value["source"]["sessionId"] == value["sessionId"]
            {
                return Err(TeaError::Corrupt);
            }
            validate_saved(value)?;
            validate_saved(&value["source"])?;
            checked_id(value, "operationId")?;
        }
        "begin-generation" | "finish-generation" => {
            if !exact_keys(
                value,
                &[
                    "action",
                    "sessionId",
                    "instance",
                    "revision",
                    "operationId",
                    "assistantMessageId",
                ],
            ) {
                return Err(TeaError::Corrupt);
            }
            validate_saved(value)?;
            checked_id(value, "operationId")?;
            checked_id(value, "assistantMessageId")?;
        }
        "set-pin" => {
            if !exact_keys(
                value,
                &[
                    "action",
                    "sessionId",
                    "instance",
                    "revision",
                    "operationId",
                    "pinnedAt",
                    "pinnedOrder",
                ],
            ) {
                return Err(TeaError::Corrupt);
            }
            validate_saved(value)?;
            checked_id(value, "operationId")?;
            let pinned_at = integer(value, "pinnedAt")?;
            let pinned_order = integer(value, "pinnedOrder")?;
            if (pinned_at == 0) != (pinned_order == 0) {
                return Err(TeaError::Corrupt);
            }
        }
        "import" | "delete-selected" => {
            if !exact_keys(value, &["action", "operationId", "sessions"]) {
                return Err(TeaError::Corrupt);
            }
            checked_id(value, "operationId")?;
            let rows = value["sessions"].as_array().ok_or(TeaError::Corrupt)?;
            if rows.is_empty() || rows.len() > (if action == "import" { 128 } else { 50 }) {
                return Err(TeaError::Corrupt);
            }
            let mut ids = HashSet::new();
            let mut instances = HashSet::new();
            for row in rows {
                if !exact_keys(row, &["sessionId", "instance", "revision"]) {
                    return Err(TeaError::Corrupt);
                }
                validate_saved(row)?;
                if (action == "import" && row["revision"] != 1)
                    || !ids.insert(string(row, "sessionId")?)
                    || !instances.insert(string(row, "instance")?)
                {
                    return Err(TeaError::Corrupt);
                }
            }
        }
        _ => return Err(TeaError::Corrupt),
    }
    Ok(())
}
// Mirrors the Web branch-summary helper: coverage must be provably retained;
// an unknown legacy watermark alone does not invalidate a summary.
fn fork_summary(
    c: &Connection,
    document: &mut Value,
    sid: &str,
    ordinal: i64,
    ids: &HashMap<String, String>,
) -> Result<(), TeaError> {
    branch_summary(c, document, sid, ordinal, Some(ids))
}
fn branch_summary(
    c: &Connection,
    document: &mut Value,
    sid: &str,
    ordinal: i64,
    ids: Option<&HashMap<String, String>>,
) -> Result<(), TeaError> {
    let mut clear = false;
    if let Some(to) = document["summaryMeta"]["toMessageId"].as_str() {
        let at: Option<i64> = c
            .query_row(
                "SELECT ordinal FROM magic_tea_message WHERE session_id=?1 AND id=?2",
                params![sid, to],
                |r| r.get(0),
            )
            .optional()?;
        clear = at.is_some_and(|at| at >= ordinal);
    }
    if let Some(meta) = document
        .get_mut("summaryMeta")
        .and_then(Value::as_object_mut)
    {
        for field in ["fromMessageId", "toMessageId"] {
            if let Some(new_id) = meta
                .get(field)
                .and_then(Value::as_str)
                .and_then(|id| ids.and_then(|ids| ids.get(id)))
            {
                meta.insert(field.into(), json!(new_id));
            }
        }
        if let Some(coverage) = meta.get_mut("coverage") {
            for field in ["selectedMessageIds", "clippedMessageIds"] {
                match coverage.get_mut(field).and_then(Value::as_array_mut) {
                    Some(values) => {
                        for value in values {
                            if let Some(ids) = ids {
                                match value.as_str().and_then(|id| ids.get(id)) {
                                    Some(new_id) => *value = json!(new_id),
                                    None => clear = true,
                                }
                            } else if let Some(id) = value.as_str() {
                                let retained: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM magic_tea_message WHERE session_id=?1 AND id=?2 AND ordinal<?3)", params![sid, id, ordinal], |r| r.get(0))?;
                                if !retained {
                                    clear = true;
                                }
                            } else {
                                clear = true;
                            }
                        }
                    }
                    None => clear = true,
                }
            }
        }
    }
    if clear {
        let object = document.as_object_mut().ok_or(TeaError::Corrupt)?;
        for field in ["summary", "summarySections", "summaryMeta"] {
            object.remove(field);
        }
    }
    Ok(())
}
fn preview(text: &str) -> String {
    let mut end = text.len().min(192);
    while !text.is_char_boundary(end) {
        end -= 1
    }
    text[..end].to_owned()
}
fn session_preview(session: &Value) -> Result<String, TeaError> {
    let roles = session["roles"].as_array().ok_or(TeaError::Invalid)?;
    let title = string(session, "title")?;
    encoded(
        &json!({"title":preview(title),"titleTruncated":title.len()>192,"roleNames":roles.iter().take(8).map(|r|preview(r["name"].as_str().unwrap_or_default())).collect::<Vec<_>>(),"roleCount":roles.len(),"scenarioTitle":session.get("scenario").and_then(|s|s.get("title")).and_then(Value::as_str).map(preview)}),
    )
}
fn next(value: i64) -> Result<i64, TeaError> {
    value
        .checked_add(1)
        .filter(|v| valid_revision(*v))
        .ok_or(TeaError::TooLarge)
}
#[cfg(test)]
thread_local! { static FAIL_NEXT_NONCE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
fn nonce() -> Result<String, TeaError> {
    #[cfg(test)]
    if FAIL_NEXT_NONCE.with(|fail| fail.replace(false)) {
        return Err(TeaError::Io);
    }
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| TeaError::Io)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn catalog(c: &Connection) -> Result<i64, TeaError> {
    let v = c.query_row(
        "SELECT revision FROM magic_tea_catalog WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    if valid_revision(v) {
        Ok(v)
    } else {
        Err(TeaError::Corrupt)
    }
}
fn bump_catalog(c: &Connection) -> Result<(), TeaError> {
    c.execute(
        "UPDATE magic_tea_catalog SET revision=?1 WHERE singleton=1",
        [next(catalog(c)?)?],
    )?;
    Ok(())
}
fn check_catalog(c: &Connection, expected: Option<i64>) -> Result<i64, TeaError> {
    let current = catalog(c)?;
    if let Some(expected) = expected {
        if !valid_revision(expected) {
            return Err(TeaError::Invalid);
        }
        if current != expected {
            return Err(TeaError::Stale);
        }
    }
    Ok(current)
}
fn response(result: Value, limit: usize) -> Result<Value, TeaError> {
    let response = json!({"version":1,"result":result});
    json_boundary_depth(&response, limit, ENVELOPE_NODES, 68)?;
    Ok(response)
}

#[derive(Debug)]
struct SessionRow {
    id: String,
    instance: String,
    revision: i64,
    document: Value,
    active_begin: Option<String>,
    active_message: Option<String>,
}
fn read_document(text: String, bytes: i64, hash: String) -> Result<Value, TeaError> {
    if bytes < 0 || text.len() != bytes as usize || digest(&text) != hash {
        return Err(TeaError::Corrupt);
    }
    serde_json::from_str(&text).map_err(|_| TeaError::Corrupt)
}
fn load_session(c: &Connection, id: &str) -> Result<Option<SessionRow>, TeaError> {
    let row=c.query_row("SELECT instance,revision,document,document_bytes,document_digest,active_begin,active_message FROM magic_tea_session WHERE id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?))).optional()?;
    row.map(
        |(instance, revision, text, bytes, hash, active_begin, active_message)| {
            Ok(SessionRow {
                id: id.to_owned(),
                instance,
                revision,
                document: read_document(text, bytes, hash)?,
                active_begin,
                active_message,
            })
        },
    )
    .transpose()
}
fn target(
    c: &Connection,
    id_value: &str,
    instance_value: &str,
    revision: i64,
) -> Result<SessionRow, TeaError> {
    if !id(id_value) || !instance(instance_value) || !valid_revision(revision) {
        return Err(TeaError::Invalid);
    }
    let row = load_session(c, id_value)?.ok_or(TeaError::Missing)?;
    if row.instance != instance_value || row.revision != revision {
        return Err(TeaError::Stale);
    }
    Ok(row)
}
fn saved(row: &SessionRow, action: &str) -> Value {
    json!({"action":action,"sessionId":row.id,"instance":row.instance,"revision":row.revision})
}
fn insert_session(c: &Connection, document: &Value) -> Result<SessionRow, TeaError> {
    let text = validate_session(document)?;
    let sid = checked_id(document, "id")?;
    let inst = nonce()?;
    if load_session(c, sid)?.is_some() {
        return Err(TeaError::Stale);
    }
    c.execute("INSERT INTO magic_tea_session(id,instance,revision,document,document_bytes,document_digest,preview,created_at,updated_at) VALUES(?1,?2,1,?3,?4,?5,?6,?7,?8)",params![sid,inst,text,text.len() as i64,digest(&text),session_preview(document)?,integer(document,"createdAt")?,integer(document,"updatedAt")?])?;
    Ok(SessionRow {
        id: sid.to_owned(),
        instance: inst,
        revision: 1,
        document: document.clone(),
        active_begin: None,
        active_message: None,
    })
}
fn update_session(c: &Connection, row: &mut SessionRow, document: &Value) -> Result<(), TeaError> {
    let text = validate_session(document)?;
    if checked_id(document, "id")? != row.id
        || integer(document, "createdAt")? != integer(&row.document, "createdAt")?
        || integer(document, "updatedAt")? < integer(&row.document, "updatedAt")?
    {
        return Err(TeaError::Invalid);
    }
    row.revision = next(row.revision)?;
    c.execute("UPDATE magic_tea_session SET revision=?1,document=?2,document_bytes=?3,document_digest=?4,preview=?5,updated_at=?6 WHERE id=?7",params![row.revision,text,text.len() as i64,digest(&text),session_preview(document)?,integer(document,"updatedAt")?,row.id])?;
    row.document = document.clone();
    Ok(())
}
fn insert_message(
    c: &Connection,
    session_id: &str,
    ordinal: i64,
    document: &Value,
) -> Result<(), TeaError> {
    let text = validate_message(document, session_id)?;
    c.execute("INSERT INTO magic_tea_message(id,session_id,ordinal,document,document_bytes,document_digest) VALUES(?1,?2,?3,?4,?5,?6)",params![checked_id(document,"id")?,session_id,ordinal,text,text.len() as i64,digest(&text)])?;
    Ok(())
}
fn target_value(row: &SessionRow) -> Value {
    json!({"sessionId":row.id,"instance":row.instance,"expectedRevision":row.revision})
}
struct MergeAnchors {
    anchor: Value,
    edited: Value,
    parent_ordinal: i64,
    source_ordinal: i64,
}
fn merge_anchors(
    c: &Connection,
    source: &SessionRow,
    parent: &SessionRow,
    anchor_id: &str,
    edited_id: Option<&str>,
) -> Result<MergeAnchors, TeaError> {
    if source.id == parent.id
        || source.document["forkedFrom"]["sessionId"].as_str() != Some(&parent.id)
        || source.document["forkedFrom"]["messageId"].as_str() != Some(anchor_id)
    {
        return Err(TeaError::Invalid);
    }
    if source.active_begin.is_some() || parent.active_begin.is_some() {
        return Err(TeaError::Busy);
    }
    let anchor: Option<(i64, String, i64, String)> = c.query_row(
        "SELECT ordinal,document,document_bytes,document_digest FROM magic_tea_message WHERE session_id=?1 AND id=?2",
        params![parent.id, anchor_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let (parent_ordinal, text, bytes, hash) = anchor.ok_or(TeaError::Missing)?;
    let anchor = read_document(text, bytes, hash)?;
    validate_message(&anchor, &parent.id)?;
    if anchor["role"] != "user" {
        return Err(TeaError::Invalid);
    }
    let count: i64 = c.query_row(
        "SELECT COUNT(*) FROM magic_tea_message WHERE session_id=?1 AND json_extract(document,'$.role')='user' AND json_extract(document,'$.revisionOf')=?2",
        params![source.id, anchor_id], |r| r.get(0))?;
    if count != 1 {
        return Err(TeaError::Invalid);
    }
    let (source_ordinal, text, bytes, hash): (i64, String, i64, String) = c.query_row(
        "SELECT ordinal,document,document_bytes,document_digest FROM magic_tea_message WHERE session_id=?1 AND json_extract(document,'$.role')='user' AND json_extract(document,'$.revisionOf')=?2",
        params![source.id, anchor_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    let edited = read_document(text, bytes, hash)?;
    validate_message(&edited, &source.id)?;
    if edited_id.is_some_and(|id| edited["id"].as_str() != Some(id)) {
        return Err(TeaError::Stale);
    }
    if anchor["meta"]["superseded"] == true || edited["meta"]["superseded"] == true {
        return Err(TeaError::Stale);
    }
    Ok(MergeAnchors {
        anchor,
        edited,
        parent_ordinal,
        source_ordinal,
    })
}
// SQL admission bounds allocations before materializing complete tails. Actual mutated
// documents are checked again after markers and fresh identifiers have been added.
fn merge_admission(
    c: &Connection,
    source: &SessionRow,
    parent: &SessionRow,
    anchors: &MergeAnchors,
) -> Result<(i64, i64, i64), TeaError> {
    let tail = |sid: &str, ordinal| -> Result<(i64, i64), TeaError> {
        Ok(c.query_row("SELECT COUNT(*),COALESCE(SUM(document_bytes),0) FROM magic_tea_message WHERE session_id=?1 AND ordinal>=?2",
            params![sid, ordinal], |r| Ok((r.get(0)?,r.get(1)?)))?)
    };
    let (copied, source_bytes) = tail(&source.id, anchors.source_ordinal)?;
    let (replaced, parent_bytes) = tail(&parent.id, anchors.parent_ordinal)?;
    if copied + replaced > 10_000 || source_bytes + parent_bytes > WRITE_BYTES as i64 {
        return Err(TeaError::TooLarge);
    }
    let ordinal: i64 = c.query_row(
        "SELECT COALESCE(MAX(ordinal),0) FROM magic_tea_message WHERE session_id=?1",
        [&parent.id],
        |r| r.get(0),
    )?;
    if ordinal
        .checked_add(copied)
        .is_none_or(|last| last > MAX_SAFE)
    {
        return Err(TeaError::TooLarge);
    }
    Ok((ordinal, copied, replaced))
}
fn merge(
    c: &Connection,
    operation_id: &str,
    source_target: &SessionTarget,
    parent_target: &SessionTarget,
    anchor_id: &str,
    edited_id: &str,
) -> Result<Value, TeaError> {
    let source = target(
        c,
        &source_target.session_id,
        &source_target.instance,
        source_target.expected_revision,
    )?;
    let mut parent = target(
        c,
        &parent_target.session_id,
        &parent_target.instance,
        parent_target.expected_revision,
    )?;
    // This check intentionally runs under BEGIN IMMEDIATE, never trusting a preview.
    let anchors = merge_anchors(c, &source, &parent, anchor_id, Some(edited_id))?;
    let (last_ordinal, _, _) = merge_admission(c, &source, &parent, &anchors)?;
    let now = i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| TeaError::Io)?
            .as_millis(),
    )
    .map_err(|_| TeaError::TooLarge)?;
    let mut document = parent.document.clone();
    branch_summary(c, &mut document, &parent.id, anchors.parent_ordinal, None)?;
    let object = document.as_object_mut().ok_or(TeaError::Corrupt)?;
    object.remove("lastChoices");
    object.remove("autoSummaryState");
    document["updatedAt"] = json!(now.max(integer(&parent.document, "updatedAt")?));
    let mut bytes = validate_session(&document)?.len();
    let mut changed = Vec::new();
    let mut copied = Vec::new();
    let mut ids = HashMap::new();
    let mut query = c.prepare("SELECT document,document_bytes,document_digest FROM magic_tea_message WHERE session_id=?1 AND ordinal>=?2 ORDER BY ordinal,id")?;
    {
        let mut rows = query.query(params![parent.id, anchors.parent_ordinal])?;
        while let Some(row) = rows.next()? {
            let mut message = read_document(row.get(0)?, row.get(1)?, row.get(2)?)?;
            validate_message(&message, &parent.id)?;
            if message["status"] == "streaming" {
                return Err(TeaError::Corrupt);
            }
            // Retain attribution on already superseded history, including nested merges.
            if message["meta"]["superseded"] == true {
                continue;
            }
            if message.get("meta").is_none() {
                message["meta"] = json!({});
            }
            message["meta"]["superseded"] = json!(true);
            message["meta"]["supersededAt"] = json!(now);
            message["meta"]["supersededBy"] = json!("merge");
            message["meta"]["supersededBySessionId"] = json!(source.id);
            let text = validate_message(&message, &parent.id)?;
            bytes = bytes.checked_add(text.len()).ok_or(TeaError::TooLarge)?;
            if bytes > WRITE_BYTES {
                return Err(TeaError::TooLarge);
            }
            changed.push((checked_id(&message, "id")?.to_owned(), text));
        }
    }
    {
        let mut rows = query.query(params![source.id, anchors.source_ordinal])?;
        while let Some(row) = rows.next()? {
            let mut message = read_document(row.get(0)?, row.get(1)?, row.get(2)?)?;
            validate_message(&message, &source.id)?;
            if message["status"] == "streaming" {
                return Err(TeaError::Corrupt);
            }
            let new_id = nonce()?;
            ids.insert(checked_id(&message, "id")?.to_owned(), new_id.clone());
            message["id"] = json!(new_id);
            message["sessionId"] = json!(parent.id);
            copied.push(message);
        }
    }
    for message in &mut copied {
        for field in ["sourceMessageId", "revisionOf"] {
            if let Some(old_id) = message.get(field).and_then(Value::as_str) {
                if let Some(new_id) = ids.get(old_id) {
                    message[field] = json!(new_id);
                } else {
                    let exists: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM magic_tea_message WHERE session_id=?1 AND id=?2)", params![parent.id, old_id], |r| r.get(0))?;
                    if !exists {
                        message
                            .as_object_mut()
                            .ok_or(TeaError::Corrupt)?
                            .remove(field);
                    }
                }
            }
        }
        bytes = bytes
            .checked_add(validate_message(message, &parent.id)?.len())
            .ok_or(TeaError::TooLarge)?;
        if bytes > WRITE_BYTES {
            return Err(TeaError::TooLarge);
        }
    }
    // Include the JSON envelope overhead and aggregate node/depth limits, not just
    // original stored byte counts. Everything above remains read-only on rejection.
    let changed_values = changed
        .iter()
        .map(|(_, text)| serde_json::from_str::<Value>(text).map_err(|_| TeaError::Corrupt))
        .collect::<Result<Vec<_>, _>>()?;
    json_boundary(
        &json!({"session":&document,"replaced":changed_values,"copied":&copied}),
        WRITE_BYTES,
        ENVELOPE_NODES,
    )?;
    for (id, text) in changed {
        c.execute("UPDATE magic_tea_message SET document=?1,document_bytes=?2,document_digest=?3 WHERE session_id=?4 AND id=?5", params![text,text.len() as i64,digest(&text),parent.id,id])?;
    }
    for (index, message) in copied.iter().enumerate() {
        insert_message(c, &parent.id, last_ordinal + index as i64 + 1, message)?;
    }
    update_session(c, &mut parent, &document)?;
    let mut result = saved(&parent, "merge");
    result["operationId"] = json!(operation_id);
    result["source"] =
        json!({"sessionId":source.id,"instance":source.instance,"revision":source.revision});
    // The outer transaction persists the receipt with these changes. Receipts have
    // no foreign key/GC: this permanent marker must outlive both source and parent.
    Ok(result)
}

fn load_receipt(c: &Connection, operation_id: &str) -> Result<Option<Value>, TeaError> {
    let row = c
        .query_row(
            "SELECT request_digest,result FROM magic_tea_receipt WHERE operation_id=?1",
            [operation_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;
    row.map(|(hash, text)| {
        let result: Value = serde_json::from_str(&text).map_err(|_| TeaError::Corrupt)?;
        validate_result(&result)?;
        if result["operationId"] != operation_id {
            return Err(TeaError::Corrupt);
        }
        Ok(json!({"operationId":operation_id,"digest":hash,"result":result}))
    })
    .transpose()
}
fn rollback(c: &Connection) -> Result<(), TeaError> {
    if !c.is_autocommit() {
        c.execute_batch("ROLLBACK")
            .map_err(|_| TeaError::CommitUnknown)?;
    }
    if c.is_autocommit() {
        Ok(())
    } else {
        Err(TeaError::CommitUnknown)
    }
}
fn transaction<T>(
    c: &Connection,
    write: bool,
    run: impl FnOnce() -> Result<T, TeaError>,
) -> Result<T, TeaError> {
    c.execute_batch(if write { "BEGIN IMMEDIATE" } else { "BEGIN" })?;
    let value = match run() {
        Ok(value) => value,
        Err(error) => {
            rollback(c)?;
            return Err(error);
        }
    };
    if c.execute_batch("COMMIT").is_err() {
        rollback(c)?;
        return Err(TeaError::CommitUnknown);
    }
    Ok(value)
}

pub struct TeaStore {
    connection: SharedConnection,
    gate: Arc<MaintenanceGate>,
}
impl TeaStore {
    pub fn open(
        connection: SharedConnection,
        gate: Arc<MaintenanceGate>,
    ) -> Result<Self, TeaError> {
        let store = Self { connection, gate };
        store.recover()?;
        Ok(store)
    }
    pub fn read(&self, raw: Value) -> Result<Value, TeaError> {
        let receipt = raw["request"]["action"] == "receipt";
        json_boundary_depth(
            &json!({"request":&raw}),
            if receipt { RECEIPT_READ_BYTES } else { 4096 },
            if receipt { ENVELOPE_NODES + 8 } else { 100 },
            if receipt { 68 } else { 64 },
        )?;
        let input: ReadRequest = serde_json::from_value(raw).map_err(|_| TeaError::Invalid)?;
        if input.version != 1 {
            return Err(TeaError::Invalid);
        }
        let c = lock_connection(&self.connection).map_err(from_store)?;
        transaction(&c, false, || self.read_locked(&c, input.request))
    }
    pub fn mutate(&self, raw: Value) -> Result<Value, TeaError> {
        json_boundary(&json!({"request":&raw}), WRITE_BYTES, ENVELOPE_NODES)?;
        let input: WriteRequest = serde_json::from_value(raw).map_err(|_| TeaError::Invalid)?;
        if input.version != 1 {
            return Err(TeaError::Invalid);
        }
        validate_write(&input.request)?;
        let normalized = serde_json::to_value(&input).map_err(|_| TeaError::Invalid)?;
        let hash = digest(&json_boundary(&normalized, WRITE_BYTES, ENVELOPE_NODES)?);
        let _permit = self.gate.enter_write().map_err(|_| TeaError::Maintenance)?;
        let c = lock_connection(&self.connection).map_err(from_store)?;
        transaction(&c, true, || self.write_locked(&c, input.request, &hash))
    }
    fn read_locked(&self, c: &Connection, operation: ReadOperation) -> Result<Value, TeaError> {
        match operation {
            ReadOperation::MergePreview { source } => {
                let source = target(
                    c,
                    &source.session_id,
                    &source.instance,
                    source.expected_revision,
                )?;
                let parent_id = source.document["forkedFrom"]["sessionId"]
                    .as_str()
                    .ok_or(TeaError::Invalid)?;
                let anchor_id = source.document["forkedFrom"]["messageId"]
                    .as_str()
                    .ok_or(TeaError::Invalid)?;
                if !id(parent_id) || !id(anchor_id) || parent_id == source.id {
                    return Err(TeaError::Invalid);
                }
                let parent = load_session(c, parent_id)?.ok_or(TeaError::Missing)?;
                let anchors = merge_anchors(c, &source, &parent, anchor_id, None)?;
                let (_, copied, replaced) = merge_admission(c, &source, &parent, &anchors)?;
                response(
                    json!({"action":"merge-preview", "source":target_value(&source), "parent":target_value(&parent),
                    "anchorMessageId":anchor_id, "editedMessageId":anchors.edited["id"],
                    "sourceTitle":preview(source.document["title"].as_str().unwrap_or("")),
                    "parentTitle":preview(parent.document["title"].as_str().unwrap_or("")),
                    "anchorPreview":preview(anchors.anchor["content"].as_str().unwrap_or("")),
                    "editedPreview":preview(anchors.edited["content"].as_str().unwrap_or("")),
                    "replacedMessageCount":replaced, "copiedMessageCount":copied}),
                    DIRECTORY_BYTES,
                )
            }
            ReadOperation::Receipt { write } => {
                if write.version != 1 {
                    return Err(TeaError::Invalid);
                }
                validate_write(&write.request)?;
                let operation_id = match &write.request {
                    WriteOperation::Merge { operation_id, .. }
                    | WriteOperation::Fork { operation_id, .. }
                    | WriteOperation::Import { operation_id, .. }
                    | WriteOperation::SetPin { operation_id, .. }
                    | WriteOperation::DeleteSelected { operation_id, .. }
                    | WriteOperation::BeginGeneration { operation_id, .. }
                    | WriteOperation::FinishGeneration { operation_id, .. } => operation_id,
                    _ => return Err(TeaError::Invalid),
                };
                if !id(operation_id) {
                    return Err(TeaError::Invalid);
                }
                let expected = serde_json::to_value(&write).map_err(|_| TeaError::Invalid)?;
                let hash = digest(&json_boundary(&expected, WRITE_BYTES, ENVELOPE_NODES)?);
                let receipt = load_receipt(c, operation_id)?;
                if let Some(receipt) = &receipt {
                    if receipt["digest"] != hash {
                        return Err(TeaError::OperationMismatch);
                    }
                }
                response(
                    json!({"action":"receipt","receipt":receipt}),
                    DIRECTORY_BYTES,
                )
            }
            ReadOperation::Session {
                session_id,
                expected_catalog_revision,
            } => {
                if !id(&session_id) {
                    return Err(TeaError::Invalid);
                }
                let catalog = check_catalog(c, expected_catalog_revision)?;
                let record = load_session(c, &session_id)?.map(
                    |r| json!({"instance":r.instance,"revision":r.revision,"session":r.document}),
                );
                response(
                    json!({"action":"session","catalogRevision":catalog,"record":record}),
                    PAGE_BYTES,
                )
            }
            ReadOperation::List {
                cursor,
                expected_catalog_revision,
                limit,
            } => {
                if !(1..=50).contains(&limit) {
                    return Err(TeaError::Invalid);
                }
                let current = check_catalog(c, expected_catalog_revision)?;
                if let Some(cursor) = &cursor {
                    if !id(&cursor.id)
                        || !(0..=MAX_SAFE).contains(&cursor.updated_at)
                        || !(0..=MAX_SAFE).contains(&cursor.pinned_at)
                        || !(0..=MAX_SAFE).contains(&cursor.pinned_order)
                        || (cursor.pinned_at == 0 && cursor.pinned_order != 0)
                    {
                        return Err(TeaError::Invalid);
                    }
                    if cursor.catalog_revision != current {
                        return Err(TeaError::Stale);
                    }
                }
                let (pin, order, at, sid) = cursor
                    .as_ref()
                    .map(|v| (v.pinned_at, v.pinned_order, v.updated_at, v.id.as_str()))
                    .unwrap_or((0, 0, 0, ""));
                // Only small projections leave SQLite. LIMIT bounds output, not document parsing cost.
                let sql = directory_sql();
                let mut query = c.prepare(&sql)?;
                let mut data = query.query(params![
                    cursor.is_some(),
                    pin,
                    order,
                    at,
                    sid,
                    limit as i64 + 1
                ])?;
                let mut rows = Vec::new();
                let mut more = false;
                while let Some(row) = data.next()? {
                    if rows.len() == limit {
                        more = true;
                        break;
                    }
                    let mut head: Value = serde_json::from_str(&row.get::<_, String>(3)?)
                        .map_err(|_| TeaError::Corrupt)?;
                    let head = head.as_object_mut().ok_or(TeaError::Corrupt)?;
                    head.insert("id".into(), json!(row.get::<_, String>(0)?));
                    head.insert("instance".into(), json!(row.get::<_, String>(1)?));
                    head.insert("revision".into(), json!(row.get::<_, i64>(2)?));
                    head.insert("createdAt".into(), json!(row.get::<_, i64>(4)?));
                    head.insert("updatedAt".into(), json!(row.get::<_, i64>(5)?));
                    head.insert("messageCount".into(), json!(row.get::<_, i64>(6)?));
                    head.insert("pinnedAt".into(), json!(row.get::<_, i64>(7)?));
                    head.insert("pinnedOrder".into(), json!(row.get::<_, i64>(8)?));
                    rows.push(Value::Object(head.clone()));
                    let proposed = json!({"action":"list","catalogRevision":current,"rows":rows,"nextCursor":{"catalogRevision":current,"pinnedAt":head["pinnedAt"],"pinnedOrder":head["pinnedOrder"],"updatedAt":head["updatedAt"],"id":head["id"]}});
                    if let Err(error) = response(proposed, DIRECTORY_BYTES) {
                        rows.pop();
                        if rows.is_empty() {
                            return Err(error);
                        }
                        more = true;
                        break;
                    }
                }
                let next_cursor = if more {
                    rows.last().map(|r|json!({"catalogRevision":current,"pinnedAt":r["pinnedAt"],"pinnedOrder":r["pinnedOrder"],"updatedAt":r["updatedAt"],"id":r["id"]}))
                } else {
                    None
                };
                response(
                    json!({"action":"list","catalogRevision":current,"rows":rows,"nextCursor":next_cursor}),
                    DIRECTORY_BYTES,
                )
            }
            ReadOperation::Messages {
                session_id,
                instance,
                expected_revision,
                cursor,
                expected_catalog_revision,
                limit,
            } => {
                if !(1..=100).contains(&limit) {
                    return Err(TeaError::Invalid);
                }
                let current = check_catalog(c, expected_catalog_revision)?;
                target(c, &session_id, &instance, expected_revision)?;
                if let Some(cursor) = &cursor {
                    if !id(&cursor.id) || !valid_revision(cursor.ordinal) {
                        return Err(TeaError::Invalid);
                    }
                    let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM magic_tea_message WHERE session_id=?1 AND ordinal=?2 AND id=?3)",params![session_id,cursor.ordinal,cursor.id],|r|r.get(0))?;
                    if !exists {
                        return Err(TeaError::Invalid);
                    }
                }
                let after = cursor.as_ref().map(|v| v.ordinal).unwrap_or(0);
                let mut query=c.prepare("SELECT id,ordinal,document,document_bytes,document_digest FROM magic_tea_message WHERE session_id=?1 AND ordinal>?2 ORDER BY ordinal,id LIMIT ?3")?;
                let mut data = query.query(params![session_id, after, limit as i64 + 1])?;
                let mut rows = Vec::new();
                let mut more = false;
                while let Some(row) = data.next()? {
                    if rows.len() == limit {
                        more = true;
                        break;
                    }
                    let mid: String = row.get(0)?;
                    let ordinal: i64 = row.get(1)?;
                    let document = read_document(row.get(2)?, row.get(3)?, row.get(4)?)?;
                    let entry = json!({"ordinal":ordinal,"message":document});
                    rows.push(entry);
                    // Reserve the actual longest next cursor of this page, not an estimate of document bytes.
                    let proposed = json!({"action":"messages","catalogRevision":current,"sessionId":session_id,"instance":instance,"revision":expected_revision,"rows":rows,"nextCursor":{"ordinal":ordinal,"id":mid}});
                    if let Err(error) = response(proposed, PAGE_BYTES) {
                        rows.pop();
                        if rows.is_empty() {
                            return Err(error);
                        }
                        more = true;
                        break;
                    }
                }
                let next_cursor = if more {
                    rows.last()
                        .map(|r| json!({"ordinal":r["ordinal"],"id":r["message"]["id"]}))
                } else {
                    None
                };
                response(
                    json!({"action":"messages","catalogRevision":current,"sessionId":session_id,"instance":instance,"revision":expected_revision,"rows":rows,"nextCursor":next_cursor}),
                    PAGE_BYTES,
                )
            }
        }
    }
    fn write_locked(
        &self,
        c: &Connection,
        operation: WriteOperation,
        hash: &str,
    ) -> Result<Value, TeaError> {
        let receipt_id = match &operation {
            WriteOperation::Merge { operation_id, .. }
            | WriteOperation::Fork { operation_id, .. }
            | WriteOperation::Import { operation_id, .. }
            | WriteOperation::SetPin { operation_id, .. }
            | WriteOperation::DeleteSelected { operation_id, .. }
            | WriteOperation::BeginGeneration { operation_id, .. }
            | WriteOperation::FinishGeneration { operation_id, .. } => Some(operation_id.clone()),
            _ => None,
        };
        if let Some(operation_id) = &receipt_id {
            if !id(operation_id) {
                return Err(TeaError::Invalid);
            }
            if let Some(receipt) = load_receipt(c, operation_id)? {
                if receipt["digest"].as_str() != Some(hash) {
                    return Err(TeaError::OperationMismatch);
                }
                return response(receipt["result"].clone(), DIRECTORY_BYTES);
            }
        }
        let result = match operation {
            WriteOperation::Create { session } => saved(&insert_session(c, &session)?, "create"),
            WriteOperation::Update {
                session_id,
                instance,
                expected_revision,
                session,
            } => {
                let mut row = target(c, &session_id, &instance, expected_revision)?;
                if row.active_begin.is_some() {
                    return Err(TeaError::Busy);
                }
                update_session(c, &mut row, &session)?;
                saved(&row, "update")
            }
            WriteOperation::Delete {
                session_id,
                instance,
                expected_revision,
            } => {
                let row = target(c, &session_id, &instance, expected_revision)?;
                if row.active_begin.is_some() {
                    return Err(TeaError::Busy);
                }
                c.execute("DELETE FROM magic_tea_session WHERE id=?1", [&session_id])?;
                saved(&row, "delete")
            }
            WriteOperation::SetPin {
                session_id,
                instance,
                expected_revision,
                operation_id,
                pinned,
            } => {
                let mut row = target(c, &session_id, &instance, expected_revision)?;
                if row.active_begin.is_some() {
                    return Err(TeaError::Busy);
                }
                let mut document = row.document.clone();
                let object = document.as_object_mut().ok_or(TeaError::Corrupt)?;
                let (at, order) = if pinned {
                    let at = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|_| TeaError::Io)?
                        .as_millis();
                    let at = i64::try_from(at).map_err(|_| TeaError::Invalid)?;
                    if !valid_revision(at) {
                        return Err(TeaError::Invalid);
                    }
                    let sql = format!("SELECT COALESCE(MAX(CASE WHEN ({PIN_AT_SQL})>0 THEN ({PIN_ORDER_SQL}) ELSE 0 END),0) FROM magic_tea_session");
                    let max: i64 = c.query_row(&sql, [], |r| r.get(0))?;
                    (at, next(max)?)
                } else {
                    (0, 0)
                };
                if pinned {
                    object.insert("pinnedAt".into(), json!(at));
                    object.insert("pinnedOrder".into(), json!(order));
                } else {
                    object.remove("pinnedAt");
                    object.remove("pinnedOrder");
                }
                update_session(c, &mut row, &document)?;
                let mut result = saved(&row, "set-pin");
                result["operationId"] = json!(operation_id);
                result["pinnedAt"] = json!(at);
                result["pinnedOrder"] = json!(order);
                result
            }
            WriteOperation::DeleteSelected {
                operation_id,
                targets,
            } => {
                // All identities, revisions and busy/protection checks precede every delete.
                let mut sessions = Vec::new();
                for item in &targets {
                    let row = target(c, &item.session_id, &item.instance, item.expected_revision)?;
                    if row.active_begin.is_some() {
                        return Err(TeaError::Busy);
                    }
                    if valid_pin(&row.document, "pinnedAt") > 0 {
                        return Err(TeaError::Invalid);
                    }
                    sessions.push(
                        json!({"sessionId":row.id,"instance":row.instance,"revision":row.revision}),
                    );
                }
                for item in &targets {
                    c.execute(
                        "DELETE FROM magic_tea_session WHERE id=?1",
                        [&item.session_id],
                    )?;
                }
                json!({"action":"delete-selected","operationId":operation_id,"sessions":sessions})
            }
            WriteOperation::Import {
                operation_id,
                entries,
            } => {
                if entries.is_empty()
                    || entries.len() > 128
                    || entries.iter().map(|e| e.messages.len()).sum::<usize>() > 10_000
                {
                    return Err(TeaError::TooLarge);
                }
                let mut session_ids = HashSet::new();
                let mut message_ids = HashSet::new();
                // Validate the whole batch before the first insert. The transaction also protects races and failures.
                for entry in &entries {
                    validate_session(&entry.session)?;
                    let sid = checked_id(&entry.session, "id")?;
                    if !session_ids.insert(sid.to_owned()) {
                        return Err(TeaError::Invalid);
                    }
                    for message in &entry.messages {
                        validate_message(message, sid)?;
                        if message["status"] == "streaming"
                            || !message_ids.insert(checked_id(message, "id")?.to_owned())
                        {
                            return Err(TeaError::Invalid);
                        }
                    }
                }
                let mut sessions = Vec::new();
                for entry in entries {
                    let row = insert_session(c, &entry.session)?;
                    for (index, message) in entry.messages.iter().enumerate() {
                        insert_message(c, &row.id, index as i64 + 1, message)?;
                    }
                    sessions.push(
                        json!({"sessionId":row.id,"instance":row.instance,"revision":row.revision}),
                    );
                }
                json!({"action":"import","operationId":operation_id,"sessions":sessions})
            }
            WriteOperation::Fork {
                operation_id,
                session_id,
                instance,
                expected_revision,
                anchor_message_id,
                edited_content,
                target_session_id,
            } => {
                let source = target(c, &session_id, &instance, expected_revision)?;
                if source.active_begin.is_some() {
                    return Err(TeaError::Busy);
                }
                if load_session(c, &target_session_id)?.is_some() {
                    return Err(TeaError::Stale);
                }
                let anchor: Option<(i64, String, i64, String)> = c.query_row(
                    "SELECT ordinal,document,document_bytes,document_digest FROM magic_tea_message WHERE session_id=?1 AND id=?2",
                    params![session_id, anchor_message_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
                let (ordinal, text, bytes, hash) = anchor.ok_or(TeaError::Missing)?;
                let anchor = read_document(text, bytes, hash)?;
                validate_message(&anchor, &session_id)?;
                if anchor["role"] != "user" {
                    return Err(TeaError::Invalid);
                }
                let (count, bytes): (i64, i64) = c.query_row(
                    "SELECT COUNT(*),COALESCE(SUM(document_bytes),0) FROM magic_tea_message WHERE session_id=?1 AND ordinal<?2",
                    params![session_id, ordinal], |r| Ok((r.get(0)?,r.get(1)?)))?;
                // Reject oversized prefixes before loading them, then apply the exact import envelope budget.
                if count >= 10_000 || bytes > WRITE_BYTES as i64 {
                    return Err(TeaError::TooLarge);
                }
                let mut query = c.prepare("SELECT document,document_bytes,document_digest FROM magic_tea_message WHERE session_id=?1 AND ordinal<?2 ORDER BY ordinal,id")?;
                let mut rows = query.query(params![session_id, ordinal])?;
                let mut messages = Vec::new();
                let mut ids = HashMap::new();
                let mut rounds = 1;
                while let Some(row) = rows.next()? {
                    let mut message = read_document(row.get(0)?, row.get(1)?, row.get(2)?)?;
                    validate_message(&message, &session_id)?;
                    if message["status"] == "streaming" {
                        return Err(TeaError::Corrupt);
                    }
                    if message["role"] == "user" {
                        rounds += 1;
                    }
                    let new_id = nonce()?;
                    ids.insert(checked_id(&message, "id")?.to_owned(), new_id.clone());
                    message["id"] = json!(new_id);
                    message["sessionId"] = json!(target_session_id);
                    messages.push(message);
                }
                for message in &mut messages {
                    for field in ["sourceMessageId", "revisionOf"] {
                        if let Some(replacement) =
                            message[field].as_str().and_then(|id| ids.get(id))
                        {
                            message[field] = json!(replacement);
                        }
                    }
                }
                let now = i64::try_from(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|_| TeaError::Io)?
                        .as_millis(),
                )
                .map_err(|_| TeaError::TooLarge)?;
                let mut document = source.document.clone();
                fork_summary(c, &mut document, &session_id, ordinal, &ids)?;
                document["id"] = json!(target_session_id);
                document["createdAt"] = json!(now);
                document["updatedAt"] = json!(now);
                document["forkedFrom"] =
                    json!({"sessionId":session_id,"messageId":anchor_message_id,"createdAt":now});
                document["branchLabel"] = json!(format!("从第 {rounds} 轮分支"));
                document["settings"]["autoSummaryEnabled"] = json!(false);
                document
                    .as_object_mut()
                    .ok_or(TeaError::Corrupt)?
                    .remove("autoSummaryState");
                let display = branch_trim(
                    document["settings"]["userDisplayName"]
                        .as_str()
                        .unwrap_or(""),
                );
                let display = if display.is_empty() {
                    "旅人"
                } else {
                    display
                };
                let mut units = 0;
                let display: String = display
                    .chars()
                    .take_while(|c| {
                        units += c.len_utf16();
                        units <= 20
                    })
                    .collect();
                let player = document["roles"]
                    .as_array()
                    .ok_or(TeaError::Corrupt)?
                    .iter()
                    .find(|r| {
                        document["playerRoleId"].is_string() && r["id"] == document["playerRoleId"]
                    });
                let (player_id, speaker) = match player {
                    Some(role) => {
                        let id = string(role, "id")?.to_owned();
                        let name = branch_trim(string(role, "name")?);
                        (
                            Some(id.clone()),
                            if name.is_empty() { id } else { name.to_owned() },
                        )
                    }
                    None => (None, display.clone()),
                };
                document["playerRoleId"] = json!(player_id);
                document["settings"]["userDisplayName"] = json!(display);
                let mut edited = json!({"id":nonce()?,"sessionId":target_session_id,"role":"user",
                    "content":branch_trim(&edited_content),"createdAt":next(now)?,"status":"done",
                    "meta":{"speakerName":speaker},"revisionOf":anchor_message_id});
                if let Some(id) = player_id {
                    edited["speakerId"] = json!(id);
                }
                messages.push(edited);
                let import = WriteOperation::Import {
                    operation_id: operation_id.clone(),
                    entries: vec![ImportEntry {
                        session: document,
                        messages,
                    }],
                };
                validate_write(&import)?;
                let wire = json!({"version":1,"request":&import});
                json_boundary(&json!({"request":wire}), WRITE_BYTES, ENVELOPE_NODES)?;
                let WriteOperation::Import { entries, .. } = import else {
                    unreachable!()
                };
                let entry = &entries[0];
                let row = insert_session(c, &entry.session)?;
                for (index, message) in entry.messages.iter().enumerate() {
                    insert_message(c, &row.id, index as i64 + 1, message)?;
                }
                let mut result = saved(&row, "fork");
                result["operationId"] = json!(operation_id);
                result
            }
            WriteOperation::Merge {
                operation_id,
                source,
                parent,
                anchor_message_id,
                edited_message_id,
            } => merge(
                c,
                &operation_id,
                &source,
                &parent,
                &anchor_message_id,
                &edited_message_id,
            )?,
            WriteOperation::BeginGeneration {
                session_id,
                instance,
                expected_revision,
                operation_id,
                session,
                user_message,
                assistant_message,
            } => {
                let mut row = target(c, &session_id, &instance, expected_revision)?;
                if row.active_begin.is_some() {
                    return Err(TeaError::Busy);
                }
                let assistant = checked_id(&assistant_message, "id")?.to_owned();
                validate_message(&assistant_message, &session_id)?;
                if !exact_keys(
                    &assistant_message,
                    &["id", "sessionId", "role", "content", "createdAt", "status"],
                ) || assistant_message["role"] != "assistant"
                    || assistant_message["status"] != "streaming"
                    || assistant_message["content"] != ""
                {
                    return Err(TeaError::Invalid);
                }
                let last: i64 = c.query_row(
                    "SELECT COALESCE(MAX(ordinal),0) FROM magic_tea_message WHERE session_id=?1",
                    [&session_id],
                    |r| r.get(0),
                )?;
                let mut ordinal = next(last)?;
                if let Some(user) = user_message {
                    if user["role"] != "user" || user["status"] == "streaming" {
                        return Err(TeaError::Invalid);
                    }
                    insert_message(c, &session_id, ordinal, &user)?;
                    ordinal = next(ordinal)?;
                }
                insert_message(c, &session_id, ordinal, &assistant_message)?;
                update_session(c, &mut row, &session)?;
                c.execute(
                    "UPDATE magic_tea_session SET active_begin=?1,active_message=?2 WHERE id=?3",
                    params![operation_id, assistant, session_id],
                )?;
                let mut result = saved(&row, "begin-generation");
                result["operationId"] = json!(operation_id);
                result["assistantMessageId"] = json!(assistant);
                result
            }
            WriteOperation::FinishGeneration {
                session_id,
                instance,
                expected_revision,
                operation_id,
                begin_operation_id,
                session,
                assistant_message,
            } => {
                if !id(&begin_operation_id) {
                    return Err(TeaError::Invalid);
                }
                let mut row = target(c, &session_id, &instance, expected_revision)?;
                let assistant = checked_id(&assistant_message, "id")?;
                if row.active_begin.as_deref() != Some(&begin_operation_id)
                    || row.active_message.as_deref() != Some(assistant)
                {
                    return Err(TeaError::Stale);
                }
                if assistant_message["role"] != "assistant"
                    || !matches!(
                        assistant_message["status"].as_str(),
                        Some("done" | "error" | "blocked")
                    )
                {
                    return Err(TeaError::Invalid);
                }
                let text = validate_message(&assistant_message, &session_id)?;
                let old: String = c.query_row(
                    "SELECT document FROM magic_tea_message WHERE session_id=?1 AND id=?2",
                    params![session_id, assistant],
                    |r| r.get(0),
                )?;
                let old: Value = serde_json::from_str(&old).map_err(|_| TeaError::Corrupt)?;
                if integer(&old, "createdAt")? != integer(&assistant_message, "createdAt")?
                    || old["status"] != "streaming"
                {
                    return Err(TeaError::Stale);
                }
                let receipt = load_receipt(c, &begin_operation_id)?.ok_or(TeaError::Corrupt)?;
                if receipt["result"]["action"] != "begin-generation"
                    || receipt["result"]["sessionId"] != session_id
                    || receipt["result"]["instance"] != instance
                    || receipt["result"]["revision"] != expected_revision
                    || receipt["result"]["assistantMessageId"] != assistant
                {
                    return Err(TeaError::Stale);
                }
                c.execute("UPDATE magic_tea_message SET document=?1,document_bytes=?2,document_digest=?3 WHERE id=?4 AND session_id=?5",params![text,text.len() as i64,digest(&text),assistant,session_id])?;
                update_session(c, &mut row, &session)?;
                c.execute("UPDATE magic_tea_session SET active_begin=NULL,active_message=NULL WHERE id=?1",[&session_id])?;
                let mut result = saved(&row, "finish-generation");
                result["operationId"] = json!(operation_id);
                result["assistantMessageId"] = json!(assistant);
                result
            }
        };
        bump_catalog(c)?;
        if let Some(operation_id) = receipt_id {
            c.execute("INSERT INTO magic_tea_receipt(operation_id,request_digest,result) VALUES(?1,?2,?3)",params![operation_id,hash,encoded(&result)?])?;
        }
        response(result, DIRECTORY_BYTES)
    }
    fn recover(&self) -> Result<(), TeaError> {
        let c = lock_connection(&self.connection).map_err(from_store)?;
        #[cfg(test)]
        if c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 11 {
            return Ok(());
        }
        transaction(&c, true, || {
            let ids = c
                .prepare("SELECT id FROM magic_tea_session WHERE active_begin IS NOT NULL")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for sid in &ids {
                let row = load_session(&c, sid)?.ok_or(TeaError::Corrupt)?;
                let assistant = row.active_message.ok_or(TeaError::Corrupt)?;
                let text: String = c.query_row(
                    "SELECT document FROM magic_tea_message WHERE session_id=?1 AND id=?2",
                    params![sid, assistant],
                    |r| r.get(0),
                )?;
                let mut message: Value =
                    serde_json::from_str(&text).map_err(|_| TeaError::Corrupt)?;
                if message["status"] != "streaming" {
                    return Err(TeaError::Corrupt);
                }
                message["status"] = json!("error");
                message["error"] = json!({"code":"tea-interrupted","message":"Generation was interrupted; no request was resumed"});
                if message.get("meta").is_none() {
                    message["meta"] = json!({});
                }
                message["meta"]["completion"] = json!("interrupted");
                let text = validate_message(&message, sid)?;
                c.execute("UPDATE magic_tea_message SET document=?1,document_bytes=?2,document_digest=?3 WHERE id=?4",params![text,text.len() as i64,digest(&text),assistant])?;
                c.execute("UPDATE magic_tea_session SET revision=?1,active_begin=NULL,active_message=NULL WHERE id=?2",params![next(row.revision)?,sid])?;
            }
            if !ids.is_empty() {
                bump_catalog(&c)?;
            }
            Ok(())
        })
    }
}

/// Validate the current connection, including effective WAL state, before any migration or recovery writes.
pub(crate) fn verify_schema(c: &Connection, version: i64) -> Result<(), StoreError> {
    let check = || -> Result<(), TeaError> {
        let actual = schema_objects(c)?;
        if version < 11 {
            if actual.is_empty() {
                return Ok(());
            }
            return Err(TeaError::Corrupt);
        }
        let expected = Connection::open_in_memory()?;
        expected.execute_batch(MIGRATION_11)?;
        if actual != schema_objects(&expected)? {
            return Err(TeaError::Corrupt);
        }
        catalog(c)?;
        if c.query_row("SELECT COUNT(*) FROM magic_tea_catalog", [], |r| {
            r.get::<_, i64>(0)
        })? != 1
        {
            return Err(TeaError::Corrupt);
        }
        let mut query=c.prepare("SELECT id,instance,revision,document,document_bytes,document_digest,preview,created_at,updated_at,active_begin,active_message FROM magic_tea_session")?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let sid: String = row.get(0)?;
            let inst: String = row.get(1)?;
            let rev: i64 = row.get(2)?;
            let document = read_document(row.get(3)?, row.get(4)?, row.get(5)?)?;
            validate_session(&document)?;
            if !instance(&inst)
                || !valid_revision(rev)
                || checked_id(&document, "id")? != sid
                || session_preview(&document)? != row.get::<_, String>(6)?
                || integer(&document, "createdAt")? != row.get::<_, i64>(7)?
                || integer(&document, "updatedAt")? != row.get::<_, i64>(8)?
            {
                return Err(TeaError::Corrupt);
            }
            let begin: Option<String> = row.get(9)?;
            let active: Option<String> = row.get(10)?;
            match (begin, active) {
                (None, None) => {}
                (Some(begin), Some(active)) => {
                    let receipt = load_receipt(c, &begin)?.ok_or(TeaError::Corrupt)?;
                    if receipt["result"]["action"] != "begin-generation"
                        || receipt["result"]["sessionId"] != sid
                        || receipt["result"]["instance"] != inst
                        || receipt["result"]["revision"] != rev
                        || receipt["result"]["assistantMessageId"] != active
                    {
                        return Err(TeaError::Corrupt);
                    }
                    let text: String = c.query_row(
                        "SELECT document FROM magic_tea_message WHERE session_id=?1 AND id=?2",
                        params![sid, active],
                        |r| r.get(0),
                    )?;
                    let message: Value =
                        serde_json::from_str(&text).map_err(|_| TeaError::Corrupt)?;
                    if message["status"] != "streaming" {
                        return Err(TeaError::Corrupt);
                    }
                }
                _ => return Err(TeaError::Corrupt),
            }
        }
        let mut query=c.prepare("SELECT id,session_id,ordinal,document,document_bytes,document_digest FROM magic_tea_message")?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let mid: String = row.get(0)?;
            let sid: String = row.get(1)?;
            let ordinal: i64 = row.get(2)?;
            let document = read_document(row.get(3)?, row.get(4)?, row.get(5)?)?;
            validate_message(&document, &sid)?;
            if checked_id(&document, "id")? != mid || !valid_revision(ordinal) {
                return Err(TeaError::Corrupt);
            }
            let active: Option<String> = c
                .query_row(
                    "SELECT active_message FROM magic_tea_session WHERE id=?1",
                    [&sid],
                    |r| r.get(0),
                )
                .optional()?
                .ok_or(TeaError::Corrupt)?;
            if (document["status"] == "streaming") != (active.as_deref() == Some(&mid)) {
                return Err(TeaError::Corrupt);
            }
        }
        let mut query =
            c.prepare("SELECT operation_id,request_digest,result FROM magic_tea_receipt")?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let oid: String = row.get(0)?;
            let hash: String = row.get(1)?;
            let text: String = row.get(2)?;
            if !id(&oid)
                || hash.len() != 64
                || !hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(TeaError::Corrupt);
            }
            let result: Value = serde_json::from_str(&text).map_err(|_| TeaError::Corrupt)?;
            json_boundary(&result, DIRECTORY_BYTES, 10_000)?;
            validate_result(&result)?;
            if result["operationId"] != oid
                || !matches!(
                    result["action"].as_str(),
                    Some(
                        "import"
                            | "fork"
                            | "merge"
                            | "begin-generation"
                            | "finish-generation"
                            | "set-pin"
                            | "delete-selected"
                    )
                )
            {
                return Err(TeaError::Corrupt);
            }
        }
        if c.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check('magic_tea_message'))",
            [],
            |r| r.get::<_, bool>(0),
        )? {
            return Err(TeaError::Corrupt);
        }
        Ok(())
    };
    check().map_err(|_| StoreError::InvalidDocument)
}
fn schema_objects(c: &Connection) -> Result<Vec<(String, String, String)>, TeaError> {
    let mut statement = c.prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE name GLOB 'magic_tea_*' ORDER BY name",
    )?;
    let rows = statement.query_map([], |row| {
        let sql: String = row.get(2)?;
        Ok((
            row.get(0)?,
            row.get(1)?,
            sql.split_whitespace().collect::<Vec<_>>().join(" "),
        ))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(TeaError::from)
}

#[cfg(test)]
#[path = "magic_tea_party_tests.rs"]
mod tests;
