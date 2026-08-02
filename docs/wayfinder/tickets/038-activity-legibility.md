---
title: "Fix: activity stream leaks ULIDs into a reading surface"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Visible in docs/guide/waiting.png: activity lines render raw identifiers —
`juxtaposition-offered: session=01KZ0DJAKS53EHA0KJZTGZJHY5
snippet=01KZ0DJ3MJVD6PDDKM3JTYGGW…`. The Activity Log is Marginalia-class
(Q-23) on a reading surface governed by the document rule
(docs/interface-references.md) — machine identifiers are noise there.

Fix at the RENDER layer only; the JSONL keeps full ids (it is the audit
trail — Q-23 requires inspectability). The stream should read as sentences:
"offered a juxtaposition against a snippet from March 12", "kept 1 of 1",
"rebuilt the index from 12 snippets". Where an id is genuinely useful, it
becomes a link on the human-readable phrase, never bare text.
