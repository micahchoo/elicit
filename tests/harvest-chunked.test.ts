import { describe, it, expect } from 'vitest';
import { propose } from '../src/harvester/harvester.js';
import type { Complete, Turn } from '../src/types.js';

// ---------------------------------------------------------------------------
// A six-user-turn sitting — the length at which whole-transcript extraction
// collapsed against the local model (ticket 034, eval finding #1).
// ---------------------------------------------------------------------------

const ANSWERS = [
  'I value autonomy above all else at work. Being able to choose my own direction is what keeps me engaged.',
  'Last year my manager tried to reassign me without asking. I pushed back and kept my project.',
  'The cost of holding that line was that I stopped being invited to the planning meetings.',
  'I notice I go quiet in rooms where the decision is already made before anyone speaks.',
  'My father ran his shop the same way, and I think I learned the stubbornness from watching him.',
  'If I lost the ability to pick my own problems I would leave, even for less money.',
];

function sitting(): Turn[] {
  const turns: Turn[] = [];
  ANSWERS.forEach((text, i) => {
    turns.push({
      role: 'agent',
      text: `Probe ${i}?`,
      at: `2026-08-01T00:0${i}:00.000Z`,
      questionForm: 'deliberative',
    });
    turns.push({ role: 'user', text, at: `2026-08-01T00:0${i}:10.000Z` });
  });
  return turns;
}

/** A cut the model would emit for the given user turn, quoting it verbatim. */
function cutFor(text: string): string {
  return JSON.stringify({
    cuts: [
      {
        text,
        sourceTurn: 0,
        facet: 'value',
        stance: 'avowal',
        reading: 'A one-line reading',
        standalone: true,
      },
    ],
  });
}

/**
 * A completer that answers each chunk from a script keyed by the user text it
 * receives. `perTurn` maps an answer index to the raw output for that chunk.
 */
function decodeSnippet(payload: string): string {
  const snippet = payload.match(/<snippet>([\s\S]*)<\/snippet>/)?.[1];
  if (snippet === undefined) {
    throw new Error(`decodeSnippet: payload did not carry a <snippet> block — ${payload.slice(0, 80)}`);
  }
  return snippet;
}

/**
 * A completer that answers each chunk from a script keyed by the user text it
 * receives. `perTurn` maps an answer index to the raw output for that chunk.
 *
 * Ticket 091: the payload wraps the turn in a <snippet> block (with
 * <question>/<context> lineage blocks before it), so the answer is keyed off
 * the decoded snippet content, never the raw payload.
 */
function scriptedComplete(perTurn: (answerIdx: number) => string): Complete {
  return async (_system: string, turns: Turn[]) => {
    const idx = ANSWERS.indexOf(decodeSnippet(turns[turns.length - 1]!.text));
    return perTurn(idx);
  };
}

// ===========================================================================

describe('chunked harvest', () => {
  it('sends one call per user turn, each carrying exactly that turn, lineage-marked', async () => {
    const seen: Turn[][] = [];
    const spy: Complete = async (_system, turns) => {
      seen.push(turns);
      return JSON.stringify({ cuts: [] });
    };

    await propose('sess-1', sitting(), spy);

    expect(seen).toHaveLength(6);
    for (const turns of seen) {
      expect(turns).toHaveLength(1);
      expect(turns[0]!.role).toBe('user');
    }
    // Ticket 091: each turn rides inside a <snippet> block, preceded by its
    // eliciting <question> and — from the second turn on — the previous
    // turn's tail as <context>. Never bare, and never carrying another turn's
    // cuttable material beyond that tail.
    expect(seen.map((t) => t[0]!.text)).toEqual(
      ANSWERS.map((text, i) =>
        i === 0
          ? `<question>Probe 0?</question>\n<snippet>${text}</snippet>`
          : `<question>Probe ${i}?</question>\n<context>${ANSWERS[i - 1]}</context>\n<snippet>${text}</snippet>`
      ),
    );
  });

  it('yields cuts from multiple turns across a six-turn sitting', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      sitting(),
      scriptedComplete((i) => cutFor(ANSWERS[i]!)),
    );

    expect(proposals).toHaveLength(6);
    expect(proposals.map((p) => p.sourceTurn)).toEqual([0, 1, 2, 3, 4, 5]);
    // Each proposal carries the probe that elicited its own turn.
    expect(proposals.map((p) => p.question)).toEqual([
      'Probe 0?', 'Probe 1?', 'Probe 2?', 'Probe 3?', 'Probe 4?', 'Probe 5?',
    ]);
    expect(diagnostics.parsed).toBe(true);
    expect(diagnostics.parseMode).toBe('json');
    expect(diagnostics.chunks).toBe(6);
    expect(diagnostics.chunksParsed).toBe(6);
  });

  it('one chunk of garbage prose does not zero the harvest', async () => {
    // Turn 2 gets the observed failure mode: the model echoes conversation
    // prose instead of emitting cuts.
    const garbage = 'That is a really interesting point about the planning meetings, and I think';
    const { proposals, diagnostics } = await propose(
      'sess-1',
      sitting(),
      scriptedComplete((i) => (i === 2 ? garbage : cutFor(ANSWERS[i]!))),
    );

    expect(proposals).toHaveLength(5);
    expect(proposals.map((p) => p.sourceTurn)).toEqual([0, 1, 3, 4, 5]);
    // The failed chunk is visible in the counts, not just absent from the yield.
    expect(diagnostics.parsed).toBe(true);
    expect(diagnostics.chunks).toBe(6);
    expect(diagnostics.chunksParsed).toBe(5);
  });

  it('reports parsed=false only when every chunk fails', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      sitting(),
      scriptedComplete(() => 'I hear you, and that sounds like a hard position to be in.'),
    );

    expect(proposals).toHaveLength(0);
    expect(diagnostics.parsed).toBe(false);
    expect(diagnostics.parseMode).toBe('failed');
    expect(diagnostics.chunksParsed).toBe(0);
    expect(diagnostics.rawChars).toBeGreaterThan(0);
  });

  it('a genuinely empty harvest is distinguishable from a failed one', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      sitting(),
      scriptedComplete(() => JSON.stringify({ cuts: [] })),
    );

    expect(proposals).toHaveLength(0);
    expect(diagnostics.parsed).toBe(true);
    expect(diagnostics.parseMode).toBe('json');
    expect(diagnostics.chunksParsed).toBe(6);
  });

  it('drops cuts that are not exact substrings of their own turn', async () => {
    // Chunk 0 is handed a verbatim quote from ANOTHER turn — real user text,
    // but not this chunk's, so Sole Authorship still drops it.
    const { proposals, diagnostics } = await propose(
      'sess-1',
      sitting(),
      scriptedComplete((i) =>
        i === 0
          ? cutFor('I pushed back and kept my project')
          : JSON.stringify({ cuts: [] }),
      ),
    );

    expect(proposals).toHaveLength(0);
    expect(diagnostics.fabricationDrops).toBe(1);
    expect(diagnostics.parsed).toBe(true);
  });

  it('counts a sourceTurn the model did not report as 0', async () => {
    const json = JSON.stringify({
      cuts: [
        {
          text: 'I value autonomy above all else',
          sourceTurn: 4,
          facet: 'value',
          stance: 'avowal',
          reading: 'A one-line reading',
          standalone: true,
        },
      ],
    });
    const { proposals, diagnostics } = await propose(
      'sess-1',
      sitting(),
      scriptedComplete((i) => (i === 0 ? json : JSON.stringify({ cuts: [] }))),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.sourceTurn).toBe(0);
    expect(diagnostics.sourceTurnCorrections).toBe(1);
  });

  it('a throwing chunk is counted and the rest still harvest', async () => {
    const complete: Complete = async (_system, turns) => {
      const idx = ANSWERS.indexOf(decodeSnippet(turns[turns.length - 1]!.text));
      if (idx === 3) throw new Error('model timeout');
      return cutFor(ANSWERS[idx]!);
    };

    const { proposals, diagnostics } = await propose('sess-1', sitting(), complete);

    expect(proposals).toHaveLength(5);
    expect(diagnostics.chunkErrors).toBe(1);
    expect(diagnostics.chunksParsed).toBe(5);
    expect(diagnostics.parsed).toBe(true);
  });

  it('dedupes overlapping cuts across chunks, keeping the longer', async () => {
    // Two chunks quote the same phrase; a third quotes a superstring of it.
    const shared = 'I value autonomy';
    const longer = 'I value autonomy above all else at work';
    const complete: Complete = async (_system, turns) => {
      const idx = ANSWERS.indexOf(decodeSnippet(turns[turns.length - 1]!.text));
      if (idx === 0) return cutFor(shared);
      return JSON.stringify({ cuts: [] });
    };
    const { proposals: short } = await propose('sess-1', sitting(), complete);
    expect(short).toHaveLength(1);

    const both: Complete = async (_system, turns) => {
      const idx = ANSWERS.indexOf(decodeSnippet(turns[turns.length - 1]!.text));
      if (idx !== 0) return JSON.stringify({ cuts: [] });
      const parsed = JSON.parse(cutFor(shared)) as { cuts: unknown[] };
      const long = JSON.parse(cutFor(longer)) as { cuts: unknown[] };
      return JSON.stringify({ cuts: [...parsed.cuts, ...long.cuts] });
    };
    const { proposals: deduped } = await propose('sess-1', sitting(), both);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.text).toBe(longer);
  });

  it('trailing agent turns contribute no chunks', async () => {
    const withTrailingProbe: Turn[] = [
      ...sitting(),
      {
        role: 'agent',
        text: 'And what would losing that cost you?',
        at: '2026-08-01T00:07:00.000Z',
        questionForm: 'deliberative',
      },
    ];
    let calls = 0;
    const spy: Complete = async () => {
      calls++;
      return JSON.stringify({ cuts: [] });
    };

    const { diagnostics } = await propose('sess-1', withTrailingProbe, spy);

    expect(calls).toBe(6);
    expect(diagnostics.chunks).toBe(6);
  });
});
