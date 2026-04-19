// refine.js — voice DNA refinement handler.
// Reads the voice fingerprint via the consolidated voice-fingerprint.js cache
// so the fingerprint can be edited without restarting the proxy.

import { getFingerprint, FINGERPRINT_PATH_RESOLVED } from "./voice-fingerprint.js";

const INSTRUCTION = `Your task is to refine the journal entry below so it matches Asif's voice fingerprint.

Strict rules:
- Preserve every fact, name, place, and event exactly as given. Do not invent or remove anything.
- Match the voice fingerprint rules above. Obey the ABSOLUTE PROHIBITIONS without exception.
- Do not add a closing lesson, moral, or summary. End where the raw entry ends.
- Do not add headings, lists, bold, italics, or markdown of any kind.
- Return ONLY the refined prose. No preamble like "Here is the refined version:". No trailing commentary.

Refine the entry below:
---`;

export function makeRefineHandler(anthropic, defaultModel) {
  return async function refineHandler(req, res) {
    const { text, model, max_tokens } = req.body ?? {};
    if (typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ ok: false, error: "text (non-empty string) is required" });
    }
    if (text.length > 20_000) {
      return res.status(413).json({ ok: false, error: "text exceeds 20000 chars — split into smaller chunks" });
    }

    let fingerprint;
    try {
      fingerprint = await getFingerprint();
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: `Could not load voice fingerprint at ${FINGERPRINT_PATH_RESOLVED}: ${err.message}`,
      });
    }

    const system = `${fingerprint}\n\n---\n\n${INSTRUCTION}`;

    try {
      const msg = await anthropic.messages.create({
        model: model ?? defaultModel,
        max_tokens: max_tokens ?? 2048,
        system,
        messages: [{ role: "user", content: text }],
      });
      const refined = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      res.json({
        ok: true,
        model: msg.model,
        stopReason: msg.stop_reason,
        usage: msg.usage,
        refined,
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message ?? String(err) });
    }
  };
}
