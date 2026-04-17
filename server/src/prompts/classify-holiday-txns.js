// prompts/classify-holiday-txns.js — Haiku-targeted classifier for Holiday
// category transactions. Groups YNAB outflows into 8 standard trip buckets
// using the payee name and the user's free-form memo notes.
//
// Input:  array of { id, payee, memo, amount }
// Output: one JSON object { classifications: [{ id, category, reason }] }
//   - id       — echo of the input id (caller verifies every input is returned)
//   - category — one of the CATS below (caller remaps anything else to "Misc")
//   - reason   — one short phrase (≤6 words) citing the signal used

export default Object.freeze({
  name: "classify-holiday-txns",
  description:
    "Classify Holiday-category YNAB transactions into 8 trip buckets using payee + memo.",
  model: "claude-haiku-4-5-20251001",
  system: [
    "You classify travel expense transactions into one of EXACTLY these 8 categories:",
    "  Flights, Lodging, Transport, Dining, Shopping, Entertainment, Insurance, Misc",
    "",
    "Signals, in priority order:",
    "  1. The user's `memo` — it often contains notes like 'flight to EWR', 'spa deposit', 'cab tip'.",
    "  2. The `payee` name — airlines → Flights, hotels → Lodging, restaurants → Dining, etc.",
    "  3. The amount — last resort tiebreaker (large amounts tend to be Flights/Lodging).",
    "",
    "Category hints:",
    "  - Flights:        airlines, seat upgrades, baggage fees, airport lounges.",
    "  - Lodging:        hotels, Airbnb, resorts, spa stays that include the room.",
    "  - Transport:      taxi, Uber, Lyft, rental cars, fuel, parking, EZ-Pass, trains, car-service tips.",
    "  - Dining:         restaurants, cafes, bars, meal delivery, groceries consumed on trip.",
    "  - Shopping:       clothing, gifts, souvenirs, jewelry, boutiques.",
    "  - Entertainment:  movies, concerts, tours, admission tickets, activities.",
    "  - Insurance:      travel insurance, medical insurance, trip-cancellation cover.",
    "  - Misc:           anything that doesn't cleanly fit — do not invent new categories.",
    "",
    "Output EXACTLY one JSON object in this shape — no prose, no markdown, no fences:",
    '  { "classifications": [ { "id": "...", "category": "Flights", "reason": "United Airlines" } ] }',
    "",
    "Rules:",
    "- Return one classification per input id. Do NOT skip, merge, or invent ids.",
    "- `category` must be one of the 8 listed above, spelled exactly.",
    "- `reason` is ≤6 words, citing the single clearest signal (e.g. 'memo: spa deposit', 'payee: United Airlines').",
    "- When genuinely ambiguous, prefer Misc over guessing — the caller surfaces Misc for review.",
  ].join("\n"),
});
