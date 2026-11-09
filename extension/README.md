# StickerBox 浏览器导入扩展（MVP）

在 B 站页面右键图片 →「存入 StickerBox」，图片（含 GIF/动画 WebP）直接进本地库，动画保真。

## 构建

```bash
cd extension
npm install
npm run build      # 产物在 dist/（含 manifest.json）
npm run typecheck  # 可选
npm test           # 可选：URL 归一化/格式嗅探/base64 单测
```

## 加载

1. 先启动桌面端 StickerBox（桥只在桌面端启动）。
2. Chrome 打开 `chrome://extensions`，右上角「开发者模式」。
3. 「加载已解压的扩展程序」选 **`extension/dist/`**（不是 `extension/`）。
4. 打开任意 B 站页面，右键一张 GIF/图片 →「存入 StickerBox」。角标 `✓` 已入库、`=` 库里已有、`!` 失败（悬停图标看原因）。

> 改代码后重新 `npm run build`，在 `chrome://extensions` 点扩展卡片上的「重新加载」。

## 工作原理

- `background.ts` 创建右键菜单（`documentUrlPatterns` 限定 `https://*.bilibili.com/*`，别的网站不显示）；点击后取 `info.srcUrl`。
- `lib/media.ts` 剥掉 B 站 CDN 的 `@320w_200h.webp` 后缀拿原图 URL，抓字节后按文件头嗅探 gif/webp/png/jpg。
- `lib/bridge.ts` 把 base64 POST 到 `http://127.0.0.1:17800/import`，带 `X-StickerBox-Token`。
- 桥校验 token → core `import_media_bytes` 入库（自动标动图）→ `ensure_thumb` 生成缩略图 → 发事件让桌面端实时刷新并弹「已存入」提示（重复导入提示「已经在库里了」）。

## 约定与调试

- token 是两端烘焙的固定值：Rust `src-tauri/src/bridge.rs::TOKEN`、扩展 `src/lib/bridge.ts::TOKEN`，改要一起改并重新构建。
- Rust 侧可用环境变量 `STICKERBOX_BRIDGE_TOKEN` 临时换 token（扩展侧需同步改）。
- 探测桥是否在跑：`curl http://127.0.0.1:17800/ping` → `{"ok":true,"version":"0.12.0"}`。
- 单次上限 10 MB，超限桥返回 413，扩展也会先拦。
- 端口 17800 被占用时桌面端只打印告警，桥不可用，不影响 App 本体；P3 再做端口可配。
- 卡住时看扩展的 Service Worker 控制台：`chrome://extensions` → 扩展卡片 →「Service Worker」。
