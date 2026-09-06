// Chapter parsing — an EXACT mirror of the canonical Python
// `split_paragraphs()` in scripts/memoir/detect_user_delta.py (lines 52-65),
// which the local delta pipeline uses. Split on blank lines (a line is blank
// when it trims to ''), flushing accumulated non-blank lines joined by '\n'.
// Internal single newlines within a paragraph are preserved; runs of blank
// lines collapse to a single separator.
//
// IMPORTANT: this drives ONLY the reader/preview render and section detection.
// It is NEVER used on the editor save path — the editor commits the raw buffer
// bytes verbatim, because blank-run count and trailing-newline variance are not
// reconstructable from the parsed form (and the real chapter files have
// inconsistent trailing newlines).

export function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      if (current.length) {
        paragraphs.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length) paragraphs.push(current.join("\n"));
  return paragraphs;
}

// Advice-heading detection — ported verbatim from the legacy reader
// (site/index.html isAdviceHeading). Matches the father's closing monologue.
const ADVICE_RE = /^(Babu['''’]s Advice|Dad['''’]s Advice|What I Wish)/i;

export function isAdviceHeading(text: string): boolean {
  return ADVICE_RE.test(text.trim());
}

export interface ParsedChapter {
  /** First paragraph — the chapter's title/opening line. */
  title: string;
  /** Body paragraphs (everything after the title). */
  paragraphs: string[];
  /** Index into `paragraphs` where the "Babu's Advice" section starts, or -1. */
  adviceIndex: number;
}

export function parseChapter(text: string): ParsedChapter {
  const all = splitParagraphs(text);
  const title = all.length ? all[0] : "";
  const paragraphs = all.slice(1);
  const adviceIndex = paragraphs.findIndex((p) => isAdviceHeading(p));
  return { title, paragraphs, adviceIndex };
}

// Preview/test-only inverse. NOT used on save. Reconstructs a canonical
// single-blank-line-separated form; will NOT byte-match files that use
// multiple blank lines or differ in trailing newline (by design — saves send
// the raw buffer, so this mismatch never reaches git).
export function serializeChapter(title: string, paragraphs: string[]): string {
  return [title, ...paragraphs].join("\n\n");
}

/** Approximate word count for a chapter body (whitespace-split). */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
