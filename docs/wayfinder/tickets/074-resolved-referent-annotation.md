---
title: "Build: model-resolved referent — an agent-plane annotation, evaluated before it ships"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: [073-antecedent-context]
---

## Question

Layer 3 of [072](072-dangling-referents.md): the model names what a dangling
expression refers to ("'the biggest issue' = serving single images"), so the
reading surface can say it instead of making the reader reconstruct it from
the context window.

This is agent prose, so it lives in the Reading plane as a model-stamped
annotation (Q-34 — lazy re-annotation applies when the model is upgraded).
It is never a gate: it cannot drop, route, or rewrite a snippet. Input is
the snippet plus its `Provenance.context` and `Provenance.question` from 073
— never the whole transcript.

**Prerequisite, inside this ticket:** the hand-labelled dangler set 072
called for. Label the vault's snippets: does it dangle, and what is the true
referent. Ticket 037's discipline — measure before anything changes, numbers
recorded in the code. The annotation ships only if its precision on that set
earns it; a wrong resolved referent is worse than the dimmed context window
alone, because it asserts where the window merely shows.

**Acceptance.** The labelled set checked into `docs/`; measured precision
recorded; annotations carry model stamps; a snippet with no dangling
expression gets no annotation (silence is the default); rendering shows the
annotation as agent-plane margin note, visually distinct from the person's
words.

**Payload discipline (codex precedent, research-codex-lessons.md lesson
5):** when the snippet, its `Provenance.context` window and its question
are assembled into the model payload, wrap each injected piece in typed
markers (`<snippet>…</snippet>`, `<context>…</context>`, `<question>…
</question>`) so the boundary between the person's prose and harness
scaffolding is textual and greppable — in the payload itself, in logs,
and in any later audit — rather than tracked by a parallel structure.
Same guarantee the verbatim-substring gate gives elsewhere: the
distinction is mechanical, not remembered.
