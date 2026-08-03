/**
 * KTG territory ontology types — ticket 094.
 *
 * These are INSTRUMENT types: agent-side targeting data, never knowledge
 * about the person. A node id may appear on a claim as a locator (Range-like),
 * never as evidence. The tree holds weak priors until touched by live
 * elicitation — the Seeding/Confirm posture applies.
 */

/** How the skeleton was generated — provenance, not a model stamp. */
export type KtgProvenance = {
  /** Generator identity: e.g. 'mr-ktg-v1' or hand-authored */
  generator: string;
  /** ISO-8601 timestamp of generation */
  generatedAt: string;
  /** The model that produced it, when a model was used */
  model?: string;
  /** The domain this tree targets */
  domain: string;
  /** Target competence level */
  targetLevel: string;
};

/** A school of practice — the standing disagreements at domain level. */
export type KtgSchool = {
  id: string;
  name: string;
  /** What this school optimises for */
  optimisesFor: string;
  /** What this school knowingly sacrifices */
  givesUp: string;
  /** School ids this school disagrees with */
  quarrelsWith: string[];
};

/** A cluster of related skills — why this group is grouped, what it's for. */
export type KtgCluster = {
  id: string;
  icon: string;
  name: string;
  /** Why this cluster exists — the know-why at cluster level */
  gist: string;
};

/** Contested rationale for a node — only when practitioners disagree. */
export type KtgKnowWhy = {
  claim: string;
  because: string;
  disputedBy: string;
  source: string;
};

/**
 * The skeleton-only fields: what Pass A emits.
 * `tier` = 1 + max tier of hard prereqs (enforced by validator).
 */
export type KtgNodeBase = {
  /** Stable slug: domain.cluster.node */
  id: string;
  /** Human label — never surfaced to the user in question text */
  label: string;
  /** 1 + max tier of hard prereqs */
  tier: number;
  /** Cluster id this node belongs to */
  cluster: string;
  /** Hard prerequisites — node ids that must be evidenced first */
  prereqs: string[];
  /** Soft prerequisites — ordering hints, not enforced */
  softPrereqs?: string[];
  /** What this lets you do that you couldn't before */
  oneLine: string;
  /** Estimated hours to competence at this node */
  hours: number;
};

/** The body fields Pass B fills in. Separable so the skeleton stands alone. */
export type KtgNodeBody = {
  /** Terms with the clause that makes each usable */
  knowWhat: string[];
  /** Procedures, techniques, conventions, sequences, criteria */
  knowHow: string[];
  /** Recurring mental moves of a practitioner */
  habits: string[];
  /** Contested rationale, or null when uncontested */
  knowWhy: KtgKnowWhy | null;
  /** Schools that weight this node unusually; empty = neutral */
  schoolWeights: Record<string, 'high' | 'normal' | 'low' | 'rejected'>;
  /** Observable performance: pass or fail */
  checkpoint: string;
  /** How people get this wrong or plateau here */
  commonFailure: string;
  /** Named practitioners, texts, or traditions */
  sources: string[];
};

/** A full node: skeleton fields always present, body fields optional. */
export type KtgNode = KtgNodeBase & Partial<KtgNodeBody>;

/** A complete KTG skeleton for one domain. */
export type KtgSkeleton = {
  provenance: KtgProvenance;
  domain: string;
  level: string;
  schools: KtgSchool[];
  clusters: KtgCluster[];
  /** The shortest path from tier-1 to real competence: 8-12 node ids */
  spine: string[];
  nodes: KtgNode[];
};
