import { describe, it, expect } from 'vitest';
import { formatEvent, hasSentence, relativeTime, type FormattableEvent } from '../src/log/format.js';
import { blank, sweepEmitters } from './emitted-kinds.js';

/** A ULID as the server writes it — the thing this surface must never show. */
const ULID = '01KZ0DJAKS53EHA0KJZTGZJHY5';
const SECOND_ULID = '01KZ0DJ3MJVD6PDDKM3JTYGGWA';
const ULID_PATTERN = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

function ev(kind: string, detail: string, actor = 'clerk'): FormattableEvent {
  return { at: '2026-08-01T10:00:00Z', actor, kind, detail };
}

/**
 * A sample of each kind, with the detail line its emitter writes and the
 * sentence it must read as.
 *
 * This list does NOT define the set — `emittedKinds()` does, by sweeping
 * `src/`. The coverage test below fails when the two disagree, in either
 * direction: a kind emitted and not sampled here, or sampled here and no
 * longer emitted. The comment this file used to carry claimed completeness
 * and nothing enforced it, which is how four kinds drifted past it.
 */
const EMITTED: { kind: string; detail: string; reads: string }[] = [
  { kind: 'run-started', detail: 'docket run started', reads: 'started a docket run' },
  { kind: 'index-rebuilt', detail: 'rebuilt index from 12 snippets', reads: 'rebuilt the index from 12 snippets' },
  { kind: 'docket-run', detail: 'minted 3, expired 1', reads: 'ran the docket: minted 3 questions, expired 1' },
  { kind: 'docket-run-failed', detail: `post-harvest docket failed: Error at ${ULID}`, reads: 'could not finish the docket run' },
  { kind: 'opener-minted', detail: 'minted 2 openers', reads: 'minted 2 openers' },
  { kind: 'opener-failed', detail: `composeOpener for snippet ${ULID} failed: boom`, reads: 'could not mint an opener' },
  { kind: 'still-true-minted', detail: 'minted 1 still-true', reads: 'minted 1 still-true question' },
  { kind: 'still-true-failed', detail: `composeStillTrue for snippet ${ULID} failed: boom`, reads: 'could not mint a still-true question' },
  { kind: 'expedition-minted', detail: `minted expedition from snippet ${ULID}`, reads: 'minted an expedition from an earlier snippet' },
  { kind: 'expedition-failed', detail: 'Error: model returned nothing', reads: 'could not mint an expedition' },
  { kind: 'expired', detail: 'expired 4 entries', reads: 'expired 4 questions' },
  { kind: 'consolidated', detail: 'summarized 4 sessions', reads: 'summarized 4 sittings' },
  { kind: 'consolidation-failed', detail: 'Error: context overflow', reads: 'could not summarize the sittings' },
  {
    kind: 'session-started',
    detail: 'mode=25m/high target=self protocol=ladder',
    reads: 'started a 25-minute sitting at high energy using the ladder protocol',
  },
  { kind: 'close-phase-entered', detail: `session=${ULID}`, reads: 'entered the closing phase' },
  { kind: 'question-asked', detail: `session=${ULID} source=composed`, reads: 'asked a composed question' },
  {
    kind: 'juxtaposition-offered',
    detail: `session=${ULID} snippet=01KZ0DJ3MJVD6PDDKM3JTYGGWA source=juxtaposition`,
    reads: 'offered a juxtaposition against an earlier snippet',
  },
  {
    kind: 'question-deferred',
    detail: `session=${ULID} needs=energy`,
    reads: 'deferred a question until you have more energy',
  },
  {
    kind: 'harvest-proposed',
    detail: 'proposals=3 buds=1 parsed=true parseMode=json chunks=1/1 chunkErrors=0 rawChars=900 fabricationDrops=0 sourceTurnCorrections=0',
    reads: 'proposed 3 snippets and 1 bud',
  },
  { kind: 'session-harvested', detail: 'kept=1 budded=0', reads: 'kept 1, budded 0' },
  { kind: 'transcribed', detail: '820ms 47chars', reads: 'transcribed 47 characters of speech' },
  { kind: 'unprompted-entry', detail: `session=${ULID} chars=412`, reads: 'wrote 412 characters unprompted' },

  // The degradation ladder (Q-55). `before=0` holds at every rung by
  // construction, so what the reader needs is what relaxing recovered.
  {
    kind: 'queue-rung',
    detail: 'rung=2 relaxed=sharpness before=0 after=1',
    reads: 'relaxed the sharpness this sitting allows and recovered 1 question',
  },
  {
    kind: 'queue-floor',
    detail: 'emptiedBy=target pool=12 phase=mid target=self mode=25m/high',
    reads: 'composed a fresh question: none of the 12 in the queue got past what this sitting is for',
  },

  // The facet-balance shadow record (Q-35): the road not taken, and by how much.
  {
    kind: 'facet-balance-shadow',
    detail:
      'mode=shadow dist=episode:9,fact:2 under=value,intention plan=value,intention pool=9 kept=4 ' +
      `applied=true would=${SECOND_ULID} wouldFacet=value open=${ULID} openFacet=episode diverged=true`,
    reads:
      'would have asked a value question instead of an episode one — ' +
      '4 of 9 candidates carry a facet the vault is short on',
  },
  {
    kind: 'facet-balance-applied',
    detail:
      'mode=live dist=episode:9,fact:2 under=value plan=value pool=9 kept=4 ' +
      `applied=true would=${ULID} wouldFacet=value open=${ULID} openFacet=value diverged=false`,
    reads: 'picked the same question — 4 of 9 candidates carry a facet the vault is short on',
  },

  // The Randomizer (Q-18, Q-16). The licence line is a shadow record, so it
  // says what it found rather than what it did — and on a draw the person
  // asked for it says that too, because there the finding changed nothing.
  {
    kind: 'randomizer-license',
    detail: 'invokedBy=user grounds=none licensed=false live=false dryDays=0.4 from=last-answer regions=2',
    reads: 'you asked to shuffle',
  },
  {
    kind: 'randomizer-drawn',
    detail: 'channel=deck deck=transformative pool=178 facetFilter=shadow/stood-down grounds=none',
    reads: 'dealt a card from the transformative deck, one of 178',
  },
  {
    kind: 'randomizer-drawn',
    detail: 'channel=resurfacing stratum=deep wrote=2024-03-12 pool=91 grounds=dry-spell',
    reads: 'brought back something you wrote on 2024-03-12, one of 91 in the deep band',
  },
  {
    kind: 'randomizer-empty',
    detail: 'invokedBy=user decks=0 snippets=0 cooldown=139',
    reads: 'had nothing left to shuffle: 0 deck cards and 0 snippets were available, with 139 drawn too recently',
  },

  // The wiki run's steps. These carry ids and exception text, never a number,
  // so the reader gets the step and the JSONL keeps the stack.
  {
    kind: 'wiki-jobs-failed',
    detail: 'job=lock a wiki run is already in progress, so this one did nothing',
    reads: 'did not start a wiki run: one was already in progress',
  },
  {
    kind: 'wiki-jobs-failed',
    detail: `job=opposition pair=${ULID},${SECOND_ULID} TypeError: cannot read properties of undefined`,
    reads: 'could not finish the opposition step of the wiki run',
  },
  {
    kind: 'mint-oversized',
    detail: `reading=${ULID} did not fit the payload budget, so it was set aside`,
    reads: 'set a reading aside: it did not fit the payload budget',
  },
  {
    kind: 'mint-parse-failed',
    detail: `reading=${ULID} raw="{\\"ops\\": [ truncated"`,
    reads: "could not read the model's claim proposal back",
  },
  {
    kind: 'mint-empty',
    detail: `reading=${ULID} parsed cleanly and proposed no operation`,
    reads: 'read a reading cleanly and proposed no change to the wiki',
  },
  {
    kind: 'mint-call-failed',
    detail: `reading=${ULID} fetch failed`,
    reads: 'could not ask the model about a reading',
  },

  // The wiki's thresholds (Q-35, Q-56). `would=` and `clipped=` are prose the
  // emitter writes, so they pass through verbatim rather than being reworded.
  {
    kind: 'shadow-decision',
    detail: 'mode=shadow threshold=lint.godNodeFanout value=6 would=note god-node on facet=value claims=9 over fanout=6',
    reads: 'did not act on lint.godNodeFanout, set to 6 — it would note god-node on facet=value claims=9 over fanout=6',
  },
  {
    kind: 'threshold-clipped',
    detail: 'mode=live threshold=remeasure.liveCap value=2 clipped=mint 5 re-measures for this run',
    reads: 'enforced remeasure.liveCap at 2 and clipped: mint 5 re-measures for this run',
  },
  {
    kind: 'lint-threshold-unhonored',
    detail: 'threshold=lint.staleCitationAgeDays value=3 needs a clock; lint is pure and applied a 0-day grace',
    reads: 'could not honour lint.staleCitationAgeDays, set to 3: needs a clock; lint is pure and applied a 0-day grace',
  },

  // The wiki's claims and registry.
  {
    kind: 'claim-status-changed',
    detail: `claim=${ULID} from=supported to=contested — contested: member of open Contradiction ${SECOND_ULID}`,
    reads: 'moved a claim from supported to contested: contested: member of open Contradiction',
  },
  {
    kind: 'claim-op-rejected',
    detail: `reason=cite-does-not-resolve:${ULID}@1 reading=${SECOND_ULID}`,
    reads: 'rejected an edit to the wiki: cite does not resolve',
  },
  {
    kind: 'referent-minted',
    detail: 'slug=micah-alex kind=person name="Micah Alex"',
    reads: 'added Micah Alex to the registry as a person',
  },
  {
    kind: 'referent-aliased',
    detail: 'slug=micah-alex alias="Mike"',
    reads: 'recorded "Mike" as another name for micah-alex',
  },
  {
    kind: 'referent-kind-differs',
    detail: 'slug=the-notebook stored=project proposed=construct',
    reads: 'left the-notebook recorded as a project, though it was proposed as a construct',
  },
  {
    kind: 'referent-alias-refused',
    detail:
      'existing=micah-alex aliasOf=mike-a both names are already referents; ' +
      'only user attestation merges two identities',
    reads:
      'refused to fold micah-alex into mike-a: both are already entries, ' +
      'and only you can say they name the same thing',
  },
  {
    kind: 'referent-alias-unresolved',
    detail: 'name="Mike" aliasOf="Micah Alex" stands as slug=mike',
    reads: 'kept "Mike" as its own entry: nothing in the registry is called "Micah Alex"',
  },

  // The contradiction channels (Q-52, Q-56). A clip record whose count is
  // dropped is a bound with no evidence behind it.
  {
    kind: 'clash-referent-clipped',
    detail: 'referent=my-manager cap=12 claims=19 clipped=7',
    reads: 'compared 12 of 19 claims about my-manager and set 7 aside',
  },
  {
    kind: 'clash-embedding-clipped',
    detail: 'reason=window claims=140 window=12 clipped=128',
    reads: 'compared 12 of 140 claims and set 128 aside',
  },
  {
    kind: 'clash-embedding-clipped',
    detail: 'reason=budget budgetMs=8000 embedded=12 pending=31',
    reads: 'stopped embedding at a budget of 8000ms: 12 done, 31 still waiting',
  },
  {
    kind: 'embedding-unavailable',
    detail: 'model=nomic-embed-text embedded=3 pending=40 error=fetch failed',
    reads: 'could not reach nomic-embed-text: 3 claims embedded, 40 still waiting',
  },
  {
    kind: 'clash-checked',
    detail: 'pool=12 suppressed=3 reproposed=1 channels=lexical:5,referent:4,embedding:3',
    reads: 'found 12 pairs that might contradict (lexical 5, referent 4, embedding 3), suppressed 3, reproposed 1',
  },
];

describe('formatEvent', () => {
  for (const c of EMITTED) {
    it(`${c.kind} reads as a sentence`, () => {
      expect(formatEvent(ev(c.kind, c.detail))).toBe(c.reads);
    });
  }

  it('no formatted line contains a ULID', () => {
    for (const c of EMITTED) {
      expect(formatEvent(ev(c.kind, c.detail))).not.toMatch(ULID_PATTERN);
    }
  });

  it('an unknown kind degrades to readable words instead of throwing', () => {
    expect(formatEvent(ev('moon-phase-noted', `session=${ULID} waxing gibbous`)))
      .toBe('moon phase noted — waxing gibbous');
    expect(formatEvent(ev('boot', ''))).toBe('boot');
    expect(formatEvent(ev('mystery', `snippet=${ULID}`))).toBe('mystery');
    expect(formatEvent(ev('', ULID))).toBe('did something');
  });

  it('a question deferred with no declared need still reads', () => {
    expect(formatEvent(ev('question-deferred', `session=${ULID} needs=none`))).toBe('deferred a question');
  });

  it('a collapsed extraction says so instead of claiming nothing was there', () => {
    const detail = 'proposals=0 buds=0 parsed=false parseMode=none chunks=0/1 chunkErrors=1 rawChars=0';
    expect(formatEvent(ev('harvest-proposed', detail, 'harvester')))
      .toBe('could not read the sitting back, so proposed nothing');
  });

  /**
   * `resonance-checked` is the one kind whose sentence is written ahead of its
   * emitter: the live turn path emits it, and that path is a later task. It is
   * deliberately NOT in `EMITTED` above, because the sweep below rightly fails
   * a sample for a kind nothing emits — a sample is a claim that a rendering
   * has been read on a real line. This is a claim about the sentence only.
   */
  it('resonance-checked reads as a sentence before its emitter lands', () => {
    expect(formatEvent(ev('resonance-checked', `session=${ULID} hits=2`))).toBe(
      'looked for echoes of what was just said and found 2',
    );
  });

  it('a malformed detail line does not throw', () => {
    expect(() => formatEvent(ev('index-rebuilt', ''))).not.toThrow();
    expect(formatEvent(ev('index-rebuilt', ''))).toBe('rebuilt the index from 0 snippets');
    expect(formatEvent(ev('session-started', 'mode=garbage'))).toBe('started a sitting');
  });
});

/**
 * The floor under each long-standing emitter. A scanner that stops seeing a
 * file reports a shorter list and calls it clean — which is this ticket's
 * failure with better production values, and it has already happened once: an
 * apostrophe in a comment took every kind in `src/server.ts` out of the sweep
 * without a word. These are floors, not counts, so ordinary growth does not
 * touch them and a collapse to zero cannot pass.
 */
const FLOORS: Record<string, number> = {
  'src/server.ts': 8,
  'src/clerk/docket.ts': 8,
  'src/queue/queue.ts': 3,
  'src/wiki/registry.ts': 3,
};

/**
 * The enforcement ticket 063 asked for. `sweepEmitters()` reads `src/` at test
 * time, so the set is DERIVED: a kind added anywhere in the tree is here
 * before anyone remembers to add it, and a kind deleted stops being claimed.
 *
 * Ways to be wrong, and a failure for each. A kind with no sentence degrades to
 * two context-free words on the surface Q-23 makes the reason background
 * autonomy is trustworthy; a kind with a sentence and no sample has a rendering
 * nobody has read; a sample for a kind nothing emits is the same decayed claim
 * in a new place; and a sweep that has quietly stopped reading a file is the
 * same claim again, wearing the authority of having been derived.
 */
describe('every emitted kind renders', () => {
  const { kinds: emitted, unreadable, broken } = sweepEmitters();
  const kinds = [...new Set(emitted.map((e) => e.kind))].sort();
  const sampled = new Set(EMITTED.map((c) => c.kind));

  /** The sweep finding nothing would pass every assertion below vacuously. */
  it('the sweep finds the emitters', () => {
    expect(emitted.length).toBeGreaterThan(20);
    expect(kinds).toContain('session-started');
    expect(kinds).toContain('queue-rung');
  });

  it('still reads every file that emits, rather than quietly seeing none', () => {
    const counts = Object.fromEntries(
      Object.keys(FLOORS).map((f) => [f, emitted.filter((e) => e.file === f).length]),
    );
    const starved = Object.entries(FLOORS)
      .filter(([file, floor]) => (counts[file] ?? 0) < floor)
      .map(([file, floor]) => `${file}: ${counts[file] ?? 0} kinds, expected at least ${floor}`);
    expect(starved).toEqual([]);
  });

  /**
   * Bracket balance is the cheapest witness that the scanner parsed a file the
   * way a compiler would. A comment or string it failed to skip almost always
   * leaves a bracket open.
   */
  it('parses every file it reads', () => {
    expect(broken).toEqual([]);
  });

  /**
   * The bug this guard exists for, held still. An earlier scanner tracked
   * quotes without skipping comments, so one apostrophe in prose put it inside
   * a string for the rest of the file and `src/server.ts` left the sweep
   * without a word. Blanking must erase the comment and leave the code.
   */
  it("does not read a comment's apostrophe as a quote", () => {
    const source = [
      "// the docket's log, and a regex with one: /[’']/u",
      "log({ at: '', actor: 'clerk', kind: 'x-happened', detail: 'y' });",
    ].join('\n');
    const blanked = blank(source);
    expect(blanked).toHaveLength(source.length);
    expect(blanked).not.toContain('docket');
    expect(blanked).toContain("kind: '");
    expect(blanked.split('\n')).toHaveLength(2);
  });

  /**
   * The sweep reads source text, so a kind assembled at runtime — `kind:
   * KINDS[i]` — has no literal to find. Such a site is REPORTED rather than
   * skipped: skipping it is how a list starts claiming a completeness it does
   * not have, which is the whole of ticket 063. Spell the kind at the emitter,
   * or hand it to a wrapper as a parameter.
   */
  it('is written where a reader of the source can see it', () => {
    const holes = unreadable.map((u) => `${u.file}:${u.line} — kind: ${u.expr} (${u.why})`);
    expect(holes).toEqual([]);
  });

  it('has a sentence, so none falls through to the fallback', () => {
    const missing = emitted
      .filter((e) => !hasSentence(e.kind))
      .map((e) => `${e.kind} — ${e.file}:${e.line}`);
    expect(missing).toEqual([]);
  });

  it('has a sample above, so its rendering has been read by a person', () => {
    const unsampled = emitted
      .filter((e) => !sampled.has(e.kind))
      .map((e) => `${e.kind} — ${e.file}:${e.line}`);
    expect(unsampled).toEqual([]);
  });

  it('is still emitted, so no sample outlives its emitter', () => {
    const stale = [...sampled].filter((k) => !kinds.includes(k));
    expect(stale).toEqual([]);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-08-01T12:00:00Z');

  it('reads as a clock a person keeps', () => {
    expect(relativeTime('2026-08-01T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-08-01T11:45:00Z', now)).toBe('15m ago');
    expect(relativeTime('2026-08-01T10:00:00Z', now)).toBe('2h ago');
    expect(relativeTime('2026-07-29T12:00:00Z', now)).toBe('3d ago');
  });

  it('an unparseable timestamp yields nothing rather than "NaN ago"', () => {
    expect(relativeTime('not a date', now)).toBe('');
  });
});
