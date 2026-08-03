import { describe, it, expect } from 'vitest';
import { isNearDuplicate } from '../src/elicitor/guards.js';

/**
 * Ticket 111: the near-duplicate guard compared every word of the question,
 * quoted material included. A question that re-quotes the same Episode but
 * frames it differently was flagged as a repeat of the earlier question,
 * because the shared quotation dominated the word-set Jaccard score. The
 * guard now masks quotation-mark spans before comparing, so only the
 * agent-authored frame words count.
 */

describe('isNearDuplicate masks quoted spans (ticket 111)', () => {
  it('passes questions that share a quoted fragment but frame it differently', () => {
    // The same Episode is quoted verbatim in both; the frames differ. With
    // the quotation counted, the word sets overlap 16 of 24 (0.67 — a false
    // positive); with it masked, only the frames remain (3 of 11 ≈ 0.27).
    const prior =
      'In "The morning light crept across the valley floor and touched every blade of grass", what did the farmer notice first?';
    const question =
      'In "The morning light crept across the valley floor and touched every blade of grass", how did the farmer react to the change?';
    expect(isNearDuplicate(question, [prior])).toBe(false);
  });

  it('still flags questions with different quotes but similar frames', () => {
    // Different Episodes are quoted, but the frame is the same question.
    // Masking leaves the frames identical, so the guard still fires.
    const prior =
      'How does the story of "The Boy Who Cried Wolf" teach about honesty and consequences?';
    const question =
      'How does the story of "The Goose with the Golden Eggs" teach about honesty and consequences?';
    expect(isNearDuplicate(question, [prior])).toBe(true);
  });

  it('passes when the frame alone is too small to compare', () => {
    // After masking, the shared quote leaves only a two-word frame.
    expect(
      isNearDuplicate(
        'In "The morning light crept across the valley floor and touched every blade of grass", what changed?',
        [
          'In "The morning light crept across the valley floor and touched every blade of grass", why now?',
        ],
      ),
    ).toBe(false);
  });
});
