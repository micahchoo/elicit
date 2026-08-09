import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createClaimStore } from '../src/wiki/store.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { readEvents } from '../src/log/activity.js';
import type { Claim, Contradiction } from '../src/wiki/contract.js';
import type { Facet, Snippet } from '../src/types.js';

/**
 * The wiki routes, driven through the REAL app.
 *
 * Every assertion below goes through `createApp` and `app.fetch`, never through
 * a hand-built handler, because the failure this suite exists to catch is the
 * one this campaign has shipped five times: a seam that compiles, tests green,
 * and reaches nothing. The read-log assertions read the FILE ON DISK rather
 * than the response body for the same reason.
 *
 * The response under test is the CONTEXTUALIZER (Batch B, §11): your passages
 * grouped into neighborhoods, each with a context line, the contradiction
 * exhibits, and the lens's freshness. The claim apparatus receded from the
 * surface — the claim verb routes below still exist (the /v2 personas and the
 * read-log instrument speak them), and their tests stay.
 *
 * No port is ever bound. `app.fetch` with a loopback `remoteAddr` is the whole
 * transport, so nothing here can collide with a live instance.
 */

// ── Helpers ──

const NOW = '2026-01-01T00:00:00.000Z';

async function get(app: Hono, path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  return app.fetch(new Request(`http://127.0.0.1${path}`, { headers }), {
    remoteAddr: '127.0.0.1',
  });
}

async function post(
  app: Hono,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (cookie) headers['cookie'] = cookie;
  init.headers = headers;
  return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** Counts settled background docket runs and lets a test wait for one (ticket 047). */
function docketBarrier() {
  let settled = 0;
  const waiting: (() => void)[] = [];
  return {
    onDocketSettled(): void {
      settled++;
      for (const w of waiting.splice(0)) w();
    },
    async waitFor(n: number): Promise<void> {
      while (settled < n) await new Promise<void>((r) => waiting.push(r));
    },
  };
}

function claim(id: string, facet: Facet, cites: string[], over?: Partial<Claim>): Claim {
  return {
    id,
    body: `A sentence about ${id}.`,
    range: 'in the mornings, since 2024',
    status: 'unconfirmed',
    cites,
    facet,
    referents: [],
    fromReadings: [],
    attested: false,
    readLog: [],
    model: 'test-model',
    modelAt: NOW,
    created: NOW,
    updated: NOW,
    ...over,
  };
}

/** The response shape `GET /api/wiki` answers with — the contextualizer. */
type WikiPassage = {
  id: string;
  prose: string;
  captured: string;
  question: string;
  position: number | null;
  context?: { text: string; echoes: string[]; at: string };
};

type WikiResponse = {
  neighborhoods: { name: string; passages: WikiPassage[] }[];
  contradictions: Contradiction[];
  freshness: { readThrough: string | null; sittingsBehind: number; lastSittingAt: string | null };
  lintedAt: string | null;
  all: boolean;
};

/** Every passage id on the page, in page order. */
function passageIds(body: WikiResponse): string[] {
  return body.neighborhoods.flatMap((n) => n.passages.map((p) => p.id));
}

// ── The fixture ──
//
// One vault, five snippets (the passages), and claims whose citation graph has
// a KNOWN shape — the claim vault is not deleted, its store tests survive, and
// the contradictions it carries still render as exhibits.

describe('the wiki routes', () => {
  let app: Hono;
  let dir: string;
  let store: ReturnType<typeof createClaimStore>;
  let snips: Snippet[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'elicit-wiki-routes-'));
    const vault = createVault(dir);

    // Deliberately disjoint vocabulary: the lexical clash channel pairs claims
    // that share a phrase, and a pair here would mint a re-measure and make the
    // boot docket non-deterministic.
    snips = [
      'Morning light through the kitchen window.',
      'Bicycles rust when nobody rides them.',
      'The ferry timetable changed in April.',
      'Sourdough needs a warm shelf.',
      'Telescopes disappoint children.',
    ].map((prose, i) =>
      vault.saveSnippet(prose, {
        kind: 'harvest',
        session: `s${i}`,
        question: '',
        questionForm: 'deliberative',
      }),
    );

    store = createClaimStore(dir);

    // `hub` sits on four snippets, `island` on one and alone. Coreness is
    // 2-hop snippet reach normalized against the graph max, so hub = 1 and
    // island = 1/4 — a strict order, not a tie. (The claim essay receded;
    // the vault still holds the claims, and their files still exist.)
    store.writeClaim(
      claim('hub', 'construct', [
        `${snips[0]!.id}@1`,
        `${snips[1]!.id}@1`,
        `${snips[2]!.id}@1`,
        `${snips[3]!.id}@1`,
      ]),
    );
    store.writeClaim(claim('island', 'construct', [`${snips[4]!.id}@1`]));

    // A second facet, so grouping and headings have something to group.
    store.writeClaim(claim('worth', 'value', [`${snips[0]!.id}@1`]));

    // Nothing is deleted; it is just not the default reading (Q-29).
    store.writeClaim(
      claim('gone', 'construct', [`${snips[1]!.id}@1`], {
        archived: true,
        archiveReason: 'the person said it no longer holds',
      }),
    );
    store.writeClaim(
      claim('old', 'construct', [`${snips[2]!.id}@1`], {
        supersededBy: 'hub',
        supersedeReason: 'narrowed',
      }),
    );

    const contradiction = (id: string, status: 'open' | 'dissolved'): Contradiction => ({
      id,
      type: 'diachronic',
      claims: ['hub', 'island'],
      candidate: `cand-${id}`,
      remeasureQueueId: `q-${id}`,
      evidence: { snippetRef: `${snips[0]!.id}@1`, quote: 'Morning light', side: 'a' },
      status,
      ...(status === 'dissolved' ? { dissolveReason: 'answered' } : {}),
      model: 'test-model',
      modelAt: NOW,
      opened: NOW,
      updated: NOW,
      body: 'Then: morning light.\n\nNow: telescopes disappoint.',
    });
    store.writeContradiction(contradiction('live', 'open'));
    store.writeContradiction(contradiction('settled', 'dissolved'));

    const barrier = docketBarrier();
    const queue = createQueueStore(dir);
    const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue,
      index,
      vaultRoot: dir,
      authStore: createFileAuth(join(dir, '.auth.json')),
      onDocketSettled: barrier.onDocketSettled,
    });
    // The boot docket runs the wiki jobs, which is where the lint stamp the
    // route serves comes from. Waiting for it is what makes this the real seam.
    await barrier.waitFor(1);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── GET /api/wiki — the contextualizer ──

  it('serves every passage exactly once, grouped into neighborhoods', async () => {
    const res = await get(app, '/api/wiki');
    expect(res.status).toBe(200);
    const body = (await res.json()) as WikiResponse;

    expect(body.neighborhoods.length).toBeGreaterThan(0);
    for (const n of body.neighborhoods) {
      expect(n.name).toMatch(/\S/);
      expect(n.passages.length).toBeGreaterThan(0);
    }
    const ids = passageIds(body);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    // Every snippet is on the page — the contextualizer hides nothing.
    for (const s of snips) expect(ids).toContain(s.id);
    // `all` rides the wire (the ?all=1 query echo) for the foot toggle.
    expect(body.all).toBe(false);
    const allBody = (await (await get(app, '/api/wiki?all=1')).json()) as WikiResponse;
    expect(allBody.all).toBe(true);
    expect(passageIds(allBody)).toEqual(ids);
  });

  it('carries the mechanical facts per passage — when, what asked, where it stood', async () => {
    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    const all = body.neighborhoods.flatMap((n) => n.passages);
    for (const p of all) {
      expect(p.prose).toMatch(/\S/);
      expect(Date.parse(p.captured)).not.toBeNaN();
      expect(typeof p.question).toBe('string');
      expect(p.position).toBeNull(); // no span in this fixture
      // No claim apparatus on the wire: no status, no range, no cites.
      expect((p as Record<string, unknown>).status).toBeUndefined();
      expect((p as Record<string, unknown>).range).toBeUndefined();
      expect((p as Record<string, unknown>).cites).toBeUndefined();
    }
  });

  it('renders a context line per passage once the context job has run (Batch B)', async () => {
    // B2's store, in its on-disk shape: vault/wiki/context-lines.json.
    const lines = [
      {
        passageId: snips[0]!.id,
        text: 'Said in January, after a question about the kitchen window.',
        echoes: [snips[1]!.id],
        at: '2026-01-02T00:00:00.000Z',
        model: 'test-model',
      },
    ];
    writeFileSync(join(dir, 'wiki', 'context-lines.json'), JSON.stringify(lines), 'utf-8');

    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    const first = body.neighborhoods
      .flatMap((n) => n.passages)
      .find((p) => p.id === snips[0]!.id);
    expect(first).toBeDefined();
    expect(first!.context).toEqual({
      text: 'Said in January, after a question about the kitchen window.',
      echoes: [snips[1]!.id],
      at: '2026-01-02T00:00:00.000Z',
    });
    // The model stamp stays in the store — no model name reaches the wire.
    expect(JSON.stringify(first!.context)).not.toContain('test-model');

    // The other passages have no line yet — the client renders the fallback.
    for (const n of body.neighborhoods) {
      for (const p of n.passages) {
        if (p.id !== snips[0]!.id) expect(p.context).toBeUndefined();
      }
    }

    // Restore: the store is derived state (Q-3), the next test runs clean.
    rmSync(join(dir, 'wiki', 'context-lines.json'), { force: true });
  });

  it('falls back to a deterministic lexical grouping when the neighborhoods store is empty', async () => {
    // C1's store is absent in the fresh fixture; the page must still render,
    // grouped deterministically (by provenance session) with no embedding
    // channel. Two reads are the same page.
    rmSync(join(dir, 'wiki', 'neighborhoods.json'), { force: true });
    const a = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    const b = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    expect(a.neighborhoods.map((n) => n.name)).toEqual(b.neighborhoods.map((n) => n.name));
    expect(passageIds(a)).toEqual(passageIds(b));
    expect(passageIds(a)).toHaveLength(5);
  });

  it('renders a present-but-empty store honestly — the job ran and found no themes (C1)', async () => {
    // A store with zero clusters is a fact, not a gap: the clustering job
    // ran and found no themes. The page says so instead of silently
    // re-grouping lexically as if the job had not run.
    writeFileSync(
      join(dir, 'wiki', 'neighborhoods.json'),
      JSON.stringify({ rebuiltAt: '2026-01-03T00:00:00.000Z', source: 'embedding', clusters: [] }),
      'utf-8',
    );

    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    expect(body.neighborhoods).toHaveLength(1);
    expect(body.neighborhoods[0]!.name).toBe('no themes yet');
    // Every passage still renders, exactly once — the page is your words.
    expect(passageIds(body)).toHaveLength(5);
    expect(new Set(passageIds(body)).size).toBe(5);

    rmSync(join(dir, 'wiki', 'neighborhoods.json'), { force: true });
  });

  it('serves the neighborhoods store when C1\'s job has run', async () => {
    // C1's store shape: vault/wiki/neighborhoods.json. The store wins when
    // present; leftover passages (harvested since the last rebuild) still
    // render through the lexical fallback, appended after the store's own
    // clusters so the page is always the whole corpus.
    const storeFile = {
      rebuiltAt: '2026-01-03T00:00:00.000Z',
      source: 'lexical' as const,
      clusters: [
        { name: 'the kitchen window', passageIds: [snips[0]!.id, snips[3]!.id] },
        { name: 'rust and departures', passageIds: [snips[1]!.id] },
      ],
    };
    writeFileSync(join(dir, 'wiki', 'neighborhoods.json'), JSON.stringify(storeFile), 'utf-8');

    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    const names = body.neighborhoods.map((n) => n.name);
    // The store's own clusters come first, in the store's order.
    expect(names.slice(0, 2)).toEqual(['the kitchen window', 'rust and departures']);
    const first = body.neighborhoods[0]!;
    expect(first.passages.map((p) => p.id)).toEqual([snips[0]!.id, snips[3]!.id]);
    // The two un-clustered passages (sourdough, telescopes) are not lost:
    // they render in appended fallback neighborhoods, exactly once each.
    const ids = passageIds(body);
    expect(ids).toContain(snips[2]!.id);
    expect(ids).toContain(snips[4]!.id);
    expect(new Set(ids).size).toBe(5);

    // Restore: the fallback test above must run from a clean slate.
    rmSync(join(dir, 'wiki', 'neighborhoods.json'), { force: true });
  });

  it('carries every contradiction in the default payload — the lens decides visibility (wave 5)', async () => {
    const plain = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    expect(plain.contradictions.map((c) => c.id).sort()).toEqual(['live', 'settled']);
    const settled = plain.contradictions.find((c) => c.id === 'settled');
    expect(settled!.status).toBe('dissolved');
    expect(settled!.updated).toBe(NOW);
    // The exhibit body carries the two dated poles.
    expect(plain.contradictions[0]!.body).toContain('morning light');

    const all = (await (await get(app, '/api/wiki?all=1')).json()) as WikiResponse;
    expect(all.contradictions.map((c) => c.id).sort()).toEqual(['live', 'settled']);
  });

  it('says when the wiki was last read, so silence and absence do not look alike', async () => {
    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    expect(body.lintedAt, 'the boot run left no lint stamp').toBeTypeOf('string');
  });

  it('mutates nothing — two reads leave every claim file byte-identical', async () => {
    const claimsDir = join(dir, 'wiki', 'claims');
    const before = readdirSync(claimsDir).map((f) => readFileSync(join(claimsDir, f), 'utf-8'));
    await get(app, '/api/wiki');
    await get(app, '/api/wiki?all=1');
    const after = readdirSync(claimsDir).map((f) => readFileSync(join(claimsDir, f), 'utf-8'));
    expect(after).toEqual(before);
  });

  it('leaves no shadow record behind — a read is not a decision (Q-35)', async () => {
    const before = readEvents(dir).filter((e) => e.kind === 'shadow-decision').length;
    await get(app, '/api/wiki');
    await get(app, '/api/wiki?all=1');
    const after = readEvents(dir).filter((e) => e.kind === 'shadow-decision').length;
    expect(after, 'reading the wiki wrote shadow records').toBe(before);
  });

  // ── POST /api/wiki/passage/:id/read — the contextualizer's lens instrument ──

  it('records a passage read on disk, dated, with the surface that read it (Q-21)', async () => {
    const res = await post(app, `/api/wiki/passage/${snips[0]!.id}/read`, { surface: 'wiki' });
    expect(res.status).toBe(200);

    const reads = readFileSync(join(dir, 'wiki', 'passage-reads.jsonl'), 'utf-8').trim().split('\n');
    const last = JSON.parse(reads[reads.length - 1]!) as { passageId: string; at: string; surface: string };
    expect(last.passageId).toBe(snips[0]!.id);
    expect(last.surface).toBe('wiki');
    expect(Date.parse(last.at)).not.toBeNaN();
  });

  it('answers 404 for a passage that is not there, and writes nothing', async () => {
    const res = await post(app, '/api/wiki/passage/nosuchpassage/read', { surface: 'wiki' });
    expect(res.status).toBe(404);
  });

  it('defaults the surface rather than writing undefined into the file', async () => {
    await post(app, `/api/wiki/passage/${snips[1]!.id}/read`);
    const reads = readFileSync(join(dir, 'wiki', 'passage-reads.jsonl'), 'utf-8').trim().split('\n');
    const last = JSON.parse(reads[reads.length - 1]!) as { surface: string };
    expect(last.surface).toMatch(/\S/);
  });

  // ── Wave 5: freshness (the lens's server gaps) ──

  it('ships the freshness block — read-through is the latest read, and an empty vault has no sittings', async () => {
    // The fixture has transcripts only after the next test writes them, so
    // here the census is empty and the read-through is the last recorded read.
    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    expect(body.freshness.readThrough).toBeTypeOf('string');
    expect(Date.parse(body.freshness.readThrough!)).not.toBeNaN();
    expect(body.freshness.sittingsBehind).toBe(0);
    expect(body.freshness.lastSittingAt).toBeNull();
  });

  it('freshness counts only non-import sittings started after the read-through', async () => {
    // A read through to "now", then three transcripts: one earlier, one
    // later, and one later-but-imported (the cadence's rule — a bulk import
    // is dated pieces, not someone sitting down).
    await post(app, `/api/wiki/passage/${snips[0]!.id}/read`, { surface: 'wiki' });
    const transcripts = join(dir, 'transcripts');
    mkdirSync(transcripts, { recursive: true });
    writeFileSync(
      join(transcripts, 's-before.md'),
      '---\nsession: s-before\nstarted: \'2000-01-01T00:00:00.000Z\'\nprotocol: self\n---\n',
    );
    writeFileSync(
      join(transcripts, 's-behind.md'),
      '---\nsession: s-behind\nstarted: \'2099-01-01T00:00:00.000Z\'\nprotocol: self\n---\n',
    );
    writeFileSync(
      join(transcripts, 's-import.md'),
      '---\nsession: s-import\nstarted: \'2099-02-01T00:00:00.000Z\'\nprotocol: import\n---\n',
    );

    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    expect(body.freshness.readThrough).toBeTypeOf('string');
    expect(body.freshness.sittingsBehind).toBe(1); // s-behind only — the import does not count
    expect(body.freshness.lastSittingAt).toBe('2099-01-01T00:00:00.000Z');
  });

  // ── Batch B (§11): the contextualizer's three verbs ──

  it('context-fix rewrites the line, keeps its echoes, stamps at, and drops the model', async () => {
    writeFileSync(
      join(dir, 'wiki', 'context-lines.json'),
      JSON.stringify([{
        passageId: snips[0]!.id,
        text: 'Said in January, after a question about the kitchen window.',
        echoes: [snips[1]!.id],
        at: '2026-01-02T00:00:00.000Z',
        model: 'test-model',
      }]),
      'utf-8',
    );

    const res = await post(app, `/api/wiki/passage/${snips[0]!.id}/context-fix`, {
      text: 'Said in February, after a question about the window — not the kitchen.',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const lines = JSON.parse(readFileSync(join(dir, 'wiki', 'context-lines.json'), 'utf-8')) as {
      passageId: string;
      text: string;
      echoes: string[];
      at: string;
      model?: string;
    }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Said in February, after a question about the window — not the kitchen.');
    expect(lines[0]!.echoes).toEqual([snips[1]!.id]); // echoes kept
    expect(Date.parse(lines[0]!.at)).not.toBeNaN(); // stamped — new under the lens
    expect(lines[0]!.model).toBeUndefined(); // user-fixed lines carry no Q-34 stamp

    rmSync(join(dir, 'wiki', 'context-lines.json'), { force: true });
  });

  it('context-fix answers 400 for a missing, empty, or non-string line, and writes nothing', async () => {
    writeFileSync(
      join(dir, 'wiki', 'context-lines.json'),
      JSON.stringify([{ passageId: snips[0]!.id, text: 'a line', echoes: [], at: NOW }]),
      'utf-8',
    );
    const before = readFileSync(join(dir, 'wiki', 'context-lines.json'), 'utf-8');
    await post(app, `/api/wiki/passage/${snips[0]!.id}/context-fix`);
    for (const text of ['', '   ', 42]) {
      const res = await post(app, `/api/wiki/passage/${snips[0]!.id}/context-fix`, { text });
      expect(res.status).toBe(400);
    }
    expect(readFileSync(join(dir, 'wiki', 'context-lines.json'), 'utf-8')).toBe(before);
    rmSync(join(dir, 'wiki', 'context-lines.json'), { force: true });
  });

  it('context-fix answers 404 for a passage that is not there, and 400 when no line exists to fix', async () => {
    const res = await post(app, '/api/wiki/passage/nosuchpassage/context-fix', { text: 'x' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown passage' });

    // The passage is real but the context job has not run for it: nothing
    // to fix — the mechanical fallback is facts, not agent ink.
    const noLine = await post(app, `/api/wiki/passage/${snips[1]!.id}/context-fix`, { text: 'x' });
    expect(noLine.status).toBe(400);
  });

  it('unlink-echo detaches one echo, keeps the line, and stamps at', async () => {
    writeFileSync(
      join(dir, 'wiki', 'context-lines.json'),
      JSON.stringify([{
        passageId: snips[0]!.id,
        text: 'Said in January — it echoes the rust and the ferry.',
        echoes: [snips[1]!.id, snips[2]!.id],
        at: '2026-01-02T00:00:00.000Z',
      }]),
      'utf-8',
    );

    const res = await post(app, `/api/wiki/passage/${snips[0]!.id}/unlink-echo`, { echo: snips[1]!.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const lines = JSON.parse(readFileSync(join(dir, 'wiki', 'context-lines.json'), 'utf-8')) as {
      passageId: string;
      text: string;
      echoes: string[];
      at: string;
    }[];
    expect(lines[0]!.text).toBe('Said in January — it echoes the rust and the ferry.'); // untouched
    expect(lines[0]!.echoes).toEqual([snips[2]!.id]);
    expect(Date.parse(lines[0]!.at)).not.toBeNaN();

    rmSync(join(dir, 'wiki', 'context-lines.json'), { force: true });
  });

  it('unlink-echo answers 400 for an echo the line does not carry, and for a missing echo', async () => {
    writeFileSync(
      join(dir, 'wiki', 'context-lines.json'),
      JSON.stringify([{ passageId: snips[0]!.id, text: 'a line', echoes: [], at: NOW }]),
      'utf-8',
    );
    const before = readFileSync(join(dir, 'wiki', 'context-lines.json'), 'utf-8');
    const missing = await post(app, `/api/wiki/passage/${snips[0]!.id}/unlink-echo`, { echo: snips[1]!.id });
    expect(missing.status).toBe(400);
    await post(app, `/api/wiki/passage/${snips[0]!.id}/unlink-echo`);
    expect(readFileSync(join(dir, 'wiki', 'context-lines.json'), 'utf-8')).toBe(before);
    rmSync(join(dir, 'wiki', 'context-lines.json'), { force: true });
  });

  it('unlink-echo answers 404 for a passage that is not there', async () => {
    const res = await post(app, '/api/wiki/passage/nosuchpassage/unlink-echo', { echo: 'x' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown passage' });
  });

  it('direction creates an un-coached Direction from a passage (Q-110 door 2)', async () => {
    const res = await post(app, `/api/wiki/passage/${snips[0]!.id}/direction`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { direction: { slug: string; name: string } };
    expect(body.direction.name).toBe(snips[0]!.prose);
    expect(body.direction.slug).toMatch(/\S/);
  });

  it('direction answers 404 for a passage that is not there', async () => {
    const res = await post(app, '/api/wiki/passage/nosuchpassage/direction');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown passage' });
  });

  // ── The retained claim routes (the /v2 personas and the read-log speak them) ──

  it('records a claim read on disk, dated, with the surface that read it (Q-21)', async () => {
    const res = await post(app, '/api/wiki/claim/hub/read', { surface: 'wiki' });
    expect(res.status).toBe(200);

    const stored = createClaimStore(dir).readClaim('hub');
    expect(stored).not.toBeNull();
    expect(stored!.readLog).toHaveLength(1);
    expect(stored!.readLog[0]!.surface).toBe('wiki');
    expect(Date.parse(stored!.readLog[0]!.at)).not.toBeNaN();
  });

  it('records the second claim read too — the instrument counts, it does not deduplicate', async () => {
    await post(app, '/api/wiki/claim/hub/read', { surface: 'wiki' });
    expect(createClaimStore(dir).readClaim('hub')!.readLog).toHaveLength(2);
  });

  it('answers 404 for a claim that is not there, and writes nothing', async () => {
    const res = await post(app, '/api/wiki/claim/nosuchclaim/read', { surface: 'wiki' });
    expect(res.status).toBe(404);
  });

  // ── Batch A (ruling 2026-08-08): the retained margin verbs — narrower, unlink, push down ──

  it('narrower edits only the claim\'s range and stamps updated', async () => {
    const before = createClaimStore(dir).readClaim('worth')!;
    const res = await post(app, '/api/wiki/claim/worth/narrower', { range: 'only on Saturdays' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const stored = createClaimStore(dir).readClaim('worth')!;
    expect(stored.range).toBe('only on Saturdays');
    expect(Date.parse(stored.updated)).not.toBeNaN();
    // Body, cites, status, attestation: untouched.
    expect({ ...stored, range: before.range, updated: before.updated }).toEqual(before);
  });

  it('narrower answers 400 for a missing, empty, or non-string range, and writes nothing', async () => {
    const before = createClaimStore(dir).readClaim('worth')!;
    await post(app, '/api/wiki/claim/worth/narrower');
    for (const range of ['', '   ', 42]) {
      const res = await post(app, '/api/wiki/claim/worth/narrower', { range });
      expect(res.status).toBe(400);
    }
    expect(createClaimStore(dir).readClaim('worth')).toEqual(before);
  });

  it('narrower answers 404 for a claim that is not there', async () => {
    const res = await post(app, '/api/wiki/claim/nosuchclaim/narrower', { range: 'x' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown claim' });
  });

  it('unlink detaches one cite, keeps the rest in order, and stamps updated', async () => {
    const before = createClaimStore(dir).readClaim('hub')!;
    const cite = before.cites[0]!;
    const res = await post(app, '/api/wiki/claim/hub/unlink', { cite });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const stored = createClaimStore(dir).readClaim('hub')!;
    expect(stored.cites).toEqual(before.cites.slice(1));
    expect(stored.cites).not.toContain(cite);
    expect(Date.parse(stored.updated)).not.toBeNaN();
    expect({ ...stored, cites: before.cites, updated: before.updated }).toEqual(before);
  });

  it('unlink answers 400 for a cite the claim does not carry, and writes nothing', async () => {
    const before = createClaimStore(dir).readClaim('hub')!;
    const res = await post(app, '/api/wiki/claim/hub/unlink', { cite: 'nosuch@1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no such cite' });
    expect(createClaimStore(dir).readClaim('hub')).toEqual(before);
  });

  it('unlink answers 400 for a missing, empty, or non-string cite', async () => {
    const before = createClaimStore(dir).readClaim('hub')!;
    await post(app, '/api/wiki/claim/hub/unlink');
    for (const cite of ['', '   ', 42]) {
      const res = await post(app, '/api/wiki/claim/hub/unlink', { cite });
      expect(res.status).toBe(400);
    }
    expect(createClaimStore(dir).readClaim('hub')).toEqual(before);
  });

  it('unlink refuses to leave a claim citeless (Q-21)', async () => {
    const res = await post(app, '/api/wiki/claim/island/unlink', {
      cite: createClaimStore(dir).readClaim('island')!.cites[0]!,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/evidence/i);
    expect(createClaimStore(dir).readClaim('island')!.cites).toHaveLength(1);
  });

  it('unlink answers 404 for a claim that is not there', async () => {
    const res = await post(app, '/api/wiki/claim/nosuchclaim/unlink', { cite: 'x@1' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown claim' });
  });

  it('push down retires the claim as a past self — archived with the fixed reason, the file kept (Q-29)', async () => {
    const before = createClaimStore(dir).readClaim('worth')!;
    const res = await post(app, '/api/wiki/claim/worth/push-down');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const stored = createClaimStore(dir).readClaim('worth')!;
    expect(stored.archived).toBe(true);
    expect(stored.archiveReason).toBe('user-push-down');
    expect(Date.parse(stored.updated)).not.toBeNaN();
    // The file stays; the essay renders it aside, never deletes it (Q-29).
    expect(existsSync(join(dir, 'wiki', 'claims', 'worth.md'))).toBe(true);
    // The rest of the claim is untouched.
    expect(stored.body).toBe(before.body);
    expect(stored.cites).toEqual(before.cites);
    expect(stored.status).toBe(before.status);
    expect(stored.attested).toBe(before.attested);
  });

  it('push down answers 404 for a claim that is not there', async () => {
    const res = await post(app, '/api/wiki/claim/nosuchclaim/push-down');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown claim' });
  });
});

// ── The password gate (Q-25) ──

describe('the wiki routes behind the gate', () => {
  let app: Hono;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'elicit-wiki-gate-'));
    const vault = createVault(dir);
    const authStore = createFileAuth(join(dir, '.auth.json'));
    authStore.setup('a password');
    const barrier = docketBarrier();
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue: createQueueStore(dir),
      index: buildIndex([]),
      vaultRoot: dir,
      authStore,
      onDocketSettled: barrier.onDocketSettled,
    });
    await barrier.waitFor(1);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses an unauthenticated read', async () => {
    expect((await get(app, '/api/wiki')).status).toBe(401);
  });

  it('refuses an unauthenticated read-log write', async () => {
    expect((await post(app, '/api/wiki/passage/nosuch/read', { surface: 'wiki' })).status).toBe(401);
  });

  it('opens both to a logged-in session', async () => {
    const login = await post(app, '/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    const cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0];
    expect(cookie).toBeDefined();
    expect((await get(app, '/api/wiki', cookie)).status).toBe(200);
    // No such passage in this vault, so 404 rather than 401 is the proof the
    // gate opened and the handler ran.
    expect((await post(app, '/api/wiki/passage/nosuch/read', undefined, cookie)).status).toBe(404);
  });
});

// ── resonance-checked on the live turn path (ticket 036 item 2) ──

describe('resonance on the live turn path', () => {
  let app: Hono;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'elicit-resonance-'));
    const vault = createVault(dir);
    vault.saveSnippet('I keep a notebook by the bed for the same reason every night.', {
      kind: 'harvest',
      session: 'seed',
      question: '',
      questionForm: 'deliberative',
    });
    const barrier = docketBarrier();
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue: createQueueStore(dir),
      index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
      vaultRoot: dir,
      authStore: createFileAuth(join(dir, '.auth.json')),
      onDocketSettled: barrier.onDocketSettled,
    });
    await barrier.waitFor(1);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Eval finding #8, in its live form: "looked and found nothing" and "never
   * looked" must not render alike. The zero case is the whole point of the
   * event, and it is the one an emitter guarded by `if (hits.length)` drops.
   */
  it('emits resonance-checked on a turn that echoes nothing', async () => {
    const start = await post(app, '/api/session', {});
    const { sessionId } = (await start.json()) as { sessionId: string };

    await post(app, `/api/session/${sessionId}/turn`, {
      text: 'Aluminium cladding on a warehouse in Ostend.',
    });

    const checked = readEvents(dir).filter((e) => e.kind === 'resonance-checked');
    expect(checked.length).toBeGreaterThan(0);
    const last = checked[checked.length - 1]!;
    expect(last.actor).toBe('elicitor');
    expect(last.detail).toContain('hits=0');
    expect(last.detail).toContain(`session=${sessionId}`);
  });

  it('counts the hits when the vault does echo', async () => {
    const start = await post(app, '/api/session', {});
    const { sessionId } = (await start.json()) as { sessionId: string };

    const before = readEvents(dir).filter((e) => e.kind === 'resonance-checked').length;
    await post(app, `/api/session/${sessionId}/turn`, {
      text: 'I keep a notebook by the bed for the same reason every night.',
    });
    const checked = readEvents(dir).filter((e) => e.kind === 'resonance-checked');
    expect(checked.length).toBe(before + 1);
    expect(checked[checked.length - 1]!.detail).toMatch(/hits=[1-9]/);
  });
});
