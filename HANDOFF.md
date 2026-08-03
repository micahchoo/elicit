# HANDOFF — Elicit

Updated: 2026-08-03, after 014 closed and 090 (Coach) dispatched.

## Right now

**One agent in flight: omp exec on ticket 090** (the Coach slice, plan
`docs/superpowers/plans/2026-08-02-coach-slice.md`, per-task commits
"coach: … (090 TN)"). Log: `/tmp/omp-wave6/090.log`. It commits per task;
verify the finished slice against the tree, then close out.

**The person's parallel work sits uncommitted — never touch or stage:**
`README.md`, `docs/interface-references.md`, `web/style.css`,
`data/annotations/` (live runtime store),
`docs/superpowers/plans/2026-08-02-verb-grammar-collisions.md`,
`tools/claim-review/server.log`. The `ia-redesign` branch was merged into
main by the person (a36591b — persistent nav shell); a worktree lives at
`.claude/worktrees/verb-redesign/` (vitest excludes it — bbdbd01).

**Server on :4517** runs from a task in this session's background; build at
launch: `e2784d2` (pre-Seeding-final). Restart runbook:
`docs/superpowers/plans/2026-08-02-the-clerk.RESULTS-runbook.md` §2 (direct
tsx launch, tee to /tmp/t16-server.log, never watch mode). BEFORE any
restart: tail `vault/log/<today>.jsonl` — if the last event is minutes old
the person may be mid-sitting; ask first. The vault has REAL usage now:
3 composed Pieces, imported post-* transcripts, 33 queue entries.

## Map state

93 tickets charted, 84 closed. Tracker `docs/wayfinder/tickets/`, map
`docs/wayfinder/map.md`, canon Q-1..Q-78 in `docs/decisions/elicit.md`.

Open (9) and their order:

- **090** Coach — EXECUTING (above). Then:
- **092** KTG decomposition into the Coach's compose prompts — small
  prompt+tests task, blocked_by 090, dispatch right after it.
- **093** claim edit + Propagation — from the 2026-08-03 CONTEXT audit:
  no claim-edit surface exists (`server.ts` "Nothing a client can send
  edits a claim") and `ops.ts:573` propagation is a documented NO-OP,
  though CONTEXT calls it mandatory. Dispatchable anytime (server/web
  after 090 lands). UI follows the person's verb-grammar plan (correcting
  → diff grammar).
- **094** restatement chains unread — capture exists, nothing consumes
  chains. Count chains in the real vault FIRST; likely data-bound.
- **065** EventKind union — LAST by design; cut the union only after 090+
  092 stop minting kinds.
- **010** composition — build done; open only for T14, the person's
  real-model RESULTS run. Note: 3 real Pieces already exist in the vault;
  the person's impressions + a RESULTS write-up close it.
- **012** soundings — waves 1-3 done; open only for T14, the five-sitting
  shadow walk (human).
- **015** queue maturation remainder, **033** graph-bounded context —
  honestly data-bound; usage is now genuinely accruing.

## Discipline (hard-won this session — memories exist for most)

- Verify agents against the tree, never reports: run tsc + npm test +
  vite yourself; check production wiring (the server actually passing the
  dep — two agents shipped docket jobs the server never called).
- Shared git index races: while an exec agent commits, use
  `git commit -m msg -- <paths>` for tracked files; plumbing CAS
  (GIT_INDEX_FILE + commit-tree + update-ref old-new) for untracked.
- `omp -p "$(cat missing.md)"` launches an UNGUIDED agent: Write prompts
  as their own step, gate with `test -s`, tail the log once after launch.
- Whole-file reindents by agents hide one-line changes and break canon
  greps — `git diff -w` first, revert reformat, keep the real change.
- Never `git add -A` (vault is a separate repo; person's files dirty).
- Local models only: elicitor bonsai-27b @192.168.0.229:8088/v1, clerk
  qwen3.6:35b @192.168.0.229:11434/v1 (docker exec ollama …), embeddings
  qwen3-embedding. Measurements ABOUT the clerk stay on qwen.
- omp fix agents never commit; plan-exec agents commit per task.
- Classifier denials are surfaced, never worked around.

## Waiting on the person (none blocking)

- 010 T14 RESULTS run (3 Pieces already composed — ask for impressions).
- 012 T14 shadow walk (five sittings).
- Second claim-review pass over the 104 unreviewed claims — re-measures
  085's mode counts now that 087+091 landed; app at tools/claim-review/.
- The re-measure question still undrawn in the queue.
- 094's chain count may need their sense of what a chain is.
