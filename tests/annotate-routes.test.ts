/**
 * Ticket 074, Contract 3: the /api/snippets route carries the resolved-
 * referent annotation when the server is given an annotation store.
 *
 * Driven through the REAL app like the piece routes — app.fetch with a
 * loopback remoteAddr is the whole transport, no port is ever bound.
 *
 * The four cases Contract 3 pins: an annotation rides its snippet with the
 * snippet's own fields intact, a silence record omits the key, an absent
 * record omits the key, and an absent store enriches nothing at all (the
 * exact pre-ticket response).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createAnnotationStore, type AnnotationRecord } from '../src/clerk/annotation-store.js';
import type { QueueStore, Snippet, Vault } from '../src/types.js';

// ── Harness (the piece-routes shape) ──

let root: string;
let app: Hono;
let vault: Vault;
let queue: QueueStore;
let cookie: string;
let settled: number;
let waiting: (() => void)[];

/** Counts settled background docket runs and lets a test wait for one. */
function onDocketSettled(): void {
  settled++;
  for (const w of waiting.splice(0)) w();
}

async function waitForSettles(n: number): Promise<void> {
  while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

async function get(path: string): Promise<Response> {
  return app.fetch(new Request(`http://127.0.0.1${path}`, { headers: { cookie } }), {
    remoteAddr: '127.0.0.1',
  });
}

async function post(path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** A snippet with a real harvest provenance; nothing here reads a transcript. */
function seedSnippet(prose: string): Snippet {
  return vault.saveSnippet(prose, {
    kind: 'harvest',
    session: 's-test',
    question: 'what changed?',
    questionForm: 'deliberative',
  });
}

/** The /api/snippets response, with the optional annotation riding beside. */
type SnippetsResponse = { snippets: (Snippet & { annotation?: AnnotationRecord })[] };

describe('the resolved-referent annotation on /api/snippets (ticket 074)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'elicit-annotate-routes-'));
    settled = 0;
    waiting = [];
    vault = createVault(root);
    queue = createQueueStore(root);
    const authStore = createFileAuth(join(root, '.auth.json'));
    authStore.setup('a password');
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue,
      index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
      vaultRoot: root,
      authStore,
      onDocketSettled,
      annotations: createAnnotationStore(join(root, 'annotations')),
    });
    // The boot docket settles once; waiting makes the seed reads deterministic.
    await waitForSettles(1);
    const login = await post('/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    expect(cookie).not.toBe('');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rides the snippet: an annotation record enriches that snippet only', async () => {
    const s = seedSnippet('the snow is gone from the ridge');
    const store = createAnnotationStore(join(root, 'annotations'));
    store.put({
      kind: 'annotation',
      snippetId: s.id,
      version: s.version,
      expression: 'the snow is gone',
      referent: 'the spring thaw',
      model: 'bonsai-27b',
      modelAt: '2026-08-02T00:00:00.000Z',
    });
    const res = await get('/api/snippets');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnippetsResponse;
    const found = body.snippets.find((x) => x.id === s.id);
    expect(found).toBeDefined();
    // The snippet's own fields arrive intact beside the annotation.
    expect(found!.prose).toBe('the snow is gone from the ridge');
    expect(found!.version).toBe(s.version);
    expect(found!.captured).toBe(s.captured);
    expect(found!.annotation).toEqual({
      kind: 'annotation',
      snippetId: s.id,
      version: s.version,
      expression: 'the snow is gone',
      referent: 'the spring thaw',
      model: 'bonsai-27b',
      modelAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('omits the key for a silence record', async () => {
    const s = seedSnippet('the sky is a hard lid today');
    createAnnotationStore(join(root, 'annotations')).put({
      kind: 'silence',
      snippetId: s.id,
      version: s.version,
      model: 'bonsai-27b',
      modelAt: '2026-08-02T00:00:00.000Z',
    });
    const res = await get('/api/snippets');
    const body = (await res.json()) as SnippetsResponse;
    const found = body.snippets.find((x) => x.id === s.id);
    expect(found).toBeDefined();
    expect(found!.prose).toBe('the sky is a hard lid today');
    expect('annotation' in found!).toBe(false);
  });

  it('omits the key when no record exists', async () => {
    const s = seedSnippet('no model has read this one yet');
    const res = await get('/api/snippets');
    const body = (await res.json()) as SnippetsResponse;
    const found = body.snippets.find((x) => x.id === s.id);
    expect(found).toBeDefined();
    expect(found!.prose).toBe('no model has read this one yet');
    expect('annotation' in found!).toBe(false);
  });

  it('enriches nothing when the server carries no annotation store', async () => {
    // A second app WITHOUT the store: the pre-ticket response exactly.
    const plainRoot = mkdtempSync(join(tmpdir(), 'elicit-annotate-routes-plain-'));
    try {
      const pvault = createVault(plainRoot);
      const pqueue = createQueueStore(plainRoot);
      const pauth = createFileAuth(join(plainRoot, '.auth.json'));
      pauth.setup('a password');
      let plainSettled = 0;
      const plainWaiting: (() => void)[] = [];
      const plainApp = await createApp({
        vault: pvault,
        complete: makeFakeComplete(),
        queue: pqueue,
        index: buildIndex(Object.values(pvault.rebuildIndex().snippets)),
        vaultRoot: plainRoot,
        authStore: pauth,
        onDocketSettled: () => {
          plainSettled++;
          for (const w of plainWaiting.splice(0)) w();
        },
      });
      while (plainSettled < 1) await new Promise<void>((r) => plainWaiting.push(r));
      const login = await plainApp.fetch(
        new Request('http://127.0.0.1/api/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'a password' }),
        }),
        { remoteAddr: '127.0.0.1' },
      );
      expect(login.status).toBe(200);
      const plainCookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
      const plainSnippet = pvault.saveSnippet('read by no enriched route', {
        kind: 'harvest',
        session: 's-test',
        question: 'what changed?',
        questionForm: 'deliberative',
      });
      const res = await plainApp.fetch(
        new Request('http://127.0.0.1/api/snippets', { headers: { cookie: plainCookie } }),
        { remoteAddr: '127.0.0.1' },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as SnippetsResponse;
      const found = body.snippets.find((x) => x.id === plainSnippet.id);
      expect(found).toBeDefined();
      expect(found!.prose).toBe('read by no enriched route');
      expect('annotation' in found!).toBe(false);
    } finally {
      rmSync(plainRoot, { recursive: true, force: true });
    }
  });
});
