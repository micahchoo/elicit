# Karpathy's "LLM Wiki" and Its Comment Thread, Read for Elicit

Source: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
(posted 2026-04-04; ~500 comments read 2026-08-01). The gist proposes a pattern:
an LLM agent incrementally builds and maintains a persistent, interlinked
markdown wiki over sources the user curates. Three layers — raw sources
(immutable), LLM-written wiki, schema doc (CLAUDE.md/AGENTS.md) — and three
operations — ingest, query, lint — with `index.md` (content catalog) and
`log.md` (append-only chronology) for navigation, Obsidian as viewer, and
[qmd](https://github.com/tobi/qmd) for local hybrid search at scale.

Method note: the comment thread was mined by four parallel agents over the full
500 comments; roughly 60% was praise/spam and is excluded. One commenter
(joshwand) regex-fingerprinted the thread and found **>90% of comments
LLM-written** — the links below were carried through mechanically, but the
prose claims around them inherit that provenance and were treated as leads, not
evidence.

---

## (a) The headline finding: the thread's unsolved problems are Elicit's founding constraints

Independent commenters converge on the same four failure modes of the pattern,
and Elicit's decision register already answers each by construction:

1. **Smoothing.** "LLMs 'smooth over' contradictions or invent connections,
   making the wiki look cleaner than reality" (frosk1); dhruvil-1990 names the
   scale version **"false coherence"** — errors spread through integration and
   become *internally consistent*, hence undetectable by consistency checks.
   Elicit's answer: typed Contradictions, first-class, never silently resolved.
2. **Uncited synthesis.** "The LLM can synthesize without citing, and you won't
   notice unless you look" (bluewater8008); Marekai: compiled citations lose
   page-level anchors and paraphrase by default. Elicit's answer: claims cite
   `snippet@version`; the snippet is verbatim (Q-1, Q-4, Q-5).
3. **Persistent errors.** Shagun0402: "we're trading ephemeral hallucinations
   for persistent errors" — a wrong claim becomes a prior that future
   generations build on. jurajskuska: "Confluence pages don't silently rewrite
   themselves. An LLM wiki can." Elicit's answer: immutable versions,
   append-only transcripts, User-Attested Claims the agent may not rewrite.
4. **No resolution authority.** gnusupport, on the gist itself: "Linting
   detects contradictions — but who resolves them? The doc is silent."
   Elicit's answer is its whole thesis: only elicitation resolves (Q-15).

Nobody in the thread holds all four answers at once. This is positioning
material: Elicit is not an application of the LLM-Wiki pattern but the
disciplined inverse — gpkc names the axis exactly: Karpathy's pattern is "a
personalized research index" (LLM authors synthesis over external sources); the
inverse keeps the LLM as maintainer of what you wrote yourself, "because the
act of writing is load-bearing there, not incidental"
(https://scribelet.app/blog/karpathy-llm-wiki-reaction). robertandrews supplies
the literature name for why: the **Generation Effect** — active production
beats reading for retention and comprehension. pssah4's critique of the gist
("the note is a byproduct; the thinking is the product… I can't argue from
something I built myself, because I never did") is the strongest single
argument *for* Sole Authorship in the thread.

## (b) Mechanisms worth adopting

Each mapped to the decision it extends; none violates the register.

**1. Staleness as a graph computation (extends Q-4/Q-5/Q-14).**
Claims already cite `snippet@version`; nothing yet mechanizes what a new
version does. Three commenters solved this deterministically, zero LLM calls:

- Transitive supersedes-closure — A supersedes B, B supersedes C ⇒ A
  supersedes C — computed structurally
  ([Cortex](https://github.com/abbacusgroup/cortex), OWL-RL over local
  Oxigraph + SQLite FTS5).
- Per-file staleness scores that tick up for each stale *outgoing* citation;
  a read-only auditor surfaces the worst offenders (n7-ved, forward-only, no
  backlink tracking).
- Content-hash check at read time: hash match = valid, mismatch = stale,
  "never serves you something silently out of date"
  ([Freelance](https://github.com/duct-tape-and-markdown/freelance) memory
  layer). barrygfox's follow-up — does one hash change invalidate *all*
  propositions from a file? — is answered by Elicit's snippet granularity.

Mechanism for Elicit: superseding a snippet version mechanically flags every
citing claim; each flag mints a Still-true question under Q-14's
ask-differently rule. Lint becomes a graph query (orphan claims, stale
citations, god-node facets — ClayGendron's
[grover](https://github.com/ClayGendron/grover) and
[Graphite Atlas](https://graphiteatlas.com) both run lint as graph analytics).

**2. Propose-ops → deterministic executor (extends Q-1/Q-12).**
[Palinode](https://github.com/Paul-Kyle/palinode) ("git blame on every fact"):
the LLM emits typed JSON operations — KEEP / UPDATE / MERGE / SUPERSEDE /
ARCHIVE — and a deterministic executor validates, applies, and commits. n7-ved
goes further: the writer agent has no shell and a hook blocks writes outside
its layer. Sole Authorship and the exact-substring rules become properties of
the agent boundary, checked once in the executor, rather than per-callsite
discipline. SonicBotMan's [wiki-kb](https://github.com/SonicBotMan/wiki-kb)
adds validate-before-write: a resolver rejects malformed frontmatter, broken
cross-refs, and empty fields before anything touches disk — "hard rails that
stay programmatically verifiable even when prose drifts."

**3. Queue scheduling (extends Q-13/Q-16).**

- **FSRS spaced repetition** as the revisit scheduler for Still-true questions
  (arturseo-geo runs FSRS over agent-generated cards in
  https://github.com/arturseo-geo/llm-knowledge-base). Gives the Queue's
  horizon field an actual decay curve instead of ad-hoc aging.
- **The loudest-thought problem** (bitsofchris,
  https://github.com/bitsofchris/openaugi, from 4,000 real journal entries):
  naive semantic search "returns 10 versions of your loudest thought — not 10
  facets of your thinking." His fix — overfetch 3×, dedupe near-identicals,
  MMR diversity re-rank — applies to Resonance retrieval *and* to question
  selection; it is the retrieval-side name for the coverage risk the
  Randomizer (Q-16, Q-18) exists to counter.
- **Uptake as signal** (VictorVVedtion's counterfactual tracking): record
  which questions the user skips versus engages and feed it back into
  selection filters. The skip-question feature already emits the event; it is
  currently unconsumed signal.
- **Dispute files as queue entries** (scvince1): unresolved contradictions
  written back into the intake layer as durable files awaiting the next
  session — Elicit's Queue already is this, but the convergent design confirms
  contradictions belong *in* the queue, not beside it.

**4. Seeding hardening (extends the Seeding spec's seven jobs).**

- **Idempotent ingest** (laphilosophia): re-harvesting the same corpus must be
  a no-op, or repeated passes slowly distort the wiki. State this as a Seeding
  invariant and test it.
- **Authorship provenance**: given joshwand's >90% finding, a user's vault
  will contain pasted LLM text. Verbatim is not sufficient for admissibility
  evidence-weighting — Provenance needs an authored / machine-assisted
  distinction for seeded material.
- **The Ingestion Gap** (Eyaldavid7, 7-tournament / 130-question benchmark):
  "mostly finished" wiki compilation scored **17% worse** than complete
  compilation — a half-harvested region can be worse than none. Supports
  Seeding's region-at-a-time discipline; suggests marking regions
  harvested/unharvested rather than leaving a gradient. His "Blueprint
  Paradox" — the wiki beat RAG precisely on *deleted* material — is
  independent support for keeping superseded versions as first-class evidence.
- **Classify before extract** (bluewater8008): type the document
  (journal / letter / transcript / draft) before cutting; extraction templates
  differ per type (dkushnikov's
  [Mnemon](https://github.com/dkushnikov/mnemon) ships seven).

**5. Identity hygiene (new, cheap).**
The first failure mode SonicBotMan hit: fifty pages about the same thing under
slightly different titles. QipengGuo's
[llm-wikidata](https://github.com/QipengGuo/llm-wikidata) recalls existing
entities via embeddings *before* the LLM writes, "preventing the hallucination
of duplicate nodes." Elicit's version: a canonical-name + alias registry for
referents (people, projects, poles), consulted at claim-writing time — "is
this the same belief restated?" becomes a lookup plus at most one
Juxtaposition question, never a silent merge (Link job already forbids silent
dedup; this gives it an index).

**6. Reading-version stamps (extends Q-4).**
l-mb stamps notes with `tagged_on_date` so they can be reprocessed "when
models get significantly better." Facet/Stance readings are wiki-side and
cheap to redo; stamping each with the local model that produced it makes
re-annotation after a model upgrade a queryable batch job on the Docket.

**7. Health metrics (extends the kept-snippets-per-exchange stance).**

- **Compounding ratio** (bradAGI, agentwiki.org): does an ingest *update
  existing* claims or only create new ones? After ~20 sources his system
  touched 3–7 existing pages per ingest — the signature of compounding rather
  than accretion.
- **Held-out-fact retrieval eval** (goatypixel821-hash's
  [ask-shorty](https://github.com/goatypixel821-hash/ask-shorty)): Recall@K /
  MRR against known-good answers instead of spot-checking. Elicit analog: hold
  out attested facts, measure whether the Wiki surfaces them.
- **The drift warning to design against** (asakin,
  https://github.com/asakin/llm-context-base, citing an ETH Zurich result):
  LLM-maintained context files *hurt* agent performance in 5 of 8 settings;
  the mechanism was the LLM inventing its own schema, status values, and tag
  formats as it went. Countermeasures appearing independently in the thread:
  pin the schema hard, and run a **calibration period** during which the user
  reviews all agent annotations before autonomy increases (asakin's ~30-day
  "chatty then quiet" training period; baljanak reaches the same mechanism as
  an identity-filter the human trains). Tension to note: Protocols are data,
  not an enum — open sets need the pinning to live in the claim/reading
  schema, not the Protocol list.

**8. One failure mode to write on the wall** (nishchay7pixels): corrupted
stored knowledge makes the user "start doubting your own memory when served
with corrupted responses." For a person-model this is gaslighting by
construction. It is the strongest argument for rendering snippet provenance in
everything shown — the user must always be able to audit "did I actually say
that?" — and, if ever warranted, content-hashing snippets for tamper-evidence
(mikhashev's git-object mapping gives it free: blob = snippet, SHA = identity,
branch = unresolved contradiction, merge = user's resolution).

## (c) Prior art worth reading, not copying

- **[thinking-mcp](https://github.com/multimail-dev/thinking-mcp)** — flagged
  independently by all four mining passes as the closest existing project to
  Elicit: a cognition graph (8,000+ nodes) with a strict type hierarchy
  (decision rule > framework > tension > preference, "idea" last), epistemic
  tags (sure vs still-working-out), typed edges (`supports`, `contradicts`,
  `evolved_into`, `depends_on`), and differential decay (values hold, ideas
  fade). Its extraction principle — "You can't just ask someone what their
  values are. You have to start from a real decision — what did you reject,
  what tradeoff mattered, what rule did you apply on instinct" — is Critical
  Decision Method restated, corroborating Q-19's Domain-instrument stance.
  Its confidence scores and decay numbers violate Q-21; compare schemas, do
  not import them.
- **Slowly-changing dimensions** (saurabhjha21): diachronic belief versioning
  is data warehousing's SCD Type 2 problem, solved formally in the 1990s —
  Kimball's dimensional modeling is the literature for version-carrying claims.
- **Peas' stenographer constraints** (paulo.com.br): voice-first PKM with "no
  content invention" — every sentence must trace to something the user said,
  gaps become `[TODO]` markers, and cross-links are *mechanical* (title
  mention, slug match, co-occurrence), never LLM-judged. Independent
  convergence on Q-1, plus a suggestion: some Wiki link-formation can be
  lexical rather than agent-judged, which suits the Q-17 staged-hybrid plan.
- **Engelbart's Dynamic Knowledge Repositories** (1992,
  https://www.dougengelbart.org/content/view/116/) — CODIAK, the journal, and
  backlinks read like a 1992 spec for snippet provenance; the LLM plays the
  "diligent, never-bored knowledge worker" Bush and Engelbart lacked.
  Genealogy for the write-up alongside the Memex citation in the gist itself.
- **anzal1's belief lifecycle**
  ([quicky-wiki](https://github.com/anzal1/quicky-wiki)): created → reinforced
  → challenged → superseded, with cascade propagation on resolution. The
  states map onto Status transitions; the cascade matches the register's rule
  that a Contradiction between A and B invalidates only claims citing both.
- **OmegaWiki's `failure_reason`**
  ([skyllwt](https://github.com/skyllwt/OmegaWiki)): marking anything
  superseded *requires* a recorded reason, and dead ends are kept as
  anti-repetition memory. Both fit Contradiction resolution records and the
  asked-question ledger.

## (d) Explicitly not for Elicit

- **Confidence and decay scores on claims** — Q-21 forbids stored numbers;
  Status transitions and citation-graph coreness carry the same information
  auditable. (This excludes half the thread's schemas.)
- **Agent-authored summaries as content, and any auto-resolution** — Q-1 and
  the smoothing failure in §(a) are the same fact seen from two sides.
- **Embedding-heavy retrieval infrastructure now** — vitalii-ivanov-rakuten's
  survey of 17 implementations concludes that under ~500 pages, flat markdown
  plus keyword search beats servers, vector DBs, and decay machinery. Aligns
  with Q-3 and the staged Q-17 plan; the lexical channel ships first for a
  reason.
- **Hand-maintained index files** — mpazik: they break at a few hundred pages;
  "the index isn't a file the agent maintains by hand; it's a query." Q-3
  (derived, rebuildable) is already the right rule.
- **Fine-tuning a local model on the corpus as "memory"** (Aryan1718's
  md2LLM) — weights cannot cite snippet versions; antithetical to provenance.

## Gaps

The mining passes carried link text through mechanically, but claims made *in*
comments (benchmark numbers, star counts, the ETH Zurich citation) were not
independently verified — the ETH result in particular is worth locating before
leaning on it. tomjwxf's signed-receipt IETF drafts and V-interactions'
critique gist were referenced but not read. The thread contains ~80 same-pattern
implementations not individually assessed beyond their one differentiating
idea; the roll-calls live in the four agent reports, not here.
