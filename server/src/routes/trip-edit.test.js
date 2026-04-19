// trip-edit.test.js — Pre-E0 test harness bootstrap
// Tests the patch validation logic that guards POST /api/trip-edit.
// All tests use pure functions from lib/patch-validate.js — no HTTP or fs calls.
// The version-conflict (D11) guard is tested by simulating the SHA-256 comparison.
// Uses Node built-in test runner. Zero new dependencies.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  validatePatchPaths,
  isTagOnlyPatch,
  ALLOWED_PATCH_PATHS,
  ALLOWED_PATCH_PREFIXES,
} from "../lib/patch-validate.js";

// ─── validatePatchPaths (D11 allowlist guard) ────────────────────────────────

describe("validatePatchPaths — allowlist guard", () => {
  it("rejects non-array input", () => {
    assert.equal(validatePatchPaths(null).ok, false);
    assert.equal(validatePatchPaths("string").ok, false);
    assert.equal(validatePatchPaths({}).ok, false);
  });

  it("rejects empty array", () => {
    const r = validatePatchPaths([]);
    assert.equal(r.ok, false);
    assert.match(r.error, /non-empty/);
  });

  it("rejects a patch without a path property", () => {
    const r = validatePatchPaths([{ op: "replace", value: "x" }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /must have a path/);
  });

  it("rejects an unknown path", () => {
    const r = validatePatchPaths([{ op: "replace", path: "/title", value: "x" }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /not allowed: \/title/);
  });

  it("rejects /version write (immutable — concurrency token only)", () => {
    const r = validatePatchPaths([{ op: "replace", path: "/version", value: "abc" }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /not allowed/);
  });

  it("accepts every ALLOWED_PATCH_PATHS entry", () => {
    for (const p of ALLOWED_PATCH_PATHS) {
      const r = validatePatchPaths([{ op: "replace", path: p, value: "x" }]);
      assert.equal(r.ok, true, `expected ${p} to be allowed`);
    }
  });

  it("accepts paths under allowed prefixes", () => {
    for (const pfx of ALLOWED_PATCH_PREFIXES) {
      const p = pfx + "0";
      const r = validatePatchPaths([{ op: "replace", path: p, value: "x" }]);
      assert.equal(r.ok, true, `expected ${p} to be allowed`);
    }
  });

  it("accepts mixed allowed operations in one batch", () => {
    const r = validatePatchPaths([
      { op: "replace", path: "/narrative", value: "new text" },
      { op: "replace", path: "/dayoneTags", value: ["oman", "trip"] },
      { op: "replace", path: "/highlights/0", value: "first highlight" },
    ]);
    assert.equal(r.ok, true);
  });

  it("rejects a batch where any single path is disallowed", () => {
    const r = validatePatchPaths([
      { op: "replace", path: "/narrative", value: "ok" },
      { op: "replace", path: "/injected", value: "bad" },
    ]);
    assert.equal(r.ok, false);
    assert.match(r.error, /not allowed: \/injected/);
  });
});

// ─── isTagOnlyPatch ──────────────────────────────────────────────────────────

describe("isTagOnlyPatch", () => {
  it("returns true when all patches target /dayoneTags", () => {
    assert.ok(isTagOnlyPatch([{ op: "replace", path: "/dayoneTags", value: [] }]));
  });

  it("returns true when all patches target /rejectedAiTags", () => {
    assert.ok(isTagOnlyPatch([{ op: "replace", path: "/rejectedAiTags", value: [] }]));
  });

  it("returns true for a mixed bag of dayoneTags + rejectedAiTags", () => {
    assert.ok(
      isTagOnlyPatch([
        { op: "replace", path: "/dayoneTags", value: [] },
        { op: "replace", path: "/rejectedAiTags", value: [] },
      ])
    );
  });

  it("returns false when ANY patch is not a tag path", () => {
    assert.equal(
      isTagOnlyPatch([
        { op: "replace", path: "/dayoneTags", value: [] },
        { op: "replace", path: "/narrative", value: "text" },
      ]),
      false
    );
  });

  it("returns false for empty array", () => {
    assert.equal(isTagOnlyPatch([]), false);
  });

  it("returns false for non-array", () => {
    assert.equal(isTagOnlyPatch(null), false);
    assert.equal(isTagOnlyPatch(undefined), false);
  });
});

// ─── D11 version-conflict guard (SHA-256 simulation) ────────────────────────

describe("D11 concurrency guard — baseVersion mismatch detection", () => {
  /**
   * Simulate what the route does:
   *   currentVersion = sha256(tripRaw).slice(0, 32)
   * Returns true when a 409 would be issued.
   */
  function wouldConflict(tripRaw, baseVersion) {
    if (baseVersion === "skip") return false;
    const current = createHash("sha256").update(tripRaw, "utf8").digest("hex").slice(0, 32);
    return current !== baseVersion;
  }

  const tripYaml = `slug: oman-2024\ntitle: Oman Trip\nnarrative: The desert unfolded.\n`;

  it("no conflict when baseVersion matches current hash", () => {
    const version = createHash("sha256").update(tripYaml, "utf8").digest("hex").slice(0, 32);
    assert.equal(wouldConflict(tripYaml, version), false);
  });

  it("conflict when baseVersion is stale (trip was modified after client loaded it)", () => {
    const staleVersion = "aaaabbbbccccdddd11112222"; // wrong hash
    assert.equal(wouldConflict(tripYaml, staleVersion), true);
  });

  it("no conflict when baseVersion is 'skip' (bypass for tag-only edits)", () => {
    assert.equal(wouldConflict(tripYaml, "skip"), false);
  });

  it("returns a 32-char hex version string from the route algorithm", () => {
    const version = createHash("sha256").update(tripYaml, "utf8").digest("hex").slice(0, 32);
    assert.equal(version.length, 32);
    assert.match(version, /^[0-9a-f]{32}$/);
  });

  it("version changes when trip content changes", () => {
    const v1 = createHash("sha256").update(tripYaml, "utf8").digest("hex").slice(0, 32);
    const modified = tripYaml + "highlights: [added]\n";
    const v2 = createHash("sha256").update(modified, "utf8").digest("hex").slice(0, 32);
    assert.notEqual(v1, v2);
  });
});
