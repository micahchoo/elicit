---
title: "Task: git init the vault — tamper-evident history, not backup"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review.

ADR-0003 separates code from corpus correctly and the vault stays gitignored
from the code repo. That is about the CODE repo. A repo INSIDE the vault is a
different thing: Snippet immutability and append-only transcripts are
app-level invariants today, enforced by the code that also writes them. A repo
makes them tamper-evident and diffable by something that is not the app.

This is history, not backup — it does not answer the standing risk that the
vault has no offsite copy (ticket 017, declined 2026-08-02, still declined).
It does mean a bad write is visible and revertible.

Decide and build: whether the docket commits (one commit per run, message from
the DocketReport) or whether it is a manual habit; `.gitignore` inside the
vault for the derived index and the vector cache (Q-3 — derived, disposable);
and what happens when the working tree is dirty at boot.
