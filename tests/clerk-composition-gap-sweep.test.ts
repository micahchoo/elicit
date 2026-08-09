import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { runCompositionGapSweep, type CompositionGapFinder } from '../src/clerk/sweeps.js';
import { findGaps, type FoundGap } from '../src/clerk/arrangements.js';
import { createPieceStore } from '../src/piece/store.js';
import { createQueueStore, isUserDeclaredWeight } from '../src/queue/queue.js';
import type { Entry, Gap, PieceStore, Pin } from '../src/piece/contract.js';
import type { Complete, QueueEntry, Snippet } from '../src/types.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'comp-gap-sweep-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const pin = (id: string, snippet: string, version = 1): Pin => ({ id, kind: 'pin', snippet, version });

function makeSnippet(id: string, prose?: string): Snippet {
  return {
    id,
    version: 1,
    captured: '2026-08-01T00:00:00.000Z',
    provenance: { kind: 'harvest', session: 'sit-1', question: 'q', questionForm: 'theoretical' },
    prose: prose ?? `prose of ${id}`,
  };
}

const SNIPPETS: Record<string, Snippet> = {
  s1: makeSnippet('s1'),
  s2: makeSnippet('s2'),
  s3: makeSnippet('s3'),
  s4: makeSnippet('s4'),
  // The fingerprint's answered passage — placed into the hole at the end.
  'ans-1': makeSnippet('ans-1', 'the connecting thought, written in answer.'),
};

/** A Complete that must never be reached (the stubbed path is zero-LLM). */
const neverComplete: Complete = async () => {
  throw new Error('complete must not be called when findGaps is stubbed');
};

/** A stub gap-finder returning the given findings. */
function stubFinder(gaps: FoundGap[]): CompositionGapFinder {
  return async () => ({ gaps, dropped: [] });
}

function pieces(): PieceStore {
  return createPieceStore(root, { snippets: SNIPPETS });
}

type SweepDeps = Parameters<typeof runCompositionGapSweep>[0];

/** A log collector carrying its own record, so tests can read what was emitted. */
function makeLog(): { events: { kind: string; detail: string }[]; log: SweepDeps['log'] } {
  const events: { kind: string; detail: string }[] = [];
  return {
    events,
    log: (e) => events.push({ kind: e.kind, detail: e.detail }),
  };
}

function sweepBase(overrides: Partial<SweepDeps> = {}) {
  const queue = createQueueStore(root);
  const { events, log } = makeLog();
  return {
    pieces: pieces(),
    snippets: () => SNIPPETS,
    queue,
    complete: neverComplete,
    modelName: 'test-model',
    log,
    findGaps: stubFinder([]),
    ...overrides,
    events,
  };
}

describe('runCompositionGapSweep', () => {
  it('stores a model-placed gap after the anchor pin, with pending text and placedBy model — and never mints', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'leap', after: 's1', question: 'what goes between these?' }]),
    });
    const piece = base.pieces.create([pin('e1', 's1'), pin('e2', 's2')], 'the clock');

    const result = await runCompositionGapSweep(base);

    expect(result).toEqual({ found: 1, placed: 1, skipped: 0, expired: 0 });
    const stored = base.pieces.get(piece.id)!;
    expect(stored.entries).toHaveLength(3);
    const gap = stored.entries[1] as Gap;
    expect(gap.kind).toBe('leap');
    expect(gap.placedBy).toBe('model');
    expect(gap.pending).toBe('what goes between these?');
    expect(gap.question).toBeUndefined();
    // Nothing minted: the person's `ask this` is the only mint (Q-39).
    expect(base.queue.list()).toHaveLength(0);
    // The per-composition line names the kinds.
    expect(base.events.map((e) => e.kind)).toContain('composition-gap-found');
  });

  it('a trailing thin gap appends at the end (the anchor pin is the last entry)', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'thin', after: 's2', question: 'write more about this?' }]),
    });
    const piece = base.pieces.create([pin('e1', 's1'), pin('e2', 's2')], 'the clock');

    const result = await runCompositionGapSweep(base);

    expect(result.placed).toBe(1);
    const stored = base.pieces.get(piece.id)!;
    const gap = stored.entries[2] as Gap;
    expect(gap.kind).toBe('thin');
    expect(gap.placedBy).toBe('model');
  });

  it('asks only the open compositions: set-down and discarded pieces get no model call', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'thin', after: 's1', question: 'more?' }]),
    });
    const open = base.pieces.create([pin('e1', 's1')], 'open');
    const down = base.pieces.create([pin('e1', 's2')], 'down');
    const gone = base.pieces.create([pin('e1', 's3')], 'gone');
    base.pieces.setDown(down.id, 'user');
    base.pieces.discard(gone.id);
    const asked: string[] = [];
    const spy: CompositionGapFinder = async (entries, ...rest) => {
      const first = entries.find((e): e is Pin => e.kind === 'pin')!.snippet;
      asked.push(first);
      return stubFinder([{ kind: 'thin', after: first, question: 'more?' }])(entries, ...rest);
    };
    base.findGaps = spy;

    await runCompositionGapSweep(base);

    expect(asked).toEqual(['s1']);
    expect(base.pieces.get(open.id)!.entries.filter((e) => e.kind !== 'pin')).toHaveLength(1);
    expect(base.pieces.get(down.id)!.entries.filter((e) => e.kind !== 'pin')).toHaveLength(0);
    expect(base.pieces.get(gone.id)!.entries.filter((e) => e.kind !== 'pin')).toHaveLength(0);
  });

  it('caps a pass at gapsPerPass findings, distinct kinds — the belt over findGaps', async () => {
    const base = sweepBase({
      gapsPerPass: 3,
      findGaps: stubFinder([
        { kind: 'leap', after: 's1', question: 'a?' },
        { kind: 'leap', after: 's2', question: 'b?' },
        { kind: 'thin', after: 's3', question: 'c?' },
        { kind: 'unsupported', after: 's4', question: 'd?' },
      ]),
    });
    const piece = base.pieces.create(
      [pin('e1', 's1'), pin('e2', 's2'), pin('e3', 's3'), pin('e4', 's4')],
      'the clock',
    );

    const result = await runCompositionGapSweep(base);

    // Four model findings, but the second `leap` is a duplicate kind: three kept.
    expect(result).toEqual({ found: 4, placed: 3, skipped: 1, expired: 0 });
    const stored = base.pieces.get(piece.id)!;
    const kinds = stored.entries.filter((e): e is Gap => e.kind !== 'pin').map((e) => e.kind);
    expect(kinds).toEqual(['leap', 'thin', 'unsupported']);
  });

  it('caps the compositions asked per run and advances the rotation cursor', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'thin', after: 's1', question: 'x?' }]),
    });
    base.pieces.create([pin('e1', 's1')], 'a');
    base.pieces.create([pin('e1', 's2')], 'b');
    base.pieces.create([pin('e1', 's3')], 'c');
    const asked: string[] = [];
    const spy: CompositionGapFinder = async (entries, ...rest) => {
      const first = entries.find((e): e is Pin => e.kind === 'pin')!.snippet;
      asked.push(first);
      return stubFinder([{ kind: 'thin', after: first, question: 'x?' }])(entries, ...rest);
    };
    base.findGaps = spy;
    let offset = 0;
    base.cursor = { read: () => offset, write: (o: number) => { offset = o; } };

    await runCompositionGapSweep(base);
    expect(asked).toHaveLength(2);
    expect(offset).toBe(2);
    const askedFirst = asked.slice();
    await runCompositionGapSweep(base);
    // The second run continues past where the first stopped (modulo 3).
    expect(asked).toHaveLength(4);
    expect(asked[2]).not.toBe(askedFirst[0]);
    expect(asked[3]).toBe(askedFirst[0]);
  });

  it('never re-stores a seam that already holds a hole', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'leap', after: 's1', question: 'what goes between these?' }]),
    });
    const piece = base.pieces.create([pin('e1', 's1'), pin('e2', 's2')], 'the clock');
    // The person already asked here — their gap owns the seam.
    base.pieces.putEntries(piece.id, [
      pin('e1', 's1'),
      { id: 'pg1', placedBy: 'person', question: 'q1' },
      pin('e2', 's2'),
    ]);

    await runCompositionGapSweep(base);

    expect(base.pieces.get(piece.id)!.entries.filter((e) => e.kind !== 'pin')).toHaveLength(1);
  });

  it('a durably dismissed seam is never re-found, even with a fresh gap id', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'leap', after: 's1', question: 'what goes between these?' }]),
    });
    const piece = base.pieces.create([pin('e1', 's1'), pin('e2', 's2')], 'the clock');

    // Run 1: the finding lands. The person presses `not a gap`.
    await runCompositionGapSweep(base);
    const stored = base.pieces.get(piece.id)!;
    const gap = stored.entries[1] as Gap;
    base.pieces.dismissGap(piece.id, gap.id);
    expect(base.pieces.get(piece.id)!.dismissedGaps).toEqual(['s1\u0000leap']);

    // Run 2: the model re-finds the same seam with a fresh id — refused.
    const result = await runCompositionGapSweep(base);
    expect(result.placed).toBe(0);
    expect(base.pieces.get(piece.id)!.entries.filter((e) => e.kind !== 'pin')).toHaveLength(0);
  });

  it('skips a finding whose anchor is not in the composition', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'leap', after: 'ghost', question: 'a?' }]),
    });
    const piece = base.pieces.create([pin('e1', 's1'), pin('e2', 's2')], 'the clock');

    const result = await runCompositionGapSweep(base);

    expect(result).toEqual({ found: 1, placed: 0, skipped: 1, expired: 0 });
    expect(base.pieces.get(piece.id)!.entries).toHaveLength(2);
  });

  it('expires model-placed gap questions after three sittings, and only those', async () => {
    const base = sweepBase();
    base.pieces.create([pin('e1', 's1')], 'the clock');
    // Two composition-gap entries, minted at sitting 0.
    const entry = base.queue.add({
      source: 'composition-gap', license: 'CC0', question: 'q1',
      questionForm: 'deliberative', horizon: 'session',
      gap: 'g1', composition: 'p1',
    });
    const answered = base.queue.add({
      source: 'composition-gap', license: 'CC0', question: 'q2',
      questionForm: 'deliberative', horizon: 'session',
      gap: 'g2', composition: 'p1',
    });
    base.queue.markAnswered(answered.id);
    // A person-declared gap question: the faster expiry never touches it.
    const mine = base.queue.add({
      source: 'gap-declared', license: 'arrangement-gap', question: 'mine',
      questionForm: 'deliberative', horizon: 'session', gap: 'g3',
    });

    // Two sittings pass: nothing expires yet.
    base.queue.noteSittingStarted();
    base.queue.noteSittingStarted();
    let result = await runCompositionGapSweep(base);
    expect(result.expired).toBe(0);
    expect(base.queue.get(entry.id)!.status).toBe('pending');

    // The third sitting passes: the ignored model gap expires; the answered
    // one and the person's own are untouched.
    base.queue.noteSittingStarted();
    result = await runCompositionGapSweep(base);
    expect(result.expired).toBe(1);
    expect(base.queue.get(entry.id)!.status).toBe('expired');
    expect(base.queue.get(answered.id)!.status).toBe('answered');
    expect(base.queue.get(mine.id)!.status).toBe('pending');
    expect(base.events.map((e) => e.kind)).toContain('composition-gap-expired');
  });

  it('composition-gap weighs below gap-declared (isUserDeclaredWeight is false)', () => {
    const gapDeclared: QueueEntry = {
      id: 'a', status: 'pending', source: 'gap-declared', license: 'x',
      question: 'q', questionForm: 'deliberative', horizon: 'session', created: '',
    };
    const compositionGap: QueueEntry = {
      id: 'b', status: 'pending', source: 'composition-gap', license: 'CC0',
      question: 'q', questionForm: 'deliberative', horizon: 'session', created: '',
      composition: 'p1', gap: 'g1',
    };
    expect(isUserDeclaredWeight(gapDeclared)).toBe(true);
    expect(isUserDeclaredWeight(compositionGap)).toBe(false);
  });

  it('carries the Q-12 guard: an unquoted finding never reaches the composition', async () => {
    const base = sweepBase({ findGaps });
    base.pieces.create([pin('e1', 's1'), pin('e2', 's2')], 'the clock');
    // A scripted model that finds a gap but fails to quote an adjacent pin.
    const unquoted: Complete = async () =>
      JSON.stringify({ gaps: [{ kind: 'leap', after: 's1', question: 'what goes between these?' }] });
    base.complete = unquoted;

    const result = await runCompositionGapSweep(base);

    expect(result.placed).toBe(0);
    expect(base.pieces.list()[0]!.entries.filter((e) => e.kind !== 'pin')).toHaveLength(0);

    // And the quoted twin passes: the guard admits what it verifies.
    const quoted: Complete = async () =>
      JSON.stringify({ gaps: [{ kind: 'leap', after: 's1', question: 'you say "prose of s1" stands alone — what connects it to the next?' }] });
    base.complete = quoted;
    const second = await runCompositionGapSweep(base);
    expect(second.placed).toBe(1);
    const stored = base.pieces.list()[0]!;
    expect((stored.entries[1] as Gap).pending).toContain('prose of s1');
  });

  it('the fingerprint (§10): found → ask this → answered in a sitting → placed into the hole', async () => {
    const base = sweepBase({
      findGaps: stubFinder([{ kind: 'leap', after: 's1', question: 'you say "prose of s1" stands alone — what connects it?' }]),
    });
    const piece = base.pieces.create([pin('e1', 's1'), pin('e2', 's2')], 'the clock');

    // Step 1 — the sweep stores the model-found gap (pending text, nothing minted).
    const swept = await runCompositionGapSweep(base);
    expect(swept.placed).toBe(1);
    const withGap = base.pieces.get(piece.id)!;
    const gap = withGap.entries[1] as Gap;
    expect(gap.placedBy).toBe('model');
    expect(gap.question).toBeUndefined();

    // Step 2 — `ask this` pressed: the queue entry at composition-gap
    // weight, keyed (composition, gap), stamped with the minting sitting.
    const entry = base.queue.add({
      source: 'composition-gap', license: 'CC0', question: gap.pending!,
      questionForm: 'deliberative', horizon: 'session',
      gap: gap.id,
      composition: piece.id,
    });
    expect(entry.source).toBe('composition-gap');
    expect(entry.gap).toBe(gap.id);
    expect(entry.composition).toBe(piece.id);
    expect(entry.createdSitting).toBe(0);
    expect(isUserDeclaredWeight(entry)).toBe(false);

    // Step 3 — answered in a sitting: the harvested passage carries the gap
    // id in its provenance (Q-39), and the question is answered.
    const answer: Snippet = {
      ...SNIPPETS['ans-1']!,
      provenance: { kind: 'harvest', session: 'sit-2', question: entry.id, questionForm: 'theoretical', gap: gap.id },
    };
    base.queue.markAnswered(entry.id);
    expect(base.queue.get(entry.id)!.status).toBe('answered');

    // Step 4 — `place it`: the answered passage goes into the hole. The
    // route's provenance check is the door; the engine act is the pin swap.
    const placed = base.pieces.putEntries(piece.id, [
      pin('e1', 's1'),
      { id: ulid(), kind: 'pin', snippet: answer.id, version: answer.version },
      pin('e2', 's2'),
    ]);
    const kinds = placed.entries.map((e) => (e.kind === 'pin' ? 'pin' : 'gap'));
    expect(kinds).toEqual(['pin', 'pin', 'pin']);
    // The round trip closed: no gap remains at the seam, the question is
    // answered, and the answer's words are in the hole.
    expect(placed.entries.some((e) => e.kind !== 'pin')).toBe(false);
    expect(placed.entries[1]).toMatchObject({ snippet: 'ans-1' });
    expect(base.queue.list({ status: 'answered' })).toHaveLength(1);
  });
});
