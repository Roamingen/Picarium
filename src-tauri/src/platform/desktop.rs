//! Windows 桌面实现。
//!
//! 只是把 `clipboard.rs` 和原来 `main.rs::open_asset` 里的代码薄封装成 trait，
//! 调用点已经换到这里，行为与第二批之前逐行等价。

use std::path::{Path, PathBuf};

use crate::clipboard;

use super::{Opener, ShareOut};

/// 桌面平台句柄。无状态，只为让 trait 方法有个载体。
#[derive(Debug, Clone, Copy, Default)]
pub struct Desktop;

/// 取平台句柄。
pub fn platform() -> Desktop {
    Desktop
}

impl ShareOut for Desktop {
    /// 桌面上的「交出去」= 写系统剪贴板（CF_HDROP）。
    fn share_paths(&self, paths: &[PathBuf]) -> Result<(), String> {
        clipboard::copy_paths_to_clipboard(paths)
    }
}

impl Opener for Desktop {
    fn open(&self, path: &Path) -> Result<(), String> {
        // 与迁移前 `main.rs::open_asset` 里那段 ShellExecuteW 逐行一致。
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let op: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
        let r = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(op.as_ptr()),
                PCWSTR(wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        if (r.0 as isize) <= 32 {
            return Err("系统没有可用的默认打开方式".to_string());
        }
        Ok(())
    }
}
