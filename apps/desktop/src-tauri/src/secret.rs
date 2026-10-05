//! 持久 secret 的平台存储。
//!
//! V1 使用操作系统凭据存储（Windows Credential Manager / macOS Keychain / Secret Service），
//! 而不是 Stronghold 的 JavaScript API：后者要求把 vault master password 交给 renderer，
//! 与「已持久化 secret 不可由 renderer 读回」直接冲突。
//!
//! 冻结的安全目标（见 `ADR-desktop-tauri-v1` 第 6 条）：
//!
//! - renderer **可以** 在用户主动录入时短暂持有明文；
//! - renderer **不可以** 读回任何已持久化的 secret —— 因此本模块**不提供**读取入口，
//!   只有 set / exists / delete；
//! - 明文只在 Rust 侧 executor 组装出站请求的那一刻出现。

use std::sync::Arc;

use keyring::Entry;
use serde::Serialize;

/// 凭据存储中的 service 名。必须与 bundle identifier 保持同一命名空间。
pub const SECRET_STORE_SERVICE: &str = "me.colanns.mahoshojo.desktop";

/// 与 `@mahoshojo/contracts` 的 `desktop-ipc` 子路径保持一致的引用长度上限。
pub const MAX_SECRET_REF_LENGTH: usize = 256;

/// 与 `@mahoshojo/contracts` 的 `desktop-ipc` 子路径保持一致的取值字节上限。
pub const MAX_SECRET_VALUE_BYTES: usize = 8 * 1024;

/// secret 引用的合法字符集。
///
/// 引用会直接成为操作系统凭据存储的目标名，因此只允许 ASCII 字母、数字、点、下划线、
/// 冒号与连字符。这同时阻止把凭据存储当成任意键值仓库，并强制 Provider Profile 的 id
/// 在派生引用前满足同一规则。
const SECRET_REF_ALLOWED: fn(char) -> bool =
    |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-');

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SecretStoreErrorCode {
    InvalidSecretRef,
    SecretValueTooLarge,
    SecretStoreUnavailable,
    SecretStoreFailure,
}

/// 失败投影。
///
/// `message` 只包含固定文案与 secret 引用，**不**包含 secret 明文，也**不**回显操作系统
/// 凭据存储的原始错误串。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStoreError {
    pub code: SecretStoreErrorCode,
    pub message: String,
}

impl SecretStoreError {
    #[cfg(test)]
    pub(crate) fn failure_for_test() -> Self {
        Self::failure()
    }

    fn invalid_ref() -> Self {
        Self {
            code: SecretStoreErrorCode::InvalidSecretRef,
            message: "secret reference must be 1..=256 ASCII characters from [A-Za-z0-9._:-]"
                .to_string(),
        }
    }

    fn value_too_large() -> Self {
        Self {
            code: SecretStoreErrorCode::SecretValueTooLarge,
            message: format!("secret value must not exceed {MAX_SECRET_VALUE_BYTES} UTF-8 bytes"),
        }
    }

    fn unavailable() -> Self {
        Self {
            code: SecretStoreErrorCode::SecretStoreUnavailable,
            message: "operating system credential store is unavailable".to_string(),
        }
    }

    fn failure() -> Self {
        Self {
            code: SecretStoreErrorCode::SecretStoreFailure,
            message: "operating system credential store rejected the operation".to_string(),
        }
    }
}

pub fn validate_secret_ref(secret_ref: &str) -> Result<(), SecretStoreError> {
    let char_count = secret_ref.chars().count();
    if char_count == 0 || char_count > MAX_SECRET_REF_LENGTH {
        return Err(SecretStoreError::invalid_ref());
    }
    if !secret_ref.chars().all(SECRET_REF_ALLOWED) {
        return Err(SecretStoreError::invalid_ref());
    }
    Ok(())
}

fn validate_secret_value(value: &str) -> Result<(), SecretStoreError> {
    if value.len() > MAX_SECRET_VALUE_BYTES {
        return Err(SecretStoreError::value_too_large());
    }
    Ok(())
}

/// 平台凭据存储的窄接口。
///
/// 抽象成 trait 是为了让 command 层、引用校验与错误映射都能被不触碰真实系统凭据的
/// 测试覆盖；只有最后一层绑定需要真实操作系统环境。
pub trait SecretStore: Send + Sync {
    fn set(&self, secret_ref: &str, value: &str) -> Result<(), SecretStoreError>;
    fn exists(&self, secret_ref: &str) -> Result<bool, SecretStoreError>;
    /// 幂等：引用不存在同样视为成功。
    fn delete(&self, secret_ref: &str) -> Result<(), SecretStoreError>;

    /// 取出明文。
    ///
    /// **只允许 native 侧出站 executor 调用。** 它不通过任何 `#[tauri::command]` 暴露，
    /// 因此 renderer 无法触达；边界由"命令面"保证，而不是由"trait 上没有这个方法"保证。
    ///
    /// 早先这里刻意不提供读取方法，理由是"trait 上不存在即安全"。实际不成立：Rust executor
    /// 必须能取明文才能发起带凭据的请求，缺失它只会让凭据以更糟的方式流转（例如把明文塞进
    /// 命令参数）。正确的不变量是 IPC 面不可读，已由仓库结构门禁断言命令集合不含任何读取
    /// 形态。
    fn resolve(&self, secret_ref: &str) -> Result<Option<String>, SecretStoreError>;
}

fn classify(error: &keyring::Error) -> SecretStoreError {
    // 不回显原始错误串：凭据后端的错误文本可能包含实现细节，且未来实现未必可靠净化。
    match error {
        keyring::Error::NoEntry => SecretStoreError::failure(),
        keyring::Error::PlatformFailure(_) | keyring::Error::BadEncoding(_) => {
            SecretStoreError::unavailable()
        }
        _ => SecretStoreError::failure(),
    }
}

/// 基于 `keyring` 的真实操作系统凭据存储。
pub struct CredentialStore {
    service: String,
}

impl CredentialStore {
    pub fn new() -> Self {
        Self {
            service: SECRET_STORE_SERVICE.to_string(),
        }
    }

    fn entry(&self, secret_ref: &str) -> Result<Entry, SecretStoreError> {
        validate_secret_ref(secret_ref)?;
        Entry::new(&self.service, secret_ref).map_err(|error| classify(&error))
    }
}

impl Default for CredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for CredentialStore {
    fn set(&self, secret_ref: &str, value: &str) -> Result<(), SecretStoreError> {
        validate_secret_ref(secret_ref)?;
        validate_secret_value(value)?;
        self.entry(secret_ref)?
            .set_password(value)
            .map_err(|error| classify(&error))
    }

    fn exists(&self, secret_ref: &str) -> Result<bool, SecretStoreError> {
        let entry = self.entry(secret_ref)?;
        match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(classify(&error)),
        }
    }

    fn delete(&self, secret_ref: &str) -> Result<(), SecretStoreError> {
        let entry = self.entry(secret_ref)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(classify(&error)),
        }
    }

    fn resolve(&self, secret_ref: &str) -> Result<Option<String>, SecretStoreError> {
        let entry = self.entry(secret_ref)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(classify(&error)),
        }
    }
}

/// 供 command 层使用的共享句柄。
pub type SharedSecretStore = Arc<dyn SecretStore>;

pub fn default_secret_store() -> SharedSecretStore {
    Arc::new(CredentialStore::new())
}

#[cfg(test)]
mod tests {
    use super::{
        classify, validate_secret_ref, validate_secret_value, CredentialStore, SecretStore,
        SecretStoreError, SecretStoreErrorCode, MAX_SECRET_REF_LENGTH, MAX_SECRET_VALUE_BYTES,
    };
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    fn assert_present(store: &dyn SecretStore, secret_ref: &str) {
        assert!(
            store
                .exists(secret_ref)
                .expect("existence check must succeed"),
            "{secret_ref:?} must exist"
        );
    }

    fn assert_absent(store: &dyn SecretStore, secret_ref: &str) {
        assert!(
            !store
                .exists(secret_ref)
                .expect("existence check must succeed"),
            "{secret_ref:?} must not exist"
        );
    }

    /// 与 `@mahoshojo/contracts` 的 fixture 同源的引用样例。
    ///
    /// 完整 fixture 通过 `include_str!` 在下方的一致性测试中读取；这里只保留纯逻辑断言。
    struct InMemorySecretStore {
        entries: Mutex<BTreeMap<String, String>>,
    }

    impl InMemorySecretStore {
        fn new() -> Self {
            Self {
                entries: Mutex::new(BTreeMap::new()),
            }
        }
    }

    impl SecretStore for InMemorySecretStore {
        fn set(&self, secret_ref: &str, value: &str) -> Result<(), SecretStoreError> {
            validate_secret_ref(secret_ref)?;
            validate_secret_value(value)?;
            self.entries
                .lock()
                .expect("in-memory store lock")
                .insert(secret_ref.to_string(), value.to_string());
            Ok(())
        }

        fn exists(&self, secret_ref: &str) -> Result<bool, SecretStoreError> {
            validate_secret_ref(secret_ref)?;
            Ok(self
                .entries
                .lock()
                .expect("in-memory store lock")
                .contains_key(secret_ref))
        }

        fn delete(&self, secret_ref: &str) -> Result<(), SecretStoreError> {
            validate_secret_ref(secret_ref)?;
            self.entries
                .lock()
                .expect("in-memory store lock")
                .remove(secret_ref);
            Ok(())
        }

        fn resolve(&self, secret_ref: &str) -> Result<Option<String>, SecretStoreError> {
            validate_secret_ref(secret_ref)?;
            Ok(self
                .entries
                .lock()
                .expect("in-memory store lock")
                .get(secret_ref)
                .cloned())
        }
    }

    #[test]
    fn accepts_provider_shaped_references() {
        for secret_ref in [
            "provider:p_01:api-key",
            "provider:p_01:x-api-key",
            "vault:demo:authorization",
            "a",
            "A.b_c-d:e",
        ] {
            assert!(
                validate_secret_ref(secret_ref).is_ok(),
                "{secret_ref} must be accepted"
            );
        }
    }

    #[test]
    fn rejects_references_outside_the_credential_target_charset() {
        for secret_ref in [
            "",
            "provider:p 01:api-key",
            "provider:p_01:api key",
            "provider:p_01:api/key",
            "provider:p_01:api\\key",
            "provider:p_01:api\nkey",
            "provider:p_01:密钥",
            "../escape",
            &"a".repeat(MAX_SECRET_REF_LENGTH + 1),
        ] {
            let error = validate_secret_ref(secret_ref)
                .expect_err(&format!("{secret_ref:?} must be rejected"));
            assert_eq!(error.code, SecretStoreErrorCode::InvalidSecretRef);
        }
    }

    #[test]
    fn accepts_a_reference_exactly_at_the_length_ceiling() {
        assert!(validate_secret_ref(&"a".repeat(MAX_SECRET_REF_LENGTH)).is_ok());
    }

    #[test]
    fn rejects_oversized_secret_values_without_touching_the_store() {
        let store = InMemorySecretStore::new();
        let oversized = format!("S3CRET-MARKER-{}", "x".repeat(MAX_SECRET_VALUE_BYTES));

        let error = store
            .set("provider:p_01:api-key", &oversized)
            .expect_err("oversized value must be rejected");
        assert_eq!(error.code, SecretStoreErrorCode::SecretValueTooLarge);
        assert!(
            !error.message.contains("S3CRET"),
            "error message must not echo any part of the secret value"
        );
        assert_absent(&store, "provider:p_01:api-key");
    }

    #[test]
    fn delete_is_idempotent() {
        let store = InMemorySecretStore::new();
        assert!(store.delete("provider:p_01:api-key").is_ok());
        store
            .set("provider:p_01:api-key", "value")
            .expect("set must succeed");
        assert!(store.delete("provider:p_01:api-key").is_ok());
        assert!(store.delete("provider:p_01:api-key").is_ok());
        assert_absent(&store, "provider:p_01:api-key");
    }

    #[test]
    fn maps_platform_failures_to_public_codes_without_echoing_backend_text() {
        let error = classify(&keyring::Error::NoEntry);
        assert_eq!(error.code, SecretStoreErrorCode::SecretStoreFailure);
        assert!(!error.message.contains("No matching credential"));

        let unavailable = SecretStoreError {
            code: SecretStoreErrorCode::SecretStoreUnavailable,
            message: "operating system credential store is unavailable".to_string(),
        };
        let value = serde_json::to_value(&unavailable).expect("error must serialize");
        assert_eq!(value["code"], "secret-store-unavailable");
        assert_eq!(
            value.as_object().expect("object").len(),
            2,
            "error projection must contain only code and message"
        );
    }

    #[test]
    fn resolve_returns_plaintext_only_inside_the_native_process() {
        // resolve 存在的理由是 native executor 必须取明文才能发起带凭据的请求。
        // 它不被任何 #[tauri::command] 使用，因此 renderer 触不到；这条不变量由仓库结构
        // 门禁断言命令集合不含读取形态，而不是由 trait 形状保证。
        let store = InMemorySecretStore::new();
        store
            .set("provider:p_01:api-key", "sk-value")
            .expect("set must succeed");
        assert_eq!(
            store
                .resolve("provider:p_01:api-key")
                .expect("resolve must succeed"),
            Some("sk-value".to_string())
        );
        assert_eq!(
            store
                .resolve("provider:p_01:absent")
                .expect("resolve must succeed"),
            None
        );
    }

    /// 跨运行时一致性门禁的最小实例。
    ///
    /// fixture 由 `@mahoshojo/contracts` 持有，Rust 侧在编译期读入，因此两侧不可能
    /// 在对方不知情的情况下改动规则（见 `SPEC-desktop-client-v1` DESK-033）。
    #[test]
    fn secret_ref_rules_match_the_shared_typescript_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/desktop-secret-refs.json"
        ))
        .expect("shared fixture must be valid JSON");

        assert_eq!(
            fixture["maxRefLength"].as_u64(),
            Some(MAX_SECRET_REF_LENGTH as u64),
            "shared fixture and Rust ceiling must agree"
        );

        for secret_ref in fixture["validRefs"]
            .as_array()
            .expect("validRefs must be an array")
        {
            let secret_ref = secret_ref
                .as_str()
                .expect("validRefs entries must be strings");
            assert!(
                validate_secret_ref(secret_ref).is_ok(),
                "fixture marks {secret_ref:?} valid but Rust rejected it"
            );
        }

        for secret_ref in fixture["invalidRefs"]
            .as_array()
            .expect("invalidRefs must be an array")
        {
            let secret_ref = secret_ref
                .as_str()
                .expect("invalidRefs entries must be strings");
            assert!(
                validate_secret_ref(secret_ref).is_err(),
                "fixture marks {secret_ref:?} invalid but Rust accepted it"
            );
        }
    }

    /// 真实操作系统凭据存储往返。
    ///
    /// 默认 `#[ignore]`：Linux CI 没有可用的 Secret Service 会话，直接跑会让门禁变成
    /// 随机失败。本地验证命令：
    ///
    /// ```text
    /// pnpm --filter @mahoshojo/desktop run check:rust -- --ignored
    /// ```
    #[test]
    #[ignore = "requires a real operating system credential store session"]
    fn operating_system_credential_store_roundtrip() {
        let store = CredentialStore::new();
        let secret_ref = "provider:d0-5-probe:api-key";

        store.delete(secret_ref).expect("pre-clean must succeed");
        assert_absent(&store, secret_ref);

        store
            .set(secret_ref, "probe-secret-value")
            .expect("operating system credential store must accept a write");
        assert_present(&store, secret_ref);

        store.delete(secret_ref).expect("delete must succeed");
        assert_absent(&store, secret_ref);
        store
            .delete(secret_ref)
            .expect("delete must stay idempotent");
    }
}
