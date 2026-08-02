---
title: "Fix: harvester drops episodes and mislabels facet/stance"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

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
