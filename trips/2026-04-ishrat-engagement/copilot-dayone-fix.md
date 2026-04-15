# Copilot Task: Diagnose & Fix DayOne CLI

## Scope Boundary
**ALL work is restricted to the journal repo only.** Do not read, modify, or reference any other repos under `C:\Users\ahussain\Documents\PROJECTS\`. Do not install packages globally or modify anything outside this repo's folder tree — EXCEPT creating the dayone2 symlink if found.

## Problem
`dayone2` CLI not found. Neither on PATH nor at expected bundle path `/Applications/Day One.app/Contents/Resources/dayone2`.

## Step 1: Find the Day One app and CLI binary
Run ALL of these diagnostic commands:

```bash
# Where is the Day One app actually installed?
mdfind "kMDItemCFBundleIdentifier == 'com.bloombuilt.dayone-mac'" 2>/dev/null

# Broader search — any Day One app
mdfind "kMDItemDisplayName == 'Day One'" -onlyin /Applications 2>/dev/null
ls -la /Applications/ | grep -i "day"

# Search for the CLI binary anywhere in the app bundle
find /Applications -name "dayone2" -type f 2>/dev/null

# Check if it's a different binary name
find /Applications -path "*/Day One*" -name "dayone*" -type f 2>/dev/null

# Check Homebrew
brew list --cask | grep -i day 2>/dev/null
brew list | grep -i day 2>/dev/null
```

## Step 2: Based on findings, take ONE of these paths

### If binary found at a different path:
```bash
# Create symlink (replace ACTUAL_PATH with what you found)
sudo ln -sf "ACTUAL_PATH/dayone2" /usr/local/bin/dayone2
dayone2 --version
```

### If no CLI binary exists in the app bundle:
Day One's CLI helper may need to be enabled from within the app:
1. Open Day One app
2. Go to Day One menu → Install Command Line Tools (if available)
3. Or try: Preferences → General → look for CLI toggle

If that menu option doesn't exist, the CLI can be installed via:
```bash
# Option A: Install CLI tools via the app's helper
"/Applications/Day One.app/Contents/MacOS/Day One" --install-cli 2>/dev/null

# Option B: If Setapp or direct download version
brew install --cask day-one
```

### If Day One is NOT installed as a native macOS app:
The CLI only works with the macOS native app (App Store or direct download). If Asif only has iOS/web, CLI won't work.

## Step 3: If CLI is now working, create the entry
```bash
dayone2 new -j "Ishrat's Visits" -t trip ishrat engagement new-jersey 2026 trip-log-demo -- <<'ENTRY'
# Trip Prep Day — Building the Machine

Five days out. The suitcases aren't packed yet, but the scaffolding for this trip is more deliberate than anything we've done before.

Today was architecture day — not for the trip itself, but for how we'll remember it. I built an interactive itinerary for our nine days: flights on United, the engagement party in Fresh Meadows, fondue at The Melting Pot, spa day at Ocean Place. Every card expandable, every detail at Ishrat's fingertips so she doesn't have to ask me "what time is checkout?" for the fifteenth time.

Then the budget panel — YNAB Holiday transactions pulled live into the itinerary sidebar. Entertainment, flights, transport, travel insurance. Real numbers, not estimates. DM Mono font so the dollar signs actually line up. Ishrat will love that I'm tracking this. Or she'll roll her eyes. Either way, the numbers are honest.

The bigger work was invisible: restructuring the entire journal repo. Deleted the ChatGPT-era artifacts that were cluttering the place — old GPT scratchpads, disconnected dashboards, duplicate reference files. Consolidated everything into a single reference/ folder. Created FRAMEWORK.md — the governing document that defines how the journal skill, trip-log, and trip-planner talk to each other. Three skills, clear boundaries, one shared contract (trip.yaml).

This is the first entry created through the trip-log → DayOne pipeline. If this works, every day of the trip gets logged in memoir voice, tagged automatically, and fed back into the chapter engine for "What I Wish Babu Taught Me."

Five days. Then Ishrat lands at Newark, and the real entries begin.

---
*Tagged: trip, ishrat, engagement, new-jersey, 2026*
*Trip: Ishrat's Engagement Party Trip (Apr 20-28)*
*Memoir chapters: ch02-love, ch04-faith*
ENTRY
```

Then verify:
```bash
dayone2 list -j "Ishrat's Visits" -n 1
```

## Step 4: Report back to Cowork
Paste this back to Claude in Cowork:

```
DayOne CLI Diagnostic Report:
- App location: [paste mdfind/ls result]
- CLI binary found: [yes/no, path if yes]
- Fix applied: [symlink / brew install / menu toggle / none]
- dayone2 --version: [paste output or "still not available"]
- Entry created: [yes/no]
- Entry verification (list -n 1): [paste output or error]
- Journal names visible: [paste `dayone2 list-journals` if CLI works]
```
