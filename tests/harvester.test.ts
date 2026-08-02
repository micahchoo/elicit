import { describe, it, expect } from 'vitest';
import { propose, decide } from '../src/harvester/harvester.js';
import type {
  Complete,
  Turn,
  CutProposal,
  Vault,
  Bud,
  Snippet,
  Reading,
  Provenance,
  Mode,
  Index,
  Facet,
  Stance,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Fake Complete — returns scripted JSON (or raw string for fallback tests)
// ---------------------------------------------------------------------------

function fakeComplete(json: string): Complete {
  return async (_system: string, _turns: Turn[], _opts?: { temperature?: number }) => json;
}

// ---------------------------------------------------------------------------
// In-memory fake Vault for decide tests
// ---------------------------------------------------------------------------

function fakeVault(): Vault & {
  _snippets: Snippet[];
  _readings: Reading[];
  _buds: Bud[];
} {
  let nextId = 1;
  const snippets: Snippet[] = [];
  const readings: Reading[] = [];
  const buds: Bud[] = [];

  function uid(): string {
    return `fake-${nextId++}`;
  }

  return {
    _snippets: snippets,
    _readings: readings,
    _buds: buds,

    saveSnippet(prose: string, provenance: Provenance): Snippet {
      const s: Snippet = {
        id: uid(),
        version: 1,
        captured: new Date().toISOString(),
        provenance,
        prose,
      };
      snippets.push(s);
      return s;
    },

    saveVersion(_snippetId: string, _prose: string): Snippet {
      throw new Error('saveVersion not expected in harvester tests');
    },

    saveReading(r: {
      facet: Facet;
      stance: Stance;
      reading: string;
      cites: string[];
    }): Reading {
      const rd: Reading = {
        id: uid(),
        facet: r.facet,
        stance: r.stance,
        cites: r.cites,
        reading: r.reading,
      };
      readings.push(rd);
      return rd;
    },

    saveBud(fragment: string, failures: string[], session: string): Bud {
      const b: Bud = {
        id: uid(),
        captured: new Date().toISOString(),
        session,
        failures,
        fragment,
      };
      buds.push(b);
      return b;
    },

    startTranscript(
      _session: string,
      _meta: { mode: Mode; protocol: string; started: string }
    ): void { },

    appendTurn(_session: string, _turn: Turn): void { },

    rebuildIndex(): Index {
      return { snippets: {}, readings: {}, buds: {} };
    },
  };
}

// ---------------------------------------------------------------------------
// Shared transcript
// ---------------------------------------------------------------------------

const transcript: Turn[] = [
  {
    role: 'agent',
    text: 'What do you value most in your work?',
    at: '2026-08-01T00:00:00.000Z',
    questionForm: 'deliberative',
    questionSource: { channel: 'test-channel', blockId: 1 },
  },
  {
    role: 'user',
    text: 'I value autonomy above all else. Being able to choose my own direction is what keeps me engaged.',
    at: '2026-08-01T00:00:10.000Z',
  },
  {
    role: 'agent',
    text: 'Can you recall a specific moment when autonomy made the difference?',
    at: '2026-08-01T00:00:20.000Z',
    questionForm: 'deliberative',
    questionSource: { channel: 'test-channel', blockId: 2 },
  },
  {
    role: 'user',
    text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project. That was the moment I knew autonomy was non-negotiable.',
    at: '2026-08-01T00:00:30.000Z',
  },
];

// ===========================================================================
// Tests
// ===========================================================================

describe('propose', () => {
  it('sends a user-last message list — trailing agent turns are stripped', async () => {
    // llama.cpp generates nothing when the list ends with an assistant turn;
    // a session ended mid-open always has an unanswered trailing probe.
    const withTrailingProbe: Turn[] = [
      ...transcript,
      {
        role: 'agent',
        text: 'And what would losing that autonomy cost you?',
        at: '2026-08-01T00:00:40.000Z',
        questionForm: 'deliberative',
      },
    ];
    let seen: Turn[] = [];
    const spy = async (_system: string, turns: Turn[]) => {
      seen = turns;
      return JSON.stringify({ cuts: [] });
    };

    await propose('sess-1', withTrailingProbe, spy);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]!.role).toBe('user');
  });

  it('drops fabricated cuts (not a substring of any user turn)', async () => {
    const json = JSON.stringify({
      cuts: [
        {
          text: 'autonomy above all else',
          sourceTurn: 0,
          facet: 'value',
          stance: 'avowal',
          reading: 'User values autonomy as their primary driver',
          standalone: true,
        },
        {
          text: 'someone else wrote this fabricated sentence',
          sourceTurn: 0,
          facet: 'fact',
          stance: 'report-of-fact',
          reading: 'This text is not in any user turn',
          standalone: true,
        },
      ],
    });

    const { proposals, buds } = await propose(
      'sess-1',
      transcript,
      fakeComplete(json)
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.text).toBe('autonomy above all else');
    expect(buds).toHaveLength(0);
  });

  it('buds non-standalone fragments (real substring but not standalone)', async () => {
    const json = JSON.stringify({
      cuts: [
        {
          text: 'Being able to choose',
          sourceTurn: 0,
          facet: 'value',
          stance: 'avowal',
          reading: 'Partial fragment',
          standalone: false,
        },
      ],
    });

    const { proposals, buds } = await propose(
      'sess-1',
      transcript,
      fakeComplete(json)
    );

    expect(proposals).toHaveLength(0);
    expect(buds).toHaveLength(1);
    expect(buds[0]!.failures).toEqual(['standalone']);
    expect(buds[0]!.fragment).toBe('Being able to choose');
    expect(buds[0]!.session).toBe('sess-1');
  });

  it('copies question and questionForm from the eliciting probe', async () => {
    const json = JSON.stringify({
      cuts: [
        {
          text: 'I pushed back and kept my project',
          sourceTurn: 1,
          facet: 'episode',
          stance: 'avowal',
          reading: 'User actively defended their autonomy',
          standalone: true,
        },
      ],
    });

    const { proposals } = await propose(
      'sess-1',
      transcript,
      fakeComplete(json)
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.question).toBe(
      'Can you recall a specific moment when autonomy made the difference?'
    );
    expect(proposals[0]!.questionForm).toBe('deliberative');
  });

  it('handles JSON with embedded markdown fences (common LLM output)', async () => {
    const raw = '```json\n' + JSON.stringify({
      cuts: [
        {
          text: 'autonomy above all else',
          sourceTurn: 0,
          facet: 'value',
          stance: 'avowal',
          reading: 'User values autonomy',
          standalone: true,
        },
      ],
    }) + '\n```';

    const { proposals } = await propose(
      'sess-1',
      transcript,
      fakeComplete(raw)
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.text).toBe('autonomy above all else');
  });

  it('falls back to line-oriented parsing when JSON is invalid', async () => {
    const raw = [
      'TEXT: "autonomy above all else"',
      'SOURCE: 0',
      'FACET: value',
      'STANCE: avowal',
      'READING: User values autonomy as their primary driver',
      'STANDALONE: true',
      '',
      'TEXT: "Being able to choose"',
      'SOURCE: 0',
      'FACET: value',
      'STANCE: avowal',
      'READING: Partial fragment',
      'STANDALONE: false',
    ].join('\n');

    const { proposals, buds } = await propose(
      'sess-1',
      transcript,
      fakeComplete(raw)
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.text).toBe('autonomy above all else');
    expect(buds).toHaveLength(1);
    expect(buds[0]!.fragment).toBe('Being able to choose');
    expect(buds[0]!.failures).toEqual(['standalone']);
  });

  it('passes low temperature (~0.1) to Complete', async () => {
    let capturedTemp: number | undefined;
    const spy: Complete = async (_sys, _turns, opts) => {
      capturedTemp = opts?.temperature;
      return JSON.stringify({ cuts: [] });
    };

    await propose('sess-1', transcript, spy);
    expect(capturedTemp).toBe(0.1);
  });

  it('handles empty cuts array', async () => {
    const { proposals, buds } = await propose(
      'sess-1',
      transcript,
      fakeComplete(JSON.stringify({ cuts: [] }))
    );

    expect(proposals).toHaveLength(0);
    expect(buds).toHaveLength(0);
  });

  it('drops cuts with missing required fields', async () => {
    const json = JSON.stringify({
      cuts: [
        {
          // missing text
          sourceTurn: 0,
          facet: 'value',
          stance: 'avowal',
          reading: 'No text field',
          standalone: true,
        },
        {
          text: 'autonomy above all else',
          sourceTurn: 0,
          facet: 'value',
          stance: 'avowal',
          reading: 'Valid cut',
          standalone: true,
        },
      ],
    });

    const { proposals } = await propose(
      'sess-1',
      transcript,
      fakeComplete(json)
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.text).toBe('autonomy above all else');
  });

  // ── Admissibility (ticket 044) ──
  // A reaction to the interaction is lineage, not knowledge about the person.
  // Each rejection below is paired with material that must still get through.

  it('never sends a content-free turn for extraction', async () => {
    // Live from Micah's sitting: each of these became a proposal with a reading.
    const withJunk: Turn[] = [
      { role: 'agent', text: 'What do you value most in your work?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'I am not sure.', at: '2026-08-01T00:00:10.000Z' },
      { role: 'agent', text: 'What did that cost you?', at: '2026-08-01T00:00:20.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'This question makes no sense.', at: '2026-08-01T00:00:30.000Z' },
      { role: 'agent', text: 'Where did the stubbornness come from?', at: '2026-08-01T00:00:40.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'My father ran his shop the same way, and I learned the stubbornness from watching him.', at: '2026-08-01T00:00:50.000Z' },
    ];

    const seen: string[] = [];
    const spy: Complete = async (_sys, turns) => {
      seen.push(turns[turns.length - 1]!.text);
      return JSON.stringify({ cuts: [] });
    };

    const { diagnostics } = await propose('sess-1', withJunk, spy);

    expect(seen).toEqual([
      'My father ran his shop the same way, and I learned the stubbornness from watching him.',
    ]);
    expect(diagnostics.contentFreeSkips).toBe(2);
    expect(diagnostics.chunks).toBe(1);
    expect(diagnostics.parsed).toBe(true);
  });

  it('a skipped turn does not shift the sourceTurn of later turns', async () => {
    const withJunkFirst: Turn[] = [
      { role: 'agent', text: 'Ready?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'Yes.', at: '2026-08-01T00:00:10.000Z' },
      { role: 'agent', text: 'What do you value most in your work?', at: '2026-08-01T00:00:20.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'I value autonomy above all else. Being able to choose my own direction keeps me engaged.', at: '2026-08-01T00:00:30.000Z' },
    ];

    const json = JSON.stringify({
      cuts: [{ text: 'I value autonomy above all else', sourceTurn: 0, facet: 'value', stance: 'avowal', reading: 'User names autonomy as their first value', standalone: true }],
    });

    const { proposals, diagnostics } = await propose('sess-1', withJunkFirst, fakeComplete(json));

    expect(proposals).toHaveLength(1);
    // Second user turn — index 1 in user-turn space, not 0.
    expect(proposals[0]!.sourceTurn).toBe(1);
    expect(proposals[0]!.question).toBe('What do you value most in your work?');
    expect(diagnostics.contentFreeSkips).toBe(1);
  });

  it('drops a meta-conversational cut even when the model calls it standalone', async () => {
    // The mixed turn is harvestable: the complaint must die as a cut while the
    // memory beside it survives.
    const mixed: Turn[] = [
      { role: 'agent', text: 'What did your mother ask of you?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
      {
        role: 'user',
        text: 'This question makes no sense to me, my father never asked me anything like it.',
        at: '2026-08-01T00:00:10.000Z',
      },
    ];

    const json = JSON.stringify({
      cuts: [
        { text: 'This question makes no sense to me', sourceTurn: 0, facet: 'fact', stance: 'pole-preference', reading: 'The user judges the question unintelligible', standalone: true },
        { text: 'my father never asked me anything like it', sourceTurn: 0, facet: 'general-event', stance: 'report-of-fact', reading: 'The user reports what their father did not ask', standalone: true },
      ],
    });

    const { proposals, buds, diagnostics } = await propose('sess-1', mixed, fakeComplete(json));

    expect(proposals.map((p) => p.text)).toEqual(['my father never asked me anything like it']);
    // Not a Bud either — a comment on the question is not corpus at all.
    expect(buds).toHaveLength(0);
    expect(diagnostics.inadmissibleDrops).toBe(1);
    expect(diagnostics.cutsSeen).toBe(2);
  });

  it('drops a propositionless cut and keeps the proposition beside it', async () => {
    const turn: Turn[] = [
      { role: 'agent', text: 'What drives you?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
      {
        role: 'user',
        text: 'I am not sure. I am not sure whether the thing I call discipline is actually fear.',
        at: '2026-08-01T00:00:10.000Z',
      },
    ];

    const json = JSON.stringify({
      cuts: [
        { text: 'I am not sure', sourceTurn: 0, facet: 'fact', stance: 'uncertainty-marked', reading: 'The user expresses uncertainty', standalone: true },
        { text: 'I am not sure whether the thing I call discipline is actually fear', sourceTurn: 0, facet: 'construct', stance: 'uncertainty-marked', reading: 'The user questions whether their discipline is fear', standalone: true },
      ],
    });

    const { proposals, buds, diagnostics } = await propose('sess-1', turn, fakeComplete(json));

    expect(proposals.map((p) => p.text)).toEqual([
      'I am not sure whether the thing I call discipline is actually fear',
    ]);
    expect(buds).toHaveLength(0);
    expect(diagnostics.inadmissibleDrops).toBe(1);
  });

  it('an inadmissible cut is never rescued onto the Bud path', async () => {
    const turn: Turn[] = [
      { role: 'agent', text: 'What did that cost you?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
      {
        role: 'user',
        text: 'I would rather not answer that one, it is still too close to talk about.',
        at: '2026-08-01T00:00:10.000Z',
      },
    ];

    const json = JSON.stringify({
      cuts: [
        { text: 'I would rather not answer that one', sourceTurn: 0, facet: 'commitment', stance: 'avowal', reading: 'The user declines to answer', standalone: false },
      ],
    });

    const { proposals, buds, diagnostics } = await propose('sess-1', turn, fakeComplete(json));

    expect(proposals).toHaveLength(0);
    expect(buds).toHaveLength(0);
    expect(diagnostics.inadmissibleDrops).toBe(1);
  });

  it('still buds a real but under-specified fragment', async () => {
    // The Bud path is for material genuinely about the person that cannot yet
    // stand alone — admissibility must not close it.
    const json = JSON.stringify({
      cuts: [
        { text: 'Being able to choose my own direction', sourceTurn: 0, facet: 'value', stance: 'avowal', reading: 'Partial fragment', standalone: false },
      ],
    });

    const { proposals, buds, diagnostics } = await propose('sess-1', transcript, fakeComplete(json));

    expect(proposals).toHaveLength(0);
    expect(buds).toHaveLength(1);
    expect(buds[0]!.fragment).toBe('Being able to choose my own direction');
    expect(diagnostics.inadmissibleDrops).toBe(0);
  });

  it('proposal carries questionSource from eliciting probe', async () => {
    const json = JSON.stringify({
      cuts: [
        {
          text: 'I pushed back and kept my project',
          sourceTurn: 1,
          facet: 'episode',
          stance: 'avowal',
          reading: 'User actively defended their autonomy',
          standalone: true,
        },
      ],
    });

    const { proposals } = await propose(
      'sess-1',
      transcript,
      fakeComplete(json)
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.questionSource).toEqual({
      channel: 'test-channel',
      blockId: 2,
    });
  });
});

describe('decide', () => {
  const proposals: CutProposal[] = [
    {
      text: 'autonomy above all else',
      sourceTurn: 0,
      facet: 'value',
      stance: 'avowal',
      reading: 'User values autonomy as their primary driver',
      question: 'What do you value most in your work?',
      questionForm: 'deliberative',
    },
    {
      text: 'I pushed back and kept my project',
      sourceTurn: 1,
      facet: 'episode',
      stance: 'avowal',
      reading: 'User actively defended their autonomy',
      question: 'Can you recall a specific moment when autonomy made the difference?',
      questionForm: 'deliberative',
    },
  ];

  it('approve persists snippet with harvest provenance and reading citing id@1', () => {
    const vault = fakeVault();
    const { snippets, buds } = decide('sess-1', proposals, [
      { proposal: 0, action: 'approve' },
    ], vault);

    expect(snippets).toHaveLength(1);
    expect(buds).toHaveLength(0);

    const snip = snippets[0]!;
    expect(snip.prose).toBe('autonomy above all else');
    expect(snip.provenance.kind).toBe('harvest');
    expect(snip.provenance.session).toBe('sess-1');
    expect(snip.provenance.question).toBe('What do you value most in your work?');
    expect(snip.provenance.questionForm).toBe('deliberative');
    expect(snip.version).toBe(1);

    // Reading was saved citing id@1
    expect(vault._readings).toHaveLength(1);
    const rd = vault._readings[0]!;
    expect(rd.cites).toEqual([`${snip.id}@1`]);
    expect(rd.facet).toBe('value');
    expect(rd.stance).toBe('avowal');
    expect(rd.reading).toBe('User values autonomy as their primary driver');
  });

  it('trim within proposal saves trimmed snippet + reading', () => {
    const vault = fakeVault();
    const { snippets } = decide('sess-1', proposals, [
      { proposal: 0, action: 'trim', text: 'autonomy' },
    ], vault);

    expect(snippets).toHaveLength(1);
    expect(snippets[0]!.prose).toBe('autonomy');
    expect(snippets[0]!.provenance.kind).toBe('harvest');

    // Reading still saved
    expect(vault._readings).toHaveLength(1);
    expect(vault._readings[0]!.cites).toEqual([`${snippets[0]!.id}@1`]);
  });

  it('rejects trim outside proposal (not a substring)', () => {
    const vault = fakeVault();
    const { snippets } = decide('sess-1', proposals, [
      { proposal: 0, action: 'trim', text: 'not in the proposal text' },
    ], vault);

    // Trim rejected — no snippet saved
    expect(snippets).toHaveLength(0);
    expect(vault._snippets).toHaveLength(0);
  });

  it('restate persists as NEW snippet with restatement provenance', () => {
    const vault = fakeVault();
    const { snippets } = decide('sess-1', proposals, [
      { proposal: 0, action: 'restate', text: 'Autonomy is my highest workplace value.' },
    ], vault);

    expect(snippets).toHaveLength(1);
    const snip = snippets[0]!;
    expect(snip.prose).toBe('Autonomy is my highest workplace value.');
    expect(snip.provenance.kind).toBe('restatement');
    expect(snip.provenance.session).toBe('sess-1');
    expect(snip.provenance.question).toBe('What do you value most in your work?');
    expect(snip.provenance.questionForm).toBe('deliberative');

    // Restatement does NOT create a reading
    expect(vault._readings).toHaveLength(0);
  });

  it('discard persists nothing', () => {
    const vault = fakeVault();
    const { snippets, buds } = decide('sess-1', proposals, [
      { proposal: 0, action: 'discard' },
    ], vault);

    expect(snippets).toHaveLength(0);
    expect(buds).toHaveLength(0);
    expect(vault._snippets).toHaveLength(0);
    expect(vault._readings).toHaveLength(0);
  });

  it('handles multiple decisions (approve + restate + discard)', () => {
    const vault = fakeVault();
    const { snippets } = decide('sess-1', proposals, [
      { proposal: 0, action: 'approve' },
      { proposal: 1, action: 'restate', text: 'I defended my project when it mattered.' },
      { proposal: 0, action: 'discard' },
    ], vault);

    expect(snippets).toHaveLength(2);
    expect(snippets[0]!.provenance.kind).toBe('harvest');
    expect(snippets[1]!.provenance.kind).toBe('restatement');

    // 2 readings: one for the approved, none for restatement
    expect(vault._readings).toHaveLength(1);
  });

  it('skips decisions with out-of-range proposal index', () => {
    const vault = fakeVault();
    const { snippets } = decide('sess-1', proposals, [
      { proposal: 99, action: 'approve' },
    ], vault);

    expect(snippets).toHaveLength(0);
  });

  it('restate without text is a no-op', () => {
    const vault = fakeVault();
    const { snippets } = decide('sess-1', proposals, [
      { proposal: 0, action: 'restate' },
    ], vault);

    expect(snippets).toHaveLength(0);
  });

  it('trim without text is a no-op', () => {
    const vault = fakeVault();
    const { snippets } = decide('sess-1', proposals, [
      { proposal: 0, action: 'trim' },
    ], vault);

    expect(snippets).toHaveLength(0);
  });

  it('readings never carry questionForm (Q-4)', () => {
    const vault = fakeVault();
    decide('sess-1', proposals, [
      { proposal: 0, action: 'approve' },
    ], vault);

    expect(vault._readings).toHaveLength(1);
    const rd = vault._readings[0]!;
    // Type-level: Reading interface has no questionForm property
    // Runtime: no stray properties passed through
    expect((rd as any).questionForm).toBeUndefined();
  });

  it('questionSource survives propose → decide → snippet provenance', async () => {
    const json = JSON.stringify({
      cuts: [
        {
          text: 'autonomy above all else',
          sourceTurn: 0,
          facet: 'value',
          stance: 'avowal',
          reading: 'User values autonomy as their primary driver',
          standalone: true,
        },
      ],
    });

    const { proposals } = await propose(
      'sess-1',
      transcript,
      fakeComplete(json)
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.questionSource).toEqual({
      channel: 'test-channel',
      blockId: 1,
    });

    const vault = fakeVault();
    decide('sess-1', proposals, [{ proposal: 0, action: 'approve' }], vault);

    expect(vault._snippets).toHaveLength(1);
    expect(vault._snippets[0]!.provenance.questionSource).toEqual({
      channel: 'test-channel',
      blockId: 1,
    });
  });
});
