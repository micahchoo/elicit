---
title: "Grill: the Clerk slice - claim pipeline and contradiction detection"
labels: [wayfinder:grilling]
status: closed
assignee: micah
blocked_by: []
resolution: >
  Grilled 2026-08-01, eight questions, all locked in the register:
  Q-28 immediate minting; Q-29 op contract (MINT/UPDATE/MERGE/SUPERSEDE/
  ARCHIVE/KEEP, total sweeps, mechanical Status, log+retry rejects);
  Q-30 contradiction pipeline (candidates → one Q-14 re-measure → open on
  confirmation → ARCHIVE dissolved; ≤2 live cap PROVISIONAL); Q-31 lint
  adds/annotates, never removes; Q-32 identity tiers (add/link/never
  collapse); Q-33 six editing verbs (body edit → user-attested); Q-34 model
  stamps + lazy re-annotation; Q-35 shadow-first graduation. Ticket was
  formally blocked by 002; grilled early on user direction — data-bound
  numbers are marked PROVISIONAL with graduation conditions per Q-35.
  Next: write the Clerk plan (008) once slice-2 RESULTS exist.
---


## Question

Design the Clerk: how readings become Claims (Q-21 anatomy), the propose-ops deterministic executor, synchronic contradiction detection across the lexical+embedding channels, staleness-as-graph lint, identity/alias registry, reading model-stamps, supersede-requires-reason, the calibration period. Absorbs the Clerk section of docs/backlog.md. One question at a time with recommendations.
