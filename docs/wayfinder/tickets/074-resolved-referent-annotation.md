---
title: "Build: model-resolved referent — an agent-plane annotation, evaluated before it ships"
labels: [wayfinder:task]
status: closed
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

## Resolution (2026-08-02)

Built by Claude (omp wave 7) — measurement first, then the ship decision,
then the wiring, per this ticket's own order.

### Measured precision (qwen3.6:35b @ 192.168.0.229:11434/v1, the clerk
role's model per Q-48)

Swept all 139 labelled rows of
[docs/dangler-labels-2026-08-02.md](../../dangler-labels-2026-08-02.md)
(the set its Summary, lines 187-205, describes: 96 danglers, 71
window-resolvable, 25 unresolvable, 0 question-anaphora), read-only over
the vault, via the annotator module itself — not a reimplementation.

| Measure | Value | Source |
|---|---|---|
| Precision on made annotations | **32/34 = 0.941** | `data/eval-074-annotate/output.jsonl` (sweep) + `grades.jsonl` (parent's referent-vs-label grading) |
| Silence on the 25 unresolvable rows | **24/25 = 96%** | same |
| Recall on the 71 window-resolvable rows | 32/71 = 45.1% | same |
| Annotations on the 43 non-dangler rows | 0 | same |
| Model errors / missing snippets | 0 / 0 | same |

Script: `scripts/measure-074-annotate.ts` (sweep resumable, `--score`
after grading; both re-runnable). The two wrong annotations are exactly
the failure class the silence test exists to count: one annotation on an
unresolvable row, and one annotation of a beyond-window expression
("the scaffolding") with a guessed generic referent.

### Ship decision: SHIP

Threshold, stated before the measurement ran: precision ≥ 0.90 on made
annotations AND silence on ≥ 90% of the 25 unresolvable rows. The
dimmed context window is the baseline and never misleads; the ticket's
own rule says a wrong resolved referent is worse than that baseline
"because it asserts where the window merely shows" — so a wrong
annotation costs at least as much as a right one gains, and 0.90 is the
floor at which the assertion earns its place. The silence floor guards
the one set the ticket names as must-stay-silent. Both gates held:
precision 0.941 ≥ 0.90; silence 24/25 = 0.96 ≥ 0.90. The annotation
ships. (The question-anaphora bucket stays 0 by construction — this
vault is 100% imported prose; re-measure when conversational snippets
accumulate, per the ticket's own note.)

### What was built

- `src/clerk/annotate.ts` — the annotator: input is the snippet plus its
  `Provenance.context` and `Provenance.question` ONLY, typed-marked
  (`<question>`/`<context>`/`<snippet>`, the 091 house shape); output is
  a model-stamped `Annotation` (Q-34) or `silence`. Never a gate — it
  cannot drop, route, or rewrite. A model failure throws (a dead
  endpoint is counted, never confused with silence). The invariant test
  pins its lineage reads to the typed-marker lines, mint.ts-style.
- `scripts/measure-074-annotate.ts` + `data/eval-074-annotate/` — the
  measurement above.
- `src/clerk/annotation-store.ts` — persistence, deliberately OUTSIDE
  the vault: `data/annotations/<snippetId>.json` in production. One file
  per snippet id holding the current record (annotation or persisted
  silence — silence is recorded so a judged snippet is never re-asked);
  validate-before-write, malformed-skip, no delete (wiki/store rules).
- `src/clerk/docket.ts` — `runReferentAnnotations`, job 7 of the run
  (optional thunk, T10's injection shape): annotates snippets with no
  record or a version-stale record, newest first, capped at 5 model
  calls per run (the clerk model is slow; the vault backfills lazily).
  Lazy re-annotation on model upgrade (Q-34) rides the same job.
- `src/server.ts` — `GET /api/snippets` carries `annotation` beside a
  snippet when the store holds one (silence and absence omit the key);
  the docket thunk is injected only when the store exists. The
  annotations store is an optional dep — absent means the exact
  pre-ticket server, which the tests keep.
- `web/main.ts` — `quoteBlock` renders the annotation as an agent-plane
  margin note (`"expression" → referent` in the `.wiki-note` style,
  dimmed ui font — visually distinct from the person's words) on the
  wiki surface and the contradiction exhibits.
- Registry: `annotateReferent` flipped `unwired → live`;
  `createAnnotationStore` and `runReferentAnnotations` declared live.
- Log kinds (sentence + sample in `src/log/format.ts` and
  `tests/log-format.test.ts` EMITTED): `referent-annotated`,
  `referent-annotation-failed`, `referent-annotations-failed`.

### Files touched

`src/clerk/annotate.ts`, `src/clerk/annotation-store.ts`,
`src/clerk/docket.ts`, `src/types.ts`, `src/registry.ts`,
`src/log/format.ts`, `src/server.ts`, `web/main.ts`, `scripts/measure-074-annotate.ts`, `tests/annotate.test.ts`, `tests/annotation-store.test.ts`, `tests/annotate-routes.test.ts`, `tests/docket.test.ts`, `tests/invariant-context.test.ts`, `tests/log-format.test.ts`, `data/eval-074-annotate/`.

### Server gate (Phase 4)

`src/server.ts` was dirty at measurement time (composition T10's
uncommitted fence). It committed during the run (`7f6741a`, with T13 and
089) — the ticket's poll-until-it-commits condition cleared, so the
server and web work proceeded. The measurement files never touched the
dirty fence.

### Verification

- `npx tsc --noEmit`: clean.
- `npm test`: 79 files, 1667 passed, 3 skipped (pre-existing skips in
  import/elicitor suites).
- `npx vite build`: ok.

### Remainders and design findings

1. **Design finding — reading-plane store is vault-resident.** The
   reading plane's agent-prose stores (readings, piece Marginalia,
   transcript summaries) all live inside the vault; this ticket forbids
   vault writes, so annotations persist outside it at `data/annotations/`.
   Whether annotations should eventually join the vault like readings is
   an open question for a future decision.
2. The randomizer-draw (resurfacing) surface does not render the
   annotation yet — the wiki surface, the primary reading plane, does.
   Same remainder shape as 073's wiki/draw note.
3. The two measured false positives would ship in production (the
   model's own silence decision is the production filter) — that is the
   accepted cost of the measured 94% precision, recorded here.
4. The 25-snippet unresolvable set is the silence test's load-bearing
   row; the docket job never re-asks a snippet the model already judged
   silent, so the 96% silence behavior is stable, not lucky.
