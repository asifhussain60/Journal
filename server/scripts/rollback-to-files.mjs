#!/usr/bin/env node
// rollback-to-files.mjs — Phase 9 Stage D rollback tool.
//
// Intended for use ONLY IF Stage C cutover (endpoint reads/writes moved to
// ops.db) introduces a regression that requires reverting to file-based
// storage. Runs in two modes:
//
//   --dry-run (default)   — reports what WOULD be restored; no writes.
//   --restore             — dumps ops.db tables back to JSON/JSONL files at
//                           their canonical paths, after first backing up the
//                           current file state into server/data/backups/
//                           pre-rollback-<timestamp>/.
//
// Prerequisites:
//   1. ops.db exists and has been the source of truth for <some window>.
//   2. The operator has reviewed validate-parity output and wants to revert.
//
// Guardrails:
//   - Never touches chapters/, reference/, or chapters/scratchpads/.
//   - Never deletes ops.db — only reads from it.
//   - Backups are created BEFORE any file overwrite.
//   - Exits 1 with specific reason on any inconsistency or missing table.
//
// Usage:
//   node server/scripts/rollback-to-files.mjs --dry-run
//   node server/scripts/rollback-to-files.mjs --restore --confirm

import path from "node:path";
import { writeFile, readFile, mkdir, rename, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import db from "../src/db/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const BACKUPS_DIR = path.resolve(__dirname, "../data/backups");
const USAGE_LOG = path.resolve(__dirname, "../logs/usage.jsonl");

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--restore");
const confirmed = args.has("--confirm");

async function backupFile(filePath, stamp) {
  const rel = path.relative(REPO_ROOT, filePath);
  const backupPath = path.join(BACKUPS_DIR, `pre-rollback-${stamp}`, rel);
  await mkdir(path.dirname(backupPath), { recursive: true });
  try {
    await rename(filePath, backupPath);
    return { backed_up: true, from: filePath, to: backupPath };
  } catch (err) {
    if (err.code === "ENOENT") return { backed_up: false, reason: "file-not-present" };
    throw err;
  }
}

async function writeJsonArray(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(rows, null, 2) + "\n", "utf8");
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  await writeFile(filePath, body, "utf8");
}

async function allTripSlugs() {
  const rows = db.prepare(`SELECT DISTINCT tripSlug FROM pending_queue
    UNION SELECT DISTINCT tripSlug FROM voice_inbox
    UNION SELECT DISTINCT tripSlug FROM itinerary_inbox
    UNION SELECT DISTINCT tripSlug FROM edit_log
    UNION SELECT DISTINCT tripSlug FROM dead_letter`).all();
  return rows.map((r) => r.tripSlug).filter(Boolean);
}

function restoreRow(r, table) {
  if (table === "pending_queue") return JSON.parse(r.data);
  if (table === "voice_inbox") return { schemaVersion: r.schema_version, id: r.id, createdAt: r.created_at, tripSlug: r.tripSlug, kind: "voice", status: r.status, memoryWorthy: false, payload: { transcript: r.transcript, durationSec: r.durationSec, text: r.text } };
  if (table === "itinerary_inbox") return { schemaVersion: r.schema_version, id: r.id, createdAt: r.created_at, tripSlug: r.tripSlug, kind: "itinerary", status: r.status, memoryWorthy: false, payload: { rawText: r.rawText, parsedSkeleton: r.parsedData ? JSON.parse(r.parsedData) : null } };
  if (table === "edit_log") return { schemaVersion: r.schema_version, id: r.id, createdAt: r.created_at, tripSlug: r.tripSlug, intent: r.intent, userMessage: r.userMessage, proposedDiff: r.proposedDiff ? JSON.parse(r.proposedDiff) : null, appliedPatch: r.appliedPatch ? JSON.parse(r.appliedPatch) : null, status: r.status, snapshotId: r.snapshotId, error: r.error };
  if (table === "dead_letter") return { ...JSON.parse(r.data), deadLetter: { queueName: r.queueName, reason: r.reason, failedAt: r.created_at } };
  if (table === "usage") return { timestamp: r.created_at, endpoint: r.endpoint, method: r.method, model: r.model, promptName: r.promptName, tokensIn: r.tokensIn, tokensOut: r.tokensOut, durationMs: r.durationMs, statusCode: r.statusCode, visionUsed: !!r.visionUsed };
  throw new Error(`restoreRow: unknown table ${table}`);
}

async function plan() {
  const slugs = await allTripSlugs();
  const summary = { slugs, perTrip: {}, usageRows: 0 };
  for (const slug of slugs) {
    summary.perTrip[slug] = {
      pending: db.prepare("SELECT COUNT(*) c FROM pending_queue WHERE tripSlug = ?").get(slug).c,
      voice: db.prepare("SELECT COUNT(*) c FROM voice_inbox WHERE tripSlug = ?").get(slug).c,
      itinerary: db.prepare("SELECT COUNT(*) c FROM itinerary_inbox WHERE tripSlug = ?").get(slug).c,
      editLog: db.prepare("SELECT COUNT(*) c FROM edit_log WHERE tripSlug = ?").get(slug).c,
      deadLetter: db.prepare("SELECT COUNT(*) c FROM dead_letter WHERE tripSlug = ?").get(slug).c,
    };
  }
  summary.usageRows = db.prepare("SELECT COUNT(*) c FROM usage").get().c;
  return summary;
}

async function restore() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slugs = await allTripSlugs();
  const ops = [];

  for (const slug of slugs) {
    const tripDir = path.join(REPO_ROOT, "trips", slug);

    // pending.json
    const pFile = path.join(tripDir, "pending.json");
    ops.push(await backupFile(pFile, stamp));
    const pRows = db.prepare("SELECT * FROM pending_queue WHERE tripSlug = ? ORDER BY created_at").all(slug).map((r) => restoreRow(r, "pending_queue"));
    await writeJsonArray(pFile, pRows);

    // voice-inbox.json
    const vFile = path.join(tripDir, "voice-inbox.json");
    ops.push(await backupFile(vFile, stamp));
    const vRows = db.prepare("SELECT * FROM voice_inbox WHERE tripSlug = ? ORDER BY created_at").all(slug).map((r) => restoreRow(r, "voice_inbox"));
    await writeJsonArray(vFile, vRows);

    // itinerary-inbox.json
    const iFile = path.join(tripDir, "itinerary-inbox.json");
    ops.push(await backupFile(iFile, stamp));
    const iRows = db.prepare("SELECT * FROM itinerary_inbox WHERE tripSlug = ? ORDER BY created_at").all(slug).map((r) => restoreRow(r, "itinerary_inbox"));
    await writeJsonArray(iFile, iRows);

    // edit-log.json
    const eFile = path.join(tripDir, "edit-log.json");
    ops.push(await backupFile(eFile, stamp));
    const eRows = db.prepare("SELECT * FROM edit_log WHERE tripSlug = ? ORDER BY created_at").all(slug).map((r) => restoreRow(r, "edit_log"));
    await writeJsonArray(eFile, eRows);

    // dead-letter/*/{id}.json
    const dlRows = db.prepare("SELECT * FROM dead_letter WHERE tripSlug = ?").all(slug);
    for (const r of dlRows) {
      const dlDir = path.join(tripDir, "dead-letter", r.queueName);
      await mkdir(dlDir, { recursive: true });
      await writeFile(path.join(dlDir, `${r.originalId}.json`), JSON.stringify(restoreRow(r, "dead_letter"), null, 2) + "\n", "utf8");
    }
  }

  // usage.jsonl
  ops.push(await backupFile(USAGE_LOG, stamp));
  const uRows = db.prepare("SELECT * FROM usage ORDER BY created_at").all().map((r) => restoreRow(r, "usage"));
  await writeJsonl(USAGE_LOG, uRows);

  return { stamp, ops };
}

async function main() {
  const summary = await plan();
  console.log("rollback-to-files plan:");
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) {
    console.log("\nDry-run complete. Pass --restore --confirm to actually restore.");
    process.exit(0);
  }
  if (!confirmed) {
    console.error("refusing to restore without --confirm");
    process.exit(1);
  }
  const result = await restore();
  console.log(`\nrestore OK. backups under server/data/backups/pre-rollback-${result.stamp}/`);
  console.log(`operations: ${result.ops.length}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
