---
title: "Fix: form-filter on bank fallback draws"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Fix wave 1, commit 6f44553: isWeakForm predicate (39 tests), applied to bank fallback draws only, falls through when filter empties the pool.
---

## Question

The test sitting opened with "have you eaten yet?" — a yes/no check-in drawn
from the raw are.na bank (curation report: 365 yes/no forms, 428
multi-question strings, ~20% of the bank). Until the curated deck exists
(ticket 004), the bank FALLBACK draw must refuse weak forms.

Filter, applied only to bank fallback draws (never to user-declared queue
entries or the future curated deck):

- Reject yes/no forms: question starts with an auxiliary/modal
  (do/does/did/have/has/are/is/was/were/will/would/can/could/should).
- Reject multi-question strings (more than one `?`).
- Reject leading-junk entries (does not start with a letter).

Export the predicate, unit-test it against examples from
`data/question-bank-report.md`. If the filter empties a draw, fall through
to the unfiltered bank rather than failing the opener — a weak question
beats no question.
