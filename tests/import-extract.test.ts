import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { createImportStore, type ImportStore } from '../src/import/store.js';
import { bodyHash } from '../src/import/scan.js';
import { clean, dropCitedParagraphs, toTurns } from '../src/import/body.js';
import { runImportExtraction, type ExtractionDeps } from '../src/import/extract.js';
import { quotedSpans } from '../src/harvester/admissibility.js';
import { makeScriptedComplete } from './fakes.js';
import type { Complete } from '../src/types.js';

/**
 * The committed fixture. These tests NEVER mutate it — the records point at
 * the real files, and `readSource` re-reads them the way the job does.
 */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import-folder');

const raw = (name: string): string => readFileSync(join(FIXTURE, name), 'utf-8');
const bodyOf = (name: string): string => matter(raw(name)).content;
const hashOf = (name: string): string => bodyHash(bodyOf(name));

const datedHash = hashOf('dated-essay.md');
const quotedHash = hashOf('quoted.md');

/** quoted.md paragraph 4's tail: the opening “ sat on a blockquote line that
 * `clean` removes from INSIDE the paragraph, so the prepared turn keeps a
 * closing mark with no opening one (the raw-source Q-51 case). */
const ORPHANED_TAIL = 'and the histories that count as encyclopaedic are chosen, not found.';

const FIRST_SITTING_SENTENCE = 'I keep coming back to this piece when I want to remember why I started.';
const NEW_SENTENCE = 'I have been rereading it with the years behind me, and the argument holds.';

/** One scripted proposal, shaped exactly as the real model's JSON emits it. */
type ScriptedCut = {
  text: string;
  sourceTurn: number;
  facet: string;
  stance: string;
  reading: string;
  standalone: boolean;
};

const cut = (text: string): ScriptedCut => ({
  text,
  sourceTurn: 0,
  facet: 'value',
  stance: 'commitment',
  reading: 'the person states a position they hold',
  standalone: true,
});

/** One `complete()` response string. `{"cuts":[]}` is an honest empty answer. */
const response = (...cuts: ScriptedCut[]): string => JSON.stringify({ cuts });

/** The four prepared turns of dated-essay.md, one response each. The second
 * response carries the paragraph that became ADJACENT only after `clean`
 * removed the image line — a valid cut of the prepared turn that is NOT a
 * substring of the source body, so the extract-time substring check must drop
 * it. */
const datedResponses = (): string[] => [
  response(cut('I wrote this essay in September 2018, and I still stand by most of it.')),
  response(cut('The middle of the argument is where the image sits, and it earns its place\nby showing what a paragraph of prose could not.')),
  response(cut(FIRST_SITTING_SENTENCE)),
  response(cut('The last paragraph ties the first three together, and I have left it here.')),
];

const fixtureItems = [
  { hash: hashOf('dated-essay.md'), sourcePath: join(FIXTURE, 'dated-essay.md'), date: '2018-09-01', title: 'A dated essay', body: bodyOf('dated-essay.md') },
  { hash: hashOf('quoted.md'), sourcePath: join(FIXTURE, 'quoted.md'), date: '2020-03-01', title: 'Care in practice', body: bodyOf('quoted.md') },
  { hash: hashOf('co-authored.md'), sourcePath: join(FIXTURE, 'co-authored.md'), date: '2022-01-01', title: 'What we built together', body: bodyOf('co-authored.md') },
];

let root: string;
let store: ImportStore;
let logs: { kind: string; detail: string }[];

const readSource = (p: string): string => readFileSync(p, 'utf-8');

function deps(complete: Complete): ExtractionDeps {
  return {
    store,
    complete,
    readSource,
    log: (e) => {
      logs.push({ kind: e.kind, detail: e.detail });
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'import-extract-'));
  store = createImportStore(root);
  logs = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('import extraction (the real harvest path, ahead of review)', () => {
  it('proposes cuts and marks the record extracted', async () => {
    store.admit([fixtureItems[0]!]);
    const r = await runImportExtraction(deps(makeScriptedComplete(datedResponses())));
    expect(r.extracted).toBe(1);
    expect(store.get(datedHash)!.status).toBe('extracted');
    const texts = store.get(datedHash)!.cuts!.map((c) => c.text);
    expect(texts).toContain('I wrote this essay in September 2018, and I still stand by most of it.');
    // The paragraph that became adjacent only after `clean` removed the image
    // line is NOT an exact substring of the source body — dropped here, never
    // carried to review.
    expect(texts).not.toContain(
      'The middle of the argument is where the image sits, and it earns its place\nby showing what a paragraph of prose could not.',
    );
  });

  it('drops a cut whose quotation is only visible in the raw file', async () => {
    store.admit([fixtureItems[1]!]);
    // Response 3 goes to the tail's own turn: the substring check passes, the
    // turn-scoped quoted check sees no span (the opening mark is gone), and
    // the cut is dropped — by the raw-source check, which is the only one
    // that can see it.
    await runImportExtraction(
      deps(makeScriptedComplete([response(), response(), response(cut(ORPHANED_TAIL)), response()])),
    );
    expect(store.get(quotedHash)!.cuts!.map((c) => c.text)).not.toContain(ORPHANED_TAIL);
  });

  it('proves the turn-scoped check alone would have passed that cut', () => {
    // Guards the test above against becoming vacuous: if the prepared turn
    // ever starts yielding a span that COVERS THIS CUT, the raw-source check
    // has stopped doing distinct work and the invariant it defends lives
    // elsewhere.
    //
    // Scoped to this cut's span on purpose. The prepared turn legitimately
    // holds other spans — quoted.md paragraph 2 survives preparation by
    // design, which is what makes it the turn-scoped case — so asserting the
    // turn has NO spans would assert against the fixture rather than against
    // the behaviour.
    const preparedTurnText = toTurns(
      dropCitedParagraphs(clean(bodyOf('quoted.md'), false)).kept,
      '2020-03-01T00:00:00.000Z',
    )
      .map((t) => t.text)
      .join('\n\n');
    expect(quotedSpans(preparedTurnText).some((s) => s.includes(ORPHANED_TAIL))).toBe(false);
    expect(quotedSpans(raw('quoted.md')).some((s) => s.includes(ORPHANED_TAIL))).toBe(true);
  });

  it('does not re-propose a cut already kept from the same source path (Q-59)', async () => {
    const P = join(root, 'edited.md');
    const editedBody =
      'I wrote this essay in September 2018, and I still stand by most of it. ' +
      `${FIRST_SITTING_SENTENCE} ` +
      'The last paragraph ties the first three together, and I have left it here. ' +
      NEW_SENTENCE;
    writeFileSync(P, `---\ndate: 2021-01-15\nlastmod: 2021-01-15\n---\n${editedBody}\n`);
    store.put({ hash: 'aaaaaaaaaaaa', sourcePath: P, date: '2018-09-01', status: 'accepted', attempts: 0, kept: [FIRST_SITTING_SENTENCE] });
    const secondHash = bodyHash(editedBody);
    store.put({ hash: secondHash, sourcePath: P, date: '2021-01-15', lastmod: '2021-01-15', status: 'pending', attempts: 0 }, editedBody);
    // One response, both cuts: the sentence the first sitting already kept and
    // the sentence the edit added. Only the new one survives the dedupe.
    await runImportExtraction(
      deps(makeScriptedComplete([response(cut(FIRST_SITTING_SENTENCE), cut(NEW_SENTENCE))])),
    );
    const texts = store.get(secondHash)!.cuts!.map((c) => c.text);
    expect(texts).toEqual([NEW_SENTENCE]);
  });

  it('records every cut at its offset in the source body, earliest occurrence first', async () => {
    store.admit([fixtureItems[0]!]);
    await runImportExtraction(deps(makeScriptedComplete(datedResponses())));
    const sourceBody = bodyOf('dated-essay.md');
    for (const c of store.get(datedHash)!.cuts!) {
      expect(sourceBody.slice(c.at, c.at + c.text.length)).toBe(c.text);
    }
  });

  it('honours the per-run budget and reports what remains', async () => {
    store.admit(fixtureItems);
    const extra1 = { hash: 'eeeeeeeeeeee', sourcePath: join(root, 'extra-one.md'), date: '2023-01-01', body: 'A fourth post.' };
    const extra2 = { hash: 'ffffffffffff', sourcePath: join(root, 'extra-two.md'), date: '2024-01-01', body: 'A fifth post.' };
    store.admit([extra1, extra2]);
    writeFileSync(join(root, 'extra-one.md'), '---\ndate: 2023-01-01\n---\nA fourth post.\n');
    writeFileSync(join(root, 'extra-two.md'), '---\ndate: 2024-01-01\n---\nA fifth post.\n');
    // The two oldest items (dated-essay, quoted) have four prepared turns
    // each — eight model calls, all answered with an honest empty harvest.
    const r = await runImportExtraction({ ...deps(makeScriptedComplete(Array(8).fill(response()))), budget: 2 });
    expect(r).toMatchObject({ extracted: 2, remaining: 3 });
    // The budget clipped with work still pending — the live bound spoke (Q-56).
    expect(logs.map((e) => e.kind)).toContain('threshold-clipped');
  });

  it('fails an item after three attempts instead of blocking the head of the queue', async () => {
    store.admit([fixtureItems[0]!]);
    const throwing = deps(async () => {
      throw new Error('model down');
    });
    for (let i = 0; i < 3; i++) await runImportExtraction(throwing);
    const rec = store.get(datedHash)!;
    expect(rec.status).toBe('failed');
    expect(rec.failure).toContain('model down');
  });

  it('writes nothing to the corpus', async () => {
    store.admit([fixtureItems[0]!]);
    await runImportExtraction(deps(makeScriptedComplete(datedResponses())));
    expect(existsSync(join(root, 'snippets'))).toBe(false);
    expect(existsSync(join(root, 'transcripts'))).toBe(false);
  });
});
