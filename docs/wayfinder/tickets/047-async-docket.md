---
title: "Fix: the docket runs synchronously inside /harvest — latency grows with the vault"
labels: [wayfinder:task]
status: open
assignee: claude (in flight)
blocked_by: []
---

## Question

From `docs/eval-2026-08-02-personas.md` (cross-cutting): `/harvest` awaits
`runDocket()` inside the HTTP handler, so opener-minting (one LLM call per
uncited snippet, up to two retries each) and Cover consolidation run before
the client gets a response. Measured: harvests under 20s early in a run grew
to 2+ minutes once the vault had accumulated material.

This contradicts the Clerk's definition in CONTEXT.md — background work that
never makes the user wait (Q-22) — and it gets WORSE the more the tool is
used, which is the opposite of what a quiet background clerk should feel
like. On a multi-month vault it would be unusable.

Fix: the harvest response returns as soon as the snippets are written; the
docket runs after, off the response path. The held index updates when the
run completes (the DocketReport is still the only index source). Same
change at boot: the server should listen immediately and let the boot
docket run behind it — the address is already printed before createApp, but
the app is not actually reachable until the docket finishes.

Constraints: keep the in-process lock so two runs never overlap; log start
and finish (Q-23) so the work stays inspectable; a failed background run
must not corrupt the held index. Note for the Clerk plan (008): its wiki
jobs land in this same path and will multiply the cost — this fix should
land BEFORE that slice executes.
