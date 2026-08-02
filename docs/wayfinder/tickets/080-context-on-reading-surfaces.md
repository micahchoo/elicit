---
title: "Build: antecedent context on the wiki surface and randomizer draw — 073's named remainder"
labels: [wayfinder:task]
status: open
assignee: claude (omp)
blocked_by: []
---

## Question

Ticket 073 landed capture, backfill, and the harvest-review rendering, and
named this remainder honestly: the wiki reading surface and the randomizer
draw still show a snippet's text bare, with its `Provenance.context` and
eliciting question sitting unread in frontmatter. 99 of 139 vault snippets
now carry context (backfill applied 2026-08-02); no reading surface shows it.

Render, matching the harvest-review card's treatment (dimmed, the snippet's
own boundary unmistakable, question and context visually agent-plane): the
wiki surface wherever a cited snippet's text is displayed, and the
randomizer's resurfaced draw. The lineage invariant from 073 stands — the
context is display-only ink, never quoted into anything, never indexed.

Constraint from today's concurrency: `src/wiki/store.ts` and `src/server.ts`
are owned by the ticket-075 agent. If the draw payload or wiki payload lacks
the provenance fields and adding them requires `src/server.ts`, record that
exact seam as the remainder instead of touching the file.

Acceptance: a snippet with context renders it dimmed beside the text on both
surfaces; a snippet without context renders exactly as today (absent is not
an empty box); the ticket-073 invariant test still holds; existing suites
green.
