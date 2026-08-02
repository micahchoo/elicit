---
title: "Build: waiting states — every wait shows the app is alive"
labels: [wayfinder:task]
status: open
assignee: claude
blocked_by: []
---

## Question

Every model-backed action has a multi-second wait with no signal beyond a
disabled control. Measured: turn probe 4-9s, /end harvest ~20s, unprompted
propose ~10s, transcription 1-3s, docket 90s (background). Twenty seconds of
nothing reads as a hang, and the app's whole premise is that someone is
paying attention on the other end.

Form is constrained by `docs/interface-references.md` §"The document rule":
no spinners, no chrome, no percentage widgets. The idiom is typographic —
a **hairline rule that fills across the text measure** (1px, --border color,
width animating, no color change), plus dimmed status text in the voice
already used for the mic ("transcribing…"). Reduced-motion: the hairline
holds static and only the text shows.

Waits to cover:
- turn submit → probe (indeterminate)
- /end → proposals (LONGEST; determinate once ticket 034's chunked harvest
  lands, since it processes turn-by-turn — "reading turn 3 of 6")
- unprompted submit → proposals (indeterminate)
- harvest save → snippets written (indeterminate)
- login/setup submit (indeterminate, short)
- boot: first paint waits on the docket; if /api/auth/status is slow, the
  page should say so rather than sit blank

Also: an error state. A failed call currently leaves the control disabled
with no message — every wait needs its failure counterpart ("that did not
go through — try again"), never a silent dead end.

PHASE 1 (this ticket): client-side indeterminate states + error recovery.
PHASE 2 (follow-up): determinate harvest progress, which needs a server-side
progress channel — depends on ticket 034 landing chunked extraction.
