/**
 * The wiki: a reading surface.
 *
 * A page of prose, not a list of claim cards (docs/interface-references.md).
 * Three rules govern everything below and each one is load-bearing:
 *
 * 1. **No status word ever reaches the DOM.** `unconfirmed`, `evidenced`,
 *    `user-attested` and `contested` are carried by ink alone. A claim whose
 *    evidence is contested is a fact about evidence, not a verdict on the
 *    person; printing the word turns the page into an accusation (Q-15). The
 *    ink scale runs one way — from the Clerk's own sentence in light ink to
 *    the person's quoted words in the darkest — so darkness reads as "more of
 *    your own words stand under this", and a page entirely in light ink reads
 *    as early evidence rather than as failure (Q-21, Q-27).
 * 2. **Verbs exist, but only in correcting mode** (the verb-grammar rule,
 *    `docs/interface-references.md`): a click on a claim dims the page
 *    around it and brings two margin words. The reading page carries none
 *    at rest — the only two controls are a back link and one sentence at
 *    the foot that widens the reading.
 * 3. **No numbers.** No counts, no confidence, no progress (Q-21, Q-24).
 *
 * Injection, not import: `el`, `api`, `beginWait` and the rest are
 * module-private in main.ts (the import-review pattern). The read-watch and
 * correcting-mode machinery is module state with a module-scoped lifetime —
 * main.ts's clear() calls releaseWiki(document) so a navigation never leaves
 * an observer or a key handler listening on a detached page.
 */

import type { Claim, Contradiction } from '../src/wiki/contract.ts';
import type { AnnotationRecord } from '../src/clerk/annotation-store.js';
import type { Snippet } from '../src/types.ts';
import { relativeTime } from '../src/log/format.js';
import { panelLine, renderPanelLine } from './panel-line.js';
import { renderTerritory } from './territory.js';
import type { TerritoryResponse } from '../src/territory.js';
import { lineageBlock } from './lineage.js';
import { readableDate } from './dates.js';
import type { SweepBacklogResponse, WebDepsCore, WebDepsWithWait } from './deps.js';

/**
 * The /api/snippets wire view: a Snippet that may carry a resolved-referent
 * annotation (ticket 074) — agent prose riding beside, never inside, the
 * person's words. The shared Snippet type stays annotation-free.
 */
type WikiSnippet = Snippet & { annotation?: AnnotationRecord };

/**
 * `GET /api/wiki` — already shaped for reading (src/server.ts). Headings and
 * lint notes arrive as words, claims arrive in the order they are meant to be
 * read, and `lintedAt: null` means the Clerk has not read the wiki yet, which
 * is a different thing from having read it and found nothing.
 */
interface WikiFacetGroup {
 facet: string;
 heading: string;
 claims: Claim[];
}

interface WikiLintNote {
 kind: string;
 /** A claim id, a facet name, or a referent slug. NEVER printed (ticket 038). */
 subject: string;
 note: string;
}

interface WikiResponse {
 facets: WikiFacetGroup[];
 contradictions: Contradiction[];
 lint: WikiLintNote[];
 lintedAt: string | null;
 all: boolean;
 /** Claim IDs touched by a repair (Q-104): shown as a margin note, statuses untouched. */
 repairClaimIds?: string[];
}

export interface WikiDeps extends WebDepsCore {
 beginWait: WebDepsWithWait['beginWait'];
 renderShell: () => void;
 clear: () => void;
 setScreen: (screen: string) => void;
 /** A bare text node — the lens sentence and the backlog link are text, never elements. */
 text: (content: string) => Text;
 /**
  * The real document: the read-watch and correcting-mode machinery listens
  * on it (visibilitychange, keydown) — injected, never a global touch.
  */
 document: Document;
 /** The view height the dwell rule measures against (half the view). */
 window: Window;
}

/** The lens state (all=1): navigation resets it; the foot word flips it. */
let all = false;

const WIKI_OPENING =
 'What the Clerk has made of your words so far. Every sentence here is the ' +
 'Clerk’s; the quotations beneath are yours. Ink darkens as more of your ' +
 'own words come to stand under a sentence — a page in light ink has only begun.';

const WIKI_EMPTY =
 'There is nothing on this page yet. The Clerk writes a sentence only where ' +
 'your own words can stand under it.';

/* ── The read-log (Q-21) ──
 *
 * DECISION: a read is recorded on DWELL, not on scroll-into-view and not on a
 * focus interaction.
 *
 * The read-log is what later discounts a claim's evidence: a snippet
 * volunteered after the person read the claim it supports carries less weight.
 * So a read recorded that the person did not perform makes their real evidence
 * count for less — over-recording is not the conservative direction, it is the
 * destructive one. Scroll-into-view over-records by construction: a flick past
 * a section logs every claim in it.
 *
 * Focus under-records to nothing. This surface has no verbs by contract, so
 * nothing on it can take focus; a focus rule would ship an instrument that
 * never fires.
 *
 * Dwell is the measurement that matches the event. The claim must hold half
 * the reader's view, without interruption, for long enough to have been read,
 * in a tab that is actually on screen. A fast scroll records nothing; sitting
 * with a sentence records once. Once per claim per page load: the log answers
 * "had they seen this before they wrote that", and a second entry adds no
 * answer.
 */
const READ_DWELL_MS = 2500;
/** Claims already logged this page load. Reset by a full reload, not by navigation. */
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
 deps.api(`/api/wiki/claim/${encodeURIComponent(id)}/read`, { surface: 'wiki' })
  .catch((e: unknown) => { console.error(e); });
}

/** Watch every `[data-claim]` under `root` and log a read after the dwell. */
function watchReads(deps: WikiDeps, root: HTMLElement) {
 releaseReadWatch(deps.document);
 const blocks = root.querySelectorAll<HTMLElement>('[data-claim]');
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
   const id = target.dataset.claim;
   if (!id) continue;

   // Half the block, or half the view for a block taller than the view —
   // a long quotation must not become unreadable-by-definition.
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

 // A claim left on screen behind another window was not read. The observer
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
 * shift: one claim focused, the page dimmed around it, two margin words
 * inside the claim. Clicking the focused claim again, clicking another
 * claim, or pressing Escape leaves the mode — chrome arrives on entry and
 * leaves on exit, never interleaved at rest.
 */
let correctingPage: HTMLElement | null = null;
let correctingClaim: HTMLElement | null = null;
let correctingKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function releaseCorrectingMode(document: Document): void {
 closeClaimEditor();
 if (correctingPage) correctingPage.classList.remove('correcting');
 if (correctingClaim) correctingClaim.classList.remove('focused');
 correctingPage = null;
 correctingClaim = null;
 if (correctingKeyHandler) {
  document.removeEventListener('keydown', correctingKeyHandler);
  correctingKeyHandler = null;
 }
}

/** The open claim editor's elements, or null. One per page; releaseCorrectingMode closes it. */
let claimEditorEls: HTMLElement[] | null = null;

function closeClaimEditor(): void {
 if (!claimEditorEls) return;
 for (const el of claimEditorEls) el.remove();
 claimEditorEls = null;
}

function focusClaim(deps: WikiDeps, page: HTMLElement, block: HTMLElement, cl: Claim): void {
 releaseCorrectingMode(deps.document);
 correctingPage = page;
 correctingClaim = block;
 page.classList.add('correcting');
 block.classList.add('focused');

 // A released mode leaves its chrome dimmed behind; a fresh focus starts
 // clean.
 block.querySelector('.claim-verbs')?.remove();
 const verbs = deps.el('div', { class: 'claim-verbs' });
 // The verbs' own clicks must not toggle the mode off through the block
 // handler, so the row swallows them.
 verbs.addEventListener('click', (e) => e.stopPropagation());

 const attest = deps.el('button', { class: 'nav-link' }, 'that’s me exactly');
 attest.addEventListener('click', () => {
  deps.api(`/api/wiki/claim/${encodeURIComponent(cl.id)}/attest`)
   .then(() => {
    // No status word: the flag's ink arrives when the Clerk next reads
    // (Q-33), and the line says that and no more.
    verbs.replaceWith(marginNote(deps, 'noted — your ink joins this sentence when the Clerk next reads'));
   })
   .catch((e: unknown) => console.error(e));
 });

 const challenge = deps.el('button', { class: 'nav-link' }, 'not quite — ask me');
 challenge.addEventListener('click', () => {
  deps.api(`/api/wiki/claim/${encodeURIComponent(cl.id)}/challenge`)
   .then(() => {
    verbs.replaceWith(marginNote(deps, 'a question is on its way to your queue'));
   })
   .catch((e: unknown) => console.error(e));
 });

 const correct = deps.el('button', { class: 'nav-link' }, 'correct this');
 correct.addEventListener('click', () => openClaimEditor(deps, block, verbs, cl));

const direction = deps.el('button', { class: 'nav-link' }, 'direction');
direction.addEventListener('click', () => {
  deps.api(`/api/wiki/claim/${encodeURIComponent(cl.id)}/direction`)
    .then(() => {
      verbs.replaceWith(marginNote(deps, 'a direction waits on the coach surface'));
    })
    .catch((e: unknown) => console.error(e));
});

verbs.append(attest, correct, direction, challenge);
block.append(verbs);

if (!correctingKeyHandler) {
 correctingKeyHandler = (e) => {
  if (e.key === 'Escape') releaseCorrectingMode(deps.document);
 };
 deps.document.addEventListener('keydown', correctingKeyHandler);
}
}

function openClaimEditor(deps: WikiDeps, block: HTMLElement, verbs: HTMLElement, cl: Claim): void {
// Correcting is the diff grammar (the verb-grammar rule): the constraint
// visible, commit and cancel explicit, and blur inert — leaving the editor
// never commits and never discards. The verbs row leaves while the editor
// is open and returns on cancel, never interleaved at rest.
verbs.remove();
const editor = deps.el('textarea', { class: 'claim-edit-editor' }, cl.body) as HTMLTextAreaElement;
const constraint = deps.el('p', { class: 'claim-edit-constraint' },
  'this sentence becomes your words — the Clerk may question it, never rewrite it');
const commit = deps.el('button', { class: 'nav-link' }, 'commit');
const cancel = deps.el('button', { class: 'nav-link' }, 'cancel');
const actions = deps.el('div', { class: 'claim-edit-actions' });
actions.append(commit, cancel);
block.append(editor, constraint, actions);
claimEditorEls = [editor, constraint, actions];
// The editor's own clicks must not toggle the mode off through the block
// handler, the way the verbs row swallows them.
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
 // The live check disables commit on an empty body; the guard refuses to
 // commit, never silently reverting the person's edit.
 if (!valid()) return;
 deps.api(`/api/wiki/claim/${encodeURIComponent(cl.id)}/edit`, { body: editor.value })
  .then(() => {
   closeClaimEditor();
   const sentence = block.querySelector<HTMLElement>('.claim-sentence');
   if (sentence) sentence.textContent = claimSentence(editor.value.trim(), cl.range);
   block.append(marginNote(deps, 'your words stand here — your ink joins this sentence when the Clerk next reads'));
  })
  .catch((e: unknown) => console.error(e));
});

cancel.addEventListener('click', () => {
 closeClaimEditor();
 block.append(verbs);
});
}

/* ── Typesetting helpers ── */

/**
 * The claim as one sentence with its Range as an em-dash clause inside it
 * (the document rule), rather than as a second line of metadata. A trailing
 * full stop moves to the end so the clause reads as a clause.
 */
function claimSentence(body: string, range: string): string {
 const r = range.trim();
 if (!r) return body;
 const stripped = body.trim().replace(/[.]+$/, '');
 return `${stripped} — ${r}.`;
}

/** A quotation in the person's own ink, dated. The cite IS the quote (Q-27). */
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

/** A dimmed marginal remark. Never carries an id — `subject` stays unprinted. */
function marginNote(deps: WikiDeps, text: string): HTMLElement {
 return deps.el('p', { class: 'wiki-note' }, text);
}

/**
 * Which ink a claim takes. The one place a `ClaimStatus` is read.
 *
 * The names on the right are the INK's names, not the status's. A status word
 * does not reach the DOM even as an attribute value: `contested` sitting in
 * the markup is one view-source away from being the verdict Q-15 forbids, and
 * the ink is what the reader is actually being told about anyway.
 */
function claimInk(cl: Claim): string {
 if (cl.archived === true || cl.supersededBy !== undefined) return 'aside';
 switch (cl.status) {
  case 'user-attested': return 'yours';
  case 'evidenced': return 'standing';
  case 'contested': return 'facing';
  default: return 'opening';
 }
}

/* ── Render ── */

export function renderWiki(deps: WikiDeps): void {
 all = false;
 void render(deps);
}

function render(deps: WikiDeps): void {
 deps.clear();
 deps.setScreen('wiki');
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
    // The quotes. A failure here costs the page its evidence but not its
    // prose, so it degrades rather than throws.
    deps.api<{ snippets: Snippet[] }>('/api/snippets').catch(() => ({ snippets: [] as Snippet[] })),
    // The backlog (ticket 156): the Clerk-state sentence links to the
    // waiting surface when readings wait. A failure renders no link — the
    // wiki is read-only and a missing link is not an error state, and there
    // is no backlog panel on this surface to log the panel helper's error
    // contract to, so it degrades silently like /api/snippets.
    deps.api<SweepBacklogResponse>('/api/sweep-backlog').catch(() => null),
   ]);
   wait.done();
   paintWiki(deps, page, sidebar, wiki, snippets.snippets, backlog);
   watchReads(deps, page);
  } catch (e) {
   wait.failed(e, 'the page did not come through — try again');
  }
 })();
}

function paintWiki(deps: WikiDeps, page: HTMLElement, sidebar: HTMLElement, wiki: WikiResponse, snippets: WikiSnippet[], backlog: SweepBacklogResponse | null) {
 page.innerHTML = '';

 const byId = new Map<string, WikiSnippet>();
 for (const s of snippets) byId.set(s.id, s);

 // Lint notes, filed by what they are about. `subject` itself never renders.
 const notesByClaim = new Map<string, string[]>();
 const notesByFacet = new Map<string, string[]>();
 const looseNotes: string[] = [];
 const claimIds = new Set<string>();
 for (const group of wiki.facets) for (const cl of group.claims) claimIds.add(cl.id);
 for (const note of wiki.lint) {
  if (claimIds.has(note.subject)) {
   const list = notesByClaim.get(note.subject);
   if (list) list.push(note.note);
   else notesByClaim.set(note.subject, [note.note]);
  } else if (wiki.facets.some((g) => g.facet === note.subject)) {
   const list = notesByFacet.get(note.subject);
   if (list) list.push(note.note);
   else notesByFacet.set(note.subject, [note.note]);
  } else {
   looseNotes.push(note.note);
  }
 }

 const hasClaims = wiki.facets.some((g) => g.claims.length > 0);

 // The headings that render on this page, in page order, for the sidebar.
 const sections: { heading: string; el: HTMLElement }[] = [];

 page.append(deps.el('p', { class: 'wiki-opening' }, hasClaims ? WIKI_OPENING : WIKI_EMPTY));

 // Eval finding #8: "has not been read" and "was read, nothing to remark"
 // are different states and must not render alike.
 page.append(deps.el('p', { class: 'wiki-state' }, clerkStateSentence(wiki)));

 // The Clerk-state sentence's door back to the waiting surface (ticket 156):
 // when readings wait, one muted line names the count and points there — the
 // same sentence the waiting surface shows, now actionable.
 if (backlog !== null && backlog.pendingReadings > 0) {
  const door = deps.el('p', { class: 'wiki-backlog-link' });
  const see = deps.el('button', { class: 'nav-link', type: 'button' }, 'see which');
  see.addEventListener('click', () => deps.navTo('waiting'));
  door.append(deps.text(`the wiki is ${backlog.pendingReadings} readings behind \u2014 `), see, deps.text('.'));
  page.append(door);
 }

 for (const group of wiki.facets) {
  if (group.claims.length === 0) continue;
  const section = deps.el('section', { class: 'wiki-facet' });
  section.append(deps.el('h2', { class: 'wiki-heading' }, group.heading));
  for (const note of notesByFacet.get(group.facet) ?? []) section.append(marginNote(deps, note));

  // Already ordered by coreness within the facet. Not re-sorted here.
  for (const cl of group.claims) {
   const block = deps.el('article', { class: 'wiki-claim' });
   block.dataset.claim = cl.id;
   block.dataset.ink = claimInk(cl);

   block.append(deps.el('p', { class: 'claim-sentence' }, claimSentence(cl.body, cl.range)));
   for (const note of notesByClaim.get(cl.id) ?? []) block.append(marginNote(deps, note));
   if (wiki.repairClaimIds?.includes(cl.id)) {
    block.append(deps.el('p', { class: 'wiki-note repair-note' }, 'touched by a repair \u2014 review'));
   }

   for (const cite of cl.cites) {
    // "snippetId@version". The index holds the newest version of each
    // snippet, so the quote and its date are always the same words — this
    // never dates old words with a new day. That a cite has since been
    // written again is the Clerk's remark to make, and it makes it in the
    // margin above when it has read the page.
    const snippetId = cite.split('@')[0] ?? '';
    const s = byId.get(snippetId);
    if (s) block.append(quoteBlock(deps, s.prose, s.captured, s.provenance, s.annotation?.kind === 'annotation' ? s.annotation : undefined));
   }
   // The verb-grammar rule: correcting is an explicit mode shift. A click
   // on the claim dims the page around it and brings two margin words;
   // clicking it again, another claim, or pressing Escape leaves the mode.
   block.addEventListener('click', () => {
    if (correctingClaim === block) {
     releaseCorrectingMode(deps.document);
    } else {
     focusClaim(deps, page, block, cl);
    }
   });
   section.append(block);
  }
  sections.push({ heading: group.heading, el: section });
  page.append(section);
 }

 if (wiki.contradictions.length > 0) {
  const section = deps.el('section', { class: 'wiki-facet' });
  section.append(deps.el('h2', { class: 'wiki-heading' }, 'Two things held at once'));
  for (const x of wiki.contradictions) {
   const exhibit = deps.el('div', { class: 'wiki-exhibit' });
   exhibit.dataset.ink = x.status === 'dissolved' ? 'aside' : 'facing';
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
 for (const note of looseNotes) foot.append(marginNote(deps, note));

 // The one control on the page, and it is a sentence: what is on screen, and
 // the words that widen it. Set-aside claims arrive in the lightest ink, and
 // this sentence is where that ink is named.
 const lens = deps.el('p', { class: 'wiki-lens' });
 const toggle = deps.el('button', { class: 'nav-link' },
  wiki.all ? 'read only what stands' : 'read what has been set aside as well');
 toggle.addEventListener('click', () => { all = !all; void render(deps); });
 lens.append(
  deps.text(wiki.all
   ? 'This is the whole record, what has been set aside included. Or '
   : 'This is what stands today. Or '),
  toggle,
  deps.text('.'),
 );
 foot.append(lens);
 page.append(foot);

 // The sidebar is a table of contents for the page: the facet headings it
 // shows, each a link that scrolls its section into view. Only the heading
 // words themselves — no counts, no status words.
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
 * Where the Clerk stands with this page. Three states, and the first is NOT
 * the second: a Clerk that has not read the wiki has found nothing because it
 * has not looked, and saying "no remarks" for it would report silence as a
 * clean bill (eval finding #8).
 */
function clerkStateSentence(wiki: WikiResponse): string {
 if (wiki.lintedAt === null) return 'The Clerk has not read this page yet.';
 const when = relativeTime(wiki.lintedAt);
 const read = when ? `The Clerk read this page ${when}` : 'The Clerk has read this page';
 if (wiki.lint.length === 0) return `${read} and left no remarks.`;
 return `${read}. Its remarks sit beside the sentences they are about.`;
}
