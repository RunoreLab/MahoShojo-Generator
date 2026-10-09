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
mod announcements;
mod audit;
mod backup;
mod blob;
mod cloud;
mod config;
mod export;
mod external_link;
mod gc;
mod library;
mod local_card;
#[cfg(test)]
mod local_card_contract_tests;
mod maintenance;
#[cfg(test)]
mod maintenance_contract_tests;
mod provider_profile;
#[cfg(test)]
mod provider_profile_ipc_contract_tests;
mod public_cache;
mod restore;
mod secret;
mod sse;
mod store;
#[cfg(test)]
mod test_fixture;
mod web_package;
mod webpkg_instance;

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
/// 写入语义，与 TS 侧 `DesktopLocalLibraryWriteModeSchema` 一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
enum DesktopLocalLibraryWriteMode {
    Overwrite,
    InsertIfAbsent,
}

impl Default for DesktopLocalLibraryWriteMode {
    /// 缺省为覆盖写。不该用 `#[serde(default)]` 而在类型上实现 `Default`：这样旧客户端的请求仍然可用，
    /// 而且读这个类型的代码都不会想到还要判断“字段先存在”。
    fn default() -> Self {
        Self::Overwrite
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveLocalCardRequest {
    /// 已通过 `LocalCardRecordV1Schema` 校验的完整记录，序列化为 JSON 文本。
    document: String,
    index: local_card::LocalCardIndex,
    #[serde(default)]
    write_mode: DesktopLocalLibraryWriteMode,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveLocalCardResponse {
    id: String,
    /// `insert-if-absent` 下说明目标已存在且**没有被动过**。
    #[serde(default)]
    already_present: bool,
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
    // 与 DesktopListLocalCardsResponseSchema 的 optional 字段一致；serde 默认会把 None 输出成 null。
    #[serde(skip_serializing_if = "Option::is_none")]
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
    // 存在性判定与写入必须在同一个写许可里。先 `get` 再 `put` 的 adapter 形式在这两步之间无事实可以插进来，
    // 而现在两种写法共享同一把许可，所以这一个分支不引入任何新的竞态。
    let outcome = if request.write_mode == DesktopLocalLibraryWriteMode::InsertIfAbsent {
        library
            .cards()
            .put_if_absent(&request.document, &request.index)?
    } else {
        library.cards().put(&request.document, &request.index)?;
        local_card::CardWriteOutcome::Written
    };
    Ok(SaveLocalCardResponse {
        id: request.index.id,
        already_present: matches!(outcome, local_card::CardWriteOutcome::AlreadyPresent),
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
    #[serde(deserialize_with = "base64_bytes::deserialize_bytes")]
    archive: Vec<u8>,
    /// 渲染层时钟。软删/恢复必须单调推进，native 不引入时间库。
    now: String,
    #[serde(default)]
    write_mode: DesktopLocalLibraryWriteMode,
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
    /// `insert-if-absent` 下说明记录与 archive 字节都未被动过。与 `blob_outcome` 的
    /// `already_present` 是两件事：后者说的是"那份 ZIP 字节本来就在 blob 库里"。
    #[serde(default)]
    already_present: bool,
}

/// base64 传输二进制。
///
/// `DESK-064` 要求二进制信封同时携带载荷与其字节长度，两端都在解码后核对长度。
///
/// **只在写入方向使用。** `read_web_package_archive` 曾与请求共用这个信封，后来改成 raw 响应
/// （`tauri::ipc::Response`）——每个 Web 包都经它读取，而 base64 的 33% 体积开销加一次解码峰值
/// 正好落在 D2.3 导出的峰值内存上。两侧形状各自定义是"读出来是一根裸字符串"这类 bug 的温床，
/// 因此本模块仍是**唯一**的 wire 定义，而不是各写各的。
///
/// 编码侧（`from_bytes`）在生产路径上已无调用方，但它保留下来有两个具体理由：它让"与标准实现
/// 逐字节一致"这条断言能够真正对照参考实现，而不是自己和自己比；它也让 `decode` 的往返测试成为
/// 可能。删掉它会把这两条测试一起删掉，而它们守的正是"TS 编码 / Rust 解码不会漂移"。
///
/// 用标准 crate 而不是手写：宽松的 padding 处理会静默接受截断载荷（失败点被推到解包器里，
/// 离真正原因很远），而逐字符线性查表在 64 MiB 归档上是 10^9 量级的字符比较。
mod base64_bytes {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use serde::de::Error as _;
    use serde::{Deserialize, Deserializer};

    /// IPC 上的 base64 信封：编码后的载荷 + 解码后的字节长度。
    ///
    /// 同一份 wire 定义被请求侧解包与标准实现对照共用：让两端各自定义形状，正是"读出来是一根裸字符串"这类
    /// bug 的温床——两侧各自的单测都会绿，因为它们各自 mock 了对方的形状。
    #[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Base64Bytes {
        pub b64: String,
        pub len: usize,
    }

    impl Base64Bytes {
        /// 编码成信封。
        ///
        /// 生产路径上**没有**调用方：读取方向已改 raw 响应，写入方向只解包不编码。它因此只在
        /// 测试里存在——存在的理由是让"与标准实现逐字节一致"这条断言能够真正对照参考实现，
        /// 而不是拿本模块的编码去和本模块的编码比。
        #[cfg(test)]
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

    /// `#[serde(deserialize_with = …)]` 的目标：信封 → 字节，并核对声明长度。
    ///
    /// **刻意只有解包一侧。** `#[serde(with = …)]` 会强制要求序列化函数存在，于是留下一个生产
    /// 路径永不调用的 `serialize`；而 dead code 只会用 `allow` 掩盖"它其实没人用"这个事实。
    pub fn deserialize_bytes<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<u8>, D::Error> {
        Base64Bytes::deserialize(deserializer)?
            .decode()
            .map_err(D::Error::custom)
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
    // 同理：许可覆盖“blob 写入 + 包事务”整段，两种写法因此不需要额外的互斥。
    let outcome = if request.write_mode == DesktopLocalLibraryWriteMode::InsertIfAbsent {
        library.packages().save_if_absent(
            library.blobs(),
            &request.document,
            &request.index,
            &request.archive,
            &request.now,
        )?
    } else {
        library.packages().save(
            library.blobs(),
            &request.document,
            &request.index,
            &request.archive,
            &request.now,
        )?
    };
    Ok(SaveWebPackageResponse {
        id: outcome.id,
        blob_outcome: outcome.blob,
        already_present: outcome.already_present,
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
    // 与 DesktopListWebPackagesResponseSchema 的 optional 字段一致；serde 默认会把 None 输出成 null。
    #[serde(skip_serializing_if = "Option::is_none")]
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

///
/// **已修：这条命令是 `async`，不再冻结主线程。** Tauri 2 对非 `async` 命令在主线程上跑它，
/// 而这条命令做的是一次 `std::fs::read` 加一次完整 SHA-256 校验（最多 64 MiB）。D2.3 的导出对每个
/// Web 包都要读一遍字节，所以导出会按包数冻结渲染层。
///
/// 模式直接借用 [`collect_local_garbage`]：`AppHandle` + `spawn_blocking` + `state::<LocalLibrary>()`。之前这里写着"需要
/// `LocalLibrary` 有一个可跨线程的句柄（它目前没有 `Clone`）"，并把它当作不改的理由——那一条不对：
/// [`collect_local_garbage`] 与审计命令早就在做完全同一件事，而它们不需要 `LocalLibrary: Clone`。
#[tauri::command]
async fn read_web_package_archive(
    app: tauri::AppHandle,
    content_digest: String,
) -> Result<tauri::ipc::Response, web_package::SaveWebPackageError> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let library = handle.state::<LocalLibrary>();
        let digest = library
            .packages()
            .archive_digest_for_content_digest(&content_digest)
            .map_err(web_package::SaveWebPackageError::Store)?
            .ok_or(web_package::SaveWebPackageError::Blob(
                blob::BlobError::NotFound,
            ))?;
        let bytes = library.blobs().read(&digest)?;
        Ok::<_, web_package::SaveWebPackageError>(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| web_package::SaveWebPackageError::Store(store::StoreError::Failure))?
}

/// `begin_web_package_instance` 的请求体。
///
/// renderer 只交**已声明的文件表**（逻辑路径 + mediaType + 字节数）：native 不读 ZIP、
/// 不读 manifest、不接触文件系统——解包与 overlay 语义全部在 TypeScript 权威实现一侧
/// 完成（`DESK-059`），这里的职责只有按声明接收字节并把它们钉进只读资源空间。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BeginWebPackageInstanceRequest {
    entry: String,
    title: String,
    files: Vec<webpkg_instance::DeclaredResourceFile>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenWebPackageInstanceRequest {
    instance_id: String,
}

/// 开启一个 Web Package instance 的暂存会话（D4b / DESK-013）。
///
/// 三条命令都不持维护许可：暂存是纯内存注册表，类型上就够不着数据库连接，与
/// `append_local_archive_export_chunk` 同一理由链。
///
/// begin 成功后立刻在异步运行时排一个 TTL reaper：渲染层崩在 staging 中途时，已收
/// 字节必须在 COLLECT_TTL 到点时真正释放，而不是等下一次 IPC 才被惰性发现。reaper
/// 到点按 `expire_collecting` 的同 generation 校验回收，误删一个还在正常投递的
/// 会话是不可能的（id 单调不复用，且只在仍是 Collecting 且已过期时动手）。
#[tauri::command]
fn begin_web_package_instance(
    app: tauri::AppHandle,
    instances: State<'_, webpkg_instance::WebPackageInstances>,
    request: BeginWebPackageInstanceRequest,
) -> Result<webpkg_instance::BeginInstanceOutcome, webpkg_instance::WebpkgError> {
    let begun = instances.begin(
        &request.entry,
        &request.title,
        request.files,
        std::time::Instant::now(),
    )?;
    let reaper_app = app.clone();
    let instance_id = begun.instance_id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(webpkg_instance::COLLECT_TTL).await;
        reaper_app
            .state::<webpkg_instance::WebPackageInstances>()
            .expire_collecting(&instance_id, std::time::Instant::now());
    });
    Ok(begun)
}

/// 向暂存会话投递一个文件的一段字节（≤ `MAX_APPEND_CHUNK_BYTES`）。
///
/// 与 `append_local_archive_export_chunk` 同构：字节是整个 raw 请求体，instance、
/// 逻辑路径与块内偏移走 header（raw body 会取代整个请求体，`DESK-070` 字节传输节）。
/// `x-webpkg-path` 携带 `encodeURIComponent` 逐段编码后的路径——编码形态写在 header
/// 而不是 path 参数里，因为 IPC 请求行本身会被框架解析一次，让"编码层"与"逻辑路径"
/// 各占一层能避免二次解码歧义。`x-webpkg-offset` 是本块在文件内的偏移（十进制 u64），
/// native 按"offset == 已收长度"验收，乱序/越界一律 `webpkg-resource-mismatch`。
///
/// `command(async)` 的理由与导出 append 相同：raw body 的搬运留在 worker 线程上，
/// 即使单块已封顶 4 MiB，复制也不该落在 WebView 的事件循环里。
#[tauri::command(async)]
fn append_web_package_resource(
    request: tauri::ipc::Request,
    instances: State<'_, webpkg_instance::WebPackageInstances>,
) -> Result<webpkg_instance::AppendResourceOutcome, webpkg_instance::WebpkgError> {
    let instance_id = webpkg_header(&request, webpkg_instance::INSTANCE_ID_HEADER)?;
    let encoded_path = webpkg_header(&request, webpkg_instance::RESOURCE_PATH_HEADER)?;
    let offset = webpkg_header(&request, webpkg_instance::RESOURCE_OFFSET_HEADER)?
        .parse::<u64>()
        .map_err(|_| webpkg_instance::WebpkgError::Invalid)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        // 与导出 append 同一判据：JSON 请求体意味着渲染层走了结构化调用，
        // 接受它会静默退回 base64 形态。
        tauri::ipc::InvokeBody::Json(_) => return Err(webpkg_instance::WebpkgError::Failure),
    };
    instances.append(
        &instance_id,
        &encoded_path,
        offset,
        bytes,
        std::time::Instant::now(),
    )
}

/// 声明表收齐后创建 `webpkg-<instanceId>` webview。
///
/// 必须是 async command：`WebviewWindowBuilder` 官方文档明确记录 Windows 下在同步
/// command/event handler 中创建 WebviewWindow 可能死锁（wry#583）。`async fn` 让
/// registry 收尾与建窗都落在 Tauri 异步运行时线程上——同步 command 在主线程执行，
/// 正好命中那条已知死锁路径；registry 本身只有内存操作，没有需要阻塞 worker 的 I/O，
/// 因此不需要 `spawn_blocking`。第二次并发 open 对 `Opening` 的等待同理发生在
/// worker 线程上，不会冻住 UI。
///
/// 渲染层**不**提供 label、URL 或窗口位置——三者分别由 `label_for_instance`、
/// `entry_url` 与 `WebviewWindowBuilder` 产生；返回值里的 `label` 只是回显给调用方
/// 用于诊断与聚焦。
#[tauri::command]
async fn open_web_package_instance(
    app: tauri::AppHandle,
    instances: State<'_, webpkg_instance::WebPackageInstances>,
    request: OpenWebPackageInstanceRequest,
) -> Result<webpkg_instance::OpenInstanceOutcome, webpkg_instance::WebpkgError> {
    instances.open(&app, &request.instance_id, std::time::Instant::now())
}

/// webpkg raw 请求的 header 读取。缺失或非法一律 `webpkg-invalid`——
/// 不猜、不回退，与 `export_id_header` 同一纪律。
fn webpkg_header(
    request: &tauri::ipc::Request,
    name: &'static str,
) -> Result<String, webpkg_instance::WebpkgError> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .ok_or(webpkg_instance::WebpkgError::Invalid)
}

/// 开启一次导出归档。
///
/// 目标路径由 native 选定（`DESK-071b`"导出目标路径的命名与保留"），渲染层既不能指定目录也不能
/// 指定文件名。它回显的 `absolutePath` 是**计划**路径：文件要到收满声明字节才出现在那里。
/// 与 append 一起在异步运行时调度：等待会话锁、回收旧临时文件与创建新文件都不能占用 UI 主线程。
#[tauri::command(async)]
fn begin_local_archive_export(
    export: State<'_, crate::export::ArchiveExport>,
    declared_total_byte_length: u64,
) -> Result<crate::export::BeginExportOutcome, crate::export::ExportError> {
    export.begin(declared_total_byte_length)
}

/// 追加一块导出字节。
///
/// **不持维护窗口**（`DESK-071b`）。本命令甚至拿不到数据库连接，因此在类型上就无法读到跨时点的
/// 混合状态——这比在注释里承诺"我不读库"可靠得多。
///
/// 结构化参数刻意只有 `exportId`：字节本身走 raw IPC 请求体，而 raw body 会**取代整个请求体**，
/// 因此长度、路径之类的元数据 MUST 走 header（`DESK-070` 字节传输节）。
///
/// `command(async)` 让同步写入及最终 sync/persist 在 Tauri 异步运行时调度，避免阻塞 UI 主线程。
/// Tauri 宏将整个 InvokeMessage 移入 future 后才借用 Request/State，因此可直接借用 raw 字节，
/// 无需为每块额外复制。这里的同步函数签名并不意味着同步 command 调度。
#[tauri::command(async)]
fn append_local_archive_export_chunk(
    request: tauri::ipc::Request,
    export: State<'_, crate::export::ArchiveExport>,
) -> Result<crate::export::AppendExportOutcome, crate::export::ExportError> {
    let export_id = export_id_header(&request)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        // 非 raw 请求体说明 renderer 走了结构化调用。接受它等于让一次编码差异把几百 MiB
        // 序列化成 base64 字符串——而那正是 `DESK-064` 记在案的既有债务形态。
        tauri::ipc::InvokeBody::Json(_) => return Err(crate::export::ExportError::Failure),
    };
    export.append(export_id, bytes)
}

/// 从 `x-export-id` header 取会话 id。
///
/// 缺失或形状不对一律失败：不猜、不回退到"当前会话"。回退会让一个迟到的旧块写进新会话的文件，
/// 而结果是两份归档被拼成一份——它仍能打开，只是不再是用户点的那一份。
fn export_id_header(request: &tauri::ipc::Request) -> Result<u64, crate::export::ExportError> {
    const HEADER: &str = "x-export-id";
    let value = request
        .headers()
        .get(HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or(crate::export::ExportError::StaleSession)?;
    value
        .parse::<u64>()
        .map_err(|_| crate::export::ExportError::StaleSession)
}

/// 所有维护等待与文件 I/O 都留在 blocking worker，包括取得维护窗口。
#[tauri::command]
async fn create_local_backup(
    app: tauri::AppHandle,
) -> Result<backup::BackupSummary, backup::BackupError> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::create_backup(&app.state::<LocalLibrary>())
    })
    .await
    .map_err(|_| backup::BackupError::Failed)?
}

#[tauri::command]
async fn list_local_backups(
    app: tauri::AppHandle,
) -> Result<backup::BackupList, backup::BackupError> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::list_backups(app.state::<LocalLibrary>().data_root())
    })
    .await
    .map_err(|_| backup::BackupError::Failed)?
}

/// 持有恢复准备取得的维护许可，直至退出；renderer 刷新不会重新开放写入。
#[derive(Default)]
struct PendingRestore(std::sync::Mutex<Option<maintenance::MaintenancePermit>>);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareLocalRestoreRequest {
    backup_id: String,
}

#[tauri::command]
async fn prepare_local_restore(
    app: tauri::AppHandle,
    request: PrepareLocalRestoreRequest,
) -> Result<restore::PrepareRestoreResponse, restore::RestoreError> {
    tauri::async_runtime::spawn_blocking(move || {
        let pending = app.state::<PendingRestore>();
        let mut slot = pending
            .0
            .try_lock()
            .map_err(|_| restore::RestoreError::MaintenanceBusy)?;
        if slot.is_some() {
            return Err(restore::RestoreError::Pending);
        }
        let prepared = restore::prepare_restore(&app.state::<LocalLibrary>(), &request.backup_id)?;
        let response = prepared.response;
        *slot = Some(prepared.permit);
        Ok(response)
    })
    .await
    .map_err(|_| restore::RestoreError::Failed)?
}

/* ── 项目服务云通路（D5.0c） ─────────────────────────────────────────────
 *
 * renderer 只得到非秘密的账号摘要与状态枚举；会话 cookie 永不进 IPC。
 * 所有命令都通过 `cloud.rs` 的固定 origin/固定路由实现，不存在任意 URL 请求能力。
 */

/// 开始 `desktop-auth-v1` 登录：打开系统浏览器授权页并返回 flowId。
#[tauri::command]
async fn cloud_login_begin(
    cloud: State<'_, cloud::CloudState>,
) -> Result<cloud::CloudLoginBeginResponse, cloud::CloudError> {
    cloud::cloud_login_begin(&cloud).await
}

/// 等待一次登录流程的回跳+交换完成。同一 flowId 只能 await 一次。
#[tauri::command]
async fn cloud_login_await(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
    flow_id: String,
) -> Result<cloud::CloudLoginOutcome, cloud::CloudError> {
    cloud::cloud_login_await(&cloud, &flow_id, secrets.inner().as_ref()).await
}

/// 取消一个进行中的登录流程。
#[tauri::command]
fn cloud_login_cancel(cloud: State<'_, cloud::CloudState>, flow_id: String) -> bool {
    cloud::cloud_login_cancel(&cloud, &flow_id)
}

/// 本机凭据存储的账号摘要（未经服务端确认）：cached-first 启动身份。
/// 零网络——`None` 即本机没有已保存账号。
#[tauri::command]
fn cloud_cached_account(
    secrets: State<'_, SharedSecretStore>,
) -> Result<Option<cloud::CloudCachedAccount>, cloud::CloudError> {
    cloud::cloud_cached_account(secrets.inner().as_ref())
}

/// 当前会话账号的资料投影（`/api/me/profile` 固定路由）：顶栏头像与资料
/// 刷新共用。native 注入会话 cookie，renderer 拿不到 URL 或凭据。
#[tauri::command]
async fn cloud_me_profile(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
) -> Result<cloud::CloudMeProfile, cloud::CloudError> {
    cloud::cloud_me_profile(&cloud, secrets.inner().as_ref()).await
}

/// 查询账号会话状态：signed-out / active / expired / unreachable。
/// `expired` 表示服务端明确拒绝会话（本地凭据随之清除）；`unreachable` 只是
/// 服务暂时联系不上，凭据保留。
#[tauri::command]
async fn cloud_auth_status(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
) -> Result<cloud::CloudSessionStatus, cloud::CloudError> {
    cloud::cloud_auth_status(&cloud, secrets.inner().as_ref()).await
}

/// 登出：本地凭据无条件删除；`revoked` 反映服务端会话是否同步作废。
#[tauri::command]
async fn cloud_sign_out(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
) -> Result<cloud::CloudSignOutResult, cloud::CloudError> {
    cloud::cloud_sign_out(&cloud, secrets.inner().as_ref()).await
}

/// 主动使用在线能力时的最小探测：服务可达性 + hosted 契约版本兼容。
/// 不携带任何 Provider Key；仅账号 cookie（若已登录）。
#[tauri::command]
async fn cloud_online_status(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
) -> Result<cloud::CloudOnlineStatus, cloud::CloudError> {
    cloud::cloud_online_status(&cloud, secrets.inner().as_ref()).await
}

/// hosted 生成流：固定 origin + 路由白名单的项目生成通路，当前只开放系统默认
/// 通道。服务器 BYOK 在 native 持有并校验的 Provider 绑定落地前保持关闭
/// （DESK-093）——renderer 传 `routeId/body/requestId`，任何凭据字段
/// （byok/secretRef/providerId/modelId）由 `deny_unknown_fields` 拒绝；
/// native 同时拒绝 body 中预置的 `customProvider`。
/// 事件按 hosted SSE 契约（`HostedGenerationEvent`）经 Channel 原样转发。
#[tauri::command]
async fn stream_hosted_ai(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
    registry: State<'_, ai::RequestRegistry>,
    request: cloud::CloudHostedGenerateRequest,
    on_event: tauri::ipc::Channel<cloud::HostedSseEvent>,
) -> Result<(), cloud::CloudError> {
    cloud::stream_hosted_ai(
        &cloud,
        secrets.inner().as_ref(),
        &registry,
        request,
        &on_event,
    )
    .await
}

/// hosted 非流式 JSON 生成：与 `stream_hosted_ai` 同一套窄边界的请求/响应形态
/// （D5.1a，`/details` 双执行的服务器非流式通路）。native 返回「HTTP 状态 +
/// JSON 正文」透传；`{data, aiMeta}` 解包与错误诊断在 renderer 适配层完成。
/// 取消复用 `cancel_hosted_ai`（同一 RequestRegistry）。
#[tauri::command]
async fn hosted_ai_request(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
    registry: State<'_, ai::RequestRegistry>,
    request: cloud::CloudHostedGenerateRequest,
) -> Result<cloud::CloudHostedJsonResponse, cloud::CloudError> {
    cloud::hosted_ai_request(&cloud, secrets.inner().as_ref(), &registry, request).await
}

/// 取消一次在途 hosted 生成。
#[tauri::command]
fn cancel_hosted_ai(registry: State<'_, ai::RequestRegistry>, request_id: String) -> bool {
    registry.cancel(&request_id)
}

/// 数据卡库云端请求：固定路由表驱动的窄通道（D5.0e，`DESK-ONLINE-010`）。
/// renderer 只能给 `routeId` + `query` + `body`；method/path/cookie 由 native
/// 路由表注入，`deny_unknown_fields` 拒绝凭据与 URL 字段。无会话访问
/// Required 路由直接 `not-authenticated`，不产生网络请求。
///
/// `cache` 是 K1 公开持久缓存：只有 `public-data-cards.query` 的响应会被
/// 观察（白名单投影 + 并发守卫）；缓存失败只体现为响应上的
/// `cache.outcome`，不改变在线业务语义。
#[tauri::command]
async fn cloud_card_library_request(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
    cache: State<'_, public_cache::PublicReadCache>,
    request: cloud::CloudRouteRequest,
) -> Result<cloud::CloudRouteResponse, cloud::CloudError> {
    cloud::cloud_card_library_request(&cloud, secrets.inner().as_ref(), &cache, request).await
}

/// 消息中心云端请求：与卡库同一套固定路由窄边界（D5.1d-1）。`summary`/
/// `read`/`read-all` 是 Required 路由——无本地凭据不产生请求；`list`
/// 匿名可读全站消息。业务响应经 renderer 适配层按消息 DTO schema 校验。
#[tauri::command]
async fn cloud_messages_request(
    cloud: State<'_, cloud::CloudState>,
    secrets: State<'_, SharedSecretStore>,
    request: cloud::CloudRouteRequest,
) -> Result<cloud::CloudRouteResponse, cloud::CloudError> {
    cloud::cloud_messages_request(&cloud, secrets.inner().as_ref(), request).await
}

/// 受控外链打开（DESK-PARITY-003 / DESK-ONLINE-014）。只接受 http/https、
/// 不带凭据的合法 URL；scheme 之外的任何「链接形态」都不是这个命令能表达的。
#[tauri::command]
fn open_external_url(url: String) -> Result<(), external_link::ExternalLinkError> {
    let validated = external_link::validate_external_url(&url)?;
    external_link::open_validated_url(&validated)
}

/// 公告快照：上次成功刷新的落盘结果；没有或损坏返回 `None`，
/// renderer 据此回退内置快照。
#[tauri::command]
fn announcements_get_cached(app: tauri::AppHandle) -> Option<announcements::AnnouncementsSnapshot> {
    announcements::get_cached(&app)
}

/// 公告受控刷新：固定 origin + 条件请求；成功才原子替换本地快照。
#[tauri::command]
async fn announcements_refresh(
    app: tauri::AppHandle,
    state: State<'_, announcements::AnnouncementsState>,
) -> Result<announcements::AnnouncementsRefreshResult, announcements::AnnouncementsError> {
    announcements::refresh(&app, &state).await
}

/// 人工配置读（DESK-SET-004/005）：固定 `config.json` 的有界读取 +
/// 内容级 revision；字段域语义由 renderer 的 contracts/desktop-config 判定。
///
/// `async fn` + `spawn_blocking`：读含整文件流式 SHA-256（含超大文件的
/// 扫描），同步 command 会把这段时间算在主线程上。
#[tauri::command]
async fn desktop_config_read(
    app: tauri::AppHandle,
) -> Result<config::ConfigReadResult, config::ConfigError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(config::ConfigError::storage_dir_resolution_failure)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<config::ConfigState>();
        config::read_config(&dir, &state)
    })
    .await
    .map_err(|_| {
        config::ConfigError::new(config::ConfigErrorCode::InternalError, "配置读取任务失败")
    })?
}

/// 人工配置写：携带读取时的内容 revision，native 串行复核后原子替换；
/// 外部改动返回 `config-conflict`，不静默覆盖（DESK-SET-005）。
/// `async fn` + `spawn_blocking`：写含 sync/rename 等磁盘操作，移出主线程。
#[tauri::command]
async fn desktop_config_write(
    app: tauri::AppHandle,
    request: config::ConfigWriteRequest,
) -> Result<config::ConfigWriteResult, config::ConfigError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(config::ConfigError::storage_dir_resolution_failure)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<config::ConfigState>();
        config::write_config(&dir, &state, request)
    })
    .await
    .map_err(|_| {
        config::ConfigError::new(config::ConfigErrorCode::InternalError, "配置写入任务失败")
    })?
}

/* ── D5.1-K1/K2 公开资料持久只读缓存 ─────────────────────────────────────
 *
 * `public-read-cache.sqlite` 是与正式本地库物理隔离的派生缓存：renderer
 * 能推送策略、查统计、清库，并经 `public_read_cache_query` /
 * `public_read_cache_card` 读取抓取时的受控投影（K2 开放）。scope 一律
 * 由 native 从当前云 origin 推导，renderer 不提供；读取不接收任意
 * SQL/路径/排序表达式。所有命令一律 `spawn_blocking`：缓存 I/O 不得落
 * 在 WebView 主线程上。
 */

/// 推送公开缓存策略。renderer 已把 config.json 的归一结果折叠成
/// `{captureEnabled, maxBytes, whenFull}`——native 不再做域判定，只做
/// `deny_unknown_fields` + 预算合法性复核。
#[tauri::command]
async fn public_read_cache_apply_policy(
    app: tauri::AppHandle,
    policy: public_cache::PublicCachePolicyDto,
) -> Result<(), public_cache::PublicCacheError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<public_cache::PublicReadCache>()
            .apply_policy(policy)
    })
    .await
    .map_err(|_| public_cache::PublicCacheError::internal("缓存策略应用任务失败"))?
}

/// 公开缓存统计：用量、条目计数与真实状态（empty/ready/unavailable/
/// unsupported-schema）。如实报告——缓存损坏只表现为状态，不伪装为空库。
#[tauri::command]
async fn public_read_cache_stats(
    app: tauri::AppHandle,
) -> Result<public_cache::PublicCacheStats, public_cache::PublicCacheError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<public_cache::PublicReadCache>().stats()
    })
    .await
    .map_err(|_| public_cache::PublicCacheError::internal("缓存统计任务失败"))?
}

/// 清空公开缓存。推进 `write_epoch`：在途响应一律按 stale 丢弃，不会在
/// 清理后回填。幂等——空库返回 `{removedEntries: 0, freedBytes: 0}`。
#[tauri::command]
async fn public_read_cache_clear(
    app: tauri::AppHandle,
) -> Result<public_cache::PublicCacheClearResult, public_cache::PublicCacheError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<public_cache::PublicReadCache>().clear()
    })
    .await
    .map_err(|_| public_cache::PublicCacheError::internal("缓存清理任务失败"))?
}

/// 在本机已捕获集合上做离线搜索/筛选/排序/分页（`DESK-CACHE-004`）。
/// 参数面与公开 summary 查询对齐但作用域是本机缓存：`total`/`bodyCount`
/// 是匹配缓存数，不是线上范围。非 ready 的缓存状态如实回显。
#[tauri::command]
async fn public_read_cache_query(
    app: tauri::AppHandle,
    request: public_cache::PublicCacheQueryDto,
) -> Result<public_cache::PublicCacheQueryResult, public_cache::PublicCacheError> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.state::<cloud::CloudState>().origin().to_string();
        app.state::<public_cache::PublicReadCache>()
            .query(&scope, &request)
    })
    .await
    .map_err(|_| public_cache::PublicCacheError::internal("缓存查询任务失败"))?
}

/// 按 card_id 取缓存完整正文。只有 `availability='full'` 时 `entry.card`
/// 才携带抓取时的公开完整投影；`summary-only`/`absent`/`withdrawn` 都
/// 如实回显而不是伪装成「卡不存在」。
#[tauri::command]
async fn public_read_cache_card(
    app: tauri::AppHandle,
    request: public_cache::PublicCacheCardRequestDto,
) -> Result<public_cache::PublicCacheCardResult, public_cache::PublicCacheError> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.state::<cloud::CloudState>().origin().to_string();
        app.state::<public_cache::PublicReadCache>()
            .card(&scope, &request)
    })
    .await
    .map_err(|_| public_cache::PublicCacheError::internal("缓存单卡读取任务失败"))?
}

/// 打开固定的配置目录（设置页「显示路径」的配套入口）；不开放任意路径。
#[tauri::command]
async fn desktop_config_open_directory(app: tauri::AppHandle) -> Result<(), config::ConfigError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(config::ConfigError::storage_dir_resolution_failure)?;
    tauri::async_runtime::spawn_blocking(move || config::open_directory(&dir))
        .await
        .map_err(|_| {
            config::ConfigError::new(
                config::ConfigErrorCode::InternalError,
                "打开配置目录任务失败",
            )
        })?
}

/// 仅在 native 已写恢复 intent 后允许退出，不向 renderer 开放通用进程控制。
#[tauri::command]
fn exit_after_local_restore(app: tauri::AppHandle) -> Result<(), restore::RestoreError> {
    let pending = app.state::<PendingRestore>();
    let slot = pending
        .0
        .try_lock()
        .map_err(|_| restore::RestoreError::MaintenanceBusy)?;
    if slot.is_none() {
        return Err(restore::RestoreError::InvalidIntent);
    }
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 启动时间观测（D5.2）：`MAHOSHOJO_BOOT_TIMING=1` 时把 setup 各阶段打到
    // stderr（`mahoshojo-boot <阶段> +<ms>`），与 renderer 侧
    // `performance.mark`（src/platform/boot-timing.ts）拼出完整启动时间线。
    // 纯观测——不设 env 时零成本，绝不改变任何初始化顺序或语义。
    let boot_clock = std::time::Instant::now();
    let boot_timing = std::env::var_os("MAHOSHOJO_BOOT_TIMING").is_some();
    let boot_mark = move |label: &str| {
        if boot_timing {
            eprintln!(
                "mahoshojo-boot {label} +{}ms",
                boot_clock.elapsed().as_millis()
            );
        }
    };
    boot_mark("process-start");

    tauri::Builder::default()
        .manage(default_secret_store())
        .manage(ai::RequestRegistry::default())
        .manage(config::ConfigState::default())
        .manage(PendingRestore::default())
        .manage(webpkg_instance::WebPackageInstances::default())
        // D4b / DESK-013：受限 Web Package 的只读资源空间。resolver 按"请求方
        // webview label ↔ URL 中 instance id"双向钉定，本协议因此对 main-ui 与
        // 任何非 webpkg-* label 一律 404——capability 从未授予任何非 main-ui
        // webview，协议层再把请求方钉死是第二道，不是重复。
        //
        // 刻意用同步 responder：字节都在内存里，没有可挪到异步路径的 I/O；
        // `register_asynchronous_uri_scheme_protocol` 只会把"一次 HashMap 查找 +
        // 一段切片 clone"变成一次无谓的线程往返。
        .register_uri_scheme_protocol(webpkg_instance::URI_SCHEME, |context, request| {
            webpkg_instance::resolve_webpkg_request(
                context
                    .app_handle()
                    .state::<webpkg_instance::WebPackageInstances>()
                    .inner(),
                context.webview_label(),
                &request,
            )
        })
        .setup(move |app| {
            boot_mark("setup-begin");
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
            boot_mark("instance-lock-acquired");

            restore::recover_pending(&data_root).map_err(|error| {
                format!(
                    "本地库恢复未完成（{}）：{}。已保留旧库与恢复日志；请勿删除恢复目录或强行创建空库。",
                    error.code(), error.message()
                )
            })?;
            boot_mark("recovery-done");
            let library = LocalLibrary::open(&data_root)
                .map_err(|error| format!("cannot open the local store: {}", error.message()))?;
            boot_mark("local-library-opened");

            let archive_export =
                export::ArchiveExport::open(export::ExportPaths::under(&data_root)).map_err(
                    |error| {
                        format!("cannot prepare the export directory: {error}")
                    },
                )?;
            boot_mark("archive-export-opened");
            // 清理上一次进程留下的未完成 temp。顺序在 `InstanceGuard` 之后，与"先抢锁再动磁盘"
            // 一致。
            //
            // 刻意放在 manage **之前**（它会动磁盘），但**不再让清理失败拖垮启动**：一个删不掉的
            // `.partial` 按设计是惰性的——它不会被当作有效导出，下次启动还会再试。把它变成
            // "应用打不开"是纯粹的损失。`reclaim_stale_temporaries` 本身也只把"读不到目录"
            // 当失败。
            archive_export.reclaim_stale_temporaries().map_err(|error| {
                format!("cannot clean up interrupted exports: {error}")
            })?;
            let stuck = archive_export.stale_temporaries_left();
            if stuck > 0 {
                // 不吞掉：磁盘满或权限不足的证据只有这一条，诊断价值远高于一行噪声。
                eprintln!("mahoshojo: {stuck} 个未完成的导出临时文件删不掉（磁盘或权限？）");
            }

            // 云通路 state 在 setup 里注册而不是 Builder 顶层：CloudState 的初始化
            // 失败（HTTP client 构建）应让启动明确失败，而不是静默降级——DESK-090 要求
            // 云通路是一个确定的边界。
            app.manage(
                cloud::CloudState::new()
                    .map_err(|error| format!("cannot initialize the cloud client: {}", error.message))?,
            );
            app.manage(
                announcements::AnnouncementsState::new()
                    .map_err(|error| format!("cannot initialize the announcements client: {}", error.message))?,
            );

            // D5.1-K1：公开持久缓存与正式本地库共用同一数据目录，但独立
            // SQLite 文件、独立连接、独立 schema 版本——损坏/未知版本只让
            // 缓存停用，绝不拖垮启动。惰性打开：首个公开读取才建文件。
            app.manage(public_cache::PublicReadCache::at(&data_root));

            app.manage(instance);
            app.manage(library);
            app.manage(archive_export);
            boot_mark("setup-done");
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
            begin_web_package_instance,
            append_web_package_resource,
            open_web_package_instance,
            begin_local_archive_export,
            append_local_archive_export_chunk,
            audit_local_library,
            create_local_backup,
            list_local_backups,
            prepare_local_restore,
            exit_after_local_restore,
            collect_local_garbage,
            cloud_login_begin,
            cloud_login_await,
            cloud_login_cancel,
            cloud_cached_account,
            cloud_me_profile,
            cloud_auth_status,
            cloud_sign_out,
            cloud_online_status,
            stream_hosted_ai,
            hosted_ai_request,
            cloud_card_library_request,
            cloud_messages_request,
            cancel_hosted_ai,
            open_external_url,
            announcements_get_cached,
            announcements_refresh,
            desktop_config_read,
            desktop_config_write,
            desktop_config_open_directory,
            public_read_cache_apply_policy,
            public_read_cache_stats,
            public_read_cache_clear,
            public_read_cache_query,
            public_read_cache_card
        ])
        .run(tauri::generate_context!())
        .expect("error while running MahoShojo Generator desktop app");
}

#[cfg(test)]
mod tests {
    use super::{
        base64_bytes, DesktopRuntimeInfo, ListLocalCardsResponse, ListWebPackagesResponse,
        SaveWebPackageRequest,
    };

    #[test]
    fn restore_request_matches_fixture_and_rejects_arbitrary_paths() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../fixtures/desktop-restore.json"))
                .expect("shared restore fixture");
        let request: super::PrepareLocalRestoreRequest =
            serde_json::from_value(fixture["request"].clone()).expect("native request");
        assert_eq!(
            request.backup_id,
            fixture["request"]["backupId"].as_str().unwrap()
        );
        let mut invalid = fixture["request"].clone();
        invalid["path"] = serde_json::json!("C:/arbitrary");
        assert!(serde_json::from_value::<super::PrepareLocalRestoreRequest>(invalid).is_err());
    }

    #[test]
    fn empty_local_card_page_omits_optional_cursor() {
        let response = ListLocalCardsResponse {
            documents: Vec::new(),
            next_cursor: None,
        };

        assert_eq!(
            serde_json::to_value(response).expect("response serializes"),
            serde_json::json!({"documents": []})
        );
    }

    #[test]
    fn empty_web_package_page_omits_optional_cursor() {
        let response = ListWebPackagesResponse {
            documents: Vec::new(),
            next_cursor: None,
        };

        assert_eq!(
            serde_json::to_value(response).expect("response serializes"),
            serde_json::json!({"documents": []})
        );
    }

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

    /// 信封的线上形状 MUST 由**生产类型**钉住，而不是由一个测试本地定义的假 struct 钉住。
    ///
    /// 原先这条测试本地定义了一个 `Response` 结构并断言它序列化成 `{b64, len}`——它证明的只是
    /// serde 的 `with` 属性能用，与生产路径无关。读取方向改成 raw 响应之后，本地那个 struct 更
    /// 是彻底没有任何生产对应物，于是这条断言只会让人误以为响应仍是信封。
    ///
    /// 现在直接反序列化 `SaveWebPackageRequest`：字段名、camelCase 与长度核对全部由生产类型承担。
    #[test]
    fn the_request_side_envelope_is_pinned_by_the_production_type() {
        let request: SaveWebPackageRequest = serde_json::from_value(serde_json::json!({
            "document": "{}",
            "index": {
                "id": "wp_0123456789abcdef0123456789abcdef",
                "updatedAt": "2026-09-30T12:00:00.000Z",
                "contentDigest": format!("sha256:{}", "0".repeat(64)),
            },
            "archive": { "b64": "UEsDBA==", "len": 4 },
            "now": "2026-09-30T12:00:00.000Z",
        }))
        .expect("envelope shape must deserialize into the production request type");
        assert_eq!(request.archive, b"PK\x03\x04");
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
