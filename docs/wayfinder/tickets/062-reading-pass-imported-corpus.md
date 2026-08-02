---
title: "Build: the reading pass — turn 139 imported snippets into Readings"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: [037-harvest-facet-bias.md]
---

## Question

Ticket 057 landed 139 snippets across 19 dated sittings, 2017-2026. It landed
**no Readings**: the dry run recorded cut TEXT only, so facet, stance and the
reading sentence were not recoverable without the model, and inventing a facet
would be an agent authoring a reading and stamping it under Q-34.

The consequence is that nine years of corpus is **evidence but not wiki**. The
snippets feed resonance and composed openers today — which is the whole reason
a first sitting on an imported corpus differs from one on an empty vault — but
the Clerk mints Claims from Readings (Q-28), and there are none to sweep. No
Claims will appear until something reads them.

This is the only piece of work standing between the import and any of it being
visible, and it had no ticket until now.

### Why it is blocked on 037

The reading pass is a model run over 139 snippets, and its output is exactly
what 037 is measuring and fixing. Running it against today's harvester would
spend an hour producing readings with the known facet bias baked in, and Q-34's
lazy re-annotation would then re-read them one docket sweep at a time rather
than all at once. Cheaper to wait for the fix than to fix the output.

The plan records the same ordering for its own RESULTS run: *"the RESULTS run
should be done after they land, or its claim-quality numbers measure the
harvester, not the Clerk."*

### Shape

- A script under `scripts/`, not a server route. It runs once, over a known
  set, and its cost (~139 model calls) belongs in a terminal rather than behind
  a request.
- **Cites the snippet it read**, `snippetId@version` — the reading is about
  that snippet and nothing else.
- **Stamped** with the clerk model and `at` (Q-34), so a later upgrade can
  re-read it lazily and subtract the drift.
- **Idempotent**: a snippet that already has a reading is skipped, so the run
  can be interrupted. 139 calls at ~40s is over an hour; assume it will be.
- Runs the same extraction path the sitting harvest uses. This material gets no
  exemption — the point of the import was that it goes through the front door.

### What to watch

76 of the 139 snippets are the capstone, sharing one session. Under Q-50 nothing
drawn from them reaches `evidenced` alone, so the first Clerk run over this
corpus will show a wall of `unconfirmed`. **That is the vocabulary working, not
failing.** Do not loosen the rule to make the numbers look better.

## Acceptance

- Every one of the 139 snippets has exactly one Reading citing it.
- Re-running the script produces no second reading for any snippet.
- Every Reading carries the clerk model stamp and an `at`.
- A docket run after the pass mints Claims, and the report says how many.
- The facet distribution across the 139 is reported — it is the first
  independent check on whether 037's fix held on real prose.
