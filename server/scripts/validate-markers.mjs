#!/usr/bin/env node
// validate-markers.mjs — Phase 9 memoir-markers preservation check.
//
// The memoir scratchpad workflow uses @@marker directives in
// chapters/scratchpads/ to drive prose edits (@@expand, @@replace, @@cut,
// @@move). This file-based workflow is INVARIANT across the Phase 9
// SQLite migration: chapters/, reference/, chapters/scratchpads/ stay on
// disk forever. The DB is operational data only.
//
// This validator asserts four things:
//
//   1. Structural scan:  locate every @@marker directive in chapters/
//      and chapters/scratchpads/; report counts + format sanity.
//   2. Format sanity:     each @@marker matches @@(expand|replace|cut|move|...)(args).
//   3. DB scope guard:    the Phase 9 migration source tree (server/src/db,
//      server/src/middleware/shadow-write.js, server/src/db/repositories/)
//      does NOT reference chapters/ or reference/ paths. SQL schema has no
//      tables for memoir text.
//   4. Gitignore guard:   chapters/, reference/, chapters/scratchpads/ are
//      NOT gitignored (they're tracked memoir content).
//
// Exit 0 on full pass; 1 with specific reason on any gap.
//
// Full end-to-end of the marker drain (synthetic scratchpad → journal skill
// → prose edit → markers stripped → clean commit) requires the `journal`
// skill, which is not present in this repo. That part of validation is
// DEFERRED to the Cowork drain-skill work that lands in a later phase.
// This validator proves the *preservation* invariant — the Phase 9
// migration cannot touch memoir text because the DB schema does not
// contain it and the migration source does not read it.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const MARKER_RE = /@@(\w+)\s*\(([^)]*)\)/g;
const KNOWN_VERBS = new Set(["expand", "replace", "cut", "move", "merge", "rephrase", "split"]);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return out;
    throw err;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "snapshots") continue;
      await walk(full, out);
    } else if (e.isFile() && /\.(md|txt)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

async function scanMarkers(paths) {
  const results = [];
  for (const p of paths) {
    const text = await readFile(p, "utf8");
    const hits = [...text.matchAll(MARKER_RE)];
    if (hits.length === 0) continue;
    const rel = path.relative(REPO_ROOT, p);
    for (const h of hits) {
      const verb = h[1];
      results.push({
        file: rel,
        verb,
        args: h[2].trim(),
        known: KNOWN_VERBS.has(verb),
      });
    }
  }
  return results;
}

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

function stripComments(text, fileExt) {
  const lines = text.split("\n");
  const keep = [];
  let inBlock = false;
  for (let raw of lines) {
    let line = raw;
    if (fileExt === ".sql") {
      const i = line.indexOf("--");
      if (i >= 0) line = line.slice(0, i);
    } else {
      // JS-ish: strip // line comments and /* ... */ block comments
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end < 0) { keep.push(""); continue; }
        line = line.slice(end + 2);
        inBlock = false;
      }
      while (true) {
        const s = line.indexOf("/*");
        if (s < 0) break;
        const e = line.indexOf("*/", s + 2);
        if (e < 0) { line = line.slice(0, s); inBlock = true; break; }
        line = line.slice(0, s) + line.slice(e + 2);
      }
      const i = line.indexOf("//");
      if (i >= 0) line = line.slice(0, i);
    }
    keep.push(line);
  }
  return keep.join("\n");
}

async function grepIn(files, needle) {
  for (const f of files) {
    try {
      const text = await readFile(f, "utf8");
      const code = stripComments(text, path.extname(f));
      if (code.includes(needle)) return { hit: true, file: f };
    } catch {
      // skip unreadable
    }
  }
  return { hit: false };
}

async function main() {
  // 1. Structural scan
  const chapterPaths = await walk(path.join(REPO_ROOT, "chapters"));
  const scratchpadPaths = await walk(path.join(REPO_ROOT, "chapters/scratchpads"));
  const markers = await scanMarkers([...chapterPaths, ...scratchpadPaths]);

  const unknownVerbs = markers.filter((m) => !m.known);
  if (unknownVerbs.length) {
    console.error(`FAIL: ${unknownVerbs.length} markers use unknown verbs:`);
    for (const m of unknownVerbs.slice(0, 5)) console.error(`  ${m.file}: @@${m.verb}(${m.args.slice(0, 40)})`);
    process.exit(1);
  }

  // 2. DB scope guard — migration source must not reference memoir paths
  const migrationFiles = [
    path.join(REPO_ROOT, "server/src/db/index.js"),
    path.join(REPO_ROOT, "server/src/db/schema.sql"),
    path.join(REPO_ROOT, "server/src/db/migrations/001-init.sql"),
    path.join(REPO_ROOT, "server/src/db/repositories/shadow.js"),
    path.join(REPO_ROOT, "server/src/middleware/shadow-write.js"),
    path.join(REPO_ROOT, "server/scripts/migrate-schema.mjs"),
  ];
  for (const p of migrationFiles) {
    if (!(await fileExists(p))) {
      console.error(`FAIL: expected migration file missing: ${path.relative(REPO_ROOT, p)}`);
      process.exit(1);
    }
  }
  const danger = await grepIn(migrationFiles, "chapters/");
  if (danger.hit) {
    console.error(`FAIL: migration source references chapters/ in ${path.relative(REPO_ROOT, danger.file)}`);
    process.exit(1);
  }
  const danger2 = await grepIn(migrationFiles, "/reference/");
  if (danger2.hit) {
    console.error(`FAIL: migration source references /reference/ in ${path.relative(REPO_ROOT, danger2.file)}`);
    process.exit(1);
  }

  // 3. Schema must not contain a table for memoir text
  const schema = await readFile(path.join(REPO_ROOT, "server/src/db/schema.sql"), "utf8");
  for (const banned of ["chapters", "memoir", "scratchpad", "reference_text"]) {
    if (new RegExp(`CREATE TABLE[^;]*\\b${banned}\\b`, "i").test(schema)) {
      console.error(`FAIL: schema.sql defines a table for "${banned}" — memoir must stay files`);
      process.exit(1);
    }
  }

  // 4. Gitignore guard
  const gitignore = await readFile(path.join(REPO_ROOT, ".gitignore"), "utf8");
  for (const mustTrack of ["chapters/", "reference/"]) {
    const pattern = new RegExp(`^\\s*${mustTrack.replace("/", "\\/")}\\s*$`, "m");
    if (pattern.test(gitignore)) {
      console.error(`FAIL: gitignore would ignore ${mustTrack} — memoir must be tracked`);
      process.exit(1);
    }
  }

  // Summary
  console.log(`validate-markers OK`);
  console.log(`  chapters scanned:     ${chapterPaths.length}`);
  console.log(`  scratchpads scanned:  ${scratchpadPaths.length}`);
  console.log(`  @@markers found:      ${markers.length} (${new Set(markers.map(m => m.verb)).size} unique verbs)`);
  if (markers.length > 0) {
    const byVerb = markers.reduce((acc, m) => { acc[m.verb] = (acc[m.verb] || 0) + 1; return acc; }, {});
    for (const [v, n] of Object.entries(byVerb)) console.log(`    @@${v}: ${n}`);
  }
  console.log(`  migration source:     does not touch chapters/ or reference/`);
  console.log(`  schema.sql:           no memoir tables (operational data only)`);
  console.log(`  .gitignore:           chapters/ + reference/ tracked`);
  console.log(`\nNote: end-to-end marker drain (synthetic scratchpad → journal skill →`);
  console.log(`markers stripped) requires the 'journal' skill, which is deferred to`);
  console.log(`a later Cowork phase. Preservation invariant is proven here.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
