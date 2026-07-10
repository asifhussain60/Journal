import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

export interface CodeEditorHandle {
  getDoc: () => string;
  getCursor: () => number;
  getSelectionText: () => string;
  getSelectionRange: () => { from: number; to: number };
  replaceRange: (from: number, to: number, text: string) => void;
  scrollToPos: (pos: number) => void;
  focus: () => void;
}

interface Props {
  initialDoc: string;
  readOnly: boolean;
  onChange: (doc: string) => void;
  onCursor: (pos: number) => void;
}

// Editor theme — transparent surface so the page/theme background shows through;
// prose typography pulls the same reader tokens.
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--text)", height: "100%" },
  ".cm-content": {
    fontFamily: "var(--reader-font, var(--font-serif, Georgia, serif))",
    // Wire size + spacing to the reader prefs so the Aa toolbar actually works.
    fontSize: "var(--reader-size, 1.25rem)",
    lineHeight: "var(--reader-lh, 1.8)",
    padding: "8px 4px 40vh",
    caretColor: "var(--accent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)" },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 24%, transparent) !important",
  },
  ".cm-scroller": { overflow: "auto" },
});

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { initialDoc, readOnly, onChange, onCursor },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const roComp = useRef(new Compartment());
  const cb = useRef({ onChange, onCursor });
  cb.current = { onChange, onCursor };

  useImperativeHandle(ref, () => ({
    getDoc: () => viewRef.current?.state.doc.toString() ?? "",
    getCursor: () => viewRef.current?.state.selection.main.head ?? 0,
    getSelectionText: () => {
      const v = viewRef.current;
      if (!v) return "";
      const { from, to } = v.state.selection.main;
      return v.state.doc.sliceString(from, to);
    },
    getSelectionRange: () => {
      const s = viewRef.current?.state.selection.main;
      return { from: s?.from ?? 0, to: s?.to ?? 0 };
    },
    replaceRange: (from, to, text) => {
      viewRef.current?.dispatch({ changes: { from, to, insert: text } });
    },
    scrollToPos: (pos) => {
      const v = viewRef.current;
      if (!v) return;
      const clamped = Math.min(pos, v.state.doc.length);
      v.dispatch({
        selection: { anchor: clamped },
        effects: EditorView.scrollIntoView(clamped, { y: "start", yMargin: 80 }),
      });
      v.focus();
    },
    focus: () => viewRef.current?.focus(),
  }));

  // Mount once.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlightActiveLine(),
        EditorView.lineWrapping,
        theme,
        roComp.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) cb.current.onCursor(u.state.selection.main.head);
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to readOnly changes without remounting.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: roComp.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return <div ref={hostRef} className="h-full overflow-hidden" />;
});
