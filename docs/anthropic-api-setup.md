# Anthropic API Key Setup — Complete Record

> Performed April 15–16, 2026 on Asif's MacBook Air.
> This document records every step, URL, and command used to get the Anthropic API key working with the Babu Journal local proxy.

---

## Step 1 — Create the API key

| Detail | Value |
|--------|-------|
| **Wrong URL tried first** | `platform.claude.com/claude-code/settings` (Claude Code managed settings — not personal API keys) |
| **Correct URL** | <https://console.anthropic.com/settings/keys> (also reachable via `platform.claude.com/settings/keys`) |
| **Navigation path** | Workspace dropdown → Organization settings → API keys |
| **Action** | Clicked **Create key**, named it `ahhome`, assigned to **Default** workspace |
| **Result** | Full `sk-ant-api03-...` string shown once at creation and captured |

---

## Step 2 — Fund the account

| Detail | Value |
|--------|-------|
| **URL** | <https://platform.claude.com/settings/billing> (left sidebar → Billing) |
| **Starting tier** | Evaluation access (free) — every API call returned `credit balance too low` |
| **Action** | Clicked **Buy credits**, paid **$50** via Link by Stripe |
| **Confirmation** | Invoice history showed "Credit grant — Paid — $50.00" dated Apr 16, 2026 |

---

## Step 3 — Guardrails (spend limits)

| Detail | Value |
|--------|-------|
| **URL** | <https://platform.claude.com/settings/limits> (left sidebar → Limits) |
| **Monthly spend cap** | Set to **$25** (resets May 1) |
| **Email notification** | Recommended at **$18** (75% burn warning) — confirm this is set |

---

## Step 4 — Key-storage strategy decision

**Chosen: macOS Keychain** over `.env` files or `~/.zshrc` exports.

Rationale:
- The `sk-ant-...` string is **never** pasted into a chat window, config file, or git.
- It lives encrypted in the Mac's secure store (Keychain).
- Only the proxy process retrieves it at startup via the `security` CLI.

---

## Step 5 — Scaffold the local proxy

| Detail | Value |
|--------|-------|
| **Repo location** | `/Users/asifhussain/PROJECTS/journal` (lowercase `journal` on Mac) |
| **Server path** | `server/` subdirectory |
| **Port** | `3001`, bound to `127.0.0.1` only (loopback — unreachable from network) |
| **CORS** | Locked to `http://localhost:3000` |
| **Key retrieval** | `/usr/bin/security find-generic-password -s anthropic-api-key -w` at startup, with env var `ANTHROPIC_API_KEY` as fallback |
| **Default model** | `claude-sonnet-4-6` |

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness + model + key-source diagnostics (no secrets) |
| `POST` | `/api/voice-test` | Babu-memoir smoke test (proves wiring + voice) |
| `POST` | `/api/refine` | Voice DNA refinement using `reference/voice-fingerprint.md` as system prompt (5-second cache) |
| `POST` | `/api/chat` | Generic passthrough: `{ system?, messages, model?, max_tokens? }` |

---

## Step 6 — Store the key in Keychain

```bash
security add-generic-password -s anthropic-api-key -a "$USER" -w
```

- Prompts for the key interactively so it **never appears in shell history**.
- Pasted `sk-ant-...`, pressed Enter.
- Verified with:

```bash
security find-generic-password -s anthropic-api-key -w
```

(Prints the key — safe to do once locally, never in a shared context.)

---

## Step 7 — Install dependencies & foreground smoke test

```bash
cd /Users/asifhussain/PROJECTS/journal/server && npm install
```

Result: 92 packages installed, 0 vulnerabilities.

```bash
node /Users/asifhussain/PROJECTS/journal/server/src/index.js
```

Server output:
```
[babu-journal-proxy] listening on http://127.0.0.1:3001  model=claude-sonnet-4-6  keySource=keychain
```

Smoke test:
```bash
curl -s -X POST http://localhost:3001/api/voice-test -H 'Content-Type: application/json' -d '{}'
```

Response:
```json
{
  "ok": true,
  "model": "claude-sonnet-4-6",
  "stopReason": "end_turn",
  "usage": {
    "input_tokens": 102,
    "output_tokens": 14
  },
  "text": "Babu could fill a room with his absence."
}
```

This confirmed: **billing ✓ · key ✓ · Keychain ✓ · CORS ✓ · Sonnet 4.6 ✓**

---

## Step 8 — Install auto-start via launchd

Plist template: `infra/launchd/com.asif.babu-journal-proxy.plist` (contains `{{REPO}}` placeholders).

```bash
REPO="/Users/asifhussain/PROJECTS/journal"
mkdir -p "$REPO/server/.logs"

sed "s|{{REPO}}|$REPO|g" "$REPO/infra/launchd/com.asif.babu-journal-proxy.plist" \
  > ~/Library/LaunchAgents/com.asif.babu-journal-proxy.plist

launchctl load -w ~/Library/LaunchAgents/com.asif.babu-journal-proxy.plist
```

Verification:
```bash
launchctl list | grep babu-journal
# Output: 59254   0   com.asif.babu-journal-proxy

curl -s http://localhost:3001/health
```

Health response:
```json
{
  "ok": true,
  "service": "babu-journal-proxy",
  "model": "claude-sonnet-4-6",
  "keySource": "keychain",
  "port": 3001,
  "allowedOrigin": "http://localhost:3000"
}
```

Proxy now **auto-starts at every login**.

---

## Step 9 — Reload command after code changes

When server code changes (e.g., adding `/api/refine`):

```bash
launchctl kickstart -k gui/$(id -u)/com.asif.babu-journal-proxy
```

This is the go-to command any time `server/src/*.js` changes.

> The voice fingerprint at `reference/voice-fingerprint.md` hot-reloads on a 5-second cache — no kickstart needed for voice tuning.

---

## Security posture summary

| Layer | Detail |
|-------|--------|
| **Key storage** | macOS Keychain (OS-managed encrypted store). Never in `.env`, never in git, never in chat transcripts. |
| **Network binding** | Proxy binds to `127.0.0.1` only — unreachable from the network. |
| **Git exclusions** | `.gitignore` extended to exclude `.env`, `node_modules/`, `server/.logs/`. |
| **Spend cap** | $25/month enforced at the Anthropic platform level. |

### To rotate the key

```bash
# Delete old key
security delete-generic-password -s anthropic-api-key

# Add new key (interactive prompt)
security add-generic-password -s anthropic-api-key -a "$USER" -w

# Restart proxy to pick up new key
launchctl kickstart -k gui/$(id -u)/com.asif.babu-journal-proxy
```

---

## Bookmark these URLs

| URL | Purpose |
|-----|---------|
| <https://console.anthropic.com/settings/keys> | Manage / rotate API keys |
| <https://platform.claude.com/settings/billing> | Credits, usage, auto-reload |
| <https://platform.claude.com/settings/limits> | Monthly cap and spend notifications |

---

## Key files in the repo

| Path | Purpose |
|------|---------|
| `server/src/index.js` | Proxy entry point |
| `server/src/keychain.js` | Keychain key retrieval |
| `server/package.json` | Dependencies & scripts |
| `infra/launchd/com.asif.babu-journal-proxy.plist` | LaunchAgent template |
| `docs/proxy-setup.md` | Original setup runbook |
| `reference/voice-fingerprint.md` | Voice DNA for `/api/refine` |
| `server/.logs/proxy.out.log` | stdout log |
| `server/.logs/proxy.err.log` | stderr log |
