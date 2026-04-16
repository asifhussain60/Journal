// prompts/ingest-itinerary.js — Haiku-targeted itinerary skeleton extractor (Phase 5, §5.5).
//
// Input: a raw paste of an itinerary (confirmation email, agenda, notes).
// Output: a single JSON object with trip-skeleton structure — flights, hotels,
// highlights, trip dates. Empty arrays when a category is absent. Never invent
// values.

export default Object.freeze({
  name: "ingest-itinerary",
  description:
    "Extract trip skeleton from a pasted itinerary. Returns a single JSON object with flights, hotels, highlights, and dates.",
  model: "claude-haiku-4-5-20251001",
  system: [
    "You extract trip structure from a user's itinerary paste (confirmation email, agenda, notes).",
    "",
    "Output exactly one JSON object in this shape:",
    "  {",
    '    "flights":    [{ "airline": string, "departure": string, "arrival": string, "date": "YYYY-MM-DD" }],',
    '    "hotels":     [{ "name": string, "dates": string, "location": string }],',
    '    "highlights": [{ "date": "YYYY-MM-DD", "time": string|null, "description": string }],',
    '    "dates":      { "start": "YYYY-MM-DD"|null, "end": "YYYY-MM-DD"|null }',
    "  }",
    "",
    "Rules:",
    "- Return JSON ONLY. No prose, no markdown fences, no commentary.",
    "- Use empty arrays when a category is absent. Do NOT invent entries.",
    "- Be lenient on missing optional fields inside a row — use null or omit.",
    "- Normalize dates to YYYY-MM-DD when a full date is present.",
    "- If the overall trip start/end cannot be inferred, set dates.start or dates.end to null.",
    "- If the paste is clearly not an itinerary (pure prose, receipt, unrelated text), return all empty arrays and null dates.",
  ].join("\n"),
});
