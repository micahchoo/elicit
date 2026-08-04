/**
 * The review surface for the bulk-ingest pipeline: the piece renders whole,
 * in its own paragraphs, with the proposed cuts marked where they sit.
 *
 * The document rule: a page of text, controls only at the point of attention.
 * There is no list, no checkbox, no accept-all and no fourth verb — the three
 * margin words (approve · trim · discard) appear only when a cut is focused,
 * and the only whole-piece actions are the header refusal and `save this
 * piece` at the foot.
 *
 * Injection, not import: `el`, `api` and `beginWait` are module-private in
 * main.ts, and main.ts is edited concurrently by another agent. The seam is
 * one object literal at the call site.
 */

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

export interface ImportReviewDeps {
  main: HTMLElement;
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string>,
    ...kids: (string | Node)[]
  ) => HTMLElementTagNameMap[K];
  api: <T>(path: string, body?: unknown) => Promise<T>;
  beginWait: (
    slot: HTMLElement,
    msg: string,
  ) => { done(): void; failed(cause: unknown, message?: string): void };
  navTo: (screen: string) => void;
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
}

/** The next-item path, inside the region when one is open (plan Task 13). */
export function nextPath(region?: string): string {
  return region === undefined ? '/api/import/next' : `/api/import/next?region=${encodeURIComponent(region)}`;
}

type Verb = 'approve' | 'trim' | 'discard';

/** One decision, keyed by cut index. `text` only ever rides a trim. */
type Decision = { action: Verb; text?: string };

/** A cut's marked portion inside one paragraph (paragraph-local offsets). */
type Portion = { pi: number; localStart: number; localEnd: number };

/** A mark to draw inside one paragraph (paragraph-local offsets). */
type ParaMark = { ci: number; start: number; end: number };

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
  back.addEventListener('click', () => deps.navTo('mode'));
  surface.append(
    el('p', { class: 'import-waiting' }, waiting ?? 'no piece is ready to review yet.'),
    back,
  );
  main.append(surface);
}

function renderItem(deps: ImportReviewDeps, item: ImportReviewItem): void {
  const { main, el } = deps;
  main.replaceChildren();

  const surface = el('div', { class: 'import-review' });
  main.append(surface);

  const paragraphs = paragraphSpans(item.source);
  const decisions = new Map<number, Decision>();
  const blocks: HTMLDivElement[] = [];
  const cutSpans: HTMLSpanElement[][] = [];
  const notes: HTMLSpanElement[] = [];
  const verbs = el('div', { class: 'import-verbs' });
  let currentCut: number | null = null;
  let editor: { ci: number; span: HTMLSpanElement; wrapper: HTMLElement; parent: HTMLElement } | null =
    null;

  /* ── header — two things and only two: the date, and the piece-level refusal ── */

  const header = el('div', { class: 'import-header' });
  header.append(
    el('p', { class: 'import-date' }, `written ${item.date}; it will be saved as a sitting on that date.`),
  );

  // The refusal lives at the level of the object it acts on: the whole piece,
  // above the prose — never a fourth word beside approve · trim · discard.
  const exclude = el('div', { class: 'import-exclude' });
  const excludeToggle = el('button', { class: 'import-exclude-toggle' }, 'this one is not mine alone');
  const excludeForm = el('span', { class: 'import-exclude-form' });
  const excludeReason = el('input', { class: 'import-exclude-reason', placeholder: 'why it is not yours alone' });
  const excludeConfirm = el('button', { class: 'import-exclude-confirm' }, 'confirm');
  excludeForm.append(excludeReason, excludeConfirm);
  exclude.append(excludeToggle, excludeForm);
  header.append(exclude);
  surface.append(header);

  excludeToggle.addEventListener('click', () => {
    excludeForm.classList.add('open');
    excludeReason.focus();
  });

  excludeConfirm.addEventListener('click', () => {
    const reason = excludeReason.value.trim();
    if (!reason) {
      // Refused client-side: an empty reason records nothing (Q-51).
      excludeReason.focus();
      return;
    }
    const wait = deps.beginWait(exclude, 'setting it aside…');
    void deps
      .api(`/api/import/${item.hash}/exclude`, { reason })
      .then(() => wait.done())
      .then(() => deps.navTo('import'))
      .catch((cause: unknown) => wait.failed(cause));
  });

  /* ── the piece — every source paragraph, in order, nothing reflowed ── */

  // Where each cut lands in the source, per paragraph. A cut spanning a
  // paragraph break is marked per-paragraph portion; the verb cluster is one
  // per cut, attached to the portion where the cut starts.
  const portionsByCut: Portion[][] = item.cuts.map((cut) => {
    const start = cut.at;
    const end = cut.at + cut.text.length;
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

  // Per-paragraph marks, sorted by position. Overlapping cuts are clipped to
  // the region not already marked (the decision still refers to the record's
  // full cut text; this is display only).
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

  function focusCut(ci: number): void {
    closeEditor();
    currentCut = ci;
    surface.classList.add('import-focus');
    for (const n of notes) n.classList.remove('active');
    notes[ci]?.classList.add('active');
    verbs.classList.add('active');
    // One cluster, moved to the point of attention. A cut with no marked
    // portion (degenerate: text sits wholly inside a paragraph break) keeps
    // the cluster where it was.
    const home = portionsByCut[ci]?.[0];
    if (home) blocks[home.pi]!.append(verbs);
    for (const spans of cutSpans) for (const s of spans) s.classList.remove('focused');
    for (const s of cutSpans[ci] ?? []) s.classList.add('focused');
  }

  function closeEditor(): void {
    if (!editor) return;
    const { span, wrapper, parent } = editor;
    parent.insertBefore(span, wrapper);
    parent.removeChild(wrapper);
    editor = null;
  }

  function clearFocus(): void {
    currentCut = null;
    surface.classList.remove('import-focus');
    for (const n of notes) n.classList.remove('active');
    verbs.classList.remove('active');
    for (const spans of cutSpans) for (const s of spans) s.classList.remove('focused');
  }

  function decide(ci: number, action: Verb, text?: string): void {
    closeEditor();
    if (text === undefined) decisions.set(ci, { action });
    else decisions.set(ci, { action, text });
    for (const s of cutSpans[ci] ?? []) s.classList.add('decided');
    save.disabled = decisions.size < item.cuts.length;
    clearFocus();
  }

  function openTrimEditor(ci: number): void {
    const span = (cutSpans[ci] ?? [])[0];
    if (!span) return;
    const parent = span.parentElement;
    if (!parent) return;
    const ta = el('textarea', { class: 'import-trim-editor' });
    ta.value = span.textContent;
    const confirm = el('button', { class: 'import-trim-confirm' }, 'confirm');
    const wrapper = el('span', { class: 'import-trim-editor-wrap' });
    wrapper.append(ta, confirm);
    parent.insertBefore(wrapper, span);
    parent.removeChild(span);
    editor = { ci, span, wrapper, parent };
    ta.focus();
    confirm.addEventListener('click', () => {
      const v = ta.value;
      const cutText = item.cuts[ci]!.text;
      // The same guard renderProposal uses: refuse unless the result is a
      // non-empty substring of the cut (emptiness would pass `includes`).
      if (v === '' || (!cutText.includes(v) && v !== cutText)) {
        ta.value = cutText;
        return;
      }
      const done = el('span', { class: 'import-cut decided', tabindex: '0', 'data-cut': String(ci) }, v);
      done.addEventListener('click', () => focusCut(ci));
      done.addEventListener('focus', () => focusCut(ci));
      wrapper.replaceWith(done);
      editor = null;
      decide(ci, 'trim', v);
    });
  }

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!;
    const block = el('div', { class: 'import-para-block' });
    const p = el('p', { class: 'import-para' });
    let cursor = 0;
    for (const m of paraMarks[pi]!) {
      if (m.start > cursor) p.append(para.text.slice(cursor, m.start));
      const span = el(
        'span',
        { class: 'import-cut', tabindex: '0', 'data-cut': String(m.ci) },
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

  // Each cut's marginalia — facet/stance/reading — beside the paragraph where
  // the cut starts; hidden until the cut is focused.
  for (let ci = 0; ci < item.cuts.length; ci++) {
    const cut = item.cuts[ci]!;
    const note = el('span', { class: 'import-cut-note' }, `${cut.facet} · ${cut.stance} · ${cut.reading}`);
    const home = portionsByCut[ci]![0];
    if (home) blocks[home.pi]!.append(note);
    else blocks[blocks.length - 1]!.append(note);
    notes.push(note);
  }

  // A dropped region states its reason: one dimmed margin word at the
  // region's paragraph, so the silence around it is never unexplained.
  for (const mark of item.marks) {
    const pi = paragraphs.findIndex((p) => mark.at >= p.start && mark.at < p.start + p.text.length);
    const word = el('span', { class: 'import-mark' }, mark.why);
    if (pi === -1) blocks[blocks.length - 1]!.append(word);
    else blocks[pi]!.append(word);
  }

  surface.append(piece);

  /* ── the foot — the three verbs (one cluster, at the focused cut) and the save ── */

  const approveBtn = el('button', { class: 'import-verb' }, 'approve');
  const trimBtn = el('button', { class: 'import-verb' }, 'trim');
  const discardBtn = el('button', { class: 'import-verb' }, 'discard');
  verbs.append(approveBtn, trimBtn, discardBtn);

  approveBtn.addEventListener('click', () => {
    if (currentCut === null) return;
    decide(currentCut, 'approve');
  });
  discardBtn.addEventListener('click', () => {
    if (currentCut === null) return;
    decide(currentCut, 'discard');
  });
  trimBtn.addEventListener('click', () => {
    if (currentCut === null) return;
    if (editor) {
      closeEditor(); // a second click on trim cancels, as renderProposal does
      return;
    }
    openTrimEditor(currentCut);
  });

  const foot = el('div', { class: 'import-foot' });
  if (item.remaining && item.remaining > 0) {
    foot.append(
      el(
        'p',
        { class: 'import-remaining' },
        `${item.remaining} more piece${item.remaining === 1 ? '' : 's'} wait after this one.`,
      ),
    );
  }
  const save = el('button', { class: 'import-save' }, 'save this piece');
  save.disabled = true;
  save.addEventListener('click', () => {
    if (decisions.size < item.cuts.length) return;
    save.disabled = true;
    const wait = deps.beginWait(save, 'saving the piece…');
    const payload = {
      decisions: item.cuts.map((_, ci) => {
        const d = decisions.get(ci)!;
        return d.action === 'trim'
          ? { cut: ci, action: 'trim' as const, text: d.text! }
          : { cut: ci, action: d.action };
      }),
    };
    void deps
      .api(`/api/import/${item.hash}/decisions`, payload)
      .then(() => wait.done())
      .then(() => deps.navTo('import'))
      .catch((cause: unknown) => {
        save.disabled = false;
        wait.failed(cause);
      });
  });
  foot.append(verbs, save);
  surface.append(foot);
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
