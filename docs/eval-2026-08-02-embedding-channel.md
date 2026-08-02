# Embedding channel evaluation — 2026-08-02

Ticket 007, run against the corpus that arrived this morning: **139 snippets
across 19 dated sittings, 2017–2026**, imported from nine years of published
writing into `vault/snippets/`. Both models measured on the live local endpoint
(Ollama at `192.168.0.229:11434`, ADR-0001 satisfied — nothing left the LAN).
Scripts and cache are named at the bottom; every number below is reproducible
from them.

This is the measurement T18 was told to wait for. `clash.embeddingCosine = 0.82`
is recorded in `src/wiki/thresholds.ts:117` as a guess. It is not merely
imprecise. It is **inert**: at 0.82 the channel returns nothing, on either
model, on either corpus, forever.

## The recommendation

| | |
|---|---|
| **`clash.embeddingCosine`** | **0.70** |
| **Model** | **`qwen3-embedding`** (4096-dim), unchanged from Q-17's provisional default |
| **Live?** | **No — stays shadow.** Q-35 as written. The shadow record now has a specific job, below. |

At 0.70 with `qwen3-embedding`:

- **Paraphrase fixture: 3/8 recall at 100% precision** — three true pairs found,
  zero false positives across 80 non-pairs. The lexical incumbent scores 0/8 on
  the same fixture. The channel earns its place.
- **The real 139: 6 candidate pairs out of 9,591.** A pool T12's judgment quota
  of 3 can work through in two docket runs, not 4,000 pairs it can never touch.
- **Not inert**: 0.70 sits below the corpus maximum (0.808), so the channel
  actually fires.

Do not read 3/8 as the channel's ceiling. It is the recall available at a cut
that admits no false positives; the ranking underneath is much better than the
threshold (AUC 0.952, and the true partner is the nearest neighbour for 7 of 8
pairs). More on why that gap matters in *The threshold is the wrong instrument*.

## Why 0.82 returns nothing

The guess was not a near miss. It is above the top of every distribution
measured here except one.

| | qwen3-embedding | nomic-embed-text |
|---|---|---|
| Highest cosine among all 9,591 corpus pairs | 0.808 | 0.798 |
| Highest cosine among the 8 true paraphrase pairs | 0.761 | 0.702 |
| Corpus pairs admitted at 0.82 | **0 of 9,591** | **0 of 9,591** |
| Fixture recall at 0.82 | **0/8** | **0/8** |
| Corpus pairs admitted at 0.75 | 1 of 9,591 | 4 of 9,591 |

0/8 at 0.82 is exactly the number `tests/resonance-paraphrase.test.ts` records
for the trigram index. Shipping the channel at 0.82 would reproduce the lexical
baseline through a second, slower mechanism and a 52 MB vector cache.

One class of pair does clear 0.82, and it is the one that makes the point
sharpest. Minimal negations — a real corpus sentence and the same sentence with
*not* inserted — score 0.808–0.916 on qwen3, and 6 of 8 clear 0.82. So at 0.82
**the only pairs the channel would ever admit are pairs that differ by one
word.** Those are precisely the pairs the incumbent already catches: run through
the real `resonate()`, the trigram channel finds **8 of 8** minimal negations
(`scripts/eval-007-lexical-overlap.ts`), each on a long shared phrase such as
`"seen as a tool that needs to be situated"`. At 0.82 the embedding channel is
strictly redundant with the lexical channel — it finds only what lexical already
finds, and misses everything lexical misses.

## The separation, and where it fails

The distributions **do** separate, but not cleanly, and the honest report is the
overlap.

**qwen3-embedding, fixture** — 8 true pairs against 80 non-pairs (each
restatement scored against every stored belief that is not its partner, plus the
three distractors):

| threshold | recall | false positives | precision |
|---|---|---|---|
| 0.50 | 8/8 | 18/80 | 0.31 |
| 0.55 | 7/8 | 7/80 | 0.50 |
| 0.60 | 5/8 | 2/80 | 0.71 |
| 0.65 | 3/8 | 1/80 | 0.75 |
| **0.70** | **3/8** | **0/80** | **1.00** |
| 0.75 | 1/8 | 0/80 | 1.00 |
| 0.82 | 0/8 | 0/80 | — |

True pairs span 0.507–0.761 (mean 0.637); non-pairs span 0.330–0.697 (mean
0.454). **The ranges overlap**: `posMin` 0.507 is well below `negMax` 0.697, so
no cut separates them perfectly. Best achievable F1 is 0.67 at 0.610 — five true
pairs and two false ones.

The overlap is not random noise, and this is the most interesting single data
point in the eval. The one true pair that 0.70 misses is pair 0, social-hedging
— and its nearest neighbour is not its own paraphrase (0.507) but **the
distractor that states the opposite belief** (`"my hedges track my actual
confidence, not how popular a claim is"`, 0.697). The opposed pole outranks the
paraphrase. That is Q-52's mechanism visible in one measurement, and it is
covered properly below.

`nomic-embed-text` is worse on the same fixture: AUC 0.853 against qwen3's 0.952,
best F1 0.50 against 0.67, and 6/8 nearest-neighbour recall against 7/8.

## The threshold is the wrong instrument, and T18 should know it

Ranking works. Absolute cosine does not travel.

Nearest-neighbour recall on the fixture is **7/8 for qwen3** — for seven of the
eight beliefs, the correct partner is the top hit out of eleven candidates. Yet
the best precision-preserving threshold recovers only 3/8. The signal is in the
ordering, and a fixed absolute cut throws most of it away.

Worse, a cut calibrated on one corpus does not mean the same thing on another:

| raw cosine | percentile among fixture non-pairs | percentile among corpus pairs |
|---|---|---|
| 0.60 | 97.50% | 99.51% |
| 0.65 | 98.75% | 99.85% |
| 0.70 | 100.00% | 99.94% |

The two backgrounds sit at different heights — mean 0.454 on the fixture, 0.353
on the corpus — because fixture texts are short first-person belief statements
(82 chars mean) and corpus texts are longer essay sentences (126 chars). It is
not a length artefact in the model: for qwen3, cosine correlates with mean pair
length at only **0.032**, which is nothing. It is a genre difference, and 0.70 is
recommended in full knowledge that it is anchored on the fixture — whose short
declarative form is much closer to what a minted Claim body looks like than an
essay sentence is.

That caveat is load-bearing and T18 must not lose it: **there are no Claims in
the vault yet** (`vault/wiki/` does not exist), so nothing here measures the
distribution the channel will actually see. The channel embeds claim bodies;
this eval embeds snippets and fixture prose as the closest available proxy.
0.70 is a measured starting point, not a calibrated endpoint — which is another
reason it stays in shadow.

If the shadow record shows the number is wrong for claim bodies, the durable
fix is not to re-tune the constant but to change the instrument: take the top-N
pairs by cosine and let the quota bound the pool, rather than cut on an absolute
value that means a different thing in every corpus. That is a design note for
whoever inherits this, not a change ticket 007 is making.

## What the channel would actually surface, and the cross-sitting ceiling

This is the finding the plan does not anticipate, and it matters more than the
threshold.

Of the 9,591 corpus pairs, 6,572 (68.5%) join two **different** sittings. Split
the distribution that way and it comes apart:

| | qwen3-embedding | nomic-embed-text |
|---|---|---|
| Highest cosine, pair within one sitting | 0.808 | 0.798 |
| Highest cosine, pair across two sittings | **0.640** | **0.713** |

For qwen3 there is a hard ceiling at 0.640: **every pair above it is two
sentences from the same essay.** At the recommended 0.70 the pool is 6 pairs and
all 6 are intra-document. Pool sizes:

| threshold | all pairs | cross-sitting pairs |
|---|---|---|
| 0.60 | 47 | 9 |
| 0.65 | 14 | 0 |
| 0.70 | 6 | 0 |
| 0.82 | 0 | 0 |

So on today's corpus no threshold does both jobs at once. A pool small enough
for the quota needs ≥0.65; a pool containing any cross-sitting pair needs ≤0.64.
The gap is narrow but real.

This is not fatal — Q-53 governs the *confirming* reading, not pooling, so a
same-sitting candidate is admissible and merely needs a later answer from
elsewhere to confirm. But under Q-50 two cites from one sitting are one thought
said twice, and a "contradiction" between two sentences of one essay is far more
likely to be topical adjacency than belief drift. Read plainly: **at 0.70 on
this corpus the channel measures how tightly an essay stays on topic, not how a
belief moved between 2017 and 2026.**

Two things follow, both for T18/T12 rather than for this ticket:

1. **The shadow record's job is now specific.** Do not ask it only "are these
   pairs worth a re-measure". Ask whether any pair it proposes joins two
   sittings. If after real running the answer is still none, the threshold is
   not what needs fixing.
2. **Consider excluding same-sitting pairs from the pool.** The channel already
   has the provenance to do it. It would make the 0.60 row above the operative
   one (9 cross-sitting pairs — still quota-shaped) and would stop the quota of
   3 being spent on same-essay neighbours.

For the record, the open question at plan L1032–1034 — whether the pool needs a
per-node cap against a god-node — measures clean for this channel. At 0.60 the
47 pairs spread over 54 distinct snippets with the busiest appearing in 6 (13%);
at 0.70, 6 pairs over 11 snippets. No cap needed at these thresholds on this
corpus.

## Negation: Q-52 is right, and it is not close

Q-52 rules that negation-blindness is the *mechanism* — an opposed pair must be
a near neighbour or the pipeline never pools it. Sixteen pairs were built from
verbatim corpus sentences to test it, in two families.

**Minimal negation** — the real sentence, polarity flipped in place. qwen3
scores 0.808–0.916, mean 0.864. All eight land at the **99.99th–100th
percentile** of the corpus background. nomic scores 0.920–0.987, mean 0.953.
Both models are completely blind to the inserted *not*. (Weak evidence on its
own — these pairs share most of their words — which is why the second family
exists.)

**Rephrased opposition** — the opposed pole restated in fresh words, the way
belief drift actually appears. qwen3 scores 0.429–0.729, mean 0.556, landing at
the **85th–99.97th percentile** of the corpus background.

The second family is the one that settles it. Rephrased oppositions (0.429–0.729)
land in the *same range* as genuine paraphrase pairs (0.507–0.761). Cosine cannot
tell "the same belief restated" from "the opposite belief restated" — they are
one population. Q-52's reasoning is confirmed on real data by both models:
the channel retrieves aboutness, polarity is invisible to it, and
`judgeOpposition` is doing work nothing upstream can do.

The mechanism also has a cost Q-52 should be read alongside. Rephrased
oppositions sit high *relative to the background* but low in absolute terms, so
at 0.70 the channel pools only **1 of 8** of them. Aboutness retrieval keeps
opposed pairs in the population, as Q-52 requires — but at a precision-preserving
threshold most of them still fall below the cut, for the same reason most
paraphrases do. Nothing here argues for the NLI channel Q-52 declined: a
cross-encoder would separate the poles rather than pool them, which is the
behaviour Q-52 correctly identifies as wrong for this stage. The argument it
does support is instrumental — top-N by rank instead of an absolute cut — which
lifts opposed pairs and paraphrases together.

## Model choice: qwen3-embedding, and it is not a close call either

| | qwen3-embedding | nomic-embed-text |
|---|---|---|
| Dimensions | 4096 | 768 |
| Fixture AUC | **0.952** | 0.853 |
| Fixture best F1 | **0.67** | 0.50 |
| Nearest-neighbour recall | **7/8** | 6/8 |
| Recall at 100% precision | **3/8** (at 0.70) | 0/8 (never reaches 100% precision above 0/8) |
| Cosine ↔ length correlation | **0.032** | 0.147 |
| Anisotropy (mean cosine, unrelated pairs) | **0.353** | 0.464 |
| Embed throughput, warm | ~170 ms/text | ~34 ms/text |
| Cache cost | 51 KB/vector → **52 MB per 1,000 claims** | 9.4 KB/vector → 10 MB per 1,000 claims |

The 768-dim model is five times faster and five times smaller, and the question
the ticket asks is whether it separates as well. It does not. Its background is
compressed (anisotropy 0.464 — everything looks more alike), it carries a real
length confound at 0.147, and it never reaches a cut with both non-zero recall
and zero false positives. Most telling: the true paraphrase pairs sit at the
63rd, 70th and 80th percentile of nomic's corpus background — three of eight
genuine belief restatements are ordinary-looking to it. On qwen3 the lowest is
the 96.6th percentile.

52 MB per 1,000 claims is real disk but not a constraint worth losing this much
separation over, and the file is derived and disposable (Q-3, and Q-61 already
gitignores it inside the vault). **Q-17's provisional default survives contact
with measurement.** Keep `qwen3-embedding`; keep `nomic-embed-text` documented as
the lighter option, now with a measured cost attached to choosing it.

## Endpoint, verified

Checked before planning around it, as the ticket requires.

- `http://192.168.0.229:11434/v1/embeddings` is **live**. `qwen3-embedding`
  returns 4096 dims, `nomic-embed-text` returns 768. Both also answer on
  `/api/embed` and `/api/embeddings` with identical dimensions.
- Ollama reports the model as `qwen3-embedding:latest`, 7.6B parameters, Q4_K_M,
  9.3 GB resident. Both bare and `:latest` names resolve.
- **Cold start is a trap T18 must handle.** The first request against an unloaded
  `qwen3-embedding` took **370 seconds and then returned HTTP 500** while a
  second request raced it into VRAM. Warm, the same call takes 100–120 ms. T18's
  contract says an unreachable endpoint skips the channel cleanly — that error
  path must cover *a 500 after six minutes*, not only a refused connection, or
  the first docket run on a cold box hangs. The eval script retries with backoff
  (4 attempts) for this reason and never fabricates a vector on failure.
- Full-corpus throughput, warm: 174 texts in 29 s (qwen3), 6 s (nomic).

## Reproducing this

```
npx tsx scripts/eval-007-embeddings.ts      # embed + measure  → data/eval-007/results.json
npx tsx scripts/eval-007-analyze.ts         # second pass off the cache, no network
npx tsx scripts/eval-007-lexical-overlap.ts # the incumbent, on the negation pairs
npx tsx scripts/embed-probe.ts              # endpoint diagnostics
```

Vectors cache to `data/eval-007/cache-<model>.jsonl`, keyed on the exact text,
one JSON line per vector. 10.8 MB total; gitignored, because it is derived and
rebuildable from the files alone (Q-3). Deleting it costs one re-embed pass —
about 35 seconds for both models — and no data. The corpus was embedded twice
from an empty cache, on two separate passes against the live endpoint; all
sixteen fixture-pair cosines and the corpus maximum came back identical to four
decimal places both times. The endpoint is deterministic, so the numbers above
are a measurement rather than a sample.

The paraphrase fixture is read from `tests/fixtures/paraphrase-pairs.ts` (T11's
shared location) and was not modified; neither was
`tests/resonance-paraphrase.test.ts`, whose `SEMANTIC_CHANNEL_LIVE` flag stays
false until the channel actually ships.

## What this changes

- **`src/wiki/thresholds.ts:117`** — `clash.embeddingCosine` 0.82 → **0.70**,
  and the `graduatesWhen` text should stop calling it a guess. Suggested
  replacement condition: *the shadow record shows candidate pairs that join two
  different sittings; on the 139-snippet import at 2026-08-02 it produced none,
  and that — not the cosine — is what needs to change.*
- **T18 step 2** asks for fixture recall at 0.82 and at 0.75. Both are **0/8**.
  Recording those two numbers alone would read as a failed channel; record 0.70
  (3/8, zero false positives) beside them or the comment misleads.
- **T18's `embedding-unavailable` path** must treat a slow HTTP 500 as
  unavailable, per the cold-start finding above.
- **Ticket 007** can close. **Ticket 053's diagnosis is unchanged**: `resonate()`
  is still a trigram index and 0/8 is still the measured baseline. This eval adds
  that the embedding channel at a measured threshold reaches 3/8 with perfect
  precision, which is the first evidence that the staged hybrid in Q-17 buys
  anything at all.

Nothing measured here contradicts Q-17 or Q-52. Q-17's model choice is confirmed
against its alternative; Q-52's mechanism claim is confirmed twice over. What is
contradicted is a single unmeasured constant, which is what the ticket existed
to fix.

---

## Addendum, 2026-08-02 — a correction from T18

**The endpoint is deterministic for a FIXED BATCH COMPOSITION, not absolutely.**
This doc states four-decimal determinism; T18 measured otherwise while building
the channel. A batch of 8 texts scored fixture pair 5 at **0.7606**; a batch of
16 containing the same text scored it at **0.7631** — a third-decimal shift from
batch size alone.

No conclusion in this document changes: recall is 3/8 at 0.70 either way, and
the model comparison is unaffected. But it means **a pair sitting within roughly
0.003 of the cut can flip between runs** depending on how many claims happened
to need embedding that pass.

Two consequences worth carrying:

1. When reading the shadow record, a pair that appears in one run and not the
   next is not necessarily evidence of anything. Check its cosine before
   concluding the threshold is unstable.
2. It strengthens the case already made below for **ranking over thresholding**
   (see ticket 064). A rank is invariant to a third-decimal wobble; an absolute
   cut is not.

---

## Addendum, 2026-08-02 — a correction from T18

**The endpoint is deterministic for a FIXED BATCH COMPOSITION, not absolutely.**
This doc states four-decimal determinism; T18 measured otherwise while building
the channel. A batch of 8 texts scored fixture pair 5 at **0.7606**; a batch of
16 containing the same text scored it at **0.7631** — a third-decimal shift from
batch size alone.

No conclusion in this document changes: recall is 3/8 at 0.70 either way, and
the model comparison is unaffected. But it means **a pair sitting within roughly
0.003 of the cut can flip between runs** depending on how many claims happened
to need embedding that pass.

Two consequences worth carrying:

1. When reading the shadow record, a pair that appears in one run and not the
   next is not necessarily evidence of anything. Check its cosine before
   concluding the threshold is unstable.
2. It strengthens the case already made below for **ranking over thresholding**
   (see ticket 064). A rank is invariant to a third-decimal wobble; an absolute
   cut is not.

---

## Addendum, 2026-08-02 — a correction from T18

**The endpoint is deterministic for a FIXED BATCH COMPOSITION, not absolutely.**
This doc states four-decimal determinism; T18 measured otherwise while building
the channel. A batch of 8 texts scored fixture pair 5 at **0.7606**; a batch of
16 containing the same text scored it at **0.7631** — a third-decimal shift from
batch size alone.

No conclusion in this document changes: recall is 3/8 at 0.70 either way, and
the model comparison is unaffected. But it means **a pair sitting within roughly
0.003 of the cut can flip between runs** depending on how many claims happened
to need embedding that pass.

Two consequences worth carrying:

1. When reading the shadow record, a pair that appears in one run and not the
   next is not necessarily evidence of anything. Check its cosine before
   concluding the threshold is unstable.
2. It strengthens the case already made below for **ranking over thresholding**
   (see ticket 064). A rank is invariant to a third-decimal wobble; an absolute
   cut is not.
