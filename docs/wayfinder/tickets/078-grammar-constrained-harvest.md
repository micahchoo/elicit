---
title: "Build: grammar-constrained harvest output — the model physically cannot emit a malformed cut list"
labels: [wayfinder:task]
status: open
assignee:
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
