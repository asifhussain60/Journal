#!/usr/bin/env node
// validate-workflow-state.mjs — Phase 11 self-check.
//
// Asserts that server/src/lib/workflow-state.js and
// server/src/validators/placement-rules.js still mirror
// _workspace/ideas/trip-log-dor.md Decisions 2 and 5.
//
// What this validates:
//   1. Every legal transition in the DOR tables passes assertTransition.
//   2. Every illegal (from, to) pair for every field throws TransitionError.
//   3. Initial-state spread is accepted; any tampered field is rejected.
//   4. Each of Rules 5.1–5.7 has a happy-path row and a violation row,
//      and validatePlacement / predicates return the expected verdict.
//
// Exit 0 on full pass; 1 with specific reason on any gap.

import {
  TRANSITIONS,
  INITIAL_STATES,
  TransitionError,
  InitialStateError,
  assertTransition,
  assertInitial,
  applyInitialStates,
  legalTransitionsFor,
} from "../src/lib/workflow-state.js";

import {
  userPlacementSacred,
  ambiguousTripForcesUserSelection,
  ambiguousEventDayOnly,
  ambiguousDayUnsorted,
  deviceClockWithinTripRange,
  voiceBypassDeviceClock,
  userOverrideAtomic,
  validatePlacement,
} from "../src/validators/placement-rules.js";

import {
  SESSION_TRANSITIONS,
  SESSION_INITIAL_STATE,
  SessionTransitionError,
  SessionInitialStateError,
  assertSessionTransition,
  assertSessionInitial,
  legalSessionTransitionsFor,
  isSessionTerminal,
} from "../src/lib/session-state.js";

let failures = 0;
let checks = 0;

function fail(msg) {
  failures += 1;
  console.error(`FAIL: ${msg}`);
}
function pass() { checks += 1; }

function expectThrow(fn, errType, label) {
  try {
    fn();
    fail(`expected ${errType.name} for ${label} — did not throw`);
  } catch (err) {
    if (!(err instanceof errType)) {
      fail(`expected ${errType.name} for ${label} — got ${err?.name}: ${err?.message}`);
    } else {
      pass();
    }
  }
}

function expectOk(fn, label) {
  try {
    fn();
    pass();
  } catch (err) {
    fail(`${label} unexpectedly threw: ${err?.name}: ${err?.message}`);
  }
}

function expect(condition, label) {
  if (condition) pass();
  else fail(label);
}

// ----- 1. Transitions coverage ---------------------------------------------

const ALL_STATES_BY_FIELD = {};
for (const [field, table] of Object.entries(TRANSITIONS)) {
  const states = new Set(Object.keys(table));
  for (const set of Object.values(table)) {
    for (const to of set) states.add(to);
  }
  ALL_STATES_BY_FIELD[field] = [...states];
}

let legalCount = 0;
let illegalCount = 0;

for (const [field, table] of Object.entries(TRANSITIONS)) {
  const states = ALL_STATES_BY_FIELD[field];

  for (const [from, legalSet] of Object.entries(table)) {
    // Legal transitions must pass
    for (const to of legalSet) {
      expectOk(() => assertTransition(field, from, to), `legal ${field}: ${from} → ${to}`);
      legalCount += 1;
    }

    // Every other (from, to) pair must throw
    for (const to of states) {
      if (legalSet.has(to)) continue;
      expectThrow(() => assertTransition(field, from, to), TransitionError, `illegal ${field}: ${from} → ${to}`);
      illegalCount += 1;
    }
  }

  // Unknown states must throw
  expectThrow(() => assertTransition(field, "__nope__", states[0]), TransitionError, `unknown ${field}.from`);
  expectThrow(() => assertTransition("__nofield__", states[0], states[0]), TransitionError, `unknown field name`);
}

// legalTransitionsFor sanity
expect(
  legalTransitionsFor("ingestStatus", "captured").sort().join(",") === "failed,parsed",
  "legalTransitionsFor(ingestStatus, captured) matches DOR",
);

// ----- 2. Initial states ----------------------------------------------------

const fresh = applyInitialStates({ id: "x" });
expect(fresh.ingestStatus === "captured", "applyInitialStates sets ingestStatus");
expect(fresh.ynabStatus === "na", "applyInitialStates sets ynabStatus");
expectOk(() => assertInitial(fresh), "assertInitial accepts a freshly-spread row");

const tampered = { ...INITIAL_STATES, ingestStatus: "parsed" };
expectThrow(() => assertInitial(tampered), InitialStateError, "assertInitial rejects tampered row");

// ----- 3. Placement rule fixtures ------------------------------------------

// Rule 5.1 — user placement is sacred
const userPinned = { placement: { source: "user", dayIndex: 2, eventId: "evt_a" } };
expect(userPlacementSacred(userPinned, { placement: { source: "ai", dayIndex: 2, eventId: "evt_a" } }), "5.1 happy: update keeps coords");
expect(!userPlacementSacred(userPinned, { placement: { dayIndex: 3 } }), "5.1 violation: classifier changes dayIndex");

// Rule 5.2 — ambiguous trip forces user selection
expect(
  ambiguousTripForcesUserSelection({ tripSlug: null, placementStatus: "unplaced", placement: { source: "unsorted" } }),
  "5.2 happy: null tripSlug + unsorted",
);
expect(
  !ambiguousTripForcesUserSelection({ tripSlug: null, placementStatus: "proposed", placement: { source: "ai" } }),
  "5.2 violation: null tripSlug but auto-placed",
);

// Rule 5.3 — ambiguous event → day-only
expect(
  ambiguousEventDayOnly({ dayIndex: 3, dayConfidence: 0.8, eventConfidence: 0.5 }),
  "5.3 happy: day known, event ambiguous, no eventId",
);
expect(
  !ambiguousEventDayOnly({ dayIndex: 3, eventId: "evt_x", dayConfidence: 0.8, eventConfidence: 0.5 }),
  "5.3 violation: guessed eventId below 0.70",
);

// Rule 5.4 — ambiguous day → unsorted
expect(
  ambiguousDayUnsorted({ dayConfidence: 0.3, placementStatus: "unplaced", placement: { source: "unsorted" } }),
  "5.4 happy: low day conf + unsorted",
);
expect(
  !ambiguousDayUnsorted({ dayIndex: 2, dayConfidence: 0.3, placementStatus: "proposed", placement: { source: "ai" } }),
  "5.4 violation: guessed day below 0.50",
);

// Rule 5.5 — device clock inside trip range
const trip = { dates: { start: "2026-05-12", end: "2026-05-18" } };
expect(
  deviceClockWithinTripRange(
    { placement: { source: "device-clock" }, capturedAt: "2026-05-14T10:00:00Z" },
    trip,
  ),
  "5.5 happy: capturedAt inside trip",
);
expect(
  !deviceClockWithinTripRange(
    { placement: { source: "device-clock" }, capturedAt: "2026-06-01T10:00:00Z" },
    trip,
  ),
  "5.5 violation: capturedAt outside trip",
);

// Rule 5.6 — voice bypasses device-clock
expect(voiceBypassDeviceClock({ kind: "voice", placement: { source: "user" } }), "5.6 happy: voice w/ user placement");
expect(!voiceBypassDeviceClock({ kind: "voice", placement: { source: "device-clock" } }), "5.6 violation: voice w/ device-clock");

// Rule 5.7 — atomic user override
expect(userOverrideAtomic({ placement: { source: "user" }, placementStatus: "confirmed" }), "5.7 happy: both set together");
expect(!userOverrideAtomic({ placement: { source: "user" }, placementStatus: "proposed" }), "5.7 violation: user source w/o confirmed");
expect(!userOverrideAtomic({ placement: { source: null }, placementStatus: "confirmed" }), "5.7 violation: confirmed w/o source");

// Composite validator — clean row should pass
const cleanRow = {
  tripSlug: "2026-05-engagement",
  kind: "photo",
  capturedAt: "2026-05-14T10:00:00Z",
  placementStatus: "confirmed",
  placement: { source: "exif", dayIndex: 2 },
};
const cleanResult = validatePlacement(cleanRow, trip);
expect(cleanResult.valid, `validatePlacement clean row: ${JSON.stringify(cleanResult.errors)}`);

// Composite validator — violation row should surface the rule
const dirtyRow = {
  tripSlug: "2026-05-engagement",
  kind: "voice",
  capturedAt: "2026-05-14T10:00:00Z",
  placementStatus: "proposed",
  placement: { source: "device-clock" },
};
const dirtyResult = validatePlacement(dirtyRow, trip);
expect(!dirtyResult.valid, "validatePlacement dirty row returns invalid");
expect(dirtyResult.errors.some((e) => e.rule === "5.6"), "validatePlacement surfaces 5.6");

// ----- 4. Session state machine (Phase 11d Decision 5) --------------------

const SESSION_STATES = new Set(Object.keys(SESSION_TRANSITIONS));
for (const set of Object.values(SESSION_TRANSITIONS)) {
  for (const to of set) SESSION_STATES.add(to);
}

let sessionLegal = 0;
let sessionIllegal = 0;

for (const [from, legalSet] of Object.entries(SESSION_TRANSITIONS)) {
  for (const to of legalSet) {
    expectOk(() => assertSessionTransition(from, to), `legal session: ${from} → ${to}`);
    sessionLegal += 1;
  }
  for (const to of SESSION_STATES) {
    if (legalSet.has(to)) continue;
    expectThrow(() => assertSessionTransition(from, to), SessionTransitionError, `illegal session: ${from} → ${to}`);
    sessionIllegal += 1;
  }
}

// Unknown-state handling
expectThrow(() => assertSessionTransition("__nope__", "drafting"), SessionTransitionError, "unknown session.from");

// legalSessionTransitionsFor sanity
expect(
  legalSessionTransitionsFor("drafting").sort().join(",") === "abandoned,composing",
  "legalSessionTransitionsFor(drafting) matches DOR",
);

// Terminal detection
expect(isSessionTerminal("published"), "published is terminal");
expect(isSessionTerminal("abandoned"), "abandoned is terminal");
expect(!isSessionTerminal("drafting"), "drafting is not terminal");
expect(!isSessionTerminal("publishing"), "publishing is not terminal");

// Initial state
expectOk(() => assertSessionInitial({ status: SESSION_INITIAL_STATE }), "assertSessionInitial accepts drafting");
expectThrow(() => assertSessionInitial({ status: "composing" }), SessionInitialStateError, "assertSessionInitial rejects non-drafting");
expectThrow(() => assertSessionInitial({}), SessionInitialStateError, "assertSessionInitial rejects missing status");

// ----- Summary -------------------------------------------------------------

if (failures > 0) {
  console.error(`\nvalidate-workflow-state FAIL — ${failures} failure(s), ${checks} check(s) passed`);
  process.exit(1);
}

console.log("validate-workflow-state OK");
console.log(`  transitions:     ${legalCount} legal + ${illegalCount} illegal rejected`);
console.log(`  initial-state:   applyInitialStates + assertInitial verified`);
console.log(`  placement rules: 5.1–5.7 happy + violation fixtures verified`);
console.log(`  session states:  ${sessionLegal} legal + ${sessionIllegal} illegal rejected; initial + terminal verified`);
console.log(`  total checks:    ${checks}`);
process.exit(0);
