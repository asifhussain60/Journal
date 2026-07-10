import type { Env } from "./types";
import { ok, fail } from "./http";
import { verifyAccess } from "./auth";
import {
  handleRefine,
  handleChat,
  handleVoiceTest,
  handleThemeSwatches,
  handleThemeReview,
} from "./routes/ai";
import { handleReferenceData } from "./routes/referenceData";
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

  // Reference data (GET /api/reference-data/:name)
  const refMatch = pathname.match(/^\/api\/reference-data\/([^/]+)$/);
  if (refMatch) return handleReferenceData(decodeURIComponent(refMatch[1]), env);

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
