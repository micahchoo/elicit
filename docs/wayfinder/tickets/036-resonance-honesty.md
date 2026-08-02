---
title: "Fix: resonance honesty — semantic recall, or shrink the claim"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

From `docs/eval-2026-08-02-claude-adversarial.md` finding #8, the sharpest
one: Resonance is a trigram exact-match index. A planted contradiction
restated in FRESH WORDS ("When more people agree with a claim, I make it
sound more certain than I actually feel inside" vs a stored "I default to
hedging in whichever direction is socially cheaper") produced ZERO hits.
Real belief-drift is restated, not quoted — so as built, the mechanism
systematically misses the cases it exists to catch.

This was a known staging decision (Q-17: lexical ships first, embeddings
land with the Clerk slice) — but two things are NOT covered by that
decision and are the actual work here:

1. **The README overclaims TODAY.** "when what you say today clashes with
   what you wrote in March, both quotes come back side by side" is true
   only of near-verbatim recurrence. Either ship the embedding channel or
   describe the feature honestly until it exists. Honesty is cheap and
   immediate; do it first.
2. **No signal distinguishes "looked and found nothing" from "never
   looked."** Emit a resonance-checked activity event with hit count. Same
   observability principle as ticket 034.
3. **Standing paraphrase fixture.** A test set of paraphrased-contradiction
   pairs with zero lexical overlap, re-run whenever resonance changes —
   the metric (eval metric 14) that would have caught this before it
   became the headline claim. Currently 0/1.

Then the embedding channel itself (ticket 007 eval → implementation),
which is where the recall actually comes from.
