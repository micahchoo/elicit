/**
 * Atlas instrument validator — ticket 110.
 *
 * Validates a raw JSON parse against the AtlasInstrument contract.
 * Every violation is one named reason; the result is total — a single
 * failure produces the full list of what is wrong.
 */

import type { AtlasInstrument, AtlasRegion } from './atlas-types.js';
import { isStableSlug, strVal, strArr, objArr, type ValidationResult } from './validate-shared.js';

export type RejectionReason = string;
export type AtlasResult = ValidationResult<AtlasInstrument>;

// ── validation ──

/**
 * Validate raw JSON as an AtlasInstrument.
 * Returns `{ ok: true; value }` or `{ ok: false; reasons }`.
 */
export function validateAtlasInstrument(raw: unknown): AtlasResult {
  const reasons: RejectionReason[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reasons: ['atlas must be a JSON object'] };
  }

  const obj = raw as Record<string, unknown>;

  // ── top-level string fields ──
  const instrument = strVal(obj, 'instrument');
  if (!instrument) reasons.push('instrument: required string');
  else if (!isStableSlug(instrument)) reasons.push(`instrument "${instrument}" is not a stable slug`);

  const label = strVal(obj, 'label');
  if (!label) reasons.push('label: required string');

  const description = strVal(obj, 'description');
  if (!description) reasons.push('description: required string');

  // ── quarrelsWith ──
  const quarrelsWith = strArr(obj, 'quarrelsWith');
  if (!quarrelsWith) reasons.push('quarrelsWith: required string array');
  else {
    for (const q of quarrelsWith) {
      if (!isStableSlug(q)) reasons.push(`quarrelsWith "${q}" is not a stable slug`);
    }
  }

  // ── provenance ──
  const provenance = obj['provenance'];
  if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) {
    reasons.push('provenance: required object');
  } else {
    const prov = provenance as Record<string, unknown>;
    const gen = strVal(prov, 'generator');
    if (!gen) reasons.push('provenance.generator: required string');
    const ga = strVal(prov, 'generatedAt');
    if (!ga) reasons.push('provenance.generatedAt: required string');
    const pi = strVal(prov, 'instrument');
    if (!pi) reasons.push('provenance.instrument: required string');
    else if (instrument && pi !== instrument) {
      reasons.push(`provenance.instrument "${pi}" does not match top-level instrument "${instrument}"`);
    }
  }

  // ── regions ──
  const regionsRaw = objArr(obj, 'regions');
  if (!regionsRaw) {
    reasons.push('regions: required array of objects');
  } else if (regionsRaw.length === 0) {
    reasons.push('regions: must have at least one region');
  } else {
    const regionIds = new Set<string>();
    for (let i = 0; i < regionsRaw.length; i++) {
      const r = regionsRaw[i]!;
      const rid = strVal(r, 'id');
      if (!rid) {
        reasons.push(`regions[${i}].id: required string`);
      } else if (!isStableSlug(rid)) {
        reasons.push(`regions[${i}].id "${rid}" is not a stable slug`);
      } else if (regionIds.has(rid)) {
        reasons.push(`regions[${i}].id "${rid}" is a duplicate`);
      } else {
        regionIds.add(rid);
        // id must be namespaced: instrument.region
        const prefix = instrument ? `${instrument}.` : null;
        if (prefix && !rid.startsWith(prefix)) {
          reasons.push(`regions[${i}].id "${rid}" does not start with instrument prefix "${prefix}"`);
        }
      }

      const rl = strVal(r, 'label');
      if (!rl) reasons.push(`regions[${i}].label: required string`);

      const ol = strVal(r, 'oneLine');
      if (!ol) reasons.push(`regions[${i}].oneLine: required string`);
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };

  // SAFETY: after all checks pass, construct the known-good type
  const regions: AtlasRegion[] = regionsRaw!.map((r) => ({
    id: strVal(r, 'id')!,
    label: strVal(r, 'label')!,
    oneLine: strVal(r, 'oneLine')!,
  }));

  return {
    ok: true,
    value: {
      instrument: instrument!,
      label: label!,
      description: description!,
      quarrelsWith: quarrelsWith!,
      provenance: {
        generator: strVal(provenance as Record<string, unknown>, 'generator')!,
        generatedAt: strVal(provenance as Record<string, unknown>, 'generatedAt')!,
        instrument: strVal(provenance as Record<string, unknown>, 'instrument')!,
      },
      regions,
    },
  };
}
