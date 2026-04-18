// lib/workflow-state.js — Phase 11 state-machine assertions.
//
// Source of truth: _workspace/ideas/trip-log-dor.md Decision 2 (lines 254–315).
// Any change here that isn't mirrored in the DOR is a drift bug.
//
// Convention: THROWS on illegal input. Transitions are programmer invariants,
// not user input — a bad transition is a bug and should crash loudly. This
// deliberately diverges from server/src/validators/* which accumulate errors.

const FIELDS = ["ingestStatus", "placementStatus", "reviewStatus", "journalStatus", "ynabStatus"];

// Per-field legal transitions lifted from DOR Decision 2 state diagrams.
// A terminal state maps to an empty set. Self-loops are explicit.
export const TRANSITIONS = Object.freeze({
  // ingestStatus — write-path state of the raw capture (DOR 258–266)
  ingestStatus: Object.freeze({
    captured: new Set(["parsed", "failed"]),
    parsed:   new Set(),
    failed:   new Set(["captured"]),
  }),

  // placementStatus — where the row is pinned (DOR 268–277).
  // confirmed → confirmed is an explicit self-loop (user reassign).
  placementStatus: Object.freeze({
    unplaced:  new Set(["proposed", "confirmed"]),
    proposed:  new Set(["confirmed"]),
    confirmed: new Set(["confirmed"]),
  }),

  // reviewStatus — has the user processed the row (DOR 279–290)
  reviewStatus: Object.freeze({
    unreviewed: new Set(["in_review", "approved"]),
    in_review:  new Set(["approved", "rejected"]),
    approved:   new Set(),
    rejected:   new Set(["unreviewed"]),
  }),

  // journalStatus — DayOne publish lifecycle (DOR 292–302).
  // draft → none covers the "Publish initiated, pending-confirm flag set" step;
  // none → published covers the pending-confirm resolution. published is terminal.
  journalStatus: Object.freeze({
    none:      new Set(["draft", "published"]),
    draft:     new Set(["none"]),
    published: new Set(),
  }),

  // ynabStatus — expense sync lifecycle (DOR 304–314)
  ynabStatus: Object.freeze({
    na:        new Set(["candidate"]),
    candidate: new Set(["approved", "na"]),
    approved:  new Set(["synced", "failed"]),
    synced:    new Set(),
    failed:    new Set(["approved"]),
  }),
});

// Initial write values (DOR Decision 2 "writer" column, App-on-write start states).
// Asserted by assertInitial(row) when a route first persists a capture.
export const INITIAL_STATES = Object.freeze({
  ingestStatus:    "captured",
  placementStatus: "unplaced",
  reviewStatus:    "unreviewed",
  journalStatus:   "none",
  ynabStatus:      "na",
});

export class TransitionError extends Error {
  constructor({ field, from, to, legal }) {
    super(`illegal ${field} transition: ${from} → ${to} (legal: ${legal.join(", ") || "none (terminal)"})`);
    this.name = "TransitionError";
    this.field = field;
    this.from = from;
    this.to = to;
    this.legal = legal;
  }
}

export class InitialStateError extends Error {
  constructor({ field, expected, actual }) {
    super(`initial ${field} must be "${expected}" but row has "${actual}"`);
    this.name = "InitialStateError";
    this.field = field;
    this.expected = expected;
    this.actual = actual;
  }
}

function legalSet(field, from) {
  const table = TRANSITIONS[field];
  if (!table) throw new TransitionError({ field, from, to: "", legal: [] });
  const set = table[from];
  if (!set) throw new TransitionError({ field, from, to: "", legal: [] });
  return set;
}

export function assertTransition(field, from, to) {
  const set = legalSet(field, from);
  if (!set.has(to)) {
    throw new TransitionError({ field, from, to, legal: [...set] });
  }
}

export function legalTransitionsFor(field, from) {
  return [...legalSet(field, from)];
}

// Spread onto a new-capture row before persisting. Pair with assertInitial
// as belt-and-suspenders (the spread puts the right values in; the assert
// verifies nothing else upstream overwrote them).
export function applyInitialStates(row) {
  return Object.assign(row, INITIAL_STATES);
}

export function assertInitial(row) {
  for (const field of FIELDS) {
    const expected = INITIAL_STATES[field];
    const actual = row[field];
    if (actual !== expected) {
      throw new InitialStateError({ field, expected, actual });
    }
  }
}
