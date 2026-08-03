---
title: "Build: model-resolved referent — an agent-plane annotation, evaluated before it ships"
labels: [wayfinder:task]
status: open
assignee: claude (omp wave 7, annotation)
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

**Prerequisite — DONE 2026-08-02:** the labelled set is
[docs/dangler-labels-2026-08-02.md](../../dangler-labels-2026-08-02.md).
Measured: 96/139 snippets dangle (69.1%); 71 of 96 resolve from the
mechanical 2-sentence window alone (74%); 25 are unresolvable — the exact
set where the annotation must stay silent. The eliciting-question bucket is
0 BY CONSTRUCTION: this vault is 100% imported prose, so question-anaphora
is unmeasured, not absent — re-measure when conversational snippets
accumulate. Original prerequisite text follows for context.

**Prerequisite, inside this ticket:** the labelled dangler set 072 called
for. RULED by Micah 2026-08-02: an agent may do the labelling (supersedes
the hand-label default this ticket inherited from 037's precedent). Label
the vault's snippets: does it dangle, and what is the true referent, read
from the stored sitting transcript / source piece. Ticket 037's discipline
stands — measure before anything changes, numbers recorded. The annotation
ships only if its precision on that set earns it; a wrong resolved referent
is worse than the dimmed context window alone, because it asserts where the
window merely shows.

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
