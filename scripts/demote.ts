/**
 * The demote verb (Q-89, ticket 122's record plane).
 *
 *   npx tsx scripts/demote.ts <mechanism-key>
 *
 * The always-works path. It writes two files and imports no loop code, no
 * server, no model: the owner must be able to stop a mechanism while the
 * server is down, while the loop is mid-cycle, or while whatever the loop
 * built last night is the reason they want it stopped. There is no web
 * control for this and there will not be one.
 *
 * What it does:
 *   - records the key in `data/demotions.json`, which `shadowDecision`
 *     consults at read time, so the mechanism reads as shadow from the next
 *     decision onward — no restart, no edit to src/;
 *   - appends the `by:"owner"` line to the graduation ledger, so the loop
 *     reads its own history and does not re-graduate what was just stopped.
 *
 * Demotion is `live: true -> false` and NOTHING ELSE (Q-90). Nothing the
 * mechanism already did is reverted, and nothing here reverts it.
 */

import { join } from 'node:path';

import { appendLedger } from '../src/loop/ledger.js';
import { addDemotion, readDemotions } from '../src/loop/demotions.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';

const DATA_DIR = process.env.ELICIT_DATA_DIR ?? join(import.meta.dirname, '..', 'data');
const LEDGER = join(DATA_DIR, 'graduation-ledger.jsonl');

const key = process.argv[2];

if (key === undefined || key.trim() === '') {
  console.error('usage: npx tsx scripts/demote.ts <mechanism-key>');
  console.error('');
  console.error('threshold keys this instance can gate on:');
  for (const name of Object.keys(THRESHOLDS).sort()) console.error(`  ${name}`);
  process.exit(1);
}

const alreadyDemoted = readDemotions(DATA_DIR).has(key);
const at = new Date().toISOString();

addDemotion(DATA_DIR, key);
appendLedger(LEDGER, { at, event: 'demotion', mechanism: key, by: 'owner' });

console.log(`demoted ${key}`);
console.log(`  ${join(DATA_DIR, 'demotions.json')} — ${alreadyDemoted ? 'already listed, unchanged' : 'key added'}`);
console.log(`  ${LEDGER} — appended one by:"owner" demotion line at ${at}`);

// A key with no threshold entry is recorded, never refused: the ledger has to
// be able to say what the owner did. But it has no boolean to flip, so saying
// so here is the difference between a demotion and the appearance of one.
if (!Object.hasOwn(THRESHOLDS, key)) {
  console.log('');
  console.log(`  NOTE: "${key}" names no THRESHOLDS entry, so no gate reads it.`);
  console.log('  The ledger and loop-status will show the demotion; no behaviour changes.');
} else {
  console.log('');
  console.log('  It reads as shadow from the next decision onward — no restart needed.');
}
