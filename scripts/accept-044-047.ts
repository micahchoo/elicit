/**
 * Real-model acceptance for tickets 044, 045 and 047.
 *
 * Green tests have twice hidden real bugs in this repo, so every fix ticket is
 * accepted against the actual model, not against a fake. This script drives the
 * real HTTP surface with `ELICIT_LLM=local` and asserts three things the unit
 * tests cannot:
 *
 *   044 — a sitting that mixes refusals with real memories harvests the
 *         memories and none of the refusals, when a live model wrote the cuts.
 *   047 — /harvest answers before the docket that follows it finishes.
 *   045 — the openers that docket mints carry the sitting's Target, and a
 *         sitting of the other Target does not draw them.
 *
 * Usage: npx tsx scripts/accept-044-047.ts
 * It writes to a temp vault and never touches yours.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { makeComplete } from '../src/llm.js';
import type { Hono } from 'hono';

const root = mkdtempSync(join(tmpdir(), 'elicit-accept-'));
let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Every request arrives from loopback, so the un-set-up vault stays open. */
async function call(app: Hono, path: string, init?: RequestInit): Promise<Response> {
  return await app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    }),
    { remoteAddr: '127.0.0.1' },
  );
}

// ── A barrier over the background docket (047 moved it off the response) ──
let settled = 0;
const waiting: (() => void)[] = [];
function onDocketSettled(): void {
  settled++;
  for (const w of waiting.splice(0)) w();
}
async function waitForDocket(n: number): Promise<void> {
  while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

const vault = createVault(root);
const queue = createQueueStore(root);
const complete = makeComplete();

console.log(`vault: ${root}`);
console.log(`model: ${process.env.ELICIT_LLM_MODEL ?? 'qwen3.6:35b'}\n`);

const app = await createApp({
  vault,
  complete,
  queue,
  index: buildIndex([]),
  vaultRoot: root,
  authStore: createFileAuth(join(root, '.auth.json')),
  onDocketSettled,
});

// The boot docket fires on an empty vault; let it clear so later counts are ours.
await waitForDocket(1);

// ── A domain sitting, answered with real material and real refusals ──

const sessionRes = await call(app, '/api/session', {
  method: 'POST',
  body: JSON.stringify({
    mode: { minutes: 25, energy: 'medium', target: 'domain', topic: 'sourdough bread baking' },
  }),
});
const session = (await sessionRes.json()) as { sessionId: string; question: string; target: string };
check('a declared domain sitting stays domain', session.target === 'domain', session.target);
console.log(`  opener: ${session.question}\n`);

/**
 * The junk lines are verbatim from Micah's own sitting and the persona eval.
 * The real lines are what must survive the same pass — a filter that eats
 * these is worse than no filter.
 */
const TURNS = [
  'This question makes no sense.',
  'I keep the starter at eighty percent hydration because anything wetter goes slack in my kitchen, which runs warm all summer.',
  'I am not sure.',
  'The first loaf I baked that was actually good came out the week my father died, and I have never been able to separate the two.',
];

const REAL_MARKERS = ['hydration', 'starter', 'loaf', 'father'];
const JUNK_MARKERS = ['makes no sense', 'not sure'];

for (const text of TURNS) {
  const res = await call(app, `/api/session/${session.sessionId}/turn`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  const body = (await res.json()) as { question?: string; kind?: string };
  console.log(`  → ${text.slice(0, 60)}`);
  if (body.question) console.log(`  ← ${body.question}\n`);
}

const endRes = await call(app, `/api/session/${session.sessionId}/end`, { method: 'POST' });
const ended = (await endRes.json()) as { proposals: { text: string }[]; buds: { fragment: string }[] };

console.log(`\nproposals (${ended.proposals.length}):`);
for (const p of ended.proposals) console.log(`  · ${p.text}`);
console.log(`buds (${ended.buds.length}):`);
for (const b of ended.buds) console.log(`  · ${b.fragment}`);
console.log();

const proposedText = ended.proposals.map((p) => p.text.toLowerCase()).join(' | ');
const buddedText = ended.buds.map((b) => b.fragment.toLowerCase()).join(' | ');
const everything = `${proposedText} | ${buddedText}`;

for (const junk of JUNK_MARKERS) {
  check(`044: "${junk}" never becomes corpus`, !everything.includes(junk));
}
check(
  '044: real material survives the same pass',
  REAL_MARKERS.some((m) => proposedText.includes(m)),
  proposedText.slice(0, 120),
);

// ── 047: the harvest response does not wait for the docket ──

const settledBeforeHarvest = settled;
const t0 = Date.now();
const harvestRes = await call(app, `/api/session/${session.sessionId}/harvest`, {
  method: 'POST',
  body: JSON.stringify({
    decisions: ended.proposals.map((_p, i) => ({ proposal: i, action: 'approve' })),
  }),
});
const harvestMs = Date.now() - t0;
const harvested = (await harvestRes.json()) as { snippets: { id: string }[] };

check(
  '047: /harvest answers before its docket has settled',
  settled === settledBeforeHarvest,
  `${harvestMs}ms, ${harvested.snippets.length} snippets`,
);

await waitForDocket(settledBeforeHarvest + 1);
const docketMs = Date.now() - t0;
check(
  '047: the docket it started took real model time',
  docketMs > harvestMs,
  `response ${harvestMs}ms vs docket ${docketMs}ms`,
);

// ── 045: what the docket minted belongs to the domain sitting ──

const minted = queue.list().filter((e) => e.source === 'composed' || e.source === 'still-true');
console.log(`\nminted (${minted.length}):`);
for (const e of minted) console.log(`  · [${e.target ?? 'no target'}] ${e.question}`);
console.log();

check('045: the docket minted something to test', minted.length > 0);
check(
  '045: every minted opener carries the sitting Target',
  minted.length > 0 && minted.every((e) => e.target === 'domain'),
  minted.map((e) => e.target ?? 'absent').join(','),
);

// A self sitting must not be handed this domain material.
const selfDraw = queue.draw({ minutes: 25, energy: 'medium', target: 'self' }, 'opening');
check(
  '045: a self sitting draws none of it',
  selfDraw === null || selfDraw.target !== 'domain',
  selfDraw ? `drew: ${selfDraw.question}` : 'drew nothing',
);

rmSync(root, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
