import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';

/**
 * The 145 remainder — idempotency for headless callers. A script whose
 * request timed out retries it; with an `Idempotency-Key` header the retry
 * gets the FIRST response instead of a second side effect. Opt-in: no
 * header, no dedupe (the browser never sends one).
 */
describe('idempotency for headless callers (145 remainder)', () => {
 let app: Hono;
 let root: string;
 const ENV = { remoteAddr: '127.0.0.1' };

 const open = (key?: string) =>
  app.fetch(
   new Request('http://localhost/api/session', {
    method: 'POST',
    headers: {
     'content-type': 'application/json',
     ...(key ? { 'idempotency-key': key } : {}),
    },
    body: JSON.stringify({ mode: { target: 'self' } }),
   }),
   ENV,
  );

 beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'elicit-idem-'));
  const vault = createVault(root);
  app = await createApp({
   vault,
   complete: makeFakeComplete(),
   queue: createQueueStore(root),
   index: buildIndex([]),
   vaultRoot: root,
   authStore: createFileAuth(join(root, '.auth.json')),
  });
 });

 afterAll(() => {
  rmSync(root, { recursive: true, force: true });
 });

 it('replays the first response for a repeated key — one sitting, not two', async () => {
  const first = await (await open('key-1')).json() as { sessionId: string };
  const res2 = await open('key-1');
  expect(res2.headers.get('idempotency-replayed')).toBe('true');
  const second = await res2.json() as { sessionId: string };
  expect(second.sessionId).toBe(first.sessionId);
 });

 it('different keys run independently', async () => {
  const a = await (await open('key-a')).json() as { sessionId: string };
  const b = await (await open('key-b')).json() as { sessionId: string };
  expect(a.sessionId).not.toBe(b.sessionId);
 });

 it('no header means no dedupe', async () => {
  const a = await (await open()).json() as { sessionId: string };
  const b = await (await open()).json() as { sessionId: string };
  expect(a.sessionId).not.toBe(b.sessionId);
 });

 it('a concurrent duplicate shares the in-flight response — the timeout-retry case', async () => {
  const [resA, resB] = await Promise.all([open('key-race'), open('key-race')]);
  const a = await resA.json() as { sessionId: string };
  const b = await resB.json() as { sessionId: string };
  expect(a.sessionId).toBe(b.sessionId);
  // Exactly one of the pair is the replay.
  const replays = [resA, resB].filter((r) => r.headers.get('idempotency-replayed') === 'true');
  expect(replays.length).toBe(1);
 });

 it('keys are route-scoped — the same key on another route still runs', async () => {
  const opened = await (await open('key-scoped')).json() as { sessionId: string };
  const turn = await app.fetch(
   new Request(`http://localhost/api/session/${opened.sessionId}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'key-scoped' },
    body: JSON.stringify({ text: 'A first answer, long enough to carry a proposition.' }),
   }),
   ENV,
  );
  // Not a replayed /api/session response: the turn route actually ran.
  expect(turn.headers.get('idempotency-replayed')).toBeNull();
  const body = await turn.json() as { kind?: string };
  expect(body.kind).toBeDefined();
 });
});
