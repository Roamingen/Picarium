/* Picarium 安卓字体页
 * 3 档：界面 / 列表与卡片 / 详情与浮层；本批只列 4 个系统通用族。
 * 字体文件导入留到下一批，所以「导入」分组暂时为空。
 */
(function () {
  'use strict';

  const F = window.SBFonts;
  if (!F) return;

  const $ = (id) => document.getElementById(id);
  const T = window.__TAURI__ || {};
  const invoke = T.core ? T.core.invoke : null;
  const LS_KEY = 'sb.fonts';
  const ROLE_IDS = ['ui', 'list', 'detail'];

  const PRESETS = [
    { id: 'default', name: '默认', size: 14, line: 1.5 },
    { id: 'compact', name: '紧凑', size: 13, line: 1.35 },
    { id: 'large', name: '大字', size: 16, line: 1.6 },
  ];

  const SYSTEM_FONTS = [
    { id: 'sans-serif', name: 'Sans Serif', sub: '系统默认无衬线', cjk: true, tags: ['系统', '中文'] },
    { id: 'serif', name: 'Serif', sub: '系统衬线', cjk: true, tags: ['系统', '中文'] },
    { id: 'monospace', name: 'Monospace', sub: '系统等宽', cjk: true, tags: ['系统', '中文'] },
    { id: 'sans-serif-condensed', name: 'Sans Serif Condensed', sub: '系统窄体', cjk: true, tags: ['系统', '中文'] },
  ];

  let saved = null;
  let draft = null;
  let mode = 'overview';
  let activeRole = 'ui';
  let picker = null;
  let loadPromise = null;
  let busy = false;
  let bound = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function escAttr(value) {
    return esc(value).replace(/`/g, '&#96;');
  }

  function notify(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log(msg);
  }

  function roleInfo(id) {
    return F.roleMobile(id);
  }

  function fontInfo(id) {
    return SYSTEM_FONTS.find((f) => f.id === id) || {
      id, name: id || '未设置', sub: '字体', cjk: false, tags: [],
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function call(cmd, args) {
    if (!invoke) throw new Error('没有连上 Tauri 内核');
    for (let i = 0; i < 25; i++) {
      try {
        return await invoke(cmd, args);
      } catch (e) {
        if (i < 24 && /not managed/i.test(String(e))) {
          await sleep(120);
          continue;
        }
        throw e;
      }
    }
  }

  function readLocal() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  async function loadSaved() {
    let raw = null;
    if (invoke) {
      try {
        const s = await call('get_settings');
        raw = s && s.fonts;
      } catch (e) {
        console.warn('读取字体设置失败', e);
      }
    }
    if (!raw) raw = readLocal();
    return F.normalizeMobile(raw);
  }

  async function persist(fonts) {
    if (!invoke) {
      localStorage.setItem(LS_KEY, JSON.stringify(fonts));
      return;
    }
    await call('set_fonts', { fonts });
  }

  function ensureLoaded() {
    if (saved) return Promise.resolve(saved);
    if (!loadPromise) {
      loadPromise = loadSaved()
        .then((s) => {
          saved = s;
          draft = clone(s);
          apply(s);
          renderEntry();
          return s;
        })
        .catch((e) => {
          console.warn('字体设置初始化失败', e);
          saved = F.normalizeMobile(null);
          draft = clone(saved);
          apply(saved);
          renderEntry();
          return saved;
        });
    }
    return loadPromise;
  }

  function apply(fonts) {
    const root = document.documentElement;
    for (const id of ROLE_IDS) {
      const e = F.effectiveMobile(fonts, id);
      root.style.setProperty(`--font-${id}`, F.stackMobile(fonts, id));
      root.style.setProperty(`--font-${id}-size`, `${e.size}px`);
      root.style.setProperty(`--font-${id}-line`, String(e.line));
      root.style.setProperty(`--font-${id}-weight`, String(e.weight));
      root.style.setProperty(`--font-${id}-letter`, `${e.letter}px`);
      root.style.setProperty(`--font-${id}-features`, e.features || 'normal');
    }
  }

  function renderEntry() {
    const el = $('me-font');
    if (!el || !saved) return;
    el.textContent = F.summaryMobile(saved, 'ui');
  }

  function isOpen() {
    const mask = $('fontmask');
    return !!(mask && !mask.hidden);
  }

  function pickerOpen() {
    const mask = $('fontpickmask');
    return !!(picker && mask && !mask.hidden);
  }

  async function open() {
    await ensureLoaded();
    if (isOpen()) return;
    draft = clone(saved);
    mode = 'overview';
    activeRole = 'ui';
    $('fontmask').hidden = false;
    render();
  }

  function closePage() {
    const mask = $('fontmask');
    if (mask) mask.hidden = true;
    closePicker();
    mode = 'overview';
    activeRole = 'ui';
    if (saved) draft = clone(saved);
  }

  function isDirty() {
    if (!saved || !draft) return false;
    return JSON.stringify(F.normalizeMobile(draft)) !== JSON.stringify(F.normalizeMobile(saved));
  }

  async function requestClose() {
    if (!isDirty()) {
      closePage();
      return;
    }
    const ask = typeof window.confirmSheet === 'function'
      ? window.confirmSheet
      : (text) => Promise.resolve(window.confirm(text));
    const ok = await ask('放弃未保存的修改？', '字体设置');
    if (ok) closePage();
  }

  function back() {
    if (pickerOpen()) {
      closePicker();
      return true;
    }
    if (!isOpen()) return false;
    if (mode === 'editor') {
      mode = 'overview';
      activeRole = 'ui';
      render();
      return true;
    }
    requestClose();
    return true;
  }

  async function save() {
    if (busy || !draft) return;
    busy = true;
    const done = $('font-done');
    if (done) done.disabled = true;
    try {
      const fonts = F.normalizeMobile(draft);
      await persist(fonts);
      saved = clone(fonts);
      draft = clone(fonts);
      apply(saved);
      renderEntry();
      closePage();
      notify(invoke ? '字体设置已保存' : '字体设置已保存到本机');
    } catch (e) {
      notify('保存失败：' + (e && e.message ? e.message : e));
    } finally {
      busy = false;
      if (done) done.disabled = false;
    }
  }

  function renderPreview() {
    for (const [roleId, elId] of [['ui', 'fp-ui'], ['list', 'fp-list'], ['detail', 'fp-detail']]) {
      const el = $(elId);
      if (!el) continue;
      const e = F.effectiveMobile(draft, roleId);
      el.style.fontFamily = F.stackMobile(draft, roleId);
      el.style.fontSize = `${e.size}px`;
      el.style.lineHeight = String(e.line);
      el.style.fontWeight = String(e.weight);
      el.style.letterSpacing = `${e.letter}px`;
      el.style.fontFeatureSettings = e.features || 'normal';
    }
  }

  function renderEditSample() {
    if (!draft) return;
    const e = F.effectiveMobile(draft, activeRole);
    const text = $('font-sample-text');
    if (text) {
      text.style.fontFamily = F.stackMobile(draft, activeRole);
      text.style.fontSize = `${e.size}px`;
      text.style.lineHeight = String(e.line);
      text.style.fontWeight = String(e.weight);
      text.style.letterSpacing = `${e.letter}px`;
      text.style.fontFeatureSettings = e.features || 'normal';
    }
    const meta = $('font-sample-meta');
    if (meta) meta.textContent = `${e.size}px · 行高 ${Number(e.line).toFixed(2)}`;
  }

  function renderRoles() {
    const box = $('font-roles');
    if (!box) return;
    box.innerHTML = ROLE_IDS.map((id) => {
      const info = roleInfo(id);
      const following = id !== 'ui' && draft[id].follow;
      const icon = id === 'ui' ? 'Aa' : id === 'list' ? '≡' : '◇';
      const tag = id === 'ui'
        ? { text: '基础', cls: 'base' }
        : following
          ? { text: '跟随', cls: 'follow' }
          : { text: '单独', cls: 'own' };
      return `<button class="fontrole" data-role="${id}" title="${escAttr(info.desc)}">
        <span class="fr-ic" style="font-family:${escAttr(F.stackMobile(draft, id))}">${icon}</span>
        <span class="fr-main"><b>${esc(info.name)}<span class="fr-tag ${tag.cls}">${tag.text}</span></b><small>${esc(F.summaryMobile(draft, id))}</small></span>
        <svg class="fr-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button>`;
    }).join('');
  }

  function activePreset() {
    if (!draft) return '';
    const ui = draft.ui;
    const p = PRESETS.find((item) => Math.abs(ui.size - item.size) < 0.01 && Math.abs(ui.line - item.line) < 0.001);
    return p ? p.id : '';
  }

  function renderPresets() {
    const box = $('font-presets');
    if (!box) return;
    const active = activePreset();
    box.innerHTML = PRESETS.map((p) =>
      `<button data-preset="${p.id}" class="${active === p.id ? 'on' : ''}">${p.name}</button>`
    ).join('');
  }

  function renderTabs() {
    const box = $('font-tabs');
    if (!box) return;
    box.innerHTML = ROLE_IDS.map((id) => {
      const info = roleInfo(id);
      return `<button data-role="${id}" class="${activeRole === id ? 'on' : ''}">${esc(info.name)}</button>`;
    }).join('');
  }

  function renderFallbackChips(e, following) {
    const box = $('font-fallbacks');
    if (!box) return;
    if (!e.fallbacks || !e.fallbacks.length) {
      box.innerHTML = '<span class="fontnone">未设置，系统兜底永远在最后</span>';
      return;
    }
    box.innerHTML = e.fallbacks.map((name) => {
      const info = fontInfo(name);
      return `<span class="fontchip">${esc(info.name)}${following ? '' : `<button data-rm="${escAttr(name)}" aria-label="移除">×</button>`}</span>`;
    }).join('');
  }

  function renderEditor() {
    if (!draft) return;
    const info = roleInfo(activeRole);
    const role = draft[activeRole];
    const following = activeRole !== 'ui' && role.follow;
    const e = F.effectiveMobile(draft, activeRole);

    renderTabs();

    const followRow = $('font-follow-row');
    if (followRow) followRow.hidden = activeRole === 'ui';
    const follow = $('font-follow');
    if (follow) follow.checked = !!role.follow;
    const followLabel = $('font-follow-label');
    if (followLabel) followLabel.textContent = '跟随「界面」';

    const latin = $('font-latin');
    if (latin) latin.textContent = fontInfo(e.latin).name;
    const cjk = $('font-cjk');
    if (cjk) cjk.textContent = fontInfo(e.cjk).name;
    const fallback = $('font-fallback');
    if (fallback) fallback.textContent = e.fallbacks.length ? `${e.fallbacks.length} 个` : '未设置';

    const size = $('font-size');
    if (size) size.textContent = `${e.size}px`;
    const line = $('font-line');
    if (line) line.textContent = Number(e.line).toFixed(2);
    const weight = $('font-weight');
    if (weight) {
      weight.value = String(e.weight);
      weight.disabled = following;
    }
    for (const b of document.querySelectorAll('#font-editor [data-step]')) b.disabled = following;

    renderFallbackChips(e, following);

    const rows = $('font-edit-fields');
    if (rows) rows.classList.toggle('locked', following);
    const note = $('font-editor-note');
    if (note) {
      note.textContent = following
        ? '正在跟随「界面」；关掉上面的跟随后才能单独设置。'
        : activeRole === 'ui'
          ? '整页界面文字会即时预览，点「完成」保存。'
          : '只影响这一档，不会改动其它页面。';
    }
    const subtitle = $('font-head-sub');
    if (subtitle) subtitle.textContent = info.name;
    renderEditSample();
  }

  function render() {
    if (!draft) return;
    const preview = $('font-preview');
    if (preview) preview.hidden = mode !== 'overview';
    const sample = $('font-sample');
    if (sample) sample.hidden = mode !== 'editor';
    const overview = $('font-overview');
    const editor = $('font-editor');
    if (overview) overview.hidden = mode !== 'overview';
    if (editor) editor.hidden = mode !== 'editor';
    const subtitle = $('font-head-sub');
    if (subtitle) subtitle.textContent = mode === 'overview' ? '外观' : roleInfo(activeRole).name;
    renderPreview();
    if (mode === 'overview') {
      renderRoles();
      renderPresets();
    } else {
      renderEditor();
    }
  }

  function openEditor(roleId) {
    if (!draft || !ROLE_IDS.includes(roleId)) return;
    activeRole = roleId;
    mode = 'editor';
    render();
  }

  function openPicker(field) {
    if (!draft) return;
    if (activeRole !== 'ui' && draft[activeRole].follow) {
      notify('先关掉跟随，再单独设置这一档');
      return;
    }
    picker = {
      field,
      roleId: activeRole,
      filter: 'all',
      q: '',
      cjkOnly: true,
    };
    const title = $('fontpick-title');
    if (title) title.textContent = field === 'latin' ? '西文字体' : field === 'cjk' ? '中文字体' : '回退字体';
    const sub = $('fontpick-sub');
    if (sub) {
      sub.textContent = `${roleInfo(activeRole).name} · ${field === 'fallback' ? '最多 5 个' : '系统通用族'}`;
    }
    const q = $('fontpick-q');
    if (q) q.value = '';
    const only = $('fontpick-cjk-only');
    if (only) only.checked = true;
    const onlyRow = $('fontpick-only');
    if (onlyRow) onlyRow.hidden = field !== 'cjk';
    const mask = $('fontpickmask');
    if (mask) mask.hidden = false;
    renderPicker();
  }

  function closePicker() {
    const mask = $('fontpickmask');
    if (mask) mask.hidden = true;
    picker = null;
  }

  function pickerSelectedIds() {
    if (!picker || !draft) return [];
    const role = draft[picker.roleId];
    if (picker.field === 'fallback') return role.fallbacks || [];
    return [role[picker.field]];
  }

  function renderPicker() {
    if (!picker || !draft) return;
    const filters = $('fontpick-filters');
    if (filters) {
      for (const b of filters.querySelectorAll('button[data-filter]')) {
        b.classList.toggle('on', b.dataset.filter === picker.filter);
      }
    }
    const q = picker.q.trim().toLowerCase();
    let list = SYSTEM_FONTS.slice();
    if (picker.filter === 'imported') list = [];
    if (q) {
      list = list.filter((f) =>
        `${f.name} ${f.id} ${f.sub}`.toLowerCase().includes(q)
      );
    }
    if (picker.field === 'cjk' && picker.cjkOnly) list = list.filter((f) => f.cjk);

    const selected = pickerSelectedIds().map((x) => String(x).toLowerCase());
    const box = $('fontpick-list');
    if (box) {
      if (!list.length) {
        const text = picker.filter === 'imported'
          ? '还没有导入字体<br><small>字体文件导入下一批支持</small>'
          : '没有匹配的字体';
        box.innerHTML = `<div class="fontempty">${text}</div>`;
      } else {
        box.innerHTML = list.map((f) => {
          const on = selected.includes(f.id.toLowerCase());
          return `<button class="fontrow ${on ? 'on' : ''}" data-id="${escAttr(f.id)}">
            <span class="fontrow-sample" style="font-family:${escAttr(F.quote(f.id))}">Aa 字</span>
            <span class="fontrow-main"><b>${esc(f.name)}</b><small>${esc(f.sub)}</small></span>
            <span class="fontrow-tags">${f.tags.map((t) => `<em>${esc(t)}</em>`).join('')}</span>
            <span class="fontrow-check">${on ? '✓' : ''}</span>
          </button>`;
        }).join('');
      }
    }
    const note = $('fontpick-note');
    if (note) {
      note.textContent = picker.filter === 'imported'
        ? '字体文件导入下一批支持；这一批只列系统通用族。'
        : picker.field === 'fallback'
          ? '最多 5 个；系统兜底永远在最后。'
          : picker.field === 'cjk'
            ? '只列系统通用族；打开「只看含中文」会过滤掉不含中文的字体。'
            : '系统通用族由 Android WebView 解析，不需要下载字体。';
    }
  }

  function chooseFont(id) {
    if (!picker || !draft) return;
    const role = draft[picker.roleId];
    if (picker.field === 'fallback') {
      const idx = role.fallbacks.findIndex((x) => String(x).toLowerCase() === id.toLowerCase());
      if (idx >= 0) {
        role.fallbacks.splice(idx, 1);
      } else {
        if (role.fallbacks.length >= F.MAX_FALLBACKS) {
          notify(`最多 ${F.MAX_FALLBACKS} 个回退字体`);
          return;
        }
        role.fallbacks.push(id);
      }
      renderPicker();
      renderPreview();
      renderEditor();
      return;
    }
    role[picker.field] = id;
    closePicker();
    render();
  }

  function setPreset(id) {
    const p = PRESETS.find((item) => item.id === id);
    if (!p || !draft) return;
    for (const roleId of ROLE_IDS) {
      draft[roleId].size = p.size;
      draft[roleId].line = p.line;
    }
    render();
  }

  function step(field, delta) {
    if (!draft) return;
    if (activeRole !== 'ui' && draft[activeRole].follow) {
      notify('先关掉跟随，再单独设置这一档');
      return;
    }
    const role = draft[activeRole];
    if (field === 'size') {
      role.size = Math.min(F.MOBILE_SIZE_MAX, Math.max(F.MOBILE_SIZE_MIN, role.size + delta));
    } else if (field === 'line') {
      role.line = Math.round(Math.min(F.LINE_MAX, Math.max(F.LINE_MIN, role.line + delta)) * 100) / 100;
    }
    renderPreview();
    renderEditor();
  }

  function bindOnce() {
    if (bound) return;
    bound = true;

    const entry = $('me-font-row');
    if (entry) entry.addEventListener('click', open);
    const backBtn = $('font-back');
    if (backBtn) backBtn.addEventListener('click', back);
    const done = $('font-done');
    if (done) done.addEventListener('click', save);
    const roles = $('font-roles');
    if (roles) roles.addEventListener('click', (e) => {
      const b = e.target.closest('[data-role]');
      if (b) openEditor(b.dataset.role);
    });
    const tabs = $('font-tabs');
    if (tabs) tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-role]');
      if (!b) return;
      activeRole = b.dataset.role;
      render();
    });
    const presets = $('font-presets');
    if (presets) presets.addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]');
      if (b) setPreset(b.dataset.preset);
    });
    const follow = $('font-follow');
    if (follow) follow.addEventListener('change', () => {
      if (activeRole === 'ui' || !draft) return;
      if (follow.checked) {
        draft[activeRole].follow = true;
      } else {
        const ui = clone(draft.ui);
        draft[activeRole] = Object.assign({}, ui, { follow: false });
      }
      render();
    });
    const editor = $('font-editor');
    if (editor) editor.addEventListener('click', (e) => {
      const row = e.target.closest('[data-field]');
      if (row) {
        openPicker(row.dataset.field);
        return;
      }
      const stepBtn = e.target.closest('[data-step]');
      if (stepBtn) {
        const raw = stepBtn.dataset.step;
        const field = raw.slice(0, -1);
        const up = raw.endsWith('+');
        step(field, up ? (field === 'line' ? 0.05 : 1) : (field === 'line' ? -0.05 : -1));
        return;
      }
      const rm = e.target.closest('[data-rm]');
      if (rm && draft) {
        if (activeRole !== 'ui' && draft[activeRole].follow) return;
        const list = draft[activeRole].fallbacks;
        const idx = list.indexOf(rm.dataset.rm);
        if (idx >= 0) list.splice(idx, 1);
        renderPreview();
        renderEditor();
      }
    });
    const weight = $('font-weight');
    if (weight) weight.addEventListener('change', () => {
      if (!draft) return;
      if (activeRole !== 'ui' && draft[activeRole].follow) {
        notify('先关掉跟随，再单独设置这一档');
        renderEditor();
        return;
      }
      draft[activeRole].weight = Number(weight.value);
      renderPreview();
      renderEditSample();
    });

    const pickClose = $('fontpick-close');
    if (pickClose) pickClose.addEventListener('click', closePicker);
    const pickMask = $('fontpickmask');
    if (pickMask) pickMask.addEventListener('click', (e) => {
      if (e.target === pickMask) closePicker();
    });
    const filters = $('fontpick-filters');
    if (filters) filters.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b || !picker) return;
      picker.filter = b.dataset.filter;
      renderPicker();
    });
    const q = $('fontpick-q');
    if (q) q.addEventListener('input', () => {
      if (!picker) return;
      picker.q = q.value;
      renderPicker();
    });
    const only = $('fontpick-cjk-only');
    if (only) only.addEventListener('change', () => {
      if (!picker) return;
      picker.cjkOnly = only.checked;
      renderPicker();
    });
    const list = $('fontpick-list');
    if (list) list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (b) chooseFont(b.dataset.id);
    });
  }

  function init() {
    bindOnce();
    ensureLoaded();
  }

  window.SBFontMobile = {
    init,
    open,
    isOpen,
    pickerOpen,
    back,
    closePicker,
    renderEntry,
    apply,
  };
})();
