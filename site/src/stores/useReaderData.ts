import { create } from "zustand";
import { persist } from "zustand/middleware";

// Per-chapter reader data: bookmarks (paragraph indices), typed notes, and the
// last-read paragraph for resume. Persisted to localStorage.

export type NoteType = "edit" | "reflection" | "research" | "continuity" | "voice";

export const NOTE_META: Record<NoteType, { label: string; token: string }> = {
  edit: { label: "Edit", token: "var(--note-edit-color, var(--accent))" },
  reflection: { label: "Reflection", token: "var(--note-reflection-color, var(--gold, #f4d49c))" },
  research: { label: "Research", token: "var(--note-research-color, #34d399)" },
  continuity: { label: "Continuity", token: "var(--note-continuity-color, var(--rose, #ffb0cc))" },
  voice: { label: "Voice", token: "var(--note-voice-color, #93c5fd)" },
};

export interface Note {
  id: string;
  type: NoteType;
  text: string;
  paraIdx: number;
  preview: string;
  createdAt: string;
}

interface ReaderData {
  bookmarks: Record<string, number[]>; // chapterId -> paragraph indices
  notes: Record<string, Note[]>; // chapterId -> notes
  lastRead: Record<string, number>; // chapterId -> paragraph index
  toggleBookmark: (chapterId: string, para: number) => void;
  addNote: (chapterId: string, note: Omit<Note, "id" | "createdAt">) => void;
  removeNote: (chapterId: string, id: string) => void;
  setLastRead: (chapterId: string, para: number) => void;
}

// Deterministic-ish id without Math.random dependence in hot paths.
let seq = 0;
function nextId() {
  seq += 1;
  return `n${seq}-${seq.toString(36)}`;
}

export const useReaderData = create<ReaderData>()(
  persist(
    (set) => ({
      bookmarks: {},
      notes: {},
      lastRead: {},
      toggleBookmark: (chapterId, para) =>
        set((s) => {
          const cur = s.bookmarks[chapterId] ?? [];
          const next = cur.includes(para)
            ? cur.filter((p) => p !== para)
            : [...cur, para].sort((a, b) => a - b);
          return { bookmarks: { ...s.bookmarks, [chapterId]: next } };
        }),
      addNote: (chapterId, note) =>
        set((s) => {
          const full: Note = { ...note, id: nextId(), createdAt: new Date().toISOString() };
          return { notes: { ...s.notes, [chapterId]: [...(s.notes[chapterId] ?? []), full] } };
        }),
      removeNote: (chapterId, id) =>
        set((s) => ({
          notes: { ...s.notes, [chapterId]: (s.notes[chapterId] ?? []).filter((n) => n.id !== id) },
        })),
      setLastRead: (chapterId, para) =>
        set((s) => ({ lastRead: { ...s.lastRead, [chapterId]: para } })),
    }),
    { name: "journal:reader-data" },
  ),
);
