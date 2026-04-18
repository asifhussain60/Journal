// usage-summary.js — Phase 8 budget aggregator.
//
// Reads server/logs/usage.jsonl (one row per request, written by
// middleware/usage-logger.js) and returns the current-month spend breakdown
// used by GET /api/usage/summary, the throttle-budget middleware, and the
// usage-auditor Cowork skill.
//
// Cost is derived at summary-query time from the model + token counts, using
// the PRICING table below. Rows with model=null (e.g. /health, Tier 0 data
// reads) contribute $0 but still count toward per-endpoint call totals.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_PATH = path.resolve(__dirname, "../../logs/usage.jsonl");

// Model pricing in USD per 1M tokens. Covers the Claude 4.x family as of
// 2026-04. Unknown models fall back to Sonnet rates (conservative).
const PRICING = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-5": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-6-20250514": { in: 3.0, out: 15.0 },
  "claude-opus-4-6": { in: 15.0, out: 75.0 },
  "claude-opus-4-5": { in: 15.0, out: 75.0 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4.0 },
  "claude-haiku-4-5": { in: 0.8, out: 4.0 },
};
const FALLBACK = { in: 3.0, out: 15.0 };

export function costForRow(row) {
  if (!row || typeof row !== "object") return 0;
  const model = row.model || null;
  const tin = Number(row.tokensIn || 0) || 0;
  const tout = Number(row.tokensOut || 0) || 0;
  if (tin === 0 && tout === 0) return 0;
  const price = PRICING[model] || FALLBACK;
  return (tin * price.in + tout * price.out) / 1_000_000;
}

function currentMonthPrefix(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function readLogSafe() {
  try {
    const text = await readFile(LOG_PATH, "utf8");
    return text.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Parse usage.jsonl, filter to the current month, aggregate per-endpoint,
 * return the shape the UsageModal + BudgetPill consume.
 *
 * @param {object} opts
 * @param {number} [opts.monthlyCAP=50]
 * @param {Date}   [opts.now=new Date()]
 * @returns {Promise<{
 *   ok: true,
 *   generatedAt: string,
 *   spentThisMonth: number,
 *   monthlyCAP: number,
 *   percentageUsed: number,
 *   throttleState: "normal"|"soft"|"hard",
 *   throttleHitsThisMonth: number,
 *   byEndpoint: Array<{
 *     endpoint: string,
 *     calls: number,
 *     avgCost: number,
 *     totalCost: number,
 *     percentOfMonth: number,
 *     lastCallAt: string|null,
 *   }>,
 * }>}
 */
export async function getUsageSummary({ monthlyCAP = 50, now = new Date() } = {}) {
  const lines = await readLogSafe();
  const prefix = currentMonthPrefix(now);
  const agg = new Map();
  let spent = 0;
  let throttleHits = 0;

  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object") continue;
    const ts = typeof row.timestamp === "string" ? row.timestamp : null;
    if (!ts || !ts.startsWith(prefix)) continue;

    if (row.statusCode === 429 || row.throttled === true) throttleHits += 1;

    const cost = costForRow(row);
    spent += cost;

    const endpoint = row.endpoint || "(unknown)";
    let a = agg.get(endpoint);
    if (!a) { a = { endpoint, calls: 0, totalCost: 0, lastCallAt: null }; agg.set(endpoint, a); }
    a.calls += 1;
    a.totalCost += cost;
    if (!a.lastCallAt || ts > a.lastCallAt) a.lastCallAt = ts;
  }

  const byEndpoint = [...agg.values()]
    .map(a => ({
      endpoint: a.endpoint,
      calls: a.calls,
      avgCost: a.calls > 0 ? a.totalCost / a.calls : 0,
      totalCost: a.totalCost,
      percentOfMonth: spent > 0 ? (a.totalCost / spent) * 100 : 0,
      lastCallAt: a.lastCallAt,
    }))
    .sort((x, y) => y.totalCost - x.totalCost);

  const percentageUsed = monthlyCAP > 0 ? (spent / monthlyCAP) * 100 : 0;
  const throttleState = percentageUsed >= 90 ? "hard" : percentageUsed >= 75 ? "soft" : "normal";

  return {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    spentThisMonth: Number(spent.toFixed(4)),
    monthlyCAP,
    percentageUsed: Number(percentageUsed.toFixed(2)),
    throttleState,
    throttleHitsThisMonth: throttleHits,
    byEndpoint,
  };
}

export { PRICING, LOG_PATH as USAGE_LOG_PATH };
