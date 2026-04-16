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
//   POST /api/upload                   — Phase 4: multipart receipt image → trips/{slug}/receipts/
//   POST /api/extract-receipt          — Phase 4: Vision (macOS) first, Haiku fallback
//   POST /api/ingest-itinerary         — Phase 5: Haiku parse of pasted itinerary → skeleton JSON
//   POST /api/queue/:name              — Phase 4+5: pending | voice-inbox | itinerary-inbox
//   GET  /api/queue/:name              — Phase 4+5: read queue items
//   POST /api/trip-edit                — Phase 6: intent classify → structured diffs + JSON Patch
//   POST /api/trip-edit/revert         — Phase 6: idempotent revert by edit-log id
//   GET  /api/edit-log                 — Phase 6: read trips/{slug}/edit-log.json
//   GET  /api/usage/summary            — Phase 8: monthly spend + per-endpoint breakdown
//   GET  /api/dead-letter              — Phase 8: list all dead-letter entries for active trip
//   POST /api/queue/:name/replay       — Phase 8: replay one dead-letter entry back to its queue
//   POST /api/dead-letter/discard      — Phase 8: delete a dead-letter entry without replay
//
// CORS is locked to http://localhost:3000 (the `npx serve` dev port for site/).

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import multer from "multer";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import Anthropic from "@anthropic-ai/sdk";
import { loadAnthropicKey } from "./keychain.js";
import { makeRefineHandler } from "./refine.js";
import { usageLogger } from "./middleware/usage-logger.js";
import { buildRateLimiter } from "./middleware/rate-limit.js";
import { throttleBudget } from "./middleware/throttle-budget.js";
import { hasPrompt, loadPrompt } from "./prompts/index.js";
import {
  TRIPS_DIR,
  getActiveTripSlug,
  sniffImageExt,
  extToMediaType,
  appendQueueRow,
  readQueue,
  macVisionOcr,
} from "./receipts.js";
import {
  applyTripEdit,
  revertTripEdit,
  readTripObj,
  readEditLog,
} from "./trip-edit-ops.js";
import { getUsageSummary } from "./usage-summary.js";
import {
  listDeadLetter,
  replayDeadLetterEntry,
  deleteDeadLetterEntry,
} from "./dead-letter.js";
import { shadow } from "./middleware/shadow-write.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REFERENCE_DATA_DIR = path.resolve(__dirname, "./reference-data");
const REFERENCE_NAME_RE = /^[a-z][a-z0-9-]*$/;

const PORT = Number(process.env.PORT ?? 3001);
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://localhost:3000";
const MONTHLY_CAP = Number(process.env.MONTHLY_CAP ?? 50);

// --- Key load (fail fast if missing) ------------------------------------------
const { key: ANTHROPIC_API_KEY, source: KEY_SOURCE } = loadAnthropicKey();
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- App setup ---------------------------------------------------------------
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "1mb" }));

// Phase 1 + 8 middleware — order matters:
//   1. usage-logger first, so every request (even throttled/rate-limited) is logged.
//   2. rate-limit second, so logger captures the 429 as well.
//   3. throttle-budget last, after rate-limit and logging. Adds X-Budget-State
//      header to every response; enforces soft/hard policies from Phase 8.
app.use(usageLogger());
app.use(buildRateLimiter());
app.use(throttleBudget({ monthlyCAP: MONTHLY_CAP }));

// --- Phase 4: schema validators + multer (upload) ----------------------------
const SCHEMA_DIR = path.resolve(__dirname, "./schemas");
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
// All app-writable queues share the pending.schema.json shape; kind + payload
// differ per queue. voice-inbox, itinerary-inbox, and pending all validate
// against the same schema, which already enforces the kind enum.
const QUEUE_VALIDATORS = new Map();
{
  const pendingSchema = JSON.parse(
    await readFile(path.join(SCHEMA_DIR, "pending.schema.json"), "utf8")
  );
  const pendingValidator = ajv.compile(pendingSchema);
  for (const name of ["pending", "voice-inbox", "itinerary-inbox"]) {
    QUEUE_VALIDATORS.set(name, pendingValidator);
  }
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype || "")) {
      return cb(new Error("only image/* uploads are accepted"));
    }
    cb(null, true);
  },
});

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

// --- Phase 4: receipt pipeline ----------------------------------------------

// POST /api/upload — multipart image upload. Sniffs MIME, writes to
// trips/{activeSlug}/receipts/{uuid}.{ext}. Returns relative imagePath.
app.post("/api/upload", (req, res, next) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ ok: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "file field is required" });
    }
    const sniffedExt = sniffImageExt(req.file.buffer);
    if (!sniffedExt) {
      return res.status(400).json({ ok: false, error: "uploaded bytes are not a recognized image" });
    }
    try {
      const slug = await getActiveTripSlug();
      const id = randomUUID();
      const receiptsDir = path.join(TRIPS_DIR, slug, "receipts");
      await mkdir(receiptsDir, { recursive: true });
      const absPath = path.join(receiptsDir, `${id}.${sniffedExt}`);
      await writeFile(absPath, req.file.buffer);
      const imagePath = `trips/${slug}/receipts/${id}.${sniffedExt}`;
      res.json({ ok: true, id, imagePath, bytes: req.file.buffer.length, ext: sniffedExt });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });
});

// POST /api/extract-receipt — { imagePath } → { extracted, visionUsed }.
// Tries macOS Vision OCR first; falls back to Haiku vision when unavailable
// or when Vision returned no text. res.locals.visionUsed is picked up by the
// usage-logger so the JSONL row reflects which path ran.
app.post("/api/extract-receipt", async (req, res) => {
  const { imagePath } = req.body ?? {};
  if (typeof imagePath !== "string" || !imagePath.length) {
    return res.status(400).json({ ok: false, error: "imagePath is required" });
  }
  const rel = imagePath.replace(/^[./\\]+/, "");
  if (!rel.startsWith("trips/")) {
    return res.status(400).json({ ok: false, error: "imagePath must be under trips/" });
  }
  const absPath = path.resolve(TRIPS_DIR, rel.replace(/^trips\//, ""));
  if (!absPath.startsWith(TRIPS_DIR + path.sep)) {
    return res.status(400).json({ ok: false, error: "imagePath escapes trips/" });
  }

  req.body.promptName = "extract-receipt";
  try {
    const prompt = loadPrompt("extract-receipt");
    const buf = await readFile(absPath);
    const ext = sniffImageExt(buf);
    if (!ext) return res.status(400).json({ ok: false, error: "file is not a recognized image" });

    const ocrText = await macVisionOcr(absPath);
    const visionUsed = typeof ocrText === "string" && ocrText.trim().length > 0;
    res.locals.visionUsed = visionUsed;

    const userContent = visionUsed
      ? [
          {
            type: "text",
            text: `OCR output (macOS Vision):\n\n${ocrText.trim()}\n\nReturn the JSON object now.`,
          },
        ]
      : [
          {
            type: "image",
            source: { type: "base64", media_type: extToMediaType(ext), data: buf.toString("base64") },
          },
          { type: "text", text: "Extract receipt fields from this image. Return the JSON object now." },
        ];

    const msg = await anthropic.messages.create({
      model: prompt.model ?? DEFAULT_MODEL,
      max_tokens: 600,
      system: prompt.system,
      messages: [{ role: "user", content: userContent }],
    });
    const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    let extracted = null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[0]);
      } catch {
        extracted = null;
      }
    }
    res.json({
      ok: true,
      model: msg.model,
      usage: msg.usage,
      promptName: prompt.name,
      visionUsed,
      extracted,
      rawText: extracted ? undefined : raw,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Phase 5: itinerary paste parse (Haiku) ---------------------------------
// Body: { itineraryText }
//   - Returns { ok, extracted: { flights, hotels, highlights, dates } }.
//   - On JSON-parse failure, returns ok:false with a reason (keeps the UI happy
//     path deterministic — one specific error the user can act on).
app.post("/api/ingest-itinerary", async (req, res) => {
  const { itineraryText } = req.body ?? {};
  if (typeof itineraryText !== "string" || itineraryText.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "itineraryText (non-empty string) is required" });
  }
  req.body.promptName = "ingest-itinerary";
  try {
    const prompt = loadPrompt("ingest-itinerary");
    const msg = await anthropic.messages.create({
      model: prompt.model ?? DEFAULT_MODEL,
      max_tokens: 1200,
      system: prompt.system,
      messages: [{ role: "user", content: itineraryText.trim() }],
    });
    const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    let extracted = null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[0]);
      } catch {
        extracted = null;
      }
    }
    if (!extracted) {
      return res.json({
        ok: false,
        model: msg.model,
        usage: msg.usage,
        promptName: prompt.name,
        error: "structure ambiguous — model output did not parse as JSON",
        rawText: raw,
      });
    }
    res.json({
      ok: true,
      model: msg.model,
      usage: msg.usage,
      promptName: prompt.name,
      extracted,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// POST /api/queue/:name — schema-validated append to trips/{slug}/{name}.json.
// GET  /api/queue/:name — read items; returns [] when file missing.
const QUEUE_NAME_RE = /^[a-z][a-z0-9-]*$/;

app.post("/api/queue/:name", async (req, res) => {
  const { name } = req.params;
  if (!QUEUE_NAME_RE.test(name) || !QUEUE_VALIDATORS.has(name)) {
    return res.status(404).json({ ok: false, error: `unknown queue "${name}"` });
  }
  const row = req.body;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return res.status(400).json({ ok: false, error: "request body must be a queue row object" });
  }
  if (row.schemaVersion !== "1") {
    return res.status(400).json({ ok: false, error: 'schemaVersion must be "1"' });
  }
  const validate = QUEUE_VALIDATORS.get(name);
  if (!validate(row)) {
    return res.status(400).json({ ok: false, error: "schema validation failed", details: validate.errors });
  }
  try {
    const slug = row.tripSlug || (await getActiveTripSlug());
    const { count } = await appendQueueRow(slug, name, row);
    shadow(`queue-${name}`, { ...row, tripSlug: slug });
    res.json({ ok: true, id: row.id, count, tripSlug: slug });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

app.get("/api/queue/:name", async (req, res) => {
  const { name } = req.params;
  if (!QUEUE_NAME_RE.test(name) || !QUEUE_VALIDATORS.has(name)) {
    return res.status(404).json({ ok: false, error: `unknown queue "${name}"` });
  }
  try {
    const slug = await getActiveTripSlug();
    const items = await readQueue(slug, name);
    res.json({ ok: true, items, tripSlug: slug });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Phase 6: bounded itinerary editing -------------------------------------
//
// Intent classification rule:
//   1. Tier 0 keyword match on edit verbs ("edit", "change", "move", "add",
//      "remove", "update", "modify", "set", "delete"). Match → intent=edit.
//   2. Otherwise fallback to the Sonnet trip-edit prompt which classifies
//      itself. The model returns { intent, summary, diffs, patch }.
const EDIT_KEYWORDS_RE = /\b(edit|change|move|add|remove|update|modify|set|delete|rename)\b/i;

app.post("/api/trip-edit", async (req, res) => {
  const { message, dryRun, tripContext } = req.body ?? {};
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "message (non-empty string) is required" });
  }
  req.body.promptName = "trip-edit";

  const tier0 = EDIT_KEYWORDS_RE.test(message);
  try {
    const prompt = loadPrompt("trip-edit");
    const ctxBlock = tripContext
      ? `Active trip (JSON):\n\`\`\`json\n${JSON.stringify(tripContext, null, 2)}\n\`\`\`\n\n`
      : "No active trip context is available.\n\n";
    const userBlock = `${ctxBlock}Caller keyword hint: ${tier0 ? "edit" : "none"}\nMessage: ${message.trim()}`;
    const msg = await anthropic.messages.create({
      model: prompt.model ?? DEFAULT_MODEL,
      max_tokens: 1400,
      system: prompt.system,
      messages: [{ role: "user", content: userBlock }],
    });
    const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    let proposed = null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { proposed = JSON.parse(jsonMatch[0]); } catch { proposed = null; }
    }
    if (!proposed) {
      return res.json({
        ok: false, model: msg.model, usage: msg.usage, promptName: prompt.name,
        error: "model output did not parse as JSON", rawText: raw,
      });
    }

    const intent = proposed.intent || (tier0 ? "edit" : "unknown");
    const response = {
      ok: true,
      model: msg.model,
      usage: msg.usage,
      promptName: prompt.name,
      intent,
      summary: proposed.summary ?? null,
      proposed: {
        diffs: Array.isArray(proposed.diffs) ? proposed.diffs : [],
        patch: Array.isArray(proposed.patch) ? proposed.patch : [],
      },
    };

    if (dryRun || intent !== "edit" || !response.proposed.patch.length) {
      return res.json(response);
    }

    try {
      const slug = tripContext?.slug || (await getActiveTripSlug());
      const applied = await applyTripEdit(slug, { intent: proposed.summary || message.trim(), patch: response.proposed.patch });
      if (!applied.ok) {
        shadow("edit-log", { id: applied.id || `fail-${Date.now()}`, tripSlug: slug, intent: response.intent, userMessage: message, proposedDiff: response.proposed, status: "failed", error: applied.error });
        return res.json({ ...response, applied: false, applyError: applied.error, applyErrors: applied.errors });
      }
      shadow("edit-log", { id: applied.id, tripSlug: slug, intent: response.intent, userMessage: message, proposedDiff: response.proposed, appliedPatch: response.proposed.patch, status: "applied", snapshotId: applied.snapshotId });
      return res.json({ ...response, applied: true, editId: applied.id });
    } catch (err) {
      return res.json({ ...response, applied: false, applyError: err?.message ?? String(err) });
    }
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) });
  }
});

app.post("/api/trip-edit/revert", async (req, res) => {
  const { patchId } = req.body ?? {};
  if (typeof patchId !== "string" || !patchId.length) {
    return res.status(400).json({ ok: false, error: "patchId is required" });
  }
  try {
    const slug = req.body?.tripSlug || (await getActiveTripSlug());
    const result = await revertTripEdit(slug, patchId);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error, errors: result.errors });
    shadow("edit-log", { id: result.id || `rev-${Date.now()}`, tripSlug: slug, intent: "revert", userMessage: `revert ${patchId}`, appliedPatch: result.inversePatch, status: "reverted" });
    return res.json({ ok: true, tripSlug: slug, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

app.get("/api/edit-log", async (_req, res) => {
  try {
    const slug = await getActiveTripSlug();
    const items = await readEditLog(slug);
    res.json({ ok: true, items, tripSlug: slug });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Phase 8: dead-letter surfacing + replay + discard -----------------------
app.get("/api/dead-letter", async (_req, res) => {
  try {
    const slug = await getActiveTripSlug();
    const items = await listDeadLetter(slug);
    res.json({ ok: true, tripSlug: slug, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

app.post("/api/queue/:name/replay", async (req, res) => {
  try {
    const { name } = req.params;
    const { id } = req.body ?? {};
    if (!QUEUE_VALIDATORS.has(name)) {
      return res.status(404).json({ ok: false, error: `unknown queue "${name}"` });
    }
    if (typeof id !== "string" || !id.length) {
      return res.status(400).json({ ok: false, error: "id (string) is required" });
    }
    const slug = await getActiveTripSlug();
    const result = await replayDeadLetterEntry(slug, name, id);
    res.json({ ok: true, tripSlug: slug, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

app.post("/api/dead-letter/discard", async (req, res) => {
  try {
    const { queueName, id } = req.body ?? {};
    if (typeof queueName !== "string" || !queueName.length) {
      return res.status(400).json({ ok: false, error: "queueName (string) is required" });
    }
    if (typeof id !== "string" || !id.length) {
      return res.status(400).json({ ok: false, error: "id (string) is required" });
    }
    const slug = await getActiveTripSlug();
    const result = await deleteDeadLetterEntry(slug, queueName, id);
    res.json({ ok: true, tripSlug: slug, queueName, id, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// --- Phase 8: usage summary --------------------------------------------------
// GET /api/usage/summary — monthly spend derived from usage.jsonl + pricing
// table. Feeds BudgetPill, UsageModal, and the throttle-budget middleware.
app.get("/api/usage/summary", async (_req, res) => {
  try {
    const summary = await getUsageSummary({ monthlyCAP: MONTHLY_CAP });
    res.set("X-Budget-State", summary.throttleState);
    res.json(summary);
  } catch (err) {
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
