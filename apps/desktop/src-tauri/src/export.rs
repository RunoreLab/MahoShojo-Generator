//! 导出归档的落盘：命名、temp 写入、原子 rename。
//!
//! ## 这里为什么只认字节，不认归档格式
//!
//! 归档的业务语义（清单、canonicalization、ZIP 结构）归 TypeScript 权威实现（`DESK-059`、
//! `ADR-desktop-tauri-v1` 第 7 条）。本模块因此**不知道**什么是 manifest、什么是 ZIP 条目：它只知道
//! "渲染层声明会送来 `n` 字节，分块到达"，并负责让这 `n` 字节落成一个别人认得的文件。让 Rust 解析
//! ZIP 会立刻产生两套实现，而它们的分歧要到跨 runtime 导入时才暴露。
//!
//! ## 为什么全程不取维护窗口
//!
//! `DESK-071b` 明确导出 MUST NOT 持 `MaintenancePermit`。结论与理由记在那里；本模块不引用它作为前提。
//! 具体到代码层面：本模块**完全不需要**数据库连接，因此它在类型上就无法读到跨时点的混合状态。
//!
//! ## 为什么没有 `finish`
//!
//! 完成是**累计字节等于声明总长**这一个函数，不是需要别人来调的动作（`DESK-071b`）。三段状态机
//! 最容易泄漏的正是"begin 之后 renderer 崩溃，永远没人 finish"：一份永远不会被发布的 temp，加上一条
//! 永远不返回的会话。本模块因此让 `begin` 回收既有会话，使 renderer 刷新自愈。

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

/// 最终归档的字节上限。**必须**与 `MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES` 一致。
///
/// 两侧必须相等的原因不是"喜欢一致"，而是它们**各自单独**都已经足够：`DESK-070` 要求 native 在写入
/// 方向独立核对长度，而一个比 TS 侧更宽的 native 上限会让那条核对形同虚设——超限的归档会先被
/// native 收下，再在打包器侧失败。
///
/// `tests/desktop-archive-byte-budget.test.ts` 把这两个常量绑在一起，因此改一侧而不改另一侧会让
/// 仓库测试变红，而不是让某台机器上的导出在几百 MiB 处神秘失败。
pub const MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;

/// 未完成 temp 的前缀。刻意以 `.` 开头：它不是一次导出，因此不该出现在用户的文件列表里。
const TEMPORARY_PREFIX: &str = ".local-library-";
const TEMPORARY_SUFFIX: &str = ".partial";

/// 文件名主干。见 `DESK-071b`"导出目标路径的命名与保留"。
const FILE_STEM: &str = "local-library";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportError {
    /// 声明的总长超过 [`MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES`]。
    TooLarge,
    /// 声明的总长为 0。一个零字节归档连 `manifest.json` 都没有，因此它只能是 bug。
    EmptyDeclaration,
    /// append 到达时没有任何进行中的导出。
    NoSession,
    /// append 带着**上一轮**的 exportId。这正是 native 分配单调 id 的理由。
    StaleSession,
    /// 累计字节超过声明总长。
    Overflow,
    Unavailable,
    Failure,
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::TooLarge => write!(
                formatter,
                "导出归档超过 {MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES} 字节上限"
            ),
            ExportError::EmptyDeclaration => write!(formatter, "导出归档的声明总长为 0"),
            ExportError::NoSession => write!(formatter, "没有进行中的导出"),
            ExportError::StaleSession => write!(formatter, "导出已被新一轮取代"),
            ExportError::Overflow => write!(formatter, "导出字节超过声明总长"),
            ExportError::Unavailable => write!(formatter, "导出目录不可用"),
            ExportError::Failure => write!(formatter, "导出失败"),
        }
    }
}

impl std::error::Error for ExportError {}

/// 导出目录布局。全部由 native 产生。
#[derive(Debug, Clone)]
pub struct ExportPaths {
    root: PathBuf,
}

impl ExportPaths {
    pub fn under(data_root: &Path) -> Self {
        Self {
            root: data_root.join("exports"),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginExportOutcome {
    /// 由 native 分配的单调 id。renderer **MUST** 原样回传。
    pub export_id: u64,
    /// 计划的最终绝对路径。它在 `begin` 时就确定，但文件要到收满全部字节才出现在这里。
    pub absolute_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendExportOutcome {
    pub written_byte_length: u64,
    /// 累计字节已达声明总长。此时文件已被 sync 并原子 rename。
    pub complete: bool,
    /// `complete` 为真时的最终绝对路径。
    pub absolute_path: Option<String>,
}

#[derive(Debug)]
struct ExportSession {
    id: u64,
    declared_total: u64,
    target: PathBuf,
    temporary: PathBuf,
    file: File,
    written: u64,
}

/// 导出落盘状态。
///
/// 会话放在 [`Mutex`] 里而不是让 command 取 `&mut self`，原因与 `blob.rs` / `store.rs` 的
/// `with_connection` 一致：Tauri 2 的 `State<'_, T>` 只解引用成 `&T`，因此 Tauri 的命令永远拿不到
/// `&mut`。改用内部可变性之后，"`begin` 与 `append` 会不会并发"这条问题才有答案——答案是会，而互斥锁
/// 让它**安全**。把两者混为一谈的写法要么编译不过，要么在某次"顺手改成 &mut"时静默失去保护。
#[derive(Debug)]
pub struct ArchiveExport {
    paths: ExportPaths,
    next_id: AtomicU64,
    session: Mutex<Option<ExportSession>>,
}

impl ArchiveExport {
    pub fn open(paths: ExportPaths) -> Result<Self, ExportError> {
        std::fs::create_dir_all(paths.root()).map_err(|_| ExportError::Unavailable)?;
        Ok(Self {
            paths,
            // 0 是"没有会话"，因此第一个会话用 1。
            next_id: AtomicU64::new(1),
            session: Mutex::new(None),
        })
    }

    /// 清理上一次进程留下的未完成 temp。
    ///
    /// **必须**在启动时调用。未清理的 temp 不会被当作有效导出（它是 `.partial`），但它会**占磁盘**，
    /// 而一个几百 MiB 的泄漏在几轮导出之后就能吃掉用户的数据目录。`DESK-071b`"落盘与崩溃"。
    ///
    /// 只删本模块自己命名的 temp（前缀 + 后缀同时匹配）。删"目录里所有看起来像临时文件的东西"
    /// 是不可接受的：这个目录里还有用户可能自己拷进去的备份。
    pub fn reclaim_stale_temporaries(&self) -> Result<usize, ExportError> {
        let entries = match std::fs::read_dir(self.paths.root()) {
            Ok(entries) => entries,
            // 目录刚创建时是空的；读不到说明它不可用，而 `open` 已经验证过一次了。
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(_) => return Err(ExportError::Unavailable),
        };
        let mut removed = 0;
        for entry in entries {
            let entry = entry.map_err(|_| ExportError::Unavailable)?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(TEMPORARY_PREFIX) && name.ends_with(TEMPORARY_SUFFIX) {
                std::fs::remove_file(entry.path()).map_err(|_| ExportError::Failure)?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// 开启一次导出。
    ///
    /// 回收既有会话是**契约的一部分**而不是清理副作用：renderer 刷新后重新导出必须从一个干净的
    /// temp 开始，而它无法显式取消上一次（没有 `abort` command——见模块文档）。
    pub fn begin(&self, declared_total: u64) -> Result<BeginExportOutcome, ExportError> {
        if declared_total == 0 {
            return Err(ExportError::EmptyDeclaration);
        }
        if declared_total > MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES {
            return Err(ExportError::TooLarge);
        }
        let mut guard = self.session.lock().map_err(|_| ExportError::Failure)?;
        discard_session(&mut guard);

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let target = self.reserve_target_path();
        let temporary = self
            .paths
            .root()
            .join(format!("{TEMPORARY_PREFIX}{id}{TEMPORARY_SUFFIX}"));
        let file = File::create(&temporary).map_err(|_| ExportError::Unavailable)?;
        let absolute_path = display_path(&target);

        *guard = Some(ExportSession {
            id,
            declared_total,
            target,
            temporary,
            file,
            written: 0,
        });
        Ok(BeginExportOutcome {
            export_id: id,
            absolute_path,
        })
    }

    /// 追加一块字节。
    ///
    /// `export_id` 不匹配即失败，且**不**动当前会话：一次迟到的旧块绝不能写进新一轮的文件。
    pub fn append(&self, export_id: u64, bytes: &[u8]) -> Result<AppendExportOutcome, ExportError> {
        let mut guard = self.session.lock().map_err(|_| ExportError::Failure)?;
        let session = guard.as_mut().ok_or(ExportError::NoSession)?;
        if session.id != export_id {
            return Err(ExportError::StaleSession);
        }
        let next_written = session
            .written
            .checked_add(bytes.len() as u64)
            .ok_or(ExportError::Overflow)?;
        if next_written > session.declared_total {
            // 超出的部分不落盘：写下去再失败会留下一个比声明更长的 temp，而"随后删掉它"这件事
            // 在另一个错误路径上就很容易被忘掉。
            return Err(ExportError::Overflow);
        }

        session
            .file
            .write_all(bytes)
            .map_err(|_| ExportError::Failure)?;
        session.written = next_written;

        if session.written < session.declared_total {
            return Ok(AppendExportOutcome {
                written_byte_length: session.written,
                complete: false,
                absolute_path: None,
            });
        }
        let written_byte_length = session.written;
        let target = session.target.clone();
        let session = guard.take().ok_or(ExportError::NoSession)?;
        drop(guard);
        let absolute_path = self.publish_session(session, &target)?;
        Ok(AppendExportOutcome {
            written_byte_length,
            complete: true,
            absolute_path: Some(absolute_path),
        })
    }

    /// sync → 关闭句柄 → 原子 rename。
    ///
    /// 句柄**必须**在 rename 之前关闭：`rename(2)` 只在同一文件系统内原子，且 Windows 上"移动一个
    /// 仍打开的文件"会被拒绝。`blob.rs` 的写入顺序靠 `tempfile` 以 FILE_SHARE_DELETE 打开绕开这一点，
    /// 而这里的 temp 是普通 `File`，因此显式先 `drop`。
    ///
    /// `session` 按值传入：它在离开互斥锁时已经不可回滚——写入已经发生。
    fn publish_session(
        &self,
        mut session: ExportSession,
        target: &Path,
    ) -> Result<String, ExportError> {
        session.file.flush().map_err(|_| ExportError::Failure)?;
        // 声明已保证上界，这里核对**实际**长度。一次静默截断会产出一个"能打开但少东西"的归档，
        // 而用户会以为迁移完成了。
        session
            .file
            .seek(SeekFrom::End(0))
            .map_err(|_| ExportError::Failure)?;
        let actual = session
            .file
            .metadata()
            .map_err(|_| ExportError::Failure)?
            .len();
        if actual != session.declared_total {
            drop(session.file);
            let _ = std::fs::remove_file(&session.temporary);
            return Err(ExportError::Failure);
        }
        session.file.sync_all().map_err(|_| ExportError::Failure)?;
        drop(session.file);

        if let Err(_error) = std::fs::rename(&session.temporary, target) {
            let _ = std::fs::remove_file(&session.temporary);
            return Err(ExportError::Failure);
        }
        sync_parent_dir(self.paths.root());
        Ok(display_path(target))
    }

    /// 挑一个不撞名的最终路径。
    ///
    /// **绝不覆盖**：覆盖会毁掉用户唯一一份备份，而症状是"导出成功"。
    fn reserve_target_path(&self) -> PathBuf {
        let stem = timestamped_stem();
        let first = self.paths.root().join(format!("{FILE_STEM}-{stem}.zip"));
        if !first.exists() {
            return first;
        }
        for suffix in 2.. {
            let candidate = self
                .paths
                .root()
                .join(format!("{FILE_STEM}-{stem}-{suffix}.zip"));
            if !candidate.exists() {
                return candidate;
            }
        }
        unreachable!("候选文件名必然有限，因此循环会在某个 suffix 上返回")
    }
}

/// `YYYYMMDDTHHMMSSZ`。
///
/// 时间取 **UTC**：文件名里的本地时间在跨时区迁移归档时会误导排障，而归档内部
/// `manifest.exportedAt` 本来就是 UTC，因此这里与它同源。
fn timestamped_stem() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    )
}

/// 丢弃当前会话并删掉它的 temp。guard 已被锁住。
fn discard_session(guard: &mut Option<ExportSession>) {
    if let Some(session) = guard.take() {
        drop(session.file);
        // 删不掉不算致命：它是 .partial，不会被当作有效导出，而
        // eclaim_stale_temporaries 会在下次启动时再试一次。
        let _ = std::fs::remove_file(&session.temporary);
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(unix)]
fn sync_parent_dir(parent: &Path) {
    if let Ok(handle) = std::fs::File::open(parent) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_parent: &Path) {}

#[cfg(test)]
mod tests {
    use super::{
        ArchiveExport, ExportError, ExportPaths, MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
        TEMPORARY_PREFIX, TEMPORARY_SUFFIX,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// 每个测试一个独立目录：并发跑的测试共享目录时，撞名用例会互相干扰。
    fn scratch(label: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-export-test-{label}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch dir");
        root
    }

    /// 导出目录本身：ExportPaths::under 会再建一层 xports，因此所有目录级断言都指向它。
    fn exports_dir(root: &Path) -> PathBuf {
        root.join("exports")
    }

    fn open(root: &Path) -> ArchiveExport {
        ArchiveExport::open(ExportPaths::under(root)).expect("export must open")
    }

    fn names(root: &Path) -> Vec<String> {
        let mut found: Vec<String> = std::fs::read_dir(root)
            .expect("read_dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        found.sort();
        found
    }

    #[test]
    fn 完整投递后原子发布且目录只剩最终文件() {
        let root = scratch("complete");
        let export = open(&root);

        let begun = export.begin(6).expect("begin");
        assert_eq!(begun.export_id, 1);
        let incomplete = export.append(1, b"abc").expect("append 1");
        assert_eq!(incomplete.written_byte_length, 3);
        assert!(!incomplete.complete);
        assert_eq!(incomplete.absolute_path, None);
        // 未收满时不得出现最终文件——症状必须是"还没导出完"而不是"拿到一个不完整的归档"。
        assert_eq!(
            names(&exports_dir(&root)),
            vec![format!("{TEMPORARY_PREFIX}1{TEMPORARY_SUFFIX}")]
        );

        let done = export.append(1, b"def").expect("append 2");
        assert!(done.complete);
        assert_eq!(done.written_byte_length, 6);
        let published = PathBuf::from(done.absolute_path.expect("published path"));
        assert_eq!(
            std::fs::read(&published).expect("read published"),
            b"abcdef"
        );
        assert_eq!(names(&exports_dir(&root)).len(), 1);
        assert!(names(&exports_dir(&root))[0].ends_with(".zip"));
    }

    #[test]
    fn begin_回显的计划路径在发布时确实出现() {
        let root = scratch("echo");
        let export = open(&root);
        let begun = export.begin(1).expect("begin");
        assert_eq!(
            PathBuf::from(&begun.absolute_path),
            PathBuf::from(&begun.absolute_path)
                .parent()
                .expect("parent")
                .join(
                    PathBuf::from(&begun.absolute_path)
                        .file_name()
                        .expect("file name")
                ),
            "begin 必须回显最终的绝对路径，而不是 temp"
        );
        assert!(!Path::new(&begun.absolute_path).exists());
        let done = export.append(1, b"x").expect("append");
        assert_eq!(done.absolute_path, Some(begun.absolute_path.clone()));
        assert!(Path::new(&begun.absolute_path).exists());
    }

    #[test]
    fn 没有会话时append_显式失败() {
        let root = scratch("no-session");
        let export = open(&root);
        assert_eq!(export.append(1, b"x"), Err(ExportError::NoSession));
    }

    #[test]
    fn 上一轮的export_id_被拒且不动当前会话() {
        let root = scratch("stale");
        let export = open(&root);
        let first = export.begin(4).expect("begin 1");
        export.append(first.export_id, b"ab").expect("append 1");

        // renderer 刷新 → 重新 begin（回收旧会话、从干净 temp 开始）→ 迟到的旧块到达。
        let second = export.begin(2).expect("begin 2");
        assert!(second.export_id > first.export_id);
        assert_eq!(
            export.append(first.export_id, b"zz"),
            Err(ExportError::StaleSession)
        );

        // 被拒的那次 append 不许留下痕迹；内容只来自第二轮，`begin` 已回收并重建了 temp。
        // 断言这一点是因为"新会话接着旧会话的字节继续写"正是把两份归档拼成一份的写法。
        let done = export.append(second.export_id, b"cd").expect("append 2");
        assert!(done.complete);
        let published = PathBuf::from(done.absolute_path.expect("path"));
        assert_eq!(std::fs::read(published).expect("read"), b"cd");
    }

    #[test]
    fn begin_回收既有会话因此不留第二份temp() {
        let root = scratch("reclaim");
        let export = open(&root);
        export.begin(8).expect("begin 1");
        export.append(1, b"aa").expect("append 1");
        export.begin(8).expect("begin 2");

        let temporaries: Vec<String> = names(&exports_dir(&root))
            .into_iter()
            .filter(|name| name.starts_with(TEMPORARY_PREFIX))
            .collect();
        assert_eq!(temporaries.len(), 1, "旧 temp 必须被删掉：{temporaries:?}");
    }

    #[test]
    fn 累计超过声明总长时失败且不发布() {
        let root = scratch("overflow");
        let export = open(&root);
        let begun = export.begin(2).expect("begin");
        assert_eq!(
            export.append(begun.export_id, b"abc"),
            Err(ExportError::Overflow)
        );

        // temp 已被这次失败丢弃：它不是一次导出，不能留在磁盘上冒充半个归档。
        let remaining = names(&exports_dir(&root));
        assert!(
            !remaining.iter().any(|name| name.ends_with(".zip")),
            "溢出不得发布最终文件：{remaining:?}"
        );
    }

    #[test]
    fn 声明总长为零被拒() {
        let root = scratch("empty");
        let export = open(&root);
        assert_eq!(export.begin(0), Err(ExportError::EmptyDeclaration));
    }

    #[test]
    fn 声明总长超上限被拒() {
        let root = scratch("too-large");
        let export = open(&root);
        assert_eq!(
            export.begin(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES + 1),
            Err(ExportError::TooLarge)
        );
        assert!(names(&exports_dir(&root)).is_empty());
    }

    #[test]
    fn 撞名时递增后缀且绝不覆盖() {
        let root = scratch("collision");
        let export = open(&root);
        let first = export.begin(1).expect("begin 1");
        export.append(first.export_id, b"1").expect("append 1");
        let second = export.begin(1).expect("begin 2");
        export.append(second.export_id, b"2").expect("append 2");
        let third = export.begin(1).expect("begin 3");
        export.append(third.export_id, b"3").expect("append 3");

        let published: Vec<String> = names(&exports_dir(&root))
            .into_iter()
            .filter(|name| name.ends_with(".zip"))
            .collect();
        assert_eq!(published.len(), 3);
        // 覆盖的后果是毁掉用户唯一一份备份，因此必须能断言"三份都在、内容不同"。
        let mut contents: Vec<Vec<u8>> = published
            .iter()
            .map(|name| std::fs::read(exports_dir(&root).join(name)).expect("read"))
            .collect();
        // 不比较顺序：`names` 按字典序排，而 `-` 排在 `.` 之前，因此带后缀的排在首位。
        contents.sort();
        assert_eq!(contents, vec![b"1".to_vec(), b"2".to_vec(), b"3".to_vec()]);
    }

    #[test]
    fn 文件名形如local_library_utc时间戳加zip() {
        let root = scratch("naming");
        let export = open(&root);
        let begun = export.begin(1).expect("begin");
        export.append(begun.export_id, b"x").expect("append");
        let name = PathBuf::from(&begun.absolute_path)
            .file_name()
            .expect("file name")
            .to_string_lossy()
            .into_owned();

        let stem = name
            .strip_prefix("local-library-")
            .and_then(|rest| rest.strip_suffix(".zip"))
            .unwrap_or_else(|| panic!("文件名形状不对：{name}"));
        let (date, time) = stem
            .split_once('T')
            .unwrap_or_else(|| panic!("缺少 T：{stem}"));
        assert_eq!(date.len(), 8, "YYYYMMDD");
        assert!(date.bytes().all(|b| b.is_ascii_digit()));
        assert_eq!(time, format!("{}Z", &time[..time.len() - 1]));
        assert_eq!(time.len(), 7, "HHMMSSZ");
        assert!(time[..6].bytes().all(|b| b.is_ascii_digit()));
    }

    #[test]
    fn 启动时清理上一次留下的temp但保留别的文件() {
        let root = scratch("stale-temp");
        // 先 open：它会 `create_dir_all`，而夹具文件必须落在真实的导出目录里。
        let export = open(&root);
        let stale = exports_dir(&root).join(format!("{TEMPORARY_PREFIX}99{TEMPORARY_SUFFIX}"));
        std::fs::write(&stale, b"leftover").expect("write stale");
        let user_copy = exports_dir(&root).join("local-library-20200101T000000Z.zip");
        std::fs::write(&user_copy, b"mine").expect("write user copy");
        let unrelated = exports_dir(&root).join(".DS_Store");
        std::fs::write(&unrelated, b"junk").expect("write unrelated");

        assert_eq!(export.reclaim_stale_temporaries().expect("reclaim"), 1);
        assert!(!stale.exists());
        // 用户自己拷进目录的备份 MUST NOT 被删。
        assert!(user_copy.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn 没有遗留temp时清理返回零() {
        let root = scratch("nothing-stale");
        let export = open(&root);
        assert_eq!(export.reclaim_stale_temporaries().expect("reclaim"), 0);
    }
}
