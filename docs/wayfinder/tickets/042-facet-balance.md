---
title: "Fix: the corpus is 90% construct — implement facet balance"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  a8450b7: targetFacet on queue drafts/entries and deck entries; scripts/curate-deck.ts re-curates by what a question ELICITS instead of by the word "you" (the agent-introduced bias) — 193 episode-intent + 178 construct-intent entries, both tagged; facet-balance blueprint filter applied BEFORE top-k random per Q-13, running SHADOW-first per Q-35 (ELICIT_FACET_BALANCE=live to graduate); target default is now corpus-aware (three consecutive self sittings flips the suggestion to domain). 460 tests green.
resolution: >
  a8450b7: targetFacet on queue drafts/entries and deck entries; scripts/curate-deck.ts re-curates by what a question ELICITS instead of by the word "you" (the agent-introduced bias) — 193 episode-intent + 178 construct-intent entries, both tagged; facet-balance blueprint filter applied BEFORE top-k random per Q-13, running SHADOW-first per Q-35 (ELICIT_FACET_BALANCE=live to graduate); target default is now corpus-aware (three consecutive self sittings flips the suggestion to domain). 460 tests green.
resolution: >
  a8450b7: targetFacet on queue drafts/entries and deck entries; scripts/curate-deck.ts re-curates by what a question ELICITS instead of by the word "you" (the agent-introduced bias) — 193 episode-intent + 178 construct-intent entries, both tagged; facet-balance blueprint filter applied BEFORE top-k random per Q-13, running SHADOW-first per Q-35 (ELICIT_FACET_BALANCE=live to graduate); target default is now corpus-aware (three consecutive self sittings flips the suggestion to domain). 460 tests green.
---

## Question

MEASURED 2026-08-02 in Micah's real vault: facet distribution is
`25 construct, 2 lifetime-period, 1 value, 1 intention` — **zero episodes,
zero facts, zero causal-theory**. The corpus is almost entirely abstract
self-talk, with none of the dateable, checkable material CONTEXT.md calls
the evidentiary bedrock. Micah's read: "the questions are biased toward
self-reflection." Confirmed, with four causes, one of them self-inflicted.

1. **The deck filter is a self-reflection filter.** `data/decks/
   transformative.jsonl` — all 250 entries contain "you", because the
   agent's curation script REQUIRED `'you' in question`. Re-curate with
   facet intent, not second-person grammar.
2. **Facet balance is tracked but never applied.** Q-13 names it a HARD
   FILTER in constraints-then-chance; nothing implements it. 25:0
   construct-to-episode is exactly what it exists to prevent. Implement as
   the board's "shadow blueprint": assemble a facet-balanced session plan,
   ask only its first question, re-plan next turn. Shadow-first (Q-35).
3. **Questions carry provenance but not INTENT.** "What does X mean to
   you" (construct) and "what happened the last time X" (episode) are
   different instruments; both are just strings today. Bank entries, decks
   and composed drafts need a target-facet tag so the balance filter has
   something to filter on — and so an episode deck can exist at all.
4. **`target` defaults to 'self'** in two places (`elicitor.ts`,
   `server.ts`) — the inward gravity Q-19 was written to resist. Either
   require explicit declaration with no pre-fill, or let the default follow
   the corpus: after N consecutive self sittings, offer domain first.

Also: **instruments must not be preemptable.** CONTEXT (Question Source —
Instrument step) says an instrument "suspends selection while active", but
the adversarial eval found CDM never surfaced because juxtaposition kept
winning the priority chain. A domain sitting runs its instrument to
completion; resonance is offered after, not instead.

Success measure: facet distribution over the next N sittings moves toward
the shape of a life that contains events, not only opinions about events.
Track it in the Activity Log (shadow-first) so the claim is checkable.

## Resolution (2026-08-02)

All four items are built. The instrument-preemption note at the end of the
Question is NOT done — it belongs to the protocol registry, which another
agent held during this pass.

**1. Questions carry intent.** `QueueEntry.targetFacet` (optional, persisted
in queue frontmatter) and the new `DeckEntry` type. Optional is deliberate:
an untagged question carries no facet claim rather than a guessed one, and
the balance filter reads absence as unknown, never as construct. Two places
know their own intent and now say so — a curated deck entry, and a composed
follow-up, whose Red Light already names what the utterance is missing
(`facetIntentForRedLight`: abstraction-no-episode and cause-no-event ask for
an episode, pole-no-contrast and odd-term for a construct, unexplored-referent
for a fact). The generic LLM probe still claims nothing, because it knows
nothing.

**2. The deck was re-curated by intent, not by grammar.**
`scripts/curate-deck.ts` classifies each bank question by the retrieval
operation it demands (`src/elicitor/facet-intent.ts`). The old rule — the
literal word "you" must appear — was a second-person filter wearing a quality
filter's clothes: the old deck is **100% "you"**, the new transformative deck
is 75%, and questions like "why are we always so busy?" can now be drawn at
all. The episode rule keys on the demand for a PAST PARTICULAR (perfect
aspect, simple-past interrogative, singular-occasion deixis, superlative over
experience), which is why "what is the most hurtful insult you've been given?"
reads as an episode while "what does home mean to you?" does not.

Measured on `data/question-bank.curated.jsonl` (4104 lines, 1485 through the
unchanged quality gates):

| deck | before | after | facet shape |
|---|---|---|---|
| `transformative.jsonl` | 250, all construct-ish, all "you" | 178 | causal-theory 39, construct 38, general-event 32, intention 25, value 17, lifetime-period 14, fact 13 |
| `episodes.jsonl` | did not exist | 193 | episode 193 |

Only 32 of the old 250 stay in `transformative`; another 35 turn out to have
been episode questions all along and move to the new deck. 1114
quality-passing questions classify as
nothing and are dropped — hypotheticals and open abstractions mostly. That is
the honest number, not a failure to tune: a deck of confidently mislabelled
questions would poison the filter it feeds.

**3. Facet balance is a hard filter, in shadow.** `src/queue/facet-balance.ts`
reads the vault's live distribution from `wiki/readings/*.md`, compares it to
a blueprint (episode .30, fact/general-event/construct .15, value .10,
lifetime-period/intention/causal-theory .05) and returns the Facets the corpus
is owed. `QueueStore.draw` applies it as a hard filter on the ordered pool
BEFORE the top-k random pick — constraints, then chance (Q-13), never a score.
Two guards keep it from becoming a silence: a filter that would empty the pool
stands down, and a corpus that owes every Facet (a new vault) owes none in
particular.

Every draw writes one `facet-balance-shadow` line to the Activity Log carrying
the distribution, the owed set, the six-slot blueprint, the pool sizes, the
open pick and the pick the filter WOULD have made. Behaviour is unchanged
unless `ELICIT_FACET_BALANCE=live`. Against the real vault today the filter
has plenty to say: distribution `construct:25, lifetime-period:2, value:1,
intention:1`, owed `episode, fact, general-event, value, causal-theory,
intention`, blueprint six slots of episode — episode is 30 points short and
everything else at most 15.

**Graduation condition** (Q-35, no calendar): flip the default to live when
the shadow log holds **≥30 draws with `applied=true` across ≥5 sittings**, of
which **≥60% show `diverged=true`** (proof the filter would change the
question, not rubber-stamp it), AND a hand read of 10 sampled `would=`
questions confirms the `targetFacet` tag matches what each question actually
asks for. The third clause is the load-bearing one: the filter can only be as
honest as the tags it filters on, and a regex is a hypothesis about language.

**4. The target no longer defaults inward by reflex.**
`src/elicitor/target-default.ts` reads the Targets of recent sittings from
transcript frontmatter (ULID filenames are time order) and suggests `domain`
after three consecutive `self` sittings. `server.ts` uses it for the fallback
and exposes `GET /api/target-suggestion`; `startSession` takes a
`defaultTarget` dep and still falls back to `self` last, so an absent target
never crashes a caller. A declared target always wins — this changes the
pre-fill, not the declaration (Q-19).

**Depends on 037 to show up in the numbers.** These four changes make the
agent ASK for episodes. The success measure counts what gets KEPT, and the
harvester still drops the dateable material it is handed (ticket 037). A
question that yields an episode the harvester discards moves no distribution.

**Follow-ups, out of scope here:**
- Nothing loads `data/decks/*` yet. The Randomizer draw source is unbuilt, so
  the new decks are curated material waiting for a consumer.
- Docket-minted drafts (`src/clerk/composed.ts`, `docket.ts`) still carry no
  `targetFacet`; openers and still-true revisits are composed from a Snippet
  whose reading already names a Facet, so the tag is free there.
- `readVaultFacetDistribution` re-reads the readings directory on every draw.
  Fine at 29 readings, not at 29,000.
