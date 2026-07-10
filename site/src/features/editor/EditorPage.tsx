import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AppHeader } from "../../components/AppHeader";
import { ReaderToolbar } from "../reader/ReaderToolbar";
import { chapterById } from "../../lib/manifest";
import { fetchChapterText } from "../../lib/api";
import { runOp, saveChapter, type ProseOp } from "../../lib/ops";
import { useReaderPrefs, readerStyle } from "../../stores/useReaderPrefs";
import { usePolicies } from "../../stores/usePolicies";
import { useIdentity } from "../../stores/useIdentity";
import { blockAt, nextBlock, paragraphBlocks } from "./paragraphRange";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { OperationsPanel } from "./OperationsPanel";
import { DiffView } from "./DiffView";
import { SaveBar } from "./SaveBar";

interface OpRun {
  op: ProseOp;
  before: string;
  after: string;
  from: number;
  to: number;
  loading: boolean;
  error: string | null;
}

export function EditorPage() {
  const { chapterId = "" } = useParams();
  const chapter = chapterById(chapterId);

  const editorRef = useRef<CodeEditorHandle>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [doc, setDoc] = useState("");
  const [cursor, setCursor] = useState(0);
  const [selectionText, setSelectionText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tocOpen, setTocOpen] = useState(false); // collapsible left panel, default collapsed
  const [opRun, setOpRun] = useState<OpRun | null>(null);

  const prefs = useReaderPrefs();
  const isAdmin = useIdentity((s) => s.isAdmin); // viewers get a read-only view
  const policyList = usePolicies((s) => s.policies);
  const activePolicies = useMemo(
    () => policyList.filter((p) => p.active).map((p) => p.text),
    [policyList],
  );
  const locked = chapter?.locked ?? false;

  useEffect(() => {
    if (!chapter?.file) {
      setStatus("error");
      return;
    }
    let live = true;
    fetchChapterText(chapter.id, chapter.file)
      .then((t) => {
        if (!live) return;
        setDoc(t);
        setStatus("ready");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [chapter?.file]);

  const activeBlock = useMemo(() => (doc ? blockAt(doc, cursor) : null), [doc, cursor]);
  const sections = chapter?.sections ?? [];

  function jumpToSection(para: number) {
    const view = editorRef.current;
    if (!view) return;
    const blocks = paragraphBlocks(view.getDoc());
    const target = blocks[para]; // block 0 = title; body para N = block N
    if (target) view.scrollToPos(target.from);
    setTocOpen(false);
  }

  async function handleRunOp(op: ProseOp, hint?: string) {
    const view = editorRef.current;
    if (!view) return;
    const curDoc = view.getDoc();
    const block = blockAt(curDoc, view.getCursor());
    if (!block) return;

    let from = block.from;
    let to = block.to;
    let before = block.text;

    const sel = view.getSelectionRange();
    const selText = curDoc.slice(sel.from, sel.to);
    const hasSel = selText.trim().length > 0;
    // Replace always targets the selection; Refine/Rephrase target it when present.
    const useSelection = op === "replace" || ((op === "refine" || op === "rephrase") && hasSel);

    if (op === "replace" && !hasSel) {
      toast.error("Select a word or phrase to replace");
      return;
    }
    if (useSelection) {
      from = sel.from;
      to = sel.to;
      before = selText;
    } else if (op === "merge") {
      const nb = nextBlock(curDoc, block);
      if (!nb) {
        toast.error("No next paragraph to merge with");
        return;
      }
      to = nb.to;
      before = curDoc.slice(block.from, nb.to);
    }
    if (op === "split" || op === "merge") {
      toast.warning("This changes paragraph count — tags below may shift", { duration: 4000 });
    }

    setOpRun({ op, before, after: "", from, to, loading: true, error: null });
    try {
      const after = await runOp(op, before, hint, activePolicies);
      setOpRun((prev) => (prev ? { ...prev, after, loading: false } : prev));
    } catch (e) {
      setOpRun((prev) => (prev ? { ...prev, loading: false, error: (e as Error).message } : prev));
    }
  }

  function acceptOp() {
    if (!opRun || !editorRef.current) return;
    editorRef.current.replaceRange(opRun.from, opRun.to, opRun.after);
    setOpRun(null);
    editorRef.current.focus();
  }

  function handleCut() {
    const view = editorRef.current;
    if (!view) return;
    const curDoc = view.getDoc();
    const block = blockAt(curDoc, view.getCursor());
    if (!block) return;
    let to = block.to;
    while (to < curDoc.length && curDoc[to] === "\n") to++;
    view.replaceRange(block.from, to, "");
    toast.message("Paragraph cut", { description: "⌘Z to undo" });
  }

  function handleMove(dir: "up" | "down") {
    const view = editorRef.current;
    if (!view) return;
    const curDoc = view.getDoc();
    const blocks = paragraphBlocks(curDoc);
    const cur = blockAt(curDoc, view.getCursor());
    if (!cur) return;
    const other = dir === "up" ? blocks[cur.index - 1] : blocks[cur.index + 1];
    if (!other) {
      toast.error(`No paragraph to move ${dir === "up" ? "above" : "below"}`);
      return;
    }
    const [a, b] = cur.index < other.index ? [cur, other] : [other, cur]; // a precedes b
    const between = curDoc.slice(a.to, b.from);
    view.replaceRange(a.from, b.to, b.text + between + a.text);
    toast.warning("Paragraph reordered — tags may shift", { duration: 4000 });
  }

  async function handleSave() {
    const view = editorRef.current;
    if (!view || !chapter) return;
    setSaving(true);
    try {
      // Asif's own edit is the sanctioned unlock for a locked chapter.
      const { savedAt } = await saveChapter(chapter.id, view.getDoc(), locked);
      setDirty(false);
      toast.success("Saved", { description: new Date(savedAt).toLocaleTimeString() });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!chapter?.file) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-3xl px-6 py-20 text-text-muted">
          {chapter ? "This chapter isn't written yet — nothing to edit." : "Chapter not found."}
          <div className="mt-4">
            <Link to="/" className="text-accent">
              ← All chapters
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <AppHeader />

      <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-text-muted hover:text-text">
            ← All chapters
          </Link>
          <span className="u-eyebrow text-accent">Chapter {chapter.num}</span>
          <span className="font-display text-lg text-text">{chapter.title}</span>
        </div>
        <div className="flex items-center gap-3">
          <ReaderToolbar />
          {isAdmin ? (
            <SaveBar dirty={dirty} saving={saving} locked={locked} onSave={handleSave} />
          ) : (
            <span
              className="rounded-md border border-line px-2 py-1 text-[0.68rem] text-text-muted"
              title="You have viewer access — reading only."
            >
              Read-only
            </span>
          )}
        </div>
      </div>

      {/* Workspace: collapsible TOC · always-editable prose · operations */}
      <div className="mx-auto flex w-full max-w-[1500px] flex-1 gap-4 overflow-hidden px-6 pb-4">
        {/* Collapsible left panel */}
        <div className={`shrink-0 transition-all duration-200 ${tocOpen ? "w-52" : "w-10"}`}>
          {tocOpen ? (
            <div className="flex h-full flex-col">
              <button
                onClick={() => setTocOpen(false)}
                className="mb-3 flex items-center gap-2 text-xs text-text-muted hover:text-text"
              >
                ‹ Hide sections
              </button>
              <nav className="overflow-y-auto">
                <ul className="space-y-1.5">
                  {sections.length === 0 && (
                    <li className="text-xs text-text-muted">No sections</li>
                  )}
                  {sections.map((s) => (
                    <li key={s.para}>
                      <button
                        onClick={() => jumpToSection(s.para)}
                        className="block text-left text-sm leading-snug text-text-muted hover:text-accent"
                      >
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          ) : (
            <button
              onClick={() => setTocOpen(true)}
              title="Sections"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-text-muted hover:border-accent hover:text-accent"
              aria-label="Show sections"
            >
              ☰
            </button>
          )}
        </div>

        {/* Editable prose */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-bg-card/30">
          {status === "ready" && (
            <div className="mx-auto h-full max-w-3xl" style={readerStyle(prefs)}>
              <CodeEditor
                ref={editorRef}
                initialDoc={doc}
                readOnly={!isAdmin}
                onChange={(d) => {
                  setDoc(d);
                  setDirty(true);
                }}
                onCursor={(pos) => {
                  setCursor(pos);
                  setSelectionText(editorRef.current?.getSelectionText() ?? "");
                }}
              />
            </div>
          )}
          {status === "loading" && <div className="p-6 text-sm text-text-muted">Loading…</div>}
          {status === "error" && (
            <div className="p-6 text-sm text-error">Could not load chapter.</div>
          )}
        </div>

        {/* Operations / diff rail — admins only. Viewers get a wider, read-only
            reading column with no editing surface at all. */}
        {isAdmin && (
          <div className="min-h-0 w-[310px] shrink-0 overflow-y-auto">
            {opRun ? (
              <DiffView
                op={opRun.op}
                before={opRun.before}
                after={opRun.after}
                loading={opRun.loading}
                error={opRun.error}
                onAccept={acceptOp}
                onReject={() => setOpRun(null)}
              />
            ) : (
              <OperationsPanel
                chapterId={chapter.id}
                activeParaIndex={activeBlock?.index ?? 0}
                activeParaText={activeBlock?.text ?? ""}
                selectionText={selectionText}
                onRunOp={handleRunOp}
                onCut={handleCut}
                onMove={handleMove}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
