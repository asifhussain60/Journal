/**
 * toast.js — single notification layer for the journal app.
 *
 * Backed by Sonner (https://sonner.emilkowal.ski/). Mounts one <Toaster /> into
 * #notify-root and exposes an imperative API on `window.notify` so both the
 * React SPA shell (site/index.html) and the vanilla itinerary pages
 * (site/itineraries/*.html) can fire toasts the same way.
 *
 * Public API (every method returns a toast id; safe to call before boot):
 *   window.notify.success(message, opts?)
 *   window.notify.error  (message, opts?)
 *   window.notify.warning(message, opts?)
 *   window.notify.info   (message, opts?)
 *   window.notify.message(message, opts?)              // neutral
 *   window.notify.promise(promise, { loading, success, error })
 *   window.notify.dismiss(id?)                         // one or all
 *
 * Loading model: Sonner is dynamic-imported from esm.sh with
 * ?external=react,react-dom so it reuses the UMD React instance on
 * window.React (mapped via the importmap in each HTML entry). Calls made
 * before Sonner mounts are queued and replayed on boot.
 */

(function () {
  if (window.__notifyBooted) return;
  window.__notifyBooted = true;

  const queue = [];
  const enqueue = (kind) => (a, b) => { queue.push([kind, a, b]); };
  window.notify = {
    _ready: false,
    success: enqueue('success'),
    error:   enqueue('error'),
    warning: enqueue('warning'),
    info:    enqueue('info'),
    message: enqueue('message'),
    promise: enqueue('promise'),
    dismiss: enqueue('dismiss'),
  };

  function installConsoleFallback() {
    const log = (level) => (m) => console.log('[' + level + ']', m);
    window.notify = {
      _ready: false,
      success: log('OK'),
      error:   log('ERR'),
      warning: log('WARN'),
      info:    log('INFO'),
      message: log('MSG'),
      promise: (p) => p,
      dismiss: () => {},
    };
  }

  // Itinerary pages load React asynchronously via tweaker-loader, so wait
  // until React + ReactDOM are present before mounting.
  let waited = 0;
  const STEP = 50, MAX = 10000;
  (function waitForReact() {
    if (window.React && window.ReactDOM && typeof window.ReactDOM.createRoot === 'function') {
      return boot();
    }
    waited += STEP;
    if (waited >= MAX) {
      console.warn('[NOTIFY] React unavailable after 10s; using console fallback');
      return installConsoleFallback();
    }
    setTimeout(waitForReact, STEP);
  })();

  async function boot() {
    try {
      const mod = await import('sonner');
      const { toast, Toaster } = mod;

      let host = document.getElementById('notify-root');
      if (!host) {
        host = document.createElement('div');
        host.id = 'notify-root';
        document.body.appendChild(host);
      }

      const root = window.ReactDOM.createRoot(host);
      root.render(window.React.createElement(Toaster, {
        position: 'bottom-right',
        richColors: true,
        closeButton: true,
        theme: 'dark',
        offset: 24,
        gap: 10,
        toastOptions: { className: 'journal-toast' },
      }));

      const api = {
        _ready: true,
        success: (m, o) => toast.success(m, o),
        error:   (m, o) => toast.error(m, o),
        warning: (m, o) => toast.warning(m, o),
        info:    (m, o) => toast.info(m, o),
        message: (m, o) => toast(m, o),
        promise: (p, o) => toast.promise(p, o),
        dismiss: (id)   => toast.dismiss(id),
      };
      window.notify = api;

      for (const [kind, a, b] of queue) {
        try { api[kind] && api[kind](a, b); } catch (_) { /* drain */ }
      }
      queue.length = 0;
      console.log('[NOTIFY] Sonner mounted');
    } catch (err) {
      console.warn('[NOTIFY] mount failed', err);
      installConsoleFallback();
    }
  }
})();
