/**
 * The eleven piece routes (T6), driven through the REAL app.
 *
 * Every assertion goes through `createApp` and `app.fetch` — never a
 * hand-built handler — because the failure this suite exists to catch is
 * the seam that compiles, tests green, and reaches nothing. This suite
 * closes T6 Step 1: sitting order, composition provenance, the Q-39 mint
 * (exactly one queue entry per gap), the pinned-version resolver, Q-41
 * set-down, the gap offer and its clearing, and the export surface.
 *
 * Snippets are seeded with REAL sittings: every provenance names a session
 * whose transcript frontmatter carries `started`, because chronological()
 * and the enriched `sittingDate` both read those dates (Q-59).
 *
 * No port is ever bound. `app.fetch` with a loopback `remoteAddr` is the
 * whole transport, so nothing here can collide with a live instance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import { createPieceStore } from '../src/piece/store.js';
import type { QueueStore, Snippet, Vault } from '../src/types.js';

// ── The response shapes this suite asserts (the cross-slice contract) ──

type EnrichedPin = {
  id: string;
  kind: 'pin';
  snippet: string;
  version: number;
  prose: string | null;
  sittingDate: string | null;
};
type EnrichedGap = {
  id: string;
  kind: 'gap';
  question: string | null;
  pending: string | null;
  offers: Snippet[];
};
type EnrichedEntry = EnrichedPin | EnrichedGap;
type EnrichedArrangement = {
  id: string;
  principle: string;
  created: string;
  model: string | null;
  entries: EnrichedEntry[];
  marginalia: { id: string; on: string | null; note: string; text: string; at: string; model: string | null }[];
};
type EnrichedPiece = {
  id: string;
  created: string;
  current: string;
  setDownAt: string | null;
  setDownBy: string | null;
  arrangements: EnrichedArrangement[];
};

// ── Harness ──

let root: string;
let app: Hono;
let vault: Vault;
let queue: QueueStore;
let cookie: string;
let settled: number;
let waiting: (() => void)[];

/** Counts settled background docket runs and lets a test wait for one. */
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

/** The same request with NO session cookie — the auth gate's view. */
async function anon(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<Response> {
 const init: RequestInit = { method };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 }
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

/** A harvested snippet whose provenance names `session`, plus optional provenance extras. */
function seedSnippet(prose: string, session: string, extra?: Partial<Snippet['provenance']>): Snippet {
  return vault.saveSnippet(prose, {
    kind: 'harvest',
    session,
    question: 'what changed?',
    questionForm: 'deliberative',
    ...extra,
  });
}

/** The enriched entries of the piece's CURRENT arrangement. */
function entriesOf(p: EnrichedPiece): EnrichedEntry[] {
  return (p.arrangements.find((a) => a.id === p.current) ?? p.arrangements[0]!).entries;
}

/** One line per entry, so ordering reads as a plain array. */
function renderEntries(p: EnrichedPiece): string[] {
  return entriesOf(p).map((e) => (e.kind === 'pin' ? `pin:${e.prose ?? ''}` : `gap:${e.id}`));
}

describe('the piece routes (T6)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'elicit-piece-routes-'));
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
    // The boot docket settles once; waiting makes the seed reads deterministic.
    await waitForSettles(1);
    const login = await post('/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    expect(cookie).not.toBe('');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('POST /api/piece returns the chosen snippets in sitting order', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    seedTranscript('s-2022', '2022-11-02T00:00:00.000Z');
    const late = seedSnippet('written in 2022', 's-2022');
    const early = seedSnippet('written in 2018', 's-2018');
    const middle = seedSnippet('written in 2020', 's-2020');
    const res = await post('/api/piece', { snippets: [late.id, middle.id, early.id] });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    // Chosen out of order; the sitting dates decide (Q-59).
    expect(renderEntries(p)).toEqual(['pin:written in 2018', 'pin:written in 2020', 'pin:written in 2022']);
    // The pins' sitting dates ride the enriched entries.
    const pins = entriesOf(p).filter((e) => e.kind === 'pin') as EnrichedPin[];
    expect(pins.map((e) => e.sittingDate)).toEqual([
      '2018-09-01T00:00:00.000Z',
      '2020-03-15T00:00:00.000Z',
      '2022-11-02T00:00:00.000Z',
    ]);
  });

  it('POST /api/piece refuses an unknown snippet id', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const res = await post('/api/piece', { snippets: [s.id, ulid()] });
    expect(res.status).toBe(400);
  });

  it('GET /api/pieces lists every piece with its enriched current arrangement', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const created = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const res = await get('/api/pieces');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pieces: { id: string; current: string; arrangement: EnrichedArrangement }[];
    };
    expect(body.pieces).toHaveLength(1);
    expect(body.pieces[0]!.id).toBe(created.id);
    expect(body.pieces[0]!.current).toBe(created.current);
    const pin = body.pieces[0]!.arrangement.entries[0]! as EnrichedPin;
    expect(pin.kind).toBe('pin');
    expect(pin.prose).toBe('a paragraph');
    expect(pin.sittingDate).toBe('2018-09-01T00:00:00.000Z');
  });

  it('GET /api/piece/:id answers 404 for an unknown piece', async () => {
    expect((await get(`/api/piece/${ulid()}`)).status).toBe(404);
  });

  it('POST /prose writes a composition snippet with its own sitting and leaks nothing to the log', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('an earlier paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const text = 'A paragraph written straight into the piece.';
    const res = await post(`/api/piece/${piece.id}/prose`, { arrangement: piece.current, text });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    const pin = entriesOf(p)[1]! as EnrichedPin;
    expect(pin.kind).toBe('pin');
    expect(pin.version).toBe(1);
    expect(pin.prose).toBe(text);

    const snip = vault.rebuildIndex().snippets[pin.snippet]!;
    expect(snip.provenance.kind).toBe('composition');
    expect(snip.provenance.piece).toBe(piece.id);
    expect(snip.provenance.question).toBe('');
    // A composition act is its own sitting (Q-50): a NEW session, on disk.
    expect(snip.provenance.session).not.toBe('s-2018');
    const transcript = join(root, 'transcripts', `${snip.provenance.session}.md`);
    expect(existsSync(transcript)).toBe(true);
    const raw = readFileSync(transcript, 'utf-8');
    expect(raw).toContain('protocol: composition');
    expect(raw).toContain(text);

    // The text appears NOWHERE in the activity log — assert on the bytes.
    const logDir = join(root, 'log');
    const logBytes = existsSync(logDir)
      ? readdirSync(logDir)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => readFileSync(join(logDir, f), 'utf-8'))
          .join('\n')
      : '';
    expect(logBytes).not.toContain(text);
    expect(logBytes).not.toContain(text.trim());
  });

  it('POST /prose refuses empty text and inserts after the named entry', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const first = seedSnippet('the first paragraph', 's-2018');
    const second = seedSnippet('the second paragraph', 's-2020');
    const piece = (await (
      await post('/api/piece', { snippets: [first.id, second.id] })
    ).json()) as EnrichedPiece;

    const empty = await post(`/api/piece/${piece.id}/prose`, {
      arrangement: piece.current,
      text: '   ',
    });
    expect(empty.status).toBe(400);

    const res = await post(`/api/piece/${piece.id}/prose`, {
      arrangement: piece.current,
      text: 'inserted between them',
      after: entriesOf(piece)[0]!.id,
    });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(renderEntries(p)).toEqual([
      'pin:the first paragraph',
      'pin:inserted between them',
      'pin:the second paragraph',
    ]);
  });

  it('a pin at v1 stays v1 after a v2 lands, and a pin at the current version matches the index byte-for-byte', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('first draft of the paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    // v2 lands AFTER the pin: the pin must still resolve to v1 (Q-5).
    vault.saveVersion(s.id, 'second draft of the paragraph');

    const got = (await (await get(`/api/piece/${piece.id}`)).json()) as EnrichedPiece;
    const pin = entriesOf(got)[0]! as EnrichedPin;
    expect(pin.kind).toBe('pin');
    expect(pin.version).toBe(1);
    expect(pin.prose).toBe('first draft of the paragraph');
    expect(vault.rebuildIndex().snippets[s.id]!.prose).toBe('second draft of the paragraph');

    // The export renders the PINNED version, not the latest.
    const exp = await get(`/api/piece/${piece.id}/export`);
    expect(exp.status).toBe(200);
    const body = await exp.text();
    expect(body).toContain('first draft of the paragraph');
    expect(body).not.toContain('second draft');

    // A pin whose version vanished renders as null and never throws in GET.
    rmSync(join(root, 'snippets', s.id, 'v1.md'), { force: true });
    const after = (await (await get(`/api/piece/${piece.id}`)).json()) as EnrichedPiece;
    expect((entriesOf(after)[0]! as EnrichedPin).prose).toBeNull();

    // A pin at the CURRENT version resolves byte-identically to the index.
    seedTranscript('s-2019', '2019-05-05T00:00:00.000Z');
    const fresh = seedSnippet('a current paragraph', 's-2019');
    const piece2 = (await (await post('/api/piece', { snippets: [fresh.id] })).json()) as EnrichedPiece;
    const pin2 = entriesOf(piece2)[0]! as EnrichedPin;
    expect(pin2.prose).toBe(vault.rebuildIndex().snippets[fresh.id]!.prose);
    expect(pin2.prose).toBe('a current paragraph');
  });

  it('POST /gap mints exactly one queue entry per gap id, idempotently', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    const question = 'what made you change your mind about that?';
    const body = { arrangement: piece.current, gap: gapId, question };

    const r1 = await post(`/api/piece/${piece.id}/gap`, body);
    expect(r1.status).toBe(200);
    const p1 = (await r1.json()) as EnrichedPiece;
    const gap1 = entriesOf(p1)[1]! as EnrichedGap;
    expect(gap1.kind).toBe('gap');
    let entries = queue.list({ source: 'gap-declared' });
    expect(entries).toHaveLength(1);
    expect(gap1.question).toBe(entries[0]!.id);
    // The draft, exactly as the plan's Q-39 path declares it.
    expect(entries[0]!.source).toBe('gap-declared');
    expect(entries[0]!.license).toBe('arrangement-gap');
    expect(entries[0]!.question).toBe(question);
    expect(entries[0]!.questionForm).toBe('deliberative');
    expect(entries[0]!.sharpness).toBe('weak');
    expect(entries[0]!.horizon).toBe('session');
    expect(entries[0]!.gap).toBe(gapId);
    expect(entries[0]!.status).toBe('pending');
    // Absent is not a guess (Q-60): no target, no topic, no targetFacet.
    expect(entries[0]!.target).toBeUndefined();
    expect(entries[0]!.topic).toBeUndefined();
    expect(entries[0]!.targetFacet).toBeUndefined();

    // The same POST twice: one gap, one queue entry, 200 both times.
    const r2 = await post(`/api/piece/${piece.id}/gap`, body);
    expect(r2.status).toBe(200);
    const p2 = (await r2.json()) as EnrichedPiece;
    expect(entriesOf(p2).filter((e) => e.kind === 'gap')).toHaveLength(1);
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(1);

    // A different gap id: two of each.
    const r3 = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: ulid(),
      question: 'a second question?',
    });
    expect(r3.status).toBe(200);
    const p3 = (await r3.json()) as EnrichedPiece;
    expect(entriesOf(p3).filter((e) => e.kind === 'gap')).toHaveLength(2);
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(2);
  });

  it('POST /gap refuses an empty question on a picked-up piece', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const res = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: ulid(),
      question: '   ',
    });
    expect(res.status).toBe(400);
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(0);
  });

  it('set-down inserts the gap and mints nothing; pick-up mints again (Q-41)', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;

    const sd = await post(`/api/piece/${piece.id}/set-down`);
    expect(sd.status).toBe(200);
    const setDown = (await sd.json()) as EnrichedPiece;
    expect(setDown.setDownAt).not.toBeNull();
    expect(setDown.setDownBy).toBe('user');

    const gapId = ulid();
    const r = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gapId,
      question: 'should there be a question?',
    });
    expect(r.status).toBe(200);
    const p = (await r.json()) as EnrichedPiece;
    const gap = entriesOf(p)[1]! as EnrichedGap;
    expect(gap.kind).toBe('gap');
    expect(gap.question).toBeNull();
    // Q-41's exact wording, tested: setting down stops minting.
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(0);

    const pu = await post(`/api/piece/${piece.id}/pick-up`);
    expect(pu.status).toBe(200);
    expect(((await pu.json()) as EnrichedPiece).setDownAt).toBeNull();

    const r2 = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: ulid(),
      question: 'now it can mint?',
    });
    expect(r2.status).toBe(200);
    const p2 = (await r2.json()) as EnrichedPiece;
    expect((entriesOf(p2)[2]! as EnrichedGap).question).not.toBeNull();
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(1);
  });

  it('POST /remove on a gap leaves its queue entry present and pending', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gapId,
      question: 'a question the gap asked',
    });

    const res = await post(`/api/piece/${piece.id}/remove`, { arrangement: piece.current, entry: gapId });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect(entriesOf(p).map((e) => e.id)).not.toContain(gapId);
    expect(entriesOf(p)).toHaveLength(1);
    // No retract verb anywhere in this design: the question stays in the
    // Queue to expire on the normal rule (Q-41).
    const entries = queue.list({ source: 'gap-declared' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('pending');
    expect(entries[0]!.gap).toBe(gapId);
  });

  it('POST /reorder accepts a permutation and refuses an add or a drop', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('the older paragraph', 's-2018');
    const b = seedSnippet('the newer paragraph', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id, b.id] })).json()) as EnrichedPiece;
    const ids = entriesOf(piece).map((e) => e.id);

    const ok = await post(`/api/piece/${piece.id}/reorder`, {
      arrangement: piece.current,
      entries: [ids[1]!, ids[0]!],
    });
    expect(ok.status).toBe(200);
    const p = (await ok.json()) as EnrichedPiece;
    expect(entriesOf(p).map((e) => e.id)).toEqual([ids[1]!, ids[0]!]);

    // Dropping an entry is not a reorder.
    const drop = await post(`/api/piece/${piece.id}/reorder`, {
      arrangement: piece.current,
      entries: [ids[0]!],
    });
    expect(drop.status).toBe(400);
    // Neither is adding one.
    const add = await post(`/api/piece/${piece.id}/reorder`, {
      arrangement: piece.current,
      entries: [...ids, ulid()],
    });
    expect(add.status).toBe(400);
  });

  it('GET /api/piece/:id offers exactly the snippets whose provenance names the gap', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gapId,
      question: 'what does the gap ask?',
    });

    // The answer: a snippet whose provenance.gap equals the gap's own id.
    const answer = seedSnippet('the answer to the gap', 's-2018', { gap: gapId });
    // A snippet with NO gap in its provenance, however similar the text, is
    // NOT offered — the join is exact (Q-39), never a similarity search.
    seedSnippet('the answer to the gap', 's-2018');

    const p = (await (await get(`/api/piece/${piece.id}`)).json()) as EnrichedPiece;
    const gap = entriesOf(p)[1]! as EnrichedGap;
    expect(gap.kind).toBe('gap');
    expect(gap.offers.map((o) => o.id)).toEqual([answer.id]);
    expect(gap.offers[0]!.prose).toBe('the answer to the gap');
  });

  it('POST /gap/accept replaces the gap with a pin at the same index and leaves the queue alone', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gapId,
      question: 'what does the gap ask?',
    });
    const answer = seedSnippet('the answer', 's-2018', { gap: gapId });

    const res = await post(`/api/piece/${piece.id}/gap/accept`, {
      arrangement: piece.current,
      gap: gapId,
      snippet: answer.id,
      version: answer.version,
    });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    const entries = entriesOf(p);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.kind).toBe('pin');
    const placed = entries[1]! as EnrichedPin;
    expect(placed.kind).toBe('pin');
    expect(placed.snippet).toBe(answer.id);
    expect(placed.version).toBe(1);
    expect(placed.prose).toBe('the answer');

    // The gap's queue entry is untouched — the sitting that produced the
    // answer already handled it; nothing here touches the Queue.
    const q = queue.list({ source: 'gap-declared' });
    expect(q).toHaveLength(1);
    expect(q[0]!.gap).toBe(gapId);
    expect(q[0]!.status).toBe('pending');
  });

  it('POST /gap/accept refuses a snippet that did not answer the gap, and writes nothing', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    const gapId = ulid();
    await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gapId,
      question: 'what does the gap ask?',
    });
    const answer = seedSnippet('the real answer', 's-2018', { gap: gapId });
    // No gap in its provenance, however relevant it looks.
    const unrelated = seedSnippet('the real answer', 's-2018');
    const arrFile = join(root, 'pieces', piece.id, 'arrangements', `${piece.current}.md`);
    const before = readFileSync(arrFile, 'utf-8');

    const refused = await post(`/api/piece/${piece.id}/gap/accept`, {
      arrangement: piece.current,
      gap: gapId,
      snippet: unrelated.id,
      version: 1,
    });
    expect(refused.status).toBe(400);
    expect(readFileSync(arrFile, 'utf-8')).toBe(before);

    // A version that does not resolve is refused too.
    const badVersion = await post(`/api/piece/${piece.id}/gap/accept`, {
      arrangement: piece.current,
      gap: gapId,
      snippet: answer.id,
      version: 99,
    });
    expect(badVersion.status).toBe(400);
    expect(readFileSync(arrFile, 'utf-8')).toBe(before);
  });

  it('accepting on a set-down piece succeeds and mints nothing', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    await post(`/api/piece/${piece.id}/set-down`);
    const gapId = ulid();
    await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gapId,
      question: 'ignored while set down',
    });
    const answer = seedSnippet('the answer', 's-2018', { gap: gapId });

    const res = await post(`/api/piece/${piece.id}/gap/accept`, {
      arrangement: piece.current,
      gap: gapId,
      snippet: answer.id,
      version: 1,
    });
    expect(res.status).toBe(200);
    const p = (await res.json()) as EnrichedPiece;
    expect((entriesOf(p)[1]! as EnrichedPin).kind).toBe('pin');
    // Q-41 stops MINTING; accepting mints nothing, set down or not.
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(0);
  });

  it('GET /export is text/markdown with every pinned paragraph and nothing else', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2020', '2020-03-15T00:00:00.000Z');
    const a = seedSnippet('first paragraph of the piece', 's-2018');
    const b = seedSnippet('second paragraph of the piece', 's-2020');
    const piece = (await (await post('/api/piece', { snippets: [a.id, b.id] })).json()) as EnrichedPiece;

    // A Marginalium on disk: the export must not show it.
    const arrFile = join(root, 'pieces', piece.id, 'arrangements', `${piece.current}.md`);
    const parsed = matter.read(arrFile);
    const data = parsed.data as { marginalia: unknown[] };
    data.marginalia = [
      { id: ulid(), on: null, note: 'principle', text: 'ordered as it happened', at: new Date().toISOString() },
    ];
    writeFileSync(arrFile, matter.stringify(parsed.content, data), 'utf-8');

    const res = await get(`/api/piece/${piece.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="piece-${piece.id}.md"`);
    const body = await res.text();
    expect(body).toContain('first paragraph of the piece');
    expect(body).toContain('second paragraph of the piece');
    // No heading, no separator, no Marginalia — the person's sentences and
    // nothing else (Q-1).
    expect(body).not.toContain('#');
    expect(body).not.toContain('---');
    expect(body).not.toContain('ordered as it happened');
  });

  it('every piece route refuses a missing session cookie', async () => {
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const s = seedSnippet('a paragraph', 's-2018');
    const piece = (await (await post('/api/piece', { snippets: [s.id] })).json()) as EnrichedPiece;
    expect((await anon('/api/piece', 'POST', { snippets: [s.id] })).status).toBe(401);
    expect((await anon('/api/pieces')).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}`)).status).toBe(401);
    expect(
      (await anon(`/api/piece/${piece.id}/reorder`, 'POST', { arrangement: piece.current, entries: [] })).status,
    ).toBe(401);
    expect(
      (await anon(`/api/piece/${piece.id}/remove`, 'POST', { arrangement: piece.current, entry: 'x' })).status,
    ).toBe(401);
    expect(
      (await anon(`/api/piece/${piece.id}/prose`, 'POST', { arrangement: piece.current, text: 'x' })).status,
    ).toBe(401);
    expect(
      (await anon(`/api/piece/${piece.id}/gap`, 'POST', { arrangement: piece.current, gap: ulid() })).status,
    ).toBe(401);
    expect(
      (await anon(`/api/piece/${piece.id}/gap/accept`, 'POST', {
        arrangement: piece.current,
        gap: ulid(),
        snippet: 'x',
        version: 1,
      })).status,
    ).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/set-down`, 'POST')).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/pick-up`, 'POST')).status).toBe(401);
    expect((await anon(`/api/piece/${piece.id}/export`)).status).toBe(401);
  });
});

// ===========================================================================
// The piece jobs through createApp (010 T10)
// ===========================================================================
// The wiring test the plan demands: the vault is SEEDED before createApp so
// the boot docket run IS the run under test — a test that hand-builds a
// runDocket deps object would stay green over an unwired product.

describe('the piece jobs through createApp (010 T10)', () => {
  let pieceId: string;

  function daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'elicit-piece-routes-'));
    settled = 0;
    waiting = [];
    vault = createVault(root);
    queue = createQueueStore(root);

    // Seed the vault BEFORE createApp: one dormant piece carrying one stale
    // pin, so the boot docket run does both piece jobs.
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    const snip = seedSnippet('a paragraph pinned long ago', 's-2018');
    const store = createPieceStore(root);
    const piece = store.create([{ id: ulid(), kind: 'pin', snippet: snip.id, version: 1 }]);
    pieceId = piece.id;
    // The snippet moves on: v2 exists on disk, the pin still names v1.
    vault.saveVersion(snip.id, 'newer prose');
    // Age every captured/created the sweep reads to 60 days ago, bodies
    // preserved. The dormancy sweep reads the register's CURRENT version of
    // the pinned snippet, so v2's captured is the one that must be old.
    const v1 = matter.read(join(root, 'snippets', snip.id, 'v1.md'));
    v1.data.captured = daysAgo(60);
    writeFileSync(join(root, 'snippets', snip.id, 'v1.md'), matter.stringify(v1.content, v1.data), 'utf-8');
    const v2 = matter.read(join(root, 'snippets', snip.id, 'v2.md'));
    v2.data.captured = daysAgo(60);
    writeFileSync(join(root, 'snippets', snip.id, 'v2.md'), matter.stringify(v2.content, v2.data), 'utf-8');
    const pm = matter.read(join(root, 'pieces', piece.id, 'piece.md'));
    pm.data.created = daysAgo(60);
    writeFileSync(join(root, 'pieces', piece.id, 'piece.md'), matter.stringify(pm.content, pm.data), 'utf-8');
    const am = matter.read(join(root, 'pieces', piece.id, 'arrangements', piece.current + '.md'));
    am.data.created = daysAgo(60);
    writeFileSync(join(root, 'pieces', piece.id, 'arrangements', piece.current + '.md'), matter.stringify(am.content, am.data), 'utf-8');

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
    // The boot docket run IS the run under test; wait for it to settle.
    await waitForSettles(1);
    const login = await post('/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    expect(cookie).not.toBe('');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('the boot run flags the stale pin and sets the dormant piece down, on disk', async () => {
    const pieces = createPieceStore(root).list();
    expect(pieces).toHaveLength(1);
    const current = pieces[0]!.arrangements.find((a) => a.id === pieces[0]!.current)!;
    const flags = current.marginalia.filter((m) => m.note === 'stale-pin');
    // Exactly one stale-pin note, aimed at the pin's entry id.
    expect(flags).toHaveLength(1);
    const pin = current.entries.find((e) => e.kind === 'pin')!;
    expect(flags[0]!.on).toBe(pin.id);
    // The pin's version is still 1 on disk (Q-39: flagged, never re-pinned).
    expect(pin.kind).toBe('pin');
    if (pin.kind === 'pin') expect(pin.version).toBe(1);

    // piece.md frontmatter: set down by dormancy, reversibly (Q-41).
    const fm = matter.read(join(root, 'pieces', pieceId, 'piece.md')).data as {
      setDownAt?: string;
      setDownBy?: string;
    };
    expect(fm.setDownAt).toBeDefined();
    expect(fm.setDownBy).toBe('dormancy');
  });
});
