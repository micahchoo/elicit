---
title: "Build: Domain instruments — CDM, laddered grid, concept sorting as Protocols"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: [002-slice2-results]
---

## Question

Q-19 makes Domain instruments first-class ("the product is workshop and
mirror") and CONTEXT.md's Protocol term says Protocols are DATA, not an
enum. CORRECTION (2026-08-01, found while closing 031): CDM and
laddered-grid PROMPTS already exist in `src/elicitor/protocol.ts` — the
actual gap is narrower: no protocol registry-as-data, no concept-sorting
instrument, no per-protocol selection, no yield tracking. Audit gap found
2026-08-01, scope corrected same day.

Build: a protocol registry (markdown data per Q-3: prerequisites, technique
script, presentation notes), the three domain instruments (Critical
Decision Method, laddered grid, concept sorting) as the first entries, and
yield tracking per protocol (kept-snippets-per-exchange — CONTEXT: switch
when yield drops). Sounding rides tickets 011/012 as its own instrument.
