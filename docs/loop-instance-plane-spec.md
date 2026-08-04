# Instance plane spec — spawn and destroy Elicit instances

Ratified 2026-08-04 (Q-93, ticket 121). How the improvement loop
provisions a whole Elicit per persona life. Grounded in the config
census of src/server.ts:3783-3885, src/env.ts, src/llm.ts, and
src/reset/fresh-start.ts.

## Shape

One REAL server process per instance, own port, own vault — the
paired trial measures the shipping artifact, never an embedded
approximation (Q-93). An instance is:

```
{ variant: <git worktree at the variant commit>,
  dir:     eval/instances/<cycle>/<trial>/     (cwd of the process)
  port:    4600 + slot,
  auth:    per-instance password -> session cookie }
```

## Variants

A variant is a git worktree checked out at the candidate commit. Both
trial arms (A = baseline, B = candidate) run from worktrees — never
from the repo's live checkout, and NEVER with the owner's vault or
the repo's `data/` in reach. `npm ci` once per worktree.

## Provisioning an instance

The process is spawned with `cwd = dir` and env:

```
ELICIT_VAULT_ROOT=<dir>/vault     # fresh, empty — the persona's life fills it
ELICIT_PORT=<allocated>           ELICIT_HOST=127.0.0.1
ELICIT_LLM=local
ELICIT_LLM_BASE_URL / ELICIT_LLM_MODEL         # copied from the owner's config
ELICIT_CLERK_BASE_URL / ELICIT_CLERK_MODEL     # — the mechanism is measured as shipped, model included (Q-93)
```

Because `cwd = dir`, every cwd-derived path isolates for free:
`data/annotations`, `data/gazetteer` (src/server.ts:3875-3879),
`archives/`, and the decks default `data/decks`. Consequence: the
instrument plane must be MATERIALIZED into the instance dir —
read-only symlinks from the variant worktree for `data/decks` and
any other instrument dirs the variant carries. Person-derived dirs
are never symlinked; they start empty.

**Dossier seeds are NOT injected into the vault.** The vault starts
empty; the dossier is the persona's identity (its system prompt), and
the vault fills through lived use only — that is what agents-as-users
means (Q-87). Nothing in an eval vault was ever written by anything
but the app's own doors.

Auth: after boot, the harness calls `POST /api/setup` with a random
password (loopback-only, as shipped) and holds the `elicit_session`
cookie. Cookies do not survive a server restart (in-memory sessions,
src/server.ts:251) — if an instance restarts mid-trial, the harness
re-logs-in; live sitting state is also memory-only, so a restart ends
the current sitting (the transcript on disk survives). A trial notes
any restart in its record.

Health: poll `GET /api/auth/status` until 200; the banner prints
before the boot docket run, so readiness = HTTP up, not docket idle.

## Running a life

Personas are omp-dispatched (Q-93): one non-interactive run per
persona life —

```
omp -p --cwd <dir> \
  --append-system-prompt <persona-runner prompt + dossier file>
```

The runner prompt carries: the instance base URL + cookie, the
persona's dossier (whole file, docs/loop-dossier-spec.md format), the
scripted revision-sitting number, and the sitting protocol (open a
Mode, answer through /v2, review harvests, live at least as many
sittings as the dossier's `revision-sitting` plus one). The persona
speaks ONLY `/v2` (core API spec); the omp model choice rides omp's
own config — a different family from the elicitor's local models,
which blunts same-model verdict collusion (Q-93).

The verdict pass (Q-88) runs as a second omp dispatch per persona
after both arms finish, given both lives' transcripts; its shape
belongs to the rubric (ticket 124) and record plane (ticket 122).

## Determinism seams

Recorded-replayable, not seeded-replayable. Queue draws are
deliberately random (Q-13 never-argmax) and LLM output is not
reproducible, so the plane does not pretend to determinism: instead
EVERYTHING an arm did survives in its archived vault — transcripts,
activity log, queue JSONL, wiki. `ELICIT_LLM=fake`
(makeFakeComplete) remains the smoke-test seam for plumbing checks
with no model at all.

## Teardown = archive (Q-93)

On trial end the harness waits for `GET /api/harvest-queue` to drain,
sends SIGTERM, then MOVES the whole instance dir to
`archives/eval/<cycle>/<trial>/` (rename, never delete — the
fresh-start module's semantics). Verdict citations stay checkable
forever against the archived life. `archives/` is read-only to the
loop except this one append (the Q-91 rule extends: eval archives are
written once at teardown, then never touched).

## The owner-boundary invariants

- An instance never sees the owner's vault, `data/`, or archives —
  structurally, via cwd + env isolation, not by prompt.
- The loop never spawns an instance from the live repo checkout.
- Ports 4600+ only; the owner's 4517 is never allocated.
- Everything under `eval/instances/` and `archives/eval/` is
  gitignored (person-plane rule applied to persona-plane lives).
