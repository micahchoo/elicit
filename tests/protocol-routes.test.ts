import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { loadProtocolDefinitions } from '../src/protocols/registry.js';

/**
 * Tickets 153/157 — the mode-screen protocol row's server contract:
 *  - GET /api/protocols serves the open set from the markdown-def registry
 *    (never a client-side hardcoded list), shaped
 *    [{ id, name, title, blurb?, rotation }] — title/blurb are the surface
 *    words, title falling back to the registry name for a def without one.
 *  - POST /api/session draws the protocol by deterministic rotation (canon
 *    §10 — patterns are drawn, not chosen); body.protocol is gone.
 *  - yield.ts is deleted: per-archive measurement showed no stable ordering
 *    (see the ticket resolution), so the registry entry is gone too.
 */
describe('protocol choice (ticket 153)', () => {
 let app: Hono;
 let root: string;
 const ENV = { remoteAddr: '127.0.0.1' };

 const post = (path: string, body: unknown) =>
  app.fetch(
   new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
   }),
   ENV,
  );

 beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'elicit-protocol-routes-'));
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

 it('GET /api/protocols returns the registry open set, not a hardcoded list', async () => {
  const res = await app.fetch(new Request('http://localhost/api/protocols'), ENV);
  expect(res.status).toBe(200);
  const { protocols } = (await res.json()) as { protocols: { id: string; name: string; title: string; blurb?: string; rotation: boolean }[] };
  const expected = [...loadProtocolDefinitions().values()]
   .map((d) => ({
    id: d.name,
    name: d.name,
    title: d.title,
    ...(d.blurb !== undefined ? { blurb: d.blurb } : {}),
    rotation: d.rotation !== false,
   }))
   .sort((a, b) => a.id.localeCompare(b.id));
  expect(protocols).toEqual(expected);
  // The registry is an open set: any def on disk shows up.
  expect(protocols.map((p) => p.id)).toContain('reflective');
  expect(protocols.map((p) => p.id)).toContain('cdm');
  // The surface words ride the route (ticket 157): the title labels the
  // picker, the blurb dims under it.
  expect(protocols.find((p) => p.id === 'reflective')!.title).toBe('follow the thread');
  expect(protocols.find((p) => p.id === 'drm')!.blurb).toBe('recover yesterday hour by hour, block by block');
  // Explicit-only instruments (Q-85) are marked so the picker can group them.
  expect(protocols.find((p) => p.id === 'drm')!.rotation).toBe(false);
  expect(protocols.find((p) => p.id === 'people-grid')!.rotation).toBe(false);
 });

 // The rotation died with the protocol pick (canon §10 cut, 2026-08-09):
 // 'domain rotation still cycles on session count' asserted the deleted
 // mechanic — no test covers it now.

 it('POST /api/session without protocol runs reflective — the default, since the rotation is dead', async () => {
  // The rotation is cut (canon §10 — patterns are drawn, not chosen; the
  // pick and the rotation are gone), so a route-created sitting is
  // reflective unless a machine supplies its own protocol.
  const res = await post('/api/session', { mode: { target: 'self' } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { protocol: string };
  expect(body.protocol).toBe('reflective');
 });

 it('yield.ts is deleted and the registry entry is gone with it', () => {
  // The yield decision (see the ticket resolution): the per-protocol numbers
  // on the archived vaults were not stable enough to show (n≤2 for every
  // non-reflective protocol; DRM unmeasurable — records live in vault/drm/,
  // which yield.ts never read), so the module and its registry entry were
  // removed rather than wired.
  expect(existsSync(join(process.cwd(), 'src/protocols/yield.ts'))).toBe(false);
  const registrySource = readFileSync(join(process.cwd(), 'src/registry.ts'), 'utf-8');
  // The registry ENTRY is gone (the header's origin-story prose still names
  // computeYield as a past example — that is history, not a declaration).
  expect(registrySource).not.toContain("module: 'src/protocols/yield'");
 });
});
