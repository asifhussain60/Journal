import type { Env } from "./types";

// Direct Anthropic Messages API client. Workers can fetch api.anthropic.com
// directly, so the retired Mac-tunnel (journal-api.kashkole.com) is gone.

export const MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicResult {
  text: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export async function callAnthropic(
  env: Env,
  opts: {
    model: string;
    system?: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<AnthropicResult> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: AnthropicResult["usage"];
  };
  const text = (body.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  return { text, usage: body.usage };
}
