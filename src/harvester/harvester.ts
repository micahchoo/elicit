import type { Complete, Turn, CutProposal, Bud, HarvestDecision, Vault, Snippet, Provenance, Facet, Stance } from '../types.js';
import { admissible, normalize, startsMidSentence } from './admissibility.js';

// ---------------------------------------------------------------------------
// The vocabularies, at runtime
// ---------------------------------------------------------------------------
//
// `Facet` and `Stance` are TypeScript unions, and `propose()` used to reach
// them by cast. A cast asserts; it does not check. Measured over 105 real cuts
// on 2026-08-02, the clerk put a STANCE value in the `facet` field three times
// — `self-observation`, `report-of-fact`, `uncertainty-marked` — and every one
// of them travelled through `decide()` into `vault.saveReading()` and onto
// disk, where the Clerk mints a Claim off it (Q-28) and ticket 042's facet
// balance counts it. Nothing between here and the file system looks.

const FACETS: ReadonlySet<string> = new Set<Facet>([
  'episode', 'general-event', 'lifetime-period', 'fact',
  'construct', 'intention', 'value', 'causal-theory',
]);

const STANCES: ReadonlySet<string> = new Set<Stance>([
  'avowal', 'self-observation', 'report-of-fact', 'pole-preference',
  'commitment', 'uncertainty-marked', 'superseded',
]);

// ---------------------------------------------------------------------------
// System prompt for harvest cut proposal
// ---------------------------------------------------------------------------

// One user turn per call. Whole-transcript extraction collapses on this class
// of local model at 3+ user turns — it echoes the tail of the conversation
// instead of emitting cuts (ticket 034, eval finding #1). Single-turn
// extraction is the configuration measured to hold.
//
// The facet and stance lists were bare enum values until ticket 037. Eval
// finding #7 measured what a bare list produces: `intention` on 5 of ~14 cuts
// and correct on none of them, because an undefined label becomes the model's
// don't-know bucket; and `superseded` on nothing at all, including the
// textbook case. Each value now carries the test that separates it from its
// neighbours, `episode` is named as the priority, and the supersession markers
// are spelled out. Exported so the ratchet harness can diff prompt variants
// against this baseline instead of a copy of it.
export const SYSTEM_PROMPT = `You are a harvesting agent for Elicit. Your job: extract verbatim substrings from the user's message that could stand alone as independent Snippets.

You are given ONE message from the user. Return a JSON object with a "cuts" array. Each cut has:
- "text": exact substring of that message (verbatim, no edits — copy character-for-character)
- "sourceTurn": always 0
- "facet": one value from the facet list below
- "stance": one value from the stance list below
- "reading": a one-line interpretation of what this fragment says about the user (agent prose)
- "standalone": boolean — can this fragment be understood without the surrounding transcript exchange?

Where a cut starts and where it stops:
- Start a cut at the start of a sentence. Stop it at the end of a sentence. Never begin a cut in the middle of one.
- Never cut text that sits inside quotation marks. Those words belong to whoever is being quoted.

facet — what kind of knowledge about the person this cut is evidence of:
- "episode" — one specific occasion, dateable or placeable. PRIORITY: when the message holds a specific occasion AND a general belief drawn from it, cut BOTH. The occasion is the checkable evidence; the belief is only the person's theory of themselves.
- "general-event" — something that happened repeatedly or habitually.
- "lifetime-period" — a named stretch of the person's life, months or years long.
- "fact" — a stable state of affairs about the person.
- "construct" — a distinction the person draws, with a pole and a contrast pole.
- "intention" — a stated future-directed want, plan or goal. Use ONLY when the text says the person wants, plans, intends, hopes, aims or means TO DO something. This is not a fallback label: when the sentence reports what the person believes, notices or holds worth doing, the facet is "construct", "fact" or "value", never "intention".
- "value" — something held to be worth doing or being.
- "causal-theory" — the person explaining why they are the way they are.

stance — how the person holds it:
- "avowal" — asserted as their own position.
- "self-observation" — reported about themselves as if from outside.
- "report-of-fact" — stated as plain fact about the world.
- "pole-preference" — one side of a contrast chosen over the other.
- "commitment" — bound to a future action.
- "uncertainty-marked" — the person marks their own confidence as low.
- "superseded" — a position named as no longer held. Any of "I used to think", "I no longer", "not any more", "at the time I thought", "I was wrong about", "I understand now", "I have since" forces this stance, whatever else the sentence does.

Do not fabricate text. Every "text" must be an exact substring of the user's message.
Return ONLY valid JSON. No markdown fences. No commentary.`;

// ---------------------------------------------------------------------------
// Structural facet/stance checks — the markers, not the model's word for it
// ---------------------------------------------------------------------------
//
// Eval finding #7 and the standing rule behind ticket 044 point the same way:
// where a label has a mark in the text, read the mark, do not ask the model
// what it decided. The three matchers below run on the `normalize`d form, so
// "I don't think that anymore" and "I do not think that any more" take one
// path. They differ in what the caller does with them, and the difference is
// the point:
//
//   SUPERSESSION  — the marker PROVES the stance, so the label is corrected.
//   VOLITION      — the marker is necessary for `intention` and not
//                   sufficient for anything else, so a miss is COUNTED and
//                   left alone. There is no structural way to know which of
//                   the seven other facets a mislabelled `intention` should
//                   have been, and a wrong label swapped for a different
//                   wrong label is not a fix.
//   EPISODE_ANCHOR— a property of the TURN, not of a cut. It cannot correct
//                   anything, because the failure it detects is a cut that was
//                   never proposed. It is a shadow count (Q-35) so the bias
//                   shows up in numbers instead of in anecdotes.

/**
 * A position named as no longer held.
 *
 * `used to` needs a mental verb behind it: "I used to work at the shop" is
 * habitual past and stays whatever the model called it, while "I used to think
 * that" is the textbook supersession the eval found never firing. `no longer`
 * carries no second reading and needs no guard.
 */
const SUPERSESSION =
  /\b(?:i\s+used\s+to\s+(?:think|believe|assume|feel|say|call|see|imagine|tell\s+myself)|i\s+no\s+longer\b|i\s+do\s+not\s+(?:\w+\s+){0,4}any\s?more|i\s+was\s+wrong\s+about|i\s+have\s+since\b|at\s+the\s+time\s+i\s+(?:thought|believed|assumed)|i\s+(?:once|previously)\s+(?:thought|believed|assumed)|i\s+understand\s+now\b|i\s+know\s+better\s+now)\b/;

/** A stated want, plan or goal — what `intention` requires and rarely has. */
const VOLITION =
  /\b(?:i\s+(?:want|wanted|plan|planned|intend|intended|hope|hoped|aim|aimed|mean|meant|would\s+like|am\s+going|was\s+going|set\s+out|am\s+trying|was\s+trying)\s+to|i\s+will\b|i\s+would\s+\w+\s+to\b|my\s+(?:goal|plan|aim|intention)\b)\b/;

/**
 * A turn that names WHEN something happened to the person.
 *
 * Deliberately loose, and only ever used to raise a flag: a turn matching this
 * and yielding no `episode` cut is the exact failure of finding #7 — the
 * harvester keeping the self-theory and dropping the dateable event under it.
 * Loose is the right error direction for a counter that accuses the harvester.
 */
const EPISODE_ANCHOR =
  /\b(?:in\s+(?:19|20)\d{2}|(?:19|20)\d{2}|january|february|march|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday|last\s+(?:night|week|month|year|summer|winter|spring|autumn)|that\s+(?:day|night|morning|afternoon|evening|week)|the\s+(?:day|night|week|morning)\s+(?:before|after)|one\s+(?:day|night|morning|afternoon|evening)|when\s+i\s+was\s+\w+|the\s+first\s+time\s+i)\b/;

/**
 * Rough past-tense first person. A shadow counter, so rough is affordable.
 * One optional adverb is allowed between the pronoun and the verb, because
 * "I finally told my manager" is the shape the eval's dropped episode had.
 */
const FIRST_PERSON_PAST =
  /\bi\s+(?:(?:\w+ly|never|also|just|still|once|then|later|only|almost|first)\s+)?(?:\w+ed|went|was|were|had|did|made|saw|took|told|felt|got|came|left|said|knew|thought|found|began|ran|wrote|met|kept|gave|spent|sat|stood|drove|read|built|sent|lost|won|held|brought|taught|chose)\b/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strips markdown code fences from LLM output, keeping the inner content. */
function stripFences(raw: string): string {
  let s = raw.trim();
  // strip opening ```json or ```
  s = s.replace(/^```(?:json)?\s*\n?/i, '');
  // strip closing ```
  s = s.replace(/\n?```\s*$/, '');
  return s.trim();
}

/** Find the agent turn that elicited a given user turn index (0-based in user-turn space). */
function findElicitingProbe(
  transcript: Turn[],
  sourceTurn: number
): Turn | undefined {
  let userIdx = 0;
  for (let i = 0; i < transcript.length; i++) {
    const turn = transcript[i]!;
    if (turn.role === 'user') {
      if (userIdx === sourceTurn) {
        // The agent turn immediately before this user turn is the eliciting probe
        if (i > 0 && transcript[i - 1]!.role === 'agent') {
          return transcript[i - 1];
        }
        return undefined;
      }
      userIdx++;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Line-oriented fallback parser
// ---------------------------------------------------------------------------

interface RawCut {
  text?: string;
  sourceTurn?: number;
  facet?: string;
  stance?: string;
  reading?: string;
  standalone?: boolean;
}

function parseLineOriented(raw: string): RawCut[] {
  const blocks = raw.split(/\n\s*\n/);
  const cuts: RawCut[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const cut: RawCut = {};
    for (const line of trimmed.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      switch (key) {
        case 'text':
        case 'cut':
          // Strip surrounding quotes if present
          cut.text = value.replace(/^"(.*)"$/, '$1');
          break;
        case 'source':
        case 'sourceturn':
          cut.sourceTurn = parseInt(value, 10);
          break;
        case 'facet':
          cut.facet = value;
          break;
        case 'stance':
          cut.stance = value;
          break;
        case 'reading':
          cut.reading = value;
          break;
        case 'standalone':
          cut.standalone = value.toLowerCase() === 'true';
          break;
      }
    }
    cuts.push(cut);
  }

  return cuts;
}

/**
 * Parse one chunk's raw output. `mode` records how it parsed so that a failed
 * parse and a genuinely empty answer never look alike downstream (ticket 034).
 * A line-oriented result counts as parsed only if it carries at least one
 * `text` — prose with stray colons in it otherwise reads as a successful parse.
 */
function parseChunk(raw: string): { cuts: RawCut[]; mode: ParseMode } {
  try {
    const parsed: unknown = JSON.parse(stripFences(raw));
    if (parsed !== null && typeof parsed === 'object') {
      const maybe = (parsed as { cuts?: unknown }).cuts;
      if (Array.isArray(maybe)) return { cuts: maybe as RawCut[], mode: 'json' };
    }
  } catch {
    // fall through to the line-oriented fallback
  }

  const cuts = parseLineOriented(raw).filter((c) => typeof c.text === 'string' && c.text.length > 0);
  return cuts.length > 0
    ? { cuts, mode: 'line-oriented' }
    : { cuts: [], mode: 'failed' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ParseMode = 'json' | 'line-oriented' | 'failed';

/**
 * What the harvest run actually did, in counts and flags only — never user
 * content. The Activity Log carries these so "the parser failed" and "the
 * sitting was genuinely thin" can never be logged identically (ticket 034).
 */
export type HarvestDiagnostics = {
  /** Total characters of raw model output across all chunks. */
  rawChars: number;
  /** True when at least one chunk's output parsed into cuts. */
  parsed: boolean;
  /** 'json' when every parsed chunk was clean JSON; 'failed' when none parsed. */
  parseMode: ParseMode;
  /** Cut objects the parser produced, before any validation dropped them. */
  cutsSeen: number;
  /** Cuts dropped because the text was not an exact substring of its turn. */
  fabricationDrops: number;
  /**
   * Cuts dropped by the admissibility gate — refusals, comments on the
   * question, fragments carrying no proposition. Never silent: each one is
   * warned with its reason (ticket 044).
   */
  inadmissibleDrops: number;
  /** User turns never sent for extraction because the answer held no content. */
  contentFreeSkips: number;
  /** Cuts whose model-claimed sourceTurn differed from the derived one. */
  sourceTurnCorrections: number;
  /**
   * Cuts sent to the Bud path by the structural mid-sentence test rather than
   * by the model's `standalone` boolean (ticket 037). Nothing is destroyed —
   * a Bud keeps the fragment and can be asked about.
   */
  fragmentBuds: number;
  /**
   * Cuts carrying a facet or stance outside the vocabulary. Held as Buds: the
   * words are the person's and the labels are the model's, so the words stay
   * and the labels are refused rather than written to disk.
   */
  outOfVocabularyLabels: number;
  /** Cuts whose stance the supersession markers corrected to `superseded`. */
  supersessionCorrections: number;
  /**
   * Cuts the model labelled `intention` with no want/plan/goal anywhere in
   * their own words. Counted, never rewritten: the marker says the label is
   * wrong and says nothing about what is right (eval finding #7).
   */
  unmarkedIntentions: number;
  /** User turns naming when something happened to the person. */
  episodeAnchoredTurns: number;
  /**
   * Of those, the turns that produced no `episode` cut. This is finding #7's
   * bias as a number: the dateable event is the checkable evidence, and the
   * harvester was dropping it while keeping the theory built on top of it.
   */
  episodeBlindTurns: number;
  /** User turns sent — one complete() call each. */
  chunks: number;
  /** Chunks whose output parsed. */
  chunksParsed: number;
  /** Chunks where complete() threw; the remaining chunks still harvest. */
  chunkErrors: number;
};

/**
 * Extract up to two sentences immediately preceding the cut in its source turn.
 * Sentence split on `. `, `! `, `? ` followed by an uppercase letter.
 * Returns undefined when the cut opens the turn (no preceding sentence).
 */
function extractContext(turnText: string, cutText: string): string | undefined {
  const idx = turnText.indexOf(cutText);
  if (idx < 0) return undefined;

  const before = turnText.slice(0, idx).trimEnd();
  if (before.length === 0) return undefined;

  // Split into sentences: . ! ? followed by space and uppercase
  // We reconstruct by scanning, keeping separators attached to their sentences
  const sentences: string[] = [];
  let current = '';
  for (let i = 0; i < before.length; i++) {
    const ch = before[i]!;
    current += ch;
    // Sentence boundary: punctuation + space + uppercase letter (or end)
    if (
      (ch === '.' || ch === '!' || ch === '?') &&
      (i + 1 >= before.length || (before[i + 1] === ' ' && i + 2 < before.length && /[A-Z]/.test(before[i + 2]!)))
    ) {
      sentences.push(current);
      current = '';
    }
  }
  // Any trailing non-sentence text (shouldn't happen with proper boundaries, but be safe)
  if (current.trim().length > 0) {
    sentences.push(current);
  }

  if (sentences.length === 0) return undefined;

  // Take up to last 2 sentences
  const last = sentences.slice(-2);
  const result = last.join('').trim();
  return result.length > 0 ? result : undefined;
}

export async function propose(
  session: string,
  transcript: Turn[],
  complete: Complete,
  /** Prompt variant under test by the ratchet harness (scripts/ratchet). */
  promptOverride?: string,
): Promise<{ proposals: CutProposal[]; buds: Bud[]; diagnostics: HarvestDiagnostics }> {
  // Collect user turns. Each becomes its own extraction call, so the message
  // list is always exactly one user turn — user-last by construction (llama.cpp
  // generates nothing when the list ends with an assistant turn), and trailing
  // agent turns drop out because they carry no harvestable text.
  const userTurns: { turn: Turn; userIdx: number }[] = [];
  let userIdx = 0;
  for (const turn of transcript) {
    if (turn.role === 'user') {
      userTurns.push({ turn, userIdx });
      userIdx++;
    }
  }

  const proposals: CutProposal[] = [];
  const buds: Bud[] = [];
  let rawChars = 0;
  let chunksParsed = 0;
  let chunkErrors = 0;
  let anyLineOriented = false;
  let cutsSeen = 0;
  let fabricationDrops = 0;
  let sourceTurnCorrections = 0;
  let inadmissibleDrops = 0;
  let contentFreeSkips = 0;
  let fragmentBuds = 0;
  let outOfVocabularyLabels = 0;
  let supersessionCorrections = 0;
  let unmarkedIntentions = 0;
  let episodeAnchoredTurns = 0;
  let episodeBlindTurns = 0;

  // A content-free answer is never harvestable — it is the same "this holds
  // nothing" the elicitor already acts on when it pivots. Skipping it here
  // costs one model call less and, more to the point, removes the chance for
  // the model to read a claim into "Yes." (ticket 044). The user-turn index
  // still counts every user turn, so a skipped turn cannot shift the
  // sourceTurn of the turns after it.
  const harvestable = userTurns.filter(({ turn, userIdx: idx }) => {
    const verdict = admissible(turn.text, { scope: 'turn' });
    if (!verdict.ok) {
      contentFreeSkips++;
      console.warn(`Harvester: user turn ${idx} not harvested — ${verdict.reason}`);
      return false;
    }
    return true;
  });

  // Sequential: the local model is a single GPU, so parallel chunks buy
  // nothing and cost tail latency.
  for (const { turn, userIdx: derivedTurn } of harvestable) {
    let raw: string;
    try {
      raw = await complete(promptOverride ?? SYSTEM_PROMPT, [turn], { temperature: 0.1 });
    } catch (err) {
      // One chunk failing must not zero the whole harvest.
      chunkErrors++;
      console.warn(`Harvester: extraction failed for user turn ${derivedTurn}: ${String(err)}`);
      continue;
    }
    rawChars += raw.length;

    const { cuts, mode } = parseChunk(raw);
    if (mode === 'failed') {
      console.warn(`Harvester: user turn ${derivedTurn} produced no parsable cuts (${raw.length} chars)`);
      continue;
    }
    chunksParsed++;
    if (mode === 'line-oriented') anyLineOriented = true;
    cutsSeen += cuts.length;

    // Does this turn name when something happened? Answered before the cuts
    // are read, so the flag is about the material rather than about what the
    // harvester made of it.
    const bareTurn = normalize(turn.text);
    const anchored = EPISODE_ANCHOR.test(bareTurn) && FIRST_PERSON_PAST.test(bareTurn);
    if (anchored) episodeAnchoredTurns++;
    let episodeProposed = false;

    for (const cut of cuts) {
      // Required fields check
      if (
        typeof cut.text !== 'string' ||
        cut.text.length === 0 ||
        typeof cut.sourceTurn !== 'number' ||
        typeof cut.facet !== 'string' ||
        typeof cut.stance !== 'string' ||
        typeof cut.reading !== 'string' ||
        typeof cut.standalone !== 'boolean'
      ) {
        continue;
      }

      // Sole Authorship invariant: must be an exact substring of THIS turn
      if (!turn.text.includes(cut.text)) {
        fabricationDrops++;
        console.warn(
          `Harvester: dropped fabricated cut — "${cut.text}" is not a substring of user turn ${derivedTurn}`
        );
        continue;
      }

      // Two Planes: a reaction to the interaction is lineage, not knowledge.
      // This runs BEFORE the model's `standalone` boolean is consulted, because
      // that boolean is the model grading its own homework. A refusal or a
      // comment on the question is not a thin Snippet and not a Bud — it is not
      // corpus at all. It stays in the transcript, where it belongs.
      // Q-51 rides along here: the turn is the source the cut was taken from,
      // so a span sitting inside a quotation in it is somebody else's words
      // and never becomes a Snippet. Q-1 is untouched — this only ever
      // subtracts, and the exact-substring check above still stands alone.
      const verdict = admissible(cut.text, { source: turn.text });
      if (!verdict.ok) {
        inadmissibleDrops++;
        console.warn(
          `Harvester: dropped inadmissible cut (${verdict.reason}) from user turn ${derivedTurn}`
        );
        continue;
      }

      // Non-standalone → Bud. The model's boolean is one of two ways in, and
      // the weaker one: it grades its own homework and defaults true under
      // uncertainty (eval finding #6). A cut that opens mid-sentence was lifted
      // out of the middle of a thought, which the text shows and the model does
      // not have to agree with. Either way the fragment becomes a Bud, so a
      // structural false positive costs a delay, not a loss.
      // A label outside the vocabulary is also a Bud, for the same reason: the
      // words are real and the labels are not, so keep the words and refuse to
      // assert a facet the vocabulary does not contain. Dropping the cut would
      // lose the person's sentence over the model's formatting mistake, and
      // guessing a replacement facet would put an invented one on disk.
      const badLabel = !FACETS.has(cut.facet) || !STANCES.has(cut.stance);
      if (badLabel) {
        outOfVocabularyLabels++;
        console.warn(
          `Harvester: cut labelled facet="${cut.facet}" stance="${cut.stance}" — outside the vocabulary, held as a Bud`
        );
      }

      const midSentence = startsMidSentence(cut.text);
      if (midSentence) fragmentBuds++;
      if (badLabel || midSentence || !cut.standalone) {
        buds.push({
          id: generateBudId(),
          captured: new Date().toISOString(),
          session,
          failures: badLabel ? ['label'] : midSentence ? ['mid-sentence'] : ['standalone'],
          fragment: cut.text,
        });
        continue;
      }

      // sourceTurn is derived from the chunk, never trusted from the model.
      // The chunk holds one turn, so the model is asked for 0 — anything else
      // is an instruction-following miss worth counting.
      if (cut.sourceTurn !== 0) {
        sourceTurnCorrections++;
        console.warn(
          `Harvester: model sourceTurn=${cut.sourceTurn} corrected to actual=${derivedTurn}`
        );
      }

      const probe = findElicitingProbe(transcript, derivedTurn);

      // ── Facet and stance, read off the text where the text says so ──
      const bareCut = normalize(cut.text);
      let stance = cut.stance as CutProposal['stance'];
      if (stance !== 'superseded' && SUPERSESSION.test(bareCut)) {
        supersessionCorrections++;
        console.warn(
          `Harvester: stance "${cut.stance}" corrected to "superseded" — the cut names the position as no longer held`
        );
        stance = 'superseded';
      }
      if (cut.facet === 'intention' && !VOLITION.test(bareCut)) {
        unmarkedIntentions++;
        console.warn(
          `Harvester: facet "intention" on a cut stating no want, plan or goal (user turn ${derivedTurn})`
        );
      }
      if (cut.facet === 'episode') episodeProposed = true;

      const ctx = extractContext(turn.text, cut.text);
      proposals.push({
        text: cut.text,
        sourceTurn: derivedTurn,
        facet: cut.facet as CutProposal['facet'],
        stance,
        reading: cut.reading,
        question: probe?.text ?? '',
        questionForm: probe?.questionForm ?? 'deliberative',
        ...(probe?.questionSource ? { questionSource: probe.questionSource } : {}),
        ...(ctx !== undefined ? { context: ctx } : {}),
      });
    }

    if (anchored && !episodeProposed) {
      episodeBlindTurns++;
      console.warn(
        `Harvester: user turn ${derivedTurn} names when something happened and yielded no episode cut`
      );
    }
  }

  const diagnostics: HarvestDiagnostics = {
    rawChars,
    // With nothing sent there is nothing to parse and nothing failed.
    parsed: harvestable.length === 0 || chunksParsed > 0,
    parseMode:
      harvestable.length === 0 ? 'json'
        : chunksParsed === 0 ? 'failed'
          : anyLineOriented ? 'line-oriented' : 'json',
    cutsSeen,
    fabricationDrops,
    inadmissibleDrops,
    contentFreeSkips,
    sourceTurnCorrections,
    fragmentBuds,
    outOfVocabularyLabels,
    supersessionCorrections,
    unmarkedIntentions,
    episodeAnchoredTurns,
    episodeBlindTurns,
    // Chunks are calls made, so a skipped turn reads as skipped, not failed.
    chunks: harvestable.length,
    chunksParsed,
    chunkErrors,
  };

  // ── Deduplicate proposals (across chunks as well as within one) ──
  const deduped: CutProposal[] = [];
  for (const p of proposals) {
    // Exact dupe: skip
    if (deduped.some((d) => d.text === p.text)) continue;
    // Near-dupe (existing contains new or vice versa): keep the longer
    const nearIdx = deduped.findIndex(
      (d) => d.text.includes(p.text) || p.text.includes(d.text),
    );
    if (nearIdx >= 0) {
      if (p.text.length > deduped[nearIdx]!.text.length) {
        deduped[nearIdx] = p;
      }
      continue;
    }
    deduped.push(p);
  }

  return { proposals: deduped, buds, diagnostics };
}

export function decide(
  session: string,
  proposals: CutProposal[],
  decisions: HarvestDecision[],
  vault: Vault,
  /** Origin of the kept material. 'unprompted' when no question elicited it. */
  origin: 'harvest' | 'unprompted' = 'harvest'
): { snippets: Snippet[]; buds: Bud[] } {
  const snippets: Snippet[] = [];

  for (const decision of decisions) {
    const proposal = proposals[decision.proposal];
    if (!proposal) { console.warn(`Harvester decide: proposal index ${decision.proposal} out of range (have ${proposals.length})`); continue; }
    const provenance: Provenance = {
      kind: origin,
      session,
      question: proposal.question,
      questionForm: proposal.questionForm,
      ...(proposal.questionSource ? { questionSource: proposal.questionSource } : {}),
      ...(proposal.context !== undefined ? { context: proposal.context } : {}),
    };

    switch (decision.action) {
      case 'approve': {
        const snippet = vault.saveSnippet(proposal.text, provenance);
        // Reading carries only facet, stance, reading, cites (Q-4 — no questionForm)
        vault.saveReading({
          facet: proposal.facet,
          stance: proposal.stance,
          reading: proposal.reading,
          cites: [`${snippet.id}@1`],
        });
        snippets.push(snippet);
        break;
      }

      case 'trim': {
        if (!decision.text) continue;
        // Trim must be a substring of the proposal text
        if (!proposal.text.includes(decision.text)) continue;

        const snippet = vault.saveSnippet(decision.text, provenance);
        vault.saveReading({
          facet: proposal.facet,
          stance: proposal.stance,
          reading: proposal.reading,
          cites: [`${snippet.id}@1`],
        });
        snippets.push(snippet);
        break;
      }

      case 'restate': {
        if (!decision.text) continue;
        const restateProvenance: Provenance = {
          kind: 'restatement',
          session,
          question: proposal.question,
          questionForm: proposal.questionForm,
          ...(proposal.questionSource ? { questionSource: proposal.questionSource } : {}),
        };
        // Restatement is a NEW snippet — no reading created
        const snippet = vault.saveSnippet(decision.text, restateProvenance);
        snippets.push(snippet);
        break;
      }

      case 'discard':
        // Nothing to persist
        break;

      default:
        console.warn(`Harvester decide: unknown action "${String((decision as HarvestDecision).action)}" — skipping`);
    }
  }

  return { snippets, buds: [] };
}

// ---------------------------------------------------------------------------
// Internal ID generation (for buds before vault assignment)
// ---------------------------------------------------------------------------

function generateBudId(): string {
  return `bud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
