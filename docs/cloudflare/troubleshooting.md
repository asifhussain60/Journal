# Troubleshooting — Symptom-Driven Fix Guide

Find your symptom below, follow the decision tree, fix the root cause. Each
entry cross-references to [architecture.md](architecture.md) where useful so
you can see *why* a given check rules a layer in or out.

## Fastest first check (works for almost everything)

```sh
# From the Mac:
curl -s http://localhost:3001/health | jq .

# Then from any other device:
# Browser → https://journal.kashkole.com (full stack)
# Browser → https://journal-api.kashkole.com/health (API only)
```

If `/health` on loopback works but the public URL doesn't, the problem is
in the CF layer (tunnel, Access, DNS). If loopback itself fails, the proxy
is down.

---

## Symptom: Site loads but chat/trip-edit does nothing

**What you see:** itinerary page renders, FloatingChat opens, but sending a
message does nothing (or a silent error in the panel).

**Diagnose:**

1. Open DevTools Network tab, send a chat message, find the failing request.
2. Look at the status code:

| Status | Meaning | Fix |
|--------|---------|-----|
| `(failed)` / net::ERR_CONNECTION_REFUSED | API base unreachable. On localhost → proxy down. On prod → tunnel down. | Restart the appropriate service. |
| `302 Found` → `cloudflareaccess.com` | Access cookie missing or expired. | User needs to re-auth. See [#access-cookie-missing](#access-cookie-missing). |
| `401` with `{"error":"cloudflare access token missing"}` | Request reached proxy but didn't come through Access. Usually misconfigured origin. | See [#origin-bypass](#origin-bypass). |
| `401` with `{"error":"cloudflare access token invalid: ..."}` | JWT verify failed. AUD/team mismatch. | See [#aud-mismatch](#aud-mismatch). |
| `403` with CORS error in console | Origin not in `ALLOWED_ORIGINS`. | See [#cors-error](#cors-error). |
| `429` | Rate limit or budget throttle. | Check BudgetPill; if near cap, see operations.md → Monthly budget. |
| `502` | Proxy down or Anthropic error. | Check proxy logs. |

---

## Symptom: "Unable to reach the origin service" in tunnel log

<a id="unable-to-reach-origin"></a>
**Cause:** cloudflared is running and connected to CF, but can't hit
`http://127.0.0.1:3001` on your Mac. Almost always the proxy.

**Diagnose:**
```sh
launchctl list | grep babu-journal-proxy
# If PID is "-", the proxy isn't running.

tail /Users/asifhussain/PROJECTS/journal/server/.logs/proxy.err.log
# Look for startup errors — usually a missing Keychain key or port collision.
```

**Common fixes:**
- **Port 3001 already in use:** `lsof -iTCP:3001 -sTCP:LISTEN -n -P` shows
  who's on it. Kill the squatter, restart the proxy.
- **Keychain key missing:**
  ```sh
  security find-generic-password -a "$USER" -s anthropic_api_key -w
  # If this errors, the key isn't there. Re-add:
  security add-generic-password -a "$USER" -s anthropic_api_key -w "sk-ant-..."
  ```
- **node not found (rare):** the plist uses `bash -lc` which reads your login
  profile; if you've moved node to a non-standard location and haven't
  updated your shell rc, the subshell won't find it. Test with:
  ```sh
  /bin/bash -lc "which node"
  ```

---

## Symptom: Error 1016 at `journal-api.kashkole.com`

**Meaning:** DNS resolves to CF, but CF has no tunnel registered for that
hostname.

**Diagnose:**
```sh
# Is cloudflared running?
launchctl list | grep cloudflared-journal

# Is the tunnel connected?
tail -20 ~/.cloudflared/journal-tunnel.log
# Look for "Registered tunnel connection" (should see 4 of these)

# Is the DNS CNAME pointing at the right UUID?
cloudflared tunnel info journal-api
dig +short journal-api.kashkole.com CNAME
# The CNAME should match <UUID>.cfargotunnel.com
```

**Fix:**
- Tunnel not running: `launchctl kickstart -k "gui/$(id -u)/com.asif.cloudflared-journal"`
- CNAME mismatch: edit the DNS record in dash.cloudflare.com to match the
  UUID from `cloudflared tunnel info`.
- Tunnel exists in config but not in CF: `cloudflared tunnel list` should
  show it. If not, the tunnel was deleted in CF. Create a new one, update
  the CNAME, re-run `./infra/cloudflare/install-journal-tunnel.sh`.

---

## Symptom: Browser redirects to Access login on every request

<a id="access-cookie-missing"></a>
**Usually expected.** First visit per browser per ~session duration triggers
PIN. If it happens every few minutes, something is wrong.

**Diagnose:**

1. DevTools → Application → Cookies → `.kashkole.com`
2. Look for `CF_Authorization`. If absent or expired every minute:

| Cause | Fix |
|-------|-----|
| Session duration in Access app is too short (e.g. 15 min) | Raise to 7 days in the Access application settings. |
| Browser is blocking third-party cookies and your site + API are considered cross-site | Access cookie is on `.kashkole.com` parent domain, should not be blocked. Check browser privacy settings / tracking protection. |
| Fetches from JS don't include `credentials: "include"` | Already set in [site/js/claude-client.js:26](../../site/js/claude-client.js#L26). If you added a new fetch elsewhere, copy that pattern. |
| Origin not in Access application's hostname list | Add all three: `journal`, `journal-dev`, `journal-api`. |

---

## Symptom: `401` from proxy saying "cloudflare access token missing"

<a id="origin-bypass"></a>
**Meaning:** a request reached the proxy without going through Access. This
middleware ([access-auth.js](../../server/src/middleware/access-auth.js))
rejects unauthenticated public traffic as defense in depth.

**Normal cases where this is OK:** localhost dev (loopback bypass) and launchd
scripts (also loopback).

**Abnormal cases:**
- Someone is curling `journal-api.kashkole.com` from a device that isn't
  browser-cookied and without `--cookie`. Expected — curl without cookies
  can't get through Access. Use a browser or `cloudflared access curl`.
- A reverse proxy upstream is stripping the `Cf-Access-Jwt-Assertion` header.
  Check what's between the edge and the Mac. Normally nothing — cloudflared
  is direct.

---

## Symptom: `401` saying "cloudflare access token invalid: ..."

<a id="aud-mismatch"></a>
**Meaning:** JWT signature verified, but issuer or audience doesn't match.

**Diagnose:**
```sh
curl -s http://localhost:3001/health | jq .access
# {
#   "enabled": true,
#   "teamDomain": "asifhussain.cloudflareaccess.com",
#   "aud": "abcd1234…"   ← first 8 chars of expected AUD
# }
```

Compare against the value in dash Access → Applications → Journal → Overview
→ "Application Audience (AUD) Tag". If different:

1. Update `server/.env` `CF_ACCESS_AUD=<correct value>`.
2. `launchctl kickstart -k "gui/$(id -u)/com.asif.babu-journal-proxy"`
3. Re-verify `/health`.

Similarly for `CF_ACCESS_TEAM_DOMAIN` — it's the subdomain of
`cloudflareaccess.com` you use to sign in, not `kashkole.com`.

If `enabled: false` but you expect it to be on, your `.env` didn't load:
- Check the proxy plist uses `node --env-file=.env` — it does
  ([com.asif.babu-journal-proxy.plist:23](../../infra/launchd/com.asif.babu-journal-proxy.plist#L23)).
- Check `server/.env` exists (not just `.env.example`).

---

## Symptom: CORS error in browser console

<a id="cors-error"></a>
**Typical message:** "Access to fetch at 'https://journal-api.kashkole.com/...'
from origin 'https://journal.kashkole.com' has been blocked by CORS policy"

**Diagnose:**
```sh
curl -s http://localhost:3001/health | jq .allowedOrigins
```

Your origin must appear in that list exactly, scheme + host, no trailing
slash.

**Fix:** add it via `ALLOWED_ORIGINS` in `server/.env` and restart. Example:
```ini
ALLOWED_ORIGINS=http://localhost:3000,https://journal.kashkole.com,https://journal-dev.kashkole.com
```

**Silent CORS failures** are usually caused by `credentials: true` on server
without `credentials: "include"` on client (or vice versa). Both are set
correctly in this repo — if you added a new client route, preserve the
pattern.

**Preflight 204 but real request 403:** you probably changed an
`ALLOWED_ORIGINS` value that doesn't match the `Origin` header byte-for-byte.
Check for trailing slashes.

---

## Symptom: Deploy to `journal.kashkole.com` not updating

**Diagnose:**

1. dash.cloudflare.com → Workers & Pages → journal → Deployments
2. Find the deployment for your commit. If missing, the git integration isn't
   wired or didn't fire.

**Common causes:**
- Git integration not connected. Settings → Build & Deploy → connect repo.
- Wrong production branch. Must be `main`.
- Deploy failed — click into the failed deployment to see Wrangler's error.
  The most common is a path issue with `directory` in [wrangler.toml](../../wrangler.toml)
  — it's set to `./site` (relative to repo root).
- CDN caching — CF Workers static-assets should invalidate on deploy. If
  you're still seeing the old file: hard reload (Cmd+Shift+R), check the
  `cf-cache-status` response header.

---

## Symptom: Wrangler `deploy` fails locally

**Diagnose:**
```sh
wrangler whoami
# If not logged in: wrangler login
```

- **`Could not resolve "./site"`:** you're not in the repo root. `cd` to the
  repo, then `wrangler deploy`.
- **`Project not found`:** your account doesn't have the project. Create it
  via the dashboard or let the first `wrangler deploy` create it.
- **Changes to `wrangler.toml` not reflected:** CF caches project metadata
  for a minute. Wait and retry.

---

## Symptom: iPad / iPhone loads the page but Access PIN email doesn't arrive

**Diagnose:**
- Check the sending address (`noreply@notify.cloudflare.com`) isn't in spam.
- Check the PIN wasn't already sent — CF rate-limits PIN emails to
  ~1/minute per address.
- Gmail's tabbed inbox may file it under "Updates" or "Promotions".

**Fix:** search Gmail for `from:(notify.cloudflare.com)`. If truly missing,
switch Access identity provider to something other than One-Time PIN (e.g.
add Google as an IdP under Access → Settings → Authentication).

---

## Symptom: Chat works locally but fails from iPad with `{ok: false}` but no specific error

**Diagnose:**

1. Open Safari Web Inspector on the iPad (Mac → Safari → Develop menu → iPad).
2. Network tab → find the failing request → look at Response.
3. Compare against the fast-path table at the top of this doc.

**Classic iPad-specific gotchas:**
- iOS Safari aggressive cache — try a new private tab.
- Cellular data carrier blocking certain TLS SNI (rare). Switch to WiFi.
- iPad hasn't completed the Access PIN flow on this browser yet.

---

## Symptom: Mac went to sleep / restarted; everything down

**Expected behavior after wake:**
- Proxy: launchd restarts it at login (`RunAtLoad: true`).
- Tunnel: same.
- Net effect: ~30 seconds of 502s at the public URL after wake, then
  recovery.

**If it *doesn't* recover:**
```sh
launchctl list | grep -E 'babu-journal-proxy|cloudflared-journal'
# Any label missing? Reload its plist:
launchctl load -w "$HOME/Library/LaunchAgents/<missing-label>.plist"
```

**Prevent in the future:** `System Settings → Energy Saver → "Prevent your
Mac from sleeping automatically when the display is off"`. Leave it plugged
in.

---

## Symptom: CI workflow fails on a PR

Two workflows exist:

| Workflow | File | What it does |
|----------|------|--------------|
| CI | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | `validate-schemas.mjs`, `validate-markers.mjs`, `node --check` on every `site/js/*.js` |
| Release | [.github/workflows/release.yml](../../.github/workflows/release.yml) | release-please on push to `main` |

**Diagnose a failure:**
```sh
gh run list --branch <your-branch> --limit 3
gh run view <run-id> --log-failed
```

**Common failures:**
- `validate-markers.mjs` error: you edited a memoir file without respecting
  `@@` markers. See [reference_markers_workflow](../../.claude/projects/-Users-asifhussain-PROJECTS-journal/memory/reference_markers_workflow.md).
- `validate-schemas.mjs` error: a JSON file in `trips/**/pending.json` or
  `server/src/schemas/**/fixtures/` broke its schema. The log names the
  offending file and the Ajv error.
- `node --check` on `site/js/*.js`: syntax error in a client bundle. Fix
  locally, push again.

---

## Escape hatch: full-pipeline nuclear restart

If you've tried three things and nothing works, start from the bottom and
walk up:

```sh
# 1. Restart both services
launchctl kickstart -k "gui/$(id -u)/com.asif.babu-journal-proxy"
launchctl kickstart -k "gui/$(id -u)/com.asif.cloudflared-journal"
sleep 5

# 2. Confirm proxy
curl -s http://localhost:3001/health | jq .

# 3. Confirm tunnel connected
grep "Registered tunnel connection" ~/.cloudflared/journal-tunnel.log | tail -5

# 4. Confirm public endpoint (expect 302 to Access, not timeout)
curl -I https://journal-api.kashkole.com/health

# 5. Open browser, re-do PIN if needed
```

If step 2 fails → see [#unable-to-reach-origin](#unable-to-reach-origin).
If step 3 fails → check `~/.cloudflared/journal-tunnel.log` for the actual
error and search for it in this doc.
If step 4 times out → check the DNS CNAME and CF tunnel status in dashboard.

---

## When to escalate (i.e. look outside this repo)

- **CF dashboard outage page** (`www.cloudflarestatus.com`) shows an incident
  matching your symptom → wait it out.
- **`cloudflared tunnel info journal-api`** shows the tunnel but logs say
  nothing can connect → might be a Cloudflare regional issue; try
  `cloudflared tunnel run --edge <region>` to force a different region.
- **Repeated JWT verify errors despite matching AUD** → CF rotated their JWKS
  and the `jose` client is caching the old one. Restart the proxy to force a
  refetch from `https://<TEAM>/cdn-cgi/access/certs`.
