# Journal Cloudflare Tunnel — Configuration Reference

**Tunnel name:** `journal-api`
**Domain:** `kashkole.com` (shared with NOOR-CANVAS, separate tunnel)
**Authentication:** credentials-based (mirrors NOOR-CANVAS pattern)
**Host machine:** the Mac running the Express proxy

## What this tunnel does

Exposes `https://journal-api.kashkole.com` publicly by routing Cloudflare edge
traffic into a local outbound connection from `cloudflared` on this Mac to
`http://127.0.0.1:3001`, where the Babu Journal proxy runs under launchd.

No inbound ports open on the Mac. No origin certificate needed (Cloudflare
terminates TLS at the edge; the tunnel protocol is its own auth). Auth-gated
by Cloudflare Access (email-PIN policy) before traffic reaches the tunnel.

## File locations

| File | Location |
|------|----------|
| `cloudflared` binary | `$(command -v cloudflared)` (typically `/opt/homebrew/bin/cloudflared`) |
| Credentials | `~/.cloudflared/<TUNNEL_UUID>.json` |
| Active config | `~/.cloudflared/journal-config.yml` |
| Template (git-tracked) | `infra/cloudflare/journal-config.template.yml` |
| launchd plist (git-tracked) | `infra/launchd/com.asif.cloudflared-journal.plist` |
| launchd plist (installed) | `~/Library/LaunchAgents/com.asif.cloudflared-journal.plist` |
| Runtime logs | `~/.cloudflared/journal-tunnel.log` |

**Credentials are NEVER committed** — `~/.cloudflared/*.json` lives outside the
repo. If you ever need to regenerate:

```sh
cloudflared tunnel token --cred-file "$HOME/.cloudflared/<TUNNEL_UUID>.json" <TUNNEL_UUID>
```

## First-time setup

```sh
# 1. Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# 2. Authenticate (opens browser, pick kashkole.com)
cloudflared tunnel login

# 3. Create the tunnel (prints UUID, writes credentials JSON)
cloudflared tunnel create journal-api

# 4. Render config + install launchd plist + start service (one-shot)
./infra/cloudflare/install-journal-tunnel.sh
```

## DNS setup (Cloudflare dashboard)

In dash.cloudflare.com → kashkole.com → DNS → Records, add:

| Name | Type | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| journal-api | CNAME | `<TUNNEL_UUID>.cfargotunnel.com` | ✅ Proxied | Auto |

(`journal` and `journal-dev` CNAMEs are created automatically by Cloudflare
Pages when you add custom domains to the Pages project.)

## Cloudflare Access (auth gate)

In one.dash.cloudflare.com → Access → Applications → **Add application → Self-hosted**:

- **Application domains:** `journal.kashkole.com`, `journal-dev.kashkole.com`, `journal-api.kashkole.com`
- **Identity provider:** One-Time PIN (email — built-in)
- **Policy:** Include → Emails → `asifhussain60@gmail.com`
- **Session duration:** 7 days (or your preference)

After save, copy two values from the application's Overview tab into the Mac's
`launchctl setenv` and into GitHub Actions secrets:

- `CF_ACCESS_TEAM_DOMAIN` — e.g. `asifhussain.cloudflareaccess.com`
- `CF_ACCESS_AUD` — long hex string under "Application Audience (AUD) Tag"

## Runtime management

```sh
# Health
curl -s http://localhost:3001/health | jq           # from the Mac (bypasses Access)
curl -I https://journal-api.kashkole.com/health     # from anywhere (hits Access gate)

# Restart tunnel
launchctl kickstart -k "gui/$(id -u)/com.asif.cloudflared-journal"

# Tail tunnel log
tail -f ~/.cloudflared/journal-tunnel.log

# Inspect tunnel
cloudflared tunnel info journal-api
```

## Troubleshooting

### `cloudflared: error: tunnel credentials file doesn't exist`
The credentials JSON was moved or deleted. Regenerate with the command in
"File locations" above.

### `Error 1016` at `journal-api.kashkole.com`
DNS resolves but the tunnel isn't connected. Check:
```sh
launchctl list | grep cloudflared-journal
tail ~/.cloudflared/journal-tunnel.log
```
Restart if needed: `launchctl kickstart -k "gui/$(id -u)/com.asif.cloudflared-journal"`.

### 401 on every API call from the deployed site
Cloudflare Access policy isn't covering the site hostname, or the cookie isn't
being sent cross-origin. Verify:
- Access application includes all three hostnames (site + preview + api)
- Browser DevTools shows `CF_Authorization` cookie on `journal-api.kashkole.com`
- `fetch()` calls use `credentials: "include"` (already done in `site/js/claude-client.js`)

### CORS error in browser console
The origin isn't in `ALLOWED_ORIGINS` on the server. Edit the env var in the
proxy's launchd plist (`ALLOWED_ORIGINS=…`) and kickstart the proxy.
