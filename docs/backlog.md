# Backlog — mechanisms adopted in principle, staged by slice

Source: mostly `research-llm-wiki-gist.md` (Karpathy thread mining), plus
research docs. Each entry names the slice that should absorb it and the
decision it extends. Nothing here is licensed to ship without its slice.

## Clerk slice (wiki claims + contradiction detection)

- **Staleness as graph computation** (extends Q-4/Q-5/Q-14): a new snippet
  version mechanically flags every citing claim; each flag mints a Still-true
  question (ask-differently). Lint = graph queries: orphan claims, stale
  citations, god-node facets. Zero LLM calls.
- **Propose-ops executor** (extends Q-1/Q-12): the model emits typed operations
  (KEEP/UPDATE/MERGE/SUPERSEDE/ARCHIVE); a deterministic executor validates and
  applies. Invariants become agent-boundary properties checked once, not
  per-callsite discipline. Validate-before-write on frontmatter/cross-refs.
- **Identity hygiene**: canonical-name + alias registry for referents (people,
  projects, poles), consulted at claim-writing time. "Same belief restated?" is
  a lookup plus at most one Juxtaposition — never a silent merge.
- **Reading-version stamps** (extends Q-4): stamp each Facet/Stance reading
  with the model that produced it; re-annotation after a model upgrade becomes
  a queryable Docket batch job.
- **Supersede requires a reason** (OmegaWiki): any superseded status carries a
  recorded why; dead ends kept as anti-repetition memory.
- **Belief lifecycle cascade**: created → reinforced → challenged → superseded
  maps onto Status transitions; cascade on resolution honors the
  both-cited-only invalidation rule.
- **Embedding channel** (Q-17 stage 2): Ollama `qwen3-embedding` at
  the local Ollama `/v1/embeddings` endpoint; MMR/diversity re-rank per the
  loudest-thought rule (lexical channel got it in slice 2).

## Queue/selection maturation

- **Exposure control (Q-13, board filter 5)**: drop question-shapes asked too
  recently (form-furniture check) — needs the asked-history that `markAsked`
  already records. Slice-2's top-k-random is partial protection only.
- **Facet-balance shadow filter (Q-13/Q-7, board filter 3)**: assemble a
  hypothetical balanced session from the facet blueprint, ask only its first
  question. Needs per-session facet tracking over readings (exists on disk,
  unaggregated).
- **Silence thresholds (board, In the Moment)**: structurally moot while the
  UI is turn-based (the agent cannot interrupt; the user sends when ready).
  Becomes real if the interface ever watches live typing. Recorded as an
  accident of the interface, not a decision.

- **FSRS as the Still-true horizon curve** (extends Q-14/Q-16's crude-legible
  rule): a candidate legible heuristic, user-overridable; not an optimal
  scheduler (restless-bandit intractability stands).
- **Uptake as signal**: skip/defer/engage events already emitted, currently
  unconsumed; feed into selection filters as exposure/appetite data. Never
  into an engagement objective (Bjork warning, Q-13).
- **Calibration period**: first ~N sessions, user reviews all agent readings
  before Docket autonomy increases (ETH-drift countermeasure — verify the ETH
  citation before leaning on it publicly).

## Seeding slice (import)

- **Idempotent ingest invariant**: re-harvesting the same corpus is a no-op.
  Test it.
- **Authorship provenance**: seeded material needs authored vs machine-assisted
  distinction (vaults contain pasted LLM text; verbatim ≠ authored).
- **Region completeness marks**: harvested/unharvested as a boolean per region,
  not a gradient — the Ingestion Gap result (17% worse when "mostly done").
- **Classify before extract**: type the document (journal/letter/transcript/
  draft) before cutting; per-type extraction templates.

## Health metrics (when RESULTS accumulate)

- **Compounding ratio**: does new material update existing claims or only
  create new ones? Touching existing pages per ingest = compounding signature.
- **Held-out-fact eval**: hold out attested facts; measure whether the Wiki
  surfaces them (Recall@K, MRR).

## Positioning (README, someday)

- The four LLM-wiki failure modes (smoothing/false coherence, uncited
  synthesis, persistent errors, no resolution authority) vs. the register's
  by-construction answers. Elicit as the disciplined inverse: the model
  maintains what you wrote; the writing is load-bearing (Generation Effect).
  Genealogy: Bush's Memex → Engelbart's DKR/CODIAK → this.

## Explicitly rejected (do not resurrect)

- Stored confidence/decay numbers on claims (Q-21).
- Agent-authored summaries as content; any auto-resolution (Q-1, Q-15).
- Vector/server retrieval infrastructure below ~500 pages (Q-3, Q-17 staging).
- Hand-maintained index files (Q-3: the index is a query).
- Fine-tuning as memory (weights cannot cite snippet versions).
- Conversation-rollout question selection (SparkMe-style utility
  estimation) — the clever selector at maximum cost (Q-82, 2026-08-03).
- Exhibits — documents-of-action as a citable evidence class (Q-80,
  2026-08-03). Self-authored documents already have the import door
  (Q-57/Q-58); everything else stays behind Q-78's never-open rule,
  scoped to the Coach as designed. No typed-citation schema for
  artifact refs.

## KTG territory ontology (ticket 094, 2026-08-03)

- **Territory gap-fill sweep** (094 P3): live — mints frontier questions
  for unprobed KTG nodes adjacent to evidenced ones, and common-failure
  probes for evidenced nodes. Zero-LLM (template questions around node
  oneLine). Bounded by TERRITORY_MINT_CAP = 2 per docket run.
- **Coach checkpoint quests** (094 P5): deferred — adviceGuard requires
  every option to cite existing claim ids; territory-minted quests have
  no claim behind them. A clean resolution that does not weaken the
  guard is still open.
- **Coverage derivation from sittings** (094 P2): deferred — the
  sittingOf resolver is stubbed to null in the server wiring because
  Snippets carry no sittingId. Reading status is explicit rather than
  derived. When the vault gets a snippet→sitting mapping, coverageForNode
  with a real resolver can replace the explicit status reads.
