import { useEffect, useState } from "react";

// Fixed fallback bank — used if the dynamic per-scene questions can't be
// fetched (worker unreachable, etc.), so the panel is never dead. Answers are
// purely ephemeral either way: they only ever feed one generation and are
// discarded on close or reload. Generate reuses the existing "expand"
// operation with the Q&A folded into its hint string — no new op contract.
const FALLBACK_QUESTIONS = [
  "Who else was in the room, and what were they doing?",
  "What did you see, hear, or feel in your body in that moment?",
  "What were you afraid would happen if this went wrong?",
  "What happened right before, and right after?",
  "Looking back, what does this moment mean to you now?",
];

export function InterviewPanel({
  chapterTitle,
  activeParaText,
  onGenerate,
}: {
  chapterTitle: string;
  activeParaText: string;
  onGenerate: (hint: string) => void;
}) {
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch("/api/interview-questions", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterTitle, paragraphText: activeParaText }),
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; questions?: string[] }) => {
        if (!live) return;
        const qs = data.ok && data.questions?.length ? data.questions : FALLBACK_QUESTIONS;
        setQuestions(qs);
        setAnswers(qs.map(() => ""));
      })
      .catch(() => {
        if (!live) return;
        setQuestions(FALLBACK_QUESTIONS);
        setAnswers(FALLBACK_QUESTIONS.map(() => ""));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterTitle, activeParaText]);

  const hasAnswer = answers.some((a) => a.trim().length > 0);

  function generate() {
    if (!questions) return;
    const pairs = questions.map((q, i) => ({ q, a: answers[i]?.trim() ?? "" })).filter((p) => p.a);
    const hint = `Interview answers:\n${pairs.map((p) => `Q: ${p.q}\nA: ${p.a}`).join("\n\n")}`;
    onGenerate(hint);
    setAnswers(questions.map(() => ""));
  }

  return (
    <aside className="flex w-full flex-col gap-3 rounded-xl border border-line-strong bg-ops-surface p-4">
      <div>
        <p className="u-eyebrow text-text-muted">Interview</p>
        <p className="mt-1 text-xs text-text-muted">
          Answer a few questions about this scene, then generate new content grounded in them —
          nothing here is saved
        </p>
      </div>

      {loading ? (
        <p className="py-4 text-center text-xs text-text-muted">Reading the scene…</p>
      ) : (
        <div className="flex flex-col gap-3 overflow-y-auto">
          {questions?.map((q, i) => (
            <div key={q}>
              <label className="mb-1 block text-xs text-text-secondary">{q}</label>
              <textarea
                value={answers[i] ?? ""}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))
                }
                rows={2}
                className="w-full resize-none rounded-md border border-line bg-bg px-3 py-2 text-xs text-text outline-none placeholder:text-text-muted focus:border-accent"
                placeholder="Your answer…"
              />
            </div>
          ))}
        </div>
      )}

      <button
        onClick={generate}
        disabled={!hasAnswer || loading}
        className="w-full rounded-md bg-accent py-2 text-xs font-medium text-accent-contrast disabled:opacity-40"
      >
        Generate from these answers
      </button>
    </aside>
  );
}
