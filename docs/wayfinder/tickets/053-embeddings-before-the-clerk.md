---
title: "Decide: land the embedding channel for SNIPPETS before the Clerk slice"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

> RULED 2026-08-02 (Micah): the Clerk lands BEFORE this. Not blocking 008.
> The finding stands and the ticket stays open — `resonate()` is still a
> trigram index after the Clerk ships, and 0/8 paraphrase recall is still the
> measured number. What changed is the order, not the diagnosis.

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

## Resolution (2026-08-02) — commit `a6c4610`

`src/index/semantic.ts`. Measured through the shipped code path against the
live endpoint, on the corpus `tests/resonance-paraphrase.test.ts` builds:

```
semantic recall@1  : 7/8
semantic @cos>=0.70: 3/8   (the instrument 007 recommended against)
lexical  recall@5  : 0/8   (the incumbent)
```

On the real 139-snippet vault: primed in 12.6s, 173ms warm query. An on-topic
query returned three relevant snippets at 0.60-0.64 where lexical returned
zero.

**It RANKS.** Four reasons, the fourth structural: 7/8 versus 3/8; an absolute
cosine does not travel between corpora (0.70 is the 100th percentile of the
fixture and the 99.94th of the vault); the cut is unstable in the third decimal;
and **every existing caller already wants the best few** — `server.ts` takes
`hits[0]`, the elicitor walks and stops at the first that composes, `wiki-jobs`
takes three. Nobody consumes "everything above a line", so the caller's own `k`
is the bound and this channel needs no register entry to act.

**The catch that mattered most:** T18's `persist` prunes every record whose id
is not a live CLAIM. Sharing `vault/wiki/embeddings.jsonl` would have made the
first Clerk docket run delete every snippet vector, and the first `prime` here
delete every claim vector. Two keyspaces cannot share one pruned file.

**The opposite pole is surfaced deliberately**, and the agreement claim is made
structurally unavailable rather than discouraged: `SemanticHit` carries no
`sharedPhrase`, so `composeJuxtaposition` — which requires a verbatim shared
substring because Q-12 is enforced in code — cannot accept one.

The live measurement is replayed offline: the 19x19 measured cosine matrix is
Cholesky-factored into 19-dim rows (worst error 6.7e-7), so the CI fixture *is*
the real model's geometry, deterministic and 5.5KB.

**Nothing calls it yet, and 053 said so** — see
[wire semantic resonance](068-wire-semantic-resonance.md), which names every
call site. That disclosure is why this is not the sixth inert thing.
