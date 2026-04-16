---
name: usage-auditor
description: "Usage + spend auditor for Asif's journal. Invoke when the user says 'usage-auditor', '/usage-auditor', '@usage-auditor', 'audit usage', 'spend audit', 'budget audit', 'where is my money going', 'project monthly spend', 'monthly spend forecast', or 'how much have I spent'. Reads `server/logs/usage.jsonl` (and `GET /api/usage/summary`) to report total spend, per-endpoint cost, projected end-of-month burn, throttle-hit count, and cap recommendations. Accepts `--forecast` to extrapolate spend if the current pace continues, and `--since <ISO>` to scope the window."
---

# usage-auditor — Usage & Spend Auditor

Phase 8 read-only orchestrator that summarizes `usage.jsonl` into an actionable spend report. Feeds `daily-drain` preflight and the Home dashboard budget card (Phase 8).

## When to invoke

- Preflight for `daily-drain` to gate expensive drains under budget pressure
- On-demand when the BudgetPill shows amber or rose
- Monthly retrospective: what did this month cost, what's the trend

## Inputs

| Source | Path |
|---|---|
| Live summary | `GET http://localhost:3001/api/usage/summary` (preferred when proxy is up) |
| Usage log | `server/logs/usage.jsonl` (fallback / finer-grained filtering) |
| Drain log | `server/logs/drain-log.jsonl` (Cowork drain cost attribution) |
| Pricing table | embedded in `server/src/usage-summary.js` |

## Flags

- `--since <ISO-8601>` — start of audit window (default: first of current month).
- `--until <ISO-8601>` — end of window (default: now).
- `--forecast` — extrapolate projected month-end spend from current daily rate.
- `--format text|json|both` — output. Default `both`.
- `--top N` — limit byEndpoint table rows (default 10).

## Output — text shape

```
usage-auditor · {window: YYYY-MM-DD → YYYY-MM-DD} · {n rows}

total spend:    ${X.XX}       ({pct}% of ${monthlyCAP} cap)
throttle state: normal|soft|hard
throttle hits:  {M}           (requests that hit soft/hard gates)
drain attribution: ${D.DD}    ({pct}% — Cowork drain-log)

by endpoint (top {N} by spend):
  1. /api/trip-edit              {calls}  avg ${avg}  total ${total}  ({pct}%)
  2. /api/trip-qa                {calls}  avg ${avg}  total ${total}  ({pct}%)
  ...

daily trend:
  day 01   $0.11
  day 02   $0.08
  ...
  day {today}   $0.14   (partial)

forecast (--forecast):
  daily avg:       ${Y.YY}
  projected month: ${Z.ZZ}   ({pct}% of cap)
  at current rate, cap hit on {date} or never
  recommendation: {keep cap | lower to ${A} | raise to ${B}}
```

## Output — JSON shape

```json
{
  "window": { "since": "2026-04-01T00:00:00Z", "until": "2026-04-16T18:00:00Z" },
  "totalSpend": 0.037,
  "monthlyCAP": 50,
  "percentageUsed": 0.07,
  "throttleState": "normal",
  "throttleHits": 57,
  "drainAttribution": 0.002,
  "byEndpoint": [
    { "endpoint": "/api/trip-assistant", "calls": 21, "avgCost": 0.00125, "totalCost": 0.02625, "percentOfMonth": 69.83, "lastCallAt": "2026-04-16T16:04:15.773Z" }
  ],
  "dailyTrend": [{ "day": "2026-04-15", "spend": 0.011 }],
  "forecast": {
    "dailyAvg": 0.002,
    "projectedMonth": 0.08,
    "projectedPercent": 0.16,
    "capHitOn": null,
    "recommendation": "keep cap"
  }
}
```

## Composition strategy

Reads `usage.jsonl` directly (fast-path: reuses `getUsageSummary` from `server/src/usage-summary.js` when proxy is running; falls back to direct file read when proxy is down so audits still work offline). Drain attribution reads `server/logs/drain-log.jsonl`. Forecast is pure Tier 0 math (linear extrapolation of daily average).

## Guardrails

- **Read-only.** Never mutate usage.jsonl, drain-log.jsonl, or billing state.
- **Timezone-consistent.** All dates UTC unless `--format text`, which renders in America/New_York.
- **No network calls.** Pricing is embedded; no external price-API lookup.
- **Fail loud on malformed rows.** Skip the row, log to stderr, don't crash.
- **Respect privacy.** Never surface full message bodies — only aggregate counts + costs.

## Non-goals

- Not a drain (see `daily-drain`).
- Not a throttle enforcer (middleware does that server-side).
- Not a billing client — this audits local telemetry only.
