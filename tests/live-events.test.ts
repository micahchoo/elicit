import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { appendEvent, onAppend } from '../src/log/activity.js';

/**
 * Ticket 150 — the liveness feed. The Activity Log is the one spine every
 * actor writes through (Q-23); /api/events echoes each append as one SSE
 * event so open screens refresh without a manual reload.
 */
describe('live events (ticket 150)', () => {
 const roots: string[] = [];
 let app: Hono;
 let root: string;

 beforeAll(async () => {
  process.env.ELICIT_SSE_KEEPALIVE_MS = '50';
  root = mkdtempSync(join(tmpdir(), 'elicit-live-'));
  roots.push(root);
  const vault = createVault(root);
  const complete = makeScriptedComplete([]);
  const queue = createQueueStore(root);
  const index = buildIndex([]);
  const authStore = createFileAuth(join(root, '.auth.json'));
  app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore });
 });

 afterAll(() => {
  delete process.env.ELICIT_SSE_KEEPALIVE_MS;
  for (const r of roots) rmSync(r, { recursive: true, force: true });
 });

 it('onAppend fires after the line is written, scoped to its root', () => {
  const seen: string[] = [];
  const off = onAppend(root, (e) => seen.push(e.kind));
  appendEvent(root, { at: new Date().toISOString(), actor: 'elicitor', kind: 'pulse-answered', detail: 'chars=3' });
  // Another root's append never crosses over.
  const other = mkdtempSync(join(tmpdir(), 'elicit-live-other-'));
  roots.push(other);
  appendEvent(other, { at: new Date().toISOString(), actor: 'elicitor', kind: 'pulse-answered', detail: 'chars=9' });
  off();
  appendEvent(root, { at: new Date().toISOString(), actor: 'elicitor', kind: 'pulse-answered', detail: 'chars=1' });
  expect(seen).toEqual(['pulse-answered']);
 });

 it('an append reaches an open /api/events stream as one SSE event', async () => {
  const res = await app.fetch(
   new Request('http://localhost/api/events'),
   { remoteAddr: '127.0.0.1' },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  // Trigger a change AFTER the stream is open.
  appendEvent(root, { at: new Date().toISOString(), actor: 'clerk', kind: 'index-rebuilt', detail: 'snippets=0' });

  // Collect chunks until the event shows (pings may interleave).
  let collected = '';
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !collected.includes('index-rebuilt')) {
   const { value, done } = await reader.read();
   if (done) break;
   collected += decoder.decode(value);
  }
  await reader.cancel();

  expect(collected).toContain('data:');
  expect(collected).toContain('index-rebuilt');
  // The detail rides along for the client's no-change dedupe: a repeated
  // identical (kind, detail) pair is a heartbeat by definition.
  expect(collected).toContain('snippets=0');
 });
});
