import type {
 Complete,
 Turn,
 RedLight,
 ResonanceHit,
 Snippet,
 QueueDraft,
 QuestionForm,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strips markdown code fences from LLM output, keeping the inner content. */
function stripFences(raw: string): string {
 let s = raw.trim();
 s = s.replace(/^```(?:json)?\s*\n?/i, '');
 s = s.replace(/\n?```\s*$/, '');
 return s.trim();
}

/**
 * Find the longest substring of `source` that appears verbatim in `question`.
 * Returns null if no match of at least `minWords` content words is found.
 * Mirrors the harvester's substring validation posture (Q-1 → Q-12).
 */
function findQuotedFragment(
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

/** Wrap text as a single user turn for LLM calls that need a Turn[]. */
function userTurn(text: string): Turn[] {
 return [{ role: 'user', text, at: '' }];
}

/** Build a QueueDraft from a verified snippet quote. */
function buildOpenerDraft(
 snippet: Snippet,
 question: string,
 quotedFragment: string,
 source: QueueDraft['source'],
 horizon: QueueDraft['horizon'],
): QueueDraft {
 return {
  source,
  license: 'CC0',
  question,
  questionForm: 'deliberative' as QuestionForm,
  cites: [`${snippet.id}@${snippet.version}`],
  quotedFragment,
  sharpness: 'weak',
  horizon,
 };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

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
   console.warn(
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

export async function composeFollowUp(
 turnText: string,
 light: RedLight,
 complete: Complete,
): Promise<string | null> {
 const prompt = `You are a clerk for Elicit. A user just said something that triggered a concern. Compose ONE follow-up question that quotes the flagged phrase exactly.

User turn: "${turnText}"
Concern: ${light.kind} — the phrase "${light.phrase}" triggered this.

Your question MUST contain the exact phrase "${light.phrase}" verbatim.
Return only the question text. No markdown, no commentary.`;

 const raw = await complete(prompt, userTurn(turnText), {
  temperature: 0.4,
 });
 let question = stripFences(raw).trim();

 // Q-12: substring verification
 if (question && question.includes(light.phrase)) return question;

 // One retry with corrective prompt
 console.warn(
  `Composed: follow-up missing phrase "${light.phrase}", retrying`,
 );
 const retryPrompt = `${prompt}\n\nCRITICAL: Your previous response was rejected because it did not include the exact phrase "${light.phrase}". Your question MUST contain this exact substring: "${light.phrase}".`;
 const retryRaw = await complete(retryPrompt, userTurn(turnText), {
  temperature: 0.4,
 });
 question = stripFences(retryRaw).trim();

 if (question && question.includes(light.phrase)) return question;

 console.warn(
  `Composed: follow-up retry also missing phrase "${light.phrase}" — returning null`,
 );
 return null;
}

// ---------------------------------------------------------------------------
// composeJuxtaposition
// ---------------------------------------------------------------------------

export async function composeJuxtaposition(
 turnText: string,
 hit: ResonanceHit,
 complete: Complete,
): Promise<string | null> {
 const prompt = `You are a clerk for Elicit. The user just said something that echoes a past snippet. Compose ONE question that juxtaposes what they just said with a shared phrase from their past.

What they just said: "${turnText}"
Past snippet: "${hit.snippetText}"
Shared phrase that appears in both: "${hit.sharedPhrase}"

Your question MUST contain the exact phrase "${hit.sharedPhrase}" verbatim.
Frame the question as connecting their present thought to their past one.
Return only the question text. No markdown, no commentary.`;

 const raw = await complete(prompt, userTurn(turnText), {
  temperature: 0.4,
 });
 const question = stripFences(raw).trim();

 // Q-12: substring verification
 if (question && question.includes(hit.sharedPhrase)) return question;

 // One retry
 console.warn(
  `Composed: juxtaposition missing sharedPhrase "${hit.sharedPhrase}", retrying`,
 );
 const retryPrompt = `${prompt}\n\nCRITICAL: Your previous response was rejected because it did not include the exact phrase "${hit.sharedPhrase}". Your question MUST contain this exact substring: "${hit.sharedPhrase}".`;
 const retryRaw = await complete(retryPrompt, userTurn(turnText), {
  temperature: 0.4,
 });
 const retryQuestion = stripFences(retryRaw).trim();

 if (retryQuestion && retryQuestion.includes(hit.sharedPhrase))
  return retryQuestion;

 console.warn(
  `Composed: juxtaposition retry also missing sharedPhrase "${hit.sharedPhrase}" — returning null`,
 );
 return null;
}

// ---------------------------------------------------------------------------
// composeOpener
// ---------------------------------------------------------------------------

export async function composeOpener(
 snippet: Snippet,
 complete: Complete,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit — a quiet, reflective interview tool. Given a snippet the user wrote in a prior session, compose ONE question that returns them to that thought. Quote the snippet verbatim — your question must contain an exact phrase from the snippet.

Snippet: "${snippet.prose}"
Snippet date: ${snippet.captured}

Return only the question text. No markdown, no commentary.`;

 const raw = await complete(prompt, [], { temperature: 0.4 });
 let question = stripFences(raw).trim();

 let fragment = findQuotedFragment(snippet.prose, question);

 if (fragment) {
  return buildOpenerDraft(snippet, question, fragment, 'composed', 'session');
 }

 // One retry
 console.warn('Composed: opener quotes no snippet fragment, retrying');
 const retryPrompt = `${prompt}\n\nCRITICAL: Your previous response was rejected because it did not quote the snippet verbatim. Your question MUST contain an exact phrase from this snippet: "${snippet.prose}".`;
 const retryRaw = await complete(retryPrompt, [], { temperature: 0.4 });
 question = stripFences(retryRaw).trim();
 fragment = findQuotedFragment(snippet.prose, question);

 if (fragment) {
  return buildOpenerDraft(snippet, question, fragment, 'composed', 'session');
 }

 console.warn(
  'Composed: opener retry also missing snippet quote — returning null',
 );
 return null;
}

// ---------------------------------------------------------------------------
// composeStillTrue
// ---------------------------------------------------------------------------

export async function composeStillTrue(
 snippet: Snippet,
 complete: Complete,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit. Given an old snippet the user wrote, compose ONE question asking whether it still holds true. Quote the snippet verbatim — your question must contain an exact phrase from it. DO NOT repeat or echo the original question that elicited the snippet.

Snippet: "${snippet.prose}"
Original question (do NOT repeat this): "${snippet.provenance.question}"
Snippet date: ${snippet.captured}

Return only the question text. No markdown, no commentary.`;

 // Attempt 1
 const raw = await complete(prompt, [], { temperature: 0.4 });
 const question1 = stripFences(raw).trim();
 const draft1 = tryBuildStillTrue(snippet, question1);
 if (draft1) return draft1;

 // One retry — enforce both constraints
 const retryPrompt = `${prompt}\n\nCRITICAL: Your previous response was rejected. It must satisfy TWO rules:\n1. Quote the snippet verbatim — include an exact phrase from: "${snippet.prose}"\n2. Do NOT repeat the original question: "${snippet.provenance.question}"`;
 const retryRaw = await complete(retryPrompt, [], { temperature: 0.4 });
 const question2 = stripFences(retryRaw).trim();
 const draft2 = tryBuildStillTrue(snippet, question2);
 if (draft2) return draft2;

 console.warn(
  'Composed: still-true retry failed — returning null',
 );
 return null;
}

/** Validate and build a still-true draft, or return null with a warning. */
function tryBuildStillTrue(
 snippet: Snippet,
 question: string,
): QueueDraft | null {
 if (
  question.length === 0 ||
  question === snippet.provenance.question ||
  question.includes(snippet.provenance.question)
 ) {
  console.warn(
   'Composed: still-true repeated provenance.question',
  );
  return null;
 }

 const fragment = findQuotedFragment(snippet.prose, question);
 if (!fragment) {
  console.warn(
   'Composed: still-true quotes no snippet fragment',
  );
  return null;
 }

 return buildOpenerDraft(snippet, question, fragment, 'still-true', 'session');
}
