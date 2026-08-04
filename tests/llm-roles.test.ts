import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { roleConfig, describeRole, makeComplete } from '../src/llm.js';
import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import type { Complete, CutProposal } from '../src/types.js';

/**
 * Counts docket runs and, on request, proves one SUCCEEDED.
 *
 * `onDocketSettled` fires when a run ends, whether it finished its work or
 * threw — server.ts catches its own errors so a background failure never
 * becomes an unhandled rejection. Settling is therefore evidence that a run
 * stopped, never that it did its job, and a test that waits for settle and
 * then reads an artifact reports a docket failure as a missing file. Anything
 * asserting on what a run produced goes through `succeeded` first.
 */
function docketBarrier(vaultDir: () => string) {
 let settled = 0;
 return {
  onDocketSettled(): void {
   settled++;
  },
  async succeeded(n: number): Promise<void> {
   const deadline = Date.now() + 10_000;
   while (settled < n) {
    if (Date.now() > deadline) {
     throw new Error(`waited for docket run ${n}; only ${settled} settled`);
    }
    await new Promise((r) => setTimeout(r, 5));
   }
   const events = readEvents(vaultDir());
   const failed = events.filter((e) => e.kind === 'docket-run-failed');
   if (failed.length > 0) {
    throw new Error(`docket run failed: ${failed.map((e) => e.detail).join('; ')}`);
   }
   const completed = events.filter((e) => e.kind === 'docket-run').length;
   if (completed < n) {
    throw new Error(`${settled} docket runs settled but only ${completed} completed`);
   }
  },
 };
}

const ROLE_ENV = [
 'ELICIT_LLM_BASE_URL',
 'ELICIT_LLM_MODEL',
 'ELICIT_CLERK_BASE_URL',
 'ELICIT_CLERK_MODEL',
] as const;

/** Model calls tagged by which role's Complete answered them. */
function taggedComplete(tag: string, log: string[], reply: () => string): Complete {
 return async () => {
  log.push(tag);
  return reply();
 };
}

/** One cut, so an unprompted entry becomes one snippet. */
const oneCut = JSON.stringify({
 cuts: [
  {
   text: 'I keep choosing the work that looks impressive.',
   sourceTurn: 0,
   facet: 'intention',
   stance: 'avowal',
   reading: 'Impressiveness drives the choice',
   standalone: true,
  },
 ],
});

async function call(app: Awaited<ReturnType<typeof createApp>>, path: string, body?: unknown): Promise<Response> {
 const init: RequestInit =
  body === undefined
   ? { method: 'GET' }
   : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
 return app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
}

/**
 * The harvest runs behind the /unprompted response and lands in the review
 * queue on disk (ticket 084). Polling is the only wait available: the record
 * appears from a background setImmediate in the server process, which fake
 * timers cannot advance, so this deliberately polls the real clock.
 */
async function waitForProposals(
 app: Awaited<ReturnType<typeof createApp>>,
 sessionId: string,
 timeoutMs = 5000,
): Promise<CutProposal[]> {
 const deadline = Date.now() + timeoutMs;
 for (; ;) {
  const res = await call(app, `/api/harvest-queue/${sessionId}`);
  if (res.status === 200) {
   const body = (await res.json()) as { proposals: CutProposal[] };
   return body.proposals;
  }
  if (Date.now() > deadline) throw new Error(`harvest for ${sessionId} never landed`);
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

describe('role configuration', () => {
 const saved = new Map<string, string | undefined>();

 beforeEach(() => {
  for (const key of ROLE_ENV) {
   saved.set(key, process.env[key]);
   delete process.env[key];
  }
 });

 afterEach(() => {
  for (const key of ROLE_ENV) {
   const value = saved.get(key);
   if (value === undefined) delete process.env[key];
   else process.env[key] = value;
  }
 });

 it('defaults each role to its own endpoint (Q-48)', () => {
  const elicitor = roleConfig('elicitor');
  const clerk = roleConfig('clerk');

  expect(elicitor.modelId).toBe('bonsai-27b');
  expect(elicitor.baseUrl).toBe('http://127.0.0.1:8088/v1');
  expect(clerk.modelId).toBe('gemma4:e4b');
  expect(clerk.baseUrl).toBe('http://127.0.0.1:11434/v1');
  // The point of the split: two different backends, not two names for one.
  expect(elicitor.baseUrl).not.toBe(clerk.baseUrl);
 });

 it('points each role by its own env vars, leaving the other alone', () => {
  process.env.ELICIT_CLERK_BASE_URL = 'http://127.0.0.1:9001/v1';
  process.env.ELICIT_CLERK_MODEL = 'qwen3.6:27b';

  expect(roleConfig('clerk')).toEqual({
   role: 'clerk',
   baseUrl: 'http://127.0.0.1:9001/v1',
   modelId: 'qwen3.6:27b',
  });
  expect(roleConfig('elicitor').baseUrl).toBe('http://127.0.0.1:8088/v1');

  process.env.ELICIT_LLM_MODEL = 'bonsai-9b';
  expect(roleConfig('elicitor').modelId).toBe('bonsai-9b');
  expect(roleConfig('clerk').modelId).toBe('qwen3.6:27b');
 });

 it('names the role and endpoint in one line', () => {
  expect(describeRole(roleConfig('clerk'))).toBe('clerk: gemma4:e4b @ http://127.0.0.1:11434/v1');
 });

 // ── ADR-0001: both endpoints local, always ──

 it('never reaches a hosted provider', () => {
  const source = readFileSync(new URL('../src/llm.ts', import.meta.url), 'utf-8');
  expect(source).not.toMatch(/api\.openai|api\.anthropic/);
 });

 it('defaults both roles to private addresses', () => {
  for (const role of ['elicitor', 'clerk'] as const) {
   const host = new URL(roleConfig(role).baseUrl).hostname;
   // RFC1918 or loopback — nothing routable off the LAN.
   expect(host).toMatch(/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$)/);
  }
 });

 // ── Degrade honestly: say which role died, never borrow the other's model ──

 it('names the failing role, its model and its endpoint when the endpoint is down', async () => {
  // Port 9 is discard: the connection is refused at once.
  process.env.ELICIT_CLERK_BASE_URL = 'http://127.0.0.1:9/v1';
  const clerk = makeComplete('clerk');

  await expect(clerk('system', [{ role: 'user', text: 'hello', at: '' }])).rejects.toThrow(
   /clerk model call failed — gemma4:e4b at http:\/\/127\.0\.0\.1:9\/v1/,
  );
 });
});

describe('server role wiring', () => {
 let vaultDir: string;

 beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-roles-'));
 });

 afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('sends foreground work to the elicitor and background work to the clerk', async () => {
  const log: string[] = [];
  const vault = createVault(vaultDir);
  const docket = docketBarrier(() => vaultDir);
  const app = await createApp({
   vault,
   complete: taggedComplete('elicitor', log, () => '{}'),
   clerk: { complete: taggedComplete('clerk', log, () => oneCut), modelName: 'clerk-model' },
   queue: createQueueStore(vaultDir),
   index: buildIndex([]),
   vaultRoot: vaultDir,
   authStore: createFileAuth(join(vaultDir, '.auth.json')),
   onDocketSettled: docket.onDocketSettled,
  });
  await docket.succeeded(1);

  // Harvest extraction is background work — nobody waits on it (Q-48).
  const entryRes = await call(app, '/api/unprompted', {
   text: 'I keep choosing the work that looks impressive.',
  });
  const entry = (await entryRes.json()) as { sessionId: string };
  expect(entry.sessionId).toBeTypeOf('string');
  // The harvest runs behind the response (ticket 084): wait for its record
  // so the background clerk call is observable before the log is read.
  const proposals = await waitForProposals(app, entry.sessionId);
  expect(proposals.length).toBe(1);
  expect(log).toEqual(['clerk']);

  // A sitting is foreground work: a person is waiting on every turn.
  log.length = 0;
  const sessRes = await call(app, '/api/session', {
   mode: { minutes: 10, energy: 'medium', target: 'self' },
  });
  const { sessionId } = (await sessRes.json()) as { sessionId: string };
  await call(app, `/api/session/${sessionId}/turn`, { text: 'It is the applause I am after.' });
  expect(log.length).toBeGreaterThan(0);
  expect(new Set(log)).toEqual(new Set(['elicitor']));

  // The docket the harvest kicks off is the clerk's.
  log.length = 0;
  await call(app, `/api/session/${entry.sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'approve' }],
  });
  await docket.succeeded(2);
  expect(log.length).toBeGreaterThan(0);
  expect(new Set(log)).toEqual(new Set(['clerk']));
 });

 it('stamps a Cover summary with the clerk model, never the elicitor one (Q-34)', async () => {
  const vault = createVault(vaultDir);
  // Two sittings on disk are what a consolidation needs.
  for (const session of ['session-one', 'session-two']) {
   const at = new Date().toISOString();
   vault.startTranscript(session, {
    mode: { minutes: 10, energy: 'medium', target: 'self' },
    protocol: 'reflective',
    started: at,
   });
   vault.appendTurn(session, { role: 'user', text: 'Some words from a sitting.', at });
  }

  const log: string[] = [];
  const docket = docketBarrier(() => vaultDir);
  await createApp({
   vault,
   complete: taggedComplete('elicitor', log, () => 'elicitor line'),
   clerk: {
    complete: taggedComplete('clerk', log, () => 'the clerk summarized two sittings'),
    modelName: 'qwen3.6:35b',
   },
   queue: createQueueStore(vaultDir),
   index: buildIndex([]),
   vaultRoot: vaultDir,
   authStore: createFileAuth(join(vaultDir, '.auth.json')),
   modelName: 'bonsai-27b',
   onDocketSettled: docket.onDocketSettled,
  });
  await docket.succeeded(1);

  // The consolidation is a clerk call and nothing else answered it.
  expect(new Set(log)).toEqual(new Set(['clerk']));

  // Which sittings get bracketed, and in which order, depends on their
  // `started` timestamps — two written in one tick may or may not share a
  // millisecond. The stamp is the claim here, so read whatever was written.
  const summaryDir = join(vaultDir, 'marginalia', 'transcript-summaries');
  expect(existsSync(summaryDir)).toBe(true);
  const summaries = readdirSync(summaryDir)
   .filter((f) => f.endsWith('.md'))
   .map((f) => matter(readFileSync(join(summaryDir, f), 'utf-8')));

  expect(summaries.length).toBeGreaterThan(0);
  for (const summary of summaries) {
   expect(summary.data.model).toBe('qwen3.6:35b');
   expect(summary.content.trim()).toBe('the clerk summarized two sittings');
  }
 });
});
