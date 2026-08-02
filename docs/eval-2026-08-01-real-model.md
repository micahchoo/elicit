# Real-model evaluation — 2026-08-01

Two sittings against bonsai-27b, run by the agent in an isolated worktree
(commit fcb16df, port 4599, throwaway vault). Session 1: 10 turns + skip +
close + harvest. Session 2: memory-loop test against the 3 harvested
snippets. This is a MACHINERY eval — the slice-2 hypothesis (RESULTS.md)
still requires Micah's genuine sittings.

## What held

- **Q-1 verbatim invariant**: all 5 harvest cuts were exact substrings of
  the transcript. The code-enforced check works under the real model.
- **Q-20 close mechanics**: closing-door fired at budget−2, bookmark next,
  bookmark answer became a `user-declared` queue entry (`license: user`),
  and session 2's opening draw served it first. The remember-me loop's
  user-declared arm works end to end.
- **Auth lifecycle**: setup → gate-on → wrong-pw 401 → cookie session;
  `.auth.json` written 0600. All correct.
- **Retry machinery**: composed follow-ups that failed the Q-12 echo were
  retried then nulled, with log lines. Red-light phrases not present in the
  turn were dropped. Both guards observable in the server log.
- **Probe quality at its best**: 2 of 8 probes were genuinely good
  (ladder-down "what specific action or outcome would count", integrative
  cross-turn synthesis in session 2).

## What broke (ranked)

1. **Docket dies post-harvest → memory loop disabled.** `composeOpener`
   builds a prompt with no user-role message; llama.cpp's chat template
   400s (`Jinja: No user query found in messages`); llm.ts throws;
   `runDocket` has no per-job isolation, so the run dies after
   `index-rebuilt`. Consequences: openers/still-true never mint, the
   harvest route 500s AFTER writing snippets, and the server keeps the
   stale pre-harvest index — so resonance/juxtaposition silently never
   fire (confirmed: an exact 3-content-word echo of a stored snippet
   produced no hit, because the live index still had 0 snippets).
   → ticket 023.
2. **Echo-degenerate probes: 2 of 8.** Turns 3 and 8 returned my own
   answer verbatim as the "question" — on the richest turns, not thin
   ones. The echo also poisons provenance downstream (the next exchange's
   stored question is the echoed answer). → ticket 020 (guard, in flight).
3. **Provenance scramble in harvest.** `sourceTurn` is model-emitted and
   trusted; cuts carried the wrong question (gravestone question stamped
   onto a generosity/avoidance answer). Fix: derive sourceTurn by exact
   substring search of the transcript — deterministic. Also: duplicate
   proposals ([0]≡[4]) not deduped. → ticket 024.
4. **Internal labels leak into questions.** "Given the concern about
   abstraction-no-episode…" (red-light taxonomy) and "What door is this
   opening?" (phase name riff). → 020's parrot guard family + 023's
   deterministic closes.
5. **Close questions are off-spec.** Q-20 fixes the two close moves;
   the model paraphrased them into different questions ("what would you
   want to remember" ≠ "where should we pick up"). Fix: the two close
   questions are CANONICAL STRINGS, zero LLM. → ticket 023.
6. **Harvest decisions endpoint accepts garbage silently.** Malformed
   decisions ({index, action:"keep"}) → `continue` per item → success-empty
   response. Must 400 on unknown action or out-of-range index. → ticket 024.
7. **Clarify-frame monoculture.** 5 of 8 probes were "could you
   clarify/elaborate what you mean by X". Anchoring works (Q-12 quotes
   present); deepening does not. → ticket 020 (move library, in flight).

## Latency (bonsai-27b, n_ctx 16384)

Turn round-trips 3–9s (red-lights + compose + probe); /end proposal
generation ~20s; opening draw <1s (no LLM). Tolerable for a quiet
interface; worth a "thinking" state in the UI eventually.

## Also observed

- Bank draw quality confirmed ticket 021: skip drew `'What colour do you
  want your gravestone?` — leading junk, straight from the report's class.
- The user-declared bookmark is served verbatim as the opener. Honest v1;
  whether it should be re-framed as a question is a design question for
  the Clerk grill, not a bug.
