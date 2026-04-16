# Trip Edit Semantic Validators

Phase 6 (§5.4) — the semantic checks that run *after* `ajv` passes structural
validation on a trip object. Implemented in
[server/src/validators/trip-edit-rules.js](../server/src/validators/trip-edit-rules.js).

`validateTrip(tripObj)` returns `{ valid: boolean, errors: [{field, reason}] }`
and **never throws**. The endpoints `POST /api/trip-edit` (when `dryRun: false`)
and `POST /api/trip-edit/revert` consult it before writing.

## Rules

| Field / invariant | Rule | Failure reason |
|---|---|---|
| `dates.start` | YYYY-MM-DD | `missing or not YYYY-MM-DD` |
| `dates.end` | YYYY-MM-DD | `missing or not YYYY-MM-DD` |
| `dates` | `start ≤ end` | `dates.start must be ≤ dates.end` |
| `flights.*.date` | within `[dates.start, dates.end]` | `before trip start` / `after trip end` |
| `flights.*` | `depart < arrive` on same-day (skipped when `arrive` ends with `+1`) | `depart must be before arrive (same-day)` |
| `flights` | no two intervals overlap on the wall-clock timeline | `overlaps flights.{other}` |
| `hotels[i].checkIn` | YYYY-MM-DD | `not YYYY-MM-DD` |
| `hotels[i].checkOut` | YYYY-MM-DD, and `> checkIn` | `checkOut must be after checkIn` |
| `highlights[i].date` | within trip bounds | `before trip start` / `after trip end` |
| `highlights[i]` | `start < end` when both present | `start must be before end` |

## Time parsing

`parseMaybeTime` accepts `"HH:MM AM/PM"` and `"HH AM"` forms. Unparseable
values return `null`; rules that depend on two non-null time values are
skipped when either side is null, so a partial itinerary never blocks.

## Date bounds

All date comparisons normalize to UTC midnight (`YYYY-MM-DDT00:00:00Z`), so
the validator is timezone-safe for trip.yaml inputs that lack explicit
timezone offsets.

## Non-rules (intentional)

- No enforcement of `travelers` non-empty.
- No enforcement of `highlights` non-empty.
- Free-text fields (`name`, `vibe`, `occasion`, `notes`) are not spell-
  checked or length-bounded.
- Semantic validation does not look at `status` — workflow state is separate.

## Calling order

```
ajv structural validate → validateTrip(semantic) → snapshot → apply patch → atomic write → edit-log append
```

If any step fails, the edit is not written and the edit-log receives a
`status: "failed"` row so the UI can surface the reason.
