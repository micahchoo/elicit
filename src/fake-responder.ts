import type { Complete, Turn } from './types.js';

/** One call the fake answered, exactly as it was sent — wiremock-style log. */
export interface FakeCall {
 system: string;
 turns: Turn[];
 opts?: { temperature?: number };
}

/** A fake Complete that also logs every call for tests to assert on. */
export type RecordingFakeComplete = Complete & { calls: FakeCall[] };

/**
 * Inexhaustible fake Complete for dev/demo mode.
 *
 * Uses prompt-content heuristics to return shaped responses per call-site:
 * - Red-light detection → empty lights array
 * - Harvest proposal → empty cuts array
 * - Clerk compose (opener/still-true) → a reflective question
 * - Everything else → cycling probe
 *
 * Never exhausts. `ScriptedComplete` in tests/fakes.ts remains the
 * deterministic, exhaustible variant for tests.
 *
 * The returned function also carries a `calls` log (ticket 078): tests can
 * assert on what was SENT to the model — the prompt, the turns, the opts —
 * not only on what came back. The 044-acceptance class of bug (a harvest
 * running on the elicitor's model while the banner said the clerk's) is a
 * what-was-sent bug; this makes it assertable.
 */
export function makeFakeComplete(): RecordingFakeComplete {
 const probes = [
  'Tell me more about that.',
  'What else comes to mind?',
  'How does that feel, specifically?',
  'Can you give me a concrete example?',
  'What happens when you sit with that?',
 ];
 let probeIdx = 0;
let followUpIdx = 0;
const composedCount = new Map<string, number>();
 const calls: FakeCall[] = [];

 const respond = async (system: string, turns: Turn[], opts?: { temperature?: number }): Promise<string> => {
  calls.push({ system, turns, ...(opts !== undefined ? { opts } : {}) });
  const s = system.toLowerCase();

  if (s.includes('red light')) {
   // The Soundings descent runs on this responder (plan T9 step 6): a rung
   // needs a red light whose phrase is a verbatim substring of the turn, or
   // composeRung can never build rung 0. The phrase is the WHOLE answer: it
   // is trivially a substring, and the near-duplicate guard (word-set
   // Jaccard >= 0.5 against every prior question) then measures mostly the
   // answer's own words — a short fixed phrase like the first three words
   // repeats its frame and closes the descent as convergence within two
   // rungs on a shared-thread sitting. An empty turn gets no lights (the
   // content-free pivot never reaches redLights with one, but stay honest).
   const text = (turns.at(-1)?.text ?? '').trim();
   if (!text) return '{"lights": []}';
   // Quote the WHOLE answer: the phrase then dominates the question's word
   // set, which is what keeps the near-duplicate guard (Jaccard >= 0.5)
   // from firing when a frame repeats on a shared-thread sitting. One
   // exception: the licensing turn and the accept that follows it compose
   // from the SAME text, and two questions quoting all of it are
   // near-duplicates however their frames differ — a real composer picks a
   // different foothold the second time, so this one quotes the last half.
   const seen = (composedCount.get(text) ?? 0) + 1;
   composedCount.set(text, seen);
   const words = text.split(/\s+/);
   const phrase =
    seen === 1 ? text : words.slice(Math.floor(words.length / 2)).join(' ') || text;
   return JSON.stringify({ lights: [{ kind: 'unexplored-referent', phrase }] });
  }

  // composeFollowUp (the rung composer's second call): the prompt names the
  // required phrase; quote it back inside quotation marks so checkAroundPhrase
  // passes on the first try, and ask a question around it (Q-12).
  if (s.includes('triggered a concern') && s.includes('inside quotation marks')) {
   // Extract from `system`, not `s`: the prompt's phrase is interpolated
   // verbatim (Q-12), and `s` is lowercased for matching — a lowercase
   // capture would fail checkAroundPhrase's case-sensitive includes().
   const m = /inside quotation marks: "([^"]+)"/.exec(system);
   const phrase = m?.[1] ?? '';
   if (!phrase) return 'What did you mean by that?';
   // Vary the frame: a real composer does not repeat one syntactic shape,
   // and the near-duplicate guard rejects a uniform one — a descent of
   // eight 'What did you mean by "…"?' rungs would close itself as
   // convergence after the second rung. Every frame quotes the phrase
   // verbatim inside quotation marks and asks in the second person.
   // Eight frames, all second person (the first-person guard rejects
   // anything outside the quotes that says I/my/me), each adding its own
   // words so two frames share at most a few — the phrase carries the
   // question's identity, and the scaffold must not push two questions of
   // the same thread over the near-duplicate Jaccard.
   const frames = [
    (p: string) => `You said "${p}" — what did that mean for you then?`,
    (p: string) => `Hearing "${p}", what comes up for you?`,
    (p: string) => `How does "${p}" sit with you now?`,
    (p: string) => `What is underneath "${p}" for you?`,
    (p: string) => `When did "${p}" first appear?`,
    (p: string) => `What would "${p}" want to say to you?`,
    (p: string) => `Where does "${p}" live in your days?`,
    (p: string) => `What does "${p}" ask of you?`,
   ];
   return frames[followUpIdx++ % frames.length]!(phrase);
  }

  if (s.includes('harvesting agent')) {
   return '{"cuts": []}';
  }

  // Clerk compose: composeOpener / composeStillTrue
  if (s.includes('clerk for elicit')) {
   return 'Reflecting on what you wrote, what still feels true today?';
  }

  // Consolidation prompt
  if (s.includes('summarize the following sessions')) {
   return 'ongoing reflection on values and direction';
  }

  // Generic probe — cycle
  return probes[probeIdx++ % probes.length]!;
 };

 return Object.assign(respond, { calls });
}
