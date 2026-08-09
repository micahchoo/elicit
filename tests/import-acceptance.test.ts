/**
 * T12 of the bulk-import plan (docs/superpowers/plans/2026-08-02-bulk-import-review.md):
 * the ticket's five acceptance criteria, each as executable assertions against the
 * real flow — scan → extract (scripted model) → commit — on the committed fixture
 * folder, plus the four structural claims the document rule reduces to on the
 * review surface, and the env-gated real-corpus check (skips, with a printed
 * reason, unless ELICIT_IMPORT_CORPUS is set).
 *
 * The fixture is NEVER mutated: the flow runs into a temp dir, and the surface
 * is built through the shared DOM shim (tests/fixtures/import-surface.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { scanFolder } from '../src/import/scan.js';
import { createImportStore, type ImportStore } from '../src/import/store.js';
import { runImportExtraction, type ExtractionDeps, type ExtractionResult } from '../src/import/extract.js';
import { commitImport, type CommitDeps } from '../src/import/commit.js';
import { adoptPriorIngest } from '../src/import/adopt.js';
import { createVault } from '../src/vault/vault.js';
import type { ImportDecision } from '../src/import/contract.js';
import type { Complete } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';
import {
  buildReviewSurface,
  focusCut,
  paragraphsOf,
  visibleVerbs,
} from './fixtures/import-surface.js';
import type { ImportReviewItem } from '../web/import-review.js';

/** The committed fixture. These tests NEVER mutate it. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import-folder');
/** The repo vault holds the 19 real `post-*` transcripts (the one-off's run). */
const REPO_VAULT = join(import.meta.dirname, '..', 'vault');

const bodyOf = (name: string): string => matter(readFileSync(join(FIXTURE, name), 'utf-8')).content;
/** The source split the review surface renders by: paragraphs, in order. */
const paragraphsOfBody = (s: string): string[] => s.split(/\n\n+/).filter((p) => p.length > 0);

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

/** One `complete()` response string. */
const response = (...cuts: ScriptedCut[]): string => JSON.stringify({ cuts });

/**
 * One scripted response per piece: each fixture piece prepares to exactly ONE
 * user turn (each body is well under the 320-word turn cap), so extraction
 * consumes exactly one response per piece, oldest first by date.
 *
 * dated-essay: P1, the image-adjacent sentence, P3 and P4 — every cut an exact
 * substring of BOTH the prepared turn and the source body (the full image
 * paragraph is not: `clean` removes the image line, so it is not in the turn).
 * quoted.md: P1 and the closing paragraph — neither sits inside the blockquote.
 * co-authored.md: P1.
 */
const scriptedResponses = (): string[] => {
  const dated = paragraphsOfBody(bodyOf('dated-essay.md'));
  const quoted = paragraphsOfBody(bodyOf('quoted.md'));
  const coauthored = paragraphsOfBody(bodyOf('co-authored.md'));
  return [
    response(
      cut(dated[0]!.trim()),
      cut('The middle of the argument is where the image sits, and it earns its place'),
      cut(dated[2]!.trim()),
      cut(dated[3]!.trim()),
    ),
    response(cut(quoted[0]!.trim()), cut(quoted[4]!.trim())),
    response(cut(coauthored[0]!.trim())),
  ];
};

let root: string;
let store: ImportStore;
const log = (): void => {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'import-acceptance-'));
  store = createImportStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const readSource = (p: string): string => readFileSync(p, 'utf-8');

/** Scan the folder into the staging store. Nothing is written anywhere else. */
function scan(folder: string) {
  return store.admit(scanFolder(folder).items);
}

/** Extract cuts for every pending record, with the scripted complete. */
async function extractAll(): Promise<ExtractionResult> {
  const deps: ExtractionDeps = {
    store,
    complete: makeScriptedComplete(scriptedResponses()),
    readSource,
    log,
  };
  return runImportExtraction(deps);
}

/** Commit every extracted record, approving every cut. Returns the count. */
function commitAll(): number {
  const deps: CommitDeps = { vault: createVault(root), store, readSource, log };
  let count = 0;
  for (let record = store.nextExtracted(); record !== null; record = store.nextExtracted()) {
    const decisions: ImportDecision[] = (record.cuts ?? []).map((_, ci) => ({
      cut: ci,
      action: 'approve',
    }));
    const res = commitImport(deps, record.hash, decisions);
    if (!res.ok) {
      throw new Error(`commit refused for ${record.hash}: ${res.reason} — ${res.detail}`);
    }
    count++;
  }
  return count;
}

/** The dated sittings on disk: every transcript's frontmatter. */
function sittings(vaultRoot: string): { started: string; session: string; protocol: string }[] {
  const dir = join(vaultRoot, 'transcripts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const data = matter(readFileSync(join(dir, f), 'utf-8')).data as {
        started?: unknown;
        session?: unknown;
        protocol?: unknown;
      };
      return {
        started: data.started instanceof Date ? data.started.toISOString() : String(data.started ?? ''),
        session: String(data.session ?? ''),
        protocol: String(data.protocol ?? ''),
      };
    });
}

/** Every snippet's newest version on disk, mirroring rebuildIndex's read. */
function snippetsOnDisk(vaultRoot: string): { provenance: { session: string }; prose: string }[] {
  const dir = join(vaultRoot, 'snippets');
  if (!existsSync(dir)) return [];
  const out: { provenance: { session: string }; prose: string }[] = [];
  for (const id of readdirSync(dir)) {
    const idDir = join(dir, id);
    const versions = readdirSync(idDir)
      .filter((f) => /^v\d+\.md$/.test(f))
      .sort((a, b) => {
        const va = Number(a.match(/^v(\d+)\.md$/)![1]);
        const vb = Number(b.match(/^v(\d+)\.md$/)![1]);
        return vb - va; // newest first
      });
    const newest = versions[0];
    if (!newest) continue;
    const parsed = matter(readFileSync(join(idDir, newest), 'utf-8'));
    const data = parsed.data as { provenance: { session: string } };
    out.push({ provenance: data.provenance, prose: parsed.content.trimEnd() });
  }
  return out;
}

describe('bulk import acceptance (the five criteria, against the fixture)', () => {
  it('an archive imports as dated sittings whose started values span the real range', async () => {
    scan(FIXTURE);
    const extracted = await extractAll();
    expect(extracted.failed).toBe(0);
    expect(commitAll()).toBe(3); // dated-essay, quoted, co-authored

    const started = sittings(root).map((s) => s.started).sort();
    expect(started[0]).toBe('2018-09-01T00:00:00.000Z');
    expect(started.at(-1)).toBe('2022-01-01T00:00:00.000Z');
    expect(new Set(started).size).toBe(started.length); // no two pieces share a date by accident
  });

  it('every snippet is an exact substring of its SOURCE file', async () => {
    scan(FIXTURE);
    await extractAll();
    commitAll();

    const sourceBySession = new Map(
      store.list('accepted').map((r) => [r.sessionId!, r.sourcePath]),
    );
    const snippets = snippetsOnDisk(root);
    expect(snippets.length).toBeGreaterThan(0);
    for (const s of snippets) {
      const source = sourceBySession.get(s.provenance.session);
      expect(source, `no accepted record for session ${s.provenance.session}`).toBeDefined();
      const rawFile = readFileSync(source!, 'utf-8');
      expect(rawFile).toContain(s.prose);
    }
  });

  it('nothing is written before a review is accepted', async () => {
    scan(FIXTURE);
    await extractAll();
    expect(existsSync(join(root, 'transcripts'))).toBe(false);
    expect(existsSync(join(root, 'snippets'))).toBe(false);
  });

  it('re-running imports nothing twice', async () => {
    scan(FIXTURE);
    await extractAll();
    const first = commitAll();

    const second = scan(FIXTURE);
    expect(second.added).toHaveLength(0);
    expect(store.list('pending')).toHaveLength(0); // nothing queues
    expect(sittings(root)).toHaveLength(first);
  });
});

/**
 * The fifth criterion — "obeys the document rule, or the ticket records why it
 * cannot and what replaced it" — is a design property, so it is asserted as the
 * four structural claims the rule reduces to on THIS surface. Each is a thing
 * the rule forbids or requires, and each is visible in the rendered DOM.
 */
describe('the review surface obeys the document rule', () => {
  // A dated-essay-shaped item with REAL offsets: the committed fixture's body,
  // three cuts that are exact substrings of it, and the image line marked
  // not-prose the way the extract route's marks would be.
  const source = bodyOf('dated-essay.md');
  const paras = paragraphsOfBody(source);
  const imageLine = '![A diagram of the argument](/img/argument.png)';
  const item: ImportReviewItem = {
    hash: 'd4e6f0f1a2b3c4d5e6f7a8b9',
    file: 'dated-essay.md',
    title: 'A dated essay',
    date: '2018-09-01',
    source,
    cuts: [
      {
        text: paras[0]!.trim(),
        at: source.indexOf(paras[0]!.trim()),
        facet: 'value',
        stance: 'commitment',
        reading: 'the person states a position they hold',
      },
      {
        text: 'The middle of the argument is where the image sits, and it earns its place',
        at: source.indexOf('The middle of the argument is where the image sits, and it earns its place'),
        facet: 'value',
        stance: 'commitment',
        reading: 'the person states a position they hold',
      },
      {
        text: paras[2]!.trim(),
        at: source.indexOf(paras[2]!.trim()),
        facet: 'value',
        stance: 'commitment',
        reading: 'the person states a position they hold',
      },
    ],
    marks: [{ at: source.indexOf(imageLine), length: imageLine.length, why: 'not-prose' }],
  };

  it('is a page of text: the whole piece is present, unreflowed and in order', async () => {
    const { surface } = await buildReviewSurface(item);
    expect(paragraphsOf(surface)).toEqual(paras); // same content, same order
  });

  it('has no list furniture — no table, no checkbox, no per-row button set', async () => {
    const { surface } = await buildReviewSurface(item);
    for (const sel of ['input[type=checkbox]', 'table', 'ul.proposal-list', '.proposal-block']) {
      expect(surface.querySelector(sel)).toBeNull();
    }
  });

  it('carries controls only at the point of attention: none visible until a cut has focus', async () => {
    const { surface } = await buildReviewSurface(item);
    expect(visibleVerbs(surface)).toEqual([]);
    focusCut(surface, 0);
    expect(visibleVerbs(surface)).toEqual(['keep', 'trim', 'leave out']);
  });

  it('offers nothing that COMMITS without reading, and no Target', async () => {
    // Ruled 2026-08-04 (Micah), amending the original "no accept-all": the
    // foot may carry `select all — keep/leave out`, but it only PRESELECTS —
    // nothing reaches the server until `save this piece` is pressed.
    const { surface, sent } = await buildReviewSurface(item);
    const allKeep = surface
      .querySelectorAll('.import-decide-all-btn')
      .find((b) => b.textContent.includes('keep'))!;
    allKeep.click();
    expect(sent).toHaveLength(0); // preselection commits nothing
    expect(surface.querySelector('[name=target], .target-control')).toBeNull();
  });
});

/**
 * The real-corpus check — 47 files on one machine. Adoption reads only the
 * repo vault's transcripts (copied into the temp store root, never written
 * back) and the corpus folder; the store itself is a temp dir. It skips, with
 * a printed reason, when ELICIT_IMPORT_CORPUS is unset.
 */
const CORPUS = process.env.ELICIT_IMPORT_CORPUS;
if (!CORPUS) {
  console.log(
    'ELICIT_IMPORT_CORPUS is unset — the real-corpus acceptance test is skipped (the 47-post corpus lives on one machine).',
  );
}
describe.skipIf(!CORPUS)('the real corpus', () => {
  it('adopts the prior ingest so the whole corpus is known and nothing queues', () => {
    // The store's vault root is a tmp dir; copy the repo vault's transcripts
    // so adoption sees the 19 sittings without writing into the real vault.
    cpSync(join(REPO_VAULT, 'transcripts'), join(root, 'transcripts'), { recursive: true });

    const adopted = adoptPriorIngest({ store, vaultRoot: root, folder: CORPUS!, log });
    const scanned = scanFolder(CORPUS!);
    const admitted = store.admit(scanned.items);

    // 19 accepted + 28 excluded = all 47 files known; nothing queues.
    expect(adopted.accepted + adopted.excluded).toBe(scanned.items.length);
    expect(admitted.added).toHaveLength(0);
    expect(store.list('pending')).toHaveLength(0);
  });
});
