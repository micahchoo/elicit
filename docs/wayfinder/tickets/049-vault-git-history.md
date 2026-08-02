---
title: "Task: git init the vault — tamper-evident history, not backup"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review.

ADR-0003 separates code from corpus correctly and the vault stays gitignored
from the code repo. That is about the CODE repo. A repo INSIDE the vault is a
different thing: Snippet immutability and append-only transcripts are
app-level invariants today, enforced by the code that also writes them. A repo
makes them tamper-evident and diffable by something that is not the app.

This is history, not backup — it does not answer the standing risk that the
vault has no offsite copy (ticket 017, declined 2026-08-02, still declined).
It does mean a bad write is visible and revertible.

Decide and build: whether the docket commits (one commit per run, message from
the DocketReport) or whether it is a manual habit; `.gitignore` inside the
vault for the derived index and the vector cache (Q-3 — derived, disposable);
and what happens when the working tree is dirty at boot.

## Resolution (2026-08-02) — Q-61

**Done.** `vault/` is a git repo, first commit `6198cec`, authored
`elicit-clerk <clerk@localhost>`. Three files tracked: `.gitignore`,
`log/2026-08-02.jsonl`, one transcript.

Timing was the decisive argument. Initialising an empty vault costs one
command; initialising it after nineteen imported sittings and the Clerk's first
docket run makes the first commit a wall of already-written files — a witness
that saw nothing. The nine years about to land is exactly the content worth
diffing.

- **The docket commits**, one per run, message from the `DocketReport`. Not a
  manual habit: a habit produces a repo with four commits and nothing after,
  which is worse than no repo because it looks tamper-evident. `startDocket`
  fires within milliseconds of a harvest (047), so a sitting's writes land in a
  commit seconds later without their own hook. **Still to build** — see below.
- **Authored as `elicit-clerk`**, so a hand edit and an app write are
  distinguishable in `git log` without inspecting content.
- **Dirty tree at boot: commit it, never refuse.** The vault is the thing, git
  is the witness, and a witness never stops what it witnesses.
- **Ignored:** `/index/`, `/wiki/embeddings.jsonl`, `/wiki/*.cache` (Q-3,
  derived and rebuildable — and a 4096-dim vector per claim would dominate
  every diff), and `/.auth.json`, a credential that would otherwise put the
  Q-25 password lock into an object store outliving deletion. `log/` stays in:
  Q-23's ledger, not derived.

### The property change, recorded because it was decided rather than discovered

A repo makes deletion hard. Plain files meant `rm` was final. Now anything
removed persists in the object store until someone knows enough git to rewrite
history. Acceptable — the design already refuses deletion everywhere (Q-33
archives with a reason; the claim store has no `unlink` in it) — but it is a
real change to what "I want this gone" costs, and the first commit is the point
where it took effect.

### Remaining build

The commit-per-docket-run hook is NOT wired. `runDocketNow` in `src/server.ts`
must stage and commit at the end of a run, and at boot when the tree is dirty.
This does not block anything and rides the next server pass.

## Resolution (2026-08-02) — Q-61

**Done.** `vault/` is a git repo, first commit `6198cec`, authored
`elicit-clerk <clerk@localhost>`. Three files tracked: `.gitignore`,
`log/2026-08-02.jsonl`, one transcript.

Timing was the decisive argument. Initialising an empty vault costs one
command; initialising it after nineteen imported sittings and the Clerk's first
docket run makes the first commit a wall of already-written files — a witness
that saw nothing. The nine years about to land is exactly the content worth
diffing.

- **The docket commits**, one per run, message from the `DocketReport`. Not a
  manual habit: a habit produces a repo with four commits and nothing after,
  which is worse than no repo because it looks tamper-evident. `startDocket`
  fires within milliseconds of a harvest (047), so a sitting's writes land in a
  commit seconds later without their own hook. **Still to build** — see below.
- **Authored as `elicit-clerk`**, so a hand edit and an app write are
  distinguishable in `git log` without inspecting content.
- **Dirty tree at boot: commit it, never refuse.** The vault is the thing, git
  is the witness, and a witness never stops what it witnesses.
- **Ignored:** `/index/`, `/wiki/embeddings.jsonl`, `/wiki/*.cache` (Q-3,
  derived and rebuildable — and a 4096-dim vector per claim would dominate
  every diff), and `/.auth.json`, a credential that would otherwise put the
  Q-25 password lock into an object store outliving deletion. `log/` stays in:
  Q-23's ledger, not derived.

### The property change, recorded because it was decided rather than discovered

A repo makes deletion hard. Plain files meant `rm` was final. Now anything
removed persists in the object store until someone knows enough git to rewrite
history. Acceptable — the design already refuses deletion everywhere (Q-33
archives with a reason; the claim store has no `unlink` in it) — but it is a
real change to what "I want this gone" costs, and the first commit is the point
where it took effect.

### Remaining build

The commit-per-docket-run hook is NOT wired. `runDocketNow` in `src/server.ts`
must stage and commit at the end of a run, and at boot when the tree is dirty.
This does not block anything and rides the next server pass.

## Resolution (2026-08-02) — Q-61

**Done.** `vault/` is a git repo, first commit `6198cec`, authored
`elicit-clerk <clerk@localhost>`. Three files tracked: `.gitignore`,
`log/2026-08-02.jsonl`, one transcript.

Timing was the decisive argument. Initialising an empty vault costs one
command; initialising it after nineteen imported sittings and the Clerk's first
docket run makes the first commit a wall of already-written files — a witness
that saw nothing. The nine years about to land is exactly the content worth
diffing.

- **The docket commits**, one per run, message from the `DocketReport`. Not a
  manual habit: a habit produces a repo with four commits and nothing after,
  which is worse than no repo because it looks tamper-evident. `startDocket`
  fires within milliseconds of a harvest (047), so a sitting's writes land in a
  commit seconds later without their own hook. **Still to build** — see below.
- **Authored as `elicit-clerk`**, so a hand edit and an app write are
  distinguishable in `git log` without inspecting content.
- **Dirty tree at boot: commit it, never refuse.** The vault is the thing, git
  is the witness, and a witness never stops what it witnesses.
- **Ignored:** `/index/`, `/wiki/embeddings.jsonl`, `/wiki/*.cache` (Q-3,
  derived and rebuildable — and a 4096-dim vector per claim would dominate
  every diff), and `/.auth.json`, a credential that would otherwise put the
  Q-25 password lock into an object store outliving deletion. `log/` stays in:
  Q-23's ledger, not derived.

### The property change, recorded because it was decided rather than discovered

A repo makes deletion hard. Plain files meant `rm` was final. Now anything
removed persists in the object store until someone knows enough git to rewrite
history. Acceptable — the design already refuses deletion everywhere (Q-33
archives with a reason; the claim store has no `unlink` in it) — but it is a
real change to what "I want this gone" costs, and the first commit is the point
where it took effect.

### Remaining build

The commit-per-docket-run hook is NOT wired. `runDocketNow` in `src/server.ts`
must stage and commit at the end of a run, and at boot when the tree is dirty.
This does not block anything and rides the next server pass.
