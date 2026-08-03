# DRM Prototype — Open Decisions

Each question names a design choice the prototype makes one way; the
question is whether the choice is right. Reacting to the walkthrough output
should settle most of these.

---

## 1. Affect-probe wording

The prototype asks:

> How did you feel?  Describe the tone of the time — the emotional color
> and your energy level.

The prompt explicitly names both dimensions from Kahneman et al. 2004
(pleasant/unpleasant = emotional color; engaged/disengaged = energy level)
but asks for prose, not ratings.

**Question:** Should the probe guide toward both dimensions explicitly
(like the prototype does), or should it stay fully open ("How did you
feel?") and let the speaker supply whatever dimension matters to them?

Tradeoff: explicit dimensions help the speaker retrieve — the DRM's
adjectives are retrieval cues. But explicit dimensions also train the
speaker into a frame, and the less-structured reflection might capture
what the DRM misses. The DRM paper's own validation rests on adjective
ratings; the prose adaptation has no equivalent validation.

---

## 2. Momentary-state Facet

The Facet union currently has `episode`, `general-event`, `lifetime-period`,
`fact`, `construct`, `intention`, `value`, `causal-theory`, `know-what`,
`know-how`, `habit`, and `know-why`. DRM fragments are episodes — that
facet already exists.

But the DRM's affect probe captures momentary emotional state, which is
a different kind of person-knowledge than a narrative episode. An "episode"
facet says "this happened"; the affect inside it says "this is how I felt."
A `momentary-state` Facet addition would let the Wiki distinguish "the lunch
with Mira was warm" (episode) from "I felt warm and attentive" (momentary
state within the episode) — and would open momentary-state probes as a
general instrument beyond DRM.

**Question:** Does momentary state earn its own Facet, or is the affect
probe's output just part of the episode's reading — an `episode` Snippet
whose Stance carries the affective weight?

If it does earn its own Facet, the wiring sweep follows the 095 build
pattern: add to the union, add to every Facet-exhaustive match, add a
SENTENCES entry, and re-run the registry scanner.

---

## 3. Episode duration in enumeration

The prototype collects only `startHour`, not an end time. The DRM paper
asks for both start and end times (to compute duration-weighted affect).
The prototype shows `~7:00` in fragments — start time only.

**Question:** Should the enumeration step collect end times? The
arguments:
- **Collect end times:** Duration data lets the Wiki detect patterns
  ("long episodes tend flat-affect") that start-only enumeration misses.
  It also stays truer to the DRM instrument, which is duration-weighted
  by design.
- **Start-only:** Less friction during enumeration. The speaker is already
  reconstructing a whole day from memory; asking for precise end times
  is a burden that may cause them to round or guess. The prototype's
  simplification may paradoxically produce better data by asking less.

---

## 4. Gate granularity

The prototype shows the gate (continue / park / another day) ONLY after an
episode's four probes are complete — it is a blocking gate at every episode
boundary. In the Sounding, the gate-row is always visible (park and
another-day are offered at every rung), and only the checkpoint rung
(typically rung 4–6 of 8–12) blocks the textarea with a "continue" button.

**Question:** Should DRM's gate be always-visible (park/another-day offered
during probes, not just between episodes), or is the between-episode gate
sufficient?

Tradeoff: always-visible gates give the speaker an exit at any moment
(higher consent fidelity), but they also clutter the probe screen and may
train the speaker to watch for exits. The DRM's episodes are fewer (4–6)
and shorter (4 probes each) than a Sounding's rungs (8–12, each with an
open-ended probing exchange), so the between-episode gate may be
proportional.

---

## 5. Protocol rotation weight

DRM is a heavy instrument: it asks the speaker to reconstruct a whole day.
If it fires every session or every other session, the practice becomes a
chore. The ticket says "it should not dominate."

**Question:** Where does DRM sit in protocol rotation? Some options:
- **Weekly cap:** at most once per week, offered when the sitting Mode
  has ≥20 minutes and the target is `self`.
- **Randomizer-weighted:** treat DRM as one protocol among several, with
  a low draw weight (e.g., 10% chance when the bank/queue runs dry and
  the Randomizer fires).
- **User-declared only:** DRM is never auto-offered — the speaker
  explicitly asks for it, like a Sounding's licensing check but one step
  further removed (the speaker initiates, not just consents).
- **Expiring cooldown:** DRM can fire at most once every N days, with N
  configurable, and the cooldown is visible on the Waiting Surface.

---

## 6. Fragment admissibility

DRM fragments carry `about-when = yesterday` but are otherwise raw probe
answers — they have not passed the standalone-interpretable test a Snippet
requires. An affect answer like "calm and present, a little groggy" makes
sense only next to the episode it describes.

**Question:** Are DRM fragments Snippets directly, or do they pass through
a review step? If review: the fragment is shown as a Bud with its episode
context, and the speaker promotes, trims, or restates each probe answer.
If direct: affect answers enter the Wiki as standalone Snippets, and the
reading step is expected to reconnect them to their episode later.

The prototype assumes direct Snippets (it calls them "fragments"), but the
admissibility question is open.
