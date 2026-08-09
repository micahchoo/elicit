/**
 * The waiting surface: what is open — the one-line offers (reach, sweep
 * backlog, coach, cadence, anniversary), the queue of open questions and
 * expeditions, the parked descents and machines, and the Activity Log
 * stream. Owns its state, render, and events; the SSE live-refresh loop in
 * main.ts re-enters renderWaiting for a whole-surface re-render, and the
 * module stays re-renderable the way the inline function was.
 *
 * Injection, not import: `el`, `api`, `beginWait` and the rest are
 * module-private in main.ts (the import-review pattern). The seam is one
 * object literal at the call site; the resume-into-a-sitting verbs
 * (sessionId, setQuestion) and the streaming fetch for the Activity Log
 * are this surface's extras beyond the shell layer.
 */

import type { QueueEntry } from '../src/types.ts';
import { formatEvent, relativeTime } from '../src/log/format.js';
import { sourceLabel } from '../src/queue/source-label.js';
import { declinePath, offerSentence, reachItNav, type ReachOfferLine } from './reach-line.js';
import { panelLine, renderPanelLine } from './panel-line.js';
import { pasteTracker } from './paste-tracker.js';
import { readableDate } from './dates.js';
import { lineageBlock } from './lineage.js';
import type { ActivityEvent, HarvestQueueEntry, QueueData, SweepBacklogResponse, WebDepsShell } from './deps.js';

/** A parked DRM picked up from the waiting surface: its first probe, shown by the DRM screen directly. */
export interface DrmResumeProbe {
 text: string;
 episode: number;
 of: number;
 step: string;
 gate: { episode: number; of: number; label: string };
}

/**
 * The parked DRM probe the last pick-up left, taken by the DRM screen when
 * it renders (the resume route already composed it). Take-then-clear, the
 * same shape survey-map's takeDeclaredRegion uses.
 */
let drmResumeProbe: DrmResumeProbe | null = null;

/** Take the parked DRM probe, or null when none is pending. */
export function takeDrmResumeProbe(): DrmResumeProbe | null {
 const probe = drmResumeProbe;
 drmResumeProbe = null;
 return probe;
}

export interface WaitingDeps extends WebDepsShell {
 /** The current screen, read after awaits — a navigation during a fetch skips the stale render. */
 screen: () => string;
 sessionId: () => string | null;
 setQuestion: (question: string) => void;
 /** Raw streaming fetch — the Activity Log reader is an SSE stream, not a JSON call. */
 fetch: typeof fetch;
}

/** The resume routes' reply, read for the one field the waiting surface uses. */
type ResumeTurn = { kind: string; text?: string };

/** A parked machine's resume reply (ticket 159, slices 5-6): a parked drm's
 * composed probe — kind plus the probe fields the DRM screen takes — or
 * another parked machine's plain probe. The drm fields are optional so one
 * shape covers both routes. */
type MachineResumeTurn = {
 kind: string;
 text?: string;
 episode?: number;
 of?: number;
 step?: string;
 gate?: { episode: number; of: number; label: string };
};

/**
 * One backlog entry's sentence (ticket 156): names the sitting the way the
 * library does — the weekday's sitting plus the human date — and the count.
 */
function sittingName(date: string, readings: number): string {
 const d = new Date(`${date}T00:00:00`);
 const day = Number.isNaN(d.getTime())
  ? date
  : d.toLocaleDateString(undefined, { weekday: 'long' });
 const human = readableDate(date) || date;
 return `${readings} ${readings === 1 ? 'reading' : 'readings'} from ${day}'s sitting (${human})`;
}

export function renderWaiting(deps: WaitingDeps): void {
 deps.clear();
 deps.setScreen('waiting');
 deps.renderShell();

 const div = deps.el('div', { class: 'screen active waiting-surface' });

 // The Reach offer (014 T14): one dimmed line, nothing on silence. The
 // cadence line's idiom exactly — the record, offered, and nothing acts on
 // it (Q-37, Q-62): `offer: null` renders nothing at all, `not now` costs
 // one click and records a decline, and `reach it` lands the map on the
 // region the offer named. One line, one region, never a list (Q-24).
 const reachLine = deps.el('div', { class: 'reach-offer' });
 div.append(reachLine);
 deps.api<{ offer: ReachOfferLine | null; root: string | null }>('/api/reach')
  .then((r) => {
   if (r.offer === null) {
    renderPanelLine(reachLine, panelLine('none', 'the reach')); // silence renders nothing
    return;
   }
   renderPanelLine(reachLine, panelLine('offer', 'the reach', offerSentence(r.offer) ?? ''));
   const reachIt = deps.el('button', { class: 'reach-action', type: 'button' }, 'reach it');
   const notNow = deps.el('button', { class: 'reach-action', type: 'button' }, 'not now');
   reachIt.addEventListener('click', () => {
    const nav = reachItNav(r.offer!.path);
    deps.navTo(nav.screen, { focus: nav.focus, ...(r.root !== null ? { folder: r.root } : {}) });
   });
   notNow.addEventListener('click', async () => {
    try {
     await deps.api(declinePath(), { path: r.offer!.path });
    } catch {
     // The offer stays; a failed record must not put a second line anywhere.
    }
    reachLine.replaceChildren(); // gone for this render — :empty hides it
   });
  reachLine.append(' ', reachIt, ' · ', notNow);
 })
 .catch(() => {
  renderPanelLine(reachLine, panelLine('error', 'the reach'));
 });

// The sweep backlog (ticket 139): one dimmed line when readings pile up
// unswept, nothing at zero — the reach offer's idiom (Q-24): at most one
// line, never a list. Three states via the shared helper (ticket 154): an
// offer, nothing, or one muted error line. The `sweep-backlog-line`
// element and class stay stable — the press-target wave builds on them.
const sweepLine = deps.el('div', { class: 'sweep-backlog-line' });
div.append(sweepLine);
deps.api<SweepBacklogResponse>('/api/sweep-backlog')
 .then((r) => {
  if (r.pendingReadings <= 0) {
   renderPanelLine(sweepLine, panelLine('none', 'the backlog'));
   return;
  }
  renderPanelLine(sweepLine, panelLine('offer', 'the backlog', `the wiki is ${r.pendingReadings} readings behind`));
  // The door (ticket 156): in the offer state the line is a press target —
  // one muted word, and the line itself. It expands in place to the dated
  // list of sittings and the catch-up nudge. The error state never expands.
  sweepLine.classList.add('pressable');
  const see = deps.el('button', { class: 'nav-link sweep-backlog-door', type: 'button' }, 'see which');
  sweepLine.append(' ', see);
  const expand = () => {
   if (sweepLine.querySelector('.sweep-backlog-panel')) return;
   see.remove();
   sweepLine.classList.remove('pressable');
   const panel = deps.el('div', { class: 'sweep-backlog-panel' });
   for (const s of r.sittings) {
    panel.append(deps.el('p', { class: 'sweep-backlog-sitting' }, sittingName(s.date, s.readings)));
   }
   // The nudge arm (ticket 156, 151): one call clears the stop switch and
   // schedules the drain. On success the nudge becomes a quiet line — the
   // drain runs behind the scenes and the activity feed shows it. A failed
   // call keeps the nudge and shows the wait's quiet error.
   const nudge = deps.el('div', { class: 'sweep-backlog-nudge' });
   const resume = deps.el('button', { class: 'nav-link', type: 'button' }, 'let it catch up now');
   nudge.append(resume);
   resume.addEventListener('click', () => {
    void (async () => {
     resume.disabled = true;
     const wait = deps.beginWait(nudge, 'letting it catch up\u2026');
     try {
      await deps.api('/api/jobs/resume', {});
      wait.done();
      nudge.replaceChildren(deps.el('span', { class: 'sweep-backlog-catchup' }, 'it is catching up'));
     } catch (e) {
      wait.failed(e);
      resume.disabled = false;
     }
    })();
   });
   panel.append(nudge);
   sweepLine.append(panel);
  };
  see.addEventListener('click', (ev) => {
   ev.stopPropagation();
   expand();
  });
  sweepLine.addEventListener('click', expand);
 })
 .catch(() => {
  renderPanelLine(sweepLine, panelLine('error', 'the backlog'));
 });
// The Coach surface (090 T11): at most one dimmed offer line, and one
// quiet line per coached Direction with something new (Q-37, Q-76).
// `offer: null` and an empty lines list render nothing at all; the offer's
// accept word posts /direction — the ONLY door (Q-73) — then lands on the
// page; its decline word records the decline, and silence does nothing.
const coachLine = deps.el('div', { class: 'coach-waiting' });
div.append(coachLine);
deps.api<{ offer: { slug: string; name: string; sentence: string } | null; lines: { slug: string; sentence: string }[] }>('/api/coach/waiting')
 .then((r) => {
  if (r.offer === null && r.lines.length === 0) {
   renderPanelLine(coachLine, panelLine('none', 'the coach'));
   return;
  }
  if (r.offer !== null) {
   const offer = deps.el('p', { class: 'coach-offer-line' }, r.offer.sentence);
   const accept = deps.el('button', { class: 'coach-word', type: 'button' }, 'take up');
   const decline = deps.el('button', { class: 'coach-word', type: 'button' }, 'not this');
   accept.addEventListener('click', () => {
    deps.api<{ direction: { slug: string } }>('/api/coach/direction', { name: r.offer!.name })
     .then(() => deps.navTo('coach', { slug: r.offer!.slug }))
     .catch(() => { /* a failed declaration shows nothing */ });
   });
   decline.addEventListener('click', () => {
    deps.api(`/api/coach/direction/${r.offer!.slug}/decline-offer`).catch(() => { /* record, not load-bearing */ });
    offer.replaceChildren(); // gone for this render — :empty hides it
   });
   offer.append(' ', accept, ' · ', decline);
   coachLine.append(offer);
  }
  for (const line of r.lines) {
   const p = deps.el('p', { class: 'coach-quiet-line' }, line.sentence);
   const open = deps.el('button', { class: 'coach-word', type: 'button' }, 'open');
   open.addEventListener('click', () => deps.navTo('coach', { slug: line.slug }));
   p.append(' ', open);
   coachLine.append(p);
  }
 })
 .catch(() => { renderPanelLine(coachLine, panelLine('error', 'the coach')); });


// ── The on-this-day card (ticket 115): one draw per page load ──
// An offer under Q-62: the card renders only when the anniversary endpoint
const anniversaryCard = deps.el('div', { class: 'anniversary-card' });
div.append(anniversaryCard);
deps.api<{ question: string; snippetQuestion?: string; context?: string; draw: { kind: string; wroteAt: string; snippetId: string } } | null>('/api/anniversary')
 .then((draw) => {
  if (!draw) {
   renderPanelLine(anniversaryCard, panelLine('none', 'the anniversary'));
   return;
  }
  // Parse the question: "${date} (${ago}):\n\n"${prose}""
  const nl = draw.question.indexOf('\n\n');
  const dateLine = nl >= 0 ? draw.question.slice(0, nl) : draw.question;
  const prose = nl >= 0 ? draw.question.slice(nl + 3).replace(/^"|"$/g, '') : '';

  // Lineage: the eliciting question and context, dimmed
  const lineage = lineageBlock(deps.el, draw.snippetQuestion, draw.context);
  if (lineage) anniversaryCard.append(lineage);

  const dateEl = deps.el('p', { class: 'anniversary-date' }, dateLine);
  anniversaryCard.append(dateEl);

  const quoteEl = deps.el('blockquote', { class: 'anniversary-quote' }, prose);
  anniversaryCard.append(quoteEl);

  const actions = deps.el('div', { class: 'anniversary-actions' });
  const readWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'read');
  const notNow = deps.el('button', { class: 'nav-link', type: 'button' }, 'not now');
  readWord.addEventListener('click', () => deps.navTo('wiki'));
  notNow.addEventListener('click', () => anniversaryCard.replaceChildren());
  actions.append(readWord, ' \u00b7 ', notNow);
  anniversaryCard.append(actions);
 })
 .catch(() => { renderPanelLine(anniversaryCard, panelLine('error', 'the anniversary')); });
// Parked section — parked-sounding pointers waiting to be picked up (012 T12).
 // Dormancy is signal, never debt (Q-24): each row shows the last rung's
 // question and how many rungs are kept, with no age colouring and nothing
 // that reads as owed work. The section stays hidden when nothing is parked.
 const parkedSection = deps.el('div', { class: 'waiting-section parked-section' });
 const parkedHeading = deps.el('h2', { class: 'waiting-heading' }, 'parked');
 const parkedList = deps.el('div', { class: 'parked-list' });
 parkedSection.append(parkedHeading, parkedList);

// Region two — waits: what is open, under the sitting controls.
const waitsSection = deps.el('div', { class: 'home-section waits-section' });
const waitsHeading = deps.el('h2', { class: 'home-heading' }, 'waits for you');

// Cadence — one sentence, at the top, above the lists (ticket 056).
// The document rule: a line of text on a page, not a widget. It carries no
// control, no colour and no comparison; a long gap reads exactly like a
// short one, because dormancy is signal and never debt (Q-24). The wording
// is composed server-side so it is testable — see src/log/cadence.ts.
const cadenceLine = deps.el('div', { class: 'cadence-line' });
deps.api<{ sentence: string }>('/api/cadence')
 .then((r) => { renderPanelLine(cadenceLine, panelLine('offer', 'the cadence', r.sentence)); })
 .catch(() => { renderPanelLine(cadenceLine, panelLine('error', 'the cadence')); });

// The review queue, as a sentence below the cadence (the verb-grammar
// rule): what waits is said, with one control word at the point of
// attention. The `:empty` rule keeps it off the page until a harvest
// actually waits; a failed read says so in the muted error line (154).
const reviewsLine = deps.el('div', { class: 'waiting-reviews-line' });

// Expedition section — entries with horizon 'days' waiting to go out
const expSection = deps.el('div', { class: 'waiting-section expedition-section' });
const expHeading = deps.el('h2', { class: 'waiting-heading' }, 'out in the world');
const expList = deps.el('div', { class: 'expedition-list' });
expSection.append(expHeading, expList);

// Queue section — entries with horizon 'session' waiting to be drawn
const queueSection = deps.el('div', { class: 'waiting-section' });
const queueHeading = deps.el('h2', { class: 'waiting-heading' }, 'open questions');
const queueList = deps.el('div', { class: 'queue-list' });
queueSection.append(queueHeading, queueList);


waitsSection.append(waitsHeading, cadenceLine, reviewsLine, expSection, queueSection);

// Region three — activity: the stream, folded to its newest lines.
const activitySection = deps.el('div', { class: 'home-section activity-section' });
const activityHeading = deps.el('h2', { class: 'home-heading' }, 'activity');
const activityList = deps.el('div', { class: 'activity-list' });
const moreWord = deps.el('button', { class: 'nav-link activity-more', type: 'button' }, 'more');
moreWord.hidden = true;
moreWord.addEventListener('click', () => {
 for (const l of activityList.querySelectorAll<HTMLElement>('.activity-line')) l.hidden = false;
 moreWord.hidden = true;
});
activitySection.append(activityHeading, activityList, moreWord);

// No initial events yet — show a quiet empty message until the SSE
// snapshot arrives (removed below when real events show up).
let emptyMsg: HTMLParagraphElement | null = deps.el('p', { class: 'empty-msg' }, 'nothing yet');
activityList.append(emptyMsg);

function syncEmptyActivity() {
 const hasLines = activityList.querySelector('.activity-line') !== null;
 if (hasLines && emptyMsg) {
  emptyMsg.remove();
  emptyMsg = null;
 } else if (activityList.children.length === 0) {
  emptyMsg = deps.el('p', { class: 'empty-msg' }, 'nothing yet');
  activityList.append(emptyMsg);
 }
}

 div.append(waitsSection, parkedSection, activitySection);
 deps.main.append(div);

// What wants the person, as a sentence with one word in it — the same
// call the old mode page made for its count. A failed read says so in the
// muted error line (154).
(async () => {
 try {
  const data = await deps.api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
  if (deps.screen() !== 'waiting') return;
  if (data.pending.length === 0) return;
  const n = data.pending.length;
  const readWord = deps.el('button', { class: 'nav-link' }, 'read them');
  readWord.addEventListener('click', () => deps.navTo('reviews'));
  reviewsLine.append(
   deps.text(`${n} harvest${n === 1 ? ' waits' : 's wait'} for your review \u2014 `),
   readWord,
   deps.text('.'),
  );
 } catch {
  renderPanelLine(reviewsLine, panelLine('error', 'the inbox'));
 }
})();

// One open question, with its two quiet verbs (ruled 2026-08-04): answer it
// in writing right here, or park it until later. Both rows are built by
// these two helpers so park and put-back can move a question between the
// lists without re-rendering the page (a re-render would stack SSE readers).
function openQuestionRow(entry: QueueEntry): HTMLElement {
 const row = deps.el('div', { class: 'queue-entry' });
 const question = deps.el('span', { class: 'queue-question' }, entry.question);
 // Where the question came from, in words. No queue `source` literal
 // reaches the DOM — `contradiction-remeasure` announcing itself as a
 // re-measure is the verification Q-15 forbids.
 const meta = deps.el('span', { class: 'queue-meta' }, `${sourceLabel(entry.source)} · ${entry.horizon}`);
 const words = deps.el('span', { class: 'queue-words' });
 const answerWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'answer');
 const parkWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'park');
 words.append(answerWord, ' · ', parkWord);
 row.append(question, meta, words);

 let editor: HTMLTextAreaElement | null = null;
 let sendWord: HTMLButtonElement | null = null;
 answerWord.addEventListener('click', () => {
  if (editor) {
   // A second press on answer closes the editor, keeping what was typed out
   // of flight — the same cancel gesture trim uses everywhere else.
   editor.remove();
   sendWord?.remove();
   editor = null;
   sendWord = null;
   return;
  }
  editor = deps.el('textarea', { class: 'queue-answer-editor', placeholder: 'answer in your own words…' });
  const tracker = pasteTracker(editor);
  sendWord = deps.el('button', { class: 'nav-link queue-answer-confirm', type: 'button' }, 'send it');
  row.append(editor, sendWord);
  editor.focus();
  sendWord.addEventListener('click', () => {
   const text = editor!.value.trim();
   if (!text) {
    editor!.focus();
    return;
   }
   sendWord!.disabled = true;
   const wait = deps.beginWait(row, 'reading what you wrote…');
   void deps.api(`/api/queue/${entry.id}/answer`, { text, channel: tracker.isPasted(text) ? 'pasted' : 'typed' })
    .then(() => {
     wait.done();
     row.replaceChildren(
      deps.el('span', { class: 'queue-meta' }, 'answered — its harvest will reach your inbox for review.'),
     );
    })
    .catch((cause: unknown) => {
     sendWord!.disabled = false;
     wait.failed(cause);
    });
  });
 });

 parkWord.addEventListener('click', () => {
  parkWord.disabled = true;
  const wait = deps.beginWait(row, 'parking…');
  void deps.api(`/api/queue/${entry.id}/park`, {})
   .then(() => {
    wait.done();
    row.remove();
    parkedSection.hidden = false;
    parkedList.append(parkedQuestionRow(entry));
    if (queueList.querySelector('.queue-entry') === null) {
     queueList.append(deps.el('p', { class: 'empty-msg' }, 'nothing waiting'));
    }
   })
   .catch((cause: unknown) => {
    parkWord.disabled = false;
    wait.failed(cause);
   });
 });

 return row;
}

/** One parked row — question, meta, verb — for every parked thing: a
 * put-back question, a parked descent, a parked machine. The DOM is the
 * same three slots; the verb's action is the only difference. */
function parkedRow(
 deps: WaitingDeps,
 entry: QueueEntry,
 opts: { meta: string; verb: string; onPickUp: ParkedRowAction },
): HTMLElement {
 const row = deps.el('div', { class: 'parked-entry' });
 const question = deps.el('span', { class: 'parked-question' }, entry.question);
 const meta = deps.el('span', { class: 'parked-meta' }, opts.meta);
 const verbWord = deps.el('button', { class: 'nav-link', type: 'button' }, opts.verb);
 row.append(question, meta, verbWord);
 verbWord.addEventListener('click', () => void opts.onPickUp({ row, verbWord }));
 return row;
}

/** A parked row's verb action: the row and its verb word. Throwing
 * re-enables the verb; the action owns its waiting affordance. */
type ParkedRowAction = (c: { row: HTMLElement; verbWord: HTMLButtonElement }) => Promise<void>;

/** The pick-up skeleton the parked descent and machine rows share: a
 * sitting must be under way to resume into (else the mode screen starts
 * one), the waiting affordance covers the resume call, and a probe reply
 * hands off. The rows diverge only in the resume wire and the probe
 * dispatch. */
async function pickUpParked<T extends { kind: string }>(
 deps: WaitingDeps,
 c: { row: HTMLElement; verbWord: HTMLButtonElement },
 resume: () => Promise<T>,
 onProbe: (res: T) => void,
): Promise<void> {
 if (!deps.sessionId()) {
  // A sitting must be under way to resume into (the plan's upstream
  // contract); the mode screen is where one begins.
  deps.navTo('mode');
  return;
 }
 c.verbWord.disabled = true;
 const wait = deps.beginWait(c.row, 'picking it up\u2026');
 try {
  const res = await resume();
  wait.done();
  onProbe(res);
 } catch (e) {
  c.verbWord.disabled = false;
  wait.failed(e);
 }
}

// A parked question rests here — no age, no colouring (Q-24) — until it
// is put back among the open ones (the expiry clock restarts server-side).
function parkedQuestionRow(entry: QueueEntry): HTMLElement {
 return parkedRow(deps, entry, {
  meta: 'a question you set aside',
  verb: 'put it back',
  onPickUp: async ({ row, verbWord }) => {
   verbWord.disabled = true;
   const wait = deps.beginWait(row, 'putting it back…');
   try {
    await deps.api(`/api/queue/${entry.id}/unpark`, {});
    wait.done();
    row.remove();
    queueList.querySelector('.empty-msg')?.remove();
    queueList.append(openQuestionRow(entry));
    if (parkedList.querySelector('.parked-entry') === null) parkedSection.hidden = true;
   } catch (cause) {
    verbWord.disabled = false;
    wait.failed(cause);
   }
  },
 });
}

// Load the lists — one /api/queue read carries the open/expedition
// lists and the parked pointers (QueueData carries open + parked together).
(async () => {
 const waitQueue = deps.beginWait(queueList, 'looking…', 400);
 const waitParked = deps.beginWait(parkedList, 'looking…', 400);
 try {
  const data = await deps.api<QueueData>('/api/queue');
  waitQueue.done();
  waitParked.done();
  queueList.innerHTML = '';
  expList.innerHTML = '';
  parkedList.innerHTML = '';

  const expeditions = data.open.filter((e) => e.horizon === 'days');
  // Parked machines (a parked drm among them, ticket 159 slice 6) are
  // pointers, not questions — they rest in the parked section below.
  const pending = data.open.filter((e) => e.horizon !== 'days' && e.source !== 'parked-sounding' && e.source !== 'parked-machine');

  if (expeditions.length > 0) {
   for (const entry of expeditions) {
    const row = deps.el('div', { class: 'expedition-entry' });
    const question = deps.el('span', { class: 'expedition-question' }, entry.question);
    const age = deps.el('span', { class: 'expedition-age' }, relativeTime(entry.created));
    row.append(question, age);
    expList.append(row);
   }
  }

  if (pending.length === 0) {
   queueList.append(deps.el('p', { class: 'empty-msg' }, 'nothing waiting'));
  } else {
   for (const entry of pending) {
    queueList.append(openQuestionRow(entry));
   }
  }

  // The parked pointers arrive inside `open` (horizon 'session'); the source
  // filter keeps them out of the questions list so nothing appears twice.
  const parked = data.open.filter((e) => e.source === 'parked-sounding');

  if (parked.length > 0) {
   for (const entry of parked) {
    parkedList.append(parkedRow(deps, entry, {
     meta: `${entry.rungsKept ?? 0} rungs kept`,
     verb: 'pick it up',
     onPickUp: (c) => pickUpParked(deps, c,
      () => deps.api<ResumeTurn>(`/api/session/${deps.sessionId()}/sounding/resume`, { queueEntryId: entry.id }),
      (res) => {
       if (res.kind === 'probe') {
        deps.setQuestion(res.text!);
        deps.navTo('exchange');
       }
      },
     ),
    }));
   }
  }

  // Parked MACHINES (ticket 159, slices 5-6): a parked instrument rests
  // here until picked back up. A parked drm resumes through the drm wire
  // into the DRM screen's probe UI; any other parked machine resumes into
  // the exchange through the machine resume route.
  const parkedMachines = data.open.filter((e) => e.source === 'parked-machine');
  for (const entry of parkedMachines) {
   parkedList.append(parkedRow(deps, entry, {
    meta: sourceLabel(entry.source),
    verb: 'pick it up',
    onPickUp: (c) => pickUpParked(deps, c,
     () => entry.machineProtocol === 'drm'
      ? deps.api<MachineResumeTurn>(`/api/session/${deps.sessionId()}/drm/resume`, { queueEntryId: entry.id })
      : deps.api<MachineResumeTurn>(`/api/session/${deps.sessionId()}/machine/resume`, { queueEntryId: entry.id }),
     (res) => {
      if (entry.machineProtocol === 'drm') {
       if (res.kind === 'drm-probe') {
        drmResumeProbe = {
         text: res.text ?? '',
         episode: res.episode ?? 1,
         of: res.of ?? 1,
         step: res.step ?? '',
         gate: res.gate ?? { episode: 1, of: 1, label: '' },
        };
        deps.navTo('drm');
       }
      } else if (res.kind === 'probe') {
       deps.setQuestion(res.text!);
       deps.navTo('exchange');
      }
     },
    ),
   }));
  }

  // Parked QUESTIONS (ruled 2026-08-04) share the section with the parked
  // descents: same quiet register, but their way back is `put it back`,
  // not a resume into a sitting.
  const parkedQuestions = data.parked ?? [];
  for (const entry of parkedQuestions) {
   parkedList.append(parkedQuestionRow(entry));
  }

  if (parked.length === 0 && parkedMachines.length === 0 && parkedQuestions.length === 0) {
   // Nothing parked: the section stays quiet — no empty heading, no count
   // of how long anything has sat (Q-24).
   parkedSection.hidden = true;
  }
 } catch (e) {
  waitQueue.done();
  waitParked.done();
  queueList.innerHTML = '';
  parkedList.innerHTML = '';
  queueList.append(deps.el('p', { class: 'empty-msg' }, 'could not load what is waiting'));
  parkedList.append(deps.el('p', { class: 'empty-msg' }, 'could not load what is waiting'));
  console.error(e);
 }
})();

// Connect activity SSE
(async () => {
 try {
  const resp = await deps.fetch('/api/activity', {
   method: 'GET',
   headers: { Accept: 'text/event-stream' },
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   buffer += decoder.decode(value, { stream: true });

   // Parse SSE events
   const lines = buffer.split('\n');
   buffer = lines.pop() ?? '';
   let currentData = '';
   for (const line of lines) {
    if (line.startsWith('data: ')) {
     currentData = line.slice(6);
    } else if (line.startsWith(': heartbeat')) {
     // Historical batch flushed — settle the empty state.
     syncEmptyActivity();
    } else if (line === '' && currentData) {
     try {
      const ev: ActivityEvent = JSON.parse(currentData);
      const lineEl = deps.el('div', { class: 'activity-line' });
      const actor = deps.el('span', { class: 'activity-actor' }, ev.actor);
      const detail = deps.el('span', { class: 'activity-detail' }, formatEvent(ev));
      lineEl.append(actor, ' ', detail);
      const age = relativeTime(ev.at);
      if (age) lineEl.append(' ', deps.el('span', { class: 'activity-age' }, age));
      activityList.prepend(lineEl);
      syncEmptyActivity();
      // Keep the newest eight lines; fold the rest behind the more word.
      const shown = activityList.querySelectorAll<HTMLElement>('.activity-line');
      for (const old of Array.from(shown).slice(8)) old.hidden = true;
      moreWord.hidden = shown.length <= 8;
     } catch { /* skip malformed */ }
     currentData = '';
    }
   }
  }
 } catch { /* SSE connection failed silently */ }
})();

}
