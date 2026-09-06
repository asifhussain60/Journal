import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, useScroll, useSpring } from "framer-motion";
import { AppHeader } from "../../components/AppHeader";
import { chapterById, chapterNeighbors } from "../../lib/manifest";
import { fetchChapterText, readingMinutes } from "../../lib/api";
import { parseChapter, isAdviceHeading, type ParsedChapter } from "../../lib/parseChapter";
import { useReaderPrefs, readerStyle, WIDTH_MAXW } from "../../stores/useReaderPrefs";
import { useReaderData } from "../../stores/useReaderData";
import { useScrollSpy } from "../../hooks/useScrollSpy";
import { ReaderToolbar } from "./ReaderToolbar";
import { SectionTOC } from "./SectionTOC";
import { NotesPanel } from "./NotesPanel";

const EMPTY: number[] = [];

function previewWords(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  const w = t.split(" ").slice(0, 6).join(" ");
  return w.length < t.length ? `${w}…` : w;
}

export function ReaderPage() {
  const { chapterId = "" } = useParams();
  const chapter = chapterById(chapterId);
  const { prev, next } = chapterNeighbors(chapterId);

  const [parsed, setParsed] = useState<ParsedChapter | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [currentPara, setCurrentPara] = useState(0);
  const [showResume, setShowResume] = useState(false);

  const prefs = useReaderPrefs();
  const bookmarks = useReaderData((s) => s.bookmarks[chapterId] ?? EMPTY);
  const toggleBookmark = useReaderData((s) => s.toggleBookmark);
  const lastRead = useReaderData((s) => s.lastRead[chapterId] ?? 0);
  const setLastRead = useReaderData((s) => s.setLastRead);

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });

  // Load + parse
  useEffect(() => {
    if (!chapter?.file) {
      setStatus("error");
      return;
    }
    let live = true;
    setStatus("loading");
    fetchChapterText(chapter.id, chapter.file)
      .then((text) => {
        if (!live) return;
        setParsed(parseChapter(text));
        setStatus("ready");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [chapter?.file]);

  // Offer resume once content is ready
  useEffect(() => {
    if (status === "ready" && lastRead > 2) setShowResume(true);
  }, [status, lastRead]);

  // Track the paragraph currently in view (for note anchoring + resume memory)
  useEffect(() => {
    if (status !== "ready") return;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-para]"));
    if (!nodes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) {
          const idx = Number((top.target as HTMLElement).dataset.para);
          setCurrentPara(idx);
          setLastRead(chapterId, idx);
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [status, chapterId, setLastRead]);

  // Section scroll-spy
  const sections = chapter?.sections ?? [];
  const activeSection = useScrollSpy([status, chapterId]);
  const sectionStartMap = useMemo(() => {
    // body-paragraph-index (0-based) -> section ordinal
    const m = new Map<number, number>();
    sections.forEach((s, i) => m.set(s.para - 1, i));
    return m;
  }, [sections]);

  function jumpToPara(paraIdx: number) {
    const el = document.getElementById(`para-${paraIdx}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function jumpToSection(para: number) {
    jumpToPara(para - 1);
  }

  if (!chapter) {
    return (
      <Shell>
        <EmptyState title="Chapter not found" hint="Return to the bookshelf." />
      </Shell>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <motion.div
        style={{ scaleX: progress }}
        className="fixed inset-x-0 top-[73px] z-30 h-[3px] origin-left bg-accent"
      />

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-x-10 px-6 pb-28 pt-8 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_310px]">
        {/* Left: section outline */}
        <div className="hidden lg:block">
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text"
          >
            ← All chapters
          </Link>
          <Link
            to={`/edit/${chapter.id}`}
            className="mb-8 inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            ✎ Edit chapter
          </Link>
          <SectionTOC sections={sections} activeIndex={activeSection} onJump={jumpToSection} />
        </div>

        {/* Center: reading column */}
        <div className="mx-auto w-full" style={{ maxWidth: WIDTH_MAXW[prefs.width] }}>
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <Link to="/" className="text-sm text-text-muted hover:text-text">
              ← All chapters
            </Link>
          </div>

          {/* Sticky reading controls */}
          <div className="sticky top-[84px] z-20 mb-2 flex justify-end">
            <ReaderToolbar />
          </div>

          {showResume && (
            <motion.button
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => {
                jumpToPara(lastRead);
                setShowResume(false);
              }}
              className="mb-6 flex w-full items-center justify-between rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent"
            >
              <span>Resume where you left off · ¶{lastRead + 1}</span>
              <span aria-hidden>↓</span>
            </motion.button>
          )}

          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="border-b border-line pb-8"
          >
            <div className="flex items-center gap-2.5">
              <span className="u-eyebrow text-accent">Chapter {chapter.num}</span>
              {status === "ready" && (
                <>
                  <span className="h-1 w-1 rounded-full bg-text-muted/50" aria-hidden />
                  <span className="text-xs text-text-muted">
                    {readingMinutes(chapter.words)} min read
                  </span>
                </>
              )}
            </div>
            <h1 className="mt-3 font-display text-[2.5rem] font-semibold leading-[1.08] text-text sm:text-5xl">
              {chapter.title}
            </h1>
            <p className="mt-3 font-serif text-xl italic text-text-secondary">{chapter.subtitle}</p>
          </motion.header>

          {status === "loading" && <LoadingBody />}
          {status === "error" && (
            <EmptyState title="Could not load this chapter" hint="Try again, or pick another." />
          )}
          {status === "ready" && parsed && (
            <article className="reader-prose mt-10" style={readerStyle(prefs)}>
              {parsed.paragraphs.map((para, i) => {
                const isAdviceStart = i === parsed.adviceIndex;
                const inAdvice = parsed.adviceIndex >= 0 && i >= parsed.adviceIndex;
                const sectionOrdinal = sectionStartMap.get(i);
                return (
                  <div key={i}>
                    {isAdviceStart && (
                      <div className="my-10 flex items-center gap-3">
                        <span className="h-px flex-1 bg-line" />
                        <span className="font-script text-2xl text-accent">Babu's Advice</span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    )}
                    {!(isAdviceStart && isAdviceHeading(para)) && (
                      <Paragraph
                        idx={i}
                        text={para}
                        accent={inAdvice}
                        bookmarked={bookmarks.includes(i)}
                        onToggleBookmark={() => toggleBookmark(chapterId, i)}
                        spy={sectionOrdinal}
                      />
                    )}
                  </div>
                );
              })}
            </article>
          )}

          <nav className="mt-16 flex items-center justify-between border-t border-line pt-6 text-sm">
            {prev?.file ? (
              <Link to={`/read/${prev.id}`} className="text-text-muted hover:text-text">
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next?.file ? (
              <Link to={`/read/${next.id}`} className="text-text-muted hover:text-text">
                {next.title} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>

        {/* Right: notes */}
        {status === "ready" && (
          <NotesPanel
            chapterId={chapterId}
            currentPara={currentPara}
            previewOf={(p) => previewWords(parsed?.paragraphs[p] ?? "")}
            onJump={jumpToPara}
          />
        )}
      </div>
    </div>
  );
}

function Paragraph({
  idx,
  text,
  accent,
  bookmarked,
  onToggleBookmark,
  spy,
}: {
  idx: number;
  text: string;
  accent?: boolean;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  spy?: number;
}) {
  return (
    <div
      id={`para-${idx}`}
      data-para={idx}
      {...(spy !== undefined ? { "data-spy": spy } : {})}
      className="group relative"
    >
      {/* Bookmark affordance in the gutter */}
      <button
        onClick={onToggleBookmark}
        aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
        className={`absolute -left-7 top-1.5 hidden text-sm transition-opacity lg:block ${
          bookmarked ? "text-accent opacity-100" : "text-text-muted opacity-0 group-hover:opacity-100"
        }`}
      >
        {bookmarked ? "★" : "☆"}
      </button>
      <p
        className={
          accent
            ? "mb-6 border-l-2 border-accent/40 pl-5 text-text-secondary"
            : `mb-6 text-text ${bookmarked ? "bg-accent-soft/40" : ""}`
        }
      >
        {text}
      </p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-3xl px-6 py-20">{children}</div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg-card p-10 text-center">
      <p className="font-display text-xl text-text">{title}</p>
      <p className="mt-2 text-sm text-text-muted">{hint}</p>
      <Link
        to="/"
        className="mt-5 inline-block rounded-pill bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
      >
        Back to bookshelf
      </Link>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="mt-10 space-y-4" aria-busy="true">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-bg-card"
          style={{ width: `${85 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}
