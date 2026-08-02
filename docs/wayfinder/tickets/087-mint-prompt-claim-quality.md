---
title: "Fix: claim quality at the mint prompt and lint — person drift and contentless ranges, never op rejection"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

From RESULTS §16.2 (2026-08-02-the-clerk.RESULTS.md). Measured on the first
real claim graph (144 claims): subject drift — "The user" 59, "The person"
28, "The author" 2 — and contentless ranges (`generally` ×7; shortest range
7 chars). The Clerk cannot improve a reading (§3: 144 facets in, 144 out,
zero drift), so the correctives are the mint prompt (fix the grammatical
person; one subject form) and lint (flag a Range that names no occasion).

HARD CONSTRAINT from RESULTS: this must NOT become an op rejection. A claim
with a weak Range is still a claim (Q-29's contract is untouched); the
corrective belongs in the prompt and in the zero-LLM lint layer (Q-31:
lint may add annotations and questions, never remove or restructure).

Acceptance: mint prompt names the subject form; a lint finding for
occasionless ranges with a dimmed note (034: zero renders as words);
measured re-run on the existing 144 claims recorded in the ticket; no
change to applyOps/rejection paths; suite green.
