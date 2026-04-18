// classify-queue.js — Phase 11b in-process queue for async image classify.
//
// Lifecycle:
//   1. POST /api/log/capture lands an image with kind='unsorted-image' and
//      enqueues a job here.
//   2. Worker pops the job, reads the image, calls the classify-image-kind
//      prompt (Haiku), and PATCHes the row's kind to 'photo' or 'receipt'.
//   3. On any failure (network, parse, file moved), the row stays at
//      'unsorted-image' — reviewer firms it via the kind toggle on the card.
//
// Not persisted across server restarts. If the server dies mid-classify,
// the row sits at 'unsorted-image' until the reviewer flips it manually
// or until a future re-enqueue mechanism (out of scope).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadPrompt } from "../prompts/index.js";
import { atomicWriteJSON, readQueue, sniffImageExt, extToMediaType, REPO_ROOT, TRIPS_DIR } from "./receipts.js";

const MAX_BYTES = 4 * 1024 * 1024;

export function createClassifyQueue({ anthropic }) {
  const queue = [];
  let running = false;

  function enqueue(job) {
    queue.push(job);
    pump().catch(err => console.error("[classify-queue] pump crashed", err));
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        try {
          await runJob(job);
        } catch (err) {
          console.error("[classify-queue] job failed", { id: job?.id, error: err?.message ?? String(err) });
        }
      }
    } finally {
      running = false;
    }
  }

  async function runJob({ slug, id, imagePath }) {
    if (!anthropic) return;
    if (!slug || !id || !imagePath) return;

    const abs = path.resolve(REPO_ROOT, imagePath);
    if (!abs.startsWith(REPO_ROOT + path.sep)) return;

    const buf = await readFile(abs).catch(() => null);
    if (!buf || buf.length > MAX_BYTES) return;

    const ext = sniffImageExt(buf);
    if (!ext) return;
    const mediaType = extToMediaType(ext);

    const prompt = loadPrompt("classify-image-kind");
    const msg = await anthropic.messages.create({
      model: prompt.model,
      max_tokens: 200,
      system: prompt.system,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } },
          { type: "text", text: "Classify this image." },
        ],
      }],
    });

    const raw = msg.content.map(b => b.type === "text" ? b.text : "").join("").trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (parsed.kind !== "photo" && parsed.kind !== "receipt") return;

    const items = await readQueue(slug, "pending");
    const idx = items.findIndex(r => r?.id === id);
    if (idx === -1) return;
    const row = items[idx];
    // Only firm an unsorted-image. If a reviewer already flipped via PATCH,
    // honor their choice over the classifier.
    if (row.kind !== "unsorted-image") return;
    row.kind = parsed.kind;
    if (typeof parsed.confidence === "number") {
      row.classifyConfidence = parsed.confidence;
    }
    row.updatedAt = new Date().toISOString();
    items[idx] = row;
    const filePath = path.join(TRIPS_DIR, slug, "pending.json");
    await atomicWriteJSON(filePath, items);
  }

  return { enqueue };
}
