/**
 * The gap-fill sweep through createApp (ticket 027).
 *
 * The failure this suite exists to catch is 012's deviation class (c): a
 * job wired in runDocket's deps but never passed by the server. The vault
 * is SEEDED before createApp so the boot docket run IS the run under
 * test — a test that hand-builds a runDocket deps object would stay green
 * over an unwired product. Every assertion reads disk state: the queue
 * entries the sweep minted and the activity log line it wrote.
 *
 * Zero-LLM by construction: the sweep is a Clerk job with no Complete in
 * sight, and the boot run proves it ran while the fake responder only
 * served the other jobs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { readEvents } from '../src/log/activity.js';
import type { Vault } from '../src/types.js';

// ── Harness (mirrors the T10 block in piece-routes.test.ts) ──

let root: string;
let app: Hono;
let vault: Vault;
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

/** The same request with NO session cookie — the auth gate's view. */
async function anon(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** A transcript whose frontmatter carries the sitting date (Q-59). */
function seedTranscript(session: string, started: string): void {
  mkdirSync(join(root, 'transcripts'), { recursive: true });
  writeFileSync(
    join(root, 'transcripts', `${session}.md`),
    matter.stringify('', { session, protocol: 'ladder', started }),
    'utf-8',
  );
}

describe('the gap-fill sweep through createApp (027)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'elicit-gap-fill-wiring-'));
    settled = 0;
    waiting = [];
    vault = createVault(root);

    // Seed the vault BEFORE createApp so the boot docket run IS the run
    // under test: one Bud with one recorded failure and one half-Construct
    // (a construct-facet reading citing one snippet) — the sweep's two
    // candidate kinds, exactly one question each.
    seedTranscript('s1', '2024-01-15T09:30:00.000Z');
    const snippet = vault.saveSnippet('I value directness in every exchange.', {
      kind: 'harvest',
      session: 's1',
      question: 'what changed?',
      questionForm: 'deliberative',
    });
    vault.saveBud('and then it just clicked', ['mid-sentence'], 's1');
    vault.saveReading({
      facet: 'construct',
      stance: 'avowal',
      reading: 'The person values directness.',
      cites: [`${snippet.id}@1`],
    });

    const authStore = createFileAuth(join(root, '.auth.json'));
    authStore.setup('a password');
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue: createQueueStore(root),
      index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
      vaultRoot: root,
      authStore,
      onDocketSettled,
    });
    // The boot docket run IS the run under test; wait for it to settle.
    await waitForSettles(1);
    const login = await post('/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    expect(cookie).not.toBe('');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('the boot run mints one question per Bud failure and one per half-Construct', () => {
    // Read through a FRESH store so the assertions see what a restart
    // would: the entries as they exist on disk, round-tripped.
    const entries = createQueueStore(root).list({ source: 'gap-fill' });
    // Exactly two: one from the Bud sweep (bud + failure join keys), one
    // from the construct sweep (snippet join key). A third would mean a
    // candidate double-minted; one fewer would mean a candidate skipped.
    expect(entries).toHaveLength(2);

    const budEntries = entries.filter((e) => e.bud !== undefined);
    expect(budEntries).toHaveLength(1);
    const budEntry = budEntries[0]!;
    expect(budEntry.failure).toBe('mid-sentence');
    // The question embeds the person's words verbatim (Q-12).
    expect(budEntry.question).toContain('and then it just clicked');

    const constructEntries = entries.filter((e) => e.snippet !== undefined);
    expect(constructEntries).toHaveLength(1);
    const constructEntry = constructEntries[0]!;
    expect(constructEntry.question).toContain('I value directness');
    const snippetId = constructEntry.snippet!;
    expect(constructEntry.cites).toEqual([`${snippetId}@1`]);

    // The run logged its mint (readEvents needs no auth).
    const events = readEvents(root);
    expect(events.some((e) => e.kind === 'gap-fill-minted')).toBe(true);
  });

  it('a second production run on the same vault mints nothing new', async () => {
    // A fresh app on the SAME root is a second production docket run — the
    // same path a restart would take. The ever-minted dedupe (dormancy is
    // signal, Q-24/Q-41/Q-72) must hold the count at exactly two.
    settled = 0;
    waiting = [];
    const authStore = createFileAuth(join(root, '.auth.json'));
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue: createQueueStore(root),
      index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
      vaultRoot: root,
      authStore,
      onDocketSettled,
    });
    await waitForSettles(1);
    expect(createQueueStore(root).list({ source: 'gap-fill' })).toHaveLength(2);
  });
});
