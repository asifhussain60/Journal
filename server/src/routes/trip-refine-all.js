// routes/trip-refine-all.js — Refine All coordinator (D10, D11, D12).
// POST /api/trip-refine-all — fan-out to three orchestrators, atomic response.
// POST /api/trip-refine-field — single-field re-synth (D10 complement).

import express from "express";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadPrompt } from "../prompts/index.js";
import { readTripObj, tripYamlPath } from "../lib/trip-edit-ops.js";
import { getFingerprint, getFingerprintLight } from "../lib/voice-fingerprint.js";
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

function buildHighlightsInput({ fingerprintLight, title, subtitle, dateRange, captions }) {
  const prompt = loadPrompt("suggest-highlights");
  const system = prompt.system.replace("{{FINGERPRINT_LIGHT}}", fingerprintLight);
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

async function runHighlights(anthropic, input) {
  const { system, user } = buildHighlightsInput(input);
  const prompt = loadPrompt("suggest-highlights");
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
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("highlights: invalid JSON response");
  }
  const values = parsed.items
    .filter((s) => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  return {
    values,
    hashes: values.map(hashField),
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

    // Load fingerprints + corpus in parallel
    const [fingerprint, fingerprintLight, corpus] = await Promise.all([
      getFingerprint(),
      getFingerprintLight(),
      getTopN(50),
    ]);

    const input = { fingerprint, fingerprintLight, title, subtitle, dateRange, captions, corpus };

    // Fan-out with Promise.allSettled (D10 revised — no Promise.all)
    const [narrativeResult, highlightsResult, tagsResult] = await Promise.allSettled([
      runNarrative(anthropic, input),
      runHighlights(anthropic, input),
      runTags(anthropic, input),
    ]);

    // All-or-nothing: if any rejected, return errors
    const errors = {};
    if (narrativeResult.status === "rejected") errors.narrative = narrativeResult.reason?.message || String(narrativeResult.reason);
    if (highlightsResult.status === "rejected") errors.highlights = highlightsResult.reason?.message || String(highlightsResult.reason);
    if (tagsResult.status === "rejected") errors.tags = tagsResult.reason?.message || String(tagsResult.reason);

    if (Object.keys(errors).length > 0) {
      return res.status(500).json({ ok: false, errors });
    }

    const narrative = narrativeResult.value;
    const highlights = highlightsResult.value;
    const tags = tagsResult.value;

    // Filter AI tags through rejectedAiTags
    tags.values = tags.values.filter((t) => !rejectedSet.has(normalizeTag(t)));

    // Log usage
    logOrchestratorUsage(narrative.meta, "synthesize-trip-narrative", tripId, requestId);
    logOrchestratorUsage(highlights.meta, "suggest-highlights", tripId, requestId);
    logOrchestratorUsage(tags.meta, "suggest-tags", tripId, requestId);

    const response = {
      ok: true,
      narrative: { value: narrative.value, hash: narrative.hash, reasoning: narrative.reasoning },
      highlights: { values: highlights.values, hashes: highlights.hashes, reasoning: highlights.reasoning },
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
    if (!["narrative", "highlights"].includes(field)) {
      return res.status(400).json({ ok: false, error: "field must be 'narrative' or 'highlights'" });
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
      let result;
      if (field === "narrative") {
        const fingerprint = await getFingerprint();
        result = await runNarrative(anthropic, { fingerprint, title, subtitle, dateRange, captions });
        logOrchestratorUsage(result.meta, "synthesize-trip-narrative", tripId, requestId);
        const response = { ok: true, field, value: result.value, hash: result.hash, reasoning: result.reasoning };
        _idempotencyCache.set(idempKey, { ts: Date.now(), response });
        return res.json(response);
      } else {
        const fingerprintLight = await getFingerprintLight();
        result = await runHighlights(anthropic, { fingerprintLight, title, subtitle, dateRange, captions });
        logOrchestratorUsage(result.meta, "suggest-highlights", tripId, requestId);
        const response = { ok: true, field, values: result.values, hashes: result.hashes, reasoning: result.reasoning };
        _idempotencyCache.set(idempKey, { ts: Date.now(), response });
        return res.json(response);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
