/**
 * The ONE review grammar (redesign §5.4, wave 3): harvest review and import
 * review are a single surface, a single implementation. The source renders
 * whole, in order, as continuous prose with the proposed cuts underlined in
 * place. Touching a cut focuses it — the page dims around it and the verdict
 * words appear in the margin, one movable cluster, never per-row button
 * sets. The verdict words are the item's plain words (keep · trim · say it
 * again · leave out; imports drop "say it again"); the mapping from plain
 * words to the wire actions lives inside the mode wiring's save(), not
 * here.
 *
 * The grammar is a port-and-generalize of web/import-review.ts's prose
 * machinery: the DOM classes ARE the import contract (.import-cut,
 * .import-focus, .import-trim-editor, .import-save, .import-progress, …) so
 * the import DOM suite passes unchanged in import mode. The item
 * parameterizes everything else: kind ('sitting' | 'import'), prose, cuts
 * (with optional `at` offsets — a cut without one is located by indexOf,
 * and one the prose does not contain renders as its own underlined block,
 * degraded but honest), buds (live only, at the end, dimmed, with their
 * reasons), verbs, and save() — the one wire callback, owned by the wiring,
 * which returns the receipt's snippets.
 *
 * The surface's promises:
 * - Progress is a sentence ("N of M decided"; import mode keeps its pinned
 *   "N of M underlined cuts still wait…" sentence).
 * - Finish-later keeps drafts: the decision map persists per item in
 *   localStorage (one key per item id) and hydrates on re-entry; the
 *   receipt clears it.
 * - Trim is select-your-span on the prose, with the textarea fallback; both
 *   paths feed web/trim-validity.ts and an invalid trim is refused.
 * - After save() resolves, the surface becomes the receipt — "Kept, in
 *   your words:" and the verbatim kept passages. Always post-consent by
 *   construction; nothing navigates away.
 * - A save that fails is a sentence, never a silence.
 *
 * Injection, not import: `el` and the rest of the seam arrive as one
 * object literal at the call site (the import-review pattern). The grammar
 * never fetches — the wiring loads the item — so `api` is optional here;
 * the item's save() owns the wire.
 */

import { validTrim } from './trim-validity.js';
import { repeatSentence } from './deps.js';
import type { WebDepsCore } from './deps.js';

/** The plain-word verdicts (§5.4) — the screen never says approve/discard. */
export type ReviewVerb = 'keep' | 'trim' | 'say it again' | 'leave out';

/** One proposed cut. `index` is the stable id: decisions and data-cut key by it. */
export interface ReviewCut {
  index: number;
  /** The cut's text — the proposed passage. */
  text: string;
  /** Offset of `text` in the prose, when the caller knows it. Absent → located by indexOf. */
  at?: number;
  /** The margin note shown beside the cut when focused (import marginalia). */
  note?: string;
}

/** A fragment that couldn't stand alone (live sittings), with its reason. */
export interface ReviewBud {
  text: string;
  reason: string;
}

/**
 * One decision, handed to the item's save(). The action is the plain verb
 * the person chose; the wiring maps it to the wire action (keep→approve,
 * trim→trim, say it again→restate, leave out→discard).
 */
export type ReviewDecision = { index: number; action: ReviewVerb; text?: string };

/**
 * The unified review item. `prose` is the source whole, in order; `cuts`
 * are the proposed passages; `verbs` is the verdict cluster to show;
 * `save` owns the wire and resolves with the receipt's snippets.
 */
export interface ReviewGrammarItem {
  kind: 'sitting' | 'import';
  /** The item's stable id — the subject of the finish-later draft key: the
   * sitting's sessionId (live) or the import piece's hash. */
  id: string;
  /** The surface's top line (the header sentence). */
  heading: string;
  /** The date the piece was written — feeds the import header sentence. */
  date?: string;
  /** The source body, whole, in order. */
  prose: string;
  cuts: ReviewCut[];
  /** Dropped regions with their reasons (import) — one dimmed margin word each. */
  marks?: { at: number; length: number; why: string }[];
  /** Fragments that couldn't stand alone — live sittings only. */
  buds?: ReviewBud[];
  /** The verdict words to show, in order (imports drop 'say it again'). */
  verbs: ReviewVerb[];
  save(decisions: ReviewDecision[]): Promise<{ snippets: { prose: string; repeats?: { olderSnippetId: string; olderCaptured: string } }[] }>;
}

/**
 * The grammar's seam: the WebDepsCore-ish verbs, no wait machinery — the
 * grammar renders synchronously and the item owns the wire. `api` rides
 * for the wrappers' reuse; the grammar itself never fetches.
 */
export interface ReviewGrammarDeps {
  main: HTMLElement;
  el: WebDepsCore['el'];
  text: WebDepsCore['text'];
  navTo: WebDepsCore['navTo'];
  document: Document;
  /** Browser storage — the finish-later drafts, one key per item id. */
  storage: Storage;
  api?: WebDepsCore['api'];
}

/** A decision kept in hand, keyed by cut index, until save. */
type Decision = { action: ReviewVerb; text?: string };

/** A cut's portion inside one paragraph (paragraph-local offsets). */
type Portion = { pi: number; localStart: number; localEnd: number };

/** A mark to draw inside one paragraph (paragraph-local offsets). */
type ParaMark = { ci: number; start: number; end: number };

/** The browser Selection, narrowed to what the trim gesture reads. */
interface SelectionLike {
  isCollapsed: boolean;
  anchorNode: Node | null;
  toString(): string;
}

/** The receipt heading — the ONE copy. */
const RECEIPT_HEADING = 'Kept, in your words:';
/** The zero-snippet receipt is never empty (copy rule 5). */
const RECEIPT_ZERO = 'Nothing was kept.';
/** A save that fails is a sentence, never a silence. */
const SAVE_FAILED_SENTENCE = 'it could not be saved \u2014 nothing is lost \u00b7 try again.';
/** A cut the prose does not contain renders honestly as its own block. */
const STANDALONE_NOTE = 'this passage could not be placed in the text above';

/**
 * Finish-later drafts (§5.4): the decision map persists per item — one
 * localStorage key per review, so leaving mid-review and coming back
 * restores every decision made so far. The receipt clears the key.
 */
const DRAFT_KEY_PREFIX = 'elicit.review-drafts.';
/** The verdict words as values — the draft hydration validator. */
const REVIEW_VERBS: readonly ReviewVerb[] = ['keep', 'trim', 'say it again', 'leave out'];

function draftKeyOf(itemId: string): string {
  return `${DRAFT_KEY_PREFIX}${itemId}`;
}

/** The stable form a draft stores: the cut's `index` (never the render-local
 * position), so a re-render of the same item re-places each decision. */
function toPayload(cuts: ReviewCut[], decisions: Map<number, Decision>): ReviewDecision[] {
  const out: ReviewDecision[] = [];
  for (const [ci, d] of decisions) {
    const cut = cuts[ci];
    if (!cut) continue;
    out.push({ index: cut.index, action: d.action, ...(d.text !== undefined ? { text: d.text } : {}) });
  }
  return out;
}

function isReviewVerb(v: string): v is ReviewVerb {
  return (REVIEW_VERBS as readonly string[]).includes(v);
}

/**
 * Restore a saved draft into the per-render decision map. Each entry is
 * re-placed by the cut's stable index; an entry whose cut is gone (the
 * piece changed between visits) is dropped, and a corrupt value is dropped
 * whole — a draft is a convenience, never a crash.
 */
function hydrateDecisions(storage: Storage, key: string, cuts: ReviewCut[], out: Map<number, Decision>): void {
  const raw = storage.getItem(key);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as { index?: unknown; action?: unknown; text?: unknown };
    if (typeof rec.index !== 'number' || typeof rec.action !== 'string' || !isReviewVerb(rec.action)) continue;
    if (rec.text !== undefined && typeof rec.text !== 'string') continue;
    const ci = cuts.findIndex((c) => c.index === rec.index);
    if (ci === -1) continue;
    out.set(ci, rec.text === undefined ? { action: rec.action } : { action: rec.action, text: rec.text });
  }
}

export function renderReviewGrammar(deps: ReviewGrammarDeps, item: ReviewGrammarItem): void {
  renderItem(deps, item);
}

function renderItem(deps: ReviewGrammarDeps, item: ReviewGrammarItem): void {
  const { main, el } = deps;
  main.replaceChildren();

  const surface = el('div', { class: 'import-review' });
  main.append(surface);

  const paragraphs = paragraphSpans(item.prose);

  // Where each cut sits in the prose: the caller's offset when it verifies
  // against the text, else the first occurrence. A cut that is nowhere in
  // the prose (at -1) renders as its own underlined block.
  const cutAt: number[] = item.cuts.map((cut) => {
    if (cut.at !== undefined && item.prose.slice(cut.at, cut.at + cut.text.length) === cut.text) {
      return cut.at;
    }
    return item.prose.indexOf(cut.text);
  });

  const decisions = new Map<number, Decision>();
  const draftKey = draftKeyOf(item.id);
  hydrateDecisions(deps.storage, draftKey, item.cuts, decisions);
  const blocks: HTMLDivElement[] = [];
  const standaloneHome: (HTMLDivElement | null)[] = item.cuts.map(() => null);
  const cutSpans: HTMLSpanElement[][] = [];
  const notes: (HTMLSpanElement | null)[] = [];
  const verbs = el('div', { class: 'import-verbs' });
  let currentCut: number | null = null;
  let trimEditor: { ci: number; span: HTMLSpanElement; wrapper: HTMLElement; ta: HTMLTextAreaElement } | null =
    null;
  let restateEditor: { ci: number; wrapper: HTMLElement; ta: HTMLTextAreaElement } | null = null;

  /* ── the header — the date/heading sentence, and nothing else ── */

  const header = el('div', { class: 'import-header' });
  header.append(
    el(
      'p',
      { class: 'import-date' },
      item.kind === 'import'
        ? `written ${item.date ?? item.heading}; it will be saved as a sitting on that date.`
        : item.heading,
    ),
  );
  surface.append(header);

  /* ── the piece — every source paragraph, in order, nothing reflowed ── */

  // A cut spanning a paragraph break is marked per-paragraph portion; the
  // verb cluster is one per cut, attached to the portion where it starts.
  const portionsByCut: Portion[][] = item.cuts.map((cut, ci) => {
    if (cutAt[ci] === -1) return [];
    const start = cutAt[ci]!;
    const end = start + cut.text.length;
    const out: Portion[] = [];
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const p = paragraphs[pi]!;
      const pEnd = p.start + p.text.length;
      const lo = Math.max(start, p.start);
      const hi = Math.min(end, pEnd);
      if (hi > lo) out.push({ pi, localStart: lo - p.start, localEnd: hi - p.start });
    }
    return out;
  });

  // Per-paragraph marks, sorted by position. Overlapping cuts are clipped
  // to the region not already marked (display only — the decision still
  // refers to the record's full cut text).
  const paraMarks: ParaMark[][] = paragraphs.map(() => []);
  for (let ci = 0; ci < item.cuts.length; ci++) {
    for (const part of portionsByCut[ci]!) {
      paraMarks[part.pi]!.push({ ci, start: part.localStart, end: part.localEnd });
    }
  }
  for (const marks of paraMarks) {
    marks.sort((a, b) => a.start - b.start || a.end - b.end);
    let cursor = 0;
    const kept: ParaMark[] = [];
    for (const m of marks) {
      const start = Math.max(m.start, cursor);
      if (start >= m.end) continue;
      kept.push({ ci: m.ci, start, end: m.end });
      cursor = m.end;
    }
    marks.length = 0;
    marks.push(...kept);
  }

  const piece = el('div', { class: 'import-piece' });

  /** The block a cut's controls (verbs, trim/restate editor) attach to. */
  function homeBlockOf(ci: number): HTMLDivElement | null {
    const home = portionsByCut[ci]?.[0];
    if (home) return blocks[home.pi] ?? null;
    return standaloneHome[ci] ?? null;
  }

  function focusCut(ci: number): void {
    closeEditors();
    currentCut = ci;
    surface.classList.add('import-focus');
    verbs.classList.add('active');
    // One cluster, moved to the point of attention.
    homeBlockOf(ci)?.append(verbs);
    for (const n of notes) n?.classList.remove('active');
    notes[ci]?.classList.add('active');
    for (const spans of cutSpans) for (const s of spans) s.classList.remove('focused');
    for (const s of cutSpans[ci] ?? []) s.classList.add('focused');
  }

  function closeEditors(): void {
    if (trimEditor) {
      trimEditor.wrapper.remove();
      trimEditor = null;
    }
    if (restateEditor) {
      restateEditor.wrapper.remove();
      restateEditor = null;
    }
  }

  function clearFocus(): void {
    currentCut = null;
    surface.classList.remove('import-focus');
    verbs.classList.remove('active');
    for (const n of notes) n?.classList.remove('active');
    for (const spans of cutSpans) for (const s of spans) s.classList.remove('focused');
  }

  /** Write-through: every decision change lands in the draft key. */
  function persist(): void {
    deps.storage.setItem(draftKey, JSON.stringify(toPayload(item.cuts, decisions)));
  }

  function decide(ci: number, action: ReviewVerb, text?: string): void {
    closeEditors();
    if (text === undefined) decisions.set(ci, { action });
    else decisions.set(ci, { action, text });
    persist();
    for (const s of cutSpans[ci] ?? []) s.classList.add('decided');
    save.disabled = decisions.size < item.cuts.length;
    updateProgress();
    clearFocus();
  }

  function openTrimEditor(ci: number): void {
    if (trimEditor) {
      closeEditors(); // a second click on trim cancels, as renderProposal does
      return;
    }
    closeEditors();
    const span = (cutSpans[ci] ?? [])[0];
    const home = homeBlockOf(ci);
    if (!span || !home) return;
    const ta = el('textarea', { class: 'import-trim-editor' });
    ta.value = span.textContent;
    const confirm = el('button', { class: 'import-trim-confirm' }, 'confirm');
    const wrapper = el('span', { class: 'import-trim-editor-wrap' });
    wrapper.append(ta, confirm);
    home.append(wrapper);
    trimEditor = { ci, span, wrapper, ta };
    ta.focus();
    confirm.addEventListener('click', () => {
      const v = ta.value;
      const cutText = item.cuts[ci]!.text;
      // The Q-51 authorship guard, one definition (web/trim-validity.ts):
      // a trim must be a non-empty substring of the cut.
      if (!validTrim(cutText, v)) {
        ta.value = cutText; // refused — reset, never overwrite the edit
        return;
      }
      span.textContent = v;
      wrapper.remove();
      trimEditor = null;
      decide(ci, 'trim', v);
    });
  }

  // Say it again is the person's own words about the cut — not a substring
  // rule; any non-empty restatement rides the decision (harvest's restate).
  function openRestateEditor(ci: number): void {
    if (restateEditor) {
      closeEditors(); // a second press cancels
      return;
    }
    closeEditors();
    const home = homeBlockOf(ci);
    if (!home) return;
    const ta = el('textarea', { class: 'import-restate-editor', placeholder: 'say it in your own words\u2026' });
    const confirm = el('button', { class: 'import-restate-confirm' }, 'confirm');
    const wrapper = el('span', { class: 'import-restate-editor-wrap' });
    wrapper.append(ta, confirm);
    home.append(wrapper);
    restateEditor = { ci, wrapper, ta };
    ta.focus();
    confirm.addEventListener('click', () => {
      const v = ta.value.trim();
      if (v === '') return; // nothing restated — no decision
      wrapper.remove();
      restateEditor = null;
      decide(ci, 'say it again', v);
    });
  }

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!;
    const block = el('div', { class: 'import-para-block' });
    const p = el('p', { class: 'import-para' });
    let cursor = 0;
    for (const m of paraMarks[pi]!) {
      if (m.start > cursor) p.append(para.text.slice(cursor, m.start));
      const idx = item.cuts[m.ci]!.index;
      const span = el(
        'span',
        { class: 'import-cut', tabindex: '0', 'data-cut': String(idx) },
        para.text.slice(m.start, m.end),
      );
      span.addEventListener('click', () => focusCut(m.ci));
      span.addEventListener('focus', () => focusCut(m.ci));
      p.append(span);
      (cutSpans[m.ci] ??= []).push(span);
      cursor = m.end;
    }
    if (cursor < para.text.length) p.append(para.text.slice(cursor));
    block.append(p);
    blocks.push(block);
    piece.append(block);
  }

  // A cut the prose does not contain: its own underlined block — degraded
  // but honest, never silently dropped.
  for (let ci = 0; ci < item.cuts.length; ci++) {
    if (cutAt[ci] !== -1) continue;
    const idx = item.cuts[ci]!.index;
    const block = el('div', { class: 'import-para-block' });
    const p = el('p', { class: 'import-para' });
    const span = el('span', { class: 'import-cut', tabindex: '0', 'data-cut': String(idx) }, item.cuts[ci]!.text);
    span.addEventListener('click', () => focusCut(ci));
    span.addEventListener('focus', () => focusCut(ci));
    p.append(span);
    block.append(p, el('span', { class: 'review-standalone-note' }, STANDALONE_NOTE));
    piece.append(block);
    standaloneHome[ci] = block;
    (cutSpans[ci] ??= []).push(span);
  }

  // A hydrated draft restates its marks on the prose.
  for (const [ci] of decisions) {
    for (const s of cutSpans[ci] ?? []) s.classList.add('decided');
  }

  // Each cut's margin note (facet · stance · reading, import marginalia)
  // beside the paragraph where the cut starts; hidden until focused.
  for (let ci = 0; ci < item.cuts.length; ci++) {
    const cut = item.cuts[ci]!;
    if (cut.note === undefined) {
      notes.push(null);
      continue;
    }
    const note = el('span', { class: 'import-cut-note' }, cut.note);
    (homeBlockOf(ci) ?? blocks[blocks.length - 1] ?? piece).append(note);
    notes.push(note);
  }

  // A dropped region states its reason: one dimmed margin word at the
  // region's paragraph, so the silence around it is never unexplained.
  for (const mark of item.marks ?? []) {
    const pi = paragraphs.findIndex((p) => mark.at >= p.start && mark.at < p.start + p.text.length);
    const word = el('span', { class: 'import-mark' }, mark.why);
    const home = pi === -1 ? blocks[blocks.length - 1] : blocks[pi];
    (home ?? piece).append(word);
  }

  surface.append(piece);

  // Fragments that couldn't stand alone, at the end, dimmed, each with its
  // recorded reason — the coming question makes sense when it arrives.
  if (item.buds && item.buds.length > 0) {
    const buds = el('div', { class: 'review-buds' });
    buds.append(el('p', { class: 'review-buds-heading' }, 'couldn\u2019t stand alone'));
    for (const bud of item.buds) {
      const row = el('div', { class: 'review-bud' });
      row.append(el('span', { class: 'review-bud-text' }, bud.text), el('span', { class: 'review-bud-reason' }, bud.reason));
      buds.append(row);
    }
    surface.append(buds);
  }

  /* ── the foot — the verbs (one cluster, at the focused cut) and the save ── */

  for (const verb of item.verbs) {
    const btn = el('button', { class: 'import-verb' }, verb);
    btn.addEventListener('click', () => {
      if (currentCut === null) return;
      if (verb === 'trim') {
        openTrimEditor(currentCut);
        return;
      }
      if (verb === 'say it again') {
        openRestateEditor(currentCut);
        return;
      }
      decide(currentCut, verb);
    });
    verbs.append(btn);
  }

  const foot = el('div', { class: 'import-foot' });

  // Zero proposed cuts is a decided state, not a dead end: the save is live
  // from the start and the sitting is recorded with its transcript and no
  // snippets.
  const noCutsNote =
    item.cuts.length === 0
      ? el(
          'p',
          { class: 'import-no-cuts' },
          item.kind === 'import'
            ? 'nothing in this piece stood out to keep \u2014 saving records it as a sitting with no passages.'
            : 'nothing from this sitting stood on its own \u2014 that happens.',
        )
      : null;
  if (noCutsNote) foot.append(noCutsNote);

  // The running state the page never said out loud: how many cuts still
  // wait (import's pinned sentence) or how many are decided (the doc's).
  // Updated on every decision; save enables exactly when it reaches zero.
  const progress = el('p', { class: 'import-progress' });
  function updateProgress(): void {
    if (item.cuts.length === 0) return;
    if (item.kind === 'import') {
      const undecided = item.cuts.length - decisions.size;
      progress.textContent =
        undecided === 0
          ? `all ${item.cuts.length} cuts are decided.`
          : `${undecided} of ${item.cuts.length} underlined cut${item.cuts.length === 1 ? '' : 's'} still wait${undecided === 1 ? 's' : ''} for a decision \u2014 click one, then keep, trim or leave it out.`;
    } else {
      progress.textContent =
        decisions.size === item.cuts.length
          ? `all ${item.cuts.length} decided.`
          : `${decisions.size} of ${item.cuts.length} decided`;
    }
  }
  updateProgress();

  // Bulk preselection, never a commit: one verb lands on every cut still
  // waiting; cuts already decided keep their decision, and any single cut
  // can be reopened and changed until save is pressed. Both modes carry
  // the same plain labels (wave 6).
  const bulkDefs: { label: string; action: ReviewVerb }[] = [
    { label: 'select all \u2014 keep', action: 'keep' },
    { label: 'select all \u2014 leave out', action: 'leave out' },
  ];
  const decideAllRow = el('div', { class: 'import-decide-all' });
  for (const def of bulkDefs) {
    const b = el('button', { class: 'import-decide-all-btn' }, def.label);
    b.addEventListener('click', () => decideRest(def.action));
    decideAllRow.append(b);
  }
  function decideRest(action: ReviewVerb): void {
    closeEditors();
    for (let ci = 0; ci < item.cuts.length; ci++) {
      if (decisions.has(ci)) continue;
      decisions.set(ci, { action });
      for (const s of cutSpans[ci] ?? []) s.classList.add('decided');
    }
    persist();
    save.disabled = decisions.size < item.cuts.length;
    updateProgress();
    clearFocus();
  }

  const failureNote = el('p', { class: 'import-failure' });
  const save = el('button', { class: 'import-save' }, item.kind === 'import' ? 'save this piece' : 'save decisions');
  save.disabled = decisions.size < item.cuts.length;
  save.addEventListener('click', () => {
    if (decisions.size < item.cuts.length) return;
    save.disabled = true;
    failureNote.textContent = '';
    const payload: ReviewDecision[] = item.cuts.map((cut, ci) => {
      const d = decisions.get(ci)!;
      return { index: cut.index, action: d.action, ...(d.text !== undefined ? { text: d.text } : {}) };
    });
    void item
      .save(payload)
      .then((res) => {
        deps.storage.removeItem(draftKey); // decided, not parked — the draft ends
        renderReceipt(res.snippets);
      })
      .catch(() => {
        save.disabled = false;
        failureNote.textContent = SAVE_FAILED_SENTENCE;
      });
  });
  if (item.cuts.length > 0) foot.append(progress, decideAllRow);
  foot.append(failureNote, verbs, save);
  surface.append(foot);

  /* ── select-your-span trim: a selection over the prose while the trim
     editor is armed previews in the editor and commits on mouseup ── */

  const selectionOverProse = (): { text: string } | null => {
    const doc = deps.document as Document & { getSelection?: () => SelectionLike | null };
    const s = doc.getSelection?.() ?? null;
    if (!s || s.isCollapsed) return null;
    const anchor = s.anchorNode;
    if (!(anchor instanceof Node)) return null;
    if (!piece.contains(anchor)) return null;
    if (trimEditor && trimEditor.wrapper.contains(anchor)) return null; // inside the editor
    return { text: s.toString() };
  };
  piece.addEventListener('mouseup', () => {
    if (!trimEditor) return;
    const sel = selectionOverProse();
    if (!sel) return;
    const { ci, span, wrapper, ta } = trimEditor;
    const cutText = item.cuts[ci]!.text;
    if (!validTrim(cutText, sel.text)) {
      ta.value = cutText; // refused — the span stays
      return;
    }
    span.textContent = sel.text;
    wrapper.remove();
    trimEditor = null;
    decide(ci, 'trim', sel.text);
  });
  deps.document.addEventListener?.('selectionchange', () => {
    if (!trimEditor) return;
    const sel = selectionOverProse();
    if (!sel) return;
    const cutText = item.cuts[trimEditor.ci]!.text;
    if (validTrim(cutText, sel.text)) trimEditor.ta.value = sel.text;
  });

  /* ── the receipt — Review's last screen, post-consent by construction ── */

  function renderReceipt(snippets: { prose: string; repeats?: { olderSnippetId: string; olderCaptured: string } }[]): void {
    const receipt = el('div', { class: 'import-review review-receipt' });
    receipt.append(el('p', { class: 'review-receipt-heading' }, RECEIPT_HEADING));
    for (const s of snippets) {
     receipt.append(el('p', { class: 'review-receipt-passage' }, s.prose));
     // Batch C2: the dedupe sentence sits under the passage that repeats
     // an older one — marginalia-class, the plainest copy, dated by the
     // older passage's capture date. Keep-both is the outcome; the
     // person trims if they want one copy gone.
     if (s.repeats) receipt.append(el('p', { class: 'review-receipt-repeat' }, repeatSentence(s.repeats.olderCaptured)));
    }
    if (snippets.length === 0) receipt.append(el('p', { class: 'review-receipt-zero' }, RECEIPT_ZERO));
    main.replaceChildren(receipt);
  }
}

/** The source body split into its own paragraphs, with start offsets. */
function paragraphSpans(source: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let rest = source;
  let offset = 0;
  for (;;) {
    const m = rest.match(/\n\n+/);
    if (!m) {
      if (rest.length > 0) out.push({ text: rest, start: offset });
      return out;
    }
    const sep = m.index!;
    if (sep > 0) out.push({ text: rest.slice(0, sep), start: offset });
    const sepLen = m[0].length;
    offset += sep + sepLen;
    rest = rest.slice(sep + sepLen);
  }
}
