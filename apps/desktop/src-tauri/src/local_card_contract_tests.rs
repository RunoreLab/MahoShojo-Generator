//! `packages/contracts` 的 Desktop IPC fixture 断言（D2.0）。
//!
//! 契约的 TypeScript 权威实现在 `packages/contracts/src/desktop-ipc.ts`；Rust 侧镜像其中的
//! 常量与枚举。两边**MUST** 读同一份 fixture，任一侧改了形状而未更新 fixture 都必须失败
//! （`SPEC-desktop-client-v1` DESK-033）。
//!
//! 这里刻意不做"解析 fixture 再喂给自己的函数"式的空转：断言的是 Rust 常量与 fixture 的
//! 具体取值相等，因此一侧改动会立刻让另一侧的红。

use serde::Deserialize;

use crate::local_card::{MAX_LOCAL_CARD_DOCUMENT_BYTES, MAX_LOCAL_CARD_PAGE_SIZE};
use crate::store::StoreError;

const FIXTURE: &str =
    include_str!("../../../../packages/contracts/fixtures/desktop-local-cards.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    limits: Limits,
    error_codes: Vec<String>,
    card_types: Vec<String>,
    blob_error_codes: Vec<String>,
    blob_write_outcomes: Vec<String>,
    max_package_archive_bytes: usize,
    web_package_index: WebPackageIndexFixture,
    web_package_identity: WebPackageIdentityFixture,
    blob_archive: BlobArchiveFixture,
    valid_index: ValidIndex,
    tombstoned_index: TombstonedIndex,
    cursor: Cursor,
    timestamp_cases: Vec<TimestampCase>,
    cases: Vec<FixtureCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebPackageIndexFixture {
    id: String,
    updated_at: String,
    content_digest: String,
    #[allow(dead_code)]
    #[serde(default)]
    deleted_at: Option<String>,
}

/// canonical identity 的成对取值。
///
/// native **不**重算 id 派生规则（它的权威在 `@mahoshojo/local-library`）。这里断言的是
/// "契约包里的 id 与摘要是同一个身份"：id 必须是 `wp_` 形式、摘要必须是 `sha256:` 形式，
/// 且 fixture 的索引列与本结构一致。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebPackageIdentityFixture {
    id: String,
    content_digest: String,
}

/// base64 传输信封。
///
/// `$case` 是给人看的说明，serde 直接忽略即可。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobArchiveFixture {
    b64: String,
    len: usize,
}

/// 带 UTC offset 的时间戳用例。
///
/// 契约允许任意 offset，因此 native **MUST** 按时刻而非文本排序。这三条把三个最容易
/// 互相搞混的方向各自钉住：文本更大但更早、文本更小但更晚、同一时刻不同 offset。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimestampCase {
    #[allow(dead_code)]
    name: String,
    id: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Limits {
    max_document_bytes: usize,
    max_page_size: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidIndex {
    id: String,
    card_type: String,
    updated_at: String,
    content_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TombstonedIndex {
    #[allow(dead_code)]
    id: String,
    deleted_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cursor {
    updated_at: String,
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    name: String,
    index: CaseIndex,
    document: String,
    #[serde(default)]
    expect_reject: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseIndex {
    id: String,
    card_type: String,
    updated_at: String,
    deleted_at: Option<String>,
    content_digest: String,
}

fn parse() -> Fixture {
    serde_json::from_str(FIXTURE).expect("fixture must be valid JSON")
}

#[test]
fn limits_match_the_typescript_authority() {
    let fixture = parse();
    assert_eq!(
        MAX_LOCAL_CARD_DOCUMENT_BYTES,
        fixture.limits.max_document_bytes
    );
    assert_eq!(MAX_LOCAL_CARD_PAGE_SIZE, fixture.limits.max_page_size);
}

#[test]
fn error_codes_match_the_typescript_authority_in_a_stable_order() {
    let fixture = parse();
    let ours: Vec<&str> = [
        StoreError::Unavailable,
        StoreError::InvalidDocument,
        StoreError::DocumentTooLarge,
        StoreError::IndexMismatch,
        StoreError::Tombstoned,
        StoreError::TransitionMismatch,
        StoreError::RecordMissing,
        StoreError::NonMonotonicTimestamp,
        StoreError::InvalidQuery,
        StoreError::Failure,
    ]
    .iter()
    .map(|error| error.code())
    .collect();

    assert_eq!(
        ours,
        fixture
            .error_codes
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        "错误码集合或顺序与契约不一致"
    );
}

/// fixture 里的 offset 时间戳必须被 native 解析成**正确时刻**，而不是按文本比较。
///
/// 三条用例一起钉住三个方向：文本更大但更早、文本更小但更晚、同一时刻不同 offset。
/// 只测其中一条会漏掉"把排序键当成字符串"或"把相等当成回退"这两类错误。
#[test]
fn every_fixture_timestamp_resolves_to_the_instant_it_denotes() {
    let fixture = parse();
    assert!(
        fixture.timestamp_cases.len() >= 3,
        "fixture 必须覆盖三类 offset 时间戳用例"
    );

    let store = crate::local_card::LocalCardStore::open_in_memory()
        .expect("in-memory card store must open");

    let mut observed: Vec<(String, i64)> = Vec::new();
    for case in &fixture.timestamp_cases {
        let (document, index) = build_card(&case.id, &case.updated_at);
        store
            .put(&document, &index)
            .unwrap_or_else(|error| panic!("用例「{}」必须被接受，实际 {error:?}", case.name));
        let sort = crate::local_card::sort_key_for_test(&case.updated_at)
            .unwrap_or_else(|| panic!("用例「{}」的时间戳必须可解析", case.name));
        observed.push((case.id.clone(), sort));
    }

    // 12:00+14:00 == 前一天 22:00Z，早于 01:00Z；15:00+14:00 == 01:00Z，与之同一时刻。
    let by_id: std::collections::HashMap<&str, i64> = observed
        .iter()
        .map(|(id, sort)| (id.as_str(), *sort))
        .collect();
    let text_later = by_id["lc_ts_text_later"];
    let text_smaller = by_id["lc_ts_text_smaller"];
    let same_instant = by_id["lc_ts_same_instant"];

    assert!(
        text_later < text_smaller,
        "文本更大的那个必须解析为更早的时刻"
    );
    assert_eq!(
        same_instant, text_smaller,
        "同一时刻的不同 offset 必须解析为相同的排序键"
    );

    // 排序键相等不得被判为时间回退。
    let (document, index) = build_card("lc_ts_text_smaller", "2026-09-30T01:00:00Z");
    assert_eq!(store.put(&document, &index), Ok(()), "排序键相等不算回退");
}

/// 造一条最小可用的 document 与配套索引列，供 fixture 用例复用。
fn build_card(id: &str, updated_at: &str) -> (String, crate::local_card::LocalCardIndex) {
    let document = format!(
        r#"{{"id":"{id}","schemaVersion":1,"storageLocation":"local","cardType":"character","title":"t","data":{{}},"contentDigest":"sha256:{}","provenance":{{"kind":"unsigned","execution":"imported"}},"createdAt":"{updated_at}","updatedAt":"{updated_at}"}}"#,
        "a".repeat(64)
    );
    let index = crate::local_card::LocalCardIndex {
        id: id.to_string(),
        card_type: "character".to_string(),
        updated_at: updated_at.to_string(),
        deleted_at: None,
        content_digest: format!("sha256:{}", "a".repeat(64)),
    };
    (document, index)
}

#[test]
fn card_types_match_the_online_data_card_types() {
    let fixture = parse();
    assert_eq!(
        fixture.card_types,
        vec!["character", "scenario", "history", "questionnaire"],
    );
}

#[test]
fn a_fixtures_index_survives_the_round_trip_through_our_own_type() {
    let fixture = parse();
    let index = crate::local_card::LocalCardIndex {
        id: fixture.valid_index.id.clone(),
        card_type: fixture.valid_index.card_type.clone(),
        updated_at: fixture.valid_index.updated_at.clone(),
        deleted_at: None,
        content_digest: fixture.valid_index.content_digest.clone(),
    };

    let json = serde_json::to_value(&index).expect("index must serialize");
    let parsed: crate::local_card::LocalCardIndex =
        serde_json::from_value(json).expect("index must deserialize");
    assert_eq!(parsed, index, "LocalCardIndex 的 camelCase 形状必须稳定");

    // 契约声明 deletedAt 可选，Rust 侧必须能接受"带 tombstone"与"不带"两种形态。
    let tombstoned: crate::local_card::LocalCardIndex = serde_json::from_value(serde_json::json!({
        "id": fixture.tombstoned_index.id,
        "cardType": "character",
        "updatedAt": "2026-09-30T12:00:00.000Z",
        "deletedAt": fixture.tombstoned_index.deleted_at,
        "contentDigest": fixture.valid_index.content_digest,
    }))
    .expect("tombstoned index must deserialize");
    assert_eq!(
        tombstoned.deleted_at.as_deref(),
        Some("2026-09-30T13:00:00.000Z")
    );
}

#[test]
fn a_cursor_round_trips_through_our_own_type() {
    let fixture = parse();
    let cursor = crate::local_card::LocalCardCursor {
        updated_at_sort: 0,
        updated_at: fixture.cursor.updated_at.clone(),
        id: fixture.cursor.id.clone(),
    };
    let json = serde_json::to_value(&cursor).expect("cursor must serialize");
    let parsed: crate::local_card::LocalCardCursor =
        serde_json::from_value(json).expect("cursor must deserialize");
    assert_eq!(parsed, cursor);
}

/// fixture 里的每条用例都必须能被 native 侧按声明的方式处理。
///
/// 这条断言的实际价值在 `expect_reject` 那条：它证明"索引列与 document 不一致"在真实
/// 文档上确实被拒绝，而不只是单元测试里构造的形状被拒绝。
#[test]
fn every_fixture_case_behaves_as_declared() {
    let fixture = parse();
    assert!(!fixture.cases.is_empty(), "fixture 必须至少包含一条用例");

    for case in &fixture.cases {
        let store = crate::local_card::LocalCardStore::open_in_memory()
            .expect("in-memory card store must open");
        let index = crate::local_card::LocalCardIndex {
            id: case.index.id.clone(),
            card_type: case.index.card_type.clone(),
            updated_at: case.index.updated_at.clone(),
            deleted_at: case.index.deleted_at.clone(),
            content_digest: case.index.content_digest.clone(),
        };

        let outcome = store.put(&case.document, &index);
        if case.expect_reject {
            assert_eq!(
                outcome,
                Err(StoreError::IndexMismatch),
                "用例「{}」声明应被拒绝，但结果不同",
                case.name
            );
        } else {
            assert_eq!(outcome, Ok(()), "用例「{}」声明应被接受", case.name);
            assert_eq!(
                store.get(&index.id).expect("get must succeed"),
                Some(case.document.clone()),
                "用例「{}」必须逐字节往返",
                case.name
            );
        }
    }
}

/// 归档大小上限与 TypeScript 侧常量相等。
#[test]
fn blob_limits_match_the_typescript_authority() {
    let fixture = parse();
    assert_eq!(
        crate::blob::MAX_BLOB_BYTES,
        fixture.max_package_archive_bytes
    );
}

/// blob 错误码与写入结果的集合、顺序都与 TypeScript 侧一致。
///
/// 顺序也要比：`zod` 的 `z.enum` 与这里的 `code()` 逐个对应，顺序变了说明有一侧加了新码而
/// 另一侧没加。
#[test]
fn blob_error_codes_and_outcomes_match_the_typescript_authority_in_a_stable_order() {
    let fixture = parse();
    let actual_codes: Vec<&str> = [
        crate::blob::BlobError::Unavailable,
        crate::blob::BlobError::DigestMismatch,
        crate::blob::BlobError::Corrupt {
            digest: String::new(),
        },
        crate::blob::BlobError::TooLarge,
        crate::blob::BlobError::NotFound,
        crate::blob::BlobError::Failure,
    ]
    .iter()
    .map(|error| error.code())
    .collect();
    assert_eq!(actual_codes, fixture.blob_error_codes);

    // 写入结果的线上取值由 serde 的 camelCase 决定。这里刻意走序列化而不是另写一个
    // `code()`——那会制造第二处真值来源，而两处迟早会对不上。
    let actual_outcomes: Vec<serde_json::Value> = [
        crate::blob::BlobWriteOutcome::Stored,
        crate::blob::BlobWriteOutcome::AlreadyPresent,
        crate::blob::BlobWriteOutcome::Repaired,
    ]
    .iter()
    .map(|outcome| serde_json::to_value(outcome).expect("写入结果必须可序列化"))
    .collect();
    let expected_outcomes: Vec<serde_json::Value> = fixture
        .blob_write_outcomes
        .iter()
        .map(|code| serde_json::Value::String(code.clone()))
        .collect();
    assert_eq!(actual_outcomes, expected_outcomes);
}

/// fixture 里的 base64 载荷能被**我们自己的**解码器还原成声明的长度与 ZIP 魔数。
///
/// 这是两侧最危险的一处耦合：载荷由 TypeScript 编码、由 native 解码。若只比较字符串，两侧
/// 会一起通过一个解不开的 fixture——曾经就出现过声明 4 字节而实际解出 5 字节的情况。
/// 这里让 native 用自己的解码器跑一遍，并把长度与魔数都钉住。
#[test]
fn the_shared_base64_payload_decodes_through_our_own_decoder() {
    let fixture = parse();
    let decoded = crate::base64_bytes::Base64Bytes {
        b64: fixture.blob_archive.b64.clone(),
        len: fixture.blob_archive.len,
    }
    .decode()
    .expect("fixture 的 base64 载荷必须能被 native 解码");
    assert_eq!(
        decoded.len(),
        fixture.blob_archive.len,
        "解码长度必须与声明一致，否则失败点会被推到解包器里"
    );
    assert_eq!(&decoded[..4], b"PK\x03\x04", "载荷的语义是一个 ZIP");
}

/// canonical identity 在两侧是同一对取值，且形状是 `wp_…` 对 `sha256:…`。
#[test]
fn the_shared_canonical_identity_is_one_pair_in_two_halves() {
    let fixture = parse();
    let identity = &fixture.web_package_identity;
    assert_eq!(identity.id, fixture.web_package_index.id);
    assert_eq!(
        identity.content_digest,
        fixture.web_package_index.content_digest
    );
    // 两个键不可互换：读档入口以摘要为键，把 `wp_…` 当摘要查必然落空。
    assert!(
        identity.id.starts_with("wp_"),
        "包 id 必须是 wp_ 形式，实际 {:?}",
        identity.id
    );
    assert!(
        identity.content_digest.starts_with("sha256:"),
        "内容摘要必须是 sha256: 形式，实际 {:?}",
        identity.content_digest
    );
    assert_ne!(identity.id, identity.content_digest);
    // 派生规则本身由 TS 权威实现（deriveLocalWebPackageId），native 只做 UNIQUE 存储约束，
    // 因此这里断言形状而不复算派生。
    assert_eq!(identity.id.len(), "wp_".len() + 32);
    assert_eq!(identity.content_digest.len(), "sha256:".len() + 64);
}

/// fixture 里的 Web 包索引能通过我们自己的类型，且**线上字段名**与契约一致。
///
/// 只做 Rust 侧的往返是不够的：字段一旦改名（例如 `ref_digest` 被 camelCase 成 `refDigest`），
/// Rust 自己的往返照样通过，而渲染层发来的 `contentDigest` 会静默对不上——IPC 在用户导入
/// Web 包时才失败。因此这里断言完整的字段名集合。
#[test]
fn a_fixtures_web_package_index_survives_the_round_trip_through_our_own_type() {
    let fixture = parse();
    let index = crate::web_package::WebPackageIndex {
        id: fixture.web_package_index.id.clone(),
        updated_at: fixture.web_package_index.updated_at.clone(),
        deleted_at: fixture.web_package_index.deleted_at.clone(),
        content_digest: fixture.web_package_index.content_digest.clone(),
    };
    let wire = serde_json::to_value(&index).expect("索引必须可序列化");
    assert_eq!(wire["id"], fixture.web_package_index.id);
    assert_eq!(
        wire["contentDigest"],
        fixture.web_package_index.content_digest
    );
    // 字段名集合必须恰好是契约里的那三个加一个可选 tombstone。
    let mut keys: Vec<&str> = wire
        .as_object()
        .expect("索引必须是对象")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["contentDigest", "deletedAt", "id", "updatedAt"]);
    assert_eq!(
        serde_json::from_value::<crate::web_package::WebPackageIndex>(wire)
            .expect("索引必须可反序列化"),
        index
    );
}
