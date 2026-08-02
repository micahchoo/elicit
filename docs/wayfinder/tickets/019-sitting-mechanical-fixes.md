---
title: "Fix: sitting infrastructure — log path, event coverage, empty harvest state"
labels: [wayfinder:task]
status: open
assignee: claude
blocked_by: []
---

## Question

Four mechanical defects found while tracing the 2026-08-01 test sitting
(transcript 01KZ088G2W22C7Y0AYR2AF67F4):

1. **vault/vault path bug.** `src/log/activity.ts:12` hardcodes
   `join('vault','log')`; the server joins it onto the vault root again.
   Activity events land in `vault/vault/log/`. Fix: the log dir is
   `join(root, 'log')`. Move the existing misplaced file(s) into
   `vault/log/` once; delete the empty nested dir.
2. **`question-asked` events carry no source.** Task 8's yield-by-source
   comparison needs it. Fix: the elicitor's returned question must expose
   its source (queue-composed / queue-still-true / bank / juxtaposition /
   probe / close); the server writes it into the event detail.
3. **`/end` is invisible in the log.** Emit `harvest-proposed` with the
   proposal count when cut proposals are generated. "Found nothing" and
   "silently failed" must be distinguishable by one grep.
4. **Empty harvest has no empty state.** Zero proposals renders a bare
   heading and a dangling save button (screenshot evidence). Fix: quiet
   message ("nothing from this sitting stood on its own — that happens"),
   close action only, no save button.
