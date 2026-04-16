// Babu Journal — local-only Claude API proxy.
// Listens on localhost:3001, reads the API key from macOS Keychain at startup,
// exposes a small surface for the journal site to call without exposing the key to the browser.
//
// Endpoints:
//   GET  /health                       — liveness + model + key-source diagnostics
//   POST /api/voice-test               — Babu-memoir smoke test
//   POST /api/refine                   — voice DNA refinement: { text, model?, max_tokens?, promptName? }
//   POST /api/chat                     — generic passthrough: { system?, messages, model?, max_tokens?, promptName? }
//   POST /api/trip-qa                  — Phase 3: Haiku-backed trip Q&A
//   POST /api/trip-assistant           — Phase 3: meta-router prompt for FloatingChat
//   GET  /api/reference-data/:name     — Phase 3: Tier 0 JSON files (tipping/currency/packing)
//
// CORS is locked to http://localhost:3000 (the `npx serve` dev port for site/).
//
// Phase 1 (§9 of _workspace/ideas/app-cowork-execution-plan.md) adds three
// cross-cutting concerns without changing existing endpoint shapes:
//   - usage-logger middleware (writes server/logs/usage.jsonl per request)
//   - rate-limit middleware (20 req/min per IP per endpoint, /health exempt)
//   - optional `promptName` body field on /api/refine and /api/chat (loader-backed)

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { loadAnthropicKey } from "./keychain.js";
import { makeRefineHandler } from "./refine.js";
import { usageLogger } from "./middleware/usage-logger.js";
import { buildRateLimiter } from "./middleware/rate-limit.js";
import { hasPrompt, loadPrompt } from "./prompts/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REFERENCE_DATA_DIR = path.resolve(__dirname, "./reference-data");
const REFERENCE_NAME_RE = /^[a-z][a-z0-9-]*$/;

const PORT = Number(process.env.PORT ?? 3001);
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://localhost:3000";

// --- Key load (fail fast if missing) ------------------------------------------
const { key: ANTHROPIC_API_KEY, source: KEY_SOURCE } = loadAnthropicKey();
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- App setup ---------------------------------------------------------------
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "1mb" }));

// Phase 1 middleware — order matters:
//   1. usage-logger first, so every request (even 429s from rate-limit) is logged.
//   2. rate-limit second, so logger captures the 429 as well.
app.use(usageLogger());
app.use(buildRateLimiter());

// --- Health ------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "babu-journal-proxy",
    model: DEFAULT_MODEL,
    keySource: KEY_SOURCE,
    port: PORT,
    allowedOrigin: ALLOWED_ORIGIN,
    ts: new Date().toISOString(),
  });
});

// --- Voice smoke test --------------------------------------------------------
// Minimal Babu-memoir prompt. Proves: key works, model responds, voice shape is roughly right.
const VOICE_TEST_SYSTEM = `You are helping Asif Hussain with his memoir "What I Wish Babu Taught Me".
Babu is Asif's father (never "Dad"). Tone: first-person, reflective, British-Pakistani cadence,
spare and honest, not sentimental. Reply in 2-3 sentences only.`;

app.post("/api/voice-test", async (_req, res) => {
  try {
    const msg = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 200,
      system: VOICE_TEST_SYSTEM,
      messages: [
        {
          role: "user",
          content:
            "Write one short opening line for a chapter about Babu's silence at the dinner table.",
        },
      ],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    res.json({
      ok: true,
      model: msg.model,
      stopReason: msg.stop_reason,
      usage: msg.usage,
      text,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Voice DNA refinement ----------------------------------------------------
// Body: { text, model?, max_tokens?, promptName? }
//   - No promptName → byte-identical behavior (delegates to refine.js with the
//     voice-fingerprint.md system). Required by §9.2 acceptance #3.
//   - promptName supplied → loader-backed path; uses prompt.system + {text} user
//     message. Required by §9.2 acceptance #4.
const legacyRefineHandler = makeRefineHandler(anthropic, DEFAULT_MODEL);

app.post("/api/refine", async (req, res) => {
  const { promptName, text, model, max_tokens } = req.body ?? {};
  if (promptName === undefined || promptName === null) {
    return legacyRefineHandler(req, res);
  }
  if (typeof promptName !== "string" || !hasPrompt(promptName)) {
    return res.status(400).json({ ok: false, error: `unknown promptName "${promptName}"` });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "text (non-empty string) is required" });
  }
  try {
    const prompt = loadPrompt(promptName);
    const msg = await anthropic.messages.create({
      model: model ?? DEFAULT_MODEL,
      max_tokens: max_tokens ?? 2048,
      system: prompt.system,
      messages: [{ role: "user", content: text }],
    });
    const refined = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    res.json({
      ok: true,
      model: msg.model,
      stopReason: msg.stop_reason,
      usage: msg.usage,
      promptName: prompt.name,
      refined,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Generic chat passthrough ------------------------------------------------
// Body: { system?, messages, model?, max_tokens?, promptName? }
//   - promptName wins over body.system when supplied (system field ignored with
//     no error — keeps the legacy shape stable when promptName is absent).
//   - No promptName → byte-identical behavior.
app.post("/api/chat", async (req, res) => {
  const { system, messages, model, max_tokens, promptName } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: "messages array is required" });
  }
  let effectiveSystem = system;
  let effectivePromptName = null;
  if (promptName !== undefined && promptName !== null) {
    if (typeof promptName !== "string" || !hasPrompt(promptName)) {
      return res.status(400).json({ ok: false, error: `unknown promptName "${promptName}"` });
    }
    const prompt = loadPrompt(promptName);
    effectiveSystem = prompt.system;
    effectivePromptName = prompt.name;
  }
  try {
    const msg = await anthropic.messages.create({
      model: model ?? DEFAULT_MODEL,
      max_tokens: max_tokens ?? 1024,
      system: effectiveSystem,
      messages,
    });
    res.json({
      ok: true,
      model: msg.model,
      stopReason: msg.stop_reason,
      usage: msg.usage,
      ...(effectivePromptName ? { promptName: effectivePromptName } : {}),
      content: msg.content,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Trip Q&A (Haiku) --------------------------------------------------------
// Body: { message, tripContext }
//   - tripContext is the active trip JSON (may be null). Stringified into the
//     head of the user message so the prompt's instructions stay deterministic.
//   - Pinned to claude-haiku-4-5-20251001 via prompt.model; caller may not override.
app.post("/api/trip-qa", async (req, res) => {
  const { message, tripContext } = req.body ?? {};
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "message (non-empty string) is required" });
  }
  req.body.promptName = "trip-qa"; // ensure usage-logger captures it
  try {
    const prompt = loadPrompt("trip-qa");
    const ctxBlock = tripContext
      ? `Active trip context (JSON):\n\`\`\`json\n${JSON.stringify(tripContext, null, 2)}\n\`\`\`\n\n`
      : "No active trip context is available.\n\n";
    const msg = await anthropic.messages.create({
      model: prompt.model ?? DEFAULT_MODEL,
      max_tokens: 600,
      system: prompt.system,
      messages: [{ role: "user", content: `${ctxBlock}Question: ${message.trim()}` }],
    });
    const response = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    res.json({ ok: true, model: msg.model, usage: msg.usage, promptName: prompt.name, response });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Trip assistant (router; Phase 6 will fully exercise) --------------------
// Body: { message, tripContext, intent? }
//   - intent is advisory; the model still classifies and answers.
app.post("/api/trip-assistant", async (req, res) => {
  const { message, tripContext, intent } = req.body ?? {};
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "message (non-empty string) is required" });
  }
  req.body.promptName = "trip-assistant";
  try {
    const prompt = loadPrompt("trip-assistant");
    const ctxBlock = tripContext
      ? `Active trip context (JSON):\n\`\`\`json\n${JSON.stringify(tripContext, null, 2)}\n\`\`\`\n\n`
      : "No active trip context is available.\n\n";
    const intentHint = intent ? `Caller-suggested intent: ${intent}\n` : "";
    const msg = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 600,
      system: prompt.system,
      messages: [{ role: "user", content: `${ctxBlock}${intentHint}Message: ${message.trim()}` }],
    });
    const response = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    res.json({
      ok: true,
      model: msg.model,
      usage: msg.usage,
      promptName: prompt.name,
      intent: intent ?? null,
      response,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Reference data (Tier 0, no model call) ----------------------------------
// GET /api/reference-data/:name → server/src/reference-data/{name}.json
// 404 if the file is missing. No usage-logger row of interest (model=null,
// tokens=0) — Tier 0 means zero token cost.
app.get("/api/reference-data/:name", async (req, res) => {
  const { name } = req.params;
  if (!REFERENCE_NAME_RE.test(name)) {
    return res.status(400).json({ ok: false, error: "invalid reference name" });
  }
  const filePath = path.join(REFERENCE_DATA_DIR, `${name}.json`);
  if (!filePath.startsWith(REFERENCE_DATA_DIR + path.sep)) {
    return res.status(400).json({ ok: false, error: "invalid reference path" });
  }
  try {
    const raw = await readFile(filePath, "utf8");
    res.type("application/json").send(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ ok: false, error: `reference data "${name}" not found` });
    }
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Start -------------------------------------------------------------------
app.listen(PORT, "127.0.0.1", () => {
  // keyed loopback only — do not bind to 0.0.0.0
  console.log(
    `[babu-journal-proxy] listening on http://127.0.0.1:${PORT}  model=${DEFAULT_MODEL}  keySource=${KEY_SOURCE}`
  );
});
