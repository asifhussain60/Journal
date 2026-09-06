// Map positions in the raw chapter buffer to blank-line-delimited paragraph
// blocks and their exact character ranges — so an operation replaces precisely
// the target paragraph. Mirrors the split-on-blank-lines rule used by
// parseChapter / the Python delta pipeline.

export interface ParaBlock {
  index: number; // 0-based index among non-blank blocks
  from: number; // char offset (inclusive)
  to: number; // char offset (exclusive)
  text: string;
}

export function paragraphBlocks(doc: string): ParaBlock[] {
  const blocks: ParaBlock[] = [];
  let i = 0;
  let start = -1;
  const n = doc.length;
  let index = 0;

  // Walk line by line, tracking char offsets.
  while (i <= n) {
    const nl = doc.indexOf("\n", i);
    const lineEnd = nl === -1 ? n : nl;
    const line = doc.slice(i, lineEnd);
    const blank = line.trim() === "";

    if (!blank && start === -1) {
      start = i; // block begins
    }
    if (blank && start !== -1) {
      // block ends at the previous non-blank char (trim trailing newline)
      const end = trimEnd(doc, i);
      blocks.push({ index: index++, from: start, to: end, text: doc.slice(start, end) });
      start = -1;
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  if (start !== -1) {
    const end = trimEnd(doc, n);
    blocks.push({ index: index++, from: start, to: end, text: doc.slice(start, end) });
  }
  return blocks;
}

function trimEnd(doc: string, pos: number): number {
  let end = pos;
  while (end > 0 && /\s/.test(doc[end - 1])) end--;
  return end;
}

/** The paragraph block containing `pos` (or the nearest preceding one). */
export function blockAt(doc: string, pos: number): ParaBlock | null {
  const blocks = paragraphBlocks(doc);
  if (!blocks.length) return null;
  for (const b of blocks) {
    if (pos >= b.from && pos <= b.to) return b;
  }
  // cursor in whitespace between blocks — pick the last block that starts before pos
  let chosen: ParaBlock | null = null;
  for (const b of blocks) {
    if (b.from <= pos) chosen = b;
  }
  return chosen ?? blocks[0];
}

/** The block after `block`, for merge. */
export function nextBlock(doc: string, block: ParaBlock): ParaBlock | null {
  const blocks = paragraphBlocks(doc);
  return blocks.find((b) => b.index === block.index + 1) ?? null;
}
