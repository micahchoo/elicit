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
 *   pass through `shadowDecision`. The bound entries below therefore
 *   mirror their own `live` flag rather than the channel's wiring.
 * - Callers are found by identifier on blanked source, so a same-named
 *   private symbol elsewhere reads as a caller. That class has bitten
 *   twice (`userTurn`, `nameSimilarity`, `quotedSpans`) and is harmless
 *   as long as the real status stays live.
 * - Callers inside an unwired module count. The semantic bounds are
 *   declared live by Q-56 even though the channel that reads them is
 *   unwired — the channel entries below carry that truth.
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

 // ── src/clerk/composed.ts ──
 { module: 'src/clerk/composed', name: 'redLights', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeFollowUp', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeJuxtaposition', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeOpener', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeStillTrue', status: 'live' },
 { module: 'src/clerk/composed', name: 'isExpeditionCandidate', status: 'live' },
 { module: 'src/clerk/composed', name: 'composeExpedition', status: 'live' },

 // ── src/clerk/contradiction.ts ──
 { module: 'src/clerk/contradiction', name: 'judgeOpposition', status: 'live' },
 { module: 'src/clerk/contradiction', name: 'composeRemeasure', status: 'live' },
 { module: 'src/clerk/contradiction', name: 'judgeConfirmation', status: 'live' },

 // ── src/clerk/docket.ts ──
 { module: 'src/clerk/docket', name: 'runDocket', status: 'live' },

 // ── src/clerk/mint.ts ──
 { module: 'src/clerk/mint', name: 'proposeOps', status: 'live' },

 // ── src/clerk/sitting.ts ──
 { module: 'src/clerk/sitting', name: 'readSitting', status: 'live' },
 { module: 'src/clerk/sitting', name: 'sittingCache', status: 'live' },

 // ── src/clerk/wiki-jobs.ts ──
 {
  module: 'src/clerk/wiki-jobs',
  name: 'dissolutionOutcome',
  status: 'live',
 },
 { module: 'src/clerk/wiki-jobs', name: 'runWikiJobs', status: 'live' },
 {
  module: 'src/clerk/wiki-jobs',
  name: 'OPPOSITION_QUOTA',
  status: 'live',
  reason: 'Q-56 bound, ships live (a quota in shadow is not a quota); clip records resize it',
 },

 // ── src/elicitor/answer-shape.ts ──
 { module: 'src/elicitor/answer-shape', name: 'isContentFree', status: 'live' },

 // ── src/elicitor/bank.ts ──
 { module: 'src/elicitor/bank', name: 'loadQuestionBank', status: 'live' },

 // ── src/elicitor/elicitor.ts ──
 { module: 'src/elicitor/elicitor', name: 'startSession', status: 'live' },
 { module: 'src/elicitor/elicitor', name: 'userTurn', status: 'live' },
 { module: 'src/elicitor/elicitor', name: 'skipQuestion', status: 'live' },

 // ── src/elicitor/facet-intent.ts ──
 {
  module: 'src/elicitor/facet-intent',
  name: 'classifyFacetIntent',
  status: 'unwired',
  reason: 'script-only consumer — scripts/curate-deck.ts (offline deck curation); no src/web caller',
 },
 { module: 'src/elicitor/facet-intent', name: 'facetIntentForRedLight', status: 'live' },

 // ── src/elicitor/guards.ts ──
 { module: 'src/elicitor/guards', name: 'isInterrogative', status: 'live' },
 { module: 'src/elicitor/guards', name: 'setOffSpans', status: 'live' },
 { module: 'src/elicitor/guards', name: 'quotesFragmentSetOff', status: 'live' },
 { module: 'src/elicitor/guards', name: 'hasFirstPersonOutsideQuote', status: 'live' },
 { module: 'src/elicitor/guards', name: 'isParrot', status: 'live' },
 { module: 'src/elicitor/guards', name: 'isConversationReferential', status: 'live' },
 { module: 'src/elicitor/guards', name: 'isNearDuplicate', status: 'live' },
 { module: 'src/elicitor/guards', name: 'checkQuestion', status: 'live' },

 // ── src/elicitor/protocol.ts ──
 {
  module: 'src/elicitor/protocol',
  name: 'PROTOCOLS',
  status: 'unwired',
  reason: 'no production caller — the file-based protocol registry (protocols/defs via getProtocol) replaced this table',
 },

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

 // ── src/index/watermark.ts (ticket 076 — the docket's two gates) ──
 // Both gates are read at the top of every wiki run in src/clerk/wiki-jobs.ts:
 // vaultDiff/changedIn decide the queue-driven jobs, and the fingerprint
 // trio decides the graph-derived passes.
 { module: 'src/index/watermark', name: 'vaultDiff', status: 'live' },
 { module: 'src/index/watermark', name: 'changedIn', status: 'live' },
 { module: 'src/index/watermark', name: 'fingerprintOf', status: 'live' },
 { module: 'src/index/watermark', name: 'sameFingerprint', status: 'live' },
 { module: 'src/index/watermark', name: 'readWatermark', status: 'live' },
 { module: 'src/index/watermark', name: 'writeWatermark', status: 'live' },
 { module: 'src/index/watermark', name: 'claimDelta', status: 'live' },

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
 {
  module: 'src/index/semantic',
  name: 'SEMANTIC_FLOOR',
  status: 'shadow',
  shadowKind: 'shadow-decision',
  reason: 'Q-35 threshold, live:false — read by buildSemanticIndex through shadowDecision; the channel now runs on every turn, so the shadow record accrues',
 },
 {
  module: 'src/index/semantic',
  name: 'PRIME_CAP_BOUND',
  status: 'live',
  reason: 'Q-56 bound, live:true by declaration — enforced inside the semantic channel, which 068 wired into the boot path',
 },
 {
  module: 'src/index/semantic',
  name: 'PRIME_BUDGET_BOUND',
  status: 'live',
  reason: 'Q-56 bound, live:true by declaration — enforced inside the semantic channel, which 068 wired into the boot path',
 },
 {
  module: 'src/index/semantic',
  name: 'QUERY_BUDGET_BOUND',
  status: 'live',
  reason: 'Q-56 bound, live:true by declaration — enforced inside the semantic channel, which 068 wired into the boot path',
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
  status: 'unwired',
  reason: 'no production caller yet — tests only; the import route layer lands in a later wave',
 },

 // ── src/import/store.ts ──
 {
  module: 'src/import/store',
  name: 'createImportStore',
  status: 'unwired',
  reason: 'no production caller yet — extract.ts (T5) imports it in a later wave; scripts and tests do not count',
 },

 // ── src/import/extract.ts ──
 {
  module: 'src/import/extract',
  name: 'runImportExtraction',
  status: 'unwired',
  reason: 'no production caller yet — the docket wiring (T6) calls it in a later wave; tests do not count',
 },

 // ── src/llm.ts ──
 { module: 'src/llm', name: 'roleConfig', status: 'live' },
 { module: 'src/llm', name: 'describeRole', status: 'live' },
 { module: 'src/llm', name: 'makeComplete', status: 'live' },

 // ── src/log/activity.ts ──
 { module: 'src/log/activity', name: 'appendEvent', status: 'live' },
 { module: 'src/log/activity', name: 'readEvents', status: 'live' },

 // ── src/log/cadence.ts ──
 { module: 'src/log/cadence', name: 'readCadence', status: 'live' },
 { module: 'src/log/cadence', name: 'cadenceSentence', status: 'live' },

 // ── src/log/format.ts ──
 {
  module: 'src/log/format',
  name: 'hasSentence',
  status: 'unwired',
  reason: 'no production caller — tests only; the feed renders via formatEvent keying SENTENCES directly',
 },
 { module: 'src/log/format', name: 'formatEvent', status: 'live' },
 { module: 'src/log/format', name: 'relativeTime', status: 'live' },

// ── src/log/surfaced.ts ──
{ module: 'src/log/surfaced', name: 'surfaced', status: 'live' },

// ── src/memory/cover.ts ──
 {
  module: 'src/memory/cover',
  name: 'cover',
  status: 'unwired',
  reason: '030 wired nextConsolidation/saveSummary/loadSummaries, not the tiler — cover() has no production caller; tests only',
 },
 { module: 'src/memory/cover', name: 'nextConsolidation', status: 'live' },
 { module: 'src/memory/cover', name: 'saveSummary', status: 'live' },
 { module: 'src/memory/cover', name: 'loadSummaries', status: 'live' },

 // ── src/protocols/registry.ts ──
 { module: 'src/protocols/registry', name: 'loadProtocolDefinitions', status: 'live' },
 { module: 'src/protocols/registry', name: 'selectProtocolForTarget', status: 'live' },
 { module: 'src/protocols/registry', name: 'getProtocol', status: 'live' },

 // ── src/protocols/yield.ts ──
 {
  module: 'src/protocols/yield',
  name: 'computeYield',
  status: 'unwired',
  reason: 'no production caller — tests/protocols.test.ts only; yield reporting was never surfaced',
 },

 // ── src/queue/bank-filter.ts ──
 { module: 'src/queue/bank-filter', name: 'isWeakForm', status: 'live' },

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

 // ── src/queue/queue.ts ──
 { module: 'src/queue/queue', name: 'createQueueStore', status: 'live' },

 // ── src/queue/source-label.ts ──
 { module: 'src/queue/source-label', name: 'sourceLabel', status: 'live' },
 { module: 'src/queue/source-label', name: 'facetHeading', status: 'live' },
 { module: 'src/queue/source-label', name: 'lintNote', status: 'live' },

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

 // ── src/stt/client.ts ──
 { module: 'src/stt/client', name: 'createSttClient', status: 'live' },

 // ── src/stt/model.ts ──
 { module: 'src/stt/model', name: 'resolveCacheDir', status: 'live' },
 { module: 'src/stt/model', name: 'resolveModelDir', status: 'live' },

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

 // ── src/wiki/embedding.ts ──
 { module: 'src/wiki/embedding', name: 'primeable', status: 'live' },
 { module: 'src/wiki/embedding', name: 'bodyHash', status: 'live' },
 { module: 'src/wiki/embedding', name: 'cosine', status: 'live' },
 { module: 'src/wiki/embedding', name: 'fileEmbeddingStore', status: 'live' },
 { module: 'src/wiki/embedding', name: 'embeddingChannel', status: 'live' },
 { module: 'src/wiki/embedding', name: 'embedderConfig', status: 'live' },
 { module: 'src/wiki/embedding', name: 'localEmbedder', status: 'live' },

 // ── src/wiki/lint.ts ──
 { module: 'src/wiki/lint', name: 'lint', status: 'live' },

 // ── src/wiki/ops.ts ──
 { module: 'src/wiki/ops', name: 'recomputeStatus', status: 'live' },
 { module: 'src/wiki/ops', name: 'applyOps', status: 'live' },

 // ── src/wiki/registry.ts ──
 { module: 'src/wiki/registry', name: 'createRegistry', status: 'live' },
 { module: 'src/wiki/registry', name: 'nameSimilarity', status: 'live' },

 // ── src/wiki/status.ts ──
 { module: 'src/wiki/status', name: 'sittingKey', status: 'live' },
 { module: 'src/wiki/status', name: 'sittingsOfCites', status: 'live' },
 { module: 'src/wiki/status', name: 'computeStatus', status: 'live' },
 { module: 'src/wiki/status', name: 'coreness', status: 'live' },

 // ── src/wiki/store.ts ──
 { module: 'src/wiki/store', name: 'createClaimStore', status: 'live' },
 { module: 'src/wiki/store', name: 'appendSweepDeferral', status: 'live' },
 { module: 'src/wiki/store', name: 'readSweepDeferral', status: 'live' },
 { module: 'src/wiki/store', name: 'writeStillTrueCursor', status: 'live' },
 { module: 'src/wiki/store', name: 'readStillTrueCursor', status: 'live' },

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

 // ── src/import/adopt.ts ──
 {
  module: 'src/import/adopt',
  name: 'adoptPriorIngest',
  status: 'unwired',
  reason: 'no production caller yet — the scan route (T9) calls it before admit in a later wave; tests and scripts do not count',
 },
];
