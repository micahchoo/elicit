/**
 * The render layer for the Activity Log: one event, one human sentence.
 *
 * The JSONL on disk keeps full identifiers — it is the audit trail. This
 * surface is a page of text, so it never shows one. `scrubIds` enforces that
 * on every path, including the fallback for kinds this file does not know.
 */

/** The shape the Activity Log renders — structural, so the web client can pass its own type. */
export type FormattableEvent = {
 at: string;
 actor: string;
 kind: string;
 detail: string;
 refs?: string[];
};

/** Crockford base32, 26 characters — a ULID as `ulid` mints them. */
const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;

/** Machine fields in a detail line: `session=01K…`, `kept=1`. */
const FIELD = /([A-Za-z][A-Za-z0-9]*)=(\S+)/g;

type Fields = Record<string, string>;

/** Parse the `key=value` pairs of a detail line. */
function fields(detail: string): Fields {
 const out: Fields = {};
 for (const m of detail.matchAll(FIELD)) out[m[1]!] = m[2]!;
 return out;
}

/** The nth bare number in a detail line, or 0 when it is absent. */
function nth(detail: string, index: number): number {
 const nums = detail.match(/\d+/g);
 const raw = nums?.[index];
 return raw === undefined ? 0 : Number(raw);
}

/** A counted noun: `2 openers`, `1 opener`. */
function count(n: number, noun: string): string {
 return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The number of a named field, or 0 when it is absent or not a number. */
function num(f: Fields, key: string): number {
 const raw = f[key];
 const n = raw === undefined ? Number.NaN : Number(raw);
 return Number.isFinite(n) ? n : 0;
}

/** A quoted field: `name="Micah Alex"`. `FIELD` stops at the first space, so this does not. */
function quoted(detail: string, key: string): string | undefined {
 return new RegExp(`${key}="([^"]*)"`).exec(detail)?.[1];
}

/**
 * Everything after `key=` to the end of the line. Several events end in a
 * prose clause the emitter wrote — `would=`, `clipped=` — and a clause with
 * spaces in it is not a field.
 */
function clause(detail: string, key: string): string {
 const at = detail.indexOf(`${key}=`);
 return at === -1 ? '' : detail.slice(at + key.length + 1).trim();
}

/** `a` or `an`, so a facet name reads as English rather than as a slot. */
function article(word: string): string {
 return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** A list in prose: `x`, `x and y`, `x, y and z`. */
function series(items: string[]): string {
 if (items.length <= 1) return items[0] ?? '';
 return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** Remove every identifier and tidy the whitespace it leaves behind. */
function scrubIds(text: string): string {
 return text
  .replace(ULID, '')
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.])/g, '$1')
  .replace(/\s*—\s*$/, '')
  .trim();
}

/** Which question the elicitor drew, in the reader's words. */
function askedFrom(source: string | undefined): string {
 switch (source) {
  case 'bank': return 'asked a question from the bank';
  case 'composed': return 'asked a composed question';
  case 'probe': return 'asked a follow-up probe';
  case 'juxtaposition': return 'asked a juxtaposition';
  case 'close': return 'asked a closing question';
  case 'skip': return 'moved on to the next question';
  default: return 'asked a question';
 }
}

/** A sitting the elicitor just opened: `mode=25m/high protocol=ladder`. */
function sittingStarted(f: Fields): string {
 const mode = /^(\d+)m\/(\w+)$/.exec(f.mode ?? '');
 const opening = mode
  ? `started a ${mode[1]}-minute sitting at ${mode[2]} energy`
  : 'started a sitting';
 return f.protocol ? `${opening} using the ${f.protocol} protocol` : opening;
}

/**
 * What the harvester held as Buds instead of dropping (ticket 037). A cut
 * lifted mid-sentence and a cut wearing a label the vocabulary does not contain
 * are both the model's mistake made over the person's words, so the words stay.
 */
function heldAsBuds(f: Fields): string {
 const mid = num(f, 'fragmentBuds');
 const oov = num(f, 'outOfVocabularyLabels');
 if (mid === 0 && oov === 0) {
  return 'no cut was lifted mid-sentence and no label fell outside the vocabulary';
 }
 const parts: string[] = [];
 if (mid > 0) parts.push(`${count(mid, 'cut')} lifted mid-sentence`);
 if (oov > 0) parts.push(`${count(oov, 'label')} outside the vocabulary`);
 return `held ${series(parts)} as ${mid + oov === 1 ? 'a bud' : 'buds'}`;
}

/**
 * The two structural overrides on what the model called a cut. `superseded` is
 * corrected because the marker PROVES the stance; a marker-less `intention` is
 * only counted, because the marker proves the label wrong and says nothing
 * about which of the seven other facets is right.
 */
function labelChecks(f: Fields): string {
 const superseded = num(f, 'supersessionCorrections');
 const unmarked = num(f, 'unmarkedIntentions');
 const corrected = superseded === 0
  ? 'corrected no stance to superseded'
  : `corrected ${count(superseded, 'stance')} to superseded`;
 const intentions = unmarked === 0
  ? 'found no intention label without a want, plan or goal'
  : `found ${count(unmarked, 'cut')} labelled intention with no want, plan or goal in the words`;
 return `${corrected} and ${intentions}`;
}

/**
 * The episode shadow record (Q-35), and the reason the line states it even when
 * nothing fired: ticket 037's fix took `episode` from 6% of cuts to 30%, on
 * twelve turns of one person's writing, and whether that holds on new prose is
 * exactly what these two numbers answer. A sitting with no dated turn measured
 * nothing, and must not read like a sitting where every dated turn was caught.
 */
function episodeRecord(f: Fields): string {
 const anchored = num(f, 'episodeAnchoredTurns');
 const blind = num(f, 'episodeBlindTurns');
 if (anchored === 0) return 'no turn named when something happened, so none owed an episode cut';
 const named = `${count(anchored, 'turn')} named when something happened`;
 return blind === 0
  ? `${named}, and every one produced an episode cut`
  : `${named}, and ${blind} produced no episode cut`;
}

/**
 * The 044 admissibility gate's own counter, and the evidence by which its
 * inertness would have been legible from the first sitting (ticket 069).
 * `inadmissibleDrops=0`, every run, forever, in plain sight — instead of
 * needing 295 hand-marked cuts and a dedicated measurement run to discover.
 *
 * The gate sentence is the most legible of the three new counters: it states
 * how many cuts were read and how many the gate rejected, so a gate rejecting
 * nothing is visible in one line without a special harvest.
 */
function admissibilityGate(f: Fields): string {
 const seen = num(f, 'cutsSeen');
 const dropped = num(f, 'inadmissibleDrops');
 const skipped = num(f, 'contentFreeSkips');

 if (seen === 0) {
  const gate = 'the gate saw no cuts';
  if (skipped === 0) return `${gate}; no turn was too thin to harvest`;
  return `${gate}; skipped ${count(skipped, 'turn')} that had no content`;
 }

 const gate = dropped === 0
  ? `the gate read ${count(seen, 'cut')} and rejected none`
  : `the gate read ${count(seen, 'cut')} and rejected ${dropped}`;

 const skips = skipped === 0
  ? 'no turn was too thin to harvest'
  : `skipped ${count(skipped, 'turn')} that had no content`;

 return `${gate}; ${skips}`;
}

/**
 * What the harvester read back from a sitting, or the fact that it could not.
 *
 * The counts come first, because they are what the reader asked. The clauses
 * after them are ticket 037's diagnostics, which reached nobody until ticket
 * 066, and ticket 069's admissibility gate which would have surfaced the 044
 * gate's inertness from day one. Each clause states its number whether or not
 * the check fired: a check that renders as silence at zero cannot be told
 * apart from a check that is not running.
 */
function harvestProposed(f: Fields): string {
 if (f.parsed === 'false') return 'could not read the sitting back, so proposed nothing';
 const counts = `proposed ${count(num(f, 'proposals'), 'snippet')} and ${count(num(f, 'buds'), 'bud')}`;
 // Every harvest logged before ticket 066 carries none of these fields, and
 // `num` reads an absent field as 0. Absent is NOT zero here: rendering an old
 // line as "no cut was lifted mid-sentence" would put a measurement nobody made
 // in front of a reader, which is the failure this whole rendering exists to
 // end. A line with no counters in it says only what it knows.
 if (f.episodeAnchoredTurns === undefined) return counts;
 const clauses: string[] = [heldAsBuds(f), labelChecks(f), episodeRecord(f)];
 // The admissibility gate's counters were added in ticket 069, so a line
 // written between 066 and 069 carries the episode record but not the gate.
 // Absent is still not zero: rendering "the gate saw no cuts" on a line that
 // never recorded cutsSeen would assert a measurement nobody made.
 if (f.cutsSeen !== undefined) clauses.push(admissibilityGate(f));
 return [counts, ...clauses].join('; ');
}

/**
 * The queue's draw filters, in the reader's words. The log names them as the
 * code does — `modeNeeds`, `sharpness` — and a field name is not English.
 */
const CONSTRAINTS: Record<string, string> = {
 'facet-balance': 'the balance of facets',
 'status': 'the check for an unanswered question',
 'modeNeeds': 'what this sitting has time and energy for',
 'sharpness': 'the sharpness this sitting allows',
 'horizon': 'how far off a question looks',
 'target': 'what this sitting is for',
};

/** One or more filter names, comma-joined by the emitter, read back as prose. */
function constraints(raw: string | undefined): string {
 const names = (raw ?? '').split(',').filter((n) => n !== '' && n !== 'none');
 const words = names.map((n) => CONSTRAINTS[n] ?? n.replace(/[-_]/g, ' '));
 return words.length === 0 ? 'a filter' : series(words);
}

/** A Facet as a word: `causal-theory` is a hyphenated slug on a reading surface. */
function facetWord(raw: string | undefined): string {
 return raw === undefined || raw === 'none' ? 'untagged' : raw.replace(/-/g, ' ');
}

/**
 * The facet-balance shadow record (Q-35): whether the filter would have drawn
 * a different question, and how far it narrowed the pool to get there. The
 * numbers ARE the record — this is the evidence the filter graduates on.
 */
function facetBalance(f: Fields, live: boolean): string {
 const pool = num(f, 'pool');
 if (f.applied !== 'true') {
  return `left all ${count(pool, 'candidate')} in the draw — balancing by facet narrowed nothing`;
 }
 const narrowed = `${num(f, 'kept')} of ${pool} candidates carry a facet the vault is short on`;
 if (f.diverged !== 'true') {
  return `${live ? 'picked' : 'would have picked'} the same question — ${narrowed}`;
 }
 const would = facetWord(f.wouldFacet);
 const open = facetWord(f.openFacet);
 return `${live ? 'asked' : 'would have asked'} ${article(would)} ${would} question ` +
  `instead of ${article(open)} ${open} one — ${narrowed}`;
}

/** A rejection code — `cite-does-not-resolve:01K…` — as the phrase it stands for. */
function rejection(raw: string | undefined): string {
 const code = (raw ?? '').split(':')[0] ?? '';
 return code === '' ? 'it did not pass validation' : code.replace(/-/g, ' ');
}

/** `channels=lexical:5,referent:4` — which channel found how many. */
function channels(raw: string | undefined): string {
 if (raw === undefined || raw === '(none)') return '';
 const parts = raw.split(',').filter((p) => p !== '').map((p) => p.replace(':', ' '));
 return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

/**
 * One sentence per refusal reason (Q-57). `import-refused` renders them, so a
 * reader is told WHY a file did not come in, not just that it did not — a
 * wrong reason is worse than a bare count, because it sends the reader looking
 * for a field that is already there (standing rule 3).
 */
const IMPORT_REFUSED: Record<string, string> = {
 'no-frontmatter': 'has no frontmatter — not imported',
 'no-date': 'has no date in its frontmatter — not imported',
 'unparsable-date': 'has a date that could not be read — not imported',
 'empty-body': 'is frontmatter and nothing else — not imported',
 'no-lastmod': 'changed since it was imported, and has no lastmod to date the new version — not imported',
};

/** One sentence per kind. Every emitted kind has an entry; unknown kinds fall through. */
const SENTENCES: Record<string, (f: Fields, detail: string) => string> = {
 'run-started': () => 'started a docket run',
 'index-rebuilt': (_f, d) => `rebuilt the index from ${count(nth(d, 0), 'snippet')}`,
 'docket-run': (_f, d) => `ran the docket: minted ${count(nth(d, 0), 'question')}, expired ${nth(d, 1)}`,
 'docket-run-failed': () => 'could not finish the docket run',
 'opener-minted': (_f, d) => `minted ${count(nth(d, 0), 'opener')}`,
 'opener-failed': () => 'could not mint an opener',
 'still-true-minted': (_f, d) => `minted ${count(nth(d, 0), 'still-true question')}`,
 'still-true-failed': () => 'could not mint a still-true question',
 'expedition-minted': () => 'minted an expedition from an earlier snippet',
 'expedition-failed': () => 'could not mint an expedition',
 'expired': (_f, d) => `expired ${count(nth(d, 0), 'question')}`,
 'consolidated': (_f, d) => `summarized ${count(nth(d, 0), 'sitting')}`,
 'consolidation-failed': () => 'could not summarize the sittings',
 'session-started': (f) => sittingStarted(f),
 'close-phase-entered': () => 'entered the closing phase',
 'question-asked': (f) => askedFrom(f.source),
 'juxtaposition-offered': () => 'offered a juxtaposition against an earlier snippet',
 'question-deferred': (f) => {
  if (f.needs === 'time') return 'deferred a question until you have more time';
  if (f.needs === 'energy') return 'deferred a question until you have more energy';
  return 'deferred a question';
 },
 'harvest-proposed': (f) => harvestProposed(f),
 'session-harvested': (f) => `kept ${num(f, 'kept')}, budded ${num(f, 'budded')}`,
 'transcribed': (_f, d) => {
  const chars = /(\d+)chars/.exec(d);
  return `transcribed ${count(chars ? Number(chars[1]) : 0, 'character')} of speech`;
 },
 'unprompted-entry': (f) => `wrote ${count(num(f, 'chars'), 'character')} unprompted`,

 // ── The queue's degradation ladder (Q-55) ──

 'queue-rung': (f) =>
  `relaxed ${constraints(f.relaxed)} and recovered ${count(num(f, 'after'), 'question')}`,
 'queue-floor': (f) => {
  const emptiedBy = f.emptiedBy;
  if (emptiedBy === undefined || emptiedBy === 'none') {
   return 'found nothing in the queue, so composed a fresh question';
  }
  return `composed a fresh question: none of the ${num(f, 'pool')} in the queue ` +
   `got past ${constraints(emptiedBy)}`;
 },

 // ── The facet-balance filter, shadow and live (Q-35) ──

 'facet-balance-shadow': (f) => facetBalance(f, false),
 'facet-balance-applied': (f) => facetBalance(f, true),

 // ── The Randomizer: shuffle, never invent (Q-18, Q-16) ──

 'randomizer-license': (f) => {
  const asked = f.invokedBy === 'user';
  const days = Math.round(num(f, 'days'));
  if (f.grounds === 'dry-spell') {
   return `${asked ? 'you asked to shuffle; ' : ''}nothing has been answered for ` +
    `${count(days, 'day')}`;
  }
  if (f.grounds === 'stale-region') {
   const region = facetWord(f.region);
   return `${asked ? 'you asked to shuffle; ' : ''}no ${region} question has been ` +
    `answered for ${count(days, 'day')}`;
  }
  return asked ? 'you asked to shuffle' : 'found no coverage reason to offer a shuffle';
 },
 // `pool` and `cooldown` carry the whole record: without them "0 and 0 were
 // available" cannot tell an empty vault from one whose every card was drawn
 // last week, and a draw cannot say how much it had to choose between.
 'randomizer-drawn': (f) => {
  if (f.channel === 'resurfacing') {
   return `brought back something you wrote on ${f.wrote ?? 'an earlier day'}, ` +
    `one of ${num(f, 'pool')} in the ${f.stratum ?? 'sampled'} band`;
  }
  return `dealt a card from the ${f.deck ?? 'shuffled'} deck, one of ${num(f, 'pool')}`;
 },
 'randomizer-empty': (f) => {
  const resting = num(f, 'cooldown');
  const had = `had nothing left to shuffle: ${num(f, 'decks')} deck cards and ` +
   `${count(num(f, 'snippets'), 'snippet')} were available`;
  return resting === 0 ? had : `${had}, with ${resting} drawn too recently`;
 },

 // ── The wiki: thresholds, the registry, claims (Q-35, Q-56) ──

 // The wiki run's own failures carry ids and an exception message, never a
 // number. The reader gets the step that stopped; the JSONL keeps the rest.
 'wiki-jobs-failed': (f) => {
  if (f.job === 'lock') return 'did not start a wiki run: one was already in progress';
  const job = (f.job ?? '').replace(/-/g, ' ');
  return job === '' ? 'could not finish a step of the wiki run' : `could not finish the ${job} step of the wiki run`;
 },
 'mint-oversized': () => 'set a reading aside: it did not fit the payload budget',
 'mint-parse-failed': () => "could not read the model's claim proposal back",
 'mint-empty': () => 'read a reading cleanly and proposed no change to the wiki',
 'mint-call-failed': () => 'could not ask the model about a reading',
 'shadow-decision': (f, d) =>
  `did not act on ${f.threshold ?? 'a threshold'}, set to ${f.value ?? 'nothing'} — ` +
  `it would ${clause(d, 'would')}`,
 'threshold-clipped': (f, d) =>
  `enforced ${f.threshold ?? 'a threshold'} at ${f.value ?? 'its setting'} and clipped: ` +
  `${clause(d, 'clipped')}`,
 'lint-threshold-unhonored': (f, d) => {
  const why = clause(d, 'value').replace(/^\S+\s*/, '');
  const head = `could not honour ${f.threshold ?? 'a threshold'}, set to ${f.value ?? 'nothing'}`;
  return why === '' ? head : `${head}: ${why}`;
 },
 'claim-status-changed': (f, d) => {
  const dash = d.indexOf('—');
  const why = dash === -1 ? '' : d.slice(dash + 1).trim();
  const moved = `moved a claim from ${f.from ?? 'nothing'} to ${f.to ?? 'nothing'}`;
  return why === '' ? moved : `${moved}: ${why}`;
 },
 'claim-op-rejected': (f) => `rejected an edit to the wiki: ${rejection(f.reason)}`,
 'referent-minted': (f, d) => {
  const name = quoted(d, 'name') ?? f.slug ?? 'a name';
  const kind = f.kind ?? 'referent';
  return `added ${name} to the registry as ${article(kind)} ${kind}`;
 },
 'referent-aliased': (f, d) =>
  `recorded "${quoted(d, 'alias') ?? 'another name'}" as another name for ${f.slug ?? 'an entry'}`,
 'referent-kind-differs': (f) => {
  const stored = f.stored ?? 'referent';
  const proposed = f.proposed ?? 'something else';
  return `left ${f.slug ?? 'an entry'} recorded as ${article(stored)} ${stored}, ` +
   `though it was proposed as ${article(proposed)} ${proposed}`;
 },
 'referent-alias-refused': (f) =>
  `refused to fold ${f.existing ?? 'one entry'} into ${f.aliasOf ?? 'another'}: ` +
  'both are already entries, and only you can say they name the same thing',
 'referent-alias-unresolved': (f, d) =>
  `kept "${quoted(d, 'name') ?? 'a name'}" as its own entry: ` +
  `nothing in the registry is called "${quoted(d, 'aliasOf') ?? ''}"`,

 // ── The contradiction channels (Q-52, Q-56) ──

 'clash-referent-clipped': (f) =>
  `compared ${num(f, 'cap')} of ${count(num(f, 'claims'), 'claim')} about ` +
  `${f.referent ?? 'one referent'} and set ${num(f, 'clipped')} aside`,
 'clash-embedding-clipped': (f) => {
  if (f.reason === 'window') {
   return `compared ${num(f, 'window')} of ${count(num(f, 'claims'), 'claim')} ` +
    `and set ${num(f, 'clipped')} aside`;
  }
  return `stopped embedding at a budget of ${num(f, 'budgetMs')}ms: ` +
   `${num(f, 'embedded')} done, ${num(f, 'pending')} still waiting`;
 },
 'embedding-unavailable': (f) =>
  `could not reach ${f.model ?? 'the embedding model'}: ` +
  `${num(f, 'embedded')} claims embedded, ${num(f, 'pending')} still waiting`,
 'clash-checked': (f) =>
  `found ${count(num(f, 'pool'), 'pair')} that might contradict${channels(f.channels)}, ` +
  `suppressed ${num(f, 'suppressed')}, reproposed ${num(f, 'reproposed')}`,
 // Emitted when a Contradiction opens — the most consequential wiki act.
 // The type is the closed contract term; ids are in refs.
 'contradiction-opened': (f) =>
  `opened ${article(f.type ?? 'synchronic')} ${f.type ?? 'synchronic'} Contradiction`,
 // A wiki run's counters on one log line — the evidence T16 reads from.
 'wiki-run': (f) => {
  const swept = num(f, 'swept');
  const applied = num(f, 'applied');
  const rejected = num(f, 'rejected');
  const unproc = num(f, 'unprocessed');
  const over = num(f, 'oversized');
  const stuck = num(f, 'stuck');
  const judged = num(f, 'oppositionJudged');
  const opposed = num(f, 'oppositionOpposed');
  const minted = num(f, 'remeasuresMinted');
  const expired = num(f, 'remeasuresExpired');
  const opened = num(f, 'contradictionsOpened');
  const dissolved = num(f, 'candidatesDissolved');
  const aside: string[] = [];
  if (unproc > 0) aside.push(`${unproc} unprocessed`);
  if (over > 0) aside.push(`${over} oversized`);
  if (stuck > 0) aside.push(`${stuck} stuck`);
  const asideClause = aside.length > 0 ? `; ${aside.join(', ')} set aside` : '';
  const oppPhrase = opposed === 0 ? 'none opposed' : `${opposed} opposed`;
  return `swept ${count(swept, 'reading')}, applied ${count(applied, 'edit')}, ` +
   `rejected ${count(rejected, 'update')}${asideClause}; ` +
   `judged ${count(judged, 'pair')}, ${oppPhrase}; ` +
   `minted ${count(minted, 're-measure')}, expired ${count(expired, 're-measure')}; ` +
   `opened ${count(opened, 'Contradiction')}, dissolved ${count(dissolved, 'candidate')}`;
 },
 // The live turn path emits this one, as `elicitor` rather than `clerk`. The
 // sentence lands here because `formatEvent` keys on kind alone, so writing it
 // now renders whoever emits it later (S15). A `hits=` field is read when the
 // emitter supplies one; otherwise the first number in the line is the count.
 'resonance-checked': (f, d) =>
  `looked for echoes of what was just said and found ` +
  `${f.hits === undefined ? nth(d, 0) : num(f, 'hits')}`,

// ── The import pipeline: a folder scan, and the refusals that answer it (Q-57) ──

// Emitted by the import routes (T9). `import-scanned` carries three counts —
// `files=47 toImport=45 refused=2`, or the same numbers bare, in order.
'import-scanned': (f, d) => {
 const files = f.files === undefined ? nth(d, 0) : num(f, 'files');
 const toImport = f.toImport === undefined ? nth(d, 1) : num(f, 'toImport');
 const refused = f.refused === undefined ? nth(d, 2) : num(f, 'refused');
 return `read ${count(files, 'file')}: ${toImport} to import, ${refused} refused`;
},

// The detail carries the full path and the reason — `…/undated.md reason=no-date` —
// and this surface shows the basename only, never the path. One sentence per
// reason (the reason is the point), rendered by the one kind.
'import-refused': (f, d) => {
 const reason = f.reason ?? d.split(/\s+/).pop() ?? 'no-date';
 const path = f.file ?? (f.reason === undefined
  ? d.split(/\s+/).slice(0, -1).join(' ')
  : d.slice(0, d.indexOf('reason=')));
 const file = path.trim().split('/').pop() || 'a file';
 const why = IMPORT_REFUSED[reason] ?? 'was not imported';
 return `${file} ${why}`;
},
};

/**
 * Whether this file has a sentence for `kind`, or will fall back to reading the
 * kind aloud as words.
 *
 * Exported for `tests/log-format.test.ts`, which sweeps `src/` for every kind
 * the codebase emits and asserts this returns true for each. That sweep is the
 * enforcement ticket 063 asked for: a kind added without a sentence fails a
 * test instead of reaching the reader as two context-free words.
 */
export function hasSentence(kind: string): boolean {
 return Object.hasOwn(SENTENCES, kind);
}

/**
 * A kind this file does not know yet. Read the kind as words and keep whatever
 * of the detail is prose — machine fields and identifiers go.
 */
function fallback(kind: string, detail: string): string {
 const words = kind.replace(/[-_]/g, ' ').trim() || 'did something';
 const rest = detail.replace(FIELD, ' ').replace(ULID, ' ').replace(/\s+/g, ' ').trim();
 return rest ? `${words} — ${rest}` : words;
}

/** Turn one activity event into one sentence a reader can read. Never returns an identifier. */
export function formatEvent(e: FormattableEvent): string {
 const kind = typeof e.kind === 'string' ? e.kind : '';
 const detail = typeof e.detail === 'string' ? e.detail : '';
 const sentence = SENTENCES[kind];
 return scrubIds(sentence ? sentence(fields(detail), detail) : fallback(kind, detail));
}

/** How long ago the event happened, in the compact form the rest of the page uses. */
export function relativeTime(at: string, now: number = Date.now()): string {
 const then = new Date(at).getTime();
 if (Number.isNaN(then)) return '';
 const mins = Math.floor((now - then) / 60000);
 if (mins < 1) return 'just now';
 if (mins < 60) return `${mins}m ago`;
 const hours = Math.floor(mins / 60);
 if (hours < 24) return `${hours}h ago`;
 return `${Math.floor(hours / 24)}d ago`;
}
