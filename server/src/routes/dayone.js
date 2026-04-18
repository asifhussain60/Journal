// routes/dayone.js — Phase 11b Push-to-DayOne pipeline.
//
// GET  /api/dayone/journals      → available DayOne journals (currently a
//                                  hardcoded shortlist; CLI doesn't expose
//                                  a `list` subcommand, so we curate).
// POST /api/dayone/push          → bundle the supplied entry IDs into one
//                                  DayOne entry. Body:
//                                    { tripSlug, entryIds: [...], journal }
//                                  Tries `dayone` (2025.19+) then `dayone2`
//                                  CLI; on ENOENT falls back to returning
//                                  the formatted markdown so the client can
//                                  copy it.
//
// Formatting follows DayOne's CLI + markdown conventions:
//   - Inline `[{attachment}]` placeholders weave attached photos into the
//     narrative (replaces deprecated `[{photo}]`). Photo argv order MUST
//     match placeholder order in the body.
//   - Body piped via stdin (no `--no-stdin`); CLI consumes line-by-line.
//   - Photos passed via `-a` (replaces deprecated `-p`).
//   - DayOne markdown supports: headings, italic/bold, blockquotes, lists,
//     checklists, ![alt](url) inline images, ~~strike~~, ==highlight==,
//     <cite>. Tables removed in v2024.x — we do not emit them.

import express from "express";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getActiveTripSlug, readQueue, REPO_ROOT } from "../lib/receipts.js";
import { readTripObj } from "../lib/trip-edit-ops.js";

const execFileP = promisify(execFile);

// Try modern command first, then legacy, then the absolute path inside the
// macOS app bundle. The app-bundle fallback means the integration works
// even if the user never ran `install_cli.sh` (which needs sudo to write
// to /usr/local/bin) — the binary itself is shipped inside the .app.
const CLI_CANDIDATES = [
  "dayone",
  "dayone2",
  "/Applications/Day One.app/Contents/MacOS/dayone",
];

// Curated for now — extend as you add target journals in DayOne.
// Labels must match the names DayOne sees so the CLI -j flag works directly.
const JOURNALS = Object.freeze([
  { id: "ishrat-trips", label: "Ishrat Trips" },
  { id: "asifs-journal", label: "Asif's Journal" },
  { id: "journal", label: "Journal" },
]);

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Pretty-print a trip slug like "2026-04-ishrat-engagement" → "Ishrat
// Engagement — April 2026". Falls back to the title from trip.yaml or
// the raw slug.
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

// Build the markdown body with inline [{attachment}] placeholders for
// every entry that has a photo. Skips entries with no narrative AND no
// photo. Returns { markdown, photoEntryOrder } so the photo argv stays
// aligned with the placeholders.
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
  // DayOne CLI caps at 10 attachments per entry.
  return out.slice(0, 10);
}

function earliestDateIso(entries) {
  const stamps = entries
    .map(r => r.capturedAt || r.createdAt)
    .filter(Boolean)
    .map(s => new Date(s).getTime())
    .filter(n => !isNaN(n));
  if (!stamps.length) return new Date().toISOString();
  return new Date(Math.min(...stamps)).toISOString();
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

async function tryDayoneCli(args, input) {
  let lastEnoentErr = null;
  for (const bin of CLI_CANDIDATES) {
    try {
      return await execFileP(bin, args, {
        input,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
      });
    } catch (err) {
      if (err.code === "ENOENT") { lastEnoentErr = err; continue; }
      throw err;
    }
  }
  // All candidates missing — let caller fall back to clipboard mode.
  const e = new Error("dayone CLI not installed");
  e.code = "ENOENT";
  e.cause = lastEnoentErr;
  throw e;
}

export function createDayoneRouter() {
  const router = express.Router();

  router.get("/api/dayone/journals", (req, res) => {
    res.json({ ok: true, journals: JOURNALS });
  });

  router.post("/api/dayone/push", express.json(), async (req, res) => {
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
      const photos = collectPhotoPaths(photoEntryOrder);
      const dateIso = earliestDateIso(ordered);

      // CLI invocation: photos before `--`, body via stdin so newlines are
      // preserved cleanly. Tag with the trip slug for findability.
      const args = ["-j", journalLabel, "--isoDate", dateIso];
      if (slug) args.push("-t", String(slug));
      if (photos.length) args.push("-a", ...photos);
      args.push("--", "new");
      try {
        const { stdout, stderr } = await tryDayoneCli(args, markdown);
        return res.json({
          ok: true,
          mode: "cli",
          journal: journalLabel,
          entryCount: ordered.length,
          stdout: stdout?.trim() || "",
          stderr: stderr?.trim() || "",
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          return res.json({
            ok: true,
            mode: "clipboard",
            journal: journalLabel,
            entryCount: ordered.length,
            markdown,
            photos,
            note: "DayOne CLI not installed. Install via DayOne menu \u2192 Help \u2192 Install Command Line Tools, then this button will push directly.",
          });
        }
        return res.status(502).json({ ok: false, error: err?.message ?? String(err), stderr: err?.stderr?.toString() });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
