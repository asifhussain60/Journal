// repositories/receipts-meta.js — Phase 9 Stage C narrow API.
import db from "../index.js";

const listByTrip = db.prepare(`SELECT * FROM receipts_meta WHERE tripSlug = ? ORDER BY created_at DESC`);
const getById = db.prepare(`SELECT * FROM receipts_meta WHERE id = ?`);
const insert = db.prepare(`INSERT INTO receipts_meta (id, schema_version, created_at, tripSlug, imageId, imagePath, extractedData, status, visionUsed)
  VALUES (@id, @schema_version, @created_at, @tripSlug, @imageId, @imagePath, @extractedData, @status, @visionUsed)`);
const updateStatus = db.prepare(`UPDATE receipts_meta SET status = ? WHERE id = ?`);

function parseRow(r) { return r ? { ...r, extractedData: r.extractedData ? JSON.parse(r.extractedData) : null, visionUsed: !!r.visionUsed } : null; }

export function listReceiptsMeta(tripSlug) { return listByTrip.all(tripSlug).map(parseRow); }
export function getReceiptMeta(id) { return parseRow(getById.get(id)); }

export function createReceiptMeta(row) {
  insert.run({
    id: row.id,
    schema_version: "1",
    created_at: row.createdAt || new Date().toISOString(),
    tripSlug: row.tripSlug,
    imageId: row.imageId,
    imagePath: row.imagePath,
    extractedData: row.extractedData ? JSON.stringify(row.extractedData) : null,
    status: row.status || "captured",
    visionUsed: row.visionUsed ? 1 : 0,
  });
}

export function setReceiptMetaStatus(id, status) { updateStatus.run(status, id); }
