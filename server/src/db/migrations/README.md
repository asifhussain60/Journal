# Migrations

Numbered forward-only migrations for `server/data/ops.db`. Run with:

```bash
node server/scripts/migrate-schema.mjs
```

## Rules

1. **Filenames are `NNN-<kebab-name>.sql`**, three-digit padded. Applied in ascending numeric order.
2. **Idempotent.** Every `CREATE` uses `IF NOT EXISTS`; every `ALTER TABLE ADD COLUMN` wraps in a schema check. A migration must be safe to re-run even if partially applied.
3. **Never edit a migration after it has been recorded in `schema_migrations`.** Ship a follow-up migration instead. The DB is the history.
4. **No `DROP` without a follow-up data-migration.** If you're dropping a column/table, first land a migration that moves any remaining data, then a follow-up that drops.
5. **No foreign keys.** Referential integrity is enforced in the repository layer (`server/src/db/repositories/`).
6. **All timestamps ISO-8601 UTC as TEXT.** Don't use SQLite's `DATETIME` affinity — it silently loses precision.
7. **JSON payloads are TEXT.** Consumers call `JSON.parse` at the boundary; the runner does not assume JSONB availability.

## Applied order

- `001-init.sql` — initial schema (9 tables, indexes).

Once applied, a row is inserted into `schema_migrations(id, applied_at)`. Re-running the migrator skips applied migrations.
