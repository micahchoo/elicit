# Three-layer memory: vault truth, derived indexes, bounded-context tiling

The memory system has three layers with strict roles. (1) The vault —
markdown files — is the only source of truth. (2) Derived indexes (lexical
resonance now, local embeddings staged) are rebuildable from the vault alone
and never authoritative. (3) Bounded-context assembly ("Cover") tiles
unbounded history into a fixed reading budget for LLM calls: recent material
verbatim, older ranges as one-line summaries with zoom back to raw, no range
ever silently dropped.

## Considered Options

- Adopt OptMem (rejected: unlicensed; 280-byte records, positional identity,
  non-editable log — four hard conflicts with the domain model; its
  "keep what has lasting effect" consolidation is the silent judgment the
  Contradiction rules forbid)
- Big-context models instead of tiling (rejected: local-only ceiling, and
  retrieval-then-assemble beats window-stuffing at every scale we care about)
- Embedding-first memory (rejected for stage 1: under ~500 pages lexical +
  markdown wins; embeddings join with the Clerk slice — Q-17)
- Clean-room rewrite of the tiling idea, adapted (chosen)

## Consequences

- Summaries are agent prose: Marginalia-class, stored under
  `vault/marginalia/`, structurally barred from Pieces.
- Consolidation is one range per Docket run (bounded handoff), emitted to the
  Activity Log.
- Deleting any derived layer costs recomputation, never data.
- Do not read or port OptMem source — implement from spec (license).
