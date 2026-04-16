// middleware/usage-logger.js \u2014 passive token-usage logger (Phase 1, \u00a79.1.2).
//
// Appends one JSONL row to server/logs/usage.jsonl after every request, with the
// shape locked in \u00a79.2 acceptance #2:
//
//   { timestamp, endpoint, method, model, promptName, tokensIn, tokensOut,
//     durationMs, statusCode, visionUsed }
//
// The middleware is non-intrusive:
//   - It never mutates the response body.
//   - It observes res.json / res.send / res.end to sniff Anthropic `usage` blocks
//     (tokensIn, tokensOut) from /api/refine, /api/chat, /api/voice-test responses.
//   - Non-model endpoints (/health) emit rows with tokensIn=0, tokensOut=0, model=null.
//   - promptName is read from req.body.promptName when present; else null.
//   - visionUsed is read from res.locals.visionUsed (future receipt pipeline sets it).
//
// File writes are append-only with a single line per row, best-effort (errors are
// logged to stderr, never surface to the client).

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// server/src/middleware -> server/src -> server -> server/logs/
const LOG_PATH = path.resolve(__dirname, "../../logs/usage.jsonl");

async function ensureLogDir() {
  try {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
  } catch {
    // mkdir is idempotent with recursive:true; ignore
  }
}

function extractUsageFromBody(body) {
  if (!body || typeof body !== "object") return { tokensIn: 0, tokensOut: 0, model: null };
  const u = body.usage;
  if (u && typeof u === "object") {
    const tokensIn = Number(u.input_tokens ?? 0) || 0;
    const tokensOut = Number(u.output_tokens ?? 0) || 0;
    const model = typeof body.model === "string" ? body.model : null;
    return { tokensIn, tokensOut, model };
  }
  const model = typeof body.model === "string" ? body.model : null;
  return { tokensIn: 0, tokensOut: 0, model };
}

/**
 * Express middleware factory. Wraps the response so the row is written once per
 * request, immediately after the response has been sent. Safe to install globally.
 */
export function usageLogger() {
  return function usageLoggerMiddleware(req, res, next) {
    const startedAt = Date.now();
    let capturedBody = null;

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      capturedBody = body;
      return originalJson(body);
    };

    res.on("finish", async () => {
      const { tokensIn, tokensOut, model } = extractUsageFromBody(capturedBody);
      const promptName =
        req.body && typeof req.body === "object" && typeof req.body.promptName === "string"
          ? req.body.promptName
          : null;

      const row = {
        timestamp: new Date().toISOString(),
        endpoint: req.originalUrl.split("?")[0],
        method: req.method,
        model,
        promptName,
        tokensIn,
        tokensOut,
        durationMs: Date.now() - startedAt,
        statusCode: res.statusCode,
        visionUsed: Boolean(res.locals?.visionUsed) || false,
      };

      try {
        await ensureLogDir();
        await appendFile(LOG_PATH, `${JSON.stringify(row)}\n`, "utf8");
      } catch (err) {
        process.stderr.write(`[usage-logger] append failed: ${err.message}\n`);
      }

      // Phase 9 Stage B: best-effort shadow-write to ops.db.usage. No-op when
      // SHADOW_WRITE_ENABLED is false; errors never break the request.
      try {
        const { shadow } = await import("../middleware/shadow-write.js");
        shadow("usage", row);
      } catch {
        // Shadow import failures are logged by shadow-write itself.
      }
    });

    next();
  };
}

export const USAGE_LOG_PATH = LOG_PATH;
