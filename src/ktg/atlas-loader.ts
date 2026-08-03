/**
 * Atlas instrument loader — ticket 110.
 *
 * Loads an atlas instrument from `data/atlases/<instrument>.json`, validates
 * it, and returns a known-good atlas or a named rejection.
 *
 * Follows the same pattern as `src/ktg/loader.ts` (ticket 094).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateAtlasInstrument, type AtlasResult } from './atlas-validator.js';
import type { AtlasInstrument } from './atlas-types.js';

/** The directory where atlas instrument files live. */
const ATLAS_DATA_DIR = 'data/atlases';

/**
 * Load and validate an atlas by instrument id.
 * Returns `{ ok: true; value }` or `{ ok: false; reasons }`.
 */
export function loadAtlas(
  instrument: string,
  rootDir?: string,
): AtlasResult {
  const base = rootDir ?? process.cwd();
  const path = join(base, ATLAS_DATA_DIR, `${instrument}.json`);

  if (!existsSync(path)) {
    return { ok: false, reasons: [`atlas not found: ${path}`] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return {
      ok: false,
      reasons: [`failed to parse atlas: ${(e as Error).message}`],
    };
  }

  return validateAtlasInstrument(raw);
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
