//! Stable preset identity, resolved exclusively against generated project authority.
//! No URL, adapter or secret reference is accepted from the renderer.
use crate::provider_profile::{DirectProviderExecutionProfile, ProfileTransport, ProviderAdapter};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProviderTarget {
    System {},
    Preset { provider_id: String },
    Custom { profile_id: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedProviderPreset {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub provider_type: String,
    model_aliases: std::collections::BTreeMap<String, String>,
    endpoint_kind: String,
    adapter: Option<String>,
    models: Vec<TrustedPresetModel>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrustedPresetModel {
    id: String,
    adapter: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderTargetError {
    UnknownPreset,
    InvalidModel,
    UnsupportedWire,
    InvalidCatalog,
}
impl ProviderTargetError {
    pub fn message(self) -> &'static str {
        match self {
            Self::UnknownPreset => "provider preset is unavailable",
            Self::InvalidModel => "model ID must be 1..=200 characters without controls",
            Self::UnsupportedWire => "provider model has no supported verified Direct protocol",
            Self::InvalidCatalog => "trusted provider catalog is invalid",
        }
    }
}

fn catalog() -> Result<Vec<TrustedProviderPreset>, ProviderTargetError> {
    serde_json::from_str(include_str!("generated/provider-presets.json"))
        .map_err(|_| ProviderTargetError::InvalidCatalog)
}

/// UTF-16 units mirror JS/Zod length; trim before validating, never truncate.
pub fn normalize_model_id(model: &str) -> Result<String, ProviderTargetError> {
    normalize_model_id_with_limit(model, 200)
}

/// Compatibility only for existing custom Profile/overlay choices, never new preset input.
pub(crate) fn normalize_legacy_model_id(model: &str) -> Result<String, ProviderTargetError> {
    normalize_model_id_with_limit(model, 256)
}

fn normalize_model_id_with_limit(
    model: &str,
    max_length: usize,
) -> Result<String, ProviderTargetError> {
    let value = model.trim_matches(|c: char| {
        matches!(c,
            '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
            '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
            '\u{205f}' | '\u{3000}' | '\u{feff}'
        )
    });
    if value.is_empty()
        || value.encode_utf16().count() > max_length
        || value
            .chars()
            .any(|c| c <= '\u{1f}' || ('\u{7f}'..='\u{9f}').contains(&c))
    {
        return Err(ProviderTargetError::InvalidModel);
    }
    Ok(value.to_owned())
}

pub fn resolve_hosted_preset(
    provider_id: &str,
    model_id: &str,
) -> Result<TrustedProviderPreset, ProviderTargetError> {
    normalize_model_id(model_id)?;
    let preset = catalog()?
        .into_iter()
        .find(|preset| preset.id == provider_id)
        .ok_or(ProviderTargetError::UnknownPreset)?;
    let url = url::Url::parse(&preset.base_url).map_err(|_| ProviderTargetError::InvalidCatalog)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(
            preset.provider_type.as_str(),
            "openai" | "google" | "deepseek"
        )
    {
        return Err(ProviderTargetError::InvalidCatalog);
    }
    Ok(preset)
}

/// Shared catalog aliases apply only to stable preset identity, never custom endpoints.
pub fn resolve_preset_model_id(
    provider_id: &str,
    model_id: &str,
) -> Result<String, ProviderTargetError> {
    let normalized = normalize_model_id(model_id)?;
    let preset = resolve_hosted_preset(provider_id, &normalized)?;
    Ok(preset
        .model_aliases
        .get(&normalized.to_ascii_lowercase())
        .cloned()
        .unwrap_or(normalized))
}

/// Native-only execution authority; never deserialized from renderer input or inferred from Profile ID.
pub(crate) enum CredentialPurpose {
    Custom,
    TrustedPreset { provider_id: String },
}

/// Last guard before SecretStore::resolve, even if an internal caller supplies a constructed profile.
pub(crate) fn validate_credential_purpose(
    profile: &DirectProviderExecutionProfile,
    purpose: &CredentialPurpose,
) -> Result<(), ProviderTargetError> {
    profile
        .validate()
        .map_err(|_| ProviderTargetError::InvalidCatalog)?;
    match purpose {
        CredentialPurpose::Custom => crate::provider_profile::reject_reserved_secret_refs(
            profile.api_key_ref.as_deref(),
            profile.secret_header_refs.as_ref(),
        )
        .map_err(|_| ProviderTargetError::InvalidCatalog),
        CredentialPurpose::TrustedPreset { provider_id } => {
            let trusted = resolve_direct_preset(provider_id, &profile.model_id)?;
            if profile.base_url != trusted.base_url
                || profile.adapter != trusted.adapter
                || profile.api_key_ref != trusted.api_key_ref
                || profile.max_redirects() != 0
                || profile
                    .secret_header_refs
                    .as_ref()
                    .is_some_and(|refs| !refs.is_empty())
                || profile
                    .public_headers
                    .as_ref()
                    .is_some_and(|headers| !headers.is_empty())
            {
                return Err(ProviderTargetError::InvalidCatalog);
            }
            Ok(())
        }
    }
}

/// Provider-facing IPC must never manage native login credentials. Preset keys must
/// name an exact current catalog binding; ordinary legacy custom refs remain valid.
pub(crate) fn validate_provider_secret_ref_scope(
    reference: &str,
) -> Result<(), ProviderTargetError> {
    use crate::provider_profile::{
        has_secret_namespace, ACCOUNT_SESSION_SECRET_PREFIX, PRESET_SECRET_PREFIX,
    };
    if has_secret_namespace(reference, ACCOUNT_SESSION_SECRET_PREFIX) {
        return Err(ProviderTargetError::UnknownPreset);
    }
    if has_secret_namespace(reference, PRESET_SECRET_PREFIX) {
        let provider_id = reference
            .strip_prefix("preset:")
            .and_then(|value| value.strip_suffix(":api-key"))
            .ok_or(ProviderTargetError::UnknownPreset)?;
        if preset_secret_ref(provider_id)? != reference {
            return Err(ProviderTargetError::UnknownPreset);
        }
    }
    Ok(())
}

pub fn preset_secret_ref(provider_id: &str) -> Result<String, ProviderTargetError> {
    if !catalog()?.iter().any(|preset| preset.id == provider_id)
        || provider_id.is_empty()
        || provider_id.len() > 100
        || !provider_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(ProviderTargetError::UnknownPreset);
    }
    Ok(format!("preset:{provider_id}:api-key"))
}

fn supports_direct_model(preset: &TrustedProviderPreset, model_id: &str) -> bool {
    let wire = preset
        .models
        .iter()
        .find(|model| model.id == model_id)
        .and_then(|model| model.adapter.as_deref())
        .or(preset.adapter.as_deref());
    preset.endpoint_kind == "provider-public" && wire == Some("openai-compatible")
}

pub fn resolve_direct_preset(
    provider_id: &str,
    model_id: &str,
) -> Result<DirectProviderExecutionProfile, ProviderTargetError> {
    let model_id = normalize_model_id(model_id)?;
    let preset = resolve_hosted_preset(provider_id, &model_id)?;
    if !supports_direct_model(&preset, &model_id) {
        return Err(ProviderTargetError::UnsupportedWire);
    }
    // Only this native-authority constructor may bind the reserved preset secret namespace.
    let profile = DirectProviderExecutionProfile {
        id: format!("preset:{}", preset.id),
        name: preset.name,
        adapter: ProviderAdapter::OpenaiCompatible,
        base_url: preset.base_url,
        model_id: resolve_preset_model_id(provider_id, &model_id)?,
        api_key_ref: Some(preset_secret_ref(provider_id)?),
        secret_header_refs: None,
        public_headers: None,
        transport: Some(ProfileTransport {
            max_redirects: Some(0),
            allow_public_http: None,
        }),
    };
    profile
        .validate()
        .map_err(|_| ProviderTargetError::InvalidCatalog)?;
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn last_resolve_guard_never_infers_authority_from_profile_id() {
        let mut profile = resolve_direct_preset("deepseek", "model").unwrap();
        assert!(validate_credential_purpose(&profile, &CredentialPurpose::Custom).is_err());
        let purpose = CredentialPurpose::TrustedPreset {
            provider_id: "deepseek".into(),
        };
        assert!(validate_credential_purpose(&profile, &purpose).is_ok());
        profile.base_url = "https://example.invalid".into();
        assert!(validate_credential_purpose(&profile, &purpose).is_err());
        profile.api_key_ref = Some("account-session:web-v1".into());
        assert!(validate_credential_purpose(&profile, &purpose).is_err());
        assert!(validate_credential_purpose(&profile, &CredentialPurpose::Custom).is_err());
        profile.api_key_ref = Some("provider:legacy:key".into());
        assert!(validate_credential_purpose(&profile, &CredentialPurpose::Custom).is_ok());
    }
    #[test]
    fn provider_secret_ipc_is_scoped_away_from_login_and_unknown_presets() {
        for reference in [
            "account-session:web-v1",
            "ACCOUNT-SESSION:web-v1",
            "account-session:future",
            "preset:unknown:api-key",
            "preset:deepseek:other",
            "PRESET:deepseek:api-key",
        ] {
            assert!(
                validate_provider_secret_ref_scope(reference).is_err(),
                "{reference}"
            );
        }
        for reference in [
            "preset:deepseek:api-key",
            "provider:old:api-key",
            "vault:legacy",
            "plain-legacy-reference",
        ] {
            assert!(
                validate_provider_secret_ref_scope(reference).is_ok(),
                "{reference}"
            );
        }
    }
    #[test]
    fn preset_alias_is_shared_and_does_not_leak_to_custom_provider_identity() {
        let profile = resolve_direct_preset("deepseek", " DEEPSEEK-V4-FLASH-0731 ").unwrap();
        assert_eq!(profile.model_id, "deepseek-v4-flash");
        assert_eq!(
            normalize_legacy_model_id("deepseek-v4-flash-0731").unwrap(),
            "deepseek-v4-flash-0731"
        );
    }
    #[test]
    fn legacy_model_normalization_preserves_long_ids_without_wire_whitespace() {
        assert_eq!(
            normalize_legacy_model_id("\u{feff} model \u{feff}").unwrap(),
            "model"
        );
        assert_eq!(
            normalize_legacy_model_id(&"a".repeat(256)).unwrap(),
            "a".repeat(256)
        );
        assert!(normalize_legacy_model_id(&"a".repeat(257)).is_err());
        assert!(normalize_legacy_model_id("\u{feff} \u{feff}").is_err());
    }
    #[test]
    fn explicit_model_denial_overrides_preset_protocol() {
        let mut preset = resolve_hosted_preset("deepseek", "model").unwrap();
        preset.models.push(TrustedPresetModel {
            id: "denied-model".into(),
            adapter: Some("none".into()),
        });
        assert!(!supports_direct_model(&preset, "denied-model"));
        assert!(supports_direct_model(&preset, "other-custom-model"));
    }
    #[test]
    fn matches_shared_target_and_model_fixtures() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/provider-targets.json"
        ))
        .unwrap();
        for value in fixture["validTargets"].as_array().unwrap() {
            let target: ProviderTarget = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(target).unwrap(), *value);
        }
        for value in fixture["invalidTargets"].as_array().unwrap() {
            assert!(serde_json::from_value::<ProviderTarget>(value.clone()).is_err());
        }
        for value in fixture["models"].as_array().unwrap() {
            assert_eq!(
                normalize_model_id(value["input"].as_str().unwrap())
                    .ok()
                    .as_deref(),
                value["output"].as_str()
            );
        }
    }
    #[test]
    fn preset_is_not_profile_and_model_can_be_entered_directly() {
        let profile = resolve_direct_preset("deepseek", " new-model ").unwrap();
        assert_eq!(profile.id, "preset:deepseek");
        assert_eq!(profile.model_id, "new-model");
        assert_eq!(
            profile.api_key_ref.as_deref(),
            Some("preset:deepseek:api-key")
        );
        assert_eq!(profile.max_redirects(), 0);
    }
    #[test]
    fn unknown_and_unverified_models_fail_closed() {
        assert!(resolve_direct_preset("not-in-catalog", "model").is_err());
        assert!(resolve_direct_preset("google-cloudflare", "model").is_err());
        for preset in catalog()
            .unwrap()
            .iter()
            .filter(|preset| preset.adapter.is_none())
        {
            assert!(resolve_direct_preset(&preset.id, "unknown-custom-model").is_err());
        }
    }
    #[test]
    fn target_cannot_smuggle_transport_or_credentials() {
        assert!(serde_json::from_str::<ProviderTarget>(
            r#"{"kind":"preset","providerId":"deepseek","baseUrl":"https://evil.test"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ProviderTarget>(
            r#"{"kind":"custom","profileId":"legacy"}"#
        )
        .is_ok());
    }
    #[test]
    fn model_validation_matches_new_js_boundary() {
        assert!(normalize_model_id(&"a".repeat(200)).is_ok());
        assert!(normalize_model_id(&"a".repeat(201)).is_err());
        assert!(normalize_model_id(&"😀".repeat(101)).is_err());
        assert!(normalize_model_id("a\nb").is_err());
        assert!(normalize_model_id("   ").is_err());
        assert_eq!(
            normalize_model_id("\u{feff}model\u{feff}").unwrap(),
            "model"
        );
        assert!(normalize_model_id("\u{0085}model").is_err());
        assert!(normalize_model_id("m\u{0085}odel").is_err());
    }
}
