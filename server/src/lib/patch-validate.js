// patch-validate.js — pure patch-request validation (D11 allowlist guard).
// Extracted from routes/trip-edit.js so it can be unit-tested and reused.

/** Paths that may appear in a patches[] body sent to /api/trip-edit. */
export const ALLOWED_PATCH_PATHS = new Set([
  "/narrative",
  "/narrativeAiHashes",
  "/reflection",
  "/highlights",
  "/highlightsAiHashes",
  "/dayoneTags",
  "/rejectedAiTags",
]);

/** Path prefixes that are implicitly allowed (array-item writes). */
export const ALLOWED_PATCH_PREFIXES = [
  "/highlights/",
  "/highlightsAiHashes/",
  "/dayoneTags/",
  "/rejectedAiTags/",
];

/**
 * Validate a patches[] array against the allowlist.
 * @param {Array<{op: string, path: string, value?: unknown}>} patches
 * @returns {{ ok: boolean, error?: string }}
 */
export function validatePatchPaths(patches) {
  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: false, error: "patches must be a non-empty array" };
  }
  for (const op of patches) {
    const p = op?.path;
    if (!p || typeof p !== "string") {
      return { ok: false, error: "each patch must have a path" };
    }
    const allowed =
      ALLOWED_PATCH_PATHS.has(p) ||
      ALLOWED_PATCH_PREFIXES.some((pfx) => p.startsWith(pfx));
    if (!allowed) {
      return { ok: false, error: `patch path not allowed: ${p}` };
    }
  }
  return { ok: true };
}

/**
 * Returns true when the patch array contains only tag-related paths.
 * Tag-only patches bypass the REFINE_ALL_ENABLED gate.
 * @param {Array<{path: string}>} patches
 * @returns {boolean}
 */
export function isTagOnlyPatch(patches) {
  return (
    Array.isArray(patches) &&
    patches.length > 0 &&
    patches.every(
      (p) => p?.path === "/dayoneTags" || p?.path === "/rejectedAiTags"
    )
  );
}
