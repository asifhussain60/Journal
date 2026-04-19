// shared/tag-normalize.js — dual-surface tag normalization (server + client).
// Pure function, zero dependencies.

/**
 * Normalize a raw tag string to a canonical slug form.
 * NFC-normalize → lowercase → whitespace runs → single hyphen →
 * strip non-[a-z0-9-] → collapse repeat hyphens → trim leading/trailing hyphens.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTag(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
