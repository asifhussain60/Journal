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

export interface Me {
  email: string;
  isAdmin: boolean;
}

/**
 * Who is the signed-in user and can they edit? Cloudflare Access has already
 * authenticated them at the edge; the Worker reports the email and whether it
 * matches ALLOWED_EDITORS. Viewers get isAdmin:false.
 */
export async function fetchMe(): Promise<Me> {
  const res = await fetch("/api/me", { credentials: "include" });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; email?: string; isAdmin?: boolean; error?: string }
    | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return { email: data.email ?? "", isAdmin: !!data.isAdmin };
}
