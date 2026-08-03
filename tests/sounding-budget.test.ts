import { describe, test, expect } from 'vitest';
import { rungAllowance, expectedLengthSentence } from '../src/sounding/budget.js';

describe('rungAllowance', () => {
  test('a long remaining budget is capped at twelve rungs', () => {
    expect(rungAllowance({ minutes: 20, energy: 'high' }, 5).allowance).toBe(12);
  });

  test('a short remaining budget floors at eight rungs', () => {
    // 15m budget = 15; close reserved at 13; entered at question 11 → 2 remaining → floored to 8.
    expect(rungAllowance({ minutes: 15, energy: 'high' }, 11).allowance).toBe(8);
  });

  test('a mid remaining budget converts straight across', () => {
    // 20m budget = 20; close reserved at 18; entered at question 8 → 10 remaining.
    expect(rungAllowance({ minutes: 20, energy: 'high' }, 8).allowance).toBe(10);
  });

  test('the checkpoint is the halfway rung, rounded up', () => {
    expect(rungAllowance({ minutes: 20, energy: 'high' }, 5).checkpointRung).toBe(6);
    expect(rungAllowance({ minutes: 15, energy: 'high' }, 11).checkpointRung).toBe(4);
  });
});

describe('expectedLengthSentence', () => {
  test('the consent sentence states a number the person can hold', () => {
    const line = expectedLengthSentence(9);
    expect(line).toContain('9');
    expect(line.toLowerCase()).not.toContain('deep'); // no promise about what it will find
  });
});
