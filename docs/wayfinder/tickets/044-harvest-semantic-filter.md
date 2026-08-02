---
title: "Fix: harvest proposes refusals, meta-comments and non-content as evidence"
labels: [wayfinder:task]
status: open
assignee: claude (in flight)
blocked_by: []
---

## Question

Live from Micah's sitting, and independently from `docs/eval-2026-08-02-personas.md`
(Persona 1): the harvester proposes turns that are REACTIONS TO THE APP as
Snippet-track material, with agent readings attached:

- "I am not sure." → fact / uncertainty-marked, "The user expresses uncertainty…"
- "This question makes no sense." → fact / pole-preference, "…negative judgment
  regarding the intelligibility of a question."
- "Yes." → commitment / avowal
- "dunno", "I would rather not answer that one." → harvested as content

This is a **Two Planes violation** (CONTEXT.md): a reaction to the
interaction is LINEAGE — it belongs to the transcript and the activity
record — not KNOWLEDGE about the person. Approving these seeds the Wiki with
claims like "the user is uncertain" manufactured from the user declining to
answer, which is the false-coherence failure the whole design exists to
avoid. It is also the dead standalone gate (adversarial eval finding #6):
none of these are interpretable without the exchange around them.

Fix — structural, in code, before the model's boolean is trusted:

1. **Reuse what already exists.** `isContentFree()` in the elicitor already
   classifies these turns correctly (it is what triggers the pivot). But
   `propose()` runs over the whole transcript with no knowledge of which
   turns were flagged. Pass that knowledge through — a content-free turn is
   never harvestable.
2. **Meta-conversational filter.** Reject cuts that are about the
   conversation, the question, or the app rather than about the person's
   life/beliefs/knowledge ("this question", "that question", "makes no
   sense", "I would rather not answer", "pass", "dunno", bare "yes"/"no").
   Pure code predicate, exported and unit-tested.
3. **Minimum propositional content.** A cut carrying no proposition
   ("Yes.", "I am not sure.") is not a Snippet. Length alone is the wrong
   test — require a subject and a claim, or fall back to a conservative
   marker list; document the choice.
4. Rejected material is not silently dropped: it stays in the transcript
   (lineage, append-only) and the rejection reason is logged. Consider a
   Bud only when the fragment is genuinely about the person but
   under-specified — a refusal is not a Bud, it is not corpus at all.
