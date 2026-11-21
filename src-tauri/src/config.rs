//! 全局配置目录：用户设置、自定义主题、库指针。
//!
//! 和库根目录分开：换库、搬库都不会丢配置。默认位置 `%APPDATA%\Picarium`
//! （安卓是应用私有目录下的 `Config`），可用 `PICARIUM_CONFIG_HOME` 覆盖
//! ——测试脚本必须设置它，免得污染真实配置。
//!
//! 启动顺序：`init_dir()` → 打开库（指针优先）→ `ensure_for_library()` 迁移旧布局。
//! 迁移失败时退回旧布局（设置继续放库根），保证不丢用户配置。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 配置目录（启动时确定一次）。
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 兼容旧布局：迁移失败时设置仍读写库根。
static LEGACY_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 启动时初始化配置目录（桌面在 main，安卓在 setup）。
pub fn init_dir(dir: PathBuf) {
    let _ = CONFIG_DIR.set(dir);
}

/// 默认配置目录。`PICARIUM_CONFIG_HOME` 优先，其次 `%APPDATA%\Picarium`。
pub fn default_dir() -> PathBuf {
    if let Ok(p) = std::env::var("PICARIUM_CONFIG_HOME") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    #[cfg(not(mobile))]
    if let Ok(p) = std::env::var("APPDATA") {
        if !p.trim().is_empty() {
            return PathBuf::from(p).join("Picarium");
        }
    }
    // 兜底：当前目录下（安卓会在 setup 里显式 init 到应用私有目录）
    std::env::current_dir()
        .map(|d| d.join("config"))
        .unwrap_or_else(|_| PathBuf::from("config"))
}

pub fn config_dir() -> PathBuf {
    CONFIG_DIR.get().cloned().unwrap_or_else(default_dir)
}

/// Windows 路径比较：忽略大小写、斜杠方向与末尾分隔符。
///
/// 同一个目录可能以 `C:\a\b`、`C:/a/b`、`c:\A\B\` 三种写法混进最近库，
/// 直接字符串比较会让「当前」标记和去重失效。
pub fn same_dir(a: &Path, b: &Path) -> bool {
    fn norm(p: &Path) -> String {
        let mut s = p.to_string_lossy().replace('/', "\\").to_lowercase();
        while s.len() > 1 && s.ends_with('\\') {
            s.pop();
        }
        s
    }
    norm(a) == norm(b)
}

fn legacy_root() -> Option<&'static PathBuf> {
    LEGACY_ROOT.get()
}

/// 设置文件：配置目录 `settings.json`；迁移失败时退回库根。
pub fn settings_path() -> PathBuf {
    match legacy_root() {
        Some(root) => root.join("settings.json"),
        None => config_dir().join("settings.json"),
    }
}

/// 自定义主题目录。
pub fn themes_dir() -> PathBuf {
    match legacy_root() {
        Some(root) => root.join("themes"),
        None => config_dir().join("themes"),
    }
}

/// 库指针文件（`config.json`）。
pub fn pointer_path() -> PathBuf {
    config_dir().join("config.json")
}

/// 读取指针里的库路径；不存在或格式不对返回 `None`。
pub fn load_pointer() -> Option<PathBuf> {
    let text = std::fs::read_to_string(pointer_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let p = v.get("libraryPath")?.as_str()?.trim();
    if p.is_empty() {
        None
    } else {
        Some(PathBuf::from(p))
    }
}

/// 写指针（原子替换），`recent` 保留最近的库，最多 10 条。
pub fn save_pointer(lib_root: &Path) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let prev = std::fs::read_to_string(pointer_path())
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let mut recent: Vec<String> = prev
        .as_ref()
        .and_then(|v| v.get("recent"))
        .and_then(|r| r.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();
    let cur = lib_root.to_string_lossy().to_string();
    recent.retain(|r| !same_dir(Path::new(r), lib_root));
    recent.insert(0, cur.clone());
    recent.truncate(10);
    let v = serde_json::json!({
        "schema": 1,
        "libraryPath": cur,
        "recent": recent,
    });
    let text = serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".to_string());
    write_atomic(&pointer_path(), &text)
}

/// 最近库列表（按指针文件里的顺序，最多 10 条）。
pub fn recent() -> Vec<String> {
    std::fs::read_to_string(pointer_path())
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("recent").and_then(|r| r.as_array()).cloned())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// 从最近库列表里移除一项（当前库请在调用方拦截）。
pub fn forget_recent(path: &str) -> std::io::Result<()> {
    let text = match std::fs::read_to_string(pointer_path()) {
        Ok(t) => t,
        Err(_) => return Ok(()),
    };
    let mut v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let Some(list) = v.get_mut("recent").and_then(|r| r.as_array_mut()) else {
        return Ok(());
    };
    let want = PathBuf::from(path);
    list.retain(|x| match x.as_str() {
        Some(s) => !same_dir(Path::new(s), &want),
        None => true,
    });
    let text = serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".to_string());
    write_atomic(&pointer_path(), &text)
}

/// 读整个指针文件；不存在或坏掉返回 `None`。
pub fn pointer_json() -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(pointer_path()).ok()?;
    serde_json::from_str(&text).ok()
}

/// 原样写回指针文件（原子）。搬家的 `move` 日志也走这里。
pub fn write_pointer_json(v: &serde_json::Value) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".to_string());
    write_atomic(&pointer_path(), &text)
}

/// 读搬家日志（没有返回 `None`）。
pub fn move_journal() -> Option<serde_json::Value> {
    pointer_json()?
        .get("move")
        .cloned()
        .filter(|v| v.is_object())
}

/// 写/清搬家日志，其余字段（libraryPath/recent）原样保留。
pub fn set_move_journal(journal: Option<&serde_json::Value>) -> std::io::Result<()> {
    let mut v = pointer_json().unwrap_or_else(|| serde_json::json!({ "schema": 1 }));
    let Some(obj) = v.as_object_mut() else {
        return Ok(());
    };
    match journal {
        Some(j) => {
            obj.insert("move".to_string(), j.clone());
        }
        None => {
            obj.remove("move");
        }
    }
    write_pointer_json(&v)
}

fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

/// 首次升级：把库根的旧配置复制到配置目录，然后写指针。
///
/// - 只在指针不存在时迁移；库里的原文件**不删**（旧版本可回退）。
/// - 任何复制失败都退回旧布局，绝不写"半迁移"的指针。
pub fn ensure_for_library(lib_root: &Path) {
    let pointer = load_pointer();
    if let Some(p) = pointer {
        if !same_dir(&p, lib_root) {
            eprintln!(
                "[config] 指针指向 {}，但本次打开的是 {}（保持指针不变）",
                p.display(),
                lib_root.display()
            );
        }
        return;
    }

    let dst_dir = config_dir();
    if let Err(e) = std::fs::create_dir_all(&dst_dir) {
        eprintln!("[config] 建配置目录失败，继续用库内旧布局: {e}");
        let _ = LEGACY_ROOT.set(lib_root.to_path_buf());
        return;
    }

    let mut failed = false;
    let src_settings = lib_root.join("settings.json");
    let dst_settings = dst_dir.join("settings.json");
    if src_settings.is_file() && !dst_settings.exists() {
        match std::fs::copy(&src_settings, &dst_settings) {
            Ok(_) => eprintln!(
                "[config] 迁移设置 {} -> {}",
                src_settings.display(),
                dst_settings.display()
            ),
            Err(e) => {
                eprintln!("[config] 迁移设置失败（继续用库内旧布局）: {e}");
                failed = true;
            }
        }
    }

    let src_themes = lib_root.join("themes");
    if !failed && src_themes.is_dir() {
        let dst_themes = dst_dir.join("themes");
        if let Err(e) = std::fs::create_dir_all(&dst_themes) {
            eprintln!("[config] 建主题目录失败（继续用库内旧布局）: {e}");
            failed = true;
        } else if let Ok(entries) = std::fs::read_dir(&src_themes) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase())
                    != Some("json".into())
                {
                    continue;
                }
                let Some(name) = path.file_name() else { continue };
                let dst = dst_themes.join(name);
                if dst.exists() {
                    continue;
                }
                if let Err(e) = std::fs::copy(&path, &dst) {
                    eprintln!("[config] 迁移主题 {} 失败: {e}", path.display());
                    failed = true;
                }
            }
        }
    }

    if failed {
        let _ = LEGACY_ROOT.set(lib_root.to_path_buf());
        return;
    }

    if let Err(e) = save_pointer(lib_root) {
        eprintln!("[config] 写指针失败（继续用库内旧布局）: {e}");
        let _ = LEGACY_ROOT.set(lib_root.to_path_buf());
    }
}
