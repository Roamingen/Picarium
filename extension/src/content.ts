import {
  BUTTON_SIZE,
  MENU_WIDTH,
  isTrackableImage,
  placeButton,
  placeMenu,
} from "./lib/overlay";

const HOST_ID = "stickerbox-p3-host";
const RESET_MS = 2400;
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
.kbd { margin-left: auto; font-size: 10.5px; color: rgba(233, 237, 243, .38); }
.tag {
  margin-left: auto; font-size: 10.5px; color: rgba(233, 237, 243, .38);
  border: 1px dashed rgba(233, 237, 243, .25); border-radius: 4px; padding: 1px 4px;
}
`;

interface Ui {
  host: HTMLDivElement;
  wrap: HTMLDivElement;
  btn: HTMLButtonElement;
  icon: HTMLSpanElement;
  menu: HTMLDivElement;
}

let ui: Ui | null = null;
let active: HTMLImageElement | null = null;
let lastPos = { left: 0, top: 0 };
let hideTimer = 0;
let resetTimer = 0;
let menuOpen = false;
let busy = false;

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
    <button class="btn" type="button" aria-label="存入 StickerBox" aria-expanded="false">
      <span class="ico"></span>
    </button>
    <div class="menu" role="menu">
      <button class="row" type="button" role="menuitem" data-act="save">
        <i>${ICONS.save}</i><span>存入 StickerBox</span><kbd class="kbd">Enter</kbd>
      </button>
      <button class="row" type="button" role="menuitem" disabled title="P4 未开放：把图以文件形式复制到剪贴板">
        <i>${ICONS.copy}</i><span>复制为文件</span><span class="tag">P4</span>
      </button>
      <button class="row" type="button" role="menuitem" disabled title="P5 未开放：下载到 Downloads">
        <i>${ICONS.download}</i><span>下载到 Downloads</span><span class="tag">P5</span>
      </button>
    </div>`;

  shadow.append(style, wrap);
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

  menu.querySelector<HTMLButtonElement>('[data-act="save"]')!.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    void save();
  });

  wrap.addEventListener("pointerenter", () => window.clearTimeout(hideTimer));
  wrap.addEventListener("pointerleave", scheduleHide);

  ui = { host, wrap, btn, icon, menu };
  setState("idle");
  return ui;
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
  if (!menuOpen && !busy) hideNow();
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
  const label = message ?? (state === "idle" ? "存入 StickerBox" : "");
  u.btn.title = label;
  u.btn.setAttribute("aria-label", label || "存入 StickerBox");

  window.clearTimeout(resetTimer);
  if (state !== "idle" && state !== "busy") {
    resetTimer = window.setTimeout(() => {
      if (!busy) setState("idle");
    }, RESET_MS);
  }
}

async function save() {
  if (busy || !active) return;
  const img = active;
  if (!img.isConnected) {
    setState("error", "图片已经不在了");
    return;
  }
  const url = img.currentSrc || img.src;
  if (!/^https?:/i.test(url)) {
    setState("error", "这张图没有可下载的地址");
    return;
  }

  busy = true;
  setState("busy", "正在存入 StickerBox…");
  try {
    const res = (await chrome.runtime.sendMessage({ type: "save", url })) as
      | { ok?: boolean; added?: boolean; error?: string }
      | undefined;
    if (res?.ok) {
      setState(
        res.added ? "added" : "dup",
        res.added ? "已存入 StickerBox" : "库里已有这张",
      );
    } else {
      setState("error", res?.error ?? "导入失败");
    }
  } catch (e) {
    setState("error", e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
  }
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

/** 指针是否还在当前图内（留 2px 容差）。B 站 hover 会盖一层缩放遮罩，img 会收到假的 pointerout。 */
function pointerOnActive(e: PointerEvent): boolean {
  if (!active) return false;
  const r = active.getBoundingClientRect();
  return (
    e.clientX >= r.left - 2 &&
    e.clientX <= r.right + 2 &&
    e.clientY >= r.top - 2 &&
    e.clientY <= r.bottom + 2
  );
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
    if (!menuOpen) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      closeMenu();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      void save();
    }
  },
  true,
);

window.addEventListener("scroll", reposition, true);
window.addEventListener("resize", reposition);
