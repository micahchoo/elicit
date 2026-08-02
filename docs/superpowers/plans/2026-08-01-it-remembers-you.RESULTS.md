# Slice 2 RESULTS — "it remembers you"

Recorded 2026-08-02 from Micah's real sittings (vault evidence: activity
logs, queue, snippets, transcripts). Record, don't gate. n is small —
every number below is a first reading, not a verdict.

## The corpus tonight

- ~8 genuine sittings across the evening (20 transcript files total,
  several of them micro-tests); at least two with `target: domain`.
- 4 Snippets kept, all from one self sitting (01KZ0ASXMB…), with 4
  Facet/Stance readings. 0 Buds.
- Sittings straddle the fix wave: earlier ones ran pre-fix code (echo
  probes, clarify monoculture, double opener — all diagnosed live and
  fixed in 6f44553/9ccac72/156d686/bdb7f6b); the last two sittings ran
  fixed code.

## Invariant checks (plan Task 8 step 2) — ALL PASS

- Every composed queue entry's `quotedFragment` appears verbatim in its
  `question`: 4/4 (Q-12).
- Every kept snippet's text is an exact substring of its session
  transcript: 4/4 (Q-1).
- Transcripts append-only: no edits observed; the one anomaly (two agent
  openers in 01KZ0AKPP1…) was an old-server rendering-era bug, addressed
  by 031's one-opener test + renderMode clear.

## Yield by question source (the Hoffman comparison)

The 4 keepers' eliciting questions: 2 probes ("When did you first notice
your ears going numb in that way?", "What does it feel like when it
really gets too much?"), 1 bank draw (with questionSource provenance),
1 composed. Too small for a verdict — but note the two probe keepers are
exactly the anchored-in-your-phrase kind, which supports the probe-freedom
direction (031) rather than more scaffolding.

Post-fix sittings show the memory loop live: sources asked were
composed × 6, bank × 2 — minted openers quoting prior snippets now
dominate session starts, which is the slice hypothesis behaving as
designed. Their kept-yield can't be judged yet: the two newest sittings'
harvests show proposals=5/6 but kept=0 — review friction or genuine
nothing; watch next sittings.

## Composed null-rate → template-assembly fallback decision

Composed questions fired repeatedly in live sittings (6 asked in the two
newest sessions) and 4 composed entries sit in the queue with valid
fragments — the retry-then-null path is not dominating. DECISION: no
template-assembly fallback now. Gap: null-rate is only visible in server
console, not the Activity Log — instrument before the next read
(shadow-mode logging per Q-35 fits).

## Close-move yield

One user-declared bookmark entry observed earlier ("Pick up at the two
a.m. inventory voice…"), drawn as the very next sitting's opener —
the Q-20 loop works end to end on real data. Tonight's newest sittings
show no surviving user-declared entries (drawn or sittings closed by
abandonment); no yield number yet.

## What this unblocks / defers

- Ticket 002 closes with this file. Ticket 008 (Clerk plan) is now
  unblocked (grill closed as Q-28…Q-35).
- Ticket 007 (embedding eval) stays OPEN by choice: 4 snippets is too
  thin for a recall comparison; run it when the vault holds ~50 snippets.
- Watch items for the next RESULTS pass: kept-yield of composed openers
  post-fix, harvest review friction (proposals>0, kept=0 twice), Activity
  Log null-rate instrumentation.
