/* ═══════════════════════════════════════════════════
   THEME SWITCHER — runtime theme swap

   Changes the href of <link id="theme-stylesheet"> on click,
   persists the choice in localStorage, and re-renders the UI.
   Auto-mounts into any element with the `data-theme-switcher`
   attribute (works for both static HTML and React-rendered navs
   via a MutationObserver).

   To add a new theme:
     1. Create site/css/themes/theme-<id>.css
     2. Add a THEMES entry below (id, file, name, description,
        category, 4–5 swatch hex values)
     Done. Appears in the switcher automatically.
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  const STORAGE_KEY = 'journal:theme';
  const LINK_ID = 'theme-stylesheet';

  const THEMES = [
    {
      id: 'rose-mauve-night',
      file: 'theme.css',
      name: 'Rose & Mauve Night',
      description: 'Deep plum · lavender · rose',
      category: 'Dark',
      swatches: ['#2b2240', '#c6a6ff', '#ffb0cc', '#f4d49c']
    },
    {
      id: 'tales-dark-green',
      file: 'theme-tales-dark.css',
      name: 'Tales Dark Green',
      description: 'WrapBootstrap Tales · charcoal + green',
      category: 'Dark',
      swatches: ['#262626', '#3ab159', '#61c57b', '#e3c567']
    },
    {
      id: 'daylight',
      file: 'theme-daylight.css',
      name: 'Daylight',
      description: 'Warm paper · amber · rose',
      category: 'Light',
      swatches: ['#F8F5EF', '#B46432', '#C46A7A', '#C89B5E']
    }
  ];

  // ─── State helpers ─────────────────────────────────────────

  function resolveThemePath(themeFile) {
    const link = document.getElementById(LINK_ID);
    if (!link) return 'css/themes/' + themeFile;
    const currentHref = link.getAttribute('href');
    const prefix = currentHref.substring(0, currentHref.lastIndexOf('/') + 1);
    return prefix + themeFile;
  }

  function findThemeByFile(file) {
    return THEMES.find(t => file.endsWith('/' + t.file) || file.endsWith(t.file));
  }

  function getActiveTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const match = THEMES.find(t => t.id === saved);
      if (match) return match;
    }
    const link = document.getElementById(LINK_ID);
    if (link) {
      const match = findThemeByFile(link.getAttribute('href'));
      if (match) return match;
    }
    return THEMES[0];
  }

  function setTheme(themeId) {
    const theme = THEMES.find(t => t.id === themeId);
    if (!theme) return;
    const link = document.getElementById(LINK_ID);
    if (!link) {
      console.warn('[ThemeSwitcher] No <link id="' + LINK_ID + '"> on page — cannot swap theme.');
      return;
    }
    link.setAttribute('href', resolveThemePath(theme.file));
    localStorage.setItem(STORAGE_KEY, theme.id);
    document.documentElement.setAttribute('data-active-theme', theme.id);
    // Re-render all mounted switchers
    document.querySelectorAll('[data-theme-switcher]').forEach(renderInto);
    window.dispatchEvent(new CustomEvent('theme:changed', { detail: { theme } }));
  }

  // ─── Grouping ──────────────────────────────────────────────

  const CATEGORY_ORDER = ['Dark', 'Light', 'High Contrast', 'Vendor', 'Other'];

  function groupByCategory(themes) {
    const groups = new Map();
    CATEGORY_ORDER.forEach(cat => groups.set(cat, []));
    for (const t of themes) {
      const cat = groups.has(t.category) ? t.category : 'Other';
      groups.get(cat).push(t);
    }
    // Drop empty categories
    for (const [cat, arr] of groups) {
      if (arr.length === 0) groups.delete(cat);
    }
    return groups;
  }

  // ─── Rendering ─────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function swatchRow(colors, sizeClass) {
    return colors.map(c =>
      '<span class="theme-swatch ' + sizeClass + '" style="--swatch:' + escapeHtml(c) + '"></span>'
    ).join('');
  }

  function renderInto(container) {
    const active = getActiveTheme();
    const groups = groupByCategory(THEMES);

    const triggerDots = active.swatches.slice(0, 3)
      .map(c => '<span class="theme-swatch-dot" style="--swatch:' + escapeHtml(c) + '"></span>').join('');

    const groupsHtml = Array.from(groups.entries()).map(([cat, themes]) => {
      const items = themes.map(t => {
        const isActive = t.id === active.id;
        return (
          '<button class="theme-switcher-option' + (isActive ? ' active' : '') +
            '" data-theme-id="' + escapeHtml(t.id) +
            '" role="menuitemradio" aria-checked="' + isActive + '">' +
            '<span class="theme-swatches">' + swatchRow(t.swatches, 'theme-swatch-bar') + '</span>' +
            '<span class="theme-meta">' +
              '<span class="theme-name">' + escapeHtml(t.name) + '</span>' +
              '<span class="theme-desc">' + escapeHtml(t.description) + '</span>' +
            '</span>' +
            (isActive ? '<i class="fa-solid fa-check theme-check" aria-hidden="true"></i>' : '') +
          '</button>'
        );
      }).join('');
      return (
        '<div class="theme-switcher-group">' +
          '<div class="theme-switcher-group-label">' + escapeHtml(cat) + '</div>' +
          items +
        '</div>'
      );
    }).join('');

    container.classList.add('theme-switcher');
    container.innerHTML =
      '<button class="theme-switcher-trigger" type="button" aria-label="Change theme" aria-haspopup="true" aria-expanded="false">' +
        '<span class="theme-switcher-trigger-dots">' + triggerDots + '</span>' +
        '<span class="theme-switcher-trigger-label">' + escapeHtml(active.name) + '</span>' +
        '<i class="fa-solid fa-chevron-down theme-switcher-trigger-chevron" aria-hidden="true"></i>' +
      '</button>' +
      '<div class="theme-switcher-panel" role="menu" aria-label="Theme options">' +
        '<div class="theme-switcher-header">' +
          '<i class="fa-solid fa-palette" aria-hidden="true"></i>' +
          '<span>Theme</span>' +
          '<span class="theme-switcher-count">' + THEMES.length + '</span>' +
        '</div>' +
        groupsHtml +
      '</div>';

    const trigger = container.querySelector('.theme-switcher-trigger');
    const panel = container.querySelector('.theme-switcher-panel');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !panel.classList.contains('open');
      // Close all other open panels
      document.querySelectorAll('.theme-switcher-panel.open').forEach(p => {
        if (p !== panel) {
          p.classList.remove('open');
          const t = p.parentElement.querySelector('.theme-switcher-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
      panel.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    container.querySelectorAll('.theme-switcher-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTheme(btn.dataset.themeId);
      });
    });
  }

  // ─── Global listeners (bound once) ─────────────────────────

  function closeAllPanels() {
    document.querySelectorAll('.theme-switcher-panel.open').forEach(panel => {
      panel.classList.remove('open');
      const trigger = panel.parentElement.querySelector('.theme-switcher-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.theme-switcher')) closeAllPanels();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPanels();
  });

  // ─── Boot ──────────────────────────────────────────────────

  // Apply saved theme immediately (before any UI paints)
  (function applySavedTheme() {
    const active = getActiveTheme();
    document.documentElement.setAttribute('data-active-theme', active.id);
    const link = document.getElementById(LINK_ID);
    if (!link) return;
    const currentHref = link.getAttribute('href');
    if (!currentHref.endsWith('/' + active.file) && !currentHref.endsWith(active.file)) {
      link.setAttribute('href', resolveThemePath(active.file));
    }
  })();

  function autoMount() {
    document.querySelectorAll('[data-theme-switcher]').forEach(el => {
      if (!el.classList.contains('theme-switcher') || !el.children.length) renderInto(el);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
  // Watch for React-rendered mount points arriving later
  const observer = new MutationObserver(() => {
    document.querySelectorAll('[data-theme-switcher]:not(.theme-switcher)').forEach(renderInto);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Public API (mostly for debugging / programmatic use)
  window.BabuTheme = {
    themes: THEMES.slice(),
    get active() { return getActiveTheme(); },
    set: setTheme
  };
})();
