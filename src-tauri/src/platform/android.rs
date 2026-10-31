//! Android 实现：分享面板 + MediaStore 相册写入已接通，其余仍是骨架。
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

/// 根据扩展名猜 MIME（分享面板 / MediaStore 都要用）。
fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "image/*",
    }
}

/// 取当前 Activity，跑一段 JNI 调用；Java 抛异常时转成 Err。
fn with_activity<T>(
    f: impl FnOnce(&mut jni::JNIEnv, &jni::objects::JObject) -> Result<T, String>,
) -> Result<T, String> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm() as *mut jni::sys::JavaVM) }
        .map_err(|e| format!("获取 JavaVM 失败：{e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach JNI 失败：{e}"))?;
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context() as jni::sys::jobject) };
    let out = f(&mut env, &activity);
    if let Ok(true) = env.exception_check() {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err("安卓系统调用抛出异常".to_string());
    }
    out
}

impl ShareOut for Android {
    fn share_paths(&self, paths: &[PathBuf]) -> Result<(), String> {
        use jni::objects::{JObject, JValue};

        if paths.is_empty() {
            return Err("没有要分享的文件".to_string());
        }
        if paths.len() > 500 {
            return Err("一次最多分享 500 张".to_string());
        }
        let mime = mime_of(&paths[0]);
        with_activity(|env, activity| {
            let arr = env
                .new_object_array(paths.len() as i32, "java/lang/String", JObject::null())
                .map_err(|e| format!("创建分享数组失败：{e}"))?;
            for (i, p) in paths.iter().enumerate() {
                let s = env
                    .new_string(p.to_string_lossy())
                    .map_err(|e| format!("路径转字符串失败：{e}"))?;
                env.set_object_array_element(&arr, i as i32, &s)
                    .map_err(|e| format!("写入分享数组失败：{e}"))?;
            }
            let mime_j = env
                .new_string(mime)
                .map_err(|e| format!("MIME 转字符串失败：{e}"))?;
            env.call_static_method(
                "dev/stickerbox/desktop/ShareBridge",
                "shareFiles",
                "(Landroid/content/Context;[Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    JValue::Object(activity),
                    JValue::Object(&arr),
                    JValue::Object(&mime_j),
                ],
            )
            .map_err(|e| format!("打开系统分享面板失败：{e}"))?;
            Ok(())
        })
    }
}

impl Gallery for Android {
    fn save_to_gallery(&self, path: &Path) -> Result<(), String> {
        use jni::objects::JValue;

        let mime = mime_of(path);
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("stickerbox.png")
            .to_string();
        let full = path.to_string_lossy().to_string();
        with_activity(|env, activity| {
            let pj = env
                .new_string(full)
                .map_err(|e| format!("路径转字符串失败：{e}"))?;
            let nj = env
                .new_string(name)
                .map_err(|e| format!("文件名转字符串失败：{e}"))?;
            let mj = env
                .new_string(mime)
                .map_err(|e| format!("MIME 转字符串失败：{e}"))?;
            env.call_static_method(
                "dev/stickerbox/desktop/ShareBridge",
                "saveToGallery",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    JValue::Object(activity),
                    JValue::Object(&pj),
                    JValue::Object(&nj),
                    JValue::Object(&mj),
                ],
            )
            .map_err(|e| format!("写入相册失败：{e}"))?;
            Ok(())
        })
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
