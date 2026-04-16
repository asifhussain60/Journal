#!/usr/bin/env node
// migrate-schema.mjs — Phase 9 Stage A migration runner.
//
// Reads server/src/db/migrations/*.sql in ascending filename order and
// applies anything not yet recorded in schema_migrations. Creates ops.db
// if missing, enables WAL + busy_timeout 5000ms.
//
// Exit 0 on success. Exit 1 on any failure; error surfaces the offending
// migration filename.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import db from "../src/db/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIG_DIR = path.resolve(__dirname, "../src/db/migrations");

const EXPECTED_TABLES = [
  "usage",
  "pending_queue",
  "edit_log",
  "voice_inbox",
  "itinerary_inbox",
  "drain_log",
  "dead_letter",
  "receipts_meta",
];

async function main() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id));

  const files = (await readdir(MIG_DIR))
    .filter((n) => n.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const fname of files) {
    const id = fname.replace(/\.sql$/, "");
    if (applied.has(id)) continue;
    const sql = await readFile(path.join(MIG_DIR, fname), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(id, new Date().toISOString());
    });
    try {
      tx();
      ran += 1;
      console.log(`applied ${fname}`);
    } catch (err) {
      console.error(`FAILED ${fname}: ${err.message}`);
      process.exit(1);
    }
  }

  // Smoke: verify every expected table exists.
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  const missing = EXPECTED_TABLES.filter((t) => !tables.has(t));
  if (missing.length) {
    console.error(`FAIL: missing tables after migration: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`migrate-schema OK (${ran} applied, ${EXPECTED_TABLES.length} tables verified)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
