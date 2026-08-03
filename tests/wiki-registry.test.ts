import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { createClaimStore } from '../src/wiki/store.js';
import * as registryModule from '../src/wiki/registry.js';
import { createRegistry, nameSimilarity } from '../src/wiki/registry.js';
import { lint, type ThresholdRegister } from '../src/wiki/lint.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { Claim, ClaimGraph, LogFn, ReferentRef } from '../src/wiki/contract.js';
import type { Complete } from '../src/types.js';

/**
 * The registry's tests have one job beyond checking three tiers: they must fail
 * if the module ever grows the power to COLLAPSE. Q-32 is a rule about power,
 * so most of what follows is about absence — no merge method, no path that
 * reduces the referent count, no model anywhere near the similarity function —
 * and absence is the only part of a module a later reader cannot see by
 * reading it.
 *
 * `mergeCandidates` runs TWICE over the same referents: once against the
 * shipped register, where `registry.mergeCandidateSimilarity` is shadowed and
 * no pair may come back, and once against a register with the entry flipped
 * live. Without the second run, "returned nothing" is equally consistent with
 * "the mechanism is broken", and the shadow proves nothing.
 */

type Event = { at: string; actor: 'clerk'; kind: string; detail: string; refs?: string[] };

function collector(): { events: Event[]; log: LogFn } {
  const events: Event[] = [];
  return { events, log: (e) => void events.push(e) };
}

const MODEL = 'qwen3.6:35b';
const NOW = '2026-08-02T10:00:00.000Z';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-wiki-registry-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fresh(over: { model?: string; thresholds?: ThresholdRegister } = {}) {
  const store = createClaimStore(root);
  const { events, log } = collector();
  const registry = createRegistry(store, over.model ?? MODEL, log, over.thresholds);
  return { store, registry, events, log };
}

function ref(name: string, over: Partial<ReferentRef> = {}): ReferentRef {
  return { name, kind: 'person', ...over };
}

function registryFiles(): string[] {
  return readdirSync(join(root, 'wiki', 'registry')).sort();
}

/** The shipped register with the one entry this module reads graduated (Q-35). */
const MERGE_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'registry.mergeCandidateSimilarity': {
    ...THRESHOLDS['registry.mergeCandidateSimilarity'],
    live: true,
  },
};

function claim(id: string, referents: string[]): Claim {
  return {
    id,
    body: `The user does ${id}.`,
    range: 'at work, since 2024',
    status: 'unconfirmed',
    cites: ['snipA@1'],
    facet: 'construct',
    referents,
    fromReadings: [`read-${id}`],
    attested: false,
    readLog: [],
    model: MODEL,
    modelAt: NOW,
    created: NOW,
    updated: NOW,
  };
}

function graphOf(over: Partial<ClaimGraph> = {}): ClaimGraph {
  return {
    claims: [],
    snippets: {},
    readings: {},
    contradictions: [],
    referents: [],
    ...over,
  };
}

describe('tier 1 — MINT: an unknown name is created freely (Q-32)', () => {
  it('mints a slugified referent, stamps it with the caller’s model, and logs it', () => {
    const { store, registry, events } = fresh();

    const minted = registry.resolve(ref('Sarah Kim'));

    expect(minted.slug).toBe('sarah-kim');
    expect(minted.canonical).toBe('Sarah Kim');
    expect(minted.kind).toBe('person');
    expect(minted.aliases).toEqual([]);
    // Q-34: the stamp comes from the caller, never from a constant in here.
    expect(minted.model).toBe(MODEL);
    expect(minted.modelAt).toBe(minted.created);
    expect(store.listReferents()).toEqual([minted]);

    const logged = events.filter((e) => e.kind === 'referent-minted');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.actor).toBe('clerk');
    expect(logged[0]!.detail).toContain('sarah-kim');
  });

  it('writes the entry as vault markdown, with no key holding undefined (Q-3)', () => {
    const { registry } = fresh();

    registry.resolve(ref('Field Guild', { kind: 'project' }));

    expect(registryFiles()).toEqual(['field-guild.md']);
    const raw = readFileSync(join(root, 'wiki', 'registry', 'field-guild.md'), 'utf-8');
    const parsed = matter(raw);
    expect(parsed.data.slug).toBe('field-guild');
    expect(parsed.data.canonical).toBe('Field Guild');
    expect(parsed.data.kind).toBe('project');
    expect(parsed.data.aliases).toEqual([]);
    expect(parsed.data.model).toBe(MODEL);
    // A required key holding `undefined` throws in matter.stringify and loses
    // the file; `note` is optional and must be an ABSENT key, not an empty one.
    expect(raw).not.toContain('undefined');
    expect(Object.keys(parsed.data)).not.toContain('note');
  });

  it('returns the same referent on a second resolve and writes no second file', () => {
    const { store, registry } = fresh();

    const first = registry.resolve(ref('Sarah Kim'));
    const second = registry.resolve(ref('sarah kim'));

    expect(second).toEqual(first);
    expect(store.listReferents()).toHaveLength(1);
    expect(registryFiles()).toHaveLength(1);
  });

  it('gives two different canonicals that slugify alike distinct slugs and distinct files', () => {
    const { store, registry } = fresh();

    const a = registry.resolve(ref('Sarah Kim'));
    const b = registry.resolve(ref('Sarah  Kim!'));

    expect(a.slug).toBe('sarah-kim');
    expect(b.slug).toBe('sarah-kim-2');
    // Two distinct referents must never share a file: one overwriting the
    // other is a merge by filename, which is the thing Q-32 forbids.
    expect(store.listReferents()).toHaveLength(2);
    expect(registryFiles()).toEqual(['sarah-kim-2.md', 'sarah-kim.md']);
  });

  it('mints a file-safe slug from a name made only of punctuation', () => {
    const { store, registry } = fresh();

    const odd = registry.resolve(ref('../../etc/passwd'));

    expect(odd.slug).not.toContain('/');
    expect(odd.slug).not.toContain('.');
    expect(store.listReferents()).toHaveLength(1);
    expect(registryFiles()).toEqual([`${odd.slug}.md`]);
  });

  it('reads the referents an earlier registry wrote, because the files are the truth (Q-3)', () => {
    const first = fresh();
    first.registry.resolve(ref('Northwind'));

    const second = fresh();

    expect(second.registry.lookup('northwind')?.slug).toBe('northwind');
    expect(second.store.listReferents()).toHaveLength(1);
  });
});

describe('lookup — exact canonical or alias, case-insensitive', () => {
  it('matches the canonical whatever the case, and an alias the same way', () => {
    const { registry } = fresh();
    registry.resolve(ref('Northwind'));
    registry.resolve(ref('North', { aliasOf: 'Northwind' }));

    expect(registry.lookup('NORTHWIND')?.slug).toBe('northwind');
    expect(registry.lookup('  north  ')?.slug).toBe('northwind');
    expect(registry.lookup('North')?.slug).toBe('northwind');
  });

  it('returns null for an unknown name and for an empty one', () => {
    const { registry } = fresh();
    registry.resolve(ref('Northwind'));

    expect(registry.lookup('Northwindd')).toBeNull();
    expect(registry.lookup('')).toBeNull();
    expect(registry.lookup('   ')).toBeNull();
  });
});

describe('tier 2 — ALIAS: reversible linking, never a silent one (Q-32)', () => {
  it('adds the name to an existing canonical and returns that canonical', () => {
    const { store, registry, events } = fresh();
    const canonical = registry.resolve(ref('Northwind'));

    const linked = registry.resolve(ref('North', { aliasOf: 'Northwind' }));

    expect(linked.slug).toBe(canonical.slug);
    expect(linked.aliases).toEqual(['North']);
    expect(store.listReferents()).toHaveLength(1);
    // Reversible: the link is one line of the markdown, and deleting that line
    // undoes it completely.
    const parsed = matter(readFileSync(join(root, 'wiki', 'registry', 'northwind.md'), 'utf-8'));
    expect(parsed.data.aliases).toEqual(['North']);
    expect(events.filter((e) => e.kind === 'referent-aliased')).toHaveLength(1);
  });

  it('accepts the canonical named by its slug as well as by its name', () => {
    const { registry } = fresh();
    registry.resolve(ref('Field Guild', { kind: 'project' }));

    const linked = registry.resolve(ref('the studio', { kind: 'project', aliasOf: 'field-guild' }));

    expect(linked.slug).toBe('field-guild');
    expect(linked.aliases).toEqual(['the studio']);
  });

  it('refreshes the stamp and `updated` on the entry it links, and keeps `created`', () => {
    const { registry } = fresh();
    const canonical = registry.resolve(ref('Northwind'));

    const linked = registry.resolve(ref('North', { aliasOf: 'Northwind' }));

    expect(linked.created).toBe(canonical.created);
    expect(linked.model).toBe(MODEL);
    expect(Date.parse(linked.updated)).toBeGreaterThanOrEqual(Date.parse(canonical.updated));
    expect(linked.modelAt).toBe(linked.updated);
  });

  it('adds an alias once, however many times it is proposed', () => {
    const { registry } = fresh();
    registry.resolve(ref('Northwind'));

    registry.resolve(ref('North', { aliasOf: 'Northwind' }));
    const again = registry.resolve(ref('NORTH', { aliasOf: 'Northwind' }));

    expect(again.aliases).toEqual(['North']);
  });

  it('does not record the canonical name as an alias of itself', () => {
    const { registry } = fresh();
    registry.resolve(ref('Northwind'));

    const same = registry.resolve(ref('northwind', { aliasOf: 'Northwind' }));

    expect(same.aliases).toEqual([]);
  });

  it('mints a SEPARATE referent when the named canonical is unknown, and never links', () => {
    const { store, registry, events } = fresh();
    // A populated registry, because the bug this guards against is a link to
    // whatever happens to be nearest. On an empty one there is nothing to
    // wrongly link to, and the test would pass while the rule was broken.
    registry.resolve(ref('Dad'));

    const minted = registry.resolve(ref('North', { aliasOf: 'Northwind' }));

    // An unresolvable alias must never become a silent link: the proposal is
    // dropped, on the record, and the name stands on its own.
    expect(minted.slug).toBe('north');
    expect(minted.aliases).toEqual([]);
    expect(store.listReferents().map((r) => r.slug).sort()).toEqual(['dad', 'north']);
    expect(store.listReferents().every((r) => r.aliases.length === 0)).toBe(true);
    const dropped = events.filter((e) => e.kind === 'referent-alias-unresolved');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.detail).toContain('Northwind');
  });

  it('REFUSES to alias a name that is already a referent of its own — that is a merge', () => {
    const { store, registry, events } = fresh();
    const north = registry.resolve(ref('North'));
    const northwind = registry.resolve(ref('Northwind'));

    const returned = registry.resolve(ref('North', { aliasOf: 'Northwind' }));

    // Folding one existing entry into another IS tier 3, whatever it is
    // called at the call site. Both entries survive, unlinked, and the
    // proposal becomes a note for a human (Q-32).
    expect(returned).toEqual(north);
    expect(store.listReferents()).toHaveLength(2);
    expect(registry.lookup('North')?.slug).toBe('north');
    expect(registry.lookup('Northwind')?.slug).toBe('northwind');
    expect(store.listReferents().find((r) => r.slug === northwind.slug)!.aliases).toEqual([]);
    const refused = events.filter((e) => e.kind === 'referent-alias-refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.detail).toContain('north');
    expect(refused[0]!.detail).toContain('northwind');
  });

  it('keeps the stored kind when a later reference proposes a different one', () => {
    const { registry, events } = fresh();
    registry.resolve(ref('Field Guild', { kind: 'project' }));

    const again = registry.resolve(ref('Field Guild', { kind: 'place' }));

    // Rewriting the kind is a re-reading of an entity the user already
    // described. The disagreement goes on the record instead.
    expect(again.kind).toBe('project');
    expect(events.filter((e) => e.kind === 'referent-kind-differs')).toHaveLength(1);
  });
});

describe('tier 3 — MERGE: there is no path to it, at any level (Q-32)', () => {
  it('exposes exactly four methods, and none of them is a merge', () => {
    const { registry } = fresh();

    expect(Object.keys(registry).sort()).toEqual([
      'claimsFor',
      'lookup',
      'mergeCandidates',
      'resolve',
    ]);
    // @ts-expect-error — there is no `merge`, and that absence is the contract
    // (Q-32). This line goes red the day someone adds one.
    expect(() => registry.merge('north', 'northwind')).toThrow();
  });

  it('exports nothing whose name promises a merge', () => {
    const exported = Object.keys(registryModule).filter((k) => /merge/i.test(k));

    expect(exported).toEqual([]);
  });

  it('never reduces the referent count across a randomized sequence of 50 resolves', () => {
    const { store, registry } = fresh();
    const names = ['North', 'Northwind', 'Sarah Kim', 'sarah kim', 'Dad', 'Field Guild', 'my manager'];
    const kinds = ['person', 'project', 'place', 'pole', 'construct', 'other'] as const;

    // Seeded, so a failure is reproducible rather than a story about a run.
    let seed = 0x9e3779b9;
    const rand = (n: number): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };

    let count = store.listReferents().length;
    for (let i = 0; i < 50; i++) {
      const name = names[rand(names.length)]!;
      const kind = kinds[rand(kinds.length)]!;
      const aliasOf = rand(3) === 0 ? names[rand(names.length)]! : undefined;
      registry.resolve({ name, kind, ...(aliasOf !== undefined ? { aliasOf } : {}) });

      const now = store.listReferents().length;
      expect(now).toBeGreaterThanOrEqual(count);
      count = now;
    }
    expect(count).toBeGreaterThan(0);
  });

  it('never deletes a registry file', () => {
    const { registry } = fresh();
    registry.resolve(ref('North'));
    registry.resolve(ref('Northwind'));
    const before = registryFiles();

    registry.resolve(ref('North', { aliasOf: 'Northwind' }));
    registry.resolve(ref('Northwind', { aliasOf: 'North' }));

    expect(registryFiles()).toEqual(before);
  });
});

describe('mergeCandidates — pairs to look at, and nothing else (Q-35 shadow)', () => {
  const pairGraph = (): ClaimGraph => {
    const { registry, store } = fresh();
    registry.resolve(ref('Sarah Kim'));
    registry.resolve(ref('kim, SARAH'));
    return graphOf({ referents: store.listReferents() });
  };

  it('logs the pair it would surface and returns nothing while the threshold is shadowed', () => {
    const g = pairGraph();
    const { registry, events } = fresh();

    expect(registry.mergeCandidates(g)).toEqual([]);
    const shadow = events.filter((e) => e.kind === 'shadow-decision');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.detail).toContain('registry.mergeCandidateSimilarity');
    expect(shadow[0]!.detail).toContain('sarah-kim');
    expect(shadow[0]!.detail).toContain('kim-sarah');
  });

  it('returns the pair on the SAME referents once the threshold is live', () => {
    // Half two of the shadow proof: the mechanism does fire, and it is the
    // register alone that withholds it.
    const g = pairGraph();
    const { registry } = fresh({ thresholds: MERGE_LIVE });

    const pairs = registry.mergeCandidates(g);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.map((r) => r.slug)).toEqual(['kim-sarah', 'sarah-kim']);
  });

  it('mutates nothing it is given, and writes no file', () => {
    const g = pairGraph();
    const before = structuredClone(g);
    const { registry } = fresh({ thresholds: MERGE_LIVE });
    const filesBefore = registryFiles();

    registry.mergeCandidates(g);

    expect(g).toEqual(before);
    expect(registryFiles()).toEqual(filesBefore);
  });

  it('leaves unrelated and partly-overlapping names alone', () => {
    const { registry: writer, store } = fresh();
    writer.resolve(ref('Sarah Kim'));
    writer.resolve(ref('Dad'));
    writer.resolve(ref('Sarah'));
    const g = graphOf({ referents: store.listReferents() });
    const { registry, events } = fresh({ thresholds: MERGE_LIVE });

    // "Sarah" against "Sarah Kim" is one shared token of two — far under the
    // bar, and deliberately so: deciding two spellings are one person is
    // inference about identity, and Q-32 keeps inference out of identity.
    expect(registry.mergeCandidates(g)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('is deterministic and returns the same pairs on a second call', () => {
    const g = pairGraph();
    const { registry } = fresh({ thresholds: MERGE_LIVE });

    expect(registry.mergeCandidates(g)).toEqual(registry.mergeCandidates(g));
  });

  it('agrees with the lint finding it duplicates (T8)', () => {
    // `lint` computes the same relation over the same data, because its
    // signature takes a graph and not a registry. The duplication cannot be
    // removed from here; it CAN be made detectable, so this test is what goes
    // red the day the two drift. If they ever disagree, lint's is the note the
    // user sees (see the header of src/wiki/lint.ts).
    const { registry: writer, store } = fresh();
    for (const name of ['Sarah Kim', 'kim, SARAH', 'Dad', 'dad!', 'Field Guild', 'Sarah']) {
      writer.resolve(ref(name));
    }
    const g = graphOf({ referents: store.listReferents() });
    const { registry } = fresh({ thresholds: MERGE_LIVE });
    const { log } = collector();

    const key = (slugs: string[]): string => [...slugs].sort().join('|');
    const mine = registry.mergeCandidates(g).map(([a, b]) => key([a.slug, b.slug]));
    // lint notes BOTH entries, so each pair arrives twice, once per subject.
    const theirs = [
      ...new Set(
        lint(g, MERGE_LIVE, log)
          .filter((f) => f.kind === 'merge-candidate')
          .map((f) => key(f.refs)),
      ),
    ];

    expect(mine).toHaveLength(2);
    expect(theirs.sort()).toEqual(mine.sort());
  });
});

describe('nameSimilarity — pure string work, no model, ever (Q-32)', () => {
  it('scores reordered and repunctuated names alike, and unrelated names apart', () => {
    expect(nameSimilarity('Sarah Kim', 'kim, SARAH')).toBe(1);
    expect(nameSimilarity('The Bakery', 'the bakery ')).toBe(1);
    expect(nameSimilarity('Sarah Kim', 'Sarah')).toBeCloseTo(0.5);
    expect(nameSimilarity('Mum', 'Mother')).toBe(0);
    expect(nameSimilarity('', 'Dad')).toBe(0);
  });

  it('names no model type anywhere in the module', () => {
    // The @ts-expect-error below holds the signature shut; this holds the whole
    // file shut, including an export added later. A similarity function that
    // can call a model is an inference about identity (Q-32).
    const source = readFileSync(join(import.meta.dirname, '../src/wiki/registry.ts'), 'utf-8');

    expect(source).not.toMatch(/\bComplete\b/);
    expect(source).not.toMatch(/\bcomplete\s*\(/);
    expect(source).not.toMatch(/from '\.\.\/llm\.js'/);
  });

  it('takes two strings and nothing else', () => {
    const noModel: Complete = async () => '';

    // @ts-expect-error — there is no third parameter.
    expect(nameSimilarity('Dad', 'Dad', noModel)).toBe(1);
  });

  it('cannot be handed a model at construction either', () => {
    const noModel: Complete = async () => '';
    const store = createClaimStore(root);
    const { log } = collector();

    // @ts-expect-error — there is no fifth parameter.
    createRegistry(store, MODEL, log, THRESHOLDS, noModel);
  });
});

describe('claimsFor', () => {
  it('returns the claims naming the slug, in graph order, and nothing else', () => {
    const { registry } = fresh();
    const g = graphOf({
      claims: [
        claim('c1', ['northwind']),
        claim('c2', ['field-guild']),
        claim('c3', ['field-guild', 'northwind']),
      ],
    });

    expect(registry.claimsFor('northwind', g).map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(registry.claimsFor('field-guild', g).map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(registry.claimsFor('nobody', g)).toEqual([]);
  });

  it('mutates nothing', () => {
    const { registry } = fresh();
    const g = graphOf({ claims: [claim('c1', ['northwind'])] });
    const before = structuredClone(g);

    registry.claimsFor('northwind', g);

    expect(g).toEqual(before);
  });
});
