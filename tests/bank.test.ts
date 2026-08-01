import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadQuestionBank } from '../src/elicitor/bank.js';
import { starterBank } from '../src/elicitor/protocol.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bank-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a bank file (JSONL) into the temp dir and return its path. */
function writeBank(lines: string[]): string {
  const path = join(dir, 'questions.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');
  return path;
}

const QUESTION_FORMS = {
  deliberative: 'deliberative',
  theoretical: 'theoretical',
  why: 'why',
} as const;

describe('loadQuestionBank', () => {
  it('parses valid JSONL and classifies', () => {
    const path = writeBank([
      JSON.stringify({ question: 'Why do you garden?', channel: 'a', blockId: 1 }),
      JSON.stringify({ question: "What's a habit you kept?", channel: 'b', blockId: 2 }),
      JSON.stringify({ question: 'Tell me about your morning.', channel: 'c', blockId: 3 }),
    ]);

    const bank = loadQuestionBank(path);

    expect(bank).toHaveLength(3);
    expect(bank[0]!).toMatchObject({
      text: 'Why do you garden?',
      questionForm: QUESTION_FORMS.why,
    });
    expect(bank[1]!).toMatchObject({
      text: "What's a habit you kept?",
      questionForm: QUESTION_FORMS.deliberative,
    });
    expect(bank[2]!).toMatchObject({
      text: 'Tell me about your morning.',
      questionForm: QUESTION_FORMS.deliberative,
    });
  });

  it('deduplicates by lowercased trimmed text', () => {
    const path = writeBank([
      JSON.stringify({ question: 'Why do you write?' }),
      JSON.stringify({ question: 'why do you write?' }),
      JSON.stringify({ question: '  Why Do You Write?  ' }),
      JSON.stringify({ question: 'A different question' }),
    ]);

    const bank = loadQuestionBank(path);

    expect(bank).toHaveLength(2);
    // First occurrence wins, preserving its exact text.
    expect(bank[0]!.text).toBe('Why do you write?');
    expect(bank[1]!.text).toBe('A different question');
  });

  it('skips malformed lines', () => {
    const path = writeBank([
      JSON.stringify({ question: 'First question?' }),
      'this is not json {',
      JSON.stringify({ question: 'Second question?' }),
      '{"question": "truncated"',
    ]);

    const bank = loadQuestionBank(path);

    expect(bank).toHaveLength(2);
    expect(bank[0]!.text).toBe('First question?');
    expect(bank[1]!.text).toBe('Second question?');
  });

  it('classifies why-questions', () => {
    const path = writeBank([
      JSON.stringify({ question: 'Why do you exercise?' }),
      JSON.stringify({ question: 'why not try something new?' }),
      JSON.stringify({ question: 'Why?' }),
      JSON.stringify({ question: 'Tell me why that matters.' }),
    ]);

    const bank = loadQuestionBank(path);

    expect(bank.map((q) => q.questionForm)).toEqual([
      QUESTION_FORMS.why,
      QUESTION_FORMS.why,
      QUESTION_FORMS.why,
      QUESTION_FORMS.deliberative,
    ]);
  });

  it('returns starterBank fallback on missing file', () => {
    const bank = loadQuestionBank('/nonexistent/path.jsonl');

    expect(bank).toHaveLength(10);
    expect(bank).toEqual(starterBank);
  });

  it('returns starterBank fallback on empty file', () => {
    const path = writeBank([]);

    const bank = loadQuestionBank(path);

    expect(bank).toHaveLength(10);
    expect(bank).toEqual(starterBank);
  });

  it('source fields populate', () => {
    const path = writeBank([
      JSON.stringify({
        question: 'What do you work on?',
        channel: 'interview-7',
        channelTitle: 'The Long Game',
        blockId: 42,
      }),
    ]);

    const bank = loadQuestionBank(path);

    expect(bank).toHaveLength(1);
    const question = bank[0]!;
    expect(question.source).toEqual({
      channel: 'interview-7',
      channelTitle: 'The Long Game',
      blockId: 42,
    });
  });
});
