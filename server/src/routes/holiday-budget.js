// routes/holiday-budget.js — Holiday-category spending breakdown.
//   GET /api/holiday-budget?since=YYYY-MM-DD&until=YYYY-MM-DD&fresh=1
//
// Pulls every outflow tagged to the YNAB "Holiday" category (the user's
// trip-tagging convention) and asks Claude Haiku to bucket each one into 8
// standard trip sub-categories using payee + memo field. Totals are verified
// against the raw transaction sum so LLM drift can't lose money.
//
// Scope rationale: the user categorises trip-related outflows into a single
// YNAB category called "Holiday" (sitting in their "Piggy Bank" group). That
// category is the source-of-truth for what belongs to this trip; a naive
// date-range-across-all-categories approach over-pulls mortgage / utilities
// / subscriptions and drowns the panel. Optional since/until narrow within
// the Holiday set.
//
// Available = the Holiday category's balance (piggy-bank savings). Missing
// category → $0 Available, $0 Spent, empty list — no 404.
//
// Response shape:
//   {
//     ok: true,
//     totals: { spent, available, percentLeft },
//     categories: [
//       { name, icon, total, transactions: [{ id, date, payee, memo, amount, card, reason }] }
//     ],
//     verified: boolean,
//     discrepancy: number,   // |sum(categories) - sum(txns)| in dollars
//     unclassified: number,  // count of txns the LLM couldn't bucket — forced to "Misc"
//     syncedAt: "2026-04-17T20:45:00.000Z"
//   }

import express from "express";
import { loadYnabConfig } from "../util/ynab.js";
import { loadPrompt } from "../prompts/index.js";
import { getActiveTripSlug } from "../lib/receipts.js";
import { readTripObj } from "../lib/trip-edit-ops.js";

// Default YNAB category name when trip.yaml doesn't specify one. Kept for
// backward compatibility with trips created before ynab.category was introduced.
const DEFAULT_CATEGORY = "Holiday";

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Read trip.yaml for an optional `ynab.category` override. Silent on any
// read/parse error — falls back to the default. The holiday-budget panel
// must never 500 just because a trip.yaml is missing or malformed.
async function resolveCategoryName(slug) {
  if (!slug) return DEFAULT_CATEGORY;
  try {
    const trip = await readTripObj(slug);
    const name = trip?.ynab?.category;
    if (typeof name === "string" && name.trim().length) return name.trim();
  } catch {
    // trip.yaml missing or unparseable — fall through to default
  }
  return DEFAULT_CATEGORY;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE = new Map();

// The 8 buckets the LLM is told to use. Any other value returned by the model
// is re-mapped to "Misc" so the frontend schema stays stable.
const CATEGORIES = Object.freeze([
  { name: "Flights",       icon: "\u2708" },   // ✈
  { name: "Lodging",       icon: "\uD83C\uDFE8" }, // 🏨
  { name: "Transport",     icon: "\uD83D\uDE95" }, // 🚕
  { name: "Dining",        icon: "\uD83C\uDF7D" }, // 🍽
  { name: "Shopping",      icon: "\uD83D\uDECD" }, // 🛍
  { name: "Entertainment", icon: "\uD83C\uDFAC" }, // 🎬
  { name: "Insurance",     icon: "\uD83D\uDEE1" }, // 🛡
  { name: "Misc",          icon: "\u2728" },   // ✨
]);
const CATEGORY_NAMES = new Set(CATEGORIES.map((c) => c.name));
const ICON_BY_NAME = Object.fromEntries(CATEGORIES.map((c) => [c.name, c.icon]));

// Rough card hint from YNAB account name — YNAB stores the full account name
// (e.g. "Chase Sapphire Reserve"); we shorten to the badge the UI draws.
function cardBadge(accountName) {
  const n = String(accountName || "").toLowerCase();
  if (/sapphire/.test(n)) return "SAPPHIRE";
  if (/united/.test(n))   return "UNITED";
  if (/premier/.test(n))  return "PREMIER";
  if (/freedom/.test(n))  return "FREEDOM";
  if (/amex|american express/.test(n)) return "AMEX";
  if (/citi/.test(n))     return "CITI";
  return String(accountName || "CARD").toUpperCase().slice(0, 10);
}

async function ynabFetch(path, token) {
  const r = await fetch(`https://api.youneedabudget.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`YNAB ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

// Round to 2dp and coerce to Number so JSON stays clean.
const toDollars = (milli) => Math.round((Number(milli) || 0) / 10) / 100;

// Prefer outflow (negative amounts) — inflows (refunds, transfers in) don't
// count as spend. Returns a positive dollar amount.
function outflowDollars(milli) {
  const m = Number(milli) || 0;
  if (m >= 0) return 0;
  return Math.round(-m / 10) / 100;
}

// Fold sub-transactions into their parents when present — YNAB returns split
// transactions as (parent, sub[]) pairs. For classification we treat each sub
// as its own transaction so the category bucket is accurate; payee/memo
// fall back to the parent's when the sub leaves them blank.
function expandSplits(txns) {
  const out = [];
  for (const t of txns) {
    if (t.deleted) continue;
    const subs = Array.isArray(t.subtransactions) ? t.subtransactions.filter((s) => !s.deleted) : [];
    if (subs.length === 0) { out.push(t); continue; }
    for (const s of subs) {
      out.push({
        id: s.id,
        date: t.date,
        amount: s.amount,
        payee_name: s.payee_name || t.payee_name,
        memo: s.memo || t.memo,
        category_id: s.category_id,
        category_name: s.category_name,
        account_name: t.account_name,
      });
    }
  }
  return out;
}

// Ask Haiku to bucket the transactions. Returns a Map<id, {category,reason}>.
// Falls back to an empty Map on any error so the caller can bucket everything
// as "Misc" rather than failing the whole request.
async function classifyWithHaiku({ anthropic, prompt, txns }) {
  if (!txns.length) return new Map();
  const payload = txns.map((t) => ({
    id: t.id,
    payee: t.payee_name || "",
    memo: t.memo || "",
    amount: outflowDollars(t.amount),
  }));

  try {
    // max_tokens scales with input — each classification row is ~80 tokens of
    // JSON output. 200 txns × 80 ≈ 16k. Cap at 32k to stay well under Haiku's
    // limit while leaving headroom for future large trips.
    const outBudget = Math.min(32768, Math.max(2048, txns.length * 120));
    const msg = await anthropic.messages.create({
      model: prompt.model,
      max_tokens: outBudget,
      system: prompt.system,
      messages: [
        {
          role: "user",
          content:
            "Classify every transaction below. Return the JSON object as specified.\n\n" +
            "```json\n" + JSON.stringify({ transactions: payload }, null, 2) + "\n```",
        },
      ],
    });
    const text = (msg?.content?.[0]?.text || "").trim();
    // Tolerate stray fences if Haiku slips up.
    const jsonText = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(jsonText);
    const out = new Map();
    for (const row of parsed?.classifications || []) {
      if (!row || !row.id) continue;
      const cat = CATEGORY_NAMES.has(row.category) ? row.category : "Misc";
      out.set(String(row.id), { category: cat, reason: String(row.reason || "").slice(0, 80) });
    }
    return out;
  } catch (err) {
    console.warn("[holiday-budget] classify failed:", err?.message || err);
    return new Map();
  }
}

export function createHolidayBudgetRouter({ anthropic }) {
  const router = express.Router();
  const prompt = loadPrompt("classify-holiday-txns");

  router.get("/api/holiday-budget", async (req, res) => {
    try {
      const fresh = req.query.fresh === "1" || req.query.fresh === "true";
      const since = String(req.query.since ?? "").trim();
      const until = String(req.query.until ?? "").trim();
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      if (since && !DATE_RE.test(since)) {
        return res.status(400).json({ ok: false, error: "since must be YYYY-MM-DD" });
      }
      if (until && !DATE_RE.test(until)) {
        return res.status(400).json({ ok: false, error: "until must be YYYY-MM-DD" });
      }
      // Default window — last 90 days — so a bare /api/holiday-budget call
      // still returns something useful when the client forgets to pass dates.
      const today = new Date().toISOString().slice(0, 10);
      const effSince = since || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      const effUntil = until || today;

      const { token, budgetId } = loadYnabConfig();
      if (!token) {
        return res.json({
          ok: true,
          key: false,
          totals: { spent: 0, available: 0, percentLeft: 1 },
          categories: [],
          verified: true,
          discrepancy: 0,
          unclassified: 0,
          syncedAt: new Date().toISOString(),
        });
      }

      // Resolve the YNAB category name per-trip. Accepts ?trip=slug; falls
      // back to the active trip from manifest. Missing trip.yaml or missing
      // ynab.category both fall back to the "Holiday" default.
      const requestedSlug = typeof req.query.trip === "string" && req.query.trip.trim().length
        ? req.query.trip.trim()
        : null;
      let tripSlug = requestedSlug;
      if (!tripSlug) {
        try { tripSlug = await getActiveTripSlug(); } catch { tripSlug = null; }
      }
      const categoryName = await resolveCategoryName(tripSlug);
      const categoryRe = new RegExp(`^${escapeRegExp(categoryName)}$`, "i");

      const ck = `holiday:${budgetId}:${categoryName}:${effSince}:${effUntil}`;
      if (!fresh) {
        const hit = CACHE.get(ck);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
          return res.json({ ...hit.payload, cached: true });
        }
      }

      // 1. Locate the configured YNAB category (default "Holiday", per-trip
      //    override via trip.yaml → ynab.category). Its balance drives the
      //    Available tile; its id scopes the transaction fetch below.
      const catData = await ynabFetch(`/budgets/${budgetId}/categories`, token);
      const groups = catData?.data?.category_groups ?? [];
      let holiday = null;
      for (const g of groups) {
        for (const c of g.categories || []) {
          if (c.hidden || c.deleted) continue;
          if (categoryRe.test(String(c.name || "").trim())) { holiday = c; break; }
        }
        if (holiday) break;
      }

      // 2. Transactions — only those tagged to Holiday. This is the user's
      //    trip-tagging convention; broader scoping pulls unrelated home
      //    expenses. Date window (since/until) narrows further within Holiday.
      let expanded = [];
      if (holiday) {
        const txnData = await ynabFetch(
          `/budgets/${budgetId}/categories/${holiday.id}/transactions`,
          token
        );
        const rawTxns = (txnData?.data?.transactions ?? []).filter(
          (t) => !t.deleted && t.date >= effSince && t.date <= effUntil
        );
        expanded = expandSplits(rawTxns).filter((t) => outflowDollars(t.amount) > 0);
      }

      // 3. Classify via Haiku (single call). Guardrails fall back to "Misc"
      //    for anything the model omits or invents outside the 8-category set.
      const classMap = await classifyWithHaiku({ anthropic, prompt, txns: expanded });

      // 4. Aggregate into buckets — preserve CATEGORIES order for stable UI.
      const bucketByName = new Map(CATEGORIES.map((c) => [c.name, {
        name: c.name,
        icon: c.icon,
        total: 0,
        transactions: [],
      }]));
      let unclassified = 0;
      for (const t of expanded) {
        const hit = classMap.get(String(t.id));
        const cat = hit?.category || "Misc";
        if (!hit) unclassified++;
        const amount = outflowDollars(t.amount);
        const b = bucketByName.get(cat) || bucketByName.get("Misc");
        b.total = Math.round((b.total + amount) * 100) / 100;
        b.transactions.push({
          id: t.id,
          date: t.date,
          payee: t.payee_name || "",
          memo: t.memo || "",
          amount,
          card: cardBadge(t.account_name),
          reason: hit?.reason || "",
        });
      }

      // 5. Guardrails — verify sum of bucket totals matches the raw
      //    outflow total. Any drift > 1¢ flips verified=false so the UI
      //    can flag it. This protects against LLM omission or double-count.
      const rawTotal = Math.round(
        expanded.reduce((s, t) => s + outflowDollars(t.amount), 0) * 100
      ) / 100;
      const bucketTotal = Math.round(
        [...bucketByName.values()].reduce((s, b) => s + b.total, 0) * 100
      ) / 100;
      const discrepancy = Math.round(Math.abs(rawTotal - bucketTotal) * 100) / 100;
      const verified = discrepancy <= 0.01;

      // 6. Balance / spent / % remaining. `available` comes from the
      //    Holiday piggy-bank category if the user has one; `spent` is the
      //    sum of outflows in the date window. `percentLeft = available /
      //    (available + spent)` — the UI colors the tile against 25%/15%.
      const available = holiday ? toDollars(holiday.balance) : 0;
      const spent = rawTotal;
      const denom = available + spent;
      const percentLeft = denom > 0 ? available / denom : 1;

      // 7. Drop empty buckets so the UI doesn't render zero-rows.
      const categories = [...bucketByName.values()]
        .filter((b) => b.transactions.length > 0)
        .map((b) => ({
          ...b,
          // Sort each bucket's txns newest → oldest for readability.
          transactions: b.transactions.sort((a, b2) => (a.date < b2.date ? 1 : -1)),
        }));

      const payload = {
        ok: true,
        key: true,
        window: { since: effSince, until: effUntil },
        category: { name: categoryName, matched: Boolean(holiday) },
        tripSlug,
        totals: {
          spent: Math.round(spent * 100) / 100,
          available: Math.round(available * 100) / 100,
          percentLeft: Math.round(percentLeft * 10000) / 10000,
        },
        categories,
        verified,
        discrepancy,
        unclassified,
        syncedAt: new Date().toISOString(),
      };
      CACHE.set(ck, { at: Date.now(), payload });
      res.json(payload);
    } catch (err) {
      console.error("[holiday-budget]", err);
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
