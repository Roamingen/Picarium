# Third-Party Notices · 第三方许可声明

Picarium（贴屿）本体以根目录 [`LICENSE`](LICENSE)（MIT）授权。本文件列出项目实际内置或分发的第三方作品；它们保留各自的许可，不因本项目的 MIT 授权而改变。

## 1. Catppuccin 配色（内置主题）

- 文件：`src-tauri/themes/catppuccin-mocha.json`、`catppuccin-macchiato.json`、`catppuccin-frappe.json`、`catppuccin-latte.json`
- 来源：<https://github.com/catppuccin/catppuccin>
- 许可：MIT
- 版权：Copyright (c) 2021 Catppuccin

本项目的主题文件只使用 Catppuccin 的配色值，不包含其图标或字体。

```text
MIT License

Copyright (c) 2021 Catppuccin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. Lucide 图标

- 文件：`src-tauri/ui/app.js`（`ICONS` 映射内嵌的 SVG 路径）
- 来源：<https://lucide.dev>、<https://github.com/lucide-icons/lucide>
- 许可：ISC
- 版权：Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## 3. 字体

- 程序不内置字体文件。
- 桌面端默认使用系统字体：`Segoe UI`、`Microsoft YaHei UI`、`Cascadia Code` 等；安卓端默认使用系统通用族（`sans-serif` / `system-ui`）。
- 用户在设置里选择的字体同样来自本机。这些字体随操作系统或用户自行安装，本项目的安装包不分发字体。

## 4. 运行时依赖

- 桌面端用 Tauri 2 构建；编译后的可执行文件包含 Tauri 及其 Rust 依赖（例如 serde、serde_json、sha2、walkdir、anyhow、chrono、pinyin、image、tiny_http、arboard、fontdb、ttf-parser、windows、webview2-com）。这些 crates 的许可以各自 crate 为准，主要为 MIT 或 Apache-2.0；完整版本清单见 `Cargo.lock`。
- Windows 上使用系统自带的 WebView2 运行时，不随本项目分发。
- 安卓端的系统组件（Android SDK、NDK、JNI）由系统或构建工具提供，不随本项目重新分发。

## 5. 浏览器扩展

- `extension/src` 的构建工具（esbuild、TypeScript、`@types/chrome`）只用于开发，不进入 `extension/dist/` 产物。
- `extension/dist/` 只包含本项目源码的编译结果，不捆绑第三方运行时库。

## 更新约定

新增第三方素材（图标、主题、字体、代码片段、图片）时，请同时在本文件登记来源、许可和版权行；发版前核对 `Cargo.lock` 与 `extension/package-lock.json`。
