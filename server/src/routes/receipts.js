// routes/receipts.js — receipt image pipeline.
//   POST /api/upload           — multipart image → trips/{slug}/receipts/
//   POST /api/extract-receipt  — macOS Vision first, Haiku vision fallback

import express from "express";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadPrompt } from "../prompts/index.js";
import {
  TRIPS_DIR,
  getActiveTripSlug,
  sniffImageExt,
  extToMediaType,
  macVisionOcr,
} from "../receipts.js";
import { extractJsonObject } from "../util/json.js";

export function createReceiptsRouter({ anthropic, DEFAULT_MODEL, upload }) {
  const router = express.Router();

  // POST /api/upload — multipart image upload. Sniffs MIME, writes to
  // trips/{activeSlug}/receipts/{uuid}.{ext}. Returns relative imagePath.
  router.post("/api/upload", (req, res, next) => {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        return res.status(status).json({ ok: false, error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "file field is required" });
      }
      const sniffedExt = sniffImageExt(req.file.buffer);
      if (!sniffedExt) {
        return res.status(400).json({ ok: false, error: "uploaded bytes are not a recognized image" });
      }
      try {
        const slug = await getActiveTripSlug();
        const id = randomUUID();
        const receiptsDir = path.join(TRIPS_DIR, slug, "receipts");
        await mkdir(receiptsDir, { recursive: true });
        const absPath = path.join(receiptsDir, `${id}.${sniffedExt}`);
        await writeFile(absPath, req.file.buffer);
        const imagePath = `trips/${slug}/receipts/${id}.${sniffedExt}`;
        res.json({ ok: true, id, imagePath, bytes: req.file.buffer.length, ext: sniffedExt });
      } catch (e) {
        res.status(500).json({ ok: false, error: e?.message ?? String(e) });
      }
    });
  });

  // POST /api/extract-receipt — { imagePath } → { extracted, visionUsed }.
  // Tries macOS Vision OCR first; falls back to Haiku vision when unavailable
  // or when Vision returned no text. res.locals.visionUsed feeds usage-logger.
  router.post("/api/extract-receipt", async (req, res) => {
    const { imagePath } = req.body ?? {};
    if (typeof imagePath !== "string" || !imagePath.length) {
      return res.status(400).json({ ok: false, error: "imagePath is required" });
    }
    const rel = imagePath.replace(/^[./\\]+/, "");
    if (!rel.startsWith("trips/")) {
      return res.status(400).json({ ok: false, error: "imagePath must be under trips/" });
    }
    const absPath = path.resolve(TRIPS_DIR, rel.replace(/^trips\//, ""));
    if (!absPath.startsWith(TRIPS_DIR + path.sep)) {
      return res.status(400).json({ ok: false, error: "imagePath escapes trips/" });
    }

    req.body.promptName = "extract-receipt";
    try {
      const prompt = loadPrompt("extract-receipt");
      const buf = await readFile(absPath);
      const ext = sniffImageExt(buf);
      if (!ext) return res.status(400).json({ ok: false, error: "file is not a recognized image" });

      const ocrText = await macVisionOcr(absPath);
      const visionUsed = typeof ocrText === "string" && ocrText.trim().length > 0;
      res.locals.visionUsed = visionUsed;

      const userContent = visionUsed
        ? [
            {
              type: "text",
              text: `OCR output (macOS Vision):\n\n${ocrText.trim()}\n\nReturn the JSON object now.`,
            },
          ]
        : [
            {
              type: "image",
              source: { type: "base64", media_type: extToMediaType(ext), data: buf.toString("base64") },
            },
            { type: "text", text: "Extract receipt fields from this image. Return the JSON object now." },
          ];

      const msg = await anthropic.messages.create({
        model: prompt.model ?? DEFAULT_MODEL,
        max_tokens: 600,
        system: prompt.system,
        messages: [{ role: "user", content: userContent }],
      });
      const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      const extracted = extractJsonObject(raw);
      res.json({
        ok: true,
        model: msg.model,
        usage: msg.usage,
        promptName: prompt.name,
        visionUsed,
        extracted,
        rawText: extracted ? undefined : raw,
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
