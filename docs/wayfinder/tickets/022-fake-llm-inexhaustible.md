---
title: "Fix: ELICIT_LLM=fake is a 3-shot script — dev mode 500s in real use"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Fix wave 2, commit 9ccac72: src/fake-responder.ts, full session with zero 500s in fake mode; ScriptedComplete stays exhaustible for tests.
---

## Question

Live walk (2026-08-01, isolated worktree at fcb16df): the fake-LLM server
mode wires `ScriptedComplete` from `tests/fakes.ts`, which throws
`ScriptedComplete exhausted after 3 response(s)` once its canned list runs
out. A substantive turn (red-light check + compose + probe) plus `/end`
(harvest propose) blows through 3 calls immediately — dev mode returns 500
on the second real interaction.

Fix: the server's fake mode needs an INEXHAUSTIBLE fake — cycling canned
responses shaped per call-site (probe text, red-light verdict JSON, harvest
cut-list) or a tiny rule-based responder. `ScriptedComplete` stays as-is for
tests (exhaustion there is a feature — it catches unexpected extra calls).
Acceptance: with `ELICIT_LLM=fake`, a full session (open → 5 turns → end →
harvest review → close) completes with zero 500s.

May already be partially fixed by the 019/020/021 fix-wave agent (its live
walk hits this same wall) — check its commit before starting.
