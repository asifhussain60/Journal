import generated from "../content/manifest.generated.json";

export type ChapterStatus = "locked" | "active" | "planned";

export interface ChapterSection {
  para: number;
  title: string;
}

export interface Chapter {
  id: string;
  num: string;
  slug: string;
  title: string;
  subtitle: string;
  spine: string;
  readiness: number;
  sections: ChapterSection[];
  /** Runtime fetch path (e.g. "chapters/ch01-man.txt"), or null when planned. */
  file: string | null;
  words: number;
  status: ChapterStatus;
  locked: boolean;
}

export interface Manifest {
  title: string;
  generatedAt: string | null;
  chapters: Chapter[];
}

export const manifest = generated as unknown as Manifest;
export const chapters = manifest.chapters;

export function chapterById(id: string): Chapter | undefined {
  return chapters.find((c) => c.id === id);
}

export function chapterNeighbors(id: string): { prev: Chapter | null; next: Chapter | null } {
  const i = chapters.findIndex((c) => c.id === id);
  return {
    prev: i > 0 ? chapters[i - 1] : null,
    next: i >= 0 && i < chapters.length - 1 ? chapters[i + 1] : null,
  };
}

/** Book-spine theme token accessors — map to --book-<spine>-bg/-border. */
export function spineVars(spine: string): { background: string; borderColor: string } {
  return {
    background: `var(--book-${spine}-bg, var(--book-default-bg))`,
    borderColor: `var(--book-${spine}-border, var(--book-default-border))`,
  };
}
