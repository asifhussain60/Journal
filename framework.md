# Journal Ecosystem Framework

**Version:** 4.0 (repo-split — split from `Journal`/`podcast-factory` on 2026-05-22)
**Last updated:** 2026-05-22

This document governs the **`journal`** repo: the memoir engine, the static journal site, and the small set of agents/skills that support memoir authoring. The podcast pipeline, Azure infrastructure, cross-machine operator coordination, and the Cloudflare deploy scaffold (including the `server/` Anthropic API proxy) all live in the sibling **[podcast-factory](https://github.com/asifhussain60/podcast-factory)** repo (or, for the retired Cloudflare/server scaffold, in neither repo — see §"Retired" below).

## Nomenclature

The memoir is *"What I Wish Babu Taught Me."* **Asif IS Babu.** Babu is Asif's wiser/elder voice addressing his younger self "Asif" inside each chapter's closing advice section. Babu is NOT Asif's father. Any stale "Dad" reference in read-only `SKILL_DIR/references/` copies is overridden by the writable Babu versions in `content/babu-memoir/_system/`.

---

## Content tree

```
content/
├── _shared/                        ← independent copy of cross-utility data
│   └── arabic/                     ← shared phonetic / Islamic terminology reference
│                                     (podcast-factory has its own independent copy)
└── babu-memoir/                    ← the memoir
    ├── _system/                    ← voice, craft, quotes, incidents, snapshots, scratchpad, workflow
    └── chapters/                   ← preface.txt, ch00…chXX.txt
```

`site/` contains the static React display of memoir chapters; `scripts/site/sync_chapters.sh` mirrors `content/babu-memoir/chapters/` → `site/chapters/` so the site renders the latest chapter text.

---

## Agents

| Agent | Location | Role |
|---|---|---|
| `journal-orchestrator` | `.github/agents/journal-orchestrator.agent.md` | Memoir skill routing + canonical-write protection |
| `journal-challenger` | `.github/agents/journal-challenger.agent.md` | Semantic-quality review of memoir chapters (V/A/C/G/D/N) |
| `repo-surgeon` | `.github/agents/repo-surgeon.agent.md` | Holistic architecture audit, orphan cleanup, root hygiene (general-utility — duplicated from podcast-factory) |
| `refine-prompt` | `.github/agents/refine-prompt.agent.md` | Refines a raw request into one compact instruction-paragraph for Claude Opus 4.7 / Claude Code (general-utility — duplicated) |
| `reconcile` | `.github/agents/reconcile.agent.md` | Reconciliation utility (general-utility — duplicated) |
| `CORTEX` | `.github/agents/CORTEX.agent.md` | Skill BASELINE framework (general-utility — duplicated) |
| `operating-contract` | `.github/agents/operating-contract.md` | Externalized operating contract (general-utility — duplicated) |

---

## The memoir skill: `journal`

**Purpose:** Write, refine, and polish chapters of *"What I Wish Babu Taught Me."*

**Owns:** `content/babu-memoir/chapters/`, `content/babu-memoir/_system/snapshots/`, `content/babu-memoir/_system/scratchpad/`.

**Reads:** all of `content/babu-memoir/_system/` — voice, craft, quotes, incidents, rules.

**Writes:** chapter files; date-stamped snapshots (`chXX-name-YYYY-MM-DD.txt`).

**Triggers:** `journal`, `continue writing`, `next chapter`, `refine chapter`, `edit my memoir`, `/journal work on chapter N`.

**Challenger gate:** `journal-challenger` runs at the end of every Phase 4 (scratchpad → `chapters/` move) and must return `SHIP-READY` or `SHIP-WITH-CAUTION` before the move is allowed.

---

## Site-related skills

| Skill | Location | Purpose |
|---|---|---|
| `css-theme-sync` | `skills-staging/css-theme-sync/` | Theme work targeting `site/css/themes/` |
| `ui-modernizer` | `skills-staging/ui-modernizer/` | UI/UX modernization passes against `site/` |

---

## Duplicated general-utility skills

Each is an independent copy from the sibling `podcast-factory` repo as of the 2026-05-22 split. Future changes do NOT cross-propagate between repos.

- `skills-staging/clean-commit/`
- `skills-staging/cowork-brief/`
- `skills-staging/repo-surgeon/`
- `skills-staging/tell-me/`
- `skills-staging/usage-auditor/`

---

## Retired 2026-05-22

- **Cloudflare deploy scaffold** — `wrangler.toml`, `site-worker.js`, `infra/cloudflare/`, `docs/cloudflare/` — removed because the journal app no longer needs the Anthropic API and therefore no longer needs the Workers proxy or the deployed surface. `site/` is now a local-only static directory; serve via `npx serve site` if needed.
- **Anthropic API proxy** (`server/`) — same reason as above.
- **Docs related to the retired stack** — `docs/anthropic-api-setup.md`, `docs/proxy-setup.md`.

If a future memoir feature needs the API again, decide whether to re-add `server/` here or use a different mechanism — don't reach into the sibling podcast-factory's Anthropic plumbing.

---

## What lives in the sibling repo (NOT here)

For full coverage of the podcast pipeline, Azure infrastructure, cross-machine operator coordination, book/<slug> branches, and worktree model, see the sibling **[podcast-factory](https://github.com/asifhussain60/podcast-factory)** repo. Specifically:

- `scripts/podcast/`, `skills-staging/podcast/`, `content/podcast/.skill/`
- `infra/azure/`, `infra/launchd/`
- `_workspace/` (full cross-machine coordination + per-book in-progress workspace under `_workspace/books/<slug>/` post-Phase-9.5 of the split runbook)
- `library/` (top-level shipped catalog post-Phase-9.5)
- `.github/agents/podcast-*`, `.github/workflows/`
- `docs/podcast/`, `docs/architecture/`, `docs/azure/`, `docs/multi-mac-runbook.md`

---

## Conventions

- **Asif IS Babu** — relevant for all memoir writing.
- **No emojis in code or commits** unless explicitly invited.
- **Status emojis (🟢 🟡 🔴 ⚠) in responses** per the 4-part response template (in `~/.claude/response-template.md` if user-level install is set up; canonical source lives in the sibling podcast-factory's `_workspace/plan/response-template.md`).
- **Markdown links for files and commits** — `[name](path)` and `[abc1234](https://github.com/asifhussain60/journal/commit/abc1234)`.
- **Single-machine, single-purpose repo** — no cross-machine coordination required; no operator files; no machine-id needed.
