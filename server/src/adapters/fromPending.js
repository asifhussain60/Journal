// adapters/fromPending.js — Phase 11a
// Normalizes a raw pending.json row (v1 or v2) into a canonical LogEntry.
// Read-only: does not mutate the source row or its file.

/**
 * @param {object} row - Raw row from trips/{slug}/pending.json
 * @returns {object} Canonical LogEntry (schemaVersion "2")
 */
export function fromPending(row) {
  const drainStatus = row.status; // "pending" | "drained" | "stuck"

  // ingestStatus: derive from drain status when not explicitly set
  let ingestStatus = row.ingestStatus;
  if (!ingestStatus) {
    ingestStatus = drainStatus === "stuck" ? "failed" : "captured";
  }

  // ynabStatus: receipts default to "candidate" unless already set
  const ynabStatus =
    row.ynabStatus ?? (row.kind === "receipt" ? "candidate" : "na");

  // route: derive from ynabStatus when not set
  const route = row.route ?? {
    journal: "none",
    ynab: ynabStatus !== "na" ? ynabStatus : "na",
  };

  return {
    schemaVersion: "2",
    id: row.id,
    tripSlug: row.tripSlug ?? null,
    kind: row.kind,
    source: row.source ?? "app",
    capturedAt: row.capturedAt ?? row.createdAt,

    ingestStatus,
    placementStatus: row.placementStatus ?? "unplaced",
    reviewStatus: row.reviewStatus ?? "unreviewed",
    journalStatus: row.journalStatus ?? "none",
    ynabStatus,

    placement: row.placement ?? { source: "unsorted" },
    route,
    draft: row.draft ?? undefined,

    payload: row.payload ?? {},
    memoryWorthy: row.memoryWorthy ?? false,
    dedupKey: row.dedupKey ?? undefined,
    imagePath: row.imagePath ?? undefined,
    visionUsed: row.visionUsed ?? undefined,
    notes: row.notes ?? undefined,

    reviewedAt: row.reviewedAt ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    lastSyncedAt: row.lastSyncedAt ?? undefined,
    syncAttemptCount: row.syncAttemptCount ?? undefined,
    syncError: row.syncError ?? undefined,
    overrideSource: row.overrideSource ?? undefined,

    // Phase 11d — PublishSession back-pointer (undefined when row is free)
    sessionId: row.sessionId ?? undefined,

    // Internal drain lifecycle — not in UI copy but needed for Stuck tab filter
    _drainStatus: drainStatus,
    _queueName: "pending",
  };
}
