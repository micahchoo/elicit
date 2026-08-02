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

// ---------------------------------------------------------------------------
// Ticket 037. Every string below is a real cut from the 2026-08-02 harvest of
// Micah's published writing, with his own mark on it
// (docs/ingest-triage-2026-08-02.md). The left column is what he dropped as
// `frag`; the right is what he kept from the same run.
// ---------------------------------------------------------------------------

describe('startsMidSentence — the fragment router', () => {
  const FRAGMENTS = [
    'systems-networks as I have come to understand through my practice in Srishti',
    'we decided to respond to it',
    'the move from liability to accountability',
    'the arbitrary yet normative way that relationships have been formed.',
    'how affordances on these digital publics drive and manipulate behaviour',
    'platforms manufacture "truth" and "ignorance"',
    'the team demos the tool, and I discuss the platform design with the participants.',
  ];

  for (const text of FRAGMENTS) {
    it(`routes ${JSON.stringify(text.slice(0, 46))} to the Bud path`, () => {
      expect(startsMidSentence(text)).toBe(true);
    });
  }

  const WHOLE = [
    'Reflecting on it, the experience demonstrated to me how important bodies are, as a vessel of knowledge and practice.',
    'I am a writer too and I was constantly watching for my style overpowering her prose.',
    'A form of visual protest and stimming, I find color bending to be quite fun',
    'I am fairly sure the shape of the answer is something like this, and much less sure that this is it.',
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
    // four of these are Micah's own keeps.
    for (const keep of [
      'It sparked the idea of being an active and partial participant rather than an impartial and distant observer.',
      'This modularity would allow for more ways to annotate a voice clip or song.',
      'These connections are of many types-some fragile, some symbiotic, some parasitic and most others a hybrid of these.',
      'That got me thinking about how the differences between formal and informal language is often a story of imperialism or colonialism.',
    ]) {
      expect(startsMidSentence(keep)).toBe(false);
    }
  });
});

describe('Q-51 at cut level — a quoted passage is not the person', () => {
  // The capstone's closing paragraphs. Four Annemarie Mol sentences reached
  // the 2026-08-02 review as Micah's prose because the paragraph-level
  // citation filter could not see them.
  const SOURCE = [
    'Care shifts the ground under all of this, and Mol puts it better than I can:',
    '',
    '“The logic of care as I articulate it here is not something to solidify or cast in stone. Not at all! It is fluid and adaptable.”',
    '',
    'I think that is right, and I think it is also why the collectives keep going.',
  ].join('\n');

  const spans = quotedSpans(SOURCE);

  it('finds the quotation as one span', () => {
    expect(spans).toHaveLength(1);
    expect(spans[0]).toContain('not something to solidify or cast in stone');
  });

  it('excludes a cut lifted from inside it', () => {
    const cut = 'The logic of care as I articulate it here is not something to solidify or cast in stone.';
    expect(isQuotedFromSource(cut, spans)).toBe(true);
    expect(admissible(cut, { source: SOURCE })).toEqual({ ok: false, reason: 'quoted' });
  });

  it('keeps the sentence the person wrote around it', () => {
    const cut = 'I think that is right, and I think it is also why the collectives keep going.';
    expect(isQuotedFromSource(cut, spans)).toBe(false);
    expect(admissible(cut, { source: SOURCE })).toEqual({ ok: true });
  });

  it('admits the same words when nobody is being quoted', () => {
    const plain = 'My practice is not something to solidify or cast in stone.';
    expect(admissible(plain, { source: plain })).toEqual({ ok: true });
  });

  it('does not run without a source, because a quotation is invisible alone', () => {
    const cut = 'The logic of care as I articulate it here is not something to solidify or cast in stone.';
    expect(admissible(cut)).toEqual({ ok: true });
  });

  it('leaves straight quotes alone — those are scare quotes and coinages', () => {
    // "the internal wall" is Micah's own term, in his own sentence.
    const src = 'However, this often brought me up to an "internal wall" that I could not argue past.';
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
