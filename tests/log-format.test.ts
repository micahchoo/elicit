import { describe, it, expect } from 'vitest';
import { formatEvent, relativeTime, type FormattableEvent } from '../src/log/format.js';

/** A ULID as the server writes it — the thing this surface must never show. */
const ULID = '01KZ0DJAKS53EHA0KJZTGZJHY5';
const ULID_PATTERN = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

function ev(kind: string, detail: string, actor = 'clerk'): FormattableEvent {
  return { at: '2026-08-01T10:00:00Z', actor, kind, detail };
}

/** Every kind the codebase actually emits, with the detail line it emits. */
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

  it('a malformed detail line does not throw', () => {
    expect(() => formatEvent(ev('index-rebuilt', ''))).not.toThrow();
    expect(formatEvent(ev('index-rebuilt', ''))).toBe('rebuilt the index from 0 snippets');
    expect(formatEvent(ev('session-started', 'mode=garbage'))).toBe('started a sitting');
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
