import { describe, expect, test } from 'vitest';
import type { Complete, Turn } from '../src/types.js';
import type { GuardVerdict } from '../src/elicitor/guards.js';
import { composeRung } from '../src/clerk/sounding-rung.js';

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
