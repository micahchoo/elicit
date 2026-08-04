/**
 * The assembly point. Every module in the Clerk slice runs here for the first
 * time, so this file uses the REAL store, the REAL registry, the REAL lint and
 * the REAL pool over a temp directory, and fakes only the four collaborators
 * that would otherwise reach a model. A fake store would have hidden the
 * `attempts` round-trip that Q-53's cap depends on.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { formatEvent, hasSentence } from '../src/log/format.js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import {
  RANGE_DISCRIMINATED,
  dissolutionOutcome,
  runWikiJobs,
  type WikiJobDeps,
  type WikiJobsReport,
} from '../src/clerk/wiki-jobs.js';
import { createClaimStore } from '../src/wiki/store.js';
import { createRegistry } from '../src/wiki/registry.js';
import { lint, type ThresholdRegister } from '../src/wiki/lint.js';
import { poolCandidates, type ClashChannel } from '../src/wiki/clash.js';
import { applyOps } from '../src/wiki/ops.js';
import {
  bodyHash,
  embeddingChannel,
  type Embed,
  type EmbeddingChannel,
  type EmbeddingIndexStore,
  type EmbeddingRecord,
} from '../src/wiki/embedding.js';
import { THRESHOLDS, type Threshold } from '../src/wiki/thresholds.js';
import { UNVERIFIED_CONFIRMATION, type ConfirmResult, type OppositionJudgment } from '../src/clerk/contradiction.js';
import type { MintItem, MintResult } from '../src/clerk/mint.js';
import type {
  Claim,
  ClaimGraph,
  ClaimStore,
  ClashCandidate,
  LogFn,
  Referent,
} from '../src/wiki/contract.js';
import type {
  Complete,
  DocketReport,
  Facet,
  Index,
  QueueDraft,
  QueueEntry,
  QueueStore,
  Reading,
  Snippet,
  Stance,
} from '../src/types.js';

// ── Fixtures ──

const T0 = '2026-01-01T00:00:00.000Z';
const MODEL = 'test-clerk-model';

function snippet(
  id: string,
  prose: string,
  extra: { session?: string; version?: number; captured?: string; question?: string } = {},
): Snippet {
  return {
    id,
    version: extra.version ?? 1,
    captured: extra.captured ?? T0,
    provenance: {
      kind: 'harvest',
      session: extra.session ?? 'sess-1',
      question: extra.question ?? 'What do you make of that?',
      questionForm: 'deliberative',
    },
    prose,
  };
}

/**
 * Every reading carries `at`. `readingTime` falls back to `decodeTime(id)` for
 * files written before the field existed, and a non-ULID test id would throw
 * there — the fallback is exercised by the contract's own tests, not here.
 */
function reading(
  id: string,
  cites: string[],
  text: string,
  extra: { at?: string; facet?: Facet; stance?: Stance } = {},
): Reading {
  return {
    id,
    facet: extra.facet ?? 'construct',
    stance: extra.stance ?? 'avowal',
    cites,
    reading: text,
    at: extra.at ?? T0,
  };
}

function claim(id: string, body: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    body,
    range: 'at work',
    status: 'unconfirmed',
    cites: ['s1@1'],
    facet: 'construct',
    referents: [],
    fromReadings: [],
    attested: false,
    readLog: [],
    model: MODEL,
    modelAt: T0,
    created: T0,
    updated: T0,
    ...extra,
  };
}

function mintResult(ops: unknown[], extra: Partial<MintResult['diagnostics']> = {}): MintResult {
  return {
    ops: ops as MintResult['ops'],
    raw: JSON.stringify(ops),
    diagnostics: {
      rawChars: 40,
      parsed: true,
      parseMode: 'json',
      opsSeen: ops.length,
      statusKeysStripped: 0,
      oversized: false,
      ...extra,
    },
  };
}

const PARSE_FAILED = (): MintResult => ({
  ops: [],
  raw: 'I think the answer is probably that they value autonomy, honestly.',
  diagnostics: {
    rawChars: 64,
    parsed: false,
    parseMode: 'failed',
    opsSeen: 0,
    statusKeysStripped: 0,
    oversized: false,
  },
});

const OVERSIZED = (): MintResult => ({
  ops: [],
  raw: '',
  diagnostics: {
    rawChars: 0,
    parsed: false,
    parseMode: 'failed',
    opsSeen: 0,
    statusKeysStripped: 0,
    oversized: true,
  },
});

// ── Fakes ──

type FakeQueue = QueueStore & { entries: QueueEntry[] };

function fakeQueue(seed: QueueEntry[] = []): FakeQueue {
  const entries: QueueEntry[] = [...seed];
  let n = seed.length;
  return {
    entries,
    add(d: QueueDraft): QueueEntry {
      n++;
      const e: QueueEntry = { ...d, id: `q-${n}`, created: new Date().toISOString(), status: 'pending' };
      entries.push(e);
      return e;
    },
    list(filter?: { status?: QueueEntry['status']; source?: QueueEntry['source'] }): QueueEntry[] {
      return entries.filter(
        (e) =>
          (filter?.status === undefined || e.status === filter.status) &&
          (filter?.source === undefined || e.source === filter.source),
      );
    },
    draw: () => null,
    markAsked: () => {},
    markAnswered: () => {},
    defer: () => {},
    expire: () => 0,
    expireTailBeyond: () => 0,
    markExpired: () => {},
  };
}

function queueEntry(id: string, extra: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id,
    status: 'pending',
    source: 'contradiction-remeasure',
    license: 'CC0',
    question: 'You wrote: "x". What happened the last time?',
    questionForm: 'deliberative',
    sharpness: 'weak',
    horizon: 'session',
    created: T0,
    ...extra,
  };
}

/** A channel that proposes exactly the pairs it was given. */
function staticChannel(pairs: [string, string][]): ClashChannel {
  return {
    name: 'lexical',
    candidates(graph: ClaimGraph): [Claim, Claim][] {
      const by = new Map(graph.claims.map((c) => [c.id, c]));
      const out: [Claim, Claim][] = [];
      for (const [a, b] of pairs) {
        const ca = by.get(a);
        const cb = by.get(b);
        if (ca && cb) out.push([ca, cb]);
      }
      return out;
    },
  };
}

const throwingComplete: Complete = async () => {
  throw new Error('runWikiJobs must not call complete() itself');
};

// ── Harness ──

/** The whole event, not a projection of it — the trail has to be checked as it would be written. */
type LoggedEvent = Parameters<LogFn>[0];

type Recorded = {
  events: LoggedEvent[];
  proposeCalls: MintItem[];
  oppositionCalls: [string, string][];
  remeasureCalls: string[];
  confirmCalls: string[];
  stillTrueCalls: string[];
  discriminatingCalls: number;
  narrowedRangesCalls: number;
};

type HarnessOptions = {
  claims?: Claim[];
  referents?: Referent[];
  candidates?: ClashCandidate[];
  snippets?: Snippet[];
  readings?: Reading[];
  queue?: FakeQueue;
  channels?: ClashChannel[];
  thresholds?: ThresholdRegister;
  propose?: (item: MintItem) => Promise<MintResult>;
  opposition?: (a: Claim, b: Claim) => Promise<OppositionJudgment | null>;
  remeasure?: () => Promise<QueueDraft | null>;
  confirm?: (c: ClashCandidate) => Promise<ConfirmResult | null>;
  stillTrue?: (s: Snippet) => Promise<QueueDraft | null>;
  discriminating?: () => Promise<QueueDraft | null>;
  narrowedRanges?: () => Promise<{ a: string; b: string } | null>;
};

const roots: string[] = [];

function harness(opts: HarnessOptions = {}): {
  deps: WikiJobDeps;
  store: ClaimStore;
  queue: FakeQueue;
  rec: Recorded;
  run: () => Promise<WikiJobsReport>;
  index: Index;
} {
  const root = mkdtempSync(join(tmpdir(), 'wiki-jobs-'));
  roots.push(root);
  const store = createClaimStore(root);
  for (const c of opts.claims ?? []) store.writeClaim(c);
  for (const c of opts.candidates ?? []) store.writeCandidate(c);
  for (const r of opts.referents ?? []) store.writeReferent(r);

  const rec: Recorded = {
    events: [],
    proposeCalls: [],
    oppositionCalls: [],
    remeasureCalls: [],
    confirmCalls: [],
    stillTrueCalls: [],
    discriminatingCalls: 0,
    narrowedRangesCalls: 0,
  };
  const log: LogFn = (e) => rec.events.push(e);

  const snippets: Record<string, Snippet> = {};
  for (const s of opts.snippets ?? []) snippets[s.id] = s;
  const readings: Record<string, Reading> = {};
  for (const r of opts.readings ?? []) readings[r.id] = r;
  const index: Index = { snippets, readings, buds: {} };

  const queue = opts.queue ?? fakeQueue();

  const deps: WikiJobDeps = {
    store,
    registry: createRegistry(store, MODEL, log),
    queue,
    vault: { rebuildIndex: () => index },
    complete: throwingComplete,
    channels: opts.channels ?? [],
    proposeOps: async (item) => {
      rec.proposeCalls.push(item);
      return opts.propose ? opts.propose(item) : mintResult([]);
    },
    applyOps,
    lint,
    poolCandidates,
    judgeOpposition: async (a, b) => {
      rec.oppositionCalls.push([a.id, b.id]);
      return opts.opposition ? opts.opposition(a, b) : { opposed: false, poleA: '', poleB: '' };
    },
    composeRemeasure: async (c) => {
      rec.remeasureCalls.push(`${c.a.id}|${c.b.id}`);
      return opts.remeasure ? opts.remeasure() : null;
    },
    judgeConfirmation: async (c) => {
      rec.confirmCalls.push(c.id);
      return opts.confirm ? opts.confirm(c) : null;
    },
    composeStillTrue: async (s) => {
      rec.stillTrueCalls.push(s.id);
      return opts.stillTrue ? opts.stillTrue(s) : null;
    },
    composeDiscriminatingQuestion: async () => {
      rec.discriminatingCalls++;
      return opts.discriminating ? opts.discriminating() : null;
    },
    composeNarrowedRanges: async () => {
      rec.narrowedRangesCalls++;
      return opts.narrowedRanges ? opts.narrowedRanges() : null;
    },
    ...(opts.thresholds !== undefined ? { thresholds: opts.thresholds } : {}),
    log,
    vaultRoot: root,
    model: MODEL,
    sittingOf: () => ({}),
  };

  return { deps, store, queue, rec, run: () => runWikiJobs(deps), index };
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const kinds = (rec: Recorded): string[] => rec.events.map((e) => e.kind);

/** The actors `appendEvent` accepts — a value outside this set is dropped on read. */
const VALID_ACTORS = new Set(['clerk', 'elicitor', 'harvester', 'system']);

/** A ULID as the store mints them: what the reading surface must never show. */
const ULID_PATTERN = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

/** `key=value` left standing in a rendered sentence — machine syntax on a page of prose. */
const FIELD_SYNTAX = /\b[A-Za-z][A-Za-z0-9]*=/;

/**
 * The kinds THIS file writes the detail line for.
 *
 * `shadow-decision`, `threshold-clipped` and `clash-checked` are emitted through
 * this run but their details are written by `src/wiki/thresholds.ts` and
 * `src/wiki/clash.ts`, and two of those still pass a `key=value` clause to the
 * reader. That is a known debt in files this task does not own, so the prose
 * rule below is asserted over the lines this file is the author of — and it is
 * asserted, so a third one cannot be added here without a test going red.
 */
const OWNED_KINDS = new Set([
  'mint-call-failed',
  'mint-parse-failed',
  'mint-empty',
  'mint-oversized',
  'claim-status-changed',
  'wiki-jobs-failed',
  'wiki-job-skipped',
]);

/**
 * Every event a run produced, checked as the Activity Log would take it.
 *
 * The point is the SEAM, not the call: `runWikiJobs` takes `log` as a required
 * dependency, and what T13/T14 will pass is
 * `(e) => appendEvent(vaultRoot, e as ActivityEvent)`. So each line has to be
 * `appendEvent`-shaped (an ISO stamp `dateKey` can parse, an actor the read
 * guard admits) and has to render as a sentence rather than falling through to
 * the de-slugger. A shadow record that reaches nowhere is a mechanism that can
 * never graduate (Q-35), and a clip nobody can read is a bound that owes its
 * record and does not pay it (Q-56).
 */
function expectTrailIsAppendable(rec: Recorded): void {
  expect(rec.events.length).toBeGreaterThan(0);
  for (const e of rec.events) {
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(VALID_ACTORS.has(e.actor)).toBe(true);
    expect(e.kind).not.toBe('');
    expect(typeof e.detail).toBe('string');
    expect(hasSentence(e.kind), `${e.kind} has no sentence in format.ts`).toBe(true);

    const sentence = formatEvent(e);
    expect(sentence, `${e.kind} rendered empty`).not.toBe('');
    expect(sentence, `${e.kind} leaked an identifier`).not.toMatch(ULID_PATTERN);
    if (OWNED_KINDS.has(e.kind)) {
      expect(sentence, `${e.kind} rendered as machine syntax`).not.toMatch(FIELD_SYNTAX);
    }
  }
}

// ── Job 1: the sweep ──

describe('sweep', () => {
  const three = [
    reading('r-1', ['s1@1'], 'They treat estimates as coordination.'),
    reading('r-2', ['s1@1'], 'They dislike being interrupted.'),
    reading('r-3', ['s1@1'], 'They keep a paper notebook.'),
  ];
  const s1 = snippet('s1', 'estimates are for coordination, not for promises');

  function mintOp(readingId: string, body: string): unknown {
    return { op: 'MINT', reading: readingId, body, range: 'at work', cites: ['s1@1'], facet: 'construct' };
  }

  it('makes exactly one proposeOps call per unprocessed reading, each carrying one reading', async () => {
    const h = harness({
      snippets: [s1],
      readings: three,
      propose: async (item) => mintResult([mintOp(item.reading.id, `A claim about ${item.reading.id}`)]),
    });
    const report = await h.run();

    expect(h.rec.proposeCalls).toHaveLength(3);
    expect(h.rec.proposeCalls.map((c) => c.reading.id).sort()).toEqual(['r-1', 'r-2', 'r-3']);
    expect(report.applied).toBe(3);
    expect(report.swept).toBe(3);
    expect(h.store.sweptReadingIds()).toEqual(new Set(['r-1', 'r-2', 'r-3']));
  });

  it('sweeps nothing on a second run', async () => {
    const h = harness({
      snippets: [s1],
      readings: three,
      propose: async (item) => mintResult([mintOp(item.reading.id, `A claim about ${item.reading.id}`)]),
    });
    await h.run();
    const before = h.rec.proposeCalls.length;
    const second = await h.run();

    expect(h.rec.proposeCalls.length).toBe(before);
    expect(second.swept).toBe(0);
    expect(second.applied).toBe(0);
  });

  it('one proposeOps that throws leaves the other two applied and the run complete', async () => {
    const h = harness({
      snippets: [s1],
      readings: three,
      channels: [staticChannel([])],
      propose: async (item) => {
        if (item.reading.id === 'r-2') throw new Error('endpoint down');
        return mintResult([mintOp(item.reading.id, `A claim about ${item.reading.id}`)]);
      },
    });
    const report = await h.run();

    expect(report.applied).toBe(2);
    expect(h.store.sweptReadingIds()).toEqual(new Set(['r-1', 'r-3']));
    expect(kinds(h.rec)).toContain('mint-call-failed');
    // The rest of the run still happened.
    expect(report.lint).toBeInstanceOf(Array);
    expect(kinds(h.rec)).toContain('clash-checked');
    expect(report.mint.callErrors).toBe(1);
  });

  it('the four sweep outcomes emit four different kinds', async () => {
    const readings = [
      reading('r-fail', ['s1@1'], 'a'),
      reading('r-parse', ['s1@1'], 'b'),
      reading('r-empty', ['s1@1'], 'c'),
      reading('r-big', ['s1@1'], 'd'),
    ];
    const h = harness({
      snippets: [s1],
      readings,
      propose: async (item) => {
        if (item.reading.id === 'r-fail') throw new Error('boom');
        if (item.reading.id === 'r-parse') return PARSE_FAILED();
        if (item.reading.id === 'r-big') return OVERSIZED();
        return mintResult([]);
      },
    });
    await h.run();

    const emitted = kinds(h.rec);
    expect(emitted).toContain('mint-call-failed');
    expect(emitted).toContain('mint-parse-failed');
    expect(emitted).toContain('mint-empty');
    expect(emitted).toContain('mint-oversized');
    const parse = h.rec.events.find((e) => e.kind === 'mint-parse-failed');
    const empty = h.rec.events.find((e) => e.kind === 'mint-empty');
    expect(parse?.kind).not.toBe(empty?.kind);
    // The raw output rides along, clipped, so a parse failure is inspectable.
    expect(parse?.detail).toContain('I think the answer');
  });

  it('an oversized reading is not retried on the next run and lands in oversizedReadingIds', async () => {
    const h = harness({
      snippets: [s1],
      readings: [reading('r-big', ['s1@1'], 'd')],
      propose: async () => OVERSIZED(),
    });
    const first = await h.run();
    expect(first.oversized).toBe(1);
    expect(h.store.oversizedReadingIds()).toEqual(new Set(['r-big']));

    await h.run();
    expect(h.rec.proposeCalls).toHaveLength(1);
  });

  it('a rejected op gets its REJECTED sweep line from this layer, and the reading stays unprocessed', async () => {
    const h = harness({
      snippets: [s1],
      readings: [reading('r-1', ['s1@1'], 'a')],
      // No range: T9 rejects it and emits no sweep line of its own.
      propose: async () => mintResult([{ op: 'MINT', reading: 'r-1', body: 'x', cites: ['s1@1'], facet: 'construct' }]),
    });
    const report = await h.run();

    expect(report.rejected).toBe(1);
    expect(h.store.attemptCounts().get('r-1')).toBe(1);
    expect(h.store.sweptReadingIds().has('r-1')).toBe(false);
  });

  it('a reading with three prior rejections sorts behind a fresh one and counts as stuck', async () => {
    const h = harness({
      snippets: [s1],
      readings: [reading('r-a', ['s1@1'], 'a'), reading('r-b', ['s1@1'], 'b')],
      propose: async () => mintResult([]),
    });
    for (let i = 0; i < 3; i++) {
      h.store.appendSweep({ readingId: 'r-a', op: 'REJECTED', at: T0, model: MODEL });
    }
    const report = await h.run();

    expect(h.rec.proposeCalls.map((c) => c.reading.id)).toEqual(['r-b', 'r-a']);
    expect(report.stuck).toBe(1);
  });

  it('the call quota caps a large backlog and emits threshold-clipped', async () => {
    const readings = Array.from({ length: 100 }, (_, i) =>
      reading(`r-${String(i).padStart(3, '0')}`, ['s1@1'], `reading ${i}`),
    );
    const h = harness({ snippets: [s1], readings, propose: async () => mintResult([]) });
    await h.run();

    expect(h.rec.proposeCalls).toHaveLength(12);
    const clip = h.rec.events.find((e) => e.kind === 'threshold-clipped' && e.detail.includes('mint.callsPerRun'));
    expect(clip).toBeDefined();
  });

  it('hands each call the reading, its cited snippets, and related claims retrieved lexically', async () => {
    const cited = snippet('s1', 'estimates are for coordination, not for promises');
    const uncited = snippet('s9', 'the cat sat on an entirely unrelated mat');
    const near = claim('c-near', 'They say estimates are for coordination at work.', { cites: ['s1@1'] });
    const far = claim('c-far', 'They keep a paper notebook beside the bed.', { cites: ['s1@1'] });
    const h = harness({
      claims: [near, far],
      snippets: [cited, uncited],
      readings: [reading('r-1', ['s1@1'], 'estimates are for coordination, they told me')],
      propose: async () => mintResult([]),
    });
    await h.run();

    const call = h.rec.proposeCalls[0];
    expect(call?.reading.id).toBe('r-1');
    // The cited snippet is supplied and nothing else is — `proposeOps` warns
    // and drops a cite the caller did not gather, which costs the reading its
    // evidence and therefore its ops.
    expect(Object.keys(call?.snippets ?? {})).toEqual(['s1']);
    expect(call?.relatedClaims.length).toBeLessThanOrEqual(3);
    expect(call?.relatedClaims.map((c) => c.id)).toContain('c-near');
  });

  it('never offers an archived or superseded claim as related material', async () => {
    const gone = claim('c-gone', 'They say estimates are for coordination, once.', {
      cites: ['s1@1'],
      archived: true,
      archiveReason: 'a misreading',
    });
    const past = claim('c-past', 'They say estimates are for coordination, formerly.', {
      cites: ['s1@1'],
      supersededBy: 'c-live',
      supersedeReason: 'the person changed',
    });
    const live = claim('c-live', 'They say estimates are for coordination at work.', { cites: ['s1@1'] });
    const h = harness({
      claims: [gone, past, live],
      snippets: [snippet('s1', 'estimates are for coordination')],
      readings: [reading('r-1', ['s1@1'], 'estimates are for coordination, they told me')],
      propose: async () => mintResult([]),
    });
    await h.run();

    // An UPDATE against an archived claim is rejected by the write boundary, so
    // offering one spends a call to earn a rejection.
    const shown = h.rec.proposeCalls[0]?.relatedClaims.map((c) => c.id) ?? [];
    expect(shown).not.toContain('c-gone');
    expect(shown).not.toContain('c-past');
    expect(shown).toContain('c-live');
  });

  it('shows at most three related claims', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      claim(`c-${i}`, `They say estimates are for coordination in case ${i}.`, { cites: ['s1@1'] }),
    );
    const h = harness({
      claims: many,
      snippets: [snippet('s1', 'estimates are for coordination')],
      readings: [reading('r-1', ['s1@1'], 'estimates are for coordination, they told me')],
      propose: async () => mintResult([]),
    });
    await h.run();
    expect(h.rec.proposeCalls[0]?.relatedClaims.length).toBeLessThanOrEqual(3);
  });

  it('a claim with a stale model stamp gets a model-upgrade SUPERSEDE', async () => {
    const old = claim('c-old', 'They avoid deadlines.', { model: 'bonsai-27b-old' });
    const h = harness({
      claims: [old],
      snippets: [s1],
      readings: [reading('r-1', ['s1@1'], 'They now set their own deadlines.')],
      propose: async () =>
        mintResult([
          {
            op: 'SUPERSEDE',
            reading: 'r-1',
            claim: 'c-old',
            body: 'They set their own deadlines now.',
            range: 'at work',
            cites: ['s1@1'],
            reason: 'the person changed',
          },
        ]),
    });
    await h.run();

    const after = h.store.readClaim('c-old');
    expect(after?.supersededBy).toBeDefined();
    expect(after?.supersedeReason).toBe('model-upgrade');
  });

  it('a claim written by the current model keeps the model reason it was given', async () => {
    const current = claim('c-cur', 'They avoid deadlines.', { model: MODEL });
    const h = harness({
      claims: [current],
      snippets: [s1],
      readings: [reading('r-1', ['s1@1'], 'They now set their own deadlines.')],
      propose: async () =>
        mintResult([
          {
            op: 'SUPERSEDE',
            reading: 'r-1',
            claim: 'c-cur',
            body: 'They set their own deadlines now.',
            range: 'at work',
            cites: ['s1@1'],
            reason: 'the person changed',
          },
        ]),
    });
    await h.run();

    expect(h.store.readClaim('c-cur')?.supersedeReason).toBe('the person changed');
  });
});

// ── Job 2: lint consequences ──

describe('lint still-true questions', () => {
  const staleSnippet = snippet('s1', 'estimates are for coordination', { version: 2 });
  const draft: QueueDraft = {
    source: 'still-true',
    license: 'CC0',
    question: 'You wrote: "estimates are for coordination." When did that last hold?',
    questionForm: 'deliberative',
    cites: ['s1@1'],
    quotedFragment: 'estimates are for coordination',
    sharpness: 'weak',
    horizon: 'days',
  };

  it('mints exactly one entry carrying source lint-still-true and the flagged claim id', async () => {
    const h = harness({
      claims: [claim('c-1', 'They treat estimates as coordination.', { cites: ['s1@1'] })],
      snippets: [staleSnippet],
      stillTrue: async () => draft,
    });
    await h.run();

    expect(h.queue.entries).toHaveLength(1);
    expect(h.queue.entries[0]?.source).toBe('lint-still-true');
    expect(h.queue.entries[0]?.claim).toBe('c-1');
  });

  it('does not re-mint while the entry is asked, and mints again once it is answered', async () => {
    const asked = fakeQueue([
      queueEntry('q-old', { source: 'lint-still-true', status: 'asked', claim: 'c-1' }),
    ]);
    const h = harness({
      claims: [claim('c-1', 'They treat estimates as coordination.', { cites: ['s1@1'] })],
      snippets: [staleSnippet],
      queue: asked,
      stillTrue: async () => draft,
    });
    await h.run();
    expect(h.rec.stillTrueCalls).toHaveLength(0);

    const answered = fakeQueue([
      queueEntry('q-old', { source: 'lint-still-true', status: 'answered', claim: 'c-1' }),
    ]);
    const h2 = harness({
      claims: [claim('c-1', 'They treat estimates as coordination.', { cites: ['s1@1'] })],
      snippets: [staleSnippet],
      queue: answered,
      stillTrue: async () => draft,
    });
    await h2.run();
    expect(h2.queue.entries.filter((e) => e.source === 'lint-still-true')).toHaveLength(2);
  });

  it('two claims citing one stale snippet each get their own question', async () => {
    const h = harness({
      claims: [
        claim('c-1', 'They treat estimates as coordination.', { cites: ['s1@1'] }),
        claim('c-2', 'They resist fixed dates.', { cites: ['s1@1'] }),
      ],
      snippets: [staleSnippet],
      stillTrue: async () => draft,
    });
    await h.run();

    const minted = h.queue.entries.filter((e) => e.source === 'lint-still-true');
    expect(minted).toHaveLength(2);
    expect(new Set(minted.map((e) => e.claim))).toEqual(new Set(['c-1', 'c-2']));
  });

  it('a composeStillTrue that throws costs one question and not the run', async () => {
    const h = harness({
      claims: [claim('c-1', 'They treat estimates as coordination.', { cites: ['s1@1'] })],
      snippets: [staleSnippet],
      stillTrue: async () => {
        throw new Error('model down');
      },
    });
    const report = await h.run();

    expect(h.queue.entries).toHaveLength(0);
    expect(report.lint.some((f) => f.kind === 'stale-citation')).toBe(true);
    // The failure names the step it happened in, which is all the reader gets.
    expect(kinds(h.rec)).toContain('wiki-jobs-failed');
    expectTrailIsAppendable(h.rec);
  });

  it('never calls Registry.mergeCandidates — lint owns the merge-candidate note', async () => {
    const h = harness({ snippets: [staleSnippet] });
    h.deps.registry = {
      ...h.deps.registry,
      mergeCandidates: () => {
        throw new Error('runWikiJobs must not call registry.mergeCandidates');
      },
    };
    await expect(runWikiJobs(h.deps)).resolves.toBeDefined();
  });
});

// ── Job 2: lint — undiscriminated-range questions (ticket 060) ──

/**
 * The register with `lint.undiscriminatedRangeSimilarity` flipped live. The
 * shipped register shadows the finding (Q-35), and a shadowed finding is
 * computed but not returned — these tests need it returned to exercise the
 * minting path, exactly as the god-node shadow is held shut elsewhere.
 */
const DISCRIMINATED_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'lint.undiscriminatedRangeSimilarity': {
    ...THRESHOLDS['lint.undiscriminatedRangeSimilarity'],
    live: true,
  },
};

describe('lint undiscriminated-range questions', () => {
  const s1 = snippet('s1', 'I am happiest around the bakery counter at dawn.');
  const s2 = snippet('s2', 'The bakery is where my week starts.', { session: 'sess-2' });
  const draft: QueueDraft = {
    source: 'lint-undiscriminated-range',
    license: 'CC0',
    question:
      'You wrote: "I am happiest around the bakery counter at dawn." and "The bakery is where my week starts." Where does the first hold, and where does the second?',
    questionForm: 'deliberative',
    cites: ['s1@1', 's2@1'],
    quotedFragment: 'I am happiest around the bakery counter at dawn',
    sharpness: 'weak',
    horizon: 'session',
  };
  const pair = (): HarnessOptions => ({
    thresholds: DISCRIMINATED_LIVE,
    claims: [
      claim('c-a', 'The bakery is a refuge.', { cites: ['s1@1'], referents: ['the-bakery'] }),
      claim('c-b', 'The bakery is a second home.', { cites: ['s2@1'], referents: ['the-bakery'] }),
    ],
    snippets: [s1, s2],
    discriminating: async () => draft,
  });

  it('mints exactly one entry for a same-range pair, carrying both claim ids', async () => {
    const h = harness(pair());
    await h.run();

    const minted = h.queue.entries.filter((e) => e.source === 'lint-undiscriminated-range');
    expect(minted).toHaveLength(1);
    expect(minted[0]?.claims).toEqual(['c-a', 'c-b']);
    expect(h.rec.discriminatingCalls).toBe(1);
  });

  it('three consecutive runs mint exactly one question for the pair', async () => {
    const h = harness(pair());
    await h.run();
    // Change the graph between runs so the watermark re-opens the lint job
    // (lint is watermark-gated on the index being current). Each extra claim
    // carries a range that pairs with nothing, so it re-opens without
    // minting a question of its own.
    h.store.writeClaim(claim('c-extra', 'The bakery opens at six.', { cites: ['s1@1'], referents: ['the-bakery'], range: 'at night' }));
    await h.run();
    h.store.writeClaim(claim('c-extra-2', 'The bakery closes at noon.', { cites: ['s1@1'], referents: ['the-bakery'], range: 'on weekends' }));
    await h.run();

    const minted = h.queue.entries.filter((e) => e.source === 'lint-undiscriminated-range');
    expect(minted).toHaveLength(1);
    expect(minted[0]?.claims).toEqual(['c-a', 'c-b']);
    expect(h.rec.discriminatingCalls).toBe(1);
  });

  it('does not re-mint while the entry is held, and mints again once answered', async () => {
    const held = fakeQueue([
      queueEntry('q-held', { source: 'lint-undiscriminated-range', status: 'asked', claims: ['c-a', 'c-b'] }),
    ]);
    const h = harness({ ...pair(), queue: held });
    await h.run();
    expect(h.rec.discriminatingCalls).toBe(0);

    const answered = fakeQueue([
      queueEntry('q-answered', { source: 'lint-undiscriminated-range', status: 'answered', claims: ['c-a', 'c-b'] }),
    ]);
    const h2 = harness({ ...pair(), queue: answered });
    await h2.run();
    expect(h2.queue.entries.filter((e) => e.source === 'lint-undiscriminated-range')).toHaveLength(2);
    expect(h2.rec.discriminatingCalls).toBe(1);
  });

  it('clearly different ranges produce no question', async () => {
    const h = harness({
      thresholds: DISCRIMINATED_LIVE,
      claims: [
        claim('c-a', 'The bakery is a refuge.', { cites: ['s1@1'], referents: ['the-bakery'] }),
        claim('c-b', 'The bakery is a second home.', { cites: ['s2@1'], referents: ['the-bakery'], range: 'with my kids' }),
      ],
      snippets: [s1, s2],
      discriminating: async () => draft,
    });
    await h.run();

    expect(h.queue.entries).toHaveLength(0);
    expect(h.rec.discriminatingCalls).toBe(0);
  });

  it('a compose that throws costs one question and not the run', async () => {
    const h = harness({
      ...pair(),
      discriminating: async () => {
        throw new Error('model down');
      },
    });
    const report = await h.run();

    expect(h.queue.entries).toHaveLength(0);
    expect(report.lint.some((f) => f.kind === 'undiscriminated-range')).toBe(true);
    // The failure names the step it happened in, which is all the reader gets.
    expect(kinds(h.rec)).toContain('wiki-jobs-failed');
    expectTrailIsAppendable(h.rec);
  });
});

// ── The answer path (ticket 060): one answered question, two SUPERSEDEs ──

describe('range discrimination answers', () => {
  const ASKED_AT = '2026-02-01T00:00:00.000Z';
  const s1 = snippet('s1', 'I am happiest around the bakery counter at dawn.', { session: 'sess-a' });
  const s2 = snippet('s2', 'The bakery is where my week starts.', { session: 'sess-b' });
  const s3 = snippet('s3', 'It depends on the day, honestly.', { session: 'sess-c' });
  const answered = (): FakeQueue =>
    fakeQueue([
      queueEntry('q-1', {
        source: 'lint-undiscriminated-range',
        status: 'answered',
        answeredAt: ASKED_AT,
        claims: ['a-1', 'b-1'],
      }),
    ]);
  const seeded = (): HarnessOptions => ({
    claims: [
      claim('a-1', 'The bakery is a refuge.', { cites: ['s1@1'], referents: ['the-bakery'] }),
      claim('b-1', 'The bakery is a second home.', { cites: ['s2@1'], referents: ['the-bakery'] }),
    ],
    snippets: [s1, s2, s3],
    readings: [
      reading('r-1', ['s3@1'], 'At work it is a refuge from the floor.', { at: '2026-02-02T00:00:00.000Z' }),
      reading('r-2', ['s3@1'], 'With my kids it is just a stop.', { at: '2026-02-02T00:00:00.000Z' }),
    ],
    queue: answered(),
    narrowedRanges: async () => ({ a: 'at work', b: 'with my kids' }),
  });

  it('narrows both claims to evidenced via two SUPERSEDEs', async () => {
    const h = harness(seeded());
    await h.run();

    const oldA = h.store.readClaim('a-1');
    const oldB = h.store.readClaim('b-1');
    expect(oldA?.supersededBy).toBeDefined();
    expect(oldB?.supersededBy).toBeDefined();
    expect(oldA?.supersedeReason).toBe('range-discriminated:lint:the-bakery');
    expect(oldB?.supersedeReason).toBe('range-discriminated:lint:the-bakery');

    const newA = h.store.readClaim(oldA?.supersededBy ?? '');
    const newB = h.store.readClaim(oldB?.supersededBy ?? '');
    expect(newA?.range).toBe('at work');
    expect(newB?.range).toBe('with my kids');
    // Each new claim cites its original snippet AND the answer's, in that order.
    expect(newA?.cites).toEqual(['s1@1', 's3@1']);
    expect(newB?.cites).toEqual(['s2@1', 's3@1']);
    // applyOps recomputes status internally; ≥2 distinct sittings is evidenced.
    expect(newA?.status).toBe('evidenced');
    expect(newB?.status).toBe('evidenced');
  });

  it('is idempotent: a superseded pair never discriminates again', async () => {
    const h = harness(seeded());
    await h.run();
    const callsAfterFirst = h.rec.narrowedRangesCalls;
    await h.run();
    expect(h.rec.narrowedRangesCalls).toBe(callsAfterFirst);
  });

  it('an answer from one of the claims\' own sittings is refused', async () => {
    const sSame = snippet('s-same', 'The bakery, again.', { session: 'sess-a' });
    const h = harness({
      claims: [
        claim('a-1', 'The bakery is a refuge.', { cites: ['s1@1'], referents: ['the-bakery'] }),
        claim('b-1', 'The bakery is a second home.', { cites: ['s2@1'], referents: ['the-bakery'] }),
      ],
      snippets: [s1, s2, sSame],
      readings: [
        reading('r-same', ['s-same@1'], 'From the same sitting as the first claim.', { at: '2026-02-02T00:00:00.000Z' }),
      ],
      queue: answered(),
      narrowedRanges: async () => ({ a: 'at work', b: 'with my kids' }),
    });
    await h.run();

    expect(h.rec.narrowedRangesCalls).toBe(0);
    expect(h.store.readClaim('a-1')?.supersededBy).toBeUndefined();
    expect(h.store.readClaim('b-1')?.supersededBy).toBeUndefined();
  });

  it('an answered entry without a claims pair is skipped', async () => {
    const h = harness({
      claims: [
        claim('a-1', 'The bakery is a refuge.', { cites: ['s1@1'], referents: ['the-bakery'] }),
        claim('b-1', 'The bakery is a second home.', { cites: ['s2@1'], referents: ['the-bakery'] }),
      ],
      snippets: [s1, s2, s3],
      readings: [
        reading('r-1', ['s3@1'], 'At work it is a refuge from the floor.', { at: '2026-02-02T00:00:00.000Z' }),
      ],
      queue: fakeQueue([
        queueEntry('q-bare', { source: 'lint-undiscriminated-range', status: 'answered', answeredAt: ASKED_AT }),
      ]),
      narrowedRanges: async () => ({ a: 'at work', b: 'with my kids' }),
    });
    await h.run();

    expect(h.rec.narrowedRangesCalls).toBe(0);
    expect(h.store.readClaim('a-1')?.supersededBy).toBeUndefined();
  });
});

// ── Job 3: the candidate pool ──

describe('candidates', () => {
  const s1 = snippet('s1', 'estimates are for coordination');
  const s2 = snippet('s2', 'estimates are promises, full stop', { session: 'sess-2' });
  const cA = claim('c-a', 'They treat estimates as coordination.', { cites: ['s1@1'] });
  const cB = claim('c-b', 'They treat estimates as promises.', { cites: ['s2@1'] });

  const opposed: OppositionJudgment = {
    opposed: true,
    poleA: 'estimates are for coordination',
    poleB: 'estimates are promises',
  };

  it('counts judged and opposed apart, and persists only the opposed pair', async () => {
    const cC = claim('c-c', 'They keep a paper notebook.', { cites: ['s1@1'] });
    const h = harness({
      claims: [cA, cB, cC],
      snippets: [s1, s2],
      channels: [staticChannel([['c-a', 'c-b'], ['c-a', 'c-c']])],
      opposition: async (a, b) =>
        a.id === 'c-a' && b.id === 'c-b' ? opposed : { opposed: false, poleA: '', poleB: '' },
    });
    const report = await h.run();

    expect(report.oppositionJudged).toBe(2);
    expect(report.oppositionOpposed).toBe(1);
    const written = h.store.listCandidates();
    expect(written).toHaveLength(1);
    expect(written[0]?.pair.slice().sort()).toEqual(['c-a', 'c-b']);
    expect(written[0]?.status).toBe('pending-remeasure');
    expect(written[0]?.channel).toBe('lexical');
    expect(written[0]?.model).toBe(MODEL);
  });

  it('persists the pooled attempts count rather than defaulting it', async () => {
    const expired: ClashCandidate = {
      id: 'cand-old',
      pair: ['c-a', 'c-b'],
      channel: 'lexical',
      status: 'dissolved',
      outcome: 'remeasure-expired',
      attempts: 1,
      model: MODEL,
      modelAt: T0,
      created: T0,
    };
    const h = harness({
      claims: [cA, cB],
      candidates: [expired],
      snippets: [s1, s2],
      channels: [staticChannel([['c-a', 'c-b']])],
      opposition: async () => opposed,
    });
    const report = await h.run();

    const fresh = h.store.listCandidates().find((c) => c.status === 'pending-remeasure');
    expect(fresh?.attempts).toBe(2);
    expect(report.pool.reproposed).toBe(1);
  });

  it('reports the pool size, its per-channel contribution and what it suppressed', async () => {
    const silent: ClashChannel = { name: 'referent', candidates: () => [] };
    const h = harness({
      claims: [cA, cB],
      snippets: [s1, s2],
      channels: [staticChannel([['c-a', 'c-b']]), silent],
      opposition: async () => ({ opposed: false, poleA: '', poleB: '' }),
    });
    const report = await h.run();

    expect(report.candidates).toEqual({ lexical: 1, referent: 0 });
    expect(report.pool.size).toBe(1);
    expect(report.pool.suppressed).toBe(0);
  });

  it('caps the opposition judgments per run and emits threshold-clipped', async () => {
    const claims = Array.from({ length: 10 }, (_, i) => claim(`c-${i}`, `Claim number ${i}.`, { cites: ['s1@1'] }));
    const pairs: [string, string][] = [];
    for (let i = 0; i + 1 < claims.length; i += 2) pairs.push([`c-${i}`, `c-${i + 1}`]);
    const h = harness({
      claims,
      snippets: [s1],
      channels: [staticChannel(pairs)],
      opposition: async () => ({ opposed: false, poleA: '', poleB: '' }),
    });
    const report = await h.run();

    expect(report.oppositionJudged).toBe(3);
    expect(h.rec.events.some((e) => e.kind === 'threshold-clipped' && e.detail.includes('judgment'))).toBe(true);
  });

  it('the shadow record states whether each proposed pair joins two sittings', async () => {
    // Ticket 007's watch-item at the pipeline seam: the minted ClashCandidate
    // carries the pool's joinsTwoSittings stamp, computed from the sessions the
    // pair's snippets were captured in — not from anything the judge said.
    const same = harness({
      claims: [
        claim('c-a', 'They treat estimates as coordination.', { cites: ['sa1@1'] }),
        claim('c-b', 'They treat estimates as promises.', { cites: ['sa2@1'] }),
      ],
      snippets: [
        snippet('sa1', 'estimates are for coordination', { session: 'sess-a' }),
        snippet('sa2', 'estimates are promises, full stop', { session: 'sess-a' }),
      ],
      channels: [staticChannel([['c-a', 'c-b']])],
      opposition: async () => opposed,
    });
    await same.run();

    const cross = harness({
      claims: [
        claim('c-c', 'They treat estimates as coordination.', { cites: ['sb1@1'] }),
        claim('c-d', 'They treat estimates as promises.', { cites: ['sb2@1'] }),
      ],
      snippets: [
        snippet('sb1', 'estimates are for coordination', { session: 'sess-b' }),
        snippet('sb2', 'estimates are promises, full stop', { session: 'sess-c' }),
      ],
      channels: [staticChannel([['c-c', 'c-d']])],
      opposition: async () => opposed,
    });
    await cross.run();

    const all = [...same.store.listCandidates(), ...cross.store.listCandidates()];
    expect(all).toHaveLength(2);
    expect(all.every((c) => typeof c.joinsTwoSittings === 'boolean')).toBe(true);
    expect(all.find((c) => c.pair.includes('c-a'))?.joinsTwoSittings).toBe(false);
    expect(all.find((c) => c.pair.includes('c-c'))?.joinsTwoSittings).toBe(true);
  });

  it('a judgeOpposition that throws costs one pair and not the run', async () => {
    const h = harness({
      claims: [cA, cB],
      snippets: [s1, s2],
      channels: [staticChannel([['c-a', 'c-b']])],
      opposition: async () => {
        throw new Error('model down');
      },
    });
    const report = await h.run();
    expect(report.oppositionJudged).toBe(0);
    expect(h.store.listCandidates()).toHaveLength(0);
  });
});

// ── Job 4: re-measure minting ──

describe('re-measure minting', () => {
  const s1 = snippet('s1', 'estimates are for coordination');
  const s2 = snippet('s2', 'estimates are promises, full stop', { session: 'sess-2' });
  const cA = claim('c-a', 'They treat estimates as coordination.', { cites: ['s1@1'] });
  const cB = claim('c-b', 'They treat estimates as promises.', { cites: ['s2@1'] });
  const opposed: OppositionJudgment = {
    opposed: true,
    poleA: 'estimates are for coordination',
    poleB: 'estimates are promises',
  };
  const remeasureDraft: QueueDraft = {
    source: 'contradiction-remeasure',
    license: 'CC0',
    question: 'You wrote: "estimates are for coordination." What happened the last time one slipped?',
    questionForm: 'deliberative',
    cites: ['s1@1', 's2@1'],
    quotedFragment: 'estimates are for coordination',
    sharpness: 'weak',
    horizon: 'session',
  };

  function pending(id: string, pair: [string, string], extra: Partial<ClashCandidate> = {}): ClashCandidate {
    return {
      id,
      pair,
      channel: 'lexical',
      status: 'pending-remeasure',
      attempts: 1,
      model: MODEL,
      modelAt: T0,
      created: T0,
      ...extra,
    };
  }

  it('writes the entry id and remeasureAskedAt back onto the candidate', async () => {
    const h = harness({
      claims: [cA, cB],
      snippets: [s1, s2],
      channels: [staticChannel([['c-a', 'c-b']])],
      opposition: async () => opposed,
      remeasure: async () => remeasureDraft,
    });
    const report = await h.run();

    const cand = h.store.listCandidates()[0];
    expect(cand?.remeasureQueueId).toBe('q-1');
    expect(cand?.remeasureAskedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(cand?.remeasureAskedAt ?? ''))).toBe(false);
    expect(report.remeasuresMinted).toBe(1);
  });

  it('clips a third live re-measure and emits threshold-clipped', async () => {
    const live = fakeQueue([
      queueEntry('q-live-1', { status: 'pending' }),
      queueEntry('q-live-2', { status: 'asked' }),
    ]);
    const h = harness({
      claims: [cA, cB],
      candidates: [pending('cand-1', ['c-a', 'c-b'])],
      snippets: [s1, s2],
      queue: live,
      opposition: async () => opposed,
      remeasure: async () => remeasureDraft,
    });
    const report = await h.run();

    expect(report.remeasuresMinted).toBe(0);
    expect(
      h.rec.events.some((e) => e.kind === 'threshold-clipped' && e.detail.includes('remeasure.liveCap')),
    ).toBe(true);
  });

  it('dissolves a candidate whose re-measure entry expired, and leaves an asked one pending', async () => {
    const q = fakeQueue([
      queueEntry('q-exp', { status: 'expired' }),
      queueEntry('q-asked', { status: 'asked' }),
    ]);
    const h = harness({
      claims: [cA, cB, claim('c-c', 'Third.', { cites: ['s1@1'] }), claim('c-d', 'Fourth.', { cites: ['s1@1'] })],
      candidates: [
        pending('cand-exp', ['c-a', 'c-b'], { remeasureQueueId: 'q-exp' }),
        pending('cand-ask', ['c-c', 'c-d'], { remeasureQueueId: 'q-asked' }),
      ],
      snippets: [s1, s2],
      queue: q,
    });
    const report = await h.run();

    const byId = new Map(h.store.listCandidates().map((c) => [c.id, c]));
    expect(byId.get('cand-exp')?.status).toBe('dissolved');
    expect(byId.get('cand-exp')?.outcome).toBe('remeasure-expired');
    expect(byId.get('cand-ask')?.status).toBe('pending-remeasure');
    expect(byId.get('cand-ask')?.outcome).toBeUndefined();
    expect(report.remeasuresExpired).toBe(1);
  });

  it('a live pending pair produces no second record and no second question across three runs', async () => {
    const h = harness({
      claims: [cA, cB],
      snippets: [s1, s2],
      channels: [staticChannel([['c-a', 'c-b']])],
      opposition: async () => opposed,
      remeasure: async () => remeasureDraft,
    });
    await h.run();
    await h.run();
    await h.run();

    expect(h.store.listCandidates()).toHaveLength(1);
    expect(h.queue.entries.filter((e) => e.source === 'contradiction-remeasure')).toHaveLength(1);
    expect(h.rec.remeasureCalls).toHaveLength(1);
  });

  it('recovers a stranded candidate whose poles were lost with the run that judged it', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [pending('cand-1', ['c-a', 'c-b'])],
      snippets: [s1, s2],
      opposition: async () => opposed,
      remeasure: async () => remeasureDraft,
    });
    await h.run();

    expect(h.rec.oppositionCalls).toHaveLength(1);
    expect(h.store.listCandidates()[0]?.remeasureQueueId).toBe('q-1');
  });
});

// ── Job 5: confirmation ──

describe('confirmation', () => {
  const ASKED_AT = '2026-02-01T00:00:00.000Z';
  const s1 = snippet('s1', 'estimates are for coordination', { session: 'sess-a' });
  const s2 = snippet('s2', 'estimates are promises, full stop', { session: 'sess-b' });
  const answer = snippet('s3', 'last quarter I promised a date and I meant it', { session: 'sess-c' });
  const sameSitting = snippet('s4', 'and I meant it then too', { session: 'sess-a' });
  const cA = claim('c-a', 'They treat estimates as coordination.', { cites: ['s1@1'] });
  const cB = claim('c-b', 'They treat estimates as promises.', { cites: ['s2@1'] });

  function answered(): FakeQueue {
    return fakeQueue([queueEntry('q-ans', { status: 'answered' })]);
  }

  function candidate(extra: Partial<ClashCandidate> = {}): ClashCandidate {
    return {
      id: 'cand-1',
      pair: ['c-a', 'c-b'],
      channel: 'lexical',
      status: 'pending-remeasure',
      remeasureQueueId: 'q-ans',
      remeasureAskedAt: ASKED_AT,
      attempts: 1,
      model: MODEL,
      modelAt: T0,
      created: T0,
      ...extra,
    };
  }

  const confirming: ConfirmResult = {
    confirmed: true,
    type: 'synchronic',
    reason: 'the answer holds both positions',
    evidence: { snippetRef: 's3@1', quote: 'I promised a date', side: 'b' },
  };

  it('opens a Contradiction carrying its evidence and both claims recompute to contested', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [reading('r-new', ['s3@1'], 'They hold both.', { at: '2026-03-01T00:00:00.000Z' })],
      queue: answered(),
      confirm: async () => confirming,
    });
    const report = await h.run();

    expect(report.contradictionsOpened).toBe(1);
    const opened = h.store.listContradictions();
    expect(opened).toHaveLength(1);
    expect(opened[0]?.evidence).toEqual(confirming.evidence);
    expect(opened[0]?.remeasureQueueId).toBe('q-ans');
    expect(opened[0]?.claims.slice().sort()).toEqual(['c-a', 'c-b']);
    expect(h.store.readClaim('c-a')?.status).toBe('contested');
    expect(h.store.readClaim('c-b')?.status).toBe('contested');
    expect(kinds(h.rec)).toContain('claim-status-changed');
    expect(h.store.listCandidates()[0]?.status).toBe('confirmed');
    // The transition is the feed line a person actually reads about this run.
    expectTrailIsAppendable(h.rec);
  });

  it('passes only readings later than remeasureAskedAt to the judgment', async () => {
    let seen: Reading[] = [];
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [
        reading('r-old', ['s3@1'], 'An older reading carrying the pole.', { at: '2026-01-15T00:00:00.000Z' }),
        reading('r-new', ['s3@1'], 'They hold both.', { at: '2026-03-01T00:00:00.000Z' }),
      ],
      queue: answered(),
      confirm: async () => null,
    });
    h.deps.judgeConfirmation = async (_c, remeasure) => {
      seen = remeasure.readings;
      return null;
    };
    await runWikiJobs(h.deps);

    expect(seen.map((r) => r.id)).toEqual(['r-new']);
  });

  it('refuses a confirming reading from a sitting either claim already rests on (Q-53)', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, sameSitting],
      readings: [reading('r-same', ['s4@1'], 'Same sitting as claim A.', { at: '2026-03-01T00:00:00.000Z' })],
      queue: answered(),
      confirm: async () => confirming,
    });
    const report = await h.run();

    expect(h.rec.confirmCalls).toHaveLength(0);
    expect(report.contradictionsOpened).toBe(0);
    expect(h.store.listCandidates()[0]?.status).toBe('pending-remeasure');
  });

  it('dissolves an honest no as dissolved-on-answer', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [reading('r-new', ['s3@1'], 'They are not in tension.', { at: '2026-03-01T00:00:00.000Z' })],
      queue: answered(),
      confirm: async () => ({ confirmed: false, reason: 'the answer dissolves it' }),
    });
    const report = await h.run();

    expect(report.candidatesDissolved).toBe(1);
    expect(h.store.listCandidates()[0]?.outcome).toBe('dissolved-on-answer');
    expect(h.store.listContradictions()).toHaveLength(0);
  });

  it('persists a range-discriminated dissolution as its own outcome (Q-54)', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [reading('r-new', ['s3@1'], 'x', { at: '2026-03-01T00:00:00.000Z' })],
      queue: answered(),
      confirm: async () => ({ confirmed: false, reason: RANGE_DISCRIMINATED }),
    });
    const report = await h.run();

    expect(h.store.listCandidates()[0]?.outcome).toBe('range-discriminated');
    expect(report.candidatesDissolved).toBe(1);
    // The three reasons stay countable apart, which is what the closed union is for.
    expect(dissolutionOutcome('the answer dissolves it')).toBe('dissolved-on-answer');
    expect(dissolutionOutcome(UNVERIFIED_CONFIRMATION)).toBe('unverified-confirmation');
  });

  it('counts an unverified confirmation apart from an honest no', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [reading('r-new', ['s3@1'], 'x', { at: '2026-03-01T00:00:00.000Z' })],
      queue: answered(),
      confirm: async () => ({ confirmed: false, reason: UNVERIFIED_CONFIRMATION }),
    });
    await h.run();

    expect(h.store.listCandidates()[0]?.outcome).toBe('unverified-confirmation');
  });

  it('a dissolved pair is never re-proposed', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [reading('r-new', ['s3@1'], 'x', { at: '2026-03-01T00:00:00.000Z' })],
      queue: answered(),
      channels: [staticChannel([['c-a', 'c-b']])],
      confirm: async () => ({ confirmed: false, reason: 'no' }),
      opposition: async () => ({ opposed: true, poleA: 'estimates are for coordination', poleB: 'estimates are promises' }),
    });
    const first = await h.run();
    // The run that dissolved it also refused to re-pool the pair.
    expect(first.pool.size).toBe(0);
    expect(first.pool.suppressed).toBe(1);
    const after = await h.run();
    expect(h.store.listCandidates()).toHaveLength(1);
    // Ticket 076: nothing changed since the watermark the first run wrote, so the
    // candidates pass is skipped and logged — the empty pool is the skip, not a
    // re-pool that found the pair admissible.
    expect(after.pool.size).toBe(0);
    const skipped = h.rec.events.filter((e) => e.kind === 'wiki-job-skipped');
    expect(skipped.some((e) => e.detail.startsWith('job=candidates '))).toBe(true);
  });

  it('a candidate whose entry is still asked is skipped', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [reading('r-new', ['s3@1'], 'x', { at: '2026-03-01T00:00:00.000Z' })],
      queue: fakeQueue([queueEntry('q-ans', { status: 'asked' })]),
      confirm: async () => confirming,
    });
    const report = await h.run();

    expect(h.rec.confirmCalls).toHaveLength(0);
    expect(report.contradictionsOpened).toBe(0);
    expect(h.store.listCandidates()[0]?.status).toBe('pending-remeasure');
  });

  it('a judgeConfirmation that throws leaves the candidate pending', async () => {
    const h = harness({
      claims: [cA, cB],
      candidates: [candidate()],
      snippets: [s1, s2, answer],
      readings: [reading('r-new', ['s3@1'], 'x', { at: '2026-03-01T00:00:00.000Z' })],
      queue: answered(),
      confirm: async () => {
        throw new Error('model down');
      },
    });
    const report = await h.run();
    expect(h.store.listCandidates()[0]?.status).toBe('pending-remeasure');
    expect(report.candidatesDissolved).toBe(0);
  });
});

// ── Ticket 067: the embedding channel is no longer one run behind ──

/**
 * The sweep mints claims in job 1 and the pool reads them in job 3, so a run
 * that primed only before it started could never pair anything it had just
 * minted. The failure was silence, never an error — and silence is exactly what
 * Q-35 reads as "the channel found nothing".
 *
 * These tests use the REAL `embeddingChannel`, injected as a plain
 * `ClashChannel` in exactly the shape `src/server.ts` builds it, because the
 * seam being tested is that `runWikiJobs` finds the async half of a channel it
 * only holds by the synchronous interface.
 */
describe('the second prime', () => {
  const s1 = snippet('s1', 'estimates are for coordination, not for promises');
  const r1 = reading('r-1', ['s1@1'], 'They said estimates coordinate the week.');

  /** Unit vectors in the plane: the cosine between two of them is cos(a − b). */
  const ray = (radians: number): number[] => [Math.cos(radians), Math.sin(radians), 0];

  const OLD = 'They treat estimates as coordination.';
  const MINTED = 'They keep treating estimates as a way to coordinate.';
  const COLD = 'They keep a paper notebook beside the bed.';

  /** `OLD` and `MINTED` sit 0.2 radians apart — cosine ≈ 0.980. `COLD` is far. */
  const VECTORS: Record<string, number[]> = { [OLD]: ray(0), [MINTED]: ray(0.2), [COLD]: ray(1.4) };

  const EMBED_MODEL = 'fake-embed';

  function memStore(seed: EmbeddingRecord[] = []): EmbeddingIndexStore & { rows: EmbeddingRecord[] } {
    const holder = {
      rows: [...seed],
      load: () => holder.rows.map((r) => ({ ...r, vector: [...r.vector] })),
      save: (records: EmbeddingRecord[]) => {
        holder.rows = records.map((r) => ({ ...r, vector: [...r.vector] }));
      },
    };
    return holder;
  }

  /** Every text this run asked the embedder for — the narrowing's only honest witness. */
  function embedder(): { embed: Embed; texts: string[] } {
    const texts: string[] = [];
    return {
      texts,
      embed: async (batch) => {
        texts.push(...batch);
        return batch.map((t) => VECTORS[t] ?? [0, 0, 1]);
      },
    };
  }

  /** A vector as a previous run — or `src/server.ts`'s pre-run prime — left it. */
  function cached(claimId: string, body: string): EmbeddingRecord {
    return { claimId, hash: bodyHash(body), model: EMBED_MODEL, vector: VECTORS[body] ?? [0, 0, 1] };
  }

  const mintOp = { op: 'MINT', reading: 'r-1', body: MINTED, range: 'at work', cites: ['s1@1'], facet: 'construct' };

  function setup(opts: { threshold?: Threshold; claims?: Claim[]; seed?: EmbeddingRecord[] } = {}) {
    const fake = embedder();
    const store = memStore(opts.seed ?? [cached('c-old', OLD)]);
    const events: { kind: string; detail: string }[] = [];
    const log: LogFn = (e) => events.push({ kind: e.kind, detail: e.detail });
    const channel = embeddingChannel({
      embed: fake.embed,
      model: EMBED_MODEL,
      store,
      log,
      ...(opts.threshold ? { threshold: opts.threshold } : {}),
    });
    const h = harness({
      claims: opts.claims ?? [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      readings: [r1],
      channels: [channel],
      propose: async () => mintResult([mintOp]),
    });
    return { h, fake, store, events };
  }

  it('pairs a claim minted this run in the SAME run, with a live threshold', async () => {
    const live: Threshold = { name: 'clash.embeddingCosine', value: 0.82, live: true, graduatesWhen: 'test seam' };
    const { h, fake, store } = setup({ threshold: live });

    const first = await h.run();

    // The acceptance: the first run's pool holds a pair it could not hold
    // before — one side of it did not exist when the run began.
    const mintedClaim = h.store.loadSlice().claims.find((c) => c.body === MINTED);
    expect(mintedClaim).toBeDefined();
    expect(first.candidates['embedding']).toBe(1);
    expect(first.pool.size).toBe(1);
    expect(h.rec.oppositionCalls).toHaveLength(1);
    expect(h.rec.oppositionCalls[0]?.slice().sort()).toEqual(['c-old', mintedClaim!.id].sort());
    expect(fake.texts).toEqual([MINTED]);

    // The second run sweeps nothing, so it embeds nothing and asks for no
    // vector it does not already hold. The pair is still there — it was the
    // FIRST run that used to be blind, not the channel.
    const second = await h.run();
    expect(second.swept).toBe(0);
    // Ticket 076: an unchanged vault skips the index passes — the pool is not
    // recomputed, and the skip is logged as its own outcome, never silence.
    // The skips travel the harness's own log (`deps.log`), never the channel's
    // shadow-record log the setup closure captured.
    const skipped = h.rec.events.filter((e) => e.kind === 'wiki-job-skipped');
    expect(skipped.some((e) => e.detail.startsWith('job=candidates '))).toBe(true);
    expect(fake.texts).toEqual([MINTED]);
    // The pair the first run pooled is still in the channel's cache — the
    // channel retained it; only the recomputation was skipped.
    expect(store.rows.map((r) => r.claimId).sort()).toEqual(['c-old', mintedClaim!.id].sort());
  });

  it('pools a claim minted this run in the SAME run with the live channel', async () => {
    // Ticket 118: `clash.embeddingCosine` graduated live. The pair that was
    // only a shadow record before this ticket now enters the live pool.
    const { h } = setup();

    const report = await h.run();

    expect(report.candidates['embedding']).toBe(1);
    const mintedClaim = h.store.loadSlice().claims.find((c) => c.body === MINTED);
    expect(mintedClaim).toBeTruthy();
    // The clash-checked event records channel contributions, not individual ids.
    const checked = h.rec.events.find((e) => e.kind === 'clash-checked');
    expect(checked?.detail).toContain('embedding:1');
  });

  it('embeds only what the sweep added, never the rest of the graph', async () => {
    // `c-cold` is a live claim with NO cached vector — the state a first prime
    // that hit its budget, or an endpoint that was down, leaves behind. A
    // whole-graph second prime would embed it; this one must not.
    const { h, fake } = setup({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] }), claim('c-cold', COLD, { cites: ['s1@1'] })],
      seed: [cached('c-old', OLD)],
    });

    await h.run();

    expect(fake.texts).toEqual([MINTED]);
  });

  /** A channel that records what it was primed with, and pools nothing. */
  function spyChannel(
    name: EmbeddingChannel['name'] = 'embedding',
  ): EmbeddingChannel & { calls: (string[] | 'whole graph')[] } {
    const calls: (string[] | 'whole graph')[] = [];
    return {
      calls,
      name,
      candidates: () => [],
      prime: async (_graph, onlyIds) => {
        calls.push(onlyIds === undefined ? 'whole graph' : [...onlyIds]);
      },
    };
  }

  it('primes once with exactly the ids the sweep changed, and not at all when it changed nothing', async () => {
    const spy = spyChannel();
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      readings: [r1],
      channels: [spy],
      propose: async () => mintResult([mintOp]),
    });

    await h.run();
    const minted = h.store.loadSlice().claims.find((c) => c.body === MINTED);
    expect(spy.calls).toEqual([[minted!.id]]);

    // Nothing left to sweep, so there is nothing to embed and no reason to
    // rebuild the graph a sixth time to find that out.
    await h.run();
    expect(spy.calls).toEqual([[minted!.id]]);
  });

  it('primes EVERY channel that has an async half, not just the first', async () => {
    const first = spyChannel('embedding');
    const second = spyChannel('referent');
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      readings: [r1],
      channels: [first, second],
      propose: async () => mintResult([mintOp]),
    });

    await h.run();
    const minted = h.store.loadSlice().claims.find((c) => c.body === MINTED);

    expect(first.calls).toEqual([[minted!.id]]);
    expect(second.calls).toEqual([[minted!.id]]);
  });

  it('re-embeds a claim whose body this run rewrote', async () => {
    // An UPDATE changes the body in place, which invalidates the cached
    // vector's hash. A narrowing that only counted NEW ids would leave that
    // claim out of the pool for a run — the same lag, one door along.
    const fake = embedder();
    const store = memStore([cached('c-old', OLD)]);
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      readings: [r1],
      channels: [embeddingChannel({ embed: fake.embed, model: EMBED_MODEL, store, log: () => {} })],
      propose: async () =>
        mintResult([{ op: 'UPDATE', reading: 'r-1', claim: 'c-old', body: MINTED }]),
    });

    await h.run();

    expect(h.store.readClaim('c-old')?.body).toBe(MINTED);
    expect(fake.texts).toEqual([MINTED]);
    expect(store.rows[0]?.hash).toBe(bodyHash(MINTED));
  });

  it('makes no embedder call on a run that mints nothing', async () => {
    const fake = embedder();
    const store = memStore([cached('c-old', OLD)]);
    const { log } = { log: (() => {}) as LogFn };
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      channels: [embeddingChannel({ embed: fake.embed, model: EMBED_MODEL, store, log })],
    });

    await h.run();

    expect(fake.texts).toEqual([]);
    expect(store.rows.map((r) => r.claimId)).toEqual(['c-old']);
  });

  it('keeps the vectors of the claims the sweep did not touch, and drops the one it superseded', async () => {
    const supersede = {
      op: 'SUPERSEDE',
      reading: 'r-1',
      claim: 'c-old',
      body: MINTED,
      range: 'at work',
      cites: ['s1@1'],
      reason: 'the person changed',
    };
    const fake = embedder();
    const store = memStore([cached('c-old', OLD), cached('c-keep', COLD)]);
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] }), claim('c-keep', COLD, { cites: ['s1@1'] })],
      snippets: [s1],
      readings: [r1],
      channels: [embeddingChannel({ embed: fake.embed, model: EMBED_MODEL, store, log: () => {} })],
      propose: async () => mintResult([supersede]),
    });

    await h.run();

    // The superseded claim is never pooled again, so its vector buys nothing.
    // `c-keep` was not touched by this run and its vector must survive — the
    // prune is over the WHOLE post-sweep graph, not over the narrowing.
    const successor = h.store.loadSlice().claims.find((c) => c.body === MINTED);
    expect(successor).toBeDefined();
    expect(store.rows.map((r) => r.claimId).sort()).toEqual(['c-keep', successor!.id].sort());
  });

  it('a prime that fails costs the channel and not the run', async () => {
    const dead: Embed = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      readings: [r1],
      channels: [embeddingChannel({ embed: dead, model: EMBED_MODEL, store: memStore(), log: () => {} })],
      propose: async () => mintResult([mintOp]),
    });

    const report = await h.run();

    expect(report.applied).toBe(1);
    expect(report.pool.size).toBe(0);
    expect(kinds(h.rec)).toContain('clash-checked');
  });

  it('leaves a channel with no async half alone rather than calling into it', async () => {
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      readings: [r1],
      channels: [staticChannel([])],
      propose: async () => mintResult([mintOp]),
    });

    const report = await h.run();

    expect(report.applied).toBe(1);
    // Per-job isolation would swallow a call into a channel that has no
    // `prime`, so the absence of the FAILURE is what says the shape test ran.
    // A run that only looks fine because a try/catch caught it is the same
    // silence this ticket exists to remove.
    const failed = h.rec.events.filter(
      (e) => e.kind === 'wiki-jobs-failed' && e.detail.startsWith('job=prime'),
    );
    expect(failed).toEqual([]);
  });
});

// ── The run as a whole ──

describe('the run', () => {
  it('returns an empty report on a concurrent invocation', async () => {
    const s1 = snippet('s1', 'estimates are for coordination');
    const h = harness({
      snippets: [s1],
      readings: [reading('r-1', ['s1@1'], 'a')],
      propose: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return mintResult([]);
      },
    });
    const first = runWikiJobs(h.deps);
    const second = await runWikiJobs(h.deps);
    await first;

    expect(second.swept).toBe(0);
    expect(second.mint.calls).toBe(0);
    expect(second.lint).toEqual([]);
    expect(second.candidates).toEqual({});
    // The refusal is recorded: a run that did nothing must not look like a run
    // that never happened.
    expect(h.rec.events.some((e) => e.kind === 'wiki-jobs-failed' && e.detail.startsWith('job=lock'))).toBe(true);
  });

  it('returns a complete report when every injected model collaborator throws', async () => {
    const s1 = snippet('s1', 'estimates are for coordination', { version: 2 });
    const cA = claim('c-a', 'They treat estimates as coordination.', { cites: ['s1@1'] });
    const cB = claim('c-b', 'They treat estimates as promises.', { cites: ['s1@1'] });
    const boom = async (): Promise<never> => {
      throw new Error('every endpoint is down');
    };
    const h = harness({
      claims: [cA, cB],
      snippets: [s1],
      readings: [reading('r-1', ['s1@1'], 'a')],
      channels: [staticChannel([['c-a', 'c-b']])],
      propose: boom,
      opposition: boom,
      remeasure: boom,
      confirm: boom,
      stillTrue: boom,
    });
    const report = await h.run();

    for (const key of [
      'swept',
      'applied',
      'rejected',
      'unprocessed',
      'oversized',
      'stuck',
      'oppositionJudged',
      'oppositionOpposed',
      'remeasuresMinted',
      'remeasuresExpired',
      'contradictionsOpened',
      'candidatesDissolved',
    ] as const) {
      expect(typeof report[key]).toBe('number');
    }
    expect(report.lint).toBeInstanceOf(Array);
    expect(report.mint.callErrors).toBe(1);
    expect(report.shadow).toBeInstanceOf(Array);
    expect(report.pool.size).toBe(1);
  });

  it('collects the shadow records the run produced, into the report and not only the log', async () => {
    const referent = (slug: string, canonical: string): Referent => ({
      slug,
      canonical,
      kind: 'person',
      aliases: [],
      model: MODEL,
      modelAt: T0,
      created: T0,
      updated: T0,
    });
    const h = harness({
      claims: [claim('c-1', 'One.', { cites: ['s1@1'] })],
      referents: [referent('sarah-kim', 'Sarah Kim'), referent('kim-sarah', 'kim, SARAH')],
      snippets: [snippet('s1', 'estimates are for coordination')],
    });
    const report = await h.run();

    // `registry.mergeCandidateSimilarity` is shadowed, so lint records what it
    // would have noted. The record is the evidence that graduates it, and
    // evidence that exists only in a log file is evidence nobody reads.
    const merge = report.shadow.filter((r) => r.threshold === 'registry.mergeCandidateSimilarity');
    expect(merge.length).toBeGreaterThan(0);
    for (const r of report.shadow) {
      expect(r.threshold).not.toBe('unparsed');
      // The record carries the EVENT's own timestamp, never a second clock read.
      expect(r.at).toBe(h.rec.events.find((e) => e.detail.includes(r.would))?.at ?? r.at);
    }
    // The lint finding itself is withheld while the threshold is in shadow.
    expect(report.lint.some((f) => f.kind === 'merge-candidate')).toBe(false);
  });

  /**
   * The trail is a dependency, not a side effect.
   *
   * Nothing in `src/` wires the wiki layer's `LogFn` to `appendEvent` yet — that
   * is T13/T14's call site — so the only thing standing between "every shadow
   * record reaches the reader" and "every shadow record is discarded" is that
   * `log` is REQUIRED here and that what it receives is appendable. An optional
   * logger defaulting to a no-op is the shape that has already cost this repo
   * three inert mechanisms; this test is the shape's opposite.
   */
  it('emits an appendEvent-shaped, readable trail through the required log dependency', async () => {
    const referent = (slug: string, canonical: string): Referent => ({
      slug,
      canonical,
      kind: 'person',
      aliases: [],
      model: MODEL,
      modelAt: T0,
      created: T0,
      updated: T0,
    });
    const stale = snippet('s1', 'estimates are for coordination', { version: 2 });
    const cA = claim('c-a', 'They treat estimates as coordination.', { cites: ['s1@1'] });
    const cB = claim('c-b', 'They treat estimates as promises.', { cites: ['s1@1'] });

    // Enough material to drive every job past its first branch: a call failure,
    // a parse failure, an empty answer, an oversized payload, a clipped quota,
    // a stale citation, a pooled pair and a shadowed threshold.
    const readings = Array.from({ length: 16 }, (_, i) =>
      reading(`r-${String(i).padStart(2, '0')}`, ['s1@1'], `reading number ${i}`),
    );
    const h = harness({
      claims: [cA, cB],
      referents: [referent('sarah-kim', 'Sarah Kim'), referent('kim-sarah', 'kim, SARAH')],
      snippets: [stale],
      readings,
      channels: [staticChannel([['c-a', 'c-b']])],
      propose: async (item) => {
        if (item.reading.id === 'r-00') throw new Error('endpoint down');
        if (item.reading.id === 'r-01') return PARSE_FAILED();
        if (item.reading.id === 'r-02') return OVERSIZED();
        return mintResult([]);
      },
      opposition: async () => ({ opposed: false, poleA: '', poleB: '' }),
    });
    await h.run();

    const emitted = new Set(kinds(h.rec));
    for (const kind of [
      'mint-call-failed',
      'mint-parse-failed',
      'mint-empty',
      'mint-oversized',
      'threshold-clipped',
      'shadow-decision',
      'clash-checked',
    ]) {
      expect(emitted, `a run that did this work emitted no ${kind}`).toContain(kind);
    }
    expectTrailIsAppendable(h.rec);
  });

  it('satisfies the docket report field it has to ride in', async () => {
    const h = harness({ snippets: [] });
    const report = await h.run();
    const wiki: NonNullable<DocketReport['wiki']> = report;
    expect(wiki.swept).toBe(0);
  });
});

// ── Ticket 076: the docket's two gates ──

/**
 * `runWikiJobs` now gates the seven jobs: the four queue-driven jobs on the
 * vault's git diff, the three index passes on the watermark it wrote. A
 * skipped job is a log line, never silence — `wiki-job-skipped` with the job
 * and the reason. These tests hold the gates to that contract using a REAL
 * git repo in the harness tmp dir (the harness's own claim files are
 * committed first), and the real `embeddingChannel` where the watermark's
 * narrowing is on trial.
 */
describe('the docket gates (ticket 076)', () => {
  const GATE_MODEL = 'test-clerk-model';

  function gitInit(root: string, author: { name: string; email: string } = { name: 'elicit-clerk', email: 'clerk@localhost' }): void {
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'config', 'user.name', author.name]);
    execFileSync('git', ['-C', root, 'config', 'user.email', author.email]);
    execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);
  }

  function gitCommitAll(root: string, message = 'test'): void {
    execFileSync('git', ['-C', root, 'add', '-A']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', message]);
  }

  /** A reading file on disk in the vault's own shape — the git gate's input. */
  function writeReadingFile(root: string, r: Reading): void {
    const dir = join(root, 'wiki', 'readings');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${r.id}.md`), matter.stringify(r.reading, { id: r.id, facet: r.facet, stance: r.stance, cites: r.cites, at: r.at }), 'utf-8');
  }

  /** A snippet file on disk — the git gate's input. */
  function writeSnippetFile(root: string, s: Snippet): void {
    const dir = join(root, 'snippets', s.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `v${s.version}.md`), matter.stringify(s.prose, { id: s.id, version: s.version, captured: s.captured, provenance: s.provenance }), 'utf-8');
  }

  const skippedDetails = (h: { rec: Recorded }): string[] =>
    h.rec.events.filter((e) => e.kind === 'wiki-job-skipped').map((e) => e.detail);

  // The embedding helpers, duplicated from 'the second prime' — the watermark
  // narrowing is a property of the REAL channel, so the fakes it needs are
  // the same ones that describe already proved.
  /** Unit vectors in the plane: the cosine between two of them is cos(a − b). */
  const ray = (radians: number): number[] => [Math.cos(radians), Math.sin(radians), 0];

  const OLD = 'They treat estimates as coordination.';
  const MINTED = 'They keep treating estimates as a way to coordinate.';
  const COLD = 'They keep a paper notebook beside the bed.';

  /** `OLD` and `MINTED` sit 0.2 radians apart — cosine ≈ 0.980. `COLD` is far. */
  const VECTORS: Record<string, number[]> = { [OLD]: ray(0), [MINTED]: ray(0.2), [COLD]: ray(1.4) };

  const EMBED_MODEL = 'fake-embed';

  function memStore(seed: EmbeddingRecord[] = []): EmbeddingIndexStore & { rows: EmbeddingRecord[] } {
    const holder = {
      rows: [...seed],
      load: () => holder.rows.map((r) => ({ ...r, vector: [...r.vector] })),
      save: (records: EmbeddingRecord[]) => {
        holder.rows = records.map((r) => ({ ...r, vector: [...r.vector] }));
      },
    };
    return holder;
  }

  /** Every text this run asked the embedder for — the narrowing's only honest witness. */
  function embedder(): { embed: Embed; texts: string[] } {
    const texts: string[] = [];
    return {
      texts,
      embed: async (batch) => {
        texts.push(...batch);
        return batch.map((t) => VECTORS[t] ?? [0, 0, 1]);
      },
    };
  }

  /** A vector as a previous run — or `src/server.ts`'s pre-run prime — left it. */
  function cached(claimId: string, body: string): EmbeddingRecord {
    return { claimId, hash: bodyHash(body), model: EMBED_MODEL, vector: VECTORS[body] ?? [0, 0, 1] };
  }

  it('skips every job on an unchanged vault and logs each skip with its reason', async () => {
    const s1 = snippet('s1', 'A snippet.');
    const r1 = reading('r-1', ['s1@1'], 'A reading.');
    const h = harness({
      claims: [claim('c-1', 'A claim.', { cites: ['s1@1'] })],
      readings: [r1],
      snippets: [s1],
    });
    gitInit(h.deps.vaultRoot);
    writeSnippetFile(h.deps.vaultRoot, s1);
    writeReadingFile(h.deps.vaultRoot, r1);
    gitCommitAll(h.deps.vaultRoot);

    // First run: no watermark, so the index passes run and write one; the git
    // tree is clean, so the queue-driven jobs are skipped.
    const first = await h.run();
    expect(first.swept).toBe(0);
    const afterFirst = skippedDetails(h);
    expect(afterFirst.filter((d) => d.startsWith('job=presweep-confirmation '))).toHaveLength(1);
    expect(afterFirst.filter((d) => d.startsWith('job=discriminated-answer '))).toHaveLength(1);
    expect(afterFirst.filter((d) => d.startsWith('job=sweep '))).toHaveLength(1);
    expect(afterFirst.filter((d) => d.startsWith('job=remeasure '))).toHaveLength(1);
    expect(afterFirst.filter((d) => d.startsWith('job=confirmation '))).toHaveLength(1);

    // Second run: the watermark is current and the tree is still clean — every
    // job skips, each with its reason.
    const second = await h.run();
    expect(second.swept).toBe(0);
    const all = skippedDetails(h);
    // 13 lines: run 1 gated out the five queue jobs on the clean tree (5), run
    // 2 gated out all eight (8) — so the git-gated jobs log twice and the
    // watermark-gated passes once.
    expect(all).toHaveLength(13);
    for (const job of ['presweep-confirmation', 'discriminated-answer', 'sweep', 'remeasure', 'confirmation']) {
      expect(all.filter((d) => d.startsWith(`job=${job} `)), `skip for ${job}`).toHaveLength(2);
    }
    for (const job of ['prime', 'lint', 'candidates']) {
      expect(all.filter((d) => d.startsWith(`job=${job} `)), `skip for ${job}`).toHaveLength(1);
    }
    expect(h.rec.proposeCalls).toHaveLength(0);
    expect(h.rec.oppositionCalls).toHaveLength(0);
    // The two gate families name different reasons.
    expect(all.find((d) => d.startsWith('job=sweep '))).toContain('reason=no-diff');
    expect(all.find((d) => d.startsWith('job=candidates '))).toContain('reason=index-current');
  });

  it('a run after one new reading processes only that reading', async () => {
    const s1 = snippet('s1', 'A snippet.');
    const r1 = reading('r-1', ['s1@1'], 'A reading.');
    const r2 = reading('r-2', ['s1@1'], 'A second reading.');
    const h = harness({
      claims: [claim('c-1', 'A claim.', { cites: ['s1@1'] })],
      readings: [r1],
      snippets: [s1],
      propose: async () => mintResult([{ op: 'KEEP', reading: 'r-2' }]),
    });
    gitInit(h.deps.vaultRoot);
    writeSnippetFile(h.deps.vaultRoot, s1);
    writeReadingFile(h.deps.vaultRoot, r1);
    // r-1's sweep line predates the baseline — an earlier real run already
    // processed it, and the ledger is where that fact lives. The gate skips
    // work a run already did; it never forgets work a run never got to.
    h.store.appendSweep({ readingId: 'r-1', op: 'KEEP', at: T0, model: GATE_MODEL });
    gitCommitAll(h.deps.vaultRoot);
    await h.run(); // baseline: watermark written, r-1 swept

    // A new reading lands — a file the git tree has not seen, and a graph the
    // watermark has not seen.
    writeReadingFile(h.deps.vaultRoot, r2);
    h.index.readings['r-2'] = r2;
    await h.run();

    expect(h.rec.proposeCalls.map((c) => c.reading.id)).toEqual(['r-2']);
    // The jobs whose inputs did not change are skipped and say so. remeasure
    // skips on BOTH runs — run 2's change is a reading, and readings are not
    // one of its inputs — while presweep-confirmation's inputs include
    // readings, so run 2 gates it in (nothing to confirm, nothing changes).
    const all = skippedDetails(h);
    expect(all.filter((d) => d.startsWith('job=remeasure '))).toHaveLength(2);
    expect(all.filter((d) => d.startsWith('job=presweep-confirmation '))).toHaveLength(1);
  });

  it('without git, the watermark still gates the index passes while the queue jobs run', async () => {
    const s1 = snippet('s1', 'A snippet.');
    const r1 = reading('r-1', ['s1@1'], 'A reading.');
    const h = harness({
      claims: [claim('c-1', 'A claim.', { cites: ['s1@1'] })],
      readings: [r1],
      snippets: [s1],
      propose: async () => mintResult([{ op: 'KEEP', reading: 'r-1' }]),
    });
    await h.run(); // everything runs: no git, no watermark
    const callsAfterFirst = h.rec.proposeCalls.length;
    await h.run(); // index passes skip on the watermark; the queue jobs run as today

    const all = skippedDetails(h);
    expect(all.map((d) => d.split(' ')[0]?.replace('job=', ''))).toEqual(['prime', 'lint', 'candidates']);
    expect(h.rec.proposeCalls.length).toBe(callsAfterFirst);
    expect(all.every((d) => d.includes('reason=index-current'))).toBe(true);
  });

  it('narrows the embedding work list by the watermark delta and never the graph (067)', async () => {
    const s1 = snippet('s1', 'A snippet.');
    const fake = embedder();
    const store = memStore([cached('c-old', OLD), cached('c-keep', COLD)]);
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] }), claim('c-keep', COLD, { cites: ['s1@1'] })],
      snippets: [s1],
      channels: [embeddingChannel({ embed: fake.embed, model: EMBED_MODEL, store, log: () => {} })],
    });
    await h.run(); // watermark absent: the delta cannot be computed, so nothing narrows it
    // A claim is hand-edited between runs — a body change no sweep touched.
    h.store.writeClaim(claim('c-old', MINTED, { cites: ['s1@1'] }));
    await h.run();

    expect(fake.texts).toEqual([MINTED]);
    // The graph handed to prime stayed WHOLE: the untouched claim's vector
    // survived the persist prune (ticket 067 — the narrowing filters the work
    // list, never the graph).
    expect(store.rows.map((r) => r.claimId).sort()).toEqual(['c-keep', 'c-old'].sort());
    expect(store.rows.find((r) => r.claimId === 'c-old')?.hash).toBe(bodyHash(MINTED));
  });

  it('deleting the watermark forces the full rebuild that is today\'s path', async () => {
    const s1 = snippet('s1', 'A snippet.');
    const fake = embedder();
    const store = memStore([cached('c-old', OLD)]);
    const h = harness({
      claims: [claim('c-old', OLD, { cites: ['s1@1'] })],
      snippets: [s1],
      channels: [embeddingChannel({ embed: fake.embed, model: EMBED_MODEL, store, log: () => {} })],
      propose: async () => mintResult([{ op: 'KEEP', reading: 'r-1' }]),
      readings: [reading('r-1', ['s1@1'], 'A reading.')],
    });
    const first = await h.run(); // today's path: the passes all run
    rmSync(join(h.deps.vaultRoot, 'index', 'watermark.json'));
    const second = await h.run();

    expect(second.pool).toEqual(first.pool);
    // The index passes ran again — no skip for them — and rewrote the watermark.
    const all = skippedDetails(h);
    expect(all.filter((d) => d.startsWith('job=candidates '))).toEqual([]);
    expect(all.filter((d) => d.startsWith('job=prime '))).toEqual([]);
    expect(existsSync(join(h.deps.vaultRoot, 'index', 'watermark.json'))).toBe(true);
  });
});
