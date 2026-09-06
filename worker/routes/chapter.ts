import type { Env } from "../types";
import { ok, fail } from "../http";
import { CHAPTERS } from "../chapters";

// GET /api/chapter/:id — the current chapter text from Cloudflare KV, the
// single source of truth for saves made through the web editor. The
// static-asset copy the site ships (baked in at build time from the git repo)
// is only as fresh as the last deploy, so it's used as a fallback on the
// client when this route is unavailable — never a hard requirement.
// Read-only; open to any authenticated identity, not just editors — same as
// reference-data.
export async function handleGetChapter(chapterId: string, env: Env): Promise<Response> {
  const chapter = CHAPTERS[chapterId];
  if (!chapter) return fail("unknown chapter", 404);

  try {
    const text = await env.CHAPTERS_KV.get(chapterId);
    if (text === null) return fail("chapter not yet saved to KV", 404);
    return ok({ text });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
