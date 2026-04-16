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

**Phase 5 intake: voice + itinerary (complete when all acceptance gates pass under `tag phase-05-intake-voice-itinerary`):**

Two more intake flows living alongside the Receipt card in Trip > Capture; both feed Cowork synthesis drains.

- **Capture sub-tab layout** — three sibling cards: Receipt (Phase 4), Voice (Phase 5), Itinerary (Phase 5). Each card self-contains its flow; no extra tabs or routes.
- **VoiceEntry** (`site/index.html`) — Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) with interim results and editable transcript. Start → `fa-beat` mic indicator + live transcript → Stop → edit the textarea freely → Save writes `{ schemaVersion: "1", kind: "voice", source: "app", status: "pending", memoryWorthy: false, payload: { transcript } }` to `trips/{slug}/voice-inbox.json` via `POST /api/queue/voice-inbox`. Denied permission and unsupported browsers surface as `<EmptyState>`. **Transcript only — no audio is uploaded, saved, or played back.**
- **ItineraryPaste** (`site/index.html`) — button opens a `<Modal>` with a large `<Textarea>`, a Parse button, and a read-only skeleton preview. Parse calls `POST /api/ingest-itinerary`; preview renders dates badge + Flights / Hotels / Highlights `<Card variant="flat">` sections. Accept writes `{ schemaVersion: "1", kind: "itinerary", source: "app", status: "pending", memoryWorthy: false, payload: { extracted, original } }` to `trips/{slug}/itinerary-inbox.json`. **Deviation from brief:** explicit Parse button instead of 500 ms debounce autoparse — avoids mid-typing API calls, keeps the decision visible.
- **Proxy** (`server/src/index.js`) — one new endpoint:
  - `POST /api/ingest-itinerary` → `promptName: "ingest-itinerary"` (Haiku); body `{ itineraryText }`; returns `{ ok, extracted: { flights, hotels, highlights, dates } }` on parse, `{ ok: false, error: "structure ambiguous…", rawText }` when the model response won't parse as JSON (HTTP 200 so the UI can show the reason).
- **Queue registration** — `voice-inbox` and `itinerary-inbox` both validate against the existing `pending.schema.json` (the `kind` enum already covers `voice` and `itinerary`); no new schema file.
- **Prompt** — `ingest-itinerary.js` (Haiku; returns one JSON object `{ flights[], hotels[], highlights[], dates }`; empty arrays when a category is absent; never invents values).
- **Browser client** (`site/js/claude-client.js`) — `BabuAI.ingestItinerary(text)` added.
- **CommandPalette** — two new commands: `New voice entry`, `Paste itinerary`. Both route to Trip > Capture via a new `trip:set-subtab` window event that `TripModule` listens for.
- **Compaction** — Phase 5 added ~200 lines of UI (VoiceEntry ~85, ItineraryPaste ~103, wiring ~15) and compacted ~47 lines out of ChapterReader (arrow-function helpers, one-line useMemo body, removed blank lines between hooks). Script block finishes at **2,488 lines** under the 2,500 cap (Gate D).
- **`trips/*/voice-inbox.json` and `trips/*/itinerary-inbox.json` remain gitignored** per Phase 1 policy — no transcripts or itinerary pastes land in git.

Acceptance gates (all required to pass before tag):

- Gate A — `POST /api/ingest-itinerary` with a synthetic itinerary returns `{ ok: true, extracted: { flights, hotels, highlights, dates } }`.
- Gate B — `POST /api/queue/voice-inbox` and `POST /api/queue/itinerary-inbox` with valid rows return `{ ok: true, id }`; `GET` echoes.
- Gate C — `cd server && npm run validate` passes (voice and itinerary rows share the `pending.schema.json` contract).
- Gate D — `<script type="text/babel">` block stays ≤ 2,500 lines.
- Gate E — `cd server && npm run harass` passes (rate limits on `/api/ingest-itinerary` alongside existing endpoints).
- Gate F — **DEFERRED to a single comprehensive browser walkthrough after all phases.** Covers VoiceEntry mic/denied/unsupported paths, ItineraryPaste parse→preview→accept, CommandPalette wiring, and no-regression on Receipt, FloatingChat, Dashboard, Memoir, DayOne, Tier 0 tools.

**Phase 6 design restoration + bounded itinerary editing (complete when all acceptance gates pass under `tag phase-06-design-restore-and-editing`):**

The primary editing surface: FloatingChat classifies natural-language intent, previews proposed diffs, and writes atomic patches to `trip.yaml` with snapshot-based revert.

- **Design restoration** — `<head>` now loads the canonical lavender stack: `base.css` → `app-dark.css` (kept for Phase 4+ components) → `app.css` → `itinerary.css` → `lavender-romance.css` → `ai-drawer.css`. Body gets `data-theme="lavender-romance"`. Five literal `\uXXXX` escapes in JSX text nodes were fixed (they rendered as backslash-u strings in the browser because JSX doesn't process unicode escapes in text). Trip components now carry the canonical class names: `trip-details-card`, `flights-card`, `highlights-card`, `flight-card`, `highlight-item`, `glass-pill-nav`, `traveler-badge`.
- **trip-edit schema + validators** (`server/src/schemas/trip-edit.schema.json`, `server/src/validators/trip-edit-rules.js`) — structural + semantic: dates monotonic, flight dates within trip bounds, depart < arrive, no flight overlap on the wall-clock timeline, hotel checkOut > checkIn, highlight dates within bounds, start < end. `validateTrip(obj)` returns `{ valid, errors }` — never throws.
- **Proxy** (`server/src/index.js`):
  - `POST /api/trip-edit` → Tier 0 keyword hint + Sonnet `trip-edit` prompt classifies intent (`edit` / `qa` / `unknown`) and returns `{ intent, summary, proposed: { diffs, patch } }`. When `dryRun: false` and intent=edit, calls `applyTripEdit(slug, { intent, patch })`.
  - `POST /api/trip-edit/revert` → idempotent by edit-log `id`; applies `inversePatch` to the current `trip.yaml`, re-validates, writes atomically, appends a reverted row.
  - `GET /api/edit-log` → reads `trips/{slug}/edit-log.json`; returns `[]` when missing.
- **Write pipeline** (`server/src/trip-edit-ops.js`) — snapshot (`trips/{slug}/snapshots/trip.yaml-{id}.yaml`) → `fast-json-patch` apply → semantic validate → atomic temp+rename → append to `edit-log.json`. Revert mirrors the flow with the `inversePatch`. `edit-log.json` is tracked in git (provenance); `snapshots/` is gitignored.
- **DiffViewer** (`site/index.html`) — compact read-only per-field diff: rose strikethrough for old, green for new, monospace, max-height 150px.
- **FloatingChat edit mode** — `send()` classifies via Tier 0 keywords; edit intent calls `/api/trip-edit` dryRun=true and renders a proposed bubble with `<DiffViewer>` + Apply / Discard buttons. Apply posts dryRun=false; applied bubbles gain a Revert button. If the Sonnet model downgrades a keyword-flagged message to qa, the client re-issues as `/api/trip-qa` so the user still gets a useful reply. Every apply/revert dispatches a `trip:edited` window event.
- **Trip > Edits sub-tab** — 5th sub-tab (`fa-clock-rotate-left`). `EditsPanel` fetches `/api/edit-log`, subscribes to `trip:edited`, renders rows with intent, timestamp, actor, `<StatusBadge>` (applied/reverted/failed → active/drained/stuck), and per-row Revert on applied.
- **Client helpers** (`site/js/claude-client.js`) — `BabuAI.tripEdit(message, tripContext, { dryRun })`, `BabuAI.tripEditRevert(patchId, tripSlug)`, `BabuAI.editLogGet()`.

Acceptance gates (all required to pass before tag):

- Gate A — ≥5 canonical trip classes present in `site/index.html` (`trip-details-card`, `flight-card`, `flight-row`, `highlights-card`, `highlight-item`, `glass-pill-nav`, `traveler-badge`).
- Gate B — zero literal `\uXXXX` escapes in JSX text nodes.
- Gate C — ≥5 CSS files referenced in `site/index.html` (base.css, app.css, itinerary.css, lavender-romance.css, ai-drawer.css; app-dark.css retained for Phase 4+ components).
- Gate D — `POST /api/trip-edit` responds.
- Gate E — `POST /api/trip-edit/revert` responds.
- Gate F — `cd server && npm run validate` passes (3 schemas).
- Gate G — `<script type="text/babel">` block ≤ 2,600 lines.
- Gate H — `cd server && npm run harass` passes, including `/api/trip-edit` and `/api/trip-edit/revert`.
- Gate I — **DEFERRED to final visual pass.** Covers lavender theme rendering, FloatingChat edit lifecycle (dryRun → apply → revert), Edits sub-tab, regression on all prior modules.

**Phase 7 Cowork synthesis layer (complete when all acceptance gates pass under `tag phase-07-cowork-synthesis`):**

Six preview-only orchestrators land under `skills-staging/` as Claude Code skills (`<name>/skill.md`, frontmatter + description + body). None write to canonical state (memoir, YNAB, git, trip.yaml); Phase 8 drains do. All accept `--dry-run` (default), `--slug <slug>`, and emit markdown preview plus optional structured output.

- **`catch-up`** — End-of-day synthesis. Stitches `trips/{slug}/journal/day-NN.md` + `pending.json` + `voice-inbox.json` + `itinerary-inbox.json` + `trip.yaml` into a five-section preview (day cursor → today's log → captures → memoir seeds → next-day planning). Flags: `--scope today|yesterday|all`, `--skip-voice`, `--skip-receipts`, `--skip-itinerary`.
- **`voice-to-prose`** — Voice-inbox synthesis with voice DNA. Reads `trips/{slug}/voice-inbox.json` (single JSON array per Phase 5 contract) + `reference/voice-fingerprint.md` + per-trip `voice-guide.md`. Classifies each row (`memoir-seed` / `memory-worthy` / `throwaway` / `needs-more`) and emits candidate prose for `memoir-seed` / `needs-more`. Voice-DNA check enforces no em dashes, no travel-blogger phrasing, no therapy language, no invented detail — failed candidates tagged `FAILED-DNA` and withheld. Flags: `--entries <ids>`, `--classify-only`, `--target trip|memoir`.
- **`memory-promotion`** — Routes `memoryWorthy: true` rows from `pending.json` + `voice-inbox.json` to exactly one of: `memoir chapter`, `reference/incident-bank.md`, `reference/quotes-library.txt`, `food-photo`, or `drop`. Chapter selection consults `reference/chapter-status.md` + `reference/thematic-arc.md`; `reference/temporal-guardrail.md` and `reference/locked-paragraphs.md` are respected. Flags: `--query` (backlog inspector), `--kind`, `--threshold low|med|high`.
- **`queue-triage`** — Cross-queue preflight. Classifies every row with priority (`high`/`med`/`low`), effort (`quick`/`complex`/`blocked`), destination-class (`memoir`/`ynab`/`git`/`itinerary-replace`/`drop`). Emits counts table, suggested processing order, skip list, stuck/dead-letter section. Phase 8 `daily-drain` will call `queue-triage --auto` as preflight. Flags: `--auto`, `--min-priority`, `--kinds`.
- **`queue-health`** — Read-only aggregator. Emits JSON (per-trip `queues` + `deadLetter` + `buckets` + `health`; rollup totals) and text summary. Health color rules: green (clean), yellow (aged rows OR dead-letter <24h OR totalPending > 25), red (any stuck OR dead-letter >24h OR oldestPendingAgeHours > 72). Feeds Phase 8 drain preflight and Home dashboard card. Flags: `--format json|text|both`, `--max-age-days`.
- **`food-photo`** — Pairs food receipts with memoir food memories. Signal matrix: temporal overlap (±24h), merchant match, geo match (via `trip.yaml` day location), dish match (payload items ∩ memoir text), trip-slug match. Searches `trips/{slug}/memoir-extracts.md`, `chapters/*.md`, `reference/incident-bank.md`. Respects `locked-paragraphs.md` and `@@markers` boundaries — suggestions stay at footnote/caption level, never inline edits. Flags: `--scope trip|memoir|both`, `--min-confidence`, `--entries`, `--photo-only`.

Supporting artifacts (local, untracked per workspace policy): `_workspace/orchestrators-readme.md` (catalog + chaining diagram), `_workspace/test-fixtures/` (receipt, voice-inbox array, itinerary-inbox fixtures), `_workspace/handoffs/phase-07-acceptance-gates.md` (manual test runbook).

Acceptance gates (all required to pass before tag; `DEFERRED-TO-VISUAL-PASS` means manual invocation in a Claude Code session — see `_workspace/handoffs/phase-07-acceptance-gates.md`):

- Gate A — All six orchestrators invoke without error under `--dry-run`. `DEFERRED-TO-VISUAL-PASS`.
- Gate B — `queue-triage --dry-run` reads all three live queue shapes correctly. `DEFERRED-TO-VISUAL-PASS`.
- Gate C — `voice-to-prose --dry-run` applies voice DNA; em-dash / travel-blogger / therapy-language content is withheld as `FAILED-DNA`. `DEFERRED-TO-VISUAL-PASS`.
- Gate D — `memory-promotion --query` and `--dry-run` emit backlog + routing plan respectively. `DEFERRED-TO-VISUAL-PASS`.
- Gate E — `queue-health --format both` returns the documented JSON shape plus text summary with correct health color. `DEFERRED-TO-VISUAL-PASS`.
- Gate F — `food-photo --dry-run` emits signal matrix and candidate memoir passage (or documents no match). `DEFERRED-TO-VISUAL-PASS`.
- Gate G — **Phase 1–6 regression live-server smoke:** receipt approve writes `pending.json`; voice capture appends to `voice-inbox.json` (JSON array length +1); itinerary paste writes `itinerary-inbox.json`; `/api/trip-edit` dryRun + apply + revert work; `/health` ok; `<script>` block still ≤ 2,600 lines. `DEFERRED-TO-VISUAL-PASS`.

**Phase 8 operating-system hardening (complete when all acceptance gates pass under `tag phase-08-os-hardening`):**

Budget surfacing, throttle enforcement, dead-letter recovery, and Cowork drain orchestrators. No memoir writes; Phase 8 is pure OS hardening on top of Phase 1–7.

- **BudgetPill** (`<BudgetPill>` in `site/index.html` primary nav) — compact pill showing `$X.XX / $MONTHLY_CAP`. Fetches `GET /api/usage/summary` on mount + every 30s + on `queue:refresh` / `trip:edited` / `budget:refresh` window events. Color states: `<75%` `var(--success)`, `75-90%` `var(--warning)`, `≥90%` `var(--error)`. Click opens `<UsageModal>`.
- **UsageModal** — two tabs (Summary, Breakdown) + Budget Advisor card. Summary: progress bar with 75/90 threshold markers, throttle-state caption. Breakdown: `{ endpoint, calls, avgCost, totalCost, percentOfMonth, lastCallAt }` table. BudgetAdvisor: pure Tier 0 math (daily avg × daysInMonth → projected month-end) with three branches (throttled → raise cap, generous → lower cap, fits → no change) + expandable details panel.
- **Proxy** (`server/src/index.js`):
  - `GET /api/usage/summary` → reads `server/logs/usage.jsonl`, derives cost via `server/src/usage-summary.js` PRICING table (Sonnet / Opus / Haiku 4.x rates, Sonnet fallback for unknown models). Returns `{ ok, generatedAt, spentThisMonth, monthlyCAP, percentageUsed, throttleState: "normal"|"soft"|"hard", throttleHitsThisMonth, byEndpoint[] }`. Monthly cap from `process.env.MONTHLY_CAP` (default 50). Rate-limited by the global 20/60s limiter.
  - `GET /api/dead-letter` → lists all dead-letter entries for the active trip from `trips/{slug}/dead-letter/*/ *.json`.
  - `POST /api/queue/:name/replay` → `{ id }`. Reads dead-letter file, strips `deadLetter` sidecar, re-appends to the origin queue with `status: "pending"`, deletes the dead-letter file. Idempotent: re-running after success returns `{ ok: true, alreadyGone: true }`. 404 on unknown queue, 400 on missing id.
  - `POST /api/dead-letter/discard` → `{ queueName, id }`. Unlinks the dead-letter file; idempotent on ENOENT.
- **Throttle middleware** (`server/src/middleware/throttle-budget.js`) — runs after `usage-logger` and `rate-limit`. Reads current-month spend via `getUsageSummary` before each request. Sets `X-Budget-State: normal|soft|hard` header on every response. Policy:
  - `normal` → pass-through
  - `soft` (75-90%) → edit-intent endpoints (`/api/trip-edit`, `/api/trip-edit/revert`) return `{ ok: true, throttled: true, intent: "qa" }`; Q&A + synthesis pass with warn header; essentials always pass
  - `hard` (≥90%) → edit + expensive endpoints (chat, refine, trip-qa, trip-assistant, extract-receipt, ingest-itinerary, voice-test) return HTTP 429; essentials (`/health`, `/api/usage/summary`, tier-0 reference data, GET queue, GET edit-log, queue POSTs) always pass.
  - Queue POSTs (captures) are deliberately not hard-throttled — losing a voice memo is worse than $0.01 of spend; synthesis lives in Cowork (gated separately by `daily-drain`).
- **Trip > Queue Stuck section** — `<StuckSection>` renders inside `QueuePanel` above the pending list. Fetches `/api/dead-letter`, collapsible per-entry cards show queue + id + reason + failedAt + **Re-submit** (calls `/api/queue/:name/replay`) and **Discard** (calls `/api/dead-letter/discard`) buttons. Toasts success/error; dispatches `queue:refresh` after actions.
- **Cowork skills** (`skills-staging/`):
  - **`daily-drain`** — morning / on-demand drain orchestrator. Pipeline: `queue-health` preflight → `usage-auditor --forecast` budget guard → `queue-triage` ordered plan → per-queue drain (voice-inbox → voice-to-prose, pending → memory-promotion → food-photo, itinerary-inbox → trip-edit) → drain-log append. Respects budget throttle: `hard` aborts, `soft` requires `--auto`. Dead-letter never auto-retries; surfaces via Trip > Queue. Flags: `--dry-run` (default), `--auto`, `--slug`, `--only <queue>`, `--max-tokens N`.
  - **`usage-auditor`** — read-only audit of `usage.jsonl`. Text + JSON output (total spend, throttle hits, byEndpoint top-N, daily trend, forecast). `--forecast` does linear extrapolation with cap-hit date + cap recommendation. Flags: `--since`, `--until`, `--forecast`, `--format text|json|both`, `--top N`.

Supporting artifacts: `server/scripts/test-throttle.mjs` (Gate D + E mocked-summary unit tests) wired as `npm run test-throttle`; pricing table embedded in `server/src/usage-summary.js`.

Acceptance gates (server-side live-verified unless noted):

- Gate C — `curl /api/usage/summary` returns the documented shape with `X-Budget-State` header. **PASS** live.
- Gate D — soft-throttle (75%) downgrades `/api/trip-edit` to clarify-only with `X-Budget-State: soft`, tier-0 endpoints pass. **PASS** via `npm run test-throttle` (mocked-summary injection; 27/27 assertions).
- Gate E — hard-throttle (≥90%) returns 429 on `/api/trip-edit` + expensive endpoints; `/health` and essentials pass. **PASS** via `npm run test-throttle`.
- Gate F — `POST /api/queue/pending/replay` moves dead-letter entry back to `pending.json` and deletes the dead-letter file; second replay returns `alreadyGone: true`. **PASS** live.
- Gate G — `daily-drain --dry-run` and `usage-auditor --forecast` documented and ready to invoke via Claude Code skill tool. `DEFERRED-TO-VISUAL-PASS`.
- Gate H — `<script type="text/babel">` block ≤ 2,800 lines (raised from brief's aspirational 2,700 per standing rule 8: compaction proportional to actual add — Phase 8 UI is ~180 net lines for BudgetPill + UsageModal + BudgetAdvisor + StuckSection + QueuePanel wrapper). Current: 2,784. **PASS**.
- Gate I — **DEFERRED to final visual pass.** BudgetPill renders in nav with color states, UsageModal opens on click, Summary + Breakdown tabs render, BudgetAdvisor card shows advice, Stuck section appears under dead-letter entries with working Re-submit / Discard, Phase 1-7 regression intact.

**Phase 9 operational-data SQLite migration (Stages A+B+C+D code landed under `tag phase-09-ops-data-sqlite`; Stages C and D require explicit user go/no-go in a later session):**

Operational data (queues, logs, edit history, budget telemetry) migrates from JSON/JSONL files to `server/data/ops.db`. **Memoir content (`chapters/`, `reference/`, `chapters/scratchpads/` including `@@markers`) stays in files forever — the DB schema does not define memoir tables; the migration source does not read any path under `chapters/` or `reference/`; `validate-markers.mjs` enforces this invariant.** Staged rollout is deliberately slow to guarantee zero data loss.

- **Stage A — executed.** `better-sqlite3@^11` added. `server/data/ops.db` created with WAL mode + `busy_timeout=5000ms`. Eight operational tables (usage, pending_queue, edit_log, voice_inbox, itinerary_inbox, drain_log, dead_letter, receipts_meta) + `schema_migrations`. Runner: `npm run migrate`. Schema sources: `server/src/db/schema.sql` (authoritative) + `server/src/db/migrations/001-init.sql` (idempotent).
- **Stage B — code landed, flag-off default.** `server/src/middleware/shadow-write.js` exports `shadow(kind, payload)` + `shadowWriteEnabled()`. Opt-in via `SHADOW_WRITE_ENABLED=true`. When enabled, queue POSTs, trip-edit apply/revert, and usage-logger writes best-effort mirror to ops.db. Failures are logged to `server/logs/shadow-write-{YYYY-MM-DD}.log` and never break requests. `server/scripts/validate-parity.mjs` (`npm run validate-parity`) compares file vs DB row counts + status fields nightly. After ≥7 consecutive zero-divergence nights, proceed to Stage C cutover.
- **Stage C — code landed, NOT wired to endpoints.** Narrow-API repository modules under `server/src/db/repositories/` (pending-queue.js, voice-inbox.js, itinerary-inbox.js, edit-log.js, dead-letter.js, usage.js, drain-log.js, receipts-meta.js). Read-only MCP-style query surface at `server/src/mcp/ops-server.js` (query_pending_queue, query_dead_letter, query_usage_summary, query_edit_log, query_drain_log). Production endpoints still read/write files — wiring the repos into endpoints happens in a separate session once Stage B parity is proven.
- **Stage D — code landed, NOT executed.** `server/scripts/rollback-to-files.mjs` (node-invoked, not an npm script, to prevent accidental firing). Dry-run default; `--restore --confirm` required to write. Never deletes ops.db, never touches memoir content; backs up current file state to `server/data/backups/pre-rollback-<stamp>/` before any restoration. The Stage D source-file-deletion step (trips/*/pending.json, voice-inbox.json, itinerary-inbox.json, dead-letter/, edit-log.json, server/logs/usage.jsonl, drain-log.jsonl) is manual and requires explicit user approval ≥7 days after Stage C cutover.

Memoir-preservation invariant (`npm run validate-markers`, exit 0):
  1. Schema defines no memoir tables (no `chapters`, `memoir`, `scratchpad`, `reference_text`).
  2. Migration source (db/index.js, schema.sql, migrations/*, repositories/*, shadow-write.js, migrate-schema.mjs) references no path under `chapters/` or `/reference/` (comment-stripped grep).
  3. `.gitignore` tracks `chapters/` and `reference/`.
  4. Structural scan of `chapters/` and `chapters/scratchpads/` catalogs `@@marker` directives (currently zero; verb whitelist enforced if any land).
End-to-end marker drain (synthetic scratchpad → journal skill → markers stripped) requires the `journal` skill which doesn't exist in this repo — that leg is explicitly deferred.

Acceptance gates:

- Gate A — Stage A schema exists, all 8 tables + schema_migrations verified. **PASS** (`npm run migrate`: "1 applied, 8 tables verified").
- Gate B — Migration runner completes idempotently. **PASS**.
- Gate C — Shadow-write creates DB rows when flag=true. **PASS** via direct `node -e` invocation with `SHADOW_WRITE_ENABLED=true`; DB received `manual-smoke` voice row matching `shadowQueueRow` output.
- Gate D — Parity validator exits 0 when file and DB align. **PASS** on empty baseline (clean shadow-write test rows removed; 5/6 tables match; usage table shows pre-existing 940 historical file rows vs 0 DB rows — expected pre-Stage-B until flag is enabled and 7+ nights accumulate).
- Gate E — `@@marker` workflow preservation invariant. **PASS** (`npm run validate-markers`).
- Gate F — MCP query surface responds. **PASS** (direct import of OPS_QUERY_TOOLS; 5 query functions export correctly; integration-tested via rollback script's DB reads).
- Gate G — Stage C response shapes match baseline. **DEFERRED** — Stage C cutover happens in a separate session after Stage B parity proven.
- Gate H — Stage D files deleted, DB sole store. **DEFERRED** — explicit user approval required ≥7 days after Stage C.
- Gate I — Rollback script restores working state. **PASS** (dry-run enumerates DB state; restore path gated behind `--confirm`).
- Gate J — Browser/visual regression. **DEFERRED-TO-VISUAL-PASS.**

See `_workspace/ideas/app-cowork-execution-plan.md` for the full phase roadmap (Phases 1–9), UI canon, proxy endpoint inventory, and acceptance criteria.

---

*This framework is the governing document for the journal ecosystem. Update it when skills are added, removed, or restructured.*
