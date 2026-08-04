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
 * ## Why this module imports nothing but the filesystem
 *
 * `src/wiki/thresholds.ts` is the registry every wiki module reads, and it
 * must not be able to fail to load. This is the one module it imports, so
 * this one carries the same duty: no top-level I/O, no throw on any path,
 * an unreadable or absent file reading as "nothing is demoted". A tripwire
 * that can crash the instrument it watches is not a safety mechanism.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEMOTIONS_FILE = 'demotions.json';

/** The on-disk shape. An object, not a bare array, so a reader can see what it is. */
type DemotionsFile = { demoted: string[] };

/**
 * Where the store lives when nobody says. `ELICIT_DATA_DIR` follows the
 * repo's env convention and is read per call, never captured at load, so a
 * test can point the real read path at a temporary directory.
 */
function defaultDataDir(): string {
  return process.env.ELICIT_DATA_DIR ?? join(process.cwd(), 'data');
}

function demotionsPath(dataDir: string): string {
  return join(dataDir, DEMOTIONS_FILE);
}

/**
 * The demoted mechanism keys. An absent, unreadable or malformed file reads
 * as an empty set: nothing demoted is the state of a fresh instance, and a
 * store this module cannot parse must not silently shadow every mechanism
 * in the instrument.
 */
export function readDemotions(dataDir: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(demotionsPath(dataDir), 'utf-8'));
    if (parsed === null || typeof parsed !== 'object') return new Set();
    const list = (parsed as DemotionsFile).demoted;
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((k): k is string => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

/**
 * Record one demotion. Idempotent — demoting a demoted mechanism rewrites
 * the same set — and additive: this module has no removal API, because
 * re-graduation after dwell is the loop's own act and goes through the
 * ledger, never through an editor deleting a line here.
 */
export function addDemotion(dataDir: string, key: string): void {
  const demoted = readDemotions(dataDir);
  demoted.add(key);
  mkdirSync(dataDir, { recursive: true });
  const file: DemotionsFile = { demoted: [...demoted].sort() };
  writeFileSync(demotionsPath(dataDir), `${JSON.stringify(file, null, 1)}\n`, 'utf-8');
}

/**
 * Undo a demotion — the re-graduation path (Q-95), and the ONLY caller that
 * may use it is the loop appending a `re-graduation` ledger line in the
 * same act. It exists here because the alternative is an operator editing
 * JSON by hand, which leaves the ledger silent about the change.
 */
export function clearDemotion(dataDir: string, key: string): void {
  const demoted = readDemotions(dataDir);
  if (!demoted.delete(key)) return;
  mkdirSync(dataDir, { recursive: true });
  const file: DemotionsFile = { demoted: [...demoted].sort() };
  writeFileSync(demotionsPath(dataDir), `${JSON.stringify(file, null, 1)}\n`, 'utf-8');
}

/**
 * The cached set, and the file signature it was read at. Re-read happens
 * when size or mtime moves; a demotion always adds a key, so it always
 * moves the size. The cache exists because `isDemoted` sits inside
 * `shadowDecision`, which the wiki jobs call thousands of times a run.
 */
let cache: { dir: string; token: string; demoted: Set<string> } | null = null;

/**
 * Whether this mechanism key is demoted, read from disk at the moment of
 * the question. Used by `shadowDecision`; `dataDir` defaults to the
 * instance's data directory.
 */
export function isDemoted(key: string, dataDir: string = defaultDataDir()): boolean {
  let token: string;
  try {
    const stat = statSync(demotionsPath(dataDir));
    token = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    // No store: nothing is demoted. Not cached — the file appearing is the
    // event this function exists to notice.
    cache = null;
    return false;
  }
  if (cache === null || cache.dir !== dataDir || cache.token !== token) {
    cache = { dir: dataDir, token, demoted: readDemotions(dataDir) };
  }
  return cache.demoted.has(key);
}
