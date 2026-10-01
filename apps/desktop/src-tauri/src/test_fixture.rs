//! 本地库测试夹具（D2.2b 起）。
//!
//! 存在的理由：审计与 GC 的测试需要构造**具体的损坏形态**——等长但内容不同的 blob、被截断的
//! blob、缺引用行的包记录、悬空的外键。这些无法从公开 API 造出来（写入路径会把它们都修好），
//! 因此这里显式提供注入点。
//!
//! 每个注入方法都刻意**绕开**业务校验直接写 SQLite 或文件系统。这不是为了省事，而是为了让
//! "损坏"这件事有一个确定的来源：若用公开 API 造损坏，测试会同时测到自愈逻辑，于是无法
//! 区分"审计发现了问题"与"写入路径修好了问题"。

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::blob::{blob_path, BlobPaths, BlobStore};
use crate::local_card::LocalCardStore;
use crate::store::{open_in_memory_connection, SharedConnection};
use crate::web_package::WebPackageIndex;
use crate::web_package::WebPackageStore;

/// 一个完整的本地库形态（共享一条连接），外加一个真实的临时目录供 blob 文件落脚。
pub struct Fixture {
    root: PathBuf,
    connection: SharedConnection,
    blobs: BlobStore,
    packages: WebPackageStore,
    /// 本地卡 store。本地卡当前不参与 blob 引用，因此审计与 GC 都不读它——保留访问器
    /// 是为了让 D2.2c 的 "purge 不影响可达性" 用例能同时验证两侧。
    #[allow(dead_code, reason = "D2.2c 的可达性用例会同时验证卡与包两侧")]
    cards: LocalCardStore,
}

impl Fixture {
    /// 在唯一临时目录 + 内存库上建一个夹具。目录由调用方标签区分，便于并行测试互不干扰。
    pub fn new(label: &str) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);

        let root = std::env::temp_dir().join(format!(
            "mahoshojo-fixture-{label}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("blobs")).expect("create fixture root");

        let connection = open_in_memory_connection().expect("in-memory connection");
        let blobs =
            crate::blob::open(BlobPaths::under(&root), connection.clone()).expect("blob store");
        let packages = WebPackageStore::new(connection.clone());
        let cards = LocalCardStore::new(connection.clone());

        Self {
            root,
            connection,
            blobs,
            packages,
            cards,
        }
    }

    pub fn data_root(&self) -> &Path {
        &self.root
    }

    pub fn connection(&self) -> &SharedConnection {
        &self.connection
    }

    pub fn blobs(&self) -> &BlobStore {
        &self.blobs
    }

    #[allow(dead_code, reason = "D2.2c 的 GC 用例会直接断言引用表内容")]
    pub fn packages(&self) -> &WebPackageStore {
        &self.packages
    }

    #[allow(dead_code, reason = "D2.2c 的可达性用例会同时验证卡与包两侧")]
    pub fn cards(&self) -> &LocalCardStore {
        &self.cards
    }

    fn blob_file(&self, digest: &str) -> PathBuf {
        blob_path(&BlobPaths::under(&self.root), digest).expect("digest must be well-formed")
    }

    /// 造一条自洽的包记录并保存。
    ///
    /// 返回 `SavedPackage`：document 与 index（后续转移需要），以及**归档字节的摘要**。
    ///
    /// 第三个返回值不是多余的。`manifest_digest` 是领域身份，而 blob 的落盘路径由**归档
    /// 字节自身**的摘要派生（`DESK-063`）——两者必然不同。把 manifest 摘要当成文件路径去
    /// 找会 `NotFound`，而这正是该条款警告的混淆。
    pub fn save_package(&self, id: &str, manifest_digest: &str, archive: &[u8]) -> SavedPackage {
        let now = "2026-10-01T00:00:00.000Z";
        let document = package_document(id, manifest_digest, now, archive.len() as i64);
        let index = WebPackageIndex {
            id: id.to_string(),
            updated_at: now.to_string(),
            deleted_at: None,
            content_digest: manifest_digest.to_string(),
        };
        let archive_digest = crate::blob::digest_of(archive);
        self.packages
            .save(&self.blobs, &document, &index, archive, now)
            .expect("package must save");
        SavedPackage {
            document,
            index,
            archive_digest,
        }
    }

    /// 软删一条已保存的包。字节必须仍然可达（`DESK-055`）。
    ///
    /// 刻意用**字符串替换**而不是 `serde_json` 改写：这条路径要复现"渲染层组装好整条记录
    /// 再交给 native"这一真实形状（`DESK-050`），而 `serde_json::Value` 会重排键序，
    /// 使它测到的是一个 native 侧没见过的输入。
    pub fn soft_delete_package(&self, saved: &SavedPackage) {
        let tombstoned_at = "2026-10-02T00:00:00.000Z";
        let document = saved.document.replace(
            r#""updatedAt":"2026-10-01T00:00:00.000Z""#,
            &format!(r#""deletedAt":"{tombstoned_at}","updatedAt":"{tombstoned_at}""#),
        );
        let index = WebPackageIndex {
            updated_at: tombstoned_at.to_string(),
            deleted_at: Some(tombstoned_at.to_string()),
            ..saved.index.clone()
        };
        self.packages
            .delete(&document, &index)
            .expect("soft delete must succeed");
    }

    /// 彻底删除一条包（引用行随之 CASCADE 移除，字节留下）。
    pub fn purge_package(&self, id: &str) {
        self.packages.purge(id).expect("purge must succeed");
    }

    /// 注入"metadata 在、文件不在"。
    pub fn remove_blob_file(&self, digest: &str) -> std::io::Result<()> {
        std::fs::remove_file(self.blob_file(digest))
    }

    /// 注入"文件在、内容已被改写"。绕开 blob 的写入校验——那正是它该拦下的东西。
    pub fn overwrite_blob_file(&self, digest: &str, bytes: &[u8]) {
        std::fs::write(self.blob_file(digest), bytes).expect("overwrite the blob file");
    }

    /// 植入一个孤儿文件（文件在、metadata 不在）。
    pub fn write_orphan_file(&self, digest: &str, bytes: &[u8]) -> std::io::Result<()> {
        std::fs::write(self.blob_file(digest), bytes)
    }

    /// 直接删掉一条引用行，制造"包记录存在但没有引用"。
    ///
    /// 绕过 `purge` 是必须的：`purge` 会把包记录也删掉，那样就变成了另一桶。
    pub fn delete_reference_row(&self, package_id: &str) {
        self.with_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM web_package_archive_ref WHERE package_id = ?1",
                    rusqlite::params![package_id],
                )
                .expect("delete reference row");
        });
    }

    /// 注入一个真实的外键违规：先关掉 `foreign_keys`，再插一行指向不存在 blob 的引用。
    ///
    /// 返回是否真的注入成功——若 pragma 切换失败，调用方**必须**跳过断言，否则测试会
    /// 假绿（什么都没注入，却断言"没有发现违规"）。
    pub fn inject_foreign_key_violation(&self) -> bool {
        self.with_connection(|connection| {
            if connection.execute_batch("PRAGMA foreign_keys = OFF").is_err() {
                return false;
            }
            let inserted = connection
                .execute(
                    "INSERT INTO web_package_archive_ref (package_id, digest)
                     VALUES ('ghost-package', 'sha256:3333333333333333333333333333333333333333333333333333333333333333')",
                    [],
                )
                .is_ok();
            let _ = connection.execute_batch("PRAGMA foreign_keys = ON");
            inserted
        })
    }

    fn with_connection<T>(&self, operation: impl FnOnce(&Connection) -> T) -> T {
        let guard = crate::store::lock_connection(&self.connection).expect("lock connection");
        operation(&guard)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// 一次保存的结果。
pub struct SavedPackage {
    pub document: String,
    pub index: WebPackageIndex,
    /// 归档字节的摘要，即 blob 的落盘地址。**不是** manifest 摘要（`DESK-063`）。
    pub archive_digest: String,
}

/// 造一条 `LocalWebPackageRecordV1` 的 JSON 文本。
///
/// 手写而不是 `serde_json::json!`：这份文档必须**逐字节**匹配契约（字段名、`entityKind`
/// 顺序、时间戳格式），而 `json!` 的输出顺序由源码书写顺序决定，改动它就会静默改变
/// 测试的输入。这类夹具必须能被肉眼逐字段核对。
pub fn package_document(
    id: &str,
    manifest_digest: &str,
    timestamp: &str,
    archive_byte_length: i64,
) -> String {
    format!(
        r#"{{"id":"{id}","schemaVersion":1,"storageLocation":"local","entityKind":"web-package","title":"夹具包","summary":"fixture@1.0.0","ref":{{"digest":"{manifest_digest}","id":"local.fixture","version":"1.0.0"}},"manifest":{{"format":"mahoshojo-web-package","formatVersion":1,"id":"local.fixture","version":"1.0.0","name":"夹具包","entry":"index.html","capabilities":[],"files":[{{"path":"index.html","mediaType":"text/html","digest":"{manifest_digest}","size":2}}]}},"contentDigest":"{manifest_digest}","archiveByteLength":{archive_byte_length},"provenance":{{"kind":"unsigned","execution":"imported"}},"createdAt":"{timestamp}","updatedAt":"{timestamp}"}}"#
    )
}
