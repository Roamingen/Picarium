/* StickerBox 字体配置（PC 与快贴面板共用）
 * 只描述“选了什么”，不直接碰 DOM；应用样式由 app.js / panel.html 完成。
 * 存储结构：settings.json 的 fonts[role] = { latin, cjk, fallbacks, size, line, weight, letter, features, follow }
 */
(function () {
  'use strict';

  const ROLES = [
    { id: 'ui', name: '界面', desc: '侧栏 / 按钮 / 搜索 / 设置' },
    { id: 'list', name: '列表与卡片', desc: '悬停信息 / 标题 / 标签', follow: true },
    { id: 'panel', name: '快贴面板', desc: '搜索框 / 底栏 / 计数', follow: true },
    { id: 'mono', name: '等宽', desc: '快捷键 / 路径 / 尺寸' },
  ];

  const ROLE_IDS = ['ui', 'list', 'panel', 'mono'];
  const MAX_FALLBACKS = 5;
  const SIZE_MIN = 11;
  const SIZE_MAX = 20;
  const LINE_MIN = 1.2;
  const LINE_MAX = 2.0;

  const BASE = {
    latin: 'Segoe UI',
    cjk: 'Microsoft YaHei UI',
    fallbacks: [],
    size: 13,
    line: 1.5,
    weight: 400,
    letter: 0,
    features: '',
  };

  const DEFAULTS = {
    ui: clone(BASE),
    list: Object.assign(clone(BASE), { follow: true }),
    panel: Object.assign(clone(BASE), { follow: true }),
    mono: Object.assign(clone(BASE), {
      latin: 'Cascadia Code',
      size: 12,
      line: 1.4,
      features: 'calt, liga',
    }),
  };

  const GENERIC = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
    'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
    'emoji', 'math', 'fangsong',
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function num(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function round(n, step) {
    return Math.round(n / step) * step;
  }

  function normalize(raw) {
    const out = clone(DEFAULTS);
    const roles = raw && typeof raw === 'object' && raw.roles && typeof raw.roles === 'object'
      ? raw.roles
      : (raw && typeof raw === 'object' ? raw : {});

    for (const id of ROLE_IDS) {
      const src = roles[id];
      if (!src || typeof src !== 'object') continue;
      const dst = out[id];

      if (id === 'list' || id === 'panel') dst.follow = src.follow !== false;
      dst.latin = text(src.latin, DEFAULTS[id].latin);
      dst.cjk = text(src.cjk, DEFAULTS[id].cjk);
      if (Array.isArray(src.fallbacks)) {
        const seen = new Set();
        dst.fallbacks = [];
        for (const item of src.fallbacks) {
          if (typeof item !== 'string') continue;
          const name = item.trim();
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          dst.fallbacks.push(name);
          if (dst.fallbacks.length >= MAX_FALLBACKS) break;
        }
      }
      dst.size = round(num(src.size, DEFAULTS[id].size, SIZE_MIN, SIZE_MAX), 0.5);
      dst.line = round(num(src.line, DEFAULTS[id].line, LINE_MIN, LINE_MAX), 0.05);
      dst.weight = Math.round(num(src.weight, DEFAULTS[id].weight, 300, 700) / 100) * 100;
      dst.letter = round(num(src.letter, DEFAULTS[id].letter, -0.5, 2), 0.05);
      dst.features = typeof src.features === 'string' ? src.features.trim() : '';
    }

    // ui 是其他角色的跟随时基，必须始终有可用值。
    if (!out.ui.latin) out.ui.latin = DEFAULTS.ui.latin;
    if (!out.ui.cjk) out.ui.cjk = DEFAULTS.ui.cjk;
    return out;
  }

  function effective(fonts, id) {
    const all = fonts && fonts.roles ? fonts : normalize(fonts);
    if (id === 'list' || id === 'panel') {
      if (all[id].follow) return all.ui;
    }
    return all[id] || all.ui;
  }

  function quote(name) {
    const value = String(name || '').trim();
    if (!value) return '';
    if (GENERIC.has(value.toLowerCase())) return value;
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function stack(fonts, id) {
    const e = effective(fonts, id);
    const names = [e.latin, e.cjk].concat(e.fallbacks || []);
    const seen = new Set();
    const families = [];
    for (const name of names) {
      const value = String(name || '').trim();
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      families.push(quote(value));
    }
    if (id === 'mono') families.push('monospace');
    families.push('system-ui', 'sans-serif');
    return families.join(', ');
  }

  function summary(fonts, id) {
    const e = effective(fonts, id);
    const short = (name) => {
      const value = String(name || '');
      return value.length > 18 ? value.slice(0, 17) + '…' : value;
    };
    return short(e.latin || '系统默认') + ' / ' + short(e.cjk || '系统默认') + ' · ' + e.size + 'px';
  }

  function role(id) {
    return ROLES.find((item) => item.id === id) || ROLES[0];
  }

  window.SBFonts = {
    ROLES,
    ROLE_IDS,
    MAX_FALLBACKS,
    SIZE_MIN,
    SIZE_MAX,
    LINE_MIN,
    LINE_MAX,
    DEFAULTS,
    normalize,
    effective,
    stack,
    quote,
    summary,
    role,
  };
})();
