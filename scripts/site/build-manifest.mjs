#!/usr/bin/env node
// build-manifest.mjs — derive the runtime chapter manifest and mirror chapters.
//
// Merges authored display metadata (site/src/content/manifest.authored.json)
// with DERIVED fields computed here:
//   - file presence + word count, read from the CANONICAL memoir source
//     content/babu-memoir/chapters/*.txt (NOT the site mirror)
//   - status / locked, read from content/babu-memoir/_system/chapter-status.md
//     (the single source of truth for what is locked)
// and mirrors the canonical .txt files into site/public/chapters/ for runtime
// fetch. Emits site/src/content/manifest.generated.json (gitignored).
//
// This replaces the two hand-maintained structures (CHAPTERS, CHAPTER_SECTIONS)
// that lived inline in the old site/index.html, and folds in the chapter mirror
// that scripts/site/sync_chapters.sh performs.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const canonicalDir = join(repoRoot, "content", "babu-memoir", "chapters");
const statusFile = join(repoRoot, "content", "babu-memoir", "_system", "chapter-status.md");
const authoredPath = join(repoRoot, "site", "src", "content", "manifest.authored.json");
const publicChapters = join(repoRoot, "site", "public", "chapters");
const outPath = join(repoRoot, "site", "src", "content", "manifest.generated.json");

function countWords(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// Parse chapter-status.md into { filename -> STATUS } by scanning "### " blocks
// for a **File:** line and its **Status:** line.
function parseStatusMap(md) {
  const map = {};
  for (const block of md.split(/^###\s+/m)) {
    const file = block.match(/\*\*File:\*\*\s*([A-Za-z0-9._-]+\.txt)/);
    const status = block.match(/\*\*Status:\*\*\s*([A-Z ]+)/);
    if (file && status) map[file[1].trim()] = status[1].trim();
  }
  return map;
}

// Map a chapter-status.md status string to the manifest's status + locked.
function resolveStatus(rawStatus, hasFile) {
  if (!hasFile) return { status: "planned", locked: false };
  const s = (rawStatus || "").toUpperCase();
  if (s.includes("LOCKED") || s.includes("COMPLETE")) return { status: "locked", locked: true };
  if (s.includes("IN PROGRESS")) return { status: "active", locked: false };
  return { status: "active", locked: false };
}

function main() {
  const authored = JSON.parse(readFileSync(authoredPath, "utf8"));
  const statusMap = existsSync(statusFile) ? parseStatusMap(readFileSync(statusFile, "utf8")) : {};

  mkdirSync(publicChapters, { recursive: true });

  const chapters = authored.chapters.map((ch) => {
    const filename = `${ch.id}-${ch.slug}.txt`;
    const canonicalPath = join(canonicalDir, filename);
    const hasFile = existsSync(canonicalPath);

    let words = 0;
    let file = null;
    if (hasFile) {
      const text = readFileSync(canonicalPath, "utf8");
      words = countWords(text);
      copyFileSync(canonicalPath, join(publicChapters, filename)); // mirror for runtime fetch
      file = `chapters/${filename}`;
    }

    const { status, locked } = resolveStatus(statusMap[filename], hasFile);
    const { _comment, ...rest } = ch;
    return { ...rest, file, words, status, locked };
  });

  const manifest = { title: authored.title, generatedAt: null, chapters };
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");

  const locked = chapters.filter((c) => c.locked).map((c) => c.id).join(", ");
  console.log(
    `[build-manifest] ${chapters.length} chapters → ${outPath.replace(repoRoot + "/", "")} ` +
      `(locked: ${locked || "none"}; mirrored ${chapters.filter((c) => c.file).length} .txt)`,
  );
}

main();
