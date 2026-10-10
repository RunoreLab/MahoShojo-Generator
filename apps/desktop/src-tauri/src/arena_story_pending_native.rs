//! Native-only create authority. Renderer snapshots can read claims, but neither
//! uploaded manifests nor IPC commands can mint, reset, or consume a permit.
use super::*;
use std::sync::MutexGuard;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FundingMode {
    System,
    Preset,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFunding {
    pub mode: FundingMode,
    pub provider_id: String,
    pub model_id: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_overrides"
    )]
    pub generation_overrides: Option<serde_json::Value>,
}
fn optional_overrides<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<serde_json::Value>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    if value.is_null() {
        return Err(serde::de::Error::custom(
            "generationOverrides cannot be null",
        ));
    }
    Ok(Some(value))
}
impl NativeFunding {
    pub(crate) fn validate(&self) -> Result<(), StoryError> {
        // This is a persisted, already-normalized projection, not an independent
        // catalog resolver. Historical claims must survive catalog changes.
        let valid_model_length = match self.mode {
            FundingMode::System => self.model_id.chars().count() <= 256,
            FundingMode::Preset => self.model_id.encode_utf16().count() <= 200,
        };
        if self.provider_id.is_empty()
            || self.provider_id.len() > 100
            || !self.provider_id.as_bytes()[0].is_ascii_alphanumeric()
            || !self
                .provider_id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || (self.mode == FundingMode::System) != (self.provider_id == "system")
            || self.model_id.is_empty()
            || self.model_id.trim() != self.model_id
            || !valid_model_length
            || self.model_id.chars().any(|c| c.is_control())
        {
            return Err(StoryError::Invalid);
        }
        if let Some(overrides) = &self.generation_overrides {
            let map = overrides.as_object().ok_or(StoryError::Invalid)?;
            if map.is_empty()
                || map
                    .keys()
                    .any(|k| !matches!(k.as_str(), "maxOutputTokens" | "temperature" | "thinking"))
            {
                return Err(StoryError::Invalid);
            }
            if let Some(value) = map.get("maxOutputTokens") {
                let number = value.as_f64().ok_or(StoryError::Invalid)?;
                if number.fract() != 0.0 || !(1.0..=1_000_000.0).contains(&number) {
                    return Err(StoryError::Invalid);
                }
            }
            if let Some(value) = map.get("temperature") {
                let number = value.as_f64().ok_or(StoryError::Invalid)?;
                if !number.is_finite() || number < 0.0 {
                    return Err(StoryError::Invalid);
                }
            }
            if let Some(value) = map.get("thinking") {
                let thinking = value.as_object().ok_or(StoryError::Invalid)?;
                if thinking
                    .keys()
                    .any(|k| !matches!(k.as_str(), "mode" | "effort"))
                {
                    return Err(StoryError::Invalid);
                }
                let mode = thinking
                    .get("mode")
                    .and_then(serde_json::Value::as_str)
                    .ok_or(StoryError::Invalid)?;
                if !matches!(mode, "default" | "disabled" | "enabled") {
                    return Err(StoryError::Invalid);
                }
                if let Some(effort) = thinking.get("effort") {
                    if mode != "enabled"
                        || !matches!(
                            effort.as_str(),
                            Some("minimal" | "low" | "medium" | "high" | "xhigh" | "max")
                        )
                    {
                        return Err(StoryError::Invalid);
                    }
                }
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservedGeneration {
    pub generation_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub server_payload_hash: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateClaim {
    pub version: u32,
    pub attempt_id: String,
    pub story_protocol_version: String,
    pub input_digest: String,
    pub client_body_hash: String,
    pub funding: NativeFunding,
    #[serde(deserialize_with = "required_nullable")]
    pub observed_generation: Option<ObservedGeneration>,
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl CreateClaim {
    pub(super) fn validate(&self, manifest: &PendingManifest) -> Result<(), StoryError> {
        if self.version != 1
            || ipc::token(Some(&self.attempt_id)).is_err()
            || self.story_protocol_version != "arena-story-v1"
            || self.input_digest != manifest.input_digest
            || !valid_digest(&self.input_digest)
            || !hash(&self.client_body_hash)
            || self.observed_generation.as_ref().is_some_and(|g| {
                !request_id(&g.generation_id)
                    || g.server_payload_hash.as_deref().is_some_and(|v| !hash(v))
            })
        {
            return Err(StoryError::Invalid);
        }
        self.funding.validate()
    }
}

/// Recheck nested closed authority objects before the Value projection can hide
/// duplicate keys. Business payloads never pass through this claim parser.
pub(super) fn parse_claim(document: &str) -> Result<CreateClaim, StoryError> {
    let raw = parse_raw(document)?;
    let claim = object(
        raw,
        &[
            "version",
            "attemptId",
            "storyProtocolVersion",
            "inputDigest",
            "clientBodyHash",
            "funding",
            "observedGeneration",
        ],
        &[
            "version",
            "attemptId",
            "storyProtocolVersion",
            "inputDigest",
            "clientBodyHash",
            "funding",
            "observedGeneration",
        ],
    )?;
    let funding = object(
        field(&claim, "funding")?,
        &["mode", "providerId", "modelId", "generationOverrides"],
        &["mode", "providerId", "modelId"],
    )?;
    if let Some(overrides) = funding.get("generationOverrides") {
        let overrides = object(
            overrides,
            &["maxOutputTokens", "temperature", "thinking"],
            &[],
        )?;
        if let Some(thinking) = overrides.get("thinking") {
            object(thinking, &["mode", "effort"], &["mode"])?;
        }
    }
    if let Some(observed) = claim
        .get("observedGeneration")
        .filter(|v| v.get() != "null")
    {
        object(
            observed,
            &["generationId", "serverPayloadHash"],
            &["generationId", "serverPayloadHash"],
        )?;
    }
    serde_json::from_str(document).map_err(|_| StoryError::Corrupt)
}

/// Short per-product gate. It must never outlive a synchronous admission step or
/// cross a network await. Flight is queried separately before connection locking.
pub(crate) struct AdmissionGuard<'a> {
    store: &'a StoryStore,
    product: Product,
    _lock: MutexGuard<'a, ()>,
    _maintenance: crate::maintenance::WritePermit,
}
impl AdmissionGuard<'_> {
    pub(crate) fn product(&self) -> Product {
        self.product
    }
    pub(super) fn check(&self, store: &StoryStore, product: Product) -> Result<(), StoryError> {
        if !std::ptr::eq(self.store, store) || self.product != product {
            return Err(StoryError::Stale);
        }
        Ok(())
    }
}
/// The same admission mutex, solely for pure in-memory cancellation. It cannot
/// be supplied to any storage API and does not enter the maintenance write gate:
/// a backup/restore window must never prevent aborting a pending network flight.
pub(crate) struct CancellationAdmissionGuard<'a> {
    _lock: MutexGuard<'a, ()>,
}
/// Not Clone, not serializable, and constructible only after durable first claim.
/// Dropping this value before POST intentionally burns the only create chance.
pub(crate) struct CreatePermit {
    instance: String,
    product: Product,
    request_id: String,
    actor: Actor,
    input_digest: String,
    attempt_id: String,
}
#[derive(Debug)]
pub(crate) struct NativeInput {
    pub snapshot: PendingSnapshot,
    pub input: String,
    pub role_response: Option<String>,
}

pub(super) fn metadata_budget(
    connection: &Connection,
    token: &str,
    claim: Option<&str>,
) -> Result<(), StoryError> {
    let bytes: usize = connection
        .query_row(
            "SELECT length(CAST(metadata AS BLOB)) FROM arena_story_pending WHERE token=?1",
            [token],
            |r| r.get(0),
        )
        .map_err(|_| StoryError::Io)?;
    if bytes
        .checked_add(claim.map_or(0, str::len))
        .is_none_or(|n| n > METADATA_BYTES)
    {
        return Err(StoryError::TooLarge);
    }
    Ok(())
}
/// Reserve the largest still-unknown observation before granting create or
/// replacing a revision. A successful POST must not consume the last metadata
/// bytes needed to bind its original generation and eventual server hash.
pub(super) fn claim_metadata_budget(
    connection: &Connection,
    token: &str,
    claim: Option<&CreateClaim>,
) -> Result<(), StoryError> {
    let reserved = claim
        .map(|claim| {
            let mut claim = claim.clone();
            let observed = claim
                .observed_generation
                .get_or_insert_with(|| ObservedGeneration {
                    generation_id: "g".repeat(128),
                    server_payload_hash: None,
                });
            if observed.server_payload_hash.is_none() {
                observed.server_payload_hash = Some("0".repeat(64));
            }
            serde_json::to_string(&claim).map_err(|_| StoryError::Invalid)
        })
        .transpose()?;
    metadata_budget(connection, token, reserved.as_deref())
}
fn checked(
    connection: &Connection,
    key: &PendingKey,
    actor: &Actor,
    input_digest: &str,
) -> Result<Stored, StoryError> {
    let row = exact(connection, key)?;
    if row.snapshot.manifest.actor != *actor || row.snapshot.manifest.input_digest != input_digest {
        return Err(StoryError::Stale);
    }
    if row.snapshot.restored || row.snapshot.save_attempt_id.is_some() {
        return Err(StoryError::CommitUnknown);
    }
    Ok(row)
}
fn open_for_transport(row: &Stored) -> Result<(), StoryError> {
    if row.snapshot.manifest.commit_manifest.is_some() {
        return Err(StoryError::Conflict);
    }
    Ok(())
}
impl StoryStore {
    pub(crate) fn pending_cancel_admission(
        &self,
        product: Product,
    ) -> Result<CancellationAdmissionGuard<'_>, StoryError> {
        let index = match product {
            Product::Battle => 0,
            Product::Arena => 1,
        };
        let lock = self.pending_admission[index]
            .lock()
            .map_err(|_| StoryError::Io)?;
        Ok(CancellationAdmissionGuard { _lock: lock })
    }
    pub(crate) fn pending_admission(
        &self,
        product: Product,
    ) -> Result<AdmissionGuard<'_>, StoryError> {
        let index = match product {
            Product::Battle => 0,
            Product::Arena => 1,
        };
        let lock = self.pending_admission[index]
            .lock()
            .map_err(|_| StoryError::Io)?;
        let maintenance = self
            .gate
            .enter_write()
            .map_err(|_| StoryError::Maintenance)?;
        Ok(AdmissionGuard {
            store: self,
            product,
            _lock: lock,
            _maintenance: maintenance,
        })
    }
    /// Pre-read only: release the connection before taking admission. Seal must
    /// re-read the token and check its product under that guard.
    pub(crate) fn pending_upload_product(&self, token: &str) -> Result<Product, StoryError> {
        ipc::token(Some(token))?;
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        Ok(load(&connection, token)?.snapshot.manifest.product)
    }
    pub(crate) fn pending_describe_admitted(
        &self,
        guard: &AdmissionGuard<'_>,
    ) -> Result<Option<PendingSnapshot>, StoryError> {
        guard.check(self, guard.product)?;
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        Ok(active(&connection, guard.product)?.map(|row| row.snapshot))
    }
    pub(crate) fn pending_native_input(
        &self,
        guard: &AdmissionGuard<'_>,
        key: &PendingKey,
        actor: &Actor,
        input_digest: &str,
    ) -> Result<NativeInput, StoryError> {
        guard.check(self, key.product)?;
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = exact(&connection, key)?;
        if row.snapshot.manifest.actor != *actor
            || row.snapshot.manifest.input_digest != input_digest
        {
            return Err(StoryError::Stale);
        }
        // This entry only reads originals. Side-effect admission separately rejects
        // restored/save/frozen states; accepted roles remain readable in all three.
        validate_claim_generation(&connection, &row)?;
        let input = read_blob(&connection, &row.token, PendingKind::Input)?;
        validate_input(input.as_bytes(), &row.snapshot.manifest)?;
        let role_response = if row.snapshot.manifest.role_state == RoleState::Accepted {
            let raw = read_blob(&connection, &row.token, PendingKind::RoleResponse)?;
            validate_carrier(
                raw.as_bytes(),
                PendingKind::RoleResponse,
                &row.snapshot.manifest,
            )?;
            Some(raw)
        } else {
            None
        };
        Ok(NativeInput {
            snapshot: row.snapshot,
            input,
            role_response,
        })
    }
    pub(crate) fn pending_claim_create(
        &self,
        guard: &AdmissionGuard<'_>,
        key: &PendingKey,
        actor: &Actor,
        input_digest: &str,
        client_body_hash: &str,
        funding: NativeFunding,
    ) -> Result<CreatePermit, StoryError> {
        guard.check(self, key.product)?;
        let mut connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = checked(&connection, key, actor, input_digest)?;
        open_for_transport(&row)?;
        if row.snapshot.manifest.model_completed || row.snapshot.create_claim.is_some() {
            return Err(StoryError::Conflict);
        }
        let input = read_blob(&connection, &row.token, PendingKind::Input)?;
        validate_input(input.as_bytes(), &row.snapshot.manifest)?;
        let claim = CreateClaim {
            version: 1,
            attempt_id: format!("{}-{}", self.instance, random_id()?),
            story_protocol_version: "arena-story-v1".into(),
            input_digest: input_digest.into(),
            client_body_hash: client_body_hash.into(),
            funding,
            observed_generation: None,
        };
        claim.validate(&row.snapshot.manifest)?;
        let document = serde_json::to_string(&claim).map_err(|_| StoryError::Invalid)?;
        claim_metadata_budget(&connection, &row.token, Some(&claim))?;
        let tx = connection.transaction().map_err(|_| StoryError::Io)?;
        let changed = tx.execute("UPDATE arena_story_pending SET create_claim=?2 WHERE token=?1 AND active=1 AND create_claim IS NULL AND save_attempt IS NULL AND restored=0", params![row.token, document]).map_err(|_| StoryError::Io)?;
        if changed != 1 {
            return Err(StoryError::Conflict);
        }
        tx.commit().map_err(|_| StoryError::Io)?;
        Ok(CreatePermit {
            instance: self.instance.clone(),
            product: key.product,
            request_id: key.request_id.clone(),
            actor: actor.clone(),
            input_digest: input_digest.into(),
            attempt_id: claim.attempt_id,
        })
    }
    pub(crate) fn pending_consume_create(
        &self,
        guard: &AdmissionGuard<'_>,
        key: &PendingKey,
        actor: &Actor,
        input_digest: &str,
        permit: CreatePermit,
    ) -> Result<CreateClaim, StoryError> {
        guard.check(self, key.product)?;
        if permit.instance != self.instance
            || permit.product != key.product
            || permit.request_id != key.request_id
            || permit.actor != *actor
            || permit.input_digest != input_digest
        {
            return Err(StoryError::Stale);
        }
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = checked(&connection, key, actor, input_digest)?;
        open_for_transport(&row)?;
        if row.snapshot.manifest.model_completed {
            return Err(StoryError::Conflict);
        }
        let claim = row.snapshot.create_claim.ok_or(StoryError::Conflict)?;
        if claim.attempt_id != permit.attempt_id || claim.observed_generation.is_some() {
            return Err(StoryError::Conflict);
        }
        Ok(claim)
    }
    /// Called only with a Native response/lookup for the original intent. A newer
    /// revision is accepted via its current exact key; a new task cannot inherit it.
    pub(crate) fn pending_observe_generation(
        &self,
        guard: &AdmissionGuard<'_>,
        key: &PendingKey,
        actor: &Actor,
        input_digest: &str,
        attempt_id: &str,
        observed: (&str, Option<&str>),
    ) -> Result<CreateClaim, StoryError> {
        let (generation_id, server_payload_hash) = observed;
        guard.check(self, key.product)?;
        let connection = lock_connection(&self.connection).map_err(StoryError::from_store)?;
        let row = checked(&connection, key, actor, input_digest)?;
        let mut claim = row.snapshot.create_claim.ok_or(StoryError::Conflict)?;
        if claim.attempt_id != attempt_id
            || !request_id(generation_id)
            || server_payload_hash.is_some_and(|s| !hash(s))
        {
            return Err(StoryError::Conflict);
        }
        if let Some(observed) = &claim.observed_generation {
            if observed.generation_id != generation_id
                || observed
                    .server_payload_hash
                    .as_deref()
                    .zip(server_payload_hash)
                    .is_some_and(|(old, next)| old != next)
            {
                return Err(StoryError::Conflict);
            }
        }
        let retained_hash = claim
            .observed_generation
            .as_ref()
            .and_then(|g| g.server_payload_hash.clone())
            .or_else(|| server_payload_hash.map(str::to_owned));
        claim.observed_generation = Some(ObservedGeneration {
            generation_id: generation_id.into(),
            server_payload_hash: retained_hash,
        });
        claim.validate(&row.snapshot.manifest)?;
        let document = serde_json::to_string(&claim).map_err(|_| StoryError::Invalid)?;
        claim_metadata_budget(&connection, &row.token, Some(&claim))?;
        connection
            .execute(
                "UPDATE arena_story_pending SET create_claim=?2 WHERE token=?1 AND active=1",
                params![row.token, document],
            )
            .map_err(|_| StoryError::Io)?;
        Ok(claim)
    }
}
