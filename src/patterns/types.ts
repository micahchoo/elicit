/**
 * Pattern types — the derivation grammar's vocabulary.
 *
 * Q-81: a derived question recombines elements the person named under
 * registered operators. Q-82: two tiers, drawn not chosen, no rollouts.
 * These types are the contract every pattern module reads.
 */

import type { Facet, QuestionForm, Target } from '../types.js';

/** The stable identifier for a derivation pattern in the repertoire. */
export type PatternId =
  | 'sentence-stems'
  | 'clean-language'
  | 'instance-testing'
  | 'counterfactual'
  | 'dilemma'
  | 'reversal'
  | 'anniversary-framing'
  | 'externalizing'
  | 'miracle-question'
  | 'heavy-scenario';

/** Q-82: cheap patterns are ordinary composed questions; deep are Sounding-class. */
export type PatternTier = 'cheap' | 'deep';

/**
 * Content-free operations a pattern may apply to the person's material.
 * The Q-81 rule: these are the ONLY things the agent may introduce outside
 * quoted spans — every other content word must be a grammatical connective.
 */
export type Operator =
  | 'suppose'
  | 'time-shift'
  | 'miracle'
  | 'clean-language-frame'
  | 'sentence-completion'
  | 'reversal'
  | 'externalize'
  | 'instance-of'
  | 'counterfactual-twist'
  | 'dilemma-construct'
  | 'anniversary-frame';

/** What source material a pattern needs to be licensable. */
export type DerivesFrom = {
  /** Minimum number of Snippets with matching facets. */
  minSnippets: number;
  /** Facets at least one Snippet of each must carry. */
  facets: Facet[];
  /** Additional facets needed (e.g. instance-testing needs an episode too). */
  alsoNeeds?: Facet[];
};

/**
 * One derivation pattern definition — an open set, like Protocols.
 * Seed from the ticket-102 catalogue's nine patterns.
 */
export type Pattern = {
  id: PatternId;
  name: string;
  tier: PatternTier;
  /** Registered operators — the only content the agent may introduce. */
  operators: Operator[];
  /** What source material licenses this pattern. */
  derivesFrom: DerivesFrom;
  /**
   * What the pattern must quote from the sources. Human-readable labels
   * for the prompt builder (e.g. ['general-claim', 'specific-instance']),
   * not mechanically enforced — the decomposition guard enforces quoting,
   * and these labels tell the model WHAT to quote.
   */
  requiredQuotes: string[];
  /** The QuestionForm the answer should be tagged with. */
  questionForm: QuestionForm;
  /** How much agent-authored content the pattern introduces. */
  contaminationRisk: 'low' | 'moderate' | 'high';
  /**
   * Q-35 graduation: shadow patterns log selections but don't act;
   * live patterns produce real composed questions.
   */
  graduation: 'live' | 'shadow';
};

/** The result of running the decomposition guard on a generated question. */
export type DecompositionResult =
  | {
      ok: true;
      /** Every quoted span, with the source that supplied it. */
      quotedSpans: { text: string; sourceSnippetId: string; sourceVersion: number }[];
      /** The operators detected outside quoted spans. */
      operatorsUsed: Operator[];
    }
  | {
      ok: false;
      reason:
        | 'unquoted-material'
        | 'unregistered-operator'
        | 'assertion-outside-quote'
        | 'presupposition'
        | 'no-quoted-spans';
    };

/** The context a pattern licensing check reads. */
export type LicensingContext = {
  /** Snippets available to derive from, with their facets. */
  availableSnippets: { id: string; version: number; facet: Facet }[];
  /** The sitting's declared Target, when one is declared. */
  sittingTarget?: Target;
  /** Whether the sitting is in its late phase. */
  isLateSession: boolean;
};
