# Copilot instructions for the `journal` repo

GitHub Copilot auto-loads this file as project-wide guidance. When Asif asks
you (in Copilot Chat in VSCode) about this repo, follow this orientation.

## What this repo is

- A **memoir authoring engine** for Asif's life story (under `content/babu-memoir/` — **Asif IS Babu**, the memoir's protagonist)
- A **Vite + React + Tailwind SPA** under `site/` (viewer + editor), served together with the `/api/*` endpoints by a Cloudflare Worker (`worker/`) — live at https://journal.kashkole.com behind Cloudflare Access (Google SSO), with editor vs. read-only-viewer enforced in the Worker
- **Cloudflare KV** as the store for live chapter text, written by the web editor
- A small set of memoir + site tooling under `scripts/memoir/` + `scripts/site/`
- A handful of general-utility skills + agents duplicated from the sibling `podcast-factory` repo as of the 2026-05-22 split

This repo is **single-machine, single-purpose**. No machine-id file, no operator coordination, no cross-machine git push discipline.

## What this repo is NOT

The podcast pipeline + Azure infrastructure + cross-machine operator coordination + `book/<slug>` branches all live in the sibling **[podcast-factory](https://github.com/asifhussain60/podcast-factory)** repo. Don't reach into those paths from here — the two repos are fully disconnected as of the split.

Cloudflare hosting was retired 2026-05-22 and **re-authorized 2026-07-10** — it is live again, so `wrangler.toml`, `worker/` and `infra/` belong here and must not be removed on the strength of the old retirement note. What stayed retired is the Node/Express proxy (`server/`): the Worker owns the Anthropic and Gemini calls now. Secrets are never committed — `wrangler secret put` for deployed values, `.dev.vars` (gitignored) locally.

## When Asif asks you for help

**For memoir authoring** (anywhere under `content/babu-memoir/`): invoke the `journal` skill if it's set up (`skills-staging/journal/SKILL.md`), or follow the conventions in `content/babu-memoir/_system/`. Voice integrity, scratchpad markers, and snapshot review are non-negotiable.

**For site work** (anywhere under `site/` or `worker/`): the SPA is Vite + React + Tailwind, with state in Zustand and routing in React Router. Run `npm run site:dev` to view changes, or `npm run worker:dev` when the change touches `/api/*`; `npx serve site` is obsolete. Verify with `npm --prefix site run test` and `npm run site:build` before proposing a deploy.

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
