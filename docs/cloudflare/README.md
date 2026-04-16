# Cloudflare Pipeline — Operator's Guide

This directory is the field guide for the Cloudflare side of the Journal app:
how it's wired, how to bring it up from scratch, how to keep it running, and
what to do when it breaks.

If you're troubleshooting right now, jump to [troubleshooting.md](troubleshooting.md).

## The three pieces (one-paragraph mental model)

The Journal uses **three Cloudflare products** layered together:

1. **Workers static-assets** serves the SPA at [site/](../../site/) over Cloudflare's
   CDN at `journal.kashkole.com` (and `journal-dev.kashkole.com` for the
   `develop` preview). Configured by [wrangler.toml](../../wrangler.toml).
2. **Cloudflare Tunnel** (`journal-api`) connects `journal-api.kashkole.com`
   back to your Mac's Express proxy on `127.0.0.1:3001` — no inbound ports
   open. That proxy holds the Anthropic API key (from macOS Keychain) and does
   all model calls.
3. **Cloudflare Access** sits in front of all three hostnames with an email-PIN
   policy locked to `asifhussain60@gmail.com`. Edge-level auth before anything
   reaches the Mac.

```
            any browser / iPad / phone
                        │
              https://journal.kashkole.com      (static HTML/JS/CSS)
                        │
                        ├─ fetch → journal-api.kashkole.com   (API calls)
                        │
                    [ Cloudflare Access gate — email PIN ]
                        │
                    [ CF edge → cloudflared tunnel ]
                        │
                 your Mac: Express proxy on :3001
                        │
                    macOS Keychain → Anthropic API
```

## What's in this directory

| File | When to read it |
|------|-----------------|
| [architecture.md](architecture.md) | You want to understand the request path, trust boundaries, and what each layer actually does. |
| [setup.md](setup.md) | First-time bring-up, rebuilding on a new Mac, or restoring after wiping cloudflared state. |
| [operations.md](operations.md) | Daily ops — restarting services, reading logs, checking health, kickstarting launchd. |
| [troubleshooting.md](troubleshooting.md) | Something is broken. Symptom → diagnosis → fix. |
| [../../infra/cloudflare/tunnel-configuration.md](../../infra/cloudflare/tunnel-configuration.md) | Tunnel-specific reference (file paths, DNS, Access, runtime mgmt, modeled on the NOOR-CANVAS pattern). Lives next to the installer script. |

## The hard dependencies (memorize these)

- **Mac must be awake + online.** Sleep = tunnel dies = API down. Static site
  may still load from CDN cache; chat won't work.
- **Anthropic key lives in macOS Keychain**, loaded at proxy startup via
  [server/src/keychain.js](../../server/src/keychain.js). It is never in `.env`,
  never on Cloudflare, never in source.
- **`.env` is gitignored** — [.env.example](../../server/.env.example) is the
  tracked template. Real values go in `server/.env` on the Mac.
- **Credentials JSON is never committed** — `~/.cloudflared/<UUID>.json` lives
  outside the repo.

## Where things live (cheat sheet)

| Thing | Path |
|-------|------|
| Workers static-assets config | [wrangler.toml](../../wrangler.toml) |
| Tunnel installer script | [infra/cloudflare/install-journal-tunnel.sh](../../infra/cloudflare/install-journal-tunnel.sh) |
| Tunnel config template | [infra/cloudflare/journal-config.template.yml](../../infra/cloudflare/journal-config.template.yml) |
| Tunnel config (rendered, on Mac) | `~/.cloudflared/journal-config.yml` |
| Tunnel credentials (on Mac, secret) | `~/.cloudflared/<TUNNEL_UUID>.json` |
| Tunnel log | `~/.cloudflared/journal-tunnel.log` |
| Tunnel launchd plist (tracked) | [infra/launchd/com.asif.cloudflared-journal.plist](../../infra/launchd/com.asif.cloudflared-journal.plist) |
| Tunnel launchd plist (installed) | `~/Library/LaunchAgents/com.asif.cloudflared-journal.plist` |
| Proxy launchd plist (tracked) | [infra/launchd/com.asif.babu-journal-proxy.plist](../../infra/launchd/com.asif.babu-journal-proxy.plist) |
| Proxy launchd plist (installed) | `~/Library/LaunchAgents/com.asif.babu-journal-proxy.plist` |
| Proxy env template | [server/.env.example](../../server/.env.example) |
| Access JWT middleware | [server/src/middleware/access-auth.js](../../server/src/middleware/access-auth.js) |
| Browser API base switcher | [site/js/claude-client.js](../../site/js/claude-client.js) |
| CI workflow (PRs to main/develop) | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) |
| Release workflow (release-please) | [.github/workflows/release.yml](../../.github/workflows/release.yml) |

## One-minute health check

From the Mac:
```sh
curl -s http://localhost:3001/health | jq .
```
Should return `ok: true`, `access.enabled: true` (once CF env vars are set),
and the model name. If this fails, the proxy is down — see
[troubleshooting.md](troubleshooting.md#proxy-not-responding).

From anywhere (after CF Access PIN):
```sh
curl -I https://journal-api.kashkole.com/health
```
Should return `HTTP/2 200`. If you see `302` to a `cloudflareaccess.com` URL,
Access is working but your browser cookie isn't present (expected for curl
without `--cookie`).
