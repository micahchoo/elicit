# HANDOFF — Elicit

Updated: 2026-08-03, after 010 T10/T13 landed and 089 shipped uncommitted (HEAD `1e4a1a3`).

## Right now

**Tree is green at `1e4a1a3`: tsc clean, 76 files / 1625 tests pass at the
010-T10 commit, vite build ok.** Ticket 087 landed (`f027392`) and its fence
is committed. Ticket **074**'s annotation half is IN FLIGHT on this tree,
uncommitted and foreign to every commit below: `src/clerk/annotate.ts`,
`tests/annotate.test.ts`, `scripts/measure-074-annotate.ts`,
`data/eval-074-annotate/`, plus edits to `src/registry.ts` and
`tests/invariant-context.test.ts` — plus `tools/claim-review/server.log`
(untracked on purpose). Never stash, revert, or rebase the 074 work; never
`git add -A`. Ticket **089**'s fix ships uncommitted in this tree (see below).

**010 composition slice: COMPLETE except T14.** Pass 1 and pass 2 are fully
landed and green; the only open item is T14 (real-model run + RESULTS; Micah +
real vault + live model — a human remainder). Commits: T1 `6410f38`, T2
`11ba5e05`, T3 `e52e0c9`, T4 `b60c82b`, T5 `1930fbe`, T6 `d50528a` (routes +
readVersion + ticket 081), T7 `219d7e4` (web surface, browser-verified), T8
`985dbd1` (pass-1 e2e), T9 `05abe56`, registry chore `3c70694`, T11 `5171c71`
(arrangements + ticket 082), T12 `9a9faa4` (routes + surface), **T10 `7f6741a`**
(dormancy predicate, the two register entries + clerk-plan ledger rows, the two
guarded zero-LLM docket jobs, the two runDocketNow thunks, the wave-3 log
kinds, the through-createApp wiring test; stalePins registry entry flipped
live; T12's `gapsPerCandidate: 3` literal switched to the register), **T13
`1e4a1a3`** (pass-2 e2e append, additive). Full record in the ticket's
Resolution and the plan file's checkboxes (T10/T13 ticked, T14 unticked).

Two deliberate deviations recorded in the ticket: the material screen orders by
`captured` (no sitting date on /api/snippets); `proposeArrangements` takes
optional `log` + `modelName` params and `thresholds.gapsPerCandidate` is
injected — T10 switched T12's literal to `THRESHOLDS['piece.gapsPerCandidate']`.

## Map state

90 tickets charted, 78 closed, 12 open. Tracker: `docs/wayfinder/tickets/`,
map at `docs/wayfinder/map.md`. Canon: Q-1..Q-78 in `docs/decisions/elicit.md`.

Open tickets and their order:

- **074**-annotation half — IN FLIGHT, uncommitted on this tree (a peer
  session's fence, listed under Right now). Never stash or revert it.
- **089** godNodeFanout scoped to referents — DONE, shipped uncommitted in
  this tree for driver verification (the whole part-2 file set: lint.ts,
  contract.ts, source-label.ts, thresholds.ts + ledger, the four migrated
  tests, scripts/measure-089-godnode.ts, the ticket closed with Resolution).
  tsc clean, full suite green (77 files / 1641). Verify and commit; the
  ticket's Resolution holds the before/after measurement with SOURCE lines.
- **010** composition slice — T14 only (real-model run + RESULTS, human
  remainder); ticket stays OPEN until it lands. **012** Soundings waits on 010
  closing; **014** Seeding after 012 — 014's approved plan:
  `docs/superpowers/plans/2026-08-02-seeding-slice.md`. Wave-3 gate there:
  route-driven import must leave `provenance.authorship` on disk. Never skip
  it. Pre-dispatch check (found by the Coach-plan review): its T14 calls
  `api('/api/reach')`, and `web/main.ts#isReadPath` doesn't know that path —
  the GET would go out as a POST. Verify/fix at that wave, same `/api/wiki`-
  style exact-match shape.
- **027** gap-fill docket seam — unblocked, but sequence with 010 (server.ts).
- **090** build the Coach — plan-first, grilled canon is Q-73..Q-78.
- **015** remainder and **033** — honestly data-bound, waiting on usage.
- **065** EventKind union — deliberately last (sweeps all kinds).

## Verification discipline (learned the hard way, twice today)

- Verify agents' work against the tree, never their report. The 060 agent left
  its mechanism dead-wired inside the wrong loop filter (tsc TS2367 caught it),
  a whole-file reindent of `contract.ts`, and a red gate-inventory test — all
  found only by running `npx tsc --noEmit` + `npm test` after it exited.
- The "wiring, not signatures" class: an optional dep or an appended block no
  caller reaches ships inert. Demand a test that drives the new path end to end.
- Cite line numbers only from fresh file reads, never inherited from reports.

## Standing rules

- Local models only (ADR-0001). Elicitor: bonsai-27b @192.168.0.229:8088/v1.
  Clerk: qwen3.6:35b @192.168.0.229:11434/v1 (ollama in docker container
  `ollama` — `docker exec ollama ollama ...`). Harness-mechanics tests may use
  bonsai for both roles (map Notes); measurements ABOUT the clerk stay on qwen.
- Bash cannot HTTP here — put fetches in a script file and run it.
- Permission-classifier denials (e.g. process kills) are surfaced to Micah,
  never worked around.
- omp agents never commit; the session driver commits after verification.
- Never stash concurrent agents' dirty work.

## Waiting on Micah (all optional, none blocking)

- 058's live scan of the 47-post corpus (expect "0 to import") and a browser
  pass of the import-folder flow — needs a server restart onto current HEAD
  first (the one on :4517 still runs build `38c4a8a`).
- Pending harvest reviews in the queue on :4517.
- 104 unreviewed claims in `tools/claim-review/` (second 085 pass after
  087+091 land re-measures the mode counts — that is the point of it).
- The re-measure question sits undrawn in his queue; his next sitting draws it
  and produces the ratio the RESULTS wanted most.
