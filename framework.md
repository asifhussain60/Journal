# Journal Ecosystem Framework

**Version:** 1.0
**Last updated:** 2026-04-15

This document governs the three skills that operate on this repository: **journal**, **trip-log**, and **trip-planner**. It defines their boundaries, shared resources, data flow, and rules of engagement.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   JOURNAL REPO                       │
│                                                      │
│  chapters/          ← journal skill writes here      │
│  reference/         ← single source of truth for     │
│                       all memoir + skill knowledge    │
│  trips/             ← trip-planner creates,          │
│    {slug}/            trip-log populates,             │
│      itinerary.html   journal extracts memoir bits    │
│      itinerary.md                                    │
│      trip.yaml      ← shared contract between        │
│      budget.md        all three skills                │
│      voice-guide.md                                  │
│      memoir-extracts.md                              │
│      journal/                                        │
│        day-01.md .. day-NN.md                        │
│  skills-staging/    ← skills under development       │
│  framework.md       ← this file                      │
└─────────────────────────────────────────────────────┘
```

---

## The Three Skills

### 1. journal (Memoir Engine)
**Purpose:** Write, refine, and polish chapters of "What I Wish Babu Taught Me"
**Owns:** `chapters/`, `chapters/snapshots/`
**Reads:** `reference/` (all files — voice, craft, quotes, incidents, rules)
**Writes:** Chapter files, snapshots (date-stamped: `ch01-man-YYYY-MM-DD.txt`)
**Triggers:** `journal`, `continue writing`, `next chapter`, `refine chapter`, `edit my memoir`

### 2. trip-log (Daily Event Recorder)
**Purpose:** Record daily life events, trip days, and Ishrat moments in memoir voice
**Owns:** `trips/{slug}/journal/` (daily entry files)
**Reads:** `reference/voice-fingerprint.md`, `reference/memoir-rules-supplement.txt`, `trips/{slug}/voice-guide.md`
**Writes:** Daily entries (`day-NN.md`), `memoir-extracts.md` (flags memoir-worthy content)
**Triggers:** `trip-log`, `log today`, `record today`, `daily entry`, `ishrat moment`
**Integrates with:** DayOne app (creates journal entries tagged by trip)

### 3. trip-planner (Itinerary Builder)
**Purpose:** Plan trips of all types with interactive itineraries, budget tracking, and halal dining
**Owns:** `trips/{slug}/itinerary.html`, `itinerary.md`, `trip.yaml`, `budget.md`
**Reads:** Own references in `skills-staging/trip-planner/references/` (travel knowledge base, design guide, YNAB guide)
**Writes:** Trip folder structure, itinerary files, trip metadata
**Triggers:** `trip-planner`, `plan a trip`, `itinerary`, `travel plan`, `vacation plan`
**Integrates with:** YNAB MCP (reads Holiday budget, logs expenses), trip-log (hands off for daily recording)

---

## Shared Contract: trip.yaml

Every trip folder MUST contain a `trip.yaml` that all three skills can read. This is the handshake between planning, logging, and memoir extraction.

```yaml
name: [Trip name]
slug: [year-month-slug]
type: [international | road-trip | day-trip | weekend | outing]
dates:
  start: YYYY-MM-DD
  end: YYYY-MM-DD
travelers: [Asif, Ishrat]
base: [Hotel/home address]
budget_tier: [budget | mid-range | comfortable | luxury]
halal_dining: true
status: [planning | active | completed | archived]
memoir:
  relevant_chapters: [ch02-love, ch04-faith]
  potential_incidents: ["description"]
dayone:
  journal_name: "Travel"
  tags: [trip, ...]
```

---

## Data Flow

```
trip-planner          trip-log              journal
    │                    │                     │
    ├─ Creates trip      │                     │
    │  folder + yaml     │                     │
    ├─ Builds itinerary  │                     │
    │  (HTML + MD)       │                     │
    ├─ YNAB budget panel │                     │
    │                    │                     │
    │   ─── HANDOFF ───► │                     │
    │                    ├─ Records daily      │
    │                    │  entries in voice    │
    │                    ├─ Flags memoir        │
    │                    │  moments             │
    │                    ├─ Creates DayOne      │
    │                    │  entries             │
    │                    │                     │
    │                    │  ─── FEEDS ────────► │
    │                    │                     ├─ Pulls incidents
    │                    │                     │  from memoir-extracts
    │                    │                     ├─ Weaves into
    │                    │                     │  chapter narrative
    │                    │                     └─ Updates incident-bank
```

---

## Reference Folder — Single Source of Truth

All memoir knowledge lives in `reference/`. No duplication across skills.

### Voice & Craft (used by journal + trip-log)
- `voice-fingerprint.md` — Asif's writing voice DNA
- `voice-deep-analysis.md` — Extended voice characteristics
- `craft-techniques.md` — Writing techniques and patterns
- `translations-glossary.md` — Urdu/cultural terms and translations

### Memoir Structure (used by journal)
- `thematic-arc.md` — Chapter themes and emotional progression
- `biographical-context.md` — Timeline, key people, life events
- `chapter-status.md` — Current state of each chapter
- `locked-paragraphs.md` — Approved text that must not be changed
- `temporal-guardrail.md` — Timeline consistency rules

### Content Libraries (used by journal)
- `quotes-library.txt` — Collected quotes for Dad's Advice sections
- `quotes-workflow.md` — How quotes are extracted, classified, and placed
- `clinic-library.txt` — Writing clinic examples and patterns
- `incident-bank.md` — All memoir incidents, classified and scored

### Governance (used by all)
- `memoir-rules-supplement.txt` — Rules for voice, structure, duplication prevention
- `journal-workflow-v2.md` — File-first model, Challenger protocol, git versioning
- `master-context.md` — Full project context and history

---

## Rules of Engagement

### 1. File-First Model
All output goes to files, never dumped in chat. This is inherited from journal-workflow-v2.

### 2. Voice Consistency
Both journal and trip-log must maintain Asif's voice fingerprint. Trip-planner is exempt (it produces informational content, not memoir prose).

### 3. No Duplication
Content exists in exactly one place. Skills reference it, they don't copy it. If a file moves, update the framework.

### 4. Snapshot Discipline
Chapter snapshots use date-stamps: `ch01-man-YYYY-MM-DD.txt`. Create a snapshot before any major edit session.

### 5. Trip Lifecycle
```
PLANNING → trip-planner creates folder, itinerary, trip.yaml
ACTIVE   → trip-log records daily entries, DayOne sync
COMPLETED → journal extracts memoir moments, budget reconciled
ARCHIVED → status updated in trip.yaml
```

### 6. YNAB Integration
Trip expenses are tracked in Piggy Bank → Holiday category. The budget panel in `itinerary.html` shows real-time YNAB data. Only Holiday-categorized transactions are displayed.

### 7. DayOne Integration
Trip-log creates DayOne entries tagged with trip metadata from `trip.yaml`. Journal name: "Travel". Tags include trip slug, travelers, and year.

---

## Folder Structure After Cleanup

```
journal/
├── framework.md              ← this file
├── .gitignore
├── .mcp.json                 ← YNAB MCP config (gitignored)
├── chapters/
│   ├── preface.txt
│   ├── ch00-intro.txt
│   ├── ch01-man.txt
│   ├── ch02-love.txt
│   ├── ch03-marriage.txt
│   └── snapshots/
│       ├── ch00-intro-2026-04-11.txt
│       ├── ch01-man-2026-04-11.txt
│       ├── ch02-love-2026-04-11.txt
│       └── ch03-marriage-2026-04-11.txt
├── reference/                ← single source of truth
│   ├── voice-fingerprint.md
│   ├── voice-deep-analysis.md
│   ├── craft-techniques.md
│   ├── thematic-arc.md
│   ├── biographical-context.md
│   ├── chapter-status.md
│   ├── translations-glossary.md
│   ├── locked-paragraphs.md
│   ├── temporal-guardrail.md
│   ├── quotes-library.txt
│   ├── quotes-workflow.md
│   ├── clinic-library.txt
│   ├── incident-bank.md
│   ├── memoir-rules-supplement.txt
│   ├── journal-workflow-v2.md
│   └── master-context.md
├── trips/
│   └── 2026-04-ishrat-engagement/
│       ├── itinerary.html
│       ├── itinerary.md
│       ├── trip.yaml
│       ├── voice-guide.md
│       ├── memoir-extracts.md
│       └── journal/
│           ├── day-01.md .. day-09.md
└── skills-staging/
    └── trip-planner/
        ├── skill.md
        ├── ynab-setup.md
        ├── ynab-vscode-setup.md
        └── references/
            ├── travel-knowledge-base.md
            ├── itinerary-design-guide.md
            └── ynab-integration-guide.md
```

---

## App vs Cowork

Phase 1 of the execution plan at `_workspace/ideas/app-cowork-execution-plan.md` splits the repo into two cooperating surfaces. This section mirrors the plan's §1 and §2 so the split stays discoverable from the governing framework. The full roadmap, phase spec, and acceptance criteria stay in the execution plan; this section is a stable summary.

**Two surfaces, one repo:**

- **App** — React SPA at `site/` plus the Express proxy at `server/` (port 3001). Thin edge client. Handles capture, cheap deterministic extractions, bounded transforms, and instant page-local UX. Writes only to scratch queues and per-trip artifacts.
- **Cowork** — Claude Code running in terminal. Canonical brain. Owns memoir files, git, YNAB, synthesis, queue drains, and `reference/` writes.

The App writes scratch queues; Cowork drains them. Any ambiguity resolves in favor of Cowork.

**Canonical writes map (summary):**

| Surface | May write | May never write |
|---|---|---|
| App | `trips/{slug}/pending.json`, `trips/{slug}/voice-inbox/*.jsonl`, `trips/{slug}/receipts/*`, `trips/{slug}/itinerary-inbox.json`, `trips/{slug}/dead-letter/*`, `trips/{slug}/edit-log.json`, `trips/{slug}/snapshots/*`, bounded edits to `trips/{slug}/trip.yaml` (Phase 6 only), `server/logs/usage.jsonl` | `chapters/`, `reference/`, git metadata, YNAB, `framework.md` |
| Cowork | memoir files, `reference/`, git, YNAB via MCP, reconciled artifacts, drain outputs, `framework.md`, `_workspace/`, `server/logs/drain-log.jsonl` | — |

**Execution tiers** (router decision order: deterministic → defer to Cowork → cheapest acceptable model → budget-throttled):

1. Tier 0 — deterministic. Code + data tables. No model call.
2. Tier 1 — cheap App model (Haiku). Small bounded extractions.
3. Tier 2 — bounded App reasoning (Sonnet). Only when instant UX demands it.
4. Tier 3 — Cowork. Everything else.

**Memoir content stays as files, permanently.** `chapters/`, `reference/`, `chapters/scratchpads/` (the `@@marker` scratchpads), `chapters/snapshots/`, `trips/{slug}/trip.yaml`, `trips/{slug}/itinerary.md`, `trips/{slug}/journal/`, `trips/{slug}/memoir-extracts.md`, and `trips/{slug}/voice-guide.md` are all file-based and git-versioned. Operational data (queues, logs, metadata) moves to SQLite at `server/data/ops.db` in Phase 9 (locked 2026-04-16); memoir prose never migrates.

**Workspace policy:** `_workspace/` stays untracked. The execution plan lives at `_workspace/ideas/app-cowork-execution-plan.md` and is the single source of truth for the split and roadmap. When a phase lands, its final state mirrors into this file.

**Phase 1 contract lock (complete when `cd server && npm run validate` exits 0):**

- Named-prompt loader at `server/src/prompts/`.
- Passive token-usage logger writing `server/logs/usage.jsonl` on every request.
- JSON Schemas for `pending.json` and `edit-log.json` with required `schemaVersion: "1"`.
- Optional `promptName` body field on `/api/refine` and `/api/chat` (byte-identical behavior when omitted).
- Rate-limit middleware (20 req/min per IP per endpoint; `/health` exempt).
- `.gitignore` entries per plan §5.10.

See `_workspace/ideas/app-cowork-execution-plan.md` for the full phase roadmap (Phases 1–9), UI canon, proxy endpoint inventory, and acceptance criteria.

---

*This framework is the governing document for the journal ecosystem. Update it when skills are added, removed, or restructured.*
