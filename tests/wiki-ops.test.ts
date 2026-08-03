// The write boundary's tests (Q-29).
//
// The oracle throughout is the DISK, not the return value: an op is applied
// when the frontmatter says so. `OpResult` is what the caller counts; the
// claim file is what the wiki is. Where the two could disagree, these tests
// read the file.
//
// No model anywhere. The store is real (a tmp dir), the registry is a fake
// that records every method it is asked for, and the graph is a literal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { applyOps } from '../src/wiki/ops.js';
import { createClaimStore } from '../src/wiki/store.js';
import type {
  Claim,
  ClaimGraph,
  ClaimStore,
  Contradiction,
  LogFn,
  Referent,
  ReferentRef,
  Registry,
  SweepLine,
} from '../src/wiki/contract.js';
import type { Reading, Snippet } from '../src/types.js';

const MODEL = 'qwen3.6:35b';
const AT = '2026-08-02T10:00:00.000Z';

const READING_A = '01KREADAAAAAAAAAAAAAAAAAAA';
const READING_B = '01KREADBBBBBBBBBBBBBBBBBBB';
const READING_C = '01KREADCCCCCCCCCCCCCCCCCCC';

const SNIP_A = '01KSNIPAAAAAAAAAAAAAAAAAAA';
const SNIP_B = '01KSNIPBBBBBBBBBBBBBBBBBBB';
const SNIP_C = '01KSNIPCCCCCCCCCCCCCCCCCCC';

let root: string;
let store: ClaimStore;
let events: Parameters<LogFn>[0][];
let log: LogFn;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-wiki-ops-'));
  store = createClaimStore(root);
  events = [];
  log = (e) => {
    events.push(e);
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── Fixtures ──

function snippet(id: string, session: string, version = 1): Snippet {
  return {
    id,
    version,
    captured: '2026-07-01T09:00:00.000Z',
    provenance: { kind: 'harvest', session, question: 'what did you mean?', questionForm: 'why' },
    prose: 'Some words the user actually wrote.',
  };
}

function reading(id: string, overrides: Partial<Reading> = {}): Reading {
  return {
    id,
    facet: 'value',
    stance: 'avowal',
    cites: [`${SNIP_A}@1`],
    reading: 'He treats a deadline as a promise.',
    at: AT,
    ...overrides,
  };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: '01KCLAIMAAAAAAAAAAAAAAAAAA',
    body: 'He treats a deadline as a promise made to another person.',
    range: 'when he is talking about work he was hired for',
    status: 'unconfirmed',
    cites: [`${SNIP_A}@1`],
    facet: 'value',
    referents: ['my-manager'],
    fromReadings: [READING_A],
    attested: false,
    readLog: [],
    model: MODEL,
    modelAt: AT,
    created: AT,
    updated: AT,
    ...overrides,
  };
}

/** The graph the executor reads: snippets and readings from the vault, claims from the store. */
function graphOf(over: Partial<ClaimGraph> = {}): ClaimGraph {
  return {
    claims: store.loadSlice().claims,
    snippets: {
      [SNIP_A]: snippet(SNIP_A, 'sitting-1'),
      [SNIP_B]: snippet(SNIP_B, 'sitting-2'),
      [SNIP_C]: snippet(SNIP_C, 'sitting-3', 2),
    },
    readings: {
      [READING_A]: reading(READING_A),
      [READING_B]: reading(READING_B, { facet: 'construct' }),
      [READING_C]: reading(READING_C, { facet: 'intention' }),
    },
    contradictions: store.loadSlice().contradictions,
    referents: store.loadSlice().referents,
    ...over,
  };
}

/**
 * A registry that records every method it is asked for.
 *
 * `calls` is the instrument for Q-32: whatever `applyOps` does with identity,
 * it can only do it through these four names, and there is no fifth.
 */
function fakeRegistry(): Registry & { calls: string[]; referents: Map<string, Referent> } {
  const referents = new Map<string, Referent>();
  const calls: string[] = [];
  return {
    calls,
    referents,
    resolve(ref: ReferentRef): Referent {
      calls.push(`resolve:${ref.name}`);
      const slug = ref.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = referents.get(slug);
      if (existing) {
        if (ref.aliasOf && !existing.aliases.includes(ref.aliasOf)) existing.aliases.push(ref.aliasOf);
        return existing;
      }
      const made: Referent = {
        slug,
        canonical: ref.name,
        kind: ref.kind,
        aliases: ref.aliasOf ? [ref.aliasOf] : [],
        model: MODEL,
        modelAt: AT,
        created: AT,
        updated: AT,
      };
      referents.set(slug, made);
      return made;
    },
    lookup(name: string): Referent | null {
      calls.push(`lookup:${name}`);
      return referents.get(name) ?? null;
    },
    claimsFor(): Claim[] {
      calls.push('claimsFor');
      return [];
    },
    mergeCandidates(): [Referent, Referent][] {
      calls.push('mergeCandidates');
      return [];
    },
  };
}

let registry: ReturnType<typeof fakeRegistry>;
beforeEach(() => {
  registry = fakeRegistry();
});

function run(ops: unknown[], readingIds: string[], over: Partial<ClaimGraph> = {}) {
  return applyOps(ops, { readingIds }, { store, registry, graph: graphOf(over), model: MODEL, log });
}

/** The frontmatter the store actually wrote. The oracle is the file. */
function frontmatter(id: string): Record<string, unknown> {
  const path = join(root, 'wiki', 'claims', `${id}.md`);
  return matter.read(path).data as Record<string, unknown>;
}

function sweepLines(): SweepLine[] {
  const path = join(root, 'wiki', 'sweep-log.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as SweepLine);
}

function onlyClaim(): Claim {
  const claims = store.loadSlice().claims;
  expect(claims).toHaveLength(1);
  return claims[0]!;
}

const MINT_A = {
  op: 'MINT',
  reading: READING_A,
  body: 'He treats a deadline as a promise made to another person.',
  range: 'when he is talking about work he was hired for',
  cites: [`${SNIP_A}@1`],
  facet: 'value',
};

// ── Rule 1–11: every rejection is named, and the store stays untouched ──

describe('applyOps — validation rejects with a named reason and writes nothing', () => {
  it('rejects an op whose `op` field is not one of the six', () => {
    const result = run([{ ...MINT_A, op: 'DELETE' }], [READING_A]);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('unknown-op');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects an op naming a reading outside the sweep', () => {
    const result = run([{ ...MINT_A, reading: READING_B }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('unknown-reading');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects the SECOND op naming a reading, and keeps the first', () => {
    const second = { ...MINT_A, body: 'A second claim from the same reading.' };
    const result = run([MINT_A, second], [READING_A]);
    expect(result.applied).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('reading-already-covered');
    expect(store.loadSlice().claims).toHaveLength(1);
  });

  it('rejects any op carrying a `status` key, even when the value would have been right', () => {
    const result = run([{ ...MINT_A, status: 'unconfirmed' }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('status-not-model-writable');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects any op carrying an `attested` key', () => {
    const result = run([{ ...MINT_A, attested: false }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('attested-not-model-writable');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects a MINT whose range is whitespace (Q-21)', () => {
    const result = run([{ ...MINT_A, range: '   ' }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('range-missing');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects a MINT with no cites', () => {
    const result = run([{ ...MINT_A, cites: [] }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('cites-empty');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects a MINT citing a snippet version that does not exist — the fabrication case', () => {
    const result = run([{ ...MINT_A, cites: [`${SNIP_A}@7`] }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('cite-does-not-resolve');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('accepts a cite to an EARLIER version than the latest — stale, not fabricated', () => {
    // SNIP_C is at version 2; `@1` still exists on disk and is real evidence.
    const result = run([{ ...MINT_A, cites: [`${SNIP_C}@1`] }], [READING_A]);
    expect(result.rejected).toHaveLength(0);
    expect(onlyClaim().cites).toEqual([`${SNIP_C}@1`]);
  });

  it('rejects a SUPERSEDE with an empty reason', () => {
    store.writeClaim(claim());
    const result = run(
      [
        {
          op: 'SUPERSEDE',
          reading: READING_A,
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          body: 'He treats a deadline as a promise only to people he chose.',
          range: 'at work',
          cites: [`${SNIP_B}@1`],
          reason: '  ',
        },
      ],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('reason-missing');
    expect(store.loadSlice().claims).toHaveLength(1);
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').supersededBy).toBeUndefined();
  });

  it('rejects an ARCHIVE with an empty reason', () => {
    store.writeClaim(claim());
    const result = run(
      [{ op: 'ARCHIVE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', reason: '' }],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('reason-missing');
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').archived).toBeUndefined();
  });

  it('rejects a MERGE naming an archived claim', () => {
    store.writeClaim(claim());
    store.writeClaim(
      claim({
        id: '01KCLAIMBBBBBBBBBBBBBBBBBB',
        archived: true,
        archiveReason: 'refuted with prejudice',
      }),
    );
    const result = run(
      [
        {
          op: 'MERGE',
          reading: READING_A,
          into: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          from: ['01KCLAIMBBBBBBBBBBBBBBBBBB'],
          body: 'One sentence covering both.',
          range: 'at work',
        },
      ],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('claim-archived');
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').updated).toBe(AT);
  });

  it('rejects a MERGE that names `into` among its `from`', () => {
    store.writeClaim(claim());
    const result = run(
      [
        {
          op: 'MERGE',
          reading: READING_A,
          into: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          from: ['01KCLAIMAAAAAAAAAAAAAAAAAA'],
          body: 'One sentence covering both.',
          range: 'at work',
        },
      ],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('merge-into-in-from');
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').archived).toBeUndefined();
  });

  it('rejects a body that is two sentences', () => {
    const result = run([{ ...MINT_A, body: 'He keeps promises. He always has.' }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('body-not-one-sentence');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects a body of 300 characters or more', () => {
    const result = run([{ ...MINT_A, body: `${'a'.repeat(320)}.` }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('body-too-long');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('rejects an empty body', () => {
    const result = run([{ ...MINT_A, body: '   ' }], [READING_A]);
    expect(result.rejected[0]?.reason).toContain('body-missing');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('carries the reading on every rejection so the caller can count the attempt', () => {
    const result = run([{ ...MINT_A, range: '' }], [READING_A]);
    expect(result.rejected[0]?.reading).toBe(READING_A);
  });

  it('writes NO sweep line for a rejected op — the caller appends the attempt', () => {
    run([{ ...MINT_A, range: '' }], [READING_A]);
    expect(sweepLines()).toHaveLength(0);
  });

  it('logs every rejection with its reason (Q-23, Q-29)', () => {
    run([{ ...MINT_A, status: 'evidenced' }], [READING_A]);
    const rejection = events.find((e) => e.kind === 'claim-op-rejected');
    expect(rejection).toBeDefined();
    expect(rejection?.actor).toBe('clerk');
    expect(rejection?.detail).toContain('status-not-model-writable');
  });
  it('rejects an UPDATE carrying a body for an attested claim — the person\'s words are not model-writable', () => {
    store.writeClaim(claim({ attested: true }));
    const result = run(
      [{ op: 'UPDATE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', body: 'A rewritten sentence.' }],
      [READING_A],
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('attested-body-not-model-writable');
    expect(matter.read(join(root, 'wiki', 'claims', '01KCLAIMAAAAAAAAAAAAAAAAAA.md')).content.trimEnd()).toBe('He treats a deadline as a promise made to another person.');
  });

  it('rejects an UPDATE carrying a range for an attested claim', () => {
    store.writeClaim(claim({ attested: true }));
    const result = run(
      [{ op: 'UPDATE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', range: 'a narrower range' }],
      [READING_A],
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('attested-range-not-model-writable');
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').range).toBe('when he is talking about work he was hired for');
  });

  it('still lets an UPDATE add evidence to an attested claim — the Clerk adds, never rewrites', () => {
    store.writeClaim(claim({ attested: true }));
    const result = run(
      [{ op: 'UPDATE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', addCites: [`${SNIP_B}@1`] }],
      [READING_A],
    );
    expect(result.applied).toHaveLength(1);
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').cites).toEqual([`${SNIP_A}@1`, `${SNIP_B}@1`]);
  });

  it('rejects a MERGE into an attested claim — MERGE rewrites the into claim\'s words', () => {
    store.writeClaim(claim({ attested: true }));
    store.writeClaim(claim({ id: '01KCLAIMBBBBBBBBBBBBBBBBBB' }));
    const result = run(
      [
        {
          op: 'MERGE',
          reading: READING_A,
          into: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          from: ['01KCLAIMBBBBBBBBBBBBBBBBBB'],
          body: 'The merged sentence.',
          range: 'a merged range',
        },
      ],
      [READING_A],
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('attested-into-not-model-writable');
    expect(matter.read(join(root, 'wiki', 'claims', '01KCLAIMAAAAAAAAAAAAAAAAAA.md')).content.trimEnd()).toBe('He treats a deadline as a promise made to another person.');
  });

});

// ── Isolation and totality ──

describe('applyOps — isolation and totality (Q-29)', () => {
  it('applies the good ops in a set that contains a rejected one', () => {
    const bad = { ...MINT_A, reading: READING_B, range: '' };
    const good = { op: 'KEEP', reading: READING_C, note: 'already covered' };
    const result = run([MINT_A, bad, good], [READING_A, READING_B, READING_C]);
    expect(result.applied.map((o) => o.op)).toEqual(['MINT', 'KEEP']);
    expect(result.rejected).toHaveLength(1);
    expect(store.loadSlice().claims).toHaveLength(1);
  });

  it('reports exactly one unprocessed reading when 3 are swept and 2 are covered', () => {
    const keep = { op: 'KEEP', reading: READING_B };
    const result = run([MINT_A, keep], [READING_A, READING_B, READING_C]);
    expect(result.unprocessed).toEqual([READING_C]);
  });

  it('leaves a REJECTED reading unprocessed — it is not covered', () => {
    const result = run([{ ...MINT_A, range: '' }], [READING_A]);
    expect(result.unprocessed).toEqual([READING_A]);
  });

  it('KEEP writes no claim and appends one sweep line carrying its note', () => {
    const result = run([{ op: 'KEEP', reading: READING_A, note: 'the wiki already says this' }], [READING_A]);
    expect(result.applied).toHaveLength(1);
    expect(store.loadSlice().claims).toHaveLength(0);
    expect(sweepLines()).toEqual([
      expect.objectContaining({ readingId: READING_A, op: 'KEEP', reason: 'the wiki already says this', model: MODEL }),
    ]);
  });

  it('is deterministic: the same ops over the same store give the same verdicts', () => {
    const ops: unknown[] = [MINT_A, { ...MINT_A, reading: READING_B, cites: [] }, { op: 'KEEP', reading: READING_C }];
    const first = run(ops, [READING_A, READING_B, READING_C]);

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), 'elicit-wiki-ops-'));
    store = createClaimStore(root);
    const second = run(ops, [READING_A, READING_B, READING_C]);

    expect(second.applied.map((o) => o.op)).toEqual(first.applied.map((o) => o.op));
    expect(second.rejected.map((r) => r.reason)).toEqual(first.rejected.map((r) => r.reason));
    expect(second.unprocessed).toEqual(first.unprocessed);
  });
});

// ── MINT ──

describe('applyOps — MINT', () => {
  it('writes a claim born unconfirmed with the model stamp and the READING\'s facet (Q-28, Q-34)', () => {
    // The op says `value`; the reading says `construct`. The reading wins —
    // inventing a facet is a reading, and an op is not where readings are made.
    const result = run([{ ...MINT_A, reading: READING_B, facet: 'value' }], [READING_B]);
    expect(result.applied).toHaveLength(1);

    const written = onlyClaim();
    const fm = frontmatter(written.id);
    expect(fm.status).toBe('unconfirmed');
    expect(fm.facet).toBe('construct');
    expect(fm.model).toBe(MODEL);
    expect(typeof fm.modelAt).toBe('string');
    expect(fm.attested).toBe(false);
    expect(fm.fromReadings).toEqual([READING_B]);
    expect(fm.cites).toEqual([`${SNIP_A}@1`]);
  });

  it('rejects a MINT whose reading is not in the graph — there is no facet to take', () => {
    const result = run([MINT_A], [READING_A], { readings: {} });
    expect(result.rejected[0]?.reason).toContain('reading-not-in-graph');
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('resolves referents through the registry and stores the slugs', () => {
    const result = run(
      [{ ...MINT_A, referents: [{ name: 'My Manager', kind: 'person' }] }],
      [READING_A],
    );
    expect(result.applied).toHaveLength(1);
    expect(registry.calls).toEqual(['resolve:My Manager']);
    expect(onlyClaim().referents).toEqual(['my-manager']);
  });

  it('appends one sweep line naming the claim it wrote', () => {
    run([MINT_A], [READING_A]);
    const lines = sweepLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.op).toBe('MINT');
    expect(lines[0]?.claimId).toBe(onlyClaim().id);
  });
});

// ── UPDATE ──

describe('applyOps — UPDATE', () => {
  beforeEach(() => {
    store.writeClaim(claim());
  });

  it('rewrites body and range, unions addCites, appends the reading, keeps the facet', () => {
    const result = run(
      [
        {
          op: 'UPDATE',
          reading: READING_B,
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          body: 'He treats a deadline as a promise, and says so.',
          range: 'when the work is paid',
          addCites: [`${SNIP_A}@1`, `${SNIP_B}@1`],
        },
      ],
      [READING_B],
    );
    expect(result.applied).toHaveLength(1);

    const fm = frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA');
    expect(fm.range).toBe('when the work is paid');
    expect(fm.cites).toEqual([`${SNIP_A}@1`, `${SNIP_B}@1`]);
    expect(fm.fromReadings).toEqual([READING_A, READING_B]);
    // The reading says `construct`; UPDATE never changes the facet.
    expect(fm.facet).toBe('value');
    expect(fm.updated).not.toBe(AT);
  });

  it('rejects an UPDATE whose addCites name a version that has never existed', () => {
    const result = run(
      [{ op: 'UPDATE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', addCites: [`${SNIP_B}@9`] }],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('cite-does-not-resolve');
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').cites).toEqual([`${SNIP_A}@1`]);
  });

  it('rejects an UPDATE of a claim that is not there', () => {
    const result = run(
      [{ op: 'UPDATE', reading: READING_A, claim: '01KNOSUCHCLAIMAAAAAAAAAAAA', body: 'Anything at all.' }],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('claim-not-found');
  });

  it('ADDS referents and never removes one (Q-32: add structure, never collapse)', () => {
    const result = run(
      [
        {
          op: 'UPDATE',
          reading: READING_A,
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          referents: [{ name: 'The Studio', kind: 'project' }],
        },
      ],
      [READING_A],
    );
    expect(result.applied).toHaveLength(1);
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').referents).toEqual(['my-manager', 'the-studio']);
  });
});

// ── SUPERSEDE ──

describe('applyOps — SUPERSEDE', () => {
  it('inherits facet and referents from the superseded claim, and leaves it on disk with a reason (S6)', () => {
    store.writeClaim(claim({ facet: 'causal-theory', referents: ['my-manager', 'the-studio'] }));

    const result = run(
      [
        {
          op: 'SUPERSEDE',
          reading: READING_C, // whose reading facet is `intention` — deliberately different
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          body: 'He treats a deadline as a promise only when he chose the work.',
          range: 'when he chose the work',
          cites: [`${SNIP_B}@1`],
          reason: 'the range was too wide',
        },
      ],
      [READING_C],
    );
    expect(result.applied).toHaveLength(1);

    const fresh = store.loadSlice().claims.find((c) => c.id !== '01KCLAIMAAAAAAAAAAAAAAAAAA');
    expect(fresh).toBeDefined();
    // The oracle is the frontmatter, not the op: the op carries no facet at all.
    const freshFm = frontmatter(fresh!.id);
    expect(freshFm.facet).toBe('causal-theory');
    expect(freshFm.referents).toEqual(['my-manager', 'the-studio']);
    expect(freshFm.fromReadings).toEqual([READING_C]);

    // The old file stays — evidence, never deletion.
    const oldFm = frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA');
    expect(oldFm.supersededBy).toBe(fresh!.id);
    expect(oldFm.supersedeReason).toBe('the range was too wide');
    expect(existsSync(join(root, 'wiki', 'claims', '01KCLAIMAAAAAAAAAAAAAAAAAA.md'))).toBe(true);
  });

  it('rejects a SUPERSEDE of an already superseded claim', () => {
    store.writeClaim(
      claim({ supersededBy: '01KCLAIMZZZZZZZZZZZZZZZZZZ', supersedeReason: 'already replaced' }),
    );
    const result = run(
      [
        {
          op: 'SUPERSEDE',
          reading: READING_A,
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          body: 'A newer sentence entirely.',
          range: 'at work',
          cites: [`${SNIP_B}@1`],
          reason: 'newer reading',
        },
      ],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('claim-superseded');
    expect(store.loadSlice().claims).toHaveLength(1);
  });
});

// ── MERGE ──

describe('applyOps — MERGE', () => {
  it('inherits facet and referents from `into`, unions cites and readings, archives the sources (S6)', () => {
    store.writeClaim(claim({ facet: 'value', referents: ['my-manager'], cites: [`${SNIP_A}@1`] }));
    store.writeClaim(
      claim({
        id: '01KCLAIMBBBBBBBBBBBBBBBBBB',
        facet: 'construct',
        referents: ['the-studio'],
        cites: [`${SNIP_B}@1`],
        fromReadings: [READING_B],
        body: 'He treats a deadline as a debt.',
      }),
    );

    const result = run(
      [
        {
          op: 'MERGE',
          reading: READING_C,
          into: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          from: ['01KCLAIMBBBBBBBBBBBBBBBBBB'],
          body: 'He treats a deadline as a promise he owes another person.',
          range: 'when he is talking about paid work',
        },
      ],
      [READING_C],
    );
    expect(result.applied).toHaveLength(1);

    const survivor = frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA');
    expect(survivor.facet).toBe('value');
    // Claims merge; referents do NOT (Q-32). `the-studio` does not travel here.
    expect(survivor.referents).toEqual(['my-manager']);
    expect(survivor.cites).toEqual([`${SNIP_A}@1`, `${SNIP_B}@1`]);
    expect(survivor.fromReadings).toEqual([READING_A, READING_B, READING_C]);
    expect(survivor.range).toBe('when he is talking about paid work');

    const source = frontmatter('01KCLAIMBBBBBBBBBBBBBBBBBB');
    expect(source.archived).toBe(true);
    expect(source.archiveReason).toBe('merged-into:01KCLAIMAAAAAAAAAAAAAAAAAA');
    // Neither file is deleted.
    expect(existsSync(join(root, 'wiki', 'claims', '01KCLAIMBBBBBBBBBBBBBBBBBB.md'))).toBe(true);
  });

  it('rejects a MERGE with no sources', () => {
    store.writeClaim(claim());
    const result = run(
      [
        {
          op: 'MERGE',
          reading: READING_A,
          into: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          from: [],
          body: 'One sentence.',
          range: 'at work',
        },
      ],
      [READING_A],
    );
    expect(result.rejected[0]?.reason).toContain('merge-from-empty');
  });
});

// ── ARCHIVE ──

describe('applyOps — ARCHIVE', () => {
  it('sets archived and the reason, and the file stays', () => {
    store.writeClaim(claim());
    const result = run(
      [{ op: 'ARCHIVE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', reason: 'the person changed' }],
      [READING_A],
    );
    expect(result.applied).toHaveLength(1);
    const fm = frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA');
    expect(fm.archived).toBe(true);
    expect(fm.archiveReason).toBe('the person changed');
    expect(existsSync(join(root, 'wiki', 'claims', '01KCLAIMAAAAAAAAAAAAAAAAAA.md'))).toBe(true);
  });
});

// ── Status: mechanical, never model-written (Q-29) ──

describe('applyOps — status recompute', () => {
  it('promotes to evidenced on two cites from distinct sittings, and emits `claim-status-changed`', () => {
    store.writeClaim(claim());
    const result = run(
      [
        {
          op: 'UPDATE',
          reading: READING_B,
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          addCites: [`${SNIP_B}@1`],
        },
      ],
      [READING_B],
    );
    expect(result.applied).toHaveLength(1);
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').status).toBe('evidenced');

    const transitions = events.filter((e) => e.kind === 'claim-status-changed');
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.actor).toBe('clerk');
    expect(transitions[0]?.refs).toEqual(['01KCLAIMAAAAAAAAAAAAAAAAAA']);
    // T4's `why` rides along: transitions are auditable events (Q-21).
    expect(transitions[0]?.detail).toContain('evidenced');
  });

  it('emits NO event when the status does not move', () => {
    store.writeClaim(claim());
    run(
      [{ op: 'UPDATE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', body: 'A rewritten sentence.' }],
      [READING_A],
    );
    expect(events.filter((e) => e.kind === 'claim-status-changed')).toHaveLength(0);
  });

  it('recomputes a claim in an open Contradiction with a touched member', () => {
    const a = claim({ id: '01KCLAIMAAAAAAAAAAAAAAAAAA' });
    const b = claim({ id: '01KCLAIMBBBBBBBBBBBBBBBBBB', body: 'He treats a deadline as a suggestion.' });
    store.writeClaim(a);
    store.writeClaim(b);
    const contradiction: Contradiction = {
      id: '01KCONTRAAAAAAAAAAAAAAAAAA',
      type: 'synchronic',
      claims: ['01KCLAIMAAAAAAAAAAAAAAAAAA', '01KCLAIMBBBBBBBBBBBBBBBBBB'],
      candidate: '01KCANDAAAAAAAAAAAAAAAAAAA',
      remeasureQueueId: '01KQUEUEAAAAAAAAAAAAAAAAAA',
      evidence: { snippetRef: `${SNIP_B}@1`, quote: 'I would rather be late', side: 'b' },
      status: 'open',
      model: MODEL,
      modelAt: AT,
      opened: AT,
      updated: AT,
      body: 'two poles',
    };
    store.writeContradiction(contradiction);

    run(
      [{ op: 'UPDATE', reading: READING_A, claim: '01KCLAIMAAAAAAAAAAAAAAAAAA', body: 'A rewritten sentence.' }],
      [READING_A],
    );

    // The untouched member is recomputed too — it is in the same open Contradiction.
    expect(frontmatter('01KCLAIMBBBBBBBBBBBBBBBBBB').status).toBe('contested');
    const ids = events.filter((e) => e.kind === 'claim-status-changed').map((e) => e.refs?.[0]);
    expect(ids).toContain('01KCLAIMBBBBBBBBBBBBBBBBBB');
  });

  it('never writes a status a model asked for: the rejected op leaves the claim as arithmetic found it', () => {
    store.writeClaim(claim());
    run(
      [
        {
          op: 'UPDATE',
          reading: READING_A,
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          status: 'user-attested',
        },
      ],
      [READING_A],
    );
    expect(frontmatter('01KCLAIMAAAAAAAAAAAAAAAAAA').status).toBe('unconfirmed');
  });
});

// ── Q-32: no code path merges two referents ──

describe('applyOps — identity (Q-32)', () => {
  it('touches the registry through `resolve` alone across a mixed batch', () => {
    store.writeClaim(claim());
    run(
      [
        { ...MINT_A, reading: READING_B, referents: [{ name: 'My Manager', kind: 'person' }] },
        {
          op: 'UPDATE',
          reading: READING_A,
          claim: '01KCLAIMAAAAAAAAAAAAAAAAAA',
          referents: [{ name: 'The Studio', kind: 'project' }],
        },
        { op: 'KEEP', reading: READING_C },
      ],
      [READING_A, READING_B, READING_C],
    );
    expect(registry.calls.every((c) => c.startsWith('resolve:'))).toBe(true);
    // Two names in, two referents out. Nothing collapsed.
    expect([...registry.referents.keys()].sort()).toEqual(['my-manager', 'the-studio']);
  });

  it('has no source-level path that writes or collapses a referent', () => {
    const source = readFileSync(join(process.cwd(), 'src/wiki/ops.ts'), 'utf-8');
    expect(source).not.toMatch(/writeReferent/);
    expect(source).not.toMatch(/mergeReferent/);
    expect(source).not.toMatch(/mergeCandidates/);
  });
});
