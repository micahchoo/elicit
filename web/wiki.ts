/**
 * The wiki: your words, organized (the contextualizer, §11).
 *
 * A page of your passages in your ink, grouped into neighborhoods, each
 * with a context line in agent ink. Three rules govern everything below
 * and each one is load-bearing:
 *
 * 1. **The claim apparatus never reaches the DOM.** Status words, ranges,
 *    cites and the six margin verbs receded with the claim essay (ruling
 *    2026-08-08, §11). The passages view carries the person's own words,
 *    the agent's context lines in the marginalia register, and the
 *    contextualizer's three verbs in correcting mode.
 * 2. **The context line is agent ink, marginalia-class, never quotable.**
 *    It describes the utterance and its circumstances (when it was said,
 *    what question drew it, what stood before it, what it echoes) — never
 *    a trait sentence about the person. When the context job has not run,
 *    the mechanical facts render as the fallback line instead.
 * 3. **The lens + freshness survive unchanged** (wave 5, §11): new
 *    passages, new context lines and new exhibits are full ink; everything
 *    else recedes. The whole essay is one word away.
 *
 * Injection, not import: `el`, `api`, `beginWait` and the rest are
 * module-private in main.ts (the import-review pattern). The read-watch and
 * correcting-mode machinery is module state with a module-scoped lifetime —
 * main.ts's clear() calls releaseWiki(document) so a navigation never leaves
 * an observer or a key handler listening on a detached page.
 */

import type { Contradiction } from '../src/wiki/contract.ts';
import type { WikiPassage } from '../src/wiki/page.ts';
import type { AnnotationRecord } from '../src/clerk/annotation-store.js';
import type { Snippet } from '../src/types.ts';
import { relativeTime } from '../src/log/format.js';
import { backlogSentence, panelLine, renderPanelLine } from './panel-line.js';
import { renderTerritory } from './territory.js';
import type { TerritoryResponse } from '../src/territory.js';
import { lineageBlock } from './lineage.js';
import { readableDate } from './dates.js';
import { passageSinceChanged, exhibitSinceChanged, freshnessSentence } from './lens.js';
import type { Freshness } from './lens.js';
import type { SweepBacklogResponse, WebDepsShell } from './deps.js';

/**
 * The /api/snippets wire view: a Snippet that may carry a resolved-referent
 * annotation (ticket 074) — agent prose riding beside, never inside, the
 * person's words. The shared Snippet type stays annotation-free.
 */
type WikiSnippet = Snippet & { annotation?: AnnotationRecord };

/**
 * `GET /api/wiki` — already shaped for reading (src/wiki/page.ts).
 * Neighborhoods arrive with names and passages in reading order, context
 * lines arrive as agent ink, and `lintedAt: null` means the Clerk has not
 * read the wiki yet, which is a different thing from having read it and
 * found nothing.
 */
interface WikiNeighborhood {
 name: string;
 passages: WikiPassage[];
}

interface WikiResponse {
 neighborhoods: WikiNeighborhood[];
 contradictions: Contradiction[];
 lintedAt: string | null;
 all: boolean;
 /** The person's read-through and the sittings behind it (wave 5). */
 freshness: Freshness;
}

export interface WikiDeps extends WebDepsShell {
 /** The view height the dwell rule measures against (half the view). */
 window: Window;
}

/** The lens state (all=1): navigation resets it; the foot word flips it. */
let all = false;
/** The since-you-last-read lens (wave 5): on by default; the foot word shows the whole essay. */
let lensOn = true;
/** The last painted payload — the foot word re-paints from it, never refetches. */
let lastPaint: {
 page: HTMLElement;
 sidebar: HTMLElement;
 wiki: WikiResponse;
 snippets: WikiSnippet[];
 backlog: SweepBacklogResponse | null;
} | null = null;

const WIKI_OPENING =
 'Your words, kept — each with the moment it was said beside it. ' +
 'The dimmed lines are what the agent notices about a passage; the words ' +
 'under them are yours.';

const WIKI_EMPTY =
 'There is nothing on this page yet. It appears when a sitting has ' +
 'kept some of your words.';

/* ── The read-log (Q-21, §11) ──
 *
 * DECISION: a read is recorded on DWELL, not on scroll-into-view and not on a
 * focus interaction.
 *
 * The read-log is what the since-lens recedes against: a passage read after
 * your last visit is full ink on the next one. So a read recorded that the
 * person did not perform makes real words count as seen — over-recording is
 * not the conservative direction, it is the destructive one. Scroll-into-view
 * over-records by construction: a flick past a section logs every passage in
 * it.
 *
 * Focus under-records to nothing. This surface has no verbs at rest, so
 * nothing on it can take focus; a focus rule would ship an instrument that
 * never fires.
 *
 * Dwell is the measurement that matches the event. The passage must hold
 * half the reader's view, without interruption, for long enough to have been
 * read, in a tab that is actually on screen. A fast scroll records nothing;
 * sitting with a passage records once. Once per passage per page load.
 */
const READ_DWELL_MS = 2500;
/** Passages already logged this page load. Reset by a full reload, not by navigation. */
const readsRecorded = new Set<string>();

let readWatcher: IntersectionObserver | null = null;
let readTimers: Map<Element, ReturnType<typeof setTimeout>> | null = null;
let readVisibilityHandler: (() => void) | null = null;

/**
 * Release the page-level machinery the wiki leaves behind — the read-watch
 * observer and the correcting-mode key handler. main.ts's clear() calls
 * this on every navigation (the module state is module-scoped, so only the
 * document listeners need the real document to detach from).
 */
export function releaseWiki(document: Document): void {
 releaseReadWatch(document);
 releaseCorrectingMode(document);
}

function releaseReadWatch(document: Document) {
 readWatcher?.disconnect();
 readWatcher = null;
 if (readTimers) {
  for (const t of readTimers.values()) clearTimeout(t);
  readTimers = null;
 }
 if (readVisibilityHandler) {
  document.removeEventListener('visibilitychange', readVisibilityHandler);
  readVisibilityHandler = null;
 }
}

function recordRead(deps: WikiDeps, id: string) {
 if (readsRecorded.has(id)) return;
 readsRecorded.add(id);
 // Fire and forget. This is a record of a reading, never an edit, and a
 // failed record must not put anything on a page the person is reading.
 deps.api(`/api/wiki/passage/${encodeURIComponent(id)}/read`, { surface: 'wiki' })
  .catch((e: unknown) => { console.error(e); });
}

/** Watch every `[data-passage]` under `root` and log a read after the dwell. */
function watchReads(deps: WikiDeps, root: HTMLElement) {
 releaseReadWatch(deps.document);
 // Receded blocks (wave 5) skip the read-watch deliberately: they were not
 // the person's reading, and recording a read for them would discount the
 // words they carry. Excluding them from the selector means the observer
 // never starts a dwell timer on one.
 const blocks = root.querySelectorAll<HTMLElement>('[data-passage]:not(.receded)');
 if (blocks.length === 0) return;
 if (typeof IntersectionObserver === 'undefined') return;

 const timers = new Map<Element, ReturnType<typeof setTimeout>>();
 readTimers = timers;

 function cancel(target: Element) {
  const t = timers.get(target);
  if (t !== undefined) {
   clearTimeout(t);
   timers.delete(target);
  }
 }

 const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
   const target = entry.target as HTMLElement;
   const id = target.dataset.passage;
   if (!id) continue;

   // Half the block, or half the view for a block taller than the view —
   // a long passage must not become unreadable-by-definition.
   const viewHeight = entry.rootBounds?.height ?? deps.window.innerHeight;
   const held =
    entry.isIntersecting &&
    (entry.intersectionRatio >= 0.5 ||
     entry.intersectionRect.height >= viewHeight * 0.5);

   if (!held || deps.document.hidden) {
    cancel(target);
    continue;
   }
   if (timers.has(target)) continue;
   timers.set(target, setTimeout(() => {
    timers.delete(target);
    observer.unobserve(target);
    recordRead(deps, id);
   }, READ_DWELL_MS));
  }
 }, { threshold: [0, 0.5, 1] });

 for (const block of blocks) observer.observe(block);
 readWatcher = observer;

 // A passage left on screen behind another window was not read. The observer
 // sees no intersection change when the tab hides, so the tab has to say so.
 readVisibilityHandler = () => {
  if (!deps.document.hidden) return;
  for (const target of [...timers.keys()]) cancel(target);
 };
 deps.document.addEventListener('visibilitychange', readVisibilityHandler);
}

/* ── Correcting mode (the verb-grammar rule) ──
 *
 * The wiki's dominant verb is reading, so the page at rest carries nothing
 * but prose and two quiet controls. Correcting enters as an explicit mode
 * shift: one passage focused, the page dimmed around it, the contextualizer's
 * three margin words inside it. Clicking the focused passage again, clicking
 * another passage, or pressing Escape leaves the mode — chrome arrives on
 * entry and leaves on exit, never interleaved at rest.
 */
let correctingPage: HTMLElement | null = null;
let correctingBlock: HTMLElement | null = null;
let correctingKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function releaseCorrectingMode(document: Document): void {
 closeEditor();
 if (correctingPage) correctingPage.classList.remove('correcting');
 if (correctingBlock) correctingBlock.classList.remove('focused');
 correctingPage = null;
 correctingBlock = null;
 if (correctingKeyHandler) {
  document.removeEventListener('keydown', correctingKeyHandler);
  correctingKeyHandler = null;
 }
}

/** The open editor's elements, or null. One per page; releaseCorrectingMode closes it. */
let editorEls: HTMLElement[] | null = null;

function closeEditor(): void {
 if (!editorEls) return;
 for (const el of editorEls) el.remove();
 editorEls = null;
}

function focusPassage(deps: WikiDeps, page: HTMLElement, block: HTMLElement, p: WikiPassage): void {
 releaseCorrectingMode(deps.document);
 correctingPage = page;
 correctingBlock = block;
 page.classList.add('correcting');
 block.classList.add('focused');

 // A released mode leaves its chrome dimmed behind; a fresh focus starts
 // clean.
 block.querySelector('.claim-verbs')?.remove();
 const verbs = deps.el('div', { class: 'claim-verbs' });
 // The verbs' own clicks must not toggle the mode off through the block
 // handler, so the row swallows them.
 verbs.addEventListener('click', (e) => e.stopPropagation());

 // The contextualizer's three verbs (§11): fix the context line's facts,
 // unlink an echo that is not one, make this a direction. The first two
 // only exist when there is a line (or an echo) to act on — the mechanical
 // fallback line has no facts to fix and no echoes to unlink.
 if (p.context !== undefined) {
  const fix = deps.el('button', { class: 'nav-link' }, 'fix the context line');
  fix.addEventListener('click', () => openContextEditor(deps, block, verbs, p));
  verbs.append(fix);

  if (p.context.echoes.length > 0) {
   const unlink = deps.el('button', { class: 'nav-link' }, 'unlink an echo');
   unlink.addEventListener('click', () => openEchoPicker(deps, block, verbs, p));
   verbs.append(unlink);
  }
 }

 const direction = deps.el('button', { class: 'nav-link' }, 'make this a direction');
 direction.addEventListener('click', () => {
  deps.api(`/api/wiki/passage/${encodeURIComponent(p.id)}/direction`)
   .then(() => {
    verbs.replaceWith(marginNote(deps, 'a direction waits in your words'));
   })
   .catch((e: unknown) => console.error(e));
 });
 verbs.append(direction);

 block.append(verbs);

 if (!correctingKeyHandler) {
  correctingKeyHandler = (e) => {
   if (e.key === 'Escape') releaseCorrectingMode(deps.document);
  };
  deps.document.addEventListener('keydown', correctingKeyHandler);
 }
}

/**
 * The fix-context verb's editor: the context line in a diff-grammar input —
 * the constraint visible, commit and cancel explicit, blur inert — the same
 * shape as the claim editor it replaces. The verbs row leaves while the
 * editor is open and returns on cancel, never interleaved at rest.
 */
function openContextEditor(deps: WikiDeps, block: HTMLElement, verbs: HTMLElement, p: WikiPassage): void {
 const line = p.context;
 if (line === undefined) return;
 verbs.remove();
 const editor = deps.el('textarea', { class: 'claim-edit-editor' }, line.text) as HTMLTextAreaElement;
 const constraint = deps.el('p', { class: 'claim-edit-constraint' },
  'the line keeps its echoes \u2014 only the facts change, and the words become yours');
 const commit = deps.el('button', { class: 'nav-link' }, 'commit');
 const cancel = deps.el('button', { class: 'nav-link' }, 'cancel');
 const actions = deps.el('div', { class: 'claim-edit-actions' });
 actions.append(commit, cancel);
 block.append(editor, constraint, actions);
 editorEls = [editor, constraint, actions];
 for (const el of [editor, constraint, actions]) {
  el.addEventListener('click', (e) => e.stopPropagation());
 }
 editor.focus();

 const valid = (): boolean => editor.value.trim() !== '';
 editor.addEventListener('input', () => {
  const ok = valid();
  commit.disabled = !ok;
  editor.classList.toggle('invalid', !ok);
 });

 commit.addEventListener('click', () => {
  if (!valid()) return;
  deps.api(`/api/wiki/passage/${encodeURIComponent(p.id)}/context-fix`, { text: editor.value })
   .then(() => {
    closeEditor();
    const slot = block.querySelector<HTMLElement>('.context-line');
    if (slot) slot.textContent = editor.value.trim();
    block.append(marginNote(deps, 'your correction stands \u2014 the line is yours now'));
   })
   .catch((e: unknown) => console.error(e));
 });

 cancel.addEventListener('click', () => {
  closeEditor();
  block.append(verbs);
 });
}

/**
 * The unlink-echo verb's picker: one button per echo under the context
 * line, the verbs row leaving while it is open. An echo's own words label
 * its button. Clicking one detaches that echo; the line's text stays.
 */
function openEchoPicker(deps: WikiDeps, block: HTMLElement, verbs: HTMLElement, p: WikiPassage): void {
 const line = p.context;
 if (line === undefined) return;
 verbs.remove();
 const picker = deps.el('div', { class: 'claim-edit-actions claim-unlink-picker' });
 const cancel = deps.el('button', { class: 'nav-link' }, 'cancel');
 for (const echo of line.echoes) {
  const el = block.querySelector<HTMLElement>(`.context-echo[data-echo="${CSS.escape(echo)}"]`);
  const label = el
   ? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
   : 'an echo that is no longer on this page';
  const b = deps.el('button', { class: 'nav-link' }, label.length > 0 ? label : 'unlink this echo');
  b.title = 'unlink this echo';
  b.addEventListener('click', () => {
   deps.api(`/api/wiki/passage/${encodeURIComponent(p.id)}/unlink-echo`, { echo })
    .then(() => {
     closeEditor();
     el?.remove();
     block.append(marginNote(deps, 'that echo no longer stands under this line'));
    })
    .catch((e: unknown) => console.error(e));
  });
  picker.append(b);
 }
 cancel.addEventListener('click', () => {
  closeEditor();
  block.append(verbs);
 });
 picker.append(cancel);
 block.append(picker);
 editorEls = [picker];
 picker.addEventListener('click', (e) => e.stopPropagation());
}

/* ── Typesetting helpers ── */

/** A quotation in the person's own ink, dated. The words ARE the passage (Q-27). */
function quoteBlock(
 deps: WikiDeps,
 prose: string,
 iso?: string,
 prov?: { question?: string; context?: string },
 ann?: { expression: string; referent: string },
): HTMLElement {
 const q = deps.el('blockquote', { class: 'claim-quote' }, prose);
 // The lineage that produced these words, dimmed above them — as on the
 // harvest review card. Nothing renders when neither field is present.
 if (prov) {
  const lineage = lineageBlock(deps.el, prov.question, prov.context);
  if (lineage) q.prepend(lineage);
 }
 const when = iso ? readableDate(iso) : '';
 if (when) q.append(deps.el('span', { class: 'claim-quote-date' }, when));
 // The resolved referent (ticket 074): agent prose in the margin, after
 // the date, never inside the person's words. Only the annotation kind
 // renders — silence means the model judged nothing to resolve.
 if (ann) q.append(marginNote(deps, `“${ann.expression}” → ${ann.referent}`));
 return q;
}

/** A dimmed marginal remark. Never carries an id. */
function marginNote(deps: WikiDeps, text: string): HTMLElement {
 return deps.el('p', { class: 'wiki-note' }, text);
}

/**
 * The mechanical fallback context line — the facts the wire carries, in a
 * plain sentence, when the context job has not composed a line yet. Never
 * quotable, same register as the composed line.
 */
function mechanicalLine(p: WikiPassage): string {
 const when = readableDate(p.captured);
 const asked = p.question.trim() !== '';
 if (!when) return asked ? `It answered a question — "${p.question.trim()}".` : 'It was said without a question.';
 if (asked) return `Said ${when}, after a question — "${p.question.trim()}".`;
 return `Said ${when}, without a question.`;
}

/* ── Render ── */

export function renderWiki(deps: WikiDeps): void {
 all = false;
 lensOn = true;
 lastPaint = null;
 void render(deps);
}

function render(deps: WikiDeps): void {
 deps.clear();
 deps.setScreen('about-you');
 deps.renderShell();

 const div = deps.el('div', { class: 'screen active wiki-surface' });

 const shell = deps.el('div', { class: 'wiki-shell' });
 const sidebar = deps.el('nav', { class: 'wiki-sidebar' });
 const page = deps.el('div', { class: 'wiki-page' });
 shell.append(sidebar, page);
 div.append(shell);
 deps.main.append(div);

 (async () => {
  const wait = deps.beginWait(page, 'reading…', 400);
  try {
   const [wiki, snippets, backlog] = await Promise.all([
    deps.api<WikiResponse>(all ? '/api/wiki?all=1' : '/api/wiki'),
    // The quotes. A failure here costs the page its words but not its
    // shape, so it degrades rather than throws.
    deps.api<{ snippets: Snippet[] }>('/api/snippets').catch(() => ({ snippets: [] as Snippet[] })),
    // The backlog (ticket 156): the Clerk-state sentence links to the
    // today surface when readings wait. A failure renders no link — the
    // wiki is read-only and a missing link is not an error state, and there
    // is no backlog panel on this surface to log the panel helper's error
    // contract to, so it degrades silently like /api/snippets.
    deps.api<SweepBacklogResponse>('/api/sweep-backlog').catch(() => null),
   ]);
   wait.done();
   paintWiki(deps, page, sidebar, wiki, snippets.snippets, backlog);
   watchReads(deps, page);
   lastPaint = { page, sidebar, wiki, snippets: snippets.snippets, backlog };
  } catch (e) {
   wait.failed(e, 'the page did not come through — try again');
  }
 })();
}

/**
 * Re-paint the essay from the last payload — the foot word's whole-essay
 * toggle never refetches; the payload already holds everything the lens
 * needs. Correcting mode is released first: the essay view changes under
 * the person, so a focused passage cannot survive it. Falls back to a full
 * render only if nothing was ever painted.
 */
function repaint(deps: WikiDeps): void {
 if (lastPaint === null) {
  void render(deps);
  return;
 }
 releaseCorrectingMode(deps.document);
 const { page, sidebar, wiki, snippets, backlog } = lastPaint;
 paintWiki(deps, page, sidebar, wiki, snippets, backlog);
 watchReads(deps, page);
}

function paintWiki(deps: WikiDeps, page: HTMLElement, sidebar: HTMLElement, wiki: WikiResponse, snippets: WikiSnippet[], backlog: SweepBacklogResponse | null) {
 page.innerHTML = '';

 const byId = new Map<string, WikiSnippet>();
 for (const s of snippets) byId.set(s.id, s);

 const hasPassages = wiki.neighborhoods.some((n) => n.passages.length > 0);

 // The lens (wave 5, §11): lastRead is the page's read-through — the
 // server's freshness block, since the payload no longer carries claim
 // readLogs. Null — nothing ever read — means everything is new: the lens
 // recedes nothing and the whole essay renders at full ink.
 const lastRead = wiki.freshness.readThrough;

 // The headings that render on this page, in page order, for the sidebar.
 const sections: { heading: string; el: HTMLElement }[] = [];

 // The freshness line rides the very top of the essay (canon §5.5): where
 // the person stands with the page, before the page itself.
 const freshness = freshnessSentence(wiki.freshness);
 if (freshness !== null) page.append(deps.el('p', { class: 'wiki-freshness' }, freshness));

 page.append(deps.el('p', { class: 'wiki-opening' }, hasPassages ? WIKI_OPENING : WIKI_EMPTY));

 // Eval finding #8: "has not been read" and "was read, nothing to remark"
 // are different states and must not render alike.
 page.append(deps.el('p', { class: 'wiki-state' }, clerkStateSentence(wiki)));

 // The Clerk-state sentence's door back to the today surface (ticket 156):
 // when readings wait, one muted line names the count and points there — the
 // same sentence the today surface shows, now actionable.
 if (backlog !== null && backlog.pendingReadings > 0) {
  const door = deps.el('p', { class: 'wiki-backlog-link' });
  const see = deps.el('button', { class: 'nav-link', type: 'button' }, 'see which');
  see.addEventListener('click', () => deps.navTo('today'));
  door.append(deps.text(backlogSentence(backlog.pendingReadings) + ' \u2014 '), see, deps.text('.'));
  page.append(door);
 }

 for (const neighborhood of wiki.neighborhoods) {
  if (neighborhood.passages.length === 0) continue;
  const section = deps.el('section', { class: 'wiki-facet' });
  section.append(deps.el('h2', { class: 'wiki-heading' }, neighborhood.name));

  for (const p of neighborhood.passages) {
   const block = deps.el('article', { class: 'wiki-claim' });
   block.dataset.passage = p.id;
   // The passage IS the person's words — always the darkest ink.
   block.dataset.ink = 'yours';
   // The lens (wave 5, §11): a passage that neither was said nor gained a
   // context line since the last read recedes — dimmed, still present,
   // still clickable.
   if (lensOn && lastRead !== null && !passageSinceChanged(p, lastRead)) {
    block.classList.add('receded');
   }

   const s = byId.get(p.id);
   if (s) {
    block.append(quoteBlock(deps, s.prose, s.captured, s.provenance,
     s.annotation?.kind === 'annotation' ? s.annotation : undefined));
   } else {
    // The passage is on the page but its words are not in the pool — never
    // guess them. The block renders with its facts alone.
    block.append(quoteBlock(deps, p.prose, p.captured));
   }

   // The context line: agent ink in the marginalia register, never
   // quotable. The composed line when the job has run; the mechanical
   // facts otherwise.
   if (p.context !== undefined) {
    block.append(deps.el('p', { class: 'wiki-note context-line' }, p.context.text));
    for (const echo of p.context.echoes) {
     const echoed = byId.get(echo);
     if (!echoed) continue;
     const e = deps.el('p', { class: 'wiki-note context-echo' },
      `echoes: ${echoed.prose.trim().slice(0, 80)}${echoed.prose.length > 80 ? '…' : ''}`);
     e.dataset.echo = echo;
     block.append(e);
    }
   } else {
    block.append(marginNote(deps, mechanicalLine(p)));
   }

   // The verb-grammar rule: correcting is an explicit mode shift. A click
   // on the passage dims the page around it and brings the contextualizer's
   // margin words; clicking it again, another passage, or pressing Escape
   // leaves the mode.
   block.addEventListener('click', () => {
    if (correctingBlock === block) {
     releaseCorrectingMode(deps.document);
    } else {
     focusPassage(deps, page, block, p);
    }
   });
   section.append(block);
  }
  sections.push({ heading: neighborhood.name, el: section });
  page.append(section);
 }

 if (wiki.contradictions.length > 0) {
  const section = deps.el('section', { class: 'wiki-facet' });
  section.append(deps.el('h2', { class: 'wiki-heading' }, 'Two things held at once'));
  for (const x of wiki.contradictions) {
   const exhibit = deps.el('div', { class: 'wiki-exhibit' });
   exhibit.dataset.ink = x.status === 'dissolved' ? 'aside' : 'facing';
   // The lens (wave 5): an exhibit that neither opened nor resolved since
   // the last read recedes with the passages.
   if (lensOn && lastRead !== null && !exhibitSinceChanged(x, lastRead)) {
    exhibit.classList.add('receded');
   }
   // The body is written as the two poles and then the verified quote,
   // separated by blank lines (src/clerk/wiki-jobs.ts#juxtaposition). Set
   // as an exhibit: facing sentences, then the person's own words.
   for (const chunk of x.body.split(/\n\s*\n/)) {
    const text = chunk.trim();
    if (!text) continue;
    if (text.startsWith('>')) {
     const quoteText = text.replace(/^>\s*/, '').trim();
     // Best-effort lineage: only when the verified quote is exactly a
     // snippet's prose does it carry that snippet's provenance. A partial
     // quote matches nothing and renders without lineage.
     let prov: { question?: string; context?: string } | undefined;
     let ann: { expression: string; referent: string } | undefined;
     for (const s of byId.values()) {
      if (s.prose === quoteText) {
       prov = s.provenance;
       ann = s.annotation?.kind === 'annotation' ? s.annotation : undefined;
       break;
      }
     }
     exhibit.append(quoteBlock(deps, quoteText, undefined, prov, ann));
    } else exhibit.append(deps.el('p', { class: 'exhibit-pole' }, text));
   }
   section.append(exhibit);
  }
  sections.push({ heading: 'Two things held at once', el: section });
  page.append(section);
 }

 const foot = deps.el('div', { class: 'wiki-foot' });

 // The one control on the page, and it is a sentence: what is on screen, and
 // the words that widen it. The since-lens is the whole essay one word away
 // (canon §5.5) — toggling re-paints from the payload already in hand, never
 // refetches.
 const lens = deps.el('p', { class: 'wiki-lens' });
 const toggle = deps.el('button', { class: 'nav-link' },
  lensOn ? 'read the whole essay' : 'back to what changed');
 toggle.addEventListener('click', () => { lensOn = !lensOn; repaint(deps); });
 lens.append(
  deps.text(lensOn
   ? 'This is what changed since you last read it. Or '
   : 'This is the whole essay. Or '),
  toggle,
  deps.text('.'),
 );
 foot.append(lens);
 page.append(foot);

 // The sidebar is a table of contents for the page: the neighborhood
 // headings it shows, each a link that scrolls its section into view. Only
 // the heading words themselves — no counts, no status words.
 sidebar.innerHTML = '';
 for (const s of sections) {
  const link = deps.el('a', { class: 'nav-link' }, s.heading);
  link.addEventListener('click', (ev) => {
   ev.preventDefault();
   s.el.scrollIntoView({ behavior: 'smooth' });
  });
  sidebar.append(link);
 }
 // The territory door (ticket 152): coverage is the wiki's negative space,
 // and one muted sidebar word opens it. The map is fetched on the click,
 // rendered into an expandable section of the page; a second click closes
 // the section. Q-79 binds every word: coverage describes the archive,
 // never the person — the state words come from web/territory.ts, and the
 // empty vault renders the module's quiet invitation, never a silence.
 const territoryLink = deps.el('button', { class: 'nav-link' }, 'territory');
 let territorySection: HTMLElement | null = null;
 territoryLink.addEventListener('click', () => {
  if (territorySection !== null) {
   territorySection.remove();
   territorySection = null;
   return;
  }
  const section = deps.el('section', { class: 'wiki-facet territory-section' });
  section.append(deps.el('h2', { class: 'wiki-heading' }, 'territory'));
  const slot = deps.el('div', { class: 'territory-slot' });
  section.append(slot);
  page.append(section);
  territorySection = section;
  void deps.api<TerritoryResponse>('/api/territory')
   .then((data) => {
    renderTerritory(slot, data);
    section.scrollIntoView({ behavior: 'smooth' });
   })
   .catch(() => {
    // The register's quiet error, from the shared helper — a failed fetch
    // is never the map's silence (154).
    renderPanelLine(slot, panelLine('error', 'the territory'));
   });
 });
 sidebar.append(territoryLink);
}

/**
 * Where the Clerk stands with this page. Two states, and the first is NOT
 * the second: a Clerk that has not read the wiki has found nothing because it
 * has not looked (eval finding #8). Its remarks are the context lines
 * themselves — present or absent, they are on the page.
 */
function clerkStateSentence(wiki: WikiResponse): string {
 if (wiki.lintedAt === null) return 'It has not read this page yet.';
 const when = relativeTime(wiki.lintedAt);
 return when ? `It read this page ${when}.` : 'It has read this page.';
}
