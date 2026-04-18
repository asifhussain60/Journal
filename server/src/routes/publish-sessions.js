// routes/publish-sessions.js — Phase 11d.1 (Commit A).
//
// CRUD + abandon for PublishSession. No compose, no publish, no cleanup —
// those land in 11d.2–11d.4.
//
// Endpoints:
//   GET    /api/publish-sessions            — list for active trip
//   GET    /api/publish-sessions/:id        — hydrate one
//   POST   /api/publish-sessions            — create from { entryIds[] }
//   PATCH  /api/publish-sessions/:id        — edit composed / mediaPlan / cleanup.policy
//   POST   /api/publish-sessions/:id/abandon — terminal, clears sessionId on rows
//
// Session-id stamping is two-write: publish-sessions.json first, then
// pending.json. If the second write fails the session exists but rows are
// orphaned — surfaced in the 500 response. Full two-phase atomicity is
// deferred to 11d.4.

import express from "express";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  getActiveTripSlug,
  readQueue,
  atomicWriteJSON,
  appendQueueRow,
  TRIPS_DIR,
} from "../lib/receipts.js";
import {
  assertSessionTransition,
  isSessionTerminal,
} from "../lib/session-state.js";
import {
  loadPublishSession,
  SESSION_ID_RE,
} from "../middleware/validate-publish-session.js";

const QUEUE_NAME = "publish-sessions";
const PENDING = "pending";

function newSessionId() {
  return `ps_${randomBytes(10).toString("hex")}`;
}

function sessionsFilePath(slug) {
  return path.join(TRIPS_DIR, slug, `${QUEUE_NAME}.json`);
}

function pendingFilePath(slug) {
  return path.join(TRIPS_DIR, slug, `${PENDING}.json`);
}

// PATCH is limited to App-owned sub-objects per Decision 3. status is
// excluded — state transitions go through dedicated endpoints.
const PATCHABLE_KEYS = new Set(["composed", "mediaPlan", "cleanup"]);

export function createPublishSessionsRouter({ publishSessionValidator }) {
  const router = express.Router();

  // --- GET /api/publish-sessions -------------------------------------------
  router.get("/api/publish-sessions", async (req, res) => {
    try {
      const slug = req.query.slug || (await getActiveTripSlug());
      const sessions = await readQueue(slug, QUEUE_NAME);
      res.json({ ok: true, tripSlug: slug, sessions });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // --- GET /api/publish-sessions/:id ---------------------------------------
  router.get("/api/publish-sessions/:id", loadPublishSession, (req, res) => {
    res.json({ ok: true, tripSlug: req.tripSlug, session: req.session });
  });

  // --- POST /api/publish-sessions ------------------------------------------
  // body: { entryIds: string[], createdBy?: "user"|"auto-group"|"floatingchat" }
  router.post("/api/publish-sessions", async (req, res) => {
    try {
      const body = req.body ?? {};
      const entryIds = body.entryIds;
      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        return res.status(400).json({ ok: false, error: "entryIds must be a non-empty array" });
      }
      for (const id of entryIds) {
        if (typeof id !== "string" || !id.length) {
          return res.status(400).json({ ok: false, error: "every entryId must be a non-empty string" });
        }
      }

      const createdBy = body.createdBy ?? "user";
      if (!["user", "auto-group", "floatingchat"].includes(createdBy)) {
        return res.status(400).json({ ok: false, error: `invalid createdBy: ${createdBy}` });
      }

      const slug = req.query.slug || (await getActiveTripSlug());
      const pending = await readQueue(slug, PENDING);
      const byId = new Map(pending.map((r) => [r?.id, r]));

      // Validate every entryId exists and is free
      const conflicts = [];
      const missing = [];
      for (const id of entryIds) {
        const row = byId.get(id);
        if (!row) { missing.push(id); continue; }
        if (row.sessionId) conflicts.push({ entryId: id, sessionId: row.sessionId });
      }
      if (missing.length) {
        return res.status(404).json({ ok: false, error: "entryIds not found in pending", details: missing });
      }
      if (conflicts.length) {
        return res.status(409).json({
          ok: false,
          error: "one or more entries already belong to a session",
          details: conflicts,
        });
      }

      // Derive grouping hints (eventId, dayIndex, timeWindow)
      const rows = entryIds.map((id) => byId.get(id));
      const eventIds = new Set(rows.map((r) => r?.placement?.eventId).filter(Boolean));
      const dayIndices = new Set(rows.map((r) => r?.placement?.dayIndex).filter((d) => d != null));
      const capturedAt = rows
        .map((r) => r?.capturedAt || r?.createdAt)
        .filter(Boolean)
        .sort();

      const session = {
        schemaVersion: "1",
        id: newSessionId(),
        tripSlug: slug,
        createdAt: new Date().toISOString(),
        createdBy,
        entryIds: [...entryIds],
        status: "drafting",
      };
      if (eventIds.size === 1) session.eventId = [...eventIds][0];
      if (dayIndices.size === 1) session.dayIndex = [...dayIndices][0];
      if (capturedAt.length >= 2) {
        session.timeWindow = {
          startCapturedAt: capturedAt[0],
          endCapturedAt: capturedAt[capturedAt.length - 1],
        };
      }

      // AJV validate before writing
      if (!publishSessionValidator(session)) {
        return res.status(500).json({
          ok: false,
          error: "internal: new session failed schema validation",
          details: publishSessionValidator.errors,
        });
      }

      // Write 1: append to publish-sessions.json
      await appendQueueRow(slug, QUEUE_NAME, session);

      // Write 2: stamp sessionId onto pending rows
      const updatedPending = pending.map((r) =>
        entryIds.includes(r?.id) ? { ...r, sessionId: session.id } : r
      );
      try {
        await atomicWriteJSON(pendingFilePath(slug), updatedPending);
      } catch (err) {
        // Session written but back-pointer stamping failed — client can retry via PATCH.
        return res.status(500).json({
          ok: false,
          error: `session created but sessionId stamp failed: ${err?.message ?? err}`,
          session,
        });
      }

      res.json({ ok: true, tripSlug: slug, session });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // --- PATCH /api/publish-sessions/:id -------------------------------------
  router.patch("/api/publish-sessions/:id", loadPublishSession, async (req, res) => {
    try {
      const patch = req.body ?? {};
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return res.status(400).json({ ok: false, error: "body must be an object" });
      }

      if (isSessionTerminal(req.session.status)) {
        return res.status(409).json({
          ok: false,
          error: `session is ${req.session.status} (terminal); cannot patch`,
        });
      }

      const illegalKeys = Object.keys(patch).filter((k) => !PATCHABLE_KEYS.has(k));
      if (illegalKeys.length) {
        return res.status(400).json({
          ok: false,
          error: `only ${[...PATCHABLE_KEYS].join(", ")} may be patched`,
          details: illegalKeys,
        });
      }

      const updated = { ...req.session, ...patch };
      if (!publishSessionValidator(updated)) {
        return res.status(400).json({
          ok: false,
          error: "patch would violate schema",
          details: publishSessionValidator.errors,
        });
      }

      const nextList = req.sessions.map((s) => (s.id === updated.id ? updated : s));
      await atomicWriteJSON(sessionsFilePath(req.tripSlug), nextList);

      res.json({ ok: true, tripSlug: req.tripSlug, session: updated });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // --- POST /api/publish-sessions/:id/abandon ------------------------------
  router.post("/api/publish-sessions/:id/abandon", loadPublishSession, async (req, res) => {
    try {
      const from = req.session.status;
      try {
        assertSessionTransition(from, "abandoned");
      } catch (err) {
        return res.status(409).json({
          ok: false,
          error: err.message,
          from,
          to: "abandoned",
          legal: err.legal ?? [],
        });
      }

      const updated = { ...req.session, status: "abandoned" };
      const nextList = req.sessions.map((s) => (s.id === updated.id ? updated : s));
      await atomicWriteJSON(sessionsFilePath(req.tripSlug), nextList);

      // Clear sessionId on all associated pending rows
      const pending = await readQueue(req.tripSlug, PENDING);
      const targetIds = new Set(req.session.entryIds ?? []);
      let cleared = 0;
      const nextPending = pending.map((r) => {
        if (r?.sessionId === req.session.id || targetIds.has(r?.id)) {
          cleared += 1;
          const { sessionId, ...rest } = r;
          return rest;
        }
        return r;
      });
      if (cleared) {
        await atomicWriteJSON(pendingFilePath(req.tripSlug), nextPending);
      }

      res.json({ ok: true, tripSlug: req.tripSlug, session: updated, rowsCleared: cleared });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
