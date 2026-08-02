import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLOSING_DOOR_QUESTION, CLOSING_BOOKMARK_QUESTION } from '../src/elicitor/protocol.js';

/**
 * Canon conformance: user-facing strings that CONTEXT.md or the decision
 * register specify VERBATIM must match the code.
 *
 * The oracle is the spec file itself, read at test time — not a constant
 * shared with the implementation. Unit tests that assert
 * `CLOSING_DOOR_QUESTION === CLOSING_DOOR_QUESTION` pass while the string
 * drifts off-spec; that is exactly how "What door is this opening?" (the
 * LLM paraphrase ticket 023 was meant to eliminate) survived a green suite
 * and shipped. See docs/eval-2026-08-02-claude-adversarial.md finding #2.
 */
describe('canon conformance', () => {
  const root = join(import.meta.dirname, '..');
  const context = readFileSync(join(root, 'CONTEXT.md'), 'utf-8');
  const register = readFileSync(join(root, 'docs/decisions/elicit.md'), 'utf-8');

  it('CONTEXT.md and the register quote the same two close questions', () => {
    // Both documents must contain the literal strings; if a future edit
    // rewords the spec, this fails and forces a deliberate decision.
    expect(context).toContain("anything else we didn't touch?");
    expect(context).toContain('where should we pick up?');
    expect(register).toContain("anything else we didn't touch?");
    expect(register).toContain('where should we pick up?');
  });

  it('the close questions in code match the spec strings (Q-20)', () => {
    expect(CLOSING_DOOR_QUESTION.toLowerCase()).toBe("anything else we didn't touch?");
    expect(CLOSING_BOOKMARK_QUESTION.toLowerCase()).toBe('where should we pick up?');
  });
});
