//! 内容寻址 blob 存储（D2.1）。
//!
//! V1 的唯一生产消费者是 **Web Package 原始 ZIP 字节**（`DESK-054`）。图片、附件等消费者等到
//! 出现真实需求再扩展，因此本模块**不**预建 image metadata、缩略图管线或引用角色。
//!
//! ## 崩溃一致性（`DESK-051`）
//!
//! 写入顺序固定为：
//!
//! ```text
//! 同目录临时文件 → 写入并边写边算摘要 → flush/sync → 同卷原子 rename → 写 SQLite metadata
//! ```
//!
//! 两个方向的不对称是刻意的：
//!
//! - **可能有孤儿 blob**（文件在、metadata 不在）。下一次审计会发现并回收。
//! - **MUST NOT** 有悬空记录（metadata 在、文件不在）。因此 metadata 必须**后**写，且只在
//!   文件已确认落到目标路径之后。
//!
//! ## 为什么临时文件必须在同一目录
//!
//! `rename(2)` 只在同一文件系统内原子。把临时文件放到 `%TEMP%` 再 rename 会 `EXDEV`，静默
//! 退化成"拷贝 + 删除"，中途崩溃就留下半个 blob。`tempfile` 的 `NamedTempFile::new_in`
//! 保证同目录与唯一命名。
//!
//! ## 关于父目录 fsync
//!
//! Unix 上 rename 之后需要 fsync 父目录，目录项才真正落盘。**Windows 上这一步是 no-op**——
//! 无法把目录当文件打开。V1 首发平台正是 Windows x64，因此这里只在 `#[cfg(unix)]` 下执行，
//! 并如实记录该平台没有这项保证，而不是假装它存在。
//!
//! ## 物理布局不进契约（`DESK-057`）
//!
//! [`blob_path`] 是**唯一**决定落盘路径的地方。分片（Git / Kopia 式的 `ab/cd/...`）是
//! adapter 的实现细节，改它不需要数据迁移、也不改变用户可见语义。

use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::store::{lock_connection, SharedConnection};

/// 单个 blob 的字节上限。
///
/// V1 的消费者是 Web 包 ZIP。它远小于 Web 侧对**解压后**内容的 256 MiB 预算，因此这个上限
/// 存在的意义是拒绝明显异常或恶意构造的输入，而不是复刻那条预算。
pub const MAX_BLOB_BYTES: usize = 64 * 1024 * 1024;

pub const MIGRATION_3: &str = r#"
CREATE TABLE IF NOT EXISTS blob (
    digest             TEXT PRIMARY KEY NOT NULL,
    byte_length        INTEGER NOT NULL,
    created_at         TEXT NOT NULL,
    last_referenced_at TEXT NOT NULL
) STRICT;
"#;

/// 内容寻址 blob 存储的失败类别。
///
/// 与 `StoreError` 分开：blob 的失败模式（摘要不符、字节已损坏）与记录存储的那些
/// （索引列不一致、状态转移非法）没有交集，合并只会让调用方拿到一个无法据以行动的 code。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobError {
    Unavailable,
    /// 调用方声明的摘要与字节实际内容不符。**永不**信任调用方给的地址。
    DigestMismatch,
    /// 已存字节与其摘要不符，且手上没有已知正确内容。fail closed：不删、不猜、不返回半个包。
    Corrupt {
        digest: String,
    },
    TooLarge,
    NotFound,
    Failure,
}

impl BlobError {
    pub fn code(&self) -> &'static str {
        match self {
            BlobError::Unavailable => "blob-unavailable",
            BlobError::DigestMismatch => "blob-digest-mismatch",
            BlobError::Corrupt { .. } => "blob-corrupt",
            BlobError::TooLarge => "blob-too-large",
            BlobError::NotFound => "blob-not-found",
            BlobError::Failure => "blob-failure",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            BlobError::Unavailable => "blob storage is unavailable",
            BlobError::DigestMismatch => "blob content does not match the declared digest",
            BlobError::Corrupt { .. } => "stored blob does not match its digest",
            BlobError::TooLarge => "blob exceeds its byte ceiling",
            BlobError::NotFound => "blob does not exist",
            BlobError::Failure => "blob storage operation failed",
        }
    }
}

impl Serialize for BlobError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("BlobError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

/// 一次 blob 写入的结果。
///
/// 三态而不是布尔：调用方与 UI 需要区分"首次落盘"、"本来就已存在（正常去重）"与
/// "发现并修复了损坏"。把第三种悄悄吞掉会让存储损坏在用户界面完全不可见。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BlobWriteOutcome {
    /// 首次落盘。
    Stored,
    /// 已存在且摘要与长度校验通过。视为成功（`DESK-051`）。
    AlreadyPresent,
    /// 已存在的字节与摘要不符，已用本次提供的正确内容覆盖修复。**必须**对调用方可见。
    Repaired,
}

/// blob 元数据。
///
/// 目前只有测试读取它——完整性审计与 GC（D2.2）才会用到真实的读取路径，因此这里
/// 限定为测试可见，免得为尚未存在的消费者保留一个公开 API。
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobMetadata {
    pub digest: String,
    pub byte_length: i64,
    pub created_at: String,
    pub last_referenced_at: String,
}

/// blob 存储的路径布局。全部由 native 产生。
#[derive(Debug, Clone)]
pub struct BlobPaths {
    root: PathBuf,
}

impl BlobPaths {
    pub fn under(data_root: &Path) -> Self {
        Self {
            root: data_root.join("blobs"),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// 内容寻址 blob 的落盘路径。这是**唯一**决定路径的地方（见模块文档关于布局的说明）。
///
/// 刻意**不带扩展名**：内容已由摘要唯一标识，扩展名只是给文件管理器看的提示，而它会让
/// "当初按什么名字存的"变成 GC 时的一个歧义源。导出包里的 `assets/<digest>.<ext>` 路径是
/// 导出格式的另一件事，由 `archive.ts` 在导出时生成。
pub fn blob_path(paths: &BlobPaths, digest: &str) -> Result<PathBuf, BlobError> {
    let hex = digest
        .strip_prefix("sha256:")
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        })
        .ok_or(BlobError::DigestMismatch)?;
    Ok(paths.root().join(hex))
}

/// 校验摘要字符串的形状，并在可能时返回其小写 hex 部分。
pub fn parse_digest(digest: &str) -> Result<&str, BlobError> {
    digest
        .strip_prefix("sha256:")
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .ok_or(BlobError::DigestMismatch)
}

/// 计算字节内容的 `sha256:<hex>` 摘要。
pub fn digest_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hex: String = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("sha256:{hex}")
}

pub struct BlobStore {
    paths: BlobPaths,
    connection: SharedConnection,
}

/// 打开 blob 存储。`connection` **MUST** 已经过 [`crate::store::configure_and_migrate`]，
/// 且**MUST** 与其它 store 共用同一条（`DESK-065`）。
///
/// 刻意不在这里自己跑迁移：blob 表与本地卡表在同一个库里，迁移阶梯只应由
/// `store.rs` 的那一份驱动。两处各自建表会产出"版本号说到了、表却缺一半"的库。
pub fn open(paths: BlobPaths, connection: SharedConnection) -> Result<BlobStore, BlobError> {
    std::fs::create_dir_all(paths.root()).map_err(|_| BlobError::Unavailable)?;
    Ok(BlobStore { paths, connection })
}

/// 内存库 + 真实临时目录。
///
/// blob 的**文件**落在真实文件系统上（写入顺序、原子 rename、损坏自愈都依赖它），
/// 因此只有 metadata 那半边能在内存里跑。目录必须是真的：`create_dir_all` 无法在
/// 形如 `:memory:` 的路径下工作。
#[cfg(test)]
pub fn open_in_memory() -> Result<BlobStore, BlobError> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "mahoshojo-blob-test-{}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let paths = BlobPaths::under(&root);

    // 走与生产同一份迁移阶梯，而不是就地建表。
    let connection = crate::store::open_in_memory_connection().map_err(|_| BlobError::Failure)?;
    open(paths, connection)
}

impl BlobStore {
    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, BlobError>,
    ) -> Result<T, BlobError> {
        let guard = lock_connection(&self.connection).map_err(|_| BlobError::Failure)?;
        operation(&guard)
    }

    /// 写入一段内容寻址的 blob。
    ///
    /// `digest` 由调用方声明，但**必须**与 `bytes` 的实际内容一致，否则拒绝：路径由摘要派生，
    /// 让调用方可以为任意字节"指定"一个地址，会把一份正确内容挤到另一个摘要的路径上，
    /// 之后所有"已存在即成功"的判断都建立在错误的前提上。
    pub fn write(
        &self,
        digest: &str,
        bytes: &[u8],
        now: &str,
    ) -> Result<BlobWriteOutcome, BlobError> {
        parse_digest(digest)?;
        if bytes.len() > MAX_BLOB_BYTES {
            return Err(BlobError::TooLarge);
        }
        let actual = digest_of(bytes);
        if actual != digest {
            return Err(BlobError::DigestMismatch);
        }

        let target = blob_path(&self.paths, digest)?;
        let byte_length = bytes.len() as i64;

        match std::fs::metadata(&target) {
            Ok(metadata) if metadata.len() == bytes.len() as u64 => {
                // 长度相同才值得读回来校验：这是"已存在即成功"这条规则的实质。
                let existing = std::fs::read(&target).map_err(|_| BlobError::Failure)?;
                if digest_of(&existing) == digest {
                    self.touch(digest, existing.len() as i64, now)?;
                    return Ok(BlobWriteOutcome::AlreadyPresent);
                }
                // 路径由摘要派生，因此"已存在但摘要不符"是确定的存储损坏。
                // 手上这份字节已验证过就是该摘要的内容，覆盖它不可能丢数据——因此自愈，
                // 但**必须**让调用方知道（`DESK-056`）。
                write_atomically(&target, bytes)?;
                self.record(digest, byte_length, now)?;
                return Ok(BlobWriteOutcome::Repaired);
            }
            Ok(_) => {
                // 长度不同：同样不可能是正确内容（摘要相同则长度必相同）。
                write_atomically(&target, bytes)?;
                self.record(digest, byte_length, now)?;
                return Ok(BlobWriteOutcome::Repaired);
            }
            Err(_) => {}
        }

        // 文件不在。它是**首次落盘**，还是 metadata 还在而字节丢了（被人删、被清理工具扫掉、
        // 磁盘故障）？两者对用户的意义完全不同：后者意味着这台设备的库已经不健康，需要
        // 一次完整性检查（`DESK-065` 的审计）。报 `stored` 会把这种修复说成正常写入，
        // 于是健康告警漏掉整整一类问题。
        let outcome = match self.exists_in_metadata_unchecked(digest) {
            true => BlobWriteOutcome::Repaired,
            false => BlobWriteOutcome::Stored,
        };
        write_atomically(&target, bytes)?;
        self.record(digest, byte_length, now)?;
        Ok(outcome)
    }

    /// metadata 里是否已有该 digest。
    ///
    /// 与 [`Self::exists_in_metadata`] 的区别是不做 digest 语法解析：调用方已经校验过，
    /// 这里只是为"该报 `stored` 还是 `repaired`"取一个事实。
    fn exists_in_metadata_unchecked(&self, digest: &str) -> bool {
        self.with_connection(|connection| {
            Ok(connection
                .query_row(
                    "SELECT 1 FROM blob WHERE digest = ?1",
                    rusqlite::params![digest],
                    |_| Ok(()),
                )
                .is_ok())
        })
        .unwrap_or(false)
    }

    /// 读取一个 blob，并**校验**它的摘要。
    ///
    /// 校验失败时 fail closed：返回 `Corrupt` 而不返回字节。返回一个"看起来能用但内容被改过"
    /// 的 ZIP，比明确报错危险得多——它会被解包成一个用户从未安装过的包。
    pub fn read(&self, digest: &str) -> Result<Vec<u8>, BlobError> {
        parse_digest(digest)?;
        let target = blob_path(&self.paths, digest)?;
        let bytes = match std::fs::read(&target) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(BlobError::NotFound)
            }
            Err(_) => return Err(BlobError::Failure),
        };
        if digest_of(&bytes) != digest {
            return Err(BlobError::Corrupt {
                digest: digest.to_string(),
            });
        }
        Ok(bytes)
    }

    #[cfg(test)]
    pub fn metadata(&self, digest: &str) -> Result<Option<BlobMetadata>, BlobError> {
        parse_digest(digest)?;
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT digest, byte_length, created_at, last_referenced_at
                     FROM blob WHERE digest = ?1",
                )
                .map_err(|_| BlobError::Failure)?;
            let mut rows = statement
                .query(rusqlite::params![digest])
                .map_err(|_| BlobError::Failure)?;
            match rows.next().map_err(|_| BlobError::Failure)? {
                Some(row) => Ok(Some(BlobMetadata {
                    digest: row.get(0).map_err(|_| BlobError::Failure)?,
                    byte_length: row.get(1).map_err(|_| BlobError::Failure)?,
                    created_at: row.get(2).map_err(|_| BlobError::Failure)?,
                    last_referenced_at: row.get(3).map_err(|_| BlobError::Failure)?,
                })),
                None => Ok(None),
            }
        })
    }

    #[cfg(test)]
    pub fn exists_in_metadata(&self, digest: &str) -> Result<bool, BlobError> {
        Ok(self.metadata(digest)?.is_some())
    }

    /// metadata 里记录的字节长度。配额估算与进度显示依赖它，因此它必须是真的。
    #[cfg(test)]
    pub fn byte_length(&self, digest: &str) -> Result<Option<i64>, BlobError> {
        Ok(self.metadata(digest)?.map(|row| row.byte_length))
    }

    /// 更新最后引用时间（让 GC 的"很久没用"判断有意义）；metadata 缺失时按孤儿补记。
    ///
    /// `byte_length` 必须是**实际**长度。补记成 0 会让"这个 blob 有多大"变成一个谎，而
    /// 配额估算与进度显示都建立在这个数字上。
    fn touch(&self, digest: &str, byte_length: i64, now: &str) -> Result<(), BlobError> {
        self.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE blob SET last_referenced_at = ?2 WHERE digest = ?1",
                    rusqlite::params![digest, now],
                )
                .map_err(|_| BlobError::Failure)?;
            if changed == 0 {
                // 文件在、metadata 不在：一次崩溃中断的写入留下的孤儿。
                // 补记而不是报错，让这次写入正常完成——孤儿状态本身是允许的。
                insert_metadata(connection, digest, byte_length, now)?;
            }
            Ok(())
        })
    }

    /// 写入或更新 metadata。
    ///
    /// `created_at` 在重写时保持首次落盘时间：它是"这个 blob 何时进入本机"的事实，
    /// 被一次自愈覆盖改掉就丢了。
    fn record(&self, digest: &str, byte_length: i64, now: &str) -> Result<(), BlobError> {
        self.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE blob SET byte_length = ?2, last_referenced_at = ?3 WHERE digest = ?1",
                    rusqlite::params![digest, byte_length, now],
                )
                .map_err(|_| BlobError::Failure)?;
            if changed == 0 {
                insert_metadata(connection, digest, byte_length, now)?;
            }
            Ok(())
        })
    }
}

fn insert_metadata(
    connection: &Connection,
    digest: &str,
    byte_length: i64,
    now: &str,
) -> Result<(), BlobError> {
    connection
        .execute(
            "INSERT OR IGNORE INTO blob (digest, byte_length, created_at, last_referenced_at)
             VALUES (?1, ?2, ?3, ?3)",
            rusqlite::params![digest, byte_length, now],
        )
        .map_err(|_| BlobError::Failure)?;
    Ok(())
}

/// 同目录临时文件 → sync → 原子 rename。
///
/// 目标目录必须已存在：临时文件与目标同目录，因此 `create_dir_all` 只在入口做一次。
fn write_atomically(target: &Path, bytes: &[u8]) -> Result<(), BlobError> {
    let parent = target.parent().ok_or(BlobError::Failure)?.to_path_buf();
    std::fs::create_dir_all(&parent).map_err(|_| BlobError::Unavailable)?;

    let mut temporary =
        tempfile::NamedTempFile::new_in(&parent).map_err(|_| BlobError::Unavailable)?;
    temporary.write_all(bytes).map_err(|_| BlobError::Failure)?;
    // 落盘后才 rename：否则崩溃会留下一个"看起来完整"却内容残缺的目标文件，
    // 而它按摘要是不可疑的。
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| BlobError::Failure)?;

    // `persist` 自己完成 rename 并交回已重命名文件的句柄。
    // Windows 上"移动一个仍打开的文件"会被拒绝，但 `tempfile` 以 FILE_SHARE_DELETE 打开，
    // 因此这里不需要额外的 close-then-rename 步骤。
    let _handle = temporary.persist(target).map_err(|_| BlobError::Failure)?;

    fsync_parent_dir(&parent);
    Ok(())
}

/// Unix 上 fsync 父目录，让 rename 本身在断电后也成立。
///
/// Windows 上是 no-op：无法把目录当文件打开，NTFS 由文件系统自行保证元数据落盘。
/// 这里如实按平台区分，而不是在 Windows 上假装做了。
#[cfg(unix)]
fn fsync_parent_dir(parent: &Path) {
    if let Ok(handle) = std::fs::File::open(parent) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn fsync_parent_dir(_parent: &Path) {}

#[cfg(test)]
mod tests {
    use super::{
        digest_of, open, open_in_memory, parse_digest, BlobError, BlobPaths, BlobStore,
        BlobWriteOutcome, MAX_BLOB_BYTES, MIGRATION_3,
    };
    use rusqlite::Connection;

    const NOW: &str = "2026-09-30T12:00:00Z";

    fn store() -> BlobStore {
        open_in_memory().expect("in-memory blob store must open")
    }

    fn bytes_of(text: &str) -> (String, Vec<u8>) {
        let bytes = text.as_bytes().to_vec();
        (digest_of(&bytes), bytes)
    }

    #[test]
    fn stores_content_and_reports_the_outcome() {
        let store = store();
        let (digest, bytes) = bytes_of("zip-one");

        assert_eq!(
            store.write(&digest, &bytes, NOW),
            Ok(BlobWriteOutcome::Stored)
        );
        assert_eq!(store.read(&digest), Ok(bytes.clone()));
        assert!(store
            .exists_in_metadata(&digest)
            .expect("metadata must be readable"));

        let metadata = store
            .metadata(&digest)
            .expect("metadata must be readable")
            .expect("must exist");
        assert_eq!(metadata.byte_length, bytes.len() as i64);
        assert_eq!(metadata.created_at, NOW);
        assert_eq!(metadata.last_referenced_at, NOW);
    }

    /// metadata 还在、字节丢了 → 重写 MUST 报 `repaired`。
    ///
    /// 报 `stored` 会把"这台设备的库已经不健康"说成一次正常写入，于是健康告警漏掉整整
    /// 一类问题：文件被删、被清理工具扫掉、或磁盘故障。`DESK-056` 要求"已修复损坏"对调用方
    /// 可见，这个形态同样算修复。
    #[test]
    fn a_rewritten_blob_whose_metadata_survived_reports_repaired() {
        let store = store();
        let (digest, bytes) = bytes_of("zip-lost-file");
        store.write(&digest, &bytes, NOW).expect("first write");

        // 只删字节，metadata 与其长度/引用时间都留着。
        let target = super::blob_path(&store.paths, &digest).expect("path");
        std::fs::remove_file(&target).expect("simulate a lost blob file");
        assert!(!target.exists());
        assert!(store.exists_in_metadata(&digest).expect("metadata"));

        assert_eq!(
            store.write(&digest, &bytes, NOW),
            Ok(BlobWriteOutcome::Repaired),
            "字节丢失后的重写是一次修复，不是首次落盘"
        );
        assert_eq!(store.read(&digest), Ok(bytes));
        // 首次落盘时间不应被这次修复改写：它是"这个 blob 何时进入本机"的事实。
        assert_eq!(
            store
                .metadata(&digest)
                .expect("metadata")
                .expect("must exist")
                .created_at,
            NOW
        );
    }

    #[test]
    fn a_second_identical_write_is_a_success_not_an_error() {
        // DESK-051：已存在且摘要/长度校验通过的 blob MUST 视为成功。
        let store = store();
        let (digest, bytes) = bytes_of("zip-twice");
        store.write(&digest, &bytes, NOW).expect("first write");

        assert_eq!(
            store.write(&digest, &bytes, "2026-10-01T00:00:00Z"),
            Ok(BlobWriteOutcome::AlreadyPresent),
        );
        assert_eq!(store.read(&digest), Ok(bytes));

        // 去重仍要推进最后引用时间，否则 GC 无法区分"常用"与"久未使用"。
        let metadata = store
            .metadata(&digest)
            .expect("metadata")
            .expect("must exist");
        assert_eq!(metadata.last_referenced_at, "2026-10-01T00:00:00Z");
        assert_eq!(metadata.created_at, NOW, "首次落盘时间不得被后续写入改写");
    }

    #[test]
    fn refuses_bytes_that_do_not_match_the_declared_digest() {
        // 让调用方能为任意字节"指定"地址，会把正确内容挤到另一个摘要的路径上。
        let store = store();
        let (digest, _) = bytes_of("honest");
        let (_, other) = bytes_of("tampered");

        assert_eq!(
            store.write(&digest, &other, NOW),
            Err(BlobError::DigestMismatch),
        );
        assert_eq!(
            store.read(&digest),
            Err(BlobError::NotFound),
            "不得留下任何痕迹"
        );
    }

    #[test]
    fn rejects_a_malformed_digest_instead_of_guessing_a_path() {
        for digest in [
            "sha256:short",
            "md5:0123456789abcdef0123456789abcdef",
            "sha256:0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdef",
            "",
        ] {
            assert_eq!(
                parse_digest(digest),
                Err(BlobError::DigestMismatch),
                "{digest}"
            );
        }
        assert!(parse_digest(&format!("sha256:{}", "a".repeat(64))).is_ok());
    }

    #[test]
    fn self_heals_a_corrupted_blob_and_says_so() {
        let store = store();
        let (digest, bytes) = bytes_of("zip-corrupt");
        store.write(&digest, &bytes, NOW).expect("write");

        // 模拟外部损坏：文件在，但内容不是它声称的内容。
        let target = super::blob_path(&store.paths, &digest).expect("path");
        std::fs::write(&target, b"not the zip you are looking for").expect("corrupt");

        assert_eq!(
            store.write(&digest, &bytes, NOW),
            Ok(BlobWriteOutcome::Repaired)
        );
        assert_eq!(store.read(&digest), Ok(bytes), "修复后必须可读且内容正确");
    }

    #[test]
    fn self_heals_a_length_mismatch_too() {
        let store = store();
        let (digest, bytes) = bytes_of("zip-truncated");
        store.write(&digest, &bytes, NOW).expect("write");

        let target = super::blob_path(&store.paths, &digest).expect("path");
        std::fs::write(&target, &bytes[..2]).expect("truncate");

        assert_eq!(
            store.write(&digest, &bytes, NOW),
            Ok(BlobWriteOutcome::Repaired)
        );
        assert_eq!(store.read(&digest), Ok(bytes));
    }

    #[test]
    fn reading_a_corrupted_blob_fails_closed_instead_of_returning_bytes() {
        // DESK-056：没有已知正确内容时 MUST NOT 删、MUST NOT 猜、MUST NOT 返回半个内容。
        let store = store();
        let (digest, bytes) = bytes_of("zip-unreadable");
        store.write(&digest, &bytes, NOW).expect("write");

        let target = super::blob_path(&store.paths, &digest).expect("path");
        std::fs::write(&target, b"silently replaced").expect("corrupt");

        assert_eq!(
            store.read(&digest),
            Err(BlobError::Corrupt {
                digest: digest.clone()
            }),
        );
        // 损坏的内容不得被删除：它是唯一线索，删掉就再也无从判断发生了什么。
        assert!(target.exists(), "fail closed 不得删除损坏文件");
    }

    #[test]
    fn refuses_content_beyond_the_ceiling() {
        let store = store();
        let oversized = vec![0_u8; MAX_BLOB_BYTES + 1];
        let digest = digest_of(&oversized);
        assert_eq!(
            store.write(&digest, &oversized, NOW),
            Err(BlobError::TooLarge),
        );
        assert!(!super::blob_path(&store.paths, &digest)
            .expect("path")
            .exists());
    }

    #[test]
    fn missing_content_reports_not_found_rather_than_empty_bytes() {
        let store = store();
        let missing = format!("sha256:{}", "0".repeat(64));
        assert_eq!(store.read(&missing), Err(BlobError::NotFound));
        assert_eq!(store.metadata(&missing), Ok(None));
    }

    /// 崩溃一致性的核心不变量（`DESK-051`）。
    ///
    /// 两个方向是**不对称**的，测试因此同时断言两个方向：
    ///
    /// - 可能有孤儿 blob（文件在、metadata 不在）——允许，由审计回收；
    /// - **MUST NOT** 有悬空记录（metadata 在、文件不在）——metadata 只在文件确认落盘后写。
    ///
    /// 后者是关键：如果顺序反过来（先写 metadata 再落文件），崩溃就会造出"引用一个不存在的
    /// 字节"的记录，而这种损坏无法被任何自愈路径修复。
    #[test]
    fn metadata_is_never_written_before_the_bytes_land() {
        let store = open_in_memory().expect("in-memory blob store must open");
        let (digest, bytes) = bytes_of("zip-ordering");
        store.write(&digest, &bytes, NOW).expect("write");

        // 删掉文件、留下 metadata = 悬空记录。这不会由本模块的写入顺序产生，
        // 但一旦发生必须被读路径发现，而不是静默返回一个空 ZIP。
        let target = super::blob_path(&store.paths, &digest).expect("path");
        std::fs::remove_file(&target).expect("simulate a lost file");

        assert_eq!(store.read(&digest), Err(BlobError::NotFound));
        assert!(
            store.exists_in_metadata(&digest).expect("metadata"),
            "metadata 仍在，正是悬空记录的可观测形态"
        );
        // 重写同一内容会把字节补回来，而不是留下一条指向缺失文件的记录。
        // 报 `repaired` 而不是 `stored`：metadata 还在说明这个 blob 曾经落过盘，如今字节
        // 丢了——把这次补写说成"首次落盘"会让健康告警漏掉这一类问题。
        assert_eq!(
            store.write(&digest, &bytes, NOW),
            Ok(BlobWriteOutcome::Repaired)
        );
        assert_eq!(store.read(&digest), Ok(bytes));
    }

    #[test]
    fn a_failed_file_write_leaves_no_metadata_behind() {
        // 直接断言"顺序"而不是"最终状态"：让落盘失败，metadata 必须是干净的。
        //
        // 用一个**目录**占住目标路径：同目录的临时文件能建好，`persist` 却无法把文件
        // 重命名到一个目录上，于是确定性失败，不需要权限或注入。
        let store = open_in_memory().expect("in-memory blob store must open");
        let (digest, bytes) = bytes_of("zip-write-fails");
        let target = super::blob_path(&store.paths, &digest).expect("path");
        std::fs::create_dir(&target).expect("occupy the target path with a directory");

        assert!(store.write(&digest, &bytes, NOW).is_err());
        assert!(
            !store.exists_in_metadata(&digest).expect("metadata"),
            "落盘失败时不得留下 metadata —— 那就是一条指向不存在字节的悬空记录"
        );

        let _ = std::fs::remove_dir(&target);
    }

    #[test]
    fn an_orphan_file_without_metadata_is_tolerated_and_backfilled() {
        // 孤儿形态是允许存在的：一次崩溃中断的写入会留下它。再次写入同一内容必须把它
        // 补记进 metadata，而不是因为"文件已存在"就误判成损坏并覆盖。
        let store = open_in_memory().expect("in-memory blob store must open");
        let (digest, bytes) = bytes_of("zip-orphan");
        let target = super::blob_path(&store.paths, &digest).expect("path");
        std::fs::write(&target, &bytes).expect("simulate a file that landed before metadata");

        assert!(!store.exists_in_metadata(&digest).expect("metadata"));
        assert_eq!(
            store.write(&digest, &bytes, NOW),
            Ok(BlobWriteOutcome::AlreadyPresent)
        );
        assert!(
            store.exists_in_metadata(&digest).expect("metadata"),
            "去重命中的孤儿必须被补记，否则 GC 会把它当孤儿回收掉一个正在被引用的 blob"
        );
        // 补记的长度必须是真实长度。记成 0 会让配额估算与进度显示看到一个谎。
        assert_eq!(
            store.byte_length(&digest).expect("byte length"),
            Some(bytes.len() as i64),
            "孤儿补记的长度必须来自实际字节"
        );
    }

    #[test]
    fn write_order_leaves_no_metadata_when_the_file_never_landed() {
        // 崩溃窗口的可观测形态：文件在、metadata 不在 = 孤儿，允许存在；
        // metadata 在、文件不在 = 悬空记录，MUST NOT。
        let store = open_in_memory().expect("in-memory blob store must open");
        let (digest, bytes) = bytes_of("zip-orphan-only");
        store.write(&digest, &bytes, NOW).expect("write");

        // 一个"只看到文件、看不到 metadata"的视角：换一个**独立**内存库指向同一目录。
        // 必须用新连接而不是 clone：D2.2a 起生产路径只有一条连接，而这条用例要的恰恰是
        // "另一条连接看不见这些 metadata"，共享连接会把它变成同义反复。
        let other = open(
            BlobPaths::under(store.paths.root().parent().expect("data root")),
            crate::store::open_in_memory_connection().expect("open"),
        )
        .expect("open");
        assert!(!other.exists_in_metadata(&digest).expect("metadata"));
        assert!(
            super::blob_path(&store.paths, &digest)
                .expect("path")
                .exists(),
            "孤儿形态是允许的"
        );
    }

    #[test]
    fn the_schema_declares_blob_as_a_strict_table() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(MIGRATION_3).expect("migrate");
        let sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'blob'",
                [],
                |row| row.get(0),
            )
            .expect("blob table must exist");
        assert!(sql.contains("STRICT"), "blob 表必须是 STRICT：{sql}");
        assert!(sql.contains("digest             TEXT PRIMARY KEY"), "{sql}");
    }

    #[test]
    fn error_projection_is_stable_and_carries_no_blob_content() {
        for error in [
            BlobError::Unavailable,
            BlobError::DigestMismatch,
            BlobError::Corrupt {
                digest: format!("sha256:{}", "a".repeat(64)),
            },
            BlobError::TooLarge,
            BlobError::NotFound,
            BlobError::Failure,
        ] {
            let value = serde_json::to_value(&error).expect("error must serialize");
            assert_eq!(
                value.as_object().expect("object").len(),
                2,
                "error projection must contain only code and message"
            );
            assert!(!value["message"].as_str().expect("message").is_empty());
            assert!(
                !value["message"]
                    .as_str()
                    .expect("message")
                    .contains("sha256:"),
                "message 不得回显摘要"
            );
        }
    }
}
