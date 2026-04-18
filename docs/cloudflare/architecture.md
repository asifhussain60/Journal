# Architecture — How the CF Pipeline Works

This doc explains what each layer does, what data crosses it, and where the
trust boundaries are. If a request is misbehaving, this is the doc that tells
you *which layer* to investigate.

## The full request path

A user on an iPad opens `https://journal.kashkole.com/itineraries/itinerary.html?trip=2026-04-ishrat-engagement`
and asks the Trip Assistant a question. Here's every hop:

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Browser → Cloudflare edge (HTML/JS/CSS)                         │
│     DNS:  journal.kashkole.com → CF edge IP                         │
│     TLS:  terminated at CF edge                                     │
│     Auth: CF Access intercepts → email-PIN if no cookie             │
│           ↓ (PIN issued → CF_Authorization cookie set on .kashkole) │
│     Serves: site/**/*.html from wrangler Workers static-assets      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                   (page loads; JS starts running)
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  2. Browser JS → claude-client.js picks API base                    │
│     defaultApiBase() (site/js/claude-client.js:11)                  │
│       host === "localhost"  → http://localhost:3001                 │
│       else                  → https://journal-api.kashkole.com      │
│     All fetches set {credentials: "include"} so CF_Authorization    │
│     rides along cross-origin.                                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  3. Browser → journal-api.kashkole.com (API call)                   │
│     DNS:  CNAME to <TUNNEL_UUID>.cfargotunnel.com                   │
│     TLS:  terminated at CF edge                                     │
│     Auth: CF Access validates CF_Authorization cookie               │
│           - valid?   → inject Cf-Access-Jwt-Assertion header        │
│           - invalid? → redirect to Access login                     │
│     CORS: preflight checked against ALLOWED_ORIGINS on server       │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  4. CF edge → cloudflared tunnel (outbound-only from Mac)           │
│     No inbound port on Mac. cloudflared runs under launchd and      │
│     maintains 4 QUIC connections to CF edge servers.                │
│     Ingress rule in ~/.cloudflared/journal-config.yml:              │
│       journal-api.kashkole.com → http://127.0.0.1:3001              │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  5. Express proxy middleware chain (server/src/index.js)            │
│     (a) CORS check       → origin in ALLOWED_ORIGINS?               │
│     (b) accessAuth()     → verify Cf-Access-Jwt-Assertion against   │
│                            CF JWKS (jose.createRemoteJWKSet)        │
│                            issuer = https://<CF_ACCESS_TEAM_DOMAIN> │
│                            audience = CF_ACCESS_AUD                 │
│                            loopback requests bypass                 │
│     (c) usageLogger      → captures every auth'd request            │
│     (d) rateLimiter      → per-route token buckets                  │
│     (e) throttleBudget   → soft/hard budget gates (Phase 8)         │
│     (f) route handler    → e.g. /api/trip-qa                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  6. Route handler → Anthropic API                                   │
│     Key: loaded from macOS Keychain at proxy startup                │
│          (server/src/keychain.js; KEY_SOURCE surfaced in /health)   │
│     SDK: @anthropic-ai/sdk                                          │
│     Response: model output → usage logged → returned to browser     │
└─────────────────────────────────────────────────────────────────────┘
```

## Trust boundaries

There are three boundaries where auth posture changes. Knowing which one an
incident sits behind narrows diagnosis fast.

### Boundary 1: Internet → Cloudflare edge (Access gate)
- **Who is trusted:** nobody until email PIN completes.
- **How:** CF Access intercepts at the edge for any hostname in the Access
  application. Policy: `Include → Emails → asifhussain60@gmail.com`.
- **On success:** issues `CF_Authorization` cookie on `.kashkole.com`
  (7-day session by default).
- **Bypass paths:** none from the public internet. Only way around it is a
  direct curl to `127.0.0.1:3001` from the Mac itself (see Boundary 3).

### Boundary 2: CF edge → your Mac (tunnel)
- **Who is trusted:** cloudflared itself — the tunnel protocol auth uses the
  credentials JSON at `~/.cloudflared/<UUID>.json`.
- **How:** cloudflared makes outbound QUIC connections to CF edge; CF routes
  matching ingress hostnames back through those connections.
- **What to know:** no inbound firewall rule is needed on the Mac. The tunnel
  is the only path public traffic can reach the proxy.

### Boundary 3: Express middleware (defense in depth)
- **Why it exists:** even though Access fronts everything, someone with local
  access to the Mac could curl `127.0.0.1:3001` directly. `accessAuth()`
  middleware defends against forged traffic that *wasn't* through Access.
- **How:** verifies the `Cf-Access-Jwt-Assertion` header CF injects against
  the team's public JWKS at `https://<TEAM>/cdn-cgi/access/certs`.
- **Loopback bypass:** intentional. Local dev from `http://localhost:3000` and
  launchd-originated scripts go through the same middleware but are waved past
  via `isLoopback(req)` ([access-auth.js:39](../../server/src/middleware/access-auth.js#L39)).
- **Disabled-mode behavior:** if `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD`
  are unset, every request passes through. This preserves pre-CF local-dev
  behavior byte-identically. The `/health` endpoint reports
  `access.enabled: false` in that mode — a red flag in prod.

## The env-aware API base (critical detail)

`site/js/claude-client.js` picks the base URL at script load time:

```js
function defaultApiBase() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "") {
    return "http://localhost:3001";      // dev: hits proxy directly, no tunnel
  }
  return "https://journal-api.kashkole.com";  // prod + preview: via tunnel
}
```

Why this matters:
- **One codebase, two environments.** Same JS served on localhost and on
  `journal.kashkole.com` routes correctly without env injection.
- **`credentials: "include"` on every fetch.** The CF Access cookie is on
  `.kashkole.com`; the fetch from `journal.kashkole.com` to `journal-api.kashkole.com`
  is cross-origin, so without `credentials: include` the cookie wouldn't
  ride along and every API call would get a 302 to Access login.
- **Override hook:** set `window.BABU_AI_PROXY_URL` before `claude-client.js`
  loads to point at a custom tunnel (e.g. a second Mac).

## CORS configuration

Server-side, [server/src/index.js](../../server/src/index.js) sets:

```js
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  "http://localhost:3000,https://journal.kashkole.com,https://journal-dev.kashkole.com"
).split(",").map(s => s.trim()).filter(Boolean);
```

- **Defaults cover all three production-relevant origins.** You rarely need
  to set `ALLOWED_ORIGINS` explicitly.
- **`credentials: true`** on the CORS config is required because the browser
  sends the CF Access cookie. A missing `credentials:true` causes a silent
  preflight failure that looks like a generic CORS error.
- **Methods:** `GET`, `POST` only. Adding new verbs requires editing this list.

## Branch → environment mapping

| Branch | Hostname | Backend | Who sees it |
|--------|----------|---------|-------------|
| `main` | `journal.kashkole.com` | Workers production | anyone with email PIN |
| `develop` | `journal-dev.kashkole.com` | Workers preview env (`env.preview`) | same — both gated by same Access app |
| PR branches | `<preview>.journal.pages.dev` (if you enable it) | Workers preview | same — Access covers `*.kashkole.com` only; raw pages.dev URLs bypass Access unless added |

The `env.preview` block in [wrangler.toml](../../wrangler.toml) is what gives
`develop` its own alias. If you add more environments, replicate that pattern.

## What isn't in Cloudflare

- **The Anthropic API key.** macOS Keychain only. Surfaces in `/health` as
  `keySource` (e.g. `"keychain:anthropic_api_key"`).
- **Cowork.** Memoir synthesis, git, YNAB drains, reference/ writes — all
  happen in Claude Code running in your terminal. The CF pipeline is the App
  surface only.
- **Trip data.** Stays on the Mac filesystem at [trips/](../../trips/). The
  proxy reads/writes; the browser never touches files directly.
