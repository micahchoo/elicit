import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { readProfile, writeProfile, personaLine, profileFrameWords } from '../src/profile.js';
import { clusterClaimsByTheme } from '../src/coach/license.js';
import { createVault } from '../src/vault/vault.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';

// A synthetic person for every assertion below — never a real one.
const NAME = 'Ada';
const PRONOUNS = 'she/her';

describe('profile store', () => {
 let root: string;
 beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-profile-'));
 });
 afterAll(() => rmSync(root, { recursive: true, force: true }));

 it('reads empty when no file exists', () => {
  expect(readProfile(root)).toEqual({});
 });

 it('round-trips, trimming and dropping empties', () => {
  const written = writeProfile(root, { name: `  ${NAME} `, pronouns: '' });
  expect(written).toEqual({ name: NAME });
  expect(readProfile(root)).toEqual({ name: NAME });
 });
});

describe('personaLine', () => {
 it('is undefined for an empty profile — prompts stay stock', () => {
  expect(personaLine({})).toBeUndefined();
 });

 it('names the person and bans "the user"', () => {
  const line = personaLine({ name: NAME, pronouns: PRONOUNS })!;
  expect(line).toContain(NAME);
  expect(line).toContain(PRONOUNS);
  expect(line).toContain('never as "the user"');
 });

 it('works with pronouns alone', () => {
  const line = personaLine({ pronouns: PRONOUNS })!;
  expect(line).toContain(PRONOUNS);
  expect(line).not.toContain('undefined');
 });
});

describe('profileFrameWords keep the name out of theme clustering', () => {
 it('splits name and pronouns into lowercase tokens', () => {
  expect(profileFrameWords({ name: 'Ada Lovelace', pronouns: PRONOUNS })).toEqual([
   'ada', 'lovelace', 'she', 'her',
  ]);
 });

 it('a name in every claim does not become the theme that swallows the vault', () => {
  const claims = [
   { id: 'a', body: 'Ada keeps the storefront lease negotiation secret.' },
   { id: 'b', body: 'Ada says the storefront lease is unsigned.' },
   { id: 'c', body: 'Ada bakes bread every morning before dawn.' },
   { id: 'd', body: 'Ada mills flour for the bread each morning.' },
  ];
  const themes = clusterClaimsByTheme(claims, profileFrameWords({ name: NAME }));
  // Two real themes — storefront and bread — not one "Ada" blob.
  expect(themes.size).toBe(2);
  for (const [, t] of themes) expect(t.name).not.toBe(NAME);
 });
});

describe('/api/profile routes', () => {
 let app: Hono;
 let root: string;
 const ENV = { remoteAddr: '127.0.0.1' };

 beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'elicit-profile-api-'));
  app = await createApp({
   vault: createVault(root),
   complete: makeFakeComplete(),
   queue: createQueueStore(root),
   index: buildIndex([]),
   vaultRoot: root,
   authStore: createFileAuth(join(root, '.auth.json')),
  });
 });
 afterAll(() => rmSync(root, { recursive: true, force: true }));

 it('starts empty, stores what is posted, and reads it back', async () => {
  const empty = await (await app.fetch(new Request('http://localhost/api/profile'), ENV)).json();
  expect(empty).toEqual({});
  const posted = await app.fetch(
   new Request('http://localhost/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: NAME, pronouns: PRONOUNS }),
   }),
   ENV,
  );
  expect(posted.status).toBe(200);
  const read = await (await app.fetch(new Request('http://localhost/api/profile'), ENV)).json();
  expect(read).toEqual({ name: NAME, pronouns: PRONOUNS });
  expect(readProfile(root)).toEqual({ name: NAME, pronouns: PRONOUNS });
 });

 it('rejects non-string fields', async () => {
  const res = await app.fetch(
   new Request('http://localhost/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 42 }),
   }),
   ENV,
  );
  expect(res.status).toBe(400);
 });
});
