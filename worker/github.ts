import type { Env } from "./types";

// Minimal GitHub Contents API helper — get current file SHA, then PUT new
// base64 content as a normal fast-forward commit on the configured branch.

const API = "https://api.github.com";

interface ContentsResponse {
  sha: string;
}

function ghHeaders(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "user-agent": "journal-worker",
    "x-github-api-version": "2022-11-28",
  };
}

function base64Utf8(text: string): string {
  // btoa needs binary; encode UTF-8 first so non-ASCII prose survives.
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Current blob SHA for a path on the branch, or null if the file is absent. */
export async function getFileSha(env: Env, path: string): Promise<string | null> {
  const url = `${API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIComponent(
    path,
  ).replace(/%2F/g, "/")}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as ContentsResponse;
  return body.sha;
}

export interface CommitResult {
  ok: true;
  commitUrl: string;
}

/** Commit `text` to `path`. Throws {code:"conflict"} on a stale-SHA 409. */
export async function putFile(
  env: Env,
  path: string,
  text: string,
  message: string,
  sha: string | null,
): Promise<CommitResult> {
  const url = `${API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIComponent(
    path,
  ).replace(/%2F/g, "/")}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      message,
      content: base64Utf8(text),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409) {
    const e = new Error("file changed since load (SHA conflict)") as Error & { code?: string };
    e.code = "conflict";
    throw e;
  }
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { commit?: { html_url?: string } };
  return { ok: true, commitUrl: body.commit?.html_url ?? "" };
}
