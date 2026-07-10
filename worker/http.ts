// Small HTTP helpers. The frontend clients (site/js/claude-client.js legacy +
// the new TS client) treat `{ ok:false }` or a present `error` field as failure,
// so every JSON response keeps that envelope.

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function ok(data: Record<string, unknown> = {}): Response {
  return json({ ok: true, ...data });
}

export function fail(error: string, status = 400): Response {
  return json({ ok: false, error }, status);
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
