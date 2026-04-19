// claude-client.js — thin browser client for the Babu Journal local proxy.
// Exposes window.BabuAI with promise-returning methods.
// Uses fetch only; no dependencies; safe to load before or after React.

(function () {
  // Env-aware API base. Localhost uses the dev proxy directly; every deployed
  // host (Cloudflare Pages production + preview) funnels through the single
  // Mac-hosted tunnel at journal-api.kashkole.com. Override via
  // window.BABU_AI_PROXY_URL before this script loads if you need to point at
  // something custom (e.g. a second machine's tunnel).
  function defaultApiBase() {
    if (typeof window === "undefined") return "http://localhost:3001";
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "") {
      return "http://localhost:3001";
    }
    return "https://journal-api.kashkole.com";
  }

  const BASE = (window.BABU_AI_PROXY_URL || defaultApiBase()).replace(/\/+$/, "");

  // Default fetch timeouts. Model-backed endpoints can genuinely take 30s+,
  // so we split into two classes. Callers can override via opts.timeoutMs.
  const DEFAULT_TIMEOUT_MS = 15000;
  const MODEL_TIMEOUT_MS = 60000;
  const MODEL_PATHS = [
    "/api/refine", "/api/chat", "/api/trip-qa", "/api/trip-assistant",
    "/api/trip-edit", "/api/ingest-itinerary", "/api/extract-receipt",
    "/api/theme-swatches", "/api/theme-review", "/api/find-alternatives",
    "/api/refine-reflection",
    "/api/log/", // per-entry refine lives under /api/log/:id/refine
  ];

  function pickTimeout(path, override) {
    if (Number.isFinite(override) && override > 0) return override;
    return MODEL_PATHS.some((p) => path.startsWith(p)) ? MODEL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  }

  async function getJSON(path, init = {}) {
    // credentials:include lets the Cloudflare Access auth cookie ride along
    // cross-origin from journal(.dev)?.kashkole.com to journal-api.kashkole.com.
    // Safe on localhost — ignored when there's no cookie to send.
    const { timeoutMs, signal: callerSignal, ...rest } = init;
    const timeout = pickTimeout(path, timeoutMs);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error(`request timed out after ${timeout}ms`)), timeout);
    // Honor a caller-supplied signal as well (e.g. request dedup).
    if (callerSignal) {
      if (callerSignal.aborted) ctl.abort(callerSignal.reason);
      else callerSignal.addEventListener("abort", () => ctl.abort(callerSignal.reason), { once: true });
    }

    let r;
    try {
      r = await fetch(BASE + path, { credentials: "include", signal: ctl.signal, ...rest });
    } catch (err) {
      clearTimeout(timer);
      if (err?.name === "AbortError") {
        const e = new Error(callerSignal?.aborted ? "request cancelled" : `request timed out after ${timeout}ms`);
        e.code = callerSignal?.aborted ? "cancelled" : "timeout";
        throw e;
      }
      const e = new Error(err?.message || "network error");
      e.code = "network";
      throw e;
    }
    clearTimeout(timer);

    const body = await r.json().catch(() => ({ ok: false, error: "non-JSON response" }));
    // Reject on HTTP error, explicit ok:false, OR an `error` field with ok:true
    // (some routes return soft errors as ok:true+error; treat them uniformly).
    if (!r.ok || body.ok === false || (body.ok && body.error)) {
      const msg = body.error || `HTTP ${r.status}`;
      const err = new Error(msg);
      err.status = r.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  window.BabuAI = {
    baseUrl: BASE,

    // Low-level helper. Handles timeout, AbortController plumbing, credential
    // cookies, and the ok:false / error-field normalization. Prefer this over
    // raw fetch anywhere in the app that calls the cowork server.
    //   request(path, { method, headers, body, signal, timeoutMs })
    async request(path, init = {}) {
      return getJSON(path, init);
    },

    async health() {
      return getJSON("/health");
    },

    async voiceTest() {
      return getJSON("/api/voice-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    },

    async refine(rawText, opts = {}) {
      if (!rawText || !rawText.trim()) throw new Error("refine: rawText is required");
      return getJSON("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText, ...opts }),
      });
    },

    async chat(payload) {
      return getJSON("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },

    async tripQA(message, tripSlugOrContext, opts = {}) {
      if (!message || !message.trim()) throw new Error("tripQA: message is required");
      const body = { message };
      if (typeof tripSlugOrContext === 'string') {
        body.tripSlug = tripSlugOrContext;
      } else if (tripSlugOrContext) {
        body.tripSlug = tripSlugOrContext.slug || null;
      }
      return getJSON("/api/trip-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
      });
    },

    async tripAssistant(message, tripSlugOrContext, intent, opts = {}) {
      if (!message || !message.trim()) throw new Error("tripAssistant: message is required");
      const body = { message, intent: intent ?? null };
      if (typeof tripSlugOrContext === 'string') {
        body.tripSlug = tripSlugOrContext;
      } else if (tripSlugOrContext) {
        body.tripSlug = tripSlugOrContext.slug || null;
      }
      return getJSON("/api/trip-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
      });
    },

    async tripFull(slug) {
      if (!slug) throw new Error("tripFull: slug is required");
      return getJSON(`/api/trip/${slug}/full`);
    },

    async referenceData(name) {
      if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("referenceData: invalid name");
      return getJSON(`/api/reference-data/${name}`);
    },

    async uploadReceipt(file) {
      if (!(file instanceof File || file instanceof Blob)) throw new Error("uploadReceipt: File required");
      const form = new FormData();
      form.append("file", file);
      // Intentional long timeout: multipart upload can be slow on mobile networks.
      return getJSON("/api/upload", { method: "POST", body: form, timeoutMs: 60000 });
    },

    async extractReceipt(imagePath) {
      if (!imagePath) throw new Error("extractReceipt: imagePath required");
      return getJSON("/api/extract-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath }),
      });
    },

    async ingestItinerary(itineraryText) {
      if (!itineraryText || !itineraryText.trim()) throw new Error("ingestItinerary: text required");
      return getJSON("/api/ingest-itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryText }),
      });
    },

    async tripEdit(message, tripSlugOrContext, opts = {}) {
      if (!message || !message.trim()) throw new Error("tripEdit: message required");
      const body = { message, dryRun: opts.dryRun !== false };
      if (typeof tripSlugOrContext === 'string') {
        body.tripSlug = tripSlugOrContext;
      } else if (tripSlugOrContext) {
        body.tripSlug = tripSlugOrContext.slug || null;
      }
      return getJSON("/api/trip-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
      });
    },

    async tripEditRevert(patchId, tripSlug) {
      if (!patchId) throw new Error("tripEditRevert: patchId required");
      return getJSON("/api/trip-edit/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patchId, tripSlug: tripSlug ?? null }),
      });
    },

    async editLogGet() {
      return getJSON("/api/edit-log");
    },

    async queuePost(name, row) {
      return getJSON(`/api/queue/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
    },

    async queueGet(name) {
      return getJSON(`/api/queue/${name}`);
    },

    // Phase 11a+ — per-entry note / review mutations on pending.json rows.
    async logPatch(id, patch) {
      if (!id) throw new Error("logPatch: id required");
      return getJSON(`/api/log/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch || {}),
      });
    },

    // AI-refine a per-image note with trip + journal + voice-fingerprint context.
    // { note, persist? } — when persist, server writes refined to row.draft.prose.
    async logRefine(id, payload) {
      if (!id) throw new Error("logRefine: id required");
      return getJSON(`/api/log/${encodeURIComponent(id)}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
    },
  };
})();
