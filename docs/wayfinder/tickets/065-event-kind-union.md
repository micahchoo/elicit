---
title: "Fix: make an unknown event kind a compile error, not a test failure"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Ticket 063's stated follow-up, recorded by the agent that resolved it rather
than left as a preference.

063 enforces "every emitted kind has a rendering" with a **sweep**
(`tests/emitted-kinds.ts`) that blanks comments and strings, finds emit sites,
and follows one hop of indirection. It works — it found 26 unrendered kinds
where the ticket guessed four, and caught four more that landed mid-task.

But 063 chose the sweep on **availability, not merit**, and said so: the
compile-time option is stronger and was unreachable, because an `EventKind`
union only enforces anything if every emitter imports it, and the emitters live
in five directories one agent could not hold at once — `src/clerk/`,
`src/queue/`, `src/wiki/`, `src/randomizer/`, `src/server.ts`.

### What the sweep cannot see, and why it matters that this is a list

1. Runtime-assembled kinds (`kind: KINDS[i]`, concatenation) — failed loudly as
   `unreadable`, never silently dropped, but also never resolved.
2. Two hops of indirection. One is followed; a wrapper calling a wrapper is not.
3. Anything outside `src/`. Nothing emits from `web/` or `scripts/` today.
4. **A `detail` more than six lines from its `kind`.** This is the residual
   silent hole: the per-file floors catch a whole file collapsing out of the
   sweep, but not one site quietly dropping out of it.
5. The regex-versus-division disambiguation is a heuristic; bracket balance is
   the guard that catches it going wrong.

A union removes 1, 2, 4 and 5 outright and reduces 3 to "files that do not
import the union do not compile against it".

### The work

- Export `EventKind` as a union of the 48 literals from `src/log/` — the sweep
  already produces that list, so it is generated once rather than typed.
- Type `ActivityEvent.kind` as `EventKind` in `src/log/activity.ts`.
- Fix the fallout across the five emitter directories. This is the whole cost:
  it is a wide, shallow change, and it wants ONE agent holding all of it rather
  than five agents coordinating.
- **Keep the sweep.** It becomes the check that the union is complete — a kind
  in the tree with no union member is still a test failure, and the union alone
  cannot notice a kind nobody declared.

### Do this when the tree is quiet

The Clerk slice has had up to six agents in flight across those exact
directories. A change touching all five at once is cheap on a quiet tree and
expensive on a busy one — that is the only reason this is not done already.

## Acceptance

- `kind: 'not-a-real-kind'` fails `npx tsc --noEmit`, not just a test.
- The sweep still passes and still fails on a kind absent from `SENTENCES`.
- The residual hole at limit 4 is closed, and the ticket records which of the
  five limits remain.
