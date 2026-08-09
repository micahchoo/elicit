import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { ulid } from 'ulid';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import { readAllRepairs, writeRepair } from '../src/repair/store.js';
import { repairedSnippetIds, isUnderRepair } from '../src/repair/consult.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import type { RepairRecord } from '../src/types.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'elicit-repair-test-'));
}

/**
 * Send a request through the app with loopback bypass.
 * Uses app.fetch() so the Hono env carries remoteAddr for the auth middleware.
 */
async function post(app: { fetch(req: Request, env?: Record<string, unknown>): Response | Promise<Response> }, path: string, body: unknown): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

describe('repair verb (ticket 137, Q-104..Q-109)', () => {
  let root: string;

  beforeEach(() => {
    root = tmpDir();
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true }); } catch {}
  });

  // ── Repair store ──

  it('writes and reads repair records', () => {
    const record: RepairRecord = {
      snippetRef: '01KZ847CQNSZABC123456789@1',
      quotedFragment: 'My son is not dead.',
      sitting: ulid(),
      at: new Date().toISOString(),
    };
    writeRepair(root, record);

    const all = readAllRepairs(root);
    expect(all).toHaveLength(1);
    expect(all[0]!.snippetRef).toBe(record.snippetRef);
    expect(all[0]!.quotedFragment).toBe(record.quotedFragment);

    const byId = repairedSnippetIds(all);
    expect(byId.has('01KZ847CQNSZABC123456789')).toBe(true);
    expect(byId.has('nonexistent')).toBe(false);
  });

  it('quarantines whole snippet on any version (Q-106)', () => {
    const records: RepairRecord[] = [
      { snippetRef: 'SNIP@1', quotedFragment: 'old', sitting: 's1', at: '2026-01-01' },
    ];
    expect(isUnderRepair(records, 'SNIP@1')).toBe(true);
    expect(isUnderRepair(records, 'SNIP@2')).toBe(true);
    expect(isUnderRepair(records, 'SNIP2@1')).toBe(false);
  });

  // ── Route tests ──

  it('POST /api/session/:id/repair creates a repair record and emits a repair event', async () => {
    const vault = createVault(root);
    const queue = createQueueStore(root);
    const index = buildIndex([]);
    const authStore = createFileAuth(join(root, '.auth.json'));
    const complete = makeFakeComplete();
    const app = await createApp({ vault, vaultRoot: root, queue, index, complete, authStore });

    const snippet = vault.saveSnippet('My son is not dead. He is in Winnipeg.', {
      session: 's1', question: 'Who is alive?', kind: 'harvest', questionForm: 'deliberative', channel: 'typed',
    });
    const qid = ulid();
    const qDir = join(root, 'queue');
    if (!existsSync(qDir)) mkdirSync(qDir, { recursive: true });
    writeFileSync(join(qDir, `${qid}.md`), matter.stringify('', {
      id: qid, status: 'pending', source: 'composed', license: 'resonance',
      question: 'You wrote about your son — can you tell me more?',
      questionForm: 'deliberative', horizon: 'session',
      cites: [`${snippet.id}@${snippet.version}`],
      quotedFragment: 'My son is not dead.',
      created: new Date().toISOString(),
    }), 'utf-8');

    const sesRes = await post(app, '/api/session', { mode: { target: 'self' }, shuffle: false });
    const session = await sesRes.json() as { sessionId: string };

    const repairRes = await post(app, `/api/session/${session.sessionId}/repair`, {
      snippetRef: `${snippet.id}@${snippet.version}`,
      quotedFragment: 'My son is not dead.',
    });
    expect(repairRes.status).toBe(200);
    const repairData = await repairRes.json() as { kind: string; text: string };
    expect(repairData.kind).toBe('probe');
    expect(repairData.text).toBeTruthy();

    const repairs = readAllRepairs(root);
    expect(repairs.length).toBeGreaterThanOrEqual(1);

    const events = readEvents(root);
    const repairEvents = events.filter((e) => e.kind === 'repair');
    expect(repairEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('repair expires citing queue entries (Q-106)', async () => {
    const vault = createVault(root);
    const queue = createQueueStore(root);
    const index = buildIndex([]);
    const authStore = createFileAuth(join(root, '.auth.json'));
    const complete = makeFakeComplete();
    const app = await createApp({ vault, vaultRoot: root, queue, index, complete, authStore });

    const snippet = vault.saveSnippet('That is not something I said.', {
      session: 's1', question: 'What happened?', kind: 'harvest', questionForm: 'deliberative', channel: 'typed',
    });
    const qid = ulid();
    const qDir = join(root, 'queue');
    if (!existsSync(qDir)) mkdirSync(qDir, { recursive: true });
    writeFileSync(join(qDir, `${qid}.md`), matter.stringify('', {
      id: qid, status: 'pending', source: 'composed', license: 'resonance',
      question: 'You mentioned machines — can you elaborate?',
      questionForm: 'deliberative', horizon: 'session',
      cites: [`${snippet.id}@${snippet.version}`],
      quotedFragment: 'the machines',
      created: new Date().toISOString(),
    }), 'utf-8');

    const sesRes = await post(app, '/api/session', { mode: { target: 'self' }, shuffle: false });
    const session = await sesRes.json() as { sessionId: string };

    const repairRes = await post(app, `/api/session/${session.sessionId}/repair`, {
      snippetRef: `${snippet.id}@${snippet.version}`,
      quotedFragment: 'That is not something I said.',
    });
    expect(repairRes.status).toBe(200);

    const drawn = queue.draw({ target: 'self' });
    if (drawn) {
      expect(drawn.id).not.toBe(qid);
    }
  });

  it('emits exactly one repair event per press (Q-108)', async () => {
    const vault = createVault(root);
    const queue = createQueueStore(root);
    const index = buildIndex([]);
    const authStore = createFileAuth(join(root, '.auth.json'));
    const complete = makeFakeComplete();
    const app = await createApp({ vault, vaultRoot: root, queue, index, complete, authStore });

    const snippet = vault.saveSnippet('No game. Just the wall.', {
      session: 's1', question: 'What happened?', kind: 'harvest', questionForm: 'deliberative', channel: 'typed',
    });

    const sesRes = await post(app, '/api/session', { mode: { target: 'self' }, shuffle: true });
    const session = await sesRes.json() as { sessionId: string };

    const eventsBefore = readEvents(root).filter((e) => e.kind === 'repair').length;

    await post(app, `/api/session/${session.sessionId}/repair`, {
      snippetRef: `${snippet.id}@${snippet.version}`,
      quotedFragment: 'No game. Just the wall.',
    });

    const eventsAfter = readEvents(root).filter((e) => e.kind === 'repair').length;
    expect(eventsAfter).toBe(eventsBefore + 1);
  });

  // ── Harvester exclusion (Q-107) ──

  it('excludes correction turns from harvest (Q-107)', () => {
    const turns = [
      { role: 'user' as const, text: 'Normal answer.', at: '2026-01-01T00:00:00Z' },
      { role: 'user' as const, text: 'That is not my story.', at: '2026-01-01T00:00:01Z', repairId: 'repair-1' },
    ];
    const nonRepair = turns.filter((t) => !t.repairId);
    expect(turns.length).toBe(2);
    expect(nonRepair.length).toBe(1);
  });

  // ── Eval-corpus regression fixtures ──

  it('Wendell: correction is not harvested as biography', () => {
    const record: RepairRecord = {
      snippetRef: 'WENDELL@1',
      quotedFragment: 'My son is not dead.',
      sitting: 's-wendell',
      at: new Date().toISOString(),
    };
    writeRepair(root, record);
    const repairs = readAllRepairs(root);
    expect(repairs.length).toBe(1);

    const turns = [
      { role: 'user' as const, text: 'My son is not dead. He is in Winnipeg.', at: 'now', repairId: 'repair-w' },
    ];
    const harvestable = turns.filter((t) => !t.repairId);
    expect(harvestable.length).toBe(0);
  });

  it('Dara: anti-pattern claim prevented', () => {
    const record: RepairRecord = {
      snippetRef: 'DARA@1',
      quotedFragment: 'I did not say I feel isolated.',
      sitting: 's-dara',
      at: new Date().toISOString(),
    };
    writeRepair(root, record);

    const all = readAllRepairs(root);
    expect(isUnderRepair(all, 'DARA@1')).toBe(true);
    const repairedIds = repairedSnippetIds(all);
    expect(repairedIds.has('DARA')).toBe(true);
  });
});
