//! 搬家：把整个库换到另一个位置。
//!
//! 安全不变式：**指针永远指向一份完整的库**。
//! - 同盘 + 移动：`rename` 瞬时完成，再切指针。
//! - 跨盘 / 复制：复制 → 校验（文件集与大小）→ 切指针 →（移动模式）删旧。
//! - 每一步都写 `config.json` 里的 `move` 日志（原子写）；启动时按 phase 恢复，
//!   中途关软件/断电最多留一份半成品，旧库不受影响。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::config;

/// 全局取消标记：一次只允许一个搬家任务。
pub static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn request_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

#[derive(Clone, Debug)]
pub struct Progress {
    pub phase: &'static str,
    pub files: u64,
    pub bytes: u64,
    pub total_files: u64,
    pub total_bytes: u64,
}

#[derive(Clone, Debug)]
pub struct Outcome {
    pub to: PathBuf,
    pub mode: String,
    /// 旧位置是否已删除（只有 move + 未勾保留旧位置时才可能为 true）。
    pub removed_old: bool,
    /// 旧位置是否保留着。
    pub kept_old: bool,
    /// 搬家前的位置（用于提示/清理旧位置）。
    pub from: PathBuf,
}

/// 统计目录里的文件数与总字节。
pub fn totals(root: &Path) -> std::io::Result<(u64, u64)> {
    fn walk(dir: &Path, files: &mut u64, bytes: &mut u64) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let ft = entry.file_type()?;
            if ft.is_dir() {
                walk(&entry.path(), files, bytes)?;
            } else if ft.is_file() {
                *files += 1;
                *bytes += entry.metadata()?.len();
            }
        }
        Ok(())
    }
    let mut files = 0;
    let mut bytes = 0;
    walk(root, &mut files, &mut bytes)?;
    Ok((files, bytes))
}

fn is_library(root: &Path) -> bool {
    root.join("index.json").is_file() || root.join("blobs").is_dir()
}

fn dir_is_empty(root: &Path) -> bool {
    fs::read_dir(root)
        .map(|mut it| it.next().is_none())
        .unwrap_or(false)
}

fn volume_root(path: &Path) -> Option<PathBuf> {
    for anc in path.ancestors() {
        if anc.parent().is_none() {
            return Some(anc.to_path_buf());
        }
    }
    None
}

pub fn same_drive(a: &Path, b: &Path) -> bool {
    match (volume_root(a), volume_root(b)) {
        (Some(x), Some(y)) => config::same_dir(&x, &y),
        _ => false,
    }
}

#[cfg(windows)]
pub fn free_bytes(path: &Path) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let root = volume_root(path)?;
    let name = HSTRING::from(root.to_string_lossy().as_ref());
    let mut free: u64 = 0;
    unsafe {
        GetDiskFreeSpaceExW(&name, Some(&mut free), None, None).ok()?;
    }
    Some(free)
}

#[cfg(not(windows))]
pub fn free_bytes(_path: &Path) -> Option<u64> {
    None
}

/// 选目标时的预检查（前端已做一遍，这里兜底）。
pub fn validate(from: &Path, to: &Path) -> Result<(u64, u64), String> {
    if from.as_os_str().is_empty() || to.as_os_str().is_empty() {
        return Err("路径为空".into());
    }
    if !to.is_absolute() {
        return Err("请选择绝对路径".into());
    }
    if config::same_dir(from, to) {
        return Err("目标位置就是当前库".into());
    }
    let from_n = from.to_string_lossy().replace('/', "\\").to_lowercase();
    let to_n = to.to_string_lossy().replace('/', "\\").to_lowercase();
    if to_n.starts_with(&format!("{from_n}\\")) {
        return Err("目标位置在当前库里面，请选库外面的目录".into());
    }
    if !is_library(from) {
        return Err("当前库不完整，无法搬家".into());
    }
    if to.exists() {
        let meta = fs::metadata(to).map_err(|e| format!("目标位置不可用：{e}"))?;
        if !meta.is_dir() {
            return Err("目标是一个文件，不是目录".into());
        }
        if !dir_is_empty(to) {
            return Err("目标目录不是空的，请选空目录或新建目录".into());
        }
    }
    if let Some(parent) = to.parent() {
        if !parent.exists() {
            return Err("目标位置的上一级目录不存在".into());
        }
    }
    let (files, bytes) = totals(from).map_err(|e| format!("统计当前库失败：{e}"))?;
    if let Some(free) = free_bytes(to) {
        if free < bytes {
            let diff = bytes - free;
            return Err(format!(
                "空间不足：需要 {}，目标盘只剩 {}，还差 {}",
                human(bytes),
                human(free),
                human(diff)
            ));
        }
    }
    Ok((files, bytes))
}

fn human(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

fn journal(phase: &str, from: &Path, to: &Path, mode: &str) -> std::io::Result<()> {
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let v = serde_json::json!({
        "id": id,
        "from": from.to_string_lossy(),
        "to": to.to_string_lossy(),
        "mode": mode,
        "phase": phase,
    });
    config::set_move_journal(Some(&v))
}

fn copy_tree(
    src: &Path,
    dst: &Path,
    progress: &mut dyn FnMut(u64, u64),
    cancel: &dyn Fn() -> bool,
) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败：{e}"))?;
    let mut files: u64 = 0;
    let mut bytes: u64 = 0;
    fn walk(
        src: &Path,
        dst: &Path,
        files: &mut u64,
        bytes: &mut u64,
        progress: &mut dyn FnMut(u64, u64),
        cancel: &dyn Fn() -> bool,
    ) -> Result<(), String> {
        for entry in fs::read_dir(src).map_err(|e| format!("读取 {} 失败：{e}", src.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            if cancel() {
                return Err("已取消".into());
            }
            let ft = entry.file_type().map_err(|e| e.to_string())?;
            let to_path = dst.join(entry.file_name());
            if ft.is_dir() {
                fs::create_dir_all(&to_path).map_err(|e| format!("创建目录失败：{e}"))?;
                walk(&entry.path(), &to_path, files, bytes, progress, cancel)?;
            } else if ft.is_file() {
                let len = entry.metadata().map_err(|e| e.to_string())?.len();
                fs::copy(entry.path(), &to_path).map_err(|e| {
                    format!("复制 {} 失败：{e}", entry.path().display())
                })?;
                *files += 1;
                *bytes += len;
                progress(*files, *bytes);
            }
        }
        Ok(())
    }
    walk(src, dst, &mut files, &mut bytes, progress, cancel)
}

/// 校验：文件集合、每个文件大小一致。
fn verify(src: &Path, dst: &Path) -> Result<(), String> {
    fn walk(src: &Path, dst: &Path) -> Result<(), String> {
        for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let ft = entry.file_type().map_err(|e| e.to_string())?;
            let other = dst.join(entry.file_name());
            if ft.is_dir() {
                if !other.is_dir() {
                    return Err(format!("目标缺少目录：{}", entry.file_name().to_string_lossy()));
                }
                walk(&entry.path(), &other)?;
            } else if ft.is_file() {
                let a = entry.metadata().map_err(|e| e.to_string())?.len();
                let b = fs::metadata(&other)
                    .map_err(|_| format!("目标缺少文件：{}", entry.file_name().to_string_lossy()))?
                    .len();
                if a != b {
                    return Err(format!(
                        "文件大小不一致：{}（{} vs {}）",
                        entry.file_name().to_string_lossy(),
                        a,
                        b
                    ));
                }
            }
        }
        Ok(())
    }
    walk(src, dst)
}

fn cleanup(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir_all(path);
    }
}

/// 执行搬家。`emit` 用来回报进度；`cancel` 返回 true 时尽快停。
pub fn run(
    from: &Path,
    to: &Path,
    mode: &str,
    keep_old: bool,
    emit: &mut dyn FnMut(Progress),
    cancel: &dyn Fn() -> bool,
) -> Result<Outcome, String> {
    CANCEL.store(false, Ordering::Relaxed);
    let (total_files, total_bytes) = validate(from, to)?;
    emit(Progress {
        phase: "prepare",
        files: 0,
        bytes: 0,
        total_files,
        total_bytes,
    });

    let same = same_drive(from, to);
    if mode == "move" && same {
        journal("rename", from, to, mode).map_err(|e| format!("写搬家日志失败：{e}"))?;
        if to.exists() {
            cleanup(to);
        }
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败：{e}"))?;
        }
        fs::rename(from, to).map_err(|e| {
            let _ = config::set_move_journal(None);
            format!("改名失败：{e}")
        })?;
        journal("renamed", from, to, mode).map_err(|e| format!("写搬家日志失败：{e}"))?;
        emit(Progress {
            phase: "switch",
            files: total_files,
            bytes: total_bytes,
            total_files,
            total_bytes,
        });
        config::save_pointer(to).map_err(|e| format!("写库指针失败：{e}"))?;
        let _ = config::set_move_journal(None);
        return Ok(Outcome {
            to: to.to_path_buf(),
            mode: mode.to_string(),
            removed_old: true,
            kept_old: false,
            from: from.to_path_buf(),
        });
    }

    journal("copying", from, to, mode).map_err(|e| format!("写搬家日志失败：{e}"))?;
    let started = Instant::now();
    let mut last_emit = Instant::now();
    let result = copy_tree(
        from,
        to,
        &mut |files, bytes| {
            if last_emit.elapsed().as_millis() >= 80 || files == total_files {
                last_emit = Instant::now();
                emit(Progress {
                    phase: "copy",
                    files,
                    bytes,
                    total_files,
                    total_bytes,
                });
            }
        },
        cancel,
    );
    if let Err(e) = result {
        cleanup(to);
        let _ = config::set_move_journal(None);
        return Err(e);
    }
    if let Err(e) = verify(from, to) {
        cleanup(to);
        let _ = config::set_move_journal(None);
        return Err(format!("复制后校验失败：{e}"));
    }
    journal("verified", from, to, mode).map_err(|e| format!("写搬家日志失败：{e}"))?;
    emit(Progress {
        phase: "verify",
        files: total_files,
        bytes: total_bytes,
        total_files,
        total_bytes,
    });

    config::save_pointer(to).map_err(|e| format!("写库指针失败：{e}"))?;
    journal("switched", from, to, mode).map_err(|e| format!("写搬家日志失败：{e}"))?;

    let mut removed_old = false;
    if mode == "move" && !keep_old {
        emit(Progress {
            phase: "cleanup",
            files: total_files,
            bytes: total_bytes,
            total_files,
            total_bytes,
        });
        removed_old = fs::remove_dir_all(from).is_ok();
    }
    let _ = config::set_move_journal(None);
    let _ = started;
    Ok(Outcome {
        to: to.to_path_buf(),
        mode: mode.to_string(),
        removed_old,
        kept_old: from.exists(),
        from: from.to_path_buf(),
    })
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Recovery {
    pub kind: String,
    pub from: String,
    pub to: String,
    pub files: u64,
}

/// 启动时检查未完成的搬家，并做掉安全的那一半。
pub fn recover_startup() -> Option<Recovery> {
    let j = config::move_journal()?;
    let phase = j.get("phase").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let from = PathBuf::from(j.get("from").and_then(|v| v.as_str()).unwrap_or(""));
    let to = PathBuf::from(j.get("to").and_then(|v| v.as_str()).unwrap_or(""));
    if from.as_os_str().is_empty() || to.as_os_str().is_empty() {
        let _ = config::set_move_journal(None);
        return None;
    }
    let info = |kind: &str, files: u64| Recovery {
        kind: kind.into(),
        from: from.to_string_lossy().to_string(),
        to: to.to_string_lossy().to_string(),
        files,
    };
    match phase.as_str() {
        "copying" | "verified" => {
            let files = totals(&to).map(|(f, _)| f).unwrap_or(0);
            cleanup(&to);
            let _ = config::set_move_journal(None);
            eprintln!("[move] 上次搬家未完成，已清理目标半成品 {}", to.display());
            Some(info("partial_cleaned", files))
        }
        "rename" => {
            if !from.exists() && to.exists() && is_library(&to) {
                let _ = config::save_pointer(&to);
                let _ = config::set_move_journal(None);
                return Some(info("completed", 0));
            }
            let _ = config::set_move_journal(None);
            Some(info("aborted", 0))
        }
        "renamed" => {
            if to.exists() && is_library(&to) {
                let _ = config::save_pointer(&to);
                let _ = config::set_move_journal(None);
                return Some(info("completed", 0));
            }
            let _ = config::set_move_journal(None);
            Some(info("aborted", 0))
        }
        "switched" => {
            if to.exists() && is_library(&to) {
                let _ = config::save_pointer(&to);
            }
            let _ = config::set_move_journal(None);
            Some(info("switched", 0))
        }
        _ => {
            let _ = config::set_move_journal(None);
            None
        }
    }
}
