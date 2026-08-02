import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { adoptPriorIngest } from '../src/import/adopt.js';
import { createImportStore } from '../src/import/store.js';
import { bodyHash, scanFolder } from '../src/import/scan.js';

/** The committed fixture. These tests NEVER mutate it. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import-folder');
/** The repo vault holds the 19 real `post-*` transcripts (the one-off's run). */
const REPO_VAULT = join(import.meta.dirname, '..', 'vault');

let root: string;
let store: ReturnType<typeof createImportStore>;
const log = () => {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'import-adopt-'));
  store = createImportStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A `protocol: import` transcript, the shape the one-off script wrote. */
function seedTranscript(vaultRoot: string, name: string, started: string): void {
  const dir = join(vaultRoot, 'transcripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.md`),
    matter.stringify('', { session: name, protocol: 'import', started }),
    'utf-8',
  );
}

/** The hash the scanner (and therefore `admit`) will compute for a fixture file. */
function hashOf(file: string): string {
  return bodyHash(matter(readFileSync(file, 'utf-8')).content);
}

describe('adoptPriorIngest (the one-off run becomes staging records)', () => {
  it('adopts an already-imported post so a re-scan skips it', () => {
    seedTranscript(root, 'post-dated-essay', '2018-09-01T00:00:00.000Z');
    adoptPriorIngest({ store, vaultRoot: root, folder: FIXTURE, log });
    const datedEssayHash = hashOf(join(FIXTURE, 'dated-essay.md'));
    // Resolution must find `tests/fixtures/import-folder/dated-essay.md` via
    // the flat layout; its hash is then known and a re-scan adds nothing.
    expect(store.admit(scanFolder(FIXTURE).items).added).not.toContain(datedEssayHash);
    expect(store.get(datedEssayHash)!.sessionId).toBe('post-dated-essay');
    expect(store.get(datedEssayHash)!.date).toBe('2018-09-01');
  });

  it('is idempotent', () => {
    seedTranscript(root, 'post-dated-essay', '2018-09-01T00:00:00.000Z');
    const adopt = () => adoptPriorIngest({ store, vaultRoot: root, folder: FIXTURE, log });
    adopt();
    const after = store.list('accepted').length;
    adopt();
    expect(store.list('accepted')).toHaveLength(after);
  });

  it('reports a name it cannot resolve instead of dropping it', () => {
    // A two-file fixture folder plus a one-entry EXCLUDED naming a third —
    // a resolver that loses a name silently is the failure this step exists
    // to prevent.
    const folder = mkdtempSync(join(tmpdir(), 'import-adopt-missing-'));
    try {
      for (const f of ['dated-essay.md', 'quoted.md']) {
        cpSync(join(FIXTURE, f), join(folder, f));
      }
      const r = adoptPriorIngest({
        store,
        vaultRoot: root,
        folder,
        log,
        excluded: [
          { slug: 'jingle-tales', why: 'Index and deliverable pages. No pronoun, no claim, no method.' },
        ],
      });
      expect(r.unresolved).toEqual(['jingle-tales']);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

/**
 * The count tests — 19 accepted, 28 excluded, 0 unresolved — exist only on
 * the real corpus, so they live behind `ELICIT_IMPORT_CORPUS` (the path to
 * the corpus folder). Nothing in the fixture asserts a corpus number.
 */
const CORPUS = process.env.ELICIT_IMPORT_CORPUS;
describe.skipIf(!CORPUS)('real corpus', () => {
  beforeEach(() => {
    // The store's vault root is a tmp dir; copy the repo vault's transcripts
    // so adoption sees the 19 sittings without writing into the real vault.
    cpSync(join(REPO_VAULT, 'transcripts'), join(root, 'transcripts'), { recursive: true });
  });

  it('adopts the excluded groups with their reasons', () => {
    const r = adoptPriorIngest({ store, vaultRoot: root, folder: CORPUS!, log });
    expect(r.accepted).toBe(19);
    expect(r.excluded).toBe(28);
    expect(r.unresolved).toEqual([]);
    const imposterHash = hashOf(join(CORPUS!, 'the-imposter-among-us', 'index.md'));
    expect(store.get(imposterHash)!.excludeReason).toContain('Q-51');
  });

  it('does not exclude the one external that was kept', () => {
    adoptPriorIngest({ store, vaultRoot: root, folder: CORPUS!, log });
    const wikipediaEditathonHash = hashOf(
      join(CORPUS!, 'external', 'wikipedia-editathon-dalit-history-month', 'index.md'),
    );
    expect(store.get(wikipediaEditathonHash)!.status).toBe('accepted');
  });
});
