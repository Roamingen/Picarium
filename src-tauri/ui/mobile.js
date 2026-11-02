// StickerBox 移动端（批 5：图库页 + 底部导航）
// 数据全部走 lib crate 里已注册的只读命令，缩略图走共享的 thumb 协议。

const T = window.__TAURI__ || {};
const invoke = T.core ? T.core.invoke : null;
const convertFileSrc = T.core ? T.core.convertFileSrc : (p) => p;

const $ = (id) => document.getElementById(id);

const S = {
  tab: "gallery",
  view: "all", // all | star | ungrouped | recent | <分组名>
  q: "",
  items: [],
  stats: null,
  groups: [],
  groupList: [],
  pinned: [],
  pinsOpen: false,
  gq: "",
  gview: null,
  sharedPaths: [],
  tags: [],
  filters: { type: "", days: 0, tags: [], sort: "" },
  gFilters: { type: "", days: 0, tags: [], sort: "manual" },
  tFilters: { type: "", days: 0, tags: [], sort: "" },
  loading: false,
};

const SVG = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
};

let selMode = false;
const sel = new Set();
let imgSelMode = false;
const imgSel = new Set();
let trashSelMode = false;
const trashSel = new Set();
let imgHoldInfo = null;
let imgHoldTimer = 0;
let imgHoldFired = false;
let holdInfo = null;
let holdTimer = 0;
let dragCtx = null;
let suppressClick = false;

/* 分组详情：独立于图库的一套选择 / 搜索 / 加载状态 */
let gdItems = [];
let gdSelMode = false;
let gdSel = new Set();
let gdQ = "";
let gdLoadSeq = 0;
let gdHoldInfo = null;
let gdHoldTimer = 0;
let gdHoldFired = false;
let gdDrag = null;
let gdDropEl = null;
let gdDockEl = null;
let gdDockTimer = 0;
let dwellTextTimer = 0;
let gdDockHot = false;
let crossDrag = null;
let crossHoverTimer = 0;
let crossHoverName = "";
let crossHoverEl = null;
let crossScrollRaf = 0;
let crossScrollDir = 0;
let mergeTarget = "";
try {
  S.pinsPerRow = Math.min(6, Math.max(3, +localStorage.getItem('sb.pinPerRow') || 4));
  S.pinRows = Math.min(3, Math.max(1, +localStorage.getItem('sb.pinRows') || 2));
} catch (_) { S.pinsPerRow = 4; S.pinRows = 2; }

const TAB_INFO = {
  groups: {
    title: "分组",
    text: "下一批做成封面文件夹：点进去和图库一样看一堆图，长按可以换封面 / 重命名 / 删除。",
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  },
  trash: {
    title: "回收站",
    text: "下一批上线：删除的图片在这里保留 30 天，可以恢复或彻底删除。",
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  },
  me: {
    title: "我的",
    text: "下一批上线：主题 / 配色、网格列数、打开时的视图，以及相册导入和备份。",
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  },
};

/* ---------- 小工具 ---------- */

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + " GB";
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

let toastTimer = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

function groupParam() {
  if (S.view === "all") return null;
  if (S.view === "star") return "__star__";
  if (S.view === "ungrouped") return "";
  if (S.view === "recent") return "__recent__";
  return S.view;
}

function thumbUrl(sha, raw) {
  const u = convertFileSrc(sha, "thumb");
  return raw ? u + (u.includes("?") ? "&" : "?") + "raw=1" : u;
}

/* ---------- 数据 ---------- */

// 移动端 WebView 可能比 Rust 的 setup（打开图库、manage 状态）先跑起来，
// 这时命令会报 "state not managed"，等一会儿重试即可。
async function invokeRetry(cmd, args, tries = 25) {
  for (let i = 0; ; i++) {
    try {
      return await invoke(cmd, args);
    } catch (e) {
      if (i < tries && /not managed/i.test(String(e))) {
        await new Promise((r) => setTimeout(r, 120));
        continue;
      }
      throw e;
    }
  }
}

async function refresh() {
  if (!invoke) {
    $("grid").innerHTML = '<div class="empty">没有连上 Tauri 内核，可能是用浏览器直接打开的。</div>';
    return;
  }
  if (S.loading) return;
  S.loading = true;
  S.view = S.view === "all" ? "all" : S.view;
  $("grid").innerHTML = '<div class="spinner">正在读取图库…</div>';

  try {
    const [items, gs, lib, gl, ts] = await Promise.all([
      invokeRetry("list_assets", { q: S.q, group: groupParam(), limit: 500, sort: sortParam(), filters: filterJson() }),
      invokeRetry("group_stats"),
      invokeRetry("library_stats"),
      invokeRetry("group_list"),
      invokeRetry("tag_stats"),
    ]);
    S.items = items || [];
    S.groups = (gs && gs.groups) || [];
    S.groupList = (gl && gl.groups) || [];
    S.pinned = (gl && gl.pinned) || [];
    S.tags = ts || [];
    S.stats = { ...gs, ...lib };
    renderHeader();
    renderChips();
    renderPins();
    renderGrid();
    if (pruneSel()) paintImgSel();
    syncSel();
    if (S.tab === "groups" && !S.gview) renderFolders();
  } catch (e) {
    $("grid").innerHTML = '<div class="empty">读取失败：' + String(e) + "</div>";
  } finally {
    S.loading = false;
  }
}

function renderHeader() {
  const s = S.stats || {};
  const n = s.assets != null ? s.assets : (s.total || 0);
  $("libline").textContent = `${n} 张 · ${fmtSize(s.bytes)}`;
}

function renderChips() {
  const s = S.stats || {};
  const chips = $("chips");
  const items = [
    { key: "all", label: "全部", count: s.total },
    { key: "star", label: "收藏", count: s.starred },
    { key: "ungrouped", label: "未分组", count: s.ungrouped },
    { key: "recent", label: "最近", count: null },
  ];

  let html = items
    .map(
      (c) =>
        `<button class="chip${S.view === c.key ? " on" : ""}" data-view="${c.key}">${c.label}` +
        (c.count != null ? ` <em>${c.count}</em>` : "") +
        (c.extra || "") +
        `</button>`
    )
    .join("");

  if (!["all", "star", "ungrouped", "recent"].includes(S.view)) {
    html += `<button class="chip fch" data-clear="1"><b>分组：${escapeHtml(S.view)}</b> <span class="x">✕</span></button>`;
  }
  chips.innerHTML = html;
  $("btn-filter").classList.toggle("active", hasFilters());
  // 分组/搜索的 chip 排在最后，自动滚到右端让用户看见
  const hasFilter = S.q || !["all", "star", "ungrouped", "recent"].includes(S.view);
  chips.scrollLeft = hasFilter ? chips.scrollWidth : 0;
}

function filterJson(src) {
  const src0 = src || S.filters;
  const f = {};
  if (src0.type === "gif") f.exts = ["gif"];
  else if (src0.type === "static") f.exts = ["png", "jpg", "jpeg", "webp", "bmp"];
  if (src0.tags.length) f.tags = src0.tags.slice();
  if (src0.days) {
    const d = new Date();
    d.setDate(d.getDate() - (src0.days - 1));
    f.from = d.toISOString().slice(0, 10);
  }
  return Object.keys(f).length ? JSON.stringify(f) : null;
}

function sortParam(src) {
  return (src || S.filters).sort || "added";
}

function hasFilters(src) {
  const f = src || S.filters;
  return !!(f.type || f.days || f.tags.length || (f.sort && f.sort !== "manual"));
}

function pinNames() {
  // 只显示真正置顶的分组；没置顶就不出现在首页
  return S.pinned.filter((n) => S.groupList.some((g) => g.name === n));
}

function pinLimit() {
  return S.pinsPerRow * S.pinRows;
}

function renderPins() {
  const total = pinNames();
  const limit = pinLimit();
  const list = S.pinsOpen ? total : total.slice(0, limit);
  $("pins-wrap").hidden = S.tab !== "gallery" || total.length === 0;
  $("pins-toggle").textContent = S.pinsOpen ? "收起" : "展开全部 " + total.length;
  $("pins-toggle").hidden = total.length <= limit;
  const hint = $("pins-hint");
  if (hint) hint.hidden = !(S.pinsOpen && S.pinned.length > 1);
  if (total.length === 0) return;

  const card = (name) => {
    const g = S.groupList.find((x) => x.name === name) || { name, count: 0 };
    return `<button class="pin" data-group="${escapeAttr(name)}">
      <div class="pc">${g.cover ? `<img src="${thumbUrl(g.cover, g.animated)}" alt="" loading="lazy" onerror="this.remove()">` : folderIcon(g.name)}</div>
      <div class="pn">${escapeHtml(name)}</div>
    </button>`;
  };

  $("pins").innerHTML = list.map(card).join("");
}

function folderEmoji(count) {
  const list = ["🐟", "🐱", "🍵", "🎀", "🫧", "💤", "🌈", "🔥"];
  return list[count % list.length];
}

function renderGrid() {
  const grid = $("grid");
  if (!S.items.length) {
    const hint =
      S.q || S.view !== "all" || hasFilters()
        ? "这里还没有匹配的表情。"
        : "这里还没有表情。点右下角「+」，或把图片分享到手机上的 StickerBox。";
    grid.innerHTML = `<div class="empty">${hint}</div>`;
    return;
  }
  grid.innerHTML = S.items.map((a) => cardHtml(a)).join("");
}

function cardHtml(a, selected = imgSel) {
  const on = (selected && typeof selected.has === "function" ? selected : imgSel).has(a.sha);
  return `<button class="card${on ? " sel" : ""}" data-sha="${escapeAttr(a.sha)}" data-name="${escapeAttr(a.name)}">
    <img loading="lazy" src="${thumbUrl(a.sha)}" alt="" onerror="this.style.display='none'">
    ${a.animated ? '<span class="badge">GIF</span>' : ""}
    ${a.starred ? '<span class="fav"></span>' : ""}
    <span class="fcheck">${SVG.check || ""}</span>
  </button>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

/* ---------- 分组页 ---------- */

async function loadGroups() {
  const gl = await invokeRetry("group_list");
  S.groupList = (gl && gl.groups) || [];
  S.pinned = (gl && gl.pinned) || [];
  S.starredCover = (gl && gl.starred_cover) || null;
  S.starredBytes = (gl && gl.starred_bytes) || 0;
  renderPins();
  if (S.tab === "groups" && !S.gview) renderFolders();
}

function hueOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function folderIcon(name) {
  return `<span class="fico" style="--h:${hueOf(name)}">${SVG.folder}</span>`;
}

const FAV_NAME = "收藏";
const DEFAULT_DWELL = 1000;
function dwellMs() {
  const v = Number(localStorage.getItem("sb.dwell"));
  return v === 2000 || v === 3000 ? v : DEFAULT_DWELL;
}
function dwellSec() { return Math.round(dwellMs() / 1000); }
function dragMode() { return localStorage.getItem("sb.dragmode") === "copy" ? "copy" : "cut"; }
function groupCols() {
  const v = Number(localStorage.getItem("sb.gcols"));
  return v === 3 || v === 4 ? v : 2;
}
function groupNewPos() { return localStorage.getItem("sb.gnew") === "back" ? "back" : "front"; }
function favCard(count, picked) {
  const cover = S.starredCover
    ? `<img class="favcover" src="${thumbUrl(S.starredCover)}" alt="" loading="lazy" onerror="this.remove()">`
    : "♥";
  return `<button class="folder fav${picked ? " sel" : ""}" data-fav="1">
    <span class="fcheck">${SVG.check}</span>
    <div class="fc favfc">${cover}</div>
    <div class="fb"><span class="fname">收藏夹</span><span class="fsub">${count} 张 · 特殊分组</span></div>
  </button>`;
}

function folderCard(g, picked) {
  const on = picked === undefined ? sel.has(g.name) : !!picked;
  const cover = g.cover
    ? `<img src="${thumbUrl(g.cover, g.animated)}" alt="" loading="lazy" onerror="this.remove()">`
    : folderIcon(g.name);
  return `<button class="folder${on ? " sel" : ""}${g.pinned ? " pinned" : ""}" data-group="${escapeAttr(g.name)}">
    ${g.pinned ? `<span class="gpin" title="已置顶">${SVG.pin}</span>` : ""}
    <span class="fcheck">${SVG.check}</span>
    <div class="fc">${cover}</div>
    <div class="fb"><span class="fname">${escapeHtml(g.name)}</span><span class="fsub">${g.count} 张</span></div>
  </button>`;
}

function renderFolders(keepScroll) {
  const folderBox = $("folders");
  if (!folderBox) return;
  const q = S.gq.trim().toLowerCase();
  const list = S.groupList
    .filter((g) => !q || g.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const pa = S.pinned.indexOf(a.name);
      const pb = S.pinned.indexOf(b.name);
      if (pa >= 0 && pb >= 0) return pa - pb;
      if (pa >= 0) return -1;
      if (pb >= 0) return 1;
      return S.groupList.indexOf(a) - S.groupList.indexOf(b);
    });
  const y = keepScroll ? window.scrollY : null;
  $("ghead").hidden = selMode;
  $("gselhead").hidden = !selMode;
  $("gactbar").hidden = !selMode;
  document.body.classList.toggle("gselect", selMode);
  $("gcount").textContent = ` ${S.groupList.length} 个`;
  $("gseln").textContent = String(sel.size);
  const visible = list.map((g) => g.name);
  const full = visible.length > 0 && visible.every((n) => sel.has(n));
  $("gsel-all").textContent = full ? "取消全选" : "全选";
  $("gsel-all").classList.toggle("done", full);
  const picked = S.groupList.filter((g) => sel.has(g.name));
  const pinned = picked.filter((g) => g.pinned).length;
  $("gactbar").querySelector('[data-gact="dissolve"]').disabled = sel.size === 0;
  $("gactbar").querySelector('[data-gact="delete"]').disabled = sel.size === 0;
  $("gactbar").querySelector('[data-gact="pin"]').disabled = sel.size === 0 || pinned === picked.length;
  $("gactbar").querySelector('[data-gact="unpin"]').disabled = sel.size === 0 || pinned === 0;
  const starred = (S.stats && S.stats.starred) || 0;
  const empty = list.length
    ? ""
    : `<div class="empty">${q ? "没有匹配的分组。" : "还没有分组。点右下角「+」新建一个。"}</div>`;
  folderBox.innerHTML =
    (!selMode && !q ? favCard(starred, false) : "") +
    list.map((g) => folderCard(g)).join("") +
    empty;
  if (crossDrag) {
    folderBox.classList.add("crossing");
    for (const el of folderBox.querySelectorAll(".folder[data-group]")) {
      el.classList.add("cross-target");
    }
    // 收藏夹永远可以当拖拽目标（加入 = 收藏，复制语义）
    const fav = folderBox.querySelector(".folder[data-fav]");
    if (fav) fav.classList.add("cross-target");
  } else {
    folderBox.classList.remove("crossing");
  }
  if (y !== null) window.scrollTo(0, y);
  if (dragCtx) {
    const src = folderBox.querySelector(`.folder[data-group="${cssEsc(dragCtx.name)}"]`);
    if (src) src.classList.add("dragsrc");
  }
}

function cssEsc(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}
function syncGroupPin(name) {
  const on = name !== FAV_NAME && S.pinned.includes(name);
  const pin = $("gd-pin");
  if (pin) pin.hidden = !on;
  const g = S.groupList.find((x) => x.name === name);
  if (g) g.pinned = on;
}

function gdDisplayName(name) {
  return name === FAV_NAME ? "收藏夹" : name;
}

function gdParam(name) {
  return name === FAV_NAME ? "__star__" : name;
}

function gdCount(name) {
  if (name === FAV_NAME) return (S.stats && S.stats.starred) || 0;
  const g = S.groupList.find((x) => x.name === name);
  return g ? g.count : gdItems.length;
}

function gdBytes(name) {
  if (name === FAV_NAME) return S.starredBytes || 0;
  const g = S.groupList.find((x) => x.name === name);
  return g ? g.bytes || 0 : 0;
}

function renderGdFilter() {
  const b = $("btn-gfilter");
  if (b) b.classList.toggle("active", hasFilters(S.gFilters));
}

function paintGdSel() {
  document.querySelectorAll("#gd-grid .card").forEach((c) => {
    c.classList.toggle("sel", gdSel.has(c.dataset.sha));
  });
}

function syncGdSel() {
  const n = $("gdseln");
  if (n) n.textContent = String(gdSel.size);
  const all = gdItems.length > 0 && gdItems.every((a) => gdSel.has(a.sha));
  const b = $("gdsel-all");
  if (b) {
    b.textContent = all ? "取消全选" : "全选";
    b.classList.toggle("done", all);
  }
  for (const btn of document.querySelectorAll("#gdactbar button")) btn.disabled = gdSel.size === 0;
}

function setGdSelMode(on) {
  on = !!on;
  if (!on) gdSel.clear();
  gdSelMode = on;
  document.body.classList.toggle("gdselect", on);
  $("gdhead").hidden = on;
  $("gdselhead").hidden = !on;
  $("gdactbar").hidden = !on;
  if (on) closeGmenu();
  paintGdSel();
  syncGdSel();
  syncGuard();
}

function toggleGdSel(sha) {
  if (gdSel.has(sha)) gdSel.delete(sha);
  else gdSel.add(sha);
  if (gdSel.size === 0) {
    setGdSelMode(false);
    return;
  }
  paintGdSel();
  syncGdSel();
}

function gdAll() {
  if (!gdSelMode) return;
  const all = gdItems.length > 0 && gdItems.every((a) => gdSel.has(a.sha));
  gdSel.clear();
  if (!all) gdItems.forEach((a) => gdSel.add(a.sha));
  if (gdSel.size === 0) {
    setGdSelMode(false);
    return;
  }
  paintGdSel();
  syncGdSel();
}

function pruneGdSel() {
  const keep = new Set(gdItems.map((a) => a.sha));
  for (const sha of [...gdSel]) if (!keep.has(sha)) gdSel.delete(sha);
  if (gdSelMode && gdSel.size === 0) {
    setGdSelMode(false);
    return true;
  }
  return false;
}

async function loadGroup(opts = {}) {
  if (!S.gview) return;
  const name = S.gview;
  const isFav = name === FAV_NAME;
  const seq = ++gdLoadSeq;
  const g = S.groupList.find((x) => x.name === name);
  const total = gdCount(name);
  const bytes = gdBytes(name);
  const baseMeta = bytes ? `${total} 张 · ${fmtSize(bytes)}` : `${total} 张`;
  $("gd-title").textContent = gdDisplayName(name);
  $("gd-pin").hidden = isFav || !(g && g.pinned);
  $("btn-gdsel").hidden = false;
  const removeLabel = document.querySelector('#gdactbar [data-gdact="remove"] span');
  if (removeLabel) removeLabel.textContent = isFav ? "取消收藏" : "移出分组";
  $("gd-meta").textContent = baseMeta;
  $("gd-grid").innerHTML = '<div class="spinner">正在读取…</div>';
  try {
    const items = await invokeRetry("list_assets", {
      q: gdQ,
      group: gdParam(name),
      limit: 1000,
      sort: sortParam(S.gFilters),
      filters: filterJson(S.gFilters),
    });
    if (seq !== gdLoadSeq) return;
    gdItems = items || [];
    if (gdSelMode) pruneGdSel();
    const filtering = !!(S.gFilters.type || S.gFilters.days || (S.gFilters.tags && S.gFilters.tags.length));
    $("gd-grid").innerHTML = gdItems.length
      ? gdItems.map((a) => cardHtml(a, gdSel)).join("")
      : `<div class="gempty">${gdQ || filtering ? "没有匹配的图片" : isFav ? "收藏夹还是空的" : "这个分组还是空的"}</div>`;
    if (gdQ || filtering) {
      $("gd-meta").textContent = `${gdItems.length} / ${total} 张 · ${gdQ ? "搜索结果" : "筛选结果"}`;
    }
    renderGdFilter();
    syncGdSel();
    paintGdSel();
  } catch (e) {
    if (seq !== gdLoadSeq) return;
    $("gd-grid").innerHTML = '<div class="gempty">读取失败：' + escapeHtml(String(e)) + "</div>";
  }
}

async function openGroup(name) {
  S.gview = name;
  gdQ = "";
  if (gdSelMode) setGdSelMode(false);
  gdSel.clear();
  const q = $("gdq");
  if (q) q.value = "";
  if ($("gdq-clear")) $("gdq-clear").hidden = true;
  closeGmenu();
  setTab("groups");
  syncGuard();
  syncGroupPin(name);
  renderGdFilter();
  await loadGroup();
  syncGuard();
}

/* ---------- 组内手动排序（单张拖拽） ---------- */

function gdManualReady() {
  if (S.gFilters.sort !== "manual") return "先切换到「手动排序」再拖拽";
  const filtering = !!(S.gFilters.type || S.gFilters.days || (S.gFilters.tags && S.gFilters.tags.length));
  if (gdQ || filtering) return "清空搜索/筛选后再拖拽";
  return "";
}

function gdCanDrag() {
  if (!S.gview || gdSelMode) return "";
  return gdManualReady();
}

function gdDropCleanup() {
  stopDwellText();
  crossScrollStop();
  clearTimeout(gdDockTimer);
  gdDockTimer = 0;
  clearTimeout(crossHoverTimer);
  crossHoverTimer = 0;
  crossHoverName = "";
  if (crossHoverEl) crossHoverEl.classList.remove("cross-hot");
  crossHoverEl = null;
  gdUnbindGlobal();
  if (gdDropEl) {
    gdDropEl.remove();
    gdDropEl = null;
  }
  if (gdDockEl) {
    gdDockEl.remove();
    gdDockEl = null;
  }
  document.querySelectorAll(".gdcrossring").forEach((el) => el.remove());
  document.body.classList.remove("gdcrossbar");
  if (gdDrag) {
    if (gdDrag.pointerId != null) {
      try { document.body.releasePointerCapture(gdDrag.pointerId); } catch {}
    }
    if (gdDrag.ghost) gdDrag.ghost.remove();
    if (gdDrag.el) gdDrag.el.classList.remove("dragsrc");
    if (gdDrag.els) for (const el of gdDrag.els) el.classList.remove("dragsel");
  }
  const folders = $("folders");
  if (folders) folders.classList.remove("crossing");
  document.querySelectorAll(".folder.cross-hot, .folder.cross-source, .folder.cross-target").forEach((el) => el.classList.remove("cross-hot", "cross-source", "cross-target"));
  document.body.classList.remove("img-dragging");
  document.body.classList.remove("cross-dragging");
}

function cancelGdDrag() {
  if (!gdDrag) return;
  gdDropCleanup();
  gdDrag = null;
  gdHoldFired = true;
  setTimeout(() => { gdHoldFired = false; }, 450);
}

function beginGdDrag(sha, el, e) {
  const reason = gdCanDrag();
  if (reason) {
    toast(reason);
    return false;
  }
  const idx = gdItems.findIndex((a) => a.sha === sha);
  if (idx < 0) return false;
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add("ghost");
  ghost.style.width = r.width + "px";
  ghost.style.height = r.height + "px";
  ghost.style.left = e.clientX - r.width / 2 + "px";
  ghost.style.top = e.clientY - r.height / 2 + "px";
  document.body.appendChild(ghost);
  el.classList.add("dragsrc");
  gdDrag = {
    mode: "single",
    sha,
    idx,
    el,
    els: [el],
    ghost,
    pointerId: e.pointerId,
    startOrder: gdItems.map((a) => a.sha),
    order: gdItems.map((a) => a.sha),
    offsetX: r.width / 2,
    offsetY: r.height / 2,
    changed: false,
  };
  try { document.body.setPointerCapture(e.pointerId); } catch {}
  document.body.classList.add("img-dragging");
  gdDropEl = document.createElement("div");
  gdDropEl.id = "gddrop";
  document.body.appendChild(gdDropEl);
  gdBindGlobal();
  gdDockRender("继续往下拖 · 去其他分组", false);
  updateGdDrag(e);
  if (navigator.vibrate) navigator.vibrate(8);
  return true;
}

// 多选整块拖拽：叠卡 ghost + 数量角标
function buildGdStackGhost(els, r) {
  const wrap = document.createElement("div");
  wrap.className = "gdstack";
  wrap.style.width = r.width + "px";
  wrap.style.height = r.height + "px";
  const n = Math.min(els.length, 3);
  for (let i = n - 1; i >= 0; i--) {
    const box = document.createElement("div");
    box.className = "gdstack-card";
    box.style.transform = "translate(" + i * 7 + "px," + i * 7 + "px)";
    box.style.zIndex = String(n - i);
    const clone = els[i].cloneNode(true);
    clone.classList.remove("dragsrc", "dragsel");
    box.appendChild(clone);
    wrap.appendChild(box);
  }
  const count = document.createElement("div");
  count.className = "gdstack-count";
  count.textContent = String(els.length);
  wrap.appendChild(count);
  return wrap;
}

function beginGdGroupDrag(e) {
  const reason = gdManualReady();
  if (reason) {
    toast(reason);
    return false;
  }
  if (!gdSelMode || !gdSel.size) return false;
  const items = gdItems.filter((a) => gdSel.has(a.sha));
  const els = [...$("gd-grid").querySelectorAll(".card")].filter((c) => gdSel.has(c.dataset.sha));
  if (!items.length || !els.length) return false;
  const r = els[0].getBoundingClientRect();
  const ghost = buildGdStackGhost(els, r);
  ghost.style.left = e.clientX - r.width / 2 + "px";
  ghost.style.top = e.clientY - r.height / 2 + "px";
  document.body.appendChild(ghost);
  for (const el of els) el.classList.add("dragsel");
  gdDrag = {
    mode: "group",
    shas: items.map((a) => a.sha),
    els,
    ghost,
    pointerId: e.pointerId,
    startOrder: gdItems.map((a) => a.sha),
    order: gdItems.map((a) => a.sha),
    offsetX: r.width / 2,
    offsetY: r.height / 2,
    changed: false,
  };
  try { document.body.setPointerCapture(e.pointerId); } catch {}
  document.body.classList.add("img-dragging");
  gdDropEl = document.createElement("div");
  gdDropEl.id = "gddrop";
  document.body.appendChild(gdDropEl);
  gdBindGlobal();
  gdDockRender("继续往下拖 · 去其他分组", false);
  updateGdDrag(e);
  if (navigator.vibrate) navigator.vibrate(8);
  return true;
}

function updateGdDrag(e) {
  const d = gdDrag;
  if (!d) return;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  d.ghost.style.left = e.clientX - d.offsetX + "px";
  d.ghost.style.top = e.clientY - d.offsetY + "px";
  if (!crossDrag) gdDockUpdate(e);
  const groupSet = d.mode === "group" ? new Set(d.shas) : null;
  const cards = [...$("gd-grid").querySelectorAll(".card")].filter((c) =>
    d.mode === "group" ? !groupSet.has(c.dataset.sha) : c !== d.el
  );
  let target = null;
  let best = Infinity;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (dist < best) {
      best = dist;
      target = c;
    }
  }
  if (!target) {
    if (gdDropEl) gdDropEl.style.display = "none";
    return;
  }
  const r = target.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  if (d.mode === "group") {
    const rest = d.order.filter((s) => !groupSet.has(s));
    const block = d.order.filter((s) => groupSet.has(s));
    const at = rest.indexOf(target.dataset.sha);
    if (at < 0) return;
    const next = [...rest];
    next.splice(after ? at + 1 : at, 0, ...block);
    d.order = next;
  } else {
    const rest = d.order.filter((s) => s !== d.sha);
    const at = rest.indexOf(target.dataset.sha);
    if (at < 0) return;
    rest.splice(after ? at + 1 : at, 0, d.sha);
    d.order = rest;
  }
  d.changed = d.order.join("|") !== d.startOrder.join("|");
  if (gdDropEl) {
    gdDropEl.style.display = "block";
    gdDropEl.style.left = (after ? r.right + 3 : r.left - 6) + "px";
    gdDropEl.style.top = r.top + 8 + "px";
    gdDropEl.style.height = Math.max(24, r.height - 16) + "px";
  }
  if (!crossDrag) gdDockUpdate(e);
}

async function endGdDrag() {
  const d = gdDrag;
  if (!d) return;
  const key = gdParam(S.gview);
  const order = d.order;
  const changed = d.changed;
  const mode = d.mode;
  const count = (d.shas || []).length;
  gdDropCleanup();
  gdDrag = null;
  gdHoldFired = true;
  setTimeout(() => { gdHoldFired = false; }, 450);
  if (!changed) return;
  try {
    await invokeRetry("set_asset_order", { key, shas: order });
    if (mode === "group") {
      setGdSelMode(false);
      gdSel.clear();
    }
    await loadGroup();
    toast(mode === "group" ? "已移动 " + count + " 张" : "顺序已保存");
  } catch (e) {
    toast("保存失败：" + String(e));
    loadGroup();
  }
}

/* ---------- 分组间拖拽：底部投递 -> 进组 -> 松手提交 ---------- */

function gdBindGlobal() {
  gdUnbindGlobal();
  window.addEventListener("pointermove", gdGlobalMove, { passive: false });
  window.addEventListener("pointerup", gdGlobalUp);
  window.addEventListener("pointercancel", gdGlobalCancel);
  window.addEventListener("touchmove", gdGlobalTouch, { passive: false });
}

function gdUnbindGlobal() {
  window.removeEventListener("pointermove", gdGlobalMove);
  window.removeEventListener("pointerup", gdGlobalUp);
  window.removeEventListener("pointercancel", gdGlobalCancel);
  window.removeEventListener("touchmove", gdGlobalTouch);
}

function gdGlobalMove(e) {
  if (!gdDrag && !crossDrag) return;
  if (e.cancelable) e.preventDefault();
  if (crossDrag) crossUpdate(e);
  else if (gdDrag) updateGdDrag(e);
}

function gdGlobalUp() {
  if (crossDrag) { endCrossDrag(); return; }
  if (gdDrag) endGdDrag();
}

function gdGlobalCancel() {
  if (crossDrag) {
    cancelCrossDrag();
    return;
  }
  if (gdDrag) cancelGdDrag();
}

function gdGlobalTouch(e) {
  if (gdDrag) e.preventDefault();
}

function gdLineShow(r, after) {
  if (!gdDropEl) {
    gdDropEl = document.createElement("div");
    gdDropEl.id = "gddrop";
    document.body.appendChild(gdDropEl);
  }
  gdDropEl.style.display = "block";
  gdDropEl.style.left = (after ? r.right + 3 : r.left - 6) + "px";
  gdDropEl.style.top = r.top + 8 + "px";
  gdDropEl.style.height = Math.max(24, r.height - 16) + "px";
}

function gdLineHide() {
  if (gdDropEl) gdDropEl.style.display = "none";
}

function stopDwellText() {
  if (dwellTextTimer) clearTimeout(dwellTextTimer);
  dwellTextTimer = 0;
}

function startDwellText(el, ms, render) {
  stopDwellText();
  if (!el) return;
  const started = performance.now();
  const tick = () => {
    const left = Math.max(0, ms - (performance.now() - started));
    el.innerHTML = render(left);
    if (left <= 0) {
      dwellTextTimer = 0;
      return;
    }
    dwellTextTimer = setTimeout(tick, 80);
  };
  tick();
}

function gdDockRender(text, hot) {
  if (!gdDockEl) {
    gdDockEl = document.createElement("div");
    gdDockEl.id = "gdcrossdock";
    gdDockEl.innerHTML = `<div class="gddock-frame"><svg class="gddock-ring" viewBox="0 0 366 62" preserveAspectRatio="none" aria-hidden="true"><rect x="1.5" y="1.5" width="363" height="59" rx="14" pathLength="100"></rect></svg><span class="gddock-ic">↓</span><span class="gddock-text"></span><span class="gddock-sub">按住 ${dwellSec()} 秒</span></div>`;
    document.body.appendChild(gdDockEl);
  }
  gdDockEl.querySelector(".gddock-text").textContent = text;
  const sub = gdDockEl.querySelector(".gddock-sub");
  if (sub && !hot) sub.textContent = `按住 ${dwellSec()} 秒`;
  gdDockEl.classList.add("show");
  gdDockEl.classList.toggle("hot", !!hot);
  document.body.classList.add("gdcrossbar");
  gdDockHot = !!hot;
}

function gdDockHide() {
  clearTimeout(gdDockTimer);
  gdDockTimer = 0;
  if (gdDockEl) {
    gdDockEl.classList.remove("show", "hot");
    gdDockEl.remove();
    gdDockEl = null;
  }
  document.body.classList.remove("gdcrossbar");
  gdDockHot = false;
}

function gdDockUpdate(e) {
  if (!gdDrag || crossDrag) return;
  if (S.gview === null) { gdDockHide(); return; }
  const near = e.clientY >= window.innerHeight - 90;
  gdDockRender("继续往下拖 · 去其他分组", near);
  if (!near) {
    clearTimeout(gdDockTimer);
    gdDockTimer = 0;
    stopDwellText();
    return;
  }
  if (!gdDockTimer) {
    gdDockTimer = setTimeout(() => {
      gdDockTimer = 0;
      stopDwellText();
      crossStart();
    }, dwellMs());
    const sub = gdDockEl && gdDockEl.querySelector(".gddock-sub");
    startDwellText(sub, dwellMs(), (left) => (left / 1000).toFixed(1) + "s");
  }
}

function crossScrollStop() {
  if (crossScrollRaf) cancelAnimationFrame(crossScrollRaf);
  crossScrollRaf = 0;
  crossScrollDir = 0;
}

function crossScrollTick() {
  if (!crossDrag || crossDrag.phase !== "groups" || !crossScrollDir) {
    crossScrollStop();
    return;
  }
  window.scrollBy(0, crossScrollDir * 10);
  crossScrollRaf = requestAnimationFrame(crossScrollTick);
}

function crossScrollUpdate(e) {
  if (!crossDrag || crossDrag.phase !== "groups") {
    crossScrollStop();
    return;
  }
  const threshold = 90;
  const dir = e.clientY < threshold ? -1 : e.clientY > window.innerHeight - threshold ? 1 : 0;
  if (!dir) {
    crossScrollStop();
    return;
  }
  if (dir !== crossScrollDir) {
    crossScrollDir = dir;
    if (!crossScrollRaf) crossScrollRaf = requestAnimationFrame(crossScrollTick);
  }
}

function crossRingShow(el) {
  document.querySelectorAll(".gdcrossring").forEach((r) => r.remove());
  if (!el) return;
  const ring = document.createElement("div");
  ring.className = "gdcrossring";
  ring.innerHTML = `<svg viewBox="0 0 150 150" aria-hidden="true"><circle cx="75" cy="75" r="67" pathLength="100"></circle></svg><span class="gdcrosscount">${dwellSec()}<span>s</span></span>`;
  el.appendChild(ring);
}

function crossRingReset() {
  stopDwellText();
  document.querySelectorAll(".gdcrossring").forEach((r) => r.remove());
}

function crossHoverReset() {
  stopDwellText();
  clearTimeout(crossHoverTimer);
  crossHoverTimer = 0;
  if (crossHoverEl) crossHoverEl.classList.remove("cross-hot");
  crossHoverEl = null;
  crossHoverName = "";
  crossRingReset();
}

function crossHoverStart(el, name) {
  crossHoverReset();
  crossHoverEl = el;
  crossHoverName = name;
  el.classList.add("cross-hot");
  crossRingShow(el);
  const count = el.querySelector(".gdcrosscount");
  startDwellText(count, dwellMs(), (left) => (left / 1000).toFixed(1) + "<span>s</span>");
  crossHoverTimer = setTimeout(() => {
    crossHoverTimer = 0;
    if (!crossDrag || crossDrag.phase !== "groups") return;
    crossEnterTarget(name);
  }, dwellMs());
}

function crossStart() {
  if (!gdDrag || crossDrag || S.gview === null) return;
  const source = S.gview;
  const shas = gdDrag.mode === "group" ? [...gdDrag.shas] : [gdDrag.sha];
  if (!shas.length) return;
  crossDrag = {
    phase: "groups",
    source,
    shas,
    target: null,
    targetBase: [],
    targetOrder: [],
    lineVisible: false,
  };
  if (gdSelMode) setGdSelMode(false);
  gdSel.clear();
  crossScrollStop();
  crossRingReset();
  gdDockHide();
  gdLineHide();
  S.gview = null;
  S.gq = "";
  const q = $("gq");
  if (q) q.value = "";
  setTab("groups");
  renderFolders();
  document.body.classList.add("cross-dragging");
}

function hideCrossTarget() {
  const el = $("gdcross");
  if (el) el.remove();
}

function renderCrossTarget(name, items) {
  hideCrossTarget();
  const el = document.createElement("div");
  el.id = "gdcross";
  const bytes = items.reduce((n, a) => n + (a.bytes || 0), 0);
  const same = crossDrag && crossDrag.source === name;
  el.innerHTML = `<div class="gdcrosshead"><div><b>${gdDisplayName(name)}</b><small>${items.length} 张 · ${fmtSize(bytes)}</small></div><span>${same ? "松手调整" : "松手加入"}</span></div><div class="grid gdcrossgrid" id="gdcrossgrid">${items.map((a) => cardHtml(a, new Set())).join("")}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("on"));
}

async function crossEnterTarget(name) {
  if (!crossDrag || crossDrag.phase !== "groups" || !name) return;
  crossHoverReset();
  crossScrollStop();
  const c = crossDrag;
  c.phase = "target";
  c.target = name;
  c.targetBase = [];
  c.targetOrder = [];
  c.lineVisible = false;
  gdDockHide();
  gdLineHide();
  let items = [];
  try {
    items = await invokeRetry("list_assets", {
      group: gdParam(name), q: "", limit: 1000, sort: "manual", filters: "{}"
    });
  } catch {}
  if (!crossDrag || crossDrag !== c || crossDrag.target !== name) return;
  c.targetBase = items.map((a) => a.sha);
  c.targetOrder = [...c.targetBase];
  renderCrossTarget(name, items);
  gdDockRender("继续往下拖 · 返回分组", false);
  if (gdDrag && gdDrag.lastX != null) {
    crossUpdate({ clientX: gdDrag.lastX, clientY: gdDrag.lastY });
  }
}

function crossExitTarget() {
  const c = crossDrag;
  if (!c || c.phase !== "target") return;
  crossScrollStop();
  crossHoverReset();
  crossRingReset();
  clearTimeout(gdDockTimer);
  gdDockTimer = 0;
  c.phase = "groups";
  c.target = null;
  c.targetBase = [];
  c.targetOrder = [];
  c.lineVisible = false;
  gdDockHide();
  gdLineHide();
  hideCrossTarget();
  crossHoverReset();
  const folders = $("folders");
  if (folders) folders.classList.remove("crossing");
  document.querySelectorAll(".folder.cross-source, .folder.cross-target, .folder.cross-hot").forEach((el) => el.classList.remove("cross-source", "cross-target", "cross-hot"));
  if (!S.gview) renderFolders();
}

function crossUpdate(e) {
  const c = crossDrag;
  const d = gdDrag;
  if (!c || !d) return;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  d.ghost.style.left = e.clientX - d.offsetX + "px";
  d.ghost.style.top = e.clientY - d.offsetY + "px";
  const nearBottom = e.clientY >= window.innerHeight - 90;

  if (c.phase === "groups") {
    crossScrollUpdate(e);
    gdDockHide();
    gdLineHide();
    c.lineVisible = false;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const f = hit && hit.closest ? hit.closest("#folders .folder") : null;
    const name = f && f.dataset ? (f.dataset.group || (f.dataset.fav ? FAV_NAME : "")) : "";
    if (!f || !name) {
      crossHoverReset();
      return;
    }
    const fr = f.getBoundingClientRect();
    const pad = 8;
    if (
      e.clientX < fr.left + pad || e.clientX > fr.right - pad ||
      e.clientY < fr.top + pad || e.clientY > fr.bottom - pad
    ) {
      crossHoverReset();
      return;
    }
    if (name !== crossHoverName) crossHoverStart(f, name);
    return;
  }

  // phase === "target"：在目标组详情里调插入位，或下拖回组页
  crossScrollStop();
  if (nearBottom) {
    gdLineHide();
    c.lineVisible = false;
    c.targetOrder = [];
    gdDockRender("继续往下拖 · 返回分组", true);
    if (!gdDockTimer) {
      gdDockTimer = setTimeout(() => {
        gdDockTimer = 0;
        crossExitTarget();
      }, dwellMs());
    }
    return;
  }

  clearTimeout(gdDockTimer);
  gdDockTimer = 0;
  gdDockRender("继续往下拖 · 返回分组", false);

  const grid = $("gdcrossgrid");
  if (!grid) return;
  const cards = [...grid.querySelectorAll(".card")];
  if (!cards.length) {
    const gr = grid.getBoundingClientRect();
    c.targetOrder = [...c.shas];
    c.lineVisible = true;
    gdLineShow({ left: gr.left + 18, right: gr.left + 18, top: gr.top + 8, height: Math.min(96, gr.height - 16) }, false);
    return;
  }

  let target = null;
  let best = Infinity;
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (dist < best) {
      best = dist;
      target = card;
    }
  }
  if (!target) {
    gdLineHide();
    c.lineVisible = false;
    return;
  }
  const r = target.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  const base = c.targetBase.filter((s) => !c.shas.includes(s));
  const at = base.indexOf(target.dataset.sha);
  if (at < 0) {
    gdLineHide();
    c.lineVisible = false;
    return;
  }
  const next = [...base];
  next.splice(after ? at + 1 : at, 0, ...c.shas);
  c.targetOrder = next;
  c.lineVisible = true;
  gdLineShow(r, after);
}

function cancelCrossDrag() {
  hideCrossTarget();
  gdDropCleanup();
  gdDrag = null;
  crossDrag = null;
  gdHoldFired = true;
  setTimeout(() => { gdHoldFired = false; }, 450);
  if (!S.gview) renderFolders();
}

async function endCrossDrag() {
  const c = crossDrag;
  const target = c && c.target;
  const shas = c ? [...c.shas] : [];
  const order = c ? [...c.targetOrder] : [];
  const source = c ? c.source : null;
  const count = shas.length;
  const commit = !!(c && c.phase === "target" && target && c.lineVisible && order.length);
  gdDropCleanup();
  hideCrossTarget();
  gdDrag = null;
  crossDrag = null;
  gdHoldFired = true;
  setTimeout(() => { gdHoldFired = false; }, 450);
  if (!commit) {
    if (!S.gview) renderFolders();
    return;
  }
  try {
    const mode = dragMode();
    const same = source === target;
    // 收藏夹是虚拟分组：永远按「复制」处理，源分组保持不动
    const toFav = target === FAV_NAME;
    if (toFav) {
      if (!same) await invokeRetry("batch_star", { shas, on: true });
    } else if (!same) {
      await invokeRetry("add_to_group", { shas, group: target });
    }
    await invokeRetry("set_asset_order", { key: gdParam(target), shas: order });
    if (!same && !toFav && mode === "cut" && source) {
      if (source === FAV_NAME) await invokeRetry("batch_star", { shas, on: false });
      else await invokeRetry("batch_ungroup", { shas, group: source });
    }
    await loadGroups();
    await openGroup(target);
    if (same) toast(`已调整 ${count} 张顺序`);
    else if (toFav) toast("已添加到最喜欢的分组！");
    else toast(`已${mode === "cut" ? "剪切" : "复制"} ${count} 张到「${gdDisplayName(target)}」`);
  } catch (e) {
    toast("加入失败：" + String(e));
    await loadGroups();
    if (source) await openGroup(source);
  }
}

/* ---------- 图片预览 / 多选 ---------- */

function paintImgSel() {
  document.querySelectorAll("#grid .card").forEach((c) => {
    c.classList.toggle("sel", imgSel.has(c.dataset.sha));
  });
}

// 选择态：原地切换（不搬 DOM、不弹面板）
function selShas() { return (S.items || []).map((a) => a.sha); }

function syncSel() {
  const n = $("seln");
  if (n) n.textContent = String(imgSel.size);
  const list = selShas();
  const full = list.length > 0 && list.every((s) => imgSel.has(s));
  const b = $("sel-all");
  if (b) { b.textContent = full ? "取消全选" : "全选"; b.classList.toggle("done", full); }
  for (const btn of document.querySelectorAll("#actbar button")) btn.disabled = imgSel.size === 0;
}

// 搜索/筛选把已选图筛掉后，自动取消那些看不见的选中
function pruneSel() {
  if (!imgSelMode) return false;
  const keep = new Set((S.items || []).map((a) => a.sha));
  let changed = false;
  for (const sha of [...imgSel]) {
    if (!keep.has(sha)) { imgSel.delete(sha); changed = true; }
  }
  return changed;
}

function setImgSelMode(on) {
  on = !!on;
  imgSelMode = on;
  if (!on) imgSel.clear();
  document.body.classList.toggle("select", on);
  $("selhead").hidden = !on;
  $("actbar").hidden = !on;
  $("fab").hidden = on || trashSelMode || S.tab !== "gallery";
  paintImgSel();
  syncSel();
  syncGuard();
}


// 通用：搜索框的 ✕ 清空
function bindClear(inputId, clearId, after) {
  const inp = $(inputId), btn = $(clearId);
  if (!inp || !btn) return;
  const sync = () => { btn.hidden = !inp.value; };
  inp.addEventListener("input", sync);
  btn.addEventListener("click", () => {
    inp.value = "";
    sync();
    inp.focus();
    if (after) after();
  });
  sync();
}

function toggleImgSel(sha) {
  if (imgSel.has(sha)) imgSel.delete(sha);
  else imgSel.add(sha);
  paintImgSel();
  syncSel();
}

let vIndex = 0;
let vScale = 1, vTx = 0, vTy = 0;
const vPointers = new Map();
let vPinch = null, vPan = null, vLastTap = 0;

function applyViewerTransform() {
  const img = $("v-img");
  if (img) img.style.transform = `translate(${vTx}px, ${vTy}px) scale(${vScale})`;
}
function resetViewerTransform() {
  vScale = 1; vTx = 0; vTy = 0;
  vPointers.clear(); vPinch = null; vPan = null;
  applyViewerTransform();
}
function clampViewScale(n) {
  return Math.max(1, Math.min(5, n));
}

function fmtSource(src) {
  const map = { wechat: "微信", qq: "QQ", file: "文件", folder: "文件夹", clipboard: "剪贴板", share: "分享", desktop: "桌面" };
  return "来自" + (map[src] || src || "未知");
}

function viewerList() {
  return (S.gview ? gdItems : S.items) || [];
}

function viewerAsset() {
  return viewerList()[vIndex] || {};
}

function renderViewer() {
  const a = viewerAsset();
  const list = viewerList();
  $("v-count").textContent = `${list.length ? vIndex + 1 : 0} / ${list.length}`;
  $("v-name").textContent = a.name || "未命名";
  // 预览用原图，放大后仍然清晰
  $("v-img").src = thumbUrl(a.sha, true);
  const bits = [];
  if (a.width && a.height) bits.push(`${a.width} × ${a.height}`);
  if (a.bytes) bits.push(fmtSize(a.bytes));
  if (a.added_at) bits.push(String(a.added_at).slice(0, 10));
  if (a.source) bits.push(fmtSource(a.source));
  $("v-meta").textContent = bits.join(" · ");
  const tags = [];
  (a.groups || []).forEach((g) => tags.push(`<span class="vtag">${escapeHtml(g)}</span>`));
  tags.push(`<span class="vtag">${a.animated ? "GIF" : "图片"}</span>`);
  (a.tags || []).forEach((t) => tags.push(`<span class="vtag tag">${escapeHtml(t)}</span>`));
  tags.push('<span class="vtag plus" id="v-tag-add">+ 标签</span>');
  tags.push(`<button class="vtag addgrp" id="v-addgroup">${SVG.folder}加入分组</button>`);
  $("v-tags").innerHTML = tags.join("");
  const on = !!a.starred;
  $("v-star").innerHTML = (on ? SVG.starFill : SVG.star) + `<span>${on ? "已收藏" : "收藏"}</span>`;
  $("v-star").classList.toggle("on", on);
  resetViewerTransform();
  const hint = $("v-hint");
  hint.classList.remove("fade");
  clearTimeout(window.__vhintTimer);
  window.__vhintTimer = setTimeout(() => hint.classList.add("fade"), 2400);
}

function openViewer(sha) {
  const list = viewerList();
  const idx = list.findIndex((x) => x.sha === sha);
  vIndex = idx < 0 ? 0 : idx;
  renderViewer();
  $("viewer").hidden = false;
  document.body.style.overflow = "hidden";
  syncGuard();
}

function closeViewer() {
  $("viewer").hidden = true;
  $("v-img").removeAttribute("src");
  resetViewerTransform();
  if (!document.body.classList.contains("multi")) document.body.style.overflow = "";
  syncGuard();
}

function stepViewer(delta) {
  const list = viewerList();
  if (!list.length) return;
  const next = Math.min(list.length - 1, Math.max(0, vIndex + delta));
  if (next === vIndex) return;
  vIndex = next;
  renderViewer();
}

async function loadTrashDays() {
  try {
    TRASH_DAYS = (await invokeRetry("get_trash_days")) || 7;
  } catch {
    /* 读不到就先用默认 7 天 */
  }
  renderMe();
}

function backGroups() {
  if (gdSelMode) setGdSelMode(false);
  closeGmenu();
  S.gview = null;
  gdItems = [];
  gdQ = "";
  gdSel.clear();
  document.body.classList.remove("gdselect");
  $("gdactbar").hidden = true;
  $("gdselhead").hidden = true;
  $("gdhead").hidden = false;
  $("groupdetail").hidden = true;
  $("groupsview").hidden = false;
  $("fab").hidden = false;
  $("fab").title = "新建分组";
  renderFolders();
  syncGuard();
}

/* ---------- 返回分层：系统返回键先收最上面一层 ---------- */
/* 返回键由原生层（MainActivity.onWebViewCreate 里的 OnBackPressedCallback）转给
   window.__sbBack()：有层就收一层并返回 true；没有层返回 false，原生层才结束 Activity。 */
function activeLayer() {
  const shown = (id) => { const el = $(id); return el && !el.hidden; };
  if (shown("lightbox")) return { close: () => closeLightbox() };
  if (shown("sheetmask")) return { close: () => { if (sheetResolve) { sheetResolve(false); sheetResolve = null; } closeSheet(); } };
  if (shown("gmenu")) return { close: () => closeGmenu() };
  if (shown("filtermask")) return { close: () => { $("filtermask").hidden = true; syncGuard(); } };
  if (shown("pickmask")) return { close: exitPicker };
  if (imgSelMode) return { close: () => setImgSelMode(false) };
  if (shown("viewer")) return { close: () => closeViewer() };
  if (trashSelMode) return { close: () => setTrashSelMode(false) };
  if (gdSelMode) return { close: () => setGdSelMode(false) };
  if (selMode) return { close: () => setSelMode(false) };
  if (S.tab === "groups" && S.gview) return { close: () => backGroups() };
  if (S.tab !== "gallery") return { close: () => setTab("gallery") };
  return null;
}

// 各开关处都会调它；返回分层改由原生回调驱动后，这里不再需要压 history。
function syncGuard() {}

function sbBack() {
  const layer = activeLayer();
  if (!layer) return false;
  try { layer.close(); } catch (_) {}
  return true;
}
window.__sbBack = sbBack;

/* ---------- 底部弹层 ---------- */

function openSheet(title, bodyHtml) {
  resetSheetHeight(document.querySelector("#sheetmask .sheet"));
  $("sheet-title").textContent = title;
  $("sheet-body").innerHTML = bodyHtml;
  $("sheetmask").hidden = false;
  syncGuard();
}
function closeSheet() {
  $("sheetmask").hidden = true;
  $("sheet-body").innerHTML = "";
  syncGuard();
}
let sheetResolve = null;

function confirmSheet(text, title = "确认", okText = "确定") {
  return new Promise((resolve) => {
    sheetResolve = resolve;
    openSheet(
      title,
      `<div class="snote">${escapeHtml(text)}</div>${sheetActions(okText, "sheet-ok", /删除|清空/.test(okText))}`
    );
    $("sheet-body").onclick = (e) => {
      if (e.target.id === "sheet-cancel") {
        sheetResolve = null;
        closeSheet();
        resolve(false);
      } else if (e.target.id === "sheet-ok") {
        sheetResolve = null;
        closeSheet();
        resolve(true);
      }
    };
  });
}

function sheetActions(okText, okId, danger = false) {
  return `<div class="sheet-actions"><button id="sheet-cancel">取消</button><button class="primary${danger ? " danger" : ""}" id="${okId}">${okText}</button></div>`;
}

function closeGmenu() {
  const m = $("gmenu");
  if (m) m.hidden = true;
}

/** 存一批图到系统相册（安卓写 Pictures/StickerBox）。 */
async function saveAlbum(shas) {
  const done = [];
  let fail = 0;
  for (const sha of shas) {
    try {
      await invoke("save_to_gallery", { sha });
      done.push(sha);
    } catch {
      fail += 1;
    }
  }
  if (done.length) await markUsed(done);
  if (!fail) toast(`已存 ${done.length} 张到相册 Pictures/StickerBox`);
  else if (!done.length) toast(`保存失败 ${fail} 张`);
  else toast(`已存 ${done.length} 张，${fail} 张失败`);
}

async function gdAction(act) {
  const shas = [...gdSel];
  if (!shas.length) return;
  if (act === "send") {
    try {
      await invoke("share_assets", { shas });
      await markUsed(shas);
      toast(`已发送 ${shas.length} 张`);
    } catch (e) {
      toast("发送失败：" + String(e));
    }
    return;
  }
  if (act === "tag") return toast("标签在后面的批次接上");
  if (act === "add") {
    openGroupPicker(shas);
    return;
  }
  if (act === "album") {
    await saveAlbum(shas);
    return;
  }
  if (act === "remove") {
    const isFav = S.gview === FAV_NAME;
    const ok = await confirmSheet(
      isFav
        ? `${shas.length} 张图会从收藏夹移除，图片不会被删除。`
        : `把 ${shas.length} 张图移出「${gdDisplayName(S.gview)}」？图片不会被删除。`,
      isFav ? "取消收藏" : "移出当前分组",
      isFav ? "取消收藏" : "移出"
    );
    if (!ok) return;
    try {
      if (isFav) await invokeRetry("batch_star", { shas, on: false });
      else await invokeRetry("batch_ungroup", { shas, group: S.gview });
      setGdSelMode(false);
      await loadGroup();
      await loadGroups();
      toast(isFav ? `已取消收藏 ${shas.length} 张` : `已移出 ${shas.length} 张`);
    } catch (e) {
      toast((isFav ? "取消收藏失败：" : "移出失败：") + String(e));
    }
    return;
  }
  if (act === "delete") {
    const ok = await confirmSheet(`${shas.length} 张图会先放进回收站，可在回收站恢复；超过保留天数后才会真正清理。`, "删除图片", "删除");
    if (!ok) return;
    try {
      for (const sha of shas) await invokeRetry("delete_asset", { sha });
      setGdSelMode(false);
      await loadGroup();
      await loadGroups();
      toast(`已删除 ${shas.length} 张`);
    } catch (e) {
      toast("删除失败：" + String(e));
    }
  }
}

function openGroupMenu(name) {
  closeGmenu();
  const isFav = name === FAV_NAME;
  const items = isFav
    ? [["cover", "更换封面"], ["info", "详细信息"]]
    : [["cover", "更换封面"], ["sort", "排序"], ["merge", "并入其他分组"], ["rename", "重命名"], ["info", "详细信息"]];
  const box = $("gmenu");
  box.innerHTML = items.map(([act, label]) => `<button data-gmact="${act}">${label}</button>`).join("");
  box.hidden = false;
  syncGuard();
}

function gmenuAction(act) {
  const name = S.gview;
  if (!name) return;
  closeGmenu();
  if (act === "cover") {
    if (name === FAV_NAME) openFavCoverPicker();
    else openCoverPicker(name);
  } else if (act === "sort") openSortSheet();
  else if (act === "merge") openMergeSheet();
  else if (act === "rename") openRename(name);
  else if (act === "info") openGroupInfo();
}

async function togglePin(name) {
  const next = S.pinned.includes(name)
    ? S.pinned.filter((x) => x !== name)
    : [...S.pinned, name];
  try {
    await invokeRetry("set_pinned_groups", { groups: next });
    await loadGroups();
    toast(next.includes(name) ? "已置顶" : "已取消置顶");
  } catch (e) {
    toast("置顶失败：" + String(e));
  }
}

function openRename(name) {
  openSheet(
    "重命名分组",
    `<input class="minput" id="rename-input" value="${escapeAttr(name)}" />
     ${sheetActions("保存", "rename-ok")}`
  );
  const inp = $("rename-input");
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  $("sheet-cancel").onclick = closeSheet;
  $("rename-ok").onclick = async () => {
    const v = inp.value.trim();
    if (!v || v === name) return closeSheet();
    try {
      await invokeRetry("rename_group", { old: name, new: v });
      closeSheet();
      await loadGroups();
      if (S.gview === name) {
        S.gview = v;
        $("gd-title").textContent = v;
      }
      toast("已改名");
    } catch (e) {
      toast("改名失败：" + String(e));
    }
  };
}

function openNewGroup() {
  openSheet(
    "新建分组",
    `<input class="minput" id="newgroup-input" placeholder="分组名" />
     ${sheetActions("创建", "newgroup-ok")}`
  );
  const inp = $("newgroup-input");
  inp.focus();
  $("sheet-cancel").onclick = closeSheet;
  $("newgroup-ok").onclick = async () => {
    const v = inp.value.trim();
    if (!v) return toast("先写个名字");
    try {
      await invokeRetry("create_group", { name: v });
      closeSheet();
      await loadGroups();
      if (!$("pickmask").hidden) { pickSel = v; renderPicker(); }
      toast("分组已创建");
    } catch (e) {
      toast("创建失败：" + String(e));
    }
  };
}

function openDeleteGroup(name) {
  openSheet(
    `删除「${name}」`,
    `<div class="shnote">只解散分组，组里的图会回到「未分组」，不会被删除。</div>
     ${sheetActions("删除", "del-ok")}`
  );
  $("sheet-cancel").onclick = closeSheet;
  $("del-ok").onclick = async () => {
    try {
      await invokeRetry("remove_group", { name, deleteAssets: false });
      closeSheet();
      if (S.gview === name) backGroups();
      await loadGroups();
      toast("分组已删除");
    } catch (e) {
      toast("删除失败：" + String(e));
    }
  };
}

async function openCoverPicker(name) {
  if (name === FAV_NAME) return openFavCoverPicker();
  openSheet(`换封面 · ${name}`, '<div class="spinner">正在读取…</div>');
  try {
    const items = await invokeRetry("list_assets", { q: "", group: name, limit: 300 });
    if (!items.length) {
      $("sheet-body").innerHTML = '<div class="gempty">这个分组还没有图，先加几张再选封面。</div>';
      return;
    }
    const cur = (S.groupList.find((g) => g.name === name) || {}).cover;
    $("sheet-body").innerHTML =
      '<div class="coverpick">' +
      items
        .map(
          (a) =>
            `<button data-cover="${escapeAttr(a.sha)}" class="${a.sha === cur ? "on" : ""}">
              <img src="${thumbUrl(a.sha)}" alt="" loading="lazy" onerror="this.remove()">
            </button>`
        )
        .join("") +
      '</div><div class="shnote">点一张设为封面</div>';
    $("sheet-body").onclick = async (e) => {
      const b = e.target.closest("button[data-cover]");
      if (!b) return;
      try {
        await invokeRetry("set_group_cover", { group: name, sha: b.dataset.cover });
        closeSheet();
        await loadGroups();
        if (S.gview === name) await loadGroup();
        toast("封面已更新");
      } catch (err) {
        toast("换封面失败：" + String(err));
      }
    };
  } catch (e) {
    $("sheet-body").innerHTML = '<div class="gempty">读取失败：' + escapeHtml(String(e)) + "</div>";
  }
}

async function openFavCoverPicker() {
  openSheet("换封面 · 收藏夹", '<div class="spinner">正在读取…</div>');
  try {
    const items = await invokeRetry("list_assets", { q: "", group: "__star__", limit: 300 });
    if (!items.length) {
      $("sheet-body").innerHTML = '<div class="gempty">收藏夹还没有图，先收藏几张再选封面。</div>';
      return;
    }
    const cur = S.starredCover;
    $("sheet-body").innerHTML =
      '<div class="coverpick">' +
      items
        .map(
          (a) =>
            `<button data-cover="${escapeAttr(a.sha)}" class="${a.sha === cur ? "on" : ""}">
              <img src="${thumbUrl(a.sha)}" alt="" loading="lazy" onerror="this.remove()">
            </button>`
        )
        .join("") +
      '</div><div class="shnote">点一张设为收藏夹封面</div>';
    $("sheet-body").onclick = async (e) => {
      const b = e.target.closest("button[data-cover]");
      if (!b) return;
      try {
        await invokeRetry("set_starred_cover", { sha: b.dataset.cover });
        closeSheet();
        await loadGroups();
        if (S.gview === FAV_NAME) await loadGroup();
        toast("封面已更新");
      } catch (err) {
        toast("换封面失败：" + String(err));
      }
    };
  } catch (e) {
    $("sheet-body").innerHTML = '<div class="gempty">读取失败：' + escapeHtml(String(e)) + "</div>";
  }
}

function openSortSheet() {
  const opts = [
    ["manual", "手动排序"],
    ["", "最新入库"],
    ["oldest", "最旧入库"],
    ["size", "大小（大→小）"],
    ["name", "名称 A→Z"],
  ];
  const cur = S.gFilters.sort == null ? "manual" : S.gFilters.sort;
  openSheet(
    "排序",
    `<div class="menu">${opts
      .map(([v, label]) => `<button data-sort="${v}" class="${v === cur ? "on" : ""}">${label}</button>`)
      .join("")}</div><div class="snote">排序只影响组内图片，不改变分组顺序。</div>`
  );
  $("sheet-body").onclick = async (e) => {
    const b = e.target.closest("button[data-sort]");
    if (!b) return;
    const next = b.dataset.sort;
    if (cur === "manual" && next !== "manual") {
      const ok = await confirmSheet("切换后手动排序顺序仍会保留，切回手动时恢复。", "切换排序", "切换");
      if (!ok) return;
    }
    S.gFilters.sort = next;
    closeSheet();
    loadGroup();
    renderGdFilter();
    toast("已更新排序");
  };
}

async function openGroupInfo() {
  const name = S.gview;
  if (!name) return;
  const isFav = name === FAV_NAME;
  const g = S.groupList.find((x) => x.name === name);
  const count = gdCount(name);
  const bytes = gdBytes(name);
  const cover = isFav ? S.starredCover : g && g.cover;
  const pinned = isFav ? "—" : g && g.pinned ? "是" : "否";
  let all = gdItems;
  if (gdItems.length < count) {
    openSheet("详细信息", '<div class="spinner">正在读取…</div>');
    try {
      all = await invokeRetry("list_assets", {
        q: "",
        group: gdParam(name),
        limit: 2000,
        sort: "added",
        filters: "{}",
      });
    } catch {
      all = gdItems;
    }
  }
  const added = all.map((a) => a.added_at).filter(Boolean).sort().pop();
  const recent = added ? String(added).replace("T", " ").slice(0, 16) : "—";
  const gif = all.filter((a) => a.animated).length;
  const still = all.length - gif;
  const rows = [
    ["分组名", gdDisplayName(name)],
    ["图片数量", `${count} 张`],
    ["总大小", bytes ? fmtSize(bytes) : "—"],
    ["封面", cover ? "自定义" : "默认"],
    ["置顶", pinned],
    ["最近添加", recent],
    ["图片构成", all.length ? `${gif} 张 GIF · ${still} 张静态` : "—"],
    ["创建时间", "—"],
  ];
  const note =
    "只读 · 数据来自本地索引" +
    (all.length < count ? `；图片构成为已加载的 ${all.length} 张` : "") +
    "；创建时间索引暂未记录";
  openSheet(
    "详细信息",
    `<div class="kv">${rows
      .map(([k, v]) => `<div class="kvrow"><span>${k}</span><b>${escapeHtml(v)}</b></div>`)
      .join("")}</div><div class="snote">${escapeHtml(note)}</div>`
  );
}

async function openMergeSheet() {
  const name = S.gview;
  if (!name || name === FAV_NAME) return;
  const targets = S.groupList.filter((g) => g.name !== name);
  if (!targets.length) return toast("没有其他分组可以并入");
  mergeTarget = "";
  openSheet("并入其他分组", '<div class="spinner">正在读取…</div>');
  let all = [];
  try {
    all = await invokeRetry("list_assets", { q: "", group: name, limit: 2000 });
  } catch (e) {
    $("sheet-body").innerHTML = '<div class="gempty">读取失败：' + escapeHtml(String(e)) + "</div>";
    return;
  }
  $("sheet-body").innerHTML =
    `<div class="mergelist">${targets
      .map(
        (g) =>
          `<button class="merge-row" data-merge="${escapeAttr(g.name)}"><span class="mname">${escapeHtml(g.name)}</span><span class="mcount">${g.count} 张</span></button>`
      )
      .join("")}</div>` +
    `<div class="snote">并入后「${escapeHtml(name)}」会解散，${all.length} 张图只移动、不删除。</div>` +
    `<div class="sheet-actions"><button id="merge-cancel">取消</button><button class="primary" id="merge-ok" disabled>并入</button></div>`;
  $("sheet-body").onclick = async (e) => {
    const row = e.target.closest("button[data-merge]");
    if (row) {
      mergeTarget = row.dataset.merge;
      for (const b of $("sheet-body").querySelectorAll("button[data-merge]")) b.classList.toggle("on", b === row);
      const ok = $("merge-ok");
      ok.disabled = false;
      ok.textContent = `并入「${mergeTarget}」`;
      return;
    }
    if (e.target.id === "merge-cancel") return closeSheet();
    if (e.target.id !== "merge-ok" || !mergeTarget) return;
    const target = mergeTarget;
    try {
      if (all.length) await invokeRetry("add_to_group", { shas: all.map((a) => a.sha), group: target });
      await invokeRetry("remove_group", { name, deleteAssets: false });
      closeSheet();
      backGroups();
      await loadGroups();
      toast(`已并入「${target}」`);
    } catch (err) {
      toast("并入失败：" + String(err));
    }
  };
}


/* ---------- 批 7：多选 / 拖拽 / 置顶管理 ---------- */

function resetHold() {
  clearTimeout(holdTimer);
  if (holdInfo && holdInfo.card) holdInfo.card.classList.remove("lift");
  holdInfo = null;
}

function armFolderHold() {
  if (!holdInfo) return;
  holdInfo.armed = true;
  holdInfo.card.classList.add("lift");
  if (navigator.vibrate) navigator.vibrate(12);
}

function finishFolderHold() {
  const info = holdInfo;
  if (!info) return;
  clearTimeout(holdTimer);
  if (dragCtx) {
    endFolderDrag();
    return;
  }
  info.card.classList.remove("lift");
  holdInfo = null;
  if (info.armed) {
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 450);
    if (!selMode) setSelMode(true);
    toggleSel(info.name);
  }
}

function setSelMode(on) {
  selMode = on;
  if (!on) sel.clear();
  renderFolders(true);
  syncGuard();
}

function gselAll() {
  const names = [...document.querySelectorAll("#folders .folder[data-group]")].map((f) => f.dataset.group);
  if (!names.length) return;
  const full = names.every((n) => sel.has(n));
  if (full) sel.clear();
  else names.forEach((n) => sel.add(n));
  if (sel.size === 0) selMode = false;
  renderFolders(true);
}

function toggleSel(name) {
  if (sel.has(name)) sel.delete(name);
  else sel.add(name);
  if (selMode && sel.size === 0) {
    selMode = false;
    renderFolders(true);
    return;
  }
  renderFolders(true);
}

function captureFolderRects() {
  const map = new Map();
  document.querySelectorAll("#folders .folder[data-group]").forEach((el) => {
    map.set(el.dataset.group, el.getBoundingClientRect());
  });
  return map;
}

function flipFolders(before) {
  document.querySelectorAll("#folders .folder[data-group]").forEach((el) => {
    const old = before.get(el.dataset.group);
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform .24s cubic-bezier(.22,.85,.28,1)";
      el.style.transform = "";
    });
  });
}

let folderDropEl = null;

function folderZone(name) {
  const pinned = S.pinned.includes(name);
  const names = pinned
    ? S.pinned.filter((n) => S.groupList.some((g) => g.name === n))
    : S.groupList.filter((g) => !S.pinned.includes(g.name)).map((g) => g.name);
  return { pinned, names };
}

function ensureFolderDrop() {
  if (!folderDropEl) {
    folderDropEl = document.createElement("div");
    folderDropEl.id = "folder-drop";
    document.body.appendChild(folderDropEl);
  }
  return folderDropEl;
}

function hideFolderDrop() {
  if (folderDropEl) folderDropEl.style.display = "none";
}

function clearFolderDragVisuals() {
  document.querySelectorAll(".folder.ghost").forEach((el) => el.remove());
  document.querySelectorAll("#folders .dragsrc").forEach((el) => el.classList.remove("dragsrc"));
  document.querySelectorAll("#folders .lift").forEach((el) => el.classList.remove("lift"));
  document.body.classList.remove("folder-dragging");
  if (folderDropEl) {
    folderDropEl.remove();
    folderDropEl = null;
  }
}

function cancelFolderDrag() {
  const d = dragCtx;
  dragCtx = null;
  clearFolderDragVisuals();
  resetHold();
  if (d) {
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 450);
  }
}

function beginFolderDrag(e) {
  const info = holdInfo;
  if (!info) return;
  if (selMode) return;
  if (S.gq.trim()) {
    toast("清空搜索后再拖拽排序");
    resetHold();
    return;
  }
  const zone = folderZone(info.name);
  const r = info.card.getBoundingClientRect();
  dragCtx = {
    name: info.name,
    pinned: zone.pinned,
    order: zone.names.slice(),
    changed: false,
    offX: info.x - r.left,
    offY: info.y - r.top,
    w: r.width,
    h: r.height,
    ghost: info.card.cloneNode(true),
    moved: false,
  };
  const g = dragCtx.ghost;
  g.classList.remove("lift");
  g.classList.add("ghost");
  g.style.left = r.left + "px";
  g.style.top = r.top + "px";
  g.style.width = r.width + "px";
  g.style.height = r.height + "px";
  document.body.appendChild(g);
  info.card.classList.add("dragsrc");
  document.body.classList.add("folder-dragging");
  ensureFolderDrop();
  if (navigator.vibrate) navigator.vibrate(16);
}

function updateFolderDrag(e) {
  const d = dragCtx;
  if (!d) return;
  d.moved = true;
  d.ghost.style.left = e.clientX - d.offX + "px";
  d.ghost.style.top = e.clientY - d.offY + "px";
  if (selMode || S.gq.trim()) return;

  const cards = [...document.querySelectorAll("#folders .folder[data-group]")].filter(
    (c) =>
      c.dataset.group !== d.name &&
      S.pinned.includes(c.dataset.group) === d.pinned
  );
  if (!cards.length) {
    hideFolderDrop();
    return;
  }
  let best = 0;
  let bestD = Infinity;
  cards.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = dx * dx + dy * dy;
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  });
  const target = cards[best];
  const rect = target.getBoundingClientRect();
  const after = e.clientX > rect.left + rect.width / 2;
  const current = folderZone(d.name).names;
  const rest = current.filter((n) => n !== d.name);
  const pos = rest.indexOf(target.dataset.group) + (after ? 1 : 0);
  const next = rest.slice();
  next.splice(pos, 0, d.name);
  d.order = next;
  d.changed = next.length !== current.length || next.some((n, i) => n !== current[i]);

  const line = ensureFolderDrop();
  line.style.display = "block";
  line.style.left = (after ? rect.right + 3 : rect.left - 6) + "px";
  line.style.top = rect.top + 8 + "px";
  line.style.height = Math.max(24, rect.height - 16) + "px";
}

async function endFolderDrag() {
  const d = dragCtx;
  dragCtx = null;
  if (!d) return;
  clearFolderDragVisuals();
  resetHold();
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 450);
  if (!d.moved || !d.changed || !d.order) return;

  const before = captureFolderRects();
  try {
    if (d.pinned) {
      S.pinned = d.order.slice();
      renderFolders(true);
      flipFolders(before);
      await invokeRetry("set_pinned_groups", { groups: S.pinned });
    } else {
      const pinned = S.pinned.filter((n) => S.groupList.some((g) => g.name === n));
      const full = [...pinned, ...d.order];
      S.groupList = full
        .map((n) => S.groupList.find((g) => g.name === n))
        .filter(Boolean);
      renderFolders(true);
      flipFolders(before);
      await invokeRetry("set_group_order", { order: full });
    }
    await loadGroups();
    toast(d.pinned ? "置顶顺序已保存" : "分组顺序已保存");
  } catch (err) {
    await loadGroups();
    toast("保存顺序失败：" + String(err));
  }
}

/* 置顶分组拖拽排序（展开时可用） */
let pinDrag = null;

function wirePinDrag() {
  const pins = $("pins");
  let timer = 0;
  pins.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".pin[data-group]");
    if (!b || !S.pinsOpen || S.pinned.length < 2) return;
    const start = { x: e.clientX, y: e.clientY, name: b.dataset.group, card: b, armed: false };
    pinDrag = start;
    clearTimeout(timer);
    timer = setTimeout(() => {
      start.armed = true;
      const r = b.getBoundingClientRect();
      start.offX = start.x - r.left;
      start.w = r.width;
      const g = b.cloneNode(true);
      g.classList.add("ghost");
      g.style.left = r.left + "px";
      g.style.top = r.top + "px";
      g.style.width = r.width + "px";
      document.body.appendChild(g);
      start.ghost = g;
      b.classList.add("dragsrc");
      if (navigator.vibrate) navigator.vibrate(12);
    }, 320);
  });
  pins.addEventListener("pointermove", (e) => {
    if (!pinDrag || !pinDrag.armed) {
      if (pinDrag && (Math.abs(e.clientX - pinDrag.x) > 8 || Math.abs(e.clientY - pinDrag.y) > 8)) {
        clearTimeout(timer);
        pinDrag = null;
      }
      return;
    }
    e.preventDefault();
    const d = pinDrag;
    d.ghost.style.left = e.clientX - d.offX + "px";
    d.ghost.style.top = e.clientY - 20 + "px";
    const cards = [...document.querySelectorAll("#pins .pin[data-group]")].filter(
      (c) => c.dataset.group !== d.name
    );
    if (!cards.length) return;
    let best = 0;
    let bestD = Infinity;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (dist < bestD) { bestD = dist; best = i; }
    });
    const target = cards[best];
    const r = target.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    const order = S.pinned.filter((n) => n !== d.name);
    const pos = order.indexOf(target.dataset.group) + (after ? 1 : 0);
    order.splice(pos, 0, d.name);
    if (order.join("\u0001") === S.pinned.join("\u0001")) return;
    S.pinned = order;
    const before = new Map();
    document.querySelectorAll("#pins .pin[data-group]").forEach((el) => {
      before.set(el.dataset.group, el.getBoundingClientRect());
    });
    renderPins();
    document.querySelectorAll("#pins .pin[data-group]").forEach((el) => {
      const old = before.get(el.dataset.group);
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      if (Math.abs(dx) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform .22s cubic-bezier(.22,.85,.28,1)";
        el.style.transform = "";
      });
    });
  }, { passive: false });
  pins.addEventListener("pointerup", async () => {
    clearTimeout(timer);
    const d = pinDrag;
    pinDrag = null;
    if (!d || !d.armed) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 450);
    if (d.ghost) d.ghost.remove();
    document.querySelectorAll("#pins .dragsrc").forEach((el) => el.classList.remove("dragsrc"));
    try {
      await invokeRetry("set_pinned_groups", { groups: S.pinned.filter((n) => S.groupList.some((g) => g.name === n)) });
      await loadGroups();
      toast("置顶顺序已保存");
    } catch (err) {
      toast("保存失败：" + String(err));
    }
  });
  pins.addEventListener("pointercancel", () => {
    clearTimeout(timer);
    if (pinDrag && pinDrag.ghost) pinDrag.ghost.remove();
    pinDrag = null;
  });
}

/* 批量操作 */
async function batchSetPin(on) {
  const names = [...sel];
  if (!names.length) return;
  const rest = S.pinned.filter((n) => !names.includes(n));
  const next = on ? [...rest, ...names] : rest;
  try {
    await invokeRetry("set_pinned_groups", { groups: next });
    setSelMode(false);
    await loadGroups();
    toast(on ? `已置顶 ${names.length} 个分组` : `已取消置顶 ${names.length} 个`);
  } catch (err) {
    toast("操作失败：" + String(err));
  }
}

async function batchGroupRemove(deleteAssets) {
  const names = [...sel];
  if (!names.length) return;
  const picked = S.groupList.filter((g) => names.includes(g.name));
  if (!picked.length) return;
  const total = picked.reduce((n, g) => n + g.count, 0);
  const danger = !!deleteAssets;
  const title = danger
    ? `删除 ${picked.length} 个分组及组内 ${total} 张图？`
    : `解散 ${picked.length} 个分组？`;
  const note = danger
    ? `分组会被移除，${total} 张图先放进回收站，可在回收站恢复；超过保留天数后才会真正清理。`
    : `只移除分组，${total} 张图回到「未分组」，不会被删除。`;
  openSheet(title, `<div class="shnote">${note}</div>${sheetActions(danger ? "删除" : "解散分组", "batch-del")}`);
  $("sheet-cancel").onclick = closeSheet;
  if (danger) $("batch-del").classList.add("danger");
  $("batch-del").onclick = async () => {
    try {
      for (const n of names) await invokeRetry("remove_group", { name: n, deleteAssets: danger });
      closeSheet();
      setSelMode(false);
      await loadGroups();
      toast(danger ? `已删除 ${picked.length} 个分组，${total} 张图已移入回收站` : `已解散 ${picked.length} 个分组`);
    } catch (err) {
      toast((danger ? "删除失败：" : "解散失败：") + String(err));
    }
  };
}

function batchSingle(act) {
  const names = [...sel];
  if (names.length !== 1) return toast("这个操作一次选一个分组");
  const name = names[0];
  setSelMode(false);
  if (act === "cover") openCoverPicker(name);
  if (act === "rename") openRename(name);
}

/* 置顶管理：置顶哪些 + 显示几个 */
function daysLeft(item) {
  const t = item.deleted_at ? new Date(item.deleted_at).getTime() : Date.now();
  return Math.max(0, TRASH_DAYS - Math.floor((Date.now() - t) / 86400000));
}

async function loadTrash() {
  const grid = $("trash-grid");
  grid.innerHTML = `<div class="empty">正在读取…</div>`;
  let items = [];
  try {
    items = await invokeRetry("trash_list", { q: null, filters: filterJson(S.tFilters) });
  } catch (e) {
    grid.innerHTML = `<div class="empty">读取失败：${escapeHtml(String(e))}</div>`;
    return;
  }
  S.trashItems = items;
  $("btn-tfilter").classList.toggle("active", hasFilters(S.tFilters));
  $("tcount").textContent = items.length ? ` ${items.length} 张` : "";
  $("trash-meta").textContent = `删除的图片会在这里保留 ${TRASH_DAYS} 天，期间可以恢复或彻底删除。`;
  if (!items.length) {
    grid.innerHTML = `<div class="empty">回收站是空的。<br><small>删除的表情会先放这里，${TRASH_DAYS} 天后自动清理。</small></div>`;
    return;
  }
  grid.innerHTML = items
    .map(
      (it) => `<button class="titem${trashSel.has(it.sha) ? " sel" : ""}" data-sha="${escapeAttr(it.sha)}">
        <span class="tcheck">${SVG.check}</span>
        <span class="tthumb"><img src="${thumbUrl(it.sha)}" alt="" loading="lazy" onerror="this.remove()"></span>
        <span class="tname">${escapeHtml(it.name || "未命名")}</span>
        <span class="tsub">${daysLeft(it)} 天后清理</span>
      </button>`
    )
    .join("");
}

function paintTrashSel() {
  document.querySelectorAll("#trash-grid .titem").forEach((c) => {
    c.classList.toggle("sel", trashSel.has(c.dataset.sha));
  });
  $("trashn").textContent = String(trashSel.size);
}

function setTrashSelMode(on) {
  trashSelMode = on;
  if (on) closeSheet();
  if (!on) trashSel.clear();
  $("trashsel").hidden = !on;
  $("fab").hidden = on || imgSelMode;
  $("tcount").textContent = on
    ? ` 已选 ${trashSel.size} 张`
    : (S.trashItems || []).length ? ` ${S.trashItems.length} 张` : "";
  paintTrashSel();
}

function toggleTrashSel(sha) {
  if (trashSel.has(sha)) trashSel.delete(sha);
  else trashSel.add(sha);
  if (!trashSel.size) return setTrashSelMode(false);
  paintTrashSel();
  $("tcount").textContent = ` 已选 ${trashSel.size} 张`;
}

async function trashBatchRestore() {
  const shas = [...trashSel];
  if (!shas.length) return;
  try {
    for (const sha of shas) await invoke("trash_restore", { sha });
    closeSheet();
    toast(`已恢复 ${shas.length} 张`);
    setTrashSelMode(false);
    await loadTrash();
    await refresh();
  } catch (e) {
    toast("恢复失败：" + e);
  }
}

async function trashBatchDelete() {
  const shas = [...trashSel];
  if (!shas.length) return;
  if (!(await confirmSheet(`彻底删除选中的 ${shas.length} 张？文件会被删掉，不能恢复。`))) return;
  try {
    for (const sha of shas) await invoke("trash_delete", { sha, permanent: true });
    closeSheet();
    toast(`已彻底删除 ${shas.length} 张`);
    setTrashSelMode(false);
    await loadTrash();
    await refresh();
  } catch (e) {
    toast("删除失败：" + e);
  }
}

function openTrashItem(sha) {
  const it = (S.trashItems || []).find((x) => x.sha === sha);
  if (!it) return;
  openSheet(
    it.name || "未命名",
    `<div class="menu">
      <button data-act="restore">恢复这张</button>
      <button data-act="purge" class="danger">彻底删除</button>
    </div>`
  );
  $("sheet-body").onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    closeSheet();
    try {
      if (act === "restore") {
        await invoke("trash_restore", { sha });
        toast("已恢复");
      } else if (act === "purge") {
        if (!(await confirmSheet("彻底删除这张？文件会被删掉，不能恢复。"))) return;
        await invoke("trash_delete", { sha, permanent: true });
        toast("已彻底删除");
      }
      await loadTrash();
      await refresh();
    } catch (err) {
      toast("操作失败：" + err);
    }
  };
}

async function purgeTrash() {
  if (!(S.trashItems || []).length) return toast("回收站已经是空的");
  if (!(await confirmSheet("清空回收站？所有文件都会被彻底删除，不能恢复。"))) return;
  try {
    const n = await invoke("trash_purge", { permanent: true });
    toast(`已清空 ${n} 张`);
    await loadTrash();
    await refresh();
  } catch (e) {
    toast("清空失败：" + e);
  }
}

// ---- 我的 ----
function resolveTheme() {
  const v = localStorage.getItem("sb.theme") || "auto";
  if (v !== "auto") return v;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyPrefs() {
  const theme = resolveTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.fav = localStorage.getItem("sb.fav") || "heart";
  const cols = Number(localStorage.getItem("sb.cols")) || 3;
  document.documentElement.style.setProperty("--cols", String(cols));
  document.documentElement.style.setProperty("--gd-dwell", dwellMs() + "ms");
  const gcols = groupCols();
  document.documentElement.style.setProperty("--gcols", String(gcols));
  document.documentElement.style.setProperty("--gcover", gcols === 2 ? "170px" : gcols === 3 ? "118px" : "88px");
}

function renderMe() {
  $("me-home").textContent = (S.stats && S.stats.root) || "—";
  $("me-inbox-n").textContent = S.sharedPaths.length ? `${S.sharedPaths.length} 张待整理` : "0 个待整理";
  for (const b of document.querySelectorAll("#seg-trash button")) b.classList.toggle("on", Number(b.dataset.days) === TRASH_DAYS);
  const theme = localStorage.getItem("sb.theme") || "auto";
  for (const b of document.querySelectorAll("#seg-theme button")) b.classList.toggle("on", b.dataset.theme === theme);
  const cols = String(Number(localStorage.getItem("sb.cols")) || 3);
  for (const b of document.querySelectorAll("#seg-cols button")) b.classList.toggle("on", b.dataset.cols === cols);
  const fav = localStorage.getItem("sb.fav") || "heart";
  for (const b of document.querySelectorAll("#seg-fav button")) b.classList.toggle("on", b.dataset.fav === fav);
  for (const b of document.querySelectorAll("#seg-dwell button")) b.classList.toggle("on", Number(b.dataset.dwell) === dwellMs());
  for (const b of document.querySelectorAll("#seg-dragmode button")) b.classList.toggle("on", b.dataset.dragmode === dragMode());
  for (const b of document.querySelectorAll("#seg-gcols button")) b.classList.toggle("on", +b.dataset.gcols === groupCols());
  for (const b of document.querySelectorAll("#seg-gnew button")) b.classList.toggle("on", b.dataset.gnew === groupNewPos());
  for (const b of document.querySelectorAll("#seg-pinrow button")) b.classList.toggle("on", +b.dataset.pinrow === S.pinsPerRow);
  for (const b of document.querySelectorAll("#seg-pinrows button")) b.classList.toggle("on", +b.dataset.pinrows === S.pinRows);
}

/* 同一个筛选组件，三种宿主：图库 / 分组详情 / 回收站 */
let filterHost = "gallery"; // gallery | group | trash

function hostFilters() {
  return filterHost === "group" ? S.gFilters : filterHost === "trash" ? S.tFilters : S.filters;
}

function filterScope() {
  if (filterHost !== "group") return filterHost === "trash" ? "回收站" : "图库";
  return S.gview === FAV_NAME ? "收藏夹" : S.gview || "分组";
}

function renderFilterSheet() {
  const f = hostFilters();
  $("f-scope").textContent = filterScope();
  $("fsec-groups").hidden = filterHost !== "gallery";
  $("fsec-tags").hidden = filterHost === "trash";
  $("fsec-sort").hidden = filterHost === "trash";
  $("f-days-label").textContent = filterHost === "trash" ? "删除时间" : "时间";

  if (filterHost === "gallery") {
    const gs = S.groupList || [];
    $("f-groups").innerHTML =
      `<button class="opt${S.view === "all" ? " on" : ""}" data-g="">全部分组</button>` +
      `<button class="opt${S.view === "ungrouped" ? " on" : ""}" data-g="__none__">未分组</button>` +
      `<button class="opt${S.view === "star" ? " on" : ""}" data-g="__star__">收藏</button>` +
      gs.map((g) => `<button class="opt${S.view === g.name ? " on" : ""}" data-g="${escapeHtml(g.name)}">${escapeHtml(g.name)}</button>`).join("");
  }
  [...$("f-type").children].forEach((el) => el.classList.toggle("on", (el.dataset.type || "") === f.type));
  [...$("f-days").children].forEach((el) => el.classList.toggle("on", Number(el.dataset.days || 0) === f.days));
  [...$("f-sort").children].forEach((el) => el.classList.toggle("on", (el.dataset.sort || "") === f.sort));
  $("f-tags").innerHTML = S.tags.length
    ? S.tags
        .map((t) => `<button class="opt${f.tags.includes(t.name) ? " on" : ""}" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)} <em>${t.count}</em></button>`)
        .join("")
    : `<span class="fnote">还没有标签</span>`;
}

function resetSheetHeight(sheet) {
  if (!sheet) return;
  sheet.classList.remove("tall");
  sheet.style.removeProperty("--sheet-h");
}

function openFilters(host) {
  filterHost = host || "gallery";
  resetSheetHeight($("filtersheet"));
  renderFilterSheet();
  $("filtermask").hidden = false;
  updateFilterCount();
  syncGuard();
}

function updateFilterCount() {
  const f = hostFilters();
  const p =
    filterHost === "trash"
      ? invokeRetry("trash_list", { q: null, filters: filterJson(f) })
      : invokeRetry("list_assets", {
          q: filterHost === "gallery" ? S.q : filterHost === "group" ? gdQ : "",
          group: filterHost === "group" ? gdParam(S.gview) : groupParam(),
          limit: 2000,
          sort: sortParam(f),
          filters: filterJson(f),
        });
  p.then((items) => { $("f-apply").textContent = `查看 ${items.length} 张`; }).catch(() => {});
}

function setTab(tab) {
  if (tab !== "groups") S.gview = null;
  S.tab = tab;
  window.scrollTo(0, 0);
  for (const b of document.querySelectorAll("#nav button")) b.classList.toggle("on", b.dataset.tab === tab);

  if (tab !== "groups" || !S.gview) {
    if (gdSelMode) setGdSelMode(false);
    closeGmenu();
    gdItems = [];
    gdQ = "";
    $("gdselhead").hidden = true;
    $("gdactbar").hidden = true;
    document.body.classList.remove("gdselect");
  }

  const isGallery = tab === "gallery";
  const isGroups = tab === "groups";
  const onGroupsList = isGroups && !S.gview;
  $("topwrap").hidden = !isGallery;
  $("searchbox").hidden = !isGallery;
  $("chips").hidden = !isGallery;
  $("grid").hidden = !isGallery;
  $("fab").hidden = !(isGallery || onGroupsList);
  $("fab").title = onGroupsList ? "新建分组" : "导入";
  $("inbox").hidden = !(isGallery && S.sharedPaths.length > 0);
  $("pins-wrap").hidden = !isGallery || pinNames().length === 0;
  $("groupsview").hidden = !isGroups || !!S.gview;
  $("groupdetail").hidden = !isGroups || !S.gview;
  $("trashview").hidden = tab !== "trash";
  $("meview").hidden = tab !== "me";

  if (isGallery) renderPins();
  if (isGroups) {
    if (S.gview) $("gd-title").textContent = gdDisplayName(S.gview);
    else renderFolders();
  }
  if (tab !== "gallery") {
    if (imgSelMode) setImgSelMode(false);
    if (!$("viewer").hidden) closeViewer();
  }
  if (tab !== "trash" && trashSelMode) setTrashSelMode(false);
  if (tab === "trash") loadTrash();
  if (tab === "me") renderMe();
  syncGuard();
}

/* ---------- 事件 ---------- */

function wire() {
  let t = 0;
  const q = $("q");
  const syncQClear = () => { $("q-clear").hidden = !q.value; };
  q.addEventListener("input", () => {
    syncQClear();
    clearTimeout(t);
    t = setTimeout(() => {
      S.q = q.value.trim();
      refresh();
    }, 220);
  });
  $("q-clear").addEventListener("click", () => {
    q.value = "";
    S.q = "";
    syncQClear();
    q.focus();
    refresh();
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      q.blur();
      S.q = q.value.trim();
      refresh();
    }
  });


  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.view) {
      S.view = b.dataset.view;
      refresh();
    } else if (b.dataset.clear) {
      S.view = "all";
      refresh();
    } else if (b.dataset.qclear) {
      S.q = "";
      q.value = "";
      refresh();
    } else if (b.dataset.fclearall) {
      S.filters = { type: "", days: 0, tags: [], sort: "" };
      refresh();
    } else if (b.dataset.fclear) {
      const k = b.dataset.fclear;
      if (k === "type") S.filters.type = "";
      else if (k === "days") S.filters.days = 0;
      else if (k === "sort") S.filters.sort = "";
      else if (k.startsWith("tag:")) S.filters.tags = S.filters.tags.filter((t) => t !== k.slice(4));
      refresh();
    }
  });

  $("pins").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (suppressClick) { suppressClick = false; return; }
    if (b.dataset.all) {
      setTab("groups");
    } else if (b.dataset.group) {
      openGroup(b.dataset.group);
    }
  });
  wirePinDrag();

  $("pins-toggle").addEventListener("click", () => {
    S.pinsOpen = !S.pinsOpen;
    renderPins();
  });

  // 分组页：搜索
  $("gq").addEventListener("input", () => {
    S.gq = $("gq").value;
    renderFolders();
  });

  // 分组页：轻点进组 / 长按多选 / 长按后拖动排序
  const folders = $("folders");
  folders.addEventListener("pointerdown", (e) => {
    if (gdDrag || crossDrag) return;
    const f = e.target.closest(".folder");
    if (!f || !f.dataset.group || e.button > 0) return;
    suppressClick = false;
    holdInfo = { name: f.dataset.group, card: f, x: e.clientX, y: e.clientY, armed: false, moved: false };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => armFolderHold(), 350);
    try { f.setPointerCapture(e.pointerId); } catch (_) {}
  });
  folders.addEventListener("pointermove", (e) => {
    if (!holdInfo) return;
    const d = Math.hypot(e.clientX - holdInfo.x, e.clientY - holdInfo.y);
    if (!holdInfo.armed) {
      if (d > 12) resetHold();
      return;
    }
    e.preventDefault();
    if (!dragCtx && !selMode && d > 12) beginFolderDrag(e);
    if (dragCtx) updateFolderDrag(e);
  }, { passive: false });
  folders.addEventListener("pointerup", () => {
    clearTimeout(holdTimer);
    finishFolderHold();
  });
  folders.addEventListener("touchmove", (e) => {
    if (dragCtx || (holdInfo && holdInfo.armed)) e.preventDefault();
  }, { passive: false });
  folders.addEventListener("contextmenu", (e) => e.preventDefault());
  folders.addEventListener("pointercancel", () => {
    if (dragCtx) cancelFolderDrag();
    else { clearTimeout(holdTimer); resetHold(); }
  });
  folders.addEventListener("click", (e) => {
    if (gdDrag || crossDrag) return;
    if (gdHoldFired) { gdHoldFired = false; return; }
    const f = e.target.closest(".folder");
    if (!f) return;
    if (suppressClick) { suppressClick = false; return; }
    if (f.dataset.fav) {
      if (selMode) { toast("收藏夹不能加入分组"); return; }
      openGroup(FAV_NAME);
      return;
    }
    if (selMode) toggleSel(f.dataset.group);
    else openGroup(f.dataset.group);
  });

  $("btn-gsel").addEventListener("click", () => {
    if (!S.groupList.length) return toast("还没有分组");
    setSelMode(true);
  });
  $("gsel-close").addEventListener("click", () => setSelMode(false));
  $("gsel-all").addEventListener("click", gselAll);
  $("gactbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-gact]");
    if (!b || b.disabled) return;
    const act = b.dataset.gact;
    if (act === "pin") batchSetPin(true);
    else if (act === "unpin") batchSetPin(false);
    else batchGroupRemove(act === "delete");
  });
  $("btn-gback").addEventListener("click", backGroups);
  $("btn-gdsel").addEventListener("click", () => {
    if (!gdItems.length) return toast("这个分组还没有图片");
    setGdSelMode(!gdSelMode);
  });
  $("gdsel-close").addEventListener("click", () => setGdSelMode(false));
  $("gdsel-all").addEventListener("click", gdAll);
  $("gdactbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-gdact]");
    if (b && !b.disabled) gdAction(b.dataset.gdact);
  });
  $("btn-gmore").addEventListener("click", (e) => {
    e.stopPropagation();
    if (S.gview) openGroupMenu(S.gview);
  });
  $("gmenu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-gmact]");
    if (b) gmenuAction(b.dataset.gmact);
  });
  document.addEventListener("pointerdown", (e) => {
    const m = $("gmenu");
    if (!m || m.hidden) return;
    if (e.target.closest("#gmenu") || e.target.closest("#btn-gmore")) return;
    closeGmenu();
  });

  let gdQT = 0;
  $("gdq").addEventListener("input", () => {
    const v = $("gdq").value;
    $("gdq-clear").hidden = !v;
    clearTimeout(gdQT);
    gdQT = setTimeout(() => {
      gdQ = v.trim();
      loadGroup();
    }, 200);
  });
  $("gdq-clear").addEventListener("click", () => {
    $("gdq").value = "";
    $("gdq-clear").hidden = true;
    gdQ = "";
    loadGroup();
    $("gdq").focus();
  });

  const gdGrid = $("gd-grid");
  gdGrid.addEventListener("pointerdown", (e) => {
    if (S.gview === null || gdDrag || crossDrag) return;
    const c = e.target.closest(".card");
    if (!c || e.button > 0) return;
    if (gdSelMode && !gdSel.has(c.dataset.sha)) return;
    gdHoldFired = false;
    gdHoldInfo = { sha: c.dataset.sha, x: e.clientX, y: e.clientY, el: c, armed: false, group: gdSelMode };
    clearTimeout(gdHoldTimer);
    gdHoldTimer = setTimeout(() => {
      if (!gdHoldInfo) return;
      gdHoldInfo.armed = true;
      if (navigator.vibrate) navigator.vibrate(8);
    }, 350);
  });
  gdGrid.addEventListener("pointermove", (e) => {
    if (gdDrag || crossDrag) return;
    if (!gdHoldInfo) return;
    const dist = Math.hypot(e.clientX - gdHoldInfo.x, e.clientY - gdHoldInfo.y);
    if (dist <= 12) return;
    if (!gdHoldInfo.armed) {
      clearTimeout(gdHoldTimer);
      gdHoldInfo = null;
      return;
    }
    const info = gdHoldInfo;
    clearTimeout(gdHoldTimer);
    gdHoldInfo = null;
    const ok = info.group ? beginGdGroupDrag(e) : beginGdDrag(info.sha, info.el, e);
    if (!ok) {
      gdHoldFired = true;
      setTimeout(() => { gdHoldFired = false; }, 450);
    }
  });
  gdGrid.addEventListener("pointerup", () => {
    if (gdDrag || crossDrag) return;
    if (!gdHoldInfo) return;
    const info = gdHoldInfo;
    clearTimeout(gdHoldTimer);
    gdHoldInfo = null;
    if (info.armed && info.group) {
      gdHoldFired = true;
      setTimeout(() => { gdHoldFired = false; }, 600);
      return;
    }
    if (info.armed) {
      gdSel.add(info.sha);
      setGdSelMode(true);
      gdHoldFired = true;
      setTimeout(() => { gdHoldFired = false; }, 600);
    }
  });
  gdGrid.addEventListener("pointercancel", () => {
    if (gdDrag || crossDrag) return;
    clearTimeout(gdHoldTimer);
    gdHoldInfo = null;
  });
  gdGrid.addEventListener("touchmove", (e) => {
    if (gdDrag || (gdHoldInfo && gdHoldInfo.armed)) e.preventDefault();
  }, { passive: false });
  gdGrid.addEventListener("dragstart", (e) => e.preventDefault());
  gdGrid.addEventListener("contextmenu", (e) => e.preventDefault());
  gdGrid.addEventListener("click", (e) => {
    if (gdDrag || crossDrag) return;
    const c = e.target.closest(".card");
    if (!c) return;
    if (gdHoldFired) { gdHoldFired = false; return; }
    if (gdSelMode) toggleGdSel(c.dataset.sha);
    else openViewer(c.dataset.sha);
  });

  // 点遮罩关掉弹层
  $("sheetmask").addEventListener("click", (e) => {
    if (e.target === $("sheetmask")) {
      if (sheetResolve) { sheetResolve(false); sheetResolve = null; }
      closeSheet();
    }
  });

  const gridEl = $("grid");
  gridEl.addEventListener("pointerdown", (e) => {
    const c = e.target.closest(".card");
    if (!c || e.button > 0) return;
    imgHoldFired = false;
    imgHoldInfo = { sha: c.dataset.sha, x: e.clientX, y: e.clientY, el: c, armed: false };
    clearTimeout(imgHoldTimer);
    imgHoldTimer = setTimeout(() => {
      if (!imgHoldInfo) return;
      imgHoldInfo.armed = true;
      imgHoldInfo.el.classList.add("lift");
      if (navigator.vibrate) navigator.vibrate(12);
    }, 350);
  });
  gridEl.addEventListener("pointermove", (e) => {
    if (!imgHoldInfo) return;
    if (Math.hypot(e.clientX - imgHoldInfo.x, e.clientY - imgHoldInfo.y) > 12) {
      clearTimeout(imgHoldTimer);
      if (imgHoldInfo.el) imgHoldInfo.el.classList.remove("lift");
      imgHoldInfo = null;
    }
  });
  // 长按到点只「上膛」；未移动就松手才算选中，避免和滚动/拖拽打架
  const endHold = () => {
    clearTimeout(imgHoldTimer);
    const info = imgHoldInfo;
    imgHoldInfo = null;
    if (!info) return;
    if (info.el) info.el.classList.remove("lift");
    if (!info.armed) return;
    imgHoldFired = true;
    imgSel.add(info.sha);
    setImgSelMode(true);
    // 长按后浏览器可能不派发 click；600ms 后自动解除，避免吞掉下一次点击
    setTimeout(() => { imgHoldFired = false; }, 600);
  };
  gridEl.addEventListener("pointerup", endHold);
  gridEl.addEventListener("pointercancel", endHold);
  gridEl.addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (!c) return;
    if (imgHoldFired) { imgHoldFired = false; return; }
    if (imgSelMode) toggleImgSel(c.dataset.sha);
    else openViewer(c.dataset.sha);
  });

  $("nav").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    // 已经在分组页里看某个分组时，再点「分组」= 退回分组列表
    if (b.dataset.tab === "groups" && S.gview) {
      backGroups();
      return;
    }
    setTab(b.dataset.tab);
  });

  $("fab").addEventListener("click", () => {
    if (S.tab === "groups" && !S.gview && !selMode) {
      openNewGroup();
      return;
    }
    openImportSheet();
  });
  $("btn-filter").addEventListener("click", openFilters);
  $("btn-inbox").addEventListener("click", () => {
    if (!S.sharedPaths.length) return toast("分享收件箱是空的");
    setTab("gallery");
    $("inbox").hidden = false;
    $("inbox").scrollIntoView({ block: "center", behavior: "smooth" });
  });
  $("btn-multi").addEventListener("click", () => {
    if (!S.items.length) return toast("图库里还没有图");
    if (S.tab !== "gallery") setTab("gallery");
    setImgSelMode(true);
  });
  $("inbox-undo").addEventListener("click", () => {
    S.sharedPaths = [];
    $("inbox").hidden = true;
    syncInboxBadge();
  });
  $("inbox-import").addEventListener("click", async () => {
    if (!S.sharedPaths.length) return;
    const paths = S.sharedPaths;
    S.sharedPaths = [];
    $("inbox").hidden = true;
    syncInboxBadge();
    toast(`正在导入 ${paths.length} 张…`);
    try {
      const r = await invokeRetry("import_paths_simple", { paths });
      toast(r.duplicated ? `已导入 ${r.added} 张（${r.duplicated} 张已存在）` : `已导入 ${r.added} 张`);
      await refresh();
      loadGroups();
      if (S.tab === "me") renderMe();
    } catch (e) {
      toast("导入失败：" + (typeof e === "string" ? e : e.message || e));
    }
  });
}

/* ---------- 启动 ---------- */

function syncInboxBadge() {
  const n = S.sharedPaths.length;
  const b = $("inbox-badge");
  b.hidden = !n;
  b.textContent = n > 9 ? "9+" : String(n);
}

async function checkShared() {
  try {
    const paths = await invokeRetry("take_shared_paths");
    if (Array.isArray(paths) && paths.length) {
      S.sharedPaths = paths;
      $("inbox-text").textContent = `收到 ${paths.length} 张图片`;
      $("inbox").hidden = false;
      syncInboxBadge();
    }
  } catch (e) {
    /* 桌面没有分享入口，忽略 */
  }
}

wire();
refresh();
checkShared();
// 从别的 App 分享回来时，WebView 会重新获得焦点，这时候再取一次收件箱
window.addEventListener("focus", checkShared);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkShared();
});

$("seg-theme").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-theme]");
  if (!b) return;
  localStorage.setItem("sb.theme", b.dataset.theme);
  applyPrefs();
  renderMe();
});
$("seg-fav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-fav]");
  if (!b) return;
  localStorage.setItem("sb.fav", b.dataset.fav);
  applyPrefs();
  renderMe();
});
(function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", kb + "px");
  };
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
})();
$("seg-cols").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cols]");
  if (!b) return;
  localStorage.setItem("sb.cols", b.dataset.cols);
  applyPrefs();
  renderMe();
});
$("seg-dwell").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-dwell]");
  if (!b) return;
  localStorage.setItem("sb.dwell", b.dataset.dwell);
  applyPrefs();
  renderMe();
});
$("seg-dragmode").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-dragmode]");
  if (!b) return;
  localStorage.setItem("sb.dragmode", b.dataset.dragmode);
  renderMe();
  toast(b.dataset.dragmode === "cut" ? "拖到其他分组：剪切" : "拖到其他分组：复制");
});
$("seg-gcols").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-gcols]");
  if (!b) return;
  localStorage.setItem("sb.gcols", b.dataset.gcols);
  applyPrefs();
  renderMe();
});
$("seg-gnew").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-gnew]");
  if (!b) return;
  localStorage.setItem("sb.gnew", b.dataset.gnew);
  renderMe();
  toast(b.dataset.gnew === "front" ? "新图将放在最前" : "新图将放在最后");
});
$("btn-purge").addEventListener("click", purgeTrash);
let trashHold = null, trashHoldTimer = 0, trashHoldFired = false;
$("trash-grid").addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".titem");
  if (!b) return;
  trashHoldFired = false;
  trashHold = { sha: b.dataset.sha, x: e.clientX, y: e.clientY };
  clearTimeout(trashHoldTimer);
  trashHoldTimer = setTimeout(() => {
    if (!trashHold) return;
    trashHoldFired = true;
    trashSel.add(trashHold.sha);
    setTrashSelMode(true);
    if (navigator.vibrate) navigator.vibrate(12);
    trashHold = null;
    setTimeout(() => { trashHoldFired = false; }, 600);
  }, 340);
});
$("trash-grid").addEventListener("pointermove", (e) => {
  if (!trashHold) return;
  if (Math.hypot(e.clientX - trashHold.x, e.clientY - trashHold.y) > 8) {
    clearTimeout(trashHoldTimer);
    trashHold = null;
  }
});
const endTrashHold = () => { clearTimeout(trashHoldTimer); trashHold = null; };
$("trash-grid").addEventListener("pointerup", endTrashHold);
$("trash-grid").addEventListener("pointercancel", endTrashHold);
$("trash-grid").addEventListener("click", (e) => {
  const b = e.target.closest(".titem");
  if (!b) return;
  if (trashHoldFired) { trashHoldFired = false; return; }
  if (trashSelMode) toggleTrashSel(b.dataset.sha);
  else openTrashItem(b.dataset.sha);
});
$("trashsel").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tact]");
  if (!b) return;
  if (b.dataset.tact === "restore") trashBatchRestore();
  if (b.dataset.tact === "delete") trashBatchDelete();
});
async function importPicked(cmd) {
  try {
    const paths = await invoke(cmd);
    if (!paths || !paths.length) return;
    toast(`正在导入 ${paths.length} 张…`);
    const r = await invokeRetry("import_paths_simple", { paths });
    toast(`已导入 ${r.added} 张` + (r.duplicated ? `，${r.duplicated} 张已存在` : ""));
    await refresh();
    if (S.tab === "me") renderMe();
    loadGroups();
  } catch (e) {
    toast("导入失败：" + (typeof e === "string" ? e : e.message || e));
  }
}

/** 系统相册选择器（Photo Picker）：上手快，但系统不给真实文件名。 */
function importFromGallery() {
  return importPicked("pick_gallery_images");
}

/** 系统「文件」选择器（SAF）：能保留原始文件名，多选要长按。 */
function importFromFiles() {
  return importPicked("pick_file_images");
}

function openImportSheet() {
  openSheet("导入图片", `<div class="menu">
      <button data-act="gallery">从手机相册导入</button>
      <button data-act="files">从系统文件选择器导入</button>
      <button data-act="cancel">取消</button>
    </div>`);
  $("sheet-body").onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    closeSheet();
    if (b.dataset.act === "gallery") importFromGallery();
    if (b.dataset.act === "files") importFromFiles();
  };
}

$("me-gallery").addEventListener("click", importFromGallery);
$("me-files").addEventListener("click", importFromFiles);
$("me-inbox").addEventListener("click", () => {
  if (S.sharedPaths.length) {
    setTab("gallery");
    toast(`收件箱里还有 ${S.sharedPaths.length} 张，点图库顶部的「导入」`);
  } else {
    toast("分享收件箱是空的");
  }
});
$("seg-pinrow").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pinrow]");
  if (!b) return;
  S.pinsPerRow = +b.dataset.pinrow;
  try { localStorage.setItem("sb.pinPerRow", String(S.pinsPerRow)); } catch (_) {}
  renderMe();
  renderPins();
});
$("seg-pinrows").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pinrows]");
  if (!b) return;
  S.pinRows = +b.dataset.pinrows;
  try { localStorage.setItem("sb.pinRows", String(S.pinRows)); } catch (_) {}
  renderMe();
  renderPins();
});
$("seg-trash").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-days]");
  if (!b) return;
  try {
    await invoke("set_trash_days", { days: Number(b.dataset.days) });
    TRASH_DAYS = Number(b.dataset.days);
    renderMe();
    toast(`回收站保留 ${TRASH_DAYS} 天`);
    if (S.tab === "trash") await loadTrash();
  } catch (err) {
    toast("保存失败：" + err);
  }
});

$("sel-close").addEventListener("click", () => setImgSelMode(false));
$("sel-all").addEventListener("click", () => {
  const all = S.items || [];
  if (!all.length) return;
  const full = all.every((x) => imgSel.has(x.sha));
  if (full) imgSel.clear();
  else all.forEach((x) => imgSel.add(x.sha));
  paintImgSel();
  syncSel();
});

$("actbar").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const shas = [...imgSel];
  const act = b.dataset.act;
  if (!shas.length) {
    toast("先选几张图");
    return;
  }
  if (act === "tag") {
    toast("标签编辑下一批上线");
    return;
  }
  if (act === "send") {
    try {
      await invoke("share_assets", { shas });
      await markUsed(shas);
    } catch (err) {
      toast("分享失败：" + err);
    }
    return;
  }
  if (act === "add") {
    openMoveSheet(shas);
    return;
  }
  if (act === "album") {
    await saveAlbum(shas);
    return;
  }
  if (act === "delete") {
    if (!(await confirmSheet(`把选中的 ${shas.length} 张移入回收站？`))) return;
    try {
      for (const sha of shas) await invokeRetry("delete_asset", { sha });
      setImgSelMode(false);
      toast("已移入回收站");
      await refresh();
    } catch (err) {
      toast("删除失败：" + err);
    }
  }
});

/* 叠加层把手：跟手拖动，下拉超过 1/4 就关闭 */
function sheetCloser(sheet) {
  const wrap = sheet.parentElement;
  const id = wrap && wrap.id;
  if (id === "filtermask") return () => { $("filtermask").hidden = true; syncGuard(); };
  if (id === "pickmask") return () => closeGroupPicker();
  if (id === "sheetmask") return () => { if (sheetResolve) { sheetResolve(false); sheetResolve = null; } closeSheet(); };
  return () => { if (wrap) wrap.hidden = true; syncGuard(); };
}

function bindSheetDrag(handle) {
  const sheet = handle.closest(".sheet");
  if (!sheet) return;
  let startY = 0, startH = 0, dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    startY = e.clientY;
    startH = sheet.getBoundingClientRect().height;
    sheet.style.transition = "none";
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    const vh = window.innerHeight;
    const h = Math.min(vh, Math.max(120, startH + (startY - e.clientY)));
    // 用类上的 --sheet-h 控制高度：内联变量能压过 .tall，所以全屏也能往下拉
    sheet.style.setProperty("--sheet-h", h + "px");
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const h = sheet.getBoundingClientRect().height;
    const vh = window.innerHeight;
    // 关面板的阈值按绝对高度算：从全屏往下拉应先回到 80%，只有拉到半屏以下才关
    const close = h < vh * 0.45;
    const tall = h > vh * 0.85;
    sheet.style.transition = "";
    sheet.style.removeProperty("--sheet-h");
    sheet.classList.toggle("tall", tall);
    if (close) sheetCloser(sheet)();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// 用过一次就记进「最近」（分享 / 存相册 都会调用）
async function markUsed(shas) {
  try {
    await invoke("mark_used", { shas });
  } catch (_) {
    /* 记录失败不影响主流程 */
  }
}

async function afterMoveRefresh(sha) {
  await refresh();
  if (!$("viewer").hidden && sha) {
    const i = (S.items || []).findIndex((x) => x.sha === sha);
    if (i >= 0) {
      vIndex = i;
      renderViewer();
    }
  }
}

/* 加入分组：复用分组页的双列封面卡，80% 叠加层，单选 */
let pickShas = [];
let pickSel = "";

function starredCount() { return (S.stats && S.stats.starred) || 0; }

function renderPicker() {
  const q = ($("pq").value || "").trim().toLowerCase();
  const order = (a, b) => {
    const pa = S.pinned.indexOf(a.name), pb = S.pinned.indexOf(b.name);
    if (pa >= 0 && pb >= 0) return pa - pb;
    if (pa >= 0) return -1;
    if (pb >= 0) return 1;
    return 0;
  };
  const list = (S.groupList || [])
    .filter((g) => !q || g.name.toLowerCase().includes(q))
    .slice()
    .sort(order);
  $("pick-scope").textContent = `已选 ${pickShas.length} 张`;
  $("pick-ok").textContent = !pickSel ? "未选择分组" : pickSel === FAV_NAME ? "加入收藏夹" : `加入「${pickSel}」`;
  $("pick-ok").disabled = !pickSel;
  const favHit = !q || FAV_NAME.includes(q) || "收藏夹".includes(q);
  $("pick-folders").innerHTML =
    (favHit ? favCard(starredCount(), pickSel === FAV_NAME) : "") +
    (list.length ? list.map((g) => folderCard(g, pickSel === g.name)).join("") : "") +
    (favHit || list.length ? "" : '<div class="pempty">没有匹配的分组</div>');
}

let pickNewMode = false;

function setPickNewMode(on) {
  pickNewMode = !!on;
  const bar = $("pickbar"), row = $("pick-newrow");
  if (bar) bar.hidden = pickNewMode;
  if (row) row.hidden = !pickNewMode;
  if (pickNewMode) {
    $("pick-nq").value = "";
    setTimeout(() => $("pick-nq").focus(), 30);
  } else {
    $("pick-nq").blur();
  }
}

async function createPickGroup() {
  const name = ($("pick-nq").value || "").trim();
  if (!name) { toast("先写个分组名"); return; }
  try {
    await invokeRetry("create_group", { name });
  } catch (e) {
    toast("创建失败：" + e);
    return;
  }
  await loadGroups();
  pickSel = name;
  setPickNewMode(false);
  renderPicker();
  toast(`已建「${name}」，点右下角加入`);
}

function exitPicker() {
  closeGroupPicker();
  if (gdSelMode) {
    setGdSelMode(false);
    loadGroup();
  } else {
    setImgSelMode(false);
  }
}

function openGroupPicker(shas) {
  pickShas = (shas || []).slice();
  pickSel = "";
  $("pq").value = "";
  setPickNewMode(false);
  resetSheetHeight($("picksheet"));
  renderPicker();
  $("pickmask").hidden = false;
  syncGuard();
}

function closeGroupPicker() {
  setPickNewMode(false);
  $("pickmask").hidden = true;
  syncGuard();
}

async function prioritizePicked(name) {
  if (groupNewPos() !== "front") return;
  try {
    const key = gdParam(name);
    const res = await invokeRetry("list_assets", { q: "", group: key, limit: 2000, sort: "manual", filters: "" });
    const list = Array.isArray(res) ? res : (res && res.items) || [];
    const all = list.map((a) => a.sha);
    const front = pickShas.filter((s) => all.includes(s));
    const rest = all.filter((s) => !front.includes(s));
    if (front.length) await invokeRetry("set_asset_order", { key, shas: [...front, ...rest] });
  } catch {}
}

async function pickerMoveIn() {
  if (!pickSel) return toast("先选一个分组");
  const name = pickSel;
  if (name === FAV_NAME) {
    try {
      await invokeRetry("batch_star", { shas: pickShas, on: true });
      await prioritizePicked(name);
      closeGroupPicker();
      if (S.gview) {
        setGdSelMode(false);
        await loadGroup();
      } else {
        setImgSelMode(false);
        await afterMoveRefresh(pickShas[0]);
      }
      await loadGroups();
      toast(`已收藏 ${pickShas.length} 张`);
    } catch (err) {
      toast("收藏失败：" + err);
    }
    return;
  }
  try {
    await invokeRetry("add_to_group", { shas: pickShas, group: name });
    await prioritizePicked(name);
    closeGroupPicker();
    if (S.gview) {
      setGdSelMode(false);
      await loadGroup();
    } else {
      setImgSelMode(false);
      await afterMoveRefresh(pickShas[0]);
    }
    await loadGroups();
    toast(`已加入「${name}」`);
  } catch (err) {
    toast("操作失败：" + err);
  }
}

async function pickerMoveOut() {
  try {
    await invoke("clear_groups", { shas: pickShas });
    closeGroupPicker();
    if (S.gview) {
      setGdSelMode(false);
      closeViewer();
      await loadGroup();
    } else {
      setImgSelMode(false);
      await afterMoveRefresh(pickShas[0]);
    }
    await loadGroups();
    toast("已移出分组");
  } catch (err) {
    toast("操作失败：" + err);
  }
}

// 兼容旧调用点：多选底栏「分组」原来开的是列名字弹层
function openMoveSheet(shas) {
  openGroupPicker(shas);
}

$("v-close").addEventListener("click", closeViewer);
$("v-share").addEventListener("click", async () => {
  const a = viewerAsset();
  if (!a.sha) return;
  try {
    await invoke("share_assets", { shas: [a.sha] });
    await markUsed([a.sha]);
  } catch (err) {
    toast("分享失败：" + err);
  }
});
$("v-save").addEventListener("click", async () => {
  const a = viewerAsset();
  if (!a.sha) return;
  toast("正在存到相册…");
  try {
    await invoke("save_to_gallery", { sha: a.sha });
    await markUsed([a.sha]);
    toast("已存到相册 Pictures/StickerBox");
  } catch (err) {
    toast("保存失败：" + err);
  }
});
$("v-star").addEventListener("click", async () => {
  const a = viewerAsset();
  if (!a.sha) return;
  try {
    const on = !a.starred;
    await invoke("batch_star", { shas: [a.sha], on });
    a.starred = on;
    if (S.gview) {
      await loadGroup();
      const idx = viewerList().findIndex((x) => x.sha === a.sha);
      if (idx < 0) {
        closeViewer();
        await loadGroups();
        toast(on ? "已收藏" : "已取消收藏");
        return;
      }
      vIndex = idx;
      renderViewer();
      await loadGroups();
      toast(on ? "已收藏" : "已取消收藏");
      return;
    }
    renderViewer();
    toast(on ? "已收藏" : "已取消收藏");
    await refresh();
    const idx = S.items.findIndex((x) => x.sha === a.sha);
    if (idx >= 0) vIndex = idx;
    renderViewer();
  } catch (err) {
    toast("操作失败：" + err);
  }
});
$("v-del").addEventListener("click", async () => {
  const a = viewerAsset();
  if (!a.sha) return;
  if (!(await confirmSheet("把这张移入回收站？"))) return;
  try {
    await invokeRetry("delete_asset", { sha: a.sha });
    closeViewer();
    toast("已移入回收站");
    if (S.gview) {
      await loadGroup();
      await loadGroups();
    } else {
      await refresh();
    }
  } catch (err) {
    toast("删除失败：" + err);
  }
});
$("v-tags").addEventListener("click", (e) => {
  if (e.target.closest("#v-tag-add")) toast("标签编辑在后面的批次接上");
  if (e.target.closest("#v-addgroup")) {
    const a = viewerAsset();
    if (a && a.sha) openMoveSheet([a.sha]);
  }
});
$("v-more").addEventListener("click", () => {
  const a = viewerAsset();
  const rows = [
    ["文件名", a.name || "—"],
    ["尺寸", a.width && a.height ? `${a.width} × ${a.height}` : "—"],
    ["大小", a.bytes ? fmtSize(a.bytes) : "—"],
    ["添加时间", a.added_at ? String(a.added_at).replace("T", " ").slice(0, 16) : "—"],
    ["来源", a.source ? fmtSource(a.source) : "—"],
    ["SHA-1", a.sha || "—"],
  ];
  openSheet("文件信息", `<div class="kv">${rows.map(([k, v]) => `<div class="kvrow"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`).join("")}</div>`);
});

// 预览详情：双指缩放 / 放大后单指平移 / 左右滑动切换 / 单击进全屏看图
(function wireViewerGestures() {
  const stage = $("v-stage");
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let sx = 0, sy = 0, down = false, moved = false, multi = false;

  stage.addEventListener("pointerdown", (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch {}
    vPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (vPointers.size === 2) {
      const [a, b] = [...vPointers.values()];
      vPinch = { d0: dist(a, b) || 1, s0: vScale, mid0: mid(a, b), tx0: vTx, ty0: vTy };
      vPan = null;
      multi = true;
      moved = true;
    } else if (vPointers.size === 1) {
      down = true; moved = false; multi = false;
      sx = e.clientX; sy = e.clientY;
      vPan = { x: e.clientX, y: e.clientY, tx: vTx, ty: vTy, moved: false };
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!vPointers.has(e.pointerId)) return;
    vPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (vPointers.size >= 2 && vPinch) {
      const [a, b] = [...vPointers.values()];
      const m = mid(a, b);
      vScale = clampViewScale(vPinch.s0 * (dist(a, b) / vPinch.d0));
      vTx = vPinch.tx0 + (m.x - vPinch.mid0.x);
      vTy = vPinch.ty0 + (m.y - vPinch.mid0.y);
      applyViewerTransform();
      moved = true;
      e.preventDefault();
      return;
    }
    if (vPointers.size === 1 && vPan && vScale > 1) {
      const dx = e.clientX - vPan.x, dy = e.clientY - vPan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) vPan.moved = true;
      vTx = vPan.tx + dx;
      vTy = vPan.ty + dy;
      applyViewerTransform();
      moved = true;
      e.preventDefault();
      return;
    }
    if (down && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) moved = true;
  });

  stage.addEventListener("pointerup", (e) => {
    vPointers.delete(e.pointerId);
    if (vPointers.size < 2) vPinch = null;
    if (vPointers.size !== 0) return;
    const panned = !!(vPan && vPan.moved);
    vPan = null;
    down = false;
    if (vScale < 1.05) resetViewerTransform();
    if (multi) { multi = false; return; }
    if (panned) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (vScale <= 1.05 && Math.abs(dx) > 48 && Math.abs(dy) < 70) { stepViewer(dx < 0 ? 1 : -1); return; }
    if (!moved) openLightbox(viewerAsset().sha);
  });

  stage.addEventListener("pointercancel", (e) => {
    vPointers.delete(e.pointerId);
    if (vPointers.size < 2) vPinch = null;
    vPan = null;
    down = false;
    multi = false;
  });
})();

// 全屏看图（黑色沉浸，仅这一层用黑底）
let lbScale = 1, lbTx = 0, lbTy = 0;
const lbPointers = new Map();
let lbPinch = null, lbPan = null, lbLastTap = 0, lbTapTimer = 0;

function lbApply() {
  const im = $("lb-img");
  if (im) im.style.transform = `translate(${lbTx}px, ${lbTy}px) scale(${lbScale})`;
}
function lbReset() {
  lbScale = 1; lbTx = 0; lbTy = 0;
  lbPointers.clear(); lbPinch = null; lbPan = null;
  lbApply();
}
function lbShow(sha) {
  if (!sha) return;
  $("lb-img").src = thumbUrl(sha, true);
  lbReset();
}
function openLightbox(sha) {
  lbShow(sha);
  $("lightbox").hidden = false;
}
function closeLightbox() {
  clearTimeout(lbTapTimer);
  $("lightbox").hidden = true;
  $("lb-img").removeAttribute("src");
  lbReset();
}
$("lb-close").addEventListener("click", closeLightbox);

(function wireLightboxGestures() {
  const box = $("lightbox");
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  box.addEventListener("pointerdown", (e) => {
    try { box.setPointerCapture(e.pointerId); } catch {}
    lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (lbPointers.size === 2) {
      const [a, b] = [...lbPointers.values()];
      lbPinch = { d0: dist(a, b) || 1, s0: lbScale, mid0: mid(a, b), tx0: lbTx, ty0: lbTy };
      lbPan = null;
    } else if (lbPointers.size === 1) {
      lbPan = { x: e.clientX, y: e.clientY, tx: lbTx, ty: lbTy, moved: false };
    }
  });

  box.addEventListener("pointermove", (e) => {
    if (!lbPointers.has(e.pointerId)) return;
    lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (lbPointers.size >= 2 && lbPinch) {
      const [a, b] = [...lbPointers.values()];
      const m = mid(a, b);
      lbScale = clampViewScale(lbPinch.s0 * (dist(a, b) / lbPinch.d0));
      lbTx = lbPinch.tx0 + (m.x - lbPinch.mid0.x);
      lbTy = lbPinch.ty0 + (m.y - lbPinch.mid0.y);
      lbApply();
      e.preventDefault();
    } else if (lbPointers.size === 1 && lbPan && lbScale > 1) {
      const dx = e.clientX - lbPan.x, dy = e.clientY - lbPan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) lbPan.moved = true;
      lbTx = lbPan.tx + dx;
      lbTy = lbPan.ty + dy;
      lbApply();
      e.preventDefault();
    }
  });

  const finish = (e) => {
    const wasOne = lbPointers.size === 1;
    lbPointers.delete(e.pointerId);
    if (lbPointers.size < 2) lbPinch = null;
    if (lbPointers.size !== 0) return;
    const pan = lbPan;
    lbPan = null;
    if (pan && pan.moved) {
      if (lbScale < 1.05) lbReset();
      return;
    }
    if (!wasOne || !pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const now = Date.now();
      if (now - lbLastTap < 300) {
        clearTimeout(lbTapTimer);
        lbLastTap = 0;
        lbScale = lbScale > 1 ? 1 : 2.6;
        if (lbScale === 1) { lbTx = 0; lbTy = 0; }
        lbApply();
      } else {
        lbLastTap = now;
        lbTapTimer = setTimeout(() => { if (lbScale === 1) closeLightbox(); }, 280);
      }
      return;
    }
    if (lbScale === 1 && Math.abs(dx) > 48 && Math.abs(dy) < 70) {
      stepViewer(dx < 0 ? 1 : -1);
      lbShow(viewerAsset().sha);
    }
  };
  box.addEventListener("pointerup", finish);
  box.addEventListener("pointercancel", finish);
})();

// 筛选面板（图库 / 分组详情 / 回收站 共用）
$("filtersheet").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const f = hostFilters();
  if (b.dataset.g !== undefined && filterHost === "gallery") {
    const g = b.dataset.g;
    S.view = g === "" ? "all" : g === "__none__" ? "ungrouped" : g === "__star__" ? "star" : g;
  } else if (b.dataset.type !== undefined) {
    f.type = b.dataset.type;
  } else if (b.dataset.days !== undefined) {
    f.days = Number(b.dataset.days) || 0;
  } else if (b.dataset.sort !== undefined) {
    f.sort = b.dataset.sort;
  } else if (b.dataset.tag) {
    const t = b.dataset.tag;
    f.tags = f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t];
  } else {
    return;
  }
  renderFilterSheet();
  updateFilterCount();
});
$("f-reset").addEventListener("click", () => {
  if (filterHost === "gallery") S.view = "all";
  const blank = (sort = "") => ({ type: "", days: 0, tags: [], sort });
  if (filterHost === "group") S.gFilters = blank("manual");
  else if (filterHost === "trash") S.tFilters = blank();
  else S.filters = blank();
  renderFilterSheet();
  updateFilterCount();
});
$("f-apply").addEventListener("click", async () => {
  $("filtermask").hidden = true;
  syncGuard();
  if (filterHost === "group" && S.gview) {
    await loadGroup();
    renderGdFilter();
  } else if (filterHost === "trash") {
    await loadTrash();
  } else {
    await refresh();
  }
});
$("f-close").addEventListener("click", () => {
  $("filtermask").hidden = true;
  syncGuard();
});
$("filtermask").addEventListener("click", (e) => {
  if (e.target === $("filtermask")) { $("filtermask").hidden = true; syncGuard(); }
});

// 分组详情 / 回收站 的筛选入口
$("btn-gfilter").addEventListener("click", () => openFilters("group"));
$("btn-tfilter").addEventListener("click", () => openFilters("trash"));

// 加入分组选择面板
$("pick-close").addEventListener("click", closeGroupPicker);
$("pick-ok").addEventListener("click", pickerMoveIn);
$("pick-out").addEventListener("click", pickerMoveOut);
$("pick-new").addEventListener("click", () => setPickNewMode(true));
$("pick-ncancel").addEventListener("click", () => setPickNewMode(false));
$("pick-nok").addEventListener("click", createPickGroup);
$("pick-nq").addEventListener("keydown", (e) => { if (e.key === "Enter") createPickGroup(); });
$("pick-close").addEventListener("click", exitPicker);
$("pq").addEventListener("input", renderPicker);
$("pick-folders").addEventListener("click", (e) => {
  const b = e.target.closest(".folder");
  if (!b) return;
  const name = b.dataset.fav ? FAV_NAME : b.dataset.group;
  pickSel = pickSel === name ? "" : name;
  renderPicker();
});
$("pickmask").addEventListener("click", (e) => {
  if (e.target === $("pickmask")) closeGroupPicker();
});

applyPrefs();
loadTrashDays();
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyPrefs);

/* ---------- 键盘弹起：底栏整条收起，不跟着键盘往上飘 ---------- */
let vhMax = window.innerHeight;
function applyKbd() {
  const h = window.innerHeight;
  if (h > vhMax) vhMax = h;
  document.body.classList.toggle("kbd", vhMax - h > 140);
}
window.addEventListener("resize", applyKbd);
if (window.visualViewport) window.visualViewport.addEventListener("resize", applyKbd);

/* ---------- 启动收尾：搜索清空 + 叠加层把手 ---------- */
bindClear("q", "q-clear", () => { S.q = ""; refresh(); });
bindClear("gq", "gq-clear", () => { S.gq = ""; renderFolders(); });
bindClear("pq", "pq-clear", () => renderPicker());
for (const h of document.querySelectorAll(".sheet .grab, .sheet .grabzone")) bindSheetDrag(h);
