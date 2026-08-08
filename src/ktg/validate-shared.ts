/**
 * Shared validation scaffolding for the territory instruments.
 *
 * KTG skeletons (ticket 094) and atlas instruments (ticket 110) both
 * validate raw JSON parses and return the same total-result shape — one
 * reason per violation, everything reported. The graph rules are genuinely
 * instrument-specific and stay in each validator; the scaffolding (stable
 * slug check, unknown-field readers, the result union) is shared here so
 * the two validators cannot drift apart on it.
 *
 * The field readers take the STRICTER of the two prior semantics: a string
 * field must be non-empty after trimming (the KTG validator's rule), so a
 * whitespace-only value is rejected everywhere, not just in skeletons.
 */

/** Stable slugs: lowercase alphanumeric, hyphens, dots only. */
export const ID_RE = /^[a-z0-9][a-z0-9.-]*$/;

export function isStableSlug(id: string): boolean {
  return ID_RE.test(id);
}

/** A string field, or null when absent / not a string / empty after trim. */
export function strVal(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** An integer field, or null when absent / not an integer. */
export function intVal(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** A string-array field, or null when absent / not an array of strings. */
export function strArr(obj: Record<string, unknown>, key: string): string[] | null {
  const v = obj[key];
  if (!Array.isArray(v)) return null;
  // Filter to strings only (the KTG validator's tolerance).
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

/** An object-array field, or null when absent / not an array of objects. */
export function objArr(obj: Record<string, unknown>, key: string): Record<string, unknown>[] | null {
  const v = obj[key];
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x))) return null;
  return v as Record<string, unknown>[];
}

/** Successful validation: the value is a known-good instrument. */
export type Valid<T> = { ok: true; value: T };

/** Failed validation: every reason names one contract violation. */
export type Invalid = { ok: false; reasons: string[] };

export type ValidationResult<T> = Valid<T> | Invalid;
