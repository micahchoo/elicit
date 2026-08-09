/**
 * The declaration route (redesign wave 4): POST /api/session/:id/declare
 * names what this sitting is about. The topic lands on the sitting Mode
 * (state.mode.topic) and the NEXT composed probe carries it — the generic
 * probe prompt and the machine composition seam both read mode.topic in
 * the elicitor, so whichever channel asks, the sitting stays on its
 * named subject. Same guards as the turn route: unknown session 404,
 * blank topic 400.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';
import type { Complete } from '../src/types.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';

const roots: string[] = [];

afterAll(() => {
 for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A scripted Complete that also records every system prompt it was handed,
 * so a test can read the exact prompt a probe was composed from.
 */
function recordingComplete(responses: string[]): { complete: Complete; systems: string[] } {
 let i = 0;
 const systems: string[] = [];
 return {
  complete: async (system, _turns, _opts) => {
   systems.push(system);
   if (i >= responses.length) {
    throw new Error(`recordingComplete exhausted after ${responses.length} response(s)`);
   }
   return responses[i++]!;
  },
  systems,
 };
}

async function makeApp(script: string[]): Promise<{ app: Hono; root: string; systems: string[] }> {
 const root = mkdtempSync(join(tmpdir(), 'elicit-declare-'));
 roots.push(root);
 const vault = createVault(root);
 const { complete, systems } = recordingComplete(script);
 const queue = createQueueStore(root);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(root, '.auth.json'));
 const app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore });
 return { app, root, systems };
}

async function post(app: Hono, path: string, body?: unknown): Promise<Response> {
 const init: RequestInit =
  body === undefined
   ? { method: 'POST' }
   : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
 return app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
}

const TOPIC = 'the pull of the work';

describe('session declaration (redesign wave 4)', () => {
 it('declare sets mode.topic and the next probe prompt carries it', async () => {
  // One turn, scripted so the reflective machine falls through to the
  // generic probe: redLights, the machine question rejected twice
  // (conversation-referential), then the generic probe that serves. The
  // declared topic must ride BOTH composing prompts.
  const { app, root, systems } = await makeApp([
   '{}',                                                    // redLights — no lights
   'What are you trying to achieve in this conversation?',   // machine question — rejected
   'What are you trying to achieve in this conversation?',   // machine retry — rejected
   'What keeps the pull present in your afternoons?',        // generic probe — served
  ]);

  const start = await post(app, '/api/session', {});
  expect(start.status).toBe(200);
  const { sessionId } = (await start.json()) as { sessionId: string };

  const declare = await post(app, `/api/session/${sessionId}/declare`, { topic: TOPIC });
  expect(declare.status).toBe(200);
  expect(await declare.json()).toEqual({ ok: true, topic: TOPIC });

  const turn = await post(app, `/api/session/${sessionId}/turn`, { text: 'I keep noticing the pull even when I resist it.' });
  expect(turn.status).toBe(200);
  const body = (await turn.json()) as { kind: string; text?: string };
  expect(body.kind).toBe('probe');
  expect(body.text).toBe('What keeps the pull present in your afternoons?');

  // The topic line rides the machine composition (calls 1-2) and the
  // generic probe prompt (call 3): whatever channel asks next, the
  // sitting stays on its named subject.
  const topicLine = `The sitting's declared subject: ${TOPIC}.`;
  expect(systems[1]!.includes(topicLine)).toBe(true);
  expect(systems[3]!.includes(topicLine)).toBe(true);

  // One activity event, naming the topic it set.
  const declared = readEvents(root).filter((e) => e.kind === 'topic-declared');
  expect(declared).toHaveLength(1);
  expect(declared[0]!.detail).toContain(`topic=${TOPIC}`);
 });

 it('a blank or missing topic 400s', async () => {
  const { app } = await makeApp([]);
  const start = await post(app, '/api/session', {});
  const { sessionId } = (await start.json()) as { sessionId: string };

  const blank = await post(app, `/api/session/${sessionId}/declare`, { topic: '   ' });
  expect(blank.status).toBe(400);
  expect(await blank.json()).toEqual({ error: 'topic is required' });

  const missing = await post(app, `/api/session/${sessionId}/declare`, {});
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: 'topic is required' });
 });

 it('declare on an unknown session 404s', async () => {
  const { app } = await makeApp([]);
  const res = await post(app, '/api/session/nope/declare', { topic: TOPIC });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'session not found' });
 });
});
