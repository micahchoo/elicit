---
title: "Build: the user edits a claim, and the edit becomes a Snippet (Propagation)"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

Found by the 2026-08-03 CONTEXT.md audit: two of the constitution's
promises are unbuilt, and they are one feature.

CONTEXT — User-Attested Claim: "A Wiki claim the user has **edited**. The
agent may never silently rewrite it." CONTEXT — Propagation: "Every user
edit to a Wiki claim becomes a Snippet (it is the user's prose), so the
claim acquires evidence and stays falsifiable — **mandatory**, or the Wiki
silts up with unassailable premises."

On disk today:
- `src/server.ts:2081` (comment): "Nothing a client can send edits a
  claim" — the wiki claim routes are read / attest / challenge only.
  There is no edit surface.
- `src/wiki/ops.ts:573` (comment, added after T15 measured it): "this
  propagation is currently a NO-OP."

Build: the claim-edit verb (Q-33's family — a USER verb, no ClerkOp may
reach it), the edited body/range becoming `attested`, and the mandatory
Propagation: the edit text captured as a Snippet (user prose, its own
provenance kind or channel), cited by the edited claim so it stays
falsifiable. The optional cascade into cited snippets as new user-authored
versions is CONTEXT's "optionally" — decide and record, don't silently
skip. UI per the verb-grammar principle (correcting → the diff: constraint
visible, explicit commit/cancel, never a silent revert — Micah's
2026-08-02 plan docs/superpowers/plans/2026-08-02-verb-grammar-collisions.md).

Acceptance: an edited claim reads `user-attested` and cites a new Snippet
holding the person's edit verbatim; the agent can open a Contradiction
against it but never rewrite it; the ops.ts no-op comment is gone because
the mechanism exists; suite green.
