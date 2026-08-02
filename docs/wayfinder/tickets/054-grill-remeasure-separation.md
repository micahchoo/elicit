---
title: "Grill: the re-measure must be separated in TIME, not in wording"
labels: [wayfinder:grilling]
status: closed
assignee: micah
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review.

Q-14 says one flipped answer never opens a synchronic Contradiction —
re-measure the construct a different way first. Q-30 stage 2 makes exactly
one ask-differently re-measure the only gate on opening a Contradiction.
Nothing in either says WHEN.

The review's point: people move under questioning, and asking again three
minutes later measures the interview, not the belief. An in-sitting re-measure
conflates lability with contradiction, which is the failure Q-14 exists to
prevent — so as written, Q-30 stage 2 can defeat Q-14 while formally obeying
it.

The instrument already exists: the still-true revisit source is time-separated
by construction. Grill whether the re-measure is required to be a LATER
SITTING rather than a later turn, what the minimum separation is, and what
happens to a candidate whose re-measure window expires unanswered
(`remeasure-expired` is already an outcome in the plan's ClashCandidate).

## Resolution (2026-08-02) — Q-53

First, a mechanical correction to the ticket's premise. The re-measure is never
asked inline: `server.ts:604` fires `startDocket('harvest')` from the harvest
endpoint, so a candidate forms after a sitting's cuts are decided, and
`composeRemeasure` mints a QUEUE ENTRY that a later draw picks up. No code path
lets a re-measure interrupt the sitting that produced the claim. The literal
"three minutes later, same thread" scenario is already impossible.

What remains possible: harvest sitting 5, close it, open sitting 6 four minutes
later, and the queue draws the re-measure. Formally separate, practically the
same frame.

**The predicate is the session boundary, not a wall clock.** Q-14 exists to
catch LABILITY UNDER QUESTIONING, and lability is a property of a continuous
conversational frame — the momentum of the last half hour, the vocabulary the
elicitor introduced, the self being performed. A session boundary ends that
frame; elapsed time does not track it. A 24-hour minimum is wrong in both
directions: two short sittings twenty minutes apart on unrelated topics are
separate measurements, and one six-hour sitting is not.

**The rule, precisely:** the confirming reading's `Provenance.session` must
differ from the session of BOTH claims in the pair — not merely be later than
`remeasureAskedAt`, which records only when the question was minted. This reuses
the cite→session resolution T4 built in `src/wiki/status.ts` for Q-50 rather
than inventing a second notion of separation.

**Expiry earns one more attempt.** `remeasure-expired` is the one outcome that
does not retire the pair: expiry is a question that fell off the queue, not an
answer, and retiring on it makes a real contradiction permanently invisible
because the user was busy that week. `ClashCandidate` carries an `attempts`
counter, earns exactly one re-proposal after an expiry, and retires on the
second. Every other outcome retires the pair at once.

### What this changes in the Clerk plan (Wave 2, not yet dispatched)

- **T11 / `poolCandidates`** — B9's "the pair is retired at every status" gains
  one exception: a `dissolved` candidate whose `outcome` is `remeasure-expired`
  and whose `attempts` is 1 may be re-proposed.
- **`ClashCandidate`** — add `attempts: number` (1 at creation).
- **T12 job 5 (confirmation)** — the window check becomes a session comparison
  against both claims' cite sessions, not only a timestamp comparison against
  `remeasureAskedAt`. `remeasureAskedAt` stays; it is still the cheap
  pre-filter.
