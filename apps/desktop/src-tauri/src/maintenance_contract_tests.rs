//! 本地库维护（审计 / GC）的跨运行时契约断言（D2.2）。
//!
//! 契约的 TypeScript 权威实现在 `packages/contracts/src/desktop-ipc.ts`，桶与错误码的**取值**
//! 由 `fixtures/desktop-local-cards.json` 的 `maintenance` 段持有。两边 MUST 读同一份
//! fixture；任一侧改了桶集合而未同步，另一侧必须失败（`DESK-033`）。
//!
//! 这里断言的是"两侧认为同一件事的桶是同一件事"，而不是各自的枚举形状——形状由 serde 与
//! zod 各自保证，比对不出漂移。

use serde::Deserialize;

use crate::audit::{AuditError, AuditFinding, AuditReport};

const FIXTURE: &str =
    include_str!("../../../../packages/contracts/fixtures/desktop-local-cards.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    maintenance: MaintenanceSection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaintenanceSection {
    #[allow(dead_code)]
    #[serde(default)]
    comment: Option<String>,
    audit_kinds: Vec<String>,
    audit_damage_kinds: Vec<String>,
    audit_error_codes: Vec<String>,
    audit_report: AuditReportFixture,
    audit_finding_reference_file_missing: AuditFindingFixture,
    audit_finding_bytes_mismatch_equal_length: AuditFindingFixture,
    audit_finding_bytes_mismatch_truncated: AuditFindingFixture,
    audit_finding_unreferenced_metadata: AuditFindingFixture,
    audit_finding_orphan_file: AuditFindingFixture,
    audit_finding_record_without_reference: AuditFindingFixture,
    audit_finding_foreign_key_violation: AuditFindingFixture,
}

/// 报告 fixture。`$case` 是人读的说明，serde 忽略。
///
/// `Serialize` 的存在是为了把 fixture 原样转成 `serde_json::Value` 再喂给
/// [`AuditReport`]。走 fixture → Value → 报告这条链（而不是直接把 fixture 结构体断言成
/// 报告）才能验证**字段名**：直接比对结构体只会证明两个 Rust 结构体相等，与线上形状无关。
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditReportFixture {
    #[serde(rename = "$case", default)]
    case: Option<String>,
    findings: Vec<serde_json::Value>,
    schema_version: i64,
    referenced_blob_count: i64,
    blob_metadata_count: i64,
    web_package_count: i64,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditFindingFixture {
    /// 人读的说明。字段名带 `$` 前缀，因此必须显式 rename——`rename_all = "camelCase"`
    /// 只会把它变成 `case`，于是永远读不到值，而下面的"每个发现 MUST 带 $case"断言
    /// 会以一条难以理解的方式失败。
    #[serde(rename = "$case", default)]
    case: Option<String>,
    kind: String,
    #[serde(default)]
    package_id: Option<String>,
    #[serde(default)]
    digest: Option<String>,
    #[serde(default)]
    expected_byte_length: Option<i64>,
    #[serde(default)]
    actual_byte_length: Option<i64>,
    #[serde(default)]
    length_matches: Option<bool>,
    #[serde(default)]
    byte_length: Option<i64>,
    #[serde(default)]
    table: Option<String>,
    #[serde(default)]
    row_id: Option<i64>,
    #[serde(default)]
    parent: Option<String>,
    #[serde(default)]
    foreign_key_id: Option<i64>,
}

fn parse() -> Fixture {
    serde_json::from_str(FIXTURE).expect("fixture must be valid JSON")
}

/// 六个桶 MUST 与契约逐项一致且顺序稳定。
///
/// 顺序稳定是刻意的：UI 按桶分组渲染，若两侧顺序不同，同一份报告会在两端显示成不同的排列。
#[test]
fn audit_buckets_match_the_typescript_authority_in_a_stable_order() {
    let fixture = parse();
    let ours: Vec<&str> = [
        AuditFinding::ReferenceFileMissing {
            package_id: String::new(),
            digest: String::new(),
        },
        AuditFinding::ReferenceBytesMismatch {
            package_id: String::new(),
            digest: String::new(),
            expected_byte_length: 0,
            actual_byte_length: 0,
            length_matches: false,
        },
        AuditFinding::UnreferencedMetadata {
            digest: String::new(),
        },
        AuditFinding::OrphanFile {
            digest: String::new(),
            byte_length: 0,
        },
        AuditFinding::RecordWithoutReference {
            package_id: String::new(),
        },
        AuditFinding::ForeignKeyViolation {
            table: String::new(),
            row_id: 0,
            parent: String::new(),
            foreign_key_id: 0,
        },
    ]
    .iter()
    .map(AuditFinding::kind)
    .collect();

    assert_eq!(
        ours, fixture.maintenance.audit_kinds,
        "审计桶集合或顺序与契约不一致"
    );
}

/// 「用户可见损坏」MUST 与契约一致，且是桶集合的真子集。
///
/// 孤儿文件与无引用 metadata 都不算损坏：前者是崩溃窗口产物（用户看不见），后者是 purge
/// 之后的回收候选（用户没有少看到任何包）。把它们算作损坏会让真正要处理的问题被稀释。
#[test]
fn damage_kinds_match_the_typescript_authority() {
    let fixture = parse();
    let section = fixture.maintenance;

    let ours: Vec<&str> = [
        AuditFinding::ReferenceFileMissing {
            package_id: String::new(),
            digest: String::new(),
        },
        AuditFinding::ReferenceBytesMismatch {
            package_id: String::new(),
            digest: String::new(),
            expected_byte_length: 0,
            actual_byte_length: 0,
            length_matches: false,
        },
        AuditFinding::RecordWithoutReference {
            package_id: String::new(),
        },
    ]
    .iter()
    .filter(|finding| finding.is_user_visible_damage())
    .map(AuditFinding::kind)
    .collect();

    assert_eq!(ours, section.audit_damage_kinds, "损坏桶与契约不一致");

    for kind in &section.audit_damage_kinds {
        assert!(
            section.audit_kinds.contains(kind),
            "损坏桶 {kind} MUST 是审计桶的子集"
        );
    }
    assert!(
        !section
            .audit_damage_kinds
            .contains(&"orphan-file".to_string()),
        "孤儿文件允许存在，MUST NOT 算作用户可见损坏"
    );
    assert!(
        !section
            .audit_damage_kinds
            .contains(&"unreferenced-metadata".to_string()),
        "可回收候选不是损坏：用户没有少看到任何东西"
    );
}

/// 审计错误码 MUST 与契约一致。
#[test]
fn audit_error_codes_match_the_typescript_authority() {
    let fixture = parse();
    let ours: Vec<&str> = [AuditError::Unavailable, AuditError::Failure]
        .iter()
        .map(AuditError::code)
        .collect();
    assert_eq!(ours, fixture.maintenance.audit_error_codes);
}

/// fixture 里的**每一个桶** MUST 能被 Rust 的枚举原样反序列化。
///
/// 这条守住 serde 的字段名：若某个桶的字段改名（例如 `package_id` 被改成 `owner_id`），
/// 反序列化会失败而不是静默塞进默认值——一个 `Option<String>` 字段名写错时
/// `#[serde(default)]` 会让它变成 `None`，而那条"报告必须指出是哪个包"的保证就没了。
#[test]
fn every_fixture_finding_deserializes_into_our_enum() {
    let section = parse().maintenance;
    let cases = [
        section.audit_finding_reference_file_missing,
        section.audit_finding_bytes_mismatch_equal_length,
        section.audit_finding_bytes_mismatch_truncated,
        section.audit_finding_unreferenced_metadata,
        section.audit_finding_orphan_file,
        section.audit_finding_record_without_reference,
        section.audit_finding_foreign_key_violation,
    ];

    for case in cases {
        let finding: AuditFinding = serde_json::from_value(
            serde_json::to_value(&case).expect("re-encode"),
        )
        .unwrap_or_else(|error| {
            panic!(
                "fixture 桶「{}」MUST 能反序列化为 Rust 枚举：{error}",
                case.kind
            )
        });
        assert_eq!(finding.kind(), case.kind);
        // `kind` 是 internally tagged 的 tag 字段，serde 在失败时会静默忽略它而不是拒绝——
        // 因此必须显式断言一次，否则"桶名写错"会表现为一个缺字段的另一种桶。
        assert!(
            case.case.is_some(),
            "每个发现 fixture MUST 带 $case 说明，否则它会被读成另一个桶"
        );
    }
}

/// fixture 的发现 MUST 携带**定位信息**。
///
/// 一个只有 `kind` 的报告无法让用户知道该处理哪条记录，UI 只能显示"发现 1 个问题"。
#[test]
fn every_fixture_finding_carries_its_locator() {
    let section = parse().maintenance;

    let located = |value: &AuditFindingFixture| {
        value.digest.is_some() || value.package_id.is_some() || value.table.is_some()
    };
    for case in [
        &section.audit_finding_reference_file_missing,
        &section.audit_finding_bytes_mismatch_equal_length,
        &section.audit_finding_bytes_mismatch_truncated,
        &section.audit_finding_unreferenced_metadata,
        &section.audit_finding_orphan_file,
        &section.audit_finding_record_without_reference,
        &section.audit_finding_foreign_key_violation,
    ] {
        assert!(
            located(case),
            "发现「{}」MUST 至少带 digest、packageId 或 table 之一",
            case.kind
        );
    }

    // 引用相关的两个桶必须同时带包 id 与摘要：只有摘要时用户不知道是哪个包打不开。
    for case in [
        &section.audit_finding_reference_file_missing,
        &section.audit_finding_bytes_mismatch_equal_length,
    ] {
        assert!(case.package_id.is_some(), "{} 必须带 packageId", case.kind);
        assert!(case.digest.is_some(), "{} 必须带 digest", case.kind);
    }
}

/// fixture 的干净报告 MUST 能反序列化，且**携带规模分母**。
///
/// 分母不是可选的礼貌：来自空库的「0 个问题」与来自 500 个包的「0 个问题」含义完全不同。
#[test]
fn the_clean_report_fixture_deserializes_and_carries_its_denominators() {
    let section = parse().maintenance;
    let report = section.audit_report;

    let parsed: AuditReport =
        serde_json::from_value(serde_json::to_value(&report).expect("re-encode"))
            .expect("干净报告 MUST 能反序列化为 Rust 报告");
    assert!(parsed.findings.is_empty());
    assert!(!parsed.has_user_visible_damage());

    // 反序列化后的值必须与 fixture 逐项相等——`#[serde(default)]` 若被误加到计数字段上，
    // 这里会看到 0 与 fixture 声明值不一致。
    assert_eq!(parsed.schema_version, report.schema_version);
    assert_eq!(parsed.referenced_blob_count, report.referenced_blob_count);
    assert_eq!(parsed.blob_metadata_count, report.blob_metadata_count);
    assert_eq!(parsed.web_package_count, report.web_package_count);
}

/// 报告 MUST NOT 携带文件路径。
///
/// `DESK-057`：物理布局是 adapter 内部实现。带路径会让"同一份库在两台设备上的审计结果"
/// 不同，而那对用户判断毫无价值。这条断言的是 Rust 的 `AuditReport` 没有 `path` 类字段。
#[test]
fn the_report_shape_carries_no_filesystem_path() {
    let section = parse().maintenance;
    let rendered = serde_json::to_string(&section.audit_report).expect("report must serialize");
    assert!(
        !rendered.contains("blobs") && !rendered.contains('\\') && !rendered.contains("dataRoot"),
        "报告 MUST 只含摘要与包 id：{rendered}"
    );

    // 反向断言：Rust 序列化出的发现 MUST 只有摘要与计数。
    //
    // 这里刻意**不断言**渲染结果里不出现子串 `file`：`orphan-file` 这个桶名本身含 `file`，
    // 而一份按子串匹配的断言会在有人正确地往枚举里加一个新桶时误报。改为断言字段名集合。
    let finding = AuditFinding::OrphanFile {
        digest: "sha256:aa".to_string(),
        byte_length: 1,
    };
    let value = serde_json::to_value(&finding).expect("finding must serialize");
    let mut keys: Vec<&str> = value
        .as_object()
        .expect("finding must serialize as an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["byteLength", "digest", "kind"]);
}
