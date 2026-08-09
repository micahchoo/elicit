/**
 * Two screens, both pages of text (docs/interface-references.md's document
 * rule): `material`, choosing what a Piece is made of, and `piece`, the
 * Piece itself — the entries are the page. Nothing here is both draggable
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
import type { NavOpts, WebDepsCore, WebDepsShell, WebDepsWithWait } from './deps.js';
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
 /** The pinned version's identity — the wire sends both (Q-5). */
 snippet: string;
 version: number;
 prose: string | null;
}
/** A gap: `kind` is the four model kinds (leap/unsupported/thin/unclosed) or
 *  null — the discriminator is `entry.kind === 'pin'`, nothing else. */
interface PieceGapEntry {
 id: string;
 kind: 'leap' | 'unsupported' | 'thin' | 'unclosed' | null;
 placedBy: 'person' | 'model';
 question: string | null;
 pending: string | null;
 offers: Snippet[];
}
interface PieceMarginalium {
 on: string | null;
 note: string;
 text: string;
}
/** One auto-gather offer: the passage that may belong, with its prose. */
export interface PieceOffer {
 id: string;
 snippet: string;
 version: number;
 sourceSitting: string;
 prose: string | null;
 sittingDate: string | null;
}
export interface PieceEnriched {
 id: string;
 created: string;
 subject: string;
 setDownAt: string | null;
 setDownBy: string | null;
 discardedAt: string | null;
 entries: (PiecePinEntry | PieceGapEntry)[];
 offers: PieceOffer[];
 declined: string[];
 dismissedGaps: string[];
 marginalia: PieceMarginalium[];
}
export interface PieceLite {
 id: string;
 created: string;
 subject: string;
 setDownAt: string | null;
 entries: (PiecePinEntry | PieceGapEntry)[];
}

/** One coached direction on the material surface's directions tab — a door. */
export interface DirectionDoor {
 slug: string;
 name: string;
}

/* ── the piece screen: the entries are the page ── */

export function renderPiece(deps: PieceDeps): void {
 deps.clear();
 deps.setScreen('piece');
 const id = currentPieceId;
 if (id === null) {
 deps.navTo('your-words');
 return;
}
 deps.renderShell();
 // An explicit string binding: function declarations below do not inherit
 // the narrowing of `id` (only arrow closures do), so name it once, plainly.
 const pieceId: string = id;
 // The trailing seam, for the seam's own click-to-ask; null until the page
 // has painted it.
 const div = deps.el('div', { class: 'screen active piece-surface' });

 const nav = deps.el('div', { class: 'piece-toolbar' });
 const navLeft = deps.el('div', { class: 'piece-toolbar-left' });
 const navRight = deps.el('div', { class: 'piece-toolbar-right' });
 const backBtn = deps.el('button', { class: 'nav-link' }, '\u2190 your words');
 backBtn.addEventListener('click', () => deps.navTo('your-words'));
 // Margin words, dimmed until the page is focused: set down (or pick up,
 // when the Piece is set down), discard, and Output A's two saves
 // (redesign-2026-08-09 §6, §8) — `save as it stands` downloads the clean
 // export (what ships), `save with the questions` the working document
 // (the words plus the open gaps and offers). Q-41's verbs, the Q-3 field
 // write and the two-ink export — never flags.
 const setDown = deps.el('button', { class: 'nav-link' }, 'set down');
 const pickUp = deps.el('button', { class: 'nav-link' }, 'pick up');
 const discard = deps.el('button', { class: 'nav-link' }, 'discard');
 const saveClean = deps.el('button', { class: 'nav-link' }, 'save as it stands');
 const saveQuestions = deps.el('button', { class: 'nav-link' }, 'save with the questions');
 navLeft.append(backBtn);
 navRight.append(discard, ' \u00b7 ', saveClean, ' \u00b7 ', saveQuestions, ' \u00b7 ', setDown, ' \u00b7 ', pickUp);
 nav.append(navLeft, navRight);
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
 discard.addEventListener('click', () => {
  // Q-3: a field write, and the board stops listing the piece. There is no
  // state past discarded — leave the piece screen.
  deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/discard`)
   .then(() => deps.navTo('your-words'))
   .catch((e: unknown) => console.error(e));
 });
 // Both saves are the same client download of a zero-LLM export: the clean
 // ink at the default endpoint, the questions ink behind `?ink=questions`.
 // The server decides nothing the client could — the ink is a read query.
 const saveExport = (ink: 'clean' | 'questions', filename: string): void => {
  void (async () => {
   try {
    const path = ink === 'questions'
     ? `/api/piece/${encodeURIComponent(pieceId)}/export/questions`
     : `/api/piece/${encodeURIComponent(pieceId)}/export`;
    const res = await deps.api<Response>(path, undefined, { raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = deps.el('a', { href: url, download: filename });
    deps.document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
   } catch (e) {
    console.error(e);
   }
  })();
 };
 saveClean.addEventListener('click', () => saveExport('clean', `piece-${pieceId}.md`));
 saveQuestions.addEventListener('click', () => saveExport('questions', `piece-${pieceId}.questions.md`));
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
  const isDown = piece.setDownAt !== null;
  setDown.style.display = isDown ? 'none' : '';
  pickUp.style.display = isDown ? '' : 'none';

  const entryIds = piece.entries.map((e) => e.id);

  for (const entry of piece.entries) {
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
     void reorderTo(entry.id, entryIds);
    });
    // The margin verbs, revealed on focus: `take out` removes the entry;
    // `ask here` opens a question line right after this paragraph. Drag is
    // the third passage verb and needs no word (redesign §8).
    const verbs = deps.el('span', { class: 'piece-para-verbs' });
    const takeOut = deps.el('button', { class: 'nav-link' }, 'take out');
    const askHere = deps.el('button', { class: 'nav-link' }, 'ask here');
    takeOut.addEventListener('click', () => {
     void (async () => {
      try {
       await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/remove`, { entry: entry.id });
      } catch (e) {
       console.error(e);
       showQuietError(doc, WAIT_FAILED);
      }
      await refresh();
     })();
    });
    askHere.addEventListener('click', () => {
     // A transient gap line after this paragraph; cancel removes the line.
     const g = deps.el('div', { class: 'piece-gap' });
     para.after(g);
     openGapEditor(g, ulid(), entry.id, { transient: true });
    });
    verbs.append(takeOut, ' \u00b7 ', askHere);
    para.append(verbs);
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
    // A model-placed gap carries the model's proposed question as `pending`
    // until `ask this` mints it — the rule speaks the proposal, and the
    // verbs beside it are the person's answer (redesign §8).
    const questionText = entry.question ?? entry.pending ?? 'waiting for its question';
    rule.append(deps.el('span', { class: 'piece-gap-question' }, questionText));
    // The verbs on a model-found gap: `ask this` mints the pending question
    // at composition-gap weight; `not a gap` dismisses it durably — never
    // re-found. A person-placed hole is a commitment, not a proposal, and
    // carries neither verb (take it out instead).
    if (entry.placedBy === 'model') {
     const verbs = deps.el('span', { class: 'piece-gap-verbs' });
     if (entry.pending !== null && entry.question === null) {
      const askThis = deps.el('button', { class: 'nav-link' }, 'ask this');
      askThis.addEventListener('click', () => {
       void (async () => {
        try {
         await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/gaps/${encodeURIComponent(entry.id)}/ask`);
        } catch (e) {
         console.error(e);
         showQuietError(doc, WAIT_FAILED);
        }
        await refresh();
       })();
      });
      verbs.append(askThis, ' \u00b7 ');
     }
     const notAGap = deps.el('button', { class: 'nav-link' }, 'not a gap');
     notAGap.addEventListener('click', () => {
      void (async () => {
       try {
        await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/gaps/${encodeURIComponent(entry.id)}/dismiss`);
       } catch (e) {
        console.error(e);
        showQuietError(doc, WAIT_FAILED);
       }
       await refresh();
      })();
     });
     verbs.append(notAGap);
     rule.append(verbs);
    }
    gap.append(rule);
    // An answered gap carries its offer in the margin: the harvested
    // sentence, dimmed, beside the rule, with the `place it` word. Nothing
    // renders when the join is empty, and nothing is ever placed without
    // the person's touch (Q-39).
    if (entry.offers.length > 0) {
     for (const offer of entry.offers) {
      const o = deps.el('button', { class: 'piece-offer' }, offer.prose);
      o.append(deps.el('span', { class: 'piece-offer-verb' }, 'place it'));
      o.addEventListener('click', () => {
       void (async () => {
        try {
         await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/gap/accept`, {
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
     void reorderTo(entry.id, entryIds);
    });
    doc.append(gap);
   }
  }

  // The trailing seam: one thin rule at the end of the column, the insert
  // point for a new gap. Touching it opens a line; Enter mints the gap with
  // a client-minted id and the entry it follows (the last one). A new gap
  // lands at the end, and the paragraph drag places it anywhere.
  const seam = deps.el('div', { class: 'piece-gap' });
  const seamRule = deps.el('div', { class: 'piece-gap-rule' });
  seamRule.append(deps.el('span', { class: 'piece-gap-ask' }, 'ask me?'));
  seam.append(seamRule);
  seamRule.addEventListener('click', () => {
   openGapEditor(seam, ulid(), entryIds.length > 0 ? entryIds[entryIds.length - 1]! : undefined);
  });
  seam.addEventListener('dragover', (ev) => {
   ev.preventDefault();
   if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  });
  seam.addEventListener('drop', (ev) => {
   ev.preventDefault();
   void reorderToEnd(entryIds);
  });
  doc.append(seam);

  // Skeleton Marginalia sit in the margin column, dimmed until hovered:
  // each role phrase beside its paragraph, then any stale-pin flag. A
  // stale-pin flag is a note, never a control — there is nothing to click
  // (Q-39).
  const marginalia = deps.el('div', { class: 'piece-marginalia' });
  const notes = [...piece.marginalia].sort((a, b) => {
   const rank = (m: PieceMarginalium): number => {
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

  // The search-and-place door (redesign §5): any passage, any sitting, at
  // any time. A thin filter over every snippet; each hit carries a `place`
  // word that appends it as a pin. Zero-LLM — the filter lives here, and
  // the server only ever sees a place. Passages already pinned are not
  // offered (the same words do not sit twice).
  const search = deps.el('div', { class: 'piece-search' });
  const searchInput = deps.el('input', { class: 'piece-search-input', type: 'text', placeholder: 'find a passage\u2026' });
  const searchResults = deps.el('div', { class: 'piece-search-results' });
  search.append(searchInput, searchResults);
  doc.append(search);
  const allSnippets = new Map<string, Snippet>();
  const pinnedKeys = new Set(
   piece.entries.filter((e) => e.kind === 'pin').map((e) => `${e.snippet}@${e.version}`),
  );
  searchInput.addEventListener('input', () => {
   const q = searchInput.value.trim().toLowerCase();
   searchResults.innerHTML = '';
   if (q === '') return;
   void (async () => {
    // The index arrives lazily, on the first keystroke.
    if (allSnippets.size === 0) {
     try {
      const res = await deps.api<{ snippets: Snippet[] }>('/api/snippets');
      for (const s of res.snippets) allSnippets.set(s.id, s);
     } catch {
      return;
     }
    }
    const hits = [...allSnippets.values()]
     .filter((s) => !pinnedKeys.has(`${s.id}@${s.version}`))
     .filter((s) => s.prose.toLowerCase().includes(q))
     .slice(0, 12);
    if (hits.length === 0) {
     searchResults.append(deps.el('p', { class: 'empty-msg' }, 'no passage matches'));
     return;
    }
    for (const s of hits) {
     const row = deps.el('div', { class: 'piece-search-hit' });
     row.append(deps.el('p', { class: 'material-prose' }, s.prose));
     const place = deps.el('button', { class: 'nav-link' }, 'place');
     place.addEventListener('click', () => {
      void (async () => {
       try {
        await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/place`, { snippet: s.id, version: s.version });
       } catch (e) {
        console.error(e);
        showQuietError(doc, WAIT_FAILED);
       }
       await refresh();
      })();
     });
     row.append(place);
     searchResults.append(row);
    }
   })();
  });
  // The auto-gather region (redesign §5.3): passages a sitting produced
  // that may belong, judged against the subject and the existing material.
  // BELOW the piece, each with the two verbs — `put it in` accepts (the
  // pin, appended), `not this one` denies durably (never re-offered).
  // Auto-gather offers, it never adds: nothing here places without the
  // person's touch (Q-39). The region hides whole when empty; the [hidden]
  // rule beats the display:flex author rules (bug 12.1's fix), so this
  // region cannot walk into that trap.
  const offersRegion = deps.el('div', { class: 'piece-offers' });
  offersRegion.hidden = piece.offers.length === 0;
  doc.append(offersRegion);
  if (piece.offers.length > 0) {
   offersRegion.append(deps.el('p', { class: 'piece-offers-label' }, 'offered to this piece:'));
   for (const offer of piece.offers) {
    const row = deps.el('div', { class: 'piece-offer-row' });
    row.append(deps.el('p', { class: 'piece-offer-prose' }, offer.prose ?? ''));
    const verbs = deps.el('span', { class: 'piece-offer-verbs' });
    const putIn = deps.el('button', { class: 'nav-link' }, 'put it in');
    putIn.addEventListener('click', () => {
     void (async () => {
      try {
       await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/offers/${encodeURIComponent(offer.id)}/accept`);
      } catch (e) {
       console.error(e);
       showQuietError(doc, WAIT_FAILED);
      }
      await refresh();
     })();
    });
    const notThisOne = deps.el('button', { class: 'nav-link' }, 'not this one');
    notThisOne.addEventListener('click', () => {
     void (async () => {
      try {
       await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/offers/${encodeURIComponent(offer.id)}/deny`);
      } catch (e) {
       console.error(e);
       showQuietError(doc, WAIT_FAILED);
      }
      await refresh();
     })();
    });
    verbs.append(putIn, ' \u00b7 ', notThisOne);
    row.append(verbs);
    offersRegion.append(row);
   }
  }

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
   deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/prose`, { text })
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
 function reorderTo(targetId: string, ids: string[]) {
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
    await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/reorder`, { entries: next });
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
 function reorderToEnd(ids: string[]) {
  const moving = dragEntryId;
  if (moving === null) return;
  const from = ids.indexOf(moving);
  if (from === -1) return;
  const next = [...ids];
  next.splice(from, 1);
  next.push(moving);
  void (async () => {
   try {
    await deps.api(`/api/piece/${encodeURIComponent(pieceId)}/reorder`, { entries: next });
   } catch (e) {
    console.error(e);
    showQuietError(doc, WAIT_FAILED);
   }
   await refresh();
  })();
 }

 function openGapEditor(gap: HTMLElement, gapId: string, after: string | undefined, opts?: { transient?: boolean }) {
  if (gap.querySelector('input') !== null) return;
  const input = deps.el('input', { class: 'piece-gap-input', placeholder: 'ask me?' });
  gap.append(input);
  input.focus();
  // A transient line (the passage verb `ask here`) disappears whole on
  // cancel; the trailing seam keeps its rule when the input goes.
  const cancel = (): void => {
   if (opts?.transient === true) gap.remove();
   else input.remove();
  };
  let committing = false;
  input.addEventListener('keydown', (ev) => {
   if (ev.key === 'Escape') { cancel(); return; }
   if (ev.key !== 'Enter') return;
   ev.preventDefault();
   const q = input.value.trim();
   if (!q) { cancel(); return; }
   committing = true;
   deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/gap`, {
    gap: gapId,
    question: q,
    ...(after !== undefined ? { after } : {}),
   })
    .then(refresh)
    .catch((e: unknown) => { committing = false; console.error(e); });
  });
  input.addEventListener('blur', () => { if (!committing && input.value.trim() === '') cancel(); });
 }

 const wait = deps.beginWait(doc, 'reading\u2026');
 deps.api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}`)
  .then((piece) => { wait.done(); paint(piece); })
  .catch((e: unknown) => wait.failed(e));
}


/* ── the material screen: choosing what a Piece is made of ── */

/** The material screen's deps, injected once at boot (web/deps.ts): the
 *  same verbs renderPiece's seam carries, wired the territory way — the
 *  router calls renderMaterial() bare. navTo carries the same opts seam
 *  the other screens' do (web/deps.ts NavOpts): the directions tab's
 *  doors open the coach page with { slug }. */
export interface MaterialDeps {
 surface: HTMLElement;
 el: WebDepsCore['el'];
 api: WebDepsCore['api'];
 navTo: (screen: string, opts?: NavOpts) => void;
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
 d.setScreen('your-words');
 d.renderShell();

 const div = d.el('div', { class: 'screen active material-surface' });

 const nav = d.el('div', { class: 'material-nav' });
 // The gathering criterion (redesign §5): the person's own words for what
 // these passages are about. Carried into the composition and never into
 // any export (Q-1); auto-gather judges offers against it.
 const subjectInput = d.el('input', { class: 'library-subject', type: 'text', placeholder: 'these are about\u2026' });
 // One margin word, present only while at least one paragraph is lit.
 const compose = d.el('button', { class: 'nav-link' }, 'compose');
 compose.hidden = true;
 nav.append(subjectInput, compose);
 div.append(nav);

 // The library's three tabs: the material stack, the dated piece lines,
 // and the coached directions (wave 5).
 const tabs = d.el('div', { class: 'library-tabs' });
 const passagesTab = d.el('button', { class: 'nav-link library-tab here' }, 'passages');
 const piecesTab = d.el('button', { class: 'nav-link library-tab' }, 'pieces');
 const directionsTab = d.el('button', { class: 'nav-link library-tab' }, 'directions');
 passagesTab.dataset.tab = 'passages';
 piecesTab.dataset.tab = 'pieces';
 directionsTab.dataset.tab = 'directions';
 tabs.append(passagesTab, ' \u00b7 ', piecesTab, ' \u00b7 ', directionsTab);
 div.append(tabs);

 const column = d.el('div', { class: 'material-column' });
 div.append(column);
 d.surface.append(div);

 const selected = new Set<string>();

 compose.addEventListener('click', () => {
  const ids = [...selected];
  if (ids.length === 0) return;
  const wait = d.beginWait(column, 'stacking them\u2026');
  d.api<PieceEnriched>('/api/piece', { snippets: ids, subject: subjectInput.value.trim() })
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
   const [snippetsRes, piecesRes, directionsRes] = await Promise.all([
    d.api<{ snippets: Snippet[] }>('/api/snippets'),
    d.api<{ pieces: PieceLite[] }>('/api/pieces'),
    d.api<{ directions: DirectionDoor[] }>('/api/coach/directions'),
   ]);
   wait.done();
   paintMaterial(column, snippetsRes.snippets, piecesRes.pieces, directionsRes.directions, selected, compose, tabs);
  } catch (e) {
   wait.failed(e);
  }
 })();
}

function paintMaterial(
 column: HTMLElement,
 snippets: Snippet[],
 pieces: PieceLite[],
 directions: DirectionDoor[],
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
   const firstPin = p.entries.find((e) => e.kind === 'pin');
   const prose = firstPin?.kind === 'pin' ? firstPin.prose : undefined;
   let text = readableDate(p.created);
   if (prose) {
    const preview = prose.replace(/\s+/g, ' ').trim();
    text += ' \u2014 ' + (preview.length > 48 ? preview.slice(0, 48) + '\u2026' : preview);
   }
   const line = d.el('button', { class: 'nav-link material-piece-line' }, text);
   // The shelf (bug 12.3): a set-down piece renders as set down — dimmed,
   // with the reversible word — never identical to a live piece.
   if (p.setDownAt !== null) {
    line.classList.add('set-down');
    line.append(d.el('span', { class: 'material-set-down' }, ' \u2014 set down'));
   }
   line.addEventListener('click', () => {
    setCurrentPieceId(p.id);
    d.navTo('piece');
   });
   piecesArea.append(line);
  }
 }

 // The directions tab: one door row per coached direction — the name and
 // an 'open' word. No stats, no aggregate (canon §5.6): the door is the
 // whole of it; the door opens the coach page on the slug.
 const directionsArea = d.el('div', { class: 'library-directions' });
 if (directions.length === 0) {
  directionsArea.append(d.el('p', { class: 'empty-msg' }, 'no directions yet'));
 } else {
  for (const dir of directions) {
   const door = d.el('button', { class: 'direction-door', type: 'button' });
   door.append(
    d.el('span', { class: 'direction-name' }, dir.name),
    d.el('span', { class: 'direction-open' }, 'open'),
   );
   door.addEventListener('click', () => d.navTo('coach', { slug: dir.slug }));
   directionsArea.append(door);
  }
 }

 // All three tabs stay rendered in the column, so the selection, the filter
 // and the doors survive a switch; the tabs only move which region is
 // visible.
 column.append(snippetsArea);
 column.append(piecesArea);
 column.append(directionsArea);
 piecesArea.hidden = true;
 directionsArea.hidden = true;

 const tabButtons = tabs.querySelectorAll<HTMLButtonElement>('.library-tab');
 for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
   for (const other of tabButtons) other.classList.remove('here');
   btn.classList.add('here');
   snippetsArea.hidden = btn.dataset.tab !== 'passages';
   piecesArea.hidden = btn.dataset.tab !== 'pieces';
   directionsArea.hidden = btn.dataset.tab !== 'directions';
  });
 }

 filter.addEventListener('input', () => {
  const q = filter.value.trim().toLowerCase();
  for (const row of rows) row.para.hidden = q !== '' && !row.prose.toLowerCase().includes(q);
 });
}

