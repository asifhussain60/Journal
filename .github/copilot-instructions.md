# Copilot instructions for the `journal` repo

GitHub Copilot auto-loads this file as project-wide guidance. When Asif asks
you (in Copilot Chat in VSCode) about this repo, follow this orientation.

## What this repo is

- A **memoir authoring engine** for Asif's life story (under `content/babu-memoir/` — **Asif IS Babu**, the memoir's protagonist)
- A **static React site** under `site/` that renders the memoir (local-only after 2026-05-22; no deploy target)
- A small set of memoir + site tooling under `scripts/memoir/` + `scripts/site/`
- A handful of general-utility skills + agents duplicated from the sibling `podcast-factory` repo as of the 2026-05-22 split

This repo is **single-machine, single-purpose**. No machine-id file, no operator coordination, no cross-machine git push discipline.

## What this repo is NOT

The podcast pipeline + Azure infrastructure + cross-machine operator coordination + `book/<slug>` branches all live in the sibling **[podcast-factory](https://github.com/asifhussain60/podcast-factory)** repo. Don't reach into those paths from here — the two repos are fully disconnected as of the split.

The Cloudflare deploy scaffold (`wrangler.toml`, `site-worker.js`, `infra/cloudflare/`, `docs/cloudflare/`) AND the Anthropic API proxy (`server/`) were RETIRED 2026-05-22 — the journal app no longer uses the Anthropic API. If a memoir feature needs the API again, decide whether to re-add `server/` here; don't reach into podcast-factory's Anthropic plumbing.

## When Asif asks you for help

**For memoir authoring** (anywhere under `content/babu-memoir/`): invoke the `journal` skill if it's set up (`skills-staging/journal/SKILL.md`), or follow the conventions in `content/babu-memoir/_system/`. Voice integrity, scratchpad markers, and snapshot review are non-negotiable.

**For site work** (anywhere under `site/`): theme work uses `skills-staging/css-theme-sync/`; UI work uses `skills-staging/ui-modernizer/`. The site is local-only — no deploy target — so `npx serve site` is the standard way to view changes.

**For general-utility skill work** (`skills-staging/clean-commit/`, `cowork-brief/`, `repo-surgeon/`, `tell-me/`, `usage-auditor/`): each is an independent copy from podcast-factory as of 2026-05-22. Edits here do NOT cross-propagate to the sibling repo.

## Response format

Asif uses a **4-part At-a-glance-first template** across both tools (Copilot + Claude Code). The canonical reference lives in the sibling podcast-factory repo's `_workspace/plan/response-template.md` (mirrored to `~/.claude/response-template.md` via `@-import` if user-level install is set up).

Structure:

1. `## At a glance — <severity emoji> <one-phrase status>` + numbered list of ~5 items
2. `---`
3. `### N. <Plain English issue name> <severity emoji>` — PROSE paragraphs (NO sub-bullet labels like "Plain English:", "Impact:", "Fix:", "Where:")
4. `---`
5. `## Next: 👤 Asif` or `## Next: 🤖 AI` — multi-path uses `A. (Recommended) Do all of the below in order (B → C → D)` with sub-paths

Severity emojis: 🟢 ship-ready / 🟡 needs decision / 🔴 blocked / ⚠ caution.

## Conventions

- **Asif IS Babu** — central to all memoir writing.
- **No emojis in code or commits** unless invited; **DO use status emojis** in chat responses.
- **Markdown links for files + commits** — `[name](path)` and `[abc1234](https://github.com/asifhussain60/journal/commit/abc1234)`.
- **No force-push to `main` or `develop`.**
- **Honor `git status` cleanliness before merges.**
