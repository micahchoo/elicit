/**
 * Facet intent: what kind of person-knowledge a QUESTION asks for.
 *
 * A Snippet's Facet is read from the answer (harvester's job). A question's
 * targetFacet is read from the question — the instrument it is, before anyone
 * answers. "What does home mean to you" and "what happened the last time you
 * moved" both mention home; only the second asks for a dateable scene.
 *
 * Classification is by the RETRIEVAL OPERATION the question demands, never by
 * grammar. The 2026-08-02 deck curation required the literal word "you" in
 * every question, which is a second-person-grammar filter dressed as a quality
 * filter; it produced a 250-entry deck of pure self-reflection and a vault of
 * 25 constructs to 0 episodes (ticket 042).
 */

import type { Facet, RedLight } from '../types.js';

/**
 * Ordered rules — first match wins. The order is a specificity ladder: an
 * era beats a scene ("what did you want to be as a kid" is the era), a habit
 * beats a scene ("whenever you've argued" is the pattern), and construct sits
 * last because every abstraction falls through to it — which is exactly how
 * the corpus filled up with constructs in the first place.
 */
const RULES: { facet: Facet; pattern: RegExp }[] = [
  // Causal theory, opener form. A "why" question yields the person's theory of
  // themselves whatever tense it wears, so it is decided before the tense
  // rules below can read it as an event (CONTEXT: Provenance, why → causal).
  { facet: 'causal-theory', pattern: /^(why\b|how come\b)/i },

  // Lifetime period — an era, not a scene.
  {
    facet: 'lifetime-period',
    pattern:
      /\b(growing up|as a (kid|child|teenager|young|boy|girl)|in your (teens|twenties|thirties|forties|fifties|sixties)|when you were (a|an|young|little|small|\d)|your childhood|childhood home|adolescence|period of your life|chapter of your life|phase of your life|part of your life|years? of your life|back then|those years|that era)\b/i,
  },

  // General event — a habit or a repeated pattern, no single date.
  {
    facet: 'general-event',
    pattern:
      /\b(usually|typically|tend to|every time|each time|whenever|most days|every day|on a (normal|typical|good|bad) day|routine|rituals?|habits?|day to day|day-to-day|how often|do you keep doing|over and over|again and again)\b/i,
  },

  // Episode — one occurrence, retrievable as a scene. The mark is not the word
  // "you" but the demand for a PAST PARTICULAR: perfect aspect, simple past
  // interrogatives, singular-occasion deixis, or a superlative over experience.
  {
    facet: 'episode',
    pattern: new RegExp(
      [
        // singular-occasion deixis
        String.raw`\b(the (last|first|most recent|worst|best) time|a time (when|that|you)|last time you|a moment (when|where|that|you)|the moment (you|when|that)|what happened (when|after|the)|tell me about (a|the time)|describe a (time|moment|scene|day)|think back to|recall a|the day (you|that|when)|one time)\b`,
        // "the last thing you lost", "the first person you called"
        String.raw`\bthe (last|first) (thing|person|time|place|book|film|movie|meal|song|job|one)\b`,
        // perfect aspect in the second person: "you've received", "have you ever"
        String.raw`\b(you'?ve|you have) (ever )?[a-z]+(ed|en|t|ne|de|wn|ung|ought|aid|one)\b`,
        String.raw`\bhave you ever\b`,
        // simple-past interrogatives that ask for an occurrence
        String.raw`\b(what|who|where|when|how) (did|were) you\b`,
        String.raw`\bwhat was the (last|first|best|worst|hardest|most|only)\b`,
        // "when have you felt…", "what has been the best day…"
        String.raw`^(what|who|when|where) (has|have)\b`,
        String.raw`\bwhen (have|has|did) (you|it|they|someone|your)\b`,
      ].join('|'),
      'i',
    ),
  },

  // Intention — a forward commitment.
  {
    facet: 'intention',
    pattern:
      /\b(do you (want|plan|hope|intend|mean) to|are you (going to|planning|working toward)|what (do|would) you want to|will you (do|be|make|build|become|try)|next (year|month|week)|five years|ten years|in the future|someday|your (goal|goals|plan|plans|ambition)|working towards?|hope to|going to do about|what'?s next)\b/i,
  },

  // Causal theory, embedded form — the person's explanation of themselves.
  // Always collected, always flagged: evidence of the theory, never of the
  // cause (CONTEXT: Facet).
  {
    facet: 'causal-theory',
    pattern:
      /\b(why (do|did|are|is|does|would|can'?t|don'?t|have|has)|what (makes|made) (you|us|people|someone|it)|what causes|what explains|what is it about|the reason (you|why))\b/i,
  },

  // Value — a ranking or an ought.
  {
    facet: 'value',
    pattern:
      /\b(matters? most|most important|important to you|worth (it|doing|the)|should (you|we|people|someone|a)|deserves?|the right thing|admire|look up to|proud of|value most|care most about|would you sacrifice|is it ok(ay)? to|what do you owe)\b/i,
  },

  // Fact — a checkable datum or a procedure the person can state. Narrow on
  // purpose: "where do you go when you are sad" is a habit, not a fact, and a
  // loose reading of "how do you" swallows half the bank.
  {
    facet: 'fact',
    pattern:
      /\b(what tells you|how (do|can) you (tell|know)|what do you look for|what('s| is) your (process|method|setup|system|approach to)|what do you use|how (do|would) you (make|build|find|choose|decide|start|learn|prepare|organize|handle|fix|run|set up|keep track)|who (taught|showed) you|what are the steps|what would you (need|bring|pack)|what does it take to)\b/i,
  },

  // Construct — a meaning, a contrast, a pole.
  {
    facet: 'construct',
    pattern:
      /\b(what does .*\bmean|what do you mean by|difference between|how (do|would) you define|what counts as|what makes (something|a|an|the)|the opposite of|what is a good|how would you describe|what (is|are) your relationship|what does it (look|feel) like|what is the (point|purpose|value) of)\b/i,
  },
];

/**
 * The intent of a question, or `null` when no rule matches.
 *
 * `null` is a real answer, not a failure: an unclassified question carries no
 * facet claim, so the balance filter cannot prefer it and curation drops it.
 * Guessing a facet here would put a construct tag on everything and rebuild
 * the exact bias this module exists to break.
 */
export function classifyFacetIntent(question: string): Facet | null {
  // are.na text is full of typographic apostrophes; "you’ve" and "you've" are
  // the same perfect aspect, and matching only the straight one silently
  // halves episode recall.
  const text = question.trim().replace(/[‘’ʼ´`]/g, "'");
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.facet;
  }
  return null;
}

/**
 * The facet a Red Light asks for. A red light names what is MISSING from the
 * user's last utterance, so the follow-up's intent is fixed by the light:
 * an abstraction with no episode under it wants the episode.
 */
export function facetIntentForRedLight(kind: RedLight['kind']): Facet {
  switch (kind) {
    case 'abstraction-no-episode':
      return 'episode';
    case 'cause-no-event':
      return 'episode';
    case 'pole-no-contrast':
      return 'construct';
    case 'odd-term':
      return 'construct';
    case 'unexplored-referent':
      return 'fact';
  }
}
