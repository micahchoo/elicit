/**
 * The reflection follow-ups — ticket 090 T6. Q-75 makes a return license
 * the reflection questions (what broke, what surprised — 016's own words),
 * and Q-12 requires a composed question to contain the person's words
 * verbatim — so this is the import-repair pattern: a zero-LLM template
 * around a code-verified quote, capped, deduped, into the ordinary Queue.
 *
 * The (quest, session) pair is the dedupe key and it lives in the license
 * string, so a second return for the same sitting reads it back off disk
 * and mints nothing — the dedupe survives a restart.
 */

import type { QueueEntry, QueueStore } from '../types.js';
import type { Quest } from './contract.js';
import { THRESHOLDS, readNumber, shadowDecision } from '../wiki/thresholds.js'
import type { ThresholdLogFn } from '../domain/thresholds.js';

/** The two reflection questions, in order (016: what broke, what surprised). */
const TEMPLATES: ((quote: string) => string)[] = [
 (quote) => `You came back with "${quote}" — what broke along the way that these words don't say?`,
 (quote) => `You came back with "${quote}" — what surprised you?`,
];

/** The longest a quoted fragment may run before a word-boundary cut. */
const QUOTE_MAX = 200;

/**
 * The exact substring the templates quote: the first complete sentence, up
 * to QUOTE_MAX characters, else the first QUOTE_MAX characters cut at a
 * word boundary (or flat, when the text is one unbroken word). The caller
 * re-verifies `returnText.includes(fragment)` before minting (Q-12's
 * rigidity-in-validation) — a fragment that is not a substring mints
 * nothing rather than an unquoted question.
 */
function quotedFragment(returnText: string): string {
 const sentence = /^[^.!?]*[.!?]/.exec(returnText)?.[0];
 const first = sentence !== undefined ? sentence : returnText;
 if (first.length <= QUOTE_MAX) return first;
 const cut = returnText.slice(0, QUOTE_MAX);
 const lastSpace = cut.lastIndexOf(' ');
 return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

export function mintReflections(input: {
 queue: QueueStore;
 quest: Quest;
 session: string;
 returnText: string;
 log: ThresholdLogFn;
}): { minted: QueueEntry[]; clipped: number } {
 const quote = quotedFragment(input.returnText.trim());
 if (quote.length === 0 || !input.returnText.includes(quote)) return { minted: [], clipped: 0 };

 const already = input.queue
  .list({ source: 'quest-reflection' })
  .some(
   (e) => e.quest === input.quest.id && e.license.includes(`session=${input.session}`),
  );
 if (already) return { minted: [], clipped: 0 };

 const cap = THRESHOLDS['coach.reflectionCap']!;
 const minted: QueueEntry[] = [];
 let clipped = 0;
 for (const template of TEMPLATES) {
  if (minted.length >= readNumber(cap, 2)) {
   // A clip is the only shadowDecision call that logs (repo convention): a
   // live cap that clipped nothing would bury the record it exists to keep.
   shadowDecision(
    cap,
    `mint reflection question ${minted.length + 1} for quest=${input.quest.id}`,
    input.log,
    true,
   );
   clipped++;
   continue;
  }
  minted.push(
   input.queue.add({
    source: 'quest-reflection',
    quest: input.quest.id,
    direction: input.quest.direction,
    license: `Q-75 quest return quest=${input.quest.id} session=${input.session}`,
    question: template(quote),
    questionForm: 'theoretical',
    horizon: 'session',
    quotedFragment: quote,
   }),
  );
 }
 return { minted, clipped };
}
