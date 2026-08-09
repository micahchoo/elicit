/**
 * The Clerk's boot-time construction (Wave C1, extracted from src/server.ts).
 *
 * `createClerk` owns the wiki machinery (Q-22) and the docket (ticket 047):
 * the claim store, registry, clash channels, lint state, the five docket
 * jobs' thunks, and the tripwire semantics (jobsStopped / pendingTrigger /
 * single-flight, ticket 151). What it hands back is exactly what the
 * server's routes touched before the extraction — startDocket, the stop
 * switch, the run-in-flight flag, the last lint findings, the sweep backlog
 * count, the drain scheduler, and the claim store the wiki routes read.
 *
 * The server keeps ONE seam: `setIndex`. A completed DocketReport used to
 * assign `currentIndex` and refill `snippetMap` inline; now it calls the
 * setter the server passes in, doing the same two writes.
 *
 * `profile` and `coachStore` are live server bindings (POST /api/profile
 * reassigns `profile`; the coach store is created further down createApp),
 * so they arrive as getters and are read when a sweep thunk RUNS — never
 * at construction.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex } from '../index/lexical.js';
import { runImportExtraction } from '../import/pipeline.js';
import type { ImportStore } from '../import/store.js';
import type { RegionStore } from '../import/region.js';
import type { PieceStore } from '../piece/contract.js';
import { profileFrameWords, type Profile } from '../profile.js';
import { appendEvent, type ActivityEvent } from '../log/activity.js';
import type { EventKind } from '../log/kinds.js';
import { nextConsolidation, saveSummary, loadSummaries } from '../memory/cover.js';
import type { CoachStore } from '../coach/store.js';
import type { AnnotationStore } from './annotation-store.js';
import type { GazetteerStore } from './gazetteer-store.js';
import { composeOpener, composeStillTrue, composeExpedition } from './composed.js';
import { judgeOpposition, composeRemeasure, judgeConfirmation } from './contradiction.js';
import { proposeOps } from './mint.js';
import {
 runDocket,
 runDormancySweep,
 runStalePinSweep,
 runReferentAnnotations,
 runIntentionHorizonAnnotations,
 runOutcomeQuestions,
 runCompositionGapSweep,
} from './docket.js';
import { runLineageMirrorSweep } from './lineage-mirror.js';
import { runContextLines } from './context-lines.js';
import { runCoachSeedSweep } from './coach-seed.js';
import { runGazetteerExtraction } from './gazetteer-extraction.js';
import { runGazetteerFrontier } from './gazetteer-frontier.js';
import { runLadderSummaries } from './sounding-summary.js';
import { runWikiJobs, DEFAULT_CLERK_MODEL } from './wiki-jobs.js';
import { fileSnippetVectorStore, runCoverageEmbedding } from '../index/semantic.js';
import { runNeighborhoodsJob } from '../wiki/neighborhoods.js';
import { runTerritoryGapFillSweep } from '../ktg/gap-fill.js';
import { loadKtgSkeleton, loadAtlas } from '../ktg/loader.js';
import { createCoverageStore, createAtlasCoverageStore } from '../ktg/coverage.js';
import { runAtlasGapFillSweep } from '../ktg/atlas-gap-fill.js';
import {
 createClaimStore,
 appendSweepDeferral,
 readSweepDeferral,
 writeStillTrueCursor,
 readStillTrueCursor,
 writeOutcomeCursor,
 readOutcomeCursor,
} from '../wiki/store.js';
import { THRESHOLDS, readNumber } from '../wiki/thresholds.js';
import { createRegistry } from '../wiki/registry.js';
import { isLive, lexicalChannel, referentChannel, poolCandidates, type ClashChannel } from '../wiki/clash.js';
import {
 embeddingChannel,
 fileEmbeddingStore,
 type Embed,
 type EmbeddingChannel,
} from '../wiki/embedding.js';
import { lint } from '../wiki/lint.js';
import { applyOps } from '../wiki/ops.js';
import type { ClaimGraph, ClaimStore, LintFinding, LogFn } from '../wiki/contract.js';
import type { Vault, Complete, QueueStore, LexicalIndex, DocketReport, Snippet } from '../types.js';

/**
 * What the server hands the Clerk at boot. `complete`/harvestComplete are
 * the CLERK's endpoints (Q-48) — nothing here may see the foreground model.
 */
export interface ClerkBootDeps {
 vault: Vault;
 queue: QueueStore;
 /** The clerk's Complete — everything with nobody waiting on it (Q-48). */
 complete: Complete;
 /** The clerk model's stamp; undefined when one model does both jobs. */
 modelName: string | undefined;
 vaultRoot: string;
 /** The embedding channel's model endpoint; absent is the cold state. */
 embed?: { embed: Embed; model: string };
 /** The resolved-referent annotation store (ticket 074). Absent = no annotation jobs. */
 annotations?: AnnotationStore;
 /** The gazetteer entity index store (ticket 100). Absent = no extraction/frontier jobs. */
 gazetteerStore?: GazetteerStore;
 /** Called when a docket run settles, whatever it did (ticket 075's chain). */
 onDocketSettled?: () => void;
 /** The harvest cuts endpoint (ticket 078) — the import extraction's Complete. */
 harvestComplete: Complete;
 importStore: ImportStore;
 regionStore: RegionStore;
 pieces: PieceStore;
 /** Live server bindings. POST /api/profile reassigns `profile`; the coach store is created later in createApp — read them when a thunk runs, not at boot. */
 profile: () => Profile;
 coachStore: () => CoachStore;
 serverEmit: (root: string, actor: ActivityEvent['actor'], eventKind: EventKind, detail: string, refs?: string[]) => void;
 /**
  * NOTE: the kind parameter is named `eventKind` in this type on purpose —
  * the emitted-kinds sweep (tests/emitted-kinds.ts) reads `kind:` property
  * tokens, and a bare `kind:` in an interface arrow-type has no enclosing
  * function head to mark it a declaration, so it would register as an
  * unreadable emit. The sweep finds the wrapper from server.ts's real
  * serverEmit declaration (param index 2) and reads call args by position,
  * so the annotation's param name is invisible to it.
 */
 listSessions: (root: string) => { session: string; started: string; turnCount: number; chars: number }[];
 readTranscript: (root: string, session: string) => string;
 /**
  * The ONE server seam: a completed DocketReport replaces the index every
  * handler reads and refills the snippet map — exactly what the old
  * runDocketNow completion did inline.
  */
 setIndex: (lexical: LexicalIndex, snippets: Record<string, Snippet>) => void;
}

/**
 * What the server's routes reach the docket through. `jobsStopped`,
 * `docketRunning` and `lastLint` are LIVE accessors: reading them observes
 * the run in flight, and assigning `jobsStopped` flips the tripwire (POST
 * /api/jobs/stop, ticket 151). Destructuring would snapshot them, so call
 * sites keep `clerk.X`.
 */
export interface ClerkHandles {
 startDocket(trigger: string): void;
 jobsStopped: boolean;
 docketRunning: boolean;
 lastLint: { findings: LintFinding[]; at: string } | null;
 sweepWorkRemaining(): { pending: number; fresh: number; clipped: boolean };
 scheduleDrain(): void;
 claimStore: ClaimStore;
}
export function createClerk(deps: ClerkBootDeps): ClerkHandles {
 // The bindings the block used to close over as server-scope consts, named
 // the same so the moved wiring reads verbatim. profile/coachStore arrive
 // as getters (see ClerkBootDeps) and are read at thunk-call time.
 const clerkComplete = deps.complete;
 const clerkModelName = deps.modelName;
 const { harvestComplete, importStore, regionStore, pieces, serverEmit, listSessions, readTranscript, setIndex, profile, coachStore } = deps;

 // ── The Clerk's wiki work, constructed once (Q-22) ──
 //
 // The log sink below is the point of this block. Until it existed, every
 // `shadow-decision`, `threshold-clipped`, `clash-referent-clipped` and
 // `clash-embedding-clipped` was written into whatever a caller passed, and
 // in production there was no caller — so Q-35, which graduates a mechanism
 // on its shadow record, and Q-56, which makes a bound owe its clip record,
 // were both waiting on evidence that reached nowhere. It is the SAME
 // `appendEvent` the docket writes through, because Q-23 makes one audit
 // trail and a second one would be a second answer to "what did it do".
 const wikiLog: LogFn = (e) => appendEvent(deps.vaultRoot, e as ActivityEvent);

 // The Q-34 stamp for everything the wiki work writes. `bonsai-27b` is the
 // ELICITOR (Q-48); this is the careful model, and the registry and the
 // claims must carry one and the same name or the record cannot be read.
 const wikiModel = clerkModelName ?? DEFAULT_CLERK_MODEL;
 const claimStore = createClaimStore(deps.vaultRoot);
 // The still-true rotation cursor (ticket 075), disk-backed so rotation
 // survives restarts. The docket keeps an in-memory default for standalone
 // callers; production goes through the wiki dir like every other ledger.
 const stillTrueCursor = {
  read: () => readStillTrueCursor(deps.vaultRoot),
  write: (offset: number) => writeStillTrueCursor(deps.vaultRoot, offset),
 };
// The outcome-question rotation cursor (ticket 106), disk-backed so
// rotation survives restarts. Same pattern as the still-true cursor.
const outcomeCursor = {
  read: () => readOutcomeCursor(deps.vaultRoot),
  write: (offset: number) => writeOutcomeCursor(deps.vaultRoot, offset),
};
// The composition gap sweep's rotation cursor (redesign-2026-08-09 §7):
// in-memory, so a restart forgets rotation — acceptable, because the
// entries-dedupe (a stored gap blocks a re-find) prevents the advance-on-
// null wedge the disk cursors exist for; the cursor only spreads the
// sweep's model calls across compositions.
let compositionCursorOffset = 0;
const compositionCursor = {
  read: () => compositionCursorOffset,
  write: (offset: number) => {
    compositionCursorOffset = offset;
  },
};
 const registry = createRegistry(claimStore, wikiModel, wikiLog);

 const embedding: EmbeddingChannel | null = deps.embed
  ? embeddingChannel({
   embed: deps.embed.embed,
   model: deps.embed.model,
   store: fileEmbeddingStore(deps.vaultRoot),
   log: wikiLog,
  })
  : null;
 const channels: ClashChannel[] = [lexicalChannel, referentChannel(registry, { log: wikiLog })];
 if (embedding) channels.push(embedding);

 /**
  * The lint findings of the LAST completed wiki run, and when it ran.
  *
  * `GET /api/wiki` reports these rather than calling `lint` itself, and the
  * reason is `shadowDecision`: two of lint's three rules are shadowed (Q-35),
  * so every call writes `shadow-decision` events. Linting on a read path would
  * therefore fill the graduation record with one entry per page view — the
  * same corruption as building a second Registry over one vault, arriving
  * through a different door. Freshness costs nothing here: claims change only
  * during a wiki run, so between runs these findings and the claims on disk
  * are exactly as consistent as they were when the run ended.
  *
  * `null` until the first run completes, and the route says so. "Looked and
  * found nothing" must not render as "never looked" (eval finding #8).
  */
 let lastLint: { findings: LintFinding[]; at: string } | null = null;

 /** One wiki run, with its collaborators already bound. Never on a response path. */
 async function runWikiJobsNow(): Promise<DocketReport['wiki']> {
  // `prime` is the async half `ClashChannel` cannot express, and it MUST run
  // before the pool: `candidates()` is cache-only, so an unprimed channel
  // answers from whatever is on disk and returns a correct-looking zero. The
  // failure is silent, which is why the call is here rather than left to a
  // reader of the deps object to remember.
  if (embedding) {
   const contents = deps.vault.rebuildIndex();
   const graph: ClaimGraph = {
    ...claimStore.loadSlice(),
    snippets: contents.snippets,
    readings: contents.readings,
   };
   await embedding.prime(graph);
  }

  const report = await runWikiJobs({
   store: claimStore,
   registry,
   queue: deps.queue,
   vault: deps.vault,
   complete: clerkComplete,
   channels,
   proposeOps,
   applyOps,
   lint,
   poolCandidates,
   judgeOpposition,
   composeRemeasure,
   judgeConfirmation,
   composeStillTrue,
   log: wikiLog,
   model: wikiModel,
   vaultRoot: deps.vaultRoot,
  });
  lastLint = { findings: report.lint, at: new Date().toISOString() };
  return report;
 }

/** One import extraction run — the real harvest path, ahead of review (Q-58). */
async function runImportJobsNow(): Promise<{ extracted: number; remaining: number; failed: number }> {
 return runImportExtraction({
  store: importStore,
  // The authorship seam (014 T7): a record whose source path sits inside a
  // declared region gets the region's prompt clause and stance guard. It was
  // inert until this line — an optional parameter no caller passes.
  regionFor: (p) => regionStore.regionFor(p),
  // Extraction IS the harvest path, so it rides the grammar-constrained
  // clerk variant the harvest does (ticket 078).
  complete: harvestComplete,
  readSource: (p) => readFileSync(p, 'utf-8'),
  log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
 });
}

// ── The docket, off the response path (ticket 047) ──
 // Opener minting is one LLM call per uncited snippet, so a docket run grows
 // with the vault. No request waits for one: handlers write to the vault,
 // answer, and the index catches up when the run finishes.

 /** True while a run is in flight. Two runs never overlap. */
 let docketRunning = false;
 /** A trigger that arrived mid-run, replayed once the run finishes. */
 let pendingTrigger: string | null = null;
 /**
  * The stop switch (POST /api/jobs/stop, ticket 151): while true, runDocket
  * reads it between jobs and between per-snippet model calls, so the run in
  * flight finishes its current call and skips everything that remains. It
  * gates NEW runs too (drain, import re-trigger, boot) — see the guard
  * added to startDocket. Cleared by POST /api/jobs/resume or a restart.
  */
 let jobsStopped = false;

 async function runDocketNow(trigger: string): Promise<void> {
  // The import job's counts, seen in the finally for the re-trigger. Hoisted
  // because the finally runs whether the run succeeded or failed.
  let importReport: { extracted: number; remaining: number; failed: number } | undefined;
  // Captured as a const so the closure below narrows it: a property access
  // (deps.annotations) does not keep its narrowing inside an arrow function.
  const annotations = deps.annotations;
  const gazetteerStore = deps.gazetteerStore;
  const embed = deps.embed;
  try {
   const report = await runDocket({
    vault: deps.vault,
    queue: deps.queue,
    complete: clerkComplete,
    buildIndex: (snippets) => buildIndex(snippets),
    composeOpener,
    composeExpedition,
    listSessions,
    nextConsolidation,
    saveSummary,
    loadSummaries,
    readTranscript,
    // The ladder summaries (012 T11): the docket calls the job with its own
    // vaultRoot/complete/modelName/log, so the server only hands the
    // function across. Guarded inside runDocket — a throw is one job's
    // failure and does not fail the run.
    runLadderSummaries,
    // Cover summaries are written by the clerk model, so they say so (Q-34).
    ...(clerkModelName ? { modelName: clerkModelName } : {}),
    log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    // The stop switch (POST /api/jobs/stop, ticket 151): read between jobs
    // and between per-snippet model calls. A run cannot abort a model call
    // mid-air; the call in flight finishes, then everything remaining is
    // skipped and the run settles (docket-cut-short).
    shouldStop: () => jobsStopped,
    runWikiJobs: runWikiJobsNow,
    stalePinSweep: () => runStalePinSweep({
     pieces,
     snippets: () => deps.vault.rebuildIndex().snippets,
     log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    }),
    dormancySweep: () => runDormancySweep({
     pieces,
     snippets: () => deps.vault.rebuildIndex().snippets,
     log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    }),
    // The composition gap sweep (redesign-2026-08-09 §7, §10): the second
    // probation entry — the clerk notices seams that do not hold, capped at
    // piece.gapsPerPass distinct kinds per composition per run, and the
    // sweep stores model-placed gaps (pending text, never minted — `ask
    // this` mints, Q-39). The floor is named: every gap placed by hand; a
    // found gap that survives ask-this → answered → placed is the
    // fingerprint that saves it. Model-placed gaps expire faster (3
    // sittings) inside the sweep.
    compositionGapSweep: () => runCompositionGapSweep({
     pieces,
     snippets: () => deps.vault.rebuildIndex().snippets,
     queue: deps.queue,
     complete: clerkComplete,
     modelName: clerkModelName ?? DEFAULT_CLERK_MODEL,
     log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
     cursor: compositionCursor,
    }),
    // Ticket 074: resolved-referent annotation, one model call per
    // candidate (the cap bounds model calls, not successes). Injected
    // only when the server carries the store, so an absent store means
    // no annotation job at all — the pre-ticket docket.
    ...(annotations
     ? {
      referentAnnotations: () => runReferentAnnotations({
       snippets: () => deps.vault.rebuildIndex().snippets,
       annotations,
       complete: clerkComplete,
       modelName: clerkModelName ?? DEFAULT_CLERK_MODEL,
       log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
      }),
     }
     : {}),
    // Ticket 106: intention-horizon annotations — extract timelines from
    // intention-facet readings, capped at HORIZON_RUN_CAP per run.
    ...(annotations
     ? {
      intentionHorizonAnnotations: () => runIntentionHorizonAnnotations({
       vault: deps.vault,
       annotations,
       complete: clerkComplete,
       modelName: clerkModelName ?? DEFAULT_CLERK_MODEL,
       queue: deps.queue,
       log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
      }),
     }
     : {}),
    // Ticket 106: outcome-question sweep — mints "did it happen?" questions
    // from past-horizon intentions, capped at OUTCOME_RUN_CAP per run.
    ...(annotations
     ? {
      outcomeQuestionSweep: () => runOutcomeQuestions({
       annotations,
       queue: deps.queue,
       complete: clerkComplete,
       vault: deps.vault,
       log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
       vaultRoot: deps.vaultRoot,
       outcomeCursor,
      }),
     }
     : {}),
    territoryGapFillSweep: () => {
     // Enumerate data/ktg/*.json like the atlas twin, so a new skeleton
     // added to the data dir feeds the sweep — the pre-Phase-8 thunk
     // hard-coded one slug ('fake-craft') and silently skipped everything else.
     const ktgDir = join(deps.vaultRoot, 'data', 'ktg');
     let totalMinted = 0;
     let totalFrontier = 0;
     let totalFailure = 0;

     let files: string[];
     try {
      files = readdirSync(ktgDir).filter((f) => f.endsWith('.json'));
     } catch {
      return Promise.resolve({ minted: 0, frontierQuestions: 0, failureQuestions: 0 });
     }

     for (const file of files) {
      const domain = file.replace('.json', '');
      const skel = loadKtgSkeleton(domain, deps.vaultRoot);
      if (!skel.ok) continue;

      const coverage = createCoverageStore(deps.vaultRoot);
      const result = runTerritoryGapFillSweep({
       skeleton: skel.value,
       coverage,
       queue: deps.queue,
       log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
       now: new Date().toISOString(),
      });
      totalMinted += result.minted;
      totalFrontier += result.frontierQuestions;
      totalFailure += result.failureQuestions;
     }

     return Promise.resolve({ minted: totalMinted, frontierQuestions: totalFrontier, failureQuestions: totalFailure });
    },
    atlasGapFillSweep: () => {
     const atlasDir = join(deps.vaultRoot, 'data', 'atlases');
     let totalCandidates = 0;
     let totalScanned = 0;
     let totalMinted = 0;

     let files: string[];
     try {
      files = readdirSync(atlasDir).filter((f) => f.endsWith('.json'));
     } catch {
      return Promise.resolve({ candidateCount: 0, scanned: 0, minted: 0 });
     }

     for (const file of files) {
      const instrument = file.replace('.json', '');
      const atlas = loadAtlas(instrument, deps.vaultRoot);
      if (!atlas.ok) continue;

      const coverage = createAtlasCoverageStore(deps.vaultRoot);
      const result = runAtlasGapFillSweep({
       atlas: atlas.value,
       coverage,
       queue: deps.queue,
       log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
       now: new Date().toISOString(),
       shadowMode: false, // graduated 2026-08-03 (Micah) — mints, cap live
      });

      totalCandidates += result.candidateCount;
      totalScanned += result.scanned;
      totalMinted += result.minted;
     }

     return Promise.resolve({ candidateCount: totalCandidates, scanned: totalScanned, minted: totalMinted });
    },
    // Ticket 112: the lineage mirror sweep (Q-83) — reads claims against
    // lineage, shadow-first. Archived and superseded claims are excluded: a
    // claim no longer current has no divergence to probe.
    lineageMirrorSweep: runLineageMirrorSweep({
     vaultRoot: deps.vaultRoot,
     listClaims: () => claimStore.loadSlice().claims.filter(isLive),
     complete: clerkComplete,
     queue: deps.queue,
     log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
     }),
     // Q-110 door 1: cluster wiki claims → un-coached DirectionRecords.
     // ZERO-LLM — the thunk never receives the Complete. Clustering is
     // simple content-word overlap; every evaluation logs cluster sizes
     // (Q-111). Themes with 3+ claims (Q-111 threshold, no distinct-
     // sitting requirement) mint an un-coached DirectionRecord.
     coachSeedSweep: () => runCoachSeedSweep({
      claimStore,
      coachStore: coachStore(),
      frameWords: profileFrameWords(profile()),
      log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    }),
    // §12 (Batch C3): the full-corpus embedding coverage pass — rebuild the
    // semantic channel over the CURRENT corpus and prime it to coverage, so
    // every passage gets a vector and the run logs the coverage sentence.
    // Runs before the neighborhoods job, which reads the store this grows.
    // Wired only when an embedder exists; the cold state is no pass at all.
    ...(embed
     ? {
      coverageEmbedding: () => runCoverageEmbedding({
       corpus: Object.values(deps.vault.rebuildIndex().snippets),
       embed: embed.embed,
       model: embed.model,
       store: fileSnippetVectorStore(deps.vaultRoot),
       log: wikiLog,
      }),
     }
     : {}),
    // §12.3 neighborhoods (Batch C1): passages into themes, zero-LLM. Reads
    // the whole corpus + the snippet-vector store (primed by the semantic
    // channel, grown by C3's coverage job); the model name decides whether
    // the embedding channel is even on — absent means lexical by construction.
    neighborhoodsJob: () => runNeighborhoodsJob({
      vaultRoot: deps.vaultRoot,
      log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
      snippets: Object.values(deps.vault.rebuildIndex().snippets),
      ...(deps.embed ? { model: deps.embed.model } : {}),
    }),
    // Batch B2 (§11): one context line per passage without one. Model-
    // calling, capped per run (contextLines.perRun, Q-56); every run logs
    // its coverage (composed/skipped) — the §12 debt, paid as a sentence.
    runContextLines: () => runContextLines({
     vault: deps.vault,
     vaultRoot: deps.vaultRoot,
     complete: clerkComplete,
     modelName: clerkModelName ?? DEFAULT_CLERK_MODEL,
     readTranscript,
     log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    }),
    gazetteerExtraction: () => {
      if (!gazetteerStore) return Promise.resolve({ extracted: 0, entities: 0, failed: 0 });
      // The sweep lives in src/clerk/gazetteer-extraction.ts; the wiring
      // only binds its deps.
      return runGazetteerExtraction({
        vault: deps.vault,
        store: gazetteerStore,
        complete: clerkComplete,
        modelName: clerkModelName ?? 'default',
        log: (e) => appendEvent(deps.vaultRoot, e),
      });
    },
    gazetteerFrontier: () => {
     if (!gazetteerStore) return Promise.resolve({ minted: 0, frontierEntities: 0 });
     return Promise.resolve(runGazetteerFrontier({
      store: gazetteerStore,
      queue: deps.queue,
      log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
      now: new Date().toISOString(),
      shadowMode: false, // graduated 2026-08-03 (Micah) — mints, cap live
     }));
    },
    runImportJobs: runImportJobsNow,
    vaultRoot: deps.vaultRoot,
   });
   setIndex(report.index, deps.vault.rebuildIndex().snippets);
   if (report.imports) {
    importReport = report.imports;
    serverEmit(deps.vaultRoot, 'clerk', 'import-run', 'extracted=' + report.imports.extracted + ' remaining=' + report.imports.remaining + ' failed=' + report.imports.failed);
   }
   serverEmit(deps.vaultRoot, 'clerk', 'docket-run', `minted ${report.minted.length}, expired ${report.expired}`);

   // Ticket 075 — the drain bookkeeping. The clip record says "left for the
   // next run"; this is the machinery that makes the next run happen. The
   // deferral is a claimable record on disk (the Codex precedent), and the
   // chain is bounded by the backlog emptying. A FAILED run (the catch below)
   // appends no deferral line and schedules no drain — the ledger
   // distinguishes "found nothing" from "mechanism broken". This whole block
   // is wrapped in its own try/catch so it can never turn a successful run
   // into a failure.
   try {
    const previous = readSweepDeferral(deps.vaultRoot); // read BEFORE appending
    const { pending, fresh } = sweepWorkRemaining();
    if (pending > 0) {
     appendSweepDeferral(deps.vaultRoot, pending);
     // Ticket 139: schedule a drain whenever fresh pending readings exist,
     // no clipped/previous gates — the chain is self-limiting: it stops when
     // pending reaches zero or every reading is stuck at backoff.
     if (fresh > 0) {
      scheduleDrain();
     }
    } else if ((previous?.remaining ?? 0) > 0) {
     // Terminal claim — succeeded-no-output: the drain found nothing left.
     appendSweepDeferral(deps.vaultRoot, 0);
    }
   } catch (err) {
    console.error('docket drain bookkeeping failed:', String(err));
   }
  } catch (err) {
   // Every write the run was meant to follow is already on disk. Only the
   // index is behind, so keep the one that was standing and say why.
   console.error(`docket (${trigger}) failed — held index unchanged:`, String(err));
   serverEmit(deps.vaultRoot, 'clerk', 'docket-run-failed', `trigger=${trigger} ${String(err)}`);
  } finally {
   docketRunning = false;
   const next = pendingTrigger;
   pendingTrigger = null;
   if (next) startDocket(next);
   // Q-56 loop guard: a run that extracted nothing must not re-trigger
   // forever — if the items keep failing, re-running burns the GPU on work
   // that will keep failing, so both conditions must hold. If the
   // pendingTrigger replay above already re-armed docketRunning, this call
   // defers via pendingTrigger — the later trigger wins, which is the
   // correct shape for a queue that keeps growing.
   if (importReport && importReport.remaining > 0 && importReport.extracted > 0) {
    startDocket('import');
   }
   deps.onDocketSettled?.();
  }
 }

 /** Start a docket run behind whatever called this. Never throws, never waits. */
 function startDocket(trigger: string): void {
  // The stop switch gates NEW runs (ticket 151): a stopped server must not
  // start the drain chain, an import re-trigger, or a boot run. The run in
  // flight finishes — runDocket reads the switch between its own jobs.
  if (jobsStopped) {
   console.error(`docket (${trigger}) not started — jobs are stopped (POST /api/jobs/resume to start again)`);
   return;
  }
  if (docketRunning) {
   // A second trigger starts nothing — runDocket's own lock would make it a
   // no-op anyway, and that no-op returns an empty index. Remember it
   // instead, so snippets harvested mid-run still reach the index.
   pendingTrigger = trigger;
   console.error(`docket (${trigger}) deferred — a run is already in flight`);
   return;
  }
  docketRunning = true;
  // Next tick, not this one: runDocket reads every snippet file in the vault
  // before its first await, and the response (or the listen call) goes first.
  // The catch is the backstop: nothing here is awaited, so a throw that got
  // past runDocketNow would surface as an unhandled rejection.
  setImmediate(() => {
   runDocketNow(trigger).catch((err: unknown) => {
    console.error(`docket (${trigger}) could not report its own failure:`, String(err));
   });
  });
 }

 // ── The sweep drain (ticket 075) ──
 //
 // `left for the next run` promised a run nothing scheduled. When a settle
 // leaves sweep work, the deferral records it (a claimable record on disk, the
 // Codex precedent) and this timer starts the next run itself — startDocket's
 // single-flight and pendingTrigger already serialize it. The chain is bounded
 // by the backlog emptying, never by a count.
 let drainTimer: ReturnType<typeof setTimeout> | null = null;

 /** The self-triggered drain's delay; tests shorten it via env. */
 function drainDelayMs(): number {
  const raw = Number(process.env.ELICIT_DOCKET_DRAIN_DELAY_MS ?? 2000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2000;
 }

 function scheduleDrain(): void {
  if (drainTimer !== null) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
   drainTimer = null;
   startDocket('drain');
  }, drainDelayMs());
 }

 /**
  * The sweep backlog as a settle left it, counted exactly as jobSweep counts
  * it (src/clerk/wiki-jobs.ts): pending readings are the ones no sweep line
  * covered, fresh are those still below the attempts backoff, and clipped is
  * whether one more run's quota could not take them all.
  */
 function sweepWorkRemaining(): { pending: number; fresh: number; clipped: boolean } {
  const backoff = readNumber(THRESHOLDS['sweep.attemptsBeforeBackoff'], 0);
  const quota = readNumber(THRESHOLDS['mint.callsPerRun'], 0);
  const swept = claimStore.sweptReadingIds();
  const attempts = claimStore.attemptCounts();
  const pending = Object.values(deps.vault.rebuildIndex().readings).filter((r) => !swept.has(r.id));
  const fresh = pending.filter((r) => (attempts.get(r.id) ?? 0) < backoff);
  const ordered = fresh.length + (pending.length - fresh.length);
  return {
   pending: pending.length,
   fresh: fresh.length,
   clipped: ordered > quota,
  };
 }

 return {
  startDocket,
  get jobsStopped(): boolean { return jobsStopped; },
  set jobsStopped(v: boolean) { jobsStopped = v; },
  get docketRunning(): boolean { return docketRunning; },
  get lastLint(): { findings: LintFinding[]; at: string } | null { return lastLint; },
  sweepWorkRemaining,
  scheduleDrain,
  claimStore,
 };
}
