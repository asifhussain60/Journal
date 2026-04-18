// routes/dayone.js — Phase 11b Push-to-DayOne pipeline.
//
// GET  /api/dayone/journals      → available DayOne journals (currently a
//                                  hardcoded shortlist; CLI doesn't expose
//                                  a `list` subcommand, so we curate).
// POST /api/dayone/push          → bundle the supplied entry IDs into one
//                                  DayOne entry. Body:
//                                    { tripSlug, entryIds: [...], journal }
//                                  Tries `dayone2` CLI first; on ENOENT
//                                  falls back to returning the formatted
//                                  markdown so the client can copy it.

import express from "express";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getActiveTripSlug, readQueue, REPO_ROOT } from "../lib/receipts.js";
import { readTripObj } from "../lib/trip-edit-ops.js";

const execFileP = promisify(execFile);

// Curated for now — extend as you add target journals in DayOne.
// Labels match the names DayOne sees so the CLI -j flag works directly.
const JOURNALS = Object.freeze([
  { id: "ishrat-trips", label: "Ishrat Trips" },
  { id: "asifs-journal", label: "Asif's Journal" },
  { id: "journal", label: "Journal" },
]);

function formatBundle({ tripCtx, entries }) {
  const tripTitle = tripCtx?.title || tripCtx?.slug || "Untitled trip";
  const heading = `# ${tripTitle}`;
  const sections = entries.map((row, i) => {
    const ts = row.capturedAt || row.createdAt;
    const tsLabel = ts ? new Date(ts).toLocaleString() : `Entry ${i + 1}`;
    const kindLabel = (row.kind || "entry").replace(/-/g, " ");
    const text = (row.draft?.prose || row.notes || row.payload?.text || row.payload?.transcript || "").trim();
    const subhead = `## ${tsLabel} — ${kindLabel}`;
    return text ? `${subhead}\n\n${text}\n` : `${subhead}\n\n_(no narrative)_\n`;
  });
  return [heading, "", ...sections].join("\n");
}

function collectPhotoPaths(entries) {
  const out = [];
  for (const row of entries) {
    const rel = row?.payload?.imagePath || row?.imagePath;
    if (!rel || typeof rel !== "string") continue;
    const abs = path.resolve(REPO_ROOT, rel);
    if (!abs.startsWith(REPO_ROOT + path.sep)) continue;
    out.push(abs);
  }
  return out;
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

      const markdown = formatBundle({ tripCtx, entries: ordered });
      const photos = collectPhotoPaths(ordered);
      const dateIso = earliestDateIso(ordered);

      // Try dayone2 CLI. On ENOENT (CLI not installed) fall back to client
      // clipboard mode so the feature still ships something useful.
      const args = ["new", "-j", journalLabel, "-d", dateIso];
      if (photos.length) args.push("-p", ...photos);
      try {
        const { stdout, stderr } = await execFileP("dayone2", args, {
          input: markdown,
          maxBuffer: 8 * 1024 * 1024,
          timeout: 30_000,
        });
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
            note: "dayone2 CLI not installed — install via DayOne > Help > Install Command Line Tools to enable direct push.",
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
