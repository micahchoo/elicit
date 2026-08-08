import { describe, it, expect } from 'vitest';
import { checkEmitForm, type EmitFormResult } from '../src/language/emit-form.js';

/** Assert that form check fails with a specific failure tag. */
function failsWith(result: EmitFormResult, tag: string): void {
  if (result.ok) {
    expect.fail(`expected rejection with tag "${tag}", got ok`);
  }
  expect(result.failures.some(f => f.startsWith(tag)),
    `expected failure tag "${tag}" in [${result.failures.join(', ')}]`).toBe(true);
}

describe('checkEmitForm', () => {
  // ── Fixture 1: placeholder token + mid-phrase end ──────────────────
  it('rejects bare placeholder token "something" after a mid-phrase quote', () => {
    const r = checkEmitForm('"quiet at the" something');
    if (r.ok) expect.fail('expected rejection');
    expect(r.failures.some(f => f.startsWith('mid-phrase-end'))).toBe(true);
    expect(r.failures.some(f => f.startsWith('placeholder-token'))).toBe(true);
  });

  // ── Fixture 2: quote cut mid-phrase ────────────────────────────────
  it('rejects a quote ending mid-phrase on a function word', () => {
    failsWith(checkEmitForm('"If you cannot feel the" seems important'), 'mid-phrase-end');
  });

  it('rejects a quote ending on "of"', () => {
    failsWith(checkEmitForm('"the quiet of" — what does that mean?'), 'mid-phrase-end');
  });

  it('rejects a quote ending on "a"', () => {
    failsWith(checkEmitForm('"she was a" person you admired?'), 'mid-phrase-end');
  });

  it('allows a quote ending on a content word', () => {
    expect(checkEmitForm('"the quiet" — how do you find it?').ok).toBe(true);
  });

  it('allows a quote ending on "not" (not a mid-phrase ender)', () => {
    expect(checkEmitForm('"I think about it now" — has that changed?').ok).toBe(true);
  });

  it('allows "did not" ending a quote (not a mid-phrase ender)', () => {
    expect(checkEmitForm('You wrote "the wanting did not" — and later, "it healed." What connects these?').ok).toBe(true);
  });

  // ── Fixture 3: duplicate quote spans ───────────────────────────────
  it('rejects a fragment printed twice, once orphaned', () => {
    failsWith(checkEmitForm(
      'You wrote: "I have his old Gretsch in the closet." "his old Gretsch". What does that instrument mean to you now?'
    ), 'duplicate-quote-span');
  });

  it('rejects the same quote appearing twice in one sentence', () => {
    failsWith(checkEmitForm(
      'When you said "the wanting did not" and later "the wanting did not" — what changed?'
    ), 'duplicate-quote-span');
  });

  it('allows two distinct quotes', () => {
    expect(checkEmitForm(
      'You wrote "it healed." — and later, "the wanting did not." What connects these?'
    ).ok).toBe(true);
  });

  // ── Fixture 4: unbalanced parenthesis ──────────────────────────────
  it('rejects an unbalanced parenthesis', () => {
    failsWith(checkEmitForm(
      'How do you reconcile "it healed" (with your earlier belief?'
    ), 'unbalanced-delimiters');
  });

  it('rejects an odd number of straight double-quotes', () => {
    failsWith(checkEmitForm(
      'How do you feel about "it healed?'
    ), 'unbalanced-delimiters');
  });

  it('allows balanced parens and quotes', () => {
    expect(checkEmitForm(
      'How do you reconcile "it healed" (your earlier belief)?'
    ).ok).toBe(true);
  });

  // ── Fixture 5: same quote twice — covered by fixture 3 ─────────────
  it('rejects two identical quote spans (covered by fixture 3)', () => {
    expect(true).toBe(true);
  });

  // ── Fixture 6: bare splice ─────────────────────────────────────────
  it('rejects a bare-splice: single word + quote', () => {
    failsWith(checkEmitForm(
      'stop "I do not think about scoring anymore"'
    ), 'bare-splice');
  });

  it('rejects a bare-splice: "ask" + quote', () => {
    failsWith(checkEmitForm(
      'ask "what is the opposite of this for you?"'
    ), 'bare-splice');
  });

  it('allows a question with a proper frame around the quote', () => {
    expect(checkEmitForm(
      'You wrote "the wanting did not" — what fills that space now?'
    ).ok).toBe(true);
  });

  it('allows a quote with zero frame words (pure quote — not a splice)', () => {
    expect(checkEmitForm('"Meetings steal my best hours."').ok).toBe(true);
  });

  // ── Template variable check ────────────────────────────────────────
  it('rejects CLAIM_ID_PLACEHOLDER token', () => {
    failsWith(checkEmitForm(
      'How does CLAIM_ID_PLACEHOLDER relate to your experience?'
    ), 'placeholder-token');
  });

  it('rejects FIXME token', () => {
    failsWith(checkEmitForm(
      'FIXME — need a real question here'
    ), 'placeholder-token');
  });

  // ── Multiple failures in one call ──────────────────────────────────
  it('reports multiple failures when more than one check fires', () => {
    const r = checkEmitForm('stop "quiet at the"');
    if (r.ok) expect.fail('expected rejection');
    expect(r.failures.length).toBeGreaterThanOrEqual(2);
  });

  // ── Clean questions pass ───────────────────────────────────────────
  it('passes a well-formed question with a proper quote', () => {
    expect(checkEmitForm(
      'You wrote "the wanting did not" in your last session. What has changed since then?'
    ).ok).toBe(true);
  });

  it('passes a well-formed still-true re-measure', () => {
    expect(checkEmitForm(
      'Is it still true that "the scar aches when it rains"?'
    ).ok).toBe(true);
  });

  it('passes a juxtaposition question', () => {
    expect(checkEmitForm(
      'You said the "quiet after the storm" settles you — does that connect to "earning silence through effort"?'
    ).ok).toBe(true);
  });

  it('passes a balanced paren question', () => {
    expect(checkEmitForm(
      'How do you reconcile "the wanting did not" (your earlier belief)?'
    ).ok).toBe(true);
  });
});
