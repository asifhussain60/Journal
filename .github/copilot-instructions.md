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

Asif uses one response format across every tool. The canonical spec is
`~/.claude/response-template.md` (locked 2026-05-26). It replaced the older
4-part "At a glance" template, and the sibling-repo copy that template pointed
to no longer exists — do not reconstruct either.

Structure:

1. `## <topical title>` — plain English, no jargon
2. `> **<verdict in one line>**` — bold lead-in, then one or two supporting sentences
3. Three to five `###` sections whose headings are full-sentence statements of their own gist — never generic labels (`Summary`, `Problem`, `Status`, `Next Steps`). Bodies are nested bullets with bold lead-ins; detail is demoted a level, never dropped. Tables for tabular data.
4. `---` — exactly one, immediately before Next
5. `### Next: 👤 Asif` (or `### Next: 🤖 AI`) — alphabetized options, one blank line between each, A marked `**(Recommended)**`

A question Asif must *answer* goes in the separate question block instead
(`## ❓ Questions for you`, one `####` per question, lettered options, closed by
`**— End of questions —**`), and never shares a response with a Next block.

Also: plain English in chat — no file paths, task IDs or insider acronyms; no
fenced code blocks for prose; no GitHub `[!NOTE]`-style alerts; no inline
mermaid; all times in EST, 12-hour. Severity emojis (🟢 ship-ready / 🟡 needs
decision / 🔴 blocked / ⚠ caution) stay optional, where they add signal.

## Conventions

- **Asif IS Babu** — central to all memoir writing.
- **No emojis in code or commits** unless invited; **DO use status emojis** in chat responses.
- **Markdown links for files + commits** — `[name](path)` and `[abc1234](https://github.com/asifhussain60/journal/commit/abc1234)`.
- **No force-push to `main` or `develop`.**
- **Honor `git status` cleanliness before merges.**
