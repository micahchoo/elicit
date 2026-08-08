import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EMBEDDING_WINDOW,
  bodyHash,
  cosine,
  embeddingChannel,
  fileEmbeddingStore,
  type Embed,
  type EmbeddingIndexStore,
  type EmbeddingRecord,
} from '../src/wiki/embedding.js';
import type { Claim, ClaimGraph, LogFn } from '../src/wiki/contract.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { Threshold } from '../src/domain/thresholds.js';
import { PAIRS, DISTRACTORS } from './fixtures/paraphrase-pairs.js';

/**
 * The embedding channel — Q-30 stage 1's third channel, Q-17's staged hybrid.
 *
 * Every test here runs on a scripted fake `Embed`. **No test in this file
 * reaches the network** (ADR-0001/Q-2 forbids a hosted call, and a test that
 * needs a live model server is red on every machine without one). The one
 * integration path — `localEmbedder` — is asserted structurally at the bottom
 * and never called.
 *
 * The live-endpoint measurement that the plan's Step 2 asks for is recorded as
 * a comment beside the fixture recall test below: evidence, not an assertion.
 */

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

function graph(claims: Claim[]): ClaimGraph {
  return { claims, snippets: {}, readings: {}, contradictions: [], referents: [] };
}

function recorder(): { log: LogFn; kinds: () => string[]; details: (kind: string) => string[] } {
  const events: { kind: string; detail: string }[] = [];
  return {
    log: (e) => {
      events.push({ kind: e.kind, detail: e.detail });
    },
    kinds: () => events.map((e) => e.kind),
    details: (kind) => events.filter((e) => e.kind === kind).map((e) => e.detail),
  };
}

/** An in-memory `EmbeddingIndexStore`, so a second channel can share one cache. */
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

/**
 * A scripted embedder. `table` maps a claim body to its vector; anything absent
 * gets a fixed orthogonal vector, so an unscripted body never accidentally
 * looks similar to a scripted one.
 */
function scripted(table: Record<string, number[]>): { embed: Embed; batches: string[][]; texts: () => string[] } {
  const batches: string[][] = [];
  return {
    batches,
    texts: () => batches.flat(),
    embed: async (texts) => {
      batches.push([...texts]);
      return texts.map((t) => table[t] ?? [0, 0, 1]);
    },
  };
}

/** Unit vectors in the plane: the cosine between two of them is cos(a − b). */
function ray(radians: number): number[] {
  return [Math.cos(radians), Math.sin(radians), 0];
}

/** A live copy of the shipped threshold — the seam that tests the live branch. */
function liveAt(value: number): Threshold {
  return { name: 'clash.embeddingCosine', value, live: true, graduatesWhen: 'test seam' };
}

// ── The gate: shadow now, live later ──

describe('the cosine gate', () => {
  const CLOSE = { a: ray(0), b: ray(0.25) }; // cos 0.25 ≈ 0.969
  const FAR = { a: ray(0), b: ray(1.2) }; //  cos 1.2 ≈ 0.362

  it('proposes a pair whose cosine clears a LIVE threshold', async () => {
    const { log } = recorder();
    const fake = scripted({ near: CLOSE.a, alsoNear: CLOSE.b });
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      threshold: liveAt(0.82),
    });
    const g = graph([claim('c-a', 'near'), claim('c-b', 'alsoNear')]);
    await ch.prime(g);

    expect(ch.candidates(g).map((p) => p.map((c) => c.id))).toEqual([['c-a', 'c-b']]);
  });

  it('proposes nothing for a pair below the threshold', async () => {
    const { log } = recorder();
    const fake = scripted({ near: FAR.a, apart: FAR.b });
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      threshold: liveAt(0.82),
    });
    const g = graph([claim('c-a', 'near'), claim('c-b', 'apart')]);
    await ch.prime(g);

    expect(ch.candidates(g)).toEqual([]);
  });

  it('returns NOTHING when the threshold is explicitly in shadow, and names the pair it would have pooled', async () => {
    const { log, details } = recorder();
    const fake = scripted({ near: CLOSE.a, alsoNear: CLOSE.b });
    // Explicit live:false — the shipped register graduated this threshold
    // (ticket 118), so the demotion path is only testable by injection.
    const ch = embeddingChannel({
      embed: fake.embed, model: 'fake-embed', store: memStore(), log,
      threshold: { name: 'clash.embeddingCosine', value: 0.5, live: false, graduatesWhen: 'demotion path' },
    });
    const g = graph([claim('c-a', 'near'), claim('c-b', 'alsoNear')]);
    await ch.prime(g);

    expect(ch.candidates(g)).toEqual([]);
    const shadow = details('shadow-decision');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]).toContain('clash.embeddingCosine');
    expect(shadow[0]).toContain('c-a');
    expect(shadow[0]).toContain('c-b');
    // Ticket 083: the shadow record also states whether the pair joins two
    // sittings — ticket 007's watch-item, on the line that graduates the channel.
    expect(shadow[0]).toContain('joinsTwoSittings=');
  });

  it('ships live — graduated by its own shadow record (2026-08-03)', () => {
    // Ticket 118: 5,154 shadow records, 2,845 cross-sitting pairs on the real
    // vault earned it. The test below (demotion path) keeps the shadow path alive
    // by injecting live:false explicitly.
    expect(THRESHOLDS['clash.embeddingCosine'].live).toBe(true);
  });

  it('pools NOTHING when the threshold is not a number — a misconfiguration fails closed', async () => {
    const { log } = recorder();
    const fake = scripted({ near: CLOSE.a, alsoNear: CLOSE.b });
    // `Threshold.value` admits a boolean, because two register entries are
    // switches. A cosine gate handed one has no cut, and the safe reading of
    // "no cut" is "admit nothing", never "admit everything".
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      threshold: { name: 'clash.embeddingCosine', value: true, live: true, graduatesWhen: 'test seam' },
    });
    const g = graph([claim('c-a', 'near'), claim('c-b', 'alsoNear')]);
    await ch.prime(g);

    expect(ch.candidates(g)).toEqual([]);
  });

  it('logs no shadow line for a pair that never cleared the cosine', async () => {
    const { log, details } = recorder();
    const fake = scripted({ near: FAR.a, apart: FAR.b });
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store: memStore(), log });
    const g = graph([claim('c-a', 'near'), claim('c-b', 'apart')]);
    await ch.prime(g);
    ch.candidates(g);

    // The shadow record is what T16 reads to set the real number. A line for
    // every pair the channel merely looked at would bury it.
    expect(details('shadow-decision')).toEqual([]);
  });
});

// ── The cache: derived, rebuildable, never truth (Q-3) ──

describe('the vector cache', () => {
  it('does not re-embed a claim whose body is unchanged', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.25) });
    const store = memStore();
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log });
    const g = graph([claim('c-a', 'one'), claim('c-b', 'two')]);

    await ch.prime(g);
    await ch.prime(g);

    expect(fake.texts()).toEqual(['one', 'two']);
  });

  it('re-embeds a claim whose body changed', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.25), rewritten: ray(0.1) });
    const store = memStore();
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log });

    await ch.prime(graph([claim('c-a', 'one'), claim('c-b', 'two')]));
    await ch.prime(graph([claim('c-a', 'rewritten'), claim('c-b', 'two')]));

    expect(fake.texts()).toEqual(['one', 'two', 'rewritten']);
  });

  it('never lets a stale vector speak for a rewritten body', async () => {
    const { log } = recorder();
    // The cached vector for `c-a` sits right beside `c-b`; the new body does
    // not. A cache keyed on the id alone would pool them anyway.
    const store = memStore([
      { claimId: 'c-a', hash: bodyHash('one'), model: 'fake-embed', vector: ray(0) },
      { claimId: 'c-b', hash: bodyHash('two'), model: 'fake-embed', vector: ray(0.1) },
    ]);
    const fake = scripted({}); // every fresh embed fails to match anything
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store,
      log,
      threshold: liveAt(0.82),
    });

    expect(ch.candidates(graph([claim('c-a', 'rewritten'), claim('c-b', 'two')]))).toEqual([]);
  });

  it('re-embeds when the embedding MODEL changed — 4096 dims never meet 768', async () => {
    const { log } = recorder();
    const store = memStore([
      { claimId: 'c-a', hash: bodyHash('one'), model: 'old-embed', vector: ray(0) },
    ]);
    const fake = scripted({ one: ray(0) });
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log });

    await ch.prime(graph([claim('c-a', 'one')]));

    expect(fake.texts()).toEqual(['one']);
  });

  it('the cache survives a fresh channel instance', async () => {
    const { log } = recorder();
    const store = memStore();
    const g = graph([claim('c-a', 'one'), claim('c-b', 'two')]);

    const first = scripted({ one: ray(0), two: ray(0.25) });
    await embeddingChannel({ embed: first.embed, model: 'fake-embed', store, log }).prime(g);

    const second = scripted({ one: ray(0), two: ray(0.25) });
    const later = embeddingChannel({ embed: second.embed, model: 'fake-embed', store, log, threshold: liveAt(0.82) });
    await later.prime(g);

    expect(second.texts()).toEqual([]);
    expect(later.candidates(g).map((p) => p.map((c) => c.id))).toEqual([['c-a', 'c-b']]);
  });

  it('pairs from a warm cache without ever calling prime', () => {
    const { log } = recorder();
    const store = memStore([
      { claimId: 'c-a', hash: bodyHash('one'), model: 'fake-embed', vector: ray(0) },
      { claimId: 'c-b', hash: bodyHash('two'), model: 'fake-embed', vector: ray(0.25) },
    ]);
    const fake = scripted({});
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store,
      log,
      threshold: liveAt(0.82),
    });

    // `ClashChannel.candidates` is synchronous, so a cold process with a warm
    // cache still pools. Nothing here touches the network.
    expect(ch.candidates(graph([claim('c-a', 'one'), claim('c-b', 'two')]))).toHaveLength(1);
    expect(fake.batches).toEqual([]);
  });

  it('drops the vectors of claims the graph no longer holds', async () => {
    const { log } = recorder();
    const store = memStore([
      { claimId: 'gone', hash: 'x', model: 'fake-embed', vector: ray(0) },
    ]);
    const fake = scripted({ one: ray(0) });
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log });

    await ch.prime(graph([claim('c-a', 'one')]));

    expect(store.rows.map((r) => r.claimId)).toEqual(['c-a']);
  });
});

// ── Ticket 067: the second prime of a run, narrowed to what the run added ──

describe('priming only what a run added', () => {
  /**
   * The narrowing exists because `runWikiJobs` now primes twice: once before
   * the run over the whole graph, once after the sweep over the claims the
   * sweep minted. The second call must not pay for the first one again, and —
   * the sharper half — it must not PRUNE what the first one wrote.
   */

  it('embeds only the ids it was narrowed to', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.05), three: ray(0.1) });
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store: memStore(), log });
    const g = graph([claim('c-a', 'one'), claim('c-b', 'two'), claim('c-c', 'three')]);

    await ch.prime(g, ['c-c']);

    expect(fake.texts()).toEqual(['three']);
  });

  it('keeps every vector the whole-graph prime already wrote', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.05), three: ray(0.1) });
    const store = memStore();
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store,
      log,
      threshold: liveAt(0.82),
    });
    const before = graph([claim('c-a', 'one'), claim('c-b', 'two')]);
    await ch.prime(before);

    // The sweep added `c-c`. Narrowing by handing prime a SUBSET GRAPH would
    // make `persist` prune `c-a` and `c-b` — ticket 053's deletion, arriving
    // through a different door.
    const after = graph([claim('c-a', 'one'), claim('c-b', 'two'), claim('c-c', 'three')]);
    await ch.prime(after, ['c-c']);

    expect(fake.texts()).toEqual(['one', 'two', 'three']);
    expect(store.rows.map((r) => r.claimId)).toEqual(['c-a', 'c-b', 'c-c']);
    expect(ch.candidates(after)).toHaveLength(3);
  });

  it('drops the vector of a claim the same run superseded, and keeps the untouched one', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.05), three: ray(0.1) });
    const store = memStore();
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log });
    await ch.prime(graph([claim('c-a', 'one'), claim('c-b', 'two')]));

    // Job 1 superseded `c-a` with `c-new` and left `c-b` alone. The superseded
    // claim is never pooled again, so its vector buys nothing; `c-b`'s is still
    // live and must survive the same call.
    const after = graph([
      claim('c-a', 'one', { supersededBy: 'c-new', supersedeReason: 'the person changed' }),
      claim('c-b', 'two'),
      claim('c-new', 'three'),
    ]);
    await ch.prime(after, ['c-new']);

    expect(store.rows.map((r) => r.claimId)).toEqual(['c-b', 'c-new']);
  });

  it('embeds nothing, and prunes nothing, when the narrowing names no claim', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.05) });
    const store = memStore();
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log });
    const g = graph([claim('c-a', 'one'), claim('c-b', 'two')]);
    await ch.prime(g);

    const after = graph([claim('c-a', 'one'), claim('c-b', 'two'), claim('c-gone', 'three')]);
    await ch.prime(after, []);

    expect(fake.texts()).toEqual(['one', 'two']);
    expect(store.rows.map((r) => r.claimId)).toEqual(['c-a', 'c-b']);
  });

  it('ignores an id the graph does not hold', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0) });
    const store = memStore();
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log });

    await ch.prime(graph([claim('c-a', 'one')]), ['c-a', 'no-such-claim']);

    expect(fake.texts()).toEqual(['one']);
    expect(store.rows.map((r) => r.claimId)).toEqual(['c-a']);
  });

  it('never reaches outside the recency window, whatever ids it is given', async () => {
    const { log } = recorder();
    const fake = scripted({ old: ray(0), fresh: ray(0.05) });
    const store = memStore();
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store, log, window: 1 });
    const g = graph([
      claim('c-old', 'old', { updated: '2026-01-01T00:00:00.000Z' }),
      claim('c-fresh', 'fresh', { updated: '2026-08-01T00:00:00.000Z' }),
    ]);

    // The bound is a bound (Q-56): naming a clipped claim does not buy it in.
    await ch.prime(g, ['c-old']);

    expect(fake.texts()).toEqual([]);
  });

  it('still primes the whole window when no ids are given', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.05) });
    const ch = embeddingChannel({ embed: fake.embed, model: 'fake-embed', store: memStore(), log });

    await ch.prime(graph([claim('c-a', 'one'), claim('c-b', 'two')]));

    expect(fake.texts()).toEqual(['one', 'two']);
  });
});

describe('the cache FILE is derived, and a broken one costs one re-embed', () => {
  function tmpVault(): string {
    return mkdtempSync(join(tmpdir(), 'elicit-embed-'));
  }

  it('reads an absent file as an empty cache', () => {
    expect(fileEmbeddingStore(tmpVault()).load()).toEqual([]);
  });

  it('round-trips through vault/wiki/embeddings.jsonl', () => {
    const root = tmpVault();
    const store = fileEmbeddingStore(root);
    const rows: EmbeddingRecord[] = [
      { claimId: 'c-a', hash: 'h1', model: 'm', vector: [1, 0, 0] },
      { claimId: 'c-b', hash: 'h2', model: 'm', vector: [0, 1, 0] },
    ];
    store.save(rows);

    expect(readFileSync(join(root, 'wiki', 'embeddings.jsonl'), 'utf-8').trim().split('\n')).toHaveLength(2);
    expect(store.load()).toEqual(rows);
  });

  it('skips a torn line and keeps the rest, rather than throwing', () => {
    const root = tmpVault();
    mkdirSync(join(root, 'wiki'), { recursive: true });
    writeFileSync(
      join(root, 'wiki', 'embeddings.jsonl'),
      [
        JSON.stringify({ claimId: 'c-a', hash: 'h1', model: 'm', vector: [1, 0, 0] }),
        '{"claimId":"c-b","hash":"h2","model":"m","vecto',
        '',
        JSON.stringify({ claimId: 'c-c', hash: 'h3', model: 'm', vector: [0, 0, 1] }),
      ].join('\n'),
      'utf-8',
    );

    expect(fileEmbeddingStore(root).load().map((r) => r.claimId)).toEqual(['c-a', 'c-c']);
  });

  it('refuses a well-formed line of the wrong shape', () => {
    const root = tmpVault();
    mkdirSync(join(root, 'wiki'), { recursive: true });
    writeFileSync(
      join(root, 'wiki', 'embeddings.jsonl'),
      [
        JSON.stringify({ claimId: 'c-a', hash: 'h1', model: 'm', vector: ['not', 'numbers'] }),
        JSON.stringify({ claimId: 'c-b', hash: 'h2', model: 'm' }),
        JSON.stringify({ claimId: 'c-c', hash: 'h3', model: 'm', vector: [1, 2] }),
      ].join('\n'),
      'utf-8',
    );

    expect(fileEmbeddingStore(root).load().map((r) => r.claimId)).toEqual(['c-c']);
  });

  it('a channel over a corrupt file rebuilds it instead of crashing', async () => {
    const root = tmpVault();
    mkdirSync(join(root, 'wiki'), { recursive: true });
    writeFileSync(join(root, 'wiki', 'embeddings.jsonl'), 'not json at all\n{{{\n', 'utf-8');
    const { log } = recorder();
    const fake = scripted({ one: ray(0) });
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: fileEmbeddingStore(root),
      log,
    });

    await ch.prime(graph([claim('c-a', 'one')]));

    expect(fileEmbeddingStore(root).load().map((r) => r.claimId)).toEqual(['c-a']);
  });
});

// ── A dead endpoint is a skipped channel, not a failed run ──

describe('when the embedding server is not there', () => {
  const dead: Embed = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  it('yields zero pairs, one embedding-unavailable line, and no throw', async () => {
    const { log, kinds, details } = recorder();
    const ch = embeddingChannel({ embed: dead, model: 'fake-embed', store: memStore(), log });
    const g = graph([claim('c-a', 'one'), claim('c-b', 'two')]);

    await expect(ch.prime(g)).resolves.toBeUndefined();

    expect(ch.candidates(g)).toEqual([]);
    expect(kinds().filter((k) => k === 'embedding-unavailable')).toHaveLength(1);
    expect(details('embedding-unavailable')[0]).toContain('ECONNREFUSED');
  });

  it('keeps the vectors it already had', async () => {
    const { log } = recorder();
    const store = memStore([
      { claimId: 'c-a', hash: bodyHash('one'), model: 'fake-embed', vector: ray(0) },
      { claimId: 'c-b', hash: bodyHash('two'), model: 'fake-embed', vector: ray(0.25) },
    ]);
    const ch = embeddingChannel({
      embed: dead,
      model: 'fake-embed',
      store,
      log,
      threshold: liveAt(0.82),
    });
    const g = graph([claim('c-a', 'one'), claim('c-b', 'two'), claim('c-c', 'brand new')]);

    await ch.prime(g);

    expect(ch.candidates(g)).toHaveLength(1);
  });

  it('treats a short vector list as unavailable rather than mis-keying the cache', async () => {
    const { log, details } = recorder();
    const store = memStore();
    const truncating: Embed = async (texts) => texts.slice(1).map(() => ray(0));
    const ch = embeddingChannel({ embed: truncating, model: 'fake-embed', store, log });

    await ch.prime(graph([claim('c-a', 'one'), claim('c-b', 'two')]));

    // Zipping a short list back onto the inputs would file `c-b`'s vector under
    // `c-a` — a wrong vector is worse than a missing one, because nothing later
    // can tell it is wrong.
    expect(details('embedding-unavailable')).toHaveLength(1);
    expect(store.rows).toEqual([]);
    // And it says the SERVER broke the count contract, not that one claim came
    // back empty. Those are different faults with different fixes, and the log
    // line is the only place the difference survives.
    expect(details('embedding-unavailable')[0]).toContain('expected 2 vectors, received 1');
  });

  it('keeps the batches that succeeded when a later batch dies', async () => {
    const { log, details } = recorder();
    const store = memStore();
    let call = 0;
    const flaky: Embed = async (texts) => {
      call++;
      if (call > 1) throw new Error('gone');
      return texts.map(() => ray(0));
    };
    const claims = Array.from({ length: 40 }, (_, i) => claim(`c-${String(i).padStart(2, '0')}`, `body ${i}`));
    const ch = embeddingChannel({ embed: flaky, model: 'fake-embed', store, log });

    await ch.prime(graph(claims));

    expect(details('embedding-unavailable')).toHaveLength(1);
    expect(store.rows.length).toBeGreaterThan(0);
    expect(store.rows.length).toBeLessThan(claims.length);
  });
});

// ── What the channel refuses to look at ──

describe('liveness and shape', () => {
  it('never pairs an archived or a superseded claim', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0), two: ray(0.05), three: ray(0.1) });
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      threshold: liveAt(0.82),
    });
    const g = graph([
      claim('c-a', 'one'),
      claim('c-b', 'two', { archived: true }),
      claim('c-c', 'three', { supersededBy: 'c-d' }),
    ]);
    await ch.prime(g);

    expect(ch.candidates(g)).toEqual([]);
    expect(fake.texts()).toEqual(['one']);
  });

  it('never pairs a claim with itself', async () => {
    const { log } = recorder();
    const fake = scripted({ one: ray(0) });
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      threshold: liveAt(0.82),
    });
    const g = graph([claim('c-a', 'one')]);
    await ch.prime(g);

    expect(ch.candidates(g)).toEqual([]);
  });

  it('returns the same pairs in the same order when the graph arrives shuffled', async () => {
    const { log } = recorder();
    const table: Record<string, number[]> = {};
    const claims: Claim[] = [];
    for (let i = 0; i < 6; i++) {
      const body = `body ${i}`;
      table[body] = ray(i * 0.08);
      claims.push(claim(`c-${i}`, body));
    }
    const store = memStore();
    const ch = embeddingChannel({
      embed: scripted(table).embed,
      model: 'fake-embed',
      store,
      log,
      threshold: liveAt(0.82),
    });
    await ch.prime(graph(claims));

    const forward = ch.candidates(graph(claims)).map((p) => `${p[0].id}+${p[1].id}`);
    const backward = ch.candidates(graph([...claims].reverse())).map((p) => `${p[0].id}+${p[1].id}`);

    expect(forward.length).toBeGreaterThan(0);
    expect(backward).toEqual(forward);
  });

  it('is named embedding, which is the name the candidate record carries', () => {
    const { log } = recorder();
    expect(
      embeddingChannel({ embed: scripted({}).embed, model: 'm', store: memStore(), log }).name,
    ).toBe('embedding');
  });
});

// ── The quadratic bound (Q-56: a bound is live, and owes a record) ──

describe('the recency window', () => {
  function manyClaims(n: number): Claim[] {
    return Array.from({ length: n }, (_, i) =>
      claim(`c-${String(i).padStart(3, '0')}`, `body ${i}`, {
        updated: `2026-0${1 + (i % 8)}-01T00:00:00.000Z`,
      }),
    );
  }

  it('ships a window by default', () => {
    expect(EMBEDDING_WINDOW).toBeGreaterThan(0);
  });

  it('clips to the most recently updated claims and logs what fell outside', () => {
    const { log, details } = recorder();
    const store = memStore();
    const ch = embeddingChannel({
      embed: scripted({}).embed,
      model: 'fake-embed',
      store,
      log,
      window: 4,
    });

    ch.candidates(graph(manyClaims(10)));

    const clip = details('clash-embedding-clipped');
    expect(clip).toHaveLength(1);
    expect(clip[0]).toContain('window=4');
    expect(clip[0]).toContain('clipped=6');
  });

  it('embeds only what the window holds', async () => {
    const { log } = recorder();
    const fake = scripted({});
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      window: 4,
    });

    await ch.prime(graph(manyClaims(10)));

    expect(fake.texts()).toHaveLength(4);
  });

  it('logs no clip when every live claim is inside the window', () => {
    const { log, details } = recorder();
    const ch = embeddingChannel({
      embed: scripted({}).embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      window: 4,
    });

    ch.candidates(graph(manyClaims(4)));

    expect(details('clash-embedding-clipped')).toEqual([]);
  });

  it('keeps the freshest claim inside the window, so new material is never starved', async () => {
    const { log } = recorder();
    const fake = scripted({});
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      window: 2,
    });
    const old = claim('c-old', 'old body', { updated: '2020-01-01T00:00:00.000Z' });
    const fresh = claim('c-new', 'new body', { updated: '2026-08-01T00:00:00.000Z' });
    const mid = claim('c-mid', 'mid body', { updated: '2024-01-01T00:00:00.000Z' });

    await ch.prime(graph([old, fresh, mid]));

    expect(fake.texts().sort()).toEqual(['mid body', 'new body']);
  });
});

describe('the embed budget', () => {
  it('stops at the budget, logs the clip, and keeps every batch it finished', async () => {
    const { log, details } = recorder();
    const store = memStore();
    // A clock that jumps a minute per reading: batch 1 runs, then the deadline
    // has passed and batch 2 never starts.
    let t = 0;
    const now = () => (t += 60_000);
    const claims = Array.from({ length: 40 }, (_, i) => claim(`c-${String(i).padStart(2, '0')}`, `body ${i}`));
    const fake = scripted({});
    const ch = embeddingChannel({
      embed: fake.embed,
      model: 'fake-embed',
      store,
      log,
      budgetMs: 90_000,
      now,
    });

    await ch.prime(graph(claims));

    const clip = details('clash-embedding-clipped');
    expect(clip).toHaveLength(1);
    expect(clip[0]).toContain('reason=budget');
    // Resumable, which is what makes a strict budget safe: work already done is
    // on disk, and the next run continues from it.
    expect(store.rows.length).toBeGreaterThan(0);
    expect(store.rows.length).toBeLessThan(claims.length);
    expect(details('embedding-unavailable')).toEqual([]);
  });

  it('logs no budget clip when the whole pass fits', async () => {
    const { log, details } = recorder();
    const ch = embeddingChannel({
      embed: scripted({}).embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      now: () => 0,
    });

    await ch.prime(graph([claim('c-a', 'one'), claim('c-b', 'two')]));

    expect(details('clash-embedding-clipped')).toEqual([]);
  });
});

// ── Q-65: cross-sitting ranks above same-sitting (ticket 083) ──
// Same-sitting pairs are POOLED, never excluded: the embedding channel orders
// cross-sitting pairs strictly above same-sitting ones whatever their cosines,
// then cosine desc, then the sorted claim-id pair key.

describe('Q-65: cross-sitting ranks above same-sitting (ticket 083)', () => {
  function withSittings(sessions: Record<string, string[]>): ClaimGraph {
    // sessions: claimId -> the session of each snippet that claim cites.
    const claims: Claim[] = [];
    const snippets: ClaimGraph['snippets'] = {};
    for (const [claimId, list] of Object.entries(sessions)) {
      const cites: string[] = [];
      for (const [i, session] of list.entries()) {
        const snippetId = `${claimId}-s${i}`;
        cites.push(`${snippetId}@1`);
        snippets[snippetId] = {
          id: snippetId,
          version: 1,
          captured: T,
          provenance: { kind: 'harvest', session, question: 'q', questionForm: 'deliberative' },
          prose: 'irrelevant',
        };
      }
      claims.push(claim(claimId, `body ${claimId}`, { cites }));
    }
    return { claims, snippets, readings: {}, contradictions: [], referents: [] };
  }

  async function pairsOf(
    g: ClaimGraph,
    table: Record<string, number[]>,
    floor: number,
  ): Promise<string[]> {
    const { log } = recorder();
    const ch = embeddingChannel({
      embed: scripted(table).embed,
      model: 'fake-embed',
      store: memStore(),
      log,
      threshold: liveAt(floor),
    });
    await ch.prime(g);
    return ch.candidates(g).map((p) => `${p[0].id}+${p[1].id}`);
  }

  it('a 0.80 same-sitting pair ranks below a 0.60 cross-sitting pair', async () => {
    // The Q-65 fixture: c-a and c-b both draw on sitting-1 and sit 0.6435 rad
    // apart (cos ≈ 0.80, same-sitting); c-c and c-d draw on sitting-2 /
    // sitting-3 and sit 0.9273 rad apart (cos ≈ 0.60, cross-sitting). Every
    // cross-group angle is ≥ 1.85 rad, so every cross-group cosine sits below
    // the 0.5 sanity floor: exactly two pairs survive — and the 0.60 CROSS
    // pair ranks above the 0.80 same-sitting one.
    const g = withSittings({
      'c-a': ['sitting-1'],
      'c-b': ['sitting-1'],
      'c-c': ['sitting-2'],
      'c-d': ['sitting-3'],
    });
    const table = {
      'body c-a': ray(0),
      'body c-b': ray(0.6435),
      'body c-c': ray(2.5),
      'body c-d': ray(3.4273),
    };
    expect(await pairsOf(g, table, 0.5)).toEqual(['c-c+c-d', 'c-a+c-b']);
  });

  it('same-sitting pairs are pooled, never excluded — ranked below only', async () => {
    const g = withSittings({ 'c-a': ['sitting-1'], 'c-b': ['sitting-1'] });
    expect(await pairsOf(g, { 'body c-a': ray(0), 'body c-b': ray(0.05) }, 0.82)).toEqual([
      'c-a+c-b',
    ]);
  });

  it('a claim whose cites the graph cannot resolve is not treated as same-sitting', async () => {
    // Ignorance is not evidence of sameness. A claim citing a snippet the graph
    // does not hold has an EMPTY session set, and an empty set must not be read
    // as "the same sitting as everything else" — the pair is cross-sitting.
    const g = withSittings({ 'c-a': ['sitting-1'] });
    g.claims.push(claim('c-b', 'body c-b', { cites: ['nowhere@1'] }));
    expect(await pairsOf(g, { 'body c-a': ray(0), 'body c-b': ray(0.05) }, 0.82)).toEqual([
      'c-a+c-b',
    ]);
  });

  it('a claim spanning two sittings is not treated as same-sitting', async () => {
    // A claim already built from two sittings is not one thought said twice,
    // whatever the other claim cites.
    const g = withSittings({ 'c-a': ['sitting-1', 'sitting-2'], 'c-b': ['sitting-1'] });
    expect(await pairsOf(g, { 'body c-a': ray(0), 'body c-b': ray(0.05) }, 0.82)).toEqual([
      'c-a+c-b',
    ]);
  });

  it('a cosine tie resolves by the pair key, never arrival order', async () => {
    // Two pairs with the SAME cosine (cos 0.25 ≈ 0.969) at different absolute
    // angles, all four claims cross-sitting. The channel's total order must put
    // the smaller claim-id pair key first whether the graph arrives forward or
    // shuffled — a quota cut at the boundary must not depend on file order.
    const forward = withSittings({
      'c-a': ['s1'],
      'c-b': ['s2'],
      'c-c': ['s3'],
      'c-d': ['s4'],
    });
    const shuffled = withSittings({
      'c-d': ['s4'],
      'c-c': ['s3'],
      'c-b': ['s2'],
      'c-a': ['s1'],
    });
    const table = {
      'body c-a': ray(0),
      'body c-b': ray(0.25),
      'body c-c': ray(1.0),
      'body c-d': ray(1.25),
    };
    // The pair's ORIENTATION follows the window (which claim is p[0]); what the
    // tie-break promises is the same SET in the same rank order, keyed by the
    // sorted claim ids.
    const canonical = (ids: string) => ids.split('+').sort().join('+');
    const forwardRun = await pairsOf(forward, table, 0.82);
    const shuffledRun = await pairsOf(shuffled, table, 0.82);
    expect(forwardRun.map(canonical)).toEqual(['c-a+c-b', 'c-c+c-d']);
    expect(shuffledRun.map(canonical)).toEqual(forwardRun.map(canonical));
  });

  it('keeps a pair at the same rank across batch-size drift (±0.005 score)', async () => {
    // T18's batch-size nondeterminism moves a cosine by ±0.005 between runs:
    // the pair scores ≈0.600 one run and ≈0.596 the next. A threshold at 0.60
    // would pool it one run and drop it the next; a RANK never flips, so a
    // quota cut at 3 is stable where a threshold at the boundary is not. The
    // isolation angles keep every cross-group cosine below the 0.5 floor.
    const g = withSittings({
      'c-a': ['s1'],
      'c-b': ['s2'],
      'c-c': ['s3'],
      'c-d': ['s4'],
    });
    const high = {
      'body c-a': ray(0),
      'body c-b': ray(0.9273),
      'body c-c': ray(2.0),
      'body c-d': ray(2.7954),
    };
    const low = {
      'body c-a': ray(0),
      'body c-b': ray(0.9322),
      'body c-c': ray(2.0),
      'body c-d': ray(2.7954),
    };
    expect(await pairsOf(g, high, 0.5)).toEqual(['c-c+c-d', 'c-a+c-b']);
    expect(await pairsOf(g, low, 0.5)).toEqual(['c-c+c-d', 'c-a+c-b']);
  });
});

// ── cosine ──

describe('cosine', () => {
  it('is 1 for a vector against itself and 0 for an orthogonal one', () => {
    expect(cosine([3, 4, 0], [3, 4, 0])).toBeCloseTo(1, 10);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
  });

  it('ignores magnitude', () => {
    expect(cosine([1, 1, 0], [7, 7, 0])).toBeCloseTo(1, 10);
  });

  it('is 0 for a zero vector rather than NaN', () => {
    expect(cosine([0, 0, 0], [1, 0, 0])).toBe(0);
  });

  it('is 0 for vectors of different length rather than a partial sum', () => {
    // A 768-dim vector left over from nomic-embed-text must never score
    // against a 4096-dim one. The model tag on each record is the first guard;
    // this is the second.
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
  });
});

// ── Recall over the shared paraphrase fixture ──

/**
 * A deterministic bag-of-words hash embedding: 256 buckets, one increment per
 * token. It is the fake the plan asks for, and what it measures is the PLUMBING
 * — pairs in, cosines computed, gate applied — on data whose whole design is
 * disjoint vocabulary. A bag of words is a lexical method wearing a vector's
 * clothes, so the number below is expected to sit beside the lexical channel's
 * 0/8 rather than above it. That is the point: it proves the fixture is hard
 * and the harness is honest, and it leaves the real capability question to a
 * measurement against a real model, recorded in the comment beneath it.
 */
function hashEmbed(text: string, dim = 256): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const bucket = Math.abs(h) % dim;
    v[bucket] = (v[bucket] ?? 0) + 1;
  }
  return v;
}

function fixtureGraph(): ClaimGraph {
  const claims: Claim[] = [];
  for (const [i, p] of PAIRS.entries()) {
    claims.push(claim(`stored-${i}`, p.stored));
    claims.push(claim(`restated-${i}`, p.restated));
  }
  for (const [k, d] of DISTRACTORS.entries()) claims.push(claim(`distractor-${k}`, d));
  return graph(claims);
}

async function fixtureRecall(threshold: number): Promise<{ recall: number; falsePairs: number }> {
  const { log } = recorder();
  const ch = embeddingChannel({
    embed: async (texts) => texts.map((t) => hashEmbed(t)),
    model: 'hash-256',
    store: memStore(),
    log,
    threshold: liveAt(threshold),
  });
  const g = fixtureGraph();
  await ch.prime(g);
  const found = new Set(ch.candidates(g).map((p) => `${p[0].id}+${p[1].id}`));
  let recall = 0;
  for (let i = 0; i < PAIRS.length; i++) if (found.has(`restated-${i}+stored-${i}`)) recall++;
  return { recall, falsePairs: found.size - recall };
}

describe('paraphrase fixture, hash-embedding harness', () => {
  it('recalls 0/8 at the shipped threshold — a bag of words is still a lexical method', async () => {
    // The lexical channel scores 0/8 on these same pairs
    // (tests/resonance-paraphrase.test.ts, tests/wiki-clash.test.ts). This
    // number is not evidence about qwen3-embedding; it is evidence that the
    // fixture defeats vocabulary overlap, which is what makes it a fair test of
    // a real embedding model.
    const shipped = THRESHOLDS['clash.embeddingCosine'].value;
    expect(typeof shipped).toBe('number');
    // Ticket 083 lowered the register entry from 0.7 to 0.5 (the sanity floor).
    // The harness still recalls nothing — the fixture defeats vocabulary — and
    // admits exactly ONE false pair at the floor, so the 0/8 claim is the one
    // this test protects.
    expect(await fixtureRecall(shipped as number)).toEqual({ recall: 0, falsePairs: 1 });
  });

  it('recalls 0/8 at 0.50 too — a hash embedding has no path to these pairs at all', async () => {
    // Halving the cut is what buys a real model 8/8 (see the table below). It
    // buys the hash embedding nothing, which is the cleanest statement of the
    // difference between a vector space and a bucket count.
    expect((await fixtureRecall(0.5)).recall).toBe(0);
  });

  /*
   * MEASURED AGAINST THE REAL ENDPOINT — 2026-08-02. Evidence, not an
   * assertion: a committed floor read off a server that happened to be running
   * makes this suite red on every machine without one, and Step 5 requires the
   * suite green with the endpoint unreachable.
   *
   * Ollama on the local network, `qwen3-embedding` (4096-dim), the 8 PAIRS
   * and the 3 DISTRACTORS, no query/document prefixes. Negatives are every
   * cross-pair combination (restated×stored, stored×stored, restated×restated)
   * plus every text against every distractor — 160 non-pairs.
   *
   *   cut    recall   false pairs
   *   0.82     0/8       0/160     <- the guess this channel shipped against
   *   0.75     1/8       0/160
   *   0.70     3/8       0/160     <- the register's measured value
   *   0.65     3/8       3/160
   *   0.60     5/8       6/160
   *   0.50     8/8      51/160
   *
   * True pairs span 0.507–0.761; non-pairs span up to 0.695. No cut separates
   * them. 0.70 is the highest-recall cut that admits no false pair, which is
   * what makes it the number and not "tune it later": recall IS available
   * further down, at a false-positive rate that would swamp a judgment quota
   * of 3 many times over.
   *
   * Run independently of, and before reading, ticket 007's eval
   * (docs/eval-2026-08-02-embedding-channel.md), which measured the same
   * threshold sweep against a narrower 80-negative set and got the same
   * recalls. Two measurements agreeing.
   *
   * Q-52, reproduced: the nearest neighbour of pair 0's restatement is not its
   * own stored belief (0.5067) but DISTRACTORS[0], which asserts the opposite
   * belief (0.6954). Cosine cannot tell "the same belief restated" from "the
   * opposite belief restated". That is the mechanism this channel is built on,
   * and it is why nothing here tries to be polarity-aware.
   *
   * `nomic-embed-text` (768-dim) on the same run is worse everywhere: 0/8 at
   * 0.75, 2/8 at 0.70 with a false pair already admitted, 4/8 at 0.60 with 6.
   */
});

// ── The module itself ──

describe('the module', () => {
  const source = readFileSync(new URL('../src/wiki/embedding.ts', import.meta.url), 'utf-8');

  it('makes no hosted call (ADR-0001, Q-2)', () => {
    expect(source).not.toMatch(/https:\/\//);
    expect(source).not.toMatch(/api\.openai/);
    expect(source).not.toMatch(/api\.anthropic/);
  });

  it('names the local endpoint exactly once, in the one integration path', () => {
    expect(source.match(/127\.0\.0\.1/g) ?? []).toHaveLength(1);
  });

  it('calls no chat model', () => {
    expect(source).not.toMatch(/\bComplete\b/);
    expect(source).not.toMatch(/from '\.\.\/llm\.js'/);
  });

  it('reads its threshold through the register, never as a literal', () => {
    // T5's invariant: no threshold value is READ outside src/wiki/thresholds.ts.
    // Tracked against the register rather than against a number typed here, so
    // the guard survives the next re-tuning. The scan strips comments first: a
    // doc comment quoting the shipped floor (ticket 083's "SANITY FLOOR, 0.5")
    // is prose about the number, not a read of it.
    expect(source).toContain("THRESHOLDS['clash.embeddingCosine']");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const shipped = String(THRESHOLDS['clash.embeddingCosine'].value).replace('.', '\\.');
    expect(code).not.toMatch(new RegExp(`(?<![\\d.])${shipped}(?![\\d])`));
  });

  it('routes every pooling decision through shadowDecision', () => {
    // The one door. A direct read of `.live` or `.value` to decide would leave
    // no shadow record, which is the evidence the threshold graduates on.
    expect(source).toContain('shadowDecision(threshold');
  });
});
