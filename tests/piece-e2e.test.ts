/**
 * Pass 1 end to end (T8) — the slice hypothesis, with no model reachable.
 *
 * One flow, one describe block, driven through the REAL app: three sittings
 * (2018 / 2022 / 2026) become a Piece in sitting order under a subject, the
 * entries are reordered and read back FROM DISK, prose composes a fourth
 * snippet in its own sitting, a Gap mints exactly one queue entry (Q-39),
 * set-down stops minting and pick-up resumes it (Q-41), a disk-seeded
 * answer is offered on exactly the Gap its provenance names and is accepted
 * into a pin, and the export carries every pinned paragraph and nothing else
 * (Q-1). The ordering subsystem is gone: one entry list, no arrangements
 * (redesign-2026-08-09 §9).
 *
 * The model is UNREACHABLE, not merely unused: `ELICIT_LLM=fake` is set and
 * the `Complete` handed to createApp (and through it to the boot docket)
 * throws on any call. A pass-1 flow that quietly worked because a fake
 * answered would be no evidence that pass 1 works alone — so any route that
 * reaches for a model fails the test loudly, and the call counter proves the
 * flow itself made zero model calls after the boot docket settled.
 *
 * The gap link is seeded on disk, not elicited — that is deliberate (plan
 * T8): closing the loop for real means drawing the gap's question in a
 * sitting, and a sitting needs a model. `tests/gap-link.test.ts` proves the
 * link arrives through a real sitting; this test proves the Piece reads it.
 *
 * Everything asserts on DISK state as well as responses: the piece dir
 * exists, piece.md's body is empty, the seeded snippet files are
 * byte-identical, and no file anywhere under the vault was deleted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
import type { Complete, QueueStore, Snippet, Vault } from '../src/types.js';

// ── The response shapes this suite asserts (the cross-slice contract) ──

type GapKind = 'leap' | 'unsupported' | 'thin' | 'unclosed';
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
  kind: GapKind | null;
  placedBy: 'person' | 'model';
  question: string | null;
  pending: string | null;
  offers: Snippet[];
};
type EnrichedEntry = EnrichedPin | EnrichedGap;
type EnrichedPiece = {
  id: string;
  created: string;
  subject: string;
  setDownAt: string | null;
  setDownBy: string | null;
  discardedAt: string | null;
  entries: EnrichedEntry[];
  offers: unknown[];
  declined: string[];
  dismissedGaps: string[];
  marginalia: { id: string; on: string | null; note: string; text: string; at: string; model: string | null }[];
};

// ── Harness ──

let root: string;
let app: Hono;
let vault: Vault;
let queue: QueueStore;
let cookie: string;
let settled: number;
let waiting: (() => void)[];

/** Every call a route makes to a model. The flow must not add to it. */
let modelCalls = 0;

/**
 * The model that must never be reached. Throws so any route that reaches for
 * one fails the test loudly — and the counter is the quiet proof the flow
 * itself stayed at zero calls after the boot docket settled.
 */
const throwingComplete: Complete = async () => {
  modelCalls++;
  throw new Error('pass 1 must never reach a model (T8) — a Complete was called');
};

/** Counts settled background docket runs and lets the test wait for one. */
function onDocketSettled(): void {
  settled++;
  for (const w of waiting.splice(0)) w();
}

async function waitForSettles(n: number): Promise<void> {
  // The executor form is required: this project's TS lib target predates
  // Promise.withResolvers (es2024). Same shape as the piece-routes harness.
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

/** The enriched entries of the piece — one list, no arrangements. */
function entriesOf(p: EnrichedPiece): EnrichedEntry[] {
  return p.entries;
}

/** One line per entry, so ordering reads as a plain array. */
function renderEntries(p: EnrichedPiece): string[] {
  return entriesOf(p).map((e) => (e.kind === 'pin' ? `pin:${e.prose ?? ''}` : `gap:${e.id}`));
}

/** Every file under the vault as relative path → content. Nothing-deleted check. */
function snapshotTree(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(full.slice(root.length + 1), readFileSync(full, 'utf-8'));
    }
  };
  walk(root);
  return out;
}

describe('pass 1 end to end, with no model reachable (T8)', () => {
  beforeAll(async () => {
    process.env.ELICIT_LLM = 'fake';
    root = mkdtempSync(join(tmpdir(), 'elicit-piece-e2e-'));
    settled = 0;
    waiting = [];
    vault = createVault(root);
    queue = createQueueStore(root);
    const authStore = createFileAuth(join(root, '.auth.json'));
    authStore.setup('a password');
    app = await createApp({
      vault,
      complete: throwingComplete,
      queue,
      index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
      vaultRoot: root,
      authStore,
      onDocketSettled,
    });
    // The boot docket receives the throwing Complete too, and it always
    // settles: onDocketSettled fires in runDocketNow's finally whether the
    // run succeeded or failed (src/server.ts). The flow never depends on it.
    await waitForSettles(1);
    const login = await post('/api/login', { password: 'a password' });
    expect(login.status).toBe(200);
    cookie = /elicit_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    expect(cookie).not.toBe('');
  });

  afterAll(() => {
    delete process.env.ELICIT_LLM;
    rmSync(root, { recursive: true, force: true });
  });

  it('the whole pass-1 flow completes with no model reachable, and leaves the disk as a person would', async () => {
    // 1. Three sittings, 2018 / 2022 / 2026. The selection below passes them
    //    out of order, so the entries prove SITTING order (Q-59).
    seedTranscript('s-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s-2022', '2022-11-02T00:00:00.000Z');
    seedTranscript('s-2026', '2026-05-20T00:00:00.000Z');
    const from2018 = seedSnippet('written in 2018', 's-2018');
    const from2022 = seedSnippet('written in 2022', 's-2022');
    const from2026 = seedSnippet('written in 2026', 's-2026');
    const snippetFile = (s: Snippet) => join(root, 'snippets', s.id, 'v1.md');
    const seededBytes = {
      a: readFileSync(snippetFile(from2018), 'utf-8'),
      b: readFileSync(snippetFile(from2022), 'utf-8'),
      c: readFileSync(snippetFile(from2026), 'utf-8'),
    };
    // Every file on disk right now must still exist when the flow ends —
    // pass 1 never unlinks anything (Q-41).
    const seededTree = snapshotTree();
    const modelCallsAtFlowStart = modelCalls;

    // 2. POST /api/piece — chosen 2026, 2018, 2022; sitting dates decide.
    //    The subject is the gathering criterion, stored, never exported (Q-1).
    const subject = 'the clock, and what it costs to stop checking it';
    const createdRes = await post('/api/piece', {
      snippets: [from2026.id, from2018.id, from2022.id],
      subject,
    });
    expect(createdRes.status).toBe(200);
    const piece = (await createdRes.json()) as EnrichedPiece;
    expect(piece.subject).toBe(subject);
    expect(renderEntries(piece)).toEqual([
      'pin:written in 2018',
      'pin:written in 2022',
      'pin:written in 2026',
    ]);
    const pieceFile = join(root, 'pieces', piece.id, 'piece.md');
    expect(existsSync(pieceFile)).toBe(true);

    // 3. Reorder the last to the front, then read the order back FROM DISK —
    //    the response is not the truth, the file is (Q-3). The entries live
    //    in piece.md frontmatter: one list, no arrangement files.
    const ids = entriesOf(piece).map((e) => e.id);
    const reordered = (await (
      await post(`/api/piece/${piece.id}/reorder`, {
        entries: [ids[2]!, ids[0]!, ids[1]!],
      })
    ).json()) as EnrichedPiece;
    expect(entriesOf(reordered).map((e) => e.id)).toEqual([ids[2]!, ids[0]!, ids[1]!]);
    const diskPiece = matter.read(pieceFile);
    const diskData = diskPiece.data as { entries: { id: string }[] };
    expect(diskData.entries.map((e) => e.id)).toEqual([ids[2]!, ids[0]!, ids[1]!]);

    // 4. POST /prose — the person's words become a composition Snippet in
    //    their own sitting (Q-40, Q-50): a fourth snippet on disk, its own
    //    transcript with protocol composition, pinned at v1.
    const proseText = 'A paragraph written straight into the piece.';
    const proseRes = await post(`/api/piece/${piece.id}/prose`, {
      text: proseText,
    });
    expect(proseRes.status).toBe(200);
    const withProse = (await proseRes.json()) as EnrichedPiece;
    expect(renderEntries(withProse)).toEqual([
      'pin:written in 2026',
      'pin:written in 2018',
      'pin:written in 2022',
      `pin:${proseText}`,
    ]);
    const prosePin = entriesOf(withProse)[3]! as EnrichedPin;
    expect(prosePin.kind).toBe('pin');
    expect(prosePin.version).toBe(1);
    expect(prosePin.prose).toBe(proseText);
    const composition = vault.rebuildIndex().snippets[prosePin.snippet]!;
    expect(composition.provenance.kind).toBe('composition');
    expect(composition.provenance.piece).toBe(piece.id);
    expect(existsSync(snippetFile(composition))).toBe(true);
    const compTranscript = join(root, 'transcripts', `${composition.provenance.session}.md`);
    expect(existsSync(compTranscript)).toBe(true);
    const compRaw = readFileSync(compTranscript, 'utf-8');
    expect(compRaw).toContain('protocol: composition');
    expect(compRaw).toContain(proseText);

    // 5. POST /gap — the Q-39 mint: EXACTLY ONE queued question per gap, and
    //    ZERO gap-fill entries, because pass 1 has no model to mark a gap.
    //    The person's gap carries placedBy: 'person' and no kind.
    const gap1Id = ulid();
    const gapRes = await post(`/api/piece/${piece.id}/gap`, {
      gap: gap1Id,
      after: prosePin.id,
      question: 'what does the gap ask?',
    });
    expect(gapRes.status).toBe(200);
    const withGap1 = (await gapRes.json()) as EnrichedPiece;
    const gap1 = entriesOf(withGap1)[4]! as EnrichedGap;
    expect(gap1.placedBy).toBe('person');
    expect(gap1.kind).toBeNull();
    expect(gap1.question).not.toBeNull();
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(1);
    expect(queue.list({ source: 'gap-fill' })).toHaveLength(0);

    // 6. Set-down — a second gap inserts a Gap and mints NOTHING (Q-41):
    //    the count stays at 1 and the new gap carries no question id.
    expect((await post(`/api/piece/${piece.id}/set-down`)).status).toBe(200);
    const gap2Id = ulid();
    const gap2Res = await post(`/api/piece/${piece.id}/gap`, {
      gap: gap2Id,
      after: gap1Id,
      question: 'this must not mint while set down',
    });
    expect(gap2Res.status).toBe(200);
    const withGap2 = (await gap2Res.json()) as EnrichedPiece;
    const gap2 = entriesOf(withGap2)[5]! as EnrichedGap;
    expect(gap2.placedBy).toBe('person');
    expect(gap2.question).toBeNull();
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(1);

    // 7. Pick-up — a third gap mints again (count 2).
    expect((await post(`/api/piece/${piece.id}/pick-up`)).status).toBe(200);
    const gap3Id = ulid();
    const gap3Res = await post(`/api/piece/${piece.id}/gap`, {
      gap: gap3Id,
      after: gap2Id,
      question: 'picked up, so it can mint again',
    });
    expect(gap3Res.status).toBe(200);
    const withGap3 = (await gap3Res.json()) as EnrichedPiece;
    const gap3 = entriesOf(withGap3)[6]! as EnrichedGap;
    expect(gap3.placedBy).toBe('person');
    expect(gap3.question).not.toBeNull();
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(2);

    // 8. The gap link is SEEDED on disk, not elicited — deliberate (plan
    //    T8): closing the loop for real means a sitting, and a sitting needs
    //    a model. This snippet's provenance.gap names the FIRST gap's entry.
    const answer = seedSnippet('the answer to the first gap', 's-2018', { gap: gap1Id });
    expect(answer.provenance.gap).toBe(gap1Id);

    // 9. GET /api/piece/:id — the exact join (Q-39): the offer appears on
    //    exactly the gap the provenance names, and nothing on the others.
    const got = (await (await get(`/api/piece/${piece.id}`)).json()) as EnrichedPiece;
    const gotGaps = entriesOf(got).filter((e) => e.kind !== 'pin') as EnrichedGap[];
    expect(gotGaps).toHaveLength(3);
    expect(gotGaps[0]!.offers.map((o) => o.id)).toEqual([answer.id]);
    expect(gotGaps[0]!.offers[0]!.prose).toBe('the answer to the first gap');
    expect(gotGaps[1]!.offers).toEqual([]);
    expect(gotGaps[2]!.offers).toEqual([]);

    // 10. POST /gap/accept — the gap becomes a pin at the same index, and
    //     the queue entry is untouched: still pending, no sitting drew it.
    const acceptRes = await post(`/api/piece/${piece.id}/gap/accept`, {
      gap: gap1Id,
      snippet: answer.id,
      version: answer.version,
    });
    expect(acceptRes.status).toBe(200);
    const accepted = (await acceptRes.json()) as EnrichedPiece;
    expect(renderEntries(accepted)).toEqual([
      'pin:written in 2026',
      'pin:written in 2018',
      'pin:written in 2022',
      `pin:${proseText}`,
      'pin:the answer to the first gap',
      `gap:${gap2Id}`,
      `gap:${gap3Id}`,
    ]);
    const placed = entriesOf(accepted)[4]! as EnrichedPin;
    expect(placed.kind).toBe('pin');
    expect(placed.snippet).toBe(answer.id);
    expect(placed.version).toBe(1);
    expect(placed.prose).toBe('the answer to the first gap');
    const q = queue.list({ source: 'gap-declared' });
    expect(q).toHaveLength(2);
    const q1 = q.find((e) => e.gap === gap1Id);
    expect(q1).toBeDefined();
    expect(q1!.status).toBe('pending');

    // 11. GET /api/piece/:id/export — every pinned paragraph (the three
    //     seeded, the composed one, and the accepted answer = 5 pins) and
    //     nothing else: no '#', no '---', no Marginalia, no subject (Q-1).
    const exp = await get(`/api/piece/${piece.id}/export`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-type')).toContain('text/markdown');
    const body = await exp.text();
    expect(body).toContain('written in 2018');
    expect(body).toContain('written in 2022');
    expect(body).toContain('written in 2026');
    expect(body).toContain(proseText);
    expect(body).toContain('the answer to the first gap');
    expect(body).not.toContain('#');
    expect(body).not.toContain('---');
    expect(body).not.toContain('marginalia');
    expect(body).not.toContain(subject);

    // 12. Disk state: the piece dir exists, piece.md's body is empty, the
    //     seeded snippet files are byte-identical, and nothing anywhere
    //     under the vault was deleted by the flow.
    expect(existsSync(join(root, 'pieces', piece.id))).toBe(true);
    expect(matter.read(pieceFile).content.trim()).toBe('');
    expect(readFileSync(snippetFile(from2018), 'utf-8')).toBe(seededBytes.a);
    expect(readFileSync(snippetFile(from2022), 'utf-8')).toBe(seededBytes.b);
    expect(readFileSync(snippetFile(from2026), 'utf-8')).toBe(seededBytes.c);
    const finalTree = snapshotTree();
    for (const rel of seededTree.keys()) {
      expect(finalTree.has(rel), `deleted by the flow: ${rel}`).toBe(true);
    }

    // The flow itself completed with ZERO model calls — the boot docket's
    // settle was the only thing that could have reached a Complete, and the
    // counter proves nothing did during the flow.
    expect(modelCalls).toBe(modelCallsAtFlowStart);
  });
});
