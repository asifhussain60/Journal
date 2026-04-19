// voice-fingerprint.js — consolidated fingerprint loader with 5-second TTL hot-reload.
// Both routes/log.js and lib/refine.js import from here. The TTL-cache semantics
// are identical to the original refine.js implementation: cheap re-reads on burst
// requests, but edits to the fingerprint file propagate within 5 seconds.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/src/lib -> server/src -> server -> repo root -> reference/
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference");
const FINGERPRINT_PATH = path.join(REFERENCE_DIR, "voice-fingerprint.md");
const FINGERPRINT_LIGHT_PATH = path.join(REFERENCE_DIR, "voice-fingerprint-light.md");

const CACHE_TTL_MS = 5_000;

let _fp = null;
let _fpAt = 0;
let _fpLight = null;
let _fpLightAt = 0;

/**
 * Load the full voice fingerprint (voice-fingerprint.md).
 * Cached with a 5-second TTL for hot-reload.
 * @returns {Promise<string>}
 */
export async function getFingerprint() {
  const now = Date.now();
  if (_fp && now - _fpAt < CACHE_TTL_MS) return _fp;
  _fp = await readFile(FINGERPRINT_PATH, "utf8");
  _fpAt = now;
  return _fp;
}

/**
 * Load the light voice fingerprint (voice-fingerprint-light.md).
 * Tone constraints + absolute prohibitions only — no prose-voice deep analysis.
 * Cached with a 5-second TTL for hot-reload.
 * @returns {Promise<string>}
 */
export async function getFingerprintLight() {
  const now = Date.now();
  if (_fpLight && now - _fpLightAt < CACHE_TTL_MS) return _fpLight;
  _fpLight = await readFile(FINGERPRINT_LIGHT_PATH, "utf8");
  _fpLightAt = now;
  return _fpLight;
}

/**
 * Invalidate all caches — for testing.
 */
export function invalidate() {
  _fp = null;
  _fpAt = 0;
  _fpLight = null;
  _fpLightAt = 0;
}

/** Expose the resolved path for callers that need it (e.g. error messages). */
export const FINGERPRINT_PATH_RESOLVED = FINGERPRINT_PATH;
export const FINGERPRINT_LIGHT_PATH_RESOLVED = FINGERPRINT_LIGHT_PATH;
