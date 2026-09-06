import { useEffect, useMemo, useState } from "react";
import libraryData from "../../data/library.json";
import { useLibraryContext, type LibraryContextEntry } from "../../stores/useLibraryContext";
import { EntityRefineModal, type EntityField } from "../../components/EntityRefineModal";

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

interface IncidentFields {
  era: string;
  themes: string;
  emotional_arc: string;
  status: string;
  told_in: string;
  refs: string;
  connections: string;
  takeaway: string;
}

interface IncidentEntry {
  id: string;
  kind: "incident";
  title: string;
  section: string | null;
  fields: IncidentFields;
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

// The 9-field shape every incident (static, KV-added, or KV-overridden) shares.
// Kept as an ordered field list so the modal can render it directly.
const INCIDENT_FIELDS: EntityField[] = [
  { key: "title", label: "Title" },
  { key: "era", label: "Era" },
  { key: "themes", label: "Themes" },
  { key: "emotional_arc", label: "Emotional arc" },
  { key: "status", label: "Status" },
  { key: "told_in", label: "Told in" },
  { key: "refs", label: "Refs" },
  { key: "connections", label: "Connections", multiline: true },
  { key: "takeaway", label: "Takeaway", multiline: true },
];
const NEW_INCIDENT_FIELDS: EntityField[] = [
  { key: "rawText", label: "What happened?", multiline: true },
];

interface LibraryItem {
  id: string;
  kind: string;
  kindLabel: string;
  label: string;
  preview: string;
  searchText: string;
  groundingText: string;
  // Present only for incidents — lets the modal open pre-populated per-field
  // rather than just showing the flattened raw text.
  incidentValues?: Record<string, string>;
}

function incidentToItem(inc: IncidentEntry): LibraryItem {
  return {
    id: inc.id,
    kind: "incident",
    kindLabel: "Incident",
    label: `[${inc.id}] ${inc.title}`,
    preview: inc.fields.takeaway || inc.fields.themes,
    searchText: `${inc.title} ${inc.fields.themes} ${inc.fields.era}`.toLowerCase(),
    groundingText: inc.raw,
    incidentValues: { title: inc.title, ...inc.fields },
  };
}

function buildStaticNonIncidentItems(): LibraryItem[] {
  const items: LibraryItem[] = [];

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

const STATIC_NON_INCIDENT_ITEMS = buildStaticNonIncidentItems();
const KIND_ORDER = ["incident", "quote", "reflection", "character", "condition"];

// Fields the read-only view shows for each non-incident kind — kept simple
// (whole raw text) rather than trying to flatten deeply nested shapes
// (condition sign lists, per-condition character evidence) into rows.
const READ_ONLY_FIELDS: EntityField[] = [{ key: "raw", label: "Full entry", multiline: true }];

interface Draft {
  // undefined id = adding a brand-new incident; a real id = editing/viewing
  // an existing library item of any kind.
  id?: string;
  kind: string;
  title: string;
  fields: EntityField[];
  values: Record<string, string>;
}

export function LibraryPanel({
  onSelect,
}: {
  onSelect: (entry: LibraryContextEntry & { insertTag: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [addedIncidents, setAddedIncidents] = useState<IncidentEntry[]>([]);
  const [overrides, setOverrides] = useState<Record<string, IncidentFields & { title: string }>>(
    {},
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refining, setRefining] = useState(false);
  const [approving, setApproving] = useState(false);

  const groundingEntries = useLibraryContext((s) => s.entries);
  const selectedIds = useMemo(() => new Set(groundingEntries.map((e) => e.id)), [groundingEntries]);

  // Fetch once per mount — additions/overrides don't change from outside this
  // panel while it's open, and a fresh mount (opening the tab) is a fine time
  // to re-check. Failure just means "no KV incidents yet" — the static 158
  // entries always render regardless (same fallback philosophy fetchChapterText
  // already uses: the live route is a nice-to-have, never a hard requirement).
  useEffect(() => {
    let live = true;
    fetch("/api/reference-data/incidents", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { ok?: boolean; incidents?: IncidentEntry[]; overrides?: Record<string, IncidentFields & { title: string }> }) => {
        if (!live || !data.ok) return;
        setAddedIncidents(data.incidents ?? []);
        setOverrides(data.overrides ?? {});
      })
      .catch(() => {
        // no KV incidents reachable — static library still works fine
      });
    return () => {
      live = false;
    };
  }, []);

  const allItems = useMemo(() => {
    const staticIncidents = DATA.incidents.map((inc) => {
      const override = overrides[inc.id];
      return override ? incidentToItem({ ...inc, title: override.title, fields: override }) : incidentToItem(inc);
    });
    const added = addedIncidents.map((inc) => {
      const override = overrides[inc.id];
      return override ? incidentToItem({ ...inc, title: override.title, fields: override }) : incidentToItem(inc);
    });
    return [...staticIncidents, ...added, ...STATIC_NON_INCIDENT_ITEMS];
  }, [addedIncidents, overrides]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems
      .filter((item) => {
        if (kindFilter && item.kind !== kindFilter) return false;
        if (!q) return true;
        return item.searchText.includes(q) || item.label.toLowerCase().includes(q);
      })
      .slice(0, 60);
  }, [allItems, query, kindFilter]);

  function openItem(item: LibraryItem) {
    if (item.kind === "incident" && item.incidentValues) {
      setDraft({
        id: item.id,
        kind: "incident",
        title: item.label,
        fields: INCIDENT_FIELDS,
        values: item.incidentValues,
      });
    } else {
      setDraft({
        id: item.id,
        kind: item.kind,
        title: item.label,
        fields: READ_ONLY_FIELDS,
        values: { raw: item.groundingText },
      });
    }
  }

  function openAddNew() {
    setDraft({
      id: undefined,
      kind: "incident",
      title: "New incident",
      fields: NEW_INCIDENT_FIELDS,
      values: { rawText: "" },
    });
  }

  function insertAndGround() {
    if (!draft || !draft.id) return;
    const text = draft.fields.map((f) => `${f.label}: ${draft.values[f.key] ?? ""}`).join("\n");
    onSelect({ id: draft.id, kind: draft.kind, label: draft.title, text, insertTag: `[[${draft.id}]]` });
    setDraft(null);
  }

  async function handleRefine() {
    if (!draft) return;
    setRefining(true);
    try {
      const body =
        draft.fields === NEW_INCIDENT_FIELDS
          ? { rawText: draft.values.rawText }
          : { fields: draft.values };
      const res = await fetch("/api/incident-draft", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; draft?: Record<string, string>; error?: string };
      if (!data.ok || !data.draft) throw new Error(data.error || "Refine failed");
      setDraft((prev) => (prev ? { ...prev, fields: INCIDENT_FIELDS, values: data.draft! } : prev));
    } catch {
      // Leave the draft as-is — the user can retry Refine or edit by hand.
    } finally {
      setRefining(false);
    }
  }

  async function handleApprove() {
    if (!draft) return;
    setApproving(true);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id, fields: draft.values }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        entry?: { id: string; title: string; fields: IncidentFields };
        error?: string;
      };
      if (!data.ok || !data.entry) throw new Error(data.error || "Save failed");
      if (draft.id) {
        setOverrides((prev) => ({ ...prev, [draft.id!]: { title: data.entry!.title, ...data.entry!.fields } }));
      } else {
        setAddedIncidents((prev) => [
          ...prev,
          { id: data.entry!.id, kind: "incident", title: data.entry!.title, section: null, fields: data.entry!.fields, raw: "" },
        ]);
      }
      setDraft(null);
    } catch {
      // Leave the modal open so the user can see the fields are unsaved and retry.
    } finally {
      setApproving(false);
    }
  }

  return (
    <aside className="flex w-full flex-col gap-3 rounded-xl border border-line-strong bg-ops-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="u-eyebrow text-text-muted">Library</p>
          <p className="mt-1 text-xs text-text-muted">
            {groundingEntries.length > 0
              ? `${groundingEntries.length} selected — click an entry to open it`
              : "Click an entry to view, edit, or ground the next operation"}
          </p>
        </div>
        <button
          onClick={openAddNew}
          aria-label="Add incident"
          title="Add incident"
          className="shrink-0 rounded-md border border-line bg-ops-button px-2.5 py-1 text-sm text-text hover:border-accent hover:bg-ops-button-hover"
        >
          +
        </button>
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
            kindFilter === null
              ? "border-accent bg-accent-soft text-accent"
              : "border-line bg-ops-button text-text-muted hover:bg-ops-button-hover"
          }`}
        >
          All
        </button>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k === kindFilter ? null : k)}
            className={`rounded-pill border px-2 py-1 text-[0.68rem] capitalize transition-colors ${
              kindFilter === k
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-ops-button text-text-muted hover:bg-ops-button-hover"
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
        {filtered.map((item) => {
          const selected = selectedIds.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => openItem(item)}
              className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors hover:border-accent hover:bg-ops-button-hover ${
                selected ? "border-accent bg-accent-soft" : "border-line bg-ops-button"
              }`}
            >
              <span className="flex w-full items-center gap-1.5 text-xs font-medium text-text">
                {selected && <span className="text-accent">✓</span>}
                {item.label}
              </span>
              {item.preview && (
                <span className="mt-0.5 w-full truncate text-[0.68rem] leading-tight text-text-muted">
                  {item.preview}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {draft && (
        <EntityRefineModal
          open
          onClose={() => setDraft(null)}
          title={draft.title}
          fields={draft.fields}
          values={draft.values}
          onChange={(key, value) =>
            setDraft((prev) => (prev ? { ...prev, values: { ...prev.values, [key]: value } } : prev))
          }
          readOnly={draft.kind !== "incident"}
          onRefine={draft.kind === "incident" ? handleRefine : undefined}
          refining={refining}
          onApprove={draft.kind === "incident" ? handleApprove : undefined}
          approving={approving}
          extraActions={
            draft.id ? (
              <button
                onClick={insertAndGround}
                className="rounded-md border border-line bg-ops-button px-3 py-1.5 text-xs text-text transition-colors hover:bg-ops-button-hover"
              >
                Insert &amp; ground
              </button>
            ) : undefined
          }
        />
      )}
    </aside>
  );
}
