/**
 * The one crash-tolerant key-store behind the loop's runtime stores —
 * src/loop/graduations.ts and src/loop/demotions.ts (Q-90, Q-99).
 *
 * The two stores are the same machine with different labels: a JSON object
 * holding one array of keys, read with a parse fallback of "nothing is
 * stored", appended to idempotently, and consulted through a stat-token
 * cache. The cache exists because `isGraduated`/`isDemoted` sit inside
 * `shadowDecision`, which the wiki jobs call thousands of times a run; the
 * token is the file signature (`mtimeMs:size`), so the file is re-read only
 * when it moves. Each store instance owns its own cache — the factory
 * closes over a fresh one, so consulting one file never thrashes another's.
 *
 * Must-not-fail-to-load duty, inherited from both stores: no top-level I/O,
 * no throw on any path, an absent or malformed file reading as an empty
 * set. The registry every wiki module reads imports the adapters, which
 * import this module, so this one carries the same duty.
 *
 * `createKeyStore` is plumbing, not a mechanism: the mechanisms remain the
 * adapters' exports (`readGraduations`, `isDemoted`, …), which the
 * mechanism registry declares. It is therefore exported as a named-export
 * statement — the form the registry sweep does not enumerate — so it needs
 * no registry line of its own, the same shape `src/import/pipeline.ts` uses
 * to re-export its stores.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface KeyStore {
  /** Every stored key. Absent, unreadable or malformed reads as an empty set. */
  readAll(dataDir: string): Set<string>;
  /** Record one key. Idempotent — always rewrites the sorted file. */
  addOne(dataDir: string, key: string): void;
  /**
   * Remove one key — the re-graduation path. Present only when the store
   * was constructed with `removal: true`; the graduation store asks for no
   * removal API at all (Q-99).
   */
  clearOne?(dataDir: string, key: string): void;
  /** Whether the key is stored, read from disk through the stat-token cache. */
  isIn(key: string, dataDir?: string): boolean;
}

export interface KeyStoreOptions {
  /** Resolves the store root per call — never captured at load. */
  root: () => string;
  /** File name within the root, e.g. `graduations.json`. */
  fileName: string;
  /** The array field inside the JSON object, e.g. `graduated`. */
  entryField: string;
  /** Also build `clearOne` — the demotion store's re-graduation path. */
  removal?: boolean;
}

function createKeyStore(options: KeyStoreOptions): KeyStore {
  const filePath = (dataDir: string): string => join(dataDir, options.fileName);

  function readAll(dataDir: string): Set<string> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath(dataDir), 'utf-8'));
      if (parsed === null || typeof parsed !== 'object') return new Set();
      const list = (parsed as Record<string, unknown>)[options.entryField];
      if (!Array.isArray(list)) return new Set();
      return new Set(list.filter((k): k is string => typeof k === 'string'));
    } catch {
      return new Set();
    }
  }

  function addOne(dataDir: string, key: string): void {
    const keys = readAll(dataDir);
    keys.add(key);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(filePath(dataDir), `${JSON.stringify({ [options.entryField]: [...keys].sort() }, null, 1)}\n`, 'utf-8');
  }

  function clearOne(dataDir: string, key: string): void {
    const keys = readAll(dataDir);
    if (!keys.delete(key)) return;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(filePath(dataDir), `${JSON.stringify({ [options.entryField]: [...keys].sort() }, null, 1)}\n`, 'utf-8');
  }

  /** The cached set, and the file signature it was read at. Per store instance. */
  let cache: { dir: string; token: string; keys: Set<string> } | null = null;

  function isIn(key: string, dataDir: string = options.root()): boolean {
    let token: string;
    try {
      const stat = statSync(filePath(dataDir));
      token = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      // No store: nothing is stored. Not cached — the file appearing is the
      // event this function exists to notice.
      cache = null;
      return false;
    }
    if (cache === null || cache.dir !== dataDir || cache.token !== token) {
      cache = { dir: dataDir, token, keys: readAll(dataDir) };
    }
    return cache.keys.has(key);
  }

  return {
    readAll,
    addOne,
    isIn,
    ...(options.removal ? { clearOne } : {}),
  };
}

export { createKeyStore };
