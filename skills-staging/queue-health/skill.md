---
name: queue-health
description: "Queue-health monitor for Asif's journal. Invoke when the user says 'queue-health', '/queue-health', '@queue-health', 'queue stats', 'how healthy are my queues', 'oldest pending', 'stuck items', or 'dashboard queue summary'. Returns a structured JSON summary (counts, oldest-row ages, stuck count, bucket usage) used by daily-drain preflight (Phase 8) and the Home dashboard queue-health card (Phase 8). No writes — read-only. Also produces a short human-friendly text report alongside the JSON."
---

# queue-health — Queue-Health Monitor

Phase 7 read-only monitor. Emits a structured summary for Phase 8 daily-drain preflight and for the Home dashboard queue-health card.

## When to invoke

- Preflight for any drain command (Phase 8)
- On dashboard render (Phase 8 Home card)
- User asks for queue stats or stuck-item count

## Inputs

| Source | Path |
|---|---|
| Pending queue | `trips/{slug}/pending.json` |
| Voice inbox | `trips/{slug}/voice-inbox.json` |
| Itinerary inbox | `trips/{slug}/itinerary-inbox.json` |
| Dead-letter | `trips/{slug}/dead-letter/*.json` (if present) |
| Receipts dir | `trips/{slug}/receipts/` (bucket size) |
| Snapshots dir | `trips/{slug}/snapshots/` (bucket size, gitignored per Phase 6) |
| Trip manifest | `trips/manifest.json` |

## Flags

- `--slug <slug>` — single trip. Default: all trips in `trips/manifest.json`.
- `--format json|text|both` — output. Default `both`.
- `--max-age-days N` — rows older than N days are flagged `aged` (default 7).

## Output — JSON shape

```json
{
  "generatedAt": "2026-04-16T17:22:10-04:00",
  "trips": [
    {
      "slug": "2026-04-ishrat-engagement",
      "active": true,
      "queues": {
        "pending":         { "pending": 3, "drained": 12, "stuck": 0, "oldestPendingAgeHours": 26.4, "agedCount": 1 },
        "voice-inbox":     { "pending": 7, "drained": 0,  "stuck": 0, "oldestPendingAgeHours": 4.1,  "agedCount": 0 },
        "itinerary-inbox": { "pending": 0, "drained": 2,  "stuck": 0, "oldestPendingAgeHours": null, "agedCount": 0 }
      },
      "deadLetter": { "count": 0, "oldestAgeHours": null },
      "buckets": {
        "receipts": { "fileCount": 15, "bytes": 4213822 },
        "snapshots": { "fileCount": 8, "bytes": 58211 }
      },
      "health": "green"
    }
  ],
  "rollup": {
    "trips": 1,
    "totalPending": 10,
    "totalStuck": 0,
    "oldestPendingAgeHours": 26.4,
    "health": "green"
  }
}
```

### health color rules

- `green` — no stuck rows, no aged rows, dead-letter empty
- `yellow` — any aged row OR dead-letter has entries under 24h OR total pending > 25
- `red` — any stuck row OR dead-letter > 24h OR oldestPendingAgeHours > 72

## Output — text shape

```
queue-health · 2026-04-16 17:22 EDT · overall: yellow

2026-04-ishrat-engagement (active) · yellow
  pending:         3 pending (oldest 26h — aged) · 12 drained
  voice-inbox:     7 pending (oldest 4h)
  itinerary-inbox: 0 pending
  dead-letter:     empty
  receipts bucket: 15 files / 4.0 MB
```

## Composition strategy

Standalone read-only aggregator. Pure local filesystem reads + JSON parsing; no Claude API. Phase 8 wires the JSON output into:
- `daily-drain` preflight (abort drain if `red`, warn if `yellow`)
- Home dashboard queue-health card (refresh on page load + on `trip:edited` + after any drain)

## Guardrails

- **Read-only.** Never mutate queues, buckets, or manifest.
- **Missing files are not errors.** Absent queue file → `{ pending: 0, drained: 0, stuck: 0, oldestPendingAgeHours: null }`.
- **Bucket sizing must be fast.** O(directory listing), not a recursive stat walk. Skip if directory has >10k entries (flag `buckets.receipts.truncated: true`).
- **Timezone-consistent.** All timestamps in ISO with offset; age is UTC delta.

## Non-goals

- Not a dashboard renderer (Phase 8 React card consumes the JSON).
- Not a drain or retry engine.
- Not a triager (see `queue-triage`).
