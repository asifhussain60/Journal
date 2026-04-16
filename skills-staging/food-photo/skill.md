---
name: food-photo
description: "Food-photo pairing orchestrator for Asif's journal. Invoke when the user says 'food-photo', '/food-photo', '@food-photo', 'pair food photos', 'match receipts to memoir', 'food memory pairing', 'reconcile food receipts', or 'link food photos to chapters'. Reads receipt images + metadata from `trips/{slug}/receipts/` and pairs them with hand-authored food memories in memoir (chapters/ + reference/incident-bank.md + `trips/{slug}/memoir-extracts.md`). Surfaces cross-link suggestions (\"April 15 lunch at Venice Beach matches food entry in chapter 5, line 247\"). Preview-only with `--dry-run`; no writes."
---

# food-photo — Receipt × Memoir Food Pairing

Phase 7 orchestrator that reconciles photographed food receipts with hand-authored food memories. Produces cross-link suggestions; never edits memoir files.

## When to invoke

- After receipts land in `trips/{slug}/receipts/` (receipt kind, approved into `pending.json`)
- When the user wants to enrich memoir food passages with photo evidence
- As a downstream step from `memory-promotion` when routing receipts → memoir

## Inputs

| Source | Path | Purpose |
|---|---|---|
| Pending queue | `trips/{slug}/pending.json` | Rows where `kind: "receipt"` and `payload.category` suggests food (or explicit `memoryWorthy: true`) |
| Receipt images | `trips/{slug}/receipts/` | Image files named by row id |
| Trip memoir extracts | `trips/{slug}/memoir-extracts.md` | Tier-1 scope: trip-scoped memoir text |
| Memoir chapters | `chapters/*.md` | Tier-2 scope: full memoir |
| Incident bank | `reference/incident-bank.md` | Food incidents (short form) |
| Trip context | `trips/{slug}/trip.yaml` | Day cursor + location for geo/temporal bounding |

## Flags

- `--dry-run` *(default)* — emit pairing suggestions; do not write.
- `--slug <slug>` — override active trip.
- `--scope trip|memoir|both` — search scope. `trip` = `memoir-extracts.md` only; `memoir` = chapters/ + reference/; `both` (default).
- `--min-confidence low|med|high` — only emit pairings above threshold (default `med`).
- `--entries <ids...>` — restrict to specific pending.json receipt ids.
- `--photo-only` — skip memoir search; just list food receipts awaiting pairing.

## Pairing signals

- **Temporal overlap** — receipt `createdAt` within ±24h of a memoir date reference
- **Merchant match** — OCR'd merchant name appears in memoir text
- **Geo match** — trip.yaml day's location matches memoir location prose
- **Dish match** — payload.items / OCR text intersects a described dish
- **Trip slug match** — receipt is in `trips/{slug}/`; memoir passage references the same trip

Each pairing gets a confidence (low/med/high) and a signal breakdown.

## Output shape

```
## food-photo pairing · {slug} · {dateRange}

Food receipts considered: {N}
Pairings proposed: {M}
Unpaired receipts: {K}

### pairings

#### {receiptId} · {merchant} · {receipt createdAt local}
- image: trips/{slug}/receipts/{receiptId}.jpg
- signals: temporal✓ merchant✓ geo✓ dish~ (confidence: high)
- candidate memoir passage:
    chapters/05-edison-saturday.md:247
    "We ended up at Mithaas, which smelled like every Saturday of my childhood."
- suggested action: cross-link (add photo reference footnote) | merge (inline photo caption)

#### {receiptId} · {merchant} · ...
- (no match above threshold — leave for manual review)

### unpaired food receipts
- {receiptId} · {merchant} · {createdAt local} · reason: no temporal/geo overlap with any food passage
```

## Composition strategy

- Filesystem + Claude API (Sonnet class) for fuzzy text matching between OCR'd receipt payloads and memoir passages.
- Uses temporal + geo filters *first* to narrow search space, then Sonnet for dish/merchant match within candidates.
- Feeds suggestions to the user. Any cross-link footnote or caption insertion is a Phase 8 `journal-drain` action, not a Phase 7 side-effect.

## Guardrails

- **Never edit chapters/ or reference/.** This is a read-only search + suggestion engine.
- **Never edit pending.json.** Pairing status persistence is Phase 8.
- **Respect locked paragraphs.** Skip passages inside regions marked by `reference/locked-paragraphs.md`.
- **Respect @@markers.** Never propose edits that would cross a `@@` scratchpad boundary (per memoir-rules-supplement.txt). Suggestions stay at footnote/caption level, not inline edits.
- **Photo privacy.** Never upload image bytes in Phase 7 preview output — emit path only.

## Non-goals

- Not a memoir editor.
- Not a receipt OCR pipeline (Phase 4 handles that).
- Not a YNAB writer (Phase 8 `ynab-drain`).
