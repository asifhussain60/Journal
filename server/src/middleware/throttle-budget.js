// middleware/throttle-budget.js — Phase 8 budget throttle.
//
// Reads current-month spend from usage-summary before each request and
// either lets it through, downgrades the body (soft throttle), or returns
// HTTP 429 (hard throttle).
//
// Wired after usage-logger (Phase 1) so the incoming request is still logged
// even when throttled. The X-Budget-State header mirrors throttleState on
// every response.
//
// Budget state thresholds (per getUsageSummary):
//   percentageUsed < 75  → "normal"  — no changes
//   75 ≤ pct      < 90  → "soft"    — edit-intent endpoints return
//                                      { ok: true, throttled: true, ... }
//   pct         ≥ 90    → "hard"    — non-essential endpoints return
//                                      HTTP 429 { throttled: true, ... }
//
// Essentials that always pass (regardless of state): /health, tier-0 reference
// data (GET /api/reference-data/*), usage summary itself, queue reads, and
// edit-log reads. The "cheap" set mirrors the Cowork-side rule: synthesis
// lives in Cowork, never throttled from the App surface.

import { getUsageSummary } from "../lib/usage-summary.js";

// Endpoints that must never be throttled. Health first so monitoring always
// works. Read-only queue + edit-log endpoints follow — they're cheap and the
// App surface leans on them to render the Queue / Edits panels.
const ESSENTIAL_PATHS = new Set([
  "/health",
  "/api/usage/summary",
]);
const ESSENTIAL_PREFIXES = [
  "/api/reference-data/",
];
const READ_ONLY_GET = [
  "/api/edit-log",
];

// Soft-throttled-to-clarify endpoints: edit intents. When spend is 75-90%
// we want the App to keep working but not author new memoir-facing writes.
const EDIT_INTENT_PATHS = new Set([
  "/api/trip-edit",
  "/api/trip-edit/revert",
]);

// Cost-ful endpoints that fall under hard throttle: classification, synthesis,
// extraction. Tier-0 and queue writes are not here — captures still work
// because losing a voice memo is worse than overspending by $0.01.
const HARD_DENY_PATHS = new Set([
  "/api/chat",
  "/api/refine",
  "/api/trip-qa",
  "/api/trip-assistant",
  "/api/extract-receipt",
  "/api/ingest-itinerary",
  "/api/voice-test",
]);

function classifyPath(method, path) {
  if (ESSENTIAL_PATHS.has(path)) return "essential";
  if (ESSENTIAL_PREFIXES.some((p) => path.startsWith(p))) return "essential";
  if (method === "GET" && (READ_ONLY_GET.includes(path) || path.startsWith("/api/queue/"))) {
    return "essential";
  }
  if (EDIT_INTENT_PATHS.has(path)) return "edit";
  if (path === "/api/trip-edit" || path.startsWith("/api/trip-edit/")) return "edit";
  if (HARD_DENY_PATHS.has(path)) return "expensive";
  return "other";
}

/**
 * Express middleware factory for budget-based throttling.
 *
 * @param {object} opts
 * @param {number} [opts.monthlyCAP=50]
 * @param {() => Promise<{ throttleState: string, spentThisMonth: number, monthlyCAP: number }>} [opts.summaryFn]
 *   Injection point for tests. Defaults to getUsageSummary.
 */
export function throttleBudget({ monthlyCAP = 50, summaryFn } = {}) {
  const load = summaryFn || (() => getUsageSummary({ monthlyCAP }));

  return async function throttleBudgetMiddleware(req, res, next) {
    let state = "normal";
    try {
      const summary = await load();
      state = summary.throttleState || "normal";
    } catch {
      state = "normal";
    }

    res.set("X-Budget-State", state);

    if (state === "normal") return next();

    const kind = classifyPath(req.method, req.path);

    if (kind === "essential") return next();

    if (state === "soft") {
      if (kind === "edit") {
        return res.status(200).json({
          ok: true,
          throttled: true,
          throttleState: "soft",
          intent: "qa",
          message:
            "Edit intents are throttled this month (≥75% budget used). Responding in clarify-only mode — rephrase as a question or wait until next month.",
        });
      }
      // Q&A + synthesis still run under soft. Let them through with the header
      // so the App can surface a banner.
      return next();
    }

    // state === "hard"
    if (kind === "expensive" || kind === "edit") {
      return res.status(429).json({
        ok: false,
        throttled: true,
        throttleState: "hard",
        message:
          "Monthly budget limit approaching (≥90% used). Non-essential endpoints are paused until the next billing cycle or cap increase.",
      });
    }
    return next();
  };
}

export { classifyPath };
