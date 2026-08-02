import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  claimDelta,
  changedIn,
  fingerprintOf,
  readWatermark,
  sameFingerprint,
  vaultDiff,
  writeWatermark,
} from '../src/index/watermark.js';
import type { VaultDiff } from '../src/index/watermark.js';
import type { Claim, ClaimGraph, ClashCandidate } from '../src/wiki/contract.js';

// A tmp root per test. Nothing here touches the real vault, and no test starts
// a server — the git gate and the watermark are filesystem-only by construction.
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'watermark-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── git helper (tests 1-5) ──

const CLERK = { name: 'elicit-clerk', email: 'clerk@localhost' };
const OTHER = { name: 'Micah', email: 'micah@example.com' };

function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

/** Write a file (creating parent dirs), configure the author, and commit. Returns the commit hash. */
function commit(author: { name: string; email: string }, path: string, content: string): string {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content, 'utf8');
  git('config', 'user.name', author.name);
  git('config', 'user.email', author.email);
  git('add', '-A');
  git('commit', '-q', '-m', 'test');
  return git('rev-parse', 'HEAD');
}

// ── graph helpers (tests 7-11) ──

const CLAIM_A = '01KCLAIMAAAAAAAAAAAAAAAAAA';
const CLAIM_B = '01KCLAIMBBBBBBBBBBBBBBBBBB';
const CLAIM_C = '01KCLAIMCCCCCCCCCCCCCCCCCC';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: CLAIM_A,
    body: 'He treats a deadline as a promise made to another person.',
    range: 'when he is talking about work he was hired for',
    status: 'unconfirmed',
    cites: ['01KSNIPAAAAAAAAAAAAAAAAAAA@1'],
    facet: 'value',
    referents: ['my-manager'],
    fromReadings: ['01KREADAAAAAAAAAAAAAAAAAAA'],
    attested: false,
    readLog: [],
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T10:00:00.000Z',
    created: '2026-08-02T10:00:00.000Z',
    updated: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ClashCandidate> = {}): ClashCandidate {
  return {
    id: '01KCANDAAAAAAAAAAAAAAAAAAAA',
    pair: [CLAIM_A, CLAIM_B],
    channel: 'lexical',
    status: 'pending-remeasure',
    attempts: 1,
    model: 'qwen3.6:35b',
    modelAt: '2026-08-02T10:00:00.000Z',
    created: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeGraph(overrides: Partial<ClaimGraph> = {}): ClaimGraph {
  return {
    claims: [makeClaim()],
    snippets: {},
    readings: {},
    contradictions: [],
    referents: [],
    ...overrides,
  };
}

// ── Mechanism 1: the git-diff gate ──

describe('vaultDiff — the git-diff gate (076)', () => {
  it('is unavailable in a directory that is not a git repo', () => {
    const diff = vaultDiff(root);
    expect(diff.available).toBe(false);
    expect(diff.reason).toBe('not-a-git-repo');
    expect(diff.since).toBeNull();
    expect(diff.changed.size).toBe(0);
  });

  it('is unavailable when no commit was authored by the clerk', () => {
    git('init', '-q');
    commit(OTHER, 'wiki/readings/01X.md', '# A reading\n');
    const diff = vaultDiff(root);
    expect(diff.available).toBe(false);
    expect(diff.reason).toBe('no-clerk-commit');
  });

  it('is available with a clean tree after a clerk commit, since = that commit', () => {
    git('init', '-q');
    const head = commit(CLERK, 'snippets/s1/v1.md', 'The first snippet.\n');
    const diff = vaultDiff(root);
    expect(diff.available).toBe(true);
    expect(diff.since).toBe(head);
    expect(diff.changed.size).toBe(0);
  });

  it('reports a modified file after the clerk commit as changed', () => {
    git('init', '-q');
    commit(CLERK, 'snippets/s1/v1.md', 'The first snippet.\n');
    writeFileSync(join(root, 'snippets', 's1', 'v1.md'), 'The edited snippet.\n', 'utf8');
    const diff = vaultDiff(root);
    expect(diff.available).toBe(true);
    expect(diff.changed).toEqual(new Set(['snippets/s1/v1.md']));
  });

  it('still reports another author’s committed work, because the diff runs since the last clerk commit', () => {
    git('init', '-q');
    commit(CLERK, 'wiki/readings/01X.md', '# A reading\n');
    commit(OTHER, 'queue/note.md', 'A hand-added note.\n');
    const diff = vaultDiff(root);
    expect(diff.available).toBe(true);
    expect(diff.changed).toEqual(new Set(['queue/note.md']));
  });

  it('reports an UNTRACKED file, because the app’s writes are uncommitted until the next docket commit', () => {
    git('init', '-q');
    commit(CLERK, 'snippets/s1/v1.md', 'The first snippet.\n');
    // A freshly harvested snippet and its reading: written by the app, not yet committed.
    mkdirSync(join(root, 'wiki', 'readings'), { recursive: true });
    writeFileSync(join(root, 'wiki', 'readings', 'r-new.md'), '# A new reading\n', 'utf8');
    const diff = vaultDiff(root);
    expect(diff.available).toBe(true);
    expect(diff.changed).toEqual(new Set(['wiki/readings/r-new.md']));
  });

  it('keeps a gitignored derived file out of the changed set', () => {
    git('init', '-q');
    commit(CLERK, 'snippets/s1/v1.md', 'The first snippet.\n');
    writeFileSync(join(root, '.gitignore'), '/index/\n/wiki/embeddings.jsonl\n', 'utf8');
    // The watermark itself: derived, gitignored, and never a job input.
    mkdirSync(join(root, 'index'), { recursive: true });
    writeFileSync(join(root, 'index', 'watermark.json'), '{"schema":1}\n', 'utf8');
    const diff = vaultDiff(root);
    expect(diff.available).toBe(true);
    expect(diff.changed).toEqual(new Set(['.gitignore']));
  });
});

describe('changedIn — prefix matching', () => {
  it('matches a changed path under one of the prefixes', () => {
    const diff: VaultDiff = {
      available: true,
      since: 'abc',
      changed: new Set(['wiki/readings/01X.md']),
    };
    expect(changedIn(diff, ['wiki/readings/'])).toBe(true);
  });

  it('does not match a path outside the prefixes', () => {
    const diff: VaultDiff = {
      available: true,
      since: 'abc',
      changed: new Set(['wiki/readings/01X.md']),
    };
    expect(changedIn(diff, ['queue/'])).toBe(false);
  });

  it('is false for an empty changed set', () => {
    const diff: VaultDiff = { available: true, since: 'abc', changed: new Set() };
    expect(changedIn(diff, ['wiki/readings/'])).toBe(false);
  });
});

// ── Mechanism 2: the index watermark ──

describe('fingerprintOf', () => {
  it('is deterministic: the same graph and candidates fingerprint identically', () => {
    const graph = makeGraph({
      claims: [makeClaim({ id: CLAIM_A, body: 'One sentence.' }), makeClaim({ id: CLAIM_B, body: 'Another.' })],
    });
    const candidates = [makeCandidate()];
    expect(sameFingerprint(fingerprintOf(graph, candidates), fingerprintOf(graph, candidates))).toBe(true);
  });

  it('flips when a claim body changes, but ignores readLog noise', () => {
    const graph = makeGraph();
    const base = fingerprintOf(graph);
    const edited = fingerprintOf(makeGraph({ claims: [makeClaim({ body: 'A different sentence entirely.' })] }));
    const reRead = fingerprintOf(
      makeGraph({
        claims: [makeClaim({ readLog: [{ at: '2026-08-02T11:00:00.000Z', surface: 'read' }] })],
      })
    );
    expect(sameFingerprint(base, edited)).toBe(false);
    expect(sameFingerprint(base, reRead)).toBe(true);
  });
});

describe('readWatermark / writeWatermark', () => {
  it('round-trips a fingerprint', () => {
    const fp = fingerprintOf(makeGraph());
    writeWatermark(root, fp);
    const back = readWatermark(root);
    expect(back).not.toBeNull();
    expect(sameFingerprint(fp, back!)).toBe(true);
  });

  it('returns null when the watermark file is missing', () => {
    expect(readWatermark(root)).toBeNull();
  });

  it('returns null when the watermark file is not valid JSON', () => {
    mkdirSync(join(root, 'index'), { recursive: true });
    writeFileSync(join(root, 'index', 'watermark.json'), '{not json', 'utf8');
    expect(readWatermark(root)).toBeNull();
  });

  it('returns null when the watermark was written by another schema', () => {
    const fp = fingerprintOf(makeGraph());
    writeWatermark(root, fp);
    writeFileSync(join(root, 'index', 'watermark.json'), `${JSON.stringify({ ...fp, schema: 999 })}\n`, 'utf8');
    expect(readWatermark(root)).toBeNull();
  });
});

describe('sameFingerprint', () => {
  it('is false when one map entry differs', () => {
    const a = fingerprintOf(makeGraph());
    const b = { ...a, claims: { ...a.claims, [CLAIM_A]: 'a different hash' } };
    expect(sameFingerprint(a, b)).toBe(false);
  });

  it('is true when only the `at` timestamp differs', () => {
    const a = fingerprintOf(makeGraph());
    const b = { ...a, at: '2099-01-01T00:00:00.000Z' };
    expect(sameFingerprint(a, b)).toBe(true);
  });
});

describe('claimDelta', () => {
  it('lists claims new to the watermark or edited since, never unchanged ones', () => {
    const claimA = makeClaim({ id: CLAIM_A, body: 'Original body.' });
    const claimB = makeClaim({ id: CLAIM_B, body: 'Original body too.' });
    const watermark = fingerprintOf(makeGraph({ claims: [claimA, claimB] }));

    const editedB = makeClaim({ id: CLAIM_B, body: 'This body changed.' });
    const newC = makeClaim({ id: CLAIM_C, body: 'Minted after the watermark.' });
    const delta = claimDelta(watermark, [claimA, editedB, newC]);

    expect(delta).toEqual(new Set([CLAIM_B, CLAIM_C]));
  });
});
