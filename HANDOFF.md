# HANDOFF — Elicit

Updated: 2026-08-02, after the 010 composition-slice execution (HEAD `78de2c5`).

## Right now

**Tree is green at `78de2c5`: tsc clean, 75 files / 1613 tests pass, vite
build ok.** The only dirty/untracked files are ticket **087**'s fence —
`src/clerk/mint.ts`, `src/wiki/contract.ts`, `src/wiki/lint.ts`,
`src/wiki/thresholds.ts`, `tests/clerk-mint.test.ts`, `tests/wiki-lint.test.ts`,
`docs/superpowers/plans/2026-08-02-the-clerk.md`, `scripts/remeasure-087-mint.ts`,
`data/eval-087-mint/` — plus `tools/claim-review/server.log` (untracked on
purpose). 087 has NOT committed; its uncommitted changes are foreign to every
commit below. Never stash, revert, or rebase them; never `git add -A`.

**010 composition slice: pass 1 shipped, pass 2 half-shipped, three tasks
blocked on 087** — full record in `docs/wayfinder/tickets/010-build-composition.md`
(Resolution section) and the plan file's checkboxes. Commits: T1 `6410f38`, T2
`11ba5e05`, T3 `e52e0c9`, T4 `b60c82b`, T5 `1930fbe`, T6 `d50528a` (routes +
readVersion + ticket 081), T7 `219d7e4` (web surface, browser-verified), T8
`985dbd1` (pass-1 e2e), T9 `05abe56`, registry chore `3c70694`, T11 `5171c71`
(arrangements + ticket 082), T12 `9a9faa4` (routes + surface), docs `78de2c5`.
**BLOCKED: T10** (dormancy + `piece.dormancyDays`/`gapsPerCandidate` register
entries + two docket jobs + runDocket thunks — its Files list includes
`src/wiki/thresholds.ts`, foreign-dirty at dispatch) and **T13** (pass-2 e2e —
transitively needs T10's docket jobs), plus **T14** (real-model run + RESULTS;
Micah + real vault + live model). When 087 lands, dispatch T10 → T13 → T14 in
that order; T10's remaining work is spelled out in the ticket.

Two deliberate deviations recorded in the ticket: the material screen orders by
`captured` (no sitting date on /api/snippets); `proposeArrangements` takes
optional `log` + `modelName` params and `thresholds.gapsPerCandidate` is
injected (T12 passes 3 with a comment — switch to THRESHOLDS when T10 lands).

## Map state

90 tickets charted, 78 closed, 12 open. Tracker: `docs/wayfinder/tickets/`,
map at `docs/wayfinder/map.md`. Canon: Q-1..Q-78 in `docs/decisions/elicit.md`.

Open tickets and their order:

- **087** mint-prompt + lint correctives (085's measured modes) — in flight,
  uncommitted (above). Then **089** (after 087, shares lint files).
- **010** composition slice — executed above; pass 1 complete, pass 2
  half-landed, T10/T13/T14 blocked on 087 (see Resolution). Not closed.
  **012** Soundings waits on 010 closing; **014** Seeding after 012 — 014's
  approved plan: `docs/superpowers/plans/2026-08-02-seeding-slice.md`.
  Wave-3 gate there: route-driven import must leave `provenance.authorship` on
  disk. Never skip it. Pre-dispatch check (found by the Coach-plan review): its
  T14 calls `api('/api/reach')`, and `web/main.ts#isReadPath` doesn't know that
  path — the GET would go out as a POST. Verify/fix at that wave, same
  `/api/wiki`-style exact-match shape.
- **027** gap-fill docket seam — unblocked, but sequence with 010 (server.ts).
- **074**-annotation half — pending; rendering is web, sequence behind 010.
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
