/**
 * The Coach page renderer — ticket 090 T11. One page per coached Direction
 * (Q-76): a chronological log half in the person's ink, and a dimmed advice
 * margin (agent-plane prose). The document rule governs — a page of text,
 * controls only at the point of attention: the three small words beside an
 * option (take up · not this · leave it), one return box under an adopted
 * quest, one artifact form at the foot, and `retire` as one small margin
 * word. `leave it` closes the page — silence does nothing (Q-62).
 *
 * Injection, not import: `el`, `api` and `navTo` are module-private in
 * main.ts (the import-review pattern). Pure text-assembly helpers are
 * exported for the surface suite; paint stays by-use.
 */

export interface CoachOptionData {
 id: string;
 text: string;
}

export interface CoachAdviceData {
 mintedAt: string;
 unread: boolean;
 options: CoachOptionData[];
}

export interface CoachLogData {
 at: string;
 kind: string;
 sentence: string;
 quote?: string;
 questId?: string;
}

/** The wire shape of GET /api/coach/:slug (mirrors src/coach/page.ts). */
export interface CoachPageData {
 slug: string;
 name: string;
 log: CoachLogData[];
 advice: CoachAdviceData | null;
 opening: string;
}

export interface CoachDeps {
 main: HTMLElement;
 el: <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...kids: (string | Node)[]
 ) => HTMLElementTagNameMap[K];
 api: <T>(path: string, body?: unknown) => Promise<T>;
 navTo: (screen: string) => void;
}

/** The paint-ready log rows: sentence, the person's quote, and the wire
 * fields the affordances need (kind, questId) — never rendered themselves. */
export function coachLogRows(page: CoachPageData): {
 at: string;
 sentence: string;
 quote?: string;
 kind: string;
 questId?: string;
}[] {
 return page.log.map((e) => ({
  at: e.at,
  sentence: e.sentence,
  kind: e.kind,
  ...(e.quote !== undefined ? { quote: e.quote } : {}),
  ...(e.questId !== undefined ? { questId: e.questId } : {}),
 }));
}

/** The paint-ready option rows; an absent note renders no margin at all. */
export function coachOptionRows(advice: CoachAdviceData | null): CoachOptionData[] {
 return advice ? advice.options : [];
}

function paintLog(deps: CoachDeps, page: CoachPageData, rerender: () => void): void {
 deps.main.append(deps.el('h2', { class: 'coach-heading' }, page.name));
 if (page.log.length === 0) {
  deps.main.append(deps.el('p', { class: 'coach-opening' }, page.opening));
 }
 for (const row of coachLogRows(page)) {
  const line = deps.el('p', { class: 'coach-log-line' }, row.sentence);
  if (row.quote !== undefined) {
   line.append(deps.el('span', { class: 'coach-quote' }, row.quote));
  }
  // The return box and the retire word belong to the quest the row names —
  // carried on the wire, never rendered.
  if (row.kind === 'quest-adopted' && row.questId !== undefined) {
   const retire = deps.el('button', { class: 'coach-word coach-retire', type: 'button' }, 'retire');
   retire.addEventListener('click', async () => {
    await deps.api(`/api/coach/quest/${row.questId}/retire`);
    rerender();
   });
   line.append(retire, returnBox(deps, page.slug, row.questId, rerender));
  }
  deps.main.append(line);
 }
}

function returnBox(deps: CoachDeps, slug: string, questId: string, rerender: () => void): HTMLElement {
 const box = deps.el('div', { class: 'coach-return-box' });
 const textarea = deps.el('textarea', { class: 'coach-return-input', placeholder: 'your words on how it went', rows: '2' });
 const send = deps.el('button', { class: 'coach-word', type: 'button' }, 'return');
 send.addEventListener('click', async () => {
  const text = textarea.value.trim();
  if (text.length === 0) return;
  await deps.api(`/api/coach/quest/${questId}/return`, { text });
  rerender();
 });
 box.append(textarea, send);
 return box;
}

function paintMargin(deps: CoachDeps, page: CoachPageData, rerender: () => void): void {
 if (!page.advice) return;
 const margin = deps.el('aside', { class: 'coach-margin' });
 margin.append(deps.el('h3', { class: 'coach-margin-label' }, 'a note'));
 for (const option of coachOptionRows(page.advice)) {
  const row = deps.el('div', { class: 'coach-option' });
  row.append(deps.el('p', { class: 'coach-option-text' }, option.text));
  const takeUp = deps.el('button', { class: 'coach-word', type: 'button' }, 'take up');
  const notThis = deps.el('button', { class: 'coach-word', type: 'button' }, 'not this');
  const leaveIt = deps.el('button', { class: 'coach-word', type: 'button' }, 'leave it');
  takeUp.addEventListener('click', async () => {
   await deps.api(`/api/coach/${page.slug}/adopt`, { optionId: option.id });
   rerender();
  });
  notThis.addEventListener('click', async () => {
   await deps.api(`/api/coach/${page.slug}/decline-option`, { optionId: option.id });
   rerender();
  });
  leaveIt.addEventListener('click', () => deps.navTo('waiting'));
  row.append(takeUp, notThis, leaveIt);
  margin.append(row);
 }
 deps.main.append(margin);
}

function paintArtifactForm(deps: CoachDeps, slug: string, rerender: () => void): void {
 const form = deps.el('div', { class: 'coach-artifact-form' });
 form.append(deps.el('h3', { class: 'coach-margin-label' }, 'an artifact'));
 const pointer = deps.el('input', { class: 'coach-artifact-field', type: 'text', placeholder: 'where it lives' });
 const name = deps.el('input', { class: 'coach-artifact-field', type: 'text', placeholder: 'the name you give it' });
 const sentence = deps.el('input', { class: 'coach-artifact-field', type: 'text', placeholder: 'one sentence about it' });
 const declare = deps.el('button', { class: 'coach-word', type: 'button' }, 'declare');
 declare.addEventListener('click', async () => {
  if (pointer.value.trim() === '' || name.value.trim() === '' || sentence.value.trim() === '') return;
  await deps.api(`/api/coach/${slug}/artifact`, {
   pointer: pointer.value.trim(),
   name: name.value.trim(),
   sentence: sentence.value.trim(),
  });
  rerender();
 });
 form.append(pointer, name, sentence, declare);
 deps.main.append(form);
}

/**
 * Render the Coach page for one slug. The paint happens first — reading a
 * page is not an act — then POST /read marks the visit and lets
 * page-opened license a fresh mint in the background (Q-77). A 404 means
 * the lens is off (Q-73): the waiting surface takes over quietly.
 */
export function renderCoachPage(deps: CoachDeps, slug: string): void {
 let cancelled = false;
 const rerender = (): void => {
  if (cancelled) return;
  deps.main.textContent = '';
  renderCoachPage(deps, slug);
 };
 deps.api<CoachPageData>(`/api/coach/${slug}`)
  .then((page) => {
   if (cancelled) return;
   paintLog(deps, page, rerender);
   paintMargin(deps, page, rerender);
   paintArtifactForm(deps, page.slug, rerender);
   // The read is an act; the paint is not.
   deps.api(`/api/coach/${slug}/read`).catch(() => { /* not load-bearing */ });
  })
  .catch(() => {
   if (cancelled) return;
   deps.navTo('waiting');
  });
}
