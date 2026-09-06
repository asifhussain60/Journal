import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useReaderData, NOTE_META, type NoteType } from "../../stores/useReaderData";

const TYPES = Object.keys(NOTE_META) as NoteType[];
const NO_NOTES: never[] = [];

export function NotesPanel({
  chapterId,
  currentPara,
  previewOf,
  onJump,
}: {
  chapterId: string;
  currentPara: number;
  previewOf: (para: number) => string;
  onJump: (para: number) => void;
}) {
  const notes = useReaderData((s) => s.notes[chapterId] ?? NO_NOTES);
  const addNote = useReaderData((s) => s.addNote);
  const removeNote = useReaderData((s) => s.removeNote);
  const [type, setType] = useState<NoteType>("edit");
  const [text, setText] = useState("");

  function submit() {
    if (!text.trim()) return;
    addNote(chapterId, {
      type,
      text: text.trim(),
      paraIdx: currentPara,
      preview: previewOf(currentPara),
    });
    setText("");
    toast.success("Note saved", { description: `${NOTE_META[type].label} · ¶${currentPara + 1}` });
  }

  return (
    <aside className="sticky top-28 hidden max-h-[76vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-bg-card/60 xl:flex">
      <div className="border-b border-line px-4 py-3">
        <p className="u-eyebrow text-text-muted">Notes</p>
      </div>

      {/* Composer */}
      <div className="border-b border-line p-4">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded-pill border px-2 py-1 text-[0.68rem] transition-colors ${
                t === type ? "border-transparent text-accent-contrast" : "border-line text-text-muted"
              }`}
              style={t === type ? { background: NOTE_META[t].token } : undefined}
            >
              {NOTE_META[t].label}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={3}
          placeholder={`Note on ¶${currentPara + 1}… (⌘↵ to save)`}
          className="w-full resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="mt-2 w-full rounded-md bg-accent py-2 text-sm font-medium text-accent-contrast disabled:opacity-40"
        >
          Add note
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3">
        {notes.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-text-muted">
            No notes yet. Notes anchor to the paragraph you're reading.
          </p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {notes.map((n) => (
                <motion.li
                  key={n.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="group rounded-lg border border-line bg-bg p-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 text-[0.68rem] font-medium"
                      style={{ color: NOTE_META[n.type].token }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: NOTE_META[n.type].token }}
                      />
                      {NOTE_META[n.type].label}
                    </span>
                    <button
                      onClick={() => removeNote(chapterId, n.id)}
                      className="text-xs text-text-muted opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                      aria-label="Delete note"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-sm text-text">{n.text}</p>
                  <button
                    onClick={() => onJump(n.paraIdx)}
                    className="mt-1.5 text-xs text-text-muted hover:text-accent"
                  >
                    ¶{n.paraIdx + 1} · {n.preview}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </aside>
  );
}
