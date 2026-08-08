import type {
 Complete,
 Turn,
 RedLight,
 ResonanceHit,
 Snippet,
 Reading,
 QueueDraft,
 QueueEntry,
 QuestionForm,
 Target,
} from '../types.js';
import type { Claim } from '../wiki/contract.js';
import type { ProtocolDef } from '../protocols/registry.js';
import {
 isInterrogative,
 hasFirstPersonOutsideQuote,
 quotesFragmentSetOff,
 setOffSpans,
} from '../language/guards.js';
import { contentWordSequence } from '../index/lexical.js';
import { THRESHOLDS, shadowDecision } from '../wiki/thresholds.js'
import type { ThresholdLogFn } from '../domain/thresholds.js';
import { guardComposed } from '../language/emit-form.js';
import { readAllRepairs } from '../repair/store.js';
import { isUnderRepair } from '../repair/consult.js';
import { composeWithRetry, corrective, FRAMING_RULE, stripFences, type Rejection } from './compose-gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Optional sink the server installs at boot so draft rejections reach the
 * Activity Log (Q-23) — the console alone outlives no session, and the eval
 * that found gemma's drafts failing the emit gate twice per descent had to
 * read a terminal scrollback to see it. The sink receives only the SITE and
 * a REASON CATEGORY, never the message: reject messages can quote drafted
 * text, and the log carries counts, not words.
 */
let draftRejectSink: ((site: string, reason: string) => void) | undefined;
export function setDraftRejectSink(sink: (site: string, reason: string) => void): void {
 draftRejectSink = sink;
}

/** console.warn a `Composed: <site> rejected …` line AND count it in the log. */
function warnReject(message: string): void {
 console.warn(message);
 if (!draftRejectSink) return;
 const m = /^Composed: (.+?) (?:retry (?:also )?)?rejected/.exec(message);
 const site = (m?.[1] ?? 'unknown').replace(/\s+/g, '-');
 const reason = message.includes('emit-form') ? 'emit-form'
  : message.includes('summary-echo') ? 'summary-echo'
  : 'guard';
 try {
  draftRejectSink(site, reason);
 } catch {
  // The log must never break composition.
 }
}

/**
 * Find the longest substring of `source` that appears verbatim in `question`.
 * Returns null if no match of at least `minWords` content words is found.
 * Mirrors the harvester's substring validation posture (Q-1 → Q-12).
 */
export function findQuotedFragment(
 source: string,
 question: string,
 minWords = 3,
): string | null {
 let best = '';
 for (let i = 0; i < source.length; i++) {
  for (let j = i + best.length + 1; j <= source.length; j++) {
   const candidate = source.slice(i, j);
   if (question.includes(candidate)) {
    best = candidate;
   } else {
    break; // longer substrings from this start won't match either
   }
  }
 }
 if (best.length === 0) return null;
 const wordCount = best.trim().split(/\s+/).length;
 if (wordCount < minWords) return null;
 return best;
}

/**
 * The longest run of `source` that the question quotes AND sets off (040).
 *
 * Searched span by span rather than over the whole question, so an incidental
 * unmarked match cannot outrank the fragment the model actually framed.
 */
function findSetOffFragment(
 question: string,
 source: string,
 minWords = 3,
): string | null {
 let best: string | null = null;
 for (const span of setOffSpans(question)) {
  const inner = question.slice(span.start, span.end);
  const candidate = findQuotedFragment(source, inner, minWords);
  if (candidate && (!best || candidate.length > best.length)) best = candidate;
 }
 return best;
}

/**
 * Q-12 tightening: reject a composed question that does not strictly extend the
 * quoted fragment. Returns true if the question is degenerate — too close to
 * the source material to count as a genuine composition.
 */
function isDegenerateComposition(
 question: string,
 quotedFragment: string,
 userTurnFull: string,
): boolean {
 const q = question.trim();
 const f = quotedFragment.trim();
 const u = userTurnFull.trim();

 // Equals the fragment verbatim
 if (q === f) return true;
 // Equals the user's whole turn
 if (q === u) return true;

 // Adds fewer than 3 content words around the quote
 // Strip the fragment from the question; count remaining content words
 const remainder = q.replace(
  new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
  '',
 ).trim();
 const contentWords = remainder
  .split(/\s+/)
  .filter((w) => w.length > 0 && /^[a-z]/i.test(w));
 if (contentWords.length < 3) return true;

 return false;
}

// ---------------------------------------------------------------------------
// The composed-question gate
// ---------------------------------------------------------------------------

/**
 * Checks that apply once a verbatim fragment is in hand.
 *
 * Quoting is checked first and never weakened (Q-1/Q-12); these run after,
 * because "contains a quote" was the ONLY thing any compose path asked, and a
 * raw echo of the source satisfies it (eval 2026-08-02 #3).
 *
 * Framing runs before person agreement, and not by accident: an unmarked
 * splice is what let a first-person fragment pass as the agent's own words
 * (040). Reject the shape and the person question does not arise.
 */
function checkAfterQuote(question: string, fragment: string): Rejection | null {
 if (!quotesFragmentSetOff(question, fragment)) return 'unframed-quote';
 if (!isInterrogative(question, fragment)) return 'not-interrogative';
 if (hasFirstPersonOutsideQuote(question, fragment)) return 'first-person';
 return null;
}

/** Gate for a question built around a KNOWN phrase (follow-up, juxtaposition). */
function checkAroundPhrase(
 question: string,
 phrase: string,
 turnText: string,
): Rejection | null {
 if (!question || !question.includes(phrase)) return 'no-quote';
 if (isDegenerateComposition(question, phrase, turnText)) return 'degenerate';
 return checkAfterQuote(question, phrase);
}

type QuoteResult =
 | { ok: true; fragment: string }
 | { ok: false; rejection: Rejection };

/** Gate for a question that must quote SOMEWHERE in `source` (opener, still-true, expedition). */
export function checkQuotesSource(question: string, source: string): QuoteResult {
 const longest = findQuotedFragment(source, question);
 const fragment =
  longest && quotesFragmentSetOff(question, longest)
   ? longest
   : findSetOffFragment(question, source);

 if (!fragment) {
  return { ok: false, rejection: longest ? 'unframed-quote' : 'no-quote' };
 }

 const rejection = checkAfterQuote(question, fragment);
 if (rejection) return { ok: false, rejection };
 return { ok: true, fragment };
}

/** Wrap text as a single user turn for LLM calls that need a Turn[]. */
function userTurn(text: string): Turn[] {
 return [{ role: 'user', text, at: '' }];
}

/**
 * The sitting a snippet came from, as far as the caller can establish it.
 *
 * A composed question inherits the Target of the sitting whose words it
 * quotes: an opener minted from a domain sitting's snippet is a domain
 * question, whatever it happens to be about (045). The caller passes what it
 * knows and omits what it does not — an unknown Target is left absent here,
 * never guessed, because absent serves either sitting and a wrong guess
 * silences the entry for half of them.
 */
export type SittingContext = { target?: Target; topic?: string };


/**
 * The QuestionForm a still-true re-measure should use for this snippet.
 *
 * Q-14 says still-true checks always ask differently. Q-109 makes that
 * structural: when the original snippet was elicited deliberatively
 * (avowal stance), the re-measure asks theoretically (self-observation
 * stance) for triangulation across stances.
 */
export function stillTrueForm(snippet: Snippet): QuestionForm {
 return snippet.provenance.questionForm === 'deliberative'
  ? 'theoretical'
  : snippet.provenance.questionForm;
}

/** Build a QueueDraft from a verified snippet quote. */
function buildOpenerDraft(
 snippet: Snippet,
 question: string,
 quotedFragment: string,
 source: QueueDraft['source'],
 horizon: QueueDraft['horizon'],
 sitting?: SittingContext,
 questionForm?: QuestionForm,
): QueueDraft {
 return {
  source,
  license: 'CC0',
  question,
  questionForm: questionForm ?? 'deliberative',
  cites: [`${snippet.id}@${snippet.version}`],
  quotedFragment,
  sharpness: 'weak',
  horizon,
  ...(sitting?.target ? { target: sitting.target } : {}),
  ...(sitting?.topic ? { topic: sitting.topic } : {}),
 };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * The sitting's method for P1/P2 composition (ticket 158): the protocol def's
 * interview body rides into the system prompt as the register the question
 * must be asked in. The defs are authored as multi-phase interviewer scripts,
 * so the block is explicit that this step asks exactly ONE question — never
 * the def's phase sequence, and never its [SATURATED] exit (which belongs to
 * the P3 probe, where it closes the door).
 *
 * Empty string when no protocol is given, so the legacy prompts stay
 * byte-for-byte (sounding-rung's descent path and every scripted test).
 */
function methodBlock(protocol: ProtocolDef | undefined): string {
 if (!protocol) return '';
 return `

## The sitting's method — the ${protocol.name} protocol
${protocol.prompt}

You are executing ONE step of this method, not the whole script. Ask exactly ONE question in the protocol's register, grounded in the user's words — do not run the protocol's phase sequence or its scripted questions wholesale, and do not output [SATURATED].`;
}

const RED_LIGHT_SYSTEM = `You are a clerk for Elicit. Review this user turn for "red lights" — phrases that signal the user is being abstract, vague, or disconnected from concrete experience. Return a JSON object with a "lights" array. Each light has:
- "kind": one of "odd-term", "unexplored-referent", "abstraction-no-episode", "pole-no-contrast", "cause-no-event"
- "phrase": the exact substring from the user turn that triggered the concern (verbatim, character-for-character)

Do not fabricate phrases. Every "phrase" must be an exact substring of the user turn.
Return ONLY valid JSON. No markdown fences. No commentary.`;

const VALID_KINDS = new Set([
 'odd-term',
 'unexplored-referent',
 'abstraction-no-episode',
 'pole-no-contrast',
 'cause-no-event',
]);

// ---------------------------------------------------------------------------
// redLights
// ---------------------------------------------------------------------------

export async function redLights(
 turnText: string,
 complete: Complete,
): Promise<RedLight[]> {
 const raw = await complete(RED_LIGHT_SYSTEM, userTurn(turnText), {
  temperature: 0.4,
 });
 const cleaned = stripFences(raw);

 let lights: Array<{ kind?: string; phrase?: string }>;
 try {
  const parsed = JSON.parse(cleaned);
  lights = Array.isArray(parsed.lights) ? parsed.lights : [];
 } catch {
  return [];
 }

 const valid: RedLight[] = [];
 for (const light of lights) {
  if (
   typeof light.kind !== 'string' ||
   typeof light.phrase !== 'string' ||
   !light.phrase
  )
   continue;

  // Q-12: phrase MUST be an exact substring of the turn
  if (!turnText.includes(light.phrase)) {
   warnReject(
    `Composed: dropped red-light phrase not in turn — "${light.phrase}"`,
   );
   continue;
  }

  if (!VALID_KINDS.has(light.kind)) continue;

  valid.push({
   kind: light.kind as RedLight['kind'],
   phrase: light.phrase,
  });
 }

 return valid;
}

// ---------------------------------------------------------------------------
// composeFollowUp
// ---------------------------------------------------------------------------
//
// Q-106 note: no repair guard here. The red-light phrase is an exact substring
// of the user's OWN turn (redLights enforces that before it returns a light),
// never snippet material — so there is no snippet to quarantine at this point.

export async function composeFollowUp(
 turnText: string,
 light: RedLight,
 complete: Complete,
 protocol?: ProtocolDef,
): Promise<string | null> {
 const prompt = `You are a clerk for Elicit. A user just said something that triggered a concern. Compose ONE follow-up question that quotes the flagged phrase exactly.${methodBlock(protocol)}

User turn: "${turnText}"
Concern: ${light.kind} — the phrase "${light.phrase}" triggered this.

Your question MUST contain this exact phrase, verbatim and inside quotation marks: "${light.phrase}".

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST contain this exact substring, inside quotation marks: "${light.phrase}".`;

 const send = (p: string) => complete(p, userTurn(turnText), { temperature: 0.4 });
 return composeWithRetry(
  'follow-up',
  send,
  prompt,
  (question) => {
   const rejection = checkAroundPhrase(question, light.phrase, turnText);
   return rejection
    ? { ok: false, rejection }
    : { ok: true, question, value: question };
  },
  (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
  warnReject,
 );
}

// ---------------------------------------------------------------------------
// composeJuxtaposition
// ---------------------------------------------------------------------------

export async function composeJuxtaposition(
 turnText: string,
 hit: ResonanceHit,
 complete: Complete,
 vaultRoot?: string,
 protocol?: ProtocolDef,
): Promise<string | null> {
 // Q-106: a repair on the hit's snippet quarantines the whole snippet — never
 // juxtapose against text the person disavowed. The root is optional so every
 // existing caller (and test) keeps working; without a root there is nothing
 // to consult, so nothing is excluded.
 if (vaultRoot) {
  const repairs = readAllRepairs(vaultRoot);
  if (isUnderRepair(repairs, hit.snippetId)) return null;
 }
 const prompt = `You are a clerk for Elicit. The user just said something that echoes a past snippet. Compose ONE question that juxtaposes what they just said with a shared phrase from their past.${methodBlock(protocol)}

What they just said: "${turnText}"
Past snippet: "${hit.snippetText}"
Shared phrase that appears in both: "${hit.sharedPhrase}"

Your question MUST contain this exact phrase, verbatim and inside quotation marks: "${hit.sharedPhrase}".

Ask ONE question that sets the two moments against each other and pushes PAST what they just said. Choose the sharpest move the material affords:
- name what changed between then and now, and ask what changed it;
- ask for the specific moment or scene behind one of the two statements;
- ask what the older statement would say back to the newer one;
- ask what holding both statements at once costs, or protects.
Never ask whether the two statements "relate" or "connect" — they already do; that is why you are quoting them. Never ask a question their words above already answer.

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST contain this exact substring, inside quotation marks: "${hit.sharedPhrase}".`;

 const send = (p: string) => complete(p, userTurn(turnText), { temperature: 0.4 });
 return composeWithRetry(
  'juxtaposition',
  send,
  prompt,
  (question) => {
   const rejection = checkAroundPhrase(question, hit.sharedPhrase, turnText);
   return rejection
    ? { ok: false, rejection }
    : { ok: true, question, value: question };
  },
  (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
  warnReject,
 );
}

// ---------------------------------------------------------------------------
// composeOpener
// ---------------------------------------------------------------------------


/**
 * Summary-echo guard (Q-86): reject a composed question that shares
 * a span of minSpanWords content words with any summary line.
 * Returns the matched summary line, or null. The guard is a code
 * boundary, not a prompt instruction — agent-plane summaries may
 * INFORM composition but are never QUOTABLE material.
 */
function checkSummaryEcho(
  question: string,
  summaryLines: string[],
  minSpanWords: number,
): string | null {
  if (summaryLines.length === 0) return null;
  const qWords = contentWordSequence(question);
  if (qWords.length < minSpanWords) return null;

  for (const line of summaryLines) {
    const lineWords = contentWordSequence(line);
    if (lineWords.length < minSpanWords) continue;

    // Sliding window over the summary line's content words
    for (let i = 0; i <= lineWords.length - minSpanWords; i++) {
      const window = lineWords.slice(i, i + minSpanWords);
      // Check if this window appears in sequence in the question
      for (let qi = 0; qi <= qWords.length - minSpanWords; qi++) {
        let match = true;
        for (let j = 0; j < minSpanWords; j++) {
          if (qWords[qi + j] != window[j]) { match = false; break; }
        }
        if (match) return line;
      }
    }
  }
  return null;
}

export async function composeOpener(
 snippet: Snippet,
 complete: Complete,
 sitting?: SittingContext,
 historyBlock?: string,
 summaryLines?: string[],
): Promise<QueueDraft | null> {
 const historySection = historyBlock
  ? `\nRecent session history (agent summaries — for context, never quote these):\n${historyBlock}\n`
  : '';

 const prompt = `You are a clerk for Elicit — a quiet, reflective interview tool. Given a snippet the user wrote in a prior session, compose ONE question that returns them to that thought. Quote the snippet verbatim — your question must set off an exact phrase from the snippet inside quotation marks.

${historySection}Snippet: "${snippet.prose}"
Snippet date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from this snippet inside quotation marks: "${snippet.prose}".`;

 const send = (p: string) => complete('', [{ role: 'user', text: p, at: '' }], { temperature: 0.4 });
 return composeWithRetry(
  'opener',
  send,
  prompt,
  (question, phase) => {
   const check = checkQuotesSource(question, snippet.prose);
   if (check.ok) {
    const echoLine = summaryLines && summaryLines.length > 0
     ? checkSummaryEcho(question, summaryLines, THRESHOLDS['opener.echoGuardMinSpanWords'].value as number)
     : null;
    if (echoLine) {
     warnReject(`${phase === 'first' ? 'Composed: opener rejected' : 'Composed: opener retry also rejected'} (summary-echo) — shares span with: "${echoLine.slice(0, 80)}"`);
     return { ok: false, rejection: 'summary-echo' };
    }
    return { ok: true, question, value: buildOpenerDraft(snippet, question, check.fragment, 'composed', 'session', sitting) };
   }
   return { ok: false, rejection: check.rejection };
  },
  (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
  warnReject,
 );
}

// ---------------------------------------------------------------------------
// composeStillTrue
// ---------------------------------------------------------------------------

export async function composeStillTrue(
 snippet: Snippet,
 complete: Complete,
 sitting?: SittingContext,
 log?: ThresholdLogFn,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit. Given an old snippet the user wrote, compose ONE question asking whether it still holds true. Quote the snippet verbatim — your question must set off an exact phrase from it inside quotation marks. DO NOT repeat or echo the original question that elicited the snippet.

Snippet: "${snippet.prose}"
Original question (do NOT repeat this): "${snippet.provenance.question}"
Snippet date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from this snippet inside quotation marks: "${snippet.prose}", and MUST NOT repeat the original question: "${snippet.provenance.question}".`;

 // Compute the triangulation form, gated by shadow-first (Q-35). No log fn
 // means no shadow record — and a shadow decision that leaves no record may
 // not act (the Q-56 inversion: a live mechanism claiming shadow), so the
 // no-log path keeps the unchanged form.
 const ideal = stillTrueForm(snippet);
 const form = log
  ? (shadowDecision(THRESHOLDS['stillTrue.formSelection'], `use form=${ideal} instead of deliberative for still-true on snippet ${snippet.id}`, log) ? ideal : 'deliberative')
  : 'deliberative';

 const send = (p: string) => complete('', [{ role: 'user', text: p, at: '' }], { temperature: 0.4 });
 return composeWithRetry(
  'still-true',
  send,
  prompt,
  (question) => {
   const attempt = tryBuildStillTrue(snippet, question, sitting, form);
   return attempt.ok
    ? { ok: true, question, value: attempt.draft }
    : { ok: false, rejection: attempt.rejection };
  },
  (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
  warnReject,
 );
}

type StillTrueResult =
 | { ok: true; draft: QueueDraft }
 | { ok: false; rejection: Rejection };

/** Validate and build a still-true draft, or name why it was refused. */
function tryBuildStillTrue(
 snippet: Snippet,
 question: string,
 sitting?: SittingContext,
 questionForm?: QuestionForm,
): StillTrueResult {
 if (
  question.length === 0 ||
  // An imported snippet's provenance.question is '' (nothing asked for these
  // words), and `question.includes('')` is vacuously true — without the
  // length guard, every imported snippet would be rejected here and the
  // still-true licence could never serve the material Seeding exists to
  // date (seeding Finding 2's whole point). An empty original cannot be
  // repeated; only a non-empty one can.
  (snippet.provenance.question.length > 0 &&
   (question === snippet.provenance.question ||
    question.includes(snippet.provenance.question)))
 ) {
  return { ok: false, rejection: 'repeats-original' };
 }

 const check = checkQuotesSource(question, snippet.prose);
 if (!check.ok) return { ok: false, rejection: check.rejection };

 return {
  ok: true,
  draft: buildOpenerDraft(
   snippet,
   question,
   check.fragment,
   'still-true',
   'session',
   sitting,
   questionForm,
  ),
 };
}

// ---------------------------------------------------------------------------
// composeExpedition
// ---------------------------------------------------------------------------

/**
 * Pure license function: is this snippet a candidate for an Expedition?
 *
 * A snippet is eligible when its region is well-cited but shallow —
 * the wiki knows it matters but cannot deepen it from self-report alone.
 * Heuristic (025):
 * - Snippet reading facet is 'fact' or 'construct'
 * - Cited by ≥2 queue-asked questions
 * - The veto is per-candidate: the facet/construct gate already excludes
 *   episode readings (ticket 140); `allSnippets` is kept for API
 *   compatibility with existing callers
 */
export function isExpeditionCandidate(
 snippet: Snippet,
 readings: Record<string, Reading>,
 queueEntries: QueueEntry[],
 allSnippets: Snippet[],
): boolean {
 const citeStr = `${snippet.id}@${snippet.version}`;

 // Facet gate: at least one reading must have facet 'fact' | 'construct'
 const snippetReadings = Object.values(readings).filter((r) =>
  (r.cites ?? []).includes(citeStr),
 );
 const hasTargetFacet = snippetReadings.some(
  (r) => r.facet === 'fact' || r.facet === 'construct',
 );
 if (!hasTargetFacet) return false;

 // Cited by ≥2 queue entries (any status, not only asked — measured
 // 2026-08-05 across six archive vaults: 199 queue entries, 1 asked;
 // 12 snippets hold ≥2 total citations, and the JOINT gate — ≥2
 // citations AND a fact/construct reading — yields 6 candidates across
 // 589 cited snippets, 1.0 per 100. Requiring `asked` status on both
 // made the gate mathematically unopenable: 0 candidates in the whole
 // corpus. The facet gate above (fact | construct reading) is the
 // quality filter; citation count across all queue states measures
 // breadth of interest.
 const citedCount = queueEntries.filter(
  (e) => (e.cites ?? []).includes(citeStr),
 ).length;
 if (citedCount < 2) return false;

 return true;
}

/**
 * Compose an expedition question for a licensed snippet.
 *
 * The question has two parts:
 * 1. A send-out — ask the user to go read, research, or observe
 * 2. The reflection ask — "what surprised you, and what does it change?"
 *
 * Only the reflective turn is person-bearing (CONTEXT.md: Expedition).
 * Q-12 enforced: the question MUST contain a verbatim quote of the snippet.
 * Horizon: 'days'. Prompt uses user-role messages only (llama.cpp compat).
 */
export async function composeExpedition(
 snippet: Snippet,
 complete: Complete,
 sitting?: SittingContext,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit. Given a snippet the user wrote, compose a question that sends them out to investigate — read, research, observe — then return to reflect.

Your question must have two parts: (1) a send-out — ask them to go learn something specific this snippet touches but does not answer, and (2) the reflection ask — "What surprised you, and what does it change?"

It must also set off an exact phrase from the snippet inside quotation marks.

Snippet: "${snippet.prose}"
Snippet date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from this snippet inside quotation marks: "${snippet.prose}".`;

 const send = (p: string) => complete('', [{ role: 'user', text: p, at: '' }], { temperature: 0.4 });
 return composeWithRetry(
  'expedition',
  send,
  prompt,
  (question) => {
   const check = checkQuotesSource(question, snippet.prose);
   if (!check.ok) return { ok: false, rejection: check.rejection };
   return { ok: true, question, value: buildOpenerDraft(snippet, question, check.fragment, 'composed', 'days', sitting) };
  },
  (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
  warnReject,
 );
}

// ---------------------------------------------------------------------------
// composeOtherMindsExpedition (ticket 113)
// ---------------------------------------------------------------------------

/**
 * License function: is this snippet a candidate for an other-minds expedition?
 *
 * A snippet is eligible when it names someone the person knows (gazetteer
 * person entity with ≥1 mention), and has the same expedition eligibility
 * facet gates (isExpeditionCandidate).
 */
export function isOtherMindsCandidate(
 snippet: Snippet,
 readings: Record<string, Reading>,
 queueEntries: QueueEntry[],
 allSnippets: Snippet[],
 gazetteerStore: { byMentionCount(threshold: number): { name: string; kind: string }[] },
): { eligible: boolean; person?: string } {
 // Must pass regular expedition candidate check first
 if (!isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)) {
  return { eligible: false };
 }
 // Must have at least one person in the gazetteer with ≥1 mention
 const people = gazetteerStore.byMentionCount(1).filter(p => p.kind === 'person');
 if (people.length === 0) return { eligible: false };
 // Return the first person found (the most-mentioned one)
 return { eligible: true, person: people[0]!.name };
}

/**
 * Compose an other-minds expedition question.
 *
 * Same structure as composeExpedition but the errand names a specific person
 * to ask. The question still has two parts: (1) send-out naming the person,
 * (2) reflection ask. Q-12 enforced. Horizon: 'days'.
 */
export async function composeOtherMindsExpedition(
 snippet: Snippet,
 personName: string,
 complete: Complete,
 sitting?: SittingContext,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit. Given a snippet the user wrote and a person they know, compose a question that sends them to ask that person something — then return to reflect.

Your question must have two parts: (1) a send-out naming the person — ask them to go ask ${personName} something specific, and (2) the reflection ask — "What surprised you, and what does it change?"

It must also set off an exact phrase from the snippet inside quotation marks.

Snippet: "${snippet.prose}"
Snippet date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from this snippet inside quotation marks: "${snippet.prose}".`;

 const send = (p: string) => complete('', [{ role: 'user', text: p, at: '' }], { temperature: 0.4 });
 return composeWithRetry(
  'other-minds expedition',
  send,
  prompt,
  (question) => {
   const check = checkQuotesSource(question, snippet.prose);
   if (!check.ok) return { ok: false, rejection: check.rejection };
   const draft = buildOpenerDraft(snippet, question, check.fragment, 'composed', 'days', sitting);
   draft.errandKind = 'other-minds';
   draft.errandPerson = personName;
   return { ok: true, question, value: draft };
  },
  (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
  warnReject,
 );
}

// ---------------------------------------------------------------------------
// composeDiscriminatingQuestion (ticket 060)
// ---------------------------------------------------------------------------

type DiscriminatingResult =
 | { ok: true; draft: QueueDraft }
 | { ok: false; rejection: Rejection };

/**
 * Validate and build a discriminating draft, or name why it was refused.
 *
 * BOTH passages must be quoted (Q-40): a question that quotes one and splices
 * the other hands the boundary half its evidence, so a missing or unframed
 * quote in either passage is the same refusal it would be alone.
 */
function tryBuildDiscriminating(
 claims: { a: Claim; b: Claim },
 prose: { a: string; b: string },
 question: string,
): DiscriminatingResult {
 const checkA = checkQuotesSource(question, prose.a);
 if (!checkA.ok) return { ok: false, rejection: checkA.rejection };
 const checkB = checkQuotesSource(question, prose.b);
 if (!checkB.ok) return { ok: false, rejection: checkB.rejection };

 return {
  ok: true,
  draft: {
   source: 'lint-undiscriminated-range',
   license: 'CC0',
   question,
   questionForm: 'deliberative',
   cites: [
    ...claims.a.cites,
    ...claims.b.cites.filter((c) => !claims.a.cites.includes(c)),
   ],
   quotedFragment: checkA.fragment,
   sharpness: 'weak',
   horizon: 'session',
  },
 };
}

/**
 * Compose the ONE question an `undiscriminated-range` finding may mint
 * (Q-31): an invitation to draw the boundary between two claims that share a
 * referent and a Range.
 *
 * Q-12, Q-15 and Q-40 in one shape: both passages quoted verbatim, each set
 * off in its own quotation marks, and the ask framed as "where does the first
 * hold, where the second, what tells them apart" — an invitation to draw a
 * distinction, never an accusation. `checkQuotesSource` on EACH passage
 * enforces the quoting, and `checkAfterQuote` inside it the interrogative and
 * the voice (no first person outside the quotes).
 */
export async function composeDiscriminatingQuestion(
 claims: { a: Claim; b: Claim },
 prose: { a: string; b: string },
 complete: Complete,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit. The speaker wrote two passages, at different times, describing the same situation under the same stated conditions. Compose ONE question that invites them to draw the boundary between the two.

Passage 1: "${prose.a}"
Passage 2: "${prose.b}"

Your question must set off an exact phrase from passage 1 inside its own quotation marks AND an exact phrase from passage 2 inside its own quotation marks — two quotes, never one. Ask where the first holds and where the second holds: what tells them apart?
Both passages are true somewhere; the boundary is the question, not a contradiction. Never suggest the speaker is inconsistent or contradicts themselves.

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from passage 1 inside quotation marks AND an exact phrase from passage 2 inside its own quotation marks: passage 1 "${prose.a}", passage 2 "${prose.b}".`;

 const send = (p: string) => complete('', [{ role: 'user', text: p, at: '' }], { temperature: 0.4 });
 return composeWithRetry(
  'discriminating',
  send,
  prompt,
  (question) => {
   const attempt = tryBuildDiscriminating(claims, prose, question);
   return attempt.ok
    ? { ok: true, question, value: attempt.draft }
    : { ok: false, rejection: attempt.rejection };
  },
  (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
  warnReject,
 );
}

// ---------------------------------------------------------------------------
// composeNarrowedRanges (ticket 060)
// ---------------------------------------------------------------------------

/**
 * Turn an answered discriminating question into the two narrowed Ranges.
 *
 * Receives NO graph by design — the caller passes everything this needs: the
 * two claims (body + current Range), the verbatim passages behind them, and
 * the answer readings' text and cites. The boundary is named in the claims'
 * own vocabulary.
 *
 * The output must differ from the status quo in both directions: a range that
 * still says what both claims said has drawn no boundary, and two ranges that
 * collapse into one have drawn the wrong one.
 */
export async function composeNarrowedRanges(
 claims: { a: Claim; b: Claim },
 prose: { a: string; b: string },
 answers: Reading[],
 complete: Complete,
): Promise<{ a: string; b: string } | null> {
 const answersBlock = answers
  .map((r, i) => {
   const cites = r.cites ?? [];
   const cited = cites.length > 0 ? ` (cites: ${cites.join(', ')})` : '';
   return `Answer ${i + 1}: "${r.reading}"${cited}`;
  })
  .join('\n');

 const prompt = `You are a clerk for Elicit. A question asked the speaker where two of their descriptions each hold. From their answers, name the narrowed context where the first claim holds and where the second holds.

Claim 1: "${claims.a.body}" — currently held "in ${claims.a.range}"
Passage 1: "${prose.a}"
Claim 2: "${claims.b.body}" — currently held "in ${claims.b.range}"
Passage 2: "${prose.b}"

The speaker's answers:
${answersBlock}

Return ONLY a JSON object: {"rangeA": "<the narrowed context where claim 1 holds>", "rangeB": "<the narrowed context where claim 2 holds>"}. No markdown, no commentary.`;

 const attempt = (raw: string): { a: string; b: string } | null => {
  let parsed: unknown;
  try {
   parsed = JSON.parse(stripFences(raw));
  } catch {
   return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  const rangeA = typeof rec['rangeA'] === 'string' ? rec['rangeA'].trim() : '';
  const rangeB = typeof rec['rangeB'] === 'string' ? rec['rangeB'].trim() : '';
  if (rangeA === '' || rangeB === '') return null;
  if (rangeA === rangeB) return null;
  if (rangeA === claims.a.range || rangeB === claims.b.range) return null;
  return { a: rangeA, b: rangeB };
 };

 // Attempt 1
 const raw = await complete('', [{ role: 'user', text: prompt, at: '' }], { temperature: 0.4 });
 const first = attempt(raw);
 if (first) return first;

 // One retry
 const retryPrompt = `${prompt}\n\nCRITICAL: Your previous response was rejected. Return ONLY a JSON object of the form {"rangeA": "...", "rangeB": "..."} where rangeA is the narrowed context where claim 1 holds and rangeB where claim 2 holds. Both must be non-empty, different from each other, and different from the claims' current ranges.`;
 const retryRaw = await complete('', [{ role: 'user', text: retryPrompt, at: '' }], { temperature: 0.4 });
 const second = attempt(retryRaw);
 if (second) return second;

 warnReject('Composed: narrowed-ranges retry also rejected — returning null');
 return null;
}

// ---------------------------------------------------------------------------
// composeOutcomeQuestion (ticket 106)
// ---------------------------------------------------------------------------

/**
 * Compose an outcome question for a past-horizon intention. Like composeStillTrue
 * but asks whether the intention came to pass, not whether it still holds.
 * Validated through the same verbatim-quote guards (Q-12).
 *
 * @param snippet The intention snippet, already annotated with a past horizon.
 * @param horizon The recorded horizon (now|session|days — all past by the time
 *   this is called; the caller has already filtered).
 */
export async function composeOutcomeQuestion(
  snippet: Snippet,
  horizon: 'now' | 'session' | 'days',
  complete: Complete,
  sitting?: SittingContext,
): Promise<QueueDraft | null> {
  const horizonPhrase = horizon === 'now' ? 'the present moment'
    : horizon === 'session' ? 'this session'
    : 'the coming days';

  const prompt = `You are a clerk for Elicit. Given an intention the user wrote, compose ONE question asking whether it came to pass. The intention's timeline was "${horizonPhrase}" — enough time has passed to check. Quote the intention verbatim — your question must set off an exact phrase from it inside quotation marks.

Intention: "${snippet.prose}"
Original question that elicited it (do NOT repeat this): "${snippet.provenance.question}"
Intention date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

  const quoteRule = `Your question MUST set off an exact phrase from this intention inside quotation marks: "${snippet.prose}", and MUST NOT repeat the original question: "${snippet.provenance.question}".`;

  const send = (p: string) => complete('', [{ role: 'user', text: p, at: '' }], { temperature: 0.4 });
  return composeWithRetry(
    'outcome question',
    send,
    prompt,
    (question) => {
      const attempt = tryBuildOutcome(snippet, question, horizon, sitting);
      return attempt.ok
        ? { ok: true, question, value: attempt.draft }
        : { ok: false, rejection: attempt.rejection };
    },
    (rejection) => `${prompt}\n\n${corrective(rejection, quoteRule)}`,
    warnReject,
  );
}

type OutcomeResult =
  | { ok: true; draft: QueueDraft }
  | { ok: false; rejection: Rejection };

/** Validate and build an outcome-question draft, or name why it was refused. */
function tryBuildOutcome(
  snippet: Snippet,
  question: string,
  horizon: 'now' | 'session' | 'days',
  sitting?: SittingContext,
): OutcomeResult {
  if (
    question.length === 0 ||
    (snippet.provenance.question.length > 0 &&
      (question === snippet.provenance.question ||
        question.includes(snippet.provenance.question)))
  ) {
    return { ok: false, rejection: 'repeats-original' };
  }

  const check = checkQuotesSource(question, snippet.prose);
  if (!check.ok) return { ok: false, rejection: check.rejection };

  // Outcome questions use agent-horizon deduction: the horizon was read
  // from the prose, so the question's horizon is relative to that reading.
  const outcomeHorizon: QueueDraft['horizon'] = horizon === 'now' ? 'session' : 'days';

  return {
    ok: true,
    draft: {
      source: 'outcome',
      license: 'CC0',
      question,
      questionForm: 'deliberative' as QuestionForm,
      cites: [`${snippet.id}@${snippet.version}`],
      quotedFragment: check.fragment,
      sharpness: 'weak',
      horizon: outcomeHorizon,
      ...(sitting?.target ? { target: sitting.target } : {}),
      ...(sitting?.topic ? { topic: sitting.topic } : {}),
    },
  };
}
