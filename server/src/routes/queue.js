// routes/queue.js — per-trip queue (pending, voice-inbox, itinerary-inbox) +
// dead-letter management.
//   POST /api/queue/:name          — schema-validated append
//   GET  /api/queue/:name          — read queue items
//   POST /api/queue/:name/replay   — replay one dead-letter entry
//   GET  /api/dead-letter          — list all dead-letter entries
//   POST /api/dead-letter/discard  — drop a dead-letter entry

import express from "express";
import { getActiveTripSlug, appendQueueRow, readQueue } from "../receipts.js";
import { shadow } from "../middleware/shadow-write.js";
import { listDeadLetter, replayDeadLetterEntry, deleteDeadLetterEntry } from "../dead-letter.js";

const QUEUE_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function createQueueRouter({ queueValidators }) {
  const router = express.Router();

  router.post("/api/queue/:name", async (req, res) => {
    const { name } = req.params;
    if (!QUEUE_NAME_RE.test(name) || !queueValidators.has(name)) {
      return res.status(404).json({ ok: false, error: `unknown queue "${name}"` });
    }
    const row = req.body;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return res.status(400).json({ ok: false, error: "request body must be a queue row object" });
    }
    if (row.schemaVersion !== "1" && row.schemaVersion !== "2") {
      return res.status(400).json({ ok: false, error: 'schemaVersion must be "1" or "2"' });
    }
    const validate = queueValidators.get(name);
    if (!validate(row)) {
      return res.status(400).json({ ok: false, error: "schema validation failed", details: validate.errors });
    }
    try {
      const slug = row.tripSlug || (await getActiveTripSlug());
      const { count } = await appendQueueRow(slug, name, row);
      shadow(`queue-${name}`, { ...row, tripSlug: slug });
      res.json({ ok: true, id: row.id, count, tripSlug: slug });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get("/api/queue/:name", async (req, res) => {
    const { name } = req.params;
    if (!QUEUE_NAME_RE.test(name) || !queueValidators.has(name)) {
      return res.status(404).json({ ok: false, error: `unknown queue "${name}"` });
    }
    try {
      const slug = await getActiveTripSlug();
      const items = await readQueue(slug, name);
      res.json({ ok: true, items, tripSlug: slug });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get("/api/dead-letter", async (_req, res) => {
    try {
      const slug = await getActiveTripSlug();
      const items = await listDeadLetter(slug);
      res.json({ ok: true, tripSlug: slug, items });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post("/api/queue/:name/replay", async (req, res) => {
    try {
      const { name } = req.params;
      const { id } = req.body ?? {};
      if (!queueValidators.has(name)) {
        return res.status(404).json({ ok: false, error: `unknown queue "${name}"` });
      }
      if (typeof id !== "string" || !id.length) {
        return res.status(400).json({ ok: false, error: "id (string) is required" });
      }
      const slug = await getActiveTripSlug();
      const result = await replayDeadLetterEntry(slug, name, id);
      res.json({ ok: true, tripSlug: slug, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post("/api/dead-letter/discard", async (req, res) => {
    try {
      const { queueName, id } = req.body ?? {};
      if (typeof queueName !== "string" || !queueName.length) {
        return res.status(400).json({ ok: false, error: "queueName (string) is required" });
      }
      if (typeof id !== "string" || !id.length) {
        return res.status(400).json({ ok: false, error: "id (string) is required" });
      }
      const slug = await getActiveTripSlug();
      const result = await deleteDeadLetterEntry(slug, queueName, id);
      res.json({ ok: true, tripSlug: slug, queueName, id, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
