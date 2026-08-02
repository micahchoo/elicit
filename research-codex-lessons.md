# Elicit ↔ Codex: a comparative review

> Produced 2026-08-02 by a peer session mapping this repo against a clone of
> OpenAI's codex at /tmp/codex-review. Kept verbatim below the fold. What it
> fed on the map: amendments to tickets
> [075](docs/wayfinder/tickets/075-docket-has-no-next-run.md) (claimable
> deferral record, succeeded-no-output outcome),
> [074](docs/wayfinder/tickets/074-resolved-referent-annotation.md) (typed
> fragment markers) and
> [015](docs/wayfinder/tickets/015-queue-maturation.md) (usage stamps start
> now); new tickets
> [076](docs/wayfinder/tickets/076-docket-git-diff-gate.md) (git-diff docket
> gate + index cursor),
> [077](docs/wayfinder/tickets/077-mechanism-exposure-registry.md)
> (live | shadow | unwired registry),
> [078](docs/wayfinder/tickets/078-grammar-constrained-harvest.md) (GBNF
> harvest output) and
> [079](docs/wayfinder/tickets/079-twice-rejected-floor.md) (the emitted
> twice-rejected probe, verified at src/elicitor/elicitor.ts:388-396).

## The two shapes

The comparison is instructive precisely because the two harnesses invert each
other. In codex, the model is the driver: it decides what to do next, and 1.2M
lines of Rust exist to constrain, sandbox, persist, and observe what it
decides. In elicit, the code is the driver: the priority ladder in elicitor.ts
decides what happens next, and the model is a subordinate composer whose every
output passes a structural gate before it reaches anyone. Codex builds fences
around an agent; elicit builds an agenda and lets a model fill in phrasing.
That inversion determines which codex subsystems have analogs, and it means
the best lessons are mechanisms, not architecture.

## Subsystem correspondence

| Elicit | Codex | Nature of the analogy |
|---|---|---|
| Elicitor sitting loop | core turn loop (submission_loop → SessionTask → run_turn) | Both are the one place that sequences a conversation; codex's is model-driven with steering, elicit's is code-driven with a ladder |
| Docket (src/clerk/docket.ts) | Memories pipeline (codex-rs/memories/) + state DB | Near-twins: background extraction → consolidation, triggered by session events, no cron |
| Vault (markdown-as-truth) | Rollout JSONL + SQLite as rebuildable index | Same doctrine — one source of truth, derived indexes you can delete |
| Guards / harvest gates / ClerkOp union | Sandboxing, approvals, execpolicy | Same goal (least privilege), opposite mechanism: elicit removes powers at the type level, codex confines them at runtime |
| src/protocols/defs/*.md | collaboration-mode-templates/ (default.md, plan.md, …) | Genuinely the same idea: modes as markdown data, not enums |
| Cover (src/memory/cover.ts) | Compaction (compact.rs, checkpoint replay) | Both summarize history under a token bound; both preserve raw user words preferentially |
| Canon tests, ratchet, emitted-kinds sweep | Schema drift tests, execpolicy inline self-tests, wiremock request capture | Both repos treat "spec and code drifting apart" as a first-class bug with mechanical detection |
| Activity log JSONL + format.ts renderer | OTEL dual targets (log_only vs trace_safe) | Same split: full-fidelity audit trail vs a redacted surface |

No elicit analog exists for: sandboxing/exec/PTY, apply-patch, MCP,
hooks/plugins/extensions, the multi-frontend protocol seam, auth/OAuth, cloud
tasks, code-mode. No codex analog exists for: the randomizer's architecturally
enforced model-freedom, the verbatim-substring harvest gate, the contradiction
pipeline, shadow mode as a standing pattern, or the ratchet harness.

## Lessons that transfer — ranked by what they touch on elicit's frontier

1. **Ticket 075 ("left for the next run promises a run that nothing
   schedules") — codex already solved this exact problem, without a cron.**
   The memories pipeline (codex-rs/memories/README.md) triggers on session
   start, then applies eligibility rules to decide what to work on: within an
   age window, idle long enough, not already claimed by an in-flight worker,
   bounded work per startup. Failed jobs are marked with retry backoff in the
   state DB, and — critically — deferred work is a persisted, claimable
   record, not an intention held in memory. Elicit's docket re-derives work
   from disk (good, crash-safe), but "left for the next run" is currently a
   promise with no promisee. The transferable shape: write the deferral to
   disk as a record the next boot/harvest-triggered run claims. That is
   record-don't-gate, elicit's own idiom. Also worth stealing verbatim:
   `succeeded_no_output` as an outcome distinct from `failed` — the same
   "found nothing vs mechanism broken" distinction elicit's lint tests
   already enforce, extended to every docket job.

2. **Docket latency that grows with the vault — the watermark/cursor
   pattern.** Codex keeps JSONL as truth and mirrors it into SQLite with a
   log-follower cursor (next_rollout_byte_offset in codex-rs/state/), plus
   read-repair when the mirror is stale (rollout/src/recorder.rs:305-702).
   Full rebuild remains the repair path; incremental is the fast path.
   Elicit rebuilds every index from scratch each docket run. And there is a
   second, more elegant gate elicit is uniquely positioned to adopt: phase 2
   of codex's memories pipeline runs its expensive consolidation agent only
   if the git workspace diff is non-empty — "git dirtiness decides whether an
   agent needs to run." Elicit's vault became a git repo with per-run commits
   under Q-61. The diff since the last docket commit is sitting right there
   as a free, exact answer to "which wiki jobs have any work."

3. **The "wiring, not signatures" defect class — make exposure a declared
   state.** Three built-and-tested mechanisms were verified reaching nothing:
   semantic resonance (ticket 068), computeYield, cover(). Codex has a
   structural countermeasure for this class: ToolExposure
   (tools/src/tool_executor.rs:14-36) is an explicit enum — Direct | Deferred
   | DirectModelOnly | Hidden — so a capability that exists but isn't
   surfaced is a declared state, enumerable and testable, never an accident
   of missing call sites. Elicit already built exactly the right scanner for
   a sibling problem: tests/emitted-kinds.ts sweeps the tree so an event kind
   can't exist unrendered. Generalize it: a mechanism registry where each
   exported subsystem declares live | shadow | unwired, and a test
   cross-checks declared status against actual call sites. unwired entries
   would then be visible debt with a name, and ticket 068 could never have
   gone unnoticed as long as it did.

4. **Grammar-constrained generation could delete the fallback-parser
   class.** Codex constrains apply_patch with a real Lark grammar
   (ToolSpec::Freeform, handlers/apply_patch_spec.rs) rather than a JSON
   schema, and intercepts heredoc invocations with a tree-sitter query — the
   model physically cannot emit a malformed patch. Elicit's harvester carries
   a JSON parser with a line-oriented fallback because the local model
   drifts. But both of elicit's backends support generation-time constraint:
   llama.cpp has GBNF grammars and Ollama has structured outputs. The
   verbatim-substring property can't be grammar-enforced (the gate stays),
   but the shape can — one grammar, and the fallback parser plus its
   counter-instrumented failure modes become dead code.

5. **Injected context should be self-identifying — relevant to tickets
   073/074.** Codex wraps every fragment it injects into a prompt in typed
   markers (ContextualUserFragment, context-fragments/src/fragment.rs:
   fragments render as `<marker>body</marker>`), so any later code can
   distinguish injected harness text from conversation textually, without a
   parallel bookkeeping structure. As elicit starts sending snippets plus
   antecedent-context windows to the clerk model (073) and asking for
   resolved-referent annotations (074), marker-wrapping each injected piece
   gives the same guarantee elicit already insists on elsewhere: a
   mechanical, greppable boundary between the person's prose and everything
   else.

6. **The fogged "selection maturation from usage data" has a concrete schema
   in codex.** Phase-2 memory selection ranks by usage_count, then
   most-recent last_usage/generated_at, with a max_unused_days eligibility
   window and a fallback so fresh never-used items still qualify. That is a
   minimal, working answer to "which remembered things deserve consolidation
   attention," and it tells elicit exactly what to start logging now — usage
   stamps on claims and snippets when they're surfaced — so the FSRS-horizon
   tuning has honest data when its session comes.

7. **One sharp edge, and codex resolves the same tension the other way.**
   When a composed question fails the guard twice and the fallback draw is
   empty, the twice-rejected text is emitted anyway (elicitor.ts:388-396,
   verified 2026-08-02). Codex's uniform stance is default-deny on a broken
   path: an approval whose channel drops resolves to Abort, a stream that
   ends without response.completed is an error, never a silent success.
   Elicit's "never block the sitting" value is right for its domain — but the
   floor beneath a failed fallback could be a fixed protocol-probe constant
   rather than text the guards just rejected twice. The degradation ladder's
   own principle (Q-55: a composed floor beats a bad draw) argues for this.

## What deliberately does not transfer

Naming these matters as much as the lessons. The protocol seam (SQ/EQ, three
client tiers, macro-generated JSON-RPC) exists because codex serves a TUI, an
exec CLI, IDE extensions, and remote clients from one core; elicit has one
vanilla web UI and would be buying pure ceremony. The sandboxing stack exists
because codex's model executes arbitrary commands; elicit's model executes
nothing — its ClerkOp union with no status member achieves at compile time
what seatbelt and bubblewrap achieve at runtime, and it's the cheaper and
stronger version for an action space that small. Config layering (nine
precedence levels, admin requirements) serves fleets and enterprises; elicit
is one person on loopback. Compaction solves context windows that sittings,
being short and bounded, never hit. Adopting any of these would be
over-engineering with someone else's constraints.

## Where elicit is ahead

Two of elicit's mechanisms have no codex equivalent and codex shows the cost
of their absence. Codex's best architecture document (docs/protocol_v1.md)
carries a disclaimer that it may not match the code — and indeed it describes
ops that no longer exist; both mapping agents found stale prompt files and a
stale justfile recipe. Elicit's canon tests read CONTEXT.md and the decision
table from disk at test time, so spec drift fails CI instead of accumulating
disclaimers. And elicit's ratchet harness — real model, real transcript
snapshots, mechanical keep-or-revert on fabrication and echo rates — is
prompt-change regression testing that codex, for all 909 test files, does not
have; its prompts change on vibes plus code review. The one codex testing
idea worth importing back is small: wiremock's ResponseMock captures outbound
requests so tests assert on what was sent to the model, not only what came
back — elicit's fake responder could record prompts for the same style of
assertion.
