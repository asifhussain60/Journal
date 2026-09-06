#!/usr/bin/env bash
# infra/restore-kv.sh — write a backup snapshot (from infra/backup-kv.sh) back
# into the journal's live Cloudflare KV chapter store (CHAPTERS_KV).
#
# Usage:
#   bash infra/restore-kv.sh [--from <dir>] [--yes]
#
#   --from <dir>  Directory of <key>.txt files to restore from.
#                 Default: backups/kv-snapshots/latest/
#                 To restore an older snapshot: check it out first, e.g.
#                   git checkout <commit> -- backups/kv-snapshots/latest
#                   bash infra/restore-kv.sh
#                   git checkout HEAD -- backups/kv-snapshots/latest   # restore working tree after
#   --yes         Skip the interactive confirmation prompt (for scripted use).
#
# This writes straight to the Cloudflare API via `wrangler kv key put`, which
# intentionally BYPASSES the Worker's locked-chapter check in
# worker/routes/saveChapter.ts (ch00-ch02 are locked to the web editor). A
# disaster-recovery restore is exactly the case where that app-level lock
# shouldn't block the admin — see infra/DEPLOY.md "Backup & restore".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="journal"
NAMESPACE_ID="cabb8878cd364ea2b3d15baffb8fc052"
SRC_DIR="$ROOT/backups/kv-snapshots/latest"
AUTO_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) SRC_DIR="$2"; shift 2 ;;
    --yes) AUTO_YES=1; shift ;;
    *) echo "✗ Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ ! -d "$SRC_DIR" ]; then
  echo "✗ Backup directory not found: $SRC_DIR" >&2
  echo "  Run 'bash infra/backup-kv.sh' first, or pass --from <dir>." >&2
  exit 1
fi

source "$ROOT/infra/lib/cf-auth.sh"
load_cf_credentials_from_keychain

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "✗ No CLOUDFLARE_API_TOKEN available (Keychain entry 'journal-cloudflare-token'" >&2
  echo "  not found and none exported). See infra/DEPLOY.md — one-time credential setup." >&2
  exit 1
fi

shopt -s nullglob
files=("$SRC_DIR"/*.txt)
shopt -u nullglob
if [ "${#files[@]}" -eq 0 ]; then
  echo "✗ No <key>.txt files found in $SRC_DIR" >&2
  exit 1
fi

echo "▶ Comparing $SRC_DIR against live CHAPTERS_KV…"
echo ""

to_restore=()
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for f in "${files[@]}"; do
  key="$(basename "$f" .txt)"
  live="$tmp_dir/$key.live"
  if npx wrangler kv key get "$key" --namespace-id="$NAMESPACE_ID" > "$live" 2>/dev/null; then
    if diff -q "$live" "$f" >/dev/null 2>&1; then
      echo "  = $key   unchanged"
    else
      echo "  ~ $key   CHANGED"
      diff -u "$live" "$f" | sed 's/^/      /' || true
      to_restore+=("$key")
    fi
  else
    echo "  + $key   NEW (no live value yet)"
    to_restore+=("$key")
  fi
done

echo ""
if [ "${#to_restore[@]}" -eq 0 ]; then
  echo "✅ Live KV already matches the backup — nothing to restore."
  exit 0
fi

echo "About to overwrite live data for: ${to_restore[*]}"
if [ "$AUTO_YES" -ne 1 ]; then
  read -r -p "Restore ${#to_restore[@]} key(s) to live KV? This overwrites live data. [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted — no changes made." ; exit 1 ;;
  esac
fi

for key in "${to_restore[@]}"; do
  npx wrangler kv key put "$key" --path "$SRC_DIR/$key.txt" --namespace-id="$NAMESPACE_ID"
  echo "  ✓ restored $key"
done

echo ""
echo "✅ Restored ${#to_restore[@]} key(s) to live CHAPTERS_KV."
