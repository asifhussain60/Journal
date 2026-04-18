// adapters/fromItineraryInbox.js — Phase 11a
// Normalizes a raw itinerary-inbox.json row into a canonical LogEntry.
// Per Decision 4: itinerary rows are hidden by default in Phase 11a;
// they surface only on ?show=itinerary-intake. The adapter still
// normalizes them so the /api/log endpoint can honour the flag.

/**
 * @param {object} row - Raw row from trips/{slug}/itinerary-inbox.json
 * @returns {object} Canonical LogEntry (schemaVersion "2", kind "itinerary")
 */
export function fromItineraryInbox(row) {
  const drainStatus = row.status;

  return {
    schemaVersion: "2",
    id: row.id,
    tripSlug: row.tripSlug ?? null,
    kind: "itinerary",
    source: row.source ?? "app",
    capturedAt: row.capturedAt ?? row.createdAt,

    ingestStatus: row.ingestStatus ?? (drainStatus === "stuck" ? "failed" : "captured"),
    placementStatus: row.placementStatus ?? "unplaced",
    reviewStatus: row.reviewStatus ?? "unreviewed",
    journalStatus: "none",
    ynabStatus: "na",

    placement: row.placement ?? { source: "unsorted" },
    route: row.route ?? { journal: "none", ynab: "na" },
    draft: undefined,

    payload: row.payload ?? {},
    memoryWorthy: false,
    dedupKey: row.dedupKey ?? undefined,
    notes: row.notes ?? undefined,

    reviewedAt: undefined,
    publishedAt: undefined,
    lastSyncedAt: undefined,
    syncAttemptCount: undefined,
    syncError: undefined,

    _drainStatus: drainStatus,
    _queueName: "itinerary-inbox",
  };
}
