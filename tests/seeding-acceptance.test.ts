/**
 * The seven jobs, as tests over one fixture vault (014 T15).
 *
 * One run over one undated vault, driven ONLY through the routes and the
 * server's real docket: declare a region (filename dating, 'other'), scan
 * with its slug, extract through the docket, review inside the region, and
 * commit each piece — then each job's ruling is asserted against the disk.
 * The run ends with dated sittings, true stances, a bounded queue, a capped
 * repair pass, and no surface that lists debt.
 *
 * The fixture (seeding Task 3) pins the load-bearing counts: four admitted
 * files, three of which open their prose with an anaphor (Task 10's three
 * danglers against a cap of 2), and SHARED_SENTENCE verbatim in two files
 * under two dates (Task 8's retelling). Those counts are imported from the
 * manifest, never restated.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createImportStore, type ImportStore } from '../src/import/store.js';
import { runDocket } from '../src/clerk/docket.js';
import { composeOpener, composeStillTrue } from '../src/clerk/composed.js';
import { readEvents } from '../src/log/activity.js';
import { makeScriptedComplete } from './fakes.js';
import { FIXTURE_ADMITTED, FIXTURE_DATES, SHARED_SENTENCE } from './fixtures/seeding-vault/manifest.js';
import type { Complete, Provenance, QueueDraft, QueueStore } from '../src/types.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'seeding-vault');
const D = { kind: 'filename' as const, pattern: 'YYYY-MM-DD' };

/** The four extraction answers, oldest date first — the docket's order. The
 * 2019-11-02 response carries TWO cuts: the anaphor opener AND SHARED_SENTENCE,
 * so the retelling is kept from both 2019 sittings (Task 8). */
const cut = (text: string): string =>
  JSON.stringify({
    cuts: [{ text, sourceTurn: 0, facet: 'value', stance: 'commitment', reading: 'the person keeps this sentence', standalone: true }],
  });

const FLOW_RESPONSES = (): string[] => [
  JSON.stringify({
    cuts: [
      { text: 'This is the week everything changed.', sourceTurn: 0, facet: 'value', stance: 'commitment', reading: 'the person keeps this sentence', standalone: true },
      { text: SHARED_SENTENCE, sourceTurn: 0, facet: 'value', stance: 'commitment', reading: 'the person keeps this sentence', standalone: true },
    ],
  }),
  cut(SHARED_SENTENCE),
  cut('This is what made the whole thing work.'),
  cut('It started as a side project and became the way we plan.'),
  'padding', 'padding', 'padding', 'padding',
];

/** The Confirm job's complete (Task 10/15): the still-true composer gets a
 * question quoting the candidate verbatim; everything else is answered with
 * an empty string, which every composer rejects to null. */
function confirmComplete(): Complete {
  return async (_system, turns) => {
    const prompt = turns[0]?.text ?? '';
    if (!prompt.includes('asking whether it still holds true')) return '';
    const m = /Snippet: "([\s\S]*?)"\n/.exec(prompt);
    if (m === null) return '';
    return `Is "${m[1]}" still true for you?`;
  };
}

let root: string;
let app: Hono;
let store: ImportStore;
let queue: QueueStore;
let slug: string;
let scanBody: { pending: number; refused: { file: string; reason: string }[] };
let offerBody: { offer: unknown; root: string | null };
let transcriptsAbsentAtOffer: boolean;
let firstRemaining: number;
let settled: number;
const waiting: (() => void)[] = [];

function onDocketSettled(): void {
  settled++;
  waiting.splice(0).forEach((r) => r());
}

async function waitForSettles(n: number): Promise<void> {
  while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

async function get(path: string): Promise<Response> {
  return app.fetch(new Request(`http://127.0.0.1${path}`), { remoteAddr: '127.0.0.1' });
}

async function post(path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** Every path the app answers, so a test can prove a route does NOT exist. */
function routePaths(): string[] {
  return app.routes.map((r) => r.path);
}

/** Every snippet v1 on disk, with its provenance read back from the markdown. */
function snippetsOnDisk(): { id: string; prose: string; provenance: Provenance }[] {
  const dir = join(root, 'snippets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((id) => {
    const parsed = matter.read(join(dir, id, 'v1.md'));
    return { id, prose: parsed.content.trimEnd(), provenance: parsed.data.provenance as Provenance };
  });
}

/** Every reading on disk. */
function readingsOnDisk(): { stance: string; cites: string[] }[] {
  const dir = join(root, 'readings');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => matter.read(join(dir, f)).data as { stance: string; cites: string[] });
}

/** Every Bud on disk. */
function budsOnDisk(): { failures: string[] }[] {
  const dir = join(root, 'buds');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => matter.read(join(dir, f)).data as { failures: string[] });
}

/** Every sitting's `started`, read from the transcripts. */
function sittingsOnDisk(): { started: string }[] {
  const dir = join(root, 'transcripts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => matter.read(join(dir, f)).data as { started: string });
}

/** The repair ledger's lines, parsed. */
function ledgerLines(): { snippetId: string; questioned: boolean }[] {
  const f = join(root, 'imports', 'repair-ledger.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { snippetId: string; questioned: boolean });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'elicit-seeding-acceptance-'));
  settled = 0;
  const vault = createVault(root);
  queue = createQueueStore(root);
  const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
  app = await createApp({
    vault,
    complete: makeScriptedComplete(FLOW_RESPONSES()),
    queue,
    index,
    vaultRoot: root,
    authStore: createFileAuth(join(root, '.auth.json')),
    onDocketSettled,
  });
  store = createImportStore(root);
  await waitForSettles(1); // the boot docket, a no-op against the empty store

  // The offer first, before any corpus exists: Reach evaluates, and nothing
  // acts on it — the offer must never write a transcript.
  offerBody = (await (await get('/api/reach')).json()) as { offer: unknown; root: string | null };
  transcriptsAbsentAtOffer = !existsSync(join(root, 'transcripts'));

  // Declare → scan → docket extraction → review inside the region → commit.
  const declared = (await (await post('/api/import/region', { root: FIXTURE, dating: D, authorship: 'other' })).json()) as { slug: string };
  slug = declared.slug;
  const res = await post('/api/import/scan', { folder: FIXTURE, region: slug });
  scanBody = (await res.json()) as { pending: number; refused: { file: string; reason: string }[] };
  await waitForSettles(2); // the scan-triggered extraction run

  for (let i = 0; i < FIXTURE_ADMITTED; i++) {
    const next = (await (await get(`/api/import/next?region=${slug}`)).json()) as {
      item: { hash: string; cuts: unknown[]; remaining?: number } | null;
    };
    expect(next.item).not.toBeNull();
    if (i === 0) firstRemaining = next.item!.remaining ?? 0;
    const decisions = next.item!.cuts.map((_c, idx) => ({ cut: idx, action: 'approve' as const }));
    const r = await post(`/api/import/${next.item!.hash}/decisions`, { decisions });
    expect(r.status).toBe(200);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the seven jobs, one undated vault (014 T15)', () => {
  it('Survey — the map is computed, model-free, and stores no completeness flag', () => {
    expect(readFileSync('src/import/survey.ts', 'utf-8')).not.toMatch(/from ['"][^'"]*llm|from ['"][^'"]*harvester|: Complete\b/);
    expect(readdirSync(join(root, 'imports'))).not.toContain('completeness.json');
  });

  it('Reach — offers, never acts: no corpus exists after an offer is shown', () => {
    expect(transcriptsAbsentAtOffer).toBe(true);
    expect(offerBody).toBeDefined();
  });

  it('Cut — the review queue never exceeds the chosen region', async () => {
    // Four extracted, one handed back: three remain INSIDE the region — the
    // bound held through the whole review, and the drain consumed exactly the
    // region's own items.
    expect(firstRemaining).toBe(FIXTURE_ADMITTED - 1);
  });

  it('Cut — there is still no batch accept', () => {
    expect(routePaths()).not.toContain('/api/import/accept-all');
  });

  it('Anchor — an undated vault imports by filename and names what it refused', () => {
    expect(sittingsOnDisk().map((s) => s.started)).toContain('2021-03-04T00:00:00.000Z');
    expect(scanBody.refused).toContainEqual({ file: 'ideas.md', reason: 'no-date-in-name' });
  });

  it('Anchor — no date anywhere comes from an mtime', () => {
    // FIXTURE_DATES comes from the manifest, and every fixture file was
    // touched by the repo's own checkout — an exact set read from the one
    // place that defines it cannot accidentally match today.
    expect(sittingsOnDisk().map((s) => s.started.slice(0, 10)).sort()).toEqual([...FIXTURE_DATES].sort());
    expect(FIXTURE_DATES).not.toContain(new Date().toISOString().slice(0, 10)); // the guard's guard
  });

  it('Authorship — no snippet from an "other" region carries stance avowal', () => {
    const snippets = snippetsOnDisk();
    expect(snippets.length).toBeGreaterThan(0);
    for (const s of snippets) {
      expect(s.provenance.authorship).toBe('other'); // the region declared 'other'
    }
    // The invariant read off disk: a reading whose cited snippet's declared
    // authorship is not the person's never carries an avowal.
    for (const r of readingsOnDisk()) {
      for (const cite of r.cites) {
        const [id] = cite.split('@');
        const cited = snippets.find((s) => s.id === id);
        if (cited && cited.provenance.authorship && cited.provenance.authorship !== 'authored') {
          expect(r.stance).not.toBe('avowal');
        }
      }
    }
  });

  it('Repair — every dangler buds, the cap holds only the questions, no surface', () => {
    // Three danglers (the fixture's anaphor openers), cap 2: three Buds, two
    // questions, one deferred and findable in the ledger.
    expect(budsOnDisk()).toHaveLength(3);
    expect(queue.list({ source: 'import-repair' })).toHaveLength(2);
    expect(ledgerLines().filter((l) => !l.questioned)).toHaveLength(1);
    // ticket 137 added the /repair route; import-repair has no surface (Q-6)
    expect(routePaths().some((p) => p.includes('/api/import/repair'))).toBe(false);
  });

  it('Link — one sentence in two files becomes two snippets on two dates', () => {
    const snippets = snippetsOnDisk();
    const kept = snippets.filter((s) => s.prose === SHARED_SENTENCE);
    expect(kept).toHaveLength(2);
    // The two copies sit on the two 2019 sittings — two sessions, two dates.
    const sessions = new Set(kept.map((s) => s.provenance.session));
    expect(sessions.size).toBe(2);
    const started = sittingsOnDisk().map((s) => s.started.slice(0, 10));
    expect(started).toContain('2019-11-02');
    expect(started).toContain('2019-11-03');
  });

  it('Confirm — a sitting imported today is a still-true candidate at once', async () => {
    // The whole point of Task 5: prose written in 2019 but filed today is a
    // still-true candidate immediately, and the real composer now accepts it
    // (the empty-question fix). Drive the docket directly over the same
    // vault with the REAL composers — the server's runDocketNow wraps the
    // same runDocket call.
    const report = await runDocket({
      vault: createVault(root),
      queue: createQueueStore(root),
      complete: confirmComplete(),
      buildIndex,
      composeOpener,
      composeStillTrue,
      listSessions: (r) =>
        readdirSync(join(r, 'transcripts'))
          .map((f) => {
            const data = matter.read(join(r, 'transcripts', f)).data as { started: string };
            return { session: f.slice(0, -3), started: data.started, turnCount: 1, chars: 10 };
          }),
      log: () => {},
      vaultRoot: root,
      stillTrueCursor: { read: () => 0, write: () => {} },
    });
    const stillTrue = report.minted.filter((e) => e.source === 'still-true');
    expect(stillTrue.length).toBeGreaterThan(0);
    // The cited snippet is an IMPORTED one — its session is an import id.
    const cited = stillTrue[0]!.cites?.[0] ?? '';
    const [snippetId] = cited.split('@');
    const snippet = snippetsOnDisk().find((s) => s.id === snippetId);
    expect(snippet).toBeDefined();
    expect(snippet!.provenance.session).toMatch(/^import-/);
  });

  it('Confirm — nothing anywhere holds a weak prior or a fifth status', () => {
    // Q-21/Q-66: no weak prior, no provisional status — asserted by grep
    // over every src/ file.
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        if (!e.name.endsWith('.ts')) continue;
        const text = readFileSync(full, 'utf-8');
        if (/(weakPrior|weak-prior|provisional-status)/.test(text)) hits.push(`${full}: ${text.match(/weakPrior|weak-prior|provisional-status/)?.[0]}`);
      }
    };
    walk(join(import.meta.dirname, '..', 'src'));
    expect(hits).toEqual([]);
  });
});
