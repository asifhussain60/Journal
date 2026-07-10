import { motion } from "framer-motion";
import { AppHeader } from "../components/AppHeader";
import { ChapterCard } from "../features/reader/ChapterCard";
import { chapters, manifest } from "../lib/manifest";

export function HomePage() {
  const written = chapters.filter((c) => c.file).length;
  const totalWords = chapters.reduce((n, c) => n + c.words, 0);

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24">
        {/* Hero */}
        <section className="py-12 sm:py-16">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="u-eyebrow text-accent"
          >
            A memoir in chapters
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 w-full font-display text-4xl font-semibold leading-[1.05] text-text sm:text-5xl lg:text-6xl"
          >
            {manifest.title}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="mt-5 w-full text-lg leading-relaxed text-text-secondary sm:text-xl"
          >
            Letters from a father to his children — on manhood, love, marriage, and the lessons paid
            for in full. Written late, offered now, so they need not learn everything the hard way.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-muted"
          >
            <span>
              <span className="font-semibold text-text">{written}</span> chapters written
            </span>
            <span className="h-3 w-px bg-line" aria-hidden />
            <span>
              <span className="font-semibold text-text">{totalWords.toLocaleString()}</span> words
            </span>
            <span className="h-3 w-px bg-line" aria-hidden />
            <span>
              <span className="font-semibold text-text">{chapters.length}</span> chapters planned
            </span>
          </motion.div>
        </section>

        {/* Bookshelf */}
        <section>
          <div className="mb-5 flex items-baseline gap-3">
            <h2 className="u-eyebrow text-text-muted">The Bookshelf</h2>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
            {chapters.map((c, i) => (
              <ChapterCard key={c.id} chapter={c} index={i} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
