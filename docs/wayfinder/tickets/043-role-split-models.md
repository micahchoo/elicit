---
title: "Build: split models by role — fast elicitor, careful clerk"
labels: [wayfinder:task]
status: open
assignee: claude
blocked_by: []
---

## Question

Q-48. Today one `Complete` is built in `src/llm.ts` and injected everywhere.
Split it by role:

- **Elicitor role** (foreground, human waiting): `ELICIT_LLM_BASE_URL` /
  `ELICIT_LLM_MODEL`, default bonsai-27b at `http://192.168.0.229:8088/v1`
  (llama.cpp — 3-9s turns).
- **Clerk role** (background, nobody waiting): `ELICIT_CLERK_BASE_URL` /
  `ELICIT_CLERK_MODEL`, default `qwen3.6:35b` at
  `http://192.168.0.229:11434/v1` (Ollama — clean JSON, slower).

Wiring: `startSession` / `userTurn` and the live compose paths take the
elicitor Complete; `propose`/`decide` (harvest), `runDocket` and every wiki
job take the clerk Complete. Both are already injected — this is a
construction-site change at the server boot path, not a refactor of the
modules.

Constraints:
- Both endpoints local, always (ADR-0001).
- Q-34: the model stamp on an artifact must record the model that actually
  produced it, so `modelName` becomes per-role rather than one server-wide
  string. Check every stamp write site.
- If one endpoint is down, the app must degrade honestly (log which role
  failed and why), never silently fall back to the other model — a silent
  swap would corrupt the stamps.
- The ratchet harness (`scripts/ratchet`) should be able to target either
  role.

Open: harvest on qwen3.6:35b did not complete in ~4 min on a 2-turn sitting
during the first (cold) run. Measure warm latency per chunk before trusting
it for long sittings; if it is genuinely that slow, the clerk role may want
the 27B variant (`qwen3.6:27b` is also on the Ollama host).
