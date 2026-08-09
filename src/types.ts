// Domain types for the Elicit project
// Encode invariants from CONTEXT.md as visible type constraints

import type { SemanticIndex } from './index/semantic.js';
import type { PatternId, Operator } from './patterns/types.js';
import type { MachineState } from './protocols/machine.js';

export type Facet =
 | 'episode'
 | 'general-event'
 | 'lifetime-period'
 | 'fact'
 | 'construct'
 | 'intention'
 | 'value'
 | 'causal-theory'
 | 'know-what'
 | 'know-how'
 | 'habit'
 | 'know-why'
 | 'momentary-state';

export type Stance =
 | 'avowal'
 | 'self-observation'
 | 'report-of-fact'
 | 'pole-preference'
 | 'commitment'
 | 'uncertainty-marked'
 | 'superseded'
 | 'role-taking';

export type QuestionForm = 'deliberative' | 'theoretical' | 'why';
export type QuestionSource = {
 channel: string;
 channelTitle?: string;
 blockId: number;
};
export type QuestionProvenance =
 | 'bank'
 | 'composed'
 | 'juxtaposition'
 | 'probe'
 | 'close'
 | 'skip'
 // The Randomizer's two channels, and the only two Q-18 allows. Both are
 // shuffles of material that already exists — a curated deck, or the person's
 // own older words — so neither can be produced by a model.
 | 'deck'
 | 'resurfacing'
 // Territory-gap-fill questions minted from KTG instrument data (094)
 // (the dead 'territory' member was deleted in Phase 8 — nothing minted with it)
 // The opening pulse — momentary-state convention at sitting start (105)
 | 'pulse'
// The greeting turn — one framing line at sitting start (ticket 135)
| 'greeting'
// Lineage mirror — a question composed from usage facts (Q-83)
 | 'lineage-mirror'
// The phase machine's current-phase question (ticket 159, slice 3)
 | 'machine'
 // Repair — the fixed template turn acknowledging a pressed not-mine (Q-105)
 | 'repair';

/**
 * How far the writing is from the person reading it now (Q-18,
 * "depth-stratified"). The bands are age of the WRITING, taken from the
 * sitting's `started` date, never from when a file happened to be imported.
 * `src/randomizer/thresholds.ts` holds the boundaries.
 */
export type Stratum = 'recent' | 'season' | 'years' | 'deep';

/**
 * Where a Randomizer question came from, in enough detail to find it again.
 * Q-18 forbids the agent inventing a "random" question, so every draw must be
 * able to name the thing it shuffled — the deck and card, or the snippet and
 * the day it was written.
 */
export type DrawProvenance =
 | { kind: 'deck'; deck: string; channel: string; blockId: number }
 | {
  kind: 'resurfacing';
  snippetId: string;
  version: number;
  stratum: Stratum;
  /** ISO date of the SITTING the snippet came from, not of its import. */
  wroteAt: string;
 }
 | {
  kind: 'anniversary';
  snippetId: string;
  version: number;
  stratum: Stratum;
  /** ISO date of the sitting the snippet came from. */
  wroteAt: string;
 };

/**
 * What the lineage mirror read — the evidence variant for mirror questions
 * (Q-83, Q-18's rule: name what you read).
 *
 * The type is structurally sealed: only neutral usage facts the person can
 * already see on their own surfaces — timestamps, counts, cadence. Skips,
 * deferrals, refusals, and dormancy have no fields here and cannot be
 * represented (Q-78 pattern: the reader type simply has no fields for them).
 */
export type LineageRead = {
  /** The claim this lineage was read against. */
  claimId: string;
  /** When the claim was created (ISO). */
  claimCreated: string;
  /** When the claim was last updated, or same as created (ISO). */
  claimUpdated: string;
  /** Total sittings, excluding imports. */
  totalSittings: number;
  /** Sittings in the 30 days before the read. */
  sittingsInLastMonth: number;
  /** Days since the most recent sitting (at read time). */
  daysSinceLastSitting: number;
  /** Days between first and most recent sitting, divided by (total-1); 0 when <2 sittings. */
  averageDaysBetween: number;
};

/**
 * One curated Randomizer deck entry. `targetFacet` is the question's INTENT —
 * what kind of person-knowledge it asks for — assigned at curation time so the
 * facet-balance filter has something to filter on (ticket 042).
 */
export type DeckEntry = {
 question: string;
 channel: string;
 channelTitle?: string;
 blockId: number;
 /** Deck file the entry belongs to, e.g. 'episodes'. */
 deck: string;
 /**
  * OPTIONAL, and absent means unknown — never guessed (ticket 042's rule for
  * `QueueEntry.targetFacet`, which this now matches). `scripts/curate-deck.ts`
  * assigns one to every shipped entry, so nothing there changes; a deck the
  * person writes by hand in vault markdown may carry none, and the Randomizer
  * must pass that silence through rather than invent an intent for it (Q-18).
  */
 targetFacet?: Facet;
 /** Curation provenance: which script or person selected this entry. */
 curatedBy: string;
};

export type Target = 'self' | 'domain';

export type Mode = {
 minutes: number;
 energy: 'low' | 'medium' | 'high';
 topic?: string;
 target?: Target;
};

export type Turn = {
 role: 'agent' | 'user';
 text: string;
 at: string;
 /** Present on agent turns; the eliciting probe's QuestionForm tag */
 questionForm?: QuestionForm;
 /** Source provenance when this is a bank-drawn question */
 questionSource?: QuestionSource;
 /**
  * The Gap this question was asked to fill, when it was drawn from a
  * gap-sourced queue entry (hop 2 of the gap link, Q-39). Absent means
  * the question did not come from a gap.
  */
 gap?: string;
 /** Set in memory when the user skips this agent turn — never persisted to disk */
 skipped?: true;
 /** True when this user turn included dictated (STT) text — evidence tag only */
 spoken?: true;
 /** Prosody captured from STT — lineage-only trace (ticket 108). */
 prosody?: Prosody;
 /** Provenance tag for the eliciting question (105). Absent means unspecified. */
 questionProvenance?: QuestionProvenance;
 /** When set, this turn is part of a repair exchange — excluded from harvest (Q-107). */
 repairId?: string;
};

/**
 * Prosody data captured from STT — lineage-only trace.
 * Evidence for future readings ("said haltingly" is agent judgment about the
 * saying, Marginalia-class). Q-11 fluency ban: nothing selects, weights, or
 * scores on these fields (ticket 108).
 */
export type Prosody = {
 /** Wall-clock ms the STT decode took on the server */
 decodeDurationMs: number;
 /** Audio length in ms (samples / sampleRate * 1000) */
 audioDurationMs: number;
 /** Token count reported by the recognizer */
 tokenCount: number;
 /** Average tokens per second across the active speech span */
 tokensPerSec: number;
 /** Count of inter-token gaps >= 0.5 seconds */
 pauseCount: number;
};

export type CutProposal = {
 /** Verbatim text proposed as a Snippet — untrusted until substring-validated (Q-1) */
 text: string;
 /** Index into the transcript's user turns */
 sourceTurn: number;
 facet: Facet;
 stance: Stance;
 /** Agent's one-line reading of the cut */
 reading: string;
 /** The eliciting question that produced this cut */
 question: string;
 /** Copied from the eliciting probe's Turn.questionForm */
 questionForm: QuestionForm;
 questionSource?: QuestionSource;
 /**
  * The Gap this cut answers, copied from the eliciting probe's turn (hop 3
  * of the gap link, Q-39). Absent means the cut did not answer a gap.
  */
 gap?: string;
 /** Preceding sentences from the source turn — mechanically extracted, display-only */
 context?: string;
 /** Copied from the eliciting probe's Turn.questionProvenance (105). */
 questionProvenance?: QuestionProvenance;
};

/** How the words arrived at the box, when the client can tell (ticket 048). */
export type CaptureChannel = 'typed' | 'spoken' | 'pasted';

/** The channels a client may declare for a turn's arrival (ticket 048). */
export const CAPTURE_CHANNELS: readonly CaptureChannel[] = ['typed', 'spoken', 'pasted'];

/** Narrowing guard for a capture channel value sent by the client. */
export function isCaptureChannel(v: unknown): v is CaptureChannel {
 return (CAPTURE_CHANNELS as readonly unknown[]).includes(v);
}

export type HarvestDecision = {
 /** Index into the proposals array */
 proposal: number;
 action: 'approve' | 'trim' | 'discard' | 'restate';
 /** Required for 'trim' (must be a substring of proposal text) and 'restate' */
 text?: string;
 /**
  * Capture channel for the restated text (ticket 048). Only the 'restate'
  * action uses it — a restatement is new prose and may be pasted into the
  * review box, which no derivation from the source turn can see. approve and
  * trim take the source turn's channel via decide's channelOf. Absent means
  * unknown and stays absent.
  */
 channel?: CaptureChannel;
};

export type Provenance = {
 /**
  * 'composition' — the prose was written inside a Piece (Q-40); 'unprompted'
  * — the user wrote or pasted the material with no eliciting question
  */
 kind: 'harvest' | 'restatement' | 'unprompted' | 'composition';
 session: string;
 /** Empty string when kind is 'unprompted' — nothing asked for these words */
 question: string;
 questionForm: QuestionForm;
 /** Source span in the transcript (harvest only) */
 span?: { start: number; end: number };
 questionSource?: QuestionSource;
 /**
  * The Piece the prose was written in (Q-40). Optional, and absent means
  * the prose did not come from a Piece — never a guessed one (Q-60).
  * Never written on any other path.
  */
 piece?: string;
 /**
  * The Gap question this snippet answered (hop 4 of the gap link, Q-39).
  * Optional, and absent means the words did not answer a gap — never read
  * as anything else, nothing filters on it, no model sees it. The link
  * lives in Provenance frontmatter, never in the Snippet body (Q-4).
  */
 gap?: string;
 /**
  * The sentence(s) immediately preceding the cut in its source turn —
  * verbatim, mechanically extracted by offset math with no model call.
  * Absent when the cut opened its source turn and the eliciting question
  * (already stored in `question`) is the sole antecedent.
  *
  * LINEAGE, not corpus. The person's own words but never approved in review.
  * Display-only, dimmed. The Clerk MUST NOT mint from it, resonance MUST NOT
  * index it, no Piece may include it, no Reading may cite it. This invariant
  * lives in the ticket specification (073-antecedent-context) and is
  * verified by the invariant test.
  */
 context?: string;
 /**
  * How the words arrived: keyed in, dictated, or pasted from somewhere else
  * (ticket 048). Sole Authorship guarantees that no agent wrote or reworded
  * a Snippet; it does not guarantee the user composed it. The client can
  * tell a paste from a keystroke at the moment of capture, and one tick
  * later nobody can, so the distinction is recorded here or lost.
  *
  * OPTIONAL, and absent means UNKNOWN — never 'typed'. Every Snippet already
  * on disk was captured before this field existed, and reading 'typed' into
  * their silence would manufacture evidence about how they arrived.
  *
  * Evidence, not a gate: nothing filters on it, nothing scores it, no model
  * sees it. It exists so a later decision has something true to read.
  */
 channel?: CaptureChannel;
/**
 * The eliciting question's provenance tag — the question's source
 * classification (105). Threaded through harvester from the eliciting
 * probe Turn. Absent means unspecified.
 */
questionProvenance?: QuestionProvenance;
/**
 * Who wrote it, DECLARED (Q-70). Absent means never asked — every snippet
 * written before this field existed, and every snippet from a live sitting.
 * Absent must never be read as 'authored'; a consumer that treats missing as
 * authored has reintroduced the bug ticket 046 is about.
 */
authorship?: 'authored' | 'other' | 'machine-assisted';
};

export type Snippet = {
 id: string;
 version: number;
 captured: string;
 provenance: Provenance;
 prose: string;
};

export type Reading = {
 id: string;
 facet: Facet;
 stance: Stance;
 /** Citations as "snippetId@version" strings */
 cites: string[];
 reading: string;
 /**
  * When the reading was written. Distinct from the ULID's own time only in
  * that it survives a file the id no longer explains.
  */
 at?: string;
 /**
  * Which model wrote it, and when that model last read it (Q-34). Two
  * timestamps rather than one because re-annotation is lazy: an upgraded
  * model re-reads what the Docket touches anyway and restamps `modelAt`,
  * while `at` keeps saying when the reading happened.
  *
  * All three are optional because every reading file written before the
  * stamp existed has none of them and must keep parsing.
  */
 model?: string;
 modelAt?: string;
};

export type Bud = {
 id: string;
 captured: string;
 session: string;
 failures: string[];
 fragment: string;
};

// ── Slice 2: resonance, queue, docket ──

export type ResonanceHit = {
 snippetId: string;
 version: number;
 /** Exact substring shared by query text AND snippet text */
 sharedPhrase: string;
 score: number;
 snippetText: string;
};

export type RedLight = {
 kind:
 | 'odd-term'
 | 'unexplored-referent'
 | 'abstraction-no-episode'
 | 'pole-no-contrast'
 | 'cause-no-event';
 /** Exact substring of the user turn that triggered the light */
 phrase: string;
};

export type QueueEntry = {
 id: string;
 /**
  * 'parked' is the person's own act (POST /api/queue/:id/park): the question
  * rests out of the open pool, is never drawn and never expired, until they
  * put it back. Distinct from 'deferred', which stays in the draw.
  */
 status: 'pending' | 'asked' | 'answered' | 'deferred' | 'expired' | 'parked';
/**
 * Which situation licensed the question. The person's own declarations —
 * typed in directly, or placed as a gap to fill — are the only two that
 * weigh differently (`isUserDeclaredWeight`), and `expire` tests the literal
 * 'user-declared' only. `src/queue/source-label.ts` keys a `Record` by this
 * union, so a new member fails to COMPILE until it has a label — the same
 * exhaustiveness obligation a switch would impose, by a different mechanism.
 */
source:
 | 'composed'
 | 'still-true'
 | 'user-declared'
 | 'gap-declared'
 | 'gap-fill'
 | 'contradiction-remeasure'
 | 'lint-still-true'
 | 'lint-undiscriminated-range'
 | 'parked-sounding'
 | 'parked-drm'
 | 'parked-machine'
 | 'claim-challenged'
 | 'import-repair'
 | 'quest-reflection'
 | 'territory-gap-fill'
 | 'gazetteer-frontier'
 | 'atlas-gap-fill'
 // Ticket 106: outcome questions — "did this intention come to pass?"
 | 'outcome'
 // Lineage mirror — questions minted from usage facts (Q-83)
 | 'lineage-mirror';
 license: string;
 question: string;
 questionForm: QuestionForm;
 cites?: string[];
 quotedFragment?: string;
 /**
  * The Claim a lint-minted still-true question is about. Optional, because
  * only `lint-still-true` entries carry one — and load-bearing, because
  * Q-31's "one still-true question per flagged Claim" is not expressible
  * without it: a composed still-true draft cites a single
  * `snippetId@version`, so deduping through the snippet would let two Claims
  * resting on one stale snippet suppress each other's question.
  */
 claim?: string;
 /**
  * The quest a reflection question follows (Q-75). Optional, because only
  * 'quest-reflection' entries carry one — and load-bearing, because the
  * (quest, session) pair is the dedupe key: without it a second return
  * would re-mint the same two questions forever.
  */
 quest?: string;
 /**
  * The Gap this entry was minted to fill. Optional, because only
  * gap-sourced entries carry one — and load-bearing, because the snippet
  * that answers it has to name the Gap it came from. Exactly the shape of
  * `claim`, which exists for the same reason: a join key from the entry to
  * the thing that licensed it, across restarts (Q-39).
  */
 gap?: string;
 /**
  * The Bud this entry was minted for, and the recorded failure it asks
  * about. Optional, because only gap-fill entries minted by the Bud sweep
  * carry them — and load-bearing, because "one question per recorded
  * failure" (ticket 027) is not expressible without the pair as the dedupe
  * key: the Bud id alone would let two failures of one Bud suppress each
  * other's question. Same shape as `claim` and `gap`, which exist for the
  * same reason (Q-31, Q-39).
  */
 bud?: string;
 failure?: string;
 /**
  * The snippet a half-Construct question is about. Optional, because only
  * gap-fill entries minted by the construct sweep carry one — and
  * load-bearing, because "one contrast question per half-Construct" is not
  * expressible without it: a construct-facet reading cites a version, and
  * deduping through the cite would let two readings of one snippet mint
  * two questions about the same pole (ticket 027).
  */
 snippet?: string;
 /**
  * The two Claims an `undiscriminated-range` question stands between
  * (ticket 060). Optional, because only `lint-undiscriminated-range` entries
  * carry one — and load-bearing, because the sorted pair is the dedupe key
  * T12 keys on, and the answer must route back to two SUPERSEDEs.
  */
 claims?: string[];
 /**
  * The sitting Target this question belongs to — carried from the sitting
  * whose material minted it, not from the question's wording. A domain
  * sitting must never be handed self material (ticket 045).
  *
  * Optional, and absent is not 'self': an entry whose origin is unknown
  * makes no target claim and stays eligible for either kind of sitting.
  * Entries written before this field existed load exactly that way.
  */
 target?: Target;
 /**
  * The sitting topic, when the minting path knows it. Recorded as evidence
  * and for legibility — the draw filters on `target`, never on this, because
  * free-text topics do not compare.
  */
 topic?: string;
 /**
  * The Facet this question asks for — its INTENT, unrelated to `target`
  * above. Optional: an entry whose intent is unknown carries no facet claim
  * rather than a guessed one, and the balance filter treats it as unknown,
  * never as construct.
  */
 targetFacet?: Facet;
 modeNeeds?: { minMinutes?: number; energy?: 'low' | 'medium' | 'high' };
 sharpness: 'weak' | 'sharp';
 direction?: string;
 horizon: 'now' | 'session' | 'days';
 created: string;
 /**
  * When the user answered it — set with the status by `markAnswered`. Absent
  * on an entry that was drawn and abandoned, so "asked" and "answered" stay
  * distinguishable in the record rather than collapsing into "drawn".
  */
 answeredAt?: string;
/**
 * The ladder a parked-sounding pointer points at. Optional: only
 * `parked-sounding` entries carry one, and a pointer without one is a
 * broken record (Q-3: the ladder file is the truth, the pointer derived).
 */
soundingId?: string;
/**
 * The DRM session a parked-drm pointer points at. Optional: only
 * `parked-drm` entries carry one, and a pointer without one is a
 * broken record (Q-3: the DRM file is the truth, the pointer derived).
 */
drmId?: string;
/**
 * The sitting whose machine side-record a parked-machine pointer points at.
 * Optional: only `parked-machine` entries carry one, and a pointer without
 * one is a broken record (Q-3: the record file is the truth, the pointer
 * derived). The record lives at vault/machines/<machineId>.json.
 */
machineId?: string;
/**
 * The protocol the parked machine runs — carried ON the pointer so a corrupt
 * side-record can still restart the machine at phase 0 under the instrument
 * the person parked, rather than whatever the resumed sitting happens to run.
 * Optional: only `parked-machine` entries carry one.
 */
machineProtocol?: string;
/**
 * The KTG territory node this entry was minted for. Optional, because
 * only 'territory-gap-fill' entries carry one — and load-bearing, because
 * "one question per node" is not expressible without it: the node id
 * deduplicates both frontier-gap and common-failure questions.
 */
territoryNode?: string;
/**
 * The atlas region this entry targets. Optional, because only
 * 'atlas-gap-fill' entries carry one — and load-bearing, because
 * "one question per region" is not expressible without it: the region id
 * deduplicates atlas frontier questions in the eventual live sweep
 * (ticket 110, shadow-first Q-35).
 */
atlasRegion?: string;
/**
 * The gazetteer entities this question targets. Optional, and absent means
 * none were identified at mint time — never backfilled by guessing (the 042
 * rule: absent-means-absent). A frontier question mints with the entity id
 * it was minted for; a composed question may stamp entities the model
 * identifies in the user's answer. Presence here means the question asked
 * about this entity; a later frontier sweep reads it to avoid re-asking.
 */
subjects?: string[];
/** Ticket 113 — other-minds expedition: the errand names a person and a question to carry. */
errandKind?: 'other-minds';
/** The person's own word for the named other in a role-taking or other-minds context. */
errandPerson?: string;
/**
 * The derivation pattern that composed this question, when one was used.
 * Absent on non-pattern-derived entries (ticket 111, Q-81/Q-82).
 */
patternId?: PatternId;
/**
 * Snippet@version refs for the elements the pattern recombined
 * (Q-81, Q-18's name-what-you-shuffled applied to composition).
 * Absent on non-pattern-derived entries.
 */
derivedFrom?: string[];
/**
 * The operators the pattern applied, from its registered set.
 * Absent on non-pattern-derived entries.
 */
operatorsUsed?: Operator[];
/**
 * The lineage evidence that licensed this mirror question (Q-83).
 * Absent on non-lineage-mirror entries. Carries only neutral usage
 * facts the person can already see — structurally sealed per Q-78.
 */
lineageMirror?: LineageRead;
};

export type QueueDraft = Omit<QueueEntry, 'id' | 'created' | 'status'>;

export interface QueueStore {
 add(e: QueueDraft): QueueEntry;
 list(filter?: { status?: QueueEntry['status']; source?: QueueEntry['source'] }): QueueEntry[];

 /**
  * One entry by id, or undefined when nothing reads back with that id.
  * The routes' `list().find(...)` 404 guard, as a store read (F9).
  */
 get(id: string): QueueEntry | undefined;
 /**
  * Pick one pending question by the draw pipeline (Q-55: filter, relax,
  * balance, top-k random — never argmax). THE DRAW OWNS the pending→asked
  * transition: the picked entry is marked asked before draw returns, so
  * callers must NOT call markAsked on the result (a second call is a
  * redundant second write of the same file).
  */
 draw(mode: Mode): QueueEntry | null;
 /** Mark one entry asked. Called by the draw itself, or by a caller marking an entry it picked some other way. */
 markAsked(id: string): void;
 markAnswered(id: string): void;
 markPending(id: string): void;
 defer(id: string): void;
 /**
  * Park an open question (the person's act, never the clerk's): 'pending' →
  * 'parked'. Parked entries leave the open pool, the draw and both expiry
  * sweeps until unparked. A no-op on a missing or non-pending entry.
  */
 park(id: string): void;
 /**
  * Put a parked question back: 'parked' → 'pending', with `created`
  * refreshed to now — without that, a long-parked question would re-open
  * already past the expiry sweep's age cutoff and vanish on the next run.
  * A no-op on a missing or non-parked entry.
  */
   unpark(id: string): void;
   expire(olderThanDays: number): number;
   /** Ticket 148: check reply engagement and defer thread on 2 strikes. */
   recordReplyDisengagement(openerEntryId: string, replyText: string): boolean;
   /**
    * Q-115: advance the sitting counter the engagement ledger keys on.
    * Called once per session start; two consecutive sittings whose queue
    * openers get pivoted-away replies pause the draw for a cooldown of
    * sittings (2, 4, 8-cap), and an engaged reply resets it.
    */
   noteSittingStarted(): void;
 /**
  * QR-6: expire the tail of the pending pool beyond the first `keep`
  * entries — the entries the optional filter names, sorted user-declared
  * first then newest first. The default filter is the open pool: days and
  * session horizons, never a user-declared entry. Returns how many entries
  * were expired.
  */
 expireTailBeyond(keep: number, filter?: (e: QueueEntry) => boolean): number;
 /**
  * QR-6: set ONE entry to 'expired' and write it back. The primitive the
  * one-time template sweep persists through; the caller owns the policy
  * (who is never expired) and the Activity Log line. A no-op on an id
  * nothing reads back.
  */
 markExpired(id: string): void;
}

export interface LexicalIndex {
 /** Opaque — shape defined by index/lexical.ts */
 readonly _brand: 'LexicalIndex';
}

export type DocketReport = {
 reindexed: number;
 minted: QueueEntry[];
 expired: number;
 index: LexicalIndex;
 /**
  * What the Clerk's wiki jobs did on this run, absent when a run did none.
  *
  * Structural rather than imported: this file must not depend on
  * `src/wiki/`, so the field names the minimum the docket report renders and
  * lets the wiki's own `WikiReport` satisfy it.
  */
 wiki?: {
  swept: number;
  applied: number;
  rejected: number;
  unprocessed: number;
  [k: string]: unknown;
 };
 /**
  * What the import extraction did on this run, absent when a run did none.
  *
  * Structural rather than imported: this file must not depend on
  * `src/import/`, so the field names the minimum the docket report renders
  * and lets the import layer's own `ExtractionResult` satisfy it.
  */
 imports?: { extracted: number; remaining: number; failed: number };
 /**
  * What the referent annotation job did on this run, absent when a run did
  * none.
  *
  * Structural rather than imported: this file must not depend on
  * `src/clerk/`, so the field names the minimum the docket report renders.
  */
 annotations?: { annotated: number; silent: number; failed: number };
/**
 * What the gap-fill sweep did on this run, absent when a run did none.
 *
 * Structural rather than imported: this file must not depend on
 * `src/clerk/`, so the field names the minimum the docket report renders.
 */
gapFill?: { minted: number; budQuestions: number; constructQuestions: number };
/**
 * What the territory gap-fill sweep did on this run, absent when a run
 * did none. Structural — this file must not depend on `src/ktg/`.
 */
territoryGapFill?: { minted: number; frontierQuestions: number; failureQuestions: number };
 /**
  * What the atlas gap-fill sweep evaluated on this run, absent when a run
  * did none. Shadow-first (Q-35): candidates are logged, not minted.
  * Structural — this file must not depend on `src/ktg/`.
  */
 atlasGapFill?: { candidateCount: number; scanned: number; minted: number };
 /**
  * What the gazetteer extraction job did on this run, absent when a run
  * did none. Structural — this file must not depend on `src/clerk/`.
  */
 gazetteerExtraction?: { extracted: number; entities: number; failed: number };
 /**
  * What the gazetteer frontier sweep did on this run, absent when a run
  * did none. Structural — this file must not depend on `src/clerk/`.
  */
 gazetteerFrontier?: { minted: number; frontierEntities: number };
/**
 * What the lineage mirror sweep did on this run, absent when a run did none.
 * Shadow-first (Q-35): evaluated counts candidates; minted is zero in shadow.
 * Structural — this file must not depend on `src/clerk/`.
 */
 lineageMirror?: { evaluated: number; minted: number };
 /** Q-110 door 1: coach seed clustering results, absent when a run did none. */
 coachSeed?: { clustered: number; minted: number };
 };

/**
 * The sitting phase, as `SessionState.phase` declares it. Named so the /v2
 * vocabulary imports it instead of repeating the union by hand.
 */
export type Phase = 'open' | 'mid' | 'closing-door' | 'closing-bookmark';

export type SessionState = {
 id: string;
 mode: Mode;
 protocol: string;
 deps: {
  complete: Complete;
  vault: Vault;
  queue: QueueStore;
  index: LexicalIndex;
  /**
   * The semantic resonance channel (Q-17, ticket 068). Optional: absent is
   * the ordinary cold state, in which the hybrid degrades to the trigram
   * index. Defined in src/index/semantic.ts — a type-only import, so this
   * file stays free of runtime dependencies.
   */
  semantic?: SemanticIndex;
  /**
   * People-source thunk for the phase machine (ticket 159, slice 3):
   * returns the gazetteer's named people (kind 'person'). The machine's
   * triad phase annotates its composed prompt with them; fewer than three
   * at session start degrades people-grid to reflective. Absent means no
   * people index — the machine composes generically and people-grid
   * degrades (the instrument cannot present triads without names).
   */
  peopleSource?: () => string[];
 };
 turns: Turn[];
 /** Question bank for opener/skip selection (session-local) */
 bank?: { text: string; questionForm: QuestionForm; source?: QuestionSource }[];
 questionCount: number;
 phase: Phase;
 /**
  * The Queue entry whose question is on the table, awaiting the user's
  * answer. Held so the answering turn can mark the entry answered: without
  * the pairing, a drawn entry stays `asked` for good and no uptake signal
  * exists (ticket 041).
  */
 openQueueEntryId?: string;
 /**
  * Capture channel per user turn, index-aligned with the user-turn ordinal
  * that `CutProposal.sourceTurn` uses (one slot per user turn, in order,
  * pushed as each turn lands). In-memory only, same lifetime class as
  * `openQueueEntryId` — never persisted; the transcript's Turn.spoken keeps
  * its own vocabulary. An undefined slot means the client sent no channel
  * for that turn, and the Snippet then carries none (ticket 048).
  */
 turnChannels?: (CaptureChannel | undefined)[];
/**
 * A live descent, when one is running. Absent means no descent is running —
 * a different fact from `soundingOffer` being absent (none offered yet) and
 * from `finishedSounding` being absent (no descent ended on this turn).
 */
sounding?: SoundingState;
/**
 * Whether a descent was offered this sitting and what came of it. Absent
 * means none has been offered yet; 'declined' means one was and will not be
 * again (Q-43).
 */
soundingOffer?: 'offered' | 'declined' | 'entered';
/**
 * The finished ladder, carried from the elicitor to the route when a descent
 * closes on the answer path. Absent means no descent ended on this turn. The
 * route persists it and clears it — the only carrier (T1 contract).
 */
finishedSounding?: ParkedLadder;

/**
 * The opening question held until the greeting is answered (ticket 135).
 * startSession writes only a greeting turn; the opener lives here until
 * the pulse route appends it after the greeting answer. Absent once
 * consumed — the pulse route clears it.
 */
pendingOpener?: { text: string; questionForm: QuestionForm; questionSource?: QuestionSource; gap?: string };
/**
 * Snippets already juxtaposed this sitting. One juxtaposition per snippet
 * per sitting: the answer to a juxtaposed question re-resonates with the
 * snippet that prompted it, and without this guard the same sentence drove
 * three consecutive questions (measured). Sitting-scoped by construction.
 */
juxtaposedSnippetIds?: string[];
/**
 * The protocol phase machine (ticket 159, slice 3): present when the
 * sitting's protocol declares phases. While present, the machine's
 * current-phase question is the elicitor's first priority. Absent on
 * non-machine sittings (reflective is formalized in slice 4).
 */
protocolMachine?: MachineState;
/**
 * Whether the question most recently served this sitting came from the
 * machine. Set when the machine serves; cleared when a fallback channel
 * serves. The next machine turn counts an exchange ONLY when this was set
 * — a fallback turn must not advance the machine (the person answered a
 * non-machine question).
 */
machineLastServed?: boolean;
/**
 * Whether this sitting parked its machine (ticket 159, slice 5). Set by the
 * park gate route, which also writes the side-record. The record survives
 * the sitting's end ONLY when this is set — the park act is the whole of
 * 'depth kept'; any other end removes the record.
 */
machineParked?: boolean;
/**
 * The side-record this sitting resumed (the parked sitting's id, ticket 159,
 * slice 5). Set by the machine resume route. Cleanup removes that record
 * when the resumed sitting finishes (another-day / end / the saturated
 * close) or supersedes it when the resumed sitting parks again.
 */
resumedMachineId?: string;
};

// ── Soundings ──

/** One rung of a descent: the question asked, the phrase it quoted, the answer it drew. */
export type Rung = {
 question: string;
 /**
  * The exact substring of the PRECEDING answer the question was built from —
  * `SoundingState.licensingAnswer` for rungs[0], `rungs[n-1].answer` for
  * rungs[n]. NOT a substring of this rung's own answer (Q-12, the backwards
  * chain). addRung enforces it; composeRung guarantees it at composition.
  */
 foothold: string;
 answer: string;
 at: string;
};

/** The three gate words — the only three (Q-44). */
export type GateChoice = 'continue' | 'park' | 'another-day';

/**
 * How a descent ended: a gate word, the counter, or the echo check —
 * plus `composition-failed`, the honest name for "the model could not
 * draft the next rung". It used to be recorded as `convergence`, which
 * made a flaky drafter indistinguishable from settled answers in every
 * later analysis of the sounding records.
 */
export type SoundingEnd = 'park' | 'another-day' | 'cap' | 'convergence' | 'composition-failed';

/** What the gate renders on a rung: position, total, and whether it blocks. */
export type GateReading = {
 rung: number;
 of: number;
 checkpoint: boolean;
};

/** A live descent: the ladder, plus the question currently on the table. */
export type SoundingState = {
 id: string;
 session: string;
 started: string;
 construct: string;
 /**
  * The verbatim user turn that licensed the descent — rung 0's foothold
  * source. Stored, not derived: the licensing turn lives in the transcript
  * and the ladder cannot reach it (T1 contract).
  */
 licensingAnswer: string;
 allowance: number;
 checkpointRung: number;
 rungs: Rung[];
 /**
  * The composed question awaiting the next answer. Set at enter and after
  * every rung; absent only while the descent is blocked at the checkpoint.
  */
 pendingQuestion?: { text: string; foothold: string };
};

/** A finished ladder: a live state stamped with when and how it ended. */
export type ParkedLadder = SoundingState & {
 ended: string;
 endedBy: SoundingEnd;
};

export type Index = {
 snippets: Record<string, Snippet>;
 readings: Record<string, Reading>;
 buds: Record<string, Bud>;
};

export type Complete = (
 system: string,
 turns: Turn[],
 opts?: { temperature?: number }
) => Promise<string>;

export interface Vault {
 saveSnippet(prose: string, provenance: Provenance): Snippet;
 saveVersion(snippetId: string, prose: string): Snippet;
 saveReading(r: {
  facet: Facet;
  stance: Stance;
  reading: string;
  cites: string[];
 }): Reading;
 saveBud(fragment: string, failures: string[], session: string): Bud;
 startTranscript(
  session: string,
  meta: {
   mode: Mode;
   protocol: string;
   started: string;
   /** The quest this sitting returns to (Q-75). Absent on every ordinary sitting. */
   quest?: string;
   /** The coached Direction this capture belongs to. Absent means untagged. */
   direction?: string;

  }
 ): void;
 appendTurn(session: string, turn: Turn): void;
 rebuildIndex(): Index;
}


// ── Repair record (Q-106) ──

/** A side-record written when the user presses `not mine`. Consulted at every
 * draw point — resonance, juxtaposition, composed minting, queue draw — and
 * never user-facing beyond the activity-stream `repair` event (Q-108). */
export type RepairRecord = {
 /** The repaired snippet@version — text stays untouched, lineage is what happened. */
 snippetRef: string;
 /** The exact quoted fragment being disavowed (Q-105: never re-quoted). */
 quotedFragment: string;
 /** The sitting where the repair was pressed. */
 sitting: string;
 /** ISO timestamp of the repair. */
 at: string;
};

// ── DRM types — live in their own module per Q-85; re-exported here for the
// type-only import convention the rest of the codebase uses.
export type {
 DRMProbeStep,
 DRMEpisode,
 DRMFragment,
 DRMParkedState,
 DRMPhase,
 DRMState,
} from './drm/types.js';
export { DRM_PROBE_QUESTIONS, DRM_AFFECT_NUDGE } from './drm/types.js';

// ── Derivation patterns (ticket 111) ──

export type { PatternId, Operator } from './patterns/types.js';
// PatternId and Operator are re-exported so QueueEntry can carry them
// without every consumer importing from src/patterns/. The full Pattern
// type lives in src/patterns/types.ts — import it directly when needed.
