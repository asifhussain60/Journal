# Journal Workflow v2 — File-First Model
# AUTHORITATIVE: This file completely replaces SKILL.md Sections 1-10.
# When SKILL.md conflicts with this file, THIS FILE WINS.
# Last updated: April 11, 2026

============================================================
SECTION 1: SESSION START PROTOCOL
============================================================

Before doing ANY work, read these files in this order:

1. JOURNAL_DIR/reference/memoir-rules-supplement.txt
2. JOURNAL_DIR/reference/master-context.md — synthesized cross-chapter
   intelligence (replaces reading all chapters individually)
3. JOURNAL_DIR/reference/voice-deep-analysis.md
4. SKILL_DIR/references/voice-fingerprint.md
5. SKILL_DIR/references/craft-techniques.md
6. SKILL_DIR/references/thematic-arc.md
7. SKILL_DIR/references/biographical-context.md + supplement Bio Context
8. JOURNAL_DIR/reference/locked-paragraphs.md
9. JOURNAL_DIR/reference/quotes-library.txt
10. JOURNAL_DIR/reference/incident-bank.md

Then run delta detection:
  python <SKILL_DIR>/scripts/auto_delta.py <JOURNAL_DIR>/chapters

Read the full delta report before touching any file.

============================================================
SECTION 2: FOLDER STRUCTURE
============================================================

JOURNAL_DIR/
  chapters/              Final chapter files only
    ch00-intro.txt
    ch01-man.txt
    ch02-love.txt
    ch03-marriage.txt
    snapshots/           Delta snapshots
  reference/             All reference documents
    master-context.md    Synthesized cross-chapter intelligence
    journal-workflow-v2.md  THIS FILE (authoritative workflow)
    memoir-rules-supplement.txt
    voice-deep-analysis.md
    locked-paragraphs.md
    quotes-library.txt
    incident-bank.md
    temporal-guardrail.md
  scratchpad/            Working files (one per chapter)
    scratch-love.txt     Active working file

Rules:
  - One active scratchpad per chapter at a time.
  - Naming: scratch-{chapter-name}.txt
  - No version files — git handles all history.
  - After finalization, scratchpad file is deleted.
  - scratchpad/ folder stays clean between sessions.

============================================================
SECTION 3: CHAPTER WORKFLOW — FILE-FIRST MODEL
============================================================

ALL work happens directly in the scratchpad file. Asif reads the file
in his file system. Chat is ONLY for receiving feedback by section
number and confirming changes. NEVER present chapter text in chat.

### PHASE 1: ASSEMBLY & DRAFT

When Asif says "/journal work on chapter N" with optional brief
direction (1-2 sentences), the skill:

  1. Runs the full Session Start Protocol (Section 1 above)
  2. Reads the existing chapter file (if any) from chapters/
  3. Pulls ALL incidents tagged for this chapter from incident-bank.md
  4. Reads master-context.md for cross-chapter context, character
     tracker, threads, and callback candidates
  5. Scans master-context.md for themes relevant to this chapter that
     could be mined for new incident bank entries. If found, suggest
     to Asif before drafting.
  6. Checks quotes-library.txt for unused quotes fitting this chapter
  7. Writes the FULL chapter into scratchpad/scratch-{name}.txt:
     - Holistic write following the arc: experience → ownership → wisdom
     - Three-phase balance: Experiences ~50-60%, Learnings ~20-30%,
       Dad's Advice ~15-20%
     - ALL of Asif's existing sentences kept intact
     - Language refined: tighter phrasing, stronger words, better
       articulation
     - Transitions improved using documented bridge patterns
     - Humor added where natural using 6 documented patterns
     - Emotional pacing strengthened
     - Every scene tested: does it TURN something?
     - Sections divided by narrative beats:
       === SECTION N: Title ===
  8. Git-commits the scratchpad: "scratch-{name}: initial draft"
  9. OPENS BOTH FILES for Asif to review:
     - Present scratchpad file: scratchpad/scratch-{name}.txt
     - Present chapter file: chapters/ch{NN}-{name}.txt (if exists)
     Use computer:// links so Asif can click to open them directly.
  10. Reports in chat: section count, readiness score, any incident
      suggestions. NEVER dumps text into chat.

For NEW chapters (no existing file): assemble from incident bank,
biographical context, thematic arc, and Asif's brief direction.
If ambiguous, ask ONE qualifying question before drafting.

### PHASE 2: INTERACTIVE REVIEW

Asif reads the scratchpad file directly and gives feedback in chat
by section number:
  - "Section 3, add the skipping meds detail"
  - "Section 5 is good"
  - "Add [new incident] to section 2"
  - "Move section 4 before section 3"
  - "Section 7 needs more humor"

After EVERY edit:
  1. Apply the change directly in the scratchpad file
  2. Run the Challenger on the modified section
  3. Git-commit with descriptive message
  4. OPEN the updated scratchpad file for Asif using computer:// link
  5. Report in chat: what changed + any Challenger flags
  6. Do NOT dump section text into chat — Asif reads the file

When Asif provides new content:
  - His words are DELTA-PROTECTED (content-locked)
  - Allowed: grammar, emotional language, articulation/flow, relocation
  - NOT allowed: rewriting, changing facts, adding/removing sentences,
    changing structure, merging splits
  - REQUIRED: enhance with emotion aligned to voice DNA and chapter arc

Section numbering stays stable. New sections get sub-numbers (3a).

### PHASE 2a: QUALIFYING QUESTIONS

When Asif shares a new incident needing context, ask ONE smart
question rather than a survey. If clear enough, skip and draft.
After context gathered, insert into file and add to incident-bank.md.

### PHASE 3: FULL-CHAPTER CHALLENGER GATE

Once ALL sections reviewed and approved:

  1. SEAM CHECK: Read full scratchpad end-to-end. Check bridges
     between every section pair. Fix seams in file.
  2. Run FULL CHALLENGER (Section 4 below) across entire chapter.
     Iterative — up to 5 passes — fixing issues in file each time.
  3. Report findings in chat ONLY (no report files).
  4. Approval gate opens ONLY when Challenger issues APPROVED.

### PHASE 4: FINALIZATION

When Challenger approves:
  1. Strip section headers from scratchpad
  2. Write clean content to chapters/ch{NN}-{name}.txt
  3. OPEN the finalized chapter file for Asif using computer:// link:
     chapters/ch{NN}-{name}.txt
  4. Lock new/modified paragraphs in locked-paragraphs.md
  4. Update quotes-library.txt usage markers
  5. Update incident-bank.md placement status
  6. Update temporal-guardrail.md if timeline affected
  7. Update master-context.md with new chapter synthesis
  8. Run full compliance scan
  9. Snapshot: python <SKILL_DIR>/scripts/auto_delta.py
     <JOURNAL_DIR>/chapters --save
  10. Git-commit final: "ch{NN}-{name}: finalized"
  11. Delete scratchpad file (history in git)
  12. Update voice-deep-analysis.md with new patterns

============================================================
SECTION 4: THE CHALLENGER — ENFORCEMENT ENGINE
============================================================

Runs at TWO levels:
  1. SECTION-LEVEL: After every edit during Phase 2
  2. FULL-CHAPTER: Before finalization (Phase 3), iterative up to 5 passes

Severity:
  CRITICAL — must fix, no override
  MAJOR — should fix, Asif can explicitly override
  ADVISORY — flagged, non-blocking

### LOOP 1 — VOICE INTEGRITY
  C1. Every sentence sounds like Asif? Test against voice-deep-analysis.md.
      Flag AI-sounding sentences. [CRITICAL]
  C2. Humor: only 6 documented patterns. No sitcom, no comedy. [MAJOR]
  C3. Emotional register: pain flat, interiority through questions, anger
      behind a wall, tenderness through specificity. [CRITICAL]
  C4. Banned word scan (AUTOMATED): trauma, toxic, narcissist, boundaries,
      triggered, journey (non-geographic), growth, healing, incredibly,
      absolutely, literally, em dashes, semicolons. [CRITICAL]
  C5. Contractions: formal when serious, casual when relaxed. [ADVISORY]
  C6. Sentence openers: flag 3+ consecutive "I" openers. [MAJOR]
  C7. Paragraph length: 2-5 sentences. Flag longer unless user delta. [MAJOR]
  C8. Voice calibration: test 3 random sentences against calibration lines
      in voice-fingerprint.md. Revise if they don't belong. [CRITICAL]

### LOOP 2 — NARRATIVE ARCHITECTURE
  C9. Emotional arc: damage → search → discovery → wisdom. All four phases
      present. Flag missing/underweight. [CRITICAL]
  C10. Scene earns its place: turns something, or flag for removal. [MAJOR]
  C11. Three-phase balance: ~50-60% / ~20-30% / ~15-20%. [MAJOR]
  C12. Phase transitions: organic, not mechanical. [ADVISORY]
  C13. Narrative Constant: no victim framing, no accusation. [CRITICAL]
  C14. Dad's Advice: advises younger self, not lectures about parents.
       Only references events/people from same chapter's narrative. [CRITICAL]

### LOOP 3 — CRAFT & PACING
  C15. Emotional moments slow, transitions fast. [MAJOR]
  C16. Bridge pattern variety: no two consecutive same-type. [MAJOR]
  C17. Reader fatigue: flag 3+ consecutive high-intensity sections without
       breathing moment. [MAJOR]
  C18. Insight from memory/contradiction, not stated directly. [CRITICAL]
  C19. No em dashes. No markdown. No semicolons. [CRITICAL]
  C20. No therapy jargon, self-help, corporate, academic, literary
       affectation, melodrama. [CRITICAL]

### LOOP 4 — GOVERNANCE COMPLIANCE
  C21. Ali (AS) everywhere. Full honorific on first use per chapter. [CRITICAL]
  C22. Temporal guardrail: no forward references. [CRITICAL]
  C23. Atif: max 2 mentions per chapter (Ch01 exempt). [MAJOR]
  C24. Translation rule: single words never translated. Multi-word get
       parenthetical gloss. ABD = "slave" exception. [MAJOR]
  C25. Sacred quotes: max 1-2 sentences, no expansion, no lecture. [MAJOR]
  C26. Quote once-only: AUTOMATED check against quotes-library.txt. [CRITICAL]
  C27. Locked paragraphs: character-for-character. [CRITICAL]
  C28. Delta protection: only grammar/emotion/articulation/relocation. [CRITICAL]

### LOOP 5 — DUPLICATION & REPETITION ENFORCEMENT
  C29. WITHIN-CHAPTER sentence duplication: flag any sentence or construction
       appearing twice, even with minor word changes. Identical meaning +
       identical structure = duplication. [CRITICAL]
  C30. CROSS-CHAPTER duplication: via master-context.md, flag any sentence,
       phrase, or construction duplicated from another chapter. [CRITICAL]
  C31. Incident re-telling: one primary chapter tells in full. Others may
       REFERENCE briefly (1-2 sentences max) but NEVER re-tell. [CRITICAL]
  C32. Thematic echo style: if a theme/image recurs across chapters, the
       style, register, or angle MUST be completely different. Flag same
       phrasing, structure, or approach. [CRITICAL]
  C33. Dad's Advice originality: flag verbatim narrative phrasing in Dad's
       section. Must offer different lens/elevation. [MAJOR]
  C34. Repetition balance: intentional craft (triads, callbacks, parallel
       structure) is allowed. Accidental/clumsy repetition flagged. If Asif
       restored something removed, his choice stands. [MAJOR]

### LOOP 6 — REFLECTION & QUOTE INTEGRITY
  C35. Reflections: first person ("I") only. Split between realization
       bridges and Dad's Advice setup bridges. [CRITICAL]
  C36. Reflections modifiable into voice DNA. Quotes A/B immutable. [CRITICAL]
  C37. Sacred quotes exact. Invisible quotes paraphrased, meaning intact. [CRITICAL]

### LOOP 7 — CROSS-CHAPTER CONTINUITY
  C38. Character consistency: master-context.md tracker. No new characters
       in Dad's Advice not in narrative. Atif count enforced. [MAJOR]
  C39. Incident bank reconciliation: every tagged incident placed or
       explicitly deferred. Flag orphans. [MAJOR]
  C40. Thread depth: recurring themes must deepen, not repeat. [MAJOR]

### LOOP 8 — VOICE EXTRACTION
  C41. Extract new voice patterns from this session's work. [ADVISORY]
  C42. Update voice-deep-analysis.md. [ADVISORY]
  C43. Update master-context.md key phrases if new callbacks created. [ADVISORY]

### READINESS SCORE (reported after Phase 1)
Score 0-100 based on:
  - Incident coverage (tagged incidents placed?)
  - Quote placement (woven, not dropped?)
  - Voice match (sample sentences pass calibration?)
  - Arc completeness (all 4 phases present and weighted?)
  - Bridge variety (no consecutive same-type?)
  - Duplication clean (no cross-chapter duplicates?)
  - Reader fatigue (breathing moments present?)

============================================================
SECTION 5: GIT VERSIONING
============================================================

All scratchpad history tracked via git commits:
  - Phase 1 draft: "scratch-{name}: initial draft"
  - Each edit: "scratch-{name}: Section N refined per feedback"
  - Challenger fixes: "scratch-{name}: Challenger pass {N}"
  - Finalization: "ch{NN}-{name}: finalized"

Commands:
  - History: git log --oneline scratchpad/scratch-{name}.txt
  - Diff: git diff HEAD~1 scratchpad/scratch-{name}.txt
  - Rollback: git checkout HEAD~1 -- scratchpad/scratch-{name}.txt

No file copies. Git is sole version control.

============================================================
SECTION 6: OUTPUT RULES
============================================================

- Chapter text: plain text for Day One. No markdown.
- No em dashes, no semicolons.
- Commas after introductory adverbial phrases.
- Scratchpad: === SECTION N: Title === headers (stripped on finalization).
- NEVER dump chapter text into chat.
- ALWAYS present file links after ANY update to scratchpad or chapter:
  [View scratchpad](computer:///sessions/.../mnt/journal/scratchpad/scratch-{name}.txt)
  [View chapter](computer:///sessions/.../mnt/journal/chapters/ch{NN}-{name}.txt)
  This is how Asif reads the work — he clicks the link and opens the
  file directly. Without these links, he cannot see what changed.
- Chat is for: section counts, readiness scores, Challenger findings,
  confirming changes, receiving feedback by section number.

============================================================
SECTION 7: CLEANUP PROTOCOL
============================================================

After finalization:
  - Scratchpad file: deleted (history in git)
  - master-context.md: updated with new chapter synthesis
  - voice-deep-analysis.md: updated with new patterns
  - incident-bank.md: all placements updated
  - quotes-library.txt: all usage markers updated
  - locked-paragraphs.md: new paragraphs locked
  - temporal-guardrail.md: timeline updated if needed
  - No orphan files. No report files. Folder stays clean.

============================================================
SECTION 8: REFERENCE FILE INDEX
============================================================

Skill Directory (SKILL_DIR/references/) — READ-ONLY:
  voice-fingerprint.md, craft-techniques.md, thematic-arc.md,
  biographical-context.md, chapter-status.md, quotes-workflow.md,
  translations-glossary.md

Journal Directory (JOURNAL_DIR/reference/) — WRITABLE:
  master-context.md, journal-workflow-v2.md, memoir-rules-supplement.txt,
  voice-deep-analysis.md, locked-paragraphs.md, quotes-library.txt,
  incident-bank.md, temporal-guardrail.md

Scratchpad (JOURNAL_DIR/scratchpad/):
  scratch-{chapter-name}.txt — active working file (temporary)

Scripts (SKILL_DIR/scripts/):
  auto_delta.py, detect_user_delta.py, save_snapshot.py,
  refresh_all_snapshots.py
