# Record plane spec — verdicts, ledger, demote, metrics

Ratified 2026-08-04 (Q-97, ticket 122). The loop's memory and the
owner's control surface. FILESYSTEM-ONLY by ruling: no /v2 routes, no
app screens — personas never see the record plane, and guarded-metric
numbers never reach a person-facing surface (Q-83's never-mirrored
class, applied to the operator hat).

## The ledger — `data/graduation-ledger.jsonl`

Append-only, instrument-plane, survives fresh start (Q-89). One JSON
line per event; closes rulings-doc open item 3:

```jsonl
{"at":"<ISO>","event":"graduation","mechanism":"<registry key>","cycle":"c01",
 "variant":"<commit sha>","trials":["archives/eval/c01/t1"],
 "verdicts":["archives/eval/c01/t1/verdicts/dossier-001.json", "..."],
 "kept":"<one sentence: the citation-backed reason>"}

{"at":"<ISO>","event":"demotion","mechanism":"<registry key>","by":"tripwire",
 "metric":"skip-rate","baseline":{"events":214,"rate":0.11},
 "observed":{"events":31,"rate":0.29},
 "batch":["<every mechanism demoted with it, recency rule Q-90>"],
 "dwellUntil":"<ISO, +7d Q-95>"}

{"at":"<ISO>","event":"demotion","mechanism":"<registry key>","by":"owner"}

{"at":"<ISO>","event":"re-graduation","mechanism":"<registry key>",
 "afterDwell":true,"trials":["<fresh evidence trials>"],"verdicts":["..."]}
```

`mechanism` is the registry key (src/registry.ts) — the ledger and
the mechanism-exposure registry speak one vocabulary. The loop reads
the ledger every cycle as its memory against oscillation; nothing
ever rewrites a line.

## Verdict objects — files beside the life they cite

`archives/eval/<cycle>/<trial>/verdicts/<dossier-id>.json`, written
once at trial end, then read-only with the rest of the archive:

```jsonc
{
  "dossier": "dossier-001", "cycle": "c01", "trial": "t1",
  "order": ["<which arm was shown first — recorded blind, unblinded by the harness after validation>"],
  "dimensions": {                    // the rubric's five lived surfaces
    "questioning":   { "better": "first|second|neither", "because": "<prose>",
                       "citations": [ { "life": "first", "ref": "vault/transcripts/<file>#<line-span>", "quote": "<exact substring>" } ] },
    "harvest":       { },  "wiki": { },  "descents": { },  "returns": { }
  },
  "disconfirming": { "<question id>": { "answer": "<prose>", "citations": [] } },
  "traces": { }                      // harness-computed, attached — never persona-authored
}
```

**Citation validation is mechanical (Q-88).** A citation resolves iff
`ref` names an existing file in the archived life and `quote` is an
exact substring of that file. Any dimension with `better != neither`
and zero resolving citations makes the WHOLE verdict malformed: it is
discarded and re-rendered once; malformed twice, the trial is
inconclusive — and an inconclusive trial never keeps a candidate.

## The keep rule (Q-98)

Constitution gate first: an invariant violation in either arm voids
the trial outright (Q-87 — no partial credit). Then, across 5
personas × 5 dimensions: **keep the candidate iff at least one
resolving-cited win exists AND zero resolving-cited regressions
exist.** Ties are silence, not evidence. The battery is a conjunction
— no persona's win outvotes another's regression.

## The demote verb — `scripts/demote.ts`

CLI, the always-works path (Q-89): `npm run demote -- <mechanism>`
flips the mechanism's `live: true → false` in its threshold/registry
entry and appends the `by:"owner"` ledger line. Works with the server
down, independent of all loop code. No web control exists.

## Tripwire state and the operator view

The tripwire sweep (build ticket 132) keeps
`data/tripwire-state.json`: per graduation, the frozen 28-day
baselines (Q-95), running post-graduation event counts, and the
`graduated-unconfirmed` flag while any guarded metric sits under the
20-event floor.

`scripts/loop-status.ts` is the ONLY renderer: it reads the ledger +
tripwire state and prints, per mechanism — state
(shadow/live/unconfirmed/dwelling), the guarded metrics with
baseline-vs-observed and events-toward-floor, dwell clocks, and the
last ledger line. Guarded and diagnostic metrics render under
separate headings, the split visible (Q-90). This report is for the
operator's terminal; no number in it ever appears in the app.
