#!/usr/bin/env node
// validate-parity.mjs — Phase 9 Stage B nightly parity check.
//
// For each operational table, compare file row counts and key-field values
// against DB rows. Exits 0 on full parity, 1 with divergence details.
//
// Intended to be run nightly during Stage B. Collect ≥7 consecutive
// zero-divergence runs before proceeding to Stage C cutover.
//
// Usage:
//   node server/scripts/validate-parity.mjs [--trip <slug>] [--verbose]

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/db/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const LOG_DIR = path.resolve(__dirname, "../logs");

const argTrip = process.argv.includes("--trip") ? process.argv[process.argv.indexOf("--trip") + 1] : null;
const verbose = process.argv.includes("--verbose");

async function activeTripSlug() {
  if (argTrip) return argTrip;
  try {
    const raw = await readFile(path.join(REPO_ROOT, "trips/manifest.json"), "utf8");
    return JSON.parse(raw)?.active?.slug || null;
  } catch {
    return null;
  }
}

async function readJsonArraySafe(p) {
  try {
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function readJsonlSafe(p) {
  try {
    const raw = await readFile(p, "utf8");
    return raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function fileDeadLetter(slug) {
  const dir = path.join(REPO_ROOT, "trips", slug, "dead-letter");
  const out = [];
  let queues;
  try { queues = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const q of queues) {
    if (!q.isDirectory()) continue;
    let entries;
    try { entries = await readdir(path.join(dir, q.name)); } catch { continue; }
    for (const n of entries.filter((n) => n.endsWith(".json"))) {
      try {
        const raw = await readFile(path.join(dir, q.name, n), "utf8");
        out.push({ queueName: q.name, row: JSON.parse(raw) });
      } catch {/* skip unreadable */}
    }
  }
  return out;
}

function diffRows(label, fileRows, dbRows, keyFn) {
  const fMap = new Map(fileRows.map((r) => [keyFn(r), r]));
  const dMap = new Map(dbRows.map((r) => [keyFn(r), r]));
  const divergences = [];
  for (const [k, fr] of fMap) {
    const dr = dMap.get(k);
    if (!dr) { divergences.push({ id: k, reason: "missing-in-db" }); continue; }
    const fStatus = fr.status ?? null;
    const dStatus = dr.status ?? null;
    if (fStatus !== dStatus) divergences.push({ id: k, reason: "status-mismatch", file: fStatus, db: dStatus });
  }
  for (const k of dMap.keys()) if (!fMap.has(k)) divergences.push({ id: k, reason: "orphan-in-db" });
  return { table: label, fileRowCount: fMap.size, dbRowCount: dMap.size, match: divergences.length === 0, divergences };
}

async function main() {
  const slug = await activeTripSlug();
  if (!slug) { console.error("FAIL: no active trip slug in trips/manifest.json"); process.exit(1); }

  const results = [];

  // pending_queue
  const fPending = await readJsonArraySafe(path.join(REPO_ROOT, "trips", slug, "pending.json"));
  const dPending = db.prepare("SELECT id, status FROM pending_queue WHERE tripSlug = ?").all(slug);
  results.push(diffRows("pending_queue", fPending, dPending, (r) => r.id));

  // voice_inbox
  const fVoice = await readJsonArraySafe(path.join(REPO_ROOT, "trips", slug, "voice-inbox.json"));
  const dVoice = db.prepare("SELECT id, status FROM voice_inbox WHERE tripSlug = ?").all(slug);
  results.push(diffRows("voice_inbox", fVoice, dVoice, (r) => r.id));

  // itinerary_inbox
  const fItin = await readJsonArraySafe(path.join(REPO_ROOT, "trips", slug, "itinerary-inbox.json"));
  const dItin = db.prepare("SELECT id, status FROM itinerary_inbox WHERE tripSlug = ?").all(slug);
  results.push(diffRows("itinerary_inbox", fItin, dItin, (r) => r.id));

  // dead_letter
  const fDL = await fileDeadLetter(slug);
  const fDLFlat = fDL.map((e) => ({ id: `${e.queueName}:${e.row.id}`, status: "stuck" }));
  const dDL = db.prepare("SELECT id, 'stuck' as status FROM dead_letter WHERE tripSlug = ?").all(slug);
  results.push(diffRows("dead_letter", fDLFlat, dDL, (r) => r.id));

  // edit_log
  const fEdit = await readJsonArraySafe(path.join(REPO_ROOT, "trips", slug, "edit-log.json"));
  const dEdit = db.prepare("SELECT id, status FROM edit_log WHERE tripSlug = ?").all(slug);
  results.push(diffRows("edit_log", fEdit, dEdit, (r) => r.id));

  // usage (global, not per-trip)
  const fUsage = await readJsonlSafe(path.join(REPO_ROOT, "server/logs/usage.jsonl"));
  const fUsageCount = fUsage.length;
  const dUsageCount = db.prepare("SELECT COUNT(*) as c FROM usage").get().c;
  // Usage rows don't have stable ids in the file, so compare counts only (within tolerance)
  results.push({
    table: "usage",
    fileRowCount: fUsageCount,
    dbRowCount: dUsageCount,
    match: Math.abs(fUsageCount - dUsageCount) <= 2,
    divergences: Math.abs(fUsageCount - dUsageCount) <= 2 ? [] : [{ reason: "count-drift", file: fUsageCount, db: dUsageCount }],
  });

  const allMatch = results.every((r) => r.match);

  const logDate = new Date().toISOString().slice(0, 10);
  await mkdir(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `parity-${logDate}.log`);
  const report = {
    generatedAt: new Date().toISOString(),
    tripSlug: slug,
    match: allMatch,
    tables: results,
  };
  await writeFile(logPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const summaryLine = results.map((r) => `${r.table}: ${r.dbRowCount}/${r.fileRowCount} ${r.match ? "match" : "DIVERGE"}`).join(", ");
  console.log(summaryLine);
  if (verbose) console.log(JSON.stringify(report, null, 2));

  if (!allMatch) {
    console.error(`FAIL: divergence — details in ${logPath}`);
    process.exit(1);
  }
  console.log(`parity OK (log: ${logPath})`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
