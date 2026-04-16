// Babu Journal — local-only Claude API proxy.
// Listens on localhost:3001, reads the API key from macOS Keychain at startup,
// exposes a small surface for the journal site to call without exposing the key to the browser.
//
// Endpoints:
//   GET  /health              — liveness + model + key-source diagnostics (no secrets)
//   POST /api/voice-test      — Babu-memoir smoke test (proves wiring + voice)
//   POST /api/refine          — voice DNA refinement: { text, model?, max_tokens?, promptName? }
//   POST /api/chat            — generic passthrough: { system?, messages, model?, max_tokens?, promptName? }
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
import Anthropic from "@anthropic-ai/sdk";
import { loadAnthropicKey } from "./keychain.js";
import { makeRefineHandler } from "./refine.js";
import { usageLogger } from "./middleware/usage-logger.js";
import { buildRateLimiter } from "./middleware/rate-limit.js";
import { hasPrompt, loadPrompt } from "./prompts/index.js";

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

// --- Start -------------------------------------------------------------------
app.listen(PORT, "127.0.0.1", () => {
  // keyed loopback only — do not bind to 0.0.0.0
  console.log(
    `[babu-journal-proxy] listening on http://127.0.0.1:${PORT}  model=${DEFAULT_MODEL}  keySource=${KEY_SOURCE}`
  );
});
