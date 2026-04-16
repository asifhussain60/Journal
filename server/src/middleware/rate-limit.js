// middleware/rate-limit.js \u2014 per-IP per-endpoint rate limiter (Phase 1, \u00a75.8 + \u00a79.1.5).
//
// Policy (DOR-locked 2026-04-16):
//   - 20 requests per 60 seconds, per IP, per endpoint path.
//   - /health is exempt so local ops tooling and harass bootstrapping don't trip.
//   - Window is rolling (express-rate-limit default: fixed window).
//   - 429 response is JSON shaped { ok: false, error }. Matches the rest of the
//     proxy's response shape.
//
// Wired in server/src/index.js via the factory below; the middleware is applied
// globally so every non-health route shares the same budget bucket.

import rateLimit from "express-rate-limit";

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 20;

/**
 * Build a ready-to-mount rate-limit middleware.
 *
 * key: per IP + per endpoint path so `/api/refine` and `/api/chat` are independent
 * buckets, matching \u00a75.8 ("per endpoint").
 */
export function buildRateLimiter() {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/health",
    keyGenerator: (req) => `${req.ip}|${req.path}`,
    handler: (req, res) => {
      res.status(429).json({
        ok: false,
        error: `rate limit: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s per endpoint exceeded`,
        endpoint: req.path,
        retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
      });
    },
  });
}
