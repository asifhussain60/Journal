import { useMemo } from "react";
import { diffWords } from "diff";
import { motion } from "framer-motion";

// Word-level diff of a proposed rewrite vs the original, with Accept / Reject.
// Ported from the legacy voice-refiner.jsx DiffPane.
export function DiffView({
  before,
  after,
  op,
  loading,
  error,
  onAccept,
  onReject,
}: {
  before: string;
  after: string;
  op: string;
  loading: boolean;
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const parts = useMemo(
    () => (before && after ? diffWords(before, after) : []),
    [before, after],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-line bg-bg-2 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="u-eyebrow text-accent">{op}</span>
        {loading && <span className="text-xs text-text-muted">Gemini is working…</span>}
      </div>

      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-3.5 animate-pulse rounded bg-bg-card"
              style={{ width: `${90 - i * 15}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto font-serif text-[0.95rem] leading-relaxed">
          {parts.map((p, i) => (
            <span
              key={i}
              className={
                p.added
                  ? "rounded bg-success/20 text-success"
                  : p.removed
                    ? "rounded bg-error/15 text-error line-through opacity-70"
                    : "text-text"
              }
            >
              {p.value}
            </span>
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={onAccept}
            className="flex-1 rounded-md bg-accent py-2 text-sm font-medium text-accent-contrast"
          >
            Accept
          </button>
          <button
            onClick={onReject}
            className="flex-1 rounded-md border border-line py-2 text-sm text-text-secondary hover:bg-bg-card-hover"
          >
            Reject
          </button>
        </div>
      )}
      {(loading || error) && (
        <button
          onClick={onReject}
          className="mt-4 w-full rounded-md border border-line py-2 text-sm text-text-secondary hover:bg-bg-card-hover"
        >
          {error ? "Dismiss" : "Cancel"}
        </button>
      )}
    </motion.div>
  );
}
