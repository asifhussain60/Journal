---
name: catch-up
description: "End-of-day synthesis orchestrator for Asif's journal. Invoke when the user says 'catch up', '/catch-up', '@catch-up', 'catch me up', 'daily catch-up', 'end of day', 'wrap up today', 'recap today', 'today's log', 'synthesize today', 'what did I do today', 'prep tomorrow', or 'plan next day'. Produces a preview synthesis that stitches (1) today's trip-log daily entries, (2) pending memoir-worthy captures from queues, and (3) next-day planning context. Preview-only by default (no canonical writes). Pair with `--dry-run` for visible preview, `--apply` is reserved for Phase 8 drain."
---

# catch-up — Daily Synthesis Orchestrator

Phase 7 router for Asif's end-of-day workflow. Stitches three existing surfaces into one synthesized brief for the user to review before any canonical writes land.

## When to invoke

- `catch-up` at end of travel day, or after a capture burst
- User explicitly asks for a recap, daily wrap, or next-day prep

## Inputs

| Source | Path | Purpose |
|---|---|---|
| Trip log | `trips/{slug}/journal/day-*.md` | Daily prose from trip-log flow |
| Pending queue | `trips/{slug}/pending.json` | Receipts + notes flagged this session |
| Voice inbox | `trips/{slug}/voice-inbox.json` (single JSON array) | Voice captures this session |
| Itinerary inbox | `trips/{slug}/itinerary-inbox.json` | Pasted itineraries awaiting triage |
| Trip state | `trips/{slug}/trip.yaml` | Current day cursor, active legs |

Resolve `{slug}` from `trips/manifest.json` → `activeSlug`, or accept `--slug <slug>` override.

## Flags

- `--dry-run` *(default)* — produce preview text; do not write.
- `--slug <slug>` — override active trip.
- `--scope today|yesterday|all` — window for queue rows (default `today`, wall-clock local).
- `--skip-voice` / `--skip-receipts` / `--skip-itinerary` — selectively exclude inputs.

## Output shape

Preview is plain markdown with five sections, in this order:

1. **Day cursor** — day N of M, date, location if resolvable.
2. **Today's trip log** — the matching `day-NN.md` inline (if present), else "not written yet".
3. **Captures awaiting drain** — bullet list from `pending.json` + `voice-inbox.json` + `itinerary-inbox.json`, grouped by `kind`. Each line shows `id`, `createdAt` (HH:mm), `memoryWorthy` flag, and a one-line summary.
4. **Memoir-worthy seeds** — subset of captures with `memoryWorthy: true`. Tagged with recommended destination (memoir chapter / reference / quote library).
5. **Next-day planning context** — pulled from `trip.yaml` (next leg, bookings, carryover notes).

Preview ends with a **Suggested next actions** footer: which drain (Phase 8) would consume each group, and whether the user should edit `day-NN.md` first.

## Composition strategy

Phase 7 orchestrator is standalone preview logic. When Phase 8 drain skills land (`journal-drain`, `ynab-drain`, `git-drain`), this orchestrator will delegate canonical writes to them; until then, `catch-up` never touches canonical files.

## Guardrails

- No writes to `chapters/`, `reference/`, `trip.yaml`, or any queue file.
- No deletions from queues.
- If `trips/{slug}/` is missing, fail loud with a one-line diagnostic.
- Voice-inbox shape is a single JSON array — reject `.jsonl` or per-entry files as legacy.
- All timestamps rendered in Asif's local timezone (America/New_York).

## Non-goals

- Not a memoir writer. Prose synthesis lives in `journal` skill (Phase 1+).
- Not a planner. Next-day detail lives in `trip-planner` skill.
- Not a drain. Canonical writes are Phase 8.
