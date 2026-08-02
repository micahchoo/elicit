---
title: "Build: grammar-constrained harvest output — the model physically cannot emit a malformed cut list"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 2)
blocked_by: []
---

## Question

From the codex comparative review (research-codex-lessons.md, lesson 4).
The harvester carries a JSON parser with a line-oriented fallback
(src/harvester/harvester.ts#parseChunk) because the local model drifts,
plus the parseMode diagnostics that keep the failure modes visible (034).
Codex removes the whole class at the source: apply_patch is constrained by
a real grammar at generation time, so a malformed patch cannot be emitted.

Both of elicit's backends support this: llama.cpp exposes GBNF grammars
and Ollama exposes structured outputs through the same OpenAI-compatible
endpoint the app already calls (192.168.0.229:11434/v1). Constrain the
cuts payload's SHAPE at generation. The verbatim-substring property cannot
be grammar-enforced — the substring gate stays exactly where it is; only
the parse layer changes.

Discipline: this is a prompt-adjacent change to measured machinery, so it
goes through the ratchet harness (scripts/ratchet) against the current
SYSTEM_PROMPT baseline before anything is deleted. If constrained output
holds parse rate at 100% across the ratchet corpus, the line-oriented
fallback and its parseMode='line-oriented'/'failed' branches become dead
code — delete them and simplify the diagnostics accordingly (034's
"parser failed vs genuinely thin" distinction survives via the API error
path, which grammar constraint does not remove).

Adjacent, same seam, cheap: the fake responder (src/fake-responder.ts)
could record the prompts it receives, wiremock-style, so tests can assert
on what was SENT to the model, not only on what came back — the ratchet
and the 044-acceptance class of bug ("ran on the elicitor while printing
the clerk model's name", found by 066) both want that assertion.

Acceptance: ratchet run recorded before/after; parse rate and cut quality
at or above baseline; fallback parser deleted only after the measurement
says so; a test asserts the request carries the grammar/format field.

## Resolution (2026-08-02)

Closed by the measurement, which is what the discipline demands: the
fallback parser was deleted only after the constrained ratchet run held
parse rate at 100% across the corpus.

### One field-name correction to the ticket's premise

Ollama's OpenAI-compatible `/v1/chat/completions` **drops the bare `format`
field** and maps `response_format` onto the native grammar instead. Verified
three ways: empirically against the clerk endpoint (unconstrained output with
`format`, schema-shaped output with `response_format`), against Ollama
v0.30.11's `server/openai.go` (only `ResponseFormat` is read; the request
struct has no `format` field), and through streaming (pi-ai sends
`stream: true`; `response_format` holds under streaming). The ticket's
"format field" is the native `/api/chat` spelling; the app calls `/v1`, so
`response_format` is the field that works through the existing completion
path. Implemented accordingly.

### The constraint

- `src/llm.ts`: `makeComplete(role, { responseFormat })` — an opt-in
  construction option, off by default, so the fake responder path and every
  existing caller are untouched. The field is injected through pi-ai's
  `onPayload` hook (runs after `buildParams`, before the fetch) — the same
  completion path, no fork.
- `src/harvester/harvester.ts`: `CUTS_RESPONSE_FORMAT` — a strict JSON
  schema with the facet/stance enums taken from the same sets `propose()`
  validates against, `sourceTurn` pinned to `enum: [0]`, and
  `additionalProperties: false` at every level. A STANCE value in the facet
  field (the defect this file's header measures) is now physically
  unemittable.
- `scripts/ratchet/run.ts`: `--constrained` (built-in schema) and
  `--schema <path>` (custom schema file) flags; `--timeout <seconds>`;
  per-exchange and aggregate `parseRate` / `returnedParseRate` / `chunkErrors`
  metrics. `compare.ts` mirrors the shapes and rejects a parse-rate
  regression.

### The measurement (clerk role, qwen3.6:35b, real endpoint)

| metric | baseline (unconstrained) | constrained |
|---|---|---|
| parseRate | 1.0 (9/9 chunks) | **1.0 (9/9 chunks)** |
| returnedParseRate | 1.0 | 1.0 |
| fabricationRate | 0 | 0 |
| totalCuts | 39 | 45 |
| meanProposalCount | 12.67 | 15 |
| easy-facet fraction | 0.474 | 0.422 |
| parseModes | all json | all json |

Comparator verdict: **keep** — no regressions; yield up, easy-facet bias
fraction down. Raw artifacts: `docs/wayfinder/ratchet/078-baseline.json` and
`078-constrained.json`.

Measurement note: the first baseline run capped each call at 120s and read
0.667 parse rate — but the three "failed" chunks were `timed out after 120s`
on eval-003's longest turns, not parse failures. Grammar-constrained
generation is slower than unconstrained, so the constrained run needed the
same fairness: both runs were remeasured at a 300s/600s ceiling (made
configurable via `--timeout`), and both hit 1.0. The timeout-vs-parse
distinction is why the ratchet now reports `chunkErrors` and
`returnedParseRate` separately from `parseRate`.

### The deletion

`parseLineOriented` and every `parseMode='line-oriented'` branch are gone
from `src/harvester/harvester.ts`; `ParseMode` narrows to `'json' |
'failed'`. `'failed'` survives because it is still reachable when the
option is off (the fake/scripted paths, truncation) and because
`scripts/read-snippets.ts` (out of scope here) compares against it — the
034 "parser failed vs genuinely thin" distinction stays intact, exactly as
the ticket's parenthetical required. The verbatim-substring gate is
untouched, as scoped: a schema can constrain shape, not substringhood.

### Tests

- `tests/llm-constrained.test.ts` — asserts the request body carries
  `response_format` (via a loopback capture endpoint), that it is absent
  without the option, and that a caller-supplied schema passes through
  unchanged.
- `tests/fake-responder.test.ts` — the fake responder now records every
  call (`system`, `turns`, `opts`) on a `.calls` array; asserts what was
  SENT to the model, including that `propose()` sends `SYSTEM_PROMPT`.
- `tests/harvester.test.ts` — the old "falls back to line-oriented
  parsing" test now asserts the new contract: a non-JSON payload reads as
  `failed`, no rescue.
- `tests/ratchet.test.ts` — fixture shapes updated; new verdict test for
  parse-rate regression.

Verification: `npx tsc --noEmit` clean for the touched files (remaining
errors are pre-existing, in files owned by concurrent agents); `npm test`
57 files, 1362 passed, 2 skipped.

Remaining work, explicitly out of this ticket's footprint: wire
`makeComplete('clerk', { responseFormat: CUTS_RESPONSE_FORMAT })` in
`src/server.ts` (owned by a concurrent agent) so production harvest runs
constrained; and `scripts/accept-044-047.ts` / `read-snippets.ts` could
optionally adopt the constrained complete for their real-model runs.
