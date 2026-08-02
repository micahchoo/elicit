import { describe, it, expect } from 'vitest';
import {
  buildReviewSurface,
  clickExclude,
  confirmExclude,
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
    expect(verbLabels(surface)).toEqual(['approve', 'trim', 'discard']);
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
    expect(nav).toContain('mode');
  });

  it('keeps save disabled until every cut has a decision, then sends one per cut', async () => {
    const { surface, sent, nav } = await buildReviewSurface(item);
    const save = surface.querySelector('.import-save')! as ShimElement;
    expect(save.disabled).toBe(true);

    focusCut(surface, 0);
    expect(visibleVerbs(surface)).toEqual(['approve', 'trim', 'discard']);
    clickVerb(surface, 'approve');
    expect(save.disabled).toBe(true); // cuts 1 and 2 still undecided

    focusCut(surface, 1);
    clickVerb(surface, 'trim');
    const editor = surface.querySelector('.import-trim-editor')! as ShimElement;
    expect(editor.value).toBe(item.cuts[1]!.text); // pre-filled with the cut
    editor.value = 'I keep coming back to this piece';
    surface.querySelector('.import-trim-confirm')!.click();
    expect(save.disabled).toBe(true);

    focusCut(surface, 2);
    clickVerb(surface, 'discard');
    expect(save.disabled).toBe(false);

    save.click();
    await flush(); // the POST chain and navTo land on the microtask queue
    const last = sent[sent.length - 1]!;
    expect(last.path).toBe(`/api/import/${HASH}/decisions`);
    expect(last.body).toEqual({
      decisions: [
        { cut: 0, action: 'approve' },
        { cut: 1, action: 'trim', text: 'I keep coming back to this piece' },
        { cut: 2, action: 'discard' },
      ],
    });
    expect(nav).toContain('mode');
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
    expect(nav).toContain('mode');
  });
});
