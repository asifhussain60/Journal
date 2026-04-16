-- Phase 9 — Operational data schema. See _workspace/ideas/app-cowork-execution-plan.md §12.
--
-- Memoir content (chapters/, reference/, @@markers in chapters/scratchpads/)
-- STAYS IN FILES FOREVER. This DB is operational data only: queues, logs,
-- edit history, budget telemetry.
--
-- Conventions:
--   - Every table has (id TEXT PRIMARY KEY, schema_version TEXT DEFAULT '1',
--     created_at TEXT). created_at is ISO-8601 UTC.
--   - JSONB columns store as TEXT (SQLite's JSON is text-backed). Consumers
--     call json() / JSON.parse at the boundary.
--   - No foreign keys. Referential integrity is enforced in the repository
--     layer (server/src/db/repositories/).
--   - WAL mode + busy_timeout=5000ms enforced at connection open
--     (see db/index.js).

CREATE TABLE IF NOT EXISTS usage (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  endpoint       TEXT NOT NULL,
  method         TEXT NOT NULL,
  model          TEXT,
  promptName     TEXT,
  tokensIn       INTEGER NOT NULL DEFAULT 0,
  tokensOut      INTEGER NOT NULL DEFAULT 0,
  durationMs     INTEGER NOT NULL DEFAULT 0,
  statusCode     INTEGER,
  visionUsed     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_created_at ON usage(created_at);
CREATE INDEX IF NOT EXISTS usage_endpoint ON usage(endpoint);

CREATE TABLE IF NOT EXISTS pending_queue (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  type           TEXT NOT NULL,            -- 'receipt' | 'voice' | 'itinerary' | 'note'
  data           TEXT NOT NULL,            -- JSON payload from pending.schema.json
  status         TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'drained' | 'stuck'
  memoryWorthy   INTEGER NOT NULL DEFAULT 0,
  updatedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_queue_trip_status ON pending_queue(tripSlug, status);
CREATE INDEX IF NOT EXISTS pending_queue_created_at ON pending_queue(created_at);

CREATE TABLE IF NOT EXISTS edit_log (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  intent         TEXT NOT NULL,
  userMessage    TEXT,
  proposedDiff   TEXT,                     -- JSON
  appliedPatch   TEXT,                     -- JSON (RFC 6902)
  status         TEXT NOT NULL,            -- 'applied' | 'reverted' | 'failed'
  snapshotId     TEXT,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS edit_log_trip ON edit_log(tripSlug, created_at);

CREATE TABLE IF NOT EXISTS voice_inbox (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  text           TEXT,                     -- convenience column; usually empty — transcript is authoritative
  status         TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'drained'
  transcript     TEXT,
  durationSec    REAL
);
CREATE INDEX IF NOT EXISTS voice_inbox_trip_status ON voice_inbox(tripSlug, status);

CREATE TABLE IF NOT EXISTS itinerary_inbox (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  rawText        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  parsedData     TEXT                      -- JSON parsed skeleton
);
CREATE INDEX IF NOT EXISTS itinerary_inbox_trip_status ON itinerary_inbox(tripSlug, status);

CREATE TABLE IF NOT EXISTS drain_log (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  operation      TEXT NOT NULL,            -- 'receipt_drain' | 'voice_drain' | 'edit_commit' | 'queue_replay' | ...
  queueName      TEXT,
  itemId         TEXT,
  status         TEXT NOT NULL,            -- 'success' | 'failed'
  resultSummary  TEXT,                     -- JSON
  divergence     TEXT
);
CREATE INDEX IF NOT EXISTS drain_log_created_at ON drain_log(created_at);

CREATE TABLE IF NOT EXISTS dead_letter (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  queueName      TEXT NOT NULL,
  originalId     TEXT NOT NULL,
  reason         TEXT,
  data           TEXT NOT NULL             -- JSON of the original row
);
CREATE INDEX IF NOT EXISTS dead_letter_trip ON dead_letter(tripSlug, queueName);

CREATE TABLE IF NOT EXISTS receipts_meta (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  imageId        TEXT NOT NULL,
  imagePath      TEXT NOT NULL,
  extractedData  TEXT,                     -- JSON
  status         TEXT NOT NULL DEFAULT 'captured', -- 'captured' | 'drained'
  visionUsed     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS receipts_meta_trip ON receipts_meta(tripSlug);

-- schema_migrations tracks which numbered migrations have been applied.
-- migrate-schema.mjs checks this table and runs anything missing.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,             -- filename without extension, e.g. '001-init'
  applied_at TEXT NOT NULL
);
