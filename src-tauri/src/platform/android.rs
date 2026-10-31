//! Android 实现（骨架）：本批全部返回「尚未实现」。
//!
//! 只在 `target_os = "android"` 下编译，桌面构建不会碰到它。
//! 注意安卓的形态和桌面不同：
//! - 没有可用的图片剪贴板 → `ShareOut` 走系统分享面板，不模拟 Ctrl+V；
//! - 「保存」写 MediaStore，「选图」走 Photo Picker（13+ 免权限）；
//! - 收图只靠用户从别的 App「分享到 StickerBox」。

use std::path::{Path, PathBuf};

use super::{FilePicker, Gallery, Opener, ShareOut, ShareTarget};

/// 安卓平台句柄。
#[derive(Debug, Clone, Copy, Default)]
pub struct Android;

/// 取平台句柄。
pub fn platform() -> Android {
    Android
}

fn unsupported(what: &str) -> String {
    format!("{what}在安卓上尚未实现（M2 阶段移植）")
}

impl ShareOut for Android {
    fn share_paths(&self, _paths: &[PathBuf]) -> Result<(), String> {
        // TODO(M2): Intent.ACTION_SEND / SEND_MULTIPLE + FileProvider content:// URI。
        // 安卓没有「写文件到剪贴板再粘贴」的等价能力，这里就是分享面板。
        Err(unsupported("分享文件"))
    }
}

impl Gallery for Android {
    fn save_to_gallery(&self, _path: &Path) -> Result<(), String> {
        // TODO(M2): MediaStore.Images，写 Pictures/StickerBox；
        // Android 10+ 免 WRITE_EXTERNAL_STORAGE，10 以下才要权限。
        Err(unsupported("保存到相册"))
    }

    fn pick_from_gallery(&self) -> Result<Vec<PathBuf>, String> {
        // TODO(M2): PickVisualMedia（Photo Picker），不用申请相册读取权限。
        Err(unsupported("从相册选图"))
    }
}

impl FilePicker for Android {
    fn pick_images(&self) -> Result<Vec<PathBuf>, String> {
        // TODO(M2): ACTION_OPEN_DOCUMENT + takePersistableUriPermission。
        Err(unsupported("选择图片"))
    }

    fn pick_folder(&self) -> Result<Option<PathBuf>, String> {
        // TODO(M2): ACTION_OPEN_DOCUMENT_TREE。
        Err(unsupported("选择目录"))
    }
}

impl ShareTarget for Android {
    fn take_shared(&self) -> Result<Vec<PathBuf>, String> {
        // TODO(M2): 读 intent 里的 EXTRA_STREAM，拷进库再返回本地路径。
        Ok(Vec::new())
    }
}

impl Opener for Android {
    fn open(&self, _path: &Path) -> Result<(), String> {
        // TODO(M2): FileProvider URI + ACTION_VIEW。
        Err(unsupported("用其他应用打开"))
    }
}
