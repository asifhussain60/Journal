// adapters/fromDeadLetter.js — Phase 11a
// Normalizes a dead-letter entry into a canonical LogEntry.
// Dead-letter rows have shape: { ...originalRow, deadLetter: { queueName, reason, failedAt, attempts } }

import { fromPending } from "./fromPending.js";
import { fromVoiceInbox } from "./fromVoiceInbox.js";
import { fromItineraryInbox } from "./fromItineraryInbox.js";

const QUEUE_ADAPTERS = {
  "pending": fromPending,
  "voice-inbox": fromVoiceInbox,
  "itinerary-inbox": fromItineraryInbox,
};

/**
 * @param {object} deadLetterEntry - { queueName, id, row }
 * @returns {object} Canonical LogEntry with ingestStatus "failed"
 */
export function fromDeadLetter({ queueName, id, row }) {
  if (!row || row.error) {
    // Unreadable dead-letter file — produce a minimal stub
    return {
      schemaVersion: "2",
      id: id ?? `dl-unknown-${Date.now()}`,
      tripSlug: null,
      kind: "note",
      source: "app",
      capturedAt: new Date().toISOString(),
      ingestStatus: "failed",
      placementStatus: "unplaced",
      reviewStatus: "unreviewed",
      journalStatus: "none",
      ynabStatus: "na",
      placement: { source: "unsorted" },
      route: { journal: "none", ynab: "na" },
      payload: {},
      memoryWorthy: false,
      syncError: "Dead-letter file unreadable",
      _drainStatus: "stuck",
      _queueName: queueName ?? "unknown",
      _isDeadLetter: true,
    };
  }

  // Pull the original row (minus the deadLetter sidecar) through the right adapter
  const { deadLetter, ...originalRow } = row;
  const adapter = QUEUE_ADAPTERS[queueName] ?? fromPending;
  const entry = adapter(originalRow);

  return {
    ...entry,
    ingestStatus: "failed",
    syncError: deadLetter?.reason ?? entry.syncError,
    syncAttemptCount: deadLetter?.attempts ?? entry.syncAttemptCount,
    _isDeadLetter: true,
    _deadLetterMeta: deadLetter,
  };
}
