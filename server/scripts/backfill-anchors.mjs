#!/usr/bin/env node
// scripts/backfill-anchors.mjs — one-shot migration for the drag-reorder feature.
//
// Walks trips/{slug}/trip.yaml and fills:
//   - time_mode:       "anchor" for TRAVEL/EVENT/CELEBRATION tags, else "flex"
//   - lat/lng/place_id/geocoded_at:  via ORS geocoding (optional, --geocode flag)
//
// Writes DIRECTLY to trip.yaml via serializeTripObj (bypasses edit-log).
// This is intentional — migrations should not pollute the edit-log with
// one event per field. A single "migration: anchor+geocode backfill" row
// is appended at the end.
//
// Usage:
//   node scripts/backfill-anchors.mjs --trip {slug}          # time_mode only
//   node scripts/backfill-anchors.mjs --trip {slug} --geocode  # + geocode venues
//   node scripts/backfill-anchors.mjs --all --geocode          # every trip
//   node scripts/backfill-anchors.mjs --trip {slug} --dry-run  # show plan

import "node:process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Load .env before touching anything that reads process.env.
// Node doesn't auto-load it for scripts (only `npm start` via --env-file).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { readTripObj, serializeTripObj, tripYamlPath, editLogPath, appendEditLog } =
  await import("../src/lib/trip-edit-ops.js");
const { geocode } = await import("../src/lib/ors.js");

const ANCHOR_TAGS = new Set(["TRAVEL", "EVENT", "CELEBRATION"]);

function parseArgs(argv) {
  const args = { trip: null, all: false, geocode: false, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--trip") args.trip = argv[++i];
    else if (a === "--all") args.all = true;
    else if (a === "--geocode") args.geocode = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  node scripts/backfill-anchors.mjs --trip {slug} [--geocode] [--dry-run]
  node scripts/backfill-anchors.mjs --all [--geocode] [--dry-run]`);
      process.exit(0);
    }
  }
  return args;
}

async function listTripSlugs() {
  const tripsDir = path.join(__dirname, "..", "..", "trips");
  const entries = await readdir(tripsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

// A rough default focus point for geocoder biasing when a trip has no
// anchor coords yet. Pick the FIRST event's venue, geocode it unbiased,
// and use that as the focus for subsequent events.
async function seedFocus(trip) {
  const firstEv = trip?.days?.[0]?.events?.[0];
  if (!firstEv?.venue) return null;
  const g = await geocode(firstEv.venue, { size: 1 });
  if (g.ok && g.candidates.length) {
    const c = g.candidates[0];
    return { lat: c.lat, lng: c.lng };
  }
  return null;
}

async function backfillTrip(slug, opts) {
  const trip = await readTripObj(slug);
  if (!trip?.days?.length) {
    console.log(`[${slug}] no days — skip`);
    return { changed: false };
  }

  const now = new Date().toISOString();
  let focus = null;
  let anchorsSet = 0;
  let venuesGeocoded = 0;
  let venuesFailed = 0;

  for (const [di, day] of trip.days.entries()) {
    if (!Array.isArray(day?.events)) continue;
    for (const [ei, ev] of day.events.entries()) {
      // 1. time_mode backfill (idempotent — only set if missing)
      if (!ev.time_mode) {
        const tag = typeof ev.tag === "string" ? ev.tag.toUpperCase() : "";
        ev.time_mode = ANCHOR_TAGS.has(tag) ? "anchor" : "flex";
        anchorsSet += 1;
      }

      // 2. geocode backfill (idempotent — skip if coords already present)
      if (opts.geocode && typeof ev.venue === "string" && ev.venue.trim()) {
        if (Number.isFinite(ev.lat) && Number.isFinite(ev.lng)) continue;
        if (!focus) focus = await seedFocus(trip);
        const g = await geocode(ev.venue, { focus, size: 1 });
        if (g.ok && g.candidates.length) {
          const top = g.candidates[0];
          ev.lat = top.lat;
          ev.lng = top.lng;
          ev.place_id = top.place_id;
          ev.geocoded_at = now;
          venuesGeocoded += 1;
          if (!focus) focus = { lat: top.lat, lng: top.lng }; // lock in first hit
          // Gentle pacing so ORS free tier is happy.
          await new Promise((r) => setTimeout(r, 120));
        } else {
          venuesFailed += 1;
          console.warn(`  [${slug}] day ${di + 1} evt ${ei + 1} venue="${ev.venue}" → geocode failed: ${g.error ?? "no_results"}`);
        }
      }
    }
  }

  const summary = { anchorsSet, venuesGeocoded, venuesFailed };
  if (opts.dryRun) {
    console.log(`[${slug}] DRY RUN — would change: ${JSON.stringify(summary)}`);
    return { changed: false, summary };
  }

  if (anchorsSet === 0 && venuesGeocoded === 0) {
    console.log(`[${slug}] already up to date`);
    return { changed: false, summary };
  }

  const target = tripYamlPath(slug);
  const nextYaml = serializeTripObj(trip);
  await writeFile(target + ".tmp", nextYaml, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(target + ".tmp", target);

  await appendEditLog(slug, {
    schemaVersion: "1",
    id: randomUUID(),
    createdAt: now,
    tripSlug: slug,
    target: "trip.yaml",
    intent: `backfill: anchors${opts.geocode ? " + geocode" : ""}`,
    summary,
    actor: "migration",
    status: "applied",
  });

  console.log(`[${slug}] wrote ${JSON.stringify(summary)}`);
  return { changed: true, summary };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.trip && !args.all) {
    console.error("Must pass --trip {slug} or --all. Use --help for usage.");
    process.exit(1);
  }
  if (args.geocode && !process.env.ORS_API_KEY) {
    console.error("--geocode requires ORS_API_KEY in server/.env");
    process.exit(1);
  }

  const slugs = args.all ? await listTripSlugs() : [args.trip];
  let totalChanged = 0;
  for (const slug of slugs) {
    try {
      const { changed } = await backfillTrip(slug, args);
      if (changed) totalChanged += 1;
    } catch (err) {
      console.error(`[${slug}] ERROR:`, err.message);
    }
  }
  console.log(`\nDone. ${totalChanged}/${slugs.length} trip(s) changed.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
