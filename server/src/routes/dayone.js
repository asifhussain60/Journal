// routes/dayone.js — Copy-to-DayOne pipeline (Phase 11b + preview workflow).
//
// GET  /api/dayone/journals     → curated DayOne journal shortlist.
// POST /api/dayone/compose      → build a structured bundle from entry IDs and
//                                 return JSON the preview UI can bind to:
//                                   { title, context, highlights[],
//                                     story[{ entryId, photoRef, prose }],
//                                     metadata, tags[], photoCount }
//                                 No markdown/HTML emit. Cheap (no base64).
// POST /api/dayone/bundle       → emit clipboard-ready markdown + HTML. Body:
//                                   { tripSlug, journal, ...payload }
//                                 Where `payload` is one of:
//                                   - { entryIds[], compose }    legacy: server composes
//                                   - { composed: { ... } }      preview: client supplies
//                                                                 the edited structured
//                                                                 bundle from /compose
//                                 Returns { markdown, html } — html carries inline
//                                 <img src="data:..."> tags so paste includes bytes.

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

// Auto-suggest Highlights bullets — one short sentence per card with prose,
// up to `max`. Prefers cards with photos (they tend to anchor a moment).
// User always overrides; this just seeds the field.
function autoSuggestHighlights(entries, max = 5) {
  const out = [];
  const candidates = [...entries].sort((a, b) => {
    const ap = entryHasPhoto(a) ? 0 : 1;
    const bp = entryHasPhoto(b) ? 0 : 1;
    return ap - bp;
  });
  for (const row of candidates) {
    if (out.length >= max) break;
    const prose = entryProse(row);
    if (!prose) continue;
    const firstSentence = (prose.match(/[^.!?]+[.!?]?/) || [prose])[0].trim();
    if (firstSentence) out.push(firstSentence);
  }
  return out;
}

// Build the structured bundle from raw entries + trip context. This is the
// shape the preview UI binds to and the shape the client edits and posts back
// to /bundle when it's time to copy. Pure: no I/O.
function composeStructured({ tripCtx, slug, entries, hints = {} }) {
  const title = (typeof hints.title === "string" && hints.title.trim())
    || niceTitle(tripCtx, slug);

  const context = (typeof hints.context === "string" && hints.context.trim())
    || [formatDateRange(entries), tripCtx?.location || tripCtx?.origin?.label || ""].filter(Boolean).join(" · ");

  const highlights = Array.isArray(hints.highlights)
    ? hints.highlights.map(h => String(h).trim()).filter(Boolean).slice(0, 5)
    : autoSuggestHighlights(entries);

  // 1:1 — each card becomes one Story block. Empty (no prose, no photo) cards
  // are dropped at this layer; the client can re-include them by editing prose.
  const story = [];
  for (const row of entries) {
    const prose = entryProse(row);
    const hasPhoto = entryHasPhoto(row);
    if (!prose && !hasPhoto) continue;
    const imagePath = row?.payload?.imagePath || row?.imagePath || null;
    story.push({
      entryId: row.id,
      kind: row.kind,
      photoRef: hasPhoto && imagePath ? { imagePath, kind: row.kind } : null,
      prose,
      include: true,
    });
  }

  const tags = Array.isArray(hints.tags)
    ? hints.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 30)
    : (() => {
        const kindTags = Array.from(new Set(entries.map(r => r?.kind).filter(Boolean)));
        const tripTags = Array.isArray(tripCtx?.tags) ? tripCtx.tags.filter(Boolean) : [];
        const merged = Array.from(new Set([...tripTags, ...kindTags]));
        return merged.slice(0, 30);
      })();

  const metadata = (typeof hints.metadata === "string" && hints.metadata.trim())
    || buildDefaultMetadata(tripCtx, entries, hints.date, hints.weather);

  return { title, context, highlights, story, metadata, tags };
}

// Validate + normalize a client-edited structured payload before emit. Trusts
// nothing: re-applies the same caps and trims composeStructured uses.
function sanitizeComposed(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const context = typeof obj.context === "string" ? obj.context.trim() : "";
  const metadata = typeof obj.metadata === "string" ? obj.metadata.trim() : "";
  const highlights = Array.isArray(obj.highlights)
    ? obj.highlights.map(h => (typeof h === "string" ? h.trim() : "")).filter(Boolean).slice(0, 5)
    : [];
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map(t => (typeof t === "string" ? t.trim() : "")).filter(Boolean).slice(0, 30)
    : [];
  const story = Array.isArray(obj.story)
    ? obj.story.map(s => {
        const block = s && typeof s === "object" ? s : {};
        const include = block.include !== false;
        if (!include) return null;
        // Cap prose length to keep clipboard payloads bounded — same precedent
        // as sanitizeCompose's reflection cap, but prose is the main long-form
        // field so the budget is larger.
        const prose = typeof block.prose === "string" ? block.prose.trim().slice(0, 5000) : "";
        let photoRef = null;
        if (block.photoRef && typeof block.photoRef === "object"
            && typeof block.photoRef.imagePath === "string"
            && block.photoRef.imagePath.trim()) {
          photoRef = {
            imagePath: block.photoRef.imagePath.trim(),
            kind: typeof block.photoRef.kind === "string" ? block.photoRef.kind : null,
          };
        }
        if (!prose && !photoRef) return null;
        return {
          entryId: typeof block.entryId === "string" ? block.entryId : null,
          kind: typeof block.kind === "string" ? block.kind : null,
          photoRef,
          prose,
          include: true,
        };
      }).filter(Boolean)
    : [];
  return { title, context, highlights, story, metadata, tags };
}

// Serialize a structured bundle to DayOne markdown. Returns photoEntryOrder
// shaped so collectPhotoPaths/loadPhotos work the same as the legacy path.
function emitFromStructured(structured) {
  const { title, context, highlights, story, metadata, tags } = structured;

  const out = [];
  out.push(`# ${title || "Untitled"}`);
  if (context) {
    out.push("", "## Context", context);
  }
  if (Array.isArray(highlights) && highlights.length) {
    out.push("", "## Highlights", "");
    for (const h of highlights) out.push(`- ${h}`);
  }

  const photoEntryOrder = [];
  if (Array.isArray(story) && story.length) {
    out.push("", "## Story", "");
    const blocks = [];
    for (const s of story) {
      const lines = [];
      if (s.photoRef) {
        lines.push("[{attachment}]");
        photoEntryOrder.push({ payload: { imagePath: s.photoRef.imagePath } });
      }
      if (s.prose) lines.push(s.prose);
      if (lines.length) blocks.push(lines.join("\n\n"));
    }
    for (let i = 0; i < blocks.length; i++) {
      out.push(blocks[i]);
      if (i < blocks.length - 1) out.push("");
    }
  }
  if (metadata) {
    out.push("", "## Metadata", `*${metadata}*`);
  }

  let body = out.join("\n");
  // Escape stray # in body so DayOne CLI doesn't parse them as tags.
  // U+FF03 (fullwidth number sign) renders identically but is tag-inert.
  body = body.replace(/#(?=[A-Za-z])/g, "\uFF03");
  if (Array.isArray(tags) && tags.length) {
    body += "\n\n" + tags.map(t => `#${t}`).join(" ");
  }

  return { markdown: body, photoEntryOrder };
}

// Legacy path: server composes from raw entries + the old hints shape, then
// emits. Kept so the unmodified clipboard call site still works during the
// preview-feature rollout.
function formatBundle({ tripCtx, slug, entries, compose: composeRaw }) {
  const composeHints = sanitizeCompose(composeRaw);
  const hints = {
    title: composeHints.title,
    context: composeHints.context,
    date: composeHints.date,
    weather: composeHints.weather,
    tags: composeHints.dayoneTags,
    // Legacy callers never asked for Highlights — suppress auto-suggest so
    // the existing clipboard path produces byte-identical output.
    highlights: [],
  };
  const structured = composeStructured({ tripCtx, slug, entries, hints });
  // Legacy "Reflection" field was a single bundle-level paragraph. Inject it
  // as a synthetic Context append so it still ships when callers pass it.
  if (composeHints.reflection) {
    structured.context = structured.context
      ? `${structured.context}\n\n${composeHints.reflection}`
      : composeHints.reflection;
  }
  return emitFromStructured(structured);
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
    // Standalone bullet paragraph — happens when the emitter writes a blank
    // line between the H2 heading and its bullets (e.g. "## Highlights\n\n- a\n- b").
    // The H2 lands as its own paragraph above; this branch handles the bullets.
    {
      const lines = block.split(/\n/);
      if (lines.length && lines.every(l => /^-\s+/.test(l))) {
        parts.push(`<ul>${lines.map(l => `<li>${escapeHtml(l.replace(/^-\s+/, ""))}</li>`).join("")}</ul>`);
        continue;
      }
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

  // Build a structured bundle the preview UI can bind to. No markdown/HTML
  // emit and no base64 photo bytes — those are reserved for /bundle so this
  // endpoint stays cheap to call (and re-call) during preview hydration.
  router.post("/api/dayone/compose", express.json(), async (req, res) => {
    try {
      const { tripSlug, entryIds, hints } = req.body ?? {};
      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        return res.status(400).json({ ok: false, error: "entryIds (non-empty array) required" });
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

      const structured = composeStructured({ tripCtx, slug, entries: ordered, hints });
      const photoCount = structured.story.filter(s => s.photoRef).length;

      res.json({
        ok: true,
        tripSlug: slug,
        entryCount: ordered.length,
        photoCount,
        composed: structured,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post("/api/dayone/bundle", express.json(), async (req, res) => {
    try {
      const { tripSlug, entryIds, journal, compose, composed } = req.body ?? {};
      const journalLabel = JOURNALS.find(j => j.id === journal || j.label === journal)?.label;
      if (!journalLabel) {
        return res.status(400).json({ ok: false, error: `unknown journal: ${journal}` });
      }

      const slug = tripSlug || (await getActiveTripSlug());

      // Two payload shapes:
      //   - composed: client supplies the edited structured bundle from /compose
      //   - entryIds[]: legacy path — server composes from raw entries
      let markdown, photoEntryOrder, entryCount;
      if (composed && typeof composed === "object") {
        const sanitized = sanitizeComposed(composed);
        if (!sanitized.story.length && !sanitized.highlights.length && !sanitized.context) {
          return res.status(400).json({ ok: false, error: "composed payload is empty" });
        }
        ({ markdown, photoEntryOrder } = emitFromStructured(sanitized));
        entryCount = sanitized.story.length;
      } else {
        if (!Array.isArray(entryIds) || entryIds.length === 0) {
          return res.status(400).json({ ok: false, error: "entryIds (non-empty array) or composed payload required" });
        }
        const items = await readQueue(slug, "pending");
        const byId = new Map(items.map(r => [r.id, r]));
        const ordered = entryIds.map(id => byId.get(id)).filter(Boolean);
        if (ordered.length === 0) {
          return res.status(404).json({ ok: false, error: "no matching entries in pending" });
        }
        let tripCtx = null;
        try { tripCtx = await readTripObj(slug); } catch { /* best-effort */ }
        ({ markdown, photoEntryOrder } = formatBundle({ tripCtx, slug, entries: ordered, compose }));
        entryCount = ordered.length;
      }

      const photos = await loadPhotos(collectPhotoPaths(photoEntryOrder));
      const html = renderHtml({ markdown, photos });

      res.json({
        ok: true,
        journal: journalLabel,
        entryCount,
        markdown,
        html,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
