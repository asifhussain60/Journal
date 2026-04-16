// claude-client.js — thin browser client for the Babu Journal local proxy.
// Exposes window.BabuAI with promise-returning methods.
// Uses fetch only; no dependencies; safe to load before or after React.

(function () {
  const BASE = (window.BABU_AI_PROXY_URL || "http://localhost:3001").replace(/\/+$/, "");

  async function getJSON(path, init = {}) {
    const r = await fetch(BASE + path, init);
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

    async tripQA(message, tripContext) {
      if (!message || !message.trim()) throw new Error("tripQA: message is required");
      return getJSON("/api/trip-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, tripContext: tripContext ?? null }),
      });
    },

    async tripAssistant(message, tripContext, intent) {
      if (!message || !message.trim()) throw new Error("tripAssistant: message is required");
      return getJSON("/api/trip-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, tripContext: tripContext ?? null, intent: intent ?? null }),
      });
    },

    async referenceData(name) {
      if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("referenceData: invalid name");
      return getJSON(`/api/reference-data/${name}`);
    },

    async uploadReceipt(file) {
      if (!(file instanceof File || file instanceof Blob)) throw new Error("uploadReceipt: File required");
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(BASE + "/api/upload", { method: "POST", body: form });
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
