import { create } from "zustand";
import { persist } from "zustand/middleware";

// Reading typography preferences, persisted. Applied to the reader via CSS
// variables (--reader-font/-size/-lh) that .reader-prose consumes.

export type FontKey = "serif" | "lato" | "inter" | "georgia" | "dyslexic";
export type WidthKey = "narrow" | "medium" | "wide";

export const FONT_STACKS: Record<FontKey, string> = {
  serif: "var(--font-serif, Georgia, serif)",
  lato: "'Lato', 'Inter', sans-serif",
  inter: "'Inter', 'Lato', sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  dyslexic: "'OpenDyslexic', 'Comic Sans MS', sans-serif",
};

export const FONT_LABELS: Record<FontKey, string> = {
  serif: "Serif",
  lato: "Lato",
  inter: "Inter",
  georgia: "Georgia",
  dyslexic: "Dyslexic",
};

export const WIDTH_MAXW: Record<WidthKey, string> = {
  narrow: "38rem",
  medium: "46rem",
  wide: "56rem",
};

interface ReaderPrefs {
  font: FontKey;
  scale: number; // 0.85 – 1.4
  lineHeight: number; // 1.5 – 2.2
  width: WidthKey;
  setFont: (f: FontKey) => void;
  setScale: (n: number) => void;
  setLineHeight: (n: number) => void;
  setWidth: (w: WidthKey) => void;
}

export const useReaderPrefs = create<ReaderPrefs>()(
  persist(
    (set) => ({
      font: "dyslexic",
      scale: 1, // Asif's preferred baseline (100% of the 1.25rem base)
      lineHeight: 1.8,
      width: "medium",
      setFont: (font) => set({ font }),
      setScale: (scale) => set({ scale: Math.min(1.4, Math.max(0.85, scale)) }),
      setLineHeight: (lineHeight) => set({ lineHeight: Math.min(2.2, Math.max(1.5, lineHeight)) }),
      setWidth: (width) => set({ width }),
    }),
    // Bump version to roll out new defaults (Dyslexic, larger size) over any
    // previously-persisted choice. The migrate keeps line-spacing/width but
    // forces the new font + a readable minimum size (and avoids the
    // "no migrate function" console error).
    {
      name: "journal:reader-prefs",
      version: 1,
      migrate: (persisted) => {
        const s = (persisted && typeof persisted === "object" ? persisted : {}) as Partial<ReaderPrefs>;
        return {
          ...s,
          font: "dyslexic",
          scale: typeof s.scale === "number" ? s.scale : 1,
        } as ReaderPrefs;
      },
    },
  ),
);

/** Inline CSS-variable style object for the reader column. */
export function readerStyle(p: Pick<ReaderPrefs, "font" | "scale" | "lineHeight">) {
  return {
    "--reader-font": FONT_STACKS[p.font],
    // Larger base for readability; the Aa toolbar scales this 0.85–1.4×.
    "--reader-size": `${1.25 * p.scale}rem`,
    "--reader-lh": String(p.lineHeight),
  } as React.CSSProperties;
}
