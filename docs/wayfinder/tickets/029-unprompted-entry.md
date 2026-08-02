---
title: "Build: unprompted entry and the defer verb"
labels: [wayfinder:task]
status: closed
assignee: claude
resolution: >
  Landed at 289c227 (Claude subagent, verified independently: 243/243,
  tsc 0, build clean). Provenance gains kind 'unprompted' (empty eliciting
  question by contract); POST /api/unprompted reuses the propose→review→
  decide flow under a fresh session id; "just write" door on the mode
  screen. POST /api/session/:id/defer re-queues with optional modeNeeds
  (time|energy), emits question-deferred distinct from skip, returns the
  next question, consumes no budget (tested). 251-line test file covers
  both flows plus activity events.
blocked_by: []
---

## Question

Two specified user moves have no door in the interface. Audit gap found
2026-08-01.

1. **Unprompted entry.** Provenance lists it as a first-class origin ("or
   unprompted entry") and Seeding allows "the user drops material in
   directly" — but every current path starts with a question. Build: a
   "just write" door on the Desk — a blank Page whose harvest works
   identically (provenance kind: unprompted); pasting pre-written prose
   routes to the same harvest (Cut with approval), covering ad-hoc import
   ahead of the full Seeding slice.
2. **Defer.** Mode says deferring a question to a fitting Mode is a
   first-class move; the exchange offers only skip. Build: a quiet defer
   action — the question returns to the Queue with declared modeNeeds
   (e.g. "when I have more time / energy"), distinct from skip in the
   activity log.
