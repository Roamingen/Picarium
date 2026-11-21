//! 共享命令层：桌面壳和安卓共用（列表、详情、主题、统计、设置读取、分组元数据）。
//!
//! 这里只碰库文件、不碰 Windows 平台能力，所以能完整跑在安卓上。
//! 导入 / 删除 / 剪贴板等平台相关写操作仍留在 `main.rs`。

use std::sync::atomic::Ordering;

use picarium_core::Asset;
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
    if std::env::var("PICARIUM_FILTER_DEBUG").is_ok() {
        eprintln!("[filter-raw] {:?}", filters_json);
    }
    if std::env::var("PICARIUM_FILTER_DEBUG").is_ok() {
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

#[tauri::command]
pub fn set_asset_order(
    state: State<'_, AppState>,
    key: String,
    shas: Vec<String>,
) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_order(&key, shas).map_err(|e| format!("{e:#}"))
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
        "oldest" => list.sort_by(|a, b| a.added_at.cmp(&b.added_at)),
        "size" => list.sort_by(|a, b| b.bytes.cmp(&a.bytes)),
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
            .filter(|a| picarium_core::match_score(a, q) > 0)
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
    /// 面板的 # 搜索：每组内任一命中即可，组间是 AND
    tag_groups: Vec<Vec<String>>,
    /// 面板的 -# 排除
    not_tags: Vec<String>,
    /// 面板的 @ 搜索：同上
    group_groups: Vec<Vec<String>>,
    not_groups: Vec<String>,
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
    let str_list = |k: &str| {
        obj.get(k)
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|e| e.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default()
    };
    let group_list = |k: &str| {
        obj.get(k)
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|g| g.as_array())
                    .map(|g| {
                        g.iter()
                            .filter_map(|e| e.as_str())
                            .map(|s| s.to_string())
                            .collect::<Vec<String>>()
                    })
                    .filter(|v| !v.is_empty())
                    .collect::<Vec<Vec<String>>>()
            })
            .unwrap_or_default()
    };
    f.tag_groups = group_list("tagGroups");
    f.not_tags = str_list("notTags");
    f.group_groups = group_list("groupGroups");
    f.not_groups = str_list("notGroups");
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
            // 面板的 #/@ 语法：一组前缀命中的名字之间 OR，多个 token 之间 AND
            if !f.tag_groups.is_empty()
                && !f
                    .tag_groups
                    .iter()
                    .all(|g| g.iter().any(|t| a.tags.iter().any(|x| x == t)))
            {
                return false;
            }
            if f.not_tags.iter().any(|t| a.tags.iter().any(|x| x == t)) {
                return false;
            }
            if !f.group_groups.is_empty()
                && !f
                    .group_groups
                    .iter()
                    .all(|g| g.iter().any(|x| a.groups.iter().any(|y| y == x)))
            {
                return false;
            }
            if f.not_groups.iter().any(|g| a.groups.iter().any(|x| x == g)) {
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
    if std::env::var("PICARIUM_FILTER_DEBUG").is_ok() {
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
    let starred_bytes: u64 = lib
        .assets()
        .iter()
        .filter(|a| a.starred)
        .map(|a| a.bytes)
        .sum();
    Ok(serde_json::json!({
        "groups": groups,
        "ungrouped": lib.ungrouped_count(),
        "ungroupedNew": lib.ungrouped_new(),
        "starred": lib.starred_count(),
        "starred_bytes": starred_bytes,
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

/// 批量加标签：core 会 trim/去空/去重，已存在的标签不会重复写
#[tauri::command]
pub fn add_tags(state: State<'_, AppState>, shas: Vec<String>, tags: Vec<String>) -> Result<usize, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.add_tags(&shas, tags).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn remove_tags(state: State<'_, AppState>, shas: Vec<String>, tags: Vec<String>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.remove_tags(&shas, &tags).map_err(|e| format!("{e:#}"))
}

/// 详情页单图保存：整组替换这张图的标签
#[tauri::command]
pub fn set_asset_tags(state: State<'_, AppState>, sha: String, tags: Vec<String>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_asset_tags(&sha, tags).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn create_tag(state: State<'_, AppState>, name: String) -> Result<bool, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.create_tag(&name).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn rename_tag(state: State<'_, AppState>, old: String, new: String) -> Result<usize, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.rename_tag(&old, &new).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn merge_tags(state: State<'_, AppState>, from: String, to: String) -> Result<usize, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.merge_tags(&from, &to).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, name: String) -> Result<usize, String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.delete_tag(&name).map_err(|e| format!("{e:#}"))
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
pub fn set_fonts(state: State<'_, AppState>, fonts: serde_json::Value) -> Result<(), String> {
    if !fonts.is_object() {
        return Err("字体设置必须是对象".into());
    }
    let path = settings_file(&state)?;
    let mut cur = read_settings_value(&path);
    let Some(obj) = cur.as_object_mut() else {
        return Err("设置文件格式无效".into());
    };
    obj.insert("fonts".into(), fonts);
    // 运行时字段不落盘
    obj.remove("root");
    obj.remove("version");
    let text = serde_json::to_string_pretty(&cur).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("写入字体设置失败：{e}"))?;
    Ok(())
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
    let mut bytes: std::collections::BTreeMap<String, u64> = Default::default();
    for a in lib.assets() {
        for g in &a.groups {
            *bytes.entry(g.clone()).or_default() += a.bytes;
        }
    }
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
            let cover_path = cover
                .as_deref()
                .and_then(|sha| lib.find(sha))
                .map(|a| a.path.clone());
            serde_json::json!({
                "name": name,
                "count": stats.get(name).copied().unwrap_or(0),
                "bytes": bytes.get(name).copied().unwrap_or(0),
                "cover": cover,
                "cover_path": cover_path,
                "animated": animated,
                "pinned": pinned.iter().any(|p| p == name),
            })
        })
        .collect();
    let starred_cover = lib.starred_cover().map(|s| s.to_string());
    let starred_bytes: u64 = lib
        .assets()
        .iter()
        .filter(|a| a.starred)
        .map(|a| a.bytes)
        .sum();
    Ok(serde_json::json!({
        "groups": groups,
        "pinned": pinned,
        "starred_cover": starred_cover,
        "starred_bytes": starred_bytes,
    }))
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
pub fn set_starred_cover(
    state: State<'_, AppState>,
    sha: Option<String>,
) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_starred_cover(sha.as_deref())
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

/// 删除一张图（移进回收站）
#[tauri::command]
pub fn delete_asset(state: State<'_, AppState>, sha: String) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.remove(&sha).map_err(|e| format!("{e:#}"))
}

/// 批量收藏 / 取消收藏
#[tauri::command]
pub fn batch_star(state: State<'_, AppState>, shas: Vec<String>, on: bool) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_star(&shas, on).map_err(|e| format!("{e:#}"))
}

/// 回收站保留天数
#[tauri::command]
pub fn get_trash_days(state: State<'_, AppState>) -> Result<u32, String> {
    let lib = state.lib.lock().map_err(|e| e.to_string())?;
    Ok(lib.trash_days())
}

/// 设置回收站保留天数（1–365）
#[tauri::command]
pub fn set_trash_days(state: State<'_, AppState>, days: u32) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.set_trash_days(days).map_err(|e| format!("{e:#}"))
}

/// 分享到系统：桌面 = 复制到剪贴板，安卓 = 拉起系统分享面板。
#[tauri::command]
pub fn share_assets(state: State<'_, AppState>, shas: Vec<String>) -> Result<(), String> {
    use crate::platform::ShareOut;
    let paths: Vec<std::path::PathBuf> = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        shas.iter()
            .filter_map(|s| lib.find(s))
            .map(|a| std::path::PathBuf::from(&a.path))
            .collect()
    };
    if paths.is_empty() {
        return Err("没有可分享的图片".to_string());
    }
    #[cfg(windows)]
    {
        crate::platform::desktop::platform().share_paths(&paths)
    }
    #[cfg(target_os = "android")]
    {
        crate::platform::android::platform().share_paths(&paths)
    }
}

/// 存到系统相册（安卓写 MediaStore；桌面端请用导出功能）。
#[tauri::command]
pub fn save_to_gallery(state: State<'_, AppState>, sha: String) -> Result<(), String> {
    let (path, display) = {
        let lib = state.lib.lock().map_err(|e| e.to_string())?;
        let a = lib.find(&sha).ok_or_else(|| "图片不存在".to_string())?;
        let display = if a.name.trim().is_empty() {
            std::path::Path::new(&a.path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("picarium")
                .to_string()
        } else {
            format!("{}.{}", a.name.trim(), a.ext)
        };
        (std::path::PathBuf::from(&a.path), display)
    };
    #[cfg(target_os = "android")]
    {
        use crate::platform::Gallery;
        crate::platform::android::platform().save_to_gallery(&path, &display)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (path, display);
        Err("桌面端请用导出功能".to_string())
    }
}

/// 打开系统相册多选图片；返回已拷到缓存目录的本地路径（安卓专用）。
#[tauri::command]
pub fn pick_gallery_images() -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        use crate::platform::Gallery;
        let paths = crate::platform::android::platform().pick_from_gallery()?;
        Ok(paths
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("桌面端请用拖拽或导入按钮".to_string())
    }
}

/// 打开系统文件选择器多选图片；返回已拷到缓存目录的本地路径（安卓专用）。
#[tauri::command]
pub fn pick_file_images() -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        use crate::platform::Gallery;
        let paths = crate::platform::android::platform().pick_from_files()?;
        Ok(paths
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("桌面端请用拖拽或导入按钮".to_string())
    }
}

/// 批量导入本地文件/目录（手机端相册导入、分享收件箱共用），返回统计。
#[tauri::command]
pub fn import_paths_simple(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    use std::path::Path;

    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for p in &paths {
        let path = Path::new(p);
        if path.is_dir() {
            picarium_core::collect_images(path, &mut files);
        } else if picarium_core::image_ext(path).is_some() {
            files.push(path.to_path_buf());
        }
    }

    let total = files.len();
    let mut added = 0usize;
    let mut duplicated = 0usize;
    let mut errors = 0usize;
    for file in &files {
        let imported = {
            let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
            lib.import_file(file)
        };
        match imported {
            Ok(Some(sha)) => {
                added += 1;
                let root = {
                    let lib = state.lib.lock().map_err(|e| e.to_string())?;
                    lib.root().to_path_buf()
                };
                let ext = picarium_core::image_ext(file).unwrap_or_default();
                let _ = picarium_core::ensure_thumb(&root, &sha, &ext);
            }
            Ok(None) => duplicated += 1,
            Err(e) => {
                errors += 1;
                eprintln!("[import] {}: {e:#}", file.display());
            }
        }
    }
    Ok(serde_json::json!({
        "total": total, "added": added, "duplicated": duplicated, "errors": errors
    }))
}

/// 取走「分享到 Picarium」的图片（安卓）；桌面没有系统分享入口，返回空。
#[tauri::command]
pub fn take_shared_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        let paths = crate::platform::ShareTarget::take_shared(&crate::platform::android::platform())?;
        Ok(paths
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn add_to_group(state: State<'_, AppState>, shas: Vec<String>, group: String) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.add_group(&shas, &group).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn batch_ungroup(state: State<'_, AppState>, shas: Vec<String>, group: String) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.remove_from_group(&shas, &group).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn clear_groups(state: State<'_, AppState>, shas: Vec<String>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    lib.clear_groups(&shas).map_err(|e| format!("{e:#}"))
}

/// 把「用过」写进 used_at：分享 / 存相册 / 复制都会让图进「最近」
#[tauri::command]
pub fn mark_used(state: State<'_, AppState>, shas: Vec<String>) -> Result<(), String> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    for sha in &shas {
        lib.touch_used(sha).map_err(|e| format!("{e:#}"))?;
    }
    Ok(())
}
