/**
 * Streaming transcription (redesign wave 4, R4): the endpoint cluster and
 * the client protocol round-trip, both against fakes — real sherpa STT
 * cannot run in CI (no model), so the plumbing is pinned instead.
 *
 * Server side: a fake SttClient with a streaming surface is injected via
 * the getSttClient deps seam (createApp's sttClient); the test drives
 * open → audio → end and reads the SSE partial feed.
 *
 * Client side: a fake WORKER (tests/fixtures/fake-stt-worker.ts) speaks
 * the real stdio protocol, so the real client's openStream/pushAudio/end
 * correlation runs over a real pipe without the native addon.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createSttClient, type SttClient, type SttStreamPartial } from '../src/stt/client.js';
import { readEvents } from '../src/log/activity.js';

const scriptedResponses = ['{}'];

/** A fake streaming client: one partial per audio push, a final on end. */
function fakeStreamingClient(): SttClient {
 return {
  transcribe: async () => ({ text: 'one-shot', tokens: [], timestamps: [], durations: [] }),
  dispose: () => {},
  openStream: async () => {
   const partialCbs = new Set<(p: SttStreamPartial) => void>();
   return {
    streamId: 's-fake-1',
    pushAudio: () => {
     queueMicrotask(() => {
      for (const cb of partialCbs) cb({ text: 'par tial', final: false });
     });
    },
    end: async () => {
     queueMicrotask(() => {
      for (const cb of partialCbs) cb({ text: 'final text', final: true });
     });
     return { text: 'final text', tokens: [], timestamps: [], durations: [] };
    },
    onPartial: (cb) => {
     partialCbs.add(cb);
     return () => { partialCbs.delete(cb); };
    },
    onError: () => () => {},
   };
  },
 };
}

function authed(cookie: string, init: RequestInit = {}): RequestInit {
 return { ...init, headers: { Cookie: `elicit_session=${cookie}`, ...(init.headers ?? {}) } };
}

/** Read the SSE body until `marker` appears (or the stream ends). */
async function readSseUntil(res: Response, marker: string, timeoutMs = 3000): Promise<string> {
 const reader = res.body!.getReader();
 const decoder = new TextDecoder();
 let buf = '';
 const deadline = Date.now() + timeoutMs;
 while (Date.now() < deadline) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  if (buf.includes(marker)) break;
 }
 return buf;
}

describe('streaming transcribe endpoints (R4)', () => {
 let app: Hono;
 let cookie: string;
 let vaultDir: string;

 beforeEach(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-stt-stream-'));
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const index = buildIndex([]);
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');
  app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore, sttClient: fakeStreamingClient() });
  const loginRes = await app.fetch(new Request('http://localhost/api/login', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: 'secret' }),
  }), { remoteAddr: '127.0.0.1' });
  const setCookie = loginRes.headers.get('Set-Cookie')!;
  cookie = /elicit_session=([^;]+)/.exec(setCookie)![1]!;
 });

 afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('open → audio → end streams partials over SSE and returns the final text', async () => {
  const openRes = await app.fetch(new Request('http://localhost/api/transcribe/stream/open', authed(cookie, { method: 'POST' })), { remoteAddr: '127.0.0.1' });
  expect(openRes.status).toBe(200);
  const { streamId } = await openRes.json() as { streamId: string };
  expect(streamId).toBeTruthy();

  // Subscribe BEFORE pushing audio so no partial can be missed.
  const eventsRes = await app.fetch(new Request(`http://localhost/api/transcribe/stream/${streamId}/events`, authed(cookie, { headers: { accept: 'text/event-stream' } })), { remoteAddr: '127.0.0.1' });
  expect(eventsRes.status).toBe(200);

  const audio = new Float32Array(4000); // 250ms of 16 kHz
  const audioRes = await app.fetch(new Request(`http://localhost/api/transcribe/stream/${streamId}/audio?rate=16000`, authed(cookie, { method: 'POST', body: audio.buffer })), { remoteAddr: '127.0.0.1' });
  expect(audioRes.status).toBe(200);

  const endRes = await app.fetch(new Request(`http://localhost/api/transcribe/stream/${streamId}/end`, authed(cookie, { method: 'POST' })), { remoteAddr: '127.0.0.1' });
  expect(endRes.status).toBe(200);
  const final = await endRes.json() as { text: string };
  expect(final.text).toBe('final text');

  const sse = await readSseUntil(eventsRes, 'event: final');
  expect(sse).toContain('event: partial');
  expect(sse).toContain('data: {"text":"par tial"}');
  expect(sse).toContain('event: final');
  expect(sse).toContain('data: {"text":"final text"}');
 });

 it('rejects misaligned audio chunks', async () => {
  const openRes = await app.fetch(new Request('http://localhost/api/transcribe/stream/open', authed(cookie, { method: 'POST' })), { remoteAddr: '127.0.0.1' });
  const { streamId } = await openRes.json() as { streamId: string };

  const bad = new Uint8Array(6); // not a multiple of 4 bytes
  const res = await app.fetch(new Request(`http://localhost/api/transcribe/stream/${streamId}/audio`, authed(cookie, { method: 'POST', body: bad })), { remoteAddr: '127.0.0.1' });
  expect(res.status).toBe(400);
 });

 it('answers 404 for unknown streams on audio, end and events', async () => {
  const audioRes = await app.fetch(new Request('http://localhost/api/transcribe/stream/nope/audio', authed(cookie, { method: 'POST', body: new Float32Array(4).buffer })), { remoteAddr: '127.0.0.1' });
  expect(audioRes.status).toBe(404);

  const endRes = await app.fetch(new Request('http://localhost/api/transcribe/stream/nope/end', authed(cookie, { method: 'POST' })), { remoteAddr: '127.0.0.1' });
  expect(endRes.status).toBe(404);

  const eventsRes = await app.fetch(new Request('http://localhost/api/transcribe/stream/nope/events', authed(cookie)), { remoteAddr: '127.0.0.1' });
  expect(eventsRes.status).toBe(404);
 });

 it('the stream end emits the transcribed activity event (kind reused)', async () => {
  const openRes = await app.fetch(new Request('http://localhost/api/transcribe/stream/open', authed(cookie, { method: 'POST' })), { remoteAddr: '127.0.0.1' });
  const { streamId } = await openRes.json() as { streamId: string };
  await app.fetch(new Request(`http://localhost/api/transcribe/stream/${streamId}/audio`, authed(cookie, { method: 'POST', body: new Float32Array(4000).buffer })), { remoteAddr: '127.0.0.1' });
  const endRes = await app.fetch(new Request(`http://localhost/api/transcribe/stream/${streamId}/end`, authed(cookie, { method: 'POST' })), { remoteAddr: '127.0.0.1' });
  expect(endRes.status).toBe(200);

  const transcribed = readEvents(vaultDir).filter((e) => e.kind === 'transcribed');
  expect(transcribed.length).toBe(1);
  expect(transcribed[0]!.actor).toBe('system');
  expect(transcribed[0]!.detail).toMatch(/stream \d+chars/);
 });
});

describe('client streaming over the real stdio pipe (fake worker)', () => {
 let modelDir: string;

 beforeEach(() => {
  modelDir = mkdtempSync(join(tmpdir(), 'stt-fake-model-'));
  for (const f of ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']) {
   writeFileSync(join(modelDir, f), 'fake');
  }
  process.env['ELICIT_STT_MODEL_DIR'] = modelDir;
 });

 afterEach(() => {
  delete process.env['ELICIT_STT_MODEL_DIR'];
  rmSync(modelDir, { recursive: true, force: true });
 });

 const fakeWorkerPath = () => new URL('./fixtures/fake-stt-worker.ts', import.meta.url).pathname;

 it('round-trips open → audio → partial → end', async () => {
  const client = createSttClient({ workerPath: fakeWorkerPath() });
  try {
   const stream = await client.openStream!();
   const partials: string[] = [];
   const unsub = stream.onPartial((p) => partials.push(p.text));
   stream.pushAudio(new Float32Array(1600), 16000);
   stream.pushAudio(new Float32Array(1600), 16000);
   const result = await stream.end();
   unsub();
   expect(partials).toContain('hello');
   expect(result.text).toBe('hello world');
  } finally {
   client.dispose();
  }
 });

 it('keeps the one-shot transcribe path', async () => {
  const client = createSttClient({ workerPath: fakeWorkerPath() });
  try {
   const result = await client.transcribe(new Float32Array(1600), 16000);
   expect(result.text).toBe('one shot');
   expect(result.tokens).toEqual(['one', 'shot']);
  } finally {
   client.dispose();
  }
 });
});
