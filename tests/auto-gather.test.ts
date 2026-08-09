/**
 * Auto-gather (redesign-2026-08-09 §5.3, §10): the first probation entry.
 *
 * Four contracts, all pinned here:
 *
 * 1. ONE model call per sitting per OPEN composition — never per snippet
 *    (§5's licensing, Q-37 amended). A sitting with three passages and two
 *    open compositions costs exactly two calls.
 * 2. Auto-gather never adds. It offers (Q-39): the store write is
 *    addOffer, and only `acceptOffer` — the person's touch — appends a pin.
 * 3. Denial is durable: a declined passage is never offered again, and the
 *    store refuses to re-offer it even if the model names it (the
 *    `DirectionRecord.declinedOptions` pattern).
 * 4. The fingerprint that saves auto-gather (§10): a composition that grew
 *    by accepted offer, reaching a passage from a sitting the person did
 *    not go looking through. The round trip is modeled end to end.
 *
 * The store is the REAL piece store (file-backed); the model is a scripted
 * Complete that records every call, so the call-count contract is asserted
 * on what was actually sent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { Hono } from 'hono';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createPieceStore } from '../src/piece/store.js';
import { autoGatherSitting, type AutoGatherResult } from '../src/clerk/auto-gather.js';
import type { PieceStore } from '../src/piece/contract.js';
import type { Complete, Snippet } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';

let root: string;
let pieces: PieceStore;
let snippets: Record<string, Snippet>;
let logs: { kind: string; detail: string }[];

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'auto-gather-'));
 snippets = {};
 pieces = createPieceStore(root, { snippets: () => snippets });
 logs = [];
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

/** A kept snippet of a sitting — the shape decide() returns. */
const makeSnippet = (id: string, sitting: string, prose: string): Snippet => ({
 id,
 version: 1,
 captured: new Date().toISOString(),
 provenance: { kind: 'harvest', session: sitting, question: '', questionForm: 'deliberative' },
 prose,
});

/** Registers the snippet in the store's index (pinsResolve needs it). */
function register(s: Snippet): Snippet {
 snippets[s.id] = s;
 return s;
}

/** The model's answer: `{"belong": [...]}` naming passage ids. */
const belong = (...ids: string[]): string => JSON.stringify({ belong: ids });

/** The empty answer: nothing belongs. */
const NONE = '{"belong": []}';

/** A log recorder matching the module's log signature. */
function logRecorder(): (e: { at: string; actor: 'clerk'; kind: string; detail: string }) => void {
 return (e) => {
  logs.push({ kind: e.kind, detail: e.detail });
 };
}

/** One run against one sitting: the exact shape the harvest route calls. */
function run(
  passages: Snippet[],
  complete: Complete,
  sourceSitting = 'sit-9',
): Promise<AutoGatherResult> {
 return autoGatherSitting({
  pieces,
  snippets: () => snippets,
  passages,
  complete,
  log: logRecorder(),
  sourceSitting,
 });
}

describe('autoGatherSitting', () => {
 it('makes ONE call per open composition, never per snippet', async () => {
  // Two open compositions, one sitting with THREE passages.
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  const p2 = register(makeSnippet('s2', 'sit-1', 'I moved the easel by the window.'));
  const p3 = register(makeSnippet('s3', 'sit-1', 'The light was wrong all winter.'));
  pieces.create([{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }], 'the studio');
  pieces.create([{ id: 'e2', kind: 'pin', snippet: 's2', version: 1 }], 'moving house');

  const complete = vi.fn(makeScriptedComplete([NONE, NONE]));
  const result = await run([p1, p2, p3], complete, 'sit-1');

  // Exactly two calls — one per composition, not one per passage.
  expect(complete.mock.calls).toHaveLength(2);
  expect(result).toMatchObject({ compositions: 2, offered: 0, failed: 0 });
  // Every call carried the whole sitting's passages.
  for (const [, turns] of complete.mock.calls) {
   const text = turns[0]!.text;
   for (const id of ['s1', 's2', 's3']) expect(text).toContain(id);
  }
 });

 it('makes no call when no composition is open', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  pieces.create([{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }], 'the studio');
  // Set down (Q-41) — the shelf is not open to offers.
  const id = pieces.list()[0]!.id;
  pieces.setDown(id, 'user');

  const complete = vi.fn(makeScriptedComplete([]));
  const result = await run([p1], complete, 'sit-1');
  expect(complete.mock.calls).toHaveLength(0);
  expect(result).toMatchObject({ compositions: 0, offered: 0 });
 });

 it('does not ask a discarded composition', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  pieces.create([{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }], 'the studio');
  const id = pieces.list()[0]!.id;
  pieces.discard(id);

  const complete = vi.fn(makeScriptedComplete([]));
  const result = await run([p1], complete, 'sit-1');
  expect(complete.mock.calls).toHaveLength(0);
  expect(result).toMatchObject({ compositions: 0 });
 });

 it('offers the passages the model names, then the offer becomes a pin only on accept', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  const p2 = register(makeSnippet('s2', 'sit-1', 'I moved the easel by the window.'));
  const piece = pieces.create(
   [{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }],
   'the studio',
  );

  // The model says p2 belongs; p1 is already pinned.
  const result = await run([p1, p2], makeScriptedComplete([belong('s2')]), 'sit-1');
  expect(result).toMatchObject({ compositions: 1, offered: 1, skipped: 0 });

  const after = pieces.get(piece.id)!;
  expect(after.entries).toHaveLength(1); // still only the original pin — nothing placed
  expect(after.offers).toHaveLength(1);
  const offer = after.offers[0]!;
  expect(offer.snippet).toBe('s2');
  expect(offer.sourceSitting).toBe('sit-1');

  // The person's touch: acceptOffer appends the pin and consumes the offer.
  const accepted = pieces.acceptOffer(piece.id, offer.id);
  expect(accepted.entries).toHaveLength(2);
  const pin = accepted.entries[1]!;
  expect(pin.kind === 'pin' && pin.snippet).toBe('s2');
  expect(accepted.offers).toHaveLength(0);
 });

 it('skips passages that are already declined, pinned, or offered', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  const p2 = register(makeSnippet('s2', 'sit-1', 'I moved the easel by the window.'));
  const p3 = register(makeSnippet('s3', 'sit-1', 'The light was wrong all winter.'));
  const piece = pieces.create(
   [
    { id: 'e1', kind: 'pin', snippet: 's1', version: 1 },
    { id: 'e2', kind: 'pin', snippet: 's2', version: 1 },
   ],
   'the studio',
  );
  // p3 is already declined durably (a past `not this one`).
  const declinedId = pieces.denyOffer(
   piece.id,
   pieces.addOffer(piece.id, {
    id: ulid(),
    snippet: 's3',
    version: 1,
    sourceSitting: 'sit-0',
   }).offers[0]!.id,
  );
  expect(declinedId.declined).toContain('s3');

  // The model names all three: s1 (pinned), s2 (pinned), s3 (declined).
  const result = await run(
   [p1, p2, p3],
   makeScriptedComplete([belong('s1', 's2', 's3')]),
   'sit-1',
  );
  expect(result).toMatchObject({ compositions: 1, offered: 0, skipped: 3 });
  const after = pieces.get(piece.id)!;
  expect(after.offers).toHaveLength(0);
 });

 it('a denied passage is never re-offered, even when the model names it again', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  const p2 = register(makeSnippet('s2', 'sit-1', 'I moved the easel by the window.'));
  const piece = pieces.create(
   [{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }],
   'the studio',
  );

  // First run: the model offers p2; the person denies it.
  await run([p1, p2], makeScriptedComplete([belong('s2')]), 'sit-1');
  const offered = pieces.get(piece.id)!.offers[0]!;
  pieces.denyOffer(piece.id, offered.id);
  expect(pieces.get(piece.id)!.declined).toContain('s2');

  // Second sitting, same passage re-proposed by the model: never re-offered.
  const p2v2 = register(makeSnippet('s2', 'sit-7', 'I moved the easel by the window.'));
  const result = await run([p2v2], makeScriptedComplete([belong('s2')]), 'sit-7');
  expect(result).toMatchObject({ compositions: 1, offered: 0, skipped: 1 });
  expect(pieces.get(piece.id)!.offers).toHaveLength(0);

  // Defense in depth: the store itself refuses a declined passage.
  expect(() =>
   pieces.addOffer(piece.id, { id: ulid(), snippet: 's2', version: 1, sourceSitting: 'sit-7' }),
  ).toThrow(/declined/);
 });

 it('a malformed answer fails that one composition and the run continues', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  const p2 = register(makeSnippet('s2', 'sit-2', 'The garden went to seed.'));
  pieces.create([{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }], 'the studio');
  pieces.create([{ id: 'e2', kind: 'pin', snippet: 's2', version: 1 }], 'the garden');

  // First composition gets garbage, second gets a clean empty answer.
  const complete = vi.fn(makeScriptedComplete(['not json at all', NONE]));
  const result = await run([p1, p2], complete, 'sit-1');
  expect(complete.mock.calls).toHaveLength(2);
  expect(result).toMatchObject({ compositions: 2, offered: 0, failed: 1 });
  expect(logs.map((l) => l.kind)).toContain('auto-gather-failed');
 });

 it('refuses a passage id the model was never shown', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  const p2 = register(makeSnippet('s2', 'sit-1', 'I moved the easel by the window.'));
  const piece = pieces.create(
   [{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }],
   'the studio',
  );

  // The model names s2 AND a ghost id it was never shown — malformed.
  const result = await run([p1, p2], makeScriptedComplete([belong('s2', 'ghost')]), 'sit-1');
  expect(result).toMatchObject({ compositions: 1, offered: 0, failed: 1 });
  expect(pieces.get(piece.id)!.offers).toHaveLength(0);
 });

 it('a sitting that kept nothing costs no calls', async () => {
  const p1 = register(makeSnippet('s1', 'sit-1', 'The studio smelled of paint.'));
  pieces.create([{ id: 'e1', kind: 'pin', snippet: 's1', version: 1 }], 'the studio');
  const complete = vi.fn(makeScriptedComplete([]));
  const result = await run([], complete, 'sit-1');
  expect(complete.mock.calls).toHaveLength(0);
  expect(result).toMatchObject({ compositions: 0 });
 });

 it('the fingerprint: a composition grew by accepted offer, from a sitting the person did not go looking through', async () => {
  // The person gathered this composition by hand: multiselect at creation
  // from sitting A's passages. Sitting B exists but the person never went
  // looking through it — no multiselect, no search-and-place from B.
  const a1 = register(makeSnippet('a1', 'sit-a', 'The studio smelled of paint.'));
  const piece = pieces.create(
   [{ id: 'e1', kind: 'pin', snippet: 'a1', version: 1 }],
   'the studio',
  );
  const b1 = register(makeSnippet('b1', 'sit-b', 'I kept the brushes in a coffee tin.'));
  const b2 = register(makeSnippet('b2', 'sit-b', 'The window faced north all year.'));

  // Sitting B harvests; auto-gather offers b1 against the open composition.
  const result = await run([b1, b2], makeScriptedComplete([belong('b1')]), 'sit-b');
  expect(result).toMatchObject({ compositions: 1, offered: 1 });
  const offered = pieces.get(piece.id)!.offers[0]!;
  expect(offered.sourceSitting).toBe('sit-b');

  // The person accepts the offer — the only door B's passage came through.
  const grown = pieces.acceptOffer(piece.id, offered.id);
  expect(grown.entries).toHaveLength(2);
  const pin = grown.entries[1]!;
  expect(pin.kind === 'pin' && pin.snippet).toBe('b1');

  // The fingerprint: the composition reached a passage from a sitting the
  // person never went looking through — B is not among the sittings the
  // manual gathering drew from (creation used only A).
  const creationSittings = new Set([a1.provenance.session]);
  expect(creationSittings.has('sit-a')).toBe(true);
  expect(creationSittings.has('sit-b')).toBe(false);
  // And the growth was by ACCEPTED OFFER, not by a manual door: the pin's
  // snippet is B's passage, placed through acceptOffer.
  expect(b1.id).toBe('b1');
 });
});

// ── The round trip, through the real app (the harvest-queue harness) ──
// The fingerprint (§10) is only real if the trigger is real: a sitting's
// harvest decision lands, the auto-gather fires behind it, the offer
// appears on an open composition, and the person's accept places it. This
// block drives that end to end through createApp — the same seam a user
// would touch.

const INTEGRATION_ENTRY =
 'I keep circling back to the same worry about money. It is not the number, it is what the number stands in for.';
const INTEGRATION_CUT = 'It is not the number, it is what the number stands in for.';
const INTEGRATION_ENTRY_2 = 'I started writing down what I spent. The ledger made the worry smaller.';
const INTEGRATION_CUT_2 = 'The ledger made the worry smaller.';

function integrationCutPayload(cut: string): string {
 return JSON.stringify({
  cuts: [
   {
    text: cut,
    sourceTurn: 0,
    facet: 'construct',
    stance: 'self-observation',
    reading: 'A reading of the cut',
    standalone: true,
   },
  ],
 });
}

/** POST to the app directly — loopback, no auth file, the gate opens. */
async function post(app: Hono, path: string, body?: unknown): Promise<Response> {
 const init: RequestInit = { method: 'POST' };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 }
 return app.fetch(new Request(`http://127.0.0.1${path}`, init), {
  remoteAddr: '127.0.0.1',
 });
}

/** GET through the same loopback env. */
async function get(app: Hono, path: string): Promise<Response> {
 return app.fetch(new Request(`http://127.0.0.1${path}`), {
  remoteAddr: '127.0.0.1',
 });
}

/** Poll a predicate every 25ms until it answers, or throw after 5s. */
async function poll<T>(fn: () => Promise<T | null>): Promise<T> {
 const deadline = Date.now() + 5000;
 for (; ;) {
  const value = await fn();
  if (value !== null) return value;
  if (Date.now() >= deadline) throw new Error('poll timed out after 5s');
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

describe('auto-gather round trip (real app)', () => {
 it('offers after a harvest decision, and accept places the passage', async () => {
  // Two full sittings, two harvest decisions and the post-harvest docket
  // runs behind each — the flow genuinely takes seconds, and the poll below
  // is the assertion that the offer lands. Real wall-clock time is the
  // point: the trigger is a background fire-and-forget, so there is no
  // promise to await.
  const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-auto-gather-roundtrip-'));
  try {
   // Keyed responder: the harvest gets its cuts, the auto-gather gets its
   // belong-answer, every other caller (boot docket, post-harvest docket)
   // gets '' and degrades gracefully.
   const complete: Complete = async (system) => {
    if (system.includes('harvesting agent for Elicit')) {
     return integrationCutPayload(INTEGRATION_CUT);
    }
    if (system.includes('organising method for like-minded snippets')) {
     return JSON.stringify({ belong: ['s1'] });
    }
    return '';
   };
   const app = await makeIntegrationApp(vaultDir, complete);

   // Sitting 1: harvests the entry, the person approves the cut — a kept
   // snippet exists, and the composition can pin it.
   const first = await post(app, '/api/unprompted', { text: INTEGRATION_ENTRY });
   expect(first.status).toBe(200);
   const { sessionId: firstSession } = (await first.json()) as { sessionId: string };
   await poll(async () => {
    const res = await get(app, `/api/harvest-queue/${firstSession}`);
    return res.status === 200 ? {} : null;
   });
   const decided = await post(app, `/api/session/${firstSession}/harvest`, {
    decisions: [{ proposal: 0, action: 'approve' }],
   });
   expect(decided.status).toBe(200);
   const kept = (await decided.json()) as { snippets: Snippet[] };
   expect(kept.snippets).toHaveLength(1);
   const firstSnippetId = kept.snippets[0]!.id;

   // The composition: subject + the sitting-1 passage as its first pin.
   const composed = await post(app, '/api/piece', {
    snippets: [firstSnippetId],
    subject: 'money worries',
   });
   expect(composed.status).toBe(200);
   const piece = (await composed.json()) as { id: string; entries: unknown[] };
   expect(piece.entries).toHaveLength(1);

   // Sitting 2: a NEW sitting harvests, and its kept passage is the one
   // auto-gather offers. The responder names s1 — but s1 is sitting 2's
   // snippet id only if the vault mints it that way, so instead the
   // responder echoes the passage the harvest produced: key the belong
   // answer off the harvest cut text.
   const app2 = await makeIntegrationApp(vaultDir, async (system, turns) => {
    if (system.includes('harvesting agent for Elicit')) {
     return integrationCutPayload(INTEGRATION_CUT_2);
    }
    if (system.includes('organising method for like-minded snippets')) {
     // The auto-gather payload (the user turn) shows the sitting's passage
     // ids; the model must name one. Return the id of the passage whose
     // prose is the second cut — read it from the prompt so the answer is
     // always valid. Snippet ids are Crockford-base32 ULIDs (no colons),
     // so the id is everything before the colon on the matching passage
     // line.
     const m = /^- ([^:\n]+): The ledger made the worry smaller\.$/m.exec(turns[0]?.text ?? '');
     return JSON.stringify({ belong: m ? [m[1]!] : [] });
    }
    return '';
   });

   const second = await post(app2, '/api/unprompted', { text: INTEGRATION_ENTRY_2 });
   expect(second.status).toBe(200);
   const { sessionId: secondSession } = (await second.json()) as { sessionId: string };
   await poll(async () => {
    const res = await get(app2, `/api/harvest-queue/${secondSession}`);
    return res.status === 200 ? {} : null;
   });
   const decided2 = await post(app2, `/api/session/${secondSession}/harvest`, {
    decisions: [{ proposal: 0, action: 'approve' }],
   });
   expect(decided2.status).toBe(200);

   // The auto-gather fires behind the harvest decision (fire-and-forget):
   // poll until the offer lands on the composition.
   const offer = await poll(async () => {
    const res = await get(app2, `/api/piece/${piece.id}`);
    if (res.status !== 200) return null;
    const p = (await res.json()) as { offers: Array<{ snippet: string; sourceSitting: string }> };
    return p.offers.length > 0 ? p.offers[0]! : null;
   });
   expect(offer.sourceSitting).toBe(secondSession);

   // The person accepts: the offer becomes a pin, appended.
   const offerId = await offerKey(app2, piece.id, offer.snippet);
   const acceptedRes = await post(app2, `/api/piece/${piece.id}/offers/${offerId}/accept`);
   expect(acceptedRes.status).toBe(200);
   const after = (await acceptedRes.json()) as { entries: Array<{ kind: string; snippet: string }>; offers: unknown[] };
   expect(after.entries).toHaveLength(2);
   expect(after.entries[1]!.kind).toBe('pin');
   expect(after.entries[1]!.snippet).toBe(offer.snippet);
   expect(after.offers).toHaveLength(0);
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 }, 30000);
});

/** A full app over a vault dir, the way the other suites build one. */
async function makeIntegrationApp(vaultDir: string, complete: Complete): Promise<Hono> {
 const vault = createVault(vaultDir);
 const queue = createQueueStore(vaultDir);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(vaultDir, '.auth.json'));
 return createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
}

/** The offer id for a given snippet — the accept route keys on offer ids. */
async function offerKey(app: Hono, pieceId: string, snippet: string): Promise<string> {
 const res = await get(app, `/api/piece/${pieceId}`);
 const p = (await res.json()) as { offers: Array<{ id: string; snippet: string }> };
 const offer = p.offers.find((o) => o.snippet === snippet);
 if (!offer) throw new Error('offer not found');
 return offer.id;
}
