// dead-letter.js — Phase 8 dead-letter helpers.
//
// Dead-letter entries live at:
//   trips/{slug}/dead-letter/{queueName}/{id}.json
//
// One file per entry. Each file is the original queue row plus a
// `deadLetter` sidecar:
//   { ...row, deadLetter: { queueName, reason, failedAt, attempts } }
//
// Cowork drains write here when a row fails validation or downstream
// application. The App surfaces them in Trip > Queue > Stuck and lets
// the user re-submit or discard.

import { readFile, writeFile, readdir, mkdir, unlink, rename } from "node:fs/promises";
import path from "node:path";
import { TRIPS_DIR, appendQueueRow } from "./receipts.js";

export function deadLetterDir(slug, queueName) {
  return path.join(TRIPS_DIR, slug, "dead-letter", queueName);
}

export async function listDeadLetter(slug) {
  const rootDir = path.join(TRIPS_DIR, slug, "dead-letter");
  const results = [];
  let queues;
  try {
    queues = await readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return results;
    throw err;
  }
  for (const q of queues) {
    if (!q.isDirectory()) continue;
    const queueName = q.name;
    let files;
    try {
      files = await readdir(path.join(rootDir, queueName));
    } catch {
      continue;
    }
    for (const fname of files) {
      if (!fname.endsWith(".json")) continue;
      const id = fname.replace(/\.json$/, "");
      const full = path.join(rootDir, queueName, fname);
      try {
        const raw = await readFile(full, "utf8");
        const row = JSON.parse(raw);
        results.push({ queueName, id, row });
      } catch {
        results.push({ queueName, id, row: null, error: "unreadable" });
      }
    }
  }
  return results;
}

export async function readDeadLetterEntry(slug, queueName, id) {
  const full = path.join(deadLetterDir(slug, queueName), `${id}.json`);
  const raw = await readFile(full, "utf8");
  return JSON.parse(raw);
}

export async function writeDeadLetterEntry(slug, queueName, row) {
  const id = row.id || `dl-${Date.now()}`;
  const dir = deadLetterDir(slug, queueName);
  await mkdir(dir, { recursive: true });
  const full = path.join(dir, `${id}.json`);
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(row, null, 2) + "\n", "utf8");
  await rename(tmp, full);
  return { filePath: full, id };
}

export async function deleteDeadLetterEntry(slug, queueName, id) {
  const full = path.join(deadLetterDir(slug, queueName), `${id}.json`);
  try {
    await unlink(full);
    return { ok: true };
  } catch (err) {
    if (err.code === "ENOENT") return { ok: true, alreadyGone: true };
    throw err;
  }
}

/**
 * Replay a dead-letter entry: read it, strip deadLetter sidecar, re-append
 * to the original queue, then delete the dead-letter file on success.
 * Idempotent on `id`: re-running returns { ok: true, alreadyGone: true }
 * when the dead-letter file is no longer present.
 */
export async function replayDeadLetterEntry(slug, queueName, id) {
  let row;
  try {
    row = await readDeadLetterEntry(slug, queueName, id);
  } catch (err) {
    if (err.code === "ENOENT") return { ok: true, alreadyGone: true, queueName, id };
    throw err;
  }
  const clean = { ...row };
  delete clean.deadLetter;
  if (!clean.status) clean.status = "pending";
  const { count } = await appendQueueRow(slug, queueName, clean);
  await deleteDeadLetterEntry(slug, queueName, id);
  return { ok: true, queueName, id, newRowId: clean.id || id, queueCount: count };
}
