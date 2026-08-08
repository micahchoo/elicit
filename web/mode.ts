/**
 * The mode screen: the sitting controls — duration, energy, target, the
 * protocol picker (ticket 157), the Randomizer, stop-jobs and fresh-start
 * — moved whole from main.ts; every rendered string, class, DOM structure
 * and e2e selector is byte-identical.
 *
 * Injection, not import: `el`, `api`, `navTo`, `beginWait`, the shell
 * verbs, the error line and the writable session-state handle are main.ts
 * module-private (the import-review pattern). The handle mutates the REAL
 * AppState object, so the router and the other screens see every write;
 * the sitting hands off to the exchange through the bound renderExchange
 * callback. The one browser-storage read (profile-asked) stays direct, the
 * way main.ts used it — no split surface has a storage seam to match.
 */

import type { Mode, Target } from '../src/types.ts';
import { MINUTE_LADDER } from '../src/queue/mode-needs.js';
import { type OpenerSource } from './provenance.js';
import { protocolOptionRows } from './protocol-options.js';
import { ensureProtocolMeta, protocolRows } from './protocol-meta.js';
import type { SessionState, WebDepsWithWait } from './deps.js';

/** The mode surface's deps: the shell verbs, the writable session-state
 *  handle (the Wave C2 handle, extended with the setters this surface's
 *  sitting-open writes), the dimmed error line, and the hand-off into the
 *  exchange screen. */
export interface ModeDeps extends WebDepsWithWait {
 renderShell: () => void;
 clear: () => void;
 setScreen: (screen: string) => void;
 session: SessionState;
 showError: (msg: string) => void;
 renderExchange: () => void;
}

interface SessionResponse {
 sessionId: string;
 question: string;
 /** Present when the Randomizer dealt the opener (Q-18). */
 source?: OpenerSource;
 /** Display-only lineage of a resurfaced opener (080) — never part of the question. */
 snippetQuestion?: string;
 context?: string;
 /** The rotated pulse prompt (ticket 105): present when the server wants a momentary-state line. */
 pulsePrompt?: string;
 /** The protocol this sitting uses — auto-rotated by server (ticket 140). */
 protocol?: string;
 /** Fragment quoted in the opening question (Q-104): carries the "not mine" verb. */
 quotedFragment?: string;
 /** Snippet ref for the opening question's quoted fragment (Q-109). */
 snippetRef?: string;
}

export function renderMode(deps: ModeDeps, showSetupHint?: boolean): void {
 deps.clear();
 deps.setScreen('mode');
 deps.renderShell();
 deps.session.setJuxtaposition(null);

 const div = deps.el('div', { class: 'screen active mode-form' });

 // Region one — begin: the sitting controls, under one heading.
 const beginHeading = deps.el('h2', { class: 'home-heading' }, 'start a sitting');

 const minutesRow = deps.el('div', { class: 'mode-row' });
 const minLabel = deps.el('label', {}, 'how long?');
 const minSelect = deps.el('select', { class: 'mode-select' });
 for (const m of MINUTE_LADDER) {
  minSelect.append(deps.el('option', { value: String(m) }, `${m} minutes`));
 }
 minutesRow.append(minLabel, minSelect);

 const energyRow = deps.el('div', { class: 'mode-row' });
 const enLabel = deps.el('label', {}, 'energy?');
 const enSelect = deps.el('select', { class: 'mode-select' });
 for (const e of ['low', 'medium', 'high'] as const) {
  enSelect.append(deps.el('option', { value: e }, e));
 }
 energyRow.append(enLabel, enSelect);

 const targetRow = deps.el('div', { class: 'mode-row' });
 const tgtLabel = deps.el('label', {}, 'about?');
 const tgtSelect = deps.el('select', { class: 'mode-select' });
 tgtSelect.append(deps.el('option', { value: 'self' }, 'myself'));
 tgtSelect.append(deps.el('option', { value: 'domain' }, 'something I know'));
 targetRow.append(tgtLabel, tgtSelect);

 // The protocol row (tickets 153/157): one quiet radio list in the mode
 // grammar — "let it choose" first (rotation — no protocol sent), then one
 // row per protocol from the open set the ROUTE returns, never a hardcoded
 // list: the TITLE as the option label, the blurb dimmed under it,
 // "(explicit only)" for rotation:false instruments (drm, people-grid —
 // Q-85) the server never picks on its own. The row enters the DOM only
 // when the fetch succeeds; a failure logs to the console and renders no
 // row — rotation still works, and the row's absence is not an error state.
 const protocolRow = deps.el('div', { class: 'mode-row protocol-row' });
 const protoLabel = deps.el('label', {}, 'protocol?');
 const optionList = deps.el('div', { class: 'protocol-options' });
 protocolRow.append(protoLabel, optionList);

 /** One quiet radio: the title as the label, the blurb dimmed under it. */
 function protocolRadio(id: string, label: string, blurb: string | undefined, explicitOnly: boolean): HTMLLabelElement {
  const input = deps.el('input', { type: 'radio', name: 'protocol-pick', value: id });
  if (id === '') input.checked = true;
  const labelSpan = deps.el('span', { class: 'protocol-option-label' }, label);
  if (explicitOnly) labelSpan.append(deps.el('span', { class: 'protocol-explicit-only' }, ' (explicit only)'));
  const option = deps.el('label', { class: 'protocol-option' });
  option.append(input, labelSpan);
  if (blurb !== undefined) option.append(deps.el('span', { class: 'protocol-option-blurb' }, blurb));
  return option;
 }

 void ensureProtocolMeta()
  .then(() => {
   if (protocolRows.length === 0) return;
   optionList.append(protocolRadio('', 'let it choose', undefined, false));
   for (const row of protocolOptionRows(protocolRows)) {
    optionList.append(protocolRadio(row.id, row.label, row.blurb, row.explicitOnly));
   }
   div.insertBefore(protocolRow, topicInput);
  });

 const topicInput = deps.el('input', {
  class: 'topic-input',
  type: 'text',
  placeholder: 'what would you like to talk about? (optional)',
 });

 const navRow = deps.el('div', { class: 'mode-nav' });
 const writeLink = deps.el('button', { class: 'nav-link' }, 'just write');
 writeLink.addEventListener('click', () => deps.navTo('unprompted'));
 navRow.append(writeLink);

 if (showSetupHint) {
  const setupLink = deps.el('button', { class: 'nav-link' }, 'set a password');
  setupLink.addEventListener('click', () => deps.navTo('setup'));
  navRow.append(setupLink);
 }

 const submit = deps.el('button', { class: 'submit-btn' }, 'begin');
 const errorSlot = deps.el('div', { class: 'error-slot' });

 async function begin(shuffle: boolean) {
  submit.disabled = true;
  shuffleLink.disabled = true;
  errorSlot.innerHTML = '';
  const wait = deps.beginWait(
   errorSlot,
   shuffle ? 'shuffling…' : 'finding a question…',
  );
  try {
   const mode: Mode = {
    minutes: Number(minSelect.value),
    energy: enSelect.value as Mode['energy'],
    target: tgtSelect.value as Target,
   };
   const t = topicInput.value.trim();
   if (t) mode.topic = t;

   // The protocol rides the session when the person picked one; "let it
   // choose" sends nothing — absent means rotation, exactly as before
   // (ticket 153). exactOptionalPropertyTypes: the field is added, never
   // assigned undefined.
   const body: { mode: Mode; shuffle?: boolean; protocol?: string } =
    shuffle ? { mode, shuffle: true } : { mode };
   const checked = optionList.querySelector<HTMLInputElement>('input[name="protocol-pick"]:checked');
   const protocolId = checked?.value ?? '';
   if (protocolId !== '') body.protocol = protocolId;
   const res = await deps.api<SessionResponse>('/api/session', body);
   deps.session.setSessionId(res.sessionId);
   deps.session.setSessionProtocol(res.protocol ?? null);
   // A fresh sitting starts with no machine phase meta (ticket 159, slice 3).
   deps.session.setPhaseMeta(null);
   deps.session.setQuotedFragment(res.quotedFragment ?? null);
   deps.session.setSnippetRef(res.snippetRef ?? null);
   deps.session.setLineageQuestion(res.snippetQuestion ?? null);
   deps.session.setLineageContext(res.context ?? null);
   deps.session.setOpenerSource(res.source ?? null);
   // The clock counts down from the declared minutes; the deadline is set
   // once, here, so re-rendering the exchange screen does not reset it.
   deps.session.setSessionDeadline(Date.now() + mode.minutes * 60_000);
   // Pulse prompt present (ticket 105): hold the question, show pulse first
   if (res.pulsePrompt) {
    deps.session.setPulsePrompt(res.pulsePrompt);
    deps.session.setPendingQuestion(res.question);
    deps.session.setQuestion(null);
   } else {
    deps.session.setPulsePrompt(null);
    deps.session.setPendingQuestion(null);
    deps.session.setQuestion(res.question);
   }
   wait.done();
   deps.renderExchange();
  } catch (e) {
   wait.failed(e);
   submit.disabled = false;
   shuffleLink.disabled = false;
  }
 }

 // The Randomizer, as a sentence rather than a button row (the document rule
 // in docs/interface-references.md): the control is the two words that name
 // what happens, sitting at the point of attention just under "begin".
 const shuffleRow = deps.el('div', { class: 'mode-aside' });
 const shuffleLink = deps.el('button', { class: 'nav-link' }, 'shuffle a deck');
 shuffleRow.append(document.createTextNode('or '), shuffleLink, document.createTextNode('.'));

 submit.addEventListener('click', () => void begin(false));
 shuffleLink.addEventListener('click', () => void begin(true));

 topicInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit.click();
 });

 // Stop all jobs: the quiet switch for the background clerk — no new docket
 // run, no drain chain, no import re-trigger until resume or a restart. It
 // sits beside fresh start because fresh start refuses while a run is in
 // flight; stopping first is how you quiet the server to get one.
 const jobsRow = deps.el('div', { class: 'mode-aside stop-jobs-row' });
 const stopLink = deps.el('button', { class: 'nav-link' }, 'stop all jobs');
 jobsRow.append(stopLink);
 stopLink.addEventListener('click', () => {
  void (async () => {
   stopLink.disabled = true;
   try {
    const res = await deps.api<{ ok: boolean; inFlight: boolean }>('/api/jobs/stop', {});
    jobsRow.replaceChildren(
     deps.el(
      'span',
      { class: 'fresh-start-note' },
      res.inFlight
       ? 'jobs stopped — the run in flight finishes, then nothing new starts. '
       : 'jobs stopped — nothing new starts. ',
     ),
    );
    const resumeLink = deps.el('button', { class: 'nav-link' }, 'resume jobs');
    resumeLink.addEventListener('click', () => {
     void (async () => {
      resumeLink.disabled = true;
      try {
       await deps.api('/api/jobs/resume', {});
       stopLink.disabled = false;
       jobsRow.replaceChildren(stopLink);
      } catch (err) {
       resumeLink.disabled = false;
       deps.showError(err instanceof Error ? err.message : String(err));
      }
     })();
    });
    jobsRow.append(resumeLink);
   } catch (err) {
    stopLink.disabled = false;
    deps.showError(err instanceof Error ? err.message : String(err));
   }
  })();
 });

 // Fresh start: the whole personal archive moves aside, nothing deleted.
 // Host-only — the server refuses non-loopback callers — and armed only by
 // typing the phrase, so a stray tap can never move a vault. In the
 // document rule's idiom the control is the words that name what happens,
 // sitting quietly at the bottom of the screen.
 const freshRow = deps.el('div', { class: 'mode-aside fresh-start-row' });
 const freshLink = deps.el('button', { class: 'nav-link' }, 'start fresh…');
 freshRow.append(freshLink);
 freshLink.addEventListener('click', () => {
  freshRow.innerHTML = '';
  const note = deps.el(
   'div',
   { class: 'fresh-start-note' },
   'Moves the vault and every personal record into archives/ — nothing is deleted, instruments stay. The server exits; you start it again for a fresh vault.',
  );
  const phrase = deps.el('input', {
   class: 'topic-input',
   type: 'text',
   placeholder: 'type "fresh start" to confirm',
  });
  const go = deps.el('button', { class: 'nav-link' }, 'archive & start fresh');
  const cancelLink = deps.el('button', { class: 'nav-link' }, 'cancel');
  const slot = deps.el('div', { class: 'error-slot' });
  cancelLink.addEventListener('click', () => renderMode(deps, showSetupHint));
  go.addEventListener('click', () => {
   void (async () => {
    go.disabled = true;
    slot.textContent = '';
    try {
     const res = await deps.api<{ ok: boolean; archiveDir: string; moved: string[] }>(
      '/api/fresh-start',
      { confirm: phrase.value.trim() },
     );
     deps.clear();
     const done = deps.el('div', { class: 'screen active mode-form' });
     done.append(
      deps.el('h2', { class: 'home-heading' }, 'fresh start'),
      deps.el(
       'div',
       { class: 'fresh-start-note' },
       `${res.moved.length} records archived to ${res.archiveDir}. ` +
        'The server has exited — start it again, reload this page, and set a new password.',
      ),
     );
     deps.main.append(done);
    } catch (err) {
     go.disabled = false;
     slot.textContent = err instanceof Error ? err.message : String(err);
    }
   })();
  });
  freshRow.append(note, phrase, go, cancelLink, slot);
 });

 div.append(beginHeading, minutesRow, energyRow, targetRow, topicInput, navRow, submit, shuffleRow, errorSlot, jobsRow, freshRow);

 // One-time ask on vaults set up before the profile existed: the wiki
 // writes about the person, and given a name it stops calling them "the
 // user". Skippable; skip is remembered in this browser.
 if (localStorage.getItem('profile-asked') === null) {
  void (async () => {
   try {
    const existing = await deps.api<{ name?: string; pronouns?: string }>('/api/profile', undefined, { method: 'GET' });
    if (existing.name || existing.pronouns) return;
    const box = deps.el('div', { class: 'mode-row', style: 'flex-direction: column; align-items: stretch; gap: 0.4rem; margin-top: 1rem' });
    const ask = deps.el('p', { style: 'color: var(--dim); font-size: 0.9rem; margin: 0' }, 'what should the wiki call you?');
    const nameInput = deps.el('input', { class: 'topic-input', type: 'text', placeholder: 'your name' });
    const pronounsInput = deps.el('input', { class: 'topic-input', type: 'text', placeholder: 'your pronouns (e.g. they/them)' });
    const row = deps.el('div', { style: 'display: flex; gap: 0.5rem' });
    const save = deps.el('button', { class: 'submit-btn' }, 'save');
    const skip = deps.el('button', { class: 'nav-link' }, 'skip');
    save.addEventListener('click', async () => {
     try {
      await deps.api('/api/profile', { name: nameInput.value.trim(), pronouns: pronounsInput.value.trim() });
      localStorage.setItem('profile-asked', 'yes');
      box.remove();
     } catch { /* leave the box; the next click retries */ }
    });
    skip.addEventListener('click', () => {
     localStorage.setItem('profile-asked', 'yes');
     box.remove();
    });
    row.append(save, skip);
    box.append(ask, nameInput, pronounsInput, row);
    div.append(box);
   } catch { /* not signed in yet, or no server — never block the home screen */ }
  })();
 }
 deps.main.append(div);
}
