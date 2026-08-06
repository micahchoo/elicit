/**
 * The coach contract — ticket 090. Every coach record shape, the Direction
 * slug, the option-set gate, and the prompt-input type that cannot carry a
 * pointer (Q-78). Types plus three pure functions; no I/O, no imports.
 */

/** Q-77's licensing events, enumerated. Elapsed time is not one and never will be. */
export type CoachLicenseEvent =
 | 'quest-return' | 'artifact-declared' | 'sitting-touched' | 'page-opened';

export type DirectionRecord = {
 slug: string;            // directionSlugFor(name); stable identity
 name: string;            // the person's words for it
 coached: boolean;        // the lens (Q-73); flipping off archives nothing
 coachedAt?: string;
 uncoachedAt?: string;
 /** A declined coached-offer; this Direction is never offered again (Q-77 discipline). */
 offerDeclinedAt?: string;
 /** Q-112: seeded offer declined → parked, not permanently declined. Absent = not parked. */
 seededOfferParkedAt?: string;
 /** Q-112: how many claims were in the cluster when parked — the re-offer bar is +3. */
 seededOfferParkedClaimCount?: number;
 /** Q-110 door 1: this Direction was minted by the seed job (docket clustering), not by the user. */
 seeded?: boolean;
 /** Last page read — what "something new" is measured against (Q-76). */
 lastVisit?: string;
 /** Normalized texts of declined options — never re-offered (Q-77). */
 declinedOptions: string[];
};

export type Quest = {
 id: string;
 direction: string;       // slug
 act: string;             // agent prose, Marginalia-class: never quotable into a Piece (Q-74)
 cites: string[];         // claim ids that made it relevant (Q-74)
 adoptedAt: string;       // adoption MINTS the record (Q-74)
 retiredAt?: string;      // the person's verb (Q-75)
};
/** Computed, never stored (Q-75) — a stored status could lie; a derived one cannot. */
export type QuestStatus = 'adopted' | 'returned' | 'retired';

export type ArtifactRecord = {
 id: string;
 direction: string;
 quest?: string;
 /** Lineage-plane, opaque. NO function in src/coach/ accepts this and returns content (Q-78). */
 pointer: string;
 /** The person's name for it — the only word the Coach may use (Q-78). */
 name: string;
 /** The capture session of the person's sentence — the description-Snippet's home. */
 sentenceSession: string;
 declaredAt: string;
};

export type QuestOption = { id: string; text: string; cites: string[] };
export type AdviceNote = {
 direction: string;
 mintedAt: string;
 license: CoachLicenseEvent;
 /** 2–3 by the guard — choice-expansion is structural (Q-24, Q-74). */
 options: QuestOption[];
 readAt?: string;
};

/** THE prompt-input type. It has no pointer field, so the model cannot be handed one (Q-78). */
export type AdvicePromptInput = {
 directionName: string;
 claims: { id: string; body: string; range: string }[];
 quests: { act: string; returns: string[] }[];  // return PROSE — the person's words
 artifactNames: string[];                        // names only, ever
};

/**
 * The route-safe slug for a Direction's name: lowercase, [^a-z0-9]+ → '-',
 * leading/trailing dashes trimmed. The route words 'waiting', 'direction'
 * and 'quest' are RESERVED: a name that would slug to one gets a 'd-'
 * prefix (e.g. 'Waiting' → 'd-waiting'), so a page path can never shadow a
 * coach route — T11's isReadPath rule depends on this. Named
 * `directionSlugFor` because `slugFor` is already exported by
 * src/import/region.ts and the mechanism sweep matches callers by
 * identifier alone (090 T2: an unwired same-named export would fail the gate).
 */
export function directionSlugFor(name: string): string {
 const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
 if (slug === '') return 'unnamed';
 if (slug === 'waiting' || slug === 'direction' || slug === 'quest') return `d-${slug}`;
 return slug;
}

/**
 * The normalized form used for declined-option dedupe (Q-77): trim, lowercase,
 * collapse internal whitespace runs to one space. Stable and documented — the
 * store stores `normalizeOption(text)` and the guard compares the same way.
 */
export function normalizeOption(text: string): string {
 return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The gate every model-proposed option set passes. Accepts `{ options: [...] }`
 * or a bare array (tolerant posture). Refuses with a named reason: fewer than
 * 2 or more than 3 options; an option with empty text; an option citing
 * nothing; an option citing a claim `claimExists` denies; an option whose
 * normalized text matches a declined one — that one is DROPPED (Q-77), and if
 * fewer than 2 survive the whole set is refused. Returns the survivors, each
 * with a note-unique id, or a named refusal.
 */
export function adviceGuard(
 parsed: unknown,
 opts: { declined: string[]; claimExists: (id: string) => boolean },
): { ok: true; options: QuestOption[] } | { ok: false; reason: string } {
 const optionsField = parsed !== null && typeof parsed === 'object' && 'options' in parsed ? parsed.options : null;
 const candidates = Array.isArray(parsed) ? parsed : Array.isArray(optionsField) ? optionsField : null;
 if (candidates === null) return { ok: false, reason: 'malformed-option-set' };
 if (candidates.length < 2) return { ok: false, reason: 'fewer-than-2-options' };
 if (candidates.length > 3) return { ok: false, reason: 'more-than-3-options' };

 const declined = new Set(opts.declined.map((d) => normalizeOption(d)));
 const survivors: { text: string; cites: string[] }[] = [];
 for (const raw of candidates) {
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: 'option-without-text' };
  if (!('text' in raw)) return { ok: false, reason: 'option-without-text' };
  const text = raw.text;
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'option-without-text' };
  if (!('cites' in raw)) return { ok: false, reason: 'option-citing-nothing' };
  const cites = raw.cites;
  if (!Array.isArray(cites) || cites.length === 0) return { ok: false, reason: 'option-citing-nothing' };
  if (declined.has(normalizeOption(text))) continue; // dropped, never re-offered (Q-77)
  const ids: string[] = [];
  for (const c of cites) {
   if (typeof c !== 'string' || !opts.claimExists(c)) return { ok: false, reason: 'unresolvable-cite' };
   ids.push(c);
  }
  survivors.push({ text, cites: ids });
 }
 if (survivors.length < 2) return { ok: false, reason: 'declined-option' };
 return { ok: true, options: survivors.map((s, i) => ({ id: `opt-${i + 1}`, text: s.text, cites: s.cites })) };
}
