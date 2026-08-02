---
title: "Build: render sitting cadence as a plain fact"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review.

Zero outbound contact is right and stays. The failure mode of a zero-outbound
system is that the user drifts away and nothing notices — silent death has no
detector, and the monthly qualitative test cannot be run on a system nobody
opened.

Not a nag and not a streak. The record, as a sentence, on the waiting surface:
when the last sitting was, how many in the last month. The document rule
applies (docs/interface-references.md) — it is a line of text on a page, not a
widget. The activity log already holds everything it needs.

## Resolution (2026-08-02) — commit `33f6b43`

`src/log/cadence.ts` (`readCadence` + `cadenceSentence`), `GET /api/cadence`,
one dimmed line at the top of the waiting surface. 12 tests.

**Imports are excluded, and this is the finding the ticket could not have had.**
Ticket 057 landed 19 transcripts dated 2017-2026 with `protocol: 'import'` six
hours before this was built. Counting them would have reported a last sitting
in July 2026 that nobody sat for — the number would have been a lie on its
first day. An imported piece is a sitting in every structural sense and in no
experiential one.

Reads **transcripts**, not the Activity Log: transcripts are the durable record
(Q-3) and the log began later than the vault did. An unparseable transcript is
skipped, which undercounts — the safe direction, since this number must never
claim more activity than there was.

The wording is composed server-side so it is testable, and the tests assert the
Q-24 property rather than describing it: a 400-day gap and a 2-day gap produce
identical grammar, no second person anywhere, no `only` / `just` / `still` /
`haven't`, no exclamation, no streak. "Last sitting X ago" states a fact about
the past; "it has been X since you sat" states a gap, and a gap implies
something should have filled it. Dormancy is signal, never debt.

## Resolution (2026-08-02) — commit `33f6b43`

`src/log/cadence.ts` (`readCadence` + `cadenceSentence`), `GET /api/cadence`,
one dimmed line at the top of the waiting surface. 12 tests.

**Imports are excluded, and this is the finding the ticket could not have had.**
Ticket 057 landed 19 transcripts dated 2017-2026 with `protocol: 'import'` six
hours before this was built. Counting them would have reported a last sitting
in July 2026 that nobody sat for — the number would have been a lie on its
first day. An imported piece is a sitting in every structural sense and in no
experiential one.

Reads **transcripts**, not the Activity Log: transcripts are the durable record
(Q-3) and the log began later than the vault did. An unparseable transcript is
skipped, which undercounts — the safe direction, since this number must never
claim more activity than there was.

The wording is composed server-side so it is testable, and the tests assert the
Q-24 property rather than describing it: a 400-day gap and a 2-day gap produce
identical grammar, no second person anywhere, no `only` / `just` / `still` /
`haven't`, no exclamation, no streak. "Last sitting X ago" states a fact about
the past; "it has been X since you sat" states a gap, and a gap implies
something should have filled it. Dormancy is signal, never debt.

## Resolution (2026-08-02) — commit `33f6b43`

`src/log/cadence.ts` (`readCadence` + `cadenceSentence`), `GET /api/cadence`,
one dimmed line at the top of the waiting surface. 12 tests.

**Imports are excluded, and this is the finding the ticket could not have had.**
Ticket 057 landed 19 transcripts dated 2017-2026 with `protocol: 'import'` six
hours before this was built. Counting them would have reported a last sitting
in July 2026 that nobody sat for — the number would have been a lie on its
first day. An imported piece is a sitting in every structural sense and in no
experiential one.

Reads **transcripts**, not the Activity Log: transcripts are the durable record
(Q-3) and the log began later than the vault did. An unparseable transcript is
skipped, which undercounts — the safe direction, since this number must never
claim more activity than there was.

The wording is composed server-side so it is testable, and the tests assert the
Q-24 property rather than describing it: a 400-day gap and a 2-day gap produce
identical grammar, no second person anywhere, no `only` / `just` / `still` /
`haven't`, no exclamation, no streak. "Last sitting X ago" states a fact about
the past; "it has been X since you sat" states a gap, and a gap implies
something should have filled it. Dormancy is signal, never debt.
