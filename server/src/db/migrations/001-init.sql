-- 001-init.sql — initial schema. Idempotent (IF NOT EXISTS on every object).
-- Mirror of schema.sql; kept in sync manually. The runner
-- (scripts/migrate-schema.mjs) runs numbered migrations in order and records
-- them in schema_migrations.

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
  type           TEXT NOT NULL,
  data           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
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
  proposedDiff   TEXT,
  appliedPatch   TEXT,
  status         TEXT NOT NULL,
  snapshotId     TEXT,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS edit_log_trip ON edit_log(tripSlug, created_at);

CREATE TABLE IF NOT EXISTS voice_inbox (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  text           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
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
  parsedData     TEXT
);
CREATE INDEX IF NOT EXISTS itinerary_inbox_trip_status ON itinerary_inbox(tripSlug, status);

CREATE TABLE IF NOT EXISTS drain_log (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  operation      TEXT NOT NULL,
  queueName      TEXT,
  itemId         TEXT,
  status         TEXT NOT NULL,
  resultSummary  TEXT,
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
  data           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dead_letter_trip ON dead_letter(tripSlug, queueName);

CREATE TABLE IF NOT EXISTS receipts_meta (
  id             TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1',
  created_at     TEXT NOT NULL,
  tripSlug       TEXT NOT NULL,
  imageId        TEXT NOT NULL,
  imagePath      TEXT NOT NULL,
  extractedData  TEXT,
  status         TEXT NOT NULL DEFAULT 'captured',
  visionUsed     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS receipts_meta_trip ON receipts_meta(tripSlug);
