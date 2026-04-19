// tag-corpus.js — cross-trip tag corpus with write-path invalidation (D5, D6).
// Scans all trips/*/trip.yaml `dayoneTags[]` on first call, builds a frequency
// map, and caches it in module scope. Invalidated on write-success when a trip
// save touches dayoneTags.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TRIPS_DIR } from "./receipts.js";
import { normalizeTag } from "./tag-normalize.js";

/** @typedef {{ displayForm: string, count: number, lastUsedTripId: string, lastUsedAt: string }} CorpusEntry */

/** @type {Map<string, CorpusEntry> | null} */
let _corpus = null;

/**
 * Build the corpus by scanning every trip.yaml for dayoneTags[].
 * @returns {Promise<Map<string, CorpusEntry>>}
 */
async function buildCorpus() {
  const map = new Map();
  let entries;
  try {
    entries = await readdir(TRIPS_DIR, { withFileTypes: true });
  } catch {
    return map; // no trips dir yet
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const yamlPath = path.join(TRIPS_DIR, ent.name, "trip.yaml");
    let raw;
    try {
      raw = await readFile(yamlPath, "utf8");
    } catch {
      continue; // no trip.yaml
    }
    // Quick JSON extraction — trip.yaml is JSON wrapped in YAML front matter
    let obj;
    try {
      const body = raw.replace(/^---[\s\S]*?\n(?=[^#])/m, "").replace(/^#.*$/gm, "").trim();
      obj = JSON.parse(body);
    } catch {
      continue;
    }
    const tags = Array.isArray(obj.dayoneTags) ? obj.dayoneTags : [];
    const updatedAt = obj.updatedAt || obj.dates?.start || "";
    for (const tag of tags) {
      if (typeof tag !== "string" || !tag.trim()) continue;
      const norm = normalizeTag(tag);
      if (!norm) continue;
      const existing = map.get(norm);
      if (existing) {
        existing.count++;
        existing.lastUsedTripId = ent.name;
        if (updatedAt > existing.lastUsedAt) existing.lastUsedAt = updatedAt;
      } else {
        map.set(norm, {
          displayForm: tag.trim(),
          count: 1,
          lastUsedTripId: ent.name,
          lastUsedAt: updatedAt,
        });
      }
    }
  }
  return map;
}

/**
 * Get the full corpus map. Builds on first call, cached thereafter.
 * @returns {Promise<Map<string, CorpusEntry>>}
 */
export async function getCorpus() {
  if (!_corpus) _corpus = await buildCorpus();
  return _corpus;
}

/**
 * Get top N tags sorted by count descending.
 * @param {number} n
 * @returns {Promise<Array<{ normalized: string, displayForm: string, count: number }>>}
 */
export async function getTopN(n = 50) {
  const corpus = await getCorpus();
  return [...corpus.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([norm, entry]) => ({ normalized: norm, displayForm: entry.displayForm, count: entry.count }));
}

/**
 * Invalidate the corpus cache. Best-effort — never throws.
 * Hooked into trip-edit-ops write-success when a write touches /dayoneTags.
 */
export function invalidate() {
  _corpus = null;
}
