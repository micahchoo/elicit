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
 *
 * Ticket 091 opened one sanctioned read: mint.ts carries a snippet's
 * provenance.question and provenance.context into the mint payload,
 * typed-marked inside <question>/<context> blocks, so the model sees the
 * referent the prose points at. The boundary is unchanged — lineage is
 * context for interpretation, never citable material — so mint.ts leaves
 * the protected list and gains a marker-bound check below.
 */
describe('context invariant — lineage, not corpus', () => {
  // Files that must never read provenance.context. Kept as an explicit list
  // on purpose: if a protected file is renamed or deleted, this test fails
  // loudly instead of silently scanning fewer files.
  // mint.ts was here until ticket 091 — see the marker-bound check below.
  const PROTECTED_FILES = [
    'src/clerk/composed.ts',
    'src/clerk/contradiction.ts',
    'src/clerk/docket.ts',
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
  // the harvester capture, mint.ts's payload composition (ticket 091), and
  // the backfill script.
  const ALLOWED_PATHS = [
    'src/types.ts',
    'src/harvester/harvester.ts',
    'src/clerk/annotate.ts',
    'src/clerk/mint.ts',
    'scripts/backfill-context.ts',
  ];

  it('mint.ts reads provenance lineage only on the typed-marker lines', () => {
    // Ticket 091: mint.ts carries question and context into the payload as
    // <question>/<context> blocks. That is the whole extent of the read — a
    // `provenance.question` or `provenance.context` access anywhere else in
    // the file (an op shape, a log line, a cite) would be minting from
    // lineage and must fail here.
    const content = readFileSync('src/clerk/mint.ts', 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip comment-only lines (prose that mentions the word "context").
      if (/^\s*(\/\/|\*|\/\*\*)/.test(line)) continue;
      if (/\.question\b/.test(line) && !line.includes('<question>')) {
        throw new Error(
          `src/clerk/mint.ts:${i + 1} reads .question outside the typed-marker line — ${line.trim()}\n` +
            'Lineage must reach the payload only as a <question> block (ticket 091).',
        );
      }
      if (/\.context\b/.test(line) && !line.includes('<context>')) {
        throw new Error(
          `src/clerk/mint.ts:${i + 1} reads .context outside the typed-marker line — ${line.trim()}\n` +
            'Lineage must reach the payload only as a <context> block (ticket 091).',
        );
      }
    }
  });

  it('annotate.ts reads provenance lineage only on the typed-marker lines', () => {
    // Ticket 074: annotate.ts carries question and context into the
    // annotation payload as <question>/<context> blocks, exactly as mint.ts
    // does for the mint payload (ticket 091). That is the whole extent of
    // the read — a provenance.question or provenance.context access
    // anywhere else in the file would resolve a referent from lineage
    // outside the marker contract and must fail here.
    const content = readFileSync('src/clerk/annotate.ts', 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip comment-only lines (prose that mentions the word "context").
      if (/^\s*(\/\/|\*|\/\*\*)/.test(line)) continue;
      if (/\.question\b/.test(line) && !line.includes('<question>')) {
        throw new Error(
          `src/clerk/annotate.ts:${i + 1} reads .question outside the typed-marker line — ${line.trim()}\n` +
            'Lineage must reach the payload only as a <question> block (ticket 074).',
        );
      }
      if (/\.context\b/.test(line) && !line.includes('<context>')) {
        throw new Error(
          `src/clerk/annotate.ts:${i + 1} reads .context outside the typed-marker line — ${line.trim()}\n` +
            'Lineage must reach the payload only as a <context> block (ticket 074).',
        );
      }
    }
  });

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
