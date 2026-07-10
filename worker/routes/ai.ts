import type { Env } from "../types";
import { ok, fail, readJson } from "../http";
import { callAnthropic, MODELS } from "../anthropic";

// AI proxy routes — satisfy the contract the browser client already expects
// (site/js/claude-client.js legacy + the new TS client): /api/refine, /api/chat,
// /api/voice-test, /api/theme-swatches, /api/theme-review. All are gated by a
// valid Access identity (checked in index.ts before dispatch).

const REFINE_SYSTEM = `You refine memoir prose for the book "What I Wish Babu Taught Me".
Preserve the author's voice, meaning, and structure exactly. Improve only clarity, word choice,
grammar, and rhythm. Never restructure, never add or remove ideas, never introduce em dashes or
semicolons. Return ONLY the refined prose with no preamble or commentary.`;

export async function handleRefine(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ text?: string }>(request);
  if (!body?.text?.trim()) return fail("refine: 'text' is required");
  try {
    const { text, usage } = await callAnthropic(env, {
      model: MODELS.sonnet,
      system: REFINE_SYSTEM,
      user: body.text,
      maxTokens: 2048,
      temperature: 0.4,
    });
    return ok({ refined: text, usage });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ prompt?: string; system?: string }>(request);
  if (!body?.prompt?.trim()) return fail("chat: 'prompt' is required");
  try {
    const { text, usage } = await callAnthropic(env, {
      model: MODELS.opus,
      system: body.system,
      user: body.prompt,
      maxTokens: 2048,
    });
    return ok({ reply: text, usage });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}

export async function handleVoiceTest(_request: Request, env: Env): Promise<Response> {
  try {
    const { text } = await callAnthropic(env, {
      model: MODELS.haiku,
      user: 'Reply with exactly: {"voice":"ok"}',
      maxTokens: 64,
    });
    return ok({ result: text });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}

export async function handleThemeSwatches(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ prompt?: string }>(request);
  try {
    const { text, usage } = await callAnthropic(env, {
      model: MODELS.haiku,
      system:
        "You generate cohesive UI color palettes. Return ONLY a JSON array of hex colors, no prose.",
      user: body?.prompt || "Generate a palette of 5 harmonious hex colors for a reading app.",
      maxTokens: 256,
      temperature: 0.7,
    });
    return ok({ swatches: text, usage });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}

export async function handleThemeReview(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ tokens?: unknown }>(request);
  try {
    const { text, usage } = await callAnthropic(env, {
      model: MODELS.sonnet,
      system:
        "You are a design-systems reviewer. Critique the given theme tokens for contrast (WCAG), harmony, and readability. Be concise and specific.",
      user: `Review these theme tokens:\n${JSON.stringify(body?.tokens ?? {}, null, 2)}`,
      maxTokens: 1024,
    });
    return ok({ review: text, usage });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
