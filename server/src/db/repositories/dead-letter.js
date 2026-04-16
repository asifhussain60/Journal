// repositories/dead-letter.js — Phase 9 Stage C narrow API.
import db from "../index.js";

const listAll = db.prepare(`SELECT * FROM dead_letter WHERE tripSlug = ? ORDER BY created_at DESC`);
const listByQueue = db.prepare(`SELECT * FROM dead_letter WHERE tripSlug = ? AND queueName = ? ORDER BY created_at DESC`);
const getById = db.prepare(`SELECT * FROM dead_letter WHERE id = ?`);
const insert = db.prepare(`INSERT INTO dead_letter (id, schema_version, created_at, tripSlug, queueName, originalId, reason, data)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @queueName, @originalId, @reason, @data)`);
const del = db.prepare(`DELETE FROM dead_letter WHERE id = ?`);

function parseRow(r) { return r ? { ...r, data: r.data ? JSON.parse(r.data) : null } : null; }

export function listDeadLetterDB(tripSlug, queueName = null) {
  return (queueName ? listByQueue.all(tripSlug, queueName) : listAll.all(tripSlug)).map(parseRow);
}

export function getDeadLetter(id) { return parseRow(getById.get(id)); }

export function createDeadLetter({ tripSlug, queueName, row, reason }) {
  insert.run({
    id: `${queueName}:${row.id}`,
    schema_version: "1",
    created_at: new Date().toISOString(),
    tripSlug,
    queueName,
    originalId: row.id,
    reason: reason || null,
    data: JSON.stringify(row),
  });
}

export function deleteDeadLetter(queueName, originalId) {
  del.run(`${queueName}:${originalId}`);
}
