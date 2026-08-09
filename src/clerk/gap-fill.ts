import type { Vault, QueueStore, Bud, Reading, Snippet, Index } from '../types.js';
import { hasConstructPole } from './clause.js';
import { citeSnippetId } from '../wiki/status.js';
import { runGapFillSweepCore, type GapFillCandidate } from '../ktg/sweep-core.js';

// ── The gap-fill sweep (ticket 027) ──
// Buds are a dead letter box: a capture the person never followed through
// on, each stamped with the failure that ended it. The sweep mints ONE
// question per recorded failure — never more, so a Bud can never flood the
// queue — and never re-offers a failure the queue has already seen, in ANY
// state: an expired question is the person declining to develop the Bud
// (dormancy is signal, Q-24/Q-41/Q-72), an answered question means the Bud
// matured. A half-Construct is a construct-facet reading whose pole has no
// recorded contrast; the sweep asks the person for the opposite of the
// cited prose, once per snippet, ever.
//
// Batching follows Q-72's Repair discipline: never a queue flood. The cap
// is a Q-56 bound like ANNOTATION_RUN_CAP in docket.ts — it bounds what one
// run may MINT, combined across both sweeps, and Buds are processed first:
// the dead-letter box comes first.
//
// The mechanics — the queue dedupe (any status blocks re-minting), the cap
// loop and the backlog counting — live in src/ktg/sweep-core.ts: each sweep
// delegates to runGapFillSweepCore with its join key, and this module owns
// the candidates, the templates and the summary logs (Wave B).
//
// ZERO-LLM: this module never references or receives the model call. Every
// question is a template that embeds the person's own words verbatim (Q-12).

/** The docket log sink, narrowed to what the sweep emits (ticket 027). */
export type GapFillLog = (e: {
 at: string;
 actor: string;
 kind: string;
 detail: string;
 refs?: string[];
}) => void;

/** How many gap-fill questions one run may mint, across both sweeps (ticket 027, Q-56). */
const GAPFILL_MINT_CAP_PER_RUN = 3;

/**
 * The gap-fill sweep (ticket 027): one question per recorded Bud failure
 * (the dead-letter box first), then one contrast question per
 * half-Construct, up to the run cap. Both sweeps dedupe against the queue
 * by join key — ever-minted, any status blocks — so a run is idempotent
 * and a person is never re-asked. Returns what was minted, split by sweep.
 */
export async function runGapFillSweep(deps: {
 vault: Vault;
 queue: QueueStore;
 log: GapFillLog;
}): Promise<{ minted: number; budQuestions: number; constructQuestions: number }> {
 const index = deps.vault.rebuildIndex();
 const log = deps.log;
 // One timestamp per run, shared by every log the sweep emits (the core's
 // `now` and the pole gate's skip logs here in the generator).
 const now = new Date().toISOString();

 // ── Sweep A — Buds, oldest captured first ──
 // The core dedupes on the composite (bud, failure) join key and mints up
 // to the run cap; countClipped keeps the scan running so the backlog the
 // cap held back is counted, and sweep B takes what the cap left.
 const budResult = runGapFillSweepCore(
  {
   nodeIds: [],
   source: 'gap-fill',
   pointerKeyFn: (entry) =>
    entry.bud !== undefined && entry.failure !== undefined
     ? `${entry.bud}\u0000${entry.failure}`
     : undefined,
   cap: GAPFILL_MINT_CAP_PER_RUN,
   countClipped: true,
   queue: deps.queue,
   log,
   now,
  },
  budCandidates(index),
 );

 // ── Sweep B — half-Constructs, oldest readings first ──
 // The core dedupes on the snippet id. The cap is what sweep A left: the
 // run cap bounds BOTH sweeps together (Q-56), Buds first. The scan still
 // runs at a zero cap so the pole-skip logs and the clip backlog stay true.
 const constructResult = runGapFillSweepCore(
  {
   nodeIds: [],
   source: 'gap-fill',
   pointerKey: 'snippet',
   cap: GAPFILL_MINT_CAP_PER_RUN - budResult.minted.length,
   countClipped: true,
   queue: deps.queue,
   log,
   now,
  },
  constructCandidates(index, log, now),
 );

 const minted = budResult.minted.length + constructResult.minted.length;
 const budQuestions = budResult.minted.length;
 const constructQuestions = constructResult.minted.length;
 const clipped = budResult.clipped + constructResult.clipped;

 if (minted > 0) {
  log({
   at: now,
   actor: 'clerk',
   kind: 'gap-fill-minted',
   detail: `minted=${minted} budQuestions=${budQuestions} constructQuestions=${constructQuestions}`,
  });
 }
 if (clipped > 0) {
  log({
   at: now,
   actor: 'clerk',
   kind: 'gap-fill-clipped',
   detail: `cap=${GAPFILL_MINT_CAP_PER_RUN} clipped=${clipped}`,
  });
 }

 return { minted, budQuestions, constructQuestions };
}

/**
 * Sweep A's candidate stream: one candidate per recorded Bud failure,
 * oldest captured first. Every failure is eligible — a Bud is a dead
 * letter box by construction; the core applies the join-key dedupe, the
 * cap and the backlog counting.
 */
function budCandidates(
 index: Index,
): (status: ReadonlyMap<string, string>) => Generator<GapFillCandidate> {
 return function* budCandidatesInner(
  status: ReadonlyMap<string, string>,
 ): Generator<GapFillCandidate> {
  const buds = Object.values(index.buds).sort((a, b) => a.captured.localeCompare(b.captured));
  for (const bud of buds) {
   for (const failure of bud.failures) {
    yield {
     nodeId: `${bud.id}\u0000${failure}`,
     draft: {
      source: 'gap-fill',
      license: 'CC0',
      question: budQuestion(bud, failure),
      questionForm: 'deliberative',
      sharpness: 'weak',
      horizon: 'session',
      bud: bud.id,
      failure,
     },
    };
   }
  }
 };
}

/**
 * Sweep B's candidate stream: one contrast candidate per half-Construct
 * reading, oldest readings first. The QR-1 pole gate (ticket 114) is
 * decided here — a half-Construct needs a pole, a clause that can carry a
 * contrast, or the opposite question mints on nothing; the skip is
 * shadow-logged (Q-35) and the reading is never offered.
 */
function constructCandidates(
 index: Index,
 log: GapFillLog,
 now: string,
): (status: ReadonlyMap<string, string>) => Generator<GapFillCandidate> {
 return function* constructCandidatesInner(
  status: ReadonlyMap<string, string>,
 ): Generator<GapFillCandidate> {
  const constructReadings = Object.values(index.readings)
   .filter((r) => r.facet === 'construct')
   .sort((a, b) => {
    const byAt = (a.at ?? '').localeCompare(b.at ?? '');
    return byAt !== 0 ? byAt : firstCite(a).localeCompare(firstCite(b));
   });
  for (const reading of constructReadings) {
   // Resolve the reading's first cite ("snippetId@version") to the snippet
   // by id — the CURRENT version from this rebuild.
   const snippet = resolveFirstCite(reading, index.snippets);
   if (snippet === null) continue;
   // The pole gate (ticket 114, QR-1): 037 over-labels poetry, metaphor
   // and observation as `construct`. A half-Construct needs a pole — a
   // clause that can carry a contrast — or the opposite question mints on
   // nothing. Shadow (Q-35): the skip log records the decision.
   if (!hasConstructPole(snippet.prose)) {
    log({
     at: now,
     actor: 'clerk',
     kind: 'gap-fill-pole-skip',
     detail: `snippet=${snippet.id}`,
     refs: [`${snippet.id}@${snippet.version}`],
    });
    continue;
   }
   yield {
    nodeId: snippet.id,
    draft: {
     source: 'gap-fill',
     license: 'CC0',
     question: `"${snippet.prose}" — what is the opposite of this for you?`,
     questionForm: 'deliberative',
     sharpness: 'weak',
     horizon: 'session',
     snippet: snippet.id,
     cites: [`${snippet.id}@${snippet.version}`],
    },
   };
  }
 };
}

/**
 * The question one recorded Bud failure earns (Q-12): the person's fragment
 * verbatim, wrapped by the template that names the failure that ended the
 * capture. Any unrecognized failure literal falls back to the standalone
 * template rather than guessing at a meaning (Q-60).
 */
function budQuestion(bud: Bud, failure: string): string {
 const fragment = `"${bud.fragment}"`;
 if (failure === 'mid-sentence') {
  return `${fragment} — this picks up mid-thought. What were you saying?`;
 }
 if (failure === 'label') {
  return `${fragment} — what kind of thing is this for you?`;
 }
 return `${fragment} — what were you saying with this?`;
}

/** The reading's first cite, or '' when it cites nothing. */
function firstCite(r: Reading): string {
 return r.cites[0] ?? '';
}

/**
 * The snippet a reading's first cite names, by id — the current version
 * from the rebuild. Null when the reading cites nothing or the cite names
 * a snippet the vault no longer holds.
 */
function resolveFirstCite(r: Reading, snippets: Record<string, Snippet>): Snippet | null {
 const cite = firstCite(r);
 if (cite === '') return null;
 const snippetId = citeSnippetId(cite);
 const snippet = snippets[snippetId];
 return snippet ?? null;
}
