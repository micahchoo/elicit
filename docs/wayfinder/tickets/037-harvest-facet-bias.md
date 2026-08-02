---
title: "Fix: harvester drops episodes and mislabels facet/stance"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

> WAITING ON A FILE, not a decision: `src/harvester/harvester.ts` is held
> by ticket 044 (in flight). Dispatch immediately after it lands.

## Question

> EVIDENCE UPDATE 2026-08-02 (orchestrator, real 6-turn sitting after
> ticket 034's chunked harvest landed — 16 proposals from 6 turns):
> - GOOD: the dateable episode is no longer dropped. "On March 3rd I
>   finally told my manager the estimate was fiction" was proposed —
>   per-turn attention fixed the episode-blindness half of this ticket.
> - STILL WRONG, same patterns: "I no longer think that." tagged facet
>   `intention` (the fallback-label failure, verbatim); the supersession
>   pair ("I used to think X... I no longer think that") still not tagged
>   stance `superseded`; "the relief lasted about four hours" tagged
>   `lifetime-period` when it is episode detail.
> - NEW, caused by chunking: cuts are far more granular (2.67 per turn),
>   several clearly NOT standalone — "the screen keeps only what survives
>   the copying." (what screen?), "curl before yellowing", "You cannot
>   schedule a tomato;". This is adversarial-eval finding #6 (the
>   standalone gate never fires) made sharper: more fragments, same
>   model-self-reported boolean. Ticket 035 owns the structural gate;
>   this ticket owns the facet/stance labeling and cut granularity.
>   Consider instructing minimum cut size / whole-thought cuts.

> EVIDENCE UPDATE 2026-08-02 (orchestrator, real 6-turn sitting after
> ticket 034's chunked harvest landed — 16 proposals from 6 turns):
> - GOOD: the dateable episode is no longer dropped. "On March 3rd I
>   finally told my manager the estimate was fiction" was proposed —
>   per-turn attention fixed the episode-blindness half of this ticket.
> - STILL WRONG, same patterns: "I no longer think that." tagged facet
>   `intention` (the fallback-label failure, verbatim); the supersession
>   pair ("I used to think X... I no longer think that") still not tagged
>   stance `superseded`; "the relief lasted about four hours" tagged
>   `lifetime-period` when it is episode detail.
> - NEW, caused by chunking: cuts are far more granular (2.67 per turn),
>   several clearly NOT standalone — "the screen keeps only what survives
>   the copying." (what screen?), "curl before yellowing", "You cannot
>   schedule a tomato;". This is adversarial-eval finding #6 (the
>   standalone gate never fires) made sharper: more fragments, same
>   model-self-reported boolean. Ticket 035 owns the structural gate;
>   this ticket owns the facet/stance labeling and cut granularity.
>   Consider instructing minimum cut size / whole-thought cuts.

> EVIDENCE UPDATE 2026-08-02 (orchestrator, real 6-turn sitting after
> ticket 034's chunked harvest landed — 16 proposals from 6 turns):
> - GOOD: the dateable episode is no longer dropped. "On March 3rd I
>   finally told my manager the estimate was fiction" was proposed —
>   per-turn attention fixed the episode-blindness half of this ticket.
> - STILL WRONG, same patterns: "I no longer think that." tagged facet
>   `intention` (the fallback-label failure, verbatim); the supersession
>   pair ("I used to think X... I no longer think that") still not tagged
>   stance `superseded`; "the relief lasted about four hours" tagged
>   `lifetime-period` when it is episode detail.
> - NEW, caused by chunking: cuts are far more granular (2.67 per turn),
>   several clearly NOT standalone — "the screen keeps only what survives
>   the copying." (what screen?), "curl before yellowing", "You cannot
>   schedule a tomato;". This is adversarial-eval finding #6 (the
>   standalone gate never fires) made sharper: more fragments, same
>   model-self-reported boolean. Ticket 035 owns the structural gate;
>   this ticket owns the facet/stance labeling and cut granularity.
>   Consider instructing minimum cut size / whole-thought cuts.

From `docs/eval-2026-08-02-claude-adversarial.md` finding #7:

1. **The bias runs backwards.** A turn containing an explicit dateable
   episode ("On March 3rd I finally told my manager...") plus a construct
   plus a causal theory yielded four cuts — construct, pattern claim,
   causal theory — and DROPPED the episode entirely. CONTEXT.md is
   explicit that Causal Theory is never evidence of the cause while
   Episodes are the checkable material; the harvester keeps the
   self-theory and discards the evidence.
2. **`intention` is a fallback label.** 5 of ~14 cuts tagged `intention`,
   none correctly — applied to avowal/self-observation/value content.
3. **`superseded` stance never used** where it is textbook-correct
   ("I used to think X. I no longer think that.") — tagged
   `self-observation` instead.

Fixes: prompt work (episodes are PRIORITY cuts; name the supersession
markers that force `superseded`) plus a cheap post-check — a cut whose
source turn contains a date/temporal anchor and a first-person past-tense
verb should be flagged if no episode-facet cut was proposed from that
turn. Facet distribution per session is already wanted by Q-7; log it
(shadow-first, Q-35) so the bias is visible rather than anecdotal.

## Resolution (2026-08-02) — commit `18ce8c7`

Findings: [`docs/eval-2026-08-02-harvest-037.md`](../../eval-2026-08-02-harvest-037.md).

**Measured before anything changed**, against the 295 hand-marked cuts the
ingest triage produced hours earlier — the largest labelled sample of this
harvester's real behaviour that exists, and it cost nothing to build.

### The finding nobody expected

**The 044 admissibility gate rejects 0 of 295.** Not zero of the hard cases —
zero of everything, including all nine fragments. It was built against
`"dunno"` and `"This question makes no sense."`, which nine years of published
prose does not contain. It has been **inert on real material since it shipped**,
and its tests all passed the whole time.

Live against `qwen3.6:35b` over 12 turns: `intention` on 13% of cuts, **six of
the eight stating no want, plan or goal anywhere in Micah's words**;
`superseded` on **zero**; `episode` on 6%, with **two of the three turns that
name when something happened producing no episode cut** — the ticket's headline
claim, confirmed at corpus scale. An earlier evidence update had called this
fixed; on six turns it looked fixed, on twelve it is not.

**Three defects nobody had named:** three cuts sat inside quotations (Q-51), and
three carried a **stance value in the `facet` field** — `propose()` cast facet
unchecked, so `self-observation` reached `saveReading()` and disk, where the
Clerk mints a Claim off it.

### After

| | before | after |
|---|---|---|
| quoted cuts proposed | 3 | **0** |
| out-of-vocabulary labels | 3 | **0** |
| marker-less `intention` | 6 | **0** |
| `episode` cuts | 6% | **30%** |
| dated turns with no episode cut | 2 of 3 | **0 of 3** |

Offline over all 295: **zero keeps destroyed**, four delayed to Buds, precision
47.1% → 48.9%.

### What was NOT fixed, and the numbers behind the refusal

**`world`/`log` is 76% of the junk and is not mechanizable.** Six predicates
measured; the best reaches 74% precision at 18% recall against a 53%
do-nothing baseline, and pays in Micah's own sentences. *"The workshop space is
where five brothers work from"* (drop) and *"Fragility is an honest and
important understanding"* (keep) are both third-person declaratives; *"I made a
rough spreadsheet which I shared with Padmini"* (drop) and *"I started to play
with the idea of researching through doing"* (keep) are both first-person past.
The difference is what the sentence is **about**. Recorded in
`admissibility.ts` with the numbers so nobody re-derives it.

Also declined, each with a reason: ticket 035's proposed leading-referent rule
(**catches 0 of 9 fragments and 25 of 139 keeps** — do not reopen 035 as
written); guessing a replacement facet for a bad `intention`; a minimum cut
length (glitch-art's keep is eleven words).

### Follow-ons, both handled

- **The ratchet's harvest A/B was inert** — `scripts/ratchet/run.ts` warned that
  `propose()` has no `promptOverride` and ran the default prompt anyway, while
  still reporting a keep-or-revert verdict. `propose()` has taken one since
  ticket 034. Repaired in `64aa4a1`.
- `src/server.ts#harvestDetail` logs none of the five new diagnostics — see
  [surface the harvest diagnostics](066-harvest-diagnostics-surface.md).
