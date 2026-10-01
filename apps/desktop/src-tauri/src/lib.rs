//! MahoShojo Generator 本地桌面客户端的 Rust 侧入口。
//!
//! 当前阶段（D0 + D0.5）Rust 侧承担两件事：
//!
//! 1. 报告本地运行时自述；
//! 2. 把持久 secret 写入操作系统凭据存储。
//!
//! 这里**刻意没有**明文 secret 读取 command，也没有出站 HTTP、数据库或任意文件写入。
//! Direct AI transport、SQLite 本地库分别在 D1 与 D2 引入，并且都必须先经过对应门禁
//! （见 `PLAN-desktop-client-v1`）。

mod ai;
#[cfg(test)]
mod ai_contract_tests;
#[cfg(test)]
mod ai_e2e_tests;
mod audit;
mod blob;
mod gc;
mod library;
mod local_card;
#[cfg(test)]
mod local_card_contract_tests;
mod maintenance;
#[cfg(test)]
mod maintenance_contract_tests;
mod provider_profile;
mod secret;
mod sse;
mod store;
#[cfg(test)]
mod test_fixture;
mod web_package;

use library::LocalLibrary;
use provider_profile::DirectProviderExecutionProfile;
use secret::{default_secret_store, SharedSecretStore};
use serde::Serialize;
use tauri::{Manager, State};

/// 供渲染层展示的本地运行时信息。
///
/// 全部字段都是非秘密的构建期或平台事实。这里刻意不返回任何 endpoint、凭据、
/// 文件路径或服务器配置。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    app_version: String,
    tauri_version: String,
    os: String,
    arch: String,
    packaged: bool,
}

#[tauri::command]
fn desktop_runtime_info(app: tauri::AppHandle) -> DesktopRuntimeInfo {
    let package_info = app.package_info();

    DesktopRuntimeInfo {
        app_version: package_info.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        packaged: !cfg!(debug_assertions),
    }
}

/// 写入或覆盖一条持久 secret。
///
/// renderer 在用户主动录入时可以持有明文，但这是最后一条把它交给 Rust 的路径：
/// 之后明文只存在于操作系统凭据存储与 Rust 侧的出站请求构造中。
#[tauri::command]
fn set_provider_secret(
    store: State<'_, SharedSecretStore>,
    secret_ref: String,
    value: String,
) -> Result<(), secret::SecretStoreError> {
    store.set(&secret_ref, &value)
}

/// 报告某条 secret 是否已存在。**永不**返回值本身。
#[tauri::command]
fn has_provider_secret(
    store: State<'_, SharedSecretStore>,
    secret_ref: String,
) -> Result<bool, secret::SecretStoreError> {
    store.exists(&secret_ref)
}

/// 删除一条 secret。幂等：引用不存在同样成功。
#[tauri::command]
fn delete_provider_secret(
    store: State<'_, SharedSecretStore>,
    secret_ref: String,
) -> Result<(), secret::SecretStoreError> {
    store.delete(&secret_ref)
}

/// 写入或覆盖一个 Provider Profile。
///
/// `document` 必须是 TypeScript 侧已通过 `DirectProviderProfileV1Schema` 校验的完整
/// Profile JSON。Rust 把它当作 opaque 文档存储，**不解释**业务字段；同时它只按 id 存取，
/// 不接受 renderer 提供的路径或 SQL。
#[tauri::command]
fn save_provider_profile(
    library: State<'_, LocalLibrary>,
    document: String,
    updated_at: String,
) -> Result<(), store::StoreError> {
    let identity = provider_profile::StoredProviderProfileIdentity::parse(&document)
        .map_err(|_| store::StoreError::InvalidDocument)?;
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library.profiles().put(&identity.id, &document, &updated_at)
}

/// 列出已保存的 Profile id。
#[tauri::command]
fn list_provider_profile_ids(
    library: State<'_, LocalLibrary>,
) -> Result<Vec<String>, store::StoreError> {
    library.profiles().list_ids()
}

/// 读取一个 Profile 的完整文档。缺失时返回 `None`，不视为错误。
#[tauri::command]
fn get_provider_profile(
    library: State<'_, LocalLibrary>,
    profile_id: String,
) -> Result<Option<String>, store::StoreError> {
    library.profiles().get(&profile_id)
}

/// 删除一个 Profile 及其引用的 secret。幂等。
#[tauri::command]
fn delete_provider_profile(
    library: State<'_, LocalLibrary>,
    secrets: State<'_, SharedSecretStore>,
    profile_id: String,
) -> Result<(), store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    if let Some(document) = library.profiles().get(&profile_id)? {
        if let Ok(identity) = provider_profile::StoredProviderProfileIdentity::parse(&document) {
            for secret_ref in identity.secret_refs() {
                // 删除 Profile 不因凭据后端故障而失败：凭据残留由后续清理处理，
                // 但必须让调用方知道这不是一次完整清理。
                let _ = secrets.delete(&secret_ref);
            }
        }
    }
    library.profiles().delete(&profile_id)
}

/// 校验一份执行投影，并返回 Rust 侧独立解析后的结果。
///
/// 存在的意义是让"TypeScript 认为合法"与"native 侧也认为合法"在 UI 层就能对齐，而不是等到
/// 真正发起请求时才失败。
#[tauri::command]
fn validate_provider_execution_profile(
    document: String,
) -> Result<DirectProviderExecutionProfile, provider_profile::ProviderProfileError> {
    DirectProviderExecutionProfile::parse(&document)
}

/// 对已保存的 Profile 发起一次 Direct 流式生成。
///
/// 请求 DTO 只带 `profileId` 与 `AiExecutionRequest`：endpoint、header 与 secret 全部由
/// native 侧从本地库与凭据存储解析，renderer 无法指定。
#[tauri::command]
async fn stream_direct_ai(
    library: State<'_, LocalLibrary>,
    secrets: State<'_, SharedSecretStore>,
    registry: State<'_, ai::RequestRegistry>,
    profile_id: String,
    request: ai::AiExecutionRequest,
    on_event: tauri::ipc::Channel<ai::AiStreamEvent>,
) -> Result<(), ai::DirectAiError> {
    ai::stream_direct_ai(
        &profile_id,
        request,
        library.profiles(),
        secrets.inner().as_ref(),
        &registry,
        &on_event,
    )
    .await
}

/// 取消一次在途的 Direct 生成。
///
/// 取消会真正中止上游 HTTP body，而不只是让 renderer 停止消费事件。
#[tauri::command]
fn cancel_direct_ai(
    registry: State<'_, ai::RequestRegistry>,
    request_id: String,
) -> Result<bool, ai::DirectAiError> {
    Ok(registry.cancel(&request_id))
}

/// 本地卡 IPC 用的 DTO。
///
/// 与 Rust 存储层解耦：command 层只搬运已校验的 JSON 记录与索引列，**不解释**卡的内容
/// 语义。索引列由 TypeScript 提供，native 侧独立复核（见 `local_card::LocalCardStore::put`）。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveLocalCardRequest {
    /// 已通过 `LocalCardRecordV1Schema` 校验的完整记录，序列化为 JSON 文本。
    document: String,
    index: local_card::LocalCardIndex,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveLocalCardResponse {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListLocalCardsRequest {
    #[serde(default)]
    include_deleted: bool,
    #[serde(default)]
    card_types: Vec<String>,
    limit: i64,
    /// 上一页返回的 `nextCursor`，原样回传。
    #[serde(default)]
    cursor: Option<LocalCardCursorDto>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalCardCursorDto {
    /// keyset 排序键（UTC epoch 毫秒），由 native 从 document 的 `updatedAt` 自行解析。
    #[serde(default)]
    updated_at_sort: i64,
    updated_at: String,
    id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ListLocalCardsResponse {
    documents: Vec<String>,
    next_cursor: Option<LocalCardCursorDto>,
}

/// 保存一条本地数据卡。
///
/// 业务级 IPC：renderer 交出"一条已校验的记录"，native 负责落盘。这里**没有** `readFile` /
/// `writeFile` / `query` 形态的通用能力（ADR 第 7 条）。
#[tauri::command]
fn save_local_card(
    library: State<'_, LocalLibrary>,
    request: SaveLocalCardRequest,
) -> Result<SaveLocalCardResponse, store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library.cards().put(&request.document, &request.index)?;
    Ok(SaveLocalCardResponse {
        id: request.index.id,
    })
}

#[tauri::command]
fn get_local_card(
    library: State<'_, LocalLibrary>,
    id: String,
) -> Result<Option<String>, store::StoreError> {
    library.cards().get(&id)
}

#[tauri::command]
fn list_local_cards(
    library: State<'_, LocalLibrary>,
    request: ListLocalCardsRequest,
) -> Result<ListLocalCardsResponse, store::StoreError> {
    let page = library.cards().list(&local_card::LocalCardQuery {
        include_deleted: request.include_deleted,
        card_types: request.card_types,
        limit: request.limit,
        cursor: request.cursor.map(|cursor| local_card::LocalCardCursor {
            updated_at_sort: cursor.updated_at_sort,
            updated_at: cursor.updated_at,
            id: cursor.id,
        }),
    })?;

    Ok(ListLocalCardsResponse {
        documents: page.documents,
        next_cursor: page.next_cursor.map(|cursor| LocalCardCursorDto {
            updated_at_sort: cursor.updated_at_sort,
            updated_at: cursor.updated_at,
            id: cursor.id,
        }),
    })
}

/// 软删一条本地卡。
///
/// 与保存同形：调用方交出**组装完成的完整记录**（含 `deletedAt`），native 只校验这次状态
/// 转移并原子写入整行。刻意不接受 `(id, deletedAt)` 只改索引列——那样 document 里的
/// `deletedAt` 仍是旧值，而 `get()` 返回的正是 document，调用方会拿到一条"看起来没被
/// 删除"的记录。
#[tauri::command]
fn delete_local_card(
    library: State<'_, LocalLibrary>,
    request: SaveLocalCardRequest,
) -> Result<(), store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library.cards().delete(&request.document, &request.index)
}

#[tauri::command]
fn restore_local_card(
    library: State<'_, LocalLibrary>,
    request: SaveLocalCardRequest,
) -> Result<(), store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library.cards().restore(&request.document, &request.index)
}

/// 彻底删除一条本地卡。幂等。
#[tauri::command]
fn purge_local_card(library: State<'_, LocalLibrary>, id: String) -> Result<(), store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library.cards().purge(&id)
}

/// Web 包 IPC 用的 DTO。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveWebPackageRequest {
    /// 已通过 `LocalWebPackageRecordV1Schema` 校验的完整记录，序列化为 JSON 文本。
    document: String,
    index: web_package::WebPackageIndex,
    /// 原始 ZIP 字节的 base64。与文档分开传：文档是 JSON 文本，载荷是二进制，混在一个
    /// 字段里会让两侧都要为对方的数据形状做让步。
    #[serde(with = "base64_bytes::field")]
    archive: Vec<u8>,
    /// 渲染层时钟。软删/恢复必须单调推进，native 不引入时间库。
    now: String,
}

/// 删除/恢复用的请求体。
///
/// 与保存请求分开是因为状态转移**不产生新字节**：若复用保存请求，恢复一个包也得先把整个 ZIP
/// 读回内存才能调一次命令——既慢，又在字节已缺失时把恢复变成不可能。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebPackageTransitionRequest {
    document: String,
    index: web_package::WebPackageIndex,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveWebPackageResponse {
    id: String,
    /// `stored` / `alreadyPresent` / `repaired`。`repaired` **MUST** 被透传到 UI：
    /// 存储损坏被静默吞掉的话，用户永远不会知道自己这份库已经不健康。
    blob_outcome: blob::BlobWriteOutcome,
}

/// base64 传输二进制。
///
/// `DESK-064` 要求二进制信封同时携带载荷与其字节长度，两端都在解码后核对长度。
/// **请求与响应共用同一个类型**——让读写各自定义形状是"读出来是一根字符串"这类 bug 的温床：
/// 两侧各自的单测都会绿，因为它们各自 mock 了对方的形状。
///
/// 用标准 crate 而不是手写：宽松的 padding 处理会静默接受截断载荷（失败点被推到解包器里，
/// 离真正原因很远），而逐字符线性查表在 64 MiB 归档上是 10^9 量级的字符比较。
mod base64_bytes {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    /// IPC 上的 base64 信封：编码后的载荷 + 解码后的字节长度。
    ///
    /// 请求与响应**共用这一个类型**：让读写各自定义形状，正是"读出来是一根裸字符串"这类
    /// bug 的温床——两侧各自的单测都会绿，因为它们各自 mock 了对方的形状。
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Base64Bytes {
        pub b64: String,
        pub len: usize,
    }

    impl Base64Bytes {
        pub fn from_bytes(bytes: &[u8]) -> Self {
            Self {
                b64: STANDARD.encode(bytes),
                len: bytes.len(),
            }
        }

        /// 解码并核对长度。
        ///
        /// 长度核对不可省：静默接受截断载荷会产出"看起来完整"的短归档，把失败点推到解包器里。
        pub fn decode(&self) -> Result<Vec<u8>, String> {
            let bytes = STANDARD
                .decode(&self.b64)
                .map_err(|_| "载荷不是合法的标准 base64".to_string())?;
            if bytes.len() != self.len {
                return Err(format!(
                    "base64 载荷长度不符：声明 {}，实际 {}",
                    self.len,
                    bytes.len()
                ));
            }
            Ok(bytes)
        }
    }

    /// serde 的 `(serialize, deserialize)` 适配器。请求与响应两个方向的实现相同——
    /// 它们共享 `Base64Bytes`，因此不可能漂移。
    pub mod field {
        use super::{Base64Bytes, Deserializer, Serialize, Serializer};
        use serde::de::Error as _;
        use serde::Deserialize as _;

        pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
            Base64Bytes::from_bytes(bytes).serialize(serializer)
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(
            deserializer: D,
        ) -> Result<Vec<u8>, D::Error> {
            Base64Bytes::deserialize(deserializer)?
                .decode()
                .map_err(D::Error::custom)
        }
    }
}

/// 保存一条本地 Web 包及其 ZIP 字节。
///
/// blob 先落盘，再在一个事务里写包记录与**真实外键**引用行（`DESK-055`）。因此崩溃最多留下
/// 孤儿 blob，而不会出现"引用行存在但包记录不存在"的中间态。
#[tauri::command]
fn save_web_package(
    library: State<'_, LocalLibrary>,
    request: SaveWebPackageRequest,
) -> Result<SaveWebPackageResponse, web_package::SaveWebPackageError> {
    // 许可覆盖"写 blob + 写包事务"整段，而不是各自一半。
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    let outcome = library.packages().save(
        library.blobs(),
        &request.document,
        &request.index,
        &request.archive,
        &request.now,
    )?;
    Ok(SaveWebPackageResponse {
        id: outcome.id,
        blob_outcome: outcome.blob,
    })
}

#[tauri::command]
fn get_web_package(
    library: State<'_, LocalLibrary>,
    id: String,
) -> Result<Option<String>, store::StoreError> {
    library.packages().get(&id)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ListWebPackagesResponse {
    documents: Vec<String>,
    next_cursor: Option<LocalCardCursorDto>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListWebPackagesRequest {
    #[serde(default)]
    include_deleted: bool,
    limit: i64,
    #[serde(default)]
    cursor: Option<LocalCardCursorDto>,
}

#[tauri::command]
fn list_web_packages(
    library: State<'_, LocalLibrary>,
    request: ListWebPackagesRequest,
) -> Result<ListWebPackagesResponse, store::StoreError> {
    let page = library.packages().list(&web_package::WebPackageQuery {
        include_deleted: request.include_deleted,
        limit: request.limit,
        cursor: request.cursor.map(|cursor| web_package::WebPackageCursor {
            updated_at_sort: cursor.updated_at_sort,
            updated_at: cursor.updated_at,
            id: cursor.id,
        }),
    })?;
    Ok(ListWebPackagesResponse {
        documents: page.documents,
        next_cursor: page.next_cursor.map(|cursor| LocalCardCursorDto {
            updated_at_sort: cursor.updated_at_sort,
            updated_at: cursor.updated_at,
            id: cursor.id,
        }),
    })
}

/// 软删一条本地 Web 包。**不动引用行**，因此 restore 能真正恢复可用状态。
///
/// 复用删除/恢复专用的请求体（与保存请求分开）：状态转移不产生新字节，因此这里既不带
/// `archive` 也不带 `now`——时间戳已由渲染层写进 document，native 从 document 复核单调性。
#[tauri::command]
fn delete_web_package(
    library: State<'_, LocalLibrary>,
    request: WebPackageTransitionRequest,
) -> Result<(), store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library.packages().delete(&request.document, &request.index)
}

/// 恢复一条已软删的本地 Web 包。
#[tauri::command]
fn restore_web_package(
    library: State<'_, LocalLibrary>,
    request: WebPackageTransitionRequest,
) -> Result<(), store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library
        .packages()
        .restore(&request.document, &request.index)
}

/// 彻底删除一条本地 Web 包与其 blob 引用。幂等。
///
/// 只删引用行，**不**删 blob 字节：字节的回收是 GC 的职责，且必须在维护窗口内进行
/// （`DESK-055` / `DESK-072`）。因此这条命令之后，该 blob 会成为一个"有 metadata、无引用"
/// 的回收候选——这是被允许的中间态，不是损坏。
#[tauri::command]
fn purge_web_package(
    library: State<'_, LocalLibrary>,
    id: String,
) -> Result<(), store::StoreError> {
    let _permit = library.enter_write().map_err(store::StoreError::from)?;
    library.packages().purge(&id)
}

/// 回收无引用的 blob 字节。
///
/// 判定只依据引用表；`last_referenced_at` **不参与**（`DESK-065`）。删除顺序由 `DESK-072`
/// 固定为"先 metadata 后文件"。
///
/// `async fn` + `spawn_blocking`：删除文件是同步 I/O，且一次 GC 可能涉及成百上千个 blob。
/// 维护窗口内所有写入被拒，因此这段时间 UI 只能等——让它至少还能重绘。
#[tauri::command]
async fn collect_local_garbage(
    app: tauri::AppHandle,
) -> Result<gc::GarbageCollectionReport, gc::GarbageCollectionError> {
    let window = app
        .state::<LocalLibrary>()
        .enter_maintenance("gc")
        .map_err(|_| gc::GarbageCollectionError::Unavailable)?;

    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let library = handle.state::<LocalLibrary>();
        gc::collect(
            &blob::BlobPaths::under(library.data_root()),
            library.connection(),
        )
    })
    .await
    .map_err(|_| gc::GarbageCollectionError::Failure)?;

    drop(window);
    result
}

/// 跑一次本地库完整性审计。**只报告，不修复。**
///
/// 返回形状与 `DesktopLocalLibraryAuditReportSchema` 一一对应。审计 MUST 在维护窗口内执行
/// （`DESK-067`）：单次 SQL 查询是原子的，但"读 metadata → 读文件 → 读 metadata"不是——
/// save 落在中间会报出一个假的损坏桶，而用户据此去恢复数据只会发现什么都没有。
///
/// `async fn` + `spawn_blocking`：审计要为每个被引用 blob 重算 SHA-256，是 O(字节) 的工作。
/// 同步 command 会在调用线程上跑完它，期间整个 WebView 无法重绘。
#[tauri::command]
async fn audit_local_library(
    app: tauri::AppHandle,
) -> Result<audit::AuditReport, audit::AuditError> {
    // 这里刻意用 `AppHandle` + `state()` 而不是 `State<'_, LocalLibrary>`：`State` 借用
    // 函数体的生命周期，无法 move 进 `spawn_blocking`。`AppHandle` 是 cloneable + Send，
    // 且 `state()` 在阻塞任务里取到的仍是同一份 managed state。
    let window = app
        .state::<LocalLibrary>()
        .enter_maintenance("audit")
        .map_err(|_| audit::AuditError::Unavailable)?;

    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let library = handle.state::<LocalLibrary>();
        audit::audit(
            library.blobs(),
            &blob::BlobPaths::under(library.data_root()),
            library.connection(),
        )
    })
    .await
    .map_err(|_| audit::AuditError::Failure)?;

    drop(window);
    result
}

/// 读取一个本地 Web 包的原始 ZIP 字节。
///
/// **按 `contentDigest` 查，不是按包 id。** 共享端口 `WebPackageRepository.readArchive(digest)`
/// 与 Web 的 IndexedDB adapter 都以 manifest 摘要为键，业务侧传的也正是 `record.ref.digest`。
/// 把它当成包 id 会让真实读取路径必然落空（manifest 摘要永远不是 `wp_…` 形式）。
///
/// 返回 `{b64, len}` 信封而非裸 base64 字符串：`DESK-064` 要求二进制载荷自带长度，
/// 而裸字符串会让渲染层无法核对——它只能选择"要么不核对，要么解析失败"。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadWebPackageArchiveResponse {
    #[serde(with = "base64_bytes::field")]
    archive: Vec<u8>,
}

#[tauri::command]
fn read_web_package_archive(
    library: State<'_, LocalLibrary>,
    content_digest: String,
) -> Result<ReadWebPackageArchiveResponse, web_package::SaveWebPackageError> {
    let digest = library
        .packages()
        .archive_digest_for_content_digest(&content_digest)
        .map_err(web_package::SaveWebPackageError::Store)?;
    let digest = digest.ok_or(web_package::SaveWebPackageError::Blob(
        blob::BlobError::NotFound,
    ))?;
    let bytes = library.blobs().read(&digest)?;
    Ok(ReadWebPackageArchiveResponse { archive: bytes })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(default_secret_store())
        .manage(ai::RequestRegistry::default())
        .setup(|app| {
            // 应用数据目录只能在 Builder 内部解析，因此本地库在 setup 阶段打开。
            // 路径完全由 native 侧产生：renderer 既不能指定目录，也不能指定文件名或 SQL。
            let data_root = app.path().app_data_dir().map_err(|error| {
                format!("cannot resolve the application data directory: {error}")
            })?;

            // 单实例先于一切本地库访问（`DESK-065` / `DESK-068`）。顺序不可颠倒：
            // 先开库再抢锁的话，两个进程都可能已经建立了连接，然后第二个才失败——
            // 那时它已经跑完了迁移阶梯，可能留下一个"迁移了一半"的库。
            //
            // 锁由 `_instance` 持到进程结束：它是 `setup` 的局部变量，因此**必须** manage
            // 出去，否则会在 setup 返回时立刻 drop，锁随之释放，单实例约束形同虚设。
            let instance = maintenance::InstanceGuard::acquire(&data_root).map_err(|rejection| {
                format!(
                    "cannot open the local library: {}。请先关闭已运行的 MahoShojo Generator 桌面客户端。",
                    rejection.message()
                )
            })?;

            let library = LocalLibrary::open(&data_root)
                .map_err(|error| format!("cannot open the local store: {}", error.message()))?;

            app.manage(instance);
            app.manage(library);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_info,
            set_provider_secret,
            has_provider_secret,
            delete_provider_secret,
            save_provider_profile,
            list_provider_profile_ids,
            get_provider_profile,
            delete_provider_profile,
            validate_provider_execution_profile,
            stream_direct_ai,
            cancel_direct_ai,
            save_local_card,
            get_local_card,
            list_local_cards,
            delete_local_card,
            restore_local_card,
            purge_local_card,
            save_web_package,
            get_web_package,
            list_web_packages,
            delete_web_package,
            restore_web_package,
            purge_web_package,
            read_web_package_archive,
            audit_local_library,
            collect_local_garbage
        ])
        .run(tauri::generate_context!())
        .expect("error while running MahoShojo Generator desktop app");
}

#[cfg(test)]
mod tests {
    use super::{base64_bytes, DesktopRuntimeInfo};

    /// base64 MUST 与标准实现逐字节一致。
    ///
    /// 这个信封与渲染层的解码器只有一次 IPC 调用相隔，漂移的表现是"存进去读不出来"，而且要
    /// 到用户导入 Web 包时才暴露。逐长度覆盖 0/1/2/3 字节的尾部情形，期望值取自 Node 的
    /// `Buffer.toString('base64')`。
    #[test]
    fn base64_matches_the_standard_encoding() {
        for (bytes, expected) in [
            (&b""[..], ""),
            (&b"P"[..], "UA=="),
            (&b"PK"[..], "UEs="),
            (&b"PK\x03"[..], "UEsD"),
            (&b"PK\x03\x04"[..], "UEsDBA=="),
            (&b"PK\x03\x04z"[..], "UEsDBHo="),
            (&b"PK\x03\x04zh"[..], "UEsDBHpo"),
        ] {
            let envelope = base64_bytes::Base64Bytes::from_bytes(bytes);
            assert_eq!(envelope.b64, expected, "len={}", bytes.len());
            assert_eq!(envelope.len, bytes.len());
            assert_eq!(envelope.decode().as_deref(), Ok(bytes), "{expected}");
        }
    }

    #[test]
    fn base64_round_trips_every_byte_value() {
        let all: Vec<u8> = (0..=255_u8).collect();
        let envelope = base64_bytes::Base64Bytes::from_bytes(&all);
        assert_eq!(envelope.decode().as_deref(), Ok(all.as_slice()));
    }

    /// 非法输入 MUST 被拒，而不是产出一段"看起来能用"的错误字节。
    ///
    /// 这几条正是自写解码器的典型漏洞面：遇到 `=` 就 `break` 而不校验 padding，于是尾随垃圾
    /// 会被静默丢弃——`UEsDBQ==garbage` 和 `UEsDBQ==` 会被当成同一份载荷。
    #[test]
    fn base64_rejects_malformed_payloads() {
        for bad in [
            "UEsD*Q==",        // 字母表外字符
            "UEsD Q==",        // 空白
            "UEsDBQ=",         // padding 长度错误
            "UEsDBQ",          // 长度不是 4 的倍数
            "UEsDBQ==garbage", // padding 之后的尾随内容
            "UEs=DBA=",        // '=' 出现在中间
        ] {
            assert!(
                base64_bytes::Base64Bytes {
                    b64: bad.to_string(),
                    len: 3
                }
                .decode()
                .is_err(),
                "{bad} MUST be rejected"
            );
        }
    }

    /// 长度核对 MUST 生效：截断载荷会变成"看起来完整"的短归档。
    #[test]
    fn base64_rejects_a_length_that_does_not_match_the_payload() {
        assert!(base64_bytes::Base64Bytes {
            b64: "UEsDBA==".to_string(),
            len: 99
        }
        .decode()
        .is_err());
    }

    /// 请求与响应两个方向 MUST 产出同一形状的线上字段。
    ///
    /// 它们曾各写各的：native 返回裸字符串，渲染层按对象解析——两侧单测都绿（各自 mock 了
    /// 对方），真实 IPC 才炸。因此这里断言序列化结果的字段名集合。
    #[test]
    fn the_base64_envelope_has_one_wire_shape_in_both_directions() {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Response {
            #[serde(with = "base64_bytes::field")]
            archive: Vec<u8>,
        }
        let archive = b"PK\x03\x04".to_vec();
        let value = serde_json::to_value(Response { archive }).expect("must serialize");
        assert_eq!(
            value,
            serde_json::json!({ "archive": { "b64": "UEsDBA==", "len": 4 } }),
            "响应方向必须也是 {{b64, len}}，不能是裸字符串"
        );
    }

    #[test]
    fn runtime_info_serializes_as_camel_case_without_secrets() {
        let info = DesktopRuntimeInfo {
            app_version: "0.0.0".to_string(),
            tauri_version: "2.12.0".to_string(),
            os: "windows".to_string(),
            arch: "x86_64".to_string(),
            packaged: false,
        };

        let value = serde_json::to_value(&info).expect("runtime info must serialize");

        assert_eq!(value["appVersion"], "0.0.0");
        assert_eq!(value["tauriVersion"], "2.12.0");
        assert_eq!(value["os"], "windows");
        assert_eq!(value["arch"], "x86_64");
        assert_eq!(value["packaged"], false);

        let mut keys: Vec<&str> = value
            .as_object()
            .expect("runtime info must serialize as an object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["appVersion", "arch", "os", "packaged", "tauriVersion"],
            "runtime info must not expose any additional field"
        );
    }
}
