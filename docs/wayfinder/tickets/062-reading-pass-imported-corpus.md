---
title: "Build: the reading pass — turn 139 imported snippets into Readings"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: [037-harvest-facet-bias.md]
---

## Question

Ticket 057 landed 139 snippets across 19 dated sittings, 2017-2026. It landed
**no Readings**: the dry run recorded cut TEXT only, so facet, stance and the
reading sentence were not recoverable without the model, and inventing a facet
would be an agent authoring a reading and stamping it under Q-34.

The consequence is that nine years of corpus is **evidence but not wiki**. The
snippets feed resonance and composed openers today — which is the whole reason
a first sitting on an imported corpus differs from one on an empty vault — but
the Clerk mints Claims from Readings (Q-28), and there are none to sweep. No
Claims will appear until something reads them.

This is the only piece of work standing between the import and any of it being
visible, and it had no ticket until now.

### Why it is blocked on 037

The reading pass is a model run over 139 snippets, and its output is exactly
what 037 is measuring and fixing. Running it against today's harvester would
spend an hour producing readings with the known facet bias baked in, and Q-34's
lazy re-annotation would then re-read them one docket sweep at a time rather
than all at once. Cheaper to wait for the fix than to fix the output.

The plan records the same ordering for its own RESULTS run: *"the RESULTS run
should be done after they land, or its claim-quality numbers measure the
harvester, not the Clerk."*

### Shape

- A script under `scripts/`, not a server route. It runs once, over a known
  set, and its cost (~139 model calls) belongs in a terminal rather than behind
  a request.
- **Cites the snippet it read**, `snippetId@version` — the reading is about
  that snippet and nothing else.
- **Stamped** with the clerk model and `at` (Q-34), so a later upgrade can
  re-read it lazily and subtract the drift.
- **Idempotent**: a snippet that already has a reading is skipped, so the run
  can be interrupted. 139 calls at ~40s is over an hour; assume it will be.
- Runs the same extraction path the sitting harvest uses. This material gets no
  exemption — the point of the import was that it goes through the front door.

### What to watch

76 of the 139 snippets are the capstone, sharing one session. Under Q-50 nothing
drawn from them reaches `evidenced` alone, so the first Clerk run over this
corpus will show a wall of `unconfirmed`. **That is the vocabulary working, not
failing.** Do not loosen the rule to make the numbers look better.

## Acceptance

- Every one of the 139 snippets has exactly one Reading citing it.
- Re-running the script produces no second reading for any snippet.
- Every Reading carries the clerk model stamp and an `at`.
- A docket run after the pass mints Claims, and the report says how many.
- The facet distribution across the 139 is reported — it is the first
  independent check on whether 037's fix held on real prose.

## Operating notes, from the agent that built it (2026-08-02)

Five things not learnable from reading `scripts/read-snippets.ts`:

1. **The first live run used OLDER logic than the file now holds.** The
   empty-result retry (`totals.emptyResults`, retry-before-fallback) was added
   *after* the run started. The snippets it left unread are **interrogatives** —
   "Is there some sort of way that the project itself fails…" — where the model
   returns `cuts: []` for a bare question. **A second `--apply` retries exactly
   those**; idempotency means it touches nothing else. If they come back empty
   again that is the honest finding rather than a bug: the harvest prompt
   extracts propositions, and a few of Micah's keeps are questions.
2. **`--verify` scopes by session prefix `post-`, not by the number 139.** A
   reading from a live sitting can never confuse it — but a future post import
   silently enlarges the denominator and makes verify FAIL until that import is
   read too.
3. **`--verify` asserts the cite is `id@<current version>`.** If anyone ever
   calls `saveVersion` on an imported snippet, verify starts failing on readings
   that were correct the day they were written. Deliberate; will look like a
   regression.
4. **`propose()` swallows a dead endpoint into `diagnostics.chunkErrors` and
   returns an empty proposal list** — so from the outside, a refused connection
   and a snippet the model declined to cut are indistinguishable. This is why
   the retry-vs-fallback branch keys on `chunkErrors` rather than on emptiness.
   **Keep that distinction if you touch it.** It is the same shape as eval
   finding #8 and as ticket 007's inert threshold: silence that means two
   different things.
5. **`[direct]` in the log marks the fallback path**, expected on about four
   snippets — the ones opening on a lowercase letter, which 037's
   `startsMidSentence` router sends to Buds. It skips that router and nothing
   else.

## Resolution (2026-08-02) — vault commit `69a209a`

**136 of 139.** One Reading per snippet, citing `snippetId@version`, stamped
`qwen3.6:35b`.

```
facet    fact 30.9  construct 20.6  episode 18.4  general-event 11.0
         intention 7.4  value 5.1  causal-theory 4.4  lifetime-period 2.2
stance   avowal 68.4  report-of-fact 17.6  self-observation 8.8
         uncertainty-marked 3.7  superseded 0.7  pole-preference 0.7
```

**037's episode fix partly generalises.** 6% before, 30% on the twelve turns it
was tuned against, **18.4% across nine years of several registers**.

**Three unread, and it is a finding.** All three are INTERROGATIVES, and the
harvest prompt extracts propositions, which a bare question is not. Fifteen
returned empty on the first attempt; the retry recovered twelve.

**`episodeAnchoredTurns: 0` across all 136** — confirming ticket 066's
prediction at corpus scale. Not one turn in nine years anchors an episode with
a calendar word; they anchor by EVENT. The shadow record for 037's episode fix
has been measuring a denominator of zero. Moves ticket 069 from a plausible
concern to a measured fact.
