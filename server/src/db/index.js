// db/index.js — Phase 9 SQLite connection singleton.
//
// One connection per process. WAL mode + busy_timeout 5000ms enforced at
// open. Better-sqlite3 is synchronous; callers use db.prepare(sql) and
// .run / .get / .all directly.
//
// Memoir content (chapters/, reference/) stays on disk. This DB is
// operational data only.

import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DB_DIR = path.resolve(__dirname, "../../data");
export const DB_PATH = path.join(DB_DIR, "ops.db");

mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = OFF"); // Intentional — enforced at repo layer.

export default db;
