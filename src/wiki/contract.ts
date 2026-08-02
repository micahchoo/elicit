// The Clerk's contract: every shape the wiki layer shares, and the two guards
// that stand in front of every model call.
//
// The invariants live in the SHAPES here, not in a prompt and not in a rule
// someone has to remember (Q-29, the wiki-side mirror of Q-1):
//
//   - `Claim.range` and `Claim.cites` are required, so a claim without a Range
//     or without evidence cannot be constructed at all (Q-21).
//   - No `ClerkOp` member carries `status`. Status is never model-writable, so
//     the op vocabulary has no word for it (Q-29). Same for `attested`, which
//     only a user verb sets (Q-33).
//   - `SUPERSEDE` and `ARCHIVE` carry a required `reason`, so the reason cannot
//     be forgotten, only badly chosen.
//   - `ClashCandidate.outcome` is a closed union, because it is the
//     anti-repetition reason of record and a free-text reason is a reason
//     nobody can count (Q-30 stage 4).
//
// This file does no I/O and calls no model. It is types plus a handful of pure
// functions, so every module in the slice can compile against it at once.

import { decodeTime } from 'ulid';
import type { Facet, Reading, Snippet, Turn } from '../types.js';

// ── Claims ──

export type ClaimStatus = 'unconfirmed' | 'evidenced' | 'user-attested' | 'contested';

/**
 * One entry in a claim's read-log. Q-21: snippets answered AFTER the user read
 * a claim carry weaker evidence for it, so the reading has to be dated to be
 * usable at all.
 */
export type ReadLogEntry = { at: string; surface: string };

/**
 * The Wiki's unit (CONTEXT — Claim): one sentence of agent prose, the context
 * where it holds, and the snippet versions it rests on.
 *
 * `range` and `cites` are REQUIRED and non-optional. "The user is X" without a
 * Range is malformed (Bateson, Q-21), and a claim with no cites is an opinion.
 * Making them optional here would move both invariants into a validator that a
 * future caller can forget to run.
 *
 * `status` is on the stored shape because the file carries it, but nothing in
 * `ClerkOp` can set it: it is recomputed mechanically from the graph (Q-29).
 */
export type Claim = {
  id: string;
  /** One sentence of agent prose. The file body, not frontmatter. */
  body: string;
  /** MANDATORY, non-empty: the context where the claim holds (Q-21). */
  range: string;
  /** NEVER model-written — recomputed from the graph after every op (Q-29). */
  status: ClaimStatus;
  /** MANDATORY, ≥1: "snippetId@version" strings, each resolving on disk (Q-21). */
  cites: string[];
  facet: Facet;
  /** Registry slugs (Q-32). Empty array, never absent — the referent clash channel iterates it. */
  referents: string[];
  /**
   * Lineage: which readings produced or updated this claim. A typed edge, and
   * NEVER a substitute for `cites` (CONTEXT — Two Planes). Evidentiary weight
   * comes from `cites` alone; this exists so Q-34's lazy re-annotation can find
   * which readings to re-read.
   */
  fromReadings: string[];
  /** Set only by a user verb (Q-33). No op type can reach it. */
  attested: boolean;
  /** Q-21's looping-effect flag. Empty array, never absent. */
  readLog: ReadLogEntry[];
  /** Q-34 stamp: which model wrote it, and when that model last read it. */
  model: string;
  modelAt: string;
  created: string;
  updated: string;
  /** Present only on a superseded claim; `supersedeReason` is required with it (Q-29). */
  supersededBy?: string;
  supersedeReason?: string;
  /** ARCHIVE keeps the file — evidence, never deletion. `archiveReason` is required with it. */
  archived?: boolean;
  archiveReason?: string;
};

// ── The op vocabulary (Q-29) ──

/**
 * How the model names a referent. It may add a new one and it may propose a
 * link; it has no vocabulary for collapsing two into one (Q-32). The absence of
 * a MERGE shape here is the contract, not an oversight.
 */
export type ReferentRef = { name: string; kind: Referent['kind']; aliasOf?: string };

/**
 * The Clerk's six ops, and nothing else (Q-29).
 *
 * Every member carries `reading`, which is what makes totality checkable: an
 * op list must cover the readings swept, and KEEP is what makes "judged
 * redundant" distinguishable from "silently omitted".
 *
 * No member carries `status` or `attested`. An op literal that tries to is an
 * excess property and fails to typecheck; T9 rejects the same thing at runtime,
 * where the value arrives as parsed JSON and the compiler is not watching.
 */
export type ClerkOp =
  | {
    op: 'MINT';
    reading: string;
    body: string;
    range: string;
    cites: string[];
    facet: Facet;
    referents?: ReferentRef[];
  }
  | {
    op: 'UPDATE';
    reading: string;
    claim: string;
    body?: string;
    range?: string;
    addCites?: string[];
    referents?: ReferentRef[];
  }
  | { op: 'MERGE'; reading: string; into: string; from: string[]; body: string; range: string }
  | {
    op: 'SUPERSEDE';
    reading: string;
    claim: string;
    body: string;
    range: string;
    cites: string[];
    /** REQUIRED by the type — Q-29 spells SUPERSEDE with its reason attached. */
    reason: string;
  }
  | { op: 'ARCHIVE'; reading: string; claim: string; reason: string }
  | { op: 'KEEP'; reading: string; note?: string };

/**
 * The SUPERSEDE reason Q-34's lazy re-annotation writes when an upgraded model
 * disagrees with an older reading. Named here so the one string the register
 * fixes is not retyped at each call site, and so `tests/canon.test.ts` has a
 * code-side thing to check the register against.
 */
export const SUPERSEDE_MODEL_UPGRADE = 'model-upgrade';

// ── Identity registry (Q-32) ──

export type Referent = {
  slug: string;
  canonical: string;
  kind: 'person' | 'project' | 'place' | 'pole' | 'construct' | 'other';
  aliases: string[];
  model: string;
  modelAt: string;
  created: string;
  updated: string;
  /** The file body: an optional agent note. */
  note?: string;
};

// ── Contradictions and their candidates (Q-30) ──

/**
 * The verified fragment that opens a Contradiction (Q-46). The model returns
 * it; code checks that the quote is verbatim in a snippet the re-measure
 * actually harvested BEFORE it is ever written. A Contradiction that cannot
 * name the user's words does not open.
 */
export type ClashEvidence = { snippetRef: string; quote: string; side: 'a' | 'b' };

export type Contradiction = {
  id: string;
  /**
   * Synchronic: both assert the present, and the tension is genuine.
   * Diachronic: the person changed, the tension IS the finding, and no
   * resolution is sought (CONTEXT — Contradiction).
   */
  type: 'synchronic' | 'diachronic';
  /** Exactly two claims. A tuple, because "between A and B" is the whole definition. */
  claims: [string, string];
  /** The ClashCandidate this opened from. */
  candidate: string;
  /** The re-measure whose answer confirmed it — the audit trail back to a real turn. */
  remeasureQueueId: string;
  evidence: ClashEvidence;
  status: 'open' | 'dissolved';
  dissolveReason?: string;
  model: string;
  modelAt: string;
  opened: string;
  updated: string;
  /** The file body: the two quoted poles, dated. Juxtaposition material (Q-15). */
  body: string;
};

/**
 * The channels that can propose a pair (Q-30 stage 1, Q-17). Closed, because
 * `WikiReport.candidates` is keyed by it and T16 counts it — a channel name
 * nobody enumerated is a count nobody can read.
 */
export type ClashChannelName = 'lexical' | 'referent' | 'embedding';

/**
 * Why a candidate stopped being a suspicion. A closed union because it is the
 * anti-repetition reason of record (Q-30 stage 4).
 *
 * `remeasure-expired` is the ONE outcome that does not retire the pair (Q-53):
 * expiry is a question that fell off the queue, not an answer, and retiring on
 * it makes a real contradiction permanently invisible because the person was
 * busy that week. Silence never stands in for a verdict. The pair earns exactly
 * one re-proposal — see `attempts` — and retires on the second expiry. Every
 * other outcome retires the pair at once.
 *
 * `range-discriminated` (Q-54) is the case the pipeline used to throw away.
 * When a re-measure comes back "at work I do X, with my kids I do Y", that is
 * the highest-value sentence the pipeline will ever produce, and it used to
 * land in `dissolved-on-answer` and get archived. Context-dependence is a RANGE
 * refinement, not a third Contradiction type: Q-21 made Range mandatory so the
 * boundary is expressible, and the consequence is one SUPERSEDE per pole with a
 * narrowed Range and reason `range-discriminated:<candidateId>`.
 */
export type ClashOutcome =
  | 'not-opposed'
  | 'remeasure-expired'
  | 'unverified-confirmation'
  | 'dissolved-on-answer'
  | 'range-discriminated';

/**
 * A suspicion, Clerk-internal and never user-facing (Q-30 stage 1).
 *
 * The dedupe key is the sorted claim-id pair, and the pair is retired at every
 * status — a pair with a live `pending-remeasure` record must never be
 * re-proposed, or the same two claims collect a fresh record and a fresh
 * question on every docket run.
 *
 * ONE EXCEPTION (Q-53): a `dissolved` candidate whose `outcome` is
 * `remeasure-expired` and whose `attempts` is 1 MAY be re-proposed.
 */
export type ClashCandidate = {
  id: string;
  pair: [string, string];
  channel: ClashChannelName;
  status: 'pending-remeasure' | 'confirmed' | 'dissolved';
  outcome?: ClashOutcome;
  remeasureQueueId?: string;
  /**
   * When the re-measure question was minted. A cheap pre-filter on stage 3's
   * window, and NOT the window itself: under Q-53 the confirming reading's
   * `Provenance.session` must differ from the session of BOTH claims in the
   * pair, because a re-measure answered inside the frame that produced the
   * claim measures the interview rather than the belief. Lability lives in a
   * continuous conversation, which a session boundary ends and elapsed time
   * does not track.
   */
  remeasureAskedAt?: string;
  /**
   * How many re-measures this pair has been given. 1 at creation. Incremented
   * only on re-proposal after a `remeasure-expired` dissolution, and capped at
   * 2 — absence of evidence gets one more chance, then stops (Q-53).
   */
  attempts: number;
  model: string;
  modelAt: string;
  created: string;
};

// ── The graph the pure modules read ──

/**
 * A finding is DERIVED — returned in the report, rendered as a note, never
 * written as a file. Lint may ADD questions and annotations and may never
 * remove or restructure a claim (Q-31).
 */
export type LintFinding = {
  kind: 'stale-citation' | 'orphan-claim' | 'god-node-facet' | 'merge-candidate';
  /** The claim id, facet name or referent slug the finding is about. */
  subject: string;
  detail: string;
  refs: string[];
};

/**
 * The snapshot every pure module reads, assembled once per run.
 *
 * `snippets` is keyed by snippet ID and holds the LATEST version of each — that
 * is what `vault.rebuildIndex()` returns, and this type is a join over it.
 * Consumers resolving a `snippetId@version` cite must therefore compare the
 * cite's version against `snippets[id].version` rather than expect a key per
 * version: `@1` when the latest is `@2` still exists on disk, and is a stale
 * citation (Q-31), not a fabricated one.
 */
export type ClaimGraph = {
  claims: Claim[];
  snippets: Record<string, Snippet>;
  readings: Record<string, Reading>;
  contradictions: Contradiction[];
  referents: Referent[];
};

/**
 * What a store that owns only `vault/wiki/{claims,contradictions,candidates,registry}`
 * can actually return. Snippets and readings live in the Vault, so T12 joins
 * this with `vault.rebuildIndex()` to get a `ClaimGraph`.
 *
 * A method that returns a type it cannot fill is a lie the compiler will not
 * catch, which is why `loadSlice` returns this and not a `ClaimGraph`.
 * Candidates are not in it: they are Clerk-internal working state, not part of
 * the graph the pure modules read, and they come through `listCandidates()`.
 */
export type WikiSlice = Omit<ClaimGraph, 'snippets' | 'readings'>;

/**
 * The result of one pass through the write boundary.
 *
 * `unprocessed` holds reading ids the op list failed to cover; they stay
 * unprocessed for the next run (Q-29), which is a no-op and never a bad write.
 * `rejected[].reading` is what lets the caller append the attempt line that the
 * back-off rule counts.
 */
export type OpResult = {
  applied: ClerkOp[];
  rejected: { op: unknown; reason: string; reading?: string }[];
  unprocessed: string[];
};

// ── Diagnostics (the mirror of HarvestDiagnostics) ──

/**
 * One mint call's record. Three states must never look alike: the call failed,
 * the output did not parse, and the model parsed and proposed nothing. Eval
 * finding #1 was a silent version of the third.
 */
export type MintDiagnostics = {
  rawChars: number;
  parsed: boolean;
  parseMode: 'json' | 'failed';
  opsSeen: number;
  /** How many `status` keys the parser dropped (Q-29). A counter, because a silent strip teaches nothing. */
  statusKeysStripped: number;
  /** True when `fitPayload` refused the payload and no model call was made. */
  oversized: boolean;
};

/** The sweep's accumulation across calls. */
export type MintRunDiagnostics = {
  calls: number;
  callsParsed: number;
  callErrors: number;
  oversized: number;
  opsSeen: number;
  readingsSwept: number;
};

/**
 * What the Clerk's wiki jobs did on one run.
 *
 * MUST stay a `type` and never become an `interface`: TypeScript gives implicit
 * index signatures only to type aliases, and `DocketReport.wiki` carries one.
 * As an interface this stops satisfying that field and the docket integration
 * stops compiling.
 *
 * `candidates` is keyed by channel name and includes channels that returned
 * zero, because "looked and found nothing" and "never looked" must not render
 * alike. `oppositionJudged`/`oppositionOpposed` are the stage-1 precision
 * record the live opposition gate keeps while it acts (Q-49).
 */
export type WikiReport = {
  swept: number;
  applied: number;
  rejected: number;
  unprocessed: number;
  oversized: number;
  stuck: number;
  lint: LintFinding[];
  candidates: Record<string, number>;
  oppositionJudged: number;
  oppositionOpposed: number;
  remeasuresMinted: number;
  remeasuresExpired: number;
  contradictionsOpened: number;
  candidatesDissolved: number;
  mint: MintRunDiagnostics;
  shadow: ShadowRecord[];
};

// ── Four shapes every module shares (declared once, here) ──

/**
 * The Activity Log sink, and the CANONICAL name for this shape. Structurally
 * identical to the docket's `log` dep, narrowed to the one actor the wiki layer
 * writes as. Type-only — this file still does no I/O.
 *
 * `src/wiki/thresholds.ts` declares a local twin, `ThresholdLogFn`, so that the
 * registry every other wiki module reads imports nothing and therefore cannot
 * fail to load. The two are mutually assignable and the twin is deliberate, not
 * a fork: a later pass may collapse them, and until it does, THIS is the name a
 * new module should use.
 */
export type LogFn = (e: {
  at: string;
  actor: 'clerk';
  kind: string;
  detail: string;
  refs?: string[];
}) => void;

/**
 * One shadowed decision (Q-35). It rides in `WikiReport.shadow` as well as the
 * log, because it is the evidence a mechanism graduates on, and evidence that
 * exists only in a log file is evidence nobody reads.
 *
 * **`at` is the log event's own timestamp, never a second clock reading.**
 * `shadowDecision` returns a boolean and stamps its event as it emits it, so a
 * caller that rebuilds the record afterwards reads the clock a second time and
 * writes a moment that disagrees with the log line for the same decision. One
 * decision, two times, and the disagreement surfaces years later, to whoever is
 * reconstructing why a threshold graduated — which is the one job this record
 * exists for. Use `shadowCollector` below and the question does not arise.
 *
 * Why the record is derived from the event rather than returned by
 * `shadowDecision`: the return type is a boolean because the call reads as
 * `if (shadowDecision(...)) { …act… }`, and every call site written from the
 * plan is correct verbatim under that signature. Widening the return to carry
 * the record would invalidate all of them to solve a problem the sink already
 * has the data for.
 */
export type ShadowRecord = { threshold: string; would: string; at: string };

/**
 * Wrap an Activity Log sink so every shadowed decision that passes through it
 * also accumulates as a `ShadowRecord`, carrying the event's OWN timestamp.
 *
 * The wiki jobs pass `log` to every mechanism and read `records` into
 * `WikiReport.shadow` at the end of the run. Nothing else has to remember the
 * one-timestamp rule, and no emitter has to know it is being collected.
 *
 * The parse is a real coupling to how `shadowDecision` writes its `detail`, and
 * `tests/wiki-contract.test.ts` drives a live `shadowDecision` call through this
 * collector for exactly that reason: if the emitter's format drifts, that test
 * goes red rather than a report quietly filling with `unparsed`.
 */
export function shadowCollector(sink: LogFn): { log: LogFn; records: ShadowRecord[] } {
  const records: ShadowRecord[] = [];
  const log: LogFn = (e) => {
    sink(e);
    if (e.kind !== 'shadow-decision') return;
    const name = /(?:^|\s)threshold=(\S+)/.exec(e.detail)?.[1];
    const wouldAt = e.detail.indexOf('would=');
    // An unreadable detail keeps its evidence verbatim rather than being
    // dropped: a lost shadow record is a mechanism that cannot graduate.
    records.push({
      threshold: name ?? 'unparsed',
      would: wouldAt === -1 ? e.detail : e.detail.slice(wouldAt + 'would='.length),
      at: e.at,
    });
  };
  return { log, records };
}

/**
 * One line of `sweep-log.jsonl`.
 *
 * The union of the six op names with the two ledger-only ops is what makes
 * `sweptReadingIds` / `oversizedReadingIds` / `attemptCounts` three different
 * reads of one file: OVERSIZED marks a reading swept and re-sweepable, while
 * REJECTED marks nothing and only counts an attempt (Q-29 keeps that reading
 * unprocessed).
 */
export type SweepLine = {
  readingId: string;
  op: ClerkOp['op'] | 'OVERSIZED' | 'REJECTED';
  claimId?: string;
  reason?: string;
  at: string;
  model: string;
};

/**
 * The embedding channel's vector cache — derived, disposable, read by nothing
 * else (Q-3). Deleting it costs one re-embed pass and no data. Declared as a
 * shape so the channel depends on an interface rather than a file, and every
 * test can pass an in-memory one.
 */
export interface EmbeddingIndexStore {
  get(claimId: string): { hash: string; vector: number[] } | null;
  put(claimId: string, hash: string, vector: number[]): void;
}

// ── The two persistence interfaces, declared here and implemented elsewhere ──

/**
 * Markdown persistence for the whole wiki layer (Q-3: the files are the truth).
 *
 * Declared in the contract rather than in its own implementation file so that
 * the modules which consume it compile beside their implementation instead of
 * behind it.
 *
 * `writeClaim` is validate-before-write: it throws on an empty range, empty
 * cites, `archived` without a reason, or `supersededBy` without a reason. That
 * is belt-and-braces behind the op validator — the store is the last thing
 * between a bad claim and the disk, and the layer with no model anywhere near
 * it. No method deletes a file: archiving sets frontmatter, and the file stays
 * as evidence (Q-29).
 */
export interface ClaimStore {
  loadSlice(): WikiSlice;
  writeClaim(c: Claim): void;
  readClaim(id: string): Claim | null;
  writeContradiction(c: Contradiction): void;
  listContradictions(): Contradiction[];
  writeCandidate(c: ClashCandidate): void;
  listCandidates(): ClashCandidate[];
  writeReferent(r: Referent): void;
  listReferents(): Referent[];
  appendSweep(e: SweepLine): void;
  /** Readings with a terminal line: any of the six ops, or OVERSIZED. */
  sweptReadingIds(): Set<string>;
  /** The re-sweepable subset — how a skip is undone once the budget changes. */
  oversizedReadingIds(): Set<string>;
  /** REJECTED lines per reading — the back-off rule's input. */
  attemptCounts(): Map<string, number>;
  /** Q-21's read-log. Read-modify-write on one file, serialized by the implementation. */
  recordRead(claimId: string, at: string, surface: string): void;
}

/**
 * The identity registry (Q-32): the model may add structure and link
 * reversibly; it may never collapse two identities into one.
 *
 * There is no `merge` method, and that absence is the contract. Who counts as
 * "the same" is self-description, not inference: a wrong alias surfaces as an
 * absurd Juxtaposition and gets edited away, while a wrong merge is invisible
 * and permanent. `mergeCandidates` returns pairs to LOOK at and mutates
 * nothing; only a user verb, in a later slice and a different module, executes
 * one.
 */
export interface Registry {
  /** Tiers 1 and 2: mint an unknown name freely, apply an `aliasOf` proposal reversibly. */
  resolve(ref: ReferentRef): Referent;
  /** Exact canonical or alias match, case-insensitive. */
  lookup(name: string): Referent | null;
  claimsFor(slug: string, graph: ClaimGraph): Claim[];
  /** Pure. Pairs worth a human's attention, rendered as dimmed notes on both entries. */
  mergeCandidates(graph: ClaimGraph): [Referent, Referent][];
}

// ── The guards in front of every model call ──

/** How `capPrompt` and `fitPayload` join parts. Shared so the budget arithmetic matches the send. */
const PART_SEPARATOR = '\n\n';

/**
 * Throw unless the message list ENDS on a user turn.
 *
 * The operative constraint is user-LAST, not user-present: llama.cpp 400s with
 * `Jinja: No user query found in messages` on an empty list, and generates
 * nothing at all when the list ends on an assistant turn. A list of
 * `[user, agent]` therefore must not pass, however much user text it holds.
 *
 * Called immediately before every `complete()` in this slice, because a rule
 * enforced by prompt discipline is a rule that holds until the next author.
 */
export function assertUserTurn(turns: Turn[]): void {
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'user') {
    const shape = turns.map((t) => t.role).join(',') || '(empty)';
    throw new Error(
      `LLM call must end on a user turn — the model generates nothing otherwise. Got: [${shape}]`
    );
  }
}

/**
 * Join the parts and THROW if the result is over budget.
 *
 * This is an assertion that an over-budget prompt was never BUILT, not a policy
 * for what to do about one — that is `fitPayload`. ADR-0001 makes a small
 * context permanent, and a silently truncated prompt is a silently wrong
 * prompt: the model answers a question nobody asked and the answer looks fine.
 */
export function capPrompt(parts: string[], budgetChars: number): string {
  const text = parts.join(PART_SEPARATOR);
  if (text.length > budgetChars) {
    throw new Error(
      `prompt over budget: ${text.length} chars against a budget of ${budgetChars}`
    );
  }
  return text;
}

/**
 * One piece of a payload. `floor` is the shortest useful form of the part;
 * a part with no floor cannot be truncated at all.
 */
export type PayloadPart = { name: string; text: string; required: boolean; floor?: number };

/**
 * Fit a payload to a budget, or report that it cannot be fitted.
 *
 * The policy, in order:
 *   1. Drop optional parts, LAST first — the caller orders parts by descending
 *      value, so the end of the array is what it can most afford to lose.
 *   2. Truncate the remaining parts to their floors, again from the end, and
 *      stop as soon as the result fits. Truncating everything to its floor when
 *      trimming the tail would have done costs information for nothing.
 *   3. Return `null` when the required parts, all at their floors, still
 *      overflow.
 *
 * `null` is the oversized case, and it is the whole reason an over-budget item
 * cannot throw at the head of the sweep on every run forever: the caller skips
 * it, records the skip as a countable ledger op, and moves on. Callers pass the
 * result to `capPrompt`, so the assertion still guards the send.
 */
export function fitPayload(
  parts: PayloadPart[],
  budgetChars: number
): { text: string; dropped: string[] } | null {
  const sepLength = PART_SEPARATOR.length;
  const total = (texts: string[]): number =>
    texts.reduce((n, t) => n + t.length, 0) + Math.max(0, texts.length - 1) * sepLength;

  // Working copy: index-aligned with `parts`, `null` once a part is dropped.
  const kept: (string | null)[] = parts.map((p) => p.text);
  const dropped: string[] = [];
  const live = (): string[] => kept.filter((t): t is string => t !== null);

  // 1. Drop optional parts from the end.
  for (let i = parts.length - 1; i >= 0 && total(live()) > budgetChars; i--) {
    const part = parts[i];
    if (!part || part.required) continue;
    kept[i] = null;
    dropped.push(part.name);
  }

  // 2. Truncate what remains to its floor, from the end, stopping when it fits.
  for (let i = parts.length - 1; i >= 0 && total(live()) > budgetChars; i--) {
    const part = parts[i];
    const text = kept[i];
    if (!part || text === null || text === undefined) continue;
    if (part.floor === undefined || part.floor >= text.length) continue;
    kept[i] = text.slice(0, part.floor);
  }

  // 3. Even at the floors, it does not fit.
  if (total(live()) > budgetChars) return null;

  return { text: live().join(PART_SEPARATOR), dropped };
}

/**
 * When a reading happened — the ONE definition, called by every consumer.
 *
 * Readings written before this slice have no `at` and there is no migration, so
 * the ULID's own time is the DEFINED VALUE of `at` for those files. It is not a
 * second mechanism competing with the field; it is the same value, derived in
 * exactly one place. `decodeTime` appears here and nowhere else in the wiki or
 * clerk namespaces, which is what keeps it one place.
 *
 * This is what makes "readings harvested since the question was asked"
 * computable (Q-30 stage 3).
 */
export function readingTime(r: Reading): string {
  return r.at ?? new Date(decodeTime(r.id)).toISOString();
}
