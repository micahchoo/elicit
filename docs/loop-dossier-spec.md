# Dossier specification — ratified 2026-08-04

The ratified spec for the improvement loop's persona battery (Q-91,
Q-94). This session was the last human fingerprint on the measure:
Claude authors the battery to this spec, then the battery FREEZES.
Frozen paths are covered by the cycle report's `diff --stat`
self-disclosure (Q-96).

## The battery: five archetypes, five life stories

Five dossiers, `eval/dossiers/001-*.md` .. `005-*.md`. Each is a FULL
invented life story — a person with a name, a history, relationships,
work, and standing commitments — not a temperament sketch. The
archetype names the interviewing challenge the persona embodies:

1. **The guarded speaker** — reveals reluctantly, deflects on named
   topics, warms only when the interviewer earns it.
2. **The verbose rambler** — buries signal in digression; the harvest
   discipline (exact cuts, standalone-interpretable) is what's tested.
3. **The terse minimalist** — one-sentence answers; tests whether
   follow-ups can open a thread without leading it.
4. **The self-reviser** — the account genuinely changes across
   sittings; tests the diachronic contradiction plane.
5. **The eager pleaser** — the sycophancy control: agrees with every
   framing, answers out of compliance. Tests whether the interviewer
   pushes past agreement; the rubric's disconfirming questions (Q-88)
   lean hardest on this persona's life.

Every paired trial runs all five. A variant that regresses ANY
archetype's life fails its no-regression clause — the battery is a
conjunction, not an average (Q-21, Q-87: no composite scalar).

## Planted ground truth

Each dossier scripts, in machine-readable frontmatter:

- **Two synchronic tensions** — commitments or self-accounts the
  persona holds simultaneously (a stated value vs a told habit). The
  persona lives both honestly; it does not perform them as a puzzle.
- **One diachronic revision** — at a scripted sitting number the
  persona's account of one matter changes. The old telling was true
  then; the new telling is true now.

These are the checkable substrate of the wiki-truer axis (Q-87): a
verdict can ask whether the wiki surfaced each tension without
flattening it, and recorded the revision as diachronic movement rather
than overwriting the earlier account.

## Fully synthetic — the derivation ruling

No dossier content derives from the owner's vault, the archived vault,
or any real prose — not excerpts, not paraphrases, not extracted
"shapes." Ruled 2026-08-04: privacy wins the fidelity-vs-privacy call
outright. Dossiers are invented from the canon's own categories
(Facets, Stances, evasion and hedging as CONTEXT.md describes them)
and Claude's invention. The archived-vault fog patch is closed, not
deferred. Real prose enters evaluation ONLY through the read-only
eval-fixtures manifest (Q-91), which is a separate, non-dossier
channel.

## Seed file format

One markdown file per persona:

```markdown
---
id: dossier-001
archetype: guarded
contradictions:
  - id: c1
    type: synchronic
    poles: ["<self-account A>", "<lived habit B>"]
  - id: c2
    type: synchronic
    poles: ["<value>", "<practice>"]
  - id: c3
    type: diachronic
    revision-sitting: 4
    from: "<the earlier account>"
    to: "<the revised account>"
---

## Identity
## Life story
## Commitments
## Speech register
## Evasion triggers
## What I never volunteer
## How I elaborate
```

Frontmatter is for the harness (verdict checking against planted
ground truth); prose is what the persona inhabits. The whole file
drops into the omp persona run's system prompt (instance-plane spec).

## Where pre-authored identity ends

The dossier fixes facts, dispositions, and the planted script. Living
in Elicit, the persona invents freely BEYOND the dossier — new
anecdotes, elaborated detail — so long as nothing contradicts the
seed except the scripted revision. Those lived elaborations become
part of that persona-instance's own ground truth for its verdicts
(they are what it knows of itself, recorded in its vault). They never
feed back into the frozen seed: the next trial starts from the same
dossier, not from any prior life.

## Freeze

After authoring (ticket "Author the persona battery"), `eval/dossiers/`
enters the frozen set alongside the rubric, the guarded list, and the
invariant suite. Freezing is prompt-level (Q-89); the cycle report
self-discloses any drift via `diff --stat` (Q-96).
