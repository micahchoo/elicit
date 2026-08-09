/**
 * The gathering doors and the eleven verbs (docs/composition-redesign-2026-08-09.md
 * §5, §8), driven through the REAL app.
 *
 * Every assertion goes through `createApp` and `app.fetch` — never a hand-built
 * handler — because the failure this suite exists to catch is the seam that
 * compiles, tests green, and reaches nothing. The slice contract is the doc's
 * §4 shape: a Composition is { subject, entries: (Pin|Gap)[], offers: Offer[],
 * declined: string[], marginalia, setDownAt?, setDownBy?, discardedAt? }, and
 * every verb on that shape is a route that writes it.
 *
 * Offers and model-placed gaps are seeded ON DISK (piece.md frontmatter — Q-3:
 * the markdown is the truth), the way the T6 suite seeds Marginalia and
 * transcripts. The auto-gather route that PRODUCES offers is D4's; the verbs
 * on an offer are this suite's.
 *
 * No port is ever bound. `app.fetch` with a loopback `remoteAddr` is the whole
 * transport, so nothing here can collide with a live instance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ulid } from 'ulid';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import type { GapKind } from '../src/piece/contract.js';
import type { QueueStore, Snippet, Vault } from '../src/types.js';

// ── The response shapes this suite asserts (the doc's §4 contract) ──

type EnrichedPin = {
  id: string;
  kind: 'pin';
  snippet: string;
  version: number;
  prose: string | null;
};
type EnrichedGap = {
  id: string;
  kind: GapKind | null;
  placedBy: 'person' | 'model';
  question: string | null;
  pending: string | null;
  offers: Snippet[];
};
type EnrichedEntry = EnrichedPin | EnrichedGap;
type EnrichedOffer = {
  id: string;
  snippet: string;
  version: number;
  prose: string | null;
  sourceSitting: string;
};
type EnrichedPiece = {
  id: string;
  created: string;
  subject: string;
  entries: EnrichedEntry[];
  offers: EnrichedOffer[];
  declined: string[];
  dismissedGaps: string[];
  marginalia: { id: string; on: string | null; note: string; text: string }[];
  setDownAt: string | null;
  setDownBy: string | null;
  discardedAt: string | null;
};

// ── Harness ──

let root: string;
let app: Hono;
let vault: Vault;
let queue: QueueStore;
let cookie: string;
let settled: number;
let waiting: (() => void)[];

function onDocketSettled(): void {
  settled++;
  for (const w of waiting.splice(0)) w();
}

async function waitForSettles(n: number): Promise<void> {
  while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

async function get(path: string): Promise<Response> {
  return app.fetch(new Request(`http://127.0.0.1${path}`, { headers: { cookie } }), {
    remoteAddr: '127.0.0.1',
  });
}

async function post(path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** A transcript whose frontmatter carries the sitting date (Q-59). */
function seedTranscript(session: string, started: string): void {
  mkdirSync(join(root, 'transcripts'), { recursive: true });
  writeFileSync(
    join(root, 'transcripts', `${session}.md`),
    matter.stringify('', { session, protocol: 'ladder', started }),
    'utf-8',
  );
}

/** A harvested snippet whose provenance names `session`. */
function seedSnippet(prose: string, session: string, extra?: Partial<Snippet['provenance']>): Snippet {
  return vault.saveSnippet(prose, {
    kind: 'harvest',
    session,
    question: 'what changed?',
    questionForm: 'deliberative',
    ...extra,
  });
}

/** One line per entry, so ordering reads as a plain array. */
function renderEntries(p: EnrichedPiece): string[] {
  return p.entries.map((e) => (e.kind === 'pin' ? `pin:${e.prose ?? ''}` : `gap:${e.id}`));
}

/** Rewrite piece.md frontmatter whole — the disk truth the routes read (Q-3). */
function writePieceFm(pieceId: string, data: Record<string, unknown>): void {
  writeFileSync(join(root, 'pieces', pieceId, 'piece.md'), matter.stringify('', data), 'utf-8');
}

/** Read piece.md frontmatter — the disk truth (Q-3). */
function readPieceFm(pieceId: string): Record<string, unknown> {
  return matter.read(join(root, 'pieces', pieceId, 'piece.md')).data as Record<string, unknown>;
}

describe('the gathering doors and the eleven verbs (Batch D3)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'elicit-piece-verbs-'));
    settled = 0;
    waiting = [];
    vault = createVault(root);
    queue = createQueueStore(root);
    const authStore = createFileAuth(join(root, '.auth.json'));
    authStore.setup('a password');
    app = await createApp({
      vault,
      complete: makeFakeComplete(),
      queue,
      index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
      vaultRoot: root,
      authStore,
      onDocketSettled,
    });
    await waitForSettles(1);
    const login = await post('/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    expect(cookie).not.toBe('');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── Door 1: multiselect at creation, with the subject line ──

  it('POST /api/piece takes a subject: stored, returned, and never in any export (Q-1)', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph about gardening', 's-2018');
    const res = await post('/api/piece', {
      snippets: [s.id],
      subject: 'what my garden taught me about patience',
    });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(p.subject).toBe('what my garden taught me about patience');
    // The subject is stored on disk, not computed (Q-3).
    expect(readPieceFm(p.id).subject).toBe('what my garden taught me about patience');

    // Q-1: the subject is the gathering criterion, never body text. Neither
    // ink of the export may print it.
    const clean = await get(`/api/piece/${p.id}/export`);
    expect(clean.status).toBe(200);
    expect(await clean.text()).not.toContain('garden taught me about patience');
    const withQ = await get(`/api/piece/${p.id}/export/questions`);
    expect(withQ.status).toBe(200);
    expect(await withQ.text()).not.toContain('garden taught me about patience');
  });

  it('POST /api/piece accepts a missing subject — composing without a criterion is allowed', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const res = await post('/api/piece', { snippets: [s.id] });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(p.subject).toBe('');
  });

  // ── Door 2: search and place (the piece page's find-a-passage) ──

  it('POST /place appends any passage as a pin at the end, and refuses a duplicate', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('already in the piece', 's-2018');
    const b = seedSnippet('a passage from another sitting', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id] })).json()) as EnrichedPiece;

    const res = await post(`/api/piece/${piece.id}/place`, { snippet: b.id, version: b.version });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(renderEntries(p)).toEqual(['pin:already in the piece', 'pin:a passage from another sitting']);
    const pinned = p.entries[1] as EnrichedPin;
    expect(pinned.snippet).toBe(b.id);
    expect(pinned.version).toBe(1);

    // The same passage twice is a duplicate, not a reinforcement.
    const dup = await post(`/api/piece/${piece.id}/place`, { snippet: b.id, version: 1 });
    expect(dup.status).toBe(400);
    // An unknown snippet is refused.
    const unknown = await post(`/api/piece/${piece.id}/place`, { snippet: ulid(), version: 1 });
    expect(unknown.status).toBe(400);
  });

  // ── The passage verbs: take out, ask here, drag ──

  it('take out removes the entry and leaves the rest in order (Q-41)', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('the first paragraph', 's-2018');
    const b = seedSnippet('the second paragraph', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id, b.id] })).json()) as EnrichedPiece;
    const victim = piece.entries[0]!.id;

    const res = await post(`/api/piece/${piece.id}/remove`, { entry: victim });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(renderEntries(p)).toEqual(['pin:the second paragraph']);

    // An unknown entry is refused.
    const unknown = await post(`/api/piece/${piece.id}/remove`, { entry: ulid() });
    expect(unknown.status).toBe(400);
  });

  it('ask here inserts a person-placed gap and mints exactly one queue entry at gap-declared weight', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    const question = 'what made you change your mind about that?';

    const res = await post(`/api/piece/${piece.id}/gap`, { gap: gapId, question });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    const gap = p.entries[1] as EnrichedGap;
    expect(gap.placedBy).toBe('person');

    // The person's own hole is the strongest signal in the system: the
    // mint is gap-declared, exactly the Q-39 path.
    const entries = queue.list({ source: 'gap-declared' });
    expect(entries).toHaveLength(1);
    expect(gap.question).toBe(entries[0]!.id);
    expect(entries[0]!.license).toBe(`composition ${piece.id} gap ${gapId}`);
    expect(entries[0]!.question).toBe(question);
    expect(entries[0]!.questionForm).toBe('deliberative');
    expect(entries[0]!.horizon).toBe('session');
    expect(entries[0]!.gap).toBe(gapId);
    expect(entries[0]!.status).toBe('pending');
    // Absent is not a guess (Q-60).
    expect(entries[0]!.target).toBeUndefined();
    expect(entries[0]!.topic).toBeUndefined();
    expect(entries[0]!.targetFacet).toBeUndefined();

    // The same POST twice: one gap, one queue entry (Q-39 idempotency).
    const again = await post(`/api/piece/${piece.id}/gap`, { gap: gapId, question });
    expect(again.status).toBe(200);
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(1);
  });

  it('drag reorders silently — the permutation route takes no question and mints nothing', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('the first paragraph', 's-2018');
    const b = seedSnippet('the second paragraph', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id, b.id] })).json()) as EnrichedPiece;
    const ids = piece.entries.map((e) => e.id);

    const res = await post(`/api/piece/${piece.id}/reorder`, { entries: [ids[1]!, ids[0]!] });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(p.entries.map((e) => e.id)).toEqual([ids[1]!, ids[0]!]);
    // Silent: no question was minted by a reorder.
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(0);
  });

  // ── The candidate verbs: put it in, not this one ──

  function seedOffer(pieceId: string, offerId: string, snippet: string, version: number, sourceSitting: string): void {
    const fm = readPieceFm(pieceId);
    const offers = Array.isArray(fm.offers) ? (fm.offers as unknown[]) : [];
    offers.push({ id: offerId, snippet, version, sourceSitting });
    writePieceFm(pieceId, { ...fm, offers });
  }

  it('put it in appends the offer as a pin and clears the offer', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('already in the piece', 's-2018');
    const b = seedSnippet('the offered passage', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id] })).json()) as EnrichedPiece;
    const offerId = ulid();
    seedOffer(piece.id, offerId, b.id, b.version, 's-2020');

    const res = await post(`/api/piece/${piece.id}/offers/${offerId}/accept`);
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(renderEntries(p)).toEqual(['pin:already in the piece', 'pin:the offered passage']);
    // The offer is gone — it is now a pin, not a candidate.
    expect(p.offers.map((o) => o.id)).not.toContain(offerId);
    // Not a denial: declined is untouched.
    expect(p.declined).not.toContain(offerId);
  });

  it('put it in refuses an unknown offer and a duplicate pin', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('already in the piece', 's-2018');
    const b = seedSnippet('the offered passage', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id, b.id] })).json()) as EnrichedPiece;
    const offerId = ulid();
    seedOffer(piece.id, offerId, b.id, b.version, 's-2020');

    const dup = await post(`/api/piece/${piece.id}/offers/${offerId}/accept`);
    expect(dup.status).toBe(400);

    const ghost = await post(`/api/piece/${piece.id}/offers/${ulid()}/accept`);
    expect(ghost.status).toBe(404);
  });

  it('not this one is a durable denial: the offer is refused and never re-offered', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('already in the piece', 's-2018');
    const b = seedSnippet('a passage that does not belong', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id] })).json()) as EnrichedPiece;
    const offerId = ulid();
    seedOffer(piece.id, offerId, b.id, b.version, 's-2020');

    const res = await post(`/api/piece/${piece.id}/offers/${offerId}/deny`);
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(p.offers.map((o) => o.id)).not.toContain(offerId);
    // The denial records the PASSAGE, not the offer: a later offer of the
    // same snippet is refused before it is ever shown (never re-offered).
    expect(p.declined).toContain(b.id);

    // Durable: the denial is on disk (Q-3), so a restart cannot re-offer it.
    const fm = readPieceFm(piece.id);
    expect(fm.declined).toEqual([b.id]);
    const reloaded = (await (await get(`/api/piece/${piece.id}`)).json()) as EnrichedPiece;
    expect(reloaded.declined).toContain(b.id);

    // The same offer cannot be accepted after denial.
    const accept = await post(`/api/piece/${piece.id}/offers/${offerId}/accept`);
    expect(accept.status).toBe(404);

    // Denying an unknown offer is refused.
    const ghost = await post(`/api/piece/${piece.id}/offers/${ulid()}/deny`);
    expect(ghost.status).toBe(404);
  });

  // ── The model-gap verbs: ask this, not a gap, place it ──

  function seedModelGap(pieceId: string, gapId: string, pending: string): void {
    const fm = readPieceFm(pieceId);
    const entries = Array.isArray(fm.entries) ? (fm.entries as unknown[]) : [];
    entries.push({ id: gapId, placedBy: 'model', pending });
    writePieceFm(pieceId, { ...fm, entries });
  }

  it('ask this mints the model gap\'s pending question at composition-gap weight, idempotently', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    seedModelGap(piece.id, gapId, 'what goes between these two paragraphs?');

    const res = await post(`/api/piece/${piece.id}/gaps/${gapId}/ask`);
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    const gap = p.entries.find((e) => e.id === gapId) as EnrichedGap;
    expect(gap.placedBy).toBe('model');

    const entries = queue.list({ source: 'composition-gap' });
    expect(entries).toHaveLength(1);
    expect(gap.question).toBe(entries[0]!.id);
    expect(entries[0]!.question).toBe('what goes between these two paragraphs?');
    expect(entries[0]!.questionForm).toBe('deliberative');
    expect(entries[0]!.horizon).toBe('session');
    expect(entries[0]!.gap).toBe(gapId);
    // The (composition, gap) pair is the sweep's dedupe key (redesign §7).
    expect(entries[0]!.composition).toBe(piece.id);
    // The model's noticing is a suggestion: NOT the person's declared weight.
    expect(entries[0]!.source).toBe('composition-gap');

    // Idempotent: one gap, one mint.
    const again = await post(`/api/piece/${piece.id}/gaps/${gapId}/ask`);
    expect(again.status).toBe(200);
    expect(queue.list({ source: 'composition-gap' })).toHaveLength(1);

    // A gap with no pending text has nothing to mint.
    const bare = await post(`/api/piece/${piece.id}/gaps/${ulid()}/ask`);
    expect(bare.status).toBe(404);
  });

  it('not a gap removes the model gap and is durable — it is never re-found', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    seedModelGap(piece.id, gapId, 'what goes between?');

    const res = await post(`/api/piece/${piece.id}/gaps/${gapId}/dismiss`);
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(p.entries.map((e) => e.id)).not.toContain(gapId);
    // Durable: the dismissal is on disk, so the sweep can skip the seam.
    const fm = readPieceFm(piece.id);
    expect(fm.dismissedGaps).toEqual([gapId]);

    // Nothing was minted by a dismissal.
    expect(queue.list({ source: 'composition-gap' })).toHaveLength(0);
  });

  it('place it pins the answered passage into the model gap\'s hole (Q-39\'s return trip)', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    seedModelGap(piece.id, gapId, 'what goes between?');
    const answer = seedSnippet('the answer that names the gap', 's-2018', { gap: gapId });

    const res = await post(`/api/piece/${piece.id}/gap/accept`, {
      gap: gapId,
      snippet: answer.id,
      version: answer.version,
    });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(p.entries).toHaveLength(2);
    expect(p.entries[1]!.kind).toBe('pin');
    const placed = p.entries[1] as EnrichedPin;
    expect(placed.snippet).toBe(answer.id);
    expect(placed.prose).toBe('the answer that names the gap');

    // The gap is gone — the hole is filled, not left beside the pin.
    expect(p.entries.map((e) => e.id)).not.toContain(gapId);
  });

  // ── The composition verbs: set down / pick up, discard ──

  it('set down / pick up stay the reversible shelf (Q-41), and the gap route mints nothing while down', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;

    const sd = await post(`/api/piece/${piece.id}/set-down`);
    expect(sd.status).toBe(200);
    const down = (await sd.json()) as EnrichedPiece;
    expect(down.setDownAt).not.toBeNull();
    expect(down.setDownBy).toBe('user');

    const gapId = ulid();
    await post(`/api/piece/${piece.id}/gap`, { gap: gapId, question: 'should there be a question?' });
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(0);

    const pu = await post(`/api/piece/${piece.id}/pick-up`);
    expect(pu.status).toBe(200);
    expect(((await pu.json()) as EnrichedPiece).setDownAt).toBeNull();
  });

  it('discard writes discardedAt and keeps the file — the markdown is still the truth (Q-3)', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;

    const res = await post(`/api/piece/${piece.id}/discard`);
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(p.discardedAt).not.toBeNull();

    // Q-3: the file stays on disk, annotated, not deleted.
    expect(existsSync(join(root, 'pieces', piece.id, 'piece.md'))).toBe(true);
    const fm = readPieceFm(piece.id);
    expect(fm.discardedAt).toBeDefined();
    expect(fm.discardedAt).toBe(p.discardedAt);

    // The chooser lists open compositions — a discarded one is not open.
    const list = (await (await get('/api/pieces')).json()) as { pieces: EnrichedPiece[] };
    expect(list.pieces.map((x) => x.id)).not.toContain(piece.id);

    // Discarding again is refused — there is no state past discarded.
    const again = await post(`/api/piece/${piece.id}/discard`);
    expect(again.status).toBe(400);
  });

  it('the composition verbs all refuse a missing session cookie', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const anon = async (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<Response> => {
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
    };
    expect((await anon('/api/piece', 'POST', { snippets: [s.id] })).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/remove`, 'POST', { entry: 'x' })).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/place`, 'POST', { snippet: 'x', version: 1 })).status).toBe(401);
    expect(
      (await anon(`/api/piece/${piece.id}/offers/${ulid()}/accept`, 'POST')).status,
    ).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/offers/${ulid()}/deny`, 'POST')).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/gaps/${ulid()}/ask`, 'POST')).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/gaps/${ulid()}/dismiss`, 'POST')).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/discard`, 'POST')).status).toBe(401);
  });
});
