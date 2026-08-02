---
title: "Decide: land the embedding channel for SNIPPETS before the Clerk slice"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review, sharpened by reading T18.

The review says embeddings are a prerequisite, not a channel, and should come
out of the Clerk and land first. Checking the plan makes the case stronger
than the review puts it: T18 embeds CLAIM BODIES, keyed by `claimId`, into
`vault/wiki/embeddings.jsonl`, as the third ClashChannel. It is the
contradiction channel and nothing else.

Slice 2's `resonate()` — which feeds resonance, juxtaposition and every
composed opener the user actually sees each sitting — is a 3-consecutive-word
exact-match index, and T18 does not touch it. So even after the whole Clerk
slice ships, the surface the user meets every day is still keyword matching,
with measured paraphrase recall of 0/8.

The embedding endpoint is already live and Q-17 already locks the provisional
default, so this is not new architecture. Decide: a snippet-level embedding
channel behind `resonate()`, shadow-first (Q-35), landing BEFORE ticket 008 —
and whether it shares T18's `Embed` seam and cache format so the Clerk's
channel is a second consumer rather than a second implementation.
