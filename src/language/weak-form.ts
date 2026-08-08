/**
 * Weak-form question filter for bank fallback draws.
 *
 * A question is rejected when it is a yes/no form, bundles multiple
 * questions, or carries leading junk (markdown prefixes, numbers, etc.).
 *
 * The filter is a preference, not a ban: when it empties the pool, the
 * callers fall through to the unfiltered bank — a weak question beats no
 * question. That policy lives here so every caller shares it (ticket 021).
 */
const YES_NO_VERBS: Record<string, true> = {
	do: true,
	does: true,
	did: true,
	have: true,
	has: true,
	are: true,
	is: true,
	was: true,
	were: true,
	will: true,
	would: true,
	can: true,
	could: true,
	should: true,
};

/**
 * Returns `true` when the question should be REJECTED from bank fallback
 * draws: yes/no forms, multi-question strings, or leading junk.
 */
export function isWeakForm(question: string): boolean {
	// Leading junk: must start with a letter.
	if (!/^[A-Za-z]/.test(question)) return true;

	// Multi-question strings: more than one '?'.
	const marks = question.match(/\?/g);
	if (marks !== null && marks.length > 1) return true;

	// Yes/no forms: first word is an auxiliary/modal verb.
	const firstWord = question.match(/^[A-Za-z]+/)?.[0]?.toLowerCase();
	return firstWord !== undefined && YES_NO_VERBS[firstWord] === true;
}
