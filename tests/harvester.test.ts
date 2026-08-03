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
          text: 'I value autonomy above all else.',
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
    expect(proposals[0]!.text).toBe('I value autonomy above all else.');
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
          text: 'I value autonomy above all else.',
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
    expect(proposals[0]!.text).toBe('I value autonomy above all else.');
  });

  it('no longer rescues line-oriented output (ticket 078)', async () => {
    // Generation-time grammar constraint makes malformed JSON unemittable, so
    // the line-oriented fallback parser was deleted. A non-JSON payload now
    // reads as a failed chunk: no proposals, no buds, parseMode 'failed'.
    const raw = [
      'TEXT: "I value autonomy above all else."',
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

    const { proposals, buds, diagnostics } = await propose(
      'sess-1',
      transcript,
      fakeComplete(raw)
    );

    expect(proposals).toHaveLength(0);
    expect(buds).toHaveLength(0);
    expect(diagnostics.parsed).toBe(false);
    expect(diagnostics.parseMode).toBe('failed');
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
          text: 'I value autonomy above all else.',
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
    expect(proposals[0]!.text).toBe('I value autonomy above all else.');
  });

  // ── Admissibility (ticket 044) ──
  // A reaction to the interaction is lineage, not knowledge about the person.
  // Each rejection below is paired with material that must still get through.

  it('never sends a content-free turn for extraction', async () => {
    // Mirrors a real sitting: each of these shapes became a proposal with a reading.
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

    // Ticket 091: the one harvestable turn rides with its eliciting question
    // and the prior user turn's tail, typed-marked — never sent bare.
    expect(seen).toEqual([
      '<question>Where did the stubbornness come from?</question>\n' +
      '<context>This question makes no sense.</context>\n' +
      '<snippet>My father ran his shop the same way, and I learned the stubbornness from watching him.</snippet>',
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

    // The complaint is gone from both planes — a comment on the question is
    // not corpus at all, so it is not even a Bud.
    expect(buds.map((b) => b.fragment)).toEqual(['my father never asked me anything like it']);
    expect(diagnostics.inadmissibleDrops).toBe(1);
    expect(diagnostics.cutsSeen).toBe(2);

    // The memory beside it survives — as a Bud rather than a proposal, because
    // the model cut it out of the middle of the sentence and "anything like
    // it" points at the question, not at anything inside the cut. This is
    // ticket 037 changing what 044 promised: 044 said the memory must survive
    // the complaint, and it does. It reaches the Bud mailbox, where a gap-fill
    // question can ask for the whole thought, instead of reaching review as a
    // Snippet the person would have to read the transcript to understand.
    expect(proposals).toHaveLength(0);
    expect(buds[0]!.failures).toEqual(['mid-sentence']);
    expect(diagnostics.fragmentBuds).toBe(1);
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

  // -------------------------------------------------------------------------
  // Ticket 073 — antecedent context: the sentences before the cut, mechanically
  // -------------------------------------------------------------------------

  describe('context extraction', () => {
    it('extracts preceding sentences for a cut mid-turn', async () => {
      // The cut "I pushed back and kept my project" is mid-turn in transcript[3]
      // Its preceding text is "Last year my manager tried to reassign me without asking. "
      const json = JSON.stringify({
        cuts: [{
          text: 'I pushed back and kept my project',
          sourceTurn: 0,
          facet: 'episode',
          stance: 'avowal',
          reading: 'Test',
          standalone: true,
        }],
      });

      // Transcript with the cut in turn position 1 (user turn index 1)
      const tx: Turn[] = [
        { role: 'agent', text: 'What happened last year?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
        { role: 'user', text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project. That was the moment I knew autonomy was non-negotiable.', at: '2026-08-01T00:00:10.000Z' },
      ];

      const { proposals } = await propose('sess-1', tx, fakeComplete(json));
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.context).toBe('Last year my manager tried to reassign me without asking.');
    });

    it('returns undefined when cut opens its turn', async () => {
      const json = JSON.stringify({
        cuts: [{
          text: 'Last year my manager tried to reassign me without asking.',
          sourceTurn: 0,
          facet: 'episode',
          stance: 'avowal',
          reading: 'Test',
          standalone: true,
        }],
      });

      const tx: Turn[] = [
        { role: 'agent', text: 'What happened?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
        { role: 'user', text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project.', at: '2026-08-01T00:00:10.000Z' },
      ];

      const { proposals } = await propose('sess-1', tx, fakeComplete(json));
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.context).toBeUndefined();
    });

    it('context survives propose → decide → snippet provenance', async () => {
      const json = JSON.stringify({
        cuts: [{
          text: 'I pushed back and kept my project',
          sourceTurn: 0,
          facet: 'episode',
          stance: 'avowal',
          reading: 'Test',
          standalone: true,
        }],
      });

      const tx: Turn[] = [
        { role: 'agent', text: 'What happened?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
        { role: 'user', text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project.', at: '2026-08-01T00:00:10.000Z' },
      ];

      const { proposals } = await propose('sess-1', tx, fakeComplete(json));
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.context).toBe('Last year my manager tried to reassign me without asking.');

      const vault = fakeVault();
      const { snippets } = decide('sess-1', proposals, [{ proposal: 0, action: 'approve' }], vault);
      expect(snippets).toHaveLength(1);
      expect(snippets[0]!.provenance.context).toBe('Last year my manager tried to reassign me without asking.');
    });

    it('restatement provenance does not carry context', async () => {
      const json = JSON.stringify({
        cuts: [{
          text: 'I pushed back and kept my project',
          sourceTurn: 0,
          facet: 'episode',
          stance: 'avowal',
          reading: 'Test',
          standalone: true,
        }],
      });

      const tx: Turn[] = [
        { role: 'agent', text: 'What happened?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
        { role: 'user', text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project.', at: '2026-08-01T00:00:10.000Z' },
      ];

      const { proposals } = await propose('sess-1', tx, fakeComplete(json));
      const vault = fakeVault();
      const { snippets } = decide('sess-1', proposals, [{ proposal: 0, action: 'restate', text: 'rewritten version' }], vault);
      expect(snippets).toHaveLength(1);
      expect(snippets[0]!.provenance.kind).toBe('restatement');
      expect(snippets[0]!.provenance.context).toBeUndefined();
    });

    it('caps at two preceding sentences', async () => {
      const json = JSON.stringify({
        cuts: [{
          text: 'That was the moment I knew.',
          sourceTurn: 0,
          facet: 'episode',
          stance: 'avowal',
          reading: 'Test',
          standalone: true,
        }],
      });

      const tx: Turn[] = [
        { role: 'agent', text: 'What happened?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
        { role: 'user', text: 'First sentence of three. Second sentence follows. Third before the cut. That was the moment I knew.', at: '2026-08-01T00:00:10.000Z' },
      ];

      const { proposals } = await propose('sess-1', tx, fakeComplete(json));
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.context).toBe('Second sentence follows. Third before the cut.');
    });
  });
});

// ===========================================================================
// Ticket 091 — lineage rides the harvest payload, typed-marked
// ===========================================================================
//
// The defect this ticket fixes, met in a real sitting: a "What does it mean
// to …?" question drew an answer that leaned on a bare "it", and the reading
// said "the core meaning of **something**" — the referent sat in the
// question, which the payload never carried. The shape below is the fixture:
// question carries the referent, the answer uses a bare "it", and the
// reading names the referent.

describe('ticket 091 — lineage rides the harvest payload', () => {
  const liveExample: Turn[] = [
    {
      role: 'agent',
      text: 'What does it mean to keep a promise to yourself?',
      at: '2026-08-01T00:00:00.000Z',
      questionForm: 'deliberative',
    },
    {
      role: 'user',
      text: 'I think it means to treat the promise as real even when nobody is checking.',
      at: '2026-08-01T00:00:10.000Z',
    },
  ];

  it('sends the eliciting question typed-marked, so the reading can name the referent', async () => {
    let payload = '';
    const spy: Complete = async (_system, turns) => {
      payload = turns[turns.length - 1]!.text;
      return JSON.stringify({
        cuts: [{
          text: 'I think it means to treat the promise as real even when nobody is checking.',
          sourceTurn: 0,
          facet: 'construct',
          stance: 'avowal',
          reading: 'The user asserts that treating a promise as real without an audience constitutes the core meaning of keeping a promise to yourself',
          standalone: true,
        }],
      });
    };

    const { proposals } = await propose('sess-1', liveExample, spy);

    // The question rides the payload — without it, the model cannot name the
    // referent and falls back to "something" (the defect).
    expect(payload).toContain('<question>What does it mean to keep a promise to yourself?</question>');
    expect(payload).toContain('<snippet>I think it means to treat the promise as real even when nobody is checking.</snippet>');
    // No prior user turn, so no <context> block.
    expect(payload).not.toContain('<context>');

    // The reading names the referent instead of leaving it as "something".
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.reading).toContain('keeping a promise to yourself');
  });

  it('carries the prior user turn tail as a <context> block', async () => {
    const turns: Turn[] = [
      { role: 'agent', text: 'What happened last year?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project.', at: '2026-08-01T00:00:10.000Z' },
      { role: 'agent', text: 'What did that cost you?', at: '2026-08-01T00:00:20.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'The cost of holding that line was that I stopped being invited to the planning meetings.', at: '2026-08-01T00:00:30.000Z' },
    ];
    let payload = '';
    const spy: Complete = async (_system, t) => {
      payload = t[t.length - 1]!.text;
      return JSON.stringify({ cuts: [] });
    };

    await propose('sess-1', turns, spy);

    // The second turn's payload carries the first turn's tail — a later "it"
    // can point back at it. The tail is the last up-to-two sentences, the
    // same window the capture side stamps (ticket 073).
    expect(payload).toContain('<question>What did that cost you?</question>');
    expect(payload).toContain('<context>Last year my manager tried to reassign me without asking. I pushed back and kept my project.</context>');
    expect(payload).toContain('<snippet>The cost of holding that line was that I stopped being invited to the planning meetings.</snippet>');
  });

  it('a user turn with no eliciting probe sends only the snippet block', async () => {
    let payload = '';
    const spy: Complete = async (_system, t) => {
      payload = t[t.length - 1]!.text;
      return JSON.stringify({ cuts: [] });
    };
    await propose('sess-1', [{ role: 'user', text: 'I think pushing back was the right call.', at: '2026-08-01T00:00:10.000Z' }], spy);
    expect(payload).toBe('<snippet>I think pushing back was the right call.</snippet>');
  });

  it('LINEAGE-NOT-CORPUS: a cut from the <context> block is rejected by the verbatim gate', async () => {
    // The invariant (073, unchanged): lineage is never corpus. The <context>
    // block is prior-turn prose — present in the payload, absent from the
    // current turn — so a model that cuts from it fails the exact-substring
    // gate and the cut dies as fabrication. The model answers per chunk: the
    // prior turn's own chunk is clean, and the bad cut comes back only on the
    // turn whose payload carries it in <context>.
    const turns: Turn[] = [
      { role: 'agent', text: 'What happened last year?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project.', at: '2026-08-01T00:00:10.000Z' },
      { role: 'agent', text: 'What did that cost you?', at: '2026-08-01T00:00:20.000Z', questionForm: 'deliberative' },
      { role: 'user', text: 'The cost was that I stopped being invited to the planning meetings.', at: '2026-08-01T00:00:30.000Z' },
    ];
    const badCut = JSON.stringify({
      cuts: [{
        // Verbatim in the <context> block, not in the current turn.
        text: 'Last year my manager tried to reassign me without asking. I pushed back and kept my project.',
        sourceTurn: 0,
        facet: 'episode',
        stance: 'avowal',
        reading: 'An episode from the previous turn',
        standalone: true,
      }],
    });
    let call = 0;
    const spy: Complete = async (_system) => (call++ === 0 ? JSON.stringify({ cuts: [] }) : badCut);

    const { proposals, buds, diagnostics } = await propose('sess-1', turns, spy);

    expect(proposals).toHaveLength(0);
    expect(buds).toHaveLength(0);
    expect(diagnostics.fabricationDrops).toBe(1);
    expect(diagnostics.cutsSeen).toBe(1);
  });

  it('LINEAGE-NOT-CORPUS: a cut from the <question> block is rejected the same way', async () => {
    const json = JSON.stringify({
      cuts: [{
        text: 'What does it mean to keep a promise to yourself?',
        sourceTurn: 0,
        facet: 'fact',
        stance: 'report-of-fact',
        reading: 'The user asks this question',
        standalone: true,
      }],
    });
    const { proposals, diagnostics } = await propose('sess-1', liveExample, fakeComplete(json));
    expect(proposals).toHaveLength(0);
    expect(diagnostics.fabricationDrops).toBe(1);
  });

  it('the reading that names the referent survives propose → decide → vault', async () => {
    const json = JSON.stringify({
      cuts: [{
        text: 'I think it means to treat the promise as real even when nobody is checking.',
        sourceTurn: 0,
        facet: 'construct',
        stance: 'avowal',
        reading: 'The user asserts that treating a promise as real without an audience constitutes the core meaning of keeping a promise to yourself',
        standalone: true,
      }],
    });

    const { proposals } = await propose('sess-1', liveExample, fakeComplete(json));
    const vault = fakeVault();
    decide('sess-1', proposals, [{ proposal: 0, action: 'approve' }], vault);

    expect(vault._readings).toHaveLength(1);
    expect(vault._readings[0]!.reading).toContain('keeping a promise to yourself');
    expect(vault._snippets[0]!.provenance.question).toBe('What does it mean to keep a promise to yourself?');
  });
});

// ===========================================================================
// Ticket 037 — facet and stance read off the text, not off the model's word
// ===========================================================================

/** One agent probe and one user turn, so `propose` makes exactly one call. */
function oneTurn(text: string): Turn[] {
  return [
    { role: 'agent', text: 'What changed?', at: '2026-08-01T00:00:00.000Z', questionForm: 'deliberative' },
    { role: 'user', text, at: '2026-08-01T00:00:10.000Z' },
  ];
}

function cutsJson(cuts: Partial<CutProposal & { standalone: boolean }>[]): string {
  return JSON.stringify({
    cuts: cuts.map((c) => ({
      sourceTurn: 0,
      facet: 'fact',
      stance: 'self-observation',
      reading: 'a reading',
      standalone: true,
      ...c,
    })),
  });
}

describe('stance: the supersession markers overrule the model', () => {
  // Eval finding #7: `superseded` was never used where it is textbook-correct.
  // The model called this pair `self-observation` both times it was measured.
  const turn = oneTurn(
    'I used to think discipline was the whole of it. I no longer think that, and I was wrong about what it cost the people around me.',
  );

  it('corrects the stance and counts the correction', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      turn,
      async () => cutsJson([
        { text: 'I no longer think that, and I was wrong about what it cost the people around me.', stance: 'self-observation' },
      ]),
    );

    expect(proposals[0]!.stance).toBe('superseded');
    expect(diagnostics.supersessionCorrections).toBe(1);
  });

  it('counts nothing when the model already had it right', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      turn,
      async () => cutsJson([
        { text: 'I used to think discipline was the whole of it.', stance: 'superseded' },
      ]),
    );

    expect(proposals[0]!.stance).toBe('superseded');
    expect(diagnostics.supersessionCorrections).toBe(0);
  });

  it('leaves habitual past alone — "used to" needs a mental verb behind it', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      oneTurn('I used to work at the shop on Saturdays, and my father worked there too.'),
      async () => cutsJson([
        { text: 'I used to work at the shop on Saturdays, and my father worked there too.', stance: 'self-observation' },
      ]),
    );

    expect(proposals[0]!.stance).toBe('self-observation');
    expect(diagnostics.supersessionCorrections).toBe(0);
  });
});

describe('facet: `intention` without a want, plan or goal is counted, never rewritten', () => {
  // The other half of finding #7 — `intention` on 5 of ~14 cuts, correct on
  // none. The marker proves the label is wrong and says nothing about which of
  // the seven other facets is right, so the harvester reports and stands back.
  it('counts a marker-less intention and leaves the label where it is', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      oneTurn('I no longer think that. The whole idea was borrowed from someone I admired.'),
      async () => cutsJson([{ text: 'I no longer think that.', facet: 'intention' }]),
    );

    expect(proposals[0]!.facet).toBe('intention');
    expect(diagnostics.unmarkedIntentions).toBe(1);
  });

  it('says nothing about an intention that states one', async () => {
    const { diagnostics } = await propose(
      'sess-1',
      oneTurn('I want to spend the next year building only things I would use myself.'),
      async () => cutsJson([
        { text: 'I want to spend the next year building only things I would use myself.', facet: 'intention' },
      ]),
    );

    expect(diagnostics.unmarkedIntentions).toBe(0);
  });
});

describe('a label outside the vocabulary never reaches a Reading', () => {
  // Measured on 105 real cuts, 2026-08-02: the clerk put a STANCE value in the
  // `facet` field three times. `propose()` cast it and `saveReading` wrote it.
  const turn = oneTurn('I have always wondered about the process of learning in groups.');
  const text = 'I have always wondered about the process of learning in groups.';

  it('holds a stance-in-the-facet-field cut as a Bud', async () => {
    const { proposals, buds, diagnostics } = await propose(
      'sess-1',
      turn,
      async () => JSON.stringify({
        cuts: [{ text, sourceTurn: 0, facet: 'self-observation', stance: 'avowal', reading: 'r', standalone: true }],
      }),
    );

    expect(proposals).toHaveLength(0);
    expect(buds[0]!.fragment).toBe(text);
    expect(buds[0]!.failures).toEqual(['label']);
    expect(diagnostics.outOfVocabularyLabels).toBe(1);
  });

  it('holds an invented stance the same way', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      turn,
      async () => JSON.stringify({
        cuts: [{ text, sourceTurn: 0, facet: 'construct', stance: 'reflection', reading: 'r', standalone: true }],
      }),
    );

    expect(proposals).toHaveLength(0);
    expect(diagnostics.outOfVocabularyLabels).toBe(1);
  });

  it('lets a well-labelled cut through untouched', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      turn,
      async () => JSON.stringify({
        cuts: [{ text, sourceTurn: 0, facet: 'construct', stance: 'self-observation', reading: 'r', standalone: true }],
      }),
    );

    expect(proposals).toHaveLength(1);
    expect(diagnostics.outOfVocabularyLabels).toBe(0);
  });
});

describe('episode blindness is counted, not argued about', () => {
  const dated = 'On March 3rd I finally told my manager the estimate was fiction. I think I do that because I would rather be disliked than useless.';

  it('flags a dated turn that yielded no episode cut', async () => {
    const { diagnostics } = await propose(
      'sess-1',
      oneTurn(dated),
      async () => cutsJson([
        { text: 'I think I do that because I would rather be disliked than useless.', facet: 'causal-theory' },
      ]),
    );

    expect(diagnostics.episodeAnchoredTurns).toBe(1);
    expect(diagnostics.episodeBlindTurns).toBe(1);
  });

  it('flags nothing when the episode was cut alongside the theory', async () => {
    const { diagnostics } = await propose(
      'sess-1',
      oneTurn(dated),
      async () => cutsJson([
        { text: 'On March 3rd I finally told my manager the estimate was fiction.', facet: 'episode' },
        { text: 'I think I do that because I would rather be disliked than useless.', facet: 'causal-theory' },
      ]),
    );

    expect(diagnostics.episodeAnchoredTurns).toBe(1);
    expect(diagnostics.episodeBlindTurns).toBe(0);
  });

  it('does not accuse a turn that names no occasion', async () => {
    const { diagnostics } = await propose(
      'sess-1',
      oneTurn('I would rather be disliked than useless, and that has been true for as long as I can tell.'),
      async () => cutsJson([{ text: 'I would rather be disliked than useless', facet: 'value' }]),
    );

    expect(diagnostics.episodeAnchoredTurns).toBe(0);
    expect(diagnostics.episodeBlindTurns).toBe(0);
  });
});

describe('Q-51 reaches the harvester, not only the importer', () => {
  const turn = oneTurn(
    'Shreyas put it best when I asked him about it. “It isn’t an obstacle that stops you rather, it is a point of divergence.” I have carried that around ever since, though I am not sure I believe it.',
  );

  it('drops a cut lifted from inside a quotation in the same turn', async () => {
    const { proposals, buds, diagnostics } = await propose(
      'sess-1',
      turn,
      async () => cutsJson([
        { text: 'It isn’t an obstacle that stops you rather, it is a point of divergence.' },
        { text: 'I have carried that around ever since, though I am not sure I believe it.' },
      ]),
    );

    expect(proposals.map((p) => p.text)).toEqual([
      'I have carried that around ever since, though I am not sure I believe it.',
    ]);
    // Not a Bud: the words are not the person's to keep, at any confidence.
    expect(buds).toHaveLength(0);
    expect(diagnostics.inadmissibleDrops).toBe(1);
  });

  it('never loosens the exact-substring check to do it (Q-1)', async () => {
    const { proposals, diagnostics } = await propose(
      'sess-1',
      turn,
      async () => cutsJson([{ text: 'a point of divergence that I never took' }]),
    );

    expect(proposals).toHaveLength(0);
    expect(diagnostics.fabricationDrops).toBe(1);
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
          text: 'I value autonomy above all else.',
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
