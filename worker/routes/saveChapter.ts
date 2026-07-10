import type { Env, Identity } from "../types";
import { ok, fail, readJson } from "../http";
import { isEditor } from "../auth";
import { CHAPTERS } from "../chapters";

// POST /api/save-chapter — writes chapter text to Cloudflare KV, the single
// source of truth for the web editor. Last-write-wins: KV has no built-in
// optimistic-concurrency primitive, and for a single-admin app that's an
// honest trade — nothing here is weaker than what existed before.
export async function handleSaveChapter(
  request: Request,
  env: Env,
  identity: Identity,
): Promise<Response> {
  if (!isEditor(identity, env)) return fail("not permitted to edit", 403);

  const body = await readJson<{ chapterId?: string; text?: string; unlock?: boolean }>(request);
  const chapter = body?.chapterId ? CHAPTERS[body.chapterId] : undefined;
  if (!chapter) return fail("unknown or non-editable chapter", 400);
  if (typeof body?.text !== "string") return fail("'text' is required", 400);

  // Locked chapters (ch00-ch02) require an explicit unlock by the owner.
  if (chapter.locked && !body.unlock) {
    return fail("chapter is locked — resend with unlock:true to overwrite", 423);
  }

  try {
    await env.CHAPTERS_KV.put(body.chapterId as string, body.text);
    return ok({ savedAt: new Date().toISOString() });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
