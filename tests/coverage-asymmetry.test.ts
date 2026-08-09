/**
 * The coverage write-side asymmetry, pinned (Wave D F2/F12).
 *
 * `writeReading` (src/ktg/coverage.ts) has NO production caller, so in a
 * real run the coverage store is always empty and every node reads back
 * 'unprobed' (the sweep-core fallback). That one always-empty store feeds
 * TWO gap-fill jobs in the same docket run:
 *
 *   1. the territory sweep — `territoryCandidates` in src/ktg/gap-fill.ts
 *      gates every one of its three passes on at least one 'evidenced'
 *      node (pass 1 reads an evidenced node's prereqs, pass 2 requires an
 *      evidenced successor, pass 3 probes evidenced nodes), so an
 *      all-'unprobed' store leaves the job INERT: it yields nothing;
 *   2. the atlas sweep — src/ktg/atlas-gap-fill.ts mints on 'unprobed'
 *      directly, so the SAME empty store mints questions.
 *
 * One run therefore executes one inert job and one minting job off the
 * same always-empty store. This test pins that state honestly: the
 * production-caller count for `writeReading` is zero. A future wave that
 * wires a writer must flip this test deliberately — and update the
 * registry reason on `createCoverageStore` (src/registry.ts) in the same
 * change, since both pin the same fact.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
/** The module that declares `writeReading` (interface + impl) — not a caller. */
const DECLARING_MODULE = 'src/ktg/coverage.ts';
/** The registry's reason prose names the method — data, not a call site. */
const REGISTRY_MODULE = 'src/registry.ts';

/** Every `.ts` file under src/, repo-relative, sorted. */
function srcFiles(): string[] {
 const out: string[] = [];
 const walk = (dir: string): void => {
  for (const entry of readdirSync(dir).sort()) {
   const abs = join(dir, entry);
   if (statSync(abs).isDirectory()) walk(abs);
   else if (entry.endsWith('.ts')) out.push(abs.slice(ROOT.length + 1));
  }
 };
 walk(join(ROOT, 'src'));
 return out.sort();
}

describe('coverage write-side asymmetry', () => {
 it('writeReading has no shipping caller — territory inert, atlas mints on unprobed', () => {
  const references: string[] = [];
  for (const file of srcFiles()) {
   if (file === DECLARING_MODULE || file === REGISTRY_MODULE) continue;
   const lines = readFileSync(join(ROOT, file), 'utf-8').split('\n');
   lines.forEach((line, i) => {
    if (line.includes('writeReading')) references.push(`${file}:${i + 1}`);
   });
  }
  expect(references, 'production references to writeReading').toEqual([]);
 });
});
