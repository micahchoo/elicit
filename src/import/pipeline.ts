/**
 * The Seeding pipeline — the ONE place the import routes' choreography
 * lives (014). Each function owns a full multi-step sequence the routes
 * used to spell out, step by step, in their handlers:
 *
 *   - `pipelineScan` — the scan route's composition: adoption FIRST and
 *     with this folder (T8), then the region's declared rule dates the
 *     scan (Anchor, 014 T3), then the store admits what the scan found —
 *     and the two activity events that go with the pass.
 *   - `pipelineCommit` — the decisions route's order: a commit, and only
 *     on a CLEAN commit the repair pass over the snippets just written
 *     (014 T10), never before.
 *   - `pipelineSurvey` — the survey route's rule: compute the coarse map,
 *     then snapshot it unless the read is pure (129).
 *   - `pipelineReach` — the reach route's meeting: the survey snapshot and
 *     the live pending queue become exactly one offer (Q-62).
 *
 * A route that wants one of these sequences calls one function and shapes
 * the response; deleting this module moves the sequences BACK into the
 * routes, which is the failure this file exists to prevent.
 *
 * The single door: the stores, the extraction job and the one-step helpers
 * the server still calls directly — the composition root, the docket's
 * extraction job, `droppedRegions`, and the single-step region/decline
 * routes — are re-exported here, so server.ts imports ONE module from
 * src/import instead of eleven. Re-exports are the door, not the pipeline:
 * the sequences above are what makes this file a pipeline rather than a
 * re-export list.
 */

import { adoptPriorIngest, type AdoptResult } from './adopt.js';
import { scanFolder, type ScanResult } from './scan.js';
import { commitImport, type CommitResult } from './commit.js';
import { runImportRepair } from './repair.js';
import { surveyFolder, writeSurvey, readSurvey, type Survey } from './survey.js';
import { reachOffer, reachDeclines, termsOf, type ReachOffer } from './reach.js';
import { createImportStore, type ImportStore, type AdmitResult } from './store.js';
import { createRegionStore } from './region.js';
import { classifyDroppedRun } from './body.js';
import { runImportExtraction } from './extract.js';
import { compilePattern } from './dating.js';
import { appendReachDecline } from './reach.js';
import { bodyHash } from './scan.js';
import type { ImportDecision, RegionRecord } from './contract.js';
import type { EventKind } from '../log/kinds.js';
import type { QueueStore, Vault } from '../types.js';
import type { LogFn } from '../wiki/contract.js';

// ── The single door: what the server still calls directly ──
// The composition root constructs the two stores (server.ts, createApp),
// the docket runs the extraction job (runImportJobsNow), `droppedRegions`
// names dropped lines, the next route verifies a piece is unchanged on
// disk, and the region/decline routes use the single-step helpers. Each
// re-export keeps its home module's identity — server.ts just no longer
// imports eleven modules to reach them.
export { createImportStore } from './store.js';
export { createRegionStore } from './region.js';
export { classifyDroppedRun } from './body.js';
export { runImportExtraction } from './extract.js';
export { compilePattern } from './dating.js';
export { appendReachDecline } from './reach.js';
export { bodyHash } from './scan.js';

export type { CommitResult } from './commit.js';
export type { Survey } from './survey.js';

/** The event shape the pipeline's log sink accepts. Wider than the wiki
 * LogFn: the scan step speaks for the elicitor (import-scanned) as well as
 * the clerk (import-refused-by-rule) in one breath, and the wider type is
 * assignable to LogFn everywhere the pipeline hands its log down. */
type PipelineEvent = {
  at: string;
  actor: 'clerk' | 'elicitor';
  kind: EventKind;
  detail: string;
  refs?: string[];
};

type PipelineLog = (e: PipelineEvent) => void;

/** The scan route's aggregate: adoption, the scan and admission, in the
 * order the pipeline ran them. The route counts from it and merges the two
 * refusal lists — one thing to the reader (Q-59). */
export type ScanPipelineResult = {
  adopted: AdoptResult;
  scanned: ScanResult;
  admitted: AdmitResult;
};

/**
 * POST /api/import/scan's sequence. Adoption FIRST, and with this folder —
 * the path arrives here or nowhere (T8), and adoption is idempotent so a
 * re-scan can never skip it. A bad folder path throws — the route answers
 * 400 with what it said. Then the region's rule dates the scan (Anchor,
 * 014 T3): every file that does not match the declared rule is refused BY
 * NAME, never dated by guess. Then the store admits what the scan found.
 * The two activity events the route used to emit itself — import-scanned,
 * and import-refused-by-rule when a region rule refused anything — are
 * emitted here, in the order the pass makes them true.
 */
export function pipelineScan(deps: {
  store: ImportStore;
  vaultRoot: string;
  folder: string;
  region: RegionRecord | null;
  log: PipelineLog;
}): ScanPipelineResult {
  const adopted = adoptPriorIngest({
    store: deps.store,
    vaultRoot: deps.vaultRoot,
    folder: deps.folder,
    log: deps.log,
  });
  const scanned =
    deps.region === null ? scanFolder(deps.folder) : scanFolder(deps.folder, deps.region.dating);
  const admitted = deps.store.admit(scanned.items, deps.region?.slug);
  // Two refusal sources, one list: scanFolder refuses on the file alone;
  // admit refuses on what the store knows (Q-59's no-lastmod). To the
  // reader they are one thing — a file that did not come in, and why.
  deps.log({
    at: new Date().toISOString(),
    actor: 'elicitor',
    kind: 'import-scanned',
    detail:
      'files=' + (scanned.items.length + scanned.refused.length) +
      ' toImport=' + admitted.added.length +
      ' refused=' + (scanned.refused.length + admitted.refused.length),
  });
  if (deps.region !== null && scanned.refused.length > 0) {
    // The rule and the count, never a file's content or path — the per-file
    // list already came back in the response body whole.
    const ruleRepr =
      deps.region.dating.kind === 'filename' ? deps.region.dating.pattern : deps.region.dating.key;
    deps.log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'import-refused-by-rule',
      detail: `rule=${ruleRepr} count=${scanned.refused.length}`,
    });
  }
  return { adopted, scanned, admitted };
}

/**
 * POST /api/import/:hash/decisions' sequence: the commit, then — only on a
 * CLEAN commit, and never before (014 T10) — the repair pass over the
 * snippets just written. Every unresolvable dangler among them becomes a
 * Bud; the queue question is capped by repair.liveCap. The commit result
 * passes through unchanged: the route maps ok → {sessionId, snippets} and
 * a refusal → 409 with its reason.
 */
export function pipelineCommit(
  deps: {
    vault: Vault;
    store: ImportStore;
    queue: QueueStore;
    vaultRoot: string;
    readSource: (p: string) => string;
    log: LogFn;
    regionFor?: (sourcePath: string) => RegionRecord | null;
  },
  hash: string,
  decisions: ImportDecision[],
): CommitResult {
  const result = commitImport(
    {
      vault: deps.vault,
      store: deps.store,
      readSource: deps.readSource,
      log: deps.log,
      // exactOptionalPropertyTypes: absent, never undefined, when no region store.
      ...(deps.regionFor !== undefined ? { regionFor: deps.regionFor } : {}),
    },
    hash,
    decisions,
  );
  if (!result.ok) return result;
  // The repair pass runs after a CLEAN commit and never before: a repair
  // minted for an item that refused to commit is a question about prose
  // that is not in the corpus.
  const committed = Object.values(deps.vault.rebuildIndex().snippets).filter(
    (s) => s.provenance.session === result.sessionId,
  );
  runImportRepair({
    vault: deps.vault,
    queue: deps.queue,
    vaultRoot: deps.vaultRoot,
    log: deps.log,
    snippets: committed,
  });
  return result;
}

/**
 * GET/POST /api/import/survey's sequence: compute the coarse, model-free
 * map of a folder, then — unless the read is pure (129) — snapshot it to
 * vault/imports/survey.json, the rebuildable cache (Q-3). A survey that
 * writes nothing is still a survey: the map exists to be read in order to
 * declare. A bad folder throws; the route answers 400 with what it said.
 */
export function pipelineSurvey(deps: {
  store: ImportStore;
  vaultRoot: string;
  folder: string;
  /** False under /v2's pure-read dispatch: the snapshot is that verb's job. */
  snapshot: boolean;
}): Survey {
  const survey = surveyFolder(deps.folder, deps.store);
  // A pure read computes the map and keeps nothing (129): under /v2 the
  // snapshot is written by act {v:'survey'}, which is why that verb exists.
  if (deps.snapshot) writeSurvey(deps.vaultRoot, survey);
  return survey;
}

/**
 * GET /api/reach's sequence: the survey snapshot and the pending queue
 * meet in exactly one offer. Read-only and cheap — the snapshot and the
 * queue, never the folder — so a route that re-walked 5,000 files on every
 * waiting-surface render is a route the person would feel. Offer-only
 * (Q-62): silence does nothing, and every evaluation is logged by the
 * caller's log. `root` is the survey root the offer's path is relative to
 * (014 T14); null when never surveyed.
 */
export function pipelineReach(deps: {
  vaultRoot: string;
  queue: QueueStore;
  log: LogFn;
}): { offer: ReachOffer | null; root: string | null } {
  const survey = readSurvey(deps.vaultRoot);
  const pending = deps.queue.list({ status: 'pending' });
  const offer = reachOffer({
    survey,
    // The live Direction (Q-69): the pending queue's question text — the
    // closest running thing this codebase has to a line of inquiry. Injected
    // so the swap to real Directions is one call site.
    liveTerms: () => {
      const terms = new Set<string>();
      for (const e of pending) {
        for (const t of termsOf(e.question)) terms.add(t);
      }
      return terms;
    },
    declined: (p) => reachDeclines(deps.vaultRoot).get(p) ?? null,
    log: deps.log,
  });
  return { offer, root: survey?.root ?? null };
}
