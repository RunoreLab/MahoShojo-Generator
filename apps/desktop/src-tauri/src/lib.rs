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

mod secret;

use secret::{default_secret_store, SharedSecretStore};
use serde::Serialize;
use tauri::State;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store: SharedSecretStore = default_secret_store();

    tauri::Builder::default()
        .manage(store)
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_info,
            set_provider_secret,
            has_provider_secret,
            delete_provider_secret
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
