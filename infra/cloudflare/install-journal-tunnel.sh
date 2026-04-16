#!/usr/bin/env bash
# install-journal-tunnel.sh — one-shot installer for the Journal API tunnel.
#
# Pre-reqs (run these once, interactively, before invoking this script):
#   1. brew install cloudflare/cloudflare/cloudflared
#   2. cloudflared tunnel login           # browser OAuth to pick kashkole.com
#   3. cloudflared tunnel create journal-api   # writes ~/.cloudflared/<UUID>.json
#
# What this script does:
#   - Finds the journal-api tunnel UUID from ~/.cloudflared/
#   - Renders the versioned template into ~/.cloudflared/journal-config.yml
#   - Installs the launchd plist into ~/Library/LaunchAgents/
#   - Loads it so the tunnel starts at login and restarts on crash.
#
# Idempotent — re-running only rewrites the config + reloads launchd.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CF_DIR="$HOME/.cloudflared"
LAUNCHAGENTS="$HOME/Library/LaunchAgents"
LABEL="com.asif.cloudflared-journal"
TEMPLATE="$REPO_ROOT/infra/cloudflare/journal-config.template.yml"
PLIST_TEMPLATE="$REPO_ROOT/infra/launchd/$LABEL.plist"
PLIST_INSTALLED="$LAUNCHAGENTS/$LABEL.plist"
CONFIG_INSTALLED="$CF_DIR/journal-config.yml"

# --- Sanity checks ----------------------------------------------------------
if [ ! -d "$CF_DIR" ]; then
  echo "ERROR: $CF_DIR not found. Run 'cloudflared tunnel login' first." >&2
  exit 1
fi

# Find the journal-api tunnel UUID. cloudflared names the credentials file
# by UUID; the tunnel's name is tracked in Cloudflare, not the filename.
# Most reliable: ask cloudflared itself.
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: cloudflared not in PATH. brew install cloudflare/cloudflare/cloudflared" >&2
  exit 1
fi

TUNNEL_UUID=$(cloudflared tunnel list 2>/dev/null | awk '/^[a-f0-9-]+[[:space:]]+journal-api[[:space:]]/{print $1; exit}')
if [ -z "${TUNNEL_UUID:-}" ]; then
  echo "ERROR: no tunnel named 'journal-api' found." >&2
  echo "       Run: cloudflared tunnel create journal-api" >&2
  exit 1
fi

CRED_FILE="$CF_DIR/$TUNNEL_UUID.json"
if [ ! -f "$CRED_FILE" ]; then
  echo "ERROR: credentials file $CRED_FILE missing." >&2
  echo "       Run: cloudflared tunnel token --cred-file \"$CRED_FILE\" $TUNNEL_UUID" >&2
  exit 1
fi

echo "==> Tunnel UUID: $TUNNEL_UUID"
echo "==> Credentials: $CRED_FILE"

# --- Render config.yml from template ----------------------------------------
mkdir -p "$CF_DIR"
sed -e "s|<TUNNEL_UUID>|$TUNNEL_UUID|g" \
    -e "s|<HOME>|$HOME|g" \
    "$TEMPLATE" > "$CONFIG_INSTALLED"
echo "==> Wrote $CONFIG_INSTALLED"

# --- Install launchd plist --------------------------------------------------
mkdir -p "$LAUNCHAGENTS"
# Resolve cloudflared path (brew puts it in /opt/homebrew/bin on Apple Silicon,
# /usr/local/bin on Intel). Bake the real path into the plist.
CLOUDFLARED_BIN=$(command -v cloudflared)
sed -e "s|{{CLOUDFLARED_BIN}}|$CLOUDFLARED_BIN|g" \
    -e "s|{{HOME}}|$HOME|g" \
    "$PLIST_TEMPLATE" > "$PLIST_INSTALLED"
echo "==> Installed $PLIST_INSTALLED"

# --- Load (or reload) the service ------------------------------------------
if launchctl list | grep -q "$LABEL"; then
  echo "==> Reloading existing $LABEL service"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
  echo "==> Loading $LABEL service"
  launchctl load -w "$PLIST_INSTALLED"
fi

sleep 2
echo
echo "==> Status:"
launchctl list | grep -E "PID\s+Status\s+Label|$LABEL" || echo "(service not yet reporting — check ~/.cloudflared/journal-tunnel.log)"
echo
echo "==> Next: add DNS CNAME 'journal-api' → $TUNNEL_UUID.cfargotunnel.com (proxied) in Cloudflare dashboard"
echo "==> Then test: curl -I https://journal-api.kashkole.com/health"
