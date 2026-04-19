// receipts.js — Phase 4 (§6.8) receipt pipeline helpers.
//
// Responsibilities:
//   - MIME sniffing on uploaded buffers (don't trust Content-Type alone).
//   - Active trip slug resolution from trips/manifest.json.
//   - Atomic append to a trip's queue file (temp-rename for crash safety).
//   - macOS Vision OCR invocation with graceful fallback when swift is missing.

import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const TRIPS_DIR = path.join(REPO_ROOT, "trips");
export const MANIFEST_PATH = path.join(TRIPS_DIR, "manifest.json");
const OCR_SCRIPT = path.resolve(__dirname, "../../scripts/mac-vision-ocr.swift");

const IMAGE_SNIFFS = [
  { ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    ext: "webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    ext: "heic",
    test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  },
];

/** Return the sniffed image extension, or null if the buffer is not a known image. */
export function sniffImageExt(buf) {
  if (!buf || buf.length < 12) return null;
  for (const { ext, test } of IMAGE_SNIFFS) {
    if (test(buf)) return ext;
  }
  return null;
}

/** Anthropic vision supports only this set. Anything else (e.g. HEIC from
 *  iPhone) must be skipped or converted before sending. */
export const VISION_SUPPORTED_EXTS = ["jpg", "png", "gif", "webp"];

/** Map a vision-supported sniffed ext to an Anthropic media_type. Returns
 *  null for formats Anthropic cannot ingest — caller should skip vision. */
export function extToMediaType(ext) {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

/** Read trips/manifest.json and return the active trip slug. Throws if missing. */
export async function getActiveTripSlug() {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(raw);
  const slug = manifest?.active?.slug;
  if (typeof slug !== "string" || !slug.length) {
    throw new Error("manifest.json has no active.slug");
  }
  return slug;
}

/** Crash-safe write: temp file + rename. The tmp suffix carries a per-call
 *  UUID so two concurrent writers never clobber each other's staging file. */
export async function atomicWriteJSON(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, filePath);
}

/** Per-path mutex chain so read-modify-write helpers don't race when called
 *  concurrently. Keyed by absolute file path; the chain dissolves once its
 *  last waiter settles so the map doesn't grow unbounded. */
const _writeChains = new Map();
function withFileLock(filePath, work) {
  const prev = _writeChains.get(filePath) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(work);
  _writeChains.set(filePath, next);
  next.finally(() => {
    if (_writeChains.get(filePath) === next) _writeChains.delete(filePath);
  });
  return next;
}

/** Append one row to trips/{slug}/{name}.json. Creates the file if absent.
 *  Guarded by a per-file mutex so concurrent callers don't lose rows via a
 *  read-modify-write race (e.g. multi-photo library uploads). */
export async function appendQueueRow(slug, name, row) {
  const filePath = path.join(TRIPS_DIR, slug, `${name}.json`);
  return withFileLock(filePath, async () => {
    let items = [];
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
      else if (Array.isArray(parsed?.items)) items = parsed.items;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    items.push(row);
    await atomicWriteJSON(filePath, items);
    return { filePath, count: items.length };
  });
}

/** Read trips/{slug}/{name}.json. Returns [] when file missing. */
export async function readQueue(slug, name) {
  const filePath = path.join(TRIPS_DIR, slug, `${name}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
    return [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** True if the swift CLI + Vision script are usable on this host. */
let cachedSwiftAvailable = null;
export async function isSwiftAvailable() {
  if (cachedSwiftAvailable !== null) return cachedSwiftAvailable;
  try {
    await execFileP("swift", ["--version"], { timeout: 3000 });
    await stat(OCR_SCRIPT);
    cachedSwiftAvailable = true;
  } catch {
    cachedSwiftAvailable = false;
  }
  return cachedSwiftAvailable;
}

/**
 * Run macOS Vision OCR on an image file. Returns the recognized text (may be
 * empty string if no text found) or null if Vision is unavailable / errored.
 */
export async function macVisionOcr(imagePath) {
  if (!(await isSwiftAvailable())) return null;
  try {
    const { stdout } = await execFileP("swift", [OCR_SCRIPT, imagePath], {
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}
