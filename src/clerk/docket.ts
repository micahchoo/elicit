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
import { isExpeditionCandidate } from './composed.js';
import { readSitting, sittingCache } from './sitting.js';
import { stalePins } from '../piece/stale.js';
import { isDormant } from '../piece/dormancy.js';
import { THRESHOLDS } from '../wiki/thresholds.js';
import type { Piece, PieceStore } from '../piece/contract.js';
import { annotateReferent } from './annotate.js';
import type { AnnotationStore } from './annotation-store.js';

// ── Structural types from cover.ts contract (Task 4c) ──
// NOT imported — docket injects these structurally per the plan.
type SessionRef = { session: string; started: string; turnCount: number; chars: number };
type RangeSummary = { sessions: string[]; line: string; model: string; at: string };

// ── In-process lock ──
let running = false;

// ── Still-true rotation cursor (ticket 075) ──
// The default is in-memory: standalone callers get rotation within one
// process. The server injects a disk-backed cursor (src/server.ts), which
// is what makes rotation survive restarts.
let stillTrueOffset = 0;
const DEFAULT_STILL_TRUE_CURSOR = {
 read: (): number => stillTrueOffset,
 write: (offset: number): void => { stillTrueOffset = offset; },
};

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
 * moved on, written as Marginalia on the Piece's CURRENT arrangement. The
 * consequence of a stale pin is a dimmed note, never a re-pin — this job
 * has no write path for pins. Findings are deduped by `(on, note)` against
 * what is already on disk, so a second run writes nothing; the count
 * returned is the number of NEW Marginalia written this run.
 */
export async function runStalePinSweep(deps: {
 pieces: PieceStore;
 snippets: () => Record<string, Snippet>;
 log: PieceLog;
}): Promise<number> {
 const snippets = deps.snippets();
 let flagged = 0;
 for (const piece of deps.pieces.list()) {
  const current = piece.arrangements.find((a) => a.id === piece.current);
  if (current === undefined) continue;
  const onDisk = new Set(current.marginalia.map((m) => `${m.on}\u0000${m.note}`));
  const findings = stalePins(current, snippets).filter((m) => !onDisk.has(`${m.on}\u0000${m.note}`));
  if (findings.length === 0) continue;
  deps.pieces.putArrangement(piece.id, { ...current, marginalia: [...current.marginalia, ...findings] });
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
 * Piece's `created`, its CURRENT arrangement's `created`, and the `captured`
 * of every pin in that arrangement — the draft is what the person touches;
 * candidate arrangements are proposals, not touches. The activity log is
 * deliberately NOT consulted: it is evidence, not a dependency, and a job
 * that fails when the log is unreadable is a job that stops the Docket.
 */
export async function runDormancySweep(deps: {
 pieces: PieceStore;
 snippets: () => Record<string, Snippet>;
 log: PieceLog;
}): Promise<number> {
 const daysEntry = THRESHOLDS['piece.dormancyDays'];
 const days = typeof daysEntry.value === 'number' ? daysEntry.value : 45;
 const snippets = deps.snippets();
 const now = Date.now();
 let setDown = 0;
 for (const piece of deps.pieces.list()) {
  const current = piece.arrangements.find((a) => a.id === piece.current);
  const touched: string[] = [piece.created];
  if (current !== undefined) {
   touched.push(current.created);
   for (const entry of current.entries) {
    if (entry.kind !== 'pin') continue;
    const s = snippets[entry.snippet];
    if (s !== undefined) touched.push(s.captured);
   }
  }
  const lastTouched = touched.sort().at(-1) ?? piece.created;
  if (!isDormant(piece, lastTouched, now, days)) continue;
  deps.pieces.setDown(piece.id, 'dormancy');
  setDown++;
  deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'piece-set-down-auto', detail: `piece=${piece.id}` });
 }
 return setDown;
}

// ── The referent annotation job (ticket 074) ──
// At most one model call per candidate snippet: annotateReferent names what
// a dangling referent points at, or stays silent. Annotations are derived
// agent prose — re-annotation overwrites, never appends — and a new snippet
// version is new text, so a version-stale record is re-asked. Silence IS
// persisted — a snippet the model already judged is never re-asked — but
// the rendering shows nothing for it. The cap bounds model calls per run,
// not successes.

/** The most snippets one run may ask the model about (ticket 074). */
const ANNOTATION_RUN_CAP = 5;

/**
 * The referent annotation job (ticket 074): at most `cap` candidates,
 * newest captured first, each missing a record or carrying a version-stale
 * one. The stamp (model + modelAt) comes FROM annotateReferent's result —
 * the annotation is composed and stamped at the moment the answer is
 * accepted (Q-34); this job persists it as-is and never re-stamps. A model
 * failure is a counted failure, never a silence (the annotation module
 * throws rather than confusing the two, and this job records the throw).
 */
export async function runReferentAnnotations(deps: {
 snippets: () => Record<string, Snippet>;
 annotations: AnnotationStore;
 complete: Complete;
 modelName: string;
 log: PieceLog;
 cap?: number;
}): Promise<{ annotated: number; silent: number; failed: number }> {
 const cap = deps.cap ?? ANNOTATION_RUN_CAP;
 const candidates = Object.values(deps.snippets())
  .sort((a, b) => b.captured.localeCompare(a.captured))
  .filter((s) => {
   const rec = deps.annotations.get(s.id);
   return rec === null || rec.version !== s.version;
  });
 let annotated = 0;
 let silent = 0;
 let failed = 0;
 for (const snippet of candidates.slice(0, cap)) {
  try {
   const result = await annotateReferent({ snippet, model: deps.modelName }, deps.complete);
   if (result.kind === 'annotation') {
    deps.annotations.put({
     kind: 'annotation',
     snippetId: result.annotation.snippetId,
     version: result.annotation.version,
     expression: result.annotation.expression,
     referent: result.annotation.referent,
     model: result.annotation.model,
     modelAt: result.annotation.modelAt,
    });
    annotated++;
   } else {
    deps.annotations.put({
     kind: 'silence',
     snippetId: snippet.id,
     version: snippet.version,
     model: deps.modelName,
     modelAt: new Date().toISOString(),
    });
    silent++;
   }
  } catch (err) {
   failed++;
   deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'referent-annotation-failed', detail: `annotateReferent for snippet ${snippet.id} failed: ${String(err)}` });
  }
 }
 deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'referent-annotated', detail: `annotated=${annotated} silent=${silent} failed=${failed}` });
 return { annotated, silent, failed };
}

export async function runDocket(deps: {
 vault: Vault;
 queue: QueueStore;
 complete: Complete;
 buildIndex: (snippets: Snippet[]) => LexicalIndex;
 composeOpener: (s: Snippet, c: Complete, sitting?: SittingContext) => Promise<QueueDraft | null>;
 composeStillTrue: (s: Snippet, c: Complete, sitting?: SittingContext) => Promise<QueueDraft | null>;
 composeExpedition?: (s: Snippet, c: Complete, sitting?: SittingContext) => Promise<QueueDraft | null>;
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
 * The referent annotation job (ticket 074), as the docket's seventh job of
 * a run. Absent means no annotation work this run, and every caller
 * predating the field behaves exactly as before. The server injects it
 * with the annotation store and the Clerk's complete bound.
 */
referentAnnotations?: () => Promise<{ annotated: number; silent: number; failed: number }>;
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
  * The still-true rotation cursor (ticket 075) — the count of old snippets
  * already offered, so consecutive runs propose different snippets even
  * when composeStillTrue keeps returning null. The default rotates in
  * memory; the server injects a disk-backed cursor.
  */
 stillTrueCursor?: { read: () => number; write: (offset: number) => void };
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

  // ── Log: run started ──
  deps.log({ at: ts(), actor: 'clerk', kind: 'run-started', detail: 'docket run started' });

  // ── 1. Rebuild index from ALL snippets ──
  const rebuildResult = deps.vault.rebuildIndex();
  const allSnippets = Object.values(rebuildResult.snippets);
  const allReadings = rebuildResult.readings;
  const index = deps.buildIndex(allSnippets);
  deps.log({ at: ts(), actor: 'clerk', kind: 'index-rebuilt', detail: `rebuilt index from ${allSnippets.length} snippets` });

  const minted: QueueEntry[] = [];

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
  let openerCount = 0;
  if (sessions) {
   const recentSessionIds = new Set(sessions.slice(0, 2).map(s => s.session));

   const allEntries = deps.queue.list();
   const citedIds = new Set<string>();
   for (const e of allEntries) {
    for (const cite of e.cites ?? []) {
     const [snippetId] = cite.split('@');
     if (snippetId) citedIds.add(snippetId);
    }
   }

   const candidates = allSnippets.filter(s =>
    recentSessionIds.has(s.provenance.session) && !citedIds.has(s.id),
   );

   const openerRefs: string[] = [];
   for (const s of candidates) {
    try {
     const draft = await deps.composeOpener(s, deps.complete, sittingFor(s.provenance.session));
     if (draft) {
      const entry = deps.queue.add(draft);
      minted.push(entry);
      openerCount++;
      if (draft.cites) openerRefs.push(...draft.cites);
     }
    } catch (err) {
     deps.log({ at: ts(), actor: 'clerk', kind: 'opener-failed', detail: `composeOpener for snippet ${s.id} failed: ${String(err)}` });
    }
   }

   const evt: { at: string; actor: string; kind: string; detail: string; refs?: string[] } = {
    at: ts(), actor: 'clerk', kind: 'opener-minted',
    detail: `minted ${openerCount} openers`,
   };
   if (openerRefs.length > 0) evt.refs = openerRefs;
   deps.log(evt);
  }

  // ── 3. Still-true minting: snippets captured > 90 days, quota 2 ──
  const ninetyDaysMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let stillTrueCount = 0;
  const oldSnippets = allSnippets.filter(s => new Date(s.captured).getTime() < ninetyDaysMs);
  // Rotate (ticket 075): take up to 2 old snippets starting at the cursor,
  // wrapping modulo, so consecutive runs propose different candidates even
  // when the composer keeps refusing them.
  const cursor = deps.stillTrueCursor ?? DEFAULT_STILL_TRUE_CURSOR;
  const offset = cursor.read();
  // The modulo keeps the index inside a non-empty array, so the `!` is the
  // narrowing noUncheckedIndexedAccess cannot see.
  const stillTrueCandidates = Array.from(
   { length: Math.min(2, oldSnippets.length) },
   (_, i) => oldSnippets[(offset + i) % oldSnippets.length]!,
  );

  for (const s of stillTrueCandidates) {
   try {
    const draft = await deps.composeStillTrue(s, deps.complete, sittingFor(s.provenance.session));
    if (draft) {
     const entry = deps.queue.add(draft);
     minted.push(entry);
     stillTrueCount++;
    }
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'still-true-failed', detail: `composeStillTrue for snippet ${s.id} failed: ${String(err)}` });
   }
  }
  // Advance past every candidate OFFERED — whether composeStillTrue returned
  // a draft, returned null, or threw. The advance-on-null is the whole fix
  // for the wedge: the same two snippets were offered forever when the
  // composer refused them.
  if (stillTrueCandidates.length > 0) {
   cursor.write(offset + stillTrueCandidates.length);
  }
  deps.log({ at: ts(), actor: 'clerk', kind: 'still-true-minted', detail: `minted ${stillTrueCount} still-true` });

  // ── 4. Expire stale queue entries ──
  const expired = deps.queue.expire(30);
  deps.log({ at: ts(), actor: 'clerk', kind: 'expired', detail: `expired ${expired} entries` });

  // ── 5. At most one consolidation ──
  if (deps.nextConsolidation && deps.saveSummary && deps.loadSummaries && sessions) {
   try {
    const summaries = deps.loadSummaries(deps.vaultRoot);
    const range = deps.nextConsolidation(sessions, summaries);
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
  if (deps.runLadderSummaries) {
   try {
    await deps.runLadderSummaries({
     root: deps.vaultRoot,
     complete: deps.complete,
     model: deps.modelName,
     log: deps.log,
    });
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'soundings-summary-failed', detail: String(err) });
   }
  }

  // ── 6. Expedition minting: at most ONE per run ──
  if (deps.composeExpedition) {
   try {
    const allEntries = deps.queue.list();
    for (const s of allSnippets) {
     if (isExpeditionCandidate(s, allReadings, allEntries, allSnippets)) {
      const draft = await deps.composeExpedition(s, deps.complete, sittingFor(s.provenance.session));
      if (draft) {
       const entry = deps.queue.add(draft);
       minted.push(entry);
       const logEvt: { at: string; actor: string; kind: string; detail: string; refs?: string[] } = {
        at: ts(),
        actor: 'clerk',
        kind: 'expedition-minted',
        detail: `minted expedition from snippet ${s.id}`,
       };
       if (draft.cites) logEvt.refs = draft.cites;
       deps.log(logEvt);
      }
      break; // At most ONE expedition per run
     }
    }
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'expedition-failed', detail: String(err) });
   }
  }

  // ── 7. Referent annotations (ticket 074): newest snippets first ──
  // Guarded like the wiki jobs: a failure is one job's failure, and the
  // index, the minted questions, the expiry and the consolidation are
  // already on disk by the time this runs.
  let annotations: DocketReport['annotations'];
  if (deps.referentAnnotations) {
   try {
    annotations = await deps.referentAnnotations();
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'referent-annotations-failed', detail: String(err) });
   }
  }

  // ── 8. Piece work (010 T10): stale-pin sweep, then auto-set-down ──
  // piece jobs
  // Each guarded on its own: a failure in one is one job's failure, and the
  // other still runs. Neither job calls a model — zero-LLM by contract
  // (Q-39, Q-41).
  if (deps.stalePinSweep) {
   try {
    await deps.stalePinSweep();
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'piece-jobs-failed', detail: `stale pin sweep: ${String(err)}` });
   }
  }
  if (deps.dormancySweep) {
   try {
    await deps.dormancySweep();
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'piece-jobs-failed', detail: `dormancy sweep: ${String(err)}` });
   }
  }
  // end piece jobs

  // ── 9. The wiki jobs, last and guarded (ticket 023 item 2) ──
  // Last because every job above is the docket's own work and must not wait
  // on the slowest thing in the run; guarded because a wiki failure is one
  // job's failure. The index, the minted questions, the expiry and the
  // consolidation are already done and on disk by the time this runs, and
  // the report still carries all four when it throws.
  let wiki: DocketReport['wiki'];
  if (deps.runWikiJobs) {
   try {
    wiki = await deps.runWikiJobs();
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'wiki-jobs-failed', detail: String(err) });
   }
  }

  // ── 10. The import extraction, last and guarded (T6) ──
  // Last because it is the slowest thing in the run and no other job may
  // wait on it — the cost is paid before the person sits down (Q-58), and
  // nothing the docket owns must be pushed later than it already is.
  // Guarded because a throw is one job's failure: the index, the minted
  // questions and the expiry are already on disk by the time this runs,
  // and the report still carries all four when it throws.
  let imports: DocketReport['imports'];
  if (deps.runImportJobs) {
   try {
    imports = await deps.runImportJobs();
   } catch (err) {
    deps.log({ at: ts(), actor: 'clerk', kind: 'import-run-failed', detail: String(err) });
   }
  }

  return {
   reindexed: allSnippets.length,
   minted,
   expired,
   index,
   ...(wiki ? { wiki } : {}),
   ...(imports ? { imports } : {}),
   ...(annotations ? { annotations } : {}),
  };
 } finally {
  running = false;
 }
}
