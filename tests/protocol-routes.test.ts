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
 *  - POST /api/session accepts an optional {protocol} validated against the
 *    registry; absent means deterministic rotation exactly as before; an
 *    unknown name is a 400.
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

 it('POST /api/session honors a valid explicit protocol', async () => {
  const res = await post('/api/session', { mode: { minutes: 15, energy: 'low', target: 'self' }, protocol: 'cdm' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { protocol: string };
  // A pick bypasses target filtering — the person asked for the instrument.
  expect(body.protocol).toBe('cdm');
 });

 it('POST /api/session accepts a rotation:false instrument as an explicit pick', async () => {
  const res = await post('/api/session', { mode: { minutes: 15, energy: 'low', target: 'self' }, protocol: 'drm' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { protocol: string };
  expect(body.protocol).toBe('drm');
 });

 it('POST /api/session 400s an unknown protocol', async () => {
  const res = await post('/api/session', { mode: { minutes: 15, energy: 'low', target: 'self' }, protocol: 'no-such-protocol' });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain('no-such-protocol');
 });

 it('POST /api/session without protocol rotates exactly as before', async () => {
  // Fresh vault: zero prior sessions, self target → the only rotation
  // candidate for 'self' (reflective; people-grid and drm are rotation:false).
  const res = await post('/api/session', { mode: { minutes: 15, energy: 'low', target: 'self' } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { protocol: string };
  expect(body.protocol).toBe('reflective');
 });

 it('domain rotation still cycles on session count when protocol is absent', async () => {
  // Zero prior sessions → candidates[0] of [cdm, concept-sorting, laddered-grid].
  const res = await post('/api/session', { mode: { minutes: 15, energy: 'low', target: 'domain' } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { protocol: string };
  expect(body.protocol).toBe('cdm');
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
