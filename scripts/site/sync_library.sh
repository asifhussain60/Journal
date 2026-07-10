#!/usr/bin/env bash
# sync_library.sh — one-way mirror from the parsed reference libraries into the site bundle.
#
# Source of truth: content/babu-memoir/_system/_generated/library.json
#                   (produced by scripts/memoir/parse_libraries.py)
# Mirror:          site/src/data/library.json  (bundled into the Vite build)
#
# Run after scripts/memoir/parse_libraries.py, before any site deploy. Idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/content/babu-memoir/_system/_generated/library.json"
DST_DIR="$REPO_ROOT/site/src/data"
DST="$DST_DIR/library.json"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: parsed library missing: $SRC" >&2
  echo "Run: python3 scripts/memoir/parse_libraries.py" >&2
  exit 1
fi

mkdir -p "$DST_DIR"
cp "$SRC" "$DST"

echo "Library mirror synced: $DST"
