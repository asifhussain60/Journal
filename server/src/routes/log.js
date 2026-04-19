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
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
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
import { loadPrompt } from "../prompts/index.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FINGERPRINT_PATH = path.resolve(__dirname, "../../../reference/voice-fingerprint.md");

// Vision payload budget for refine: stay well under Anthropic's ~5MB base64 cap.
// Above this we skip vision rather than fail the call — refine still works from
// text alone, it just loses the location/mood read from the image.
const REFINE_VISION_MAX_BYTES = 4 * 1024 * 1024;

// Turn a noisy upstream error into something the user can act on. The Anthropic
// SDK stringifies its error message as `"400 {...json...}"` which is useless on
// screen. Prefer the inner `error.message` when present, map common status
// codes to a short English sentence otherwise, and only fall back to the raw
// message if nothing cleaner is available.
function friendlyUpstreamError(err) {
  const inner = err?.error?.error?.message || err?.error?.message;
  if (inner && typeof inner === "string") return inner;
  const raw = typeof err?.message === "string" ? err.message : String(err);
  const statusMatch = /^(\d{3})\b/.exec(raw);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    const byCode = {
      400: "Couldn't process that request — the image or input may be unreadable.",
      401: "Not authorized to call the AI service.",
      413: "Input was too large to refine.",
      429: "AI service is rate-limited right now — try again in a minute.",
      500: "AI service returned an upstream error.",
      502: "AI service is temporarily unavailable.",
      503: "AI service is temporarily unavailable.",
    };
    if (byCode[status]) return byCode[status];
  }
  return raw.length > 160 ? raw.slice(0, 157) + "…" : raw;
}

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
  // Vision-unsupported formats (notably HEIC from iPhone). Refine still works
  // text-only; the client sees `vision: { used: false, reason: "format-heic" }`.
  if (!mediaType) return { skipped: `format-${ext}` };
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

export function createLogRouter({ queueValidators, anthropic, DEFAULT_MODEL, classifyQueue }) {
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

        // Phase 11b: image lands as 'unsorted-image' and the classify queue
        // promotes it to 'photo' or 'receipt' asynchronously. If anthropic is
        // unavailable (no key, no queue), the row stays 'unsorted-image' and
        // the reviewer firms it via the kind toggle on the review card.
        // Caller can short-circuit classification by passing an explicit
        // `kind` form field — used by the [+ Receipt] capture flow which
        // already knows the kind at upload time.
        const requestedKind = req.body?.kind;
        const explicitKind = (requestedKind === "photo" || requestedKind === "receipt") ? requestedKind : null;
        row = {
          schemaVersion: "2",
          id,
          createdAt: now,
          capturedAt: now,
          tripSlug: slug,
          kind: explicitKind || (classifyQueue ? "unsorted-image" : "photo"),
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

      // Phase 11b: kick off async classify for fresh image captures. Best-effort —
      // failures here never block the capture response.
      if (classifyQueue && row.kind === "unsorted-image") {
        classifyQueue.enqueue({ slug, id: row.id, imagePath: row.payload.imagePath });
      }

      res.json({ ok: true, id: row.id, kind: row.kind, tripSlug: slug, count });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // PATCH /api/log/:id — mutate allowed fields on a pending-queue row.
  // Body: { notes?, reviewStatus?, draftProse?, kindOverride?, structured? }
  //   notes         — replaces the top-level string verbatim (empty string clears)
  //   reviewStatus  — validated through workflow-state.assertTransition
  //   draftProse    — stored under draft.prose (Zone 3 refined output)
  //   kindOverride  — Phase 11b: reviewer-corrected kind for image entries
  //                   ("photo" | "receipt"); rewrites row.kind on write so all
  //                   downstream consumers see the corrected value. Only honored
  //                   when row.kind is currently photo/receipt/unsorted-image.
  //   structured    — Phase 11b: receipt-extraction object {amount, currency,
  //                   merchant, date, ynabCategory, lineItems}; stored under
  //                   draft.structured for the YNAB sync step at Approve time.
  // Only operates on rows in pending.json (photo/note/receipt lane). Returns the
  // normalized LogEntry after write so the client can reconcile local state.
  router.patch("/api/log/:id", express.json(), async (req, res) => {
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const id = req.params.id;
      if (!id) return res.status(400).json({ ok: false, error: "id required" });

      const { notes, reviewStatus, draftProse, kindOverride, structured } = req.body ?? {};
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

      if (kindOverride === "photo" || kindOverride === "receipt") {
        const swappable = ["photo", "receipt", "unsorted-image"];
        if (!swappable.includes(row.kind)) {
          return res.status(409).json({ ok: false, error: `kindOverride only valid for image kinds (got kind=${row.kind})` });
        }
        row.kind = kindOverride;
      }

      if (structured && typeof structured === "object") {
        row.draft = { ...(row.draft || {}), structured };
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

  // POST /api/log/:id/refine — refine a captured entry in Asif's voice using
  // the user's prompt as curatorial intent. Branches on row.kind:
  //   photo   → vision refine (Sonnet) producing prose; existing Phase 11a path.
  //   receipt → vision refine (Sonnet, refine-receipt prompt) producing both
  //             prose AND a structured object (amount/merchant/category/items).
  //             Response shape: { refined, structured, model, usage }.
  //   voice   → text refine (Haiku, refine-voice-transcript prompt) cleaning
  //             the transcript stored at row.payload.transcript.
  //   note    → text refine (Haiku, refine-note prompt) polishing the captured
  //             text stored at row.payload.text or row.notes.
  //
  // Body: { note: string, persist?: boolean }
  //   note     — Zone 2 prompt (curatorial intent). May be empty for non-photo
  //              kinds — prompts default to "tighten and apply Asif voice".
  //              Photo kind keeps the Phase 11a invariant: non-empty required.
  //   persist  — when true, server writes refined text to row.draft.prose
  //              (and structured object for receipts).
  router.post("/api/log/:id/refine", express.json(), async (req, res) => {
    if (!anthropic) {
      return res.status(503).json({ ok: false, error: "anthropic client not configured" });
    }
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const id = req.params.id;
      const { note, persist, kindOverride } = req.body ?? {};
      if (typeof note !== "string") {
        return res.status(400).json({ ok: false, error: "note (string) is required (may be empty)" });
      }
      if (note.length > 20_000) {
        return res.status(413).json({ ok: false, error: "note exceeds 20000 chars" });
      }

      const items = await readQueue(slug, "pending");
      const idx = items.findIndex((r) => r?.id === id);
      if (idx === -1) return res.status(404).json({ ok: false, error: "entry not found in pending" });
      const row = items[idx];
      // Honor reviewer's kind toggle for image rows even before it lands as a
      // PATCH — keeps the refine prompt aligned with what the reviewer sees.
      // For unsorted-image rows (classify hasn't firmed yet, or failed), fall
      // back to the photo refine path so the user isn't blocked.
      let kind;
      if ((kindOverride === "photo" || kindOverride === "receipt") &&
          ["photo", "receipt", "unsorted-image"].includes(row.kind)) {
        kind = kindOverride;
      } else if (row.kind === "unsorted-image") {
        kind = "photo";
      } else {
        kind = row.kind;
      }

      // Photo path keeps Phase 11a's non-empty-prompt invariant — the photo
      // refine prompt is wired around "the user typed something next to a photo".
      if (kind === "photo" && note.trim().length === 0) {
        return res.status(400).json({ ok: false, error: "note (non-empty string) is required for photo refine" });
      }
      if (!["photo", "receipt", "voice", "note"].includes(kind)) {
        return res.status(422).json({ ok: false, error: `kind ${kind} not refineable` });
      }

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
      const tripBlockParts = [
        tripCtx
          ? `Active trip: ${tripCtx.slug || slug}${tripCtx.title ? ` — ${tripCtx.title}` : ""}`
          : `Active trip slug: ${slug}`,
      ];
      if (tripCtx?.startDate) tripBlockParts.push(`Trip dates: ${tripCtx.startDate}${tripCtx.endDate ? ` → ${tripCtx.endDate}` : ""}`);
      if (tripCtx?.location) tripBlockParts.push(`Location: ${tripCtx.location}`);
      if (tripCtx?.ynab?.category) tripBlockParts.push(`Trip YNAB target category: ${tripCtx.ynab.category}`);
      const tripBlock = tripBlockParts.join("\n");

      // ─── Photo path (Phase 11a, unchanged behavior) ───
      if (kind === "photo") {
        const dayBlock = di != null
          ? `Photo is placed on Day ${di + 1}${row.placement?.eventId ? ` · ${row.placement.eventId.replace(/_/g, " ")}` : ""}.`
          : `Photo is unsorted — not yet pinned to a day.`;
        const journalBlock = row.draft?.prose
          ? `Existing journal draft for this photo:\n${row.draft.prose}`
          : `No journal draft exists yet for this photo.`;

        const imageBlockResult = await loadEntryImageBlock(row);
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
          "- The user writes in multiple languages. Preserve any non-English words,",
          "  transliterated phrases (Urdu/Hindi/Arabic etc.), names, dishes, places, and",
          "  cultural terms exactly as written — do not translate, substitute, or anglicise",
          "  them. They are authentic voice, not typos.",
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

        return res.json({
          ok: true,
          refined,
          model: msg.model,
          usage: msg.usage,
          vision: visionAvailable
            ? { used: true, mediaType: imageBlockResult.mediaType, bytes: imageBlockResult.bytes }
            : { used: false, reason: imageBlockResult.skipped },
        });
      }

      // ─── Phase 11b paths: receipt / voice / note ───
      const promptDef = loadPrompt(
        kind === "receipt" ? "refine-receipt"
        : kind === "voice" ? "refine-voice-transcript"
        : "refine-note"
      );
      const system = [fingerprint, "", "---", "", promptDef.system].join("\n");

      const userPromptBlock = note.trim().length
        ? `User's prompt:\n---\n${note.trim()}\n---`
        : `User's prompt: (empty — apply prompt defaults)`;

      let userContent;
      let visionMeta = { used: false, reason: "kind-not-image" };

      if (kind === "receipt") {
        const imageBlockResult = await loadEntryImageBlock(row);
        if (!imageBlockResult.block) {
          return res.status(422).json({ ok: false, error: `receipt refine requires image (skipped: ${imageBlockResult.skipped})` });
        }
        visionMeta = { used: true, mediaType: imageBlockResult.mediaType, bytes: imageBlockResult.bytes };
        const textContent = [tripBlock, "", userPromptBlock].join("\n");
        userContent = [imageBlockResult.block, { type: "text", text: textContent }];
      } else {
        // voice / note — text-only
        const artifactText = kind === "voice"
          ? (row.payload?.transcript || row.notes || "")
          : (row.payload?.text || row.notes || "");
        if (!artifactText.trim().length) {
          return res.status(422).json({ ok: false, error: `${kind} refine requires non-empty captured text` });
        }
        const artifactLabel = kind === "voice" ? "Voice transcript (raw):" : "Captured note (raw):";
        userContent = [
          tripBlock,
          "",
          artifactLabel,
          "---",
          artifactText.trim(),
          "---",
          "",
          userPromptBlock,
        ].join("\n");
      }

      const msg = await anthropic.messages.create({
        model: promptDef.model,
        max_tokens: kind === "receipt" ? 1500 : 1024,
        system,
        messages: [{ role: "user", content: userContent }],
      });
      const rawText = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

      let refined = rawText;
      let structured = null;

      if (kind === "receipt") {
        // Receipt prompt returns { refined, structured: {...} } — JSON only.
        try {
          const parsed = JSON.parse(rawText);
          refined = typeof parsed.refined === "string" ? parsed.refined : "";
          structured = parsed.structured && typeof parsed.structured === "object" ? parsed.structured : null;
        } catch (err) {
          return res.status(502).json({ ok: false, error: `receipt refine returned non-JSON: ${err.message}`, raw: rawText.slice(0, 500) });
        }
      }

      if (persist && refined) {
        const draftPatch = { ...(row.draft || {}), prose: refined };
        if (structured) draftPatch.structured = structured;
        row.draft = draftPatch;
        row.updatedAt = new Date().toISOString();
        items[idx] = row;
        const filePath = path.join(TRIPS_DIR, slug, "pending.json");
        await atomicWriteJSON(filePath, items);
      }

      return res.json({
        ok: true,
        refined,
        ...(structured ? { structured } : {}),
        model: msg.model,
        usage: msg.usage,
        vision: visionMeta,
      });
    } catch (err) {
      // Upstream AI failures are user-recoverable (bad image, rate limit, etc),
      // so return HTTP 200 with ok:false. The client's getJSON still treats
      // ok:false as a thrown error — we just stop polluting the browser's
      // network console with red 502 lines that aren't actionable.
      res.status(200).json({ ok: false, error: friendlyUpstreamError(err) });
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

  // DELETE /api/trips/:slug/reviewed — bulk-clear the Reviewed lane after the
  // entries have been copied to DayOne. Prose is archived into a dated JSONL
  // under the trip's .trash/ (DayOne is the primary archive; this is just an
  // ops escape hatch). Photo files are hard-removed — the cloud library is
  // the authoritative photo backup.
  router.delete("/api/trips/:slug/reviewed", async (req, res) => {
    try {
      const slug = req.params.slug;
      if (!slug || typeof slug !== "string") {
        return res.status(400).json({ ok: false, error: "slug required" });
      }
      // Defence-in-depth: slug is used to compose on-disk paths.
      if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
        return res.status(400).json({ ok: false, error: "invalid slug" });
      }

      const items = await readQueue(slug, "pending");
      const reviewed = items.filter((r) => r?.reviewStatus === "approved");
      const rest = items.filter((r) => r?.reviewStatus !== "approved");

      if (reviewed.length === 0) {
        return res.json({ ok: true, entryCount: 0, photoCount: 0 });
      }

      // Archive reviewed rows as JSONL (one row per line — easier to grep
      // later than a pretty-printed array).
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const trashDir = path.join(TRIPS_DIR, slug, ".trash");
      await mkdir(trashDir, { recursive: true });
      const trashPath = path.join(trashDir, `entries-${ts}.jsonl`);
      const trashBody = reviewed.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await writeFile(trashPath, trashBody, "utf8");

      // Rewrite pending.json without the reviewed rows.
      const pendingPath = path.join(TRIPS_DIR, slug, "pending.json");
      await atomicWriteJSON(pendingPath, rest);

      // Hard-remove referenced photo files. ENOENT is fine (already gone);
      // other errors are logged but don't fail the request — the trash file
      // already has the row reference, so an ops recovery can still work.
      let photoCount = 0;
      for (const row of reviewed) {
        const abs = resolveEntryImagePath(row);
        if (!abs) continue;
        try {
          await unlink(abs);
          photoCount += 1;
        } catch (err) {
          if (err.code !== "ENOENT") {
            console.warn(`[reviewed-delete] unlink ${abs}: ${err.message}`);
          }
        }
      }

      res.json({ ok: true, entryCount: reviewed.length, photoCount });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
