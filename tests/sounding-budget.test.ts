import { describe, test, expect } from 'vitest';
import { rungAllowance, expectedLengthSentence } from '../src/sounding/budget.js';

describe('rungAllowance', () => {
  test('runs on the fixed SESSION_BUDGET, not a declared minutes value', () => {
    // The budget is one constant (canon §5.3): 10 questions, door at 8. The
    // mode no longer declares minutes, so any mode derives the same allowance.
    const a = rungAllowance({}, 5).allowance;
    const b = rungAllowance({ target: 'domain' }, 5).allowance;
    expect(a).toBe(8);
    expect(b).toBe(8);
  });

  test('a short remaining budget floors at eight rungs', () => {
    // Budget 10; close reserved at 8; entered at question 11 → remaining
    // negative → floored to 8.
    expect(rungAllowance({}, 11).allowance).toBe(8);
  });

  test('the close reservation holds: entered exactly at the door still has 8', () => {
    // remaining = 10 - 2 - questionCount. Entered at question 8 (the door)
    // → 0 remaining → floored to 8.
    expect(rungAllowance({}, 8).allowance).toBe(8);
  });

  test('the checkpoint is the halfway rung, rounded up', () => {
    expect(rungAllowance({}, 5).checkpointRung).toBe(4);
    expect(rungAllowance({}, 11).checkpointRung).toBe(4);
  });
});

describe('expectedLengthSentence', () => {
  test('the consent sentence states a number the person can hold', () => {
    const line = expectedLengthSentence(9);
    expect(line).toContain('9');
    expect(line.toLowerCase()).not.toContain('deep'); // no promise about what it will find
  });
});
