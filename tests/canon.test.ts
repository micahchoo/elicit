import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLOSING_DOOR_QUESTION } from '../src/elicitor/protocol.js';

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

  it('CONTEXT.md and the register quote the close question', () => {
    // Both documents must contain the literal strings; if a future edit
    // rewords the spec, this fails and forces a deliberate decision.
    expect(context).toContain("anything else we didn't touch?");
    expect(register).toContain("anything else we didn't touch?");
  });

  it('the close question in code matches the spec string (Q-20)', () => {
    expect(CLOSING_DOOR_QUESTION.toLowerCase()).toBe("anything else we didn't touch?");
  });
});

/**
 * The Clerk's vocabulary: the op names, the status names and the two
 * contradiction types are register decisions, and the wiki contract spells them
 * as type literals. Both sides are read from disk here, so nothing in this
 * block can pass by comparing a constant with itself.
 *
 * The register is a markdown table keyed by decision id, so a row can be
 * addressed directly — an op name found ANYWHERE in the register would also be
 * satisfied by Q-32's sentence about minting referents, which is a different
 * MINT.
 */
describe('canon conformance: the Clerk write contract', () => {
  const root = join(import.meta.dirname, '..');
  const register = readFileSync(join(root, 'docs/decisions/elicit.md'), 'utf-8');
  const context = readFileSync(join(root, 'CONTEXT.md'), 'utf-8');
  const contract = readFileSync(join(root, 'src/wiki/contract.ts'), 'utf-8');

  /** One decision's row, addressed by id. Throws rather than silently matching nothing. */
  function row(id: string): string {
    const found = register.split('\n').find((line) => line.startsWith(`| ${id} |`));
    if (!found) throw new Error(`the decision register has no row for ${id}`);
    return found;
  }

  const OPS = ['MINT', 'UPDATE', 'MERGE', 'SUPERSEDE', 'ARCHIVE', 'KEEP'];
  const STATUSES = ['unconfirmed', 'evidenced', 'user-attested', 'contested'];

  it('the six op names in the contract are the six Q-29 names', () => {
    const q29 = row('Q-29');
    for (const op of OPS) {
      expect(q29).toContain(op);
      // As a quoted literal, so a name that survives only in a comment fails.
      expect(contract).toContain(`op: '${op}'`);
    }
  });

  it('the four status names in the contract are the four Q-21 names', () => {
    const q21 = row('Q-21');
    for (const status of STATUSES) {
      expect(q21).toContain(status);
      expect(contract).toContain(`'${status}'`);
    }
    // And the union carries exactly those four, in the register's own order.
    expect(contract).toContain(
      "export type ClaimStatus = 'unconfirmed' | 'evidenced' | 'user-attested' | 'contested'"
    );
  });

  it('Q-29 says the status is not the model\'s to write, and the op union has no word for it', () => {
    expect(row('Q-29')).toContain('Status is never model-writable');
    // The union's own text, from `export type ClerkOp` to the semicolon that
    // ends it. Q-29 becomes structural only if this block mentions neither
    // `status` nor `attested` — the two fields a user verb or arithmetic owns.
    const union = /export type ClerkOp =[\s\S]*?\n\n/.exec(contract)?.[0];
    expect(union).toBeDefined();
    expect(union).toContain("op: 'KEEP'");
    expect(union).not.toMatch(/\bstatus\b/);
    expect(union).not.toMatch(/\battested\b/);
  });

  it('the model-upgrade supersede reason matches Q-34', () => {
    expect(row('Q-34')).toContain('model-upgrade');
    expect(contract).toContain("'model-upgrade'");
  });

  it('both contradiction types in the contract are the two the canon names', () => {
    // CONTEXT.md is the oracle for the PAIR: its Contradiction entry is the one
    // place that types a Contradiction as one or the other. The register names
    // `Synchronic` in Q-30's title and `diachronic` in Q-27 and Q-39 — the two
    // words are canon, but no single register row holds both, so scoping this
    // assertion to Q-30 would fail against a register that is not wrong.
    const contradiction = context
      .split('\n\n')
      .find((block) => block.startsWith('**Contradiction**:'));
    expect(contradiction).toBeDefined();
    for (const type of ['synchronic', 'diachronic']) {
      expect(contradiction).toContain(type);
      expect(register.toLowerCase()).toContain(type);
      expect(contract).toContain(`'${type}'`);
    }
    expect(row('Q-30').toLowerCase()).toContain('synchronic');
  });

  it('the claim anatomy Q-21 makes mandatory is mandatory in the type', () => {
    const q21 = row('Q-21');
    expect(q21).toContain('mandatory Range');
    expect(q21).toContain('mandatory cites');
    // Non-optional in the declaration: `range?:` or `cites?:` would let a claim
    // exist without the thing that makes it a claim.
    expect(contract).toMatch(/^\s{2}range: string;$/m);
    expect(contract).toMatch(/^\s{2}cites: string\[\];$/m);
    expect(contract).not.toMatch(/^\s{2}(range|cites)\?:/m);
  });
});
