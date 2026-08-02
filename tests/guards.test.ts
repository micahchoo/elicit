import { describe, it, expect } from 'vitest';
import {
  isInterrogative,
  hasFirstPersonOutsideQuote,
  isParrot,
  isConversationReferential,
  isNearDuplicate,
  checkQuestion,
} from '../src/elicitor/guards.js';

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

  it('masks an UNQUOTED verbatim fragment when it is named', () => {
    const fragment = 'Meetings steal my best hours';
    const question = `When you say ${fragment}, what does that look like on a Tuesday?`;
    expect(hasFirstPersonOutsideQuote(question, fragment)).toBe(false);
    // Without the fragment there is no way to tell the quote from the frame.
    expect(hasFirstPersonOutsideQuote(question)).toBe(true);
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
