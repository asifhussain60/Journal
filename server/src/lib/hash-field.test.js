// hash-field.test.js — Pre-E0 test harness bootstrap
// Tests server/src/lib/hash-field.js (D4 content-hash for AI-clean detection).
// Uses Node built-in test runner (node --test). Zero new dependencies.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashField } from "./hash-field.js";

describe("hashField", () => {
  // ── Output shape ──────────────────────────────────────────────────
  it("returns exactly 16 hex characters", () => {
    const h = hashField("hello");
    assert.equal(typeof h, "string");
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  // ── Determinism (D4 invariant: same input → same hash always) ────
  it("is deterministic — same input always produces the same hash", () => {
    const a = hashField("Oman was magnificent.");
    const b = hashField("Oman was magnificent.");
    assert.equal(a, b);
  });

  it("different inputs produce different hashes", () => {
    const a = hashField("Oman was magnificent.");
    const b = hashField("Oman was magnificent!");  // one char differs
    assert.notEqual(a, b);
  });

  it("is case-sensitive", () => {
    assert.notEqual(hashField("oman"), hashField("Oman"));
  });

  it("is whitespace-sensitive", () => {
    assert.notEqual(hashField("hello world"), hashField("hello  world"));
  });

  // ── Edge / boundary cases ─────────────────────────────────────────
  it("returns empty string for non-string input", () => {
    assert.equal(hashField(null), "");
    assert.equal(hashField(undefined), "");
    assert.equal(hashField(42), "");
    assert.equal(hashField({}), "");
  });

  it("handles empty string input — returns 16 hex chars (SHA-256 of empty)", () => {
    const h = hashField("");
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
    // SHA-256("") = e3b0c44298fc1c14... — first 16 chars are deterministic
    assert.equal(h, "e3b0c44298fc1c14");
  });

  it("handles multi-line strings", () => {
    const h = hashField("line one\nline two\nline three");
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  it("handles unicode content", () => {
    const h = hashField("مسافر — traveller");
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  // ── D4 contract: hash stored in trip.yaml matches hash of current value ──
  it("round-trips: hashField(value) can be found in a Set of prior hashes", () => {
    const value = "The mountains caught the last light like copper coins.";
    const storedHashes = new Set([hashField(value)]);
    // AI-clean check: is current value's hash in the set of AI-written hashes?
    assert.ok(storedHashes.has(hashField(value)), "value should be AI-clean");
  });

  it("edited value is NOT in the AI hash set (D4 edited-detection)", () => {
    const aiValue = "The mountains caught the last light like copper coins.";
    const editedValue = "The mountains caught the last light like copper coins!"; // one char changed
    const storedHashes = new Set([hashField(aiValue)]);
    assert.ok(!storedHashes.has(hashField(editedValue)), "edited value should NOT be AI-clean");
  });
});
