// repositories/voice-inbox.js — Phase 9 Stage C narrow API.
import db from "../index.js";

const listByTrip = db.prepare(`SELECT * FROM voice_inbox WHERE tripSlug = ? ORDER BY created_at ASC`);
const getById = db.prepare(`SELECT * FROM voice_inbox WHERE id = ?`);
const insert = db.prepare(`INSERT INTO voice_inbox (id, schema_version, created_at, tripSlug, text, status, transcript, durationSec)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @text, @status, @transcript, @durationSec)`);
const updateStatus = db.prepare(`UPDATE voice_inbox SET status = ? WHERE id = ?`);
const del = db.prepare(`DELETE FROM voice_inbox WHERE id = ?`);

export function listVoice(tripSlug) { return listByTrip.all(tripSlug); }
export function getVoice(id) { return getById.get(id); }

export function createVoice(row) {
  const payload = row.payload || {};
  insert.run({
    id: row.id,
    schema_version: row.schemaVersion || "1",
    created_at: row.createdAt,
    tripSlug: row.tripSlug,
    text: payload.text || "",
    status: row.status || "pending",
    transcript: payload.transcript || null,
    durationSec: payload.durationSec == null ? null : Number(payload.durationSec),
  });
}

export function setVoiceStatus(id, status) { updateStatus.run(status, id); }
export function deleteVoice(id) { del.run(id); }
