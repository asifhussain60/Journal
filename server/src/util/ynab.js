// util/ynab.js — YNAB access token + budget id loader.
// Token: macOS Keychain under service name `ynab-access-token`, falls back
// to env `YNAB_ACCESS_TOKEN`. Budget id: keychain `ynab-budget-id`, env
// `YNAB_BUDGET_ID`, or the ASIFNAB default.
// Returns { token:null } when no token is configured so routes can degrade
// to a zeroed response.

import { execFileSync } from "node:child_process";

const DEFAULT_BUDGET_ID = "be121939-693d-46e1-a5a8-14fbd8a802ff"; // ASIFNAB

function readKeychain(service) {
  try {
    const val = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return val || null;
  } catch { return null; }
}

export function loadYnabConfig() {
  const token =
    readKeychain("ynab-access-token") ||
    (process.env.YNAB_ACCESS_TOKEN && process.env.YNAB_ACCESS_TOKEN.trim()) ||
    null;
  const budgetId =
    readKeychain("ynab-budget-id") ||
    (process.env.YNAB_BUDGET_ID && process.env.YNAB_BUDGET_ID.trim()) ||
    DEFAULT_BUDGET_ID;
  return { token, budgetId, source: token ? "keychain/env" : null };
}
