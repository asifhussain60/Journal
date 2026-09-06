import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { THEMES, useThemeStore, type Theme } from "../stores/useThemeStore";

function SwatchRow({ swatches, size = 14 }: { swatches: Theme["swatches"]; size?: number }) {
  return (
    <span className="inline-flex gap-1">
      {swatches.map((c, i) => (
        <span
          key={i}
          className="rounded-full ring-1 ring-black/10"
          style={{ background: c, width: size, height: size }}
        />
      ))}
    </span>
  );
}

/**
 * React port of the legacy js/theme-switcher.js dropdown, backed by
 * useThemeStore. Grouped by category (Dark / Light) with live swatches.
 */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const activeId = useThemeStore((s) => s.id);
  const setTheme = useThemeStore((s) => s.setTheme);
  const active = THEMES.find((t) => t.id === activeId) ?? THEMES[0];

  const groups: Record<Theme["category"], Theme[]> = { Dark: [], Light: [] };
  for (const t of THEMES) groups[t.category].push(t);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          className="inline-flex items-center gap-2 rounded-pill border border-line bg-bg-card px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text focus-visible:outline-none"
          aria-label="Change theme"
        >
          <SwatchRow swatches={active.swatches} size={11} />
          <span className="hidden sm:inline">{active.name}</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-lg border border-line bg-bg-2 p-2 shadow-xl"
        >
          {(Object.keys(groups) as Theme["category"][]).map((cat) => (
            <DropdownMenu.Group key={cat}>
              <DropdownMenu.Label className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {cat}
              </DropdownMenu.Label>
              {groups[cat].map((t) => (
                <DropdownMenu.Item
                  key={t.id}
                  onSelect={() => setTheme(t.id)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-bg-card-hover"
                >
                  <SwatchRow swatches={t.swatches} />
                  <span className="flex flex-col">
                    <span className="font-medium text-text">{t.name}</span>
                    <span className="text-xs text-text-muted">{t.description}</span>
                  </span>
                  {t.id === active.id && <span className="ml-auto text-accent">✓</span>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
