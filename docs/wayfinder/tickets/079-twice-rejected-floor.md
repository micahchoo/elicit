---
title: "Fix: a probe the guard rejected twice is emitted anyway when the fallback draw is empty"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

From the codex comparative review (research-codex-lessons.md, lesson 7);
verified 2026-08-02 at src/elicitor/elicitor.ts:388-396. When a composed
question fails `guardQuestion`, the retry also fails, and `drawFallback`
returns null (queue and bank both empty), control falls through to
`emitProbe(s, probeText, …)` — emitting the exact text the guard rejected
twice. The person meets the one question the system is surest is bad.

"Never block the sitting" is the right value; the floor is wrong. Q-55's
own reasoning (a composed floor beats a stale draw) cuts the other way
here: a FIXED protocol-appropriate probe constant beats text that failed
validation twice. The protocols already carry openers/probes as data
(src/protocols/defs/*.md) — the floor should be drawn from the active
protocol's own material, deterministic, zero-LLM, so the failure path
needs nothing that can itself fail.

Log it honestly: a distinct event kind for "guard floor reached" (twice
rejected, fallback empty, fixed probe served), because Q-55's ladder work
(061) established that "which rung emptied the pool" must be legible.

Acceptance: a unit test drives compose→guard-fail→retry-fail→empty
fallback and asserts the emitted probe is the protocol floor constant,
never the rejected text; the event kind renders in src/log/format.ts
(the 063 sweep will enforce that anyway); existing sitting-flow tests
stay green.
