// repositories/drain-log.js — Phase 9 Stage C narrow API.
import db from "../index.js";

const listRecent = db.prepare(`SELECT * FROM drain_log ORDER BY created_at DESC LIMIT ?`);
const listByOp = db.prepare(`SELECT * FROM drain_log WHERE operation = ? ORDER BY created_at DESC LIMIT ?`);
const insert = db.prepare(`INSERT INTO drain_log (id, schema_version, created_at, operation, queueName, itemId, status, resultSummary, divergence)
  VALUES (@id, @schema_version, @created_at, @operation, @queueName, @itemId, @status, @resultSummary, @divergence)`);

function parseRow(r) { return r ? { ...r, resultSummary: r.resultSummary ? JSON.parse(r.resultSummary) : null } : null; }

export function listRecentDrain(limit = 100) { return listRecent.all(limit).map(parseRow); }
export function listDrainByOp(op, limit = 100) { return listByOp.all(op, limit).map(parseRow); }

export function createDrain(row) {
  insert.run({
    id: row.id,
    schema_version: "1",
    created_at: row.created_at || new Date().toISOString(),
    operation: row.operation,
    queueName: row.queueName || null,
    itemId: row.itemId || null,
    status: row.status,
    resultSummary: row.resultSummary ? JSON.stringify(row.resultSummary) : null,
    divergence: row.divergence || null,
  });
}
