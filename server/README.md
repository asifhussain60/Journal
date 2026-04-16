# Babu Journal — Local API Proxy

A 3-file Node/Express proxy that lets the Babu journal site call Claude without exposing the
Anthropic API key to the browser.

## Architecture

```
Browser (site/index.html @ :3000)
        |
        | fetch("http://localhost:3001/api/…")
        v
Proxy (server/src/index.js @ :3001)
        |
        | Anthropic SDK (key from macOS Keychain)
        v
Anthropic API (claude-sonnet-4-6 by default)
```

Binds to `127.0.0.1` only — never reachable from the network.

## Endpoints

| Method | Path              | Purpose                                                |
|--------|-------------------|--------------------------------------------------------|
| GET    | `/health`         | Liveness + key source diagnostics (no secrets emitted) |
| POST   | `/api/voice-test` | Babu-memoir smoke test (proves wiring end-to-end)      |
| POST   | `/api/chat`       | Generic passthrough — `{ system?, messages, model? }`  |

## Commands (run from `server/`)

```
npm install     # one time
npm start       # foreground
npm run dev     # with --watch (auto-restart on save)
npm run health  # GET /health (requires jq)
npm run smoke   # POST /api/voice-test (requires jq)
```

Setup runbook: see `../docs/proxy-setup.md`.
