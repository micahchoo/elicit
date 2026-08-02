---
title: "Fix: validators — interrogative check, guard scope, person agreement, standalone gate"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Four validator gaps from `docs/eval-2026-08-02-claude-adversarial.md`
(findings #3, #4, #5, #6). Common root: a check that exists is applied to
one code path or delegated to the model's self-report.

1. **"Contains a quote" != "is a question"** (#3, ~25% of minted openers).
   `composeOpener`/`composeStillTrue`/`composeExpedition` validate the
   verbatim quote via longest-common-substring — an unchanged echo of the
   snippet passes trivially. Add a separate interrogative validator
   (ends with `?` at minimum) to EVERY compose path; retry-then-null.
2. **Guard scope must match risk scope** (#4). `isParrot`,
   `isConversationReferential`, `isNearDuplicate` wrap only Priority 3
   (generic probe). Juxtaposition (P1) and red-light follow-ups (P2)
   return unchecked — a live near-duplicate juxtaposition pair was
   reproduced. Move the guards to a single choke point every returned
   question passes through, regardless of branch.
3. **Person agreement** (#5, 6/6 occurrences). Composed questions stitch a
   first-person quote into a second-person question and leak "I/my/me"
   outside the quoted span. Cheap mechanical guard: flag first-person
   pronouns outside quote marks; retry once. The underlying tension
   (Sole Authorship demands verbatim quoting; grammar demands person
   agreement) is real — name it in the ticket resolution, do not
   prompt-patch it away silently.
4. **Standalone is a suggestion, not a gate** (#6). The model self-reports
   `standalone: true` and defaults true under uncertainty; a fragment with
   no possible antecedent ("That is exactly why I do it that way") was
   accepted 2/2. Add a structural pre-check before trusting the boolean:
   leading pronoun/demonstrative with no in-cut antecedent ("that", "it",
   "this", "they", "he", "she") => Bud, not Snippet. This is also what
   finally puts material INTO the Bud mailbox (see ticket 027).
