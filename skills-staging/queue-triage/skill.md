---
name: queue-triage
description: "Queue preflight and processing-order orchestrator for Asif's journal. Invoke when the user says 'queue-triage', '/queue-triage', '@queue-triage', 'triage queues', 'what's in my queue', 'what should I drain first', 'preflight drain', 'stuck queue items', 'dead-letter check', or 'queue backlog'. Reads all App-side queues (pending.json, voice-inbox.json, itinerary-inbox.json, dead-letter) and produces a classified, ordered processing plan. Preview-only; use `--auto` to stage selections for Phase 8 drain."
---

# queue-triage — Queue Preflight Orchestrator

Phase 7 orchestrator that looks across every queue and proposes a processing order. No writes — this is the preflight that feeds Phase 8 drains.

## When to invoke

- Before running any drain (manual or scheduled)
- When the user wants a cross-queue view without drilling in
- After a large capture burst, to decide what to process first

## Inputs

| Source | Path |
|---|---|
| Pending queue | `trips/{slug}/pending.json` |
| Voice inbox | `trips/{slug}/voice-inbox.json` (single JSON array) |
| Itinerary inbox | `trips/{slug}/itinerary-inbox.json` |
| Dead-letter | `trips/{slug}/dead-letter/*.json` (if present; Phase 8 will write here) |
| Trip manifest | `trips/manifest.json` |

## Flags

- `--dry-run` *(default)* — emit triage plan; no writes.
- `--slug <slug>` — override active trip. Accepts `--slug all` to triage every trip in `trips/manifest.json`.
- `--auto` — stage selections in-memory for Phase 8 drain to pick up (still no disk writes in Phase 7; emits the stage-marker preview).
- `--min-priority low|med|high` — cutoff for inclusion (default `low`).
- `--kinds receipt,voice,itinerary,note` — filter.

## Classification taxonomy

For every queue row, assign:

- **priority** — `high` (time-sensitive: itinerary for today/tomorrow; receipts over 48h old; stuck rows), `med` (receipts, voice memory-seeds), `low` (throwaway notes, already-logged itinerary).
- **effort** — `quick` (one-shot drain), `complex` (needs synthesis, e.g. voice → memoir), `blocked` (waiting on user input or missing data).
- **destination-class** — `memoir`, `ynab`, `git`, `itinerary-replace`, `drop`.

## Output shape

```
## queue-triage · {slug} · {timestamp local}

### counts
| queue | pending | drained | stuck | total |
|---|---|---|---|---|
| pending | N | M | K | T |
| voice-inbox | ... |
| itinerary-inbox | ... |
| dead-letter | — | — | J | J |

### suggested order
1. {id} · pending · receipt · high · quick · ynab
   Reason: {one line}
2. {id} · itinerary-inbox · itinerary · high · complex · itinerary-replace
   Reason: {one line}
...

### skip list
- {id} · {reason: dedupKey match, memoryWorthy: false + kind: note, age > 30d}

### stuck / dead-letter
- {id} · {kind} · last error: {from dead-letter metadata if present}
  Recommended action: {retry | discard | escalate}
```

## Composition strategy

Reads queue files directly. Uses lightweight local heuristics for priority/effort (no Claude API call required for the ordering). When Phase 8 `daily-drain` lands, it will call `queue-triage --auto` as preflight.

## Guardrails

- **No writes to queues.** Status flips belong to Phase 8 drain.
- **Never delete dead-letter.** Only report.
- **Respect row schemas.** Unknown `kind` → classify as `blocked` with reason "unknown kind".
- **Skip status: "drained"** when proposing order; include them in counts only.

## Non-goals

- Not a drain.
- Not a memoir synthesizer.
- Not a retry engine for dead-letter (Phase 8).
