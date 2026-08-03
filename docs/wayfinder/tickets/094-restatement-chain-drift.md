---
title: "Build: read Restatement chains as drift — the recorded signal nobody consumes"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

Found by the 2026-08-03 CONTEXT.md audit. CONTEXT — Restatement: "A long
Restatement chain is a drift signal: the Wiki reads successive versions as
a changing self-narrative, not as approximations to a fixed truth."

The capture side exists (`Provenance.kind: 'restatement'`,
`src/harvester/harvester.ts` — a restatement is a NEW snippet, no reading
created). But nothing consumes chains: no lint, no docket job, no reading
mechanism follows successive restatements of one origin. The signal is
recorded and never read — a dead letter box of exactly the kind ticket 027
just closed for Buds.

Design first (small grill or in-ticket ruling): what IS a chain
mechanically (restatements linked to a common ancestor? same session
re-restates?), what does the Wiki write when it reads one (a claim citing
the chain's versions — Two Planes demands the lineage citations), and what
licenses it (Q-31 add-only; presumably a zero-LLM detector flagging chains
of length ≥ N in shadow, with the reading minted by the clerk citing every
version). Diachronic framing: the drift IS the finding — no resolution
question, kin to the diachronic Contradiction.

Sequencing: needs real restatement data to tune N — check the vault for
how many restatement chains exist before building; if near zero, this may
be honestly data-bound like 015/033. Record the count either way.

Acceptance: a chain in a test vault produces one claim citing all its
versions with the drift framed as change, never error; zero-length and
singleton chains stay silent; the shadow record shows the detector's
would-fires on the real vault; suite green.
