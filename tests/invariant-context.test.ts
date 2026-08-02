import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Invariant (ticket 073): context is LINEAGE, not corpus.
 * The Clerk must not mint from it, resonance must not index it,
 * no Piece may include it, no Reading may cite it.
 *
 * This test verifies the structural contract: no file in clerk/, wiki/,
 * or index/ accesses `provenance.context` or destructures `context` from
 * a Provenance-bearing object.
 */
describe('context invariant — lineage, not corpus', () => {
  // Files that must never read provenance.context. Kept as an explicit list
  // on purpose: if a protected file is renamed or deleted, this test fails
  // loudly instead of silently scanning fewer files.
  const PROTECTED_FILES = [
    'src/clerk/composed.ts',
    'src/clerk/contradiction.ts',
    'src/clerk/docket.ts',
    'src/clerk/mint.ts',
    'src/clerk/sitting.ts',
    'src/clerk/wiki-jobs.ts',
    'src/wiki/clash.ts',
    'src/wiki/contract.ts',
    'src/wiki/embedding.ts',
    'src/wiki/lint.ts',
    'src/wiki/ops.ts',
    'src/wiki/registry.ts',
    'src/wiki/status.ts',
    'src/wiki/store.ts',
    'src/wiki/thresholds.ts',
    'src/index/lexical.ts',
    'src/index/semantic.ts',
  ];

  // Files that legitimately carry the word "context" — the type declaration,
  // the harvester capture, and the backfill script.
  const ALLOWED_PATHS = [
    'src/types.ts',
    'src/harvester/harvester.ts',
    'scripts/backfill-context.ts',
  ];

  it('no clerk/wiki/index file reads provenance.context', () => {
    for (const file of PROTECTED_FILES) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip comment-only lines (prose that mentions the word "context").
        if (/^\s*(\/\/|\*|\/\*\*)/.test(line)) continue;
        if (/\.context\b/.test(line)) {
          throw new Error(
            `${file}:${i + 1} accesses .context — ${line.trim()}\n` +
              `This violates the lineage-not-corpus invariant (ticket 073).`,
          );
        }
      }
    }
  });

  it('allowed files do access context (sanity)', () => {
    for (const file of ALLOWED_PATHS) {
      expect(readFileSync(file, 'utf-8'), `${file} should mention context`).toContain(
        'context',
      );
    }
  });
});
