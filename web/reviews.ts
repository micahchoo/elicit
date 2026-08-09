/**
 * The review queue: finished harvests awaiting a decision. Lists the
 * harvest-queue records, polls for a still-running harvest (ticket 084 —
 * the record lands from a background server task, so the poll is real
 * time, not fakeable), and reads the activity feed when a harvest fails
 * without ever writing a record (ticket 154). Opening an entry loads its
 * record and hands the screen to the unified review grammar (wave 3) —
 * the one surface harvest review and import review now share: the
 * sitting's transcript renders whole as prose with the proposals
 * underlined in place, and the grammar's save posts the decisions.
 *
 * Injection, not import: `el`, `api` and the rest are module-private in
 * main.ts (the import-review pattern). The seam is one object literal at
 * the call site; the pure helpers (relativeTime, originWord,
 * harvest-failure, sittingReviewItem) and the shared wire types are the
 * allowed imports. The grammar is entered directly — clear, screen and
 * shell first, then renderReviewGrammar with the sitting item built from
 * the opened record; the record itself is stashed through the seam so the
 * harvest route can draw the same item (a sitting needs its record).
 */

import type { CutProposal, HarvestDecision } from '../src/types.ts';
import { relativeTime } from '../src/log/format.js';
import { originWord, type HarvestOrigin } from './provenance.js';
import { HARVEST_FAILED_SENTENCE, harvestFailedFor } from './harvest-failure.js';
import {
 reviewCountSentence,
 type ActivityEvent,
 type HarvestQueueEntry,
 type WebDepsCore,
 type WebDepsShell,
} from './deps.js';
import type { RepeatsFlag } from '../src/harvester/dedupe.ts';
import {
 renderReviewGrammar,
 type ReviewDecision,
 type ReviewGrammarItem,
 type ReviewVerb,
} from './review-grammar.js';

/**
 * `GET /api/harvest-queue/:id` — the record an opened entry loads. The
 * transcript body rides here (wave 3 S4); absent or '' when the transcript
 * is missing or unparseable, and the sitting item then builds from the
 * proposals alone.
 */
export interface SittingReviewRecord {
 sessionId: string;
 /** When the sitting started — the heading's date. */
 started: string;
 protocol: string;
 origin: HarvestOrigin;
 proposals: CutProposal[];
 /** Fragments that couldn't stand alone, with propose()'s reasons (wave 2). */
 buds?: { text: string; reason: string }[];
 /** Near-duplicate flags (Batch C2, §12.1) — which proposals repeat an
  * older passage; the receipt renders the sentence from these. */
 repeats?: RepeatsFlag[];
 transcriptBody?: string;
}

export interface ReviewsDeps extends WebDepsShell {
 screen: () => string;
 /** Browser storage — the finish-later drafts, keyed by the sitting id. */
 storage: Storage;
 setSessionId: (sessionId: string) => void;
 /** The opened record, stashed for the harvest route (a sitting needs its record). */
 setReviewRecord: (record: SittingReviewRecord) => void;
 pendingReview: () => string | null;
 setPendingReview: (sessionId: string | null) => void;
}

let reviewPollTimer: ReturnType<typeof setInterval> | null = null;

export function renderReviews(deps: ReviewsDeps) {
 deps.clear();
 deps.setScreen('review');
 deps.renderShell();

 // Re-entry must never stack timers; clearing a dead handle is a no-op.
 if (reviewPollTimer !== null) {
  clearInterval(reviewPollTimer);
  reviewPollTimer = null;
 }

 const div = deps.el('div', { class: 'screen active reviews-screen' });

 const heading = deps.el('h2', { class: 'waiting-heading' }, 'your words, kept, wait for your review');
 const list = deps.el('div', { class: 'harvest-queue-list' });
 div.append(heading, list);
 deps.main.append(div);

 const pending = deps.pendingReview();

 (async () => {
  try {
   const data = await deps.api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
   if (deps.screen() !== 'review') return;
   list.innerHTML = '';

   const landed = pending !== null && data.pending.some((e) => e.sessionId === pending);

   // The harvest we just launched has not landed yet: say so quietly and
   // poll for its record, then re-render the list once it exists.
   if (pending !== null && !landed) {
    list.append(
     deps.el(
      'p',
      { class: 'harvest-running' },
      'still reading your words — the review will appear here when it is done',
     ),
    );
    const poll = setInterval(async () => {
     if (deps.screen() !== 'review') {
      clearInterval(poll);
      reviewPollTimer = null;
      return;
     }
     try {
      await deps.api<SittingReviewRecord>(`/api/harvest-queue/${pending}`);
      if (deps.screen() !== 'review') return;
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
       if (deps.screen() !== 'review') return;
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
   // record, stashes it for the harvest route, and hands the screen to the
   // unified grammar with the sitting item built from it. Shared by the row
   // click and the single-entry shortcut, so both paths stay identical.
   async function openEntry(sessionId: string): Promise<boolean> {
    try {
     const rec = await deps.api<SittingReviewRecord>(`/api/harvest-queue/${sessionId}`);
     deps.setSessionId(rec.sessionId);
     deps.setReviewRecord(rec);
     deps.setPendingReview(null);
     deps.clear();
     deps.setScreen('harvest');
     deps.renderShell();
     renderReviewGrammar(deps, sittingReviewItem(rec, deps.api));
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
    const headline = deps.el(
     'span',
     { class: 'harvest-queue-headline' },
     reviewCountSentence(entry.proposalCount, entry.budCount ?? 0),
    );
    const meta = deps.el(
     'span',
     { class: 'harvest-queue-meta' },
     `${relativeTime(entry.started)} \u00b7 ${originWord(entry.origin)} \u00b7 ${entry.protocol}`,
    );
    if ((entry.repeatsCount ?? 0) > 0) {
     // Batch C2: the dedupe sentence rides the record — the row says so
     // before the person opens the review. The list carries only the
     // count (the date needs the detail record), so the copy here names
     // the count; the per-passage dated sentence is the detail/receipt's.
     const repeatNote = deps.el(
      'span',
      { class: 'harvest-queue-repeat' },
      `${entry.repeatsCount} ${entry.repeatsCount === 1 ? 'passage repeats' : 'passages repeat'} what you said before \u2014 keep both?`,
     );
     row.append(headline, meta, repeatNote);
    } else {
     row.append(headline, meta);
    }
    row.addEventListener('click', async () => {
     row.disabled = true;
     const ok = await openEntry(entry.sessionId);
     if (!ok) {
      row.disabled = false;
      list.append(deps.el('p', { class: 'empty-msg' }, 'that review did not load'));
     }
    });
    list.append(row);
   }
  } catch (e) {
   if (deps.screen() !== 'review') return;
   list.innerHTML = '';
   list.append(deps.el('p', { class: 'empty-msg' }, 'could not load the review queue'));
   console.error(e);
  }
 })();
}

/* ─── the sitting item for the unified grammar (wave 3) ─── */

/** The plain verdict → wire action map: the grammar speaks the four words,
 * the harvest route speaks approve/trim/restate/discard. */
const SITTING_ACTION: Record<ReviewVerb, HarvestDecision['action']> = {
 keep: 'approve',
 trim: 'trim',
 'say it again': 'restate',
 'leave out': 'discard',
};

/** One `## user` / `## agent` heading per turn, at the start of a line. */
const ROLE_HEADING = /^##\s+(user|agent)[ \t]*\r?$/gm;

type Turn = { role: 'user' | 'agent'; text: string };

/**
 * The sitting item for the unified grammar. The prose split: the transcript
 * body renders whole, user and agent turns in order, one paragraph each —
 * the `## user` / `## agent` role headings are consumed by the parser (they
 * are the body's structure, never its prose; the grammar renders paragraphs
 * verbatim, so the headings never render as text). Each proposal is located
 * inside its source turn's own text (`CutProposal.sourceTurn` indexes user
 * turns), so the underline lands where the person said it; a proposal the
 * turn does not contain degrades to the grammar's standalone block (no
 * `at`). Without a transcript body the prose is the proposals themselves,
 * each its own paragraph, underlined in place. save() maps the plain verbs
 * to the wire actions and posts them to the sitting's harvest route; the
 * grammar renders the receipt from the response.
 */
export function sittingReviewItem(record: SittingReviewRecord, api: WebDepsCore['api']): ReviewGrammarItem {
 const { prose, at } = bodyProse(record.transcriptBody, record.proposals);
 return {
  kind: 'sitting',
  id: record.sessionId,
  heading: sittingHeading(record),
  prose,
  cuts: record.proposals.map((p, i) => ({
   index: i,
   text: p.text,
   ...(at[i] !== undefined ? { at: at[i] } : {}),
  })),
  ...(record.buds !== undefined && record.buds.length > 0 ? { buds: record.buds } : {}),
  verbs: ['keep', 'trim', 'say it again', 'leave out'],
  save: async (decisions: ReviewDecision[]) => {
   const mapped: HarvestDecision[] = decisions.map((d) => ({
    proposal: d.index,
    action: SITTING_ACTION[d.action],
    ...(d.text !== undefined ? { text: d.text } : {}),
   }));
   return api<{ snippets: { prose: string; repeats?: { olderSnippetId: string; olderCaptured: string } }[] }>(`/api/session/${record.sessionId}/harvest`, { decisions: mapped });
  },
 };
}

/** The heading sentence: the sitting's date and origin, in the person's words. */
function sittingHeading(record: SittingReviewRecord): string {
 const from = relativeTime(record.started);
 const when = from.length > 0 ? ` from ${from}` : '';
 return record.origin === 'unprompted' ? `your free writing${when}` : `your sitting${when}`;
}

/** The prose and each proposal's offset — from the transcript body when it
 * parses, else from the proposals alone. */
function bodyProse(
 body: string | undefined,
 proposals: CutProposal[],
): { prose: string; at: (number | undefined)[] } {
 const turns = typeof body === 'string' && body.length > 0 ? transcriptTurns(body) : [];
 if (turns.length === 0) return proposalsProse(proposals);

 // User turns in order — `CutProposal.sourceTurn` indexes these. The start
 // accumulator mirrors the '\n\n' join below, so a proposal's offset is the
 // paragraph start plus its indexOf inside the turn's own text.
 const userTurns: { text: string; start: number }[] = [];
 let start = 0;
 for (const t of turns) {
  if (t.role === 'user') userTurns.push({ text: t.text, start });
  start += t.text.length + 2;
 }
 return {
  prose: turns.map((t) => t.text).join('\n\n'),
  at: proposals.map((p) => {
   const ut = userTurns[p.sourceTurn];
   if (!ut) return undefined;
   const i = ut.text.indexOf(p.text);
   return i >= 0 ? ut.start + i : undefined;
  }),
 };
}

/** No transcript body: the proposals are the prose, each its own paragraph,
 * at exact offsets (a proposal's text IS its paragraph). */
function proposalsProse(proposals: CutProposal[]): { prose: string; at: (number | undefined)[] } {
 const at: (number | undefined)[] = [];
 let start = 0;
 for (const p of proposals) {
  at.push(start);
  start += p.text.length + 2;
 }
 return { prose: proposals.map((p) => p.text).join('\n\n'), at };
}

/** The transcript body split into its turns: a heading opens a turn whose
 * text runs to the next heading; heading lines and their surrounding blank
 * lines are consumed. A turn with no text renders nothing. */
function transcriptTurns(body: string): Turn[] {
 const heads: { role: Turn['role']; start: number; end: number }[] = [];
 for (const m of body.matchAll(ROLE_HEADING)) {
  heads.push({ role: m[1] === 'user' ? 'user' : 'agent', start: m.index, end: m.index + m[0].length });
 }
 const turns: Turn[] = [];
 for (let i = 0; i < heads.length; i++) {
  const head = heads[i]!;
  const next = heads[i + 1];
  const text = body
   .slice(head.end, next ? next.start : body.length)
   .replace(/^\r?\n+/, '')
   .replace(/\r?\n+$/, '');
  if (text.length > 0) turns.push({ role: head.role, text });
 }
 return turns;
}
