import { describe, it, expect } from 'vitest';
import { noProse, noTitle, pinsResolve } from '../src/piece/contract.js';
import type { Entry, Gap, GapKind, Marginalia, Pin } from '../src/piece/contract.js';
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

function personGap(id: string): Gap {
  return { id, placedBy: 'person' };
}

function modelGap(id: string, kind: GapKind, pending: string): Gap {
  return { id, placedBy: 'model', kind, pending };
}

function marginalia(id: string, on: string | null = null): Marginalia {
  return { id, on, note: 'role', text: 'a note', at: '2026-08-02T00:00:00.000Z' };
}

// ── noProse ───────────────────────────────────────────────────────────────

describe('noProse', () => {
  it('passes a clean list of pins and gaps', () => {
    const entries: Entry[] = [pin('e1', 's1', 1), personGap('e2'), modelGap('e3', 'leap', 'words')];
    expect(noProse(entries)).toBeNull();
  });

  it('fails an entry carrying an extra text field, naming the field', () => {
    const smuggled = {
      id: 'e1',
      kind: 'pin',
      snippet: 's1',
      version: 1,
      text: 'a smooth transition the agent wrote',
    } as unknown as Entry;
    const reason = noProse([smuggled]);
    expect(reason).not.toBeNull();
    expect(reason).toContain('text');
  });

  it('fails an entry that is neither a pin nor a gap', () => {
    const weasel = { id: 'e1', kind: 'aside', words: 'hello' } as unknown as Entry;
    expect(noProse([weasel])).not.toBeNull();
  });

  it('fails the old gap discriminator — kind: gap is not a GapKind (redesign §4)', () => {
    const legacy = { id: 'e1', kind: 'gap', placedBy: 'person' } as unknown as Entry;
    expect(noProse([legacy])).not.toBeNull();
  });

  it('fails a kind on a person gap — a gap kind is model-placed only', () => {
    const reason = noProse([{ id: 'e1', placedBy: 'person', kind: 'leap' }]);
    expect(reason).not.toBeNull();
    expect(reason).toContain('model-placed only');
  });

  it('fails pending on a person gap — the person\'s question is minted at once, never pending', () => {
    const reason = noProse([{ id: 'e1', placedBy: 'person', pending: 'words' }]);
    expect(reason).not.toBeNull();
    expect(reason).toContain('never pending');
  });

  it('passes a model gap carrying exactly {id, kind, placedBy, question, pending}', () => {
    expect(
      noProse([{ id: 'e1', placedBy: 'model', kind: 'thin', pending: 'write more', question: 'q-1' }]),
    ).toBeNull();
  });
});

// ── noTitle ───────────────────────────────────────────────────────────────

describe('noTitle', () => {
  it('passes a clean entry list with marginalia', () => {
    expect(noTitle([pin('e1', 's1', 1)], [marginalia('m1')])).toBeNull();
  });

  it('fails a title on an entry — Q-1: a title is body text', () => {
    const titled = {
      id: 'e1',
      kind: 'pin',
      snippet: 's1',
      version: 1,
      title: 'A pin',
    } as unknown as Entry;
    expect(noTitle([titled], [])).toContain('title');
  });

  it('fails a title on a Marginalia', () => {
    const titled = { ...marginalia('m1'), title: 'A note' } as unknown as Marginalia;
    expect(noTitle([], [titled])).toContain('title');
  });
});

// ── pinsResolve ───────────────────────────────────────────────────────────

describe('pinsResolve', () => {
  const snippets: Record<string, Snippet> = { s1: snippet('s1', 3) };

  it('passes a pin to the latest version', () => {
    expect(pinsResolve([pin('e1', 's1', 3)], snippets)).toBeNull();
  });

  it('passes a pin to an older version — keeping an old pin is deliberate (Q-5)', () => {
    expect(pinsResolve([pin('e1', 's1', 1)], snippets)).toBeNull();
  });

  it('fails a pin to a version newer than the snippet latest', () => {
    const reason = pinsResolve([pin('e1', 's1', 4)], snippets);
    expect(reason).not.toBeNull();
    expect(reason).toContain('4');
  });

  it('fails a pin to a snippet that does not exist', () => {
    expect(pinsResolve([pin('e1', 'nope', 1)], snippets)).not.toBeNull();
  });

  it('fails a pin to version 0 — versions start at 1', () => {
    expect(pinsResolve([pin('e1', 's1', 0)], snippets)).not.toBeNull();
  });

  it('ignores gaps', () => {
    expect(pinsResolve([personGap('e1')], snippets)).toBeNull();
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
      // @ts-expect-error noProse takes an Entry[], never a Complete
      noProse(complete);
      // @ts-expect-error noTitle takes Entry[] and Marginalia[], never a Complete
      noTitle(complete, []);
      // @ts-expect-error pinsResolve takes Entry[] and a snippet map, never a Complete
      pinsResolve(complete, {});
    };
    expect(calls).toBeTypeOf('function');
  });
});
