// routes/usage.js — monthly spend summary + throttle-state header.
//   GET /api/usage/summary        — feeds BudgetPill, UsageModal, throttle-budget.
//   GET /api/usage/refine-all     — 30-day orchestrator-level rollup (E4).

import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getUsageSummary, costForRow } from "../lib/usage-summary.js";

const __filename_u = fileURLToPath(import.meta.url);
const __dirname_u = path.dirname(__filename_u);
const USAGE_LOG_PATH = path.resolve(__dirname_u, "../../logs/usage.jsonl");

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function getRefineAllRollup({ days = 30, now = new Date() } = {}) {
  let lines = [];
  try {
    const text = await readFile(USAGE_LOG_PATH, "utf8");
    lines = text.split("\n").filter(Boolean);
  } catch {
    return { ok: true, orchestrators: [], generatedAt: now.toISOString() };
  }

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const agg = new Map();

  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object") continue;
    if (row.endpoint !== "/api/trip-refine-all") continue;
    if (!row.promptName) continue;
    if (!row.timestamp || row.timestamp < cutoff) continue;

    const k = row.promptName;
    let a = agg.get(k);
    if (!a) {
      a = { promptName: k, latencies: [], totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, successCount: 0, totalCount: 0 };
      agg.set(k, a);
    }
    a.totalCount++;
    if (row.success !== false) a.successCount++;
    if (typeof row.durationMs === "number" && row.durationMs > 0) a.latencies.push(row.durationMs);
    a.totalTokensIn += row.tokensIn || 0;
    a.totalTokensOut += row.tokensOut || 0;
    a.totalCostUsd += row.totalCostUsd || costForRow({ tokensIn: row.tokensIn || 0, tokensOut: row.tokensOut || 0, model: row.model });
  }

  const orchestrators = [...agg.values()].map(a => {
    const sorted = [...a.latencies].sort((x, y) => x - y);
    return {
      promptName: a.promptName,
      calls: a.totalCount,
      failureRate: a.totalCount > 0 ? (a.totalCount - a.successCount) / a.totalCount : 0,
      p50LatencyMs: pct(sorted, 50),
      p95LatencyMs: pct(sorted, 95),
      totalTokensIn: a.totalTokensIn,
      totalTokensOut: a.totalTokensOut,
      totalCostUsd: a.totalCostUsd,
    };
  });

  return { ok: true, days, orchestrators, generatedAt: now.toISOString() };
}

export function createUsageRouter({ MONTHLY_CAP }) {
  const router = express.Router();

  router.get("/api/usage/summary", async (_req, res) => {
    try {
      const summary = await getUsageSummary({ monthlyCAP: MONTHLY_CAP });
      res.set("X-Budget-State", summary.throttleState);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // E4: 30-day orchestrator-level rollup for refine-all operations
  router.get("/api/usage/refine-all", async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days || "30", 10) || 30, 1), 90);
      const rollup = await getRefineAllRollup({ days });
      res.json(rollup);
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}

