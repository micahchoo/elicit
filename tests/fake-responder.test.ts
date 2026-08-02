import { describe, it, expect } from 'vitest';

import { makeFakeComplete } from '../src/fake-responder.js';
import { SYSTEM_PROMPT, propose } from '../src/harvester/harvester.js';
import type { Turn } from '../src/types.js';

/**
 * Ticket 078: the fake responder records what was SENT, so tests can assert
 * on the prompt/turns/opts instead of only on what came back. The
 * 044-acceptance class of bug — a harvest running on the elicitor's model
 * while the banner said the clerk's — is exactly a what-was-sent bug.
 */
describe('fake responder prompt recording', () => {
 it('records every call: system prompt, turns, and opts', async () => {
  const fake = makeFakeComplete();
  const system = 'You are a harvesting agent for Elicit. Return cuts.';
  const turns: Turn[] = [
   { role: 'user', text: 'I value autonomy above all else.', at: '2026-08-02T00:00:00.000Z' },
  ];

  const reply = await fake(system, turns, { temperature: 0.1 });

  expect(reply).toBe('{"cuts": []}');
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]!.system).toBe(system);
  expect(fake.calls[0]!.turns).toEqual(turns);
  expect(fake.calls[0]!.opts).toEqual({ temperature: 0.1 });
 });

 it('propose() sends the harvest SYSTEM_PROMPT, assertable on the fake', async () => {
  const fake = makeFakeComplete();

  await propose(
   'sess-1',
   [
    {
     role: 'user',
     text: "It's never a practical reason. Every language I've seriously studied started with a single encounter.",
     at: '2026-08-02T00:00:00.000Z',
    },
   ],
   fake,
  );

  expect(fake.calls.length).toBeGreaterThan(0);
  for (const call of fake.calls) {
   expect(call.system).toBe(SYSTEM_PROMPT);
  }
 });
});
