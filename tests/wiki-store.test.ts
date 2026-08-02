import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import {
  appendSweepDeferral,
  createClaimStore,
  readSweepDeferral,
  readStillTrueCursor,
  writeStillTrueCursor,
} from '../src/wiki/store.js';
import type {
  Claim,
  ClashCandidate,
  Contradiction,
  Referent,
  SweepLine,
} from '../src/wiki/contract.js';

// A tmp root per test. Nothing here touches the real vault, and no test starts
// a server — the store is filesystem-only by construction.
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-wiki-store-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const CLAIM_ID = '01KCLAIMAAAAAAAAAAAAAAAAAA';
const SNIPPET_A = '01KSNIPAAAAAAAAAAAAAAAAAAA@1';
const SNIPPET_B = '01KSNIPBBBBBBBBBBBBBBBBBBB@2';
const READING_ID = '01KREADAAAAAAAAAAAAAAAAAAA';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: CLAIM_ID,
    body: 'He treats a deadline as a promise made to another person.',
    range: 'when he is talking about work he was hired for',
    status: 'unconfirmed',
    cites: [SNIPPET_A],
    facet: 'value',
    referents: ['my-manager'],
    fromReadings: [READING_ID],
    attested: false,
    readLog: [],
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T10:00:00.000Z',
    created: '2026-08-02T10:00:00.000Z',
    updated: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeContradiction(overrides: Partial<Contradiction> = {}): Contradiction {
  return {
    id: '01KCONTRAAAAAAAAAAAAAAAAAA',
    type: 'synchronic',
    claims: ['01KCLAIMAAAAAAAAAAAAAAAAAA', '01KCLAIMBBBBBBBBBBBBBBBBBB'],
    candidate: '01KCANDAAAAAAAAAAAAAAAAAAA',
    remeasureQueueId: '01KQUEUEAAAAAAAAAAAAAAAAAA',
    evidence: { snippetRef: SNIPPET_B, quote: 'I would rather be late than wrong', side: 'b' },
    status: 'open',
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T10:00:00.000Z',
    opened: '2026-08-02T10:00:00.000Z',
    updated: '2026-08-02T10:00:00.000Z',
    body: '> deadlines are promises (2026-07-01)\n\n> I would rather be late than wrong (2026-08-01)',
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ClashCandidate> = {}): ClashCandidate {
  return {
    id: '01KCANDAAAAAAAAAAAAAAAAAAA',
    pair: ['01KCLAIMAAAAAAAAAAAAAAAAAA', '01KCLAIMBBBBBBBBBBBBBBBBBB'],
    channel: 'lexical',
    status: 'pending-remeasure',
    attempts: 1,
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T10:00:00.000Z',
    created: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeReferent(overrides: Partial<Referent> = {}): Referent {
  return {
    slug: 'my-manager',
    canonical: 'my manager',
    kind: 'person',
    aliases: ['the boss'],
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T10:00:00.000Z',
    created: '2026-08-02T10:00:00.000Z',
    updated: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeSweepLine(overrides: Partial<SweepLine> = {}): SweepLine {
  return {
    readingId: READING_ID,
    op: 'MINT',
    at: '2026-08-02T10:00:00.000Z',
    model: 'qwen3.6:35b',
    ...overrides,
  };
}

/** Read the file the store wrote, as bytes. The oracle is the disk, not the store. */
function claimFile(id: string): string {
  return readFileSync(join(root, 'wiki', 'claims', `${id}.md`), 'utf-8');
}

describe('ClaimStore — claims', () => {
  it('round-trips a claim through a SECOND store instance, and the file on disk carries it', () => {
    const writer = createClaimStore(root);
    const claim = makeClaim();
    writer.writeClaim(claim);

    // Durability: a fresh instance over the same root sees everything.
    const reader = createClaimStore(root);
    expect(reader.readClaim(CLAIM_ID)).toEqual(claim);
    expect(reader.loadSlice().claims).toEqual([claim]);

    // And the truth is the markdown (Q-3), not what the store returned.
    const raw = claimFile(CLAIM_ID);
    const parsed = matter(raw);
    expect(parsed.content.trim()).toBe(claim.body);
    expect(parsed.data.range).toBe(claim.range);
    expect(parsed.data.cites).toEqual([SNIPPET_A]);
    expect(parsed.data.facet).toBe('value');
    expect(parsed.data.referents).toEqual(['my-manager']);
    expect(parsed.data.fromReadings).toEqual([READING_ID]);
    expect(parsed.data.attested).toBe(false);
    expect(parsed.data.model).toBe('qwen3.6:35b');
    // A key holding `undefined` throws inside matter.stringify and loses the
    // whole write; absent optional fields must be absent keys.
    expect(raw).not.toContain('undefined');
    expect(Object.keys(parsed.data)).not.toContain('supersededBy');
    expect(Object.keys(parsed.data)).not.toContain('archived');
  });

  it('rebuilds the whole slice after the derived state is gone (Q-3)', () => {
    const store = createClaimStore(root);
    store.writeClaim(makeClaim());
    store.writeContradiction(makeContradiction());
    store.writeReferent(makeReferent());

    const slice = createClaimStore(root).loadSlice();
    expect(slice.claims).toHaveLength(1);
    expect(slice.contradictions).toHaveLength(1);
    expect(slice.referents).toHaveLength(1);
  });

  it('returns null for a claim that was never written', () => {
    expect(createClaimStore(root).readClaim('01KNOPEAAAAAAAAAAAAAAAAAAA')).toBeNull();
  });

  it('loadSlice on an empty root is empty, never an error', () => {
    const slice = createClaimStore(root).loadSlice();
    expect(slice).toEqual({ claims: [], contradictions: [], referents: [] });
  });

  it('orders claims deterministically by id', () => {
    const store = createClaimStore(root);
    for (const id of ['01KC', '01KA', '01KB']) store.writeClaim(makeClaim({ id }));
    expect(createClaimStore(root).loadSlice().claims.map((c) => c.id)).toEqual([
      '01KA',
      '01KB',
      '01KC',
    ]);
  });
});

describe('ClaimStore — validate before write', () => {
  it('refuses an empty Range (Q-21) and writes no file', () => {
    const store = createClaimStore(root);
    expect(() => store.writeClaim(makeClaim({ range: '' }))).toThrow(/range/i);
    expect(existsSync(join(root, 'wiki', 'claims', `${CLAIM_ID}.md`))).toBe(false);
  });

  it('refuses a whitespace-only Range', () => {
    const store = createClaimStore(root);
    expect(() => store.writeClaim(makeClaim({ range: '   \n ' }))).toThrow(/range/i);
  });

  it('refuses empty cites (Q-21)', () => {
    const store = createClaimStore(root);
    expect(() => store.writeClaim(makeClaim({ cites: [] }))).toThrow(/cites/i);
  });

  it('refuses archived: true without an archiveReason (Q-29)', () => {
    const store = createClaimStore(root);
    expect(() => store.writeClaim(makeClaim({ archived: true }))).toThrow(/archiveReason/i);
  });

  it('refuses supersededBy without a supersedeReason (Q-29)', () => {
    const store = createClaimStore(root);
    expect(() =>
      store.writeClaim(makeClaim({ supersededBy: '01KOTHERAAAAAAAAAAAAAAAAAA' }))
    ).toThrow(/supersedeReason/i);
  });

  it('refuses an id that would write outside the claims directory', () => {
    const store = createClaimStore(root);
    expect(() => store.writeClaim(makeClaim({ id: '../escape' }))).toThrow(/id/i);
    expect(() => store.writeClaim(makeClaim({ id: '' }))).toThrow(/id/i);
  });

  it('ARCHIVE keeps the file — archiving is frontmatter, never a delete (Q-29)', () => {
    const store = createClaimStore(root);
    store.writeClaim(makeClaim());
    const path = join(root, 'wiki', 'claims', `${CLAIM_ID}.md`);
    expect(existsSync(path)).toBe(true);

    store.writeClaim(makeClaim({ archived: true, archiveReason: 'merged-into:01KOTHER' }));
    expect(existsSync(path)).toBe(true);

    const reloaded = createClaimStore(root).readClaim(CLAIM_ID);
    expect(reloaded?.archived).toBe(true);
    expect(reloaded?.archiveReason).toBe('merged-into:01KOTHER');
    // An archived claim still loads into the slice: it is evidence, not a tombstone.
    expect(createClaimStore(root).loadSlice().claims).toHaveLength(1);
  });
});

describe('ClaimStore — malformed files are skipped, never repaired', () => {
  it('skips a claim missing its Range and still loads its siblings', () => {
    const store = createClaimStore(root);
    store.writeClaim(makeClaim({ id: '01KGOOD' }));

    const dir = join(root, 'wiki', 'claims');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '01KBAD.md'),
      matter.stringify('A claim with no context.', {
        id: '01KBAD',
        status: 'unconfirmed',
        cites: [SNIPPET_A],
        facet: 'value',
        model: 'qwen3.6:35b',
        modelAt: '2026-08-02T10:00:00.000Z',
        created: '2026-08-02T10:00:00.000Z',
        updated: '2026-08-02T10:00:00.000Z',
      }),
      'utf-8'
    );
    writeFileSync(join(dir, '01KGARBAGE.md'), 'not frontmatter at all\n', 'utf-8');

    const slice = createClaimStore(root).loadSlice();
    expect(slice.claims.map((c) => c.id)).toEqual(['01KGOOD']);
    // Never repaired: the bad files are still on disk, byte for byte.
    expect(readFileSync(join(dir, '01KGARBAGE.md'), 'utf-8')).toBe('not frontmatter at all\n');
    expect(existsSync(join(dir, '01KBAD.md'))).toBe(true);
    expect(createClaimStore(root).readClaim('01KBAD')).toBeNull();
  });

  it('skips a claim whose cites are empty on disk', () => {
    const dir = join(root, 'wiki', 'claims');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '01KBAD.md'),
      matter.stringify('An opinion.', {
        id: '01KBAD',
        range: 'always',
        status: 'unconfirmed',
        cites: [],
        facet: 'value',
        model: 'm',
        modelAt: 'x',
        created: 'x',
        updated: 'x',
      }),
      'utf-8'
    );
    expect(createClaimStore(root).loadSlice().claims).toEqual([]);
  });

  it('skips a Contradiction whose claims are not a pair', () => {
    const dir = join(root, 'wiki', 'contradictions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '01KBAD.md'),
      matter.stringify('one pole only', {
        id: '01KBAD',
        type: 'synchronic',
        claims: ['01KONLYONE'],
        candidate: '01KCAND',
        remeasureQueueId: '01KQ',
        evidence: { snippetRef: SNIPPET_A, quote: 'q', side: 'a' },
        status: 'open',
        model: 'm',
        modelAt: 'x',
        opened: 'x',
        updated: 'x',
      }),
      'utf-8'
    );
    expect(createClaimStore(root).listContradictions()).toEqual([]);
  });

  it('skips a ClashCandidate whose pair is not a pair', () => {
    const dir = join(root, 'wiki', 'candidates');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '01KBAD.md'),
      matter.stringify('', {
        id: '01KBAD',
        pair: ['a', 'b', 'c'],
        channel: 'lexical',
        status: 'pending-remeasure',
        model: 'm',
        modelAt: 'x',
        created: 'x',
      }),
      'utf-8'
    );
    expect(createClaimStore(root).listCandidates()).toEqual([]);
  });
});

describe('ClaimStore — contradictions, candidates, referents', () => {
  it('round-trips a Contradiction, body and evidence intact', () => {
    const c = makeContradiction();
    createClaimStore(root).writeContradiction(c);

    const [loaded] = createClaimStore(root).listContradictions();
    expect(loaded).toEqual(c);

    const raw = readFileSync(join(root, 'wiki', 'contradictions', `${c.id}.md`), 'utf-8');
    expect(matter(raw).data.evidence).toEqual(c.evidence);
    expect(matter(raw).content.trim()).toBe(c.body);
    expect(raw).not.toContain('undefined');
  });

  it('round-trips a dissolved Contradiction with its reason', () => {
    const c = makeContradiction({ status: 'dissolved', dissolveReason: 'the user restated it' });
    createClaimStore(root).writeContradiction(c);
    expect(createClaimStore(root).listContradictions()[0]).toEqual(c);
  });

  it('round-trips a ClashCandidate with remeasureAskedAt present AND absent', () => {
    const store = createClaimStore(root);
    const bare = makeCandidate({ id: '01KCANDBARE' });
    const asked = makeCandidate({
      id: '01KCANDASKED',
      remeasureQueueId: '01KQUEUE',
      remeasureAskedAt: '2026-08-02T11:00:00.000Z',
      outcome: 'not-opposed',
      status: 'dissolved',
    });
    store.writeCandidate(bare);
    store.writeCandidate(asked);

    const loaded = createClaimStore(root).listCandidates();
    expect(loaded).toEqual([asked, bare].sort((a, b) => a.id.localeCompare(b.id)));

    // Absent stays absent — a key holding `undefined` is a different fact.
    const rawBare = readFileSync(join(root, 'wiki', 'candidates', '01KCANDBARE.md'), 'utf-8');
    expect(Object.keys(matter(rawBare).data)).not.toContain('remeasureAskedAt');
    expect(Object.keys(matter(rawBare).data)).not.toContain('outcome');
    expect(rawBare).not.toContain('undefined');

    const first = loaded.find((c) => c.id === '01KCANDASKED');
    expect(first?.remeasureAskedAt).toBe('2026-08-02T11:00:00.000Z');
    expect(first?.pair).toEqual(asked.pair);
  });

  it('round-trips a ClashCandidate with joinsTwoSittings present AND absent', () => {
    // Ticket 007's watch-item (ticket 083): every NEW record is born with the
    // pool's stamp, but records written before 083 lack it — and a key holding
    // `undefined` is a different fact from a key that is absent.
    const store = createClaimStore(root);
    const bare = makeCandidate({ id: '01KCANDJOINBARE' });
    const stamped = makeCandidate({
      id: '01KCANDJOINSTAMP',
      joinsTwoSittings: true,
    });
    store.writeCandidate(bare);
    store.writeCandidate(stamped);

    const loaded = createClaimStore(root).listCandidates();
    expect(loaded).toEqual([stamped, bare].sort((a, b) => a.id.localeCompare(b.id)));

    // Present in the frontmatter when written with the field.
    const rawStamped = readFileSync(join(root, 'wiki', 'candidates', '01KCANDJOINSTAMP.md'), 'utf-8');
    expect(matter(rawStamped).data.joinsTwoSittings).toBe(true);

    // Absent stays absent — the old record loads without the field.
    const rawBare = readFileSync(join(root, 'wiki', 'candidates', '01KCANDJOINBARE.md'), 'utf-8');
    expect(Object.keys(matter(rawBare).data)).not.toContain('joinsTwoSittings');
    expect(rawBare).not.toContain('undefined');

    const first = loaded.find((c) => c.id === '01KCANDJOINSTAMP');
    expect(first?.joinsTwoSittings).toBe(true);
    expect(first?.pair).toEqual(stamped.pair);
    expect(loaded.find((c) => c.id === '01KCANDJOINBARE')?.joinsTwoSittings).toBeUndefined();
  });

  it('round-trips a Referent with a note and without one', () => {
    const store = createClaimStore(root);
    const noted = makeReferent({ slug: 'my-manager', note: 'Named in eleven snippets.' });
    const bare = makeReferent({ slug: 'the-thesis', canonical: 'the thesis', kind: 'project' });
    store.writeReferent(noted);
    store.writeReferent(bare);

    const loaded = createClaimStore(root).listReferents();
    expect(loaded).toEqual([noted, bare].sort((a, b) => a.slug.localeCompare(b.slug)));
    // The note is the file body, so it is prose on disk and not a YAML string.
    const raw = readFileSync(join(root, 'wiki', 'registry', 'my-manager.md'), 'utf-8');
    expect(matter(raw).content.trim()).toBe('Named in eleven snippets.');
    expect(Object.keys(matter(raw).data)).not.toContain('note');
  });

  it('refuses a referent slug that would write outside the registry', () => {
    const store = createClaimStore(root);
    expect(() => store.writeReferent(makeReferent({ slug: '../escape' }))).toThrow(/slug/i);
  });
});

describe('ClaimStore — the sweep ledger', () => {
  it('a missing sweep-log is an empty set and an empty map, never an error', () => {
    const store = createClaimStore(root);
    expect(store.sweptReadingIds().size).toBe(0);
    expect(store.oversizedReadingIds().size).toBe(0);
    expect(store.attemptCounts().size).toBe(0);
  });

  it('a swept reading survives a restart', () => {
    createClaimStore(root).appendSweep(makeSweepLine({ readingId: 'R1', op: 'MINT' }));
    const fresh = createClaimStore(root);
    expect(fresh.sweptReadingIds().has('R1')).toBe(true);

    const raw = readFileSync(join(root, 'wiki', 'sweep-log.jsonl'), 'utf-8');
    expect(raw.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(raw.trimEnd())).toMatchObject({ readingId: 'R1', op: 'MINT' });
  });

  it('a KEEP marks the reading swept — "judged redundant" is not "never swept" (Q-29)', () => {
    const store = createClaimStore(root);
    store.appendSweep(makeSweepLine({ readingId: 'R1', op: 'KEEP' }));
    expect(store.sweptReadingIds().has('R1')).toBe(true);
  });

  it('OVERSIZED marks the reading swept AND names it re-sweepable', () => {
    const store = createClaimStore(root);
    store.appendSweep(makeSweepLine({ readingId: 'R2', op: 'OVERSIZED', reason: 'over budget' }));
    expect(store.sweptReadingIds().has('R2')).toBe(true);
    expect(store.oversizedReadingIds().has('R2')).toBe(true);
    expect(store.attemptCounts().get('R2')).toBeUndefined();
  });

  it('REJECTED counts an attempt and leaves the reading UNPROCESSED (Q-29)', () => {
    const store = createClaimStore(root);
    store.appendSweep(makeSweepLine({ readingId: 'R3', op: 'REJECTED', reason: 'no range' }));
    expect(store.sweptReadingIds().has('R3')).toBe(false);
    expect(store.oversizedReadingIds().has('R3')).toBe(false);
    expect(store.attemptCounts().get('R3')).toBe(1);
  });

  it('three REJECTED lines for one reading count three', () => {
    const store = createClaimStore(root);
    for (let i = 0; i < 3; i++) {
      store.appendSweep(makeSweepLine({ readingId: 'R4', op: 'REJECTED', reason: `try ${i}` }));
    }
    const counts = createClaimStore(root).attemptCounts();
    expect(counts.get('R4')).toBe(3);
    expect(createClaimStore(root).sweptReadingIds().has('R4')).toBe(false);
  });

  it('a reading rejected twice and then minted is swept, with both attempts still counted', () => {
    const store = createClaimStore(root);
    store.appendSweep(makeSweepLine({ readingId: 'R5', op: 'REJECTED' }));
    store.appendSweep(makeSweepLine({ readingId: 'R5', op: 'REJECTED' }));
    store.appendSweep(makeSweepLine({ readingId: 'R5', op: 'MINT', claimId: CLAIM_ID }));
    expect(store.sweptReadingIds().has('R5')).toBe(true);
    expect(store.attemptCounts().get('R5')).toBe(2);
  });

  it('skips a corrupt ledger line and reads the rest', () => {
    const store = createClaimStore(root);
    store.appendSweep(makeSweepLine({ readingId: 'R6', op: 'MINT' }));
    writeFileSync(
      join(root, 'wiki', 'sweep-log.jsonl'),
      `${readFileSync(join(root, 'wiki', 'sweep-log.jsonl'), 'utf-8')}{not json\n`,
      'utf-8'
    );
    store.appendSweep(makeSweepLine({ readingId: 'R7', op: 'OVERSIZED' }));

    const fresh = createClaimStore(root);
    expect([...fresh.sweptReadingIds()].sort()).toEqual(['R6', 'R7']);
  });
});

describe('ClaimStore — the read-log (Q-21)', () => {
  it('appends to readLog without dropping any other frontmatter', () => {
    const store = createClaimStore(root);
    const claim = makeClaim({
      archived: true,
      archiveReason: 'merged-into:01KOTHER',
      supersededBy: '01KOTHER',
      supersedeReason: 'model-upgrade',
    });
    store.writeClaim(claim);

    store.recordRead(CLAIM_ID, '2026-08-02T12:00:00.000Z', 'wiki');
    store.recordRead(CLAIM_ID, '2026-08-02T13:00:00.000Z', 'juxtaposition');

    const reloaded = createClaimStore(root).readClaim(CLAIM_ID);
    expect(reloaded).toEqual({
      ...claim,
      readLog: [
        { at: '2026-08-02T12:00:00.000Z', surface: 'wiki' },
        { at: '2026-08-02T13:00:00.000Z', surface: 'juxtaposition' },
      ],
    });

    // On disk, in order, with everything else still there.
    const data = matter(claimFile(CLAIM_ID)).data;
    expect(data.readLog).toEqual([
      { at: '2026-08-02T12:00:00.000Z', surface: 'wiki' },
      { at: '2026-08-02T13:00:00.000Z', surface: 'juxtaposition' },
    ]);
    expect(data.archiveReason).toBe('merged-into:01KOTHER');
    expect(data.supersedeReason).toBe('model-upgrade');
    expect(matter(claimFile(CLAIM_ID)).content.trim()).toBe(claim.body);
  });

  it('throws for a claim that is not on disk rather than losing the read', () => {
    const store = createClaimStore(root);
    expect(() => store.recordRead('01KNOPE', '2026-08-02T12:00:00.000Z', 'wiki')).toThrow(/01KNOPE/);
  });
});

describe('ClashCandidate.attempts survives the round trip (Q-53)', () => {
  it('a candidate written with attempts 2 reads back as 2, not 1', () => {
    // The bug this pins: `attempts` was absent from writeCandidate's
    // frontmatter while listCandidates defaulted an absent key to 1. Q-53's
    // cap of 2 therefore never bit across a round trip, and a pair dissolved
    // as `remeasure-expired` would earn a fresh re-measure on every docket
    // run, forever. The type was required, the read was correct, and the
    // write silently dropped it.
    const store = createClaimStore(root);
    store.writeCandidate(makeCandidate({ id: '01KCAPPED', attempts: 2 }));

    const raw = readFileSync(join(root, 'wiki', 'candidates', '01KCAPPED.md'), 'utf-8');
    expect(matter(raw).data['attempts']).toBe(2);

    const readBack = createClaimStore(root).listCandidates().find((c) => c.id === '01KCAPPED');
    expect(readBack?.attempts).toBe(2);
  });

  it('a candidate file written before Q-53 still reads as one attempt', () => {
    // Absent means "has had exactly one re-measure", which is what every
    // pre-Q-53 file on disk means. Defaulting is not fabrication here.
    const dir = join(root, 'wiki', 'candidates');
    mkdirSync(dir, { recursive: true });
    const legacy = matter.stringify('', {
      id: '01KLEGACY', pair: ['01KCLAIMA', '01KCLAIMB'], channel: 'lexical',
      status: 'pending-remeasure', model: 'qwen3.6:35b',
      modelAt: '2026-08-01T00:00:00.000Z', created: '2026-08-01T00:00:00.000Z',
    });
    writeFileSync(join(dir, '01KLEGACY.md'), legacy, 'utf-8');

    const readBack = createClaimStore(root).listCandidates().find((c) => c.id === '01KLEGACY');
    expect(readBack?.attempts).toBe(1);
  });
});

describe('Sweep deferral and still-true cursor (075)', () => {
  it('appendSweepDeferral appends one line per call; readSweepDeferral returns the LAST', () => {
    appendSweepDeferral(root, 30);
    appendSweepDeferral(root, 18);
    appendSweepDeferral(root, 0);

    const last = readSweepDeferral(root);
    expect(last).toEqual({ at: expect.any(String), remaining: 0 });

    const raw = readFileSync(join(root, 'wiki', 'sweep-deferral.jsonl'), 'utf-8');
    const lines = raw.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ remaining: 30 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ remaining: 18 });
  });

  it('a missing deferral file reads null', () => {
    expect(readSweepDeferral(root)).toBeNull();
  });

  it('skips a corrupt LAST deferral line and returns the previous one', () => {
    appendSweepDeferral(root, 18);
    writeFileSync(
      join(root, 'wiki', 'sweep-deferral.jsonl'),
      `${readFileSync(join(root, 'wiki', 'sweep-deferral.jsonl'), 'utf-8')}{not json\n`,
      'utf-8'
    );
    expect(readSweepDeferral(root)).toMatchObject({ remaining: 18 });
  });

  it('a deferral file with only corrupt lines reads null', () => {
    mkdirSync(join(root, 'wiki'), { recursive: true });
    writeFileSync(
      join(root, 'wiki', 'sweep-deferral.jsonl'),
      '{not json\n{"remaining": "twelve"}\n',
      'utf-8'
    );
    expect(readSweepDeferral(root)).toBeNull();
  });

  it('writeStillTrueCursor round-trips; the file lives at the expected path', () => {
    writeStillTrueCursor(root, 7);
    expect(readStillTrueCursor(root)).toBe(7);
    expect(JSON.parse(readFileSync(join(root, 'wiki', 'still-true-cursor.json'), 'utf-8'))).toEqual({ offset: 7 });
  });

  it('a missing or corrupt cursor file reads 0', () => {
    expect(readStillTrueCursor(root)).toBe(0);

    mkdirSync(join(root, 'wiki'), { recursive: true });
    writeFileSync(join(root, 'wiki', 'still-true-cursor.json'), 'not json', 'utf-8');
    expect(readStillTrueCursor(root)).toBe(0);

    writeFileSync(join(root, 'wiki', 'still-true-cursor.json'), '{"offset": "seven"}', 'utf-8');
    expect(readStillTrueCursor(root)).toBe(0);
  });
});
