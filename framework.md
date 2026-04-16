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

**Phase 2 design-system canon (complete when all acceptance gates pass under `tag phase-02-design-system-canon`):**

Component inventory (all live in the single `<script type="text/babel">` block in `site/index.html`):

- **Atoms** — `Icon`, `Button` (variants: primary | secondary | ghost | destructive; sizes: sm | md | lg; `loading` state disables + spins), `IconButton` (icon-only, aria-label required), `Badge` (variants: success | warning | error | info | neutral | accent), `Text` (tag-polymorphic typography with variant/size/weight/align/color), `Input` / `Textarea` / `Select` / `Checkbox` / `RadioGroup` (thin wrappers over `.input-field`).
- **Molecules** — `FormField` (label + helper + error + auto-id + aria-describedby around a single child input), `Card` (variants: flat | elevated | glass | module — maps to existing CSS classes, does NOT delete `.glass-card` / `.module-card` / `.entry-card` / `.incident-card` / `.quote-card`), `StatusBadge` (status → variant + icon + label), `EmptyState`, `SkeletonRow` (variants: itinerary-day | queue-row | chat-message | entry-card | chapter-line; fast 480ms pulse; respects reduced-motion), `Pill`, `Chip` (dismissible), `MenuItem`, `ThinkingDots`, `StepProgress`.
- **Organisms** — `Modal` (React portal, backdrop click + Esc to close, focus trap, body-scroll lock, focus restore on unmount), `ConfirmDialog` (wraps Modal; destructive variant uses warning icon + destructive button), `ToastProvider` + `useToast()` (context-based, `aria-live="polite"`, `success | warning | error | info`, exposed globally via `window.__appToast` so `voice-refiner.jsx`'s isolated React root uses the same single implementation), `CommandPalette` (Cmd-K / Ctrl-K; fuzzy filter; empty shell in Phase 2 — commands registered in Phase 3).
- **State hooks** — `useFetch(url, options?) → { data, loading, error, refetch }`, `useLocalStoragePrefs(key, defaults) → [prefs, setPrefs]`, `useActiveTrip() → { trip, loading, error }`, `useCommandPalette() → { open, setOpen }`, `useToast() → { show, dismiss }`.

Token additions (`site/css/sample_lavender.css` top-level `:root` — theme-agnostic so they apply under `app-dark.css` too):

- State: `--state-success`, `--state-warning`, `--state-error`, `--state-info`.
- Radius scale: `--radius-sm` (8), `--radius-md` (12), `--radius-lg` (16), `--radius-xl` (20), `--radius-pill` (9999).
- Space scale: `--space-1` (4) through `--space-8` (64).
- Motion: `--motion-fast` (150ms ease-out), `--motion-normal` (250ms ease-out), `--motion-slow` (400ms cubic-bezier).
- Focus: `--focus-ring: 0 0 0 3px rgba(150,110,180,0.35)`.
- Shadow: `--shadow-card-hover`, `--shadow-float`.

Global `prefers-reduced-motion` block caps every animation and transition at 0.01ms and disables smooth scroll; every new molecule inherits this behavior. Global `:focus-visible` default uses `--focus-ring`.

A11y baseline:

- Skip-to-main link (`<a class="skip-link" href="#main-content">`) appears visible-on-focus at top of `<body>`; `<main>` carries `id="main-content"`.
- Every `IconButton` and every icon-only interactive element (TOC toggle, notes toggle, bookmark, note-card-remove, resume-dismiss, note-type chip) has an explicit `aria-label`. Toggles also carry `aria-expanded` / `aria-pressed`.
- Cards that were `<div onClick>` (HomePage module cards, DayOne trip / entry cards, book-spine-card, trip-hero) became `role="button" tabIndex={0}` with matching `onKeyDown` handlers so Enter / Space activate.
- Every user-facing input, textarea, and select in the SPA is now wrapped in `<FormField label="…">`, which renders a real `<label htmlFor>` with auto-generated id and wires `aria-describedby` for helper / error text.
- `formatDate(iso)` is the canonical display formatter; `todayISO()` is the canonical "YYYY-MM-DD for today" helper — inline `new Date().toISOString().split('T')[0]` has been eliminated from `site/index.html`.
- Single toast implementation: `grep -rn "function showToast\|function useToast\|const useToast" site/` returns exactly one match (the shared `useToast` in `index.html`). `voice-refiner.jsx` calls `window.__appToast.show(msg, variant)` instead of owning its own toast hook.

Acceptance gates (all required to pass before tag):

- Gate A — component inventory (grep): atoms 4+, molecules 7, organisms 4, hooks 4.
- Gate B — legacy cleanup: one toast implementation, zero inline `toISOString().split` in `index.html`, Card call-sites routed through `<Card variant="…">`.
- Gate C — a11y: `aria-label` count substantially higher than the pre-Phase-2 baseline of 1; skip link present; `<label|htmlFor|<FormField>` count > 15 (was 5).
- Gate D — `prefers-reduced-motion` block present in `sample_lavender.css`.
- Gate E — `<script type="text/babel">` block in `site/index.html` stays under ~2,100 lines.
- Gate F — Home, Memoir → Chapters → ChapterReader (reader prefs persist), and DayOne Journal flows all work identically to Phase 1. Keyboard navigation reaches every interactive element.
- Gate G — visual regression: before/after screenshots of Home, Memoir-chapters, and DayOne-editor show no layout shifts; cosmetic improvements only.

**Phase 3 app shell + chat Q&A (complete when all acceptance gates pass under `tag phase-03-app-shell-and-chat-qa`):**

App now ships a real Trip surface with FloatingChat Q&A and zero-cost Tier 0 tools.

- **Nav** — fourth tab (`Trip`, between Memoir and DayOne). `ActiveTripHero` on the Dashboard now navigates inside the SPA (`setPage('trip')`) instead of hard-loading `itineraries/*.html`.
- **TripModule** (`site/index.html`) — three sub-tabs (Overview / Tools / Queue), driven by `useActiveTrip()`. Renders an `<EmptyState>` if `manifest.json` has no active trip.
- **TripOverview** — read-only itinerary card stack: trip name + date range + live-day/countdown `<StatusBadge>`, travelers, base, occasion, flights (`inbound` / `outbound`), and highlights. All atoms from Phase 2 (`Card`, `Text`, `Badge`, `StatusBadge`).
- **FloatingChat** (`<FloatingChat trip={...} />`) — collapsed 56px bubble bottom-right; expanded 420×620 panel with header, conversation area (`aria-live="polite"`), auto-growing textarea, send button, and quick-action chips ("What's next today?", "Summarize today", "Tip for this country"). Cmd/Ctrl-Enter or Enter sends; Shift-Enter newline; Esc collapses. New message while collapsed pulses the bubble (skipped under `prefers-reduced-motion`). Q&A only — no edit mode (Phase 6).
- **TripTools** (Tier 0, no token cost) — `TipHelper` (country `<Select>` driven by `/api/reference-data/currency`; renders tipping range + currency + notes from `/api/reference-data/tipping`); `PackingList` (categorised checkboxes from `/api/reference-data/packing`, persisted via `useLocalStoragePrefs("packing-{slug}")`, "X of Y packed" counter).
- **QueuePanel** — fetches `GET /api/queue/pending`; tolerates 404 (Phase 4 endpoint) and renders an `<EmptyState>`. Listens for `queue:refresh` window event so the CommandPalette can trigger a refetch.
- **CommandPalette** — Phase 3 commands registered: `Open chat` (focuses FloatingChat input via `floating-chat:focus` event), `Open active itinerary` (sets page to `trip`), `Refresh queues` (dispatches `queue:refresh`), `Copy today's date` (writes `todayISO()` to clipboard).
- **Proxy** (`server/src/index.js`) — three new endpoints:
  - `POST /api/trip-qa` → `promptName: "trip-qa"` (pinned `claude-haiku-4-5-20251001`); body `{ message, tripContext }`; returns `{ ok, response, usage }`.
  - `POST /api/trip-assistant` → `promptName: "trip-assistant"` (Sonnet); body `{ message, tripContext, intent? }`; meta-router prompt staged for Phase 6.
  - `GET /api/reference-data/:name` → serves `server/src/reference-data/{name}.json`; 404 on miss; no model call → no token cost.
- **Reference data** at `server/src/reference-data/`: `tipping.json`, `currency.json`, `packing.json` (14 countries; ~50 packing items across Documents / Essentials / Toiletries / Electronics / Clothing).
- **Browser client** (`site/js/claude-client.js`) — `BabuAI.tripQA`, `BabuAI.tripAssistant`, `BabuAI.referenceData(name)` wrappers.

Acceptance gates (all required to pass before tag):

- Gate A — four nav tabs; `TripModule`, `TripOverview`, `FloatingChat` defined.
- Gate B — FloatingChat round-trip: bubble → panel → send → ThinkingDots → response; quick-action chips dispatch the chip text; Cmd-Enter sends; Esc collapses.
- Gate C — Tier 0 verified: `TipHelper` and `PackingList` produce zero new model rows in `usage.jsonl` (the `/api/reference-data/:name` route never calls Anthropic).
- Gate D — `ActiveTripHero` click stays in the SPA at `localhost:3000` (no `window.location.href`).
- Gate E — CommandPalette registers ≥4 commands; "Open chat" focuses the chat input.
- Gate F — `<script type="text/babel">` block stays under ~2,300 lines (relaxed from Phase 2's 2,100 cap given Phase 3 scope).
- Gate G — Dashboard, Memoir → Chapters → ChapterReader, and DayOne flows all still work.
- Gate H — `cd server && npm run validate && npm run harass` both pass; rate limits apply on the new endpoints.

**Phase 4 receipt pipeline (complete when all acceptance gates pass under `tag phase-04-receipt-pipeline`):**

First narrow, in-flow AI feature: receipt capture → OCR extraction → review → approve → queue.

- **TripModule sub-tabs** now read `Overview → Capture → Tools → Queue`. The Capture sub-tab is the single intake point for in-trip data; receipt capture is the first button it carries.
- **CaptureModal** (`site/index.html`) — drives the flow: click-or-drop image picker (up to 5 MB, any `image/*`) → preview → `POST /api/upload` → `POST /api/extract-receipt` with `<StepProgress>` showing "Reading image / Extracting details / Review" → editable form (merchant, amount, currency, date, category, description) pre-filled from the extraction → `memoryWorthy` star toggle via `<IconButton>` → **Approve** posts a schema-valid `pending` row and fires `queue:refresh`. Failures surface the raw model output with a Retry button so the user can still edit manually.
- **QueuePanel** now renders each pending row as a `<Card>`: merchant/title, amount + currency, date, memoryWorthy star, `<StatusBadge>`, expandable detail (description/category/imagePath/id/visionUsed). Empty state preserved. Drain is not an App concern.
- **Proxy** (`server/src/index.js`) — four new endpoints:
  - `POST /api/upload` → `multer` memory storage, 5 MB cap, **magic-number MIME sniff** (header alone is untrusted), writes to `trips/{activeSlug}/receipts/{uuid}.{ext}`; returns `{ ok, id, imagePath, bytes, ext }`.
  - `POST /api/extract-receipt` → `{ imagePath }` → tries **macOS Vision** via a small `swift` CLI shim (`server/scripts/mac-vision-ocr.swift`); on empty/unavailable, falls back to **Haiku vision** with the base64 image. `res.locals.visionUsed` flows into `usage.jsonl`. Returns `{ ok, extracted, visionUsed, rawText? }` with the extracted JSON or the raw model text for the retry path.
  - `POST /api/queue/:name` → ajv-validated append to `trips/{slug}/{name}.json` (atomic temp-rename); Phase 4 registers the `pending` schema.
  - `GET /api/queue/:name` → reads the queue file; returns `{ ok, items, tripSlug }` with an empty array when the file is missing.
- **Shared helpers** (`server/src/receipts.js`) — image sniffer, active trip slug resolver, atomic write, queue append/read, `macVisionOcr` with a cached `swift` probe.
- **Prompt** — `extract-receipt` (Haiku; JSON-only; shared by Vision-then-text and direct-vision paths).
- **Browser client** (`site/js/claude-client.js`) — `BabuAI.uploadReceipt`, `BabuAI.extractReceipt`, `BabuAI.queuePost`, `BabuAI.queueGet`.
- **Schema contract** — `pending.schema.json` is the write contract: `schemaVersion: "1"`, `id`, `createdAt`, `kind: "receipt" | "voice" | "itinerary" | "note"`, `source: "app" | "cli" | "test"` (App uses `"app"`), `status: "pending"`, `memoryWorthy`, plus kind-specific `payload`. App only writes `pending`; Cowork drains.
- **Compaction** — Phase 4 compacted the `<script type="text/babel">` block by ~150 lines (stale narrative comments, 14 banner triplets, multi-line JSX collapses) before adding the Capture sub-tab, CaptureModal, and expanded QueuePanel, keeping the block under 2,400 lines per Gate F.
- **`trips/*/receipts/` and `trips/*/pending.json` remain gitignored** per Phase 1 policy — no receipts or queue rows land in git.

Acceptance gates (all required to pass before tag):

- Gate A — end-to-end capture (browser): pick → StepProgress → extraction → form → Approve → `pending.json` row present with `schemaVersion: "1"`, `kind: "receipt"`.
- Gate B — `cd server && npm run validate` passes (pending rows conform to `pending.schema.json`).
- Gate C — `visionUsed` appears in `usage.jsonl` after an `/api/extract-receipt` call (true when macOS Vision produced text; false on Haiku fallback).
- Gate D — `POST /api/queue/pending` with a valid row returns `{ ok: true, id }`; `GET /api/queue/pending` echoes the row.
- Gate E — `POST /api/upload` with a 6 MB file is rejected with HTTP 413 (`multer` `LIMIT_FILE_SIZE`).
- Gate F — `<script type="text/babel">` block stays under 2,400 lines.
- Gate G — `cd server && npm run harass` passes (rate limits on `/api/upload`, `/api/extract-receipt`, `/api/queue/pending`; smoke round-trip + self-cleanup).
- Gate H — Dashboard, Memoir, DayOne, FloatingChat Q&A, TipHelper, PackingList all still work.

See `_workspace/ideas/app-cowork-execution-plan.md` for the full phase roadmap (Phases 1–9), UI canon, proxy endpoint inventory, and acceptance criteria.

---

*This framework is the governing document for the journal ecosystem. Update it when skills are added, removed, or restructured.*
