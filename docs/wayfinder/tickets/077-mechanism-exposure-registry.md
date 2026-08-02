---
title: "Build: a mechanism-exposure registry — live, shadow or unwired is a declared, tested state"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

From the codex comparative review (research-codex-lessons.md, lesson 3),
naming this repo's most repeated defect class: mechanisms built, tested,
and reaching nothing. Five shipped inert so far — semantic resonance
(068), computeYield, cover() before 030 wired it, the 044 gate (inert on
real prose per 037), and the WikiReport counters (071). Each was found by
accident or by a dedicated audit.

Codex's countermeasure is structural: ToolExposure is an explicit enum
(Direct | Deferred | DirectModelOnly | Hidden), so a capability that
exists but is not surfaced is a declared state — enumerable, testable,
never an accident of missing call sites.

Elicit already built the right scanner for the sibling problem:
tests/emitted-kinds.ts sweeps the tree so an event kind cannot exist
unrendered. Generalize it:

- A registry (data, not prose — a TS module or JSON the test reads) where
  each exported mechanism declares `live | shadow | unwired`, with a
  one-line reason for anything not live.
- A test that cross-checks the declaration against actual call sites, the
  emitted-kinds way: a mechanism declared `live` with no caller outside
  its own tests FAILS; a caller appearing for something declared
  `unwired` FAILS (the declaration is stale); `shadow` requires the
  shadow-record write the Q-35 pattern demands.
- `unwired` entries are debt with a name — the frontier can see them.

Acceptance: the registry covers every exported mechanism the sweep can
enumerate; seeding it honestly reproduces today's truth (068's semantic
index declared unwired until its wiring wave lands); the cross-check
test fails on a synthetic live-but-uncalled fixture; the sweep's
own guards (063's two blind-spot fixes) carry over.
