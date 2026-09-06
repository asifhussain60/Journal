import type { Env } from "../types";
import { ok, fail, readJson } from "../http";
import { callGemini, VOICE_GUARD } from "../gemini";

// POST /api/op — the single endpoint powering the editor's authoring operations.
// Each prose verb maps to an instruction appended to the VOICE_GUARD system
// prompt; Gemini returns the rewritten prose. `cut` is client-side (no AI) and
// is rejected here. Annotation ops (note, tags) never reach the Worker.

type Op = "refine" | "expand" | "replace" | "rephrase" | "split" | "merge";

const OP_INSTRUCTIONS: Record<Op, string> = {
  refine:
    "Sharpen this passage. Improve word choice, grammar, and rhythm only. Do not restructure, add, or remove ideas. Keep the same number of paragraphs.",
  expand:
    "Flesh this out. Add concrete detail and slow the pacing where it earns it, staying in the same scene and voice. Do not invent facts Asif has not implied.",
  replace:
    "Replace weak or repeated wording with stronger, more precise words. Change as little as possible; keep the sentence shapes.",
  rephrase:
    "Offer the single strongest rephrasing of this passage. Same meaning, better cadence. Return only the rewritten passage.",
  split:
    "Break this into two or more shorter paragraphs at the natural beats. Do not change any wording. Separate paragraphs with a blank line.",
  merge:
    "Combine these paragraphs into one coherent paragraph. Preserve every sentence; only adjust connective flow if strictly necessary.",
};

const OP_TEMPS: Partial<Record<Op, number>> = {
  refine: 0.3,
  replace: 0.3,
  rephrase: 0.5,
  expand: 0.6,
  split: 0.1,
  merge: 0.1,
};

function isOp(v: unknown): v is Op {
  return typeof v === "string" && v in OP_INSTRUCTIONS;
}

export async function handleOp(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ op?: string; text?: string; hint?: string; policies?: string[] }>(
    request,
  );
  if (!body?.text?.trim()) return fail("op: 'text' is required");
  if (!isOp(body.op)) return fail(`op: unknown operation '${body.op}'`);

  const instruction = OP_INSTRUCTIONS[body.op];
  const hint = body.hint?.trim() ? `\n\nAdditional direction from Asif: ${body.hint.trim()}` : "";
  const policies =
    Array.isArray(body.policies) && body.policies.length
      ? `\n\nSERIES STYLE POLICIES (apply all):\n${body.policies.map((p) => `- ${p}`).join("\n")}`
      : "";
  const system = `${VOICE_GUARD}\n\nTASK: ${instruction}${hint}${policies}`;

  try {
    const { text, usage } = await callGemini(env, {
      system,
      user: body.text,
      temperature: OP_TEMPS[body.op] ?? 0.4,
      maxTokens: 2048,
    });
    if (!text) return fail("Gemini returned no text", 502);
    return ok({ op: body.op, result: text, usage });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
