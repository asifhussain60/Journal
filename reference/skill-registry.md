# Skill Registry — journal repo

**Purpose:** Single source of truth for every skill present in THIS repo (the `journal` repo, split from `Journal`/`podcast-factory` on 2026-05-22).

**Authority:** Anchored to `reference/cortex-challenger-framework.md` v1.0. Anything in `framework.md` defers to this file for skill-level detail.

The skill set here is a STRICT SUBSET of what existed pre-split — the podcast skill (and anything Azure-tied) lives in the sibling `podcast-factory` repo, not here. Each duplicated general-utility skill is an INDEPENDENT COPY; changes do NOT cross-propagate to the sibling repo.

---

## Active skills — compliance

| Skill | Compliance Tier | Status | Definition path |
|---|---|---|---|
| **CORTEX** | BASELINE | Active (plugin) | `~/.claude/skills/cortex/SKILL.md` |
| **Journal** | SILVER (target) | Active (plugin) — overlay applies | `~/.claude/skills/journal/SKILL.md` + `reference/skill-overlays/journal-cortex-overlay.md` |
| **Cowork-brief** | BRONZE (target) | Active (plugin) — overlay applies (duplicated copy) | `~/.claude/skills/cowork-brief/SKILL.md` + `reference/skill-overlays/cowork-brief-cortex-overlay.md` |
| **Tell-me** | SILVER (target) | Active (plugin) — overlay applies (duplicated copy) | `~/.claude/skills/tell-me/SKILL.md` + `reference/skill-overlays/tell-me-cortex-overlay.md` |
| **Clean-commit** | BRONZE (target) | Active (plugin) — overlay applies (duplicated copy) | `~/.claude/skills/clean-commit/SKILL.md` + `reference/skill-overlays/clean-commit-cortex-overlay.md` |
| **CSS-theme-sync** | SILVER (target) | WIP in staging | `skills-staging/css-theme-sync/skill.md` (+ `cortex-compliance.md`) |
| **Repo-surgeon** | BRONZE (target) | WIP in staging — consolidated to single skill.md (duplicated copy) | `skills-staging/repo-surgeon/skill.md` |
| **UI-modernizer** | SILVER (target) | WIP in staging | `skills-staging/ui-modernizer/skill.md` (+ `cortex-compliance.md`) |
| **Usage-auditor** | BRONZE (target) | WIP in staging (duplicated copy) | `skills-staging/usage-auditor/skill.md` (+ `cortex-compliance.md`) |

All skills target **CORTEX Challenger Framework v1.0**. The framework version is implicit unless a row says otherwise.

## Skills NOT present in this repo (sibling repo)

These live in the sibling **[podcast-factory](https://github.com/asifhussain60/podcast-factory)** repo:

- **Podcast** — entire podcast-authoring pipeline + skill (`skills-staging/podcast/`)

## Retired skills

| Skill | Retired | Notes |
|---|---|---|
| **Trip-log** | 2026-05-16 | Memory tombstoned; plugin file still present (read-only) — disable via Cowork plugin settings to fully remove |

---

## Active skills — capabilities

### Memoir core

| Skill | Purpose | Owns | Triggers |
|---|---|---|---|
| `journal` | Memoir chapter writing + refinement (workflow in `content/babu-memoir/_system/journal-workflow-v2.md`) | `content/babu-memoir/chapters/`, `content/babu-memoir/_system/snapshots/`, `content/babu-memoir/_system/scratchpad/` | "journal", "continue writing", "next chapter", "refine chapter", "/journal work on chapter N" |

### Site engineering skills

| Skill | Purpose | Owns | Does NOT own | Triggers |
|---|---|---|---|---|
| `css-theme-sync` | Theme parity validation + auto-fix | Theme tokens across `site/css/` | Theme palette decisions (tweaker handles that) | "validate themes", "theme parity" |
| `ui-modernizer` | Execute UI modernization phases | CSS + component changes on the site | Theme definitions (defers to css-theme-sync) | "modernize ui", "run ui phases" |

### General-utility skills (duplicated independent copies from podcast-factory)

| Skill | Purpose | Triggers |
|---|---|---|
| `clean-commit` | Pre-commit / commit-quality discipline | "clean commit", "/clean-commit" |
| `cowork-brief` | Refine raw request → compact instruction-paragraph for Cowork briefs | "/refine" (Cowork context) |
| `repo-surgeon` | Holistic architecture audit, orphan cleanup, root hygiene | "/repo-surgeon", "repo surgery" |
| `tell-me` | Codebase tour / explainer skill | "tell me about", "/tell-me" |
| `usage-auditor` | Token / API usage audit | "/usage-auditor", "audit my usage" |
