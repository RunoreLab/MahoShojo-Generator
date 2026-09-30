//! MahoShojo Generator 本地桌面客户端的 Rust 侧入口。
//!
//! D0 阶段的 Rust 侧只做一件事：报告本地运行时自述。
//!
//! 这里**刻意没有任何**出站 HTTP、数据库、文件写入或秘密存取能力。Direct AI transport、
//! SQLite 本地库与 OS 凭据存储分别在 D1、D2、D0.5 引入，并且都必须先经过对应门禁
//! （见 `PLAN-desktop-client-v1`）。

use serde::Serialize;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_runtime_info])
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
