import type { Env } from "../types";
import { ok, fail } from "../http";
import { getFileContent } from "../github";
import { CHAPTERS, CHAPTERS_DIR } from "../chapters";

// GET /api/chapter/:id — live chapter text straight from GitHub, so a reload
// always reflects the latest save (the static-asset copy the site ships is
// only as fresh as the last deploy). Read-only; open to any authenticated
// identity, not just editors — same as reference-data.
//
// Failure here (missing GITHUB_TOKEN, GitHub outage, etc.) is expected and
// non-fatal: the caller falls back to the baked-in static file, which is
// exactly today's behavior. This route only ever makes reads *fresher*, never
// a prerequisite for the site to work.
export async function handleGetChapter(chapterId: string, env: Env): Promise<Response> {
  const chapter = CHAPTERS[chapterId];
  if (!chapter) return fail("unknown chapter", 404);

  try {
    const text = await getFileContent(env, `${CHAPTERS_DIR}/${chapter.file}`);
    if (text === null) return fail("chapter file not found on GitHub", 404);
    return ok({ text });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
