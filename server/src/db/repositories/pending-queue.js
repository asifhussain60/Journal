// repositories/pending-queue.js — Phase 9 Stage C narrow API for pending_queue.
//
// Stage C wires these into the /api/queue/pending endpoints when shadow-write
// parity is proven (≥7 nights zero divergence). Until then the file is still
// authoritative; these repos exist but are unused by production code paths.

import db from "../index.js";

const listByTrip = db.prepare(`SELECT * FROM pending_queue WHERE tripSlug = ? ORDER BY created_at ASC`);
const getById = db.prepare(`SELECT * FROM pending_queue WHERE id = ?`);
const insert = db.prepare(`INSERT INTO pending_queue (id, schema_version, created_at, tripSlug, type, data, status, memoryWorthy, updatedAt)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @type, @data, @status, @memoryWorthy, @updatedAt)`);
const updateStatus = db.prepare(`UPDATE pending_queue SET status = ?, updatedAt = ? WHERE id = ?`);
const del = db.prepare(`DELETE FROM pending_queue WHERE id = ?`);

function parseRow(r) { return r ? { ...r, data: r.data ? JSON.parse(r.data) : null, memoryWorthy: !!r.memoryWorthy } : null; }

export function listPending(tripSlug) { return listByTrip.all(tripSlug).map(parseRow); }
export function getPending(id) { return parseRow(getById.get(id)); }

export function createPending(row) {
  insert.run({
    id: row.id,
    schema_version: row.schemaVersion || "1",
    created_at: row.createdAt,
    tripSlug: row.tripSlug,
    type: row.kind,
    data: JSON.stringify(row),
    status: row.status || "pending",
    memoryWorthy: row.memoryWorthy ? 1 : 0,
    updatedAt: new Date().toISOString(),
  });
}

export function setPendingStatus(id, status) {
  updateStatus.run(status, new Date().toISOString(), id);
}

export function deletePending(id) { del.run(id); }
