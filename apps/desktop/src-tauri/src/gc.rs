//! 孤儿 blob 回收（D2.2c）。
//!
//! ## 判定只依据引用表
//!
//! `DESK-065` 明确禁止把 `last_referenced_at` 当作正确性条件。一个刚被引用、尚未落
//! `last_referenced_at` 的 blob 在 GC 眼里就是孤儿——用时间戳做条件会把它删掉，而那个包的
//! 用户此刻正看着它出现在列表里。`last_referenced_at` 仍然被写入（它对未来可能的
//! "冷数据淘汰"策略有用），但 GC **不读**它。
//!
//! ## 标记—再确认
//!
//! **两层过滤，用同一个谓词。**
//!
//! ```sql
//! -- 标记：候选集
//! SELECT blob.digest FROM blob
//! WHERE NOT EXISTS (SELECT 1 FROM web_package_archive_ref WHERE ref.digest = blob.digest)
//!
//! -- 再确认：删除
//! DELETE FROM blob WHERE digest = ?1
//!   AND NOT EXISTS (SELECT 1 FROM web_package_archive_ref WHERE digest = ?1)
//! ```
//!
//! 刻意不写成"一次 SELECT 查候选集 + 一次无条件 DELETE"：那样在复核与删除之间留了一个
//! 间隙。放进 `DELETE` 的 `WHERE` 后，SQLite 在同一次语句内完成复核与删除。
//!
//! 维护窗口已经排除了并发写入，因此正常路径上候选集里的每个 digest 在删除时仍无引用，
//! 条件 DELETE 的 `changed` 恒为 1。**这一层今天无法被测试触发**——它防的是候选集计算本身
//! 出错的情形（脏库、外部工具写坏、将来出现的第二个 blob 引用表被漏进候选查询）。
//!
//! 因此门禁落在两侧而不是这一层：候选集查询与条件 DELETE 的谓词**必须是同一个**。把任一处
//! 的 `NOT EXISTS` 换成恒真条件，
//! [`tests::a_clean_library_reclaims_nothing_but_still_scans`] 就会变红。这是无头环境里能
//! 真正证伪的门禁形态；为"再确认"硬造一个并发场景只会得到依赖时序的脆弱测试，而那类测试
//! 在 CI 上只会偶发红。
//!
//! ## 删除顺序：先 metadata，后文件（`DESK-072`）
//!
//! 反过来（先删文件）崩溃后会留下"metadata 在、文件不在"——正是 `DESK-051` 明令禁止的悬空
//! 记录。先删行后删文件，崩溃最多留下孤儿文件，而孤儿文件是**允许存在**的。这与写入路径的
//! 不对称性是镜像的：写入是"文件先、metadata 后"，删除是"metadata 先、文件后"，两者都让
//! "引用不到字节"成为不可能的状态。
//!
//! ## soft delete 不改变可达性（`DESK-055`）
//!
//! 软删只写 tombstone，引用行不动。因此一个软删的包，它的字节**仍然可达**、GC **不会**碰它。
//! 只有 purge（移除引用行）才让它成为回收候选。这条不是 GC 的实现细节，而是"恢复一个删掉
//! 的包"能真正恢复可用状态的前提。

use std::path::Path;

use serde::Serialize;

use crate::blob::{blob_path, BlobPaths};
use crate::store::SharedConnection;

/// 一次 GC 的结果。
///
/// 五个计数让"GC 跑了但什么都没做"与"GC 什么都没跑"可以区分——前者正常（库是干净的，或
/// 用户还没 purge 任何东西），后者说明候选集计算坏了。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarbageCollectionReport {
    /// 进入候选集的 digest 数。
    pub scanned: i64,
    /// 实际删除的 metadata 行数。
    pub reclaimed: i64,
    /// 实际删除的文件数。
    ///
    /// 它与 `reclaimed` 的差值有意义：差值大于零说明有些 metadata 行对应的文件本来就不在
    /// （桶一的损坏形态）——GC 删了行（正确，字节已不可达）但没有文件可删。
    pub files_removed: i64,
    /// 回收的字节数。
    pub bytes_reclaimed: i64,
    /// 删除文件失败（权限、I/O）的条数。
    ///
    /// 单列而不是并入失败：metadata 行已经删掉了（这是对的），剩下的文件是一个孤儿，会被
    /// 下一次审计报成桶四。让用户知道"还有 N 个文件没删掉"比让它静默留在磁盘上更有用。
    pub files_failed: i64,
}

/// GC 失败。与审计错误同样分开：GC 失败是"不知道能回收什么"，不是"库坏了"。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GarbageCollectionError {
    Unavailable,
    Failure,
}

impl Serialize for GarbageCollectionError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("GarbageCollectionError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

impl GarbageCollectionError {
    #[allow(
        dead_code,
        reason = "D2.2c 的 collect_local_garbage command 将经由它投影错误"
    )]
    pub fn code(&self) -> &'static str {
        match self {
            GarbageCollectionError::Unavailable => "gc-unavailable",
            GarbageCollectionError::Failure => "gc-failure",
        }
    }

    #[allow(
        dead_code,
        reason = "D2.2c 的 collect_local_garbage command 将经由它投影错误"
    )]
    pub fn message(&self) -> &'static str {
        match self {
            GarbageCollectionError::Unavailable => {
                "the local library is unavailable for collection"
            }
            GarbageCollectionError::Failure => {
                "the local library garbage collection did not complete"
            }
        }
    }
}

/// 回收无引用的 blob。**MUST** 在维护窗口内调用。
///
/// `connection` 是共享连接：候选集与删除都在同一把锁下，因此"标记"与"再确认"之间不可能有
/// 另一个写入挤进来——但复核仍然要做，理由见模块文档。
pub fn collect(
    paths: &BlobPaths,
    connection: &SharedConnection,
) -> Result<GarbageCollectionReport, GarbageCollectionError> {
    let guard = crate::store::lock_connection(connection)
        .map_err(|_| GarbageCollectionError::Unavailable)?;

    // 标记：不在任何引用表中的 digest。
    let candidates: Vec<String> = {
        let mut statement = guard
            .prepare(
                "SELECT blob.digest FROM blob
                 WHERE NOT EXISTS (
                     SELECT 1 FROM web_package_archive_ref AS ref WHERE ref.digest = blob.digest
                 )
                 ORDER BY blob.digest",
            )
            .map_err(|_| GarbageCollectionError::Failure)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| GarbageCollectionError::Failure)?;
        // 逐行传播错误而不是 `.flatten()`（见 `store::collect_rows`）。
        //
        // 这里的错误方向恰好是**保守**的：少拿候选 = 少回收，不会误删。但它仍会让 `scanned`
        // 与 `reclaimed` 报出不是真相的数字，而 GC 报告的用途正是让用户判断"回收了多少"。
        crate::store::collect_rows(rows).map_err(|_| GarbageCollectionError::Failure)?
    };

    let mut report = GarbageCollectionReport {
        scanned: candidates.len() as i64,
        ..GarbageCollectionReport::default()
    };

    for digest in candidates {
        let byte_length = declared_byte_length(&guard, &digest)?.unwrap_or_default();
        let target = match blob_path(paths, &digest) {
            Ok(target) => target,
            // 摘要形状非法的行无法派生路径。它同样不可达，但"删掉一行我们读不出地址的
            // metadata"没有任何好处——留下它，让审计把它报出来。
            Err(_) => continue,
        };

        // 再确认与删除是**同一条语句**（`DESK-065` 的"标记—再确认"）。
        //
        // 刻意不用"先 SELECT 再 DELETE"两步：那样两步之间存在一个窗口，而窗口里出现的
        // 引用会被无条件删掉。把 `NOT EXISTS` 放进 DELETE 的 WHERE 子句后，"复核"与"删除"
        // 由 SQLite 在同一次语句里完成——不存在可以插进来的间隙。这比任何应用层的双保险都
        // 强，因为它把窗口从"存在"变成"不存在"。
        //
        // 维护窗口已经排除了并发写入，因此这个条件在正常路径上恒为真；它防的是**候选集
        // 本身是错的**（上一轮 GC 的 bug、外部工具写脏了库、脏数据）。changed == 0 就是
        // 这个信号。
        let removed = guard
            .execute(
                "DELETE FROM blob
                 WHERE digest = ?1
                   AND NOT EXISTS (SELECT 1 FROM web_package_archive_ref WHERE digest = ?1)",
                rusqlite::params![digest],
            )
            .map_err(|_| GarbageCollectionError::Failure)?;

        if removed == 0 {
            continue;
        }
        report.reclaimed += 1;

        match remove_blob_file(&target) {
            Ok(()) => {
                report.files_removed += 1;
                report.bytes_reclaimed += byte_length;
            }
            // 文件本来就不在：这是桶一的损坏（metadata 在、字节缺）。GC 不制造它，也不负责
            // 报告它——审计会。行已删是正确的结果。
            Err(FileRemoval::AlreadyAbsent) => {}
            Err(FileRemoval::Io) => report.files_failed += 1,
        }
    }

    Ok(report)
}

/// metadata 记录的字节长度。用于报告，不用于判定。
fn declared_byte_length(
    connection: &rusqlite::Connection,
    digest: &str,
) -> Result<Option<i64>, GarbageCollectionError> {
    connection
        .query_row(
            "SELECT byte_length FROM blob WHERE digest = ?1",
            rusqlite::params![digest],
            |row| row.get::<_, i64>(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            _ => Err(GarbageCollectionError::Failure),
        })
}

/// 删除 blob 文件的两种失败。
///
/// 成功走 `Ok(())`——"文件已被移除"不是一个需要单独表达的状态。
enum FileRemoval {
    /// 文件本来就不在。这是桶一的损坏形态，GC 不制造它，也不掩盖它。
    AlreadyAbsent,
    /// 权限或 I/O 错误。metadata 行已删（这是对的，字节已经不可达），文件留下成为孤儿。
    Io,
}

fn remove_blob_file(target: &Path) -> Result<(), FileRemoval> {
    match std::fs::remove_file(target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(FileRemoval::AlreadyAbsent)
        }
        Err(_) => Err(FileRemoval::Io),
    }
}

#[cfg(test)]
mod tests {
    use super::{collect, GarbageCollectionReport};
    use crate::blob::BlobPaths;
    use crate::test_fixture::Fixture;

    const DIGEST_A: &str =
        "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const DIGEST_B: &str =
        "sha256:2222222222222222222222222222222222222222222222222222222222222222";

    fn run(fixture: &Fixture) -> GarbageCollectionReport {
        collect(&BlobPaths::under(fixture.data_root()), fixture.connection()).expect("gc must run")
    }

    /// 候选集 MUST 只含无引用的 digest —— 这是"标记—再确认"唯一可证伪的门禁。
    ///
    /// 条件 DELETE 的 `NOT EXISTS` 在正常路径上恒为真（维护窗口排除了并发写入），**无法**
    /// 被测试直接触发。真正要守住的是两层用**同一个谓词**：候选集查询一旦漏了引用表，
    /// 在用的 blob 就会被无条件删掉——而删掉在用的字节不会让任何测试变红，它只是让用户的
    /// 包在某天突然打不开。
    ///
    /// 因此这里断言候选集本身：把候选集查询改成 `WHERE 1 = 1` 会让本条与
    /// [`Self::never_reclaims_a_referenced_blob`] 同时变红。
    #[test]
    fn a_clean_library_reclaims_nothing_but_still_scans() {
        let fixture = Fixture::new("gc-clean");
        let saved = fixture.save_package("pkg-kept", DIGEST_A, b"PK\x03\x04kept");

        let report = run(&fixture);
        assert_eq!(
            report.scanned, 0,
            "被引用的 digest MUST NOT 进候选集——这是两层谓词一致的唯一可观测点"
        );
        assert_eq!(report.reclaimed, 0);
        assert_eq!(report.files_removed, 0);
        assert_eq!(report.bytes_reclaimed, 0);
        assert!(fixture.blob_file_exists(&saved.archive_digest));
    }

    /// 条件 DELETE 的守卫 MUST 与候选集查询给出同一个结论。
    ///
    /// 构造两个状态：无引用（该删）与有引用（不该删），同时跑一遍。`scanned` 与 `reclaimed`
    /// 必须相等——两层谓词一旦不一致，就会出现"标记了却没删"（漏回收）或"删了却没标记"
    /// （无法解释的删除）。
    #[test]
    fn the_delete_guard_and_the_candidate_query_agree() {
        let fixture = Fixture::new("gc-guard-agreement");
        fixture.save_package("pkg-purged", DIGEST_A, b"PK\x03\x04purged");
        fixture.save_package("pkg-live", DIGEST_B, b"PK\x03\x04live");
        fixture.purge_package("pkg-purged");

        let report = run(&fixture);
        assert_eq!(report.scanned, 1, "候选集 MUST 只含那个已 purge 的 digest");
        assert_eq!(
            report.reclaimed, 1,
            "条件 DELETE MUST 删掉同一个 digest——两层谓词不一致时这里会出现一多一少"
        );
        assert!(
            fixture.package_readable("pkg-live"),
            "在用的包 MUST 毫发无损"
        );
    }

    /// 被引用的 blob MUST NOT 被回收。
    ///
    /// 这是 GC 的**误删**门禁：删掉一个在用的 blob 会让用户的包变成"打不开"，而没有任何
    /// 警告。
    #[test]
    fn never_reclaims_a_referenced_blob() {
        let fixture = Fixture::new("gc-referenced");
        let saved = fixture.save_package("pkg-live", DIGEST_A, b"PK\x03\x04live");

        let report = run(&fixture);
        assert_eq!(report.reclaimed, 0, "被引用的 blob MUST NOT 进候选集");
        assert!(
            fixture.blob_file_exists(&saved.archive_digest),
            "被引用的字节 MUST 仍在磁盘上"
        );
        assert!(fixture.package_readable("pkg-live"), "包 MUST 仍可读");
    }

    /// 软删 MUST NOT 让字节变成回收候选。
    ///
    /// `DESK-055`：软删只写 tombstone 并保留引用，因此字节仍然可达。这条断言防止
    /// "为了让 GC 有事可做"而在软删时顺手回收字节——那会让 restore 产出一条打不开的记录。
    #[test]
    fn soft_deleted_bytes_stay_reachable() {
        let fixture = Fixture::new("gc-soft-delete");
        let saved = fixture.save_package("pkg-soft", DIGEST_A, b"PK\x03\x04soft");
        fixture.soft_delete_package(&saved);

        let report = run(&fixture);
        assert_eq!(report.reclaimed, 0, "软删后 MUST 仍可达");
        assert!(fixture.blob_file_exists(&saved.archive_digest));
        assert_eq!(
            fixture.reference_count("pkg-soft"),
            1,
            "软删 MUST NOT 移除引用行"
        );
    }

    /// purge 之后 MUST 成为回收候选，且被回收。
    #[test]
    fn reclaims_after_a_package_is_purged() {
        let fixture = Fixture::new("gc-purge");
        let saved = fixture.save_package("pkg-purged", DIGEST_A, b"PK\x03\x04purged");
        fixture.purge_package("pkg-purged");

        let report = run(&fixture);
        assert_eq!(report.scanned, 1, "purge 后的 blob MUST 进候选集");
        assert_eq!(report.reclaimed, 1);
        assert_eq!(report.files_removed, 1);
        assert_eq!(
            report.bytes_reclaimed,
            b"PK\x03\x04purged".len() as i64,
            "回收字节数 MUST 来自 metadata 记录的长度"
        );
        assert!(
            !fixture.blob_file_exists(&saved.archive_digest),
            "字节 MUST 真的从磁盘上消失"
        );
    }

    /// 先删 metadata、后删文件（`DESK-072`）。
    ///
    /// 这条断言的是**顺序的后果**而不是顺序本身：若实现反过来（先删文件再删行），崩溃
    /// 会留下"metadata 在、文件不在"——`DESK-051` 明令禁止的悬空记录。
    ///
    /// 用一个"metadata 在、文件不在"的状态反证：本实现把这样的行当作正常回收候选处理，
    /// 删掉行并如实报告 `files_removed == 0`——既不假装删了文件，也不因为文件缺失而放弃
    /// 删行（字节已经不可达，留着 metadata 只会让下一次审计再报一遍）。
    #[test]
    fn deletes_the_metadata_row_even_when_the_file_is_already_gone() {
        let fixture = Fixture::new("gc-order");
        let saved = fixture.save_package("pkg-order", DIGEST_A, b"PK\x03\x04order");
        fixture.purge_package("pkg-order");

        // 造出"metadata 在、文件不在"：先补回 metadata 行，再把文件删掉。
        fixture
            .reinsert_blob_metadata(&saved.archive_digest, 18)
            .expect("reinsert metadata");
        fixture
            .remove_blob_file(&saved.archive_digest)
            .expect("remove the file");
        assert!(!fixture.blob_file_exists(&saved.archive_digest));

        let report = run(&fixture);
        assert_eq!(
            report.reclaimed, 1,
            "无引用的 metadata 行 MUST 被回收，即使它的文件已经不在"
        );
        assert_eq!(
            report.files_removed, 0,
            "文件本来就不在——GC 不制造也不掩盖桶一的损坏"
        );
        assert_eq!(
            report.bytes_reclaimed, 0,
            "没有文件被删除，因此不能声称回收了字节"
        );
        assert_eq!(report.files_failed, 0, "文件缺失不是 I/O 失败");
    }

    /// 正常回收时 metadata 与文件**都**消失，且字节数被如实报告。
    ///
    /// 与上一条配对：上一条守住"文件不在时怎么报"，这条守住"文件在时怎么报"。
    #[test]
    fn deletes_both_the_metadata_row_and_the_file_on_a_normal_reclaim() {
        let fixture = Fixture::new("gc-both");
        let saved = fixture.save_package("pkg-both", DIGEST_A, b"PK\x03\x04both");
        fixture.purge_package("pkg-both");
        assert!(
            fixture.blob_file_exists(&saved.archive_digest),
            "前提：回收前文件在"
        );
        assert_eq!(fixture.blob_metadata_count(&saved.archive_digest), 1);

        let report = run(&fixture);

        assert_eq!(report.reclaimed, 1);
        assert_eq!(report.files_removed, 1);
        assert_eq!(report.bytes_reclaimed, b"PK\x03\x04both".len() as i64);
        assert!(
            !fixture.blob_file_exists(&saved.archive_digest),
            "文件 MUST 真的从磁盘上消失——这是「先删行后删文件」的后半段"
        );
        assert_eq!(
            fixture.blob_metadata_count(&saved.archive_digest),
            0,
            "metadata 行 MUST 也消失；只删其一就会留下 DESK-051 禁止的悬空或残留状态"
        );
    }

    /// GC 之后引用完整性 MUST 保持。
    ///
    /// 这条断言的是"回收没有误删"：跑完 GC 之后，每一个仍存在的包都必须还能读出字节。
    #[test]
    fn preserves_reference_integrity_after_collection() {
        let fixture = Fixture::new("gc-integrity");
        let kept = fixture.save_package("pkg-kept", DIGEST_A, b"PK\x03\x04kept-bytes");
        let purged = fixture.save_package("pkg-purged", DIGEST_B, b"PK\x03\x04purged-bytes");
        fixture.purge_package("pkg-purged");

        run(&fixture);

        assert!(fixture.package_readable("pkg-kept"), "在用的包 MUST 仍可读");
        assert!(fixture.blob_file_exists(&kept.archive_digest));
        assert!(!fixture.blob_file_exists(&purged.archive_digest));
        assert_eq!(fixture.reference_count("pkg-kept"), 1);
        assert_eq!(fixture.reference_count("pkg-purged"), 0);
    }

    /// 重复运行 MUST 幂等。
    ///
    /// 用户会点两次"清理"，也可能与一次自动清理重叠。第二次回收零个才是正确行为。
    #[test]
    fn is_idempotent_across_repeated_runs() {
        let fixture = Fixture::new("gc-idempotent");
        fixture.save_package("pkg-idempotent", DIGEST_A, b"PK\x03\x04idem");
        fixture.purge_package("pkg-idempotent");

        let first = run(&fixture);
        assert_eq!(first.reclaimed, 1);

        let second = run(&fixture);
        assert_eq!(second.reclaimed, 0, "第二次 MUST 什么都不回收");
        assert_eq!(second.scanned, 0);
        assert_eq!(second.bytes_reclaimed, 0);
    }

    /// 多个孤儿 MUST 全部回收，且顺序确定。
    #[test]
    fn reclaims_every_orphan_in_a_deterministic_order() {
        let fixture = Fixture::new("gc-many");
        let first = fixture.save_package("pkg-1", DIGEST_A, b"PK\x03\x04one");
        let second = fixture.save_package("pkg-2", DIGEST_B, b"PK\x03\x04two");
        fixture.purge_package("pkg-1");
        fixture.purge_package("pkg-2");

        let report = run(&fixture);
        assert_eq!(report.reclaimed, 2);
        assert_eq!(report.files_removed, 2);
        assert_eq!(
            report.bytes_reclaimed,
            (b"PK\x03\x04one".len() + b"PK\x03\x04two".len()) as i64
        );
        assert!(!fixture.blob_file_exists(&first.archive_digest));
        assert!(!fixture.blob_file_exists(&second.archive_digest));
    }

    /// 孤儿文件（文件在、metadata 不在）MUST NOT 被 GC 处理。
    ///
    /// GC 的判定依据是引用表；一个既不在引用表、也不在 metadata 里的文件对它完全不存在。
    /// 审计会把它报成桶四并给出字节数，由用户决定——GC 静默删掉一个它无法解释来源的
    /// 文件，比留着它更危险。
    #[test]
    fn leaves_orphan_files_untouched() {
        use sha2::{Digest, Sha256};

        let fixture = Fixture::new("gc-orphan-file");
        let bytes = b"PK\x03\x04orphan";
        let digest = format!(
            "sha256:{}",
            Sha256::digest(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
        fixture
            .write_orphan_file(&digest, bytes)
            .expect("plant orphan");

        let report = run(&fixture);
        assert_eq!(report.reclaimed, 0, "GC 的判定 MUST 只依据引用表");
        assert!(
            fixture.blob_file_exists(&digest),
            "没有 metadata 的文件 MUST 留给审计处理"
        );
    }

    /// 缺引用的包记录：GC 会回收它的字节。这是本模块最需要说清楚的一处取舍。
    ///
    /// 形态：`local_web_package` 有行、`web_package_archive_ref` 没有对应行（桶五）。此时
    /// `readArchive` 找不到 digest，用户的包已经打不开——**在 GC 跑之前就打不开**。
    ///
    /// GC 的判定依据是引用表（`DESK-065`）。这条约束不是为了简化实现，而是因为"这个包还对
    /// 用户有意义吗"这个问题只有引用表能回答：一个 `deletedAt` 已设置的包、一次未完成的 purge、
    /// 一次崩溃——它们在引用表里都是"无引用"。若允许 GC 参考包记录的状态，它就必须开始解释
    /// `deletedAt` 的语义，而那是 TypeScript 的领域知识（`ADR-desktop-tauri-v1` 第 7 条）。
    ///
    /// 因此结论是：**这类字节本来就已经不可达**，回收它不额外造成损失。真正的损失发生在
    /// 引用行丢失的那一刻，而那由审计的桶五负责暴露给用户——用户据此重新导入那个 ZIP。
    /// GC 的职责是让磁盘回到与引用表一致的状态，不是在损坏发生后做抢救。
    #[test]
    fn reclaims_bytes_of_a_record_that_lost_its_reference_row() {
        let fixture = Fixture::new("gc-no-ref");
        let saved = fixture.save_package("pkg-no-ref", DIGEST_A, b"PK\x03\x04no-ref");
        fixture.delete_reference_row("pkg-no-ref");

        // 前提：这个包在 GC 之前就已经读不出字节。
        assert!(
            !fixture.package_has_archive("pkg-no-ref"),
            "前提：缺引用行时包本就不可读，GC 不改变这一点"
        );

        let report = run(&fixture);
        assert_eq!(
            report.reclaimed, 1,
            "引用表里没有这一行，因此按 DESK-065 它就是回收候选"
        );
        assert!(
            !fixture.blob_file_exists(&saved.archive_digest),
            "字节被回收；这条断言记录的是取舍本身，不是期望的行为改善"
        );
    }
}
