import { describe, it, expect, vi } from 'vitest';
import {
  redLights,
  composeFollowUp,
  composeJuxtaposition,
  composeOpener,
  composeStillTrue,
  composeExpedition,
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
// Quote framing (040) — the live malformed question and its framed twin
// ---------------------------------------------------------------------------

/** The turn the malformed question of 2026-08-02 was built from. */
const TURN_RESONANCE =
  'There was a resonance in the room, the kind I thought that I long lost.';

const RESONANCE_FRAGMENT = 'I thought that I long lost';

/** Verbatim from the app, ticket 040: the fragment spliced into mid-clause. */
const SPLICED =
  'When did you last experience the kind of resonance that I thought that I long lost?';

/** The same fragment, same source, framed instead of spliced. */
const FRAMED =
  'You wrote: "I thought that I long lost." When did you last feel it come back?';

describe('quote framing (040)', () => {
  const light: RedLight = {
    kind: 'abstraction-no-episode',
    phrase: RESONANCE_FRAGMENT,
  };

  it('composeFollowUp refuses the spliced question twice and returns null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const complete = fakeComplete(SPLICED, SPLICED);

    const result = await composeFollowUp(TURN_RESONANCE, light, complete);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unframed-quote'));
    warn.mockRestore();
  });

  it('composeFollowUp accepts the framed question', async () => {
    const complete = fakeComplete(FRAMED);

    const result = await composeFollowUp(TURN_RESONANCE, light, complete);

    expect(result).toBe(FRAMED);
  });

  it('composeFollowUp retries a splice and accepts the framing', async () => {
    const complete = fakeComplete(SPLICED, FRAMED);

    const result = await composeFollowUp(TURN_RESONANCE, light, complete);

    expect(result).toBe(FRAMED);
  });

  const snippet = makeSnippet({ prose: TURN_RESONANCE });

  it('composeOpener refuses the spliced question and returns null', async () => {
    const complete = fakeComplete(SPLICED, SPLICED);

    const result = await composeOpener(snippet, complete);

    expect(result).toBeNull();
  });

  it('composeOpener accepts the framed question and records the fragment', async () => {
    const complete = fakeComplete(FRAMED);

    const result = await composeOpener(snippet, complete);

    expect(result).not.toBeNull();
    expect(result!.question).toBe(FRAMED);
    expect(result!.quotedFragment).toContain(RESONANCE_FRAGMENT);
    expect(snippet.prose).toContain(result!.quotedFragment!);
  });

  it('composeStillTrue refuses the spliced question and returns null', async () => {
    const complete = fakeComplete(SPLICED, SPLICED);

    const result = await composeStillTrue(snippet, complete);

    expect(result).toBeNull();
  });

  it('composeStillTrue accepts the framed question', async () => {
    const complete = fakeComplete(FRAMED);

    const result = await composeStillTrue(snippet, complete);

    expect(result).not.toBeNull();
    expect(result!.question).toBe(FRAMED);
  });

  it('composeJuxtaposition refuses the spliced question and returns null', async () => {
    const hit = makeResonanceHit({
      sharedPhrase: RESONANCE_FRAGMENT,
      snippetText: TURN_RESONANCE,
    });
    const complete = fakeComplete(SPLICED, SPLICED);

    const result = await composeJuxtaposition(TURN_RESONANCE, hit, complete);

    expect(result).toBeNull();
  });

  it('composeJuxtaposition accepts the framed question', async () => {
    const hit = makeResonanceHit({
      sharedPhrase: RESONANCE_FRAGMENT,
      snippetText: TURN_RESONANCE,
    });
    const complete = fakeComplete(FRAMED);

    const result = await composeJuxtaposition(TURN_RESONANCE, hit, complete);

    expect(result).toBe(FRAMED);
  });

  it('every compose prompt carries the framing rule', async () => {
    const prompts: string[] = [];
    const capture: Complete = async (system: string, turns: Turn[]) => {
      prompts.push(system.length > 0 ? system : (turns[0]?.text ?? ''));
      return FRAMED;
    };

    await composeFollowUp(TURN_RESONANCE, light, capture);
    await composeJuxtaposition(
      TURN_RESONANCE,
      makeResonanceHit({ sharedPhrase: RESONANCE_FRAGMENT, snippetText: TURN_RESONANCE }),
      capture,
    );
    await composeOpener(snippet, capture);
    await composeStillTrue(snippet, capture);
    await composeExpedition(snippet, capture);

    expect(prompts).toHaveLength(5);
    for (const prompt of prompts) {
      expect(prompt).toContain('frame the quote, never splice it');
      expect(prompt).toContain('inside quotation marks');
    }
  });
});

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
    const complete = fakeComplete(
      'You said "synergy". What did that look like on the day it happened?',
    );

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toBe('You said "synergy". What did that look like on the day it happened?');
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
      'What does that term mean?',                        // first — missing
      'You said "synergy". Can you give one example?',    // retry — quoted and framed
    );

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toContain('synergy');
  });

  it('strips markdown fences from LLM output', async () => {
    const complete = fakeComplete(
      '```\nYou said "synergy". What does that mean to you?\n```',
    );

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toBe('You said "synergy". What does that mean to you?');
  });

  it('rejects a declarative that quotes the phrase, then accepts the retry', async () => {
    const complete = fakeComplete(
      'You said "synergy", and that is worth examining.',  // quotes, but is not a question
      'You said "synergy". What did that look like on the day it worked?',
    );

    const result = await composeFollowUp(TURN_WITH_ODD_TERM, light, complete);

    expect(result).toBe('You said "synergy". What did that look like on the day it worked?');
  });

  it('retries a first-person leak outside the quote, then accepts second person', async () => {
    const turn = 'If a claim is popular, my hedges get shorter, and I stop saying what I think.';
    const hedges: RedLight = { kind: 'abstraction-no-episode', phrase: 'my hedges get shorter' };
    const complete = fakeComplete(
      'You wrote "my hedges get shorter". What does that protect me from?',   // "me" outside the quote
      'You wrote "my hedges get shorter". What does that protect you from?',  // person agrees
    );

    const result = await composeFollowUp(turn, hedges, complete);

    expect(result).toBe('You wrote "my hedges get shorter". What does that protect you from?');
  });

  it('returns null when both attempts leak first person outside the quote', async () => {
    const turn = 'If a claim is popular, my hedges get shorter, and I stop saying what I think.';
    const hedges: RedLight = { kind: 'abstraction-no-episode', phrase: 'my hedges get shorter' };
    const complete = fakeComplete(
      'You wrote "my hedges get shorter". What does that protect me from?',
      'You wrote "my hedges get shorter". What am I protecting?',
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
      'You wrote "deep work" — how does that connect to what you valued in January?',
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
      'You wrote "deep work" before — has anything changed?',
    );

    const result = await composeJuxtaposition(TURN_ECHO, hit, complete);

    expect(result).toContain('deep work');
  });

  it('rejects a statement that quotes the sharedPhrase but asks nothing', async () => {
    const complete = fakeComplete(
      'In January you wrote "deep work", and you still do.',
      'In January you wrote "deep work" — is that still where the hours go?',
    );

    const result = await composeJuxtaposition(TURN_ECHO, hit, complete);

    expect(result).toBe('In January you wrote "deep work" — is that still where the hours go?');
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
      'Has your perspective changed?',                                     // no quote
      'You wrote "Meetings steal my best hours." Is that still true?',      // quotes snippet, set off
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
