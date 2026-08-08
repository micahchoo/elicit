/**
 * The one date a surface shows a person, from an ISO stamp — "14 July 2026"
 * in the locale's words, or an empty string when the stamp does not parse.
 * Shared by the waiting, wiki and material surfaces (the seam, web/deps.ts):
 * extracted from main.ts so the split screens read dates identically.
 */

/** A date a person reads, from an ISO stamp. */
export function readableDate(iso: string): string {
 const d = new Date(iso);
 if (Number.isNaN(d.getTime())) return '';
 return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
