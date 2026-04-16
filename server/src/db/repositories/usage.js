// repositories/usage.js — Phase 9 Stage C narrow API.
import db from "../index.js";

const listRecent = db.prepare(`SELECT * FROM usage ORDER BY created_at DESC LIMIT ?`);
const listByMonth = db.prepare(`SELECT * FROM usage WHERE created_at LIKE ?`);
const insert = db.prepare(`INSERT INTO usage (id, schema_version, created_at, endpoint, method, model, promptName, tokensIn, tokensOut, durationMs, statusCode, visionUsed)
  VALUES (@id, @schema_version, @created_at, @endpoint, @method, @model, @promptName, @tokensIn, @tokensOut, @durationMs, @statusCode, @visionUsed)`);

export function listRecentUsage(limit = 100) { return listRecent.all(limit); }
export function listUsageByMonth(yyyyMm) { return listByMonth.all(`${yyyyMm}%`); }

export function createUsage(row) {
  insert.run({
    id: row.id,
    schema_version: "1",
    created_at: row.timestamp || new Date().toISOString(),
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
}
