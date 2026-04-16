// keychain.js — retrieves the Anthropic API key from macOS Keychain.
// Falls back to ANTHROPIC_API_KEY env var if Keychain lookup fails (useful for CI or non-macOS contexts).
// Never logs the key value. Never writes it to disk.

import { execFileSync } from "node:child_process";

const SERVICE_NAME = "anthropic-api-key";

export function loadAnthropicKey() {
  // 1. Try macOS Keychain (primary, preferred)
  try {
    const key = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", SERVICE_NAME, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (key && key.startsWith("sk-ant-")) {
      return { key, source: "keychain" };
    }
  } catch {
    // fall through to env var
  }

  // 2. Fallback: env var
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.startsWith("sk-ant-")) {
    return { key: envKey, source: "env" };
  }

  throw new Error(
    `No Anthropic API key found. Store one with:\n` +
    `  security add-generic-password -s ${SERVICE_NAME} -a "$USER" -w 'sk-ant-...'\n` +
    `Or export ANTHROPIC_API_KEY before starting the server.`
  );
}
