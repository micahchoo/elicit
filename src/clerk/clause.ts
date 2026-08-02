/**
 * A mechanical complete-clause check on a quoted fragment, and the widening
 * that turns a non-clause fragment into the smallest enclosing clause.
 *
 * Ticket 088. The T16 re-measure quoted `worked on making` — an exact
 * substring that passed Q-46's verbatim check and is not a proposition. Q-46
 * stays; the corrective is narrower. The quoted pole must be a complete
 * clause, decided IN CODE, never by a model.
 *
 * Two structural arms, both cheap:
 *
 *   - A finite verb with a reachable subject — the same subject-and-claim
 *     posture `src/harvester/admissibility.ts` uses, applied to the
 *     fragment's own words. The lexicons below are closed tables, the same
 *     style every other structural gate in this tree uses.
 *   - Sentence alignment — a span that coincides with the segmenter's
 *     boundaries IS a clause. The boundary rule is the harvester's own
 *     (`src/harvester/harvester.ts`): `. ! ?` followed by a space and an
 *     uppercase letter, or the end of the text.
 *
 * The widening keeps the verbatim rule intact: the returned span is always
 * an exact substring of the prose it was widened inside, and a fragment that
 * cannot be widened is left exactly as it was — never invented text.
 */

// ---------------------------------------------------------------------------
// Sentence segmentation (the repo's boundary rule, mirrored)
// ---------------------------------------------------------------------------

type Span = { start: number; end: number };

/** `. ! ?` — the boundary characters the harvester's rule keys on. */
const BOUNDARY_CHARS: Record<string, true> = { '.': true, '!': true, '?': true };

/**
 * Sentence spans over `text`, using the harvester's boundary rule:
 * `. ! ?` + space + uppercase letter, or the boundary char at end of text.
 * A trailing period at the very end always closes its sentence.
 */
function splitSentences(text: string): Span[] {
 const out: Span[] = [];
 let start = 0;
 for (let i = 0; i < text.length; i++) {
  const ch = text[i]!;
  if (BOUNDARY_CHARS[ch] !== true) continue;
  const boundary =
   i + 1 >= text.length ||
   (text[i + 1] === ' ' && i + 2 < text.length && /[A-Z]/.test(text[i + 2]!));
  if (!boundary) continue;
  out.push({ start, end: i + 1 });
  start = i + 1;
 }
 if (start < text.length) out.push({ start, end: text.length });
 return out;
}

/**
 * Positions where a clause can begin and end inside one sentence, as offsets
 * relative to the sentence start. A clause ends AT a separator and begins
 * AFTER it; the sentence's own edges are always boundaries.
 */
function clauseBoundaries(sentence: string): { starts: number[]; ends: number[] } {
 const starts = [0];
 const ends = [sentence.length];
 const separators = sentence.matchAll(
  /(;|: |— |-- |\n|,\s*(?:for|and|nor|but|or|yet|so|that|which|who|whom|whose|where|when|while|although|though|because|since|if|unless|until|as|before|after|whereas|whether|once|wherever)\s+)/g
 );
 for (const m of separators) {
  const at = m.index ?? 0;
  ends.push(at);
  starts.push(at + m[0].length);
 }
 return { starts, ends };
}

// ---------------------------------------------------------------------------
// Finite verbs: closed tables + two mechanical suffix rules
// ---------------------------------------------------------------------------

/** Auxiliaries and modals — finite whenever they carry the clause's tense. */
const AUXILIARIES: Record<string, true> = {
 am: true, is: true, are: true, was: true, were: true,
 has: true, have: true, had: true,
 do: true, does: true, did: true,
 will: true, would: true, shall: true, should: true,
 can: true, could: true, may: true, might: true, must: true, ought: true,
};

/**
 * Irregular pasts (including forms shared with the participle — `made`,
 * `kept` — which are still finite candidates). The subject rule below is
 * what stops a stray `made` in an NP from passing.
 */
const IRREGULAR_PASTS: Record<string, true> = {
 went: true, came: true, made: true, said: true, saw: true, took: true,
 gave: true, felt: true, thought: true, knew: true, wrote: true, spoke: true,
 kept: true, held: true, found: true, ran: true, got: true, put: true,
 set: true, read: true, left: true, lost: true, met: true, meant: true,
 paid: true, rode: true, rose: true, sat: true, stood: true, taught: true,
 understood: true, won: true, wore: true, drank: true, ate: true,
 began: true, broke: true, chose: true, drove: true, fell: true, grew: true,
 heard: true, brought: true, became: true, built: true, cut: true, hit: true,
 let: true, sent: true, told: true, sold: true, spent: true, dealt: true,
 drew: true, flew: true, hid: true, led: true, rang: true, sang: true,
 swam: true, threw: true, woke: true, forgot: true, froze: true, shook: true,
 slept: true, spread: true, stole: true, struck: true, swore: true,
 swung: true, tore: true, wound: true, withdrew: true, withheld: true,
};

/**
 * Common present-tense stems. A closed table on purpose — completeness is a
 * quality knob, not a correctness one: a missed stem only widens the
 * fragment to its sentence, which passes on the boundary arm anyway.
 */
// `cover` and `graduate` are absent on purpose: the mechanism-registry caller
// scan reads a same-named key as a call site (registry.ts documents the
// collision class), and `src/memory/cover` and `src/randomizer/thresholds`
// are declared unwired — a false caller would fail its conformance test. A
// missed stem only widens the fragment to its sentence, which passes anyway.
const BASE_VERBS: Record<string, true> = {
 work: true, make: true, keep: true, want: true, think: true, know: true,
 go: true, come: true, see: true, take: true, give: true, find: true,
 tell: true, feel: true, look: true, use: true, try: true, need: true,
 help: true, get: true, put: true, set: true, run: true, walk: true,
 talk: true, ask: true, answer: true, say: true, become: true, believe: true,
 call: true, change: true, consider: true, continue: true, decide: true,
 describe: true, develop: true, discuss: true, expect: true, explain: true,
 follow: true, happen: true, hear: true, hold: true, hope: true,
 include: true, learn: true, leave: true, like: true, live: true, love: true,
 manage: true, mean: true, move: true, offer: true, open: true, pay: true,
 play: true, practice: true, prepare: true, present: true, produce: true,
 provide: true, reach: true, realize: true, remember: true, return: true,
 seem: true, show: true, start: true, stay: true, stop: true, study: true,
 suggest: true, support: true, teach: true, travel: true, turn: true,
 understand: true, wait: true, watch: true, win: true, write: true,
 agree: true, allow: true, appear: true, arrive: true, avoid: true,
 begin: true, bring: true, buy: true, carry: true, catch: true, choose: true,
 close: true, cook: true, count: true, cross: true, dance: true,
 draw: true, drive: true, drop: true, eat: true, enjoy: true, enter: true,
 escape: true, fall: true, feed: true, fight: true, fill: true, finish: true,
 fix: true, fly: true, forget: true, gain: true, gather: true, grow: true,
 guess: true, hang: true, imagine: true, improve: true, insist: true,
 introduce: true, invent: true, invite: true, join: true, judge: true,
 jump: true, kick: true, knock: true, laugh: true, lay: true, lead: true,
 lie: true, lift: true, listen: true, lose: true, mention: true,
 notice: true, observe: true, order: true, organise: true, organize: true,
 own: true, pass: true, pick: true, plan: true, point: true, praise: true,
 prefer: true, promise: true, protect: true, prove: true, pull: true,
 push: true, raise: true, receive: true, reduce: true, refuse: true,
 relax: true, release: true, remain: true, remove: true, repair: true,
 repeat: true, replace: true, report: true, request: true, require: true,
 rest: true, result: true, review: true, save: true, score: true,
 search: true, select: true, sell: true, send: true, serve: true, share: true,
 shout: true, sing: true, sit: true, sleep: true, smile: true, smoke: true,
 solve: true, sort: true, sound: true, speak: true, spend: true, stand: true,
 steal: true, stick: true, strike: true, succeed: true, suffer: true,
 suppose: true, survive: true, swim: true, switch: true, taste: true,
 test: true, thank: true, throw: true, touch: true, train: true,
 translate: true, treat: true, trust: true, visit: true, vote: true,
 wake: true, warn: true, wash: true, wear: true, welcome: true, wish: true,
 wonder: true, worry: true, wrap: true, yield: true, belong: true,
 benefit: true, breathe: true, celebrate: true, collect: true,
 communicate: true, compare: true, complain: true, complete: true,
 concentrate: true, connect: true, contain: true, control: true,
 correct: true, create: true, depend: true, design: true, discover: true,
 divide: true, dream: true, dress: true, educate: true, employ: true,
 encourage: true, end: true, establish: true, exist: true, experience: true,
 explore: true, express: true, face: true, fail: true, fear: true,
 finance: true, focus: true, force: true, form: true, found: true,
 function: true, fund: true, guarantee: true, handle: true,
 identify: true, ignore: true, illustrate: true, impact: true,
 implement: true, import: true, impress: true, indicate: true,
 influence: true, inform: true, install: true, intend: true,
 interest: true, interpret: true, interview: true, invest: true,
 investigate: true, involve: true, issue: true, justify: true, label: true,
 land: true, last: true, launch: true, lend: true, license: true,
 limit: true, link: true, list: true, locate: true, lock: true,
 maintain: true, mark: true, marry: true, match: true, matter: true,
 measure: true, meet: true, mind: true, miss: true, mix: true, monitor: true,
 name: true, note: true, obtain: true, occupy: true, occur: true,
 operate: true, oppose: true, outline: true, participate: true,
 perform: true, permit: true, persist: true, persuade: true, place: true,
 plant: true, please: true, pose: true, possess: true, post: true,
 pour: true, pray: true, predict: true, preserve: true, press: true,
 prevent: true, print: true, prioritize: true, process: true,
 progress: true, project: true, promote: true, prompt: true, propose: true,
 protest: true, publish: true, pump: true, purchase: true, pursue: true,
 qualify: true, question: true, queue: true, quit: true, quote: true,
 race: true, range: true, rank: true, rate: true, react: true,
 reason: true, recall: true, reckon: true, recognize: true,
 recommend: true, record: true, recover: true, recruit: true,
 refer: true, reflect: true, regard: true, register: true, regret: true,
 regulate: true, reject: true, relate: true, rely: true, remind: true,
 render: true, rent: true, represent: true, research: true,
 reserve: true, resist: true, resolve: true, respect: true, respond: true,
 restore: true, retain: true, retire: true, reveal: true, reward: true,
 ride: true, ring: true, rise: true, risk: true, roll: true, rotate: true,
 route: true, rule: true, rush: true, sail: true, satisfy: true, scale: true,
 scan: true, schedule: true, scream: true, screen: true, seat: true,
 secure: true, seek: true, sense: true, separate: true, service: true,
 settle: true, shape: true, shift: true, ship: true, shock: true,
 shoot: true, shop: true, shut: true, sign: true, signal: true, size: true,
 slide: true, slip: true, slow: true, smell: true, source: true,
 specify: true, spell: true, split: true, sponsor: true, spot: true,
 stabilize: true, staff: true, stage: true, stake: true, star: true,
 state: true, station: true, steer: true, step: true, stimulate: true,
 stipulate: true, store: true, straighten: true, stream: true,
 strengthen: true, stress: true, stretch: true, string: true, strip: true,
 structure: true, struggle: true, stuff: true, style: true, submit: true,
 subscribe: true, substitute: true, sum: true, summarize: true, supply: true,
 surface: true, surpass: true, surprise: true, surrender: true,
 surround: true, survey: true, suspect: true, suspend: true, sustain: true,
 swallow: true, swap: true, swear: true, sweep: true, swing: true,
 symbolize: true, tackle: true, tag: true, tailor: true, target: true,
 task: true, tax: true, team: true, tend: true, term: true, tie: true,
 tighten: true, time: true, tip: true, title: true, toast: true,
 tour: true, trace: true, track: true, trade: true, transfer: true,
 transform: true, transmit: true, transport: true, trap: true, trigger: true,
 trim: true, trip: true, trouble: true, tune: true, twist: true, type: true,
 uncover: true, undergo: true, undertake: true, unite: true, update: true,
 upgrade: true, uphold: true, upset: true, utilize: true, value: true,
 vary: true, venture: true, verify: true, view: true, voice: true,
 volunteer: true, weigh: true, wind: true, witness: true,
};

/** Stems + s/es — mechanical, and ambiguous with plural nouns by design. */
function isThirdSingular(word: string): boolean {
 if (word.length < 4) return false;
 if (!/^[a-z]+(?:s|es)$/i.test(word)) return false;
 if (word.endsWith('ss')) return false;
 return THIRD_SINGULAR_EXCLUDED[word] !== true;
}

/** Nouns and adjectives that end in s and must not read as 3sg verbs. */
const THIRD_SINGULAR_EXCLUDED: Record<string, true> = {
 this: true, that: true, its: true, his: true, hers: true, ours: true,
 yours: true, theirs: true, bus: true, campus: true, status: true,
 virus: true, canvas: true, news: true, physics: true, maths: true,
 minus: true, plus: true, gas: true, basis: true, analysis: true,
 crisis: true, thesis: true, diagnosis: true,
};

/**
 * Stem + ed. The vowel guard kills `naked`-class adjectives; the rest is
 * absorbed by the subject rule.
 */
function isRegularPast(word: string): boolean {
 if (word.length < 4) return false;
 if (!/^[a-z]+ed$/i.test(word)) return false;
 if (/[aeiou]ed$/i.test(word) && !word.endsWith('ied') && !word.endsWith('eed')) return false;
 return PAST_EXCLUDED[word] !== true;
}

/** Common adjectives and nouns that end in ed. */
const PAST_EXCLUDED: Record<string, true> = {
 hundred: true, wicked: true, sacred: true, ragged: true, jagged: true,
 dogged: true, crooked: true, naked: true, kindred: true, hatred: true,
 indeed: true, beloved: true,
};

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/**
 * Nominative pronouns, plus the expletive `there` (`there was a problem`).
 * A nominative anywhere before the verb licenses any verb class.
 */
const NOMINATIVES: Record<string, true> = {
 i: true, you: true, he: true, she: true, it: true, we: true, they: true,
 there: true,
};

/** Function words that cannot head a noun-phrase subject. */
const FUNCTION_WORDS: Record<string, true> = {
 the: true, a: true, an: true, my: true, your: true, his: true, her: true,
 its: true, our: true, their: true, this: true, that: true, these: true,
 those: true, some: true, any: true, no: true, every: true, each: true,
 both: true, all: true, of: true, in: true, on: true, at: true, to: true,
 for: true, with: true, from: true, by: true, about: true, into: true,
 through: true, during: true, before: true, after: true, between: true,
 under: true, over: true, against: true, without: true, within: true,
 along: true, across: true, behind: true, beyond: true, among: true,
 around: true, up: true, down: true, off: true, out: true, and: true,
 or: true, but: true, nor: true, so: true, yet: true, if: true, then: true,
 than: true, as: true, because: true, although: true, though: true,
 while: true, since: true, when: true, where: true, which: true, who: true,
 whom: true, whose: true, what: true, how: true, why: true, not: true,
 just: true, very: true, quite: true, me: true, him: true, us: true,
 them: true, am: true, is: true, are: true, was: true, were: true, be: true,
 been: true, being: true, have: true, has: true, had: true, do: true,
 does: true, did: true, will: true, would: true, shall: true, should: true,
 can: true, could: true, may: true, might: true, must: true, ought: true,
 here: true,
};

/**
 * Contracted forms expanded before the finite-verb scan, so `I'm working`
 * reads as `i am working` — the same expansion `admissibility.ts` runs.
 */
function expandContractions(text: string): string {
 return text
  .replace(/\bwon'?t\b/g, 'will not')
  .replace(/\b(do|does|did|is|are|was|were|has|have|had|could|should|would|must|ai)n'?t\b/g, '$1 not')
  .replace(/\bi'm\b/g, 'i am')
  .replace(/\b(you|we|they)'re\b/g, '$1 are')
  .replace(/\b(he|she|it|that|there)'s\b/g, '$1 is')
  .replace(/\b(i|you|we|they)'ve\b/g, '$1 have')
  .replace(/\b(i|you|he|she|it|we|they)'ll\b/g, '$1 will')
  .replace(/\b(i|you|he|she|it|we|they)'d\b/g, '$1 would');
}

/**
 * Verb classes. `strong` forms (auxiliaries, pasts) can take a bare
 * noun-head subject; `weak` forms (base, 3sg) are too often nouns
 * (`the final report`, `the project plans`) to trust one.
 */
type VerbClass = 'strong' | 'weak';

/**
 * Is a subject reachable for the finite verb at index `i`?
 *
 * A nominative pronoun (or `there`) anywhere before the verb always counts.
 * Otherwise only a strong-form verb trusts a bare noun-head subject
 * (`the mechanism worked` ends on `mechanism`; an adverb or function word
 * in that slot does not count).
 */
function subjectReachable(tokens: string[], i: number, cls: VerbClass): boolean {
 for (let j = 0; j < i; j++) {
  if (NOMINATIVES[tokens[j]!] === true) return true;
 }
 if (cls !== 'strong') return false;
 const before = tokens[i - 1];
 if (before === undefined || before.endsWith('ly') || FUNCTION_WORDS[before] === true) {
  return false;
 }
 return true;
}

// ---------------------------------------------------------------------------
// The check and the widening
// ---------------------------------------------------------------------------

/**
 * Is the text a complete clause, decided mechanically?
 *
 * A finite verb with a reachable subject. No parser, no model call — a
 * fragment like `worked on making` fails (a finite verb with nothing before
 * it), while `I worked on making` passes.
 *
 * NOTE: this is the fragment-only arm. The segmenter's boundary test (a span
 * that coincides with sentence boundaries) is applied by `widenToClause`,
 * which holds the surrounding prose the boundary test needs.
 */
export function isCompleteClause(text: string): boolean {
 const t = text.trim();
 if (t.length === 0) return false;
 const tokens = expandContractions(t.toLowerCase())
  .split(/[^\p{L}]+/u)
  .filter((w) => w.length > 0);
 for (let i = 0; i < tokens.length; i++) {
  const word = tokens[i]!;
  const cls: VerbClass | null =
   AUXILIARIES[word] === true || IRREGULAR_PASTS[word] === true || isRegularPast(word)
    ? 'strong'
    : BASE_VERBS[word] === true || isThirdSingular(word)
     ? 'weak'
     : null;
  if (cls !== null && subjectReachable(tokens, i, cls)) return true;
 }
 return false;
}

/**
 * The smallest enclosing clause of `fragment` inside `prose`.
 *
 * Rules, in order:
 *
 *   1. A fragment that is already a complete clause is returned untouched.
 *   2. A fragment that coincides with the segmenter's sentence boundaries is
 *      a clause by the boundary test — returned untouched.
 *   3. Otherwise the fragment is widened to the smallest enclosing span that
 *      is a clause: intra-sentence clause boundaries first (after `, and`,
 *      `;`, `: `, an em dash), the enclosing sentence as the fallback.
 *   4. The span is always an exact substring of `prose` (the verbatim rule
 *      intact — Q-46 checks provenance, and this never invents text). A
 *      fragment not found in `prose` is returned unchanged, because nothing
 *      about it may be asserted.
 *
 * The sentence fallback always exists, so a non-clause fragment inside a
 * real sentence always comes out as a clause — the T16 case, `worked on
 * making` inside its sentence, becomes the full sentence.
 */
export function widenToClause(fragment: string, prose: string): string {
 const frag = fragment.trim();
 if (frag.length === 0) return fragment;
 if (isCompleteClause(frag)) return fragment;

 const start = prose.indexOf(frag);
 if (start < 0) return fragment;
 const end = start + frag.length;

 const sentences = splitSentences(prose);
 // The fragment IS a complete sentence — the boundary test passes.
 if (sentences.some((s) => s.start === start && s.end === end)) return fragment;

 // The covering run: the minimal set of sentences containing the fragment.
 const covering = sentences.filter((s) => s.end > start && s.start < end);
 if (covering.length === 0) return fragment;

 // Every clause-boundary pair inside the covering run, smallest first.
 const starts: number[] = [];
 const ends: number[] = [];
 for (const s of covering) {
  const b = clauseBoundaries(prose.slice(s.start, s.end));
  for (const cs of b.starts) starts.push(s.start + cs);
  for (const ce of b.ends) ends.push(s.start + ce);
 }
 const candidates: Span[] = [];
 for (const cs of starts) {
  for (const ce of ends) {
   if (cs <= start && end <= ce) candidates.push({ start: cs, end: ce });
  }
 }
 candidates.sort((x, y) => x.end - x.start - (y.end - y.start));

 for (const c of candidates) {
  const span = prose.slice(c.start, c.end).trim();
  if (span === frag) continue;
  const aligned =
   covering.some((s) => s.start === c.start) && covering.some((s) => s.end === c.end);
  if (aligned || isCompleteClause(span)) return span;
 }

 // No clause found (defensive — the covering run is aligned and should
 // always pass): leave the fragment exactly as it was.
 return fragment;
}
