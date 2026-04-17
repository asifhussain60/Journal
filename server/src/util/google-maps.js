// util/google-maps.js — key loader for Google Distance Matrix.
// Tries macOS Keychain first, then env. Returns { key:null, source:null }
// when no key is configured so the distance-matrix route can degrade to "—".

import { execFileSync } from "node:child_process";

export function loadGoogleMapsKey() {
  try {
    const key = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "google-maps-key", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (key && key.length > 20) return { key, source: "keychain" };
  } catch { /* fall through */ }
  const envKey = process.env.GOOGLE_MAPS_API_KEY;
  if (envKey && envKey.length > 20) return { key: envKey, source: "env" };
  return { key: null, source: null };
}
