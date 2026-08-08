/**
 * The harvest screen: a finished sitting's cut proposals, decided by hand
 * — approve, trim, discard, restate — and saved to the sitting's harvest
 * route. The draft map is this surface's promise that leaving costs
 * nothing (the queue grammar): decisions stay in hand per session for this
 * page load, and a "finish later" re-open renders exactly what was left.
 *
 * Injection, not import: `el`, `api`, `beginWait`, `renderDone` and the
 * session-state handles are module-private in main.ts (the import-review
 * pattern). The seam is one object literal at the call site; the pure
 * helpers (lineageBlock, validTrim, pasteTracker) and the shared wire
 * types are the allowed imports. `document` rides the seam because the
 * progress line is found by query — the one DOM read this surface makes.
 */

import type { CaptureChannel, CutProposal, HarvestDecision } from '../src/types.ts';
import { lineageBlock } from './lineage.js';
import { pasteTracker } from './paste-tracker.js';
import { validTrim as validTrimRule } from './trim-validity.js';
import type { WebDepsWithWait } from './deps.js';

/** `POST /api/session/:id/harvest` — the buds the done screen shows. */
interface HarvestResponse {
 buds: unknown[];
}

export interface HarvestDeps extends WebDepsWithWait {
 renderShell: () => void;
 clear: () => void;
 setScreen: (screen: string) => void;
 sessionId: () => string | null;
 proposals: () => CutProposal[];
 decisions: () => HarvestDecision[];
 setDecisions: (decisions: HarvestDecision[]) => void;
 setPendingBuds: (buds: unknown[]) => void;
 renderDone: () => void;
 document: Document;
}

/**
 * The queue grammar promises leaving costs nothing: this map is that
 * promise, per session, for this page load.
 */
const harvestDrafts = new Map<string, HarvestDecision[]>();

export function renderHarvest(deps: HarvestDeps) {
 deps.clear();
 deps.setScreen('harvest');
 deps.renderShell();
 deps.setDecisions(harvestDrafts.get(deps.sessionId()!) ?? []);

 const div = deps.el('div', { class: 'screen active' });

 const empty = deps.proposals().length === 0;

 const heading = deps.el(
  'div',
  { class: empty ? 'question-block empty-msg' : 'question-block' },
  empty
   ? 'nothing from this sitting stood on its own \u2014 that happens'
   : 'review what you said',
 );
 div.append(heading);

 const list = deps.el('div', { class: 'harvest-list' });
 div.append(list);

 const errorSlot = deps.el('div', { class: 'error-slot' });
 div.append(errorSlot);

 if (empty) {
  const closeBtn = deps.el(
   'button',
   { class: 'submit-btn', style: 'margin-top: 1.5rem' },
   'close',
  );
  closeBtn.addEventListener('click', () => deps.navTo('mode'));
  div.append(closeBtn);
 } else {
  const progress = deps.el('p', { class: 'harvest-progress' }, `${deps.decisions().length} of ${deps.proposals().length} decided`);

  // Bulk preselection, never a commit: one verb lands on every proposal
  // still waiting; proposals already decided keep their decision, and each
  // card can still be changed before `save decisions`. The re-render is the
  // whole mechanism \u2014 every card seeds its visual from state.decisions.
  const bulkRow = deps.el('div', { class: 'harvest-decide-all' });
  const bulkApprove = deps.el('button', { class: 'nav-link' }, 'select all \u2014 approve');
  const bulkDiscard = deps.el('button', { class: 'nav-link' }, 'select all \u2014 discard');
  bulkRow.append(bulkApprove, bulkDiscard);
  const decideRest = (action: 'approve' | 'discard') => {
   const decided = new Set(deps.decisions().map((d) => d.proposal));
   for (let i = 0; i < deps.proposals().length; i++) {
    if (!decided.has(i)) deps.decisions().push({ proposal: i, action });
   }
   harvestDrafts.set(deps.sessionId()!, deps.decisions());
   renderHarvest(deps);
  };
  bulkApprove.addEventListener('click', () => decideRest('approve'));
  bulkDiscard.addEventListener('click', () => decideRest('discard'));

  const submitRow = deps.el('div', { style: 'margin-top: 1.5rem' });
  const submitBtn = deps.el('button', { class: 'submit-btn' }, 'save decisions');
  submitRow.append(submitBtn);
  // The queue grammar lets a sitting rest: decisions stay in hand, and the
  // review list is where the person left it.
  const backRow = deps.el('div', { class: 'waiting-nav' });
  const finishLater = deps.el('button', { class: 'nav-link' }, '\u2190 finish later');
  finishLater.addEventListener('click', () => {
   harvestDrafts.set(deps.sessionId()!, deps.decisions());
   deps.navTo('reviews');
  });
  backRow.append(finishLater);
  div.append(bulkRow, progress, submitRow, backRow);

  submitBtn.addEventListener('click', async () => {
   if (deps.decisions().length < deps.proposals().length) {
    errorSlot.innerHTML = '';
    errorSlot.append(
     deps.el('p', { class: 'error-msg' }, 'decide on each proposal first'),
    );
    return;
   }
   submitBtn.disabled = true;
   errorSlot.innerHTML = '';
   const wait = deps.beginWait(errorSlot, 'writing them down…');
   try {
    const result = await deps.api<HarvestResponse>(
     `/api/session/${deps.sessionId()}/harvest`,
     { decisions: deps.decisions() },
    );
    deps.setPendingBuds(result.buds as unknown[]);
    wait.done();
    harvestDrafts.delete(deps.sessionId()!);
    deps.renderDone();
   } catch (e) {
    wait.failed(e);
    submitBtn.disabled = false;
   }
  });
 }

 deps.main.append(div);

 for (let i = 0; i < deps.proposals().length; i++) {
  renderProposal(deps, i, list);
 }
}

function renderProposal(deps: HarvestDeps, idx: number, container: HTMLElement) {
 const p = deps.proposals()[idx]!;

 const block = deps.el('div', { class: 'proposal-block' });

 // Show the eliciting question and context window, dimmed — lineage, not corpus
 const prov = lineageBlock(deps.el, p.question, p.context);
 if (prov) block.append(prov);

 const textWrapper = deps.el('div', { class: 'proposal-text' });
 textWrapper.textContent = p.text;

 const reading = deps.el('span', { class: 'proposal-reading' });
 reading.innerHTML = `<strong>${p.facet}</strong> &middot; ${p.stance}<br>${p.reading}`;
 textWrapper.append(reading);

 const actions = deps.el('div', { class: 'proposal-actions' });

 const approveBtn = deps.el('button', { class: 'proposal-action' }, 'approve');
 const trimBtn = deps.el('button', { class: 'proposal-action' }, 'trim');
 const discardBtn = deps.el(
  'button',
  { class: 'proposal-action discard' },
  'discard',
 );
 const restateBtn = deps.el('button', { class: 'proposal-action' }, 'restate');

 actions.append(approveBtn, trimBtn, discardBtn, restateBtn);

 let editorActive = false;
 let editorEl: HTMLTextAreaElement | null = null;
 let constraintEl: HTMLParagraphElement | null = null;
 let confirmEl: HTMLButtonElement | null = null;

 function clearEditor() {
  if (editorEl) {
   editorEl.remove();
   editorEl = null;
  }
  if (constraintEl) {
   constraintEl.remove();
   constraintEl = null;
  }
  if (confirmEl) {
   confirmEl.remove();
   confirmEl = null;
  }
  editorActive = false;
 }

 function applyDecisionVisual(action: HarvestDecision['action']) {
  const all = [approveBtn, trimBtn, discardBtn, restateBtn];
  for (const b of all) b.style.opacity = '0.4';
  const active =
   action === 'approve'
    ? approveBtn
    : action === 'trim'
     ? trimBtn
     : action === 'discard'
      ? discardBtn
      : restateBtn;
  active.style.opacity = '1';
  active.style.fontWeight = '500';
 }

 function setDecision(action: HarvestDecision['action'], text?: string, channel?: CaptureChannel) {
  deps.setDecisions(deps.decisions().filter((d) => d.proposal !== idx));
  const d: HarvestDecision = { proposal: idx, action };
  if (text !== undefined) d.text = text;
  if (channel !== undefined) d.channel = channel;
  deps.decisions().push(d);
  // The draft map holds the same decisions, so a "finish later" and a
  // re-open of the same sitting agree on what was already decided.
  harvestDrafts.set(deps.sessionId()!, deps.decisions());
  const progress = deps.document.querySelector('.harvest-progress');
  if (progress) progress.textContent = `${deps.decisions().length} of ${deps.proposals().length} decided`;
  applyDecisionVisual(action);
 }

 approveBtn.addEventListener('click', () => {
  clearEditor();
  setDecision('approve');
 });

 trimBtn.addEventListener('click', () => {
  if (editorActive) {
   clearEditor();
   const has = deps.decisions().some((d) => d.proposal === idx);
   if (!has) resetButtons();
   return;
  }
  clearEditor();
  editorActive = true;
  editorEl = deps.el('textarea', { class: 'trim-editor' }, p.text) as HTMLTextAreaElement;
  constraintEl = deps.el(
   'p',
   { class: 'trim-constraint' },
   'a trim keeps one continuous span of your words \u2014 cut, don\'t rewrite',
  );
  confirmEl = deps.el(
   'button',
   { class: 'proposal-action', style: 'margin-top: 0.3rem' },
   'confirm trim',
  );
  block.append(editorEl, constraintEl, confirmEl);
  editorEl.focus();
  editorEl.style.height = 'auto';
  editorEl.style.height = editorEl.scrollHeight + 'px';
  const validTrim = (): boolean => validTrimRule(p.text, editorEl!.value);
  editorEl.addEventListener('input', () => {
   editorEl!.style.height = 'auto';
   editorEl!.style.height = editorEl!.scrollHeight + 'px';
   const ok = validTrim();
   confirmEl!.disabled = !ok;
   editorEl!.classList.toggle('invalid', !ok);
  });
  confirmEl.addEventListener('click', () => {
   const v = editorEl!.value;
   // The live check disables confirm on invalid text; the guard refuses
   // to commit, never overwriting the person's edit.
   if (!validTrim()) return;
   setDecision('trim', v);
   clearEditor();
  });
 });

 discardBtn.addEventListener('click', () => {
  clearEditor();
  setDecision('discard');
 });

 restateBtn.addEventListener('click', () => {
  if (editorActive) {
   clearEditor();
   const has = deps.decisions().some((d) => d.proposal === idx);
   if (!has) resetButtons();
   return;
  }
  clearEditor();
  editorActive = true;
  editorEl = deps.el('textarea', {
   class: 'restate-editor',
   placeholder: 'say it in your own words\u2026',
  }) as HTMLTextAreaElement;
  const editorTracker = pasteTracker(editorEl);
  confirmEl = deps.el(
   'button',
   { class: 'confirm-restate' },
   'confirm',
  );
  block.append(editorEl, confirmEl);
  editorEl.focus();
  confirmEl.addEventListener('click', () => {
   const v = editorEl!.value.trim();
   if (!v) return;
   setDecision('restate', v, editorTracker.isPasted(v) ? 'pasted' : 'typed');
   clearEditor();
  });
 });

 function resetButtons() {
  for (const b of [approveBtn, trimBtn, discardBtn, restateBtn]) {
   b.style.opacity = '';
   b.style.fontWeight = '';
  }
 }

 block.append(textWrapper, actions);
 container.append(block);
 // A drafted decision (a "finish later" re-open) renders exactly like a
 // clicked one: the same visual path, taken when the block is built.
 const seeded = deps.decisions().find((d) => d.proposal === idx); if (seeded) applyDecisionVisual(seeded.action);
}
