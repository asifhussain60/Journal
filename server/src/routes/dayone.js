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

function sanitizeCompose(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const context = typeof obj.context === "string" ? obj.context.trim() : "";
  const reflection = typeof obj.reflection === "string" ? obj.reflection.trim().slice(0, 2000) : "";
  const date = typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? obj.date : "";
  // Weather is client-fetched and sent back so the bundle stays deterministic
  // at clipboard time — no extra Open-Meteo round-trip on Copy.
  let weather = null;
  if (obj.weather && typeof obj.weather === "object") {
    const label = typeof obj.weather.label === "string" ? obj.weather.label.trim() : "";
    if (label) {
      const tempF = Number.isFinite(obj.weather.tempF) ? Math.round(obj.weather.tempF) : null;
      weather = { label, tempF };
    }
  }
  // dayoneTags — validated string array, max 30 per DayOne limits
  const dayoneTags = Array.isArray(obj.dayoneTags)
    ? obj.dayoneTags.map(t => (typeof t === "string" ? t.trim() : "")).filter(Boolean).slice(0, 30)
    : [];
  return { title, context, reflection, date, weather, dayoneTags };
}

// "2026-04-19" → "April 19, 2026" — human-friendly rendering for the
// Metadata bullet. Invalid input yields the raw string so nothing is lost.
function formatDateHuman(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  const monthIdx = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const year = m[1];
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${MONTH_NAMES[monthIdx]} ${day}, ${year}`;
}

function buildDefaultMetadata(tripCtx, entries, date, weather) {
  const parts = [];
  const human = formatDateHuman(date);
  if (human) parts.push(human);
  const regions = Array.isArray(tripCtx?.regions) ? tripCtx.regions.filter(Boolean) : [];
  if (regions.length) parts.push(regions.slice(0, 3).join(" · "));
  if (weather?.label) {
    parts.push(weather.tempF != null ? `${weather.label} · ${weather.tempF}°F` : weather.label);
  }
  if (tripCtx?.vibe) parts.push(tripCtx.vibe);
  const kinds = Array.from(new Set((entries || []).map(r => r?.kind).filter(Boolean)));
  if (kinds.length) parts.push(kinds.map(k => `#${k}`).join(" "));
  return parts.join("  •  ");
}

function formatBundle({ tripCtx, slug, entries, compose: composeRaw }) {
  const compose = sanitizeCompose(composeRaw);

  // Story blocks (one paragraph per entry, with [{attachment}] placeholders).
  const storyBlocks = [];
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
    storyBlocks.push(block.join("\n\n"));
  }

  // Title + Context fall back to computed defaults when the user skipped them.
  const title = compose.title || niceTitle(tripCtx, slug);
  const context = compose.context
    || [formatDateRange(entries), tripCtx?.location || tripCtx?.origin?.label || ""].filter(Boolean).join(" · ");
  const metadata = buildDefaultMetadata(tripCtx, entries, compose.date, compose.weather);

  // Photos ride inline with their source entry in the Story body. The Story
  // section owns every [{attachment}] placeholder, which keeps the HTML
  // renderer's photoIdx counter trivially in sync with photoEntryOrder.

  const out = [];
  out.push(`# ${title}`);
  if (context) {
    out.push("", "## Context", context);
  }
  if (compose.reflection) {
    out.push("", "## Reflection", compose.reflection);
  }
  if (storyBlocks.length) {
    out.push("", "## Story", "");
    for (let i = 0; i < storyBlocks.length; i++) {
      out.push(storyBlocks[i]);
      if (i < storyBlocks.length - 1) out.push("");
    }
  }
  if (metadata) {
    out.push("", "## Metadata", `*${metadata}*`);
  }

  let body = out.join("\n");

  // Escape stray # in body so DayOne CLI doesn't parse them as tags.
  // U+FF03 (fullwidth number sign) renders identically but is tag-inert.
  body = body.replace(/#(?=[A-Za-z])/g, "\uFF03");

  // Append real DayOne tags at the very end (one #Tag per word, blank-separated).
  if (compose.dayoneTags.length) {
    body += "\n\n" + compose.dayoneTags.map(t => `#${t}`).join(" ");
  }

  return { markdown: body, photoEntryOrder };
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
    if (block.startsWith("## ")) {
      const firstLineEnd = block.indexOf("\n");
      const heading = (firstLineEnd === -1 ? block.slice(3) : block.slice(3, firstLineEnd)).trim();
      const rest = firstLineEnd === -1 ? "" : block.slice(firstLineEnd + 1).trim();
      parts.push(`<h2>${escapeHtml(heading)}</h2>`);
      if (!rest) continue;
      // Bullet list (every non-empty line starts with "- ").
      const lines = rest.split(/\n/);
      if (lines.every(l => /^-\s+/.test(l))) {
        parts.push(`<ul>${lines.map(l => `<li>${escapeHtml(l.replace(/^-\s+/, ""))}</li>`).join("")}</ul>`);
        continue;
      }
      // Italic single-line meta (Metadata section).
      if (lines.length === 1 && /^\*[^*]+\*$/.test(lines[0])) {
        parts.push(`<p><em>${escapeHtml(lines[0].slice(1, -1))}</em></p>`);
        continue;
      }
      parts.push(`<p>${escapeHtml(rest).replace(/\n/g, "<br>")}</p>`);
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
      const { tripSlug, entryIds, journal, compose } = req.body ?? {};
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

      const { markdown, photoEntryOrder } = formatBundle({ tripCtx, slug, entries: ordered, compose });
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
