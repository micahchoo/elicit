---
title: "Fix: docket resilience + model-server compat + canonical closes"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Fix wave 2, commit 9ccac72: user-role message audit, per-job try/catch in runDocket, harvest response isolation, canonical close strings. Juxtaposition verified firing post-fix.
---

## Question

Real-model eval (docs/eval-2026-08-01-real-model.md, finding 1): one bad
prompt shape in `composeOpener` disables the entire memory loop.

1. **User-role message.** Every LLM call must carry at least one user-role
   message — llama.cpp's chat template 400s otherwise (`Jinja: No user
   query found in messages`). Audit all call sites in `src/clerk/composed.ts`
   (composeOpener was caught; check composeStillTrue and kin); move payload
   content from system/assistant-only shapes into a user turn.
2. **Per-job isolation in runDocket.** Wrap each mint attempt in try/catch:
   log the failure (Q-23), continue the run, always return a complete
   DocketReport. One failed compose must never cost the fresh index.
3. **Harvest response isolation.** `/harvest` must return its result even
   when the post-harvest docket re-run fails — the snippets are already on
   disk; a 500 after successful writes lies to the client. Run the docket
   re-run outside the response path or catch around it.
4. **Canonical close questions.** Q-20 fixed the two close moves; the model
   paraphrases them off-spec ("What door is this opening?"). The
   closing-door and closing-bookmark questions become canonical strings in
   code — zero LLM involvement at close.

Acceptance: repeat the eval's session-1 flow (harvest 3 cuts) and verify
the post-harvest docket completes (opener-minted line in the log), then a
session-2 turn echoing a stored 3-content-word phrase triggers a
juxtaposition.
