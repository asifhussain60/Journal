import type { Env } from "./types";
import { ok, fail } from "./http";
import { verifyAccess, isEditor } from "./auth";
import {
  handleRefine,
  handleChat,
  handleVoiceTest,
  handleThemeSwatches,
  handleThemeReview,
} from "./routes/ai";
import { handleReferenceData } from "./routes/referenceData";
import { handleGetChapter } from "./routes/chapter";
import { handleOp } from "./routes/ops";
import { handleSaveChapter } from "./routes/saveChapter";

// Single Cloudflare Worker: serves the Vite build (ASSETS binding, SPA fallback)
// and handles /health + /api/*. Cloudflare Access gates the whole zone at the
// edge; every /api/* call is additionally verified against the Access JWT here.

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/health") {
      return ok({ service: "journal", ts: null });
    }

    if (pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    // Everything else → static assets (SPA fallback handled by the assets binding).
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const identity = await verifyAccess(request, env);
  if (!identity) return fail("unauthorized", 401);

  const { pathname } = url;
  const post = request.method === "POST";
  const admin = isEditor(identity, env);

  // Identity/role probe — any authenticated user may ask "who am I, what can I do".
  // The SPA uses this to decide whether to show the editing rail (admin) or a
  // read-only view (viewer).
  if (pathname === "/api/me") return ok({ email: identity.email, isAdmin: admin });

  // Reference data (GET /api/reference-data/:name) — read-only, viewers allowed.
  const refMatch = pathname.match(/^\/api\/reference-data\/([^/]+)$/);
  if (refMatch) return handleReferenceData(decodeURIComponent(refMatch[1]), env);

  // Live chapter text (GET /api/chapter/:id) — read-only, viewers allowed. Best
  // effort: the frontend falls back to the static-asset copy on any failure.
  const chapterMatch = pathname.match(/^\/api\/chapter\/([^/]+)$/);
  if (chapterMatch && request.method === "GET") {
    return handleGetChapter(decodeURIComponent(chapterMatch[1]), env);
  }

  // Everything below either mutates content (git) or spends model budget. Hiding
  // the UI is not enough — a viewer must not be able to call these directly.
  if (!admin) return fail("viewer role is read-only", 403);

  switch (pathname) {
    case "/api/refine":
      return post ? handleRefine(request, env) : fail("method not allowed", 405);
    case "/api/chat":
      return post ? handleChat(request, env) : fail("method not allowed", 405);
    case "/api/voice-test":
      return post ? handleVoiceTest(request, env) : fail("method not allowed", 405);
    case "/api/theme-swatches":
      return post ? handleThemeSwatches(request, env) : fail("method not allowed", 405);
    case "/api/theme-review":
      return post ? handleThemeReview(request, env) : fail("method not allowed", 405);
    case "/api/op":
      return post ? handleOp(request, env) : fail("method not allowed", 405);
    case "/api/save-chapter":
      return post ? handleSaveChapter(request, env, identity) : fail("method not allowed", 405);
    default:
      return fail("not found", 404);
  }
}
