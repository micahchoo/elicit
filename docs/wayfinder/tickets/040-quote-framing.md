---
title: "Fix: composed questions must FRAME the quote, not splice it"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  c6b8ec3: compose prompts now FRAME the quote (set off, then the question in the agent's own words) instead of splicing it mid-clause; Q-12 strengthened in code from "contains the fragment" to "contains the fragment VERBATIM AND SET OFF" (quoted or on its own line), with the malformed live example as a rejection fixture; person-agreement guard now scans outside an explicit quoted span rather than a guessed one. 400 tests green.
resolution: >
  c6b8ec3: compose prompts now FRAME the quote (set off, then the question in the agent's own words) instead of splicing it mid-clause; Q-12 strengthened in code from "contains the fragment" to "contains the fragment VERBATIM AND SET OFF" (quoted or on its own line), with the malformed live example as a rejection fixture; person-agreement guard now scans outside an explicit quoted span rather than a guessed one. 400 tests green.
resolution: >
  c6b8ec3: compose prompts now FRAME the quote (set off, then the question in the agent's own words) instead of splicing it mid-clause; Q-12 strengthened in code from "contains the fragment" to "contains the fragment VERBATIM AND SET OFF" (quoted or on its own line), with the malformed live example as a rejection fixture; person-agreement guard now scans outside an explicit quoted span rather than a guessed one. 400 tests green.
---

## Question

Live evidence (Micah, 2026-08-02): the app asked

> "When did you last experience the kind of resonance that I thought that
> I long lost?"

Incoherent, and person-scrambled in a way ticket 035's guard cannot catch.
Root cause: the compose prompts ask the model to EMBED a verbatim
first-person fragment inside a second-person question, mid-clause. Two
failures follow structurally:

1. **Unmarked quotation.** The fragment ("I thought that I long lost") is
   verbatim and therefore passes Q-12, and 035's person-agreement guard
   masks the known fragment before scanning for stray first-person
   pronouns — so an UNQUOTED splice passes both checks. The sentence then
   lies about who is speaking: the reader cannot tell whose "I" that is.
2. **Grammatical collapse.** Splicing a fragment into the middle of a
   clause forces the model to bend syntax around it; the result parses as
   English but means nothing.

Fix — this is a Q-36 application (freedom in generation, rigidity in
validation), not a prompt plea:

- **Frame, do not splice.** The canonical shape sets the quote off and
  lets the question follow in the agent's own words:
  `You wrote: "<fragment>." <question in the agent's own words>?`
  The model gets full freedom over its own sentence; the quote is
  untouched and visibly attributed. Micah's phrasing for this was "more
  agentic editing" — precisely: more freedom in the agent's OWN words,
  zero freedom over the user's.
- **Strengthen Q-12 in code**: the check becomes "contains the fragment
  VERBATIM AND SET OFF" — inside quotation marks, or on its own line —
  not merely "contains the fragment". A composed question where the
  fragment is spliced unmarked is rejected and retried.
- Applies to every compose path: composeOpener, composeStillTrue,
  composeExpedition, composeFollowUp, composeJuxtaposition.
- Add the malformed example above to the test fixture as a regression
  case, plus one correctly framed counterexample.
