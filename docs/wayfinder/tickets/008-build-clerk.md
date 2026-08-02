---
title: "Plan and build: the Clerk slice"
labels: [wayfinder:task]
status: closed
assignee: claude (in flight)
blocked_by: []
---

> UNBLOCKED 2026-08-02: 006-grill-clerk closed.

> READY TO EXECUTE 2026-08-02. Plan written and twice reviewed:
> `docs/superpowers/plans/2026-08-02-the-clerk.md` — 19 tasks, 6 waves,
> 10 blockers from two adversarial rounds applied and verified in the body.
> Q-49 resolved the one escalated conflict (opposition gate ships live).
> Sequencing: land 044 (harvest admissibility — the Clerk mints FROM
> readings) and 047 (async docket — the wiki jobs share that path) first.

> BLOCKERS RE-CUT 2026-08-02. 053 dropped by Micah's ruling — the Clerk goes
> first. 052 (polarity) dropped as a blocker for a structural reason: every
> mechanism in the plan ships shadow-first (Q-35), so the contradiction
> channels compute and log without opening anything. Polarity must be settled
> before the threshold GRADUATES, not before the slice lands.
> 051 stays. It is a ten-minute decision that changes what the Clerk writes on
> its very first run, and `evidenced` is not a status you can retrofit across
> a claim graph.

> CLEARED TO EXECUTE 2026-08-02. 051 closed as Q-50 (cross-sitting cite
> independence). No blockers remain. Dispatching wave by wave, T1 alone
> first per the plan's own instruction.

## Question

> Blocking edge to 007 removed 2026-08-02: Q-17 locks qwen3-embedding as
> the provisional default, so the eval refines a parameter, not the
> architecture — the plan cites the provisional default and 007 tunes it
> later (007 itself waits for ~50 snippets per RESULTS).

> Blocking edge to 007 removed 2026-08-02: Q-17 locks qwen3-embedding as
> the provisional default, so the eval refines a parameter, not the
> architecture — the plan cites the provisional default and 007 tunes it
> later (007 itself waits for ~50 snippets per RESULTS).

> Blocking edge to 007 removed 2026-08-02: Q-17 locks qwen3-embedding as
> the provisional default, so the eval refines a parameter, not the
> architecture — the plan cites the provisional default and 007 tunes it
> later (007 itself waits for ~50 snippets per RESULTS).

writing-plans (reviewer rounds) then omp execution for the grilled Clerk design: claims on disk, contradiction detection, gap-fill minting, expedition minting from interest claims, wiki reading surface with edit/Propagation.

## Resolution (2026-08-02)

The slice is built, and T16's real-model RESULTS document closes it:
[2026-08-02-the-clerk.RESULTS.md](../../superpowers/plans/2026-08-02-the-clerk.RESULTS.md).

The headline inverts the hypothesis: the model never failed the write
contract (144 ops proposed, 144 accepted, zero rejected/unparseable/empty/
oversized) — but all 144 are MINT on a corpus where no two readings share
evidence, so five of the six ops were never exercised and "0% rejection" is
a fact about MINT only. All 144 claims are `unconfirmed`, and RESULTS shows
that is Q-50 working, not failing. The wiki reads as a pile, not an essay —
coreness degenerates to mint order because no two claims cite a shared
snippet; the corrective is corpus shape (seeding, claim-sharing evidence),
not the Clerk. The one opposition the live gate confirmed is, on reading, a
lexical false positive that Q-30's person-in-the-loop absorbed at the cost
of one queue entry; the gate stays live pending a real corpus (RESULTS §9).
The drain survived one 84-minute runaway generation (fixed mid-run as
ticket 086, commit 38c4a8a) and two process restarts with zero loss (075).
All six §5 invariants pass: 144 claims, 144 cites all resolving, zero
confidence vocabulary, zero deletions.

Follow-ups minted from RESULTS §16: [087](087-mint-prompt-claim-quality.md)
(claim quality at the prompt+lint, never op rejection),
[088](088-quoted-pole-complete-clause.md) (mechanical clause check on
quoted poles), [089](089-godnode-fanout-measures-corpus.md) (godNodeFanout
scoped to referents or scaled). Sequencing adopted from §16.4: graduate the
embedding channel before re-reading Q-49 precision.

Unblocks: 016, 027, 033, 060, 085 (013 closed earlier today by Micah's
early grill).
