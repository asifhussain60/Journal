// gemini-client.js — thin wrapper around @google/genai for venue verification.
//
// Role in the app: Anthropic owns reasoning; Gemini owns Google-grounded
// research. This module exposes ONE capability — verifyVenue() — which asks
// Gemini Flash to look up a named venue via the Google Search tool and return
// canonical phone, address, and rating. The response is used to corroborate
// (or reject) alternatives that Sonnet proposed.
//
// Graceful degradation: if the Gemini key is missing, isAvailable() returns
// false and every caller short-circuits instead of throwing.

import { GoogleGenAI } from "@google/genai";
import { loadGeminiKey } from "./keychain.js";

const { key: GEMINI_KEY, source: GEMINI_SOURCE } = loadGeminiKey();
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

let client = null;
if (GEMINI_KEY) {
  client = new GoogleGenAI({ apiKey: GEMINI_KEY });
}

export function isAvailable() {
  return client !== null;
}

export function status() {
  return {
    enabled: isAvailable(),
    model: isAvailable() ? MODEL : null,
    keySource: GEMINI_SOURCE || null,
  };
}

// Prompt template tuned for a single, deterministic lookup. Gemini tends to
// follow "JSON only" instructions reliably when the schema is small and the
// preceding prose is minimal.
const VERIFY_SYSTEM = [
  "You verify real-world venue details using Google Search.",
  "Given a venue name and (optionally) a hint address, look it up via Google Search and return its current canonical details.",
  "",
  "Output a SINGLE JSON object — no prose, no markdown fences, no preamble:",
  "{",
  '  "found":    boolean,              // true if Google Search confirms the venue exists',
  '  "name":     string | null,        // canonical name from Google',
  '  "venue":    string | null,        // full street address, US format',
  '  "phone":    string | null,        // "(xxx) xxx-xxxx"',
  '  "rating":   number | null,        // Google rating, 1.0-5.0',
  '  "mapsUrl":  string | null         // https://www.google.com/maps/... link when available',
  "}",
  "",
  "Rules:",
  "- Return null for any field you cannot verify from search results. Never fabricate.",
  "- If multiple branches match, prefer the one nearest the hint address; otherwise return found=false.",
  "- If the venue is permanently closed or the phone is disconnected, set found=false.",
].join("\n");

function stripJsonCandidate(text) {
  if (typeof text !== "string") return null;
  const stripped = text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first < 0 || last < first) return null;
  try {
    return JSON.parse(stripped.slice(first, last + 1));
  } catch {
    return null;
  }
}

/**
 * Verify a named venue against Google Search.
 * @param {{ name: string, address?: string, nearTo?: string }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   found?: boolean,
 *   verified?: { name, venue, phone, rating, mapsUrl },
 *   sources?: Array<{ title: string, uri: string }>,
 *   error?: string,
 *   rawText?: string
 * }>}
 */
export async function verifyVenue({ name, address, nearTo } = {}) {
  if (!isAvailable()) {
    return { ok: false, error: "Gemini not configured" };
  }
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "name is required" };
  }
  const hintParts = [];
  if (address) hintParts.push(`Address hint: ${address}`);
  if (nearTo) hintParts.push(`Near: ${nearTo}`);
  const prompt = `Venue: ${name}\n${hintParts.join("\n")}\n\nReturn the JSON object now.`;

  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: VERIFY_SYSTEM,
        tools: [{ googleSearch: {} }],
        // Lower temperature — this is a lookup, not a creative task.
        temperature: 0.1,
      },
    });
    const text = typeof response.text === "string"
      ? response.text
      : response.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const parsed = stripJsonCandidate(text);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "Gemini did not return JSON", rawText: text };
    }

    // Pull citations from the grounding metadata when present.
    const grounding = response.candidates?.[0]?.groundingMetadata;
    const chunks = grounding?.groundingChunks || [];
    const sources = chunks
      .filter((c) => c?.web?.uri)
      .slice(0, 5)
      .map((c) => ({ title: c.web.title || c.web.uri, uri: c.web.uri }));

    return {
      ok: true,
      found: !!parsed.found,
      verified: {
        name:    parsed.name    ?? null,
        venue:   parsed.venue   ?? null,
        phone:   parsed.phone   ?? null,
        rating:  typeof parsed.rating === "number" ? parsed.rating : null,
        mapsUrl: parsed.mapsUrl ?? null,
      },
      sources,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
