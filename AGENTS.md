# StickerBox · 项目工作守则（AGENTS.md）

> 这个文件每个新对话都会读。**保持短**，细节放 `docs/`，别在这里堆历史。

## 0. 先读这两份

1. 最新交接：`docs/交接-<日期>.md`（当前是 `docs/交接-2026-10-31.md`）
2. 待办与路线：`docs/11-待办.md`、`docs/19-安卓路线.md`、`docs/24-安卓移植进展.md`

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
| 只改 JS/CSS | `node --check src-tauri/ui/app.js` + 打开应用截图/单点检查 |
| 改 Rust | `cargo build -p stickerbox`（必要时 `cargo test -p stickerbox-core`） |
| UI 行为/键盘/筛选 | 跑 `pwsh -NoProfile -File scripts/accept.ps1` |
| 性能/虚拟滚动 | `pwsh -NoProfile -File scripts/perf.ps1` |
| 准备发版/交付 | `scripts/accept.ps1 -Shots` + `scripts/install-release.ps1` |

- 完整验收一天最多 1–2 次；不要每批都跑 3 分钟的 accept。
- 截图只在需要看视觉时跑，别每批都 `-Shots`。
- 长日志不要整段 `cat`，用 `grep`/`tail` 定位。

## 3. 不要做

- 不读微信/QQ 等软件私有数据；只做剪贴板/文件/分享入口。
- 不引入 WASM/DLL/脚本插件运行时（除非用户明确批准）。
- 不在用户真实库 `C:\Users\13066\StickerBox` 上做删除/批量测试；测试用 `STICKERBOX_HOME` 临时库。
- 不擅自改用户全局配置；必须改时先备份并明确告知（Gradle 代理已有先例：`~/.gradle/gradle.properties.bak-stickerbox`）。
- 不重复跑 release 构建；release 只在交付/装机器时跑。
- 不为了“顺手”扩大范围；发现别的问题先记到交接，不要立刻开修。

## 4. 项目速览

```
crates/core/        纯 Rust：索引、blob、搜索、排序、导入（桌面/安卓共用）
src-tauri/          Tauri 2 壳（原 app/，已改名）
  src/main.rs       桌面入口 + Windows 专属命令（托盘/热键/剪贴板/写操作）
  src/lib.rs        共享库入口；安卓 run() 在此，旁边是 platform/state/commands/thumb
  ui/               共享前端 HTML/CSS/JS（无框架）
  gen/android/      tauri android init 生成，别手改
scripts/            accept.ps1 / perf.ps1 / install-release.ps1
docs/               设计、路线、验收、交接
```

- 数据：`index.json` + `blobs/ab/cd/<sha>.<ext>` + `thumbs/` + `trash/` + `settings.json`
- 前端状态：`app.js` 单文件（约 4k 行），无构建步骤
- 主题：内置深/浅 + Catppuccin 四套 + `themes/*.json` 自定义
- 图标：内嵌 Lucide SVG（`ICONS` 映射）
- 当前验收：**79 条前端断言 + 15 条 core 测试**；性能：3000 张首屏约 0.7s / 70 节点

## 5. 常用命令

```powershell
cargo build -p stickerbox                 # debug 桌面
cargo build --release -p stickerbox       # release（GUI 子系统，无终端）
cargo test -p stickerbox-core
pwsh -NoProfile -File scripts/accept.ps1
pwsh -NoProfile -File scripts/install-release.ps1
```

安卓（仅在用户明确要做 M2 时）：

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:LOCALAPPDATA\Android\Sdk\ndk\28.2.13676358"
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
npx tauri android build --debug --apk --target x86_64 --ci
```

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
  > 读 `AGENTS.md` 和 `docs/交接-2026-10-31.md`，复述现状与下一步；只做第一批，做完停下等我审。

## 8. 提交规范（Conventional Commits）

- 格式：`<type>(<scope>): <摘要>`；摘要用中文、一行说清做什么。
- 常用 type：`feat` 新功能、`fix` 修 bug、`refactor` 不改行为的重构、`chore` 构建/杂务、`docs` 文档、`test` 测试。
- scope 用模块名：`android`、`core`、`ui`、`platform`、`git` 等。
- **commit 前先汇报、等用户点头**；不要自己连着提交。
- 一个对话可以多个 commit，但同一件事的改动要聚合，且必须验证到边界（该跑的测试/截图/回归都跑完）再提交。
- 一批一个 commit；body 写「为什么 + 关键验证结果」，不写流水账。
- 例：`feat(android): 只读命令层与 thumb 协议搬进 lib crate`
