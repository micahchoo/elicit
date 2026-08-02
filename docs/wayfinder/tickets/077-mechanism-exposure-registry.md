---
title: "Build: a mechanism-exposure registry — live, shadow or unwired is a declared, tested state"
labels: [wayfinder:task]
status: closed
assignee: claude (omp)
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

## Resolution (2026-08-02)

Built: `src/registry.ts` (data, ~140 entries, one per exported mechanism)
and `tests/mechanism-registry.test.ts` (the derived sweep + cross-check).

**The sweep generalizes emitted-kinds.** It enumerates every exported
function and object-const in `src/` (the shapes a capability can hide in
— `lexicalChannel` is an object, not a factory) and requires each to be
declared; a new export with no declaration FAILS, the 063 drift case.
Callers are identifier uses in `src/` or `web/` — the client renders
`formatEvent`/`relativeTime`/`sourceLabel`, so the surface counts —
outside import statements, following aliases and `${…}` template
interpolations. Tests and `scripts/` measurement tools do not count:
`scripts/eval-053` calls the semantic channel and 068 still owns the
honest unwired declaration. `shadow` must be reached AND write its named
Q-35 record kind (verified against `sweepEmitters()`), so a shadow
mechanism that records nothing is indistinguishable from inert. 063's
two guards carry over: bracket balance per file and per-file collapse
minimums, both behind `blank()`.

**Seeded truth, 2026-08-02** (grep-verified, and the oracle's own author
was caught by it: the first seed declared `sourceLabel` live-without-
caller and `SEMANTIC_FLOOR` unwired — the sweep's template-interpolation
pass and the internal-caller rule corrected both before this landed):

- **Unwired — debt with a name:** `resonateHybrid`, `buildSemanticIndex`,
  `fileSnippetVectorStore` (068's channel), `cover` (030 wired the
  consolidation trio, not the tiler — the tiling function itself has no
  production caller), `computeYield`, `classifyFacetIntent` (script-only,
  deck curation), `graduate`, `hasSentence`, `PROTOCOLS` (the file-based
  protocol registry replaced it), `CUTS_RESPONSE_FORMAT`.
- **Shadow (Q-35):** the facet-balance filter family (9 declarations,
  `facet-balance-shadow` per draw) and `shadowDecision`
  (`shadow-decision` / `threshold-clipped`). `SEMANTIC_FLOOR` is shadow
  too — `live:false`, passed through `shadowDecision` inside the unwired
  channel, so its records accrue only once 068 lands.
- **Live by Q-56 declaration:** `OPPOSITION_QUOTA`, `PRIME_CAP_BOUND`,
  `PRIME_BUDGET_BOUND`, `QUERY_BUDGET_BOUND` — bounds ship live; the
  entries note the channel that reads them is unwired.

Verification: `npx tsc --noEmit` clean; `npm test` 1300/1300. 068 flips
six entries (three channel + floor) when its wiring wave lands.
