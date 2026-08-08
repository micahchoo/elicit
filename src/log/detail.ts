/**
 * The detail grammar: one shared definition of how an audit event's `detail`
 * line encodes `key=value` pairs.
 *
 * Every event kind emits a detail line — `session=01K… hits=3`, or a prose
 * clause (`would=…`, `clipped=…`) that carries spaces and is not a field.
 * This module is the single parser for that surface. It replaces the three
 * hand-rolled readers (the renderer's `fields()`, the shadow collector's
 * anchored `threshold=` regex, the client's `quoted()` reads) with one
 * grammar, so a field written by one slice parses the same in every slice
 * that reads it.
 */

/**
 * One `key=value` pair: an identifier key, a non-space value. The greedy
 * `\S+` consumes the whole value token. Quoted values (`name="Robin Hale"`)
 * are not fields — they are prose; use `detailQuoted`.
 *
 * Shared as the single grammar so a strip (`replace(DETAIL_FIELD, ' ')`)
 * removes exactly what `detailFields` would read.
 */
export const DETAIL_FIELD = /([A-Za-z][A-Za-z0-9]*)=(\S+)/g;

/** The parsed pairs of a detail line. */
export type DetailFields = Record<string, string>;

/**
 * Parse the `key=value` pairs of a detail line.
 *
 * The identifier key never matches a tail of a longer token — `subthreshold`
 * is not a `threshold` field because the key must start at a word boundary.
 * Every real detail line is space-separated, so this reads exactly what the
 * renderer's old scan read.
 */
export function detailFields(detail: string): DetailFields {
 const out: DetailFields = {};
 for (const m of detail.matchAll(DETAIL_FIELD)) out[m[1]!] = m[2]!;
 return out;
}

/**
 * One named field, or undefined when absent.
 *
 * `detailField` is the single-key read the shadow collector used;
 * `detailFields` is the bulk read the renderer used. Both now share the same
 * grammar, so a field written by one slice parses the same in every slice.
 */
export function detailField(detail: string, key: string): string | undefined {
 return detailFields(detail)[key];
}

/** A quoted field: `name="Robin Hale"`. `DETAIL_FIELD` stops at the first space, so this does not. */
export function detailQuoted(detail: string, key: string): string | undefined {
 return new RegExp(`${key}="([^"]*)"`).exec(detail)?.[1];
}

/**
 * Everything after `key=` to the end of the line. Several events end in a
 * prose clause the emitter wrote — `would=`, `clipped=` — and a clause with
 * spaces in it is not a field.
 */
export function detailClause(detail: string, key: string): string {
 const at = detail.indexOf(`${key}=`);
 return at === -1 ? '' : detail.slice(at + key.length + 1).trim();
}
