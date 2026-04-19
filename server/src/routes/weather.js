// routes/weather.js — Open-Meteo proxy for itinerary weather tiles.
//   GET /api/weather?lat=&lng=&date=YYYY-MM-DD
//   GET /api/weather?slug=&date=YYYY-MM-DD
//
// Returns conditions for the requested date + a derived severity flag the
// client uses to decide whether to paint the warning glow on outdoor /
// long-drive cards. If `date` is omitted or today, returns current weather.
// For future dates (within Open-Meteo's 16-day window), returns the daily
// forecast for that date.
//
// When `slug` is supplied instead of lat/lng, the server reads the trip's
// coords (trip.yaml `coords: { lat, lng }`) if present, otherwise geocodes
// `trip.base` or the first `trip.regions[]` via Open-Meteo's free geocoding
// API. Geocode results are cached in-process so the same trip only hits the
// geocoder once per server boot.
//
// Server-side cache keyed by rounded coords + date; Open-Meteo is free and
// unauthenticated but we still want to be polite.

import express from "express";
import { readTripObj, applyTripEdit } from "../lib/trip-edit-ops.js";

const CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

// Per-trip geocode cache. Keyed by slug, value: { lat, lng, resolvedFrom } or
// { failed: reason }. Cleared on server restart — Open-Meteo geocoding is
// free and stable enough that we don't need disk persistence yet.
const GEOCODE_CACHE = new Map();

async function geocodeQuery(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`geocoder http_${r.status}`);
  const j = await r.json();
  const hit = Array.isArray(j?.results) ? j.results[0] : null;
  if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") return null;
  return { lat: hit.latitude, lng: hit.longitude, resolvedFrom: query, name: hit.name };
}

async function resolveTripCoords(slug) {
  if (!slug) return null;
  const cached = GEOCODE_CACHE.get(slug);
  if (cached && !cached.failed) return cached;
  if (cached?.failed && Date.now() - cached.at < 10 * 60 * 1000) return null; // 10-min negative cache
  let trip;
  try { trip = await readTripObj(slug); } catch { GEOCODE_CACHE.set(slug, { failed: "no-trip", at: Date.now() }); return null; }
  // Prefer explicit coords if the user added them to trip.yaml.
  if (typeof trip?.coords?.lat === "number" && typeof trip?.coords?.lng === "number") {
    const hit = { lat: trip.coords.lat, lng: trip.coords.lng, resolvedFrom: "trip.yaml" };
    GEOCODE_CACHE.set(slug, hit);
    return hit;
  }
  const raw = [trip?.base, ...(Array.isArray(trip?.regions) ? trip.regions : [])].filter(
    (s) => typeof s === "string" && s.trim().length
  );
  // Open-Meteo geocoder wants plain place names ("New Brunswick"), not brand
  // phrases ("Home2 Suites, New Brunswick, NJ") or compound regions
  // ("Central New Jersey"). Fan each source string out into comma-separated
  // fragments and try them in order, de-duped. First hit wins.
  const tried = new Set();
  const queries = [];
  for (const src of raw) {
    for (const frag of [src, ...src.split(",")].map((s) => s.trim()).filter(Boolean)) {
      const key = frag.toLowerCase();
      if (tried.has(key)) continue;
      tried.add(key);
      queries.push(frag);
    }
  }
  for (const q of queries) {
    try {
      const hit = await geocodeQuery(q);
      if (hit) {
        GEOCODE_CACHE.set(slug, hit);
        // Persist the resolved coords back to trip.yaml so every future server
        // boot (and the human, browsing the file) can see them. Best-effort —
        // a failed write logs but never blocks the weather call.
        persistTripCoords(slug, { lat: hit.lat, lng: hit.lng }).catch((err) => {
          console.warn(`[weather] persist coords ${slug}: ${err?.message ?? err}`);
        });
        return hit;
      }
    } catch { /* try next candidate */ }
  }
  GEOCODE_CACHE.set(slug, { failed: "geocode-empty", at: Date.now() });
  return null;
}

// One-shot write of resolved coords back to trip.yaml using the Phase 6
// trip-edit flow so the edit is snapshotted + recorded in edit-log.json.
// Guarded: skip if coords are already present or the trip.yaml read failed.
async function persistTripCoords(slug, coords) {
  let trip;
  try { trip = await readTripObj(slug); } catch { return; }
  if (typeof trip?.coords?.lat === "number" && typeof trip?.coords?.lng === "number") return;
  const patch = [{
    op: "coords" in (trip || {}) ? "replace" : "add",
    path: "/coords",
    value: { lat: coords.lat, lng: coords.lng },
  }];
  const result = await applyTripEdit(slug, { intent: "auto-geocode", patch, actor: "auto" });
  if (!result.ok) throw new Error(result.error || "applyTripEdit failed");
}

// Open-Meteo WMO weather codes → icon + label + outdoor severity.
// severity: 'none' (clear/pleasant), 'warn' (rain/cold/wind — outdoor advised
// but not dangerous), 'alert' (thunderstorm/heavy snow — cancel outdoor).
function classify(code, tempF, windMph) {
  const c = Number(code);
  let icon = "fa-sun", label = "Clear", severity = "none";

  if (c === 0) { icon = "fa-sun"; label = "Clear"; }
  else if (c === 1 || c === 2) { icon = "fa-cloud-sun"; label = "Partly Cloudy"; }
  else if (c === 3) { icon = "fa-cloud"; label = "Overcast"; }
  else if (c === 45 || c === 48) { icon = "fa-smog"; label = "Fog"; severity = "warn"; }
  else if (c >= 51 && c <= 57) { icon = "fa-cloud-rain"; label = "Drizzle"; severity = "warn"; }
  else if (c >= 61 && c <= 65) { icon = "fa-cloud-showers-heavy"; label = "Rain"; severity = c === 65 ? "alert" : "warn"; }
  else if (c >= 66 && c <= 67) { icon = "fa-cloud-meatball"; label = "Freezing Rain"; severity = "alert"; }
  else if (c >= 71 && c <= 75) { icon = "fa-snowflake"; label = "Snow"; severity = c === 75 ? "alert" : "warn"; }
  else if (c === 77) { icon = "fa-snowflake"; label = "Snow Grains"; severity = "warn"; }
  else if (c >= 80 && c <= 82) { icon = "fa-cloud-showers-heavy"; label = "Showers"; severity = c === 82 ? "alert" : "warn"; }
  else if (c === 85 || c === 86) { icon = "fa-snowflake"; label = "Snow Showers"; severity = "warn"; }
  else if (c >= 95 && c <= 99) { icon = "fa-bolt"; label = "Thunderstorm"; severity = "alert"; }

  if (severity === "none") {
    if (tempF != null && (tempF < 35 || tempF > 95)) severity = "warn";
    if (windMph != null && windMph > 25) severity = severity === "none" ? "warn" : severity;
    if (windMph != null && windMph > 40) severity = "alert";
  }
  return { icon, label, severity };
}

export function createWeatherRouter() {
  const router = express.Router();

  router.get("/api/weather", async (req, res) => {
    try {
      let lat = Number(req.query.lat);
      let lng = Number(req.query.lng);
      let resolvedFrom = null;
      // Fall back to slug-based geocode when explicit coords aren't supplied.
      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && req.query.slug) {
        const coords = await resolveTripCoords(String(req.query.slug));
        if (!coords) {
          return res.status(200).json({ ok: false, error: "coords-unresolved" });
        }
        lat = coords.lat;
        lng = coords.lng;
        resolvedFrom = coords.resolvedFrom;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ ok: false, error: "lat and lng (or slug) required" });
      }
      // Normalize date. Empty / invalid → today. Format YYYY-MM-DD.
      const today = new Date().toISOString().slice(0, 10);
      const rawDate = String(req.query.date ?? "").trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;
      const isToday = date === today;

      const key = `${lat.toFixed(2)}:${lng.toFixed(2)}:${date}`;
      const hit = CACHE.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return res.json({ ok: true, cached: true, date, ...hit.data });
      }

      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(lat));
      url.searchParams.set("longitude", String(lng));
      url.searchParams.set("temperature_unit", "fahrenheit");
      url.searchParams.set("wind_speed_unit", "mph");
      url.searchParams.set("timezone", "auto");
      if (isToday) {
        url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
      } else {
        url.searchParams.set(
          "daily",
          "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max"
        );
        url.searchParams.set("start_date", date);
        url.searchParams.set("end_date", date);
      }

      // Open-Meteo is free + unauthenticated but occasionally slow. Cap the
      // wait at 8s so the tile can render a fallback instead of spinning.
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return res.status(502).json({ ok: false, error: "open-meteo http_" + r.status });
      const j = await r.json();

      let tempF, windMph, code, tempMin, tempMax, precipPct;
      if (isToday) {
        const cur = j?.current;
        if (!cur) return res.status(502).json({ ok: false, error: "no current block" });
        tempF = Math.round(cur.temperature_2m);
        windMph = Math.round(cur.wind_speed_10m);
        code = cur.weather_code;
      } else {
        const d = j?.daily;
        if (!d || !Array.isArray(d.time) || !d.time.length) {
          return res.status(502).json({ ok: false, error: "no daily block" });
        }
        tempMax = Math.round(d.temperature_2m_max[0]);
        tempMin = Math.round(d.temperature_2m_min[0]);
        // Use midpoint as the representative temp; severity uses max for outdoor risk.
        tempF = Math.round((tempMax + tempMin) / 2);
        windMph = Math.round(d.wind_speed_10m_max[0]);
        code = d.weather_code[0];
        precipPct = d.precipitation_probability_max ? Math.round(d.precipitation_probability_max[0]) : null;
      }
      const { icon, label, severity } = classify(code, isToday ? tempF : tempMax, windMph);
      const data = { tempF, tempMin, tempMax, windMph, precipPct, code, icon, label, severity };
      CACHE.set(key, { at: Date.now(), data });
      res.json({ ok: true, cached: false, date, ...data, ...(resolvedFrom ? { resolvedFrom } : {}) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
