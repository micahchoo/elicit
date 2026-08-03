import { describe, it, expect, vi } from 'vitest';
import { composeOutcomeQuestion } from '../src/clerk/composed.js';
import { makeScriptedComplete } from './fakes.js';
import type { Snippet } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTENTION = 'I will finish the quarterly review by Friday.';
const ORIGINAL_QUESTION = 'What are you planning to do this week?';

function makeIntention(overrides?: Partial<Snippet>): Snippet {
  return {
    id: 'sn-out-1',
    version: 2,
    captured: '2026-07-01T09:00:00Z',
    provenance: {
      kind: 'harvest',
      session: 'sess-1',
      question: ORIGINAL_QUESTION,
      questionForm: 'deliberative',
      span: { start: 0, end: 40 },
    },
    prose: INTENTION,
    ...overrides,
  };
}

/** Quotes the intention verbatim, is a question, and does not repeat the original. */
const GOOD_QUESTION =
  'You wrote "I will finish the quarterly review by Friday." Did it get done?';

// ---------------------------------------------------------------------------
// composeOutcomeQuestion
// ---------------------------------------------------------------------------

describe('composeOutcomeQuestion', () => {
  it('accepts a question that quotes the intention verbatim and asks something new', async () => {
    const complete = makeScriptedComplete([GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(makeIntention(), 'now', complete);

    expect(result).not.toBeNull();
    const draft = result!;
    expect(draft.source).toBe('outcome');
    expect(draft.question).toBe(GOOD_QUESTION);
    expect(draft.license).toBe('CC0');
    expect(draft.questionForm).toBe('deliberative');
    expect(draft.sharpness).toBe('weak');
    expect(draft.cites).toEqual(['sn-out-1@2']);
  });

  it('rejects a question that repeats the original eliciting question, twice, and returns null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const complete = makeScriptedComplete([
      ORIGINAL_QUESTION,
      `Why bring up "What are you planning to do this week?" again?`,
    ]);

    const result = await composeOutcomeQuestion(makeIntention(), 'days', complete);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('repeats-original'));
    warn.mockRestore();
  });

  it('succeeds on retry when the first attempt repeats the original and the retry does not', async () => {
    const complete = makeScriptedComplete([ORIGINAL_QUESTION, GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(makeIntention(), 'days', complete);

    expect(result).not.toBeNull();
    expect(result!.question).toBe(GOOD_QUESTION);
  });

  it('rejects a question that quotes nothing from the intention, twice, and returns null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const complete = makeScriptedComplete([
      'Did it get done in the end?',
      'Has the review been finished?',
    ]);

    const result = await composeOutcomeQuestion(makeIntention(), 'session', complete);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no-quote'));
    warn.mockRestore();
  });

  it('succeeds on retry when the first attempt quotes nothing and the retry quotes the intention', async () => {
    const complete = makeScriptedComplete(['Did it get done?', GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(makeIntention(), 'now', complete);

    expect(result).not.toBeNull();
    expect(result!.question).toBe(GOOD_QUESTION);
  });

  it('records the verbatim fragment of the intention that the question quotes', async () => {
    const question = 'You wrote "finish the quarterly review" — did you manage it?';
    const complete = makeScriptedComplete([question]);

    const result = await composeOutcomeQuestion(makeIntention(), 'days', complete);

    expect(result).not.toBeNull();
    const draft = result!;
    expect(draft.quotedFragment).toBe('finish the quarterly review');
    expect(INTENTION).toContain(draft.quotedFragment!);
    expect(draft.question).toContain(draft.quotedFragment!);
  });

  it('rejects a fragment spliced unmarked into the question and accepts a framed retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const complete = makeScriptedComplete([
      'Did you finish the quarterly review by Friday?',
      GOOD_QUESTION,
    ]);

    const result = await composeOutcomeQuestion(makeIntention(), 'now', complete);

    expect(result).not.toBeNull();
    expect(result!.question).toBe(GOOD_QUESTION);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unframed-quote'));
    warn.mockRestore();
  });

  it("maps a 'now' intention horizon to a 'session' outcome horizon", async () => {
    const complete = makeScriptedComplete([GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(makeIntention(), 'now', complete);

    expect(result).not.toBeNull();
    expect(result!.horizon).toBe('session');
  });

  it("maps a 'session' intention horizon to a 'days' outcome horizon", async () => {
    const complete = makeScriptedComplete([GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(makeIntention(), 'session', complete);

    expect(result).not.toBeNull();
    expect(result!.horizon).toBe('days');
  });

  it("maps a 'days' intention horizon to a 'days' outcome horizon", async () => {
    const complete = makeScriptedComplete([GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(makeIntention(), 'days', complete);

    expect(result).not.toBeNull();
    expect(result!.horizon).toBe('days');
  });

  it('propagates sitting target and topic onto the draft when provided', async () => {
    const complete = makeScriptedComplete([GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(
      makeIntention(),
      'days',
      complete,
      { target: 'domain', topic: 'work' },
    );

    expect(result).not.toBeNull();
    expect(result!.target).toBe('domain');
    expect(result!.topic).toBe('work');
  });

  it('leaves target and topic absent when no sitting is provided', async () => {
    const complete = makeScriptedComplete([GOOD_QUESTION]);

    const result = await composeOutcomeQuestion(makeIntention(), 'days', complete);

    expect(result).not.toBeNull();
    expect(result!.target).toBeUndefined();
    expect(result!.topic).toBeUndefined();
  });
});
