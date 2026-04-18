// routes/log.js — Phase 11a
// GET  /api/log              — merged LogEntry list for the active trip
// POST /api/log/capture      — write a photo or note capture to the queue
//
// Query params for GET /api/log:
//   slug        override active trip slug
//   tab         inbox | journal | expenses | stuck  (server-side pre-filter)
//   source      photo | receipt | voice | note | itinerary
//   placement   placed | unsorted
//   show        itinerary-intake  (unhides itinerary rows; hidden by default per Decision 4)

import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { getActiveTripSlug, appendQueueRow, readQueue, atomicWriteJSON, TRIPS_DIR, sniffImageExt } from "../receipts.js";
import { listDeadLetter } from "../dead-letter.js";
import { shadow } from "../middleware/shadow-write.js";
import { fromPending } from "../adapters/fromPending.js";
import { fromVoiceInbox } from "../adapters/fromVoiceInbox.js";
import { fromItineraryInbox } from "../adapters/fromItineraryInbox.js";
import { fromDeadLetter } from "../adapters/fromDeadLetter.js";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype || "")) {
      return cb(new Error("only image/* uploads are accepted"));
    }
    cb(null, true);
  },
});

// --- Tab filter predicates (mirrors Decision 4) ------------------------------

function matchesTab(entry, tab) {
  switch (tab) {
    case "inbox":
      return (
        ["unreviewed", "in_review"].includes(entry.reviewStatus) ||
        ["unplaced", "proposed"].includes(entry.placementStatus)
      );
    case "journal":
      return (
        ["draft", "published"].includes(entry.journalStatus) ||
        entry.memoryWorthy === true
      );
    case "expenses":
      return ["candidate", "approved", "synced", "failed"].includes(entry.ynabStatus);
    case "stuck":
      return (
        entry.ingestStatus === "failed" ||
        entry._drainStatus === "stuck" ||
        entry.ynabStatus === "failed"
      );
    default:
      return true;
  }
}

// --- Router ------------------------------------------------------------------

export function createLogRouter({ queueValidators }) {
  const router = express.Router();

  // GET /api/log — merged, normalized LogEntry list
  router.get("/api/log", async (req, res) => {
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const { tab, source, placement, show } = req.query;
      const showItinerary = show === "itinerary-intake";

      // Read all queues in parallel
      const [pendingRows, voiceRows, itineraryRows, deadLetterEntries] = await Promise.all([
        readQueue(slug, "pending"),
        readQueue(slug, "voice-inbox"),
        readQueue(slug, "itinerary-inbox"),
        listDeadLetter(slug),
      ]);

      // Collect IDs already in dead-letter so we don't double-emit them from the main queue
      const deadLetterIds = new Set(deadLetterEntries.map((d) => d.id));

      // Normalize through adapters
      const entries = [
        ...pendingRows.filter((r) => !deadLetterIds.has(r.id)).map(fromPending),
        ...voiceRows.filter((r) => !deadLetterIds.has(r.id)).map(fromVoiceInbox),
        // itinerary rows hidden by default (Decision 4)
        ...(showItinerary
          ? itineraryRows.filter((r) => !deadLetterIds.has(r.id)).map(fromItineraryInbox)
          : []),
        ...deadLetterEntries.map(fromDeadLetter),
      ];

      // --- Source filter
      let visible = entries;
      if (source && source !== "all") {
        visible = visible.filter((e) => e.kind === source);
      }

      // --- Placement filter
      if (placement === "placed") {
        visible = visible.filter((e) => e.placementStatus === "confirmed");
      } else if (placement === "unsorted") {
        visible = visible.filter((e) => e.placementStatus === "unplaced");
      }

      // --- Tab filter
      if (tab) {
        visible = visible.filter((e) => matchesTab(e, tab));
      }

      // Sort newest-first by capturedAt
      visible.sort((a, b) => {
        const ta = a.capturedAt ? new Date(a.capturedAt).getTime() : 0;
        const tb = b.capturedAt ? new Date(b.capturedAt).getTime() : 0;
        return tb - ta;
      });

      res.json({ ok: true, tripSlug: slug, count: visible.length, entries: visible });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // POST /api/log/capture — write a photo or note to the pending queue
  // note:  application/json   { kind: "note", text: "..." }
  // photo: multipart/form-data  field "photo" = image file
  router.post("/api/log/capture", photoUpload.single("photo"), async (req, res) => {
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const now = new Date().toISOString();

      let row;

      if (req.file) {
        // --- Photo capture
        const buf = req.file.buffer;
        const ext = sniffImageExt(buf) ?? "jpg";
        const id = `ph_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        const filename = `${id}.${ext}`;
        const photosDir = path.join(TRIPS_DIR, slug, "photos");
        await mkdir(photosDir, { recursive: true });
        const imagePath = path.join(photosDir, filename);
        await writeFile(imagePath, buf);

        const relPath = `trips/${slug}/photos/${filename}`;

        row = {
          schemaVersion: "2",
          id,
          createdAt: now,
          capturedAt: now,
          tripSlug: slug,
          kind: "photo",
          source: "app",
          status: "pending",
          memoryWorthy: false,
          ingestStatus: "captured",
          placementStatus: "unplaced",
          reviewStatus: "unreviewed",
          journalStatus: "none",
          ynabStatus: "na",
          placement: { source: "unsorted" },
          route: { journal: "none", ynab: "na" },
          imagePath: relPath,
          payload: {
            imagePath: relPath,
            mime: req.file.mimetype || `image/${ext}`,
            bytes: buf.length,
          },
        };
      } else if (req.body?.kind === "note") {
        // --- Note capture
        const text = String(req.body.text ?? "").trim();
        if (!text) {
          return res.status(400).json({ ok: false, error: "text is required for kind note" });
        }
        const id = `nt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        row = {
          schemaVersion: "2",
          id,
          createdAt: now,
          capturedAt: now,
          tripSlug: slug,
          kind: "note",
          source: "app",
          status: "pending",
          memoryWorthy: false,
          ingestStatus: "captured",
          placementStatus: "unplaced",
          reviewStatus: "unreviewed",
          journalStatus: "none",
          ynabStatus: "na",
          placement: { source: "unsorted" },
          route: { journal: "none", ynab: "na" },
          payload: { text },
        };
      } else {
        return res.status(400).json({
          ok: false,
          error: "supply a photo file field (multipart) or JSON { kind: 'note', text }",
        });
      }

      const { count } = await appendQueueRow(slug, "pending", row);
      shadow("queue-pending", row);

      res.json({ ok: true, id: row.id, kind: row.kind, tripSlug: slug, count });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // DELETE /api/log/:id — remove an entry from every local queue it appears in.
  // Photos keep their binary on disk (recoverable); rows are dropped so the
  // entry stops surfacing in the inbox and isn't picked up by drain.
  router.delete("/api/log/:id", async (req, res) => {
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const id = req.params.id;
      if (!id) return res.status(400).json({ ok: false, error: "id required" });

      let removed = 0;
      for (const queueName of ["pending", "voice-inbox", "itinerary-inbox"]) {
        const items = await readQueue(slug, queueName);
        const kept = items.filter((r) => r?.id !== id);
        if (kept.length !== items.length) {
          const filePath = path.join(TRIPS_DIR, slug, `${queueName}.json`);
          await atomicWriteJSON(filePath, kept);
          removed += items.length - kept.length;
        }
      }

      if (!removed) return res.status(404).json({ ok: false, error: "entry not found" });
      res.json({ ok: true, id, removed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
