/**
 * The map, and the two things a region declares (plan Task 13).
 *
 * The map is a folder read as a shape: one line per node — counts, never a
 * per-file list (a list of 5,000 files is the shape Q-24 refuses) — with a
 * fully-harvested node dimmed rather than hidden, because "already in" is
 * the information the map exists to carry.
 *
 * Clicking a node opens the declaration inline, nothing modal: how are these
 * dated, and who wrote them. Save stays disabled until both are answered —
 * a default here is a silent assertion about the person (Q-67). The honest
 * feedback (how many files the rule matches and refuses) arrives with the
 * declaration's own scan, named by file; this repo has no preview-without-
 * admit endpoint, and re-declaring is idempotent (last-write-wins).
 *
 * Injection, not import: `el`, `api` and `navTo` are module-private in
 * main.ts, and that file is contended. The seam is one object literal at the
 * call site. The pure seams below (mapLines, canSave, AUTHORSHIP_CHOICES,
 * declareFlow) are what the test file exercises — this repo has no DOM test
 * environment, so the tree text and the enablement rule are computed by pure
 * functions and everything visual is verified by use.
 */

import type { SurveyNode } from '../src/import/survey.js';

export type SurveyMapDeps = {
  main: HTMLElement;
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string>,
    ...kids: (string | Node)[]
  ) => HTMLElementTagNameMap[K];
  api: <T>(path: string, body?: unknown) => Promise<T>;
  navTo: (screen: string, opts?: { focus?: string }) => void;
  folder: string;
  /** A node path to open the map at, scrolled to and expanded. */
  focus?: string;
};

/** The slice of a survey the map reads: the root and its nodes. */
type SurveyShape = { root: string; nodes: SurveyNode[] };

/** `POST /api/import/scan` — counts, and every file that did not come in. */
type ScanResponse = {
  pending: number;
  refused: { file: string; reason: string }[];
  skipped: number;
  adopted: number;
};

/** What a region declares: how the files carry dates, and who wrote them. */
export type DeclareInput = {
  folder: string;
  dating: { kind: 'frontmatter'; key: string } | { kind: 'filename'; pattern: string };
  authorship: 'authored' | 'other' | 'machine-assisted';
};

/** The three authorship answers, in the person's words — no preselection. */
export const AUTHORSHIP_CHOICES: string[] = ['I did', 'someone else', 'written with a model'];

/** A choice in the person's words, mapped to the record's vocabulary. */
const AUTHORSHIP_VALUES: Record<string, 'authored' | 'other' | 'machine-assisted'> = {
  'I did': 'authored',
  'someone else': 'other',
  'written with a model': 'machine-assisted',
};

/**
 * The slug the last declaration produced, handed to the review once and then
 * cleared — take-then-clear, the same shape import-entry.ts uses for its
 * lastScan memory. The review opened from a declared region stays inside it
 * (Q-68's bound); absent a declaration, the review behaves as 058 built it.
 */
let lastDeclaredRegion: string | null = null;

/** Take the declared region slug, or null when none is pending. */
export function takeDeclaredRegion(): string | null {
  const slug = lastDeclaredRegion;
  lastDeclaredRegion = null;
  return slug;
}

/** Nodes in the tree's own order: paths ascending. */
function sortedNodes(survey: SurveyShape): SurveyNode[] {
  return survey.nodes.slice().sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The map as text: one line per node, indented by depth (two spaces per
 * level), totals in the interface's register — and never a per-file list at
 * any depth. A node with nothing unread carries the `done` marker; the DOM
 * renderer dims those rows rather than hiding them.
 */
export function mapLines(survey: SurveyShape): string[] {
  return sortedNodes(survey).map((n) => {
    const indent = '  '.repeat(Math.max(0, n.path.split('/').length - 1));
    const name = `${indent}${n.path === '' ? '<root>' : n.path}`.padEnd(40);
    const t = n.total;
    let line = `${name}${t.files} notes · ${t.harvested} in · ${t.unread} unread`;
    if (t.refused > 0) line += ` · ${t.refused} refused`;
    if (t.unread === 0) line += ' · done';
    return line;
  });
}

/** Save stays disabled until both declarations are answered. */
export function canSave(declaration: { dating: boolean; authorship: boolean }): boolean {
  return declaration.dating && declaration.authorship;
}

/**
 * The declaration's request sequence: POST the region, then POST the scan
 * with the slug it returned. The scan's refused list is the honest feedback
 * — named files, the same list the manifest reads — and because region
 * declaration is idempotent, changing the rule and re-declaring shows the
 * new consequence.
 */
export async function declareFlow(
  api: <T>(path: string, body?: unknown) => Promise<T>,
  input: DeclareInput,
): Promise<{ slug: string; scan: ScanResponse }> {
  const { slug } = await api<{ slug: string }>('/api/import/region', {
    root: input.folder,
    dating: input.dating,
    authorship: input.authorship,
  });
  const scan = await api<ScanResponse>('/api/import/scan', {
    folder: input.folder,
    region: slug,
  });
  return { slug, scan };
}

/**
 * Renders the map into `main` (a dedicated container the caller owns, so
 * each render replaces only the previous map surface). An empty folder shows
 * one hint line and fetches nothing; otherwise the survey is fetched for the
 * folder and the tree rendered when it arrives. A later render supersedes an
 * in-flight one, so rapid typing never lets a stale folder's map clobber the
 * one the person is looking at.
 */
export function renderSurveyMap(deps: SurveyMapDeps): void {
  const { main, el, folder } = deps;
  main.replaceChildren();

  if (folder === '') {
    main.append(el('p', { class: 'survey-hint' }, 'type a folder path to see its map'));
    return;
  }

  const seq = ++renderSeq;
  main.append(el('p', { class: 'survey-hint' }, 'reading the folder…'));
  void deps
    .api<{ survey: SurveyShape }>(`/api/import/survey?folder=${encodeURIComponent(folder)}`)
    .then((res) => {
      if (seq !== renderSeq) return;
      main.replaceChildren();
      renderTree(main, res.survey, deps);
    })
    .catch(() => {
      if (seq !== renderSeq) return;
      main.replaceChildren();
      main.append(el('p', { class: 'survey-hint' }, 'could not read that folder'));
    });
}

/** Guards the map against stale survey responses while the folder is typed. */
let renderSeq = 0;

/**
 * The tree: one element per mapLines line, collapsed to depth two by
 * default. Clicking a node toggles it expanded — which shows its direct
 * counts line, reveals its children, and opens the declaration beneath the
 * line, nothing modal.
 */
function renderTree(surface: HTMLElement, survey: SurveyShape, deps: SurveyMapDeps): void {
  const { el } = deps;
  const nodes = sortedNodes(survey);
  const expanded = new Set<string>();
  const rowByPath = new Map<string, HTMLElement>();
  const panelByPath = new Map<string, HTMLElement>();

  // A node is visible when it is within the default two levels or one of its
  // ancestors is expanded — the tree opens a level at a time.
  const isVisible = (path: string): boolean => {
    if (path === '') return true;
    if (path.split('/').length <= 2) return true;
    const parent = path.slice(0, path.lastIndexOf('/'));
    return expanded.has(parent) && isVisible(parent);
  };

  const sync = (): void => {
    for (const n of nodes) {
      const row = rowByPath.get(n.path)!;
      const visible = isVisible(n.path);
      row.classList.toggle('survey-hidden', !visible);
      const panel = panelByPath.get(n.path);
      if (visible && expanded.has(n.path)) {
        if (!panel) {
          const p = buildPanel(n, deps, sync);
          panelByPath.set(n.path, p);
          row.after(p);
        }
      } else if (panel) {
        panel.remove();
        panelByPath.delete(n.path);
      }
    }
  };

  const lines = mapLines(survey);
  for (let i = 0; i < lines.length; i++) {
    const n = nodes[i]!;
    const row = el(
      'div',
      {
        class: n.total.unread === 0 ? 'survey-node node-done' : 'survey-node',
        'data-path': n.path,
      },
      lines[i]!,
    );
    row.addEventListener('click', () => {
      if (expanded.has(n.path)) expanded.delete(n.path);
      else expanded.add(n.path);
      sync();
    });
    rowByPath.set(n.path, row);
    surface.append(row);
  }

  if (deps.focus !== undefined) {
    const row = rowByPath.get(deps.focus);
    if (row) {
      expanded.add(deps.focus);
      row.scrollIntoView({ block: 'center' });
    }
  }
  sync();
}

/** The declaration: the direct-counts line, the two questions, and save. */
function buildPanel(
  n: SurveyNode,
  deps: SurveyMapDeps,
  sync: () => void,
): HTMLElement {
  const { el } = deps;
  const panel = el('div', { class: 'survey-declare' });

  // What is in THIS folder, not its descendants — the map line above shows
  // totals, so the expanded state states the direct counts.
  panel.append(el('p', { class: 'survey-direct' }, directSentence(n)));

  panel.append(el('p', { class: 'survey-q' }, 'how are these dated?'));
  const dating = el('div', { class: 'survey-dating' });
  const kind = el('select', { class: 'survey-kind' });
  kind.append(el('option', { value: 'frontmatter' }, 'frontmatter'));
  kind.append(el('option', { value: 'filename' }, 'filename'));
  kind.value = 'filename';
  const keyField = el('input', {
    class: 'survey-dating-field',
    type: 'text',
    placeholder: 'key',
  });
  keyField.hidden = true;
  const patternField = el('input', {
    class: 'survey-dating-field',
    type: 'text',
    value: 'YYYY-MM-DD',
  });
  dating.append(el('span', {}, 'dated by'), kind, keyField, patternField);
  panel.append(dating);

  panel.append(el('p', { class: 'survey-q' }, 'who wrote these?'));
  const authorship = el('div', { class: 'survey-authorship' });
  const radios: HTMLInputElement[] = [];
  const consequence = el(
    'p',
    { class: 'survey-consequence', hidden: '' },
    'kept words are evidence of keeping them — these will not be filed as things you avow.',
  );
  for (const choice of AUTHORSHIP_CHOICES) {
    const label = el('label', { class: 'survey-author' });
    const radio = el('input', {
      type: 'radio',
      name: 'survey-authorship',
      class: 'survey-author-radio',
    });
    radio.value = choice;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      consequence.hidden = choice === 'I did';
      updateSave();
    });
    radios.push(radio);
    label.append(radio, el('span', {}, choice));
    authorship.append(label);
  }
  panel.append(authorship, consequence);

  const save = el('button', { class: 'import-save survey-save' }, 'declare this region');
  save.disabled = true;

  const updateSave = (): void => {
    const datingAnswered =
      kind.value === 'filename' ? patternField.value.trim() !== '' : keyField.value.trim() !== '';
    const answered = radios.some((r) => r.checked);
    save.disabled = !canSave({ dating: datingAnswered, authorship: answered });
  };
  kind.addEventListener('change', () => {
    const filename = kind.value === 'filename';
    patternField.hidden = !filename;
    keyField.hidden = filename;
    updateSave();
  });
  patternField.addEventListener('input', updateSave);
  keyField.addEventListener('input', updateSave);

  const feedback = el('div', { class: 'survey-result' });
  const start = el(
    'button',
    { class: 'import-save survey-start', hidden: '' },
    'start reading',
  );
  start.addEventListener('click', () => deps.navTo('import'));
  panel.append(save, feedback, start);

  save.addEventListener('click', () => {
    if (save.disabled) return;
    const choice = radios.find((r) => r.checked)?.value ?? null;
    if (choice === null) return;
    save.disabled = true;
    save.textContent = 'declaring…';
    const dating =
      kind.value === 'filename'
        ? { kind: 'filename' as const, pattern: patternField.value.trim() }
        : { kind: 'frontmatter' as const, key: keyField.value.trim() };
    void declareFlow(deps.api, {
      folder: deps.folder,
      dating,
      authorship: AUTHORSHIP_VALUES[choice] ?? 'authored',
    })
      .then(({ slug, scan }) => {
        lastDeclaredRegion = slug;
        save.textContent = 'declared — the map is now honest';
        start.hidden = false;
        feedback.replaceChildren(...feedbackFor(scan, el));
      })
      .catch(() => {
        save.disabled = false;
        save.textContent = 'declare this region';
        feedback.replaceChildren(
          el('p', { class: 'survey-refused' }, 'the declaration did not save — try again'),
        );
      });
  });

  return panel;
}

/** The direct-counts line, in the same register as the map. */
function directSentence(n: SurveyNode): string {
  let s = `directly: ${n.files} notes · ${n.harvested} in · ${n.unread} unread`;
  if (n.refused > 0) s += ` · ${n.refused} refused`;
  return s;
}

/** The honest feedback: how many files matched, and every refusal by name. */
function feedbackFor(scan: ScanResponse, el: SurveyMapDeps['el']): (string | Node)[] {
  const total = scan.pending + scan.skipped + scan.adopted + scan.refused.length;
  const out: (string | Node)[] = [
    el(
      'p',
      { class: 'survey-feedback' },
      `${total - scan.refused.length} files match the rule · ${scan.refused.length} refused`,
    ),
  ];
  for (const r of scan.refused) out.push(el('p', { class: 'survey-refused' }, r.file));
  return out;
}
