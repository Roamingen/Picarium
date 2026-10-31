//! `thumb` 自定义协议：把 sha 换成缩略图或原图字节。
//!
//! 前端用 `convertFileSrc(sha, 'thumb')` 访问，桌面和安卓都是
//! `http://thumb.localhost/<sha>`，所以注册逻辑两边共用一份。

use tauri::Manager;

use crate::state::AppState;

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

fn empty_404() -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    tauri::http::Response::builder()
        .status(404)
        .body(std::borrow::Cow::Owned(Vec::new()))
        .expect("404")
}

/// 把 `thumb` 协议挂到 Builder 上。
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_uri_scheme_protocol("thumb", |ctx, request| {
        let app = ctx.app_handle();
        let sha = request.uri().path().trim_start_matches('/').to_string();
        let want_raw = request
            .uri()
            .query()
            .map(|q| q.split('&').any(|kv| kv == "raw=1"))
            .unwrap_or(false);
        let state = app.state::<AppState>();

        let found = {
            let lib = match state.lib.lock() {
                Ok(l) => l,
                Err(_) => return empty_404(),
            };
            let root = lib.root().to_path_buf();
            if let Some(a) = lib.assets().iter().find(|a| a.sha == sha) {
                Some((root.clone(), lib.blob_path(&a.sha, &a.ext), a.ext.clone()))
            } else if let Some(item) = lib.trash().into_iter().find(|i| i.asset.sha == sha) {
                let src = lib
                    .trash_path()
                    .join(format!("{}.{}", item.asset.sha, item.asset.ext));
                Some((root, src, item.asset.ext))
            } else {
                None
            }
        };

        let Some((root, src, ext)) = found else {
            return empty_404();
        };

        if want_raw {
            return match std::fs::read(&src) {
                Ok(bytes) => tauri::http::Response::builder()
                    .header("Content-Type", mime_for(&ext))
                    .header("Cache-Control", "public, max-age=3600")
                    .body(std::borrow::Cow::Owned(bytes))
                    .expect("raw response"),
                Err(_) => empty_404(),
            };
        }

        match stickerbox_core::ensure_thumb_from(&root, &sha, &src) {
            Ok(path) => match std::fs::read(&path) {
                Ok(bytes) => tauri::http::Response::builder()
                    .header(
                        "Content-Type",
                        if path.extension().and_then(|e| e.to_str()) == Some("jpg") {
                            "image/jpeg"
                        } else {
                            "image/webp"
                        },
                    )
                    .header("Cache-Control", "public, max-age=31536000, immutable")
                    .body(std::borrow::Cow::Owned(bytes))
                    .expect("thumb response"),
                Err(_) => empty_404(),
            },
            Err(e) => {
                eprintln!("[thumb] {sha} ({ext}): {e:#}");
                empty_404()
            }
        }
    })
}
