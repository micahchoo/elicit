/**
 * Territory instrument loaders — the shared load-validate shape.
 *
 * KTG skeletons (ticket 094) and atlas instruments (ticket 110) are the same
 * mechanism: read `data/<kind>/<name>.json`, validate it, return a known-good
 * value or a named rejection. The two public loaders (loadKtgSkeleton,
 * loadAtlas) are thin named bindings over one loader; the dir constant and
 * the validator are the only differences between the instruments.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The directory where KTG skeleton files live. */
const KTG_DATA_DIR = 'data/ktg';

/** The directory where atlas instrument files live. */
const ATLAS_DATA_DIR = 'data/atlases';

type ValidationResult<T> = { ok: true; value: T } | { ok: false; reasons: string[] };

/** One load: exists → parse → validate, with a named rejection on each failure. */
function loadInstrumentJSON<T>(
  dir: string,
  name: string,
  label: string,
  validate: (raw: unknown) => ValidationResult<T>,
  rootDir?: string,
): ValidationResult<T> {
  const base = rootDir ?? process.cwd();
  const path = join(base, dir, `${name}.json`);

  if (!existsSync(path)) {
    return { ok: false, reasons: [`${label} not found: ${path}`] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return {
      ok: false,
      reasons: [`failed to parse ${label}: ${(e as Error).message}`],
    };
  }

  return validate(raw);
}

// ── KTG skeleton (ticket 094) ──

import { validateKtgSkeleton, type SkeletonResult } from './validator.js';
import type { KtgSkeleton } from './types.js';

/**
 * Load and validate a skeleton by domain slug.
 * Returns `{ ok: true; value }` or `{ ok: false; reasons }`.
 */
export function loadKtgSkeleton(
  domain: string,
  rootDir?: string,
): SkeletonResult {
  return loadInstrumentJSON(KTG_DATA_DIR, domain, 'skeleton', (raw) => validateKtgSkeleton(raw), rootDir);
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

// ── Atlas instrument (ticket 110) ──

import { validateAtlasInstrument, type AtlasResult } from './atlas-validator.js';
import type { AtlasInstrument } from './atlas-types.js';

/**
 * Load and validate an atlas by instrument id.
 * Returns `{ ok: true; value }` or `{ ok: false; reasons }`.
 */
export function loadAtlas(
  instrument: string,
  rootDir?: string,
): AtlasResult {
  return loadInstrumentJSON(ATLAS_DATA_DIR, instrument, 'atlas', (raw) => validateAtlasInstrument(raw), rootDir);
}

/**
 * Load a validated atlas, throwing on failure.
 * Use only when the caller can guarantee the atlas is valid
 * (e.g. fixtures loaded in tests).
 */
export function loadAtlasOrThrow(
  instrument: string,
  rootDir?: string,
): AtlasInstrument {
  const result = loadAtlas(instrument, rootDir);
  if (!result.ok) {
    throw new Error(`Invalid atlas: ${result.reasons.join('; ')}`);
  }
  return result.value;
}
