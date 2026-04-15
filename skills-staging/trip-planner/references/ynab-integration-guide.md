# YNAB MCP Integration Guide

## Overview

The trip-planner skill integrates with YNAB (You Need A Budget) through the `mcp-ynab` MCP server, providing real-time budget awareness for trip planning. This enables reading existing category balances, creating trip-specific budget categories, and logging travel expenses directly from itineraries.

## Setup Instructions

### Step 1: Get Your YNAB Personal Access Token

1. Log in to YNAB at https://app.ynab.com
2. Go to **Account Settings** (click your email in the sidebar)
3. Scroll to **Developer Settings**
4. Click **New Token**
5. Name it: `MCP Server` (or any descriptive name)
6. Click **Generate**
7. **Copy the token immediately** — you won't see it again

### Step 2: Install mcp-ynab

On your local machine, run:

```
pip install mcp-ynab
```

Or using uvx (no install needed):

```
uvx mcp-ynab
```

**Requires Python 3.13+**

### Step 3: Configure MCP Client

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "uvx",
      "args": ["mcp-ynab"],
      "env": {
        "YNAB_API_KEY": "your-personal-access-token-here"
      }
    }
  }
}
```

**Config file locations:**
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

### Step 4: Verify Connection

Restart Claude Desktop. You should see YNAB tools available in the MCP tools list.

---

## Available YNAB MCP Tools (30+)

### Budget Tools
- `ynab_get_budgets` — List all budgets in your YNAB account
- `ynab_get_budget` — Get details of a specific budget
- `ynab_get_budget_settings` — Get budget settings (currency, date format)

### Account Tools
- `ynab_get_accounts` — List all accounts in a budget
- `ynab_get_account` — Get a specific account

### Category Tools
- `ynab_get_categories` — List all category groups and categories
- `ynab_get_category` — Get a specific category with balance info
- `ynab_get_month_category` — Get category data for a specific month

### Transaction Tools
- `ynab_get_transactions` — List transactions (with filters)
- `ynab_create_transaction` — Create a single transaction
- `ynab_create_transactions` — Create multiple transactions at once
- `ynab_update_transaction` — Update an existing transaction
- `ynab_get_transactions_by_account` — Filter by account
- `ynab_get_transactions_by_category` — Filter by category
- `ynab_get_transactions_by_payee` — Filter by payee

### Payee Tools
- `ynab_get_payees` — List all payees
- `ynab_get_payee` — Get a specific payee

### Month Tools
- `ynab_get_months` — List budget months
- `ynab_get_month` — Get a specific month's budget data

### Scheduled Transaction Tools
- `ynab_get_scheduled_transactions` — List scheduled transactions
- `ynab_get_scheduled_transaction` — Get a specific scheduled transaction

### Analytics (Delta Sync)
- Delta sync support — only fetches data changed since last call, improving performance

---

## Trip-Planner Integration Points

### Pre-Trip: Budget Check
Before building an itinerary, the planner can:
1. Read the user's YNAB budget to understand available funds
2. Check existing "Travel" or "Vacation" category balances
3. Factor real budget constraints into accommodation and activity recommendations

### During Planning: Budget Estimation
The planner creates a budget breakdown and can:
1. Compare estimated trip cost against available YNAB category funds
2. Flag if the trip exceeds budgeted amounts
3. Suggest budget-tier adjustments based on available funds

### Post-Trip: Expense Logging
After a trip (via trip-log integration), the planner can:
1. Create YNAB transactions for each expense category
2. Assign expenses to the correct YNAB categories
3. Track actual vs. estimated spending

### YNAB Tool Usage in Skill

When YNAB MCP is connected, the trip-planner skill should:

```
1. Call ynab_get_budgets → identify the primary budget
2. Call ynab_get_categories → find travel/vacation category
3. Call ynab_get_category (for travel category) → get available balance
4. Use balance to inform budget tier recommendation
5. After itinerary is built, offer to create scheduled transactions for known bookings
```

---

## Security Notes

- The Personal Access Token never expires but can be revoked anytime from YNAB Developer Settings
- The token provides READ and WRITE access to all budgets in your YNAB account
- Store the token only in the MCP configuration file — never commit it to git
- The mcp-ynab server runs locally on your machine; no data leaves your computer except to YNAB's API

---

*This guide is consulted by the trip-planner skill when YNAB integration is enabled.*
