import type { Env } from "../types";
import { ok, fail } from "../http";

// GET /api/reference-data/:name — serves small reference JSON the tweaker/refiner
// may request. Names are validated to a strict slug. Currently returns an empty
// payload envelope; wire specific datasets here as features need them.
export async function handleReferenceData(name: string, _env: Env): Promise<Response> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return fail("invalid reference name", 400);
  return ok({ name, data: {} });
}
