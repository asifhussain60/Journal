#!/usr/bin/env bash
# infra/backup-kv.sh — snapshot every live key in the journal's Cloudflare KV
# chapter store (CHAPTERS_KV) to backups/kv-snapshots/latest/, git-tracked so
# `git log` / `git diff` give point-in-time history and `git push` gives
# off-machine durability. See infra/DEPLOY.md "Backup & restore" for the
# restore path.
#
# Auth: infra/lib/cf-auth.sh (Keychain, same credentials infra/deploy.sh uses).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="journal"
NAMESPACE_ID="cabb8878cd364ea2b3d15baffb8fc052"
OUT_DIR="$ROOT/backups/kv-snapshots/latest"

source "$ROOT/infra/lib/cf-auth.sh"
load_cf_credentials_from_keychain

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "✗ No CLOUDFLARE_API_TOKEN available (Keychain entry 'journal-cloudflare-token'" >&2
  echo "  not found and none exported). See infra/DEPLOY.md — one-time credential setup." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "▶ Listing live keys in CHAPTERS_KV…"
keys_json="$(npx wrangler kv key list --namespace-id="$NAMESPACE_ID")"
keys="$(echo "$keys_json" | node -e '
  let data = "";
  process.stdin.on("data", c => data += c);
  process.stdin.on("end", () => {
    for (const k of JSON.parse(data)) console.log(k.name);
  });
')"

if [ -z "$keys" ]; then
  echo "✗ No keys returned from CHAPTERS_KV — refusing to overwrite an existing backup with nothing." >&2
  exit 1
fi

manifest_tmp="$(mktemp)"
echo "[" > "$manifest_tmp"
first=1
changed=()
unchanged=()

while IFS= read -r key; do
  [ -z "$key" ] && continue
  dest="$OUT_DIR/$key.txt"
  prev_hash=""
  [ -f "$dest" ] && prev_hash="$(shasum -a 256 "$dest" | cut -d' ' -f1)"

  npx wrangler kv key get "$key" --namespace-id="$NAMESPACE_ID" > "$dest.tmp"
  mv "$dest.tmp" "$dest"

  new_hash="$(shasum -a 256 "$dest" | cut -d' ' -f1)"
  bytes="$(wc -c < "$dest" | tr -d ' ')"

  if [ "$prev_hash" = "$new_hash" ]; then
    unchanged+=("$key")
  else
    changed+=("$key")
  fi

  [ "$first" -eq 1 ] || echo "," >> "$manifest_tmp"
  first=0
  printf '  {"key": "%s", "bytes": %s, "sha256": "%s", "fetchedAt": "%s"}' \
    "$key" "$bytes" "$new_hash" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$manifest_tmp"
done <<< "$keys"

echo "" >> "$manifest_tmp"
echo "]" >> "$manifest_tmp"
mv "$manifest_tmp" "$OUT_DIR/manifest.json"

echo ""
echo "✅ Backed up $(echo "$keys" | wc -l | tr -d ' ') key(s) to backups/kv-snapshots/latest/"
[ "${#changed[@]}" -gt 0 ] && echo "   Changed since last backup: ${changed[*]}"
[ "${#unchanged[@]}" -gt 0 ] && echo "   Unchanged: ${unchanged[*]}"
echo ""
echo "   Review with: git status / git diff -- backups/kv-snapshots/latest"
echo "   Commit when satisfied — this script does not commit or push."
