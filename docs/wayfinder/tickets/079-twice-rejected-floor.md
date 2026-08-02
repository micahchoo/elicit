---
title: "Fix: a probe the guard rejected twice is emitted anyway when the fallback draw is empty"
labels: [wayfinder:task]
status: closed
assignee: claude (omp)
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

## Resolution (2026-08-02)

The defect at elicitor.ts:388-396 is closed at the source: when the guard
rejects twice and `drawFallback` returns null, the elicitor now serves a
fixed, zero-LLM floor probe drawn from the active protocol's own material
and returns — the twice-rejected `probeText` can no longer fall through to
`emitProbe`.

**The floor is protocol data.** Each of the four `src/protocols/defs/*.md`
carries a new `floorProbe` frontmatter key (one sentence, no conversation
reference, no placeholders, true to the protocol's technique — e.g.
reflective's "What would it cost you to be wrong about that?").
`src/protocols/registry.ts` parses it into `ProtocolDef.floorProbe`, with
`DEFAULT_FLOOR_PROBE` ("What makes you say that?") as the never-fail net for
a malformed def; `tests/protocols.test.ts` asserts every def carries its
own, distinct from the default, so a silently-defaulted floor is a red
test. Served unchecked, like any canned draw — it is what the guards fall
back TO, so the failure path needs nothing that can itself fail.

**The event is a distinct kind.** `guard-floor` is emitted by the elicitor
(actor `elicitor`, detail `protocol=… verdict=… queue=0 bank=0` — never the
probe text, Q-22) through a new optional `vaultRoot` seam on
`startSession`'s deps, captured per session id. `src/log/format.ts` renders
it as a sentence next to the queue's own ladder entries; the 063 sweep
enforces it via a new `EMITTED` sample and a `FLOORS` entry for
`src/elicitor/elicitor.ts`.

**Verified.** `npx tsc --noEmit` clean; `npm test` 1272/1272 across 46
files. The acceptance test in `tests/elicitor.test.ts` drives
compose→guard-fail→retry-fail→empty-fallback against a real empty queue
and a spent bank, asserts the served probe is the reflective def's
`floorProbe` (never the rejected text) and that `guard-floor` lands in the
activity log with the right verdict. A mutation reverting the floor path to
the pre-fix fallthrough failed the test with the exact bug — the
rejected text reaching the person — then the fix was restored and the
suite re-verified.

**One follow-up, recorded rather than shipped inert:** the `/api/session`
route in `src/server.ts` does not yet pass `vaultRoot` to `startSession`,
so in production the guard floor is served but not yet logged — the
server.ts wiring is outside this ticket's footprint (a concurrent agent
owns that file), exactly the shape ticket 063 documented for the wiki
layer's `LogFn` before T13/T14 wired it. The seam itself is tested
end-to-end; wiring is one argument at the `startSession` call site.
