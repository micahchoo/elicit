---
title: "Honesty: Sole Authorship prevents misattribution of WORDING, not AUTHORSHIP"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

The sharpest finding of `docs/eval-2026-08-02-personas.md` (Persona 5):
pasted third-party text — the opening line of *A Tale of Two Cities*, and a
mashup of famous clichés — was proposed as legitimate Snippet material with
agent readings ("The user articulates a long-held personal philosophy").

The code-level guarantee is real and correctly enforced: a Snippet's text is
a verbatim substring of what was submitted. But that is misattribution of
WORDING. The README pitches "misattribution impossible by construction",
which reads as a claim about AUTHORSHIP — that these are the user's own
words in the sense that matters. Nothing in the pipeline can distinguish
the user's own reflection from text the user typed that originated
elsewhere.

Two honest responses, both wanted:

1. **Say what is true.** Fix the README and CONTEXT.md's Sole Authorship
   wording: the guarantee is that the agent never writes the user's prose
   and never alters it — not that the user wrote everything they submit.
   (This is the same class as ticket 036's resonance honesty pass.)
2. **Make the distinction expressible.** Pasted/imported material should be
   able to carry a different provenance from spoken/typed reflection — the
   Seeding design already treats imported corpus as its own kind with dated
   past-self provenance. At minimum, `/api/unprompted` should ask (once,
   quietly) whether what was pasted is the user's own writing, and record
   the answer. Do NOT attempt automated detection of third-party text.
