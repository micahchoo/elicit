/**
 * findGaps — the one model call in the composition slice (the gap sweep's
 * engine), and the boundary it cannot cross.
 *
 * A scripted fake Complete throughout (tests/fakes.ts): no live model
 * anywhere. The response JSON is the contract the prompt asks for — a
 * "gaps" array of { kind, after, question } — and every invariant in the
 * boundary is pinned by a test below, most of all the Q-12 guard that
 * moved WITH the gap-finding out of the ordering subsystem: a question
 * that quotes no adjacent paragraph is a generic writing prompt and is
 * refused.
 */
import { describe, it, expect } from 'vitest';
import { ulid } from 'ulid';
import { findGaps, type FoundGap } from '../src/clerk/arrangements.js';
import type { Entry, Gap, Pin } from '../src/piece/contract.js';
import type { Snippet } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';

const PROSE = {
  a: 'The studio smelled of paint and coffee every morning.',
  b: 'I learned to trust the quiet hours before anyone else arrived.',
  c: 'The best work came after I stopped checking the clock.',
  d: 'The year after, I worked alone and nothing came.',
};

const snippet = (id: string, prose: string, version = 1): Snippet => ({
  id,
  version,
  captured: '2026-05-01T10:00:00.000Z',
  provenance: { kind: 'harvest', session: 'sit-1', question: 'q', questionForm: 'theoretical' },
  prose,
});

const allSnippets = (): Record<string, Snippet> => ({
  a: snippet('a', PROSE.a),
  b: snippet('b', PROSE.b),
  c: snippet('c', PROSE.c),
  d: snippet('d', PROSE.d),
});

const basePins = (): Pin[] => [
  { id: ulid(), kind: 'pin', snippet: 'a', version: 1 },
  { id: ulid(), kind: 'pin', snippet: 'b', version: 1 },
  { id: ulid(), kind: 'pin', snippet: 'c', version: 1 },
];

/** A composition's entries: three pins, as the sweep hands them in. */
const baseEntries = (): Entry[] => basePins();

const LEAP = { kind: 'leap', after: 'a', question: 'The studio "smelled of paint and coffee" — what did that room make possible?' };
const THIN = { kind: 'thin', after: 'b', question: 'You "trust the quiet hours" — what does the quiet actually buy you?' };
const UNCLOSED = { kind: 'unclosed', after: 'c', question: '"The best work came" — when did you first notice that?' };

const response = (gaps: unknown[]): string => JSON.stringify({ gaps });

describe('findGaps', () => {
  it('yields up to gapsPerPass seams of distinct kinds, each quoting an adjacent pin', async () => {
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([response([LEAP, THIN, UNCLOSED])]),
      { gapsPerPass: 3 },
    );
    expect(dropped).toEqual([]);
    expect(gaps).toEqual([LEAP, THIN, UNCLOSED]);
    // The kinds are distinct by construction of the fixtures, but the gate
    // is the contract: a pass is capped AND kinds must differ.
    expect(new Set(gaps.map((g) => g.kind)).size).toBe(gaps.length);
  });

  it('drops a gap whose kind the sequence cannot hold with unknown-kind', async () => {
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([response([{ ...LEAP, kind: 'theme' }])]),
      { gapsPerPass: 3 },
    );
    expect(gaps).toEqual([]);
    expect(dropped).toEqual([{ kind: 'theme', reason: 'unknown-kind' }]);
  });

  it('drops a gap anchored on a snippet that is not pinned with unknown-anchor', async () => {
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([response([{ ...LEAP, after: 'ghost' }])]),
      { gapsPerPass: 3 },
    );
    expect(gaps).toEqual([]);
    expect(dropped).toEqual([{ kind: 'leap', reason: 'unknown-anchor' }]);
  });

  it('drops a gap whose question quotes no adjacent snippet with unquoted-gap', async () => {
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([response([{ ...LEAP, question: 'What changed after the studio closed?' }])]),
      { gapsPerPass: 3 },
    );
    expect(gaps).toEqual([]);
    expect(dropped).toEqual([{ kind: 'leap', reason: 'unquoted-gap' }]);
  });

  it('keeps a gap whose question sets off an adjacent pin verbatim — the Q-12 guard passes', async () => {
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([response([LEAP])]),
      { gapsPerPass: 3 },
    );
    expect(dropped).toEqual([]);
    expect(gaps).toEqual([LEAP]);
  });

  it('drops a gap whose quote comes from a NON-adjacent pin — adjacency is what makes the rule meaningful', async () => {
    // The gap follows `a`; the quote is from `c`, which is not adjacent.
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([
        response([{ kind: 'leap', after: 'a', question: '"The best work came" — when did you first notice that?' }]),
      ]),
      { gapsPerPass: 3 },
    );
    expect(gaps).toEqual([]);
    expect(dropped).toEqual([{ kind: 'leap', reason: 'unquoted-gap' }]);
  });

  it('drops a second gap of a kind already admitted with duplicate-kind', async () => {
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([
        response([
          LEAP,
          { kind: 'leap', after: 'b', question: 'You "trust the quiet hours" — how did you keep them?' },
        ]),
      ]),
      { gapsPerPass: 3 },
    );
    expect(gaps).toEqual([LEAP]);
    expect(dropped).toEqual([{ kind: 'leap', reason: 'duplicate-kind' }]);
  });

  it('leaves gapsPerPass of more gaps standing — the cap is a cap', async () => {
    const { gaps, dropped } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([
        response([
          LEAP,
          THIN,
          UNCLOSED,
          { kind: 'unsupported', after: 'a', question: 'The studio "smelled of paint and coffee" — what did that promise?' },
        ]),
      ]),
      { gapsPerPass: 3 },
    );
    expect(gaps).toHaveLength(3);
    expect(gaps.map((g) => g.kind)).toEqual(['leap', 'thin', 'unclosed']);
    expect(dropped).toEqual([{ kind: 'unsupported', reason: 'gap-cap' }]);
  });

  it('returns zero gaps, non-exceptionally, when the response is malformed', async () => {
    for (const garbage of ['not json', '{', '{"gaps": 12}', '{"unrelated": true}']) {
      const { gaps, dropped } = await findGaps(
        baseEntries(),
        allSnippets(),
        makeScriptedComplete([garbage]),
        { gapsPerPass: 3 },
      );
      expect(gaps).toEqual([]);
      expect(dropped).toEqual([]);
    }
  });

  it('never mutates the entries passed in', async () => {
    const entries = baseEntries();
    const before = structuredClone(entries);
    await findGaps(entries, allSnippets(), makeScriptedComplete([response([LEAP, THIN])]), {
      gapsPerPass: 3,
    });
    expect(entries).toEqual(before);
  });

  it('never throws: a failing model call returns zero gaps', async () => {
    await expect(
      findGaps(baseEntries(), allSnippets(), makeScriptedComplete([]), { gapsPerPass: 3 }),
    ).resolves.toEqual({ gaps: [], dropped: [] });
  });

  it('the returned gaps are the sweep\'s shape: kind + anchor + verified question, nothing else', async () => {
    const { gaps } = await findGaps(
      baseEntries(),
      allSnippets(),
      makeScriptedComplete([response([LEAP])]),
      { gapsPerPass: 3 },
    );
    const g: FoundGap = gaps[0]!;
    expect(Object.keys(g).sort()).toEqual(['after', 'kind', 'question']);
    // No queue reach: no id, no mint, no pending — the sweep stores the
    // gap and the person's 'ask this' mints (Q-39).
    expect('pending' in g).toBe(false);
    expect('question' in g).toBe(true);
  });

  it('ignores gaps in the sequence — the seams sit between pins', async () => {
    const withHole: Entry[] = [
      basePins()[0]!,
      { id: ulid(), placedBy: 'person' } as Gap,
      basePins()[1]!,
      basePins()[2]!,
    ];
    const { gaps, dropped } = await findGaps(
      withHole,
      allSnippets(),
      makeScriptedComplete([response([LEAP, THIN])]),
      { gapsPerPass: 3 },
    );
    expect(gaps).toHaveLength(2);
    expect(dropped).toEqual([]);
  });
});
