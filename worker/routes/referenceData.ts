import type { Env } from "../types";
import { ok, fail } from "../http";
import { handleListIncidents } from "./incidents";

// GET /api/reference-data/:name — serves small reference JSON the tweaker/refiner
// may request. Names are validated to a strict slug. "incidents" serves the
// KV-added/edited incidents layered on top of the static build-time library;
// any other name keeps the original empty-envelope stub until a feature needs it.
export async function handleReferenceData(name: string, env: Env): Promise<Response> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return fail("invalid reference name", 400);
  if (name === "incidents") return handleListIncidents(env);
  return ok({ name, data: {} });
}
