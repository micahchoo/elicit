/**
 * The Clerk slice's end-to-end fixture: one corpus, and one fake model that
 * answers whatever it is asked.
 *
 * WHY A ROUTER AND NOT A SCRIPT. `tests/fakes.ts`'s `makeScriptedComplete`
 * dequeues by position, which works for a flow whose call order is fixed. The
 * Clerk slice's call order is not: a docket run's LLM calls depend on what the
 * vault holds, and `runWikiJobs` fans out over readings, pooled pairs and
 * pending candidates. A positional script over that would encode the very
 * ordering the end-to-end test exists to check, and would go green by moving a
 * response one slot when the product changed underneath it.
 *
 * So this fake dispatches on the PROMPT — the same information a real model
 * has — and composes its answer OUT OF the payload it was shown. That matters
 * more than it looks: the confirmation answer quotes a snippet ref and prose it
 * parses out of the prompt, so it cannot "confirm" from a snippet the pipeline
 * never showed it, which is exactly the check `verifyEvidence` runs. A fake
 * that hardcoded the ref would pass that check by construction.
 *
 * The one thing this file must never do is write. Every artifact in the flow is
 * written by the product.
 */

import type { Complete, Turn } from '../../src/types.js';
import type { ClaimStore } from '../../src/wiki/contract.js';

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** Three sittings, because Q-53 needs three: two poles and one re-measure. */
export const SITTING_ONE = 'sitting-alpha';
export const SITTING_TWO = 'sitting-beta';

export const QUESTION_ONE = 'What has been on your mind lately?';
export const QUESTION_TWO = 'Tell me about a day that went well.';

export const PROSE_ONE =
  'I do my best work alone, with the door shut and the phone in another room.';
export const PROSE_TWO =
  'Every piece of work I am proud of came out of a room full of people arguing about it.';

/** Verbatim substrings of the prose above — the poles the model must copy. */
export const POLE_ONE = 'I do my best work alone';
export const POLE_TWO = 'a room full of people arguing';

export const READING_ONE = 'Solitude is the condition named for good work';
export const READING_TWO = 'Argument with others is the condition named for good work';

/**
 * The claim bodies. They share the phrase "as the condition for their best
 * work" so the LEXICAL channel pairs them, and both carry the referent "my best
 * work" so the REFERENT channel pairs them too. Two channels, one pair: the
 * union is what the pool tags, and a single-channel fixture would leave the
 * other channel untested at the assembly point.
 */
export const BODY_ONE =
  'This person names solitude as the condition for their best work';
export const BODY_TWO =
  'This person names argument with others as the condition for their best work';

export const REFERENT_NAME = 'my best work';

/** The answer to the re-measure, said in a third sitting. */
export const ANSWER_TEXT =
  'Last Tuesday I shipped a whole parser in one sitting with nobody in the room, and I still think the arguing room is where the real ideas arrive.';
export const ANSWER_READING = 'Both conditions are named as live at once';

/** A second snippet in sitting one — Q-50's same-sitting second cite. */
export const PROSE_ONE_B =
  'The door being shut is the whole trick, and the quiet is what the trick buys.';
export const READING_ONE_B = 'Solitude is named again as the condition for good work';

/** A snippet from a third sitting — Q-50's cross-sitting cite. */
export const PROSE_THIRD =
  'Even now the shut door is the first thing arranged before anything difficult starts.';
export const READING_THIRD = 'Solitude is still named as the condition for good work';

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

/** What the fake decided a call was, so a test can count what the run asked. */
export type CallKind =
  | 'harvest'
  | 'mint'
  | 'red-lights'
  | 'opposition'
  | 'remeasure'
  | 'confirmation'
  | 'still-true'
  | 'opener'
  | 'expedition'
  | 'juxtaposition'
  | 'follow-up'
  | 'consolidation'
  | 'probe';

export type RouterOptions = {
  /**
   * The real store, read-only. `UPDATE` needs a claim id, and a fake that
   * guessed one would be testing its own guess. Reading the wiki is what a
   * model is shown anyway (`relatedClaims`), just without the retrieval step.
   */
  store: ClaimStore;
  /**
   * Every call throws. This is the "the endpoint is down" run: the mechanical
   * layers must still complete, which is the half of the slice hypothesis the
   * eval says matters more.
   */
  failEverything?: boolean;
  /**
   * Refuse to confirm. Used to keep a candidate pending across runs so its
   * queue entry can be expired instead of answered (Q-53's expiry branch).
   */
  neverConfirm?: boolean;
  /**
   * Reading texts whose op is an `UPDATE` that adds a cite to the FIRST claim,
   * rather than the default `KEEP`.
   *
   * Opt-in, and named per reading, because the choice is load-bearing in two
   * opposite directions: Q-50 needs a claim to accumulate cites, and Q-53 needs
   * a claim's sitting set to stay put while its re-measure is judged. A router
   * that always sharpened would silently decide both.
   */
  sharpens?: string[];
  /**
   * Confirm with a quote that is in NO snippet — the model claiming evidence it
   * cannot produce. Q-46 says a Contradiction that cannot name the user's words
   * does not open, and this is the only way to ask whether that is true.
   */
  fabricateQuote?: boolean;
};

export type Router = {
  complete: Complete;
  /** Every call, in order, by kind. */
  calls: CallKind[];
  count(kind: CallKind): number;
};

const FIRST_PERSON = /\b(?:I|my|me|mine|myself)\b/i;

/**
 * A run of words from `prose` that carries no first person, so a question can
 * quote it and still address the speaker as "you" outside the marks — which is
 * what `hasFirstPersonOutsideQuote` checks and what the framing rule asks for.
 */
export function pickQuotable(prose: string): string {
  const words = prose.replace(/[.]$/, '').split(/\s+/);
  let best: string[] = [];
  let run: string[] = [];
  for (const word of words) {
    if (FIRST_PERSON.test(word)) {
      run = [];
      continue;
    }
    run.push(word);
    if (run.length > best.length) best = [...run];
  }
  return best.slice(0, 8).join(' ').replace(/[,;:]$/, '');
}

/** A question built around a fragment, framed the way every guard wants it. */
function frame(fragment: string, tail: string): string {
  return `You wrote: "${fragment}." ${tail}`;
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m?.[1] ?? null;
}

function classify(system: string, payload: string): CallKind {
  if (system.startsWith('You are a harvesting agent')) return 'harvest';
  if (system.startsWith('You are the Clerk for Elicit. You maintain a wiki')) return 'mint';
  if (system.includes('red lights')) return 'red-lights';
  if (system.startsWith('You summarize interview transcripts')) return 'consolidation';
  if (payload.includes('QUOTE A:')) return 'opposition';
  if (payload.includes('takes a fresh measurement')) return 'remeasure';
  if (payload.includes('ANSWER READING')) return 'confirmation';
  if (payload.includes('still holds true')) return 'still-true';
  if (payload.includes('returns them to that thought')) return 'opener';
  if (payload.includes('sends them out to investigate')) return 'expedition';
  if (payload.includes('echoes a past snippet')) return 'juxtaposition';
  if (payload.includes('triggered a concern')) return 'follow-up';
  return 'probe';
}

export function clerkRouter(opts: RouterOptions): Router {
  const calls: CallKind[] = [];

  const complete: Complete = async (system: string, turns: Turn[]) => {
    const payload = turns.map((t) => t.text).join('\n');
    const kind = classify(system, payload);
    calls.push(kind);

    if (opts.failEverything) {
      throw new Error(`fake model is unreachable (${kind})`);
    }

    switch (kind) {
      case 'harvest':
        return harvest(payload);
      case 'mint':
        return mint(payload, opts.store, opts.sharpens ?? []);
      case 'red-lights':
        return '{"lights": []}';
      case 'opposition':
        return opposition(payload);
      case 'remeasure':
        return remeasure(payload);
      case 'confirmation':
        if (opts.neverConfirm) {
          return JSON.stringify({
            confirmed: false,
            reason: 'the answer holds only one of the two',
          });
        }
        return confirmation(payload, opts.fabricateQuote === true);
      case 'still-true':
      case 'opener':
        return quoteBack(payload, /^Snippet: "([\s\S]*?)"$/m);
      case 'expedition':
        // Never a candidate in this fixture; an empty answer is refused twice
        // and the docket moves on, which is the shape a real refusal has.
        return '';
      case 'juxtaposition':
      case 'follow-up':
        // Deliberately refused, so the turn falls through to the generic probe
        // and the flow does not depend on which composer answered.
        return '';
      case 'consolidation':
        return 'They talked about where their work happens.';
      case 'probe':
        return 'What did that afternoon actually look like from the inside?';
    }
  };

  return {
    complete,
    calls,
    count: (k) => calls.filter((c) => c === k).length,
  };
}

// ── The individual answers ──

/**
 * One cut, verbatim, or none.
 *
 * Only the re-measure answer is harvested: every other turn in the flow is
 * scaffolding, and a fixture that harvested them would put snippets in the
 * vault that no assertion accounts for.
 */
function harvest(payload: string): string {
  if (!payload.includes('parser')) return '{"cuts": []}';
  return JSON.stringify({
    cuts: [
      {
        text: ANSWER_TEXT,
        sourceTurn: 0,
        facet: 'construct',
        stance: 'avowal',
        reading: ANSWER_READING,
        standalone: true,
      },
    ],
  });
}

/**
 * The op for one reading, built from the reading and the cites the payload
 * shows — never from an id this file invented.
 *
 * `UPDATE` looks the claim up in the real store by body, which is the one thing
 * a fake cannot derive from the prompt alone: a claim id is minted inside the
 * write boundary, so nothing outside it can predict one.
 */
function mint(payload: string, store: ClaimStore, sharpens: string[]): string {
  const reading = firstMatch(payload, /^READING (\S+)$/m);
  const cites = firstMatch(payload, /^cites: (.+)$/m);
  if (!reading || !cites) return '[]';
  const cited = cites.split(',').map((c) => c.trim()).filter((c) => c.length > 0);

  const body = (text: string): string | undefined =>
    store.loadSlice().claims.find((c) => c.body === text)?.id;

  if (payload.includes(READING_ONE)) {
    return JSON.stringify([
      {
        op: 'MINT',
        reading,
        body: BODY_ONE,
        range: 'when the work is hard',
        cites: cited,
        facet: 'construct',
        referents: [{ name: REFERENT_NAME, kind: 'construct' }],
      },
    ]);
  }

  if (payload.includes(READING_TWO)) {
    return JSON.stringify([
      {
        op: 'MINT',
        reading,
        body: BODY_TWO,
        range: 'when the work is hard',
        cites: cited,
        facet: 'construct',
        referents: [{ name: REFERENT_NAME, kind: 'construct' }],
      },
    ]);
  }

  // A sharpening reading adds its cite to the FIRST claim rather than minting a
  // second one — which is what makes the cite count, and not the claim count,
  // the thing the status arithmetic reads.
  if (sharpens.some((text) => payload.includes(text))) {
    const claim = body(BODY_ONE);
    if (claim) {
      return JSON.stringify([{ op: 'UPDATE', reading, claim, addCites: cited }]);
    }
  }

  return JSON.stringify([{ op: 'KEEP', reading, note: 'the wiki already says this' }]);
}

/**
 * Opposed, with each pole copied out of the quote it belongs to.
 *
 * Which claim lands on side A is decided by ULID order, so the poles are
 * matched to the quotes rather than assumed. A swapped pair is rejected by
 * `judgeOpposition` on purpose, and getting it wrong here would look like a
 * pipeline failure.
 */
function opposition(payload: string): string {
  const quoteA = firstMatch(payload, /^QUOTE A: ([\s\S]*?)$/m) ?? '';
  const quoteB = firstMatch(payload, /^QUOTE B: ([\s\S]*?)$/m) ?? '';
  const poleA = quoteA.includes(POLE_ONE) ? POLE_ONE : POLE_TWO;
  const poleB = poleA === POLE_ONE ? POLE_TWO : POLE_ONE;
  if (!quoteA.includes(poleA) || !quoteB.includes(poleB)) {
    return JSON.stringify({ opposed: false, poleA: '', poleB: '' });
  }
  return JSON.stringify({ opposed: true, poleA, poleB });
}

/** One question, quoting the pole it was handed and nothing else (Q-15). */
function remeasure(payload: string): string {
  const pole = firstMatch(payload, /^Their words: "([\s\S]*?)"$/m);
  if (!pole) return '';
  return frame(pole, 'Which afternoon last month went differently?');
}

/**
 * Confirmed, quoting a snippet the pipeline itself put in the prompt.
 *
 * `readingBlock` renders each cite as `  <ref>: "<prose>"`. Parsing it back is
 * the whole point: the quote and the ref both come from the re-measure's own
 * readings, so this answer can only pass `verifyEvidence` when the pipeline
 * really did supply an admissible reading. When it supplied none, the answer
 * names a ref that is not there and the confirmation is refused — which is the
 * behaviour Q-53's negative case depends on.
 */
function confirmation(payload: string, fabricate: boolean): string {
  const m = /^ {2}(\S+): "([\s\S]*?)"$/m.exec(payload);
  if (!m) return JSON.stringify({ confirmed: false, reason: 'nothing to read' });
  return JSON.stringify({
    confirmed: true,
    type: 'synchronic',
    reason: 'the answer holds both positions at once',
    evidence: {
      snippetRef: m[1],
      quote: fabricate ? FABRICATED_QUOTE : m[2],
      side: 'a',
    },
  });
}

/** Plausible, fluent, and in nothing the person ever wrote. */
export const FABRICATED_QUOTE = 'I have always believed that solitude is the only honest way to work';

/** A question that sets off a first-person-free run of the snippet's prose. */
function quoteBack(payload: string, re: RegExp): string {
  const prose = firstMatch(payload, re);
  if (!prose) return '';
  const fragment = pickQuotable(prose);
  if (fragment.split(/\s+/).length < 3) return '';
  return frame(fragment, 'What does that look like on an ordinary Thursday now?');
}
