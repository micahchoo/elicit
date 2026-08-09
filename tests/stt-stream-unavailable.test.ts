/**
 * Streaming transcribe availability (R4): the open route 503s when the STT
 * client cannot stream, so the browser's dictation falls back to the
 * one-shot POST. Each scenario builds a FRESH app: getSttClient caches the
 * first injected client per module instance (src/server.ts), so
 * vi.resetModules gives each test its own module registry.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScriptedComplete } from './fakes.js';
import type { SttClient } from '../src/stt/client.js';

const scriptedResponses = ['{}'];

async function buildApp(sttClient: SttClient): Promise<{ fetch: (req: Request) => Promise<Response>; cookie: string }> {
 vi.resetModules();
 const [{ createApp }, { createVault }, { createQueueStore }, { buildIndex }, { createFileAuth }] = await Promise.all([
  import('../src/server.js'),
  import('../src/vault/vault.js'),
  import('../src/queue/queue.js'),
  import('../src/index/lexical.js'),
  import('../src/auth/auth.js'),
 ]);
 const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-stt-unavailable-'));
 const vault = createVault(vaultDir);
 const complete = makeScriptedComplete(scriptedResponses);
 const queue = createQueueStore(vaultDir);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(vaultDir, '.auth.json'));
 authStore.setup('secret');

 const app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore, sttClient });
 const loginRes = await app.fetch(new Request('http://localhost/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'secret' }),
 }), { remoteAddr: '127.0.0.1' });
 const cookie = /elicit_session=([^;]+)/.exec(loginRes.headers.get('Set-Cookie')!)![1]!;
 return { fetch: async (req) => app.fetch(req, { remoteAddr: '127.0.0.1' }), cookie };
}

describe('streaming transcribe availability (R4)', () => {
 it('answers 503 when the injected client has no streaming surface', async () => {
  const { fetch, cookie } = await buildApp({
   transcribe: async () => ({ text: 'x', tokens: [], timestamps: [], durations: [] }),
   dispose: () => {},
  });
  const res = await fetch(new Request('http://localhost/api/transcribe/stream/open', {
   method: 'POST',
   headers: { Cookie: `elicit_session=${cookie}` },
  }));
  expect(res.status).toBe(503);
  const body = await res.json() as { error?: string };
  expect(body.error).toBe('STT model not available');
 });

 it('answers 503 when the worker cannot open the stream', async () => {
  const { fetch, cookie } = await buildApp({
   transcribe: async () => ({ text: 'x', tokens: [], timestamps: [], durations: [] }),
   dispose: () => {},
   openStream: async () => { throw new Error('model load failed'); },
  });
  const res = await fetch(new Request('http://localhost/api/transcribe/stream/open', {
   method: 'POST',
   headers: { Cookie: `elicit_session=${cookie}` },
  }));
  expect(res.status).toBe(503);
  const body = await res.json() as { error?: string };
  expect(body.error).toContain('model load failed');
 });
});
