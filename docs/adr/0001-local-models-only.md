# Local models only

The agent runs exclusively on local inference. No elicitation turn, honing
pass, or harvest proposal ever transits a hosted LLM API. The Wiki models a
person's beliefs, contradictions, and fears — the most sensitive document its
owner will hold — and the privacy boundary must be the machine, not a
provider's terms of service.

## Considered Options

- Frontier API (best elicitation quality, intimate material transits a provider)
- Tiered routing by Protocol sensitivity (moot once everything is local)
- Local only (chosen)

## Consequences

- The elicitation-quality ceiling is set by local model capability. Protocols
  must be designed and tested against local models, not frontier ones.
- The first-slice hypothesis becomes "agentic elicitation with local models
  produces Snippets worth keeping" — the honest form of the test.
- The pi harness must target a local inference endpoint (e.g. an
  OpenAI-compatible local server).
- No sensitivity field is needed in the Protocol schema for routing; if this
  decision is ever revisited, that field is the migration path.


## Model change 2026-08-02

Default model switched from `bonsai-27b` (llama.cpp, `192.168.0.229:8088/v1`)
to **`qwen3.6:35b` on Ollama (`192.168.0.229:11434/v1`)** — the same host that
already serves embeddings (Q-17). The decision this ADR records is unchanged:
all inference is local, no hosted API, ever. Only the endpoint and weights
moved.

Consequences to watch, per Q-34 (model stamps + lazy re-annotation):
- Artifacts written before this date carry the old model stamp; they are NOT
  re-annotated in bulk — the wiki's history must record drift in the person,
  not a discontinuity from an upgrade day.
- The adversarial eval's finding #1 (instruction-following collapse on long
  payloads) was measured on the OLD model. Chunked harvest (ticket 034) makes
  the app robust either way, but the bisection should be re-run before any
  claim that the new model does not share the failure.
- First observation: `qwen3.6:35b` returns clean JSON on the harvest prompt
  and is noticeably SLOWER per call than llama.cpp's bonsai-27b. Chunked
  harvest multiplies call count by user-turn count, so end-of-sitting harvest
  latency is the thing to watch.
