// mcp/ops-server.js — Phase 9 read-only MCP-style query surface.
//
// Exposes five query functions over ops.db for Cowork-side consumers
// (catch-up, memory-promotion, queue-health, etc.). Read-only — no write
// tools. When an MCP transport (stdio or HTTP) is added later, it wraps
// these functions as tools; for now they're directly importable.
//
// All functions are synchronous (better-sqlite3 is sync) and return plain
// JSON-serializable data. JSON columns (data, parsedData, extractedData,
// proposedDiff, appliedPatch, resultSummary) are parsed at the boundary.

import db from "../db/index.js";

function parseJsonSafe(s) {
  if (s == null || s === "") return null;
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Returns all pending queue entries for a trip (pending + stuck + drained),
 * ordered newest-first. Pass status='pending' to filter.
 */
export function query_pending_queue({ tripSlug, status = null, limit = 200 } = {}) {
  if (!tripSlug) throw new Error("tripSlug is required");
  const sql = status
    ? `SELECT * FROM pending_queue WHERE tripSlug = ? AND status = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM pending_queue WHERE tripSlug = ? ORDER BY created_at DESC LIMIT ?`;
  const params = status ? [tripSlug, status, limit] : [tripSlug, limit];
  return db.prepare(sql).all(...params).map((r) => ({ ...r, data: parseJsonSafe(r.data), memoryWorthy: !!r.memoryWorthy }));
}

/**
 * Returns dead-letter entries, optionally filtered by queueName or tripSlug.
 */
export function query_dead_letter({ tripSlug = null, queueName = null, limit = 100 } = {}) {
  let sql = "SELECT * FROM dead_letter WHERE 1=1";
  const params = [];
  if (tripSlug) { sql += " AND tripSlug = ?"; params.push(tripSlug); }
  if (queueName) { sql += " AND queueName = ?"; params.push(queueName); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map((r) => ({ ...r, data: parseJsonSafe(r.data) }));
}

/**
 * Returns current-month spend summary + per-endpoint breakdown.
 * Uses usage table (populated by shadow-write in Stage B; canonical in Stage C).
 */
export function query_usage_summary({ monthlyCAP = 50 } = {}) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `${y}-${m}`;

  const rows = db.prepare(`SELECT endpoint, model, tokensIn, tokensOut, created_at, statusCode FROM usage WHERE created_at LIKE ?`).all(`${prefix}%`);

  // Mirror the PRICING table from usage-summary.js. Keep synchronized.
  const PRICING = {
    "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
    "claude-sonnet-4-5": { in: 3.0, out: 15.0 },
    "claude-opus-4-6":   { in: 15.0, out: 75.0 },
    "claude-haiku-4-5":  { in: 0.8, out: 4.0 },
    "claude-haiku-4-5-20251001": { in: 0.8, out: 4.0 },
  };
  const fallback = { in: 3.0, out: 15.0 };

  const agg = new Map();
  let spent = 0;
  let throttleHits = 0;
  for (const r of rows) {
    const price = PRICING[r.model] || fallback;
    const cost = (r.tokensIn * price.in + r.tokensOut * price.out) / 1_000_000;
    spent += cost;
    if (r.statusCode === 429) throttleHits += 1;
    let a = agg.get(r.endpoint);
    if (!a) { a = { endpoint: r.endpoint, calls: 0, totalCost: 0, lastCallAt: null }; agg.set(r.endpoint, a); }
    a.calls += 1;
    a.totalCost += cost;
    if (!a.lastCallAt || r.created_at > a.lastCallAt) a.lastCallAt = r.created_at;
  }
  const byEndpoint = [...agg.values()].map((a) => ({ ...a, avgCost: a.calls > 0 ? a.totalCost / a.calls : 0, percentOfMonth: spent > 0 ? (a.totalCost / spent) * 100 : 0 })).sort((x, y) => y.totalCost - x.totalCost);
  const percentageUsed = monthlyCAP > 0 ? (spent / monthlyCAP) * 100 : 0;
  return {
    spentThisMonth: Number(spent.toFixed(4)),
    monthlyCAP,
    percentageUsed: Number(percentageUsed.toFixed(2)),
    throttleState: percentageUsed >= 90 ? "hard" : percentageUsed >= 75 ? "soft" : "normal",
    throttleHitsThisMonth: throttleHits,
    byEndpoint,
  };
}

/**
 * Returns recent edits for a trip with provenance (intent, user message,
 * applied patch, revert status).
 */
export function query_edit_log({ tripSlug, limit = 50 } = {}) {
  if (!tripSlug) throw new Error("tripSlug is required");
  return db.prepare(`SELECT * FROM edit_log WHERE tripSlug = ? ORDER BY created_at DESC LIMIT ?`).all(tripSlug, limit).map((r) => ({
    ...r,
    proposedDiff: parseJsonSafe(r.proposedDiff),
    appliedPatch: parseJsonSafe(r.appliedPatch),
  }));
}

/**
 * Returns recent drain operations (Cowork-side commits: receipts drained,
 * voice synthesized, memory-promotions, etc.).
 */
export function query_drain_log({ operation = null, limit = 100 } = {}) {
  let sql = "SELECT * FROM drain_log";
  const params = [];
  if (operation) { sql += " WHERE operation = ?"; params.push(operation); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map((r) => ({ ...r, resultSummary: parseJsonSafe(r.resultSummary) }));
}

export const OPS_QUERY_TOOLS = {
  query_pending_queue,
  query_dead_letter,
  query_usage_summary,
  query_edit_log,
  query_drain_log,
};
