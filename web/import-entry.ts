/**
 * The way in, and the way back in (plan Task 11).
 *
 * The way IN is a folder prompt and a manifest read as sentences — counts
 * first, then each refused file NAMED with its reason, because a refusal the
 * reader never sees is a silent loss. The way BACK IN is resume-first: an
 * import runs across weeks and the browser may close at any point, so
 * entering this screen asks for the next piece before anything else and
 * hands a ready one straight to the review surface.
 *
 * The surface is sentences, not a dashboard. The only control beyond the
 * folder prompt is `start reading`, which re-enters the screen and lets
 * resume-first decide what the reader meets.
 *
 * Injection, not import: `el`, `api` and `beginWait` are module-private in
 * main.ts, and main.ts is edited concurrently by another agent. The seam is
 * one object literal at the call site — exactly the shape web/import-review.ts
 * already takes.
 */

import { renderImportReview } from './import-review.js';
import type { ScanResponse } from './deps.js';
import { renderSurveyMap, takeDeclaredRegion } from './survey-map.js';
import type { ImportReviewDeps, ImportReviewItem } from './import-review.js';

/** The entry surface takes exactly the same seam as the review surface. */
export type ImportEntryDeps = ImportReviewDeps;

/** `GET /api/import/next` — the next piece, or the sentence that says why not. */
type NextResponse = { item: ImportReviewItem | null; waiting?: string };

/** One sentence per refusal reason — the file stays named (Q-57). */
const REFUSED: Record<string, string> = {
  'no-date': 'has no date in its frontmatter — not imported',
  'empty-body': 'is frontmatter and nothing else — not imported',
  'no-frontmatter': 'has no frontmatter — not imported',
  'unparsable-date': 'has a date that could not be read — not imported',
  'no-lastmod':
    'changed since it was imported, and has no lastmod to date the new version — not imported',
};

/**
 * What the last scan admitted. The route cannot tell "still being read" from
 * "never scanned" — both answer `no pieces are ready to read yet` — so this
 * screen keeps its own memory of whether a scan has happened.
 */
let lastScan: { pending: number } | null = null;

export function renderImportEntry(deps: ImportEntryDeps): void {
  const { main, api, beginWait } = deps;
  // Resume-first: a browser may close mid-import, and the entry point must
  // put the reader back at the next unread piece. The review renders itself.
  const wait = beginWait(main, 'looking for a piece to review…');
  void api<NextResponse>('/api/import/next')
    .then((res) => {
      wait.done();
      if (res.item) {
        // A review opened from a declared region stays inside it (Q-68's
        // bound): the slug is taken once, then cleared. Without one — the
        // 19 adopted posts, or a plain folder scan — the parameter is
        // omitted (exactOptionalPropertyTypes: no present-undefined).
        const region = takeDeclaredRegion();
        renderImportReview(region ? { ...deps, region } : deps);
        return;
      }
      renderEntry(deps, res.waiting);
    })
    .catch((cause) => wait.failed(cause));
}

/** The entry surface: the waiting sentence, and the way in. */
function renderEntry(deps: ImportEntryDeps, waiting?: string): void {
  const { main, el, api, navTo } = deps;
  main.replaceChildren();

  const surface = el('div', { class: 'screen active import-review' });

  if (waiting) {
    surface.append(el('p', { class: 'import-step' }, '3 \u00b7 reading'));
    surface.append(el('p', { class: 'import-waiting' }, waiting));
    const advice = adviceFor(waiting);
    if (advice) {
      surface.append(
        el(
          'p',
          { style: 'color: var(--dim); font-size: 0.8rem; font-family: var(--font-ui); margin: 0' },
          advice,
        ),
      );
    }
  }

  surface.append(el('p', { class: 'import-step' }, '1 \u00b7 the folder'));

  // The folder prompt — one line in the mode idiom, no file picker (Q-57:
  // the app never opens a socket, and a picker adds nothing a path does not).
  const prompt = el('p', {
    style: 'display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin: 0',
  });
  prompt.append(el('span', {}, 'the folder:'));
  const folderInput = el('input', {
    class: 'mode-select',
    type: 'text',
    placeholder: '/absolute/path/to/the/folder',
    style: 'min-width: 16rem',
  });
  // The reach offer's landing (014 T14): the survey root it named is the
  // folder to open — the map needs it to render the offered region.
  if (deps.folder !== undefined) folderInput.value = deps.folder;
  const scanBtn = el('button', { class: 'submit-btn' }, 'scan this folder');
  prompt.append(folderInput, scanBtn);
  surface.append(prompt);

  const slot = el('div');
  surface.append(slot);

  // The map (Task 13): the folder as a shape, below the prompt, live. It
  // gets its own container, so each render replaces only the previous map
  // surface; the entry's navTo takes no focus, and Task 14's offer line
  // widens main.ts's own function instead of this bridge.
  const mapSlot = el('div', { class: 'survey-map' });
  surface.append(mapSlot);

  const renderMap = (): void => {
    renderSurveyMap({
      main: mapSlot,
      el,
      api,
      navTo: (s) => navTo(s),
      folder: folderInput.value.trim(),
      // The reach offer's focus (014 T14): open the map at the region it
      // named, expanded and scrolled to. Absent on a plain visit.
      ...(deps.focus !== undefined ? { focus: deps.focus } : {}),
      // The map inherits the core's text/document verbs through the seam.
      text: deps.text,
      document: deps.document,
    });
  };
  renderMap();
  folderInput.addEventListener('input', renderMap);

  main.append(surface);
  folderInput.focus();

  scanBtn.addEventListener('click', () => {
    void scan(deps, folderInput, scanBtn, slot, surface);
  });
  folderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') scanBtn.click();
  });
}

async function scan(
  deps: ImportEntryDeps,
  input: HTMLInputElement,
  btn: HTMLButtonElement,
  slot: HTMLElement,
  surface: HTMLElement,
): Promise<void> {
  const { api, beginWait } = deps;
  const folder = input.value.trim();
  if (!folder) {
    input.focus();
    return;
  }
  btn.disabled = true;
  const wait = beginWait(slot, 'scanning…');
  try {
    const res = await api<ScanResponse>('/api/import/scan', { folder });
    wait.done();
    lastScan = { pending: res.pending };
    appendManifest(surface, deps, res);
    btn.disabled = false;
  } catch (cause) {
    // A bad folder path throws; the waiting affordance says so, and the
    // prompt stays put so the path can be corrected. The sentence names the
    // folder the scan choked on (ticket 154) — never the generic line.
    wait.failed(cause, `could not read ${chokedFolder(cause, folder)}`);
    btn.disabled = false;
  }
}

/** The manifest, as prose: counts, refusals named, and what happens next. */
function appendManifest(surface: HTMLElement, deps: ImportEntryDeps, res: ScanResponse): void {
  const { el, navTo } = deps;
  const counts = el('p', {}, countsSentence(res));
  const refusals = res.refused.map((r) =>
    el('p', { style: 'color: var(--dim); margin: 0' }, `${r.file} ${REFUSED[r.reason] ?? 'was not imported'}`),
  );
  const next = el(
    'p',
    { class: 'import-waiting' },
    'reading them takes a while; you can close this and come back.',
  );
  const start = el('button', { class: 'import-save' }, 'start reading');
  start.addEventListener('click', () => navTo('import'));

  surface.append(el('p', { class: 'import-step' }, '2 \u00b7 what the scan found'));

  const manifest = el('div', { style: 'display: flex; flex-direction: column; gap: 0.4rem' });
  manifest.append(counts, ...refusals, next, start);
  surface.append(manifest);
}

/** Counts as one sentence — the same shape the log speaks (`import-scanned`). */
function countsSentence(res: ScanResponse): string {
  const refused = res.refused.length;
  const total = res.pending + res.skipped + res.adopted + refused;
  let sentence = `read ${total} files: ${res.pending} to import, ${refused} refused`;
  const extras: string[] = [];
  if (res.skipped > 0) extras.push(`${res.skipped} already known`);
  if (res.adopted > 0) extras.push(`${res.adopted} already imported before`);
  if (extras.length > 0) sentence += ` — ${extras.join(', ')}`;
  return sentence;
}

/**
 * The folder the scan choked on, from the server's relayed error — the
 * fallback is the folder the person asked for, so the error sentence always
 * names a folder (ticket 154). The server names the directory it could not
 * read ("cannot read folder /path: EACCES: …"); the request folder covers
 * every other failure. Pure, so it is tested without a DOM.
 */
export function chokedFolder(cause: unknown, asked: string): string {
 const msg = cause instanceof Error ? cause.message : String(cause);
 const m = /cannot read folder ([^:]+)/.exec(msg);
 return m?.[1] ?? asked;
}

/** One line on what to do, only when the waiting sentence has a next step. */
function adviceFor(waiting: string): string | null {
  // The stale case: the next piece changed on disk since it was read. A
  // rescan re-admits the new body as a new piece (Q-59) — the prompt below
  // is where that happens.
  if (waiting.includes('changed on disk')) {
    return 'scan the folder again — the changed file comes in as a new piece.';
  }
  // The no-pieces case: nothing extracted yet. Whether to wait or to start
  // depends on whether a scan has ever run.
  if (waiting.includes('no pieces')) {
    return lastScan === null
      ? 'nothing has been scanned yet — scan a folder to start.'
      : `${lastScan.pending} ${lastScan.pending === 1 ? 'piece is' : 'pieces are'} still being read; you can close this and come back.`;
  }
  return null;
}
