//! 浏览器桥：本地 HTTP 服务，让浏览器扩展把图片字节直接送进库。
//!
//! 只监听 `127.0.0.1:17800`，靠 `X-StickerBox-Token` 头鉴权。普通网页跨站
//! fetch 设不了自定义头，所以别的站点没法往库里灌图。
//!
//! 契约见 `docs/28-浏览器插件方案.md` 第 6 节：
//! - `GET /ping` → `200 {"ok":true,"version":"..."}`
//! - `POST /import` → `200 {"ok":true,"sha":"...","added":true}`
//! - `POST /copy` → `200 {"ok":true,"sha":"..."}`（把库里的原文件放进剪贴板）
//! - `POST /copy-raw` → `200 {"ok":true}`（不落库，字节写成临时文件再进剪贴板）
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

use crate::platform::ShareOut;

/// 固定端口，改这里要同步改扩展的 host_permissions。
pub const PORT: u16 = 17800;

/// 烘焙进两端的共享密钥；扩展侧见 `extension/src/lib/bridge.ts` 的 `TOKEN`。
pub const TOKEN: &str = "stickerbox-local-7f3c9a2e";

/// 请求体上限：10 MB，超了直接 413，避免把内存和库撑爆。
pub const MAX_BODY: usize = 10 * 1024 * 1024;

/// /copy-raw 的请求体：base64 比原字节大约 1.33 倍，留够 10 MB 原图。
const RAW_MAX_BODY: usize = 14 * 1024 * 1024;

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
                    // 复制流程会先入库再 /copy，别让桌面端弹「已存入」误导用户
                    let quiet = serde_json::from_slice::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|q| q.get("quiet").and_then(|v| v.as_bool()))
                        .unwrap_or(false);
                    // 新图才需要重拉列表；重复图只弹提示
                    if added {
                        let _ = app.emit("library-changed", ());
                    }
                    if !quiet {
                        let _ = app.emit(
                            "bridge-imported",
                            serde_json::json!({ "sha": sha, "added": added }),
                        );
                    }
                }
            }
            respond_json(request, status, &json)
        }
        (&Method::Post, "/copy") => {
            if !authorized(request.headers(), token) {
                return respond_json(request, 401, r#"{"ok":false,"error":"invalid token"}"#);
            }
            // 请求体只有 sha，给个宽松上限防止被灌
            if let Some(len) = request.body_length() {
                if len > 4096 {
                    return respond_json(
                        request,
                        413,
                        r#"{"ok":false,"error":"payload too large"}"#,
                    );
                }
            }
            let mut body = Vec::new();
            request.as_reader().take(4097).read_to_end(&mut body)?;
            let req: CopyRequest = match serde_json::from_slice(&body) {
                Ok(req) => req,
                Err(e) => {
                    let (status, json) = err(400, format!("bad json: {e}"));
                    return respond_json(request, status, &json);
                }
            };
            let (status, json) = copy_payload(lib, &req.sha);
            respond_json(request, status, &json)
        }
        (&Method::Post, "/copy-raw") => {
            if !authorized(request.headers(), token) {
                return respond_json(request, 401, r#"{"ok":false,"error":"invalid token"}"#);
            }
            if let Some(len) = request.body_length() {
                if len > RAW_MAX_BODY {
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
                .take(RAW_MAX_BODY as u64 + 1)
                .read_to_end(&mut body)?;
            if body.len() > RAW_MAX_BODY {
                return respond_json(
                    request,
                    413,
                    r#"{"ok":false,"error":"payload too large"}"#,
                );
            }
            let (status, json) = copy_raw_payload_from_json(&body);
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

#[derive(Deserialize)]
struct CopyRequest {
    sha: String,
}

/// 在库里找资产并解析出 blob 路径；找不到或文件已丢返回 None。
fn resolve_asset_path(lib: &Arc<Mutex<Library>>, sha: &str) -> Option<(PathBuf, String)> {
    let library = lib.lock().ok()?;
    let asset = library.find(sha)?;
    let path = library.blob_path(sha, &asset.ext);
    if !path.is_file() {
        return None;
    }
    Some((path, asset.name.clone()))
}

/// 把库里的原文件放进系统剪贴板（CF_HDROP），微信/QQ 粘贴得到文件而不是一帧位图。
pub fn copy_payload(lib: &Arc<Mutex<Library>>, sha: &str) -> (u16, String) {
    let sha = sha.trim();
    if sha.is_empty() {
        return err(400, "missing sha".to_string());
    }
    let Some((path, name)) = resolve_asset_path(lib, sha) else {
        return err(404, "asset not found".to_string());
    };
    match crate::platform::desktop::platform().share_paths(std::slice::from_ref(&path)) {
        Ok(()) => (
            200,
            serde_json::json!({"ok": true, "sha": sha, "name": name}).to_string(),
        ),
        Err(e) => err(500, format!("copy failed: {e}")),
    }
}

#[derive(Deserialize)]
struct RawCopyRequest {
    ext: String,
    #[serde(default)]
    name: String,
    data: String,
}

/// 「仅复制」：不写库，把字节落到临时文件再 CF_HDROP，动画 GIF 也能原样粘贴。
pub fn copy_raw_payload_from_json(body: &[u8]) -> (u16, String) {
    let req: RawCopyRequest = match serde_json::from_slice(body) {
        Ok(req) => req,
        Err(e) => return err(400, format!("bad json: {e}")),
    };
    let (status, json) = copy_raw_payload(&req.ext, &req.name, &req.data);
    (status, json)
}

pub fn copy_raw_payload(ext: &str, name: &str, data: &str) -> (u16, String) {
    use base64::Engine as _;

    let ext = ext.trim().to_ascii_lowercase();
    if !stickerbox_core::is_image_ext(&ext) {
        return err(400, format!("unsupported ext: {ext}"));
    }
    let bytes = match base64::engine::general_purpose::STANDARD.decode(data.as_bytes()) {
        Ok(bytes) => bytes,
        Err(e) => return err(400, format!("bad base64: {e}")),
    };
    if bytes.is_empty() {
        return err(400, "empty payload".to_string());
    }

    let path = match write_copy_file(&bytes, &ext, name) {
        Ok(path) => path,
        Err(e) => return err(500, format!("write temp failed: {e}")),
    };
    match crate::platform::desktop::platform().share_paths(std::slice::from_ref(&path)) {
        Ok(()) => (200, serde_json::json!({"ok": true, "name": path.file_name().unwrap_or_default().to_string_lossy()}).to_string()),
        Err(e) => err(500, format!("copy failed: {e}")),
    }
}

/// 临时文件目录：剪贴板里存的是路径，文件不能在粘贴前删掉，所以按天清理旧文件。
fn copy_dir() -> PathBuf {
    std::env::temp_dir().join("StickerBox-copies")
}

fn write_copy_file(bytes: &[u8], ext: &str, name: &str) -> std::io::Result<PathBuf> {
    let dir = copy_dir();
    std::fs::create_dir_all(&dir)?;
    prune_copies(&dir);

    let stem = safe_stem(name).unwrap_or_else(|| "stickerbox".to_string());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = dir.join(format!("{stem}-{nanos}.{ext}"));
    std::fs::write(&path, bytes)?;
    Ok(path)
}

fn safe_stem(name: &str) -> Option<String> {
    let raw = name.trim();
    if raw.is_empty() {
        return None;
    }
    // 只去掉最后一个扩展名；URL 里带的 / 和 : 交给下面统一换成 _
    let stem = raw.rsplit_once('.').map(|(head, _)| head).unwrap_or(raw);
    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .take(60)
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn prune_copies(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(7 * 24 * 3600));
    let Some(cutoff) = cutoff else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| t < cutoff)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn err(status: u16, msg: String) -> (u16, String) {    (status, serde_json::json!({"ok": false, "error": msg}).to_string())
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

    #[test]
    fn copy_raw_rejects_bad_input() {
        let (status, _) = copy_raw_payload("mp4", "x", "AAAA");
        assert_eq!(status, 400);
        let (status, _) = copy_raw_payload("gif", "x", "not base64!!");
        assert_eq!(status, 400);
        let (status, _) = copy_raw_payload("gif", "x", "");
        assert_eq!(status, 400);
    }

    #[test]
    fn write_copy_file_keeps_ext_and_cleans_name() {
        let path = write_copy_file(b"GIF89a", "gif", "评论 图/坏:名字.gif").unwrap();
        assert!(path.is_file());
        assert_eq!(path.extension().unwrap(), "gif");
        assert!(path.file_name().unwrap().to_string_lossy().starts_with("评论 图_坏_名字-"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn resolve_asset_path_finds_imported_blob() {
        let (library, root) = temp_library("resolve");
        let lib = Arc::new(Mutex::new(library));
        let body = serde_json::json!({
            "ext": "gif",
            "name": "复制测试.gif",
            "data": base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                gif_bytes(),
            ),
        })
        .to_string();
        let (status, json) = import_payload(&lib, &root, body.as_bytes());
        assert_eq!(status, 200, "{json}");
        let sha = serde_json::from_str::<serde_json::Value>(&json).unwrap()["sha"]
            .as_str()
            .unwrap()
            .to_string();

        let (path, name) = resolve_asset_path(&lib, &sha).expect("刚入库的文件必须能解析到");
        assert!(path.is_file(), "blob 应该真实存在：{}", path.display());
        assert_eq!(name, "复制测试");
        assert!(resolve_asset_path(&lib, "不存在的sha").is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}
