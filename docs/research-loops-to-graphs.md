# Loops to Graphs: What the Agent-Architecture Literature Owes Elicit

An assessment of a 2026 synthesis paper on agent architectures — Karpathy's
autoresearch loop, AgentHub, Anthropic's workflow patterns and Knowledge Graph
Construction Cookbook — read against Elicit's design. Written 2026-08-01.

**The verdict up front:** Elicit already implements the half of that
literature that matters, often more strictly than the literature prescribes.
The swarm half is irrelevant here by design. Three specific ideas are worth
importing; they are named in §4 with enough detail to act on. Nothing in this
doc changes an existing invariant — two sections argue *against* changes the
source paper might tempt someone into.

## 0. Context for a fresh agent

Elicit (this repo) is an agentic elicitation tool: it interviews a person and
builds a human-shaped wiki of their beliefs, contradictions, knowledge, and
skills, out of nothing but their own verbatim words. Read `CONTEXT.md` first —
it is the language spec, and this doc uses its terms (Snippet, Claim,
Contradiction, Clerk, Protocol, Resonance, Seeding) without re-defining them.
Two invariants matter constantly below: all inference is local
(`docs/adr/0001-local-models-only.md`), and the Clerk is the sole writer to
the Wiki.

The source under assessment is an independently compiled synthesis note,
"The Karpathy Loop, Improved 1000x by Itself / The Anthropic Playbook"
(July 2026, unaffiliated, unendorsed). It maps a progression of agent
architectures:

- **Loop** — Karpathy's autoresearch: an agent inside a harness with a
  mutable artifact (`train.py`), a fixed metric, short runs, and a
  keep-or-revert rule per change. The "ratchet loop."
- **Swarm / commit DAG** — AgentHub: many agents exploring in parallel,
  coordinating through a bare Git DAG and a message board; no main branch,
  no merges — the primary operation is traversing the search graph.
- **Workflows** — Anthropic's five composable patterns (2024) and Dynamic
  Workflows (2026): generated orchestration scripts spawning up to 1,000
  fresh-context sub-agents.
- **Knowledge graph** — Anthropic's KG Construction Cookbook:
  schema-constrained extraction of typed entities and relations, model-driven
  entity resolution, a provenance-carrying property graph, bounded-subgraph
  querying with edge-level citations.

Its synthesis: each architecture externalizes a different bottleneck (a loop
externalizes iteration, a DAG externalizes lineage, a knowledge graph
externalizes shared facts and cross-session memory), and the real bottleneck
is usually the placement of memory and evaluation, not the next model call.
Its closing demand: *every important output can be traced to an objective, a
plan, an artifact, a source, a graph path, an evaluator decision, and a
bounded execution record.*

Caveat on the source: it is a self-compiled study note. Its headline numbers
(700 experiments in 2 days, star counts, the "1000x" title) are repeated from
briefs, not verified. The architectural taxonomy is sound; treat the
empirical claims as color.

## 1. Where Elicit already satisfies the paper

The paper's core invariants read like a restatement of `CONTEXT.md`:

| Paper's invariant | Elicit's existing form |
|---|---|
| Every claim has a source or is marked inference | Claim cites `snippet@version`, mandatory; skill claims cite Emergent Outputs |
| Every superseded object remains addressable | Immutable Snippet versions; append-only Transcripts; supersede-not-delete |
| Contradiction tracking as first-class graph material | Typed Contradictions (synchronic/diachronic), resolvable only by elicitation |
| Audit trail for every agent act | Activity Log |
| Persistent world model across sessions ("the agent forgets, the graph does not") | The Wiki + vault — this is Elicit's founding thesis, from the other direction |
| Evaluator returns structured missing-evidence feedback, not a score | Claim Status transitions as auditable events |

No action follows from this section except confidence: the design is not
behind the literature.

## 2. Where Elicit is deliberately *stricter* — do not "fix" these

Two places where the cookbook's prescription is the wrong move for a
person-model, and Elicit's existing rule is the correct one:

**Entity resolution.** The cookbook merges surface forms into canonical
entities ("Edwin Aldrin" → "Buzz Aldrin"), then admits in its limitations
that a false merge contaminates every downstream traversal. Elicit's Seeding
rule — *retellings are linked, never silently deduplicated; drift between
tellings is evidence* — refuses the merge entirely, and rightly: in a
self-model, the diachronic drift between two tellings of the same episode is
the signal, not noise to normalize away. If a future task proposes a
resolution/dedup pass over Snippets or Wiki entities, this is the argument
against it. Linking stays; merging never enters.

**Confidence numbers.** The cookbook attaches confidence floats to edges.
Elicit's rule — no confidence numbers anywhere; Status transitions are
auditable events; coreness is computed from the citation graph, never
stored — is the more defensible position. The paper's own evaluator examples
(structured `required_evidence` feedback rather than a score) quietly agree.

## 3. What to set aside

The swarm half — AgentHub, 1,000-sub-agent dynamic workflows, message-board
coordination — does not transfer. Elicit is single-user, local-compute
(ADR-0001), and single-writer by design: "Single writer to the Wiki —
parallel helpers never write" is the Clerk's definition. The paper's own
caveats ("fragmentation can reduce quality"; "when not to use a graph")
describe exactly why the Clerk exists. Parallel fan-out on one local GPU
buys contention, not wall-clock.

## 4. Three imports worth building

### 4.1 The ratchet loop, aimed at Protocols and prompts

The paper's most transferable claim (its §VII.A): the artifact a ratchet loop
optimizes does not have to be training code — it can be the extraction
prompt, the ontology, the question policy. Elicit already owns the metric
half: the Protocol definition in `CONTEXT.md` says *Protocol selection is a
measurement question — track kept-Snippets-per-exchange, switch when yield
drops*. What does not exist yet is anything that closes the loop.

The mapping, concretely:

- **Mutable surface**: one Protocol's probe prompts, or the harvest-cut
  prompt. One change at a time.
- **Fixed evaluator**: kept-Snippets-per-exchange for probes. For harvest
  cuts, the verbatim-substring check is already a deterministic gate —
  fabrication rate and cut-approval rate give precision/recall signals for
  free, no gold-set labeling model needed. (`docs/eval-2026-08-01-real-model.md`
  is the existing eval harness to extend, not replace.)
- **Keep-or-revert**: per change, against the metric. History in git.
- **Bound the horizon**: evaluate on a fixed set of recorded exchanges or
  seeded corpus regions, not on live sittings — the user is not an eval rig.

This is a small build against infrastructure that already exists. The paper's
warning applies: a ratchet games the metric it can see, so hold
kept-per-exchange alongside Facet distribution — a prompt change that raises
yield by biasing everything toward easy abstraction is a regression, and
Facet balance is already tracked per Mode.

### 4.2 Graph-bounded context construction

The paper's §V.B recipe for building a worker's context from a graph:
resolve the entities the current task mentions, expand one or two hops over
allowed edge types, prioritize recent and contested claims, serialize within
a token budget, attach stable IDs for citation.

This matters *more* for Elicit than for the paper's imagined reader, because
ADR-0001 makes small context windows a permanent constraint, not a cost
knob. Resonance and question-minting should never serialize the whole Wiki.
The Clerk's per-turn context build should be: entities in the user's last
utterance → their Snippets and Claims → one hop out along citations and
Contradictions → contested and recent first → budget cutoff → citable IDs
attached. If Resonance currently works as flat search over the vault, this is
the argument for making the Wiki's citation graph the retrieval structure,
not only the output.

### 4.3 Name the two-plane distinction: lineage vs. knowledge

The paper's cleanest conceptual point (its §V.A): a commit DAG (what
changed, what descends from what, who produced it) and a knowledge graph
(what is claimed, on what evidence) are complementary and must not be
collapsed. Elicit has both planes — Transcripts, Snippet versions, and the
Activity Log are lineage; the Wiki is knowledge — and the Claim read-log is
already a principled edge between them.

The import is a sentence of vocabulary, probably in `CONTEXT.md`: lineage
facts and Wiki claims are different planes, connected only by typed,
cited edges. The distinction predicts a failure mode worth guarding: the
moment a lineage observation ("the user restated this Snippet three times")
gets written *as* a Wiki claim without citing the versions it reads, the
planes have collapsed and the claim is unfalsifiable. (Restatement-chain
drift is already specified as legitimate Wiki material — the guard is only
that it cite the chain.)

## 5. Suggested order

1. **4.3** first — it is a documentation edit and it sharpens review of the
   other two.
2. **4.1** next — small, and it compounds: every later prompt change gets a
   harness.
3. **4.2** when Resonance or the Clerk's minting context becomes the
   bottleneck — it is an architecture change to retrieval and should wait for
   evidence that flat search is failing.
