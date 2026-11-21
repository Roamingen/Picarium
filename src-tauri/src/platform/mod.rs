//! 平台能力边界。
//!
//! 桌面和安卓的差别不只是「有没有某个 API」，而是三类场景的形态不一样：
//!
//! - **交出去**：桌面写系统剪贴板（CF_HDROP，GIF 动画能保住）；安卓没有等价的
//!   图片剪贴板，只能走 ACTION_SEND 分享面板 —— 所以这里叫 [`ShareOut`] 而不是
//!   `Clipboard`，接口按「把文件交给别的 App」来设计。
//! - **进相册 / 出相册**：安卓的「保存」是写 MediaStore 的 Pictures/Picarium，
//!   「选图」走 Photo Picker（Android 13+ 免权限）；桌面分别对应「导出到文件夹」
//!   和文件选择器。
//! - **收进来**：安卓靠 ACTION_SEND 接到别人分享的图；桌面没有这个入口，靠剪贴板
//!   监听（那个是 Windows 专属，暂留在 `clipboard.rs`）。
//!
//! 本层先只放签名，实现按平台 cfg 挂载：桌面 [`desktop`]，安卓 [`android`]。
//! 桌面侧目前只落地了 [`ShareOut`] 和 [`Opener`]（对应已有功能），
//! [`Gallery`] / [`FilePicker`] / [`ShareTarget`] 是给 M2 留的位置。

#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// 把文件交给别的 App。
///
/// 桌面 = 写系统剪贴板，用户随后在微信/QQ 里 Ctrl+V；
/// 安卓 = 拉起系统分享面板（ACTION_SEND / ACTION_SEND_MULTIPLE）。
pub trait ShareOut {
    /// 交出一批文件。空列表视为错误。
    ///
    /// 交「文件」而不是位图：GIF 动画只有这条路能保住。
    fn share_paths(&self, paths: &[PathBuf]) -> Result<(), String>;
}

/// 系统相册：存进去、从里面选。
pub trait Gallery {
    /// 存一份到系统相册（桌面 = 导出到用户选的文件夹）。
    /// `name` 是写进相册的显示文件名（带扩展名）。
    fn save_to_gallery(&self, path: &Path, name: &str) -> Result<(), String>;

    /// 从系统相册选图（桌面 = 文件选择器；安卓 = Photo Picker）。
    fn pick_from_gallery(&self) -> Result<Vec<PathBuf>, String>;

    /// 从系统文件选择器选图（安卓 = SAF，能保留原始文件名）。
    fn pick_from_files(&self) -> Result<Vec<PathBuf>, String>;
}

/// 系统文件选择器。导入图片、选导出目录都走它。
pub trait FilePicker {
    /// 选若干张图片；用户取消返回 `Ok(vec![])`。
    fn pick_images(&self) -> Result<Vec<PathBuf>, String>;

    /// 选一个目录；用户取消返回 `Ok(None)`。
    fn pick_folder(&self) -> Result<Option<PathBuf>, String>;
}

/// 接收系统其他应用分享进来的图（安卓 ACTION_SEND / ACTION_SEND_MULTIPLE）。
pub trait ShareTarget {
    /// 取出本次分享进来的文件；没有分享则返回空列表。
    fn take_shared(&self) -> Result<Vec<PathBuf>, String>;
}

/// 用系统默认程序打开一个文件。
pub trait Opener {
    fn open(&self, path: &Path) -> Result<(), String>;
}

#[cfg(windows)]
pub mod desktop;

#[cfg(target_os = "android")]
pub mod android;
