// tag-normalize.test.js — Pre-E0 test harness bootstrap
// Tests shared/tag-normalize.js via the re-export in server context.
// Uses Node built-in test runner (node --test). Zero new dependencies.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Import from shared/ (one level above server/src)
const { normalizeTag } = await import(
  path.resolve(__dirname, "../../../shared/tag-normalize.js")
);

describe("normalizeTag", () => {
  // ── Happy paths ───────────────────────────────────────────────────
  it("lowercases", () => {
    assert.equal(normalizeTag("Oman"), "oman");
  });

  it("replaces whitespace runs with a single hyphen", () => {
    assert.equal(normalizeTag("road trip"), "road-trip");
    assert.equal(normalizeTag("road  trip"), "road-trip");
    assert.equal(normalizeTag("  leading and trailing  "), "leading-and-trailing");
  });

  it("strips non-[a-z0-9-] characters", () => {
    assert.equal(normalizeTag("café"), "caf");        // accent stripped after NFC
    assert.equal(normalizeTag("food/drink"), "fooddrink");
    assert.equal(normalizeTag("eats & drinks"), "eats-drinks");
  });

  it("collapses consecutive hyphens", () => {
    assert.equal(normalizeTag("oman--trip"), "oman-trip");
    assert.equal(normalizeTag("a---b"), "a-b");
  });

  it("trims leading and trailing hyphens", () => {
    assert.equal(normalizeTag("-oman-"), "oman");
    assert.equal(normalizeTag("--trip--"), "trip");
  });

  it("NFC-normalizes before processing", () => {
    // U+006E + U+0303 (ñ decomposed) should normalize to ñ then strip accent
    const decomposed = "man\u0303ana";
    const result = normalizeTag(decomposed);
    // After NFC → "mañana", strip accented chars → "maana" or "mana" depending
    // on NFC form. Key invariant: result is a non-empty slug, no raw combining marks.
    assert.match(result, /^[a-z0-9-]+$/);
  });

  it("is idempotent", () => {
    const once = normalizeTag("Road  Trip!");
    assert.equal(normalizeTag(once), once);
  });

  // ── Edge / boundary cases ─────────────────────────────────────────
  it("returns empty string for non-string input", () => {
    assert.equal(normalizeTag(null), "");
    assert.equal(normalizeTag(undefined), "");
    assert.equal(normalizeTag(42), "");
    assert.equal(normalizeTag({}), "");
  });

  it("returns empty string for empty input", () => {
    assert.equal(normalizeTag(""), "");
    assert.equal(normalizeTag("   "), "");
    assert.equal(normalizeTag("!!!"), "");
  });

  it("preserves digits", () => {
    assert.equal(normalizeTag("2026"), "2026");
    assert.equal(normalizeTag("phase-2"), "phase-2");
  });

  it("passes through emoji (they survive NFC but get stripped by [^a-z0-9-])", () => {
    // Emoji are not in [a-z0-9-] — they are stripped. Invariant: result is a pure slug.
    const result = normalizeTag("🏖️ beach");
    assert.match(result, /^[a-z0-9-]*$/);
    assert.equal(result, "beach");
  });

  it("handles already-normalized slugs without mutation", () => {
    const slug = "ishrat-engagement-2026";
    assert.equal(normalizeTag(slug), slug);
  });
});
