// Same-origin API + content fetch helper. In production the Cloudflare Worker
// serves both the static chapter files and /api/*; in dev, Vite serves chapters
// and proxies /api/* to `wrangler dev`. credentials:"include" lets the
// Cloudflare Access cookie ride along once auth is wired.

export async function fetchChapterText(file: string): Promise<string> {
  const res = await fetch(`/${file}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load chapter (${res.status})`);
  return res.text();
}

/** Estimated reading minutes at ~230 wpm. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}
