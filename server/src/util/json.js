// util/json.js — robust JSON extraction for model outputs.
//
// Models occasionally emit markdown-fenced JSON, preamble prose, trailing
// commentary, or JS-literal `undefined` tokens. These helpers recover the
// first balanced {...} block and retry once with `undefined → null`
// sanitization before giving up.

// Replace bare `undefined` tokens (outside string literals) with `null`.
// Models occasionally emit JS-literal syntax instead of strict JSON — e.g.
// `"old": undefined` when describing a field that didn't previously exist.
// JSON.parse rejects that, even though the rest of the payload is well-formed.
export function sanitizeLooseJson(s) {
  let out = "";
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; out += ch; continue; }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (
      ch === "u" &&
      s.slice(i, i + 9) === "undefined" &&
      !/[\w$]/.test(s[i + 9] || "")
    ) {
      out += "null";
      i += 8;
      continue;
    }
    out += ch;
  }
  return out;
}

// Strip markdown fences, scan for the first balanced {...} block. Handles
// common model failure modes — fenced output, preamble prose, trailing
// commentary — that a greedy regex trips over. On strict JSON.parse failure,
// retries once with `undefined` → `null` sanitization.
export function extractJsonObject(raw) {
  if (typeof raw !== "string" || !raw.length) return null;
  let s = raw.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
  const firstBrace = s.indexOf("{");
  if (firstBrace < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = firstBrace; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(firstBrace, i + 1);
        try { return JSON.parse(candidate); }
        catch {
          try { return JSON.parse(sanitizeLooseJson(candidate)); }
          catch { return null; }
        }
      }
    }
  }
  return null;
}
