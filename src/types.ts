// Domain types for the Elicit project
// Encode invariants from CONTEXT.md as visible type constraints

export type Facet =
  | 'episode'
  | 'general-event'
  | 'lifetime-period'
  | 'fact'
  | 'construct'
  | 'intention'
  | 'value'
  | 'causal-theory';

export type Stance =
  | 'avowal'
  | 'self-observation'
  | 'report-of-fact'
  | 'pole-preference'
  | 'commitment'
  | 'uncertainty-marked'
  | 'superseded';

export type QuestionForm = 'deliberative' | 'theoretical' | 'why';

export type Mode = {
  minutes: number;
  energy: 'low' | 'medium' | 'high';
  topic?: string;
};

export type Turn = {
  role: 'agent' | 'user';
  text: string;
  at: string;
  /** Present on agent turns; the eliciting probe's QuestionForm tag */
  questionForm?: QuestionForm;
  /** Set in memory when the user skips this agent turn — never persisted to disk */
  skipped?: true;
};

export type CutProposal = {
  /** Verbatim text proposed as a Snippet — untrusted until substring-validated (Q-1) */
  text: string;
  /** Index into the transcript's user turns */
  sourceTurn: number;
  facet: Facet;
  stance: Stance;
  /** Agent's one-line reading of the cut */
  reading: string;
  /** The eliciting question that produced this cut */
  question: string;
  /** Copied from the eliciting probe's Turn.questionForm */
  questionForm: QuestionForm;
};

export type HarvestDecision = {
  /** Index into the proposals array */
  proposal: number;
  action: 'approve' | 'trim' | 'discard' | 'restate';
  /** Required for 'trim' (must be a substring of proposal text) and 'restate' */
  text?: string;
};

export type Provenance = {
  kind: 'harvest' | 'restatement';
  session: string;
  question: string;
  questionForm: QuestionForm;
  /** Source span in the transcript (harvest only) */
  span?: { start: number; end: number };
};

export type Snippet = {
  id: string;
  version: number;
  captured: string;
  provenance: Provenance;
  prose: string;
};

export type Reading = {
  id: string;
  facet: Facet;
  stance: Stance;
  /** Citations as "snippetId@version" strings */
  cites: string[];
  reading: string;
};

export type Bud = {
  id: string;
  captured: string;
  session: string;
  failures: string[];
  fragment: string;
};

export type SessionState = {
  id: string;
  mode: Mode;
  protocol: string;
  deps: {
    complete: Complete;
    vault: Vault;
  };
  turns: Turn[];
};

export type Index = {
  snippets: Record<string, Snippet>;
  readings: Record<string, Reading>;
  buds: Record<string, Bud>;
};

export type Complete = (
  system: string,
  turns: Turn[],
  opts?: { temperature?: number }
) => Promise<string>;

export interface Vault {
  saveSnippet(prose: string, provenance: Provenance): Snippet;
  saveVersion(snippetId: string, prose: string): Snippet;
  saveReading(r: {
    facet: Facet;
    stance: Stance;
    reading: string;
    cites: string[];
  }): Reading;
  saveBud(fragment: string, failures: string[], session: string): Bud;
  startTranscript(
    session: string,
    meta: { mode: Mode; protocol: string; started: string }
  ): void;
  appendTurn(session: string, turn: Turn): void;
  rebuildIndex(): Index;
}
