import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { toast } from "sonner";
import { OPERATIONS, GROUPS, type ProseOp, type OpMeta } from "../../lib/ops";
import { useReaderData, NOTE_META, type NoteType } from "../../stores/useReaderData";
import { usePolicies } from "../../stores/usePolicies";
import { useLibraryContext } from "../../stores/useLibraryContext";

const TAG_TYPES = Object.keys(NOTE_META) as NoteType[];

export function OperationsPanel({
  chapterId,
  activeParaIndex,
  activeParaText,
  selectionText,
  onRunOp,
  onCut,
  onMove,
}: {
  chapterId: string;
  activeParaIndex: number;
  activeParaText: string;
  selectionText: string;
  onRunOp: (op: ProseOp, hint?: string) => void;
  onCut: () => void;
  onMove: (dir: "up" | "down") => void;
}) {
  const [hint, setHint] = useState("");
  const [tagType, setTagType] = useState<NoteType>("edit");
  const [noteText, setNoteText] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [policyText, setPolicyText] = useState("");
  const addNote = useReaderData((s) => s.addNote);
  const policies = usePolicies((s) => s.policies);
  const addPolicy = usePolicies((s) => s.addPolicy);
  const togglePolicy = usePolicies((s) => s.toggle);
  const removePolicy = usePolicies((s) => s.remove);
  const groundingEntries = useLibraryContext((s) => s.entries);
  const clearGrounding = useLibraryContext((s) => s.clear);

  const sel = selectionText.trim();
  const hasSel = sel.length > 0;
  const selWords = hasSel ? sel.split(/\s+/).length : 0;
  const preview = activeParaText.trim().split(/\s+/).slice(0, 6).join(" ");
  const activePolicyCount = policies.filter((p) => p.active).length;

  function actsOnLabel(o: OpMeta): string {
    if (o.actsOn === "selection" || (o.selectionAware && hasSel)) {
      return hasSel
        ? `your selection (${selWords} word${selWords === 1 ? "" : "s"})`
        : "a selection — highlight text first";
    }
    if (o.actsOn === "paragraph+next") return `paragraph ¶${activeParaIndex + 1} and the next`;
    if (o.actsOn === "chapter") return "every future refinement";
    return `paragraph ¶${activeParaIndex + 1}`;
  }

  function addAnnotation() {
    if (!noteText.trim()) return;
    addNote(chapterId, {
      type: tagType,
      text: noteText.trim(),
      paraIdx: activeParaIndex,
      preview: preview || `¶${activeParaIndex + 1}`,
    });
    setNoteText("");
    toast.success("Tag added", { description: `${NOTE_META[tagType].label} · ¶${activeParaIndex + 1}` });
  }

  // Folds any selected library entries into the hint sent to the worker —
  // pure client-side string composition, the worker already treats `hint` as
  // an opaque free-text field appended to the prompt (see OP_INSTRUCTIONS).
  function buildHint(): string | undefined {
    const parts = [hint.trim()];
    if (groundingEntries.length > 0) {
      const grounding = groundingEntries.map((e) => `[${e.id}] ${e.text}`).join("\n\n");
      parts.push(`Grounding context:\n${grounding}`);
    }
    const full = parts.filter(Boolean).join("\n\n").trim();
    return full || undefined;
  }

  function submitPolicy() {
    if (!policyText.trim()) return;
    addPolicy(policyText.trim());
    setPolicyText("");
    toast.success("Policy added", { description: "Applies to every future refinement" });
  }

  // Rich hover popup shared by every operation tile.
  function Popup({ o }: { o: OpMeta }) {
    return (
      <Tooltip.Portal>
        <Tooltip.Content
          side="left"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className="z-50 w-72 rounded-xl border border-line-strong bg-ops-tooltip p-4 shadow-2xl"
        >
          <p className="font-display text-base font-semibold text-text">{o.label}</p>
          <p className="mt-1.5 text-[0.9rem] leading-snug text-text-secondary">{o.detail}</p>
          <div className="mt-3 space-y-1 border-t border-line pt-2.5 text-xs">
            <p>
              <span className="text-text-muted">Acts on: </span>
              <span className="text-text">{actsOnLabel(o)}</span>
            </p>
            <p>
              <span className="text-text-muted">Effect: </span>
              <span className="text-text">{o.effect}</span>
            </p>
          </div>
          <Tooltip.Arrow className="fill-[color:var(--ops-tooltip)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    );
  }

  function renderOp(o: OpMeta) {
    // Move — full-width row with up/down.
    if (o.kind === "move") {
      return (
        <Tooltip.Root key={o.op}>
          <Tooltip.Trigger asChild>
            <div className="col-span-2 flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span className="flex flex-col">
                <span className="text-sm font-medium text-text">Move</span>
                <span className="text-[0.68rem] text-text-muted">Reorder ¶{activeParaIndex + 1}</span>
              </span>
              <span className="flex gap-1.5">
                <button
                  onClick={() => onMove("up")}
                  className="rounded-md border border-line px-2.5 py-1 text-sm hover:border-accent hover:text-accent"
                  aria-label="Move paragraph up"
                >
                  ↑
                </button>
                <button
                  onClick={() => onMove("down")}
                  className="rounded-md border border-line px-2.5 py-1 text-sm hover:border-accent hover:text-accent"
                  aria-label="Move paragraph down"
                >
                  ↓
                </button>
              </span>
            </div>
          </Tooltip.Trigger>
          <Popup o={o} />
        </Tooltip.Root>
      );
    }

    // Policy — full-width toggle for the policy manager.
    if (o.kind === "policy") {
      return (
        <Tooltip.Root key={o.op}>
          <Tooltip.Trigger asChild>
            <button
              onClick={() => setShowPolicy((s) => !s)}
              className="col-span-2 flex items-center justify-between rounded-md border border-line px-3 py-2 text-left hover:border-accent"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium text-text">Policy</span>
                <span className="text-[0.68rem] text-text-muted">{o.hint}</span>
              </span>
              {activePolicyCount > 0 && (
                <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[0.68rem] text-accent">
                  {activePolicyCount} active
                </span>
              )}
            </button>
          </Tooltip.Trigger>
          <Popup o={o} />
        </Tooltip.Root>
      );
    }

    const isCut = o.op === "cut";
    const isNote = o.op === "note";
    const disabled = o.needsSelection && !hasSel;
    const onSelection = o.selectionAware && hasSel;

    return (
      <Tooltip.Root key={o.op}>
        <Tooltip.Trigger asChild>
          <button
            disabled={disabled}
            onClick={() => {
              if (isCut) return onCut();
              if (isNote) return document.getElementById("annotation-text")?.focus();
              onRunOp(o.op as ProseOp, buildHint());
            }}
            className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              isCut
                ? "border-error/40 text-error hover:bg-error/10"
                : "border-line text-text hover:border-accent hover:bg-bg-card-hover"
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {o.label}
              {o.shiftsAnchors && <span className="text-[0.6rem] text-warning">shifts</span>}
              {onSelection && <span className="text-[0.6rem] text-accent">selection</span>}
            </span>
            <span className="mt-0.5 text-[0.68rem] leading-tight text-text-muted">{o.hint}</span>
          </button>
        </Tooltip.Trigger>
        <Popup o={o} />
      </Tooltip.Root>
    );
  }

  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={200}>
      <aside className="flex w-full flex-col gap-4 rounded-xl border border-line-strong bg-ops-surface p-4">
        <div>
          <p className="u-eyebrow text-text-muted">Operations</p>
          <p className="mt-1 text-xs text-text-muted">
            Target: <span className="text-text-secondary">¶{activeParaIndex + 1}</span>
            {hasSel ? (
              <span className="text-accent"> · {selWords} word{selWords === 1 ? "" : "s"} selected</span>
            ) : (
              preview && <span className="italic"> · {preview}…</span>
            )}
          </p>
        </div>

        <input
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="Optional direction (e.g. more on his tone)"
          className="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-text outline-none placeholder:text-text-muted focus:border-accent"
        />

        {groundingEntries.length > 0 && (
          <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent-soft px-3 py-1.5 text-[0.68rem]">
            <span className="text-accent">
              {groundingEntries.length} librar{groundingEntries.length === 1 ? "y" : "ies"} entr
              {groundingEntries.length === 1 ? "y" : "ies"} grounding the next operation
            </span>
            <button onClick={clearGrounding} className="text-text-muted hover:text-error" aria-label="Clear grounding">
              ✕
            </button>
          </div>
        )}

        {/* Grouped operations — selection · rewrite · add · structure · annotate */}
        {GROUPS.map((g) => {
          const ops = OPERATIONS.filter((o) => o.group === g.id);
          if (!ops.length) return null;
          return (
            <div key={g.id}>
              <p className="u-eyebrow mb-1.5 text-[0.6rem] text-text-muted">{g.label}</p>
              <div className="grid grid-cols-2 gap-2">{ops.map(renderOp)}</div>
            </div>
          );
        })}

        {/* Policy manager */}
        {showPolicy && (
          <div className="rounded-lg border border-line bg-bg p-3">
            <p className="u-eyebrow mb-2 text-text-muted">Series policies</p>
            <div className="flex gap-2">
              <input
                value={policyText}
                onChange={(e) => setPolicyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitPolicy()}
                placeholder="e.g. keep closings short and hard"
                className="flex-1 rounded-md border border-line bg-bg-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
              />
              <button
                onClick={submitPolicy}
                disabled={!policyText.trim()}
                className="rounded-md bg-accent px-3 text-xs font-medium text-accent-contrast disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {policies.length > 0 && (
              <ul className="mt-2 space-y-1">
                {policies.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={p.active}
                      onChange={() => togglePolicy(p.id)}
                      className="accent-[color:var(--accent)]"
                    />
                    <span className={p.active ? "flex-1 text-text" : "flex-1 text-text-muted line-through"}>
                      {p.text}
                    </span>
                    <button
                      onClick={() => removePolicy(p.id)}
                      className="text-text-muted hover:text-error"
                      aria-label="Remove policy"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Tag composer */}
        <div className="border-t border-line pt-4">
          <p className="u-eyebrow mb-2 text-text-muted">Tag this paragraph</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {TAG_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setTagType(t)}
                className={`rounded-pill border px-2 py-1 text-[0.68rem] transition-colors ${
                  t === tagType ? "border-transparent text-accent-contrast" : "border-line text-text-muted"
                }`}
                style={t === tagType ? { background: NOTE_META[t].token } : undefined}
              >
                {NOTE_META[t].label}
              </button>
            ))}
          </div>
          <textarea
            id="annotation-text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addAnnotation();
            }}
            rows={2}
            placeholder={`${NOTE_META[tagType].label} note on ¶${activeParaIndex + 1}… (⌘↵)`}
            className="w-full resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
          />
          <button
            onClick={addAnnotation}
            disabled={!noteText.trim()}
            className="mt-2 w-full rounded-md border border-line py-1.5 text-xs text-text-secondary hover:bg-bg-card-hover disabled:opacity-40"
          >
            Add tag
          </button>
        </div>
      </aside>
    </Tooltip.Provider>
  );
}
