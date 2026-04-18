// lib/session-state.js — Phase 11d PublishSession state machine.
//
// Source of truth: _workspace/ideas/phase-11d-publish-workspace/00-dor.md
// Decision 5 (lines 196–231). Any change here that isn't mirrored in the DOR
// is a drift bug.
//
// Companion to lib/workflow-state.js: that file governs per-field state on
// LogEntry rows; this file governs whole-entity state on PublishSession.
// One self-check script (scripts/validate-workflow-state.mjs) exercises both.
//
// Convention: THROWS on illegal input. A bad session transition is a bug
// in the route or caller, not user input — crash loudly.

export const SESSION_INITIAL_STATE = "drafting";

// Legal transitions (DOR Decision 5, lines 200–213).
// Terminal states map to an empty set.
export const SESSION_TRANSITIONS = Object.freeze({
  drafting:   new Set(["composing", "abandoned"]),
  composing:  new Set(["reviewing", "drafting"]),      // drafting = AI failed
  reviewing:  new Set(["composing", "publishing", "abandoned"]),
  publishing: new Set(["published", "failed"]),
  failed:     new Set(["publishing", "abandoned"]),
  published:  new Set(),                                // terminal, immutable
  abandoned:  new Set(),                                // terminal, immutable
});

// Who is allowed to drive each transition. Enforced at the route layer
// (middleware), not here; this is informational — consumed by the self-check
// and by error messages surfaced to clients.
export const SESSION_TRANSITION_WRITERS = Object.freeze({
  "drafting→composing":   "user",    // POST /compose
  "drafting→abandoned":   "user",    // POST /abandon
  "composing→reviewing":  "server",  // compose route on AI ok
  "composing→drafting":   "server",  // compose route on AI fail
  "reviewing→composing":  "user",    // POST /compose (refine)
  "reviewing→publishing": "user",    // POST /publish
  "reviewing→abandoned":  "user",    // POST /abandon
  "publishing→published": "server",  // POST /confirm (after CLI ok)
  "publishing→failed":    "server",  // publish route on CLI fail
  "failed→publishing":    "user",    // retry
  "failed→abandoned":     "user",    // POST /abandon
});

export class SessionTransitionError extends Error {
  constructor({ from, to, legal }) {
    super(`illegal session transition: ${from} → ${to} (legal: ${legal.join(", ") || "none (terminal)"})`);
    this.name = "SessionTransitionError";
    this.from = from;
    this.to = to;
    this.legal = legal;
  }
}

export class SessionInitialStateError extends Error {
  constructor({ expected, actual }) {
    super(`initial session status must be "${expected}" but got "${actual}"`);
    this.name = "SessionInitialStateError";
    this.expected = expected;
    this.actual = actual;
  }
}

function legalSet(from) {
  const set = SESSION_TRANSITIONS[from];
  if (!set) throw new SessionTransitionError({ from, to: "", legal: [] });
  return set;
}

export function assertSessionTransition(from, to) {
  const set = legalSet(from);
  if (!set.has(to)) {
    throw new SessionTransitionError({ from, to, legal: [...set] });
  }
}

export function legalSessionTransitionsFor(from) {
  return [...legalSet(from)];
}

export function assertSessionInitial(session) {
  if (session?.status !== SESSION_INITIAL_STATE) {
    throw new SessionInitialStateError({
      expected: SESSION_INITIAL_STATE,
      actual: session?.status,
    });
  }
}

// Convenience: is this session in a terminal state? Callers use this to
// reject mutations (PATCH, compose, publish) without walking the table.
export function isSessionTerminal(status) {
  const set = SESSION_TRANSITIONS[status];
  return set instanceof Set && set.size === 0;
}
