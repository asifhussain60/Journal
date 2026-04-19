// routes/itinerary-recalc.js — anchor-respecting time recalculation.
//
//   POST /api/recalc-times
//     Body: { tripSlug, dayIndex, events: Array<{event,time,time_mode,lat,lng,duration_min}> }
//     - `events` is the CLIENT's proposed order after drag-drop (canonical idx in the server is overwritten).
//     - Anchors keep their existing `time`. Flex events between anchors
//       get packed: next.time = prev.end + drive(prev→next).
//     - Leading flex events (before first anchor) back-pack from that anchor.
//     - Day-wide recalc: driving times are recomputed for every consecutive pair.
//     - On conflict (flex can't fit before next anchor): feasible=false, tight=true.
//
//   POST /api/pin-event
//     Body: { tripSlug, dayIndex, eventIndex, time_mode: "anchor" | "flex" }
//     - Narrow endpoint that flips an event's `time_mode`. Isolated from
//       /api/trip-edit so it can run outside the REFINE_ALL_ENABLED gate
//       and outside the /highlights + /dayoneTags allowlist.
//
// Returns { ok, patches, summary: { tight_gaps, feasible } } — the caller applies
// patches via /api/trip-edit so edit-log + snapshots stay intact.

import express from "express";
import { directions as orsDirections, isConfigured as orsConfigured } from "../lib/ors.js";
import { readTripObj, applyTripEdit } from "../lib/trip-edit-ops.js";
import { getActiveTripSlug } from "../lib/receipts.js";

const DEFAULT_DURATION_MIN = 60;  // when event has no duration_min, assume 1 hour
const TIGHT_GAP_MIN = 5;          // warn when buffer between drive-end and next event is < 5 min

function parseClockToMin(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[~\u2248]/g, "").trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ampm = (m[3] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function formatMinToClock(min) {
  if (!Number.isFinite(min)) return "";
  let h = Math.floor(((min % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
  const m = ((min % 60) + 60) % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

async function driveMinutes(from, to) {
  if (!Number.isFinite(from?.lat) || !Number.isFinite(from?.lng) || !Number.isFinite(to?.lat) || !Number.isFinite(to?.lng)) {
    return null;
  }
  const d = await orsDirections(from, to);
  if (!d.ok) return null;
  return Math.round(d.duration_s / 60);
}

/**
 * Core packing algorithm. Events are walked left-to-right.
 *   - Anchors: time stays fixed. Previous flex events (if any) are back-packed
 *     to end at (anchor.time - drive_to_anchor).
 *   - Flex after an anchor: time = prev.end + drive(prev→flex).
 *   - First event is treated as an implicit anchor (its time is preserved
 *     unless it's flex and followed by an anchor).
 *
 * Returns { packed: Array<{...event, time, drive_min_to_next}>, tight_gaps: number }
 */
async function packEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return { packed: [], tight_gaps: 0 };

  // Pass 1: compute drive_min_to_next for every consecutive pair. This is the
  // expensive step (one ORS call per pair). We do it once, up-front.
  const drives = new Array(events.length - 1);
  for (let i = 0; i < events.length - 1; i += 1) {
    drives[i] = await driveMinutes(events[i], events[i + 1]);
  }

  // Pass 2: locate anchors. If none, treat events[0] as pinned.
  const anchorIdx = events.reduce((acc, ev, i) => {
    if (ev.time_mode === "anchor" && parseClockToMin(ev.time) != null) acc.push(i);
    return acc;
  }, []);
  const effectiveAnchors = anchorIdx.length ? anchorIdx : [0];

  // Pass 3: pack forward from each anchor to the next, and back-pack leading flex.
  const result = events.map((ev) => ({ ...ev }));
  let tight_gaps = 0;

  // Forward-pack between consecutive anchors.
  for (let a = 0; a < effectiveAnchors.length; a += 1) {
    const anchor = effectiveAnchors[a];
    const nextAnchor = effectiveAnchors[a + 1] ?? events.length;
    // Anchor time is authoritative — preserve it (first-event fallback uses its own time).
    const anchorTime = parseClockToMin(result[anchor].time);
    if (anchorTime == null) continue;

    let cursor = anchorTime + (Number.isFinite(result[anchor].duration_min) ? result[anchor].duration_min : DEFAULT_DURATION_MIN);
    for (let i = anchor + 1; i < nextAnchor; i += 1) {
      const drive = drives[i - 1];
      const start = drive != null ? cursor + drive : cursor;
      result[i].time = formatMinToClock(start);
      const dur = Number.isFinite(result[i].duration_min) ? result[i].duration_min : DEFAULT_DURATION_MIN;
      cursor = start + dur;
    }
    // If the next event after this pack is an anchor, check feasibility.
    if (nextAnchor < events.length) {
      const nextAnchorTime = parseClockToMin(result[nextAnchor].time);
      const driveToAnchor = drives[nextAnchor - 1];
      const arriveBy = driveToAnchor != null ? cursor + driveToAnchor : cursor;
      if (nextAnchorTime != null && arriveBy > nextAnchorTime - TIGHT_GAP_MIN) tight_gaps += 1;
    }
  }

  // Back-pack leading flex events (before the first anchor, if the first anchor isn't at index 0).
  const firstAnchor = effectiveAnchors[0];
  if (firstAnchor > 0) {
    const anchorTime = parseClockToMin(result[firstAnchor].time);
    if (anchorTime != null) {
      let cursor = anchorTime;
      for (let i = firstAnchor - 1; i >= 0; i -= 1) {
        const drive = drives[i];
        const dur = Number.isFinite(result[i].duration_min) ? result[i].duration_min : DEFAULT_DURATION_MIN;
        const endBy = drive != null ? cursor - drive : cursor;
        const startAt = endBy - dur;
        result[i].time = formatMinToClock(startAt);
        cursor = startAt;
      }
    }
  }

  // Pass 4: stash drive_min_to_next on each event (for the UI chip).
  for (let i = 0; i < result.length - 1; i += 1) {
    if (drives[i] != null) result[i].drive_min_to_next = drives[i];
    else delete result[i].drive_min_to_next;
  }
  // Last event has no successor.
  delete result[result.length - 1].drive_min_to_next;

  return { packed: result, tight_gaps };
}

export function createItineraryRecalcRouter() {
  const router = express.Router();

  router.post("/api/recalc-times", async (req, res) => {
    try {
      const { tripSlug, dayIndex, events: clientEvents, apply } = req.body ?? {};
      if (!Number.isInteger(dayIndex) || dayIndex < 0) {
        return res.status(400).json({ ok: false, error: "dayIndex (non-negative integer) required" });
      }
      if (!Array.isArray(clientEvents) || clientEvents.length === 0) {
        return res.status(400).json({ ok: false, error: "events[] required" });
      }
      if (!orsConfigured()) {
        return res.status(503).json({ ok: false, error: "ORS_API_KEY not configured" });
      }

      const slug = tripSlug || (await getActiveTripSlug());
      const trip = await readTripObj(slug);
      const day = trip?.days?.[dayIndex];
      if (!day || !Array.isArray(day.events)) {
        return res.status(404).json({ ok: false, error: `day ${dayIndex} not found` });
      }

      // Validate event count matches (client + server must agree on shape).
      if (clientEvents.length !== day.events.length) {
        return res.status(400).json({
          ok: false,
          error: `event count mismatch: client=${clientEvents.length} server=${day.events.length}`,
        });
      }

      // Client sends NEW ORDER as a list of events. Each item must carry
      // enough info to pack: time_mode, time (for anchors), lat, lng,
      // duration_min. We enrich from the server copy by matching place_id
      // (preferred) or venue (fallback).
      const serverByPlaceId = new Map();
      const serverByVenue = new Map();
      for (const ev of day.events) {
        if (ev.place_id) serverByPlaceId.set(ev.place_id, ev);
        if (ev.venue) serverByVenue.set(ev.venue, ev);
      }
      const enriched = clientEvents.map((cev) => {
        const sev = (cev.place_id && serverByPlaceId.get(cev.place_id)) ||
                    (cev.venue && serverByVenue.get(cev.venue)) ||
                    {};
        return {
          ...sev,
          ...cev,
          // Coords must come from the server (cached) unless client provides new ones.
          lat: Number.isFinite(cev.lat) ? cev.lat : sev.lat,
          lng: Number.isFinite(cev.lng) ? cev.lng : sev.lng,
          time_mode: cev.time_mode || sev.time_mode || "flex",
          time: cev.time || sev.time,
        };
      });

      const { packed, tight_gaps } = await packEvents(enriched);

      // Build JSON-Patch replacing the entire events array for the day.
      // A wholesale replace is simpler and atomic vs. N per-field ops.
      const patch = [{ op: "replace", path: `/days/${dayIndex}/events`, value: packed }];

      if (apply === true) {
        const applied = await applyTripEdit(slug, {
          intent: `Recalc times for day ${dayIndex + 1} after drag-reorder`,
          patch,
          actor: "recalc-times",
        });
        if (!applied.ok) {
          return res.status(422).json({ ok: false, error: applied.error, errors: applied.errors });
        }
        return res.json({
          ok: true,
          applied: true,
          id: applied.id,
          packed,
          summary: { tight_gaps, feasible: tight_gaps === 0 },
        });
      }

      // Dry-run — caller applies via /api/trip-edit with the returned patch.
      res.json({
        ok: true,
        applied: false,
        patch,
        packed,
        summary: { tight_gaps, feasible: tight_gaps === 0 },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post("/api/pin-event", async (req, res) => {
    try {
      const { tripSlug, dayIndex, eventIndex, time_mode } = req.body ?? {};
      if (!Number.isInteger(dayIndex) || dayIndex < 0) {
        return res.status(400).json({ ok: false, error: "dayIndex required" });
      }
      if (!Number.isInteger(eventIndex) || eventIndex < 0) {
        return res.status(400).json({ ok: false, error: "eventIndex required" });
      }
      if (time_mode !== "anchor" && time_mode !== "flex") {
        return res.status(400).json({ ok: false, error: 'time_mode must be "anchor" or "flex"' });
      }
      const slug = tripSlug || (await getActiveTripSlug());
      const trip = await readTripObj(slug);
      const ev = trip?.days?.[dayIndex]?.events?.[eventIndex];
      if (!ev) return res.status(404).json({ ok: false, error: "event not found" });

      const patch = [
        (ev.time_mode === undefined)
          ? { op: "add",     path: `/days/${dayIndex}/events/${eventIndex}/time_mode`, value: time_mode }
          : { op: "replace", path: `/days/${dayIndex}/events/${eventIndex}/time_mode`, value: time_mode },
      ];
      const applied = await applyTripEdit(slug, {
        intent: `Pin/unpin event ${dayIndex + 1}.${eventIndex + 1} → ${time_mode}`,
        patch,
        actor: "pin-event",
      });
      if (!applied.ok) return res.status(422).json({ ok: false, error: applied.error, errors: applied.errors });
      res.json({ ok: true, id: applied.id, time_mode });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
