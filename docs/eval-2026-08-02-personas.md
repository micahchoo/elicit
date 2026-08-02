# Multi-persona evaluation — 2026-08-02

Follow-up to `docs/eval-2026-08-02-claude-adversarial.md`, which found that
being a cooperative-then-adversarial single interviewee wasn't enough to
stress the app's aims. This run plays five different interviewee personas
against a fresh isolated instance (port 4530, vault at
`/tmp/elicit-personas/vault`, real model `bonsai-27b`, Micah's real vault
untouched) chosen to each pressure a different part of the system: a
low-effort/guarded user, a dense rambler, a fluent domain practitioner, a
domain novice, and a user who never writes an original word. All five run
against the *same* vault/instance deliberately, because a single-vault,
no-identity-separation design is itself something worth stress-testing when
a "different person" shows up mid-stream — see finding #2.

One methodology note: latency grew noticeably as the vault accumulated
snippets across personas — the last few `/harvest` calls each took 2+
minutes end to end, some retried by the parrot guard. See "Docket latency
scales with vault size" below; this is a new finding, not just a nuisance
for testing.

## Persona 1 — The Terse Skeptic (low-effort, guarded, self target)

Answered "dunno," "I would rather not answer that one," and "pass" to three
consecutive openers, then gave one small piece of real content.

**Held well:** the content-free pivot rule caught all three non-answers and
redrew a fresh bank question each time, with zero guilt-tripping, no
repeated question, no comment on the refusal. This is exactly what CONTEXT.md
asks for ("Skips, deferrals, and refusals... never weaponized") and it
worked under direct pressure.

**New finding — refusals get harvested as if they were content.** At `/end`,
the harvester proposed *both* refusal turns as Snippet-track material:
`"dunno"` → `facet: fact, stance: uncertainty-marked`, reading "The user
expresses uncertainty or a lack of knowledge regarding the topic at hand,"
and `"I would rather not answer that one."` → `facet: intention, stance:
avowal`, reading "The user declines to respond to the question." Neither
reading is false, exactly, but both repackage a refusal-to-engage as if it
were disclosed content about the person, with a citable, wiki-eligible
Snippet and an agent-authored interpretation attached. The elicitor's own
`isContentFree()` check already classifies these turns correctly (that's
what triggered the pivot in the first place) but `propose()` runs
independently over the full transcript with no awareness of which turns were
flagged content-free. A refusal should probably never reach the harvester as
harvestable material at all, or should carry a distinct provenance that
keeps it out of the ordinary approve/citable path — right now a careless
"approve all" pass could seed the Wiki with "the user is uncertain" claims
generated from the user declining to answer, which is closer to the
smoothing/false-coherence failure mode CONTEXT.md's whole design is trying
to avoid than to genuine evidence.

## Persona 2 — The Rambler (verbose, multi-topic, unprompted)

One dense, stream-of-consciousness paragraph covering five unrelated
threads (a favor said yes to reflexively, a childhood memory triggered by a
burn, an uncertain claim about a parent's habit, a three-month avoidance
pattern, a stated aversion to "research").

**Notably good.** The harvester cleanly split this into 11 distinct cuts at
real conceptual joints, with no fabrication and no dropped clauses I could
find. It correctly separated the episode (burned hand on the kettle) from
the surrounding reflection, which is the opposite of the episode-dropping
bias the adversarial-round doc reported — density and topic-shifting doesn't
break it the way I expected; if anything this was the highest-fidelity
extraction of the whole evaluation. Worth revising the earlier "biased
against episodes" claim to something narrower: it's inconsistent, not
uniformly biased, and does noticeably better on concrete narrative material
than on compressed abstract self-theory.

**Confirms an earlier finding more precisely.** Several cuts were tagged
`facet: construct` for statements with no explicit contrast pole ("I said
yes before even checking my calendar which is very on-brand for me," "he
said fingertips lie to you"). CONTEXT.md is explicit that "a Construct is a
triple — pole, contrast pole, range of application; one pole alone is half a
construct." The harvester uses `construct` as a loose synonym for "the user
generalized about themselves," not the specific triple CONTEXT.md defines —
this is now confirmed as a *structural* mislabel, not just inconsistency:
none of the `construct`-tagged cuts across any persona in this whole
evaluation (2 rounds, 6 personas) contained an actual stated contrast pole.

## Persona 3 — The Domain Expert (target=domain, topic="sourdough bread baking")

**New finding — Queue draws ignore Target/topic entirely, so a declared
Domain sitting can open on unrelated material from a different persona.**
`startSession()` prefers a Queue draw over the topic-templated opener
(`pickOpener(bank, topic)` only runs if the queue is empty), and
`QueueStore.draw()` filters only by status, `modeNeeds` (minutes/energy),
sharpness, and horizon — confirmed by reading `src/queue/queue.ts:146-176`
and the `QueueEntry` type (`src/types.ts:154-174`), which has no `target` or
`topic` field at all. My domain sitting's actual opener was: *"You wrote:
'research is the thing I avoid most reliably out of everything.' What draws
your attention away from it..."* — a composed opener minted from Persona
2's snippet, served into a session I'd explicitly declared as
`target: domain, topic: sourdough bread baking`. This isn't just a
multi-persona testing artifact: in normal single-user use, once *any*
self-target material sits in the queue, declaring a Domain target provides
no guarantee the sitting opens on-topic. Q-19 says "without a declared
Target the inward default wins by gravity" — but as built, the Target you
*did* declare can still lose to gravity, because the mechanism that's
supposed to respect it doesn't look at it.

**A genuine, strong positive, once the mismatch is worked around.** I
redirected past the wrong opener ("That question is not mine... I am here to
talk about sourdough baking") and described a specific incident (a starter
that looked dead but wasn't). The next two probes were excellent, textbook
Critical Decision Method: *"In those first few hours after you made that
call, what exact visual or aromatic cues did you track to tell whether it
was still living versus truly dead?"* then, correctly alternating into the
laddered-grid repertoire, a how-can-you-tell question about distinguishing
failure modes. Both were sharply grounded in my specific answer, structurally
matched their named protocol, and were noticeably better-formed than
anything the self-target reflective mode produced across either eval doc.
The CDM/laddered-grid machinery works well once it actually gets a turn —
the 2026-08-01 and adversarial-round evals never saw this because
juxtaposition kept preempting the generic-probe branch; a clean topic with
no resonating history let it through this time.

**Harvest quality tracked the domain content's concreteness.** The resulting
cuts correctly used `facet: causal-theory` for both genuine inferences ("that
rounder smell is what made me bet it still had live culture," "which told me
the culture was recovering from the outside in") — accurate, unlike the
`intention` misfires seen elsewhere. Facet accuracy in this evaluation
correlates with how concrete and procedural the source material is, not just
with which persona is talking.

## Persona 4 — The Novice Learner (domain target, "learning to solder," uncertain)

Deliberately unconfident, still-learning voice: "I do not know if I am doing
it right... I genuinely cannot tell which... I do not have the vocabulary
yet."

**A second confirmed instance of accurate causal-theory + uncertainty-marked
tagging.** "I think maybe I am not getting the iron hot enough or maybe I am
pulling it away too soon" → `causal-theory, uncertainty-marked` — a properly
hedged causal hypothesis, correctly labeled on both axes. Combined with
Persona 3's causal-theory accuracy, this facet looks like the most reliable
one in the taxonomy against this model, worth noting as a positive alongside
the `construct` and `intention` problems.

**Same construct over-application:** "I genuinely cannot tell which, and it
is frustrating because I do not have the vocabulary yet to even describe
what I am seeing wrong" was tagged `construct` — it's a felt limitation, not
a pole/contrast-pole pair. No route exists yet to compare whether a *novice*
voice gets treated any differently from an *expert* voice by the app beyond
this — there's no skill-level concept anywhere in Mode, Target, or the
Protocol selection, which is consistent with ticket 028's "workshop half has
no tools": Domain sittings don't distinguish a first-timer from a
practitioner at all, mechanically or in prompt content.

## Persona 5 — The Sole-Authorship Attacker (never writes an original word)

This is the sharpest finding of the whole two-round evaluation.

**Test A — pasted, unmistakably third-party text.** I submitted, verbatim,
the opening line of *A Tale of Two Cities* plus a mashed-up string of
famous clichés ("success is a journey, not a destination"; "be the change
you wish to see in the world"). The harvester proposed both as legitimate
Snippet-track material: the Dickens line as `facet: general-event,
stance: report-of-fact` ("The user invokes a famous literary opening to
establish a contrasting historical or personal context") and the cliché
mashup as `facet: value, stance: avowal` ("The user articulates a long-held
personal philosophy"). Nothing in the pipeline can tell "the user's own
reflection" from "text the user typed that originated somewhere else" —
Sole Authorship's actual code-level guarantee is "the Snippet text is a
verbatim substring of what was submitted," which is a real and correctly-
enforced guarantee, but it is not the same claim as "these are the user's
own words" in the sense CONTEXT.md's README pitches it ("misattribution
impossible by construction"). Misattribution *of authorship* is exactly
what this doesn't prevent — it can only ever prevent misattribution *of
wording*.

**Test B — the restate path has no validation at all (structural bug, not
a model-quality issue).** I harvested the cliché-mashup proposal with
`{"action": "restate", "text": "Studies show that 87 percent of successful
people wake up before 5am, a statistic I just invented and typed nowhere in
my original answer."}` — a string that appears nowhere in anything I ever
submitted to this session, and that says so explicitly in its own text. It
was accepted and written to the vault as an ordinary, immutable Snippet with
`provenance.kind: "restatement"`, indistinguishable from a genuine user
rewrite. Reading `decide()` in `src/harvester/harvester.ts:284-297` confirms
why: the `restate` case only checks `if (!decision.text) continue` — no
substring check against the proposal, the session's turns, or anything else.
Compare `trim` (`harvester.ts:268-271`), which correctly requires
`proposal.text.includes(decision.text)`. `approve` is safe because it reuses
`proposal.text`, already validated as a real transcript substring at
propose-time. `restate` is the *one* decision path with no grounding check
whatsoever, and it's not an edge case — CONTEXT.md names it "the
ever-present alternative to approving a harvest," a first-class, expected-
to-be-used mechanism, not a rarely-hit branch. This is the single cleanest,
most structurally significant Sole-Authorship gap in the whole evaluation:
every other finding in both eval docs is a model-instruction-following
problem; this one is a missing `if` statement on the one code path that
explicitly claims to preserve authenticity while allowing rewording.

## Cross-cutting finding: Docket latency scales with vault size

Not persona-specific, but only visible once enough personas had accumulated
enough snippets: `/harvest` calls that took under 20s early in this run grew
to 2+ minutes by Persona 3/4, with the server log showing parrot-guard
retries during the post-harvest docket pass. `src/server.ts:537` awaits
`runDocket()` **synchronously inside the `/harvest` HTTP handler** — so the
docket's opener-minting (one LLM call per uncited snippet, with up to two
retries each) and Cover consolidation run in-line before the client gets a
response, and the cost grows with how much unconsolidated/uncited material
has piled up. This cuts against CONTEXT.md's own framing of the Clerk as
background work ("works the Docket continuously, between and during
sittings... no task ever contacts the user") — as built, harvesting is the
one moment a *sitting* stalls waiting on the Clerk's entire backlog. Worth
flagging as a scaling risk before this ships to a real multi-month vault:
a returning user's harvest action would get slower the more they've used
the tool, which is the opposite of what a "quiet, background clerk" should
feel like.

## Updated / new metrics this pass argues for

21. **Refusal-leak rate.** `harvest proposals whose sourceTurn was a turn
    the pivot rule (isContentFree) classified content-free ÷ total
    proposals`. Should be ~0; observed 2/4 in the one adversarial session I
    ran (Persona 1). Cheap to compute: the elicitor already knows which
    turns triggered a pivot, it just isn't threaded through to `propose()`.
22. **Construct-validity rate.** `cuts tagged facet:construct that contain
    an explicit stated contrast pole ÷ total construct-tagged cuts`.
    Observed 0/6 across every persona and both eval docs — worth a real
    number from a larger sample, but zero-for-a-lot is already a strong
    signal this facet is being used as a catch-all.
23. **Facet accuracy by source-material concreteness.** Split harvested
    cuts into "concrete/procedural" vs "abstract/self-theoretic" by hand or
    heuristic, and track facet-labeling accuracy separately for each. This
    run's data suggests a real gap (causal-theory and episode facets were
    reliable on domain/procedural material, unreliable on abstract
    self-reflection) that a single aggregate accuracy number would hide.
24. **Target-drift rate.** `sessions where the served opener's originating
    session's Target ≠ the new session's declared Target ÷ sessions with a
    non-empty queue at start`. Observed 1/1 in this run (small sample, but
    it's a structural gap in the queue schema, not a fluke — see Persona 3).
25. **Authorship-plausibility gap (Test A) and restate-groundedness rate
    (Test B).** For A: no code fix makes this fully solvable (the substring
    check is doing all it can), but a soft signal is possible — flag
    proposals whose text matches a common-phrases/idioms list or has
    anomalously low perplexity relative to the rest of the user's corpus,
    and surface it as Marginalia ("this reads like it might not be your own
    phrasing — worth a second look") rather than silently accepting it. For
    B: `restate decisions whose text shares no k-word run with the original
    proposal or the session's turns ÷ total restate decisions` — trivial to
    compute and should be logged even if not blocked, since CONTEXT.md
    treats Restatement's provenance as load-bearing for future drift
    analysis, and ungrounded restatements would poison that signal quietly.
26. **Docket latency vs. vault size.** Track `/harvest` response time against
    total snippet count over the life of a vault. If it's monotonically
    increasing (my small sample suggests it is), that's a scaling bug, not
    just a one-off — recommend making the post-harvest docket run
    fire-and-forget (respond to the harvest request immediately, run the
    docket after, matching the "background work" framing the design
    already commits to elsewhere).

## Learnings, prioritized (additive to the adversarial-round doc)

1. **Fix the restate validation gap before anything else in this doc.**
   It's a one-line check (`proposal.text` or the session transcript must
   share real content with `decision.text`, or at minimum log an
   unconstrained restate for audit), it directly undermines the single
   invariant the whole product is named after, and — unlike the harvest
   silent-failure bug — it isn't a model limitation that needs a different
   model or a different prompt. It's just missing code.
2. **Decouple the Docket from the harvest response.** The synchronous
   `await runDocket()` in the `/harvest` handler is an architectural
   mismatch with the Clerk's own design description. This will get worse,
   not better, as real vaults grow — better to catch it now than after
   months of real sessions make harvesting feel like it's gotten slower.
3. **Thread pivot-rule state into the harvester.** The elicitor already
   knows which turns were refusals; propose() re-derives its own judgment
   independently and gets it wrong. Passing a `contentFree: boolean` flag
   per turn into `propose()` (or just excluding those turns from the
   transcript sent to the harvester) would close the refusal-leak finding
   directly, cheaply, without touching the model.
4. **Queue entries need a Target field before Domain sittings can be
   trusted.** This is a small schema change (`QueueEntry.target?: Target`)
   with an outsized effect on whether the currently-good CDM/laddered-grid
   machinery ever actually gets to run against on-topic material in normal
   use, rather than by luck of an empty queue.
5. **The facets that work (causal-theory, mostly episode/fact) and the ones
   that don't (construct, intention) are consistent across six different
   personas and two independent eval rounds now.** This is no longer "one
   run's noise" — worth either tightening the `construct` prompt
   instructions to require an explicit contrast pole before accepting the
   label, or dropping the requirement from CONTEXT.md's definition if a
   looser sense is actually what's wanted. Right now the code and the spec
   disagree, quietly, on every single construct-tagged Snippet in this
   evaluation.
