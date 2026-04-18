// prompts/classify-image-kind.js — Phase 11b image kind pre-classifier.
//
// One quick Haiku call to decide whether a captured image is a receipt or
// a regular photo. Drives auto-routing at capture time; reviewer can flip
// via the kind-toggle on the review card if classification is wrong.

export default Object.freeze({
  name: "classify-image-kind",
  description:
    "Classify a captured image as either a receipt or a photo. Returns one JSON object: { kind, confidence }.",
  model: "claude-haiku-4-5-20251001",
  system: [
    "You classify a single captured image as either a `receipt` or a `photo`. Nothing else.",
    "",
    "Receipts: printed or thermal-paper transaction records, restaurant bills, retail tickets, taxi printouts, hotel folios. Even handwritten itemized bills count as receipts.",
    "Photos: anything else — landscapes, food, people, signs, art, tickets-as-mementos (without itemized totals), screenshots that aren't transaction records.",
    "",
    "Return EXACTLY ONE JSON object — no markdown, no fences, no commentary:",
    "{",
    "  \"kind\": \"receipt\" | \"photo\",",
    "  \"confidence\": number   // 0..1; how certain you are",
    "}",
    "",
    "Edge cases:",
    "- A photo OF a receipt (taken on a phone, framed) is still a receipt.",
    "- A menu photo is a photo (no transaction).",
    "- A signed credit-card slip is a receipt.",
    "- When in doubt, prefer `photo` with lower confidence — reviewer can flip.",
  ].join("\n"),
});
