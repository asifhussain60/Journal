// validators/placement-rules.js — Phase 11 placement invariants.
//
// Source of truth: _workspace/ideas/trip-log-dor.md Decision 5 (lines 425–431).
// Any rule here that drifts from the DOR is a bug.
//
// Convention: pure functions, accumulate errors, return { valid, errors: [{rule, reason}] }.
// Never throw. Matches server/src/validators/trip-edit-rules.js style.
//
// Rule index (from DOR Decision 5):
//   5.1  User placement is sacred — classifier never overwrites placement.source="user".
//   5.2  Ambiguous trip → user must pick (tripSlug:null + unplaced).
//   5.3  Ambiguous event → day-only placement (no eventId guess).
//   5.4  Ambiguous day → Unsorted (no dayIndex guess).
//   5.5  Device clock fallback only inside trip date range.
//   5.6  Retroactive voice notes bypass device-clock (parse temporal refs or Unsorted).
//   5.7  User override atomic — source="user" iff placementStatus="confirmed" by user path.

const PLACEMENT_COORDS = ["dayIndex", "eventIndex", "eventId"];

function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
}

function parseIsoUtc(s) {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

// Rule 5.1 — once placement.source === "user", no later update may change
// dayIndex / eventIndex / eventId. Returns true when the invariant holds
// (i.e. the proposed update is legal).
export function userPlacementSacred(row, proposedUpdate = {}) {
  const src = row?.placement?.source;
  if (src !== "user") return true;
  const next = proposedUpdate?.placement ?? {};
  const curr = row.placement ?? {};
  for (const key of PLACEMENT_COORDS) {
    if (!(key in next)) continue;
    if (next[key] !== curr[key]) return false;
  }
  return true;
}

// Rule 5.2 — zero or multiple active trips → row must be written with
// tripSlug:null + placementStatus:"unplaced" + placement.source:"unsorted".
export function ambiguousTripForcesUserSelection(row) {
  if (row?.tripSlug != null) return true; // trip already picked — rule N/A
  return (
    row?.placementStatus === "unplaced" &&
    row?.placement?.source === "unsorted"
  );
}

// Rule 5.3 — if dayIndex confidence ≥0.50 and eventId confidence <0.70,
// write dayIndex and omit eventId. Input is a classifier result
// { dayIndex, eventId?, dayConfidence, eventConfidence? }.
export function ambiguousEventDayOnly(classifierResult = {}) {
  const dayConf = Number(classifierResult.dayConfidence ?? 0);
  const evConf = Number(classifierResult.eventConfidence ?? 0);
  const hasDay = classifierResult.dayIndex != null;
  const hasEvent = classifierResult.eventId != null;
  if (dayConf < 0.5) return true;                    // not this rule's domain
  if (evConf >= 0.7) return true;                    // confident → event allowed
  // ambiguous event: must have day, must NOT have event
  return hasDay && !hasEvent;
}

// Rule 5.4 — if no signal resolves dayIndex at confidence ≥0.50, row goes
// to Unsorted: no dayIndex, placementStatus="unplaced", source="unsorted".
export function ambiguousDayUnsorted(classifierResult = {}) {
  const dayConf = Number(classifierResult.dayConfidence ?? 0);
  if (dayConf >= 0.5) return true; // not this rule's domain
  return (
    classifierResult.dayIndex == null &&
    classifierResult.placementStatus === "unplaced" &&
    classifierResult.placement?.source === "unsorted"
  );
}

// Rule 5.5 — device-clock fallback only applies when capturedAt falls within
// an active trip's date range. Outside the range → Unsorted.
export function deviceClockWithinTripRange(row, trip) {
  if (row?.placement?.source !== "device-clock") return true; // rule only applies to this source
  const captured = parseIsoUtc(row?.capturedAt);
  const start = isIsoDate(trip?.dates?.start) ? new Date(trip.dates.start + "T00:00:00Z") : null;
  const end = isIsoDate(trip?.dates?.end) ? new Date(trip.dates.end + "T23:59:59Z") : null;
  if (!captured || !start || !end) return false;
  return captured >= start && captured <= end;
}

// Rule 5.6 — retroactive voice notes must not inherit dayIndex from device
// clock. If source is "device-clock" on a voice row, that's a rule violation;
// the classifier should have parsed temporal refs or fallen to Unsorted.
export function voiceBypassDeviceClock(row) {
  if (row?.kind !== "voice") return true;
  return row?.placement?.source !== "device-clock";
}

// Rule 5.7 — user overrides write source="user" and status="confirmed" as
// an atomic pair. Post-hoc check: if either is set to the user-override
// marker, the other must match. Full atomicity requires a shared write
// helper (deferred to Phase 11b); this is belt-and-suspenders.
export function userOverrideAtomic(row) {
  const src = row?.placement?.source;
  const status = row?.placementStatus;
  if (src === "user" && status !== "confirmed") return false;
  if (status === "confirmed" && src == null) return false;
  return true;
}

// Composite validator — returns { valid, errors } matching trip-edit-rules.js.
// `trip` and `proposedUpdate` are optional; their rules are skipped when absent.
// Rules 5.3 and 5.4 take classifier output (not a row) and are exercised by
// the classify-capture path directly — not composed here.
export function validatePlacement(row, trip = null, proposedUpdate = null) {
  const errors = [];
  if (!row || typeof row !== "object") {
    return { valid: false, errors: [{ rule: "", reason: "row must be an object" }] };
  }

  if (proposedUpdate && !userPlacementSacred(row, proposedUpdate)) {
    errors.push({ rule: "5.1", reason: "classifier/update would overwrite placement.source='user'" });
  }
  if (!ambiguousTripForcesUserSelection(row)) {
    errors.push({ rule: "5.2", reason: "tripSlug:null requires placementStatus='unplaced' + placement.source='unsorted'" });
  }
  if (trip && !deviceClockWithinTripRange(row, trip)) {
    errors.push({ rule: "5.5", reason: "device-clock source but capturedAt outside trip date range" });
  }
  if (!voiceBypassDeviceClock(row)) {
    errors.push({ rule: "5.6", reason: "voice row with placement.source='device-clock' — must parse temporal refs or go Unsorted" });
  }
  if (!userOverrideAtomic(row)) {
    errors.push({ rule: "5.7", reason: "placement.source='user' and placementStatus='confirmed' must be set together" });
  }

  return { valid: errors.length === 0, errors };
}
