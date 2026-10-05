// 发布构建在 Windows 下不弹出控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mahoshojo_desktop_lib::run();
}
