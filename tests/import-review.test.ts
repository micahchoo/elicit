import { describe, it, expect } from 'vitest';
import {
  buildReviewSurface,
  makeStorageStub,
  clickExclude,
  confirmExclude,
  clickReject,
  confirmReject,
  focusCut,
  paragraphsOf,
  verbLabels,
  visibleVerbs,
  clickVerb,
  flush,
  type ShimElement,
} from './fixtures/import-surface.js';
import type { ImportReviewItem } from '../web/import-review.js';

/**
 * A dated-essay-shaped item: the same four paragraphs as the committed
 * fixture, with the same three whole-paragraph cuts at their real source
 * offsets, and two dropped regions (one cited, one quoted) inside paragraphs.
 * The surface DOM is built by the shared shim helpers — no browser needed.
 */
const PARAGRAPHS = [
  'I wrote this essay in September 2018, and I still stand by most of it.',
  'The middle of the argument is where the image sits, and it earns its place by showing what a paragraph of prose could not.',
  'I keep coming back to this piece when I want to remember why I started.',
  'The last paragraph ties the first three together, and I have left it here.',
];

const SOURCE = PARAGRAPHS.join('\n\n');
const HASH = 'd4e6f0f1a2b3c4d5e6f7a8b9';

const cut = (text: string) => ({
  text,
  at: SOURCE.indexOf(text),
  facet: 'value',
  stance: 'commitment',
  reading: 'the person states a position they hold',
});

const item: ImportReviewItem = {
  hash: HASH,
  file: 'dated-essay.md',
  title: 'A dated essay',
  date: '2018-09-01',
  source: SOURCE,
  cuts: [cut(PARAGRAPHS[0]!), cut(PARAGRAPHS[2]!), cut(PARAGRAPHS[3]!)],
  marks: [
    { at: SOURCE.indexOf(PARAGRAPHS[1]!) + 5, length: 25, why: 'cited' },
    { at: SOURCE.indexOf(PARAGRAPHS[2]!) + 10, length: 20, why: 'quoted' },
  ],
};

describe('the review surface — the piece whole, cuts marked in place', () => {
  it('renders the piece whole — every source paragraph is on the page', async () => {
    const { surface } = await buildReviewSurface(item);
    const text = surface.textContent!;
    for (const para of PARAGRAPHS) expect(text).toContain(para);
    // Verbatim: each paragraph element holds exactly its own source text, in
    // order, nothing reflowed — the marginalia sit outside the flow.
    expect(paragraphsOf(surface)).toEqual(PARAGRAPHS);
  });

  it('offers three verbs and never restate', async () => {
    const { surface } = await buildReviewSurface(item);
    expect(verbLabels(surface)).toEqual(['keep', 'trim', 'leave out']);
    // Hidden until a cut is focused — the page is a document, not a control.
    expect(visibleVerbs(surface)).toEqual([]);
  });

  it('puts the piece-level refusal in the header, not among the cut verbs', async () => {
    const { surface } = await buildReviewSurface(item);
    expect(surface.querySelector('.import-header .import-exclude')).not.toBeNull();
    expect(surface.querySelector('.import-cut .import-exclude')).toBeNull();
  });

  it('sends the reason with the exclusion and refuses an empty one', async () => {
    const { surface, sent, nav } = await buildReviewSurface(item);
    clickExclude(surface);
    await confirmExclude(surface, '');
    expect(sent).toHaveLength(0);
    await confirmExclude(surface, 'co-taught with Paul; no cut of it is mine alone');
    expect(sent[0]).toMatchObject({
      path: `/api/import/${HASH}/exclude`,
      body: { reason: 'co-taught with Paul; no cut of it is mine alone' },
    });
    // Landing on 'import' (not 'mode') is deliberate — the next ready piece,
    // or the waiting sentence, is the natural destination (2fd883a).
    expect(nav).toContain('import');
  });

  it('offers a plain rejection in the header, beside the authorship refusal', async () => {
    const { surface, sent, nav } = await buildReviewSurface(item);
    expect(surface.querySelector('.import-header .import-reject')).not.toBeNull();
    clickReject(surface);
    await confirmReject(surface, '');
    expect(sent).toHaveLength(0); // an empty reason records nothing (Q-51)
    await confirmReject(surface, 'a project write-up, not diary material');
    expect(sent[0]).toMatchObject({
      path: `/api/import/${HASH}/exclude`,
      body: { reason: 'a project write-up, not diary material' },
    });
    expect(nav).toContain('import');
  });

  it('saves a zero-cut piece as-is: save is live and sends an empty decision list', async () => {
    const bare: ImportReviewItem = { ...item, cuts: [], marks: [] };
    const { surface, sent, nav } = await buildReviewSurface(bare);
    const save = surface.querySelector('.import-save')! as ShimElement;
    expect(save.disabled).toBe(false); // nothing to decide — no dead end
    expect(surface.textContent).toContain('nothing in this piece stood out');
    expect(surface.querySelector('.import-progress')).toBeNull(); // no count of nothing
    save.click();
    await flush();
    expect(sent[sent.length - 1]).toMatchObject({
      path: `/api/import/${HASH}/decisions`,
      body: { decisions: [] },
    });
    // The receipt is the last screen — zero kept passages say so, and
    // nothing navigates away (wave 3).
    expect(surface.textContent).toContain('Nothing was kept.');
    expect(nav).toEqual([]);
  });

  it('keeps save disabled until every cut has a decision, then sends one per cut', async () => {
    const { surface, sent, nav } = await buildReviewSurface(item);
    const save = surface.querySelector('.import-save')! as ShimElement;
    expect(save.disabled).toBe(true);

    focusCut(surface, 0);
    expect(visibleVerbs(surface)).toEqual(['keep', 'trim', 'leave out']);
    clickVerb(surface, 'keep');
    expect(save.disabled).toBe(true); // cuts 1 and 2 still undecided

    focusCut(surface, 1);
    clickVerb(surface, 'trim');
    const editor = surface.querySelector('.import-trim-editor')! as ShimElement;
    expect(editor.value).toBe(item.cuts[1]!.text); // pre-filled with the cut
    editor.value = 'I keep coming back to this piece';
    surface.querySelector('.import-trim-confirm')!.click();
    expect(save.disabled).toBe(true);

    focusCut(surface, 2);
    clickVerb(surface, 'leave out');
    expect(save.disabled).toBe(false);

    save.click();
    await flush(); // the POST chain and the receipt land on the microtask queue
    const last = sent[sent.length - 1]!;
    expect(last.path).toBe(`/api/import/${HASH}/decisions`);
    expect(last.body).toEqual({
      decisions: [
        { cut: 0, action: 'approve' },
        { cut: 1, action: 'trim', text: 'I keep coming back to this piece' },
        { cut: 2, action: 'discard' },
      ],
    });
    // The receipt is the last screen — the verbatim kept passages, and
    // only those; nothing navigates away (wave 3).
    expect(surface.textContent).toContain('Kept, in your words:');
    expect(surface.textContent).toContain(item.cuts[0]!.text);
    expect(surface.textContent).toContain('I keep coming back to this piece');
    expect(surface.textContent).not.toContain(item.cuts[2]!.text); // the discarded cut stays out
    expect(nav).toEqual([]);
  });

  it('counts the undecided cuts beside save, and counts down as decisions land', async () => {
    const { surface } = await buildReviewSurface(item);
    const progress = surface.querySelector('.import-progress')!;
    expect(progress.textContent).toContain('3 of 3 underlined cuts still wait');
    expect(progress.textContent).toContain('click one, then keep, trim or leave it out');

    focusCut(surface, 0);
    clickVerb(surface, 'keep');
    expect(progress.textContent).toContain('2 of 3');

    focusCut(surface, 1);
    clickVerb(surface, 'leave out');
    expect(progress.textContent).toContain('1 of 3 underlined cuts still waits');

    focusCut(surface, 2);
    clickVerb(surface, 'leave out');
    expect(progress.textContent).toBe('all 3 cuts are decided.');
  });

  it('select-all preselects the waiting cuts without touching decided ones, and commits nothing', async () => {
    const { surface, sent } = await buildReviewSurface(item);
    const save = surface.querySelector('.import-save')! as ShimElement;

    // One cut decided by hand first: the bulk verb must not overwrite it.
    focusCut(surface, 1);
    clickVerb(surface, 'leave out');

    const allKeep = surface
      .querySelectorAll('.import-decide-all-btn')
      .find((b) => b.textContent.includes('keep'))!;
    allKeep.click();

    expect(sent).toHaveLength(0); // preselection is not a commit
    expect(save.disabled).toBe(false);
    expect(surface.querySelector('.import-progress')!.textContent).toBe('all 3 cuts are decided.');

    save.click();
    await flush();
    expect(sent[sent.length - 1]).toMatchObject({
      path: `/api/import/${HASH}/decisions`,
      body: {
        decisions: [
          { cut: 0, action: 'approve' },
          { cut: 1, action: 'discard' }, // the hand decision survived
          { cut: 2, action: 'approve' },
        ],
      },
    });
  });

  it('keeps a passage of the reader\'s own — exact source text only — and sends it as an addition', async () => {
    const bare: ImportReviewItem = { ...item, cuts: [], marks: [] };
    const { surface, sent } = await buildReviewSurface(bare);

    const toggle = surface.querySelector('.import-add-toggle')! as ShimElement;
    toggle.click();
    const editor = surface.querySelector('.import-add-editor')! as ShimElement;

    // Words not in the source are refused in place — no addition records.
    editor.value = 'words I never wrote';
    surface.querySelector('.import-add-confirm')!.click();
    expect(surface.querySelector('.import-addition')).toBeNull();
    expect(editor.classList.contains('invalid')).toBe(true);

    // An exact passage goes through, and the no-snippets sentence leaves:
    // its promise no longer holds.
    editor.value = PARAGRAPHS[1]!;
    surface.querySelector('.import-add-confirm')!.click();
    expect(surface.querySelector('.import-addition-text')!.textContent).toBe(PARAGRAPHS[1]);
    expect((surface.querySelector('.import-no-cuts') as ShimElement & { hidden?: boolean }).hidden).toBe(true);

    (surface.querySelector('.import-save')! as ShimElement).click();
    await flush();
    expect(sent[sent.length - 1]).toMatchObject({
      path: `/api/import/${HASH}/decisions`,
      body: { decisions: [], additions: [PARAGRAPHS[1]] },
    });
  });

  it('refuses a trim that is not a non-empty substring of the cut', async () => {
    const { surface } = await buildReviewSurface(item);
    const save = surface.querySelector('.import-save')! as ShimElement;
    focusCut(surface, 1);
    clickVerb(surface, 'trim');
    const editor = surface.querySelector('.import-trim-editor')! as ShimElement;
    const cutText = item.cuts[1]!.text;

    editor.value = 'words I never wrote';
    surface.querySelector('.import-trim-confirm')!.click();
    expect(editor.value).toBe(cutText); // refused — reset to the cut
    expect(save.disabled).toBe(true); // and no decision recorded

    editor.value = ''; // empty would pass `includes`
    surface.querySelector('.import-trim-confirm')!.click();
    expect(editor.value).toBe(cutText);
    expect(save.disabled).toBe(true);

    editor.value = 'why I started'; // a real substring goes through
    surface.querySelector('.import-trim-confirm')!.click();
    expect(surface.querySelector('.import-trim-editor')).toBeNull(); // closed in place
    expect(save.disabled).toBe(true); // one cut decided — two still wait
  });

  it('renders the waiting sentence and a back control when no item is ready', async () => {
    const { surface, nav } = await buildReviewSurface(null);
    expect(surface.textContent).toContain('no piece is ready');
    surface.querySelector('.import-back')!.click();
    expect(nav).toContain('today');
  });
});

describe('finish-later keeps drafts — decisions survive a re-render (§5.4)', () => {
  const draftKey = `elicit.review-drafts.${HASH}`;

  it('hydrates a saved draft on re-entry and clears it on save', async () => {
    const storage = makeStorageStub();
    const first = await buildReviewSurface(item, storage);

    // Decide two of the three cuts, then leave mid-review.
    focusCut(first.surface, 0);
    clickVerb(first.surface, 'keep');
    focusCut(first.surface, 1);
    clickVerb(first.surface, 'leave out');
    // The draft is on the record, keyed by the item id, in the stable form.
    expect(JSON.parse(storage.getItem(draftKey) ?? 'null')).toEqual([
      { index: 0, action: 'keep' },
      { index: 1, action: 'leave out' },
    ]);

    // A fresh render of the same piece restores the decisions: the marks
    // restate on the prose, the count sentence reflects them, and save
    // waits only for the one cut still undecided.
    const second = await buildReviewSurface(item, storage);
    const save = second.surface.querySelector('.import-save')! as ShimElement;
    expect(save.disabled).toBe(true); // the third cut still waits
    expect(
      second.surface.querySelectorAll('.import-cut.decided').map((sp) => sp.textContent),
    ).toEqual([item.cuts[0]!.text, item.cuts[1]!.text]);
    expect(second.surface.querySelector('.import-progress')!.textContent).toContain('1 of 3');

    focusCut(second.surface, 2);
    clickVerb(second.surface, 'keep');
    expect(save.disabled).toBe(false);
    save.click();
    await flush();

    // The receipt is the last screen, and the draft is gone: the piece is
    // decided, not parked.
    expect(second.surface.textContent).toContain('Kept, in your words:');
    expect(storage.getItem(draftKey)).toBeNull();
  });

  it('keys the draft by the piece: another piece never inherits a draft', async () => {
    const storage = makeStorageStub();
    const first = await buildReviewSurface(item, storage);
    focusCut(first.surface, 0);
    clickVerb(first.surface, 'keep');
    expect(storage.getItem(draftKey)).not.toBeNull();

    const other: ImportReviewItem = {
      ...item,
      hash: 'f0e9d8c7b6a554433221100',
      file: 'another-piece.md',
    };
    const second = await buildReviewSurface(other, storage);
    const save = second.surface.querySelector('.import-save')! as ShimElement;
    expect(save.disabled).toBe(true); // nothing hydrated across pieces
    expect(second.surface.querySelectorAll('.import-cut.decided')).toHaveLength(0);
    expect(storage.getItem(`elicit.review-drafts.${other.hash}`)).toBeNull();
  });

  it('drops a corrupt draft silently — a draft is a convenience, never a crash', async () => {
    const storage = makeStorageStub();
    storage.setItem(draftKey, '{not json');
    const { surface } = await buildReviewSurface(item, storage);
    const save = surface.querySelector('.import-save')! as ShimElement;
    expect(save.disabled).toBe(true); // hydrated nothing
    expect(surface.querySelectorAll('.import-cut.decided')).toHaveLength(0);
  });
});
