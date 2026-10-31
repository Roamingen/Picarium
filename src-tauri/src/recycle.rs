//! 删除到系统回收站。
//!
//! 我们自己的 trash/ 是应用内回收站；这里再把文件丢进 Windows 回收站，
//! 等于多一层保险——误删之后还能从系统回收站捞回来。

use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use windows::core::PCWSTR;
use windows::Win32::UI::Shell::{
    SHFileOperationW, SHFILEOPSTRUCTW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
    FO_DELETE,
};

pub fn move_to_recycle_bin(paths: &[PathBuf]) -> Result<(), String> {
    // 已经不在磁盘上的直接跳过，避免整个操作因为一条失败而中断
    let paths: Vec<&PathBuf> = paths.iter().filter(|p| p.exists()).collect();
    if paths.is_empty() {
        return Ok(());
    }

    // pFrom 需要「双 null 结尾」的宽字符列表
    let mut from: Vec<u16> = Vec::new();
    for p in paths {
        from.extend(p.as_os_str().encode_wide());
        from.push(0);
    }
    from.push(0);

    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0 | FOF_NOERRORUI.0) as u16,
        ..Default::default()
    };

    let rc = unsafe { SHFileOperationW(&mut op) };
    if rc != 0 {
        return Err(format!("移入系统回收站失败（code {rc}）"));
    }
    Ok(())
}
