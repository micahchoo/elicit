/**
 * The contradiction pipeline's model calls — Q-30 stages 1 through 3.
 *
 * Three functions, one posture: the model proposes, the code disposes. This
 * module writes nothing, opens nothing and sets no status; T12 persists what
 * survives. Every function returns `null` rather than throwing, because a
 * suspicion that cannot be judged must cost the run nothing (ticket 023 item 2).
 *
 * WHERE THE MODEL'S WORD IS LOAD-BEARING, AND WHAT CATCHES IT
 *
 *   `judgeOpposition.opposed` — LOAD-BEARING, by decision (Q-49). Q-30 defines
 *   a candidate AS two claims with model-judged opposed stances, so shadowing
 *   this judgment leaves stages 2 to 5 with no input at all. What it buys is
 *   one guarded, non-accusatory question the user may ignore. It is backstopped
 *   here by the pole check: `opposed: true` is accepted only when the model can
 *   copy both poles verbatim out of the quotes it was given. A model that
 *   invented the opposition cannot produce those two substrings, and the whole
 *   candidate drops to `null`.
 *
 *   `judgeConfirmation.confirmed` — NOT load-bearing. It opens a Contradiction,
 *   which is the one irreversible act in the pipeline, and eval finding #6
 *   measured exactly this shape (a self-reported boolean) degrading to `true`
 *   under mild pressure. So `confirmed: true` is only ever a request: three
 *   code checks over a verbatim quote decide (Q-46, Q-44's rationale), and
 *   failing any one of them rewrites the answer to
 *   `{ confirmed: false, reason: UNVERIFIED_CONFIRMATION }`.
 *
 *   The composed re-measure's TEXT — never trusted. The question passes the
 *   same shipped guards every other compose path passes (`isInterrogative`,
 *   `hasFirstPersonOutsideQuote`, `quotesFragmentSetOff`), plus Q-14's
 *   ask-differently rule as `isNearDuplicate` rather than string equality,
 *   because a re-worded repeat is the failure Q-14 actually names.
 *
 * ON Q-15 — a re-measure is MATERIAL, never an accusation. The compose prompt
 * is shown ONE pole and never the other, never either claim body, and never the
 * word "contradiction": the model cannot juxtapose what it was not given. The
 * checks after it are the backstop, not the mechanism.
 *
 * This is CLERK work (Q-48): the caller injects `makeComplete('clerk')`, which
 * reads `ELICIT_CLERK_MODEL ?? 'qwen3.6:35b'`. This module names no model and
 * stamps no artifact — T12 does both, so a stamp can never disagree with the
 * endpoint that answered.
 */

import type { Complete, QueueDraft, Reading, Snippet } from '../types.js';
import type { Claim, ClashCandidate, ClashEvidence } from '../wiki/contract.js';
import { citeParts } from '../wiki/status.js';
import { assertUserTurn, capPrompt, fitPayload, readingTime, userTurn } from '../wiki/contract.js';
import {
 hasFirstPersonOutsideQuote,
 isInterrogative,
 isNearDuplicate,
 quotesFragmentSetOff,
} from '../language/guards.js';
import { widenToClause } from './clause.js';
import { corrective, FRAMING_RULE, stripFences, type Rejection } from './compose-gate.js';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * These are PROMPT BUDGETS, not selection thresholds, which is why they live
 * here and not in `src/wiki/thresholds.ts`. Nothing is selected, admitted or
 * suppressed by them: they only decide how much text a bounded call is allowed
 * to carry. A threshold decides what the system does; a budget decides what
 * fits in 16k of context (ADR-0001).
 */
const JUDGMENT_BUDGET_CHARS = 2000;

/**
 * The composed re-measure gets more room than a judgment: it carries the
 * framing rule, the pole, and the questions it must not repeat. Bounded all the
 * same, so no call in this module can send a prompt nobody measured.
 */
const COMPOSE_BUDGET_CHARS = 3000;

/**
 * How many earlier questions the prompt shows. `isNearDuplicate` still checks
 * the question against ALL of them in code — the list in the prompt is an
 * instruction, and the check is the enforcement (Q-36).
 */
const ORIGINALS_SHOWN = 5;

/** Per-quote and per-body clip. The claim body is already ≤300 by T9's rule 10. */
const EXCERPT_CHARS = 300;

/** The floor a payload part may be truncated to before it is worth dropping. */
const EXCERPT_FLOOR = 200;

/** A judgment wants the same answer twice; a composed question wants a voice. */
const JUDGMENT_TEMPERATURE = 0.2;
const COMPOSE_TEMPERATURE = 0.4;

/**
 * The `reason` written onto a dissolved candidate when the model claimed a
 * confirmation it could not evidence. Exported because it is a `ClashOutcome`
 * member and T12 branches on it to tell an unverified confirmation apart from
 * an honest "no" — that ratio is the direct measurement of what the boolean was
 * worth, and a retyped string literal is a measurement that silently stops.
 */
export const UNVERIFIED_CONFIRMATION = 'unverified-confirmation';

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/**
 * Clip with NO ellipsis marker.
 *
 * An added "…" becomes text the model can copy, and a pole carrying it would
 * pass a verbatim check against the clipped quote while being absent from the
 * user's actual words. The verbatim discipline only holds if the excerpt is
 * pure excerpt.
 */
function clip(text: string, max: number): string {
 return text.length <= max ? text : text.slice(0, max);
}

/**
 * Send one bounded prompt as a single user turn.
 *
 * `system` is empty on purpose: with everything in the user turn, the budget
 * `capPrompt` asserted is the WHOLE prompt and not a fraction of it.
 */
async function askOnce(
 complete: Complete,
 payload: string,
 temperature: number
): Promise<string> {
 const turns = userTurn(payload);
 // User-LAST. A list ending on an assistant turn makes llama.cpp generate
 // nothing at all, which once surfaced as a silent total harvest failure.
 assertUserTurn(turns);
 return complete('', turns, { temperature });
}

/** Parse a JSON object, or nothing. Prose in, `null` out — never a throw. */
function parseObject(raw: string): Record<string, unknown> | null {
 try {
  const parsed: unknown = JSON.parse(stripFences(raw));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
 } catch {
  return null;
 }
}

function asString(v: unknown): string | null {
 return typeof v === 'string' && v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Stage 1 — opposition (Q-30 stage 1, Q-49)
// ---------------------------------------------------------------------------

/**
 * The stage-1 answer. `opposed: false` is a JUDGMENT and `null` is a FAILURE —
 * T12 counts `oppositionJudged` against `oppositionOpposed`, and the two cannot
 * collapse without destroying the precision record Q-49 acts under.
 *
 * When `opposed` is false the poles are empty strings, never the model's
 * unverified text: this field's contract is "verbatim from the quote", and a
 * non-opposition has nothing to quote.
 */
export type OppositionJudgment = { opposed: boolean; poleA: string; poleB: string };

const OPPOSITION_TASK = `Two statements were written about the same person, each resting on words that person wrote. Decide whether they take OPPOSED positions on one construct.

Return ONLY this JSON. No fences, no commentary:
{"opposed": true, "poleA": "", "poleB": ""}

If opposed is true, "poleA" MUST be an exact substring of QUOTE A and "poleB" MUST be an exact substring of QUOTE B. Copy the person's words character for character and copy nothing else. A pole you cannot copy out of the quote is not a pole.
If the two are about different things, or agree, or one merely adds detail, return opposed: false with empty poles.`;

/**
 * Stage 1: are these two claims opposed, and can the model quote both poles?
 *
 * The verbatim check runs against the CLIPPED quotes, which is what the model
 * actually saw. Checking against the full text would accept a pole from a part
 * of the snippet that was never in the prompt — which is a lucky guess, not a
 * citation.
 */
export async function judgeOpposition(
 a: Claim,
 b: Claim,
 quotes: { a: string; b: string },
 complete: Complete
): Promise<OppositionJudgment | null> {
 const quoteA = clip(quotes.a, EXCERPT_CHARS);
 const quoteB = clip(quotes.b, EXCERPT_CHARS);

 try {
  const payload = capPrompt(
   [
    OPPOSITION_TASK,
    `STATEMENT A: ${clip(a.body, EXCERPT_CHARS)}`,
    `QUOTE A: ${quoteA}`,
    `STATEMENT B: ${clip(b.body, EXCERPT_CHARS)}`,
    `QUOTE B: ${quoteB}`,
   ],
   JUDGMENT_BUDGET_CHARS
  );

  const parsed = parseObject(await askOnce(complete, payload, JUDGMENT_TEMPERATURE));
  if (!parsed) {
   console.warn('Contradiction: opposition judgment did not parse — dropping candidate');
   return null;
  }

  const opposed = parsed['opposed'];
  if (typeof opposed !== 'boolean') {
   console.warn('Contradiction: opposition judgment carried no boolean — dropping candidate');
   return null;
  }

  // An honest "no" needs no poles, and demanding them would turn every
  // negative into a null and erase the precision record Q-49 acts under.
  if (!opposed) return { opposed: false, poleA: '', poleB: '' };

  const poleA = asString(parsed['poleA']);
  const poleB = asString(parsed['poleB']);
  if (!poleA || !poleB) {
   console.warn('Contradiction: opposed with a missing pole — dropping candidate');
   return null;
  }

  // Q-1's posture, applied to the judgment: the person's words carry the
  // pole, or nothing does. Each pole is checked against ITS OWN quote —
  // a swapped pair is the model failing an explicit instruction, and
  // accepting it would attribute one claim's words to the other.
  if (!quoteA.includes(poleA) || !quoteB.includes(poleB)) {
   console.warn('Contradiction: pole not verbatim in its quote — dropping candidate');
   return null;
  }

  return { opposed: true, poleA, poleB };
 } catch (err) {
  console.warn(
   `Contradiction: opposition judgment failed — ${err instanceof Error ? err.message : String(err)}`
  );
  return null;
 }
}

// ---------------------------------------------------------------------------
// Stage 2 — the re-measure question (Q-30 stage 2, Q-14, Q-12, Q-15)
// ---------------------------------------------------------------------------

/**
 * The gate every re-measure passes. Ordered so the cheapest and most
 * fundamental refusal comes first, and so an unframed splice is rejected as a
 * splice before its "I" is judged (040: masking a spliced fragment would
 * launder the user's first person into the agent's half of the sentence).
 */
function checkRemeasure(
 question: string,
 pole: string,
 otherPole: string,
 bodies: string[],
 originalQuestions: string[]
): Rejection | null {
 if (!question || !question.includes(pole)) return 'no-quote';
 if (!quotesFragmentSetOff(question, pole)) return 'unframed-quote';
 if (!isInterrogative(question, pole)) return 'not-interrogative';
 if (hasFirstPersonOutsideQuote(question, pole)) return 'first-person';

 // Q-15: the question is a fresh measurement, never a case put to the user.
 // Neither claim body may appear — those are the agent's summaries of the
 // person, and handing one back with a question attached is the accusation
 // shape whatever its wording. The prompt is never shown a body, so this is a
 // backstop; it is here because "the prompt does not mention it" is a promise
 // and this is a check.
 if (bodies.some((body) => body.length > 0 && question.includes(body))) {
  return 'names-the-tension';
 }

 // The other pole never appears alongside this one: quoting both sides
 // together IS the juxtaposition, and a juxtaposition is what the Wiki shows
 // AFTER a Contradiction opens, not what the question that might open it does.
 // Skipped when one pole contains the other, where quoting the longer one
 // unavoidably quotes the shorter and the rejection would be an artefact.
 const nested = pole.includes(otherPole) || otherPole.includes(pole);
 if (!nested && quotesFragmentSetOff(question, otherPole)) return 'names-the-tension';

 // Q-14, as similarity and not as equality: a re-worded repeat of the question
 // that produced the claim is precisely the failure Q-14 names, and `===`
 // catches none of them.
 if (isNearDuplicate(question, originalQuestions)) return 'repeats-original';

 return null;
}

/**
 * Stage 2: ONE question, asked differently, that re-measures the construct.
 *
 * The prompt carries ONE pole — `poleA`, deterministically, so the same
 * candidate composes the same way on every run. It carries neither claim body,
 * neither claim id and no word for the tension. The model is composing a
 * curious question about something the person wrote, because that is all it has
 * been given, and that is exactly what Q-15 asks the user to receive.
 *
 * `null` is a legitimate return: the candidate simply waits for the next run.
 */
export async function composeRemeasure(
 candidate: { a: Claim; b: Claim; poleA: string; poleB: string; proseA: string },
 originalQuestions: string[],
 complete: Complete
): Promise<QueueDraft | null> {
 let pole = candidate.poleA;
 if (!pole) return null;

 // Ticket 088: the quoted pole must be a complete clause, decided
 // mechanically, never by a model. `worked on making` passed Q-46's
 // verbatim check and was not a proposition (RESULTS §16.5); widening to
 // the smallest enclosing clause inside the person's prose keeps the
 // verbatim rule and fixes the aboutness. `proseA` is the prose the pole
 // was quoted from, supplied by the caller that holds the snippet.
 pole = widenToClause(pole, candidate.proseA);
 // A widened clause longer than the excerpt budget can never be copied
 // whole — `clip` truncates what the model sees while `checkRemeasure`
 // demands the full pole — so the candidate waits for the next run.
 if (pole.length > EXCERPT_CHARS) {
  console.warn('Contradiction: widened pole exceeds the excerpt budget — returning null');
  return null;
 }

 const bodies = [candidate.a.body, candidate.b.body];
 const shown = originalQuestions.slice(0, ORIGINALS_SHOWN);
 const avoid =
  shown.length > 0
   ? `They have already been asked these. Do NOT repeat or re-word any of them:\n${shown
    .map((q) => `- ${clip(q, EXCERPT_CHARS)}`)
    .join('\n')}\n`
   : '';

 const base = `You are a clerk for Elicit. Compose ONE question that takes a fresh measurement of something the speaker wrote about before.

Their words: "${clip(pole, EXCERPT_CHARS)}"

Ask about the same thing from a different angle — a specific occasion, a comparison, a case where it did not hold. Do not ask whether they still believe it. Do not ask them to explain or justify themselves. Do not suggest anything is wrong. They should not be able to tell this question came from anything but curiosity.

${avoid}${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 try {
  const prompt = capPrompt([base], COMPOSE_BUDGET_CHARS);
  let raw = await askOnce(complete, prompt, COMPOSE_TEMPERATURE);
  let question = stripFences(raw).trim();
  let rejection = checkRemeasure(question, pole, candidate.poleB, bodies, originalQuestions);
  if (!rejection) return buildRemeasureDraft(candidate, question, pole);

  // One retry, corrected for what failed — the same discipline every other
  // compose path in the tree runs (`composeStillTrue`). Two attempts, then
  // silence: a third would spend a 40s clerk call to hear the same refusal.
  console.warn(`Contradiction: re-measure rejected (${rejection}), retrying`);
  const retry = capPrompt([prompt, corrective(rejection, `Your question MUST contain this exact phrase, inside quotation marks: "${pole}".`, 'remeasure')], COMPOSE_BUDGET_CHARS);
  raw = await askOnce(complete, retry, COMPOSE_TEMPERATURE);
  question = stripFences(raw).trim();
  rejection = checkRemeasure(question, pole, candidate.poleB, bodies, originalQuestions);
  if (!rejection) return buildRemeasureDraft(candidate, question, pole);

  console.warn(`Contradiction: re-measure retry also rejected (${rejection}) — returning null`);
  return null;
 } catch (err) {
  console.warn(
   `Contradiction: re-measure compose failed — ${err instanceof Error ? err.message : String(err)}`
  );
  return null;
 }
}

/**
 * The draft, cited to BOTH sides.
 *
 * The question quotes one pole and the user reads one question, but the answer
 * is evidence about both claims, and `cites` is what makes that legible later.
 * Deduped and order-preserving so two runs over the same candidate produce the
 * same entry.
 */
function buildRemeasureDraft(
 candidate: { a: Claim; b: Claim },
 question: string,
 quotedFragment: string
): QueueDraft {
 const cites = [...new Set([...candidate.a.cites, ...candidate.b.cites])];
 return {
  source: 'contradiction-remeasure',
  license: 'CC0',
  question,
  questionForm: 'deliberative',
  cites,
  quotedFragment,
  sharpness: 'weak',
  horizon: 'session',
 };
}

// ---------------------------------------------------------------------------
// Stage 3 — confirmation (Q-30 stage 3, Q-46, B5)
// ---------------------------------------------------------------------------

export type ConfirmResult =
 | {
  confirmed: true;
  type: 'synchronic' | 'diachronic';
  reason: string;
  evidence: ClashEvidence;
 }
 | { confirmed: false; reason: string };

const CONFIRMATION_TASK = `A person was asked a fresh question about something they had written about before. Below are the readings taken from their answer, and the exact words each reading rests on.

Two earlier statements about this person are in tension. Decide whether the new answer CONFIRMS that tension or dissolves it.

Return ONLY this JSON. No fences, no commentary:
{"confirmed": true, "type": "synchronic", "reason": "one short sentence", "evidence": {"snippetRef": "the ref you are quoting", "quote": "words copied from that ref", "side": "a"}}

If confirmed is true you MUST supply evidence, "snippetRef" MUST be one of the refs below, and "quote" MUST be copied character for character out of that ref's text. A confirmation you cannot quote is not a confirmation — return confirmed: false instead.
"synchronic" means both positions are held now. "diachronic" means the person changed and the earlier position is past.
"side" is "a" or "b": which of the two statements the quoted words support.`;

/**
 * Stage 3: did the re-measured reading confirm the opposition?
 *
 * The boolean is a request. Three checks decide, and each one closes a way for
 * a model to "confirm" without evidence:
 *
 *   1. the ref is cited by one of the supplied re-measure readings — otherwise
 *      the quote comes from somewhere nobody asked about;
 *   2. the quote is an exact substring of that snippet's prose — the user's own
 *      words carry the pole, or nothing does (Q-1's discipline, one layer up);
 *   3. that reading is LATER than `remeasureAskedAt` — otherwise the model can
 *      confirm the contradiction by quoting the snippet that created it.
 *
 * Failing any one rewrites the answer to `{ confirmed: false, reason:
 * UNVERIFIED_CONFIRMATION }`, which T12 counts apart from an honest "no".
 */
export async function judgeConfirmation(
 candidate: ClashCandidate,
 remeasure: { readings: Reading[]; snippets: Record<string, Snippet> },
 claims: { a: Claim; b: Claim },
 complete: Complete
): Promise<ConfirmResult | null> {
 // No answer to read is not a dissolution — the person may simply not have
 // answered yet, and dissolving here would retire the pair forever on a run
 // that learned nothing.
 if (remeasure.readings.length === 0) return null;

 try {
  const parts = [
   { name: 'task', text: CONFIRMATION_TASK, required: true },
   {
    name: 'statements',
    text: `STATEMENT A: ${clip(claims.a.body, EXCERPT_CHARS)}\nSTATEMENT B: ${clip(claims.b.body, EXCERPT_CHARS)}`,
    required: true,
    floor: EXCERPT_FLOOR,
   },
   // The FIRST reading is required and the rest are droppable. A payload
   // trimmed until no reading survives would ask the model to confirm from
   // nothing, and it would answer "no" — dissolving a candidate on a budget
   // decision rather than on the person's answer. Required means: if even
   // one reading cannot fit, `fitPayload` returns null and the run skips.
   ...remeasure.readings.map((r, i) => ({
    name: `reading-${i}`,
    text: readingBlock(r, remeasure.snippets),
    required: i === 0,
    floor: EXCERPT_FLOOR,
   })),
  ];

  const fitted = fitPayload(parts, JUDGMENT_BUDGET_CHARS);
  if (!fitted) {
   console.warn('Contradiction: confirmation payload does not fit — skipping this run');
   return null;
  }
  const payload = capPrompt([fitted.text], JUDGMENT_BUDGET_CHARS);

  const parsed = parseObject(await askOnce(complete, payload, JUDGMENT_TEMPERATURE));
  if (!parsed) {
   console.warn('Contradiction: confirmation judgment did not parse — skipping this run');
   return null;
  }

  const reason = clip(asString(parsed['reason']) ?? 'no reason given', EXCERPT_CHARS);
  if (parsed['confirmed'] !== true) {
   // The expected common case, and the cheap one: the model looked at the
   // answer and the tension was not there.
   return { confirmed: false, reason };
  }

  const evidence = verifyEvidence(parsed['evidence'], candidate, remeasure);
  if (!evidence) return { confirmed: false, reason: UNVERIFIED_CONFIRMATION };

  return { confirmed: true, type: confirmedType(parsed['type'], remeasure), reason, evidence };
 } catch (err) {
  console.warn(
   `Contradiction: confirmation judgment failed — ${err instanceof Error ? err.message : String(err)}`
  );
  return null;
 }
}

/** One reading and the words it rests on, as the model sees them. */
function readingBlock(r: Reading, snippets: Record<string, Snippet>): string {
 const lines = [`ANSWER READING (${r.stance}): ${clip(r.reading, EXCERPT_CHARS)}`];
 for (const ref of r.cites) {
  const parsedRef = citeParts(ref);
  const snip = parsedRef ? snippets[parsedRef.snippetId] : undefined;
  if (!snip) continue;
  lines.push(`  ${ref}: "${clip(snip.prose, EXCERPT_CHARS)}"`);
 }
 return lines.join('\n');
}

/**
 * The three structural checks, in one place, returning the evidence only when
 * all three pass. `null` here is what turns a `confirmed: true` into a
 * `confirmed: false`.
 */
function verifyEvidence(
 raw: unknown,
 candidate: ClashCandidate,
 remeasure: { readings: Reading[]; snippets: Record<string, Snippet> }
): ClashEvidence | null {
 // Without a left edge there is no window, so nothing can be shown to have
 // come from the answer rather than from the corpus that raised the suspicion.
 const askedAt = candidate.remeasureAskedAt;
 if (!askedAt) {
  console.warn('Contradiction: candidate has no remeasureAskedAt — cannot verify confirmation');
  return null;
 }

 if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
  console.warn('Contradiction: confirmed with no evidence object — not confirmed');
  return null;
 }
 const e = raw as Record<string, unknown>;
 const snippetRef = asString(e['snippetRef']);
 const quote = asString(e['quote']);
 const side = e['side'] === 'b' ? 'b' : e['side'] === 'a' ? 'a' : null;
 if (!snippetRef || !quote || !side) {
  console.warn('Contradiction: confirmed with incomplete evidence — not confirmed');
  return null;
 }

 // 1. The ref is cited by a supplied re-measure reading, AND
 // 3. that reading happened after the question was asked. Both conditions
 //    must hold of the SAME reading: an old reading citing the same snippet
 //    would otherwise satisfy (1) while a new unrelated one satisfied (3).
 const witness = remeasure.readings.find(
  (r) => r.cites.includes(snippetRef) && readingTime(r) > askedAt
 );
 if (!witness) {
  console.warn(
   `Contradiction: no re-measure reading later than ${askedAt} cites ${snippetRef} — not confirmed`
  );
  return null;
 }

 // 2. The quote is verbatim in the prose of the snippet the ref NAMES. A
 //    version we do not hold is a snippet we cannot check, and an unverifiable
 //    quote is the case this whole function exists for.
 const parsedRef = citeParts(snippetRef);
 const snip = parsedRef ? remeasure.snippets[parsedRef.snippetId] : undefined;
 if (!parsedRef || !snip || snip.version !== parsedRef.version) {
  console.warn(`Contradiction: ${snippetRef} resolves to no supplied snippet — not confirmed`);
  return null;
 }
 if (!snip.prose.includes(quote)) {
  console.warn('Contradiction: confirming quote is not verbatim in its snippet — not confirmed');
  return null;
 }

 return { snippetRef, quote, side };
}

/**
 * Mechanical override, applied after the model answers: a superseded stance
 * makes the tension diachronic whatever the model said. The person changed, the
 * tension IS the finding, and no resolution is sought (CONTEXT — Contradiction).
 *
 * WHY this reads the stance off the supplied readings and not off the claims:
 * `Stance` lives on `Reading` (`src/types.ts`) and on nothing else — not on
 * `Claim`, not on `Snippet`. The plan's phrase "either claim's cited snippets
 * carry stance: 'superseded'" names a fact no shape in this signature can hold.
 * What IS in hand is the re-measure's own readings, and that is where the
 * finding actually lives: the person answered the fresh question in a way the
 * harvester read as superseding an earlier self. Reported as a deviation.
 */
function confirmedType(
 raw: unknown,
 remeasure: { readings: Reading[] }
): 'synchronic' | 'diachronic' {
 if (remeasure.readings.some((r) => r.stance === 'superseded')) return 'diachronic';
 return raw === 'diachronic' ? 'diachronic' : 'synchronic';
}
