---
title: "Build: the protocol ratchet — keep-or-revert prompt tuning"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Import 4.1 from `research-loops-to-graphs.md`: a ratchet loop whose mutable
artifact is a Protocol's probe prompt or the harvest-cut prompt — one change
at a time, keep-or-revert against a fixed evaluator, history in git.

- Mutable surface: one prompt at a time.
- Evaluator: kept-Snippets-per-exchange for probes; for harvest cuts the
  verbatim-substring check already yields fabrication rate + approval rate
  deterministically. Extend `docs/eval-2026-08-01-real-model.md`'s harness,
  do not replace it.
- Horizon: evaluate on RECORDED exchanges / seeded corpus regions, never
  live sittings — the user is not an eval rig.
- Anti-gaming guard: hold kept-per-exchange alongside Facet distribution;
  a yield gain that biases toward easy abstraction is a regression (Q-7,
  Q-11). Shadow-first applies (Q-35).
