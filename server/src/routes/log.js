// routes/log.js — Phase 11a
// GET    /api/log                — merged LogEntry list for the active trip
// POST   /api/log/capture        — write a photo or note capture to the queue
// PATCH  /api/log/:id            — mutate notes / reviewStatus / draft.prose on a pending row
// POST   /api/log/:id/refine     — AI-refine a per-image note with trip + journal + voice context
// DELETE /api/log/:id            — drop a row from every local queue it appears in
//
// Query params for GET /api/log:
//   slug        override active trip slug
//   tab         inbox | journal | expenses | stuck  (server-side pre-filter)
//   source      photo | receipt | voice | note | itinerary
//   placement   placed | unsorted
//   show        itinerary-intake  (unhides itinerary rows; hidden by default per Decision 4)

import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { getActiveTripSlug, appendQueueRow, readQueue, atomicWriteJSON, TRIPS_DIR, REPO_ROOT, sniffImageExt, extToMediaType } from "../lib/receipts.js";
import { listDeadLetter } from "../lib/dead-letter.js";
import { shadow } from "../middleware/shadow-write.js";
import { fromPending } from "../adapters/fromPending.js";
import { fromVoiceInbox } from "../adapters/fromVoiceInbox.js";
import { fromItineraryInbox } from "../adapters/fromItineraryInbox.js";
import { fromDeadLetter } from "../adapters/fromDeadLetter.js";
import { applyInitialStates, assertInitial, assertTransition, TransitionError } from "../lib/workflow-state.js";
import { readTripObj } from "../lib/trip-edit-ops.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FINGERPRINT_PATH = path.resolve(__dirname, "../../../reference/voice-fingerprint.md");

// Vision payload budget for refine: stay well under Anthropic's ~5MB base64 cap.
// Above this we skip vision rather than fail the call — refine still works from
// text alone, it just loses the location/mood read from the image.
const REFINE_VISION_MAX_BYTES = 4 * 1024 * 1024;

// Resolve `row.payload.imagePath` (stored as a repo-relative POSIX path like
// "trips/slug/photos/ph_abc.jpg") to an absolute path on disk. Returns null if
// the payload doesn't carry a photo reference or the path escapes REPO_ROOT.
function resolveEntryImagePath(row) {
  const rel = row?.payload?.imagePath || row?.imagePath;
  if (!rel || typeof rel !== "string") return null;
  const abs = path.resolve(REPO_ROOT, rel);
  // Guard: never leave the repo root (defense-in-depth; rel is server-written,
  // but a compromised pending.json shouldn't give us arbitrary file-read).
  if (!abs.startsWith(REPO_ROOT + path.sep)) return null;
  return abs;
}

// Load + sniff an entry's photo into a vision-ready block. Never throws:
// returns { block, mediaType, bytes } on success or { skipped: reason } otherwise.
// Caller decides whether to include the block in the user message.
async function loadEntryImageBlock(row) {
  const abs = resolveEntryImagePath(row);
  if (!abs) return { skipped: "no-image-path" };
  let buf;
  try {
    buf = await readFile(abs);
  } catch (err) {
    return { skipped: `read-failed:${err.code || err.message}` };
  }
  if (buf.length > REFINE_VISION_MAX_BYTES) {
    return { skipped: `too-large:${buf.length}` };
  }
  const ext = sniffImageExt(buf);
  if (!ext) return { skipped: "unknown-format" };
  const mediaType = extToMediaType(ext);
  return {
    block: {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
    },
    mediaType,
    bytes: buf.length,
  };
}

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

export function createLogRouter({ queueValidators, anthropic, DEFAULT_MODEL }) {
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
          placement: { source: "unsorted" },
          route: { journal: "none", ynab: "na" },
          imagePath: relPath,
          payload: {
            imagePath: relPath,
            mime: req.file.mimetype || `image/${ext}`,
            bytes: buf.length,
          },
        };
        applyInitialStates(row);
        assertInitial(row);
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
          placement: { source: "unsorted" },
          route: { journal: "none", ynab: "na" },
          payload: { text },
        };
        applyInitialStates(row);
        assertInitial(row);
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

  // PATCH /api/log/:id — mutate allowed fields on a pending-queue row.
  // Body: { notes?, reviewStatus?, draftProse? }
  //   notes         — replaces the top-level string verbatim (empty string clears)
  //   reviewStatus  — validated through workflow-state.assertTransition
  //   draftProse    — stored under draft.prose (used to persist refined text)
  // Only operates on rows in pending.json (photo/note/receipt lane). Returns the
  // normalized LogEntry after write so the client can reconcile local state.
  router.patch("/api/log/:id", express.json(), async (req, res) => {
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const id = req.params.id;
      if (!id) return res.status(400).json({ ok: false, error: "id required" });

      const { notes, reviewStatus, draftProse } = req.body ?? {};
      const items = await readQueue(slug, "pending");
      const idx = items.findIndex((r) => r?.id === id);
      if (idx === -1) return res.status(404).json({ ok: false, error: "entry not found in pending" });

      const row = items[idx];

      if (reviewStatus != null) {
        const from = row.reviewStatus ?? "unreviewed";
        try {
          assertTransition("reviewStatus", from, reviewStatus);
        } catch (err) {
          if (err instanceof TransitionError) {
            return res.status(409).json({ ok: false, error: err.message, from, to: reviewStatus, legal: err.legal });
          }
          throw err;
        }
        row.reviewStatus = reviewStatus;
        if (reviewStatus === "approved") {
          row.reviewedAt = new Date().toISOString();
        }
      }

      if (typeof notes === "string") {
        row.notes = notes;
      }

      if (typeof draftProse === "string" && draftProse.length) {
        row.draft = { ...(row.draft || {}), prose: draftProse };
      }

      row.updatedAt = new Date().toISOString();
      items[idx] = row;
      const filePath = path.join(TRIPS_DIR, slug, "pending.json");
      await atomicWriteJSON(filePath, items);

      res.json({ ok: true, entry: fromPending(row) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // POST /api/log/:id/refine — refine a per-image note with trip + journal + voice context.
  // Body: { note: string, persist?: boolean }
  //   note     — raw user-authored note/prompt (required, non-empty)
  //   persist  — when true, server writes refined text to row.draft.prose
  // Returns: { ok, refined, model, usage }. Non-destructive by default: the caller
  // decides whether to replace the raw note, so a failed save doesn't nuke user input.
  router.post("/api/log/:id/refine", express.json(), async (req, res) => {
    if (!anthropic) {
      return res.status(503).json({ ok: false, error: "anthropic client not configured" });
    }
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const id = req.params.id;
      const { note, persist } = req.body ?? {};
      if (typeof note !== "string" || note.trim().length === 0) {
        return res.status(400).json({ ok: false, error: "note (non-empty string) is required" });
      }
      if (note.length > 20_000) {
        return res.status(413).json({ ok: false, error: "note exceeds 20000 chars" });
      }

      const items = await readQueue(slug, "pending");
      const idx = items.findIndex((r) => r?.id === id);
      if (idx === -1) return res.status(404).json({ ok: false, error: "entry not found in pending" });
      const row = items[idx];

      // Compose context — voice fingerprint is required; trip is best-effort.
      let fingerprint;
      try {
        fingerprint = await readFile(FINGERPRINT_PATH, "utf8");
      } catch (err) {
        return res.status(500).json({ ok: false, error: `voice-fingerprint unreadable: ${err.message}` });
      }

      let tripCtx = null;
      try {
        tripCtx = await readTripObj(slug);
      } catch { /* no active trip yaml — refine still works */ }

      const di = row.placement?.dayIndex;
      const tripBlock = tripCtx
        ? `Active trip: ${tripCtx.slug || slug}${tripCtx.title ? ` — ${tripCtx.title}` : ""}`
        : `Active trip slug: ${slug}`;
      const dayBlock = di != null
        ? `Photo is placed on Day ${di + 1}${row.placement?.eventId ? ` · ${row.placement.eventId.replace(/_/g, " ")}` : ""}.`
        : `Photo is unsorted — not yet pinned to a day.`;
      const journalBlock = row.draft?.prose
        ? `Existing journal draft for this photo:\n${row.draft.prose}`
        : `No journal draft exists yet for this photo.`;

      // Vision context: load the photo itself when the row is a photo kind, so
      // the model can read location/mood cues straight off the pixels. Graceful:
      // a missing/oversize/unreadable image just skips vision, refine still runs.
      const imageBlockResult = row.kind === "photo"
        ? await loadEntryImageBlock(row)
        : { skipped: "not-photo" };
      const visionAvailable = !!imageBlockResult.block;

      const system = [
        fingerprint,
        "",
        "---",
        "",
        "You are refining a short note the user typed next to a trip photo so it reads in Asif's voice.",
        "",
        "Inputs you will receive:",
        "- Trip + day context (text).",
        "- Any existing journal draft for this photo (text).",
        "- The user's raw note/prompt to refine (text).",
        visionAvailable
          ? "- The photo itself (image). Read location, light, weather, people, and mood from it."
          : "- No image was supplied — rely on the user's note and trip context alone.",
        "",
        "How to use the image (when present):",
        "- Use it to ground sensory details that are clearly visible: time of day, light,",
        "  weather, setting, what the subject is doing. Do not guess at names, prices,",
        "  plaques, or anything requiring OCR of signage.",
        "- Prefer concrete anchors (sky, stone, water, street, plate of food) over abstract ones.",
        "- The user's note is the spine. The image adds texture, not plot.",
        "",
        "Strict rules:",
        "- Preserve every fact the user wrote. Do not invent people, names, places, or events",
        "  that aren't in the note, the trip context, or plainly visible in the image.",
        "- Match the voice fingerprint above. Obey every ABSOLUTE PROHIBITION.",
        "- Return plain prose only — no markdown, no headings, no preamble, no trailing commentary.",
        "- If the note is one sentence, keep it one sentence. Don't pad.",
        "- Do not add a closing moral or summary.",
      ].join("\n");

      const textContent = [
        tripBlock,
        dayBlock,
        "",
        journalBlock,
        "",
        "User's raw note to refine:",
        "---",
        note.trim(),
        "---",
      ].join("\n");

      const userContent = visionAvailable
        ? [imageBlockResult.block, { type: "text", text: textContent }]
        : textContent;

      const msg = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userContent }],
      });
      const refined = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

      if (persist && refined) {
        row.draft = { ...(row.draft || {}), prose: refined };
        row.updatedAt = new Date().toISOString();
        items[idx] = row;
        const filePath = path.join(TRIPS_DIR, slug, "pending.json");
        await atomicWriteJSON(filePath, items);
      }

      res.json({
        ok: true,
        refined,
        model: msg.model,
        usage: msg.usage,
        vision: visionAvailable
          ? { used: true, mediaType: imageBlockResult.mediaType, bytes: imageBlockResult.bytes }
          : { used: false, reason: imageBlockResult.skipped },
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message ?? String(err) });
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
