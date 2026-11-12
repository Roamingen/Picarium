# StickerBox 浏览器导入扩展

在 B 站评论区把鼠标移到图片上（或点开大图），右下角出现 `+`，点开选「存入 StickerBox」；也可以右键图片 →「存入 StickerBox」。视频封面/推荐位不会出钮。图片（含 GIF/动画 WebP）直接进本地库，动画保真。

## 构建

```bash
cd extension
npm install
npm run build      # 产物在 dist/（含 manifest.json）
npm run typecheck  # 可选
npm test           # 可选：URL 归一化/格式嗅探/base64/按钮几何单测
```

## 加载

1. 先启动桌面端 StickerBox（桥只在桌面端启动）。
2. Chrome 打开 `chrome://extensions`，右上角「开发者模式」。
3. 「加载已解压的扩展程序」选 **`extension/dist/`**（不是 `extension/`）。
4. 打开任意 B 站页面，把鼠标移到评论区 ≥48px 的图上（或点开大图），右下角出现 `+`，点开选「存入 StickerBox」；或直接右键图片。钮上 `✓` 已入库、`−` 库里已有、`!` 失败（悬停看原因），右键路径仍看扩展图标角标。

> 改代码后重新 `npm run build`，在 `chrome://extensions` 点扩展卡片上的「重新加载」。

## 工作原理

- `background.ts` 创建右键菜单（`documentUrlPatterns` 限定 `https://*.bilibili.com/*`，别的网站不显示）；点击后取 `info.srcUrl`，页面钮则走 `{type:"save",url}` 消息，两条入口共用 `saveImage`。
- `content.ts` + `lib/overlay.ts` 管页面悬浮钮：Shadow DOM 隔离样式，只跟 ≥48px 的图；钮贴右下角（避开大图查看器的右上角关闭钮），菜单优先向上展开、放不下再翻转，P4/P5 先以禁用项占位。**只对评论图/查看器出钮**：B 站评论区是开放 Shadow DOM（`<bili-comments>`），用事件的 `composedPath()` 穿透；评论图 URL 走 `/bfs/new_dyn/`，视频封面（`/bfs/archive/` 等）不匹配，所以不会冒加号。
- `lib/media.ts` 剥掉 B 站 CDN 的 `@320w_200h.webp` 后缀拿原图 URL，抓字节后按文件头嗅探 gif/webp/png/jpg。
- `lib/bridge.ts` 把 base64 POST 到 `http://127.0.0.1:17800/import`，带 `X-StickerBox-Token`。
- 桥校验 token → core `import_media_bytes` 入库（自动标动图）→ `ensure_thumb` 生成缩略图 → 发事件让桌面端实时刷新并弹「已存入」提示（重复导入提示「已经在库里了」）。

## 约定与调试

- token 是两端烘焙的固定值：Rust `src-tauri/src/bridge.rs::TOKEN`、扩展 `src/lib/bridge.ts::TOKEN`，改要一起改并重新构建。
- Rust 侧可用环境变量 `STICKERBOX_BRIDGE_TOKEN` 临时换 token（扩展侧需同步改）。
- 探测桥是否在跑：`curl http://127.0.0.1:17800/ping` → `{"ok":true,"version":"0.12.1"}`。
- 单次上限 10 MB，超限桥返回 413，扩展也会先拦。
- 端口 17800 被占用时桌面端只打印告警，桥不可用，不影响 App 本体；token/端口可配还没做。
- 卡住时看扩展的 Service Worker 控制台：`chrome://extensions` → 扩展卡片 →「Service Worker」。
- 改完 content script 一定要在 `chrome://extensions` 点「重新加载」，再刷新 B 站页面；headless Chrome 不注入 unpacked 扩展的 content script，别用无头浏览器验页面钮。
