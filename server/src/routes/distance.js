// routes/distance.js — driving distance + geocoding proxy.
//
//   POST /api/distance-matrix — waypoints[] (strings OR {lat,lng,label})
//                               → adjacent-pair duration_min / distance_mi
//   POST /api/geocode         — { text, focus?, size? } → { candidates[] }
//
// Backend: OpenRouteService (ORS). Without ORS_API_KEY, /api/distance-matrix
// returns { ok:true, key:false, pairs:[] } so the client degrades to "—".
//
// String waypoints (back-compat with pre-ORS callers) are geocoded inline.
// For better results, send waypoints as {lat,lng,label} once the trip has
// cached coords on each event.

import express from "express";
import { geocode as orsGeocode, adjacentPairs as orsPairs, isConfigured } from "../lib/ors.js";

function looksLikeCoord(wp) {
  return wp && typeof wp === "object" && Number.isFinite(wp.lat) && Number.isFinite(wp.lng);
}

export function createDistanceRouter() {
  const router = express.Router();

  router.post("/api/distance-matrix", async (req, res) => {
    try {
      const { waypoints, focus } = req.body ?? {};
      if (!Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({ ok: false, error: "waypoints[] must have at least 2 entries" });
      }
      if (!isConfigured()) {
        return res.json({ ok: true, key: false, pairs: [] });
      }

      const resolved = [];
      for (const wp of waypoints) {
        if (looksLikeCoord(wp)) {
          resolved.push({ lat: wp.lat, lng: wp.lng, label: wp.label ?? "" });
          continue;
        }
        if (typeof wp === "string" && wp.trim()) {
          const g = await orsGeocode(wp, { focus, size: 1 });
          if (g.ok && g.candidates.length) {
            const top = g.candidates[0];
            resolved.push({ lat: top.lat, lng: top.lng, label: wp });
          } else {
            resolved.push({ lat: NaN, lng: NaN, label: wp });
          }
          continue;
        }
        resolved.push({ lat: NaN, lng: NaN, label: String(wp ?? "") });
      }

      const out = await orsPairs(resolved);
      if (!out.ok) return res.status(502).json({ ok: false, error: out.error ?? "ors_failed" });
      res.json({ ok: true, key: true, pairs: out.pairs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post("/api/geocode", async (req, res) => {
    try {
      const { text, focus, size, country } = req.body ?? {};
      if (typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ ok: false, error: "text required" });
      }
      if (!isConfigured()) {
        return res.status(503).json({ ok: false, error: "ORS_API_KEY not configured" });
      }
      const out = await orsGeocode(text, { focus, size: size ?? 3, country });
      if (!out.ok) return res.status(502).json({ ok: false, error: out.error ?? "ors_failed" });
      res.json({ ok: true, candidates: out.candidates });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
