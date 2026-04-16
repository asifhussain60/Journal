# Journal Command Center — Full AI Context Prompt

You are working on Asif Hussain's **Journal Command Center**, a React single-page application that serves as the unified hub for his personal memoir writing, trip journaling with his wife Ishrat, and DayOne journal entry creation. This document gives you everything you need to understand the project, make changes, and maintain design consistency.

---

## 1. PROJECT OVERVIEW

### What This App Is
A **creation and editing tool** for DayOne journal entries — NOT an archive viewer. DayOne (macOS app) remains the primary journaling app. This app helps Asif:
- Craft journal entries with Claude's voice DNA refinement, then copy/paste back to DayOne
- Track and plan trips with Ishrat (his wife)
- Manage his memoir "What I Wish Babu Taught Me" (chapters, incidents, quotes)

### Who Asif Is
- 54-year-old British-Pakistani man living in London
- Senior software engineer (ADLC/CORTEX frameworks)
- Writing a multi-chapter first-person memoir for his children
- "Babu" is what Asif calls his father — all chapter titles use "Babu" not "Dad"
- Travels with his wife Ishrat — all trips are romantic couple's trips

### Key Terminology
- **Babu** = Asif's father (never "Dad" in any UI text)
- **Ishrat** = Asif's wife (always named, never "my wife")
- **DayOne** = the macOS journal app (primary journaling tool)
- **Voice DNA** = Asif's writing style fingerprint used to refine journal entries
- **CORTEX** = Asif's AI engineering governance framework

---

## 2. TECH STACK

### Architecture
- **React 18** via CDN (no build step, no Vite, no npm bundler)
- **Babel standalone** for in-browser JSX transformation
- **Single-file SPA**: everything lives in `site/index.html` (`<script type="text/babel">` block 2,488 lines after Phase 5; Gate D caps it at 2,500)
- **External CSS**: design system split across 4 files
- **No backend server** — served locally via `npx serve . -l 3000 --cors` from the `journal/` root directory
- **Data layer**: JSON files fetched at runtime + inline JS constants

### File Structure
```
journal/                          ← Server root (npx serve runs here)
├── index.html                    ← Redirect to /site/index.html
├── package.json                  ← Dev server config
├── site/
│   ├── index.html                ← THE APP (entire React SPA)
│   ├── active-trip.html          ← Current active itinerary (standalone HTML)
│   ├── css/
│   │   ├── base.css              ← Shared design system (443 lines)
│   │   ├── sample_lavender.css   ← Active theme (278 lines)
│   │   ├── memoir_theme.css      ← Memoir-specific overrides
│   │   └── trip_theme.css        ← Trip-specific overrides
│   └── data/
│       └── manifest.json         ← Active trip + archive metadata
├── trips/
│   ├── manifest.json             ← (Legacy copy, canonical is site/data/)
│   └── 2026-04-ishrat-engagement/
│       ├── trip.yaml             ← Detailed trip metadata
│       ├── itinerary.html        ← Full itinerary (source for active-trip.html)
│       ├── itinerary.md          ← Markdown version
│       ├── journal/              ← Daily trip journal entries
│       ├── photos/               ← Trip photos
│       ├── memoir-extracts.md    ← Flagged memoir-worthy moments
│       └── voice-guide.md        ← Voice DNA guide for this trip
├── chapters/                     ← Memoir chapter files
│   ├── ch00-intro.txt
│   ├── ch01-man.txt
│   ├── ch02-love.txt (PUBLISHED)
│   ├── ch03-marriage.txt
│   └── preface.txt
└── reference/                    ← Voice DNA, craft techniques, biographical context
```

### CDN Dependencies (loaded in `<head>`)
- **Google Fonts**: Cormorant Garamond, Inter, Great Vibes, JetBrains Mono
- **Font Awesome 6.5.1**: Icon library (loaded without SRI hash)
- **React 18 + ReactDOM**: Production builds from unpkg CDN
- **Babel Standalone**: In-browser JSX transformation

### React Patterns
- All hooks destructured at top: `const { useState, useRef, useEffect } = React;`
- No `React.useState()` — always `useState()` directly
- No ES module imports — everything is in one `<script type="text/babel">` block
- Components are plain functions (no class components)

---

## 3. NAVIGATION & MODULES

### Nav Bar (4 tabs)
| Tab | Icon | Route Key | Component |
|-----|------|-----------|-----------|
| Dashboard | `fa-house` | `home` | `HomePage` |
| Memoir | `fa-book-open` | `memoir` / `chapter` | `MemoirModule` / `ChapterReader` |
| Trip | `fa-plane` | `trip` | `TripModule` (Phase 3) |
| DayOne | `fa-feather-pointed` | `dayone` | `DayOneModule` |

### App Component Routing
```jsx
function App() {
  const [page, setPage] = useState('home');
  const { trip: activeTrip, loading } = useActiveTrip();
  // home    → <HomePage trips={trips} onNavigate={setPage} />
  // memoir  → <MemoirModule onOpenChapter={openChapter} />
  // trip    → <TripModule trip={activeTrip} loading={loading} />
  // dayone  → <DayOneModule trips={trips} />
  // chapter → <ChapterReader chapter={activeChapter} ... />
}
```

### Home Page
- **Active Trip Hero Banner** — large card at top, only visible when `manifest.json` has an active trip
  - Shows: couple name (script font), trip name, base hotel, vibe, countdown/live indicator, flights, next event
  - Clicking navigates inside the SPA to the Trip tab via `onNavigate('trip')` (no full-page reload). The Phase 1 hard `window.location.href = activeTrip.itineraryPath` was removed in Phase 3.
  - Dynamic states: UPCOMING (countdown), LIVE NOW (day X of Y with green pulse), hidden when no active trip
- **Stats row** — Total Words, Chapters Locked
- **Module cards** — Memoir and DayOne Journal (clickable, navigate to respective modules)

### Trip Module (Phase 4, sub-tabs: Overview, Capture, Tools, Queue)
- **Overview** — `<TripOverview>` reads `useActiveTrip()` and renders the trip name, date range, live-day/countdown `<StatusBadge>`, travelers, base, occasion, flights, and highlights. Read-only.
- **Capture** (Phases 4 + 5) — `<TripCapture>` renders three sibling cards in Trip > Capture, each self-contained:
  - **Receipt** (Phase 4) — opens `<CaptureModal>`: click-or-drop image picker (`<input type="file" accept="image/*" capture="environment">` + drag-drop zone, 5 MB cap; server-side magic-number MIME sniff) → `POST /api/upload` → `POST /api/extract-receipt` with a `<StepProgress steps={["Reading image","Extracting details","Review"]} />` → editable `<FormField>` + `<Input>` form (merchant, amount, currency, date, category, description) pre-filled from extraction; `memoryWorthy` star via `<IconButton>` → **Approve** posts a schema-valid `pending` row via `BabuAI.queuePost('pending', row)` and dispatches `queue:refresh`. Failures surface raw model output + Retry; the form is always editable.
  - **Voice entry** (Phase 5) — `<VoiceEntry>` uses the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) with interim results. Start → `fa-beat` mic indicator + live transcript → Stop → editable `<Textarea>` → Save writes `{ schemaVersion: "1", kind: "voice", source: "app", status: "pending", memoryWorthy: false, payload: { transcript } }` via `BabuAI.queuePost('voice-inbox', row)`. **Transcript only — no audio is uploaded, saved, or played back.** Denied permission and unsupported browsers render `<EmptyState>`.
  - **Paste itinerary** (Phase 5) — `<ItineraryPaste>` opens a `<Modal>` with a large `<Textarea>`, a **Parse** button (explicit — no debounce autoparse), and a read-only skeleton preview (dates badge + Flights / Hotels / Highlights `<Card variant="flat">` sections). Parse calls `BabuAI.ingestItinerary(text)` → `POST /api/ingest-itinerary`. Accept writes `{ schemaVersion: "1", kind: "itinerary", source: "app", status: "pending", memoryWorthy: false, payload: { extracted, original } }` via `BabuAI.queuePost('itinerary-inbox', row)`. Parse-failure responses (`{ ok: false, error, rawText }`) surface the reason so the user can edit and retry.
- **Tools** — `<TripTools>` hosts two zero-cost Tier 0 widgets:
  - `<TipHelper>` — country `<Select>` populated from `/api/reference-data/currency`; on change, displays tipping range + currency + notes from `/api/reference-data/tipping`. No model call.
  - `<PackingList>` — categorised checkboxes from `/api/reference-data/packing`; checked state persists via `useLocalStoragePrefs("packing-{slug}")`. Shows "X of Y packed".
- **Queue** (Phase 4) — `<QueuePanel>` fetches `GET /api/queue/pending` and renders each row as a `<Card>` with merchant/title, amount + currency, date, memoryWorthy star, `<StatusBadge>`, and an expandable detail section (description/category/imagePath/id/visionUsed). Empty state preserved when the queue is empty. No delete/drain controls — drain is Cowork's job.
- **FloatingChat** — `<FloatingChat trip={activeTrip} />` is mounted only on the Overview sub-tab.
  - Collapsed: 56px circular bubble at bottom-right (inset 24px). Expanded: 420×620 panel.
  - Conversation area uses `aria-live="polite"`; auto-growing textarea (max ~6rem); `<ThinkingDots>` while waiting on `/api/trip-qa`.
  - Quick-action chips above the input: "What's next today?", "Summarize today", "Tip for this country" — click sends the chip text.
  - Keys: Enter or Cmd/Ctrl-Enter sends; Shift-Enter newline; Esc collapses. New message while collapsed pulses the bubble (skipped under `prefers-reduced-motion`).
  - Phase 3 is Q&A only — no edit-mode bubble, no DiffViewer (those land in Phase 6).
  - Listens for the `floating-chat:focus` window event (CommandPalette → "Open chat" dispatches it).

### Memoir Module (sub-tabs: Chapters, Incidents, Quotes)
- **Chapters tab**: Lists all 8 chapters with status badges (locked/draft/planned), word counts, readiness percentages
- **Incidents tab**: Story-worthy events with status (PLACED/BANKED/NEEDS-QQ)
- **Quotes tab**: Searchable quote library with source attribution

### DayOne Journal Module (sub-tabs: Trips Browser, Edit Entry, New Entry)
- **Trips Browser**: Masonry card grid of trips, click to expand entries
- **Edit Entry**: Select trip → select entry → edit with DayOne preview + copy-to-clipboard
- **New Entry**: Create new entry with mood, trip, journal selection + DayOne preview

---

## 4. DATA STRUCTURES

### manifest.json (Active Trip Pointer)
```json
{
  "active": {
    "slug": "2026-04-ishrat-engagement",
    "name": "Ishrat's Engagement Party Trip",
    "travelers": ["Asif", "Ishrat"],
    "vibe": "Packed & purposeful — couple time, mid-range budget, halal dining",
    "base": "Home2 Suites, New Brunswick, NJ",
    "dates": { "start": "2026-04-20", "end": "2026-04-28", "days": 9 },
    "flights": { "inbound": {...}, "outbound": {...} },
    "highlights": [{ "date": "...", "event": "...", "venue": "..." }],
    "itineraryPath": "itineraries/2026-04-ishrat-engagement.html"
  },
  "archive": [{ "slug": "...", "name": "...", "status": "completed" }]
}
```
When `active` is `null`, the hero banner hides entirely.

### Inline Data Constants (in index.html)
- **CHAPTERS** — 8 chapters (ch00–ch07) with id, num, title, subtitle, status, words, readiness
- **QUOTES_SAMPLE** — Array of {text, source, chapter} objects
- **INCIDENTS_SAMPLE** — Array of {title, chapter, status} objects
- **PLACEHOLDER_TRIPS** — 3 trips (Istanbul Oct 2024, New Brunswick Apr 2026, Lahore Jun 2022)
- **MOODS** — 10 mood types: romantic, adventure, cultural, relaxed, celebration, bittersweet, anticipation, reflective, spiritual, playful
- **MOOD_COLORS** — Maps each mood to {bg, text, icon} for consistent color-coding
- **JOURNALS** — ['Travel', 'Ishrat's Visits', 'Asif's Journal'] (DayOne journal names; note curly apostrophe)

### Entry Shape
```javascript
{
  uuid: 'istanbul-001',
  date: '2024-10-12T00:00:00.000Z',
  location: 'Istanbul',
  mood: 'anticipation',
  summary: 'Hagia Sophia at dawn...',
  text: '...',  // Full journal entry body
  tags: ['istanbul', 'anticipation', 'ishrat'],
  photoPlaceholders: [{ id, description, slot }],
  status: 'draft',
  journal: 'Ishrat\u2019s Visits'  // Curly apostrophe required
}
```

---

## 5. DESIGN SYSTEM

### Theme: Lavender Mist (Active)
The app uses a light lavender theme (`body.theme-lavender`). All colors are defined as CSS custom properties.

#### Core Color Palette
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#e8e0f0` | Page background |
| `--bg-secondary` | `#ddd4ea` | Secondary surfaces |
| `--bg-tertiary` | `#d0c6e0` | Tertiary/recessed areas |
| `--bg-card` | `#f6f2fc` | Card backgrounds |
| `--bg-card-hover` | `#faf8ff` | Card hover state |
| `--text-primary` | `#2d2840` | Headings, primary text |
| `--text-secondary` | `#6b6380` | Body text, descriptions |
| `--text-muted` | `#a59db8` | Labels, metadata, timestamps |
| `--accent` | `#966eb4` | Primary accent (purple) |
| `--accent-soft` | `rgba(150,110,180,0.1)` | Accent backgrounds |

#### Romantic Accent Colors (used in hero banner, trip elements)
| Color | Hex | Usage |
|-------|-----|-------|
| Purple | `#966eb4` | Primary accent, nav active, buttons |
| Rose | `#c48a9a` | Romantic elements, secondary accent, hearts |
| Green | `#5aac72` | Success, "Complete", "LIVE NOW" state |

#### Gradient Patterns
- **Brand gradient**: `linear-gradient(135deg, #966eb4, #c48a9a)` — used for nav brand text, script couple name, countdown numbers
- **Card tints**: Each module card has a unique warm tint (purple, rose-lilac, cool violet)
- **Page background**: Subtle diagonal crosshatch pattern + color orbs over `--bg-primary`

### Font Stack
| Token | Font | Usage |
|-------|------|-------|
| `--font-serif` | Cormorant Garamond | Headings, trip names, chapter titles, entry body text |
| `--font-sans` | Inter | UI text, nav, buttons, descriptions |
| `--font-mono` | JetBrains Mono | Dates, metadata, stats, flight codes, status badges |
| `--font-script` | Great Vibes | "Asif & Ishrat" couple branding, nav brand |

### Design Philosophy
- **Light and airy** — soft lavender tints, transparent backgrounds, minimal borders
- **Romantic but professional** — hearts and script fonts are subtle decorative accents, not dominant
- **Consistent card language** — rounded corners (16-20px), subtle box-shadows, hover lift effects
- **Mood color-coding** — every mood has a dedicated color/icon pair used consistently across all views
- **Information density** — mono font for data (dates, counts, flight codes), serif for narrative content, sans for UI

### Active Trip Hero Banner Design Rules
- Uses the SAME light palette as the rest of the page (NOT dark backgrounds)
- Soft transparent tints: `rgba(150,110,180,0.07)` style backgrounds
- Sub-cards for metrics (countdown, flights, next event) use even lighter tints
- Floating hearts are very subtle (opacity 0.04–0.08)
- Footer has a thin `rgba(150,110,180,0.08)` border-top separator
- Traveler badges are pill-shaped with 9999px border-radius
- "View Itinerary" CTA in mono font, purple, with external link icon

### Key CSS Classes
- `.page` — Main content wrapper (padding-top: 80px for fixed nav, padding-bottom: 6rem)
- `.container` — Max-width 1200px centered
- `.container-narrow` — Max-width 800px (used for chapter list, entry editor)
- `.nav`, `.nav-inner`, `.nav-link` — Fixed top nav with blur backdrop
- `.module-card` — Dashboard module cards with hover lift
- `.card`, `.card-flat` — General card system
- `.stat-card` — Dashboard stat display
- `.journal-tabs`, `.journal-tab` — Sub-tab navigation within modules
- `.chapter-card` — Memoir chapter list items
- `.entry-card-grid` — Masonry grid for journal entries (CSS column-count)
- `.badge`, `.badge-accent`, `.badge-success` — Status indicators

---

## 6. INTEGRATIONS & WORKFLOWS

### DayOne Integration
- Entries are created/edited in this app, then **manually copied** to DayOne via clipboard
- `DayOnePreview` uses `useToast()` + `navigator.clipboard.writeText(...)` directly; the standalone `copyToClipboard(text)` utility was removed in Phase 2 in favor of context-driven toasts
- DayOne Preview component shows formatted preview with journal name, tags, mood badge
- DayOne CLI path: `/Applications/Day One.app/Contents/MacOS/dayone` (for future automation)
- Journal names use **curly apostrophes** (Unicode U+2019): `Ishrat\u2019s Visits`

### Trip Workflow
1. **Planning**: Claude Code / Cowork builds itinerary in `trips/{slug}/` folder, creates `itinerary.html`
2. **Activation**: Copy itinerary to `site/active-trip.html`, update `site/data/manifest.json` with active trip data
3. **During trip**: Daily journal entries via trip-log skill → DayOne sync
4. **Completion**: Set `manifest.json` active to `null`, move trip to archive array
5. **Only ONE active itinerary at a time** — the hero banner shows it or hides

### manifest.json as Shared State
- **React app** fetches it on load via `fetch('data/manifest.json')` (relative path)
- **Claude Code / Cowork / Copilot** update it when creating or completing trips
- **Git-tracked**, human-readable, no database needed
- Each trip folder also has `trip.yaml` as the detailed source of truth (flights, highlights, memoir connections, DayOne config)

### Memoir Workflow
- Chapters live in `chapters/` as plain text files
- 8 chapters planned: Introduction, Man, Love, Marriage, Faith, Education, Parenthood, Friendship
- Each chapter has: title, subtitle ("Babu, What Does It Mean to Be a Man?"), status, word count, readiness score
- Incidents are story-worthy events that get placed into chapters
- Quotes are immutable reference material from books/people

---

## 7. CRITICAL RULES FOR ANY AI MAKING CHANGES

### Do
- Use CSS custom properties (`var(--accent)`, `var(--text-primary)`) — never hardcode colors
- Keep everything in the single `index.html` `<script type="text/babel">` block
- Use destructured hooks: `useState`, `useEffect`, `useRef` (NOT `React.useState`)
- Match existing font assignments: serif for narrative, mono for data, sans for UI, script for couple branding
- Use Font Awesome 6 solid icons (`fa-solid fa-icon-name`) via the `<Icon>` component
- Keep the lavender light aesthetic — transparent tints, soft borders, airy spacing
- Use `var(--font-mono)` for any dates, flight codes, metadata, stats
- Use `var(--font-serif)` for any narrative text, titles, trip names
- Add `padding-bottom: 6rem` breathing space on all pages

### Don't
- Don't introduce build tools (Vite, webpack, etc.) — CDN-only approach
- Don't use dark backgrounds on cards or banners — this is a LIGHT theme
- Don't use `React.useState()` — always `useState()` directly
- Don't create separate component files — everything stays in index.html
- Don't reference "Dad" — always "Babu" in all UI text
- Don't use straight apostrophes in DayOne journal names — must be curly (')
- Don't add real personal data — use Lorem ipsum placeholder entries in Asif's voice style
- Don't change the manifest.json structure without understanding the full flow
- Don't use `file://` URLs — serve everything through localhost

### Entry Body Text Voice (for Lorem Ipsum)
Asif's journal voice is: first-person, present-tense feeling with past-tense narration, sensory details, Ishrat always named, emotional undertones without melodrama, short punchy sentences mixed with flowing ones. Example: "The water stretched out before us, impossibly blue. She leaned against the railing and said nothing. I said nothing. The silence between us was the fullest conversation we'd had all week."

---

## 8. COMPONENT REFERENCE

### 8.1 Feature Components (module-level)

| Component | Purpose | Key Props/State |
|-----------|---------|-----------------|
| `App` | Root (wrapped in `<ToastProvider>`), nav, routing, Cmd-K palette | `page`, `activeChapter`, `readProgress`, `paletteOpen` |
| `HomePage` | Dashboard + hero banner | `trips`, `onNavigate` |
| `ActiveTripHero` | Trip countdown/live banner (keyboard-activatable) | `trips`, `onNavigate` |
| `MemoirModule` | Chapters / incidents / quotes | `tab`, `searchQuery` |
| `DayOneModule` | Entry browser / editor / new entry | `subTab`, `selectedTrip`, `selectedEntry`, new-entry form state |
| `DayOnePreview` | Formatted DayOne entry preview (copy-to-clipboard uses `useToast`) | `entry`, `selectedJournal` |
| `ChapterReader` | Memoir chapter reader with TOC, notes, bookmarks | Reader prefs via `useLocalStoragePrefs('reader', …)`; notes, bookmarks |
| `ScrollToTop` | Floating scroll-to-top with progress ring | `progress` |

### 8.2 Design-System Atoms (Phase 2)

Defined at the top of the `<script type="text/babel">` block in `site/index.html`.

| Atom | Purpose | Notable props |
|------|---------|---------------|
| `Icon` | Font Awesome wrapper | `name`, `size`, `color` |
| `Button` | Primary / secondary / ghost / destructive, loading state | `variant`, `size` (sm/md/lg), `loading`, `icon`, `iconRight`, `disabled` |
| `IconButton` | Icon-only button (requires `label` for aria-label) | `icon`, `label`, `variant`, `size` |
| `Badge` | Pure visual tag | `variant` (success/warning/error/info/neutral/accent), `size`, `icon` |
| `Text` | Polymorphic typography | `as`, `variant` (sans/serif/mono/script), `size`, `weight`, `align`, `color` |
| `Input`, `Textarea`, `Select` | Thin wrappers around `.input-field` CSS | Pass-through props |
| `Checkbox`, `RadioGroup` | Form atoms | `label` / `options` |

### 8.3 Design-System Molecules (Phase 2)

| Molecule | Purpose |
|----------|---------|
| `FormField` | `<label htmlFor>` + helper + error around a single input; auto-id, aria-describedby, `required` propagation |
| `Card` | Variants `flat` / `elevated` / `glass` / `module` — maps to existing `.glass-card` / `.module-card` classes; accepts extra `className` to preserve specifics like `.entry-card` / `.incident-card` / `.quote-card` |
| `StatusBadge` | Maps a status token (pending / drained / stuck / locked / active / planned / draft / complete) → `Badge` variant + icon + label |
| `EmptyState` | Standard empty view (icon, title, description, action) |
| `SkeletonRow` | Variants: itinerary-day / queue-row / chat-message / entry-card / chapter-line; 480ms pulse; respects reduced-motion |
| `Pill` | Togglable rounded button (`active` prop) |
| `Chip` | Dismissible tag (`onRemove` renders an `x` button) |
| `MenuItem` | Reusable list-item button used by `CommandPalette` |
| `ThinkingDots` | Animated loading dots for AI responses (used in Phase 3 FloatingChat) |
| `StepProgress` | Multi-step progress indicator (used in Phase 4 receipt pipeline) |

### 8.4 Design-System Organisms (Phase 2)

| Organism | Purpose |
|----------|---------|
| `Modal` | React portal, backdrop click to close, Esc to close, focus trap, body-scroll lock, focus restore on unmount. Sizes: sm / md / lg / xl |
| `ConfirmDialog` | Wraps `Modal`; `destructive` flag switches confirm button to destructive variant + warning icon. Replaces `window.confirm()` and silent deletes |
| `ToastProvider` | Context provider with `aria-live="polite"` container. `variant`: success / warning / error / info. Also exposes `window.__appToast.show(msg, variant)` so the independent `voice-refiner.jsx` React root uses the same single implementation |
| `CommandPalette` | Cmd-K / Ctrl-K shell. Fuzzy filter, arrow-key navigation, Enter to run, Esc to close. Phase 2 ships with an empty command list — Phase 3 registers commands |

### 8.5 State Hooks (Phase 2)

| Hook | Returns | Notes |
|------|---------|-------|
| `useFetch(url, options?)` | `{ data, loading, error, refetch }` | Auto-JSON-parses `application/json` responses; tracks a `tick` for refetch |
| `useLocalStoragePrefs(key, defaults)` | `[prefs, setPrefs]` | Rehydrates on mount, persists on every change. Used in `ChapterReader` to replace the 5 separate `rp_*` `useEffect` hooks (`fontScale`, `fontFamily`, `readingTheme`, `lineSpacing`, `contentWidth`) with a single `reader` key |
| `useActiveTrip()` | `{ trip, loading, error }` | Wraps `fetch('data/manifest.json')` and returns `manifest.active` (or null) |
| `useCommandPalette()` | `{ open, setOpen }` | Binds global Cmd-K / Ctrl-K |
| `useToast()` | `{ show, dismiss }` | Must be used inside `<ToastProvider>`; throws otherwise |

### 8.6 Design Tokens (Phase 2)

Added to `site/css/sample_lavender.css` under a top-level `:root` (theme-agnostic) alongside a global `prefers-reduced-motion` block and a `:focus-visible` default using `--focus-ring`. See [framework.md § App vs Cowork › Phase 2 design-system canon](../framework.md) for the full list (`--state-*`, `--radius-*`, `--space-*`, `--motion-*`, `--focus-ring`, `--shadow-card-hover`, `--shadow-float`).

### 8.7 Utilities

- `formatDate(iso)` — `YYYY-MM-DD` → `"Apr 20, 2026"`.
- `todayISO()` — today in `YYYY-MM-DD`. Use this instead of inline `new Date().toISOString().split('T')[0]`.

---

## 9. QUICK REFERENCE: FILE LOCATIONS

| What | Where |
|------|-------|
| The entire React app | `site/index.html` |
| Active theme CSS | `site/css/sample_lavender.css` |
| Base design system CSS | `site/css/base.css` |
| Active trip metadata | `site/data/manifest.json` |
| Active itinerary HTML | `site/active-trip.html` |
| Trip source files | `trips/{slug}/` |
| Trip detailed metadata | `trips/{slug}/trip.yaml` |
| Memoir chapters | `chapters/ch{NN}-{name}.txt` |
| Server start | `cd journal && npx serve . -l 3000 --cors` |
| App URL | `http://localhost:3000/site/index.html` (or `localhost:3000` with redirect) |
| Local Claude proxy | `cd journal/server && npm run start` — listens on `http://127.0.0.1:3001` |

---

## 10. LOCAL CLAUDE PROXY (SERVER/)

The React app is a thin edge client; every Anthropic API call goes through a local Node/Express proxy at `server/` on port 3001. The key lives in macOS Keychain — never in browser, never in `.env`. Phase 1 of `_workspace/ideas/app-cowork-execution-plan.md` locks the middleware stack and contract.

### 10.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + model + key-source diagnostics (no secrets). Exempt from rate-limit. |
| POST | `/api/voice-test` | Babu-memoir smoke test. Proves wiring + voice. |
| POST | `/api/refine` | Voice DNA refinement. Body: `{ text, model?, max_tokens?, promptName? }`. When `promptName` is omitted, uses `reference/voice-fingerprint.md` (legacy path). When supplied, uses the named prompt from `server/src/prompts/`. |
| POST | `/api/chat` | Generic passthrough. Body: `{ system?, messages, model?, max_tokens?, promptName? }`. When `promptName` is supplied, `prompt.system` wins over body `system`. |
| POST | `/api/trip-qa` | **Phase 3.** Trip Q&A backed by `promptName: "trip-qa"` (pinned `claude-haiku-4-5-20251001`). Body: `{ message, tripContext }`. The active trip JSON is stringified into the user message head; replies are 1-3 sentences. Returns `{ ok, response, usage, model, promptName }`. Rate-limited and usage-logged. |
| POST | `/api/trip-assistant` | **Phase 3 (staged for Phase 6).** Meta-router prompt for FloatingChat. Body: `{ message, tripContext, intent? }`. Same shape and middleware as `/api/trip-qa`; intent classification (`qa` / `edit` / `tool`) is reserved for Phase 6. |
| GET | `/api/reference-data/:name` | **Phase 3, Tier 0.** Serves the JSON file at `server/src/reference-data/{name}.json`. Currently provides `tipping`, `currency`, `packing`. 404 on miss. **No model call** — does not contribute model rows to `usage.jsonl`. |
| POST | `/api/upload` | **Phase 4.** Multipart image upload (field: `file`). `multer` memory storage; 5 MB cap; image type verified by magic-number sniff (header alone is untrusted). Writes to `trips/{activeSlug}/receipts/{uuid}.{ext}` and returns `{ ok, id, imagePath, bytes, ext }`. Oversize returns HTTP 413. |
| POST | `/api/extract-receipt` | **Phase 4.** Body: `{ imagePath }`. Tries macOS Vision first (via `server/scripts/mac-vision-ocr.swift`); on empty/unavailable, falls back to Haiku vision with the base64 image. Returns `{ ok, extracted, visionUsed, rawText?, usage, model, promptName }`. `visionUsed` flows into `usage.jsonl` via `res.locals.visionUsed`. Prompt: `extract-receipt`. |
| POST | `/api/queue/:name` | **Phases 4 + 5.** Schema-validated append to `trips/{slug}/{name}.json` (atomic temp-rename). Requires the body to be a full queue row with `schemaVersion: "1"`. Returns `{ ok, id, count, tripSlug }`. 404 on unknown queue name. Registered queues: `pending` (Phase 4), `voice-inbox` and `itinerary-inbox` (Phase 5; both share `pending.schema.json`). |
| GET | `/api/queue/:name` | **Phases 4 + 5.** Reads `trips/{slug}/{name}.json`. Returns `{ ok, items, tripSlug }` with `items: []` when the file is missing. |
| POST | `/api/ingest-itinerary` | **Phase 5.** Body: `{ itineraryText }`. Parses a pasted itinerary into a skeleton `{ flights, hotels, highlights, dates }` using `promptName: "ingest-itinerary"` (Haiku). Returns `{ ok: true, extracted, usage, model, promptName }` on success, or `{ ok: false, error: "structure ambiguous…", rawText }` at HTTP 200 when the model response cannot be parsed as JSON (so the UI can show the reason). HTTP 400 for empty input, HTTP 502 for Anthropic failures. |

Additional feature endpoints ship in later phases (`/api/trip-edit`, `/api/trip-edit/revert`, `/api/usage/summary`). See the execution plan §7.

### 10.2 Cross-cutting middleware (Phase 1)

- **Usage logger** — every request appends one JSONL row to `server/logs/usage.jsonl` with `{ timestamp, endpoint, method, model, promptName, tokensIn, tokensOut, durationMs, statusCode, visionUsed }`. Non-model endpoints log `tokensIn=0, tokensOut=0, model=null`. File is gitignored.
- **Rate limit** — 20 requests per 60 seconds, per IP, per endpoint path. `/health` is exempt. 21st request within the window returns HTTP 429 with `{ ok: false, error, endpoint, retryAfterSeconds }`.
- **Prompt loader** — `server/src/prompts/index.js` exposes `hasPrompt(name)` and `loadPrompt(name)`. Each prompt module exports `{ name, system, description, model? }`. Phase 1 registered `example`; Phase 3 added `trip-qa` (Haiku-pinned via `prompt.model`) and `trip-assistant` (Sonnet meta-router); Phase 4 added `extract-receipt` (Haiku; JSON-only; used by both the Vision-then-text path and the direct-vision fallback); Phase 5 added `ingest-itinerary` (Haiku; JSON-only; returns `{ flights, hotels, highlights, dates }` skeleton from a pasted itinerary).
- **Receipt pipeline helpers** (Phase 4) — `server/src/receipts.js` exposes the active-trip slug resolver, magic-number image sniffer, atomic-append/read for trip queue files, and the `macVisionOcr(imagePath)` wrapper around `swift mac-vision-ocr.swift` with a cached availability probe. `server/scripts/mac-vision-ocr.swift` runs `VNRecognizeTextRequest` in `.accurate` mode and prints recognized lines to stdout.
- **Reference data** (Phase 3) — `server/src/reference-data/` holds the Tier 0 JSON files served by `GET /api/reference-data/:name`. Names are validated against `^[a-z][a-z0-9-]*$` and resolved with a path-traversal guard.

### 10.3 Queue model (App → Cowork)

The App writes scratch queues under `trips/{slug}/`. Cowork (Claude Code in terminal) drains them. Processed artifacts are deleted after successful drain — no archives. Summary:

| Path | Kind | Lifecycle | Git |
|---|---|---|---|
| `trips/{slug}/pending.json` | Capture queue (Phase 4 receipts) | delete-on-drain | gitignored |
| `trips/{slug}/voice-inbox.json` | Voice transcript queue (Phase 5; single JSON array, not JSONL) | delete-on-drain | gitignored |
| `trips/{slug}/receipts/{id}.{ext}` | Receipt image binaries | delete-on-drain | gitignored |
| `trips/{slug}/itinerary-inbox.json` | Itinerary paste queue (Phase 5) | delete-on-drain | gitignored |
| `trips/{slug}/snapshots/*` | Pre-write snapshots for revert | delete-on-drain | gitignored |
| `trips/{slug}/dead-letter/*` | Rows drain failed on | survives until user discards | tracked |
| `trips/{slug}/edit-log.json` | Provenance log for bounded trip.yaml writes | durable | tracked |
| `server/logs/usage.jsonl` | Per-request telemetry | durable | gitignored |
| `server/logs/drain-log.jsonl` | Cowork drain provenance (Phase 4+) | durable | gitignored |

### 10.4 Schemas

- `server/src/schemas/pending.schema.json` — row contract for `pending.json`. Required `schemaVersion: "1"`.
- `server/src/schemas/edit-log.schema.json` — row contract for `edit-log.json`. Required `schemaVersion: "1"`.
- Valid + invalid fixtures live in `server/src/schemas/__fixtures__/`.
- Run `cd server && npm run validate` to compile schemas and assert fixtures pass/fail as expected. Prints `schemas OK, fixtures OK` on success.

### 10.5 Harassment check

`cd server && npm run harass` fires 21 requests at each non-health endpoint and asserts the 21st returns HTTP 429. Run against a live proxy (`npm run start` in a separate terminal). Prints `harass OK` on success.
