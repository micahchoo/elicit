/**
 * The exchange surface: the sitting itself — the question block, the answer
 * field, the gate words, the sounding offer, the repair row, the opening
 * pulse, and the transcript. The biggest client screen, moved whole from
 * main.ts; every rendered string, class, DOM structure and e2e selector is
 * byte-identical.
 *
 * Injection, not import: `el`, `api`, `navTo`, `beginWait`, the shell verbs
 * and the writable session-state handle are main.ts module-private (the
 * import-review pattern). The handle mutates the REAL AppState object, so
 * the router and the other screens see every write — the waiting surface's
 * sessionId()/setQuestion getters, extended to setters for the fields this
 * surface mutates.
 */

import type { GateReading, SoundingEnd } from '../src/types.ts';
import { descentCloseWord, sourceWord } from './provenance.js';
import { lineageBlock } from './lineage.js';
import { pasteTracker } from './paste-tracker.js';
import { ensureProtocolMeta, protocolTitle } from './protocol-meta.js';
import { triadSurface, toggleTriad, type PhaseMetaLike } from './triad-surface.js';
import type { DictationOpts } from './dictation.js';
import type { EndResponse, SessionState, WebDepsCore, WebDepsWithWait } from './deps.js';

export interface ExchangeDeps {
 main: HTMLElement;
 el: WebDepsCore['el'];
 api: WebDepsCore['api'];
 navTo: (screen: string) => void;
 beginWait: WebDepsWithWait['beginWait'];
 renderShell: () => void;
 clear: () => void;
 showQuietError: (container: HTMLElement, message: string) => void;
 setScreen: (screen: string) => void;
 session: SessionState;
 wireDictation: (opts: DictationOpts) => void;
 /** The session clock's interval — this screen starts it, main.ts's clear() stops it. */
 sessionClock: () => ReturnType<typeof setInterval> | null;
 setSessionClock: (timer: ReturnType<typeof setInterval> | null) => void;
 document: Document;
}

/** The turn route's reply shape, moved verbatim from main.ts. */
interface TurnData {
 kind: 'probe' | 'saturated' | 'checkpoint' | 'descent-closed' | 'declined' | 'door' | 'continue';
 text?: string;
 juxtaposition?: { snippetText: string; snippetDate: string };
 /** Live descent reading (012 T9): present on every rung, never cached. */
 sounding?: GateReading;
 /** The one-shot offer (012 T9): present at most once per sitting. */
 soundingOffer?: { construct: string; allowance: number; sentence: string };
 /** The descent closed on this answer (012 T9) — cap or convergence, no gate press. */
 descentClosed?: SoundingEnd;
 /** Closing acknowledgment rendered before navigating to reviews (ticket 135). */
 closingText?: string;
 /** Fragment quoted in the question (Q-104): present on probe responses, carries the "not mine" verb. */
 quotedFragment?: string;
 /** Snippet ref for the current question's quoted fragment (Q-109): rides with quotedFragment. */
 snippetRef?: string;
 /**
  * The machine phase meta (ticket 159, slice 4): every sitting now carries
  * a machine (reflective formalized), so the turn response's `phase` field
  * is always the machine shape { id, label, step, of } — the polymorphic
  * session-phase-string wire is retired. Other routes that reuse the type
  * (the sounding gate) still send the session phase string, which
 *  applyProbe ignores.
 */
phase?: PhaseMetaLike;
}

/**
 * The door question a gate-press close leaves behind (012 T9). The gate
 * route returns no text on descent-closed — the server appends this same
 * sentence to its transcript — so the exchange renders it itself. The
 * wording announces the descent closing, never the person stopping (Q-46).
 */
const DOOR_QUESTION = "Anything else we didn't touch?";

/**
 * The opening pulse (ticket 105): a one-line inner-weather input shown
 * before the first question. Skippable with no record of the skip.
 */
function pulseExchange(deps: ExchangeDeps, container: HTMLElement) {
 const pulsePrompt = deps.session.pulsePrompt()!;
 const pendingQuestion = deps.session.pendingQuestion()!;

 const pulseBlock = deps.el('div', { class: 'pulse-block' });
 const prompt = deps.el('div', { class: 'pulse-prompt' }, pulsePrompt);
 const input = deps.el('input', {
  class: 'pulse-input',
  type: 'text',
  placeholder: '\u2026',
 });
 const actions = deps.el('div', { class: 'pulse-actions' });
 const sendWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'send');
 const skipWord = deps.el('button', { class: 'nav-link', type: 'button' }, 'skip');
 actions.append(sendWord, skipWord);
 pulseBlock.append(prompt, input, actions);
 container.append(pulseBlock);

 // Focus the input on render
 requestAnimationFrame(() => input.focus());

 async function submit() {
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  sendWord.disabled = true;
  skipWord.disabled = true;
  try {
   await deps.api(`/api/session/${deps.session.sessionId()}/pulse`, { text, prompt: pulsePrompt });
  } catch {
   // Pulse is never load-bearing; a failure just shows the opener.
  }
  // Proceed to the normal exchange
  deps.session.setPulsePrompt(null);
  deps.session.setQuestion(pendingQuestion);
  deps.session.setPendingQuestion(null);
  renderExchange(deps);
 }

async function skip() {
  deps.session.setPulsePrompt(null);
  deps.session.setQuestion(pendingQuestion);
  deps.session.setPendingQuestion(null);
  // Fire the pulse call with empty text so the server appends the
  // pending opener to the transcript (ticket 135). Non-blocking.
  try {
   await deps.api(`/api/session/${deps.session.sessionId()}/pulse`, { text: '', prompt: '' });
  } catch { /* skip is never load-bearing */ }
  renderExchange(deps);
}

 sendWord.addEventListener('click', submit);
 skipWord.addEventListener('click', skip);
 input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
 });
}

export function renderExchange(deps: ExchangeDeps): void {
 deps.clear();
 deps.setScreen('exchange');
 deps.renderShell();
 // The session clock hangs in the shell: the declared minutes, counting
 // down. It is a quiet span, never a control — at zero it says so and stops.
 const deadline = deps.session.sessionDeadline();
 if (deadline !== null) {
  const nav = deps.main.querySelector<HTMLElement>('.topnav');
  if (nav) {
   const clock = deps.el('span', { class: 'session-clock' });
   nav.append(clock);
   const tick = () => {
    const left = deadline - Date.now();
    if (left <= 0) {
     clock.textContent = "time's up \u2014 harvest when ready";
     if (deps.sessionClock() !== null) {
      clearInterval(deps.sessionClock()!);
      deps.setSessionClock(null);
     }
     return;
    }
    const total = Math.floor(left / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    clock.textContent = `${mm}:${ss} left`;
   };
   tick();
   deps.setSessionClock(setInterval(tick, 1000));
  }
 }
 deps.session.setTurnHadSpeech(false);
 // A fresh exchange screen starts with no descent and no offer (012 T9);
 // re-rendering must not inherit either from a previous screen.
 deps.session.setSounding(null);
 deps.session.setSoundingOffer(null);

 const div = deps.el('div', { class: 'screen active' });

 // ── Opening pulse (ticket 105): a one-line inner-weather input ──
 // Shown when the server includes a pulsePrompt; skipped with no record.
 if (deps.session.pulsePrompt()) {
  pulseExchange(deps, div);
  deps.main.append(div);
  return;
 }


 const header = deps.el('div', { class: 'exchange-header' });
 const openerLineage = lineageBlock(
  deps.el,
  deps.session.lineageQuestion() ?? undefined,
  deps.session.lineageContext() ?? undefined,
 );
 if (openerLineage) header.append(openerLineage);
 // The Randomizer's provenance (Q-18): one muted margin word when the opener
 // was dealt rather than composed — the deck draw or the resurfaced past.
 // It lives and dies with the opener, exactly like the resurfacing lineage.
 const openerSource = deps.session.openerSource();
 const dealtLine = openerSource !== null
  ? deps.el('div', { class: 'lineage-provenance' }, deps.el('div', { class: 'lineage-context' }, sourceWord(openerSource)))
  : null;
 if (dealtLine) header.append(dealtLine);
 const questionBlock = deps.el('div', { class: 'question-block' }, deps.session.question()!);

  const protocol = deps.session.sessionProtocol();
 if (protocol) {
   // The dimmed label above the question block renders the def TITLE
   // (ticket 157); the once-cached fetch updates it in place when it
   // lands, and a failed fetch leaves the registry id as the fallback.
   const protocolLabel = deps.el('div', { class: 'exchange-protocol' }, protocolTitle(protocol));
   void ensureProtocolMeta().then(() => {
    const fresh = deps.session.sessionProtocol();
  if (!fresh) return;
    protocolLabel.textContent = protocolTitle(fresh);
   });
   header.append(protocolLabel);
  }
 // The machine phase line (ticket 159, slice 3), in the DRM probe-meta
 // grammar — quiet, 0.75rem, muted. Rendered only while a machine is
 // active; the empty line is invisible, so the question block is never
 // disturbed.
 const phaseMetaLine = deps.el('div', { class: 'exchange-phase-meta' });
 const meta = deps.session.phaseMeta();
 if (meta) {
  phaseMetaLine.textContent = `${meta.label} \u2014 phase ${meta.step} of ${meta.of}`;
 }
 header.append(phaseMetaLine);
 header.append(questionBlock);
 // The triad chip surface (ticket 159, slice 7): the three names as tappable
 // chips under the question, rendered only while the active phase declares
 // the 'triads' renderer and the meta carries the names. Any other meta —
 // an unknown renderer included — leaves the row empty and the generic
 // question block stands: prose is always the floor, never a crash.
 const triadRow = deps.el('div', { class: 'triad-row' });
 const triadChips = deps.el('div', { class: 'triad-chips' });
 const triadHint = deps.el('span', { class: 'triad-hint' });
 triadRow.append(triadChips, triadHint);
 header.append(triadRow);
 let selectedTriad: string[] = [];
 function paintTriadChips() {
  for (const chip of triadChips.querySelectorAll<HTMLButtonElement>('.triad-chip')) {
   const name = chip.textContent ?? '';
   chip.classList.toggle('selected', selectedTriad.includes(name));
  }
  triadHint.textContent = selectedTriad.length === 2
   ? 'tap to change \u2014 the pair rides your answer'
   : 'tap two who are alike';
 }
 function renderTriadSurface(meta: PhaseMetaLike | null) {
  selectedTriad = [];
  triadChips.innerHTML = '';
  triadHint.textContent = '';
  const triad = triadSurface(meta);
  if (triad === null) return;
  for (const name of triad.names) {
   const chip = deps.el('button', { class: 'triad-chip', type: 'button' }, name);
   chip.addEventListener('click', () => {
    selectedTriad = toggleTriad(selectedTriad, name);
    paintTriadChips();
   });
   triadChips.append(chip);
  }
  paintTriadChips();
 }
 renderTriadSurface(meta);
 // Q-104: "not mine" margin verb on questions carrying a quotedFragment
 if (deps.session.quotedFragment()) {
  const repairRow = deps.el('div', { class: 'repair-row' });
  const notMine = deps.el('button', { class: 'repair-not-mine', type: 'button' }, 'not mine');
  repairRow.append(notMine);
  header.append(repairRow);

  // Q-109: Press expands to 'unlink · keep'
  let repairExpanded = false;
  let unlinkBtn: HTMLButtonElement;
  let keepBtn: HTMLButtonElement;

  notMine.addEventListener('click', () => {
   if (repairExpanded) return;
   repairExpanded = true;
   notMine.remove();

   unlinkBtn = deps.el('button', { class: 'repair-unlink', type: 'button' }, 'unlink');
   const sep = deps.el('span', { class: 'repair-sep' }, ' \u00b7 ');
   keepBtn = deps.el('button', { class: 'repair-keep', type: 'button' }, 'keep');
   repairRow.append(unlinkBtn, sep, keepBtn);

   keepBtn.addEventListener('click', () => {
    unlinkBtn.remove();
    sep.remove();
    keepBtn.remove();
    repairRow.append(notMine);
    repairExpanded = false;
   });

   unlinkBtn.addEventListener('click', async () => {
    unlinkBtn.disabled = true;
    keepBtn.disabled = true;
    try {
     // snippetRef rides beside the fragment (Q-109); the server strips the
     // @version itself and answers with a fresh probe replacing this question.
     const turnData = await deps.api<TurnData>(
      `/api/session/${deps.session.sessionId()}/repair`,
      {
       snippetRef: deps.session.snippetRef() ?? '',
       quotedFragment: deps.session.quotedFragment(),
      },
     );
     if (turnData.kind === 'probe') {
      deps.session.setQuestion(turnData.text!);
      // The disavowed fragment leaves the screen; the fresh probe is a
      // new question and may carry its own fragment.
      deps.session.setQuotedFragment(null);
      deps.session.setSnippetRef(null);
      renderExchange(deps);
     }
    } catch (e) {
     unlinkBtn.disabled = false;
     keepBtn.disabled = false;
    }
   });
  });
 }

 // Juxtaposition snippet display
 const juxDiv = deps.el('div', { class: 'juxtaposition' });
 const jux = deps.session.juxtaposition();
 if (jux) {
  juxDiv.classList.add('active');
  juxDiv.append(
   deps.el('span', { class: 'jux-date' }, jux.snippetDate),
   deps.el('blockquote', { class: 'jux-quote' }, jux.snippetText),
  );
 }
 header.append(juxDiv);

 const transcript = deps.el('div', { class: 'transcript' });

 const answerArea = deps.el('div', { class: 'answer-area' });
 const answerRow = deps.el('div', { class: 'answer-row' });
 const textarea = deps.el('textarea', {
  class: 'answer-textarea',
  placeholder: '\u2026',
  rows: '2',
 });
 const turnTracker = pasteTracker(textarea);
 const micBtn = deps.el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
 const micStatus = deps.el('span', { class: 'mic-status' });
 // A visible send, beside the mic: the Enter path in word form.
 const sendBtn = deps.el('button', { class: 'send-btn', type: 'button' }, 'send \u21b5');

 // The writing grammar allows one hint line: how Enter behaves, in dim ink.
 const answerHint = deps.el('div', { class: 'answer-hint' }, 'Enter sends \u00b7 Shift+Enter for a new line');

// ── The sounding offer (012 T9): one sentence, two words, in the margin ──
// Shown once per sitting, below the question block. Both words are one
// click and spent on the click: declining never asks why and never returns
// (Q-43), accepting enters the descent.

let offerRow: HTMLDivElement | null = null;

function showOffer(offer: { construct: string; allowance: number; sentence: string }) {
 if (offerRow) return; // one offer per sitting — a set offer never repeats
 offerRow = deps.el('div', { class: 'sounding-offer' });
 const sentence = deps.el('span', { class: 'sounding-offer-sentence' }, offer.sentence);
 const acceptWord = deps.el('button', { class: 'sounding-offer-word accept', type: 'button' }, 'accept');
 const declineWord = deps.el('button', { class: 'sounding-offer-word decline', type: 'button' }, 'decline');
 offerRow.append(sentence, acceptWord, declineWord);
 header.append(offerRow);
 acceptWord.addEventListener('click', () => consent(true));
 declineWord.addEventListener('click', () => consent(false));
}

async function consent(accept: boolean) {
 // The word is spent the moment it is clicked (Q-43): the row is gone
 // before the call returns, either way. A decline never comes back.
 const offer = deps.session.soundingOffer();
 if (offerRow) {
  offerRow.remove();
  offerRow = null;
 }
 deps.session.setSoundingOffer(null);
 if (!accept) {
  try {
   await deps.api<TurnData>(`/api/session/${deps.session.sessionId()}/sounding`, { accept });
  } catch (e) {
   // A decline that did not land would be re-offered on the next turn; the
   // person has already spent the word and must not be asked again (Q-43).
   deps.showQuietError(answerArea, 'that did not land \u2014 the offer will come back');
  }
  return;
 }
 setControlsBusy(true);
 const wait = deps.beginWait(answerArea, 'beginning\u2026');
 try {
  const res = await deps.api<TurnData>(
   `/api/session/${deps.session.sessionId()}/sounding`,
   { accept },
  );
  wait.done();
  if (res.kind === 'probe') applyProbe(res);
 } catch (e) {
  wait.failed(e);
  setControlsBusy(false);
  // A failed accept leaves the offer on the server's table (T8 puts it
  // back for a second word); restore the row so either word can be taken.
  if (offer) {
   deps.session.setSoundingOffer(offer);
   showOffer(offer);
  }
 }
}

// ── The gate (012 T9): three words under every rung of a live descent ──
// The live descent reading is set on every rung and never cached, so the row is born
// on the first reading and rewritten in place on every rung after that.

// The gate row is the standard control surface on EVERY sitting (ticket
// 159, slice 4): always visible, continue enabled — the person just
// answers, and the words park / another day end the sitting. The skip
// route survives as the quiet nav-link beside the gate (the skip-rate
// metrics stay live). While a descent runs, the same row renders the
// sounding gate (012 T9): the rung reading, continue only at the
// checkpoint, park / another-day under every rung.
const gateRow = deps.el('div', { class: 'gate-row' });
const gateReading = deps.el('span', { class: 'gate-reading' });
const continueWord = deps.el('button', { class: 'gate-word continue', type: 'button' }, 'continue');
const parkWord = deps.el('button', { class: 'gate-word park', type: 'button' }, 'park, depth kept');
const anotherDayWord = deps.el('button', { class: 'gate-word another-day', type: 'button' }, 'another day');
const skipLink = deps.el('button', { class: 'nav-link gate-skip', type: 'button' }, 'skip');
gateRow.append(gateReading, continueWord, parkWord, anotherDayWord, skipLink);
gateRow.classList.add('visible');

// The standard surface's controls; renderGate narrows the set while a
// descent runs, and removeGateRow restores it.
let gateControls: HTMLButtonElement[] = [continueWord, parkWord, anotherDayWord];
let checkpointActive = false;

/** Render the gate row for the current reading, in the checkpoint state or out. */
function renderGate(checkpoint: boolean) {
 const reading = deps.session.sounding();
 if (!reading) return;
 checkpointActive = checkpoint;
 continueWord.hidden = !checkpoint;
 gateControls = checkpoint
  ? [continueWord, parkWord, anotherDayWord]
  : [parkWord, anotherDayWord];
 gateReading.textContent = `continuing \u00b7 rung ${reading.rung} of ${reading.of}`;
 gateRow.classList.toggle('checkpoint', checkpoint);
 gateRow.classList.add('visible');
 if (checkpoint) {
  // The checkpoint is the thing on the screen: the gate moves above the
  // textarea and withholds the next question until a word is pressed.
  answerArea.insertBefore(gateRow, answerRow);
  textarea.disabled = true;
 } else {
  answerArea.append(gateRow);
  textarea.disabled = false;
 }
}

/** Take the gate off the screen and restore the standard surface: visible,
 *  continue enabled, the quiet skip beside it. */
function removeGateRow() {
 gateRow.classList.remove('checkpoint');
 continueWord.hidden = false;
 gateControls = [continueWord, parkWord, anotherDayWord];
 checkpointActive = false;
 gateReading.textContent = '';
 textarea.disabled = false;
 answerArea.append(gateRow);
}

/** Apply the sounding fields of a turn response (012 T9). `sounding` is
 *  present on every rung of a live descent and is never cached; a response
 *  without it means no descent is live, so a stale row must not linger. */
function syncSounding(res: TurnData) {
 if (res.soundingOffer) {
  deps.session.setSoundingOffer(res.soundingOffer);
  showOffer(res.soundingOffer);
 }
 if (res.sounding) {
  deps.session.setSounding(res.sounding);
  renderGate(res.sounding.checkpoint);
 } else {
  // No live descent behind this response: the descent closed on this answer
  // (cap/convergence) or the server no longer holds one.
  deps.session.setSounding(null);
  removeGateRow();
 }
}

/** Apply a probe response to the exchange surface (012 T9): the question,
 *  the lineage, the juxtaposition, the transcript, and the sounding state. */
function applyProbe(res: TurnData) {
 deps.session.setQuestion(res.text!);
 // The lineage belonged to the resurfaced opener; later questions have none.
 deps.session.setLineageQuestion(null);
 deps.session.setLineageContext(null);
 deps.session.setOpenerSource(null);
 openerLineage?.remove();
 dealtLine?.remove();
 deps.session.setQuotedFragment(res.quotedFragment ?? null);
 deps.session.setSnippetRef(res.snippetRef ?? null);
 deps.session.setJuxtaposition(res.juxtaposition ?? null);
 // The machine phase meta rides every turn response (ticket 159, slice 4 —
 // every sitting now carries a machine). The typeof check stays defensive:
 // other routes that reuse TurnData (the sounding gate) still send the
 // session phase string, which is not the meta and clears the line.
 deps.session.setPhaseMeta(typeof res.phase === 'object' && res.phase !== null ? res.phase : null);
 const meta = deps.session.phaseMeta();
 phaseMetaLine.textContent = meta
  ? `${meta.label} \u2014 phase ${meta.step} of ${meta.of}`
  : '';
 // The chip surface follows the ACTIVE phase: a triad question re-renders
 // the three chips (fresh tap state), anything else hides the row.
 renderTriadSurface(meta);

 // Update question + juxtaposition display
 questionBlock.textContent = res.text!;
 juxDiv.innerHTML = '';
 const jux = deps.session.juxtaposition();
 if (jux) {
  juxDiv.classList.add('active');
  juxDiv.append(
   deps.el('span', { class: 'jux-date' }, jux.snippetDate),
   deps.el('blockquote', { class: 'jux-quote' }, jux.snippetText),
  );
 } else {
  juxDiv.classList.remove('active');
 }

 appendTurn('agent', res.text!);
 syncSounding(res);
}

/** The gate route closed the descent (park / another-day / the counter at
 *  the gate). No question text rides the response; the door question is the
 *  known close sentence (Q-46: the descent closes, never the person stops).
 *  A turn-route close rides `descentClosed` — the descent ended on its own
 *  (cap or convergence), the one close the person did not perform — and a
 *  quiet margin word says how (012 T9). */
function closeByGate(closedBy?: SoundingEnd) {
 deps.session.setSounding(null);
 removeGateRow();
 deps.session.setQuestion(DOOR_QUESTION);
 questionBlock.textContent = DOOR_QUESTION;
 appendTurn('agent', DOOR_QUESTION);
 if (closedBy) {
  header.append(deps.el('div', { class: 'lineage-provenance' }, deps.el('div', { class: 'lineage-context' }, descentCloseWord(closedBy))));
 }
}

async function pressGate(choice: 'continue' | 'park' | 'another-day') {
 setControlsBusy(true);
 const wait = deps.beginWait(
  answerArea,
  choice === 'continue' ? 'continuing\u2026' : 'putting it away\u2026',
 );
 try {
  const res = await deps.api<TurnData>(
   `/api/session/${deps.session.sessionId()}/sounding/gate`,
   { choice },
  );
  wait.done();
  if (res.kind === 'probe') {
   applyProbe(res);
   // A gate-route probe is the checkpoint's release: 'continue' was the one
   // real choice at the block, and this response is the rung it unblocked.
   // The response's own sounding still reports checkpoint (the interrupted
   // rung is not recorded until the next answer), so re-locking on it would
   // deadlock the exchange — the block lifts here and only here.
   if (checkpointActive) renderGate(false);
   // The checkpoint handed focus to the gate; the next rung hands it back
   // (focus-management-across-boundaries).
   textarea.focus();
  } else if (res.kind === 'descent-closed') {
   closeByGate();
  }
  setControlsBusy(false);
 } catch (e) {
  wait.failed(e);
  setControlsBusy(false);
 }
}

/** The everyday sitting's gate (ticket 159, slice 4), the standard surface
 *  under every question:
 *  - 'continue' is the default — the next question is one answer away, so
 *    the word only brings the field back (no wire; the person just answers).
 *  - 'park' enters the closing door through the gate route (the machine
 *    side-record lands in slice 5; harvest happens at /end).
 *  - 'another-day' is the old harvest-now wire verbatim (VERB MAPPING):
 *    POST /api/session/:id/end → the harvest runs behind the response and
 *    the review queue is the destination.
 */
async function pressEverydayGate(choice: 'continue' | 'park' | 'another-day') {
 if (choice === 'continue') {
  textarea.focus();
  return;
 }
 setControlsBusy(true);
 const wait = deps.beginWait(
  answerArea,
  choice === 'another-day' ? 'reading back what you said\u2026' : 'putting it away\u2026',
 );
 try {
  if (choice === 'another-day') {
   const res = await deps.api<EndResponse>(
    `/api/session/${deps.session.sessionId()}/end`,
   );
   deps.session.setPendingReviewSession(res.sessionId);
   wait.done();
   deps.navTo('reviews');
   return;
  }
  // park — depth kept: the gate route enters the closing door; the door
  // question is the known close sentence, rendered like a descent's close.
  // Already on the door, a second park stays put (the route no-ops).
  const res = await deps.api<TurnData>(
   `/api/session/${deps.session.sessionId()}/gate`,
   { choice: 'park' },
  );
  wait.done();
  if (res.kind === 'door' && deps.session.question() !== DOOR_QUESTION) {
   closeByGate(undefined);
  } else {
   textarea.focus();
  }
  setControlsBusy(false);
 } catch (e) {
  wait.failed(e);
  setControlsBusy(false);
 }
}

/** The gate words: while a descent runs they are the sounding gate
 *  (continue at the checkpoint / park / another-day close the ladder);
 *  otherwise the standard surface — continue nudges the answer field,
 *  park enters the closing door, another day ends and harvests. */
function onGateWord(choice: 'continue' | 'park' | 'another-day') {
 if (deps.session.sounding()) {
  pressGate(choice);
  return;
 }
 pressEverydayGate(choice);
}

continueWord.addEventListener('click', () => onGateWord('continue'));
parkWord.addEventListener('click', () => onGateWord('park'));
anotherDayWord.addEventListener('click', () => onGateWord('another-day'));

 answerRow.append(textarea, micBtn, micStatus, sendBtn);
 answerArea.append(answerRow, answerHint, gateRow);

  // The offer carries the DRM title, never the jargon (ticket 157).
  const drmOffer = deps.el('button', { class: 'nav-link exchange-drm-offer' }, `${protocolTitle('drm')} \u2192`);
  void ensureProtocolMeta().then(() => {
   drmOffer.textContent = `${protocolTitle('drm')} \u2192`;
  });
  drmOffer.addEventListener('click', () => deps.navTo('drm'));
  answerArea.append(drmOffer);


 div.append(header, transcript, answerArea);
 deps.main.append(div);

 // typewriter auto-grow
 textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
 });

 // focus dimming
 textarea.addEventListener('focus', () => {
  deps.document.body.classList.add('answering');
 });
 textarea.addEventListener('blur', () => {
  deps.document.body.classList.remove('answering');
 });

 async function sendTurn() {
  const text = textarea.value.trim();
  if (!text) return;
  const pasted = turnTracker.isPasted(text);
  turnTracker.reset();
  textarea.disabled = true;
  skipLink.disabled = true;
  if (deps.session.sttAvailable()) micBtn.disabled = true;
  sendBtn.disabled = true;

  // The answer moves into the transcript now, so it is not on screen twice
  // while the probe is out. A failure puts it back in the field.
  const userTurn = appendTurn('user', text);
  textarea.value = '';
  textarea.style.height = 'auto';

  const body: Record<string, unknown> = {
   text,
   channel: pasted ? 'pasted' : deps.session.turnHadSpeech() ? 'spoken' : 'typed',
  };
  if (deps.session.turnHadSpeech()) body.spoken = true;
  // The tapped pair rides the answer (ticket 159, slice 7): present only
  // when the chips are live AND exactly two are selected. Fewer than two
  // is a prose-only turn — the answer text stands alone and the server
  // records no pair, exactly as if no chips existed.
  if (triadSurface(deps.session.phaseMeta()) !== null && selectedTriad.length === 2) {
   body.pair = [selectedTriad[0]!, selectedTriad[1]!];
  }

  const wait = deps.beginWait(answerArea, 'thinking…');

  try {
   const res = await deps.api<TurnData>(
    `/api/session/${deps.session.sessionId()}/turn`,
    body,
   );

   wait.done();
   deps.session.setTurnHadSpeech(false);

   if (res.kind === 'probe') {
    applyProbe(res);
   } else if (res.kind === 'checkpoint') {
    // The rung was answered and recorded; the descent is blocked until a
    // gate word arrives and no next question exists yet (Q-44). The gate
    // becomes the thing on the screen.
    deps.session.setSounding(res.sounding ?? null);
    if (deps.session.sounding()) renderGate(true);
   } else if (res.kind === 'descent-closed') {
    closeByGate(res.descentClosed);
   } else {
    // saturated — the sitting is over. The closing acknowledgment
    // (ticket 135) renders as the final agent turn before harvest.
    if (res.closingText) {
     const closingRow = deps.el('div', { class: 'turn-group agent' });
     const bubble = deps.el('div', { class: 'turn-bubble agent' }, res.closingText);
     closingRow.append(bubble);
     const rows = answerArea.querySelectorAll('.turn-group.agent, .turn-group.user');
     const lastRow = rows[rows.length - 1];
     if (lastRow) lastRow.insertAdjacentElement('afterend', closingRow);
     else answerArea.prepend(closingRow);
     closingRow.scrollIntoView({ block: 'center' });
    }
    try {
     const endRes = await deps.api<EndResponse>(
      `/api/session/${deps.session.sessionId()}/end`,
     );
     deps.session.setPendingReviewSession(endRes.sessionId);
     wait.done();
     deps.navTo('reviews');
    } catch (e) {
     wait.failed(e);
     setControlsBusy(false);
    }
    return;
   }
  } catch (e) {
   // Their words go back to the field, or "try again" means nothing.
   wait.failed(e);
   userTurn.remove();
   textarea.value = text;
   textarea.dispatchEvent(new Event('input'));
  }

  textarea.disabled = checkpointActive;
  skipLink.disabled = false;
  if (deps.session.sttAvailable()) micBtn.disabled = false;
  sendBtn.disabled = checkpointActive;
  textarea.focus();
  textarea.scrollIntoView({ block: 'center', behavior: 'smooth' });
 }

 textarea.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
   e.preventDefault();
   sendTurn();
  }
 });

 sendBtn.addEventListener('click', () => void sendTurn());

 /** Enable or disable everything that would race the call in flight. The
  *  gate words join the set (012 T9) so a double-press cannot park a ladder
  *  twice; the textarea stays disabled at the checkpoint either way. */
 function setControlsBusy(busy: boolean) {
  textarea.disabled = busy || checkpointActive;
  skipLink.disabled = busy;
  if (deps.session.sttAvailable()) micBtn.disabled = busy;
  sendBtn.disabled = busy;
  for (const c of gateControls) c.disabled = busy;
 }

 /** Show the replacement question skip and defer both return, or close the exchange. */
 function takeNextQuestion(res: { kind: string; text?: string }) {
  if (res.kind === 'question') {
   deps.session.setQuestion(res.text!);
   deps.session.setLineageQuestion(null);
   deps.session.setLineageContext(null);
   deps.session.setOpenerSource(null);
   openerLineage?.remove();
   dealtLine?.remove();
   deps.session.setJuxtaposition(null);
   juxDiv.classList.remove('active');
   juxDiv.innerHTML = '';
   questionBlock.textContent = res.text!;
   textarea.value = '';
   textarea.style.height = 'auto';
   textarea.focus();
  } else {
   questionBlock.textContent = '';
   questionBlock.append(
    deps.el('p', { class: 'skip-exhausted' }, 'No more starters \u2014 another day gathers them.'),
   );
   skipLink.disabled = true;
   textarea.disabled = true;
  }
 }

 // ── Skip (the quiet link beside the gate): the skip route unchanged, so
 // the skip-rate metrics stay live (ticket 159, slice 4) ──

 skipLink.addEventListener('click', async () => {
  skipLink.disabled = true;
  const wait = deps.beginWait(answerArea, 'finding another…');
  try {
   const res = await deps.api<{ kind: string; text?: string }>(
    `/api/session/${deps.session.sessionId()}/skip`,
   );
   wait.done();
   takeNextQuestion(res);
  } catch (e) {
   wait.failed(e);
   skipLink.disabled = false;
  }
 });

 // ── Mic toggle ──

 deps.wireDictation({
  textarea,
  micBtn,
  micStatus,
  errorSlot: answerArea,
  onSpeech: () => { deps.session.setTurnHadSpeech(true); },
 });

 requestAnimationFrame(() => {
  textarea.focus();
  textarea.scrollIntoView({ block: 'center' });
 });

 function appendTurn(role: 'agent' | 'user', text: string): HTMLDivElement {
  const turn = deps.el('div', { class: `turn ${role}` }, text);
  transcript.append(turn);
  turn.scrollIntoView({ block: 'nearest' });
  return turn;
 }
}
