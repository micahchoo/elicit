/**
 * THE ROOM (wave 4, docs/redesign-2026-08-08.md §5.3 + §9 wave 4): the
 * three sitting surfaces — exchange, drm, unprompted — as ONE room, the
 * true void. Every rendered string, class, DOM structure and e2e selector
 * the wave keeps is byte-identical to the surface it came from; the
 * deletions below are the wave's.
 *
 * Furniture discrimination (owner decision 1): one render function, three
 * states, no guard — the room owns the sessionless state.
 *   - sessionId null   → the blank-page (just write: POST /api/unprompted)
 *   - sessionId + walk → the day-walk (the drm machine's phases, dispatched
 *                        on the machine phase meta renderer 'drm-day-map')
 *   - else             → the sitting grammar (question/answer/pulse/
 *                        sounding/repair/jux/phase-meta)
 * The walk discriminator is deps.drmWalk() — a writable verb backed by the
 * real AppState, set by Today's door when it begins or resumes a day-walk.
 * The room keeps it true through the walk (every drm response re-sets it)
 * and clears it when the walk closes; takeDrmResumeProbe() (deps.ts)
 * carries a parked walk's first probe into the room, take-then-clear.
 *
 * The void (owner decision 2): the transcript is NOT resident — hidden
 * until summoned by a scroll-up gesture over the room (wheel up, or a
 * finger dragging down — the content scrolls up), then shown; every
 * render starts hidden. The session clock is deleted (no render, no
 * deadline, no interval). The everyday gate row (continue · park · another
 * day) is deleted — no render, no wiring, the skip link with it.
 *
 * The ending verb (owner decision 3): the trimmed, lowercased answer is
 * matched BEFORE the turn is sent against a small plain phrase set —
 * "that's enough", "that's all", "i'm done", "i'm finished",
 * "done for today". A phrase matches at a word boundary (trailing
 * punctuation ignored): "that's enough for today" closes. A match runs
 * the close (endAndGoToReviews) instead of the turn — no turn is sent.
 *
 * The descent gate (owner decision 4): keep going · hold my place ·
 * not today — resident under every rung while s.sounding is live (the
 * sounding/gate route's choices continue · park · another-day), absent
 * otherwise. The sounding OFFER (the consent ask) still renders as before.
 *
 * Declaration by utterance (owner decision 5): the dimmed line "about
 * yourself — or name what this sitting is about" floats above the first
 * question while the sitting is fresh and fades on the first words.
 * Touching it opens a small input → POST /api/session/:id/declare (a
 * 404/400 renders a quiet error); the FIRST turn's text matching a
 * declaration pattern ("about X" / "this is about X") is intercepted
 * client-side — declare instead of turn, then the opener question shows.
 * Freshness is keyed on the session id: a new sitting resets it; a reload
 * mid-sitting shows the line once more (the room has no turn count —
 * declaration is true at the moment it is uttered).
 *
 * The promise line (owner decision 6): while deps.firstLaunch() is true,
 * "It keeps only your words — and you review everything it keeps." floats
 * above the first question; the room clears the flag when the first
 * sitting ends (every close path).
 *
 * The DRM offer is deleted (owner decision 7): the walk's only entry is
 * Today's door; the mid-sitting offer row is gone.
 */

import type { CutProposal, GateReading, HarvestDecision, SoundingEnd } from '../src/types.ts';
import { descentCloseWord, sourceWord } from './provenance.js';
import { lineageBlock } from './lineage.js';
import { pasteTracker } from './paste-tracker.js';
import { ensureProtocolMeta, protocolLabel, protocolTitle } from './protocol-meta.js';
import { triadSurface, toggleTriad, type PhaseMetaLike } from './triad-surface.js';
import type { DictationOpts } from './dictation.js';
import { endAndGoToReviews, takeDrmResumeProbe } from './deps.js';
import type { DrmResumeProbe, EndResponse, SessionState, WebDepsShell } from './deps.js';

/** The room's deps: one object for all three furniture states — the shell
 *  verbs (WebDepsShell), the writable session-state handle, the shared
 *  dictation wiring, the quiet-error line, the two harvest-state clears
 *  the blank furniture makes, and the two room flags (the day-walk
 *  discriminator and the first-launch promise). */
export interface RoomDeps extends WebDepsShell {
 session: SessionState;
 wireDictation: (opts: DictationOpts) => void;
 showQuietError: (container: HTMLElement, message: string) => void;
 /** The blank furniture clears the harvest state (unprompted's flow). */
 setProposals: (proposals: CutProposal[]) => void;
 setDecisions: (decisions: HarvestDecision[]) => void;
 /** True while the open session runs the drm machine (owner decision 1):
 *  set by Today's door, kept by the room through the walk, cleared when
 *  the walk closes. */
 drmWalk: () => boolean;
 setDrmWalk: (v: boolean) => void;
/** The first-launch flag (owner decision 6): the promise line renders
 *  while it is set; the room clears it when a sitting ends. */
firstLaunch: () => boolean;
clearFirstLaunch: () => void;
/** Whether a sitting has ever been recorded (canon §5.1): the blank
 *  page's back word renders only when there is a today to go back to. */
hasSittings: () => boolean;
/** The first-launch auto-open's failure sentence, taken once (canon §6
 *  rule 5 — the failure is a sentence, never a silence). */
takeOpenFailure: () => string | null;
/** The today-existence flag (canon §5.1): recomputed from the server's
 *  cadence when a sitting ends — the same close paths that clear
 *  firstLaunch — so the today word appears the moment the first sitting
 *  has earned it. */
recomputeHasSittings: () => Promise<void>;
}

/** The turn route's reply shape (the sitting grammar), moved verbatim from
 *  the exchange surface. */
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
  * The machine phase meta (ticket 159, slice 4): the turn response's
  * `phase` field is the machine shape { id, label, step, of } — the
  * polymorphic session-phase-string wire is retired. Other routes that
  * reuse the type (the sounding gate) still send the session phase string,
  * which applyProbe ignores.
  */
 phase?: PhaseMetaLike;
}

/**
 * The door question a descent close leaves behind (012 T9). The gate route
 * returns no text on descent-closed — the server appends this same
 * sentence to its transcript — so the room renders it itself. The wording
 * announces the descent closing, never the person stopping (Q-46).
 */
const DOOR_QUESTION = "Anything else we didn't touch?";

/** The promise line (owner decision 6, canon §5.1): the first-launch
 *  sentence above the first question, gone after the first sitting. */
const PROMISE_LINE = 'It keeps only your words \u2014 and you review everything it keeps.';

/** The declaration line (owner decision 5, canon §5.3): one dimmed line
 *  above the first question, fading on the first words. */
const DECLARATION_LINE = 'about yourself \u2014 or name what this sitting is about';

/**
 * The ending verb (owner decision 3): the person's own words close the
 * sitting — no gate, no form. The set is deliberately small and plain;
 * a phrase matches at a word boundary with trailing punctuation ignored,
 * so "that's enough for today" closes and "i'm done" closes, while a
 * normal answer never collides (the set is all whole-sentence closers).
 */
const ENDING_VERBS = [
 "that's enough",
 "that's all",
 "i'm done",
 "i'm finished",
 'done for today',
] as const;

/** Normalize an answer for the ending-verb and declaration matches:
 *  lowercase, trim, collapse internal whitespace, drop trailing punctuation. */
function normalized(text: string): string {
 return text.trim().toLowerCase().replace(/[.!?\u2026]+$/, '').replace(/\s+/g, ' ');
}

function isEndingVerb(text: string): boolean {
 const t = normalized(text);
 return ENDING_VERBS.some((v) => t === v || t.startsWith(v + ' '));
}

/** The declaration pattern (owner decision 5): the FIRST turn's text
 *  starting with "about X" or "this is about X" declares the topic. */
const DECLARATION_PATTERN = /^(?:about|this is about)\s+(.+)$/;

/** The declared topic when the text is a declaration, else null. */
function declarationTopic(text: string): string | null {
 const t = normalized(text);
 const m = DECLARATION_PATTERN.exec(t);
 if (m === null) return null;
 const topic = m[1]!.trim();
 return topic.length > 0 ? topic : null;
}

/* The sitting's freshness (owner decision 5): the declaration line (and
 * the first-launch promise line) float above the FIRST question only.
 * Keyed on the session id — a new sitting resets it; a reload mid-sitting
 * shows it once more (the room has no turn count). */
let freshSessionId: string | null = null;
let freshSitting = true;

/**
 * POST /api/session/:id/declare {topic} (owner decision 5, R3's route) —
 * the one declare verb for both the touch input and the first-turn
 * interception. On success the sitting is no longer fresh and the room
 * re-renders (a question on the response replaces the opener; otherwise
 * the opener stands). On a 404/400 the error surfaces to the caller.
 */
async function postDeclare(deps: RoomDeps, topic: string): Promise<void> {
 const res = await deps.api<{ question?: string; text?: string }>(
  `/api/session/${deps.session.sessionId()}/declare`,
  { topic },
 );
 freshSitting = false;
 const nextQuestion = res.question ?? res.text;
 if (nextQuestion !== undefined) deps.session.setQuestion(nextQuestion);
 renderRoom(deps);
}

/**
 * The first-moments lines (owner decisions 5 + 6): the promise line (first
 * launch only) and the declaration line float above the first question
 * while the sitting is fresh. Both fade on the first words; touching the
 * declaration line opens a small input that posts the declare route (a
 * failed post renders a quiet error and restores the line). Returns a
 * fade handle for the answer field's first-input listener, or null when
 * there is nothing to show.
 */
function renderFreshLines(deps: RoomDeps, container: HTMLElement): { fade: () => void } | null {
 const fadeables: HTMLElement[] = [];
 if (deps.firstLaunch()) {
  fadeables.push(deps.el('div', { class: 'room-promise' }, PROMISE_LINE));
 }
 if (freshSitting) {
  const line = deps.el('div', { class: 'room-declaration' }, DECLARATION_LINE);
  fadeables.push(line);
  line.addEventListener('click', () => {
   // Touch-to-declare (owner decision 5): the line becomes a small input.
   if (line.classList.contains('faded')) return;
   const next = line.nextSibling;
   const input = deps.el('input', {
    class: 'room-declare-input',
    type: 'text',
    placeholder: 'what is this sitting about?',
   });
   line.replaceWith(input);
   requestAnimationFrame(() => input.focus());
   input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
     const topic = input.value.trim();
     if (!topic) return;
     input.disabled = true;
     void postDeclare(deps, topic).catch(() => {
      input.disabled = false;
      deps.showQuietError(container, 'that did not land \u2014 say it, or tap the line again');
     });
    } else if (e.key === 'Escape') {
     input.remove();
     if (next !== null) container.insertBefore(line, next);
     else container.append(line);
    }
   });
  });
 }
 if (fadeables.length === 0) return null;
 container.append(...fadeables);
 let faded = false;
 return {
  fade: () => {
   if (faded) return;
   faded = true;
   for (const el of fadeables) el.classList.add('faded');
  },
 };
}

/**
 * The room's ONE render function (owner decision 1): the furniture
 * discriminates on the session id and the day-walk flag; the room owns
 * the sessionless state, so there is no guard.
 */
export function renderRoom(deps: RoomDeps): void {
 deps.clear();
 deps.setScreen('room');
 deps.renderShell();
 if (deps.session.sessionId() === null) {
  renderBlank(deps);
  return;
 }
 // Take-then-clear, exactly as the DRM screen did: a parked walk's first
 // probe rides into the room; the flag covers a walk the door began fresh.
 const resumeProbe = takeDrmResumeProbe();
 if (deps.drmWalk() || resumeProbe !== null) {
  renderWalk(deps, resumeProbe);
  return;
 }
 renderSitting(deps);
}

/* ── Furniture 1: the blank page (the sessionless void, just write) ── */

/** The blank-page furniture: no session, no question — a bare page and
 *  mic/done that post /api/unprompted. Moved from the unprompted surface. */
function renderBlank(deps: RoomDeps): void {
 // No session-id or question clearing here: the discriminator only enters
 // this furniture when the id is ALREADY null, and the just-write door
 // owns the transition (today.ts sets it before navigating). Clearing on
 // every render is what made a re-render eat the person's words.
 deps.setProposals([]);
 deps.setDecisions([]);

 const div = deps.el('div', { class: 'screen active room' });

 // The back word needs a today to go back to (canon §5.1): before the
 // first sitting there is nowhere to return to, and a dead link that
 // bounces back here would eat the page.
 if (deps.hasSittings()) {
  const backRow = deps.el('div', { class: 'blank-page-nav' });
  const backBtn = deps.el('button', { class: 'nav-link' }, '\u2190 back');
  backBtn.addEventListener('click', () => deps.navTo('today'));
  backRow.append(backBtn);
  div.append(backRow);
 }

 // The failed auto-open is a sentence (canon §6 rule 5), never a silence.
 const openFailure = deps.takeOpenFailure();
 if (openFailure !== null) {
  div.append(deps.el('p', { class: 'blank-page-failure' }, openFailure));
 }

 const page = deps.el('textarea', {
  class: 'blank-page',
  rows: '1',
 }) as HTMLTextAreaElement;
 const pageTracker = pasteTracker(page);

 const micBtn = deps.el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
 const micStatus = deps.el('span', { class: 'mic-status' });
 const doneBtn = deps.el('button', { class: 'harvest-now' }, 'done');
 const pageControls = deps.el('div', { class: 'blank-page-controls' });
 pageControls.append(micBtn, micStatus, doneBtn);
 const errorSlot = deps.el('div', { class: 'error-slot' });

 function grow() {
  page.style.height = 'auto';
  page.style.height = page.scrollHeight + 'px';
 }
 page.addEventListener('input', grow);

 const emptyLine = deps.el('p', { class: 'blank-page-empty' }, 'nothing written yet');
 emptyLine.hidden = true;
 doneBtn.addEventListener('click', async () => {
  const text = page.value.trim();
  // Every zero is a sentence (canon §6 rule 5) — an empty done says so
  // quietly instead of doing nothing at all.
  if (!text) {
   emptyLine.hidden = false;
   page.addEventListener('input', () => { emptyLine.hidden = true; }, { once: true });
   return;
  }
  const pasted = pageTracker.isPasted(text);
  pageTracker.reset();
  doneBtn.disabled = true;
  page.disabled = true;
  errorSlot.innerHTML = '';
  const wait = deps.beginWait(errorSlot, 'reading what you wrote\u2026');
  try {
   const res = await deps.api<EndResponse>(
    '/api/unprompted',
    { text, channel: pasted ? 'pasted' : deps.session.turnHadSpeech() ? 'spoken' : 'typed' },
   );
   deps.session.setSessionId(res.sessionId);
   deps.session.setPendingReviewSession(res.sessionId);
   wait.done();
   deps.session.setTurnHadSpeech(false);
   deps.navTo('review');
  } catch (e) {
   wait.failed(e);
   doneBtn.disabled = false;
   page.disabled = false;
  }
 });

div.append(page, pageControls, emptyLine, errorSlot);
deps.main.append(div);

 deps.wireDictation({
  textarea: page,
  micBtn,
  micStatus,
  errorSlot,
  onSpeech: () => { deps.session.setTurnHadSpeech(true); },
 });

 requestAnimationFrame(() => {
  page.focus();
  grow();
 });
}

/* ── Furniture 2: the day-walk (the drm machine's phases) ── */

/** The drm turn routes' one wire shape (start, enumerate-done, probe,
 *  gate): the response kind plus the phase fields — required after the
 *  enumeration, optional on a probe/gate reply. */
interface DrmTurnResponse {
 kind: string;
 text: string;
 episode: number;
 of: number;
 step: string;
 gate: { episode: number; of: number; label: string };
 atEnd?: boolean;
 machinePhase?: PhaseMetaLike;
}

/** The day-walk furniture: the yesterday intro, the day-map enumeration,
 *  and the episode probes with the exchange grammar — moved from the DRM
 *  surface, dispatching on the machine phase meta renderer 'drm-day-map'.
 *  The walk keeps its own episode-gate words (continue · park, depth kept
 *  · another day): that gate is a machine checkpoint, not the everyday
 *  sitting row the wave deleted. */
function renderWalk(deps: RoomDeps, resumeProbe: DrmResumeProbe | null): void {
 deps.setDrmWalk(true);
 const sessionId = deps.session.sessionId()!;

 const div = deps.el('div', { class: 'screen active room drm-screen' });
 // The walk reads as the def title (ticket 157), never the jargon.
 const header = deps.el('h2', { class: 'exchange-heading' });
 protocolLabel(header, 'drm');
 div.append(header);

 // ── Intro ──
 // Yesterday, computed the way the server anchors it (src/drm/state.ts
 // initDRM): the previous calendar day in ISO date form. Display-only —
 // the wire contract is untouched.
 const yesterdayIso = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
 const introBlock = deps.el('div', { class: 'drm-phase drm-intro' });
 const beginBtn = deps.el('button', { class: 'nav-link drm-begin-btn' }, 'begin');
 introBlock.append(
  deps.el('p', { class: 'drm-intro-prompt' },
   'Yesterday was ',
   deps.el('span', { class: 'drm-yesterday' }, yesterdayIso),
   ' \u2014 walk through your day, hour by hour.'),
  beginBtn,
 );

 // ── Enumeration ──
 const enumBlock = deps.el('div', { class: 'drm-phase drm-enum' });
 const nameInput = deps.el('input', {
  class: 'drm-episode-name',
  type: 'text',
  placeholder: 'block name',
 });
 const hourSelect = deps.el('select', { class: 'drm-hour' });
 for (let h = 5; h <= 23; h++) {
  const opt = deps.el('option', { value: String(h) }, `~${h}:00`);
  hourSelect.append(opt);
 }
 const addBtn = deps.el('button', { class: 'drm-add-btn', type: 'button' }, 'add a block');
 const doneBtn = deps.el('button', { class: 'drm-done-btn', type: 'button' }, "that's the day");
 const episodeList = deps.el('div', { class: 'drm-episode-list' });
 const enumRow = deps.el('div', { class: 'drm-enum-row' });
 enumRow.append(nameInput, hourSelect, addBtn, doneBtn);
 enumBlock.append(enumRow, episodeList);

 // ── Probe area — the exchange grammar (ticket 157): dimmed protocol
 // title above the question, question block, dictation, send, beginWait.
 const probeBlock = deps.el('div', { class: 'drm-phase drm-probe' });
 const probeLabel = deps.el('div', { class: 'exchange-protocol' });
 protocolLabel(probeLabel, 'drm');
 const probeMeta = deps.el('div', { class: 'drm-probe-meta' });
 const probeQuestion = deps.el('div', { class: 'question-block' });
 const textarea = deps.el('textarea', {
  class: 'answer-textarea',
  placeholder: '\u2026',
  rows: '3',
 });
 const micBtn = deps.el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
 const micStatus = deps.el('span', { class: 'mic-status' });
 const sendBtn = deps.el('button', { class: 'send-btn', type: 'button' }, 'send \u21b5');
 const answerRow = deps.el('div', { class: 'answer-row' });
 answerRow.append(textarea, micBtn, micStatus, sendBtn);
 probeBlock.append(probeLabel, probeMeta, probeQuestion, answerRow);

 // ── Gate-row (Q-44: the walk's episode gate — hidden until the probe phase)
 const gateBlock = deps.el('div', { class: 'gate-row drm-gate' });
 const gateReading = deps.el('span', { class: 'gate-reading' });
 const continueWord = deps.el('button', { class: 'gate-word continue', type: 'button' }, 'continue');
 const parkWord = deps.el('button', { class: 'gate-word park', type: 'button' }, 'park, depth kept');
 const anotherDayWord = deps.el('button', { class: 'gate-word another-day', type: 'button' }, 'another day');
 gateBlock.append(gateReading, continueWord, parkWord, anotherDayWord);
 gateBlock.classList.remove('visible');
 probeBlock.append(gateBlock);

 div.append(introBlock, enumBlock, probeBlock);
 deps.main.append(div);

 // ── DRM episode data, held locally ──
 let episodes: { name: string; startHour: number }[] = [];

 // Phases re-render with a quiet transition (ticket 157): only the active
 // phase is in the flow; the newly shown one fades in.
 function showPhase(phase: 'intro' | 'enumerate' | 'probe') {
  const phases: [HTMLElement, 'intro' | 'enumerate' | 'probe'][] = [
   [introBlock, 'intro'],
   [enumBlock, 'enumerate'],
   [probeBlock, 'probe'],
  ];
  for (const [block, name] of phases) {
   const active = name === phase;
   block.classList.toggle('active', active);
   block.classList.remove('fade-in');
   if (active) {
    void block.offsetWidth;
    block.classList.add('fade-in');
   }
  }
 }

 function setBusy(busy: boolean) {
  textarea.disabled = busy;
  sendBtn.disabled = busy;
  micBtn.disabled = busy;
  beginBtn.disabled = busy;
  addBtn.disabled = busy;
  doneBtn.disabled = busy;
  continueWord.disabled = busy;
  parkWord.disabled = busy;
  anotherDayWord.disabled = busy;
 }

 // ── The renderer contract (ticket 159, slice 6) ──
 // The walk dispatches on the ACTIVE phase's renderer: 'drm-day-map'
 // shows the day-map UI (episodes list + add-block row); every other
 // renderer — an unknown one included — falls back to the generic question
 // block, never a crash. Without a phase meta (an older server) the
 // response kind still says where the flow is.
 function showPhaseFor(meta: PhaseMetaLike | undefined, kind: string) {
  if (meta?.renderer === 'drm-day-map') {
   showPhase('enumerate');
   return;
  }
  if (meta !== undefined) {
   showPhase('probe');
   return;
  }
  showPhase(kind === 'drm-enumerate' ? 'enumerate' : 'probe');
 }

 // ── Intro: begin ──
 beginBtn.addEventListener('click', async () => {
  setBusy(true);
  const wait = deps.beginWait(introBlock, 'starting\u2026', 150);
  try {
   const res = await deps.api<DrmTurnResponse>(`/api/session/${sessionId}/drm/start`);
   wait.done();
   deps.setDrmWalk(true);
   showPhaseFor(res.machinePhase, res.kind);
   nameInput.focus();
  } catch (e) {
   wait.failed(e, 'could not start');
   setBusy(false);
  }
 });

 // ── Enumeration: add a block ──
 function refreshEpisodeList() {
  episodeList.innerHTML = '';
  for (let i = 0; i < episodes.length; i++) {
   const ep = episodes[i]!;
   const row = deps.el('div', { class: 'drm-episode-item' });
   row.append(
    deps.el('span', { class: 'drm-episode-name-text' }, ep.name),
    deps.el('span', { class: 'drm-episode-meta' }, `~${ep.startHour}:00`),
   );
   episodeList.append(row);
  }
 }

 async function doAddBlock() {
  const name = nameInput.value.trim();
  if (!name) return;
  const startHour = parseInt(hourSelect.value, 10);

  setBusy(true);
  const wait = deps.beginWait(enumBlock, 'adding\u2026', 150);
  try {
   await deps.api(`/api/session/${sessionId}/drm/episode`, { name, startHour });
   wait.done();
   episodes.push({ name, startHour });
   refreshEpisodeList();
   nameInput.value = '';
   nameInput.focus();
  } catch (e) {
   wait.failed(e, 'could not add the block');
   setBusy(false);
  }
 }

 addBtn.addEventListener('click', doAddBlock);
 nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doAddBlock();
 });

 // ── Enumeration: that's the day ──
 doneBtn.addEventListener('click', async () => {
  if (episodes.length === 0) return;
  setBusy(true);
  const wait = deps.beginWait(enumBlock, 'reading the day back\u2026', 150);
  try {
   const res = await deps.api<DrmTurnResponse>(`/api/session/${sessionId}/drm/enumerate-done`);
   wait.done();
   deps.setDrmWalk(true);
   showPhaseFor(res.machinePhase, res.kind);
   probeQuestion.textContent = res.text;
   probeMeta.textContent = `block ${res.episode} of ${res.of} \u00b7 ${res.step}`;
   gateReading.textContent = res.gate.label;
   gateBlock.classList.add('visible');
   textarea.focus();
  } catch (e) {
   wait.failed(e, 'could not start the probes');
   setBusy(false);
  }
 });

 // ── Probe: answer ──
 async function sendAnswer() {
  const text = textarea.value.trim();
  if (!text) return;

  // The ending verb (owner decision 3) closes the walk through its gate —
  // the machine's own close, then the end.
  if (isEndingVerb(text)) {
   pressGate('park');
   return;
  }

  setBusy(true);
  const wait = deps.beginWait(probeBlock, 'thinking\u2026', 150);
  try {
   const res = await deps.api<DrmTurnResponse>(`/api/session/${sessionId}/drm/probe`, { text });

   textarea.value = '';

   if (res.kind === 'drm-gate') {
    // At episode gate
    wait.done();
    const atEnd = res.atEnd ?? false;
    continueWord.hidden = false;
    continueWord.textContent = atEnd ? 'finish' : 'continue';
    gateBlock.classList.add('checkpoint');
    gateReading.textContent = res.gate?.label ?? '';
    setBusy(false);
    // The checkpoint withholds the writing surface — the gate is the
    // thing on screen (the exchange grammar).
    textarea.disabled = true;
    sendBtn.disabled = true;
    micBtn.disabled = true;
   } else if (res.kind === 'drm-probe') {
    // More probes
    wait.done();
    probeQuestion.textContent = res.text ?? '';
    probeMeta.textContent = `block ${res.episode} of ${res.of} \u00b7 ${res.step}`;
    gateReading.textContent = res.gate?.label ?? '';
    continueWord.hidden = true;
    gateBlock.classList.remove('checkpoint');
    setBusy(false);
    textarea.focus();
   }
  } catch (e) {
   wait.failed(e, 'could not send');
   setBusy(false);
  }
 }

 sendBtn.addEventListener('click', sendAnswer);
 textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
   e.preventDefault();
   sendAnswer();
  }
 });

 // ── Gate: continue / park / another-day ──
 async function pressGate(choice: 'continue' | 'park' | 'another-day') {
  setBusy(true);
  const wait = deps.beginWait(
   probeBlock,
   choice === 'continue' ? 'continuing\u2026' : 'putting it away\u2026',
  );
  try {
   const res = await deps.api<DrmTurnResponse>(`/api/session/${sessionId}/drm/gate`, { choice });

   if (res.kind === 'drm-closed') {
    // DRM complete — end the session for harvest; the wait holds through
    // the harvest call. The helper parks the pending review only when the
    // harvest actually runs, and goes to reviews either way — the sitting
    // is over even if the end call fails. The first-launch flag dies with
    // the first sitting (owner decision 6).
    deps.setDrmWalk(false);
    deps.clearFirstLaunch();
    await deps.recomputeHasSittings();
    try {
     await endAndGoToReviews(deps.api, sessionId, deps.session.setPendingReviewSession, deps.navTo);
     wait.done();
    } catch {
     wait.done();
     deps.navTo('review');
    }
    return;
   }

   // Continue to next episode
   if (res.kind === 'drm-probe') {
    wait.done();
    deps.setDrmWalk(true);
    probeQuestion.textContent = res.text ?? '';
    probeMeta.textContent = `block ${res.episode} of ${res.of} \u00b7 ${res.step}`;
    gateReading.textContent = res.gate?.label ?? '';
    continueWord.hidden = true;
    gateBlock.classList.remove('checkpoint');
    setBusy(false);
    textarea.focus();
   }
  } catch (e) {
   wait.failed(e, 'could not process');
   setBusy(false);
  }
 }

 continueWord.addEventListener('click', () => pressGate('continue'));
 parkWord.addEventListener('click', () => pressGate('park'));
 anotherDayWord.addEventListener('click', () => pressGate('another-day'));

 // ── The exchange writing grammar: typewriter auto-grow, dictation ──
 textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
 });

 deps.wireDictation({
  textarea,
  micBtn,
  micStatus,
  errorSlot: probeBlock,
 });

 // ── A picked-up parked DRM continues in the probe UI ──
 // The resume route already composed the first probe; the walk shows it
 // directly instead of the intro (ticket 159, slice 6 — the exact phase
 // continues).
 if (resumeProbe) {
  probeQuestion.textContent = resumeProbe.text;
  probeMeta.textContent = `block ${resumeProbe.episode} of ${resumeProbe.of} \u00b7 ${resumeProbe.step}`;
  gateReading.textContent = resumeProbe.gate.label;
  gateBlock.classList.add('visible');
  showPhase('probe');
  textarea.focus();
 }
}

/* ── Furniture 3: the sitting grammar ── */

/** The opening pulse (ticket 105): a one-line inner-weather input shown
 *  before the first question. Skippable with no record of the skip. */
function pulseExchange(deps: RoomDeps, container: HTMLElement, freshLines: { fade: () => void } | null) {
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

 // The fresh lines fade on the first words, pulse included (canon §5.3).
 input.addEventListener('input', () => freshLines?.fade());

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
  deps.session.setPulsePrompt(null);
  deps.session.setQuestion(pendingQuestion);
  deps.session.setPendingQuestion(null);
  renderRoom(deps);
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
  renderRoom(deps);
 }

 sendWord.addEventListener('click', submit);
 skipWord.addEventListener('click', skip);
 input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
 });
}

/** The sitting grammar: the question block, the answer field, the descent
 *  gate, the sounding offer, the repair row, the opening pulse, the void,
 *  the fresh lines — moved from the exchange surface with the wave's
 *  deletions (clock, everyday gate row, skip, DRM offer). */
function renderSitting(deps: RoomDeps): void {
 // A fresh sitting starts with no descent and no offer (012 T9); the
 // re-render must not inherit either from a previous screen.
 deps.session.setSounding(null);
 deps.session.setSoundingOffer(null);
 deps.session.setTurnHadSpeech(false);

 // The freshness reset (owner decision 5): a new session id means a new
 // first question — the declaration line returns.
 const sid = deps.session.sessionId();
 if (sid !== null && sid !== freshSessionId) {
  freshSessionId = sid;
  freshSitting = true;
 }

 const div = deps.el('div', { class: 'screen active room' });

 // ── Opening pulse (ticket 105): a one-line inner-weather input ──
 // Shown when the server includes a pulsePrompt; skipped with no record.
 if (deps.session.pulsePrompt()) {
  const freshLines = renderFreshLines(deps, div);
  pulseExchange(deps, div, freshLines);
  deps.main.append(div);
  return;
 }

 const header = deps.el('div', { class: 'exchange-header' });
 // The first-moments lines (owner decisions 5 + 6): the promise line and
 // the declaration line float above the first question.
 const freshLines = renderFreshLines(deps, header);
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
  const protocolTag = deps.el('div', { class: 'exchange-protocol' }, protocolTitle(protocol));
  void ensureProtocolMeta().then(() => {
   const fresh = deps.session.sessionProtocol();
   if (!fresh) return;
   protocolTag.textContent = protocolTitle(fresh);
  });
  header.append(protocolTag);
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
      renderRoom(deps);
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

 // The void (owner decision 2): the transcript is born hidden — the CSS
 // hides `.room .transcript` until the 'summoned' class lands, and every
 // render starts hidden again. The summon gesture is a scroll-up over the
 // room (wheel up, or a finger dragging down): a glance upward at your own
 // words, nothing resident.
 const transcript = deps.el('div', { class: 'transcript' });
 let transcriptSummoned = false;
 function summonTranscript() {
  if (transcriptSummoned) return;
  transcriptSummoned = true;
  transcript.classList.add('summoned');
 }
 div.addEventListener('wheel', (e) => {
  if (e.deltaY < 0) summonTranscript();
 }, { passive: true });
 let touchStartY = 0;
 div.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0]?.clientY ?? 0;
 }, { passive: true });
 div.addEventListener('touchmove', (e) => {
  const y = e.touches[0]?.clientY ?? touchStartY;
  if (y - touchStartY > 32) summonTranscript();
 }, { passive: true });

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

 // ── The descent gate (owner decision 4): keep going · hold my place ·
 // not today, resident under every rung of a live descent. The live
 // descent reading is set on every rung and never cached, so the row is
 // born on the first reading and rewritten in place on every rung after
 // that. The everyday gate row is DELETED: the row is born hidden and
 // shows only while s.sounding is live — the person's own ending verb
 // closes the everyday sitting.
 const gateRow = deps.el('div', { class: 'gate-row' });
 const gateReading = deps.el('span', { class: 'gate-reading' });
 const keepGoingWord = deps.el('button', { class: 'gate-word continue', type: 'button' }, 'keep going');
 const holdMyPlaceWord = deps.el('button', { class: 'gate-word park', type: 'button' }, 'hold my place');
 const notTodayWord = deps.el('button', { class: 'gate-word another-day', type: 'button' }, 'not today');
 gateRow.append(gateReading, keepGoingWord, holdMyPlaceWord, notTodayWord);
 // Born hidden; renderGate shows it while a descent runs. No 'visible'
 // at birth — the everyday gate row is gone.
 keepGoingWord.hidden = true;

 // The standard surface's controls; renderGate narrows the set while a
 // descent runs, and removeGateRow restores it.
 let gateControls: HTMLButtonElement[] = [holdMyPlaceWord, notTodayWord];
 let checkpointActive = false;

 /** Render the gate row for the current reading, in the checkpoint state or out. */
 function renderGate(checkpoint: boolean) {
  const reading = deps.session.sounding();
  if (!reading) return;
  checkpointActive = checkpoint;
  keepGoingWord.hidden = !checkpoint;
  gateControls = checkpoint
   ? [keepGoingWord, holdMyPlaceWord, notTodayWord]
   : [holdMyPlaceWord, notTodayWord];
  gateReading.textContent = `continuing \u00b7 step ${reading.rung} of ${reading.of}`;
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

 /** Take the gate off the screen and restore the standard surface. */
 function removeGateRow() {
  gateRow.classList.remove('checkpoint');
  keepGoingWord.hidden = true;
  gateControls = [holdMyPlaceWord, notTodayWord];
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

 /** Apply a probe response to the sitting surface (012 T9): the question,
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

 keepGoingWord.addEventListener('click', () => pressGate('continue'));
 holdMyPlaceWord.addEventListener('click', () => pressGate('park'));
 notTodayWord.addEventListener('click', () => pressGate('another-day'));

 answerRow.append(textarea, micBtn, micStatus, sendBtn);
 answerArea.append(answerRow, answerHint, gateRow);

 div.append(header, transcript, answerArea);
 deps.main.append(div);

 // typewriter auto-grow; the fresh lines fade on the first words (canon §5.3)
 textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
  freshLines?.fade();
 });

 // focus dimming
 textarea.addEventListener('focus', () => {
  deps.document.body.classList.add('answering');
 });
 textarea.addEventListener('blur', () => {
  deps.document.body.classList.remove('answering');
 });

 /** The one close (owner decisions 3 + 6): run the end, clear the
 *  first-launch flag (the promise line dies with the first sitting),
 *  recompute the today-existence flag (canon §5.1), and hand the review
 *  over. No turn is sent — the person's words were the verb, not an
 *  answer. */
 async function closeSitting() {
  deps.clearFirstLaunch();
  await deps.recomputeHasSittings();
  setControlsBusy(true);
  const wait = deps.beginWait(answerArea, 'reading back what you said\u2026');
  try {
   await endAndGoToReviews(deps.api, deps.session.sessionId()!, deps.session.setPendingReviewSession, deps.navTo);
   wait.done();
  } catch (e) {
   wait.failed(e);
   setControlsBusy(false);
  }
 }

 async function sendTurn() {
  const text = textarea.value.trim();
  if (!text) return;

  // The ending verb (owner decision 3): the person's own words close the
  // sitting — matched BEFORE the turn is sent; a match runs the close and
  // no turn is sent.
  if (isEndingVerb(text)) {
   await closeSitting();
   return;
  }

  // Declaration by utterance (owner decision 5): the FIRST turn's words
  // matching a declaration pattern are intercepted — declare instead of
  // turn, then the opener question shows.
  if (freshSitting) {
   const topic = declarationTopic(text);
   if (topic !== null) {
    turnTracker.reset();
    setControlsBusy(true);
    const wait = deps.beginWait(answerArea, 'naming it\u2026');
    try {
     await postDeclare(deps, topic);
     wait.done();
    } catch (e) {
     // The words go back to the field; the quiet failure says why.
     wait.failed(e);
     setControlsBusy(false);
    }
    return;
   }
  }

  // The first question is spent the moment a real turn goes out (owner
  // decision 5): the declaration interception belongs to the first moments.
  freshSitting = false;
  const pasted = turnTracker.isPasted(text);
  turnTracker.reset();
  textarea.disabled = true;
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

  const wait = deps.beginWait(answerArea, 'thinking\u2026');

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
    // The first-launch flag dies with the first sitting (owner decision
    // 6); the today-existence flag recomputes in the same breath
    // (canon §5.1).
    deps.clearFirstLaunch();
    await deps.recomputeHasSittings();
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
     await endAndGoToReviews(
      deps.api,
      deps.session.sessionId()!,
      deps.session.setPendingReviewSession,
      deps.navTo,
     );
     wait.done();
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
  if (deps.session.sttAvailable()) micBtn.disabled = busy;
  sendBtn.disabled = busy;
  for (const c of gateControls) c.disabled = busy;
 }

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
