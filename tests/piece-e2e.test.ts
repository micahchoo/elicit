/**
 * Pass 1 end to end (T8) — the slice hypothesis, with no model reachable.
 *
 * One flow, one describe block, driven through the REAL app: three sittings
 * (2018 / 2022 / 2026) become a Piece in sitting order, the arrangement is
 * reordered and read back FROM DISK, prose composes a fourth snippet in its
 * own sitting, a Gap mints exactly one queue entry (Q-39), set-down stops
 * minting and pick-up resumes it (Q-41), a disk-seeded answer is offered on
 * exactly the Gap its provenance names and is accepted into a pin, and the
 * export carries every pinned paragraph and nothing else (Q-1).
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
 * exists, the arrangement file's body is empty, the seeded snippet files are
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
import { createPieceStore } from '../src/piece/store.js';
import { samePinSet } from '../src/piece/contract.js';

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

/** The enriched entries of the piece's CURRENT arrangement. */
function entriesOf(p: EnrichedPiece): EnrichedEntry[] {
  return (p.arrangements.find((a) => a.id === p.current) ?? p.arrangements[0]!).entries;
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
    //    out of order, so the arrangement proves SITTING order (Q-59).
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
    const createdRes = await post('/api/piece', {
      snippets: [from2026.id, from2018.id, from2022.id],
    });
    expect(createdRes.status).toBe(200);
    const piece = (await createdRes.json()) as EnrichedPiece;
    expect(renderEntries(piece)).toEqual([
      'pin:written in 2018',
      'pin:written in 2022',
      'pin:written in 2026',
    ]);
    const arrFile = join(root, 'pieces', piece.id, 'arrangements', `${piece.current}.md`);
    expect(existsSync(arrFile)).toBe(true);

    // 3. Reorder the last to the front, then read the order back FROM DISK —
    //    the response is not the truth, the file is (Q-3).
    const ids = entriesOf(piece).map((e) => e.id);
    const reordered = (await (
      await post(`/api/piece/${piece.id}/reorder`, {
        arrangement: piece.current,
        entries: [ids[2]!, ids[0]!, ids[1]!],
      })
    ).json()) as EnrichedPiece;
    expect(entriesOf(reordered).map((e) => e.id)).toEqual([ids[2]!, ids[0]!, ids[1]!]);
    const diskArr = matter.read(arrFile);
    // gray-matter types `data` loosely; the arrangement frontmatter shape is
    // this store's own write format (src/piece/store.ts #writeArrangement).
    const arrData = diskArr.data as { entries: { id: string }[] };
    expect(arrData.entries.map((e) => e.id)).toEqual([ids[2]!, ids[0]!, ids[1]!]);

    // 4. POST /prose — the person's words become a composition Snippet in
    //    their own sitting (Q-40, Q-50): a fourth snippet on disk, its own
    //    transcript with protocol composition, pinned at v1.
    const proseText = 'A paragraph written straight into the piece.';
    const proseRes = await post(`/api/piece/${piece.id}/prose`, {
      arrangement: piece.current,
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
    const gap1Id = ulid();
    const gapRes = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gap1Id,
      after: prosePin.id,
      question: 'what does the gap ask?',
    });
    expect(gapRes.status).toBe(200);
    const withGap1 = (await gapRes.json()) as EnrichedPiece;
    const gap1 = entriesOf(withGap1)[4]! as EnrichedGap;
    expect(gap1.kind).toBe('gap');
    expect(gap1.question).not.toBeNull();
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(1);
    expect(queue.list({ source: 'gap-fill' })).toHaveLength(0);

    // 6. Set-down — a second gap inserts a Gap and mints NOTHING (Q-41):
    //    the count stays at 1 and the new gap carries no question id.
    expect((await post(`/api/piece/${piece.id}/set-down`)).status).toBe(200);
    const gap2Id = ulid();
    const gap2Res = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gap2Id,
      after: gap1Id,
      question: 'this must not mint while set down',
    });
    expect(gap2Res.status).toBe(200);
    const withGap2 = (await gap2Res.json()) as EnrichedPiece;
    const gap2 = entriesOf(withGap2)[5]! as EnrichedGap;
    expect(gap2.kind).toBe('gap');
    expect(gap2.question).toBeNull();
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(1);

    // 7. Pick-up — a third gap mints again (count 2).
    expect((await post(`/api/piece/${piece.id}/pick-up`)).status).toBe(200);
    const gap3Id = ulid();
    const gap3Res = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: piece.current,
      gap: gap3Id,
      after: gap2Id,
      question: 'picked up, so it can mint again',
    });
    expect(gap3Res.status).toBe(200);
    const withGap3 = (await gap3Res.json()) as EnrichedPiece;
    const gap3 = entriesOf(withGap3)[6]! as EnrichedGap;
    expect(gap3.kind).toBe('gap');
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
    const gotGaps = entriesOf(got).filter((e) => e.kind === 'gap') as EnrichedGap[];
    expect(gotGaps).toHaveLength(3);
    expect(gotGaps[0]!.offers.map((o) => o.id)).toEqual([answer.id]);
    expect(gotGaps[0]!.offers[0]!.prose).toBe('the answer to the first gap');
    expect(gotGaps[1]!.offers).toEqual([]);
    expect(gotGaps[2]!.offers).toEqual([]);

    // 10. POST /gap/accept — the gap becomes a pin at the same index, and
    //     the queue entry is untouched: still pending, no sitting drew it.
    const acceptRes = await post(`/api/piece/${piece.id}/gap/accept`, {
      arrangement: piece.current,
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
    //     nothing else: no '#', no '---', no Marginalia (Q-1).
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

    // 12. Disk state: the piece dir exists, the arrangement body is empty,
    //     the seeded snippet files are byte-identical, and nothing anywhere
    //     under the vault was deleted by the flow.
    expect(existsSync(join(root, 'pieces', piece.id))).toBe(true);
    const finalArr = matter.read(arrFile);
    expect(finalArr.content.trim()).toBe('');
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

describe('pass 2 end to end: candidate arrangements, choose, stale-pin sweep, auto-set-down (T13)', () => {
  // ── The scripted model, and every text it has seen ──
  // The content-routed fake answers the arrangements prompt with the two
  // scripted candidates and every other call benignly, so the boot docket
  // and the docket runs behind the import scans all settle. The scripted
  // gap questions are written to pass the Q-12 gate against the prose
  // chosen in the flow below: in [c,a,b] the gap after a quotes a's prose,
  // and in [b,a,c] the gap after b quotes a's prose again — the anchor is
  // always one of the gap's two neighbours, so the quoted phrase is
  // adjacent in both orderings.
  const seenTexts: string[] = [];
  let flowPins: { a: Snippet; b: Snippet; c: Snippet } | null = null;
  const contentRoutedFake: Complete = async (system, turns) => {
    const text = turns[turns.length - 1]?.text ?? system;
    seenTexts.push(text);
    if (text.includes('orderings') && flowPins !== null) {
      const { a, b, c } = flowPins;
      return JSON.stringify({
        orderings: [
          {
            principle: 'argument',
            sentence: 'The page moves from the memory to the decision it forced.',
            order: [c.id, a.id, b.id],
            roles: {
              [c.id]: 'states the outcome',
              [a.id]: 'sets the scene',
              [b.id]: 'draws the consequence',
            },
            gaps: [{ after: a.id, question: 'What changed when you "stopped checking the clock"?' }],
          },
          {
            principle: 'contrast',
            sentence: 'Two ways of working sit against each other.',
            order: [b.id, a.id, c.id],
            roles: {
              [b.id]: 'names the first way',
              [a.id]: 'names the second',
              [c.id]: 'shows the cost',
            },
            gaps: [{ after: b.id, question: 'Did the "studio smelled of paint and coffee" every morning?' }],
          },
        ],
      });
    }
    if (text.toLowerCase().includes('red light')) return '{"lights": []}';
    if (text.toLowerCase().includes('harvesting agent')) return '{"cuts": []}';
    return 'Reflecting on what you wrote, what still feels true today?';
  };

  beforeAll(async () => {
    process.env.ELICIT_LLM = 'fake';
    root = mkdtempSync(join(tmpdir(), 'elicit-piece-e2e-pass2-'));
    settled = 0;
    waiting = [];
    vault = createVault(root);
    queue = createQueueStore(root);
    const authStore = createFileAuth(join(root, '.auth.json'));
    authStore.setup('a password');
    app = await createApp({
      vault,
      complete: contentRoutedFake,
      queue,
      index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
      vaultRoot: root,
      authStore,
      onDocketSettled,
    });
    // The boot docket settles with the fake answering every call benignly.
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

  it('drives candidate arrangements, a choice, a stale-pin sweep and auto-set-down end to end', async () => {
    // 1. Three sittings and three harvested paragraphs. The prose is chosen
    //    so each scripted gap question quotes a pin adjacent to the gap,
    //    verbatim and set off in quotation marks (Q-12).
    seedTranscript('s2-2018', '2018-09-01T00:00:00.000Z');
    seedTranscript('s2-2022', '2022-11-02T00:00:00.000Z');
    seedTranscript('s2-2026', '2026-05-20T00:00:00.000Z');
    const a = seedSnippet(
      'The studio smelled of paint and coffee every morning, until I stopped checking the clock.',
      's2-2018',
    );
    const b = seedSnippet('I learned to trust the quiet hours before anyone else arrived.', 's2-2022');
    const c = seedSnippet('The best work came after I stopped checking the clock.', 's2-2026');
    flowPins = { a, b, c };

    // 2. POST /api/piece — three pins at v1, sitting order.
    const createdRes = await post('/api/piece', { snippets: [c.id, a.id, b.id] });
    expect(createdRes.status).toBe(200);
    const piece = (await createdRes.json()) as EnrichedPiece;
    expect(renderEntries(piece)).toHaveLength(3);
    expect(renderEntries(piece).sort()).toEqual([a.prose, b.prose, c.prose].map((p) => `pin:${p}`).sort());

    // 3. POST /api/piece/:id/arrangements — two candidates on disk under
    //    distinct principles, both permutations of the base pin set, each
    //    carrying one model-marked gap; the QUEUE is untouched, because
    //    proposing mints nothing (Q-39).
    const arrRes = await post(`/api/piece/${piece.id}/arrangements`);
    expect(arrRes.status).toBe(200);
    const withCandidates = (await arrRes.json()) as EnrichedPiece;
    expect(queue.list({ source: 'gap-fill' })).toHaveLength(0);
    const stored = createPieceStore(root).get(piece.id)!;
    expect(stored.arrangements).toHaveLength(3); // base + argument + contrast
    const base = stored.arrangements.find((x) => x.principle === 'chronology')!;
    const argument = stored.arrangements.find((x) => x.principle === 'argument')!;
    const contrast = stored.arrangements.find((x) => x.principle === 'contrast')!;
    expect(samePinSet(base.entries, argument.entries)).toBeNull();
    expect(samePinSet(base.entries, contrast.entries)).toBeNull();
    // Q-34's model stamp is the route's business, and with ELICIT_LLM=fake
    // there is no model name to stamp (src/server.ts) — the plan's
    // model-stamped assertion is dropped, and its absence is pinned instead.
    expect(argument.model).toBeUndefined();
    expect(contrast.model).toBeUndefined();
    const argCand = withCandidates.arrangements.find((x) => x.principle === 'argument')!;
    const conCand = withCandidates.arrangements.find((x) => x.principle === 'contrast')!;
    const argGap = argCand.entries.find((e): e is EnrichedGap => e.kind === 'gap')!;
    const conGap = conCand.entries.find((e): e is EnrichedGap => e.kind === 'gap')!;
    expect(argGap.pending).toContain('stopped checking the clock');
    expect(argGap.question).toBeNull();
    expect(conGap.pending).toContain('studio smelled of paint and coffee');
    expect(conGap.question).toBeNull();
    // The entry ids the later steps address, from the CURRENT candidate
    // (buildEntry mints fresh ids, so the base piece's ids would not match).
    const cPinEntryId = argument.entries.find((e) => e.kind === 'pin' && e.snippet === c.id)!.id;
    const aPinEntryId = argument.entries.find((e) => e.kind === 'pin' && e.snippet === a.id)!.id;

    // 4. POST /api/piece/:id/choose — the argument candidate becomes
    //    current, the contrast candidate stays on disk (Q-38), and EXACTLY
    //    ONE gap-fill entry appears: the chosen gap's question, minted with
    //    its pending text and written back onto the arrangement (Q-39).
    const chosenRes = await post(`/api/piece/${piece.id}/choose`, { arrangement: argCand.id });
    expect(chosenRes.status).toBe(200);
    const chosen = (await chosenRes.json()) as EnrichedPiece;
    expect(chosen.current).toBe(argCand.id);
    expect(createPieceStore(root).get(piece.id)!.arrangements).toHaveLength(3);
    const gapFill = queue.list({ source: 'gap-fill' });
    expect(gapFill).toHaveLength(1);
    expect(gapFill[0]!.question).toBe(argGap.pending);
    expect(gapFill[0]!.question).not.toContain('studio smelled');
    const chosenGap = entriesOf(chosen).find((e): e is EnrichedGap => e.kind === 'gap')!;
    expect(chosenGap.question).toBe(gapFill[0]!.id);

    // 5. A new version of c makes the c@1 pin stale. A docket run (an empty
    //    import scan) writes exactly ONE 'stale-pin' Marginalia aimed at the
    //    c-pin's entry, and the pin's version on disk is untouched: the
    //    sweep flags, never re-pins (Q-39).
    const newer = vault.saveVersion(c.id, 'newer prose');
    expect(newer.version).toBe(2);
    expect(vault.rebuildIndex().snippets[c.id]!.version).toBe(2);
    const emptyScan = mkdtempSync(join(tmpdir(), 'elicit-empty-scan-'));
    const beforeStale = settled;
    const scanRes = await post('/api/import/scan', { folder: emptyScan });
    expect(scanRes.status).toBe(200);
    await waitForSettles(beforeStale + 1);
    const currentFile = join(root, 'pieces', piece.id, 'arrangements', `${chosen.current}.md`);
    const staleData = matter.read(currentFile).data as {
      entries: { id: string; kind: string; snippet?: string; version?: number }[];
      marginalia: { id: string; on: string | null; note: string; text: string; at: string }[];
    };
    const staleFlags = staleData.marginalia.filter((m) => m.note === 'stale-pin');
    expect(staleFlags).toHaveLength(1);
    expect(staleFlags[0]!.on).toBe(cPinEntryId);
    expect(staleFlags[0]!.text).toContain(c.id + '@1');
    const cPin = staleData.entries.find((e) => e.kind === 'pin' && e.snippet === c.id);
    expect(cPin?.version).toBe(1);

    // 6. Age every touch the dormancy sweep reads — the piece's created,
    //    the current arrangement's created, and the latest captured of
    //    every pinned snippet (v2 for c, v1 for a and b) — past
    //    piece.dormancyDays (45). The next docket run sets the piece down
    //    with setDownBy: 'dormancy' (Q-41's second half).
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const age = (p: string, key: string): void => {
      const parsed = matter.read(p);
      writeFileSync(p, matter.stringify(parsed.content, { ...parsed.data, [key]: old }), 'utf-8');
    };
    age(join(root, 'pieces', piece.id, 'piece.md'), 'created');
    age(currentFile, 'created');
    age(join(root, 'snippets', c.id, 'v2.md'), 'captured');
    age(join(root, 'snippets', a.id, 'v1.md'), 'captured');
    age(join(root, 'snippets', b.id, 'v1.md'), 'captured');
    const beforeDormant = settled;
    const scan2Res = await post('/api/import/scan', { folder: emptyScan });
    expect(scan2Res.status).toBe(200);
    await waitForSettles(beforeDormant + 1);
    const pieceFm = matter.read(join(root, 'pieces', piece.id, 'piece.md')).data as {
      setDownAt?: string;
      setDownBy?: string;
    };
    expect(pieceFm.setDownAt).toBeDefined();
    expect(pieceFm.setDownBy).toBe('dormancy');

    // 7. While auto-set-down, a gap inserts and mints NOTHING (Q-41): the
    //    set-down branch of the gap route skips the question check, the new
    //    gap carries no question id, and the queue counts stand still.
    const gapFillBefore = queue.list({ source: 'gap-fill' }).length;
    const gapDeclaredBefore = queue.list({ source: 'gap-declared' }).length;
    const autoGapId = ulid();
    const gapRes = await post(`/api/piece/${piece.id}/gap`, {
      arrangement: chosen.current,
      gap: autoGapId,
      after: aPinEntryId,
      question: 'must not mint',
    });
    expect(gapRes.status).toBe(200);
    const afterGap = (await gapRes.json()) as EnrichedPiece;
    expect(afterGap.setDownBy).toBe('dormancy');
    const insertedGap = entriesOf(afterGap).find(
      (e): e is EnrichedGap => e.kind === 'gap' && e.id === autoGapId,
    )!;
    expect(insertedGap.question).toBeNull();
    expect(queue.list({ source: 'gap-fill' })).toHaveLength(gapFillBefore);
    expect(queue.list({ source: 'gap-declared' })).toHaveLength(gapDeclaredBefore);

    // 8. The flow's model calls were exactly the flow's: the arrangements
    //    POST was the only call that ever saw the 'orderings' prompt.
    expect(seenTexts.filter((t) => t.includes('orderings'))).toHaveLength(1);
  });
});
