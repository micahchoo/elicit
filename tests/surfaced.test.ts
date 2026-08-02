import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createClaimStore } from '../src/wiki/store.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { readEvents } from '../src/log/activity.js';
import type { Claim } from '../src/wiki/contract.js';
import type { Facet } from '../src/types.js';
import type { Hono } from 'hono';

/**
 * The surfaced usage stamp (015), driven through the REAL server seam.
 *
 * The stamp exists to give ticket 015's future aggregation a month of
 * usage data, so a test that renders a hand-built line proves nothing
 * about whether the three surfacing sites actually write it. Each test
 * below POSTs or GETs the real route and reads the stamp back off the
 * JSONL the server wrote. No port is ever bound: `app.fetch` with a
 * loopback remoteAddr is the whole transport.
 */

const NOW = '2026-01-01T00:00:00.000Z';

const roots: string[] = [];
afterAll(() => {
 for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function claim(id: string, facet: Facet, cites: string[], over?: Partial<Claim>): Claim {
 return {
  id,
  body: `A sentence about ${id}.`,
  range: 'in the mornings, since 2024',
  status: 'unconfirmed',
  cites,
  facet,
  referents: [],
  fromReadings: [],
  attested: false,
  readLog: [],
  model: 'test-model',
  modelAt: NOW,
  created: NOW,
  updated: NOW,
  ...over,
 };
}

async function session(
 app: Hono,
 body: unknown,
): Promise<{ status: number; json: () => Promise<Record<string, unknown>> }> {
 const res = await app.fetch(
  new Request('http://127.0.0.1/api/session', {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify(body),
  }),
  { remoteAddr: '127.0.0.1' },
 );
 return { status: res.status, json: () => res.json() as Promise<Record<string, unknown>> };
}

describe('the usage stamp — a randomizer draw that was served', () => {
 it('stamps a resurfaced snippet and never a deck card', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elicit-surfaced-draw-'));
  roots.push(root);
  const vault = createVault(root);
  const snip = vault.saveSnippet(
   'I once trusted the ferry timetable more than my own memory.',
   { kind: 'harvest', session: 's0', question: '', questionForm: 'deliberative' },
  );
  // An empty complete means the boot docket mints nothing: the only
  // question on the table is the draw, and the opener is whatever the
  // randomizer dealt.
  const app = await createApp({
   vault,
   complete: async () => '',
   queue: createQueueStore(root),
   index: buildIndex([]),
   vaultRoot: root,
   authStore: createFileAuth(join(root, '.auth.json')),
  });

  // A user shuffle draws a deck card or a resurfaced snippet, uniformly.
  // Loop until the response names a resurfacing draw: a deck draw surfaces
  // a curated card, not a claim or snippet, so it must leave no stamp.
  let saw = false;
  for (let i = 0; i < 24; i++) {
   const res = await session(app, { mode: { minutes: 25, energy: 'medium' }, shuffle: true });
   expect(res.status).toBe(200);
   const body = await res.json();
   if (body.source === 'resurfacing') {
    saw = true;
    break;
   }
  }
  expect(saw).toBe(true);

  const stamped = readEvents(root).filter((e) => e.kind === 'surfaced');
  expect(stamped).toHaveLength(1);
  expect(stamped[0]!.actor).toBe('elicitor');
  expect(stamped[0]!.detail).toBe('surface=draw');
  expect(stamped[0]!.refs).toEqual([snip.id]);
 });
});

describe('the usage stamp — the wiki reading surface', () => {
 it('stamps each served claim with its cited snippets, and nothing it did not serve', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elicit-surfaced-wiki-'));
  roots.push(root);
  const vault = createVault(root);
  const snips = [
   'Morning light through the kitchen window.',
   'Bicycles rust when nobody rides them.',
  ].map((prose, i) =>
   vault.saveSnippet(prose, {
    kind: 'harvest',
    session: `s${i}`,
    question: '',
    questionForm: 'deliberative',
   }),
  );
  const store = createClaimStore(root);
  store.writeClaim(claim('hub', 'construct', [`${snips[0]!.id}@1`, `${snips[1]!.id}@1`]));
  store.writeClaim(
   claim('gone', 'construct', [`${snips[0]!.id}@1`], {
    archived: true,
    archiveReason: 'the person said it no longer holds',
   }),
  );

  const app = await createApp({
   vault,
   complete: makeFakeComplete(),
   queue: createQueueStore(root),
   index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
   vaultRoot: root,
   authStore: createFileAuth(join(root, '.auth.json')),
  });

  const res = await app.fetch(new Request('http://127.0.0.1/api/wiki'), {
   remoteAddr: '127.0.0.1',
  });
  expect(res.status).toBe(200);

  // The default reading serves one live claim: the archived one is not on
  // the surface, so it is not usage.
  const stamped = readEvents(root).filter((e) => e.kind === 'surfaced');
  expect(stamped).toHaveLength(1);
  expect(stamped[0]!.actor).toBe('system');
  expect(stamped[0]!.detail).toBe('surface=wiki');
  expect(stamped[0]!.refs).toEqual(['hub', `${snips[0]!.id}@1`, `${snips[1]!.id}@1`]);

  // ?all=1 serves the whole record: the archived claim surfaces too.
  const all = await app.fetch(new Request('http://127.0.0.1/api/wiki?all=1'), {
   remoteAddr: '127.0.0.1',
  });
  expect(all.status).toBe(200);
  const allStamped = readEvents(root).filter((e) => e.kind === 'surfaced');
  expect(allStamped).toHaveLength(3);
  // The served order is coreness then id, so assert the multiset of refs.
  const refs = allStamped.map((e) => e.refs).sort();
  expect(refs).toEqual([
   ['gone', `${snips[0]!.id}@1`],
   ['hub', `${snips[0]!.id}@1`, `${snips[1]!.id}@1`],
   ['hub', `${snips[0]!.id}@1`, `${snips[1]!.id}@1`],
  ]);
 });
});

describe('the usage stamp — a composed question that was served', () => {
 it('stamps the quoted snippets when a composed queue question opens the sitting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elicit-surfaced-composed-'));
  roots.push(root);
  const vault = createVault(root);
  const snip = vault.saveSnippet('The ferry timetable changed in April.', {
   kind: 'harvest',
   session: 's0',
   question: '',
   questionForm: 'deliberative',
  });
  const queue = createQueueStore(root);
  // The only eligible entry: the empty complete stops the boot docket from
  // minting anything into the same store.
  queue.add({
   source: 'composed',
   license: 'CC0',
   question: 'Does "the ferry timetable changed in April" still describe your spring?',
   questionForm: 'deliberative',
   cites: [`${snip.id}@1`],
   quotedFragment: 'the ferry timetable changed in April',
   sharpness: 'weak',
   horizon: 'session',
  });
  const app = await createApp({
   vault,
   complete: async () => '',
   queue,
   index: buildIndex([]),
   vaultRoot: root,
   authStore: createFileAuth(join(root, '.auth.json')),
  });

  const res = await session(app, { mode: { minutes: 25, energy: 'medium' } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(String(body.question)).toContain('still describe your spring');

  const stamped = readEvents(root).filter((e) => e.kind === 'surfaced');
  expect(stamped).toHaveLength(1);
  expect(stamped[0]!.actor).toBe('elicitor');
  expect(stamped[0]!.detail).toBe('surface=composed-question');
  expect(stamped[0]!.refs).toEqual([`${snip.id}@1`]);
 });

 it('stamps the quoted snippets when a fallback draw serves them mid-sitting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elicit-surfaced-fallback-'));
  roots.push(root);
  const vault = createVault(root);
  const snip = vault.saveSnippet('I used to think that honesty cost me something.', {
   kind: 'harvest',
   session: 's0',
   question: '',
   questionForm: 'deliberative',
  });
  const queue = createQueueStore(root);
  const app = await createApp({
   vault,
   complete: async () => '',
   queue,
   index: buildIndex([]),
   vaultRoot: root,
   authStore: createFileAuth(join(root, '.auth.json')),
  });

  // The opening finds an empty queue, so the bank opener is served and
  // nothing stamps.
  const opened = await session(app, { mode: { minutes: 25, energy: 'medium' } });
  expect(opened.status).toBe(200);
  const { sessionId } = (await opened.json()) as { sessionId: string };
  expect(readEvents(root).filter((e) => e.kind === 'surfaced')).toHaveLength(0);

  // A composed entry exists to draw once the sitting is live.
  queue.add({
   source: 'still-true',
   license: 'CC0',
   question: 'Is "honesty cost me something" still true of you?',
   questionForm: 'deliberative',
   cites: [`${snip.id}@1`],
   quotedFragment: 'honesty cost me something',
   sharpness: 'weak',
   horizon: 'session',
  });

  // A content-free answer pivots to a fresh draw (ticket 020): the queue
  // entry is served, so its quoted snippet is usage.
  const turn = await app.fetch(
   new Request(`http://127.0.0.1/api/session/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'I do not know' }),
   }),
   { remoteAddr: '127.0.0.1' },
  );
  expect(turn.status).toBe(200);

  const stamped = readEvents(root).filter((e) => e.kind === 'surfaced');
  expect(stamped).toHaveLength(1);
  expect(stamped[0]!.actor).toBe('elicitor');
  expect(stamped[0]!.detail).toBe('surface=composed-question');
  expect(stamped[0]!.refs).toEqual([`${snip.id}@1`]);
 });
});
