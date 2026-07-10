import type { Env, Identity } from "../types";
import { ok, fail, readJson } from "../http";
import { isEditor } from "../auth";
import { getFileSha, putFile } from "../github";
import { CHAPTERS, CHAPTERS_DIR } from "../chapters";

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

  const path = `${CHAPTERS_DIR}/${chapter.file}`;
  const message = `ch: web edit to ${chapter.file}${chapter.locked ? " (unlocked)" : ""}`;

  try {
    const sha = await getFileSha(env, path);
    const result = await putFile(env, path, body.text, message, sha);
    return ok({ commitUrl: result.commitUrl, path });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "conflict") {
      return fail("chapter changed on the server since you loaded it — reload and reapply", 409);
    }
    return fail(err.message, 502);
  }
}
