/**
 * The review queue: finished harvests awaiting a decision. Lists the
 * harvest-queue records, polls for a still-running harvest (ticket 084 —
 * the record lands from a background server task, so the poll is real
 * time, not fakeable), and reads the activity feed when a harvest fails
 * without ever writing a record (ticket 154). Opening an entry loads its
 * record and hands the screen to the harvest.
 *
 * Injection, not import: `el`, `api` and the rest are module-private in
 * main.ts (the import-review pattern). The seam is one object literal at
 * the call site; the pure helpers (relativeTime, originWord,
 * harvest-failure) and the shared wire types are the allowed imports.
 * The harvest screen is re-entered through a bound `renderHarvest` — the
 * same deps object the harvest route uses, so an opened entry is exactly
 * what a direct renderHarvest() call was before this split.
 */

import type { CutProposal } from '../src/types.ts';
import { relativeTime } from '../src/log/format.js';
import { originWord } from './provenance.js';
import { HARVEST_FAILED_SENTENCE, harvestFailedFor } from './harvest-failure.js';
import type { ActivityEvent, HarvestQueueEntry, WebDepsShell } from './deps.js';

/** `GET /api/harvest-queue/:id` — the record an opened entry loads. */
interface HarvestQueueRecord {
 sessionId: string;
 proposals: CutProposal[];
}

export interface ReviewsDeps extends WebDepsShell {
 screen: () => string;
 setSessionId: (sessionId: string) => void;
 setProposals: (proposals: CutProposal[]) => void;
 pendingReview: () => string | null;
 setPendingReview: (sessionId: string | null) => void;
 /** The harvest screen, re-entered directly (the one decision in the reviewing grammar). */
 renderHarvest: () => void;
}

let reviewPollTimer: ReturnType<typeof setInterval> | null = null;

export function renderReviews(deps: ReviewsDeps) {
 deps.clear();
 deps.setScreen('reviews');
 deps.renderShell();

 // Re-entry must never stack timers; clearing a dead handle is a no-op.
 if (reviewPollTimer !== null) clearInterval(reviewPollTimer);
 reviewPollTimer = null;

 const div = deps.el('div', { class: 'screen active reviews-screen' });

 const heading = deps.el('h2', { class: 'waiting-heading' }, 'harvests awaiting review');
 const list = deps.el('div', { class: 'harvest-queue-list' });
 div.append(heading, list);
 deps.main.append(div);

 const pending = deps.pendingReview();

 (async () => {
  try {
   const data = await deps.api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
   if (deps.screen() !== 'reviews') return;
   list.innerHTML = '';

   const landed = pending !== null && data.pending.some((e) => e.sessionId === pending);

   // The harvest we just launched has not landed yet: say so quietly and
   // poll for its record, then re-render the list once it exists.
   if (pending !== null && !landed) {
    list.append(
     deps.el(
      'p',
      { class: 'harvest-running' },
      'harvest running — it will appear here when it is done',
     ),
    );
    const poll = setInterval(async () => {
     if (deps.screen() !== 'reviews') {
      clearInterval(poll);
      reviewPollTimer = null;
      return;
     }
     try {
      await deps.api<HarvestQueueRecord>(`/api/harvest-queue/${pending}`);
      if (deps.screen() !== 'reviews') return;
      deps.setPendingReview(null);
      renderReviews(deps);
     } catch {
      // No record yet: the harvest is still running, OR its parse failed —
      // a failed harvest writes no pending record, so the only signal is the
      // activity feed. Ask the feed (ticket 154): a harvest-failed after
      // this session's harvest-started ends the poll with the sentence.
      try {
       // Today only: the harvest started this sitting, so its events are in
       // today's log, and a years-old log is not re-read every two seconds.
       const since = new Date().toISOString().slice(0, 10);
       const { events } = await deps.api<{ events: ActivityEvent[] }>(`/api/activity?since=${encodeURIComponent(since)}`);
       if (deps.screen() !== 'reviews') return;
       if (harvestFailedFor(events, pending)) {
        clearInterval(poll);
        reviewPollTimer = null;
        deps.setPendingReview(null);
        list.innerHTML = '';
        list.append(deps.el('p', { class: 'harvest-failed-note' }, HARVEST_FAILED_SENTENCE));
       }
      } catch {
       // The feed is down too — keep polling; it may still land.
      }
     }
    }, 2000);
    reviewPollTimer = poll;
   }

   // The one decision in the reviewing grammar: opening an entry loads its
   // record and hands the screen to the harvest. Shared by the row click
   // and the single-entry shortcut, so both paths stay identical.
   async function openEntry(sessionId: string): Promise<boolean> {
    try {
     const rec = await deps.api<HarvestQueueRecord>(`/api/harvest-queue/${sessionId}`);
     deps.setSessionId(rec.sessionId);
     deps.setProposals(rec.proposals);
     deps.setPendingReview(null);
     deps.renderHarvest();
     return true;
    } catch (e) {
     console.error(e);
     return false;
    }
   }

   if (data.pending.length === 0 && pending === null) {
    list.append(deps.el('p', { class: 'empty-msg' }, 'nothing awaiting review'));
    return;
   }

   // One waiting harvest and nothing being polled: open it directly instead
   // of painting a one-row list (the verb-grammar rule — a queue with one
   // item is already decided). On failure, fall back to the list.
   const only = data.pending[0];
   if (data.pending.length === 1 && pending === null && only) {
    if (await openEntry(only.sessionId)) return;
   }

   for (const entry of data.pending) {
    const row = deps.el('button', { class: 'harvest-queue-row' });
    const date = deps.el('span', { class: 'harvest-queue-date' }, relativeTime(entry.started));
    const meta = deps.el(
     'span',
     { class: 'harvest-queue-meta' },
     `${originWord(entry.origin)} \u00b7 ${entry.protocol} \u00b7 ${entry.proposalCount} proposal${entry.proposalCount === 1 ? '' : 's'}`,
    );
    row.append(date, meta);
    row.addEventListener('click', async () => {
     row.disabled = true;
     const ok = await openEntry(entry.sessionId);
     if (!ok) {
      row.disabled = false;
      list.append(deps.el('p', { class: 'empty-msg' }, 'that harvest did not load'));
     }
    });
    list.append(row);
   }
  } catch (e) {
   if (deps.screen() !== 'reviews') return;
   list.innerHTML = '';
   list.append(deps.el('p', { class: 'empty-msg' }, 'could not load the review queue'));
   console.error(e);
  }
 })();
}
