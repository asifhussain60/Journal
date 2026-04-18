// keychain.js — retrieves API keys from macOS Keychain.
// Falls back to env vars if Keychain lookup fails (useful for CI or
// non-macOS contexts). Never logs key values. Never writes them to disk.

import { execFileSync } from "node:child_process";

const ANTHROPIC_SERVICE = "anthropic-api-key";
const GEMINI_SERVICE    = "gemini_api_key";

function readKeychain(service) {
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return null;
  }
}

export function loadAnthropicKey() {
  const keychainKey = readKeychain(ANTHROPIC_SERVICE);
  if (keychainKey && keychainKey.startsWith("sk-ant-")) {
    return { key: keychainKey, source: "keychain" };
  }
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.startsWith("sk-ant-")) {
    return { key: envKey, source: "env" };
  }
  throw new Error(
    `No Anthropic API key found. Store one with:\n` +
    `  security add-generic-password -s ${ANTHROPIC_SERVICE} -a "$USER" -w 'sk-ant-...'\n` +
    `Or export ANTHROPIC_API_KEY before starting the server.`
  );
}

// Soft loader: returns null if no key is available anywhere. Callers
// that treat Gemini as an optional enhancement (e.g. venue verification)
// check the return value and degrade gracefully.
export function loadGeminiKey() {
  const keychainKey = readKeychain(GEMINI_SERVICE);
  if (keychainKey && keychainKey.length > 10) {
    return { key: keychainKey, source: "keychain" };
  }
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && envKey.length > 10) {
    return { key: envKey, source: "env" };
  }
  return { key: null, source: null };
}
