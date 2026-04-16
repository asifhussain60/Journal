// repositories/edit-log.js — Phase 9 Stage C narrow API.
import db from "../index.js";

const listByTrip = db.prepare(`SELECT * FROM edit_log WHERE tripSlug = ? ORDER BY created_at DESC`);
const getById = db.prepare(`SELECT * FROM edit_log WHERE id = ?`);
const insert = db.prepare(`INSERT INTO edit_log (id, schema_version, created_at, tripSlug, intent, userMessage, proposedDiff, appliedPatch, status, snapshotId, error)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @intent, @userMessage, @proposedDiff, @appliedPatch, @status, @snapshotId, @error)`);
const updateStatus = db.prepare(`UPDATE edit_log SET status = ?, appliedPatch = ?, error = ? WHERE id = ?`);
const del = db.prepare(`DELETE FROM edit_log WHERE id = ?`);

function parseRow(r) {
  if (!r) return null;
  return { ...r, proposedDiff: r.proposedDiff ? JSON.parse(r.proposedDiff) : null, appliedPatch: r.appliedPatch ? JSON.parse(r.appliedPatch) : null };
}

export function listEdits(tripSlug) { return listByTrip.all(tripSlug).map(parseRow); }
export function getEdit(id) { return parseRow(getById.get(id)); }

export function createEdit(row) {
  insert.run({
    id: row.id,
    schema_version: row.schemaVersion || "1",
    created_at: row.createdAt || new Date().toISOString(),
    tripSlug: row.tripSlug,
    intent: row.intent || "unknown",
    userMessage: row.userMessage || null,
    proposedDiff: row.proposedDiff ? JSON.stringify(row.proposedDiff) : null,
    appliedPatch: row.appliedPatch ? JSON.stringify(row.appliedPatch) : null,
    status: row.status,
    snapshotId: row.snapshotId || null,
    error: row.error || null,
  });
}

export function setEditStatus(id, status, appliedPatch = null, error = null) {
  updateStatus.run(status, appliedPatch ? JSON.stringify(appliedPatch) : null, error, id);
}

export function deleteEdit(id) { del.run(id); }
