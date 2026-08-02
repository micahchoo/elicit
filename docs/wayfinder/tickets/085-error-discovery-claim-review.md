---
title: "Task: an error-discovery pass over the clerk's first real claim graph"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: [008-build-clerk]
---

## Question

From Micah 2026-08-02, pointing at
https://github.com/shreyashankar/error-discovery-skill — systematic error
analysis packaged as an agent skill: build a local zero-dependency review
UI over a JSONL dataset, cluster and sample diversely, then loop — the
human reads and leaves free-text notes, the agent open-codes the notes
into failure modes, tracks coverage, and proposes the next samples.

The method is Elicit's own contract pointed back at itself: the human's
verbatim judgment is the only ground truth; the machine selects and
organizes but never invents the taxonomy unaided. It belongs on the DEV
side of the glass — an instrument for judging the machine, never a
product surface.

Run it against the first real claim graph, after ticket 008's RESULTS
run lands:

1. **Dataset:** one JSONL record per claim — claim sentence, range,
   status, and the full text of every cited snippet (composite record).
   Export script, not hand-assembly.
2. **Session:** Micah reviews a diverse sample in the skill's UI,
   free-text notes only. The agent clusters notes into failure modes
   ("range too broad", "reading overreaches the citation", claim
   granularity, whatever the notes actually say — no pre-set taxonomy).
3. **Output:** the failure-mode taxonomy with counts, checked into
   `docs/`, RESULTS-style; each mode above a nuisance count becomes a
   ticket candidate.

Second target, same instrument, later: the harvest decision stream. Every
trim and discard in harvest review is already a human annotation of a
wrong cut, logged and unread — a session over the trim deltas would
taxonomize the harvester's failure modes from ground truth we already
own. If this graduates, it is its own ticket.

Model note (map standing preference 2026-08-02): this tests judgment of
CLERK output — the dataset is qwen3.6:35b's claims and must stay so; the
review-UI agent itself is interactive Claude, no local model involved.
