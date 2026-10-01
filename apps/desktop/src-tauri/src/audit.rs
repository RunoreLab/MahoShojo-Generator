//! 完整性审计（D2.2b）。
//!
//! 按 `DESK-066` 分桶，**只报告不修复**。修复只发生在下一次写入的自愈路径上
//! （`DESK-056`）——审计擅自"顺手修好"会让用户在报告里失去对库状态的判断依据：
//! 一份说"有问题"的报告比一份说"我替你修了"的报告有用得多。
//!
//! ## 六个桶，以及第五个为什么单列
//!
//! ```text
//! referenced-file-missing        引用存在，文件不在
//! referenced-bytes-mismatch      引用存在，摘要或长度与 metadata 不符
//! unreferenced-metadata          有 metadata，无任何引用（可回收候选）
//! orphan-file                    有文件，无 metadata（崩溃窗口产物，允许存在）
//! record-without-reference       包记录存在，没有引用行
//! foreign-key-violation         PRAGMA foreign_key_check
//! ```
//!
//! 第五桶单列的原因：外键方向是 `web_package_archive_ref` → `local_web_package`，
//! 因此数据库**不**约束"每个包记录都必须有引用行"。缺引用行的包对用户表现为"打不开"
//! （`readArchive` 返回 `null`），与真正的字节损坏无法区分——现有五桶都装不下它。
//!
//! ## 为什么跑 `quick_check` 不算加分
//!
//! `PRAGMA integrity_check`（O(N log N)，额外验证索引与 UNIQUE）与 `quick_check`（O(N)）
//! 回答的是"SQLite 文件本身是否损坏"，而上述六桶回答的是"本地库的不变量是否成立"。
//! 前者是引擎问题、后者是我们的不变量；把前者混进来会让桶的含义从本地库语义滑向引擎
//! 健壮性，也让一次慢得多的全表扫描在每次审计里都发生。V1 因此不纳入（`DESK-066`）。
//!
//! ## 为什么审计必须持有维护窗口
//!
//! 单独一次 SQL 查询是原子的，但"读 metadata → 读文件 → 读 metadata"不是。若 save
//! 落在中间，一次审计会报出一个"metadata 在、文件不在"的假损坏桶，而用户据此去恢复数据
//! 只会发现什么都没有。窗口让整次观察落在同一个临界区内。

use std::path::PathBuf;

use serde::Serialize;

use crate::blob::{blob_path, digest_of, BlobPaths, BlobStore};
use crate::store::{lock_connection, StoreError};

/// 审计的一个发现。
///
/// `kind` 是桶，`digest` / `packageId` 是定位信息。刻意**不**携带文件路径：那既是内部布局
/// （`DESK-057`：物理布局不进契约），也会让报告在跨设备对比时带上本机目录名。
// `Deserialize` 不是为了读 native 自己产出的报告，而是让 Rust 侧能消费**同一份 fixture**
// （DESK-033）：序列化与反序列化走同一份字段名，因此改错字段名会在编译或测试期立刻失败，
// 而不是产出一份 UI 读不出 `packageId` 的报告。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(
    rename_all = "kebab-case",
    tag = "kind",
    rename_all_fields = "camelCase"
)]
pub enum AuditFinding {
    /// 引用行存在，但它指向的 blob 文件不在磁盘上。
    ///
    /// 这是**损坏**，不是孤儿：用户在界面上仍看得见这个包，但点开打不开。
    ReferenceFileMissing { package_id: String, digest: String },
    /// 文件在，但重算的摘要或长度与 metadata 不符。
    ///
    /// 与上一桶分开：症状都是"打不开"，但成因不同——一个是文件被清理工具或磁盘故障删掉，
    /// 一个是被改写或位翻转。自愈路径只对后一类有效（`DESK-056`）。
    ReferenceBytesMismatch {
        package_id: String,
        digest: String,
        /// metadata 声称的长度。
        expected_byte_length: i64,
        /// 磁盘上的实际长度。
        actual_byte_length: i64,
        /// 实际长度是否也一致。两个字段分开报告，让 UI 能区分"被截断"与"内容不同但等长"。
        length_matches: bool,
    },
    /// 有 metadata，无任何引用。可回收候选。
    UnreferencedMetadata { digest: String },
    /// 有文件，无 metadata。崩溃窗口产物，**允许存在**。
    OrphanFile { digest: String, byte_length: i64 },
    /// 包记录存在但没有引用行。外键方向允许这种状态。
    RecordWithoutReference { package_id: String },
    /// `PRAGMA foreign_key_check` 报出的违规。
    ForeignKeyViolation {
        table: String,
        row_id: i64,
        parent: String,
        foreign_key_id: i64,
    },
}

impl AuditFinding {
    /// 桶标识。UI 按它分组。
    #[allow(dead_code, reason = "D2.2b 之后由渲染层与 command 分组消费")]
    pub fn kind(&self) -> &'static str {
        match self {
            AuditFinding::ReferenceFileMissing { .. } => "reference-file-missing",
            AuditFinding::ReferenceBytesMismatch { .. } => "reference-bytes-mismatch",
            AuditFinding::UnreferencedMetadata { .. } => "unreferenced-metadata",
            AuditFinding::OrphanFile { .. } => "orphan-file",
            AuditFinding::RecordWithoutReference { .. } => "record-without-reference",
            AuditFinding::ForeignKeyViolation { .. } => "foreign-key-violation",
        }
    }

    /// 该发现是否代表**用户可见的损坏**。
    ///
    /// 孤儿文件不算：它在崩溃窗口里产生、被引用表完全看不见，用户也不会因此少看到任何
    /// 一个包。把它和真损坏混在一处会让"需要处理"这个判断失去意义。
    #[allow(dead_code, reason = "D2.2b 之后由渲染层与 command 判定告警级别")]
    pub fn is_user_visible_damage(&self) -> bool {
        matches!(
            self,
            AuditFinding::ReferenceFileMissing { .. }
                | AuditFinding::ReferenceBytesMismatch { .. }
                | AuditFinding::RecordWithoutReference { .. }
        )
    }
}

/// 一次审计的完整报告。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditReport {
    pub findings: Vec<AuditFinding>,
    /// 审计时的 schema 版本。用于判断报告是否针对一个已知的库形态。
    pub schema_version: i64,
    /// 参与审计的引用行数与 blob metadata 行数。
    ///
    /// 给出分母是必要的：一份"0 个问题"的报告若来自一个空库，与来自一个有 500 个包的库，
    /// 含义完全不同。
    pub referenced_blob_count: i64,
    pub blob_metadata_count: i64,
    pub web_package_count: i64,
}

impl AuditReport {
    /// 某桶的发现数。
    #[allow(dead_code, reason = "D2.2b 的 command 返回值由渲染层按 kind 分组统计")]
    pub fn count_of(&self, kind: &str) -> usize {
        self.findings
            .iter()
            .filter(|finding| finding.kind() == kind)
            .count()
    }

    /// 是否存在用户可见的损坏。
    #[allow(dead_code, reason = "D2.2b 的 command 需要它决定 UI 的告警级别")]
    pub fn has_user_visible_damage(&self) -> bool {
        self.findings
            .iter()
            .any(AuditFinding::is_user_visible_damage)
    }
}

/// 审计失败。
///
/// 与 [`StoreError`] 分开：审计失败意味着"我不知道库现在怎么样"，而不是"库坏了"。
/// 前者应显示为"检查未能完成"，后者才是"检查发现问题"。把两者混成一个 code 会让用户在
/// 库其实没问题时收到一条"本地库已损坏"的告警。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuditError {
    Unavailable,
    Failure,
}

impl AuditError {
    #[allow(
        dead_code,
        reason = "D2.2b 的 audit_local_library command 将经由它投影错误"
    )]
    pub fn code(&self) -> &'static str {
        match self {
            AuditError::Unavailable => "audit-unavailable",
            AuditError::Failure => "audit-failure",
        }
    }

    #[allow(
        dead_code,
        reason = "D2.2b 的 audit_local_library command 将经由它投影错误"
    )]
    pub fn message(&self) -> &'static str {
        match self {
            AuditError::Unavailable => "the local library is unavailable for auditing",
            AuditError::Failure => "the local library audit did not complete",
        }
    }
}

impl Serialize for AuditError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AuditError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

impl From<StoreError> for AuditError {
    fn from(_: StoreError) -> Self {
        AuditError::Unavailable
    }
}

impl From<crate::blob::BlobError> for AuditError {
    fn from(_: crate::blob::BlobError) -> Self {
        AuditError::Unavailable
    }
}

/// 跑一次完整性审计。**只报告，不修复。**
pub fn audit(
    blobs: &BlobStore,
    paths: &BlobPaths,
    connection: &crate::store::SharedConnection,
) -> Result<AuditReport, AuditError> {
    let guard = lock_connection(connection).map_err(|_| AuditError::Unavailable)?;

    let schema_version = guard
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|_| AuditError::Failure)?;

    // 第一遍：只读 SQLite，不碰文件系统。分成两遍是因为文件校验要重算摘要（O(字节)），
    // 而纯 SQL 那一半是廉价且原子的；混在一起会让"审计很慢"变成无差别的事实。
    let mut findings = Vec::new();
    let web_package_count = scalar(&guard, "SELECT COUNT(*) FROM local_web_package")?;
    let blob_metadata_count = scalar(&guard, "SELECT COUNT(*) FROM blob")?;

    // 桶一、二：每条引用行都指向一个必须存在、且内容与 metadata 一致的 blob。
    let referenced_blob_count = audit_referenced_blobs(&guard, paths, &mut findings)?;

    // 桶三：有 metadata、无引用。
    findings.extend(audit_unreferenced(&guard)?);

    // 桶四：文件在、metadata 不在。
    findings.extend(audit_orphan_files(paths, blob_metadata_count, &guard)?);

    // 桶五：包记录没有引用行。
    findings.extend(audit_records_without_references(&guard)?);

    // 桶六：外键违规。必须真跑 `foreign_key_check`——`integrity_check` 不检查外键。
    findings.extend(audit_foreign_keys(&guard)?);

    drop(guard);
    let _ = blobs;

    Ok(AuditReport {
        findings,
        schema_version,
        referenced_blob_count,
        blob_metadata_count,
        web_package_count,
    })
}

fn scalar(connection: &rusqlite::Connection, sql: &str) -> Result<i64, AuditError> {
    crate::store::scalar_i64(connection, sql).map_err(|_| AuditError::Failure)
}

/// 桶一、二：引用行的目标必须存在，且摘要与长度都对得上。
///
/// 返回参与检查的引用行数，作为报告的分母。
fn audit_referenced_blobs(
    connection: &rusqlite::Connection,
    paths: &BlobPaths,
    findings: &mut Vec<AuditFinding>,
) -> Result<i64, AuditError> {
    let mut statement = connection
        .prepare(
            "SELECT ref.package_id, ref.digest, blob.byte_length
             FROM web_package_archive_ref AS ref
             LEFT JOIN blob ON blob.digest = ref.digest",
        )
        .map_err(|_| AuditError::Failure)?;

    // 逐行传播错误而不是 `.flatten()`：审计的职责是如实报告库的状态，解码失败的行不能
    // 变成"这一行不存在"。见 `store::collect_rows` 的文档。
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|_| AuditError::Failure)?;

    let mut count = 0_i64;
    for row in rows {
        let (package_id, digest, declared_length) = row.map_err(|_| AuditError::Failure)?;
        count += 1;

        // LEFT JOIN 给出 None 说明引用行指向了一个 blob 表里不存在的 digest。
        // 外键本该禁止这种状态，但审计要能在外键已被破坏的库上运行——那正是它存在的意义。
        let Some((digest, declared_length)) = digest.zip(declared_length) else {
            findings.push(AuditFinding::ReferenceFileMissing {
                package_id,
                digest: String::new(),
            });
            continue;
        };

        let target: PathBuf = match blob_path(paths, &digest) {
            Ok(target) => target,
            // 摘要形状非法：路径无法派生。它同样让用户打不开这个包。
            Err(_) => {
                findings.push(AuditFinding::ReferenceFileMissing { package_id, digest });
                continue;
            }
        };

        let Ok(actual_length) = std::fs::metadata(&target).map(|meta| meta.len()) else {
            findings.push(AuditFinding::ReferenceFileMissing { package_id, digest });
            continue;
        };

        // 长度不符时不必再算摘要：内容必然不同，而算摘要要把整个文件读进内存。
        if actual_length != declared_length as u64 {
            findings.push(AuditFinding::ReferenceBytesMismatch {
                package_id,
                digest,
                expected_byte_length: declared_length,
                actual_byte_length: actual_length as i64,
                length_matches: false,
            });
            continue;
        }

        // 长度相同才值得读回来校验。这是 blob 写入路径"已存在即成功"的同一判据。
        match std::fs::read(&target) {
            Ok(bytes) if digest_of(&bytes) == digest => {}
            Ok(_) => findings.push(AuditFinding::ReferenceBytesMismatch {
                package_id,
                digest,
                expected_byte_length: declared_length,
                actual_byte_length: actual_length as i64,
                length_matches: true,
            }),
            // 读不出来（权限、I/O 错误）不等于内容不符。单列会更诚实，但当前的信息量
            // 不足以区分"被改写"与"暂时读不到"，因此按不符报出并让用户重试。
            Err(_) => findings.push(AuditFinding::ReferenceFileMissing { package_id, digest }),
        }
    }
    Ok(count)
}

/// 桶三：有 metadata、无任何引用。
fn audit_unreferenced(connection: &rusqlite::Connection) -> Result<Vec<AuditFinding>, AuditError> {
    let mut statement = connection
        .prepare(
            "SELECT blob.digest FROM blob
             WHERE NOT EXISTS (
                 SELECT 1 FROM web_package_archive_ref AS ref WHERE ref.digest = blob.digest
             )
             ORDER BY blob.digest",
        )
        .map_err(|_| AuditError::Failure)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| AuditError::Failure)?;

    let mut findings = Vec::new();
    for digest in rows {
        let digest = digest.map_err(|_| AuditError::Failure)?;
        findings.push(AuditFinding::UnreferencedMetadata { digest });
    }
    Ok(findings)
}

/// 桶四：文件在、metadata 不在。
///
/// 允许存在（崩溃窗口产物），因此它进报告但不算用户可见损坏。遍历 blob 目录而不是
/// 反查某个摘要：孤儿文件没有任何索引，只能靠扫目录才能发现。
fn audit_orphan_files(
    paths: &BlobPaths,
    blob_metadata_count: i64,
    connection: &rusqlite::Connection,
) -> Result<Vec<AuditFinding>, AuditError> {
    // metadata 里的 digest 集合。规模等于 blob 数，而孤儿文件数不会超过目录条目数；
    // 一次性取回比对，比对每个目录条目发一次 SQL 便宜。
    //
    // 这里曾用 `.flatten()`，它把解码失败的行静默跳过 → `known` 变短 → **每一个** blob 文件
    // 都被误报成孤儿。这类错误方向与"少报问题"相反，但同样是错的报告。
    let known: std::collections::HashSet<String> = {
        let mut statement = connection
            .prepare("SELECT digest FROM blob")
            .map_err(|_| AuditError::Failure)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| AuditError::Failure)?;
        crate::store::collect_rows(rows)
            .map_err(|_| AuditError::Failure)?
            .into_iter()
            .collect()
    };
    let _ = blob_metadata_count;

    let entries = match std::fs::read_dir(paths.root()) {
        Ok(entries) => entries,
        // 目录不存在意味着还没有任何 blob 被写入过，不算错误。
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(AuditError::Unavailable),
    };

    let mut findings = Vec::new();
    // 目录条目同样逐个传播错误：跳过一个读不出来的条目，等于把"有一个 blob 文件我看不见"这件事
    // 从报告里抹掉。而紧接着的 `metadata()` 失败更不能折叠成 `unwrap_or_default()`——那会给一个
    // 真实存在的文件报出 `byteLength: 0`，报告里的数字因此变成假的。
    for entry in entries {
        let entry = entry.map_err(|_| AuditError::Unavailable)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // 只看摘要形状的普通文件。临时文件（`NamedTempFile`）在写入窗口内存在，
        // 它不是孤儿——把它报出来会让审计在正常写入期间产生噪声。
        if !is_digest_file_name(&name) {
            continue;
        }
        if known.contains(&format!("sha256:{name}")) {
            continue;
        }
        let byte_length = entry.metadata().map_err(|_| AuditError::Unavailable)?.len() as i64;
        findings.push(AuditFinding::OrphanFile {
            digest: format!("sha256:{name}"),
            byte_length,
        });
    }
    findings.sort_by(|left, right| left.digest().cmp(right.digest()));
    Ok(findings)
}

/// blob 目录下的文件名是否是 `<64 位小写 hex>`。
///
/// 与 [`crate::blob::blob_path`] 派生出的形状一致。这里不复用 `parse_digest`——它要求
/// `sha256:` 前缀，而文件名不带前缀。
fn is_digest_file_name(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// 桶五：包记录存在但没有引用行。
fn audit_records_without_references(
    connection: &rusqlite::Connection,
) -> Result<Vec<AuditFinding>, AuditError> {
    let mut statement = connection
        .prepare(
            "SELECT pkg.id FROM local_web_package AS pkg
             WHERE NOT EXISTS (
                 SELECT 1 FROM web_package_archive_ref AS ref WHERE ref.package_id = pkg.id
             )
             ORDER BY pkg.id",
        )
        .map_err(|_| AuditError::Failure)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| AuditError::Failure)?;

    let mut findings = Vec::new();
    for package_id in rows {
        let package_id = package_id.map_err(|_| AuditError::Failure)?;
        findings.push(AuditFinding::RecordWithoutReference { package_id });
    }
    Ok(findings)
}

/// 桶六：`PRAGMA foreign_key_check`。
///
/// 该 pragma 返回四列：违反的表、该行的 rowid、父表、外键编号。它**不是**查询，因此不能用
/// 参数绑定；这里也不需要绑定——pragma 不接受参数。
fn audit_foreign_keys(connection: &rusqlite::Connection) -> Result<Vec<AuditFinding>, AuditError> {
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|_| AuditError::Failure)?;
    let rows = statement
        .query_map([], |row| {
            Ok(AuditFinding::ForeignKeyViolation {
                table: row.get::<_, String>(0)?,
                row_id: row.get::<_, i64>(1)?,
                parent: row.get::<_, String>(2)?,
                foreign_key_id: row.get::<_, i64>(3)?,
            })
        })
        .map_err(|_| AuditError::Failure)?;

    let mut findings = Vec::new();
    for finding in rows {
        findings.push(finding.map_err(|_| AuditError::Failure)?);
    }
    Ok(findings)
}

/// 给 `AuditFinding` 一个可比较的键，供排序与去重使用。
trait FindingDigest {
    fn digest(&self) -> &str;
}

impl FindingDigest for AuditFinding {
    fn digest(&self) -> &str {
        match self {
            AuditFinding::ReferenceFileMissing { digest, .. }
            | AuditFinding::ReferenceBytesMismatch { digest, .. }
            | AuditFinding::UnreferencedMetadata { digest }
            | AuditFinding::OrphanFile { digest, .. } => digest,
            AuditFinding::RecordWithoutReference { package_id } => package_id,
            AuditFinding::ForeignKeyViolation { table, .. } => table,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{audit, AuditFinding, AuditReport};
    use crate::blob::BlobPaths;
    use crate::test_fixture::Fixture;

    /// 一条合法的 manifest 摘要（领域身份）。它与 blob 落盘所用的归档字节摘要**不同**——
    /// `DESK-063` 要求两者分开，夹具也刻意把它们区分开。
    const DIGEST_A: &str =
        "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    /// 第二条合法摘要。用于需要两行不同身份的场景（`ref_digest` 上有 UNIQUE 约束）。
    #[allow(dead_code, reason = "D2.2c 的 GC 多引用场景会用到")]
    const DIGEST_B: &str =
        "sha256:2222222222222222222222222222222222222222222222222222222222222222";

    fn report(fixture: &Fixture) -> AuditReport {
        audit(
            fixture.blobs(),
            &BlobPaths::under(fixture.data_root()),
            fixture.connection(),
        )
        .expect("audit must run")
    }

    /// 空库的审计 MUST 干净，且给出分母。
    ///
    /// 分母不是可选的礼貌：一份"0 个问题"来自空库与来自 500 个包的库，含义完全不同。
    #[test]
    fn an_empty_library_reports_nothing_and_states_its_size() {
        let fixture = Fixture::new("audit-empty");
        let report = report(&fixture);
        assert!(
            report.findings.is_empty(),
            "空库 MUST 无发现：{:?}",
            report.findings
        );
        assert_eq!(report.referenced_blob_count, 0);
        assert_eq!(report.blob_metadata_count, 0);
        assert_eq!(report.web_package_count, 0);
        assert!(!report.has_user_visible_damage());
    }

    /// 一次正常保存 MUST 不产生任何发现。
    ///
    /// 这是审计的**误报**门禁：一条干净的库如果被报成有问题，用户会去恢复一份完好的数据，
    /// 那比漏报更糟。
    #[test]
    fn a_cleanly_saved_package_produces_no_findings() {
        let fixture = Fixture::new("audit-clean");
        fixture.save_package("pkg-clean", DIGEST_A, b"PK\x03\x04clean");
        let report = report(&fixture);
        assert!(
            report.findings.is_empty(),
            "正常写入后 MUST 无发现，实际：{:?}",
            report.findings
        );
        assert_eq!(report.referenced_blob_count, 1);
        assert_eq!(report.blob_metadata_count, 1);
        assert_eq!(report.web_package_count, 1);
    }

    /// 软删 MUST NOT 让 blob 变成孤儿。
    ///
    /// `DESK-055`：软删只写 tombstone 并保留引用，因此字节仍然可达。这条断言防止
    /// "为了让审计好看"而在软删时顺手回收字节——那会让 `restore` 产出一条打不开的记录。
    #[test]
    fn soft_delete_keeps_the_archive_reachable() {
        let fixture = Fixture::new("audit-soft-delete");
        let saved = fixture.save_package("pkg-soft", DIGEST_A, b"PK\x03\x04soft");
        fixture.soft_delete_package(&saved);

        let report = report(&fixture);
        assert!(
            report.findings.is_empty(),
            "软删后 MUST 仍然一致：{:?}",
            report.findings
        );
    }

    /// 桶一：引用存在、文件缺失。
    ///
    /// 形态是"用户看得见这个包、点开打不开"。
    #[test]
    fn reports_a_reference_whose_file_is_missing() {
        let fixture = Fixture::new("audit-missing-file");
        // 用**归档字节**的摘要去删文件：blob 路径由它派生，与 manifest 摘要无关（DESK-063）。
        let saved = fixture.save_package("pkg-gone", DIGEST_A, b"PK\x03\x04gone");
        fixture
            .remove_blob_file(&saved.archive_digest)
            .expect("remove the file");

        let report = report(&fixture);
        assert_eq!(report.count_of("reference-file-missing"), 1);
        assert!(report.has_user_visible_damage());
        assert!(
            report.findings.iter().any(|finding| matches!(
                finding,
                AuditFinding::ReferenceFileMissing { package_id, .. } if package_id == "pkg-gone"
            )),
            "报告 MUST 指出是哪个包：{:?}",
            report.findings
        );
    }

    /// 桶二：文件在但内容被改写。
    ///
    /// 与桶一分开是有意义的：这一类在下次写入时可以被自愈覆盖（`DESK-056`），上一类不能。
    #[test]
    fn reports_a_reference_whose_bytes_no_longer_match() {
        let fixture = Fixture::new("audit-mismatch");
        // 等长但内容不同——这是最难被"长度检查"发现的一种损坏。
        let saved = fixture.save_package("pkg-swapped", DIGEST_A, b"PK\x03\x04AAAA");
        fixture.overwrite_blob_file(&saved.archive_digest, b"PK\x03\x04BBBB");

        let report = report(&fixture);
        assert_eq!(report.count_of("reference-bytes-mismatch"), 1);
        match &report.findings[0] {
            AuditFinding::ReferenceBytesMismatch {
                expected_byte_length,
                actual_byte_length,
                length_matches,
                ..
            } => {
                assert_eq!(*expected_byte_length, *actual_byte_length);
                assert!(
                    *length_matches,
                    "等长但内容不同 MUST 报为 lengthMatches=true，让 UI 能与截断区分"
                );
            }
            other => panic!("期望字节不符，实际 {other:?}"),
        }
        assert!(report.has_user_visible_damage());
    }

    /// 长度不同 MUST 单独报出，且明确 lengthMatches=false。
    #[test]
    fn reports_a_truncated_blob_without_reading_it_back() {
        let archive = b"PK\x03\x04whole-archive";
        let fixture = Fixture::new("audit-truncated");
        let saved = fixture.save_package("pkg-short", DIGEST_A, archive);
        fixture.overwrite_blob_file(&saved.archive_digest, b"PK");

        let report = report(&fixture);
        assert_eq!(report.count_of("reference-bytes-mismatch"), 1);
        match &report.findings[0] {
            AuditFinding::ReferenceBytesMismatch {
                expected_byte_length,
                actual_byte_length,
                length_matches,
                ..
            } => {
                assert_eq!(
                    *expected_byte_length as usize,
                    archive.len(),
                    "声明长度 MUST 来自 metadata，而非硬编码常量"
                );
                assert_eq!(*actual_byte_length, 2);
                assert!(!length_matches);
            }
            other => panic!("期望字节不符，实际 {other:?}"),
        }
    }

    /// 桶三：有 metadata、无引用。
    ///
    /// purge 之后正是这个形态——它被明确允许（`DESK-055`），但用户需要看到"这块空间可以回收了"。
    #[test]
    fn reports_metadata_without_any_reference() {
        let fixture = Fixture::new("audit-unreferenced");
        fixture.save_package("pkg-purged", DIGEST_A, b"PK\x03\x04purged");
        fixture.purge_package("pkg-purged");

        let report = report(&fixture);
        assert_eq!(report.count_of("unreferenced-metadata"), 1);
        assert!(
            !report.has_user_visible_damage(),
            "可回收候选不是损坏：用户没有少看到任何东西"
        );
        assert_eq!(report.web_package_count, 0);
        assert_eq!(report.referenced_blob_count, 0);
    }

    /// 桶四：有文件、无 metadata。
    ///
    /// 崩溃窗口产物，**允许存在**，因此不算用户可见损坏。
    #[test]
    fn reports_an_orphan_file_without_calling_it_damage() {
        let fixture = Fixture::new("audit-orphan");
        fixture.save_package("pkg-ok", DIGEST_A, b"PK\x03\x04ok");
        // 摘要取自实际字节：孤儿文件没有 metadata，它的"地址"就是文件名。
        let bytes = b"PK\x03\x04orphan";
        let digest = format!("sha256:{}", {
            use sha2::{Digest, Sha256};
            let hex: String = Sha256::digest(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            hex
        });
        fixture
            .write_orphan_file(&digest, bytes)
            .expect("plant an orphan file");

        let report = report(&fixture);
        assert_eq!(report.count_of("orphan-file"), 1);
        assert!(
            !report.has_user_visible_damage(),
            "孤儿文件允许存在：它对用户不可见，标成损坏会让真正的问题被稀释"
        );
        assert_eq!(report.count_of("reference-file-missing"), 0);
    }

    /// 桶四 MUST 忽略临时文件。
    ///
    /// 写入过程中同目录会有 `NamedTempFile`；把它报成孤儿会让审计在**正常写入期间**产生噪声，
    /// 而用户会因此学会忽略这份报告。
    #[test]
    fn ignores_temporary_files_in_the_blob_directory() {
        let fixture = Fixture::new("audit-tempfile");
        let root = fixture.data_root().join("blobs");
        std::fs::write(root.join(".tmpAbC123"), b"partial write").expect("plant a temp file");
        std::fs::write(root.join("not-a-digest"), b"x").expect("plant a stray file");

        let report = report(&fixture);
        assert_eq!(
            report.count_of("orphan-file"),
            0,
            "临时文件与非摘要文件 MUST 不进孤儿桶：{:?}",
            report.findings
        );
    }

    /// 桶五：包记录存在但没有引用行。
    ///
    /// 这不是外键违规——外键方向是引用行 → 包记录，数据库不约束反方向。用户症状与
    /// 字节损坏完全一样（`readArchive` 返回 null），所以必须单列。
    #[test]
    fn reports_a_record_without_a_reference_row() {
        let fixture = Fixture::new("audit-no-ref");
        fixture.save_package("pkg-orphan-record", DIGEST_A, b"PK\x03\x04orphan-record");
        fixture.delete_reference_row("pkg-orphan-record");

        let report = report(&fixture);
        assert_eq!(report.count_of("record-without-reference"), 1);
        assert!(report.has_user_visible_damage());
        assert_eq!(
            report.count_of("foreign-key-violation"),
            0,
            "缺引用行 MUST NOT 被误报成外键违规：外键方向相反，它本来就合法"
        );
        assert_eq!(report.count_of("reference-file-missing"), 0);
    }

    /// 桶六：真实的外键违规 MUST 被 `foreign_key_check` 检出。
    ///
    /// 这里注入一个真实违规（关掉外键后插一行悬空引用），而不是靠 mock。若实现改用
    /// `integrity_check`，这条会红——后者不检查外键。
    #[test]
    fn detects_a_real_foreign_key_violation() {
        let fixture = Fixture::new("audit-fk");
        fixture.save_package("pkg-fk", DIGEST_A, b"PK\x03\x04fk");
        let injected = fixture.inject_foreign_key_violation();
        assert!(injected, "注入 MUST 成功，否则这条测试什么都没验证");

        let report = report(&fixture);
        // 只断言 blob 侧那一条：注入的行同时悬空于 package 与 blob，因此 pragma 报两行，
        // 而本测试关心的是"blob 侧的违规能被检出"。
        assert!(
            report.findings.iter().any(|finding| matches!(
                finding,
                AuditFinding::ForeignKeyViolation { table, parent, .. }
                    if table == "web_package_archive_ref" && parent == "blob"
            )),
            "foreign_key_check MUST 检出指向 blob 的悬空引用：{:?}",
            report.findings
        );
    }

    /// 六个桶 MUST 都可达。
    ///
    /// 逐条测试已经覆盖了每一个；这条防止将来加桶时忘了同步 `kind()` 与报告契约。
    #[test]
    fn every_bucket_has_a_distinct_kind() {
        let kinds = [
            AuditFinding::ReferenceFileMissing {
                package_id: "p".to_string(),
                digest: "d".to_string(),
            },
            AuditFinding::ReferenceBytesMismatch {
                package_id: "p".to_string(),
                digest: "d".to_string(),
                expected_byte_length: 1,
                actual_byte_length: 1,
                length_matches: true,
            },
            AuditFinding::UnreferencedMetadata {
                digest: "d".to_string(),
            },
            AuditFinding::OrphanFile {
                digest: "d".to_string(),
                byte_length: 1,
            },
            AuditFinding::RecordWithoutReference {
                package_id: "p".to_string(),
            },
            AuditFinding::ForeignKeyViolation {
                table: "t".to_string(),
                row_id: 1,
                parent: "p".to_string(),
                foreign_key_id: 0,
            },
        ];
        let mut distinct = kinds.iter().map(AuditFinding::kind).collect::<Vec<_>>();
        let total = distinct.len();
        distinct.sort_unstable();
        distinct.dedup();
        assert_eq!(distinct.len(), total, "六个桶 MUST 各自有唯一 kind");
    }

    /// 报告 MUST NOT 携带文件路径。
    ///
    /// `DESK-057`：物理布局不进对外契约。带路径的报告会让"同一份库在两台设备上的审计
    /// 结果不同"，而那对用户判断毫无价值。
    #[test]
    fn the_report_never_leaks_a_filesystem_path() {
        let fixture = Fixture::new("audit-no-path");
        fixture.save_package("pkg-path", DIGEST_A, b"PK\x03\x04path");
        let report = report(&fixture);
        let rendered = serde_json::to_string(&report).expect("report must serialize");
        let root = fixture.data_root().to_path_buf();
        assert!(
            !rendered.contains(root.to_string_lossy().as_ref())
                && !rendered.contains('\\')
                && !rendered.contains("blobs"),
            "报告 MUST 只含摘要与包 id，实际：{rendered}"
        );
    }
}
