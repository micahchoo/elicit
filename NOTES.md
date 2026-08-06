# Notes — teaching Elicit to its own author

- User often dictates ("uh"-laden prompts) — write lessons to be skimmed
  fast, not to require re-reading; front-load the point of each section.
- User is the author of this codebase (vibecoded it) — lessons should
  read as "here's the shape of what you built," not "here's a new
  library." Tone: orientation and naming, not tutorial-for-a-stranger.
- Mission was revised once already (2026-08-03): first draft framed this
  as generic "agent design patterns transferable to other projects";
  actual want is understanding *this* system specifically — knowledge
  management, question generation, the user data model, the backend, the
  agent configuration, the subsystems. Keep lessons concrete to Elicit's
  own code, not abstracted into general patterns (that abstraction can
  come later, once the concrete model is solid).
- 2026-08-03: Lesson 1's first draft undersold the Docket (described it as
  a 4-item list; it's actually ~10+ sweep/compose/consolidate jobs after
  the five-wave campaign) and mixed up gazetteer (actually `clerk/`) with
  `ktg/`. Root cause: relying on file names and decision-register prose
  instead of reading the actual current type signatures
  (`runDocket`'s `deps` type) before writing. Fixed in place. Going
  forward: for anything backend/subsystem-shaped, read the function
  signature or directory listing directly, and check a doc's git log date
  against the decision register's latest entry, before treating a
  one-liner as settled.
- 2026-08-03: Micah flagged that Lesson 2 leaned on internal project
  terms (Sounding, Bud, Resonance, Facet...) he doesn't yet hold — a ZPD
  failure: lessons assumed CONTEXT.md vocabulary the mission exists to
  build. Standing rule from now on: **no CONTEXT.md term appears in a
  lesson without a plain-English gloss at first use**, and
  `reference/glossary.html` is the contract — every term a lesson uses
  must be in it, in ordinary language. He built the app, so concepts are
  familiar; it's the coined *names* that aren't. Teach name-and-idea
  together, never name alone.
