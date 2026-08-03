/**
 * KTG skeleton loader — ticket 094.
 *
 * Loads a KTG skeleton from `data/ktg/<domain-slug>.json`, validates it,
 * and returns a known-good skeleton or a named rejection.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateKtgSkeleton, type SkeletonResult } from './validator.js';
import type { KtgSkeleton } from './types.js';

/** The directory where KTG skeleton files live. */
const KTG_DATA_DIR = 'data/ktg';

/**
 * Load and validate a skeleton by domain slug.
 * Returns `{ ok: true; value }` or `{ ok: false; reasons }`.
 */
export function loadKtgSkeleton(
  domain: string,
  rootDir?: string,
): SkeletonResult {
  const base = rootDir ?? process.cwd();
  const path = join(base, KTG_DATA_DIR, `${domain}.json`);

  if (!existsSync(path)) {
    return { ok: false, reasons: [`skeleton not found: ${path}`] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return {
      ok: false,
      reasons: [`failed to parse skeleton: ${(e as Error).message}`],
    };
  }

  return validateKtgSkeleton(raw);
}

/**
 * Load a validated skeleton, throwing on failure.
 * Use only when the caller can guarantee the skeleton is valid
 * (e.g. fixtures loaded in tests).
 */
export function loadKtgSkeletonOrThrow(
  domain: string,
  rootDir?: string,
): KtgSkeleton {
  const result = loadKtgSkeleton(domain, rootDir);
  if (!result.ok) {
    throw new Error(`Invalid KTG skeleton: ${result.reasons.join('; ')}`);
  }
  return result.value;
}
