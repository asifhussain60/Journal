#!/usr/bin/env bash
# infra/deploy.sh — build the site and deploy the journal Worker to Cloudflare.
#
# Adapted from SaltyLamps/salty-lamps-site/deploy-cloudflare.sh — same macOS
# Keychain credential pattern — but the journal is a *Worker* deploy
# (`wrangler deploy`, driven by the repo-root wrangler.toml), not a Pages deploy.
#
# Auth, in order of preference:
#   1. CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID already exported — used as-is.
#   2. macOS Keychain — this project's token + account id, saved once via:
#        security add-generic-password -s journal-cloudflare-token \
#          -a journal -w '<token>' -U
#        security add-generic-password -s journal-cloudflare-account-id \
#          -a journal -w '<account id>' -U
#   3. Interactive browser OAuth, as a last resort.
#
# Secrets (ANTHROPIC_API_KEY, GEMINI_API_KEY) are NOT set here —
# they are pushed once with `wrangler secret put <NAME>` (see infra/DEPLOY.md).
set -euo pipefail

# Repo root = parent of this script's directory (infra/..). wrangler.toml lives
# there, so every wrangler invocation resolves paths from the root as usual.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="journal"
LIVE_URL="https://journal.kashkole.com"

# ── Pre-flight ────────────────────────────────────────────────────────────

for bin in npm npx; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "✗ '$bin' not found on PATH — install Node.js first." >&2
    exit 1
  }
done

if [ ! -f "$ROOT/wrangler.toml" ]; then
  echo "✗ wrangler.toml not found at repo root ($ROOT) — refusing to deploy blind." >&2
  exit 1
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && command -v security >/dev/null 2>&1; then
  kc_token="$(security find-generic-password -s "${PROJECT}-cloudflare-token" -w 2>/dev/null || true)"
  kc_account="$(security find-generic-password -s "${PROJECT}-cloudflare-account-id" -w 2>/dev/null || true)"
  if [ -n "$kc_token" ]; then
    export CLOUDFLARE_API_TOKEN="$kc_token"
    [ -n "$kc_account" ] && export CLOUDFLARE_ACCOUNT_ID="$kc_account"
    echo "▶ Using Cloudflare credentials from Keychain (${PROJECT}-cloudflare-token)"
  fi
fi

# ── Build ─────────────────────────────────────────────────────────────────

echo "▶ Building site (npm run site:build)…"
npm run site:build
echo "  ✓ site/dist ready ($(du -sh site/dist | cut -f1))"

# ── Deploy ────────────────────────────────────────────────────────────────

deploy() { npx wrangler deploy; }

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "▶ Deploying the journal Worker with CLOUDFLARE_API_TOKEN (non-interactive)…"
  deploy
else
  echo "▶ No token found — deploying with the current wrangler login…"
  if ! deploy; then
    echo ""
    echo "⚠ Deploy failed. The most common cause is being logged into a"
    echo "  Cloudflare account that does not own the 'journal' Worker."
    echo "  A browser will open — sign into the account that should host it,"
    echo "  then click Allow."
    echo ""
    npx wrangler logout >/dev/null 2>&1 || true
    npx wrangler login
    deploy
  fi
fi

# ── Post-deploy verification ────────────────────────────────────────────

echo ""
echo "▶ Verifying $LIVE_URL is live and still gated by Access…"
status="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$LIVE_URL" || echo "000")"
case "$status" in
  302) echo "  ✓ HTTP 302 — redirecting to Cloudflare Access login, as expected." ;;
  000) echo "  ⚠ Could not reach $LIVE_URL (network/DNS issue) — check manually." ;;
  200) echo "  ⚠ HTTP 200 — the site served content WITHOUT an Access redirect." \
            "This means the app is currently unprotected; check the Access" \
            "application in the Cloudflare dashboard before sharing the link." ;;
  *)   echo "  ⚠ Unexpected HTTP $status from $LIVE_URL — check manually." ;;
esac

echo ""
echo "▶ Checking which runtime secrets are set…"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  set_secrets="$(npx wrangler secret list 2>/dev/null | grep -o '"name": *"[^"]*"' | sed -E 's/.*"([^"]+)"$/\1/' || true)"
  for s in ANTHROPIC_API_KEY GEMINI_API_KEY; do
    if echo "$set_secrets" | grep -qx "$s"; then
      echo "  ✓ $s is set"
    else
      echo "  ⚠ $s is NOT set — run: wrangler secret put $s"
    fi
  done
else
  echo "  (skipped — no CLOUDFLARE_API_TOKEN available for this check)"
fi

echo ""
echo "✅ Deployed the journal Worker → $LIVE_URL"
echo "   See infra/DEPLOY.md for the full setup record."
