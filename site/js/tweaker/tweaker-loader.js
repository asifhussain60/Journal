/* ═══════════════════════════════════════════════════
   TWEAKER LOADER — conditional bootstrap.
   Included on every theme-consuming HTML page. Zero cost
   when the tweak flag is off; otherwise loads React (if
   missing) then tweaker.js.
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';
  try {
    const url = new URL(window.location.href);
    const flag =
      url.searchParams.get('tweak') === '1' ||
      localStorage.getItem('journal:tweaker:mode') === 'on';
    if (!flag) return;
  } catch { return; }

  // Resolve the /site/ base path relative to this HTML file.
  // site/index.html            → ''            (css at 'css/...', js at 'js/...')
  // site/itineraries/*.html    → '../'
  // trips/<slug>/itinerary.html → '../../site/'
  const path = window.location.pathname;
  let base = '';
  if (path.startsWith('/trips/')) base = '../../site/';
  else if (path.startsWith('/itineraries/') || /\/site\/itineraries\//.test(path)) base = '../';

  function addLink(href) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function addScript(src, opts, onload) {
    const s = document.createElement('script');
    s.src = src;
    if (opts && opts.crossOrigin) s.crossOrigin = opts.crossOrigin;
    if (onload) s.onload = onload;
    document.head.appendChild(s);
  }

  // Always inject the tweaker stylesheet when activating. Minimal cost.
  addLink(base + 'css/tweaker.css');

  function loadTweaker() {
    addScript(base + 'js/tweaker/tweaker.js');
  }

  if (window.React && window.ReactDOM) {
    loadTweaker();
  } else {
    addScript(
      'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
      { crossOrigin: 'anonymous' },
      function () {
        addScript(
          'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
          { crossOrigin: 'anonymous' },
          loadTweaker
        );
      }
    );
  }
})();
