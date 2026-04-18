// routes/dayone.js — Phase 11b Copy-to-DayOne pipeline.
//
// GET  /api/dayone/journals     → available DayOne journals (curated shortlist;
//                                 CLI has no `list` subcommand so we hand-pick).
// POST /api/dayone/bundle       → bundle the supplied entry IDs into a single
//                                 clipboard-ready payload. Body:
//                                   { tripSlug, entryIds: [...], journal }
//                                 Returns { markdown, html } where `html`
//                                 contains inline <img src="data:..."> tags so
//                                 pasting into DayOne brings the photo bytes
//                                 with it (not just a file-path reference).
//
// Formatting:
//   - markdown: DayOne-flavoured body with `[{attachment}]` placeholders where
//     a photo belongs. Kept for plain-text fallback pastes.
//   - html: the same body rendered as minimal HTML with inline base64 <img>
//     tags replacing each placeholder — this is the payload that creates a
//     rich DayOne entry on paste.

import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getActiveTripSlug, readQueue, REPO_ROOT } from "../lib/receipts.js";
import { readTripObj } from "../lib/trip-edit-ops.js";

// Curated for now — extend as you add target journals in DayOne.
// Labels must match the names DayOne sees so pastes land in the right journal.
const JOURNALS = Object.freeze([
  { id: "ishrat-trips", label: "Ishrat Trips" },
  { id: "asifs-journal", label: "Asif's Journal" },
  { id: "journal", label: "Journal" },
]);

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function niceTitle(tripCtx, slug) {
  if (tripCtx?.title) return tripCtx.title;
  const s = tripCtx?.slug || slug || "";
  const m = s.match(/^(\d{4})-(\d{1,2})-(.+)$/);
  if (!m) return s || "Trip";
  const [, year, monthStr, rest] = m;
  const monthIdx = parseInt(monthStr, 10) - 1;
  const monthName = MONTH_NAMES[monthIdx] || monthStr;
  const titlePart = rest.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return `${titlePart} — ${monthName} ${year}`;
}

function entryProse(row) {
  const candidate = row?.draft?.prose || row?.notes || row?.payload?.text || row?.payload?.transcript || "";
  return String(candidate).trim();
}

function entryHasPhoto(row) {
  const rel = row?.payload?.imagePath || row?.imagePath;
  return !!(rel && typeof rel === "string");
}

function formatBundle({ tripCtx, slug, entries }) {
  const title = niceTitle(tripCtx, slug);
  const dateRange = formatDateRange(entries);
  const location = tripCtx?.location || tripCtx?.origin?.label || "";
  const metaParts = [dateRange, location].filter(Boolean);
  const metaLine = metaParts.length ? `*${metaParts.join(" · ")}*` : "";

  const blocks = [];
  const photoEntryOrder = [];
  for (const row of entries) {
    const prose = entryProse(row);
    const hasPhoto = entryHasPhoto(row);
    if (!prose && !hasPhoto) continue;
    const block = [];
    if (hasPhoto) {
      block.push("[{attachment}]");
      photoEntryOrder.push(row);
    }
    if (prose) block.push(prose);
    blocks.push(block.join("\n\n"));
  }

  const out = [`# ${title}`];
  if (metaLine) out.push("", metaLine);
  out.push("");
  for (let i = 0; i < blocks.length; i++) {
    out.push(blocks[i]);
    if (i < blocks.length - 1) out.push("");
  }
  return { markdown: out.join("\n"), photoEntryOrder };
}

function collectPhotoPaths(orderedRows) {
  const out = [];
  for (const row of orderedRows) {
    const rel = row?.payload?.imagePath || row?.imagePath;
    if (!rel || typeof rel !== "string") continue;
    const abs = path.resolve(REPO_ROOT, rel);
    if (!abs.startsWith(REPO_ROOT + path.sep)) continue;
    out.push(abs);
  }
  // Mirror DayOne's historical 10-attachment cap to keep payloads sane.
  return out.slice(0, 10);
}

function formatDateRange(entries) {
  const stamps = entries
    .map(r => r.capturedAt || r.createdAt)
    .filter(Boolean)
    .map(s => new Date(s))
    .filter(d => !isNaN(d.getTime()));
  if (!stamps.length) return "";
  const first = new Date(Math.min(...stamps.map(d => d.getTime())));
  const last  = new Date(Math.max(...stamps.map(d => d.getTime())));
  const fmt = (d) => `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return first.toDateString() === last.toDateString() ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
}

function mimeFromExt(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".heic") return "image/heic";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function loadPhotos(paths) {
  const out = [];
  for (const abs of paths) {
    try {
      const buf = await readFile(abs);
      const mime = mimeFromExt(abs);
      out.push({
        filename: path.basename(abs),
        mime,
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      });
    } catch { /* skip unreadable */ }
  }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render the bundle markdown to minimal HTML, swapping each `[{attachment}]`
// placeholder for an <img> that carries the photo bytes inline. Paragraphs are
// split on blank lines; single newlines inside a paragraph become <br>.
function renderHtml({ markdown, photos }) {
  const paragraphs = markdown.split(/\n{2,}/);
  const parts = [];
  let photoIdx = 0;
  for (const raw of paragraphs) {
    const block = raw.replace(/\s+$/, "");
    if (!block) continue;
    if (block.startsWith("# ")) {
      parts.push(`<h1>${escapeHtml(block.slice(2).trim())}</h1>`);
      continue;
    }
    if (block === "[{attachment}]") {
      const p = photos[photoIdx++];
      if (p) parts.push(`<p><img src="${p.dataUrl}" alt="${escapeHtml(p.filename)}" /></p>`);
      continue;
    }
    const trimmed = block.trim();
    if (/^\*[^*]+\*$/.test(trimmed)) {
      parts.push(`<p><em>${escapeHtml(trimmed.slice(1, -1))}</em></p>`);
      continue;
    }
    parts.push(`<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`);
  }
  return parts.join("\n");
}

export function createDayoneRouter() {
  const router = express.Router();

  router.get("/api/dayone/journals", (req, res) => {
    res.json({ ok: true, journals: JOURNALS });
  });

  router.post("/api/dayone/bundle", express.json(), async (req, res) => {
    try {
      const { tripSlug, entryIds, journal } = req.body ?? {};
      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        return res.status(400).json({ ok: false, error: "entryIds (non-empty array) required" });
      }
      const journalLabel = JOURNALS.find(j => j.id === journal || j.label === journal)?.label;
      if (!journalLabel) {
        return res.status(400).json({ ok: false, error: `unknown journal: ${journal}` });
      }

      const slug = tripSlug || (await getActiveTripSlug());
      const items = await readQueue(slug, "pending");
      const byId = new Map(items.map(r => [r.id, r]));
      const ordered = entryIds.map(id => byId.get(id)).filter(Boolean);
      if (ordered.length === 0) {
        return res.status(404).json({ ok: false, error: "no matching entries in pending" });
      }

      let tripCtx = null;
      try { tripCtx = await readTripObj(slug); } catch { /* best-effort */ }

      const { markdown, photoEntryOrder } = formatBundle({ tripCtx, slug, entries: ordered });
      const photos = await loadPhotos(collectPhotoPaths(photoEntryOrder));
      const html = renderHtml({ markdown, photos });

      res.json({
        ok: true,
        journal: journalLabel,
        entryCount: ordered.length,
        markdown,
        html,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
