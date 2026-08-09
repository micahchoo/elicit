/**
 * The real harvest path, run before anyone sits down (Q-58): take each pending
 * record, re-read its source file, prepare the prose exactly as the dry run
 * did, and ask the harvester for cuts — then drop, in order, what cannot be
 * carried to review. The ~40s-per-chunk cost is paid up front, so review is
 * instant and resumable, and this is where Q-51's cut-level rule reads the raw
 * source file rather than the prose the importer prepared.
 *
 * Flow position: step 5 of 13 (store → extract → store → review). Upstream:
 * `ImportRecord` with `status: 'pending'`. Downstream: the same record with
 * `status: 'extracted'` and `cuts`, each cut's `at` an offset into the SOURCE
 * BODY.
 *
 * The three drops, in this order (the order matters in one place only — the
 * Q-59 dedupe runs LAST, so a cut that is both a duplicate and inadmissible is
 * dropped under the reason that keeps it out on its own merits):
 *
 *   (a) A cut that is not an exact substring of the SOURCE BODY is dropped
 *       here with a reason, never carried to review. `clean` deletes lines
 *       from inside a paragraph (a blockquote, an image, a link), so the
 *       surviving lines can become adjacent when they were not — the prepared
 *       turn can hold a run the file does not.
 *   (b) Q-51 read against the RAW SOURCE FILE, not the turn:
 *       `isQuotedFromSource(cut.text, quotedSpans(rawFile))` — the same
 *       predicate `propose()` applies turn-scoped, applied again against the
 *       wider source. `quotedSpans` discards any span containing a blank line,
 *       so the only route by which the raw file sees more is `clean` removing
 *       the opening mark from INSIDE a paragraph while the raw file still
 *       holds the whole span.
 *   (c) Q-59 dedupe: for a record whose source path already has an `accepted`
 *       record, drop any cut whose exact text appears in that record's `kept`.
 *       The edited post then offers only what is new. It runs HERE, before
 *       review, never after it, so a reviewer can never approve a cut that
 *       silently vanishes at commit (T7's all-or-nothing rule).
 *
 * One item at a time, sequentially: the local model is a single GPU. Each item
 * is try/catch isolated with an attempts counter — an item that fails three
 * times sorts to the back and stops standing at the door. A model-call throw
 * is swallowed per turn inside `propose()` ("one chunk failing must not zero
 * the whole harvest"), so the failure surface is traced here instead: an item
 * whose calls all threw and which yielded no proposal has failed, not
 * "extracted nothing".
 */

import matter from 'gray-matter';

import { clean, dropCitedParagraphs, toTurns } from './body.js';
import { ORPHAN_QUOTES } from './prior-ingest.js';
import type { ImportCut, ImportRecord, RegionRecord } from './contract.js';
import type { ImportStore } from './store.js';
import { propose, SYSTEM_PROMPT, coerceAuthorshipStance } from '../harvester/harvester.js';
import { isQuotedFromSource, quotedSpans } from '../harvester/admissibility.js';
import type { Complete } from '../types.js';
import type { LogFn } from '../wiki/contract.js';

export type ExtractionDeps = {
  store: ImportStore;
  complete: Complete;
  readSource: (path: string) => string;
  log: LogFn;
  /** Items per run; default 5, LIVE (Q-56). */
  budget?: number;
  /** Attempts before an item is failed; default 3. */
  attemptsBeforeFailed?: number;
  /** Injected, not imported: the region store, so a test hands one region.
   *  Injection site: runImportJobsNow's ExtractionDeps construction in
   *  src/server.ts (seeding Task 12 Step 3). Until that lands this is inert
   *  on every real run — an optional parameter no caller passes. */
  regionFor?: (sourcePath: string) => RegionRecord | null;
  /** The stop switch (POST /api/jobs/stop), read between items — never
   *  mid-item, so a stop can never write a partially-extracted record.
   *  Absent means never stopped. */
  shouldStop?: () => boolean;
};

export type ExtractionResult = { extracted: number; remaining: number; failed: number };

/**
 * The prompt clause for a region whose words the person did not compose
 * (seeding Task 7): the words were kept and NOT composed by the person, so no
 * cut may wear `stance: 'avowal'` — an avowal asserts the person holds the
 * claim, and here the claim is not theirs to hold — and the reading describes
 * the keeping. `propose()` replaces its whole system prompt when an override
 * is passed, so the clause carries the baseline with it: an append, not a
 * fork. Not exported: an export would need a registry entry the plan does not
 * declare.
 */
const KEPT_NOT_WRITTEN = `${SYSTEM_PROMPT}

REGION AUTHORSHIP — the words in this message were kept and NOT composed by
the person who filed them: the region's authorship is declared as someone
else's. Never use stance 'avowal' for a cut from this message — the person
did not hold the claim, they kept it. Describe the keeping in the reading:
what the person chose to preserve, and why it was worth keeping.`;

export async function runImportExtraction(deps: ExtractionDeps): Promise<ExtractionResult> {
  const budget = deps.budget ?? 5;
  const attemptsBeforeFailed = deps.attemptsBeforeFailed ?? 3;
  let extracted = 0;
  let failed = 0;

  for (let processed = 0; processed < budget; processed++) {
    if (deps.shouldStop?.() === true) break;
    const record = deps.store.nextPending();
    if (record === null) break;
    const region = deps.regionFor?.(record.sourcePath) ?? null;

    // Trace model-call throws that `propose()` swallows per turn, so a run
    // where every call failed reads as a failed item rather than an empty one.
    let lastCallError: unknown = null;
    const tracingComplete: Complete = async (system, turns, opts) => {
      try {
        return await deps.complete(system, turns, opts);
      } catch (err) {
        lastCallError = err;
        throw err;
      }
    };

    try {
      // 1. Re-read the source; the body is the frontmatter-stripped content.
      const raw = deps.readSource(record.sourcePath);
      const body = matter(raw).content;

      // 2. The prepared prose — blockquotes always dropped, citation
      // paragraphs always dropped, splits on paragraph boundaries only.
      const prepared = dropCitedParagraphs(clean(body, false), ORPHAN_QUOTES).kept;
      const turns = toTurns(prepared, `${record.date}T00:00:00.000Z`);

      // 3. The session id is provisional — the committed sitting takes its
      // own id when review lands (T7).
      const { proposals } = await propose(
        `import-${record.hash}`,
        turns,
        tracingComplete,
        region !== null && region.authorship !== 'authored' ? KEPT_NOT_WRITTEN : undefined,
      );

      if (lastCallError !== null && proposals.length === 0) throw lastCallError;

      // 4. Drop, in order: non-substrings of the source body (a), the
      // raw-source Q-51 check (b), then Q-59 dedupe (c) — last.
      const rawSpans = quotedSpans(raw);
      const keptElsewhere = new Set<string>();
      for (const r of deps.store.list('accepted')) {
        if (r.sourcePath === record.sourcePath) {
          for (const k of r.kept ?? []) keptElsewhere.add(k);
        }
      }

      const cuts: ImportCut[] = [];
      let quotedDropped = 0;
      for (const p of proposals) {
        if (!body.includes(p.text)) continue;
        if (isQuotedFromSource(p.text, rawSpans)) {
          quotedDropped++;
          continue;
        }
        if (keptElsewhere.has(p.text)) continue;
        // 5. Earliest occurrence in the source body (ticket 024's rule).
        cuts.push({
          text: p.text,
          at: body.indexOf(p.text),
          facet: p.facet,
          stance: p.stance,
          reading: p.reading,
        });
      }

      // 6. The authorship guard (seeding Task 7). The prompt clause shapes;
      // this enforces, whatever the model returned: a region declared not
      // the person's may not carry `stance: 'avowal'` — the words were KEPT,
      // not held, and an avowal asserts the person holds the claim. The rule
      // itself lives in the harvester, which owns the STANCES vocabulary
      // (coerceAuthorshipStance, Wave D F14); here it is applied to every cut.
      let coerced = 0;
      if (region !== null) {
        for (const c of cuts) {
          const next = coerceAuthorshipStance(c.stance, region.authorship);
          if (next !== c.stance) {
            c.stance = next;
            coerced++;
          }
        }
      }

      // 7. Write the record back, extracted, with the prepared prose.
      deps.store.put({ ...record, status: 'extracted', cuts }, prepared);
      extracted++;
      deps.log({
        at: new Date().toISOString(),
        actor: 'clerk',
        kind: 'import-extracted',
        detail: `path=${record.sourcePath} cuts=${cuts.length}`,
      });
      if (coerced > 0) {
        deps.log({
          at: new Date().toISOString(),
          actor: 'clerk',
          kind: 'import-stance-coerced',
          detail: `path=${record.sourcePath} cuts=${coerced}`,
        });
      }
      if (quotedDropped > 0) {
        deps.log({
          at: new Date().toISOString(),
          actor: 'clerk',
          kind: 'import-quoted-dropped',
          detail: `path=${record.sourcePath} cuts=${quotedDropped}`,
        });
      }
    } catch (err) {
      const attempts = record.attempts + 1;
      const terminal = attempts >= attemptsBeforeFailed;
      deps.store.put(
        {
          ...record,
          attempts,
          ...(terminal ? { status: 'failed', failure: String(err) } : {}),
        },
        deps.store.prepared(record.hash),
      );
      if (terminal) failed++;
      deps.log({
        at: new Date().toISOString(),
        actor: 'clerk',
        kind: 'import-extract-failed',
        detail: `path=${record.sourcePath} attempts=${attempts}`,
      });
    }
  }

  const remaining = deps.store.list('pending').length;
  if (remaining > 0) {
    deps.log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'threshold-clipped',
      detail: `threshold=import.budget value=${budget} clipped=${remaining} import items still pending`,
    });
  }
  return { extracted, remaining, failed };
}
