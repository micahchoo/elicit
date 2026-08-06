import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { createImportStore, type ImportStore } from '../src/import/store.js';
import { bodyHash, scanFolder } from '../src/import/scan.js';
import { runImportExtraction } from '../src/import/extract.js';
import { commitImport, type CommitDeps, type CommitResult } from '../src/import/commit.js';
import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import type { Complete, Provenance, Vault } from '../src/types.js';
import type { RegionRecord } from '../src/import/contract.js';

/**
 * The committed fixture. These tests NEVER mutate it — every record points at
 * a COPY of the fixture inside the test's temp root, so the stale and
 * second-sitting tests rewrite the copy, never the fixture.
 */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import-folder');

const raw = (name: string): string => readFileSync(join(FIXTURE, name), 'utf-8');
const bodyOf = (name: string): string => matter(raw(name)).content;

const P1 = 'I wrote this essay in September 2018, and I still stand by most of it.';
/** P2 verbatim INCLUDING the image line — the image line is not a paragraph break. */
const P2 =
 'The middle of the argument is where the image sits, and it earns its place\n' +
 '![A diagram of the argument](/img/argument.png)\n' +
 'by showing what a paragraph of prose could not.';
const P3 = 'I keep coming back to this piece when I want to remember why I started.';
const FIRST_SITTING_SENTENCE = P3;
const NEW_SENTENCE = 'I have been rereading it with the years behind me, and the argument holds.';

/** One scripted proposal, shaped exactly as the real model's JSON emits it. */
type ScriptedCut = {
 text: string;
 sourceTurn: number;
 facet: string;
 stance: string;
 reading: string;
 standalone: boolean;
};

const cut = (text: string): ScriptedCut => ({
 text,
 sourceTurn: 0,
 facet: 'value',
 stance: 'commitment',
 reading: 'the person states a position they hold',
 standalone: true,
});

/** One `complete()` response string. `{"cuts":[]}` is an honest empty answer. */
const response = (...cuts: ScriptedCut[]): string => JSON.stringify({ cuts });

/** dated-essay.md's whole prepared body is ONE turn (~64 words, well under
 * the 320-word chunk bound), so one response carries every cut. The second
 * cut is the paragraph that became ADJACENT only after `clean` removed the
 * image line — a valid cut of the prepared turn that is NOT a substring of
 * the source body, so extraction drops it and the record's cuts are
 * [P1, P3, P4]. */
const datedResponses = (): string[] => [
 response(
  cut(P1),
  cut('The middle of the argument is where the image sits, and it earns its place\nby showing what a paragraph of prose could not.'),
  cut(P3),
  cut('The last paragraph ties the first three together, and I have left it here.'),
 ),
];

const otherRegion: RegionRecord = { slug: 'journals-abc123', root: '/c/journals', dating: { kind: 'filename', pattern: 'YYYY-MM-DD' }, authorship: 'other', declared: '2026-08-02T00:00:00.000Z' };

let root: string;
let vault: Vault;
let store: ImportStore;
let logs: { kind: string; detail: string }[];

const readSource = (p: string): string => readFileSync(p, 'utf-8');

function commitDeps(): CommitDeps {
 return {
  vault,
  store,
  readSource,
  log: (e) => {
   logs.push({ kind: e.kind, detail: e.detail });
  },
 };
}

/** Unwrap a successful commit; a refused commit is a test failure with its reason. */
function mustCommit(r: CommitResult): { sessionId: string; snippets: number } {
 if (!r.ok) throw new Error(`commit refused: ${r.reason} — ${r.detail}`);
 return r;
}

/** The transcript frontmatter of one sitting. */
function sitting(sessionId: string) {
 return matter.read(join(root, 'transcripts', `${sessionId}.md`)).data as {
  mode: { minutes: number; energy: string; target?: string };
  protocol: string;
  started: string;
 };
}

/** Every snippet v1 on disk, with its provenance read back from the markdown. */
function snippetsOnDisk(): { id: string; prose: string; provenance: Provenance }[] {
 const dir = join(root, 'snippets');
 if (!existsSync(dir)) return [];
 return readdirSync(dir).map((id) => {
  const parsed = matter.read(join(dir, id, 'v1.md'));
  // matter.stringify appends one trailing newline to the body; trim it back
  // so the prose compares exactly against the source text.
  return { id, prose: parsed.content.trimEnd(), provenance: parsed.data.provenance as Provenance };
 });
}

/** The version numbers a snippet has on disk — [1] means it was never touched. */
function snippetVersions(id: string): number[] {
 return readdirSync(join(root, 'snippets', id))
  .filter((f) => /^v\d+\.md$/.test(f))
  .map((f) => Number(f.match(/^v(\d+)\.md$/)![1]))
  .sort((a, b) => a - b);
}

/** Copy dated-essay.md into the temp root and run extraction over the copy. */
async function preparedDatedEssay(): Promise<{ hash: string; sourcePath: string }> {
 const src = raw('dated-essay.md');
 const body = bodyOf('dated-essay.md');
 const hash = bodyHash(body);
 const sourcePath = join(root, 'sources', 'dated-essay.md');
 mkdirSync(join(root, 'sources'), { recursive: true });
 writeFileSync(sourcePath, src);
 store.admit([
  { hash, sourcePath, date: '2018-09-01', lastmod: '2018-09-01', title: 'A dated essay', body },
 ]);
 await runImportExtraction({
  store,
  complete: makeScriptedComplete(datedResponses()),
  readSource,
  log: (e) => {
   logs.push({ kind: e.kind, detail: e.detail });
  },
 });
 return { hash, sourcePath };
}

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'import-commit-'));
 vault = createVault(root);
 store = createImportStore(root);
 logs = [];
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

describe('import commit — one accepted piece becomes one dated sitting', () => {
 it('writes one dated sitting whose started is the frontmatter date', async () => {
  const { hash } = await preparedDatedEssay();
  const r = mustCommit(commitImport(commitDeps(), hash, [{ cut: 0, action: 'approve' }]));
  const fm = sitting(r.sessionId);
  expect(fm.started).toBe('2018-09-01T00:00:00.000Z');
  expect(fm.protocol).toBe('import');
 });

 it('offers no Target and stores none — Q-60', async () => {
  const { hash } = await preparedDatedEssay();
  const r = mustCommit(commitImport(commitDeps(), hash, [{ cut: 0, action: 'approve' }]));
  expect(Object.keys(sitting(r.sessionId).mode)).toEqual(['minutes', 'energy']);
 });

 it('asserts every snippet against the SOURCE FILE, not the transcript', async () => {
  const { hash, sourcePath } = await preparedDatedEssay();
  const r = mustCommit(
   commitImport(commitDeps(), hash, [
    { cut: 0, action: 'approve' },
    { cut: 1, action: 'approve' },
    { cut: 2, action: 'approve' },
   ]),
  );
  expect(r.snippets).toBe(3);
  const file = readFileSync(sourcePath, 'utf-8');
  for (const s of snippetsOnDisk()) expect(file).toContain(s.prose);
 });

 it('saves a zero-cut piece as a sitting with a transcript and no snippets', async () => {
  // Extraction ran and honestly proposed nothing (`{"cuts":[]}`): the piece
  // still saves — the sitting is dated and its transcript written, and only
  // a record whose `cuts` never landed refuses as not-extracted.
  const src = raw('dated-essay.md');
  const body = bodyOf('dated-essay.md');
  const hash = bodyHash(body);
  const sourcePath = join(root, 'sources', 'dated-essay.md');
  mkdirSync(join(root, 'sources'), { recursive: true });
  writeFileSync(sourcePath, src);
  store.admit([
   { hash, sourcePath, date: '2018-09-01', lastmod: '2018-09-01', title: 'A dated essay', body },
  ]);
  await runImportExtraction({
   store,
   complete: makeScriptedComplete([response()]),
   readSource,
   log: (e) => {
    logs.push({ kind: e.kind, detail: e.detail });
   },
  });
  expect(store.get(hash)!.cuts).toEqual([]);
  const r = mustCommit(commitImport(commitDeps(), hash, []));
  expect(r.snippets).toBe(0);
  expect(sitting(r.sessionId).started).toBe('2018-09-01T00:00:00.000Z');
  expect(snippetsOnDisk()).toEqual([]);
  expect(store.get(hash)!.status).toBe('accepted');
 });

 it('writes the person\'s own addition as a snippet with no reading, behind the same gate', async () => {
  const { hash, sourcePath } = await preparedDatedEssay();
  // P4 is real prose of the source that the scripted extraction kept no cut
  // for; the person keeps it themselves.
  const P4 = 'The last paragraph ties the first three together, and I have left it here.';
  const r = mustCommit(
   commitImport(commitDeps(), hash, [{ cut: 0, action: 'discard' }, { cut: 1, action: 'discard' }, { cut: 2, action: 'discard' }], [P4]),
  );
  expect(r.snippets).toBe(1); // kept = the addition alone
  const onDisk = snippetsOnDisk();
  expect(onDisk).toHaveLength(1);
  expect(onDisk[0]!.prose).toBe(P4);
  expect(readFileSync(sourcePath, 'utf-8')).toContain(P4);
  // No reading was written for it: readings carry the model's labels, and
  // this passage has none.
  expect(existsSync(join(root, 'wiki', 'readings'))).toBe(false);
  // Q-59: a later scan of the same source must not re-propose it.
  expect(store.get(hash)!.kept).toContain(P4);
 });

 it('refuses the whole item when an addition is not in the source body', async () => {
  const { hash } = await preparedDatedEssay();
  const r = commitImport(commitDeps(), hash, [], ['words I never wrote']);
  expect(r).toMatchObject({ ok: false, reason: 'unverifiable' });
  expect(existsSync(join(root, 'transcripts'))).toBe(false); // nothing at all
  expect(existsSync(join(root, 'snippets'))).toBe(false);
 });

 it('refuses the whole item when one kept text is not in the source', async () => {
  const { hash } = await preparedDatedEssay();
  const r = commitImport(commitDeps(), hash, [{ cut: 0, action: 'trim', text: 'words I never wrote' }]);
  expect(r).toMatchObject({ ok: false, reason: 'unverifiable' });
  expect(existsSync(join(root, 'transcripts'))).toBe(false); // nothing at all
  expect(existsSync(join(root, 'snippets'))).toBe(false);
 });

 it('refuses a source that changed since extraction, as stale', async () => {
  const { hash, sourcePath } = await preparedDatedEssay();
  // Rewrite the COPY, never the fixture.
  writeFileSync(sourcePath, readFileSync(sourcePath, 'utf-8') + '\n\nA paragraph added later.\n');
  const r = commitImport(commitDeps(), hash, [{ cut: 0, action: 'approve' }]);
  expect(r).toMatchObject({ ok: false, reason: 'stale' });
  expect(existsSync(join(root, 'transcripts'))).toBe(false);
 });

 it('stamps channel pasted on every imported snippet (048)', async () => {
  const { hash } = await preparedDatedEssay();
  mustCommit(
   commitImport(commitDeps(), hash, [
    { cut: 0, action: 'approve' },
    { cut: 1, action: 'approve' },
    { cut: 2, action: 'approve' },
   ]),
  );
  const onDisk = snippetsOnDisk();
  expect(onDisk.length).toBe(3);
  for (const s of onDisk) expect(s.provenance.channel).toBe('pasted');
 });

 it('stamps the preceding paragraph as context on a cut that opens one (073)', async () => {
  const { hash } = await preparedDatedEssay();
  // Cut 1 is P3-whole, recorded at its offset in the source body — the start
  // of its paragraph, so the preceding paragraph (P2, image line included) is
  // the context.
  mustCommit(commitImport(commitDeps(), hash, [{ cut: 1, action: 'approve' }]));
  const s = snippetsOnDisk().find((x) => x.prose === P3)!;
  expect(s.provenance.context).toBe(P2);
 });

 it('leaves context absent rather than empty when the cut opens the piece', async () => {
  const { hash } = await preparedDatedEssay();
  mustCommit(commitImport(commitDeps(), hash, [{ cut: 0, action: 'approve' }]));
  const s = snippetsOnDisk().find((x) => x.prose === P1)!;
  expect('context' in s.provenance).toBe(false); // absent means absent (048's hazard)
 });

 it('imports a changed file as a second sitting at lastmod, not as a new version', async () => {
  // First import: date 2024-01-01. Then the body changes, lastmod moves.
  const folder = join(root, 'posts');
  mkdirSync(folder, { recursive: true });
  const sourcePath = join(folder, 'edited.md');
  const v1Body = `${P1}\n\n${FIRST_SITTING_SENTENCE}`;
  writeFileSync(sourcePath, `---\ndate: 2024-01-01\nlastmod: 2024-01-01\n---\n${v1Body}\n`);
  const hashV1 = bodyHash(v1Body);

  store.admit(scanFolder(folder).items);
  // One turn, one response.
  await runImportExtraction({
   store,
   complete: makeScriptedComplete([response(cut(P1))]),
   readSource,
   log: (e) => {
    logs.push({ kind: e.kind, detail: e.detail });
   },
  });
  const first = mustCommit(commitImport(commitDeps(), hashV1, [{ cut: 0, action: 'approve' }]));
  const firstSnippetId = snippetsOnDisk()[0]!.id;

  // The body changes on disk; the next scan admits the NEW body as a new
  // item, dated to lastmod by `admit` — commit never branches on it.
  const v2Body = `${v1Body}\n\n${NEW_SENTENCE}`;
  writeFileSync(sourcePath, `---\ndate: 2024-01-01\nlastmod: 2026-05-17\n---\n${v2Body}\n`);
  const hashV2 = bodyHash(v2Body);
  store.admit(scanFolder(folder).items);
  // Only what is new is proposed; the old kept sentence is not re-proposed
  // (and the Q-59 dedupe would drop it if it were — the test asserts the cut
  // list that reaches review holds only the new sentence).
  // One turn, one response: only what is new is proposed.
  await runImportExtraction({
   store,
   complete: makeScriptedComplete([response(cut(NEW_SENTENCE))]),
   readSource,
   log: (e) => {
    logs.push({ kind: e.kind, detail: e.detail });
   },
  });
  const second = mustCommit(commitImport(commitDeps(), hashV2, [{ cut: 0, action: 'approve' }]));

  expect(sitting(first.sessionId).started).toBe('2024-01-01T00:00:00.000Z');
  expect(sitting(second.sessionId).started).toBe('2026-05-17T00:00:00.000Z');
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(snippetVersions(firstSnippetId)).toEqual([1]); // untouched forever
  expect(store.get(hashV2)!.cuts!.map((c) => c.text)).not.toContain(store.get(hashV1)!.kept![0]);
  expect(store.get(hashV2)!.kept).toEqual([NEW_SENTENCE]);
 });

 it('stamps the region authorship on every snippet of the sitting', async () => {
  const { hash } = await preparedDatedEssay();
  mustCommit(commitImport({ ...commitDeps(), regionFor: () => otherRegion }, hash, [{ cut: 0, action: 'approve' }]));
  for (const s of snippetsOnDisk()) expect(s.provenance.authorship).toBe('other');
 });

 it('writes no authorship key at all for an item with no region', async () => {
  const { hash } = await preparedDatedEssay();
  mustCommit(commitImport(commitDeps(), hash, [{ cut: 0, action: 'approve' }]));
  for (const s of snippetsOnDisk()) expect('authorship' in s.provenance).toBe(false);
 });

 it('no snippet from a non-authored region carries stance avowal — read off disk', async () => {
  // A one-response complete whose kept cut is P1 with stance 'avowal' (P1 is
  // a verbatim substring of dated-essay.md's body). The region is declared
  // 'other', so extraction coerces the stance (Task 7) and commit stamps the
  // authorship (Task 9); the markdown on disk is the truth (Q-3).
  const src = raw('dated-essay.md');
  const body = bodyOf('dated-essay.md');
  const hash = bodyHash(body);
  const sourcePath = join(root, 'sources', 'dated-essay.md');
  mkdirSync(join(root, 'sources'), { recursive: true });
  writeFileSync(sourcePath, src);
  store.admit([
   { hash, sourcePath, date: '2018-09-01', lastmod: '2018-09-01', title: 'A dated essay', body },
  ]);
  await runImportExtraction({
   store,
   complete: makeScriptedComplete([response({ ...cut(P1), stance: 'avowal' })]),
   readSource,
   regionFor: () => otherRegion,
   log: (e) => {
    logs.push({ kind: e.kind, detail: e.detail });
   },
  });
  mustCommit(
   commitImport({ ...commitDeps(), regionFor: () => otherRegion }, hash, [{ cut: 0, action: 'approve' }]),
  );

  // The readings and snippets on disk — the markdown is the truth.
  const readings = readdirSync(join(root, 'wiki', 'readings')).map((f) =>
   matter.read(join(root, 'wiki', 'readings', f)).data,
  ) as { facet: string; stance: string; reading: string; cites: string[] }[];
  expect(readings.length).toBeGreaterThan(0);
  const provenanceById = new Map(snippetsOnDisk().map((s) => [s.id, s.provenance]));
  for (const reading of readings) {
   const cited = provenanceById.get(reading.cites[0]!.split('@')[0]!);
   if (cited?.authorship !== undefined && cited.authorship !== 'authored') {
    expect(reading.stance).not.toBe('avowal');
   }
  }
 });
});
