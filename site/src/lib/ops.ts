// Client helpers for the editor's authoring operations and git save. Same-origin,
// credentials:"include" (Access cookie), {ok,error} envelope — matching worker/http.ts.

export type ProseOp = "refine" | "expand" | "replace" | "rephrase" | "split" | "merge";

export type OpKind = "prose" | "local" | "annotation" | "move" | "policy";
export type OpGroup = "selection" | "rewrite" | "add" | "structure" | "annotate";

export interface OpMeta {
  op: ProseOp | "cut" | "note" | "move" | "policy";
  label: string;
  hint: string; // short one-liner shown under the button label
  detail: string; // richer instruction shown in the hover popup
  group: OpGroup;
  actsOn: "selection" | "paragraph" | "paragraph+next" | "chapter";
  effect: string; // one-line "what it does to your text"
  kind: OpKind;
  needsSelection?: boolean; // requires a selection (Replace)
  selectionAware?: boolean; // uses the selection when present, else the paragraph
  shiftsAnchors?: boolean; // split/merge/move change paragraph count
}

// Sections that visibly separate selection-based, rewrite, insertion, structural
// and annotation operations.
export const GROUPS: { id: OpGroup; label: string }[] = [
  { id: "selection", label: "On your selection" },
  { id: "rewrite", label: "Rewrite the paragraph" },
  { id: "add", label: "Add new content" },
  { id: "structure", label: "Structure" },
  { id: "annotate", label: "Annotate" },
];

// The full journal @@ verb legend (10 verbs). Pronounce is intentionally
// excluded (it's the podcast skill's verb).
export const OPERATIONS: OpMeta[] = [
  {
    op: "replace",
    label: "Replace",
    hint: "Stronger word for the selection",
    detail:
      "Swaps the exact words you have highlighted for stronger, more precise ones. Changes only your selection, nothing else in the paragraph.",
    group: "selection",
    actsOn: "selection",
    effect: "Rewrites your selected words",
    kind: "prose",
    needsSelection: true,
  },
  {
    op: "refine",
    label: "Refine",
    hint: "Sharpen wording, grammar, rhythm",
    detail:
      "Sharpens word choice, grammar, and rhythm without changing meaning or adding ideas. If you have text selected it refines just that; otherwise the whole paragraph.",
    group: "rewrite",
    actsOn: "paragraph",
    effect: "Rewrites your words in place",
    kind: "prose",
    selectionAware: true,
  },
  {
    op: "rephrase",
    label: "Rephrase",
    hint: "Strongest alternate phrasing",
    detail:
      "Rewrites for better cadence while keeping the same meaning. Acts on your selection when you have one, otherwise the whole paragraph.",
    group: "rewrite",
    actsOn: "paragraph",
    effect: "Rewrites your words in place",
    kind: "prose",
    selectionAware: true,
  },
  {
    op: "expand",
    label: "Expand",
    hint: "Flesh out, add detail, slow down",
    detail:
      "Adds NEW sentences and concrete detail to the paragraph, staying in the same scene and voice. This is the one operation that inserts new writing.",
    group: "add",
    actsOn: "paragraph",
    effect: "Inserts new sentences",
    kind: "prose",
  },
  {
    op: "split",
    label: "Split",
    hint: "Break into shorter paragraphs",
    detail:
      "Breaks this paragraph into shorter ones at natural beats. No words change. Paragraph count changes, so tags anchored below may shift.",
    group: "structure",
    actsOn: "paragraph",
    effect: "Splits into shorter paragraphs",
    kind: "prose",
    shiftsAnchors: true,
  },
  {
    op: "merge",
    label: "Merge",
    hint: "Combine with the next paragraph",
    detail:
      "Combines this paragraph with the one directly after it, preserving every sentence. Paragraph count changes.",
    group: "structure",
    actsOn: "paragraph+next",
    effect: "Combines with the next paragraph",
    kind: "prose",
    shiftsAnchors: true,
  },
  {
    op: "move",
    label: "Move",
    hint: "Reorder this paragraph up or down",
    detail:
      "Moves the whole paragraph above or below its neighbor. No words change; only the order.",
    group: "structure",
    actsOn: "paragraph",
    effect: "Reorders the paragraph",
    kind: "move",
    shiftsAnchors: true,
  },
  {
    op: "cut",
    label: "Cut",
    hint: "Remove this paragraph",
    detail: "Deletes the current paragraph from the chapter. Undo with ⌘Z if it was a mistake.",
    group: "structure",
    actsOn: "paragraph",
    effect: "Removes the paragraph",
    kind: "local",
  },
  {
    op: "note",
    label: "Note",
    hint: "Message to yourself (not content)",
    detail:
      "Attaches a private message to yourself on this paragraph. It is metadata only and never becomes part of the memoir text.",
    group: "annotate",
    actsOn: "paragraph",
    effect: "Adds a private note",
    kind: "annotation",
  },
  {
    op: "policy",
    label: "Policy",
    hint: "A rule applied to every future refinement",
    detail:
      "A series-wide style rule (for example, keep closings short). Active policies are added to every future refinement across the whole memoir.",
    group: "annotate",
    actsOn: "chapter",
    effect: "Adds a global style rule",
    kind: "policy",
  },
];

interface Envelope {
  ok: boolean;
  error?: string;
}

async function postJson<T extends Envelope>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ ok: false, error: "non-JSON response" }))) as T;
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function runOp(
  op: ProseOp,
  text: string,
  hint?: string,
  policies?: string[],
): Promise<string> {
  const data = await postJson<{ ok: boolean; result: string; error?: string }>("/api/op", {
    op,
    text,
    hint,
    policies,
  });
  return data.result;
}

export async function saveChapter(
  chapterId: string,
  text: string,
  unlock = false,
): Promise<{ savedAt: string }> {
  const data = await postJson<{ ok: boolean; savedAt: string; error?: string }>(
    "/api/save-chapter",
    { chapterId, text, unlock },
  );
  return { savedAt: data.savedAt };
}
