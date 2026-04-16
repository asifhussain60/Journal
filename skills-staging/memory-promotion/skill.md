---
name: memory-promotion
description: "Memoir-vs-reference routing orchestrator for Asif's captures. Invoke when the user says 'memory-promotion', '/memory-promotion', '@memory-promotion', 'promote memories', 'promote to memoir', 'route memoryWorthy items', 'triage memoir seeds', 'what's worth promoting', or 'check promotion backlog'. Reads `trips/{slug}/pending.json` rows flagged `memoryWorthy: true`, determines the right destination (long-form memoir chapter vs short reference container: incidents, quotes, food photos), and produces a routing preview for user approval. Supports `--query` to inspect the backlog without proposing routes."
---

# memory-promotion — Memoir vs Reference Router

Phase 7 orchestrator that triages `memoryWorthy` captures and proposes the right destination. No writes — preview only until Phase 8 drain.

## When to invoke

- At end of day after `catch-up` flags memoryWorthy seeds
- User asks "what's worth promoting" or "memoir backlog"
- `catch-up --scope all` returns a large memoir-seed list

## Inputs

| Source | Path | Purpose |
|---|---|---|
| Pending queue | `trips/{slug}/pending.json` | Primary source — rows with `memoryWorthy: true` |
| Voice inbox | `trips/{slug}/voice-inbox.json` | Secondary — voice rows with `memoryWorthy: true` |
| Chapter index | `reference/chapter-status.md` | Which memoir chapters are open for new prose |
| Incident bank | `reference/incident-bank.md` | Short-form incident container |
| Quotes library | `reference/quotes-library.txt` | Quote container |
| Thematic arc | `reference/thematic-arc.md` | Arc/theme matching for memoir chapter selection |

## Flags

- `--dry-run` *(default)* — emit routing plan; do not write.
- `--slug <slug>` — override active trip.
- `--query` — inspect backlog only: counts, ages, sample rows. No routing proposal.
- `--kind receipt|voice|note|all` — filter source kinds (default `all`).
- `--threshold high|med|low` — promotion confidence cutoff (default `med`).

## Routing taxonomy

For each `memoryWorthy` row, propose exactly one destination:

| Destination | When |
|---|---|
| **memoir chapter `chapters/NN-*.md`** | Scene-worthy moment, fits an open chapter per `chapter-status.md`. Needs prose synthesis — hand to `voice-to-prose` or `journal` first. |
| **reference/incident-bank.md** | Short incident, non-scene. One-paragraph max. |
| **reference/quotes-library.txt** | Verbatim quote worth preserving, no surrounding prose needed. |
| **reference/food-log (via food-photo)** | Receipt with food context; route through `food-photo` pairing first. |
| **drop** | Below threshold or duplicate of an existing entry. |

Confidence per route (low/med/high) with a one-line reason.

## Output shape

```
## memory-promotion preview · {slug} · {dateRange}

Backlog: {N memoryWorthy rows} ({M receipt, K voice, J note})

### route → memoir
- {id} ({kind}, {createdAt local}) · chapter {NN-title} · {confidence}
  Reason: {one line}
  Next step: voice-to-prose --entries {id} --target memoir

### route → reference/incident-bank.md
- {id} ({kind}, {createdAt local}) · {confidence}
  Snippet: {<= 140 chars}

### route → reference/quotes-library.txt
- {id} · "{quote text}"

### route → food-photo
- {id} (receipt) · {merchant if present}
  Next step: food-photo --entries {id}

### drop
- {id} · {reason: duplicate | below threshold | out-of-scope}
```

With `--query`, output is the backlog summary only (counts, ages of oldest row per kind, top 5 highest-confidence candidates).

## Composition strategy

Reads queue files + reference indexes. Uses Sonnet for chapter-match reasoning when proposing memoir routes. Delegates prose synthesis to `voice-to-prose` (not a call — just a suggested next command in the preview). Phase 8 `journal-drain` applies routes.

## Guardrails

- **No writes.** Reference containers and memoir chapters are untouched.
- **No queue mutation.** Rows remain `status: "pending"`.
- **Respect locked paragraphs.** Never propose editing text inside `reference/locked-paragraphs.md`-marked regions.
- **Temporal guardrail (per `reference/temporal-guardrail.md`).** Don't route to a chapter whose timeline doesn't include the row's `createdAt`.

## Non-goals

- Not a prose synthesizer (see `voice-to-prose`).
- Not a drain (Phase 8).
- Not a food-memoir reconciler (see `food-photo`).
