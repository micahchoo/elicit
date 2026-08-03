---
title: "readings for composition snippets"
labels: [wayfinder:task]
status: open
assignee: claude (omp exec, composition)
blocked_by: []
---

## Question

Composition Snippets (Q-40) arrive with no Facet reading. `POST /api/piece/:id/prose`
writes a Snippet through a zero-LLM path; readings are agent-authored (Q-4) and are
written today only by `decide()` in `src/harvester/harvester.ts` at harvest time,
from a model's proposal. Nothing in the tree mints a reading for a reading-less
snippet after the fact.

Three things are true about that, and all three are recorded rather than resolved:

1. It is not a *new* class of hole — a snippet whose harvest reading failed to
   parse is in the same state today.
2. It is not fixable inside pass 1 without a model, and fixing it in pass 2 would
   make pass 2 a correction rather than an addition, which Q-42 forbids.
3. The honest fix is a Docket job that proposes readings for reading-less
   snippets, which belongs to the Clerk's sweep and not to composition.

**Risk:** the corpus quietly accumulates uncitable snippets, and a Piece's
paragraphs stay invisible to the Wiki.

**Admissibility:** a composition Snippet is admissible on the hard gate that
matters — verbatim, standalone, the user's submitted words — but it is not citable
by a Claim until something reads it, which is the correct conservative state.

## Resolution target

A Docket job (part of the Clerk's sweep) that proposes readings for reading-less
snippets — composition provenance first, then any snippet whose harvest reading
failed to parse. Files to touch when it lands: `src/clerk/wiki-jobs.ts` (or a new
job beside it), the docket wiring in `src/clerk/docket.ts`, and a test that seeds a
reading-less snippet and asserts the job proposes a reading for it.
