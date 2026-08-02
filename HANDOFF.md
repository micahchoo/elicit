# HANDOFF — Elicit

Updated: 2026-08-02, after commit `84243bd` (tickets 060 + 088 closed).

## Right now

**Tree is clean at `84243bd`.** The only untracked file is
`tools/claim-review/server.log`, uncommitted on purpose. Never `git add -A`;
`./vault` is a separate git repo and must not be swept into this one.

**One agent in flight:** omp wave 6 on ticket **091** (harvester/mint payloads
get the stored `provenance.question`/`context`, typed-marked; lineage must stay
uncitable). Its file fence: `src/harvester/harvester.ts`, `src/clerk/mint.ts`,
their tests, registry appends, its ticket. Log: `/tmp/omp-wave6/091.log`.
It must NOT commit — verify against the tree, then commit its work yourself.

## Map state

90 tickets charted, 78 closed, 12 open. Tracker: `docs/wayfinder/tickets/`,
map at `docs/wayfinder/map.md`. Canon: Q-1..Q-78 in `docs/decisions/elicit.md`.

Open tickets and their order:

- **091** — in flight (above).
- **087** mint-prompt + lint correctives (085's measured modes) — dispatch
  AFTER 091 lands: both touch `src/clerk/mint.ts`. Then **089** (after 087,
  shares lint files).
- **010** composition slice — next in the ruled sequence 058✓→010→012→014.
  Plan approved at `docs/superpowers/plans/2026-08-02-composition-slice.md`
  (twice-reviewed, commit `bb87680`); execution dispatches from it, per-task
  commits like 058's execution. Fence: `src/piece/` (new), `web/main.ts`,
  `src/server.ts`, `src/clerk/arrangements.ts` (new) — no overlap with 091.
- **012** Soundings after 010; **014** Seeding after 012 — 014's approved plan:
  `docs/superpowers/plans/2026-08-02-seeding-slice.md`. Wave-3 gate there:
  route-driven import must leave `provenance.authorship` on disk. Never skip it.
  Pre-dispatch check (found by the Coach-plan review): its T14 calls
  `api('/api/reach')`, and `web/main.ts#isReadPath` doesn't know that path —
  the GET would go out as a POST. Verify/fix at that wave, same
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
