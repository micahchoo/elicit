import type { SoundingEnd } from '../src/types.ts';

/**
 * The wire words for provenance this screen shows, mapped to the one quiet
 * word each earns. Pure seams so the tests can hold them (the same rule as
 * src/queue/source-label.ts): a value the server sends and a word a person
 * reads can never drift apart.
 */

/** SessionResponse.source (Q-18): present when the Randomizer dealt the opener. */
export type OpenerSource = 'deck' | 'resurfacing';

/** HarvestQueueEntry.origin — the wire union (src/server.ts enqueue sites). */
export type HarvestOrigin = 'harvest' | 'unprompted';

/** The one muted margin word the opener carries when it was dealt. */
export function sourceWord(source: OpenerSource): string {
 switch (source) {
  case 'resurfacing': return 'dealt \u2014 from your older self';
  case 'deck': return 'dealt \u2014 from a deck';
 }
}

/** The origin word an inbox row carries: what produced the harvest. */
export function originWord(origin: HarvestOrigin): string {
 switch (origin) {
  case 'harvest': return 'sitting';
  case 'unprompted': return 'free writing';
 }
}

/** How a descent that closed without a gate press ended (012 T9). */
export function descentCloseWord(ended: SoundingEnd): string {
 switch (ended) {
  case 'cap': return 'going deeper ended \u2014 it reached its limit';
  case 'convergence': return 'going deeper ended \u2014 the thread came together';
  case 'composition-failed': return 'going deeper ended \u2014 the next question could not be written';
  case 'park': return 'going deeper ended \u2014 your place is held';
  case 'another-day': return 'going deeper ended \u2014 the rest waits for another day';
 }
}
