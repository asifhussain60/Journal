# Refine All + Tags Redesign — Implementation Handoff (v2, DoR-Complete)

You are Claude Code running in VS Code. Execute this brief top-to-bottom under CORTEX governance. DoR is locked at 14 decisions. Execution is layered (foundations first, views second, cleanup third) with mandatory human-verification checkpoints between views. Do not advance a commit until its gate passes. Do not advance a phase until the user explicitly verifies.

---

## ⚡ HOW TO RESUME — Cold Start Protocol

> **New chat? Read this first — takes 60 seconds, saves 10 minutes of context rebuilding.**

### Step 1 — Check git history (run this immediately)
```bash
git log --oneline origin/refine-all-redesign-v2 | head -30
```
Cross-reference with the **[Commit Map](#commit-map-actual)** at the bottom of this file. The first `⬜` row is your next task.

### Step 2 — Invoke journal-builder
journal-builder is the TDD/architectural gatekeeper for all Phase E+ work.
- Agent file: `.github/agents/journal-builder.agent.md`
- In a new chat simply reference this handoff and say: `"Run journal-builder cold start"`
- journal-builder will check git history, identify current phase, and confirm state before any implementation

### Step 3 — Check for pending user verification
Each phase has a `🛑 STOP` that requires user confirmation before the next phase begins. If the previous phase ended at a STOP, **wait for explicit user go-ahead before proceeding**.

### Step 4 — Resume
Once state is confirmed, begin implementation at the first `⬜` commit in the map.

### Quick orientation
| Item | Value |
|------|-------|
| Branch | `refine-all-redesign-v2` |
| Server start | `cd server && npm start` (uses `--env-file=.env`) |
| journal-builder agent | `.github/agents/journal-builder.agent.md` |
| CORTEX governance | `.github/agents/CORTEX.agent.md` |
| Feature flag | `REFINE_ALL_ENABLED=true` in `server/.env` |
| Test runner | `cd server && npm test` (Node built-in, no extra deps) |

---

## Meta

- **Version:** 2.0
- **Supersedes:** v1 (10-decision plan; carried P0 contract regressions — see Regression Delta appendix)
- **Governance:** CORTEX discipline — P0/P1/P2 severity, RED-GREEN-REFACTOR on each commit, convergence gate per phase, holistic validation before phase close
- **Scope boundary:** `/Users/asifhussain/PROJECTS/journal/`
- **Branch:** `refine-all-redesign-v2` (new branch — do not reuse the v1 `refine-all-redesign` name)

---

## Pre-flight

```bash
# From a clean main working tree:
git tag -f checkpoint/pre-refine-all-v2-2026-04-19
git checkout -b refine-all-redesign-v2
```

Rollback at any point:

```bash
git reset --hard checkpoint/pre-refine-all-v2-2026-04-19
git branch -D refine-all-redesign-v2
```

---

## Execution Discipline (non-negotiable)

1. **Foundations before views.** Phase A (all server/shared/schema/prompts/coordinator/export/flag work) completes fully — every gate passes — before any view commit begins. No UI code in Phase A.
2. **View-by-view with human-in-the-loop.** Each view ships as one complete, independently-verifiable commit set. After each view's final commit, **STOP, post a testing checklist, and wait for the user to verify**. Do not advance to the next view until the user confirms.
3. **Gate per commit.** Every commit has an explicit gate. If the gate fails, fix and re-gate before the next commit — do not accumulate debt.
4. **Regression sweep per phase.** Before closing a phase, run the phase-level regression checklist. Phase does not close with any regression unresolved.
5. **No unscoped work.** If a refactor opportunity appears outside the planned cleanup (Phase E), note it in `_workspace/scratch/observed-debt.md` and keep moving. Do not silently expand scope.

---

## Context

The Trip Log view's DayOne Composer previously had a "Highlights" bullet-list section with a "Suggest from entries" button — client-side text extraction. DayOne's native tag system was unused.

**What changed (B+):** Highlights replaced by a single **Reflection** freeform textarea with an AI refine button (✨). Tags section added as chip input with typeahead from cross-trip corpus. The Reflection refine button calls `POST /api/refine-reflection` which loads the voice DNA fingerprint and generates/enhances a 2-5 sentence reflection. Tags flow through the DayOne export pipeline as native `#tag` markers.

Remaining phases (C onward) wire the **Refine All** button — one click triggers two orchestrators: `synthesize-trip-narrative` (replaces Reflection with a full voice-DNA narrative paragraph) and `suggest-tags` (merges AI tags). The narrative streams via SSE so the user sees it render while tags finish computing. A feature flag gates Refine All.

---

## Locked DoR — 14 Decisions

| # | Decision |
|---|----------|
| **D1** | `trip.reflection` (freeform string, max 2000 chars) and `trip.dayoneTags[]` (open categorical, normalized slugs) coexist. DayOne export extended — `sanitizeCompose` accepts reflection + tags, `formatBundle` emits `## Reflection` paragraph + inline `#Tag1 #Tag2` line below Metadata using **display form**. |
| **D2 (revised)** | Two orchestrators fan out per Refine All click: `synthesize-trip-narrative` (Sonnet 4.6, full voice fingerprint, 150–300 word paragraph → populates Reflection); `suggest-tags` (Haiku, no voice DNA — slugs not prose, 5–12 normalized tags). Each returns `{value, hash, reasoning}` per D12. The standalone Reflection refine (✨ button) uses `refine-reflection` prompt — separate from Refine All. |
| **D3 (revised)** | Reflection textarea renders between Context and Tags. Refine All button lives in the Reflection section header. When clicked, it replaces the current Reflection with a full AI narrative and merges AI-suggested tags. |
| **D4 (revised)** | **C-strict skip-if-edited on content-hash Set.** For Reflection: store hash of last-AI-written value. Reflection is "AI-clean" iff `hashField(currentValue) ∈ storedHashSet`. **Tags are exempt** — always merge (case-insensitive dedup; user-added tags inviolate; AI cannot remove). Per-trip `rejectedAiTags[]` capped at 50 FIFO, auto-re-accepted on manual add (D14). |
| **D5** | Tag UI: hybrid input (freeform + typeahead from cross-trip corpus + AI-suggested chips). Normalize-store / preserve-display-form. Soft cap 15 (warning chip), hard cap 25 (input disabled). Internal normalized `Set` is the single source of truth. |
| **D6** | Captions-only inputs. Per-photo Refine is the contract — its refined captions feed all three trip-level orchestrators. No Vision re-pass on Refine All. `suggest-tags` additionally receives top-50 cross-trip corpus tags so AI auto-aligns to user vocabulary. |
| **D7 (revised)** | New `server/src/lib/voice-fingerprint.js` consolidates fingerprint loading. **Preserves the existing 5-second TTL hot-reload semantics** from `server/src/lib/refine.js`. Both `routes/log.js` and `lib/refine.js` refactor to use the new module. Hot-reload gate: edit fingerprint → wait 6s → refine → new output reflected without restart. |
| **D8 (retired)** | ~~Highlights fallback~~ — no longer applicable. Highlights replaced by Reflection. Refine All failure shows a retry toast; no local extraction fallback needed for a prose field. |
| **D9 (revised)** | Client `refineState` shape: `{reflection: {status, hashes}, tags: {status}}`. Status enum: `idle \| pending \| streaming \| success \| failed \| edited`. `streaming` is reflection-only (SSE). `edited` is **computed at render time**, never stored. Drives per-field spinners, edited badges, failed/retry chips. |
| **D10 (revised)** | **All-or-nothing is scoped to the requested field set.** Two endpoints: `POST /api/trip-refine-all` (atomic over reflection + tags) and `POST /api/trip-refine-field` (atomic single-field; fuels Re-synth on reflection). Plus standalone `POST /api/refine-reflection` (quick refine, no atomic commit needed — saves directly). Client posts Refine All results back as an atomic `patches[]` PATCH to `/api/trip-edit`. Single failure surface, single retry, single write. |
| **D11 (new)** | **Concurrency guard via `baseVersion` ETag.** `/api/trip-edit` and `/api/trip-refine-all` accept `baseVersion` (hash of trip.yaml at client read). Server rejects mismatches with `409 Conflict`; client reloads trip and retries. Prevents lost-updates from double-click, cross-tab edits, or interleaved Refine All + manual edit. |
| **D12 (new)** | **In-phase capability adds:** (a) idempotency `requestId` on coordinator endpoints — 60s server-side response cache keyed by `{tripId, requestId}`; (b) each orchestrator returns a one-line `reasoning` field surfaced on badge/chip hover; (c) captions-hash memoization — 15-minute short-cache keyed by `hash(concat(sortedCaptions))` returns prior result when captions unchanged; (d) **SSE streaming** — coordinator streams narrative tokens while tags finish; atomic commit happens only after both succeed. |
| **D13 (new)** | **Feature flag:** `REFINE_ALL_ENABLED` env var on the server; `/api/config` exposes the value; client hides Refine All button when false (✨ quick refine still works). Safe gradual rollout + instant rollback without git ops. |
| **D14 (new)** | **`rejectedAiTags[]` policy:** capped at 50 most-recent (FIFO); manually adding a tag in the reject list auto-removes it from the list. Self-correcting, bounded, intent-respecting. |

---

## Phase A — Foundations (no UI)

No view work until every Phase A gate passes. Commits stay server-side, shared-code, and infra only.

### Commit A1 — Shared normalization module (D5 support)
- Create `shared/tag-normalize.js` (new top-level `shared/` directory for dual-surface modules). Exports `normalizeTag(raw)` — NFC-normalize, lowercase, whitespace runs → single hyphen, strip non-`[a-z0-9-]`, collapse repeat hyphens, trim leading/trailing hyphens. Pure function, no dependencies.
- Add `server/src/lib/tag-normalize.js` that re-exports from `shared/`. Keeps server imports local-path for IDE sanity.
- Serve `shared/` as a static asset from Express (mount at `/shared/*`) so the client can `import` it via `<script type="module">`.
- **Gate:** server unit-level check — `normalizeTag('New Jersey')`, `normalizeTag('  snow--storm  ')`, `normalizeTag('café ☕')` return expected slugs. Static asset fetches `200 text/javascript`.

```bash
git add -A && git commit -m "refine-all(A1): shared/tag-normalize.js + static mount"
```

### Commit A2 — Schema extensions (D4 revised, D11)
- Extend `server/src/schemas/trip-edit.schema.json`:
  - `narrative: { type: "string", maxLength: 4000 }`
  - `narrativeAiHashes: { type: "array", items: { type: "string", pattern: "^[a-f0-9]{16}$" }, default: [] }` (Set semantics — deduped array)
  - `highlightsAiHashes: { ... }` — **DEPRECATED**, retained for backward compat; not used by Reflection.
  - `reflection: { type: "string", maxLength: 2000, default: "" }`
  - `dayoneTags: { type: "array", items: { type: "string", maxLength: 50 }, default: [] }`
  - `rejectedAiTags: { type: "array", items: { type: "string", maxLength: 50 }, default: [], maxItems: 50 }`
- Create `server/src/lib/hash-field.js` — exports `hashField(value)` returning first 16 hex chars of SHA-256.
- **Gate:** schema validator loads; round-trip save+read of a trip with all new fields succeeds; rejected 51-item `rejectedAiTags[]` fails validation.

```bash
git add -A && git commit -m "refine-all(A2): schema extensions + hash-field.js (content-hash Set model)"
```

### Commit A3 — Voice fingerprint consolidated cache (D7 revised)
- Create `server/src/lib/voice-fingerprint.js`: `getFingerprint()` with **5-second TTL cache** identical to current `refine.js` behavior. Also export `getFingerprintLight()` reading `reference/voice-fingerprint-light.md`, same cache semantics. `invalidate()` for tests.
- Author `reference/voice-fingerprint-light.md` — tone constraints + absolute prohibitions only (no prose-voice deep analysis). Independent file, independent versioning, used by the `refine-reflection` prompt.
- Refactor `server/src/routes/log.js` (line 34 constant, line 476 read) and `server/src/lib/refine.js` (lines 13, 27–37, 51) to import from the new module. **Behavioral invariant:** prompt system text remains byte-identical; TTL semantics remain 5s.
- **Gate:** (a) existing per-photo refine produces byte-identical prompt output vs pre-refactor (capture before/after with `DEBUG=prompt node ...`); (b) hot-reload — edit `voice-fingerprint.md`, wait 6s, refine again — new content appears without restart; (c) `voice-fingerprint-light.md` loads and returns distinct content.

```bash
git add -A && git commit -m "refine-all(A3): voice-fingerprint.js consolidated cache + light variant"
```

### Commit A4 — Tag corpus module (D5, D6 support)
- Create `server/src/lib/tag-corpus.js`:
  - `getCorpus()` — scans all `trips/*/trip.yaml` `dayoneTags[]` on first call; builds `Map<normalized, {displayForm, count, lastUsedTripId, lastUsedAt}>`; caches in module scope.
  - `getTopN(n=50)` — sorted by count desc, displayForm preserved.
  - `invalidate()` — clears cache. **Hooked into `trip-edit-ops.js` write-success path** when a write touches `/dayoneTags`.
  - Uses `shared/tag-normalize.js` via server re-export.
- **Gate:** on `npm run dev`, hit a temporary debug route that calls `getCorpus()` and returns top-20 — counts and display forms match hand-tallied survey of existing trips; `invalidate()` after a tag save triggers rebuild (confirmed by count delta).

```bash
git add -A && git commit -m "refine-all(A4): tag-corpus.js with write-path invalidation"
```

### Commit A5 — Orchestrator prompts (D2)
- `server/src/prompts/synthesize-trip-narrative.js` — full voice fingerprint via `getFingerprint()`; `model: 'claude-sonnet-4-6'`; output spec: single paragraph, 150–300 words, journal prose, no markdown, no headings; response envelope includes `reasoning` (one line, why this narrative frame).
- `server/src/prompts/suggest-tags.js` — no voice DNA; tag normalization rules inline in system; receives `existingCorpus: top-50`; `model: 'claude-haiku-4-5-20251001'`; output spec: JSON `{tags: string[], reasoning: string}`, 5–12 normalized slugs. Server post-validates and re-normalizes any non-conforming output.
- `server/src/prompts/refine-reflection.js` — full voice fingerprint via `getFingerprint()`; `model: 'claude-sonnet-4-6'`; two modes: blank (generate 2-4 sentences from entries) vs draft (enhance user text in voice DNA). **Already built and committed.**
- Register all in `server/src/prompts/index.js`.
- **Gate:** each prompt loadable via `loadPrompt(name)`; run each manually with hand-built input and verify shape.

> **Note:** `suggest-highlights.js` prompt was in the original plan but is no longer needed. Highlights replaced by Reflection.

```bash
git add -A && git commit -m "refine-all(A5): three orchestrator prompts registered"
```

### Commit A6 — Coordinator endpoint + atomic patches + baseVersion (D10 revised, D11)
- Create `POST /api/trip-refine-all` in `server/src/routes/trip-refine-all.js`:
  - Body: `{tripId, requestId, baseVersion, photos, title, subtitle, dateRange}`.
  - Feature-flag gate: if `REFINE_ALL_ENABLED !== 'true'`, return `503 {error: 'refine-all disabled'}`.
  - Idempotency: if `(tripId, requestId)` hit within 60s, return cached response.
  - Captions-hash memoization: if `hash(concat(sortedCaptions))` hit within 15min, return cached combined response.
  - Loads `tag-corpus.getTopN(50)` and trip's `rejectedAiTags[]`.
  - Runs two orchestrators via **`Promise.allSettled`** (not `Promise.all` — prior plan had a latent bug).
  - **All-or-nothing:** if any orchestrator rejected, return `500 {errors: {narrative?, tags?}}` with no partial response.
  - On full success, return `{narrative: {value, hash, reasoning}, tags: {values: [], reasoning}}`.
  - Filter AI tag suggestions through `rejectedAiTags[]` before returning.
  - Log each orchestrator's `{promptName, model, latencyMs, inputTokens, outputTokens, tripId, requestId}` to the usage table.
- Extend `POST /api/trip-edit` to accept `{baseVersion, patches: [...]}`:
  - Feature-flag gate when patches present.
  - **`baseVersion` required when `patches[]` present.** Compute `hash(trip.yaml contents)` on read; reject with `409 Conflict {currentVersion}` on mismatch.
  - Validate each patch is RFC 6902 and touches only allowlisted paths: `/narrative`, `/narrativeAiHashes`, `/reflection`, `/dayoneTags`, `/dayoneTags/*`, `/rejectedAiTags`, `/rejectedAiTags/*`. Reject any other path with `400`.
  - Apply via `fast-json-patch`; write atomically via existing `serializeTripObj` flow.
  - On `/dayoneTags` touch: post-write call `tag-corpus.invalidate()` inside a `try/catch` that never rethrows (corpus rebuild is best-effort).
  - Legacy `{intent, message}` path is unchanged — extension is additive.
- **Gate:** end-to-end curl — healthy `/api/trip-refine-all` returns combined response <8s (Sonnet is the floor); atomic PATCH writes; duplicate `requestId` returns cached; stale `baseVersion` returns 409; bad patch path returns 400; feature flag off returns 503; `allSettled` confirmed by forcing one orchestrator to fail and seeing partial errors object (then the all-or-nothing contract drops the partial data, as specified).

```bash
git add -A && git commit -m "refine-all(A6): /api/trip-refine-all coordinator + patches[] + baseVersion 409"
```

### Commit A7 — SSE streaming on coordinator (D12 streaming)
- Convert `POST /api/trip-refine-all` to dual-mode: Accept header `text/event-stream` → SSE response; default `application/json` → current batch mode (kept for curl/tooling).
- SSE event stream:
  - `event: narrative.delta` (token batches, 16-token min)
  - `event: tags.done { values, reasoning }`
  - `event: narrative.done { value, hash, reasoning }`
  - `event: complete` (both finished, client commits patches)
  - `event: error { errors }` (any orchestrator failed — all-or-nothing, client discards partial state)
- Atomic write invariant preserved: server does NOT write to trip.yaml during streaming; client posts final `patches[]` to `/api/trip-edit` only after receiving `complete`.
- **Gate:** SSE curl client (`_workspace/scratch/sse-smoke.js`) observes delta events within 2s of request; `complete` fires only after all three done; forced orchestrator failure emits `error` and no `complete`; batch-mode curl still works.

```bash
git add -A && git commit -m "refine-all(A7): SSE streaming on coordinator, atomic commit preserved"
```

### Commit A8 — Single-field Re-synth endpoint (D10 complement)
- Create `POST /api/trip-refine-field`:
  - Body: `{tripId, requestId, baseVersion, field: 'narrative', photos, title, subtitle, dateRange}`.
  - Runs only the narrative orchestrator; returns `{value, hash, reasoning}`.
  - Same 60s idempotency cache keyed by `(tripId, requestId, field)`.
  - Atomic single-field contract: server does not write — client posts a single-field `patches[]` to `/api/trip-edit`.
  - Tags field not exposed here (always-merge semantics — Re-synth doesn't apply).
- **Gate:** curl each field path returns field-only payload; unknown field returns 400.

```bash
git add -A && git commit -m "refine-all(A8): /api/trip-refine-field for per-field Re-synth"
```

### Commit A9 — DayOne tag export pipeline (D1)
- Extend `sanitizeCompose()` in `server/src/routes/dayone.js:58` to accept `tags: string[]` (max 25, each ≤50 chars, display form preserved, whitespace-in-tag rejected).
- Extend `formatBundle()` in `dayone.js:106-155`:
  - Before appending metadata, **escape body hashtags** — replace `#` at word-start in the reflection body with `＃` (U+FF03 full-width hash) so DayOne only parses the explicit tag line.
  - Append a final line below the Metadata block: `#Tag1 #Tag2 #Tag3` using **display form**. Skip entirely if tags empty.
- Update the Composer DayOne bundle payload (wherever `/api/dayone/bundle` is called in `site/index.html`) to include `tags: trip.dayoneTags || []`.
- **Gate:** compose a bundle for `2026-04-ishrat-engagement` with hand-added tags — markdown ends with `#Tag ...`; a narrative containing `#covid` renders as `＃covid` in the body but does not appear in the tag line; paste into DayOne and confirm tag panel populates correctly.

```bash
git add -A && git commit -m "refine-all(A9): dayoneTags through bundle + body hashtag escape"
```

### Commit A10 — Feature flag plumbing (D13)
- Add `REFINE_ALL_ENABLED` to `.env.example` (default `true`).
- Expose via `GET /api/config` alongside any existing flags; do not include secrets.
- No client changes yet — that lands in Phase B/C where it gates the UI swap.
- **Gate:** `curl /api/config` returns the flag; flipping env var + restart reflects; `/api/trip-refine-all` with flag off returns 503.

```bash
git add -A && git commit -m "refine-all(A10): REFINE_ALL_ENABLED flag + /api/config exposure"
```

### 🛑 Phase A CONVERGENCE GATE (before any view work)

Run the full foundations regression sweep. Report results. **Do not start Phase B until all pass:**

1. Every Phase A gate green.
2. Legacy per-photo refine still produces byte-identical output.
3. Legacy `/api/trip-edit` `{intent, message}` assistant flow still works.
4. Existing DayOne bundle export for a legacy trip with no tags is unchanged (no stray `#tag` line).
5. Voice fingerprint hot-reload confirmed working (6-second edit propagation).
6. Tag corpus rebuilds on trip save; invalidation is non-blocking on failure.
7. Schema validation accepts legacy trips missing the new fields (default-safe).

No human-in-the-loop stop here — Phase A is server-side only and mechanically verifiable. Proceed to Phase B automatically if the sweep is clean.

---

## Phase B — View 1: Tags (D5)

### Commit B1 — TagInput component
- In `site/index.html`, create `TagInput` function component (htm/preact). Props: `{value: string[], onChange, corpus, aiSuggestions, rejectedAiTags, onRejectAi, disabled}`.
- Client-side `normalizeTag` imported from `/shared/tag-normalize.js` via `<script type="module">` at the top of `index.html`. **Zero duplication.**
- Internal state: normalized `Set` derived via `useMemo` from `value`. All add/remove helpers normalize first and check the Set. Adding an existing tag is a no-op (not an error).
- UI:
  - Chips with `×` removal — reuse existing chip visual tokens (grep `chip` under `site/css/themes/`).
  - Typeahead input below chips — debounced 150ms, filter corpus by `normalized.includes(normalizedInput)` minus chips already in Set, render dropdown of top 8 with displayForm + count.
  - Collapsible "✨ N AI suggestions" row below typeahead — renders `aiSuggestions` chips minus those already in value or in `rejectedAiTags`. Click to add, click × to reject (→ `onRejectAi(tag)`).
  - Counter chip above input: `N / 15 tags` — yellow at 15, red + input disabled at 25.
  - Each AI-suggested chip has a title attribute showing the orchestrator's `reasoning` (D12).
- Validation: trim input on Enter; comma commits; hard-block tags >50 chars with inline error.
- Accessibility baseline (full pass lives in E1): `role="listbox"` on dropdown, `role="option"` on items, `aria-label` on `×` buttons, `aria-live="polite"` on counter.
- **Gate:** component renders standalone in a scratch harness at `_workspace/scratch/taginput-harness.html`; adding `Snow`/`snow`/`SNOW` yields one chip; rejecting an AI suggestion persists through re-render; 25 tags disables input.

```bash
git add -A && git commit -m "refine-all(B1): TagInput component with shared normalize + a11y baseline"
```

### Commit B2 — TagInput integrated into Composer
- Replace the current tags rendering in the Composer with `<TagInput ... />`.
- On Composer mount, client calls `GET /api/tag-corpus/top` (new thin route, just `{top: tag-corpus.getTopN(50)}`) — add the route in this commit.
- On tag change: debounced 400ms save via `PATCH /api/trip-edit` with `{baseVersion, patches: [{op: 'replace', path: '/dayoneTags', value: nextTags}]}`. On 409, reload trip and retry automatically; display a subtle "synced" toast. On manual-add that's in `rejectedAiTags[]`, also emit a patch removing it from the list (D14).
- Feature-flag-respecting: when `REFINE_ALL_ENABLED=false`, `aiSuggestions` prop is empty (no AI chips) but freeform + typeahead still work.
- **Gate:** end-to-end in the real app on the `2026-04-ishrat-engagement` trip — add tag, remove tag, reorder doesn't happen (tags are a Set visually ordered by insertion), refresh page → tags persist, add 25 → disabled, cross-tab edit → 409 reloads without data loss.

```bash
git add -A && git commit -m "refine-all(B2): TagInput wired into Composer with 409 auto-reload"
```

### 🛑 Phase B STOP — User Verification Required

**Where:** Open the Trip Log → switch to **Reviewed** view → scroll to the Composer.

1. **Tags section visible** — Below the Reflection box, you see a "Tags" label with an input area.
2. **Add a tag** — Type "engagement" and press Enter. A chip appears.
3. **Case dedup** — Type "Engagement" then "ENGAGEMENT". No new chips appear (already added).
4. **Remove a tag** — Click × on a chip. It disappears.
5. **Typeahead** — Type "en" — a dropdown shows matching tags from your other trips (if any exist).
6. **Persists on refresh** — Add a few tags, refresh the page. Tags are still there.
7. **Counter** — The bottom-right shows "3 / 25 tags" (or however many you added).
8. **Title/Context/Reflection still work** — Edit the Title, type in the Reflection box. Everything behaves as before.

Post this checklist and **wait for explicit go-ahead** before Phase C.

---

## Phase C — Refine All: Full AI Narrative + Tags (D3 + D9 + D12 streaming)

> The standalone ✨ Reflection refine button (already built) handles quick AI enhancement.
> Refine All is the big-gun: replaces Reflection with a full 150-300 word trip narrative
> and merges AI-suggested tags. One click, two orchestrators, SSE streaming.

### Pre-C1 — Server cleanup (quick win)
- Remove `server/src/prompts/suggest-highlights.js` (dead code — highlights no longer exist).
- Refactor `server/src/routes/trip-refine-all.js`: remove `buildHighlightsInput()`, `runHighlights()`, `highlights.done` SSE event. The coordinator now fans out only `synthesize-trip-narrative` + `suggest-tags` (two orchestrators, not three).
- Update the `Promise.allSettled` in both SSE and batch modes to handle two results instead of three.
- Update `/api/trip-refine-field` in `trip-refine-all.js` to accept only `field: 'narrative'` (no `'highlights'`).
- Deregister `suggestHighlightsPrompt` from `server/src/prompts/index.js`.

### Commit C1 — Refine All button + refineState
- Add `refineState` to Composer state: `{reflection: {status, hashes}, tags: {status}}`. Initialize from trip's `narrativeAiHashes` on load. `edited` computed at render time — never stored.
- Add a `[✨ Refine All]` button in the Reflection section header (right side, next to the existing ✨ refine icon).
  - Refine All = full narrative generation (replaces entire Reflection). The existing ✨ icon = quick enhance (preserves user text).
  - Conditional badges on the Reflection section: `edited`, `failed`, `streaming`, `success`, `pending`.
  - `[Re-synth]` action inside the `edited` badge; `[Retry]` inside the `failed` badge.
  - Each orchestrator badge has a title with its `reasoning` (D12).
- When `REFINE_ALL_ENABLED=false`, the Refine All button is hidden; the ✨ refine icon still works.
- **Gate:** section renders; status badges correctly toggle via devtools state injection; no network calls yet.

```bash
git add -A && git commit -m "refine-all(C1): Refine All button scaffold + refineState derivation"
```

### Commit C2 — Refine All wiring with SSE streaming
- Refine All handler:
  1. Generate `requestId = crypto.randomUUID()`.
  2. Capture `baseVersion` from the trip's last-read hash.
  3. Pre-compute if `hashField(currentReflection) ∈ storedHashSet` — skip if edited (marks `edited`, requires explicit Re-synth). Tags always participate.
  4. Open `fetch` with `Accept: text/event-stream` to `POST /api/trip-refine-all`.
  5. On `narrative.delta`: append tokens to Reflection textarea live with `status: 'streaming'`.
  6. On `narrative.done`: commit to `value.reflection`, status → `success`.
  7. On `tags.done`: update pending state, status → `success`.
  8. On `complete`: build `patches[]` (respecting edited-skip for reflection; tags merged as `union(currentTags, newTags) − rejectedAiTags` per D14); PATCH `/api/trip-edit`. On 409, reload trip and re-post with fresh baseVersion.
  9. On `error`: all statuses → `failed`; **no patches written**; toast: "Refine All failed. [Retry]".
- Disable Refine All button while any status is `pending | streaming`.
- **Gate:** run against real trip — text streams visibly; both fields populate; hashes persist; edit reflection manually → Refine All skips it with `edited` badge; forced failure → all-or-nothing.

```bash
git add -A && git commit -m "refine-all(C2): Refine All with SSE streaming, atomic commit, 409 retry"
```

### Commit C3 — Re-synth per-field
- `[Re-synth]` in the `edited` badge fires `POST /api/trip-refine-field` with `field: 'narrative'`.
- Confirm first via `confirm()`: "Overwrite your edits to the reflection?"
- Atomic single-field patch posted to `/api/trip-edit` on success.
- **Gate:** edit reflection → click Re-synth → confirmation → overwritten with AI output, hash updated; cancel → no-op.

```bash
git add -A && git commit -m "refine-all(C3): per-field Re-synth with confirmation"
```

### 🛑 Phase C STOP — User Verification Required

**Where:** Open the Trip Log → **Reviewed** view → Composer. You need a trip with approved photo entries.

1. **Two AI buttons** — The Reflection section has a small ✨ icon (quick refine) and a larger "Refine All" button.
2. **Click Refine All** — Text streams word-by-word into the Reflection box. Tags also populate. Green checkmarks appear.
3. **Hover the checkmarks** — A tooltip shows the AI's reasoning for each section.
4. **Edit the reflection** — Change a word. An "edited" badge appears.
5. **Click Refine All again** — The reflection is NOT overwritten ("edited" badge stays). Tags refresh normally.
6. **Click Re-synth** — Inside the "edited" badge, click Re-synth. Confirm. The AI overwrites your edit with a fresh narrative.
7. **Refresh the page** — Everything saved. No "edited" badges (hashes match).
8. **Quick refine still works** — Clear the reflection, type a sentence, click the small ✨. It enhances your text without doing a full Refine All.

Post this checklist and **wait for go-ahead** before Phase E.

### journal-builder Post-Phase-C Review
> Run this before Pre-E0. journal-builder audits Phase C (Pre-C1/C1/C2/C3) and improves itself.

```bash
# Commits to audit:
git log --oneline refine-all-redesign-v2 | head -10
```

journal-builder must:
1. Check the three new server routes (`trip-refine-all.js`, version field in `trip.js`, version in `trip-edit.js`) against its Known Contracts table — update any missing/wrong entries.
2. Check the new client state shape (`refineState`, `tripVersion`, `aiSuggestedTags`) against its Schema Invariants — document in agent file.
3. Identify any debt, drift, or patterns worth recording.
4. Self-update `.github/agents/journal-builder.agent.md` with findings, then:

```bash
git add -f .github/agents/journal-builder.agent.md
git commit -m "chore(journal-builder): post-phase-C review — contracts + schema sync"
```

---

## Phase D — RETIRED

> Phase D (Highlights chip redesign) is no longer needed. Highlights have been
> replaced by the Reflection textarea (committed in Phase B+). Skip to Phase E.

---

## Phase E — Holistic Refactor & Systematic Cleanup

Industry-standard best-practice sweep across the Refine All surface and adjacent code. Not a full-site overhaul — scope is bounded to code touched in Phases A–D **plus** directly-adjacent SPA infrastructure that affects UX consistency.

### Pre-E0 — Test harness bootstrap *(journal-builder gate — must land before E1)*

> **CORTEX governance note:** As of 2026-04-19, `.github/agents/journal-builder.agent.md` is active.
> All Phase E+ work runs under journal-builder's TDD discipline. No E-series commit is approved without
> tests written first. Pre-E0 stands up the harness so that gate is mechanically enforceable.

**Actions:**
1. Add to `server/package.json` scripts:
   ```json
   "test": "node --test 'src/**/*.test.js'",
   "test:watch": "node --test --watch 'src/**/*.test.js'"
   ```
   Zero new runtime dependencies — uses Node 18+ built-in test runner.
2. Create `server/src/lib/tag-normalize.test.js` — pure function, ideal TDD entry point.
   Cover: empty string, whitespace trimming, slug normalization, unicode emoji passthrough, max-length enforcement.
3. Create `server/src/lib/hash-field.test.js` — covers determinism, 16-hex output, empty input.
4. Create `server/src/routes/trip-edit.test.js` — covers baseVersion 409 conflict guard (D11), patch allowlist rejection of unknown paths, successful patch response shape includes `version`.
5. Add `npm test` step to `.github/workflows/ci.yml` (after install, before any deploy).

**Gate:** `cd server && npm test` exits 0. CI passes. Failing tests are blocked from merge.

```bash
git add -A && git commit -m "refine-all(Pre-E0): test harness bootstrap — Node built-in runner, tag-normalize/hash-field/trip-edit coverage"
```

---

### Commit E1 — Accessibility audit (WCAG 2.2 AA)
- Every interactive element is a semantic element: `<button type="button">` or `<a href>`. No `<div onClick>` or `<span onClick>` for interactions.
- ARIA: `role="listbox"` on typeahead dropdown, `role="option"` on items, `aria-selected` on hover/focus, `aria-expanded` on the dropdown trigger.
- Focus management: (a) Refine All button returns focus to itself after success; (b) typeahead dropdown auto-focuses first option on open; (c) `Esc` closes dropdown and returns focus to input; (d) `Tab` cycles through chips before entering the input.
- Keyboard nav: `←/→` moves between chips; `Backspace` in empty input removes last chip; `Enter` and `,` commit typeahead input.
- Screen reader: all icon-only buttons have `aria-label`; toast container has `aria-live="polite"`; streaming narrative has `aria-busy="true"` while streaming.
- Color contrast: verify all chip states (idle/success/edited/failed/pending/streaming) hit WCAG AA (4.5:1 for text, 3:1 for UI chrome) against theme background in BOTH light and dark modes. Use the existing CSS token system — no hardcoded colors.
- Reduced motion: honor `prefers-reduced-motion` — disable the streaming token fade-in animation, keep the state transition.
- **Gate:** run axe-core CLI against a local dev instance across all three redesigned sections; zero errors, zero critical warnings. Manual keyboard-only walk-through of the full flow succeeds.

```bash
git add -A && git commit -m "refine-all(E1): a11y pass — WCAG 2.2 AA, keyboard nav, reduced-motion"
```

### Commit E2 — State discipline & data-flow hygiene
- Single source of truth per field — no duplicate state between Composer and children.
- Derived state via `useMemo` (normalized Sets, typeahead filtered lists, hash comparisons, `edited` booleans).
- `useCallback` stabilizes event handlers passed as props to prevent unnecessary re-renders.
- Persist discipline: only domain data goes into trip.yaml — `edited` status, typeahead open/close state, streaming buffer are all ephemeral UI state.
- Extract a `ComposerContext` if prop-drilling exceeds three levels for refine-related props.
- **Gate:** React DevTools Profiler — typing in TagInput does not re-render NarrativeSection; clicking Refine All does not cascade to unrelated Composer fields.

```bash
git add -A && git commit -m "refine-all(E2): state discipline — memoization, context, no persisted UI state"
```

### Commit E3 — Performance & responsiveness
- Typeahead input: `useDeferredValue` or 150ms debounce on the filter.
- Corpus sort/filter memoized; re-computes only when corpus length or input changes.
- SSE narrative: render token batches (min 16 tokens or 100ms window, whichever first) to avoid layout thrash on every token.
- Refine All button disables while any status is `pending|streaming` — defense-in-depth against double-fire (server D11 guard is primary).
- Skeleton UI during initial connect (SSE handshake): show a subtle shimmer in the narrative textarea instead of an empty screen or raw spinner. Matches existing theme tokens.
- Optimistic UI on tag add/remove; reconcile if server save fails (rollback chip to prior state, toast the error).
- **Gate:** Chrome DevTools Performance trace during a Refine All shows no long tasks >100ms in the main thread during streaming; typing rapidly in TagInput does not drop frames (60fps sustained).

```bash
git add -A && git commit -m "refine-all(E3): performance — debounce, memoization, batched SSE, skeleton UI"
```

### Commit E4 — Observability & telemetry hardening
- Structured server-side logs per orchestrator call: `{promptName, model, latencyMs, inputTokens, outputTokens, totalCostUsd, tripId, requestId, success}`. Persisted to existing usage table with a new columns migration if needed.
- Client-side structured logger: `console.groupCollapsed('Refine All', ...)` with event rows — gated by `localStorage.DEBUG_REFINE === 'true'`. No raw `console.log` in production paths.
- Failure toasts name the orchestrator: "Refine All failed: suggest-tags — rate limited (retry in 30s)".
- `/api/usage/refine-all` endpoint returns a 30-day rollup per orchestrator: p50/p95 latency, token totals, failure rate. Feeds a future Admin view (out of scope here).
- **Gate:** run five Refine All calls, inspect usage table — every call has all fields populated; force a rate-limit on one orchestrator → toast names it, usage table records failure.

```bash
git add -A && git commit -m "refine-all(E4): observability — structured logs, cost fields, debug logger"
```

### Commit E5 — Code organization & module hygiene
- `site/index.html` has crossed the readability threshold. Extract Refine All-related components to `site/components/` as **native ESM modules** (no build step required):
  - `site/components/TagInput.mjs`
  - `site/components/ReflectionSection.mjs`
  - `site/components/RefineStateBadge.mjs`
  - `site/components/Toast.mjs` (if a central toast doesn't already exist; otherwise leave it)
  - Each file is a single default-exported component with JSDoc `@typedef` for props.
- Imports in `index.html` via a single `<script type="module" src="/site/components/index.mjs">` barrel.
- `site/constants.mjs` — all magic numbers and enums: `TAG_SOFT_CAP=15`, `TAG_HARD_CAP=25`, `DEBOUNCE_MS=150`, `STATUS_IDLE='idle'`, etc.
- Co-located CSS: `site/components/*.css` imported via `@import` from the main theme stylesheet; no component reinvents the chip token.
- Commit hygiene: `npm run lint` (if configured) passes; every new server module passes `node --check`.
- **Gate:** `site/index.html` line count drops measurably (target: below 3000 lines); every extracted module imports cleanly; app loads with no 404s, no console errors, no CSS regressions.

```bash
git add -A && git commit -m "refine-all(E5): component extraction to native ESM modules + constants file"
```

### Commit E6 — Documentation & type hints
- File-head comment on every new module: purpose, inputs, outputs, gotchas.
- JSDoc `@typedef` for shared shapes: `RefineState`, `TagCorpusEntry`, `OrchestratorResult`, `PatchRequest`, `SseEvent`. VS Code IntelliSense without TS build step.
- New `reference/refine-all-architecture.md`: one-page flow diagram — UI click → SSE stream → two orchestrators → client-side aggregation → atomic PATCH → corpus invalidate → render.
- `framework.md` appendix: full DoR table (D1–D14), commit map (A1–G3), rollback procedure.
- **Gate:** open any new module in VS Code — JSDoc types surface on hover of props; `reference/refine-all-architecture.md` lints as markdown.

```bash
git add -A && git commit -m "refine-all(E6): docs + JSDoc types + architecture diagram"
```

### 🛑 Phase E STOP — User Verification Required

**Where:** Reviewed Composer view, both light and dark themes.

1. **Switch themes** — Open the theme picker. Try at least one light and one dark theme. Tags and Reflection both look correct.
2. **Keyboard only** — Without touching the mouse: Tab to Reflection, type text, Tab to Tags, type a tag, Enter to add, Backspace to remove. Everything reachable.
3. **Typing feels snappy** — Rapidly type in the tag input. No visible lag or stuttering.
4. **App still works** — Everything from Phases B and C still works. Refine All streams, Reflection refine works, tags save.
5. **Code is cleaner** — (I'll confirm) `site/index.html` is smaller; components extracted to separate files.

### journal-builder Post-Phase-E Review
> Run this before Phase F. journal-builder audits Phase E (Pre-E0 + E1–E6) and improves itself.

```bash
git log --oneline refine-all-redesign-v2 | head -20
```

journal-builder must:
1. Review every extracted component (`site/components/*.mjs`) — ensure they are properly documented in Known Surfaces.
2. Verify the test harness (Pre-E0) is exercising the right contracts — add any missing test strategy notes.
3. Check whether accessibility or performance improvements in E1–E3 introduced new contracts or behaviors that should be pinned.
4. Record any new observable debt in `_workspace/scratch/observed-debt.md`.
5. Self-update `.github/agents/journal-builder.agent.md`, then:

```bash
git add -f .github/agents/journal-builder.agent.md
git commit -m "chore(journal-builder): post-phase-E review — component contracts + test strategy update"
```

---

## Phase F — Closeout

### Commit F1 — E2E full matrix
Execute against `2026-04-ishrat-engagement` and report:

1. Click Refine All on a trip with all photos approved — reflection and tags populate; hashes persist; refresh shows no `edited` badges.
2. Edit reflection manually; click Refine All — reflection skipped with `edited` badge; tags refresh.
3. Click Re-synth in reflection badge — confirms; overwrites; hash updates.
4. Click the small ✨ refine icon with text in the Reflection box — AI enhances the text. Click it with an empty box — AI generates from entries.
5. Add a tag with weird casing — dedups.
6. Add 25 tags — input disables.
7. Add an AI-suggested tag, remove it — re-running Refine All doesn't re-suggest; manually re-add it — disappears from `rejectedAiTags[]`.
8. Compose DayOne bundle — markdown includes `## Reflection` paragraph + `#Tag1 #Tag2 ...`; reflection `#hashtags` are escaped.
9. Force `synthesize-trip-narrative` failure — all-or-nothing kicks in, no patches written, retry works.
10. Restart server — tag corpus rebuilds; top-50 returns expected tags; fingerprint hot-reload works post-restart.
11. Open Trip Log in two tabs, edit tags in both — 409 auto-reload preserves both edits.
12. Flip `REFINE_ALL_ENABLED=false` + restart — Refine All hidden; ✨ quick refine still works.
13. Throttle network to Slow 3G in DevTools — streaming still works; SSE doesn't time out within 60s.

### Commit F2 — framework.md + handoff close
- `framework.md` appendix updated: DoR table, commit map, rollback procedure, D14 policies.
- Report back: summary of commits landed, gates passed, any deviations or surprises logged in `_workspace/scratch/observed-debt.md`.
- PR body template at `_workspace/pr-bodies/refine-all-redesign-v2.md` with acceptance criteria and test evidence.

```bash
git add -A && git commit -m "refine-all(F2): E2E verified, framework.md updated, PR ready"
```

---

## Phase G — Publish Gate & Production URLs

> Goal: merging to `main` deploys `site/` to Cloudflare automatically, and every API call works in both `localhost` dev and `journal.kashkole.com` production without config changes.

### Commit G1 — Fix hardcoded localhost in Budget Pill

**Problem:** `fetchSummary()` in `site/index.html` (Phase 8: Budget Pill) uses hardcoded `http://localhost:3001/api/usage/summary` — broken in production.

**Fix:** Replace the four hardcoded `http://localhost:3001` references in `fetchSummary()` with `BabuAI.baseUrl` (already loaded by `claude-client.js` before the React block). The `LOG_API_BASE` already does this correctly; `fetchSummary` is the straggler.

```
Gate: curl production URL after deploy → Budget Pill loads.
```

```bash
git add site/index.html && git commit -m "fix: fetchSummary uses BabuAI.baseUrl instead of hardcoded localhost"
```

### Commit G2 — Add Cloudflare deploy step to release workflow

**Problem:** `.github/workflows/release.yml` only runs `release-please` on push to main. No deploy happens.

**Fix:** Add a `deploy` job after `release-please` that runs `npx wrangler deploy` using the existing `wrangler.toml`. Requires a `CLOUDFLARE_API_TOKEN` repo secret (already configured or will be added once).

```yaml
# .github/workflows/release.yml — append this job
deploy:
  name: Deploy to Cloudflare
  needs: release-please
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Deploy site
      uses: cloudflare/wrangler-action@v3
      with:
        apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

```
Gate: push to main → Actions tab shows green deploy → journal.kashkole.com serves updated site.
```

```bash
git add .github/workflows/release.yml && git commit -m "ci: add Cloudflare deploy on merge to main"
```

### Commit G3 — Audit all fetch calls for relative/API-base correctness

Quick grep-and-verify pass. Every `fetch()` in `site/` must use one of:
- Relative path (e.g. `fetch('/data/...')`) — for static assets served by Cloudflare
- `BabuAI.baseUrl + path` or `BabuAI.request(path)` — for server API calls
- `LOG_API_BASE + path` — acceptable (it delegates to `BabuAI.baseUrl`)

No raw `http://localhost` should remain anywhere in `site/`.

```
Gate: grep -r "localhost:3001" site/ returns zero results.
```

```bash
git add -A && git commit -m "fix: eliminate remaining hardcoded localhost in site/"
```

### 🛑 Phase G STOP — User Verification Required

**Where:** Open `journal.kashkole.com` in your browser (production).

1. **Site loads** — The page appears, no blank screen, no console errors about failed fetches.
2. **Budget Pill works** — Top-right shows your API spend (or a "server offline" warning if your Mac is asleep — that's expected).
3. **Trip Log loads** — Click Log, entries appear if server is running.
4. **Composer works** — Open a trip, Refine All button visible, tags section visible.
5. **GitHub Actions** — Check the Actions tab on the repo. The deploy job should be green.
6. **Dev still works** — Open `localhost:5173` (or however you serve locally). Everything works as before.

---

## Acceptance Criteria (Definition of Done)

1. All commits (A1–A10, B1–B2, B+1–B+2, C1–C3, Pre-E0, E1–E6, F1–F2, G1–G3) land on `refine-all-redesign-v2`.
2. Every gate in every commit passes.
3. Every user-verification STOP is explicitly confirmed.
4. `2026-04-ishrat-engagement` can be Refine-All'd end-to-end without manual intervention.
5. No regression in: per-photo Refine, DayOne bundle generation for legacy trips, trip-edit assistant chat flow, voice fingerprint hot-reload, any existing Composer field behavior.
6. Full WCAG 2.2 AA on redesigned surfaces.
7. `framework.md` reflects the new flow and all 14 DoR decisions.
8. Merging to `main` triggers Cloudflare deploy; production site works with no hardcoded localhost URLs.

### Commit Map (actual)

| Commit | Description | Status |
|--------|-------------|--------|
| A1–A10 | Server foundations | ✅ Done |
| B1–B2 | TagInput component + Composer integration | ✅ Done |
| B+1 | Replace Highlights with Reflection textarea + fix TagInput Enter | ✅ Done |
| B+2 | AI-powered Reflection refine via voice DNA fingerprint | ✅ Done |
| C1–C3 | Refine All button + SSE streaming + Re-synth | ✅ Done |
| D1 | ~~Highlights chip redesign~~ | ❌ Retired |
| Pre-E0 | Test harness bootstrap (journal-builder gate) | ⬜ Next |
| E1–E6 | Holistic refactor & cleanup | ⬜ Pending |
| F1–F2 | E2E matrix + closeout | ⬜ Pending |
| G1–G3 | Publish gate + Cloudflare deploy + localhost audit | ⬜ Pending |

---

## Out-of-Scope (explicitly NOT in this phase)

- Vision re-pass on Refine All — captions-only is locked (D6).
- Per-orchestrator partial commit — all-or-nothing of the requested field set is locked (D10).
- SQLite migration for hashes — trip.yaml is the persistence layer, atomic by file write.
- Tag categorization / hierarchy (DayOne supports `parent/child`) — flat tags only.
- Memoir export wiring — `reflection`/`tags` are DayOne-only this phase.
- Theme/CSS rewrites — chips reuse existing token system.
- Full-site accessibility / performance audit — Phase E is bounded to Refine All surface and immediate adjacency.
- Converting `site/index.html` wholesale to a module bundler (Vite/esbuild) — native ESM extraction in E5 is the scope.
- Per-chip Re-synth on highlights — retired (highlights replaced by Reflection).

If any of these become necessary mid-implementation, **stop and request scope expansion**. Do not quietly expand.

---

## Regression Delta (v1 → v2) — what we fixed

| v1 issue | Severity | v2 resolution |
|---|---|---|
| Positional `highlightsHashes[]` silently breaks under reorder/delete | P0 | Retired — Highlights replaced by Reflection (single string, single hash) |
| Re-synth field-filter contradicts D10 all-or-nothing | P0 | D10 revised; A8 separate endpoint; C3 Re-synth calls it |
| `Promise.all` can't return per-field errors object | P0 | A6 uses `Promise.allSettled` |
| New `voice-fingerprint.js` kills 5s hot-reload from `refine.js` | P0 | D7 revised; A3 preserves TTL + consolidates both call sites |
| `/api/trip-edit patches[]` has no concurrency guard | P0 | D11 new; A6 baseVersion + 409; B2 and C2 handle reload-and-retry |
| `rejectedAiTags[]` grows unbounded | P1 | D14 new; cap 50 + auto re-accept on manual add |
| `normalizeTag` inline duplicate drifts | P1 | D5 revised; A1 shared module via static mount |
| Fingerprint "light mode" undefined | P1 | A3 authors `voice-fingerprint-light.md` explicitly |
| Narrative `#hashtag` pollutes DayOne tags | P2 | A9 escape to full-width hash |
| No kill switch for a button-replacement | P2 | D13 new; A10 + B/C/D flag-off paths |
| No idempotency / no cost telemetry / no streaming / no reasoning | Capability | D12 new; A6 idempotency + A7 SSE + A5 reasoning + E4 telemetry |
| Empty-approved-photos edge undefined | P2 | C1 disables Refine All when zero approved; tooltip explains |

---

## Rollback

```bash
git reset --hard checkpoint/pre-refine-all-v2-2026-04-19
git branch -D refine-all-redesign-v2
```

The checkpoint tag is placed immediately before branch creation; it is the last known-good main state.
