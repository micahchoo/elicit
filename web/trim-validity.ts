/**
 * The Q-51 authorship guard, one definition: a trim must be a non-empty
 * substring of the original, and the whole original is a valid trim too.
 *
 * Two trim editors drifted on this rule (import-review.ts checked the raw
 * value against '' while main.ts checked the trimmed value, so a
 * whitespace-only edit passed one and not the other). Both now call this
 * predicate — the authorship guarantee has one implementation.
 *
 * Whitespace-only edits are refused: a trim that collapses to nothing is not
 * a trim, and refusing it keeps the wire value honest.
 */
export function validTrim(original: string, edit: string): boolean {
 return edit.trim() !== '' && (original.includes(edit) || edit === original);
}
