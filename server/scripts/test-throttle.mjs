#!/usr/bin/env node
// test-throttle.mjs — Phase 8 Gate D/E server-side verification.
//
// Exercises the throttle-budget middleware with a mocked summaryFn so we can
// assert soft/hard behavior without mutating the real usage.jsonl.
//
// Run:  node scripts/test-throttle.mjs
// Prints: "throttle OK (N assertions)" on success.

import assert from "node:assert/strict";
import { throttleBudget, classifyPath } from "../src/middleware/throttle-budget.js";

function makeReq(method, path) {
  return { method, path };
}

function makeRes() {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return res;
}

async function runOne({ state, method, path }) {
  const mw = throttleBudget({ summaryFn: async () => ({ throttleState: state, spentThisMonth: 0, monthlyCAP: 50 }) });
  const req = makeReq(method, path);
  const res = makeRes();
  let called = false;
  await mw(req, res, () => { called = true; });
  return { res, called };
}

let count = 0;
function check(label, cond) {
  count += 1;
  if (!cond) { console.error(`FAIL: ${label}`); process.exit(1); }
}

// Path classification
check("classifyPath health essential", classifyPath("GET", "/health") === "essential");
check("classifyPath usage/summary essential", classifyPath("GET", "/api/usage/summary") === "essential");
check("classifyPath tier-0 reference essential", classifyPath("GET", "/api/reference-data/tipping") === "essential");
check("classifyPath GET queue essential", classifyPath("GET", "/api/queue/pending") === "essential");
check("classifyPath GET edit-log essential", classifyPath("GET", "/api/edit-log") === "essential");
check("classifyPath trip-edit edit", classifyPath("POST", "/api/trip-edit") === "edit");
check("classifyPath trip-edit/revert edit", classifyPath("POST", "/api/trip-edit/revert") === "edit");
check("classifyPath trip-qa expensive", classifyPath("POST", "/api/trip-qa") === "expensive");
check("classifyPath extract-receipt expensive", classifyPath("POST", "/api/extract-receipt") === "expensive");
check("classifyPath queue POST other", classifyPath("POST", "/api/queue/pending") === "other");

// Normal state — everything passes, header set
for (const [method, path] of [["GET", "/health"], ["POST", "/api/trip-edit"], ["POST", "/api/trip-qa"], ["POST", "/api/queue/pending"]]) {
  const { res, called } = await runOne({ state: "normal", method, path });
  check(`normal ${method} ${path} passes`, called && res.headers["X-Budget-State"] === "normal");
}

// Soft state — edit downgraded, essential passes, expensive passes with header
{
  const { res, called } = await runOne({ state: "soft", method: "POST", path: "/api/trip-edit" });
  check("soft POST /api/trip-edit downgraded (not called)", !called && res.statusCode === 200);
  check("soft edit body throttled=true", res.body && res.body.throttled === true && res.body.intent === "qa");
  check("soft edit header", res.headers["X-Budget-State"] === "soft");
}
{
  const { called, res } = await runOne({ state: "soft", method: "POST", path: "/api/trip-qa" });
  check("soft POST /api/trip-qa passes (warn via header)", called && res.headers["X-Budget-State"] === "soft");
}
{
  const { called } = await runOne({ state: "soft", method: "GET", path: "/api/reference-data/tipping" });
  check("soft tier-0 reference passes", called);
}
{
  const { called } = await runOne({ state: "soft", method: "GET", path: "/health" });
  check("soft /health passes", called);
}

// Hard state — expensive + edit denied, essentials pass
{
  const { res, called } = await runOne({ state: "hard", method: "POST", path: "/api/trip-edit" });
  check("hard POST /api/trip-edit 429", !called && res.statusCode === 429);
  check("hard edit body throttled=true", res.body && res.body.throttled === true && res.body.throttleState === "hard");
}
{
  const { res, called } = await runOne({ state: "hard", method: "POST", path: "/api/trip-qa" });
  check("hard POST /api/trip-qa 429", !called && res.statusCode === 429);
}
{
  const { called } = await runOne({ state: "hard", method: "GET", path: "/health" });
  check("hard /health passes", called);
}
{
  const { called } = await runOne({ state: "hard", method: "GET", path: "/api/reference-data/currency" });
  check("hard tier-0 reference passes", called);
}
{
  const { called } = await runOne({ state: "hard", method: "GET", path: "/api/queue/pending" });
  check("hard GET queue passes", called);
}
{
  const { called } = await runOne({ state: "hard", method: "POST", path: "/api/queue/voice-inbox" });
  check("hard POST queue passes (capture never blocked)", called);
}

console.log(`throttle OK (${count} assertions)`);
