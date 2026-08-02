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

/** What the harvester read back from a sitting, or the fact that it could not. */
function harvestProposed(f: Fields): string {
 if (f.parsed === 'false') return 'could not read the sitting back, so proposed nothing';
 return `proposed ${count(num(f, 'proposals'), 'snippet')} and ${count(num(f, 'buds'), 'bud')}`;
}

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
};

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
