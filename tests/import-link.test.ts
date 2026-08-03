import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { createVault } from '../src/vault/vault.js';
import type { Vault } from '../src/types.js';
import { createImportStore, type ImportStore } from '../src/import/store.js';
import { runImportExtraction } from '../src/import/extract.js';
import { commitImport, type CommitDeps } from '../src/import/commit.js';
import { bodyHash, scanFolder } from '../src/import/scan.js';
import { makeScriptedComplete } from './fakes.js';
import { SHARED_SENTENCE } from './fixtures/seeding-vault/manifest.js';

/**
 * Q-71: a retelling is no new object — and the boundary is the SOURCE PATH.
 * The same sentence in two files is precisely the retelling to keep twice;
 * dedupe across paths would delete the highest-value pattern the system
 * exists to find. The rule already lives in extract.ts's `keptElsewhere`
 * set (it only ever reads records with the SAME sourcePath), so this suite
 * is characterization: it pins the boundary so a later agent cannot build
 * a link store because "nothing on disk says the rule was decided".
 *
 * The fixture (seeding Task 3) holds SHARED_SENTENCE verbatim in two files
 * under two dates: journal/2019/2019-11-02.md and journal/2019/2019-11-03.md.
 */

const FIXTURE = join(import.meta.dirname, 'fixtures', 'seeding-vault', 'journal', '2019');
const FIXTURE_RULE = { kind: 'filename' as const, pattern: 'YYYY-MM-DD' };

/** One scripted cut, shaped exactly as the real model's JSON emits it. */
const sharedSentenceResponse = (): string =>
  JSON.stringify({
    cuts: [
      {
        text: SHARED_SENTENCE,
        sourceTurn: 0,
        facet: 'value',
        stance: 'commitment',
        reading: 'the person keeps this sentence',
        standalone: true,
      },
    ],
  });

const readSource = (p: string): string => readFileSync(p, 'utf-8');

let root: string;
let vault: Vault;
let store: ImportStore;
let logs: { kind: string; detail: string }[];

const commitDeps = (): CommitDeps => ({
  vault,
  store,
  readSource,
  log: (e) => {
    logs.push({ kind: e.kind, detail: e.detail });
  },
});

/** One sitting's transcript frontmatter. */
function sitting(sessionId: string): { started: string } {
  return matter.read(join(root, 'transcripts', `${sessionId}.md`)).data as { started: string };
}

/** The two fixture files admitted and extracted, oldest date first. */
async function prepareBoth(): Promise<{ hashA: string; hashB: string }> {
  const scanned = scanFolder(FIXTURE, FIXTURE_RULE);
  expect(scanned.items).toHaveLength(2);
  const [a, b] = [...scanned.items].sort((x, y) => x.date.localeCompare(y.date));
  store.admit([a!, b!], 'journals-2019');
  return { hashA: a!.hash, hashB: b!.hash };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'import-link-'));
  vault = createVault(root);
  store = createImportStore(root);
  logs = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Link — the dedupe boundary is the source path (Q-71)', () => {
  it('keeps the same sentence twice when it lives in two files', async () => {
    const { hashA, hashB } = await prepareBoth();
    // Budget 1: only the oldest (2019-11-02) is extracted first.
    await runImportExtraction({
      store,
      complete: makeScriptedComplete([sharedSentenceResponse()]),
      readSource,
      log: (e) => logs.push(e),
      budget: 1,
    });
    const first = commitImport(commitDeps(), hashA, [{ cut: 0, action: 'approve' }]);
    expect(first.ok).toBe(true);
    // Now the second file extracts. Its sourcePath differs, so the sentence
    // the first sitting kept must NOT be deduped away.
    await runImportExtraction({
      store,
      complete: makeScriptedComplete([sharedSentenceResponse()]),
      readSource,
      log: (e) => logs.push(e),
    });
    expect(store.get(hashB)!.cuts!.map((c) => c.text)).toContain(SHARED_SENTENCE);
  });

  it('does not re-propose a sentence already kept from the SAME file', async () => {
    // Q-59's second sitting: same sourcePath, changed body. The kept sentence
    // of the first sitting is not re-proposed — dedupe reads `kept` within
    // ONE sourcePath only.
    const P = join(root, 'edited.md');
    const KEPT_V1 = 'I wrote this essay in September 2018, and I still stand by most of it.';
    const NEW_SENTENCE = 'I have been rereading it with the years behind me, and the argument holds.';
    const v1Body = `${KEPT_V1}\n\nA second paragraph of the first sitting.`;
    writeFileSync(P, `---\ndate: 2021-01-15\nlastmod: 2021-01-15\n---\n${v1Body}\n`);
    const hashV1 = bodyHash(v1Body);
    store.admit(scanFolder(join(root)).items);
    await runImportExtraction({
      store,
      complete: makeScriptedComplete([
        JSON.stringify({
          cuts: [
            { text: KEPT_V1, sourceTurn: 0, facet: 'value', stance: 'commitment', reading: 'r', standalone: true },
          ],
        }),
      ]),
      readSource,
      log: (e) => logs.push(e),
    });
    const first = commitImport(commitDeps(), hashV1, [{ cut: 0, action: 'approve' }]);
    expect(first.ok).toBe(true);

    const v2Body = `${v1Body}\n\n${NEW_SENTENCE}`;
    writeFileSync(P, `---\ndate: 2021-01-15\nlastmod: 2026-05-17\n---\n${v2Body}\n`);
    const hashV2 = bodyHash(v2Body);
    store.admit(scanFolder(join(root)).items);
    await runImportExtraction({
      store,
      complete: makeScriptedComplete([
        JSON.stringify({
          cuts: [
            { text: KEPT_V1, sourceTurn: 0, facet: 'value', stance: 'commitment', reading: 'r', standalone: true },
            { text: NEW_SENTENCE, sourceTurn: 0, facet: 'value', stance: 'commitment', reading: 'r', standalone: true },
          ],
        }),
      ]),
      readSource,
      log: (e) => logs.push(e),
    });
    const texts = store.get(hashV2)!.cuts!.map((c) => c.text);
    expect(texts).not.toContain(KEPT_V1);
    expect(texts).toContain(NEW_SENTENCE);
  });

  it('the two kept copies are two sittings on two dates', async () => {
    const { hashA, hashB } = await prepareBoth();
    await runImportExtraction({
      store,
      complete: makeScriptedComplete([sharedSentenceResponse(), sharedSentenceResponse()]),
      readSource,
      log: (e) => logs.push(e),
    });
    const a = commitImport(commitDeps(), hashA, [{ cut: 0, action: 'approve' }]);
    const b = commitImport(commitDeps(), hashB, [{ cut: 0, action: 'approve' }]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(sitting(a.sessionId).started).not.toBe(sitting(b.sessionId).started);
    }
  });

  it('there is no link store', () => {
    expect(existsSync(join(root, 'links'))).toBe(false);
    expect(readdirSync(join(import.meta.dirname, '..', 'src', 'import'))).not.toContain('link.ts');
  });
});
