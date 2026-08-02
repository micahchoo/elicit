---
title: "Fix: resonance honesty — semantic recall, or shrink the claim"
labels: [wayfinder:task]
status: closed
assignee: claude
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

## Resolution (2026-08-01)

Items 1 and 3 are done. Item 2 is deferred — it needs `src/server.ts`, which
was owned by another agent during this pass.

**1. README now describes the mechanism.** The headline claim said "when what
you say today clashes with what you wrote in March, both quotes come back side
by side." It now says the match is on phrasing, not meaning: resonance is a
trigram index, a hit needs a verbatim run of three or more shared words, so it
catches recurrence and misses a belief restated in fresh words. The paragraph
names Q-17 and links the fixture. Two smaller lines followed: the exchange
screenshot caption ("touch something you wrote" → "repeat a phrase from"), and
Status, which now records that resonance is lexical only and that the Q-30
contradiction pipeline is unbuilt.

**3. Standing fixture: `tests/resonance-paraphrase.test.ts`.** Eight pairs of
belief-plus-restatement, including the eval's negative control verbatim, over a
vault that also holds the eval's opposite-pole snippet as a distractor.
Measured recall today: **0/8**. The file is written to become the metric —
`SEMANTIC_CHANNEL_LIVE` is one boolean to flip, `RECALL_FLOOR` the number to
hold. Three guards keep the number honest: an integrity test asserting no
restatement shares a trigram with any stored snippet (so recall can never rise
by lexical accident), the `recall === 0` baseline that fails the moment
semantic recall appears without being declared, and a control test proving the
index still fires on verbatim recurrence (so the zeros are disjoint vocabulary,
not a broken index).

**Index untouched, with evidence.** Stemming and stopword-skipping were
considered and rejected. Measured across all eight pairs, stored and restated
prose share zero stemmed content-word trigrams, zero bigrams, and zero
unigrams — the vocabularies are disjoint, so no lexical widening moves recall
off 0. It also costs something: `extractSharedPhrase` requires the shared run
to be a verbatim substring of both texts, which is what makes a hit quotable
and explainable; stemmed matches fail that check and get dropped, or force
relaxing it. Nothing to gain, a guarantee to lose. Recall comes from the
embedding channel or from nowhere.

**Follow-up (item 2, not done):** emit a `resonance-checked` activity event
carrying the hit count, so "looked and found nothing" is distinguishable from
"never looked." Needs `src/server.ts`. Same observability principle as ticket
034.
