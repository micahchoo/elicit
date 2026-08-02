---
title: "Queue maturation: exposure control, facet balance, randomizer draws"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

> UNBLOCKED 2026-08-02: 002-slice2-results, 004-transformative-deck closed.

> PARTIALLY OVERTAKEN 2026-08-02: ticket 042 shipped the facet-balance
> filter (shadow-first) and 045 adds the Target filter. What remains here is
> exposure control (needs the asked-history), uptake-as-signal (needs
> ticket 041's answered state), and FSRS horizons — all data-bound.

## Question

Implement the two locked-but-unbuilt Q-13 filters (form-exposure via asked-history; facet-balance shadow session via aggregated readings) and the Q-18 randomizer draws (depth-stratified resurfacing over the corpus; deck draws from the transformative deck; no agent veto). Small slice, mostly queue-internal.
