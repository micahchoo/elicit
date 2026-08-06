# Mission: How Elicit Works

## Why
You built Elicit and vibecoded most of it into being, but "it runs" and "I
can explain it" are different states. You want the second one: a working
mental model of how the app manages knowledge, generates questions, models
you, and is put together as an agent system — so you can extend it, debug
it, and reuse its patterns in other projects without re-reading the source
from scratch every time.

## Success looks like
- Can sketch, from memory, what happens between opening the app and closing
  a sitting — which subsystem does what, in what order.
- Can explain how the Wiki (the model of the user) is built and kept
  honest: what a Claim is, what makes it citable, how contradictions surface.
- Can explain how a question gets chosen — the seven Question Sources, the
  Queue, the Randomizer — well enough to predict what the app will ask next.
- Can explain the agent configuration: the elicitor/clerk model split, why
  it's split that way, and where a new background job would plug in.
- Can point to the file and function that implements any of the above.

## Constraints
- Sessions are self-paced, conversational, often dictated (short bursts,
  "uh"-laden) — lessons should read fast and not assume the user is at a
  keyboard taking notes.
- Ground every claim in this repo's actual code and docs — this project's
  own decision register (`docs/decisions/elicit.md`) treats unverified
  claims as a first-order sin; lessons should hold the same standard.

## Out of scope
- The interview *UX* design rationale in detail (covered already in
  `docs/interface-references.md`) — mention it, don't re-teach it.
- Rebuilding or modifying Elicit's code as part of these lessons — this is
  a reading/understanding mission, not a refactor.
- The philosophical/psychometric grounding of individual Protocols (Sounding,
  DRM, triadic construct elicitation) beyond what's needed to see why the
  code branches the way it does.
