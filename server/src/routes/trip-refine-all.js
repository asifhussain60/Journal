// routes/trip-refine-all.js — Refine All coordinator (D10, D11, D12).
// POST /api/trip-refine-all — fan-out to two orchestrators (narrative + tags), atomic response.
// POST /api/trip-refine-field — single-field re-synth (D10 complement, narrative only).

import express from "express";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadPrompt } from "../prompts/index.js";
import { readTripObj, tripYamlPath } from "../lib/trip-edit-ops.js";
import { getFingerprint } from "../lib/voice-fingerprint.js";
import { getTopN } from "../lib/tag-corpus.js";
import { normalizeTag } from "../lib/tag-normalize.js";
import { hashField } from "../lib/hash-field.js";
import { extractJsonObject } from "../util/json.js";

// --- Caches ------------------------------------------------------------------

// Idempotency cache: (tripId, requestId) -> response, 60s TTL
const _idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 60_000;

// Captions-hash cache: hash(concat(sortedCaptions)) -> response, 15min TTL
const _captionsCache = new Map();
const CAPTIONS_CACHE_TTL_MS = 15 * 60_000;

function cleanCache(cache, ttl) {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > ttl) cache.delete(key);
  }
}

function captionsHash(photos) {
  const sorted = (photos || [])
    .map((p) => String(p.caption || "").trim())
    .filter(Boolean)
    .sort();
  return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex").slice(0, 32);
}

// --- Orchestrator runners ----------------------------------------------------

async function runOrchestrator(anthropic, promptName, userContent) {
  const prompt = loadPrompt(promptName);
  const startMs = Date.now();
  const msg = await anthropic.messages.create({
    model: prompt.model,
    max_tokens: 2048,
    system: prompt.system,
    messages: [{ role: "user", content: userContent }],
  });
  const latencyMs = Date.now() - startMs;
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return { text, model: msg.model, latencyMs, usage: msg.usage };
}

function buildNarrativeInput({ fingerprint, title, subtitle, dateRange, captions }) {
  const prompt = loadPrompt("synthesize-trip-narrative");
  const system = prompt.system.replace("{{FINGERPRINT}}", fingerprint);
  const userParts = [
    `Trip: ${title || "Untitled"}`,
    subtitle ? `Subtitle: ${subtitle}` : null,
    dateRange ? `Dates: ${dateRange}` : null,
    "",
    "Approved photo captions:",
    ...captions.map((c, i) => `${i + 1}. ${c}`),
  ].filter((l) => l !== null);
  return { system, user: userParts.join("\n") };
}

function buildTagsInput({ title, subtitle, dateRange, captions, corpus }) {
  const prompt = loadPrompt("suggest-tags");
  const corpusLines = corpus.length
    ? corpus.map((t) => `  ${t.displayForm} (${t.count})`).join("\n")
    : "  (no existing tags)";
  const userParts = [
    `Trip: ${title || "Untitled"}`,
    subtitle ? `Subtitle: ${subtitle}` : null,
    dateRange ? `Dates: ${dateRange}` : null,
    "",
    "Approved photo captions:",
    ...captions.map((c, i) => `${i + 1}. ${c}`),
    "",
    "Existing tag corpus (top 50):",
    corpusLines,
  ].filter((l) => l !== null);
  return { system: prompt.system, user: userParts.join("\n") };
}

async function runNarrative(anthropic, input) {
  const { system, user } = buildNarrativeInput(input);
  const prompt = loadPrompt("synthesize-trip-narrative");
  const startMs = Date.now();
  const msg = await anthropic.messages.create({
    model: prompt.model,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
  });
  const latencyMs = Date.now() - startMs;
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed.value !== "string") {
    throw new Error("narrative: invalid JSON response");
  }
  return {
    value: parsed.value.trim(),
    hash: hashField(parsed.value.trim()),
    reasoning: String(parsed.reasoning || "").trim(),
    meta: { model: msg.model, latencyMs, usage: msg.usage },
  };
}

async function runTags(anthropic, input) {
  const { system, user } = buildTagsInput(input);
  const prompt = loadPrompt("suggest-tags");
  const startMs = Date.now();
  const msg = await anthropic.messages.create({
    model: prompt.model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  const latencyMs = Date.now() - startMs;
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const parsed = extractJsonObject(text);
  if (!parsed || !Array.isArray(parsed.tags)) {
    throw new Error("tags: invalid JSON response");
  }
  // Re-normalize every tag server-side for safety
  const values = parsed.tags
    .filter((s) => typeof s === "string")
    .map((s) => normalizeTag(s))
    .filter(Boolean)
    .slice(0, 12);
  return {
    values,
    reasoning: String(parsed.reasoning || "").trim(),
    meta: { model: msg.model, latencyMs, usage: msg.usage },
  };
}

// --- Usage logging helper ----------------------------------------------------

function logOrchestratorUsage(meta, promptName, tripId, requestId) {
  // Best-effort structured log to stderr for now; E4 wires to usage table.
  const row = {
    promptName,
    model: meta.model,
    latencyMs: meta.latencyMs,
    inputTokens: meta.usage?.input_tokens || 0,
    outputTokens: meta.usage?.output_tokens || 0,
    tripId,
    requestId,
  };
  process.stderr.write(`[refine-all] ${JSON.stringify(row)}\n`);
}

// --- Router ------------------------------------------------------------------

export function createTripRefineAllRouter({ anthropic }) {
  const router = express.Router();

  // POST /api/trip-refine-all
  router.post("/api/trip-refine-all", async (req, res) => {
    // Feature flag gate
    if (process.env.REFINE_ALL_ENABLED !== "true") {
      return res.status(503).json({ ok: false, error: "refine-all disabled" });
    }
    if (!anthropic) {
      return res.status(503).json({ ok: false, error: "anthropic client not configured" });
    }

    const { tripId, requestId, baseVersion, photos, title, subtitle, dateRange } = req.body || {};
    if (!tripId || typeof tripId !== "string") {
      return res.status(400).json({ ok: false, error: "tripId required" });
    }
    if (!requestId || typeof requestId !== "string") {
      return res.status(400).json({ ok: false, error: "requestId required" });
    }

    // Idempotency check
    cleanCache(_idempotencyCache, IDEMPOTENCY_TTL_MS);
    const idempKey = `${tripId}:${requestId}`;
    const cached = _idempotencyCache.get(idempKey);
    if (cached) {
      return res.json(cached.response);
    }

    // Captions-hash memoization
    cleanCache(_captionsCache, CAPTIONS_CACHE_TTL_MS);
    const cHash = captionsHash(photos);
    const captionsCached = _captionsCache.get(`${tripId}:${cHash}`);
    if (captionsCached) {
      // Cache the response under idempotency key too
      _idempotencyCache.set(idempKey, { ts: Date.now(), response: captionsCached.response });
      return res.json(captionsCached.response);
    }

    // Load trip for rejectedAiTags
    let trip;
    try {
      trip = await readTripObj(tripId);
    } catch {
      trip = {};
    }
    const rejectedSet = new Set(
      (Array.isArray(trip.rejectedAiTags) ? trip.rejectedAiTags : []).map(normalizeTag)
    );

    // Build captions list from photos
    const captions = (photos || [])
      .map((p) => String(p.caption || "").trim())
      .filter(Boolean);
    if (!captions.length) {
      return res.status(400).json({ ok: false, error: "no captions in photos — approve some entries first" });
    }

    // Load fingerprint + corpus in parallel
    const [fingerprint, corpus] = await Promise.all([
      getFingerprint(),
      getTopN(50),
    ]);

    const input = { fingerprint, title, subtitle, dateRange, captions, corpus };

    // --- SSE mode (Accept: text/event-stream) ---
    const wantsSSE = (req.headers.accept || "").includes("text/event-stream");

    if (wantsSSE) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Run narrative with streaming API, tags in parallel
      const narrativePromise = (async () => {
        const { system, user } = buildNarrativeInput(input);
        const prompt = loadPrompt("synthesize-trip-narrative");
        const startMs = Date.now();
        let accumulated = "";

        const stream = await anthropic.messages.stream({
          model: prompt.model,
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: user }],
        });

        let tokenBatch = "";
        let tokenCount = 0;
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            const text = event.delta.text;
            accumulated += text;
            tokenBatch += text;
            tokenCount++;
            // Flush every 16 tokens or more
            if (tokenCount >= 16) {
              send("narrative.delta", { text: tokenBatch });
              tokenBatch = "";
              tokenCount = 0;
            }
          }
        }
        // Flush remaining
        if (tokenBatch) send("narrative.delta", { text: tokenBatch });

        const finalMsg = await stream.finalMessage();
        const latencyMs = Date.now() - startMs;
        const parsed = extractJsonObject(accumulated.trim());
        if (!parsed || typeof parsed.value !== "string") {
          throw new Error("narrative: invalid JSON response");
        }
        const result = {
          value: parsed.value.trim(),
          hash: hashField(parsed.value.trim()),
          reasoning: String(parsed.reasoning || "").trim(),
          meta: { model: finalMsg.model, latencyMs, usage: finalMsg.usage },
        };
        send("narrative.done", { value: result.value, hash: result.hash, reasoning: result.reasoning });
        return result;
      })();

      const tagsPromise = runTags(anthropic, input).then((r) => {
        r.values = r.values.filter((t) => !rejectedSet.has(normalizeTag(t)));
        send("tags.done", { values: r.values, reasoning: r.reasoning });
        return r;
      });

      const [nResult, tResult] = await Promise.allSettled([narrativePromise, tagsPromise]);

      const errors = {};
      if (nResult.status === "rejected") errors.narrative = nResult.reason?.message || String(nResult.reason);
      if (tResult.status === "rejected") errors.tags = tResult.reason?.message || String(tResult.reason);

      if (Object.keys(errors).length > 0) {
        send("error", { errors });
        res.end();
        return;
      }

      // Log usage
      logOrchestratorUsage(nResult.value.meta, "synthesize-trip-narrative", tripId, requestId);
      logOrchestratorUsage(tResult.value.meta, "suggest-tags", tripId, requestId);

      const response = {
        ok: true,
        narrative: { value: nResult.value.value, hash: nResult.value.hash, reasoning: nResult.value.reasoning },
        tags: { values: tResult.value.values, reasoning: tResult.value.reasoning },
      };

      _idempotencyCache.set(idempKey, { ts: Date.now(), response });
      _captionsCache.set(`${tripId}:${cHash}`, { ts: Date.now(), response });

      send("complete", response);
      res.end();
      return;
    }

    // --- Batch JSON mode (default) ---

    // Fan-out with Promise.allSettled (D10 revised — no Promise.all)
    const [narrativeResult, tagsResult] = await Promise.allSettled([
      runNarrative(anthropic, input),
      runTags(anthropic, input),
    ]);

    // All-or-nothing: if any rejected, return errors
    const errors = {};
    if (narrativeResult.status === "rejected") errors.narrative = narrativeResult.reason?.message || String(narrativeResult.reason);
    if (tagsResult.status === "rejected") errors.tags = tagsResult.reason?.message || String(tagsResult.reason);

    if (Object.keys(errors).length > 0) {
      return res.status(500).json({ ok: false, errors });
    }

    const narrative = narrativeResult.value;
    const tags = tagsResult.value;

    // Filter AI tags through rejectedAiTags
    tags.values = tags.values.filter((t) => !rejectedSet.has(normalizeTag(t)));

    // Log usage
    logOrchestratorUsage(narrative.meta, "synthesize-trip-narrative", tripId, requestId);
    logOrchestratorUsage(tags.meta, "suggest-tags", tripId, requestId);

    const response = {
      ok: true,
      narrative: { value: narrative.value, hash: narrative.hash, reasoning: narrative.reasoning },
      tags: { values: tags.values, reasoning: tags.reasoning },
    };

    // Cache under both keys
    _idempotencyCache.set(idempKey, { ts: Date.now(), response });
    _captionsCache.set(`${tripId}:${cHash}`, { ts: Date.now(), response });

    res.json(response);
  });

  // POST /api/trip-refine-field — single-field Re-synth (D10 complement, A8)
  router.post("/api/trip-refine-field", async (req, res) => {
    if (process.env.REFINE_ALL_ENABLED !== "true") {
      return res.status(503).json({ ok: false, error: "refine-all disabled" });
    }
    if (!anthropic) {
      return res.status(503).json({ ok: false, error: "anthropic client not configured" });
    }

    const { tripId, requestId, field, photos, title, subtitle, dateRange } = req.body || {};
    if (!tripId || !requestId || !field) {
      return res.status(400).json({ ok: false, error: "tripId, requestId, and field are required" });
    }
    if (field !== "narrative") {
      return res.status(400).json({ ok: false, error: "field must be 'narrative'" });
    }

    // Idempotency
    cleanCache(_idempotencyCache, IDEMPOTENCY_TTL_MS);
    const idempKey = `${tripId}:${requestId}:${field}`;
    const cached = _idempotencyCache.get(idempKey);
    if (cached) return res.json(cached.response);

    const captions = (photos || [])
      .map((p) => String(p.caption || "").trim())
      .filter(Boolean);
    if (!captions.length) {
      return res.status(400).json({ ok: false, error: "no captions" });
    }

    try {
      const fingerprint = await getFingerprint();
      const result = await runNarrative(anthropic, { fingerprint, title, subtitle, dateRange, captions });
      logOrchestratorUsage(result.meta, "synthesize-trip-narrative", tripId, requestId);
      const response = { ok: true, field, value: result.value, hash: result.hash, reasoning: result.reasoning };
      _idempotencyCache.set(idempKey, { ts: Date.now(), response });
      return res.json(response);
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // GET /api/tag-corpus/top — cross-trip tag corpus for typeahead
  router.get("/api/tag-corpus/top", async (_req, res) => {
    try {
      const top = await getTopN(50);
      res.json({ ok: true, top });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
