#!/usr/bin/env node
// harass.mjs \u2014 Phase 1 rate-limit harassment check.
//
// Contract: for every non-/health endpoint, fire 21 requests in <60s and assert
// that the 21st response comes back with HTTP 429. Proves \u00a79.2 acceptance #7.
//
// Run against a running proxy: `npm run harass` (starts via `npm run start` in a
// separate terminal first). BASE defaults to http://127.0.0.1:3001.
//
// The script only hits endpoints with method + minimal safe body; it does NOT
// trigger any Anthropic API call when it can avoid it \u2014 /api/chat is called
// with a clearly malformed body so it 400s fast, which still counts against the
// per-endpoint rate-limit bucket. /api/voice-test is called with GET to keep it
// outside the real Claude call path while still sharing the same bucket (path
// is what keyGenerator keys on).

import process from "node:process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.HARASS_BASE ?? "http://127.0.0.1:3001";
const BURST = 21;
const BURST_WINDOW_MS = 30_000; // plenty of headroom under the 60s window

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE_PNG = path.join(REPO_ROOT, "server/src/schemas/__fixtures__/test-receipt.png");

// Endpoints to exercise for rate-limit. Each is { path, method, body? }.
const TARGETS = [
  { path: "/api/refine", method: "POST", body: {} },         // 400 fast, no Claude call
  { path: "/api/chat", method: "POST", body: {} },            // 400 fast, no Claude call
  { path: "/api/voice-test", method: "GET" },                  // 404 fast (POST-only), same bucket
  { path: "/api/queue/pending", method: "POST", body: {} },    // 400 fast (schemaVersion missing)
  { path: "/api/extract-receipt", method: "POST", body: {} },  // 400 fast (imagePath missing)
  { path: "/api/upload", method: "POST", body: {} },           // 400 fast (no multipart)
];

function fail(message) {
  process.stderr.write(`[harass] ${message}\n`);
  process.exit(1);
}

async function fireOne({ path, method, body }) {
  const started = Date.now();
  const init = {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  try {
    const res = await fetch(`${BASE}${path}`, init);
    return { status: res.status, ms: Date.now() - started };
  } catch (err) {
    fail(`network failure hitting ${method} ${path}: ${err.message}`);
  }
}

async function probe() {
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) fail(`/health did not return 2xx (got ${res.status})`);
  } catch (err) {
    fail(`proxy not reachable at ${BASE}: ${err.message}. Start with \`npm run start\` first.`);
  }
}

async function smoke() {
  // Upload happy path (single request — well under any rate limit).
  let pngBytes;
  try {
    pngBytes = await readFile(FIXTURE_PNG);
  } catch (err) {
    fail(`missing fixture ${FIXTURE_PNG}: ${err.message}`);
  }
  const form = new FormData();
  form.append("file", new Blob([pngBytes], { type: "image/png" }), "test-receipt.png");
  const upRes = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
  const upBody = await upRes.json().catch(() => ({}));
  if (!upRes.ok || upBody.ok === false || !upBody.imagePath) {
    fail(`upload smoke failed: status=${upRes.status} body=${JSON.stringify(upBody)}`);
  }
  const uploadedRel = upBody.imagePath;
  const uploadedAbs = path.join(REPO_ROOT, uploadedRel);

  // Queue POST happy path with a clearly-marked test row.
  const testId = `harass-smoke-${Date.now()}`;
  const row = {
    schemaVersion: "1",
    id: testId,
    createdAt: new Date().toISOString(),
    kind: "receipt",
    source: "test",
    status: "pending",
    memoryWorthy: false,
    payload: { merchant: "Harass Smoke", amount: 1, currency: "USD" },
  };
  const qpRes = await fetch(`${BASE}/api/queue/pending`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  const qpBody = await qpRes.json().catch(() => ({}));
  if (!qpRes.ok || qpBody.ok === false || qpBody.id !== testId) {
    fail(`queue POST smoke failed: status=${qpRes.status} body=${JSON.stringify(qpBody)}`);
  }

  // Queue GET confirms the row is visible.
  const qgRes = await fetch(`${BASE}/api/queue/pending`);
  const qgBody = await qgRes.json().catch(() => ({}));
  if (!qgRes.ok || !Array.isArray(qgBody.items) || !qgBody.items.some((it) => it.id === testId)) {
    fail(`queue GET smoke did not echo ${testId}`);
  }
  const tripSlug = qgBody.tripSlug;
  if (!tripSlug) fail("queue GET smoke missing tripSlug");

  // Cleanup — remove the test row and the uploaded PNG so /api/queue stays tidy.
  const queuePath = path.join(REPO_ROOT, "trips", tripSlug, "pending.json");
  try {
    const raw = await readFile(queuePath, "utf8");
    const parsed = JSON.parse(raw);
    const filtered = (Array.isArray(parsed) ? parsed : parsed.items || []).filter((it) => it.id !== testId);
    if (filtered.length === 0) {
      await unlink(queuePath).catch(() => {});
    } else {
      await writeFile(queuePath, JSON.stringify(filtered, null, 2) + "\n", "utf8");
    }
  } catch {
    // ignore — empty queue cleanup only
  }
  await unlink(uploadedAbs).catch(() => {});

  process.stdout.write(
    `OK smoke — upload(${uploadedRel}) + queue POST/GET (${testId}) round-trip + cleanup\n`
  );
}

async function run() {
  await probe();
  await smoke();
  const deadline = Date.now() + BURST_WINDOW_MS;

  for (const target of TARGETS) {
    const statuses = [];
    for (let i = 0; i < BURST; i += 1) {
      if (Date.now() > deadline) fail(`window exceeded while hitting ${target.path}`);
      // Fire sequentially so ordering is deterministic; total time is
      // dominated by server response latency, not by concurrency.
      // eslint-disable-next-line no-await-in-loop
      const { status } = await fireOne(target);
      statuses.push(status);
    }
    const last = statuses[statuses.length - 1];
    const count429 = statuses.filter((s) => s === 429).length;
    if (last !== 429) {
      fail(
        `expected HTTP 429 on the 21st ${target.method} ${target.path} request, got ${last}. ` +
          `Full status sequence: ${statuses.join(",")}`
      );
    }
    process.stdout.write(
      `OK ${target.method} ${target.path} \u2014 ${count429} of ${BURST} returned 429 (last=${last})\n`
    );
  }

  // /health must keep succeeding under pressure (skip rule in rate-limit.js).
  for (let i = 0; i < BURST; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) fail(`/health unexpectedly failed on request ${i + 1} (status ${res.status})`);
  }
  process.stdout.write(`OK /health \u2014 ${BURST} requests, all 2xx (rate-limit exemption confirmed)\n`);

  process.stdout.write("harass OK\n");
  process.exit(0);
}

run().catch((err) => fail(`unexpected failure: ${err.stack || err.message}`));
