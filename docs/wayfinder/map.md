---
labels: [wayfinder:map]
title: "Elicit — the build map"
created: 2026-08-01
---

# Elicit — the build map

## Notes

Elicit: local-only agentic elicitation → human-shaped wiki from the user's
verbatim prose. The domain model is CANON in `CONTEXT.md` (36 terms) and
`docs/decisions/elicit.md` (Q-1..Q-39); no ticket re-opens a locked decision
without an explicit escalation. Slice 1 (interview loop) is built; slice 2
("it remembers you") is executing via the approved plan
`docs/superpowers/plans/2026-08-01-it-remembers-you.md`.

Standing preferences for every session working this map:
- Build execution uses `omp -p --auto-approve` subagents (user-approved),
  orchestrated per executing-plans; plans get reviewer rounds before dispatch.
- All inference local: chat `192.168.0.229:8088/v1` (bonsai-27b), embeddings
  `192.168.0.229:11434/v1` (qwen3-embedding / nomic). Never a hosted API.
- Markdown is truth; invariants are enforced in code and tests, not prompts.
- Skills: /grilling + /domain-modeling for design tickets; /writing-plans +
  /executing-plans for build tickets; /research for research tickets.
- Slice hypotheses are checked by Micah's real sessions, recorded in
  RESULTS.md files — record, don't gate.
- Staged mechanisms live in `docs/backlog.md`; tickets absorb them by slice.

Tracker: local markdown (this dir). Tickets in `tickets/NNN-*.md`; claim =
`assignee` field; blocking = `blocked_by` frontmatter list; frontier = open,
unassigned, all blockers closed.

## Decisions so far

- [Fix: resonance honesty](tickets/036-resonance-honesty.md) — README now
  says what the trigram index actually does ("what matches is the phrasing,
  not the meaning"); tests/resonance-paraphrase.test.ts holds the pairs the
  embedding channel must start catching and records today's recall: zero.
- [Fix: activity stream reads as sentences](tickets/038-activity-legibility.md) —
  render-layer formatter; ULIDs stay in the JSONL audit trail, never on the
  reading surface.
- [Fix: resonance honesty](tickets/036-resonance-honesty.md) — README now
  says what the trigram index actually does ("what matches is the phrasing,
  not the meaning"); tests/resonance-paraphrase.test.ts holds the pairs the
  embedding channel must start catching and records today's recall: zero.
- [Fix: activity stream reads as sentences](tickets/038-activity-legibility.md) —
  render-layer formatter; ULIDs stay in the JSONL audit trail, never on the
  reading surface.
- [Fix: resonance honesty](tickets/036-resonance-honesty.md) — README now
  says what the trigram index actually does ("what matches is the phrasing,
  not the meaning"); tests/resonance-paraphrase.test.ts holds the pairs the
  embedding channel must start catching and records today's recall: zero.
- [Fix: activity stream reads as sentences](tickets/038-activity-legibility.md) —
  render-layer formatter; ULIDs stay in the JSONL audit trail, never on the
  reading surface.
- [Adversarial self-eval](../eval-2026-08-02-claude-adversarial.md) (not a
  ticket — a peer Claude session's red-team of the whole app) — found the
  canon-string drift, harvest silent failure, validator gaps, and the
  resonance honesty problem. Tickets 034-037 carry the fixes; the
  canon-conformance test (tests/canon.test.ts) closes the class of bug
  where the test and the implementation share a wrong oracle.

- [Finish slice-2 execution](tickets/001-finish-slice-2.md) — landed green
  through four fix waves; the practice of live-diagnosing Micah's real
  sittings found every load-bearing bug the tests missed.
- [Slice-2 hypothesis check: real sessions and RESULTS](tickets/002-slice2-results.md) —
  invariants 8/8 on real data; composed openers now dominate session
  starts; no template fallback needed; embedding eval (007) waits for
  ~50 snippets.
- [Fix: probe freedom — loosen generation, tighten validation](tickets/031-probe-freedom.md) —
  repertoire prompt + code guards (no-repeat, no conversation-refs);
  real-model verified: four distinct frames, zero echoes.
- [Fix: wire the Cover memory layer](tickets/030-wire-cover.md) —
  ADR-0002 layer 3 live: content-bearing consolidation summaries,
  model-stamped (Q-34), failure-isolated.
- [Grill: the Clerk slice — claim pipeline and contradiction detection](tickets/006-grill-clerk.md) —
  eight decisions locked as Q-28…Q-35: immediate minting, the six-op write
  contract with mechanical Status, the re-measure-gated contradiction
  pipeline, add-only lint, three-tier identity registry, six editing verbs,
  model stamps with lazy re-annotation, shadow-first calibration.
- [Voice input: in-process Parakeet STT for sittings](tickets/018-voice-input.md) —
  shipped: sherpa-onnx child process (omp's stack, omp's model cache) +
  mic → auth-gated /api/transcribe → editable textarea; ratify-by-editing
  preserves Sole Authorship; spoken flag lives on the transcript Turn.

## Fog

- **The outer loop's experience** — re-reading practice, meeting past selves.
  Purpose now LOCKED (Q-27): self-recognition primary; orientation and
  material-mining are side effects. The design still waits for months of real
  claims; when that session comes, it designs FOR drift-watching.
<!-- graduated 2026-08-01: "Emergent outputs beyond essays" → ticket
     "Design the Coach (capability outputs)" after grilling; advice
     constitution locked as Q-24 -->>
- **Wiki-editing UX** — Propagation flow, user-attested claims on screen. The
  mechanics are locked (Q-4, Q-21); the *experience* hangs on the Clerk slice
  producing claims to edit.
- **Selection maturation from usage data** — FSRS as the still-true horizon,
  uptake-as-signal, calibration period. All need weeks of Activity Log and
  queue history before they can be tuned honestly.
- **Model lifecycle** — when bonsai-27b gets upgraded: re-annotation batch jobs
  over reading stamps, prompt re-tuning, whether the null-rate on composed
  questions demands the template-assembly fallback. Hangs on slice-2 RESULTS.
<!-- cleared 2026-08-01: "Vault custody" resolved by grilling → Q-25
     (interface password lock rides slice-2 Task 7; vault stays gitignored;
     backup = user's existing file-backup infra, flagged as their action) -->
<!-- cleared 2026-08-01: "Phone-sized sittings" resolved by grilling -> Q-26
     (second-class supported: LAN browser + password gate + phone-width pass
     riding slice-2 Task 7; no app, no sync, no offline) -->
