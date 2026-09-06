import type { Env } from "../types";
import { ok, fail, readJson } from "../http";
import { callGemini } from "../gemini";

const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 6 },
  },
  required: ["questions"],
};

const INTERVIEW_VOICE = `You are helping Asif surface concrete missing detail for a specific
scene in his memoir "What I Wish Babu Taught Me" before he writes it. Write 4-6 short qualifying
questions SPECIFIC to the scene below — not generic ("who was there", "how did it feel") unless
that genuinely is the gap, but grounded in what the paragraph already says and doesn't say yet.
Cover a mix of: concrete sensory/physical detail, who else was present and what they did, what he
feared in the moment, what happened immediately before and after, and what it means looking back.
Return ONLY the JSON object — no preamble, no commentary.`;

// POST /api/interview-questions — 4-6 qualifying questions tailored to the
// chapter/paragraph currently loaded, replacing a generic fixed bank so the
// Interview panel actually helps surface detail for THIS scene.
export async function handleInterviewQuestions(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ chapterTitle?: string; paragraphText?: string }>(request);
  const chapterTitle = body?.chapterTitle?.trim();
  const paragraphText = body?.paragraphText?.trim();
  if (!paragraphText) return fail("interview-questions: 'paragraphText' is required");

  const user = `Chapter: ${chapterTitle || "(untitled)"}\n\nCurrent paragraph:\n${paragraphText}`;

  try {
    const { text } = await callGemini(env, {
      system: INTERVIEW_VOICE,
      user,
      temperature: 0.6,
      maxTokens: 512,
      responseMimeType: "application/json",
      responseSchema: QUESTIONS_SCHEMA,
    });
    const parsed = JSON.parse(text) as { questions?: unknown };
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [];
    if (!questions.length) return fail("Gemini returned no questions", 502);
    return ok({ questions });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
