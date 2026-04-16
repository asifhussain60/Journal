// db/repositories/shadow.js — Phase 9 Stage B shadow-write helpers.
//
// Best-effort inserts mirroring queue POSTs into the DB. Called from the
// shadow-write middleware *after* the file write has succeeded. If the DB
// write fails, we log and carry on — the request succeeds regardless.
//
// Stage B only. Stage C moves these inserts inline into the endpoint's
// primary write path and swaps the DB back in as source of truth.

import db from "../index.js";

const upsertPending = db.prepare(`
  INSERT INTO pending_queue
    (id, schema_version, created_at, tripSlug, type, data, status, memoryWorthy, updatedAt)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @type, @data, @status, @memoryWorthy, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    data = excluded.data,
    memoryWorthy = excluded.memoryWorthy,
    updatedAt = excluded.updatedAt
`);

const upsertVoice = db.prepare(`
  INSERT INTO voice_inbox
    (id, schema_version, created_at, tripSlug, text, status, transcript, durationSec)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @text, @status, @transcript, @durationSec)
  ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    transcript = excluded.transcript
`);

const upsertItinerary = db.prepare(`
  INSERT INTO itinerary_inbox
    (id, schema_version, created_at, tripSlug, rawText, status, parsedData)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @rawText, @status, @parsedData)
  ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    parsedData = excluded.parsedData
`);

const upsertDeadLetter = db.prepare(`
  INSERT INTO dead_letter
    (id, schema_version, created_at, tripSlug, queueName, originalId, reason, data)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @queueName, @originalId, @reason, @data)
  ON CONFLICT(id) DO UPDATE SET
    reason = excluded.reason,
    data = excluded.data
`);

const upsertEditLog = db.prepare(`
  INSERT INTO edit_log
    (id, schema_version, created_at, tripSlug, intent, userMessage, proposedDiff, appliedPatch, status, snapshotId, error)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @intent, @userMessage, @proposedDiff, @appliedPatch, @status, @snapshotId, @error)
  ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    appliedPatch = excluded.appliedPatch,
    error = excluded.error
`);

const insertUsage = db.prepare(`
  INSERT OR IGNORE INTO usage
    (id, schema_version, created_at, endpoint, method, model, promptName, tokensIn, tokensOut, durationMs, statusCode, visionUsed)
  VALUES (@id, @schema_version, @created_at, @endpoint, @method, @model, @promptName, @tokensIn, @tokensOut, @durationMs, @statusCode, @visionUsed)
`);

function nowIso() {
  return new Date().toISOString();
}

export function shadowQueueRow(queueName, row) {
  const base = {
    id: row.id,
    schema_version: row.schemaVersion || "1",
    created_at: row.createdAt,
    tripSlug: row.tripSlug,
    status: row.status || "pending",
    updatedAt: nowIso(),
  };
  if (queueName === "pending") {
    upsertPending.run({
      ...base,
      type: row.kind,
      data: JSON.stringify(row),
      memoryWorthy: row.memoryWorthy ? 1 : 0,
    });
    return "pending_queue";
  }
  if (queueName === "voice-inbox") {
    const payload = row.payload || {};
    upsertVoice.run({
      ...base,
      text: payload.text || "",
      transcript: payload.transcript || null,
      durationSec: payload.durationSec == null ? null : Number(payload.durationSec),
    });
    return "voice_inbox";
  }
  if (queueName === "itinerary-inbox") {
    const payload = row.payload || {};
    upsertItinerary.run({
      ...base,
      rawText: payload.rawText || "",
      parsedData: payload.parsedSkeleton ? JSON.stringify(payload.parsedSkeleton) : null,
    });
    return "itinerary_inbox";
  }
  throw new Error(`shadowQueueRow: unknown queue "${queueName}"`);
}

export function shadowDeadLetter(queueName, row) {
  const dl = row.deadLetter || {};
  upsertDeadLetter.run({
    id: `${queueName}:${row.id}`,
    schema_version: "1",
    created_at: dl.failedAt || nowIso(),
    tripSlug: row.tripSlug,
    queueName,
    originalId: row.id,
    reason: dl.reason || null,
    data: JSON.stringify(row),
  });
  return "dead_letter";
}

export function shadowEditLog(row) {
  upsertEditLog.run({
    id: row.id,
    schema_version: row.schemaVersion || "1",
    created_at: row.createdAt || nowIso(),
    tripSlug: row.tripSlug,
    intent: row.intent || "unknown",
    userMessage: row.userMessage || null,
    proposedDiff: row.proposedDiff ? JSON.stringify(row.proposedDiff) : null,
    appliedPatch: row.appliedPatch ? JSON.stringify(row.appliedPatch) : null,
    status: row.status,
    snapshotId: row.snapshotId || null,
    error: row.error || null,
  });
  return "edit_log";
}

export function shadowUsageRow(row) {
  insertUsage.run({
    id: row.id || `${row.timestamp}-${row.endpoint}-${Math.random().toString(36).slice(2, 8)}`,
    schema_version: "1",
    created_at: row.timestamp || nowIso(),
    endpoint: row.endpoint,
    method: row.method || "GET",
    model: row.model || null,
    promptName: row.promptName || null,
    tokensIn: Number(row.tokensIn || 0),
    tokensOut: Number(row.tokensOut || 0),
    durationMs: Number(row.durationMs || 0),
    statusCode: row.statusCode == null ? null : Number(row.statusCode),
    visionUsed: row.visionUsed ? 1 : 0,
  });
  return "usage";
}
