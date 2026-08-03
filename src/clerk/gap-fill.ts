import type { Vault, QueueStore, Bud, Reading, Snippet } from '../types.js';
import { hasConstructPole } from './clause.js';

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

 let minted = 0;
 let budQuestions = 0;
 let constructQuestions = 0;
 let clipped = 0;

 // The queue is the single memory of what has been offered (Q-39), so it
 // is read ONCE and kept in memory as two dedupe sets, updated as this run
 // mints: an entry minted earlier in THIS run blocks a later candidate
 // exactly like one minted in a previous run, without re-reading the queue
 // directory per candidate.
 const held = deps.queue.list({ source: 'gap-fill' });
 const heldBuds = new Set(
  held.filter((e) => e.bud !== undefined && e.failure !== undefined).map((e) => `${e.bud}\u0000${e.failure}`),
 );
 const heldSnippets = new Set(held.filter((e) => e.snippet !== undefined).map((e) => e.snippet));

 // ── Sweep A — Buds, oldest captured first ──
 const buds = Object.values(index.buds).sort((a, b) => a.captured.localeCompare(b.captured));
 for (const bud of buds) {
  for (const failure of bud.failures) {
   // Ever-minted blocks, ANY status (pending/asked/deferred/expired/
   // answered): an expired question is the person declining to develop the
   // Bud — dormancy is signal (Q-24/Q-41/Q-72), so unlike lint's
   // stale-citation re-mint, the sweep never re-offers; an answered
   // question means the Bud matured.
   if (heldBuds.has(`${bud.id}\u0000${failure}`)) {
    continue;
   }
   if (minted >= GAPFILL_MINT_CAP_PER_RUN) {
    // The cap bounds what this run mints (Q-56). The scan CONTINUES so the
    // clip count is the true backlog the cap held back, not a flag.
    clipped++;
    continue;
   }
   deps.queue.add({
    source: 'gap-fill',
    license: 'CC0',
    question: budQuestion(bud, failure),
    questionForm: 'deliberative',
    sharpness: 'weak',
    horizon: 'session',
    bud: bud.id,
    failure,
   });
   heldBuds.add(`${bud.id}\u0000${failure}`);
   minted++;
   budQuestions++;
  }
 }

 // ── Sweep B — half-Constructs, oldest readings first ──
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
   deps.log({
    at: new Date().toISOString(),
    actor: 'clerk',
    kind: 'gap-fill-pole-skip',
    detail: `snippet=${snippet.id}`,
    refs: [`${snippet.id}@${snippet.version}`],
   });
   continue;
  }
  // Dedupe on the snippet id, any status blocks: one contrast question per
  // half-Construct, ever (ticket 027).
  if (heldSnippets.has(snippet.id)) {
   continue;
  }
  if (minted >= GAPFILL_MINT_CAP_PER_RUN) {
   clipped++;
   continue;
  }
  deps.queue.add({
   source: 'gap-fill',
   license: 'CC0',
   question: `"${snippet.prose}" — what is the opposite of this for you?`,
   questionForm: 'deliberative',
   sharpness: 'weak',
   horizon: 'session',
   snippet: snippet.id,
   cites: [`${snippet.id}@${snippet.version}`],
  });
  heldSnippets.add(snippet.id);
  minted++;
  constructQuestions++;
 }

 if (minted > 0) {
  deps.log({
   at: new Date().toISOString(),
   actor: 'clerk',
   kind: 'gap-fill-minted',
   detail: `minted=${minted} budQuestions=${budQuestions} constructQuestions=${constructQuestions}`,
  });
 }
 if (clipped > 0) {
  deps.log({
   at: new Date().toISOString(),
   actor: 'clerk',
   kind: 'gap-fill-clipped',
   detail: `cap=${GAPFILL_MINT_CAP_PER_RUN} clipped=${clipped}`,
  });
 }

 return { minted, budQuestions, constructQuestions };
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
 const snippetId = cite.split('@')[0] ?? '';
 const snippet = snippets[snippetId];
 return snippet ?? null;
}
