import { describe, it, expect } from 'vitest';
import { annotateIntentionHorizon } from '../src/clerk/annotate.js';
import { makeScriptedComplete } from './fakes.js';
import type { Snippet } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODEL = 'test-model';
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function makeIntention(overrides?: Partial<Snippet>): Snippet {
  return {
    id: 'sn-h-1',
    version: 1,
    captured: '2026-07-01T09:00:00Z',
    provenance: {
      kind: 'unprompted',
      session: 'sess-1',
      question: '',
      questionForm: 'deliberative',
    },
    prose: 'I will finish the quarterly review by Friday.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// annotateIntentionHorizon — exercises shapeHorizon through the public API
// ---------------------------------------------------------------------------

describe('annotateIntentionHorizon', () => {
  it('parses a horizon answer into a horizon result stamped with the snippet', async () => {
    const raw = JSON.stringify({ horizon: 'days' });
    const complete = makeScriptedComplete([raw]);

    const result = await annotateIntentionHorizon(makeIntention(), MODEL, complete);

    expect(result).toEqual({
      kind: 'horizon',
      snippetId: 'sn-h-1',
      version: 1,
      horizon: 'days',
      model: MODEL,
      modelAt: expect.stringMatching(ISO_STAMP),
      raw,
    });
  });

  it.each(['now', 'session', 'days'] as const)(
    'parses horizon %s',
    async (horizon) => {
      const raw = JSON.stringify({ horizon });
      const result = await annotateIntentionHorizon(
        makeIntention(),
        MODEL,
        makeScriptedComplete([raw]),
      );

      expect(result).toMatchObject({ kind: 'horizon', horizon });
    },
  );

  it('parses an ambiguous answer into an ambiguous result with the dating question', async () => {
    const raw = JSON.stringify({
      ambiguous: true,
      datingQuestion: 'When did you expect to finish the quarterly review?',
    });
    const complete = makeScriptedComplete([raw]);

    const result = await annotateIntentionHorizon(makeIntention(), MODEL, complete);

    expect(result).toEqual({
      kind: 'ambiguous',
      snippetId: 'sn-h-1',
      version: 1,
      datingQuestion: 'When did you expect to finish the quarterly review?',
      model: MODEL,
      modelAt: expect.stringMatching(ISO_STAMP),
      raw,
    });
  });

  it('trims whitespace from the dating question', async () => {
    const raw = JSON.stringify({ ambiguous: true, datingQuestion: '  When?  ' });

    const result = await annotateIntentionHorizon(
      makeIntention(),
      MODEL,
      makeScriptedComplete([raw]),
    );

    expect(result).toMatchObject({ kind: 'ambiguous', datingQuestion: 'When?' });
  });

  it('strips markdown fences before parsing', async () => {
    const raw = '```json\n{"horizon": "now"}\n```';

    const result = await annotateIntentionHorizon(
      makeIntention(),
      MODEL,
      makeScriptedComplete([raw]),
    );

    expect(result).toMatchObject({ kind: 'horizon', horizon: 'now', raw });
  });

  it('throws when the model returns invalid JSON', async () => {
    const complete = makeScriptedComplete(['not json at all']);

    await expect(annotateIntentionHorizon(makeIntention(), MODEL, complete)).rejects.toThrow(
      /non-JSON/,
    );
  });

  it('throws when the answer is not a JSON object', async () => {
    const complete = makeScriptedComplete(['[1, 2, 3]']);

    await expect(annotateIntentionHorizon(makeIntention(), MODEL, complete)).rejects.toThrow(
      /not an object/,
    );
  });

  it('throws when ambiguous is true but the dating question is missing', async () => {
    const complete = makeScriptedComplete(['{"ambiguous": true}']);

    await expect(annotateIntentionHorizon(makeIntention(), MODEL, complete)).rejects.toThrow(
      /datingQuestion is empty/,
    );
  });

  it('throws on an invalid horizon value', async () => {
    const complete = makeScriptedComplete(['{"horizon": "tomorrow"}']);

    await expect(annotateIntentionHorizon(makeIntention(), MODEL, complete)).rejects.toThrow(
      'annotateIntentionHorizon: invalid horizon "tomorrow"',
    );
  });

  it('throws when the horizon field is missing entirely', async () => {
    const complete = makeScriptedComplete(['{}']);

    await expect(annotateIntentionHorizon(makeIntention(), MODEL, complete)).rejects.toThrow(
      /invalid horizon/,
    );
  });
});
