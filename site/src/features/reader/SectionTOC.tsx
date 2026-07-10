import { motion } from "framer-motion";
import type { ChapterSection } from "../../lib/manifest";

// Floating section outline with an animated active indicator (scroll-spy driven
// by the caller). Hidden on narrow screens.
export function SectionTOC({
  sections,
  activeIndex,
  onJump,
}: {
  sections: ChapterSection[];
  activeIndex: number;
  onJump: (para: number) => void;
}) {
  if (!sections.length) return null;
  return (
    <nav aria-label="Sections" className="sticky top-28 hidden max-h-[70vh] overflow-y-auto lg:block">
      <p className="u-eyebrow mb-3 text-text-muted">In this chapter</p>
      <ul className="space-y-1">
        {sections.map((s, i) => {
          const active = i === activeIndex;
          return (
            <li key={s.para} className="relative">
              {active && (
                <motion.span
                  layoutId="toc-active"
                  className="absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <button
                onClick={() => onJump(s.para)}
                className={`block w-full text-left text-sm leading-snug transition-colors ${
                  active ? "text-accent" : "text-text-muted hover:text-text"
                }`}
              >
                {s.title}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
