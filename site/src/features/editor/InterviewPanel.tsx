import { useState } from "react";

// Fixed qualifying-question bank, in the spirit of the offline authoring
// skill's "never guess, ask first" qualifying-questions pattern — but purely
// ephemeral here: answers only ever feed one generation and are discarded on
// close or reload. No new worker route; Generate reuses the existing "expand"
// operation with the Q&A folded into its hint string.
const QUESTION_BANK = [
  "Who else was in the room, and what were they doing?",
  "What did you see, hear, or feel in your body in that moment?",
  "What were you afraid would happen if this went wrong?",
  "What happened right before, and right after?",
  "Looking back, what does this moment mean to you now?",
];

export function InterviewPanel({ onGenerate }: { onGenerate: (hint: string) => void }) {
  const [answers, setAnswers] = useState<string[]>(QUESTION_BANK.map(() => ""));

  const hasAnswer = answers.some((a) => a.trim().length > 0);

  function generate() {
    const pairs = QUESTION_BANK.map((q, i) => ({ q, a: answers[i].trim() })).filter((p) => p.a);
    const hint = `Interview answers:\n${pairs.map((p) => `Q: ${p.q}\nA: ${p.a}`).join("\n\n")}`;
    onGenerate(hint);
    setAnswers(QUESTION_BANK.map(() => ""));
  }

  return (
    <aside className="flex w-full flex-col gap-3 rounded-xl border border-line-strong bg-ops-surface p-4">
      <div>
        <p className="u-eyebrow text-text-muted">Interview</p>
        <p className="mt-1 text-xs text-text-muted">
          Answer a few questions, then generate new content grounded in them — nothing here is
          saved
        </p>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto">
        {QUESTION_BANK.map((q, i) => (
          <div key={q}>
            <label className="mb-1 block text-xs text-text-secondary">{q}</label>
            <textarea
              value={answers[i]}
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

      <button
        onClick={generate}
        disabled={!hasAnswer}
        className="w-full rounded-md bg-accent py-2 text-xs font-medium text-accent-contrast disabled:opacity-40"
      >
        Generate from these answers
      </button>
    </aside>
  );
}
