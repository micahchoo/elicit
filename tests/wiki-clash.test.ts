import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  lexicalChannel,
  poolCandidates,
  referentChannel,
  REFERENT_FANOUT_CAP,
  type ClashChannel,
} from '../src/wiki/clash.js';
import type {
  Claim,
  ClaimGraph,
  ClaimStore,
  ClashCandidate,
  ClashOutcome,
  Contradiction,
  LogFn,
  Referent,
  Registry,
  SweepLine,
} from '../src/wiki/contract.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import { PAIRS } from './fixtures/paraphrase-pairs.js';

const T = '2026-08-01T09:00:00.000Z';

function claim(id: string, body: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    body,
    range: 'at work',
    status: 'unconfirmed',
    cites: ['snip-1@1'],
    facet: 'construct',
    referents: [],
    fromReadings: [],
    attested: false,
    readLog: [],
    model: 'test-model',
    modelAt: T,
    created: T,
    updated: T,
    ...extra,
  };
}

function graph(claims: Claim[], extra: Partial<ClaimGraph> = {}): ClaimGraph {
  return {
    claims,
    snippets: {},
    readings: {},
    contradictions: [],
    referents: [],
    ...extra,
  };
}

function referent(slug: string): Referent {
  return {
    slug,
    canonical: slug,
    kind: 'person',
    aliases: [],
    model: 'test-model',
    modelAt: T,
    created: T,
    updated: T,
  };
}

function candidate(
  pair: [string, string],
  extra: Partial<ClashCandidate> = {},
): ClashCandidate {
  return {
    id: `cand-${pair[0]}-${pair[1]}`,
    pair,
    channel: 'lexical',
    status: 'pending-remeasure',
    attempts: 1,
    model: 'test-model',
    modelAt: T,
    created: T,
    ...extra,
  };
}

function contradiction(claims: [string, string], status: 'open' | 'dissolved'): Contradiction {
  return {
    id: `contra-${claims[0]}-${claims[1]}`,
    type: 'synchronic',
    claims,
    candidate: 'cand-x',
    remeasureQueueId: 'q-1',
    evidence: { snippetRef: 'snip-1@1', quote: 'x', side: 'a' },
    status,
    model: 'test-model',
    modelAt: T,
    opened: T,
    updated: T,
    body: '',
  };
}

/**
 * A store whose only real method is the one the pool reads. Every other member
 * throws: if the pool ever grows a second read, this fake makes it visible
 * rather than returning a plausible empty answer.
 */
function fakeStore(candidates: ClashCandidate[]): ClaimStore {
  const no = (name: string) => (): never => {
    throw new Error(`poolCandidates must not call store.${name}`);
  };
  return {
    listCandidates: () => candidates,
    loadSlice: no('loadSlice'),
    writeClaim: no('writeClaim') as (c: Claim) => void,
    readClaim: no('readClaim') as (id: string) => Claim | null,
    writeContradiction: no('writeContradiction') as (c: Contradiction) => void,
    listContradictions: no('listContradictions') as () => Contradiction[],
    writeCandidate: no('writeCandidate') as (c: ClashCandidate) => void,
    writeReferent: no('writeReferent') as (r: Referent) => void,
    listReferents: no('listReferents') as () => Referent[],
    appendSweep: no('appendSweep') as (e: SweepLine) => void,
    sweptReadingIds: no('sweptReadingIds') as () => Set<string>,
    oversizedReadingIds: no('oversizedReadingIds') as () => Set<string>,
    attemptCounts: no('attemptCounts') as () => Map<string, number>,
    recordRead: no('recordRead') as (id: string, at: string, surface: string) => void,
  };
}

/**
 * The registry as the referent channel uses it: `claimsFor` and nothing else.
 * `resolve` and `lookup` throw, which is how this test asserts that a retrieval
 * channel never mints or renames an identity.
 */
function fakeRegistry(): Registry {
  return {
    claimsFor: (slug, g) => g.claims.filter((c) => c.referents.includes(slug)),
    resolve: () => {
      throw new Error('a clash channel must not mint a referent');
    },
    lookup: () => {
      throw new Error('a clash channel must not resolve a name');
    },
    mergeCandidates: () => [],
  };
}

type Event = Parameters<LogFn>[0];

function recorder(): { log: LogFn; events: Event[] } {
  const events: Event[] = [];
  return { log: (e) => void events.push(e), events };
}

/** The pair ids of a pool, as sorted strings — what every assertion compares. */
function keys(pairs: { pair: [Claim, Claim] }[]): string[] {
  return pairs.map(({ pair }) => `${pair[0].id}+${pair[1].id}`);
}

// ── The lexical channel ──

describe('lexical channel', () => {
  it('pairs two claims that share a three-word phrase — over claim BODIES', () => {
    // No snippets in this graph at all. The existing snippet index could not
    // produce this pair: it is keyed by snippet id and returns snippet hits.
    const g = graph([
      claim('c1', 'I estimate tasks to coordinate with other people on the team'),
      claim('c2', 'Whenever I estimate tasks to coordinate the number stops being honest'),
      claim('c3', 'The dog next door barks at every passing bicycle without fail'),
    ]);
    expect(Object.keys(g.snippets)).toEqual([]);
    expect(keys(lexicalChannel.candidates(g).map((pair) => ({ pair })))).toEqual(['c1+c2']);
  });

  it('pairs the two poles of an opposition — negation is invisible to it (Q-52)', () => {
    // The whole pipeline rests on this: a channel that COULD see the "not"
    // would separate the poles and never pool them.
    const g = graph([
      claim('c1', 'Estimates exist so that other teams can coordinate around me'),
      claim('c2', 'Estimates do not exist so that other teams can plan anything'),
    ]);
    expect(lexicalChannel.candidates(g)).toHaveLength(1);
  });

  it('finds nothing when two claims share only a two-word phrase', () => {
    // Pins THRESHOLDS['clash.lexicalMinPhrase'] against the shipped index. The
    // number is stated in the register and hardcoded five times inside
    // src/index/lexical.ts; this file adds no sixth copy, so the register is
    // held to the index by behaviour instead.
    expect(THRESHOLDS['clash.lexicalMinPhrase'].value).toBe(3);
    const g = graph([
      claim('c1', 'Estimates coordinate nobody once the quarter starts moving sideways'),
      claim('c2', 'Estimates coordinate the calendar and nothing whatsoever besides that'),
    ]);
    expect(lexicalChannel.candidates(g)).toEqual([]);
  });

  it('never pairs a claim with itself', () => {
    const g = graph([claim('c1', 'I estimate tasks to coordinate with other people')]);
    expect(lexicalChannel.candidates(g)).toEqual([]);
  });

  it('never pairs an archived or a superseded claim', () => {
    const body = 'I estimate tasks to coordinate with other people on the team';
    const g = graph([
      claim('c1', body),
      claim('c2', `Yes — ${body} and it never works`, { archived: true, archiveReason: 'stale' }),
      claim('c3', `Also ${body} on bad weeks`, {
        supersededBy: 'c9',
        supersedeReason: 'model-upgrade',
      }),
    ]);
    expect(lexicalChannel.candidates(g)).toEqual([]);
  });
});

// ── The referent channel ──

describe('referent channel', () => {
  it('pairs two claims with ZERO shared vocabulary that name the same referent', () => {
    // The justification for the channel existing beside the lexical one. Not a
    // single content word is shared, and the lexical channel finds nothing.
    const g = graph(
      [
        claim('c1', 'My manager reads a draft before anyone else sees it', {
          referents: ['manager'],
        }),
        claim('c2', 'Nobody upstream ever looks at unfinished work here', {
          referents: ['manager'],
        }),
      ],
      { referents: [referent('manager')] },
    );
    expect(lexicalChannel.candidates(g)).toEqual([]);
    expect(keys(referentChannel(fakeRegistry()).candidates(g).map((pair) => ({ pair })))).toEqual([
      'c1+c2',
    ]);
  });

  it('pairs through an ALIAS, because who is the same is the registry’s answer', () => {
    // One claim says "boss", the other says "manager", and the registry knows
    // they are one person. A channel that read `claim.referents` itself would
    // find nothing here — which is why it reads `Registry.claimsFor` instead.
    const registry: Registry = {
      ...fakeRegistry(),
      claimsFor: (slug, g) => {
        const entry = g.referents.find((r) => r.slug === slug);
        const names = new Set([slug, ...(entry?.aliases ?? [])]);
        return g.claims.filter((c) => c.referents.some((r) => names.has(r)));
      },
    };
    const g = graph(
      [
        claim('c1', 'Alpha', { referents: ['boss'] }),
        claim('c2', 'Beta', { referents: ['manager'] }),
      ],
      { referents: [{ ...referent('manager'), aliases: ['boss'] }] },
    );
    expect(keys(referentChannel(registry).candidates(g).map((pair) => ({ pair })))).toEqual([
      'c1+c2',
    ]);
  });

  it('does not pair two claims that share no referent', () => {
    const g = graph(
      [
        claim('c1', 'My manager reads a draft first', { referents: ['manager'] }),
        claim('c2', 'The commute eats an hour', { referents: ['commute'] }),
      ],
      { referents: [referent('manager'), referent('commute')] },
    );
    expect(referentChannel(fakeRegistry()).candidates(g)).toEqual([]);
  });

  it('never pairs an archived or a superseded claim', () => {
    const g = graph(
      [
        claim('c1', 'Alpha', { referents: ['manager'] }),
        claim('c2', 'Beta', { referents: ['manager'], archived: true, archiveReason: 'stale' }),
        claim('c3', 'Gamma', {
          referents: ['manager'],
          supersededBy: 'c9',
          supersedeReason: 'model-upgrade',
        }),
      ],
      { referents: [referent('manager')] },
    );
    expect(referentChannel(fakeRegistry()).candidates(g)).toEqual([]);
  });

  it('emits each pair once when two referents are shared by the same two claims', () => {
    const g = graph(
      [
        claim('c1', 'Alpha', { referents: ['manager', 'standup'] }),
        claim('c2', 'Beta', { referents: ['manager', 'standup'] }),
      ],
      { referents: [referent('manager'), referent('standup')] },
    );
    expect(referentChannel(fakeRegistry()).candidates(g)).toHaveLength(1);
  });

  it('clips a god-node referent at the fanout cap and logs the clip', () => {
    // Quadratic on a god node: without the cap, 6 claims are 15 pairs.
    const claims = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id, i) =>
      claim(id, `body ${id}`, {
        referents: ['work'],
        updated: `2026-08-0${i + 1}T09:00:00.000Z`,
      }),
    );
    const g = graph(claims, { referents: [referent('work')] });
    const { log, events } = recorder();

    const pairs = referentChannel(fakeRegistry(), { fanoutCap: 3, log }).candidates(g);

    expect(pairs).toHaveLength(3); // 3 claims → 3 pairs, not 15
    // The window is the most recently UPDATED claims, so new material is never
    // starved by a referent that already has a long history.
    expect(keys(pairs.map((pair) => ({ pair })))).toEqual(['c4+c5', 'c4+c6', 'c5+c6']);

    const clip = events.filter((e) => e.kind === 'clash-referent-clipped');
    expect(clip).toHaveLength(1);
    expect(clip[0]!.detail).toContain('referent=work');
    expect(clip[0]!.detail).toContain('clipped=3');
  });

  it('does not log a clip when the referent is inside the cap', () => {
    const g = graph(
      [
        claim('c1', 'Alpha', { referents: ['work'] }),
        claim('c2', 'Beta', { referents: ['work'] }),
      ],
      { referents: [referent('work')] },
    );
    const { log, events } = recorder();
    referentChannel(fakeRegistry(), { log }).candidates(g);
    expect(events).toEqual([]);
  });

  it('ships a fanout cap by default', () => {
    expect(REFERENT_FANOUT_CAP).toBeGreaterThan(0);
    const claims = Array.from({ length: REFERENT_FANOUT_CAP + 4 }, (_, i) =>
      claim(`c${String(i).padStart(2, '0')}`, `body ${i}`, { referents: ['work'] }),
    );
    const g = graph(claims, { referents: [referent('work')] });
    const capped = (REFERENT_FANOUT_CAP * (REFERENT_FANOUT_CAP - 1)) / 2;
    expect(referentChannel(fakeRegistry()).candidates(g)).toHaveLength(capped);
  });
});

// ── The pool ──

const OPPOSED_A = 'I estimate tasks to coordinate with other people on the team';
const OPPOSED_B = 'Whenever I estimate tasks to coordinate nobody reads the number';

function opposedGraph(extra: Partial<ClaimGraph> = {}): ClaimGraph {
  return graph(
    [
      claim('c1', OPPOSED_A, { referents: ['work'] }),
      claim('c2', OPPOSED_B, { referents: ['work'] }),
    ],
    { referents: [referent('work')], ...extra },
  );
}

describe('poolCandidates', () => {
  it('tags each pooled pair with the channel that found it', () => {
    const g = opposedGraph();
    const { log } = recorder();
    const pool = poolCandidates(g, [lexicalChannel], fakeStore([]), log);
    expect(pool.pairs).toHaveLength(1);
    expect(pool.pairs[0]!.channel).toBe('lexical');
  });

  it('keeps the FIRST channel in array order when both find the same pair', () => {
    const g = opposedGraph();
    const { log } = recorder();
    const referents = referentChannel(fakeRegistry());

    const lexicalFirst = poolCandidates(g, [lexicalChannel, referents], fakeStore([]), log);
    expect(lexicalFirst.pairs).toHaveLength(1);
    expect(lexicalFirst.pairs[0]!.channel).toBe('lexical');

    const referentFirst = poolCandidates(g, [referents, lexicalChannel], fakeStore([]), log);
    expect(referentFirst.pairs).toHaveLength(1);
    expect(referentFirst.pairs[0]!.channel).toBe('referent');
  });

  it('counts every channel in perChannel, including the ones that found nothing', () => {
    const silent: ClashChannel = { name: 'embedding', candidates: () => [] };
    const { log } = recorder();
    const pool = poolCandidates(opposedGraph(), [lexicalChannel, silent], fakeStore([]), log);
    expect(pool.perChannel).toEqual({ lexical: 1, embedding: 0 });
  });

  it('counts per channel BEFORE the union, so a deduped pair is still credited twice', () => {
    const { log } = recorder();
    const pool = poolCandidates(
      opposedGraph(),
      [lexicalChannel, referentChannel(fakeRegistry())],
      fakeStore([]),
      log,
    );
    expect(pool.perChannel).toEqual({ lexical: 1, referent: 1 });
    expect(pool.pairs).toHaveLength(1);
  });

  it('emits clash-checked on a zero-candidate run', () => {
    const { log, events } = recorder();
    const pool = poolCandidates(graph([]), [lexicalChannel], fakeStore([]), log);
    expect(pool.pairs).toEqual([]);
    const checked = events.filter((e) => e.kind === 'clash-checked');
    expect(checked).toHaveLength(1);
    expect(checked[0]!.actor).toBe('clerk');
    expect(checked[0]!.detail).toContain('pool=0');
    expect(checked[0]!.detail).toContain('channels=lexical:0');
  });

  it('reports pool size, suppression and re-proposal on the clash-checked line', () => {
    const { log, events } = recorder();
    poolCandidates(opposedGraph(), [lexicalChannel], fakeStore([]), log);
    const detail = events.find((e) => e.kind === 'clash-checked')!.detail;
    expect(detail).toContain('pool=1');
    expect(detail).toContain('suppressed=0');
    expect(detail).toContain('reproposed=0');
  });

  it('is deterministic across two calls on the same graph and store', () => {
    const g = graph(
      [
        claim('c1', 'Alpha', { referents: ['work'] }),
        claim('c2', 'Beta', { referents: ['work'] }),
        claim('c3', 'Gamma', { referents: ['work'] }),
      ],
      { referents: [referent('work')] },
    );
    const { log } = recorder();
    const channels = [referentChannel(fakeRegistry())];
    const first = poolCandidates(g, channels, fakeStore([]), log);
    const second = poolCandidates(g, channels, fakeStore([]), log);
    expect(keys(second.pairs)).toEqual(keys(first.pairs));
    expect(keys(first.pairs)).toEqual(['c1+c2', 'c1+c3', 'c2+c3']);
  });

  it('returns the same pairs in the same order when the graph arrives shuffled', () => {
    // Determinism has to survive the store handing the claims back in a
    // different order — file listing order is not a promise. The sorts inside
    // the channels are what make that true, and this is what holds them there.
    // Two disjoint groups, so each channel produces TWO pairs and a traversal
    // that follows array order rather than id order comes back reversed. Each
    // channel is asserted alone: run together, one channel's order would mask
    // the other's through the union.
    const claims = [
      claim('c1', 'I estimate tasks to coordinate with other people', { referents: ['alpha'] }),
      claim('c2', 'Once I estimate tasks to coordinate the number lies', { referents: ['alpha'] }),
      claim('c3', 'A bicycle in the hallway blocks the door every morning', {
        referents: ['zeta'],
      }),
      claim('c4', 'Whenever a bicycle in the hallway appears nobody moves it', {
        referents: ['zeta'],
      }),
    ];
    const refs = [referent('alpha'), referent('zeta')];
    const { log } = recorder();
    const forward = graph(claims, { referents: refs });
    const shuffled = graph([...claims].reverse(), { referents: [...refs].reverse() });

    for (const channel of [lexicalChannel, referentChannel(fakeRegistry())]) {
      const a = poolCandidates(forward, [channel], fakeStore([]), log);
      const b = poolCandidates(shuffled, [channel], fakeStore([]), log);
      expect(keys(a.pairs), channel.name).toEqual(['c1+c2', 'c3+c4']);
      expect(keys(b.pairs), channel.name).toEqual(keys(a.pairs));
    }
  });

  it('never returns a pair containing an archived claim', () => {
    const g = graph(
      [
        claim('c1', 'Alpha', { referents: ['work'] }),
        claim('c2', 'Beta', { referents: ['work'], archived: true, archiveReason: 'stale' }),
      ],
      { referents: [referent('work')] },
    );
    const { log } = recorder();
    expect(poolCandidates(g, [referentChannel(fakeRegistry())], fakeStore([]), log).pairs).toEqual(
      [],
    );
  });

  it('never returns a pair that is the two members of an OPEN contradiction', () => {
    const { log } = recorder();
    const pool = poolCandidates(
      opposedGraph({ contradictions: [contradiction(['c1', 'c2'], 'open')] }),
      [lexicalChannel],
      fakeStore([]),
      log,
    );
    expect(pool.pairs).toEqual([]);
    expect(pool.suppressed).toBe(1);
  });

  it('still proposes a pair whose contradiction was dissolved', () => {
    const { log } = recorder();
    const pool = poolCandidates(
      opposedGraph({ contradictions: [contradiction(['c1', 'c2'], 'dissolved')] }),
      [lexicalChannel],
      fakeStore([]),
      log,
    );
    expect(pool.pairs).toHaveLength(1);
  });
});

// ── The anti-repetition filter (B9) and its one exception (Q-53) ──

describe('anti-repetition: a pair with a record is not re-proposed', () => {
  const STATUSES: ClashCandidate['status'][] = ['pending-remeasure', 'confirmed', 'dissolved'];

  for (const status of STATUSES) {
    it(`refuses a pair whose record reads ${status}`, () => {
      const { log } = recorder();
      const record = candidate(['c1', 'c2'], {
        status,
        ...(status === 'dissolved' ? { outcome: 'not-opposed' as ClashOutcome } : {}),
      });
      const pool = poolCandidates(opposedGraph(), [lexicalChannel], fakeStore([record]), log);
      expect(pool.pairs).toEqual([]);
      expect(pool.suppressed).toBe(1);
    });
  }

  it('keys the filter on the pair, not on the order the record stored it', () => {
    const { log } = recorder();
    const record = candidate(['c2', 'c1'], { status: 'pending-remeasure' });
    expect(
      poolCandidates(opposedGraph(), [lexicalChannel], fakeStore([record]), log).pairs,
    ).toEqual([]);
  });

  it('refuses a dissolved pair with no outcome — an unrecorded reason is not the exception', () => {
    const { log } = recorder();
    const record = candidate(['c1', 'c2'], { status: 'dissolved' });
    expect(
      poolCandidates(opposedGraph(), [lexicalChannel], fakeStore([record]), log).pairs,
    ).toEqual([]);
  });
});

describe('Q-53: expiry is the one outcome that does not retire the pair', () => {
  function pooled(outcome: ClashOutcome, attempts: number) {
    const { log, events } = recorder();
    const record = candidate(['c1', 'c2'], { status: 'dissolved', outcome, attempts });
    const pool = poolCandidates(opposedGraph(), [lexicalChannel], fakeStore([record]), log);
    return { pool, events };
  }

  it('re-proposes a pair dissolved as remeasure-expired on its first attempt', () => {
    const { pool, events } = pooled('remeasure-expired', 1);
    expect(pool.pairs).toHaveLength(1);
    // The value the new record must be BORN with. Without it the caller writes
    // attempts: 1 forever and the cap below never bites.
    expect(pool.pairs[0]!.attempts).toBe(2);
    expect(pool.reproposed).toBe(1);
    expect(events.find((e) => e.kind === 'clash-checked')!.detail).toContain('reproposed=1');
  });

  it('refuses the same pair once it has had two attempts', () => {
    const { pool } = pooled('remeasure-expired', 2);
    expect(pool.pairs).toEqual([]);
    expect(pool.suppressed).toBe(1);
    expect(pool.reproposed).toBe(0);
  });

  const ANSWERED: ClashOutcome[] = [
    'not-opposed',
    'unverified-confirmation',
    'dissolved-on-answer',
    'range-discriminated',
  ];

  for (const outcome of ANSWERED) {
    it(`never re-proposes a pair dissolved as ${outcome}, at either attempt count`, () => {
      expect(pooled(outcome, 1).pool.pairs).toEqual([]);
      expect(pooled(outcome, 2).pool.pairs).toEqual([]);
    });
  }

  it('refuses a pair with a later record, even if an earlier one expired', () => {
    // Two records for one pair: the first expired, the second was answered. The
    // answer retires the pair whatever the first record says.
    const { log } = recorder();
    const store = fakeStore([
      candidate(['c1', 'c2'], {
        id: 'cand-1',
        status: 'dissolved',
        outcome: 'remeasure-expired',
        attempts: 1,
      }),
      candidate(['c1', 'c2'], {
        id: 'cand-2',
        status: 'dissolved',
        outcome: 'not-opposed',
        attempts: 2,
      }),
    ]);
    expect(poolCandidates(opposedGraph(), [lexicalChannel], store, log).pairs).toEqual([]);
  });

  it('a fresh pair is born with one attempt', () => {
    const { log } = recorder();
    const pool = poolCandidates(opposedGraph(), [lexicalChannel], fakeStore([]), log);
    expect(pool.pairs[0]!.attempts).toBe(1);
  });
});

// ── Recall over the shared paraphrase fixture ──

/**
 * The eight belief/restatement pairs, as claims: each pair becomes two claims
 * that assert the same belief in disjoint words. A channel "recalls" a pair
 * when it pools those two claims together.
 *
 * The referent variant gives both claims of a pair the SAME registry entity,
 * which is what the referent channel is for — this is the fixture's one
 * legitimate registry reading, and it is stated here rather than hidden in a
 * helper because it is the difference between the two numbers below.
 */
function fixtureGraph(withReferents: boolean): ClaimGraph {
  const claims: Claim[] = [];
  for (const [i, p] of PAIRS.entries()) {
    const slug = `belief-${i}`;
    const refs = withReferents ? [slug] : [];
    claims.push(claim(`stored-${i}`, p.stored, { referents: refs }));
    claims.push(claim(`restated-${i}`, p.restated, { referents: refs }));
  }
  return graph(claims, {
    referents: withReferents ? PAIRS.map((_, i) => referent(`belief-${i}`)) : [],
  });
}

function recall(pool: { pairs: { pair: [Claim, Claim] }[] }): number {
  const found = new Set(keys(pool.pairs));
  return PAIRS.filter((_, i) => found.has(`restated-${i}+stored-${i}`)).length;
}

describe('paraphrase fixture: lexical 0/8, referent 8/8 with a registry and 0/8 without', () => {
  it('lexical recalls 0/8 — the trigram index cannot see a restatement', () => {
    const { log } = recorder();
    const pool = poolCandidates(fixtureGraph(false), [lexicalChannel], fakeStore([]), log);
    // The same number tests/resonance-paraphrase.test.ts records over snippets,
    // measured here over claim bodies through the pool. It is the honest
    // baseline and the reason the other channels exist. Do not tune the fixture
    // to move it — the embedding channel (T18) is what should move it.
    expect(recall(pool)).toBe(0);
  });

  it('referent recalls 0/8 on the fixture as written — it carries no registry entities', () => {
    const { log } = recorder();
    const pool = poolCandidates(
      fixtureGraph(false),
      [referentChannel(fakeRegistry())],
      fakeStore([]),
      log,
    );
    // This number measures the FIXTURE, not the channel: the eight pairs were
    // built to defeat lexical matching and name nobody. A retrieval channel
    // that reads identity finds nothing where no identity was recorded.
    expect(recall(pool)).toBe(0);
  });

  it('referent recalls 8/8 once the same two claims name one entity', () => {
    const { log } = recorder();
    const pool = poolCandidates(
      fixtureGraph(true),
      [referentChannel(fakeRegistry())],
      fakeStore([]),
      log,
    );
    // Not a claim about paraphrase recall. It says only that disjoint
    // vocabulary is no obstacle to this channel — which is exactly the case the
    // lexical channel misses all eight times above.
    expect(recall(pool)).toBe(8);
  });
});

// ── Structural assertions about this module ──

describe('the module itself', () => {
  const source = readFileSync(new URL('../src/wiki/clash.ts', import.meta.url), 'utf-8');

  it('makes no model call and imports nothing that could', () => {
    // Q-30 stage 1 retrieves; it never judges. The judgment is judgeOpposition,
    // one layer down, and it is the only thing in the pipeline that sees a
    // model. Asserted structurally because a signature is easier to check than
    // a call graph.
    expect(source).not.toMatch(/\bComplete\b/);
    expect(source).not.toMatch(/from '\.\.\/llm\.js'/);
    expect(source).not.toMatch(/\bcomplete\s*\(/);
  });

  it('names no channel it does not own', () => {
    // The extension point is described, not stubbed: a stub for the embedding
    // channel would be worse than its absence, and T18 needs neither.
    expect(source.toLowerCase()).not.toContain('embed');
  });
});
