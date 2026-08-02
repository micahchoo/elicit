/**
 * The four import routes (T9), driven through the REAL app.
 *
 * Every assertion goes through `createApp` and `app.fetch` — never a
 * hand-built handler — because the failure this suite exists to catch is
 * the seam that compiles, tests green, and reaches nothing. This suite also
 * closes T8 Step 4: the scan route is adoption's only caller, so the
 * adopt-before-admit order is asserted HERE, at the route.
 *
 * The whole suite scans a COPY of the fixture folder inside the temp root,
 * never the fixture itself — the stale test rewrites its source file, and
 * the fixture is committed.
 *
 * No port is ever bound. `app.fetch` with a loopback `remoteAddr` is the
 * whole transport, so nothing here can collide with a live instance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createImportStore, type ImportStore } from '../src/import/store.js';
import { runImportExtraction } from '../src/import/extract.js';
import { makeFakeComplete } from '../src/fake-responder.js';

/** The committed fixture. These tests NEVER mutate it. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import-folder');
/**
 * The (Mol 2008) paragraph of quoted.md — dropped from extraction by
 * dropCitedParagraphs, so it can only reach the surface because the route
 * re-reads the whole source body.
 */
const CITED_PARAGRAPH = 'the argument I keep returning to (Mol 2008)';

let root: string;
let app: Hono;
let store: ImportStore;
let folder: string;
let settled: number;
let waiting: (() => void)[];

// ── Helpers ──

/** Counts settled background docket runs and lets a test wait for one. */
function onDocketSettled(): void {
  settled++;
  for (const w of waiting.splice(0)) w();
}

async function waitForSettles(n: number): Promise<void> {
  while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

async function get(path: string): Promise<Response> {
  return app.fetch(new Request(`http://127.0.0.1${path}`), { remoteAddr: '127.0.0.1' });
}

async function post(path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** A `protocol: import` transcript, the shape the one-off script wrote. */
function seedTranscript(name: string, started: string): void {
  const dir = join(root, 'transcripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.md`),
    matter.stringify('', { session: name, protocol: 'import', started }),
    'utf-8',
  );
}

/** The source paths of everything still pending, read from the store on disk. */
function pendingPaths(s: ImportStore): string[] {
  return s.list('pending').map((r) => r.sourcePath);
}

/** Every path the app answers, so the suite can prove a route does NOT exist. */
function routePaths(): string[] {
  return app.routes.map((r) => r.path);
}

describe('the four import routes (T9)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'elicit-import-routes-'));
    folder = join(root, 'import-folder');
    cpSync(FIXTURE, folder, { recursive: true });
    settled = 0;
    waiting = [];
    const vault = createVault(root);
    const queue = createQueueStore(root);
    const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue,
      index,
      vaultRoot: root,
      authStore: createFileAuth(join(root, '.auth.json')),
      onDocketSettled,
    });
    // The boot docket's extraction job is a no-op against the empty store;
    // waiting for the settle is what makes the scan tests deterministic.
    await waitForSettles(1);
    store = createImportStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('scan answers with refusals by reason and writes no corpus', async () => {
    const res = await post('/api/import/scan', { folder });
    const r = (await res.json()) as { refused: { file: string; reason: string }[] };
    expect(r.refused).toContainEqual({ file: 'undated.md', reason: 'no-date' });
    // Extraction runs in the docket behind the response, but its commit
    // path is never reached by a scan — nothing is in the corpus until a
    // review decision lands.
    expect(existsSync(join(root, 'transcripts'))).toBe(false);
  });

  it('adopts prior ingest before admitting, so an already-imported post never queues', async () => {
    seedTranscript('post-dated-essay', '2018-09-01T00:00:00.000Z');
    const res = await post('/api/import/scan', { folder });
    const r = (await res.json()) as { adopted: number };
    expect(r.adopted).toBeGreaterThan(0);
    // The one-off already imported dated-essay.md; adoption recognises the
    // sitting BEFORE admission, so the piece never stands at the door as
    // pending (T8 Step 4 — asserted at the route, its only caller).
    expect(pendingPaths(store)).not.toContain(join(folder, 'dated-essay.md'));
  });

  it('next hands back the whole source, not the prepared prose', async () => {
    seedTranscript('post-dated-essay', '2018-09-01T00:00:00.000Z');
    await post('/api/import/scan', { folder });
    // Extraction ahead of review (T6): run it directly so the assertion is
    // deterministic — the docket's own run may or may not have landed yet,
    // and both write the same records.
    await runImportExtraction({
      store,
      complete: makeFakeComplete(),
      readSource: (p) => readFileSync(p, 'utf-8'),
      log: () => {},
    });
    const { item } = (await (await get('/api/import/next')).json()) as {
      item: { source: string; marks: { why: string }[] } | null;
    };
    expect(item).not.toBeNull();
    // The whole source body, not the prepared prose: the cited paragraph
    // was dropped from extraction, so it can only be here because the
    // route re-read the file.
    expect(item!.source).toContain(CITED_PARAGRAPH);
    // ...and the dropped region is named, so the reader knows why that
    // paragraph carries no cuts.
    expect(item!.marks.some((m) => m.why === 'cited')).toBe(true);
  });

  it('exclude requires a reason', async () => {
    await post('/api/import/scan', { folder });
    const hash = store.list('pending')[0]!.hash;
    const res = await post(`/api/import/${hash}/exclude`, { reason: '' });
    expect(res.status).toBe(400);
  });

  it('decisions on a changed file answer 409 stale and write nothing', async () => {
    await post('/api/import/scan', { folder });
    await runImportExtraction({
      store,
      complete: makeFakeComplete(),
      readSource: (p) => readFileSync(p, 'utf-8'),
      log: () => {},
    });
    const rec = store.list('extracted')[0]!;
    // The source changed on disk after extraction: the review would show
    // cuts that cannot commit — the new body is a NEW item (Q-59).
    writeFileSync(
      rec.sourcePath,
      readFileSync(rec.sourcePath, 'utf-8') + '\n\nA changed ending, written after the piece was read.\n',
      'utf-8',
    );
    const res = await post(`/api/import/${rec.hash}/decisions`, { decisions: [] });
    const body = (await res.json()) as { reason?: string };
    expect(res.status).toBe(409);
    expect(body.reason).toBe('stale');
    // And nothing was written: the record is still waiting, and no sitting
    // exists in the corpus.
    expect(store.get(rec.hash)!.status).toBe('extracted');
    expect(store.list('accepted')).toHaveLength(0);
  });

  it('there is no batch route', () => {
    expect(routePaths()).not.toContain('/api/import/accept-all');
  });
});
