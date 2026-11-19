//! 跨平台共享状态：库句柄 + 剪贴板闸门 + 几个开关。
//!
//! 桌面壳和安卓共用同一个 `AppState`。安卓没有系统剪贴板，闸门是空实现。

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use stickerbox_core::Library;

/// 剪贴板闸门：桌面用真实现，安卓用空实现（保证 `AppState` 两边同一个形状）。
#[cfg(windows)]
pub use crate::clipboard::Gate;

#[cfg(not(windows))]
pub use noop_gate::Gate;

#[cfg(not(windows))]
mod noop_gate {
    /// 占位守卫，跟真闸门的返回类型对齐。
    pub struct Guard;

    /// 安卓（以及其它非 Windows 平台）没有剪贴板捕获，全部空转。
    pub struct Gate;

    impl Gate {
        pub fn new() -> Self {
            Gate
        }
        pub fn acquire(&self) -> Guard {
            Guard
        }
        pub fn suppress(&self, _ms: u64) {}
    }
}

/// 应用状态：库是共享的，其余是桌面开关（安卓上保持默认值）。
pub struct AppState {
    pub lib: Arc<Mutex<Library>>,
    pub gate: Arc<Gate>,
    pub paused: Arc<AtomicBool>,
    pub hotkey: Arc<Mutex<String>>,
    pub clip_hotkey: Arc<Mutex<String>>,
    pub blacklist: Arc<Mutex<Vec<String>>>,
}

impl AppState {
    /// 最简启动（安卓以及以后的其它平台）：只有库，其余用默认值。
    pub fn new(lib: Library) -> Self {
        Self {
            lib: Arc::new(Mutex::new(lib)),
            gate: Arc::new(Gate::new()),
            paused: Arc::new(AtomicBool::new(false)),
            hotkey: Arc::new(Mutex::new("Ctrl+Alt+Space".to_string())),
            clip_hotkey: Arc::new(Mutex::new(String::new())),
            blacklist: Arc::new(Mutex::new(vec!["snipaste.exe".to_string()])),
        }
    }
}

/// 桌面库根目录候选，按优先级。`STICKERBOX_HOME` 一旦设置就只认它。
#[cfg(not(mobile))]
pub fn candidate_roots() -> Vec<PathBuf> {
    if let Ok(p) = std::env::var("STICKERBOX_HOME") {
        return vec![PathBuf::from(p)];
    }
    let mut v = Vec::new();
    if let Ok(p) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(p);
        // 迁移成功后旧目录不存在；迁移失败时优先继续用旧库，别建一个空的新库。
        if p.join("StickerBox").exists() && !p.join("Picarium").exists() {
            v.push(p.join("StickerBox"));
            v.push(p.join("Picarium"));
        } else {
            v.push(p.join("Picarium"));
            v.push(p.join("StickerBox"));
        }
    }
    if let Ok(p) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(p);
        v.push(p.join("Picarium"));
        v.push(p.join("StickerBox"));
    }
    if let Ok(d) = std::env::current_dir() {
        v.push(d.join("Picarium"));
        v.push(d.join("StickerBox"));
    }
    v
}

/// 把默认库 `%USERPROFILE%\StickerBox` 原地改名成 `Picarium`（同盘瞬间完成）。
///
/// 只处理默认库；设置了 `STICKERBOX_HOME` 时不碰。改名失败就继续用旧目录，
/// 不复制、不删除，避免 1.6 GB 的库搬到一半。
#[cfg(not(mobile))]
pub fn migrate_default_library() {
    if std::env::var_os("STICKERBOX_HOME").is_some() {
        return;
    }
    let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) else {
        return;
    };
    match migrate_library_in(&profile) {
        Ok(true) => eprintln!(
            "[library] default {} -> {}",
            profile.join("StickerBox").display(),
            profile.join("Picarium").display()
        ),
        Ok(false) => {}
        Err(e) => eprintln!("[library] 默认库改名失败，继续用旧目录: {e}"),
    }
}

#[cfg(not(mobile))]
fn migrate_library_in(profile: &std::path::Path) -> std::io::Result<bool> {
    let old = profile.join("StickerBox");
    let new = profile.join("Picarium");
    if !old.is_dir() || new.exists() {
        return Ok(false);
    }
    std::fs::rename(&old, &new)?;
    Ok(true)
}

/// 安卓库根目录：应用私有目录（不需要存储权限）。
///
/// 调试时可以用 `STICKERBOX_HOME` 覆盖（`adb shell am start` 传不了环境变量，
/// 一般用 `run-as` 手工放文件）。
#[cfg(mobile)]
pub fn candidate_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;

    if let Ok(p) = std::env::var("STICKERBOX_HOME") {
        return vec![PathBuf::from(p)];
    }
    let mut v = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        v.push(dir.join("StickerBox"));
    }
    v
}

/// 依次尝试候选目录，返回第一个能打开的库。
pub fn open_library_from(roots: &[PathBuf]) -> Result<Library, String> {
    let mut tried = Vec::new();
    for root in roots {
        match Library::open(root) {
            Ok(lib) => {
                eprintln!("[library] {}", root.display());
                return Ok(lib);
            }
            Err(e) => tried.push(format!("  {} → {e}", root.display())),
        }
    }
    Err(format!("无法打开库，已尝试：\n{}", tried.join("\n")))
}

/// 开机自启：写/删注册表 Run 键（Windows 专属）。
#[cfg(windows)]
pub fn autostart_apply(enable: bool, exe: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let mut cmd = std::process::Command::new("reg");
    if enable {
        cmd.args([
            "add",
            RUN_KEY,
            "/v",
            "Picarium",
            "/t",
            "REG_SZ",
            "/d",
            &format!("\"{exe}\" --tray"),
            "/f",
        ]);
    } else {
        cmd.args(["delete", RUN_KEY, "/v", "Picarium", "/f"]);
    }
    cmd.creation_flags(0x08000000);
    let status = cmd.status()?;
    if enable && !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "reg add 返回失败",
        ));
    }
    Ok(())
}

/// 当前是否已设置开机自启（Android 上恒为 false）。
#[cfg(windows)]
pub fn autostart_enabled() -> bool {
    use std::os::windows::process::CommandExt;
    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let mut cmd = std::process::Command::new("reg");
    cmd.args(["query", RUN_KEY, "/v", "Picarium"]);
    cmd.creation_flags(0x08000000);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

#[cfg(not(windows))]
pub fn autostart_enabled() -> bool {
    false
}

#[cfg(all(test, not(mobile)))]
mod tests {
    use super::migrate_library_in;

    #[test]
    fn default_library_renames_once() {
        let base = std::env::temp_dir().join(format!("picarium-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("StickerBox")).unwrap();
        std::fs::write(base.join("StickerBox").join("index.json"), "{}").unwrap();

        assert!(migrate_library_in(&base).unwrap());
        assert!(base.join("Picarium").join("index.json").exists());
        assert!(!base.join("StickerBox").exists());
        assert!(!migrate_library_in(&base).unwrap());

        let _ = std::fs::remove_dir_all(&base);
    }
}
