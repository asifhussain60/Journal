# Setup — Bringing the CF Pipeline Up from Zero

Use this when you're on a fresh Mac, recovering from a wipe, or helping a
future-you who has forgotten everything. Estimated time end-to-end: **~20
minutes**, most of it waiting for DNS/Access propagation.

**Pre-reqs you probably already have:**
- A Cloudflare account with `kashkole.com` on it.
- The Journal repo checked out (this repo).
- Node 20+ installed (`node --version`).
- Anthropic API key in macOS Keychain (see [server/src/keychain.js](../../server/src/keychain.js)).
- `brew` available.

Each numbered section is independently runnable — if you only need to rebuild
one layer, skip ahead.

---

## 1. Install & start the Express proxy (local)

This is the thing the tunnel will eventually point at. Stand it up locally
first so you can verify each layer in isolation.

```sh
cd /Users/asifhussain/PROJECTS/journal/server
npm ci
cp .env.example .env    # edit the real values in later
node src/index.js       # should log: "listening on http://127.0.0.1:3001 ..."
```

Sanity check:
```sh
curl -s http://localhost:3001/health | jq .
```

Expected: `ok: true`, `keySource: "keychain:..."`, `access.enabled: false`
(CF env vars not set yet — that's fine at this stage).

### Install the proxy launchd agent (so it auto-starts)

The plist at [infra/launchd/com.asif.babu-journal-proxy.plist](../../infra/launchd/com.asif.babu-journal-proxy.plist)
has `{{REPO}}` placeholders. Render and install:

```sh
REPO=/Users/asifhussain/PROJECTS/journal
sed "s|{{REPO}}|$REPO|g" \
    "$REPO/infra/launchd/com.asif.babu-journal-proxy.plist" \
    > "$HOME/Library/LaunchAgents/com.asif.babu-journal-proxy.plist"
launchctl load -w "$HOME/Library/LaunchAgents/com.asif.babu-journal-proxy.plist"
```

Verify it's running:
```sh
launchctl list | grep babu-journal-proxy
# Should show PID and 0 (clean exit status)
```

Log locations: `server/.logs/proxy.out.log` and `server/.logs/proxy.err.log`.

---

## 2. Create the Cloudflare Tunnel

### 2a. Install cloudflared + auth
```sh
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel login     # opens browser → pick kashkole.com
```

This writes `~/.cloudflared/cert.pem` — the cert that lets you create tunnels
under kashkole.com.

### 2b. Create the tunnel
```sh
cloudflared tunnel create journal-api
```

This:
- Creates a tunnel named `journal-api` in your CF account.
- Prints a UUID.
- Writes `~/.cloudflared/<UUID>.json` with the tunnel credentials.

**Do not commit that JSON.** It's equivalent to a key.

### 2c. Run the installer

```sh
cd /Users/asifhussain/PROJECTS/journal
./infra/cloudflare/install-journal-tunnel.sh
```

What it does (see [infra/cloudflare/install-journal-tunnel.sh](../../infra/cloudflare/install-journal-tunnel.sh)):
- Finds the UUID by running `cloudflared tunnel list` and grepping for `journal-api`.
- Renders [infra/cloudflare/journal-config.template.yml](../../infra/cloudflare/journal-config.template.yml)
  into `~/.cloudflared/journal-config.yml` with real paths.
- Renders the launchd plist into `~/Library/LaunchAgents/` with the real
  `cloudflared` binary path.
- `launchctl load -w` so it starts now and at every login.

If the installer prints `ERROR: no tunnel named 'journal-api' found`, step 2b
didn't complete. Re-run it.

### 2d. Add the DNS record

In **dash.cloudflare.com → kashkole.com → DNS → Records**:

| Name | Type | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| `journal-api` | CNAME | `<TUNNEL_UUID>.cfargotunnel.com` | ✅ Proxied | Auto |

Get the UUID from `cloudflared tunnel info journal-api` or the installer's output.

### 2e. Verify the tunnel end-to-end

From the Mac:
```sh
tail ~/.cloudflared/journal-tunnel.log
# Look for lines like: "Registered tunnel connection" (4 of them, one per CF region)
```

From anywhere:
```sh
curl -I https://journal-api.kashkole.com/health
```

At this point (Access not yet configured), you should get `HTTP/2 200`
directly from the proxy. Once Access is up, this will 302 to Access login
instead — that's expected.

---

## 3. Configure Cloudflare Access

In **one.dash.cloudflare.com → Access → Applications → Add application → Self-hosted**:

- **Application name:** `Journal`
- **Session duration:** `7 days` (or your preference; longer = fewer PIN
  prompts but wider compromise window)
- **Application domains — add all three:**
  - `journal.kashkole.com`
  - `journal-dev.kashkole.com`
  - `journal-api.kashkole.com`

**Add a policy:**
- **Name:** `Only Asif`
- **Action:** `Allow`
- **Rules:** `Include → Emails → asifhussain60@gmail.com`

**Identity provider:** One-Time PIN (Email) — built in, no setup.

Save. First time you visit any of the three hostnames in a browser, you'll
get a PIN challenge.

### 3a. Copy the AUD tag into server/.env

From the Access application's **Overview** tab, copy:
- **Application Audience (AUD) Tag** — long hex string.
- **Team domain** — from your Access sign-in URL, e.g.
  `asifhussain.cloudflareaccess.com` (visit
  `one.dash.cloudflare.com → Settings → General`).

Add to `server/.env` (see [server/.env.example](../../server/.env.example)):

```ini
CF_ACCESS_TEAM_DOMAIN=asifhussain.cloudflareaccess.com
CF_ACCESS_AUD=<paste AUD here>
```

Restart the proxy so it picks up the new env:
```sh
launchctl kickstart -k "gui/$(id -u)/com.asif.babu-journal-proxy"
```

Verify it took:
```sh
curl -s http://localhost:3001/health | jq .access
# Expected:
# {
#   "enabled": true,
#   "teamDomain": "asifhussain.cloudflareaccess.com",
#   "aud": "abcd1234…"
# }
```

---

## 4. Deploy the static site (Workers static-assets)

[wrangler.toml](../../wrangler.toml) is already in the repo. You need to
create the matching Workers project in Cloudflare.

### 4a. Install Wrangler (one-time)
```sh
npm install -g wrangler
wrangler login    # browser OAuth
```

### 4b. First deploy (manual, just once)
```sh
cd /Users/asifhussain/PROJECTS/journal
wrangler deploy
```

This creates the Workers project named `journal` (from `name` in
`wrangler.toml`) and publishes `site/**` as static assets. The output includes
the `*.workers.dev` URL.

### 4c. Add custom domains

In **dash.cloudflare.com → Workers & Pages → journal → Settings → Domains &
Routes → Custom Domains**:

- Add `journal.kashkole.com` → points at production env.
- For preview: in **journal-dev** (the auto-created env from `env.preview`),
  add `journal-dev.kashkole.com`.

(Cloudflare writes the CNAME records for these automatically.)

### 4d. Wire git-driven deploys

In the same project settings, connect the GitHub repo:
- Production branch: `main`
- Preview branch: `develop`

Every push to `main` → production deploy. Every push to `develop` → preview
deploy. PRs get ephemeral preview URLs.

(If you prefer GitHub Actions over CF's git integration, add a
`wrangler deploy` step to a deploy workflow. Not currently done.)

### 4e. Verify

```sh
curl -I https://journal.kashkole.com/
# Without Access cookie: expect 302 to https://<team>.cloudflareaccess.com/...
# With cookie (browser): expect 200 serving site/index.html
```

---

## 5. Protect `main` in GitHub

**github.com/<owner>/<repo> → Settings → Branches → Branch protection rules → Add rule**:

- **Branch name pattern:** `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Select the `CI / Validate schemas + markers` check from [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- ✅ Do not allow bypassing the above settings

This ensures nothing lands on `main` without the CI gate.

---

## 6. Release-please

[.github/workflows/release.yml](../../.github/workflows/release.yml) runs on
every push to `main` and opens a release PR when there are conventional
commits to release. Merging that PR cuts a tag + GitHub release.

No setup needed beyond the file being present and the default `GITHUB_TOKEN`
having `contents: write` + `pull-requests: write` (declared in the workflow).

---

## 7. Final end-to-end smoke test

1. Open a browser (incognito, so no existing cookies): `https://journal.kashkole.com`
2. Should redirect to Access PIN challenge.
3. Enter `asifhussain60@gmail.com`, get PIN in email, paste.
4. Journal loads.
5. Open Trip Assistant, ask a question — should stream a response.
6. Check usage: `https://journal.kashkole.com` → BudgetPill in nav.

If any step fails, see [troubleshooting.md](troubleshooting.md).

---

## Rebuilding on a new Mac

Short version — the only machine-specific state lives in `~/.cloudflared/`
and Keychain. Everything else is in the repo.

1. Clone the repo.
2. Install Node, brew, `cloudflared`, Wrangler.
3. Put the Anthropic key back in Keychain:
   ```sh
   security add-generic-password -a "$USER" -s anthropic_api_key -w "sk-ant-..."
   ```
4. Steps 1, 2, 3 above (proxy + tunnel + Access env). You do **not** need
   to recreate the tunnel in Cloudflare — it's tied to the UUID, and the
   UUID lives in the credentials JSON. If you still have that JSON (iCloud
   backup, password manager), copy it to `~/.cloudflared/` and skip
   `cloudflared tunnel create`. If not, create a new one and point the
   existing DNS CNAME at the new UUID.
5. No Pages/Workers setup needed — git-driven deploys already fire on
   pushes.
