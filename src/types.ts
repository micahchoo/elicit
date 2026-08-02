// Domain types for the Elicit project
// Encode invariants from CONTEXT.md as visible type constraints

import type { SemanticIndex } from './index/semantic.js';

export type Facet =
 | 'episode'
 | 'general-event'
 | 'lifetime-period'
 | 'fact'
 | 'construct'
 | 'intention'
 | 'value'
 | 'causal-theory';

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
 | 'resurfacing';

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
 /** Set in memory when the user skips this agent turn — never persisted to disk */
 skipped?: true;
 /** True when this user turn included dictated (STT) text — evidence tag only */
 spoken?: true;
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
 /** Preceding sentences from the source turn — mechanically extracted, display-only */
 context?: string;
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
 /** 'unprompted' — the user wrote or pasted the material with no eliciting question */
 kind: 'harvest' | 'restatement' | 'unprompted';
 session: string;
 /** Empty string when kind is 'unprompted' — nothing asked for these words */
 question: string;
 questionForm: QuestionForm;
 /** Source span in the transcript (harvest only) */
 span?: { start: number; end: number };
 questionSource?: QuestionSource;
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
  * Which situation licensed the question. Nothing switches over this union —
  * `draw` and `expire` test it for equality against `'user-declared'` only —
  * so the two Clerk sources buy no exhaustiveness check and were checked by
  * hand instead: `draw` treats anything that is not `'user-declared'` alike,
  * and `expire` only ever expires entries whose status is `'pending'`, which
  * means both new sources expire at 30 days if never drawn and never expire
  * once drawn.
  */
 source:
 | 'composed'
 | 'still-true'
 | 'user-declared'
 | 'contradiction-remeasure'
 | 'lint-still-true';
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
  meta: { mode: Mode; protocol: string; started: string }
 ): void;
 appendTurn(session: string, turn: Turn): void;
 rebuildIndex(): Index;
}
