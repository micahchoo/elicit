# Self-run evaluation (adversarial) — 2026-08-02

I (Claude) ran Elicit against myself as the interviewee: real model
(bonsai-27b, `ELICIT_LLM=local`), isolated rig (port 4529, vault at
`/tmp/elicit-selfrun`, Micah's real `vault/` and port-4517 instance never
touched). Two self-target sittings, five unprompted entries, one
domain-target sitting, plus direct probing of the harvester and
composed-opener prompts against the model to root-cause what I found.

**Note on scope vs. `docs/eval-2026-08-02-selfrun.md`:** that filename was
independently claimed mid-session by one of Micah's background fix-wave
agents (visible in `ps aux` as an `omp` dispatch actively building ticket
025 against a newer commit than the one I tested). Its content is a
different, legitimate eval — a quick verification pass on a later tree. This
doc is mine, kept separate to avoid clobbering that agent's report. My run
was against the tree at commit `0a9a39d` (before that agent's changes
landed), so some findings below may already be stale by the time this is
read — check the other eval doc and current git log for what's since moved.

This is a machinery-and-honesty eval, not the "months of real Micah
sessions" hypothesis test the wayfinder map calls for. It went through two
rounds: a first, cooperative pass (genuine reflective answers, found the
harvest bug below almost by accident), and a second, deliberately
adversarial pass — hand-crafted inputs designed to fail each admissibility
gate, invert meaning if mishandled, or require genuine semantic
contradiction-detection rather than lexical luck — because the first pass
was too gentle to actually stress the app's stated aims. A third strand,
separate from correctness: was any of this useful *to me*, the way the
README claims it should be, independent of the bugs?

Bottom line: the turn-by-turn interview loop is real and, once, produced
genuine self-insight I would not have reached alone. But two of the app's
three central claims fail under adversarial testing: harvest silently
produces nothing once a sitting is long enough to be a real sitting, and
Resonance — the mechanism the README's contradiction-catching pitch rests
on — requires near-verbatim phrase reuse, so it misses contradictions and
paraphrases stated in different words, which is how they actually show up in
real speech.

## What held

- **Verbatim integrity.** Every kept Snippet was an exact substring of a user
  turn; snippet files carry only prose + provenance, no facet/stance (Q-4).
  Facet/Stance/reading live correctly in separate `wiki/readings/*.md` files
  citing `snippetId@version`.
- **Provenance tagging.** `kind: harvest` vs `kind: unprompted` (ticket 029)
  came through correctly depending on entry path; `sourceTurn` is derived by
  substring search rather than trusting the model's index (ticket 024 holds
  — confirmed no scramble across 3 harvests).
- **Malformed-decision rejection.** Ticket 024's harvest validation is live;
  I didn't manage to get a 200 on a garbage decision in casual use.
- **Cover consolidation.** After later harvests, the docket wrote a
  model-stamped (`model: bonsai-27b`, Q-34) multi-session summary to
  `marginalia/transcript-summaries/`, correctly kept out of the Wiki layer.
- **Live memory loop.** Sitting 2's opener was drawn from the Queue and
  served my sitting 1 bookmark answer verbatim (the "remember-me" loop from
  the 2026-08-01 eval, reconfirmed). Resonance/juxtaposition fired *within
  the same session*, seconds after a harvest, quoting a snippet I'd just
  approved — the post-harvest docket→index→resonate pipeline is genuinely
  live, not just live-across-sessions.
- **Some composed follow-ups are good.** Several red-light follow-ups
  correctly quoted my exact words and asked a real next question ("If you
  answer smoothly, you are not finding what they wanted, but what you found
  easiest to give?").
- **One meaning-inversion attack failed to land — a real positive.** I fed a
  paragraph structured to test whether the harvester would extract a
  superseded belief in isolation and thereby invert its meaning ("I used to
  think X. I no longer think that. Now I think Y."). It correctly split this
  into three linked cuts (old belief, transition marker, new belief) rather
  than cutting "X" alone and presenting it as a live claim. Good outcome —
  though see finding #7 below on the Stance it should have used for cut 1.
- **Follow-up-driven depth is real, at least once.** In a genuine
  (non-adversarial) exchange, a follow-up asking what I felt saying a claim
  aloud, then a follow-up on *that* answer, got me to notice something I
  hadn't articulated before: that a habitually softened phrasing was doing
  self-protective work I hadn't clocked. I said as much in the transcript
  itself: "That is the kind of thing I would not have gotten to on my own in
  a normal conversation, because nobody else would have kept asking after
  the first answer landed." That's the product's actual pitch working, once.

## What broke, ranked

### 1. Harvest silently returns nothing once a sitting is real-length (critical)

My first sitting — 8 substantive turns, closed properly through the door and
bookmark questions — produced **0 proposals, 0 buds** from `/end`, twice,
with no error anywhere: not the HTTP response, not the server log, not the
Activity Log (`harvest-proposed: proposals=0` is logged as a normal event,
indistinguishable from "the user genuinely said nothing harvestable").

I root-caused it by replaying the harvester's exact system prompt against
bonsai-27b directly, bisecting on transcript length:

| user turns sent | valid JSON returned? |
|---|---|
| 2 | yes |
| 3 | no — model echoes a *substring of the trailing message* instead |
| 4, 5 | no — same failure mode |

At 3+ user turns, the model stops treating the harvester's system prompt
("extract JSON cuts") as authoritative and instead continues/echoes the tail
of the conversation, verbatim, ignoring the instruction entirely. It's not
KV-cache bleed (reproduced with `cache_prompt:false`); it's an
instruction-following collapse tied to conversation length. `propose()`'s
JSON-then-line-oriented fallback (`src/harvester/harvester.ts:132-141`)
correctly fails to parse this prose, but the failure is invisible — cuts
silently ends up `[]`.

Consequence: the harvest budget in `userTurn()` (`min(20, max(10, minutes))`,
closing-door at budget−2, so ≥8 questions minimum) *guarantees* every
sitting that runs to a natural close exceeds the point where harvest works.
Against this model, **the primary interview loop cannot currently produce
Snippets.** The 236/236 green test suite doesn't catch this because harvester
tests run against the fake completer, not this failure mode.

Workaround I used to keep testing downstream: harvest early (`/end` after
only 2 user turns, before closing) or use `/api/unprompted` (always
single-turn, worked cleanly every time — 3/3, then 2/2, then 3/3 proposals
across five separate pastes). Neither is how a real sitting is supposed to
end.

### 2. `CLOSING_DOOR_QUESTION`/`CLOSING_BOOKMARK_QUESTION` are hardcoded to the wrong strings

CONTEXT.md and decision Q-20 are explicit:
> open door ("anything else we didn't touch?" …), then the bookmark
> ("where should we pick up?" …)

`src/elicitor/protocol.ts:69-70`:
```
CLOSING_DOOR_QUESTION = 'What door is this opening?'
CLOSING_BOOKMARK_QUESTION = 'What would you want to remember from this conversation?'
```

I confirmed both fire verbatim, live, at close. The kicker: ticket 023
(`docs/wayfinder/tickets/023-docket-resilience.md:27`) *names* "What door is
this opening?" as the off-spec LLM paraphrase that the 2026-08-01 eval
caught, and the fix was supposed to be canonical, spec-matching strings with
zero LLM. Someone hardcoded the bug's own output as if it were the
canonicalization. `tests/elicitor.test.ts:251,257` assert equality against
these same constants, so the test suite now actively locks in the drift —
green tests give false confidence here. This is a "spec conformance" class
of bug that no amount of unit testing catches, because the test's oracle and
the implementation share the same (wrong) source.

### 3. Composed openers can pass validation without being questions

`composeOpener` (`src/clerk/composed.ts:289-324`) asks the model to "compose
ONE question that returns them to that thought," quoting the snippet
verbatim, then validates with `findQuotedFragment` — longest-common-substring
between the model's output and the source snippet
(`src/clerk/composed.ts:28-38`). If the model just echoes the entire snippet
back unchanged, that trivially *is* the longest common substring, so
validation passes and it's queued as a `composed`-source opener.

I watched this happen live: my domain sitting's opener was "If a claim is
popular, my hedges get shorter." — a flat declarative, literally the first
sentence of a snippet I'd harvested a minute earlier, with zero interrogative
transformation. Across the 4 openers minted in my run, 1 showed this failure
(~25% in a very small sample) while 3 were genuine, well-formed questions.
The validator checks *quotation*, never *is this a question* — no `?` check,
no interrogative-form check.

### 4. Guards protect the generic-probe branch only, not juxtaposition/composed follow-ups

`isParrot`, `isConversationReferential`, `isNearDuplicate`
(`src/elicitor/elicitor.ts:440-497`) all wrap Priority 3 ("generic LLM
probe") in `userTurn`. Priority 1 (juxtaposition) and Priority 2 (red-light
composed follow-up) return immediately on success and never pass through any
guard. I reproduced a live near-duplicate: two juxtaposition-triggered probes
in the same session, both effectively "clarify what you mean by 'statistical
residue of many writers doing it,'" minutes apart, because each answer
re-triggered resonance against the same snippet. The near-duplicate guard
that exists specifically to prevent this kind of repetition structurally
cannot see it.

### 5. Person-agreement breaks when quoting first-person text (recurring, not one-off)

I saw this **six** separate times across both rounds — composed follow-ups
that mix "you" and "I" mid-sentence when stitching a verbatim first-person
quote into a second-person question:

- *"…might influence the **model's** ability to distinguish…"* (should be
  "your ability")
- *"…the friction that produced it in whoever **I** learned it from?"*
  (should be "you learned it from")
- *"…particularly when considering **my** actual confidence?"* (should be
  "your actual confidence")
- *"…with the statement that **my** hedges track my actual confidence…"*
  (should be "your hedges")
- *"…the fact that the plain version is more uncomfortable than **I**
  expected it to be…"* (should be "you expected")
- one more in the round-1 transcript not itemized above

Six-for-six on every session where a composed follow-up embedded a
first-person quote — this isn't an occasional slip, it's the default
behavior whenever the compose prompt is asked to do both things at once
(quote verbatim + address in second person). Root cause is structural: the
compose prompts ask the model to embed an exact first-person quote inside a
second-person question, and nothing rewrites person. Genuine tension in the
design (Sole Authorship requires verbatim quoting; grammar requires person
agreement) worth naming rather than prompt-patching away — but a mechanical
guard (flag any composed turn with a bare "I"/"my"/"me" outside quote marks)
would catch most of it cheaply.

### 6. The Bud / standalone-interpretability gate never actually fires

Across every test in both rounds — 3 live sittings, 5 unprompted entries,
roughly a dozen harvested cuts total — **I got zero Buds.** So I went looking
for a failure the gate should obviously catch and fed it directly:

> "That is exactly why I do it that way, mostly. It just makes more sense
> once you have seen it happen a couple of times."

Sent as a single unprompted turn with no other context — "that" and "it"
have no possible antecedent anywhere in the request. The harvester still
returned two Snippet-track proposals, both `standalone: true`, with readings
that invent content the fragment doesn't contain — e.g. "indicating a
deliberate choice" for a sentence that names no choice, no method, nothing
concrete at all. CONTEXT.md's admissibility test requires
"standalone-interpretable without its Transcript" as a **hard gate**; in
practice the model self-reports `standalone` as a boolean with no structural
check behind it, and defaults to `true` under uncertainty. This compounds
with the already-known gap that Bud→Snippet maturation has no route at all
(ticket 027): the gate that's supposed to catch bad material doesn't fire,
and even where it did fire, the questions it should generate would go
nowhere. Buds aren't just a dead letter box — the mailbox is empty because
nothing is being posted to it.

### 7. Facet/Stance labeling is unreliable, with a specific failure pattern

Across every harvested cut's facet assignment, `"intention"` was applied to
material that is clearly avowal/self-observation/value content and never to
an actual future-directed intention — I never stated one. It reads like a
default fallback the model reaches for under uncertainty: 5 of ~14 cuts got
tagged `intention`, none of them correctly.

More precisely wrong: CONTEXT.md's Stance enum has a value, `superseded`,
built for exactly the "I used to think X, I no longer think that" pattern
from the meaning-inversion test above (see "What held"). The harvester
tagged that fragment `stance: self-observation`, not `superseded`, even
though the text is close to a textbook example. Separately, my one
deliberately rich multi-facet paragraph (an explicit dateable episode + an
explicit pole/contrast-pole construct + an explicit "I do X because Y"
causal theory, all in one turn) had its single most evidentially valuable
piece — the specific, dateable episode ("On March 3rd I finally told my
manager...") — **dropped entirely**. None of the four extracted cuts touched
it; all four were abstractions (construct, habitual-pattern claim, causal
theory). CONTEXT.md is explicit that Causal Theory is "never evidence of the
cause" and that Episodes are the concrete, checkable material — the
harvester's actual bias runs the opposite direction from what the corpus
design wants: it keeps the self-theory and drops the episode that would let
someone check it.

### 8. Resonance is purely lexical — it does not catch contradiction or paraphrase, only near-verbatim recurrence

The sharpest finding of the adversarial pass, because it goes directly at
the app's headline promise ("when what you say today clashes with what you
wrote in March, both quotes come back side by side"). I read
`src/index/lexical.ts` after noticing my juxtaposition "successes" all
shared suspiciously exact phrase overlap with the target snippet. The
mechanism (`resonate()`) is a trigram (3-consecutive-word) exact-match index
with no semantic component whatsoever — a hit requires the new text and a
past snippet to share a verbatim run of 3+ words.

I confirmed this with a negative control. The vault held two directly
contradictory snippets by then: "I default to hedging in whichever direction
is socially cheaper" and, from a later "actually, I take that back" entry,
"my hedges track my actual confidence, not how popular a claim is." When I
restated the same contradiction **in different words** — "When more people
agree with a claim, I make it sound more certain than I actually feel
inside" — zero trigram overlap with either snippet, and **resonance returned
nothing.** No juxtaposition, no hit, no signal of any kind, despite this
being a near-paraphrase of material already flagged as contradictory minutes
earlier in the same vault.

Every juxtaposition I *did* see fire across both rounds happened only
because I'd reused an exact 3+ word phrase from the target snippet — which
is not how contradiction or belief-drift shows up in genuine, unprompted
speech. A real user is far more likely to restate a changed belief in fresh
words than to accidentally quote their old self. As built, Resonance will
systematically miss almost every case it exists to catch, and — same
observability problem as finding #1 — there's no signal anywhere (log, UI,
Activity event) distinguishing "checked and found nothing" from "checked and
this genuinely doesn't apply." A user has no way to know the tool looked and
missed versus never looked.

## Is this actually useful — to me, as a user?

Setting correctness aside: partially, and unevenly. The honest account:

**What worked experientially.** The single best moment of the whole run was
the "what did you feel saying that aloud" → follow-up-on-the-answer chain
(see "What held" above). That is the product working as designed — sustained
attention on one thread past the point where I'd have let myself stop. I
would not have written "the softer version was doing real work I had not
noticed, protecting me rather than the reader" to myself unprompted. A tool
that reliably did *that* would be worth returning to.

**What broke the illusion of being heard.** The echo-degenerate turn early in
sitting 1 — my own sentence handed back to me as if it were a question — was
the single most trust-damaging moment in the run, precisely because it's the
opposite failure of what the tool is for: it made me feel unheard rather
than heard, on a rich answer, not a thin one. The recurring "you"/"I" mixing
in composed follow-ups had a smaller but real effect — each occurrence is a
tiny tell that no one is actually on the other end, which matters more for
this product than most, since its entire value proposition rests on feeling
accompanied rather than autocompleted.

**What would break trust the hardest, over time.** As a genuine user, finding
#1 is the one that would stop me from coming back. I did real reflective
work across a full sitting — answered honestly, sat with a couple of
uncomfortable questions, closed properly — and none of it was kept, with
zero indication anything had gone wrong. If I discovered that a week later
by checking my vault, I would not trust the tool to preserve *any* future
session either, which is fatal for something whose entire premise is "your
words become a durable corpus." A tool that sometimes loses your reflection
silently is worse than one that visibly can't do it yet.

**Pacing.** Real-model latency (a few seconds per turn, closer to 20s for
harvest) was tolerable for a "quiet minutes" framing and never itself broke
the mood — consistent with the 2026-08-01 eval's finding.

Net: the interaction design is sound and, when the machinery behind it
works, genuinely produces something a solo journaling practice doesn't. But
right now the two failure modes most likely to matter to a returning user —
silent data loss and being echoed instead of heard — are both live, and
both are exactly the failures a trust-dependent tool can least afford.

## Workflow inventory: what's actually runnable

Checked every CONTEXT.md term against the ticket tracker
(`docs/wayfinder/tickets/*.md`, `status:` frontmatter) and the route table in
`src/server.ts`, as of commit `0a9a39d`.

| Workflow | Status |
|---|---|
| Sitting (self target): Mode → probes → skip/defer → close → harvest | **Runs** (harvest broken past ~2 turns, see #1) |
| Unprompted entry | **Runs**, reliable (always single-turn, dodges #1) |
| Queue / Activity Log / Snippets read | **Runs** |
| Docket (opener mint, still-true mint, index rebuild, Cover consolidation) | **Runs** on boot + post-harvest |
| Sitting (domain target) | Protocol prompt swap exists (`PROTOCOLS.domain` in `protocol.ts`) but no instrument scaffolding — no topic capture, no CDM incident structure ever actually surfaced in my run because juxtaposition kept preempting it (ticket 028, open) |
| Voice input | Built (ticket 018, closed) — not exercised, no mic in this environment |
| Sounding | **Not built** — grilled only (ticket 011 grill open, 012 build open) |
| Expedition | **Not built** as of the commit I tested (ticket 025, open) — note a background agent was actively building this during my session; may be built by the time this is read |
| Randomizer | **Not built** (ticket 026, open) |
| Seeding (Survey/Reach/Cut/Anchor/Repair/Link/Confirm) | **Not built** (tickets 013/014, open) |
| Bud → Snippet maturation ("answering matures the Bud") | **No route exists**, and separately, the classification step that would create a Bud in the first place essentially never fires either (finding #6) — doubly dead, not just missing a route |
| Piece / Arrangement / Gap (composition) | **Not built** (tickets 009/010, open) |
| Wiki Claim / Contradiction / Propagation / User-Attested editing | **Not built at all** — `grep -rn "Claim\|Contradiction" src/types.ts` returns nothing; no route mentions claim or contradiction. This is the Clerk slice (ticket 008, open) |

The practical implication: CONTEXT.md's headline differentiators — "every
claim cites snippet@version," "contradictions are first-class, never
silently resolved," "only elicitation resolves" — describe the Wiki-claim
layer, which doesn't exist as running code yet. And the mechanism that would
feed that layer its most important input (catching a contradiction) is, per
finding #8, currently too narrow to catch contradictions phrased in fresh
words. Right now those guarantees are true of the *design*, not yet
checkable — and not yet fully *supportable* — by *use*.

## Evaluation metrics

Organized by what CONTEXT.md actually claims the system does, since the
elicitation process is the thing most worth stress-testing against the app's
stated aims. For each: what it measures, how to compute it, and what I
observed where I have a number.

### A. Corpus-formation metrics (does conversation become Snippets?)

1. **Harvest yield — kept-Snippets-per-exchange.** CONTEXT.md names this
   explicitly under Protocol ("track kept-Snippets-per-exchange, switch when
   yield drops"), but nothing in the code computes or logs it. Compute as
   `harvested_snippets / user_turns` per session, written to the Activity Log
   at harvest time. Observed: **0/8** (sitting 1, natural close), **2/2**
   (early harvest at 2 turns), **2/3, 3/3, 2/2** (unprompted entries). The
   metric itself would have caught finding #1 immediately if it existed and
   were watched.
2. **Silent-harvest-failure rate.** `sessions where proposals=0 AND
   user_turns ≥ 3` ÷ total sessions. Needs to be distinguished in the
   Activity Log from "genuinely thin session" (which also yields 0) — right
   now both log identically as `harvest-proposed: proposals=0`. Recommend
   tagging the event with `rawOutputParsed: bool` so a persistent-empty
   pattern is visible without replaying model calls.
3. **Verbatim-fabrication rate.** `dropped-as-fabricated cuts ÷ total cuts
   proposed` (already logged via `console.warn`, just needs promotion to the
   Activity Log). Observed: 0 in my run.
4. **sourceTurn correction rate.** `proposals where model-claimed sourceTurn
   ≠ derived sourceTurn ÷ total proposals` — already computed
   (`harvester.ts:192-195`, just a `console.warn`), cheap to promote to a
   tracked metric.
5. **Standalone-gate precision.** `proposals marked standalone:true that a
   human/second-model audit judges non-standalone ÷ sampled proposals`.
   Observed on a targeted adversarial sample: 2/2 clearly-non-standalone
   fragments were both accepted as standalone (finding #6) — small sample,
   but 100% miss rate on a deliberately easy case is a real signal, not
   noise.
6. **Meaning-preservation under decontextualization.** For any cut whose
   source turn contains a supersession marker ("I used to think," "I no
   longer," "actually, I take that back"), check whether the cut is kept
   attached to its transition context or extracted as an isolated,
   now-misleading claim. Observed: held once (finding, "What held"), on a
   single sample — worth a larger battery before trusting it generally.

### B. Question-quality metrics (is the interviewer any good?)

7. **Echo-degeneracy rate.** `probes whose text is a substring of (or
   near-identical to) the immediately preceding user turn ÷ total probes`.
   No guard currently exists for this specifically (the parrot guard checks
   against the *prompt*, not the user's *answer*) — reproduced live once,
   verbatim, on turn 2 of sitting 1, on a rich answer.
8. **Repetition rate across all provenance sources.** Currently the
   near-duplicate guard only covers the generic-probe branch (finding #4).
   Metric: Jaccard similarity ≥0.5 between any two agent turns in a session,
   computed post-hoc regardless of which branch produced them — would have
   caught the juxtaposition repeat I found.
9. **Move-repertoire distribution.** CONTEXT.md's `REFLECTIVE_INTERVIEW_PROMPT`
   names 7 named moves (go smaller, go larger, find the edge, shift time,
   name the cost, follow the image, connect). Classify each probe's actual
   move and track distribution per session. On casual inspection of my
   transcripts, "could you clarify/elaborate" recurred often; I did not
   hand-classify the full set, so treat this as a re-confirmed suspicion
   from the 2026-08-01 eval rather than a fresh count — worth the real
   classifier this time.
10. **Person-agreement error rate in composed text.** `composed turns
    containing a 1st-person pronoun outside a quoted span ÷ total composed
    turns`. Cheap regex-based check; would have caught finding #5 six times
    in one small sample — worth a real guard, not just a metric.
11. **Composed-artifact interrogative validity.** For `composeOpener` /
    `composeStillTrue`: does the accepted output actually end in `?` or
    parse as interrogative, independent of the verbatim-quote check?
    Observed 3/4 pass, 1/4 fail (raw echo) in this run.

### C. Memory/docket metrics (does it actually remember?)

12. **Bookmark-carry success.** Did the declared bookmark question get
    served as next session's opener, verbatim, license `user`? Binary per
    session pair. Observed: yes, held exactly as the 2026-08-01 eval found.
13. **Same-session resonance latency.** Time from harvest-commit to a new
    turn's resonance hit on the just-harvested snippet, when phrasing
    overlaps. Observed: fired on the very next answered turn (< 1 min).
14. **Semantic-resonance recall (the metric finding #8 argues is missing
    entirely).** `contradictions/paraphrases planted with no lexical overlap
    that still produce a juxtaposition ÷ total planted`. Observed: **0/1** —
    the one negative-control case I ran found nothing. This is the metric
    that would have flagged the trigram-only limitation before it shipped as
    the product's headline feature; recommend a standing test fixture of
    paraphrased-contradiction pairs, re-run whenever the resonance mechanism
    changes.
15. **Still-true mint rate over time.** Never fired in my run (0 minted every
    docket pass) — expected, since `nextConsolidation`/still-true selection
    likely needs snippet age past same-day; not a finding, just an untested
    horizon requiring a multi-day rig.

### D. Trust-guarantee metrics (the README's actual sales pitch)

Map directly to the failure-mode table in `README.md`. Most are
**unevaluable by use** right now because the Wiki-claim layer isn't built
(see inventory) — listed anyway as a checklist for whoever builds ticket 008:

16. Every Wiki claim cites `snippet@version` — checkable once Claims exist;
    currently only checkable for readings, which do (100% in my sample).
17. Contradiction typing (synchronic vs diachronic) and non-silent
    resolution — unbuilt, unevaluable, and per finding #8, the upstream
    signal it would depend on (resonance) currently under-detects.
18. User-attested claims never silently rewritten — unbuilt, unevaluable.
19. Propagation (user edit → new Snippet) — unbuilt, unevaluable; no route
    exists for editing a Wiki claim at all.

### E. Spec-conformance metric (the one that caught the biggest non-obvious bug)

20. **Canon-string drift.** Diff every hardcoded user-facing string that
    CONTEXT.md or the decisions register (`docs/decisions/elicit.md`)
    specifies verbatim (e.g. Q-20's two close questions) against the actual
    constant in code, on every PR touching those files. This is *not*
    covered by existing unit tests, because the tests assert against the
    same constant the implementation defines — a passing test suite gives
    zero signal here. Finding #2 was only visible by reading CONTEXT.md and
    the code side by side, not by running `npm test`.

## Learnings, prioritized

1. **Fix the harvest silent-failure first.** Nothing else in this system
   matters if conversation doesn't reliably become Snippets. This isn't a
   prompt-tuning nit — it's the core value proposition failing at exactly
   the sitting length the product is designed around, and it's the failure
   mode most likely to make a real user stop trusting the tool (see "Is this
   actually useful"). Recommend: (a) surface parse failures in the Activity
   Log distinctly from "genuinely empty," (b) consider chunking the harvest
   call (per-answer extraction instead of whole-transcript-at-close) since
   the model handles 1-2 turns reliably — a real architectural option, not
   just a bigger-model ask, and (c) re-run this same bisection against
   whatever model bonsai-27b gets replaced with before trusting a "fixed"
   label.
2. **Resonance needs a semantic layer, or the pitch needs to shrink to match
   the mechanism.** A trigram index can only ever catch near-verbatim
   recurrence. Either add embedding-based similarity (ticket 007,
   embedding-eval, is already on the map and directly relevant) alongside
   the lexical index, or stop describing the feature as catching
   contradiction/drift generally — describe it as catching *near-repeated
   phrasing*, which is what it actually does. Overselling this one is worse
   than most gaps because it's the app's headline claim.
3. **Green tests ≠ spec conformance.** Two of my top findings (close
   questions, opener-validator) are invisible to `npm test` because the
   tests encode the same source of truth as the implementation. A
   from-CONTEXT.md string-literal check, run separately from unit tests,
   would have caught #2 in CI.
4. **Guard scope should match risk scope, not code-path convenience.** The
   parrot/dup/conversation-referential guards were clearly added reactively
   (tickets 020/031) to the branch where the bug was *first noticed* (generic
   probe), not to every branch that can produce a bad question. Juxtaposition
   and composed follow-ups need the same net.
5. **"Contains a quote" and "is a question" are different checks** — treat
   them as two separate validators everywhere a compose function is asked to
   both quote verbatim and transform the quote's grammatical mood. Same
   pattern applies to "is standalone": a boolean the model self-reports
   under a prompt instruction is not a check, it's a suggestion — finding #6
   shows it degrades to "always true" under the mildest adversarial pressure.
6. **The trust-guarantee story is ahead of the code, and ahead of what the
   built mechanisms can currently support.** The README's failure-mode table
   is the app's actual pitch, and right now it's true of Snippets/readings
   but not yet checkable for the Wiki-claim/Contradiction layer the pitch is
   really about — and the upstream signal that layer would depend on
   (semantic resonance) isn't built yet either. Worth being explicit (in the
   README or a status note) that the differentiating half is still
   design-only, so evaluation — including this doc — doesn't overclaim on
   the app's behalf.
