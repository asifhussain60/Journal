import { useMemo, useState } from "react";
import libraryData from "../../data/library.json";
import type { LibraryContextEntry } from "../../stores/useLibraryContext";

interface ConditionSignBlock {
  [subsection: string]: string[];
}

interface ConditionEntry {
  id: string;
  kind: "condition";
  title: string;
  fields: { signs: ConditionSignBlock };
  raw: string;
}

interface CharacterConditionMap {
  condition: string;
  confidence: string;
  evidence: string[];
  narrative_angle: string;
  note: string;
}

interface CharacterEntry {
  id: string;
  kind: "character";
  title: string;
  fields: { conditions: CharacterConditionMap[] };
  raw: string;
}

interface QuoteEntry {
  id: string;
  kind: "quote" | "reflection";
  title: string;
  fields: {
    source: string;
    original_text: string;
    attribution_style: string;
    theme_tags: string;
    best_fit: string;
    used_in: string;
    notes: string;
  };
  reclassified: boolean;
  raw: string;
}

interface IncidentEntry {
  id: string;
  kind: "incident";
  title: string;
  section: string | null;
  fields: {
    era: string;
    themes: string;
    emotional_arc: string;
    status: string;
    told_in: string;
    refs: string;
    connections: string;
    takeaway: string;
  };
  raw: string;
}

interface LibraryData {
  conditions: ConditionEntry[];
  characters: CharacterEntry[];
  quotes: QuoteEntry[];
  reflections: QuoteEntry[];
  incidents: IncidentEntry[];
}

const DATA = libraryData as unknown as LibraryData;

interface LibraryItem {
  id: string;
  kind: string;
  kindLabel: string;
  label: string;
  preview: string;
  searchText: string;
  groundingText: string;
}

function buildItems(): LibraryItem[] {
  const items: LibraryItem[] = [];

  for (const inc of DATA.incidents) {
    items.push({
      id: inc.id,
      kind: "incident",
      kindLabel: "Incident",
      label: `[${inc.id}] ${inc.title}`,
      preview: inc.fields.takeaway || inc.fields.themes,
      searchText: `${inc.title} ${inc.fields.themes} ${inc.fields.era}`.toLowerCase(),
      groundingText: inc.raw,
    });
  }

  for (const q of [...DATA.quotes, ...DATA.reflections]) {
    const label = q.fields.original_text.slice(0, 70).trim();
    items.push({
      id: q.id,
      kind: q.kind,
      kindLabel: q.kind === "quote" ? "Quote" : "Reflection",
      label: `[${q.id}] ${label}${q.fields.original_text.length > 70 ? "…" : ""}`,
      preview: q.fields.theme_tags,
      searchText: `${q.fields.original_text} ${q.fields.theme_tags} ${q.fields.best_fit}`.toLowerCase(),
      groundingText: `${q.fields.original_text}\n\nNotes: ${q.fields.notes}`,
    });
  }

  for (const c of DATA.conditions) {
    items.push({
      id: c.id,
      kind: "condition",
      kindLabel: "Condition",
      label: `[${c.id}] ${c.title}`,
      preview: "Clinical sign profile",
      searchText: c.title.toLowerCase(),
      groundingText: c.raw,
    });
  }

  for (const ch of DATA.characters) {
    items.push({
      id: ch.id,
      kind: "character",
      kindLabel: "Character",
      label: `[${ch.id}] ${ch.title}`,
      preview: ch.fields.conditions.map((cc) => cc.condition).join(", "),
      searchText: `${ch.title} ${ch.fields.conditions.map((cc) => cc.condition).join(" ")}`.toLowerCase(),
      groundingText: ch.raw,
    });
  }

  return items;
}

const ALL_ITEMS = buildItems();
const KIND_ORDER = ["incident", "quote", "reflection", "character", "condition"];

export function LibraryPanel({
  onSelect,
}: {
  onSelect: (entry: LibraryContextEntry & { insertTag: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ALL_ITEMS.filter((item) => {
      if (kindFilter && item.kind !== kindFilter) return false;
      if (!q) return true;
      return item.searchText.includes(q) || item.label.toLowerCase().includes(q);
    }).slice(0, 60);
  }, [query, kindFilter]);

  return (
    <aside className="flex w-full flex-col gap-3 rounded-xl border border-line-strong bg-ops-surface p-4">
      <div>
        <p className="u-eyebrow text-text-muted">Library</p>
        <p className="mt-1 text-xs text-text-muted">
          Insert a reference and ground the next operation with it
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search incidents, quotes, characters…"
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-text outline-none placeholder:text-text-muted focus:border-accent"
      />

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setKindFilter(null)}
          className={`rounded-pill border px-2 py-1 text-[0.68rem] transition-colors ${
            kindFilter === null ? "border-accent text-accent" : "border-line text-text-muted"
          }`}
        >
          All
        </button>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k === kindFilter ? null : k)}
            className={`rounded-pill border px-2 py-1 text-[0.68rem] capitalize transition-colors ${
              kindFilter === k ? "border-accent text-accent" : "border-line text-text-muted"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-text-muted">No matches</p>
        )}
        {filtered.map((item) => (
          <button
            key={item.id}
            onClick={() =>
              onSelect({
                id: item.id,
                kind: item.kind,
                label: item.label,
                text: item.groundingText,
                insertTag: `[[${item.id}]]`,
              })
            }
            className="flex flex-col items-start rounded-md border border-line px-3 py-2 text-left transition-colors hover:border-accent hover:bg-bg-card-hover"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-text">
              {item.label}
            </span>
            {item.preview && (
              <span className="mt-0.5 line-clamp-1 text-[0.68rem] leading-tight text-text-muted">
                {item.preview}
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}
