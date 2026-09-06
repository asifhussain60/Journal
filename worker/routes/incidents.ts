import type { Env } from "../types";
import { ok, fail, readJson } from "../http";
import { callGemini } from "../gemini";

// Incidents Asif adds or edits live in Cloudflare KV, layered on top of the
// 49 static incidents baked into the site build from incident-bank.md:
//   incident:INC-0NN          — a brand-new incident (NN >= 50)
//   incident-override:INC-### — an edit to an existing incident (static or added)
// Neither ever touches the git-tracked incident-bank.md — that stays a manual
// step if Asif wants something "graduated" into the offline authoring skill.

const INCIDENT_FIELD_KEYS = [
  "title",
  "era",
  "themes",
  "emotional_arc",
  "status",
  "told_in",
  "refs",
  "connections",
  "takeaway",
] as const;

type IncidentFields = Record<(typeof INCIDENT_FIELD_KEYS)[number], string>;

const INCIDENT_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(INCIDENT_FIELD_KEYS.map((k) => [k, { type: "string" }])),
  required: [...INCIDENT_FIELD_KEYS],
};

const INCIDENT_VOICE = `You are helping Asif draft an incident-bank entry for his memoir
"What I Wish Babu Taught Me". Asif IS "Babu" — pain is curriculum, not cruelty; he is a student
of his own story, never a victim; parents are complex, never villains. The "takeaway" field
especially should sound like a single hard-won line in Asif's own restrained voice, not a
therapy-speak summary. No em dashes, no semicolons, no words like trauma, toxic, healing,
journey, incredibly. Return ONLY the JSON object — no preamble, no commentary.`;

function normalizeFields(raw: unknown): IncidentFields | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Partial<IncidentFields> = {};
  for (const key of INCIDENT_FIELD_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    out[key] = typeof v === "string" ? v : "";
  }
  return out as IncidentFields;
}

// POST /api/incident-draft — AI drafts (from rawText) or refines (from fields)
// the 9-field incident shape. Ephemeral: nothing is written to KV here.
export async function handleDraftIncident(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ rawText?: string; fields?: Record<string, string> }>(request);
  const rawText = body?.rawText?.trim();
  const fields = body?.fields;

  let user: string;
  if (fields && Object.values(fields).some((v) => v?.trim())) {
    user = `Refine and tighten these existing incident fields, keeping every fact and detail —
do not invent anything new, just sharpen the wording and fill in any thin fields:\n\n${JSON.stringify(
      fields,
      null,
      2,
    )}`;
  } else if (rawText) {
    user = `Draft a full incident-bank entry from this rough description Asif wrote:\n\n${rawText}`;
  } else {
    return fail("incident-draft: 'rawText' or 'fields' is required");
  }

  try {
    const { text } = await callGemini(env, {
      system: INCIDENT_VOICE,
      user,
      temperature: 0.5,
      maxTokens: 1024,
      responseMimeType: "application/json",
      responseSchema: INCIDENT_SCHEMA,
    });
    const draft = normalizeFields(JSON.parse(text));
    if (!draft) return fail("Gemini returned an unexpected shape", 502);
    return ok({ draft });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}

async function nextIncidentId(env: Env): Promise<string> {
  const { keys } = await env.CHAPTERS_KV.list({ prefix: "incident:" });
  let max = 49;
  for (const { name } of keys) {
    const m = name.match(/^incident:INC-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `INC-${String(max + 1).padStart(3, "0")}`;
}

function renderRaw(id: string, fields: IncidentFields): string {
  return [
    `[${id}]`,
    `Title: ${fields.title}`,
    `Era: ${fields.era}`,
    `Themes: ${fields.themes}`,
    `Emotional arc: ${fields.emotional_arc}`,
    `Status: ${fields.status}`,
    `Told in: ${fields.told_in}`,
    `Refs: ${fields.refs}`,
    `Connections: ${fields.connections}`,
    `Takeaway: ${fields.takeaway}`,
  ].join("\n");
}

// POST /api/incidents — Approve. `id` present = override an existing incident
// (static or previously added); absent = a brand-new one gets the next id.
export async function handleSaveIncident(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ id?: string; fields?: Record<string, string> }>(request);
  const fields = normalizeFields(body?.fields);
  if (!fields) return fail("incidents: 'fields' is required");

  const isOverride = typeof body?.id === "string" && body.id.trim().length > 0;
  const id = isOverride ? (body!.id as string).trim() : await nextIncidentId(env);
  const key = isOverride ? `incident-override:${id}` : `incident:${id}`;

  const entry = {
    id,
    kind: "incident" as const,
    title: fields.title,
    fields,
    raw: renderRaw(id, fields),
    addedAt: new Date().toISOString(),
  };

  try {
    await env.CHAPTERS_KV.put(key, JSON.stringify(entry));
    return ok({ entry });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}

// GET /api/reference-data/incidents — every KV-added incident plus every KV
// override, so the client can merge both on top of the static 158-entry set.
export async function handleListIncidents(env: Env): Promise<Response> {
  try {
    const [added, overridden] = await Promise.all([
      env.CHAPTERS_KV.list({ prefix: "incident:" }),
      env.CHAPTERS_KV.list({ prefix: "incident-override:" }),
    ]);

    const incidents = await Promise.all(
      added.keys.map(async (k) => JSON.parse((await env.CHAPTERS_KV.get(k.name)) ?? "null")),
    );
    // Flatten each override down to {title, ...fields} — the shape the client
    // actually needs to merge onto an incident's display values. The nested
    // {id, kind, fields, raw, addedAt} envelope is a storage detail; don't
    // leak it into the API contract.
    const overrideEntries = await Promise.all(
      overridden.keys.map(async (k) => {
        const id = k.name.replace(/^incident-override:/, "");
        const value = JSON.parse((await env.CHAPTERS_KV.get(k.name)) ?? "null");
        return [id, value ? { title: value.title, ...value.fields } : null] as const;
      }),
    );

    return ok({
      incidents: incidents.filter(Boolean),
      overrides: Object.fromEntries(overrideEntries.filter(([, v]) => v)),
    });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
