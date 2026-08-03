---
title: "Plan and build: the Seeding slice"
labels: [wayfinder:task]
status: open
assignee: claude (omp exec, seeding)
blocked_by: [013-grill-seeding]
---

## Question

writing-plans then omp execution for the grilled Seeding design.

> PLAN APPROVED 2026-08-02: `docs/superpowers/plans/2026-08-02-seeding-slice.md`
> — 15 tasks, 6 waves, four reviewer rounds (9+4+1 blocking resolved; one
> author disagreement upheld on evidence: the registry sweep demands no web/
> entries). Execution notes that must survive the wave boundary:
> (1) THE WAVE 3 GATE IS THE ONE THAT MATTERS — a full import driven only
> through the routes must leave `provenance.authorship` on a snippet on disk;
> every other authorship test injects `regionFor` directly and passes over a
> dead route. Never skip this gate.
> (2) Waves 3–5 are gated on 058 dispatch 2 (`src/import/commit.ts`, the
> `/api/import` routes, `web/import-entry.ts`/`import-review.ts` do not exist
> yet). Waves 0–2 are file-disjoint and may start earlier if sequencing
> allows. Gate check: `test -f src/import/commit.ts && grep -c "api/import"
> src/server.ts`.
> Execution order per the ruled sequence: after 058 → 010 → 012.

> PLAN APPROVED 2026-08-02: `docs/superpowers/plans/2026-08-02-seeding-slice.md`
> — 15 tasks, 6 waves, four reviewer rounds (9+4+1 blocking resolved; one
> author disagreement upheld on evidence: the registry sweep demands no web/
> entries). Execution notes that must survive the wave boundary:
> (1) THE WAVE 3 GATE IS THE ONE THAT MATTERS — a full import driven only
> through the routes must leave `provenance.authorship` on a snippet on disk;
> every other authorship test injects `regionFor` directly and passes over a
> dead route. Never skip this gate.
> (2) Waves 3–5 are gated on 058 dispatch 2 (`src/import/commit.ts`, the
> `/api/import` routes, `web/import-entry.ts`/`import-review.ts` do not exist
> yet). Waves 0–2 are file-disjoint and may start earlier if sequencing
> allows. Gate check: `test -f src/import/commit.ts && grep -c "api/import"
> src/server.ts`.
> Execution order per the ruled sequence: after 058 → 010 → 012.

> PLAN APPROVED 2026-08-02: `docs/superpowers/plans/2026-08-02-seeding-slice.md`
> — 15 tasks, 6 waves, four reviewer rounds (9+4+1 blocking resolved; one
> author disagreement upheld on evidence: the registry sweep demands no web/
> entries). Execution notes that must survive the wave boundary:
> (1) THE WAVE 3 GATE IS THE ONE THAT MATTERS — a full import driven only
> through the routes must leave `provenance.authorship` on a snippet on disk;
> every other authorship test injects `regionFor` directly and passes over a
> dead route. Never skip this gate.
> (2) Waves 3–5 are gated on 058 dispatch 2 (`src/import/commit.ts`, the
> `/api/import` routes, `web/import-entry.ts`/`import-review.ts` do not exist
> yet). Waves 0–2 are file-disjoint and may start earlier if sequencing
> allows. Gate check: `test -f src/import/commit.ts && grep -c "api/import"
> src/server.ts`.
> Execution order per the ruled sequence: after 058 → 010 → 012.
