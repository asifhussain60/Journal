import { create } from "zustand";

// Reference-library entries Asif has selected while writing, to ground the
// next AI operation (folded into the Operations panel's hint string). Session
// -only by design — never persisted, matches the ephemeral interview answers.

export interface LibraryContextEntry {
  id: string;
  kind: string;
  label: string;
  text: string;
}

interface LibraryContextState {
  entries: LibraryContextEntry[];
  add: (entry: LibraryContextEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useLibraryContext = create<LibraryContextState>()((set) => ({
  entries: [],
  add: (entry) =>
    set((s) => (s.entries.some((e) => e.id === entry.id) ? s : { entries: [...s.entries, entry] })),
  remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  clear: () => set({ entries: [] }),
}));
