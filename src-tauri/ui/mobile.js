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
  loading: false,
};

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
    const [items, gs, lib] = await Promise.all([
      invokeRetry("list_assets", { q: S.q, group: groupParam(), limit: 500 }),
      invokeRetry("group_stats"),
      invokeRetry("library_stats"),
    ]);
    S.items = items || [];
    S.groups = (gs && gs.groups) || [];
    S.stats = { ...gs, ...lib };
    renderHeader();
    renderChips();
    renderPins();
    renderGrid();
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

function renderPins() {
  const pinned = [...S.groups].sort((a, b) => b.count - a.count).slice(0, 4);
  $("pins-wrap").hidden = pinned.length === 0;
  if (!pinned.length) return;

  const g = (name) => S.groups.find((x) => x.name === name);
  const card = (p) => {
    const grp = g(p.name);
    return `<button class="pin" data-group="${escapeAttr(p.name)}">
      <div class="pc"><span style="font-size:22px">${folderEmoji(grp ? grp.count : 0)}</span></div>
      <div class="pn">${escapeHtml(p.name)}</div>
    </button>`;
  };

  $("pins").innerHTML =
    pinned.map(card).join("") +
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
  grid.innerHTML = S.items
    .map(
      (a) => `<button class="card" data-sha="${escapeAttr(a.sha)}" data-name="${escapeAttr(a.name)}">
        <img loading="lazy" src="${thumbUrl(a.sha)}" alt="" onerror="this.style.display='none'">
        ${a.animated ? '<span class="badge">GIF</span>' : ""}
        ${a.starred ? '<span class="star">★</span>' : ""}
      </button>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

/* ---------- tab ---------- */

function setTab(tab) {
  S.tab = tab;
  window.scrollTo(0, 0);
  for (const b of document.querySelectorAll("#nav button")) b.classList.toggle("on", b.dataset.tab === tab);

  const isGallery = tab === "gallery";
  $("searchbox").hidden = !isGallery;
  $("chips").hidden = !isGallery;
  $("pins-wrap").hidden = !isGallery || !S.groups.length;
  $("grid").hidden = !isGallery;
  $("fab").hidden = !isGallery;
  $("inbox").hidden = true;
  $("tabpage").hidden = isGallery;

  if (!isGallery) {
    const info = TAB_INFO[tab];
    $("tp-icon").innerHTML = info.icon;
    $("tp-title").textContent = info.title;
    $("tp-text").textContent = info.text;
  }
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
    if (b.dataset.all) {
      S.view = "all";
      refresh();
    } else if (b.dataset.group) {
      S.view = b.dataset.group;
      refresh();
    }
  });

  $("grid").addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (c) toast("预览还没做，下一批上线");
  });

  $("nav").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setTab(b.dataset.tab);
  });

  $("fab").addEventListener("click", () => toast("相册导入在后续批次"));
  $("btn-filter").addEventListener("click", () => toast("筛选面板下一批"));
  $("btn-settings").addEventListener("click", () => setTab("me"));
  $("pins-manage").addEventListener("click", () => toast("置顶分组的管理下一批"));
  $("inbox-undo").addEventListener("click", () => ($("inbox").hidden = true));
}

/* ---------- 启动 ---------- */

wire();
refresh();
