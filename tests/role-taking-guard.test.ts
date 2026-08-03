// Q-84: a role-taking reading is evidence of the person's MODEL of a named
// other, never of the other's own traits. A claim body that states a direct
// self-attribution of the other ("The user is …") must be rejected by name;
// a body that names the model ("The user models Alice as …") is the legal
// shape and must pass. The same rule holds for MINT and SUPERSEDE.
//
// No model anywhere. The store is real (a tmp dir), the registry is a fake,
// and the graph is a literal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyOps } from '../src/wiki/ops.js';
import { createClaimStore } from '../src/wiki/store.js';
import type {
  Claim,
  ClaimGraph,
  ClaimStore,
  LogFn,
  Referent,
  ReferentRef,
  Registry,
} from '../src/wiki/contract.js';
import type { Reading, Snippet } from '../src/types.js';

const MODEL = 'qwen3.6:35b';
const AT = '2026-08-02T10:00:00.000Z';

const READING = '01KREADAAAAAAAAAAAAAAAAAAA';
const SNIP = '01KSNIPAAAAAAAAAAAAAAAAAAA';
const CLAIM = '01KCLAIMAAAAAAAAAAAAAAAAAA';

let root: string;
let store: ClaimStore;
let events: Parameters<LogFn>[0][];
let log: LogFn;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-role-taking-'));
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

function snippet(id: string): Snippet {
  return {
    id,
    version: 1,
    captured: '2026-07-01T09:00:00.000Z',
    provenance: { kind: 'harvest', session: 'sitting-1', question: 'what did you mean?', questionForm: 'why' },
    prose: 'Some words the user actually wrote.',
  };
}

/** The reading is role-taking: the user wrote AS their model of Alice. */
function roleTakingReading(overrides: Partial<Reading> = {}): Reading {
  return {
    id: READING,
    facet: 'fact',
    stance: 'role-taking',
    cites: [`${SNIP}@1`],
    reading: 'The user is writing as Alice, whom she models as competitive.',
    at: AT,
    ...overrides,
  };
}

function graphOf(over: Partial<ClaimGraph> = {}): ClaimGraph {
  return {
    claims: store.loadSlice().claims,
    snippets: { [SNIP]: snippet(SNIP) },
    readings: { [READING]: roleTakingReading() },
    contradictions: store.loadSlice().contradictions,
    referents: store.loadSlice().referents,
    ...over,
  };
}

function fakeRegistry(): Registry & { calls: string[]; referents: Map<string, Referent> } {
  const referents = new Map<string, Referent>();
  const calls: string[] = [];
  return {
    calls,
    referents,
    resolve(ref: ReferentRef): Referent {
      calls.push(`resolve:${ref.name}`);
      const slug = ref.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const made: Referent = {
        slug,
        canonical: ref.name,
        kind: ref.kind,
        aliases: [],
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

const registry = fakeRegistry();

function run(ops: unknown[], readingIds: string[], over: Partial<ClaimGraph> = {}) {
  return applyOps(ops, { readingIds }, { store, registry, graph: graphOf(over), model: MODEL, log });
}

function preexistingClaim(body: string): void {
  store.writeClaim({
    id: CLAIM,
    body,
    range: 'when she is talking about her sister',
    status: 'unconfirmed',
    cites: [`${SNIP}@1`],
    facet: 'fact',
    referents: ['alice'],
    fromReadings: [READING],
    attested: false,
    readLog: [],
    model: MODEL,
    modelAt: AT,
    created: AT,
    updated: AT,
  });
}

// ── The guard ──

describe('applyOps — role-taking stance (Q-84)', () => {
  it('REJECTS a MINT whose body attributes a trait directly to the named other', () => {
    const result = run(
      [
        {
          op: 'MINT',
          reading: READING,
          body: 'The user is competitive.',
          range: 'when she is playing a game',
          cites: [`${SNIP}@1`],
          facet: 'fact',
        },
      ],
      [READING],
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('role-taking-cannot-evidence-self-trait');
    expect(result.rejected[0]?.reading).toBe(READING);
    expect(store.loadSlice().claims).toHaveLength(0);
  });

  it('ACCEPTS a MINT whose body names the model, not the other', () => {
    const result = run(
      [
        {
          op: 'MINT',
          reading: READING,
          body: 'The user models Alice as competitive.',
          range: 'when she is playing a game',
          cites: [`${SNIP}@1`],
          facet: 'fact',
        },
      ],
      [READING],
    );
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(store.loadSlice().claims[0]?.body).toBe('The user models Alice as competitive.');
  });

  it('REJECTS a SUPERSEDE whose body attributes a trait directly to the named other', () => {
    preexistingClaim('The user models Alice as competitive.');
    const result = run(
      [
        {
          op: 'SUPERSEDE',
          reading: READING,
          claim: CLAIM,
          body: 'The user is competitive.',
          range: 'when she is playing a game',
          cites: [`${SNIP}@1`],
          reason: 'reworded to a direct trait',
        },
      ],
      [READING],
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('role-taking-cannot-evidence-self-trait');
    expect(result.rejected[0]?.reading).toBe(READING);
    // The old claim stays untouched on disk.
    expect(store.loadSlice().claims).toHaveLength(1);
    expect(store.loadSlice().claims[0]?.body).toBe('The user models Alice as competitive.');
  });

  it('ACCEPTS a SUPERSEDE whose body names the model, not the other', () => {
    preexistingClaim('The user models Alice as competitive.');
    const result = run(
      [
        {
          op: 'SUPERSEDE',
          reading: READING,
          claim: CLAIM,
          body: 'The user models Alice as calm when pressed.',
          range: 'when she is playing a game',
          cites: [`${SNIP}@1`],
          reason: 'sharpened the model',
        },
      ],
      [READING],
    );
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    const fresh = store.loadSlice().claims.find((c) => c.id !== CLAIM);
    expect(fresh?.body).toBe('The user models Alice as calm when pressed.');
    expect(store.loadSlice().claims).toHaveLength(2);
  });
});
