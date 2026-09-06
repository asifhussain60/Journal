import { create } from "zustand";
import { persist } from "zustand/middleware";

// Theme registry — ported verbatim from the legacy site/js/theme-switcher.js.
// Files are served statically from /public/themes/*.css. Adding a theme = drop a
// theme-<id>.css into public/themes and add an entry here.
export type ThemeCategory = "Dark" | "Light";

export interface Theme {
  id: string;
  file: string;
  name: string;
  description: string;
  category: ThemeCategory;
  swatches: [string, string, string, string];
}

export const THEMES: Theme[] = [
  { id: "rose-mauve-night", file: "theme.css", name: "Rose & Mauve Night", description: "Deep plum · lavender · rose", category: "Dark", swatches: ["#2b2240", "#c6a6ff", "#ffb0cc", "#f4d49c"] },
  { id: "slick-obsidian", file: "theme-slick-obsidian.css", name: "Slick Obsidian", description: "Slate · sea-emerald · amber · Playfair", category: "Dark", swatches: ["#14171C", "#6DBFA0", "#D4A361", "#D98A7C"] },
  { id: "tales-dark-green", file: "theme-tales-dark.css", name: "Tales Dark Green", description: "WrapBootstrap Tales · charcoal + green", category: "Dark", swatches: ["#262626", "#3ab159", "#61c57b", "#e3c567"] },
  { id: "tales-scarlet", file: "theme-tales-scarlet.css", name: "Tales Scarlet", description: "Oxblood · ember · warm gold", category: "Dark", swatches: ["#2A1A1A", "#C94B4B", "#E3B45B", "#B87A7A"] },
  { id: "boomerang-dusk", file: "theme-boomerang-dusk.css", name: "Boomerang Dusk", description: "Navy · dusky teal · apricot", category: "Dark", swatches: ["#1A2239", "#4E96B5", "#E3A062", "#C88597"] },
  { id: "daylight", file: "theme-daylight.css", name: "Daylight", description: "Warm paper · amber · rose", category: "Light", swatches: ["#F8F5EF", "#B46432", "#C46A7A", "#C89B5E"] },
  { id: "summarize-ivory", file: "theme-summarize-ivory.css", name: "Summarize Ivory", description: "Ivory paper · forest sage · Lora serif", category: "Light", swatches: ["#FDFBF4", "#4A7856", "#C5923B", "#B85450"] },
  { id: "paperclip-linen", file: "theme-paperclip-linen.css", name: "Paperclip Linen", description: "Linen · terracotta · stone violet", category: "Light", swatches: ["#FAFAF6", "#A84D32", "#C0985F", "#7A7394"] },
  { id: "unify-monograph", file: "theme-unify-monograph.css", name: "Unify Monograph", description: "Near-white · cobalt · brass · Inter+Lora", category: "Light", swatches: ["#FBFBF9", "#2D5FA8", "#B5894E", "#B2716C"] },
];

const DEFAULT_THEME = THEMES.find((t) => t.file === "theme-tales-dark.css") ?? THEMES[0];
const LINK_ID = "theme-stylesheet";

function applyThemeLink(file: string) {
  const link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (link) link.href = `/themes/${file}`;
  document.documentElement.setAttribute("data-active-theme", themeByFile(file).id);
}

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}
export function themeByFile(file: string): Theme {
  return THEMES.find((t) => t.file === file) ?? DEFAULT_THEME;
}

interface ThemeState {
  id: string;
  file: string;
  setTheme: (id: string) => void;
  hydrateLink: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      id: DEFAULT_THEME.id,
      file: DEFAULT_THEME.file,
      setTheme: (id: string) => {
        const theme = themeById(id);
        applyThemeLink(theme.file);
        set({ id: theme.id, file: theme.file });
      },
      // Called once on mount to reconcile the <link> with persisted state
      // (the inline boot script in index.html already applied it pre-hydration).
      hydrateLink: () => applyThemeLink(get().file),
    }),
    {
      name: "journal:theme",
      // Persist only id + file; the boot script reads state.file.
      partialize: (s) => ({ id: s.id, file: s.file }) as ThemeState,
    },
  ),
);
