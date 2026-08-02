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
 const calls: FakeCall[] = [];

 const respond = async (system: string, turns: Turn[], opts?: { temperature?: number }): Promise<string> => {
  calls.push({ system, turns, ...(opts !== undefined ? { opts } : {}) });
  const s = system.toLowerCase();

  if (s.includes('red light')) {
   return '{"lights": []}';
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
