import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
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
import { facetHeading, lintNote } from '../src/queue/source-label.js';
import type { Claim, Contradiction } from '../src/wiki/contract.js';
import type { Facet, Snippet } from '../src/types.js';

/**
 * The two wiki routes, driven through the REAL app.
 *
 * Every assertion below goes through `createApp` and `app.fetch`, never through
 * a hand-built handler, because the failure this suite exists to catch is the
 * one this campaign has shipped five times: a seam that compiles, tests green,
 * and reaches nothing. The read-log assertions read the FILE ON DISK rather
 * than the response body for the same reason.
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

/** The response shape `GET /api/wiki` answers with. */
type WikiResponse = {
  facets: { facet: Facet; heading: string; claims: Claim[] }[];
  contradictions: Contradiction[];
  lint: { kind: string; subject: string; note: string }[];
  lintedAt: string | null;
  all: boolean;
};

// ── The fixture ──
//
// One vault, five snippets, and claims whose citation graph has a KNOWN shape,
// so the coreness ordering is a fact rather than whatever came back.

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
    // island = 1/4 — a strict order, not a tie.
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

    // Every cite unresolvable — the one lint finding that is not shadowed, so
    // the response's lint list is deterministic.
    store.writeClaim(claim('orphan', 'fact', ['nosuch@1']));

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
    // The boot docket runs the wiki jobs, which is where the lint findings the
    // route serves come from. Waiting for it is what makes this the real seam.
    await barrier.waitFor(1);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── GET /api/wiki ──

  it('groups claims by facet, with a heading a person can read', async () => {
    const res = await get(app, '/api/wiki');
    expect(res.status).toBe(200);
    const body = (await res.json()) as WikiResponse;

    const facets = body.facets.map((f) => f.facet);
    expect(facets).toContain('construct');
    expect(facets).toContain('value');
    // A heading over an empty section is noise.
    for (const group of body.facets) expect(group.claims.length).toBeGreaterThan(0);

    for (const group of body.facets) {
      expect(group.heading).toBe(facetHeading(group.facet));
      // Ticket 063: no hyphenated machine literal reaches a reading surface,
      // and no heading IS the literal. `fact` inside "Steady facts" leaks
      // nothing; `causal-theory` over a page of prose is a debug string.
      expect(group.heading.toLowerCase()).not.toBe(group.facet);
      if (group.facet.includes('-')) expect(group.heading).not.toContain(group.facet);
    }
  });

  it('orders claims within a facet by coreness, most connected first', async () => {
    const res = await get(app, '/api/wiki');
    const body = (await res.json()) as WikiResponse;
    const construct = body.facets.find((f) => f.facet === 'construct');
    expect(construct).toBeDefined();
    expect(construct!.claims.map((c) => c.id)).toEqual(['hub', 'island']);
  });

  it('leaves archived and superseded claims out of the default reading', async () => {
    const res = await get(app, '/api/wiki');
    const body = (await res.json()) as WikiResponse;
    const ids = body.facets.flatMap((f) => f.claims.map((c) => c.id));
    expect(ids).not.toContain('gone');
    expect(ids).not.toContain('old');
    expect(ids).toContain('hub');
    expect(body.all).toBe(false);
  });

  it('includes them under ?all=1 — nothing is deleted, it is just not the default', async () => {
    const res = await get(app, '/api/wiki?all=1');
    const body = (await res.json()) as WikiResponse;
    const ids = body.facets.flatMap((f) => f.claims.map((c) => c.id));
    expect(ids).toContain('gone');
    expect(ids).toContain('old');
    expect(body.all).toBe(true);
  });

  it('keeps the ordering stable when ?all=1 widens the reading', async () => {
    // Coreness is normalized against the whole graph, so hub stays ahead of
    // island whether or not the archived claims are shown.
    const body = (await (await get(app, '/api/wiki?all=1')).json()) as WikiResponse;
    const construct = body.facets.find((f) => f.facet === 'construct')!;
    const order = construct.claims.map((c) => c.id);
    expect(order.indexOf('hub')).toBeLessThan(order.indexOf('island'));
  });

  it('returns the open contradiction as material, and the dissolved one only under ?all=1', async () => {
    const plain = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    expect(plain.contradictions.map((c) => c.id)).toEqual(['live']);
    // Q-15: met as material. The body carries the two dated poles.
    expect(plain.contradictions[0]!.body).toContain('morning light');

    const all = (await (await get(app, '/api/wiki?all=1')).json()) as WikiResponse;
    expect(all.contradictions.map((c) => c.id).sort()).toEqual(['live', 'settled']);
  });

  it('renders a lint finding as a note, with no identifier in it', async () => {
    const body = (await (await get(app, '/api/wiki')).json()) as WikiResponse;
    const orphan = body.lint.find((f) => f.subject === 'orphan');
    expect(orphan, 'the orphan-claim finding did not reach the route').toBeDefined();
    expect(orphan!.note).toBe(lintNote('orphan-claim'));

    // Ticket 038: the leak that closed a ticket was ids on a surface a person
    // reads. `LintFinding.detail` names the dead cites; the route drops it.
    const rendered = JSON.stringify(body.lint);
    expect(rendered).not.toContain('nosuch@1');
    expect(rendered).not.toContain('detail');
    expect(rendered).not.toContain('refs');
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

  // ── POST /api/wiki/claim/:id/read ──

  it('records a read on disk, dated, with the surface that read it (Q-21)', async () => {
    const res = await post(app, '/api/wiki/claim/hub/read', { surface: 'wiki' });
    expect(res.status).toBe(200);

    const stored = createClaimStore(dir).readClaim('hub');
    expect(stored).not.toBeNull();
    expect(stored!.readLog).toHaveLength(1);
    expect(stored!.readLog[0]!.surface).toBe('wiki');
    expect(Date.parse(stored!.readLog[0]!.at)).not.toBeNaN();
  });

  it('records the second read too — the instrument counts, it does not deduplicate', async () => {
    await post(app, '/api/wiki/claim/hub/read', { surface: 'wiki' });
    expect(createClaimStore(dir).readClaim('hub')!.readLog).toHaveLength(2);
  });

  it('defaults the surface rather than writing undefined into the file', async () => {
    await post(app, '/api/wiki/claim/island/read');
    const log = createClaimStore(dir).readClaim('island')!.readLog;
    expect(log).toHaveLength(1);
    expect(log[0]!.surface).toMatch(/\S/);
  });

  it('answers 404 for a claim that is not there, and writes nothing', async () => {
    const res = await post(app, '/api/wiki/claim/nosuchclaim/read', { surface: 'wiki' });
    expect(res.status).toBe(404);
  });

  it('changes only the read-log — a read is never an edit', async () => {
    const before = createClaimStore(dir).readClaim('worth')!;
    await post(app, '/api/wiki/claim/worth/read', { surface: 'wiki' });
    const after = createClaimStore(dir).readClaim('worth')!;
    expect({ ...after, readLog: [] }).toEqual({ ...before, readLog: [] });
    expect(after.readLog).toHaveLength(1);
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
    expect((await post(app, '/api/wiki/claim/hub/read', { surface: 'wiki' })).status).toBe(401);
  });

  it('opens both to a logged-in session', async () => {
    const login = await post(app, '/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    const cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0];
    expect(cookie).toBeDefined();
    expect((await get(app, '/api/wiki', cookie)).status).toBe(200);
    // No such claim in this vault, so 404 rather than 401 is the proof the
    // gate opened and the handler ran.
    expect((await post(app, '/api/wiki/claim/hub/read', undefined, cookie)).status).toBe(404);
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
    const start = await post(app, '/api/session', {
      mode: { minutes: 10, energy: 'medium', target: 'self' },
    });
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
    const start = await post(app, '/api/session', {
      mode: { minutes: 10, energy: 'medium', target: 'self' },
    });
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
