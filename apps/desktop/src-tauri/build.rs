fn main() {
    // D0 只生成 schema 与平台资源；自有 command 的 ACL 收窄在出现第二个 webview
    // 之前不启用（见 SPEC-desktop-client-v1 DESK-012），避免在只有单一受信 webview
    // 时引入无法在无头环境验证的运行期失败。
    tauri_build::try_build(tauri_build::Attributes::new())
        .expect("failed to run tauri build script");
}
