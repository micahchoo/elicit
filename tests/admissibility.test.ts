import { describe, it, expect } from 'vitest';
import {
  admissible,
  isMetaConversational,
  isQuotedFromSource,
  lacksProposition,
  quotedSpans,
  startsMidSentence,
} from '../src/harvester/admissibility.js';

// ---------------------------------------------------------------------------
// The live evidence: every line below matches the shape of a line that became
// a proposed Snippet with an agent reading attached during real sittings and
// the persona eval. Each is paired with real material that must survive the
// same filter — a filter that eats the second column is worse than no filter
// at all.
// ---------------------------------------------------------------------------

const EVIDENCE: { junk: string; real: string }[] = [
  {
    junk: 'I am not sure.',
    real: 'I am not sure whether the thing I call discipline is actually fear.',
  },
  {
    junk: 'This question makes no sense.',
    real: 'The question my mother never asked me was whether I wanted to go at all.',
  },
  {
    junk: 'This question also makes no sense.',
    real: 'None of it made sense until I saw my father do the same thing at sixty.',
  },
  {
    junk: 'Yes.',
    real: 'Yes, I left home the week I turned seventeen and did not go back.',
  },
  {
    junk: 'dunno',
    real: 'I do not know why I still keep his tools in the garage.',
  },
  {
    junk: 'I would rather not answer that one.',
    real: 'I answer to my own standard before I answer to anyone else.',
  },
];

describe('admissible — the live evidence is rejected, real material is kept', () => {
  for (const { junk, real } of EVIDENCE) {
    it(`rejects ${JSON.stringify(junk)}`, () => {
      const verdict = admissible(junk);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(['meta-conversational', 'no-proposition']).toContain(verdict.reason);
      }
    });

    it(`admits ${JSON.stringify(real)}`, () => {
      expect(admissible(real)).toEqual({ ok: true });
    });
  }

  it('reports empty text as empty, not as a judgement about content', () => {
    expect(admissible('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('labels a bare affirmation by what it lacks, not by where it lives', () => {
    expect(admissible('Yes.')).toEqual({ ok: false, reason: 'no-proposition' });
  });

  it('labels a complaint about the prompt as meta-conversational', () => {
    expect(admissible('This question makes no sense.')).toEqual({
      ok: false,
      reason: 'meta-conversational',
    });
  });
});

describe('isMetaConversational', () => {
  const META = [
    'This question makes no sense.',
    'This question also makes no sense.',
    'That question is too vague.',
    'Your question is confusing.',
    'I do not understand the question.',
    'I would rather not answer that one.',
    "I'd rather not answer.",
    'I would prefer not to say.',
    'Can you rephrase that?',
    'Next question.',
    'Ask me something else.',
    'pass',
    'Skip this one.',
    'dunno',
    'Yes.',
    'No.',
    'What does that mean?',
    'no comment',
  ];

  for (const text of META) {
    it(`flags ${JSON.stringify(text)}`, () => {
      expect(isMetaConversational(text)).toBe(true);
    });
  }

  const NOT_META = [
    // "question" as a life, not as a prompt
    'The question of whether to call him back sat with me for a year.',
    // confusion about a person, not about the app
    'I do not understand why my brother stopped calling.',
    // "makes no sense" predicated on an event the person lived
    'My father sold the shop the week after, which still makes no sense to me.',
    // a refusal-shaped sentence that is actually a value
    'I would rather not answer to anyone for how I spend my mornings.',
    // an ordinary avowal
    'I value autonomy above all else at work.',
    // a memory that opens on uncertainty
    'I am not sure whether the thing I call discipline is actually fear.',
  ];

  for (const text of NOT_META) {
    it(`leaves ${JSON.stringify(text)} alone`, () => {
      expect(isMetaConversational(text)).toBe(false);
    });
  }
});

describe('lacksProposition', () => {
  const EMPTY = [
    'Yes.',
    'No.',
    'Maybe.',
    'I am not sure.',
    "I'm not sure.",
    'Not really.',
    'I guess so.',
    'I think so.',
    'That is true.',
    'Well, I do not know.',
    'Honestly, I am not sure, sorry.',
    'Fear.',
  ];

  for (const text of EMPTY) {
    it(`finds no proposition in ${JSON.stringify(text)}`, () => {
      expect(lacksProposition(text)).toBe(true);
    });
  }

  const PROPOSITIONS = [
    'I am not sure whether the thing I call discipline is actually fear.',
    'My father drank.',
    'I value autonomy.',
    'I think I learned the stubbornness from watching him.',
    'Yes, I left home at sixteen.',
    'I feel like a fraud.',
    'Maybe the answer is that I never forgave him.',
  ];

  for (const text of PROPOSITIONS) {
    it(`finds a proposition in ${JSON.stringify(text)}`, () => {
      expect(lacksProposition(text)).toBe(false);
    });
  }

  it('does not use length as the test', () => {
    // Short and propositional; long and propositionless.
    expect(lacksProposition('My father drank.')).toBe(false);
    expect(lacksProposition('Well, honestly, I guess I am not really sure, sorry.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ticket 037. Each string below reproduces the grammatical shape of a real
// cut from the 2026-08-02 harvest of published prose, hand-marked by its
// reader (the mark record lives with the corpus, outside the repo). The left
// column mirrors what was dropped as `frag`; the right mirrors the keeps
// from the same run.
// ---------------------------------------------------------------------------

describe('startsMidSentence — the fragment router', () => {
  const FRAGMENTS = [
    'systems of habit as I have come to understand them through my studio practice',
    'we chose to wait a season',
    'the move from renting to owning',
    'the arbitrary yet normative way that schedules have been formed.',
    'how notification patterns on these platforms steer and manipulate attention',
    'platforms manufacture "urgency" and "consensus"',
    'the team demos the tool, and I walk the visitors through the workflow.',
  ];

  for (const text of FRAGMENTS) {
    it(`routes ${JSON.stringify(text.slice(0, 46))} to the Bud path`, () => {
      expect(startsMidSentence(text)).toBe(true);
    });
  }

  const WHOLE = [
    'Reflecting on it, the experience demonstrated to me how much of a craft lives in the hands rather than the notes.',
    'I am an editor too and I was constantly watching for my own voice crowding out the interview.',
    'A form of quiet protest and play, I find slow walking to be quite fun',
    'I am fairly sure the shape of the plan is right, and much less sure that this version is it.',
  ];

  for (const text of WHOLE) {
    it(`leaves ${JSON.stringify(text.slice(0, 46))} on the proposal path`, () => {
      expect(startsMidSentence(text)).toBe(false);
    });
  }

  it('is not the leading-referent test ticket 035 proposed', () => {
    // Measured on the same 295 cuts: a leading bare pronoun or demonstrative
    // fires on 0 of the 9 fragments and on 25 of the 139 keeps. Real prose
    // opens on expletive "It was…" and discourse "This…" constantly, and all
    // four of these mirror real keeps.
    for (const keep of [
      'It sparked the idea of joining as a partial participant rather than watching as a distant observer.',
      'This modularity would allow for more ways to annotate a recording.',
      'These habits are of many kinds-some fragile, some durable, some costly and most others a hybrid of these.',
      'That got me thinking about how the difference between formal and informal speech is often a story about who writes the rules.',
    ]) {
      expect(startsMidSentence(keep)).toBe(false);
    }
  });
});

describe('Q-51 at cut level — a quoted passage is not the person', () => {
  // The closing paragraphs of a long essay, in shape: quoted sentences from
  // a cited author reached a real review as the essayist's own prose because
  // the paragraph-level citation filter could not see them.
  const SOURCE = [
    'Slow practice shifts the ground under all of this, and the handbook puts it better than I can:',
    '',
    '“A schedule as I teach it here is not a cage to be welded shut. Far from it! It bends to the day that actually arrives.”',
    '',
    'I think that is right, and I think it is also why the routines keep working.',
  ].join('\n');

  const spans = quotedSpans(SOURCE);

  it('finds the quotation as one span', () => {
    expect(spans).toHaveLength(1);
    expect(spans[0]).toContain('not a cage to be welded shut');
  });

  it('excludes a cut lifted from inside it', () => {
    const cut = 'A schedule as I teach it here is not a cage to be welded shut.';
    expect(isQuotedFromSource(cut, spans)).toBe(true);
    expect(admissible(cut, { source: SOURCE })).toEqual({ ok: false, reason: 'quoted' });
  });

  it('keeps the sentence the person wrote around it', () => {
    const cut = 'I think that is right, and I think it is also why the routines keep working.';
    expect(isQuotedFromSource(cut, spans)).toBe(false);
    expect(admissible(cut, { source: SOURCE })).toEqual({ ok: true });
  });

  it('admits the same words when nobody is being quoted', () => {
    const plain = 'My practice is not a cage to be welded shut.';
    expect(admissible(plain, { source: plain })).toEqual({ ok: true });
  });

  it('does not run without a source, because a quotation is invisible alone', () => {
    const cut = 'A schedule as I teach it here is not a cage to be welded shut.';
    expect(admissible(cut)).toEqual({ ok: true });
  });

  it('leaves straight quotes alone — those are scare quotes and coinages', () => {
    // "soft ceiling" is the writer's own coinage, in their own sentence.
    const src = 'However, this often brought me up against a "soft ceiling" that I could not argue past.';
    expect(quotedSpans(src)).toEqual([]);
    expect(admissible(src, { source: src })).toEqual({ ok: true });
  });
});

describe('admissible at turn scope', () => {
  it('rejects a content-free answer before it is ever sent for extraction', () => {
    expect(admissible('Yes.', { scope: 'turn' })).toEqual({
      ok: false,
      reason: 'content-free',
    });
    expect(admissible('This question makes no sense.', { scope: 'turn' })).toEqual({
      ok: false,
      reason: 'content-free',
    });
  });

  it('keeps a mixed answer whole so its real half can still be cut', () => {
    // The complaint dies later, as a cut. The memory beside it must survive.
    expect(
      admissible(
        'This question makes no sense to me, my father never asked me anything like it.',
        { scope: 'turn' },
      ),
    ).toEqual({ ok: true });
  });

  it('keeps ordinary answers', () => {
    expect(
      admissible('I value autonomy above all else at work.', { scope: 'turn' }),
    ).toEqual({ ok: true });
  });
});
