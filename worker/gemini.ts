import type { Env } from "./types";

// Direct Google Gemini (Generative Language) API client. Mirrors the shape of
// worker/anthropic.ts so routes stay provider-agnostic ({ text, usage }).
// Gemini powers the editor's authoring operations (real-time /api/op).

export const GEMINI_MODELS = {
  // Fast, low-latency default for interactive authoring operations.
  flash: "gemini-2.5-flash",
} as const;

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiResult {
  text: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export async function callGemini(
  env: Env,
  opts: {
    model?: string;
    system?: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    // Structured-output mode: when set, Gemini returns strict JSON matching
    // responseSchema instead of free text, so callers don't need to parse
    // fragile freeform output (used for AI-drafted incident fields and
    // AI-generated interview questions).
    responseMimeType?: string;
    responseSchema?: object;
  },
): Promise<GeminiResult> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const model = opts.model || env.GEMINI_MODEL || GEMINI_MODELS.flash;

  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 4096,
        // 2.5 Flash "thinks" by default and can spend the whole output budget on
        // reasoning, returning empty text. These are deterministic rewrites, so
        // disable thinking for a direct, fast answer.
        thinkingConfig: { thinkingBudget: 0 },
        ...(opts.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
        ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const cand = body.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text && cand?.finishReason && cand.finishReason !== "STOP") {
    throw new Error(`Gemini returned no text (finishReason: ${cand.finishReason})`);
  }
  return {
    text,
    usage: body.usageMetadata
      ? {
          input_tokens: body.usageMetadata.promptTokenCount ?? 0,
          output_tokens: body.usageMetadata.candidatesTokenCount ?? 0,
        }
      : undefined,
  };
}

// Voice guard — distilled from content/babu-memoir/_system/voice-fingerprint-light.md.
// SYNC POINT: if the fingerprint's hard rules change, update this constant.
// Prepended to every prose-mutating operation so Gemini never breaks voice.
export const VOICE_GUARD = `You are helping Asif edit his memoir "What I Wish Babu Taught Me".
Asif IS "Babu" — a 54-year-old narrator writing to his children. The arc is always
experience → ownership → wisdom, never accusation → justification → superiority. Pain is
curriculum, not cruelty; the narrator is a student, never a victim. Parents are complex, never
villains.

HARD RULES (never violate):
- No em dashes. No semicolons. No markdown. No emojis.
- Banned words: trauma, toxic, narcissist, boundaries, triggered, journey, growth, healing,
  incredibly, absolutely, literally, and all therapy/self-help/corporate/AI-sounding phrasing.
- Preferred vocabulary DNA: damage, confusion, hunger, brace, currency, grammar, curriculum,
  arsenal, steady.
- Single Urdu/Arabic words are never glossed inline; multi-word phrases may get a short
  parenthetical gloss.
- Paragraphs stay 2 to 4 sentences. Vary sentence openers (not every sentence starts with "I").
  Dry, restrained humor only.

Preserve Asif's meaning and facts exactly. Return ONLY the rewritten prose with no preamble,
labels, quotes, or commentary.`;
