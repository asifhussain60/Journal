// Babu Journal — local-only Claude API proxy.
// Listens on localhost:3001, reads the API key from macOS Keychain at startup,
// exposes a small surface for the journal site to call without exposing the key to the browser.
//
// Endpoints:
//   GET  /health              — liveness + model + key-source diagnostics (no secrets)
//   POST /api/voice-test      — Babu-memoir smoke test (proves wiring + voice)
//   POST /api/refine          — voice DNA refinement: { text, model?, max_tokens? }
//   POST /api/chat            — generic passthrough: { system?, messages, model?, max_tokens? }
//
// CORS is locked to http://localhost:3000 (the `npx serve` dev port for site/).

import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { loadAnthropicKey } from "./keychain.js";
import { makeRefineHandler } from "./refine.js";

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
// Body: { text: string, model?: string, max_tokens?: number }
// Reads reference/voice-fingerprint.md as the system prompt on each request.
app.post("/api/refine", makeRefineHandler(anthropic, DEFAULT_MODEL));

// --- Generic chat passthrough ------------------------------------------------
// Body: { system?: string, messages: [...], model?: string, max_tokens?: number }
app.post("/api/chat", async (req, res) => {
  const { system, messages, model, max_tokens } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: "messages array is required" });
  }
  try {
    const msg = await anthropic.messages.create({
      model: model ?? DEFAULT_MODEL,
      max_tokens: max_tokens ?? 1024,
      system,
      messages,
    });
    res.json({
      ok: true,
      model: msg.model,
      stopReason: msg.stop_reason,
      usage: msg.usage,
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
