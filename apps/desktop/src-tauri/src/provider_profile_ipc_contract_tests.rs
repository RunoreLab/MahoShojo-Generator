//! Bridge 与真正 command 共用的 wire fixture；函数指针约束禁止 mock 擅改参数类型。
use serde_json::Value;
use tauri::State;

use crate::library::LocalLibrary;
use crate::provider_profile::{DirectProviderExecutionProfile, ProviderProfileError};
use crate::store::{LocalStore, LocalStorePaths, StoreError};

const FIXTURE: &str =
    include_str!("../../../../packages/contracts/fixtures/desktop-provider-profile-ipc.json");

#[test]
fn actual_profile_command_signatures_match_string_wire() {
    let _: fn(String) -> Result<DirectProviderExecutionProfile, ProviderProfileError> =
        crate::validate_provider_execution_profile;
    let _: fn(State<'_, LocalLibrary>, String, String) -> Result<(), StoreError> =
        crate::save_provider_profile;
    let _: fn(State<'_, LocalLibrary>, String) -> Result<Option<String>, StoreError> =
        crate::get_provider_profile;
}

#[test]
fn actual_validator_echo_matches_bridge_fixture_without_null_optionals() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let input: String =
        serde_json::from_value(fixture["validate"]["args"]["document"].clone()).unwrap();
    let echoed = crate::validate_provider_execution_profile(input).unwrap();
    assert_eq!(
        serde_json::to_value(echoed).unwrap(),
        fixture["validate"]["response"]
    );
    let mut minimal = fixture["validate"]["response"].clone();
    for key in ["apiKeyRef", "publicHeaders", "secretHeaderRefs"] {
        minimal.as_object_mut().unwrap().remove(key);
    }
    let echoed = crate::validate_provider_execution_profile(minimal.to_string()).unwrap();
    assert_eq!(serde_json::to_value(echoed).unwrap(), minimal);
    // Tauri's String deserializer rejects the former TS object payload before executing the command.
    assert!(serde_json::from_value::<String>(fixture["validate"]["response"].clone()).is_err());
    let mut with_transport = fixture["validate"]["response"].clone();
    with_transport["transport"] = serde_json::json!({"allowPublicHttp": false});
    let echoed = crate::validate_provider_execution_profile(with_transport.to_string()).unwrap();
    assert_eq!(serde_json::to_value(echoed).unwrap(), with_transport);
}

#[test]
fn persisted_document_remains_a_json_string_after_store_restart() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let document: String =
        serde_json::from_value(fixture["save"]["args"]["document"].clone()).unwrap();
    let identity =
        crate::provider_profile::StoredProviderProfileIdentity::parse(&document).unwrap();
    let root = tempfile::tempdir().unwrap();
    let paths = LocalStorePaths::under(root.path());
    {
        let store = LocalStore::open(&paths).unwrap();
        store
            .put(
                &identity.id,
                &document,
                fixture["save"]["args"]["updatedAt"].as_str().unwrap(),
            )
            .unwrap();
    }
    let reopened = LocalStore::open(&paths).unwrap();
    assert_eq!(
        serde_json::to_value(reopened.get(&identity.id).unwrap()).unwrap(),
        fixture["get"]["response"]
    );
    assert_eq!(
        serde_json::to_value(reopened.get("missing").unwrap()).unwrap(),
        fixture["missingResponse"]
    );
}
