# HANDOFF — Elicit

Updated: 2026-08-01. Session: design + planning, no code written yet.

## What this project is

Agentic elicitation tool. It interviews the user to build a human-shaped
wiki (agent-authored model of beliefs, contradictions, knowledge) from
verbatim fragments of the user's own prose. Writing pieces is one emergent
output, not the goal. Read `CONTEXT.md` first — it is the domain model and
every term in it was explicitly decided, not drafted.

## State

- Design: COMPLETE and user-approved (shared-understanding check passed).
- Plan for first slice: COMPLETE, 3 review rounds, APPROVED.
  `docs/superpowers/plans/2026-08-01-interview-loop.md`
- Code: NONE. Not even `git init` (that is Task 1).
- Next action: execute the plan, Wave 0 (Tasks 1-2), with executing-plans.

## Read in this order

1. `CONTEXT.md` — glossary + invariants (Sole Authorship is load-bearing).
2. `docs/decisions/elicit.md` — Q-1..Q-11 constraint register; plan cites these.
3. `docs/superpowers/plans/2026-08-01-interview-loop.md` — the approved plan.
4. `docs/adr/0001-local-models-only.md`, `docs/interface-references.md` — as needed.
5. `research-shape-of-the-problem.md` — background; §"Where the literature
   contradicts the design" explains why several CONTEXT.md terms look the
   way they do.

## Hard facts a fresh session needs

- Local LLM endpoint: `http://192.168.0.229:8088/v1`, model `bonsai-27b`
  (llama.cpp, n_ctx 16384, health-checked live 2026-08-01). Never call a
  hosted API (ADR-0001).
- Runtime: `@mariozechner/pi-ai` v0.73.x is the LLM seam (the
  `@earendil-works` scope in old notes is its former name).
- The Sole Authorship invariant is enforced IN CODE (substring check in the
  harvester, Task 6), never by prompt.
- Snippet files hold only user prose + provenance; Facet/Stance live in
  Wiki reading files that cite `snippet@version` (Q-4).

## Open threads

- Plan Open Questions: `[SATURATED]` stop-token reliability on bonsai-27b;
  JSON cut-list validity from a 27B local model (parser should tolerate a
  line-oriented fallback). Both exploratory, answered during Wave 1.
- Next-slice note (in plan): stored-transcript format has no questionForm
  slot — matters only when sessions resume from disk.
- Not in this slice at all: composition/reviewer UI, Directions, Randomizer,
  Seeding, Contradiction detection, Piece assembly.
