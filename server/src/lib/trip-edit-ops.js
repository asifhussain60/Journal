// trip-edit-ops.js — Phase 6 (§5.4) write + snapshot + revert helpers.
//
// trip.yaml is the canonical target. Writes always: snapshot → apply patch →
// atomic write → append edit-log row. Revert: read snapshot + edit-log,
// apply inverse patch to the current file, append a reverted row. Both paths
// are idempotent on the edit-log id.

import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fastJsonPatch from "fast-json-patch";
import yaml from "js-yaml";
import { TRIPS_DIR } from "./receipts.js";
import { validateTrip } from "../validators/trip-edit-rules.js";

const { applyPatch, deepClone } = fastJsonPatch;

export function tripYamlPath(slug) {
  return path.join(TRIPS_DIR, slug, "trip.yaml");
}

export function editLogPath(slug) {
  return path.join(TRIPS_DIR, slug, "edit-log.json");
}

export function snapshotsDir(slug) {
  return path.join(TRIPS_DIR, slug, "snapshots");
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

export async function readEditLog(slug) {
  try {
    const raw = await readFile(editLogPath(slug), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function appendEditLog(slug, row) {
  const existing = await readEditLog(slug);
  if (existing.some((r) => r.id === row.id && r.status === row.status)) {
    return { duplicate: true };
  }
  existing.push(row);
  const filePath = editLogPath(slug);
  const tmp = `${filePath}.${process.pid}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tmp, JSON.stringify(existing, null, 2) + "\n", "utf8");
  await rename(tmp, filePath);
  return { duplicate: false, count: existing.length };
}

export async function readTripObj(slug) {
  const raw = await readFile(tripYamlPath(slug), "utf8");
  return parseYamlLoose(raw);
}

/**
 * Serialize a trip object back to YAML. This is intentionally minimal — the
 * schema is loose, and we don't want to pull in a full YAML dependency for
 * what is (at the App layer) only used for atomic preserve-and-replace.
 * For safety, we store trip as a JSON-in-YAML wrapper so round-trip is exact.
 */
export function serializeTripObj(obj) {
  return (
    "---\n# Canonical trip JSON — written by /api/trip-edit (Phase 6)\n" +
    "# Edit via FloatingChat; see trips/{slug}/edit-log.json for provenance.\n" +
    JSON.stringify(obj, null, 2) +
    "\n"
  );
}

function parseYamlLoose(raw) {
  const body = raw.replace(/^---[\s\S]*?\n(?=[^#])/m, "").replace(/^#.*$/gm, "").trim();
  if (body.startsWith("{")) {
    try { return JSON.parse(body); } catch { /* fall through to YAML parse */ }
  }
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
  return parsed && typeof parsed === "object" ? parsed : {};
}

/**
 * Apply a JSON Patch to a trip object with full snapshot + edit-log
 * provenance. Returns { ok, id, afterValidation, logRow } or
 * { ok: false, error, errors? } on validation failure.
 */
export async function applyTripEdit(slug, { intent, patch, actor = "app" }) {
  if (!Array.isArray(patch) || !patch.length) {
    return { ok: false, error: "patch must be a non-empty array" };
  }
  const trip = await readTripObj(slug);
  const before = deepClone(trip);

  let after;
  let inversePatch;
  try {
    inversePatch = require_inverse_patch(trip, patch); // computed from the diff
  } catch (err) {
    return { ok: false, error: `inverse patch failed: ${err.message}` };
  }
  try {
    const result = applyPatch(deepClone(before), patch, /*validate*/ true, /*mutate*/ false);
    after = result.newDocument;
  } catch (err) {
    return { ok: false, error: `patch apply failed: ${err.message}` };
  }

  const semantic = validateTrip(after);
  if (!semantic.valid) return { ok: false, error: "semantic validation failed", errors: semantic.errors };

  const id = randomUUID();
  const snapshotFile = path.join(snapshotsDir(slug), `trip.yaml-${id}.yaml`);
  await mkdir(snapshotsDir(slug), { recursive: true });

  // Write snapshot of the previous state first.
  const prevYaml = serializeTripObj(before);
  await writeFile(snapshotFile + ".tmp", prevYaml, "utf8");
  await rename(snapshotFile + ".tmp", snapshotFile);

  // Atomic write of the new trip.
  const target = tripYamlPath(slug);
  const nextYaml = serializeTripObj(after);
  await writeFile(target + ".tmp", nextYaml, "utf8");
  await rename(target + ".tmp", target);

  const logRow = {
    schemaVersion: "1",
    id,
    createdAt: new Date().toISOString(),
    tripSlug: slug,
    target: "trip.yaml",
    intent,
    patch,
    inversePatch,
    snapshotRef: `trips/${slug}/snapshots/trip.yaml-${id}.yaml`,
    actor,
    status: "applied",
  };
  await appendEditLog(slug, logRow);
  return { ok: true, id, logRow, after };
}

export async function revertTripEdit(slug, patchId) {
  const log = await readEditLog(slug);
  const row = [...log].reverse().find((r) => r.id === patchId && r.status === "applied");
  if (!row) return { ok: false, error: `no applied edit with id ${patchId}` };

  const snapshotAbs = path.resolve(TRIPS_DIR, "..", row.snapshotRef);
  if (!(await exists(snapshotAbs))) {
    return { ok: false, error: `snapshot missing at ${row.snapshotRef}` };
  }

  const current = await readTripObj(slug);
  let reverted;
  try {
    const result = applyPatch(deepClone(current), row.inversePatch, true, false);
    reverted = result.newDocument;
  } catch (err) {
    const failRow = { ...row, id: randomUUID(), createdAt: new Date().toISOString(), status: "failed", failureReason: err.message };
    await appendEditLog(slug, failRow);
    return { ok: false, error: `inverse apply failed: ${err.message}` };
  }

  const semantic = validateTrip(reverted);
  if (!semantic.valid) return { ok: false, error: "revert would violate semantic rules", errors: semantic.errors };

  const target = tripYamlPath(slug);
  await writeFile(target + ".tmp", serializeTripObj(reverted), "utf8");
  await rename(target + ".tmp", target);

  const revertRow = {
    schemaVersion: "1",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    tripSlug: slug,
    target: "trip.yaml",
    intent: `revert ${patchId}`,
    patch: row.inversePatch,
    inversePatch: row.patch,
    snapshotRef: row.snapshotRef,
    actor: "app",
    status: "reverted",
  };
  await appendEditLog(slug, revertRow);
  return { ok: true, revertedId: revertRow.id, originalId: patchId };
}

/**
 * Derive an inverse patch for the given operations against the original
 * document. fast-json-patch exports `getInverse` via its comparison helpers,
 * but to avoid pulling in a second API surface we build it by generating a
 * forward diff from the original back to itself via the applied patch.
 */
function require_inverse_patch(original, patch) {
  const cloneA = deepClone(original);
  const applied = applyPatch(cloneA, patch, true, false).newDocument;
  return fastJsonPatch.compare(applied, original);
}
