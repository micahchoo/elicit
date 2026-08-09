/**
 * The four seeding routes (014 T12), driven through the REAL app — and the
 * wave-3 gate that matters most: a full import driven only through the
 * routes — declare, scan, docket, next, decisions — must leave a snippet on
 * disk carrying `provenance.authorship`. Every other authorship test in the
 * plan injects `regionFor` directly and would pass over an unwired route;
 * this one cannot.
 *
 * The extraction runs inside the server's ACTUAL docket (startDocket →
 * runDocketNow → runImportJobs), so the app is built with a scripted
 * complete that answers the four extraction calls — oldest first, the
 * fixture's dates — with one real cut each. An item with empty cuts can
 * never commit, so a test that commits must script real cuts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createImportStore, type ImportStore } from '../src/import/store.js';
import { bodyHash } from '../src/import/scan.js';
import { readEvents } from '../src/log/activity.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { makeScriptedComplete } from './fakes.js';
import { SHARED_SENTENCE } from './fixtures/seeding-vault/manifest.js';
import type { Complete, Provenance, QueueDraft, QueueStore } from '../src/types.js';

/** The committed fixture: four admitted files under `filename: YYYY-MM-DD`. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'seeding-vault');
const D = { kind: 'filename' as const, pattern: 'YYYY-MM-DD' };

/** One scripted cut, shaped exactly as the real model's JSON emits it. */
const cutResponse = (text: string): string =>
  JSON.stringify({
    cuts: [
      {
        text,
        sourceTurn: 0,
        facet: 'value',
        stance: 'commitment',
        reading: 'the person keeps this sentence',
        standalone: true,
      },
    ],
  });

/** The four extraction answers, oldest date first (the docket's order). */
const GATE_RESPONSES = (): string[] => [
  cutResponse('This is the week everything changed.'),
  cutResponse(SHARED_SENTENCE),
  cutResponse('This is what made the whole thing work.'),
  cutResponse('It started as a side project and became the way we plan.'),
  // Padding: any further docket job that touches a model (there should be
  // none with an empty vault and no transcripts — this is the guard).
  'padding', 'padding', 'padding', 'padding', 'padding', 'padding',
];

let root: string;
let app: Hono;
let store: ImportStore;
let queue: QueueStore;
let settled: number;
let waiting: (() => void)[];

function onDocketSettled(): void {
  settled++;
  waiting.splice(0).forEach((r) => r());
}

async function waitForSettles(n: number): Promise<void> {
 while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

/** Re-check a condition after every docket settle — no wall-clock timers. */
async function waitUntil(cond: () => boolean): Promise<void> {
 while (!cond()) {
  await new Promise<void>((resolve) => waiting.push(resolve));
 }
}

async function get(path: string): Promise<Response> {
  return app.fetch(new Request(`http://127.0.0.1${path}`), { remoteAddr: '127.0.0.1' });
}

async function post(path: string, body?: unknown): Promise<Response> {
 const init: RequestInit = { method: 'POST' };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 }
 return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** Every path the app answers, so a test can prove a route does NOT exist. */
function routePaths(): string[] {
  return app.routes.map((r) => r.path);
}

/** Every snippet v1 on disk, with its provenance read back from the markdown. */
function snippetsOnDisk(): { id: string; provenance: Provenance }[] {
  const dir = join(root, 'snippets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((id) => {
    const parsed = matter.read(join(dir, id, 'v1.md'));
    return { id, provenance: parsed.data.provenance as Provenance };
  });
}

/** Every Bud on disk. */
function budsOnDisk(): { failures: string[] }[] {
  const dir = join(root, 'buds');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => matter.read(join(dir, f)).data as { failures: string[] });
}

/** Every Activity Log kind the app has written. */
function activityKinds(): string[] {
  return readEvents(root).map((e) => e.kind);
}

/** One pending queue question whose terms reach the surveyed folder's names. */
function seedReachingQuestion(): void {
 queue.add({
  source: 'composed',
  license: 'CC0',
  question: 'What changed about therapy sessions?',
  questionForm: 'deliberative',
  horizon: 'now',
 } satisfies QueueDraft);
}

async function makeApp(complete?: Complete): Promise<void> {
  root = mkdtempSync(join(tmpdir(), 'elicit-seeding-routes-'));
  settled = 0;
  waiting = [];
  const vault = createVault(root);
  queue = createQueueStore(root);
  const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
  app = await createApp({
    vault,
    complete: complete ?? makeFakeComplete(),
    queue,
    index,
    vaultRoot: root,
    authStore: createFileAuth(join(root, '.auth.json')),
    onDocketSettled,
  });
  store = createImportStore(root);
  // The boot docket's extraction job is a no-op against the empty store;
  // waiting for the settle is what makes the scan tests deterministic.
  await waitForSettles(1);
}

/** The JSON body of a response, cast at the boundary the route defines. */
async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(async () => {
  await makeApp();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the seeding routes (014 T12)', () => {
  it('refuses a dating pattern that cannot produce a day, and writes nothing', async () => {
    const r = await post('/api/import/region', {
      root: FIXTURE,
      dating: { kind: 'filename', pattern: 'YYYY-MM' },
      authorship: 'authored',
    });
    expect(r.status).toBe(400);
    expect(existsSync(join(root, 'imports', 'regions'))).toBe(false);
  });

  it('refuses an authorship outside the three values', async () => {
    const r = await post('/api/import/region', { root: FIXTURE, dating: D, authorship: 'own' });
    expect(r.status).toBe(400);
  });

  it('scan uses the region dating rule and stamps the region', async () => {
    const body = await jsonOf<{ slug: string }>(await post('/api/import/region', { root: FIXTURE, dating: D, authorship: 'other' }));
    const slug = body.slug;
    const res = await post('/api/import/scan', { folder: FIXTURE, region: slug });
    const r = await jsonOf<{ pending: number; refused: { file: string; reason: string }[] }>(res);
    expect(r.pending).toBe(4);
    expect(r.refused).toContainEqual({ file: 'ideas.md', reason: 'no-date-in-name' });
    expect(r.refused).toContainEqual({ file: '2021-02-31.md', reason: 'unparsable-date' });
    // The records carry the region, and the region bounds the review queue.
    expect(store.list('pending', slug)).toHaveLength(4);
  });



  it('there is no route that harvests a region without a declaration', () => {
    expect(routePaths()).not.toContain('/api/import/harvest-region');
  });

  it('THE GATE — a real import through the routes stamps authorship on disk', async () => {
    // The gate: every earlier authorship test injects regionFor directly and
    // would pass over a dead route. This drives declare → scan → docket →
    // next → decisions, nothing else, and reads the snippet off disk.
    await makeApp(makeScriptedComplete(GATE_RESPONSES()));
    const declared = await jsonOf<{ slug: string }>(await post('/api/import/region', { root: FIXTURE, dating: D, authorship: 'other' }));
    const slug = declared.slug;
    await post('/api/import/scan', { folder: FIXTURE, region: slug });
    await waitForSettles(2); // boot + the scan-triggered extraction run
    const next = await jsonOf<{ item: { hash: string; file: string; cuts: unknown[] } | null }>(
      await get(`/api/import/next?region=${slug}`),
    );
    expect(next.item).not.toBeNull();
    expect(next.item!.file).toBe('2019-11-02.md'); // oldest first
    expect(next.item!.cuts.length).toBeGreaterThan(0);
    const r = await post(`/api/import/${next.item!.hash}/decisions`, {
      decisions: [{ cut: 0, action: 'approve' }],
    });
    expect(r.status).toBe(200);
    const onDisk = snippetsOnDisk();
    expect(onDisk.length).toBe(1);
    expect(onDisk[0]!.provenance.authorship).toBe('other'); // ← the whole thread
    // The repair pass rode the same route: the committed dangler ("This is
    // the week everything changed.") opened with an anaphor and has no
    // context window, so one Bud and one capped queue question landed.
    expect(budsOnDisk()).toHaveLength(1);
    expect(budsOnDisk()[0]!.failures).toEqual(['dangling-referent']);
    expect(queue.list({ source: 'import-repair' })).toHaveLength(1);
  });

  it('the bounded queue is what the route hands back', async () => {
    const folderA = join(root, 'A');
    const folderB = join(root, 'B');
    cpSync(FIXTURE, folderA, { recursive: true });
    cpSync(FIXTURE, folderB, { recursive: true });
    // The two copies must NOT share bodies: admission dedupes on the content
    // hash (Q-59), so an identical copy would admit nothing and the region
    // bound could never be shown. Give every admitted B file a distinct
    // second paragraph; the names keep their dates.
    const bFiles: [string, string][] = [
     ['2019', '2019-11-02.md'],
     ['2019', '2019-11-03.md'],
     ['', '2021-03-04.md'],
     ['', '2021-03-05 Monday.md'],
    ];
    for (const [sub, name] of bFiles) {
     const p = join(folderB, 'journal', sub, name);
     writeFileSync(p, readFileSync(p, 'utf-8') + '\n\nA second paragraph that only region B holds.\n');
    }
    const declaredA = await jsonOf<{ slug: string }>(await post('/api/import/region', { root: folderA, dating: D, authorship: 'authored' }));
    const declaredB = await jsonOf<{ slug: string }>(await post('/api/import/region', { root: folderB, dating: D, authorship: 'authored' }));
    const slugA = declaredA.slug;
    const slugB = declaredB.slug;
    await post('/api/import/scan', { folder: folderA, region: slugA });
    await post('/api/import/scan', { folder: folderB, region: slugB });
    // The docket drains the two folders across however many runs it needs
    // (replay + the Q-56 re-trigger can split 8 items over several runs), so
    // wait for the store state itself, re-checking on each settle.
    // The docket drains the two folders across however many runs it needs
    // (replay + the Q-56 re-trigger can split 8 items over several runs), so
    // wait for the store state itself, re-checking on each settle.
    await waitUntil(() => store.list('extracted', slugA).length === 4 && store.list('extracted', slugB).length === 4);
    // The oldest file of each copy dates 2019-11-02; its body is pinned by
    // the fixture manifest contract.
    const hashInA = bodyHash(matter(readFileSync(join(folderA, 'journal', '2019', '2019-11-02.md'), 'utf-8')).content);
    const hashInB = bodyHash(matter(readFileSync(join(folderB, 'journal', '2019', '2019-11-02.md'), 'utf-8')).content);
    const a = await jsonOf<{ item: { hash: string } | null }>(await get(`/api/import/next?region=${slugA}`));
    const b = await jsonOf<{ item: { hash: string } | null }>(await get(`/api/import/next?region=${slugB}`));
    if (a.item === null || b.item === null) {
     throw new Error('expected an item from each region — the bounded queue is empty');
    }
    expect(a.item.hash).toBe(hashInA);
    expect(b.item.hash).toBe(hashInB);
    // 4 extracted, one handed back — the two regions never bleed into each
    // other, and the queue stays bounded to the chosen region.
    expect(a.item.hash).not.toBe(b.item.hash);
  });

  it('a committed dangler leaves a Bud and a queue question', async () => {
    await makeApp(makeScriptedComplete(GATE_RESPONSES()));
    const declared = await jsonOf<{ slug: string }>(await post('/api/import/region', { root: FIXTURE, dating: D, authorship: 'other' }));
    const slug = declared.slug;
    await post('/api/import/scan', { folder: FIXTURE, region: slug });
    await waitForSettles(2);
    const next = await jsonOf<{ item: { hash: string } | null }>(await get(`/api/import/next?region=${slug}`));
    await post(`/api/import/${next.item!.hash}/decisions`, { decisions: [{ cut: 0, action: 'approve' }] });
    expect(budsOnDisk()).toHaveLength(1);
    expect(queue.list({ source: 'import-repair' })).toHaveLength(1);
  });
});
