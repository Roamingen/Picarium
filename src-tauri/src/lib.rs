//! Picarium 库入口：桌面的 `main.rs` 和安卓的 `mobile_entry_point` 共用这里。
//!
//! - `platform`：平台能力边界（分享进出、相册、文件选择、打开）
//! - `state`：跨平台共享状态 `AppState`
//! - `commands`：共享命令层（列表/详情/统计/设置/分组元数据）
//! - `thumb`：`thumb://` 缩略图协议
//! - `clipboard` / `recycle`：Windows 专属

/// Windows 剪贴板监听 + 写入（Windows 专属：剪贴板序号、前台窗口进程名）。
#[cfg(windows)]
pub mod clipboard;

/// 只读命令层：桌面和安卓共用。
pub mod commands;

/// 浏览器桥：本地 HTTP 服务，只桌面挂（安卓用分享进入，不需要）。
#[cfg(not(mobile))]
pub mod bridge;

/// 平台能力边界（每个平台一份实现）。
pub mod platform;

/// Windows 系统回收站（第二层保险）。
#[cfg(windows)]
pub mod recycle;

/// 跨平台共享状态。
pub mod state;

/// `thumb://` 缩略图协议。
pub mod thumb;

#[cfg(mobile)]
#[tauri::mobile_entry_point]
pub fn run() {
    use tauri::Manager;

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let roots = state::candidate_roots(app.handle());
            let lib = state::open_library_from(&roots)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(state::AppState::new(lib));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_assets,
            commands::set_asset_order,
            commands::get_asset,
            commands::themes_list,
            commands::library_stats,
            commands::group_stats,
            commands::source_stats,
            commands::tag_stats,
            commands::delete_asset,
            commands::batch_star,
            commands::get_trash_days,
            commands::set_trash_days,
            commands::trash_list,
            commands::trash_restore,
            commands::trash_delete,
            commands::trash_purge,
            commands::get_settings,
            commands::set_fonts,
            commands::group_list,
            commands::set_group_cover,
            commands::set_starred_cover,
            commands::add_tags,
            commands::remove_tags,
            commands::set_asset_tags,
            commands::create_tag,
            commands::rename_tag,
            commands::merge_tags,
            commands::delete_tag,
            commands::add_to_group,
        commands::batch_ungroup,
        commands::clear_groups,
        commands::mark_used,
            commands::set_group_order,
            commands::set_pinned_groups,
            commands::create_group,
            commands::rename_group,
            commands::remove_group,
            commands::share_assets,
            commands::save_to_gallery, commands::pick_gallery_images, commands::pick_file_images, commands::import_paths_simple, commands::take_shared_paths
        ]);

    thumb::register(builder)
        .run(tauri::generate_context!())
        .expect("Picarium mobile 启动失败");
}
