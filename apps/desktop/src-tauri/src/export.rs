//! 导出归档的落盘：命名、temp 写入、原子发布。
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
//!
//! ## 为什么 temp 交给 RAII 而不是自己维护路径
//!
//! 溢出、写失败、落盘长度不符、`fsync` 失败、发布失败——每一条都是"已经写了一部分字节、然后失败"
//! 的路径。把这个责任放进 [`tempfile::NamedTempFile`] 的 `Drop` 之后，本模块就不必在每条错误
//! 分支上重复"drop 句柄 + 删文件"，而漏掉某一条的后果是一个几百 MiB 的垃圾文件——症状（导出失败、
//! 磁盘满了）与根因（某条错误路径忘了清理）完全无关。
//!
//! RAII 保证的是**一次删除尝试**，不是删除成功：`TempPath::drop` 忽略 `remove_file` 的错误，因此
//! 唯一有保证的清理是启动时的 [`ArchiveExport::reclaim_stale_temporaries`]。它也不保证清掉本进程
//! 之外的残留——那是单实例守卫（`DESK-065` / `DESK-068`）的职责。

use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tempfile::NamedTempFile;

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

/// 导出归档失败。
///
/// 序列化形状是 `{code, message}` 而不是枚举名，理由是**跨语言契约**：渲染层用
/// `DesktopArchiveExportErrorSchema` 校验它，而那个 schema 是 `.strict()` 的对象。枚举名会
/// 变成 `"TooLarge"`，于是每一次失败都变成一次"渲染层拒绝了这个响应"——症状是 UI 拿不到错误码，
/// 只能显示一句无法归类的失败。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportError {
    /// 声明的总长超过 [`MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES`]。
    TooLarge,
    /// 声明的总长为 0。一个零字节归档连 `manifest.json` 都没有，因此它只能是 bug。
    EmptyDeclaration,
    /// append 到达时没有任何进行中的导出。
    NoSession,
    /// append 带着**上一轮**的 exportId，或 header 缺失/形状不对。这正是 native 分配单调 id
    /// 的理由。
    StaleSession,
    /// 累计字节超过声明总长。
    ///
    /// **终态失败**：本次导出的会话与 temp 一并丢弃。留着它们只会让一个已经失败的导出继续占磁盘，
    /// 而症状（磁盘莫名被吃掉）与根因（这条错误路径忘了清理）完全无关。
    Overflow,
    /// 发布时目标路径已被占用。
    ///
    /// 刻意与 [`ExportError::Failure`] 分开：处理动作不同——重试一次即可（换个时间戳，或用户手动
    /// 清掉那个文件），而 `Failure` 意味着未知的 I/O 失败，重试没有意义。UI 把它显示成
    /// "导出失败，请重试"会诱导用户反复重试一个更可能需要他先处理磁盘的失败。
    TargetOccupied,
    Unavailable,
    Failure,
}

impl ExportError {
    /// 与 `DesktopArchiveExportErrorCodeSchema` 一一对应的 kebab-case 码。
    fn code(&self) -> &'static str {
        match self {
            ExportError::TooLarge => "export-too-large",
            ExportError::EmptyDeclaration => "export-empty-declaration",
            ExportError::NoSession => "export-no-session",
            ExportError::StaleSession => "export-stale",
            ExportError::Overflow => "export-overflow",
            ExportError::TargetOccupied => "export-target-occupied",
            ExportError::Unavailable => "export-unavailable",
            ExportError::Failure => "export-failure",
        }
    }
}

impl Serialize for ExportError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("ExportError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
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
            ExportError::TargetOccupied => write!(
                formatter,
                "导出目标已被占用（可能与另一轮导出撞名），请重试"
            ),
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
    /// 未完成的 temp。`Drop` 负责删除它，因此本模块不在任何错误分支上手写清理。
    temporary: NamedTempFile,
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
    /// 上一次清理里删不掉的 temp 条数，见 [`Self::stale_temporaries_left`]。
    stale_temporaries_left: AtomicU64,
}

impl ArchiveExport {
    pub fn open(paths: ExportPaths) -> Result<Self, ExportError> {
        std::fs::create_dir_all(paths.root()).map_err(|_| ExportError::Unavailable)?;
        Ok(Self {
            paths,
            // 从 1 起而不是 0：0 会让"第一条会话"与"没有会话"在日志里长得一样。真的会话状态由
            // `Option` 表达，因此 0 本身是合法 id——这个数字只是为了让 id 从 1 开始。
            next_id: AtomicU64::new(1),
            session: Mutex::new(None),
            stale_temporaries_left: AtomicU64::new(0),
        })
    }

    /// 清理上一次进程留下的未完成 temp。
    ///
    /// **必须**在启动时调用。未清理的 temp 不会被当作有效导出（它是 `.partial`），但它会**占磁盘**，
    /// 而一个几百 MiB 的泄漏在几轮导出之后就能吃掉用户的数据目录。`DESK-071b`"落盘与崩溃"。
    ///
    /// 只删本模块自己命名的 temp（前缀 + 后缀同时匹配）。删"目录里所有看起来像临时文件的东西"
    /// 是不可接受的：这个目录里还有用户可能自己拷进去的备份。
    ///
    /// **删不掉不算失败。** 一个残留的 `.partial` 按设计就是惰性的：它不会被当作有效导出，
    /// 下次启动还会再试一次。让它把应用启动整个卡住是纯粹的损失——`setup` 会把这里的错误
    /// 往上抛，于是"一个删不掉的临时文件"变成"应用打不开"。因此逐条计数继续，
    /// 删不掉的条数由 [`Self::stale_temporaries_left`] 如实报告。
    pub fn reclaim_stale_temporaries(&self) -> Result<usize, ExportError> {
        let entries = match std::fs::read_dir(self.paths.root()) {
            Ok(entries) => entries,
            // 目录刚创建时是空的；读不到说明它不可用，而 `open` 已经验证过一次了。
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(_) => return Err(ExportError::Unavailable),
        };
        let mut removed = 0;
        let mut failed = 0usize;
        for entry in entries {
            // 目录项本身读不到（权限、索引器竞争）同样不该中止整轮清理：理由同上。
            let Ok(entry) = entry else {
                failed += 1;
                continue;
            };
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with(TEMPORARY_PREFIX) || !name.ends_with(TEMPORARY_SUFFIX) {
                continue;
            }
            match std::fs::remove_file(entry.path()) {
                Ok(()) => removed += 1,
                // 已经不在了也算删掉：那是本进程自己刚删掉的。
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => removed += 1,
                Err(_) => failed += 1,
            }
        }
        if failed > 0 {
            self.stale_temporaries_left
                .store(failed as u64, Ordering::Relaxed);
        }
        Ok(removed)
    }

    /// 上一次清理里删不掉的 temp 条数。
    ///
    /// 刻意**不**让 [`Self::reclaim_stale_temporaries`] 因此失败（见它的注释），但也不把这件事
    /// 悄悄咽掉：它说明磁盘或权限有问题，而这个数字是唯一不靠日志就能看到的证据。
    pub fn stale_temporaries_left(&self) -> usize {
        self.stale_temporaries_left.load(Ordering::Relaxed) as usize
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
        // 名字里带 export id 是为了排障时能看出"这份 temp 属于哪一轮"；随机后缀由 tempfile 生成，
        // 它保证同一目录里两次 begin 不会撞名。前缀与后缀保持不变，`reclaim_stale_temporaries`
        // 与启动清理因此不需要知道名字里还有什么。
        let temporary = tempfile::Builder::new()
            .prefix(&format!("{TEMPORARY_PREFIX}{id}"))
            .suffix(TEMPORARY_SUFFIX)
            .tempfile_in(self.paths.root())
            .map_err(|_| ExportError::Unavailable)?;
        let absolute_path = display_path(&target);

        *guard = Some(ExportSession {
            id,
            declared_total,
            target,
            temporary,
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
        let session = guard.as_ref().ok_or(ExportError::NoSession)?;
        if session.id != export_id {
            return Err(ExportError::StaleSession);
        }
        // 溢出是**终态失败**：会话与 temp 一并丢弃。超出的字节不落盘——写下去再失败会留下一个
        // 比声明更长的 temp，而"随后删掉它"在别的错误路径上就很容易被忘掉。留着会话同样有害：
        // 下一块会继续往一个已被判定失败的 temp 上写，最终以一句无法归类的 Failure 收场。
        let overflow = match session.written.checked_add(bytes.len() as u64) {
            Some(total) => total > session.declared_total,
            None => true,
        };
        if overflow {
            discard_session(&mut guard);
            return Err(ExportError::Overflow);
        }
        let next_written = session
            .written
            .checked_add(bytes.len() as u64)
            .ok_or(ExportError::Overflow)?;

        // 写失败**同样**是终态失败，而且理由与溢出完全一样：`write_all` 可能已经推进了文件游标
        // （部分写入），而 `written` 停在旧值。留着会话的话，下一块会继续往一个位置已经错乱的
        // temp 上写，最终以一句无法归类的 `Failure` 收场，同时在磁盘上留一个直到下次 `begin`
        // 才被回收的几百 MiB temp。溢出被改成终态失败时，这条路径被留在了原地。
        let session = guard.as_mut().ok_or(ExportError::NoSession)?;
        if session.temporary.as_file_mut().write_all(bytes).is_err() {
            discard_session(&mut guard);
            return Err(ExportError::Failure);
        }
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
        // 刻意在发布**之前**放开互斥锁：发布是一次几百 MiB 的 fsync，持有锁会让并发的
        // `begin`（用户重试一次导出）阻塞到它结束。代价是一个显式且正确的失败：并发的那一轮可能
        // 在本轮发布之后才发布，届时它的 no-clobber 会失败成 `TargetOccupied`——这是
        // `DESK-071b` 规定的"失败并让用户重试"，而不是损坏。
        drop(guard);
        let absolute_path = self.publish_session(session, &target)?;
        Ok(AppendExportOutcome {
            written_byte_length,
            complete: true,
            absolute_path: Some(absolute_path),
        })
    }

    /// sync → no-clobber 发布。
    ///
    /// ## 为什么必须用 no-clobber 原语，而不是 `exists()` + `rename()`
    ///
    /// `std::fs::rename` 在目标存在时**替换**目标（Rust 标准库文档明写这一点），因此
    /// "`exists()` 找一个不存在的名字，再 rename 过去"中间存在一个窗口：预检查之后、发布之前，
    /// 另一个进程或用户创建了那个文件，于是这次 rename **覆盖**了它——毁掉用户唯一一份备份，而
    /// 症状是"导出成功"。补第二次 `exists()` 不解决问题，因为窗口只是被挪了位置。
    ///
    /// `persist_noclobber` 是"目标存在即失败"的原语。它在 Windows 与现代 Linux 上一般原子，
    /// 且它**绝不覆盖**（tempfile 文档对这条是明确保证的，与 `persist` 不同）。
    ///
    /// 失败时 temp **不会**被留下：`PersistError` 里带着那个 `NamedTempFile`，丢弃它就触发
    /// `Drop` → 删除。tempfile 文档提到"可能留下原链接"指的是 Unix 上 `unlink` 权限不足的那种
    /// 情况，本路径不依赖启动清理来收拾它（`temporaries() == vec![]` 那条门禁就在钉这件事）。
    ///
    /// ## 句柄为什么不用显式 `drop`
    ///
    /// Windows 上"移动一个仍打开的文件"会被拒绝，而 std 的 `OpenOptions` 默认共享模式包含
    /// `FILE_SHARE_DELETE`，因此不必先关句柄再 rename。注意这不是 `tempfile` 提供的性质
    /// （它不设 share mode），而是 std 的默认——一条被实测钉住、但没有编译期保证的 Windows 不变量，
    /// 与 `blob.rs` 的原子写依赖同一条。
    ///
    /// `session` 按值传入：它在离开互斥锁时已经不可回滚——写入已经发生。此后任何失败都由
    /// `NamedTempFile` 的 `Drop` 删掉 temp。
    fn publish_session(
        &self,
        mut session: ExportSession,
        target: &Path,
    ) -> Result<String, ExportError> {
        let file = session.temporary.as_file_mut();
        file.flush().map_err(|_| ExportError::Failure)?;
        // 声明已保证上界，这里核对**实际**长度。一次静默截断会产出一个"能打开但少东西"的归档，
        // 而用户会以为迁移完成了。
        file.seek(SeekFrom::End(0))
            .map_err(|_| ExportError::Failure)?;
        let actual = file.metadata().map_err(|_| ExportError::Failure)?.len();
        if actual != session.declared_total {
            return Err(ExportError::Failure);
        }
        file.sync_all().map_err(|_| ExportError::Failure)?;

        // 目标被占用时**失败**，而不是换一个名字继续发布：`begin` 回显的 `absolutePath` 因此始终
        // 是真正的最终路径。悄悄换成 `-2` 会把它降级成"仅供参考"，契约复杂度随之上升。
        //
        // 只把 `AlreadyExists` 归成 `TargetOccupied`：磁盘满、只读、目录非空都不是撞名，而把它们
        // 一律报成"重试即可"会让一个磁盘已满的用户反复重试一个永远会失败的导出。
        session
            .temporary
            .persist_noclobber(target)
            .map_err(|error| match error.error.kind() {
                std::io::ErrorKind::AlreadyExists => ExportError::TargetOccupied,
                _ => ExportError::Failure,
            })?;
        sync_parent_dir(self.paths.root());
        Ok(display_path(target))
    }

    /// 挑一个不撞名的最终路径。
    ///
    /// 这只是**降低撞名概率**的启发式，绝不覆盖的保证来自 [`Self::publish_session`] 的 no-clobber
    /// 发布。两者缺一不可：没有这段，文件名的可读性会退化；只保留这段而不做 `exists()` 循环，
    /// 同一秒内连发两次导出会让第二次直接失败。
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

/// 丢弃当前会话，temp 随之被 `Drop` 删掉。guard 已被锁住。
///
/// 不显式 `remove_file` 是刻意的：`NamedTempFile` 的 `Drop` 已经做了这件事，而重复一次除了多一
/// 处可能写错的路径之外没有收益。删不掉也不算致命——它是 `.partial`，不会被当作有效导出，
/// `reclaim_stale_temporaries` 会在下次启动时再试一次。
fn discard_session(guard: &mut Option<ExportSession>) {
    drop(guard.take());
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(unix)]
/// **Windows 上是 no-op**，如实记录该平台没有这项保证而不是假装它存在（与 `blob.rs` 同一处理）。
///
/// 缺它不会让读者看到一个半截的 `.zip`：`MoveFileExW` 对可见性是原子的，桥也只在 `complete`
/// 为真之后才报成功。弱的是**崩溃持久性**——断电后那个目录项可能落成 `.partial` 也可能落成
/// `.zip`，而启动清理会删掉前者。最坏结果是丢一次导出，不是导出一个坏的归档。
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

    /// 未完成的 temp。名字里带 export id 与一段随机后缀，因此只按前后缀判定。
    fn temporaries(root: &Path) -> Vec<String> {
        names(root)
            .into_iter()
            .filter(|name| name.starts_with(TEMPORARY_PREFIX) && name.ends_with(TEMPORARY_SUFFIX))
            .collect()
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
        assert_eq!(temporaries(&exports_dir(&root)).len(), 1);
        assert!(!Path::new(&begun.absolute_path).exists());

        let done = export.append(1, b"def").expect("append 2");
        assert!(done.complete);
        assert_eq!(done.written_byte_length, 6);
        let published = PathBuf::from(done.absolute_path.expect("published path"));
        assert_eq!(
            std::fs::read(&published).expect("read published"),
            b"abcdef"
        );
        assert!(names(&exports_dir(&root)).len() == 1);
        assert!(names(&exports_dir(&root))[0].ends_with(".zip"));
    }

    #[test]
    fn begin_回显的计划路径在发布时确实出现() {
        let root = scratch("echo");
        let export = open(&root);
        let begun = export.begin(1).expect("begin");
        // 此前这条断言把路径与**它自己按 parent + file_name 的重建**比较——对任何有父目录与文件名
        // 的路径都恒真，什么也没测。改成断言真正的不变式：回显的是导出目录下的 `.zip`，
        // 而 temp 在被收满之前绝不出现。
        let planned = PathBuf::from(&begun.absolute_path);
        assert_eq!(
            planned.parent(),
            Some(exports_dir(&root).as_path()),
            "begin 必须回显导出目录下的最终路径，而不是 temp"
        );
        assert!(
            planned.extension().is_some_and(|ext| ext == "zip"),
            "最终路径必须以 .zip 结尾：{}",
            begun.absolute_path
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

        let temporaries = temporaries(&exports_dir(&root));
        assert_eq!(temporaries.len(), 1, "旧 temp 必须被删掉：{temporaries:?}");
    }

    #[test]
    fn 累计超过声明总长时失败且不留下temp() {
        let root = scratch("overflow");
        let export = open(&root);
        let begun = export.begin(2).expect("begin");
        assert_eq!(
            export.append(begun.export_id, b"abc"),
            Err(ExportError::Overflow)
        );

        // 溢出是终态失败：temp 必须被删掉。它不是一次导出，不能留在磁盘上冒充半个归档。
        // 只断言"没有 .zip"是不够的——那正是本条测试曾经的写法，因此溢出后的 .partial
        // 一直没人检查，直到一次真实导出把磁盘占满才被发现。
        let remaining = names(&exports_dir(&root));
        assert!(
            !remaining.iter().any(|name| name.ends_with(".zip")),
            "溢出不得发布最终文件：{remaining:?}"
        );
        assert_eq!(temporaries(&exports_dir(&root)), Vec::<String>::new());
    }

    #[test]
    fn 溢出后会话被清空因此后续append报无会话() {
        let root = scratch("overflow-terminal");
        let export = open(&root);
        let begun = export.begin(2).expect("begin");
        assert_eq!(
            export.append(begun.export_id, b"abc"),
            Err(ExportError::Overflow)
        );
        // 会话留着的话，下一块会继续往一个已经被判定失败的 temp 上写，而最终归档的长度核对
        // 会以一句无法归类的 Failure 收场。
        assert_eq!(
            export.append(begun.export_id, b"d"),
            Err(ExportError::NoSession)
        );
    }

    #[test]
    fn 发布时目标被占用则失败且绝不覆盖() {
        let root = scratch("occupied");
        let export = open(&root);
        let begun = export.begin(1).expect("begin");
        // 这就是 `exists()` + `rename()` 的窗口：预检查通过之后、发布之前，另一个进程或用户
        // 抢先把 begin 回显的那个路径占了。串行的"撞名递增"用例永远走不到这一步。
        let squatted = PathBuf::from(&begun.absolute_path);
        std::fs::write(&squatted, b"mine").expect("squatter writes");

        assert_eq!(
            export.append(begun.export_id, b"x"),
            Err(ExportError::TargetOccupied)
        );
        // 绝不覆盖：对方那份必须一字不变。
        assert_eq!(std::fs::read(&squatted).expect("read"), b"mine");
        // 失败之后不留 temp。
        assert_eq!(temporaries(&exports_dir(&root)), Vec::<String>::new());
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
    fn 删不掉的temp不会让清理失败也不会让应用起不来() {
        // 一个 `.partial` 按设计就是惰性的：它不会被当作有效导出，下次启动还会再试。让它把
        // 清理整个卡住是纯粹的损失——`setup` 会把这里的错误往上抛，于是"一个删不掉的临时文件"
        // 变成"应用打不开"。
        let root = scratch("undeletable");
        let export = open(&root);
        // 用一个**目录**占住那个路径：`remove_file` 对目录会失败，而它仍然带着 temp 的名字，
        // 因此被本模块的命名规则选中。
        let stuck = exports_dir(&root).join(format!("{TEMPORARY_PREFIX}77{TEMPORARY_SUFFIX}"));
        std::fs::create_dir(&stuck).expect("mkdir stuck");
        let ordinary = exports_dir(&root).join(format!("{TEMPORARY_PREFIX}78{TEMPORARY_SUFFIX}"));
        std::fs::write(&ordinary, b"stale").expect("write stale");

        // 不返回错误，并且把能删的都删了。
        assert_eq!(
            export
                .reclaim_stale_temporaries()
                .expect("reclaim must not fail"),
            1
        );
        assert!(!ordinary.exists());
        assert!(stuck.exists());
        // 但也不悄悄咽掉：这个数字是不靠日志就能看到"磁盘或权限有问题"的唯一证据。
        assert_eq!(export.stale_temporaries_left(), 1);
    }

    #[test]
    fn 错误序列化成渲染层契约要求的code加message() {
        // 跨语言形状的回归：曾经这里是枚举名，于是渲染层的 `.strict()` schema 每次都拒收，
        // 症状是"UI 拿不到错误码，只能显示无法归类的失败"。
        let cases = [
            (ExportError::TooLarge, "export-too-large"),
            (ExportError::EmptyDeclaration, "export-empty-declaration"),
            (ExportError::NoSession, "export-no-session"),
            (ExportError::StaleSession, "export-stale"),
            (ExportError::Overflow, "export-overflow"),
            (ExportError::TargetOccupied, "export-target-occupied"),
            (ExportError::Unavailable, "export-unavailable"),
            (ExportError::Failure, "export-failure"),
        ];
        for (error, expected_code) in cases {
            let json = serde_json::to_value(&error).expect("serialize");
            assert_eq!(json["code"], expected_code);
            assert!(json["message"]
                .as_str()
                .is_some_and(|text| !text.is_empty()));
            assert_eq!(json.as_object().expect("object").len(), 2);
        }
    }

    #[test]
    fn 没有遗留temp时清理返回零() {
        let root = scratch("nothing-stale");
        let export = open(&root);
        assert_eq!(export.reclaim_stale_temporaries().expect("reclaim"), 0);
    }
}
