// lib/ors.js — OpenRouteService client (geocoding + driving directions).
//
// Feature flag: requires ORS_API_KEY env var. Without it, every call
// returns { ok: false, key: false, ... } so callers can degrade gracefully.
//
// Endpoints used:
//   /geocode/search          — venue string → top candidates with lat/lng
//   /v2/directions/driving-car — two coords → free-flow distance + duration
//
// Gotchas (see memory reference_ors_api.md):
//   - Coordinates are [lng, lat], NOT [lat, lng]
//   - Geocoder is mediocre for bare POI names — always bias with focus.point
//   - Free-flow only; no traffic model

const ORS_BASE = "https://api.openrouteservice.org";
const USER_AGENT = "babu-journal/0.1 (+https://journal.kashkole.com)";

function getKey() {
  const k = process.env.ORS_API_KEY;
  return k && k.length > 20 ? k : null;
}

function toPlaceId(feature) {
  // ORS doesn't expose Google-style place_ids. Use gid if present, else
  // a deterministic hash of label+coords so we can compare across calls.
  const gid = feature?.properties?.gid;
  if (typeof gid === "string" && gid.length) return gid;
  const label = feature?.properties?.label ?? "";
  const [lng, lat] = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [0, 0];
  return `ors:${label}|${lng.toFixed(5)},${lat.toFixed(5)}`;
}

/**
 * Geocode a free-text venue string to lat/lng candidates.
 *
 * @param {string} text - Venue name or address. More specific = better (include city/state).
 * @param {object} [opts]
 * @param {{lng:number,lat:number}} [opts.focus] - Bias results near this point (typically trip anchor).
 * @param {string} [opts.country] - ISO alpha-2 country code. Defaults to "US".
 * @param {number} [opts.size] - Max candidates to return. Default 3.
 * @returns {Promise<{ok:true, key:true, candidates:Array<{lat,lng,label,confidence,place_id}>} | {ok:false, key:false|true, error?:string}>}
 */
export async function geocode(text, opts = {}) {
  const key = getKey();
  if (!key) return { ok: false, key: false, error: "ORS_API_KEY not set" };
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, key: true, error: "text required" };
  }
  const url = new URL(`${ORS_BASE}/geocode/search`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("text", text.trim());
  url.searchParams.set("size", String(opts.size ?? 3));
  url.searchParams.set("boundary.country", (opts.country ?? "US").toUpperCase());
  if (opts.focus && Number.isFinite(opts.focus.lat) && Number.isFinite(opts.focus.lng)) {
    url.searchParams.set("focus.point.lon", String(opts.focus.lng));
    url.searchParams.set("focus.point.lat", String(opts.focus.lat));
  }
  try {
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) return { ok: false, key: true, error: `http_${r.status}` };
    const j = await r.json();
    const features = Array.isArray(j?.features) ? j.features : [];
    const candidates = features
      .map((f) => {
        const [lng, lat] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates : [null, null];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat,
          lng,
          label: f?.properties?.label ?? "",
          confidence: typeof f?.properties?.confidence === "number" ? f.properties.confidence : null,
          place_id: toPlaceId(f),
        };
      })
      .filter(Boolean);
    return { ok: true, key: true, candidates };
  } catch (err) {
    return { ok: false, key: true, error: err?.message ?? String(err) };
  }
}

/**
 * Driving distance + duration between two coords.
 *
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @returns {Promise<{ok:true, key:true, distance_m:number, duration_s:number} | {ok:false, key:false|true, error?:string}>}
 */
export async function directions(from, to) {
  const key = getKey();
  if (!key) return { ok: false, key: false, error: "ORS_API_KEY not set" };
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) {
    return { ok: false, key: true, error: "from/to must be {lat,lng}" };
  }
  const url = new URL(`${ORS_BASE}/v2/directions/driving-car`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("start", `${from.lng},${from.lat}`);
  url.searchParams.set("end", `${to.lng},${to.lat}`);
  try {
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    const j = await r.json();
    if (!r.ok) {
      return { ok: false, key: true, error: j?.error?.message || `http_${r.status}`, code: j?.error?.code };
    }
    const seg = j?.features?.[0]?.properties?.segments?.[0];
    if (!seg || !Number.isFinite(seg.distance) || !Number.isFinite(seg.duration)) {
      return { ok: false, key: true, error: "no routable segment" };
    }
    return {
      ok: true,
      key: true,
      distance_m: seg.distance,
      duration_s: seg.duration,
    };
  } catch (err) {
    return { ok: false, key: true, error: err?.message ?? String(err) };
  }
}

/**
 * Adjacent-pair distances for an ordered list of coords. One ORS call per pair.
 * Used by the /api/distance-matrix route to populate drive_min_to_next chips.
 *
 * @param {Array<{lat:number,lng:number,label?:string}>} waypoints
 * @returns {Promise<{ok:true, key:true, pairs:Array} | {ok:false, key:false|true, error?:string}>}
 */
export async function adjacentPairs(waypoints) {
  const key = getKey();
  if (!key) return { ok: false, key: false, pairs: [] };
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return { ok: false, key: true, error: "need ≥ 2 waypoints" };
  }
  const pairs = [];
  for (let i = 0; i + 1 < waypoints.length; i += 1) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const label_from = a?.label ?? "";
    const label_to = b?.label ?? "";
    if (!Number.isFinite(a?.lat) || !Number.isFinite(a?.lng) || !Number.isFinite(b?.lat) || !Number.isFinite(b?.lng)) {
      pairs.push({ from: label_from, to: label_to, error: "missing_coords" });
      continue;
    }
    const d = await directions(a, b);
    if (!d.ok) {
      pairs.push({ from: label_from, to: label_to, error: d.error ?? "unknown" });
      continue;
    }
    pairs.push({
      from: label_from,
      to: label_to,
      duration_min: Math.round(d.duration_s / 60),
      distance_mi: Number((d.distance_m / 1609.344).toFixed(1)),
    });
  }
  return { ok: true, key: true, pairs };
}

export function isConfigured() {
  return Boolean(getKey());
}
