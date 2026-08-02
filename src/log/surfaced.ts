/**
 * The surfaced usage stamp (015) — codex lesson 6's schema, logged now.
 *
 * One line per surfacing act: whenever a claim or snippet reaches the
 * person — drawn by the randomizer, cited on a reading surface they
 * opened, quoted in a composed question that was served — the artifact
 * ids go in `refs` and the surface goes in the detail. The aggregation
 * this feeds (usage_count, last_usage) is the ticket's data-bound
 * remainder and lives nowhere in this module: stamps are Activity-Log
 * lines only, exactly like the draw record they sit beside.
 */
import { appendEvent, type ActivityEvent } from './activity.js';

/** The three surfaces that count as surfacing a claim or snippet. */
export type SurfacedSurface = 'draw' | 'wiki' | 'composed-question';

/** Who surfaces: the elicitor serves a sitting, the system serves a page. */
const ACTOR: Record<SurfacedSurface, ActivityEvent['actor']> = {
 draw: 'elicitor',
 'composed-question': 'elicitor',
 wiki: 'system',
};

/**
 * Append one surfaced stamp. `refs` carries the artifact ids the act
 * surfaced, verbatim as the emitter knows them — a bare snippet id from a
 * resurfacing draw, a claim id and its `snippetId@version` citations from
 * the wiki, the citations a composed question quotes.
 */
export function surfaced(root: string, refs: string[], surface: SurfacedSurface): void {
 appendEvent(root, {
  at: new Date().toISOString(),
  actor: ACTOR[surface],
  kind: 'surfaced',
  detail: `surface=${surface}`,
  ...(refs.length > 0 ? { refs } : {}),
 });
}
