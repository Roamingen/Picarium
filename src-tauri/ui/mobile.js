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

function renderPins() {
  const total = pinNames();
  const list = S.pinsOpen ? total : total.slice(0, 4);
  $("pins-wrap").hidden = S.tab !== "gallery" || total.length === 0;
  $("pins-toggle").textContent = S.pinsOpen ? "收起" : "展开";
  $("pins-toggle").hidden = total.length <= 4;
  if (total.length === 0) return;

  const card = (name) => {
    const g = S.groupList.find((x) => x.name === name) || { name, count: 0 };
    return `<button class="pin" data-group="${escapeAttr(name)}">
      <div class="pc">${g.cover ? `<img src="${thumbUrl(g.cover, g.animated)}" alt="" loading="lazy" onerror="this.remove()">` : folderEmoji(g.count)}
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
  return `<button class="card" data-sha="${escapeAttr(a.sha)}" data-name="${escapeAttr(a.name)}">
    <img loading="lazy" src="${thumbUrl(a.sha)}" alt="" onerror="this.style.display='none'">
    ${a.animated ? '<span class="badge">GIF</span>' : ""}
    ${a.starred ? '<span class="star">★</span>' : ""}
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

function folderEmojiG(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 997;
  const list = ["🐟", "🐱", "🍵", "🎀", "🫧", "💤", "🌈", "🔥", "🍜", "🧋", "🐰", "⭐"];
  return list[h % list.length];
}

function folderCard(g) {
  const cover = g.cover
    ? `<img src="${thumbUrl(g.cover, g.animated)}" alt="" loading="lazy" onerror="this.remove()">`
    : folderEmojiG(g.name);
  return `<button class="folder" data-group="${escapeAttr(g.name)}">
    <div class="fc">${cover}${g.animated && g.cover ? '<span class="gb">GIF</span>' : ""}${g.pinned ? '<span class="pinmark">📌 置顶</span>' : ""}</div>
    <div class="fb"><span class="fname">${escapeHtml(g.name)}</span><span class="fsub">${g.count} 张</span></div>
  </button>`;
}

function renderFolders() {
  const folderBox = $("folders");
  if (!folderBox) return;
  const q = S.gq.trim().toLowerCase();
  const list = S.groupList.filter((g) => !q || g.name.toLowerCase().includes(q));
  $("gcount").textContent = ` ${S.groupList.length} 个`;
  folderBox.innerHTML =
    list.map(folderCard).join("") +
    `<button class="folder new" data-new="1"><div class="fc">＋</div><div class="fb"><span class="fname">新建分组</span><span class="fsub">把一堆图归到一起</span></div></button>`;
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

/* ---------- tab ---------- */

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
  $("tabpage").hidden = isGallery || isGroups;
  $("groupsview").hidden = !isGroups || !!S.gview;
  $("groupdetail").hidden = !isGroups || !S.gview;

  if (isGallery) renderPins();
  if (isGroups) {
    if (S.gview) $("gd-title").textContent = S.gview;
    else renderFolders();
  }
  if (tab === "trash" || tab === "me") {
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
      setTab("groups");
    } else if (b.dataset.group) {
      openGroup(b.dataset.group);
    }
  });

  $("pins-toggle").addEventListener("click", () => {
    S.pinsOpen = !S.pinsOpen;
    renderPins();
  });

  // 分组页：搜索
  $("gq").addEventListener("input", () => {
    S.gq = $("gq").value;
    renderFolders();
  });

  // 分组页：点进分组；长按 500ms 打开菜单
  let pressTimer = 0;
  let longPressed = false;
  const folders = $("folders");
  folders.addEventListener("pointerdown", (e) => {
    const f = e.target.closest(".folder");
    if (!f || f.dataset.new) return;
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      openGroupMenu(f.dataset.group);
    }, 500);
  });
  for (const ev of ["pointerup", "pointercancel", "pointermove", "pointerleave"]) {
    folders.addEventListener(ev, () => clearTimeout(pressTimer));
  }
  folders.addEventListener("click", (e) => {
    const f = e.target.closest(".folder");
    if (!f) return;
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (f.dataset.new) openNewGroup();
    else openGroup(f.dataset.group);
  });

  $("btn-newgroup").addEventListener("click", openNewGroup);
  $("btn-gback").addEventListener("click", backGroups);
  $("btn-gcover").addEventListener("click", () => {
    if (S.gview) openCoverPicker(S.gview);
  });

  // 点遮罩关掉弹层
  $("sheetmask").addEventListener("click", (e) => {
    if (e.target === $("sheetmask")) closeSheet();
  });

  $("grid").addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (c) toast("预览还没做，下一批上线");
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
  $("pins-manage").addEventListener("click", () => toast("长按分组卡片可以置顶 / 换封面"));
  $("inbox-undo").addEventListener("click", () => ($("inbox").hidden = true));
}

/* ---------- 启动 ---------- */

wire();
refresh();
