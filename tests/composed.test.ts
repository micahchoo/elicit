import { describe, it, expect, vi } from 'vitest';
import {
  redLights,
  composeFollowUp,
  composeJuxtaposition,
  composeOpener,
  composeStillTrue,
} from '../src/clerk/composed.js';
import type {
  Complete,
  RedLight,
  ResonanceHit,
  Snippet,
  QueueDraft,
  Turn,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Scripted fake Complete — returns queued responses in order
// ---------------------------------------------------------------------------

function fakeComplete(...responses: string[]): Complete {
  let i = 0;
  return async (_system: string, _turns: Turn[], _opts?: { temperature?: number }) => {
    if (i >= responses.length) {
      throw new Error(`fakeComplete exhausted after ${responses.length} response(s)`);
    }
    return responses[i++]!;
  };
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const TURN_WITH_ODD_TERM = 'The synergy between teams created a paradigm shift in our workflow.';

const TURN_ECHO = 'I still think deep work matters more than meetings, even though my team disagrees.';

function makeSnippet(overrides?: Partial<Snippet>): Snippet {
  return {
    id: 's1',
    version: 3,
    captured: '2026-01-15T10:00:00Z',
    provenance: {
      kind: 'harvest',
      session: 'sess-1',
      question: 'What do you value most?',
      questionForm: 'deliberative',
      span: { start: 0, end: 50 },
    },
    prose: 'I value deep work over shallow productivity. Meetings steal my best hours.',
    ...overrides,
  };
}

function makeResonanceHit(overrides?: Partial<ResonanceHit>): ResonanceHit {
  return {
    snippetId: 's1',
    version: 3,
    sharedPhrase: 'deep work',
    score: 0.85,
    snippetText: 'I value deep work over shallow productivity. Meetings steal my best hours.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// redLights
// ---------------------------------------------------------------------------

describe('redLights', () => {
  it('accepts valid lights whose phrases are substrings of the turn', async () => {
    const complete = fakeComplete(
      JSON.stringify({
        lights: [
          { kind: 'odd-term', phrase: 'synergy' },
          { kind: 'abstraction-no-episode', phrase: 'paradigm shift' },
        ],
      }),
    );

    const result = await redLights(TURN_WITH_ODD_TERM, complete);

    expect(result).toHaveLength(2);
    expect(result[0]!.kind).toBe('odd-term');
    expect(result[0]!.phrase).toBe('synergy');
    expect(TURN_WITH_ODD_TERM).toContain(result[0]!.phrase);
    expect(result[1]!.kind).toBe('abstraction-no-episode');
    expect(result[1]!.phrase).toBe('paradigm shift');
    expect(TURN_WITH_ODD_TERM).toContain(result[1]!.phrase);
  });

  it('drops fabricated phrases not in the turn text', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const complete = fakeComplete(
      JSON.stringify({
        lights: [{ kind: 'odd-term', phrase: 'nonexistent' }],
      }),
    );

    const result = await redLights(TURN_WITH_ODD_TERM, complete);

    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('nonexistent'),
    );
    warnSpy.mockRestore();
  });

  it('mixes valid and invalid: keeps only substring-verified phrases', async () => {
    const complete = fakeComplete(
      JSON.stringify({
        lights: [
          { kind: 'odd-term', phrase: 'synergy' },
          { kind: 'cause-no-event', phrase: 'not in turn' },
        ],
      }),
    );

    const result = await redLights(TURN_WITH_ODD_TERM, complete);

    expect(result).toHaveLength(1);
    expect(result[0]!.phrase).toBe('synergy');
  });

  it('returns empty array on malformed JSON', async () => {
    const complete = fakeComplete('not json at all');

    const result = await redLights(TURN_WITH_ODD_TERM, complete);

    expect(result).toEqual([]);
  });

  it('returns empty array when lights field is missing', async () => {
    const complete = fakeComplete('{}');

    const result = await redLights(TURN_WITH_ODD_TERM, complete);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// composeFollowUp
// ---------------------------------------------------------------------------

describe('composeFollowUp', () => {
  const light: RedLight = { kind: 'odd-term', phrase: 'synergy' };

  it('accepts question containing the light phrase verbatim', async () => {
    const complete = fakeComplete('What does synergy mean to you in concrete terms?');

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toBe('What does synergy mean to you in concrete terms?');
    expect(result).toContain('synergy');
  });

  it('retries once then returns null when phrase is missing', async () => {
    const complete = fakeComplete(
      'What does that term mean to you?',         // first — missing "synergy"
      'Can you elaborate on that concept?',        // retry — still missing "synergy"
    );

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toBeNull();
  });

  it('succeeds on retry if second response contains the phrase', async () => {
    const complete = fakeComplete(
      'What does that term mean?',                 // first — missing
      'Can you give an example of synergy at work?', // retry — has it
    );

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toContain('synergy');
  });

  it('strips markdown fences from LLM output', async () => {
    const complete = fakeComplete('```\nWhat does synergy mean to you?\n```');

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toBe('What does synergy mean to you?');
  });

  it('rejects a declarative that quotes the phrase, then accepts the retry', async () => {
    const complete = fakeComplete(
      'The synergy between teams is worth examining.',  // quotes, but is not a question
      'What did synergy look like on the day it worked?',
    );

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toBe('What did synergy look like on the day it worked?');
  });

  it('retries a first-person leak outside the quote, then accepts second person', async () => {
    const turn = 'If a claim is popular, my hedges get shorter, and I stop saying what I think.';
    const hedges: RedLight = { kind: 'abstraction-no-episode', phrase: 'my hedges get shorter' };
    const complete = fakeComplete(
      'When my hedges get shorter, what does that protect me from?',   // "me" outside the quote
      'When my hedges get shorter, what does that protect you from?',  // person agrees
    );

    const result = await composeFollowUp(turn, hedges, complete);

    expect(result).toBe('When my hedges get shorter, what does that protect you from?');
  });

  it('returns null when both attempts leak first person outside the quote', async () => {
    const turn = 'If a claim is popular, my hedges get shorter, and I stop saying what I think.';
    const hedges: RedLight = { kind: 'abstraction-no-episode', phrase: 'my hedges get shorter' };
    const complete = fakeComplete(
      'When my hedges get shorter, what does that protect me from?',
      'When my hedges get shorter, what am I protecting?',
    );

    const result = await composeFollowUp(turn, hedges, complete);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeJuxtaposition
// ---------------------------------------------------------------------------

describe('composeJuxtaposition', () => {
  const hit = makeResonanceHit();
  // hit.sharedPhrase = 'deep work', hit.snippetText has it, TURN_ECHO has it

  it('accepts question containing sharedPhrase verbatim', async () => {
    const complete = fakeComplete(
      'You mentioned deep work matters — how does that connect to what you valued in January?',
    );

    const result = await composeJuxtaposition(TURN_ECHO, hit, complete);

    expect(result).toContain('deep work');
  });

  it('retries once then returns null when sharedPhrase is missing', async () => {
    const complete = fakeComplete(
      'How does that connect to what you valued before?',   // missing "deep work"
      'What about your earlier perspective?',                // still missing
    );

    const result = await composeJuxtaposition(TURN_ECHO, hit, complete);

    expect(result).toBeNull();
  });

  it('succeeds on retry with sharedPhrase', async () => {
    const complete = fakeComplete(
      'How does that connect to your past views?',
      'You mentioned deep work before — has anything changed?',
    );

    const result = await composeJuxtaposition(TURN_ECHO, hit, complete);

    expect(result).toContain('deep work');
  });

  it('rejects a statement that quotes the sharedPhrase but asks nothing', async () => {
    const complete = fakeComplete(
      'In January you valued deep work over meetings, and you still do.',
      'In January you valued deep work — is that still where the hours go?',
    );

    const result = await composeJuxtaposition(TURN_ECHO, hit, complete);

    expect(result).toBe('In January you valued deep work — is that still where the hours go?');
  });
});

// ---------------------------------------------------------------------------
// composeOpener
// ---------------------------------------------------------------------------

describe('composeOpener', () => {
  const snippet = makeSnippet();
  // prose: 'I value deep work over shallow productivity. Meetings steal my best hours.'

  it('creates QueueDraft with a question quoting the snippet verbatim', async () => {
    const complete = fakeComplete(
      'You wrote "I value deep work over shallow productivity" — is that still how you see it?',
    );

    const result = await composeOpener(snippet, complete);

    expect(result).not.toBeNull();
    const draft = result!;
    expect(draft.source).toBe('composed');
    expect(draft.sharpness).toBe('weak');
    expect(draft.license).toBe('CC0');
    expect(draft.questionForm).toBe('deliberative');
    expect(draft.horizon).toBe('session');
    expect(draft.cites).toEqual(['s1@3']);
    // The question must contain a substring of snippet.prose
    expect(draft.quotedFragment).toBeDefined();
    expect(snippet.prose).toContain(draft.quotedFragment!);
    expect(draft.question).toContain(draft.quotedFragment!);
  });

  it('returns null when the question quotes no fragment of the snippet', async () => {
    const complete = fakeComplete(
      'Has your perspective changed since last time?',  // no snippet substring
      'What are your current thoughts?',                 // retry — still none
    );

    const result = await composeOpener(snippet, complete);

    expect(result).toBeNull();
  });

  it('succeeds on retry when second response quotes the snippet', async () => {
    const complete = fakeComplete(
      'Has your perspective changed?',                                        // no quote
      'You mentioned that Meetings steal my best hours — still true?',        // quotes snippet verbatim
    );

    const result = await composeOpener(snippet, complete);

    expect(result).not.toBeNull();
    expect(result!.question).toContain('Meetings steal my best hours');
  });

  // eval 2026-08-02 #3: an unchanged echo is the longest common substring,
  // so the quote check passes it. It is still not a question.
  it('returns null when the model echoes the snippet back unchanged', async () => {
    const complete = fakeComplete(snippet.prose, snippet.prose);

    const result = await composeOpener(snippet, complete);

    expect(result).toBeNull();
  });

  it('returns null when the model appends a question mark to the echo', async () => {
    const echo = 'I value deep work over shallow productivity?';
    const complete = fakeComplete(echo, echo);

    const result = await composeOpener(snippet, complete);

    expect(result).toBeNull();
  });

  it('retries an echo and accepts a real question on the second attempt', async () => {
    const complete = fakeComplete(
      snippet.prose,
      'You wrote "Meetings steal my best hours" — which meeting was the worst of them?',
    );

    const result = await composeOpener(snippet, complete);

    expect(result).not.toBeNull();
    expect(result!.question).toContain('Meetings steal my best hours');
  });
});

// ---------------------------------------------------------------------------
// composeStillTrue
// ---------------------------------------------------------------------------

describe('composeStillTrue', () => {
  const snippet = makeSnippet();
  // provenance.question = 'What do you value most?'

  it('creates still-true QueueDraft quoting the snippet but NOT repeating provenance.question', async () => {
    const complete = fakeComplete(
      'Is "deep work over shallow productivity" still your priority?',
    );

    const result = await composeStillTrue(snippet, complete);

    expect(result).not.toBeNull();
    const draft = result!;
    expect(draft.source).toBe('still-true');
    expect(draft.sharpness).toBe('weak');
    expect(draft.license).toBe('CC0');
    expect(draft.questionForm).toBe('deliberative');
    expect(draft.horizon).toBe('session');
    expect(draft.cites).toEqual(['s1@3']);
    // Must quote the snippet
    expect(draft.quotedFragment).toBeDefined();
    expect(snippet.prose).toContain(draft.quotedFragment!);
    expect(draft.question).toContain(draft.quotedFragment!);
  });

  it('retries then returns null when question repeats provenance.question', async () => {
    const complete = fakeComplete(
      'What do you value most?',            // exact repeat of provenance.question
      'What matters most to you now?',      // retry also doesn't quote snippet
    );

    const result = await composeStillTrue(snippet, complete);

    expect(result).toBeNull();
  });

  it('retries then returns null when question quotes nothing from the snippet', async () => {
    const complete = fakeComplete(
      'Are your priorities different now?',   // no snippet quote
      'Has anything shifted for you?',         // retry — still no quote
    );

    const result = await composeStillTrue(snippet, complete);

    expect(result).toBeNull();
  });

  it('retries a first-person leak outside the quote', async () => {
    const complete = fakeComplete(
      'Do I still value deep work over shallow productivity today?',   // "I" outside the quote
      'Is "deep work over shallow productivity" still where your hours go?',
    );

    const result = await composeStillTrue(snippet, complete);

    expect(result).not.toBeNull();
    expect(result!.question).toBe(
      'Is "deep work over shallow productivity" still where your hours go?',
    );
  });
});
