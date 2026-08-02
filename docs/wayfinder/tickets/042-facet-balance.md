---
title: "Fix: the corpus is 90% construct — implement facet balance"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
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
