/**
 * The mechanism exposure registry — ticket 077, the ToolExposure
 * countermeasure for this repo's most repeated defect class.
 *
 * Five mechanisms shipped inert before this existed — semantic resonance
 * (068), computeYield, cover() before 030 wired it, the 044 admissibility
 * gate (inert on real prose per 037), and the WikiReport counters (071).
 * Each was found by accident or by a dedicated audit. The structural fix
 * is codex's: exposure is a DECLARED state — live | shadow | unwired —
 * enumerable and testable, never an accident of missing call sites.
 *
 * ## What this file is
 *
 * Data, not prose. One entry per exported mechanism the sweep in
 * `tests/mechanism-registry.test.ts` can enumerate: every exported
 * function and every exported object-const in `src/` (the shapes a
 * capability can hide in — `lexicalChannel` is an object, not a factory).
 * The test then cross-checks the declaration against actual call sites:
 *
 * - `live`   — must have a caller outside its own tests (src/ or web/).
 *              A live mechanism with no caller FAILS.
 * - `shadow` — must be reached AND write the named shadow record
 *              (`shadowKind`, the Q-35 activity-log kind). A shadow
 *              mechanism that records nothing is indistinguishable from
 *              inert.
 * - `unwired`— must have no caller. A caller appearing FAILS: the
 *              declaration is stale. `unwired` is debt with a name.
 *
 * Every non-live entry carries a one-line `reason` naming the truth as of
 * the seed date (2026-08-02). When wiring lands, flip the status and
 * update the reason in the same change — the test is the ratchet that
 * makes the flip load-bearing.
 *
 * ## Known limits (mirrors tests/emitted-kinds.ts)
 *
 * - Exported primitives, arrays and prompt strings are data, not
 *   mechanisms, and are not swept. `starterBank`, `FACETS`,
 *   `SYSTEM_PROMPT`, `THRESHOLDS`' sibling constants are deliberately
 *   absent. A mechanism can still hide in an array export; so far none
 *   does.
 * - Bounds (Q-56) are data with their own exposure flag: a `Threshold`
 *   carries `live` and `graduatesWhen` beside its value, and decisions
 *   pass through `shadowDecision`. Threshold-valued bounds live in the
 *   `THRESHOLDS` table (registered as data), not as per-symbol entries.
 * - Callers are found by identifier on blanked source, so a same-named
 *   private symbol elsewhere reads as a caller. That class has bitten
 *   twice (`userTurn`, `nameSimilarity`, `quotedSpans`) and is harmless
 *   as long as the real status stays live.
 * - Callers inside an unwired module count. The resonance bounds are data
 *   in `THRESHOLDS` with their own `live` flags (Q-35/Q-56), carried by
 *   the table's own registry entry rather than by per-symbol entries.
 */

export type MechanismStatus = 'live' | 'shadow' | 'unwired';

export type MechanismEntry = {
 /** Repo-relative module path, no extension: 'src/index/semantic'. */
 module: string;
 /** Exported symbol name in that module. */
 name: string;
 status: MechanismStatus;
 /**
  * Required when `status` is 'shadow': the activity-log kind the Q-35
  * shadow record writes (e.g. 'facet-balance-shadow').
  */
 shadowKind?: string;
 /**
  * One line. Required when `status` is not 'live'; live entries may
  * carry one when the state has nuance (Q-56 bounds).
  */
 reason?: string;
};

export const MECHANISM_REGISTRY: MechanismEntry[] = [
 // ── src/auth/auth.ts ──
 { module: 'src/auth/auth', name: 'createFileAuth', status: 'live' },
 { module: 'src/auth/auth', name: 'isLoopback', status: 'live' },
 { module: 'src/auth/auth', name: 'createSessionAuth', status: 'live', reason: 'wired: createApp owns the server session gate (token map, cookie, middleware) through it (S14)' },
 { module: 'src/auth/auth', name: 'remoteAddrOf', status: 'live', reason: 'wired: requireLoopback and the server session gate extract the caller address through it (F10)' },
 { module: 'src/auth/auth', name: 'requireLoopback', status: 'live', reason: 'wired: the setup gate, POST /api/setup and POST /api/fresh-start guard on it (F10)' },
 { module: 'src/auth/auth', name: 'sessionResponse', status: 'live', reason: 'wired: POST /api/setup and POST /api/login answer with it (F10)' },

 // ── src/types.ts + src/guards.ts (Wave C3 — the shared route-guard family) ──
 // CAPTURE_CHANNELS and AUTHORS are arrays — data, not mechanisms — and are
 // deliberately absent, exactly like FACETS/SYSTEM_PROMPT.
 { module: 'src/types', name: 'isCaptureChannel', status: 'live', reason: 'wired: the capture routes, the /v2 channel check and the shared guards narrow through it (F1/F8)' },
 { module: 'src/guards', name: 'validateDecisions', status: 'live', reason: 'wired: the import-review and session-harvest routes validate decisions through it (F3)' },
 { module: 'src/guards', name: 'requireText', status: 'live', reason: 'wired: the two one-turn capture routes require text through it (F8)' },
 { module: 'src/guards', name: 'checkedChannel', status: 'live', reason: 'wired: the two one-turn capture routes guard the channel through it (F8)' },
// ── src/jsonl.ts (Wave D4, Wave E1) ── the append/read mechanic every
// append-only ledger shares: reach declines, the graduation ledger, the
// repair ledger, the repair records, the sweep log and the deferral —
// plus the two read helpers the cursor files share (Wave E1).
 { module: 'src/jsonl', name: 'appendLine', status: 'live', reason: 'wired: the five ledgers append through it' },
 { module: 'src/jsonl', name: 'readLines', status: 'live', reason: 'wired: the same ledgers re-read through it' },
 { module: 'src/jsonl', name: 'readJsonl', status: 'live', reason: 'wired: the sweep log, the deferral and both embedding caches parse their ledgers through it (Wave E1)' },
 { module: 'src/jsonl', name: 'jsonCursorFile', status: 'live', reason: 'wired: the still-true and outcome cursors, the resume marker and the engagement ledger read and write through it (Wave E1)' },

 // ── src/v2/router.ts (ticket 129) ──
 { module: 'src/v2/router', name: 'createV2App', status: 'live', reason: 'wired: createApp mounts it at /v2 before the static catch-all (129)' },

 // ── src/loop/instances.ts (ticket 130) ── the harness's own entry points are
 // dispatched by the improvement loop at run time; scripts/ and tests do not
 // count as callers, so they flip to live when the loop runner lands in src/.
 { module: 'src/loop/instances', name: 'variantWorktreeArgs', status: 'live', reason: 'wired: createVariantWorktree builds its git argv through it' },
 { module: 'src/loop/instances', name: 'instanceEnv', status: 'live', reason: 'wired: provisionInstance builds the child environment through it' },
 { module: 'src/loop/instances', name: 'serverArgs', status: 'live', reason: 'wired: provisionInstance spawns the variant server through it' },
 { module: 'src/loop/instances', name: 'materializeInstanceDir', status: 'live', reason: 'wired: provisionInstance builds the instance dir through it' },
 { module: 'src/loop/instances', name: 'allocatePort', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },
 { module: 'src/loop/instances', name: 'createVariantWorktree', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },
 { module: 'src/loop/instances', name: 'provisionInstance', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },
 { module: 'src/loop/instances', name: 'awaitHealthy', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },
 { module: 'src/loop/instances', name: 'setupAuth', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },
 { module: 'src/loop/instances', name: 'relogin', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },
 { module: 'src/loop/instances', name: 'teardownInstance', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },
 { module: 'src/loop/persona', name: 'personaRunPrompt', status: 'live', reason: 'wired: personaCommand appends it to the omp argv' },
 { module: 'src/loop/persona', name: 'personaCommand', status: 'unwired', reason: 'ticket 130: loop-dispatched at run time' },

 // ── src/loop record plane + tripwire (tickets 131/132) ──
 { module: 'src/loop/ledger', name: 'appendLedger', status: 'live', reason: 'wired: scripts/demote.ts and sweepTripwire append through it' },
 { module: 'src/loop/ledger', name: 'readLedger', status: 'live', reason: 'wired: sweepTripwire reads graduations through it' },
 { module: 'src/loop/demotions', name: 'readDemotions', status: 'live', reason: 'wired: sweepTripwire consults the store through it' },
 { module: 'src/loop/demotions', name: 'addDemotion', status: 'live', reason: 'wired: sweepTripwire and scripts/demote.ts write through it' },
 { module: 'src/loop/demotions', name: 'isDemoted', status: 'live', reason: 'wired: thresholds isLive() consults it at read time' },
 { module: 'src/loop/demotions', name: 'clearDemotion', status: 'unwired', reason: 'ticket 131: the re-graduation-after-dwell path is not built; the mechanical counterpart to hand-editing JSON' },
 { module: 'src/loop/graduations', name: 'readGraduations', status: 'unwired', reason: 'Q-99: read-all API; no shipping caller — tests consume it; liveness reads go through isGraduated\'s cached store read' },
 { module: 'src/loop/graduations', name: 'addGraduation', status: 'unwired', reason: 'Q-99: the loop writes it at landing beside a graduation ledger line; no caller ships in the app itself' },
 { module: 'src/loop/graduations', name: 'isGraduated', status: 'live', reason: 'wired: thresholds isLive() consults it at read time (Q-99)' },
 { module: 'src/loop/verdicts', name: 'validateVerdict', status: 'unwired', reason: 'ticket 131: the paired-trial harness that renders and weighs verdicts is not built; the record plane ships ahead of it' },
 { module: 'src/loop/verdicts', name: 'keepRule', status: 'unwired', reason: 'ticket 131: same — weighed by the loop at run time' },
 { module: 'src/loop/tripwire', name: 'sweepTripwire', status: 'unwired', reason: '132: no caller ships yet — the docket tripwireSweep thunk is not constructed (server import pruned, Wave C3 F11)' },
 { module: 'src/loop/tripwire', name: 'readTripwireState', status: 'live', reason: 'wired: scripts/loop-status.ts renders state through it' },
 { module: 'src/loop/tripwire', name: 'dwellUntil', status: 'live', reason: 'wired: sweepTripwire stamps demotions through it' },
 { module: 'src/loop/tripwire', name: 'underDwell', status: 'live', reason: 'wired: sweepTripwire skips dwelling mechanisms through it' },
 { module: 'src/wiki/thresholds', name: 'isLive', status: 'live', reason: 'wired: shadowDecision and patterns/select gate on it; demotions consult at read time (131)' },

 // ── src/reset/fresh-start.ts ──
 { module: 'src/reset/fresh-start', name: 'archiveStamp', status: 'live', reason: 'wired: POST /api/fresh-start names the archive dir with it' },
 { module: 'src/reset/fresh-start', name: 'freshStartTargets', status: 'live', reason: 'wired: archiveFreshStart enumerates the person-derived paths through it' },
 { module: 'src/reset/fresh-start', name: 'archiveFreshStart', status: 'live', reason: 'wired: POST /api/fresh-start (loopback-only, typed confirm) moves the records and exits' },

 // ── src/clerk/composed.ts ──
 { module: 'src/clerk/composed', name: 'redLights', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeFollowUp', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeJuxtaposition', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeOpener', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeStillTrue', status: 'live' },
 { module: 'src/clerk/composed', name: 'isExpeditionCandidate', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeExpedition', status: 'live' },
 { module: 'src/clerk/composed', name: 'isOtherMindsCandidate', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeOtherMindsExpedition', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeDiscriminatingQuestion', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeNarrowedRanges', status: 'live' },
 { module: 'src/clerk/composed', name: 'setDraftRejectSink', status: 'live', reason: 'wired: createApp registers the draft-reject log sink through it' },
 { module: 'src/clerk/composed', name: 'checkQuotesSource', status: 'live', reason: 'wired: the opener/still-true/expedition gates and arrangements\' gap gate quote their source through it' },
 {
  module: 'src/clerk/composed',
  name: 'stillTrueForm',
  status: 'live',
  reason: 'pure form computation for the still-true re-measure; the Q-35 gate on acting on it lives in composeStillTrue behind the stillTrue.formSelection threshold',
 },
 // ── src/clerk/annotate.ts ──
 { module: 'src/clerk/annotate', name: 'annotateReferent', status: 'live' },
 { module: 'src/clerk/annotate', name: 'annotateIntentionHorizon', status: 'live' },
 // ── src/clerk/annotation-store.ts ──
 { module: 'src/clerk/annotation-store', name: 'createAnnotationStore', status: 'live' },
// ── src/clerk/docket-init.ts (Wave C1 — the Clerk factory, extracted from src/server.ts) ──
 { module: 'src/clerk/docket-init', name: 'createClerk', status: 'live' },
 // ── src/clerk/composed.ts ──
 { module: 'src/clerk/composed', name: 'composeOutcomeQuestion', status: 'live' },
 // ── src/clerk/contradiction.ts ──
 { module: 'src/clerk/contradiction', name: 'judgeOpposition', status: 'live' },
 { module: 'src/clerk/contradiction', name: 'composeRemeasure', status: 'live' },
 { module: 'src/clerk/contradiction', name: 'judgeConfirmation', status: 'live' },
 // ── src/clerk/compose-gate.ts (Wave B2 — the shared composition machinery) ──
 { module: 'src/clerk/compose-gate', name: 'stripFences', status: 'live', reason: 'the ONE fence-stripper — every clerk LLM-output parse (composed, compose-pattern, contradiction, mint, annotate, arrangements, lineage-mirror) strips through it; the loose form preserves lineage-mirror\'s any-fence semantics' },
 { module: 'src/clerk/compose-gate', name: 'corrective', status: 'live', reason: 'the ONE rejection→correction table — composed\'s eight paths and the contradiction re-measure correct through it (repeats-original keeps both wordings)' },
 { module: 'src/clerk/compose-gate', name: 'composeWithRetry', status: 'live', reason: 'the ONE two-attempts-then-silence skeleton — all eight compose paths in composed.ts run attempt → gate → guardComposed → corrective retry → gate → guardComposed through it' },

 // ── src/clerk/clause.ts ──
 { module: 'src/clerk/clause', name: 'isCompleteClause', status: 'live' },
 { module: 'src/clerk/clause', name: 'widenToClause', status: 'live' },
 {
  module: 'src/clerk/clause',
  name: 'hasConstructPole',
  status: 'live',
  reason: 'graduated 2026-08-03 (was Q-35 shadow, ticket 114, QR-1): the gate acted from birth — blocks pole-less half-Construct mints and logs every skip as gap-fill-pole-skip',
 },
 // ── src/language/disfluency.ts ──
 {
  module: 'src/language/disfluency',
  name: 'elideDisfluencies',
  status: 'live',
  reason: 'graduated 2026-08-03 (was Q-35 shadow, QR-5): acts at the queue\'s one write gate — elides STT disfluencies from quoted fragments and logs disfluency-elided when the text changes',
 },

 // ── src/clerk/arrangements.ts ──
 {
  module: 'src/clerk/arrangements',
  name: 'proposeArrangements',
  status: 'live',
  reason: 'wired by T12: POST /api/piece/:id/arrangements calls it with the clerk model (010 T12)',
 },

 // ── src/clerk/docket.ts ──
 { module: 'src/clerk/docket', name: 'runDocket', status: 'live' },
 {
  module: 'src/clerk/docket',
  name: 'runStalePinSweep',
  status: 'live',
  reason: 'wired by 010 T10: runDocketNow\'s thunk runs it as the docket\'s first piece job',
 },
 {
  module: 'src/clerk/docket',
  name: 'runDormancySweep',
  status: 'live',
  reason: 'wired by 010 T10: runDocketNow\'s thunk runs it as the docket\'s second piece job',
 },

 // ── src/clerk/sweeps.ts ──
 { module: 'src/clerk/sweeps', name: 'runReferentAnnotations', status: 'live' },
 { module: 'src/clerk/sweeps', name: 'runIntentionHorizonAnnotations', status: 'live' },
 { module: 'src/clerk/sweeps', name: 'runOutcomeQuestions', status: 'live' },
 {
  module: 'src/clerk/sweeps',
  name: 'runOneTimeTemplateSweep',
  status: 'live',
  reason: 'wired by 114: runDocket calls it once before the minting jobs; the flag file gates it to a single run',
 },
 {
  module: 'src/clerk/sweeps',
  name: 'rotate',
  status: 'live',
  reason: 'shared rotation cursor (075/106): still-true (docket) and outcome (sweeps) both call rotate() to offer cap candidates modulo eligible and advance past them',
 },
 // ── src/clerk/lineage-mirror.ts ──
 { module: 'src/clerk/lineage-mirror', name: 'readLineage', status: 'live' },
 { module: 'src/clerk/lineage-mirror', name: 'licenseMirror', status: 'live' },
 { module: 'src/clerk/lineage-mirror', name: 'composeLineageMirror', status: 'live' },
 {
  module: 'src/clerk/lineage-mirror',
  name: 'runLineageMirrorSweep',
  status: 'live',
  reason: 'graduated 2026-08-03: lineageMirror.selection is live, so the sweep mints capped mirror questions — one per claim, ever; wired into runDocket by the server',
 },

 // ── src/clerk/gap-fill.ts ──
 {
  module: 'src/clerk/gap-fill',
  name: 'runGapFillSweep',
  status: 'live',
  reason: 'wired by 027: runDocketNow\'s thunk runs it as the docket\'s gap-fill job',
 },

 // ── src/clerk/mint.ts ──
 { module: 'src/clerk/mint', name: 'proposeOps', status: 'live' },
 { module: 'src/clerk/mint', name: 'setMintPersonaLine', status: 'live', reason: 'wired: createApp sets the mint persona from the profile at boot and after POST /api/profile' },

 // ── src/clerk/sitting.ts ──
 { module: 'src/clerk/sitting', name: 'readSitting', status: 'live' },
 { module: 'src/clerk/sitting', name: 'sittingCache', status: 'live' },

 // ── src/clerk/wiki-jobs.ts ──
 { module: 'src/clerk/wiki-jobs', name: 'runWikiJobs', status: 'live' },

 // ── src/clerk/confirmation.ts (Wave B1: the answered-question half of the wiki run, extracted from wiki-jobs.ts) ──
 {
  module: 'src/clerk/confirmation',
  name: 'dissolutionOutcome',
  status: 'live',
  reason: 'wired (Wave B1): confirmAnsweredRemeasures maps every dissolving confirmation through it; wiki-jobs.ts re-exports it',
 },
 {
  module: 'src/clerk/confirmation',
  name: 'confirmAnsweredRemeasures',
  status: 'live',
  reason: 'wired (Wave B1): runWikiJobs runs it as the presweep-confirmation and confirmation jobs',
 },
 {
  module: 'src/clerk/confirmation',
  name: 'jobRangeDiscrimination',
  status: 'live',
  reason: 'wired (Wave B1): runWikiJobs runs it as the discriminated-answer job',
 },
 {
  module: 'src/clerk/confirmation',
  name: 'recoverPoles',
  status: 'live',
  reason: 'wired (Wave B1): the re-measure job re-asks stage 1 through it when a candidate lost its poles',
 },
 {
  module: 'src/clerk/confirmation',
  name: 'dissolve',
  status: 'live',
  reason: 'wired (Wave B1): the one write path that retires a suspicion — remeasure expiry, not-opposed, and every dissolving confirmation',
 },
 {
  module: 'src/clerk/confirmation',
  name: 'loadWorld',
  status: 'live',
  reason: 'wired (Wave B1): every wiki job opens by loading the run world (graph, claims, queue entries) through it',
 },

// ── src/coach/license.ts ──
 { module: 'src/coach/license', name: 'clusterClaimsByTheme', status: 'live', reason: 'wired: the coach-seed sweep clusters claims by theme through it (clerk/coach-seed.ts)' },

 // ── src/language/thin-answer.ts ──
 { module: 'src/language/thin-answer', name: 'isContentFree', status: 'live' },

 // ── src/elicitor/bank.ts ──
 { module: 'src/elicitor/bank', name: 'loadQuestionBank', status: 'live' },

 // ── src/elicitor/elicitor.ts ──
 { module: 'src/elicitor/elicitor', name: 'startSession', status: 'live' },
 { module: 'src/elicitor/elicitor', name: 'userTurn', status: 'live' },
 { module: 'src/elicitor/elicitor', name: 'skipQuestion', status: 'live' },
 { module: 'src/elicitor/elicitor', name: 'machineTurn', status: 'live', reason: 'wired by 159 T5: the machine resume route composes the resumed question with the turn seam' },
 { module: 'src/elicitor/elicitor', name: 'parseTriadPair', status: 'live', reason: 'wired: POST /turn parses the tapped triad pair through it' },

 // ── src/elicitor/facet-intent.ts ──
 {
  module: 'src/elicitor/facet-intent',
  name: 'classifyFacetIntent',
  status: 'unwired',
  reason: 'script-only consumer — scripts/curate-deck.ts (offline deck curation); no src/web caller',
 },
 { module: 'src/elicitor/facet-intent', name: 'facetIntentForRedLight', status: 'live' },

 // ── src/language/guards.ts ──
 { module: 'src/language/guards', name: 'isInterrogative', status: 'live' },
 { module: 'src/language/guards', name: 'setOffSpans', status: 'live' },
 { module: 'src/language/guards', name: 'quotesFragmentSetOff', status: 'live' },
 { module: 'src/language/guards', name: 'hasFirstPersonOutsideQuote', status: 'live' },
 { module: 'src/language/guards', name: 'isParrot', status: 'live' },
 { module: 'src/language/guards', name: 'isConversationReferential', status: 'live' },
 { module: 'src/language/guards', name: 'isNearDuplicate', status: 'live' },
 { module: 'src/language/guards', name: 'checkQuestion', status: 'live' },

 // ── src/elicitor/target-default.ts ──
 { module: 'src/elicitor/target-default', name: 'suggestTarget', status: 'live' },
 { module: 'src/elicitor/target-default', name: 'recentSittingTargets', status: 'live' },
 { module: 'src/elicitor/target-default', name: 'suggestTargetForVault', status: 'live' },

 // ── src/fake-responder.ts ──
 { module: 'src/fake-responder', name: 'makeFakeComplete', status: 'live' },

 // ── src/harvester/admissibility.ts ──
 { module: 'src/harvester/admissibility', name: 'normalize', status: 'live' },
 { module: 'src/harvester/admissibility', name: 'isMetaConversational', status: 'live' },
 { module: 'src/harvester/admissibility', name: 'lacksProposition', status: 'live' },
 { module: 'src/harvester/admissibility', name: 'startsMidSentence', status: 'live' },
 { module: 'src/harvester/admissibility', name: 'quotedSpans', status: 'live' },
 { module: 'src/harvester/admissibility', name: 'isQuotedFromSource', status: 'live' },
 { module: 'src/harvester/admissibility', name: 'admissible', status: 'live' },

 // ── src/harvester/harvester.ts ──
 { module: 'src/harvester/harvester', name: 'propose', status: 'live' },
 { module: 'src/harvester/harvester', name: 'decide', status: 'live' },
 { module: 'src/harvester/harvester', name: 'mergeAdjacent', status: 'live', reason: 'wired: the harvest flow merges adjacent same-turn proposals through it (ticket 143)' },
{ module: 'src/harvester/harvester', name: 'coerceAuthorshipStance', status: 'live', reason: 'the region-authorship guard (seeding Task 7) — import/extract.ts coerces avowal → report-of-fact through it; the STANCES vocabulary stays in the harvester (Wave D F14)' },

 // ── src/harvester/pending.ts (ticket 084 — the review queue on disk) ──
 { module: 'src/harvester/pending', name: 'writePendingHarvest', status: 'live' },
 { module: 'src/harvester/pending', name: 'readPendingHarvest', status: 'live' },
 { module: 'src/harvester/pending', name: 'listPendingHarvests', status: 'live' },
 { module: 'src/harvester/pending', name: 'removePendingHarvest', status: 'live' },
 {
  module: 'src/harvester/harvester',
  name: 'CUTS_RESPONSE_FORMAT',
  status: 'live',
  reason:
   'wired 2026-08-02 (078 remainder): server boot builds a harvest-only ' +
   'makeComplete("clerk", { responseFormat }) — wiki mint jobs stay unconstrained',
 },

 // ── src/index/lexical.ts ──
 { module: 'src/index/lexical', name: 'buildIndex', status: 'live' },
 { module: 'src/index/lexical', name: 'resonate', status: 'live' },

 // ── src/clerk/watermark.ts (ticket 076 — the docket's two gates, re-homed from index/) ──
 // Both gates are read at the top of every wiki run in src/clerk/wiki-jobs.ts:
 // vaultDiff/changedIn decide the queue-driven jobs, and the fingerprint
 // trio decides the graph-derived passes.
 { module: 'src/clerk/watermark', name: 'vaultDiff', status: 'live' },
 { module: 'src/clerk/watermark', name: 'changedIn', status: 'live' },
 { module: 'src/clerk/watermark', name: 'fingerprintOf', status: 'live' },
 { module: 'src/clerk/watermark', name: 'sameFingerprint', status: 'live' },
 { module: 'src/clerk/watermark', name: 'readWatermark', status: 'live' },
 { module: 'src/clerk/watermark', name: 'writeWatermark', status: 'live' },
 { module: 'src/clerk/watermark', name: 'claimDelta', status: 'live' },

 // ── src/index/semantic.ts (068 landed — the wiring wave flipped these) ──
 {
  module: 'src/index/semantic',
  name: 'fileSnippetVectorStore',
  status: 'live',
  reason: '068 landed — read at boot in src/server.ts beside buildIndex; prime() fills vault/index/snippet-embeddings.jsonl',
 },
 {
  module: 'src/index/semantic',
  name: 'buildSemanticIndex',
  status: 'live',
  reason: '068 landed — built at boot in src/server.ts from the whole corpus, primed in the background',
 },
 {
  module: 'src/index/semantic',
  name: 'resonateHybrid',
  status: 'live',
  reason: '068 landed — awaited by the turn endpoint in src/server.ts and by the elicitor priority-1 juxtaposition',
 },
 {
  module: 'src/index/semantic',
  name: 'quotablePhrase',
  status: 'live',
  reason: '068 ruling — the elicitor quotes a semantic hit through it: the snippet own words, never an invented phrase',
 },

 // ── src/import/body.ts ──
 {
  module: 'src/import/body',
  name: 'clean',
  status: 'live',
  reason: 'called by the extraction job (src/import/extract.ts, T5) — the real harvest path',
 },
 {
  module: 'src/import/body',
  name: 'dropCitedParagraphs',
  status: 'live',
  reason: 'called by the extraction job (src/import/extract.ts, T5) — the real harvest path',
 },
 {
  module: 'src/import/body',
  name: 'toTurns',
  status: 'live',
  reason: 'called by the extraction job (src/import/extract.ts, T5) — the real harvest path',
 },
 {
  module: 'src/import/body',
  name: 'classifyDroppedRun',
  status: 'live',
  reason: 'the review route names dropped regions through it (src/import/body.ts droppedRegions) — the clean() vocabulary, one copy',
 },
 {
  module: 'src/import/body',
  name: 'droppedRegions',
  status: 'live',
  reason: 'wired (Wave D1): the import review route marks dropped source regions through it (src/import/routes.ts) — moved home beside the classifier it names them by',
 },

 // ── src/import/scan.ts ──
 {
  module: 'src/import/scan',
  name: 'bodyHash',
  status: 'live',
  reason: 'Q-59 content identity — read by src/import/adopt.ts when a piece is adopted',
 },
 {
  module: 'src/import/scan',
  name: 'scanFolder',
  status: 'live',
  reason: 'called by the scan route (src/server.ts, T9) — the folder door (Q-57)',
 },

 // ── src/import/store.ts ──
 {
  module: 'src/import/store',
  name: 'createImportStore',
  status: 'live',
  reason: 'called from createApp (server.ts) — the docket import job reads through it',
 },

 // ── src/import/extract.ts ──
 {
  module: 'src/import/extract',
  name: 'runImportExtraction',
  status: 'live',
  reason: 'called from runImportJobsNow (server.ts) as the docket last job',
 },

 // ── src/import/commit.ts ──
 {
  module: 'src/import/commit',
  name: 'commitImport',
  status: 'live',
  reason: 'called by the decisions route (src/server.ts, T9) — the only path into the corpus',
 },

 // ── src/import/region.ts ──
 {
  module: 'src/import/region',
  name: 'slugFor',
  status: 'live',
  reason: 'called by declare() in the same module — a slug is the region record\'s own derived key',
 },
 {
  module: 'src/import/region',
  name: 'createRegionStore',
  status: 'live',
  reason: 'constructed in createApp (server.ts) and called by POST /api/import/region — the only writer of a declaration',
 },

 // ── src/import/dating.ts ──
 {
  module: 'src/import/dating',
  name: 'compilePattern',
  status: 'live',
  reason: 'called by dateFor in the same module',
 },
 {
  module: 'src/import/dating',
  name: 'dateFor',
  status: 'live',
  reason: 'called by scanFile under any dating rule',
 },
 {
  module: 'src/import/dating',
  name: 'DEFAULT_DATING',
  status: 'live',
  reason: 'the default scanFolder rule — frontmatter date, today\'s behaviour',
 },
 {
  module: 'src/import/dating',
  name: 'isoDay',
  status: 'live',
  reason: 'the ONE normaliser for a date value — scan.ts and adopt.ts import it (Q-57)',
 },
 {
  module: 'src/import/scan',
  name: 'walkMarkdown',
  status: 'live',
  reason: 'called by scanFolder — one walk for the scan and the survey',
 },

// ── src/import/survey.ts ──
{
  module: 'src/import/survey',
  name: 'surveyFolder',
  status: 'live',
  reason: 'called by GET /api/import/survey (server.ts) — the map exists to be read in order to declare',
},
{
  module: 'src/import/survey',
  name: 'writeSurvey',
  status: 'live',
  reason: 'called by GET /api/import/survey (server.ts) — the snapshot is a rebuildable cache (Q-3)',
},
{
  module: 'src/import/survey',
  name: 'readSurvey',
  status: 'live',
  reason: 'called by GET /api/reach (server.ts) — Reach reads the snapshot, never the folder',
},

// ── src/import/reach.ts ──
{
 module: 'src/import/reach',
 name: 'termsOf',
 status: 'live',
 reason: 'called by reachOffer in the same module — one normaliser for both sides of every comparison',
},
{
 module: 'src/import/reach',
 name: 'reachOffer',
 status: 'live',
 reason: 'called by GET /api/reach (server.ts) — the licence is offered through that door',
},
{
 module: 'src/import/reach',
 name: 'appendReachDecline',
 status: 'live',
 reason: 'called by POST /api/reach/decline (server.ts) — one click, one recorded decline',
},
{
 module: 'src/import/reach',
 name: 'reachDeclines',
 status: 'live',
 reason: 'called by GET /api/reach (server.ts) — the decline ledger ranks offers; re-read every call, never cached',
},

// ── src/import/repair.ts ──
{
 module: 'src/import/repair',
 name: 'runImportRepair',
 status: 'live',
 reason: 'called by POST /api/import/:hash/decisions (server.ts) after a clean commit — never before',
},

// ── src/import/pipeline.ts (the route-facing choreography, 014) ──
{ module: 'src/import/pipeline', name: 'pipelineScan', status: 'live', reason: 'the scan route\'s whole sequence — adoption first (T8), then the region rule dates the scan, then admit' },
{ module: 'src/import/pipeline', name: 'pipelineCommit', status: 'live', reason: 'the decisions route\'s sequence — a clean commit, then the repair pass (014 T10), never before' },
{ module: 'src/import/pipeline', name: 'pipelineSurvey', status: 'live', reason: 'the survey route\'s sequence — compute the map, then snapshot unless the read is pure (129)' },
{ module: 'src/import/pipeline', name: 'pipelineReach', status: 'live', reason: 'GET /api/reach\'s sequence — the snapshot and the live queue meet in one offer' },

// ── src/import/routes.ts (Wave D1 — the import cluster, extracted from src/server.ts) ──
{ module: 'src/import/routes', name: 'createImportRoutes', status: 'live', reason: 'wired: createApp registers the T9 review cluster and the reach pair through it (014)' },

// ── src/repair/consult.ts (Q-106 — the repair consultation helpers) ──
 { module: 'src/repair/consult', name: 'isUnderRepair', status: 'live', reason: 'wired: the composed minting gate quarantines repaired snippets through it' },
 { module: 'src/repair/consult', name: 'repairedSnippetIds', status: 'live', reason: 'wired: resonance draws and queue-entry expiry filter repaired snippets through it' },
// ── src/repair/store.ts (Q-106 — the repair vault) ──
 { module: 'src/repair/store', name: 'writeRepair', status: 'live', reason: 'wired: POST /api/repair records the disavowal through it' },
 { module: 'src/repair/store', name: 'readAllRepairs', status: 'live', reason: 'wired: every draw point reads the repair set through it' },

 // ── src/llm.ts ──
 { module: 'src/llm', name: 'roleConfig', status: 'live' },
 { module: 'src/llm', name: 'describeRole', status: 'live' },
 { module: 'src/llm', name: 'makeComplete', status: 'live' },

 // ── src/log/activity.ts ──
 { module: 'src/log/activity', name: 'appendEvent', status: 'live' },
 { module: 'src/log/activity', name: 'readEvents', status: 'live' },
 { module: 'src/log/activity', name: 'onAppend', status: 'live', reason: 'wired: createApp streams the live-event feed through it' },

 // ── src/log/cadence.ts ──
 { module: 'src/log/cadence', name: 'readCadence', status: 'live' },
 { module: 'src/log/cadence', name: 'cadenceSentence', status: 'live' },

 // ── src/log/detail.ts: the shared detail grammar ──
{ module: 'src/log/detail', name: 'detailFields', status: 'live' },
{ module: 'src/log/detail', name: 'detailField', status: 'live' },
{ module: 'src/log/detail', name: 'detailQuoted', status: 'live' },
{ module: 'src/log/detail', name: 'detailClause', status: 'live' },

// ── src/log/format.ts ──
 {
  module: 'src/log/format',
  name: 'hasSentence',
  status: 'live',
  reason: 'wired by ticket 065: EventKind is keyof SENTENCES, so formatEvent guards its index through hasSentence',
 },
 { module: 'src/log/format', name: 'formatEvent', status: 'live' },
 { module: 'src/log/format', name: 'relativeTime', status: 'live' },

 // ── src/log/surfaced.ts ──
 { module: 'src/log/surfaced', name: 'surfaced', status: 'live' },

 // ── src/memory/cover.ts ──
 {
  module: 'src/memory/cover',
  name: 'cover',
  status: 'live',
  reason: '119: the opener job tiles history through it — wired 2026-08-03',
 },
 { module: 'src/memory/cover', name: 'nextConsolidation', status: 'live' },
 { module: 'src/memory/cover', name: 'saveSummary', status: 'live' },
 { module: 'src/memory/cover', name: 'loadSummaries', status: 'live' },

 // ── src/piece/arrange.ts ──
 { module: 'src/piece/arrange', name: 'chronological', status: 'live', reason: 'wired by T6: POST /api/piece pins the chosen snippets in sitting order' },

 // ── src/piece/contract.ts ──
 { module: 'src/piece/contract', name: 'noProse', status: 'live', reason: 'wired by T3: the store runs noProse/noTitle/pinsResolve before every write; T11 will use all five for the candidate gate' },
 { module: 'src/piece/contract', name: 'noTitle', status: 'live', reason: 'wired by T3: the store runs noProse/noTitle/pinsResolve before every write' },
 { module: 'src/piece/contract', name: 'pinsResolve', status: 'live', reason: 'wired by T3: the store runs noProse/noTitle/pinsResolve before every write; T11 will use all five for the candidate gate' },
 { module: 'src/piece/contract', name: 'samePinSet', status: 'live', reason: 'wired by T11: proposeArrangements runs it before any candidate is accepted (010 T11)' },
 { module: 'src/piece/contract', name: 'distinctPrinciples', status: 'live', reason: 'wired by T11: the candidate gate seats the base\'s chronology and refuses duplicates (010 T11)' },

 // ── src/piece/export.ts ──
 { module: 'src/piece/export', name: 'toMarkdown', status: 'live', reason: 'wired by T6: GET /api/piece/:id/export renders the arrangement' },

 // ── src/piece/store.ts ──
 { module: 'src/piece/store', name: 'createPieceStore', status: 'live', reason: 'wired by T6: the piece routes write through it' },

 // ── src/piece/routes.ts (Wave C1 — the piece route cluster, extracted from src/server.ts) ──
 { module: 'src/piece/routes', name: 'createPieceRoutes', status: 'live', reason: 'wired: the boot registers the piece cluster through it (T6)' },

 // ── src/piece/stale.ts ──
 {
  module: 'src/piece/stale',
  name: 'stalePins',
  status: 'live',
  reason: 'wired by 010 T10: the docket\'s stale-pin sweep flags, never re-pins (Q-39)',
 },

 // ── src/piece/dormancy.ts ──
 {
  module: 'src/piece/dormancy',
  name: 'isDormant',
  status: 'live',
  reason: 'wired by 010 T10: the docket\'s dormancy sweep decides set-down with it (Q-41)',
 },

// ── src/profile.ts ──
 { module: 'src/profile', name: 'readProfile', status: 'live', reason: 'wired: createApp loads the profile at boot and POST /api/profile reads through it' },
 { module: 'src/profile', name: 'writeProfile', status: 'live', reason: 'wired: POST /api/profile writes through it' },
 { module: 'src/profile', name: 'personaLine', status: 'live', reason: 'wired: the mint and harvest prompts compose the persona line through it' },
 { module: 'src/profile', name: 'profileFrameWords', status: 'live', reason: 'wired: the coach-seed sweep frames theme clustering with it' },

 // ── src/protocols/registry.ts ──
 { module: 'src/protocols/registry', name: 'loadProtocolDefinitions', status: 'live' },
 { module: 'src/protocols/registry', name: 'selectProtocolForTarget', status: 'live' },
 { module: 'src/protocols/registry', name: 'getProtocol', status: 'live' },

// ── src/protocols/machine.ts (ticket 159 — the protocol state machine) ──
 { module: 'src/protocols/machine', name: 'parseMachineMarker', status: 'live', reason: 'wired: the elicitor ratifies markers and the machine composes through it' },
 { module: 'src/protocols/machine', name: 'composeMachineSystemPrompt', status: 'live', reason: 'wired: the elicitor builds the machine system prompt through it' },
 { module: 'src/protocols/machine', name: 'startMachine', status: 'live', reason: 'wired: the elicitor and the DRM/POST machine routes start machines through it' },
 { module: 'src/protocols/machine', name: 'recordExchange', status: 'live', reason: 'wired: the elicitor bumps the current phase count through it' },
 { module: 'src/protocols/machine', name: 'machineQuestion', status: 'live', reason: 'wired: the elicitor composes the next machine question through it' },
 { module: 'src/protocols/machine', name: 'advanceMachine', status: 'live', reason: 'wired: the elicitor ratifies advance markers through it' },
 { module: 'src/protocols/machine', name: 'machinePhaseMeta', status: 'live', reason: 'wired: the session routes and the queue enrich site build the machine phase meta through it (Wave B)' },

 // ── src/language/weak-form.ts ──
 { module: 'src/language/weak-form', name: 'isWeakForm', status: 'live' },
 // ── src/language/emit-form.ts ──
 { module: 'src/language/emit-form', name: 'checkEmitForm', status: 'live', reason: 'moved with the question-language layer (Phase 1): the emit gate runs at every composed path through guardComposed' },
 { module: 'src/language/emit-form', name: 'guardComposed', status: 'live', reason: 'the one compose-through-gate helper: every composed path (composed.ts, compose-pattern.ts, elicitor.ts, server.ts) runs checkEmitForm + checkQuestion through it' },

 // ── src/queue/facet-balance.ts (one Q-35 mechanism, nine declarations) ──
 {
  module: 'src/queue/facet-balance',
  name: 'BLUEPRINT',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'facetDistribution',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'readVaultFacetDistribution',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'facetDeficits',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'underRepresented',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'sessionBlueprint',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'applyFacetBalance',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'formatDistribution',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'facetBalanceIsLive',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: draw computes the filter and logs facet-balance-shadow every draw; ELICIT_FACET_BALANCE=live graduates it (042)',
 },
 {
  module: 'src/queue/facet-balance',
  name: 'facetBalancedPool',
  status: 'shadow',
  shadowKind: 'facet-balance-shadow',
  reason: 'Q-35 shadow: the queue draw and the randomizer deck draw compose readVaultFacetDistribution → underRepresented → applyFacetBalance → facetBalanceIsLive through it; the shadow record is the draw sites\' own facet-balance logs (Wave A1)',
 },

 // ── src/queue/queue.ts ──
 { module: 'src/queue/queue', name: 'createQueueStore', status: 'live' },
{ module: 'src/queue/engagement', name: 'FRESH_ENGAGEMENT', status: 'live', reason: 'data: the Q-115 sitting-engagement ledger\'s fresh state — the queue store composes the ledger (Phase 5: sitting policy named as itself)' },
{ module: 'src/queue/queue', name: 'distinctFieldKeys', status: 'live', reason: 'wired: sweep-core composes it for its single-field pointer keys — territory, atlas and the clerk fold\'s snippet dedupe (Wave B); the composite bud+failure join rides pointerKeyFn on the same read' },
{ module: 'src/queue/queue', name: 'parkPointer', status: 'live', reason: 'wired (Wave A1): the two park modules (sounding/park, protocols/park) shape their parked-pointer drafts through it — the kinds stay the park modules\' own consts' },
 { module: 'src/queue/queue', name: 'isUserDeclaredWeight', status: 'live' },

 // ── src/queue/source-label.ts ──
 { module: 'src/queue/source-label', name: 'sourceLabel', status: 'live' },
 { module: 'src/queue/source-label', name: 'facetHeading', status: 'live' },
 { module: 'src/queue/source-label', name: 'lintNote', status: 'live' },

 // ── src/queue/mode-needs.ts ──
 { module: 'src/queue/mode-needs', name: 'moreMinutesThan', status: 'live' },
 { module: 'src/queue/mode-needs', name: 'moreEnergyThan', status: 'live' },
 { module: 'src/queue/mode-needs', name: 'ENERGY_LEVEL', status: 'live' },
 { module: 'src/queue/mode-needs', name: 'UNPROMPTED_MODE', status: 'live', reason: 'wired (Wave D3): the five server sites that start an unprompted sitting all spread it — one Mode declaration instead of five literals' },
 { module: 'src/queue/mode-needs', name: 'isMode', status: 'live', reason: 'wired (Wave D3): the session-start route enforces the energy union through it at the boundary' },

 // ── src/queue/open-question.ts (Wave D3 — the open-question entry base) ──
 { module: 'src/queue/open-question', name: 'openQuestionEntry', status: 'live', reason: 'wired (Wave D3): the four server mint sites (claim-challenged, gap-declared, gap-fill, defer) build the shared entry shape through it' },

 // ── src/randomizer/decks.ts ──
 { module: 'src/randomizer/decks', name: 'loadJsonlDecks', status: 'live' },
 { module: 'src/randomizer/decks', name: 'loadVaultDecks', status: 'live' },
 { module: 'src/randomizer/decks', name: 'loadDecks', status: 'live' },
 { module: 'src/randomizer/decks', name: 'deckCardRef', status: 'live' },

 // ── src/randomizer/license.ts ──
 { module: 'src/randomizer/license', name: 'licenseForDraw', status: 'live' },

 // ── src/randomizer/randomizer.ts ──
 { module: 'src/randomizer/randomizer', name: 'resurfaceQuestion', status: 'live' },
 { module: 'src/randomizer/randomizer', name: 'createRandomizer', status: 'live' },
 { module: 'src/randomizer/randomizer', name: 'anniversaryDraw', status: 'live' },

 // ── src/randomizer/strata.ts ──
 { module: 'src/randomizer/strata', name: 'readSittingDates', status: 'live' },
 { module: 'src/randomizer/strata', name: 'stratumFor', status: 'live' },
 { module: 'src/randomizer/strata', name: 'datedSnippets', status: 'live' },
 { module: 'src/randomizer/strata', name: 'stratify', status: 'live' },
 { module: 'src/randomizer/strata', name: 'bySitting', status: 'live' },

 // ── src/randomizer/thresholds.ts ──
 {
  module: 'src/randomizer/thresholds',
  name: 'RANDOMIZER_THRESHOLDS',
  status: 'live',
  reason: 'data: randomizer bounds and dry-spell windows, read by the randomizer modules',
 },
 {
  module: 'src/randomizer/thresholds',
  name: 'graduate',
  status: 'unwired',
  reason: 'no production caller — tests only; RANDOMIZER_THRESHOLDS ship as-is',
 },
 { module: 'src/randomizer/thresholds', name: 'daysBetween', status: 'live' },

 // ── src/server.ts ──
 { module: 'src/server', name: 'createApp', status: 'live' },
 { module: 'src/server', name: 'serveApp', status: 'live' },

 // ── src/session/routes.ts (Wave B — the session-flow cluster, extracted from src/server.ts) ──
 { module: 'src/session/routes', name: 'createSessionRoutes', status: 'live', reason: 'wired: createApp builds the SessionCtx and registers the session-flow cluster through it' },
 { module: 'src/session/routes', name: 'startBackgroundHarvest', status: 'live', reason: 'wired: the end flow, queue-answer, quest-return and artifact routes harvest behind the response through it' },
 { module: 'src/session/routes', name: 'startUnpromptedSitting', status: 'live', reason: 'wired: the five one-turn capture flows open their transcripts through it (S17)' },
 { module: 'src/session/routes', name: 'createSessionState', status: 'live', reason: 'wired: createApp builds the five session maps and the SessionCtx through it (F14)' },

// ── src/session/waiting.ts (Wave D1 — the waiting-surface cluster, extracted from src/server.ts) ──
{ module: 'src/session/waiting', name: 'createWaitingRoutes', status: 'live', reason: 'wired: createApp registers anniversary, harvest-queue, unprompted, sweep-backlog and the events feed through it (107/084/139/150)' },

 // ── src/stt/protocol.ts (the JSON-over-stdio contract, one declaration) ──
{ module: 'src/stt/protocol', name: 'encodeOutbound', status: 'live', reason: 'wired: the worker sends every response through it (Phase 8 — one contract for the child-process pipe)' },
{ module: 'src/stt/protocol', name: 'decodeInbound', status: 'live', reason: 'wired: the worker decodes every request through it, with shape validation the old JSON.parse lacked (Phase 8)' },
// ── src/stt/client.ts ──
 { module: 'src/stt/client', name: 'createSttClient', status: 'live' },

 // ── src/stt/model.ts ──
 { module: 'src/stt/model', name: 'resolveCacheDir', status: 'live' },
 { module: 'src/stt/model', name: 'resolveModelDir', status: 'live' },

 // ── src/vault/transcripts.ts (the transcript collection read/write owner) ──
{ module: 'src/vault/transcripts', name: 'readTranscripts', status: 'live', reason: 'wired (Phase 4): the single transcript-frontmatter read — lineage-mirror, strata, sitting, cadence, target-default and server.ts all parse through it' },
{ module: 'src/vault/transcripts', name: 'readTranscript', status: 'live', reason: 'wired: server.ts sessionStartedAt and the sitting reader use the single-file variant' },
{ module: 'src/vault/transcripts', name: 'appendClosing', status: 'live', reason: 'wired (Phase 4): the two closing sites in server.ts write the Q-20 section through it instead of raw appendFileSync' },
{ module: 'src/vault/transcripts', name: 'readTranscriptBody', status: 'live', reason: 'wired: server.ts readTranscript reroutes body reads through it — the last hand-rolled matter.read of a transcript in server.ts' },
{ module: 'src/vault/transcripts', name: 'mostRecentlyModifiedTranscript', status: 'live', reason: 'wired: the ticket-135 close scan in session/routes.ts picks the mtime-newest sitting through it' },
// ── src/vault/marginalia.ts (the shared marginalia layout) ──
{ module: 'src/vault/marginalia', name: 'writeMarginaliaLine', status: 'live', reason: 'wired: cover.ts and sounding-summary.ts write summary lines through it (Phase 4 — one marginalia layout owner)' },
{ module: 'src/vault/marginalia', name: 'readMarginaliaLine', status: 'live', reason: 'wired: loadSummaries and loadLadderSummary read through it' },
{ module: 'src/vault/marginalia', name: 'listMarginaliaFiles', status: 'live', reason: 'wired: loadSummaries enumerates through it' },
// ── src/vault/buds.ts (the buds/ layout — Q-6 annotations) ──
{ module: 'src/vault/buds', name: 'readBud', status: 'live', reason: 'wired: import/repair.ts quotes a deferred dangler Bud through it' },
// ── src/vault/vault.ts ──
 { module: 'src/vault/vault', name: 'createVault', status: 'live' },

 // ── src/wiki/clash.ts ──
 {
  module: 'src/wiki/clash',
  name: 'lexicalChannel',
  status: 'live',
  reason: 'channel value, stateless — wired at src/server.ts:320 into the clash pool',
 },
 { module: 'src/wiki/clash', name: 'referentChannel', status: 'live' },
 { module: 'src/wiki/clash', name: 'poolCandidates', status: 'live' },
{ module: 'src/wiki/clash', name: 'isLive', status: 'live', reason: 'the ONE live-claim predicate in the wiki slice — lint and the vector channel import it (Phase 8 consolidation)' },
{ module: 'src/wiki/clash', name: 'mostRecentlyUpdated', status: 'live', reason: 'the ONE recency rule in the wiki slice — fanoutWindow and the vector windowOf share it (Phase 8 consolidation)' },
 {
  module: 'src/wiki/clash',
  name: 'sameSitting',
  status: 'live',
  reason: 'Q-65 predicate: a pair joins two sittings unless both claims draw on exactly one shared sitting; drives the embedding rank order and the per-pair shadow field (ticket 083)',
 },

 // ── src/wiki/contract.ts ──
 { module: 'src/wiki/contract', name: 'shadowCollector', status: 'live' },
 { module: 'src/wiki/contract', name: 'assertUserTurn', status: 'live' },
 { module: 'src/wiki/contract', name: 'capPrompt', status: 'live' },
 { module: 'src/wiki/contract', name: 'fitPayload', status: 'live' },
 { module: 'src/wiki/contract', name: 'readingTime', status: 'live' },
{ module: 'src/wiki/contract', name: 'userTurn', status: 'live', reason: 'the ONE user-turn wrapper (Wave A2) — contradiction and composed folded their identical one-liners onto it, next to assertUserTurn' },

 // ── src/wiki/embedding.ts ──
 { module: 'src/wiki/embedding', name: 'primeable', status: 'live' },
 { module: 'src/wiki/embedding', name: 'bodyHash', status: 'live' },
 { module: 'src/wiki/embedding', name: 'cosine', status: 'live' },
 { module: 'src/wiki/embedding', name: 'fileEmbeddingStore', status: 'live' },
 { module: 'src/wiki/embedding', name: 'embeddingChannel', status: 'live' },
 { module: 'src/wiki/embedding', name: 'embedderConfig', status: 'live' },
 { module: 'src/wiki/embedding', name: 'localEmbedder', status: 'live' },
 { module: 'src/wiki/embedding', name: 'asRecord', status: 'live', reason: 'the ONE record parser — the wiki store and the semantic store share it (shared-primitives consolidation)' },
 { module: 'src/wiki/embedding', name: 'cachedVector', status: 'live', reason: 'the ONE cache validity check — both embedding channels share it (shared-primitives consolidation)' },
 { module: 'src/wiki/embedding', name: 'embedBatches', status: 'live', reason: 'the ONE prime loop — both embedding channels share it (shared-primitives consolidation)' },
 { module: 'src/wiki/embedding', name: 'vectorStoreFile', status: 'live', reason: 'the ONE vector-store file loader/saver — both file-backed stores delegate their load/save to it (Wave E)' },
 { module: 'src/wiki/embedding', name: 'pruneCache', status: 'live', reason: "the ONE cache prune — delete ids not kept, save sorted by claimId; both channels' persist delegate to it (Wave E)" },

 // ── src/wiki/lint.ts ──
 { module: 'src/wiki/lint', name: 'lint', status: 'live' },

 // ── src/wiki/ops.ts ──
 { module: 'src/wiki/ops', name: 'recomputeStatus', status: 'live' },
 { module: 'src/wiki/ops', name: 'applyOps', status: 'live' },
 { module: 'src/wiki/ops', name: 'asRecord', status: 'live', reason: 'runtime shape trio (Wave A2): the ONE plain-object check — op validation and store.ts file reads share it' },
 { module: 'src/wiki/ops', name: 'asStringArray', status: 'live', reason: 'runtime shape trio (Wave A2): the ONE all-strings-array check — op validation and store.ts file reads share it' },
 { module: 'src/wiki/ops', name: 'filled', status: 'live', reason: 'runtime shape trio (Wave A2): the ONE trimmed-non-empty-string check — op validation and store.ts file reads share it' },

 // ── src/wiki/registry.ts ──
 { module: 'src/wiki/registry', name: 'createRegistry', status: 'live' },
 { module: 'src/wiki/registry', name: 'nameSimilarity', status: 'live' },
 { module: 'src/wiki/registry', name: 'candidatePairs', status: 'live', reason: "wired (Wave A1): the shared candidate-pair sweep — Registry.mergeCandidates and lint's merge-candidate finding both run through it; named without 'merge' per Q-32 (no path to a merge, even by name)" },
 { module: 'src/wiki/registry', name: 'nameTokens', status: 'live', reason: 'wired (Wave A1): the ONE tokenizer — nameSimilarity and lint\'s namesOccasion tokenize through it' },

 // ── src/wiki/status.ts ──
 { module: 'src/wiki/status', name: 'sittingKey', status: 'live' },
 { module: 'src/wiki/status', name: 'sittingsOfCites', status: 'live' },
 { module: 'src/wiki/status', name: 'computeStatus', status: 'live' },
 { module: 'src/wiki/status', name: 'coreness', status: 'live' },
 { module: 'src/wiki/status', name: 'resolveCite', status: 'live', reason: 'wired (Wave A1): the ONE cite-resolution rule — lint fateOf, ops citeResolves and this module\'s evidence arithmetic all resolve through it' },
 { module: 'src/wiki/status', name: 'citeParts', status: 'live', reason: 'wired (Wave A1): the parse half of resolveCite — queue thread deferral and status facetsOf/coreness split cites through it' },
{ module: 'src/wiki/status', name: 'citeSnippetId', status: 'live', reason: 'wired (Wave A2): the id-half with full-cite fallback — wiki-jobs, docket, gap-fill and lint folded their cite.split(lastIndexOf) copies onto it' },

 // ── src/wiki/store.ts ──
 { module: 'src/wiki/store', name: 'createClaimStore', status: 'live' },
 { module: 'src/wiki/store', name: 'appendSweepDeferral', status: 'live' },
 { module: 'src/wiki/store', name: 'readSweepDeferral', status: 'live' },
 { module: 'src/wiki/store', name: 'readSweepDeferrals', status: 'live', reason: 'wired: the docket status endpoint renders the deferral list through it' },
 { module: 'src/wiki/store', name: 'writeStillTrueCursor', status: 'live' },
 { module: 'src/wiki/store', name: 'readStillTrueCursor', status: 'live' },
 { module: 'src/wiki/store', name: 'writeOutcomeCursor', status: 'live' },
 { module: 'src/wiki/store', name: 'readOutcomeCursor', status: 'live' },
 { module: 'src/wiki/store', name: 'writeResumeMarker', status: 'unwired', reason: 'ticket 139: the drain run that writes the marker is not wired; the store ships ahead of it' },
 { module: 'src/wiki/store', name: 'readResumeMarker', status: 'unwired', reason: 'ticket 139: same — read by the drain run when it lands' },
 { module: 'src/wiki/store', name: 'clearResumeMarker', status: 'unwired', reason: 'ticket 139: same — the drain run removes the marker after pickup' },

// ── src/wiki/page.ts (Wave D1 — the wiki page render, extracted from src/server.ts) ──
{ module: 'src/wiki/page', name: 'renderWikiPage', status: 'live', reason: 'wired: GET /api/wiki renders the page through it — grouping, ordering and coreness, one pure function' },
// ── src/wiki/routes.ts (Wave D1 — the wiki route cluster, extracted from src/server.ts) ──
{ module: 'src/wiki/routes', name: 'createWikiRoutes', status: 'live', reason: 'wired: createApp registers the wiki page and the claim verbs through it (Q-21/Q-33)' },

 // ── src/wiki/thresholds.ts (Q-35 turned into data) ──
 {
  module: 'src/wiki/thresholds',
  name: 'THRESHOLDS',
  status: 'live',
  reason: 'data: the threshold table; each entry carries its own live flag (Q-35/Q-56) and decisions pass through shadowDecision',
 },
 {
  module: 'src/wiki/thresholds',
  name: 'shadowDecision',
  status: 'shadow',
  shadowKind: 'shadow-decision',
  reason: 'Q-35 door: shadow mode writes shadow-decision, live mode writes threshold-clipped; per-threshold live flags decide',
 },
{ module: 'src/wiki/thresholds', name: 'readNumber', status: 'live', reason: 'the ONE numeric threshold-value read (Wave A2) — 13 call sites across wiki, clerk, coach, sounding, import and index folded their typeof-value casts onto it, each keeping its own fallback' },

 // ── src/import/adopt.ts ──
 {
  module: 'src/import/adopt',
  name: 'adoptPriorIngest',
  status: 'live',
  reason: 'called by the scan route (src/server.ts, T9) before admission — the one-off keeps and refusals',
 },

 // ── src/sounding/budget.ts ──
{ module: 'src/sounding/budget', name: 'rungAllowance', status: 'live', reason: 'wired by 012 T6: enterSounding computes the allowance from it' },
{ module: 'src/sounding/budget', name: 'expectedLengthSentence', status: 'live', reason: 'wired by 012 T8: the turn route renders the offer length' },

// ── src/sounding/convergence.ts ──
{ module: 'src/sounding/convergence', name: 'descentEnd', status: 'live', reason: 'wired by 012 T6: userTurn and applyGate call it' },

// ── src/index/lexical.ts (soundings slice Task 2 — the license's word API) ──
{ module: 'src/index/lexical', name: 'contentWordsOf', status: 'live' },
{ module: 'src/index/lexical', name: 'jaccard', status: 'live' },
 { module: 'src/index/lexical', name: 'echoesAny', status: 'live', reason: 'Phase 8: the convergence echo check calls it instead of buildIndex+resonate — a boolean trigram predicate, no ranked index, no Snippet-shaped inputs' },
{ module: 'src/index/lexical', name: 'contentWordSequence', status: 'live', reason: '119: the echo guard in composeOpener reads it to check summary n-gram overlap' },
{ module: 'src/index/lexical', name: 'isFunctionWord', status: 'live', reason: 'the shared closed-class word predicate (Wave A2) — lint namesOccasion composes it with its extra words, keeping FUNCTION_WORDS behavior a strict superset' },
{ module: 'src/index/lexical', name: 'wordsOf', status: 'live', reason: 'the sounding license counts word frequencies through it — the raw token stream (no stopword filter), single-homed on TOKEN_RE, replacing the WORD_RE mirror (Wave D F8)' },

// ── src/sounding/thresholds.ts (the gate's values as data) ──
{ module: 'src/sounding/thresholds', name: 'SOUNDING_THRESHOLDS', status: 'live', reason: 'data: the sounding gate values, each with a live flag and graduatesWhen (Q-35). Replaced the bare 0.10 and 6 literals (Phase 3)' },
// ── src/sounding/license.ts ──
{ module: 'src/sounding/license', name: 'licenseSounding', status: 'live', reason: 'wired by 012 T8: the turn route evaluates it on every turn' },

// ── src/sounding/park.ts (012 Task 7 — the only sounding module that touches disk) ──
{ module: 'src/sounding/park', name: 'writeLadder', status: 'live', reason: 'wired by 012 T8: finishDescent persists every finished ladder' },
{ module: 'src/sounding/park', name: 'readLadder', status: 'live', reason: 'wired by 012 T12: resumeSounding and the queue enrichment read it' },
{ module: 'src/sounding/park', name: 'parkPointer', status: 'live', reason: 'wired by 012 T8: the gate route mints the pointer on park' },

// ── src/protocols/park.ts (159 slice 5 — the machine side-record) ──
{ module: 'src/protocols/park', name: 'writeMachineState', status: 'live', reason: 'wired by 159 T5: the park gate route and every ratified advance write it' },
{ module: 'src/protocols/park', name: 'readMachineState', status: 'live', reason: 'wired by 159 T5: the machine resume route and the queue enrichment read it' },
{ module: 'src/protocols/park', name: 'removeMachineState', status: 'live', reason: 'wired by 159 T5: the end flows remove the record a finished sitting owns' },
{ module: 'src/protocols/park', name: 'parkMachinePointer', status: 'live', reason: 'wired by 159 T5: the park gate route mints the pointer on park' },

// ── src/sounding/ladder.ts (012 Task 6 — the descent ladder) ──
{ module: 'src/sounding/ladder', name: 'enterSounding', status: 'live', reason: 'wired by 012 T8: the accept route enters the descent' },
{ module: 'src/sounding/ladder', name: 'addRung', status: 'live' },
{ module: 'src/sounding/ladder', name: 'gateStateFor', status: 'live' },
{ module: 'src/sounding/ladder', name: 'applyGate', status: 'live', reason: 'wired by 012 T8: the gate route applies the choice' },
{ module: 'src/sounding/ladder', name: 'validateGateChoice', status: 'live', reason: 'wired (Wave D3): the sounding gate and the everyday gate both validate the choice word through it' },

// ── src/clerk/sounding-rung.ts (012 Task 6 — rung composition) ──
{ module: 'src/clerk/sounding-rung', name: 'composeRung', status: 'live' },

// ── src/sounding/compaction.ts (012 Task 10 — the resume's short view) ──
{ module: 'src/sounding/compaction', name: 'compactLadder', status: 'live', reason: 'wired by 012 T12: resumeSounding composes from it' },

// ── src/clerk/sounding-summary.ts (012 Task 11 — the ladder's one line, clerk model, marginalia) ──
{ module: 'src/clerk/sounding-summary', name: 'summarizeLadder', status: 'live' },
{ module: 'src/clerk/sounding-summary', name: 'saveLadderSummary', status: 'live' },
{
 module: 'src/clerk/sounding-summary',
 name: 'loadLadderSummary',
 status: 'live',
 reason: 'wired by 012 T12: the resume route reads the line for compactLadder',
},
{ module: 'src/clerk/sounding-summary', name: 'runLadderSummaries', status: 'live' },

// ── src/sounding/resume.ts (012 Task 12 — picking a parked descent back up) ──
{ module: 'src/sounding/resume', name: 'resumeSounding', status: 'live', reason: 'wired by 012 T12: the resume route calls it' },

// ── src/drm/types.ts (Q-85 — DRM types and constants) ──
// DRM_AFFECT_NUDGE is deliberately absent: it is a prompt string, and the
// sweep treats exported primitives and prompt strings as data (ticket 077).
{ module: 'src/drm/types', name: 'DRM_PROBE_QUESTIONS', status: 'live' },

// ── src/drm/state.ts (Q-85 — DRM state machine; ticket 159 slice 6 the
// transitions are pure functions over the machine's DrmUi) ──
{ module: 'src/drm/state', name: 'initDRM', status: 'live' },
{ module: 'src/drm/state', name: 'addEpisode', status: 'live' },
{ module: 'src/drm/state', name: 'doneEnumerating', status: 'live' },
{ module: 'src/drm/state', name: 'answerProbe', status: 'live' },
{ module: 'src/drm/state', name: 'buildProbeFragment', status: 'unwired', reason: 'used only in tests; server builds fragments through answerProbe' },
{ module: 'src/drm/state', name: 'applyGate', status: 'live' },
{ module: 'src/drm/state', name: 'resumeDRM', status: 'live', reason: 'slice 6: the drm resume route compat branch reads the legacy pre-machine park records' },
{ module: 'src/drm/state', name: 'gateReading', status: 'live' },
{ module: 'src/drm/state', name: 'probeQuestion', status: 'live' },
{ module: 'src/drm/state', name: 'transcriptQuestion', status: 'live' },
{ module: 'src/drm/state', name: 'affectQuestionWithNudge', status: 'unwired', reason: 'nudge handled in web UI; server route uses probeQuestion' },

// ── src/drm/park.ts (Q-85 — the LEGACY DRM park format) ──
// Slice 6: drm parks persist the machine side-record instead; nothing
// writes the legacy format in production, and readDRM is the compat read
// in the drm resume route.
{ module: 'src/drm/park', name: 'readDRM', status: 'live', reason: 'the drm resume route reads legacy pre-slice-6 park records through it' },

// ── src/clerk/sounding-rung.ts (012 Task 12 — the resumed rung's composition) ──
{ module: 'src/clerk/sounding-rung', name: 'composeFromCompacted', status: 'live', reason: 'wired by 012 T12: the resume route calls it' },

// ── src/coach/store.ts (the coach read-model) ──
{ module: 'src/coach/store', name: 'loadCoachFacts', status: 'live', reason: 'wired (Phase 4): server.ts buildCoachFacts delegates to it — the coach slice owns its read-model' },
// ── src/coach/contract.ts (090 T2 — the coach contract) ──
{ module: 'src/coach/contract', name: 'directionSlugFor', status: 'live', reason: 'live: createCoachStore (src/coach/store.ts) slugs every declared Direction' },
{ module: 'src/coach/contract', name: 'adviceGuard', status: 'live', reason: 'live: runCoachAdvice (src/coach/advise.ts) gates every mint through it (T7)' },
{ module: 'src/coach/contract', name: 'normalizeOption', status: 'live', reason: 'live from birth: adviceGuard calls it in this same module' },

// ── src/coach/store.ts (090 T3 — the coach store) ──
{ module: 'src/coach/store', name: 'createCoachStore', status: 'live', reason: 'live: the coach routes build it in src/server.ts (T9)' },
{ module: 'src/coach/store', name: 'readSittingTags', status: 'live', reason: 'live: buildCoachFacts in src/server.ts reads the sitting tags (T9)' },

// ── src/coach/license.ts (090 T5 — the licence) ──
{ module: 'src/coach/license', name: 'relevantClaims', status: 'live', reason: 'live from birth: evaluateOffer calls it in this same module (T5)' },
{ module: 'src/coach/license', name: 'evaluateOffer', status: 'live', reason: 'live: the waiting route calls it in src/server.ts (T9)' },
{ module: 'src/coach/license', name: 'licenseState', status: 'live', reason: 'live: refreshAdviceInBackground in src/server.ts reads it on every advice attempt (T10)' },
{ module: 'src/coach/license', name: 'somethingNew', status: 'live', reason: 'live: waitingLines (src/coach/page.ts) calls it (T8)' },

// ── src/coach/reflection.ts (090 T6 — the reflection follow-ups) ──
{ module: 'src/coach/reflection', name: 'mintReflections', status: 'live', reason: 'live: the return route calls it in src/server.ts (T10)' },

// ── src/coach/advise.ts (090 T7 — the one model call) ──
{ module: 'src/coach/advise', name: 'buildAdviceInput', status: 'live', reason: 'live from birth: runCoachAdvice calls it in this same module (T7)' },
{ module: 'src/coach/advise', name: 'runCoachAdvice', status: 'live', reason: 'live: refreshAdviceInBackground in src/server.ts calls it (T10)' },

// ── src/coach/page.ts (090 T8 — the page and the quiet lines) ──
{ module: 'src/coach/page', name: 'buildCoachPage', status: 'live', reason: 'live: the page route calls it in src/server.ts (T10)' },
{ module: 'src/coach/page', name: 'waitingLines', status: 'live', reason: 'live: the waiting route calls it in src/server.ts (T9)' },
{ module: 'src/coach/page', name: 'coachOfferSentence', status: 'live', reason: 'live: the waiting route calls it in src/server.ts (T9); named to dodge web/reach-line.ts offerSentence (090 T8)' },

// ── src/coach/routes.ts (Wave C1 — the coach route cluster, extracted from src/server.ts) ──
{ module: 'src/coach/routes', name: 'createCoachRoutes', status: 'live', reason: 'wired: the boot registers the coach cluster through it (090 T9/T10)' },

// ── src/env.ts ──
{ module: 'src/env', name: 'loadEnvFile', status: 'live', reason: 'server boot reads .env before any ELICIT_* read — machine config lives beside the server' },

// ── src/ktg/ (094 — KTG territory ontology instrument) ──
{ module: 'src/ktg/validator', name: 'validateKtgSkeleton', status: 'live', reason: 'pure, no I/O — the guard at load time (094 P1)' },
// ── src/ktg/validate-shared.ts (shared instrument validation scaffolding, Phase 8) ──
{ module: 'src/ktg/validate-shared', name: 'isStableSlug', status: 'live', reason: 'shared: both validators reject non-slug ids through it' },
{ module: 'src/ktg/validate-shared', name: 'strVal', status: 'live', reason: 'shared: the stricter (trim, reject-empty) field reader both validators use' },
{ module: 'src/ktg/validate-shared', name: 'intVal', status: 'live', reason: 'shared: integer field reader (KTG validator)' },
{ module: 'src/ktg/validate-shared', name: 'strArr', status: 'live', reason: 'shared: string-array field reader both validators use' },
{ module: 'src/ktg/validate-shared', name: 'objArr', status: 'live', reason: 'shared: object-array field reader (atlas validator)' },

{ module: 'src/ktg/loader', name: 'loadKtgSkeleton', status: 'live', reason: 'wired by 094: server loads a skeleton at docket time (P3)' },
{ module: 'src/ktg/loader', name: 'loadKtgSkeletonOrThrow', status: 'unwired', reason: 'no production caller — tests only; convenience over loadKtgSkeleton (094 P1, corrected by 095 verification)' },
{ module: 'src/ktg/coverage', name: 'createCoverageStore', status: 'live', reason: 'wired by 094: server creates the store for the territory sweep (P2). WRITE side parked (Phase 8, pinned by tests/coverage-asymmetry.test.ts): writeReading has no production caller — the store is always empty, every node reads back "unprobed". TWO CONSEQUENCES off the same empty store: the territory sweep is INERT (ktg/gap-fill.ts territoryCandidates needs an "evidenced" node for every pass) while the atlas sweep MINTS on "unprobed" (ktg/atlas-gap-fill.ts) — one run, one inert job, one minting job. Wiring a writer flips the test and this reason together.' },
{ module: 'src/ktg/gap-fill', name: 'runTerritoryGapFillSweep', status: 'live', reason: 'wired by 094: runDocket\'s thunk runs it as the territory gap-fill job (P3)' },
{ module: 'src/ktg/loader', name: 'loadAtlas', status: 'live', reason: 'wired by 110: server loads atlas instruments at docket time — the shared loader hosts both instruments (Phase 8)' },
{ module: 'src/ktg/loader', name: 'loadAtlasOrThrow', status: 'unwired', reason: 'no production caller — tests only; convenience over loadAtlas (110, hosted by the shared loader)' },
// ── src/ktg/atlas-* (110 — atlas territory instruments) ──
{ module: 'src/ktg/atlas-validator', name: 'validateAtlasInstrument', status: 'live', reason: 'pure, no I/O — the guard at load time (110)' },
{ module: 'src/ktg/coverage', name: 'createAtlasCoverageStore', status: 'live', reason: 'wired by 110: server creates atlas coverage stores for the sweep — the atlas store is the one parameterized implementation (Phase 8)' },
{ module: 'src/ktg/atlas-gap-fill', name: 'runAtlasGapFillSweep', status: 'live', reason: 'graduated 2026-08-03: server passes shadowMode:false — mints capped questions, one per region ever, deduped by atlasRegion' },
{ module: 'src/ktg/sweep-core', name: 'runGapFillSweepCore', status: 'live', reason: 'the shared cap/dedupe/coverage core behind the gap-fill sweeps (094/110/027) — called by runTerritoryGapFillSweep, runAtlasGapFillSweep and clerk runGapFillSweep, which delegate with their single-field or composite join keys' },
// ── src/territory.ts (152 — territory surface prototype) ──
{ module: 'src/territory', name: 'buildTerritoryResponse', status: 'live', reason: 'wired by 152: pure read surface joining ktg/atlas nodes with coverage readings (GET /api/territory)' },
// ── src/clerk/coach-seed.ts (Q-111 door-1 seeding, extracted from server.ts) ──
{ module: 'src/clerk/coach-seed', name: 'runCoachSeedSweep', status: 'live', reason: 'wired (Phase 6): the docket coachSeedSweep thunk — ZERO-LLM clustering of claim bodies into un-coached Directions' },
// ── src/clerk/gazetteer-extraction.ts (entity extraction, extracted from server.ts) ──
{ module: 'src/clerk/gazetteer-extraction', name: 'runGazetteerExtraction', status: 'live', reason: 'wired (Phase 6): the docket gazetteerExtraction thunk — model extraction capped at 5 snippets per run (Q-56)' },
// ── src/clerk/gazetteer-* (100 — gazetteer entity index) ──
{ module: 'src/clerk/gazetteer-store', name: 'createGazetteerStore', status: 'live', reason: 'wired by 100: server creates the store for extraction + frontier (store)' },
{ module: 'src/clerk/gazetteer', name: 'extractEntities', status: 'live', reason: 'wired by 100: extraction thunk calls it; model-calling, cap live at birth (Q-56)' },
{ module: 'src/clerk/gazetteer', name: 'entityId', status: 'live', reason: 'wired by 100: extraction docket job uses it for entity id derivation' },
{ module: 'src/clerk/gazetteer-frontier', name: 'runGazetteerFrontier', status: 'live', reason: 'graduated 2026-08-03: server passes shadowMode:false — mints capped frontier questions, one per entity ever, deduped on subjects' },
// ── src/patterns/types.ts (111 — the operator word map, beside the union) ──
{ module: 'src/patterns/types', name: 'OPERATOR_WORDS', status: 'live', reason: 'the words that name each operator (Q-81) — decompose reads it, so a new operator adds its words beside the union (Phase 8)' },
// ── src/patterns/ (111 — derivation patterns) ──
{ module: 'src/patterns/registry', name: 'loadPatterns', status: 'live', reason: 'pure, no I/O side effects beyond disk reads — loaded at composition time (111 T2)' },
{ module: 'src/patterns/registry', name: 'clearPatternCache', status: 'unwired', reason: 'no production caller — test seam only (111 T2, corrected by dispatcher verification)' },
{ module: 'src/patterns/registry', name: 'patternById', status: 'unwired', reason: 'no production caller yet — lookup awaits the docket wiring of composeWithPattern (111 remainder)' },
{ module: 'src/patterns/license', name: 'licensePattern', status: 'live', reason: 'pure predicate; gating what patterns are available (111 T2)' },
{ module: 'src/patterns/select', name: 'selectPattern', status: 'live', reason: 'caller-side shadow gate via threshold — the selection mechanism is shadow-first, the function ships live (111 T2)' },
{ module: 'src/patterns/select', name: 'selectCheapPattern', status: 'live', reason: 'same pattern — shadow gate in caller, function ships live (111 T2)' },
{ module: 'src/patterns/select', name: 'selectDeepPattern', status: 'unwired', reason: 'no production caller yet — the Sounding consent gate passes a pattern in when deep integration wires up (111 remainder)' },
{ module: 'src/clerk/composed', name: 'findQuotedFragment', status: 'live', reason: 'the shared longest-verbatim-fragment primitive behind checkQuotesSource (composed.ts:198) and findSetOffFragment (composed.ts:110); arrangements.ts imports it with the gate it deleted (Wave B2)' },
{ module: 'src/language/guards', name: 'quotedSpans', status: 'live', reason: 'exported by 111 for the decomposition guard and quote masking' },
{ module: 'src/patterns/decompose', name: 'decomposeDerived', status: 'live', reason: 'pure predicate with no I/O — the Q-81 boundary guard; callers outside tests do not yet exist (111 T4)' },
// ── src/clerk/compose-pattern.ts (111 — pattern-aware composition) ──
{ module: 'src/clerk/compose-pattern', name: 'composeWithPattern', status: 'live', reason: 'LLM-calling composition path with decomposition guard — shadow gate in caller, function ships live (111 T5)' },
// ── src/defs/loader.ts (the shared def-registry loader) ──
{ module: 'src/defs/loader', name: 'createDefRegistry', status: 'live', reason: 'the shared enumeration/parse/cache loader behind the pattern and protocol disk registries' },
];
