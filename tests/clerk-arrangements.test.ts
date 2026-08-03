/**
 * proposeArrangements — the one model call in the composition slice, and the
 * boundary it cannot cross (ticket 010, Task 11).
 *
 * A scripted fake Complete throughout (tests/fakes.ts): no live model
 * anywhere. The response JSON is the contract the prompt asks for — an
 * "orderings" array of { principle, sentence, order, roles, gaps } — and
 * every invariant in the plan's boundary table is pinned by a test below.
 */
import { describe, it, expect } from 'vitest';
import { ulid } from 'ulid';
import { proposeArrangements } from '../src/clerk/arrangements.js';
import { samePinSet } from '../src/piece/contract.js';
import type { Arrangement, Gap, Pin } from '../src/piece/contract.js';
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

const baseArrangement = (pins: Pin[] = basePins()): Arrangement => ({
  id: ulid(),
  principle: 'chronology',
  entries: pins,
  marginalia: [],
  created: '2026-08-02T00:00:00.000Z',
});

const ARG = {
  principle: 'argument',
  sentence: 'The page moves from the memory to the decision it forced.',
  order: ['c', 'a', 'b'],
  roles: { c: 'states the outcome', a: 'sets the scene', b: 'draws the consequence' },
};

const CON = {
  principle: 'contrast',
  sentence: 'Two ways of working sit against each other.',
  order: ['b', 'a', 'c'],
  roles: { b: 'names the first way', a: 'names the second', c: 'shows the cost' },
};

const response = (orderings: unknown[]): string => JSON.stringify({ orderings });

describe('proposeArrangements', () => {
  it('yields two candidates — argument and contrast — both permutations of the base pin set, model-stamped, with the skeleton Marginalia', async () => {
    const base = baseArrangement();
    const { candidates, dropped } = await proposeArrangements(
      base,
      allSnippets(),
      makeScriptedComplete([response([ARG, CON])]),
      { gapsPerCandidate: 3 },
      undefined,
      'deepseek-test',
    );

    expect(dropped).toEqual([]);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.principle)).toEqual(['argument', 'contrast']);

    for (const c of candidates) {
      // Q-34: every agent-authored artifact carries a model stamp.
      expect(c.model).toBe('deepseek-test');
      expect(typeof c.id).toBe('string');
      expect(c.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Entry ids are NEVER reused across candidates (Marginalia target them).
      const baseIds = new Set(base.entries.map((e) => e.id));
      for (const e of c.entries) {
        expect(baseIds.has(e.id)).toBe(false);
      }
      const ids = new Set(c.entries.map((e) => e.id));
      expect(ids.size).toBe(c.entries.length);
      // A permutation by snippet@version — nothing invented, nothing dropped,
      // no version changed.
      expect(samePinSet(base.entries, c.entries)).toBeNull();
      // One principle note on the Arrangement as a whole (on: null).
      const principles = c.marginalia.filter((m) => m.note === 'principle');
      expect(principles).toHaveLength(1);
      expect(principles[0]!.on).toBeNull();
      // One role note per pin, aimed at the candidate's OWN fresh entry id.
      const pins = c.entries.filter((e): e is Pin => e.kind === 'pin');
      expect(pins).toHaveLength(3);
      for (const p of pins) {
        const notes = c.marginalia.filter((m) => m.note === 'role' && m.on === p.id);
        expect(notes).toHaveLength(1);
      }
      expect(c.marginalia).toHaveLength(4);
    }

    const arg = candidates[0]!;
    expect(arg.entries.filter((e): e is Pin => e.kind === 'pin').map((p) => p.snippet)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(arg.marginalia.find((m) => m.note === 'principle')!.text).toBe(ARG.sentence);
    const roleByPin = new Map(
      arg.marginalia
        .filter((m) => m.note === 'role')
        .map((m) => {
          const pin = arg.entries.find((e): e is Pin => e.id === m.on && e.kind === 'pin')!;
          return [pin.snippet, m.text] as const;
        }),
    );
    expect(roleByPin.get('c')).toBe('states the outcome');
    expect(roleByPin.get('a')).toBe('sets the scene');
    expect(roleByPin.get('b')).toBe('draws the consequence');
  });

  it('drops a candidate that ADDS a pin with pin-set', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([response([{ ...ARG, order: ['a', 'b', 'c', 'd'] }])]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toEqual([]);
    expect(dropped).toEqual([{ principle: 'argument', reason: 'pin-set' }]);
  });

  it('drops a candidate that DROPS a pin with pin-set', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([response([{ ...ARG, order: ['a', 'b'] }])]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toEqual([]);
    expect(dropped).toEqual([{ principle: 'argument', reason: 'pin-set' }]);
  });

  it('drops a candidate that changes a pin\'s version with pin-set', async () => {
    const v2Snippets = allSnippets();
    v2Snippets.a = snippet('a', PROSE.a, 2);
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      v2Snippets,
      makeScriptedComplete([response([{ ...ARG, order: [{ snippet: 'a', version: 2 }, 'b', 'c'] }])]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toEqual([]);
    expect(dropped).toEqual([{ principle: 'argument', reason: 'pin-set' }]);
  });

  it('drops a candidate whose pin does not resolve with unresolved-pin', async () => {
    const ghostPins: Pin[] = [
      { id: ulid(), kind: 'pin', snippet: 'ghost', version: 1 },
      ...basePins().slice(1),
    ];
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(ghostPins),
      allSnippets(),
      makeScriptedComplete([response([{ ...ARG, order: ['ghost', 'b', 'c'] }])]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toEqual([]);
    expect(dropped).toEqual([{ principle: 'argument', reason: 'unresolved-pin' }]);
  });

  it('drops a response carrying a title with title', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([JSON.stringify({ title: 'My Essay', orderings: [ARG] })]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toEqual([]);
    expect(dropped).toEqual([{ principle: 'argument', reason: 'title' }]);
  });

  it('drops a response carrying a transition sentence as an entry with prose-in-body', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([
        response([{ ...ARG, order: ['c', { text: 'Moving from the memory to the decision' }, 'a', 'b'] }]),
      ]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toEqual([]);
    expect(dropped).toEqual([{ principle: 'argument', reason: 'prose-in-body' }]);
  });

  it('keeps the first of two candidates claiming the same principle and drops the duplicate', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([response([ARG, { ...CON, principle: 'argument' }])]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates.map((c) => c.principle)).toEqual(['argument']);
    expect(dropped).toEqual([{ principle: 'argument', reason: 'duplicate-principle' }]);
  });

  it('drops a candidate claiming chronology — the base already holds it', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([
        response([
          ARG,
          { principle: 'chronology', sentence: 'As it happened.', order: ['a', 'b', 'c'], roles: {} },
        ]),
      ]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates.map((c) => c.principle)).toEqual(['argument']);
    expect(dropped).toEqual([{ principle: 'chronology', reason: 'duplicate-principle' }]);
  });

  it('drops an ordering whose principle the set cannot hold', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([
        response([{ principle: 'theme', sentence: 'By theme.', order: ['a', 'b', 'c'], roles: {} }]),
      ]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toEqual([]);
    expect(dropped).toEqual([{ principle: 'theme', reason: 'duplicate-principle' }]);
  });

  it('drops a model gap whose question quotes no adjacent snippet, while its candidate survives', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([
        response([
          {
            ...ARG,
            order: ['a', 'b', 'c'],
            gaps: [{ after: 'a', question: 'What changed after the studio closed?' }],
          },
        ]),
      ]),
      { gapsPerCandidate: 3 },
    );
    expect(dropped).toEqual([{ principle: 'argument', reason: 'unquoted-gap' }]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.entries.filter((e) => e.kind === 'gap')).toHaveLength(0);
  });

  it('keeps a model gap whose question sets off an adjacent pin verbatim — pending, no question id', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([
        response([
          {
            ...ARG,
            order: ['a', 'b', 'c'],
            gaps: [
              { after: 'a', question: 'The studio "smelled of paint and coffee" — what did that room make possible?' },
            ],
          },
        ]),
      ]),
      { gapsPerCandidate: 3 },
    );
    expect(dropped).toEqual([]);
    const c = candidates[0]!;
    const gaps = c.entries.filter((e): e is Gap => e.kind === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.pending).toBe(
      'The studio "smelled of paint and coffee" — what did that room make possible?',
    );
    expect(gaps[0]!.question).toBeUndefined();
    // The gap sits immediately after its anchor pin.
    expect(c.entries.map((e) => e.kind)).toEqual(['pin', 'gap', 'pin', 'pin']);
  });

  it('drops a gap whose quote comes from a NON-adjacent pin — adjacency is what makes the rule meaningful', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([
        response([
          {
            ...ARG,
            order: ['c', 'a', 'b'],
            gaps: [{ after: 'b', question: '"The best work came" — when did you first notice that?' }],
          },
        ]),
      ]),
      { gapsPerCandidate: 3 },
    );
    expect(dropped).toEqual([{ principle: 'argument', reason: 'unquoted-gap' }]);
    expect(candidates[0]!.entries.filter((e) => e.kind === 'gap')).toHaveLength(0);
  });

  it('leaves three of five gaps standing — the Q-56 bound is a cap', async () => {
    const { candidates, dropped } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([
        response([
          {
            ...ARG,
            order: ['a', 'b', 'c'],
            gaps: [
              { after: 'a', question: 'The studio "smelled of paint and coffee" — what did that promise?' },
              { after: 'a', question: 'You came to "trust the quiet hours" — how did you keep them?' },
              { after: 'a', question: '"before anyone else arrived" — what did the empty room allow?' },
              { after: 'b', question: '"stopped checking the clock" — what changed then?' },
              { after: 'b', question: '"The best work came" — when did you first notice that?' },
            ],
          },
        ]),
      ]),
      { gapsPerCandidate: 3 },
    );
    expect(candidates).toHaveLength(1);
    const gaps = candidates[0]!.entries.filter((e): e is Gap => e.kind === 'gap');
    expect(gaps).toHaveLength(3);
    expect(dropped).toEqual([
      { principle: 'argument', reason: 'gap-cap' },
      { principle: 'argument', reason: 'gap-cap' },
    ]);
  });

  it('returns zero candidates, non-exceptionally, when the response is malformed', async () => {
    for (const garbage of ['not json', '{', '{"orderings": 12}', '{"unrelated": true}']) {
      const { candidates, dropped } = await proposeArrangements(
        baseArrangement(),
        allSnippets(),
        makeScriptedComplete([garbage]),
        { gapsPerCandidate: 3 },
      );
      expect(candidates).toEqual([]);
      expect(dropped).toEqual([]);
    }
  });

  it('never mutates the base Arrangement', async () => {
    const base = baseArrangement();
    const before = structuredClone(base);
    await proposeArrangements(base, allSnippets(), makeScriptedComplete([response([ARG, CON])]), {
      gapsPerCandidate: 3,
    });
    expect(base).toEqual(before);
  });

  it('emits arrangement-rejected per drop and arrangements-proposed with the surviving count', async () => {
    const events: { at: string; actor: string; kind: string; detail: string }[] = [];
    const log = (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => {
      events.push(e);
    };
    const { candidates } = await proposeArrangements(
      baseArrangement(),
      allSnippets(),
      makeScriptedComplete([response([{ ...ARG, order: ['a', 'b', 'c', 'd'] }, CON])]),
      { gapsPerCandidate: 3 },
      log,
      'model-x',
    );
    expect(candidates.map((c) => c.principle)).toEqual(['contrast']);
    expect(events.map((e) => e.kind)).toEqual(['arrangement-rejected', 'arrangements-proposed']);
    expect(events.every((e) => e.actor === 'clerk')).toBe(true);
    expect(events[0]!.detail).toBe('reason=pin-set principle=argument');
    expect(events[1]!.detail).toBe('count=1');
  });

  it('never throws: a failing model call returns zero candidates', async () => {
    await expect(
      proposeArrangements(
        baseArrangement(),
        allSnippets(),
        makeScriptedComplete([]),
        { gapsPerCandidate: 3 },
        undefined,
        'model-x',
      ),
    ).resolves.toEqual({ candidates: [], dropped: [] });
  });
});
