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
