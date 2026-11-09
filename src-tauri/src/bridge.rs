//! 浏览器桥：本地 HTTP 服务，让浏览器扩展把图片字节直接送进库。
//!
//! 只监听 `127.0.0.1:17800`，靠 `X-StickerBox-Token` 头鉴权。普通网页跨站
//! fetch 设不了自定义头，所以别的站点没法往库里灌图。
//!
//! 契约见 `docs/28-浏览器插件方案.md` 第 6 节：
//! - `GET /ping` → `200 {"ok":true,"version":"..."}`
//! - `POST /import` → `200 {"ok":true,"sha":"...","added":true}`
//!
//! 入库成功后向主窗发事件：新图发 `library-changed`（沿用剪贴板捕获的刷新
//! 通道），另外无论新旧都发 `bridge-imported`，让前端弹一句提示。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use stickerbox_core::Library;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Request, Response, Server};

/// 固定端口，改这里要同步改扩展的 host_permissions。
pub const PORT: u16 = 17800;

/// 烘焙进两端的共享密钥；扩展侧见 `extension/src/lib/bridge.ts` 的 `TOKEN`。
pub const TOKEN: &str = "stickerbox-local-7f3c9a2e";

/// 请求体上限：10 MB，超了直接 413，避免把内存和库撑爆。
pub const MAX_BODY: usize = 10 * 1024 * 1024;

/// 允许调试时用环境变量换 token（扩展那边也换成同一个值）。
pub fn token() -> String {
    std::env::var("STICKERBOX_BRIDGE_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| TOKEN.to_string())
}

/// 起一个后台线程跑桥。端口被占只告警，不影响 App 本体。
pub fn spawn(lib: Arc<Mutex<Library>>, root: PathBuf, token: String, app: AppHandle) {
    std::thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PORT)) {
            Ok(server) => server,
            Err(e) => {
                eprintln!("[bridge] 端口 {PORT} 绑定失败，浏览器桥不可用: {e}");
                return;
            }
        };
        eprintln!("[bridge] listening on http://127.0.0.1:{PORT}");
        for request in server.incoming_requests() {
            if let Err(e) = handle(&lib, &root, &token, &app, request) {
                eprintln!("[bridge] 请求处理失败: {e}");
            }
        }
    });
}

fn handle(
    lib: &Arc<Mutex<Library>>,
    root: &Path,
    token: &str,
    app: &AppHandle,
    mut request: Request,
) -> std::io::Result<()> {
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("");

    // 预检：扩展带了自定义头，Chrome 会先发 OPTIONS
    if request.method() == &Method::Options {
        return request.respond(
            Response::empty(204)
                .with_header(header("Access-Control-Allow-Origin", "*"))
                .with_header(header("Access-Control-Allow-Headers", "X-StickerBox-Token, Content-Type"))
                .with_header(header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
                .with_header(header("Access-Control-Max-Age", "86400")),
        );
    }

    match (request.method(), path) {
        (&Method::Get, "/ping") => {
            // 探测用，不带 token 也放行（只暴露版本号）
            let body = serde_json::json!({
                "ok": true,
                "version": env!("CARGO_PKG_VERSION"),
            })
            .to_string();
            respond_json(request, 200, &body)
        }
        (&Method::Post, "/import") => {
            if !authorized(request.headers(), token) {
                return respond_json(request, 401, r#"{"ok":false,"error":"invalid token"}"#);
            }
            if let Some(len) = request.body_length() {
                if len > MAX_BODY {
                    return respond_json(
                        request,
                        413,
                        r#"{"ok":false,"error":"payload too large"}"#,
                    );
                }
            }
            let mut body = Vec::new();
            request
                .as_reader()
                .take(MAX_BODY as u64 + 1)
                .read_to_end(&mut body)?;
            if body.len() > MAX_BODY {
                return respond_json(
                    request,
                    413,
                    r#"{"ok":false,"error":"payload too large"}"#,
                );
            }
            let (status, json) = import_payload(lib, root, &body);
            if status == 200 {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    let added = v["added"].as_bool().unwrap_or(false);
                    let sha = v["sha"].as_str().unwrap_or("").to_string();
                    // 新图才需要重拉列表；重复图只弹提示
                    if added {
                        let _ = app.emit("library-changed", ());
                    }
                    let _ = app.emit(
                        "bridge-imported",
                        serde_json::json!({ "sha": sha, "added": added }),
                    );
                }
            }
            respond_json(request, status, &json)
        }
        _ => respond_json(request, 404, r#"{"ok":false,"error":"not found"}"#),
    }
}

fn authorized(headers: &[Header], token: &str) -> bool {
    headers
        .iter()
        .find(|h| h.field.equiv("X-StickerBox-Token"))
        .map(|h| h.value.to_string() == token)
        .unwrap_or(false)
}

#[derive(Deserialize)]
struct ImportRequest {
    ext: String,
    #[serde(default)]
    name: String,
    #[serde(default = "default_source")]
    source: String,
    #[serde(default)]
    source_ref: String,
    data: String,
}

fn default_source() -> String {
    "bridge".to_string()
}

/// 解析并入库；返回 (HTTP 状态码, JSON 响应体)，方便脱离 tiny_http 单测。
pub fn import_payload(lib: &Arc<Mutex<Library>>, root: &Path, body: &[u8]) -> (u16, String) {
    use base64::Engine as _;

    let req: ImportRequest = match serde_json::from_slice(body) {
        Ok(req) => req,
        Err(e) => return err(400, format!("bad json: {e}")),
    };
    let ext = req.ext.trim().to_ascii_lowercase();
    if !stickerbox_core::is_image_ext(&ext) {
        return err(400, format!("unsupported ext: {}", req.ext));
    }
    let data = match base64::engine::general_purpose::STANDARD.decode(req.data.as_bytes()) {
        Ok(data) => data,
        Err(e) => return err(400, format!("bad base64: {e}")),
    };
    if data.is_empty() {
        return err(400, "empty payload".to_string());
    }

    let imported = {
        let mut library = match lib.lock() {
            Ok(library) => library,
            Err(e) => return err(500, format!("library poisoned: {e}")),
        };
        match library.import_media_bytes(
            data,
            &ext,
            &req.name,
            &req.source,
            &req.source_ref,
            Vec::new(),
            Vec::new(),
        ) {
            Ok(imported) => imported,
            Err(e) => return err(500, format!("import failed: {e}")),
        }
    };

    // 缩略图失败不影响入库结果，下次打开库还会补
    if let Err(e) = stickerbox_core::ensure_thumb(root, &imported.sha, &ext) {
        eprintln!("[bridge] 缩略图生成失败 {}: {e}", imported.sha);
    }

    let body = serde_json::json!({
        "ok": true,
        "sha": imported.sha,
        "added": imported.added,
    })
    .to_string();
    (200, body)
}

fn err(status: u16, msg: String) -> (u16, String) {
    (status, serde_json::json!({"ok": false, "error": msg}).to_string())
}

fn header(name: &'static str, value: &'static str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("合法响应头")
}

fn respond_json(request: Request, status: u16, body: &str) -> std::io::Result<()> {
    request.respond(
        Response::from_string(body)
            .with_status_code(status)
            .with_header(header("Content-Type", "application/json; charset=utf-8"))
            .with_header(header("Access-Control-Allow-Origin", "*")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_library(tag: &str) -> (Library, PathBuf) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "stickerbox-bridge-{tag}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        (Library::open(&root).unwrap(), root)
    }

    /// 2x1 的双帧 GIF：足以让 `looks_animated` 判成动图，也能算出宽高。
    fn gif_bytes() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut enc = image::codecs::gif::GifEncoder::new(&mut buf);
            enc.set_repeat(image::codecs::gif::Repeat::Infinite)
                .unwrap();
            for i in 0..2u8 {
                let frame = image::RgbaImage::from_pixel(2, 1, image::Rgba([i * 40, 20, 30, 255]));
                enc.encode_frame(image::Frame::new(frame)).unwrap();
            }
        }
        buf
    }

    #[test]
    fn import_payload_adds_gif_and_dedups() {
        let (library, root) = temp_library("import");
        let lib = Arc::new(Mutex::new(library));
        let body = serde_json::json!({
            "ext": "GIF",
            "name": "桥测试.gif",
            "source": "bilibili",
            "source_ref": "https://i0.hdslb.com/bfs/x.gif",
            "data": base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                gif_bytes(),
            ),
        })
        .to_string();

        let (status, json) = import_payload(&lib, &root, body.as_bytes());
        assert_eq!(status, 200, "{json}");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["added"], true);
        let sha = v["sha"].as_str().unwrap().to_string();

        {
            let guard = lib.lock().unwrap();
            let asset = guard.assets().iter().find(|a| a.sha == sha).unwrap();
            assert!(asset.animated, "GIF 进库必须标成动图");
            assert_eq!(asset.source, "bilibili");
            assert_eq!(asset.source_ref, "https://i0.hdslb.com/bfs/x.gif");
        }

        // 再导一次：同 sha 去重，added=false
        let (status, json) = import_payload(&lib, &root, body.as_bytes());
        assert_eq!(status, 200);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["added"], false);
        assert_eq!(v["sha"].as_str().unwrap(), sha);
    }

    #[test]
    fn import_payload_rejects_bad_ext_and_base64() {
        let (library, root) = temp_library("reject");
        let lib = Arc::new(Mutex::new(library));

        let body = serde_json::json!({"ext": "mp4", "data": "AAAA"}).to_string();
        let (status, json) = import_payload(&lib, &root, body.as_bytes());
        assert_eq!(status, 400, "{json}");

        let body = serde_json::json!({"ext": "png", "data": "not base64!!"}).to_string();
        let (status, _) = import_payload(&lib, &root, body.as_bytes());
        assert_eq!(status, 400);

        assert!(lib.lock().unwrap().assets().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
