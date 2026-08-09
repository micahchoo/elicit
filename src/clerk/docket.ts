import type {
 Vault,
 QueueStore,
 QueueDraft,
 Snippet,
 LexicalIndex,
 DocketReport,
 Complete,
 QueueEntry,
} from '../types.js';
import type { SittingContext } from './composed.js';
import { isExpeditionCandidate, isOtherMindsCandidate } from './composed.js';
import { readSitting, sittingCache } from './sitting.js';
import { stalePins } from '../piece/stale.js';
import { isDormant } from '../piece/dormancy.js';
import { THRESHOLDS, readNumber } from '../wiki/thresholds.js';
import { citeSnippetId } from '../wiki/status.js';
import { cover } from '../memory/cover.js';
import type { Piece, PieceStore } from '../piece/contract.js';
import { runReferentAnnotations, runIntentionHorizonAnnotations, runOutcomeQuestions, runOneTimeTemplateSweep, runCompositionGapSweep } from './sweeps.js';

// ── The sweep jobs (Wave B2) ──
// The four self-contained jobs moved to sweeps.ts; re-exported here so the
// boot wiring (docket-init.ts) and the test suite keep importing them from
// './docket.js' unchanged.
export { runReferentAnnotations, runIntentionHorizonAnnotations, runOutcomeQuestions, runOneTimeTemplateSweep, runCompositionGapSweep };

// ── Structural types from cover.ts contract (Task 4c) ──
// NOT imported — docket injects these structurally per the plan.
type SessionRef = { session: string; started: string; turnCount: number; chars: number };
type RangeSummary = { sessions: string[]; line: string; model: string; at: string };

// ── In-process lock ──
let running = false;

// ── The piece sweeps (010 T10) ──
// Two docket jobs that learn Pieces exist: the stale-pin sweep flags, never
// re-pins (Q-39), and the dormancy sweep sets a long-quiet Piece down —
// silently (Q-22: nothing is sent anywhere), logged (Q-23), reversibly
// (Q-41: picking it up resumes minting). Both are zero-LLM: neither ever
// receives the Complete. Both are injected structurally as optional thunks
// on runDocket, absent meaning no piece work this run — every caller
// predating the field behaves exactly as before.

/** The docket log sink, narrowed to what the piece sweeps emit (010 T10). */
export type PieceLog = (e: {
 at: string;
 actor: string;
 kind: string;
 detail: string;
 refs?: string[];
}) => void;

/**
 * The stale-pin sweep (010 T10, Q-39): one flag per pin whose snippet has
 * moved on, written as Marginalia on the Piece. The consequence of a stale
 * pin is a dimmed note, never a re-pin — this job has no write path for
 * pins. Findings are deduped by `(on, note)` against what is already on
 * disk, so a second run writes nothing; the count returned is the number of
 * NEW Marginalia written this run.
 */
export async function runStalePinSweep(deps: {
 pieces: PieceStore;
 snippets: () => Record<string, Snippet>;
 log: PieceLog;
}): Promise<number> {
 const snippets = deps.snippets();
 let flagged = 0;
 for (const piece of deps.pieces.list()) {
  const onDisk = new Set(piece.marginalia.map((m) => `${m.on}\u0000${m.note}`));
  const findings = stalePins(piece.entries, snippets).filter((m) => !onDisk.has(`${m.on}\u0000${m.note}`));
  if (findings.length === 0) continue;
  deps.pieces.putMarginalia(piece.id, [...piece.marginalia, ...findings]);
  flagged += findings.length;
 }
 if (flagged > 0) {
  deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'stale-pin-flagged', detail: `flagged=${flagged}` });
 }
 return flagged;
}

/**
 * The dormancy sweep (010 T10, Q-41): a Piece nobody has touched for
 * `piece.dormancyDays` is set down. `lastTouched` is the newest of the
 * Piece's `created` and the `captured` of every pin in it — the draft is
 * what the person touches. The activity log is deliberately NOT consulted:
 * it is evidence, not a dependency, and a job that fails when the log is
 * unreadable is a job that stops the Docket.
 */
export async function runDormancySweep(deps: {
 pieces: PieceStore;
 snippets: () => Record<string, Snippet>;
 log: PieceLog;
}): Promise<number> {
 const days = readNumber(THRESHOLDS['piece.dormancyDays'], 45);
 const snippets = deps.snippets();
 const now = Date.now();
 let setDown = 0;
 for (const piece of deps.pieces.list()) {
  const touched: string[] = [piece.created];
  for (const entry of piece.entries) {
   if (entry.kind !== 'pin') continue;
   const s = snippets[entry.snippet];
   if (s !== undefined) touched.push(s.captured);
  }
  const lastTouched = touched.sort().at(-1) ?? piece.created;
  if (!isDormant(piece, lastTouched, now, days)) continue;
  deps.pieces.setDown(piece.id, 'dormancy');
  setDown++;
  deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'piece-set-down-auto', detail: `piece=${piece.id}` });
 }
 return setDown;
}

export async function runDocket(deps: {
 vault: Vault;
 queue: QueueStore;
 complete: Complete;
 buildIndex: (snippets: Snippet[]) => LexicalIndex;
 composeOpener: (s: Snippet, c: Complete, sitting?: SittingContext, historyBlock?: string, summaryLines?: string[]) => Promise<QueueDraft | null>;
 composeExpedition?: (s: Snippet, c: Complete, sitting?: SittingContext) => Promise<QueueDraft | null>;
 composeOtherMindsExpedition?: (
  s: Snippet,
  c: Complete,
  personName: string,
  sitting?: SittingContext,
 ) => Promise<QueueDraft | null>;
 /**
  * The gazetteer person index (ticket 113). Optional: the other-minds
  * expedition loop runs only when a store is injected — the server wires
  * its live store, tests inject a stub.
  */
 gazetteerStore?: { byMentionCount(threshold: number): { name: string; kind: string }[] };
 /**
  * The sitting a snippet's session declared (045). Injected for tests; the
  * default reads the session's transcript frontmatter.
  */
 sittingOf?: (root: string, session: string) => SittingContext;
 log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
 nextConsolidation?: (sessions: SessionRef[], summaries: RangeSummary[]) => string[] | null;
 saveSummary?: (root: string, s: RangeSummary) => void;
 loadSummaries?: (root: string) => RangeSummary[];
 listSessions?: (root: string) => SessionRef[];
 readTranscript?: (root: string, session: string) => string;
 modelName?: string;
 vaultRoot: string;
/**
 * The ladder summaries (011 T11), as the docket's sixth job of a run.
 *
 * Structural and optional on purpose. This file must not import
 * `sounding-summary.ts` — the docket is the older, smaller thing and the
 * sounding layer depends on it, not the other way round — so the server
 * injects a thunk that has already been given its own collaborators,
 * including its own Activity Log sink. The thunk receives the docket's own
 * vault root, the Complete, the clerk model name and the log. Absent means
 * no summary work this run, and every caller that predates the field
 * behaves exactly as it did.
 */
 runLadderSummaries?: (args: {
  root: string;
  complete: Complete;
  model: string | undefined;
  log: (e: { at: string; actor: string; kind: string; detail: string }) => void;
 }) => Promise<{ summarized: number }>;
 /**
  * The Clerk's wiki work (T12), as the last job of a run.
  *
  * Structural and optional on purpose. This file must not import
  * `wiki-jobs.ts` — the docket is the older, smaller thing and the wiki
  * layer depends on it, not the other way round — so the server injects a
  * thunk that has already been given its own collaborators, including its own
  * Activity Log sink. Absent means no wiki work this run, and every caller
  * that predates the field behaves exactly as it did.
  */
 runWikiJobs?: () => Promise<DocketReport['wiki']>;
/**
 * The §12 full-corpus embedding coverage pass (Batch C3), as a docket job
 * before the neighborhoods pass: rebuild the semantic channel over the
 * CURRENT corpus and prime it to coverage, so every passage — not just the
 * subset the boot-built channel captured — gets a vector, and the run logs
 * the coverage sentence (a starved run is a sentence, never a silence).
 * Absent means no coverage work this run (no embedder wired), and every
 * caller predating the field behaves exactly as before.
 */
coverageEmbedding?: () => Promise<{ covered: number; total: number; fresh: number }>;
/**
 * The stale-pin sweep (010 T10), as the first piece job of a run. Absent
 * means no piece work this run, and every caller predating the field
 * behaves exactly as before. Zero-LLM: it never receives the Complete.
 */
 stalePinSweep?: () => Promise<number>;
/**
 * The dormancy sweep (010 T10), as the second piece job of a run. Absent
 * means no piece work this run, and every caller predating the field
 * behaves exactly as before. Zero-LLM: it never receives the Complete.
 */
 dormancySweep?: () => Promise<number>;
/**
 * The composition gap sweep (redesign-2026-08-09 §7, §10), as the third
 * piece job of a run — after stale pins and dormancy, before the other
 * sweeps. Model-calling (the clerk's findGaps); the second probation
 * entry, with the named floor: every gap placed by hand. Absent means no
 * gap work this run, and every caller predating the field behaves exactly
 * as before.
 */
 compositionGapSweep?: () => Promise<{ found: number; placed: number; skipped: number; expired: number }>;
/**
 * The referent annotation job (ticket 074), as the docket's seventh job of
 * a run. Absent means no annotation work this run, and every caller
 * predating the field behaves exactly as before. The server injects it
 * with the annotation store and the Clerk's complete bound.
 */
referentAnnotations?: () => Promise<{ annotated: number; silent: number; failed: number }>;
/**
 * The territory gap-fill sweep (ticket 094), as a docket job after the
 * ordinary gap-fill sweep. Reads KTG skeletons against coverage and mints
 * questions for frontier nodes and common failures.
 * Absent means no territory work this run, and every caller predating
 * the field behaves exactly as before. Zero-LLM.
 */
territoryGapFillSweep?: () => Promise<{ minted: number; frontierQuestions: number; failureQuestions: number }>;
/**
 * The gazetteer extraction job (ticket 100), as a docket job before the
 * frontier sweep. Model-calling: reads snippets and extracts named entities,
 * merging them into the gazetteer store. Absent means no extraction work
 * this run, and every caller predating the field behaves exactly as before.
 * Caps live at birth (Q-56).
 */
gazetteerExtraction?: () => Promise<{ extracted: number; entities: number; failed: number }>;
/**
 * The gazetteer frontier sweep (ticket 100), as a docket job after the
 * extraction job. ZERO-LLM: reads the gazetteer index against the queue's
 * subjects and mints (or shadow-logs) frontier questions. Absent means no
 * frontier work this run, and every caller predating the field behaves
 * exactly as before.
 */
gazetteerFrontier?: () => Promise<{ minted: number; frontierEntities: number }>;
/**
 * The atlas gap-fill sweep (ticket 110), as a docket job after the
 * territory gap-fill. Reads atlas instruments against coverage and
 * evaluates candidate questions. Shadow-first (Q-35): candidates are
 * logged, not minted. ZERO-LLM. Absent means no atlas work this run,
 * and every caller predating the field behaves exactly as before.
 */
atlasGapFillSweep?: () => Promise<{ candidateCount: number; scanned: number; minted: number }>;
/**
 * The lineage mirror sweep (Q-83, ticket 112), as a docket job after the
 * atlas gap-fill. Reads claims against lineage (transcripts), evaluates
 * candidates, and mints juxtaposition-style mirror questions.
 * Shadow-first (Q-35): candidates always logged; questions minted only
 * when the selection threshold graduates to live. The cap is live (Q-56).
 * Absent means no mirror work this run, and every caller predating the
 * field behaves exactly as before.
 */
 lineageMirrorSweep?: () => Promise<{ evaluated: number; minted: number }>;
 /**
  * Coach seed sweep (Q-110 door 1): clusters wiki claims by theme and mints
  * un-coached DirectionRecords for themes with 3+ claims. ZERO-LLM — it
  * never receives the Complete. Absent means no seeding this run, and every
  * caller predating the field behaves exactly as before.
  */
 coachSeedSweep?: () => Promise<{ clustered: number; minted: number }>;
 /**
  * The neighborhoods pass (§12.3), as a docket job after the wiki jobs.
  * ZERO-LLM: reads snippets + the snippet-vector store, clusters passages
  * into themes, and writes the derived store the contextualizer page reads.
  * Absent means no neighborhoods work this run, and every caller predating
  * the field behaves exactly as before.
  */
 neighborhoodsJob?: () => Promise<{ source: 'embedding' | 'lexical'; clustered: number; skipped: number; neighborhoods: number }>;
 /**
  * The context-line composition job (Batch B2, §11), as a docket job after
  * the neighborhoods pass. Model-calling: composes a stamped context line
  * for every passage without one, up to the per-run quota
  * (`contextLines.perRun`, Q-56), and logs its coverage every run — the
  * §12 debt: starvation is a sentence on the activity log, never a silence.
  * Absent means no context-line work this run, and every caller predating
  * the field behaves exactly as before.
  */
 runContextLines?: () => Promise<{ composed: number; skipped: number }>;
 /**
  * The import extraction (T6), as the LAST job of a run — after even the
 * wiki work, because it is the slowest thing in the run.
 *
 * Structural and optional on purpose. This file must not import
 * `import/extract.ts` — the docket is the older, smaller thing and the
 * import layer depends on it, not the other way round — so the server
 * injects a thunk that has already been given its own collaborators,
 * including its own Activity Log sink. Absent means no import work this
 * run, and every caller that predates the field behaves exactly as it did.
 */
 runImportJobs?: () => Promise<{ extracted: number; remaining: number; failed: number }>;
/**
 * The intention-horizon annotation job (ticket 106), as a docket job
 * after the referent annotation job. Finds intention-facet readings and
 * calls the model to extract the timeline — when the person expected the
 * intention to materialize. Absent means no horizon work this run.
 */
intentionHorizonAnnotations?: () => Promise<{ annotated: number; silent: number; ambiguous: number; failed: number }>;
/**
 * The outcome-question sweep (ticket 106), as a docket job after the
 * intention-horizon annotation job. Scans past-horizon intentions and
 * mints outcome questions — "did this come to pass?" Caps live at birth
 * (Q-56); ever-minted dedupe through the queue. Absent means no outcome
 * work this run.
 */
outcomeQuestionSweep?: () => Promise<{ minted: number }>;
/**
 * The tripwire sweep (Q-90, ticket 132), as a docket job after the lineage
 * mirror. Reads the graduation ledger against the guarded metrics and
 * demotes a batch when the person's own record has gone worse. ZERO-LLM —
 * it is never handed the Complete, and never will be: a model deciding
 * whether the mechanism watching the model should stop is the one wiring
 * this job exists to prevent. Absent means no tripwire work this run, and
 * every caller predating the field behaves exactly as before.
 *
 * Its result is deliberately NOT in the DocketReport. The guarded numbers
 * are Q-83's never-mirrored class applied to the operator hat: they reach
 * `data/` and `scripts/loop-status.ts` and no surface a person reads.
 */
tripwireSweep?: () => Promise<void>;
/**
 * The stop switch (POST /api/jobs/stop), read between jobs and between
 * per-snippet model calls. A run cannot abort a model call mid-air, so this
 * is the granularity stopping has: the call in flight finishes, then the
 * run skips everything that remains and settles. Absent means never
 * stopped — every caller predating the field behaves exactly as before.
 */
shouldStop?: () => boolean;
}): Promise<DocketReport> {
 if (running) {
  return {
   reindexed: 0,
   minted: [],
   expired: 0,
   index: deps.buildIndex([]),
  };
 }

 running = true;
 try {
  const ts = () => new Date().toISOString();
  /** Read at every job boundary and inside every model-call loop. */
  const stopped = (): boolean => deps.shouldStop?.() === true;

  /**
   * The guarded-thunk primitive every job of this run collapses onto:
   * `if (!stopped()) { try { await thunk() } catch (err) { sink ?? log } }`.
   * `failKind` is the Activity Log kind of the job's failure line — the
   * literal each call site passes, so the emitted-kinds sweep reads the
   * failure vocabulary at the call sites (the same contract as the
   * wrapper following in tests/emitted-kinds.ts). A site that diverges —
   * the tripwire's operator-channel console.error, the piece sweeps'
   * shared piece-jobs-failed line with its step prefix — passes its own
   * sink via opts; the sink's own emit carries the literal then.
   */
  const runJob = async (
   failKind: string,
   thunk: () => Promise<unknown>,
   opts?: { sink?: (kind: string, err: unknown) => void },
  ): Promise<void> => {
   if (stopped()) return;
   try {
    await thunk();
   } catch (err) {
    if (opts?.sink) opts.sink(failKind, err);
    else deps.log({ at: ts(), actor: 'clerk', kind: failKind, detail: String(err) });
   }
  };

  // ── Log: run started ──
  deps.log({ at: ts(), actor: 'clerk', kind: 'run-started', detail: 'docket run started' });

  // ── 1. Rebuild index from ALL snippets ──
  const rebuildResult = deps.vault.rebuildIndex();
  const allSnippets = Object.values(rebuildResult.snippets);
  const allReadings = rebuildResult.readings;
  const index = deps.buildIndex(allSnippets);
  deps.log({ at: ts(), actor: 'clerk', kind: 'index-rebuilt', detail: `rebuilt index from ${allSnippets.length} snippets` });

  // ── 1b. The one-time template sweep (QR-6) ──
  // Runs once, ever: the flag file gates it inside the sweep, so a second
  // run is a no-op. It only ever expires — never mints — so the dedupe keys
  // an expired entry carries stay put and the gap-fill sweep's any-status
  // block keeps a re-mint from the same license instances impossible.
  // Guarded like every other job: a throw is one job's failure, and the
  // index is already on disk by the time this runs.
  await runJob('template-sweep-failed', () => runOneTimeTemplateSweep({
   queue: deps.queue,
   vaultRoot: deps.vaultRoot,
   log: deps.log,
  }));

  const minted: QueueEntry[] = [];

  /**
   * The one per-snippet mint primitive the four mint loops share:
   * stopped → compose → queue.add → minted.push → count/log-with-refs,
   * and a throw is one mint's failure, never the run's. Each site keeps
   * its own question-factory, its own on-minted counting/refs, and its
   * own failure line. Returns 'stopped' so a loop can break when the
   * stop switch flips mid-run.
   */
  const mintOne = async (
   s: Snippet,
   compose: (s: Snippet) => Promise<QueueDraft | null>,
   onMinted: (draft: QueueDraft) => void,
   fail: { kind: string; detail: (s: Snippet, err: unknown) => string },
  ): Promise<'stopped' | 'minted' | 'skipped'> => {
   if (stopped()) return 'stopped';
   try {
    const draft = await compose(s);
    if (!draft) return 'skipped';
    const entry = deps.queue.add(draft);
    minted.push(entry);
    onMinted(draft);
    return 'minted';
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: fail.kind, detail: fail.detail(s, err) });
    return 'skipped';
   }
  };

  // Every question this run mints quotes one snippet, so it belongs to the
  // sitting that snippet came from — a domain sitting's words make a domain
  // question, whatever the question happens to be about (045).
  const sittingFor = sittingCache(deps.vaultRoot, deps.sittingOf ?? readSitting);

  // Cache sessions once for opener + consolidation use
  let sessions: SessionRef[] | undefined;
  if (deps.listSessions) {
   sessions = deps.listSessions(deps.vaultRoot);
   sessions.sort((a, b) => b.started.localeCompare(a.started));
  }

  // ── 2. Opener minting: uncited snippets from last 2 sessions ──

  // Build the history tile block (Q-86, ticket 119): cover() tiles sessions
  // into summary + gap lines for the composition prompt.
  let historyBlock: string | undefined;
  let summaryLines: string[] | undefined;
  if (sessions && deps.loadSummaries) {
   const summaries = deps.loadSummaries(deps.vaultRoot);
   const tiles = cover(sessions, summaries, readNumber(THRESHOLDS['opener.historyBudgetChars'], 0));

   const lines: string[] = [];
   const sLines: string[] = [];
   const sessionById = new Map(sessions.map(s => [s.session, s]));

   for (const tile of tiles) {
    if (tile.kind === 'summary') {
     const dates = tile.sessions.map(sid => sessionById.get(sid)?.started ?? '').filter(Boolean).sort();
     const range = dates.length >= 2
      ? `${dates[0]!.slice(0, 10)} to ${dates[dates.length - 1]!.slice(0, 10)}`
      : dates[0]?.slice(0, 10) ?? 'unknown';
     const line = `Sessions ${range} — ${tile.line}`;
     lines.push(line);
     sLines.push(tile.line);
    } else if (tile.kind === 'unsummarized') {
     const dates = tile.sessions.map(sid => sessionById.get(sid)?.started ?? '').filter(Boolean).sort();
     const range = dates.length >= 2
      ? ` (${dates[0]!.slice(0, 10)} to ${dates[dates.length - 1]!.slice(0, 10)})`
      : '';
     lines.push(`${tile.sessions.length} session${tile.sessions.length !== 1 ? 's' : ''} not yet consolidated${range}`);
    }
   }

   // Cap: oldest lines drop first
   const cap = readNumber(THRESHOLDS['opener.historyBlockCap'], 4000);
   let block = lines.join('\n');
   while (block.length > cap) {
    const idx = block.lastIndexOf('\n');
    if (idx === -1) break;
    block = block.slice(0, idx);
   }
   historyBlock = block || undefined;
   summaryLines = sLines.length > 0 ? sLines : undefined;
  }

  let openerCount = 0;
  if (sessions) {
   const recentSessionIds = new Set(sessions.slice(0, 2).map(s => s.session));

   const allEntries = deps.queue.list();
   const citedIds = new Set<string>();
   for (const e of allEntries) {
    for (const cite of e.cites ?? []) {
     citedIds.add(citeSnippetId(cite));
    }
   }

   const candidates = allSnippets.filter(s =>
    recentSessionIds.has(s.provenance.session) && !citedIds.has(s.id),
   );

   const openerRefs: string[] = [];
   for (const s of candidates) {
    const outcome = await mintOne(
     s,
     (sn) => deps.composeOpener(sn, deps.complete, sittingFor(sn.provenance.session), historyBlock, summaryLines),
     (draft) => {
      openerCount++;
      if (draft.cites) openerRefs.push(...draft.cites);
     },
     { kind: 'opener-failed', detail: (sn, err) => `composeOpener for snippet ${sn.id} failed: ${String(err)}` },
    );
    if (outcome === 'stopped') break;
   }

   const evt: { at: string; actor: string; kind: string; detail: string; refs?: string[] } = {
    at: ts(), actor: 'clerk', kind: 'opener-minted',
    detail: `minted ${openerCount} openers`,
   };
   if (openerRefs.length > 0) evt.refs = openerRefs;
   deps.log(evt);
  }



  // ── 4. Expire stale queue entries ──
  let expired = 0;
  if (!stopped()) {
   expired = deps.queue.expire(30);
   deps.log({ at: ts(), actor: 'clerk', kind: 'expired', detail: `expired ${expired} entries` });
  }

  // ── 5. At most one consolidation ──
  if (!stopped() && deps.nextConsolidation && deps.saveSummary && deps.loadSummaries && sessions) {
   try {
    const summaries = deps.loadSummaries(deps.vaultRoot);
    // nextConsolidation's contract is oldest-first (ticket 117). The shared
    // array stays newest-first for the opener job; reversing a copy of the
    // descending sort is the ascending sort. Oldest-first is also what keeps
    // the bracketing tree stable as sessions accumulate: new sessions append
    // instead of shifting every pairing, so summary range keys stay valid.
    const oldestFirst = [...sessions].reverse();
    const range = deps.nextConsolidation(oldestFirst, summaries);
    if (range && range.length > 0) {
     // The summary must see actual content — cap per-transcript and total
     // so one consolidation always fits the local model's context.
     const texts = range.map((session) => {
      const body = deps.readTranscript ? deps.readTranscript(deps.vaultRoot, session) : '';
      return `[session ${session}]\n${body.slice(0, 4000)}`;
     });
     const line = (await deps.complete(
      'You summarize interview transcripts. Reply with ONE plain line stating what the person talked about. No interpretation beyond what is present, no praise, no advice.',
      [{ role: 'user', text: texts.join('\n\n').slice(0, 12000), at: ts() }],
     )) ?? '';
     deps.saveSummary(deps.vaultRoot, {
      sessions: range,
      line: line.trim() || 'consolidated (model returned nothing)',
      model: deps.modelName ?? 'unknown',
      at: ts(),
     });
     deps.log({ at: ts(), actor: 'clerk', kind: 'consolidated', detail: `summarized ${range.length} sessions` });
    }
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'consolidation-failed', detail: String(err) });
   }
  }

  // ── 5b. Ladder summaries (011 T11): one line for the rungs a compaction drops ──
  // Guarded like the wiki jobs: a throw is one job's failure, and the
  // index, the minted questions, the expiry and the consolidation are
  // already on disk by the time this runs.
  const runLadderSummaries = deps.runLadderSummaries;
  if (runLadderSummaries) {
   await runJob('soundings-summary-failed', () => runLadderSummaries({
    root: deps.vaultRoot,
    complete: deps.complete,
    model: deps.modelName,
    log: deps.log,
   }));
  }

  /**
   * The expedition twin (ticket 113): both expedition channels — the
   * regular send-out and the other-minds fallback — share one loop
   * skeleton: iterate every snippet, stop at the first candidate, and
   * never mint more than one expedition per run. The differences are the
   * four parameters: who counts as a candidate (and whether they name a
   * person to ask), who composes, the log detail, and the run-level flag.
   */
  const mintExpedition = async (
   candidate: (s: Snippet, allEntries: QueueEntry[]) => { eligible: boolean; person: string | undefined },
   compose: (s: Snippet, person: string | undefined) => Promise<QueueDraft | null>,
   detail: (s: Snippet) => string,
   onMinted?: (draft: QueueDraft) => void,
  ): Promise<void> => {
   const allEntries = deps.queue.list();
   for (const s of allSnippets) {
    const c = candidate(s, allEntries);
    if (!c.eligible) continue;
    await mintOne(
     s,
     (sn) => compose(sn, c.person),
     (draft) => {
      const logEvt: { at: string; actor: string; kind: string; detail: string; refs?: string[] } = {
       at: ts(),
       actor: 'clerk',
       kind: 'expedition-minted',
       detail: detail(s),
      };
      if (draft.cites) logEvt.refs = draft.cites;
      deps.log(logEvt);
      onMinted?.(draft);
     },
     { kind: 'expedition-failed', detail: (_sn, err) => String(err) },
    );
    break; // At most ONE expedition per run
   }
  };

  // ── 6. Expedition minting: at most ONE per run ──
  let expeditionMinted = false;
  const composeExpedition = deps.composeExpedition;
  if (composeExpedition) {
   await runJob('expedition-failed', () => mintExpedition(
    (s, allEntries) => ({ eligible: isExpeditionCandidate(s, allReadings, allEntries, allSnippets), person: undefined }),
    (sn) => composeExpedition(sn, deps.complete, sittingFor(sn.provenance.session)),
    (s) => `minted expedition from snippet ${s.id}`,
    () => { expeditionMinted = true; },
   ));
  }

  // Other-minds fallback (ticket 113): the errand names a person to ask, but
  // it still spends the run's single expedition budget — tried only when the
  // regular expedition found nothing to mint.
  const composeOtherMindsExpedition = deps.composeOtherMindsExpedition;
  const gazetteerStore = deps.gazetteerStore;
  if (!expeditionMinted && composeOtherMindsExpedition && gazetteerStore) {
   await runJob('expedition-failed', () => mintExpedition(
    (s, allEntries) => {
     const c = isOtherMindsCandidate(s, allReadings, allEntries, allSnippets, gazetteerStore);
     return { eligible: c.eligible && Boolean(c.person), person: c.person };
    },
    (sn, person) => composeOtherMindsExpedition(sn, deps.complete, person!, sittingFor(sn.provenance.session)),
    (s) => `minted other-minds expedition from snippet ${s.id}`,
   ));
  }

  // ── 7. Referent annotations (ticket 074): newest snippets first ──
  // Guarded like the wiki jobs: a failure is one job's failure, and the
  // index, the minted questions, the expiry and the consolidation are
  // already on disk by the time this runs.
  let annotations: DocketReport['annotations'];
  const referentAnnotations = deps.referentAnnotations;
  if (referentAnnotations) {
   await runJob('referent-annotations-failed', async () => {
    annotations = await referentAnnotations();
   });
  }

  // ── 7a. Intention-horizon annotations (ticket 106): extract timelines ──
  // Guarded like the wiki jobs: a failure is one job's failure, and the
  // index, the minted questions, the expiry and the consolidation are
  // already on disk by the time this runs.
  const intentionHorizonAnnotations = deps.intentionHorizonAnnotations;
  if (intentionHorizonAnnotations) {
   await runJob('intention-horizons-failed', () => intentionHorizonAnnotations());
  }

  // ── 7b. Outcome questions (ticket 106): mint from past-horizon intentions ──
  // Guarded like the wiki jobs: a failure is one job's failure. Runs after
  // the intention-horizon annotation job so the annotations are fresh.
  const outcomeQuestionSweep = deps.outcomeQuestionSweep;
  if (outcomeQuestionSweep) {
   await runJob('outcomes-failed', () => outcomeQuestionSweep());
  }

  // ── 8. Piece work (010 T10): stale-pin sweep, then auto-set-down ──
  // piece jobs
  // Each guarded on its own: a failure in one is one job's failure, and the
  // other still runs. Neither job calls a model — zero-LLM by contract
  // (Q-39, Q-41).
  const stalePinSweep = deps.stalePinSweep;
  if (stalePinSweep) {
   await runJob('piece-jobs-failed', stalePinSweep, {
    sink: (_kind, err) => deps.log({ at: ts(), actor: 'clerk', kind: 'piece-jobs-failed', detail: `stale pin sweep: ${String(err)}` }),
   });
  }
  const dormancySweep = deps.dormancySweep;
  if (dormancySweep) {
   await runJob('piece-jobs-failed', dormancySweep, {
    sink: (_kind, err) => deps.log({ at: ts(), actor: 'clerk', kind: 'piece-jobs-failed', detail: `dormancy sweep: ${String(err)}` }),
   });
  }
  // end piece jobs

  // ── 8a. Composition gap sweep (redesign-2026-08-09 §7): the model notices
  // seams that do not hold ──
  // The second probation entry, guarded like every other job: a throw is
  // one job's failure, and the rest of the run is already on disk. It
  // follows the piece jobs because it reads the same store; it comes
  // before the other sweeps because its minting — when the person later
  // presses `ask this` — feeds the ordinary queue.
  const compositionGapSweep = deps.compositionGapSweep;
  if (compositionGapSweep) {
   await runJob('composition-gap-failed', () => compositionGapSweep());
  }



  // Territory gap-fill (ticket 094) — follows the ordinary gap-fill,
  // reads KTG skeleton coverage, mints frontier and failure questions.
  let territoryGapFill: DocketReport['territoryGapFill'];
  const territoryGapFillSweep = deps.territoryGapFillSweep;
  if (territoryGapFillSweep) {
   await runJob('territory-gap-fill-failed', async () => {
    territoryGapFill = await territoryGapFillSweep();
   });
  }

  // Atlas gap-fill (ticket 110) — follows the territory gap-fill,
  // reads atlas instrument coverage, shadow-logs candidate questions.
  // Shadow-first (Q-35): candidates are logged, never minted.
  // ZERO-LLM by design — the sweep is pure vault-and-coverage work.
  let atlasGapFill: DocketReport['atlasGapFill'];
  const atlasGapFillSweep = deps.atlasGapFillSweep;
  if (atlasGapFillSweep) {
   await runJob('atlas-gap-fill-failed', async () => {
    atlasGapFill = await atlasGapFillSweep();
   });
  }

  // Gazetteer extraction (ticket 100) — model-calling, extracts named
  // entities from snippets into the gazetteer store. Must run before the
  // frontier sweep so new entities are available for frontier detection.
  // Caps live at birth (Q-56); the thunk is guarded like the wiki jobs.
  let gazetteerExtraction: DocketReport['gazetteerExtraction'];
  const gazetteerExtractionJob = deps.gazetteerExtraction;
  if (gazetteerExtractionJob) {
   await runJob('gazetteer-extraction-failed', async () => {
    gazetteerExtraction = await gazetteerExtractionJob();
   });
  }

  // Gazetteer frontier (ticket 100) — ZERO-LLM, reads the entity index
  // against the queue's subjects, mints or shadow-logs frontier questions.
  // Must run after extraction so new entities are counted.
  let gazetteerFrontier: DocketReport['gazetteerFrontier'];
  const gazetteerFrontierJob = deps.gazetteerFrontier;
  if (gazetteerFrontierJob) {
   await runJob('gazetteer-frontier-failed', async () => {
    gazetteerFrontier = await gazetteerFrontierJob();
   });
  }

  // Lineage mirror (Q-83, ticket 112) — reads claims against lineage,
  // evaluates mirror candidates, mints juxtaposition-style questions.
  // Shadow-first (Q-35): candidates always logged; questions minted only
  // when the selection threshold graduates to live.
  let lineageMirror: DocketReport['lineageMirror'];
  const lineageMirrorSweep = deps.lineageMirrorSweep;
  if (lineageMirrorSweep) {
   await runJob('lineage-mirror-failed', async () => {
    lineageMirror = await lineageMirrorSweep();
   });
  }
 
  // Coach seed (Q-110 door 1): cluster claims → un-coached Directions.
  // ZERO-LLM: the thunk reads claims and clusters by content-word overlap.
  // Runs after lineage mirror and before tripwire — it is pure vault work
  // and does not touch any model.
  let coachSeed: DocketReport['coachSeed'];
  const coachSeedSweep = deps.coachSeedSweep;
  if (coachSeedSweep) {
   await runJob('coach-seed-failed', async () => {
    coachSeed = await coachSeedSweep();
   });
  }
 
  // Tripwire (Q-90, ticket 132) — reads the graduation ledger against the
  // guarded metrics and demotes a batch when the record has gone worse.
  // Guarded like every other job: a throw here must not cost the run, and
  // an instance that has graduated nothing has no ledger and no work.
  //
  // The one job whose failure does NOT reach `deps.log`. Every other line
  // in this run is about the person's own material and renders on the
  // Activity Log they read; this job is about mechanisms watching them, and
  // Q-83's never-mirrored class applied to the operator hat keeps the whole
  // record plane off that surface. The failure goes to the operator's
  // channel — the same stderr the docket's own deferral notice uses — and
  // `scripts/loop-status.ts` shows what the sweep did or did not do.
  const tripwireSweep = deps.tripwireSweep;
  if (tripwireSweep) {
   await runJob('tripwire-failed', tripwireSweep, {
    sink: (_kind, err) => {
     deps.log({ at: ts(), actor: 'clerk', kind: 'tripwire-failed', detail: String(err) });
     console.error(`tripwire sweep failed — the rest of the docket run is already on disk: ${String(err)}`);
    },
   });
  }

  // ── 10. The wiki jobs, last and guarded (ticket 023 item 2) ──
  // Last because every job above is the docket's own work and must not wait
  // on the slowest thing in the run; guarded because a wiki failure is one
  // job's failure. The index, the minted questions, the expiry and the
  // consolidation are already done and on disk by the time this runs, and
  // the report still carries all four when it throws.
  let wiki: DocketReport['wiki'];
  const runWikiJobs = deps.runWikiJobs;
  if (runWikiJobs) {
   await runJob('wiki-jobs-failed', async () => {
    wiki = await runWikiJobs();
   });
  }

  // ── 10a. Full-corpus embedding coverage (§12, Batch C3) ──
  // Runs after the wiki jobs (which prime the claim keyspace) and before the
  // neighborhoods pass (which reads the passage keyspace this job grows).
  // Guarded like every other job: a throw is one job's failure, and the
  // index, the minted questions and the expiry are already on disk by then.
  let coverageEmbedding: DocketReport['coverageEmbedding'];
  const coverageEmbeddingJob = deps.coverageEmbedding;
  if (coverageEmbeddingJob) {
   await runJob('coverage-embedding-failed', async () => {
    coverageEmbedding = await coverageEmbeddingJob();
   });
  }

  // ── 10b. Neighborhoods (§12.3): passages into themes, zero-LLM ──
  // Follows the wiki jobs — both write the derived wiki data the page reads.
  // Guarded like every other job: a throw is one job's failure, and the
  // index, the minted questions and the expiry are already on disk by then.
  let neighborhoods: DocketReport['neighborhoods'];
  const neighborhoodsJob = deps.neighborhoodsJob;
  if (neighborhoodsJob) {
   await runJob('neighborhoods-failed', async () => {
    neighborhoods = await neighborhoodsJob();
   });
  }

  // ── 10c. Context lines (Batch B2, §11): one line per passage without one ──
  // Follows the wiki and neighborhoods jobs — it reads the same passages and
  // writes the derived wiki store the page reads. Model-calling, capped per
  // run (contextLines.perRun, Q-56). Guarded like every other job: a throw
  // is one job's failure, and the index, the minted questions and the
  // expiry are already on disk by then.
  let contextLines: DocketReport['contextLines'];
  const runContextLines = deps.runContextLines;
  if (runContextLines) {
   await runJob('context-lines-failed', async () => {
    contextLines = await runContextLines();
   });
  }

  // ── 11. The import extraction, last and guarded (T6) ──
  // Last because it is the slowest thing in the run and no other job may
  // wait on it — the cost is paid before the person sits down (Q-58), and
  // nothing the docket owns must be pushed later than it already is.
  // Guarded because a throw is one job's failure: the index, the minted
  // questions and the expiry are already on disk by the time this runs,
  // and the report still carries all four when it throws.
  let imports: DocketReport['imports'];
  const runImportJobs = deps.runImportJobs;
  if (runImportJobs) {
   await runJob('import-run-failed', async () => {
    imports = await runImportJobs();
   });
  }

  // The run was cut short by the stop switch: say so, once, so the silence
  // of the skipped jobs is never unexplained.
  if (stopped()) {
   deps.log({ at: ts(), actor: 'clerk', kind: 'docket-cut-short', detail: 'jobs stopped mid-run — the remaining jobs wait for resume' });
  }

  return {
   reindexed: allSnippets.length,
   minted,
   expired,
   index,
   ...(wiki ? { wiki } : {}),
   ...(imports ? { imports } : {}),
   ...(annotations ? { annotations } : {}),
    ...(territoryGapFill ? { territoryGapFill } : {}),
   ...(gazetteerExtraction ? { gazetteerExtraction } : {}),
   ...(atlasGapFill ? { atlasGapFill } : {}),
   ...(gazetteerFrontier ? { gazetteerFrontier } : {}),
   ...(lineageMirror ? { lineageMirror } : {}),
   ...(coachSeed ? { coachSeed } : {}),
   ...(neighborhoods ? { neighborhoods } : {}),
   ...(coverageEmbedding ? { coverageEmbedding } : {}),
   ...(contextLines ? { contextLines } : {}),
  };
 } finally {
  running = false;
 }
}
