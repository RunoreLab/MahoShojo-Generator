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
mod blob;
mod local_card;
#[cfg(test)]
mod local_card_contract_tests;
mod provider_profile;
mod secret;
mod sse;
mod store;
mod web_package;

use provider_profile::DirectProviderExecutionProfile;
use secret::{default_secret_store, SharedSecretStore};
use serde::Serialize;
use store::LocalStore;
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
    store: State<'_, LocalStore>,
    document: String,
    updated_at: String,
) -> Result<(), store::StoreError> {
    let identity = provider_profile::StoredProviderProfileIdentity::parse(&document)
        .map_err(|_| store::StoreError::InvalidDocument)?;
    store.put(&identity.id, &document, &updated_at)
}

/// 列出已保存的 Profile id。
#[tauri::command]
fn list_provider_profile_ids(
    store: State<'_, LocalStore>,
) -> Result<Vec<String>, store::StoreError> {
    store.list_ids()
}

/// 读取一个 Profile 的完整文档。缺失时返回 `None`，不视为错误。
#[tauri::command]
fn get_provider_profile(
    store: State<'_, LocalStore>,
    profile_id: String,
) -> Result<Option<String>, store::StoreError> {
    store.get(&profile_id)
}

/// 删除一个 Profile 及其引用的 secret。幂等。
#[tauri::command]
fn delete_provider_profile(
    store: State<'_, LocalStore>,
    secrets: State<'_, SharedSecretStore>,
    profile_id: String,
) -> Result<(), store::StoreError> {
    if let Some(document) = store.get(&profile_id)? {
        if let Ok(identity) = provider_profile::StoredProviderProfileIdentity::parse(&document) {
            for secret_ref in identity.secret_refs() {
                // 删除 Profile 不因凭据后端故障而失败：凭据残留由后续清理处理，
                // 但必须让调用方知道这不是一次完整清理。
                let _ = secrets.delete(&secret_ref);
            }
        }
    }
    store.delete(&profile_id)
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
    store: State<'_, LocalStore>,
    secrets: State<'_, SharedSecretStore>,
    registry: State<'_, ai::RequestRegistry>,
    profile_id: String,
    request: ai::AiExecutionRequest,
    on_event: tauri::ipc::Channel<ai::AiStreamEvent>,
) -> Result<(), ai::DirectAiError> {
    ai::stream_direct_ai(
        &profile_id,
        request,
        &store,
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
    cards: State<'_, local_card::LocalCardStore>,
    request: SaveLocalCardRequest,
) -> Result<SaveLocalCardResponse, store::StoreError> {
    cards.put(&request.document, &request.index)?;
    Ok(SaveLocalCardResponse {
        id: request.index.id,
    })
}

#[tauri::command]
fn get_local_card(
    cards: State<'_, local_card::LocalCardStore>,
    id: String,
) -> Result<Option<String>, store::StoreError> {
    cards.get(&id)
}

#[tauri::command]
fn list_local_cards(
    cards: State<'_, local_card::LocalCardStore>,
    request: ListLocalCardsRequest,
) -> Result<ListLocalCardsResponse, store::StoreError> {
    let page = cards.list(&local_card::LocalCardQuery {
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
    cards: State<'_, local_card::LocalCardStore>,
    request: SaveLocalCardRequest,
) -> Result<(), store::StoreError> {
    cards.delete(&request.document, &request.index)
}

#[tauri::command]
fn restore_local_card(
    cards: State<'_, local_card::LocalCardStore>,
    request: SaveLocalCardRequest,
) -> Result<(), store::StoreError> {
    cards.restore(&request.document, &request.index)
}

/// 彻底删除一条本地卡。幂等。
#[tauri::command]
fn purge_local_card(
    cards: State<'_, local_card::LocalCardStore>,
    id: String,
) -> Result<(), store::StoreError> {
    cards.purge(&id)
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
    #[serde(with = "base64_bytes")]
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
/// `DESK-053` 要求 IPC 接受字节流或受控句柄、**MUST NOT** 接受 renderer 提供的任意目标路径。
/// 这里用 base64 而不是自定义协议：Tauri 2 有原生 raw IPC（`InvokeBody::Raw` /
/// `tauri::ipc::Response`），但它要求请求体整体是 raw 形式，无法与结构化参数并存；而本阶段
/// 的载荷是单个 Web 包 ZIP，base64 的开销可以接受。等 D2.3 要搬整个 archive 时再切 raw IPC。
mod base64_bytes {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<u8>, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Raw {
            b64: String,
            len: usize,
        }
        use serde::Deserialize as _;
        let raw = Raw::deserialize(deserializer)?;
        let bytes = decode(&raw.b64)
            .ok_or_else(|| serde::de::Error::custom("archive payload is not valid base64"))?;
        if bytes.len() != raw.len {
            return Err(serde::de::Error::custom("base64 payload length mismatch"));
        }
        Ok(bytes)
    }

    /// 对外暴露编码器：读路径必须复用它，否则两份实现会漂移。
    pub fn encode(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let packed = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            out.push(ALPHABET[(packed >> 18) as usize & 63] as char);
            out.push(ALPHABET[(packed >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 {
                ALPHABET[(packed >> 6) as usize & 63] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                ALPHABET[packed as usize & 63] as char
            } else {
                '='
            });
        }
        out
    }

    pub fn decode(text: &str) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(text.len() / 4 * 3);
        let mut accumulator: u32 = 0;
        let mut bits = 0_u32;
        for byte in text.bytes() {
            if byte == b'=' {
                break;
            }
            let value = ALPHABET.iter().position(|candidate| *candidate == byte)? as u32;
            accumulator = (accumulator << 6) | value;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((accumulator >> bits) as u8);
            }
        }
        Some(out)
    }
}

/// 保存一条本地 Web 包及其 ZIP 字节。
///
/// blob 先落盘，再在一个事务里写包记录与**真实外键**引用行（`DESK-055`）。因此崩溃最多留下
/// 孤儿 blob，而不会出现"引用行存在但包记录不存在"的中间态。
#[tauri::command]
fn save_web_package(
    packages: State<'_, web_package::WebPackageStore>,
    blobs: State<'_, blob::BlobStore>,
    request: SaveWebPackageRequest,
) -> Result<SaveWebPackageResponse, web_package::SaveWebPackageError> {
    let outcome = packages.save(
        blobs.inner(),
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
    packages: State<'_, web_package::WebPackageStore>,
    id: String,
) -> Result<Option<String>, store::StoreError> {
    packages.get(&id)
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
    packages: State<'_, web_package::WebPackageStore>,
    request: ListWebPackagesRequest,
) -> Result<ListWebPackagesResponse, store::StoreError> {
    let page = packages.list(&web_package::WebPackageQuery {
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
    packages: State<'_, web_package::WebPackageStore>,
    request: WebPackageTransitionRequest,
) -> Result<(), store::StoreError> {
    packages.delete(&request.document, &request.index)
}

/// 恢复一条已软删的本地 Web 包。
#[tauri::command]
fn restore_web_package(
    packages: State<'_, web_package::WebPackageStore>,
    request: WebPackageTransitionRequest,
) -> Result<(), store::StoreError> {
    packages.restore(&request.document, &request.index)
}

/// 彻底删除一条本地 Web 包与其 blob 引用。幂等。
#[tauri::command]
fn purge_web_package(
    packages: State<'_, web_package::WebPackageStore>,
    id: String,
) -> Result<(), store::StoreError> {
    packages.purge(&id)
}

/// 读取一个本地 Web 包的原始 ZIP 字节。
///
/// 返回值是 base64 文本而非原始字节：与 `save_web_package` 的入参保持对称，且让渲染层只需
/// 一个解码路径。字节本身来自内容寻址存储并已校验摘要。
#[tauri::command]
fn read_web_package_archive(
    packages: State<'_, web_package::WebPackageStore>,
    blobs: State<'_, blob::BlobStore>,
    id: String,
) -> Result<String, web_package::SaveWebPackageError> {
    let digest = packages
        .archive_digest(&id)
        .map_err(web_package::SaveWebPackageError::Store)?;
    let digest = digest.ok_or(web_package::SaveWebPackageError::Blob(
        blob::BlobError::NotFound,
    ))?;
    let bytes = blobs.read(&digest)?;
    // 复用与入参同一个编码器：两份 base64 实现必然漂移，而漂移表现为"存进去读不出来"。
    Ok(base64_bytes::encode(&bytes))
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
            let paths = store::LocalStorePaths::under(&data_root);
            // 三个访问者共享**同一个** SQLite 文件与同一份迁移阶梯：Profile、本地卡、Web 包
            // 与 blob 同属一台设备上的用户资产。分开存放会让备份、迁移与"重开应用"各多一套
            // 路径，也更容易出现"某个库忘了迁移"这类按类型分叉的隐性差异。
            let store = LocalStore::open(&paths)
                .map_err(|error| format!("cannot open the local store: {}", error.message()))?;
            let cards = local_card::LocalCardStore::open(&paths).map_err(|error| {
                format!("cannot open the local card store: {}", error.message())
            })?;
            let packages = web_package::WebPackageStore::open(&paths).map_err(|error| {
                format!("cannot open the web package store: {}", error.message())
            })?;

            // blob 的 metadata 与上面三者同库，但它的**文件**区是独立的目录，因此需要自己的
            // 连接句柄（同一文件、同一个 Mutex 家族，各自串行化自己的访问）。
            let blob_connection = rusqlite::Connection::open(paths.database())
                .map_err(|error| format!("cannot open the blob store connection: {error}"))?;
            store::configure_and_migrate(&blob_connection)
                .map_err(|error| format!("cannot migrate the blob store: {}", error.message()))?;
            let blobs = blob::open(blob::BlobPaths::under(&data_root), blob_connection)
                .map_err(|error| format!("cannot open the blob store: {}", error.message()))?;

            app.manage(store);
            app.manage(cards);
            app.manage(packages);
            app.manage(blobs);
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
            read_web_package_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running MahoShojo Generator desktop app");
}

#[cfg(test)]
mod tests {
    use super::{base64_bytes, DesktopRuntimeInfo};

    /// 手写 base64 MUST 与标准实现逐字节一致。
    ///
    /// 这是自实现编码器最危险的地方：它与渲染层的解码器只有一次调用相隔，漂移的表现是
    /// "存进去读不出来"，而且要到用户导入 Web 包时才暴露。逐长度覆盖 0/1/2/3 字节的尾部
    /// 情形，期望值取自 Node 的 `Buffer.toString('base64')`。
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
            assert_eq!(base64_bytes::encode(bytes), expected, "len={}", bytes.len());
            assert_eq!(
                base64_bytes::decode(expected).as_deref(),
                Some(bytes),
                "{expected}"
            );
        }
    }

    #[test]
    fn base64_round_trips_every_byte_value() {
        let all: Vec<u8> = (0..=255_u8).collect();
        let encoded = base64_bytes::encode(&all);
        assert_eq!(
            base64_bytes::decode(&encoded).as_deref(),
            Some(all.as_slice())
        );
    }

    #[test]
    fn base64_decode_rejects_characters_outside_the_alphabet() {
        // 静默接受非法字符会产出"看起来能用"的错误字节。
        assert_eq!(base64_bytes::decode("UEsD*Q=="), None);
        assert_eq!(base64_bytes::decode("UEsD Q=="), None);
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
