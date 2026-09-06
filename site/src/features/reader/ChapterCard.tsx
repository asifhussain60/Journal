import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { type Chapter, spineVars } from "../../lib/manifest";
import { readingMinutes } from "../../lib/api";
import { ReadinessRing } from "./ReadinessRing";

const STATUS_LABEL: Record<Chapter["status"], string> = {
  locked: "Complete",
  active: "In progress",
  planned: "Planned",
};

function StatusPill({ status }: { status: Chapter["status"] }) {
  const tone =
    status === "locked"
      ? "text-success"
      : status === "active"
        ? "text-accent"
        : "text-text-muted";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border border-line px-2.5 py-1 text-[0.68rem] font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ChapterCard({ chapter, index }: { chapter: Chapter; index: number }) {
  const spine = spineVars(chapter.spine);
  const planned = chapter.status === "planned";
  const readingTone = chapter.status === "locked" ? "text-success" : "text-accent";

  const inner = (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.06, 0.5), duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={planned ? undefined : { y: -5 }}
      className={`group relative flex h-full overflow-hidden rounded-xl border border-line bg-bg-card transition-shadow duration-300 ${
        planned ? "opacity-55" : "hover:shadow-2xl hover:shadow-black/20"
      }`}
    >
      {/* Accent hairline revealed on hover */}
      {!planned && (
        <span className="absolute inset-x-0 top-0 z-10 h-0.5 origin-left scale-x-0 bg-accent transition-transform duration-300 group-hover:scale-x-100" />
      )}

      {/* Book spine — gradient from spine bg to its border */}
      <div
        className="relative flex w-[70px] shrink-0 items-center justify-center"
        style={{
          backgroundImage: `linear-gradient(150deg, ${spine.background}, ${spine.borderColor})`,
        }}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/15" />
        <span
          className="font-display text-[1.7rem] font-semibold tracking-tight text-white/95"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {chapter.num}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-semibold text-text transition-colors group-hover:text-accent">
              {chapter.title}
            </h3>
            <p className="mt-1 text-sm leading-snug text-text-muted">{chapter.subtitle}</p>
          </div>
          {chapter.status === "active" && (
            <span className={readingTone}>
              <ReadinessRing value={chapter.readiness} />
            </span>
          )}
          {chapter.status === "locked" && (
            <span className="mt-0.5 text-sm text-text-muted/70" aria-label="Complete" title="Complete">
              ✦
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <StatusPill status={chapter.status} />
          {!planned && (
            <span className="text-xs tabular-nums text-text-muted">
              {chapter.words.toLocaleString()} words · {readingMinutes(chapter.words)} min
            </span>
          )}
        </div>
      </div>
    </motion.article>
  );

  if (planned) return <div className="cursor-default">{inner}</div>;
  return (
    <Link to={`/read/${chapter.id}`} className="block h-full focus-visible:outline-none">
      {inner}
    </Link>
  );
}
