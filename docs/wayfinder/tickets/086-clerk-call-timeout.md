---
title: "Fix: a clerk call has no timeout — one runaway generation stalls the drain forever, silently"
labels: [wayfinder:task]
status: open
assignee: claude (omp wave 5)
blocked_by: []
---

## Question

Measured live during the T16 RESULTS drain, 2026-08-02. At 20:00:43 UTC a
docket run clipped its mint quota (`clipped=72`) and began sweeping. One
mint call then ran for **84+ minutes** against a measured per-call time of
~29s — GPU pegged at 100%, an ESTABLISHED socket to the clerk endpoint,
zero activity-log lines, zero console lines. The model (qwen3.6:35b on a
262144-token runner with `--context-shift`) had entered runaway
generation, and nothing on our side ever gives up: the embeddings path
has a 120s per-request timeout and a 300s job budget, but the clerk
`complete()` path has NO timeout at all. The drain — restart-proof
against process death (075) — is defenseless against a call that never
returns.

Recovery required manually unloading the model (`docker exec ollama
ollama stop qwen3.6:35b`) so the fetch would fail into the
`mint-call-failed` path that already exists and already backs off (Q-29).
The failure machinery is fine; it just never gets invoked when the
failure mode is "still generating".

Build: a per-request timeout on the clerk completion path (the 078 ratchet
work added `--timeout` to the measurement harness for exactly this reason
— the same distinction, timeout-vs-parse, applies in production). On
timeout: abort the request, log the reading's failure with a
`timed out after Ns` detail distinct from a refused connection (034 rule
— two different diagnoses, two different correctives), count it into the
attempts-aware backoff. The budget must cover honest slow calls with
margin: T15/T16 measured ~29s typical; grammar-constrained generation is
slower (078's measurement); embeddings chose 120s. Justify the number in
a comment against those measurements.

Also worth a look under the same ticket: whether `num_predict` (or the
runner's max-generation bound) should ride every clerk request, so a
degenerate loop is bounded server-side too, not only client-side.

Acceptance: a test with a never-resolving fake `complete` shows the sweep
recording the timeout failure and the run finishing; the timeout detail
names the elapsed budget; suite green. RESULTS (T16) records tonight's
stall as the motivating measurement.
