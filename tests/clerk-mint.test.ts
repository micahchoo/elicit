import { describe, it, expect } from 'vitest';
import { proposeOps, MINT_PAYLOAD_BUDGET, SNIPPET_FLOOR } from '../src/clerk/mint.js';
import type { Claim } from '../src/wiki/contract.js';
import type { Complete, Reading, Snippet, Turn } from '../src/types.js';

/**
 * Minting: one reading becomes proposed ops, and nothing else.
 *
 * Every test drives a SCRIPTED completer — the live model is never called from
 * here, and a scripted one is the only way to test the outputs that matter
 * (prose instead of JSON, an op carrying `status`, a cite to a version that was
 * never written).
 *
 * The oracle for each rejection is the wiki contract, never this module's
 * implementation: an op that fails to typecheck as a `ClerkOp` must not be
 * returned as one, because `proposeOps` promises `ClerkOp[]` and a promise the
 * compiler cannot check is a promise the tests have to.
 */

// ── Fixtures ──

const READING_ID = '01K1MINTREADING000000000AA';

function makeReading(prose: string, cites: string[] = ['snipA@1']): Reading {
  return {
    id: READING_ID,
    facet: 'value',
    stance: 'avowal',
    cites,
    reading: prose,
    at: '2026-08-02T00:00:00.000Z',
  };
}

function makeSnippet(
  id: string,
  prose: string,
  version = 1,
  lineage: { question?: string; context?: string } = {},
): Snippet {
  return {
    id,
    version,
    captured: '2026-08-01T12:00:00.000Z',
    provenance: {
      kind: 'harvest',
      session: 'sitting-1',
      question: lineage.question ?? 'What did you choose?',
      questionForm: 'deliberative',
      ...(lineage.context !== undefined ? { context: lineage.context } : {}),
    },
    prose,
  };
}

function makeClaim(id: string, body: string): Claim {
  return {
    id,
    body,
    range: 'at work, since 2024',
    status: 'unconfirmed',
    cites: ['snipA@1'],
    facet: 'value',
    referents: [],
    fromReadings: [],
    attested: false,
    readLog: [],
    model: 'qwen3.6:35b',
    modelAt: '2026-08-01T12:00:00.000Z',
    created: '2026-08-01T12:00:00.000Z',
    updated: '2026-08-01T12:00:00.000Z',
  };
}

type Item = Parameters<typeof proposeOps>[0];

/** The ordinary case: one reading, one cited snippet, no related claims. */
function baseItem(): Item {
  return {
    reading: makeReading('The person places autonomy above security at work.'),
    snippets: { snipA: makeSnippet('snipA', 'I would leave a job that took my direction away, even for less money.') },
    relatedClaims: [],
  };
}

type Call = { system: string; turns: Turn[]; opts: { temperature?: number } | undefined };

/** A completer that records every call and answers from a script, in order. */
function recorder(responses: string[]): { complete: Complete; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const complete: Complete = async (system, turns, opts) => {
    calls.push({ system, turns, opts });
    const next = responses[i++];
    if (next === undefined) throw new Error(`scripted completer exhausted after ${responses.length}`);
    return next;
  };
  return { complete, calls };
}

/** A well-formed MINT of the base item, as the model would return it. */
function mintOp(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: 'MINT',
    reading: READING_ID,
    body: 'The person treats self-direction as worth more than pay.',
    range: 'at work',
    cites: ['snipA@1'],
    facet: 'value',
    ...extra,
  };
}

// ===========================================================================

describe('proposeOps — the call', () => {
  it('sends exactly one user-role turn, inside budget, at extraction temperature', async () => {
    // Ticket 034: one item per call. Ticket 023: the list must END on a user
    // turn or llama.cpp generates nothing at all.
    const { complete, calls } = recorder([JSON.stringify([mintOp()])]);
    await proposeOps(baseItem(), complete);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.turns).toHaveLength(1);
    expect(call.turns[0]!.role).toBe('user');
    expect(call.turns[0]!.text.length).toBeLessThanOrEqual(MINT_PAYLOAD_BUDGET);
    expect(call.opts?.temperature).toBe(0.2);
  });

  it('never says the word status, in the system prompt or in the payload', async () => {
    // Q-29, layer one: Status is not in the vocabulary the model is taught, so
    // a related claim is shown WITHOUT its status field. Layer two is the
    // parser; this is the layer that means the parser rarely has to fire.
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(
      { ...baseItem(), relatedClaims: [makeClaim('claim-1', 'The person values self-direction.')] },
      complete
    );

    const call = calls[0]!;
    expect(call.system).not.toMatch(/status/i);
    expect(call.system).not.toMatch(/attested/i);
    expect(call.turns[0]!.text).not.toMatch(/status/i);
    expect(call.turns[0]!.text).not.toMatch(/attested/i);
  });

  it('teaches all six ops and nothing else', async () => {
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(baseItem(), complete);
    for (const op of ['MINT', 'UPDATE', 'MERGE', 'SUPERSEDE', 'ARCHIVE', 'KEEP']) {
      expect(calls[0]!.system).toContain(op);
    }
  });

  it('shows at most three related claims and at most three cited snippets', async () => {
    // The cap is the caller contract, and it is enforced HERE rather than
    // trusted: a caller that hands over five claims spends its budget on the
    // first three and loses nothing else.
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(
      {
        reading: makeReading('A short reading.', ['s1@1', 's2@1', 's3@1', 's4@1']),
        snippets: {
          s1: makeSnippet('s1', 'one'),
          s2: makeSnippet('s2', 'two'),
          s3: makeSnippet('s3', 'three'),
          s4: makeSnippet('s4', 'four'),
        },
        relatedClaims: [1, 2, 3, 4, 5].map((n) => makeClaim(`claim-${n}`, `Body number ${n}.`)),
      },
      complete
    );

    const payload = calls[0]!.turns[0]!.text;
    expect(payload).toContain('claim-3');
    expect(payload).not.toContain('claim-4');
    expect(payload).not.toContain('claim-5');
    expect(payload).toContain('SNIPPET s3@1');
    expect(payload).not.toContain('SNIPPET s4@1');
  });
});

describe('proposeOps — ticket 087: the claim-quality correctives', () => {
  it('names one subject form — "The user" — and forbids the drift RESULTS 16.2 measured', async () => {
    // The corrective's shape: ONE canonical form stated, the measured drift
    // named as forbidden ("The user" 59 / "The person" 28 / "The author" 2 /
    // bare "They" most of the rest).
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(baseItem(), complete);

    const system = calls[0]!.system;
    expect(system).toMatch(/every body names them the same way: "The user"/);
    expect(system).toContain('Never "The person"');
    expect(system).toContain('never "The author"');
    expect(system).toContain('never a bare "They"');
  });

  it('keeps referent discipline with the 085 exemplars: ma\'am is never their mother', async () => {
    // Mode 2 of the 085 review: the severe case resolved "ma'am" to a
    // relation that appears nowhere in the prose; the mild case read a named
    // work as a common noun. The prompt must carry both exemplars.
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(baseItem(), complete);

    const system = calls[0]!.system;
    expect(system).toContain('"ma\'am" stays "ma\'am"');
    expect(system).toContain('never "their mother"');
    expect(system).toContain('"Clement Valla\'s Binder"');
    expect(system).toContain('never "a binder"');
  });

  it('binds modality to the prose: completed work is never filed as facet "intention"', async () => {
    // Mode 3 of the 085 review: two completed works filed as `facet:
    // intention`. The corrective is a verb-mode rule, stated with the facet
    // corruption it protects.
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(baseItem(), complete);

    expect(calls[0]!.system).toContain('Completed work is never filed as facet "intention"');
    expect(calls[0]!.system).toContain('If the prose says they did it, the claim says they did it');
  });

  it('keeps the prose\'s hedges: observer and collective agency survive', async () => {
    // Mode 4 of the 085 review: "as far as I saw it" and "a conscious
    // unspoken decision" (collective) flattened to sole agency. The hedge
    // IS the content.
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(baseItem(), complete);

    const system = calls[0]!.system;
    expect(system).toContain('"As far as I saw it" stays an observer\'s view');
    expect(system).toContain('a decision the prose describes as shared stays shared');
  });
});

describe('proposeOps — parsing', () => {
  it('parses a JSON array of ops', async () => {
    const { complete } = recorder([JSON.stringify([mintOp()])]);
    const { ops, raw, diagnostics } = await proposeOps(baseItem(), complete);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      op: 'MINT',
      reading: READING_ID,
      body: 'The person treats self-direction as worth more than pay.',
      range: 'at work',
      cites: ['snipA@1'],
      facet: 'value',
    });
    expect(diagnostics.parsed).toBe(true);
    expect(diagnostics.parseMode).toBe('json');
    expect(diagnostics.opsSeen).toBe(1);
    expect(diagnostics.oversized).toBe(false);
    expect(diagnostics.rawChars).toBe(raw.length);
  });

  it('accepts a fenced array and an {"ops": [...]} wrapper', async () => {
    // Freedom in generation, rigidity in validation (Q-36). How the model
    // wrapped its answer is not an invariant; what the ops contain is.
    const fenced = await proposeOps(
      baseItem(),
      recorder(['```json\n' + JSON.stringify([mintOp()]) + '\n```']).complete
    );
    expect(fenced.ops).toHaveLength(1);

    const wrapped = await proposeOps(
      baseItem(),
      recorder([JSON.stringify({ ops: [mintOp()] })]).complete
    );
    expect(wrapped.ops).toHaveLength(1);
  });

  it('never lets a parse failure and an honest empty answer look alike', async () => {
    // Eval finding #1's lesson: "the output did not parse" and "the model
    // proposed nothing" are different facts about the run, and a caller that
    // cannot tell them apart cannot act on either.
    const failed = await proposeOps(
      baseItem(),
      recorder(['I think this person really values their independence.']).complete
    );
    const empty = await proposeOps(baseItem(), recorder([JSON.stringify([])]).complete);

    expect(failed.ops).toEqual([]);
    expect(empty.ops).toEqual([]);
    expect(failed.diagnostics).not.toEqual(empty.diagnostics);

    expect(failed.diagnostics.parsed).toBe(false);
    expect(failed.diagnostics.parseMode).toBe('failed');
    expect(empty.diagnostics.parsed).toBe(true);
    expect(empty.diagnostics.parseMode).toBe('json');
    expect(empty.diagnostics.opsSeen).toBe(0);
  });

  it('returns the raw output of a failed parse rather than swallowing it', async () => {
    const prose = 'Nothing here is JSON.';
    const { raw, diagnostics } = await proposeOps(baseItem(), recorder([prose]).complete);
    expect(raw).toBe(prose);
    expect(diagnostics.rawChars).toBe(prose.length);
  });
});

describe('proposeOps — Q-29: status is never model-writable', () => {
  it('strips a status key off an op and counts the strip', async () => {
    const { complete } = recorder([JSON.stringify([mintOp({ status: 'evidenced' })])]);
    const { ops, diagnostics } = await proposeOps(baseItem(), complete);

    expect(ops).toHaveLength(1);
    expect(Object.keys(ops[0]!)).not.toContain('status');
    expect(diagnostics.statusKeysStripped).toBe(1);
  });

  it('strips attested, and drops any other key the vocabulary does not have', async () => {
    // The op is rebuilt field by field from the contract's shape, so an
    // invented key cannot ride along. A blacklist would only stop the keys
    // somebody thought of.
    const { complete } = recorder([
      JSON.stringify([mintOp({ attested: true, confidence: 0.9, supersededBy: 'claim-9' })]),
    ]);
    const { ops, diagnostics } = await proposeOps(baseItem(), complete);

    const keys = Object.keys(ops[0]!);
    expect(keys).not.toContain('attested');
    expect(keys).not.toContain('confidence');
    expect(keys).not.toContain('supersededBy');
    expect(diagnostics.statusKeysStripped).toBe(1);
  });

  it('counts a status key on an op it drops for another reason', async () => {
    // The counter measures whether the model respects the contract, so it
    // counts what the model WROTE, not what survived.
    const { complete } = recorder([
      JSON.stringify([{ op: 'MINT', reading: READING_ID, status: 'evidenced' }]),
    ]);
    const { ops, diagnostics } = await proposeOps(baseItem(), complete);
    expect(ops).toEqual([]);
    expect(diagnostics.statusKeysStripped).toBe(1);
    expect(diagnostics.opsSeen).toBe(1);
  });
});

describe('proposeOps — a returned op must be a well-formed op', () => {
  /** Shorthand: run one raw op through and report what survived. */
  async function survives(raw: unknown): Promise<number> {
    const { ops } = await proposeOps(baseItem(), recorder([JSON.stringify([raw])]).complete);
    return ops.length;
  }

  it('drops a MINT with no range (Q-21)', async () => {
    const { op, reading, body, cites, facet } = mintOp() as Record<string, unknown>;
    expect(await survives({ op, reading, body, cites, facet })).toBe(0);
    expect(await survives(mintOp({ range: '   ' }))).toBe(0);
  });

  it('drops a MINT with an empty body or empty cites', async () => {
    expect(await survives(mintOp({ body: '' }))).toBe(0);
    expect(await survives(mintOp({ cites: [] }))).toBe(0);
  });

  it('drops a MINT whose facet is not one of the eight', async () => {
    expect(await survives(mintOp({ facet: 'vibes' }))).toBe(0);
  });

  it('drops a SUPERSEDE or ARCHIVE with no reason', async () => {
    const supersede = {
      op: 'SUPERSEDE',
      reading: READING_ID,
      claim: 'claim-1',
      body: 'The person now trades direction for stability.',
      range: 'since the move',
      cites: ['snipA@1'],
    };
    expect(await survives(supersede)).toBe(0);
    expect(await survives({ ...supersede, reason: 'the person changed' })).toBe(1);
    expect(await survives({ op: 'ARCHIVE', reading: READING_ID, claim: 'claim-1' })).toBe(0);
  });

  it('drops an op whose verb is not one of the six, and a non-object entry', async () => {
    expect(await survives({ op: 'DELETE', reading: READING_ID, claim: 'claim-1' })).toBe(0);
    expect(await survives('MINT something')).toBe(0);
    expect(await survives(null)).toBe(0);
  });

  it('counts every entry the model produced in opsSeen, dropped or not', async () => {
    // `opsSeen` against `ops.length` is the only place a caller can see that a
    // drop happened — MintDiagnostics has no drop counter of its own.
    const { complete } = recorder([
      JSON.stringify([mintOp(), { op: 'DELETE', reading: READING_ID }, mintOp({ range: '' })]),
    ]);
    const { ops, diagnostics } = await proposeOps(baseItem(), complete);
    expect(diagnostics.opsSeen).toBe(3);
    expect(ops).toHaveLength(1);
  });

  it('keeps a KEEP, which carries no range and no cites', async () => {
    expect(await survives({ op: 'KEEP', reading: READING_ID, note: 'already said' })).toBe(1);
    expect(await survives({ op: 'KEEP', reading: READING_ID })).toBe(1);
  });
});

describe('proposeOps — cites must resolve to a version that exists', () => {
  it('drops a MINT citing a snippet id that was never supplied', async () => {
    const { ops, diagnostics } = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([mintOp({ cites: ['snipINVENTED@1'] })])]).complete
    );
    expect(ops).toEqual([]);
    expect(diagnostics.opsSeen).toBe(1);
  });

  it('drops a MINT citing a version later than any that exists', async () => {
    // The fabrication case: `@7` of a snippet with two versions was never
    // written, and a claim resting on it rests on nothing (Q-1).
    const item: Item = {
      reading: makeReading('A short reading.', ['snipA@2']),
      snippets: { snipA: makeSnippet('snipA', 'The second version of the prose.', 2) },
      relatedClaims: [],
    };
    const { ops } = await proposeOps(
      item,
      recorder([JSON.stringify([mintOp({ cites: ['snipA@7'] })])]).complete
    );
    expect(ops).toEqual([]);
  });

  it('keeps a cite to an OLDER version, which is stale evidence and not fabricated', async () => {
    // Q-5: versions are immutable and `@1` still exists on disk when `@2` is
    // the latest. Reading that as fabrication would drop every claim resting
    // on a snippet the person later revised.
    const item: Item = {
      reading: makeReading('A short reading.', ['snipA@1']),
      snippets: { snipA: makeSnippet('snipA', 'The second version of the prose.', 2) },
      relatedClaims: [],
    };
    const { ops } = await proposeOps(
      item,
      recorder([JSON.stringify([mintOp({ cites: ['snipA@1'] })])]).complete
    );
    expect(ops).toHaveLength(1);
  });

  it('drops a malformed cite that names no version at all', async () => {
    const { ops } = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([mintOp({ cites: ['snipA'] })])]).complete
    );
    expect(ops).toEqual([]);
  });

  it('checks addCites on an UPDATE the same way', async () => {
    const update = { op: 'UPDATE', reading: READING_ID, claim: 'claim-1', body: 'A sharpened body.', range: 'at work' };
    const good = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([{ ...update, addCites: ['snipA@1'] }])]).complete
    );
    expect(good.ops).toHaveLength(1);

    const bad = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([{ ...update, addCites: ['snipGHOST@1'] }])]).complete
    );
    expect(bad.ops).toEqual([]);
  });
});

describe('proposeOps — the reading id is derived, never trusted', () => {
  it('stamps the item reading id over whatever the model wrote', async () => {
    // One reading per call means the id is a fact the caller holds, exactly as
    // the harvester derives `sourceTurn` from its chunk. A hallucinated id
    // would otherwise cost the reading a whole run at T9's unknown-reading
    // rejection, for a field the model was never the authority on.
    const { ops } = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([mintOp({ reading: 'a-reading-that-does-not-exist' })])]).complete
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.reading).toBe(READING_ID);
  });

  it('does not deduplicate two ops for the one reading — that judgment is the executor\'s', async () => {
    const { ops } = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([mintOp(), { op: 'KEEP', reading: READING_ID }])]).complete
    );
    expect(ops).toHaveLength(2);
  });
});

describe('proposeOps — ticket 091: lineage rides typed-marked, never citable', () => {
  it('carries the snippet question and context as typed blocks around the prose', async () => {
    const item: Item = {
      reading: makeReading('The person resisted the reassignment.'),
      snippets: {
        snipA: makeSnippet('snipA', 'I pushed back and kept my project.', 1, {
          context: 'Last year my manager tried to reassign me without asking.',
        }),
      },
      relatedClaims: [],
    };
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(item, complete);

    const payload = calls[0]!.turns[0]!.text;
    // The stored lineage rides along, typed-marked, so a bare "it" in the
    // prose has a referent the model can read — and the boundary stays
    // textual and greppable (074's discipline).
    expect(payload).toContain('<question>What did you choose?</question>');
    expect(payload).toContain('<context>Last year my manager tried to reassign me without asking.</context>');
    expect(payload).toContain('<snippet>I pushed back and kept my project.</snippet>');
  });

  it('lineage sits before the prose, so a floor-cut loses prose tail, never the lineage', async () => {
    // fitPayload slices a part to its floor from the start; snippetFloor
    // sizes the floor as overhead + SNIPPET_FLOOR, so a truncated snippet
    // keeps its header, its lineage blocks, its <snippet> opener and the
    // floor's worth of prose — the prose tail is what the cut takes, exactly
    // the degradation the floor already accepted.
    const prose = 'y'.repeat(9000);
    const item: Item = {
      reading: makeReading('A short reading.'),
      snippets: {
        snipA: makeSnippet('snipA', prose, 1, {
          context: 'The tail of the previous message.',
        }),
      },
      relatedClaims: [],
    };
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(item, complete);

    const payload = calls[0]!.turns[0]!.text;
    expect(payload).toContain('<question>What did you choose?</question>');
    expect(payload).toContain('<context>The tail of the previous message.</context>');
    expect(payload).toContain('<snippet>');
    expect(payload).toContain('y'.repeat(SNIPPET_FLOOR));
    expect(payload).not.toContain(prose);
    expect(payload.length).toBeLessThanOrEqual(MINT_PAYLOAD_BUDGET);
  });

  it('an unprompted snippet with no context rides without lineage blocks', async () => {
    const item: Item = {
      reading: makeReading('A short reading.'),
      snippets: {
        snipA: makeSnippet('snipA', 'Words with no question behind them.', 1, { question: '' }),
      },
      relatedClaims: [],
    };
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(item, complete);

    const payload = calls[0]!.turns[0]!.text;
    expect(payload).not.toContain('<question>');
    expect(payload).not.toContain('<context>');
    expect(payload).toContain('<snippet>Words with no question behind them.</snippet>');
  });

  it('the system prompt names lineage as context, never evidence', async () => {
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(baseItem(), complete);
    expect(calls[0]!.system).toContain('lineage');
    expect(calls[0]!.system).toContain('Never quote them');
  });

  it('a cite that quotes the question text is rejected by cite resolution', async () => {
    // The invariant's mint-side enforcement: even if the model tried to cite
    // the question as evidence, the cite names no written snippet version
    // and the op dies whole.
    const { ops } = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([mintOp({ cites: ['What did you choose?@1'] })])]).complete
    );
    expect(ops).toEqual([]);
  });
});

describe('proposeOps — the oversized path costs no model call', () => {
  it('returns oversized without calling the model when the reading itself will not fit', async () => {
    const { complete, calls } = recorder(['never reached']);
    const { ops, raw, diagnostics } = await proposeOps(
      {
        reading: makeReading('x'.repeat(MINT_PAYLOAD_BUDGET + 1)),
        snippets: { snipA: makeSnippet('snipA', 'short') },
        relatedClaims: [],
      },
      complete
    );

    expect(calls).toHaveLength(0);
    expect(ops).toEqual([]);
    expect(raw).toBe('');
    expect(diagnostics.oversized).toBe(true);
    expect(diagnostics.parsed).toBe(false);
    expect(diagnostics.opsSeen).toBe(0);
    expect(diagnostics.rawChars).toBe(0);
  });

  it('truncates a huge snippet instead of refusing the reading', async () => {
    // Evidence can lose its tail and still be evidence; the reading's own
    // sentence cannot lose its predicate. That asymmetry is why one part
    // carries a floor and the other does not.
    const { complete, calls } = recorder([JSON.stringify([])]);
    const { diagnostics } = await proposeOps(
      {
        reading: makeReading('The person places autonomy above security at work.'),
        snippets: { snipA: makeSnippet('snipA', 'y'.repeat(9000)) },
        relatedClaims: [],
      },
      complete
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.turns[0]!.text.length).toBeLessThanOrEqual(MINT_PAYLOAD_BUDGET);
    expect(diagnostics.oversized).toBe(false);
  });

  it('drops the related claims before it truncates the evidence', async () => {
    // Optional parts go first and whole; the snippet keeps every character it
    // had. `fitPayload` stops as soon as the payload fits, so a dropped claim
    // is not also a truncated snippet. (2150 chars: the claim's ~95 chars are
    // the difference between fitting and truncating once the lineage blocks
    // ride along, ticket 091.)
    const prose = 'z'.repeat(2150);
    const { complete, calls } = recorder([JSON.stringify([])]);
    await proposeOps(
      {
        reading: makeReading('A short reading.'),
        snippets: { snipA: makeSnippet('snipA', prose) },
        relatedClaims: [makeClaim('claim-1', 'A related body.')],
      },
      complete
    );
    const payload = calls[0]!.turns[0]!.text;
    expect(payload).not.toContain('claim-1');
    expect(payload).toContain(
      `SNIPPET snipA@1\n<question>What did you choose?</question>\n<snippet>${prose}</snippet>`
    );
  });
});

describe('proposeOps — isolation', () => {
  it('lets a failed model call reach the caller, which is what counts it', async () => {
    // MintDiagnostics has no field for "the call failed" — the run-level
    // `callErrors` lives at T12, and it can only count what reaches its
    // try/catch. Swallowing the error here would make a dead endpoint look
    // like a wiki with nothing to say.
    const dead: Complete = async () => {
      throw new Error('endpoint refused the connection');
    };
    await expect(proposeOps(baseItem(), dead)).rejects.toThrow(/refused/);
  });

  it('writes nothing and returns ops only — no status on any returned op', async () => {
    const { ops } = await proposeOps(
      baseItem(),
      recorder([JSON.stringify([mintOp({ status: 'user-attested' })])]).complete
    );
    for (const op of ops) {
      expect(Object.prototype.hasOwnProperty.call(op, 'status')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(op, 'attested')).toBe(false);
    }
  });
});
