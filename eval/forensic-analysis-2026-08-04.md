> **ADDENDUM (2026-08-06, sitting 10 — agent-driven continuation on this
> vault).** A 14-turn Tomas sitting driven past the late gate settles
> several of this document's open questions and retires its stale
> sections. Read this before acting on anything below.
>
> 1. **Soundings are REACHABLE — §1's structural-barrier conclusion is
>    dead.** §1 analyzes a license that no longer exists: ticket 142
>    (2026-08-05) shipped `SUSTAINED_THRESHOLD = 0.10` (p85 of 957
>    archived windows — the "lower to 0.08" recommendation re-litigates a
>    decision already made with data) and `late = questionCount >= 9`,
>    not `ceil(budget/2)`. At question 9 of the continuation sitting the
>    license fired (`licensed=true`), the offer surfaced (construct
>    "drawer", allowance 9, checkpoint 5), and a 3-rung descent ran.
>    `sustained` crossed 0.10 on NATURAL turns twice before deliberate
>    threading. The zero in §0 is sitting LENGTH (~6 questions per
>    sitting; the gate opens at 9), not the Jaccard barrier.
>    `sounding-license` lines now log the numeric `sustainedValue`.
> 2. **This run's harvest numbers hide a decimation bug (since fixed).**
>    gemma4 under the cuts JSON schema stops at grammar-valid prefixes:
>    long outputs end one `}` short and the whole chunk was dropped —
>    11 of 14 turns in the continuation sitting, silently. Short-answer
>    turns parse fine, which is why §0's totals look healthy.
>    `parseChunk` now appends closing brackets before declaring failure.
> 3. **The "User" direction is a clustering artifact, not a theme that
>    "resolves naturally" (§2).** Every claim body begins "The user…",
>    so ≥1-shared-word union-find chained the whole corpus: 38 claims at
>    this document's writing, 104 by the next morning, Bakery absorbed,
>    `themes=1`. Fixed 2026-08-06: claim-frame words are excluded and
>    linking needs ≥2 shared words — the same corpus now yields 14 real
>    themes (former-academia 16, flour 5, storefront 4…). The stale
>    "User" DirectionRecord should be deleted from any vault carrying it.
> 4. **Recommendation #2 contradicts §2** ("until auto-discovery ships,
>    the coach will never fire" — it shipped as ticket 149 and §2's own
>    evidence shows it firing). The dependency graph's Coach ❌ and
>    Soundings ❌ rows are likewise stale.
> 5. **§3's episode-sibling veto description is stale**: ticket 140
>    (2026-08-05) made the veto per-candidate. `citedCount >= 2` remains
>    the live constraint.

## 0. Empirical Eval Results (2026-08-05, gemma4:e4b both roles)

5 proper sittings with Tomas (reviser persona), turn-by-turn dialogue,
gemma4:e4b at http://127.0.0.1:11434/v1 for both elicitor and clerk.
Server supervised by hub with `restart: on-failure`. Zero crashes.

| Model | Role | Result | Metric |
|-------|------|--------|--------|
| gemma4:e4b | Elicitor | ✅ Works | 6-30s response times, coherent follow-up questions |
| gemma4:e4b | Harvest | ✅ Works | 50-70s for ~20 chunks, 15-21 proposals per sitting |
| gemma4:e4b | Wiki synthesis | ✅ Works | 57 claims from 5 sittings |
| gemma4:e4b | Coach seed | ✅ Works | Auto-discovered "User" (38 claims) and "Bakery" (3 claims) |

**bonsai-27b note**: The elicitor works (3-13s) but the server process
becomes unstable on longer turns. The earlier crashes were bonsai-27b, not
gemma4. Gemma4 for both roles is fully stable.

### Pipeline Metrics (cumulative, 5 sittings)

| Metric | Count |
|--------|-------|
| Sittings | 5 |
| User turns | ~30 (genuine dialogue, answering model's questions) |
| Snippets harvested | 133 |
| Claims synthesized | 57 |
| Queue openers minted | 19+ |
| Coach directions auto-discovered | "User" (38 claims), "Bakery" (3 claims) |
| Server uptime | 40+ minutes, 0 crashes |

### Subsystem Status (empirical)

| Subsystem | Status | Evidence |
|-----------|--------|----------|
| sitting/session | ✅ | 5 sittings completed |
| harvest | ✅ | 133 snippets, gemma4 50-70s per sitting |
| docket | ✅ | Auto-runs after harvest acceptance |
| wiki/claims | ✅ | 57 claims synthesized |
| coach direction discovery | ✅ | `coach-seed-cluster` auto-creates directions |
| coach offer | ⚠️ | Offers "User" direction but only 1 direction qualified |
| soundings | ❓ | 0 offers across 5 sittings — `late` gate requires t10+ |
| expeditions | ❓ | Not yet observed — needs cited snippets with fact/construct facet |


# Eval: Forensic Analysis of Depth-Gated Subsystems
## 2026-08-04 (updated 2026-08-05 with empirical findings from 5 sittings)

Empirical confirmation from 50 prior eval sittings plus 5 new sittings with
gemma4:e4b for both elicitor and clerk. Pipeline works end-to-end: 133 snippets,
57 claims, coach auto-discovering directions. Code-level root cause analysis
below, updated where empirical evidence contradicts earlier analysis.
## Summary

| Subsystem | Status | Root Cause | Type |
|-----------|--------|-----------|------|
| Harvest | ✅ | gemma4:e4b works for both elicitor and clerk (bonsai crashes) | Resolved |
| Soundings | ❓ | `sustained` crosses 0.15 on 2/8 turns; `late` gate blocks early turns | Threshold × Gate interaction |
| Coach direction | ✅ | `coach-seed-cluster` auto-discovers directions from claims | Resolved |
| Coach offer | ⚠️ | Single catch-all "User" direction dominates; needs claim diversity | Low diversity |
| Expeditions | ❓ | Not yet observed — needs cited snippets with fact/construct facet | Gate design |
| Lineage mirror | ❓ | Depends on claim maturity (not yet reached at 5 sittings) | Dependency chain |
| Gap fill | ❓ | Requires KTG coverage data | Dependency chain |
| Anniversary | ❓ | Requires calendar-matched dated snippets | Timing dependency |
## 1. Soundings — `src/sounding/license.ts`

### The Gate

```
licensed = late && energy && sustained && unoffered
```

All four must be true. Any single `false` → no offer.

### Gate Analysis

**`late`** — `s.questionCount >= ceil(budget/2) && s.questionCount < budget - 2`
- `budget = min(20, max(10, s.mode.minutes))`
- With 25-min sitting: budget=20, late turns = 10–17
- With 10-min sitting: budget=10, late turns = 5–7
- Only second-half turns qualify. First-half turns (where trust builds) are excluded.

**`energy`** — `s.mode.energy !== 'low'`
- Low-energy mode excluded. Medium and high qualify.
- Found in prior eval: mostly medium/high modes used — this gate is rarely the blocker.

**`sustained`** — `thread.length >= 3 && meanAdjacentJaccard(thread) >= 0.15`
- This is the showstopper. Analysis below.

**`unoffered`** — `s.soundingOffer === undefined`
- Only one offer per sitting. Expected and correct.

### The Jaccard Barrier (Detailed)

`contentWordsOf(text)` in `src/index/lexical.ts:65`:
1. Tokenizes with `TOKEN_RE = /[a-zA-Z0-9]+(?:[''-][a-zA-Z0-9]+)*/g`
2. Filters 150+ stopwords (all English function words, pronouns, prepositions, auxiliaries)
3. Returns `Set<string>` of lowercase content words

`jaccard(a, b) = |a ∩ b| / |a ∪ b|`

`meanAdjacentJaccard(turns)` averages Jaccard over adjacent pairs.

For Jaccard > 0.15 with typical content-word counts:

| Words/turn (post-stopword) | Shared words needed |
|---------------------------|---------------------|
| 15 (terse, Ilse) | ~4 |
| 25 (normal) | ~6 |
| 40 (verbose, Wendell) | ~9 |

In natural conversation, topic drift is the norm. Turn N discusses climbing
routes; turn N+1 shifts to the gym; turn N+2 discusses the youth team. Shared
content words across adjacent pairs: 2-4 ("climb", "route", "set", "wall").
Expected Jaccard: 0.05–0.10.

**Why Wendell didn't cross it**: Wendell produces 40-60 words per turn, but his
verbosity is expansive, not repetitive. More words → more unique content words →
larger union → lower Jaccard. Verbosity actively HURTS the Jaccard score.

**Why Ilse didn't cross it**: Ilse produces 15-20 words per turn. Small union
should help Jaccard, but her answers are terse and self-contained — each answer
introduces its own vocabulary rather than reusing prior words.

### The `late` × `sustained` Interaction

These gates are multiplicative, not additive. The `late` gate restricts
soundings to the second half of the sitting (turns 10+ for 25-min). But by turn
10, the model has already asked 9 questions across multiple topics. The window
for a sustained thread (3 consecutive user turns with high lexical overlap)
is structurally narrow — the model's own topic-spreading behavior works against
the sustained gate.

### Recommendation

**Lower `SUSTAINED_THRESHOLD` from 0.15 to 0.08** or replace the Jaccard
mechanism entirely. Alternatives:
- Content-word count overlap (absolute count, not ratio) — a thread is
  sustained when 5+ content words recur across 3 turns, regardless of
  vocabulary size
- Topic-model similarity (embedding cosine) rather than lexical overlap
- Remove the sustained gate and rely on `late` + `energy` alone — let the
  model decide when to offer a descent based on conversational context

---
## 2. Coach — `src/coach/license.ts` + seed discovery

### Empirical Finding (2026-08-05)

**Coach direction discovery WORKS.** The system auto-creates directions from
claim content clusters via `coach-seed-cluster` and `coach-seed-minted` events.
From 5 sittings: "User" direction (38 claims) and "Bakery" direction (3 claims)
were auto-discovered. The prior forensic analysis was incorrect — directions
are NOT dependent on manual user declaration.

Evidence from activity log:
```
coach-seed-cluster  theme=Bakery claims=3
coach-seed-minted   slug=bakery name=Bakery claims=3
coach-seed-cluster  theme=User claims=38
coach-seed-minted   slug=user name=User claims=38
```

### The Flow

```
evaluateOffer(facts, log)
  → candidates = coach-seed-minted directions + queue entries with direction
  → for each: relevantClaims(facts, direction).length
  → if ≥ THRESHOLDS['coach.offerMinClaims'] (3): qualify
  → return best qualified direction or null
```

### Remaining Gap: Single Direction Dominance

The coach offers "User" (38 claims) but this is a catch-all direction from
clustering all user-attributed claims together. More specific directions
("Bakery" with 3 claims) are below the offer threshold. With more sittings
and more diverse Tomas material (academia, family, storefront), additional
directions should emerge and qualify.

### Status

**Working, with caveat.** Direction discovery fires automatically. The
remaining gap is direction diversity — one dominant catch-all direction
vs multiple specific ones. This resolves naturally with more sittings.

---

## 3. Expeditions — `src/clerk/composed.ts:660`

### The Gate

```
isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)
  1. hasTargetFacet: ≥1 reading with facet 'fact' | 'construct'
  2. citedCount ≥ 2: cited by ≥2 queue-asked questions
  3. no episode-facet sibling in same session
```

### Gate-by-Gate Analysis

**Gate 1 (facet)**: The reading's facet is set by the harvester during snippet
extraction. The fake LLM produces no facets. Real-model harvests tag snippets
with facets based on content. This gate alone filters ~70% of snippets (episodes,
intentions, declaratives without fact/construct tagging).

**Gate 2 (citation count)**: The snippet must have been cited by at least 2
queue questions that were actually asked (`status === 'asked'`). In early
sittings, no snippet has been asked about even once. In later sittings, a
popular snippet might be asked about 1-2 times. The threshold of 2 filters
most snippets — only the most referenced material qualifies.

**Gate 3 (session sibling)**: If any other snippet from the same session has
an 'episode' facet, the candidate is rejected. This is a blunt instrument — a
single episode-tagged snippet contaminates the entire session for expedition
purposes. Since many sessions produce at least one episode-tagged snippet,
this gate silently blocks most candidates.

### Recommendation

Relax one or more gates:
- Lower `citedCount` threshold to 1
- Remove the episode-sibling gate (or scope it to same-topic episodes)
- Add a "mature snippet" alternative: snippet older than N days with ≥1
  citation qualifies regardless of facet

---

## 4. Lineage Mirror — `src/clerk/lineage-mirror.ts`

### The Dependency Chain

```
lineage mirror fires → needs claim with sufficient lineage history
  → needs claims to exist (≥5-8 per 10 sittings)
    → needs snippets harvested
      → needs real model output
```

The `licenseMirror()` function (`lineage-mirror.ts:135`) checks:
- Claim must have preceding sitting history
- The claim's creation date must be separated from its latest update by
  enough sittings

With 5-8 claims per 10 sittings and LINEAGE_MIRROR_CAP = 1 per docket run,
this subsystem fires rarely but should fire given sufficient vault maturity
(15+ sittings).

**Status**: Not a design gap. A dependency chain that resolves with time.
The prior eval's 10-sitting windows were too short.

---

## 5. Gap Fill — `src/ktg/gap-fill.ts`

### The Dependency Chain

```
gap fill fires → needs KTG skeleton loaded + coverage data
  → needs territory nodes with evidence (probed)
    → needs KTG instrument to have been used previously
```

`runTerritoryGapFillSweep()` (`gap-fill.ts:43`) is zero-LLM:
- Reads a KTG skeleton (pre-loaded from `data/ktg/`)
- Reads coverage store (what nodes have been probed)
- Mints template questions for frontier/unprobed nodes
- Cap: TERRITORY_MINT_CAP = 2 per run

**Status**: Depends on KTG data existing. The prior eval had `data/ktg/fake-craft.json`
loaded but may not have had coverage data written. Not a design gap — a data
dependency.

---

## 6. Anniversary — Randomizer

### The Dependency Chain

```
anniversary fires → needs dated snippets with calendar match
  → needs snippets with real dates
    → needs either: dated import snippets, or multi-day usage spanning
      calendar-relevant dates
```

The anniversary draw reads from dated snippets (snippets with provenance dates
matching the current calendar date ± window). In a fresh vault with only
same-day sittings, no dated snippets match. Imports with historical dates
could trigger this, but imports weren't tested in the prior eval.

**Status**: Timing dependency. Not a design gap — requires either multi-day
usage or dated imports.

---

## Subsystem Dependency Graph

```
                    ┌──────────────┐
                    │   Sittings   │
                    └──────┬───────┘
                           │ real model output
                    ┌──────▼───────┐
                    │   Harvest    │ ← requires real LLM for snippet extraction
                    └──────┬───────┘
                           │ snippets + readings
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼─────┐ ┌───▼────┐ ┌─────▼────────┐
     │  Wiki Claims  │ │ Queue  │ │ Docket Cycle  │
     │  (5-8/10 sit) │ │Entries │ │ (after harvest)│
     └──────┬───────┘ └───┬────┘ └─────┬────────┘
            │             │            │
    ┌───────┼─────────────┼────────────┼───────────────┐
    │       │             │            │               │
┌───▼──┐ ┌──▼────┐ ┌──────▼──┐ ┌──────▼──────┐ ┌──────▼──────┐
│Coach │ │Lin.   │ │Expedit. │ │Anniversary  │ │Gap Fill     │
│❌    │ │Mirror │ │❌       │ │❓           │ │❓           │
│needs │ │❓     │ │needs    │ │needs        │ │needs KTG    │
│dir.  │ │needs  │ │2 cites  │ │dated        │ │coverage     │
│+3 cl │ │claims │ │+ fact   │ │snippets     │ │data         │
└──────┘ └───────┘ │+ no ep. │ └─────────────┘ └─────────────┘
                   └─────────┘

                    ┌──────────────┐
                    │  Soundings   │
                    │      ❌      │
                    │ Jaccard 0.15 │
                    │ independent  │
                    │ of all above │
                    └──────────────┘
```

Note: Soundings are the only depth-gated subsystem NOT in the dependency
chain. They depend only on turn-level lexical overlap — no snippets, no
claims, no docket. Their failure is purely a threshold design issue.

---

## Recommendations (Priority Order)

### Immediate (fix structural gaps)

1. **Soundings**: Lower `SUSTAINED_THRESHOLD` from 0.15 to 0.08, OR replace
   Jaccard with absolute content-word overlap count (≥5 shared words across
   3 turns), OR remove sustained gate entirely and rely on late+energy alone.

2. **Coach**: Add direction auto-discovery to the docket. Scan claim bodies
   for recurring noun phrases (≥2 claims with same 4+-char word). Auto-tag
   queue entries when their cited snippets have claim associations. Until
   auto-discovery ships, the coach will never fire for any user.

3. **Expeditions**: Relax `citedCount` from 2 to 1. Remove or narrow the
   episode-sibling gate. Consider a "mature snippet" alternative path.

### Deferred (resolve with time)

4. **Lineage Mirror**: No code change needed. Will fire naturally once the
   vault has 15+ sittings and 10+ claims. The prior eval's 10-sitting windows
   were too short.

5. **Gap Fill**: No code change needed. Depends on KTG data accumulation.
   Verify KTG data is being written correctly; if not, fix that separately.

6. **Anniversary**: No code change needed. Depends on multi-day usage or
   dated imports. A 30-day eval window would trigger this naturally.
