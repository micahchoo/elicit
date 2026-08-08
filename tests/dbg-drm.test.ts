import { describe, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { writeDRM } from '../src/drm/park.js';
import type { DRMParkedState } from '../src/drm/types.js';

describe('dbg', () => {
 it('legacy resume', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elicit-drm-dbg-'));
  try {
   const vault = createVault(root);
   const queue = createQueueStore(root);
   const app = await createApp({ vault, complete: makeScriptedComplete([]), queue, index: buildIndex([]), vaultRoot: root, authStore: createFileAuth(join(root, '.auth.json')) });
   const post = async <T>(path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const init: RequestInit = body === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
    return { status: res.status, body: await res.json() as T };
   };
   const legacy: DRMParkedState = {
    id: 'drm-legacy-1', session: 'old', yesterday: '2026-08-05', phase: 'parked',
    episodes: [
     { name: 'morning coffee', startHour: 7, probes: { place: 'kitchen', activity: 'drinking coffee', 'who-with': 'alone', affect: 'calm' } },
     { name: 'commute', startHour: 8, probes: { place: null, activity: null, 'who-with': null, affect: null } },
    ],
    currentEpisodeIdx: 1, probeStep: 'place', fragments: [],
    started: '2026-08-05T18:00:00.000Z', ended: '2026-08-05T18:30:00.000Z', endedBy: 'park',
   };
   writeDRM(root, legacy);
   const ptr = queue.add({ source: 'parked-drm', license: 'user', question: 'DRM: morning coffee', questionForm: 'deliberative', sharpness: 'weak', horizon: 'session', drmId: legacy.id });
   console.log('pointer', JSON.stringify(ptr));
   console.log('drm file exists', existsSync(join(root, 'drm', 'drm-legacy-1.md')));
   const s = await post<{ sessionId: string }>('/api/session', { mode: { minutes: 20, energy: 'medium', topic: 'the orchard' }, protocol: 'reflective' });
   console.log('session', s.status, JSON.stringify(s.body));
   const r = await post<Record<string, unknown>>(`/api/session/${s.body.sessionId}/drm/resume`, { queueEntryId: ptr.id });
   console.log('resume', r.status, JSON.stringify(r.body));
  } finally { rmSync(root, { recursive: true, force: true }); }
 });
});
