import { useEffect, useState } from "react";

// Observe elements matching `[data-spy]` within a container and report the
// data-spy value of the topmost one currently in view. Used for the section
// TOC and last-read tracking.
export function useScrollSpy(deps: unknown[] = []): number {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-spy]"));
    if (!nodes.length) return;

    const visible = new Map<number, number>(); // index -> intersectionRatio
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.spy);
          if (e.isIntersecting) visible.set(idx, e.intersectionRatio);
          else visible.delete(idx);
        }
        if (visible.size) {
          // topmost in-view element = smallest index among visible
          const top = Math.min(...visible.keys());
          setActive(top);
        }
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: [0, 0.5, 1] },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return active;
}
