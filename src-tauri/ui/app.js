window.__t0 = performance.now();
const { invoke, convertFileSrc } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);

const grid = $('grid');
const empty = $('empty');
const toastEl = $('toast');
const tip = $('tip');
const qInput = $('q');

let toastTimer = null;
let editing = null;
let currentGroup = '__all__';
let confirmResolve = null;
let promptResolve = null;
let menuGroup = null;
let dragSha = null;
let dragShas = [];
let allGroups = [];
let allTags = [];
let editTags = new Set();
let editGroups = new Set();
let popEl = null;
let selected = new Set();
let shownItems = [];
let listLimit = 3000;
let lastIndex = -1;
let selectionMode = false;
let selectModePinned = false;
let anchorIndex = null;
let anchorMode = 'add';
let trashSelected = new Set();
let trashItems = [];
let starStyle = localStorage.getItem('stickerbox-star-style') || 'heart';
let starColor = localStorage.getItem('stickerbox-star-color') || '#f5b301';
let hoverDelay = Number(localStorage.getItem('stickerbox-hover-delay') || 350);
let gridSize = localStorage.getItem('stickerbox-grid-size') || 'normal';
let copyDefault = localStorage.getItem('stickerbox-copy-default') || 'bitmap';
let startHidden = false;
let startView = 'all';
let winW = 1040;
let winH = 700;
let panelW = 720;
let panelH = 520;
let panelX = 0;
let panelY = 0;
let panelSort = 'recent';
let recentLimit = 60;
let virtualize = true;
let clipboardBlacklist = [];
let virtStart = -1;
let virtEnd = -1;
const VIRTUAL_MIN = 120;
let deleteMode = localStorage.getItem('stickerbox-delete-mode') || 'recycle';
let ghostX = Number(localStorage.getItem('stickerbox-ghost-x') || 0);
let ghostY = Number(localStorage.getItem('stickerbox-ghost-y') || 0);

/* ---------- 图标（Lucide，ISC） ---------- */

const ICONS = {
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/>',
  'folder-plus':
    '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'image-plus':
    '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  'check-square': '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v6h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  tag: '<path d="M20.59 13.41 13.4 20.6a2 2 0 0 1-2.82 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1.2"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
};

function icon(name, size) {
  const body = ICONS[name] || '';
  return `<svg class="ui-icon" width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function paintSelectMode() {
  const btn = $('select-mode');
  if (!btn) return;
  btn.innerHTML = `${icon('check-square', 15)}<span>${selectionMode ? '退出多选' : '多选'}</span>`;
}

function paintIcons() {
  const iconOnly = (id, name, size) => {
    const el = $(id);
    if (el) el.innerHTML = icon(name, size);
  };
  iconOnly('settings-btn', 'settings', 18);
  iconOnly('pin', 'pin', 17);
  iconOnly('q-clear', 'x', 14);
  iconOnly('group-add', 'plus', 14);

  const withText = (id, name, label) => {
    const el = $(id);
    if (el) el.innerHTML = `${icon(name, 15)}<span>${label}</span>`;
  };
  withText('pick', 'folder-plus', '导入文件夹…');
  withText('pick-files', 'image-plus', '导入图片…');
  withText('filter-btn', 'filter', '筛选');
  withText('empty-trash', 'trash', '清空回收站');
}

/* ---------- 主题 ---------- */

const THEME_KEY = 'stickerbox-theme';
let themes = [];
let appliedVars = [];

async function loadThemes() {
  try {
    themes = await invoke('themes_list');
  } catch (_) {
    themes = [];
  }
}

function fillThemeOptions() {
  const sel = $('set-theme');
  if (!sel) return;
  sel.innerHTML = '';
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  };
  add('dark', '深色（内置）');
  add('light', '浅色（内置）');
  for (const t of themes) add(t.id, t.name + (t.builtin ? '' : ' · 自定义'));
}

function applyTheme(t) {
  const root = document.documentElement;
  for (const k of appliedVars) root.style.removeProperty(k);
  appliedVars = [];

  if (t === 'dark' || t === 'light') {
    root.dataset.theme = t;
    root.dataset.themeId = t;
    return;
  }

  const def = themes.find((x) => x.id === t);
  if (!def) {
    root.dataset.theme = 'dark';
    root.dataset.themeId = 'dark';
    return;
  }
  root.dataset.theme = def.dark === false ? 'light' : 'dark';
  root.dataset.themeId = t;
  const colors = def.colors || {};
  for (const [k, v] of Object.entries(colors)) {
    if (!k.startsWith('--')) continue;
    root.style.setProperty(k, String(v));
    appliedVars.push(k);
  }
}

let theme = localStorage.getItem(THEME_KEY) || 'dark';
applyTheme(theme);

function glyphOf(style) {
  return style === 'star' ? '★' : '♥';
}

const GRID_SIZES = { compact: '88px', normal: '104px', large: '150px' };

function applyFlashVars() {
  const root = document.documentElement;
  root.style.setProperty('--flash-color', flashColor);
  root.style.setProperty('--flash-dur', `${Math.max(0, flashDuration)}ms`);
}

function flashCards(shas) {
  if (!flashDuration || !shas || !shas.length) return;
  const set = new Set(shas);
  grid.querySelectorAll('.card').forEach((el) => {
    const a = shownItems[Number(el.dataset.index)];
    if (!a || !set.has(a.sha)) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), flashDuration + 40);
  });
}

function applyCursorRing() {
  const cols = cursorColors.length ? cursorColors : ['#6ea8fe', '#f5b301'];
  // 末尾补回第一个颜色，让 0° 和 360° 接得上，否则会出现一条硬接缝
  const stops = cols.length === 1 ? [cols[0], cols[0]] : [...cols, cols[0]];
  // 必须写在 ::before 自己的规则里：var(--cursor-angle) 要在动画所在元素上求值才会转
  let el = document.getElementById('cursor-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'cursor-style';
    document.head.appendChild(el);
  }
  el.textContent = `
.card.cursor::before {
  background: conic-gradient(from var(--cursor-angle), ${stops.join(', ')});
  animation: cursor-spin ${cursorSpeed}s linear infinite;
  animation-delay: calc(-1 * var(--cursor-phase, 0s));
}`;
}

function renderCursorColors() {
  const box = $('cursor-colors');
  if (!box) return;
  box.innerHTML = '';
  cursorColors.forEach((c, i) => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.className = 'color-input';
    inp.value = c;
    inp.addEventListener('input', () => {
      cursorColors[i] = inp.value;
      applyCursorRing();
    });
    inp.addEventListener('change', () => saveSettings({ cursorColors }));

    const wrap = document.createElement('span');
    wrap.className = 'color-item';
    wrap.appendChild(inp);
    if (cursorColors.length > 1) {
      const del = document.createElement('button');
      del.className = 'color-del';
      del.innerHTML = icon('x', 12);
      del.title = '删除这个颜色';
      del.addEventListener('click', () => {
        cursorColors.splice(i, 1);
        renderCursorColors();
        saveSettings({ cursorColors });
      });
      wrap.appendChild(del);
    }
    box.appendChild(wrap);
  });
  if (cursorColors.length < 8) {
    const add = document.createElement('button');
    add.className = 'btn small';
    add.innerHTML = icon('plus', 14);
    add.title = '增加一种颜色';
    add.addEventListener('click', () => {
      cursorColors.push('#f5b301');
      renderCursorColors();
      saveSettings({ cursorColors });
    });
    box.appendChild(add);
  }
}

function applyGridSize() {
  document.documentElement.style.setProperty('--card-min', GRID_SIZES[gridSize] || GRID_SIZES.normal);
}

function applyStarColor() {
  document.documentElement.style.setProperty('--star', starColor);
}

function saveSettings(patch) {
  invoke('patch_settings', { patch }).catch(() => {});
}

/// 启动时从库里的 settings.json 读取；老用户的数据从 localStorage 迁移过去
async function syncSettings() {
  let s = {};
  try {
    s = await invoke('get_settings');
  } catch (_) {
    s = {};
  }
  const seed = {};
  if (s.theme) theme = s.theme;
  else if (localStorage.getItem(THEME_KEY)) seed.theme = localStorage.getItem(THEME_KEY);

  if (s.starStyle) starStyle = s.starStyle;
  else if (s.starGlyph === '★') {
    starStyle = 'star';
    seed.starStyle = starStyle;
  } else if (s.starGlyph === '♥') {
    starStyle = 'heart';
    seed.starStyle = starStyle;
  }

  if (s.startView) startView = s.startView;
  if (typeof s.windowWidth === 'number') winW = s.windowWidth;
  if (typeof s.windowHeight === 'number') winH = s.windowHeight;
  if (typeof s.panelWidth === 'number') panelW = s.panelWidth;
  if (typeof s.panelHeight === 'number') panelH = s.panelHeight;
  if (typeof s.panelX === 'number') panelX = s.panelX;
  if (typeof s.panelY === 'number') panelY = s.panelY;
  if (s.panelSort) panelSort = s.panelSort;
  if (typeof s.recentLimit === 'number') recentLimit = s.recentLimit;
  if (typeof s.virtualize === 'boolean') virtualize = s.virtualize;
  if (Array.isArray(s.clipboardBlacklist)) clipboardBlacklist = s.clipboardBlacklist.slice();
  const rawKeymap = s.keymap && typeof s.keymap === 'object' ? s.keymap : {};
  const hadLegacy = JSON.stringify(rawKeymap).includes('mouse-');
  userKeymap = rawKeymap;
  buildKeymap(userKeymap);
  if (hadLegacy) saveSettings({ keymap: userKeymap });
  if (s.gridSize) gridSize = s.gridSize;
  if (s.copyDefault) copyDefault = s.copyDefault;
  if (typeof s.startHidden === 'boolean') startHidden = s.startHidden;
  if (typeof s.scrolloff === 'number') scrolloff = s.scrolloff;
  if (typeof s.cursorSpeed === 'number') cursorSpeed = s.cursorSpeed;
  if (typeof s.flashColor === 'string') flashColor = s.flashColor;
  if (typeof s.flashDuration === 'number') flashDuration = s.flashDuration;
  if (s.filters && typeof s.filters === 'object') assetFilters = Object.assign(assetFilters, s.filters);
  applyFlashVars();
  if (Array.isArray(s.cursorColors) && s.cursorColors.length) cursorColors = s.cursorColors;
  applyCursorRing();
  if (s.starColor) starColor = s.starColor;
  applyGridSize();
  if (typeof s.hoverDelay === 'number') hoverDelay = s.hoverDelay;
  applyStarColor();

  if (s.deleteMode) deleteMode = s.deleteMode;
  else if (localStorage.getItem('stickerbox-delete-mode')) seed.deleteMode = localStorage.getItem('stickerbox-delete-mode');

  if (typeof s.ghostX === 'number') ghostX = s.ghostX;
  else if (localStorage.getItem('stickerbox-ghost-x') !== null) seed.ghostX = Number(localStorage.getItem('stickerbox-ghost-x'));

  if (typeof s.ghostY === 'number') ghostY = s.ghostY;
  else if (localStorage.getItem('stickerbox-ghost-y') !== null) seed.ghostY = Number(localStorage.getItem('stickerbox-ghost-y'));

  await loadThemes();
  applyTheme(theme);
  if (Object.keys(seed).length) saveSettings(seed);
}


/* ---------- 小工具 ---------- */

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // 强制重排，让动画重新开始
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function debounce(fn, ms = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function fmtSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function thumbSrc(sha) {
  try {
    return convertFileSrc(sha, 'thumb');
  } catch (_) {
    return `http://thumb.localhost/${sha}`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function confirmDialog(text) {
  $('confirm-text').textContent = text;
  $('confirm').hidden = false;
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function closeConfirm(result) {
  $('confirm').hidden = true;
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

function promptDialog(title, value) {
  return new Promise((resolve) => {
    $('prompt-title').textContent = title;
    $('prompt-input').value = value || '';
    $('prompt').hidden = false;
    $('prompt-input').focus();
    $('prompt-input').select();
    promptResolve = resolve;
  });
}

function closePrompt(value) {
  $('prompt').hidden = true;
  if (promptResolve) {
    promptResolve(value);
    promptResolve = null;
  }
}

/* ---------- 多选控件 ---------- */

function closePop() {
  if (popEl) {
    popEl.remove();
    popEl = null;
  }
}

function openPop(anchor, options, set, repaint, onToggle) {
  closePop();
  const pop = document.createElement('div');
  pop.className = 'picker-pop';

  const list = document.createElement('div');
  list.className = 'pop-list';

  const merged = [...new Set([...options, ...set])];
  if (!merged.length) {
    const e = document.createElement('div');
    e.className = 'pop-empty';
    e.textContent = '还没有，下面输入新建';
    list.appendChild(e);
  }

  for (const opt of merged) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pop-row' + (set.has(opt) ? ' on' : '');
    const box = document.createElement('span');
    box.className = 'box';
    box.textContent = set.has(opt) ? '✓' : '';
    const label = document.createElement('span');
    label.textContent = opt;
    row.append(box, label);
    row.onclick = () => {
      if (set.has(opt)) set.delete(opt);
      else set.add(opt);
      row.classList.toggle('on');
      box.textContent = set.has(opt) ? '✓' : '';
      repaint();
      if (onToggle) onToggle(opt, set.has(opt));
    };
    list.appendChild(row);
  }
  pop.appendChild(list);

  const inp = document.createElement('input');
  inp.className = 'pop-input';
  inp.placeholder = '输入新名称后回车';
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    [...list.children].forEach((row) => {
      if (!row.classList.contains('pop-row')) return;
      const text = row.lastChild ? row.lastChild.textContent.toLowerCase() : '';
      row.hidden = !!q && !text.includes(q);
    });
  });
  inp.onkeydown = (e) => {
    if (e.key === 'Tab') {
      const q = inp.value.trim().toLowerCase();
      const hit = [...options]
        .sort((a, b) => a.localeCompare(b, 'zh'))
        .find((o) => q && o.toLowerCase().includes(q));
      if (hit) {
        e.preventDefault();
        inp.value = hit;
      }
      return;
    }
    if (e.key !== 'Enter') return;
    const v = inp.value.trim();
    if (!v) return;
    const exact = [...options].find((o) => o.toLowerCase() === v.toLowerCase());
    const name = exact || v;
    set.add(name);
    repaint();
    closePop();
    if (onToggle) onToggle(name, true);
  };
  pop.appendChild(inp);

  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const h = pop.offsetHeight || 280;
  const w = pop.offsetWidth || 230;
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  pop.style.top = top + 'px';
  popEl = pop;
  setTimeout(() => inp.focus(), 0);
}

function renderPickerIn(el, options, set, placeholder, opts = {}) {
  const allowNew = opts.allowNew !== false;
  el.innerHTML = '';

  const chips = document.createElement('div');
  chips.className = 'chips';
  const input = document.createElement('input');
  input.className = 'picker-input';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const inputRow = document.createElement('div');
  inputRow.className = 'picker-input-row';
  if (opts.heading) {
    const h = document.createElement('span');
    h.className = 'picker-heading';
    h.textContent = opts.heading;
    inputRow.appendChild(h);
  }
  const wrap = document.createElement('div');
  wrap.className = 'picker-input-wrap';
  const list = document.createElement('div');
  list.className = 'picker-suggest';
  list.hidden = true;
  wrap.append(input, list);
  inputRow.appendChild(wrap);
  el.append(chips, inputRow);

  const repaintChips = () => {
    chips.innerHTML = '';
    if (!set.size) return;
    for (const v of set) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const t = document.createElement('span');
      t.textContent = v;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.innerHTML = icon('x', 12);
      x.onclick = (e) => {
        e.stopPropagation();
        set.delete(v);
        repaintChips();
        renderSuggest();
        if (opts.onChange) opts.onChange(v, false);
      };
      chip.append(t, x);
      chips.appendChild(chip);
    }
  };

  const candidates = () => {
    const q = input.value.trim().toLowerCase();
    const avail = options.filter((o) => !set.has(o));
    const pool = q ? avail.filter((o) => o.toLowerCase().includes(q)) : avail;
    return pool.slice().sort((a, b) => a.localeCompare(b, 'zh')).slice(0, 3);
  };

  const renderSuggest = () => {
    const cands = candidates();
    list.innerHTML = '';
    if (!cands.length) {
      list.hidden = true;
      return;
    }
    for (const name of cands) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'picker-suggest-row';
      const label = document.createElement('span');
      label.textContent = name;
      const kbd = document.createElement('kbd');
      kbd.textContent = 'Tab';
      row.append(label, kbd);
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => add(name));
      list.appendChild(row);
    }
    list.hidden = false;
  };

  const add = (name) => {
    const v = String(name || '').trim();
    if (!v) return;
    set.add(v);
    input.value = '';
    repaintChips();
    renderSuggest();
    if (opts.onChange) opts.onChange(v, true);
  };

  input.addEventListener('input', renderSuggest);
  input.addEventListener('focus', renderSuggest);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const cands = candidates();
      if (cands[0]) {
        e.preventDefault();
        input.value = cands[0];
        renderSuggest();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      const exact = options.find((o) => o.toLowerCase() === v.toLowerCase());
      if (exact) add(exact);
      else if (allowNew) add(v);
      return;
    }
    if (e.key === 'Escape') {
      input.blur();
      list.hidden = true;
    }
  });

  repaintChips();
}

function renderPicker(id, options, set, placeholder, opts = {}) {
  renderPickerIn($(id), options, set, placeholder, opts);
}

function renderEditChips() {
  const fill = (el, values, emptyText) => {
    el.innerHTML = '';
    if (!values.length) {
      const s = document.createElement('span');
      s.className = 'ed-empty';
      s.textContent = emptyText;
      el.appendChild(s);
      return;
    }
    for (const v of values) {
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = v;
      el.appendChild(s);
    }
  };
  fill($('e-tags'), [...editTags], '还没有标签，点右上「编辑标签」');
  fill($('e-groups'), [...editGroups], '不在任何分组，点右上「编辑分组」');
}

/* ---------- 列表 ---------- */

function resolveStartView() {
  const v = startView || 'all';
  if (v === 'recent') return '__recent__';
  if (v === 'star') return '__star__';
  if (v === 'ungrouped') return '__none__';
  if (v === 'all') return '__all__';
  if (v.startsWith('group:')) {
    const name = v.slice(6);
    return allGroups.includes(name) ? name : '__all__';
  }
  return '__all__';
}

function groupParam() {
  if (currentGroup === '__all__') return null;
  if (currentGroup === '__none__') return '';
  return currentGroup;
}

async function refresh(q) {
  if (currentGroup === '__trash__') {
    await loadTrash();
    return;
  }
  $('empty-trash').hidden = true;
  const query = q === undefined ? qInput.value : q;
  const activeFilters = filtersActive() ? assetFilters : null;
  const items = await invoke('list_assets', {
    q: query,
    group: groupParam(),
    limit: listLimit,
    filters: activeFilters ? JSON.stringify(activeFilters) : null,
  });
  updateFilterChip();
  render(items);
  const more = $('load-more');
  if (more) {
    const full = items.length >= listLimit;
    more.hidden = !full;
    if (full) more.textContent = `已显示 ${items.length} 张 · 加载更多`;
  }
}

function gridMetrics() {
  const gap = 8;
  const minW =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-min')) || 112;
  const w = grid.clientWidth || 1;
  const cols = Math.max(1, Math.floor((w + gap) / (minW + gap)));
  const cardW = Math.max(1, (w - gap * (cols - 1)) / cols);
  const rows = Math.ceil(shownItems.length / cols);
  return { gap, cols, cardW, rowH: cardW + gap, rows };
}

function virtualOn() {
  return virtualize && shownItems.length > VIRTUAL_MIN;
}

function buildCard(a, idx, m) {
  const el = document.createElement('button');
  el.className = 'card' + (selected.has(a.sha) ? ' selected' : '');
  el.dataset.index = idx;
  if (m) {
    el.style.left = `${(idx % m.cols) * (m.cardW + m.gap)}px`;
    el.style.top = `${Math.floor(idx / m.cols) * m.rowH}px`;
    el.style.width = `${m.cardW}px`;
    el.style.height = `${m.cardW}px`;
  }
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    beginPointerDrag(e, a);
  });
  let hoverTimer = null;
  el.addEventListener('mouseenter', (e) => {
    showTip(a, e);
    if (a.animated && hoverDelay > 0) {
      hoverTimer = setTimeout(() => {
        img.src = convertFileSrc(a.path);
        el.dataset.anim = '1';
      }, hoverDelay);
    }
  });
  el.addEventListener('mousemove', moveTip);
  el.addEventListener('mouseleave', () => {
    hideTip();
    clearTimeout(hoverTimer);
    if (el.dataset.anim) {
      img.src = thumbSrc(a.sha);
  if (img.complete && img.naturalWidth) el.classList.remove('loading');
      delete el.dataset.anim;
    }
  });
  el.addEventListener('click', (e) => {
    if (suppressClick) return;
    cursor = idx;
    paintCursor();
    const combo = mouseCombo(e, 0);
    // 单纯的左键单击：走防抖复制；双击时 e.detail 变成 2，直接取消待执行的那次复制
    if (combo === 'mouse1' && (keymap['mouse1'] || []).includes('click')) {
      if (e.detail > 1) {
        clearTimeout(clickCopyTimer);
        return;
      }
      if (currentGroup === '__trash__') {
        executeAction('click', 1, e);
        return;
      }
      if (selectionMode || selected.size > 0) {
        toggleSelect(a.sha, idx);
        return;
      }
      clearTimeout(clickCopyTimer);
      clickCopyTimer = setTimeout(() => copy(a), 260);
      return;
    }
    const acts = keymap[combo];
    if (acts && acts.length) {
      e.preventDefault();
      executeAction(acts[0], 1, e);
      return;
    }
    if (selectionMode || selected.size > 0) {
      toggleSelect(a.sha, idx);
      return;
    }
    clearTimeout(clickCopyTimer);
    clickCopyTimer = setTimeout(() => copy(a), 260);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearTimeout(clickCopyTimer);
    // 右键先把自己变成光标，菜单里的动作才作用到这张
    cursor = idx;
    paintCursor();
    hideTip();
    openCardMenu(a, e.clientX, e.clientY);
  });
  el.addEventListener('dblclick', (e) => {
    // 双击 = 编辑（单击的复制已按下去的时间清掉）
    e.preventDefault();
    clearTimeout(clickCopyTimer);
    openEditor(a);
  });

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.draggable = false;
  el.classList.add('loading');
  img.onload = () => el.classList.remove('loading');
  img.src = thumbSrc(a.sha);
  if (img.complete && img.naturalWidth) el.classList.remove('loading');
  img.onerror = () => {
    img.onerror = null;
    img.src = convertFileSrc(a.path);
  };
  el.appendChild(img);

  if (a.starred && currentGroup !== '__star__') {
    const star = document.createElement('span');
    star.className = 'badge-star';
    star.textContent = glyphOf(starStyle);
    el.appendChild(star);
  }
  if (a.animated) {
    const badge = document.createElement('span');
    badge.className = 'badge-gif';
    badge.textContent = '动图';
    el.appendChild(badge);
  }
  return el;
}

function render(items) {
  hideTip();
  shownItems = items;
  if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
  grid.innerHTML = '';
  grid.style.height = '';
  virtStart = -1;
  virtEnd = -1;
  grid.classList.toggle('virtual', virtualOn());
  empty.style.display = items.length ? 'none' : 'block';

  const p = empty.querySelector('p');
  const hint = empty.querySelectorAll('p')[1];
  const fq = (qInput.value || '').trim();
  if (p) {
    if (fq) p.textContent = '没有匹配的表情。';
    else if (filtersActive()) p.textContent = '当前筛选没有结果。';
    else if (currentGroup === '__star__') p.textContent = '还没有收藏。';
    else if (currentGroup === '__recent__') p.textContent = '最近还没用过。';
    else if (currentGroup === '__none__') p.textContent = '所有表情都已经分组了。';
    else if (currentGroup !== '__all__' && !currentGroup.startsWith('__')) p.textContent = '这个分组还是空的。';
    else p.textContent = '这里还没有表情。';
  }
  if (hint) hint.style.display = fq || currentGroup !== '__all__' ? 'none' : '';

  if (virtualOn()) {
    renderVirtual(true);
  } else {
    const frag = document.createDocumentFragment();
    items.forEach((a, idx) => frag.appendChild(buildCard(a, idx, null)));
    grid.appendChild(frag);
    paintCursor();
  }
  updateBatchBar();
}

function renderVirtual(force) {
  if (!grid.classList.contains('virtual') || !shownItems.length) return;
  const m = gridMetrics();
  grid.style.height = `${Math.max(0, m.rows * m.rowH - m.gap)}px`;
  const scroller = document.querySelector('main');
  const gr = grid.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const top = gr.top - sr.top;
  let startRow = Math.floor(-top / m.rowH) - 2;
  let endRow = Math.ceil((scroller.clientHeight - top) / m.rowH) + 2;
  startRow = Math.max(0, startRow);
  endRow = Math.min(m.rows, endRow);
  const start = startRow * m.cols;
  const end = Math.min(shownItems.length, endRow * m.cols);
  if (!force && start === virtStart && end === virtEnd) return;
  virtStart = start;
  virtEnd = end;

  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) frag.appendChild(buildCard(shownItems[i], i, m));
  grid.appendChild(frag);
  paintCursor();
  paintSelection();
}

let virtScrollPending = false;
document.querySelector('main').addEventListener(
  'scroll',
  () => {
    if (!grid.classList.contains('virtual')) return;
    if (virtScrollPending) return;
    virtScrollPending = true;
    requestAnimationFrame(() => {
      virtScrollPending = false;
      renderVirtual(false);
    });
  },
  { passive: true }
);

window.addEventListener('resize', () => {
  if (grid.classList.contains('virtual')) renderVirtual(true);
});

function toggleSelect(sha, idx) {
  if (selected.has(sha)) selected.delete(sha);
  else selected.add(sha);
  lastIndex = idx;
  paintSelection();
}

function applyRange(from, to, mode) {
  const [a, b] = from < to ? [from, to] : [to, from];
  for (let i = a; i <= b; i++) {
    const item = shownItems[i];
    if (!item) continue;
    if (mode === 'sub') selected.delete(item.sha);
    else selected.add(item.sha);
  }
  paintSelection();
  flashRange(a, b);
}

function rangeSelect(idx) {
  if (lastIndex < 0) {
    toggleSelect(shownItems[idx].sha, idx);
    return;
  }
  const [from, to] = lastIndex < idx ? [lastIndex, idx] : [idx, lastIndex];
  for (let i = from; i <= to; i++) {
    const a = shownItems[i];
    if (a) selected.add(a.sha);
  }
  paintSelection();
  flashRange(from, to);
}

function rangeDeselect(idx) {
  if (lastIndex < 0) return;
  const [from, to] = lastIndex < idx ? [lastIndex, idx] : [idx, lastIndex];
  for (let i = from; i <= to; i++) {
    const a = shownItems[i];
    if (a) selected.delete(a.sha);
  }
  paintSelection();
  flashRange(from, to);
}

/// 给区间加一层短暂的高亮，让人看清"这次选到哪"
function flashRange(from, to) {
  grid.querySelectorAll('.card').forEach((el) => {
    const i = Number(el.dataset.index);
    if (i < from || i > to) return;
    el.classList.add('range-flash');
    setTimeout(() => el.classList.remove('range-flash'), 650);
  });
}

function syncSelectionMode() {
  const on = selectModePinned || selected.size >= 2;
  if (on === selectionMode) return;
  selectionMode = on;
  const btn = $('select-mode');
  if (btn) {
    btn.classList.toggle('active', on);
    paintSelectMode();
  }
}

function paintSelection() {
  syncSelectionMode();
  const isTrash = currentGroup === '__trash__';
  const bag = isTrash ? trashSelected : selected;
  grid.querySelectorAll('.card').forEach((el) => {
    const i = Number(el.dataset.index);
    const a = shownItems[i];
    if (!a) return;
    el.classList.toggle('selected', bag.has(a.sha));
    el.classList.toggle('anchor', anchorIndex === i && anchorMode === 'add');
    el.classList.toggle('anchor-sub', anchorIndex === i && anchorMode === 'sub');
  });
  if (!isTrash) updateBatchBar();
}

function clearSelection() {
  selected.clear();
  lastIndex = -1;
  anchorIndex = null;
  anchorMode = 'add';
  paintSelection();
}

function updateBatchBar() {
  setTimeout(updateBatchDock, 0);
  const bar = $('batchbar');
  bar.hidden = !selectionMode && selected.size === 0;
  $('batch-count').textContent = `已选 ${selected.size} 张`;

  const leaveBtn = $('batch-leave');
  if (leaveBtn) {
    const inGroup = currentGroup !== '__all__' && currentGroup !== '__none__' && currentGroup !== '__trash__' && currentGroup !== '__star__' && currentGroup !== '__recent__';
    leaveBtn.hidden = !inGroup;
    if (inGroup) leaveBtn.textContent = `移出「${currentGroup}」`;
  }

  const starBtn = document.querySelector('#batchbar [data-act="star"]');
  if (starBtn) {
    const shas = [...selected];
    const allStarred =
      shas.length > 0 &&
      shas.every((sha) => {
        const a = shownItems.find((x) => x.sha === sha);
        return a && a.starred;
      });
    starBtn.textContent = allStarred || currentGroup === '__star__' ? '取消收藏' : '收藏';
  }
}

function exitSelectionMode() {
  selectModePinned = false;
  if (!selectionMode) return;
  selectionMode = false;
  $('select-mode').classList.remove('active');
  paintSelectMode();
}

// 多选模式开关（给不用快捷键的人）
$('select-mode').addEventListener('click', () => {
  selectionMode = !selectionMode;
  selectModePinned = selectionMode;
  $('select-mode').classList.toggle('active', selectionMode);
  paintSelectMode();
  if (!selectionMode) clearSelection();
  updateBatchBar();
});

async function loadTrash() {
  hideTip();
  const items = await invoke('trash_list', {
    q: qInput.value.trim(),
    filters: filtersActive() ? JSON.stringify(assetFilters) : null,
  });
  updateFilterChip();
  trashItems = items;
  shownItems = items;
  if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
  trashSelected.clear();
  $('trashbar').hidden = true;
  grid.innerHTML = '';
  empty.style.display = items.length ? 'none' : 'block';
  const p = empty.querySelector('p');
  if (p) p.textContent = '回收站是空的。';
  $('empty-trash').hidden = items.length === 0;

  const frag = document.createDocumentFragment();
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'card trash-card';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = thumbSrc(it.sha);
    img.onerror = () => img.remove();
    el.appendChild(img);


    let hoverTimer = null;
    el.addEventListener('mouseenter', (e) => {
      showTip(it, e);
      if (!it.animated) return;
      if (hoverDelay <= 0) return;
      hoverTimer = setTimeout(() => {
        el.dataset.anim = '1';
        img.src = thumbSrc(it.sha) + '?raw=1';
      }, hoverDelay);
    });
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseleave', () => {
      hideTip();
      clearTimeout(hoverTimer);
      if (el.dataset.anim) {
        img.src = thumbSrc(it.sha);
        delete el.dataset.anim;
      }
    });
    el.addEventListener('click', () => {
      cursor = trashItems.indexOf(it);
      paintCursor();
      if (trashSelected.has(it.sha)) trashSelected.delete(it.sha);
      else trashSelected.add(it.sha);
      el.classList.toggle('selected', trashSelected.has(it.sha));
      updateTrashBar();
    });

    frag.appendChild(el);
  }
  grid.appendChild(frag);
  paintCursor();
  $('batchbar').hidden = true;
  updateTrashBar();
}

let pointerDrag = null;
let caretEl = null;

function orderKey() {
  if ((qInput.value || '').trim()) return null;
  if (currentGroup === '__all__' || currentGroup === '__none__' || currentGroup === '__recent__' || currentGroup === '__trash__') {
    return null;
  }
  return currentGroup;
}

function insertionIndex(e) {
  if (grid.classList.contains('virtual')) {
    const m = gridMetrics();
    const gr = grid.getBoundingClientRect();
    const x = e.clientX - gr.left;
    const y = e.clientY - gr.top;
    const row = Math.max(0, Math.min(Math.max(0, m.rows - 1), Math.floor(y / m.rowH)));
    const col = Math.max(0, Math.min(m.cols - 1, Math.floor(x / (m.cardW + m.gap))));
    const idx = Math.min(shownItems.length - 1, row * m.cols + col);
    const inCardX = x - col * (m.cardW + m.gap);
    return Math.min(shownItems.length, inCardX > m.cardW / 2 ? idx + 1 : idx);
  }
  const cards = [...grid.children];
  if (!cards.length) return 0;

  // 先找指针所在的那一行里、水平方向最近的一张
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      const cx = r.left + r.width / 2;
      const d = Math.abs(e.clientX - cx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }

  // 落点在某一行下方的空隙里：取下一行的第一张
  if (best < 0) {
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top) {
        best = i;
        break;
      }
    }
    if (best < 0) best = cards.length - 1;
  }

  const r = cards[best].getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? best : best + 1;
}

function showCaret(idx) {
  if (!caretEl) {
    caretEl = document.createElement('div');
    caretEl.className = 'drop-caret';
    document.body.appendChild(caretEl);
  }
  if (grid.classList.contains('virtual')) {
    const m = gridMetrics();
    const gr = grid.getBoundingClientRect();
    let row = Math.floor(idx / m.cols);
    let col = idx % m.cols;
    if (col === 0 && idx > 0) {
      row -= 1;
      col = m.cols;
    }
    caretEl.style.height = `${m.cardW}px`;
    caretEl.style.top = `${gr.top + row * m.rowH}px`;
    caretEl.style.left = `${gr.left + col * (m.cardW + m.gap) - m.gap / 2}px`;
    caretEl.style.display = 'block';
    return;
  }
  const cards = [...grid.children];
  const prev = idx > 0 ? cards[idx - 1] : null;
  const next = idx < cards.length ? cards[idx] : null;
  if (!prev && !next) return;

  // 如果插入点是「下一行的第一张」，就把插入线画在上一行末尾，
  // 这样在第一行末尾松手也能插到行尾，不用去够下一行开头。
  const wraps = !!(prev && next && prev.offsetTop !== next.offsetTop);
  let r;
  let x;
  if (wraps || !next) {
    r = (prev || next).getBoundingClientRect();
    x = r.right + 2;
  } else {
    r = next.getBoundingClientRect();
    x = r.left - 2;
  }
  caretEl.style.height = `${r.height}px`;
  caretEl.style.top = `${r.top}px`;
  caretEl.style.left = `${x}px`;
  caretEl.style.display = 'block';
}

function hideCaret() {
  if (caretEl) caretEl.style.display = 'none';
}
let suppressClick = false;
let clickCopyTimer = null;
let copyHits = 0; // 自测用：复制实际发生的次数

function beginPointerDrag(e, a) {
  const shas = selected.has(a.sha) && selected.size > 1 ? [...selected] : [a.sha];
  // 虚影最多叠三张，取选择集里的前几张，各不相同
  const thumbs = shas
    .slice(0, 3)
    .map((sha) => {
      const item = shownItems.find((x) => x.sha === sha);
      return item ? thumbSrc(item.sha) : thumbSrc(a.sha);
    });
  pointerDrag = {
    shas,
    thumbs,
    sx: e.clientX,
    sy: e.clientY,
    active: false,
    ghost: null,
    target: null,
  };
}

function makeGhost(shas, thumbs) {
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  const layers = Math.min(3, shas.length);
  for (let i = layers - 1; i >= 0; i--) {
    const im = document.createElement('img');
    im.src = thumbs[i] || thumbs[0];
    im.draggable = false;
    im.className = 'ghost-layer';
    im.style.transform = `translate(${i * 6}px, ${i * 6}px) rotate(${i * 2}deg)`;
    im.style.opacity = String(0.75 - i * 0.2);
    g.appendChild(im);
  }
  if (shas.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'ghost-count';
    badge.textContent = `${shas.length} 张`;
    g.appendChild(badge);
  }
  return g;
}

document.addEventListener('mousemove', (e) => {
  if (!pointerDrag) return;
  if (!pointerDrag.active && Math.hypot(e.clientX - pointerDrag.sx, e.clientY - pointerDrag.sy) < 6) return;

  if (!pointerDrag.active) {
    pointerDrag.active = true;
    const g = makeGhost(pointerDrag.shas, pointerDrag.thumbs);
    document.body.appendChild(g);
    pointerDrag.ghost = g;
    document.body.classList.add('drag-active');
    const sel = window.getSelection && window.getSelection();
    if (sel) sel.removeAllRanges();
  }

  pointerDrag.ghost.style.transform = `translate(${e.clientX + ghostX}px, ${e.clientY + ghostY}px)`;

  if (grid.classList.contains('virtual')) {
    const scroller = document.querySelector('main');
    const sr = scroller.getBoundingClientRect();
    if (e.clientY < sr.top + 48) scroller.scrollTop -= 18;
    else if (e.clientY > sr.bottom - 48) scroller.scrollTop += 18;
  }

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const item = under && under.closest ? under.closest('.side-item') : null;
  document.querySelectorAll('.side-item.drop-target').forEach((x) => x.classList.remove('drop-target'));
  const raw = item && item.dataset.group ? item.dataset.group : null;
  const allowed =
    raw === '__none__' || raw === '__star__' || raw === '__trash__' || (raw && !raw.startsWith('__'));
  const group = allowed ? raw : null;
  if (group) item.classList.add('drop-target');
  pointerDrag.target = group;

  // 在可排序视图里、鼠标位于网格上 → 显示插入位置
  if (!group && orderKey()) {
    const g = grid.getBoundingClientRect();
    const overGrid =
      e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom;
    if (overGrid && shownItems.length) {
      const idx = insertionIndex(e);
      pointerDrag.insert = idx;
      showCaret(idx);
    } else {
      pointerDrag.insert = null;
      hideCaret();
    }
  } else {
    pointerDrag.insert = null;
    hideCaret();
  }
});

document.addEventListener('mouseup', async () => {
  if (!pointerDrag) return;
  const drag = pointerDrag;
  const { active, shas, target, ghost } = drag;
  pointerDrag = null;
  if (ghost) ghost.remove();
  document.body.classList.remove('drag-active');
  document.querySelectorAll('.side-item.drop-target').forEach((x) => x.classList.remove('drop-target'));

  if (!active) return;
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 50);
  hideCaret();

  const insert = drag.insert;
  if (!target && insert != null) {
    const key = orderKey();
    if (!key) return;
    const moving = shownItems.filter((a) => shas.includes(a.sha));
    const rest = shownItems.filter((a) => !shas.includes(a.sha));
    const before = shownItems.slice(0, insert).filter((a) => !shas.includes(a.sha)).length;
    rest.splice(before, 0, ...moving);
    try {
      await invoke('set_order', { key, shas: rest.map((a) => a.sha) });
      logAction('已调整排序');
      await refresh();
    } catch (err) {
      toast('排序失败：' + err);
    }
  }
  if (!target) return;

  try {
    if (target === '__none__') {
      await invoke('clear_groups', { shas });
      logAction(`已把 ${shas.length} 张移出分组`);
    } else if (target === '__star__') {
      await invoke('batch_star', { shas, on: true });
      logAction(`已收藏 ${shas.length} 张`);
    } else if (target === '__trash__') {
      await invoke('batch_delete', { shas });
      logAction(`已把 ${shas.length} 张移入回收站`);
    } else {
      await invoke('add_to_group', { shas, group: target });
      logAction(`已把 ${shas.length} 张加入「${target}」`);
    }
    clearSelection();
    await Promise.all([refresh(), loadGroups()]);
  } catch (err) {
    toast('拖拽失败：' + err);
  }
});

function readDragShas(e) {
  try {
    const raw = e.dataTransfer.getData('text/plain');
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.length) return v;
  } catch (_) {
    /* 老格式：单个 sha */
  }
  return dragShas.length ? dragShas : dragSha ? [dragSha] : [];
}

function updateTrashBar() {
  const bar = $('trashbar');
  if (!bar) return;
  bar.hidden = trashSelected.size === 0;
  $('trash-count').textContent = `已选 ${trashSelected.size} 张`;
}

$('trashbar').addEventListener('click', async (e) => {
  e.stopPropagation();
  const act = e.target.dataset && e.target.dataset.tact;
  if (!act) return;

  if (act === 'clear') {
    trashSelected.clear();
    document.querySelectorAll('.trash-card.selected').forEach((el) => el.classList.remove('selected'));
    updateTrashBar();
    return;
  }

  if (act === 'all') {
    trashSelected = new Set(trashItems.map((i) => i.sha));
    document.querySelectorAll('.trash-card').forEach((el, i) => {
      const it = trashItems[i];
      if (it) el.classList.toggle('selected', trashSelected.has(it.sha));
    });
    updateTrashBar();
    return;
  }

  const shas = [...trashSelected];
  if (!shas.length) return;

  try {
    if (act === 'restore') {
      for (const sha of shas) await invoke('trash_restore', { sha });
      toast(`已恢复 ${shas.length} 张`);
    }
    if (act === 'delete') {
      const ok = await confirmDialog(`彻底删除选中的 ${shas.length} 张？`);
      if (!ok) return;
      for (const sha of shas) {
        await invoke('trash_delete', { sha, permanent: deleteMode === 'permanent' });
      }
      toast(`已删除 ${shas.length} 张`);
    }
  } catch (err) {
    toast('操作失败：' + err);
  }

  trashSelected.clear();
  await Promise.all([refresh(), loadGroups(), showStats()]);
});

async function afterUse() {
  if (currentGroup === '__recent__') {
    await refresh();
  }
  await loadGroups();
}

const TIPS = [
  'Shift + 左键：从紫色锚点连续选到当前位置',
  '再点一次已选中的图会变成红色锚点，之后 Shift 就是减选',
  '虚线框是锚点，实线是当前选中',
  '把选中的图拖到左侧分组，可以一次归组',
  '右键打开编辑：改名、标签、分组都在这里',
  'GIF 点击复制的是原文件，粘贴后动画还在',
  '导入时路径框会原地变成进度条',
];

let tipIndex = 0;
let tipTimer = null;

function showFooterTip() {
  const el = $('last-action');
  if (!el) return;
  el.textContent = TIPS[tipIndex % TIPS.length];
  tipIndex += 1;
  el.classList.remove('flash');
  el.classList.add('hint');
}

function logAction(text) {
  setLastAction(text);
}

function setLastAction(text) {
  const el = $('last-action');
  if (!el) return;
  const now = new Date();
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  el.textContent = `${text} · ${t}`;
  el.classList.remove('hint');
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');

  clearTimeout(tipTimer);
  tipTimer = setTimeout(showFooterTip, 4200);
}

async function copy(a) {
  copyHits += 1;
  // 动图（GIF / APNG / 动画 WebP）走「复制文件」：位图剪贴板会把动画压成一帧
  const animated = !!a.animated;
  const asFile = copyDefault === 'file' || animated;
  try {
    if (asFile) {
      await invoke('copy_asset_file', { sha: a.sha });
      setLastAction(`已复制原文件「${a.name}」`);
      toast('已复制原文件（保留动画），去聊天窗口 Ctrl+V');
      await afterUse();
    } else {
      await invoke('copy_asset', { sha: a.sha });
      setLastAction(`已复制「${a.name}」`);
      toast('已复制到剪贴板，去聊天窗口 Ctrl+V');
      await afterUse();
    }
  } catch (e) {
    toast('复制失败：' + e);
  }
}

/* ---------- 悬浮信息 ---------- */

const APP_NAMES = {
  'weixin.exe': '微信',
  'wechat.exe': '微信',
  'qq.exe': 'QQ',
  'qqnt.exe': 'QQ',
  'telegram.exe': 'Telegram',
  'discord.exe': 'Discord',
  'snipaste.exe': 'Snipaste',
  'explorer.exe': '资源管理器',
  'chrome.exe': 'Chrome',
  'msedge.exe': 'Edge',
  'firefox.exe': 'Firefox',
};

function friendlySource(a) {
  if (a.source === 'folder') return '本地导入';
  if (a.source === 'clipboard') {
    const raw = (a.source_ref || '').split(/[\/]/).pop() || '剪贴板';
    return `剪贴板 · ${APP_NAMES[raw.toLowerCase()] || raw}`;
  }
  return a.source || '未知';
}

function showTip(a, e) {
  const tags = a.tags && a.tags.length ? a.tags.join(' · ') : '无标签';
  const groups = a.groups && a.groups.length ? a.groups.join(' · ') : '未分组';
  tip.innerHTML = `
    <div class="tip-name">${escapeHtml(a.name)}</div>
    <div class="tip-row">${a.width} × ${a.height} · ${fmtSize(a.bytes)}</div>
    <div class="tip-row">${escapeHtml(a.ext.toUpperCase())} · 导入于 ${fmtDate(a.added_at)}</div>
    <div class="tip-row">来源：${escapeHtml(friendlySource(a))}</div>
    <div class="tip-row">分组：${escapeHtml(groups)}</div>
    <div class="tip-tags">${escapeHtml(tags)}</div>
  `;
  tip.classList.add('show');
  moveTip(e);
}

function moveTip(e) {
  if (!tip.classList.contains('show')) return;
  const pad = 16;
  const rect = tip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
  tip.style.transform = `translate(${x}px, ${y}px)`;
}

function hideTip() {
  tip.classList.remove('show');
}

/* ---------- 分组 ---------- */

let groupMeta = [];
let dragGroup = null;
let coverGroup = null;

async function loadGroups() {
  const [data, meta, tags] = await Promise.all([
    invoke('group_stats'),
    invoke('group_list'),
    invoke('tag_stats'),
  ]);
  groupMeta = meta.groups;
  allGroups = meta.groups.map((g) => g.name);
  allTags = tags.map((t) => t.name);
  $('c-tags').textContent = String(allTags.length);

  $('c-all').textContent = data.total;
  $('c-star').textContent = data.starred;
  $('c-recent').textContent = data.recent;

  const badge = $('c-none');
  const news = data.ungroupedNew > 99 ? '99+' : String(data.ungroupedNew);
  badge.innerHTML =
    data.ungroupedNew > 0
      ? `<span class="dot">${news}</span><span class="total">${data.ungrouped}</span>`
      : `<span class="total">${data.ungrouped}</span>`;

  const trashItems = await invoke('trash_list');
  $('c-trash').textContent = trashItems.length;

  const list = $('group-list');
  const pinnedList = $('pinned-list');
  const pinnedWrap = $('pinned-wrap');
  list.innerHTML = '';
  pinnedList.innerHTML = '';
  pinnedWrap.hidden = !meta.groups.some((g) => g.pinned);
  for (const g of meta.groups) {
    const b = document.createElement('button');
    b.className = 'side-item' + (currentGroup === g.name ? ' active' : '') + (g.pinned ? ' pinned' : '');
    b.dataset.group = g.name;
    b.draggable = true;
    const cover = g.cover
      ? `<img class="g-cover" src="${convertFileSrc(g.cover, 'thumb')}" alt="" loading="lazy" onerror="this.remove()">`
      : icon('folder-plus', 14);
    b.innerHTML = `<span class="g-thumb">${cover}</span><span class="g-name">${escapeHtml(g.name)}</span><span class="g-count">${g.count}</span>`;
    b.addEventListener('click', () => selectGroup(g.name));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openGroupMenu(g.name, e.clientX, e.clientY);
    });
    b.addEventListener('dragstart', (e) => {
      dragGroup = g.name;
      b.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', g.name);
    });
    b.addEventListener('dragend', () => {
      dragGroup = null;
      cleanGroupDropMarks();
    });
    b.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragGroup) {
        e.dataTransfer.dropEffect = 'move';
        const r = b.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        b.classList.toggle('drop-after', after);
        b.classList.toggle('drop-before', !after);
        return;
      }
      e.dataTransfer.dropEffect = 'copy';
      b.classList.add('drop-target');
    });
    b.addEventListener('dragleave', () => {
      b.classList.remove('drop-target', 'drop-before', 'drop-after');
    });
    b.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (dragGroup) {
        const after = b.classList.contains('drop-after');
        const from = dragGroup;
        dragGroup = null;
        cleanGroupDropMarks();
        await reorderGroup(from, g.name, after);
        return;
      }
      b.classList.remove('drop-target');
      const shas = readDragShas(e);
      if (!shas.length) return;
      await invoke('add_to_group', { shas, group: g.name });
      clearSelection();
      await Promise.all([refresh(), loadGroups()]);
      toast(`已把 ${shas.length} 张加入「${g.name}」`);
    });
    (g.pinned ? pinnedList : list).appendChild(b);
  }

  if (editing) renderEditChips();
}

function cleanGroupDropMarks() {
  document
    .querySelectorAll('#group-list .drop-before, #group-list .drop-after, #group-list .drop-target, #group-list .dragging')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-target', 'dragging'));
}

async function reorderGroup(from, to, after) {
  if (!from || !to || from === to) return;
  const order = groupMeta.map((g) => g.name).filter((n) => n !== from);
  const at = order.indexOf(to);
  if (at < 0) return;
  order.splice(after ? at + 1 : at, 0, from);
  try {
    await invoke('set_group_order', { order });
    await loadGroups();
  } catch (err) {
    toast('调整顺序失败：' + err);
  }
}

$('group-add').addEventListener('click', async (e) => {
  e.stopPropagation();
  const name = await promptDialog('新建分组', '');
  const n = (name || '').trim();
  if (!n) return;
  try {
    await invoke('create_group', { name: n });
    logAction(`已新建分组「${n}」`);
    await loadGroups();
    await selectGroup(n);
  } catch (err) {
    toast('新建失败：' + err);
  }
});

async function selectGroup(name) {
  currentGroup = name;
  listLimit = 3000;
  exitSelectionMode();
  clearSelection();
  document.querySelectorAll('.side-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.group === name);
  });
  if (name === '__trash__') {
    if (selectionMode) {
      selectModePinned = false;
      selectionMode = false;
      $('select-mode').classList.remove('active');
      paintSelectMode();
    }
    clearSelection();
    $('select-mode').hidden = true;
  } else {
    $('select-mode').hidden = false;
    $('empty-trash').hidden = true;
    $('trashbar').hidden = true;
  }
  await refresh();
  if (name === '__none__') {
    await invoke('mark_ungrouped_seen');
    await loadGroups();
  }
}

function openGroupMenu(name, x, y) {
  menuGroup = name;
  const m = $('gmenu');
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - 210) + 'px';
  m.style.top = Math.min(y, window.innerHeight - 140) + 'px';
}

function closeGroupMenu() {
  $('gmenu').hidden = true;
  menuGroup = null;
}

/* ---------- 卡片右键菜单 ---------- */

const CARD_MENU_ITEMS = [
  { act: 'edit', label: '编辑…', icon: 'pencil', key: 'Enter' },
  { act: 'copyimg', label: '复制图片', icon: 'copy', key: '单击' },
  { act: 'copyfile', label: '复制文件', icon: 'file' },
  { act: 'copypath', label: '复制路径', icon: 'link' },
  { sep: true },
  { act: 'star', label: '收藏', icon: 'star', key: 'S' },
  { sep: true },
  { act: 'addtag', label: '加入标签…', icon: 'tag' },
  { act: 'addgroup', label: '加入分组…', icon: 'folder-plus' },
  { sep: true },
  { act: 'trash', label: '移到回收站', icon: 'trash', key: 'dd', danger: true },
];
// 多选时只留批量项（单图专属的藏起来）
const CARD_MENU_BATCH_HIDE = new Set(['edit', 'copyimg', 'copypath']);

let cardMenuSha = null;
let cardMenuBatch = false;

function buildCardMenu() {
  const box = $('cardmenu');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  for (const it of CARD_MENU_ITEMS) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'cm-sep';
      box.appendChild(sep);
      continue;
    }
    const b = document.createElement('button');
    b.dataset.cm = it.act;
    b.className = 'cm-item' + (it.danger ? ' danger' : '');
    b.innerHTML =
      icon(it.icon, 15) +
      `<span class="cm-label">${it.label}</span>` +
      (it.key ? `<span class="cm-key">${it.key}</span>` : '');
    box.appendChild(b);
  }
}

function openCardMenu(a, x, y) {
  buildCardMenu();
  cardMenuSha = a.sha;
  cardMenuBatch = !!(selectionMode || selected.size > 0);
  const m = $('cardmenu');
  const inTrash = currentGroup === '__trash__';
  for (const b of m.querySelectorAll('[data-cm]')) {
    b.hidden = (cardMenuBatch && CARD_MENU_BATCH_HIDE.has(b.dataset.cm)) || (inTrash && b.dataset.cm === 'trash');
  }
  m.hidden = false;
  // 藏掉被隐藏项旁边的分隔线，别让菜单开头/结尾、或中间出现两条线
  const kids = [...m.children];
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i];
    if (!el.classList.contains('cm-sep')) continue;
    let prev = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!kids[j].hidden) { prev = kids[j]; break; }
    }
    let next = null;
    for (let j = i + 1; j < kids.length; j++) {
      if (!kids[j].hidden) { next = kids[j]; break; }
    }
    const dead = !prev || !next || prev.classList.contains('cm-sep') || next.classList.contains('cm-sep');
    el.hidden = dead;
  }
  const w = m.offsetWidth || 220;
  const h = m.offsetHeight || 340;
  m.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
}

function closeCardMenu() {
  const m = $('cardmenu');
  if (m && !m.hidden) m.hidden = true;
  cardMenuSha = null;
}

async function cardMenuAction(act) {
  const sha = cardMenuSha;
  closeCardMenu();
  if (!sha) return;
  const item = (shownItems || []).find((x) => x.sha === sha) || { sha };
  const shas = cardMenuBatch && selected.size ? [...selected] : [sha];
  try {
    if (act === 'edit') {
      openEditor(item);
      return;
    }
    if (act === 'copyimg') {
      await copy(item);
      return;
    }
    if (act === 'copyfile') {
      if (shas.length > 1) {
        await invoke('copy_assets_files', { shas });
        toast(`已复制 ${shas.length} 个原文件`);
        logAction(`已复制 ${shas.length} 个原文件`);
      } else {
        await invoke('copy_asset_file', { sha });
        toast(`已复制原文件「${item.name || ''}」`);
        logAction(`已复制原文件「${item.name || ''}」`);
      }
      return;
    }
    if (act === 'copypath') {
      await navigator.clipboard.writeText(item.path || '');
      toast('路径已复制');
      return;
    }
    if (act === 'star') {
      await invoke('batch_star', { shas, on: true });
      logAction(`已收藏 ${shas.length} 张`);
      await Promise.all([refresh(), loadGroups(), showStats()]);
      return;
    }
    if (act === 'addtag' || act === 'addgroup') {
      const kind = act === 'addtag' ? 'tag' : 'group';
      openBatchPanel(kind, cardMenuBatch ? {} : { sha });
      return;
    }
    if (act === 'trash') {
      const ok = await confirmDialog(
        shas.length > 1 ? `删除选中的 ${shas.length} 张到回收站？` : `删除「${item.name || ''}」到回收站？`
      );
      if (!ok) return;
      await invoke('batch_delete', { shas });
      logAction(`已把 ${shas.length} 张移入回收站`);
      clearSelection();
      await Promise.all([refresh(), loadGroups(), showStats()]);
    }
  } catch (e) {
    toast('操作失败：' + e);
  }
}

async function groupAction(act) {
  const name = menuGroup;
  closeGroupMenu();
  if (!name) return;

  if (act === 'rename') {
    const nv = await promptDialog(`重命名分组「${name}」`, name);
    if (nv === null) return;
    const v = nv.trim();
    if (!v || v === name) return;
    await invoke('rename_group', { old: name, new: v });
    await Promise.all([refresh(), loadGroups()]);
    toast('已重命名');
    return;
  }


  if (act === 'cover') {
    openCoverPicker(name);
    return;
  }

  if (act === 'pin') {
    const pinned = groupMeta.filter((g) => g.pinned).map((g) => g.name);
    const on = !pinned.includes(name);
    const next = on ? [...pinned, name] : pinned.filter((n) => n !== name);
    try {
      await invoke('set_pinned_groups', { groups: next });
      await loadGroups();
      toast(on ? `已置顶「${name}」到图库` : `已取消置顶「${name}」`);
    } catch (err) {
      toast('置顶失败：' + err);
    }
    return;
  }

  if (act === 'clear') {
    const ok = await confirmDialog(`解散分组「${name}」？组里的表情会回到未分组，不会被删除。`);
    if (!ok) return;
    await invoke('remove_group', { name, deleteAssets: false });
    if (currentGroup === name) currentGroup = '__all__';
    await Promise.all([refresh(), loadGroups(), showStats()]);
    toast('已解散分组');
    return;
  }

  if (act === 'delete') {
    const ok = await confirmDialog(
      `删除分组「${name}」以及组里的所有表情？文件会移入 trash，索引里不再显示。`
    );
    if (!ok) return;
    const n = await invoke('remove_group', { name, deleteAssets: true });
    if (currentGroup === name) currentGroup = '__all__';
    await Promise.all([refresh(), loadGroups(), showStats()]);
    toast(`已删除 ${n} 张`);
  }
}

let coverPickSeq = 0;

async function openCoverPicker(name) {
  coverGroup = name;
  const meta = groupMeta.find((g) => g.name === name);
  $('cover-title').textContent = `换封面 · ${name}`;
  $('coverpick').hidden = false;
  const grid = $('cover-grid');
  grid.innerHTML = '<div class="picker-empty">加载中…</div>';
  const seq = ++coverPickSeq;
  try {
    const items = await invoke('list_assets', { q: '', group: name, limit: 500 });
    if (seq !== coverPickSeq) return;
    if (!items.length) {
      grid.innerHTML = '<div class="picker-empty">这个分组还没有图片</div>';
      return;
    }
    const cur = meta && meta.cover;
    grid.innerHTML = items
      .map(
        (a) =>
          `<button class="cover-item${a.sha === cur ? ' on' : ''}" data-sha="${a.sha}">` +
          `<img src="${convertFileSrc(a.sha, 'thumb')}" alt="" loading="lazy"></button>`
      )
      .join('');
  } catch (err) {
    if (seq === coverPickSeq) grid.innerHTML = `<div class="picker-empty">读取失败：${escapeHtml(String(err))}</div>`;
  }
}

function closeCoverPicker() {
  coverPickSeq++;
  $('coverpick').hidden = true;
  coverGroup = null;
  $('cover-grid').innerHTML = '';
}

async function applyGroupCover(sha) {
  const name = coverGroup;
  closeCoverPicker();
  if (!name) return;
  try {
    await invoke('set_group_cover', { group: name, sha });
    await loadGroups();
    toast(sha ? '封面已更新' : '已恢复默认封面');
  } catch (err) {
    toast('设置封面失败：' + err);
  }
}

$('cover-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.cover-item');
  if (b) applyGroupCover(b.dataset.sha);
});
$('cover-cancel').addEventListener('click', closeCoverPicker);
$('cover-reset').addEventListener('click', () => applyGroupCover(null));
$('coverpick').addEventListener('click', (e) => {
  if (e.target === $('coverpick')) closeCoverPicker();
});

/* ---------- 编辑 ---------- */

async function openEditor(a) {
  editing = a;
  $('e-name').value = a.name;
  editTags = new Set(a.tags || []);
  editGroups = new Set(a.groups || []);
  $('e-meta').textContent = `${a.width} × ${a.height} · ${fmtSize(a.bytes)}`;
  const src = a.source === 'clipboard' ? '来自剪贴板' : '来自文件夹';
  const when = (a.added_at || '').slice(0, 10);
  $('e-sub').textContent = `${a.ext.toUpperCase()} · ${fmtSize(a.bytes)} · ${when} · ${src}`;
  $('e-path').textContent = a.path || '';
  $('e-path').title = a.path || '';
  $('e-prev').src = convertFileSrc(a.path);

  $('editor').hidden = false;
  exitEditorNav();
  renderEditChips();
  $('e-name').focus();
  $('e-name').select();

  // 列表里的对象可能是刷新前的旧快照，打开后再取一次最新分组/标签
  try {
    const fresh = await invoke('get_asset', { sha: a.sha });
    if (!editing || editing.sha !== fresh.sha) return;
    editing = fresh;
    editTags = new Set(fresh.tags || []);
    editGroups = new Set(fresh.groups || []);
    renderEditChips();
  } catch (_) {}
}

async function reloadEditing() {
  if (!editing) return;
  try {
    const fresh = await invoke('get_asset', { sha: editing.sha });
    if (!editing || editing.sha !== fresh.sha) return;
    editing = fresh;
    editTags = new Set(fresh.tags || []);
    editGroups = new Set(fresh.groups || []);
    renderEditChips();
  } catch (_) {}
}

$('editor').addEventListener('mousedown', () => exitEditorNav());

function closeEditor() {
  closePop();
  closeBatchPanel();
  exitEditorNav();
  $('editor').hidden = true;
  editing = null;
}

async function saveEditor() {
  if (!editing) return;
  try {
    // 标签/分组在面板里点一下就写库了，这里只存名称，避免用旧快照把它们覆盖回去
    await invoke('update_asset', {
      sha: editing.sha,
      name: $('e-name').value.trim(),
    });
    closeEditor();
    await Promise.all([refresh(), loadGroups(), showStats()]);
    toast('已保存');
  } catch (e) {
    toast('保存失败：' + e);
  }
}

async function deleteEditing() {
  if (!editing) return;
  const ok = await confirmDialog(`删除「${editing.name}」？文件会移入库里的 trash 目录，不会真的删掉。`);
  if (!ok) return;
  try {
    await invoke('delete_asset', { sha: editing.sha });
    closeEditor();
    await Promise.all([refresh(), loadGroups(), showStats()]);
    toast('已移入回收站');
  } catch (e) {
    toast('删除失败：' + e);
  }
}

/* ---------- 标签管理（桌面） ---------- */

const TM_NEW = '\u0000new';
let tagRows = []; // [{ name, count }]
let tmQuery = '';
let filterReopen = false;
let tmEditing = null; // 行内正在改的标签名，新建时是 TM_NEW
let tmMergeFrom = null;

async function openTagManage() {
  try {
    await reloadTagRows();
  } catch (e) {
    toast('读标签失败：' + e);
    return;
  }
  tmQuery = '';
  tmEditing = null;
  $('tm-q').value = '';
  $('tagmanage').hidden = false;
  renderTagManage();
  $('tm-q').focus();
}

function closeTagManage() {
  $('tagmanage').hidden = true;
  tmEditing = null;
  if (filterReopen) {
    filterReopen = false;
    openFilterPanel(); // 回来重画候选，顺便拿新建/删掉的标签
  }
}

async function reloadTagRows() {
  tagRows = (await invoke('tag_stats')) || [];
  allTags = tagRows.map((t) => t.name);
  $('c-tags').textContent = String(allTags.length);
}

async function tmAfterChange(msg) {
  const ok = await Promise.all([reloadTagRows(), loadGroups()]).then(() => true).catch(() => false);
  renderTagManage();
  if (!ok) toast('标签列表刷新失败，请重开窗口');
  else if (msg) toast(msg);
}

function renderTagManage() {
  const q = tmQuery.trim().toLowerCase();
  const rows = tagRows.filter((t) => !q || t.name.toLowerCase().includes(q));
  const refs = tagRows.reduce((n, t) => n + (t.count || 0), 0);
  $('tm-count').textContent = `${tagRows.length} 个 · 共 ${refs} 次引用`;
  const showEmpty = rows.length === 0 && tmEditing !== TM_NEW;
  $('tm-empty').hidden = !showEmpty;
  $('tm-empty').textContent = tagRows.length ? '没有匹配的标签' : '还没有标签，点下面「新建标签」';

  let html = '';
  if (tmEditing === TM_NEW) {
    html += `<div class="tm-row editing">
      <input class="tm-in" id="tm-new-input" placeholder="新标签名，回车确认" autocomplete="off" spellcheck="false" />
      <span class="tm-acts on">
        <button class="tm-act ok" data-act="tm-save" title="保存">${icon('check', 15)}</button>
        <button class="tm-act" data-act="tm-cancel" title="取消">${icon('x', 15)}</button>
      </span>
    </div>`;
  }
  html += rows
    .map((t) => {
      if (tmEditing === t.name) {
        return `<div class="tm-row editing" data-tag="${escapeHtml(t.name)}">
          <input class="tm-in" data-edit="${escapeHtml(t.name)}" value="${escapeHtml(t.name)}" autocomplete="off" spellcheck="false" />
          <span class="tm-acts on">
            <button class="tm-act ok" data-act="tm-save" title="保存">${icon('check', 15)}</button>
            <button class="tm-act" data-act="tm-cancel" title="取消">${icon('x', 15)}</button>
          </span>
        </div>`;
      }
      return `<div class="tm-row" data-tag="${escapeHtml(t.name)}">
        <span class="tm-name">${escapeHtml(t.name)}</span>
        <span class="tm-n${t.count ? '' : ' zero'}">${t.count}</span>
        <span class="tm-acts">
          <button class="tm-act" data-act="tm-rename" title="重命名">${icon('pencil')}</button>
          <button class="tm-act" data-act="tm-merge" title="合并到…">${icon('merge')}</button>
          <button class="tm-act danger" data-act="tm-delete" title="删除">${icon('trash')}</button>
        </span>
      </div>`;
    })
    .join('');
  $('tm-list').innerHTML = html;
  const focus = tmEditing === TM_NEW ? $('tm-new-input') : document.querySelector('.tm-in[data-edit]');
  if (focus) {
    focus.focus();
    focus.select();
  }
}

async function tmCreate(rawName) {
  const name = String(rawName || '').trim();
  tmEditing = null;
  if (!name) return renderTagManage();
  try {
    const added = await invoke('create_tag', { name });
    await tmAfterChange(added ? `已新建「${name}」` : `「${name}」已存在`);
  } catch (e) {
    renderTagManage();
    toast('新建失败：' + e);
  }
}

async function tmRename(oldName, rawName) {
  const name = String(rawName || '').trim();
  tmEditing = null;
  if (!name || name === oldName) return renderTagManage();
  try {
    const exists = tagRows.some((t) => t.name.toLowerCase() === name.toLowerCase());
    const n = await invoke('rename_tag', { old: oldName, new: name });
    await tmAfterChange(exists ? `已合并到「${name}」，${n} 张受影响` : `已重命名为「${name}」`);
  } catch (e) {
    renderTagManage();
    toast('重命名失败：' + e);
  }
}

async function tmDelete(name) {
  const row = tagRows.find((t) => t.name === name);
  const ok = await confirmDialog(
    `删除标签「${name}」？会从 ${row ? row.count : 0} 张图片上移除这个标签，图片本身不删。`
  );
  if (!ok) return;
  try {
    const n = await invoke('delete_tag', { name });
    await tmAfterChange(`已删除「${name}」，${n} 张受影响`);
  } catch (e) {
    toast('删除失败：' + e);
  }
}

function openTagMerge(name) {
  const from = tagRows.find((t) => t.name === name);
  const targets = tagRows.filter((t) => t.name !== name);
  tmMergeFrom = name;
  $('tg-merge-title').textContent = `把「${name}」合并到…`;
  $('tg-merge-note').textContent = `合并后「${name}」会被删除，${from ? from.count : 0} 张图的这个标签会换成目标标签，不可撤销`;
  $('tg-merge-list').innerHTML = targets.length
    ? targets
        .map(
          (t) =>
            `<label class="tm-radio"><input type="radio" name="tm-merge" value="${escapeHtml(t.name)}" /><span class="tm-radio-name">${escapeHtml(t.name)}</span><span class="tm-n">${t.count}</span></label>`
        )
        .join('')
    : '<div class="tm-empty">没有其他标签可合并</div>';
  $('tg-merge-ok').disabled = true;
  $('tagmerge').hidden = false;
}

function closeTagMerge() {
  $('tagmerge').hidden = true;
  tmMergeFrom = null;
}

async function doTagMerge() {
  const sel = document.querySelector('input[name="tm-merge"]:checked');
  if (!sel || !tmMergeFrom) return;
  const from = tmMergeFrom;
  const to = sel.value;
  closeTagMerge();
  try {
    const n = await invoke('merge_tags', { from, to });
    await tmAfterChange(`已把「${from}」并入「${to}」，${n} 张受影响`);
  } catch (e) {
    toast('合并失败：' + e);
  }
}

/* ---------- 导入 ---------- */

async function pickFolder() {
  try {
    const p = await invoke('plugin:dialog|open', {
      options: { directory: true, multiple: false, title: '选择表情包文件夹' },
    });
    if (p) await doImport([p]);
  } catch (e) {
    toast('打开选择器失败：' + e);
  }
}

async function pickFiles() {
  try {
    const p = await invoke('plugin:dialog|open', {
      options: {
        directory: false,
        multiple: true,
        title: '选择表情图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      },
    });
    const paths = Array.isArray(p) ? p : p ? [p] : [];
    if (paths.length) await doImport(paths);
  } catch (e) {
    toast('打开选择器失败：' + e);
  }
}

async function doImport(paths) {
  setImporting(true);
  try {
    const s = await invoke('import_paths', { paths });
    if (s.added) logAction(`导入 ${s.added} 张`);
    toast(`新增 ${s.added} · 重复 ${s.duplicated} · 跳过 ${s.skipped} · 失败 ${s.errors}`);
    await Promise.all([refresh(), loadGroups(), showStats()]);
  } catch (e) {
    toast('导入失败：' + e);
  } finally {
    setImporting(false);
  }
}

/* ---------- 统计 ---------- */

async function showStats() {
  const s = await invoke('library_stats');
  $('stats').textContent = `${s.assets} 张 · ${fmtSize(s.bytes)} · ${s.root}`;
}

/* ---------- 事件 ---------- */

function syncClear() {
  $('q-clear').hidden = !qInput.value;
}

const refreshDebounced = debounce(() => refresh());
qInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    qInput.blur();
  }
});

qInput.addEventListener('input', () => {
  listLimit = 3000;
  syncClear();
  refreshDebounced();
});

$('q-clear').addEventListener('click', () => {
  qInput.value = '';
  syncClear();
  refresh('');
  qInput.focus();
});

$('dir').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const p = $('dir').value.trim();
  if (!p) return;
  $('dir').value = '';
  doImport([p]);
});

$('pick').addEventListener('click', pickFolder);
$('pick-files').addEventListener('click', pickFiles);

document.querySelectorAll('.side-item').forEach((el) => {
  if (!el.dataset.group) return; // 「标签管理」这类按钮不是分组
  el.addEventListener('click', () => selectGroup(el.dataset.group));
  el.addEventListener('dragover', (e) => {
    if (el.dataset.group === '__all__') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const shas = readDragShas(e);
    if (!shas.length) return;
    if (el.dataset.group === '__none__') {
      await invoke('clear_groups', { shas });
      toast(`已把 ${shas.length} 张移出分组`);
    } else {
      await invoke('add_to_group', { shas, group: el.dataset.group });
      toast(`已把 ${shas.length} 张加入「${el.dataset.group}」`);
    }
    clearSelection();
    await Promise.all([refresh(), loadGroups()]);
  });
});

$('e-open').addEventListener('click', async () => {
  if (!editing) return;
  try {
    await invoke('open_asset', { sha: editing.sha });
  } catch (e) {
    toast('打开失败：' + e);
  }
});

$('e-copy-file').addEventListener('click', async () => {
  if (!editing) return;
  try {
    if (copyDefault === 'file') {
      await invoke('copy_asset', { sha: editing.sha });
      toast('已复制为图片，去聊天窗口 Ctrl+V');
    } else {
      await invoke('copy_asset_file', { sha: editing.sha });
      toast('已复制文件，去聊天窗口 Ctrl+V 试试（动图应保持动画）');
    }
  } catch (e) {
    toast('复制失败：' + e);
  }
});

$('f-tags-manage').addEventListener('click', () => {
  // 筛选面板 z 75 在标签管理之上，先收起它，关标签管理时再放回来
  filterReopen = !$('filter-panel').hidden;
  if (filterReopen) closeFilterPanel();
  openTagManage();
});

$('e-save').addEventListener('click', saveEditor);
$('e-cancel').addEventListener('click', closeEditor);
$('e-del').addEventListener('click', deleteEditing);
$('e-tags-btn').addEventListener('click', () => {
  if (editing) openBatchPanel('tag', { sha: editing.sha, name: editing.name, onClose: reloadEditing });
});
$('e-groups-btn').addEventListener('click', () => {
  if (editing) openBatchPanel('group', { sha: editing.sha, name: editing.name, onClose: reloadEditing });
});
$('e-copy-path').addEventListener('click', async () => {
  if (!editing) return;
  try {
    await navigator.clipboard.writeText(editing.path);
    toast('路径已复制');
  } catch (_) {
    toast('复制失败');
  }
});
$('editor').addEventListener('click', (e) => {
  if (e.target === $('editor')) closeEditor();
});

$('confirm-ok').addEventListener('click', () => closeConfirm(true));
$('confirm-cancel').addEventListener('click', () => closeConfirm(false));

$('prompt-ok').addEventListener('click', () => closePrompt($('prompt-input').value));
$('prompt-cancel').addEventListener('click', () => closePrompt(null));
$('prompt-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') closePrompt($('prompt-input').value);
  if (e.key === 'Escape') closePrompt(null);
});

$('tag-manage-open').addEventListener('click', openTagManage);
$('tm-close').addEventListener('click', closeTagManage);
$('tm-done').addEventListener('click', closeTagManage);
$('tagmanage').addEventListener('click', (e) => {
  if (e.target === $('tagmanage')) closeTagManage();
});
$('tm-q').addEventListener('input', () => {
  tmQuery = $('tm-q').value;
  renderTagManage();
});
$('tm-new').addEventListener('click', () => {
  tmEditing = TM_NEW;
  renderTagManage();
});
$('tm-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.tm-row');
  const name = row && row.dataset.tag;
  switch (btn.dataset.act) {
    case 'tm-rename':
      tmEditing = name;
      renderTagManage();
      break;
    case 'tm-save': {
      const inp = row && row.querySelector('.tm-in');
      if (!inp) break;
      if (tmEditing === TM_NEW) tmCreate(inp.value);
      else tmRename(name, inp.value);
      break;
    }
    case 'tm-cancel':
      tmEditing = null;
      renderTagManage();
      break;
    case 'tm-merge':
      openTagMerge(name);
      break;
    case 'tm-delete':
      await tmDelete(name);
      break;
  }
});
$('tm-list').addEventListener('keydown', (e) => {
  const inp = e.target.closest && e.target.closest('.tm-in');
  if (!inp) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    if (inp.id === 'tm-new-input') tmCreate(inp.value);
    else tmRename(inp.dataset.edit, inp.value);
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    tmEditing = null;
    renderTagManage();
  }
});
$('tg-merge-list').addEventListener('change', (e) => {
  if (e.target.name === 'tm-merge') $('tg-merge-ok').disabled = false;
});
$('tg-merge-cancel').addEventListener('click', closeTagMerge);
$('tg-merge-ok').addEventListener('click', doTagMerge);
$('tagmerge').addEventListener('click', (e) => {
  if (e.target === $('tagmerge')) closeTagMerge();
});

$('gmenu').addEventListener('click', (e) => {
  const act = e.target.dataset && e.target.dataset.act;
  if (act) groupAction(act);
});

$('cardmenu').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cm]');
  if (btn) cardMenuAction(btn.dataset.cm);
});

document.addEventListener('click', (e) => {
  if (popEl && !popEl.contains(e.target)) closePop();
  if (!$('gmenu').hidden && !$('gmenu').contains(e.target)) closeGroupMenu();
  if (!$('cardmenu').hidden && !$('cardmenu').contains(e.target)) closeCardMenu();
});

document.addEventListener('keydown', (e) => {
  if ($('settings') && !$('settings').hidden) return;
  if (!$('tagmanage').hidden || !$('tagmerge').hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!$('tagmerge').hidden) closeTagMerge();
      else if (tmEditing) {
        tmEditing = null;
        renderTagManage();
      } else closeTagManage();
    }
    return;
  }
  if (filterPanelOpen()) return;
  const typing = e.target && e.target.tagName === 'INPUT';
  if (!typing && (e.key === 's' || e.key === 'S') && selected.size > 0) {
    e.preventDefault();
    const shas = [...selected];
    const allStarred = shas.every((sha) => {
      const a = shownItems.find((x) => x.sha === sha);
      return a && a.starred;
    });
    invoke('batch_star', { shas, on: !allStarred }).then(async () => {
      toast(allStarred ? '已取消收藏' : '已收藏');
      await Promise.all([refresh(), loadGroups()]);
    });
    return;
  }
  if (batchPanel && e.key === 'Escape') {
    closeBatchPanel();
    return;
  }
  if (!typing && e.key === 'Escape' && (selected.size > 0 || selectionMode)) {
    clearSelection();
    exitSelectionMode();
    return;
  }
  if (e.key === 'Escape' && popEl) return closePop();
  if (!$('cardmenu').hidden && e.key === 'Escape') return closeCardMenu();
  if (!$('gmenu').hidden && e.key === 'Escape') return closeGroupMenu();
  if (!$('prompt').hidden) {
    if (e.key === 'Escape') closePrompt(null);
    return;
  }
  if (!$('confirm').hidden) {
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'n') closeConfirm(false);
    if (k === 'enter' || k === 'y') closeConfirm(true);
    return;
  }
  if (!$('editor').hidden) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      saveEditor();
    }
  }
});

// 导入进度：直接把路径输入框替换成进度条
function setImporting(on) {
  const bar = document.querySelector('.toolbar');
  if (bar) bar.classList.toggle('importing', on);
  $('import-bar').hidden = !on;
  if (!on) {
    $('import-fill').style.width = '0%';
    $('import-text').textContent = '';
  }
}

window.__TAURI__.event.listen('import-progress', (e) => {
  const { done, total } = e.payload || {};
  if (!total) return;
  $('import-fill').style.width = `${Math.round((done / total) * 100)}%`;
  $('import-text').textContent = `导入中 ${done} / ${total}`;
});

// 剪贴板捕获入库后，界面实时更新
window.__TAURI__.event.listen('library-changed', async () => {
  await Promise.all([refresh(), loadGroups(), showStats()]);
});

// 置顶窗口
let pinned = false;
$('pin').addEventListener('click', async () => {
  pinned = !pinned;
  try {
    await invoke('set_pinned', { pinned });
    $('pin').classList.toggle('active', pinned);
  } catch (e) {
    pinned = !pinned;
    toast('置顶失败：' + e);
  }
});

/* ---------- 批量操作 ---------- */

$('batchbar').addEventListener('click', async (e) => {
  e.stopPropagation();
  const act = e.target.dataset && e.target.dataset.act;
  if (!act) return;
  const shas = [...selected];

  if (act === 'clear') {
    clearSelection();
    return;
  }

  if (act === 'all') {
    selected = new Set(shownItems.map((x) => x.sha));
    paintSelection();
    return;
  }

  if (act === 'group') {
    openBatchPanel('group');
    return;
  }

  if (act === 'tag') {
    openBatchPanel('tag');
    return;
  }

  if (act === 'leave') {
    if (currentGroup === '__all__' || currentGroup === '__none__') return;
    await invoke('batch_ungroup', { shas, group: currentGroup });
    logAction(`已把 ${shas.length} 张移出「${currentGroup}」`);
    clearSelection();
    await Promise.all([refresh(), loadGroups()]);
    return;
  }

  if (act === 'copyfiles') {
    try {
      const n = await invoke('copy_assets_files', { shas });
      logAction(`已复制 ${n} 个文件`);
      toast(`已复制 ${n} 个文件，去聊天窗口 Ctrl+V`);
    } catch (err) {
      toast('复制失败：' + err);
    }
    return;
  }

  if (act === 'star') {
    const allStarred =
      shas.length > 0 &&
      shas.every((sha) => {
        const a = shownItems.find((x) => x.sha === sha);
        return a && a.starred;
      });
    await invoke('batch_star', { shas, on: !allStarred });
    logAction(allStarred ? `已取消收藏 ${shas.length} 张` : `已收藏 ${shas.length} 张`);
    toast(allStarred ? '已取消收藏' : '已收藏');
  }

  if (act === 'delete') {
    if (!(await confirmDialog(`删除选中的 ${shas.length} 张？会移入回收站，可以恢复。`))) return;
    await invoke('batch_delete', { shas });
    logAction(`已删除 ${shas.length} 张（回收站）`);
    toast('已移入回收站');
  }

  clearSelection();
  await Promise.all([refresh(), loadGroups(), showStats()]);
});

/* ---------- 设置 ---------- */

async function renderBlacklist() {
  const box = $('p-blacklist');
  if (!box) return;
  let observed = [];
  try {
    observed = (await invoke('clipboard_sources')).map((x) => x.name);
  } catch (_) {}
  const options = [...new Set([...observed, ...clipboardBlacklist, 'Snipaste.exe', 'QQ.exe', 'WeChat.exe', 'Telegram.exe', 'Discord.exe'])];
  const set = new Set(clipboardBlacklist);
  renderPickerIn(box, options, set, '输入进程名，回车加入', {
    allowNew: true,
    onChange: (name, added) => {
      clipboardBlacklist = [...set];
      saveSettings({ clipboardBlacklist });
    },
  });
}

function enhanceSelects() {
  document.querySelectorAll('#settings select.select').forEach((sel) => {
    if (!sel._sel) {
      const wrap = document.createElement('div');
      wrap.className = 'sel';
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      sel.classList.add('sel-native');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sel-btn';
      const pop = document.createElement('div');
      pop.className = 'sel-pop';
      pop.hidden = true;
      wrap.append(btn, pop);

      const paint = () => {
        const opt = sel.selectedOptions[0];
        btn.textContent = opt ? opt.textContent : '';
      };
      const close = () => { pop.hidden = true; };
      const fill = () => {
        pop.innerHTML = '';
        [...sel.options].forEach((o) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'sel-row' + (o.value === sel.value ? ' on' : '');
          row.textContent = o.textContent;
          row.addEventListener('click', () => {
            sel.value = o.value;
            paint();
            close();
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          });
          pop.appendChild(row);
        });
      };

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!pop.hidden) return close();
        fill();
        pop.hidden = false;
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
      });
      document.addEventListener('mousedown', (e) => {
        if (!wrap.contains(e.target)) close();
      });
      sel.addEventListener('change', paint);

      sel._sel = { paint, close };
    }
    sel._sel.paint();
  });
}

async function openSettings() {
  const s = await invoke('get_settings');
  await loadThemes();
  fillThemeOptions();
  $('set-root').textContent = s.root;
  $('set-clip').checked = s.clipboardEnabled;
  $('set-auto').checked = s.autostart;
  $('set-theme').value = theme;
  $('set-glyph').value = starStyle;
  $('set-grid-size').value = gridSize;
  $('set-virtualize').checked = virtualize;
  $('set-scrolloff').value = scrolloff;
  $('set-cursor-speed').value = cursorSpeed;
  $('set-flash-color').value = flashColor;
  $('set-flash-dur').value = flashDuration;
  renderCursorColors();
  $('win-w').value = winW;
  $('win-h').value = winH;
  $('panel-w').value = panelW;
  $('panel-h').value = panelH;
  $('panel-pos-x').value = panelX;
  $('panel-pos-y').value = panelY;
  $('set-panel-sort').value = panelSort;
  $('set-recent-limit').value = recentLimit;

  const isCustomView = startView.startsWith('group:');
  $('set-start-view').value = isCustomView ? 'custom' : startView;
  $('set-start-view-name').value = isCustomView ? startView.slice(6) : '';
  $('set-start-view-name').hidden = !isCustomView;
  $('set-copy-default').value = copyDefault;
  $('set-start-hidden').value = startHidden ? 'hide' : 'show';
  $('e-copy-file').textContent = copyDefault === 'file' ? '复制静态图片' : '复制文件';
  $('set-star-color').value = starColor;
  $('set-hover-delay').value = hoverDelay;
  $('set-delete-mode').value = deleteMode;
  $('ghost-x').value = ghostX;
  $('ghost-y').value = ghostY;
  $('set-version').textContent = `StickerBox v${s.version}`;
  $('hotkey-value').textContent = s.hotkey || '未设置';
  $('clip-hotkey-value').textContent = s.clipHotkey || '未设置';
  renderKeymapEditor();
  applySettingsTab('general');
  renderBlacklist();
  enhanceSelects();
  $('settings').hidden = false;
  const box = $('settings').querySelector('.modal');
  if (box) box.scrollTop = 0;
}

$('settings-btn').addEventListener('click', openSettings);
$('set-close').addEventListener('click', () => ($('settings').hidden = true));
$('settings').addEventListener('click', (e) => {
  if (e.target === $('settings')) $('settings').hidden = true;
});
$('set-open').addEventListener('click', () => invoke('open_library_folder'));

$('hotkey-edit').addEventListener('click', () => startHotkeyCapture('panel'));
$('help-close')?.addEventListener('click', closeHelp);
$('hotkey-clear').addEventListener('click', () => clearHotkey('panel'));
$('clip-hotkey-edit').addEventListener('click', () => startHotkeyCapture('clip'));
$('clip-hotkey-clear').addEventListener('click', () => clearHotkey('clip'));

$('set-export').addEventListener('click', async () => {
  try {
    const p = await invoke('export_settings');
    logAction('设置已导出');
    toast('已导出到 ' + p);
  } catch (err) {
    toast('导出失败：' + err);
  }
});

$('set-import').addEventListener('click', () => $('set-import-file').click());
$('set-import-file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const text = await f.text();
    await invoke('import_settings', { json: text });
    await syncSettings();
    await openSettings();
    toast('设置已导入');
  } catch (err) {
    toast('导入失败：' + err);
  }
});

$('set-clip').addEventListener('change', async (e) => {
  await invoke('set_clipboard_enabled', { enabled: e.target.checked });
  toast(e.target.checked ? '剪贴板捕获已开启' : '剪贴板捕获已暂停');
});

$('set-auto').addEventListener('change', async (e) => {
  try {
    await invoke('set_autostart', { enabled: e.target.checked });
    toast(e.target.checked ? '已设置开机自启' : '已取消开机自启');
  } catch (err) {
    e.target.checked = !e.target.checked;
    toast('设置失败：' + err);
  }
});

function saveGhostOffset() {
  ghostX = Number($('ghost-x').value) || 0;
  ghostY = Number($('ghost-y').value) || 0;
  localStorage.setItem('stickerbox-ghost-x', String(ghostX));
  localStorage.setItem('stickerbox-ghost-y', String(ghostY));
  saveSettings({ ghostX, ghostY });
}
$('ghost-x').addEventListener('change', saveGhostOffset);
$('ghost-y').addEventListener('change', saveGhostOffset);

// 彻底关掉浏览器原生拖拽（图片、文字、按钮都不再触发），只走指针拖拽
document.addEventListener('dragstart', (e) => e.preventDefault(), true);

$('set-delete-mode').addEventListener('change', (e) => {
  deleteMode = e.target.value;
  localStorage.setItem('stickerbox-delete-mode', deleteMode);
  saveSettings({ deleteMode });
});

$('set-recent-limit').addEventListener('change', (e) => {
  recentLimit = Math.max(10, Math.min(1000, Number(e.target.value) || 60));
  e.target.value = recentLimit;
  saveSettings({ recentLimit });
  toast('最近使用上限已更新，重启面板生效');
});

$('set-panel-sort').addEventListener('change', (e) => {
  panelSort = e.target.value;
  saveSettings({ panelSort });
});

$('panel-pos-apply').addEventListener('click', async () => {
  try {
    const r = await invoke('set_panel_position', {
      x: Number($('panel-pos-x').value) || 0,
      y: Number($('panel-pos-y').value) || 0,
    });
    panelX = r.x;
    panelY = r.y;
    $('panel-pos-x').value = r.x;
    $('panel-pos-y').value = r.y;
    saveSettings({ panelX: r.x, panelY: r.y });
    toast(`快贴位置已设为 ${r.x}, ${r.y}`);
  } catch (err) {
    toast('调整失败：' + err);
  }
});

// 设置分页
const SETTING_TAB_BY_LABEL = {
  主题: 'appearance',
  网格大小: 'appearance',
  收藏标记: 'appearance',
  标记颜色: 'appearance',
  光标环速度: 'appearance',
  光标环配色: 'appearance',
  滚动留白: 'appearance',
  表情库位置: 'data',
  彻底删除时: 'data',
  设置备份: 'data',
};

function applySettingsTab(name) {
  document.querySelectorAll('.set-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  const rows = document.querySelectorAll('#tab-general .set-row');
  rows.forEach((row) => {
    const label = row.querySelector('.set-label');
    const key = label ? label.textContent.trim() : '';
    const group = SETTING_TAB_BY_LABEL[key] || 'general';
    row.hidden = name !== group;
  });
  const ver = $('set-version');
  if (ver) ver.hidden = name !== 'data';
  $('tab-general').hidden = name === 'keys';
  $('tab-keys').hidden = name !== 'keys';
  const box = $('settings').querySelector('.modal');
  if (box) box.scrollTop = 0;
}

document.querySelectorAll('.set-tab').forEach((tab) => {
  tab.addEventListener('click', () => applySettingsTab(tab.dataset.tab));
});

$('filter-btn').addEventListener('click', () => (filterPanelOpen() ? closeFilterPanel() : openFilterPanel()));
$('f-apply').addEventListener('click', applyFilters);
$('f-reset').addEventListener('click', clearFilters);
$('fp-close').addEventListener('click', closeFilterPanel);
$('f-exts').addEventListener('click', (e) => {
  const chip = e.target.closest('.fp-chip');
  if (!chip) return;
  chip.classList.toggle('on');
  updateFilterBadge();
});
$('f-presets').addEventListener('click', (e) => {
  const chip = e.target.closest('.fp-chip');
  if (!chip) return;
  chip.classList.toggle('on');
  updateFilterBadge();
});
['f-min-mb', 'f-max-mb', 'f-min-w', 'f-max-w', 'f-min-h', 'f-max-h', 'f-from', 'f-to'].forEach((id) => {
  $(id).addEventListener('input', updateFilterBadge);
});

document.addEventListener('mousedown', (e) => {
  if (!filterPanelOpen()) return;
  if ($('filter-panel').contains(e.target) || $('filter-btn').contains(e.target)) return;
  closeFilterPanel();
});

$('set-start-view').addEventListener('change', (e) => {
  const v = e.target.value;
  $('set-start-view-name').hidden = v !== 'custom';
  if (v === 'custom') {
    $('set-start-view-name').focus();
    return;
  }
  startView = v;
  saveSettings({ startView });
});

$('set-start-view-name').addEventListener('change', (e) => {
  const name = e.target.value.trim();
  startView = name ? `group:${name}` : 'all';
  saveSettings({ startView });
});

async function applyWindowSize(label, w, h, keyW, keyH) {
  try {
    const r = await invoke('set_window_size', { label, width: w, height: h });
    saveSettings({ [keyW]: r.width, [keyH]: r.height });
    return r;
  } catch (err) {
    toast('调整失败：' + err);
    return null;
  }
}

$('win-apply').addEventListener('click', async () => {
  const r = await applyWindowSize('main', Number($('win-w').value) || 1040, Number($('win-h').value) || 700, 'windowWidth', 'windowHeight');
  if (r) {
    winW = r.width;
    winH = r.height;
    $('win-w').value = r.width;
    $('win-h').value = r.height;
    toast(`主界面已调整为 ${r.width} × ${r.height}`);
  }
});

$('panel-apply').addEventListener('click', async () => {
  const r = await applyWindowSize('panel', Number($('panel-w').value) || 720, Number($('panel-h').value) || 520, 'panelWidth', 'panelHeight');
  if (r) {
    panelW = r.width;
    panelH = r.height;
    $('panel-w').value = r.width;
    $('panel-h').value = r.height;
    toast(`快贴面板已调整为 ${r.width} × ${r.height}`);
  }
});

$('set-flash-color').addEventListener('input', (e) => {
  flashColor = e.target.value;
  applyFlashVars();
});
$('set-flash-color').addEventListener('change', (e) => {
  saveSettings({ flashColor: e.target.value });
});
$('set-flash-dur').addEventListener('change', (e) => {
  flashDuration = Math.max(0, Math.min(2000, Number(e.target.value) || 0));
  e.target.value = flashDuration;
  applyFlashVars();
  saveSettings({ flashDuration });
});

$('set-cursor-speed').addEventListener('change', (e) => {
  cursorSpeed = Math.max(0.4, Math.min(10, Number(e.target.value) || 2.4));
  e.target.value = cursorSpeed;
  applyCursorRing();
  saveSettings({ cursorSpeed });
});

$('set-scrolloff').addEventListener('change', (e) => {
  scrolloff = Math.max(0, Math.min(10, Number(e.target.value) || 0));
  e.target.value = scrolloff;
  saveSettings({ scrolloff });
});

$('set-virtualize').addEventListener('change', async (e) => {
  virtualize = e.target.checked;
  saveSettings({ virtualize });
  await refresh();
  toast(virtualize ? '已开启虚拟滚动' : '已关闭虚拟滚动');
});

$('set-grid-size').addEventListener('change', (e) => {
  gridSize = e.target.value;
  localStorage.setItem('stickerbox-grid-size', gridSize);
  applyGridSize();
  saveSettings({ gridSize });
});

$('set-copy-default').addEventListener('change', (e) => {
  copyDefault = e.target.value;
  localStorage.setItem('stickerbox-copy-default', copyDefault);
  $('e-copy-file').textContent = copyDefault === 'file' ? '复制静态图片' : '复制文件';
  saveSettings({ copyDefault });
});

$('set-start-hidden').addEventListener('change', (e) => {
  startHidden = e.target.value === 'hide';
  saveSettings({ startHidden });
});

$('set-glyph').addEventListener('change', async (e) => {
  starStyle = e.target.value;
  localStorage.setItem('stickerbox-star-style', starStyle);
  saveSettings({ starStyle });
  await refresh();
});

$('set-star-color').addEventListener('input', (e) => {
  starColor = e.target.value;
  localStorage.setItem('stickerbox-star-color', starColor);
  applyStarColor();
});
$('set-star-color').addEventListener('change', (e) => {
  saveSettings({ starColor: e.target.value });
});

$('set-hover-delay').addEventListener('change', (e) => {
  hoverDelay = Math.max(0, Math.min(2000, Number(e.target.value) || 0));
  e.target.value = hoverDelay;
  localStorage.setItem('stickerbox-hover-delay', String(hoverDelay));
  saveSettings({ hoverDelay });
});

$('set-theme').addEventListener('change', (e) => {
  theme = e.target.value;
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
  saveSettings({ theme });
});

$('empty-trash').addEventListener('click', async () => {
  if (!(await confirmDialog('清空回收站？里面的表情将被彻底删除。'))) return;
  const n = await invoke('trash_purge', { permanent: deleteMode === 'permanent' });
  await Promise.all([refresh(), loadGroups(), showStats()]);
  toast(`已清空 ${n} 项`);
});

// Ctrl+A：捕获阶段处理，避免被 WebView 的原生全选抢走
window.addEventListener(
  'keydown',
  (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
    if (currentGroup === '__trash__') {
      if (!trashItems.length) return;
      e.preventDefault();
      trashSelected = new Set(trashItems.map((i) => i.sha));
      document.querySelectorAll('.trash-card').forEach((el, i) => {
        const it = trashItems[i];
        if (it) el.classList.toggle('selected', trashSelected.has(it.sha));
      });
      updateTrashBar();
      return;
    }
    if (!shownItems.length) return;
    e.preventDefault();
    selected = new Set(shownItems.map((a) => a.sha));
    paintSelection();
  },
  true
);

$('load-more').addEventListener('click', async () => {
  listLimit += 1000;
  await refresh();
});

let clipEnabled = true;

function paintClipButton() {
  const btn = $('clip-toggle');
  if (!btn) return;
  btn.classList.toggle('on', clipEnabled);
  $('clip-text').textContent = clipEnabled ? '剪贴板捕获：开' : '剪贴板捕获：关';
}

async function syncClipButton() {
  try {
    const s = await invoke('get_settings');
    clipEnabled = !!s.clipboardEnabled;
  } catch (_) {}
  paintClipButton();
}

$('clip-toggle').addEventListener('click', async () => {
  const next = !clipEnabled;
  try {
    await invoke('set_clipboard_enabled', { enabled: next });
    clipEnabled = next;
    paintClipButton();
    toast(next ? '剪贴板捕获已开启' : '剪贴板捕获已暂停');
  } catch (e) {
    toast('切换失败：' + e);
  }
});

window.__TAURI__.event.listen('clipboard-toggled', (e) => {
  const on = e.payload && e.payload.enabled;
  clipEnabled = !!on;
  paintClipButton();
  const box = $('set-clip');
  if (box) box.checked = !!on;
  toast(on ? '剪贴板捕获已开启（热键）' : '剪贴板捕获已暂停（热键）');
});

// 拖拽导入（从资源管理器拖进窗口）
window.__TAURI__.event.listen('tauri://drag-drop', (e) => {
  const paths = (e.payload && e.payload.paths) || [];
  if (paths.length) doImport(paths);
});


/* ---------- 键盘导航 ---------- */

const NAMED_KEYS = new Set([
  'escape', 'enter', 'tab', 'space', 'backspace', 'delete', 'insert', 'home', 'end',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pagedown', 'pageup',
]);

const KEY_LABELS = {
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  space: 'Space',
  backspace: '⌫',
  delete: 'Del',
  home: 'Home',
  end: 'End',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pagedown: 'PgDn',
  pageup: 'PgUp',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  mouse1: '鼠标左键',
  mouse2: '鼠标中键',
  mouse3: '鼠标右键',
  mouse4: '鼠标4',
  mouse5: '鼠标5',
  mouse6: '鼠标6',
  mouse7: '鼠标7',
  mouse8: '鼠标8',
  mouse9: '鼠标9',
};

function mouseName(button) {
  return `mouse${button + 1}`;
}

function mouseCombo(e, button) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(mouseName(button));
  return parts.join('+');
}

function keyLabel(raw) {
  if (!raw) return '';
  return raw
    .split('+')
    .map((part) => KEY_LABELS[part] || part)
    .join('+');
}

function isSequenceKey(raw) {
  if (!raw || raw.includes('+') || raw.startsWith('mouse-')) return false;
  if (NAMED_KEYS.has(raw.toLowerCase())) return false;
  return raw.length > 1 && /^[A-Za-z0-9]+$/.test(raw);
}

function isCountableAction(action) {
  return ['up', 'down', 'left', 'right', 'pageDown', 'pageUp', 'first', 'last'].includes(action);
}

function conflictsFor(binding, action) {
  const out = [];
  const isSeq = isSequenceKey(binding);
  for (const [other, list] of Object.entries(mergedKeymap())) {
    if (other === action) continue;
    for (const k of list || []) {
      const nk = normalizeKey(k);
      if (nk === binding) {
        out.push(other);
        break;
      }
      if (isSeq && isSequenceKey(nk) && (nk.startsWith(binding) || binding.startsWith(nk))) {
        out.push(other);
        break;
      }
    }
  }
  return [...new Set(out)];
}

const ACTION_META = {
  up: { label: '向上', group: '移动' },
  down: { label: '向下', group: '移动' },
  left: { label: '向左', group: '移动' },
  right: { label: '向右', group: '移动' },
  pageUp: { label: '向上翻页', group: '移动' },
  pageDown: { label: '向下翻页', group: '移动' },
  first: { label: '回到首行', group: '移动' },
  last: { label: '去往末行', group: '移动' },
  toggle: { label: '选中/取消', group: '选择' },
  anchor: { label: '锚点区间', group: '选择' },
  selectAll: { label: '全选', group: '选择' },
  escape: { label: '退出/清空', group: '选择' },
  copy: { label: '复制', group: '操作' },
  edit: { label: '编辑信息', group: '操作' },
  del: { label: '删除到回收站', group: '操作' },
  info: { label: '查看信息', group: '操作' },
  filter: { label: '聚焦筛选', group: '导航' },
  clearFilter: { label: '清空筛选', group: '导航' },
  groupNext: { label: '下一个分组', group: '导航' },
  groupPrev: { label: '上一个分组', group: '导航' },
  newGroup: { label: '新建分组', group: '导航' },
  help: { label: '快捷键速查', group: '帮助' },
  groupAdd: { label: '加入分组', group: '批量' },
  groupRemove: { label: '移出当前分组', group: '批量' },
  tagAdd: { label: '添加标签', group: '批量' },
  star: { label: '收藏/取消收藏', group: '批量' },
  yank: { label: '复制并记住（可粘贴）', group: '批量' },
  paste: { label: '粘贴到光标后', group: '批量' },
  restore: { label: '恢复（回收站）', group: '回收站' },
  quitSelect: { label: '退出多选', group: '选择' },
  filters: { label: '筛选面板', group: '导航' },
  click: { label: '单击（默认复制）', group: '鼠标' },
};

const DEFAULT_KEYMAP = {
  up: ['k', 'arrowup'],
  down: ['j', 'arrowdown'],
  left: ['h', 'arrowleft'],
  right: ['l', 'arrowright'],
  pageDown: ['pagedown', 'ctrl+d'],
  pageUp: ['pageup', 'ctrl+u'],
  first: ['gg'],
  last: ['G'],
  toggle: ['x', 'ctrl+mouse1'],
  anchor: ['v', 'shift+mouse1'],
  selectAll: ['ctrl+a'],
  escape: ['escape'],
  copy: ['enter', 'ctrl+c'],
  edit: ['c'],
  del: ['dd'],
  info: ['K'],
  filter: ['/', 'ctrl+f'],
  clearFilter: ['ctrl+shift+d'],
  groupNext: ['ctrl+j'],
  groupPrev: ['ctrl+k'],
  newGroup: ['ctrl+n'],
  help: ['?'],
  groupAdd: ['a'],
  groupRemove: ['A'],
  tagAdd: ['t'],
  star: ['s'],
  yank: ['y'],
  paste: ['p'],
  restore: ['r'],
  quitSelect: ['q'],
  filters: ['f'],
  click: ['mouse1'],
};

let keymap = {};
let userKeymap = {};
let keyBuffer = '';
let countBuffer = '';
let keyBufferTimer = null;
let cursor = 0;
let scrolloff = 0;
let cursorSpeed = 2.4;
let cursorColors = ['#6ea8fe', '#f5b301'];
let flashColor = '#ffffff';
let flashDuration = 260;
let assetFilters = {
  minBytes: 0,
  maxBytes: 0,
  minWidth: 0,
  maxWidth: 0,
  minHeight: 0,
  maxHeight: 0,
  exts: [],
  tags: [],
  source: '',
  sourceKeys: [],
  presets: [],
  from: '',
  to: '',
};
let yank = null;
let capturingAction = null;
let hotkeyCapturing = false;
let hotkeyTarget = 'panel';
let capturePending = '';
let captureTimer = null;

function mergedKeymap() {
  const merged = {};
  const actions = new Set([...Object.keys(DEFAULT_KEYMAP), ...Object.keys(userKeymap)]);
  for (const a of actions) {
    const v = userKeymap[a] !== undefined ? userKeymap[a] : DEFAULT_KEYMAP[a];
    merged[a] = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
  }
  return merged;
}

function normalizeKey(raw) {
  if (!raw) return '';
  // 组合键统一小写；单个字符/序列严格区分大小写（H 与 h 是两个键）
  return raw.includes('+') ? raw.toLowerCase() : raw;
}

const LEGACY_MOUSE = {
  'mouse-middle': 'mouse2',
  'mouse-back': 'mouse4',
  'mouse-forward': 'mouse5',
};

function migrateBinding(raw) {
  return LEGACY_MOUSE[raw] || raw;
}

function buildKeymap(user) {
  keymap = {};
  if (user) {
    userKeymap = {};
    for (const [action, list] of Object.entries(user)) {
      const arr = Array.isArray(list) ? list : [list];
      userKeymap[action] = arr.filter((x) => typeof x === 'string' && x).map(migrateBinding);
    }
  }
  for (const [action, list] of Object.entries(mergedKeymap())) {
    for (const raw of list) {
      const key = normalizeKey(raw);
      (keymap[key] = keymap[key] || []).push(action);
    }
  }
}

function comboFromEvent(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return '';
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  let k = e.key;
  if (k === ' ') k = 'space';
  k = k.toLowerCase();
  parts.push(k);
  return parts.join('+');
}

function isTypingTarget() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function modalOpen() {
  return ['settings', 'editor', 'confirm', 'prompt'].some((id) => $(id) && !$(id).hidden);
}

function gridCols() {
  if (grid.classList.contains('virtual')) return gridMetrics().cols;
  const cards = [...grid.children];
  if (!cards.length) return 1;
  const top = cards[0].offsetTop;
  const n = cards.filter((c) => c.offsetTop === top).length;
  return n || 1;
}

function paintCursor() {
  const phase = (performance.now() / 1000) % Math.max(0.4, cursorSpeed);
  document.documentElement.style.setProperty('--cursor-phase', `${phase}s`);
  grid.querySelectorAll('.card').forEach((el) => {
    el.classList.toggle('cursor', Number(el.dataset.index) === cursor);
  });
  updateBatchDock();
}

function moveCursor(delta) {
  hideTip();
  const n = shownItems.length;
  if (!n) return;
  cursor = Math.max(0, Math.min(n - 1, cursor + delta));
  paintCursor();
  ensureCursorVisible();
}

function rowHeight() {
  if (grid.classList.contains('virtual')) return gridMetrics().rowH;
  const el = grid.children[0];
  if (el) return el.getBoundingClientRect().height + 8;
  return 120;
}

function ensureCursorVisible() {
  const scroller = document.querySelector('main');
  if (!scroller) return;

  if (grid.classList.contains('virtual')) {
    const m = gridMetrics();
    const gr = grid.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const row = Math.floor(cursor / m.cols);
    const top = gr.top + row * m.rowH;
    const pad = scrolloff * m.rowH;
    if (top < sr.top + pad) scroller.scrollTop -= sr.top + pad - top;
    else if (top + m.rowH > sr.bottom - pad) scroller.scrollTop += top + m.rowH - (sr.bottom - pad);
    renderVirtual(true);
    return;
  }

  const el = grid.querySelector(`.card[data-index="${cursor}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const pad = scrolloff * rowHeight();
  if (r.top < sr.top + pad) {
    scroller.scrollTop -= sr.top + pad - r.top;
  } else if (r.bottom > sr.bottom - pad) {
    scroller.scrollTop += r.bottom - (sr.bottom - pad);
  }
}

function pageRows() {
  const scroller = document.querySelector('main');
  if (!scroller) return 1;
  return Math.max(1, Math.floor(scroller.clientHeight / rowHeight()) - 1);
}

function anchorAction(idx) {
  const it = shownItems[idx];
  if (!it) return;
  const isTrash = currentGroup === '__trash__';
  const bag = isTrash ? trashSelected : selected;
  if (anchorIndex === null) {
    anchorIndex = idx;
    anchorMode = bag.has(it.sha) ? 'sub' : 'add';
    paintSelection();
    logAction(anchorMode === 'sub' ? '减选锚点已就位' : '已设置锚点，再按 v 或 Shift+点击 选区间');
    return;
  }
  const [from, to] = anchorIndex < idx ? [anchorIndex, idx] : [idx, anchorIndex];
  let all = true;
  for (let i = from; i <= to; i++) {
    const x = shownItems[i];
    if (x && !bag.has(x.sha)) all = false;
  }
  for (let i = from; i <= to; i++) {
    const x = shownItems[i];
    if (!x) continue;
    if (all) bag.delete(x.sha);
    else bag.add(x.sha);
  }
  anchorIndex = null;
  anchorMode = 'add';
  paintSelection();
  if (isTrash) updateTrashBar();
}

/* ---------- which-key ---------- */

function whichKeyCandidates(prefix) {
  const out = [];
  for (const key of Object.keys(keymap)) {
    if (!isSequenceKey(key)) continue;
    if (key.length <= prefix.length || !key.startsWith(prefix)) continue;
    const next = key[prefix.length].toUpperCase();
    if (out.some((x) => x.ch === next)) continue;
    const actions = keymap[key];
    const label = actions && actions.length ? ((ACTION_META[actions[0]] || {}).label || actions[0]) : '…';
    out.push({ ch: next, label, exact: !!actions });
  }
  return out.sort((a, b) => a.ch.localeCompare(b.ch));
}

function showWhichKey(prefix) {
  const box = $('whichkey');
  if (!box) return;
  const cands = whichKeyCandidates(prefix);
  if (!cands.length) {
    box.hidden = true;
    return;
  }
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'wk-head';
  head.textContent = prefix;
  box.appendChild(head);
  const list = document.createElement('div');
  list.className = 'wk-list';
  for (const c of cands) {
    const row = document.createElement('div');
    row.className = 'wk-row';
    const k = document.createElement('kbd');
    k.textContent = keyLabel(c.ch);
    const t = document.createElement('span');
    t.textContent = c.label;
    row.append(k, t);
    list.appendChild(row);
  }
  box.appendChild(list);
  box.hidden = false;
}

function hideWhichKey() {
  const box = $('whichkey');
  if (box) box.hidden = true;
}

function actionDelta(action) {
  if (action === 'up') return -gridCols();
  if (action === 'down') return gridCols();
  if (action === 'left') return -1;
  if (action === 'right') return 1;
  if (action === 'pageDown') return pageRows() * gridCols();
  if (action === 'pageUp') return -pageRows() * gridCols();
  return 0;
}

function executeAction(action, count, e) {
  const times = Math.max(1, count || 1);
  if (isCountableAction(action) && times > 1) {
    if (action === 'first') {
      cursor = Math.min(times - 1, Math.max(0, shownItems.length - 1));
      paintCursor();
      ensureCursorVisible();
      return;
    }
    if (action === 'last') {
      runAction(action, e);
      return;
    }
    moveCursor(actionDelta(action) * times);
    return;
  }
  runAction(action, e);
}

function armBufferReset() {
  clearTimeout(keyBufferTimer);
  keyBufferTimer = setTimeout(() => {
    keyBuffer = '';
    hideWhichKey();
  }, 1200);
}

/* ---------- 快捷键速查 ---------- */

function openHelp() {
  const box = $('help');
  if (!box) return;
  const merged = mergedKeymap();
  const groups = {};
  for (const action of Object.keys(merged)) {
    if (!merged[action].length) continue;
    const meta = ACTION_META[action] || { label: action, group: '其他' };
    (groups[meta.group] = groups[meta.group] || []).push({ actions: merged[action], label: meta.label });
  }
  const body = box.querySelector('.help-body');
  body.innerHTML = '';
  for (const [group, rows] of Object.entries(groups)) {
    const h = document.createElement('div');
    h.className = 'help-group';
    h.textContent = group;
    body.appendChild(h);
    for (const r of rows) {
      const line = document.createElement('div');
      line.className = 'help-line';
      const keys = document.createElement('span');
      keys.className = 'help-keys';
      for (const k of r.actions) {
        const kb = document.createElement('kbd');
        kb.textContent = keyLabel(k);
        keys.appendChild(kb);
      }
      const name = document.createElement('span');
      name.className = 'help-name';
      name.textContent = r.label;
      line.append(keys, name);
      body.appendChild(line);
    }
  }
  box.hidden = false;
}

function closeHelp() {
  const box = $('help');
  if (box) box.hidden = true;
}

function helpOpen() {
  const box = $('help');
  return !!box && !box.hidden;
}

/* ---------- 按键编辑 ---------- */

function keymapEditorRow(action) {
  const merged = mergedKeymap();
  const keys = merged[action] || [];
  const meta = ACTION_META[action] || { label: action, group: '其他' };

  const row = document.createElement('div');
  row.className = 'km-row';
  row.dataset.action = action;

  const name = document.createElement('span');
  name.className = 'km-name';
  name.textContent = meta.label;

  const chips = document.createElement('span');
  chips.className = 'km-keys';
  if (!keys.length) {
    const none = document.createElement('span');
    none.className = 'dim';
    none.textContent = '未绑定';
    chips.appendChild(none);
  }
  for (const k of keys) {
    const chip = document.createElement('span');
    chip.className = 'km-chip';
    chip.textContent = keyLabel(k);
    const del = document.createElement('button');
    del.className = 'km-del';
    del.textContent = '×';
    del.title = '删除这个绑定';
    del.addEventListener('click', async () => {
      const list = (userKeymap[action] || merged[action] || []).filter((x) => x !== k);
      userKeymap[action] = list;
      await saveSettings({ keymap: userKeymap });
      buildKeymap(userKeymap);
      renderKeymapEditor();
    });
    chip.appendChild(del);
    chips.appendChild(chip);
  }

  const btn = document.createElement('button');
  btn.className = 'btn small km-edit';
  btn.textContent = '添加键';
  btn.addEventListener('click', () => startCapture(row, action));

  const reset = document.createElement('button');
  reset.className = 'btn small km-reset';
  reset.textContent = '恢复';
  reset.title = '恢复这个动作的默认按键';
  reset.addEventListener('click', async () => {
    delete userKeymap[action];
    await saveSettings({ keymap: userKeymap });
    buildKeymap(userKeymap);
    renderKeymapEditor();
  });

  row.append(name, chips, btn, reset);
  return row;
}

function renderKeymapEditor() {
  const list = $('keymap-list');
  if (!list) return;
  list.innerHTML = '';
  for (const action of Object.keys(DEFAULT_KEYMAP)) {
    list.appendChild(keymapEditorRow(action));
  }
}

function captureBanner(text) {
  let bar = $('capture-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'capture-banner';
    bar.className = 'capture-banner floating';
    document.body.appendChild(bar);
  }
  bar.textContent = text;
  bar.hidden = !text;
  return bar;
}

document.addEventListener('mousedown', (e) => {
  if (!capturingAction) return;
  if (e.target && e.target.closest && e.target.closest('.km-row')) return;
  endCapture();
});

function startCapture(row, action) {
  if (capturingAction === action) return;
  if (capturingAction) {
    capturingAction = null;
    document.querySelectorAll('.km-row.capturing').forEach((r) => r.classList.remove('capturing'));
  }
  capturingAction = action;
  capturePending = '';
  row.classList.add('capturing');
  const label = (ACTION_META[action] || {}).label || action;
  captureBanner(`正在给「${label}」设置新键：按下组合键或连按两下字母，Esc 取消`);
  row.scrollIntoView({ block: 'nearest' });
}

function endCapture() {
  capturingAction = null;
  capturePending = '';
  clearTimeout(captureTimer);
  const bar = $('capture-banner');
  if (bar) bar.hidden = true;
  renderKeymapEditor();
}

async function commitBinding(raw) {
  const action = capturingAction;
  const binding = normalizeKey(raw);
  if (!action || !binding) return;
  const conflicts = conflictsFor(binding, action);
  if (conflicts.length) {
    const names = conflicts.map((a) => (ACTION_META[a] || {}).label || a).join('、');
    toast(`「${keyLabel(binding)}」和「${names}」冲突（相同或前缀重叠）`);
    endCapture();
    return;
  }
  const list = (userKeymap[action] || mergedKeymap()[action] || []).filter(Boolean);
  if (!list.includes(binding)) list.push(binding);
  userKeymap[action] = list;
  await saveSettings({ keymap: userKeymap });
  buildKeymap(userKeymap);
  toast(`已把「${(ACTION_META[action] || {}).label || action}」设为 ${binding}`);
  endCapture();
}

function handleCaptureMouse(e) {
  if (!capturingAction) return false;
  const modified = e.ctrlKey || e.altKey || e.shiftKey;
  if (e.button === 0 && !modified) return false; // 普通左键 = 点别处，交给取消逻辑
  const combo = mouseCombo(e, e.button);
  e.preventDefault();
  e.stopPropagation();
  commitBinding(combo);
  return true;
}

document.addEventListener(
  'contextmenu',
  (e) => {
    if (capturingAction || hotkeyCapturing) e.preventDefault();
  },
  true
);

document.addEventListener('mousedown', (e) => {
  if (handleCaptureMouse(e)) return;
}, true);

document.addEventListener('mousedown', (e) => {
  if (capturingAction || isTypingTarget() || modalOpen() || helpOpen()) return;
  if (e.button === 0 || e.button === 2) return; // 左键走 click，右键走菜单
  const combo = mouseCombo(e, e.button);
  const acts = keymap[combo];
  if (!acts || !acts.length) return;
  e.preventDefault();
  e.stopPropagation();
  executeAction(acts[0], 1, e);
}, true);

function handleCaptureKey(e) {
  if (!capturingAction) return false;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    endCapture();
    return true;
  }
  const combo = comboFromEvent(e);
  if (!combo) return true;

  const isPlain = !e.ctrlKey && !e.altKey && e.key.length === 1;
  if (isPlain) {
    if (capturePending && capturePending.length === 1) {
      clearTimeout(captureTimer);
      const seq = capturePending + e.key;
      capturePending = '';
      commitBinding(seq);
      return true;
    }
    capturePending = e.key;
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      const v = capturePending;
      capturePending = '';
      if (v) commitBinding(v);
    }, 650);
    return true;
  }
  commitBinding(combo);
  return true;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !modalOpen() && !capturingAction && !helpOpen()) {
    e.preventDefault();
  }
}, true);

/* ---------- 编辑弹窗字段导航 ---------- */

let editorNav = -1;

function editorFields() {
  const box = $('editor');
  if (!box) return [];
  return [...box.querySelectorAll('.field')];
}

function paintEditorNav() {
  editorFields().forEach((f, i) => f.classList.toggle('nav', i === editorNav));
}

function enterEditorNav(idx) {
  editorNav = Math.max(0, idx === undefined ? 0 : idx);
  paintEditorNav();
}

function exitEditorNav() {
  editorNav = -1;
  paintEditorNav();
}

function editorNavMove(delta) {
  const fields = editorFields();
  if (!fields.length) return;
  if (editorNav < 0) editorNav = 0;
  else editorNav = (editorNav + delta + fields.length) % fields.length;
  paintEditorNav();
}

function focusEditorField() {
  const fields = editorFields();
  const field = fields[editorNav];
  if (!field) return;
  const target = field.querySelector('input, button, select');
  if (target) target.focus();
}

function editorFocusables() {
  const box = $('editor');
  if (!box) return [];
  return [...box.querySelectorAll('input, button, select')].filter(
    (el) => !el.disabled && !el.hidden && el.getClientRects().length > 0
  );
}

function editorMoveFocus(delta) {
  const list = editorFocusables();
  if (!list.length) return;
  const idx = list.indexOf(document.activeElement);
  const next = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
  list[next].focus();
}

document.addEventListener('keydown', (e) => {
  if (handleCaptureKey(e)) return;
  if (helpOpen()) {
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      closeHelp();
    }
    return;
  }
  if (!$('editor') || $('editor').hidden) return;
  if (batchPanel && e.key === 'Escape') {
    e.preventDefault();
    closeBatchPanel();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (isTypingTarget()) {
      const el = document.activeElement;
      if (el && el.blur) el.blur();
      enterEditorNav(0);
    } else {
      exitEditorNav();
    }
    return;
  }
  // 输入框里也能换字段：Ctrl+J / Ctrl+K
  if (e.ctrlKey && !e.altKey && (e.key === 'j' || e.key === 'k')) {
    e.preventDefault();
    editorMoveFocus(e.key === 'j' ? 1 : -1);
    return;
  }
  if (isTypingTarget()) return;

  if (editorNav >= 0) {
    if (e.key === 'j') {
      e.preventDefault();
      editorNavMove(1);
    } else if (e.key === 'k') {
      e.preventDefault();
      editorNavMove(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      focusEditorField();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitEditorNav();
    }
    return;
  }
  if (e.key === 'j' || e.key === 'k') {
    e.preventDefault();
    editorNavMove(e.key === 'j' ? 1 : -1);
  }
});

/* ---------- 动作 ---------- */

function currentCard() {
  return shownItems[cursor] || null;
}

/* ---------- 批量编辑面板（编辑标签 / 编辑分组） ---------- */

let batchPanel = null;
let batchPanelKind = null;
let batchPanelOnClose = null;

function closeBatchPanel() {
  if (!batchPanel) return;
  batchPanel.remove();
  batchPanel = null;
  batchPanelKind = null;
  const cb = batchPanelOnClose;
  batchPanelOnClose = null;
  if (cb) cb();
}

function openBatchPanel(kind, opts = {}) {
  const shas = opts.sha ? [opts.sha] : getActionShas();
  if (!shas.length) return;
  if (batchPanel && batchPanelKind === kind) {
    closeBatchPanel();
    return;
  }
  closeBatchPanel();
  const isGroup = kind === 'group';
  const label = isGroup ? '分组' : '标签';
  const m = shas.length;
  const single = !!opts.sha;
  const scopeText = single ? `${opts.name || '这张图'} · 1 张` : `已选 ${m} 张`;
  let changed = 0;
  let q = '';

  const panel = document.createElement('div');
  panel.className = 'bpanel';
  panel.innerHTML =
    '<div class="bp-head">' +
    `<span class="bp-title">编辑${label}</span>` +
    `<span class="bp-scope">${escapeHtml(scopeText)}</span>` +
    `<button class="bp-x" title="关闭（Esc）">${icon('x', 14)}</button>` +
    '</div>' +
    `<div class="bp-search"><input class="bp-q" autocomplete="off" spellcheck="false" placeholder="搜索${label}，或输入新名字回车新建"></div>` +
    '<div class="bp-list"></div>' +
    '<div class="bp-foot">' +
    '<button class="btn small bp-done">完成</button>' +
    (isGroup ? '' : '<button class="bp-link">管理全部标签</button>') +
    '<span class="bp-hint">点一下加入，再点一下移出；Esc 关闭</span>' +
    '<span class="bp-count"></span>' +
    '</div>';
  document.body.appendChild(panel);
  batchPanel = panel;
  batchPanelKind = kind;
  batchPanelOnClose = opts.onClose || null;

  const listEl = panel.querySelector('.bp-list');
  const countEl = panel.querySelector('.bp-count');
  const input = panel.querySelector('.bp-q');
  // 面板内的状态自己维护：单图模式下 shownItems 可能不含这张（比如从回收站打开），
  // 而且 refresh() 之后原对象就换掉了，所以不要回读列表。
  const state = new Map();
  for (const s of shas) {
    const a = shownItems.find((x) => x.sha === s) || (editing && editing.sha === s ? editing : null);
    state.set(s, {
      tags: new Set((a && a.tags) || []),
      groups: new Set((a && a.groups) || []),
    });
  }
  const setOf = (s) => state.get(s);
  const hasSet = (s, name) => {
    const st = setOf(s);
    return !!st && (isGroup ? st.groups : st.tags).has(name);
  };
  const cov = (name) => shas.filter((s) => hasSet(s, name)).length;

  function repaint() {
    const names = (isGroup ? allGroups : allTags)
      .filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => cov(b) - cov(a) || a.localeCompare(b, 'zh'));
    listEl.innerHTML = '';
    for (const name of names) {
      const n = cov(name);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bp-row' + (n === m ? ' on' : n ? ' part' : '');
      const st = n === m ? '✓ 已加' : n ? `缺 ${m - n} 张` : '加入';
      row.innerHTML =
        `<span class="bp-name">${escapeHtml(name)}</span>` +
        `<span class="bp-meta">${n}/${m} 张</span>` +
        `<span class="bp-st"><span class="n">${st}</span><span class="h">✕ 移出</span></span>`;      row.onclick = () => toggle(name);
      listEl.appendChild(row);
    }
    const exact = names.some((n) => n.toLowerCase() === q.toLowerCase());
    if (q && !exact) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bp-row bp-new';
      row.innerHTML =
        `<span class="bp-name"><span class="bp-plus">＋</span> 新建${label}「${escapeHtml(q)}」</span>` +
        '<span class="bp-meta"></span><span class="bp-st">回车</span>';
      row.onclick = () => createAndAdd(q);
      listEl.appendChild(row);
    }
    if (!names.length && !q) {
      listEl.innerHTML = `<div class="bp-empty">还没有${label}，在上面的输入框里新建一个</div>`;
    }
    countEl.textContent = changed ? `已改 ${changed} 处` : '';
  }

  async function afterChange() {
    changed++;
    await Promise.all([refresh(), loadGroups()]);
    repaint();
  }

  async function toggle(name) {
    const n = cov(name);
    try {
      if (n === m) {
        if (isGroup) await invoke('batch_ungroup', { shas, group: name });
        else await invoke('batch_untag', { shas, tags: [name] });
        for (const s of shas) {
          const st = setOf(s);
          if (st) (isGroup ? st.groups : st.tags).delete(name);
        }
      } else {
        const miss = shas.filter((s) => !hasSet(s, name));
        if (!miss.length) return;
        if (isGroup) await invoke('add_to_group', { shas: miss, group: name });
        else await invoke('batch_tags', { shas: miss, tags: [name] });
        for (const s of shas) {
          const st = setOf(s);
          if (st) (isGroup ? st.groups : st.tags).add(name);
        }
      }
      await afterChange();
    } catch (err) {
      toast('操作失败：' + err);
    }
  }

  async function createAndAdd(name) {
    const nm = String(name || '').trim();
    if (!nm) return;
    try {
      if (isGroup) await invoke('add_to_group', { shas, group: nm });
      else await invoke('batch_tags', { shas, tags: [nm] });
      for (const s of shas) {
        const st = setOf(s);
        if (st) (isGroup ? st.groups : st.tags).add(nm);
      }
      q = '';
      input.value = '';
      await afterChange();
    } catch (err) {
      toast('操作失败：' + err);
    }
  }

  input.addEventListener('input', () => {
    q = input.value.trim();
    repaint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeBatchPanel();
      return;
    }
    if (e.key !== 'Enter') return;
    const pool = isGroup ? allGroups : allTags;
    const exact = pool.find((n) => n.toLowerCase() === q.toLowerCase());
    if (exact) toggle(exact);
    else if (q) createAndAdd(q);
  });
  panel.querySelector('.bp-x').onclick = () => closeBatchPanel();
  panel.querySelector('.bp-done').onclick = () => {
    closeBatchPanel();
    if (changed) toast(`已更新 ${changed} 处${label}`);
  };
  const link = panel.querySelector('.bp-link');
  if (link)
    link.onclick = () => {
      closeBatchPanel();
      openTagManage();
    };
  repaint();
  setTimeout(() => input.focus(), 0);
}

document.addEventListener('mousedown', (e) => {
  if (batchPanel && !batchPanel.contains(e.target)) closeBatchPanel();
});

function getActionShas() {
  const cur = currentCard();
  if (currentGroup === '__trash__') {
    return trashSelected.size ? [...trashSelected] : cur ? [cur.sha] : [];
  }
  if (selected.size) return [...selected];
  return cur ? [cur.sha] : [];
}

async function runAction(action, e) {
  const n = shownItems.length;
  const trash = currentGroup === '__trash__';

  if (trash) {
    if (action === 'anchor') {
      anchorAction(cursor);
      return;
    }
    if (action === 'del') {
      const shas = getActionShas();
      if (!shas.length) return;
      const ok = await confirmDialog(`彻底删除选中的 ${shas.length} 张？`);
      if (!ok) return;
      for (const sha of shas) {
        await invoke('trash_delete', { sha, permanent: deleteMode === 'permanent' });
      }
      logAction(`已彻底删除 ${shas.length} 张`);
      trashSelected.clear();
      await Promise.all([refresh(), loadGroups(), showStats()]);
      return;
    }
    if (action === 'restore' || action === 'copy') {
      const shas = getActionShas();
      if (!shas.length) return;
      for (const sha of shas) await invoke('trash_restore', { sha });
      logAction(`已恢复 ${shas.length} 张`);
      trashSelected.clear();
      await Promise.all([refresh(), loadGroups(), showStats()]);
      return;
    }
    if (action === 'quitSelect' || action === 'escape') {
      trashSelected.clear();
      paintSelection();
      updateTrashBar();
      exitSelectionMode();
      return;
    }
    if (action === 'edit' || action === 'info' || action === 'yank') return;
  }

  switch (action) {
    case 'up': moveCursor(-gridCols()); break;
    case 'down': moveCursor(gridCols()); break;
    case 'left': moveCursor(-1); break;
    case 'right': moveCursor(1); break;
    case 'pageDown': moveCursor(pageRows() * gridCols()); break;
    case 'pageUp': moveCursor(-pageRows() * gridCols()); break;
    case 'first':
      cursor = 0;
      paintCursor();
      ensureCursorVisible();
      break;
    case 'last':
      cursor = Math.max(0, n - 1);
      paintCursor();
      ensureCursorVisible();
      break;
    case 'toggle': {
      const a = currentCard();
      if (!a) break;
      if (trash) {
        if (trashSelected.has(a.sha)) trashSelected.delete(a.sha);
        else trashSelected.add(a.sha);
        paintSelection();
        updateTrashBar();
      } else {
        toggleSelect(a.sha, cursor);
      }
      break;
    }
    case 'anchor':
      anchorAction(cursor);
      break;
    case 'selectAll': {
      if (!n) break;
      if (trash) {
        trashSelected = new Set(trashItems.map((x) => x.sha));
        paintSelection();
        updateTrashBar();
      } else {
        selected = new Set(shownItems.map((x) => x.sha));
        paintSelection();
      }
      break;
    }
    case 'copy': {
      const a = currentCard();
      if (a) await copy(a);
      break;
    }
    case 'info': {
      const a = currentCard();
      const el = grid.querySelector(`.card[data-index="${cursor}"]`);
      if (a && el) {
        const r = el.getBoundingClientRect();
        showTip(a, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
        setTimeout(hideTip, 3500);
      }
      break;
    }
    case 'clearFilter':
      qInput.value = '';
      syncClear();
      await refresh();
      break;
    case 'edit': {
      const a = currentCard();
      if (a) openEditor(a);
      break;
    }
    case 'filter':
      qInput.focus();
      qInput.select();
      break;
    case 'newGroup': {
      const name = await promptDialog('新建分组', '');
      const v = (name || '').trim();
      if (v) {
        try {
          await invoke('create_group', { name: v });
          await loadGroups();
        } catch (err) {
          toast('新建失败：' + err);
        }
      }
      break;
    }
    case 'groupNext':
    case 'groupPrev': {
      const items = [...document.querySelectorAll('.side-item')].filter((x) => !x.hidden && x.dataset.group);
      const idx = items.findIndex((x) => x.dataset.group === currentGroup);
      if (idx < 0) break;
      const step = action === 'groupNext' ? 1 : -1;
      const next = items[(idx + step + items.length) % items.length];
      if (next) await selectGroup(next.dataset.group);
      break;
    }
    case 'del': {
      const target = currentCard();
      if (!target) break;
      const shas = getActionShas();
      const ok = await confirmDialog(
        shas.length > 1 ? `删除选中的 ${shas.length} 张到回收站？` : `删除「${target.name}」到回收站？`
      );
      if (!ok) break;
      await invoke('batch_delete', { shas });
      logAction(`已把 ${shas.length} 张移入回收站`);
      clearSelection();
      await Promise.all([refresh(), loadGroups(), showStats()]);
      break;
    }
    case 'yank': {
      const shas = getActionShas();
      if (!shas.length) break;
      yank = { shas: [...shas], fromGroup: currentGroup };
      flashCards(shas);
      try {
        if (shas.length > 1) await invoke('copy_assets_files', { shas });
        else if (shas.length === 1) await copy(currentCard());
        logAction(`已复制 ${shas.length} 张，按 p 粘贴到光标后`);
      } catch (err) {
        toast('复制失败：' + err);
      }
      clearSelection();
      exitSelectionMode();
      break;
    }
    case 'paste': {
      if (!yank || !yank.shas.length) {
        toast('还没有可粘贴的内容（先按 y）');
        break;
      }
      const shas = yank.shas;
      const same = yank.fromGroup === currentGroup;
      try {
        if (same && orderKey() && shownItems.length) {
          const moving = shownItems.filter((a) => shas.includes(a.sha));
          if (!moving.length) {
            toast('要粘贴的图不在当前视图');
            break;
          }
          const rest = shownItems.filter((a) => !shas.includes(a.sha));
          const anchorIdx = Math.min(cursor, shownItems.length - 1);
          const beforeCount = shownItems
            .slice(0, anchorIdx + 1)
            .filter((a) => !shas.includes(a.sha)).length;
          rest.splice(beforeCount, 0, ...moving);
          await invoke('set_order', { key: orderKey(), shas: rest.map((a) => a.sha) });
          logAction(`已移动 ${moving.length} 张`);
          await refresh();
          flashCards(shas);
        } else if (currentGroup !== '__all__' && currentGroup !== '__none__' && currentGroup !== '__trash__' && currentGroup !== '__star__') {
          await invoke('add_to_group', { shas, group: currentGroup });
          logAction(`已复制 ${shas.length} 张到「${currentGroup}」`);
          await Promise.all([refresh(), loadGroups()]);
          flashCards(shas);
        } else {
          toast('先进入一个分组再按 p');
        }
      } catch (err) {
        toast('粘贴失败：' + err);
      }
      break;
    }
    case 'groupAdd': {
      const shas = getActionShas();
      if (!shas.length) break;
      openBatchPanel('group');
      break;
    }
    case 'groupRemove': {
      const shas = getActionShas();
      if (!shas.length) break;
      if (currentGroup.startsWith('__')) {
        toast('当前不是分组视图');
        break;
      }
      await invoke('batch_ungroup', { shas, group: currentGroup });
      logAction(`已把 ${shas.length} 张移出「${currentGroup}」`);
      clearSelection();
      await Promise.all([refresh(), loadGroups()]);
      break;
    }
    case 'tagAdd': {
      const shas = getActionShas();
      if (!shas.length) break;
      openBatchPanel('tag');
      break;
    }
    case 'star': {
      const shas = getActionShas();
      if (!shas.length) break;
      const all = shas.every((sha) => {
        const a = shownItems.find((x) => x.sha === sha);
        return a && a.starred;
      });
      await invoke('batch_star', { shas, on: !all });
      logAction(all ? `已取消收藏 ${shas.length} 张` : `已收藏 ${shas.length} 张`);
      await Promise.all([refresh(), loadGroups()]);
      break;
    }
    case 'restore':
      break;
    case 'click': {
      const a = currentCard();
      if (!a) break;
      if (trash) {
        if (trashSelected.has(a.sha)) trashSelected.delete(a.sha);
        else trashSelected.add(a.sha);
        paintSelection();
        updateTrashBar();
      } else if (selectionMode || selected.size > 0) {
        toggleSelect(a.sha, cursor);
      } else {
        await copy(a);
      }
      break;
    }
    case 'filters':
      if (filterPanelOpen()) closeFilterPanel();
      else openFilterPanel();
      break;
    case 'quitSelect':
      if (trash) {
        trashSelected.clear();
        paintSelection();
        updateTrashBar();
        exitSelectionMode();
      } else {
        clearSelection();
        exitSelectionMode();
      }
      break;
    case 'help':
      openHelp();
      break;
    case 'escape': {
      if (trash) {
        if (trashSelected.size) {
          trashSelected.clear();
          paintSelection();
          updateTrashBar();
        }
        exitSelectionMode();
      } else if (selected.size || selectionMode) {
        clearSelection();
        exitSelectionMode();
      } else if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      break;
    }
    default:
      break;
  }
}

const ACTIONS_NEED_ITEMS = new Set([
  'up', 'down', 'left', 'right', 'first', 'last', 'toggle', 'anchor',
  'copy', 'edit', 'del', 'info', 'pageDown', 'pageUp', 'selectAll',
  'groupAdd', 'groupRemove', 'tagAdd', 'star', 'yank', 'restore',
]);

function handleGridKey(e) {
  if (filterPanelOpen()) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFilterPanel();
      return true;
    }
    if (isTypingTarget()) return false;
    return true;
  }
  if (helpOpen()) {
    e.preventDefault();
    e.stopPropagation();
    const hk = e.key.toLowerCase();
    if (hk === 'escape' || e.key === '?') closeHelp();
    return true;
  }
  if (isTypingTarget() || modalOpen() || capturingAction) return false;

  if (!e.ctrlKey && !e.altKey && /^[0-9]$/.test(e.key)) {
    countBuffer += e.key;
    keyBuffer = '';
    setLastAction(`计数 ${countBuffer} …`);
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  if (!e.ctrlKey && !e.altKey && e.key.length === 1) {
    const next = keyBuffer + e.key;
    const exact = keymap[next];
    const prefix = Object.keys(keymap).some((k) => isSequenceKey(k) && k.length > next.length && k.startsWith(next));
    if (exact) {
      keyBuffer = '';
      clearTimeout(keyBufferTimer);
      hideWhichKey();
      e.preventDefault();
      e.stopPropagation();
      const act = exact[0];
      const count = parseInt(countBuffer, 10) || 1;
      countBuffer = '';
      if (!(ACTIONS_NEED_ITEMS.has(act) && !shownItems.length)) {
        try {
          executeAction(act, count, e);
        } catch (err) {
          window.__lastKeyError = String(err && err.stack ? err.stack : err);
        }
      }
      return true;
    }
    if (prefix) {
      keyBuffer = next;
      showWhichKey(next);
      setLastAction(`按键 ${next} …`);
      armBufferReset();
      return true;
    }
    keyBuffer = '';
    countBuffer = '';
    hideWhichKey();
  }

  const combo = comboFromEvent(e);
  if (keymap[combo]) {
    e.preventDefault();
    e.stopPropagation();
    const act = keymap[combo][0];
    const count = parseInt(countBuffer, 10) || 1;
    countBuffer = '';
    if (!(ACTIONS_NEED_ITEMS.has(act) && !shownItems.length)) executeAction(act, count, e);
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (handleGridKey(e)) e.stopPropagation();
}, true);

function acceleratorFromEvent(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const map = {
    ' ': 'Space',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    escape: 'Escape',
    enter: 'Enter',
    tab: 'Tab',
  };
  let k = e.key.toLowerCase();
  if (map[k]) k = map[k];
  else if (k.length === 1) k = k.toUpperCase();
  if (!k) return '';
  return [...mods, k].join('+');
}

function endHotkeyCapture() {
  hotkeyCapturing = false;
  const btn = $(hotkeyTarget === 'clip' ? 'clip-hotkey-edit' : 'hotkey-edit');
  if (btn) btn.textContent = '修改';
  const bar = $('capture-banner');
  if (bar) bar.hidden = true;
}

function startHotkeyCapture(target) {
  hotkeyTarget = target;
  hotkeyCapturing = true;
  const btn = $(target === 'clip' ? 'clip-hotkey-edit' : 'hotkey-edit');
  if (btn) btn.textContent = '按下新组合…';
  captureBanner(
    target === 'clip'
      ? '正在设置剪贴板捕获热键：直接按新组合，Esc 取消'
      : '正在设置快贴热键：直接按新组合，Esc 取消'
  );
}

async function clearHotkey(target) {
  const accel = '';
  try {
    await invoke(target === 'clip' ? 'set_clip_hotkey' : 'set_hotkey', { accel });
    $(target === 'clip' ? 'clip-hotkey-value' : 'hotkey-value').textContent = '未设置';
    toast('已禁用该全局热键');
  } catch (e) {
    toast(String(e));
  }
}

document.addEventListener(
  'keydown',
  (e) => {
    if (!hotkeyCapturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape') {
      endHotkeyCapture();
      return;
    }
    const accel = acceleratorFromEvent(e);
    if (!accel) return;
    invoke(hotkeyTarget === 'clip' ? 'set_clip_hotkey' : 'set_hotkey', { accel })
      .then(() => {
        const target = hotkeyTarget;
        endHotkeyCapture();
        $(target === 'clip' ? 'clip-hotkey-value' : 'hotkey-value').textContent = accel;
        toast(`${target === 'clip' ? '剪贴板' : '快贴'}热键已改为 ${accel}`);
      })
      .catch((err) => {
        endHotkeyCapture();
        toast(String(err));
      });
  },
  true
);

function updateFilterChip() {
  const btn = $('filter-btn');
  if (!btn) return;
  const on = filtersActive();
  btn.classList.toggle('active', on);
  btn.title = on ? '已启用筛选，点开可清空' : '筛选';
}

function filtersActive() {
  const f = assetFilters;
  return !!(
    f.minBytes ||
    f.maxBytes ||
    f.minWidth ||
    f.maxWidth ||
    f.minHeight ||
    f.maxHeight ||
    (f.exts && f.exts.length) ||
    (f.tags && f.tags.length) ||
    (f.sourceKeys && f.sourceKeys.length) ||
    (f.presets && f.presets.length) ||
    f.from ||
    f.to
  );
}

function fillFilterPanel() {
  const mb = (b) => (b ? (b / 1024 / 1024).toFixed(2).replace(/\.00$/, '') : '');
  $('f-min-mb').value = mb(assetFilters.minBytes);
  $('f-max-mb').value = mb(assetFilters.maxBytes);
  $('f-min-w').value = assetFilters.minWidth || '';
  $('f-max-w').value = assetFilters.maxWidth || '';
  $('f-min-h').value = assetFilters.minHeight || '';
  $('f-max-h').value = assetFilters.maxHeight || '';
  $('f-source').value = (assetFilters.sourceKeys && assetFilters.sourceKeys[0]) || '';
  $('f-from').value = assetFilters.from || '';
  $('f-to').value = assetFilters.to || '';

  document.querySelectorAll('#f-exts .fp-chip').forEach((c) => {
    c.classList.toggle('on', (assetFilters.exts || []).includes(c.dataset.ext));
  });
  document.querySelectorAll('#f-presets .fp-chip').forEach((c) => {
    c.classList.toggle('on', (assetFilters.presets || []).includes(c.dataset.pre));
  });

  panelTagSet = new Set(assetFilters.tags || []);
  renderPicker('f-tags', allTags, panelTagSet, '点选或输入筛选标签', {
    allowNew: false,
    onChange: () => updateFilterBadge(),
  });
  updateFilterBadge();
}

function readFilterPanel() {
  const mb2b = (v) => Math.round((Number(v) || 0) * 1024 * 1024);
  const presets = [...document.querySelectorAll('#f-presets .fp-chip.on')].map((c) => c.dataset.pre);
  const cap = (cur, limit) => (cur ? Math.min(cur, limit) : limit);
  let maxBytes = mb2b($('f-max-mb').value);
  if (presets.includes('w1')) maxBytes = cap(maxBytes, 1024 * 1024);
  if (presets.includes('w10')) maxBytes = cap(maxBytes, 10 * 1024 * 1024);
  let maxWidth = Number($('f-max-w').value) || 0;
  if (presets.includes('w1000')) maxWidth = cap(maxWidth, 1000);

  assetFilters = {
    minBytes: mb2b($('f-min-mb').value),
    maxBytes,
    minWidth: Number($('f-min-w').value) || 0,
    maxWidth,
    minHeight: Number($('f-min-h').value) || 0,
    maxHeight: Number($('f-max-h').value) || 0,
    exts: [...document.querySelectorAll('#f-exts .fp-chip.on')].map((c) => c.dataset.ext),
    tags: [...panelTagSet],
    source: '',
    sourceKeys: (assetFilters.sourceKeys || []).slice(),
    presets,
    from: $('f-from').value,
    to: $('f-to').value,
  };
}

function updateFilterBadge() {
  const badge = $('fp-active');
  if (!badge) return;
  const num = (id) => (Number($(id).value) || 0) > 0;
  let n = 0;
  if (num('f-min-mb')) n++;
  if (num('f-max-mb')) n++;
  if (num('f-min-w')) n++;
  if (num('f-max-w')) n++;
  if (num('f-min-h')) n++;
  if (num('f-max-h')) n++;
  n += document.querySelectorAll('#f-exts .fp-chip.on').length;
  n += panelTagSet.size;
  if ((assetFilters.sourceKeys || []).length) n++;
  if ($('f-from').value) n++;
  if ($('f-to').value) n++;
  n += document.querySelectorAll('#f-presets .fp-chip.on').length;
  badge.textContent = `${n} 项生效`;
  badge.hidden = n === 0;
}

function filterPanelOpen() {
  const p = $('filter-panel');
  return !!p && !p.hidden;
}

function paintSourcePicker() {
  const box = $('f-source');
  if (!box) return;
  box.innerHTML = '';
  const current = (assetFilters.sourceKeys && assetFilters.sourceKeys[0]) || '';

  const make = (label, key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'source-chip' + (key === current ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      assetFilters.sourceKeys = key ? [key] : [];
      paintSourcePicker();
      if (filterPanelOpen()) updateFilterBadge();
    });
    box.appendChild(b);
  };

  make('全部来源', '');
  for (const o of sourceOptions) make(`${o.label}（${o.count}）`, o.key);
}

let sourceOptions = [];

async function loadSourceOptions() {
  try {
    sourceOptions = await invoke('source_stats');
  } catch (_) {
    sourceOptions = [];
  }
  paintSourcePicker();
}

function openFilterPanel() {
  fillFilterPanel();
  const btn = $('filter-btn');
  const panel = $('filter-panel');
  panel.hidden = false;
  const body = panel.querySelector('.fp-body');
  if (body) body.scrollTop = 0;
  if (btn) {
    const r = btn.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    let left = r.left - 40;
    left = Math.max(12, Math.min(left, window.innerWidth - pr.width - 12));
    const top = r.bottom + 8;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.maxHeight = `${Math.max(240, Math.min(window.innerHeight - top - 12, 520))}px`;
  }
  loadSourceOptions();
}

function closeFilterPanel() {
  $('filter-panel').hidden = true;
}

async function applyFilters() {
  readFilterPanel();
  listLimit = 3000;
  saveSettings({ filters: assetFilters });
  closeFilterPanel();
  await refresh();
}

async function clearFilters() {
  panelTagSet = new Set();
  assetFilters = {
    minBytes: 0, maxBytes: 0, minWidth: 0, maxWidth: 0,
    minHeight: 0, maxHeight: 0, exts: [], tags: [], source: '', from: '', to: '',
  };
  saveSettings({ filters: assetFilters });
  closeFilterPanel();
  await refresh();
}

function enhanceNumberInputs() {
  document.querySelectorAll('input.num-input[type="number"]').forEach((inp) => {
    if (inp.dataset.stepper) return;
    inp.dataset.stepper = '1';
    const wrap = document.createElement('span');
    wrap.className = 'num-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);

    const box = document.createElement('span');
    box.className = 'num-steppers';
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'num-step';
    up.textContent = '▲';
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'num-step';
    down.textContent = '▼';
    up.addEventListener('click', () => {
      inp.stepUp();
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    down.addEventListener('click', () => {
      inp.stepDown();
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    box.append(up, down);
    wrap.appendChild(box);
  });
}

function updateBatchDock() {
  const bar = $('batchbar');
  if (!bar || bar.hidden) return;

  const scroller = document.querySelector('main');
  const sr = scroller.getBoundingClientRect();
  const br = bar.getBoundingClientRect();

  let top;
  let bottom;
  if (grid.classList.contains('virtual')) {
    const m = gridMetrics();
    const gr = grid.getBoundingClientRect();
    const row = Math.floor(cursor / m.cols);
    top = gr.top + row * m.rowH;
    bottom = top + m.cardW;
  } else {
    const el = grid.querySelector(`.card[data-index="${cursor}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    top = r.top;
    bottom = r.bottom;
  }

  const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
  const visible = bottom > sr.top && top < sr.bottom;
  // 只有卡片真的被批量栏压住（横跨栏上沿）才算避让；在视口下方不算
  const overlaps = visible && bottom > br.top + 6 && top < br.top;
  const want = atBottom || overlaps;
  const docked = bar.classList.contains('docked');
  if (want && !docked) bar.classList.add('docked');
  else if (!want && docked) bar.classList.remove('docked');
}

document.querySelector('main').addEventListener('scroll', updateBatchDock, { passive: true });

/* ---------- 自测套件（仅 STICKERBOX_SELFTEST=accept 时运行） ---------- */

async function runPerfSuite() {
  await new Promise((r) => setTimeout(r, 400));
  const ms = Math.round(performance.now() - (window.__t0 || 0));
  const m = gridMetrics();
  const scroller = document.querySelector('main');
  let ok = 0;
  for (let k = 0; k < 20; k++) {
    const row = Math.floor(((k * 37) % Math.max(1, m.rows)));
    scroller.scrollTop = row * m.rowH;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cards = [...grid.querySelectorAll('.card')];
    const target = row * m.cols;
    const first = Number(cards[0] ? cards[0].dataset.index : -1);
    const last = Number(cards.length ? cards[cards.length - 1].dataset.index : -1);
    if (first <= target && target <= last) ok++;
  }
  const checks = [
    { name: '首屏毫秒', ok: ms < 1500, detail: String(ms) },
    { name: '卡片节点', ok: grid.children.length <= 160, detail: String(grid.children.length) },
    { name: '随机跳转', ok: ok === 20, detail: `${ok}/20` },
  ];
  await invoke('selftest_report', {
    report: { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks },
  });
}

async function runAcceptSuite() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (key, opts) =>
    document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, opts || {})));
  const press = async (k, opts) => {
    send(k, opts);
    await sleep(90);
  };

  try {
    check('网格有卡片', grid.children.length > 0, `cards=${grid.children.length}`);
    check('光标在第一个', cursor === 0, `cursor=${cursor}`);

    const ctxIdx = 2;
    const ctxCard = grid.querySelector(`.card[data-index="${ctxIdx}"]`);
    cursor = 0;
    paintCursor();
    ctxCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }));
    await sleep(250);
    check(
      '右键菜单作用在鼠标下那张',
      !$('cardmenu').hidden && cardMenuSha === shownItems[ctxIdx].sha,
      cardMenuSha ? `menu for ${cardMenuSha.slice(0, 6)}` : 'no menu'
    );
    closeCardMenu();
    const hoverIdx = 4;
    const hoverCard = grid.querySelector(`.card[data-index="${hoverIdx}"]`);
    hoverCard.dispatchEvent(new MouseEvent('mouseenter', { clientX: 200, clientY: 200 }));
    check(
      '悬浮显示的是鼠标下那张',
      $('tip').textContent.includes(shownItems[hoverIdx].name),
      $('tip').textContent.slice(0, 40)
    );
    hoverCard.dispatchEvent(new MouseEvent('mouseleave'));
    closeEditor();
    await sleep(120);
    check('虚拟滚动已启用', grid.classList.contains('virtual'), `cards=${grid.children.length}/${shownItems.length}`);
    check('只渲染可见卡片', grid.children.length < shownItems.length, `cards=${grid.children.length}`);

    const scroller0 = document.querySelector('main');
    const firstIdx = Number(grid.querySelector('.card').dataset.index);
    scroller0.scrollTop = grid.offsetHeight * 0.45;
    await sleep(250);
    const midIdx = Number(grid.querySelector('.card').dataset.index);
    check('滚动后窗口移动', midIdx > firstIdx + 4, `${firstIdx}→${midIdx}`);
    check('滚动后卡片数受控', grid.children.length < shownItems.length, `cards=${grid.children.length}`);

    cursor = shownItems.length - 1;
    ensureCursorVisible();
    await sleep(250);
    check('跳到底部能看到光标', !!grid.querySelector(`.card[data-index="${cursor}"]`), `cursor=${cursor}`);
    cursor = 0;
    ensureCursorVisible();
    await sleep(250);

    selected.clear();
    selected.add(shownItems[0].sha);
    paintSelection();
    scroller0.scrollTop = grid.offsetHeight * 0.5;
    await sleep(250);
    selected.add(shownItems[100].sha);
    paintSelection();
    check('跨窗口选择保留', selected.size === 2, `selected=${selected.size}`);
    scroller0.scrollTop = 0;
    await sleep(250);
    check(
      '回到顶部仍选中',
      grid.querySelector('.card[data-index="0"]').classList.contains('selected'),
      'ok'
    );
    selected.clear();
    paintSelection();
    cursor = 0;
    paintCursor();
    await press('pagedown');
    check('PageDown 后光标可见', cursor > 0 && !!grid.querySelector(`.card[data-index="${cursor}"]`), `cursor=${cursor}`);
    cursor = 0;
    ensureCursorVisible();

    selected.add(shownItems[0].sha);
    paintSelection();
    cursor = shownItems.length - 1;
    scroller0.scrollTop = 0;
    await sleep(120);
    updateBatchDock();
    check('光标在栏下但不可见时不避让', !$('batchbar').classList.contains('docked'), 'normal');
    scroller0.scrollTop = scroller0.scrollHeight;
    await sleep(300);
    updateBatchDock();
    check(
      '滚到底必须避让',
      $('batchbar').classList.contains('docked'),
      `${scroller0.scrollTop}/${scroller0.scrollHeight}`
    );
    cursor = 0;
    ensureCursorVisible();
    await sleep(300);
    updateBatchDock();
    check('批量栏回顶部复位', !$('batchbar').classList.contains('docked'), 'normal');
    selected.clear();
    paintSelection();

    if (!selectionMode) $('select-mode').click();
    await sleep(100);
    check(
      '点按钮进入多选模式',
      selectionMode && $('select-mode').textContent.includes('退出多选'),
      `${selectionMode}/${$('select-mode').textContent}`
    );
    scroller0.scrollTop = Math.min(scroller0.scrollHeight, scroller0.scrollTop + 400);
    await sleep(220);
    check('滚动不退出多选', selectionMode, `mode=${selectionMode}`);
    $('select-mode').click();
    await sleep(100);
    check('再点退出多选', !selectionMode, `mode=${selectionMode}`);

    virtualize = false;
    await refresh();
    check('关闭虚拟滚动后全量渲染', !grid.classList.contains('virtual') && grid.children.length === shownItems.length, `cards=${grid.children.length}`);
    virtualize = true;
    await refresh();
    check('重新开启虚拟滚动', grid.classList.contains('virtual'), 'ok');

    await openSettings();
    await sleep(250);
    const bl = $('p-blacklist');
    const themeSel = $('set-theme');
    themeSel.value = 'catppuccin-mocha';
    themeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    check('Catppuccin Mocha 生效', bg.toLowerCase() === '#1e1e2e', bg);
    await loadThemes();
    fillThemeOptions();
    themeSel.value = 'accept-theme';
    themeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    const customBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    check('自定义 JSON 主题生效', customBg.toLowerCase() === '#123456', customBg);

    themeSel.value = 'dark';
    themeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(80);

    check('黑名单默认有 Snipaste', !!bl && [...bl.querySelectorAll('.chip')].some((c) => c.textContent.toLowerCase().includes('snipaste')), bl ? bl.textContent.trim() : 'missing');
    $('set-close').click();
    await sleep(250);

    const srcStats = await invoke('source_stats');
    const localEntries = srcStats.filter((x) => x.label === '本地导入');
    check('本地导入来源合并为一条', localEntries.length === 1, JSON.stringify(srcStats));

    assetFilters.maxBytes = 1; // 1 字节，任何图都大于它
    await refresh();
    check('大小筛选生效', shownItems.length === 0, `n=${shownItems.length}`);
    await clearFilters();
    check('清空筛选恢复', shownItems.length > 0, `n=${shownItems.length}`);

    // 格式筛选（走 UI）
    await openFilterPanel();
    const gifBox = document.querySelector('.f-ext[data-ext="gif"]');
    gifBox.click();
    $('f-apply').click();
    await sleep(300);
    check(
      '筛选 GIF 生效',
      shownItems.length === 1 && shownItems[0].ext === 'gif',
      `n=${shownItems.length} group=${currentGroup} q=${qInput.value} f=${JSON.stringify(assetFilters)}`
    );
    const direct = await invoke('list_assets', {
      q: '',
      group: null,
      limit: 1000,
      filters: JSON.stringify({ exts: ['gif'] }),
    });
    check('后端直接筛选 GIF', direct.length === 1, `n=${direct.length}`);
    check('筛选状态快照', true, JSON.stringify(assetFilters));
    check('筛选按钮高亮', $('filter-btn').classList.contains('active'));
    await clearFilters();
    check('清空筛选恢复', shownItems.length > 1, `n=${shownItems.length}`);
    check('筛选按钮恢复', !$('filter-btn').classList.contains('active'));

    // 筛选面板（新版 chip / 徽标 / 关闭）
    await openFilterPanel();
    const pngChip = document.querySelector('#f-exts .fp-chip[data-ext="png"]');
    pngChip.click();
    check(
      '筛选 chip 可点选',
      pngChip.classList.contains('on') && !$('fp-active').hidden,
      `badge=${$('fp-active').textContent}`
    );
    pngChip.click();
    check('筛选 chip 可取消', !pngChip.classList.contains('on'));
    $('fp-close').click();
    await sleep(60);
    check('筛选面板关闭按钮可用', $('filter-panel').hidden);

    // 标签筛选
    await invoke('batch_tags', { shas: [shownItems[0].sha], tags: ['验收标签'] });
    await loadGroups();
    await openFilterPanel();
    const tagInput = $('f-tags').querySelector('.picker-input');
    tagInput.focus();
    tagInput.value = '验收标签';
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(60);
    check('标签选项存在', panelTagSet.has('验收标签'), [...panelTagSet].join(','));
    $('f-apply').click();
    await sleep(300);
    check('标签筛选生效', shownItems.length === 1, `n=${shownItems.length}`);
    await clearFilters();

    // 日期筛选
    await openFilterPanel();
    $('f-from').value = '2099-01-01';
    $('f-apply').click();
    await sleep(300);
    check('日期筛选生效', shownItems.length === 0, `n=${shownItems.length}`);
    await clearFilters();
    check('再次清空恢复', shownItems.length > 1, `n=${shownItems.length}`);

    const cols = gridCols();
    await press('j');
    check(
      'j 向下移动一行',
      cursor === Math.min(shownItems.length - 1, cols),
      `cursor=${cursor} n=${shownItems.length}`
    );

    await press('x');
    check('x 选中一张', selected.size === 1, `selected=${selected.size}`);
    await press('x');
    check('x 再按取消选中', selected.size === 0, `selected=${selected.size}`);

    await press('g');
    await press('g');
    await press('v');
    await press('l');
    await press('v');
    check('v 锚点区间选中两张', selected.size === 2, `selected=${selected.size}`);

    await press('Escape');
    check('Esc 清空选择', selected.size === 0, `selected=${selected.size}`);

    await press('a', { ctrlKey: true });
    check('Ctrl+A 全选', selected.size === shownItems.length, `selected=${selected.size}`);
    check('多选按钮变成退出多选', $('select-mode').textContent === '退出多选', $('select-mode').textContent);
    await press('Escape');
    check('Esc 退出多选', selected.size === 0 && $('select-mode').textContent === '多选');

    await press('/');
    check('/ 聚焦筛选', document.activeElement === qInput);
    qInput.blur();
    await sleep(60);

    check('大小写区分（G 与 g 不同）', !!keymap['G'] && !keymap['g'] && !!keymap['gg']);

    await press('g');
    check('g 触发 which-key', !$('whichkey').hidden);
    await press('g');
    check('gg 回到首行', cursor === 0, `cursor=${cursor}`);
    check('which-key 自动收起', $('whichkey').hidden);

    await press('?');
    check('? 打开速查', !$('help').hidden);
    await press('Escape');
    check('Esc 关闭速查', $('help').hidden);

    await press('PageDown');
    check('PageDown 翻页', cursor > 0, `cursor=${cursor}`);
    await press('g');
    await press('g');

    await press('2');
    await press('j');
    check('2j 一次走两行', cursor === Math.min(shownItems.length - 1, gridCols() * 2), `cursor=${cursor}`);
    await press('g');
    await press('g');

    await press('s');
    check('s 切换收藏', $('last-action').textContent.includes('收藏'), $('last-action').textContent);
    await press('s');

    await invoke('create_group', { name: '验收组' });
    await invoke('add_to_group', { shas: shownItems.slice(0, 3).map((a) => a.sha), group: '验收组' });
    await loadGroups();
    await selectGroup('验收组');
    check('进入验收组', currentGroup === '验收组', currentGroup);
    await press('g');
    await press('g');
    await press('v');
    await press('l');
    await press('v');
    check('y 之前有选中', selected.size === 2, `selected=${selected.size}`);
    await press('y');
    check('y 复制后自动退出多选', selected.size === 0, `selected=${selected.size}`);
    check('y 后出现高亮', grid.querySelectorAll('.card.flash').length > 0, `flash=${grid.querySelectorAll('.card.flash').length}`);
    await press('p');
    check('p 触发粘贴/移动', /移动|复制/.test($('last-action').textContent), $('last-action').textContent);
    await selectGroup('__all__');

    await selectGroup('__all__');
    await press('g');
    await press('g');
    await press('v');
    await press('l');
    await press('v');
    await press('y');
    await invoke('create_group', { name: '空组验收' });
    await loadGroups();
    await selectGroup('空组验收');
    check('进入空分组', currentGroup === '空组验收' && grid.children.length === 0, `n=${grid.children.length}`);
    await press('p');
    await sleep(250);
    const gs = await invoke('group_stats');
    const emptyGroup = gs.groups.find((g) => g.name === '空组验收');
    check('空分组可粘贴', !!emptyGroup && emptyGroup.count === 2, emptyGroup ? `count=${emptyGroup.count}` : 'no group');

    await selectGroup('__all__');
    await invoke('batch_delete', { shas: shownItems.slice(0, 2).map((a) => a.sha) });
    await selectGroup('__trash__');
    check('回收站有内容', trashItems.length > 0, `n=${trashItems.length}`);
    await press('x');
    check('回收站可勾选', trashSelected.size === 1, `sel=${trashSelected.size}`);
    await press('q');
    check('q 退出回收站多选', trashSelected.size === 0 && $('trashbar').hidden, `sel=${trashSelected.size}`);

    assetFilters.maxBytes = 1;
    await refresh();
    check('回收站也受筛选', trashItems.length === 0, `n=${trashItems.length}`);
    await clearFilters();
    check('回收站清空筛选恢复', trashItems.length > 0, `n=${trashItems.length}`);
    await selectGroup('__all__');

    await openSettings();
    await sleep(120);
    send('Escape');
    await sleep(80);
    check('设置界面不吃 Esc', !$('settings').hidden);
    applySettingsTab('appearance');
    check(
      '设置分页能过滤行',
      [...document.querySelectorAll('#tab-general .set-row')].some((r) => r.hidden),
      'hidden rows'
    );
    applySettingsTab('general');
    $('settings').hidden = true;

    buildKeymap({ down: ['n'] });
    await press('n');
    check('改键 n 立即生效', cursor === Math.min(shownItems.length - 1, gridCols()), `cursor=${cursor}`);
    buildKeymap(userKeymap);

    await invoke('patch_settings', { patch: { selftestFlag: 42 } });
    const st = await invoke('get_settings');
    check('设置写入并可读回', st.selftestFlag === 42, `flag=${st.selftestFlag}`);

    await selectGroup('__star__');
    check('切到收藏', currentGroup === '__star__', currentGroup);
    await selectGroup('__trash__');
    check('切到回收站', currentGroup === '__trash__', currentGroup);
    await selectGroup('__all__');
    check('切回全部', currentGroup === '__all__' && grid.children.length > 0, currentGroup);

    const item = shownItems[0];
    if (item) {
      openEditor(item);
      await sleep(140);
      const before = document.activeElement;
      send('Escape');
      await sleep(80);
      check('编辑弹窗失焦', document.activeElement.tagName !== 'INPUT', document.activeElement.tagName + ':' + (document.activeElement.id || ''));
      check('编辑弹窗进入字段导航', document.querySelectorAll('#editor .field.nav').length === 1, 'nav=' + document.querySelectorAll('#editor .field.nav').length);
      check('编辑弹窗可聚焦项', editorFocusables().length > 1, 'n=' + editorFocusables().length);
      send('j');
      await sleep(80);
      const after1 = document.activeElement;
      send('j', { ctrlKey: true });
      await sleep(80);
      check(
        '编辑弹窗 Ctrl+J 移动焦点',
        document.activeElement !== after1,
        (after1.id || after1.tagName) + ' -> ' + (document.activeElement.id || document.activeElement.tagName)
      );
      closeEditor();
      await sleep(80);
      check('编辑弹窗可关闭', $('editor').hidden);
    } else {
      check('编辑弹窗跳过（无卡片）', true, 'no items');
    }

    check('清空选择后批量栏隐藏', $('batchbar').hidden === true);

    // 批量编辑面板（编辑标签）
    if (shownItems.length >= 2) {
      selected = new Set(shownItems.slice(0, 2).map((a) => a.sha));
      paintSelection();
      openBatchPanel('tag');
      await sleep(150);
      const bp = document.querySelector('.bpanel');
      check('编辑标签面板可打开', !!bp && bp.querySelector('.bp-title').textContent === '编辑标签');
      const bpRow = bp && [...bp.querySelectorAll('.bp-row')].find((r) => !r.classList.contains('bp-new'));
      const bpName = bpRow ? bpRow.querySelector('.bp-name').textContent : '';
      const countOf = async (name) => {
        const rows = (await invoke('tag_stats')) || [];
        const hit = rows.find((t) => t.name === name);
        return hit ? hit.count : 0;
      };
      const before = bpName ? await countOf(bpName) : 0;
      if (bpRow) bpRow.click();
      await sleep(500);
      const after = bpName ? await countOf(bpName) : 0;
      check('点一行加入标签', !!bpName && after === before + 2, `${bpName}: ${before} -> ${after}`);
      const bpRow2 = [...document.querySelectorAll('.bpanel .bp-row')].find(
        (r) => r.querySelector('.bp-name').textContent === bpName
      );
      check('行状态变成已加', !!bpRow2 && bpRow2.classList.contains('on'), bpRow2 ? bpRow2.className : 'none');
      if (bpRow2) bpRow2.click();
      await sleep(500);
      const back = bpName ? await countOf(bpName) : 0;
      check('再点一行移出标签', back === before, `${bpName}: ${after} -> ${back}`);
      closeBatchPanel();
      check('编辑面板可关闭', !document.querySelector('.bpanel'));
      clearSelection();
      paintSelection();
    } else {
      check('编辑标签面板跳过（卡片不足）', true, 'no items');
    }

    // 单图面板（从编辑弹窗进）与只读 chip
    if (shownItems.length) {
      const one = shownItems[0];
      openEditor(one);
      await sleep(200);
      const chipCount = document.querySelectorAll('#e-tags .chip').length;
      check('编辑弹窗只读标签 chip', chipCount === (one.tags || []).length, `chips=${chipCount}`);
      check('编辑弹窗有编辑标签按钮', !!$('e-tags-btn') && !$('e-tags-btn').hidden);
      openBatchPanel('tag', { sha: one.sha, name: one.name });
      await sleep(150);
      const bp1 = document.querySelector('.bpanel');
      const scope = bp1 ? bp1.querySelector('.bp-scope').textContent : '';
      check('单图面板标出名与张数', scope.includes(one.name) && scope.includes('1 张'), scope);
      const onRow = bp1 && [...bp1.querySelectorAll('.bp-row')].find((r) => r.classList.contains('on'));
      check('单图面板已加的标签显示已加', !!(one.tags || []).length === !!onRow, onRow ? 'has row' : 'no row');
      closeBatchPanel();
      closeEditor();
      await sleep(100);
      check('编辑弹窗可关闭后再无面板', $('editor').hidden && !document.querySelector('.bpanel'));
    } else {
      check('单图面板跳过（无卡片）', true, 'no items');
    }

    // 标签管理（用后端真值做基准，tagRows 可能还没刷过）
    const tagsBefore = (await invoke('tag_stats')).length;
    await openTagManage();
    await sleep(150);
    check('标签管理可打开', !$('tagmanage').hidden, `rows=${tagRows.length}`);
    await tmCreate('验收标签');
    await sleep(200);
    check('新建标签入库', tagRows.some((t) => t.name === '验收标签'), `n=${tagRows.length}`);
    // 行内编辑：点 ✎ → 出现 ✓ 保存按钮 → 改完点 ✓ 生效
    const row0 = [...document.querySelectorAll('#tm-list .tm-row')].find((r) => r.dataset.tag === '验收标签');
    if (row0) row0.querySelector('[data-act="tm-rename"]').click();
    await sleep(80);
    const editRow = document.querySelector('#tm-list .tm-row.editing');
    const saveBtn = editRow && editRow.querySelector('[data-act="tm-save"]');
    check('行内编辑有保存按钮', !!saveBtn);
    if (editRow && saveBtn) {
      const inp = editRow.querySelector('.tm-in');
      inp.value = '验收标签2';
      saveBtn.click();
      await sleep(220);
    }
    check(
      '重命名标签生效',
      tagRows.some((t) => t.name === '验收标签2') && !tagRows.some((t) => t.name === '验收标签'),
      tagRows.map((t) => t.name).join(',')
    );
    const delPromise = tmDelete('验收标签2');
    await sleep(200);
    $('confirm-ok').click();
    await delPromise;
    await sleep(250);
    check('删除标签生效', !tagRows.some((t) => t.name === '验收标签2'), `n=${tagRows.length}`);
    const afterStats = await invoke('tag_stats');
    check(
      '标签数回到初始',
      !afterStats.some((t) => t.name.startsWith('验收标签')) && tagRows.length === afterStats.length,
      `stats=${afterStats.length} rows=${tagRows.length} before=${tagsBefore}`
    );
    closeTagManage();
    check('标签管理可关闭', $('tagmanage').hidden);

    // 筛选面板的「管理」入口：进去收面板，出来再放回来
    openFilterPanel();
    await sleep(120);
    $('f-tags-manage').click();
    await sleep(200);
    check('筛选面板可进标签管理', !$('tagmanage').hidden && $('filter-panel').hidden);
    closeTagManage();
    await sleep(120);
    check('关标签管理回到筛选面板', !$('filter-panel').hidden && $('tagmanage').hidden);
    closeFilterPanel();

    // 卡片右键菜单：右键出菜单、多选只留批量项、双击开编辑、mouse3 不再绑编辑
    const card0 = grid.querySelector('.card[data-index="0"]');
    if (card0) {
      card0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }));
      await sleep(80);
      check('右键弹出卡片菜单', !$('cardmenu').hidden);
      const vis = [...document.querySelectorAll('#cardmenu [data-cm]')].filter((b) => !b.hidden);
      check('菜单默认含编辑与单图项', vis.some((b) => b.dataset.cm === 'edit') && vis.length >= 8, `n=${vis.length}`);
      closeCardMenu();
      await sleep(60);
      check('菜单可关闭', $('cardmenu').hidden);

      card0.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(200);
      check('双击打开编辑弹窗', !$('editor').hidden);
      closeEditor();
      await sleep(120);

      // 单击防抖：双击（第二次 click detail=2）不该写剪贴板；单点要等 260ms 才复制
      const hits0 = copyHits;
      card0.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      await sleep(80);
      card0.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      await sleep(320);
      check('双击不触发复制', copyHits === hits0, `delta=${copyHits - hits0}`);
      card0.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      await sleep(420);
      check('单击延迟后复制一次', copyHits === hits0 + 1, `delta=${copyHits - hits0}`);

      const before = [...document.querySelectorAll('#cardmenu [data-cm][hidden]')].length;
      selected = new Set(shownItems.slice(0, 2).map((x) => x.sha));
      paintSelection();
      openCardMenu(shownItems[0], 300, 200);
      await sleep(60);
      const editBtn = document.querySelector('#cardmenu [data-cm="edit"]');
      const copyBtn = document.querySelector('#cardmenu [data-cm="copyfile"]');
      check('多选时藏掉单图项', editBtn.hidden && !copyBtn.hidden, `hidden_before=${before}`);
      closeCardMenu();
      clearSelection();
      check('mouse3 不再绑编辑', !(mergedKeymap().edit || []).includes('mouse3'));
    } else {
      check('右键菜单跳过（无卡片）', true, 'no items');
    }

    await invoke('create_tag', { name: '合并A' });
    await invoke('create_tag', { name: '合并B' });
    await reloadTagRows();
    await openTagManage();
    await sleep(120);
    const rowA = [...document.querySelectorAll('#tm-list .tm-row')].find((r) => r.dataset.tag === '合并A');
    if (rowA) rowA.querySelector('[data-act="tm-merge"]').click();
    await sleep(150);
    check('合并弹窗打开', !$('tagmerge').hidden);
    const radio = [...document.querySelectorAll('#tg-merge-list input')].find((i) => i.value === '合并B');
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(80);
    check('选中目标后可合并', !$('tg-merge-ok').disabled);
    $('tg-merge-ok').click();
    await sleep(350);
    check(
      '合并后源标签消失',
      !tagRows.some((t) => t.name === '合并A') && tagRows.some((t) => t.name === '合并B'),
      tagRows.map((t) => t.name).join(',')
    );
    await invoke('delete_tag', { name: '合并B' });
    await reloadTagRows();
    closeTagManage();
  } catch (err) {
    check('自测执行异常', false, err && err.stack ? err.stack : String(err));
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  try {
    await invoke('selftest_report', { report: { passed, failed, checks } });
  } catch (e) {
    console.error('写入自测报告失败', e);
  }
  document.title = failed ? `SELFTEST FAIL ${failed}` : 'SELFTEST PASS';
}

// 启动
window.addEventListener('error', (e) => {
  try {
    invoke('js_log', { msg: `${e.message} @ ${e.filename}:${e.lineno}` });
  } catch (_) {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    invoke('js_log', { msg: 'rejection: ' + String(e.reason && (e.reason.stack || e.reason)) });
  } catch (_) {}
});

(async () => {
  paintIcons();
  paintSelectMode();
  enhanceNumberInputs();
  if (!Object.keys(keymap).length) buildKeymap({});
  await syncSettings();
  await syncClipButton();
  showFooterTip();
  syncClear();
  await Promise.all([refresh(), loadGroups(), showStats()]);

  const resolved = resolveStartView();
  if (resolved !== '__all__') await selectGroup(resolved);

  const selftest = await invoke('selftest_mode').catch(() => '');
  if (selftest === 'accept') {
    await new Promise((r) => setTimeout(r, 500));
    await runAcceptSuite();
  }
  if (selftest === 'perf') {
    await runPerfSuite();
  }

  const ui = await invoke('ui_state').catch(() => '');
  if (ui.startsWith('settings')) {
    await openSettings();
    applySettingsTab(ui.split(':')[1] || 'general');
  }
  if (ui === 'whichkey') {
    keyBuffer = 'g';
    showWhichKey('g');
  }
  if (ui === 'help') openHelp();
  if (ui === 'tagmanage' || ui === 'tagmanage:actions' || ui === 'tagmanage:edit') {
    await openTagManage();
    if (ui.endsWith(':actions')) {
      document.querySelectorAll('#tagmanage .tm-acts').forEach((el) => (el.style.opacity = '1'));
    }
    if (ui.endsWith(':edit') && tagRows[0]) {
      tmEditing = tagRows[0].name;
      renderTagManage();
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (ui.startsWith('theme:')) {
    await loadThemes();
    theme = ui.split(':')[1];
    applyTheme(theme);
  }
  if (ui === 'settings:selects') {
    await openSettings();
    await new Promise((r) => setTimeout(r, 300));
    const row = [...document.querySelectorAll('#settings .set-row')].find((r) =>
      r.textContent.includes('单击复制为')
    );
    if (row) row.scrollIntoView({ block: 'center' });
    const b = row && row.querySelector('.sel-btn');
    if (b) b.click();
  }
  if (ui === 'settings:theme') {
    await openSettings();
    applySettingsTab('appearance');
    await new Promise((r) => setTimeout(r, 300));
    const row = [...document.querySelectorAll('#settings .set-row')].find((r) =>
      r.textContent.includes('主题')
    );
    if (row) row.scrollIntoView({ block: 'center' });
    const b = row && row.querySelector('.sel-btn');
    if (b) b.click();
  }
  if (ui === 'settings:blacklist') {
    await openSettings();
    await new Promise((r) => setTimeout(r, 300));
    const row = $('p-blacklist');
    if (row) row.scrollIntoView({ block: 'center' });
  }
  if (ui === 'filters') openFilterPanel();
  if (ui === 'filters:on') {
    await openFilterPanel();
    document.querySelector('#f-exts .fp-chip[data-ext="gif"]')?.click();
    document.querySelector('#f-presets .fp-chip[data-pre="w1"]')?.click();
    const mbIn = $('f-min-mb');
    mbIn.value = '0.5';
    mbIn.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (ui === 'filters:bottom') {
    await openFilterPanel();
    await new Promise((r) => setTimeout(r, 200));
    const b = $('filter-panel').querySelector('.fp-body');
    if (b) b.scrollTop = 9999;
  }
  if (ui === 'filters-tag') {
    await openFilterPanel();
    await new Promise((r) => setTimeout(r, 300));
    const ti = $('f-tags').querySelector('.picker-input');
    if (ti) {
      ti.focus();
      ti.value = '浏';
      ti.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  if (ui === 'filters-source') {
    openFilterPanel();
    setTimeout(() => {
      const b = document.querySelector('.source-btn');
      if (b) b.click();
    }, 300);
  }
  if (ui === 'editor-all') {
    selectGroup('__all__');
    await new Promise((r) => setTimeout(r, 400));
    const t = shownItems.find((x) => x.groups && x.groups.length) || shownItems[0];
    if (t) openEditor(t);
  }
  if (ui === 'dock') {
    selected = new Set(shownItems.slice(0, 2).map((a) => a.sha));
    paintSelection();
    cursor = shownItems.length - 1;
    const sc = document.querySelector('main');
    sc.scrollTop = sc.scrollHeight;
    setTimeout(updateBatchDock, 150);
  }
  if (ui === 'batch') {
    if (shownItems.length) {
      selected = new Set(shownItems.slice(0, 2).map((a) => a.sha));
      paintSelection();
      openBatchPanel('tag');
    }
  }
  if (ui === 'batchgroup') {
    if (shownItems.length) {
      selected = new Set(shownItems.slice(0, 2).map((a) => a.sha));
      paintSelection();
      openBatchPanel('group');
    }
  }
  if (ui === 'editor' && shownItems[0]) {
    openEditor(shownItems[0]);
    await new Promise((r) => setTimeout(r, 300));
  }
  if (ui === 'editorpanel' && shownItems[0]) {
    openEditor(shownItems[0]);
    await new Promise((r) => setTimeout(r, 250));
    openBatchPanel('tag', { sha: shownItems[0].sha, name: shownItems[0].name, onClose: reloadEditing });
  }
  if (ui === 'editorpanelgroup' && shownItems[0]) {
    openEditor(shownItems[0]);
    await new Promise((r) => setTimeout(r, 250));
    openBatchPanel('group', { sha: shownItems[0].sha, name: shownItems[0].name, onClose: reloadEditing });
  }
  if (ui === 'cardmenu' && shownItems[0]) {
    const el = grid.querySelector('.card[data-index="0"]');
    const r = el ? el.getBoundingClientRect() : { left: 320, top: 200 };
    openCardMenu(shownItems[0], r.left + 60, r.top + 40);
  }
  if (ui === 'cardmenubatch' && shownItems.length) {
    selected = new Set(shownItems.slice(0, 3).map((a) => a.sha));
    paintSelection();
    const el = grid.querySelector('.card[data-index="1"]');
    const r = el ? el.getBoundingClientRect() : { left: 620, top: 200 };
    openCardMenu(shownItems[1], r.left + 60, r.top + 40);
  }
})();





