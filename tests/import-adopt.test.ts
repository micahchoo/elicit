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

