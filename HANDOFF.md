# HANDOFF — Elicit

Updated: 2026-08-01. Session: design + planning, no code written yet.

## What this project is

Agentic elicitation tool. It interviews the user to build a human-shaped
wiki (agent-authored model of beliefs, contradictions, knowledge) from
verbatim fragments of the user's own prose. Writing pieces is one emergent
output, not the goal. Read `CONTEXT.md` first — it is the domain model and
every term in it was explicitly decided, not drafted.

## State (compaction checkpoint 2026-08-01, latest)

- CANON: CONTEXT.md 35 terms; register Q-1..Q-27; ADR-0001/2/3; 4 research
  docs; docs/backlog.md; wayfinder map + 18 tickets (frontier: slice-2 [claimed,
  running], license, transformative deck, vault backup regime; new: 018
  voice-input via in-process Parakeet STT, blocked by slice-2 — full recipe
  read from omp source is in the ticket).
- Slice-2 execution: Wave 0 ✓ 646ae65; Wave 1 ✓ six modules, 153 tests,
  horizon fix bf973ae; Wave 2 ✓ Task 6 e7266a1 (verified independently:
  tsc=0, 153/153) — `npm start` is SAFE on the committed tree.
  Wave 3 Task 7 ✓ 81b53cd (verified: tsc=0, 154/154, vite build 0 — queue
  endpoint, docket boot+post-harvest, SSE activity, env-var gate, target
  toggle, juxtaposition inset, close flow, waiting surface, phone pass).
  STT engine ✓ b438b5c (verified: smoke exit 0, parakeet loads from omp
  cache; ticket 018 updated — wiring half remains: mic AudioWorklet, server
  route, ratify-in-textarea + spoken provenance).
  Task 7b ✓ 2aa31fd (verified: tsc=0, 190/190, vite build 0): in-app
  password — src/auth/auth.ts (scrypt at vault/.auth.json, injectable),
  loopback-only POST /api/setup, GET /api/auth/status, non-loopback+unset →
  setup page; api() method inference fixed (GET for queue/activity, login
  only on 401 — phantom-password bug dead). User must RESTART any old
  server (fuser -k 4517/tcp; npm start). Host-bound: set password from the
  host first, then `ELICIT_HOST=0.0.0.0 npm start`.
  License brief ✓ (MIT recommended, deps unconstraining) at
  docs/wayfinder/tickets/003-license-brief.md — Micah decides.
  Bank report ✓ data/question-bank-report.md (4308 entries; ~50% ready;
  2057 shared-blockId is the big issue).
  Voice ✓ fcb16df (195/195, smoke ok; ticket 018 CLOSED, first map entry).
  Micah's test sitting exposed defects → tickets 019/020/021 written
  (mechanical: vault/vault log path, question-asked source, harvest-proposed
  event, empty-harvest state; questioner: move library, code pivot rule,
  parrot guard, degenerate-composition guard; bank fallback form-filter)
  + empty activity/queue panels investigation (user-reported).
  RUNNING: fix wave (bg bra09uwdv, prompt /tmp/elicit-fixwave-prompt.md) —
  verification includes a LIVE WALK with fake LLM on ELICIT_PORT=4599
  (user directive: test the app yourself). Verify on report incl. curl
  transcript.
  REAL-MODEL EVAL DONE (agent-run, 2 sittings, isolated rig at
  /tmp/elicit-live + /tmp/elicit-vault): docs/eval-2026-08-01-real-model.md.
  Held: Q-1 verbatim, Q-20 close→user-declared→next-opener loop, auth,
  retry machinery. Broke: composeOpener has no user-role msg → llama.cpp
  Jinja 400 → docket dies post-harvest → stale index → juxtaposition never
  fires (ticket 023: user-role audit, per-job try/catch, harvest response
  isolation, CANONICAL close strings); model-trusted sourceTurn scrambles
  question provenance + no dedupe + decide() accepts garbage silently
  (ticket 024); echo-degenerate probes 2/8 + internal-label leaks
  ("abstraction-no-episode", "What door is this opening?") → 020 in flight.
  Ticket 022: ELICIT_LLM=fake is a 3-shot script, dev mode 500s.
  Fix wave 1 ✓ 6f44553 (verified 227/227, tsc=0, build 0): log path,
  question source on events, harvest-proposed event, empty states, move
  library, code pivot rule (live-walk proven), parrot+degenerate guards,
  bank filter, activity-panel SSE fix (missing Accept header).
  RUNNING: fix wave 2 (bg br1e9pl4d, /tmp/elicit-fixwave2-prompt.md) =
  tickets 022+023+024; acceptance includes REAL-MODEL walk (docket
  completes post-harvest, juxtaposition fires, provenance check).
  End-state interface wireframes REDRAWN after user critique ("inelegant"):
  board `elicit-interface`, 5 rooms under the document rule (recorded in
  docs/interface-references.md §document rule): desk/page/keeping/archive/
  piece — controls only at point of attention.
  COMPLETENESS AUDIT done (workflows vs CONTEXT/ADRs): sound = sitting,
  close-loop, harvest+restatement, voice, custody, activity, bank, still-
  true(age), buds-storage. NEW TICKETS for gaps: 025 expedition lifecycle,
  026 randomizer draws, 027 gap-fill source (Buds are a dead letter box!),
  028 domain instruments (workshop half has no tools), 029 unprompted
  entry + defer verb, 030 wire dormant Cover layer (ADR-0002 layer 3 built
  but never injected — verified by grep).
  GRILL (ticket 006): LOCKED Q-28 minting, Q-29 op contract, Q-30
  contradiction pipeline, Q-31 lint, Q-32 identity tiers, Q-33 six editing
  verbs (body edit → user-attested). REMAINING: model-stamps/re-annotation,
  calibration period → then close ticket, write Clerk plan. Task 8 sittings
  → RESULTS → 002 → 007 → Clerk build (008). Then Task 8 = Micah's real sessions → RESULTS (yield by
  source; composed null-rate >50% decides template-assembly fallback).
  Host-bound run after 7b: `ELICIT_HOST=0.0.0.0 npm start`.
- omp dispatch pattern: read plan task section; structural injection; commit
  ONLY own files; never add -A; index.lock retry; STATUS+commit report.
- npm: start (local model, prestart builds), dev (fake+watch), test.
- Uncommitted doc edits are intentional (commit only when asked).

## Older checkpoint

- Slice 1 (interview loop): BUILT, green, real-model verified, bugs fixed
  (pi-ai assistant content-blocks; POST-method; probe anchoring; skip).
- Slice 2 ("it remembers you"): plan approved after 3 review rounds
  (`docs/superpowers/plans/2026-08-01-it-remembers-you.md`); Wave 0 (types,
  commit 646ae65) done; Wave 1 (six omp agents: lexical index, queue,
  composed, activity log, cover, docket) RUNNING in background. Next: verify
  Wave 1, dispatch Task 6 (elicitor integration) then Task 7 (server+web),
  then Micah's real sessions → RESULTS.
- Known expected tsc error until Task 6: elicitor.ts:55 missing queue/index.
- Build map: `docs/wayfinder/map.md` + 15 tickets (frontier: finish slice 2;
  license; transformative deck). CONTEXT.md: 33 terms. Register: Q-1..Q-23.
  ADR-0002 (three-layer memory). README written. Backlog in docs/backlog.md.
- Zombie-server hazard: `fuser -k 4517/tcp`.
- Currently: grilling session on fog patches (vault custody, emergent
  outputs, phone sittings, outer-loop intent).

## Read in this order

1. `CONTEXT.md` — glossary + invariants (Sole Authorship is load-bearing).
2. `docs/decisions/elicit.md` — Q-1..Q-11 constraint register; plan cites these.
3. `docs/superpowers/plans/2026-08-01-interview-loop.md` — the approved plan.
4. `docs/adr/0001-local-models-only.md`, `docs/interface-references.md` — as needed.
5. `research-shape-of-the-problem.md` — background; §"Where the literature
   contradicts the design" explains why several CONTEXT.md terms look the
   way they do.

## Hard facts a fresh session needs

- Local LLM endpoint: `http://192.168.0.229:11434/v1`, model `qwen3.6:35b`
  (llama.cpp, n_ctx 16384, health-checked live 2026-08-01). Never call a
  hosted API (ADR-0001).
- Runtime: `@mariozechner/pi-ai` v0.73.x is the LLM seam (the
  `@earendil-works` scope in old notes is its former name).
- The Sole Authorship invariant is enforced IN CODE (substring check in the
  harvester, Task 6), never by prompt.
- Snippet files hold only user prose + provenance; Facet/Stance live in
  Wiki reading files that cite `snippet@version` (Q-4).

## Open threads

- Plan Open Questions: `[SATURATED]` stop-token reliability on qwen3.6:35b;
  JSON cut-list validity from a 27B local model (parser should tolerate a
  line-oriented fallback). Both exploratory, answered during Wave 1.
- Next-slice note (in plan): stored-transcript format has no questionForm
  slot — matters only when sessions resume from disk.
- Not in this slice at all: composition/reviewer UI, Directions, Randomizer,
  Seeding, Contradiction detection, Piece assembly.
