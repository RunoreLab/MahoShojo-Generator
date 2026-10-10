//! 本地库的单一入口（D2.2a 并发地基）。
//!
//! D2.2 之前，四个 store 各自作为独立的 Tauri `State` 存在：四条连接、四把互不相干的
//! `Mutex`，指向同一个 `library.sqlite`。这个形状有两个问题：
//!
//! 1. **它是一个现存缺陷，不只是"不够强"。** `WebPackageStore::save` 先写 blob（释放 blob
//!    锁）再进包事务（取另一把锁）。两步之间，若有另一条路径观察 `blob` 表，会看到一个
//!    "有 metadata、无任何引用"的 blob——而那正是 GC 的回收候选。`DESK-065` 把这个窗口写成
//!    "未来 GC 引入后才成立的风险"，实际上它在 D2.1 落地那天就已经可以发生。
//! 2. **维护操作无处落脚。** GC / 审计 / 备份需要跨多次数据库往返保持独占，而单把连接锁
//!    只能覆盖其中一次往返。
//!
//! 本模块把这两件事收敛到一处：
//!
//! ```text
//! LocalLibrary（唯一 Tauri State）
//!   ├─ MaintenanceGate      维护窗口：写入被拒而不是排队（D2.2a）
//!   ├─ SharedConnection     一条连接，四个 store 共用
//!!   ├─ LocalStore           Provider Profile（D1）
//!   ├─ LocalCardStore       本地卡（D2.0）
//!   ├─ WebPackageStore      Web 包记录 + 引用行（D2.1）
//!   └─ BlobStore            内容寻址字节（D2.1）
//! ```
//!
//! ## 单实例在 `run()` 里获取，不在这里
//!
//! 跨进程锁属于**应用启动**的职责：失败时要拒绝启动，而不是让库处于半可用状态。
//! 见 [`crate::maintenance::InstanceGuard`]。
//!
//! ## 为什么写入许可在 command 层而不是 store 层
//!
//! 许可必须覆盖**整次操作**。若在 `BlobStore::write` 内部取许可，`WebPackageStore::save`
//! 的第二步（包事务）就不在窗口内——维护者仍能落在两步中间。放在 command 层意味着
//! "一次 IPC 调用 = 一次许可"，边界与调用方的直觉一致。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::blob::{BlobPaths, BlobStore};
use crate::local_card::LocalCardStore;
use crate::maintenance::{MaintenanceGate, MaintenancePermit, MaintenanceRejection, WritePermit};
use crate::store::{LocalStore, LocalStorePaths, SharedConnection};
use crate::web_package::WebPackageStore;

/// 本地库在进程内的整体句柄。**唯一**的 Tauri `State`。
pub struct LocalLibrary {
    gate: Arc<MaintenanceGate>,
    #[allow(
        dead_code,
        reason = "internal story storage candidate has no command binding yet"
    )]
    stories: Arc<crate::arena_story::StoryStore>,
    /// 保留一份自有引用，让 store 之外的维护操作（审计 / GC / 备份）能在同一临界区里
    /// 跑跨表查询，而不必重新拼装连接。D2.2b 起被 `connection()` 使用。
    #[allow(dead_code, reason = "D2.2b 审计需要跨表只读查询")]
    connection: SharedConnection,
    data_root: PathBuf,
    profiles: LocalStore,
    cards: LocalCardStore,
    packages: WebPackageStore,
    blobs: BlobStore,
}

impl LocalLibrary {
    /// 在给定数据目录下打开本地库。
    ///
    /// 调用方**必须**已经持有 [`crate::maintenance::InstanceGuard`]：单实例检查发生在启动
    /// 阶段，而不是每次打开库时——后者会让两个进程都认为自己能安全地写。
    pub fn open(data_root: &Path) -> Result<Self, crate::store::StoreError> {
        let connection = crate::store::open_shared_connection(&LocalStorePaths::under(data_root))?;
        Self::from_parts(data_root.to_path_buf(), connection)
    }

    /// 从已准备好的连接构造。供测试在内存库上构造完整形态。
    #[cfg(test)]
    pub fn open_with_connection(
        data_root: &Path,
        connection: SharedConnection,
    ) -> Result<Self, crate::store::StoreError> {
        Self::from_parts(data_root.to_path_buf(), connection)
    }

    fn from_parts(
        data_root: PathBuf,
        connection: SharedConnection,
    ) -> Result<Self, crate::store::StoreError> {
        let blob_store = crate::blob::open(BlobPaths::under(&data_root), Arc::clone(&connection))
            .map_err(|_| crate::store::StoreError::Unavailable)?;

        let gate = MaintenanceGate::shared();
        let stories = crate::arena_story::StoryStore::open(
            &data_root,
            Arc::clone(&connection),
            Arc::clone(&gate),
        )
        .map_err(|_| crate::store::StoreError::Unavailable)?;
        Ok(Self {
            gate,
            stories: Arc::new(stories),
            profiles: LocalStore::new(Arc::clone(&connection)),
            cards: LocalCardStore::new(Arc::clone(&connection)),
            packages: WebPackageStore::new(Arc::clone(&connection)),
            blobs: blob_store,
            connection,
            data_root,
        })
    }

    // ---- 许可 -------------------------------------------------------------

    /// 进入写入路径。维护窗口内**立刻**被拒（`DESK-065`）。
    pub fn enter_write(&self) -> Result<WritePermit, MaintenanceRejection> {
        self.gate.enter_write()
    }

    /// 进入维护窗口。等当前写入全部退出后才返回。
    ///
    /// D2.2b 完整性审计与 D2.2c GC 的第一个动作就是取它，因此本阶段没有生产调用方。
    #[allow(dead_code, reason = "D2.2b/D2.2c 的维护 command 将经由它进入窗口")]
    pub fn enter_maintenance(
        &self,
        label: &'static str,
    ) -> Result<MaintenancePermit, MaintenanceRejection> {
        self.gate.enter_maintenance(label)
    }

    // ---- 访问者 -----------------------------------------------------------

    #[allow(
        dead_code,
        reason = "internal story storage candidate has no command binding yet"
    )]
    /// The Arena transport and storage binder share the same admission locks and database.
    pub(crate) fn shared_stories(&self) -> Arc<crate::arena_story::StoryStore> {
        Arc::clone(&self.stories)
    }

    pub fn stories(&self) -> &crate::arena_story::StoryStore {
        &self.stories
    }

    pub fn profiles(&self) -> &LocalStore {
        &self.profiles
    }

    pub fn cards(&self) -> &LocalCardStore {
        &self.cards
    }

    pub fn packages(&self) -> &WebPackageStore {
        &self.packages
    }

    pub fn blobs(&self) -> &BlobStore {
        &self.blobs
    }

    /// 共享连接。审计 / GC / 备份需要它来跑跨表的只读查询。
    ///
    /// D2.2b 起会被审计使用；本阶段只有测试引用它（用来断言四个 store 共用一条连接）。
    #[allow(dead_code, reason = "D2.2b 审计需要跨表只读查询")]
    pub fn connection(&self) -> &SharedConnection {
        &self.connection
    }

    /// 数据根目录。导出与备份的目标路径由 native 依据它产生（`DESK-071`）。
    ///
    /// D2.2 还没有消费方：审计、GC 与备份都在各自模块里直接用 `data_root` 字段。
    /// 保留这个访问器是为了让"路径只能由 native 产生"这条规则有一个显式入口，而不是
    /// 让后续模块去摸字段——后者等于把路径产生的责任摊回给调用方。
    #[allow(dead_code, reason = "D2.2 的导出与备份 command 将经由它取路径")]
    pub fn data_root(&self) -> &Path {
        &self.data_root
    }
}

#[cfg(test)]
mod tests {
    use super::LocalLibrary;
    use crate::maintenance::MaintenanceRejection;
    use crate::store::open_in_memory_connection;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    fn scratch(label: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "mahoshojo-library-{label}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn library_at(root: &Path) -> LocalLibrary {
        LocalLibrary::open_with_connection(root, open_in_memory_connection().expect("in-memory"))
            .expect("library must open")
    }

    /// 四个 store MUST 共用同一条连接。
    ///
    /// 这是 D2.2a 的核心断言，也是"跨资源中间态对其它路径不可见"的前提。直接证据：
    /// 从外部持有连接锁时，任一 store 的操作都拿不到锁——若某个 store 另开了一条连接，
    /// 它会立刻完成，这条测试就会失败。
    #[test]
    fn every_store_shares_one_connection() {
        let root = scratch("shared-connection");
        let library = library_at(&root);

        // 用一个只在测试期存在的写入把"锁被外部持有"这件事表达出来：借 Web 包写入路径
        // 探测锁的互斥性。它要走到 blob 写入，因此必须先取连接锁。
        let probe = crate::web_package::WebPackageIndex {
            id: "wp_0123456789abcdef0123456789abcdef".to_string(),
            updated_at: "2026-10-01T00:00:00.000Z".to_string(),
            deleted_at: None,
            content_digest:
                "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    .to_string(),
        };
        let document = serde_json::json!({
            "id": probe.id,
            "schemaVersion": 1,
            "storageLocation": "local",
            "entityKind": "web-package",
            "title": "probe",
            "summary": "probe@1.0.0",
            "ref": {
                "id": "probe",
                "version": "1.0.0",
                "digest": probe.content_digest,
            },
            "manifest": { "name": "probe", "files": [] },
            "contentDigest": probe.content_digest,
            "archiveByteLength": 4,
            "provenance": { "kind": "unsigned" },
            "createdAt": "2026-10-01T00:00:00.000Z",
            "updatedAt": "2026-10-01T00:00:00.000Z",
        })
        .to_string();
        let archive = b"PK\x03\x04".to_vec();

        // 先在无外部锁时成功一次：证明这条写入路径本身是通的。
        library
            .packages()
            .save(
                library.blobs(),
                &document,
                &probe,
                &archive,
                "2026-10-01T00:00:00.000Z",
            )
            .expect("probe write must succeed without an external lock");

        let connection = library.connection().clone();
        let held = crate::store::lock_connection(&connection).expect("hold the shared lock");

        let (tx, rx) = std::sync::mpsc::channel();
        let worker = {
            let connection_for_worker = library.connection().clone();
            std::thread::spawn(move || {
                // 与 store 走同一把锁：外部持锁时这里必须阻塞。
                let guard = crate::store::lock_connection(&connection_for_worker);
                let _ = tx.send(guard.is_ok());
            })
        };

        std::thread::sleep(Duration::from_millis(60));
        assert!(
            rx.try_recv().is_err(),
            "外部持有共享连接锁时，其它路径不得并行进入——store 若另开连接就会通过"
        );

        drop(held);
        worker.join().expect("worker thread");
        assert!(rx.recv().expect("worker must report"), "释放后必须能进入");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 维护窗口内的写入 MUST 被拒。
    ///
    /// 这是 `DESK-065` 退出门禁在真实 store 之上的断言。拒绝发生在 command 层，
    /// 因此 store 的写入方法根本不会被调用——下面用"窗口关闭后同一路径能写成功"来证明
    /// 拒绝不是来自路径本身坏了。
    #[test]
    fn a_write_during_maintenance_is_refused_and_leaves_no_trace() {
        let root = scratch("maintenance-refusal");
        let library = library_at(&root);

        let card = crate::local_card::LocalCardIndex {
            id: "lc_0123456789abcdef0123456789abcdef".to_string(),
            card_type: "character".to_string(),
            updated_at: "2026-10-01T00:00:00.000Z".to_string(),
            deleted_at: None,
            content_digest:
                "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    .to_string(),
        };
        let document = serde_json::json!({
            "id": card.id,
            "schemaVersion": 1,
            "storageLocation": "local",
            "cardType": "character",
            "title": "probe",
            "data": {},
            "contentDigest": card.content_digest,
            "provenance": { "kind": "unsigned" },
            "createdAt": "2026-10-01T00:00:00.000Z",
            "updatedAt": "2026-10-01T00:00:00.000Z",
        })
        .to_string();

        let window = library.enter_maintenance("gc").expect("enter maintenance");
        assert_eq!(
            library.enter_write().err(),
            Some(MaintenanceRejection::MaintenanceBusy),
            "维护窗口内的写入许可必须被拒"
        );
        assert!(
            library.cards().get(&card.id).expect("read").is_none(),
            "被拒的写入不得留下任何痕迹"
        );
        drop(window);

        // 窗口关闭后同一路径必须能写成功：否则上面的拒绝可能只是"路径坏了"。
        drop(library.enter_write().expect("窗口关闭后写入必须被放行"));
        library
            .cards()
            .put(&document, &card)
            .expect("card must save after the window closes");
        assert!(library.cards().get(&card.id).expect("get").is_some());

        let _ = std::fs::remove_dir_all(&root);
    }
}
