---
title: "Fix: harvester drops episodes and mislabels facet/stance"
labels: [wayfinder:task]
status: open
assignee: claude (in flight)
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
