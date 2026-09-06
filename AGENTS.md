# Journal repo — session orientation

You're in the **`journal`** repo (split from the original `Journal` on
2026-05-22 — see [_workspace/runbooks/repo-split.md](https://github.com/asifhussain60/podcast-factory/blob/develop/_workspace/runbooks/repo-split.md) in the
sibling `podcast-factory` repo for the migration history). This file is
auto-loaded by Codex on every session in this directory; treat it
as your standing brief.

## What this repo contains

- **Babu memoir** (`content/babu-memoir/`, `skills-staging/journal/`) — Asif's memoir authoring engine. **Asif IS Babu** (the memoir's protagonist).
- **Journal site** (`site/`, `worker/`) — Vite + React + Tailwind SPA (viewer + editor) served by a single Cloudflare Worker that also answers `/api/*`. Live at https://journal.kashkole.com behind Cloudflare Access (Google SSO): `asifhussain60@gmail.com` is the only editor, everyone else is a read-only viewer, and that split is enforced in the Worker — not merely hidden in the UI. Local dev is `npm run site:dev` (SPA) and `npm run worker:dev` (Worker + API); deploy with `make deploy`, documented in [infra/DEPLOY.md](infra/DEPLOY.md).
- **Chapter storage** — live chapter text lives in Cloudflare KV (`CHAPTERS_KV`), written directly by the web editor; GitHub is not a runtime dependency. `content/babu-memoir/chapters/` remains the canonical on-disk authoring source. `make kv-backup` / `make kv-restore` snapshot and restore the KV side.
- **Memoir tooling** (`scripts/memoir/`) — `auto_delta.py`, `save_snapshot.py`, `detect_user_delta.py`, `refresh_all_snapshots.py`. Drives chapter authoring + snapshot review.
- **Manifest build** (`scripts/site/build-manifest.mjs`) — runs automatically before every site dev, build and test. Derives the runtime chapter manifest from the canonical chapters plus `_system/chapter-status.md`, and mirrors the chapter text into `site/public/chapters/`; both outputs are gitignored. (`scripts/site/sync_chapters.sh` predates it and is no longer part of the build.)

This repo is **fully self-contained** post-split. It has no shared paths, no submodules, no symlinks with the sibling `podcast-factory` repo. Duplicated general-utility items (skills, agents, reference materials, `content/_shared/arabic/`) are independent copies that evolve separately from podcast-factory's copies.

## What this repo does NOT contain (sibling repo)

The following lives in the sibling **[podcast-factory](https://github.com/asifhussain60/podcast-factory)** repo (renamed from `Journal` post-split):

- Podcast pipeline (`scripts/podcast/`, `library/books/`, `_workspace/books/`, `skills-staging/podcast/`)
- Azure infrastructure (`infra/azure/`)
- Cross-machine operator coordination (`_workspace/plan/operators/`)
- Book branches, worktrees, and the entire cross-machine podcasting model

The journal repo is single-machine, single-purpose. **No machine ID file is needed; no operator-coordination required.**

## Hosting: retired 2026-05-22, RE-AUTHORIZED 2026-07-10

Cloudflare hosting is **live again** and is this repo's deployed surface. The
2026-05-22 retirement was explicitly reversed on 2026-07-10, when the site was
rebuilt as a Worker-served SPA with Access login, in-browser editing and KV
chapter storage. Any older note saying "local-only", "no deploy target", or
"do not re-create `wrangler.toml`" is stale — correct it rather than obey it.

- **Back in the repo (2026-07-10)**: repo-root `wrangler.toml`; `worker/` (the
  Worker itself — there is no `site-worker.js`); `infra/` with the deploy and
  KV backup/restore scripts plus [infra/DEPLOY.md](infra/DEPLOY.md); and model
  API calls (Anthropic + Gemini), which now run inside the Worker.
- **Still retired**: the Node/Express proxy (`server/`) that bound to
  127.0.0.1:3001 — the Worker replaced it, and `.gitignore` still guards the
  path. Its setup docs are gone too; the deployment record is `infra/DEPLOY.md`.
- **Secrets never enter the repo**: `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` are
  pushed with `wrangler secret put`; local values live in `.dev.vars`
  (gitignored); Cloudflare credentials come from the macOS Keychain.

## Read these once per machine, or when conventions feel stale

- **Response format** — canonical spec is `~/.claude/response-template.md` (locked 2026-05-26), which replaced the old 4-part "At a glance" shape; the sibling-repo copy that shape pointed to no longer exists. Note: `~/.codex/AGENTS.md` imports `~/.codex/response-template.md`, which is not present on this machine — read the `~/.claude` copy instead. Shape: `##` topical title → one `>` blockquote verdict with a bold lead-in sentence → three to five `###` sections whose headings are full-sentence statements of their own gist (never generic labels like Summary / Problem / Status / Next Steps) → exactly one `---` → `### Next: 👤 Asif` (or `🤖 AI`) with alphabetized options, one blank line between each, A marked `**(Recommended)**`. Section bodies are nested bullets with bold lead-ins — detail is demoted a level, never dropped — with tables for tabular data. A question Asif must *answer* goes in the separate question block instead (`## ❓ Questions for you`, one `####` per question, lettered options), and never appears in the same response as a Next block. Plain English in chat: no file paths, task IDs or insider acronyms; no fenced code blocks for prose; no GitHub `[!NOTE]`-style alerts; no inline mermaid; all times in EST, 12-hour.
- **Memoir conventions**: Asif IS Babu — relevant for ALL memoir writing in this repo. Voice integrity, scratchpad markers, snapshot review are non-negotiable when editing under `content/babu-memoir/`.

## What to do for a typical user request

Step 1: Read the user's request in context — memoir work, site work, or general repo housekeeping.
Step 2: If memoir authoring, invoke the `/journal` skill (if present in `skills-staging/journal/`) or use the journal-orchestrator agent.
Step 3: If site work, use the `css-theme-sync` or `ui-modernizer` skills as appropriate.
Step 4: Respond in the format above — topical title, verdict blockquote, section headings that state their own gist, then Next. No generic section labels.

## Conventions baseline

- **Asif IS Babu** (relevant for all memoir work).
- **Auto-mode authorization** lets you act on small mechanical steps without asking; **halt-and-surface** for anything destructive or content-mutating beyond the auto-mode envelope.
- **No emojis in code or commits** unless explicitly invited; **DO use status emojis (🟢 / 🟡 / 🔴 / ⚠)** in responses per response-template.
- **Markdown links for files and commits** — `[name](path)` and `[abc1234](https://github.com/asifhussain60/journal/commit/abc1234)`.

## Do NOT

- Re-create the Express proxy `server/` — the Worker (`worker/`) owns the API now.
- Remove, or "re-retire", `wrangler.toml`, `worker/`, or `infra/` on the strength of the 2026-05-22 retirement note — that retirement was reversed on 2026-07-10 and the Worker is live.
- Commit secrets — `.dev.vars`, API keys, Cloudflare tokens. They belong in `wrangler secret put` and the macOS Keychain.
- Deploy (`make deploy`) without being asked — it publishes to the live site.
- Force-push to `main` or `develop`.
- Bypass `git status` cleanliness before merges.
- Reach into the sibling `podcast-factory` repo's paths or use its scripts from here — the repos are fully disconnected (`_workspace/`, `scripts/podcast/`, `infra/azure/` etc. live ONLY in podcast-factory).

## Imported Claude Cowork project instructions
