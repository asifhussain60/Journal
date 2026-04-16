# Operations — Day-2 Maintenance

How to keep the CF pipeline running once it's set up. Restarts, logs, health
checks, env tweaks. For breakage see [troubleshooting.md](troubleshooting.md).

## Service inventory

Two launchd services, both owned by your user (not root):

| Label | What it runs | Plist |
|-------|--------------|-------|
| `com.asif.babu-journal-proxy` | Express proxy on `127.0.0.1:3001` | [infra/launchd/com.asif.babu-journal-proxy.plist](../../infra/launchd/com.asif.babu-journal-proxy.plist) |
| `com.asif.cloudflared-journal` | cloudflared tunnel `journal-api` | [infra/launchd/com.asif.cloudflared-journal.plist](../../infra/launchd/com.asif.cloudflared-journal.plist) |

Both have `KeepAlive` set to restart on crash and `RunAtLoad` to start at
login. `ThrottleInterval: 10` prevents tight crash loops.

## Status & health

```sh
# Is each service loaded?
launchctl list | grep -E 'babu-journal-proxy|cloudflared-journal'
# Expected: two lines, each with a PID (non-"-") and status 0.
#   PID="-"   → not running
#   status≠0  → crashed on last run; see logs

# Proxy health (bypasses Access via loopback)
curl -s http://localhost:3001/health | jq .

# Public-facing health (tests Access + tunnel + proxy together)
# In browser: https://journal-api.kashkole.com/health
# From curl (Access blocks unauthenticated curls by default):
curl -I https://journal-api.kashkole.com/health    # expect 302 to Access
```

The `/health` endpoint surfaces a lot of useful diagnostics:

```json
{
  "ok": true,
  "service": "babu-journal-proxy",
  "model": "claude-sonnet-4-6",
  "keySource": "keychain:anthropic_api_key",
  "port": 3001,
  "allowedOrigins": ["http://localhost:3000", "https://journal.kashkole.com", ...],
  "access": { "enabled": true, "teamDomain": "asifhussain.cloudflareaccess.com", "aud": "abcd1234…" },
  "ts": "2026-04-16T..."
}
```

When debugging, always check `/health` first. It tells you in one call:
- Is the proxy up? (request succeeded)
- Is the key loaded and where from? (`keySource`)
- Is Access middleware configured? (`access.enabled`)
- Are the expected origins allowed? (`allowedOrigins`)

## Restarting

`kickstart -k` stops the current process (if any) and starts a new one. This
is the equivalent of `systemctl restart` on Linux.

```sh
# Restart the proxy (picks up new server/.env values)
launchctl kickstart -k "gui/$(id -u)/com.asif.babu-journal-proxy"

# Restart the tunnel (picks up edited ~/.cloudflared/journal-config.yml)
launchctl kickstart -k "gui/$(id -u)/com.asif.cloudflared-journal"
```

`$(id -u)` resolves to your numeric UID. Needed because launchd treats
per-user services as `gui/<uid>/<label>`.

### When to restart what

| You changed… | Restart |
|--------------|---------|
| `server/.env` | proxy only |
| code in `server/src/**` | proxy only |
| `~/.cloudflared/journal-config.yml` | tunnel only |
| Cloudflare Access policy | nothing — takes effect on next request |
| DNS record | nothing — propagation only |
| `wrangler.toml` | nothing locally — next git push triggers redeploy |

## Logs

### Proxy
```sh
tail -f /Users/asifhussain/PROJECTS/journal/server/.logs/proxy.out.log
tail -f /Users/asifhussain/PROJECTS/journal/server/.logs/proxy.err.log
```

Usage logs (every auth'd request, for the Phase 8 budget system) go to
`server/logs/usage-YYYY-MM.jsonl`. One JSON row per request.

### Tunnel
```sh
tail -f ~/.cloudflared/journal-tunnel.log
```

Useful patterns to grep for:
- `Registered tunnel connection` — startup completed successfully (4 per tunnel).
- `Connection terminated` / `lost connection` — transient; cloudflared will
  reconnect.
- `error="Unable to reach the origin service"` — tunnel is up but proxy is
  down. Fix the proxy first.
- `error="context deadline exceeded"` — origin slow/hung. Check proxy logs.

### CF dashboard (authoritative for everything edge-side)
- **Access logs:** one.dash.cloudflare.com → Logs → Access (last 7 days,
  per-request auth decisions).
- **Tunnel metrics:** dash.cloudflare.com → Zero Trust → Networks → Tunnels
  → journal-api (connection status, request volume).
- **Workers analytics:** dash.cloudflare.com → Workers & Pages → journal →
  Metrics (requests per hostname, errors, cache hit rate).

## Updating secrets

### Rotate Cloudflare Access AUD (e.g. recreated the application)
1. Copy new AUD + team domain from Access → Applications → Overview.
2. Edit `server/.env`:
   ```ini
   CF_ACCESS_TEAM_DOMAIN=<new>
   CF_ACCESS_AUD=<new>
   ```
3. `launchctl kickstart -k "gui/$(id -u)/com.asif.babu-journal-proxy"`
4. Verify: `curl -s http://localhost:3001/health | jq .access`

### Rotate Anthropic key
```sh
security add-generic-password -a "$USER" -s anthropic_api_key -w "<new-key>" -U
# -U = update in place if exists
launchctl kickstart -k "gui/$(id -u)/com.asif.babu-journal-proxy"
curl -s http://localhost:3001/health | jq .keySource
```

### Rotate tunnel credentials (regenerate JSON)
Only needed if `~/.cloudflared/<UUID>.json` is corrupted/lost but the tunnel
still exists in CF:

```sh
TUNNEL_UUID=$(cloudflared tunnel list | awk '/journal-api/ {print $1}')
cloudflared tunnel token --cred-file "$HOME/.cloudflared/$TUNNEL_UUID.json" "$TUNNEL_UUID"
launchctl kickstart -k "gui/$(id -u)/com.asif.cloudflared-journal"
```

## Adding a new allowed origin

Say you want to test from a Tailscale-hosted laptop at `https://journal.tail-net.ts.net`:

1. Add to `server/.env`:
   ```ini
   ALLOWED_ORIGINS=http://localhost:3000,https://journal.kashkole.com,https://journal-dev.kashkole.com,https://journal.tail-net.ts.net
   ```
2. Restart proxy.
3. Add that hostname to the Cloudflare Access application too (otherwise it
   won't have a cookie to send).

## Taking the pipeline offline (e.g. during travel, scheduled maintenance)

- **Stop the tunnel:** `launchctl unload "$HOME/Library/LaunchAgents/com.asif.cloudflared-journal.plist"`
  — public API goes 502. Static site still loads from CDN cache.
- **Stop the proxy too:** `launchctl unload "$HOME/Library/LaunchAgents/com.asif.babu-journal-proxy.plist"`
  — belt-and-suspenders; nothing can reach Anthropic.
- **Come back online:** `launchctl load -w <plist>` for both, or just reboot.

You typically don't need to do this. The cleaner way to "go offline" is: close
your laptop lid. cloudflared dies with the machine; when you wake up it
reconnects within ~30s.

## Upgrading cloudflared

```sh
brew upgrade cloudflared
launchctl kickstart -k "gui/$(id -u)/com.asif.cloudflared-journal"
```

If the path changed (rare — e.g. after an Apple Silicon migration), re-run the
installer so the plist picks up the new binary path:

```sh
./infra/cloudflare/install-journal-tunnel.sh
```

## Monthly budget & throttle (Phase 8)

Not strictly CF, but worth noting here because it's the main "why did chat
stop working" cause that isn't CF:

- Hard cap: `MONTHLY_CAP` env (default `$50`).
- Visible in UI as the BudgetPill in nav.
- At 75% spend: soft throttle (model downgrade where possible).
- At 90% spend: hard throttle (429 on model calls).
- Roll over: first day of the month, the `usage-YYYY-MM.jsonl` path changes
  and spend counter resets.

To temporarily raise: edit `server/.env` `MONTHLY_CAP=100`, restart proxy.
