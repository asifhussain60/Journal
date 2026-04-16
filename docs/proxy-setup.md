# Babu Journal — Proxy Setup Runbook

One-time setup on your Mac. After this, the journal site talks to Claude automatically.

All commands are for **Terminal.app on your Mac** — never paste your API key into a chat, a file, or a screenshot.

---

## Prerequisites

- Node.js 20 or newer. Check with `node --version`. If missing: `brew install node`.
- Repo cloned at `~/Documents/PROJECTS/Journal` (adjust path everywhere below if different).

---

## Step 1 — Store the Anthropic key in macOS Keychain

Open Terminal and run **exactly one** of these (pick whichever you prefer):

**Option A — interactive prompt (key never appears in shell history):**
```
security add-generic-password -s anthropic-api-key -a "$USER" -w
```
It will prompt you. Paste your `sk-ant-...` key, press Enter. Done.

**Option B — inline (key appears in your shell history; delete history after):**
```
security add-generic-password -s anthropic-api-key -a "$USER" -w 'sk-ant-PASTE-HERE'
```

Verify it landed (this prints the key, so do it once and move on):
```
security find-generic-password -s anthropic-api-key -w
```

If you ever need to rotate it:
```
security delete-generic-password -s anthropic-api-key
security add-generic-password -s anthropic-api-key -a "$USER" -w
```

---

## Step 2 — Install proxy dependencies

```
cd ~/Documents/PROJECTS/Journal/server
npm install
```

---

## Step 3 — Smoke test (foreground, manual)

Start the proxy:
```
npm start
```

You should see:
```
[babu-journal-proxy] listening on http://127.0.0.1:3001  model=claude-sonnet-4-6  keySource=keychain
```

In a **second Terminal tab**, hit the health endpoint:
```
curl -s http://localhost:3001/health | jq
```

Then run the Babu voice smoke test:
```
curl -s -X POST http://localhost:3001/api/voice-test | jq
```

You should get back a short Babu-memoir opening line. That proves: key works, Keychain wired
correctly, Sonnet 4.6 responding, voice shape reasonable.

Stop the foreground proxy with `Ctrl+C`.

---

## Step 4 — Install auto-start at login (launchd)

Replace `{{REPO}}` placeholders with your real path and install the LaunchAgent:

```
REPO="$HOME/Documents/PROJECTS/Journal"
mkdir -p "$REPO/server/.logs"
sed "s|{{REPO}}|$REPO|g" "$REPO/infra/launchd/com.asif.babu-journal-proxy.plist" \
  > ~/Library/LaunchAgents/com.asif.babu-journal-proxy.plist
launchctl load -w ~/Library/LaunchAgents/com.asif.babu-journal-proxy.plist
```

Confirm it's running:
```
launchctl list | grep babu-journal
curl -s http://localhost:3001/health | jq
```

Logs live at `server/.logs/proxy.out.log` and `server/.logs/proxy.err.log`.

To stop / uninstall:
```
launchctl unload -w ~/Library/LaunchAgents/com.asif.babu-journal-proxy.plist
rm ~/Library/LaunchAgents/com.asif.babu-journal-proxy.plist
```

---

## Step 5 — Call from the journal site

From any JS in `site/index.html`, call the proxy:

```
// Example — voice test
const r = await fetch("http://localhost:3001/api/voice-test", { method: "POST" });
const data = await r.json();
console.log(data.text);

// Example — generic chat
const r2 = await fetch("http://localhost:3001/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    system: "You are helping Asif with his memoir. Babu, not Dad.",
    messages: [{ role: "user", content: "Refine this line: ..." }],
  }),
});
```

CORS is pre-configured to allow `http://localhost:3000` (the `npx serve` dev port).

---

## Troubleshooting

| Symptom                                      | Fix                                                                                      |
|----------------------------------------------|------------------------------------------------------------------------------------------|
| `No Anthropic API key found` on startup      | Keychain entry missing. Re-run Step 1.                                                   |
| `credit balance too low` in responses        | Top up credits at platform.claude.com/settings/billing.                                  |
| Port 3001 already in use                     | `lsof -iTCP:3001 -sTCP:LISTEN` to find the process, or change `PORT` env var.            |
| launchd says `Load failed: 5: Input/output…` | The `{{REPO}}` placeholder wasn't replaced. Re-run Step 4's `sed` line.                  |
| CORS blocked in browser console              | Your site is on a port other than 3000. Set `ALLOWED_ORIGIN` and restart the proxy.      |

---

## Security posture

- Key stored in macOS Keychain (encrypted at rest, OS-managed access control).
- Proxy binds to `127.0.0.1` only — never reachable from LAN or internet.
- `.env` is gitignored. `node_modules/` and `.logs/` are gitignored.
- Conversation transcripts are never sent anywhere except Anthropic's API.
- Monthly spend cap of $25 already enforced at the platform level.
