// Canonical chapter id -> { file, locked }. SYNC POINT: lock state mirrors
// content/babu-memoir/_system/chapter-status.md (ch00-ch02 are immutable).
// Shared by the read route (chapter.ts) and the write route (saveChapter.ts) —
// the Worker never accepts an arbitrary path from the client, only these ids.
export const CHAPTERS: Record<string, { file: string; locked: boolean }> = {
  ch00: { file: "ch00-intro.txt", locked: true },
  ch01: { file: "ch01-man.txt", locked: true },
  ch02: { file: "ch02-love.txt", locked: true },
  ch03: { file: "ch03-marriage.txt", locked: false },
};

export const CHAPTERS_DIR = "content/babu-memoir/chapters";
