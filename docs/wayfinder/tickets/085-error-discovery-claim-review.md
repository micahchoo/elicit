---
title: "Task: an error-discovery pass over the clerk's first real claim graph"
labels: [wayfinder:task]
status: closed
assignee: claude + Micah
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

## Resolution (2026-08-02)

Done the same day the claims landed. Micah reviewed 40 of 144 (the diverse
sample) in the review app at tools/claim-review/ (built per the skill:
dataset with cited-snippet texts, single-file HTML, stdlib server, clustered
sample); 20 skipped as clean, 20 noted. The open-coding is
[docs/claim-review-2026-08-02.md](../../claim-review-2026-08-02.md): five
modes — weak evidence units (6, two being 074 danglers meeting their
consequence), referent misidentification (3, one fabricated relation),
modality mismatch (3), agency overreach (3), reading-misses-context (4).

Dispositions: modes 2/3/4 + the weak-evidence lint amended into ticket 087
with counts and exemplars; mode 5 recorded as first field evidence toward
033; mode 1 validates 073/074. Headline counterweight: half the sample
reads clean, and every error is a distortion of real prose, never an
invention — the verbatim gate holds, interpretation drifts.

The harvest-decision-stream target (second paragraph of the Question)
remains open as its own future ticket when trim/discard data accumulates.
