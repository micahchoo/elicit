/**
 * The import-mode wrapper over the ONE review grammar (redesign wave 3):
 * the bulk-ingest review is the grammar's import mode, and this file owns
 * the mode's facts.
 *
 * The grammar (web/review-grammar.ts) renders the shared surface — the
 * piece whole with cuts underlined in place, the focus-dim verdicts, the
 * trim editor, the progress sentence, select-all, save, and the receipt.
 * This wrapper owns everything the grammar's item has no field for:
 *
 * - the wire: GET /api/import/next (the piece, or the sentence that says
 *   why not), POST /api/import/:hash/decisions (keep→approve, trim→trim,
 *   leave out→discard, one `cut`-keyed decision per proposed cut), and
 *   POST /api/import/:hash/exclude for the two whole-piece refusals;
 * - the import-only furniture, layered onto the grammar's containers after
 *   it renders: the header refusals (the Q-51 authorship exclusion and the
 *   plain rejection) into `.import-header`, and the keep-a-passage editor
 *   plus the quiet remaining count into `.import-foot`; the passages kept
 *   of the reader's own ride the save beside the decisions (additions);
 * - the receipt's data: the import decisions wire answers a COUNT
 *   (`{sessionId, snippets}`), so the kept prose is built here, from the
 *   verdicts the person just gave — post-consent by construction;
 * - the waiting state: no piece ready → the sentence the route sent, and
 *   the back control.
 *
 * Injection, not import: `el`, `api` and `beginWait` are module-private in
 * main.ts, and main.ts is edited concurrently by another agent. The seam is
 * one object literal at the call site.
 */

import { renderReviewGrammar, type ReviewGrammarDeps, type ReviewGrammarItem, type ReviewVerb } from './review-grammar.js';
import type { WebDepsWithWait } from './deps.js';

export interface ImportReviewCut {
  text: string;
  /** Offset of `text` in the source body. */
  at: number;
  facet: string;
  stance: string;
  reading: string;
}

export interface ImportReviewMark {
  at: number;
  length: number;
  why: 'quoted' | 'cited' | 'not-prose';
}

export interface ImportReviewItem {
  hash: string;
  file: string;
  title?: string;
  date: string;
  source: string;
  cuts: ImportReviewCut[];
  marks: ImportReviewMark[];
  /** Quiet count of pieces still waiting, shown at the foot when present. */
  remaining?: number;
}

export interface ImportReviewDeps extends WebDepsWithWait {
  /** Browser storage — the finish-later drafts, keyed by the piece's hash. */
  storage: Storage;
  /**
   * The region slug the review stays inside (plan Task 13): the next-item
   * request carries `?region=<slug>` so the bounded queue keeps the reader
   * in the folder they declared. Absent for the 19 adopted posts and plain
   * folder scans — callers omit the parameter then (exactOptionalPropertyTypes
   * callers use a conditional spread).
   */
  region?: string;
  /**
   * A node path the survey map should open at, scrolled to and expanded
   * (plan Tasks 13/14): the reach offer's `reach it` lands here. The review
   * ignores it; the map renders it.
   */
  focus?: string;
  /**
   * The folder the reach offer surveyed (014 T14): the map needs it to open
   * AT the focused region — an offer carries only a path relative to the
   * survey root. Absent on a plain visit: the person types the folder.
   */
  folder?: string;
  /**
   * A live text selection — seeds the keep-a-passage editor with the
   * passage selected in the piece (the one global DOM touch, injected).
   * main.ts passes document.getSelection; the Node-test seam omits it and
   * the editor opens empty.
   */
  selection?: () => string;
}

/** The next-item path, inside the region when one is open (plan Task 13). */
export function nextPath(region?: string): string {
  return region === undefined ? '/api/import/next' : `/api/import/next?region=${encodeURIComponent(region)}`;
}

/** The wire action a plain verdict maps to (IMPORT_ACTIONS). */
type WireAction = 'approve' | 'trim' | 'discard';

export function renderImportReview(deps: ImportReviewDeps): void {
  void load(deps);
}

async function load(deps: ImportReviewDeps): Promise<void> {
  const wait = deps.beginWait(deps.main, 'looking for a piece to review…');
  try {
    const res = await deps.api<{ item: ImportReviewItem | null; waiting?: string }>(
      nextPath(deps.region),
    );
    wait.done();
    if (!res.item) {
      renderWaiting(deps, res.waiting);
      return;
    }
    renderItem(deps, res.item);
  } catch (cause) {
    wait.failed(cause);
  }
}

/** No piece is ready: the waiting sentence the route sent, and a way back. */
function renderWaiting(deps: ImportReviewDeps, waiting?: string): void {
  const { main, el } = deps;
  main.replaceChildren();
  const surface = el('div', { class: 'import-review' });
  const back = el('button', { class: 'import-back' }, 'back');
  back.addEventListener('click', () => deps.navTo('today'));
  surface.append(
    el('p', { class: 'import-waiting' }, waiting ?? 'no piece is ready to review yet.'),
    back,
  );
  main.append(surface);
}

function renderItem(deps: ImportReviewDeps, item: ImportReviewItem): void {
  const grammarDeps: ReviewGrammarDeps = {
    main: deps.main,
    el: deps.el,
    text: deps.text,
    navTo: deps.navTo,
    document: deps.document,
    storage: deps.storage,
    api: deps.api,
  };

  // The passages the reader kept of their own: the save carries them beside
  // the decisions (the import wire's `additions`). Filled by the layered
  // editor below, read by the save closure — one array, two owners.
  const additions: string[] = [];

  const grammarItem: ReviewGrammarItem = {
    kind: 'import',
    id: item.hash,
    heading: item.title ?? item.file,
    date: item.date,
    prose: item.source,
    ...(item.marks.length > 0 ? { marks: item.marks } : {}),
    cuts: item.cuts.map((c, index) => ({
      index,
      text: c.text,
      at: c.at,
      note: `${c.facet} · ${c.stance} · ${c.reading}`,
    })),
    verbs: ['keep', 'trim', 'leave out'] as ReviewVerb[],
    save: (decisions) => {
      // The receipt's data: the verbatim cuts the person just approved —
      // the wire answers a count, so the prose is built here, from the
      // verdicts themselves (post-consent by construction).
      const kept: { prose: string }[] = [];
      const wire = decisions.map((d) => {
        const action: WireAction = d.action === 'keep' ? 'approve' : d.action === 'leave out' ? 'discard' : 'trim';
        if (d.action === 'keep') {
          const cut = item.cuts[d.index];
          if (cut) kept.push({ prose: cut.text });
        } else if (d.action === 'trim' && d.text !== undefined) {
          kept.push({ prose: d.text });
        }
        return d.action === 'trim' && d.text !== undefined
          ? { cut: d.index, action: 'trim' as const, text: d.text }
          : { cut: d.index, action };
      });
      for (const a of additions) kept.push({ prose: a });
      return deps
        .api(`/api/import/${item.hash}/decisions`, {
          decisions: wire,
          ...(additions.length > 0 ? { additions: [...additions] } : {}),
        })
        .then(() => ({ snippets: kept }));
    },
  };

  renderReviewGrammar(grammarDeps, grammarItem);

  // The import-only furniture, layered on the grammar's containers.
  layerRefusals(deps, item);
  layerFoot(deps, item, additions);
}

/**
 * The two whole-piece refusals, layered into the grammar's header. The
 * refusals live at the level of the object they act on — the whole piece,
 * above the prose — never a fourth word beside the verdicts. Two doors to
 * the same act (status 'excluded', with the reader's reason on the record):
 * the Q-51 authorship exclusion, and the plain rejection for a piece that
 * is yours but stays out of the diary.
 */
function layerRefusals(deps: ImportReviewDeps, item: ImportReviewItem): void {
  const { el, main } = deps;
  const header = main.querySelector('.import-header');
  if (!header) return;

  function refusal(kind: '' | 'reject', label: string, placeholder: string, waiting: string): HTMLElement {
    // The reject door carries `import-reject-*` beside the shared classes,
    // so it inherits the exclude styling and stays addressable on its own.
    const cls = (base: string): string => (kind === '' ? base : `${base} ${base.replace('exclude', kind)}`);
    const row = el('div', { class: cls('import-exclude') });
    const toggle = el('button', { class: cls('import-exclude-toggle') }, label);
    const form = el('span', { class: cls('import-exclude-form') });
    const reasonInput = el('input', { class: cls('import-exclude-reason'), placeholder });
    const confirm = el('button', { class: cls('import-exclude-confirm') }, 'confirm');
    form.append(reasonInput, confirm);
    row.append(toggle, form);
    toggle.addEventListener('click', () => {
      form.classList.add('open');
      reasonInput.focus();
    });
    confirm.addEventListener('click', () => {
      const reason = reasonInput.value.trim();
      if (!reason) {
        // Refused client-side: an empty reason records nothing (Q-51).
        reasonInput.focus();
        return;
      }
      const wait = deps.beginWait(row, waiting);
      void deps
        .api(`/api/import/${item.hash}/exclude`, { reason })
        .then(() => wait.done())
        .then(() => deps.navTo('import'))
        .catch((cause: unknown) => wait.failed(cause));
    });
    return row;
  }

  header.append(
    refusal('', 'this one is not mine alone', 'why it is not yours alone', 'setting it aside…'),
    refusal('reject', 'reject this piece', 'why it stays out', 'setting it aside…'),
  );
}

/**
 * The foot's import-only furniture, layered onto the grammar's foot: the
 * quiet count of pieces still waiting, and the keep-a-passage editor. The
 * grammar's no-cuts sentence promises "no passages"; an addition breaks
 * that promise, so the sentence leaves while any addition stands.
 */
function layerFoot(deps: ImportReviewDeps, item: ImportReviewItem, additions: string[]): void {
  const { el, main } = deps;
  const foot = main.querySelector('.import-foot');
  if (!foot) return;

  if (item.remaining !== undefined && item.remaining > 0) {
    foot.append(
      el(
        'p',
        { class: 'import-remaining' },
        `${item.remaining} more piece${item.remaining === 1 ? '' : 's'} wait after this one.`,
      ),
    );
  }

  const additionsList = el('div', { class: 'import-additions' });
  const addRow = el('div', { class: 'import-add' });
  const addToggle = el('button', { class: 'import-add-toggle' }, 'keep a passage of your own');
  addRow.append(addToggle);
  let addEditor: { ta: HTMLTextAreaElement; wrap: HTMLElement } | null = null;

  function refreshNoCuts(): void {
    const noCuts = main.querySelector('.import-no-cuts') as (HTMLElement & { hidden?: boolean }) | null;
    if (noCuts) noCuts.hidden = additions.length > 0;
  }

  function renderAddition(text: string): void {
    const row = el('div', { class: 'import-addition' });
    const passage = el('span', { class: 'import-addition-text' }, text);
    const removeWord = el('button', { class: 'import-addition-remove' }, 'remove');
    removeWord.addEventListener('click', () => {
      const i = additions.indexOf(text);
      if (i !== -1) additions.splice(i, 1);
      row.remove();
      refreshNoCuts();
    });
    row.append(passage, removeWord);
    additionsList.append(row);
  }

  addToggle.addEventListener('click', () => {
    if (addEditor) {
      // A second press cancels — the same gesture trim uses.
      addEditor.wrap.remove();
      addEditor = null;
      return;
    }
    const ta = el('textarea', { class: 'import-add-editor' });
    // Seed from a live selection in the piece, when the browser offers one.
    const sel = deps.selection?.() ?? '';
    if (sel) ta.value = sel;
    const hint = el(
      'p',
      { class: 'import-add-hint' },
      'the exact passage, word for word — select it in the piece first, or paste it here.',
    );
    const confirm = el('button', { class: 'import-add-confirm' }, 'keep it');
    const wrap = el('div', { class: 'import-add-editor-wrap' });
    wrap.append(ta, hint, confirm);
    addRow.append(wrap);
    addEditor = { ta, wrap };
    ta.focus();
    ta.addEventListener('input', () => ta.classList.remove('invalid'));
    confirm.addEventListener('click', () => {
      const text = ta.value.trim();
      if (text === '' || !item.source.includes(text)) {
        ta.classList.add('invalid');
        return;
      }
      if (!additions.includes(text)) {
        additions.push(text);
        renderAddition(text);
      }
      wrap.remove();
      addEditor = null;
      refreshNoCuts();
    });
  });

  foot.append(additionsList, addRow);
}
