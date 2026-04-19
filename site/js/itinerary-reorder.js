/**
 * itinerary-reorder.js — Phase 12 drag-reorder + anchor-aware time recalc.
 *
 * Wires up:
 *   - SortableJS on each `.event-list[data-reorder-list]` container
 *   - Pin/unpin toggle on `.event-pin-btn` (flips ev.time_mode anchor↔flex)
 *   - Keyboard reorder: Alt+↑ / Alt+↓ on a focused `.event` row
 *   - Optimistic DOM reorder on drop, POST /api/recalc-times for server-
 *     calculated times, apply patch via /api/trip-edit, refresh the map
 *   - 10s undo toast via window.notify; Undo POSTs /api/trip-edit/revert
 *   - Tight-gap warning banner injected into `.day-card` when the server
 *     reports `summary.tight_gaps > 0`
 *
 * Drop model: only flex cards are draggable within the window between two
 * anchors. Anchors are filtered via SortableJS's `filter` option so the
 * user can't accidentally move a flight or reservation. After a drop, the
 * server repacks times and returns the new events array + a patch; we
 * reuse the existing render pipeline (`renderItinerary` or per-day refresh)
 * so the map + drive chips update together.
 *
 * Graceful degradation: if ORS_API_KEY is not configured on the server,
 * /api/recalc-times returns 503. The drag is reverted and a toast explains
 * — the DOM never diverges from trip.yaml.
 */

const SORTABLE_CDN = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js';
const UNDO_DURATION_MS = 10_000;

function apiBase() {
  // Same-origin relative URL when __API_BASE is unset; matches the pattern
  // used elsewhere in site/js/* (see toast.js, tweaker-loader.js).
  return (window.__API_BASE || '').replace(/\/$/, '');
}

function notify() {
  return window.notify || null;
}

function tripSlug() {
  const trip = window.__tripData;
  return trip?.slug || '';
}

// Load SortableJS once, cache the promise. No-op if already present.
let sortableReady = null;
function ensureSortable() {
  if (window.Sortable) return Promise.resolve(window.Sortable);
  if (sortableReady) return sortableReady;
  sortableReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SORTABLE_CDN;
    s.async = true;
    s.onload = () => resolve(window.Sortable);
    s.onerror = () => reject(new Error('SortableJS failed to load'));
    document.head.appendChild(s);
  });
  return sortableReady;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function getDayEvents(dayIdx) {
  const trip = window.__tripData;
  return trip?.days?.[dayIdx]?.events || [];
}

// Map a day container's current `.event` rows back to event indices in the
// pre-drop canonical order. Each row still carries its original
// `data-event-idx` attribute after SortableJS reorders the DOM.
function readDomOrder(listEl) {
  const rows = Array.from(listEl.querySelectorAll(':scope > .event'));
  return rows.map((row) => Number(row.getAttribute('data-event-idx')));
}

// Build the recalc-times payload from the current DOM order. We send
// time/time_mode/lat/lng/duration_min/place_id/venue so the server can
// pack times without re-reading trip.yaml (it does anyway, for validation).
function buildRecalcPayload(dayIdx, newOrder) {
  const canonical = getDayEvents(dayIdx);
  return newOrder.map((origIdx) => {
    const ev = canonical[origIdx] || {};
    return {
      event: ev.event,
      venue: ev.venue,
      place_id: ev.place_id,
      time: ev.time,
      time_mode: ev.time_mode || 'flex',
      lat: ev.lat,
      lng: ev.lng,
      duration_min: ev.duration_min,
      tag: ev.tag,
    };
  });
}

async function postJSON(path, body) {
  const r = await fetch(apiBase() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: json };
}

// Refresh the day's map + drive chips after a reorder. Rebuilds dayStops
// for the affected day only (no global teardown) and re-inits Leaflet.
function refreshDayMap(dayNum) {
  const mapId = 'map' + dayNum;
  const stops = [];
  const listEl = document.querySelector(`.event-list[data-reorder-list][data-day-num="${dayNum}"]`);
  if (!listEl) return;
  const dayIdx = Number(listEl.getAttribute('data-day-idx'));
  const canonical = getDayEvents(dayIdx);
  readDomOrder(listEl).forEach((origIdx) => {
    const ev = canonical[origIdx];
    if (ev && Number.isFinite(ev.lat) && Number.isFinite(ev.lng)) {
      stops.push([ev.lat, ev.lng, ev.event || ev.venue || '']);
    }
  });
  if (window.__dayStops) window.__dayStops[mapId] = stops;
  const prev = window.__leafletMaps?.[mapId];
  if (prev) { try { prev.remove(); } catch (_) {} delete window.__leafletMaps[mapId]; }
  if (typeof window.initMap === 'function' && stops.length) {
    window.initMap(mapId);
  }
}

// ─── Tight-gap banner ──────────────────────────────────────────────────

function renderTightGapBanner(dayIdx, count) {
  const listEl = document.querySelector(`.event-list[data-reorder-list][data-day-idx="${dayIdx}"]`);
  if (!listEl) return;
  // Remove any prior banner so stale warnings don't stack.
  const prev = listEl.parentElement.querySelector(':scope > .tight-gap-banner');
  if (prev) prev.remove();
  if (!count || count < 1) return;
  const banner = document.createElement('div');
  banner.className = 'tight-gap-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML =
    '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' +
    '<span class="tight-gap-text">Tight gap: ' + count + ' transition under 5 min. Consider adjusting pinned times.</span>' +
    '<button type="button" class="tight-gap-dismiss" aria-label="Dismiss">&times;</button>';
  banner.querySelector('.tight-gap-dismiss').addEventListener('click', () => banner.remove());
  listEl.parentElement.insertBefore(banner, listEl);
}

// ─── Core: apply reorder ───────────────────────────────────────────────
// Called by both drag-drop AND keyboard reorder. `newOrder` is an array of
// original event indices in the post-move order. Optimistic: we already
// moved the DOM. This fn talks to the server and, on failure, restores.

async function applyReorder(listEl, dayIdx, dayNum, newOrder, preMoveOrder) {
  const slug = tripSlug();
  if (!slug) return;

  listEl.setAttribute('data-reorder-busy', '1');
  try {
    const payload = {
      tripSlug: slug,
      dayIndex: dayIdx,
      events: buildRecalcPayload(dayIdx, newOrder),
      apply: true,
    };
    const res = await postJSON('/api/recalc-times', payload);
    if (!res.ok) {
      // Revert DOM: rewrite the list in the pre-move order.
      revertDomOrder(listEl, preMoveOrder);
      const msg = res.body?.error || `HTTP ${res.status}`;
      const n = notify();
      if (n) n.error('Reorder failed: ' + msg);
      return;
    }

    const { id, packed, summary } = res.body;
    // Mutate canonical trip state: replace this day's events with the packed
    // output. renderItinerary() reads from this on future refreshes.
    const trip = window.__tripData;
    if (trip?.days?.[dayIdx]) trip.days[dayIdx].events = packed;

    // Re-render just this day so times + drive chips + map line up without
    // rebuilding the whole timeline (preserves scroll + other open days).
    rerenderDay(dayIdx);
    refreshDayMap(dayNum);
    renderTightGapBanner(dayIdx, summary?.tight_gaps || 0);

    // Undo toast: action calls /api/trip-edit/revert with the applied id.
    const n = notify();
    if (n) {
      const label = summary?.tight_gaps
        ? `Reordered (${summary.tight_gaps} tight gap)`
        : 'Reordered and repacked';
      n.success(label, {
        duration: UNDO_DURATION_MS,
        action: {
          label: 'Undo',
          onClick: () => undoReorder(id, dayIdx, dayNum),
        },
      });
    }
  } catch (err) {
    revertDomOrder(listEl, preMoveOrder);
    const n = notify();
    if (n) n.error('Reorder failed: ' + (err?.message || String(err)));
  } finally {
    listEl.removeAttribute('data-reorder-busy');
  }
}

async function undoReorder(editId, dayIdx, dayNum) {
  const slug = tripSlug();
  if (!slug || !editId) return;
  try {
    const res = await postJSON('/api/trip-edit/revert', { tripSlug: slug, patchId: editId });
    if (!res.ok) {
      const n = notify();
      if (n) n.error('Undo failed: ' + (res.body?.error || `HTTP ${res.status}`));
      return;
    }
    // After a revert, trust the server — refetch this trip so client state
    // matches the file exactly. Full re-render is fine; undo is rare.
    await refreshTripData();
    if (typeof window.renderItinerary === 'function' && window.__tripData) {
      window.renderItinerary(window.__tripData, { preserveState: true });
    }
    const n = notify();
    if (n) n.info('Reorder undone');
  } catch (err) {
    const n = notify();
    if (n) n.error('Undo failed: ' + (err?.message || String(err)));
  }
}

async function refreshTripData() {
  const slug = tripSlug();
  if (!slug) return;
  const r = await fetch(apiBase() + '/api/trip/' + slug + '/full', { credentials: 'include' });
  if (!r.ok) return;
  const j = await r.json();
  if (j?.trip) window.__tripData = j.trip;
}

// Re-render a single day card's event rows in place. Uses the existing
// renderEventCard() (which lives in itinerary.html as a global). No full
// timeline teardown — scroll and other expanded days are preserved.
function rerenderDay(dayIdx) {
  const listEl = document.querySelector(`.event-list[data-reorder-list][data-day-idx="${dayIdx}"]`);
  if (!listEl) return;
  const day = window.__tripData?.days?.[dayIdx];
  if (!day || !Array.isArray(day.events)) return;
  const renderEventCard = window.renderEventCard;
  const isNumberedStop = window.isNumberedStop;
  if (typeof renderEventCard !== 'function') {
    // Fallback: just trigger the full re-render.
    if (typeof window.renderItinerary === 'function') {
      window.renderItinerary(window.__tripData, { preserveState: true });
    }
    return;
  }
  let html = '';
  let stopIdx = 0;
  day.events.forEach((ev, eventIdx) => {
    let num = null;
    if (typeof isNumberedStop === 'function' && isNumberedStop(ev)) {
      stopIdx += 1;
      num = stopIdx;
    }
    html += renderEventCard(ev, num, dayIdx, eventIdx, day.date, day.day);
  });
  listEl.innerHTML = html;
}

// Revert the DOM order inside `listEl` to the given original-index sequence.
// Used when the server rejects the reorder (e.g., ORS unreachable).
function revertDomOrder(listEl, originalOrder) {
  const rows = Array.from(listEl.querySelectorAll(':scope > .event'));
  const byIdx = new Map(rows.map((r) => [Number(r.getAttribute('data-event-idx')), r]));
  const frag = document.createDocumentFragment();
  originalOrder.forEach((i) => {
    const row = byIdx.get(i);
    if (row) frag.appendChild(row);
  });
  listEl.appendChild(frag);
}

// ─── SortableJS wiring ─────────────────────────────────────────────────

function wireSortable(Sortable, listEl) {
  if (listEl.__sortable) return;
  const dayIdx = Number(listEl.getAttribute('data-day-idx'));
  const dayNum = Number(listEl.getAttribute('data-day-num'));
  let preMoveOrder = null;

  listEl.__sortable = new Sortable(listEl, {
    animation: 180,
    // The numbered disc on the rail is the drag handle. Placed on the left
    // of the card so the grab affordance doesn't compete with the right-
    // edge delete/alt-find buttons. Unnumbered events hide the disc (see
    // .event-rail-num:empty) — those are TRAVEL anchors that can't be
    // reordered anyway, so the filter catches them.
    handle: '.event-rail-num',
    draggable: '.event',
    filter: '.event[data-time-mode="anchor"]',
    preventOnFilter: false,
    ghostClass: 'event--drag-ghost',
    chosenClass: 'event--drag-chosen',
    dragClass: 'event--drag-active',
    onStart: () => {
      preMoveOrder = readDomOrder(listEl);
    },
    onEnd: (evt) => {
      // Guard: if the user dropped something onto an anchor or didn't
      // actually change position, bail without a server round-trip.
      if (evt.oldIndex === evt.newIndex) { preMoveOrder = null; return; }
      const newOrder = readDomOrder(listEl);
      applyReorder(listEl, dayIdx, dayNum, newOrder, preMoveOrder);
      preMoveOrder = null;
    },
  });
}

// ─── Pin toggle ────────────────────────────────────────────────────────

async function handlePinToggle(btn) {
  const slug = tripSlug();
  if (!slug) return;
  const dayIdx = Number(btn.getAttribute('data-day-idx'));
  const eventIdx = Number(btn.getAttribute('data-event-idx'));
  if (!Number.isInteger(dayIdx) || !Number.isInteger(eventIdx)) return;
  const events = getDayEvents(dayIdx);
  const ev = events[eventIdx];
  if (!ev) return;
  const next = (ev.time_mode === 'anchor') ? 'flex' : 'anchor';

  // Optimistic flip of the icon + data attr.
  const row = btn.closest('.event');
  if (row) row.setAttribute('data-time-mode', next);
  const icon = btn.querySelector('i');
  if (icon) icon.className = next === 'anchor' ? 'fa-solid fa-thumbtack' : 'fa-regular fa-thumbtack';
  btn.setAttribute('title', next === 'anchor' ? 'Unpin (let time flex)' : 'Pin this time');
  btn.setAttribute('aria-label', next === 'anchor' ? 'Unpin (let time flex)' : 'Pin this time');

  // Persist via dedicated /api/pin-event — a narrow endpoint that only
  // flips time_mode. We can't reuse /api/trip-edit?patches[] because that
  // path is allowlist-gated to /highlights + /dayoneTags and gated behind
  // REFINE_ALL_ENABLED for everything else (D11 guard).
  try {
    const res = await postJSON('/api/pin-event', {
      tripSlug: slug,
      dayIndex: dayIdx,
      eventIndex: eventIdx,
      time_mode: next,
    });
    if (!res.ok) {
      // Revert.
      if (row) row.setAttribute('data-time-mode', ev.time_mode || 'flex');
      if (icon) icon.className = ev.time_mode === 'anchor' ? 'fa-solid fa-thumbtack' : 'fa-regular fa-thumbtack';
      const n = notify();
      if (n) n.error('Could not change pin state: ' + (res.body?.error || `HTTP ${res.status}`));
      return;
    }
    ev.time_mode = next;
  } catch (err) {
    if (row) row.setAttribute('data-time-mode', ev.time_mode || 'flex');
    const n = notify();
    if (n) n.error('Could not change pin state: ' + (err?.message || String(err)));
  }
}

// ─── Keyboard reorder (a11y) ───────────────────────────────────────────

function handleKeyboardReorder(evt) {
  if (!evt.altKey) return;
  if (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown') return;
  const row = evt.target.closest?.('.event');
  if (!row) return;
  if (row.getAttribute('data-time-mode') === 'anchor') return;
  const listEl = row.parentElement;
  if (!listEl?.matches?.('.event-list[data-reorder-list]')) return;
  evt.preventDefault();

  const preMoveOrder = readDomOrder(listEl);
  const sibling = evt.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling || !sibling.classList.contains('event')) return;
  if (sibling.getAttribute('data-time-mode') === 'anchor') return;

  if (evt.key === 'ArrowUp') {
    listEl.insertBefore(row, sibling);
  } else {
    listEl.insertBefore(sibling, row);
  }
  row.focus();
  const dayIdx = Number(listEl.getAttribute('data-day-idx'));
  const dayNum = Number(listEl.getAttribute('data-day-num'));
  const newOrder = readDomOrder(listEl);
  applyReorder(listEl, dayIdx, dayNum, newOrder, preMoveOrder);
}

// ─── Bootstrap ─────────────────────────────────────────────────────────

function wireAll() {
  ensureSortable().then((Sortable) => {
    document.querySelectorAll('.event-list[data-reorder-list]').forEach((listEl) => {
      wireSortable(Sortable, listEl);
    });
  }).catch((err) => {
    console.warn('[REORDER] SortableJS unavailable', err);
  });
}

document.addEventListener('click', (evt) => {
  const btn = evt.target.closest?.('[data-reorder-pin]');
  if (btn) { evt.stopPropagation(); handlePinToggle(btn); }
});
document.addEventListener('keydown', handleKeyboardReorder);

// The timeline is rebuilt by renderItinerary() every refresh, which wipes
// any prior Sortable instances when it reassigns innerHTML. A MutationObserver
// on the timeline container catches every render + any per-day surgical
// rerender and (re)wires Sortable on new `.event-list` nodes.
function observeTimeline() {
  const timeline = document.querySelector('.timeline');
  if (!timeline) { requestAnimationFrame(observeTimeline); return; }
  wireAll();
  const mo = new MutationObserver(() => wireAll());
  mo.observe(timeline, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeTimeline);
} else {
  observeTimeline();
}

// Expose for debugging / tests.
window.__itineraryReorder = {
  wireAll,
  applyReorder,
  refreshDayMap,
  handlePinToggle,
};
