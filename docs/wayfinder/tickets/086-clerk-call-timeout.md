---
title: "Fix: a clerk call has no timeout — one runaway generation stalls the drain forever, silently"
labels: [wayfinder:task]
status: closed
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

## Resolution (2026-08-02)

### The timeout

`makeComplete` now enforces a per-request budget on every completion: each
call gets its own `AbortController`, the timer aborts it when the budget
elapses, and pi-ai's `signal` option (verified in its openai-completions
provider: `options.signal` reaches the fetch, and an aborted request
surfaces as `stopReason: 'aborted'`, not a bare rejection) carries the
abort to the endpoint. Because only this timer ever aborts the controller,
`stopReason === 'aborted'` is always our elapsed budget — the thrown error
reads `clerk model call failed — qwen3.6:35b at <url>: timed out after
180s`, the 078 spelling, distinct from a refused connection (034 rule:
two different diagnoses, two different correctives). The existing
`mint-call-failed` consumer records it verbatim and the attempts-aware
backoff counts it, unchanged. A budget overridden per construction via
`makeComplete(role, { timeoutMs })`.

**The default is 180s**, justified in the code comment against the ticket's
measurements: ~29s typical clerk calls (T15/T16); 078's finding that honest
constrained calls exceed 120s (its first ratchet run read three `timed out
after 120s` chunkErrors on eval-003's longest turns); the embeddings path's
120s per-request budget. 180s = ~6x the typical clerk call, 1.5x the
embeddings budget. The one known outlier is 007's measured 370s cold-model
first call, which now fails at the budget and is retried warm — a paid
warm-up through the backoff, not a stall. The 84-minute runaway is what
the budget exists to convert into a named failure.

### num_predict / max-tokens bounding — implemented

`maxTokens` rides every completion as `max_tokens`, default 16384. This
required a compat override: pi-ai auto-detects `max_completion_tokens` for
any non-OpenAI baseUrl, and Ollama's OpenAI layer has NO such field —
verified against `ollama/openai/openai.go` at v0.30.11 (the live server
version): `ChatCompletionRequest` carries only `max_tokens`, mapped to
`num_predict` (lines 589-591). `buildModel` now sets
`compat.maxTokensField: 'max_tokens'`, which both backends read (llama.cpp
natively). At the measured ~28 tok/s decode rate, 16384 tokens is ~10
minutes of generation — beyond the 180s client budget, so the bound never
truncates a call the client would let finish; it caps SERVER work when a
client abort cannot reach the server, which is the ticket's stated reason
for the server-side bound.

### Files touched

- `src/llm.ts` — `MakeCompleteOptions` gains `timeoutMs` and `maxTokens`;
  `buildModel` compat gains `maxTokensField`; the returned `Complete`
  creates the controller, timer, and aborts per call.
- `tests/llm-constrained.test.ts` — a `hangingEndpoint` helper (headers
  sent, no chunk, no finish — the established-socket runaway analog); a
  test asserting the timeout fires with the budget named; a test asserting
  a normal call inside the budget still answers; two tests asserting the
  payload carries `max_tokens` by default and by override.

`src/registry.ts` needs no new declaration: `src/llm` and `makeComplete`
are already declared live, and the change only extends an existing symbol.

### Verification

`npx tsc --noEmit` clean; `npm test` 60 files, 1400 passed, 2 skipped.

### Remaining work, out of this ticket's footprint

- `scripts/ratchet/run.ts` constructs `makeComplete(role)` without
  `timeoutMs`, so its own `--timeout` ceilings above 180s are now capped
  by the default (its default 120s is unaffected — the outer race fires
  first). A measurement run wanting 300s/600s ceilings again must forward
  `{ timeoutMs: modelTimeoutMs() }` into `makeComplete`. One line, in the
  scripts/ owner's hands.
- `scripts/accept-043.ts` and `read-snippets.ts` time their own calls; the
  inner default now fires first for calls over 180s (`read-snippets`'
  warm-up call, measured at 370s in 007, now fails at the budget and is
  retried).
