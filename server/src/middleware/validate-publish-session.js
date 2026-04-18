// middleware/validate-publish-session.js — Phase 11d.1
//
// Shared middleware for routes that operate on an existing PublishSession.
// Resolves tripSlug (query param → active), loads publish-sessions.json,
// attaches { tripSlug, sessions, session } to req. Does not enforce
// transitions — that's the route's job via lib/session-state.js.
//
// Usage:
//   router.get("/api/publish-sessions/:id", loadPublishSession, (req, res) => { ... });

import { getActiveTripSlug, readQueue } from "../lib/receipts.js";

const SESSION_ID_RE = /^ps_[0-9a-f]{20}$/;

export async function loadPublishSession(req, res, next) {
  try {
    const slug = req.query.slug || (await getActiveTripSlug());
    const sessions = await readQueue(slug, "publish-sessions");

    req.tripSlug = slug;
    req.sessions = sessions;

    const { id } = req.params;
    if (id) {
      if (!SESSION_ID_RE.test(id)) {
        return res.status(400).json({ ok: false, error: "session id must match ps_[0-9a-f]{20}" });
      }
      const session = sessions.find((s) => s?.id === id);
      if (!session) {
        return res.status(404).json({ ok: false, error: `session ${id} not found in trip ${slug}` });
      }
      req.session = session;
    }

    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
}

export { SESSION_ID_RE };
