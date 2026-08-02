---
title: "Fix: the questioner's context — move library, pivot rule, parrot guards"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Fix wave 1, commit 6f44553: move library, code pivot rule (live-walk proven), parrot + degenerate guards. Superseded in spirit by ticket 031 / Q-36 (repertoire over prescription).
resolution: >
  Fix wave 1, commit 6f44553: move library, code pivot rule (live-walk proven), parrot + degenerate guards. Superseded in spirit by ticket 031 / Q-36 (repertoire over prescription).
resolution: >
  Fix wave 1, commit 6f44553: move library, code pivot rule (live-walk proven), parrot + degenerate guards. Superseded in spirit by ticket 031 / Q-36 (repertoire over prescription).
---

## Question

The 2026-08-01 test sitting produced clarify-loops ("Could you clarify what
you mean by X"), a prompt-example parroted verbatim ("What kind of something
happens to them?" is `protocol.ts:15`'s own illustration), and a degenerate
composed question equal to the user's turn. Root cause: the questioner lacks
a model of what deepening IS, and the guards trust the model too much.

1. **Move library in the protocol prompt.** Replace the single anchoring rule
   with named moves, each with its license: ladder DOWN (general claim → ask
   for a specific recent scene); ladder UP (action/preference → ask what it
   serves, what would be lost); CONTRAST (category/valuation → ask for the
   nearest case that does not count); TIME-SHIFT (present-tense trait → ask
   when it became true or was last false); STAKES (choice/tension → ask what
   it costs). Rotate moves; never two of the same in a row.
2. **Pivot rule, enforced in code.** A content-free closed answer (short,
   no evaluative/narrative content) licenses NO deepening move. The elicitor
   draws the next queue/bank question instead of composing a follow-up.
   Detection: cheap code heuristic first (length + marker words), model
   judgment second; the pivot itself is a code path, not a prompt hope.
3. **Parrot guard, in code.** Reject any generated question that appears
   verbatim (or as a near-substring) in the prompt template that produced
   it. Prompt examples become abstract schemas — nothing quotable.
4. **Degenerate-composition guard (Q-12 tightening).** A composed question
   must strictly extend the quoted fragment: reject if it equals the
   fragment, equals the user's whole turn, or adds fewer than N content
   words around the quote. Retry-then-null per existing policy.
