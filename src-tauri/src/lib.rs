//! StickerBox 库入口：桌面的 `main.rs` 和安卓的 `mobile_entry_point` 共用这里。
//!
//! 目前只有跨平台/平台层模块从 bin 挪进来了：
//! `platform`（边界）、`clipboard` / `recycle`（Windows 专属）。
//! 命令层（`#[tauri::command]`）还留在 `main.rs`，等下一批再搬 —— 搬完安卓
//! 才能注册 `list_assets` 这些命令。

/// Windows 剪贴板监听 + 写入（Windows 专属：剪贴板序号、前台窗口进程名）。
#[cfg(windows)]
pub mod clipboard;

/// Windows 系统回收站（第二层保险）。
#[cfg(windows)]
pub mod recycle;

/// 平台能力边界（每个平台一份实现）。
pub mod platform;

#[cfg(mobile)]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("StickerBox mobile 启动失败");
}
