<p align="center">
  <img src="assets/readme/banner.svg" alt="Picarium · 贴屿 — Together. Instant. Everywhere." width="100%">
</p>

# Picarium · 贴屿

**Together. Instant. Everywhere.**<br>
A cross-platform sticker hub.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android%20%7C%20Chrome-4D6BFE?style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-CE422B?style=flat-square&logo=rust&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
[![license: MIT](https://img.shields.io/badge/license-MIT-4D6BFE?style=flat-square)](LICENSE)
[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

Picarium（picture + -arium，放图片的收藏馆）是一个本地优先的贴纸库。Windows 桌面端和 Android 共用一套 Rust 核心和同一种「普通文件夹」式的库格式；Chrome 扩展把 B 站图片存进桌面端的库。它不读取聊天软件的私有数据，只通过剪贴板、系统分享和文件导入，把表情包变成随时能搜、能贴的个人资产。中文名「贴屿」取「贴纸的小岛」之意。

## 功能

- **快贴面板**：`Ctrl+Alt+Space` 唤起，输入名称或拼音，方向键选择，回车复制，回到聊天窗口 `Ctrl+V`。不需要给任何聊天软件装插件。
- **导入与去重**：扫描文件夹、拖拽图片、复制图片自动入库（资源管理器除外）；原图按内容哈希存放，重复导入不会重复占空间。
- **搜索与整理**：名称 / 拼音过滤，分组、标签、收藏、最近使用和回收站。
- **主题**：内置深 / 浅色与 Catppuccin 配色；库内 `themes/*.json` 可放自定义主题。
- **B 站扩展**：评论图和大图悬停出现 `+`，右键菜单可复制或保存到本地库；需要桌面端在运行。
- **Android 分享**：从其他 App 分享图片到 Picarium，浏览、搜索后再分享出去，也可以保存到相册。
- **本地优先**：没有账号和云同步，图片不上传；库就是普通文件夹，复制即备份。

## 当前状态

| 平台 | 版本 | 状态 |
|---|---|---|
| Windows 10 / 11 | 0.14.1 | Windows 11 已验证；Windows 10 待验证 |
| Android arm64 | 0.4.1 | 分享导入 / 浏览 / 再分享 |
| Chrome 扩展 | 0.5.3 | B 站图片导入；Manifest V3 |

这是早期开发版：数据格式、命令和界面都可能变化，升级前建议先备份库。当前还没有公开的安装包；Windows 安装包、Android APK 和扩展 zip 会在公开发布后补下载入口。

<!-- TODO: 公开发布前补三端截图 / GIF、GitHub Releases 下载链接与 CI 徽章 -->

## 构建与运行

桌面端需要 Windows 10 / 11、Rust stable（MSVC 工具链）和 WebView2（Windows 11 通常自带；Windows 10 可能需要安装）。扩展与 Android CLI 需要 Node.js。

### Windows 桌面端

```powershell
cargo run -p stickerbox
```

首次启动会在 `%USERPROFILE%\StickerBox` 建库；设置页可以看到当前库路径。改位置用 `STICKERBOX_HOME`。

测试：

```powershell
cargo test -p stickerbox-core
pwsh -NoProfile -File scripts/accept.ps1
```

`scripts/accept.ps1` 是 Windows 端到端自测，会构建、跑核心测试和前端断言，约几分钟。

发布构建：

```powershell
cargo build --release -p stickerbox
```

> 仓库内部的 crate / 可执行文件名仍是 `stickerbox`；用户可见名已改为 Picarium，身份迁移会单独处理。

### Chrome 扩展

```bash
cd extension
npm install
npm run build
```

然后在 `chrome://extensions` 开启开发者模式，选择「加载已解压的扩展程序」，指向 `extension/dist`。打开 B 站页面即可使用；扩展需要本机桌面端在运行。

```bash
npm test
npm run typecheck
```

### Android

需要 Android SDK / NDK / JDK，release 包还需要签名配置；完整步骤见 [docs/25-安卓构建、签名与模拟器.md](docs/25-安卓构建、签名与模拟器.md)。只发布 arm64-v8a：

```bash
npx tauri android build --apk --target aarch64 --ci
```

调试包与模拟器步骤见同一份文档和 [docs/26-安卓模拟器速查.md](docs/26-安卓模拟器速查.md)。

## 数据与备份

库是一个普通文件夹：

```text
index.json                 索引与分组 / 标签等元数据
blobs/ab/cd/<sha>.<ext>    原图，按内容哈希存放
thumbs/                    缩略图
trash/                     回收站
settings.json              当前库的设置
themes/*.json              自定义主题
```

默认路径是 `%USERPROFILE%\StickerBox`；设置 `STICKERBOX_HOME` 可以换到任意目录。当前版本仍沿用 `StickerBox` 目录名，后续身份迁移会迁到 Picarium，并保留数据。

备份：退出应用后复制整个库文件夹即可；恢复时放回原位，或用 `STICKERBOX_HOME` 指过去。

## 隐私

- 不读取微信、QQ 等聊天软件的私有数据；导入只走剪贴板、系统分享和文件。
- 没有账号、没有云同步，图片不会上传到服务器。
- 桌面端和手机端各自本地保存；Chrome 扩展只在本机把图片交给桌面端，桌面端不在运行时不会入库。
- 剪贴板捕获可以在设置里关闭；从资源管理器复制文件不会触发入库。

## 更多文档

- [开发导航](docs/27-开发导航.md) — 各模块在哪、怎么验证
- [安卓构建、签名与模拟器](docs/25-安卓构建、签名与模拟器.md)
- [品牌与标识](docs/29-品牌与标识.md) — Picarium / 贴屿 的命名与文案

## License

代码以 [MIT](LICENSE) 授权，Copyright (c) 2026 Ming Sun。

Catppuccin（MIT）、Lucide（ISC）等第三方作品的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
