import { describe, expect, test } from 'vitest';
import type { Complete, Turn } from '../src/types.js';
import type { GuardVerdict } from '../src/elicitor/guards.js';
import type { CompactedLadder } from '../src/sounding/compaction.js';
import { composeFromCompacted, composeRung } from '../src/clerk/sounding-rung.js';

const okGuard = (): GuardVerdict => 'ok';
const alwaysNearDuplicate = (): GuardVerdict => 'near-duplicate';

/**
 * Scripted Complete for composeRung: call 1 answers redLights with one valid
 * light whose phrase is the turn's LAST THREE WORDS (a verbatim substring of
 * the answer by construction), call 2 answers composeFollowUp with a question
 * that quotes that phrase. The same helper serves both answers because the
 * phrase is derived from the turn text, not fixed.
 */
function scriptedLightsAndFollowUp(): Complete {
  let calls = 0;
  return async (_system: string, turns: Turn[]) => {
    const text = turns.at(-1)!.text;
    const phrase = text.split(' ').slice(-3).join(' ');
    calls++;
    if (calls === 1) {
      return JSON.stringify({ lights: [{ kind: 'unexplored-referent', phrase }] });
    }
    return `You said "${phrase}". What happened there?`;
  };
}

describe('composeRung', () => {
  test('the foothold is a substring of the answer it was composed from', async () => {
    const r = await composeRung('it started in my fathers shed', scriptedLightsAndFollowUp(), okGuard);
    expect(r).not.toBeNull();
    expect('it started in my fathers shed').toContain(r!.foothold);
  });

  test('an answer whose every light the guard rejects composes nothing', async () => {
    expect(await composeRung('some answer here', scriptedLightsAndFollowUp(), alwaysNearDuplicate)).toBe(null);
  });
});
/**
 * Scripted Complete for composeFromCompacted: same shape as
 * scriptedLightsAndFollowUp, but the phrase is drawn from the LAST KEPT
 * ANSWER of the composite — the part before the background block — so the
 * composed foothold is provably a substring of it, never of the context.
 */
function scriptedFromLastAnswer(): Complete {
 let calls = 0;
 return async (_system: string, turns: Turn[]) => {
  const text = turns.at(-1)!.text;
  const answer = text.split('\n\n')[0]!;
  const phrase = answer.split(' ').slice(-3).join(' ');
  calls++;
  if (calls === 1) {
   return JSON.stringify({ lights: [{ kind: 'unexplored-referent', phrase }] });
  }
  return `You wrote: "${phrase}." What happened there?`;
 };
}

/** A compacted ladder: the last two rungs verbatim, the rest behind one line. */
const compactedFixture: CompactedLadder = {
 verbatim: [
  {
   question: 'You wrote: "the old workshop." What still draws you there?',
   foothold: 'the old workshop',
   answer: 'The old workshop smells of sawdust and engine oil every time I open the door.',
   at: '2026-08-02T12:00:00.000Z',
  },
  {
   question: 'You wrote: "sawdust and engine oil." What does that smell carry for you?',
   foothold: 'sawdust and engine oil',
   answer: 'Sawdust and engine oil mean the work was real and my hands were in it.',
   at: '2026-08-02T12:00:00.000Z',
  },
 ],
 summarized: { count: 4, line: 'the descent moved from the workshop to the shelf' },
 unsummarized: 0,
};

describe('composeFromCompacted', () => {
 test('the composed foothold is a substring of the last kept answer', async () => {
  const r = await composeFromCompacted(compactedFixture, scriptedFromLastAnswer(), okGuard);
  expect(r).not.toBeNull();
  expect(compactedFixture.verbatim.at(-1)!.answer).toContain(r!.foothold);
  // The summary line is context ONLY — never a foothold source.
  expect(compactedFixture.summarized!.line).not.toContain(r!.foothold);
 });

 test('a null summary (no line) still composes from the verbatim rungs alone', async () => {
  const noSummary: CompactedLadder = {
   verbatim: compactedFixture.verbatim,
   summarized: null,
   unsummarized: 4,
  };
  const r = await composeFromCompacted(noSummary, scriptedFromLastAnswer(), okGuard);
  expect(r).not.toBeNull();
  expect(noSummary.verbatim.at(-1)!.answer).toContain(r!.foothold);
 });
});
