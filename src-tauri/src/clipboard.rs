//! 剪贴板捕获：每 250ms 看一眼剪贴板序号，变了就尝试取图入库。
//!
//! 两个必须处理的坑：
//! 1. 本应用自己往剪贴板写图时，监听器会把它当成"用户复制"再收一遍，
//!    而且经过 RGBA→PNG 重编码后哈希不同，会多出一张"大小不同"的副本。
//!    → 写剪贴板前先开一个抑制窗口（suppress），监听器在窗口内直接跳过。
//! 2. 监听线程和 UI 线程同时访问剪贴板会撞车（OS error 1418）。
//!    → 全局一把锁，读和写都串行化。
//!
//! 只依赖两个系统能力：剪贴板序号 + 前台窗口进程名。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use stickerbox_core::Library;
use tauri::{AppHandle, Emitter};

use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

/// 上限：超过 40MB 的位图跳过（多半是全屏截图，不是表情包）
const MAX_RGBA_BYTES: usize = 40 * 1024 * 1024;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 剪贴板访问闸门：串行化读写 + 自写抑制窗口
pub struct Gate {
    lock: Mutex<()>,
    suppress_until: AtomicU64,
}

impl Gate {
    pub fn new() -> Self {
        Self {
            lock: Mutex::new(()),
            suppress_until: AtomicU64::new(0),
        }
    }

    /// 接下来的 `ms` 毫秒内，监听器不要捕获（我们自己刚写了剪贴板）
    pub fn suppress(&self, ms: u64) {
        self.suppress_until
            .store(now_ms().saturating_add(ms), Ordering::SeqCst);
    }

    pub fn is_suppressed(&self) -> bool {
        now_ms() < self.suppress_until.load(Ordering::SeqCst)
    }

    /// 拿访问锁；中毒了也能继续用
    pub fn acquire(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Default for Gate {
    fn default() -> Self {
        Self::new()
    }
}

pub fn spawn(
    app: AppHandle,
    lib: Arc<Mutex<Library>>,
    paused: Arc<AtomicBool>,
    gate: Arc<Gate>,
    blacklist: Arc<Mutex<Vec<String>>>,
) {
    std::thread::spawn(move || {
        let mut last_seq = unsafe { GetClipboardSequenceNumber() };

        loop {
            std::thread::sleep(Duration::from_millis(250));
            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == last_seq {
                continue;
            }
            last_seq = seq;

            if paused.load(Ordering::Relaxed) {
                continue;
            }

            // 自己刚写完剪贴板：跳过，避免把自己复制出去的图再收一遍
            if gate.is_suppressed() {
                continue;
            }

            // 先看来源：资源管理器和本应用自己复制的，不当成表情
            let (source, raw) = foreground_app();
            if source == "资源管理器" || raw.eq_ignore_ascii_case("stickerbox.exe") {
                continue;
            }

            // 用户黑名单：按进程名匹配，带不带 .exe 都算
            let blocked = blacklist
                .lock()
                .map(|list| is_blocked(&raw, &list))
                .unwrap_or(false);
            if blocked {
                continue;
            }

            // 读剪贴板要拿锁，读完立刻放，导入不占锁
            let grabbed = {
                let _guard = gate.acquire();
                read_clipboard_image()
            };
            let Some((w, h, rgba)) = grabbed else {
                continue;
            };
            if rgba.len() > MAX_RGBA_BYTES {
                continue;
            }

            let Ok(png) = stickerbox_core::rgba_to_png(w, h, &rgba) else {
                continue;
            };

            let name = format!("{}-{}", source, chrono::Local::now().format("%m%d-%H%M"));

            let added = {
                let Ok(mut guard) = lib.lock() else { continue };
                guard
                    .import_image_bytes(
                        png,
                        "png",
                        &name,
                        "clipboard",
                        &raw,
                        vec![source],
                        vec![],
                        w,
                        h,
                    )
                    .unwrap_or(false)
            };

            if added {
                let _ = app.emit("library-changed", ());
            }
        }
    });
}

/// 把「文件」本身放进剪贴板（CF_HDROP）。
/// 这是唯一能保留 GIF 动画的方式——位图剪贴板天然只有一帧。
pub fn copy_path_to_clipboard(path: &Path) -> Result<(), String> {
    copy_paths_to_clipboard(&[path.to_path_buf()])
}

/// 把一批文件放进剪贴板（CF_HDROP），微信/QQ 可以一次粘贴多张
pub fn copy_paths_to_clipboard(paths: &[PathBuf]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有可复制的文件".to_string());
    }
    use std::os::windows::ffi::OsStrExt;
    use windows::core::BOOL;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::DROPFILES;

    let mut wide: Vec<u16> = Vec::new();
    for path in paths {
        wide.extend(path.as_os_str().encode_wide());
        wide.push(0);
    }
    wide.push(0); // 双 null 结尾

    let header = std::mem::size_of::<DROPFILES>();
    let size = header + wide.len() * 2;

    unsafe {
        OpenClipboard(None).map_err(|e| format!("打开剪贴板失败：{e}"))?;
        let _ = EmptyClipboard();

        let hglobal = GlobalAlloc(GMEM_MOVEABLE, size).map_err(|e| format!("分配内存失败：{e}"))?;
        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            let _ = CloseClipboard();
            return Err("锁定内存失败".to_string());
        }

        let df = ptr as *mut DROPFILES;
        (*df).pFiles = header as u32;
        (*df).fNC = BOOL(0);
        (*df).fWide = BOOL(1);

        let dst = (ptr as *mut u8).add(header) as *mut u16;
        std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());

        let _ = GlobalUnlock(hglobal);

        // 成功后剪贴板接管这块内存，不能自己释放
        let _ = SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(hglobal.0)))
            .map_err(|e| format!("设置剪贴板失败：{e}"))?;
        let _ = CloseClipboard();
    }

    Ok(())
}

fn read_clipboard_image() -> Option<(u32, u32, Vec<u8>)> {
    let mut cb = arboard::Clipboard::new().ok()?;
    let img = cb.get_image().ok()?;
    Some((img.width as u32, img.height as u32, img.bytes.into_owned()))
}

/// 剪贴板黑名单匹配：大小写不敏感，`Snipaste` 与 `Snipaste.exe` 等价。
pub fn is_blocked(raw: &str, list: &[String]) -> bool {
    let raw_l = raw.to_lowercase();
    let stem = raw_l.strip_suffix(".exe").unwrap_or(&raw_l).to_string();
    list.iter().any(|entry| {
        let n = entry.trim().to_lowercase();
        let n2 = n.strip_suffix(".exe").unwrap_or(&n).to_string();
        !n.is_empty() && (raw_l == n || stem == n2)
    })
}

#[cfg(test)]
mod tests {
    use super::is_blocked;

    fn list(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn matches_with_or_without_exe() {
        assert!(is_blocked("Snipaste.exe", &list(&["snipaste"])));
        assert!(is_blocked("snipaste", &list(&["Snipaste.exe"])));
        assert!(!is_blocked("WeChat.exe", &list(&["snipaste"])));
    }

    #[test]
    fn ignores_blank_and_other_suffix() {
        assert!(!is_blocked("foo.exe", &list(&["", "  "])));
        assert!(!is_blocked("snipastex.exe", &list(&["snipaste"])));
    }
}

/// 前台窗口：(显示名, 原始进程名)
fn foreground_app() -> (String, String) {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return ("其他".to_string(), String::new());
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return ("其他".to_string(), String::new());
        }

        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return ("其他".to_string(), String::new());
        };

        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(handle);

        if !ok || len == 0 {
            return ("其他".to_string(), String::new());
        }

        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let raw = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
        (map_app(&raw), raw)
    }
}

fn map_app(path: &str) -> String {
    let file = path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
        .to_lowercase();
    match file.as_str() {
        "wechat.exe" | "weixin.exe" => "微信".to_string(),
        "qq.exe" | "qqnt.exe" => "QQ".to_string(),
        "telegram.exe" => "Telegram".to_string(),
        "discord.exe" => "Discord".to_string(),
        "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe" => "浏览器".to_string(),
        "explorer.exe" => "资源管理器".to_string(),
        other => other.trim_end_matches(".exe").to_string(),
    }
}
