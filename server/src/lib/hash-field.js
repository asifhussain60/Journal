// hash-field.js — content-hash for AI-written field comparison (D4).
// Returns the first 16 hex chars of a SHA-256 digest.

import { createHash } from "node:crypto";

/**
 * Hash a field value for AI-clean/edited detection.
 * @param {string} value
 * @returns {string} 16-char hex hash
 */
export function hashField(value) {
  if (typeof value !== "string") return "";
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}
