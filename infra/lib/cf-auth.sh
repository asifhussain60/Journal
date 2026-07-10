# infra/lib/cf-auth.sh — load Cloudflare credentials for non-interactive
# wrangler calls. Sourced by deploy.sh, backup-kv.sh, restore-kv.sh so the
# Keychain lookup lives in exactly one place.
#
# Auth, in order of preference:
#   1. CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID already exported — used as-is.
#   2. macOS Keychain — this project's token + account id, saved once via:
#        security add-generic-password -s journal-cloudflare-token \
#          -a journal -w '<token>' -U
#        security add-generic-password -s journal-cloudflare-account-id \
#          -a journal -w '<account id>' -U
#
# Callers that also want the interactive-OAuth fallback (deploy.sh) implement
# that themselves after sourcing this — it's deploy-specific, not shared.

PROJECT="${PROJECT:-journal}"

load_cf_credentials_from_keychain() {
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && command -v security >/dev/null 2>&1; then
    kc_token="$(security find-generic-password -s "${PROJECT}-cloudflare-token" -w 2>/dev/null || true)"
    kc_account="$(security find-generic-password -s "${PROJECT}-cloudflare-account-id" -w 2>/dev/null || true)"
    if [ -n "$kc_token" ]; then
      export CLOUDFLARE_API_TOKEN="$kc_token"
      [ -n "$kc_account" ] && export CLOUDFLARE_ACCOUNT_ID="$kc_account"
      echo "▶ Using Cloudflare credentials from Keychain (${PROJECT}-cloudflare-token)"
    fi
  fi
}
