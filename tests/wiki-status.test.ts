import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeStatus, coreness } from '../src/wiki/status.js';
import type { Claim, ClaimGraph, Contradiction, LogFn } from '../src/wiki/contract.js';
import type { Facet, Reading, Snippet } from '../src/types.js';

/**
 * T4's tests exist to hold ONE line: nothing here may come from a model, and
 * every status is arithmetic over the graph. So the oracles are hand-built
 * fixtures whose arithmetic is obvious by inspection, never the implementation.
 *
 * The sharpest case is Q-50. A claim can carry three cites, to three different
 * snippets, and still be `unconfirmed` — because all three came from one
 * sitting, which is one thought said three times. That case is asserted
 * separately from the two-versions-of-one-snippet case (Q-5), because an
 * implementation that only deduped snippet ids would pass the second and fail
 * the first, and the first is the rule that was corrected.
 */

const T0 = '2026-01-01T00:00:00.000Z';

type Over<T> = Partial<T>;

function snip(id: string, session: string, over: Over<Snippet> = {}): Snippet {
  return {
    id,
    version: 1,
    captured: T0,
    provenance: {
      kind: 'harvest',
      session,
      question: 'what did you do?',
      questionForm: 'deliberative',
    },
    prose: `the prose of ${id}`,
    ...over,
  };
}

type ClaimOver = Partial<
  Pick<
    Claim,
    'body' | 'range' | 'status' | 'facet' | 'referents' | 'fromReadings' | 'attested' | 'readLog'
  >
>;

function claim(id: string, cites: string[], over: ClaimOver = {}): Claim {
  return {
    id,
    body: `the claim ${id}`,
    range: 'when he is tired',
    status: 'unconfirmed',
    cites,
    facet: 'construct',
    referents: [],
    fromReadings: [],
    attested: false,
    readLog: [],
    model: 'test-model',
    modelAt: T0,
    created: T0,
    updated: T0,
    ...over,
  };
}

function reading(id: string, facet: Facet, cites: string[]): Reading {
  return { id, facet, stance: 'avowal', cites, reading: `reading ${id}`, at: T0 };
}

function contradiction(
  id: string,
  claims: [string, string],
  status: Contradiction['status'],
): Contradiction {
  return {
    id,
    type: 'synchronic',
    claims,
    candidate: 'cand1',
    remeasureQueueId: 'q1',
    evidence: { snippetRef: 's1@1', quote: 'a quote', side: 'a' },
    status,
    model: 'test-model',
    modelAt: T0,
    opened: T0,
    updated: T0,
    body: 'two poles',
  };
}

function graph(parts: Partial<ClaimGraph> = {}): ClaimGraph {
  return {
    claims: [],
    snippets: {},
    readings: {},
    contradictions: [],
    referents: [],
    ...parts,
  };
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

function collect(): { events: Parameters<LogFn>[0][]; log: LogFn } {
  const events: Parameters<LogFn>[0][] = [];
  return { events, log: (e) => void events.push(e) };
}

// ── Q-50: independence is cross-sitting ──

describe('computeStatus — evidence arithmetic (Q-50)', () => {
  it('one cite is one piece of evidence', () => {
    const c = claim('c1', ['s1@1']);
    const g = graph({ claims: [c], snippets: byId([snip('s1', 'sitting-a')]) });

    const r = computeStatus(c, g);

    expect(r.live).toBe('unconfirmed');
    expect(r.shadow).toBe('unconfirmed');
    expect(r.why).toBe('unconfirmed: 1 sitting across 1 cite');
  });

  it('two versions of one snippet are one piece of evidence (Q-5)', () => {
    const c = claim('c1', ['s1@1', 's1@2']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a', { version: 2 })]),
    });

    const r = computeStatus(c, g);

    expect(r.live).toBe('unconfirmed');
    expect(r.why).toBe('unconfirmed: 1 sitting across 2 cites');
  });

  it('two DISTINCT snippets from the SAME sitting are one piece of evidence', () => {
    // The case the plan's first draft got wrong: one thought said twice.
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-a')]),
    });

    const r = computeStatus(c, g);

    expect(r.live).toBe('unconfirmed');
    expect(r.why).toBe('unconfirmed: 1 sitting across 2 cites');
  });

  it('three distinct snippets from one sitting are still one piece of evidence', () => {
    const c = claim('c1', ['s1@1', 's2@1', 's3@1']);
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a'),
        snip('s2', 'sitting-a'),
        snip('s3', 'sitting-a'),
      ]),
    });

    expect(computeStatus(c, g).live).toBe('unconfirmed');
  });

  it('two snippets from distinct sittings reach evidenced', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
    });

    const r = computeStatus(c, g);

    expect(r.live).toBe('evidenced');
    expect(r.shadow).toBe('evidenced');
    expect(r.why).toBe('evidenced: 2 sittings');
  });

  it('names the stronger tier when the sittings are also separated by Facet', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
      readings: byId([
        reading('r1', 'episode', ['s1@1']),
        reading('r2', 'value', ['s2@1']),
      ]),
    });

    expect(computeStatus(c, g).why).toBe('evidenced: 2 sittings, 2 facets');
  });

  it('does not claim a facet tier when both readings read the same Facet', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
      readings: byId([
        reading('r1', 'episode', ['s1@1']),
        reading('r2', 'episode', ['s2@1']),
      ]),
    });

    expect(computeStatus(c, g).why).toBe('evidenced: 2 sittings');
  });

  it('names the question-source tier when the questions came from different deck blocks', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a', {
          provenance: {
            kind: 'harvest',
            session: 'sitting-a',
            question: 'q1',
            questionForm: 'deliberative',
            questionSource: { channel: 'episodes', blockId: 4 },
          },
        }),
        snip('s2', 'sitting-b', {
          provenance: {
            kind: 'harvest',
            session: 'sitting-b',
            question: 'q2',
            questionForm: 'why',
            questionSource: { channel: 'values', blockId: 9 },
          },
        }),
      ]),
    });

    expect(computeStatus(c, g).why).toBe('evidenced: 2 sittings, 2 question sources');
  });

  it('a cited snippet with no session is its own sitting, never a match for another', () => {
    // Absent is not equal. Two sessionless snippets are two sittings, not one.
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', ''), snip('s2', '')]),
    });

    expect(computeStatus(c, g).live).toBe('evidenced');
  });

  it('a sessionless snippet does not merge with a named sitting either', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', ''), snip('s2', 'sitting-a')]),
    });

    expect(computeStatus(c, g).live).toBe('evidenced');
  });

  it('a cite naming a version the graph does not hold is not evidence', () => {
    // ClaimGraph.snippets holds only the LATEST version, so resolving is a
    // `version <= latest` comparison — @3 against a latest of @1 names nothing.
    const c = claim('c1', ['s1@1', 's2@3']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
    });

    const r = computeStatus(c, g);

    expect(r.live).toBe('unconfirmed');
    expect(r.why).toBe('unconfirmed: 1 sitting across 1 cite (1 unresolved)');
  });

  it('an older version of a snippet still resolves — stale is not fabricated', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a', { version: 4 }), snip('s2', 'sitting-b')]),
    });

    expect(computeStatus(c, g).live).toBe('evidenced');
  });

  it('a cite to a snippet the graph does not hold at all is not evidence', () => {
    const c = claim('c1', ['ghost@1']);
    const g = graph({ claims: [c], snippets: {} });

    const r = computeStatus(c, g);

    expect(r.live).toBe('unconfirmed');
    expect(r.why).toBe('unconfirmed: no resolvable cites (1 unresolved)');
  });

  it('is total on a claim with no cites at all', () => {
    const c = claim('c1', []);
    const g = graph({ claims: [c] });

    const r = computeStatus(c, g);

    expect(r.live).toBe('unconfirmed');
    expect(r.why).toBe('unconfirmed: no cites');
  });
});

// ── Precedence ──

describe('computeStatus — precedence', () => {
  it('attestation outranks the cite count', () => {
    const c = claim('c1', ['s1@1'], { attested: true });
    const g = graph({ claims: [c], snippets: byId([snip('s1', 'sitting-a')]) });

    const r = computeStatus(c, g);

    expect(r.live).toBe('user-attested');
    expect(r.shadow).toBe('user-attested');
    expect(r.why).toBe('user-attested: set by a user verb');
  });

  it('attestation outranks evidenced too', () => {
    const c = claim('c1', ['s1@1', 's2@1'], { attested: true });
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
    });

    expect(computeStatus(c, g).live).toBe('user-attested');
  });

  it('membership in an open Contradiction outranks attestation', () => {
    const a = claim('a', ['s1@1'], { attested: true });
    const b = claim('b', ['s2@1']);
    const g = graph({
      claims: [a, b],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
      contradictions: [contradiction('k1', ['a', 'b'], 'open')],
    });

    const r = computeStatus(a, g);

    expect(r.live).toBe('contested');
    expect(r.shadow).toBe('contested');
    expect(r.why).toBe('contested: member of open Contradiction k1');
  });

  it('a third claim citing snippets from BOTH sides is contested', () => {
    const a = claim('a', ['s1@1']);
    const b = claim('b', ['s2@1']);
    const third = claim('c', ['s1@1', 's2@1']);
    const g = graph({
      claims: [a, b, third],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
      contradictions: [contradiction('k1', ['a', 'b'], 'open')],
    });

    const r = computeStatus(third, g);

    expect(r.live).toBe('contested');
    expect(r.why).toBe('contested: cites snippet versions from both sides of open Contradiction k1');
  });

  it('a third claim citing only ONE side is untouched', () => {
    const a = claim('a', ['s1@1']);
    const b = claim('b', ['s2@1']);
    const third = claim('c', ['s1@1', 's3@1']);
    const g = graph({
      claims: [a, b, third],
      snippets: byId([
        snip('s1', 'sitting-a'),
        snip('s2', 'sitting-b'),
        snip('s3', 'sitting-c'),
      ]),
      contradictions: [contradiction('k1', ['a', 'b'], 'open')],
    });

    expect(computeStatus(third, g).live).toBe('evidenced');
  });

  it('a dissolved Contradiction contests nobody — not its members, not a third claim', () => {
    const a = claim('a', ['s1@1']);
    const b = claim('b', ['s2@1']);
    const third = claim('c', ['s1@1', 's2@1']);
    const g = graph({
      claims: [a, b, third],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
      contradictions: [contradiction('k1', ['a', 'b'], 'dissolved')],
    });

    expect(computeStatus(a, g).live).toBe('unconfirmed');
    expect(computeStatus(third, g).live).toBe('evidenced');
  });

  it('shares a cite with only one side when the versions differ — not contested', () => {
    // The translation is "a snippet VERSION cited by A and one cited by B".
    // Narrow on purpose: contesting is a demotion, so the near-miss stays live.
    const a = claim('a', ['s1@2']);
    const b = claim('b', ['s2@1']);
    const third = claim('c', ['s1@1', 's2@1']);
    const g = graph({
      claims: [a, b, third],
      snippets: byId([snip('s1', 'sitting-a', { version: 2 }), snip('s2', 'sitting-b')]),
      contradictions: [contradiction('k1', ['a', 'b'], 'open')],
    });

    expect(computeStatus(third, g).live).toBe('evidenced');
  });
});

// ── The read-log discount, in shadow (Q-21, Q-35) ──

describe('computeStatus — the read-log discount ships in shadow', () => {
  const readClaim = (cites: string[]): Claim =>
    claim('c1', cites, { readLog: [{ at: '2026-03-01T00:00:00.000Z', surface: 'wiki' }] });

  it('a cite captured after the user read the claim changes shadow but not live', () => {
    const c = readClaim(['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a', { captured: '2026-02-01T00:00:00.000Z' }),
        snip('s2', 'sitting-b', { captured: '2026-04-01T00:00:00.000Z' }),
      ]),
    });

    const r = computeStatus(c, g);

    expect(r.live).toBe('evidenced');
    expect(r.shadow).toBe('unconfirmed');
    expect(r.why).toBe('evidenced: 2 sittings (shadow: unconfirmed, 1 cite discounted by read-log)');
  });

  it('a cite captured before the read is not discounted', () => {
    const c = readClaim(['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a', { captured: '2026-02-01T00:00:00.000Z' }),
        snip('s2', 'sitting-b', { captured: '2026-02-02T00:00:00.000Z' }),
      ]),
    });

    const r = computeStatus(c, g);

    expect(r.live).toBe('evidenced');
    expect(r.shadow).toBe('evidenced');
    expect(r.why).toBe('evidenced: 2 sittings');
  });

  it('the EARLIEST read is the cut — a later read does not un-discount an earlier one', () => {
    const c = claim('c1', ['s1@1', 's2@1'], {
      readLog: [
        { at: '2026-05-01T00:00:00.000Z', surface: 'wiki' },
        { at: '2026-03-01T00:00:00.000Z', surface: 'wiki' },
      ],
    });
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a', { captured: '2026-02-01T00:00:00.000Z' }),
        snip('s2', 'sitting-b', { captured: '2026-04-01T00:00:00.000Z' }),
      ]),
    });

    expect(computeStatus(c, g).shadow).toBe('unconfirmed');
  });

  it('logs the shadowed decision, naming the threshold and the delta', () => {
    const c = readClaim(['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a', { captured: '2026-02-01T00:00:00.000Z' }),
        snip('s2', 'sitting-b', { captured: '2026-04-01T00:00:00.000Z' }),
      ]),
    });
    const { events, log } = collect();

    computeStatus(c, g, log);

    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('shadow-decision');
    expect(e.actor).toBe('clerk');
    expect(e.detail).toContain('threshold=status.readLogDiscount');
    expect(e.detail).toContain('evidenced');
    expect(e.detail).toContain('unconfirmed');
    expect(e.refs).toEqual(['c1']);
  });

  it('logs nothing when no cite is discounted — a non-decision is not evidence', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
    });
    const { events, log } = collect();

    computeStatus(c, g, log);

    expect(events).toEqual([]);
  });

  it('a discount that changes no status is still recorded, with no delta in why', () => {
    const c = readClaim(['s1@1', 's2@1', 's3@1']);
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a', { captured: '2026-02-01T00:00:00.000Z' }),
        snip('s2', 'sitting-b', { captured: '2026-02-02T00:00:00.000Z' }),
        snip('s3', 'sitting-c', { captured: '2026-04-01T00:00:00.000Z' }),
      ]),
    });
    const { events, log } = collect();

    const r = computeStatus(c, g, log);

    expect(r.live).toBe('evidenced');
    expect(r.shadow).toBe('evidenced');
    expect(r.why).toBe('evidenced: 3 sittings');
    expect(events).toHaveLength(1);
  });
});

// ── Purity, totality, and the one line this module holds ──

describe('computeStatus — pure, total, and model-free', () => {
  it('mutates neither the claim nor the graph', () => {
    const c = claim('c1', ['s1@1', 's2@1'], {
      readLog: [{ at: '2026-03-01T00:00:00.000Z', surface: 'wiki' }],
    });
    const g = graph({
      claims: [c],
      snippets: byId([
        snip('s1', 'sitting-a', { captured: '2026-02-01T00:00:00.000Z' }),
        snip('s2', 'sitting-b', { captured: '2026-04-01T00:00:00.000Z' }),
      ]),
      contradictions: [contradiction('k1', ['x', 'y'], 'open')],
    });
    deepFreeze(c);
    deepFreeze(g);

    expect(() => computeStatus(c, g)).not.toThrow();
    expect(c.status).toBe('unconfirmed');
  });

  it('is deterministic across repeated calls on one input', () => {
    const c = claim('c1', ['s1@1', 's2@1']);
    const g = graph({
      claims: [c],
      snippets: byId([snip('s1', 'sitting-a'), snip('s2', 'sitting-b')]),
    });

    expect(computeStatus(c, g)).toEqual(computeStatus(c, g));
  });

  it('returns only the three declared keys — nothing a caller could persist by accident', () => {
    const c = claim('c1', ['s1@1']);
    const g = graph({ claims: [c], snippets: byId([snip('s1', 'sitting-a')]) });

    expect(Object.keys(computeStatus(c, g)).sort()).toEqual(['live', 'shadow', 'why']);
  });

  it('the module reads no model and touches no filesystem', () => {
    // Q-29's whole point: no status in this slice can trace to model output.
    // The oracle is the source text, because an import is the only way one
    // could get in and a grep is the only test that sees an import.
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'wiki', 'status.ts'), 'utf8');

    expect(src).not.toMatch(/from '\.\.\/llm/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/\bcomplete\s*\(/);
    expect(src).not.toMatch(/\bComplete\b/);
  });
});

// ── coreness: computed, never stored (Q-21) ──

describe('coreness', () => {
  const web = (): ClaimGraph =>
    graph({
      claims: [
        claim('hub', ['s1@1', 's2@1']),
        claim('near', ['s2@1', 's3@1']),
        claim('far', ['s3@1', 's4@1']),
        claim('island', ['s9@1']),
      ],
      snippets: byId([
        snip('s1', 'a'),
        snip('s2', 'a'),
        snip('s3', 'b'),
        snip('s4', 'b'),
        snip('s9', 'c'),
      ]),
    });

  it('a claim in the citation web outranks an isolated one', () => {
    const g = web();

    expect(coreness('hub', g)).toBeGreaterThan(coreness('island', g));
  });

  it('normalizes to the graph max, so the top claim is exactly 1', () => {
    const g = web();

    // hub reaches s1,s2 (itself) + s3 (near, 1 hop) + s4 (far, 2 hops) = 4,
    // which is the max in this graph, so hub normalizes to 1.
    expect(coreness('hub', g)).toBe(1);
    expect(coreness('island', g)).toBe(0.25);
  });

  it('stops at two hops', () => {
    // A chain of five claims: from the head, the tail's private snippet is
    // three hops away and must not be counted.
    const g = graph({
      claims: [
        claim('c1', ['s1@1', 's2@1']),
        claim('c2', ['s2@1', 's3@1']),
        claim('c3', ['s3@1', 's4@1']),
        claim('c4', ['s4@1', 's5@1']),
        claim('c5', ['s5@1', 's6@1']),
      ],
      snippets: byId([1, 2, 3, 4, 5, 6].map((n) => snip(`s${n}`, 'a'))),
    });

    // c1 reaches s1,s2 (its own) + c2's s3 + c3's s4 = 4 of the 6 snippets;
    // s5 and s6 sit beyond two hops. c3 sits in the middle and reaches all 6,
    // so it is the graph max and c1 normalizes against it.
    expect(coreness('c3', g)).toBe(1);
    expect(coreness('c1', g)).toBeCloseTo(4 / 6, 10);
  });

  it('is deterministic and never negative', () => {
    const g = web();

    expect(coreness('near', g)).toBe(coreness('near', g));
    for (const c of g.claims) {
      const v = coreness(c.id, g);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is 0 for a claim the graph does not hold, and for an empty graph', () => {
    expect(coreness('nobody', web())).toBe(0);
    expect(coreness('c1', graph())).toBe(0);
  });

  it('never appears in any persisted shape', () => {
    // Q-21: coreness is computed on demand and must not become a stored
    // confidence score. The oracle is the CONTRACT file on disk — the one
    // place a persisted field would have to be declared — not this module.
    const contract = readFileSync(
      join(import.meta.dirname, '..', 'src', 'wiki', 'contract.ts'),
      'utf8',
    );

    expect(contract).not.toMatch(/coreness/i);

    // And nothing computeStatus returns carries it either, so a caller
    // spreading the result into a Claim cannot smuggle it onto disk.
    const c = claim('c1', ['s1@1']);
    const g = graph({ claims: [c], snippets: byId([snip('s1', 'a')]) });
    expect(JSON.stringify(computeStatus(c, g))).not.toContain('coreness');
  });
});

function deepFreeze<T>(o: T): T {
  if (o === null || typeof o !== 'object') return o;
  for (const v of Object.values(o)) deepFreeze(v);
  return Object.freeze(o);
}
