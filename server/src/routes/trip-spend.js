// routes/trip-spend.js — YNAB trip-day spending summary.
//   GET /api/trip-spend?since=YYYY-MM-DD&until=YYYY-MM-DD
//
// Returns per-day totals + top-5 category slices for the donut on each day
// card. One YNAB call covers the whole trip range; amounts are bucketed by
// transaction date server-side. 5-minute in-process cache.
//
// No token configured → { ok:true, key:false, days:{} } so the client can
// render an empty/placeholder donut without erroring.

import express from "express";
import { loadYnabConfig } from "../util/ynab.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE = new Map();

// Map YNAB category name → CSS color token + display label. Falls through
// to a neutral "other" slice for anything unmapped; aggregation downstream
// caps the donut at 5 slices so this doesn't balloon.
const CATEGORY_PALETTE = [
  { match: /dining|restaurant|food/i,          color: "var(--rose)",        label: "Dining" },
  { match: /grocer|supplies|market/i,          color: "#c89a6a",            label: "Groceries" },
  { match: /fuel|gas|ez.?pass|transport|uber|lyft|taxi|parking/i, color: "var(--lavender)", label: "Transport" },
  { match: /entertainment|movie|concert/i,     color: "var(--gold)",        label: "Entertainment" },
  { match: /shop|clothing|apparel|cloth/i,     color: "#d18bb3",            label: "Shopping" },
  { match: /hotel|lodging|stay|airbnb/i,       color: "#82becc",            label: "Lodging" },
  { match: /flight|air|airline/i,              color: "#8fa8d4",            label: "Flights" },
  { match: /insurance/i,                       color: "#9ec49e",            label: "Insurance" },
];

function classify(catName) {
  const name = String(catName || "").trim();
  for (const p of CATEGORY_PALETTE) {
    if (p.match.test(name)) return { label: p.label, color: p.color };
  }
  return { label: name || "Other", color: "var(--muted)" };
}

function aggregate(txns) {
  // Bucket by date → category → sum. Inflows (positive amounts) skipped.
  const byDate = new Map();
  for (const t of txns) {
    if (!t.date || typeof t.amount !== "number") continue;
    if (t.amount >= 0) continue;                    // inflows — not spend
    const spent = -t.amount / 1000;                 // milliunits → dollars
    const catName = t.category_name || t.category || "";
    const { label, color } = classify(catName);
    if (!byDate.has(t.date)) byDate.set(t.date, { total: 0, cats: new Map() });
    const day = byDate.get(t.date);
    day.total += spent;
    if (!day.cats.has(label)) day.cats.set(label, { name: label, amount: 0, color });
    day.cats.get(label).amount += spent;
  }
  const out = {};
  for (const [date, { total, cats }] of byDate) {
    const sorted = [...cats.values()].sort((a, b) => b.amount - a.amount);
    // Keep top 4 + roll tail into "Other" to keep the donut legible.
    let slices = sorted;
    if (sorted.length > 5) {
      const top = sorted.slice(0, 4);
      const rest = sorted.slice(4).reduce((s, c) => s + c.amount, 0);
      top.push({ name: "Other", amount: rest, color: "var(--muted)" });
      slices = top;
    }
    out[date] = {
      total: Math.round(total * 100) / 100,
      categories: slices.map((s) => ({ name: s.name, amount: Math.round(s.amount * 100) / 100, color: s.color })),
    };
  }
  return out;
}

export function createTripSpendRouter() {
  const router = express.Router();

  router.get("/api/trip-spend", async (req, res) => {
    try {
      const since = String(req.query.since ?? "").trim();
      const until = String(req.query.until ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        return res.status(400).json({ ok: false, error: "since and until required (YYYY-MM-DD)" });
      }
      const { token, budgetId } = loadYnabConfig();
      if (!token) return res.json({ ok: true, key: false, days: {} });

      const ck = `${budgetId}:${since}:${until}`;
      const hit = CACHE.get(ck);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return res.json({ ok: true, key: true, cached: true, days: hit.days });
      }

      const url = new URL(`https://api.youneedabudget.com/v1/budgets/${budgetId}/transactions`);
      url.searchParams.set("since_date", since);
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return res.status(502).json({ ok: false, error: "ynab http_" + r.status });
      const j = await r.json();
      const all = j?.data?.transactions ?? [];
      const inRange = all.filter((t) => t.date >= since && t.date <= until && !t.deleted);
      const days = aggregate(inRange);
      CACHE.set(ck, { at: Date.now(), days });
      res.json({ ok: true, key: true, cached: false, days });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
