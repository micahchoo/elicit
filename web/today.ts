/**
 * The Today surface — wave 1 of the redesign (docs/redesign-2026-08-08.md
 * §5.2): a dated page in sentences, one section per viewport of the
 * scroll. Viewport one is begin — or the door when a sitting is open —
 * viewport two is what waits, viewport three is the activity stream.
 *
 * Ports the waiting surface's queue rows, offer panels and SSE activity
 * reader and the mode surface's begin, fresh-start and stop-jobs flows
 * (web/waiting.ts and web/mode.ts die with this wave). The module stays
 * re-renderable the way the waiting surface was: it owns its state,
 * render and events, and the activity reader refreshes the stream in
 * place — the live-refresh loop never re-enters renderToday (web/live.ts
 * drops today from LIVE_SCREENS), so the inline answer editors are never
 * rebuilt mid-write.
 *
 * Injection, not import: every verb arrives through the TodayDeps object
 * literal at the call site (the seam, web/deps.ts). main.ts builds it
 * with the makeSessionHandle factory, the browser storage (the one-time
 * profile ask) and raw fetch (the Activity Log's SSE reader).
 */

import type { QueueEntry } from '../src/types.ts';
import { formatEvent, relativeTime } from '../src/log/format.js';
import { sourceLabel } from '../src/queue/source-label.js';

import { backlogSentence, panelLine, renderPanelLine } from './panel-line.js';
import { pasteTracker } from './paste-tracker.js';
import { readableDate } from './dates.js';

import {
  applySessionResponse,
  clearFirstLaunch,
  reviewCountSentence,
  setDrmResumeProbe,
  setDrmWalk,
  type ActivityEvent,
  type EndResponse,
  type HarvestQueueEntry,
  type QueueData,
  type SessionResponse,
  type SessionState,
  type SweepBacklogResponse,
  type WebDepsShell,
} from './deps.js';

/** The Today surface's deps: the shell seam plus the writable session-state
 *  handle (makeSessionHandle), the pending-review verbs, browser storage
 *  (the one-time profile ask) and raw fetch (the Activity Log reader). */
export interface TodayDeps extends WebDepsShell {
  /** The current screen, read after awaits — a navigation during a fetch skips the stale render. */
  screen: () => string;
  session: SessionState;
  pendingReview: () => string | null;
  setPendingReview: (v: string | null) => void;
  /** Browser storage — the 'profile-asked' flag (the one storage seam, F3). */
  storage: Storage;
  /** Raw streaming fetch — the Activity Log reader is an SSE stream, not a JSON call. */
  fetch: typeof fetch;
}


/** The count sentence's tap — the shared copy (deps.ts) ends with these words.
 *  The door renders them as the button that opens the review. */
const REVIEW_TAP = 'read them now?';

/** The close-it poll (wave 2): the pending record lands behind /end
 *  (ticket 084), so the count needs the queue list polled until it does.
 *  The window is bounded — a record that does not land in time is waiting
 *  on review anyway, and review's own poll (reviews.ts) takes over. */
const CLOSE_POLL_MS = 2000;
const CLOSE_POLL_ATTEMPTS = 5;

/** The close-it poll handle, cleared on re-render so a stale poll never
 *  writes into a detached door (the review poll timer pattern, reviews.ts). */
let closePollTimer: ReturnType<typeof setInterval> | null = null;

/** The resume routes' reply, read for the one field the surface uses. */
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

/** GET /api/import/next — the next piece (with how many still wait), or null. */
type ImportNextResponse = { item: { remaining: number } | null; waiting?: string };

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

export function renderToday(deps: TodayDeps): void {
  deps.clear();
  deps.setScreen('today');
  deps.renderShell();
  // A stale juxtaposition from a previous sitting must not leak into a new one.
  deps.session.setJuxtaposition(null);
  // Re-entry must never stack timers; clearing a dead handle is a no-op.
  if (closePollTimer !== null) clearInterval(closePollTimer);
  closePollTimer = null;

  const div = deps.el('div', { class: 'screen active today-surface' });

  /* ── Viewport one — begin ── */

  const beginViewport = deps.el('section', { class: 'today-viewport today-begin' });
  const dateHeading = deps.el(
    'h1',
    { class: 'today-date' },
    new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  );
  // The cadence sentence sits under the date ("Last sitting 3 days ago, 4 in
  // the last month.") — a long absence reads exactly like a short one (Q-24).
  // The wording is composed server-side (src/log/cadence.ts); the surface
  // renders the sentence it receives.
  const cadenceLine = deps.el('div', { class: 'today-cadence' });
  deps.api<{ sentence: string }>('/api/cadence')
    .then((r) => { renderPanelLine(cadenceLine, panelLine('offer', 'the cadence', r.sentence)); })
    .catch(() => { renderPanelLine(cadenceLine, panelLine('error', 'the cadence')); });

  const beginBlock = deps.el('div', { class: 'today-begin-block' });
  beginViewport.append(dateHeading, cadenceLine, beginBlock);

  // The one-word begin — one tap, no form, no ceremony (canon §5.2).
  const beginBtn = deps.el('button', { class: 'today-begin-btn', type: 'button' }, 'begin');

  // The door set, dimmed below begin — the three doors that pass the door
  // test (§10). The protocol pick died: the server draws (rotation). The
  // walk door runs the same begin flow, then lands on the room's walk
  // furniture (drmWalk set) whose own begin starts the walk against the
  // new session id.
  const doorSet = deps.el('div', { class: 'today-aside' });
  const walkLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'walk back through yesterday');
  const writeLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'just write');
  const shuffleLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'shuffle a deck');
  doorSet.append(
    walkLink,
    deps.text(' \u00b7 '),
    writeLink,
    deps.text(' \u00b7 '),
    shuffleLink,
  );

  const errorSlot = deps.el('div', { class: 'error-slot' });

  /** POST /api/session and write the reply into state. The body carries
   *  no mode — the server defaults target 'self' (canon §9 wave 1). Shared
   *  by begin and the parked pick-ups (a pick-up begins a sitting when
   *  none is under way). Returns whether the sitting is under way. */
  async function startSitting(shuffle: boolean, waitSlot: HTMLElement): Promise<boolean> {
    const wait = deps.beginWait(waitSlot, shuffle ? 'shuffling\u2026' : 'finding a question\u2026');
    try {
      // No mode on the wire: the server defaults target 'self' (canon §9
      // wave 1); shuffle is the only variation that survives.
      const body: { shuffle?: boolean } = shuffle ? { shuffle: true } : {};
      const res = await deps.api<SessionResponse>('/api/session', body);
      applySessionResponse(deps.session, res);
      wait.done();
      return true;
    } catch (e) {
      wait.failed(e);
      return false;
    }
  }

  function begin(shuffle: boolean, walk = false): void {
    beginBtn.disabled = true;
    walkLink.disabled = true;
    shuffleLink.disabled = true;
    errorSlot.innerHTML = '';
    void startSitting(shuffle, errorSlot).then((ok) => {
      if (!ok) {
        beginBtn.disabled = false;
        walkLink.disabled = false;
        shuffleLink.disabled = false;
        return;
      }
      // The day-walk discriminator (owner decision 1): the walk door's
      // sitting lands on the room's walk furniture; begin and shuffle land
      // on the sitting grammar.
      setDrmWalk(walk);
      deps.navTo('room');
    });
  }
  beginBtn.addEventListener('click', () => begin(false));
  // The walk door runs the same begin flow, then lands on the room's walk
  // furniture (drmWalk set) whose own begin starts the walk against the
  // new session id.
  walkLink.addEventListener('click', () => begin(false, true));
  // The blank page: no sitting under way — the room owns the sessionless
  // state, so the id must already be null for its blank furniture to take.
  writeLink.addEventListener('click', () => {
    deps.session.setSessionId(null);
    deps.navTo('room');
  });
  shuffleLink.addEventListener('click', () => begin(true));

  // The door: when a sitting is open it replaces begin. Two open sittings is
  // a state the product does not have — the server answers with the most
  // recent live sitting, and return finds it again after a reload. Close is
  // silent and mechanical: the end runs, the count sentence is wave 2.
  const door = deps.el('div', { class: 'today-door' });
  door.append(
    deps.el('p', { class: 'today-door-sentence' }, 'A sitting is open \u2014 you left mid-thought \u00b7 '),
  );
  const returnWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'return');
  const closeWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'close it');
  door.append(returnWord, deps.text(' / '), closeWord);

  // Checked before begin is painted: the door replaces begin, never sits
  // under it. A failed check fails open — begin still renders.
  void deps.api<{ sessionId: string | null }>('/api/session/open', undefined, { method: 'GET' })
    .then((r) => {
      if (deps.screen() !== 'today') return;
      if (r.sessionId === null) {
        beginBlock.append(beginBtn, doorSet, errorSlot);
        return;
      }
      const openId = r.sessionId;
      returnWord.addEventListener('click', () => {
        deps.session.setSessionId(openId);
        // The room discriminates internally; a walk never sits open (the
        // gate closes it), so return always lands on the sitting grammar.
        deps.navTo('room');
      });
      closeWord.addEventListener('click', () => {
        closeWord.disabled = true;
        const wait = deps.beginWait(door, 'closing\u2026');
        void (async () => {
          try {
            // The end itself, with the helper's exact semantics (deps.ts):
            // the session is parked in review only when the harvest runs
            // behind the response. An 'empty' sitting was deleted
            // server-side — no record will ever land, so nothing is parked
            // and review shows the plain queue (the zero sentence), exactly
            // the wave-1 hand-off.
            const res = await deps.api<EndResponse>(`/api/session/${openId}/end`);
            // The first sitting can end on Today's door too (owner decision
            // 6): the promise line leaves with it.
            clearFirstLaunch();
            if (res.status === 'empty') {
              wait.done();
              deps.navTo('review');
              return;
            }
            deps.setPendingReview(openId);
            // The count needs the pending record, which lands behind the
            // response (ticket 084) — poll the queue list the way reviews.ts
            // does, then swap the door for the count sentence. Bounded: a
            // record that does not land in time is waiting on review anyway,
            // so the quiet fallback is the wave-1 landing (the parked
            // session, and review's own poll takes over there).
            let attempts = 0;
            const poll = setInterval(async () => {
              if (deps.screen() !== 'today') {
                clearInterval(poll);
                closePollTimer = null;
                return;
              }
              attempts += 1;
              try {
                const data = await deps.api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
                if (deps.screen() !== 'today') return;
                const landed = data.pending.find((e) => e.sessionId === openId);
                if (landed) {
                  clearInterval(poll);
                  closePollTimer = null;
                  deps.setPendingReview(null);
                  wait.done();
                  const readNow = deps.el('button', { class: 'nav-link', type: 'button' }, REVIEW_TAP);
                  readNow.addEventListener('click', () => deps.navTo('review'));
                  const sentence = reviewCountSentence(landed.proposalCount, landed.budCount ?? 0);
                  // The zero sentence ("Nothing waits for your review.") does
                  // not end in the tap tail — render it whole, tappable.
                  const endsInTap = sentence.endsWith(REVIEW_TAP);
                  door.replaceChildren(
                    deps.el(
                      'p',
                      { class: 'today-door-sentence' },
                      deps.text(endsInTap ? sentence.slice(0, -REVIEW_TAP.length) : sentence),
                      readNow,
                    ),
                  );
                  return;
                }
              } catch {
                // The queue is down — keep polling; the record may still land.
              }
              if (attempts >= CLOSE_POLL_ATTEMPTS) {
                clearInterval(poll);
                closePollTimer = null;
                wait.done();
                deps.navTo('review');
              }
            }, CLOSE_POLL_MS);
            closePollTimer = poll;
          } catch (e) {
            wait.failed(e);
            closeWord.disabled = false;
          }
        })();
      });
      beginBlock.append(door);
    })
    .catch(() => {
      beginBlock.append(beginBtn, doorSet, errorSlot);
    });

  /* ── Viewport two — what waits ── */

  const waitsViewport = deps.el('section', { class: 'today-viewport today-waits' });
  waitsViewport.append(deps.el('h2', { class: 'today-heading' }, 'what waits'));

  // Reviews first — the count sentence, with one word in it. A zero reads
  // as a sentence (rule 5); a failed read says so quietly (154).
  const reviewsLine = deps.el('div', { class: 'today-reviews-line' });
  waitsViewport.append(reviewsLine);
  void (async () => {
    try {
      const data = await deps.api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
      if (deps.screen() !== 'today') return;
      const n = data.pending.length;
      if (n === 0) {
        reviewsLine.append(deps.text('Nothing waits for your review.'));
        return;
      }
      const readWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'read them');
      readWord.addEventListener('click', () => deps.navTo('review'));
      reviewsLine.append(
        deps.text(`${n} ${n === 1 ? 'sitting waits' : 'sittings wait'} for your review \u2014 `),
        readWord,
        deps.text('.'),
      );
    } catch {
      renderPanelLine(reviewsLine, panelLine('error', 'the reviews'));
    }
  })();

  // Open questions — answerable in writing right here, or parked for later.
  const queueSection = deps.el('div', { class: 'today-section' });
  queueSection.append(deps.el('h3', { class: 'today-subheading' }, 'open questions'));
  const queueList = deps.el('div', { class: 'queue-list' });
  queueSection.append(queueList);
  waitsViewport.append(queueSection);

  // Errands in the world — entries with horizon 'days', waiting to go out.
  const errandsSection = deps.el('div', { class: 'today-section' });
  errandsSection.append(deps.el('h3', { class: 'today-subheading' }, 'errands in the world'));
  const errandsList = deps.el('div', { class: 'expedition-list' });
  errandsSection.append(errandsList);
  waitsViewport.append(errandsSection);

  // Parked things — typed, three sentences, not one row shape.
  const parkedSection = deps.el('div', { class: 'today-section' });
  parkedSection.append(deps.el('h3', { class: 'today-subheading' }, 'set aside'));
  const parkedList = deps.el('div', { class: 'parked-list' });
  parkedSection.append(parkedList);
  waitsViewport.append(parkedSection);

  // An active import is just another sentence here.
  const importLine = deps.el('div', { class: 'today-import-line' });
  waitsViewport.append(importLine);
  void deps.api<ImportNextResponse>('/api/import/next', undefined, { method: 'GET' })
    .then((res) => {
      if (deps.screen() !== 'today') return;
      if (!res.item) return; // nothing pending — silence
      const n = res.item.remaining + 1;
      const readWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'read them');
      readWord.addEventListener('click', () => deps.navTo('import'));
      importLine.append(
        deps.text(`${n} ${n === 1 ? 'piece still waits' : 'pieces still wait'} from your import \u2014 `),
        readWord,
        deps.text('.'),
      );
    })
    .catch(() => { renderPanelLine(importLine, panelLine('error', 'the import')); });

  // The offers — backlog, coach — one three-state grammar (offer /
  // genuinely nothing / muted error), exactly as the waiting surface
  // rendered them.
  const sweepLine = deps.el('div', { class: 'sweep-backlog-line' });
  waitsViewport.append(sweepLine);
  deps.api<SweepBacklogResponse>('/api/sweep-backlog')
    .then((r) => {
      if (r.pendingReadings <= 0) {
        renderPanelLine(sweepLine, panelLine('none', 'the backlog'));
        return;
      }
      renderPanelLine(sweepLine, panelLine('offer', 'the backlog', backlogSentence(r.pendingReadings)));
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

  const coachLine = deps.el('div', { class: 'coach-waiting' });
  waitsViewport.append(coachLine);
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
        offer.append(' ', accept, ' \u00b7 ', decline);
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

  /* ── Viewport three — activity ── */

  const activityViewport = deps.el('section', { class: 'today-viewport today-activity' });
  activityViewport.append(deps.el('h2', { class: 'today-heading' }, 'activity'));
  const activityList = deps.el('div', { class: 'activity-list' });
  const moreWord = deps.el('button', { class: 'nav-link activity-more', type: 'button' }, 'more');
  moreWord.hidden = true;
  moreWord.addEventListener('click', () => {
    for (const l of activityList.querySelectorAll<HTMLElement>('.activity-line')) l.hidden = false;
    moreWord.hidden = true;
  });
  activityViewport.append(activityList, moreWord);

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

  /* ── The margin — dimmed: the quiet verbs of the page ── */

  const margin = deps.el('div', { class: 'today-margin' });
  const marginRow = deps.el('div', { class: 'today-margin-row' });
  margin.append(marginRow);

  /* The three contracts (delta A2): the margin's fourth door — three plain
   * lines, the person / the machine / the vault, expanded in place below
   * the margin. The copy is fixed; the box survives margin repaints
   * (fresh-start's cancel, jobs resume), staying as the person left it. */
  let contractsOpen = false;
  let contractsBox: HTMLElement | null = null;

  function collapseContracts(): void {
    contractsOpen = false;
    if (contractsBox) {
      contractsBox.remove();
      contractsBox = null;
    }
  }

  function toggleContracts(): void {
    if (contractsOpen) {
      collapseContracts();
      return;
    }
    contractsOpen = true;
    contractsBox = deps.el('div', { class: 'today-contracts' });
    const close = deps.el('button', { class: 'nav-link', type: 'button' }, 'close');
    close.addEventListener('click', collapseContracts);
    contractsBox.append(
      deps.el('p', { class: 'today-contract-line' }, 'your words are yours alone'),
      deps.el('p', { class: 'today-contract-line' }, 'it keeps only what you review'),
      deps.el('p', { class: 'today-contract-line' }, 'everything stays on this machine'),
      close,
    );
    margin.append(contractsBox);
  }

  /** Repaint the margin's four verbs — fresh-start's cancel and the jobs
   *  resume both land back here. */
  function paintMargin(): void {
    marginRow.replaceChildren();

    const importLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'bring in past writing');
    importLink.addEventListener('click', () => deps.navTo('import'));
    marginRow.append(importLink, deps.text(' \u00b7 '));

    const freshLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'start fresh\u2026');
    freshLink.addEventListener('click', () => {
      marginRow.replaceChildren();
      const note = deps.el(
        'div',
        { class: 'fresh-start-note' },
        'Moves the vault and every personal record into archives/ \u2014 nothing is deleted, instruments stay. The server exits; you start it again for a fresh vault.',
      );
      const phrase = deps.el('input', {
        class: 'topic-input',
        type: 'text',
        placeholder: 'type "fresh start" to confirm',
      });
      const go = deps.el('button', { class: 'nav-link', type: 'button' }, 'archive & start fresh');
      const cancelLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'cancel');
      const slot = deps.el('div', { class: 'error-slot' });
      cancelLink.addEventListener('click', () => paintMargin());
      go.addEventListener('click', () => {
        void (async () => {
          go.disabled = true;
          slot.textContent = '';
          try {
            const res = await deps.api<{ ok: boolean; archiveDir: string; moved: string[] }>(
              '/api/fresh-start',
              { confirm: phrase.value.trim() },
            );
            marginRow.replaceChildren(
              deps.el(
                'div',
                { class: 'fresh-start-note' },
                `${res.moved.length} records archived to ${res.archiveDir}. ` +
                  'The server has exited \u2014 start it again, reload this page, and set a new password.',
              ),
            );
          } catch (err) {
            go.disabled = false;
            slot.textContent = err instanceof Error ? err.message : String(err);
          }
        })();
      });
      marginRow.append(note, phrase, go, cancelLink, slot);
    });
    marginRow.append(freshLink, deps.text(' \u00b7 '));

    const stopLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'stop the background work');
    stopLink.addEventListener('click', () => {
      void (async () => {
        stopLink.disabled = true;
        const wait = deps.beginWait(marginRow, 'stopping the background work\u2026');
        try {
          const res = await deps.api<{ ok: boolean; inFlight: boolean }>('/api/jobs/stop', {});
          wait.done();
          marginRow.replaceChildren(
            deps.el(
              'span',
              { class: 'fresh-start-note' },
              res.inFlight
                ? 'jobs stopped \u2014 the run in flight finishes, then nothing new starts. '
                : 'jobs stopped \u2014 nothing new starts. ',
            ),
          );
          const resumeLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'resume jobs');
          resumeLink.addEventListener('click', () => {
            void (async () => {
              resumeLink.disabled = true;
              try {
                await deps.api('/api/jobs/resume', {});
                paintMargin();
              } catch (err) {
                resumeLink.disabled = false;
                const slot = deps.el('div', { class: 'error-slot' });
                slot.textContent = err instanceof Error ? err.message : String(err);
                marginRow.append(slot);
              }
            })();
          });
          marginRow.append(resumeLink);
        } catch (err) {
          stopLink.disabled = false;
          wait.failed(err);
        }
      })();
    });
    const contractsLink = deps.el('button', { class: 'nav-link', type: 'button' }, 'the three contracts');
    contractsLink.addEventListener('click', toggleContracts);
    marginRow.append(stopLink, deps.text(' \u00b7 '), contractsLink);
  }
  paintMargin();

  div.append(beginViewport, waitsViewport, activityViewport, margin);
  deps.main.append(div);

  /* ── The queue and parked lists, from one /api/queue read ── */

  /** One open question, with its two quiet verbs: answer it in writing right
   *  here, or park it until later. Both rows are built by these helpers so
   *  park and put-back can move a question between the lists without
   *  re-rendering the page (a re-render would stack SSE readers). */
  function openQuestionRow(entry: QueueEntry): HTMLElement {
    const row = deps.el('div', { class: 'queue-entry' });
    const question = deps.el('span', { class: 'queue-question' }, entry.question);
    // Where the question came from, in words. No queue `source` literal
    // reaches the DOM — `contradiction-remeasure` announcing itself as a
    // re-measure is the verification Q-15 forbids.
    const meta = deps.el('span', { class: 'queue-meta' }, `${sourceLabel(entry.source)} \u00b7 ${entry.horizon}`);
    const words = deps.el('span', { class: 'queue-words' });
    const answerWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'answer');
    const parkWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'park');
    words.append(answerWord, ' \u00b7 ', parkWord);
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
      editor = deps.el('textarea', { class: 'queue-answer-editor', placeholder: 'answer in your own words\u2026' });
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
        const wait = deps.beginWait(row, 'reading what you wrote\u2026');
        void deps.api(`/api/queue/${entry.id}/answer`, { text, channel: tracker.isPasted(text) ? 'pasted' : 'typed' })
          .then(() => {
            wait.done();
            row.replaceChildren(
              deps.el('span', { class: 'queue-meta' }, 'answered \u2014 what it kept will wait for your review.'),
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
      const wait = deps.beginWait(row, 'parking\u2026');
      void deps.api(`/api/queue/${entry.id}/park`, {})
        .then(() => {
          wait.done();
          row.remove();
          parkedList.querySelector('.empty-msg')?.remove();
          parkedList.append(parkedQuestionRow(entry));
          if (queueList.querySelector('.queue-entry') === null) {
            queueList.append(deps.el('p', { class: 'empty-msg' }, 'No open questions wait.'));
          }
        })
        .catch((cause: unknown) => {
          parkWord.disabled = false;
          wait.failed(cause);
        });
    });

    return row;
  }

  /** One parked row — the typed sentence, the verb, and the kept question
   *  dimmed under it — for every parked thing. The sentence names the kind
   *  ("a thread going deeper, 4 steps kept"), the verb's action is the only
   *  difference. */
  function parkedRow(entry: QueueEntry, opts: { sentence: string; verb: string; onPickUp: ParkedRowAction }): HTMLElement {
    const row = deps.el('div', { class: 'parked-entry' });
    const line = deps.el('span', { class: 'parked-question' });
    line.append(deps.text(opts.sentence), ' \u00b7 ');
    const verbWord = deps.el('button', { class: 'nav-link', type: 'button' }, opts.verb);
    line.append(verbWord);
    row.append(line);
    if (entry.question) row.append(deps.el('span', { class: 'parked-meta' }, entry.question));
    verbWord.addEventListener('click', () => void opts.onPickUp({ row, verbWord }));
    return row;
  }

  /** A parked row's verb action: the row and its verb word. Throwing
   * re-enables the verb; the action owns its waiting affordance. */
  type ParkedRowAction = (c: { row: HTMLElement; verbWord: HTMLButtonElement }) => Promise<void>;

  /** The pick-up skeleton the parked descent and machine rows share: a
   * sitting must be under way to resume into — Today is where one begins
   * now, so a missing sitting starts the default one quietly — the waiting
   * affordance covers the resume call, and a probe reply hands off. The
   * rows diverge only in the resume wire and the probe dispatch. */
  async function pickUpParked<T extends { kind: string }>(
    c: { row: HTMLElement; verbWord: HTMLButtonElement },
    resume: () => Promise<T>,
    onProbe: (res: T) => void,
  ): Promise<void> {
    if (!deps.session.sessionId()) {
      const ok = await startSitting(false, c.row);
      if (!ok) return; // the wait already said why
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

  /** A parked question rests here — no age, no colouring (Q-24) — until it
   * is put back among the open ones (the expiry clock restarts server-side). */
  function parkedQuestionRow(entry: QueueEntry): HTMLElement {
    return parkedRow(entry, {
      sentence: 'a question you set aside',
      verb: 'take it back',
      onPickUp: async ({ row, verbWord }) => {
        verbWord.disabled = true;
        const wait = deps.beginWait(row, 'taking it back\u2026');
        try {
          await deps.api(`/api/queue/${entry.id}/unpark`, {});
          wait.done();
          row.remove();
          queueList.querySelector('.empty-msg')?.remove();
          queueList.append(openQuestionRow(entry));
          if (parkedList.querySelector('.parked-entry') === null) {
            parkedList.append(deps.el('p', { class: 'empty-msg' }, 'Nothing set aside.'));
          }
        } catch (cause) {
          verbWord.disabled = false;
          wait.failed(cause);
        }
      },
    });
  }

  // Load the lists — one /api/queue read carries the open/errand lists and
  // the parked pointers (QueueData carries open + parked together).
  void (async () => {
    const waitQueue = deps.beginWait(queueList, 'looking\u2026', 400);
    const waitParked = deps.beginWait(parkedList, 'looking\u2026', 400);
    try {
      const data = await deps.api<QueueData>('/api/queue');
      waitQueue.done();
      waitParked.done();
      queueList.innerHTML = '';
      errandsList.innerHTML = '';
      parkedList.innerHTML = '';

      const errands = data.open.filter((e) => e.horizon === 'days');
      // Parked machines (a parked drm among them, ticket 159 slice 6) are
      // pointers, not questions — they rest in the parked section below.
      const pending = data.open.filter((e) => e.horizon !== 'days' && e.source !== 'parked-sounding' && e.source !== 'parked-machine');

      if (errands.length === 0) {
        errandsList.append(deps.el('p', { class: 'empty-msg' }, 'No errands in the world.'));
      } else {
        for (const entry of errands) {
          const row = deps.el('div', { class: 'expedition-entry' });
          const question = deps.el('span', { class: 'expedition-question' }, entry.question);
          const age = deps.el('span', { class: 'expedition-age' }, relativeTime(entry.created));
          row.append(question, age);
          errandsList.append(row);
        }
      }

      if (pending.length === 0) {
        queueList.append(deps.el('p', { class: 'empty-msg' }, 'No open questions wait.'));
      } else {
        for (const entry of pending) {
          queueList.append(openQuestionRow(entry));
        }
      }

      // The parked pointers arrive inside `open` (horizon 'session'); the
      // source filter keeps them out of the questions list so nothing
      // appears twice.
      const parkedSoundings = data.open.filter((e) => e.source === 'parked-sounding');
      for (const entry of parkedSoundings) {
        parkedList.append(parkedRow(entry, {
          sentence: `a thread going deeper, ${entry.rungsKept ?? 0} steps kept`,
          verb: 'pick it up',
          onPickUp: (c) => pickUpParked(
            c,
            () => deps.api<ResumeTurn>(`/api/session/${deps.session.sessionId()}/sounding/resume`, { queueEntryId: entry.id }),
            (res) => {
              if (res.kind === 'probe') {
                deps.session.setQuestion(res.text!);
                setDrmWalk(false);
                deps.navTo('room');
              }
            },
          ),
        }));
      }

      // Parked MACHINES (ticket 159, slices 5-6): a parked instrument rests
      // here until picked back up. A parked drm resumes through the drm wire
      // into the DRM screen's probe UI; any other parked machine resumes into
      // the exchange through the machine resume route.
      const parkedMachines = data.open.filter((e) => e.source === 'parked-machine');
      for (const entry of parkedMachines) {
        parkedList.append(parkedRow(entry, {
          sentence: entry.machineProtocol === 'drm' ? 'a day-walk, paused at noon' : sourceLabel(entry.source),
          verb: 'pick it up',
          onPickUp: (c) => pickUpParked(
            c,
            () => entry.machineProtocol === 'drm'
              ? deps.api<MachineResumeTurn>(`/api/session/${deps.session.sessionId()}/drm/resume`, { queueEntryId: entry.id })
              : deps.api<MachineResumeTurn>(`/api/session/${deps.session.sessionId()}/machine/resume`, { queueEntryId: entry.id }),
            (res) => {
              if (entry.machineProtocol === 'drm') {
                if (res.kind === 'drm-probe') {
                  setDrmResumeProbe({
                    text: res.text ?? '',
                    episode: res.episode ?? 1,
                    of: res.of ?? 1,
                    step: res.step ?? '',
                    gate: res.gate ?? { episode: 1, of: 1, label: '' },
                  });
                  setDrmWalk(true);
                  deps.navTo('room');
                }
              } else if (res.kind === 'probe') {
                deps.session.setQuestion(res.text!);
                setDrmWalk(false);
                deps.navTo('room');
              }
            },
          ),
        }));
      }

      // Parked QUESTIONS share the section with the parked descents: same
      // quiet register, but their way back is `take it back`, not a resume
      // into a sitting.
      const parkedQuestions = data.parked ?? [];
      for (const entry of parkedQuestions) {
        parkedList.append(parkedQuestionRow(entry));
      }

      if (parkedSoundings.length === 0 && parkedMachines.length === 0 && parkedQuestions.length === 0) {
        parkedList.append(deps.el('p', { class: 'empty-msg' }, 'Nothing set aside.'));
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

  /* ── The activity stream, folded to its newest lines ── */

  // Connect activity SSE — the reader refreshes the stream in place, never
  // a whole-surface re-render (the live-refresh loop no longer re-enters
  // this screen), so inline answer editors survive every append.
  void (async () => {
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

  /* ── The one-time profile ask (mode.ts's port) ── */

  // One-time ask on vaults set up before the profile existed: the wiki
  // writes about the person, and given a name it stops calling them "the
  // user". Skippable; skip is remembered in this browser.
  if (deps.storage.getItem('profile-asked') === null) {
    void (async () => {
      try {
        const existing = await deps.api<{ name?: string; pronouns?: string }>('/api/profile', undefined, { method: 'GET' });
        if (existing.name || existing.pronouns) return;
        const box = deps.el('div', { class: 'today-profile-ask' });
        const ask = deps.el('p', { class: 'today-profile-ask-question' }, 'what should it call you?');
        const nameInput = deps.el('input', { class: 'topic-input', type: 'text', placeholder: 'your name' });
        const pronounsInput = deps.el('input', { class: 'topic-input', type: 'text', placeholder: 'your pronouns (e.g. they/them)' });
        const row = deps.el('div', { class: 'today-profile-ask-row' });
        const save = deps.el('button', { class: 'submit-btn' }, 'save');
        const skip = deps.el('button', { class: 'nav-link' }, 'skip');
        save.addEventListener('click', async () => {
          try {
            await deps.api('/api/profile', { name: nameInput.value.trim(), pronouns: pronounsInput.value.trim() });
            deps.storage.setItem('profile-asked', 'yes');
            box.remove();
          } catch { /* leave the box; the next click retries */ }
        });
        skip.addEventListener('click', () => {
          deps.storage.setItem('profile-asked', 'yes');
          box.remove();
        });
        row.append(save, skip);
        box.append(ask, nameInput, pronounsInput, row);
        beginViewport.append(box);
      } catch { /* not signed in yet, or no server — never block the home screen */ }
    })();
  }
}
