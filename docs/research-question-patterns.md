# Question-Pattern Repertoire — deriving from source text, not restating it

Researched 2026-08-03 for the wayfinder design grill (ticket 103).
This catalogue surveys nine derivation patterns — question forms *built from* the
person's own material rather than merely quoting it back. Per pattern: what it
derives from, what it must quote, contamination risk, stance/form it targets,
evidence from the literature, and a candidate licensing situation.

The verbatim-quote-back is the ONLY composed surface form today (Q-12).
Everything below extends the compositional repertoire. The house rule from
`research-question-policy.md` Synthesis (d) item 12 applies: "Sometimes the
agent must not choose" — Clean Language bans paraphrase because "every
paraphrase introduces something new into the conversation and therefore
potentially reframes it," and Eno's card is "trusted even if its appropriateness
is quite unclear." The question-side analogue of Sole Authorship (Q-1) remains:
**a composed question must contain the person's exact words as a substring.**
Every pattern below reinterprets what "derives from source text" means while
keeping that constraint, or argues explicitly for a narrow exception to it.

---

## 1. Scenario / vignette

### What it derives from

The person's own Episodes and Constructs, recombined into a hypothetical
situation. In vignette methodology, "the researcher constructs a hypothetical
scenario from the participant's data and asks how they would respond" (SAGE
Encyclopedia of Qualitative Research Methods, "Vignettes"). SparkMe's emergent
exploration rolls out candidate conversation trajectories from the person's
responses (§3.2), which is a computational form of scenario construction: EP
identifies a new "line of inquiry" from participant-introduced content and
simulates multi-turn responses to evaluate utility.

### What it must quote

The scenario *frame* is agent-composed (contamination unavoidable — the point
is to introduce a situation that did not happen). But the *anchors* inside it —
the named Episode, the Construct poles, the specific phrase that makes the
scenario recognizably theirs — MUST be exact quotes. A scenario that substitutes
the agent's paraphrase for the person's Episode reads as generic; the
recognizability is the mechanism.

### Contamination risk

**High — the defining contamination, structurally.** Vignette methodology
explicitly constructs new material. The research-question-policy.md Synthesis
(d) item 12 names this tension directly: Clean Language bans paraphrase because
"every paraphrase introduces something new into the conversation." A scenario
IS introduced material — the constructive analogue of the paraphrase ban. The
two guards available are: (a) the quoted anchors must be exact substrings
(Q-12's rule applied to the scenario's components), and (b) the scenario's
hypothetical status must be named ("imagine if…" — the Clean Language
"as/when" frame applied to a hypothetical).

### Stance / form it targets

Scenarios target **avowal-by-application**: the person's reaction to a
hypothetical built from their own material tests whether their general claim
covers a specific case. The yield profile is distinct from both
episodic-retrieval probes (which surface a particular memory) and
deliberative-stance probes (which surface a preference): it tests
*generalization under controlled construction*.

### Evidence

Vignette methodology is a standard qualitative technique with published
validation in health research (PMC9818599) and social research (Barter &
Renold). SparkMe's rollout mechanism provides computational evidence: simulated
rollouts with horizon h=3 successfully predicted high-utility conversation
directions in the occupational-task-worker case study (§4.1.5), and the
subsequent human study confirmed the emergent subtopics as relevant and
peer-validated (§4.2). However, no study directly evaluates the quality of
participant-data-derived vignettes against researcher-constructed ones — the
comparator is missing.

### Candidate licensing situation

Licensed by: a live Direction that has produced ≥3 Snippets of Facets Episode
and Construct within the same Range — enough material to build a concrete,
recognizable scenario without the agent's invention filling gaps.
*Not licensed*: early in a Direction (the agent's estimate of what matters is
bad — `research-question-policy.md` Synthesis (d) items 1-2), or when the
scenario would combine material from different Ranges (Bateson's context rule:
a claim without a Range is malformed — Synthesis (d) item 16). Ships shadow
(Q-35): the scenario's effect on yield must be measured before it acts.

---

## 2. Counterfactual twist

### What it derives from

One Episode with one variable altered: "You described [episode] — what if
[one element] had been different?" This is the interview form of abductive
reasoning: given an observation (the episode), what minimal change would
reveal the causal structure? It derives from the Critical Decision Method
(CDM), which asks the expert to identify decision points where things could
have gone differently, and from Spradley's contrast questions (dyadic and
triadic forms ask the informant to distinguish near-neighbour cases).

### What it must quote

The Episode phrase and the altered variable MUST be exact quotes. The
question frame ("what if … had been different?") is the agent's.

### Contamination risk

**Moderate.** The alteration IS introduced content, but the altered variable
comes from the person's material (an element they named in the episode) — the
agent only permutes what is already present. Risk is that the agent selects a
variable the person considers irrelevant, producing a question that reads as
the agent's preoccupation rather than the person's.

### Stance / form it targets

Targets **self-observation** (the person analysing their own decision) and
**causal theory** (the person's theory of what made the difference). A
counterfactual that produces a causal claim should be flagged under Elicit's
existing Nisbett-Wilson rule (`research-question-policy.md` Synthesis (c)):
the person's causal self-theory is evidence of their theory, not of the cause.

### Evidence

CDM is the most validated elicitation protocol in this set, with a research
programme spanning Klein (1989) to Crandall, Klein & Hoffman (2006). The
decision-point probe — "at this point, were there other options you considered?"
— is a direct ancestor of the counterfactual form. No study isolates the
counterfactual variant against standard CDM probes.

### Candidate licensing situation

Licensed by: a Causal Theory Snippet or an Episode with an explicit decision
point (the person named a fork). The counterfactual must use the person's own
variable — the agent may not introduce a variable the person did not name
(licensing rule: Clean Language's conditional-question gate — "specialised
questions are only clean when the client has stated or presupposed a relevant
context"). Ships shadow (Q-35).

---

## 3. Dilemma from their own poles

### What it derives from

A Construct is a pole plus contrast pole plus range of application
(CONTEXT.md). The person has stated two poles but not the tension between them.
The dilemma question constructs the forced choice: "You've described yourself
as [pole A] in [range], but also as [pole B] when [context] — which is closer
to how you'd act in [novel situation]?" This is triadic elicitation (Kelly
1955) inverted: instead of "which two are alike and different from the third,"
it is "you have named two poles — here is a third context where they conflict."

### What it must quote

Both poles must be exact substrings. The novel context is agent-constructed
and must be traceable to the person's own Range of application.

### Contamination risk

**Moderate-Low.** The poles are quoted; the contamination is in the novel
context. If the agent's constructed context falls outside the person's actual
Range, the question tests nothing real. Guard: the constructed context must
fall within the declared Range or cite a closely neighbouring context the
person has described.

### Stance / form it targets

Targets **pole-preference** and **commitment**. A forced choice between two
self-described poles produces a preference signal under controlled conditions
— the strongest single form for capturing the person's own dimensionality
rather than imposing the agent's.

### Evidence

Kelly's triadic elicitation is the foundation of Personal Construct Psychology
and is validated across clinical and organizational settings (Fransella, Bell &
Bannister 2004). The "which is most different?" form is Spradley's dyadic and
triadic contrast question — gated on taxonomic analysis having produced a
taxonomy. The inversion proposed here (dilemma rather than similarity-judgment)
has no direct empirical test, but the elicitation mechanism is the same.

### Candidate licensing situation

Licensed by: a Construct with both poles and Range present — i.e., the
Construct is *complete* (half-Constructs license the contrast-pole question
first; `question-composition.md` already names this as the Gap-fill source).
Ships live under Q-62: the dilemma is an *offer* — one proposal the person
declines in a word, with nothing done on decline.

---

## 4. Instance-testing

### What it derives from

A general claim plus a specific case constructed from the person's material:
"You said [general claim]. Would that include [specific instance from their
own episodes]?" This is the *instance-of* relation run backward: the person
gives a rule; the agent constructs the counterexample. It is Socratic
questioning's "probe implications and consequences" (Paul & Elder §8, policy
doc) domesticated to only use the person's own episodes as test cases.

### What it must quote

Both the general claim and the specific instance must be exact substrings.
The connective logic ("would that include…") is the agent's.

### Contamination risk

**Low.** The agent constructs only the logical connective. If both quoted
fragments are the person's own words, the question's content is entirely
attributable to the person — the agent only supplies the "does A cover B"

relation. This is the cleanest of the constructive patterns.

### Stance / form it targets

Targets **commitment** and **avowal**. An instance-test that the person rejects
("no, that's different because…") produces a Range refinement: the person
names the boundary between the general claim and the instance. This is the
question form that most directly feeds Wiki Claim Range refinement.

### Evidence

Spradley's example question is the ancestor: a mini-tour or an example question
is "licensed by a unit of experience that surfaced inside a grand-tour answer"
(`research-question-policy.md` §1). Paul & Elder's Socratic "questions that
probe implications and consequences" are the generalized form. Instance-testing
adds the quote constraint (both terms must be exact substrings), which the
policy already requires (Q-12).

### Candidate licensing situation

Licensed by: a general-claim Snippet (Causal Theory, Value, or Construct at
a high level of abstraction) AND an Episode Snippet within the same or
adjacent Range. The test instance MUST come from the person's own corpus — the
agent may not invent one (that would be the Clean Language violation the policy
doc names under contamination risk). Ships live under Q-62 (offer-only).

---

## 5. Externalizing (narrative therapy)

### What it derives from

The person's own words for a difficulty or pattern, re-presented as a
character: "You've mentioned [the problem] several times — if [the problem]
were a character in this story, what would it want from you?" This
externalizes: the problem is the problem, not the person (White & Epston 1990).
The character's traits are built from the person's accumulated descriptions
across Snippets.

### What it must quote

The problem's name — the exact term the person has used consistently — and
every trait attributed to the character must be an exact quote from the
person's Snippets. "It makes you [X]" is only admissible if the person said X.

### Contamination risk

**High — actively encouraged.** Externalizing IS the contamination. The
therapy literature treats re-description as the mechanism: "externalising
establishes a context where people experience themselves as separate from the
problem" (Dulwich Centre, "Externalising – commonly-asked questions"). The
question form's value comes precisely from introducing a new frame on the
person's own words. The guard is *whose words are used to build the character*:
all character traits MUST be exact quotes; the re-description is in the framing
("if X were a character"), not in the quoted content.

### Stance / form it targets

Targets **self-observation** at a meta-level. The person steps outside their
own framing and describes the pattern as an external agent. This is a Learning
II move (Bateson, `research-question-policy.md` Synthesis (a) item 8): it
targets the set of alternatives the person sees, not a choice inside it.

### Evidence

Externalizing is a core narrative therapy technique (White & Epston, *Narrative
Means to Therapeutic Ends*, 1990; White, "The externalizing of the problem,"
1988/9). Validated in clinical settings — the mechanism is not in dispute. The
open question is whether an AI agent can do it without the therapeutic
relationship that makes it safe. Bateson's warning applies directly:
Learning III "can be dangerous, and some fall by the wayside"
(`research-question-policy.md` Synthesis (a) item 8).

### Candidate licensing situation

Licensed by: a Construct or Causal Theory Snippet that has recurred across ≥3
independent Snippets (different sittings), where the person names the same
pattern in consistent language — enough recurrence to build a character from
the person's own descriptions rather than the agent's synthesis. Requires
explicit consent (Q-43 pattern) and a fitting Mode with energy for it. The
deferral mechanic is specifically designed for this case — "frame questions
therefore need explicit consent and a fitting Mode" (Synthesis (a) item 8).
Ships shadow-first (Q-35) — externalizing without therapeutic supervision
carries the highest risk profile in this repertoire.

---

## 6. Miracle / exception / scaling questions (solution-focused)

### What it derives from

Three forms from solution-focused brief therapy (de Shazer, Berg):

- **Miracle question**: "Suppose tonight, while you are asleep, a miracle
  happens, and the problem that brought you here is solved… how would you know?
  What would be different?" (de Shazer, 1999). The miracle frame is
  agent-constructed; the "problem" must be the person's exact term.

- **Exception question**: "You described [pattern] — can you think of a time
  when [pattern] didn't happen, or was less strong?" The pattern phrase must be
  an exact quote.

- **Scaling question**: "On a scale from 1 to 10, where 10 is [their
  description of the desired state] and 1 is the opposite, where are you
  today?" The anchor descriptions must be exact quotes from the person.

### What it must quote

The miracle form: the problem phrase. The exception form: the pattern phrase.
The scaling form: both anchor descriptions. The frames are the agent's — the
miracle premise, the exception prompt, the scale construct.

### Contamination risk

**Moderate.** The frames are heavily agent-authored and carry therapeutic
presuppositions (that a solution exists, that exceptions are evidence, that a
scale is meaningful). In a clinical context these are intentional. In an
elicitation context they are contamination: the agent is introducing a
therapeutic frame into a non-therapeutic tool. The guard is that the
person's quoted phrases anchor the question to their own material — the agent
frames but does not populate.

### Stance / form it targets

Targets **commitment** (where are you now vs. where do you want to be) and
**uncertainty-marked** (exceptions surface the boundary of a generalization).
The scaling question in particular is a direct commitment probe — it asks the
person to locate themselves on their own dimension.

### Evidence

SFBT has moderate empirical support. Jones, Woods & Guillaume (2016) report
δ = 0.36 (k = 17) with no moderation by format or duration. De Haan et al.
(2013) find outcomes track working alliance and self-efficacy — a common-factors
result that argues any specific technique carries the effect. The miracle
question specifically emerged from clinical practice (Berg, early 1980s, with
a client who could not articulate any goal) and was validated through
replication rather than controlled comparison. No study compares the miracle
question against an alternative opening in a non-clinical elicitation setting.

### Candidate licensing situation

Licensed by: a Causal Theory or Construct Snippet about a difficulty or
pattern the person wants to change — i.e., the person has already stated a
desired direction. Because these forms carry therapeutic presuppositions, they
are gated by explicit consent (Q-43) and a fitting Mode. The scaling question
is the mildest form and could be offered earlier. Ships shadow (Q-35) until
yield data exists; the frame's therapeutic valence makes live deployment risky
without evidence.

---

## 7. Sentence stems

### What it derives from

The person's own phrasing, truncated: the agent offers a stem built from the
person's words, and the person completes it. "You said [exact phrase]… finish
this: 'I [phrase fragment] because ______.'" This is the projective technique
of sentence completion (Rotter Incomplete Sentences Blank, 1950) domesticated
for elicitation: the stem is built from the person's own material rather than
a standardised form.

### What it must quote

The stem itself must be an exact quote from the person — a truncation of their
sentence with the completion slot at a natural boundary. The agent may
truncate but may not edit.

### Contamination risk

**Low.** The content is the person's; the agent supplies only the blank. But
the blank's placement IS the contamination — where the agent chooses to cut
determines what is left unsaid. Guard: the cut point should fall at a stated
causal claim ("because…"), a value assertion ("the most important thing
is…"), or an incomplete Construct ("I am the kind of person who…") — i.e.,
at a natural incompleteness in the person's own construction, not at a point
the agent finds interesting.

### Stance / form it targets

Targets **self-observation** and **causal theory**. Sentence completion is a
projective technique — the blank recruits the person's spontaneous
self-description. The stem constrains the domain (it is their own phrase) while
leaving the content open.

### Evidence

The Rotter Incomplete Sentences Blank (RISB) is the most widely used sentence
completion instrument in personality assessment (Lah, cited by Semantic
Scholar). A 2026 systematic review of validity evidence found moderate support
(Assessment, March 2026). However, the RISB uses standardised stems; no
literature evaluates *personalised* stems built from the person's own material.
Projective techniques generally have contested validity (Lilienfeld, Wood &
Garb, 2000, in *Psychological Science in the Public Interest*: "the substantial
majority" of projective indexes lack empirical support). The personalised-stem
variant inherits the projective technique's epistemic status: it surfaces the
person's spontaneous framing, which is high-signal for the person's
self-model but weak evidence for anything beyond it.

### Candidate licensing situation

Licensed by: a Snippet with a natural incompleteness — a stated cause without
the mechanism, a stated value without the justification, a self-description
without the context. The cut must be at a grammatical boundary where the
person's own sentence structure invites completion. Ships shadow (Q-35).

---

## 8. Metaphor extension (Clean Language)

### What it derives from

This IS the current mechanism, generalized beyond the quote-back. When the
person uses a metaphor or an image, Clean Language asks about its attributes
using only the person's words: "And [person's metaphor] — and what kind of
[metaphor] is that [metaphor]?" (Lawley & Tompkins, "Clean Language
Revisited," 2004). The nine basic questions map to five information classes:
attributes, location, subsequent event, previous event, and metaphor shift.
The specialised questions (20 or so) are conditional: they are "only clean
when the client has stated or presupposed a relevant context exists in their
Landscape."

This is the least contaminating form and the furthest from the
verbatim-quote-back — it derives while quoting, using only the person's words
and a fixed syntactic frame.

### What it must quote

The person's exact metaphor or image, and every noun and verb in the question
that is not part of the fixed frame. "Paraphrasing is not part of Clean
Language": the frames are fixed ("and what kind of X is that X", "and is
there anything else about X", "and where/about is X"), and the variable slots
are filled only with the person's exact words.

### Contamination risk

**Zero, by construction.** This is the paraphrase-ban's logical conclusion —
the agent introduces nothing. But this is also item 12 in the policy's
Synthesis (d): "Sometimes the agent must not choose." The cost is that
Clean Language cannot do any of the constructive patterns above — it is
structurally incapable of a scenario, a counterfactual, or a dilemma. The
zero-contamination floor is also the compositional ceiling.

### Stance / form it targets

Targets **self-observation** at the symbolic level. The person explores their
own metaphor's structure — its size, location, qualities, and relationships.
This surfaces the person's *implicit* categories: the landscape their
metaphor lives in is their cognitive-emotional model of the thing, and
exploring it does not require the person to articulate that model propositionally.

### Evidence

Clean Language is validated in clinical and coaching settings (Lawley &
Tompkins, 2004; the Clean Language community's case-study literature), but has
no controlled trial comparing it against alternative probing techniques. Its
evidence base is practitioner consensus plus theoretical coherence with the
metaphor-in-thought tradition (Lakoff & Johnson 1980). The strongest argument
for it in Elicit is NOT empirical but structural: it is the only form that
imposes zero content from the agent, and therefore the only form that
preserves the person's framing without possibility of distortion.

### Candidate licensing situation

Already licensed — the existing composed-follow-up path (Q-12) with the
quote-back form. The extension proposed here is: **when the person uses a
metaphor or a concrete image, prefer the Clean Language frame over the
generic composed form.** The red-light feature "odd or loaded term" already
detects the trigger; the extension is adding the Clean Language question
frames as a Protocol available when a metaphor is detected. Ships live
(Q-62 offer-only), because the frame is fixed and only the person's own
words fill it — no contamination is possible.

---

## 9. Question reversal

### What it derives from

The person's stated interest or concern, inverted: "You asked about [topic] /
you've been wondering about [question] — what answer would surprise you most?"
Or more directly: "Ask me the question you'd want answered — and then tell me
what you think the answer might be."

This is Paul & Elder's meta-Socratic move — "questions about the question" —
plus the user-declared thread. The person names what they want to know; the
agent asks them to anticipate the answer.

### What it must quote

The person's stated question, topic, or curiosity — exact wording. The frame
("what answer would surprise you") is the agent's.

### Contamination risk

**Low.** The agent introduces only the reversal frame. The person supplies both
the question and the anticipated answer. The risk is that the reversal
implicitly assumes the person CAN articulate what they want to know, which
excludes the common case where the person knows something matters but cannot
name it.

### Stance / form it targets

Targets **commitment** (the anticipated answer IS a stated belief, even when
hedged) and **uncertainty-marked** (the gap between "what I think the answer
is" and "what would surprise me" is a direct uncertainty measure). This is
also a Learning II probe: it asks the person to examine the frame of their
own question.

### Evidence

The form is implied by Paul & Elder's "questions about the question" —
"Assume that you do not fully understand a thought until you understand the
question that gives rise to it" (`research-question-policy.md` §8). No
direct experimental study of question reversal as an elicitation technique
exists (second-hand literature search exhausted; no primary found). The
effectiveness claim rests on the meta-cognitive mechanism: asking the person
to predict their own answer makes the prior belief explicit, and subsequent
elicitation can then measure drift from that explicit prior.

### Candidate licensing situation

Licensed by: a user-declared Queue entry (Q-20 bookmark) where the person
has named what they want to explore — i.e., the person has already taken
initiative on the topic. Ships shadow (Q-35); the form's novelty means
yield must be measured before it acts.

---

## Patterns noted but not catalogued

These were considered but lack enough material for a full entry. They may
belong in a later pass.

- **Metaphor offering** (the agent offers a metaphor and asks if it fits):
  introduces content at maximum contamination — "does this fit" is a
  confirmation question, and confirmation-everything is the known-worst
  policy (`research-question-policy.md` Synthesis (d) item 6).

- **Role-play** (the agent asks the person to answer as their past self or
  as someone they named): the contamination is in the role assignment, and
  no elicitation literature validates the technique for self-knowledge
  rather than skill rehearsal.

- **Paraphrase-check** ("you said X — I hear Y — is that right?"):
  active-listening paraphrase (Xiao, Ch. 4) turns the person's words into the
  agent's restatement and asks for confirmation. The paraphrase IS
  contamination, and the confirmation ask is the disfavoured move (Synthesis
  (d) item 6). Decline: Elicit's open Wiki plus Propagation is the right
  mechanism — show the reading, let the person refute, never ask for
  confirmation.

---

## Gaps

Named rather than papered over. House style from
`research-question-policy.md`.

- **Vignette methodology primary sources**: The SAGE Encyclopedia entry was
  read; the primary monographs (Barter & Renold 1999, 2000; Hughes 1998)
  were not. The construction principles for participant-data-derived vignettes
  are second-hand.

- **Solution-focused primary texts**: de Shazer's *Keys to Solution in Brief
  Therapy* (1985) and Berg's *Family Based Services* (1994) were not obtained.
  The miracle question wording is quoted from de Shazer's 1999 handout and
  cross-checked against the SFBTA reproduction; the exception and scaling
  question forms are second-hand from the synthesis literature.

- **White & Epston's *Narrative Means to Therapeutic Ends*** (1990) was not
  obtained. The externalizing technique is quoted from the Dulwich Centre
  summary and from White (1988/9) as mediated by secondary sources. The
  specific question forms ("what does [the problem] want from you," "how
  does [the problem] affect your relationships") are second-hand.

- **Rotter Incomplete Sentences Blank manual (1992)**: Not obtained. The
  validity evidence is from the 2026 systematic review and the Lah summary;
  the standardised stems themselves were not read.

- **Xiao et al. 2020 (TOCHI) conversational survey effect sizes**: The
  dissertation was read; the specific effect sizes for adaptive probing vs.
  no-probe conditions were not extracted. The dissertation reports that the
  chatbot asked follow-up questions to 61% of participants (n=282) and
  participants complied 71% of the time, but a direct effect-size comparison
  of probing strategies is not in the read sections.

- **SparkMe's probe action types**: The three IA actions (probe for depth,
  explore emergence, transition to next subtopic) are read from §3.1.1.
  The specific prompt templates for each action are in Appendix B of the
  paper, which was not read in full — the probe-action taxonomy for
  Elicit's purposes is paraphrased from §3.1.1.

- **AInterviewer's probing agent**: The multi-agent pipeline is documented in
  §2.2; the probe-generation prompt templates are not published in the paper
  (code is open-source at github.com/ainterviewer). The classification
  agents (previously-answered, refusal, sufficient-probes) are read.

---

## Open questions for the design grill (103)

These are decisions this research surfaces but cannot settle.

1. **Can a pattern's contamination risk be structural rather than prompt-level?**
   Clean Language's fixed frames are structurally zero-contamination. Every
   other pattern introduces agent-authored content to some degree. Should the
   licensing system distinguish "frames" (agent-authored, changeable) from
   "quotes" (person-authored, invariant), and track the ratio? A question that
   is 90% quoted text with a 10% agent frame is a different epistemic object
   than a fully agent-composed scenario.

2. **Should the metaphor-extension frame become a Protocol?** Clean Language's
   nine basic questions are context-independent and can be asked almost
   anytime. Adding them as a Protocol would suspend selection while the
   metaphor is explored — a small instrument. But metaphor detection is
   currently a model judgment, not a structural check. A Protocol that
   triggers on a model judgment is a new category.

3. **What is the yield profile of externalizing questions outside a
   therapeutic context?** Externalizing is the highest-risk, highest-potential
   form. It targets Learning II — the person's own framing. It also carries
   Bateson's explicit danger warning. How do you measure whether an
   externalizing question helped or harmed without a therapeutic outcome
   measure? The deferral mechanic (Q-43) puts this in the person's hands,
   but the agent must still decide WHEN to offer.

4. **Does instance-testing need to be a distinct pattern, or is it the
   Gap-fill source wearing a new name?** "Would [general claim] include
   [specific instance]?" is structurally a Gap — the claim's Range has not
   been tested against this instance. If the Gap-fill machinery already
   detects Range gaps, instance-testing is a composed question type within
   the Gap-fill source, not a new source.

5. **The paraphrase-ban vs. constructive-patterns tension.** The policy's
   Synthesis (d) item 12 says "paraphrase is banned, because every paraphrase
   introduces something new into the conversation and therefore potentially
   reframes it." But every constructive pattern introduces something new —
   that IS the pattern. The design needs a clear rule for what introduced
   content is admissible (scenario frames? counterfactual variables? miracle
   premises?) and what introduced content crosses the line (paraphrase?
   metaphor offering? the agent's interpretation of what the person 'really
   means'?). The Clean Language conditional-question gate — "only clean when
   the client has stated or presupposed a relevant context exists" — is the
   closest existing rule, applied to agent-authored content rather than agent
   word choices.

6. **The agent must not choose — but who chooses the pattern?** The policy's
   Synthesis (d) item 12 argues that both Clean Language and Oblique
   Strategies derive their value from the operator NOT choosing. If the agent
   selects which derivation pattern to use, does that defeat the mechanism?
   One reading: the *pattern* may be selected (it is a licensed move in the
   repertoire), but the *content* within a zero-contamination pattern (Clean
   Language) is structurally agent-proof, and the *draw* within a
   pattern-switching regime might be random — the Randomizer applied to
   derivation patterns rather than to questions.

7. **What is the cost of getting the pattern wrong?** A composed follow-up
   that quotes verbatim and misses is cheap — it reads as a slightly odd
   question. A scenario that misrepresents the person's material or an
   externalizing question that misframes the problem is expensive — it reads
   as the agent not understanding who you are. The contamination-risk column
   is a cost estimate, but the actual cost depends on the person and the
   context. Does the licensing situation for high-contamination patterns
   need a cost ceiling in addition to a trigger condition?

8. **How do these patterns interact with the existing composed-question
   guard pipeline?** The parrot guard, near-duplicate guard, and
   conversation-referential guard (Q-36) were designed for verbatim-quote-back
   questions. A counterfactual or a scenario is structurally novel each time
   (the constructed element changes). Will the guards correctly classify them
   as novel, or will the presence of quoted subsections trigger false
   near-duplicate hits? The guard pipeline needs testing against each pattern.

9. **SparkMe's rollout-based question selection is the computational
   analogue of the patterns above — does it substitute for them, or
   complement them?** SparkMe's EP simulates conversation rollouts to
   estimate utility gain, then steers the InterviewAgent toward high-utility
   directions. Its three actions (probe for depth, explore emergence,
   transition) map loosely onto the pattern repertoire: probe-for-depth ≈
   Clean Language / instance-testing, explore-emergence ≈ scenario /
   counterfactual. But SparkMe's rollouts are content-free — they guide
   which direction, not how to phrase. Elicit's patterns are phrasing
   techniques. The integration question: does SparkMe's direction-selection
   logic belong in Elicit's question-source stack (as a new source: "utility
   rollout"), with the patterns below as form options within that source?

10. **Is the repertoire closed, or do we need a mechanism for the person's
    own pattern?** The ticket's origin quote — "the 'you wrote X — …?'
    pattern is tiresome" — is one person's feedback about one compositional
    surface. The person may have their own derivation patterns they prefer.
    Should Question-Form in Provenance track which derivation pattern was
    used, and should the person's answer-yield per pattern inform a
    personalization layer?
