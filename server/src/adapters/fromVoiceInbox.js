// adapters/fromVoiceInbox.js — Phase 11a
// Normalizes a raw voice-inbox.json row into a canonical LogEntry.
// Read-only: does not mutate the source row or its file.

/**
 * @param {object} row - Raw row from trips/{slug}/voice-inbox.json
 * @returns {object} Canonical LogEntry (schemaVersion "2", kind "voice")
 */
export function fromVoiceInbox(row) {
  const drainStatus = row.status;

  return {
    schemaVersion: "2",
    id: row.id,
    tripSlug: row.tripSlug ?? null,
    kind: "voice",
    source: row.source ?? "app",
    capturedAt: row.capturedAt ?? row.createdAt,

    ingestStatus: row.ingestStatus ?? (drainStatus === "stuck" ? "failed" : "captured"),
    placementStatus: row.placementStatus ?? "unplaced",
    reviewStatus: row.reviewStatus ?? "unreviewed",
    journalStatus: row.journalStatus ?? "none",
    ynabStatus: "na",

    placement: row.placement ?? { source: "unsorted" },
    route: row.route ?? { journal: "none", ynab: "na" },
    draft: row.draft ?? undefined,

    payload: row.payload ?? {},
    memoryWorthy: row.memoryWorthy ?? false,
    dedupKey: row.dedupKey ?? undefined,
    notes: row.notes ?? undefined,

    reviewedAt: row.reviewedAt ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    lastSyncedAt: row.lastSyncedAt ?? undefined,
    syncAttemptCount: row.syncAttemptCount ?? undefined,
    syncError: row.syncError ?? undefined,

    _drainStatus: drainStatus,
    _queueName: "voice-inbox",
  };
}
