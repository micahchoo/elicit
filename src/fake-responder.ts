import type { Complete } from './types.js';

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
 */
export function makeFakeComplete(): Complete {
 const probes = [
  'Tell me more about that.',
  'What else comes to mind?',
  'How does that feel, specifically?',
  'Can you give me a concrete example?',
  'What happens when you sit with that?',
 ];
 let probeIdx = 0;

 return async (system: string, _turns, _opts?): Promise<string> => {
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
}
