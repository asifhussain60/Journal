// validators/trip-edit-rules.js — Phase 6 semantic rules (§5.4).
//
// Called after ajv passes structural validation. These rules check
// cross-field invariants ajv can't express. All checks return
// { valid, errors: [{ field, reason }] } — never throw.

function parseDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseMaybeTime(s) {
  if (typeof s !== "string" || !s.length) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ampm = (m[3] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

export function validateTrip(trip) {
  const errors = [];
  if (!trip || typeof trip !== "object") {
    return { valid: false, errors: [{ field: "", reason: "trip must be an object" }] };
  }

  const start = parseDate(trip?.dates?.start);
  const end = parseDate(trip?.dates?.end);
  if (!start) errors.push({ field: "dates.start", reason: "missing or not YYYY-MM-DD" });
  if (!end) errors.push({ field: "dates.end", reason: "missing or not YYYY-MM-DD" });
  if (start && end && start > end) {
    errors.push({ field: "dates", reason: "dates.start must be ≤ dates.end" });
  }

  const flights = trip.flights && typeof trip.flights === "object" ? trip.flights : {};
  const flightIntervals = [];
  for (const [key, f] of Object.entries(flights)) {
    if (!f || typeof f !== "object") continue;
    const d = parseDate(f.date);
    if (f.date && !d) errors.push({ field: `flights.${key}.date`, reason: "not YYYY-MM-DD" });
    if (d && start && d < start) errors.push({ field: `flights.${key}.date`, reason: "before trip start" });
    if (d && end && d > end) errors.push({ field: `flights.${key}.date`, reason: "after trip end" });
    const dep = parseMaybeTime(f.depart);
    const arr = parseMaybeTime(f.arrive);
    if (dep != null && arr != null && f.date && dep >= arr && !/\+1/.test(String(f.arrive))) {
      errors.push({ field: `flights.${key}`, reason: "depart must be before arrive (same-day)" });
    }
    if (d != null && dep != null && arr != null) {
      flightIntervals.push({ key, start: d.getTime() + dep * 60000, end: d.getTime() + Math.max(arr, dep + 1) * 60000 });
    }
  }
  flightIntervals.sort((a, b) => a.start - b.start);
  for (let i = 1; i < flightIntervals.length; i += 1) {
    if (flightIntervals[i].start < flightIntervals[i - 1].end) {
      errors.push({ field: `flights.${flightIntervals[i].key}`, reason: `overlaps flights.${flightIntervals[i - 1].key}` });
    }
  }

  const hotels = Array.isArray(trip.hotels) ? trip.hotels : [];
  hotels.forEach((h, idx) => {
    const ci = parseDate(h?.checkIn);
    const co = parseDate(h?.checkOut);
    if (h?.checkIn && !ci) errors.push({ field: `hotels[${idx}].checkIn`, reason: "not YYYY-MM-DD" });
    if (h?.checkOut && !co) errors.push({ field: `hotels[${idx}].checkOut`, reason: "not YYYY-MM-DD" });
    if (ci && co && co <= ci) errors.push({ field: `hotels[${idx}]`, reason: "checkOut must be after checkIn" });
  });

  const highlights = Array.isArray(trip.highlights) ? trip.highlights : [];
  highlights.forEach((h, idx) => {
    const d = parseDate(h?.date);
    if (h?.date && !d) errors.push({ field: `highlights[${idx}].date`, reason: "not YYYY-MM-DD" });
    if (d && start && d < start) errors.push({ field: `highlights[${idx}].date`, reason: "before trip start" });
    if (d && end && d > end) errors.push({ field: `highlights[${idx}].date`, reason: "after trip end" });
    const s = parseMaybeTime(h?.start);
    const e = parseMaybeTime(h?.end);
    if (s != null && e != null && s >= e) {
      errors.push({ field: `highlights[${idx}]`, reason: "start must be before end" });
    }
  });

  return { valid: errors.length === 0, errors };
}
