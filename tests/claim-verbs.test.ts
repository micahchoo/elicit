/**
 * Wave 3, tasks 3.1-3.2, and ticket 093: the user verbs on a claim — attest,
 * which sets the one flag only a user verb may set (Q-33); challenge, which
 * enqueues a question and never touches the claim (the agent may ask, never
 * decide); and edit, the correcting verb, which replaces the claim's body
 * with the person's own words — the edit becomes a verbatim Snippet the
 * claim cites (the agent may question, never rewrite).
 *
 * Every assertion goes through `createApp` and `app.fetch`, never through a
 * hand-built handler, because the failure this suite exists to catch is the
 * seam that compiles, tests green, and reaches nothing — the same reason the
 * read-log suite reads the FILE ON DISK rather than the response body.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import matter from 'gray-matter';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createClaimStore } from '../src/wiki/store.js';
import type { Claim, ClaimStore } from '../src/wiki/contract.js';
import type { QueueStore, Snippet, Vault } from '../src/types.js';

// ── Harness (the annotate-routes shape) ──

const NOW = '2026-01-01T00:00:00.000Z';

let root: string;
let app: Hono;
let vault: Vault;
let queue: QueueStore;
let store: ClaimStore;
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

/** A claim in the fixture, resting on the one seeded snippet. */
function claim(id: string, over?: Partial<Claim>): Claim {
  return {
    id,
    body: `A sentence about ${id}.`,
    range: 'in the mornings, since 2024',
    status: 'unconfirmed',
    cites: [],
    facet: 'construct',
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

describe('the claim verbs — attest and challenge', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'elicit-claim-verbs-'));
    settled = 0;
    waiting = [];
    vault = createVault(root);
    queue = createQueueStore(root);
    store = createClaimStore(root);

    // One snippet and one claim resting on it, so the boot docket reads a
    // coherent graph and the challenge's question can quote the claim's own
    // words. The claim is seeded BEFORE the app starts, exactly as the wiki
    // routes suite does, and read only after the boot run has settled.
    const s: Snippet = vault.saveSnippet('The snow is gone from the ridge.', {
      kind: 'harvest',
      session: 's-test',
      question: 'what changed?',
      questionForm: 'deliberative',
    });
    store.writeClaim(claim('c-snow', { cites: [`${s.id}@${s.version}`] }));

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
    });
    await waitForSettles(1);
    const login = await post('/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    expect(cookie).not.toBe('');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── POST /api/wiki/claim/:id/attest ──

  it('attest sets the flag on disk, and a reloaded store still sees it', async () => {
    const before = createClaimStore(root).readClaim('c-snow')!;
    const res = await post('/api/wiki/claim/c-snow/attest');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // The one user verb a claim store executes (Q-33): the flag flips, the
    // stamp moves, and nothing else changes — status is mechanical (Q-29).
    const stored = createClaimStore(root).readClaim('c-snow')!;
    expect(stored.attested).toBe(true);
    expect(Date.parse(stored.updated)).not.toBeNaN();
    expect({ ...stored, attested: false, updated: before.updated }).toEqual(before);

    // A reload of the store still sees it: the flag is on disk, not in RAM.
    expect(createClaimStore(root).readClaim('c-snow')!.attested).toBe(true);
  });

  it('answers 404 for an attest on a claim that is not there', async () => {
    const res = await post('/api/wiki/claim/nosuchclaim/attest');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown claim' });
  });

  // ── POST /api/wiki/claim/:id/challenge ──

  it('challenge enqueues a question and leaves the claim byte-for-byte alone', async () => {
    const claimFile = join(root, 'wiki', 'claims', 'c-snow.md');
    const beforeFile = readFileSync(claimFile, 'utf-8');
    const before = createClaimStore(root).readClaim('c-snow')!;

    const res = await post('/api/wiki/claim/c-snow/challenge');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // A pending session question, sourced as the pushback it is, quoting the
    // claim's own words — composed mechanically, no model call.
    const entries = queue.list({ status: 'pending', source: 'claim-challenged' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.horizon).toBe('session');
    expect(entries[0]!.question).toContain(before.body);

    // The claim itself is not modified in any way: not status, not body, not
    // cites, not even the file bytes (the agent may ask, never decide).
    const after = createClaimStore(root).readClaim('c-snow')!;
    expect(after).toEqual(before);
    expect(readFileSync(claimFile, 'utf-8')).toBe(beforeFile);
  });

  it('answers 404 for a challenge on a claim that is not there, and enqueues nothing', async () => {
    const res = await post('/api/wiki/claim/nosuchclaim/challenge');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown claim' });
    expect(queue.list({ source: 'claim-challenged' })).toHaveLength(0);
  });

  // ── POST /api/wiki/claim/:id/edit (093) ──

  it('edit replaces the body with the person\'s words, marks the claim attested, and cites a new Snippet holding them verbatim', async () => {
    const before = createClaimStore(root).readClaim('c-snow')!;
    const res = await post('/api/wiki/claim/c-snow/edit', { body: 'The snow is gone, and the ridge is dry.' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // The claim: the attested flag, the new body, and the appended cite —
    // the Propagation, read from disk.
    const stored = createClaimStore(root).readClaim('c-snow')!;
    expect(stored.attested).toBe(true);
    expect(stored.body).toBe('The snow is gone, and the ridge is dry.');
    expect(stored.cites).toHaveLength(before.cites.length + 1);
    const cite = stored.cites[stored.cites.length - 1]!;
    expect(cite).toMatch(/@1$/);

    // The new Snippet holds the edit VERBATIM, provenance kind 'unprompted'
    // (the person's own words, nothing asked for them).
    const snippetId = cite.split('@')[0]!;
    const parsed = matter.read(join(root, 'snippets', snippetId, 'v1.md'));
    expect(parsed.content.trim()).toBe('The snow is gone, and the ridge is dry.');
    expect((parsed.data as { provenance: { kind: string } }).provenance.kind).toBe('unprompted');

    // Status is untouched — arithmetic owns it (Q-29), exactly as attest.
    expect(stored.status).toBe(before.status);
  });

  it('trims the edit once and keeps the interior verbatim', async () => {
    const res = await post('/api/wiki/claim/c-snow/edit', { body: '  The snow is gone,   and the ridge is dry.  ' });
    expect(res.status).toBe(200);
    const stored = createClaimStore(root).readClaim('c-snow')!;
    expect(stored.body).toBe('The snow is gone,   and the ridge is dry.');
  });

  it('answers 400 for a missing, empty, or non-string body — and writes no Snippet', async () => {
    const snippetsBefore = readdirSync(join(root, 'snippets')).length;
    await post('/api/wiki/claim/c-snow/edit');
    for (const body of ['', '   ', 42]) {
      const res = await post('/api/wiki/claim/c-snow/edit', { body });
      expect(res.status).toBe(400);
    }
    const stored = createClaimStore(root).readClaim('c-snow')!;
    expect(stored.body).toBe('A sentence about c-snow.');
    expect(stored.attested).toBe(false);
    expect(readdirSync(join(root, 'snippets')).length).toBe(snippetsBefore);
  });

  it('answers 404 for an edit on a claim that is not there, and writes no Snippet', async () => {
    const snippetsBefore = readdirSync(join(root, 'snippets')).length;
    const res = await post('/api/wiki/claim/nosuchclaim/edit', { body: 'Anything.' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown claim' });
    expect(readdirSync(join(root, 'snippets')).length).toBe(snippetsBefore);
  });
});
