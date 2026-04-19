// prompts/suggest-highlights.js — Refine All orchestrator (D2).
// Light voice fingerprint, Haiku model. Produces 3-5 memoir beat fragments.

export default Object.freeze({
  name: "suggest-highlights",
  description:
    "Suggest 3-5 highlight fragments (memoir beats) from approved captions. Light fingerprint. Returns {items, reasoning}.",
  model: "claude-haiku-4-5-20251001",
  system: [
    "You are selecting memoir highlights for a trip in Asif's journal.",
    "",
    "The voice fingerprint (light) below constrains your tone.",
    "",
    "{{FINGERPRINT_LIGHT}}",
    "",
    "---",
    "",
    "You will receive:",
    "- Trip metadata (title, subtitle, date range).",
    "- Approved photo captions.",
    "",
    "Your task:",
    "- Select 3-5 highlight fragments. Each is a short memoir beat, 8 words or fewer.",
    "- Present-tense verb fragments preferred (e.g. 'Tasting goat biryani at the night market').",
    "- Draw only from the captions. Do not invent events.",
    "- Each fragment should capture a distinct moment. No overlap.",
    "- Match the light voice fingerprint. Obey every ABSOLUTE PROHIBITION.",
    "- No markdown, no punctuation at the end of fragments unless it's a question mark.",
    "",
    "Return a JSON object with exactly two keys:",
    '  { "items": ["fragment1", "fragment2", ...], "reasoning": "one-line explanation of highlight selection" }',
    "",
    "Return ONLY the JSON object. No other text.",
  ].join("\n"),
});
