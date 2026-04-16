// middleware/shadow-write.js — Phase 9 Stage B.
//
// Opt-in via SHADOW_WRITE_ENABLED=true. When enabled, queue + edit-log +
// usage writes are mirrored best-effort into ops.db. Failures are logged
// to server/logs/shadow-write-{YYYY-MM-DD}.log and never break requests.
//
// Design:
//   - This module exports two pieces:
//       shadowWriteEnabled()  — boolean gate
//       shadow(name, row)     — fire-and-forget helper
//   - Endpoints call shadow() after their file write succeeds. The
//     middleware itself is a passive logger (hooks res.json to observe
//     responses for /api/queue/:name POST and /api/trip-edit). This keeps
//     the file write as source of truth during Stage B and confines the DB
//     writes to a single module that Stage C later absorbs.
//
// During Stage B, parity is checked nightly by scripts/validate-parity.mjs.
// After ≥7 nights of zero divergence, Stage C flips SHADOW_WRITE_ENABLED
// off and moves these writes inline into the endpoint (see commit-c).

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shadowQueueRow,
  shadowDeadLetter,
  shadowEditLog,
  shadowUsageRow,
} from "../db/repositories/shadow.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, "../../logs");

export function shadowWriteEnabled() {
  const v = process.env.SHADOW_WRITE_ENABLED;
  return v === "1" || v === "true" || v === "yes";
}

async function logShadow(event) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(LOG_DIR, `shadow-write-${date}.log`);
    await appendFile(file, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, "utf8");
  } catch {
    // Logging is best-effort.
  }
}

/**
 * Fire-and-forget DB mirror. Callers pass the name + row; failures are
 * logged, never thrown.
 *
 * @param {'queue-pending'|'queue-voice-inbox'|'queue-itinerary-inbox'|'dead-letter'|'edit-log'|'usage'} kind
 * @param {object} payload — shape depends on kind
 */
export function shadow(kind, payload) {
  if (!shadowWriteEnabled()) return;
  try {
    let table;
    if (kind === "queue-pending") table = shadowQueueRow("pending", payload);
    else if (kind === "queue-voice-inbox") table = shadowQueueRow("voice-inbox", payload);
    else if (kind === "queue-itinerary-inbox") table = shadowQueueRow("itinerary-inbox", payload);
    else if (kind === "dead-letter") table = shadowDeadLetter(payload.queueName, payload.row);
    else if (kind === "edit-log") table = shadowEditLog(payload);
    else if (kind === "usage") table = shadowUsageRow(payload);
    else throw new Error(`unknown shadow kind "${kind}"`);
    logShadow({ kind, table, id: payload.id || payload.row?.id || null, result: "ok" });
  } catch (err) {
    logShadow({ kind, id: payload.id || payload.row?.id || null, result: "error", error: err?.message || String(err) });
  }
}
