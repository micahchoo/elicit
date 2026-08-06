# Queue review — 2026-08-03

Micah pasted the live open-questions surface (~62 entries) mid-session:
"see the problem with the questions." This document codes the defects.
The pasted material lives in the session transcript only. Examples below
are SYNTHETIC reconstructions that preserve each defect's structure —
the person's real prose stays out of tracked files (fixtures stay
synthetic; privacy call by Micah, 2026-08-03). Test fixtures derived
from this document must be synthetic too.

## The counts

Three templates cover ~55 of ~62 questions:

| Template | Count | Source mechanism |
|---|---|---|
| "…— what is the opposite of this for you?" | 21 | half-Construct gap-fill (027) |
| "Does this still hold true…?" (variants) | 16 | still-true (Q-14 path) |
| "You wrote: X — [follow-up]?" | ~18 | composed openers/follow-ups |

## Defect classes

**QR-1: Opposite-template misfire on non-construct material.** The
half-Construct mint fires on poetry, metaphor, and observation
(synthetic equivalents):
- "The kettle sings its one note, / All morning long." → "what is the
  opposite of this for you?" (verse — no pole to contrast)
- "One way to learn the trade is to watch the pull of the current while
  they are still in the boat." → same template (metaphor, not a construct).
Upstream cause: facet over-labeling as `construct` (ticket 037's bias,
"the corpus is 90% construct"). The minter trusts the label; the gate
must instead verify a pole is present (a clause that can carry a
contrast — the 088 clause discipline is adjacent).

**QR-2: Assertion-smuggling, therapy register, in composed follow-ups.**
Violates Q-81 (ruled today; these mints predate the guard). Synthetic
equivalents preserving each violation shape:
- "…when you honor your limits instead of pushing through them"
  (presupposes the person pushes through)
- "What new road are you taking now that the old one no longer calls
  to you?" (presupposes a new road exists)
- "How long will you let yourself stay stuck there?" (judgment-shaped)
- The register lexicon: "hold space", "truly welcome", "tend to",
  "honor" — generic therapy phrasing, detectable as a word list.
111's decomposition-guard fixtures must be built from these synthetic
shapes, never from the person's real queue entries.

**QR-3: Still-true sameness and region-milling.** Q-14 says always asked
a different way; the 16 entries are template repeats, and nearly all mill
one region (the capstone import) — a corpus-shaped sweep, not selection.
Ticket 109 (in flight) rebuilds form selection; ask-differently needs the
111 pattern set.

**QR-4: Claim prose leaking into the quote slot.** A question rendered
agent prose of the shape "The user asserts that X…" as its quote, third
person, labeled "from your own words" — false on its face. The mint
path used a CLAIM body where a Snippet quote belongs; the provenance
label must derive from what was actually quoted.

**QR-5: STT disfluencies quoted verbatim.** Synthetic shape: "planning
and, uh, sketching the map" — the verbatim rule preserves "uh" into
question text. Decide: verbatim means the kept Snippet; a quotation
INTO a question may elide disfluencies only by a mechanical, marked
rule (ellipsis), never by paraphrase (Q-12 intact).

**QR-6: The flood.** ~62 open questions visible. Per-run caps exist
(Q-56) but no display bound and no visible expiry of the stale tail;
each question's worth is diluted by its siblings. Bounds ship live.

## Correctives

- QR-2, QR-1's wording layer, QR-3's sameness → ticket 111 (Q-81 guard +
  pattern set). This document's quotes become negative test fixtures.
- QR-3's form selection → ticket 109 (in flight).
- QR-1's licensing gate, QR-4, QR-5, QR-6 → ticket 114.
