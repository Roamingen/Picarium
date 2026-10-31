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
let imgHoldInfo = null;
let imgHoldTimer = 0;
let imgHoldFired = false;
let holdInfo = null;
let holdTimer = 0;
let dragCtx = null;
let suppressClick = false;
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
  if (S.view === "ungrouped") return "__none__";
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
    const [items, gs, lib, gl] = await Promise.all([
      invokeRetry("list_assets", { q: S.q, group: groupParam(), limit: 500 }),
      invokeRetry("group_stats"),
      invokeRetry("library_stats"),
      invokeRetry("group_list"),
    ]);
    S.items = items || [];
    S.groups = (gs && gs.groups) || [];
    S.groupList = (gl && gl.groups) || [];
    S.pinned = (gl && gl.pinned) || [];
    S.stats = { ...gs, ...lib };
    renderHeader();
    renderChips();
    renderPins();
    renderGrid();
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
  const dot =
    s.ungroupedNew > 0
      ? `<span class="dot" style="width:6px;height:6px;border-radius:50%;background:#ff6b6b;display:inline-block"></span>`
      : "";
  const items = [
    { key: "all", label: "全部", count: s.total },
    { key: "star", label: "收藏", count: s.starred },
    { key: "ungrouped", label: "未分组", count: s.ungrouped, extra: dot },
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
  if (S.q) {
    html += `<button class="chip fch" data-qclear="1">搜：${escapeHtml(S.q)} <span class="x">✕</span></button>`;
  }
  chips.innerHTML = html;
  // 分组/搜索的过滤 chip 排在最后，自动滚到右端让用户看见
  const hasFilter = S.q || !["all", "star", "ungrouped", "recent"].includes(S.view);
  chips.scrollLeft = hasFilter ? chips.scrollWidth : 0;
}

function pinNames() {
  if (S.pinned.length) return S.pinned.filter((n) => S.groupList.some((g) => g.name === n));
  return S.groupList.map((g) => g.name);
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
      <div class="pc">${g.cover ? `<img src="${thumbUrl(g.cover, g.animated)}" alt="" loading="lazy" onerror="this.remove()">` : folderIcon(g.name)}
        ${g.animated && g.cover ? '<span class="gb">GIF</span>' : ""}</div>
      <div class="pn">${escapeHtml(name)}</div>
    </button>`;
  };

  $("pins").innerHTML =
    list.map(card).join("") +
    `<button class="pin more" data-all="1"><div class="pc">+</div><div class="pn">全部</div></button>`;
}

function folderEmoji(count) {
  const list = ["🐟", "🐱", "🍵", "🎀", "🫧", "💤", "🌈", "🔥"];
  return list[count % list.length];
}

function renderGrid() {
  const grid = $("grid");
  if (!S.items.length) {
    const hint =
      S.q || S.view !== "all"
        ? "这里还没有匹配的表情。"
        : "这里还没有表情。点右下角「+」，或把图片分享到手机上的 StickerBox。";
    grid.innerHTML = `<div class="empty">${hint}</div>`;
    return;
  }
  grid.innerHTML = S.items.map(cardHtml).join("");
}

function cardHtml(a) {
  const on = imgSel.has(a.sha);
  return `<button class="card${on ? " sel" : ""}" data-sha="${escapeAttr(a.sha)}" data-name="${escapeAttr(a.name)}">
    <img loading="lazy" src="${thumbUrl(a.sha)}" alt="" onerror="this.style.display='none'">
    ${a.animated ? '<span class="badge">GIF</span>' : ""}
    ${a.starred ? '<span class="star">★</span>' : ""}
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

function folderCard(g) {
  const cover = g.cover
    ? `<img src="${thumbUrl(g.cover, g.animated)}" alt="" loading="lazy" onerror="this.remove()">`
    : folderIcon(g.name);
  return `<button class="folder${sel.has(g.name) ? " sel" : ""}${g.pinned ? " pinned" : ""}" data-group="${escapeAttr(g.name)}">
    <span class="fcheck">${SVG.check}</span>
    <div class="fc">${cover}${g.animated && g.cover ? '<span class="gb">GIF</span>' : ""}</div>
    <div class="fb"><span class="fname">${escapeHtml(g.name)}</span><span class="fsub">${g.count} 张</span></div>
  </button>`;
}

function renderFolders(keepScroll) {
  const folderBox = $("folders");
  if (!folderBox) return;
  const q = S.gq.trim().toLowerCase();
  const list = S.groupList.filter((g) => !q || g.name.toLowerCase().includes(q));
  const y = keepScroll ? window.scrollY : null;
  $("gcount").textContent = selMode ? ` 已选 ${sel.size} 个` : ` ${S.groupList.length} 个`;
  $("btn-newgroup").innerHTML = selMode
    ? SVG.check
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  $("btn-newgroup").title = selMode ? "完成" : "新建分组";
  $("selbar").hidden = !selMode;
  if (selMode) $("selcount").textContent = String(sel.size);
  folderBox.innerHTML =
    list.map(folderCard).join("") +
    (selMode
      ? ""
      : `<button class="folder new" data-new="1"><div class="fc">＋</div><div class="fb"><span class="fname">新建分组</span><span class="fsub">把一堆图归到一起</span></div></button>`);
  if (y !== null) window.scrollTo(0, y);
  if (dragCtx) {
    const src = folderBox.querySelector(`.folder[data-group="${cssEsc(dragCtx.name)}"]`);
    if (src) src.classList.add("dragsrc");
  }
}

function cssEsc(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}
async function openGroup(name) {
  S.gview = name;
  setTab("groups");
  const g = S.groupList.find((x) => x.name === name);
  $("gd-title").textContent = name;
  $("gd-meta").textContent = g ? `${g.count} 张 · 长按可换封面 / 重命名` : "";
  $("gd-grid").innerHTML = '<div class="spinner">正在读取…</div>';
  try {
    const items = await invokeRetry("list_assets", { q: "", group: name, limit: 500 });
    $("gd-meta").textContent = `${items.length} 张 · 右上角可换封面`;
    $("gd-grid").innerHTML = items.length
      ? items.map(cardHtml).join("")
      : '<div class="gempty">这个分组还是空的</div>';
  } catch (e) {
    $("gd-grid").innerHTML = '<div class="gempty">读取失败：' + escapeHtml(String(e)) + "</div>";
  }
}

/* ---------- 图片预览 / 多选 ---------- */

function setImgSelMode(on) {
  imgSelMode = on;
  if (!on) imgSel.clear();
  $("imgsel").hidden = !on;
  $("imgn").textContent = String(imgSel.size);
  renderGrid();
}

function toggleImgSel(sha) {
  if (imgSel.has(sha)) imgSel.delete(sha);
  else imgSel.add(sha);
  if (!imgSel.size) return setImgSelMode(false);
  $("imgn").textContent = String(imgSel.size);
  renderGrid();
}

let vIndex = 0;
let vZoomed = false;

function fmtSource(src) {
  const map = { wechat: "微信", qq: "QQ", file: "文件", folder: "文件夹", clipboard: "剪贴板", share: "分享", desktop: "桌面" };
  return "来自" + (map[src] || src || "未知");
}

function viewerAsset() {
  return (S.items || [])[vIndex] || {};
}

function renderViewer() {
  const a = viewerAsset();
  $("v-count").textContent = `${S.items.length ? vIndex + 1 : 0} / ${S.items.length}`;
  $("v-name").textContent = a.name || "未命名";
  $("v-img").src = thumbUrl(a.sha, !!a.animated);
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
  $("v-tags").innerHTML = tags.join("");
  const on = !!a.starred;
  $("v-star").innerHTML = (on ? SVG.starFill : SVG.star) + `<span>${on ? "已收藏" : "收藏"}</span>`;
  $("v-star").classList.toggle("on", on);
  vZoomed = false;
  $("v-img").classList.remove("zoomed");
  $("v-img").style.transformOrigin = "center center";
}

function openViewer(sha) {
  const idx = (S.items || []).findIndex((x) => x.sha === sha);
  vIndex = idx < 0 ? 0 : idx;
  renderViewer();
  $("viewer").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeViewer() {
  $("viewer").hidden = true;
  $("v-img").removeAttribute("src");
  $("v-img").classList.remove("zoomed");
  vZoomed = false;
  document.body.style.overflow = "";
}

function stepViewer(delta) {
  if (!S.items.length) return;
  const next = Math.min(S.items.length - 1, Math.max(0, vIndex + delta));
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
  S.gview = null;
  $("groupdetail").hidden = true;
  $("groupsview").hidden = false;
  renderFolders();
}

/* ---------- 底部弹层 ---------- */

function openSheet(title, bodyHtml) {
  $("sheet-title").textContent = title;
  $("sheet-body").innerHTML = bodyHtml;
  $("sheetmask").hidden = false;
}
function closeSheet() {
  $("sheetmask").hidden = true;
  $("sheet-body").innerHTML = "";
}
let sheetResolve = null;

function confirmSheet(text) {
  return new Promise((resolve) => {
    sheetResolve = resolve;
    openSheet(
      "确认",
      `<div class="snote">${escapeHtml(text)}</div>${sheetActions("确定", "sheet-ok")}`
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

function sheetActions(okText, okId) {
  return `<div class="sheet-actions"><button id="sheet-cancel">取消</button><button class="primary" id="${okId}">${okText}</button></div>`;
}

function openGroupMenu(name) {
  const pinned = S.pinned.includes(name);
  openSheet(
    name,
    `<div class="menu">
      <button data-act="cover">换封面</button>
      <button data-act="rename">重命名</button>
      <button data-act="pin">${pinned ? "取消置顶" : "置顶到图库"}</button>
      <button data-act="delete" class="danger">删除分组（只解散，不删图）</button>
    </div>`
  );
  $("sheet-body").onclick = async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    closeSheet();
    if (b.dataset.act === "cover") openCoverPicker(name);
    else if (b.dataset.act === "rename") openRename(name);
    else if (b.dataset.act === "pin") await togglePin(name);
    else if (b.dataset.act === "delete") openDeleteGroup(name);
  };
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
        toast("封面已更新");
      } catch (err) {
        toast("换封面失败：" + String(err));
      }
    };
  } catch (e) {
    $("sheet-body").innerHTML = '<div class="gempty">读取失败：' + escapeHtml(String(e)) + "</div>";
  }
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

function beginFolderDrag(e) {
  const info = holdInfo;
  if (!info) return;
  const r = info.card.getBoundingClientRect();
  dragCtx = {
    name: info.name,
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
  if (navigator.vibrate) navigator.vibrate(16);
}

function updateFolderDrag(e) {
  const d = dragCtx;
  if (!d) return;
  d.moved = true;
  d.ghost.style.left = e.clientX - d.offX + "px";
  d.ghost.style.top = e.clientY - d.offY + "px";
  if (S.gq.trim()) return;

  const cards = [...document.querySelectorAll("#folders .folder[data-group]")].filter(
    (c) => c.dataset.group !== d.name
  );
  if (!cards.length) return;
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
  const r = target.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  const order = S.groupList.map((g) => g.name).filter((n) => n !== d.name);
  const pos = order.indexOf(target.dataset.group) + (after ? 1 : 0);
  order.splice(pos, 0, d.name);
  if (order.join("\u0001") === S.groupList.map((g) => g.name).join("\u0001")) return;
  const before = captureFolderRects();
  S.groupList = order.map((n) => S.groupList.find((g) => g.name === n)).filter(Boolean);
  renderFolders(true);
  flipFolders(before);
}

async function endFolderDrag() {
  const d = dragCtx;
  dragCtx = null;
  if (!d) return;
  if (d.ghost) d.ghost.remove();
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 450);
  resetHold();
  document.querySelectorAll("#folders .dragsrc").forEach((el) => el.classList.remove("dragsrc"));
  if (!d.moved) return;
  try {
    await invokeRetry("set_group_order", { order: S.groupList.map((g) => g.name) });
    await loadGroups();
    toast("顺序已保存");
  } catch (err) {
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

async function batchDelete() {
  const names = [...sel];
  if (!names.length) return;
  openSheet(
    `删除 ${names.length} 个分组`,
    `<div class="shnote">只解散分组，组里的图会回到「未分组」，不会被删除。</div>
     ${sheetActions("删除", "batch-del")}`
  );
  $("sheet-cancel").onclick = closeSheet;
  $("batch-del").onclick = async () => {
    try {
      for (const n of names) await invokeRetry("remove_group", { name: n, deleteAssets: false });
      closeSheet();
      setSelMode(false);
      await loadGroups();
      toast("已删除分组");
    } catch (err) {
      toast("删除失败：" + String(err));
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
function openPinManager() {
  const row = (g) => {
    const on = S.pinned.includes(g.name);
    return `<button class="prow" data-pin="${escapeAttr(g.name)}">
      <span class="pcheck${on ? " on" : ""}">${on ? SVG.check : ""}</span>
      <span class="pname">${escapeHtml(g.name)}</span>
      <span class="pcount">${g.count}</span>
    </button>`;
  };
  openSheet(
    "置顶分组",
    `<div class="sect">图库顶部每行显示</div>
     <div class="opts" id="pin-cols">
       ${[4, 5, 6].map((n) => `<div class="opt${S.pinsPerRow === n ? " on" : ""}" data-cols="${n}">${n} 个</div>`).join("")}
     </div>
     <div class="sect">最多显示</div>
     <div class="opts" id="pin-rows">
       ${[1, 2, 3].map((n) => `<div class="opt${S.pinRows === n ? " on" : ""}" data-rows="${n}">${n} 行</div>`).join("")}
     </div>
     <div class="sect">置顶哪些分组（可多选）</div>
     <div class="pinlist" id="pinlist">${S.groupList.map(row).join("")}</div>
     <div class="shnote">置顶后，在图库顶部展开置顶条，长按卡片可以拖动排序。</div>`
  );
  $("sheet-body").onclick = async (e) => {
    const c = e.target.closest("[data-cols]");
    const r = e.target.closest("[data-rows]");
    const p = e.target.closest("[data-pin]");
    if (c) {
      S.pinsPerRow = +c.dataset.cols;
      try { localStorage.setItem("sb.pinPerRow", String(S.pinsPerRow)); } catch (_) {}
      $("pin-cols").querySelectorAll(".opt").forEach((el) => el.classList.toggle("on", +el.dataset.cols === S.pinsPerRow));
      renderPins();
      return;
    }
    if (r) {
      S.pinRows = +r.dataset.rows;
      try { localStorage.setItem("sb.pinRows", String(S.pinRows)); } catch (_) {}
      $("pin-rows").querySelectorAll(".opt").forEach((el) => el.classList.toggle("on", +el.dataset.rows === S.pinRows));
      renderPins();
      return;
    }
    if (p) {
      const name = p.dataset.pin;
      const on = !S.pinned.includes(name);
      S.pinned = on ? [...S.pinned, name] : S.pinned.filter((n) => n !== name);
      try {
        await invokeRetry("set_pinned_groups", { groups: S.pinned });
        await loadGroups();
        p.querySelector(".pcheck").classList.toggle("on", on);
        p.querySelector(".pcheck").innerHTML = on ? SVG.check : "";
        p.querySelector(".pcheck").className = "pcheck" + (on ? " on" : "");
      } catch (err) {
        toast("设置失败：" + String(err));
      }
    }
  };
}


/* ---------- tab ---------- */

// ---- 回收站 ----
let TRASH_DAYS = 7;

function daysLeft(item) {
  const t = item.deleted_at ? new Date(item.deleted_at).getTime() : Date.now();
  return Math.max(0, TRASH_DAYS - Math.floor((Date.now() - t) / 86400000));
}

async function loadTrash() {
  const grid = $("trash-grid");
  grid.innerHTML = `<div class="empty">正在读取…</div>`;
  let items = [];
  try {
    items = await invokeRetry("trash_list");
  } catch (e) {
    grid.innerHTML = `<div class="empty">读取失败：${escapeHtml(String(e))}</div>`;
    return;
  }
  S.trashItems = items;
  $("tcount").textContent = items.length ? ` ${items.length} 张` : "";
  $("trash-meta").textContent = `删除的图片会在这里保留 ${TRASH_DAYS} 天，期间可以恢复或彻底删除。`;
  if (!items.length) {
    grid.innerHTML = `<div class="empty">回收站是空的。<br><small>删除的表情会先放这里，${TRASH_DAYS} 天后自动清理。</small></div>`;
    return;
  }
  grid.innerHTML = items
    .map(
      (it) => `<button class="titem" data-sha="${escapeAttr(it.sha)}">
        <span class="tthumb"><img src="${thumbUrl(it.sha)}" alt="" loading="lazy" onerror="this.remove()"></span>
        <span class="tname">${escapeHtml(it.name || "未命名")}</span>
        <span class="tsub">${daysLeft(it)} 天后清理</span>
      </button>`
    )
    .join("");
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
  const cols = Number(localStorage.getItem("sb.cols")) || 3;
  document.documentElement.style.setProperty("--cols", String(cols));
}

function renderMe() {
  $("me-home").textContent = (S.stats && S.stats.root) || "—";
  for (const b of document.querySelectorAll("#seg-trash button")) b.classList.toggle("on", Number(b.dataset.days) === TRASH_DAYS);
  const theme = localStorage.getItem("sb.theme") || "auto";
  for (const b of document.querySelectorAll("#seg-theme button")) b.classList.toggle("on", b.dataset.theme === theme);
  const cols = String(Number(localStorage.getItem("sb.cols")) || 3);
  for (const b of document.querySelectorAll("#seg-cols button")) b.classList.toggle("on", b.dataset.cols === cols);
}

function setTab(tab) {
  if (tab !== "groups") S.gview = null;
  S.tab = tab;
  window.scrollTo(0, 0);
  for (const b of document.querySelectorAll("#nav button")) b.classList.toggle("on", b.dataset.tab === tab);

  const isGallery = tab === "gallery";
  const isGroups = tab === "groups";
  $("topwrap").hidden = !isGallery;
  $("searchbox").hidden = !isGallery;
  $("chips").hidden = !isGallery;
  $("grid").hidden = !isGallery;
  $("fab").hidden = !isGallery;
  $("inbox").hidden = true;
  $("pins-wrap").hidden = !isGallery || pinNames().length === 0;
  $("groupsview").hidden = !isGroups || !!S.gview;
  $("groupdetail").hidden = !isGroups || !S.gview;
  $("trashview").hidden = tab !== "trash";
  $("meview").hidden = tab !== "me";

  if (isGallery) renderPins();
  if (isGroups) {
    if (S.gview) $("gd-title").textContent = S.gview;
    else renderFolders();
  }
  if (tab !== "gallery") {
    if (imgSelMode) setImgSelMode(false);
    if (!$("viewer").hidden) closeViewer();
  }
  if (tab === "trash") loadTrash();
  if (tab === "me") renderMe();
}

/* ---------- 事件 ---------- */

function wire() {
  let t = 0;
  const q = $("q");
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      S.q = q.value.trim();
      refresh();
    }, 220);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      q.blur();
      S.q = q.value.trim();
      refresh();
    }
  });

  $("btn-search").addEventListener("click", () => q.focus());

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
    const f = e.target.closest(".folder");
    if (!f || f.dataset.new || e.button > 0) return;
    suppressClick = false;
    holdInfo = { name: f.dataset.group, card: f, x: e.clientX, y: e.clientY, armed: false, moved: false };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => armFolderHold(), 340);
    try { f.setPointerCapture(e.pointerId); } catch (_) {}
  });
  folders.addEventListener("pointermove", (e) => {
    if (!holdInfo) return;
    const d = Math.hypot(e.clientX - holdInfo.x, e.clientY - holdInfo.y);
    if (!holdInfo.armed) {
      if (d > 8) resetHold();
      return;
    }
    e.preventDefault();
    if (!dragCtx && !selMode && d > 8) beginFolderDrag(e);
    if (dragCtx) updateFolderDrag(e);
  }, { passive: false });
  folders.addEventListener("pointerup", () => {
    clearTimeout(holdTimer);
    finishFolderHold();
  });
  folders.addEventListener("pointercancel", () => { clearTimeout(holdTimer); resetHold(); });
  folders.addEventListener("click", (e) => {
    const f = e.target.closest(".folder");
    if (!f) return;
    if (suppressClick) { suppressClick = false; return; }
    if (f.dataset.new) { if (!selMode) openNewGroup(); return; }
    if (selMode) toggleSel(f.dataset.group);
    else openGroup(f.dataset.group);
  });

  $("btn-newgroup").addEventListener("click", () => {
    if (selMode) setSelMode(false);
    else openNewGroup();
  });
  $("selbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sel]");
    if (!b) return;
    const act = b.dataset.sel;
    if (act === "pin") batchSetPin(true);
    else if (act === "unpin") batchSetPin(false);
    else if (act === "delete") batchDelete();
    else batchSingle(act);
  });
  $("btn-gback").addEventListener("click", backGroups);
  $("btn-gcover").addEventListener("click", () => {
    if (S.gview) openCoverPicker(S.gview);
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
    if (!c) return;
    imgHoldFired = false;
    imgHoldInfo = { sha: c.dataset.sha, x: e.clientX, y: e.clientY, el: c };
    clearTimeout(imgHoldTimer);
    imgHoldTimer = setTimeout(() => {
      if (!imgHoldInfo) return;
      imgHoldFired = true;
      imgSel.add(imgHoldInfo.sha);
      setImgSelMode(true);
      imgHoldInfo.el.classList.add("lift");
      setTimeout(() => imgHoldInfo && imgHoldInfo.el && imgHoldInfo.el.classList.remove("lift"), 160);
      if (navigator.vibrate) navigator.vibrate(12);
      imgHoldInfo = null;
      // 长按后浏览器可能不派发 click；600ms 后自动解除，避免吞掉下一次点击
      setTimeout(() => { imgHoldFired = false; }, 600);
    }, 340);
  });
  gridEl.addEventListener("pointermove", (e) => {
    if (!imgHoldInfo) return;
    if (Math.hypot(e.clientX - imgHoldInfo.x, e.clientY - imgHoldInfo.y) > 8) {
      clearTimeout(imgHoldTimer);
      imgHoldInfo = null;
    }
  });
  const endHold = () => { clearTimeout(imgHoldTimer); imgHoldInfo = null; };
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

  $("fab").addEventListener("click", () => toast("相册导入在后续批次"));
  $("btn-filter").addEventListener("click", () => toast("筛选面板下一批"));
  $("btn-settings").addEventListener("click", () => setTab("me"));
  $("pins-manage").addEventListener("click", openPinManager);
  $("inbox-undo").addEventListener("click", () => ($("inbox").hidden = true));
}

/* ---------- 启动 ---------- */

wire();
refresh();

$("seg-theme").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-theme]");
  if (!b) return;
  localStorage.setItem("sb.theme", b.dataset.theme);
  applyPrefs();
  renderMe();
});
$("seg-cols").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cols]");
  if (!b) return;
  localStorage.setItem("sb.cols", b.dataset.cols);
  applyPrefs();
  renderMe();
});
$("btn-purge").addEventListener("click", purgeTrash);
$("trash-grid").addEventListener("click", (e) => {
  const b = e.target.closest(".titem");
  if (b) openTrashItem(b.dataset.sha);
});
$("me-gallery").addEventListener("click", () => toast("相册导入在下一批接上"));
$("me-inbox").addEventListener("click", () => toast("分享收件箱在下一批接上"));
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

$("imgsel").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const shas = [...imgSel];
  const act = b.dataset.act;
  if (act === "share") {
    try {
      await invoke("share_assets", { shas });
    } catch (err) {
      toast("分享失败：" + err);
    }
    return;
  }
  if (act === "star") {
    try {
      await invoke("batch_star", { shas, on: true });
      setImgSelMode(false);
      toast("已收藏");
      await refresh();
    } catch (err) {
      toast("收藏失败：" + err);
    }
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

$("v-close").addEventListener("click", closeViewer);
$("v-share").addEventListener("click", async () => {
  const a = viewerAsset();
  if (!a.sha) return;
  try {
    await invoke("share_assets", { shas: [a.sha] });
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
    toast("已存到相册 Pictures/StickerBox");
  } catch (err) {
    toast("保存失败：" + err);
  }
});
$("v-star").addEventListener("click", async () => {
  const a = viewerAsset();
  if (!a.sha) return;
  try {
    await invoke("batch_star", { shas: [a.sha], on: !a.starred });
    a.starred = !a.starred;
    renderViewer();
    toast(a.starred ? "已收藏" : "已取消收藏");
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
    await refresh();
  } catch (err) {
    toast("删除失败：" + err);
  }
});
$("v-tags").addEventListener("click", (e) => {
  if (e.target.closest("#v-tag-add")) toast("标签编辑在后面的批次接上");
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

// 预览：左右滑动切换、双击放大
(function wireViewerGestures() {
  const stage = $("v-stage");
  let sx = 0, sy = 0, down = false, lastTap = 0;
  stage.addEventListener("pointerdown", (e) => {
    down = true; sx = e.clientX; sy = e.clientY;
  });
  stage.addEventListener("pointerup", (e) => {
    if (!down) return;
    down = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 48 && Math.abs(dy) < 70) {
      stepViewer(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const now = Date.now();
      if (now - lastTap < 300) {
        vZoomed = !vZoomed;
        const img = $("v-img");
        img.classList.toggle("zoomed", vZoomed);
        img.style.transformOrigin = vZoomed ? "center center" : "center center";
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }
  });
  stage.addEventListener("pointercancel", () => { down = false; });
})();

applyPrefs();
loadTrashDays();
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyPrefs);
