import { describe, it, expect } from 'vitest';
import { ulid, decodeTime } from 'ulid';
import {
  assertUserTurn,
  capPrompt,
  fitPayload,
  readingTime,
  shadowCollector,
  type Claim,
  type ClashCandidate,
  type ClerkOp,
  type PayloadPart,
  type WikiReport,
} from '../src/wiki/contract.js';
import { shadowDecision, THRESHOLDS } from '../src/wiki/thresholds.js';
import type { DocketReport, Reading, Turn } from '../src/types.js';

/**
 * The wiki contract: the two boundary guards, the payload policy, the one
 * definition of when a reading happened — and the type-level invariants, which
 * are asserted with `@ts-expect-error` and verified by `npx tsc --noEmit`
 * rather than by this runner.
 */

const turn = (role: Turn['role'], text: string): Turn => ({
  role,
  text,
  at: '2026-08-02T00:00:00.000Z',
});

describe('assertUserTurn', () => {
  it('passes a list that ends on a user turn', () => {
    expect(() => assertUserTurn([turn('user', 'hello')])).not.toThrow();
    expect(() => assertUserTurn([turn('agent', 'q?'), turn('user', 'a')])).not.toThrow();
  });

  it('throws on a list that ends on an agent turn, however much user text it holds', () => {
    // User-LAST, not user-present: llama.cpp generates nothing when the message
    // list ends on an assistant turn, so [user, agent] is the case that matters.
    expect(() => assertUserTurn([turn('user', 'a'), turn('agent', 'q?')])).toThrow(/user turn/);
  });

  it('throws on an agent-only list and on an empty list', () => {
    expect(() => assertUserTurn([turn('agent', 'q?')])).toThrow(/user turn/);
    expect(() => assertUserTurn([])).toThrow(/user turn/);
  });
});

describe('capPrompt', () => {
  it('returns the joined parts when they fit', () => {
    const text = capPrompt(['one', 'two'], 100);
    expect(text).toBe('one\n\ntwo');
  });

  it('throws when the join is over budget, rather than truncating silently', () => {
    expect(() => capPrompt(['x'.repeat(60), 'y'.repeat(60)], 100)).toThrow(/over budget/);
  });

  it('counts the separator against the budget', () => {
    // 'aaaa' + '\n\n' + 'bbbb' is 10 chars, not 8. The assertion has to see what
    // the endpoint sees, or it guards a string nobody sends.
    expect(() => capPrompt(['aaaa', 'bbbb'], 9)).toThrow(/over budget/);
    expect(capPrompt(['aaaa', 'bbbb'], 10)).toHaveLength(10);
  });
});

describe('fitPayload', () => {
  const part = (
    name: string,
    length: number,
    required: boolean,
    floor?: number
  ): PayloadPart => ({
    name,
    text: name[0]!.repeat(length),
    required,
    ...(floor === undefined ? {} : { floor }),
  });

  it('returns everything untouched when it already fits', () => {
    const fitted = fitPayload([part('alpha', 10, true), part('beta', 10, false)], 100);
    expect(fitted).not.toBeNull();
    expect(fitted!.dropped).toEqual([]);
    expect(fitted!.text).toBe(`${'a'.repeat(10)}\n\n${'b'.repeat(10)}`);
  });

  it('drops the LAST optional part first', () => {
    const fitted = fitPayload(
      [part('alpha', 40, true), part('beta', 40, false), part('gamma', 40, false)],
      90
    );
    expect(fitted).not.toBeNull();
    expect(fitted!.dropped).toEqual(['gamma']);
    expect(fitted!.text).toContain('b');
    expect(fitted!.text).not.toContain('g');
  });

  it('drops every optional part before it truncates a required one', () => {
    const fitted = fitPayload(
      [part('alpha', 100, true, 20), part('beta', 40, false, 10)],
      60
    );
    expect(fitted).not.toBeNull();
    expect(fitted!.dropped).toEqual(['beta']);
    expect(fitted!.text).toBe('a'.repeat(20));
  });

  it('truncates a remaining part to its floor', () => {
    const fitted = fitPayload([part('alpha', 200, true, 30)], 50);
    expect(fitted).not.toBeNull();
    expect(fitted!.text).toBe('a'.repeat(30));
    expect(fitted!.dropped).toEqual([]);
  });

  it('truncates from the end and stops as soon as the payload fits', () => {
    // 100 + 2 + 100 = 202 against 150. Trimming the tail to its floor of 40
    // brings it to 142, so the head keeps its full text: a payload does not
    // lose information it did not have to lose.
    const fitted = fitPayload([part('alpha', 100, true, 20), part('beta', 100, true, 40)], 150);
    expect(fitted).not.toBeNull();
    expect(fitted!.text).toBe(`${'a'.repeat(100)}\n\n${'b'.repeat(40)}`);
  });

  it('leaves a floorless part whole — no floor means not truncatable', () => {
    const fitted = fitPayload([part('alpha', 100, true), part('beta', 100, true, 10)], 150);
    expect(fitted).not.toBeNull();
    expect(fitted!.text).toBe(`${'a'.repeat(100)}\n\n${'b'.repeat(10)}`);
  });

  it('returns null when the required parts at their floors still overflow', () => {
    // The oversized case. The caller skips the item and records the skip, which
    // is what keeps it from blocking the head of the sweep on every run.
    expect(fitPayload([part('alpha', 500, true, 300), part('beta', 500, true, 300)], 400)).toBeNull();
  });

  it('returns null rather than dropping a required part', () => {
    expect(fitPayload([part('alpha', 500, true)], 100)).toBeNull();
  });

  it('produces a string capPrompt accepts', () => {
    const fitted = fitPayload([part('alpha', 400, true, 100), part('beta', 400, false, 100)], 200);
    expect(fitted).not.toBeNull();
    expect(() => capPrompt([fitted!.text], 200)).not.toThrow();
  });
});

describe('readingTime', () => {
  const base = (id: string): Reading => ({
    id,
    facet: 'value',
    stance: 'avowal',
    cites: ['01ABC@1'],
    reading: 'the user prefers slow work',
  });

  it('prefers the reading\'s own `at`', () => {
    const r: Reading = { ...base(ulid()), at: '2026-07-01T12:00:00.000Z' };
    expect(readingTime(r)).toBe('2026-07-01T12:00:00.000Z');
  });

  it('falls back to the ULID\'s own time when `at` is absent', () => {
    const when = Date.UTC(2026, 0, 15, 6, 30, 0);
    const r = base(ulid(when));
    expect(readingTime(r)).toBe(new Date(when).toISOString());
    expect(decodeTime(r.id)).toBe(when);
  });

  it('returns a parseable ISO string either way', () => {
    for (const r of [base(ulid()), { ...base(ulid()), at: '2026-07-01T12:00:00.000Z' }]) {
      expect(Number.isNaN(Date.parse(readingTime(r)))).toBe(false);
    }
  });
});

describe('shadowCollector', () => {
  it('gives one shadowed decision ONE timestamp, taken from the event', () => {
    // The live emitter, not a hand-written event: this is the check that fails
    // if `shadowDecision`'s detail format drifts away from what the collector
    // reads. Q-35's evidence is worth less when its two halves disagree about
    // when the decision happened.
    const seen: { at: string; kind: string; detail: string }[] = [];
    const { log, records } = shadowCollector((e) => seen.push(e));

    const acted = shadowDecision(
      THRESHOLDS['lint.godNodeFanout'],
      'note god-node on facet=value',
      log
    );

    expect(acted).toBe(false);
    expect(seen).toHaveLength(1);
    expect(records).toEqual([
      {
        threshold: 'lint.godNodeFanout',
        would: 'note god-node on facet=value',
        at: seen[0]!.at,
      },
    ]);
  });

  it('forwards every event to the sink and records only the shadowed ones', () => {
    const seen: { kind: string }[] = [];
    const { log, records } = shadowCollector((e) => seen.push(e));

    // A live threshold that clips emits `threshold-clipped` — a record of a
    // mechanism ACTING, which is not evidence for graduating one.
    shadowDecision(THRESHOLDS['remeasure.liveCap'], 'clip a third re-measure', log, true);
    shadowDecision(THRESHOLDS['status.readLogDiscount'], 'discount one cite', log);

    expect(seen.map((e) => e.kind)).toEqual(['threshold-clipped', 'shadow-decision']);
    expect(records).toHaveLength(1);
    expect(records[0]!.threshold).toBe('status.readLogDiscount');
  });

  it('keeps an unreadable detail verbatim rather than dropping the record', () => {
    const { log, records } = shadowCollector(() => {});
    log({ at: '2026-08-02T00:00:00.000Z', actor: 'clerk', kind: 'shadow-decision', detail: 'hm' });
    expect(records).toEqual([
      { threshold: 'unparsed', would: 'hm', at: '2026-08-02T00:00:00.000Z' },
    ]);
  });
});

describe('the shapes carry the invariants', () => {
  // These assertions are checked by `npx tsc --noEmit`, not by this runner: a
  // `@ts-expect-error` over a line that compiles is itself a compile error.

  const claim: Claim = {
    id: '01CLAIM',
    body: 'The user protects unstructured mornings.',
    range: 'when he is talking about work he was hired for',
    status: 'unconfirmed',
    cites: ['01SNIP@1'],
    facet: 'value',
    referents: [],
    fromReadings: ['01READ'],
    attested: false,
    readLog: [],
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T00:00:00.000Z',
    created: '2026-08-02T00:00:00.000Z',
    updated: '2026-08-02T00:00:00.000Z',
  };

  // @ts-expect-error — a Claim without a Range is malformed (Q-21)
  const noRange: Claim = { ...claim, range: undefined };

  // @ts-expect-error — a Claim cannot drop its cites (Q-21)
  const noCites: Claim = { ...claim, cites: undefined };

  const opWithStatus: ClerkOp = {
    op: 'MINT',
    reading: '01READ',
    body: 'x',
    range: 'y',
    cites: ['01SNIP@1'],
    facet: 'value',
    // @ts-expect-error — no op carries a status: it is never model-writable (Q-29)
    status: 'evidenced',
  };

  // @ts-expect-error — nor an `attested` flag: only a user verb sets it (Q-33)
  const opWithAttested: ClerkOp = { op: 'ARCHIVE', reading: '01READ', claim: '01CLAIM', reason: 'r', attested: true };

  const candidate: ClashCandidate = {
    id: '01CAND',
    pair: ['01A', '01B'],
    channel: 'referent',
    status: 'dissolved',
    outcome: 'remeasure-expired',
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T00:00:00.000Z',
    created: '2026-08-02T00:00:00.000Z',
  };

  // @ts-expect-error — the outcome union is closed: a free-text reason is a reason nobody can count
  const freeTextOutcome: ClashCandidate = { ...candidate, outcome: 'because it felt wrong' };

  const report: WikiReport = {
    swept: 1,
    applied: 1,
    rejected: 0,
    unprocessed: 0,
    oversized: 0,
    stuck: 0,
    lint: [],
    candidates: { lexical: 0, referent: 0 },
    oppositionJudged: 0,
    oppositionOpposed: 0,
    remeasuresMinted: 0,
    remeasuresExpired: 0,
    contradictionsOpened: 0,
    candidatesDissolved: 0,
    mint: { calls: 1, callsParsed: 1, callErrors: 0, oversized: 0, opsSeen: 1, readingsSwept: 1 },
    shadow: [],
  };

  // The docket renders `DocketReport.wiki`, which carries an index signature.
  // TypeScript grants implicit index signatures to type ALIASES only, so this
  // line is what fails the moment `WikiReport` becomes an interface.
  const asDocketField: NonNullable<DocketReport['wiki']> = report;

  it('holds the type-level assertions above (verified by tsc, asserted here for the record)', () => {
    expect(claim.range).not.toBe('');
    expect(claim.cites.length).toBeGreaterThan(0);
    expect(candidate.pair).toHaveLength(2);
    expect(asDocketField.swept).toBe(1);
    // Referenced so the declarations are not dead code to a reader.
    expect([noRange, noCites, opWithStatus, opWithAttested, freeTextOutcome]).toHaveLength(5);
  });
});
