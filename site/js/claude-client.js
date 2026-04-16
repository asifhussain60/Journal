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

  async function getJSON(path, init = {}) {
    // credentials:include lets the Cloudflare Access auth cookie ride along
    // cross-origin from journal(.dev)?.kashkole.com to journal-api.kashkole.com.
    // Safe on localhost — ignored when there's no cookie to send.
    const r = await fetch(BASE + path, { credentials: "include", ...init });
    const body = await r.json().catch(() => ({ ok: false, error: "non-JSON response" }));
    if (!r.ok || body.ok === false) {
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

    async tripQA(message, tripSlugOrContext) {
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
      });
    },

    async tripAssistant(message, tripSlugOrContext, intent) {
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
      const r = await fetch(BASE + "/api/upload", { method: "POST", body: form, credentials: "include" });
      const body = await r.json().catch(() => ({ ok: false, error: "non-JSON response" }));
      if (!r.ok || body.ok === false) {
        const err = new Error(body.error || `HTTP ${r.status}`);
        err.status = r.status; err.body = body; throw err;
      }
      return body;
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
  };
})();
