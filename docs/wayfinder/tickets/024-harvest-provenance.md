---
title: "Fix: harvest provenance derivation + decisions validation + dedupe"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Fix wave 2, commit 9ccac72 (+156d686 user-last fix found in verification): sourceTurn derived by transcript substring search, proposal dedupe, 400 on malformed decisions. Invariants later verified 8/8 on the real vault (RESULTS.md).
---

## Question

Real-model eval (docs/eval-2026-08-01-real-model.md, findings 3 and 6):

1. **Derive, never trust, sourceTurn.** The harvester trusts the
   model-emitted `sourceTurn`; the eval showed cuts stamped with the wrong
   question (question provenance follows sourceTurn). The cut text is
   already a verified exact substring — find its turn by searching the
   transcript, deterministically. If the substring spans no single user
   turn, the proposal is invalid: drop it, log why. The model's sourceTurn
   becomes a hint at most.
2. **Dedupe proposals.** The same cut was proposed twice in one harvest.
   Exact-duplicate cuts collapse before the review screen; near-duplicates
   (one contains the other) keep the longer.
3. **Validate decisions.** `decide()` silently `continue`s on unknown
   actions and out-of-range indices — malformed payloads return
   success-empty. The route 400s with the offending entry named. A decision
   list that references no valid proposal is an error, not an empty result.

Acceptance: unit tests for turn-derivation (incl. a cut appearing in two
turns → earliest wins, logged), dedupe, and 400-on-malformed; e2e keeps the
existing happy path green.
