//! 共享命令层：桌面壳和安卓共用（列表、详情、主题、统计、设置读取、分组元数据）。
//!
//! 这里只碰库文件、不碰 Windows 平台能力，所以能完整跑在安卓上。
//! 导入 / 删除 / 剪贴板等平台相关写操作仍留在 `main.rs`。

use std::sync::atomic::Ordering;

use stickerbox_core::Asset;
use tauri::State;

use crate::state::{autostart_enabled, AppState};

const BUILTIN_THEMES: &[(&str, &str)] = &[
    (
        "catppuccin-mocha",
        include_str!("../themes/catppuccin-mocha.json"),
    ),
    (
        "catppuccin-macchiato",
        include_str!("../themes/catppuccin-macchiato.json"),
    ),
    (
        "catppuccin-frappe",
        include_str!("../themes/catppuccin-frappe.json"),
    ),
    (
        "catppuccin-latte",
        include_str!("../themes/catppuccin-latte.json"),
    ),
];

#[tauri::command]
pub fn themes_list(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let root = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.root().to_path_buf()
    };
    let mut out = Vec::new();
    for (id, text) in BUILTIN_THEMES {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(text) {
            if let Some(o) = v.as_object_mut() {
                o.insert("id".into(), serde_json::json!(id));
                o.insert("builtin".into(), serde_json::json!(true));
                out.push(v);
            }
        }
    }
    let dir = root.join("themes");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                != Some("json".into())
            {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            let Some(o) = v.as_object_mut() else { continue };
            if !o.get("colors").map(|c| c.is_object()).unwrap_or(false) {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("custom")
                .to_string();
            o.entry("name")
                .or_insert_with(|| serde_json::json!(id.clone()));
            o.insert("id".into(), serde_json::json!(id));
            o.insert("builtin".into(), serde_json::json!(false));
            out.push(v);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn get_asset(state: State<'_, AppState>, sha: String) -> Result<Asset, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.find(&sha)
        .cloned()
        .ok_or_else(|| "库里找不到这张图".to_string())
}

#[tauri::command]
pub fn list_assets(
    state: State<'_, AppState>,
    q: String,
    group: Option<String>,
    limit: Option<usize>,
    sort: Option<String>,
    filters: Option<String>,
) -> Result<Vec<Asset>, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    let sort = sort.unwrap_or_default();
    let filters_json = filters.and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    if std::env::var("STICKERBOX_FILTER_DEBUG").is_ok() {
        eprintln!("[filter-raw] {:?}", filters_json);
    }
    if std::env::var("STICKERBOX_FILTER_DEBUG").is_ok() {
        eprintln!(
            "[call] q={:?} group={:?} limit={:?} f={:?}",
            q, group, limit, filters_json
        );
    }
    let filters = parse_filters(filters_json);
    if let Some(g) = group.as_deref() {
        let query = q.trim().to_lowercase();
        if g == "__star__" {
            let list = lib.starred();
            let list = lib.ordered("__star__", list);
            let list = apply_query(list, &query, limit);
            let list = apply_filters(list, &filters);
            return Ok(sort_assets(list, &sort, limit));
        }
        if g == "__recent__" {
            // 有筛选词时先取全量，再过滤，避免被 limit 截断后漏掉匹配项
            let list = lib.recent(if query.is_empty() {
                limit.unwrap_or(100)
            } else {
                usize::MAX
            });
            let list = apply_query(list, &query, limit);
            let list = apply_filters(list, &filters);
            return Ok(sort_assets(list, &sort, limit));
        }
    }
    let fetch = if sort.is_empty() {
        limit.unwrap_or(500)
    } else {
        usize::MAX
    };
    let list = lib.search(&q, group.as_deref(), fetch);
    let list = match group.as_deref() {
        Some(g) if !g.is_empty() && !g.starts_with("__") => lib.ordered(g, list),
        _ => list,
    };
    let list = apply_filters(list, &filters);
    Ok(sort_assets(list, &sort, limit))
}

fn sort_assets(mut list: Vec<Asset>, sort: &str, limit: Option<usize>) -> Vec<Asset> {
    match sort {
        "name" => list.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(b.added_at.cmp(&a.added_at))
        }),
        "added" => list.sort_by(|a, b| b.added_at.cmp(&a.added_at)),
        "used" | "recent" => {
            list.sort_by(|a, b| b.used_at.cmp(&a.used_at).then(b.added_at.cmp(&a.added_at)))
        }
        _ => {}
    }
    if let Some(l) = limit {
        list.truncate(l);
    }
    list
}

fn apply_query(list: Vec<Asset>, q: &str, limit: Option<usize>) -> Vec<Asset> {
    let mut out: Vec<Asset> = if q.is_empty() {
        list
    } else {
        list.into_iter()
            .filter(|a| stickerbox_core::match_score(a, q) > 0)
            .collect()
    };
    if let Some(l) = limit {
        out.truncate(l);
    }
    out
}

fn friendly_app(name: &str) -> String {
    match name.to_ascii_lowercase().as_str() {
        "weixin.exe" | "wechat.exe" => "微信".to_string(),
        "qq.exe" | "qqnt.exe" => "QQ".to_string(),
        "telegram.exe" => "Telegram".to_string(),
        "discord.exe" => "Discord".to_string(),
        "snipaste.exe" => "Snipaste".to_string(),
        "explorer.exe" => "资源管理器".to_string(),
        "chrome.exe" => "Chrome".to_string(),
        "msedge.exe" => "Edge".to_string(),
        "firefox.exe" => "Firefox".to_string(),
        _ => name.to_string(),
    }
}

fn source_key(a: &Asset) -> String {
    if a.source == "folder" {
        "folder".to_string()
    } else if a.source_ref.is_empty() {
        a.source.clone()
    } else {
        let app = std::path::Path::new(&a.source_ref)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| a.source_ref.clone());
        format!("{}|{}", a.source, app)
    }
}

#[derive(Default)]
pub struct AssetFilters {
    min_bytes: Option<u64>,
    max_bytes: Option<u64>,
    min_w: Option<u32>,
    max_w: Option<u32>,
    min_h: Option<u32>,
    max_h: Option<u32>,
    exts: Vec<String>,
    tags: Vec<String>,
    source: String,
    source_keys: Vec<String>,
    from: String,
    to: String,
}

pub fn parse_filters(v: Option<serde_json::Value>) -> AssetFilters {
    let mut f = AssetFilters::default();
    let Some(obj) = v.and_then(|x| x.as_object().cloned()) else {
        return f;
    };
    // 0 视为「未设置」：前端空输入会传 0，不能当成真正的阈值
    let num = |k: &str| obj.get(k).and_then(|x| x.as_u64()).filter(|v| *v > 0);
    let text = |k: &str| {
        obj.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    };
    f.min_bytes = num("minBytes");
    f.max_bytes = num("maxBytes");
    f.min_w = num("minWidth").map(|x| x as u32);
    f.max_w = num("maxWidth").map(|x| x as u32);
    f.min_h = num("minHeight").map(|x| x as u32);
    f.max_h = num("maxHeight").map(|x| x as u32);
    f.exts = obj
        .get("exts")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|e| e.as_str())
                .map(|s| s.to_lowercase())
                .collect()
        })
        .unwrap_or_default();
    f.tags = obj
        .get("tags")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|e| e.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();
    f.source = text("source");
    f.source_keys = obj
        .get("sourceKeys")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|e| e.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();
    f.from = text("from");
    f.to = text("to");
    f
}

pub fn apply_filters(list: Vec<Asset>, f: &AssetFilters) -> Vec<Asset> {
    let before = list.len();
    let out: Vec<Asset> = list
        .into_iter()
        .filter(|a| {
            if let Some(x) = f.min_bytes {
                if a.bytes < x {
                    return false;
                }
            }
            if let Some(x) = f.max_bytes {
                if a.bytes > x {
                    return false;
                }
            }
            if let Some(x) = f.min_w {
                if a.width < x {
                    return false;
                }
            }
            if let Some(x) = f.max_w {
                if a.width > x {
                    return false;
                }
            }
            if let Some(x) = f.min_h {
                if a.height < x {
                    return false;
                }
            }
            if let Some(x) = f.max_h {
                if a.height > x {
                    return false;
                }
            }
            if !f.exts.is_empty() && !f.exts.iter().any(|e| e == &a.ext.to_lowercase()) {
                return false;
            }
            if !f.tags.is_empty() && !f.tags.iter().all(|t| a.tags.iter().any(|x| x == t)) {
                return false;
            }
            if !f.source.is_empty() && a.source != f.source {
                return false;
            }
            if !f.source_keys.is_empty() {
                let key = source_key(a);
                if !f.source_keys.iter().any(|k| k == &key) {
                    return false;
                }
            }
            if !f.from.is_empty() && a.added_at.get(..10).unwrap_or("") < f.from.as_str() {
                return false;
            }
            if !f.to.is_empty() && a.added_at.get(..10).unwrap_or("") > f.to.as_str() {
                return false;
            }
            true
        })
        .collect();
    if std::env::var("STICKERBOX_FILTER_DEBUG").is_ok() {
        eprintln!(
            "[filter] before={} after={} exts={:?} tags={:?} maxB={:?} minB={:?}",
            before,
            out.len(),
            f.exts,
            f.tags,
            f.max_bytes,
            f.min_bytes
        );
    }
    out
}

#[tauri::command]
pub fn source_stats(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    let mut map: std::collections::BTreeMap<String, (String, usize)> = Default::default();
    for a in lib.assets() {
        let key = source_key(a);
        let label = match a.source.as_str() {
            "folder" => "本地导入".to_string(),
            "clipboard" => {
                let app = std::path::Path::new(&a.source_ref)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "剪贴板".to_string());
                format!("剪贴板 · {}", friendly_app(&app))
            }
            other => other.to_string(),
        };
        let entry = map.entry(key).or_insert((label, 0));
        entry.1 += 1;
    }
    Ok(map
        .into_iter()
        .map(
            |(key, (label, count))| serde_json::json!({"key": key, "label": label, "count": count}),
        )
        .collect())
}

#[tauri::command]
pub fn group_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    let groups: Vec<serde_json::Value> = lib
        .group_stats()
        .into_iter()
        .map(|(name, count)| serde_json::json!({ "name": name, "count": count }))
        .collect();
    Ok(serde_json::json!({
        "groups": groups,
        "ungrouped": lib.ungrouped_count(),
        "ungroupedNew": lib.ungrouped_new(),
        "starred": lib.starred_count(),
        "recent": lib.recent_count(),
        "total": lib.assets().len(),
    }))
}

#[tauri::command]
pub fn tag_stats(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    Ok(lib
        .tag_stats()
        .into_iter()
        .map(|(name, count)| serde_json::json!({ "name": name, "count": count }))
        .collect())
}

#[tauri::command]
pub fn library_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    serde_json::to_value(lib.stats()).map_err(|e| e.to_string())
}

pub fn settings_file(state: &State<'_, AppState>) -> Result<std::path::PathBuf, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    Ok(lib.root().join("settings.json"))
}

pub fn read_settings_value(path: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let path = settings_file(&state)?;
    let mut v = read_settings_value(&path);
    let root = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if let Some(obj) = v.as_object_mut() {
        obj.insert("root".into(), serde_json::json!(root));
        obj.insert(
            "clipboardEnabled".into(),
            serde_json::json!(!state.paused.load(Ordering::Relaxed)),
        );
        obj.insert("autostart".into(), serde_json::json!(autostart_enabled()));
        obj.insert(
            "version".into(),
            serde_json::json!(env!("CARGO_PKG_VERSION")),
        );
        if let Ok(h) = state.hotkey.lock() {
            obj.insert("hotkey".into(), serde_json::json!(*h));
        }
        if let Ok(h) = state.clip_hotkey.lock() {
            obj.insert("clipHotkey".into(), serde_json::json!(*h));
        }
        if let Ok(b) = state.blacklist.lock() {
            obj.insert("clipboardBlacklist".into(), serde_json::json!(*b));
        }
    }
    Ok(v)
}

#[tauri::command]
pub fn trash_list(
    state: State<'_, AppState>,
    q: Option<String>,
    filters: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    let query = q.unwrap_or_default();
    let items = if query.trim().is_empty() {
        lib.trash()
    } else {
        lib.search_trash(&query)
    };
    let filters_json = filters.and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let f = parse_filters(filters_json);
    let items: Vec<_> = items
        .into_iter()
        .filter(|item| !apply_filters(vec![item.asset.clone()], &f).is_empty())
        .collect();
    Ok(items
        .into_iter()
        .map(|item| {
            serde_json::json!({
                "sha": item.asset.sha,
                "name": item.asset.name,
                "ext": item.asset.ext,
                "bytes": item.asset.bytes,
                "width": item.asset.width,
                "height": item.asset.height,
                "groups": item.asset.groups,
                "tags": item.asset.tags,
                "added_at": item.asset.added_at,
                "animated": item.asset.animated,
                "deleted_at": item.deleted_at,
            })
        })
        .collect())
}

// ---- 分组页：排序 / 封面 / 置顶 ----

#[tauri::command]
pub fn group_list(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    let stats: std::collections::BTreeMap<String, usize> = lib.group_stats().into_iter().collect();
    let pinned = lib.pinned_groups().to_vec();
    let groups: Vec<serde_json::Value> = lib
        .group_order()
        .iter()
        .map(|name| {
            let cover = lib.group_cover(name).map(|s| s.to_string());
            let animated = cover
                .as_deref()
                .and_then(|sha| lib.find(sha))
                .map(|a| a.animated)
                .unwrap_or(false);
            serde_json::json!({
                "name": name,
                "count": stats.get(name).copied().unwrap_or(0),
                "cover": cover,
                "animated": animated,
                "pinned": pinned.iter().any(|p| p == name),
            })
        })
        .collect();
    Ok(serde_json::json!({ "groups": groups, "pinned": pinned }))
}

#[tauri::command]
pub fn set_group_cover(
    state: State<'_, AppState>,
    group: String,
    sha: Option<String>,
) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_group_cover(&group, sha.as_deref())
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn set_group_order(state: State<'_, AppState>, order: Vec<String>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_group_order(&order).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn set_pinned_groups(state: State<'_, AppState>, groups: Vec<String>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_pinned_groups(groups).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn create_group(state: State<'_, AppState>, name: String) -> Result<bool, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.create_group(&name).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn rename_group(state: State<'_, AppState>, old: String, new: String) -> Result<usize, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.rename_group(&old, &new).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn remove_group(
    state: State<'_, AppState>,
    name: String,
    delete_assets: bool,
) -> Result<usize, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.remove_group(&name, delete_assets)
        .map_err(|e| format!("{e:#}"))
}

// ---- 回收站：恢复 / 删除 / 清空 ----

#[tauri::command]
pub fn trash_restore(state: tauri::State<'_, AppState>, sha: String) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.restore(&sha).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn trash_delete(
    state: tauri::State<'_, AppState>,
    sha: String,
    permanent: Option<bool>,
) -> Result<(), String> {
    let path = {
        let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.delete_forever(&sha).map_err(|e| format!("{e:#}"))?
    };
    if let Some(p) = path {
        #[cfg(windows)]
        {
            if permanent.unwrap_or(false) {
                let _ = std::fs::remove_file(&p);
            } else if let Err(e) = crate::recycle::move_to_recycle_bin(&[p]) {
                eprintln!("[trash] {e}");
            }
        }
        #[cfg(not(windows))]
        {
            let _ = permanent;
            let _ = std::fs::remove_file(&p);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn trash_purge(
    state: tauri::State<'_, AppState>,
    permanent: Option<bool>,
) -> Result<usize, String> {
    let paths = {
        let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
        lib.purge_trash().map_err(|e| format!("{e:#}"))?
    };
    let n = paths.len();
    #[cfg(windows)]
    {
        if permanent.unwrap_or(false) {
            for p in &paths {
                let _ = std::fs::remove_file(p);
            }
        } else if let Err(e) = crate::recycle::move_to_recycle_bin(&paths) {
            eprintln!("[trash] {e}");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = permanent;
        for p in &paths {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(n)
}
