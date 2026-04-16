---
name: voice-to-prose
description: "Voice-capture synthesis orchestrator for Asif's journal. Invoke when the user says 'voice-to-prose', '/voice-to-prose', '@voice-to-prose', 'synthesize voice notes', 'turn my voice notes into prose', 'process voice inbox', 'voice inbox', 'refine voice captures', or 'draft memoir from voice'. Reads `trips/{slug}/voice-inbox.json` (single JSON array), classifies each entry (memory-worthy, throwaway, memoir-seed), applies voice DNA from `reference/voice-fingerprint.md` + `trips/{slug}/voice-guide.md`, and produces preview prose for user approval before any memoir write. Preview-only by default."
---

# voice-to-prose — Voice Inbox Synthesis Orchestrator

Phase 7 router that turns voice captures into prose candidates while preserving Asif's voice DNA. Preview-only; never writes to memoir or trip logs directly.

## When to invoke

- After a batch of voice captures lands in `voice-inbox.json`
- Before `catch-up` synthesis, when user wants voice entries cleaned up first
- User says "refine voice" / "synthesize voice" / "draft from voice"

## Inputs

| Source | Path | Purpose |
|---|---|---|
| Voice queue | `trips/{slug}/voice-inbox.json` | **Single JSON array** of voice rows (schema: `pending.schema.json`, `kind: "voice"`). Not JSONL, not per-file. |
| Voice fingerprint | `reference/voice-fingerprint.md` | Canonical voice DNA across all memoir output |
| Trip voice guide | `trips/{slug}/voice-guide.md` (if present) | Trip-register calibration (casual Asif vs memoir Asif) |
| Voice deep analysis | `reference/voice-deep-analysis.md` | Humor patterns, negative framing, confessional pivot |

Resolve `{slug}` from `trips/manifest.json` → `activeSlug`, or accept `--slug`.

## Flags

- `--dry-run` *(default)* — produce prose candidates; do not write.
- `--slug <slug>` — override active trip.
- `--entries <ids...>` — operate on specific voice-inbox row ids; default is all `status: "pending"` rows.
- `--classify-only` — emit classification per row, skip prose synthesis.
- `--target trip|memoir` — register. `trip` = casual Asif (per `voice-guide.md`), `memoir` = formal memoir DNA (per `voice-fingerprint.md`). Default `trip`.

## Classification taxonomy

Per voice row, tag exactly one primary class:

- **memoir-seed** — specific moment, emotional texture, usable scene. Worth promoting.
- **memory-worthy** — factual beat or quote worth preserving in a reference container (incidents, quotes, food). Not prose-ready.
- **throwaway** — logistics, reminders, already-captured elsewhere. Drop candidate.
- **needs-more** — fragment that would become memoir-seed with one more sentence of context.

Include confidence (low/med/high) and a one-line reason.

## Output shape

Preview is markdown, one block per classified entry:

```
### voice-row {id} · {createdAt local} · {class} ({confidence})
**Reason:** {one line}
**Raw:** {original transcript, truncated to 200 chars with ellipsis}
**Candidate prose ({target register}):**
{synthesized paragraph applying voice DNA — only for memoir-seed + needs-more}
**Voice-DNA check:**
- Humor pattern used: A|B|C|D|E|F|none
- Em dash? (must be no)
- Travel-blogger phrasing? (must be no)
- Therapy language? (must be no)
**Suggested destination:** memoir chapter {N} | reference/incident-bank.md | reference/quotes-library.txt | drop
```

End with an aggregate summary: `N memoir-seed, M memory-worthy, K throwaway, J needs-more`.

## Composition strategy

Standalone Phase 7 synthesis using the Claude API (Sonnet class) with voice-fingerprint + voice-guide loaded into system prompt. Output is text for user review. No edits to memoir files, no queue mutation. When Phase 8 `journal-drain` lands, `voice-to-prose --apply` becomes the hand-off point.

## Guardrails

- **Never edit chapters/ or reference/ directly.** Output is review text only.
- **Never delete or modify voice-inbox.json rows.** Drain is Phase 8.
- **Voice DNA is non-negotiable.** If a candidate prose line includes an em dash, travel-blogger phrasing, therapy language, or invented detail, mark it as `FAILED-DNA` and do not emit the prose line.
- **No invention.** Only synthesize from what the transcript actually said; fill no gaps.
- Voice-inbox file shape is the Phase 5 contract: single JSON array. If the file is missing, treat as empty and return "no voice rows to synthesize".

## Non-goals

- Not a memoir writer (Phase 1 `journal`).
- Not a drain (Phase 8).
- Not a queue-triage router (see `queue-triage`).
