/**
 * Two screens, both pages of text (docs/interface-references.md's document
 * rule): `material`, choosing what a Piece is made of, and `piece`, the
 * Piece itself — the arrangement is the page. Nothing here is both draggable
 * and text-editable: a pinned Snippet version is immutable ink (Q-5) and
 * renders as a paragraph you can pick up, and the one editable thing, the
 * trailing composer, becomes a pin the moment its words are set down.
 *
 * Injection, not import: `el`, `api`, `navTo` and the rest are module-private
 * in main.ts (the import-review pattern). The piece's own "which piece is
 * current" state lives here too — the material screen hands it over with
 * setCurrentPieceId before navigating, and renderPiece takes it back. The
 * material screen (wave C) joins init-wired: its deps arrive via
 * initMaterial at boot — the territory pattern — and the router calls
 * renderMaterial() bare.
 */
import { ulid } from 'ulid';
import type { Snippet } from '../src/types.ts';
import type { WebDepsCore, WebDepsShell, WebDepsWithWait } from './deps.js';
import type { DictationOpts } from './dictation.js';
import { readableDate } from './dates.js';
import { showQuietError, WAIT_FAILED } from './wait.js';

export interface PieceDeps extends WebDepsShell {
 /** The dictation wiring, shared with the exchange and mode surfaces (web/dictation.ts). */
 wireDictation: (opts: DictationOpts) => void;
}

/** The Piece being read, set by the material screen before navigation. */
let currentPieceId: string | null = null;
/** The entry being dragged; cleared on dragend so a cancelled drag reorders nothing. */
let dragEntryId: string | null = null;

/** Hand the Piece the material screen chose to the piece screen (before navTo('piece')). */
export function setCurrentPieceId(id: string): void {
 currentPieceId = id;
}

interface PiecePinEntry {
 id: string;
 kind: 'pin';
 prose: string | null;
}
interface PieceGapEntry {
 id: string;
 kind: 'gap';
 question: string | null;
 offers: Snippet[];
}
interface PieceMarginalium {
 on: string | null;
 note: string;
 text: string;
}
interface PieceArrangement {
 id: string;
 principle: string;
 entries: (PiecePinEntry | PieceGapEntry)[];
 marginalia: PieceMarginalium[];
}
export interface PieceEnriched {
 id: string;
 current: string;
 setDownAt: string | null;
 arrangements: PieceArrangement[];
}
export interface PieceLite {
 id: string;
 created: string;
 arrangement: PieceArrangement | null;
}

/* ── the piece screen: the arrangement is the page ── */

export function renderPiece(deps: PieceDeps): void {
 deps.clear();
 deps.setScreen('piece');
 const id = currentPieceId;
 if (id === null) {
  deps.navTo('material');
  return;
 }
 deps.renderShell();
 // An explicit string binding: function declarations below do not inherit
 // the narrowing of `id` (only arrow closures do), so name it once, plainly.
 const pieceId: string = id;
 // The arrangement being viewed: a candidate the person switched to, or the
 // current one. Viewing never chooses (Q-38); `keep this order` does.
 let viewedArrangementId: string | null = null;
 // The trailing seam of the arrangement under the eye, for the toolbar's
 // add-question word; null until the page has painted a seam.
 let seamRef: { seam: HTMLElement; aid: string; after: string | undefined } | null = null;

 const div = deps.el('div', { class: 'screen active piece-surface' });

 const nav = deps.el('div', { class: 'piece-toolbar' });
 const navLeft = deps.el('div', { class: 'piece-toolbar-left' });
 const navCenter = deps.el('div', { class: 'piece-toolbar-center' });
 const navRight = deps.el('div', { class: 'piece-toolbar-right' });
 const backBtn = deps.el('button', { class: 'nav-link' }, '\u2190 library');
 backBtn.addEventListener('click', () => deps.navTo('material'));
 // Pass 2's margin words (Q-38): `other orders?` requests the
 // acceptance-time generation and hides once the piece holds its bound of
 // three; the principle names switch the view between candidates; `keep
 // this order` takes a viewed candidate that is not current. All plain
 // words in the margin, never a row of tabs.
 const otherOrders = deps.el('button', { class: 'nav-link' }, 'other orders?');
 const keepOrder = deps.el('button', { class: 'nav-link' }, 'keep this order');
 const ordersSwitcher = deps.el('span', { class: 'piece-orders' });
 // Margin words, dimmed until the page is focused: set down (or pick up,
 // when the Piece is set down), export, and the seam's add-question word.
 // Q-41's verbs, never a flag.
 const setDown = deps.el('button', { class: 'nav-link' }, 'set down');
 const pickUp = deps.el('button', { class: 'nav-link' }, 'pick up');
 const exportBtn = deps.el('button', { class: 'nav-link' }, 'export');
 const addQuestion = deps.el('button', { class: 'nav-link' }, 'add question');
 addQuestion.addEventListener('click', () => {
  if (seamRef === null) return;
  seamRef.seam.scrollIntoView({ behavior: 'smooth' });
  openGapEditor(seamRef.seam, seamRef.aid, ulid(), seamRef.after);
 });
 navLeft.append(backBtn);
 navCenter.append(otherOrders, ' \u00b7 ', ordersSwitcher, ' \u00b7 ', keepOrder);
 navRight.append(addQuestion, ' \u00b7 ', exportBtn, ' \u00b7 ', setDown, ' \u00b7 ', pickUp);
 nav.append(navLeft, navCenter, navRight);
 div.append(nav);

 const doc = deps.el('div', { class: 'piece-doc' });
 div.append(doc);
 deps.main.append(div);

 setDown.addEventListener('click', () => {
  deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/set-down`)
   .then(refresh)
   .catch((e: unknown) => console.error(e));
 });
 pickUp.addEventListener('click', () => {
  deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/pick-up`)
   .then(refresh)
   .catch((e: unknown) => console.error(e));
 });
 exportBtn.addEventListener('click', () => {
  void (async () => {
   try {
    const res = await deps.api<Response>(`/api/piece/${encodeURIComponent(pieceId)}/export`, undefined, { raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = deps.el('a', { href: url, download: `piece-${pieceId}.md` });
    deps.document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
   } catch (e) {
    console.error(e);
   }
  })();
 });
 otherOrders.addEventListener('click', () => {
  // The acceptance-time generation is slow by design (Q-38): the waiting
  // line speaks before the request goes out.
  const wait = deps.beginWait(doc, 'asking for other orders\u2026');
  deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/arrangements`)
   .then((piece) => {
    wait.done();
    paint(piece);
   })
   .catch((e: unknown) => wait.failed(e));
 });
 keepOrder.addEventListener('click', () => {
  const viewedId = viewedArrangementId;
  if (viewedId === null) return;
  deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/choose`, { arrangement: viewedId })
   .then((piece) => {
    paint(piece);
   })
   .catch((e: unknown) => console.error(e));
 });

 async function refresh(): Promise<void> {
  try {
   const piece = await deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}`);
   paint(piece);
  } catch (e) {
   showQuietError(doc, 'the piece did not come through \u2014 try again');
  }
 }

 function paint(piece: PieceEnriched) {
  doc.innerHTML = '';
  // The view: the arrangement the person last asked for, else the current
  // one. A candidate is never chosen by viewing it (Q-38).
  const arrangement =
   piece.arrangements.find((a) => a.id === viewedArrangementId) ??
   piece.arrangements.find((a) => a.id === piece.current) ??
   piece.arrangements[0] ??
   null;
  if (arrangement === null) return;
  viewedArrangementId = arrangement.id;

  const isDown = piece.setDownAt !== null;
  setDown.style.display = isDown ? 'none' : '';
  pickUp.style.display = isDown ? '' : 'none';

  // The margin words, restated for this piece: `other orders?` is the
  // request for candidates and hides once the piece holds its bound of
  // three (Q-38); the principle names switch the view; `keep this order`
  // offers the choice when the viewed arrangement is not current.
  otherOrders.style.display = piece.arrangements.length >= 3 ? 'none' : '';
  ordersSwitcher.innerHTML = '';
  for (let i = 0; i < piece.arrangements.length; i++) {
   const candidate = piece.arrangements[i]!;
   if (i > 0) ordersSwitcher.append(' \u00b7 ');
   const word = deps.el('button', { class: 'nav-link' }, candidate.principle);
   word.addEventListener('click', () => {
    viewedArrangementId = candidate.id;
    void refresh();
   });
   ordersSwitcher.append(word);
  }
  keepOrder.style.display = arrangement.id === piece.current ? 'none' : '';

  const entryIds = arrangement.entries.map((e) => e.id);

  // Viewing a candidate never chooses it (Q-38): the dimmed line says the
  // order under the eye is not the standing one, and names the word that
  // would make it so.
  if (arrangement.id !== piece.current) {
   doc.append(
    deps.el(
     'p',
     { class: 'piece-candidate-line' },
     'viewing a candidate order \u2014 "keep this order" makes it the one that stands',
    ),
   );
  }

  for (const entry of arrangement.entries) {
   if (entry.kind === 'pin') {
    // The paragraph itself is the drag target, with a dimmed handle glyph
    // that appears on hover. A pinned version is immutable, so there is no
    // text editing to fight the drag (Q-5).
    const para = deps.el('p', { class: 'piece-para', draggable: 'true' }, entry.prose ?? '');
    para.dataset.entry = entry.id;
    para.prepend(deps.el('span', { class: 'piece-handle' }, '\u283f'));
    para.addEventListener('dragstart', (ev) => {
     dragEntryId = entry.id;
     if (ev.dataTransfer) {
      ev.dataTransfer.setData('text/plain', entry.id);
      ev.dataTransfer.effectAllowed = 'move';
     }
    });
    para.addEventListener('dragend', () => { dragEntryId = null; });
    para.addEventListener('dragover', (ev) => {
     ev.preventDefault();
     if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    });
    para.addEventListener('drop', (ev) => {
     ev.preventDefault();
     void reorderTo(entry.id, entryIds, arrangement.id);
    });
    doc.append(para);
   } else {
    // A gap is a thin rule across the measure carrying the question it was
    // minted with — a box would be the admin panel returning. A minted gap
    // is a marker, never an editor (Q-39): no pointer, no hover; only the
    // trailing seam opens a line. When the question is withheld (a set-down
    // Piece) the rule says so instead of pretending to ask.
    const gap = deps.el('div', { class: 'piece-gap piece-gap-inert' });
    gap.dataset.entry = entry.id;
    const rule = deps.el('div', { class: 'piece-gap-rule' });
    rule.append(
     deps.el('span', { class: 'piece-gap-question' }, entry.question ?? 'waiting for its question'),
    );
    gap.append(rule);
    // An answered gap carries its offer in the margin: the harvested
    // sentence, dimmed, beside the rule. Nothing renders when the join is
    // empty, and nothing is ever placed without the person's touch (Q-39).
    if (entry.offers.length > 0) {
     for (const offer of entry.offers) {
      const o = deps.el('button', { class: 'piece-offer' }, offer.prose);
      o.addEventListener('click', () => {
       void (async () => {
        try {
         await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/gap/accept`, {
          arrangement: arrangement.id,
          gap: entry.id,
          snippet: offer.id,
          version: offer.version,
         });
        } catch (e) {
         console.error(e);
         showQuietError(doc, WAIT_FAILED);
        }
        await refresh();
       })();
      });
      gap.append(o);
     }
    }
    // A paragraph can land past a gap; the gap is a drop target like any
    // other entry.
    gap.addEventListener('dragover', (ev) => {
     ev.preventDefault();
     if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    });
    gap.addEventListener('drop', (ev) => {
     ev.preventDefault();
     void reorderTo(entry.id, entryIds, arrangement.id);
    });
    doc.append(gap);
   }
  }

  // The trailing seam: one thin rule at the end of the column, the insert
  // point for a new gap. Touching it opens a line; Enter mints the gap with
  // a client-minted id and the entry it follows (the last one). A new gap
  // lands at the end, and the paragraph drag places it anywhere.
  const seam = deps.el('div', { class: 'piece-gap' });
  seamRef = { seam, aid: arrangement.id, after: entryIds.length > 0 ? entryIds[entryIds.length - 1]! : undefined };
  const seamRule = deps.el('div', { class: 'piece-gap-rule' });
  seamRule.append(deps.el('span', { class: 'piece-gap-ask' }, 'ask me?'));
  seam.append(seamRule);
  seamRule.addEventListener('click', () => {
   openGapEditor(seam, arrangement.id, ulid(), entryIds.length > 0 ? entryIds[entryIds.length - 1]! : undefined);
  });
  seam.addEventListener('dragover', (ev) => {
   ev.preventDefault();
   if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  });
  seam.addEventListener('drop', (ev) => {
   ev.preventDefault();
   void reorderToEnd(entryIds, arrangement.id);
  });
  doc.append(seam);

  // Skeleton Marginalia sit in the margin column, dimmed until hovered:
  // the principle sentence first, then each role phrase beside its
  // paragraph, then any stale-pin flag. A stale-pin flag is a note, never
  // a control — there is nothing to click (Q-39).
  const marginalia = deps.el('div', { class: 'piece-marginalia' });
  const notes = [...arrangement.marginalia].sort((a, b) => {
   const rank = (m: PieceMarginalium): number => {
    if (m.note === 'principle') return 0;
    if (m.note === 'role') {
     const at = entryIds.indexOf(m.on ?? '');
     return at === -1 ? 1 + entryIds.length : 2 + at;
    }
    return 2 + entryIds.length;
   };
   return rank(a) - rank(b);
  });
  for (const m of notes) {
   marginalia.append(deps.el('p', { class: 'wiki-note' }, m.text));
  }
  doc.append(marginalia);

  // The trailing composer: one blank line at the end of the column, same
  // serif, same size, no label, no border — a textarea that grows, exactly
  // like .blank-page. It reads as the next paragraph, because that is what
  // it is about to become. It commits on an explicit act, never on leaving.
  const composer = deps.el('textarea', { class: 'piece-composer' }) as HTMLTextAreaElement;
  doc.append(composer);
  const micBtn = deps.el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
  const micStatus = deps.el('span', { class: 'mic-status' });
  const addPara = deps.el('button', { class: 'nav-link piece-composer-add' }, 'add paragraph');
  addPara.hidden = true;
  const composerRow = deps.el('div', { class: 'piece-composer-row' });
  composerRow.append(micBtn, micStatus, addPara);
  doc.append(composerRow);
  // A dragged paragraph must not land inside the composer: its drop would
  // paste the entry id into the draft. The composer is the one editable
  // thing on the page, and nothing here is both draggable and editable.
  composer.addEventListener('dragover', (ev) => ev.preventDefault());
  composer.addEventListener('input', () => {
   composer.style.height = 'auto';
   composer.style.height = `${composer.scrollHeight}px`;
   addPara.hidden = composer.value.trim() === '';
  });
  addPara.addEventListener('click', () => {
   const text = composer.value.trim();
   if (!text) return;
   composer.disabled = true;
   deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/prose`, { arrangement: arrangement.id, text })
    .then(refresh)
    .catch((e: unknown) => {
     composer.disabled = false;
     console.error(e);
    });
  });

  deps.wireDictation({
   textarea: composer,
   micBtn,
   micStatus,
   errorSlot: doc,
  });
 }

 // A drop reorders locally — the client computes the permutation — and then
 // the POST carries the whole new order; the server refuses anything that
 // is not a permutation, so an add or a drop can never ride a reorder.
 function reorderTo(targetId: string, ids: string[], aid: string) {
  const moving = dragEntryId;
  if (moving === null || moving === targetId) return;
  const from = ids.indexOf(moving);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return;
  const next = [...ids];
  next.splice(from, 1);
  const landing = next.indexOf(targetId);
  next.splice(landing, 0, moving);
  void (async () => {
   try {
    await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/reorder`, { arrangement: aid, entries: next });
   } catch (e) {
    console.error(e);
    showQuietError(doc, WAIT_FAILED);
   }
   await refresh();
  })();
 }

 // Touching a rule opens one line to type the question into; Enter sends it.
 // `gap` is client-minted (a fresh ULID), so a retried POST is the same gap
 // and the route mints at most one question for it (Q-39).
 // Dropping a paragraph on the trailing seam moves it to the end of the
 // document, beside the gap it would be inserted after.
 function reorderToEnd(ids: string[], aid: string) {
  const moving = dragEntryId;
  if (moving === null) return;
  const from = ids.indexOf(moving);
  if (from === -1) return;
  const next = [...ids];
  next.splice(from, 1);
  next.push(moving);
  void (async () => {
   try {
    await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/reorder`, { arrangement: aid, entries: next });
   } catch (e) {
    console.error(e);
    showQuietError(doc, WAIT_FAILED);
   }
   await refresh();
  })();
 }

 function openGapEditor(gap: HTMLElement, aid: string, gapId: string, after: string | undefined) {
  if (gap.querySelector('input') !== null) return;
  const input = deps.el('input', { class: 'piece-gap-input', placeholder: 'ask me?' });
  gap.append(input);
  input.focus();
  let committing = false;
  input.addEventListener('keydown', (ev) => {
   if (ev.key === 'Escape') { input.remove(); return; }
   if (ev.key !== 'Enter') return;
   ev.preventDefault();
   const q = input.value.trim();
   if (!q) { input.remove(); return; }
   committing = true;
   deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/gap`, {
    arrangement: aid,
    gap: gapId,
    question: q,
    ...(after !== undefined ? { after } : {}),
   })
    .then(refresh)
    .catch((e: unknown) => { committing = false; console.error(e); });
  });
  input.addEventListener('blur', () => { if (!committing && input.value.trim() === '') input.remove(); });
 }

 const wait = deps.beginWait(doc, 'reading\u2026');
 deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}`)
  .then((piece) => { wait.done(); paint(piece); })
  .catch((e: unknown) => wait.failed(e));
}


/* ── the material screen: choosing what a Piece is made of ── */

/** The material screen's deps, injected once at boot (web/deps.ts): the
 *  same verbs renderPiece's seam carries, wired the territory way — the
 *  router calls renderMaterial() bare. */
export interface MaterialDeps {
 surface: HTMLElement;
 el: WebDepsCore['el'];
 api: WebDepsCore['api'];
 navTo: (screen: string) => void;
 beginWait: WebDepsWithWait['beginWait'];
 clear: () => void;
 setScreen: (screen: string) => void;
 renderShell: () => void;
}

let materialDeps: MaterialDeps | null = null;

/** Wire the material screen's deps once at boot. */
export function initMaterial(deps: MaterialDeps): void {
 materialDeps = deps;
}

function wiredMaterial(): MaterialDeps {
 const deps = materialDeps;
 if (deps === null) {
  throw new Error('material not initialized — call initMaterial before renderMaterial');
 }
 return deps;
}

export function renderMaterial() {
 const d = wiredMaterial();
 d.clear();
 d.setScreen('material');
 d.renderShell();

 const div = d.el('div', { class: 'screen active material-surface' });

 const nav = d.el('div', { class: 'material-nav' });
 // One margin word, present only while at least one paragraph is lit.
 const compose = d.el('button', { class: 'nav-link' }, 'compose');
 compose.hidden = true;
 nav.append(compose);
 div.append(nav);

 // The library's two tabs: the material stack and the dated piece lines.
 const tabs = d.el('div', { class: 'library-tabs' });
 const snippetsTab = d.el('button', { class: 'nav-link library-tab here' }, 'snippets');
 const piecesTab = d.el('button', { class: 'nav-link library-tab' }, 'pieces');
 snippetsTab.dataset.tab = 'snippets';
 piecesTab.dataset.tab = 'pieces';
 tabs.append(snippetsTab, ' \u00b7 ', piecesTab);
 div.append(tabs);

 const column = d.el('div', { class: 'material-column' });
 div.append(column);
 d.surface.append(div);

 const selected = new Set<string>();

 compose.addEventListener('click', () => {
  const ids = [...selected];
  if (ids.length === 0) return;
  const wait = d.beginWait(column, 'stacking them\u2026');
  d.api<PieceEnriched>('/api/piece', { snippets: ids })
   .then((piece) => {
    wait.done();
    setCurrentPieceId(piece.id);
    d.navTo('piece');
   })
   .catch((e: unknown) => wait.failed(e));
 });

 const wait = d.beginWait(column, 'reading\u2026');
 (async () => {
  try {
   const [snippetsRes, piecesRes] = await Promise.all([
    d.api<{ snippets: Snippet[] }>('/api/snippets'),
    d.api<{ pieces: PieceLite[] }>('/api/pieces'),
   ]);
   wait.done();
   paintMaterial(column, snippetsRes.snippets, piecesRes.pieces, selected, compose, tabs);
  } catch (e) {
   wait.failed(e);
  }
 })();
}

function paintMaterial(
 column: HTMLElement,
 snippets: Snippet[],
 pieces: PieceLite[],
 selected: Set<string>,
 compose: HTMLButtonElement,
 tabs: HTMLElement,
) {
 const d = wiredMaterial();
 column.innerHTML = '';

 // The snippets tab: the material as a stack — dated paragraphs, most
 // recent first — under a filter that hides lines as you type. The server
 // carries no sitting date here, so captured order stands in — a known
 // presentational deviation, recorded by the driver; the load-bearing
 // sitting order happens server-side at pinning time (Q-59).
 const snippetsArea = d.el('div', { class: 'library-snippets' });
 const filter = d.el('input', { class: 'library-filter', type: 'text', placeholder: 'filter your words\u2026' });
 snippetsArea.append(filter);
 const stacked = [...snippets].sort((a, b) => b.captured.localeCompare(a.captured));
 const rows: { para: HTMLElement; prose: string }[] = [];
 const list = d.el('div', { class: 'material-snippets' });
 for (const s of stacked) {
  const para = d.el('div', { class: 'material-snippet' });
  para.append(
   d.el('span', { class: 'material-date' }, readableDate(s.captured)),
   d.el('p', { class: 'material-prose' }, s.prose),
  );
  if (selected.has(s.id)) para.classList.add('lit');
  // Touching a paragraph lights it: ink goes dim to full, the way the
  // harvest surface keeps a span by touching it (Q-58).
  para.addEventListener('click', () => {
   if (selected.has(s.id)) {
    selected.delete(s.id);
    para.classList.remove('lit');
   } else {
    selected.add(s.id);
    para.classList.add('lit');
   }
   compose.hidden = selected.size === 0;
   compose.textContent = `compose ${selected.size}`;
  });
  list.append(para);
  rows.push({ para, prose: s.prose });
 }
 snippetsArea.append(
  stacked.length === 0 ? d.el('p', { class: 'empty-msg' }, 'nothing here yet') : list,
 );

 // The pieces tab: dated lines, one per piece, with the first pin's
 // opening words as a preview when it has any.
 const piecesArea = d.el('div', { class: 'material-pieces' });
 if (pieces.length === 0) {
  piecesArea.append(d.el('p', { class: 'empty-msg' }, 'nothing here yet'));
 } else {
  for (const p of pieces) {
   const firstPin = p.arrangement?.entries.find((e) => e.kind === 'pin');
   const prose = firstPin?.kind === 'pin' ? firstPin.prose : undefined;
   let text = readableDate(p.created);
   if (prose) {
    const preview = prose.replace(/\s+/g, ' ').trim();
    text += ' \u2014 ' + (preview.length > 48 ? preview.slice(0, 48) + '\u2026' : preview);
   }
   const line = d.el('button', { class: 'nav-link material-piece-line' }, text);
   line.addEventListener('click', () => {
    setCurrentPieceId(p.id);
    d.navTo('piece');
   });
   piecesArea.append(line);
  }
 }

 // Both tabs stay rendered in the column, so the selection and the filter
 // survive a switch; the tabs only move which region is visible.
 column.append(snippetsArea);
 column.append(piecesArea);
 piecesArea.hidden = true;

 const tabButtons = tabs.querySelectorAll<HTMLButtonElement>('.library-tab');
 for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
   for (const other of tabButtons) other.classList.remove('here');
   btn.classList.add('here');
   snippetsArea.hidden = btn.dataset.tab !== 'snippets';
   piecesArea.hidden = btn.dataset.tab !== 'pieces';
  });
 }

 filter.addEventListener('input', () => {
  const q = filter.value.trim().toLowerCase();
  for (const row of rows) row.para.hidden = q !== '' && !row.prose.toLowerCase().includes(q);
 });
}

