// Domain types for the Elicit project
// Encode invariants from CONTEXT.md as visible type constraints

import type { SemanticIndex } from './index/semantic.js';
import type { DRMState, DRMParkedState } from './drm/types.js';

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
 | 'superseded';

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
 | 'territory'
 // The opening pulse — momentary-state convention at sitting start (105)
 | 'pulse';

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
 status: 'pending' | 'asked' | 'answered' | 'deferred' | 'expired';
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
 | 'claim-challenged'
 | 'import-repair'
 | 'quest-reflection'
 | 'territory-gap-fill'
 | 'gazetteer-frontier'
 | 'atlas-gap-fill'
 // Ticket 106: outcome questions — "did this intention come to pass?"
 | 'outcome';
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
};

export type QueueDraft = Omit<QueueEntry, 'id' | 'created' | 'status'>;

export interface QueueStore {
 add(e: QueueDraft): QueueEntry;
 list(filter?: { status?: QueueEntry['status']; source?: QueueEntry['source'] }): QueueEntry[];
 draw(mode: Mode, phase: 'opening' | 'mid' | 'late'): QueueEntry | null;
 markAsked(id: string): void;
 markAnswered(id: string): void;
 defer(id: string): void;
 expire(olderThanDays: number): number;
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
 atlasGapFill?: { candidateCount: number; scanned: number };
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
};

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
 };
 turns: Turn[];
 /** Question bank for opener/skip selection (session-local) */
 bank?: { text: string; questionForm: QuestionForm; source?: QuestionSource }[];
 questionCount: number;
 phase: 'open' | 'mid' | 'closing-door' | 'closing-bookmark';
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
/** A live DRM instrument session, when one is running. */
drm?: DRMState;
/** The finished DRM state, carried from the route when a DRM closes. */
finishedDRM?: DRMParkedState;
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

/** How a descent ended: a gate word, the counter, or the echo check. */
export type SoundingEnd = 'park' | 'another-day' | 'cap' | 'convergence';

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
