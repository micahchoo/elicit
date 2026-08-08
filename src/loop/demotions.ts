/**
 * The runtime demotion store — `data/demotions.json` (Q-90, ticket 132).
 *
 * Demotion is `live: true -> false` and nothing else: no revert, no undo of
 * anything the mechanism already did (Q-90). So a demotion has to reach the
 * place liveness is READ, or it is a note in a file that changes nothing —
 * and a mechanism the loop believes it demoted while the mechanism keeps
 * acting is worse than no tripwire at all.
 *
 * That place is `shadowDecision` in src/wiki/thresholds.ts, the one door
 * every threshold decision passes through. It calls `isDemoted` with the
 * threshold's own name, so a demoted mechanism behaves exactly as a
 * shadowed one: it computes, it logs what it would have done, it changes
 * nothing. The demoted state is applied at READ time rather than by editing
 * `THRESHOLDS`, which is why `scripts/demote.ts` works with the server
 * down and why a running server picks the demotion up without a restart.
 *
 * ## The key vocabulary
 *
 * Keys are mechanism keys, the ledger's vocabulary. A key that names a
 * `THRESHOLDS` entry is the actionable form — that is what the door can
 * gate. A key naming a mechanism with no threshold entry is recorded and
 * reported all the same, because the ledger must be able to say what the
 * owner did; it just has no boolean to flip. `scripts/demote.ts` says so
 * out loud rather than letting the difference pass in silence.
 *
 * ## Why this module imports nothing but the store and the path resolver
 *
 * `src/wiki/thresholds.ts` is the registry every wiki module reads, and it
 * must not be able to fail to load. This is one of the two modules it
 * imports, so this one carries the same duty: no top-level I/O, no throw on
 * any path, an unreadable or absent file reading as "nothing is demoted".
 * A tripwire that can crash the instrument it watches is not a safety
 * mechanism.
 *
 * The store itself lives in src/loop/key-store.ts — one crash-tolerant
 * key-store parameterized by root, file name and entry field, shared with
 * graduations. This module is the demotion-shaped adapter over it, and the
 * only one that asks for the removal method (`clearDemotion`); the public
 * surface below is unchanged.
 */

import { join } from 'node:path';
import { createKeyStore } from './key-store.js';

/**
 * Where the store lives when nobody says. `ELICIT_DATA_DIR` follows the
 * repo's env convention and is read per call, never captured at load, so a
 * test can point the real read path at a temporary directory.
 */
function defaultDataDir(): string {
  return process.env.ELICIT_DATA_DIR ?? join(process.cwd(), 'data');
}

/** The demotion store: `data/demotions.json`, entry field `demoted`, with removal. */
const store = createKeyStore({
  root: defaultDataDir,
  fileName: 'demotions.json',
  entryField: 'demoted',
  removal: true as const,
});

/**
 * The demoted mechanism keys. An absent, unreadable or malformed file reads
 * as an empty set: nothing demoted is the state of a fresh instance, and a
 * store this module cannot parse must not silently shadow every mechanism
 * in the instrument.
 */
export function readDemotions(dataDir: string): Set<string> {
  return store.readAll(dataDir);
}

/**
 * Record one demotion. Idempotent — demoting a demoted mechanism rewrites
 * the same set — and additive: this module has no removal API, because
 * re-graduation after dwell is the loop's own act and goes through the
 * ledger, never through an editor deleting a line here.
 */
export function addDemotion(dataDir: string, key: string): void {
  store.addOne(dataDir, key);
}

/**
 * Undo a demotion — the re-graduation path (Q-95), and the ONLY caller that
 * may use it is the loop appending a `re-graduation` ledger line in the
 * same act. It exists here because the alternative is an operator editing
 * JSON by hand, which leaves the ledger silent about the change.
 */
export function clearDemotion(dataDir: string, key: string): void {
  // The store is constructed with `removal: true`, so `clearOne` is present.
  store.clearOne!(dataDir, key);
}

/**
 * Whether this mechanism key is demoted, read from disk at the moment of
 * the question through the store's stat-token cache. Used by
 * `shadowDecision`; `dataDir` defaults to the instance's data directory.
 */
export function isDemoted(key: string, dataDir: string = defaultDataDir()): boolean {
  return store.isIn(key, dataDir);
}
