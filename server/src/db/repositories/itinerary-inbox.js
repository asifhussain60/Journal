// repositories/itinerary-inbox.js — Phase 9 Stage C narrow API.
import db from "../index.js";

const listByTrip = db.prepare(`SELECT * FROM itinerary_inbox WHERE tripSlug = ? ORDER BY created_at ASC`);
const getById = db.prepare(`SELECT * FROM itinerary_inbox WHERE id = ?`);
const insert = db.prepare(`INSERT INTO itinerary_inbox (id, schema_version, created_at, tripSlug, rawText, status, parsedData)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @rawText, @status, @parsedData)`);
const updateStatus = db.prepare(`UPDATE itinerary_inbox SET status = ? WHERE id = ?`);
const del = db.prepare(`DELETE FROM itinerary_inbox WHERE id = ?`);

function parseRow(r) { return r ? { ...r, parsedData: r.parsedData ? JSON.parse(r.parsedData) : null } : null; }

export function listItinerary(tripSlug) { return listByTrip.all(tripSlug).map(parseRow); }
export function getItinerary(id) { return parseRow(getById.get(id)); }

export function createItinerary(row) {
  const payload = row.payload || {};
  insert.run({
    id: row.id,
    schema_version: row.schemaVersion || "1",
    created_at: row.createdAt,
    tripSlug: row.tripSlug,
    rawText: payload.rawText || "",
    status: row.status || "pending",
    parsedData: payload.parsedSkeleton ? JSON.stringify(payload.parsedSkeleton) : null,
  });
}

export function setItineraryStatus(id, status) { updateStatus.run(status, id); }
export function deleteItinerary(id) { del.run(id); }
