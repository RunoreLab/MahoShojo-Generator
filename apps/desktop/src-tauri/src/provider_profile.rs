//! Provider Profile 的 native 侧表示。
//!
//! TypeScript 侧的完整权威是 `@mahoshojo/contracts` 的 `DirectProviderProfileV1Schema`；这里
//! 只镜像 **Rust 真正要解析并据此发起出站请求** 的那一部分窄投影。
//!
//! 两条不可让步的边界：
//!
//! 1. Rust **不假设** TypeScript 已经验过这份文档。出站 endpoint、header 名称与 secret
//!    引用都会被重新校验一遍，因为它们直接决定"进程向哪里发请求、带什么凭据"。
//! 2. 本模块**不提供**读取明文 secret 的路径。secret 引用只用于向 [`crate::secret`] 取值。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// transport 层受控 header：与 `@mahoshojo/contracts` 的同名集合保持一致。
const TRANSPORT_CONTROLLED_HEADERS: [&str; 3] = ["connection", "content-length", "host"];

/// 明文写进 public headers 即视为泄漏的 header：与契约同名集合保持一致。
const KNOWN_SECRET_HEADERS: [&str; 9] = [
    "api-key",
    "authorization",
    "cf-access-client-secret",
    "cookie",
    "proxy-authorization",
    "set-cookie",
    "x-activity-token",
    "x-api-key",
    "x-goog-api-key",
];

pub const MAX_SECRET_REF_LENGTH: usize = 256;
pub const MAX_HEADER_NAME_LENGTH: usize = 128;
pub const MAX_HEADER_VALUE_LENGTH: usize = 8192;
pub const MAX_HEADERS: usize = 32;
pub const MAX_REDIRECTS: u8 = 3;

/// 项目自有域名。Direct 出站路径一律拒绝，避免本地库/Direct 旅程意外回流项目服务器。
const PROJECT_DOMAIN_SUFFIXES: [&str; 2] = ["mahoshojo.colanns.me", "colanns.me"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderProfileError {
    MalformedDocument,
    UnsupportedAdapter,
    InvalidBaseUrl,
    InsecureBaseUrl,
    ProjectOwnedEndpoint,
    InvalidHeader,
    SecretHeaderOverlap,
    InvalidSecretRef,
}

impl ProviderProfileError {
    pub fn code(&self) -> &'static str {
        match self {
            ProviderProfileError::MalformedDocument => "provider-profile-malformed",
            ProviderProfileError::UnsupportedAdapter => "provider-profile-unsupported-adapter",
            ProviderProfileError::InvalidBaseUrl => "provider-profile-invalid-base-url",
            ProviderProfileError::InsecureBaseUrl => "provider-profile-insecure-base-url",
            ProviderProfileError::ProjectOwnedEndpoint => "provider-profile-project-owned-endpoint",
            ProviderProfileError::InvalidHeader => "provider-profile-invalid-header",
            ProviderProfileError::SecretHeaderOverlap => "provider-profile-secret-header-overlap",
            ProviderProfileError::InvalidSecretRef => "provider-profile-invalid-secret-ref",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            ProviderProfileError::MalformedDocument => {
                "provider profile document could not be read"
            }
            ProviderProfileError::UnsupportedAdapter => {
                "provider profile adapter is not implemented yet"
            }
            ProviderProfileError::InvalidBaseUrl => {
                "provider profile base URL must be an absolute http(s) URL without credentials"
            }
            ProviderProfileError::InsecureBaseUrl => {
                "cleartext HTTP requires an explicit user confirmation"
            }
            ProviderProfileError::ProjectOwnedEndpoint => {
                "Direct AI must not target the project's own domains"
            }
            ProviderProfileError::InvalidHeader => "provider profile contains an invalid header",
            ProviderProfileError::SecretHeaderOverlap => {
                "secret and public header names must not overlap"
            }
            ProviderProfileError::InvalidSecretRef => {
                "provider profile contains an invalid secret reference"
            }
        }
    }
}

impl serde::Serialize for ProviderProfileError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("ProviderProfileError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderAdapter {
    OpenaiCompatible,
    Anthropic,
    Google,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTransport {
    #[serde(default)]
    pub allow_public_http: Option<bool>,
    #[serde(default)]
    pub max_redirects: Option<u8>,
}

/// 与 `@mahoshojo/contracts` 的 `DirectProviderExecutionProfile` 对应。
///
/// 标为 `deny_unknown_fields`，使 Rust 明确拒绝它不解析的字段，而不是静默忽略。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectProviderExecutionProfile {
    pub id: String,
    pub name: String,
    pub adapter: ProviderAdapter,
    pub base_url: String,
    pub model_id: String,
    #[serde(default)]
    pub api_key_ref: Option<String>,
    #[serde(default)]
    pub secret_header_refs: Option<BTreeMap<String, String>>,
    #[serde(default)]
    pub public_headers: Option<BTreeMap<String, String>>,
    #[serde(default)]
    pub transport: Option<ProfileTransport>,
}

fn is_valid_secret_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SECRET_REF_LENGTH
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

fn is_valid_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_HEADER_NAME_LENGTH
        && name.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(
                    c,
                    '!' | '#'
                        | '$'
                        | '%'
                        | '&'
                        | '\''
                        | '*'
                        | '+'
                        | '-'
                        | '.'
                        | '^'
                        | '_'
                        | '`'
                        | '|'
                        | '~'
                )
        })
}

fn is_valid_header_value(value: &str) -> bool {
    value.len() <= MAX_HEADER_VALUE_LENGTH && !value.chars().any(|c| c.is_control())
}

/// 明文 HTTP 的 loopback 判定。契约侧使用同一组主机，Rust 侧独立再算一次。
fn is_loopback_host(host: &str) -> bool {
    let normalized = host
        .trim_matches(|c| c == '[' || c == ']')
        .to_ascii_lowercase();
    if normalized == "localhost" || normalized == "::1" {
        return true;
    }
    normalized
        .split('.')
        .map(|part| part.parse::<u8>())
        .collect::<Result<Vec<_>, _>>()
        .map(|octets| octets.len() == 4 && octets.first().copied() == Some(127))
        .unwrap_or(false)
}

fn is_project_owned_host(host: &str) -> bool {
    let normalized = host.to_ascii_lowercase();
    PROJECT_DOMAIN_SUFFIXES
        .iter()
        .any(|suffix| normalized == *suffix || normalized.ends_with(&format!(".{suffix}")))
}

impl DirectProviderExecutionProfile {
    /// 从 opaque JSON 文档解析并**重新校验**安全子集。
    pub fn parse(document: &str) -> Result<Self, ProviderProfileError> {
        let profile: Self =
            serde_json::from_str(document).map_err(|_| ProviderProfileError::MalformedDocument)?;
        profile.validate()?;
        Ok(profile)
    }

    fn validate(&self) -> Result<(), ProviderProfileError> {
        // D1 只实现 OpenAI-compatible。其余 adapter 显式失败，而不是悄悄按 OpenAI 语义
        // 发起请求 —— 那会产生难以排查的行为差异。
        if self.adapter != ProviderAdapter::OpenaiCompatible {
            return Err(ProviderProfileError::UnsupportedAdapter);
        }

        if self.id.trim().is_empty() || self.model_id.trim().is_empty() {
            return Err(ProviderProfileError::MalformedDocument);
        }

        let url =
            url::Url::parse(&self.base_url).map_err(|_| ProviderProfileError::InvalidBaseUrl)?;
        if url.scheme() != "http" && url.scheme() != "https" {
            return Err(ProviderProfileError::InvalidBaseUrl);
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(ProviderProfileError::InvalidBaseUrl);
        }
        let host = url.host_str().ok_or(ProviderProfileError::InvalidBaseUrl)?;

        if is_project_owned_host(host) {
            return Err(ProviderProfileError::ProjectOwnedEndpoint);
        }
        if url.scheme() == "http"
            && !is_loopback_host(host)
            && self.transport.as_ref().and_then(|t| t.allow_public_http) != Some(true)
        {
            return Err(ProviderProfileError::InsecureBaseUrl);
        }
        if self
            .transport
            .as_ref()
            .and_then(|t| t.max_redirects)
            .is_some_and(|value| value > MAX_REDIRECTS)
        {
            return Err(ProviderProfileError::MalformedDocument);
        }

        if let Some(refs) = &self.api_key_ref {
            if !is_valid_secret_ref(refs) {
                return Err(ProviderProfileError::InvalidSecretRef);
            }
        }

        let public = self.public_headers.as_ref();
        if let Some(headers) = public {
            if headers.len() > MAX_HEADERS {
                return Err(ProviderProfileError::InvalidHeader);
            }
            for (name, value) in headers {
                let lower = name.to_ascii_lowercase();
                if !is_valid_header_name(name)
                    || TRANSPORT_CONTROLLED_HEADERS.contains(&lower.as_str())
                    || KNOWN_SECRET_HEADERS.contains(&lower.as_str())
                    || !is_valid_header_value(value)
                {
                    return Err(ProviderProfileError::InvalidHeader);
                }
            }
        }

        if let Some(refs) = &self.secret_header_refs {
            if refs.len() > MAX_HEADERS {
                return Err(ProviderProfileError::InvalidHeader);
            }
            for (name, secret_ref) in refs {
                let lower = name.to_ascii_lowercase();
                if !is_valid_header_name(name)
                    || TRANSPORT_CONTROLLED_HEADERS.contains(&lower.as_str())
                    || !is_valid_secret_ref(secret_ref)
                {
                    return Err(ProviderProfileError::InvalidSecretRef);
                }
                if public.is_some_and(|headers| {
                    headers
                        .keys()
                        .any(|public_name| public_name.eq_ignore_ascii_case(name))
                }) {
                    return Err(ProviderProfileError::SecretHeaderOverlap);
                }
            }
        }

        Ok(())
    }
}

/// 从**完整** Profile 文档里"peek"出 Rust 唯一需要的几个字段。
///
/// 与 [`DirectProviderExecutionProfile`] 的区别是这里**允许**未知字段：完整文档合法地带有
/// `version` / `createdAt` / `updatedAt` / `generationDefaults`，而 Rust 不解释它们。
/// Rust 只在删除 Profile 时需要知道它引用了哪些 secret。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProviderProfileIdentity {
    pub id: String,
    #[serde(default)]
    pub api_key_ref: Option<String>,
    #[serde(default)]
    pub secret_header_refs: Option<BTreeMap<String, String>>,
}

impl StoredProviderProfileIdentity {
    pub fn parse(document: &str) -> Result<Self, ProviderProfileError> {
        let identity: Self =
            serde_json::from_str(document).map_err(|_| ProviderProfileError::MalformedDocument)?;
        if identity.id.trim().is_empty() {
            return Err(ProviderProfileError::MalformedDocument);
        }
        Ok(identity)
    }

    /// 该 Profile 引用的全部 secret 引用。
    pub fn secret_refs(&self) -> Vec<String> {
        let mut refs: Vec<String> = self.api_key_ref.iter().cloned().collect();
        refs.extend(
            self.secret_header_refs
                .as_ref()
                .map(|headers| headers.values().cloned().collect::<Vec<_>>())
                .unwrap_or_default(),
        );
        refs
    }
}

#[cfg(test)]
mod tests {
    use super::{DirectProviderExecutionProfile, ProviderAdapter, ProviderProfileError};

    const FIXTURE: &str =
        include_str!("../../../../packages/contracts/fixtures/provider-execution-profiles.json");

    fn document(value: serde_json::Value) -> String {
        value.to_string()
    }

    #[test]
    fn accepts_every_profile_the_shared_typescript_fixture_marks_valid() {
        let fixture: serde_json::Value =
            serde_json::from_str(FIXTURE).expect("shared fixture must be valid JSON");

        let valid = fixture["valid"].as_array().expect("valid must be an array");
        assert!(!valid.is_empty(), "fixture must contain valid cases");

        for entry in valid {
            let parsed = DirectProviderExecutionProfile::parse(&document(entry.clone()))
                .unwrap_or_else(|error| {
                    panic!("fixture marks {entry} valid but Rust rejected it: {error:?}")
                });
            assert_eq!(parsed.adapter, ProviderAdapter::OpenaiCompatible);
        }
    }

    #[test]
    fn rejects_every_profile_the_shared_typescript_fixture_marks_invalid() {
        let fixture: serde_json::Value =
            serde_json::from_str(FIXTURE).expect("shared fixture must be valid JSON");

        let invalid = fixture["invalid"]
            .as_array()
            .expect("invalid must be an array");
        assert!(!invalid.is_empty(), "fixture must contain invalid cases");

        for entry in invalid {
            let case = entry["$case"].as_str().unwrap_or("unnamed case");
            let profile = entry["profile"].clone();
            let outcome = DirectProviderExecutionProfile::parse(&document(profile));
            assert!(
                outcome.is_err(),
                "fixture marks {case} invalid but Rust accepted it"
            );
        }
    }

    #[test]
    fn rejects_documents_carrying_fields_it_does_not_parse() {
        // renderer 不得借同一通道把 Rust 不解析的字段塞进执行路径。
        let profile = serde_json::json!({
            "id": "p",
            "name": "n",
            "adapter": "openai-compatible",
            "baseUrl": "https://api.example.com/v1",
            "modelId": "m",
            "generationDefaults": { "temperature": 0.4 }
        });
        assert_eq!(
            DirectProviderExecutionProfile::parse(&document(profile))
                .expect_err("unknown fields must be rejected"),
            ProviderProfileError::MalformedDocument
        );
    }

    #[test]
    fn refuses_to_target_the_project_owned_domains() {
        for host in [
            "mahoshojo.colanns.me",
            "api.mahoshojo.colanns.me",
            "colanns.me",
            "deep.nested.mahoshojo.colanns.me",
        ] {
            let profile = serde_json::json!({
                "id": "p",
                "name": "n",
                "adapter": "openai-compatible",
                "baseUrl": format!("https://{host}/v1"),
                "modelId": "m"
            });
            let error = DirectProviderExecutionProfile::parse(&document(profile))
                .expect_err("project-owned endpoint must be refused");
            let is_project_refusal = matches!(
                error,
                ProviderProfileError::ProjectOwnedEndpoint | ProviderProfileError::InsecureBaseUrl
            );
            assert!(
                is_project_refusal,
                "{host} must be refused as project-owned or insecure, got {error:?}"
            );
        }

        // 名字相近但不属于项目的域名不受影响，包括把项目域名当前缀的仿冒后缀。
        for host in [
            "mahoshojo.example.com",
            "mahoshojo.colanns.me.evil.example",
            "notcolanns.me",
        ] {
            let profile = serde_json::json!({
                "id": "p",
                "name": "n",
                "adapter": "openai-compatible",
                "baseUrl": format!("https://{host}/v1"),
                "modelId": "m"
            });
            assert!(
                DirectProviderExecutionProfile::parse(&document(profile)).is_ok(),
                "{host} must not be treated as project-owned"
            );
        }
    }

    #[test]
    fn refuses_cleartext_http_to_public_hosts_without_explicit_confirmation() {
        let insecure = serde_json::json!({
            "id": "p",
            "name": "n",
            "adapter": "openai-compatible",
            "baseUrl": "http://api.example.com/v1",
            "modelId": "m"
        });
        assert_eq!(
            DirectProviderExecutionProfile::parse(&document(insecure.clone()))
                .expect_err("must be refused"),
            ProviderProfileError::InsecureBaseUrl
        );

        let confirmed = serde_json::json!({
            "id": "p",
            "name": "n",
            "adapter": "openai-compatible",
            "baseUrl": "http://api.example.com/v1",
            "modelId": "m",
            "transport": { "allowPublicHttp": true }
        });
        assert!(DirectProviderExecutionProfile::parse(&document(confirmed)).is_ok());
    }

    #[test]
    fn refuses_adapters_that_are_not_implemented_yet() {
        for adapter in ["anthropic", "google"] {
            let profile = serde_json::json!({
                "id": "p",
                "name": "n",
                "adapter": adapter,
                "baseUrl": "https://api.example.com/v1",
                "modelId": "m"
            });
            assert_eq!(
                DirectProviderExecutionProfile::parse(&document(profile))
                    .expect_err("must be refused"),
                ProviderProfileError::UnsupportedAdapter
            );
        }
    }

    #[test]
    fn error_projection_carries_only_code_and_message() {
        for error in [
            ProviderProfileError::MalformedDocument,
            ProviderProfileError::UnsupportedAdapter,
            ProviderProfileError::InvalidBaseUrl,
            ProviderProfileError::InsecureBaseUrl,
            ProviderProfileError::ProjectOwnedEndpoint,
            ProviderProfileError::InvalidHeader,
            ProviderProfileError::SecretHeaderOverlap,
            ProviderProfileError::InvalidSecretRef,
        ] {
            let value = serde_json::to_value(error).expect("error must serialize");
            assert_eq!(value.as_object().expect("object").len(), 2);
            assert!(!value["message"].as_str().expect("message").is_empty());
        }
    }
}
