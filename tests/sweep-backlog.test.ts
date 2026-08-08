/**
 * Ticket 156: GET /api/sweep-backlog grows per-sitting detail. The deferral
 * ledger (vault/wiki/sweep-deferral.jsonl) is an APPEND log — every line is
 * one sitting that left sweep work — so the history IS the per-sitting
 * detail. The route groups the full ledger by calendar day (the ISO date
 * portion, the same `YYYY-MM-DD` shard the Activity Log shards on) and sums
 * each day, most recent first, while the ticket-139 fields stay untouched.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';

type TestApp = {
  app: Hono;
  root: string;
};

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** The app over an empty vault; the boot docket settles with no model calls. */
async function makeApp(): Promise<TestApp> {
  const root = mkdtempSync(join(tmpdir(), 'elicit-sweep-backlog-'));
  roots.push(root);
  const vault = createVault(root);
  const complete = makeScriptedComplete([]);
  const queue = createQueueStore(join(root, 'queue'));
  const index = buildIndex([]);
  const authStore = createFileAuth(join(root, '.auth.json'));
  const app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore });
  return { app, root };
}

async function get(app: Hono, path: string): Promise<Response> {
  return await app.fetch(new Request(`http://localhost${path}`), { remoteAddr: '127.0.0.1' });
}

// The boot docket runs on setImmediate behind createApp; the docket-run
// event in the vault Activity Log is the only deterministic completion, so
// we poll for it rather than sleep a fixed window (the same settle signal
// the queue-routes harness uses). Deterministic timer control cannot work
// here: the run is a real async chain on the platform clock.
async function until<T>(fn: () => T | null | undefined, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

async function settleBootDocket(root: string): Promise<void> {
  await until(() => (readEvents(root).some((e) => e.kind === 'docket-run') ? true : null));
}

type SweepBacklog = {
  pendingReadings: number;
  freshReadings: number;
  lastRecorded: number;
  at: string | null;
  sittings: { date: string; readings: number }[];
};

/**
 * Hand-written ledger lines: explicit `at` timestamps so the day grouping is
 * pinned (the route slices the ISO date portion — no timezone dependence).
 * A corrupt trailing line mirrors a half-written append and must be skipped
 * without hiding the backlog above it (the sweep log's own leniency).
 */
const FIXTURE = [
  '{"at":"2026-08-03T09:14:00.000Z","remaining":12}',
  '{"at":"2026-08-04T14:02:00.000Z","remaining":3}',
  '{"at":"2026-08-04T18:45:00.000Z","remaining":8}',
  '{"at":"2026-08-06T08:30:00.000Z","remaining":5}',
  '{not json\n',
].join('\n');

describe('GET /api/sweep-backlog (ticket 156)', () => {
  it('returns the dated sittings from the ledger, most recent day first, with the ticket-139 fields unchanged', async () => {
    const { app, root } = await makeApp();
    await settleBootDocket(root);
    // Plant the ledger AFTER the boot run settles, so the boot's empty sweep
    // cannot claim or append to it — the GET then reads the fixture exactly.
    mkdirSync(join(root, 'wiki'), { recursive: true });
    writeFileSync(join(root, 'wiki', 'sweep-deferral.jsonl'), FIXTURE, 'utf-8');

    const res = await get(app, '/api/sweep-backlog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SweepBacklog;

    // The ticket-139 contract, byte for byte.
    expect(body.pendingReadings).toBe(0);
    expect(body.freshReadings).toBe(0);
    expect(body.lastRecorded).toBe(5); // last VALID line — the corrupt one is skipped
    expect(body.at).toBe('2026-08-06T08:30:00.000Z');

    // The new per-sitting detail: grouped by day, summed, newest first.
    expect(body.sittings).toEqual([
      { date: '2026-08-06', readings: 5 },
      { date: '2026-08-04', readings: 11 },
      { date: '2026-08-03', readings: 12 },
    ]);
  });

  it('an empty ledger reports no sittings and null last-recorded', async () => {
    const { app, root } = await makeApp();
    await settleBootDocket(root);

    const res = await get(app, '/api/sweep-backlog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SweepBacklog;

    expect(body.pendingReadings).toBe(0);
    expect(body.freshReadings).toBe(0);
    expect(body.lastRecorded).toBe(0);
    expect(body.at).toBeNull();
    expect(body.sittings).toEqual([]);
  });
});
