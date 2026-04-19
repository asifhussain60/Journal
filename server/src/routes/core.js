// routes/core.js — foundational endpoints:
//   GET  /health                  — liveness + key-source + gemini status
//   POST /api/voice-test          — Babu-memoir smoke test
//   POST /api/refine              — voice DNA refinement (legacy + promptName)
//   POST /api/chat                — generic passthrough
//   GET  /api/reference-data/:name — Tier 0 JSON files

import express from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeRefineHandler } from "../lib/refine.js";
import { getFingerprint } from "../lib/voice-fingerprint.js";
import { hasPrompt, loadPrompt } from "../prompts/index.js";
import { accessAuthStatus } from "../middleware/access-auth.js";
import { status as geminiStatus } from "../lib/gemini-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REFERENCE_DATA_DIR = path.resolve(__dirname, "../reference-data");
const REFERENCE_NAME_RE = /^[a-z][a-z0-9-]*$/;

const VOICE_TEST_SYSTEM = `You are helping Asif Hussain with his memoir "What I Wish Babu Taught Me".
Babu is Asif's father (never "Dad"). Tone: first-person, reflective, British-Pakistani cadence,
spare and honest, not sentimental. Reply in 2-3 sentences only.`;

export function createCoreRouter({ anthropic, DEFAULT_MODEL, KEY_SOURCE, PORT, ALLOWED_ORIGINS }) {
  const router = express.Router();
  const legacyRefineHandler = makeRefineHandler(anthropic, DEFAULT_MODEL);

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "babu-journal-proxy",
      model: DEFAULT_MODEL,
      keySource: KEY_SOURCE,
      port: PORT,
      allowedOrigins: ALLOWED_ORIGINS,
      access: accessAuthStatus(),
      gemini: geminiStatus(),
      ts: new Date().toISOString(),
    });
  });

  // Feature-flag surface for the frontend — only public-by-design flags.
  router.get("/api/config", (_req, res) => {
    res.json({
      refineAllEnabled: process.env.REFINE_ALL_ENABLED === "true",
    });
  });

  router.post("/api/voice-test", async (_req, res) => {
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

  // Body: { text, model?, max_tokens?, promptName? }
  //   - No promptName → byte-identical legacy behavior via refine.js.
  //   - promptName supplied → loader-backed path; uses prompt.system + {text} user.
  router.post("/api/refine", async (req, res) => {
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

  // POST /api/refine-reflection
  // Body: { draft?, entries: string[], title?, context?, date? }
  // If draft is blank/missing → generate from entries. If present → enhance it.
  router.post("/api/refine-reflection", async (req, res) => {
    const { draft, entries, title, context, date } = req.body ?? {};
    if (!Array.isArray(entries) || !entries.filter(Boolean).length) {
      return res.status(400).json({ ok: false, error: "entries (non-empty array of prose strings) is required" });
    }

    let fingerprint;
    try {
      fingerprint = await getFingerprint();
    } catch (err) {
      return res.status(500).json({ ok: false, error: `Could not load voice fingerprint: ${err.message}` });
    }

    const prompt = loadPrompt("refine-reflection");
    const system = prompt.system.replace("{{FINGERPRINT}}", fingerprint);

    const userParts = [];
    if (title) userParts.push(`Trip: ${title}`);
    if (context) userParts.push(`Context: ${context}`);
    if (date) userParts.push(`Date: ${date}`);

    const hasDraft = draft && typeof draft === "string" && draft.trim();
    if (hasDraft) {
      // Draft goes FIRST so the model treats it as primary content, not an afterthought.
      userParts.push("", "User's draft to refine (preserve the content, polish the voice):", draft.trim(), "");
    }

    userParts.push("Approved entries (context):");
    entries.filter(Boolean).forEach((e, i) => userParts.push(`${i + 1}. ${e}`));
    if (!hasDraft) {
      userParts.push("", "No draft provided — generate a reflection from the entries above.");
    }

    try {
      const msg = await anthropic.messages.create({
        model: prompt.model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userParts.join("\n") }],
      });
      const refined = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      res.json({
        ok: true,
        model: msg.model,
        usage: msg.usage,
        refined,
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // Body: { system?, messages, model?, max_tokens?, promptName? }
  //   - promptName wins over body.system when supplied.
  //   - No promptName → byte-identical behavior.
  router.post("/api/chat", async (req, res) => {
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

  // GET /api/reference-data/:name → server/src/reference-data/{name}.json
  // 404 if missing. No usage-logger row of interest — Tier 0 = zero token cost.
  router.get("/api/reference-data/:name", async (req, res) => {
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

  return router;
}
