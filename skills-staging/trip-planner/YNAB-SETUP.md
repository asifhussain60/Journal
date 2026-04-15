# YNAB MCP Server — Quick Setup

## What This Does
Connects your YNAB account to Claude so the trip-planner skill can read your travel budget, check available funds before planning, and log trip expenses after travel.

## 3-Step Setup

### 1. Get Your YNAB Token
- Log in at https://app.ynab.com
- Click your email → **Account Settings** → **Developer Settings** → **New Token**
- Name it `MCP Server`, click **Generate**, copy the token

### 2. Install the Server
Open a terminal and run:
```
pip install mcp-ynab
```
Requires Python 3.13+. Alternatively, use `uvx mcp-ynab` (no install needed).

### 3. Add to Claude Desktop Config
Edit your config file at:
```
%APPDATA%\Claude\claude_desktop_config.json
```

Add this inside the `"mcpServers"` block:
```json
"ynab": {
  "command": "uvx",
  "args": ["mcp-ynab"],
  "env": {
    "YNAB_API_KEY": "PASTE-YOUR-TOKEN-HERE"
  }
}
```

Restart Claude Desktop. Done.

## Verify It Works
Ask Claude: "What budgets do I have in YNAB?" — if it responds with your budget list, you're connected.

## What the Trip-Planner Does With It
- Reads your Travel/Vacation category balance before planning
- Warns you if estimated trip cost exceeds budget
- Offers to create YNAB transactions for confirmed bookings
- Tracks actual vs. estimated spending post-trip

## Security
- Token is stored locally in your config file only
- Revoke anytime from YNAB → Account Settings → Developer Settings
- No data leaves your machine except to YNAB's own API
