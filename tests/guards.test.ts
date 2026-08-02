import { describe, it, expect } from 'vitest';
import {
  isInterrogative,
  hasFirstPersonOutsideQuote,
  quotesFragmentSetOff,
  setOffSpans,
  isParrot,
  isConversationReferential,
  isNearDuplicate,
  checkQuestion,
} from '../src/elicitor/guards.js';

// ---------------------------------------------------------------------------
// The malformed question of 2026-08-02 (ticket 040), and its framed twin.
// Same fragment, same source turn — only the framing differs.
// ---------------------------------------------------------------------------

const SPLICED_FRAGMENT = 'I thought that I long lost';

const SPLICED_QUESTION =
  'When did you last experience the kind of resonance that I thought that I long lost?';

const FRAMED_QUESTION =
  'You wrote: "I thought that I long lost." When did you last feel that resonance again?';

// ---------------------------------------------------------------------------
// isInterrogative — eval 2026-08-02 #3
// ---------------------------------------------------------------------------

describe('isInterrogative', () => {
  it('accepts a question', () => {
    expect(isInterrogative('What did that cost you?')).toBe(true);
  });

  it('rejects a flat declarative', () => {
    // The opener minted live: the snippet's first sentence, unchanged.
    expect(isInterrogative('If a claim is popular, my hedges get shorter.')).toBe(
      false,
    );
  });

  it('rejects empty and whitespace-only text', () => {
    expect(isInterrogative('')).toBe(false);
    expect(isInterrogative('   ')).toBe(false);
  });

  it('accepts a question mark followed by a closing quote', () => {
    expect(isInterrogative('Is that still true?"')).toBe(true);
  });

  it('rejects the quoted fragment with only a question mark added', () => {
    const fragment = 'I value deep work over shallow productivity';
    expect(isInterrogative(`${fragment}?`, fragment)).toBe(false);
  });

  it('accepts a question built around the fragment', () => {
    const fragment = 'I value deep work over shallow productivity';
    expect(
      isInterrogative(`You wrote "${fragment}" — what changed since?`, fragment),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// quotesFragmentSetOff — ticket 040
// ---------------------------------------------------------------------------

describe('quotesFragmentSetOff', () => {
  it('rejects the malformed question that spliced the fragment mid-clause', () => {
    // Live evidence, 2026-08-02. Verbatim, so it passed Q-12 as it stood.
    expect(SPLICED_QUESTION).toContain(SPLICED_FRAGMENT);
    expect(quotesFragmentSetOff(SPLICED_QUESTION, SPLICED_FRAGMENT)).toBe(false);
  });

  it('accepts the same fragment framed as a quotation', () => {
    expect(quotesFragmentSetOff(FRAMED_QUESTION, SPLICED_FRAGMENT)).toBe(true);
  });

  it('accepts typographic and straight quotation marks alike', () => {
    const fragment = 'my hedges get shorter';
    expect(
      quotesFragmentSetOff(`You wrote “${fragment}.” What did that buy you?`, fragment),
    ).toBe(true);
    expect(
      quotesFragmentSetOff(`You wrote '${fragment}.' What did that buy you?`, fragment),
    ).toBe(true);
  });

  it('accepts a fragment standing on its own line', () => {
    const fragment = 'Meetings steal my best hours';
    expect(
      quotesFragmentSetOff(`You wrote:\n${fragment}.\nWhich meeting was the worst?`, fragment),
    ).toBe(true);
  });

  it('rejects a fragment that only trails an unmarked colon', () => {
    const fragment = 'Meetings steal my best hours';
    expect(
      quotesFragmentSetOff(`You wrote: ${fragment}. Which one was worst?`, fragment),
    ).toBe(false);
  });

  it('rejects an unclosed quotation mark', () => {
    const fragment = 'Meetings steal my best hours';
    expect(
      quotesFragmentSetOff(`You wrote "${fragment} — which one was worst?`, fragment),
    ).toBe(false);
  });

  it('accepts a fragment quoted inside a longer quotation', () => {
    const fragment = 'Meetings steal my best hours';
    const question = `You wrote: "I value deep work. ${fragment}." What changed?`;
    expect(quotesFragmentSetOff(question, fragment)).toBe(true);
  });

  it('does not read contraction apostrophes as a quotation', () => {
    const fragment = "it's my job to notice";
    expect(
      quotesFragmentSetOff(`Do you still think it's my job to notice?`, fragment),
    ).toBe(false);
  });

  it('rejects an empty fragment', () => {
    expect(quotesFragmentSetOff('You wrote "something" — and then?', '   ')).toBe(false);
  });
});

describe('setOffSpans', () => {
  it('returns the inner material of a quotation, delimiters excluded', () => {
    const text = 'You wrote "deep work" — still?';
    const spans = setOffSpans(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('deep work');
  });

  it('finds no span in a question that quotes nothing', () => {
    expect(setOffSpans(SPLICED_QUESTION, SPLICED_FRAGMENT)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// hasFirstPersonOutsideQuote — eval 2026-08-02 #5 (observed 6/6)
// ---------------------------------------------------------------------------

describe('hasFirstPersonOutsideQuote', () => {
  it('allows first person INSIDE double quotes', () => {
    expect(
      hasFirstPersonOutsideQuote(
        'You said "my hedges track my actual confidence" — what does that cost you?',
      ),
    ).toBe(false);
  });

  it('allows first person inside typographic quotes', () => {
    expect(
      hasFirstPersonOutsideQuote('You wrote “I value deep work” — how does that land now?'),
    ).toBe(false);
  });

  it('flags a pronoun that leaks past the closing quote', () => {
    // Verbatim from the eval: the quote's person carried outside the quote.
    expect(
      hasFirstPersonOutsideQuote(
        'You said "my hedges track my actual confidence" — particularly when considering my actual confidence?',
      ),
    ).toBe(true);
  });

  it('flags a leaked "I"', () => {
    expect(
      hasFirstPersonOutsideQuote(
        'What is the friction that produced it in whoever I learned it from?',
      ),
    ).toBe(true);
  });

  // 040: naming the fragment used to mask it wherever it appeared, which let an
  // unmarked splice launder the user's "my" into the agent's own clause.
  it('does NOT mask an unquoted fragment, even when it is named', () => {
    const fragment = 'Meetings steal my best hours';
    const question = `When you say ${fragment}, what does that look like on a Tuesday?`;
    expect(hasFirstPersonOutsideQuote(question, fragment)).toBe(true);
    expect(hasFirstPersonOutsideQuote(question)).toBe(true);
  });

  it('masks the fragment once it is set off in quotation marks', () => {
    const fragment = 'Meetings steal my best hours';
    const question = `You wrote: "${fragment}." What does that look like on a Tuesday?`;
    expect(hasFirstPersonOutsideQuote(question, fragment)).toBe(false);
  });

  it('masks a fragment standing on its own line', () => {
    const fragment = 'Meetings steal my best hours';
    const question = `You wrote:\n${fragment}.\nWhat did the worst one cost you?`;
    expect(hasFirstPersonOutsideQuote(question, fragment)).toBe(false);
    // Without the fragment, a bare line is just the agent talking.
    expect(hasFirstPersonOutsideQuote(question)).toBe(true);
  });

  it('flags the spliced first person of the malformed live question', () => {
    expect(hasFirstPersonOutsideQuote(SPLICED_QUESTION, SPLICED_FRAGMENT)).toBe(true);
    expect(hasFirstPersonOutsideQuote(FRAMED_QUESTION, SPLICED_FRAGMENT)).toBe(false);
  });

  it('does not treat contraction apostrophes as a quoted span', () => {
    expect(
      hasFirstPersonOutsideQuote("Don't you think it's my job to notice?"),
    ).toBe(true);
  });

  it('reads a straight-single-quoted span as a quote', () => {
    expect(
      hasFirstPersonOutsideQuote("You wrote 'my hedges get shorter' — what happens next?"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session guards
// ---------------------------------------------------------------------------

describe('isParrot', () => {
  it('flags four consecutive words lifted from the prompt', () => {
    const prompt = 'Ask the one question a good interviewer would ask next.';
    expect(isParrot('What is the one question a good interviewer would ask?', prompt)).toBe(
      true,
    );
  });

  it('passes a question shorter than four words', () => {
    expect(isParrot('What drives you?', 'What drives you? is forbidden')).toBe(false);
  });

  it('passes a fresh question', () => {
    expect(
      isParrot('When did you last change your mind?', 'You are conducting an interview.'),
    ).toBe(false);
  });
});

describe('isConversationReferential', () => {
  it('flags questions about the conversation itself', () => {
    expect(
      isConversationReferential('What are you trying to achieve in this conversation?'),
    ).toBe(true);
  });

  it('passes questions about what the speaker said', () => {
    expect(isConversationReferential('What did that cost you?')).toBe(false);
  });
});

describe('isNearDuplicate', () => {
  it('flags a repeat asked minutes earlier, whichever branch composed it', () => {
    const asked = [
      "Back in March you wrote I default to hedging — what did that cost you?",
    ];
    expect(
      isNearDuplicate(
        "Back in March you wrote I default to hedging — what has that cost you?",
        asked,
      ),
    ).toBe(true);
  });

  it('passes a genuinely different question', () => {
    const asked = ['What did that cost you?'];
    expect(isNearDuplicate('When did you first notice that pattern?', asked)).toBe(false);
  });

  it('passes when nothing has been asked yet', () => {
    expect(isNearDuplicate('What did that cost you?', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkQuestion — the choke point
// ---------------------------------------------------------------------------

describe('checkQuestion', () => {
  it('returns ok for a fresh question', () => {
    expect(
      checkQuestion('When did you first notice that pattern?', { asked: [] }),
    ).toBe('ok');
  });

  it('skips the parrot check when no prompt produced the question', () => {
    const prompt = 'Ask the one question a good interviewer would ask next.';
    const composed = 'What is the one question a good interviewer would ask?';
    expect(checkQuestion(composed, { asked: [] })).toBe('ok');
    expect(checkQuestion(composed, { asked: [], systemPrompt: prompt })).toBe('parrot');
  });

  it('catches a conversation-referential question with no prompt in hand', () => {
    expect(
      checkQuestion('What is this conversation for?', { asked: [] }),
    ).toBe('conversation-referential');
  });

  it('catches a near-duplicate with no prompt in hand', () => {
    expect(
      checkQuestion('What did that cost you most?', {
        asked: ['What did that cost you?'],
      }),
    ).toBe('near-duplicate');
  });
});
