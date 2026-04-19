// Babu Journal — local-only Claude API proxy.
// Listens on localhost:3001, reads the API key from macOS Keychain at startup,
// exposes a small surface for the journal site to call without exposing the key
// to the browser.
//
// Endpoints (handlers live in ./routes/*):
//   GET  /health                       — core.js
//   POST /api/voice-test               — core.js
//   POST /api/refine                   — core.js
//   POST /api/chat                     — core.js
//   GET  /api/reference-data/:name     — core.js
//   POST /api/trip-qa                  — trip.js
//   POST /api/trip-assistant           — trip.js
//   POST /api/ingest-itinerary         — trip.js
//   GET  /api/trip/:slug/full          — trip.js
//   POST /api/trip-edit                — trip-edit.js
//   POST /api/trip-edit/revert         — trip-edit.js
//   GET  /api/edit-log                 — trip-edit.js
//   POST /api/find-alternatives        — trip-edit.js
//   POST /api/verify-venue             — trip-edit.js
//   POST /api/swap-event               — trip-edit.js
//   POST /api/insert-event             — trip-edit.js
//   POST /api/suggest-insert           — trip-edit.js
//   POST /api/delete-event             — trip-edit.js
//   POST /api/upload                   — receipts.js
//   POST /api/extract-receipt          — receipts.js
//   POST /api/queue/:name              — queue.js
//   GET  /api/queue/:name              — queue.js
//   POST /api/queue/:name/replay       — queue.js
//   GET  /api/dead-letter              — queue.js
//   POST /api/dead-letter/discard      — queue.js
//   GET  /api/usage/summary            — usage.js
//   POST /api/distance-matrix          — distance.js
//   POST /api/theme-swatches           — theme.js (tweaker)
//   POST /api/theme-review             — theme.js (tweaker)
//   POST /api/theme-save               — theme.js (tweaker)
//   GET  /api/weather                  — weather.js (Open-Meteo)
//   GET  /api/log                       — log.js (Phase 11a)
//   POST /api/log/capture               — log.js (Phase 11a)
//   GET  /api/publish-sessions           — publish-sessions.js (Phase 11d.1)
//   GET  /api/publish-sessions/:id       — publish-sessions.js (Phase 11d.1)
//   POST /api/publish-sessions           — publish-sessions.js (Phase 11d.1)
//   PATCH /api/publish-sessions/:id      — publish-sessions.js (Phase 11d.1)
//   POST /api/publish-sessions/:id/abandon — publish-sessions.js (Phase 11d.1)
//   GET  /api/trip-spend                — trip-spend.js (YNAB)
//   GET  /api/config                    — core.js (feature flags)
//   POST /api/trip-refine-all            — trip-refine-all.js (Refine All coordinator)
//   POST /api/trip-refine-field          — trip-refine-all.js (single-field Re-synth)
//
// CORS is locked to ALLOWED_ORIGINS (defaults cover localhost + prod/dev Pages).

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import multer from "multer";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import Anthropic from "@anthropic-ai/sdk";
import { loadAnthropicKey } from "./lib/keychain.js";
import { usageLogger } from "./middleware/usage-logger.js";
import { buildRateLimiter } from "./middleware/rate-limit.js";
import { throttleBudget } from "./middleware/throttle-budget.js";
import { accessAuth } from "./middleware/access-auth.js";
import { createCoreRouter } from "./routes/core.js";
import { createTripRouter } from "./routes/trip.js";
import { createTripEditRouter } from "./routes/trip-edit.js";
import { createQueueRouter } from "./routes/queue.js";
import { createReceiptsRouter } from "./routes/receipts.js";
import { createUsageRouter } from "./routes/usage.js";
import { createDistanceRouter } from "./routes/distance.js";
import { createThemeRouter } from "./routes/theme.js";
import { createWeatherRouter } from "./routes/weather.js";
import { createTripSpendRouter } from "./routes/trip-spend.js";
import { createHolidayBudgetRouter } from "./routes/holiday-budget.js";
import { createLogRouter } from "./routes/log.js";
import { createPublishSessionsRouter } from "./routes/publish-sessions.js";
import { createDayoneRouter } from "./routes/dayone.js";
import { createTripRefineAllRouter } from "./routes/trip-refine-all.js";
import { createClassifyQueue } from "./lib/classify-queue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3001);
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
// ALLOWED_ORIGINS is a comma-separated list. Defaults cover local dev + both
// deployed hostnames (production + develop preview).
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  "http://localhost:3000,https://journal.kashkole.com,https://journal-dev.kashkole.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MONTHLY_CAP = Number(process.env.MONTHLY_CAP ?? 50);

// --- Key load (fail fast if missing) -----------------------------------------
const { key: ANTHROPIC_API_KEY, source: KEY_SOURCE } = loadAnthropicKey();
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- App setup ---------------------------------------------------------------
const app = express();
// Trust the loopback proxy so req.ip reflects the real origin when cloudflared
// forwards traffic to 127.0.0.1. Without this, req.ip is always "::ffff:127...".
app.set("trust proxy", "loopback");
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin not allowed: ${origin}`));
    },
    // credentials:true is required so the Cloudflare Access auth cookie rides
    // along on cross-origin fetches from journal(-dev)?.kashkole.com to
    // journal-api.kashkole.com.
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  })
);
app.use(express.json({ limit: "1mb" }));
// Access gate: deny before any logging/rate-limit work happens on unauth'd
// public traffic. Loopback bypasses; CF env vars absent = pass-through.
app.use(accessAuth());

// Middleware order — intentional:
//   0. accessAuth (above) — rejects unauth'd public traffic at the door.
//   1. usage-logger — captures every authenticated request (even throttled)
//      for the usage summary + budget cap.
//   2. rate-limit — so logger captures the 429 as well.
//   3. throttle-budget — after rate-limit and logging. Adds X-Budget-State
//      header to every response; enforces soft/hard policies from Phase 8.
app.use(usageLogger());
app.use(buildRateLimiter());
app.use(throttleBudget({ monthlyCAP: MONTHLY_CAP }));

// --- Schema validators + multer (upload) -------------------------------------
const SCHEMA_DIR = path.resolve(__dirname, "./schemas");
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
// All app-writable queues share the pending.schema.json shape; kind + payload
// differ per queue. voice-inbox, itinerary-inbox, and pending validate against
// the same schema, which already enforces the kind enum.
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

// Theme-save schema validator (Phase 10 — tweaker).
const themeSaveSchema = JSON.parse(
  await readFile(path.join(SCHEMA_DIR, "theme-save.schema.json"), "utf8")
);
const themeSaveValidator = ajv.compile(themeSaveSchema);

// Publish-session schema validator (Phase 11d.1 — PublishSession v1).
const publishSessionSchema = JSON.parse(
  await readFile(path.join(SCHEMA_DIR, "publish-session.schema.json"), "utf8")
);
const publishSessionValidator = ajv.compile(publishSessionSchema);

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

// --- Static: serve captured photos under /trips so the log view can render previews
//     (imagePath is stored as "trips/<slug>/photos/<file>" and the frontend fetches
//     it from this API host).
const REPO_ROOT = path.resolve(__dirname, "..", "..");
app.use("/trips", express.static(path.join(REPO_ROOT, "trips"), { fallthrough: true, maxAge: "1h" }));

// --- Phase 11b classify queue (in-process, async image kind classification)
const classifyQueue = createClassifyQueue({ anthropic });

// --- Static: serve shared/ modules so the client can import them via <script type="module">
app.use("/shared", express.static(path.join(REPO_ROOT, "shared"), {
  fallthrough: true,
  maxAge: "1h",
  setHeaders: (res) => res.setHeader("Content-Type", "text/javascript"),
}));

// --- Mount routers -----------------------------------------------------------
app.use(createCoreRouter({ anthropic, DEFAULT_MODEL, KEY_SOURCE, PORT, ALLOWED_ORIGINS }));
app.use(createTripRouter({ anthropic, DEFAULT_MODEL }));
app.use(createTripEditRouter({ anthropic, DEFAULT_MODEL }));
app.use(createQueueRouter({ queueValidators: QUEUE_VALIDATORS }));
app.use(createReceiptsRouter({ anthropic, DEFAULT_MODEL, upload }));
app.use(createUsageRouter({ MONTHLY_CAP }));
app.use(createDistanceRouter());
app.use(createThemeRouter({ anthropic, DEFAULT_MODEL, themeSaveValidator }));
app.use(createWeatherRouter());
app.use(createTripSpendRouter());
app.use(createHolidayBudgetRouter({ anthropic }));
app.use(createLogRouter({ queueValidators: QUEUE_VALIDATORS, anthropic, DEFAULT_MODEL, classifyQueue }));
app.use(createPublishSessionsRouter({ publishSessionValidator }));
app.use(createDayoneRouter());
app.use(createTripRefineAllRouter({ anthropic }));

// --- Start -------------------------------------------------------------------
app.listen(PORT, "127.0.0.1", () => {
  // keyed loopback only — do not bind to 0.0.0.0
  console.log(
    `[babu-journal-proxy] listening on http://127.0.0.1:${PORT}  model=${DEFAULT_MODEL}  keySource=${KEY_SOURCE}`
  );
});
