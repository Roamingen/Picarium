import {
  BUTTON_SIZE,
  MENU_WIDTH,
  isTrackableImage,
  placeButton,
  placeMenu,
} from "./lib/overlay";

const HOST_ID = "picarium-p3-host";
const RESET_MS = 2600;
const HIDE_MS = 160;

type State = "idle" | "busy" | "added" | "dup" | "error";

const ICONS: Record<string, string> = {
  plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  busy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  added:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>',
  dup: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 6v8"/><circle cx="12" cy="18" r=".7" fill="currentColor"/></svg>',
  save: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="m8 9 4 4 4-4"/><path d="M5 17h14v2H5z"/></svg>',
};

const CSS = `
:host { all: initial; }
.wrap {
  position: fixed; pointer-events: auto; width: ${BUTTON_SIZE}px; height: ${BUTTON_SIZE}px;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  z-index: 2147483000;
}
.btn {
  all: unset; box-sizing: border-box; width: ${BUTTON_SIZE}px; height: ${BUTTON_SIZE}px;
  border-radius: 9px; display: grid; place-items: center;
  cursor: pointer; color: #fff; background: rgba(22, 24, 29, .92);
  border: 1px solid rgba(255, 255, 255, .18);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .35);
  backdrop-filter: blur(6px);
  transition: background .12s ease, border-color .12s ease;
}
.btn:hover { background: #2b6cf0; border-color: #2b6cf0; }
.btn.busy { background: #2b6cf0; border-color: #2b6cf0; }
.btn.busy svg { animation: spin .8s linear infinite; }
.btn.added { background: #1f9d55; border-color: #1f9d55; }
.btn.dup { background: #2b6cf0; border-color: #2b6cf0; }
.btn.error { background: #d14343; border-color: #d14343; }
@keyframes spin { to { transform: rotate(360deg); } }
.menu {
  position: fixed; width: ${MENU_WIDTH}px; padding: 5px;
  background: rgba(28, 31, 36, .98); border: 1px solid rgba(255, 255, 255, .13);
  border-radius: 11px; box-shadow: 0 10px 30px rgba(0, 0, 0, .5);
  display: none;
}
.menu.open { display: block; }
.row {
  all: unset; box-sizing: border-box; width: 100%; height: 32px; padding: 0 8px;
  border-radius: 7px; display: flex; align-items: center; gap: 9px;
  color: #e9edf3; font-size: 12.5px; line-height: 1; cursor: pointer; white-space: nowrap;
}
.row:hover:not(:disabled) { background: rgba(255, 255, 255, .08); }
.row:disabled { color: rgba(233, 237, 243, .4); cursor: not-allowed; }
.row i { display: flex; flex: 0 0 auto; opacity: .85; }
.notice {
  --notice-bg: #f8f9fa; --notice-fg: #202124; --notice-line: rgba(0, 0, 0, .14);
  --notice-x: #5f6368; --notice-x-hover: rgba(0, 0, 0, .08);
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%) translateY(-8px);
  display: flex; align-items: flex-start; gap: 10px;
  max-width: min(520px, 90vw); padding: 10px 10px 10px 12px; border-radius: 10px;
  background: var(--notice-bg); color: var(--notice-fg);
  font: 12px/1.5 system-ui, sans-serif;
  border: 1px solid var(--notice-line); box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
  opacity: 0; pointer-events: none; transition: opacity .15s, transform .15s;
  z-index: 2147483000;
}
@media (prefers-color-scheme: dark) {
  .notice {
    --notice-bg: #292a2d; --notice-fg: #e8eaed; --notice-line: rgba(255, 255, 255, .16);
    --notice-x: #9aa0a6; --notice-x-hover: rgba(255, 255, 255, .1);
  }
}
.notice.show { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
.notice .dot {
  flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%;
  background: #e5484d; color: #fff; font: 700 12px/18px system-ui; text-align: center;
}
.notice .msg { flex: 1 1 auto; padding-top: 1px; }
.notice .x {
  all: unset; flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%;
  color: var(--notice-x); font: 15px/22px system-ui; text-align: center; cursor: pointer;
}
.notice .x:hover { background: var(--notice-x-hover); }
`;

interface Ui {
  host: HTMLDivElement;
  wrap: HTMLDivElement;
  btn: HTMLButtonElement;
  icon: HTMLSpanElement;
  menu: HTMLDivElement;
  notice: HTMLDivElement;
  noticeMsg: HTMLDivElement;
}

let ui: Ui | null = null;
let active: HTMLImageElement | null = null;
let lastPos = { left: 0, top: 0 };
let hideTimer = 0;
let resetTimer = 0;
let menuOpen = false;
let busy = false;
/** 最近一次「已存入/已复制/已下载/失败」的时间；鼠标移开时别立刻把结果藏掉。 */
let resultAt = 0;
/** 最近一次指针位置：请求结束时据此判断鼠标是不是已经离开图片。 */
let lastX = -1;
let lastY = -1;

function ensureUi(): Ui {
  if (ui) return ui;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.style.display = "none";
  wrap.innerHTML = `
    <button class="btn" type="button" aria-label="Picarium 图片操作" aria-expanded="false">
      <span class="ico"></span>
    </button>
    <div class="menu" role="menu">
      <button class="row" type="button" role="menuitem" data-act="copy">
        <i>${ICONS.copy}</i><span>复制并保存到 Picarium</span>
      </button>
      <button class="row" type="button" role="menuitem" data-act="copyOnly">
        <i>${ICONS.copy}</i><span>仅复制</span>
      </button>
      <button class="row" type="button" role="menuitem" data-act="download">
        <i>${ICONS.download}</i><span>下载到本地</span>
      </button>
    </div>`;

  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "alert");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.textContent = "!";
  const noticeMsg = document.createElement("div");
  noticeMsg.className = "msg";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "x";
  close.title = "关闭";
  close.textContent = "×";
  close.addEventListener("click", hideNotice);
  notice.append(dot, noticeMsg, close);

  shadow.append(style, wrap, notice);
  document.documentElement.appendChild(host);

  const btn = wrap.querySelector<HTMLButtonElement>(".btn")!;
  const icon = wrap.querySelector<HTMLSpanElement>(".ico")!;
  const menu = wrap.querySelector<HTMLDivElement>(".menu")!;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuOpen) closeMenu();
    else openMenu();
  });

  menu.querySelector<HTMLButtonElement>('[data-act="copy"]')!.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    void copy();
  });

  menu.querySelector<HTMLButtonElement>('[data-act="copyOnly"]')!.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    void copyOnly();
  });

  menu.querySelector<HTMLButtonElement>('[data-act="download"]')!.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    void download();
  });

  wrap.addEventListener("pointerenter", () => window.clearTimeout(hideTimer));
  wrap.addEventListener("pointerleave", scheduleHide);

  ui = { host, wrap, btn, icon, menu, notice, noticeMsg };
  setState("idle");
  return ui;
}

/** 把后台/桥/浏览器的原始错误翻译成用户看得懂的一句话。 */
function friendlyError(raw: string): string {
  const t = (raw || "").trim();
  if (/超过\s*\d+\s*MB/.test(t)) {
    return t.includes("上限") ? t : "图片太大，超过单张上限（32 MB），压缩后再试";
  }
  if (/连不上|Failed to fetch|NetworkError|Load failed/i.test(t)) {
    return "连不上 Picarium：先启动桌面端，确认它没被关掉";
  }
  if (/413|body too large|请求体/i.test(t)) {
    return "内容太大，桌面端没能接收（请求超过 48 MB），换小一点的图";
  }
  if (/unsupported ext/i.test(t)) {
    return "这个格式不支持：只收 GIF / WebP / PNG / JPG";
  }
  if (/版本太旧/.test(t)) return t;
  if (/抓图失败\s*HTTP\s*(403|412)/i.test(t)) {
    return "B 站拒绝了这次抓取（HTTP 403），点开大图后再试";
  }
  if (/抓图失败\s*HTTP\s*(404)/i.test(t)) {
    return "图片地址失效了（404），刷新页面再试";
  }
  if (/抓图失败/i.test(t) || /认不出图片格式/.test(t)) {
    return "这张图没抓下来，换一张或点开大图再试";
  }
  if (/下载失败|Invalid URL|download/i.test(t)) {
    return "下载没有成功，先试试「复制为文件」";
  }
  return t || "操作失败，再试一次";
}

function showNotice(text: string) {
  const u = ensureUi();
  u.noticeMsg.textContent = text;
  u.notice.classList.add("show");
}

function hideNotice() {
  ui?.notice.classList.remove("show");
}

function fail(raw: string) {
  const text = friendlyError(raw);
  setState("error", text);
  showNotice(text);
}

function showFor(img: HTMLImageElement) {
  if (busy || !isTrackableImage(img)) return;
  const u = ensureUi();
  if (img === active) {
    window.clearTimeout(hideTimer);
    return;
  }
  active = img;
  closeMenu();
  u.wrap.style.display = "block";
  setState("idle");
  reposition();
}

function reposition() {
  const u = ui;
  if (!u || !active) return;
  if (!active.isConnected) {
    hideNow();
    return;
  }
  const rect = active.getBoundingClientRect();
  if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
    hideNow();
    return;
  }
  lastPos = placeButton(rect, { width: window.innerWidth, height: window.innerHeight });
  u.wrap.style.left = `${lastPos.left}px`;
  u.wrap.style.top = `${lastPos.top}px`;
  if (menuOpen) positionMenu();
}

function positionMenu() {
  if (!ui) return;
  const pos = placeMenu(lastPos, { width: window.innerWidth, height: window.innerHeight });
  ui.menu.style.left = `${pos.left}px`;
  ui.menu.style.top = `${pos.top}px`;
}

function openMenu() {
  if (!ui || !active) return;
  menuOpen = true;
  positionMenu();
  ui.menu.classList.add("open");
  ui.btn.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  if (!ui) return;
  menuOpen = false;
  ui.menu.classList.remove("open");
  ui.btn.setAttribute("aria-expanded", "false");
}

function scheduleHide() {
  window.clearTimeout(hideTimer);
  // 菜单开着就不用管；保存中留到状态播完，避免 spinner 闪一下就没
  if (menuOpen) return;
  if (busy) {
    hideTimer = window.setTimeout(hideIfIdle, HIDE_MS);
    return;
  }
  hideIfIdle();
}

function hideIfIdle() {
  if (menuOpen || busy) return;
  // 结果状态还没播完就等一会儿再收，别让绿色 ✓ 一闪而过
  const wait = RESET_MS - (Date.now() - resultAt);
  if (wait > 0) {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideNow, wait);
    return;
  }
  hideNow();
}

function hideNow() {
  window.clearTimeout(hideTimer);
  closeMenu();
  if (ui) ui.wrap.style.display = "none";
  active = null;
}

function setState(state: State, message?: string) {
  const u = ensureUi();
  u.btn.className = state === "idle" ? "btn" : `btn ${state}`;
  u.icon.innerHTML = ICONS[state] ?? ICONS.plus!;
  const label = message ?? (state === "idle" ? "存入 Picarium" : "");
  u.btn.title = label;
  u.btn.setAttribute("aria-label", label || "存入 Picarium");

  if (state === "added" || state === "error") resultAt = Date.now();

  window.clearTimeout(resetTimer);
  if (state !== "idle" && state !== "busy") {
    resetTimer = window.setTimeout(() => {
      if (!busy) setState("idle");
    }, RESET_MS);
  }
}

async function submit(kind: "copy" | "copyOnly" | "download") {
  if (busy || !active) return;
  const img = active;
  if (!img.isConnected) {
    fail("图片已经不在了");
    return;
  }
  const url = img.currentSrc || img.src;
  if (!/^https?:/i.test(url)) {
    fail("这张图没有可下载的地址");
    return;
  }

  busy = true;
  hideNotice();
  setState(
    "busy",
    kind === "copy" ? "正在复制并保存…" : kind === "download" ? "正在下载…" : "正在复制…",
  );
  try {
    const res = (await chrome.runtime.sendMessage({ type: kind, url })) as
      | { ok?: boolean; added?: boolean; error?: string }
      | undefined;
    if (!res?.ok) {
      fail(res?.error ?? (kind === "download" ? "下载失败" : "复制失败"));
    } else if (kind === "copy") {
      setState("added", "已复制为文件，并存入 Picarium");
    } else if (kind === "download") {
      setState("added", "已下载到 Downloads");
    } else {
      setState("added", "已复制为文件，去聊天窗口直接粘贴");
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
    // 请求期间鼠标可能已经移开，这里重新排一次隐藏；结果状态会先播完
    if (!menuOpen && active && !withinActive(lastX, lastY)) scheduleHide();
  }
}

function copy() {
  return submit("copy");
}

function copyOnly() {
  return submit("copyOnly");
}

function download() {
  return submit("download");
}

/** B 站评论区是开放 Shadow DOM（<bili-comments>），视频封面/推荐位不是；只对评论图和查看器出钮。 */
function wantedImage(img: HTMLImageElement): boolean {
  const src = img.currentSrc || img.src;
  if (src.includes("/bfs/new_dyn/")) return true;
  if ((img.getRootNode() as ShadowRoot).host) return true;
  for (let n: Element | null = img; n; n = n.parentElement) {
    const cls = typeof n.className === "string" ? n.className : "";
    if (/image-?viewer|img-?viewer|bili-album/i.test(cls)) return true;
  }
  return false;
}

/** 指针是否落在当前图内（留 2px 容差）。B 站 hover 会盖一层缩放遮罩，img 会收到假的 pointerout。 */
function withinActive(x: number, y: number): boolean {
  if (!active) return false;
  const r = active.getBoundingClientRect();
  return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
}

function pointerOnActive(e: PointerEvent): boolean {
  return withinActive(e.clientX, e.clientY);
}

/** 逐层穿透开放 Shadow DOM，取指针下所有 img（含被 hover 遮罩盖住的）。 */
function imagesAt(x: number, y: number): HTMLImageElement[] {
  const out: HTMLImageElement[] = [];
  let root: Document | ShadowRoot = document;
  for (let depth = 0; depth < 6; depth += 1) {
    const stack: Element[] = root.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el.tagName === "IMG") out.push(el as HTMLImageElement);
    }
    const host: Element | undefined = stack.find((el: Element) => el.shadowRoot !== null);
    const sr = host?.shadowRoot;
    if (!sr) break;
    root = sr;
  }
  return out;
}

/** 遮罩/父级 <a> 抢走 hover 时，按位置找图：取面积最小的那张，避免误选外层的容器图。 */
function imageUnderPointer(e: PointerEvent): HTMLImageElement | null {
  const imgs = imagesAt(e.clientX, e.clientY).filter(wantedImage);
  imgs.sort((a, b) => a.width * a.height - b.width * b.height);
  return imgs[0] ?? null;
}

document.addEventListener(
  "pointerover",
  (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    const img = e.composedPath().find((n) => (n as Element).tagName === "IMG") as
      | HTMLImageElement
      | undefined;
    if (img && wantedImage(img)) {
      showFor(img);
      return;
    }
    // 评论图常被 hover 遮罩盖住（target 是遮罩），按坐标补一次，保证立刻出现
    const under = imageUnderPointer(e);
    if (under) showFor(under);
  },
  true,
);

let lastProbe = 0;

document.addEventListener(
  "pointermove",
  (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (menuOpen) return;
    if (active && pointerOnActive(e)) {
      window.clearTimeout(hideTimer);
      return;
    }
    if (e.timeStamp - lastProbe < 32) return;
    lastProbe = e.timeStamp;
    const img = imageUnderPointer(e);
    if (img) showFor(img);
    else if (active) scheduleHide();
  },
  true,
);

document.addEventListener(
  "pointerout",
  (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (menuOpen || !active) return;
    if (!pointerOnActive(e)) scheduleHide();
  },
  true,
);

document.addEventListener(
  "mousedown",
  (e) => {
    if (!menuOpen || !ui) return;
    if (!e.composedPath().includes(ui.host)) closeMenu();
  },
  true,
);

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    if (ui?.notice.classList.contains("show")) {
      e.stopPropagation();
      hideNotice();
      return;
    }
    if (!menuOpen) return;
    e.stopPropagation();
    closeMenu();
  },
  true,
);

window.addEventListener("scroll", reposition, true);
window.addEventListener("resize", reposition);
