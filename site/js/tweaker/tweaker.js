/* ═══════════════════════════════════════════════════
   TWEAKER — in-app theme editor
   ───────────────────────────────────────────────────
   Activated via ?tweak=1 URL flag or localStorage.
   Lazy-loaded by bootstrap in site/index.html.

   Sections below (search for § to jump):
     §1  Config + constants
     §2  Dynamic library loader (esm.sh imports)
     §3  Token graph (scan :root, categorize, resolve element → tokens)
     §4  Selector generation
     §5  Contrast math (WCAG)
     §6  Element picker (hover + click + exclusion)
     §7  Live preview (setProperty + injected <style>)
     §8  History (undo/redo + localStorage session)
     §9  API client (theme-swatches, theme-review, theme-save)
     §10 React: AI swatch strip
     §11 React: Inspector panel (Colors / Typography / Box)
     §12 React: Review modal
     §13 React: Save modal
     §14 React: Tweaker root (mounting, mode toggle, keyboard)
     §15 Activation: wrench injection into nav, mode boot
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  const React = window.React;
  const ReactDOM = window.ReactDOM;
  if (!React || !ReactDOM) {
    console.error('[tweaker] React / ReactDOM not on window. Aborting.');
    return;
  }
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const h = React.createElement;

  // ══════════════════════════════════════════════════════════════════════════
  // §1 Config + constants
  // ══════════════════════════════════════════════════════════════════════════

  const CFG = {
    storageKey: 'journal:tweaker:session',
    modeKey: 'journal:tweaker:mode',
    scopedStyleId: 'tweaker-scoped-style',
    chromeAttr: 'data-tweak-chrome',
    highlightId: 'tweaker-hover-highlight',
    apiBase: (window.CLAUDE_API_BASE || '').replace(/\/$/, ''),
    themeStylesheetId: 'theme-stylesheet',
    navSelector: '.nav',
  };

  const TOKEN_CATEGORIES = [
    { id: 'surface', label: 'Surfaces',   match: /^(bg|panel|line|glass|bg-mesh)/ },
    { id: 'text',    label: 'Text',       match: /^(text|muted|contrast)/ },
    { id: 'border',  label: 'Borders',    match: /^border/ },
    { id: 'accent',  label: 'Accent',     match: /^(accent|rose|mauve|lavender|gold|wisteria|blush)/ },
    { id: 'state',   label: 'State',      match: /^(success|warning|error|info|state-)/ },
    { id: 'shadow',  label: 'Shadow',     match: /^shadow/ },
    { id: 'radius',  label: 'Radius',     match: /^radius/ },
    { id: 'space',   label: 'Spacing',    match: /^(space|gutter|content)/ },
    { id: 'motion',  label: 'Motion',     match: /^(motion|transition|focus-ring)/ },
    { id: 'font',    label: 'Typography', match: /^font/ },
    { id: 'mood',    label: 'Mood',       match: /^mood-/ },
    { id: 'book',    label: 'Book',       match: /^book-/ },
    { id: 'note',    label: 'Notes',      match: /^note-/ },
    { id: 'alpha',   label: 'Alphas',     match: /^(white|shadow-a|accent-a|rose-a|gold-a)/ },
    { id: 'other',   label: 'Other',      match: /./ },
  ];

  const COLOR_TOKEN_REGEX = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|color-mix\(|transparent|currentColor)/;
  const SIZE_TOKEN_REGEX = /^[-+]?\d*\.?\d+\s*(px|rem|em|%|ch|vw|vh|vmin|vmax|pt|pc|fr)?$/;

  // ══════════════════════════════════════════════════════════════════════════
  // §2 Dynamic library loader
  // ══════════════════════════════════════════════════════════════════════════

  const LIBS = {};

  async function loadLibs() {
    if (LIBS.ready) return LIBS;
    const [colorfulMod, floatingMod, selectorMod] = await Promise.all([
      import('https://esm.sh/react-colorful@5.6.1?deps=react@18.3.1,react-dom@18.3.1'),
      import('https://esm.sh/@floating-ui/dom@1.6.11'),
      import('https://esm.sh/css-selector-generator@3.6.9'),
    ]);
    LIBS.HexColorPicker = colorfulMod.HexColorPicker;
    LIBS.HexAlphaColorPicker = colorfulMod.HexAlphaColorPicker;
    LIBS.computePosition = floatingMod.computePosition;
    LIBS.autoUpdate = floatingMod.autoUpdate;
    LIBS.offset = floatingMod.offset;
    LIBS.flip = floatingMod.flip;
    LIBS.shift = floatingMod.shift;
    LIBS.getCssSelector = selectorMod.getCssSelector;
    LIBS.ready = true;
    return LIBS;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §3 Token graph
  // ══════════════════════════════════════════════════════════════════════════

  function scanRootTokens() {
    const out = [];
    const styleSheets = Array.from(document.styleSheets);
    const names = new Set();
    for (const sheet of styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.selectorText !== ':root') continue;
        const style = rule.style;
        for (let i = 0; i < style.length; i++) {
          const name = style[i];
          if (!name.startsWith('--')) continue;
          names.add(name);
        }
      }
    }
    const cs = getComputedStyle(document.documentElement);
    for (const name of names) {
      const value = cs.getPropertyValue(name).trim();
      out.push({
        name,
        value,
        category: categorizeToken(name.slice(2)),
        type: inferTokenType(value),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  function categorizeToken(nameNoPrefix) {
    for (const cat of TOKEN_CATEGORIES) {
      if (cat.match.test(nameNoPrefix)) return cat.id;
    }
    return 'other';
  }

  function inferTokenType(value) {
    if (!value) return 'unknown';
    if (COLOR_TOKEN_REGEX.test(value)) return 'color';
    if (/^(\d+\.?\d*|\.\d+)(ms|s)$/.test(value)) return 'duration';
    if (value.includes('cubic-bezier') || /\bease\b|\blinear\b/.test(value)) return 'motion';
    if (SIZE_TOKEN_REGEX.test(value)) return 'length';
    if (/shadow|inset|\d+(px|rem) \d+/.test(value) && value.includes('rgba')) return 'shadow';
    if (/['"]\w+['"]|serif|sans-serif|monospace|system-ui/.test(value)) return 'font';
    if (/linear-gradient|radial-gradient|conic-gradient/.test(value)) return 'gradient';
    return 'other';
  }

  function elementTokens(element) {
    // For a given element, figure out which tokens it consumes by checking each
    // property for a var(--xxx) reference in its CSS origin chain. This is
    // approximate: we look at the computed value and match against known token
    // values to infer the token-in-use.
    const cs = getComputedStyle(element);
    const tokens = scanRootTokens();
    const results = [];
    const interestingProps = [
      'color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderRightColor',
      'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke',
      'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
      'borderRadius', 'boxShadow', 'opacity',
      'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'gap',
    ];
    for (const prop of interestingProps) {
      const val = cs[prop];
      if (!val || val === 'initial' || val === 'none') continue;
      const match = tokens.find((t) =>
        t.value && t.value.replace(/\s+/g, ' ').toLowerCase() === val.replace(/\s+/g, ' ').toLowerCase()
      );
      if (match) {
        results.push({ property: prop, cssProperty: toCssCase(prop), tokenName: match.name, value: val, category: match.category, type: match.type });
      } else {
        results.push({ property: prop, cssProperty: toCssCase(prop), tokenName: null, value: val });
      }
    }
    return results;
  }

  function toCssCase(jsProp) {
    return jsProp.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §4 Selector generation
  // ══════════════════════════════════════════════════════════════════════════

  function generateSelector(element) {
    if (!LIBS.getCssSelector) return fallbackSelector(element);
    try {
      return LIBS.getCssSelector(element, {
        selectors: ['id', 'class', 'tag', 'attribute', 'nthoftype'],
        blacklist: [/^css-[a-z0-9]+$/, /^is-/, /^has-/],
        combineWithinSelector: true,
        combineBetweenSelectors: true,
      });
    } catch {
      return fallbackSelector(element);
    }
  }

  function fallbackSelector(element) {
    if (!element) return '';
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let el = element;
    let depth = 0;
    while (el && el !== document.body && depth < 5) {
      const tag = el.tagName.toLowerCase();
      const cls = (el.classList && el.classList.length) ? '.' + Array.from(el.classList).map(CSS.escape).join('.') : '';
      parts.unshift(tag + cls);
      el = el.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §5 Contrast math
  // ══════════════════════════════════════════════════════════════════════════

  function parseColor(str) {
    if (!str) return null;
    const s = str.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16), 1];
    }
    if (/^#[0-9a-fA-F]{6}$/.test(s)) {
      return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
    }
    const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] ? parseFloat(m[4]) : 1];
    return null;
  }

  function relLuminance([r, g, b]) {
    const srgb = [r, g, b].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  function contrastRatio(fg, bg) {
    const f = parseColor(fg), b = parseColor(bg);
    if (!f || !b) return null;
    const L1 = relLuminance(f), L2 = relLuminance(b);
    const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (hi + 0.05) / (lo + 0.05);
  }

  function contrastVerdict(ratio) {
    if (ratio == null) return { aa: null, aaa: null, label: '—' };
    return {
      aa: ratio >= 4.5,
      aaa: ratio >= 7,
      label: ratio.toFixed(2) + ':1',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §6 Element picker
  // ══════════════════════════════════════════════════════════════════════════

  function createPicker({ onSelect }) {
    let active = false;
    let highlight = null;

    function makeHighlight() {
      const el = document.createElement('div');
      el.id = CFG.highlightId;
      el.setAttribute(CFG.chromeAttr, '');
      el.style.cssText = [
        'position:fixed','pointer-events:none','z-index:9999998',
        'border:2px solid var(--accent, #c6a6ff)','background:color-mix(in srgb, var(--accent, #c6a6ff) 10%, transparent)',
        'border-radius:4px','transition:all 80ms ease-out','display:none',
      ].join(';');
      document.body.appendChild(el);
      return el;
    }

    function onMove(ev) {
      if (!active || !highlight) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!target || target === highlight || target.closest(`[${CFG.chromeAttr}]`)) {
        highlight.style.display = 'none';
        return;
      }
      const r = target.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = r.left + 'px';
      highlight.style.top = r.top + 'px';
      highlight.style.width = r.width + 'px';
      highlight.style.height = r.height + 'px';
    }

    function onClick(ev) {
      if (!active) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!target || target.closest(`[${CFG.chromeAttr}]`)) return;
      ev.preventDefault();
      ev.stopPropagation();
      onSelect(target);
    }

    return {
      start() {
        if (active) return;
        active = true;
        if (!highlight) highlight = makeHighlight();
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.body.setAttribute('data-tweak-mode', 'on');
      },
      stop() {
        if (!active) return;
        active = false;
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        if (highlight) highlight.style.display = 'none';
        document.body.removeAttribute('data-tweak-mode');
      },
      clear() { if (highlight) highlight.style.display = 'none'; },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §7 Live preview
  // ══════════════════════════════════════════════════════════════════════════

  function applyGlobalTokenMutation(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  function clearGlobalTokenMutation(name) {
    document.documentElement.style.removeProperty(name);
  }

  function ensureScopedStyleElement() {
    let el = document.getElementById(CFG.scopedStyleId);
    if (!el) {
      el = document.createElement('style');
      el.id = CFG.scopedStyleId;
      el.setAttribute(CFG.chromeAttr, '');
      document.head.appendChild(el);
    }
    return el;
  }

  function renderScopedOverrides(overrides) {
    const el = ensureScopedStyleElement();
    // Last-in wins per selector+property.
    const map = new Map();
    for (const o of overrides) map.set(`${o.selector}|${o.property}`, o);
    el.textContent = [...map.values()]
      .map((o) => `${o.selector} { ${o.property}: ${o.value} !important; }`)
      .join('\n');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §8 History (undo/redo + localStorage session)
  // ══════════════════════════════════════════════════════════════════════════

  function loadSession() {
    try {
      const raw = localStorage.getItem(CFG.storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function saveSession(session) {
    try { localStorage.setItem(CFG.storageKey, JSON.stringify(session)); } catch {}
  }

  function clearSession() {
    try { localStorage.removeItem(CFG.storageKey); } catch {}
  }

  function uuid() { return 'c' + Math.random().toString(36).slice(2, 10); }

  // ══════════════════════════════════════════════════════════════════════════
  // §9 API client
  // ══════════════════════════════════════════════════════════════════════════

  const API = {
    async swatches({ currentColor, role, activePalette, context }) {
      const res = await fetch(`${CFG.apiBase}/api/theme-swatches`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentColor, role, activePalette, context }),
      });
      if (!res.ok) throw new Error(`swatches failed: ${res.status}`);
      return res.json();
    },
    async review({ activeTheme, baselineTokens, pendingChanges }) {
      const res = await fetch(`${CFG.apiBase}/api/theme-review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeTheme, baselineTokens, pendingChanges }),
      });
      if (!res.ok) throw new Error(`review failed: ${res.status}`);
      return res.json();
    },
    async save(payload) {
      const res = await fetch(`${CFG.apiBase}/api/theme-save`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(body.error || 'save failed'), { body });
      return body;
    },
  };

  function activeThemeInfo() {
    // Read from BabuTheme global if available (from theme-switcher.js).
    if (window.BabuTheme && window.BabuTheme.active) {
      const t = window.BabuTheme.active;
      return { id: t.id, name: t.name, file: t.file };
    }
    // Fallback: scrape the <link id="theme-stylesheet"> href.
    const link = document.getElementById(CFG.themeStylesheetId);
    if (link) {
      const href = link.getAttribute('href') || '';
      const file = href.split('/').pop();
      const id = (file || '').replace(/^theme-?/, '').replace(/\.css$/, '') || 'rose-mauve-night';
      return { id, name: id, file };
    }
    return { id: 'rose-mauve-night', name: 'Rose & Mauve Night', file: 'theme.css' };
  }

  function paletteSnapshot() {
    const out = {};
    for (const t of scanRootTokens()) out[t.name] = t.value;
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §10 React: AI swatch strip
  // ══════════════════════════════════════════════════════════════════════════

  function AISwatchStrip({ currentColor, role, onApply, activeTheme }) {
    const [swatches, setSwatches] = useState(null);
    const [err, setErr] = useState(null);
    const [loading, setLoading] = useState(false);
    const lastRequest = useRef(0);

    useEffect(() => {
      const thisReq = ++lastRequest.current;
      if (!currentColor || !/^#[0-9a-fA-F]{3,6}$/.test(currentColor)) { setSwatches(null); return; }
      setLoading(true); setErr(null); setSwatches(null);
      API.swatches({
        currentColor,
        role,
        activePalette: paletteSnapshot(),
        context: { themeName: activeTheme.name },
      })
        .then((r) => { if (thisReq === lastRequest.current) setSwatches(r.swatches || []); })
        .catch((e) => { if (thisReq === lastRequest.current) setErr(e.message); })
        .finally(() => { if (thisReq === lastRequest.current) setLoading(false); });
    }, [currentColor, role, activeTheme.id]);

    return h('div', { className: 'tweaker-swatch-strip', [CFG.chromeAttr]: '' },
      h('div', { className: 'tweaker-swatch-label' }, 'AI suggestions',
        loading ? h('span', { className: 'tweaker-dots' }, '…') : null),
      err ? h('div', { className: 'tweaker-err' }, 'AI offline: ' + err) :
      !swatches ? h('div', { className: 'tweaker-muted' }, loading ? 'thinking…' : '') :
      swatches.length === 0 ? h('div', { className: 'tweaker-muted' }, 'no suggestions') :
      h('div', { className: 'tweaker-swatch-row' },
        swatches.map((s, i) =>
          h('button', {
            key: i,
            className: 'tweaker-swatch',
            style: { background: s.hex, color: contrastRatio('#ffffff', s.hex) > 3 ? '#fff' : '#000' },
            title: s.rationale + (s.contrastAA ? ' (AA ✓)' : ''),
            onClick: () => onApply(s.hex, s),
          }, s.label || s.hex)
        )
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §11 React: Inspector panel
  // ══════════════════════════════════════════════════════════════════════════

  function Inspector({ selection, onClose, onEdit, activeTheme, pendingChanges, history }) {
    const [tab, setTab] = useState('colors');
    const [scope, setScope] = useState('global');
    const [activeProperty, setActiveProperty] = useState(null);
    const panelRef = useRef(null);
    const anchorRef = useRef(null);

    // Anchor panel to the selected element via floating-ui.
    useEffect(() => {
      if (!selection || !panelRef.current || !LIBS.computePosition) return;
      const virtualEl = {
        getBoundingClientRect: () => selection.element.getBoundingClientRect(),
        contextElement: selection.element,
      };
      anchorRef.current = virtualEl;
      const cleanup = LIBS.autoUpdate(virtualEl, panelRef.current, () => {
        LIBS.computePosition(virtualEl, panelRef.current, {
          placement: 'right-start',
          middleware: [LIBS.offset(12), LIBS.flip(), LIBS.shift({ padding: 12 })],
        }).then(({ x, y }) => {
          Object.assign(panelRef.current.style, { left: `${x}px`, top: `${y}px` });
        });
      });
      return cleanup;
    }, [selection]);

    if (!selection) return null;
    const tokens = selection.tokens || [];

    return h('div', {
      ref: panelRef,
      className: 'tweaker-inspector',
      [CFG.chromeAttr]: '',
      style: { position: 'fixed', top: 0, left: 0, zIndex: 9999999 },
    },
      h('div', { className: 'tweaker-inspector-header' },
        h('span', { className: 'tweaker-inspector-selector' }, selection.selector || '(element)'),
        h('button', { className: 'tweaker-x', onClick: onClose, 'aria-label': 'Close' }, '×'),
      ),
      h('div', { className: 'tweaker-scope-toggle' },
        h('button', {
          className: scope === 'global' ? 'on' : '',
          onClick: () => setScope('global'),
          title: 'Change the underlying token (affects every element using it)',
        }, 'Global'),
        h('button', {
          className: scope === 'scoped' ? 'on' : '',
          onClick: () => setScope('scoped'),
          title: 'Add a rule that only affects this selector',
        }, 'Scoped'),
      ),
      h('div', { className: 'tweaker-tabs' },
        h('button', { className: tab === 'colors' ? 'on' : '', onClick: () => setTab('colors') },
          h('i', { className: 'fa-solid fa-palette' }), ' Colors'),
        h('button', { className: tab === 'type' ? 'on' : '', onClick: () => setTab('type') },
          h('i', { className: 'fa-solid fa-font' }), ' Type'),
        h('button', { className: tab === 'box' ? 'on' : '', onClick: () => setTab('box') },
          h('i', { className: 'fa-regular fa-square' }), ' Box'),
      ),
      h('div', { className: 'tweaker-body' },
        tab === 'colors' && h(ColorsTab, { selection, scope, tokens, onEdit }),
        tab === 'type' && h(TypeTab, { selection, scope, tokens, onEdit }),
        tab === 'box' && h(BoxTab, { selection, scope, tokens, onEdit }),
      ),
      h('div', { className: 'tweaker-footer' },
        h('span', { className: 'tweaker-muted' }, `${pendingChanges.length} pending change${pendingChanges.length === 1 ? '' : 's'}`),
        h('button', { className: 'tweaker-btn-sm', onClick: () => history.undo(), disabled: !history.canUndo, title: 'Undo (⌘Z)' }, '↶'),
        h('button', { className: 'tweaker-btn-sm', onClick: () => history.redo(), disabled: !history.canRedo, title: 'Redo (⌘⇧Z)' }, '↷'),
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Shared components
  // ──────────────────────────────────────────────────────────────────

  // A compact grid of the theme's 12 featured palette tokens. Clicking a
  // chip fires onApply(hex, tokenName) so the caller can apply it to the
  // currently-active color property.
  function SwatchGrid({ onApply }) {
    const featured = useMemo(() => {
      const snap = paletteSnapshot();
      const order = [
        '--bg', '--bg-secondary', '--bg-tertiary', '--accent',
        '--rose', '--gold', '--mauve', '--lavender',
        '--blush', '--success', '--warning', '--error',
      ];
      return order
        .map((name) => ({ name, value: snap[name] }))
        .filter((t) => t.value);
    }, []);
    return h('div', { className: 'tweaker-section' },
      h('div', { className: 'tweaker-section-head' },
        h('span', null, 'Theme palette'),
      ),
      h('div', { className: 'tweaker-swatch-grid' },
        featured.map((t) => h('button', {
          key: t.name,
          className: 'tweaker-palette-chip',
          style: { background: t.value },
          title: `${t.name}  ${t.value}`,
          onClick: () => onApply(normalizeHex(t.value), t.name),
          'aria-label': t.name,
        }))
      )
    );
  }

  // A number input that supports:
  //   - direct typing
  //   - ArrowUp/Down to adjust (shift = ×10)
  //   - vertical drag-scrub on the value
  function ScrubbableInput({ value, unit = 'px', min = 0, max = 9999, step = 1, onChange, label, className = '' }) {
    const [local, setLocal] = useState(String(stripUnit(value)));
    const [dragging, setDragging] = useState(false);
    useEffect(() => { setLocal(String(stripUnit(value))); }, [value]);

    function commit(n) {
      const v = Math.max(min, Math.min(max, n));
      const str = Number.isFinite(v) ? String(Number(v.toFixed(2))) : '0';
      setLocal(str);
      onChange(str + unit);
    }
    function onMouseDown(e) {
      if (e.target.tagName === 'INPUT') return;
      e.preventDefault();
      setDragging(true);
      const startY = e.clientY;
      const startVal = parseFloat(local) || 0;
      function move(ev) {
        const delta = (startY - ev.clientY) * step;
        commit(startVal + Math.round(delta * 10) / 10);
      }
      function up() {
        setDragging(false);
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }
    function onKeyDown(e) {
      const current = parseFloat(local) || 0;
      const delta = e.shiftKey ? step * 10 : step;
      if (e.key === 'ArrowUp') { e.preventDefault(); commit(current + delta); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); commit(current - delta); }
    }
    return h('div', {
      className: 'tweaker-scrub' + (dragging ? ' is-dragging' : '') + ' ' + className,
      onMouseDown,
      title: 'Click + drag up/down, or type a value',
    },
      label && h('span', { className: 'tweaker-scrub-label' }, label),
      h('input', {
        type: 'text', inputMode: 'decimal', value: local,
        onChange: (e) => setLocal(e.target.value),
        onBlur: () => { const n = parseFloat(local); if (Number.isFinite(n)) commit(n); else setLocal(String(stripUnit(value))); },
        onKeyDown,
      }),
    );
  }

  function stripUnit(v) {
    if (v == null) return 0;
    const m = String(v).match(/-?[\d.]+/);
    return m ? parseFloat(m[0]) : 0;
  }

  // A continuous slider with label + live numeric readout.
  function LabeledSlider({ label, min, max, step, value, format, onChange, unit = '' }) {
    const display = format ? format(value) : `${value}${unit}`;
    return h('div', { className: 'tweaker-slider-row' },
      h('div', { className: 'tweaker-slider-head' },
        h('span', { className: 'tweaker-slider-label' }, label),
        h('span', { className: 'tweaker-slider-val' }, display),
      ),
      h('input', {
        type: 'range', min, max, step, value,
        className: 'tweaker-slider',
        onInput: (e) => onChange(parseFloat(e.target.value)),
      })
    );
  }

  async function pickWithEyeDropper() {
    if (!window.EyeDropper) return null;
    try {
      const picker = new window.EyeDropper();
      const result = await picker.open();
      return result?.sRGBHex || null;
    } catch { return null; }
  }

  function ContrastChip({ fg, bg }) {
    const r = contrastRatio(fg, bg);
    const v = contrastVerdict(r);
    if (r == null) return null;
    return h('span', { className: 'tweaker-contrast-chip' },
      h('strong', null, v.label),
      h('span', { className: v.aa ? 'ok' : 'warn' }, v.aa ? ' AA ✓' : ' AA ✗'),
      h('span', { className: v.aaa ? 'ok' : 'warn' }, v.aaa ? ' AAA ✓' : ' AAA ✗'),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Colors tab — Figma-style: swatches up top, 4 property rows, opacity
  // ──────────────────────────────────────────────────────────────────

  const COLOR_PROPS = [
    { id: 'bg',     property: 'backgroundColor', label: 'Background', cssProperty: 'background-color' },
    { id: 'text',   property: 'color',           label: 'Text',       cssProperty: 'color' },
    { id: 'border', property: 'borderColor',     label: 'Border',     cssProperty: 'border-color' },
  ];

  function ColorsTab({ selection, scope, tokens, onEdit }) {
    const [activeId, setActiveId] = useState('bg');

    // Resolve current values from the element's computed style + any token match.
    const rows = useMemo(() => COLOR_PROPS.map((p) => {
      const matched = tokens.find((t) => t.property === p.property);
      const value = matched ? matched.value : getComputedStyle(selection.element)[p.property];
      return { ...p, value: value || '', tokenName: matched ? matched.tokenName : null };
    }), [selection.element, tokens]);

    const bgRow = rows.find((r) => r.id === 'bg');
    const textRow = rows.find((r) => r.id === 'text');

    function handleApply(hex, tokenHint) {
      const row = rows.find((r) => r.id === activeId);
      if (!row) return;
      const useGlobal = scope === 'global' && row.tokenName;
      onEdit({
        kind: useGlobal ? 'token' : 'scoped',
        scope: useGlobal ? 'global' : 'scoped',
        tokenName: useGlobal ? row.tokenName : null,
        oldValue: row.value,
        newValue: hex,
        selector: selection.selector,
        property: row.cssProperty,
        value: hex,
        source: 'user',
        viaToken: tokenHint || null,
      });
    }

    return h('div', { className: 'tweaker-tab-colors' },
      h(SwatchGrid, { onApply: handleApply }),

      h('div', { className: 'tweaker-section' },
        h('div', { className: 'tweaker-section-head' },
          h('span', null, 'Properties'),
          h('span', { className: 'tweaker-hint' }, `Active: ${rows.find((r) => r.id === activeId).label}`),
        ),
        rows.map((row) => h(ColorRow, {
          key: row.id, row, active: activeId === row.id,
          onFocus: () => setActiveId(row.id),
          onPickerChange: (hex) => {
            setActiveId(row.id);
            handleApply(hex);
          },
          scope,
        }))
      ),

      (bgRow && textRow) && h('div', { className: 'tweaker-section' },
        h('div', { className: 'tweaker-section-head' },
          h('span', null, 'Contrast (text vs background)'),
        ),
        h(ContrastChip, { fg: normalizeHex(textRow.value), bg: normalizeHex(bgRow.value) })
      ),

      h('div', { className: 'tweaker-section' },
        h('div', { className: 'tweaker-section-head' }, h('span', null, 'Opacity')),
        h(OpacityRow, { selection, onEdit, tokens })
      ),
    );
  }

  function ColorRow({ row, active, onFocus, onPickerChange, scope }) {
    const [showPicker, setShowPicker] = useState(false);
    const hex = normalizeHex(row.value);
    return h('div', {
      className: 'tweaker-color-row' + (active ? ' is-active' : '') + (showPicker ? ' is-expanded' : ''),
    },
      h('div', {
        className: 'tweaker-color-row-head',
        onClick: () => { onFocus(); setShowPicker((v) => !v); },
      },
        h('span', { className: 'tweaker-radio' + (active ? ' on' : '') }),
        h('span', { className: 'tweaker-color-preview', style: { background: hex } }),
        h('span', { className: 'tweaker-color-label' }, row.label),
        h('span', { className: 'tweaker-color-hex' }, hex.toUpperCase()),
        h('i', { className: 'fa-solid ' + (showPicker ? 'fa-chevron-up' : 'fa-chevron-down'), 'aria-hidden': 'true' }),
      ),
      showPicker && h('div', { className: 'tweaker-color-row-body' },
        LIBS.HexColorPicker && h(LIBS.HexColorPicker, {
          color: hex, onChange: onPickerChange,
        }),
        h('div', { className: 'tweaker-color-row-actions' },
          h('input', {
            type: 'text', className: 'tweaker-hex-input',
            value: hex.toUpperCase(),
            onChange: (e) => {
              const v = e.target.value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onPickerChange(v.toLowerCase());
            },
          }),
          window.EyeDropper && h('button', {
            className: 'tweaker-btn-icon',
            title: 'Eye-dropper (pick any pixel)',
            onClick: async () => {
              const picked = await pickWithEyeDropper();
              if (picked) onPickerChange(picked.toLowerCase());
            },
          }, h('i', { className: 'fa-solid fa-eye-dropper' })),
          row.tokenName && h('span', { className: 'tweaker-token-badge', title: `Uses ${row.tokenName}` },
            scope === 'global' ? '→ GLOBAL' : '→ SCOPED'
          ),
        ),
      ),
    );
  }

  function OpacityRow({ selection, onEdit, tokens }) {
    const current = parseFloat(getComputedStyle(selection.element).opacity) || 1;
    const [val, setVal] = useState(current);
    useEffect(() => { setVal(parseFloat(getComputedStyle(selection.element).opacity) || 1); }, [selection.element]);
    function onChange(v) {
      setVal(v);
      onEdit({
        kind: 'scoped', scope: 'scoped',
        selector: selection.selector, property: 'opacity', value: String(v), source: 'user',
      });
    }
    return h(LabeledSlider, {
      label: 'Element opacity', min: 0, max: 1, step: 0.01, value: val,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Type tab — visual font dropdown + sliders + segmented weight
  // ──────────────────────────────────────────────────────────────────

  const FONT_CHOICES = [
    { label: 'Serif (theme default)',  value: 'var(--font-serif)' },
    { label: 'Sans (theme default)',   value: 'var(--font-sans)' },
    { label: 'Mono',                   value: 'var(--font-mono)' },
    { label: 'Script (Great Vibes)',   value: 'var(--font-script)' },
    { label: 'Dance (Dancing Script)', value: 'var(--font-dance)' },
    { label: 'Playfair Display',       value: "'Playfair Display', serif" },
    { label: 'Lora',                   value: "'Lora', serif" },
    { label: 'PT Serif',               value: "'PT Serif', serif" },
    { label: 'Cormorant Garamond',     value: "'Cormorant Garamond', serif" },
    { label: 'Inter',                  value: "'Inter', sans-serif" },
    { label: 'Open Sans',              value: "'Open Sans', sans-serif" },
    { label: 'Nunito Sans',            value: "'Nunito Sans', sans-serif" },
    { label: 'Lato',                   value: "'Lato', sans-serif" },
  ];

  const WEIGHTS = [300, 400, 500, 600, 700, 800];

  function TypeTab({ selection, scope, tokens, onEdit }) {
    const cs = getComputedStyle(selection.element);
    const fontSizePx = parseFloat(cs.fontSize) || 16;
    const [family, setFamily] = useState(cs.fontFamily || 'var(--font-sans)');
    const [size, setSize] = useState(fontSizePx / 16);
    const [weight, setWeight] = useState(parseInt(cs.fontWeight) || 400);
    const [lineH, setLineH] = useState(parseFloat(cs.lineHeight) / fontSizePx || 1.5);
    const [letterSp, setLetterSp] = useState(parseFloat(cs.letterSpacing) || 0);

    function emit(property, value) {
      onEdit({
        kind: 'scoped', scope: 'scoped',
        selector: selection.selector, property, value, source: 'user',
      });
    }

    return h('div', { className: 'tweaker-tab-type' },
      // Sample preview
      h('div', {
        className: 'tweaker-type-preview',
        style: {
          fontFamily: family,
          fontSize: `${size}rem`,
          fontWeight: weight,
          lineHeight: lineH,
          letterSpacing: `${letterSp}px`,
        },
      }, 'The quick brown fox'),

      // Family dropdown, each option rendered in its own font
      h('div', { className: 'tweaker-section' },
        h('div', { className: 'tweaker-section-head' }, h('span', null, 'Font family')),
        h('select', {
          className: 'tweaker-select',
          value: family,
          onChange: (e) => { setFamily(e.target.value); emit('font-family', e.target.value); },
        },
          FONT_CHOICES.map((f) => h('option', { key: f.value, value: f.value, style: { fontFamily: f.value } }, f.label))
        )
      ),

      // Size slider
      h('div', { className: 'tweaker-section' },
        h(LabeledSlider, {
          label: 'Font size', min: 0.5, max: 4, step: 0.05, value: size,
          format: (v) => `${v.toFixed(2)}rem (${Math.round(v * 16)}px)`,
          onChange: (v) => { setSize(v); emit('font-size', `${v}rem`); },
        })
      ),

      // Weight — segmented control
      h('div', { className: 'tweaker-section' },
        h('div', { className: 'tweaker-section-head' },
          h('span', null, 'Weight'),
          h('span', { className: 'tweaker-hint' }, String(weight)),
        ),
        h('div', { className: 'tweaker-segmented' },
          WEIGHTS.map((w) => h('button', {
            key: w,
            className: 'tweaker-segmented-btn' + (weight === w ? ' on' : ''),
            style: { fontWeight: w, fontFamily: family },
            onClick: () => { setWeight(w); emit('font-weight', String(w)); },
          }, w))
        ),
      ),

      // Line height
      h('div', { className: 'tweaker-section' },
        h(LabeledSlider, {
          label: 'Line height', min: 1, max: 2.5, step: 0.05, value: lineH,
          format: (v) => v.toFixed(2),
          onChange: (v) => { setLineH(v); emit('line-height', String(v)); },
        })
      ),

      // Letter spacing
      h('div', { className: 'tweaker-section' },
        h(LabeledSlider, {
          label: 'Letter spacing', min: -2, max: 8, step: 0.1, value: letterSp,
          format: (v) => `${v.toFixed(1)}px`,
          onChange: (v) => { setLetterSp(v); emit('letter-spacing', `${v}px`); },
        })
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Box tab — Figma-style cross for padding+margin, radius + shadow
  // ──────────────────────────────────────────────────────────────────

  function BoxTab({ selection, scope, tokens, onEdit }) {
    const cs = getComputedStyle(selection.element);
    const emit = (property, value) => onEdit({
      kind: 'scoped', scope: 'scoped',
      selector: selection.selector, property, value, source: 'user',
    });

    return h('div', { className: 'tweaker-tab-box' },
      // Padding + margin nested cross
      h('div', { className: 'tweaker-section' },
        h('div', { className: 'tweaker-section-head' }, h('span', null, 'Spacing')),
        h(BoxModelCross, {
          marginTop: cs.marginTop, marginRight: cs.marginRight, marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
          paddingTop: cs.paddingTop, paddingRight: cs.paddingRight, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
          onChange: (property, value) => emit(property, value),
        })
      ),

      // Border radius
      h('div', { className: 'tweaker-section' },
        h(LabeledSlider, {
          label: 'Border radius', min: 0, max: 48, step: 1, value: parseFloat(cs.borderTopLeftRadius) || 0,
          format: (v) => `${v}px`,
          onChange: (v) => emit('border-radius', `${v}px`),
        }),
        h('div', { className: 'tweaker-radius-preview', style: { borderRadius: `${parseFloat(cs.borderTopLeftRadius) || 0}px` } })
      ),

      // Shadow composer
      h('div', { className: 'tweaker-section' }, h(ShadowComposer, { selection, onEdit })),
    );
  }

  function BoxModelCross({ marginTop, marginRight, marginBottom, marginLeft, paddingTop, paddingRight, paddingBottom, paddingLeft, onChange }) {
    const [linkMargin, setLinkMargin] = useState(false);
    const [linkPadding, setLinkPadding] = useState(false);

    function onMargin(side, v) {
      if (linkMargin) {
        onChange('margin-top', v); onChange('margin-right', v); onChange('margin-bottom', v); onChange('margin-left', v);
      } else onChange(`margin-${side}`, v);
    }
    function onPadding(side, v) {
      if (linkPadding) {
        onChange('padding-top', v); onChange('padding-right', v); onChange('padding-bottom', v); onChange('padding-left', v);
      } else onChange(`padding-${side}`, v);
    }

    return h('div', { className: 'tweaker-box-model' },
      // Outer ring: margin
      h('div', { className: 'tweaker-box-ring tweaker-box-margin' },
        h('span', { className: 'tweaker-box-ring-label' }, 'margin',
          h('button', {
            className: 'tweaker-box-link' + (linkMargin ? ' on' : ''),
            onClick: () => setLinkMargin((v) => !v),
            title: 'Link all 4 sides',
          }, h('i', { className: 'fa-solid fa-link' }))
        ),
        h(ScrubbableInput, { className: 'tweaker-box-top',    value: marginTop,    onChange: (v) => onMargin('top', v) }),
        h(ScrubbableInput, { className: 'tweaker-box-right',  value: marginRight,  onChange: (v) => onMargin('right', v) }),
        h(ScrubbableInput, { className: 'tweaker-box-bottom', value: marginBottom, onChange: (v) => onMargin('bottom', v) }),
        h(ScrubbableInput, { className: 'tweaker-box-left',   value: marginLeft,   onChange: (v) => onMargin('left', v) }),

        // Inner ring: padding
        h('div', { className: 'tweaker-box-ring tweaker-box-padding' },
          h('span', { className: 'tweaker-box-ring-label' }, 'padding',
            h('button', {
              className: 'tweaker-box-link' + (linkPadding ? ' on' : ''),
              onClick: () => setLinkPadding((v) => !v),
              title: 'Link all 4 sides',
            }, h('i', { className: 'fa-solid fa-link' }))
          ),
          h(ScrubbableInput, { className: 'tweaker-box-top',    value: paddingTop,    onChange: (v) => onPadding('top', v) }),
          h(ScrubbableInput, { className: 'tweaker-box-right',  value: paddingRight,  onChange: (v) => onPadding('right', v) }),
          h(ScrubbableInput, { className: 'tweaker-box-bottom', value: paddingBottom, onChange: (v) => onPadding('bottom', v) }),
          h(ScrubbableInput, { className: 'tweaker-box-left',   value: paddingLeft,   onChange: (v) => onPadding('left', v) }),
          h('span', { className: 'tweaker-box-center' }, 'content'),
        )
      )
    );
  }

  function ShadowComposer({ selection, onEdit }) {
    const cs = getComputedStyle(selection.element);
    const parsed = parseShadow(cs.boxShadow);
    const [x, setX] = useState(parsed.x);
    const [y, setY] = useState(parsed.y);
    const [blur, setBlur] = useState(parsed.blur);
    const [spread, setSpread] = useState(parsed.spread);
    const [color, setColor] = useState(parsed.color || '#000000');
    const [showPicker, setShowPicker] = useState(false);
    function emit(nx = x, ny = y, nb = blur, ns = spread, nc = color) {
      const v = `${nx}px ${ny}px ${nb}px ${ns}px ${nc}`;
      onEdit({
        kind: 'scoped', scope: 'scoped',
        selector: selection.selector, property: 'box-shadow', value: v, source: 'user',
      });
    }
    return h('div', null,
      h('div', { className: 'tweaker-section-head' }, h('span', null, 'Box shadow')),
      // Preview
      h('div', { className: 'tweaker-shadow-preview' },
        h('div', { className: 'tweaker-shadow-sample', style: { boxShadow: `${x}px ${y}px ${blur}px ${spread}px ${color}` } })
      ),
      h(LabeledSlider, { label: 'X offset', min: -40, max: 40, step: 1, value: x, format: (v) => `${v}px`, onChange: (v) => { setX(v); emit(v, y, blur, spread, color); } }),
      h(LabeledSlider, { label: 'Y offset', min: -40, max: 40, step: 1, value: y, format: (v) => `${v}px`, onChange: (v) => { setY(v); emit(x, v, blur, spread, color); } }),
      h(LabeledSlider, { label: 'Blur',     min: 0,   max: 80, step: 1, value: blur,   format: (v) => `${v}px`, onChange: (v) => { setBlur(v); emit(x, y, v, spread, color); } }),
      h(LabeledSlider, { label: 'Spread',   min: -20, max: 40, step: 1, value: spread, format: (v) => `${v}px`, onChange: (v) => { setSpread(v); emit(x, y, blur, v, color); } }),
      h('div', { className: 'tweaker-shadow-color' },
        h('button', {
          className: 'tweaker-color-preview-btn',
          style: { background: color },
          onClick: () => setShowPicker((v) => !v),
        }),
        h('span', { className: 'tweaker-color-hex' }, color.toUpperCase()),
      ),
      showPicker && LIBS.HexColorPicker && h(LIBS.HexColorPicker, {
        color, onChange: (v) => { setColor(v); emit(x, y, blur, spread, v); },
      }),
    );
  }

  function parseShadow(css) {
    if (!css || css === 'none') return { x: 0, y: 0, blur: 0, spread: 0, color: '#000000' };
    // computed style is rgb(a,b,c) Xpx Ypx BLURpx SPREADpx (inset)
    const m = css.match(/^(rgba?\([^)]+\)|#[0-9a-f]+)\s*(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px(?:\s+(-?\d+(?:\.\d+)?)px)?/i);
    if (!m) return { x: 0, y: 0, blur: 0, spread: 0, color: '#000000' };
    const rgb = parseColor(m[1]);
    const hex = rgb ? '#' + rgb.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('') : '#000000';
    return {
      color: hex,
      x: parseFloat(m[2]), y: parseFloat(m[3]),
      blur: parseFloat(m[4]), spread: m[5] ? parseFloat(m[5]) : 0,
    };
  }

  function normalizeHex(value) {
    if (!value) return '#000000';
    const m = value.match(/#([0-9a-fA-F]{3,6})/);
    if (m) {
      let hex = m[1];
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      return '#' + hex.toLowerCase();
    }
    const rgba = parseColor(value);
    if (rgba) return '#' + rgba.slice(0,3).map(n => n.toString(16).padStart(2,'0')).join('');
    return '#000000';
  }

  function inferColorRole(cssProperty) {
    if (cssProperty.includes('background')) return 'bg';
    if (cssProperty.includes('border') || cssProperty.includes('outline')) return 'border';
    return 'fg';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §12 React: Review modal
  // ══════════════════════════════════════════════════════════════════════════

  function ReviewModal({ open, onClose, pendingChanges, activeTheme, baselineTokens, onAccept }) {
    const [review, setReview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);

    useEffect(() => {
      if (!open) return;
      setLoading(true); setErr(null); setReview(null);
      API.review({ activeTheme, baselineTokens, pendingChanges })
        .then((r) => setReview(r.review))
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
    }, [open]);

    if (!open) return null;
    return h('div', { className: 'tweaker-modal-scrim', [CFG.chromeAttr]: '' },
      h('div', { className: 'tweaker-modal' },
        h('div', { className: 'tweaker-modal-header' },
          h('h3', null, 'AI Theme Review'),
          h('button', { className: 'tweaker-x', onClick: onClose }, '×'),
        ),
        h('div', { className: 'tweaker-modal-body' },
          loading && h('p', { className: 'tweaker-muted' }, 'Reviewing your changes…'),
          err && h('p', { className: 'tweaker-err' }, 'Review failed: ' + err + ' — you can still save.'),
          review && h('div', null,
            h('p', null, review.assessment),
            review.flagged.length > 0 && h('div', { className: 'tweaker-review-section' },
              h('h4', null, 'Flagged'),
              h('ul', null, review.flagged.map((f, i) => h('li', { key: i, className: 'flag-' + f.severity },
                h('strong', null, f.tokenName || '(general)'), ' — ', f.issue
              )))
            ),
            review.suggestedTweaks.length > 0 && h('div', { className: 'tweaker-review-section' },
              h('h4', null, 'Suggested tweaks'),
              h('ul', null, review.suggestedTweaks.map((s, i) => h('li', { key: i },
                h('code', null, s.tokenName), ' → ',
                h('code', null, s.proposedValue), ' — ', s.rationale,
                ' ', h('button', { className: 'tweaker-btn-sm', onClick: () => onAccept(s) }, 'Apply')
              )))
            )
          )
        ),
        h('div', { className: 'tweaker-modal-footer' },
          h('button', { className: 'tweaker-btn', onClick: onClose }, 'Back to editor'),
          h('button', { className: 'tweaker-btn tweaker-btn-primary', onClick: () => onAccept(null) }, 'Proceed to save'),
        )
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §13 React: Save modal
  // ══════════════════════════════════════════════════════════════════════════

  function SaveModal({ open, onClose, pendingChanges, activeTheme, onSaved, onValidationFail }) {
    const [mode, setMode] = useState('overwrite');
    const [newSlug, setNewSlug] = useState('');
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newCat, setNewCat] = useState('Dark');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);

    if (!open) return null;

    const tokenMutations = pendingChanges
      .filter(c => c.kind === 'token' && c.tokenName)
      .map(c => ({ name: c.tokenName, value: c.newValue }));
    const scopedOverrides = pendingChanges
      .filter(c => c.kind === 'scoped')
      .map(c => ({ selector: c.selector, property: c.property, value: c.value }));

    const paletteHexes = Object.values(paletteSnapshot())
      .map(v => (v.match(/#[0-9a-fA-F]{6}/g) || []))
      .flat().slice(0, 4);

    async function doSave() {
      setSaving(true); setErr(null);
      try {
        const payload = mode === 'overwrite'
          ? { schemaVersion: '1', mode, slug: activeTheme.id, tokenMutations, scopedOverrides }
          : {
              schemaVersion: '1', mode: 'new',
              slug: newSlug, baseSlug: activeTheme.id, name: newName,
              description: newDesc || `Custom variant of ${activeTheme.name}`,
              category: newCat,
              swatches: paletteHexes.slice(0, 4),
              tokenMutations, scopedOverrides,
            };
        const result = await API.save(payload);
        onSaved(result);
      } catch (e) {
        const validator = e.body && e.body.validator;
        if (validator) {
          onValidationFail(validator);
          onClose();
        } else {
          setErr(e.message || String(e));
        }
      } finally {
        setSaving(false);
      }
    }

    return h('div', { className: 'tweaker-modal-scrim', [CFG.chromeAttr]: '' },
      h('div', { className: 'tweaker-modal' },
        h('div', { className: 'tweaker-modal-header' },
          h('h3', null, 'Save Theme'),
          h('button', { className: 'tweaker-x', onClick: onClose }, '×'),
        ),
        h('div', { className: 'tweaker-modal-body' },
          h('div', { className: 'tweaker-save-mode' },
            h('label', null,
              h('input', { type: 'radio', checked: mode === 'overwrite', onChange: () => setMode('overwrite') }),
              ` Save to ${activeTheme.name}`),
            h('label', null,
              h('input', { type: 'radio', checked: mode === 'new', onChange: () => setMode('new') }),
              ' Save as new theme'),
          ),
          mode === 'new' && h('div', { className: 'tweaker-save-new' },
            h('input', { type: 'text', placeholder: 'slug (e.g. midnight-rose)', value: newSlug, onChange: (e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')) }),
            h('input', { type: 'text', placeholder: 'Display name', value: newName, onChange: (e) => setNewName(e.target.value) }),
            h('input', { type: 'text', placeholder: 'Description (optional)', value: newDesc, onChange: (e) => setNewDesc(e.target.value) }),
            h('select', { value: newCat, onChange: (e) => setNewCat(e.target.value) },
              h('option', { value: 'Dark' }, 'Dark'),
              h('option', { value: 'Light' }, 'Light'),
              h('option', { value: 'High Contrast' }, 'High Contrast'),
            ),
          ),
          h('div', { className: 'tweaker-save-summary' },
            h('div', null, `${tokenMutations.length} token mutation${tokenMutations.length === 1 ? '' : 's'}`),
            h('div', null, `${scopedOverrides.length} scoped override${scopedOverrides.length === 1 ? '' : 's'}`),
          ),
          err && h('p', { className: 'tweaker-err' }, err),
        ),
        h('div', { className: 'tweaker-modal-footer' },
          h('button', { className: 'tweaker-btn', onClick: onClose, disabled: saving }, 'Cancel'),
          h('button', {
            className: 'tweaker-btn tweaker-btn-primary',
            onClick: doSave, disabled: saving || (mode === 'new' && (!newSlug || !newName)),
          }, saving ? 'Saving…' : 'Save'),
        ),
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §14 React: Tweaker root
  // ══════════════════════════════════════════════════════════════════════════

  function TweakerRoot() {
    // The wrench button is always rendered — prominent in the nav next to the
    // theme switcher. `active` controls whether Tweak Mode is engaged (picker
    // running, inspector mounting on clicks).
    const [active, setActive] = useState(false);
    const [selection, setSelection] = useState(null);
    const [pendingChanges, setPendingChanges] = useState([]);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [toast, setToast] = useState(null);
    const [baselineTokens, setBaselineTokens] = useState({});
    const [navMount, setNavMount] = useState(null);
    const pickerRef = useRef(null);
    const activeThemeRef = useRef(activeThemeInfo());

    // On mount: snapshot baseline tokens, restore session, auto-activate if the
    // URL carries ?tweak=1 or a prior session is still live.
    useEffect(() => {
      setBaselineTokens(paletteSnapshot());
      const s = loadSession();
      if (s && s.pending && s.pending.length) {
        setPendingChanges(s.pending);
        setUndoStack(s.undoStack || []);
        setRedoStack(s.redoStack || []);
      }
      try {
        const url = new URL(window.location.href);
        const autoActivate =
          url.searchParams.get('tweak') === '1' ||
          localStorage.getItem(CFG.modeKey) === 'on';
        if (autoActivate) {
          localStorage.setItem(CFG.modeKey, 'on');
          loadLibs().then(() => setActive(true));
        }
      } catch {}
    }, []);

    // Find or create the nav mount point (a span next to the theme-switcher).
    // On pages without a [data-theme-switcher], fall back to a fixed-position
    // floater in the top-right corner.
    useEffect(() => {
      function findOrCreateMount() {
        const ts = document.querySelector('[data-theme-switcher]');
        if (ts && ts.parentElement) {
          let mount = ts.parentElement.querySelector('[data-tweaker-mount]');
          if (!mount) {
            mount = document.createElement('span');
            mount.setAttribute('data-tweaker-mount', '');
            mount.setAttribute(CFG.chromeAttr, '');
            ts.parentElement.insertBefore(mount, ts);
          }
          setNavMount(mount);
          return true;
        }
        return false;
      }
      if (findOrCreateMount()) return;
      // Observe for the theme-switcher to be created (React-rendered nav).
      const obs = new MutationObserver(() => { if (findOrCreateMount()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => obs.disconnect();
    }, []);

    // Re-apply pending changes to the page when they change.
    useEffect(() => {
      if (!active) return;
      const overrides = pendingChanges.filter(c => c.kind === 'scoped');
      renderScopedOverrides(overrides);
      const tokenMutations = pendingChanges.filter(c => c.kind === 'token' && c.tokenName);
      // Apply all token mutations (overwriting any prior)
      for (const m of tokenMutations) applyGlobalTokenMutation(m.tokenName, m.newValue);
      saveSession({ pending: pendingChanges, undoStack, redoStack, at: Date.now() });
    }, [pendingChanges, active]);

    // Set up picker.
    useEffect(() => {
      if (!active) return;
      pickerRef.current = createPicker({
        onSelect: (el) => {
          const selector = generateSelector(el);
          setSelection({ element: el, selector, tokens: elementTokens(el) });
        },
      });
      pickerRef.current.start();
      return () => pickerRef.current && pickerRef.current.stop();
    }, [active]);

    // Keyboard: Cmd-Z / Cmd-Shift-Z / Escape.
    useEffect(() => {
      if (!active) return;
      function onKey(e) {
        if (e.key === 'Escape') {
          if (saveOpen) setSaveOpen(false);
          else if (reviewOpen) setReviewOpen(false);
          else if (selection) setSelection(null);
        }
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo(); else undo();
        }
      }
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [active, saveOpen, reviewOpen, selection, undoStack, redoStack]);

    function applyChange(change) {
      change.id = change.id || uuid();
      change.at = Date.now();
      setPendingChanges((prev) => {
        // If a change for the same token/selector+property already exists, replace it.
        const key = change.kind === 'token' ? `t|${change.tokenName}` : `s|${change.selector}|${change.property}`;
        const existing = prev.find(c => (c.kind === 'token' ? `t|${c.tokenName}` : `s|${c.selector}|${c.property}`) === key);
        if (existing) return prev.map(c => c === existing ? change : c);
        return [...prev, change];
      });
      setUndoStack((s) => [...s, change]);
      setRedoStack([]);
    }

    function onEdit(change) {
      if (change.kind === 'token' && !change.tokenName) {
        // No token detected; fall back to scoped
        change.kind = 'scoped';
        change.scope = 'scoped';
      }
      applyChange(change);
    }

    function undo() {
      if (!undoStack.length) return;
      const last = undoStack[undoStack.length - 1];
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [...s, last]);
      setPendingChanges((prev) => prev.filter(c => c.id !== last.id));
      // Rollback applied preview
      if (last.kind === 'token' && last.tokenName) {
        const baseline = baselineTokens[last.tokenName];
        if (baseline) applyGlobalTokenMutation(last.tokenName, baseline);
        else clearGlobalTokenMutation(last.tokenName);
      }
    }

    function redo() {
      if (!redoStack.length) return;
      const next = redoStack[redoStack.length - 1];
      setRedoStack((s) => s.slice(0, -1));
      setUndoStack((s) => [...s, next]);
      setPendingChanges((prev) => [...prev, next]);
    }

    function discardAll() {
      if (!confirm('Discard all pending changes?')) return;
      for (const c of pendingChanges.filter(c => c.kind === 'token' && c.tokenName)) {
        const baseline = baselineTokens[c.tokenName];
        if (baseline) applyGlobalTokenMutation(c.tokenName, baseline);
        else clearGlobalTokenMutation(c.tokenName);
      }
      setPendingChanges([]); setUndoStack([]); setRedoStack([]);
      renderScopedOverrides([]);
      clearSession();
    }

    function onSaved(result) {
      setSaveOpen(false); setReviewOpen(false);
      setPendingChanges([]); setUndoStack([]); setRedoStack([]);
      clearSession();
      renderScopedOverrides([]);
      setToast({ kind: 'success', msg: `Saved ${result.tokenMutations} token${result.tokenMutations === 1 ? '' : 's'} + ${result.scopedOverrides} override${result.scopedOverrides === 1 ? '' : 's'} to ${result.slug}.` });
      setTimeout(() => setToast(null), 4000);
      if (result.mode === 'overwrite') {
        // Reload theme CSS to pick up persisted changes
        const link = document.getElementById(CFG.themeStylesheetId);
        if (link) link.href = link.href.split('?')[0] + '?t=' + Date.now();
      }
    }

    function onValidationFail(output) {
      setToast({ kind: 'error', msg: 'Validator rejected save. See console for details.' });
      console.error('[tweaker] validator output:\n' + output);
      setTimeout(() => setToast(null), 8000);
    }

    function deactivate() {
      localStorage.removeItem(CFG.modeKey);
      if (pickerRef.current) pickerRef.current.stop();
      setActive(false);
      setSelection(null);
    }

    function activate() {
      localStorage.setItem(CFG.modeKey, 'on');
      loadLibs().then(() => setActive(true));
    }

    // Nav wrench button — prominently placed next to the theme switcher when
    // a nav is present; floating top-right otherwise.
    const navBtn = h('button', {
      className: 'tweaker-nav-btn' + (active ? ' is-on' : '') + (navMount ? '' : ' tweaker-nav-btn--floating'),
      [CFG.chromeAttr]: '',
      onClick: active ? deactivate : activate,
      title: active ? 'Exit Tweak Mode (Esc)' : 'Enter Tweak Mode — edit the current theme',
      'aria-pressed': active ? 'true' : 'false',
    },
      h('i', { className: 'fa-solid ' + (active ? 'fa-xmark' : 'fa-wrench'), 'aria-hidden': 'true' }),
      h('span', { className: 'tweaker-nav-btn-label' }, active ? 'Exit' : 'Tweak'),
    );

    return h(React.Fragment, null,
      navMount ? ReactDOM.createPortal(navBtn, navMount) : navBtn,
      active && h(React.Fragment, null,
        selection && h(Inspector, {
          selection,
          onClose: () => setSelection(null),
          onEdit,
          activeTheme: activeThemeRef.current,
          pendingChanges,
          history: {
            undo, redo,
            canUndo: undoStack.length > 0,
            canRedo: redoStack.length > 0,
          },
        }),
        pendingChanges.length > 0 && h('div', { className: 'tweaker-action-bar', [CFG.chromeAttr]: '' },
          h('span', null, `${pendingChanges.length} pending change${pendingChanges.length === 1 ? '' : 's'}`),
          h('button', { className: 'tweaker-btn-sm', onClick: discardAll }, 'Discard'),
          h('button', { className: 'tweaker-btn tweaker-btn-primary', onClick: () => setReviewOpen(true) }, 'Review & Save'),
        ),
        h(ReviewModal, {
          open: reviewOpen, onClose: () => setReviewOpen(false),
          pendingChanges, activeTheme: activeThemeRef.current, baselineTokens,
          onAccept: (tweak) => {
            if (tweak) {
              applyChange({
                kind: 'token', scope: 'global',
                tokenName: tweak.tokenName, oldValue: baselineTokens[tweak.tokenName],
                newValue: tweak.proposedValue, source: 'ai-review',
                aiRationale: tweak.rationale,
              });
            } else {
              setReviewOpen(false);
              setSaveOpen(true);
            }
          },
        }),
        h(SaveModal, {
          open: saveOpen, onClose: () => setSaveOpen(false),
          pendingChanges, activeTheme: activeThemeRef.current,
          onSaved, onValidationFail,
        }),
        toast && h('div', { className: `tweaker-toast tweaker-toast-${toast.kind}`, [CFG.chromeAttr]: '' }, toast.msg),
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §15 Activation — mount the root
  // ══════════════════════════════════════════════════════════════════════════

  function mount() {
    let host = document.getElementById('tweaker-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tweaker-root';
      host.setAttribute(CFG.chromeAttr, '');
      document.body.appendChild(host);
    }
    const root = ReactDOM.createRoot(host);
    root.render(h(TweakerRoot));
  }

  // Wait for the main app's nav to exist, so the wrench has somewhere to live.
  function whenNavReady() {
    const found = document.querySelector(CFG.navSelector);
    if (found) { mount(); return; }
    const obs = new MutationObserver(() => {
      if (document.querySelector(CFG.navSelector)) {
        obs.disconnect();
        mount();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', whenNavReady);
  } else {
    whenNavReady();
  }
})();
