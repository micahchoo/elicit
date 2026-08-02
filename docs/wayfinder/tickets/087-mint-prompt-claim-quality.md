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

## Amended by the 085 review (2026-08-02)

The first error-discovery pass (docs/claim-review-2026-08-02.md, 40 claims,
20 noted) measured this ticket's scope into five modes. Three land here:

- **Referent discipline (3 noted, one severe):** the mint prompt must never
  resolve a referent beyond the prose — "ma'am" became "their mother", a
  fabricated relation; "Clement Valla's Binder" became "a binder". Prompt
  clause + exemplar; consider a lint comparing claim proper-noun/relation
  vocabulary against the cited prose (mechanical, add-only per Q-31).
- **Modality fidelity (3 noted):** did / intends / wants must match the
  prose; two completed works filed as `facet: intention`. This corrupts the
  facet distribution as well as the sentence.
- **Hedge preservation (3 noted):** "as far as I saw it" and "a conscious
  unspoken decision" (collective) flattened to sole agency. The hedge is
  content; it survives into the claim body or the range.
- **Weak-evidence lint (6 noted, upstream):** a claim whose only cite is a
  labelled dangler (074's set) gets a dimmed weak-evidence note. Mechanical.

Original scope (person drift, occasionless ranges) stands; the over-broad
range mode was met in the wild ("throughout their life"). All correctives
remain prompt + lint — never op rejection.
