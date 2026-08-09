/**
 * Gazetteer frontier detection — ticket 100.
 *
 * Reads the gazetteer entity index against the queue's `subjects` field
 * and finds entities that are mentioned often but never asked about.
 * "Mentioned often, never asked about" is the frontier: the resonance
 * machinery pointed at absence instead of echo, shuffle-never-invent
 * compliant because every entity is the person's own noun.
 *
 * ZERO-LLM: this module never references or receives a model call.
 * Every question is a template around the entity name.
 *
 * Shipping rules (Q-35 as narrowed by Q-56/Q-62):
 *   - `shadowMode: true` — run the full computation, log what WOULD have
 *     been minted, but add nothing to the queue. The shadow record earns
 *     the right to act.
 *   - `shadowMode: false` — live: mint frontier questions into the queue.
 *   - Caps are live from day one (Q-56) — the `mintCap` bounds actual
 *     mints even in live mode.
 *
 * One question per entity, ever, deduped by entity id on the queue entry's
 * `subjects` field. A question already queued for an entity is not minted
 * again regardless of status.
 */

import type { QueueStore, QueueDraft } from '../types.js';
import type { GazetteerStore } from './gazetteer-store.js';

/** The docket log sink, narrowed to what the sweep emits. */
export type GazetteerFrontierLog = (e: {
  at: string;
  actor: string;
  kind: string;
  detail: string;
}) => void;

/** How many frontier questions one run may mint (Q-56 bound, live). */
const GAZETTEER_FRONTIER_CAP = 2;

/** Entities mentioned fewer times than this are never frontier candidates. */
const DEFAULT_MENTION_THRESHOLD = 3;

/**
 * The gazetteer frontier sweep. Called by the docket.
 *
 * In shadow mode, the full computation runs but nothing is added to the
 * queue — every frontier entity is logged instead. In live mode, at most
 * `mintCap` questions are added and the rest are logged as un-minted.
 */
export function runGazetteerFrontier(deps: {
  store: GazetteerStore;
  queue: QueueStore;
  log: GazetteerFrontierLog;
  now: string;
  /** Entities with at least this many mentions are frontier candidates. */
  mentionThreshold?: number;
  /** Maximum frontier questions to mint in one run (live mode). */
  mintCap?: number;
  /** When true, log only — add nothing to the queue. */
  shadowMode?: boolean;
}): { minted: number; frontierEntities: number } {
  const threshold = deps.mentionThreshold ?? DEFAULT_MENTION_THRESHOLD;
  const cap = deps.mintCap ?? GAZETTEER_FRONTIER_CAP;
  const shadowMode = deps.shadowMode ?? true; // default: shadow-first (Q-35)

  // Build the set of entity ids already asked about — from the queue's
  // `subjects` field, every entry that carries one. An entry with absent
  // `subjects` is not "asked about nothing" — it is "not stamped", and
  // the 042 rule says we never read absent as a claim.
  const askedAbout = new Set<string>();
  for (const entry of deps.queue.list()) {
    if (entry.subjects) {
      for (const id of entry.subjects) {
        askedAbout.add(id);
      }
    }
  }

  // Find frontier entities: mentioned enough, never asked about.
  // Also dedupe against entries already in the queue with this entity in
  // `subjects` — an entry pending/asked/deferred still counts as "asked
  // about" for dedupe purposes, even if not yet answered.
  const candidates = deps.store.byMentionCount(threshold);
  const frontier = candidates.filter((e) => !askedAbout.has(e.id));

  if (frontier.length === 0) return { minted: 0, frontierEntities: 0 };

  if (shadowMode) {
    // Shadow: log every candidate, mint nothing.
    deps.log({
      at: deps.now,
      actor: 'clerk',
      kind: 'gazetteer-frontier-shadow',
      detail: `frontierEntities=${frontier.length} cap=${cap} mode=shadow`,
    });
    return { minted: 0, frontierEntities: frontier.length };
  }

  // Live: mint at most `cap` questions.
  let minted = 0;
  for (const entity of frontier) {
    if (minted >= cap) break;

    const question = frontierQuestion(entity.name);
    if (question === null) continue;

    const draft: QueueDraft = {
      source: 'gazetteer-frontier',
      license: 'frontier — entity mentioned often, never asked about',
      question,
      questionForm: 'deliberative',
      horizon: 'session',
      subjects: [entity.id],
    };

    deps.queue.add(draft);
    minted++;
  }

  deps.log({
    at: deps.now,
    actor: 'clerk',
    kind: 'gazetteer-frontier-minted',
    detail: `minted=${minted} frontierEntities=${frontier.length} threshold=${threshold} cap=${cap}`,
  });

  return { minted, frontierEntities: frontier.length };
}

// ── Question templates (ZERO-LLM, name the topic, never the gap) ──

const TEMPLATES = [
  // never names the count or the absence — just the entity
  (name: string) => `Tell me about ${name}.`,
  (name: string) => `What can you tell me about ${name}?`,
  (name: string) => `What's the story with ${name}?`,
];

/**
 * A frontier question for an entity. Picks a template at random —
 * same discipline as the Randomizer: filter then random among survivors,
 * never argmax (Q-13). Returns null when the entity name is empty.
 */
function frontierQuestion(name: string): string | null {
  if (name.trim() === '') return null;
  const idx = Math.floor(Math.random() * TEMPLATES.length);
  return TEMPLATES[idx]!(name);
}
