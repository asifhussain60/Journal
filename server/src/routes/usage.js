// routes/usage.js — monthly spend summary + throttle-state header.
//   GET /api/usage/summary — feeds BudgetPill, UsageModal, throttle-budget.

import express from "express";
import { getUsageSummary } from "../usage-summary.js";

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

  return router;
}
