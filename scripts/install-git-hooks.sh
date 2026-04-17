#!/usr/bin/env bash
# install-git-hooks.sh — install repo-managed git hooks into .git/hooks/
#
# Idempotent. Run after `git clone` or whenever hook sources change.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SRC_DIR="$REPO_ROOT/scripts/git-hooks"
DST_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$SRC_DIR" ]; then
  echo "Error: $SRC_DIR not found."
  exit 1
fi

if [ ! -d "$DST_DIR" ]; then
  echo "Error: $DST_DIR not found. Not a git repo?"
  exit 1
fi

installed=0
for hook in "$SRC_DIR"/*; do
  name="$(basename "$hook")"
  [ "$name" = "README.md" ] && continue
  cp "$hook" "$DST_DIR/$name"
  chmod +x "$DST_DIR/$name"
  echo "Installed: .git/hooks/$name"
  installed=$((installed + 1))
done

echo ""
echo "$installed hook(s) installed. Test with:"
echo "  git add <a theme-relevant file> && git commit -m 'test'"
