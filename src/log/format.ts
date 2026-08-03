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

/**
 * One sentence per commit refusal reason (T7). `import-commit-refused`
 * renders them. All three are verification failures — the item was refused
 * whole and nothing was written — so each sentence ends in the same
 * consequence and differs in the reason, which is the point.
 */
const COMMIT_REFUSED: Record<string, string> = {
 stale: 'a file changed since it was read — nothing was saved',
 'not-extracted': 'nothing had been extracted — nothing was saved',
 unverifiable: 'a cut could not be verified against the source — nothing was saved',
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
 // Neither the sitting's started nor the snippet's captured parses as a
 // date — the snippet can be neither old nor fresh, so it is set aside in
 // neither direction (seeding Task 5). The count is the whole story; the
 // ids stay off the surface.
 'still-true-undateable': (_f, d) =>
  `set aside ${count(nth(d, 0), 'snippet')} whose writing time nothing says`,
 'expedition-minted': () => 'minted an expedition from an earlier snippet',
 'expedition-failed': () => 'could not mint an expedition',
 'expired': (_f, d) => `expired ${count(nth(d, 0), 'question')}`,
 'consolidated': (_f, d) => `summarized ${count(nth(d, 0), 'sitting')}`,
 'consolidation-failed': () => 'could not summarize the sittings',
 'referent-annotated': (f) => `annotated ${count(num(f, 'annotated'), 'referent')}, ${num(f, 'silent')} stayed silent, ${count(num(f, 'failed'), 'failure')}`,
 'referent-annotation-failed': () => 'could not annotate a referent',
 'referent-annotations-failed': () => 'could not run the referent annotation job',
 'gap-fill-minted': (f) => `minted ${count(num(f, 'minted'), 'gap-fill question')} into the queue`,
 'gap-fill-clipped': (f, d) => `enforced the gap-fill cap at ${f.cap ?? 'its setting'} and clipped: ${clause(d, 'clipped')}`,
 'gap-fill-failed': () => 'could not run the gap-fill sweep',
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
 'harvest-started': (f) => `started a background harvest of ${count(num(f, 'chunks'), 'turn')}`,
 // A failed harvest is either every chunk failing to parse (the parsed=false
 // harvestProposed line, distinct from proposed-zero by the 034 rule) or the
 // propose run itself throwing, which carries only the session id.
 'harvest-failed': (f) => (f.parsed === 'false' ? harvestProposed(f) : 'could not finish the harvest'),
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

 // ── The elicitor's floor beyond the queue's ladder (ticket 079) ──

 // The guard rejected the model's question twice and both fallback channels
 // came back empty, so the protocol's own fixed probe was served instead of
 // the twice-rejected text. `verdict` is the guard that bit; `queue=0 bank=0`
 // are the empty pools — "nothing was left to draw" is their legible form.
 'guard-floor': (f) => {
  const verdict = (f.verdict ?? 'guard').replace(/-/g, ' ');
  const protocol = f.protocol ?? 'the protocol';
  return `after the ${verdict} guard rejected twice and nothing was left to ` +
   `draw, asked the ${protocol} protocol's own fixed question`;
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
 'wiki-job-skipped': (f) => {
  const job = (f.job ?? 'a step').replace(/-/g, ' ');
  return f.reason === 'index-current'
   ? `skipped the ${job}: the index is already current`
   : `skipped the ${job}: nothing has changed since the last docket commit`;
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
// The lint path's Q-54 tail (ticket 060): an answered discriminating question
// routed to two SUPERSEDEs, each with a narrowed Range.
'range-discriminated': () =>
  'drew the boundary between two claims: each was superseded with a narrowed range',
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

// Emitted by the region-wired scan route (seeding Task 12): the rule and
// the count, never a file's path or content — the rule is the decision, and
// the person chose it; the per-file refusal list already comes back from the
// scan route whole. The sentence lands ahead of its emitter, so it stays out
// of the EMITTED samples until that route exists.
'import-refused-by-rule': (f) =>
 `refused ${count(num(f, 'count'), 'file')} by the declared rule ${f.rule ?? '…'}`,

// Emitted by the survey (seeding Task 4), written by writeSurvey. The
// detail carries the whole-tree counts and the root the person typed —
// `root=/vault/notes files=6 harvested=4 unread=2` — and the sentence
// shows the counts only: never a path from inside the vault beyond that
// root. Unread is what Reach may still offer; refused is decided and out.
'import-surveyed': (f, d) => {
 const files = f.files === undefined ? nth(d, 0) : num(f, 'files');
 const harvested = f.harvested === undefined ? nth(d, 1) : num(f, 'harvested');
 const unread = f.unread === undefined ? nth(d, 2) : num(f, 'unread');
 return `surveyed the folder: ${count(files, 'file')}, ${harvested} harvested, ${unread} unread`;
},

// Emitted by the adoption step (T8): the one-off script's nineteen keeps and
// twenty-eight refusals folded into the staging store. Bare words after the
// fields are the names that did not resolve — `unresolved=1 jingle-tales`.
'import-adopted': (f, d) => {
 const accepted = f.accepted === undefined ? nth(d, 0) : num(f, 'accepted');
 const excluded = f.excluded === undefined ? nth(d, 1) : num(f, 'excluded');
 const unresolved = f.unresolved === undefined ? nth(d, 2) : num(f, 'unresolved');
 const base = `adopted ${count(accepted, 'prior keep')} and ${count(excluded, 'prior refusal')}`;
 if (unresolved === 0) return `${base}, nothing left unresolved`;
 const names = d.replace(FIELD, ' ').trim().split(/\s+/).filter(Boolean).join(', ');
 return `${base}; ${count(unresolved, 'name')} unresolved — ${names}`;
},

// Emitted by the extraction job (T5), one line per item processed. The detail
// carries the full path and the counts — `path=…/dated-essay.md cuts=3` — and
// this surface shows the basename only, never the path (same rule as
// `import-refused`).
'import-extracted': (f, d) => {
 const file = (f.path ?? d).split('/').pop() || 'a file';
 return `extracted ${count(num(f, 'cuts'), 'cut')} from ${file}`;
},
// The item failed its attempts and sorts to the back (T5). `attempts` is the
// counter that reached the threshold — the reader should see how long it
// stood at the door; the error message itself lives on the record.
'import-extract-failed': (f, d) => {
 const file = (f.path ?? d).split('/').pop() || 'a file';
 return `could not extract from ${file} after ${count(num(f, 'attempts'), 'attempt')}`;
},
// The raw-source Q-51 check (T5): a cut inside a quotation that only the raw
// file shows, `clean` having removed the opening mark from inside the
// paragraph. `cuts` is how many were set aside for this item.
'import-quoted-dropped': (f, d) => {
 const file = (f.path ?? d).split('/').pop() || 'a file';
 return `set aside ${count(num(f, 'cuts'), 'cut')} from ${file}: it sits inside a quotation in the source file`;
},
// Emitted by the exclude route (T9) when the reader refuses a piece whole.
// The reason lives on the record, never in this line — the log names the
// file and the act, not the person's words.
'import-excluded': (f, d) => {
 const file = (f.path ?? d).split('/').pop() || 'a file';
 return `${file} refused whole, with the reason recorded`;
},

// Emitted by commit (T7), one line per item that passed every gate. The
// detail carries the path, session, count and date — `path=…/dated-essay.md
// session=import-abc123 snippets=2 date=2018-09-01` — and the date is the
// point (Q-50): one accepted piece became one sitting dated to the day it
// was written, which is the only independence evidence the import carries.
'import-committed': (f, d) => {
 const file = (f.path ?? d).split('/').pop() || 'a file';
 return `saved ${count(num(f, 'snippets'), 'piece')} from ${file} as one sitting dated ${f.date ?? 'its source date'}`;
},
// Emitted by commit (T7) when an item fails a verification gate: the whole
// item is refused and nothing is written. One sentence per reason (the
// reason is the point, same rule as `import-refused`); the detail carries
// `reason=…` and the hash.
'import-commit-refused': (f, d) => {
 const reason = f.reason ?? d.split(/\s+/).pop() ?? 'unverifiable';
 return COMMIT_REFUSED[reason] ?? 'nothing was saved';
},

// The docket's import job (T6): one line per run, the three counts. The
// extraction is the harvest path run ahead of review, so the sentence says
// what moved and what is still to be read rather than naming files.
'import-run': (f) => {
 const base = `read ${count(num(f, 'extracted'), 'piece')} ahead of review; ${count(num(f, 'remaining'), 'piece')} still being read`;
 const failed = num(f, 'failed');
 return failed === 0 ? base : `${base}, ${count(failed, 'piece')} failing`;
},
// The import job itself threw (T6): guarded like every other job, so the
// rest of the run is already on disk and only the extraction is missing.
'import-run-failed': () => 'the import extraction could not finish this run — the rest of the docket work is already on disk',

// ── The surfaced usage stamp (015) ──

// One line per surfacing act: a claim or snippet reached the person on a
// surface that counts as usage. The refs are the record — the aggregation
// ticket 015 waits on reads them — so the sentence names the surface and
// nothing else.
'surfaced': (f) => {
 if (f.surface === 'draw') return 'surfaced an old snippet in a randomizer draw';
 if (f.surface === 'wiki') return 'surfaced a claim with its cited snippets on the wiki reading surface';
 if (f.surface === 'composed-question') return 'surfaced a snippet quoted in a composed question';
 return 'surfaced a claim or snippet';
},

// ── The piece routes (T6): compose, gap, set down, export ──

'piece-started': (f) => `started a piece from ${count(num(f, 'snippets'), 'snippet')}`,
'piece-prose-kept': (f) =>
 `kept a paragraph written in a piece (${count(num(f, 'chars'), 'character')})`,
'gap-inserted': () => 'inserted a gap into a piece',
'gap-question-minted': (f) =>
 `minted the gap's question (${count(num(f, 'chars'), 'character')}) into the queue`,
'gap-cleared': () => 'cleared a gap by pinning its answer into the piece',
'piece-exported': (f) =>
 `exported a piece with ${count(num(f, 'paragraphs'), 'paragraph')}`,
'piece-set-down': () => 'set the piece down',
'piece-picked-up': () => 'picked the piece up again',
// The two docket piece jobs (010 T10): the stale-pin sweep flags, never
// re-pins (Q-39); auto-set-down is silent (Q-22), logged (Q-23), and
// reversible — and the sentence carries no reproach, no count of days and
// nothing owed (Q-24). piece-jobs-failed guards both, so a failure in one
// never stops the other or the rest of the run.
'stale-pin-flagged': (f) => `flagged ${count(num(f, 'flagged'), 'stale pin')}`,
'piece-set-down-auto': () => 'set the piece down after a long quiet',
'piece-jobs-failed': () => 'could not finish the piece work this run — the rest of the docket work is already on disk',

// ── The candidate arrangements (T11): the one model call in the slice ──

// Emitted once per propose run with the surviving count. Zero is a valid,
// non-exceptional outcome: the person keeps the chronology they already had.
// The detail carries `count=2`; the reader hears it as other orders of the
// SAME material, never new paragraphs.
'arrangements-proposed': (_f, d) =>
 `offered ${count(nth(d, 0), 'other order')} of the same material`,
// Emitted once per drop — a whole candidate refused, or a piece of one (a
// Marginalia or a gap) refused while its candidate survived. The detail
// names the reason and the principle; the rejection rate is the metric that
// says whether the model can do this job at all (T14 reads it).
'arrangement-rejected': (f) =>
 `set one proposed order aside (${f.reason ?? 'a boundary check'})`,
// Emitted when the person takes a candidate arrangement as current (T12).
// The detail carries the principle — the one word the person can use; the
// ids stay in the JSONL where the audit trail belongs.
'arrangement-chosen': (f) =>
 `kept the ${f.principle ?? 'chronology'} order for the piece`,

// ── The sounding slice (plan Task 8): the offer, the gate, the park ──

// The license is an offer, never a verdict (Q-62): every evaluation is a
// record, licensed or not, and the line reports what the four reasons
// found — the record, never a judgment of the person.
 'sounding-license': (f) =>
  `ran the entry license: late ${f.late ?? '?'}, energy ${f.energy ?? '?'}, ` +
  `sustained ${f.sustained ?? '?'}, unoffered ${f.unoffered ?? '?'} — ` +
  (f.licensed === 'true' ? 'licensed' : 'not licensed'),
 'sounding-offered': (f) => `offered a descent of ${num(f, 'rungs')} rungs`,
 'sounding-declined': () => 'the offer of a descent was declined',
 'sounding-entered': (f) => `began a descent of ${num(f, 'rungs')} rungs`,
 'sounding-rung': (f) => `asked rung ${num(f, 'rung')} of ${num(f, 'of')}`,
 'sounding-gate': (f) => `the gate word ${f.choice ?? '?'} was pressed at rung ${num(f, 'rung')}`,
 'sounding-parked': (f) => `parked a descent with ${count(num(f, 'rungs'), 'rung')} kept`,
 'sounding-resumed': () => 'picked a parked descent back up',
 'sounding-ended': (f) => `the descent closed: ${f.endedBy ?? 'a gate word'}`,
// The ladder summary (plan Task 11): one line standing for the rungs a
// compaction drops (T10), written in the background by the clerk model —
// nobody waits on it (Q-48) — and filed in marginalia, never a Snippet
// (Q-8, Q-20, Q-45). The failure kind guards the docket job: a throw is
// one job's failure, and the rest of the run is already on disk. Both
// render the act, never the person.
 'sounding-summarized': () => 'wrote one line about a descent',
 'soundings-summary-failed': () => 'could not summarize a ladder',
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
