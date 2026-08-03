import { describe, it, expect } from 'vitest';
import {
  noProse,
  noTitle,
  pinsResolve,
  samePinSet,
  distinctPrinciples,
} from '../src/piece/contract.js';
import type {
  Arrangement,
  ArrangementEntry,
  Gap,
  Marginalia,
  Pin,
  Principle,
} from '../src/piece/contract.js';
import type { Complete, Snippet } from '../src/types.js';

// ── fixtures ──────────────────────────────────────────────────────────────

function snippet(id: string, version: number): Snippet {
  return {
    id,
    version,
    captured: '2026-08-02T00:00:00.000Z',
    provenance: {
      kind: 'unprompted',
      session: 's-test',
      question: '',
      questionForm: 'deliberative',
    },
    prose: 'the person wrote this',
  };
}

function pin(id: string, snippetId: string, version: number): Pin {
  return { id, kind: 'pin', snippet: snippetId, version };
}

function gap(id: string): Gap {
  return { id, kind: 'gap' };
}

function marginalia(id: string, on: string | null = null): Marginalia {
  return { id, on, note: 'principle', text: 'a note', at: '2026-08-02T00:00:00.000Z' };
}

function arrangement(
  entries: ArrangementEntry[],
  marginaliaList: Marginalia[] = [],
  principle: Principle = 'chronology',
): Arrangement {
  return { id: 'a1', principle, entries: entries, marginalia: marginaliaList, created: '2026-08-02T00:00:00.000Z' };
}

// ── noProse ───────────────────────────────────────────────────────────────

describe('noProse', () => {
  it('passes a clean arrangement of pins and gaps', () => {
    const a = arrangement([pin('e1', 's1', 1), gap('e2')]);
    expect(noProse(a)).toBeNull();
  });

  it('fails an entry carrying an extra text field, naming the field', () => {
    const smuggled = {
      id: 'e1',
      kind: 'pin',
      snippet: 's1',
      version: 1,
      text: 'a smooth transition the agent wrote',
    } as unknown as ArrangementEntry;
    const reason = noProse(arrangement([smuggled]));
    expect(reason).not.toBeNull();
    expect(reason).toContain('text');
  });

  it('fails an entry that is neither a pin nor a gap', () => {
    const weasel = { id: 'e1', kind: 'aside', words: 'hello' } as unknown as ArrangementEntry;
    expect(noProse(arrangement([weasel]))).not.toBeNull();
  });
});

// ── noTitle ───────────────────────────────────────────────────────────────

describe('noTitle', () => {
  it('passes a clean arrangement with marginalia', () => {
    const a = arrangement([pin('e1', 's1', 1)], [marginalia('m1')]);
    expect(noTitle(a)).toBeNull();
  });

  it('fails a title on the Arrangement — Q-1: a title is body text', () => {
    const a = { ...arrangement([]), title: 'My Arrangement' } as unknown as Arrangement;
    expect(noTitle(a)).toContain('title');
  });

  it('fails a title on an entry', () => {
    const titled = {
      id: 'e1',
      kind: 'pin',
      snippet: 's1',
      version: 1,
      title: 'A pin',
    } as unknown as ArrangementEntry;
    expect(noTitle(arrangement([titled]))).toContain('title');
  });

  it('fails a title on a Marginalia', () => {
    const titled = { ...marginalia('m1'), title: 'A note' } as unknown as Marginalia;
    expect(noTitle(arrangement([], [titled]))).toContain('title');
  });
});

// ── pinsResolve ───────────────────────────────────────────────────────────

describe('pinsResolve', () => {
  const snippets: Record<string, Snippet> = { s1: snippet('s1', 3) };

  it('passes a pin to the latest version', () => {
    expect(pinsResolve(arrangement([pin('e1', 's1', 3)]), snippets)).toBeNull();
  });

  it('passes a pin to an older version — keeping an old pin is deliberate (Q-5)', () => {
    expect(pinsResolve(arrangement([pin('e1', 's1', 1)]), snippets)).toBeNull();
  });

  it('fails a pin to a version newer than the snippet latest', () => {
    const reason = pinsResolve(arrangement([pin('e1', 's1', 4)]), snippets);
    expect(reason).not.toBeNull();
    expect(reason).toContain('4');
  });

  it('fails a pin to a snippet that does not exist', () => {
    expect(pinsResolve(arrangement([pin('e1', 'nope', 1)]), snippets)).not.toBeNull();
  });

  it('fails a pin to version 0 — versions start at 1', () => {
    expect(pinsResolve(arrangement([pin('e1', 's1', 0)]), snippets)).not.toBeNull();
  });

  it('ignores gaps', () => {
    expect(pinsResolve(arrangement([gap('e1')]), snippets)).toBeNull();
  });
});

// ── samePinSet ────────────────────────────────────────────────────────────

describe('samePinSet', () => {
  const base: ArrangementEntry[] = [pin('e1', 's1', 1), pin('e2', 's2', 2), gap('e3')];

  it('passes a pure permutation of the pins', () => {
    const candidate: ArrangementEntry[] = [pin('e2', 's2', 2), gap('e3'), pin('e1', 's1', 1)];
    expect(samePinSet(base, candidate)).toBeNull();
  });

  it('fails a candidate that adds a pin', () => {
    const candidate: ArrangementEntry[] = [...base, pin('e4', 's3', 1)];
    expect(samePinSet(base, candidate)).not.toBeNull();
  });

  it('fails a candidate that drops a pin', () => {
    const candidate: ArrangementEntry[] = [pin('e2', 's2', 2), gap('e3')];
    expect(samePinSet(base, candidate)).not.toBeNull();
  });

  it('fails a candidate that changes a pin version', () => {
    const candidate: ArrangementEntry[] = [pin('e1', 's1', 2), pin('e2', 's2', 2), gap('e3')];
    expect(samePinSet(base, candidate)).not.toBeNull();
  });

  it('fails a candidate that swaps one pin for another snippet', () => {
    const candidate: ArrangementEntry[] = [pin('e1', 's9', 1), pin('e2', 's2', 2), gap('e3')];
    expect(samePinSet(base, candidate)).not.toBeNull();
  });
});

// ── distinctPrinciples ────────────────────────────────────────────────────

describe('distinctPrinciples', () => {
  function candidate(principle: Principle): Arrangement {
    return arrangement([], [], principle);
  }

  it('passes two distinct principles', () => {
    expect(distinctPrinciples([candidate('chronology'), candidate('argument')])).toBeNull();
  });

  it('passes three distinct principles', () => {
    expect(
      distinctPrinciples([candidate('chronology'), candidate('argument'), candidate('contrast')]),
    ).toBeNull();
  });

  it('fails two candidates both claiming chronology', () => {
    const reason = distinctPrinciples([candidate('chronology'), candidate('chronology')]);
    expect(reason).not.toBeNull();
    expect(reason).toContain('chronology');
  });

  it('fails four candidates — at most 3 (Q-38)', () => {
    const four = [
      candidate('chronology'),
      candidate('argument'),
      candidate('contrast'),
      candidate('chronology'),
    ];
    expect(distinctPrinciples(four)).not.toBeNull();
  });
});

// ── zero-LLM contract ─────────────────────────────────────────────────────

describe('zero-LLM contract — the module refuses a Complete', () => {
  it('exports nothing that takes a Complete (compile-time assertion)', () => {
    const complete = null as unknown as Complete;
    // Type-level assertion, never invoked: vitest only runs this outer
    // body, which defines the function below without calling it. If any
    // guard's first parameter WERE a Complete, its @ts-expect-error would
    // be unused and tsc would fail this file.
    const calls = () => {
      // @ts-expect-error noProse takes an Arrangement, never a Complete
      noProse(complete);
      // @ts-expect-error noTitle takes an Arrangement, never a Complete
      noTitle(complete);
      // @ts-expect-error pinsResolve takes an Arrangement and a snippet map, never a Complete
      pinsResolve(complete, {});
      // @ts-expect-error samePinSet takes ArrangementEntry[] pairs, never a Complete
      samePinSet(complete, []);
      // @ts-expect-error distinctPrinciples takes an Arrangement[], never a Complete
      distinctPrinciples(complete);
    };
    expect(calls).toBeTypeOf('function');
  });
});
