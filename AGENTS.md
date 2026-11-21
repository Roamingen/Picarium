# Picarium · 项目工作守则（AGENTS.md）

> 这个文件每个新对话都会读。**保持短**，细节放 `docs/`，别在这里堆历史。

## 0. 先读这几份

1. 最新交接：`docs/交接-<日期>.md`（当前是 `docs/交接-2026-11-20.md`）
2. 待办与路线：`docs/11-待办.md`、`docs/19-安卓路线.md`、`docs/24-安卓移植进展.md`
3. 开发导航：`docs/27-开发导航.md`（改哪个板块、先看哪、怎么验证，先查这里）

读完先复述「现在在哪、下一步是什么」，再动手。

## 1. 分段交付（硬规则，优先级最高）

- **一轮只做 1 个可验收的小批**，最多 2 个强相关小步；做完就停，等用户审。
- **禁止一口气干完一天/一份大计划**。用户明确说过：审起来痛苦、烧钱、容易失控。
- 每批开始前用一句话说明：这批改什么、验证什么、预计动哪些文件。
- 每批结束必须给：改了什么 + 怎么验证 + 结果 + 下一批建议。
- 遇到需要连续 3 批以上的任务，先拆成清单让用户选，不要自动连做。
- 用户说“推进计划”时，默认只做**计划里的第一批**，不是整份计划。

## 2. 验证阶梯（按批选最小代价）

| 改动 | 最低验证 |
|---|---|
| 只改 JS/CSS | `node --check src-tauri/ui/app.js` + 隐藏 CDP 单点检查（见 2.1） |
| 改 Rust | `cargo build -p picarium`（必要时 `cargo test -p picarium-core`） |
| UI 行为/键盘/筛选 | 跑 `pwsh -NoProfile -File scripts/accept.ps1` |
| 性能/虚拟滚动 | `pwsh -NoProfile -File scripts/perf.ps1` |
| 准备发版/交付 | `scripts/accept.ps1 -Shots` + `scripts/install-release.ps1` |

- 完整验收一天最多 1–2 次；不要每批都跑 3 分钟的 accept。
- 截图只在需要看视觉时跑，别每批都 `-Shots`。
- 长日志不要整段 `cat`，用 `grep`/`tail` 定位。

### 2.1 测试窗口纪律（硬规则）

- 自动化验证默认**不显示、不聚焦任何窗口**：不按全局热键、不调用 show/focus/bringToFront、不启动可见窗口。
- 优先用 `startHidden`（或 `Start-Process -WindowStyle Hidden`）+ WebView2 CDP，在**隐藏页面**里断言。实测隐藏窗口的 WebView2 页面仍可 `Runtime.evaluate`，两个 Picarium 窗口 `IsWindowVisible=false`。
- 起隐藏应用的固定做法：`PICARIUM_HOME=临时库`，设置 `startHidden: true`，加 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333 --remote-allow-origins=*"`，**不要按 Ctrl+Alt+Space**；直接对 `panel.html` / `tauri.localhost` 页面 eval。
- 面板隐藏时页面没冻结：直接调 `search('')` / `render()` / `paint()` 验证，不需要先弹出来。**禁止**用“Escape + 全局热键”的 ensure 逻辑抢前台。
- 截图只用 CDP `Page.captureScreenshot` 或 `.tools/shot_main.ps1`（纯截图）；不要为了截图把窗口弹出来。
- 确实需要用户看见窗口时，先问一句；测完立即隐藏。

## 3. 不要做

- 不读微信/QQ 等软件私有数据；只做剪贴板/文件/分享入口。
- 不引入 WASM/DLL/脚本插件运行时（除非用户明确批准）。
- 不在用户真实库 `C:\Users\13066\Picarium` 上做删除/批量测试；测试用 `PICARIUM_HOME` 临时库。
- 不擅自改用户全局配置；必须改时先备份并明确告知（Gradle 代理已有先例：`~/.gradle/gradle.properties.bak-stickerbox`）。
- 不重复跑 release 构建；release 只在交付/装机器时跑。
- 不用 `scripts/android-emu.ps1` 起模拟器（会弹终端）；不关用户正在用的模拟器。
- 不为了“顺手”扩大范围；发现别的问题先记到交接，不要立刻开修。

## 4. 项目速览

```
crates/core/        纯 Rust：索引、blob、搜索、排序、导入（桌面/安卓共用）
extension/          B站导入扩展（MV3 + TS + esbuild；构建产物 dist/ 加载进 Chrome）
src-tauri/          Tauri 2 壳（原 app/，已改名）
  src/main.rs       桌面入口 + Windows 专属命令（托盘/热键/剪贴板/写操作）
  src/lib.rs        共享库入口；安卓 run() 在此，旁边是 platform/state/commands/thumb
  ui/               共享前端 HTML/CSS/JS（无框架）
  gen/android/      tauri android init 生成，别手改
scripts/            accept.ps1 / perf.ps1 / install-release.ps1
docs/               设计、路线、验收、交接
```

- 数据：`index.json` + `blobs/ab/cd/<sha>.<ext>` + `thumbs/` + `trash/`（库根只有数据）
- 全局配置：`%APPDATA%\Picarium\`（`config.json` 库指针 + `settings.json` + `themes/`；安卓在应用私有目录 `PicariumConfig/`；测试用 `PICARIUM_CONFIG_HOME` 隔离）
- 前端状态：`app.js` 单文件（约 4k 行），无构建步骤
- 主题：内置深/浅 + Catppuccin 四套 + `%APPDATA%\Picarium\themes/*.json` 自定义
- 图标：内嵌 Lucide SVG（`ICONS` 映射）
- 当前验收：**165 条前端断言 + 22 条 core 测试 + 5 条浏览器桥单测 + 11 条扩展单测**；性能：3000 张首屏约 0.7s / 70 节点

## 5. 常用命令

```powershell
cargo build -p picarium                 # debug 桌面
cargo build --release -p picarium       # release（GUI 子系统，无终端）
cargo test -p picarium-core
pwsh -NoProfile -File scripts/accept.ps1
pwsh -NoProfile -File scripts/install-release.ps1
```

**起桌面端看效果时别用 pwsh / Start-Process**（会闪终端窗口，用户明确嫌烦）。和安卓模拟器一样，用 `ops_bash` 后台直跑 exe：

```bash
# 用临时库，别碰用户的真实库
export PICARIUM_HOME="$TEMP/picarium-verify/lib"
"$LOCALAPPDATA/PicariumBuild/target/debug/picarium.exe" > .demo/app.out.log 2>&1 &
```

要看某个状态就传 `PICARIUM_UI_STATE`（如 `tagmanage`、`filters`、`settings:keys`）；截图跑 `.tools/shot_main.ps1 <输出路径>`（纯截图，不弹窗），图存 `.demo/`。

安卓（仅在用户明确要做 M2 时）：

```bash
export ANDROID_HOME="${ANDROID_HOME:-${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk}"
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
# 起模拟器：ops_bash 后台直接跑 emulator（不要用 scripts/android-emu.ps1，会弹终端；起来后别关）
"$ANDROID_HOME/emulator/emulator.exe" -avd Medium_Phone_API_35 -no-boot-anim -gpu swiftshader_indirect > .demo/emulator.out.log 2>&1
npx tauri android build --debug --apk --target x86_64 --ci
npx tauri android build --apk --target aarch64 --ci        # release（已配签名，只打 arm64）
```

**发版只打 arm64-v8a**（`--target aarch64`），不要 universal：四个 ABI 各塞一份 ~11 MB 的 `libpicarium_lib.so`，包会从 13.5 MB 涨到 48 MB。只有明确要发布到 GitHub Release 或单独要某个架构时，才**按架构分别**出包，不做 all-in-one。

模拟器、签名、打包与验收的完整步骤见 **`docs/25-安卓构建、签名与模拟器.md`**（含「同 AVD 已在运行」等常见错误）；日常起模拟器只看 **`docs/26-安卓模拟器速查.md`**（用 `ops_bash` 后台直接跑 emulator，别用 ps1、别拼 adb 路径）。**模拟器起来后不要关**，用户还要在上面测。

注意：`~/.gradle/gradle.properties` 里的代理已注释（代理 7890 当时没开）；Gradle wrapper 已指向腾讯镜像。开代理后可自行恢复。

## 6. 什么时候换新对话

**应该换：**

- 一个里程碑验收通过、交接写完（例如现在）；
- 测试全绿但上下文已经很长/开始变贵；
- 要切换大方向（桌面 → 安卓、交互 → 数据层）；
- 同一路径连续两次失败，需要换脑子；
- 准备做架构级重构（先交接，再在新对话里慢慢拆）。

**不必换：**

- 小 bug 修复、只读问答；
- 还没验收完的半成品（先收尾再换）；
- 只是“想跑一次验收”。

判据：**下一件事能否在 1–2 批内完成、当前上下文还够不够**。不够就交接。

## 7. 交接规则

- 换对话前更新 `docs/交接-<日期>.md`（模板见 `docs/交接模板.md`）；
- 必须记录：稳定点、已完成、下一步第一批、验证命令与结果、已知坑、用户偏好；
- 新对话第一句建议：
  > 读 `AGENTS.md` 和 `docs/交接-2026-11-20.md`，复述现状与下一步；只做第一批，做完停下等我审。

## 8. 提交规范（Conventional Commits）

- 格式：`<type>(<scope>): <摘要>`；摘要用中文、一行说清做什么。
- 常用 type：`feat` 新功能、`fix` 修 bug、`refactor` 不改行为的重构、`chore` 构建/杂务、`docs` 文档、`test` 测试。
- scope 用模块名：`android`、`core`、`ui`、`platform`、`git` 等。
- **commit 前先汇报、等用户点头**；不要自己连着提交。
- 一个对话可以多个 commit，但同一件事的改动要聚合，且必须验证到边界（该跑的测试/截图/回归都跑完）再提交。
- 一批一个 commit；body 写「为什么 + 关键验证结果」，不写流水账。
- **不往 git 里加图片/二进制**（截图、APK、录屏）：体积会永久留在历史里。新截图一律放 `.demo/`（已 gitignore）或系统临时目录，用 `present` 给用户看；`docs/` 不再保留测试截图。
- **中间产物 mock 不进 git**：v1/v2… 过渡稿在提交前归档到 `docs/mock/archive/`（该目录已 gitignore），`docs/mock/` 只留最终稿；归档文件不参与构建/验收。
- 例：`feat(android): 只读命令层与 thumb 协议搬进 lib crate`

## 9. 前端/UI 改动必须先进预览

- 任何界面（PC 或手机）的改动，**先出 HTML 预览**（放 `docs/mock/`），给用户看完、点头后再写实现。**默认只交 HTML，不主动出截图**；用户明确要看图时才用 Chrome headless 截到 `.demo/`。
- 禁止"一拍脑袋"直接改 `mobile.js` / `app.js` / CSS 上线；小修（颜色、文案、间距）也要在汇报里说明改了什么，必要时附对比图。

## 10. 发版与版本号

- 格式 `0.MINOR.PATCH`（1.0 之前）：一批功能落地 → MINOR+1（PATCH 归零）；修 bug / 小改 → PATCH+1。**功能做完就改，不要攒到发版**。PC 与安卓各自独立，允许不同号，只增不减。
- 版本真源（脚本只读这里，别散记）：
  - PC：`src-tauri/tauri.conf.json` 的 `version`；`src-tauri/Cargo.toml` 的 `version` 由脚本同步成同一个数（设置页显示的是 Cargo 版本）
  - 安卓：`src-tauri/tauri.android.conf.json` 的 `version`；`bundle.android.versionCode` 显式给码，公式 `major*1000000 + minor*1000 + patch`
  - 扩展：`extension/manifest.json` 的 `version`（Chrome 读它）；`extension/package.json` 必须同步同一个数，`release.ps1` 会校验
- **当前版本：PC `0.16.0` / 安卓 `0.6.0` / 扩展 `0.6.0`（2026-11-21）**——升完版本号要同步改这一行。
- 固定产物目录（本机，已 gitignore，不入库）：
  - `release/pc/Picarium-<ver>-win-x64.exe`
  - `release/android/Picarium-<ver>-arm64-v8a.apk`
  - `release/extension/Picarium-extension-<ver>.zip`
  - `release/versions.json`：pc / android / extension 各段版本、构建时间、sha256
- 一条命令出包（只在交付 / 装自己机器时跑，平时别跑 release）：

  ```powershell
  pwsh -NoProfile -File scripts/release.ps1 -Target all -Bump minor
  ```

  `-Target pc|android|extension|all`；不带 `-Bump` 就按当前版本重出；`-DryRun` 只打印计划不出包；`-BumpOnly` 只升号写配置、不构建（功能落地先升号时用）。PC 步骤 = release 构建 + 覆盖 `%LOCALAPPDATA%\Picarium\Picarium.exe` + 迁移桌面快捷方式/修 HKCU 开机自启 + 清空旧 `%LOCALAPPDATA%\StickerBox`；`install-release.ps1` 保留成「只更新本机」的快捷方式（内部转调 release.ps1 -Target pc）。
- 安卓只打 `aarch64`，不做 universal；首次出安卓包后核对 `aapt2 dump badging` 里的 versionName/versionCode 是否等于配置值。
