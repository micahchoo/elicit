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
export type QuestionSource = {
  channel: string;
  channelTitle?: string;
  blockId: number;
};
export type QuestionProvenance = 'bank' | 'composed' | 'juxtaposition' | 'probe' | 'close' | 'skip';

export type Target = 'self' | 'domain';

export type Mode = {
  minutes: number;
  energy: 'low' | 'medium' | 'high';
  topic?: string;
  target?: Target;
};

export type Turn = {
  role: 'agent' | 'user';
  text: string;
  at: string;
  /** Present on agent turns; the eliciting probe's QuestionForm tag */
  questionForm?: QuestionForm;
  /** Source provenance when this is a bank-drawn question */
  questionSource?: QuestionSource;
  /** Set in memory when the user skips this agent turn — never persisted to disk */
  skipped?: true;
  /** True when this user turn included dictated (STT) text — evidence tag only */
  spoken?: true;
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
  questionSource?: QuestionSource;
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
  questionSource?: QuestionSource;
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

// ── Slice 2: resonance, queue, docket ──

export type ResonanceHit = {
  snippetId: string;
  version: number;
  /** Exact substring shared by query text AND snippet text */
  sharedPhrase: string;
  score: number;
  snippetText: string;
};

export type RedLight = {
  kind:
  | 'odd-term'
  | 'unexplored-referent'
  | 'abstraction-no-episode'
  | 'pole-no-contrast'
  | 'cause-no-event';
  /** Exact substring of the user turn that triggered the light */
  phrase: string;
};

export type QueueEntry = {
  id: string;
  status: 'pending' | 'asked' | 'answered' | 'deferred' | 'expired';
  source: 'composed' | 'still-true' | 'user-declared';
  license: string;
  question: string;
  questionForm: QuestionForm;
  cites?: string[];
  quotedFragment?: string;
  modeNeeds?: { minMinutes?: number; energy?: 'low' | 'medium' | 'high' };
  sharpness: 'weak' | 'sharp';
  direction?: string;
  horizon: 'now' | 'session' | 'days';
  created: string;
};

export type QueueDraft = Omit<QueueEntry, 'id' | 'created' | 'status'>;

export interface QueueStore {
  add(e: QueueDraft): QueueEntry;
  list(filter?: { status?: QueueEntry['status']; source?: QueueEntry['source'] }): QueueEntry[];
  draw(mode: Mode, phase: 'opening' | 'mid' | 'late'): QueueEntry | null;
  markAsked(id: string): void;
  markAnswered(id: string): void;
  defer(id: string): void;
  expire(olderThanDays: number): number;
}

export interface LexicalIndex {
  /** Opaque — shape defined by index/lexical.ts */
  readonly _brand: 'LexicalIndex';
}

export type DocketReport = {
  reindexed: number;
  minted: QueueEntry[];
  expired: number;
  index: LexicalIndex;
};

export type SessionState = {
  id: string;
  mode: Mode;
  protocol: string;
  deps: {
    complete: Complete;
    vault: Vault;
    queue: QueueStore;
    index: LexicalIndex;
  };
  turns: Turn[];
  /** Question bank for opener/skip selection (session-local) */
  bank?: { text: string; questionForm: QuestionForm; source?: QuestionSource }[];
  questionCount: number;
  phase: 'open' | 'mid' | 'closing-door' | 'closing-bookmark';
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
