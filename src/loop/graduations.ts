/**
 * The runtime graduation store — `data/graduations.json` (Q-99).
 *
 * Graduation is `live: false -> true` for THIS instance, and it rides the
 * same rail demotion already rides: a data file consulted where liveness is
 * READ (`isLive` in src/wiki/thresholds.ts), never an edit to `THRESHOLDS`.
 * The register keeps saying what SHIPS; the pin tests keep guarding it; the
 * owner's instance carries its own evolved state. That symmetry is the
 * whole design (Q-99, session-1 finding 1): before this store existed, the
 * only graduation path was flipping `live:` in code, which broke the
 * threshold's pin test, which the loop's add-only-tests rule forbids — so
 * the loop's canonical lane was structurally closed.
 *
 * Demotion BEATS graduation: `isLive` consults both, and a demoted key is
 * dead no matter what this store says. Re-graduation after dwell is
 * `clearDemotion` plus a ledger line, exactly as before — which is why this
 * module has no removal API at all: silently un-graduating would leave the
 * ledger mute, and the visible reverse of a graduation is a demotion.
 *
 * Same duties as src/loop/demotions.ts, for the same reason (this module is
 * imported by the registry every wiki module reads): no top-level I/O, no
 * throw on any path, an absent or malformed file reading as "nothing is
 * graduated" — the state of a fresh instance.
 *
 * The store itself lives in src/loop/key-store.ts — one crash-tolerant
 * key-store parameterized by root, file name and entry field, shared with
 * demotions. This module is the graduation-shaped adapter over it; the
 * public surface below is unchanged.
 */

import { join } from 'node:path';
import { createKeyStore } from './key-store.js';

/** Where the store lives when nobody says — per call, never captured at load. */
function defaultDataDir(): string {
  return process.env.ELICIT_DATA_DIR ?? join(process.cwd(), 'data');
}

/** The graduation store: `data/graduations.json`, entry field `graduated`. */
const store = createKeyStore({
  root: defaultDataDir,
  fileName: 'graduations.json',
  entryField: 'graduated',
});

/**
 * The graduated mechanism keys. Absent, unreadable or malformed reads as an
 * empty set — a store this module cannot parse must not silently graduate
 * anything.
 */
export function readGraduations(dataDir: string): Set<string> {
  return store.readAll(dataDir);
}

/**
 * Record one graduation. Idempotent. The ONLY legitimate caller is the loop
 * (or the owner) appending a `graduation` ledger line in the same act — a
 * graduation this file holds that the ledger cannot explain is a record
 * failure, exactly like a hand-edited demotion.
 */
export function addGraduation(dataDir: string, key: string): void {
  store.addOne(dataDir, key);
}

/**
 * Whether this mechanism key is graduated, read from disk at the moment of
 * the question through the store's stat-token cache. Used by `isLive`;
 * `dataDir` defaults to the instance's data directory.
 */
export function isGraduated(key: string, dataDir: string = defaultDataDir()): boolean {
  return store.isIn(key, dataDir);
}
