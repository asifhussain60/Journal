# YNAB MCP Server — VS Code Copilot Setup

## What This Does
Connects your YNAB account to GitHub Copilot in VS Code so you can query budgets, transactions, and categories directly from the Copilot chat panel.

---

## Step 1: Get Your YNAB Token
(Skip if you already generated one — ending in -QKFVa8)

1. Log in at https://app.ynab.com
2. Click your email → **Account Settings** → **Developer Settings** → **New Token**
3. Name it `MCP Server`, click **Generate**, copy the token

---

## Step 2: Create the MCP Config File

VS Code uses `.vscode/mcp.json` (per workspace) or a user-level `mcp.json`.

### Option A: Per-Workspace (Recommended)

Create `.vscode/mcp.json` in your project root:

```json
{
  "inputs": [
    {
      "id": "ynab-api-key",
      "type": "promptString",
      "description": "YNAB Personal Access Token",
      "password": true
    }
  ],
  "servers": {
    "ynab": {
      "command": "uvx",
      "args": ["mcp-ynab"],
      "env": {
        "YNAB_API_KEY": "${input:ynab-api-key}"
      }
    }
  }
}
```

This prompts you securely for the token each session — nothing stored in plain text.

### Option B: With Token Inline (Simpler, Less Secure)

```json
{
  "servers": {
    "ynab": {
      "command": "uvx",
      "args": ["mcp-ynab"],
      "env": {
        "YNAB_API_KEY": "paste-your-full-token-here"
      }
    }
  }
}
```

If using this option, add `.vscode/mcp.json` to your `.gitignore` so the token doesn't get committed.

---

## Step 3: Install Prerequisites

Open a terminal and ensure you have `uvx` available:

```
pip install uv
```

Or if you prefer not to install `uv`, use Python directly:

```json
{
  "servers": {
    "ynab": {
      "command": "python",
      "args": ["-m", "mcp_ynab"],
      "env": {
        "YNAB_API_KEY": "${input:ynab-api-key}"
      }
    }
  }
}
```

(This requires `pip install mcp-ynab` first. Python 3.13+ required.)

---

## Step 4: Verify in VS Code

1. Open VS Code
2. Open the Copilot Chat panel (Ctrl+Shift+I or click the Copilot icon)
3. Look for the MCP tools icon (wrench/hammer) — YNAB should appear in the tools list
4. Ask Copilot: **"What budgets do I have in YNAB?"**
5. If it returns your budget list, you're connected

---

## Troubleshooting

**"Server failed to start"**
- Check that `uvx` or `python` is on your PATH. Run `uvx --version` or `python --version` in VS Code's integrated terminal.
- Python 3.13+ is required for mcp-ynab.

**"No tools found"**
- Reload VS Code window (Ctrl+Shift+P → "Developer: Reload Window")
- Check the MCP output channel: View → Output → select "MCP" from the dropdown

**Token issues**
- If using the `input` prompt method, VS Code will ask for the token when the server first connects
- If the token was revoked, generate a new one from YNAB Developer Settings

---

## Important Notes

- VS Code uses `mcp.json` with a `"servers"` key — NOT `"mcpServers"` (that's Claude Desktop format)
- The `inputs` array with `password: true` is the secure way to handle API tokens in VS Code
- Per-workspace config (`.vscode/mcp.json`) keeps the setup scoped to the right project
