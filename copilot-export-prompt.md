# Copilot Task: Export DayOne "Ishrat Trips" Journal to JSON

## Objective
Export the DayOne journal named **"Ishrat Trips"** to a JSON file that the Babu web app can consume.

## Important Notes
- The DayOne CLI binary is at: `/Applications/Day One.app/Contents/MacOS/dayone`
- Do NOT use `dayone2` — it does not exist on this machine.
- The journal was recently renamed from "Ishrat's Visits" to "Ishrat Trips" (no apostrophe, no special characters).

## Steps

### Step 1: Try the export command
```bash
"/Applications/Day One.app/Contents/MacOS/dayone" export --journal "Ishrat Trips" --format JSON --output ~/Desktop/ishrat-trips-export
```

If that fails (this CLI build has limited commands), try these alternatives:

### Step 2 (Fallback A): Try export2 or different syntax
```bash
"/Applications/Day One.app/Contents/MacOS/dayone" export2 --journal "Ishrat Trips" --format json --output ~/Desktop/ishrat-trips-export
```

### Step 3 (Fallback B): Use AppleScript via osascript
```bash
osascript -e 'tell application "Day One" to export journal "Ishrat Trips" to format JSON to path "~/Desktop/ishrat-trips-export"'
```

### Step 4 (Fallback C): Manual export instructions
If none of the CLI approaches work, report back with the exact error messages. The user can manually export from DayOne app:
1. Open Day One app
2. Select "Ishrat Trips" journal in sidebar
3. File → Export → JSON
4. Save to: `~/Desktop/ishrat-trips-export/`

### Step 5: Copy export to app data folder
Once the export exists (by any method), copy it:
```bash
cp -r ~/Desktop/ishrat-trips-export/* /Users/asifhussain/PROJECTS/journal/site/data/
```

### Step 6: Report back
List the files created in `/Users/asifhussain/PROJECTS/journal/site/data/` and report:
- How many entries were exported
- The file names and sizes
- The structure of one sample entry (first 50 lines of the JSON)

**Do NOT modify any files — only export and copy.**
