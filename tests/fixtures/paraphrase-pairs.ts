/**
 * The standing paraphrase fixture — eval metric 14, "semantic-resonance recall".
 *
 * Every pair below is a belief stated once in the vault and restated later in
 * fresh words, with NO verbatim run of three or more words in common. That is
 * how belief-drift actually shows up in speech: people re-say themselves, they
 * do not quote themselves.
 *
 * **This data is SHARED and it is a measurement, not an example.** It lives
 * here rather than inside one test because two suites now read it:
 * `tests/resonance-paraphrase.test.ts` records what the trigram index finds
 * (0/8, the honest baseline) and `tests/wiki-clash.test.ts` records what the
 * clash channels find. A second copy would drift from the first, and the two
 * recall numbers would stop being comparable — which is the whole point of
 * having them.
 *
 * The pairs are load-bearing. `no restatement shares a trigram with any stored
 * snippet` guards them: if someone edits a pair into lexical overlap, recall
 * would climb without any semantic capability, and that test fails loudly
 * rather than letting a fake number stand. Changing a pair means checking every
 * consumer (`.claude/rules/test-fixtures.md`); adding a fixture is the move.
 */

export interface ParaphrasePair {
  /** Why this pair exists — printed with the recall report. */
  label: string;
  /** Prose already in the vault, as a snippet. */
  stored: string;
  /** The same belief restated in a later sitting, in different words. */
  restated: string;
}

export const PAIRS: ParaphrasePair[] = [
  {
    label: 'social-hedging (the eval negative control, verbatim)',
    stored: 'I default to hedging in whichever direction is socially cheaper',
    restated:
      'When more people agree with a claim, I make it sound more certain than I actually feel inside',
  },
  {
    label: 'external-deadline dependence',
    stored: 'I only finish things when someone else is waiting on them',
    restated:
      'Left alone with a project nothing ever ships; give me a person expecting it and the work closes itself',
  },
  {
    label: 'morning cognition',
    stored:
      'My best thinking happens in the first hour after waking, before I have spoken to anyone',
    restated:
      'By lunchtime my head is mush; whatever real ideas arrive show up at dawn while the house is quiet',
  },
  {
    label: 'busyness as proxy for worth',
    stored: 'I confuse being busy with being useful',
    restated:
      'A full calendar reassures me the day mattered, which is not the same as anything of value coming out of it',
  },
  {
    label: 'deferred conflict',
    stored: 'I avoid conflict by agreeing early and resenting it later',
    restated:
      'Saying yes in the room is cheap; the cost arrives a week on, as a grudge nobody was told about',
  },
  {
    label: 'understanding tested by teaching',
    stored: 'Teaching something is the only way I find out whether I understand it',
    restated:
      'Until forced to explain a topic to a beginner, my grasp of it is untested and probably fake',
  },
  {
    label: 'writing as thinking',
    stored: 'I write to find out what I think, not to report what I already decided',
    restated:
      'The page is where a position gets formed; if the conclusion were known beforehand there would be no reason to draft anything',
  },
  {
    label: 'split epistemics — people versus numbers',
    stored: 'I trust my gut on people and my spreadsheet on everything else',
    restated:
      'Numbers settle the money questions, but who to work with is a feeling read off the first ten minutes',
  },
];

/**
 * The eval's vault also held the opposite pole of the first pair. It is a
 * distractor here: the restated contradiction should ideally reach it too, and
 * today reaches neither.
 */
export const DISTRACTORS: string[] = [
  'my hedges track my actual confidence, not how popular a claim is',
  'I keep a notebook by the bed for the sentences that arrive at 3am',
  'The work I am proudest of took twice as long as I told anyone',
];
