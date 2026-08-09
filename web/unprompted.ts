/**
 * The unprompted entry screen: a blank page, no question — moved whole from
 * main.ts (wave C); every rendered string, class, DOM structure and e2e
 * selector is byte-identical. The last screen that wires dictation itself:
 * it receives the wiring bound to main.ts's shared dictationDeps through
 * the seam, exactly as the exchange does.
 *
 * Injection, not import (the seam, web/deps.ts): el, api, navTo, the wait
 * verbs, the shell verbs and the sitting-state setters all arrive via
 * initUnprompted at boot — the territory pattern. renderUnprompted is bare,
 * exactly as the router calls it; a forgotten init is loud.
 */
import type { CutProposal, HarvestDecision } from '../src/types.ts';
import type { EndResponse, WebDepsCore, WebDepsWithWait } from './deps.js';
import type { DictationOpts } from './dictation.js';
import { pasteTracker } from './paste-tracker.js';

/** The unprompted screen's deps, injected once at boot (web/deps.ts). */
export interface UnpromptedDeps {
 surface: HTMLElement;
 el: WebDepsCore['el'];
 api: WebDepsCore['api'];
 navTo: (screen: string) => void;
 beginWait: WebDepsWithWait['beginWait'];
 clear: () => void;
 setScreen: (screen: string) => void;
 renderShell: () => void;
 setSessionId: (id: string | null) => void;
 setQuestion: (question: string | null) => void;
 setProposals: (proposals: CutProposal[]) => void;
 setDecisions: (decisions: HarvestDecision[]) => void;
 setPendingReviewSession: (sessionId: string | null) => void;
 turnHadSpeech: () => boolean;
 setTurnHadSpeech: (spoken: boolean) => void;
 /** The dictation wiring bound to the shared dictationDeps — kept here, as
 *  it was in main.ts: this screen wires dictation itself. */
 wireDictation: (opts: DictationOpts) => void;
}

let unpromptedDeps: UnpromptedDeps | null = null;

/** Wire the unprompted screen's deps once at boot. */
export function initUnprompted(deps: UnpromptedDeps): void {
 unpromptedDeps = deps;
}

function wired(): UnpromptedDeps {
 const deps = unpromptedDeps;
 if (deps === null) {
  throw new Error('unprompted not initialized — call initUnprompted before renderUnprompted');
 }
 return deps;
}

/* ── Unprompted entry: a blank page, no question ── */

export function renderUnprompted() {
 const deps = wired();
 deps.clear();
 deps.setScreen('unprompted');
 deps.renderShell();
 deps.setSessionId(null);
 deps.setQuestion(null);
 deps.setProposals([]);
 deps.setDecisions([]);

 const div = deps.el('div', { class: 'screen active' });

 const backRow = deps.el('div', { class: 'blank-page-nav' });
 const backBtn = deps.el('button', { class: 'nav-link' }, '← back');
 backBtn.addEventListener('click', () => deps.navTo('mode'));
 backRow.append(backBtn);

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

 doneBtn.addEventListener('click', async () => {
  const text = page.value.trim();
  if (!text) return;
  const pasted = pageTracker.isPasted(text);
  pageTracker.reset();
  doneBtn.disabled = true;
  page.disabled = true;
  errorSlot.innerHTML = '';
  const wait = deps.beginWait(errorSlot, 'reading what you wrote…');
  try {
   const res = await deps.api<EndResponse>(
    '/api/unprompted',
    { text, channel: pasted ? 'pasted' : deps.turnHadSpeech() ? 'spoken' : 'typed' },
   );
   deps.setSessionId(res.sessionId);
   deps.setPendingReviewSession(res.sessionId);
   wait.done();
   deps.setTurnHadSpeech(false);
   deps.navTo('reviews');
  } catch (e) {
   wait.failed(e);
   doneBtn.disabled = false;
   page.disabled = false;
  }
 });

 div.append(backRow, page, pageControls, errorSlot);
 deps.surface.append(div);

 deps.wireDictation({
  textarea: page,
  micBtn,
  micStatus,
  errorSlot,
  onSpeech: () => { deps.setTurnHadSpeech(true); },
 });

 requestAnimationFrame(() => {
  page.focus();
  grow();
 });
}
