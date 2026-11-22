#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use picarium_core::{Library, ScanStats};
use picarium_lib::commands::{read_settings_value, settings_file};
use picarium_lib::platform::{Opener, ShareOut};
use picarium_lib::state::{autostart_apply, candidate_roots, AppState};
use picarium_lib::{clipboard, platform, thumb};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// 上次指针指向的库打不开时记下来，前端启动后弹「库不可用」对话框。
static POINTER_FAILURE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();

/// 依次尝试候选目录，返回第一个能用的。全都不行就打印清晰原因后退出，而不是 panic。
///
/// 优先级：`PICARIUM_HOME`（环境变量，测试/开发）> 配置目录里的指针 > 候选目录。
fn open_library() -> Library {
    let env_home =
        std::env::var_os("PICARIUM_HOME").or_else(|| std::env::var_os("STICKERBOX_HOME"));
    if env_home.is_none() {
        if let Some(p) = picarium_lib::config::load_pointer() {
            // Library::open 会把不存在的目录当成新库建出来；指针路径不存
            // 在时（移动硬盘没插、文件夹被删）必须先拦住，否则会静默建
            // 一个空库，让用户以为数据丢了。
            let opened: Result<Library, String> = if p.is_dir() {
                Library::open(&p).map_err(|e| e.to_string())
            } else {
                Err("目录不存在".to_string())
            };
            match opened {
                Ok(lib) => {
                    eprintln!("[library] pointer {}", p.display());
                    return lib;
                }
                Err(e) => {
                    let _ = POINTER_FAILURE.set(Some(p.to_string_lossy().to_string()));
                    eprintln!(
                        "[library] 指针路径打不开 {}：{e}；退回候选目录（指针保持不变）",
                        p.display()
                    )
                }
            }
        }
    }
    let mut tried = Vec::new();
    for root in candidate_roots() {
        match Library::open(&root) {
            Ok(lib) => {
                eprintln!("[library] {}", root.display());
                return lib;
            }
            Err(e) => tried.push(format!("  {} → {e}", root.display())),
        }
    }
    eprintln!("无法打开库，已尝试：\n{}", tried.join("\n"));
    eprintln!("解决办法：设置环境变量 PICARIUM_HOME 指向一个可写目录，例如");
    eprintln!("  $env:PICARIUM_HOME = \"D:\\Picarium\"");
    std::process::exit(1);
}

/// 复制「文件」而不是位图：GIF 动画只有这条路能保住
#[tauri::command]
fn copy_asset_file(state: State<'_, AppState>, sha: String) -> Result<(), String> {
    let path = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.assets()
            .iter()
            .find(|a| a.sha == sha)
            .map(|a| a.path.clone())
            .ok_or_else(|| "库里找不到这张图".to_string())?
    };

    let gate = state.gate.clone();
    let _guard = gate.acquire();
    gate.suppress(800);
    let path = PathBuf::from(&path);
    let result = platform::desktop::platform().share_paths(std::slice::from_ref(&path));
    if result.is_ok() {
        if let Ok(mut lib) = state.lib.lock() {
            let _ = lib.touch_used(&sha);
        }
    }
    result
}

#[tauri::command]
fn set_pinned(window: tauri::WebviewWindow, pinned: bool) -> Result<(), String> {
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
}

/// 单实例锁：抢到 127.0.0.1:47821 的是第一个实例，抢不到就通知它显示窗口后退出。
/// 用网络端口而不是命名互斥体，是为了少一个 Windows 专属 API、也方便跨平台。
///
/// 「立即重启」是先拉起新进程、再让旧进程退出，新进程第一次绑端口时旧的往往
/// 还没退干净——所以绑失败后重试几秒，而不是立刻当成“已有实例”退出，
/// 否则重启会变成只关不开。正常重复启动时这段重试只是延迟几秒静默退出。
fn acquire_singleton() -> Option<std::net::TcpListener> {
    use std::io::Write;
    const ADDR: &str = "127.0.0.1:47821";
    const RETRIES: u32 = 30;
    for attempt in 0..RETRIES {
        match std::net::TcpListener::bind(ADDR) {
            Ok(listener) => return Some(listener),
            Err(_) => {
                if attempt == 0 {
                    if let Ok(mut stream) = std::net::TcpStream::connect(ADDR) {
                        let _ = stream.write_all(b"show");
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
    eprintln!("[singleton] {ADDR} 一直被占用，退出（可能是另一个实例正在重启）");
    None
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn register_hotkey(app: &tauri::AppHandle, accel: &str, kind: &str) -> Result<(), String> {
    if accel.trim().is_empty() {
        return Ok(());
    }
    let sc: Shortcut = accel
        .parse()
        .map_err(|_| format!("「{accel}」不是合法快捷键"))?;
    let handle = app.clone();
    let kind = kind.to_string();
    app.global_shortcut()
        .on_shortcut(sc, move |_app, _sc, ev| {
            if ev.state() != ShortcutState::Pressed {
                return;
            }
            if kind == "clip" {
                toggle_clipboard(&handle);
            } else {
                toggle_panel(&handle);
            }
        })
        .map_err(|e| format!("注册失败（可能被占用）：{e}"))
}

/// 全局热键切换剪贴板捕获，并把状态写回设置
fn toggle_clipboard(app: &tauri::AppHandle) {
    let st = app.state::<AppState>();
    let enabled_now = !st.paused.load(Ordering::Relaxed);
    let next = !enabled_now;
    st.paused.store(!next, Ordering::Relaxed);

    {
        let path = picarium_lib::config::settings_path();
        let mut cur = read_settings_value(&path);
        merge_json(&mut cur, &serde_json::json!({ "clipboardEnabled": next }));
        if let Ok(text) = serde_json::to_string_pretty(&cur) {
            let _ = std::fs::write(&path, text);
        }
    }
    let _ = app.emit("clipboard-toggled", serde_json::json!({ "enabled": next }));
}

fn toggle_panel(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("panel") else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit("panel-open", ());
    }
}

#[tauri::command]
fn set_order(state: State<'_, AppState>, key: String, shas: Vec<String>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_order(&key, shas).map_err(|e| format!("{e:#}"))
}

/// 批量复制原文件到剪贴板（保留动画；微信/QQ 可一次粘贴多张）
#[tauri::command]
fn copy_assets_files(state: State<'_, AppState>, shas: Vec<String>) -> Result<usize, String> {
    let paths: Vec<std::path::PathBuf> = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        shas.iter()
            .filter_map(|sha| lib.find(sha).map(|a| std::path::PathBuf::from(&a.path)))
            .collect()
    };
    if paths.is_empty() {
        return Err("找不到这些文件".to_string());
    }
    platform::desktop::platform().share_paths(&paths)?;
    Ok(paths.len())
}

fn clamp_to_monitor(win: &tauri::WebviewWindow, width: u32, height: u32) -> (u32, u32) {
    let mut max_w = 1920.0;
    let mut max_h = 1080.0;
    if let Ok(Some(m)) = win.current_monitor() {
        let s = m.scale_factor();
        max_w = m.size().width as f64 / s;
        max_h = m.size().height as f64 / s;
    }
    let w = (width as f64).clamp(640.0, (max_w - 40.0).max(640.0)) as u32;
    let h = (height as f64).clamp(420.0, (max_h - 80.0).max(420.0)) as u32;
    (w, h)
}

#[tauri::command]
fn set_window_size(
    app: tauri::AppHandle,
    label: String,
    width: u32,
    height: u32,
) -> Result<serde_json::Value, String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "窗口不存在".to_string())?;
    let (w, h) = clamp_to_monitor(&win, width, height);
    win.set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "width": w, "height": h }))
}

#[tauri::command]
fn set_panel_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<serde_json::Value, String> {
    let win = app
        .get_webview_window("panel")
        .ok_or_else(|| "窗口不存在".to_string())?;
    let mut cx = x;
    let mut cy = y;
    if let Ok(Some(m)) = win.current_monitor() {
        let s = m.scale_factor();
        let w = m.size().width as f64 / s;
        let h = m.size().height as f64 / s;
        let size = win
            .outer_size()
            .map(|z| (z.width as f64 / s, z.height as f64 / s))
            .unwrap_or((720.0, 520.0));
        // 以屏幕中心为原点：0,0 = 正中间
        cx = ((w - size.0) / 2.0 + x as f64).clamp(0.0, (w - size.0).max(0.0)) as i32;
        cy = ((h - size.1) / 2.0 + y as f64).clamp(0.0, (h - size.1).max(0.0)) as i32;
    }
    win.set_position(tauri::LogicalPosition::new(cx, cy))
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "x": cx, "y": cy }))
}

/// 用系统默认程序打开这张图
#[tauri::command]
fn open_asset(state: State<'_, AppState>, sha: String) -> Result<(), String> {
    let path = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.find(&sha)
            .map(|a| a.path.clone())
            .ok_or_else(|| "找不到这张图".to_string())?
    };
    platform::desktop::platform().open(Path::new(&path))
}

#[tauri::command]
fn js_log(msg: String) {
    eprintln!("[js] {msg}");
}

#[tauri::command]
fn selftest_mode() -> String {
    let v = std::env::var("PICARIUM_SELFTEST").unwrap_or_default();
    eprintln!("[selftest] mode={v:?}");
    v
}

#[tauri::command]
fn ui_state() -> String {
    std::env::var("PICARIUM_UI_STATE").unwrap_or_default()
}

#[tauri::command]
fn selftest_report(
    state: State<'_, AppState>,
    report: serde_json::Value,
) -> Result<String, String> {
    let root = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.root().to_path_buf()
    };
    let path = root.join("selftest-report.json");
    let text = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("写报告失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn clipboard_sources(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    let mut map: std::collections::BTreeMap<String, usize> = Default::default();
    for a in lib.assets() {
        if a.source == "clipboard" && !a.source_ref.is_empty() {
            *map.entry(a.source_ref.clone()).or_insert(0) += 1;
        }
    }
    Ok(map
        .into_iter()
        .map(|(name, count)| serde_json::json!({"name": name, "count": count}))
        .collect())
}

#[tauri::command]
fn set_hotkey(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    accel: String,
) -> Result<(), String> {
    let old = {
        let h = state.hotkey.lock().map_err(|e| e.to_string())?;
        h.clone()
    };
    if let Ok(old_sc) = old.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old_sc);
    }
    register_hotkey(&app, &accel, "panel")?;
    {
        let mut h = state.hotkey.lock().map_err(|e| e.to_string())?;
        *h = accel.clone();
    }
    let path = settings_file()?;
    let mut cur = read_settings_value(&path);
    merge_json(&mut cur, &serde_json::json!({ "hotkey": accel }));
    if let Some(obj) = cur.as_object_mut() {
        obj.remove("root");
        obj.remove("version");
    }
    if let Ok(text) = serde_json::to_string_pretty(&cur) {
        let _ = std::fs::write(&path, text);
    }
    Ok(())
}

#[tauri::command]
fn set_clip_hotkey(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    accel: String,
) -> Result<(), String> {
    let old = {
        let h = state.clip_hotkey.lock().map_err(|e| e.to_string())?;
        h.clone()
    };
    if let Ok(old_sc) = old.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old_sc);
    }
    register_hotkey(&app, &accel, "clip")?;
    {
        let mut h = state.clip_hotkey.lock().map_err(|e| e.to_string())?;
        *h = accel.clone();
    }
    let path = settings_file()?;
    let mut cur = read_settings_value(&path);
    merge_json(&mut cur, &serde_json::json!({ "clipHotkey": accel }));
    if let Some(obj) = cur.as_object_mut() {
        obj.remove("root");
        obj.remove("version");
    }
    if let Ok(text) = serde_json::to_string_pretty(&cur) {
        let _ = std::fs::write(&path, text);
    }
    Ok(())
}

#[tauri::command]
fn batch_delete(state: State<'_, AppState>, shas: Vec<String>) -> Result<usize, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    let mut n = 0;
    for sha in shas {
        if lib.remove(&sha).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

/// 拖拽 / 选择器统一入口：目录递归扫描，文件直接入库
#[tauri::command]
async fn import_paths(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ScanStats, String> {
    let lib = state.lib.clone();

    // 先把文件列出来，不持锁、不读内容
    let mut files: Vec<PathBuf> = Vec::new();
    for p in &paths {
        let path = Path::new(p);
        if path.is_dir() {
            picarium_core::collect_images(path, &mut files);
        } else if picarium_core::image_ext(path).is_some() {
            files.push(path.to_path_buf());
        }
    }

    let total = files.len();
    let mut stats = ScanStats {
        scanned: total,
        added: 0,
        duplicated: 0,
        skipped: 0,
        errors: 0,
    };

    for (i, file) in files.iter().enumerate() {
        // 一次只锁一张：界面查询能插进来，不会整窗口卡死
        let imported = {
            let mut guard = lib.lock().map_err(|e| e.to_string())?;
            guard.import_file(file)
        };

        match imported {
            Ok(Some(sha)) => {
                stats.added += 1;
                // 缩略图在锁外生成，避免长时间占用
                let root = {
                    let guard = lib.lock().map_err(|e| e.to_string())?;
                    guard.root().to_path_buf()
                };
                let ext = picarium_core::image_ext(file).unwrap_or_default();
                let _ = picarium_core::ensure_thumb(&root, &sha, &ext);
            }
            Ok(None) => stats.duplicated += 1,
            Err(e) => {
                stats.errors += 1;
                eprintln!("[import] {}: {e:#}", file.display());
            }
        }

        let _ = app.emit(
            "import-progress",
            serde_json::json!({ "done": i + 1, "total": total }),
        );
    }

    Ok(stats)
}

#[tauri::command]
async fn scan_folder(state: State<'_, AppState>, path: String) -> Result<ScanStats, String> {
    let lib = state.lib.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = lib.lock().map_err(|e| e.to_string())?;
        guard
            .scan_folder(Path::new(&path))
            .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 把一张表情放进系统剪贴板（RGBA）。之后在任何聊天窗口 Ctrl+V 即可。
/// 把 RGBA 放进剪贴板：拿闸门锁 + 开抑制窗口 + 失败重试
fn clip_copy(gate: &clipboard::Gate, w: u32, h: u32, bytes: &[u8]) -> Result<(), String> {
    let _guard = gate.acquire();
    gate.suppress(1500);

    let mut last_err: Option<String> = None;
    for _ in 0..5 {
        let attempt = arboard::Clipboard::new().and_then(|mut cb| {
            cb.set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Borrowed(bytes),
            })
        });
        match attempt {
            Ok(()) => {
                last_err = None;
                break;
            }
            Err(e) => {
                last_err = Some(format!("{e}"));
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
        }
    }

    match last_err {
        Some(e) => Err(format!("{e}（剪贴板被其他程序占用，请稍后重试）")),
        None => Ok(()),
    }
}

#[tauri::command]
fn copy_asset(state: State<'_, AppState>, sha: String) -> Result<(), String> {
    let path = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.assets()
            .iter()
            .find(|a| a.sha == sha)
            .map(|a| a.path.clone())
            .ok_or_else(|| "库里找不到这张图".to_string())?
    };

    let (w, h, bytes) =
        picarium_core::load_rgba(Path::new(&path)).map_err(|e| format!("{e:#}"))?;

    let result = clip_copy(&state.gate, w, h, &bytes);
    if result.is_ok() {
        if let Ok(mut lib) = state.lib.lock() {
            let _ = lib.touch_used(&sha);
        }
    }
    result
}

#[tauri::command]
fn update_asset(
    state: State<'_, AppState>,
    sha: String,
    name: Option<String>,
    tags: Option<Vec<String>>,
    groups: Option<Vec<String>>,
) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.update(&sha, name, tags, groups)
        .map_err(|e| format!("{e:#}"))
}



#[tauri::command]
fn mark_ungrouped_seen(state: State<'_, AppState>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.mark_ungrouped_seen().map_err(|e| format!("{e:#}"))
}




fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(b), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                merge_json(b.entry(k.clone()).or_insert(serde_json::Value::Null), v);
            }
        }
        (b, p) => *b = p.clone(),
    }
}

fn apply_side_effects(state: &State<'_, AppState>, patch: &serde_json::Value) {
    if let Some(enabled) = patch.get("clipboardEnabled").and_then(|v| v.as_bool()) {
        state.paused.store(!enabled, Ordering::Relaxed);
    }
    if let Some(list) = patch.get("clipboardBlacklist").and_then(|v| v.as_array()) {
        let items: Vec<String> = list
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if let Ok(mut guard) = state.blacklist.lock() {
            *guard = items;
        }
    }
    if let Some(enabled) = patch.get("autostart").and_then(|v| v.as_bool()) {
        if let Ok(exe) = std::env::current_exe() {
            let _ = autostart_apply(enabled, &exe.to_string_lossy());
        }
    }
}

#[tauri::command]
fn patch_settings(state: State<'_, AppState>, patch: serde_json::Value) -> Result<(), String> {
    let path = settings_file()?;
    let mut cur = read_settings_value(&path);
    merge_json(&mut cur, &patch);
    // 运行时字段不落盘
    if let Some(obj) = cur.as_object_mut() {
        obj.remove("root");
        obj.remove("version");
        if obj.contains_key("starStyle") {
            obj.remove("starGlyph");
        }
    }
    let json = serde_json::to_string_pretty(&cur).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("写入设置失败：{e}"))?;
    apply_side_effects(&state, &patch);
    Ok(())
}

#[tauri::command]
fn export_settings(_state: State<'_, AppState>) -> Result<String, String> {
    let path = settings_file()?;
    let out = path.with_file_name("settings-export.json");
    let v = read_settings_value(&path);
    let json = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&out, json).map_err(|e| format!("导出失败：{e}"))?;
    Ok(out.to_string_lossy().to_string())
}

#[tauri::command]
fn import_settings(state: State<'_, AppState>, json: String) -> Result<(), String> {
    let patch: serde_json::Value =
        serde_json::from_str(&json).map_err(|_| "不是合法的 JSON".to_string())?;
    let path = settings_file()?;
    let mut cur = read_settings_value(&path);
    merge_json(&mut cur, &patch);
    if let Some(obj) = cur.as_object_mut() {
        obj.remove("root");
        obj.remove("version");
    }
    let text = serde_json::to_string_pretty(&cur).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("写入设置失败：{e}"))?;
    apply_side_effects(&state, &patch);
    Ok(())
}

#[tauri::command]
fn set_clipboard_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.paused.store(!enabled, Ordering::Relaxed);
    let path = settings_file()?;
    let mut cur = read_settings_value(&path);
    merge_json(
        &mut cur,
        &serde_json::json!({ "clipboardEnabled": enabled }),
    );
    if let Some(obj) = cur.as_object_mut() {
        obj.remove("root");
        obj.remove("version");
        obj.remove("autostart");
    }
    if let Ok(text) = serde_json::to_string_pretty(&cur) {
        let _ = std::fs::write(&path, text);
    }
    Ok(())
}

#[tauri::command]
fn set_autostart(_state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    autostart_apply(enabled, &exe.to_string_lossy())
        .map_err(|e| format!("设置开机自启失败：{e}"))?;
    let path = settings_file()?;
    let mut cur = read_settings_value(&path);
    merge_json(&mut cur, &serde_json::json!({ "autostart": enabled }));
    if let Some(obj) = cur.as_object_mut() {
        obj.remove("root");
        obj.remove("version");
    }
    if let Ok(text) = serde_json::to_string_pretty(&cur) {
        let _ = std::fs::write(&path, text);
    }
    Ok(())
}

#[tauri::command]
fn open_library_folder(state: State<'_, AppState>) -> Result<(), String> {
    let root = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.root().to_string_lossy().to_string()
    };
    std::process::Command::new("explorer")
        .arg(&root)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_config_folder() -> Result<(), String> {
    let dir = picarium_lib::config::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 在资源管理器里打开任意目录（搬家预览里的「打开目标/旧位置」）。
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("目录不存在：{path}"));
    }
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 启动时检查到的搬家中断信息（供前端提示）。
static MOVE_RECOVERY: std::sync::OnceLock<Option<picarium_lib::library_move::Recovery>> =
    std::sync::OnceLock::new();

#[tauri::command]
fn move_recovery() -> Option<picarium_lib::library_move::Recovery> {
    MOVE_RECOVERY.get().cloned().flatten()
}

/// 指针里的库打不开时返回那个路径（前端弹「库不可用」对话框）。
#[tauri::command]
fn pointer_failure() -> Option<String> {
    POINTER_FAILURE.get().cloned().flatten()
}

/// 库不可用时的「用默认库」：挑第一个能打开的候选目录写指针。
#[tauri::command]
fn use_default_library() -> Result<String, String> {
    for root in candidate_roots() {
        if Library::open(&root).is_ok() {
            picarium_lib::config::save_pointer(&root).map_err(|e| format!("写库指针失败：{e}"))?;
            return Ok(root.to_string_lossy().to_string());
        }
    }
    Err("没有找到能打开的默认库".into())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 搬家（把当前库整体换到 `to`）。进度通过 `move-progress` 事件回报。
#[tauri::command]
async fn move_library(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    to: String,
    mode: String,
    keep_old: bool,
) -> Result<serde_json::Value, String> {
    let from = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.root().to_path_buf()
    };
    let to_path = PathBuf::from(&to);
    // 先做一次快速校验，错误直接回给前端（不用等线程）。
    picarium_lib::library_move::validate(&from, &to_path)?;

    // 搬家期间别让剪贴板/导入写库。
    let paused = state.paused.clone();
    let was_paused = paused.swap(true, Ordering::Relaxed);
    let app2 = app.clone();
    let from2 = from.clone();
    let mode2 = mode.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut emit = |p: picarium_lib::library_move::Progress| {
            let payload = serde_json::json!({
                "phase": p.phase,
                "files": p.files,
                "bytes": p.bytes,
                "totalFiles": p.total_files,
                "totalBytes": p.total_bytes,
            });
            let _ = app2.emit("move-progress", payload);
        };
        picarium_lib::library_move::run(
            &from2,
            &to_path,
            &mode2,
            keep_old,
            &mut emit,
            &|| picarium_lib::library_move::CANCEL.load(Ordering::Relaxed),
        )
    })
    .await;
    paused.store(was_paused, Ordering::Relaxed);

    match result {
        Ok(Ok(outcome)) => Ok(serde_json::json!({
            "to": outcome.to.to_string_lossy(),
            "from": outcome.from.to_string_lossy(),
            "mode": outcome.mode,
            "removedOld": outcome.removed_old,
            "keptOld": outcome.kept_old,
        })),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("搬家线程失败：{e}")),
    }
}

#[tauri::command]
fn cancel_move() {
    picarium_lib::library_move::request_cancel();
}

/// 搬家前的预检查（前端确认框要用：同盘移动还是跨盘复制、文件数、大小）。
#[tauri::command]
fn move_check(state: State<'_, AppState>, to: String) -> Result<serde_json::Value, String> {
    let from = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.root().to_path_buf()
    };
    let to_path = PathBuf::from(&to);
    let (files, bytes) = picarium_lib::library_move::validate(&from, &to_path)?;
    let same = picarium_lib::library_move::same_drive(&from, &to_path);
    let free = picarium_lib::library_move::free_bytes(&to_path);
    Ok(serde_json::json!({
        "from": from.to_string_lossy(),
        "sameDrive": same,
        "files": files,
        "bytes": bytes,
        "free": free,
    }))
}

/// 删除旧位置（搬家后确认新库没问题时用；必须二次确认，只删库形状的目录）。
#[tauri::command]
fn remove_old_location(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let current = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.root().to_path_buf()
    };
    let p = PathBuf::from(&path);
    if picarium_lib::config::same_dir(&p, &current) {
        return Err("这是当前正在用的库，不能删除".into());
    }
    if !p.is_dir() {
        return Err("目录不存在".into());
    }
    let looks_like_lib = p.join("index.json").is_file() || p.join("blobs").is_dir();
    if !looks_like_lib {
        return Err("这个目录不像 Picarium 库，为安全起见不删除".into());
    }
    std::fs::remove_dir_all(&p).map_err(|e| format!("删除失败：{e}"))
}


#[tauri::command]
fn hide_panel(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// 打开字体设置窗口；已经存在就前置，不重复创建。
#[tauri::command]
async fn show_font_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("font") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let win = tauri::WebviewWindowBuilder::new(
        &app,
        "font",
        tauri::WebviewUrl::App("font-settings.html".into()),
    )
    .title("界面字体")
    .inner_size(980.0, 720.0)
    .min_inner_size(860.0, 600.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("打开字体设置失败：{e}"))?;
    harden_webview(&win);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
fn hide_font_settings(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// 关掉 WebView2 自带的浏览器行为：原生右键菜单、浏览器加速键（F5/Ctrl+R、
/// Ctrl+P/F、Ctrl+±、Alt+← 等）、缩放、自动填充与侧滑导航，并让 release
/// 不再暴露 DevTools。debug 版默认不动，设 `PICARIUM_HARDEN=1` 可强制开启。
#[cfg(windows)]
fn harden_webview(win: &tauri::WebviewWindow) {
    let forced = cfg!(debug_assertions) && std::env::var_os("PICARIUM_HARDEN").is_some();
    if cfg!(debug_assertions) && !forced {
        return;
    }
    let label = win.label().to_string();
    let _ = win.with_webview(move |w| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2Settings5,
            ICoreWebView2Settings6,
        };
        use windows::core::Interface;
        let res: Result<(), String> = (|| {
            let core = unsafe { w.controller().CoreWebView2() }.map_err(|e| e.to_string())?;
            let s = unsafe { core.Settings() }.map_err(|e| e.to_string())?;
            unsafe {
                s.SetAreDefaultContextMenusEnabled(false)
                    .map_err(|e| e.to_string())?;
                s.SetIsStatusBarEnabled(false)
                    .map_err(|e| e.to_string())?;
                s.SetIsZoomControlEnabled(false)
                    .map_err(|e| e.to_string())?;
                s.SetAreDevToolsEnabled(false)
                    .map_err(|e| e.to_string())?;
                if let Ok(s3) = s.cast::<ICoreWebView2Settings3>() {
                    s3.SetAreBrowserAcceleratorKeysEnabled(false)
                        .map_err(|e| e.to_string())?;
                }
                if let Ok(s4) = s.cast::<ICoreWebView2Settings4>() {
                    s4.SetIsGeneralAutofillEnabled(false)
                        .map_err(|e| e.to_string())?;
                    s4.SetIsPasswordAutosaveEnabled(false)
                        .map_err(|e| e.to_string())?;
                }
                if let Ok(s5) = s.cast::<ICoreWebView2Settings5>() {
                    s5.SetIsPinchZoomEnabled(false)
                        .map_err(|e| e.to_string())?;
                }
                if let Ok(s6) = s.cast::<ICoreWebView2Settings6>() {
                    s6.SetIsSwipeNavigationEnabled(false)
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })();
        match res {
            Ok(()) if forced => eprintln!("[harden] {label}: ok"),
            Ok(()) => {}
            Err(e) => eprintln!("[harden] {label}: {e}"),
        }
    });
}

#[cfg(not(windows))]
fn harden_webview(_win: &tauri::WebviewWindow) {}


/// 列出本机字体家族。Windows 用 fontdb 扫描系统字体；其他平台先返回空。
#[tauri::command]
fn list_system_fonts() -> Vec<serde_json::Value> {
    #[cfg(target_os = "windows")]
    {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for face in db.faces() {
            let Some((family, _)) = face.families.first() else {
                continue;
            };
            if family.trim().is_empty() || !seen.insert(family.to_lowercase()) {
                continue;
            }
            let cjk = db
                .with_face_data(face.id, |data, index| {
                    ttf_parser::Face::parse(data, index)
                        .ok()
                        .and_then(|face| face.glyph_index('\u{6c49}'))
                        .is_some()
                })
                .unwrap_or(false);
            out.push(serde_json::json!({
                "family": family,
                "mono": face.monospaced,
                "cjk": cjk,
            }));
        }
        out.sort_by(|a, b| {
            let an = a["family"].as_str().unwrap_or("").to_lowercase();
            let bn = b["family"].as_str().unwrap_or("").to_lowercase();
            an.cmp(&bn)
        });
        out
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// 把旧 identifier 的 app data 一次性搬到新目录。
///
/// 旧目录只读不删：要回滚，删掉新目录、把旧版 exe 放回去即可。
/// 复制先落到 `<新 identifier>.migrating`，成功后再改名，避免中途失败留下
/// 一个“看起来已经迁完”的空壳目录；失败下次启动会重试。
#[cfg(windows)]
fn migrate_app_data() {
    const OLD_ID: &str = "dev.stickerbox.desktop";
    const NEW_ID: &str = "dev.picarium.desktop";

    let Some(base) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return;
    };
    let old = base.join(OLD_ID);
    let new = base.join(NEW_ID);
    if !old.is_dir() || new.exists() {
        return;
    }

    let staging = base.join(format!("{NEW_ID}.migrating"));
    let _ = std::fs::remove_dir_all(&staging);
    if let Err(e) = copy_tree(&old, &staging) {
        eprintln!("[migrate] app data 复制失败，下次启动重试: {e}");
        let _ = std::fs::remove_dir_all(&staging);
        return;
    }
    if let Err(e) = std::fs::rename(&staging, &new) {
        eprintln!("[migrate] app data 改名失败，下次启动重试: {e}");
        let _ = std::fs::remove_dir_all(&staging);
        return;
    }
    eprintln!("[migrate] app data {} -> {}", old.display(), new.display());
}

#[cfg(windows)]
fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_tree(&entry.path(), &to)?;
        } else if ty.is_file() {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() >= 3 && args[1] == "probe" {
        let p = PathBuf::from(&args[2]);
        println!("target = {}", p.display());
        match std::fs::create_dir_all(p.join("blobs")) {
            Ok(_) => println!("mkdir blobs: OK"),
            Err(e) => println!("mkdir blobs: ERR {e} kind={:?}", e.kind()),
        }
        match std::fs::write(p.join("probe.txt"), b"hi") {
            Ok(_) => println!("write: OK"),
            Err(e) => println!("write: ERR {e}"),
        }
        println!("cwd = {:?}", std::env::current_dir());
        return;
    }

    // 诊断：打印每个候选目录能不能用（排查权限问题时用）
    if args.len() >= 2 && args[1] == "diag" {
        println!("USERPROFILE   = {:?}", std::env::var("USERPROFILE"));
        println!("LOCALAPPDATA  = {:?}", std::env::var("LOCALAPPDATA"));
        println!("PICARIUM_HOME = {:?}", std::env::var("PICARIUM_HOME"));
        println!("cwd           = {:?}", std::env::current_dir());
        for root in candidate_roots() {
            let existed = root.exists();
            let probe = root.join(".write-test");
            let result = std::fs::create_dir_all(&root)
                .and_then(|_| std::fs::write(&probe, b"1"))
                .and_then(|_| std::fs::remove_file(&probe));
            match result {
                Ok(_) => {
                    // 只为探测而建的目录，测完删掉，不留垃圾
                    if !existed {
                        let _ = std::fs::remove_dir_all(&root);
                    }
                    println!("[OK]   {}", root.display())
                }
                Err(e) => println!("[FAIL] {} → {e}", root.display()),
            }
        }
        return;
    }

    // 命令行导入：picarium.exe scan <目录>
    // 图形界面之外也能批量入库，方便脚本化和排查问题。
    if args.len() >= 3 && args[1] == "scan" {
        let mut lib = open_library();
        let stats = lib.scan_folder(Path::new(&args[2])).expect("扫描失败");
        println!("{}", serde_json::to_string(&stats).unwrap());
        return;
    }

    // 第二个实例：通知已有窗口后直接退出
    let Some(singleton) = acquire_singleton() else {
        return;
    };

    // 旧 identifier 的 WebView2 数据只在升级后第一次启动时搬一次。
    // 必须赶在建窗口之前：WebView2 的 profile 目录由 identifier 派生，窗口一建就晚了。
    #[cfg(windows)]
    migrate_app_data();

    // 全局配置目录（设置/主题/库指针）：默认 %APPDATA%\Picarium，
    // 测试脚本用 PICARIUM_CONFIG_HOME 隔离到临时目录。
    picarium_lib::config::init_dir(picarium_lib::config::default_dir());

    // 默认库目录从 StickerBox 改名到 Picarium；改名失败时继续用旧库。
    #[cfg(windows)]
    picarium_lib::state::migrate_default_library();

    // 上次搬家是否被中断？先恢复再打开库（可能顺手把指针切到已完成的改名）。
    let _ = MOVE_RECOVERY.set(picarium_lib::library_move::recover_startup());

    let lib = open_library();

    // 首次升级：把库根里的旧 settings.json/themes 复制到配置目录并写指针。
    // 复制失败会退回旧布局（设置继续读库根），不会丢配置。
    picarium_lib::config::ensure_for_library(lib.root());

    // 启动时恢复「剪贴板捕获」开关
    let settings_path = picarium_lib::config::settings_path();
    let boot_settings: serde_json::Value = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    // 回收站到期清理跟随「删除方式」：recycle 送系统回收站，permanent 直接删。
    // 失败项留在清单里，下次启动再试。
    let delete_mode = boot_settings
        .get("deleteMode")
        .and_then(|v| v.as_str())
        .unwrap_or("recycle");
    let purged = picarium_lib::commands::purge_expired_trash(&lib, delete_mode == "permanent");
    if purged > 0 {
        eprintln!(
            "[library] 回收站自动清理了 {purged} 张过期图片（{}）",
            if delete_mode == "permanent" {
                "彻底删除"
            } else {
                "送系统回收站"
            }
        );
    }
    let blacklist_items: Vec<String> = boot_settings
        .get("clipboardBlacklist")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_else(|| vec!["snipaste.exe".to_string()]);
    let blacklist = Arc::new(Mutex::new(blacklist_items));
    let start_hidden = std::env::args().any(|a| a == "--tray")
        || boot_settings
            .get("startHidden")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);

    let paused = Arc::new(AtomicBool::new(false));
    {
        let path = picarium_lib::config::settings_path();
        if let Ok(txt) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                if v.get("clipboardEnabled").and_then(|x| x.as_bool()) == Some(false) {
                    paused.store(true, Ordering::Relaxed);
                }
            }
        }
    }

    let hotkey_accel = boot_settings
        .get("hotkey")
        .and_then(|v| v.as_str())
        .unwrap_or("Ctrl+Alt+Space")
        .to_string();
    let clip_hotkey_accel = boot_settings
        .get("clipHotkey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            lib: Arc::new(Mutex::new(lib)),
            gate: Arc::new(clipboard::Gate::new()),
            paused: paused.clone(),
            hotkey: Arc::new(Mutex::new(hotkey_accel.clone())),
            clip_hotkey: Arc::new(Mutex::new(clip_hotkey_accel.clone())),
            blacklist: blacklist.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            picarium_lib::commands::list_assets,
            picarium_lib::commands::get_asset,
            picarium_lib::commands::themes_list,
            picarium_lib::commands::library_stats,
            picarium_lib::commands::library_locations,
            picarium_lib::commands::library_dir_check,
            picarium_lib::commands::library_use,
            picarium_lib::commands::library_forget,
            picarium_lib::commands::restart_app,
            picarium_lib::commands::group_stats,
            picarium_lib::commands::group_list,
            picarium_lib::commands::set_group_cover,
            picarium_lib::commands::set_group_order,
            picarium_lib::commands::set_pinned_groups,
            scan_folder,
            import_paths,
            copy_asset,
            copy_asset_file,
            picarium_lib::commands::create_group,
            copy_assets_files,
            set_window_size,
            set_hotkey,
            open_asset,
            open_folder,
            move_recovery,
            pointer_failure,
            use_default_library,
            quit_app,
            move_library,
            move_check,
            cancel_move,
            remove_old_location,
            picarium_lib::commands::source_stats,
            set_clip_hotkey,
            selftest_mode,
            js_log,
            clipboard_sources,
            ui_state,
            selftest_report,
            set_panel_position,
            patch_settings,
            export_settings,
            import_settings,
            set_order,
            picarium_lib::commands::batch_star,
            picarium_lib::commands::add_tags,
            picarium_lib::commands::remove_tags,
            picarium_lib::commands::set_asset_tags,
            picarium_lib::commands::create_tag,
            picarium_lib::commands::rename_tag,
            picarium_lib::commands::merge_tags,
            picarium_lib::commands::delete_tag,
            picarium_lib::commands::batch_ungroup,
            batch_delete,
            set_pinned,
            update_asset,
            picarium_lib::commands::delete_asset,
            picarium_lib::commands::share_assets,
            picarium_lib::commands::add_to_group,
            picarium_lib::commands::clear_groups,
            picarium_lib::commands::mark_used,
            picarium_lib::commands::rename_group,
            picarium_lib::commands::remove_group,
            mark_ungrouped_seen,
            picarium_lib::commands::tag_stats,
            picarium_lib::commands::get_trash_days,
            picarium_lib::commands::set_trash_days,
            picarium_lib::commands::trash_list,
            picarium_lib::commands::trash_restore,
            picarium_lib::commands::trash_delete,
            picarium_lib::commands::trash_purge,
            picarium_lib::commands::get_settings,
            set_clipboard_enabled,
            set_autostart,
            open_library_folder,
            open_config_folder,
            hide_panel,
            show_font_settings,
            hide_font_settings,
            list_system_fonts
        ])
        .setup(move |app| {
            // 热键被别的软件占用是常态，注册失败不应该让整个应用起不来
            if let Err(e) = register_hotkey(app.handle(), &hotkey_accel, "panel") {
                eprintln!("[hotkey] 面板热键注册失败: {e}");
            }
            if !clip_hotkey_accel.trim().is_empty() {
                if let Err(e) = register_hotkey(app.handle(), &clip_hotkey_accel, "clip") {
                    eprintln!("[hotkey] 剪贴板热键注册失败: {e}");
                }
            }

            // 浏览器桥：扩展把图片字节从 17800 端口送进来；端口被占只告警
            {
                let state = app.state::<AppState>();
                let lib = state.lib.clone();
                let root = match lib.lock() {
                    Ok(library) => library.root().to_path_buf(),
                    Err(_) => PathBuf::new(),
                };
                if !root.as_os_str().is_empty() {
                    picarium_lib::bridge::spawn(
                        lib.clone(),
                        root,
                        picarium_lib::bridge::token(),
                        app.handle().clone(),
                    );
                }
            }

            // 关掉 WebView2 的浏览器原生行为（原生右键菜单/加速键/缩放/DevTools 等）
            for label in ["main", "panel"] {
                if let Some(win) = app.get_webview_window(label) {
                    harden_webview(&win);
                }
            }
            // WebView2 刚建好时偶尔还拿不到 CoreWebView2，启动后补一次
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    for label in ["main", "panel"] {
                        if let Some(win) = handle.get_webview_window(label) {
                            harden_webview(&win);
                        }
                    }
                });
            }

            // 窗口在配置里默认不可见：静默启动时完全不闪；正常启动才显示
            if let Some(main) = app.get_webview_window("main") {
                if start_hidden {
                    let _ = main.hide();
                } else {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }

            // 恢复快贴面板位置
            if let (Some(x), Some(y)) = (
                boot_settings.get("panelX").and_then(|v| v.as_i64()),
                boot_settings.get("panelY").and_then(|v| v.as_i64()),
            ) {
                if let Some(win) = app.get_webview_window("panel") {
                    let mut cx = x as i32;
                    let mut cy = y as i32;
                    if let Ok(Some(m)) = win.current_monitor() {
                        let sc = m.scale_factor();
                        let mw = m.size().width as f64 / sc;
                        let mh = m.size().height as f64 / sc;
                        let (pw, ph) = win
                            .outer_size()
                            .map(|z| (z.width as f64 / sc, z.height as f64 / sc))
                            .unwrap_or((720.0, 520.0));
                        // 以屏幕中心为原点：0,0 = 正中间
                        cx = ((mw - pw) / 2.0 + cx as f64).clamp(0.0, (mw - pw).max(0.0)) as i32;
                        cy = ((mh - ph) / 2.0 + cy as f64).clamp(0.0, (mh - ph).max(0.0)) as i32;
                    }
                    let _ = win.set_position(tauri::LogicalPosition::new(cx, cy));
                }
            }

            // 恢复上次的窗口尺寸，并按当前显示器上限裁剪
            for (label, key_w, key_h, def_w, def_h) in [
                ("main", "windowWidth", "windowHeight", 1040, 700),
                ("panel", "panelWidth", "panelHeight", 720, 520),
            ] {
                if let Some(win) = app.get_webview_window(label) {
                    let w = boot_settings
                        .get(key_w)
                        .and_then(|v| v.as_u64())
                        .unwrap_or(def_w) as u32;
                    let h = boot_settings
                        .get(key_h)
                        .and_then(|v| v.as_u64())
                        .unwrap_or(def_h) as u32;
                    let (w, h) = clamp_to_monitor(&win, w, h);
                    let _ = win.set_size(tauri::LogicalSize::new(w, h));
                }
            }

            // 快贴面板：失焦就隐藏。
            // 但只有「真正拿到过焦点」之后才隐藏——否则在抢焦点失败时会瞬间闪没。
            if let Some(panel) = app.get_webview_window("panel") {
                let w = panel.clone();
                let armed = Arc::new(std::sync::atomic::AtomicBool::new(false));
                let a = armed.clone();
                panel.on_window_event(move |e| match e {
                    tauri::WindowEvent::Focused(true) => {
                        a.store(true, std::sync::atomic::Ordering::SeqCst);
                    }
                    tauri::WindowEvent::Focused(false) => {
                        if a.swap(false, std::sync::atomic::Ordering::SeqCst) {
                            let _ = w.hide();
                        }
                    }
                    _ => {}
                });
            }

            // 关主窗口 = 收进托盘，不退出
            if let Some(main) = app.get_webview_window("main") {
                let w = main.clone();
                main.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // 托盘菜单
            let item_show = MenuItem::with_id(app, "show", "打开 Picarium", true, None::<&str>)?;
            let item_panel = MenuItem::with_id(app, "panel", "快贴面板", true, None::<&str>)?;
            let item_clip = MenuItem::with_id(app, "clip", "暂停剪贴板捕获", true, None::<&str>)?;
            let item_quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&item_show, &item_panel, &item_clip, &item_quit])?;
            let paused = app.state::<AppState>().paused.clone();
            let tray_icon = tauri::image::Image::new(include_bytes!("../icons/tray.rgba"), 32, 32);

            TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Picarium · Ctrl+Alt+Space")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event({
                    let paused = paused.clone();
                    let item_clip = item_clip.clone();
                    move |app, event| match event.id.as_ref() {
                        "show" => show_main(app),
                        "panel" => toggle_panel(app),
                        "clip" => {
                            let next = !paused.load(Ordering::Relaxed);
                            paused.store(next, Ordering::Relaxed);
                            let _ = item_clip.set_text(if next {
                                "恢复剪贴板捕获"
                            } else {
                                "暂停剪贴板捕获"
                            });
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // 自测钩子：验证「复制出去不会被自己再收一遍」
            let selftest = std::env::var("PICARIUM_SELFTEST").ok();
            if matches!(
                selftest.as_deref(),
                Some("copy") | Some("file") | Some("files")
            ) {
                let st = app.state::<AppState>();
                let lib = st.lib.clone();
                let gate = st.gate.clone();
                let mode = selftest.unwrap();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    if mode == "files" {
                        let paths: Vec<std::path::PathBuf> = {
                            let guard = lib.lock().unwrap();
                            guard
                                .assets()
                                .iter()
                                .take(3)
                                .map(|a| std::path::PathBuf::from(&a.path))
                                .collect()
                        };
                        match platform::desktop::platform().share_paths(&paths) {
                            Ok(()) => println!("[selftest] files: {} paths", paths.len()),
                            Err(e) => println!("[selftest] files: {e}"),
                        }
                        return;
                    }
                    let path = {
                        let guard = lib.lock().unwrap();
                        guard.assets().first().map(|a| a.path.clone())
                    };
                    let Some(p) = path else { return };
                    if mode == "file" {
                        let _g = gate.acquire();
                        gate.suppress(800);
                        let pb = PathBuf::from(&p);
                        match platform::desktop::platform().share_paths(std::slice::from_ref(&pb)) {
                            Ok(()) => println!("[selftest] file: Ok"),
                            Err(e) => println!("[selftest] file: {e}"),
                        }
                    } else {
                        match picarium_core::load_rgba(Path::new(&p)) {
                            Ok((w, h, bytes)) => {
                                let r = clip_copy(&gate, w, h, &bytes);
                                println!("[selftest] copy: {r:?}");
                            }
                            Err(e) => println!("[selftest] decode: {e:#}"),
                        }
                    }
                });
            }

            // 单实例：收到第二个实例的连接就显示主窗口
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    for _ in singleton.incoming() {
                        show_main(&handle);
                    }
                });
            }

            // 剪贴板捕获线程
            let state = app.state::<AppState>();
            clipboard::spawn(
                app.handle().clone(),
                state.lib.clone(),
                paused.clone(),
                state.gate.clone(),
                state.blacklist.clone(),
            );

            Ok(())
        });
    thumb::register(builder)
        .run(tauri::generate_context!())
        .expect("Picarium 启动失败");
}
