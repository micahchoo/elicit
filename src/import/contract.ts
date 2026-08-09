/**
 * The record contract for the import pipeline. Types only — no logic, no
 * imports from the rest of `src/import/`. Every stage (scan, store, extract,
 * commit, the routes, the review surface) writes and reads the same on-disk
 * shape, so the disagreement that would surface as a lost snippet is instead
 * a type error here.
 */

export type ImportStatus =
 /** Scanned and identified. No model has seen it. Nothing is in the corpus. */
 | 'pending'
 /** Cuts proposed and written back. Waiting for a person to read it. */
 | 'extracted'
 /** Reviewed and committed as a dated sitting. Terminal. */
 | 'accepted'
 /** Refused whole by the reader, with a reason (Q-51). Terminal. */
 | 'excluded'
 /** Extraction failed `attempts` times. Sorts to the back; never silently retried forever. */
 | 'failed'
 /** The source file changed after scanning. Terminal — the new body is a NEW item (Q-59). */
 | 'stale';

export type RefusalReason =
 | 'no-frontmatter' // no YAML block at all
 | 'no-date' // Q-57: never guessed, never mtime
 | 'unparsable-date' // present but not a date we can read
 | 'empty-body' // frontmatter only — nothing of the person's prose
 /**
  * A changed file whose source path already has an accepted record, with no
  * frontmatter `lastmod` to date the second sitting (Q-59). Distinct from
  * 'no-date' because the file HAS a date — reusing the first sitting's date
  * is what is refused, and a reader told "no date in its frontmatter" would
  * go looking for a field that is sitting right there.
  */
 | 'no-lastmod'
 /** The declared filename pattern does not match this name (Q-67). */
 | 'no-date-in-name';

/** One scanned source file, frontmatter stripped. The ONE canonical
 * shape — scan.ts produces it, store.ts admits it (the old store copy and
 * the "scan.js does not exist yet" interdiction were deleted in Phase 8). */
export type ScannedItem = {
  hash: string;
  sourcePath: string;
  date: string;
  lastmod?: string;
  title?: string;
  /** The body, frontmatter stripped. What the reviewer will read whole. */
  body: string;
};

export type ImportCut = {
 text: string;
 /** Offset of `text` in the SOURCE BODY. Earliest occurrence wins (ticket 024's rule). */
 at: number;
 facet: string;
 stance: string;
 reading: string;
};

export type ImportRecord = {
 /**
  * sha256 of the source BODY, first 12 hex chars. Identity under Q-59.
  *
  * The body and not the whole file, for two reasons. Frontmatter is not the
  * person's prose (ruled 2026-08-02), so it cannot be part of that prose's
  * identity; and measured on the real corpus, 6 of 47 files share
  * `lastmod: 2026-02-22` from one site-wide touch — hashing frontmatter
  * would make a generator's timestamp bump look like a new document and
  * mint six duplicate sittings.
  */
 hash: string;
 sourcePath: string;
 /**
  * The region this item was admitted under (Q-68). Absent on the 19 records
  * adopted from the one-off run and on anything admitted before Seeding —
  * absent means "no region", never "the default region", and an absent value
  * must never match a region filter.
  */
 region?: string;
 /**
  * The sitting date, ISO day, decided once at admit time and never
  * recomputed: frontmatter `date` for a source path seen for the first time,
  * frontmatter `lastmod` for a source path that already has an accepted
  * record (Q-59's second sitting). Never inferred, never an mtime.
  */
 date: string;
 lastmod?: string;
 title?: string;
 status: ImportStatus;
 attempts: number;
 /** Present once extraction has run. */
 cuts?: ImportCut[];
 /** Present on 'accepted'. The session id of the sitting this became. */
 sessionId?: string;
 /**
  * Present on 'accepted'. The exact texts written as Snippets — approvals as
  * proposed, trims as trimmed. Q-59 dedupe reads this: a later import of the
  * same source path does not re-propose what was already kept, so an edited
  * post offers only what is new.
  */
 kept?: string[];
 /** Required on 'excluded'. The reader's words for why. */
 excludeReason?: string;
 /** Present on 'failed'. */
 failure?: string;
};

/**
 * One decision on one proposed cut. The three verbs are properties of a cut;
 * the piece-level refusal is NOT a fourth verb — it is a property of the item
 * and lives on the record as `excludeReason`.
 *
 * `restate` is absent from `action` BY CONSTRUCTION (Q-58): you cannot restate
 * a 2018 essay without producing prose from today wearing an eight-year-old
 * date, which would corrupt Q-50 independence at the root. It is not a runtime
 * check that can be relaxed; the type has no such member.
 */
export type ImportDecision = {
/** Index into the record's `cuts`. */
cut: number;
action: 'approve' | 'trim' | 'discard';
/** Required for 'trim'; must be a substring of the cut's text. */
text?: string;
};

/**
 * The three decision verbs at runtime — the array mirror of
 * `ImportDecision.action` above, so the review route's rejection and the
 * type can never drift. `restate` is absent here for the same reason it is
 * absent from the type (Q-58, documented above): the array IS the type's
 * runtime face, not a second opinion.
 */
export const IMPORT_ACTIONS = ['approve', 'trim', 'discard'] as const;

/**
 * A passage the PERSON chose (ruled 2026-08-04): the review surface lets the
 * reader keep a passage the harvester did not propose — including on a piece
 * where it proposed nothing. Plain verbatim text, held to exactly the gates a
 * model cut passes (exact substring of the source body, never inside a
 * quotation). It writes a Snippet and NO Reading: readings carry the model's
 * labels, and nothing invents labels for a passage only the person chose.
 */
export type ImportAddition = string;

/**
 * Who wrote the prose in a region, DECLARED by the person at Reach time and
 * never detected (Q-70; detection is banned permanently by 046).
 *
 * `authored` is the only value that may carry `stance: 'avowal'`. A vault holds
 * pasted model output and clipped quotes at scale, and a sentence the person
 * kept but did not write evidences the KEEPING, not the holding.
 */
export type Authorship = 'authored' | 'other' | 'machine-assisted';

/**
 * The three authorship values at runtime — the array mirror of
 * `Authorship` above, so the region route's rejection and the type can
 * never drift (the same pattern as `IMPORT_ACTIONS`).
 */
export const AUTHORS: readonly Authorship[] = ['authored', 'other', 'machine-assisted'];

/**
 * The one mechanical rule that dates every file in a region (Q-67, amending
 * Q-57 for undated corpora). Declared once, at Reach. What Q-57 bans is the
 * GUESS — mtime above all, a lie for anything ever copied. A date typed into a
 * filename is a declaration the person made at the time, the same epistemic
 * class as frontmatter.
 */
export type DatingRule =
 | { kind: 'frontmatter'; key: string }
 /** A template over `YYYY`, `MM`, `DD`; every other character is literal. */
 | { kind: 'filename'; pattern: string };

export type RegionRecord = {
 /** Derived from the path; stable across restarts. See `region.ts#slugFor`. */
 slug: string;
 /** Absolute path to the subtree root. A region IS a folder subtree (Q-68). */
 root: string;
 dating: DatingRule;
 authorship: Authorship;
 declared: string;
};
