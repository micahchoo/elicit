import { describe, it, expect } from 'vitest';
import {
 judgeOpposition,
 composeRemeasure,
 judgeConfirmation,
 UNVERIFIED_CONFIRMATION,
} from '../src/clerk/contradiction.js';
import type { Claim, ClashCandidate } from '../src/wiki/contract.js';
import type { Complete, Reading, Snippet, Turn } from '../src/types.js';

/**
 * The contradiction pipeline's model calls, driven entirely by scripted fakes.
 *
 * Every test here asks the same question in a different shape: what does the
 * code do when the model is wrong? A model that fabricates a pole, claims a
 * confirmation it cannot quote, quotes the snippet that raised the suspicion in
 * the first place, or answers in prose — none of those may reach a Contradiction.
 */

// ── budgets asserted against, restated here rather than imported ─────────────
// The module's own constants are not exported, and a test that imports the
// number it is checking checks nothing. These are the plan's figures.
const JUDGMENT_BUDGET = 2000;
const COMPOSE_BUDGET = 3000;

type Call = { system: string; turns: Turn[]; temperature?: number };

/** A scripted `Complete` that records what it was asked. */
function recorder(responses: string[]): { complete: Complete; calls: Call[] } {
 const calls: Call[] = [];
 let i = 0;
 const complete: Complete = async (system, turns, opts) => {
  calls.push({
   system,
   turns,
   ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
  const response = responses[i++];
  if (response === undefined) {
   throw new Error(`scripted complete exhausted after ${responses.length} response(s)`);
  }
  return response;
 };
 return { complete, calls };
}

/** A `Complete` that fails the way a dead endpoint fails. */
const throwing: Complete = async () => {
 throw new Error('connection refused');
};

/** Assert the two rules every model call in this module must satisfy. */
function assertCallShape(calls: Call[], budget: number, temperature: number): void {
 expect(calls.length).toBeGreaterThan(0);
 for (const call of calls) {
  const last = call.turns[call.turns.length - 1];
  expect(last?.role).toBe('user');
  expect(call.temperature).toBe(temperature);
  const chars = call.system.length + call.turns.reduce((n, t) => n + t.text.length, 0);
  expect(chars).toBeLessThanOrEqual(budget);
 }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const QUOTE_A = 'I keep my weekends completely free of work, no exceptions.';
const QUOTE_B = 'I worked through both days last weekend and the one before.';
// Complete clauses, so the ticket-088 check leaves them untouched — a pole
// that is already a clause must reach the model exactly as the model wrote it.
const POLE_A = 'I keep my weekends completely free of work';
const POLE_B = 'I worked through both days last weekend';

function claim(id: string, body: string, cites: string[]): Claim {
 return {
  id,
  body,
  range: 'in the last three months',
  status: 'unconfirmed',
  cites,
  facet: 'construct',
  referents: [],
  fromReadings: [],
  attested: false,
  readLog: [],
  model: 'test-model',
  modelAt: '2026-08-01T00:00:00.000Z',
  created: '2026-08-01T00:00:00.000Z',
  updated: '2026-08-01T00:00:00.000Z',
 };
}

const CLAIM_A = claim('claimA', 'The user protects weekends from work entirely.', ['snipA@1']);
const CLAIM_B = claim('claimB', 'The user works through most weekends.', ['snipB@1']);

function snippet(id: string, version: number, prose: string): Snippet {
 return {
  id,
  version,
  captured: '2026-08-01T00:00:00.000Z',
  provenance: {
   kind: 'harvest',
   session: 'sess',
   question: 'q',
   questionForm: 'deliberative',
  },
  prose,
 };
}

function reading(over: Partial<Reading> & { id: string; cites: string[]; at: string }): Reading {
 return {
  facet: 'general-event',
  stance: 'self-observation',
  reading: 'Works most Saturdays now.',
  ...over,
 };
}

const ASKED_AT = '2026-08-02T10:00:00.000Z';

function candidateRecord(over: Partial<ClashCandidate> = {}): ClashCandidate {
 return {
  id: 'cand1',
  pair: ['claimA', 'claimB'],
  channel: 'lexical',
  status: 'pending-remeasure',
  attempts: 1,
  remeasureAskedAt: ASKED_AT,
  model: 'test-model',
  modelAt: '2026-08-02T09:00:00.000Z',
  created: '2026-08-02T09:00:00.000Z',
  ...over,
 };
}

const NEW_SNIP = snippet(
 'snipNEW',
 1,
 'Honestly I have been working every single Saturday since March.'
);
const OLD_SNIP = snippet('snipOLD', 1, QUOTE_A);

const FRESH_READING = reading({
 id: 'readNEW',
 cites: ['snipNEW@1'],
 at: '2026-08-02T11:00:00.000Z',
});
const STALE_READING = reading({
 id: 'readOLD',
 cites: ['snipOLD@1'],
 at: '2026-08-01T09:00:00.000Z',
 reading: 'Protects weekends.',
});

const REMEASURE = {
 readings: [FRESH_READING, STALE_READING],
 snippets: { snipNEW: NEW_SNIP, snipOLD: OLD_SNIP },
};

// ── Stage 1: opposition ─────────────────────────────────────────────────────

describe('judgeOpposition', () => {
 it('accepts an opposition whose poles are both verbatim in their own quotes', async () => {
  const { complete, calls } = recorder([
   JSON.stringify({ opposed: true, poleA: POLE_A, poleB: POLE_B }),
  ]);

  const judgment = await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, complete);

  expect(judgment).toEqual({ opposed: true, poleA: POLE_A, poleB: POLE_B });
  // One bounded judgment — a judgment has no retry to spend.
  expect(calls).toHaveLength(1);
  assertCallShape(calls, JUDGMENT_BUDGET, 0.2);
 });

 it('drops the whole candidate when a pole is not in its quote', async () => {
  // The model asserts an opposition and then cannot cite it. This is the
  // fabrication case, and the candidate does not exist.
  const { complete } = recorder([
   JSON.stringify({ opposed: true, poleA: 'never works at weekends', poleB: POLE_B }),
  ]);

  expect(await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, complete)).toBeNull();
 });

 it('drops a candidate whose poles are verbatim but swapped between the quotes', async () => {
  // Each pole is checked against its OWN quote. A swap would attribute one
  // claim's words to the other, and the re-measure would quote the wrong side.
  const { complete } = recorder([
   JSON.stringify({ opposed: true, poleA: POLE_B, poleB: POLE_A }),
  ]);

  expect(await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, complete)).toBeNull();
 });

 it('drops an opposition asserted with no quote at all', async () => {
  const missing = recorder([JSON.stringify({ opposed: true })]);
  expect(
   await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, missing.complete)
  ).toBeNull();

  const empty = recorder([JSON.stringify({ opposed: true, poleA: '', poleB: '' })]);
  expect(
   await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, empty.complete)
  ).toBeNull();
 });

 it('verifies poles against the CLIPPED quote the model actually saw', async () => {
  // A pole taken from past the 300-char clip was never in the prompt, so it
  // is a lucky guess about the corpus rather than a citation.
  const longQuote = 'x'.repeat(300) + ' HIDDEN TAIL';
  const { complete } = recorder([
   JSON.stringify({ opposed: true, poleA: 'HIDDEN TAIL', poleB: POLE_B }),
  ]);

  expect(
   await judgeOpposition(CLAIM_A, CLAIM_B, { a: longQuote, b: QUOTE_B }, complete)
  ).toBeNull();
 });

 it('fits the largest legal input inside the prompt budget', async () => {
  // Two 300-char bodies and two 300-char quotes is the worst case the shapes
  // permit. If it did not fit, `capPrompt` would throw and every long
  // candidate would silently drop.
  const bigA = claim('bigA', 'a'.repeat(300), ['snipA@1']);
  const bigB = claim('bigB', 'b'.repeat(300), ['snipB@1']);
  const quoteA = 'q'.repeat(300);
  const quoteB = 'r'.repeat(300);
  const { complete, calls } = recorder([
   JSON.stringify({ opposed: true, poleA: 'q'.repeat(20), poleB: 'r'.repeat(20) }),
  ]);

  const judgment = await judgeOpposition(bigA, bigB, { a: quoteA, b: quoteB }, complete);

  expect(judgment?.opposed).toBe(true);
  assertCallShape(calls, JUDGMENT_BUDGET, 0.2);
 });

 it('reports "judged, not opposed" as a judgment and never as a failure', async () => {
  // T12 counts oppositionJudged against oppositionOpposed. If an honest "no"
  // returned null it would be indistinguishable from a dead endpoint, and the
  // precision record Q-49 acts under would be unreadable.
  const { complete } = recorder([JSON.stringify({ opposed: false })]);

  expect(await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, complete)).toEqual({
   opposed: false,
   poleA: '',
   poleB: '',
  });
 });

 it('blanks the poles on a non-opposition rather than passing unverified text on', async () => {
  const { complete } = recorder([
   JSON.stringify({ opposed: false, poleA: 'invented', poleB: 'also invented' }),
  ]);

  expect(await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, complete)).toEqual({
   opposed: false,
   poleA: '',
   poleB: '',
  });
 });

 it('returns null on prose, on an array, and on a non-boolean verdict', async () => {
  const prose = recorder(['Yes, these two clearly contradict one another.']);
  expect(
   await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, prose.complete)
  ).toBeNull();

  const array = recorder(['[{"opposed": true}]']);
  expect(
   await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, array.complete)
  ).toBeNull();

  const stringy = recorder([JSON.stringify({ opposed: 'yes', poleA: POLE_A, poleB: POLE_B })]);
  expect(
   await judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, stringy.complete)
  ).toBeNull();
 });

 it('returns null instead of throwing when the endpoint is dead', async () => {
  await expect(
   judgeOpposition(CLAIM_A, CLAIM_B, { a: QUOTE_A, b: QUOTE_B }, throwing)
  ).resolves.toBeNull();
 });
});

// ── Stage 2: the re-measure ─────────────────────────────────────────────────

const ORIGINAL = 'What does a typical weekend look like for you when work is not pressing?';
const CANDIDATE = { a: CLAIM_A, b: CLAIM_B, poleA: POLE_A, poleB: POLE_B, proseA: QUOTE_A };
const GOOD_QUESTION = `You wrote: "${POLE_A}." What did last Saturday afternoon actually look like?`;

describe('composeRemeasure', () => {
 it('accepts a question that sets off the pole verbatim and builds the draft', async () => {
  const { complete, calls } = recorder([GOOD_QUESTION]);

  const draft = await composeRemeasure(CANDIDATE, [ORIGINAL], complete);

  expect(draft).not.toBeNull();
  expect(draft?.question).toBe(GOOD_QUESTION);
  expect(draft?.quotedFragment).toBe(POLE_A);
  expect(draft?.source).toBe('contradiction-remeasure');
  expect(draft?.horizon).toBe('session');
  expect(draft?.questionForm).toBe('deliberative');
  // Cited to BOTH sides: one question is asked, and the answer is evidence
  // about both claims.
  expect(draft?.cites).toEqual(['snipA@1', 'snipB@1']);
  expect(calls).toHaveLength(1);
  assertCallShape(calls, COMPOSE_BUDGET, 0.4);
 });

 it('keeps the first person inside the quote and never lets it out (Q-12)', async () => {
  // "my" belongs to the speaker and survives verbatim inside the quotation
  // marks; the question around it addresses them as "you".
  expect(GOOD_QUESTION).toContain('my weekends');
  const { complete } = recorder([GOOD_QUESTION]);
  expect(await composeRemeasure(CANDIDATE, [ORIGINAL], complete)).not.toBeNull();

  const firstPerson = `You wrote: "${POLE_A}." What made me want to ask about last Saturday?`;
  const bad = recorder([firstPerson, firstPerson]);
  expect(await composeRemeasure(CANDIDATE, [ORIGINAL], bad.complete)).toBeNull();
 });

 it('rejects a spliced quote and accepts the same words set off', async () => {
  // Q-12 is verbatim AND set off, and the two rules must be separable. This
  // pole carries no first person, so the person guard cannot rescue the
  // assertion: only the framing check can reject the splice.
  const neutral = { a: CLAIM_A, b: CLAIM_B, poleA: POLE_B, poleB: POLE_A, proseA: QUOTE_B };

  const spliced = 'When you worked through both days last weekend, what happened on the Sunday?';
  const bad = recorder([spliced, spliced]);
  expect(await composeRemeasure(neutral, [ORIGINAL], bad.complete)).toBeNull();

  const framed = `You wrote: "${POLE_B}." What happened on the Sunday?`;
  const good = recorder([framed]);
  expect((await composeRemeasure(neutral, [ORIGINAL], good.complete))?.question).toBe(framed);
 });

 it('rejects a declarative and accepts the same sentence asked as a question', async () => {
  const declarative = `You wrote: "${POLE_A}." Last Saturday was different.`;
  const bad = recorder([declarative, declarative]);
  expect(await composeRemeasure(CANDIDATE, [ORIGINAL], bad.complete)).toBeNull();

  const asked = `You wrote: "${POLE_A}." Was last Saturday different?`;
  const good = recorder([asked]);
  expect((await composeRemeasure(CANDIDATE, [ORIGINAL], good.complete))?.question).toBe(asked);
 });

 it('rejects a RE-WORDED repeat of an original question, not only an identical one', async () => {
  // Q-14: still-true checks always ask differently. Equality catches none of
  // the failures the rule is about — this one changes a single word.
  const reworded = `You wrote: "${POLE_A}." What does a typical weekend look like for you when work is not urgent?`;
  const { complete, calls } = recorder([reworded, reworded]);

  expect(await composeRemeasure(CANDIDATE, [ORIGINAL], complete)).toBeNull();
  expect(calls).toHaveLength(2);
 });

 it('refuses to quote both poles together (Q-15 — material, never a case put)', async () => {
  const both = `You wrote: "${POLE_A}." And you also wrote: "${POLE_B}." Which is it?`;
  const { complete } = recorder([both, both]);

  expect(await composeRemeasure(CANDIDATE, [ORIGINAL], complete)).toBeNull();
 });

 it('refuses to hand a claim body back to the person it is about', async () => {
  const accusing = `You wrote: "${POLE_A}." ${CLAIM_B.body} Is that right?`;
  const { complete } = recorder([accusing, accusing]);

  expect(await composeRemeasure(CANDIDATE, [ORIGINAL], complete)).toBeNull();
 });

 it('never lets either claim body into an accepted question', async () => {
  const { complete } = recorder([GOOD_QUESTION]);
  const draft = await composeRemeasure(CANDIDATE, [ORIGINAL], complete);

  expect(draft?.question.includes(CLAIM_A.body)).toBe(false);
  expect(draft?.question.includes(CLAIM_B.body)).toBe(false);
 });

 it('retries exactly once with a correction, then returns null', async () => {
  const noQuote = 'What did last Saturday afternoon look like?';
  const { complete, calls } = recorder([noQuote, noQuote]);

  expect(await composeRemeasure(CANDIDATE, [ORIGINAL], complete)).toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls[1]?.turns[0]?.text).toContain('CRITICAL');
 });

 it('accepts a second attempt that fixes what the first got wrong', async () => {
  const { complete, calls } = recorder(['That sounds hard.', GOOD_QUESTION]);

  const draft = await composeRemeasure(CANDIDATE, [ORIGINAL], complete);

  expect(draft?.question).toBe(GOOD_QUESTION);
  expect(calls).toHaveLength(2);
  assertCallShape(calls, COMPOSE_BUDGET, 0.4);
 });

 it('never shows the model the other pole or either claim body', async () => {
  // Q-15 enforced structurally: the model cannot juxtapose what it was not
  // given, and cannot name a tension it was never told about.
  const { complete, calls } = recorder([GOOD_QUESTION]);
  await composeRemeasure(CANDIDATE, [ORIGINAL], complete);

  const prompt = calls[0]?.turns[0]?.text ?? '';
  expect(prompt).toContain(POLE_A);
  expect(prompt).not.toContain(POLE_B);
  expect(prompt).not.toContain(CLAIM_A.body);
  expect(prompt).not.toContain(CLAIM_B.body);
  expect(prompt.toLowerCase()).not.toContain('contradict');
 });

 it('returns null without calling the model when there is no pole to quote', async () => {
  const { complete, calls } = recorder([GOOD_QUESTION]);

  expect(await composeRemeasure({ ...CANDIDATE, poleA: '' }, [ORIGINAL], complete)).toBeNull();
  expect(calls).toHaveLength(0);
 });

 it('returns null instead of throwing when the endpoint is dead', async () => {
  await expect(composeRemeasure(CANDIDATE, [ORIGINAL], throwing)).resolves.toBeNull();
 });
});

// ── Ticket 088: the quoted pole must be a complete clause ───────────────────

// The RESULTS §16.5 fixture: the T16 re-measure quoted `worked on making` —
// verbatim-valid (Q-46) and not a proposition. Widening inside the real
// sentence must produce the full clause, quoted verbatim.
const T16_PROSE =
 'I worked on making a mechanism for labelling a field recording as well as how the recording sounded.';
const T16_CLAUSE = T16_PROSE;
const T16_CANDIDATE = {
 a: CLAIM_A,
 b: CLAIM_B,
 poleA: 'worked on making',
 poleB: 'kept the archive organised',
 proseA: T16_PROSE,
};
const T16_QUESTION =
 `You wrote: "${T16_CLAUSE}" If you measured that process against a completely different standard, what single aspect would shift the most?`;

describe('composeRemeasure — the quoted pole must be a complete clause (ticket 088)', () => {
 it('widens a non-clause pole to the smallest enclosing clause (the T16 case)', async () => {
  const { complete, calls } = recorder([T16_QUESTION]);

  const draft = await composeRemeasure(T16_CANDIDATE, [], complete);

  expect(draft).not.toBeNull();
  expect(draft?.quotedFragment).toBe(T16_CLAUSE);
  expect(draft?.question).toBe(T16_QUESTION);
  expect(calls).toHaveLength(1);
 });

 it('keeps the widened span an exact substring of the person\'s prose', async () => {
  const { complete } = recorder([T16_QUESTION]);

  const draft = await composeRemeasure(T16_CANDIDATE, [], complete);

  expect(draft?.quotedFragment).not.toBeUndefined();
  expect(T16_PROSE.includes(draft?.quotedFragment ?? '')).toBe(true);
 });

 it('leaves an already-complete clause untouched', async () => {
  const { complete, calls } = recorder([GOOD_QUESTION]);

  const draft = await composeRemeasure(CANDIDATE, [ORIGINAL], complete);

  expect(draft?.quotedFragment).toBe(POLE_A);
  expect(calls[0]?.turns[0]?.text).toContain(`Their words: "${POLE_A}"`);
 });

 it('returns null without calling the model when the widened clause is too long to quote', async () => {
  // A clause that cannot fit the excerpt budget can never be copied whole,
  // so the candidate waits for the next run instead of burning two calls.
  const longProse = 'I worked on making ' + 'very '.repeat(80) + 'detailed mechanisms.';
  const { complete, calls } = recorder([]);

  const draft = await composeRemeasure(
   { ...CANDIDATE, poleA: 'worked on making', proseA: longProse },
   [ORIGINAL],
   complete,
  );

  expect(draft).toBeNull();
  expect(calls).toHaveLength(0);
 });
});

// ── Stage 3: confirmation ───────────────────────────────────────────────────

const CONFIRMING = JSON.stringify({
 confirmed: true,
 type: 'synchronic',
 reason: 'The fresh answer restates the opposite pole.',
 evidence: {
  snippetRef: 'snipNEW@1',
  quote: 'working every single Saturday',
  side: 'b',
 },
});

describe('judgeConfirmation', () => {
 it('confirms on a verbatim quote from a snippet the answer produced', async () => {
  const { complete, calls } = recorder([CONFIRMING]);

  const result = await judgeConfirmation(
   candidateRecord(),
   REMEASURE,
   { a: CLAIM_A, b: CLAIM_B },
   complete
  );

  expect(result).toEqual({
   confirmed: true,
   type: 'synchronic',
   reason: 'The fresh answer restates the opposite pole.',
   evidence: { snippetRef: 'snipNEW@1', quote: 'working every single Saturday', side: 'b' },
  });
  assertCallShape(calls, JUDGMENT_BUDGET, 0.2);
 });

 it('refuses a confirmation whose quote appears in no supplied snippet', async () => {
  const { complete } = recorder([
   JSON.stringify({
    confirmed: true,
    type: 'synchronic',
    reason: 'It holds.',
    evidence: { snippetRef: 'snipNEW@1', quote: 'working every single Sunday', side: 'b' },
   }),
  ]);

  expect(
   await judgeConfirmation(candidateRecord(), REMEASURE, { a: CLAIM_A, b: CLAIM_B }, complete)
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('refuses a verbatim quote whose only witness reading predates the question', async () => {
  // Without this the model confirms a contradiction by quoting the snippet
  // that raised the suspicion in the first place.
  const { complete } = recorder([
   JSON.stringify({
    confirmed: true,
    type: 'synchronic',
    reason: 'It holds.',
    evidence: { snippetRef: 'snipOLD@1', quote: POLE_A, side: 'a' },
   }),
  ]);

  expect(
   await judgeConfirmation(candidateRecord(), REMEASURE, { a: CLAIM_A, b: CLAIM_B }, complete)
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('refuses a confirmation citing a ref no supplied reading cites', async () => {
  const { complete } = recorder([
   JSON.stringify({
    confirmed: true,
    type: 'synchronic',
    reason: 'It holds.',
    evidence: { snippetRef: 'snipGHOST@1', quote: 'anything', side: 'a' },
   }),
  ]);

  expect(
   await judgeConfirmation(candidateRecord(), REMEASURE, { a: CLAIM_A, b: CLAIM_B }, complete)
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('refuses a confirmation with no evidence at all', async () => {
  const { complete } = recorder([
   JSON.stringify({ confirmed: true, type: 'synchronic', reason: 'Obviously opposed.' }),
  ]);

  expect(
   await judgeConfirmation(candidateRecord(), REMEASURE, { a: CLAIM_A, b: CLAIM_B }, complete)
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('refuses evidence that is not an object, and evidence naming no real side', async () => {
  // `side` is written onto the Contradiction file. A value outside the union
  // would be a claim about which pole the words carry that means nothing.
  const notAnObject = recorder([
   JSON.stringify({ confirmed: true, type: 'synchronic', reason: 'r', evidence: 'snipNEW@1' }),
  ]);
  expect(
   await judgeConfirmation(
    candidateRecord(),
    REMEASURE,
    { a: CLAIM_A, b: CLAIM_B },
    notAnObject.complete
   )
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });

  const badSide = recorder([
   JSON.stringify({
    confirmed: true,
    type: 'synchronic',
    reason: 'r',
    evidence: { snippetRef: 'snipNEW@1', quote: 'working every single Saturday', side: 'c' },
   }),
  ]);
  expect(
   await judgeConfirmation(
    candidateRecord(),
    REMEASURE,
    { a: CLAIM_A, b: CLAIM_B },
    badSide.complete
   )
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('refuses a ref naming a snippet version it was not given', async () => {
  // The reading cites @2 and the graph holds @1. "Verbatim in that snippet's
  // prose" is uncheckable against prose we do not hold, and uncheckable is
  // exactly what this gate refuses.
  const reVersioned = {
   readings: [reading({ id: 'readV2', cites: ['snipNEW@2'], at: '2026-08-02T11:00:00.000Z' })],
   snippets: { snipNEW: NEW_SNIP },
  };
  const { complete } = recorder([
   JSON.stringify({
    confirmed: true,
    type: 'synchronic',
    reason: 'It holds.',
    evidence: { snippetRef: 'snipNEW@2', quote: 'working every single Saturday', side: 'b' },
   }),
  ]);

  expect(
   await judgeConfirmation(candidateRecord(), reVersioned, { a: CLAIM_A, b: CLAIM_B }, complete)
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('refuses to confirm when the candidate has no remeasureAskedAt window', async () => {
  const { complete } = recorder([CONFIRMING]);
  const noWindow = candidateRecord();
  delete noWindow.remeasureAskedAt;

  expect(
   await judgeConfirmation(noWindow, REMEASURE, { a: CLAIM_A, b: CLAIM_B }, complete)
  ).toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('types a superseded stance diachronic even when the model says synchronic', async () => {
  const changed = {
   readings: [reading({ id: 'readNEW', cites: ['snipNEW@1'], at: '2026-08-02T11:00:00.000Z', stance: 'superseded' })],
   snippets: { snipNEW: NEW_SNIP },
  };
  const { complete } = recorder([CONFIRMING]);

  const result = await judgeConfirmation(
   candidateRecord(),
   changed,
   { a: CLAIM_A, b: CLAIM_B },
   complete
  );

  expect(result).toMatchObject({ confirmed: true, type: 'diachronic' });
 });

 it('keeps an honest "no" distinguishable from a refused confirmation', async () => {
  // T12 writes `dissolved-on-answer` for one and `unverified-confirmation`
  // for the other, and the ratio between them is the direct measurement of
  // what the self-reported boolean was worth.
  const { complete } = recorder([
   JSON.stringify({ confirmed: false, reason: 'The answer is about a different thing.' }),
  ]);

  const result = await judgeConfirmation(
   candidateRecord(),
   REMEASURE,
   { a: CLAIM_A, b: CLAIM_B },
   complete
  );

  expect(result).toEqual({
   confirmed: false,
   reason: 'The answer is about a different thing.',
  });
  expect(result).not.toEqual({ confirmed: false, reason: UNVERIFIED_CONFIRMATION });
 });

 it('returns null on prose rather than dissolving a candidate on a parse failure', async () => {
  const { complete } = recorder(['I think they still contradict each other, yes.']);

  expect(
   await judgeConfirmation(candidateRecord(), REMEASURE, { a: CLAIM_A, b: CLAIM_B }, complete)
  ).toBeNull();
 });

 it('returns null without calling the model when the answer produced no readings', async () => {
  const { complete, calls } = recorder([CONFIRMING]);

  expect(
   await judgeConfirmation(
    candidateRecord(),
    { readings: [], snippets: {} },
    { a: CLAIM_A, b: CLAIM_B },
    complete
   )
  ).toBeNull();
  expect(calls).toHaveLength(0);
 });

 it('returns null instead of throwing when the endpoint is dead', async () => {
  await expect(
   judgeConfirmation(candidateRecord(), REMEASURE, { a: CLAIM_A, b: CLAIM_B }, throwing)
  ).resolves.toBeNull();
 });

 it('shows the model the refs it is allowed to quote', async () => {
  const { complete, calls } = recorder([CONFIRMING]);
  await judgeConfirmation(candidateRecord(), REMEASURE, { a: CLAIM_A, b: CLAIM_B }, complete);

  const prompt = calls[0]?.turns[0]?.text ?? '';
  expect(prompt).toContain('snipNEW@1');
  expect(prompt).toContain('working every single Saturday');
 });
});
