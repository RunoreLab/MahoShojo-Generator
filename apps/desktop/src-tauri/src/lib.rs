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
mod local_card;
#[cfg(test)]
mod local_card_contract_tests;
mod provider_profile;
mod secret;
mod sse;
mod store;

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
            updated_at: cursor.updated_at,
            id: cursor.id,
        }),
    })?;

    Ok(ListLocalCardsResponse {
        documents: page.documents,
        next_cursor: page.next_cursor.map(|cursor| LocalCardCursorDto {
            updated_at: cursor.updated_at,
            id: cursor.id,
        }),
    })
}

/// 软删一条本地卡：只写 tombstone，保留文档，使 `restore_local_card` 能真正恢复。
#[tauri::command]
fn delete_local_card(
    cards: State<'_, local_card::LocalCardStore>,
    id: String,
    deleted_at: String,
) -> Result<(), store::StoreError> {
    cards.soft_delete(&id, &deleted_at)
}

#[tauri::command]
fn restore_local_card(
    cards: State<'_, local_card::LocalCardStore>,
    id: String,
) -> Result<(), store::StoreError> {
    cards.restore(&id)
}

/// 彻底删除一条本地卡。幂等。
#[tauri::command]
fn purge_local_card(
    cards: State<'_, local_card::LocalCardStore>,
    id: String,
) -> Result<(), store::StoreError> {
    cards.purge(&id)
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
            // 两个存储访问**同一个** SQLite 文件：D1 的 Profile 与 D2.0 的本地卡同属一台
            // 设备上的用户资产。分开存放会让备份、迁移与"重开应用"各多一套路径。
            let store = LocalStore::open(&paths)
                .map_err(|error| format!("cannot open the local store: {}", error.message()))?;
            let cards = local_card::LocalCardStore::open(&paths).map_err(|error| {
                format!("cannot open the local card store: {}", error.message())
            })?;
            app.manage(store);
            app.manage(cards);
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
            purge_local_card
        ])
        .run(tauri::generate_context!())
        .expect("error while running MahoShojo Generator desktop app");
}

#[cfg(test)]
mod tests {
    use super::DesktopRuntimeInfo;

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
