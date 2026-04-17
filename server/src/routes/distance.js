// routes/distance.js — Google Distance Matrix proxy.
//   POST /api/distance-matrix — waypoints[] → adjacent-pair duration/distance.
//
// No key configured → degrades to { ok:true, key:false, pairs:[] } and the
// client renders "—" for the drive chip.

import express from "express";
import { loadGoogleMapsKey } from "../util/google-maps.js";

export function createDistanceRouter() {
  const router = express.Router();

  router.post("/api/distance-matrix", async (req, res) => {
    try {
      const { waypoints } = req.body ?? {};
      if (!Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({ ok: false, error: "waypoints[] must have at least 2 addresses" });
      }
      const { key } = loadGoogleMapsKey();
      if (!key) {
        return res.json({ ok: true, key: false, pairs: [] });
      }
      const pairs = [];
      for (let i = 0; i + 1 < waypoints.length; i += 1) {
        const origin = String(waypoints[i] ?? "").trim();
        const destination = String(waypoints[i + 1] ?? "").trim();
        if (!origin || !destination) continue;
        const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
        url.searchParams.set("origins", origin);
        url.searchParams.set("destinations", destination);
        url.searchParams.set("mode", "driving");
        url.searchParams.set("units", "imperial");
        url.searchParams.set("key", key);
        const r = await fetch(url);
        if (!r.ok) { pairs.push({ from: origin, to: destination, error: "http_" + r.status }); continue; }
        const j = await r.json();
        const cell = j?.rows?.[0]?.elements?.[0];
        if (!cell || cell.status !== "OK") {
          pairs.push({ from: origin, to: destination, error: cell?.status || "unknown" });
          continue;
        }
        pairs.push({
          from: origin,
          to: destination,
          duration_min: Math.round((cell.duration?.value ?? 0) / 60),
          distance_mi: Number((((cell.distance?.value ?? 0) / 1609.344)).toFixed(1)),
        });
      }
      res.json({ ok: true, key: true, pairs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
