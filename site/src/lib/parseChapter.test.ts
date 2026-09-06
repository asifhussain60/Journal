import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitParagraphs, parseChapter, isAdviceHeading } from "./parseChapter";

const here = dirname(fileURLToPath(import.meta.url));
const chaptersDir = join(here, "../../public/chapters");

describe("splitParagraphs (mirror of Python split_paragraphs)", () => {
  it("collapses blank-line runs and preserves internal newlines", () => {
    const text = "a\nb\n\n\nc\n\nd";
    // "a\nb" is one paragraph (internal newline kept); blank runs separate.
    expect(splitParagraphs(text)).toEqual(["a\nb", "c", "d"]);
  });

  it("treats lines that trim to empty as blank separators", () => {
    expect(splitParagraphs("x\n   \ny")).toEqual(["x", "y"]);
  });

  it("ignores leading/trailing blank lines without emitting empties", () => {
    expect(splitParagraphs("\n\nhello\n\n")).toEqual(["hello"]);
    expect(splitParagraphs("").length).toBe(0);
  });
});

describe("isAdviceHeading", () => {
  it("matches Babu's Advice and What I Wish openings", () => {
    expect(isAdviceHeading("Babu's Advice on Love")).toBe(true);
    expect(isAdviceHeading("What I Wish I Had Known")).toBe(true);
    expect(isAdviceHeading("A regular paragraph.")).toBe(false);
  });
});

describe("real chapter files parse without producing empty paragraphs", () => {
  const files = readdirSync(chaptersDir).filter((f) => f.endsWith(".txt"));
  it("has chapter files to test", () => expect(files.length).toBeGreaterThan(0));

  for (const f of files) {
    it(`${f}: title present, no empty body paragraphs`, () => {
      const text = readFileSync(join(chaptersDir, f), "utf8");
      const parsed = parseChapter(text);
      expect(parsed.title.trim().length).toBeGreaterThan(0);
      expect(parsed.paragraphs.every((p) => p.trim().length > 0)).toBe(true);
    });
  }
});
