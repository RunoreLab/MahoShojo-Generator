//! 本地库的维护窗口与单实例守卫（D2.2a 并发地基）。
//!
//! ## 为什么需要它
//!
//! 一次 Web 包保存至少跨三个资源：blob 文件系统、blob metadata、包记录与引用行的事务。
//! GC、审计与备份要在这三个资源上给出一个**一致**的答案，否则会观察到中间态——最直接的
//! 后果是 GC 落进"blob 已发布、引用行未提交"的窗口，把一次 in-flight 保存的字节当成孤儿删掉。
//!
//! ## 三层并发控制，各管一件事
//!
//! ```text
//! 跨进程：InstanceGuard   同一数据目录只允许一个 Desktop 进程（D2.2a）
//! 跨操作：MaintenanceGate 维护操作独占数据目录，写入被拒而不是排队（D2.2a）
//! 进程内：Mutex<Connection> 单连接串行化（D1 起既有）
//! ```
//!
//! 三者**不可互相替代**：
//!
//! - 进程内的 `Mutex<Connection>` 只在单个进程内有效。四个 store 原本各持一把锁、指向同一
//!   个 SQLite 文件，彼此之间没有互斥——这不只是"不够"，它是一个**现存缺陷**：
//!   `WebPackageStore::save` 先写 blob（释放 blob 锁）再进包事务，两步之间若插入一次 GC，
//!   GC 会看到一个有 metadata、无引用的 blob 并删掉它。合并为单连接后这个窗口才真正关闭。
//! - 维护窗口不能靠 store 自己的锁：GC 要在**多次**数据库往返之间保持独占，而单把连接锁
//!   只能覆盖其中一次往返。
//! - 单实例不能靠前两者：它们都是进程内的。
//!
//! ## 写入被拒不排队
//!
//! `DESK-065` 的退出门禁要求"维护窗口内并发写入被**拒**而不是被观察到中间态"。排队同样
//! 满足"不观察到中间态"，但它会把 UI 挂起在一个无法解释的等待上；拒绝则让 UI 可以立刻
//! 告诉用户"本地库正在维护，请稍后重试"。
//!
//! ## 单实例用数据目录而不是 app id
//!
//! `DESK-068` 记录了机制选择。`tauri-plugin-single-instance` 按 app id 判定，而 V1 需要的是
//! "同一数据目录不被两个进程同时打开"——dev 构建与另一个构建可以有不同 app id 却指向同一个
//! `app_data_dir`，那正是要防的场景，且用插件还会被迫在 V1 引入第一个 Tauri 插件
//! （`DESK-011` 默认禁止）。
//!
//! advisory 锁由 OS 持有、随进程死亡自动释放：这正是想要的失败模式——崩溃**不得**永久锁死用户。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};

use serde::Serialize;

/// 维护窗口期间写操作被拒绝。
///
/// 单独成一个错误类别而不是复用 `StoreError::Failure`：UI 需要据此显示"请稍后重试"，
/// 而一个笼统的失败会让用户以为数据出错了。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaintenanceRejection {
    /// 另一个进程正持有本数据目录。
    InstanceLocked,
    /// 本进程内已有维护操作在进行。
    MaintenanceBusy,
}

impl MaintenanceRejection {
    pub fn code(&self) -> &'static str {
        match self {
            MaintenanceRejection::InstanceLocked => "instance-locked",
            MaintenanceRejection::MaintenanceBusy => "maintenance-busy",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            MaintenanceRejection::InstanceLocked => {
                "another MahoShojo Generator instance already owns this library"
            }
            MaintenanceRejection::MaintenanceBusy => "the local library is being maintained",
        }
    }
}

/// IPC 投影为 `{code, message}`，与 `StoreError` / `BlobError` **同一形状**，
/// 使渲染层只需要一个错误解析器（`DESK-064` 的同源约束）。
impl Serialize for MaintenanceRejection {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("MaintenanceRejection", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", self.message())?;
        state.end()
    }
}

/// 跨进程单实例守卫。
///
/// 持有一个打开的 `File`；锁随句柄关闭或进程退出自动释放。刻意**不**做"锁文件存在即已占用"
/// 的检查——那会在进程崩溃后永久拒绝启动，而用户没有任何自救手段。
pub struct InstanceGuard {
    _lock: File,
}

impl InstanceGuard {
    /// 尝试独占本数据目录。
    ///
    /// 失败说明另一个 Desktop 进程正持有它。这**不是**一个可以降级的错误：两份进程同时写
    /// 同一个库会各自看到对方的中间态，而 `DESK-065` 明确禁止静默降级为只读或另开一份库。
    pub fn acquire(data_root: &Path) -> Result<Self, MaintenanceRejection> {
        std::fs::create_dir_all(data_root).map_err(|_| MaintenanceRejection::InstanceLocked)?;
        let path = data_root.join("library.lock");

        // 不用 `create`：`create_new` 会在文件已存在时失败，而锁文件**必须**在进程崩溃后仍然
        // 存在（否则第二个进程会新建一个锁、两个进程各拿一把）。
        let mut lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|_| MaintenanceRejection::InstanceLocked)?;

        // `try_lock` 是排他锁（fs4 1.x 把 `try_lock_exclusive` 改名为 `try_lock`，
        // 共享锁是 `try_lock_shared`）。
        //
        // 这里用完全限定的调用而不是方法语法：`FileExt` 是 sealed trait 且 Windows 上与
        // `std::os::windows::fs::FileExt` 同名，方法语法会依赖 trait 是否在作用域内，
        // 而限定调用把这个依赖显式化。
        fs4::FileExt::try_lock(&lock).map_err(|_| MaintenanceRejection::InstanceLocked)?;

        // 把持有的事实写进锁文件，纯粹为了排障：崩溃后文件仍在，内容能告诉用户
        // "上次运行时库是正常打开的"还是"进程在持锁期间被杀"。
        let _ = writeln!(lock, "pid={}", std::process::id());
        let _ = lock.flush();

        Ok(Self { _lock: lock })
    }
}

/// 维护窗口的内部状态。
#[derive(Debug, Default)]
struct GateState {
    /// 正在进行的维护操作标签；`Some` 时新的写入一律被拒。
    maintenance: Option<&'static str>,
    /// 已进入写入路径但尚未完成的操作数。
    active_writers: usize,
}

/// 维护窗口闸门。
///
/// 语义是一个"写者计数 + 单个维护者"的组合，而不是读写锁：
///
/// - 写入**不互斥**（本地库写入低频，且各 store 自己已经按连接串行化）；
/// - 维护操作**与所有写入互斥**，且必须等当前写入全部退出后才开始；
/// - 维护窗口内到达的写入**立刻被拒**。
///
/// 用 `RwLock` 会得到前两条，但第三条做不到——`read()` 会排队。规格要求的是拒绝。
pub struct MaintenanceGate {
    state: Mutex<GateState>,
    drained: Condvar,
}

impl Default for MaintenanceGate {
    fn default() -> Self {
        Self::new()
    }
}

/// 写许可。生命周期即一次写入的跨度；`Drop` 时归还计数。
pub struct WritePermit {
    gate: Arc<MaintenanceGate>,
}

impl Drop for WritePermit {
    fn drop(&mut self) {
        let mut state = match self.gate.state.lock() {
            Ok(state) => state,
            // 中毒意味着有写入路径 panic 了。此时不通知：维护者要么同样 panic，
            // 要么在新的写入到来时重新观察到状态。刻意不 `unwrap()`——那会在
            // Drop 里二次 panic，把一个可诊断的失败变成进程终止。
            Err(_) => return,
        };
        state.active_writers = state.active_writers.saturating_sub(1);
        if state.active_writers == 0 {
            self.gate.drained.notify_all();
        }
    }
}

/// 维护许可。`Drop` 时释放窗口。
///
/// D2.2b 完整性审计的第一个动作就是取它，因此 D2.2a 阶段只有测试构造它。
#[allow(dead_code, reason = "D2.2b/D2.2c 的维护 command 将持有它")]
pub struct MaintenancePermit {
    gate: Arc<MaintenanceGate>,
    label: &'static str,
}

impl Drop for MaintenancePermit {
    fn drop(&mut self) {
        let mut state = match self.gate.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        debug_assert_eq!(state.maintenance, Some(self.label));
        state.maintenance = None;
        self.gate.drained.notify_all();
    }
}

impl MaintenanceGate {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(GateState::default()),
            drained: Condvar::new(),
        }
    }

    pub fn shared() -> Arc<Self> {
        Arc::new(Self::new())
    }

    /// 进入写入路径。
    ///
    /// 维护窗口内**立刻**返回 `MaintenanceBusy`，不等待（见模块文档）。
    pub fn enter_write(self: &Arc<Self>) -> Result<WritePermit, MaintenanceRejection> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| MaintenanceRejection::MaintenanceBusy)?;
        if state.maintenance.is_some() {
            return Err(MaintenanceRejection::MaintenanceBusy);
        }
        state.active_writers += 1;
        Ok(WritePermit {
            gate: Arc::clone(self),
        })
    }

    /// 进入维护窗口。等当前写入全部退出后才返回。
    ///
    /// 已经有维护者在跑时返回 `MaintenanceBusy` 而不是排队：两个 GC 同时跑没有意义，
    /// 而排队会让用户在界面上看到一个永远不动的进度条。
    #[allow(dead_code, reason = "D2.2b/D2.2c 的维护 command 将经由它进入窗口")]
    pub fn enter_maintenance(
        self: &Arc<Self>,
        label: &'static str,
    ) -> Result<MaintenancePermit, MaintenanceRejection> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| MaintenanceRejection::MaintenanceBusy)?;
        if state.maintenance.is_some() {
            return Err(MaintenanceRejection::MaintenanceBusy);
        }
        // 先占位再等待：否则新写入会在等待期间持续进入，让维护者可能永远等不到一个
        // "活跃写入数归零"的时刻。
        state.maintenance = Some(label);
        while state.active_writers > 0 {
            state = self
                .drained
                .wait(state)
                .map_err(|_| MaintenanceRejection::MaintenanceBusy)?;
        }
        Ok(MaintenancePermit {
            gate: Arc::clone(self),
            label,
        })
    }

    /// 当前是否处于维护窗口。仅测试与诊断使用。
    #[cfg(test)]
    pub fn is_maintaining(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.maintenance.is_some())
            .unwrap_or(true)
    }
}

#[cfg(test)]
mod tests {
    use super::{InstanceGuard, MaintenanceGate, MaintenanceRejection};

    fn scratch(label: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-maintenance-{label}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    /// 写入在空闲时**必须**能进入。这条是"门没有把正常路径也关上"的正向证据：
    /// 一个永远返回 Busy 的门看起来同样安全，但会让整个应用不可用。
    #[test]
    fn writes_are_admitted_while_nothing_is_maintaining() {
        let gate = MaintenanceGate::shared();
        for _ in 0..8 {
            let permit = gate.enter_write().expect("空闲时写入不得被拒");
            drop(permit);
        }
        assert!(!gate.is_maintaining());
    }

    /// 维护窗口内的写入 MUST 被拒。
    ///
    /// 这是 `DESK-065` 退出门禁的直接断言。旧实现（无门）会让这次写入成功——而那正是
    /// GC 能删掉 in-flight blob 的原因。
    #[test]
    fn writes_are_refused_while_a_maintenance_window_is_open() {
        let gate = MaintenanceGate::shared();
        let permit = gate.enter_maintenance("gc").expect("enter maintenance");
        assert!(gate.is_maintaining());
        assert_eq!(
            gate.enter_write().err(),
            Some(MaintenanceRejection::MaintenanceBusy),
            "维护窗口内的写入必须被拒，而不是排队"
        );
        drop(permit);
        assert!(gate.enter_write().is_ok(), "窗口关闭后写入必须恢复");
    }

    /// 维护 MUST 等当前写入退出，否则会观察到中间态。
    ///
    /// 用一个真实线程持写许可，主线程尝试进入维护：它必须**阻塞**到写入结束。
    /// 若不等待，GC 就能落进"blob 已写、引用行未提交"的窗口。
    #[test]
    fn maintenance_waits_for_in_flight_writes_to_finish() {
        use std::sync::mpsc;
        use std::time::Duration;

        let gate = MaintenanceGate::shared();
        let (holding_tx, holding_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();

        let writer_gate = std::sync::Arc::clone(&gate);
        let writer = std::thread::spawn(move || {
            let permit = writer_gate.enter_write().expect("write must be admitted");
            holding_tx.send(()).expect("signal holding");
            // 写许可必须在主线程确认"维护还没进去"之前一直持有。
            std::thread::sleep(Duration::from_millis(120));
            drop(permit);
            done_tx.send(()).expect("signal done");
        });

        holding_rx.recv().expect("writer must be holding a permit");
        let entered = std::thread::spawn({
            let gate = std::sync::Arc::clone(&gate);
            move || gate.enter_maintenance("gc").is_ok()
        });

        std::thread::sleep(Duration::from_millis(40));
        assert!(!entered.is_finished(), "维护不得在写入仍持有许可时进入窗口");

        writer.join().expect("writer thread");
        done_rx.recv().expect("writer must finish");
        assert!(
            entered.join().expect("maintenance thread"),
            "写入退出后维护必须能进入窗口"
        );
    }

    /// 两个维护者 MUST 互斥。
    ///
    /// 排队的第二个 GC 没有意义，而且会让 UI 上的进度条永远不动。
    #[test]
    fn a_second_maintenance_window_is_refused() {
        let gate = MaintenanceGate::shared();
        let first = gate.enter_maintenance("gc").expect("first");
        assert_eq!(
            gate.enter_maintenance("backup").err(),
            Some(MaintenanceRejection::MaintenanceBusy)
        );
        drop(first);
        assert!(gate.enter_maintenance("backup").is_ok());
    }

    /// 窗口关闭后**必须**重新可写。
    ///
    /// 许可的 `Drop` 忘记清标记的话，这条会失败——而症状是"跑过一次维护之后应用永久
    /// 无法保存任何东西"。
    #[test]
    fn releasing_the_window_reopens_writes() {
        let gate = MaintenanceGate::shared();
        for _ in 0..3 {
            let permit = gate.enter_maintenance("audit").expect("enter");
            drop(permit);
            assert!(gate.enter_write().is_ok(), "每轮窗口结束后写入都必须可用");
        }
    }

    /// 单实例锁：同一数据目录 MUST 拒绝第二次获取。
    ///
    /// 这是 `DESK-065` 的第一条。同一进程内两次 `acquire` 走的是同一套 OS advisory 锁语义，
    /// 因此可以在无头环境里断言。
    #[test]
    fn a_second_instance_on_the_same_data_root_is_refused() {
        let root = scratch("instance");
        let first = InstanceGuard::acquire(&root).expect("first instance must win");
        assert_eq!(
            InstanceGuard::acquire(&root).err(),
            Some(MaintenanceRejection::InstanceLocked),
            "同一数据目录不得被两个进程同时持有"
        );
        drop(first);

        // 释放后必须能重新获取：崩溃或正常退出都不能让用户永久打不开自己的库。
        let _second = InstanceGuard::acquire(&root).expect("lock must be re-acquirable");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 锁文件 MUST 在释放后仍然存在。
    ///
    /// 如果它随锁一起消失，第二个进程会 `create_new` 一个新锁，于是两个进程各拿一把——
    /// 单实例约束静默失效。这是"检查锁文件是否存在"这类错误实现的必然后果。
    #[test]
    fn the_lock_file_outlives_the_lock() {
        let root = scratch("lock-file");
        {
            let _guard = InstanceGuard::acquire(&root).expect("acquire");
        }
        assert!(
            root.join("library.lock").exists(),
            "锁文件必须在释放后仍在；消失会让第二个进程新建一把锁"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
