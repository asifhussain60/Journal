---
name: daily-drain
description: "Morning / on-demand drain orchestrator for Asif's journal. Invoke when the user says 'daily-drain', '/daily-drain', '@daily-drain', 'drain queues', 'run daily drain', 'morning drain', 'batch drain', 'process pending captures', or 'clear my inbox'. Calls `queue-health` preflight, surfaces backlog, proposes drain order (high-priority receipts first → voice → itinerary), and runs the Phase 8 drain sequence under user approval. Accepts `--auto` to approve drains inline. Logs to `server/logs/drain-log.jsonl`. Respects budget throttle (hard-throttle aborts the drain; soft-throttle warns)."
---

# daily-drain — Morning Drain Orchestrator

Phase 8 orchestrator that walks the full drain sequence: preflight → triage → per-queue drain → audit. Routes through existing Phase 7 orchestrators and Phase 8 endpoints; does not duplicate synthesis logic.

## When to invoke

- Morning routine after a high-capture day
- On-demand when the Home dashboard queue-health card shows yellow or red
- After a known stuck-item incident, once the user wants to retry

## Pipeline

```
1. queue-health (Phase 7) → JSON preflight
     ├─ if red → abort, show reason
     └─ if yellow → warn, continue on --auto, else prompt user
2. usage-auditor --forecast → budget guard
     └─ if projected > monthlyCAP → abort unless --auto
3. queue-triage (Phase 7) → ordered processing plan
4. Per queue, in order:
     a. voice-inbox      → voice-to-prose  (preview + apply)
     b. pending (receipts) → memory-promotion → food-photo (for food receipts)
     c. itinerary-inbox  → trip-edit (applies previewed itinerary merges)
     d. dead-letter      → surfaced to Trip > Queue (user acts manually)
5. Append one drain-log entry per queue drained (server/logs/drain-log.jsonl)
6. Final summary: drained counts, skipped, stuck, time elapsed, tokens spent
```

## Flags

- `--dry-run` *(default)* — walk the pipeline, preview all actions, write nothing.
- `--auto` — approve each step inline; errors still pause.
- `--slug <slug>` — override active trip.
- `--only <queue>` — drain a single queue (voice-inbox | pending | itinerary-inbox).
- `--max-tokens <N>` — hard cap token spend across the whole drain.

## Inputs

| Source | Path |
|---|---|
| Queue health | `GET http://localhost:3001/api/usage/summary` + `GET /api/dead-letter` + per-queue GETs |
| Trip state | `trips/{slug}/trip.yaml` |
| Trip manifest | `trips/manifest.json` |
| Drain log | `server/logs/drain-log.jsonl` (append-only) |

## Output shape

```
## daily-drain · {slug} · {timestamp local}

Preflight:
  queue-health: green | yellow ({reason}) | red ({reason, aborted})
  budget:       {pct}% used, projected {pct}%, throttleState: normal|soft|hard

Plan:
  1. voice-inbox:      {N} rows → voice-to-prose (target memoir)
  2. pending:          {M} rows → memory-promotion → food-photo
  3. itinerary-inbox:  {K} rows → trip-edit merge

Execution ({dry-run | auto}):
  ✓ voice-inbox:  {N processed, P promoted to memoir, Q dropped}
  ✓ pending:      {M processed, F paired, G routed to incident-bank}
  ⚠ itinerary-inbox: skipped ({reason})
  ✗ stuck:        {J entries in dead-letter — surfaced in Trip > Queue}

Drain summary:
  drained:   {total rows}
  skipped:   {total rows}
  stuck:     {total rows}
  tokens:    {in}/{out}
  spend:     ${dollars}
  elapsed:   {seconds}
```

## Composition strategy

Thin router that invokes queue-health → usage-auditor → queue-triage → voice-to-prose → memory-promotion → food-photo. Each invocation is `--dry-run` by default; with `--auto`, daily-drain re-invokes with `--apply` (Phase 8 contract: `--apply` is the drain-side flag that flips queue `status: pending` → `drained` and writes to memoir/YNAB/git). Appends one JSONL row per queue drained to `server/logs/drain-log.jsonl` with shape `{ timestamp, orchestrator: "daily-drain", queue, rowsProcessed, rowsDrained, rowsStuck, tokensIn, tokensOut, cost, elapsedMs }`.

## Guardrails

- **Respect budget throttle.** If `/api/usage/summary` returns `throttleState: hard`, abort. If `soft`, warn and require `--auto` to continue.
- **Never drain from a red queue-health state.** User must resolve stuck entries first.
- **Preview before write.** Even under `--auto`, each per-queue step previews its changes before applying.
- **Idempotent across runs.** If a row is already `status: drained`, skip silently.
- **Dead-letter is not auto-drained.** daily-drain surfaces stuck entries but never retries them — user decides via Trip > Queue.
- **No memoir writes without voice-DNA pass.** voice-to-prose's `FAILED-DNA` rows are routed to `needs-more`, not memoir.

## Non-goals

- Not a synthesizer (see `voice-to-prose`, `memory-promotion`, `food-photo`).
- Not a retry engine for dead-letter (user-gated in Trip > Queue).
- Not a budget enforcer (throttle middleware does that server-side).
