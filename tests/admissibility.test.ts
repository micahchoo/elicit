import { describe, it, expect } from 'vitest';
import {
  admissible,
  isMetaConversational,
  lacksProposition,
} from '../src/harvester/admissibility.js';

// ---------------------------------------------------------------------------
// The live evidence: every line below became a proposed Snippet with an agent
// reading attached during Micah's own sitting, and again in the persona eval
// (docs/eval-2026-08-02-personas.md, Persona 1). Each is paired with real
// material that must survive the same filter — a filter that eats the second
// column is worse than no filter at all.
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
