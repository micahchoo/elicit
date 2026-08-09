/**
 * The DRM surface: the yesterday intro, the day-map enumeration, and the
 * episode probes with the exchange grammar — moved whole from main.ts;
 * every rendered string, class, DOM structure and e2e selector is
 * byte-identical.
 *
 * Injection, not import: `el`, `api`, `navTo`, `beginWait`, the shell
 * verbs, the session id, the harvest hand-off and the dictation wiring are
 * main.ts module-private (the import-review pattern). The protocol titles
 * come from the shared protocol-meta module (ticket 157), the dictation
 * wiring from the dictation module, and the parked-probe take from the
 * waiting module — all three exist.
 */

import { protocolLabel } from './protocol-meta.js';
import { takeDrmResumeProbe } from './waiting.js';
import type { PhaseMetaLike } from './triad-surface.js';
import type { DictationOpts } from './dictation.js';
import { endAndGoToReviews } from './deps.js';
import type { WebDepsShell } from './deps.js';

/** The DRM surface's deps: the flat verbs beyond the shell seam — the
 *  session id the drm routes hang on, the harvest hand-off, and the shared
 *  dictation wiring bound to main.ts's dictationDeps. */
export interface DrmDeps extends WebDepsShell {
 sessionId: () => string | null;
 setPendingReviewSession: (id: string | null) => void;
 wireDictation: (opts: DictationOpts) => void;
}

/** The machine phase meta the drm routes carry (ticket 159, slice 6): the
 *  same PhaseMetaLike shape as the turn response — the phase id/label/step/
 *  of plus the phase's renderer when it declares one (the day-map during
 *  enumeration, the triad names during people-grid's triads). Absent on an
 *  older server. */
type DrmPhaseMeta = PhaseMetaLike;

/** The DRM turn routes' one wire shape (start, enumerate-done, probe,
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
 machinePhase?: DrmPhaseMeta;
}

/** A parked DRM picked up from the waiting surface: its first probe, shown
 *  by renderDRM directly (the resume route already composed it). */
export function renderDRM(deps: DrmDeps): void {
  deps.clear();
  deps.setScreen('drm');
  deps.renderShell();

  const div = deps.el('div', { class: 'screen active drm-screen' });
  // The screen reads as the def title (ticket 157), never the jargon.
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

  // ── Gate-row (Q-44: always visible, replicate Sounding pattern) ──
  const gateBlock = deps.el('div', { class: 'gate-row drm-gate' });
  const gateReading = deps.el('span', { class: 'gate-reading' });
  const continueWord = deps.el('button', { class: 'gate-word continue', type: 'button' }, 'continue');
  const parkWord = deps.el('button', { class: 'gate-word park', type: 'button' }, 'park, depth kept');
  const anotherDayWord = deps.el('button', { class: 'gate-word another-day', type: 'button' }, 'another day');
  gateBlock.append(gateReading, continueWord, parkWord, anotherDayWord);
  // Gate not visible until probe phase
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
     // Restart the fade on every re-show.
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
  // The screen dispatches on the ACTIVE phase's renderer: 'drm-day-map'
  // shows the day-map UI (episodes list + add-block row); every other
  // renderer — an unknown one included — falls back to the generic question
  // block, never a crash. Without a phase meta (an older server) the
  // response kind still says where the flow is.
  function showPhaseFor(meta: DrmPhaseMeta | undefined, kind: string) {
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
    const res = await deps.api<DrmTurnResponse>(`/api/session/${deps.sessionId()}/drm/start`);
    wait.done();
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
    await deps.api(`/api/session/${deps.sessionId()}/drm/episode`, { name, startHour });
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
    const res = await deps.api<DrmTurnResponse>(`/api/session/${deps.sessionId()}/drm/enumerate-done`);
    wait.done();
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

   setBusy(true);
   const wait = deps.beginWait(probeBlock, 'thinking\u2026', 150);
   try {
    const res = await deps.api<DrmTurnResponse>(`/api/session/${deps.sessionId()}/drm/probe`, { text });

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
    const res = await deps.api<DrmTurnResponse>(`/api/session/${deps.sessionId()}/drm/gate`, { choice });

    if (res.kind === 'drm-closed') {
     // DRM complete — end the session for harvest; the wait holds through
     // the harvest call. The DRM screen parks the pending review only
     // when the harvest actually runs, and goes to reviews either way —
     // the sitting is over even if the end call fails.
     try {
      await endAndGoToReviews(
       deps.api,
       deps.sessionId()!,
       deps.setPendingReviewSession,
       deps.navTo,
       { gateOnHarvesting: true },
      );
      wait.done();
     } catch {
      // End may fail but session is over
      wait.done();
      deps.navTo('reviews');
     }
     return;
    }

    // Continue to next episode
    if (res.kind === 'drm-probe') {
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
  // The resume route already composed the first probe; the screen shows it
  // directly instead of the intro (ticket 159, slice 6 — the exact phase
  // continues).
  const resumeProbe = takeDrmResumeProbe();
  if (resumeProbe) {
   probeQuestion.textContent = resumeProbe.text;
   probeMeta.textContent = `block ${resumeProbe.episode} of ${resumeProbe.of} \u00b7 ${resumeProbe.step}`;
   gateReading.textContent = resumeProbe.gate.label;
   gateBlock.classList.add('visible');
   showPhase('probe');
   textarea.focus();
  }
}
