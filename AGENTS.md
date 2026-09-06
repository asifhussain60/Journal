# Journal repo — session orientation

You're in the **`journal`** repo (split from the original `Journal` on
2026-05-22 — see [_workspace/runbooks/repo-split.md](https://github.com/asifhussain60/podcast-factory/blob/develop/_workspace/runbooks/repo-split.md) in the
sibling `podcast-factory` repo for the migration history). This file is
auto-loaded by Codex on every session in this directory; treat it
as your standing brief.

## What this repo contains

- **Babu memoir** (`content/babu-memoir/`, `skills-staging/journal/`) — Asif's memoir authoring engine. **Asif IS Babu** (the memoir's protagonist).
- **Journal site** (`site/`) — static React display of memoir chapters. Local-only after the 2026-05-22 Cloudflare deploy retirement; serve via `npx serve site` if needed. No deploy target attached.
- **Memoir tooling** (`scripts/memoir/`) — `auto_delta.py`, `save_snapshot.py`, `detect_user_delta.py`, `refresh_all_snapshots.py`. Drives chapter authoring + snapshot review.
- **Site sync** (`scripts/site/sync_chapters.sh`) — mirrors `content/babu-memoir/chapters/` → `site/chapters/` for the static site.

This repo is **fully self-contained** post-split. It has no shared paths, no submodules, no symlinks with the sibling `podcast-factory` repo. Duplicated general-utility items (skills, agents, reference materials, `content/_shared/arabic/`) are independent copies that evolve separately from podcast-factory's copies.

## What this repo does NOT contain (sibling repo)

The following lives in the sibling **[podcast-factory](https://github.com/asifhussain60/podcast-factory)** repo (renamed from `Journal` post-split):

- Podcast pipeline (`scripts/podcast/`, `library/books/`, `_workspace/books/`, `skills-staging/podcast/`)
- Azure infrastructure (`infra/azure/`)
- Cross-machine operator coordination (`_workspace/plan/operators/`)
- Book branches, worktrees, and the entire cross-machine podcasting model

The journal repo is single-machine, single-purpose. **No machine ID file is needed; no operator-coordination required.**

## What this repo no longer contains (RETIRED 2026-05-22)

- **Cloudflare deploy scaffold**: `wrangler.toml`, `site-worker.js`, `infra/cloudflare/`, `docs/cloudflare/` — removed because the journal app no longer needs the Anthropic API and so no longer needs the Workers proxy or the deployed surface.
- **Anthropic API proxy** (`server/`): the Node/Express proxy that bound to 127.0.0.1:3001 — same reason as above.
- **Docs related to the retired stack**: `docs/anthropic-api-setup.md`, `docs/proxy-setup.md`.

If a future memoir feature needs the API again, decide whether to re-add `server/` here or use a different mechanism — don't reach into the podcast-factory's Anthropic plumbing.

## Read these once per machine, or when conventions feel stale

- **Response template** — every substantive response follows the 4-part shape: `## At a glance — <severity emoji> <status>` + numbered summary → `---` → `### N.` PROSE body sections → `---` → `## Next: 👤 Asif` / `## Next: 🤖 AI` with `A. (Recommended) Do all of the below in order (B → C → D)` + sub-paths. Canonical reference is in the sibling podcast-factory repo's `_workspace/plan/response-template.md` (pulled into `~/.Codex/response-template.md` via `@-import` if user-level install is set up).
- **Memoir conventions**: Asif IS Babu — relevant for ALL memoir writing in this repo. Voice integrity, scratchpad markers, snapshot review are non-negotiable when editing under `content/babu-memoir/`.

## What to do for a typical user request

Step 1: Read the user's request in context — memoir work, site work, or general repo housekeeping.
Step 2: If memoir authoring, invoke the `/journal` skill (if present in `skills-staging/journal/`) or use the journal-orchestrator agent.
Step 3: If site work, use the `css-theme-sync` or `ui-modernizer` skills as appropriate.
Step 4: Respond in the 4-part template. No custom section labels.

## Conventions baseline

- **Asif IS Babu** (relevant for all memoir work).
- **Auto-mode authorization** lets you act on small mechanical steps without asking; **halt-and-surface** for anything destructive or content-mutating beyond the auto-mode envelope.
- **No emojis in code or commits** unless explicitly invited; **DO use status emojis (🟢 / 🟡 / 🔴 / ⚠)** in responses per response-template.
- **Markdown links for files and commits** — `[name](path)` and `[abc1234](https://github.com/asifhussain60/journal/commit/abc1234)`.

## Do NOT

- Re-create `server/`, `wrangler.toml`, `site-worker.js`, `infra/cloudflare/`, or `docs/cloudflare/` without explicit user authorization — these were retired 2026-05-22 for a reason.
- Force-push to `main` or `develop`.
- Bypass `git status` cleanliness before merges.
- Reach into the sibling `podcast-factory` repo's paths or use its scripts from here — the repos are fully disconnected (`_workspace/`, `scripts/podcast/`, `infra/azure/` etc. live ONLY in podcast-factory).

## Imported Claude Cowork project instructions
