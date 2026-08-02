# Question-Construction Policy

How should an interviewing agent construct and select its next question, so as to
maximally deepen a model of the person?

This document answers the *policy* question — when is a given kind of question
licensed — not the technique question. Technique-to-knowledge-type matching is
already covered in `research-shape-of-the-problem.md` §(c) and is not repeated
here.

Ten literatures, each read for one thing: the rule or situation that says *ask
this now*. Fields 1–9 answer that from inside an optimisation frame; field 10 —
systems, cybernetics, complexity — asks what kind of thing is being questioned,
and changes several of the answers. Then a synthesis proposing what they jointly
imply for Elicit.

Sources are marked **second-hand** where the primary text could not be obtained.
The gaps are named explicitly at the end rather than papered over.

---

# 1. Ethnographic and qualitative interviewing: taxonomies with usage rules

The oldest literature here is also the most explicit about licensing. Spradley
does not merely classify questions; he says which analytic artifact must exist
before each kind may be asked.

**Descriptive-question subtypes are each triggered by a feature of the previous
answer.** Spradley's five subtypes form a licensing chain. A grand tour needs
only that the interviewer know one setting the informant occupies. A mini-tour is
licensed by a unit of experience that surfaced inside a grand-tour answer:
"Responses to grand tour questions offer almost unlimited opportunities for
investigating smaller aspects of experience… she discovered that one recurrent
activity was 'taking calls.' … This led to a mini-tour question: 'Could you
describe what goes on in taking a call?'" An example question is licensed by a
single act the informant just named. A native-language question is licensed when
the interviewer suspects his own term is not the informant's: "'Could you
describe the jail?' was a useful grand tour question, but I still was not sure
that 'jail' was a commonly used term. And so I asked… 'How would you refer to the
jail?'" Experience questions carry an explicit ordering constraint: "These
questions are so open ended that informants sometimes have difficulty answering
them. They also tend to elicit atypical events rather than recurrent, routine
ones. **They are best used after asking numerous grand tour and mini-tour
questions.**" One construction rule travels with all of them: "expanding the
length of the question tends to expand the length of the response."
— James P. Spradley, *The Ethnographic Interview*, 1979, ch. "Asking Descriptive
Questions" — https://jan.ucc.nau.edu/~pms/cj355/readings/spradley.pdf

**The gate on a structural or contrast question is an analytic artifact, not a
clock.** A structural question requires that domain analysis has identified a
domain; a contrast question requires that taxonomic analysis has produced a
taxonomy. The Developmental Research Sequence interleaves interviewing and
analysis precisely so that each question type unlocks when its precondition
exists. Three of Spradley's five structural-question principles matter for a
machine: the **concurrent principle** — "Ask structural questions concurrently
with descriptive questions" — which forbids strict phases; the **repetition
principle** — "Structural questions must be repeated many times to elicit all the
included terms" — which says one asking returns an incomplete list by design; and
the **cultural framework principle**, which requires phrasing in the informant's
frame rather than the interviewer's. Contrast questions come in three forms:
dyadic, triadic ("which is the most different?"), and card sorts.
— Spradley 1979, structural-question principles retrieved as phrase-anchored
snippets from the lending-restricted scan —
https://openlibrary.org/search/inside?q=%22Ask+structural+questions+concurrently+with%22
; domain-analysis step wording is **second-hand** from Stephen Borgatti, "Notes on
Spradley's *Ethnographic Interview*" —
http://www.analytictech.com/mb870/handouts/notes_on_spradley.htm

**Rubin & Rubin's trichotomy splits on who authored the topic.** "Main questions
are worked out in advance to make sure you cover all the [major parts of your
research problem], whereas the follow-up questions ask for explanation of themes,
concepts, or events [that the interviewee has introduced]." That is the whole
selection policy in one contrast. A main question is licensed by the
interviewer's agenda and is therefore schedulable in advance. A follow-up is
licensed by the interviewee having introduced something, and therefore cannot
exist before the answer that creates it. Probes are a third, orthogonal class:
they act on the conversation's form rather than its content, which is why they
*can* be pre-listed even though follow-ups cannot. (The 3rd-edition enumeration of
five probe kinds — completeness, clarity, evidence, attention, elaboration — was
not retrieved verbatim; treat as unverified.)
— Herbert J. Rubin & Irene S. Rubin, *Qualitative Interviewing: The Art of
Hearing Data*, 1995/2012 —
https://openlibrary.org/search/inside?q=%22Main+questions+are+worked+out+in+advance%22

**Kvale's nine types are each defined by the interview situation that licenses
them.** This is the most explicitly situational taxonomy in the literature.
*Introducing* questions open, and set the agenda for everything after: "The
remainder of the interview can then proceed as following up of the dimensions
introduced in the story told in response to the initial question." *Follow-up*
carries a detection rule: "Interviewers can train themselves to notice 'red
lights' in the answers — such as unusual terms, strong intonations, and the like
— which may signal a whole complex of topics important to the subject."
*Specifying* is licensed by generality: "In an interview with many general
statements, the interviewer can attempt to get more precise descriptions."
*Direct* questions carry the funnel rule stated as a rule: they "may preferably be
postponed until the later parts of the interview, after the subjects have given
their own spontaneous descriptions and thereby indicated what aspects of the
phenomena are central to them." *Structuring* is licensed by exhaustion: the
interviewer "should indicate when a theme has been exhausted" and "may directly
and politely break off long answers that are irrelevant." *Silence* is itself a
question: "By allowing pauses in the conversation the subjects have ample time to
associate and reflect and then break the silence themselves with significant
information."
— Steinar Kvale, *InterViews*, 1996, Box 7.1, pp. 133–135 —
https://pdfcoffee.com/interviews-kvale-5-pdf-free.html

**Every candidate question is scored on two independent axes and must pass
both.** "An interview question can be evaluated with respect to both a thematic
and a dynamic dimension: thematically with regard to producing knowledge, and
dynamically with regard to the interpersonal relationship in the interview. A
good interview question should contribute thematically to knowledge production
and dynamically to promoting a good interview interaction." Kvale's own worked
self-critique shows what the selection cost looks like in practice: he notices
"potentially significant expressions like 'demarcation' and 'space' … and
**instead of following them up**, posed specifying and interpreting questions."
— Steinar Kvale, *Doing Interviews*, 2007, ch. 5 —
https://pdfcoffee.com/doing-interviews-kvale-steinarpdf-3-pdf-free.html

**The funnel hazard has no primary source here, but two independent primaries
state its mechanism.** Kvale's postponement rule gives the reason directly: ask
the specific question first and you lose the evidence of what the person
considers central. Spradley's grand-tour-before-mini-tour-before-example ordering
is the same broad-to-narrow shape, with the narrow question's *content* supplied
by the broad answer. A canonical survey-methodology source on question-order
contamination was not located; see Gaps.

---

# 2. Value of information and preference elicitation

**Information value is decision-relative, and it is not additive across
questions.** Howard's founding argument is that Shannon information cannot serve
as a selection criterion: "no theory that involves just the probabilities of
outcomes without considering their consequences could possibly be adequate in
describing the importance of uncertainty to a decision maker." The structural
warning that matters most for a question-scoring loop is in his abstract: "the
joint elimination of the uncertainty about a number of even independent factors
in a problem can have a value that differs from the sum of the values of
eliminating the uncertainty in each factor separately." Scoring candidate
questions independently and summing is therefore invalid. (The familiar corollary
— that information which cannot change the decision has zero value, and that
EVI ≥ 0 — appears in the derived literature rather than in the retrievable
abstract; **second-hand**.)
— Ronald A. Howard, *Information Value Theory*, IEEE Trans. Systems Science and
Cybernetics SSC-2(1):22–26, 1966 — https://doi.org/10.1109/TSSC.1966.300074

**The terminal condition is a bound on decision regret, not on model
completeness — and it fires after two to four questions.** Chajewska, Koller and
Parr give the policy and the stop rule in one sentence: the algorithm "asks the
utility elicitation question giving us the highest value of information and
computes the best strategy based on the information acquired so far, **stopping
when the expected utility loss resulting from our recommendation falls below a
pre-specified threshold**." At threshold ε = 0.05 the average number of questions
was 2.3–3.9. They are explicit that this is myopic: "the full value of
information, which takes into consideration all possible future combinations of
questions and answers, is, as usual, intractable."
— Chajewska, Koller & Parr, *Making Rational Decisions Using Adaptive Utility
Elicitation*, AAAI 2000 — https://cdn.aaai.org/AAAI/2000/AAAI00-056.pdf

**Myopic value of information has a sharp, specific failure: it asks nothing when
no single question can move the decision.** Boutilier: "a myopic approach can fail
to ask the correct questions because it neglects the value of future questions
when determining the value of the current question... **if no single question can
cause a change in the optimal decision, a myopic approach will never try to
reduce its uncertainty**." He constructs a case where "myopic VOI associates no
value to any query" while "the POMDP approach recognizes that the answers to a
sequence of (properly chosen) queries can ensure that a better decision is made."
Cost is explicit and psychological: "each question q has a cost c(q). This
reflects the difficulty the user is expected to have in answering the question
due to the mental burden it imposes."
— Craig Boutilier, *A POMDP Formulation of Preference Elicitation Problems*, AAAI
2002 — https://cdn.aaai.org/AAAI/2002/AAAI02-037.pdf

**The minimax-regret alternative gives a cheap filter that needs no prior: only
ask about things that bear on the current best answer or its closest rival.**
This is the *current solution* heuristic, and it is the most portable primitive
in this literature. "If we ask a query of DM whose response fails to further
constrain the utility of either x or x′, pairwise max regret between the two will
not change... The CS heuristic requires that the only queries that can be asked
must provide information about utility function parameters that determine the
utility of either x or x′." Stated as a principle: "we do not reduce utility
uncertainty for its own sake, but rather reduce minimax regret as quickly as
possible." Stopping is an economic trade: "stop when regret reaches a point where
further improvement is outweighed by the cost of further interaction."
— Boutilier, Patrascu, Poupart & Schuurmans, *Regret-based Utility Elicitation in
Constraint-based Decision Problems*, IJCAI 2005 —
https://cs.uwaterloo.ca/~ppoupart/publications/elicitationIJCAI05/elicitationIJCAI05.pdf
; and *Constraint-based optimization and utility elicitation using the minimax
decision criterion*, Artificial Intelligence 170(8–9), 2006 —
https://doi.org/10.1016/j.artint.2006.02.003 (CS-heuristic quotes from Boutilier's
open review chapter —
https://www.cs.toronto.edu/~cebly/Papers/RegretBasedModels_ComparativeDM_chapter.pdf)

**Question cost is a property of the question's form and of its position in the
sequence — it is not a constant.** Chajewska et al.: "some questions are
cognitively more difficult than others: **questions near the indifference point
are hard, a second consecutive question about the same outcome is cheaper than a
question about an outcome discussed a few questions back**, etc." They also argue
that asking fewer questions improves answer quality, "because our method allows
us to avoid errors resulting from the fatigue caused by the utility elicitation
process."
— Chajewska, Koller & Parr, AAAI 2000 (above)

**Measured human tolerance: roughly 10–20 questions, with a ~5% error floor even
on easy items.** "Users answered an average number of 15 questions per target item
in the system (with the median being 12). Further, in the exit questionnaire,
**71.4% of the users declare that they are willing to answer between 10 and 20
questions**… 95.2% of the users indicate that the system's questions were easy to
answer… the users provided the correct answers to the system's question 95% of
the time, they were not sure about their answers 3.5% of the time, and they gave
the wrong answers… 1.5% of the time." The user's own stop signal was treated as a
first-class event in their evaluation.
— Zou, Chen & Kanoulas, *Towards Question-based Recommender Systems*, SIGIR 2020 —
https://arxiv.org/pdf/2005.14255

---

# 3. Active learning and optimal experiment design

**Uncertainty is not informativeness. The most uncertain item is often the least
representative one.** Settles states the failure mode directly: "The least certain
instance lies on the classification boundary, but is not 'representative' of
other instances in the distribution, so knowing its label is unlikely to improve
accuracy on the data as a whole. **QBC and EGL may exhibit similar behavior, by
spending time querying possible outliers simply because they are controversial,
or are expected to impart significant change in the model.**" The correction is
information density — multiply informativeness by average similarity to the rest
of the input distribution, `x*_ID = argmax_x φ_A(x) × [(1/U) Σ_u sim(x, x^(u))]^β`.
The two frameworks that avoid the outlier trap structurally — expected error
reduction and variance reduction — do so "because they focus on the entire input
space rather than individual instances," at the price of being "the most
computationally expensive query framework."
— Burr Settles, *Active Learning Literature Survey*, UW–Madison CS TR 1648,
2009/2010, §3.1, §3.6 — https://burrsettles.com/pub/settles.activelearning.pdf

**Expected information gain is the principled objective, and its author names its
weakness: it prices a question assuming the model is right.** MacKay derives three
criteria from three specifications of what you want to know, and shows the naive
one is degenerate: maximising total parameter information means "take the next
datum at the point where the error bars on the interpolant are currently
largest," which "would in those cases lead us to repeatedly gather data at the
edges of the input space." The global caveat: "All these criteria depend on the
assumption that the hypothesis space is correct, which may prove to be their main
weakness" — expanded in his §6.1, "The Achilles' Heel of These Methods": "the
marginal information gain is really the right answer to the wrong question."
— David J. C. MacKay, *Information-Based Objective Functions for Active Data
Selection*, Neural Computation 4(4):590–604, 1992 —
https://authors.library.caltech.edu/records/efefp-2j353/files/MACnc92c.pdf

**Sampling bias: the questioner's own confidence becomes self-confirming, and the
learner can converge to the wrong answer with an infinite budget.** Dasgupta: "as
training proceeds, and points are queried based on increasingly confident
assessments of their informativeness, **the training set looks less and less like
P**." His one-dimensional counterexample: a group missed by the initial random
sample is never queried again, "and the first query point will lie in this group.
So will every subsequent query point, forever... **the learner is not consistent:
even with infinitely many labels, it returns a suboptimal classifier**. The
problem is that the second group from the left gets overlooked."
— Sanjoy Dasgupta, *Two Faces of Active Learning*, Theoretical Computer Science
412(19), 2011 — https://cseweb.ucsd.edu/~dasgupta/papers/twoface.pdf

**The standard oracle assumptions, named in four words, and what breaks when you
drop them.** Donmez & Carbonell: "the oracle is assumed to be **infallible**
(never wrong), **indefatigable** (always answers), **individual** (only one
oracle), and **insensitive to costs**." Every one of those is false for a human
being interviewed about themselves. Sheng, Provost & Ipeirotis add the
re-ask-or-ask-new result: "Repeated-labeling can improve label quality and model
quality, but **not always**… **Repeatedly labeling a carefully chosen set of
points is generally preferable**." Settles flags the unsolved case that matters
most here: "how can active learners deal with noisy oracles whose quality varies
over time (e.g., after becoming more familiar with the task, or after becoming
fatigued)?"
— Donmez & Carbonell, *Proactive Learning*, CIKM 2008 —
http://www.cs.cmu.edu/~jgc/publication/PublicationPDF/Proactive_Learning_Cost-Sensitive_Active_Learning_With_Multiple_Imperfect_Oracles.pdf
; Sheng, Provost & Ipeirotis, *Get Another Label?*, KDD 2008 —
https://crowdsourcing-class.org/readings/downloads/econ/get-another-label.pdf

**Cold start: early informativeness scores are computed by a model that does not
yet know anything, and the damage compounds.** Attenberg & Provost: "early stages
of acquisitions can result in a vicious cycle of uninformative selections,
leading to poor quality models and therefore additional poor selections... poor
selections in the early phases of active learning propagate their harm across the
learning curve." Settles' practical verdict: "random sampling (at least for pilot
studies, until the task can be better understood) may be more advisable than
taking one's chances on active learning with an inappropriate learning model."
The batch analogue is reported by Settles **second-hand**: "Guo and Schuurmans
(2008) found that off-the-shelf query strategies, when myopically employed in a
batch-mode setting, are often much worse than random sampling" — the fix is an
explicit diversity term, and plain top-k selection performs worst.
— Josh Attenberg & Foster Provost, *Inactive Learning? Difficulties Employing
Active Learning in Practice*, SIGKDD Explorations 12(2), 2010 —
https://pages.stern.nyu.edu/~fprovost/Papers/Attenberg_inactive_Explorations.pdf

**When the oracle is a human, you cannot divide informativeness by cost, and the
real stopping criterion is external.** Settles §6.3: "In some domains, annotation
costs are not (approximately) constant across instances… **Consequently, active
learning approaches which ignore cost may perform no better than random
selection**"; the cost "may not be intrinsic, but may instead vary based on the
person doing the annotation"; and "**simply dividing the informativeness measure
(e.g., entropy) by the cost is not necessarily an effective** [strategy]." §6.7 on
termination: self-stopping methods "seem like a good idea… **However, in my own
experience, the real stopping criterion for practical applications is based on
economic or other external factors, which likely come well before an intrinsic
learner-decided threshold.**"
— Settles, TR 1648, §6.3, §6.7 (above)

---

# 4. Computerized adaptive testing and item response theory

This is the mature, deployed answer to "which question next," and its central
lesson is negative: the obvious rule is known-bad, and every operational system
wraps it in three correction layers.

**The base rule is greedy maximum Fisher information at the running estimate.**
After each response the ability estimate θ̂ updates; the next item is the
unadministered item maximizing `I_i(θ) = [P'_i(θ)]² / (P_i(θ)Q_i(θ))` at θ̂. Under
a 2PL model this peaks at θ = b_i with height proportional to a_i², so "maximum
information" mechanically means *the highest-discrimination item whose difficulty
is nearest my current guess about you*. That single fact drives every failure
below. The start-up problem: with no θ̂ yet, it is initialised at the population
mean, and maximum-likelihood estimation is unusable early because it cannot
handle all-correct or all-incorrect patterns — so operational systems run a
Bayesian (EAP) estimator first and switch later (**second-hand**, from Han 2018).
— Weiss, *Improving Measurement Quality and Efficiency with Adaptive Testing*,
Applied Psychological Measurement 6(4), 1982 —
https://doi.org/10.1177/014662168200600408 ; Lord, *Applications of Item Response
Theory to Practical Testing Problems*, 1980 — https://eric.ed.gov/?id=ED312280 ;
Han, *Components of the item selection algorithm in CAT*, J Educ Eval Health Prof
15:7, 2018 — https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/

**Correction 1 — exposure control: a probabilistic gate between *selecting* an
item and *administering* it.** Greedy selection burns the pool. Han measures it: a
CAT on a 300-item pool under pure maximum information "administers 30 out of 300
items," and he concludes the criterion "is rarely used in actual operational CAT
applications... because of its 'greedy' tendency in item selection." Sympson &
Hetter separate P(S), that the criterion picks the item, from P(A), that the
examinee sees it: "Starting from the best item, the item exposure parameter is
compared against a randomly generated value between 0 and 1... If the random
value is smaller than the exposure parameter, the item is administered;
otherwise, the process proceeds to the next best item." Two hazards: the
parameters "are derived from iterative simulations" and are pool-specific,
needing recomputation "whenever there is a change in the item pool, even in a
single item"; and unconditional control still lets a narrow ability band consume
the same items, which is why Stocking & Lewis condition on ability.
— Sympson & Hetter, *Controlling item-exposure rates in CAT*, Proc. 27th Military
Testing Association, 1985 (undigitized; mechanism **second-hand** from Han 2018) ;
Stocking & Lewis, *Controlling Item Exposure Conditional on Ability in CAT*, J.
Educational and Behavioral Statistics 23(1), 1998 —
https://doi.org/10.3102/10769986023001057

**Randomesque: pick uniformly at random from the top-k, not the top-1.** The
cheapest exposure control, and it needs no simulation: "Instead of selecting a
single best item, this method is designed to select multiple best items based on
the item selection criterion. After that, one of the best items is randomly
administered." Its stated limit is precise — it "may not be highly effective in
limiting the maximum item exposure rate to a target rate, but it can prevent the
same item from being used repeatedly for test takers with similar proficiency
levels." It bounds collision between similar people, not global exposure. (Rule
text **second-hand** from Han; the 1989 article is paywalled.)
— Kingsbury & Zara, *Procedures for Selecting Items for Computerized Adaptive
Tests*, Applied Measurement in Education 2(4), 1989 —
https://eric.ed.gov/?id=EJ401748

**Correction 2 — use your weak questions early and your sharp ones late. This is
exactly opposite to greedy, and it is the most transferable result in the
literature.** Chang & Ying: "this application of Fisher information could be much
less efficient than assumed **if the estimators are not close to the true θ**,
especially at early stages of an adaptive test... It is argued here that
selection procedures based on **global information** should be used, at least at
early stages of a test." Their global measure sums Kullback-Leibler information
over all candidate θ — it asks which item best separates *all* the hypotheses
still standing, rather than which is sharpest exactly here. The 1999 paper turns
this into a schedule: "it was found that **administering items with low
discrimination parameter (a) values early in the test and administering those
with high a values later was advantageous**; the skewness of item exposure
distributions was reduced while efficiency was maintained." The failure it
repairs: maximum information at a bad provisional estimate is not maximum
information — it is capitalisation on estimation error, and it spends your best
items on your worst guesses.
— Chang & Ying, *A Global Information Approach to CAT*, Applied Psychological
Measurement 20(3), 1996 — https://doi.org/10.1177/014662169602000303 ; Chang &
Ying, *a-Stratified Multistage CAT*, APM 23(3), 1999 —
https://doi.org/10.1177/01466219922031338

**Correction 3 — content balancing: assemble a whole feasible test at each step,
then administer only its first item.** Stocking & Swanson's weighted deviations
model demotes constraints into the objective and picks "the item with the
smallest weighted sum of deviations," but the authors state its limit themselves:
"there is nothing about the WDM or its algorithm that guarantees this outcome.
The only guarantee is that the test produced will come as close as possible to
the ideal." Van der Linden & Reese's shadow test guarantees it instead: "At each
item-selection step, **a full test is assembled to have maximum information at
the current θ estimate, fixing the items already administered. Then the item with
maximum information is selected.** … The LP model also **guarantees that each
adaptive test always meets the entire set of constraints.**" The cost was
measured, not assumed: with 753 LSAT items and **433 constraints**, "the θ
estimator for adaptive tests of realistic lengths did not suffer any loss of
efficiency from the presence of 433 constraints."
— Stocking & Swanson, *A Method for Severely Constrained Item Selection in
Adaptive Testing*, APM 17(3), 1993 —
https://conservancy.umn.edu/items/c9f8fb4d-9523-40bd-b711-9b93d7404f44 ; van der
Linden & Reese, *A Model for Optimal Constrained Adaptive Testing*, APM 22(3),
1998 — https://doi.org/10.1177/01466216980223006

**Stopping on a precision threshold fails at both ends, in opposite
directions.** Choi, Grady & Dodd, on a 28-item pool: "for a theta level of −2, the
minimum attainable standard error is above that which would typically be required
to terminate the test... **the minimum SE stopping rule would administer all 28
items in the pool, even though the desired standard error is unobtainable**"; and
the mirror error, "at a theta level of 1, the minimum SE stopping rule would
**terminate the test after administering less than five items**, even though the
favorable match between the examinee trait level and the item pool would allow
for a considerable further reduction." Their replacement reframes the question
from "am I precise enough?" to "**is it worth continuing?**" — forecast how much
the next item would reduce the standard error, and stop when the forecast gain is
small.
— Choi, Grady & Dodd, *A New Stopping Rule for Computerized Adaptive Testing*,
Educational and Psychological Measurement 71(1), 2011 —
https://pmc.ncbi.nlm.nih.gov/articles/PMC3028267/

**In a multidimensional, no-right-answer, low-stakes domain — the closest
analogue to Elicit — elaborate selection criteria buy almost nothing.** With
several latent dimensions, information is a matrix and "most informative" is
undetermined until you name a scalarisation; Mulder & van der Linden find
A-optimality and D-optimality best, E-optimality erratic, and note the
unavoidable tension: "the presence of a second intentional ability introduces a
**trade-off between their two estimators**, and consequently to less favorable
behavior for either of them." Then the humbling result from the PROMIS setting
(polytomous items, no correct answers, low stakes): "The results showed **no
clear benefit from more sophisticated selection criteria**," one supposedly
superior method is "mathematically equivalent to a simpler method," and item
overlap between plain maximum-information and every alternative ran .84–.90 at
five items, rising to .96–.98 at twenty. They also note the constraint regime
relaxes: "exposure and content control is **less of an issue in PRO measurement
than in high-stakes testing**."
— Mulder & van der Linden, *Multidimensional Adaptive Testing with Optimal Design
Criteria for Item Selection*, Psychometrika 74(2), 2009 —
https://pmc.ncbi.nlm.nih.gov/articles/PMC2813188/ ; Segall, *Multidimensional
Adaptive Testing*, Psychometrika 61(2), 1996 — https://doi.org/10.1007/BF02294343
; Choi & Swartz, *Comparison of CAT Item Selection Criteria for Polytomous
Items*, APM 33(6), 2009 — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2791416/

---

# 5. Knowledge-base completion, slot filling, clarification-question ranking

**Rank a question by the expected utility of its answer, not by its own
relevance.** Rao & Daumé's EVPI objective:
`EVPI(qi|p) = Σ_{aj∈A} P[aj|p,qi] · U(p + aj)`, where "`P[aj|p,qi]` measures the
probability of getting an answer aj given an initial post p and a clarifying
question qi, and `U(p+aj)` is a utility function that measures how much more
complete p would be if it were augmented with answer aj." Two modelling
obligations follow: you must model the *answer distribution* and the
*completeness gain*. Empirically, baselines given the answer beat the answer-free
baseline, "showing that answer helps in selecting the right question," and EVPI
beats them all at equal parameter count. (Note: this is ACL **2018**, not 2017.)
— Sudha Rao & Hal Daumé III, *Learning to Ask Good Questions: Ranking
Clarification Questions using Neural Expected Value of Perfect Information*, ACL
2018 — https://aclanthology.org/P18-1255/

**Optimising likelihood produces generic questions; optimising answer-utility
produces specific ones.** MLE training "leads to the generation of highly generic
questions, such as 'What are the dimensions?'" Their fix replaces the likelihood
objective with a reward equal to the pretrained utility calculator's estimate
that the hypothetical answer would add information. Human judges then rate the
utility-trained model significantly higher on **usefulness** and **specificity**
— while the ablated MLE model scores *higher on BLEU*, "since MLE produces more
generic outputs, it is much more likely that it will match one of 10 references."
Fluency and plausibility metrics actively select for bland questions.
— Rao & Daumé III, *Answer-based Adversarial Training for Generating
Clarification Questions*, NAACL 2019 — https://aclanthology.org/N19-1013/

**Two-tier belief store: candidates accumulate freely, promotion needs a hard bar
or independent corroboration, and humans are consulted almost exclusively to
*delete*.** NELL holds ~117M beliefs of which 3.81M are high confidence, where
"'high confidence' indicates either that one of NELL's modules assigns a
confidence of at least **0.9** to the belief, or that **multiple modules
independently propose the belief**." The human-in-the-loop rule is the striking
one: "This feedback is **nearly all negative feedback** identifying NELL's
incorrect beliefs" — 85,088 items over 802 iterations, about 2.4 negative labels
per predicate per month. Humans are an error-correction channel, not the
acquisition channel.
— Tom M. Mitchell et al., *Never-Ending Learning*, CACM 61(5), 2018 —
https://www.cs.cmu.edu/~tom/pubs/NELL-CACM-2018.pdf

**The original slot-ordering rule, and its normative descendant: select on a
guard condition, and never re-ask what was volunteered.** GUS: "It goes through
the slots of this instance attempting to find fillers for them… systematically
completing work on a given slot before continuing to the next. **This is how GUS
attempts to retain the initiative in the dialog.** Notice, however, that slots may
occasionally be filled out of sequence either through information volunteered by
the client." The authors state the arbitration explicitly: "GUS attempts to retain
the initiative, **but not to the extent of jeopardizing the natural flow of the
conversation**." VoiceXML's Form Interpretation Algorithm makes this
machine-checkable: "**the first form item whose guard condition is false is chosen
to be visited**," termination is by exhaustion ("If no guard condition is false...
the FIA does an implicit `<exit>`"), and out-of-order input is handled
structurally — the algorithm "skips the select and collect phases, and goes right
to the process phase with that input."
— Bobrow, Kaplan, Kay, Norman, Thompson & Winograd, *GUS, A Frame-Driven Dialog
System*, Artificial Intelligence 8(2), 1977 —
https://nlp.stanford.edu/acvogel/gus.pdf ; W3C, *VoiceXML 2.0*, 2004, §2.1.1,
§2.1.6.2.1 — https://www.w3.org/TR/voicexml20/

**The three-way confidence band is universal practice with no principled setting
— and confirming everything is measurably the worst policy.** Williams & Young
describe the convention (`reject` / `low` / `hi` at thresholds around 0.4 and
0.8) and then dismantle it: "there is **no principled way** of setting the
confidence threshold... In practice a developer will look at expected
accept/reject figures and use intuition," costs "are specified in immediate
terms, whereas in practice the decisions have long-term effects... **one recent
study found that for many interactions, the optimal confidence threshold was
zero**" (Bohus & Rudnicky 2005b, cited by them; **second-hand**). Their own
experiment: of three hand-crafted policies, "HC3, **which confirms all inputs,
performs least well**… requiring 2 consistent recognition results… gives rise to
longer dialogs which outweigh the benefit of the increase in accuracy."
— Williams & Young, *Partially Observable Markov Decision Processes for Spoken
Dialog Systems*, Computer Speech and Language 21(2), 2007 —
http://mi.eng.cam.ac.uk/~sjy/papers/wiyo07.pdf

**Acquire-versus-verify is not two mechanisms; it is two actions scored in one
currency.** Paek & Horvitz's Quartet scores an action set spanning *no repair*,
*acknowledge*, *do the relevant action*, *display confusion to elicit
user-initiated repair*, and *confirm by clarification* — where clarification "can
either be general… or **indicative of the specific level of grounding failure**."
Then a second, refining step: "**VOI analysis identifies the best evidence to
observe in light of the inferred probabilities.**"
— Tim Paek & Eric Horvitz, *Conversation as Action Under Uncertainty*, UAI 2000 —
https://arxiv.org/abs/1301.3883

**LLM-era: the model writes the question rather than picking it, and the choice
of question *form* is the live design knob.** GATE compares three information-
gathering policies: **generative active learning** (generate a concrete labellable
scenario — "provides concrete scenarios to the user, including some they may not
have considered otherwise"), **generative yes/no questions** ("elicit more
abstract preferences while still being easy for the user to answer"), and
**generative open-ended questions** ("elicit the broadest and most abstract pieces
of knowledge at the potential cost of being overly broad or challenging for the
user to answer"). Result: "generative yes/no questions improve over user-written
prompts in **every** setting studied," and users report elicitation "requires less
effort than prompting or example labeling and surfaces novel considerations not
initially anticipated by users."
— Li, Tamkin, Goodman & Andreas, *Eliciting Human Preferences with Language
Models*, arXiv 2023 / ICLR 2025 — https://arxiv.org/abs/2310.11589

**A scalar "knowledge gap" that triggers the question.** CPER computes persona
uncertainty by self-consistency — sample n responses, embed, take mean pairwise
cosine dissimilarity — then combines it with alignment to the stored profile:
`KG_t = 1 + (α·u_t − β·WCMI(p_t, P_attended))`. "Uncertainty in persona facts
increases KG_t… while strong alignment with existing knowledge reduces it," and
high KG_t drives "prompting targeted clarification questions" instead of guessing.
The evaluation is weak (GPT-4-judge A/B, workshop paper); the useful part is the
*form* of the trigger — sampling-based uncertainty minus profile alignment.
— Baskar, Verlekar, Parthasarathy & Gaur, *From Guessing to Asking: Resolving
Persona Knowledge Gap in LLMs during Multi-Turn Conversations*, NAACL 2025 SRW —
https://aclanthology.org/2025.naacl-srw.42/

---

# 6. Mixed-initiative dialogue policy

**Asking is a third action between doing nothing and acting, bounded by two
thresholds.** Horvitz computes expected utility for action versus inaction, which
"cross at a specific threshold probability, referred to as `p*`," then adds
dialogue: "the utility of engaging in a dialog with a user when the user does not
have the goal in question is typically **greater** than the utility of performing
an action when the goal is not desired. However, the utility of asking a user
before performing a desired action is typically **smaller** than the utility of
simply performing a desired action… action can be guided by **two new threshold
probabilities**: the threshold between inaction and dialog, `p*_¬A,D`, and the
threshold between dialog and action, `p*_D,A`." Below the first, stay quiet;
between them, ask; above the second, act. Of his twelve principles, four bear
directly: "Considering the status of a user's attention in the timing of services
— Agents should… consider the costs and benefits of **deferring** action to a
time when action will be less distracting"; "**Employing dialog to resolve key
uncertainties**… considering the costs of potentially bothering a user
needlessly"; "Scoping precision of service to match uncertainty — a preference
for 'doing less' but doing it correctly"; and "Maintaining working memory of
recent interactions."
— Eric Horvitz, *Principles of Mixed-Initiative User Interfaces*, CHI 1999 —
https://erichorvitz.com/chi99horvitz.pdf

**Initiative is a ladder, and its top rung has three explicit criteria.** Allen's
four levels run from *unsolicited reporting* through *subdialogue initiation*
("the system has temporarily taken the initiative until the issue is clarified.
**Initiative then reverts to the user**") and *fixed subtask initiative* to
*negotiated mixed initiative*, where "each agent **constantly monitors the current
task and evaluates whether it should take the initiative**, basing this decision
on many factors, including: the agent's capability to effectively coordinate the
current subtask… the other demands on the agent at the present time… and the
other agents' evaluations of their own capability." When the system learns
something urgent mid-thread, he states the choice as a concrete four-way menu:
"interrupt the user with a notification of the problem; wait for the user to
finish but then ignore the question and notify the problem; answer the question
and then state the problem; or wait until later… The right decision here requires
**balancing the importance of the problem, the status of the [current topic], and
other 'social' constraints**."
— Allen, Guinn & Horvitz, *Mixed-Initiative Interaction*, IEEE Intelligent
Systems 14(5), 1999 —
https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/mixedinit.pdf

**Separate who is driving the task from who is driving the topic; they diverge
about a quarter of the time.** Chu-Carroll & Brown: "an agent is said to have the
**task initiative** if she is directing how the agents' task should be
accomplished," while **dialogue initiative** "tracks the lead in determining the
current discourse focus." In TRAINS91, "in **approximately 1/4 of the turns**, the
agents' behavior can be better accounted for by tracking the two types of
initiatives separately." The cues are the actionable part: repetitions and
prompts ("Yeah", "Ok", "Right") "suggest that the speaker has nothing more to say
and indicate that the hearer should take over the initiative"; domain questions
shift only dialogue initiative; obligation-fulfilled reverts initiative "back to
the hearer who held the initiative prior to the request"; and analytical cues —
invalidity, suboptimality, ambiguity, recognisable only against private knowledge
— license the hearer to "initiate a subdialogue to resolve the problem."
— Chu-Carroll & Brown, *Tracking Initiative in Collaborative Dialogue
Interactions*, ACL 1997 — https://aclanthology.org/P97-1034/

**Take initiative per-goal, only where your competence for *that* goal exceeds
your partner's, recomputed continuously.** Guinn: "we attach an initiative level to
**each goal** in the task tree. Thus an agent may have initiative over one goal
but not another… Thus **many initiative changes are done implicitly** based on
which goal is being solved." The competence rule: "ask the collaborator for help
if it is believed that the collaborator has a better chance of solving the goal
(or solving it more efficiently)." His measured comparison is the finding:
**Continuous** re-evaluation ("the more knowledgeable agent — defined by which
agent's first-ranked branch is more likely to succeed — is initially given
initiative. If that branch fails, this agent's second-ranked branch is compared
to the other agent's first-ranked branch") performs "between **15–20% better**"
than picking a leader once and running master-slave.
— Curry I. Guinn, *Mechanisms for Mixed-Initiative Human-Computer Collaborative
Discourse*, ACL 1996 — https://aclanthology.org/P96-1037/

**In a POMDP manager, ask/confirm/act falls out of belief mass — and the reward
function is where the pathology lives.** The system "maintains a distribution `b_t`
over all possible dialogue states… choosing its next action not based on the most
likely state but on the probability distribution across all states," with the
pleasant consequence that "**user persistence is rewarded**." But: "**most
statistical dialogue systems are trained to maximise success whilst minimising the
length of the dialogue**" — concretely "+20 for a successful dialogue minus the
dialogue length." Williams & Young make the failure explicit: with their reward, "a
dialog which requires 15 turns to arrive at the correct answer (receiving
−1·15+10 = −5) obtains **the same reward** as one in which the system immediately
abandons the interaction via the fail action." A thorough interviewer optimising a
turn-penalised success proxy learns to give up. They also note PARADISE-style
learned rewards collapse to the same two predictors: "in practice the dialogue
success rate and the dialogue length are typically the most important
predictors."
— Young, Gašić, Thomson & Williams, *POMDP-based Statistical Spoken Dialog
Systems: A Review*, Proceedings of the IEEE 101(5), 2013 —
http://mi.eng.cam.ac.uk/~sjy/papers/ygtw13.pdf ; Williams & Young 2007 (above)

**Agenda as a hard filter on the candidate set; responsiveness as the choice
within it.** Tang et al. name the two competing desiderata — "**transition
smoothness**… and **target achievement**" — and observe "an agent cannot simply
bring up the target content regardless of the conversation context." Their
arbitration is the clean part: "We maintain smooth conversation transition by
**turn-level supervised learning** on open-domain chat data, and we inject
target-guiding behavior with a **rule-based** guiding strategy." The rule is
monotone progress — "the keyword of each turn must **move strictly closer to the
end target**" — and then "the above constraint first collects a set of valid
candidates, and the turn-level transition module **samples or picks the most
likely one from the set**. In this way, the predicted keyword for next response
can be both a smooth transition and an effective step towards the target."
— Tang, Zhao, Xiong, Liang, Xing & Hu, *Target-Guided Open-Domain Conversation*,
ACL 2019 — https://aclanthology.org/P19-1565/

---

# 7. Spaced repetition, scheduling, and decay in user models

**Leitner: promotion on first-attempt success, total demotion otherwise — and the
schedule belongs to the box, not the card.** "The card with the answer you know at
first presentation goes into the next compartment. **All others go back to the
very first compartment.**" Two details usually lost in retellings: the
compartments are deliberately unequal in size ("the first compartment is very
small, 20 to 30 cards"), and there is a hard floor on gap ("at least 8 hours").
Three failures follow: interval is a property of the box, so difficulty is
ignored; correctness is binary, so agonised recall counts as easy recall; and
demotion discards the entire history of a card that had survived four boxes.
(Rule text **second-hand**; Leitner's 1972 book is not digitized.)
— Sebastian Leitner, *So lernt man lernen*, Herder 1972 —
https://en.wikipedia.org/wiki/Sebastian_Leitner ; rule text from
https://de.wikipedia.org/wiki/Lernkartei

**SM-2, and the two admissions in Wozniak's own prose.** The algorithm: "I(1):=1,
I(2):=6, for n>2: I(n):=I(n-1)*EF"; grades 0–5; `EF' := EF + (0.1 − (5−q) *
(0.08 + (5−q) * 0.02))`, floored at 1.3; and "**If the quality response was lower
than 3 then start repetitions for the item from the beginning without changing
the E-Factor.**" The admissions matter more than the formula. It is not derived:
"The formula used in calculating new E-Factors for items was **constructed
heuristically**." And the 1.3 floor is a diagnostic, not a tuning constant: "Items
having E-Factors lower than 1.3 were repeated annoyingly often and **always
seemed to have inherent flaws in their formulation**… thus not letting E-Factors
fall below 1.3… **provided an indicator of items that should be reformulated**."
When an item keeps failing, the scheduler is the wrong place to fix it — the
question is wrong, and the right output is a rewrite.
— Piotr A. Wozniak, *Algorithm SM-2*, from *Optimization of learning*, MSc thesis,
Poznan, 1990 — https://super-memory.com/english/ol/sm2.htm

**The expanding-interval premise underlying both Leitner and SM-2 is not
established.** Ebbinghaus fixes the shape of forgetting — "after 24 hours about
one third was always remembered; after 6 days about one fourth, and after a whole
month fully one fifth" — and Cepeda et al.'s synthesis of 839 assessments across
317 experiments fixes the scheduling interaction: "for a given retention
interval, there was a **nonzero value of ISI that optimized accuracy**… Moreover,
the optimal ISI increased as retention interval increased… These results clearly
show that **a single ISI does not produce optimal retention across a wide range
of retention intervals**." But on expansion specifically: "Some researchers have
suggested, **with little apparent empirical backing**, that expanding ISIs improve
long-term learning… Our review of the evidence suggests that, in general,
**expanding intervals either benefit learning or produce effects similar to
studying with fixed spacing.**"
— Ebbinghaus, *Memory*, 1885 (trans. 1913), ch. 7 —
https://psychclassics.yorku.ca/Ebbinghaus/memory7.htm ; Cepeda, Pashler, Vul,
Wixted & Rohrer, *Distributed Practice in Verbal Recall Tasks*, Psychological
Bulletin 132(3), 2006 — https://augmentingcognition.com/assets/Cepeda2006.pdf

**The one quantitative scheduling law: the optimal gap is a fraction of the
retention interval, and that fraction shrinks as the interval grows.** Measured
optima across 1,350+ people: "For the RIs of 7, 35, 70, and 350 days, the optimal
gaps… were **1, 11, 21, and 21 days**." Four constraints on the retention surface,
of which the fourth is counterintuitive: "as RI increases, **the ratio of optimal
gap to RI must decline**… the optimal gap for RI = 350 equals 23 days, which is
**just 7% of the RI**." The magnitude is not marginal: "for a fixed amount of
study time, the optimal gap provided a **64% increase, d = 1.1, in final
recall**." Their conclusion is liftable as a design sentence: "**if you want to
know the optimal distribution of study time, you need to decide how long you wish
to remember something.**" Any scheduler with a fixed multiplier is silently
optimising for an undeclared retention target.
— Cepeda, Vul, Rohrer, Wixted & Pashler, *Spacing Effects in Learning: A Temporal
Ridgeline of Optimal Retention*, Psychological Science 19(11), 2008 —
https://files.eric.ed.gov/fulltext/ED505660.pdf

**Desirable difficulty — and the warning about who gets conditioned.** Bjork's
rule: "**a variety of manipulations that impede performance during training
facilitate performance on the long term**." The failure mode is about the
questioner, not the schedule, and it transfers exactly to an agent tuned on
session-level satisfaction: "the typical trainer is overexposed… to the day-to-day
performance and evaluative reactions of his or her trainees. A trainer, in
effect, is **vulnerable to a type of operant conditioning**, where the reinforcing
events are improvements in the performance and/or happiness of trainees. Such a
conditioning process, over time, can act to shift the trainer toward manipulations
that increase the rate of correct responding — that make the trainee's life
easier… **Doing that, of course, will move the trainer away from introducing the
types of desirable difficulties.**" Note the tension with Cepeda: Bjork endorses
expanding retrieval, the meta-analysis finds no reliable advantage over fixed
spacing. Expansion is not settled.
— Robert A. Bjork, *Memory and Metamemory Considerations in the Training of Human
Beings*, in *Metacognition*, MIT Press 1994 —
https://gwern.net/doc/psychology/spaced-repetition/1994-bjork.pdf

**Staleness in deployed user models: do not decay old data — model the
time-varying part explicitly.** Koren's headline result is the opposite of the
intuitive fix: "**instance decay approaches cannot work, as they lose too much
signal when discarding data instances**." He tested it directly: "trying different
exponential time decay rates… **prediction quality improves as we moderate that
time decay, reaching best quality when there is no decay at all**." What replaces
decay is separation — a time-invariant part plus explicit drifting components
(user bias b_u(t), binned item bias, drifting factor vectors) — with decay, where
used, learned per user: "exponential decay formed by the function e^{−β_u·Δt},
where β_u > 0 controls the **user specific** decay rate and should be learnt." And
a scoping constraint: "in general, **we do not try to extrapolate future temporal
dynamics**" — the temporal model explains the past so it can clean the stable
part.
— Yehuda Koren, *Collaborative Filtering with Temporal Dynamics*, KDD 2009 —
https://faculty.cc.gatech.edu/~zha/CSE8801/CF/kdd-fp074-koren.pdf

**"When is a recorded belief due for a still-true check" has no literature. What
exists answers a different question, and its swing is the finding.** Converse's
black-and-white model posits a "hard core" of crystallized, stable opinion plus a
remainder whose "response sequences over time are statistically random" — people
who "for lack of information about a particular dimension of controversy, offer
meaningless opinions that vary randomly in direction during repeated trials." His
measured turnover correlation was **.24**. He also reports the moderator that
matters most here: for respondents whose open-ended commentary showed
"'self-starting' concern about particular controversies," "the turnover
correlations for these limited subpopulations **did increase substantially**."
Ansolabehere, Rodden & Snyder then showed most of that instability was
measurement error: averaging many items on one issue area yields an "average
intertemporal correlation [of] **.77**," where a 4-item scale gives .63 and a
single item roughly .41 — "this stability increases steadily as the number of
survey items increases." The implication for a revisit rule: **an answer that
flips between sessions is more likely one noisy measurement than a changed
belief, and the cheap correction is to ask the same construct several ways rather
than to re-ask the same question sooner.** (Schwartz value test-retest figures —
roughly .65–.69 at one year — are **second-hand** from search summaries; verify
before citing.)
— Philip E. Converse, *The Nature of Belief Systems in Mass Publics*, 1964 —
https://web.ics.purdue.edu/~hoganr/Soc%20312/The%20nature%20of%20belief%20systems%20in%20mass%20publics%201964.pdf
; Ansolabehere, Rodden & Snyder, *The Strength of Issues*, APSR 102(2), 2008 —
https://web.stanford.edu/~jrodden/issues_apsr.pdf

---

# 8. Socratic questioning and creative-disruption frameworks

**Paul & Elder's six types are licensed by universal features of thought, so any
statement exposes all six targets at once.** "It is helpful to recognize, in light
of the universal features in the logic of human thought, that there are
**identifiable categories of questions for the adept Socratic questioner to dip
into**: questions of clarification, questions that probe assumptions, questions
that probe reasons and evidence, questions about viewpoints or perspectives,
questions that probe implications and consequences, and questions about the
question." The licensing rule is a standing conditional: "**All thought is
responsive to a question. Assume that you do not fully understand a thought until
you understand the question that gives rise to it.**" Their companion "Four
Directions" model narrows the menu to a directional choice on any statement:
backward to origin, downward to support, sideways to objections, forward to
implications.
— Richard Paul & Linda Elder, *The Thinker's Guide to the Art of Socratic
Questioning*, 2006, p. 13 —
https://www.criticalthinking.org/files/SocraticQuestioning2006.pdf ; Paul,
*Critical Thinking*, 1990, ch. 19 —
https://jgregorymcverry.com/readings/Paul%20-%201990%20-%20Critical%20Thinking%20What%20Every%20Person%20Needs%20To%20Survive%20in%20a%20Rapidly%20Changing%20World.pdf

**Three modes, each with a stated trigger — this is the explicit "when"
policy.** "We distinguish three general categories of Socratic questioning:
spontaneous, exploratory, and focused… **All three require judgment in
determining when to ask which kind of question.**" *Spontaneous* fires on states,
not plans: "especially useful **when students become interested in a topic; when
they raise an important issue; when they are on the brink of grasping or
integrating a new insight; or when discussion becomes bogged down, confused, or
hostile**," and "by definition there can be **no preplanning**." *Exploratory* is
the survey mode: "appropriate in order to **find out what students know or think**
on a variety of issues… to identify where students are clear and where they are
fuzzy," and it "raises and explores a **broad range of interrelated issues and
concepts, not just one**." *Focused* is the depth mode and "**requires
preplanning**."
— Paul & Elder, "Critical Thinking: The Art of Socratic Questioning, Part III,"
*Journal of Developmental Education* 31(3), 2008 —
https://files.eric.ed.gov/fulltext/EJ832681.pdf

**The generation rule: build each question from the last answer, and answer
nothing.** "Think aloud as you lead the discussion. Don't rush. **Base each of
your questions on the answer given by the last student.**" The closure rule is
absolute: "by the rules of Socratic questioning **you are allowed only to ask
questions. You are not allowed to answer any questions, except by asking another
question.**" Their own assessment checklist opens with: "**Did the questioner
respond to all answers with a further question?**"
— Paul & Elder, *Thinker's Guide*, 2006, pp. 10, 24 (above)

**Clean Language: the question is *constructed*, not selected, from a fixed frame
plus the person's exact words.** The syntax: "And [pacing client's words] + And
as/when + [question] + [refer to this particular experience]" — e.g. "C: I've gone
blank. T: **And** you've gone blank. **And when** you've gone blank, **what kind
of** blank **is that** blank?" The licensing rule is stated flatly: "**The
facilitator is only allowed to use the client's words and the precise wording of
the questions. Facilitators do not add any words of their own.**" Two corollaries:
"**paraphrasing is not part of Clean Language.** Every paraphrase introduces
something new into the conversation and therefore potentially reframes it"; and
clean questions "**do not reference the facilitator** — for example, we do not ask
the client to 'tell me about…'"
— Penny Tompkins & James Lawley, "Less is More… The Art of Clean Language,"
*Rapport* 35, 1997 — https://cleanlanguage.com/less-is-more-the-art-of-clean-language/

**Which clean question is licensed by which feature of the utterance — and the
line between unconditional and conditional questions.** The nine basic questions
map to five classes of information: "the **attributes** of a symbol… the
**location** of a symbol within perceptual space… a **subsequent event** (after)…
a **previous event** (before)… a **shift from conceptual or abstract description
to an equivalent metaphor**." Crucially: "**The basic nine clean questions are
context independent and can be asked almost anytime.**" Everything beyond them is
gated: "we identified a further 20 or so specialised questions… **The specialised
questions are only clean when the client has stated or presupposed a relevant
context exists in their Landscape.**" The worked demotion is the clearest single
licensing test in the whole corpus: "in the metaphor 'I need to let go of my
anger,' anger is referred to as if it is something that can be 'let go of.'
Therefore it is clean to ask ['size or shape?']… Whereas 'I need to feel angry'
characterises anger as a sensation which may or may not be thing-like.
**Therefore it would not be clean to ask** the 'Size or shape?' question." The
selection procedure is two-step: "**first** the facilitator decides which sphere
of perception they would like the client to attend to, **and then** they ask a
question that invites them to attend to that part of their experience."
— Lawley & Tompkins, "Clean Language Revisited," *Rapport*, 2004 —
https://cleanlanguage.com/clean-language-revisited/

**GROW: goal before reality by design, recycling not linear — and never
tested.** Whitmore's justification for the order is a contamination argument:
"goals based on current reality alone are liable to be negative, a response to a
problem, limited by past performance, lacking in creativity due to simple
extrapolation." The loop-back rule: "It is, however, subject to recycling… one may
only be able to define a vague GOAL until one has examined the REALITY in some
detail." And his own caveat: "**GROW, without the context of AWARENESS and
RESPONSIBILITY and the skill of questioning to generate them, has little value.**"
Then the honest verdict on evidence. Grant, proposing a revision, concedes:
"**there has been little or no debate in the literature about the use of session
structures… or the relative advantages or disadvantage of different specific
session structure frameworks.**" The surrounding literature validates *coaching*,
never *this ordering*: Jones, Woods & Guillaume report δ = 0.36 (k = 17) with no
moderation by format or duration; de Haan et al. find outcomes track working
alliance and client self-efficacy, a common-factors result that argues against any
specific procedure carrying the effect. **GROW's sequence has never been compared
against a permuted or absent sequence in a controlled trial.**
— Whitmore, *Coaching for Performance*, 1992/2002 —
https://archive.org/details/coachingforperfo0000whit ; Grant, "Is it time to REGROW
the GROW model?", *The Coaching Psychologist* 7(2), 2011 —
https://doi.org/10.1002/9781119835714.ch3 ; Jones, Woods & Guillaume 2016 —
https://doi.org/10.1111/joop.12119 ; de Haan et al. 2013 —
https://doi.org/10.1037/a0031635

**Oblique Strategies: state-triggered deployment, mandatory acceptance.** The
original box card states both rules: "They can be used as a pack… **or by drawing
a single card from the shuffled pack when a dilemma occurs in a working
situation. In this case, the card is trusted even if its appropriateness is quite
unclear.**" Eno's rationale explains why the acceptance must be involuntary: "**the
panic of the situation** — particularly in studios — tended to make me quickly
forget that there were other ways of working… **If you're in a panic, you tend to
take the head-on approach because it seems to be the one that's going to yield the
best results. Of course, that often isn't the case.**" The card fires precisely
when the operator's judgment is degraded and would otherwise pick the obvious
move — which is why the operator does not get to veto the draw.
— Brian Eno & Peter Schmidt, *Oblique Strategies*, 1975, box text; Eno interview
with Charles Amirkhanian, KPFA-FM, 1 Feb 1980 — both in Gregory Taylor, "The
More-Or-Less Complete and True History of the Oblique Strategies," 1995 —
http://music.hyperreal.org/artists/brian_eno/osfaq2.html

**The evidence that randomness helps thinking is real, small, conditional, and
reversible at the extremes.** Sio & Ormerod's meta-analysis of 114 effect sizes
found a **weighted mean effect of 0.29, 95% CI [0.21, 0.39]**. The
policy-relevant moderator: by distractor load, low cognitive load 0.52 (k=22) and
rest 0.46 (k=16) versus high load 0.24 (k=76) — but the subgroup comparisons were
**not** significant, and the moderator claim rests on the regression stage, where
longer preparation predicted a larger incubation effect (β = .03, p < .05),
holding for visual (r = .40) and creative (r = .60) problems but **not**
linguistic ones (r = −.04). Translation: the interruption pays only after real
work has been done. On stimulus distance, Chan et al. found far, less-common
examples produced more novel concepts than a no-example control — and the same
group's follow-up supplies the ceiling: "although the literature has shown that
'far' analogical stimuli are more likely to lead to the generation of innovative
solutions… **there is such a thing as too far.** That is, if the stimuli are too
distant, they then can become harmful to the design process." It is an inverted U.
**No empirical study tests Oblique Strategies, and none tests de Bono's random
word against a control.**
— Sio & Ormerod, *Does incubation enhance problem solving? A meta-analytic
review*, Psychological Bulletin 135(1), 2009 — https://doi.org/10.1037/a0014212 ;
Chan et al., *J. Mechanical Design* 133(8), 2011 —
https://doi.org/10.1115/1.4004396 ; Fu et al., *The Meaning of "Near" and "Far"*,
JMD 135(2), 2013 — https://doi.org/10.1115/1.4023158

---

# 9. Curiosity-driven agents, and LLM agents that model a user by asking

**Prediction-error maximisation is the failure mode; learning progress is the
fix.** Oudeyer, Kaplan & Hafner state the trap plainly: an agent choosing "the one
for which metaM predicts the largest error in prediction of M" works only when
the mapping is "learnable, deterministic, and with homogeneous Gaussian noise."
Otherwise "a robot using this method will, for example, be stuck by white noise
or, more generally, by situations which are inherently too complex for its
learning machinery or situations for which the causal variables are not
perceivable or observable by the robot." IAC's signal is the derivative instead —
"the local derivative of the error rate curve of M… positive when the error rate
decreases, and negative when it increases. This ensures that the robot will not
stay in front of white noise for a long time or in unlearnable situations because
this does not lead to a decrease of its errors in prediction." The abstract names
the resulting behaviour as the target: the drive "makes the robot focus on
situations which are neither too predictable nor too unpredictable." Critically,
IAC computes progress **per region** of the space, not globally — which is what
lets it abandon one topic and keep another.
— Oudeyer, Kaplan & Hafner, *Intrinsic Motivation Systems for Autonomous Mental
Development*, IEEE Trans. Evolutionary Computation 11(2), 2007 —
http://www.pyoudeyer.com/ims.pdf

**The typology names the alternatives, so you can see which one you accidentally
built.** The knowledge-based/predictive family enumerates distinct reward
functions over the same predictor: *predictive novelty* (highest prediction
error), *intermediate level of novelty* (reward peaks at a threshold, criticized
because "having a single threshold for the whole sensorimotor space might even be
quite problematic in practice"), *learning progress*, *predictive surprise*
("actually high error in prediction but a low level of error was expected"), and
*predictive familiarity*. The competence-based branch rewards progress toward
*self-generated goals* rather than progress in prediction, and they warn the two
diverge: "the capacity to predict what happens in a situation is only loosely
coupled to the capacity to modify a situation in order to achieve a given
self-determined goal." That fork is live for an interviewer — "can I predict their
next answer?" is not "am I getting better at the thing I am here to do?"
— Oudeyer & Kaplan, *What is intrinsic motivation? A typology of computational
approaches*, Frontiers in Neurorobotics 1:6, 2007 —
https://doi.org/10.3389/neuro.12.006.2007

**Schmidhuber: the reward is the first derivative, and Shannon novelty is
explicitly rejected.** The formal reward is
`r_int(t+1) = C(p(t), h(≤t+1)) − C(p(t+1), h(≤t+1))`, with the constraint that
"both the old and the new model have to be tested on the same data, namely, the
history so far" — progress is measured by re-scoring the *old* model against what
you now know, not by how surprised you were in the moment. The rejection is
direct: an agent facing "a screen full of white noise conveying a lot of
information and 'novelty' and 'surprise' in the traditional sense of Boltzmann
and Shannon… will experience highly unpredictable and fundamentally
incompressible data… the data is not surprising but boring as it does not allow
for further compression progress — there is no novel pattern. Therefore the
traditional notion of surprise is rejected."
— Jürgen Schmidhuber, *Formal Theory of Creativity, Fun, and Intrinsic Motivation
(1990–2010)*, IEEE Trans. Autonomous Mental Development 2(3), 2010 —
https://people.idsia.ch/~juergen/ieeecreative.pdf

**Deep RL confirmed the trap literally, and both fixes change what you measure
error against.** Burda et al. built the noisy TV as an actual environment: "The
idea is that local sources of entropy in an environment like a TV that randomly
changes channels when an action is taken should prove to be an irresistible
attraction to our agent… As expected the presence of the TV drastically slows
down learning." They generalise the cause beyond genuine randomness —
"stochasticity caused by a poor learning algorithm, an impoverished model class
or partial observability can lead to exactly the same problem" — which is the
version that bites an interviewer, since a person's answers are "stochastic" only
relative to the model's current capacity. Pathak et al. move prediction into an
inverse-dynamics feature space that "critically, ignores the aspects of the
environment that cannot affect the agent." RND replaces the stochastic target with
a deterministic one, and concedes why: methods that "quantify the relative
improvement of the prediction, rather than its absolute error… are hard to
implement efficiently."
— Burda, Edwards, Pathak, Storkey, Darrell & Efros, *Large-Scale Study of
Curiosity-Driven Learning*, ICLR 2019 — https://arxiv.org/abs/1808.04355 ; Pathak
et al., *Curiosity-driven Exploration by Self-supervised Prediction*, ICML 2017 —
https://arxiv.org/abs/1705.05363 ; Burda, Edwards, Storkey & Klimov, *Exploration
by Random Network Distillation*, ICLR 2019 — https://arxiv.org/abs/1810.12894

**Generative Agents: the agent asks itself what questions its recent life
raises, and uses those as retrieval queries.** The trigger is an accumulator, not
a schedule: "we generate reflections when the sum of the importance scores for
the latest events perceived by the agents exceeds a threshold (150 in our
implementation). In practice, our agents reflected roughly two or three times a
day." Then a single prompt over the recent window: "we query the large language
model with the 100 most recent records… and prompt the language model, 'Given only
the information above, what are 3 most salient high-level questions we can answer
about the subjects in the statements?'" The questions become retrieval queries;
retrieved memories feed insight extraction; insights are stored as memories, so
reflections can reflect on reflections.
— Park, O'Brien, Cai, Morris, Liang & Bernstein, *Generative Agents: Interactive
Simulacra of Human Behavior*, UIST 2023 — https://arxiv.org/abs/2304.03442

**The 1,000-people work: a fixed script plus adaptive follow-ups, with
objective-satisfaction as the signal — and elicited narrative beats structured
attributes.** Protocol: the American Voices Project schedule, chosen deliberately
because it was "design[ed] independent of any of our evaluation tasks."
Voice-to-voice interviews "averaging about two hours and producing transcripts
with an average length of 6,491 words per participant." Two prompts run per turn:
a summariser, and a follow-up generator whose instruction is "Interview objective:
By the end of this conversation, the interviewer has to learn the following:
<the question in the interview script, paraphrased as a learning objective>… 1)
Assess the interview progress by reasoning step by step… While staying on the
current topic, what kind of follow-up questions should the interviewer further ask
the interviewee to better achieve your interview objective? 2) Author the
interviewer's next utterance." The signal is competence-based in Oudeyer's sense —
distance to a pre-specified learning objective — bounded by a hand-set per-question
time budget and a hard two-hour cap. There is no curiosity term and no measure of
how much the model of the person changed. Results: interview-grounded agents hit
83–85% of participants' own two-week test-retest accuracy on the General Social
Survey, versus **74% for demographics-only agents**, with persona-paragraph
baselines also below. And a caveat worth carrying: "gains over either source alone
were modest, suggesting that predictive benefits from data begin to asymptote once
the model has observed sufficient evidence within a domain."
— Park, Zou, Kamphorst, Egan, Shaw, Hill, Cai, Morris, Liang, Willer & Bernstein,
*Generative Agent Simulations of 1,000 People* (v1, Nov 2024; current version
retitled *LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of
Individuals*) — https://arxiv.org/abs/2411.10109

**Probing, not the opener, is where the information is — quantified.** Chopra &
Haaland's AI interviewer "is given a topic guide… Depending on the conversation
history, the AI interviewer either asks a 'probing question' to increase the depth
and breadth of the conversation or moves on to the next topic," formalised as "a
state-dependent probability distribution over the set of questions, with the
conversation history as the primary state variable." Coding the full interview
versus the first answer alone: "respondents are assigned **5.9 codes** on average
for the full interview, [but] only **2.3 codes** on average based on the first
question," and the single most common factor "is assigned to 83.5% of the full
interviews but only 55.7% of the first responses, giving it an odds ratio of 4.0."
Their qualitative reading is the sharpest warning against trusting first answers:
initial "low income and savings" explanations were surface explanations; probing
revealed it was "not a lack of funds per se, but the fear of making losses." 395
interviews.
— Chopra & Haaland, *Conducting Qualitative Interviews with AI*, CEBI/CESifo
Working Paper 06-23, 2023 —
https://www.econ.ku.dk/cebi/publikationer/working-papers/CEBI_WP_06-23.pdf

**Left to themselves, LLMs ask low-information, descriptive questions — and this
is measurable.** Mazzaccara, Testoni & Bernardi: "large language models,
especially open-source models, often perform poorly in generating informative
questions, as measured by expected information gain (EIG)… their questions are
characterised by low informativeness and limited success," where "the EIG measures
questions' informativeness as the (expected) entropy reduction caused by a certain
question in the space of possible items." Independently, Ai et al. characterise
*how* they go generic: across Llama-3.3, DeepSeek-V3, Claude-3.7 and GPT-4o,
"Descriptive/Characterization" questions make up **27–45%** of LLM-generated
questions versus **1.5–3.0%** in human-authored TriviaQA/HotpotQA, while
Identity/Attribution questions collapse from 34–40% (human) to 9–15% (LLM);
overall LLM questions "exhibit more evenly distributed context focus." That even
distribution is the anti-curiosity signature — the model spreads attention
uniformly instead of concentrating where the payoff is.
— Mazzaccara, Testoni & Bernardi, *Learning to Ask Informative Questions*,
Findings of EMNLP 2024 — https://aclanthology.org/2024.findings-emnlp.291/ ; Ai et
al., *Can LLMs Ask Good Questions?*, arXiv:2501.03491, 2025 —
https://arxiv.org/abs/2501.03491

---

# 10. Systems, cybernetics, and complexity

The previous nine fields answer *which question next* from inside an optimisation
frame. This one asks a prior question — what kind of thing is being questioned,
and what does that make possible — and it changes several answers.

**Ashby's Law of Requisite Variety: the agent's question repertoire is a hard
ceiling on how much of a person it can resolve.** The counting argument first:
"If next R uses, or has available, two moves, then the variety of the outcomes
can be reduced to a half (but not lower). If R has three moves, it can be reduced
to a third (but not lower)… Only variety in R's moves can force down the variety
in the outcomes." Then the law: "This is the law of Requisite Variety. To put it
more picturesquely: **only variety in R can force down the variety due to D;
variety can destroy variety.**" And the restatement that makes it a bandwidth
claim: "The law of Requisite Variety says that R's capacity as a regulator cannot
exceed R's capacity as a channel of communication." This is the strongest
available argument that a fixed curated list cannot suffice: a Question Bank of
*n* openers has variety *n*, and the residual uncertainty about a person is
bounded below by whatever their variety exceeds it. Composed questions are the
only unbounded source. *(Note: Ashby never uses the phrase "law of requisite
knowledge," and "attenuation" does not occur in the book at all — both are later
coinages, the second Beer's.)*
— W. Ross Ashby, *An Introduction to Cybernetics*, Chapman & Hall 1956, §§11/6–7
pp. 206–207 and §11/11 p. 211 — http://pespmc1.vub.ac.be/books/IntroCyb.pdf

**Successful regulation blocks the channel that carries the information the
regulator needs — so small errors must be permitted deliberately.** This is
exploration-versus-exploitation, stated in 1956 and sharper than most modern
versions: "Suppose R is somehow regulating successfully; then this would imply
that the variety at E is reduced below that of D—perhaps even reduced to zero.
**This very reduction makes the channel D→T→E to have a lessened capacity**; if E
should be held quite constant then the channel is quite blocked. So the more
successful R is in keeping E constant, the more does R block the channel by which
it is receiving its necessary information. Clearly, any success by R can at best
be partial." The resolution: "**Small errors are allowed to occur; then, by
giving their information to R, they make possible a regulation against great
errors.**" An interviewer that only asks questions it expects to answer well
learns nothing about where its model is wrong.
— Ashby 1956, §§12/4–12/6, pp. 222–224 (above)

**Requisite Variety forbids magnifying regulation but permits supplementing it —
and the supplement is legitimately random.** "The law of Requisite Variety, like
the law of Conservation of Energy, absolutely prohibits any direct and simple
magnification but **it does not prohibit supplementation**." And the engineering
definition of "random" that a question-sampler should use: "By saying a factor is
random, I do not refer to what the factor is in itself, but to **the relation it
has with the main system**… Supplementation by 'chance' thus means… supplementation
by taking effects (or variety) from a system whose behaviour is **uncorrelated
with that of the main system**."
— Ashby 1956, §13/18 pp. 258–259 and §§14/4, 14/6 (above)

**Conant & Ashby: model-making is compulsory, and if the person changes the model
must be time-varying.** The theorem: "The simplest optimal regulator R of a
reguland S produces events R which are related to the events S by a mapping
h : S → R. Restated somewhat less rigorously, the theorem says that **the best
regulator of a system is one which is a model of that system**." Non-model
regulators exist but are wasteful: "although not all optimal regulators are models
of their regulands, the ones which are not are all unnecessarily complex." The
clause that matters for a person-model re-elicited over years: "the assumption
that p(S) must exist (and be constant) can be weakened; if the statistics of S
change slowly with time, the theorem holds over any period throughout which p(S)
is essentially constant. As p(S) changes, the mapping h will change appropriately,
so that **a time-varying model will be needed to regulate the time-varying
reguland.**"
— Roger C. Conant & W. Ross Ashby, "Every Good Regulator of a System Must Be a
Model of That System," *International Journal of Systems Science* 1(2), 1970 —
http://pespmc1.vub.ac.be/books/Conant_Ashby.pdf

**Von Foerster: a person is a non-trivial machine, so no finite interview can
determine them — and treating them otherwise is a named error.** A trivial machine
is "independent of the past, and can be synthetically and analytically
determined… We can find out what its transfer function is… by doing simple input
and output experiments." A non-trivial machine carries an internal state that
changes with each operation, and the figure caption gives the four properties:
"**synthetically determined, dependent on its history, cannot be analytically
determined, and is unpredictable.**" The analytical question, put exactly as an
interviewer would put it: "can you use **a finite series of experiments** to
determine the operative properties… Can the rule of transformation be identified?
In the case of nontrivial machines the analytical problem is **in principle
unsolvable**." And the sentence that indicts a naive person-model directly: "A
character often appears as this type of purportedly permanent rule of
transformation. In psychology, it plays the role of the law of nature. A person is
stimulated and his or her so-called character determines his or her response. **The
person has to act in a certain manner and is viewed as a trivial machine.**"
— Heinz von Foerster & Bernhard Pörksen, *Understanding Systems: Conversations on
Epistemology and Ethics*, 2002, ch. "Trivial and nontrivial machines," pp. 54–58 —
https://archive.org/details/understanding_systems (English translation of the 1998
German interview volume; the wording is the translator's)

**Von Foerster: the observer is inside, and the ethical imperative is to expand
the option space.** On the impossibility of standing outside: "if the properties
of the observer, namely, to observe and to describe, are eliminated, there is
nothing left: no observation, no description." And the consequence for a system
that builds profiles: "With the essence of observing, namely the processes of
cognition, being removed, **the observer is reduced to a copying machine**, and the
notion of responsibility has been successfully juggled away." The imperative
itself: "**Tell them they should always try to act so as to increase the number of
choices**; yes, increase the number of choices!" — which he later corrected to a
first-person form, because it is a rule for the observer, not an order to others.
— Heinz von Foerster, "Ethics and Second-Order Cybernetics," Paris 1990, repr.
*Stanford Humanities Review* 4(2), 1995 —
https://web.archive.org/web/2015/http://www.stanford.edu/group/SHR/4-2/text/foerster.html
; and *Understanding Systems*, 2002, pp. 36, 173 (above)

**Beer: the algedonic channel — an urgency signal that bypasses the hierarchy, on
a clock the subsystem sets for itself.** The justification is requisite variety:
"If, we said, many filters are operating to reduce variety within the
organization, System Five may easily be lulled into a sense of false security.
**Special filters would be needed, working on collateral information channels, to
reinstate requisite variety regarding threats to survival.**" The trigger is
failure-to-self-restore within an agreed time: "if an Alpha System One is in
trouble, it will try to get itself out… **If it cannot do that in a reasonable
time**, it… sends an algedonic signal for help." And the governance condition, which
is the design-relevant part: "**It is not difficult to persuade people that their
best interest is served by automatic notification of their difficulties — provided
that they themselves have control of the parameters of the system under which this
will be done.**" Rarity is the health indicator: "if all concerned do their agreed
jobs properly, algedonic signals will rarely be fired." Beer's glossary: "ALGEDONIC
(pain, pleasure); pertaining to regulation in a **non-analytic mode**."
— Stafford Beer, *Brain of the Firm*, 2nd edn., Wiley 1981, pp. 157, 194, 232–233
and Glossary — https://archive.org/details/brain-of-the-firm-reclaimed-v-1

**Beer: System Three versus System Four is the explore/exploit split, and failing
to bridge it is fatal.** "We have found in **System Three the immediate response
mechanism for dealing with internal and current affairs; it has been contrasted
with System Four, dealing with external and future affairs.** That distinction
looked biologically valid. The very fact that the distinction is so profound in
terms of survival capability… **leads to a very special risk of polarization**… So
it is in the brain also, where a failure to bridge this mighty gap would lead to
instant death." And a line worth stealing for a latency budget: "Ultimately,
neither the brain nor the firm is an analyser, but a **recognizer**. That is why
speed of recognition is so important, while analytic power is relatively
unimportant." *(The familiar slogans "inside and now" / "outside and then" are from
*The Heart of Enterprise*, which is lending-restricted; the wording above is the
same idea, first-hand, from* Brain of the Firm.*)*
— Beer, *Brain of the Firm*, 1981, pp. 155, 201 (above). **POSIWID** — "the purpose
of a system is what it does… there is no point in claiming that the purpose of a
system is to do what it constantly fails to do" — is from Beer's 2001 Valladolid
address, published as "What is cybernetics?", *Kybernetes* 31(2), 2002,
doi:10.1108/03684920210417283, and is **second-hand** here: the journal is closed
access and the phrase does not occur in *Brain of the Firm*.

**Bateson: a question that changes how someone thinks moves the *set*, not the
choice inside it.** The definitions are stated as differences of logical type:
"Learning I is change in specificity of response by correction of errors of choice
**within a set of alternatives**. Learning II is change in the process of Learning
I, e.g., a corrective change in the **set of alternatives** from which choice is
made, or it is a change in **how the sequence of experience is punctuated**.
Learning III is change in the process of Learning II." The mechanism: "the
phenomena of Learning II can all be included under the rubric of changes in the
manner in which the stream of action and experience is **segmented or punctuated
into contexts**."
— Gregory Bateson, "The Logical Categories of Learning and Communication"
(1964/1971), in *Steps to an Ecology of Mind*, 1972, pp. 293–302 —
https://monoskop.org/images/6/65/Bateson_Gregory_Steps_to_an_Ecology_of_Mind_1987.pdf

**Bateson: trait words name transactions, not attributes — and the premises behind
them are self-validating, hence near-ineradicable.** "It is said that Mr. Jones is
dependent, hostile, fey, finicky, anxious, exhibitionistic, narcissistic, passive,
competitive… **the adjectives above which purport to describe individual character
are really not strictly applicable to the individual but rather describe
transactions between the individual and his material and human environment. No man
is 'resourceful' or 'dependent' or 'fatalistic' in a vacuum.**" And why such
premises resist evidence: "We suggest that what is learned in Learning II is a way
of punctuating events. But a way of punctuating is **not true or false**. There is
nothing contained in the propositions of this learning that can be tested against
reality… the propositions which govern punctuation have the general characteristic
of being **self-validating**. What we term 'context' includes the subject's behavior
as well as the external events. But this behavior is controlled by former Learning
II and therefore it will be of such a kind as to **mold the total context to fit
the expected punctuation**. In sum, this self-validating characteristic… has the
effect that such learning is almost ineradicable."
— Bateson, ibid., pp. 302–306 (above)

**Bateson: Learning III is rare, hazardous, and dissolves the self that Learning
II assembled.** "What has been said above about the self-validating character of
premises acquired by Learning II indicates that Learning III is likely to be
difficult and rare even in human beings." The stakes: "The premises of what is
commonly called 'character' — the definitions of the 'self' — **save the
individual from having to examine** the abstract, philosophical, aesthetic, and
ethical aspects of many sequences of life… But Learning III will throw these
unexamined premises open to question and change." And the hazard, stated plainly:
"**Even the attempt at level III can be dangerous, and some fall by the
wayside.**" The method he names for driving it is contradiction held without
escape: the therapist tries "to demonstrate contradiction among the premises which
currently control the patient's behavior," and "**the therapist must certainly so
support or hedge the contraries by which the patient is driven that loopholes…
are blocked.**"
— Bateson, ibid., pp. 306–311 (above)

**Hacking: the looping effect — a model of a person is not a measurement of a
stable object.** "We think of these kinds of people as definite classes defined by
definite properties… But it's not quite like that. **They are moving targets
because our investigations interact with them, and change them. And since they are
changed, they are not quite the same kind of people as before. The target has
moved. I call this the 'looping effect'.**" The book formulation: "people
classified in a certain way tend to **conform to or grow into** the ways that they
are described; but they also evolve in their own ways, so that the classifications
and descriptions have to be constantly revised." The contrast class, **second-hand**
from *The Social Construction of What?* (1999, p. 32): interactive kinds are kinds
of people "who can become aware of how they are classified and modify their
behavior accordingly," whereas "quarks are not aware that they are quarks and are
not altered simply by being classified as quarks." And the action clause,
**second-hand** from the 1986 "Making Up People" (p. 231): "what is curious about
human action is that by and large what I am deliberately doing depends on the
possibilities of description," so "**if new modes of description come into being,
new possibilities for action come into being in consequence.**"
— Ian Hacking, "Making Up People," *London Review of Books* 28:16, 2006 —
https://www.lrb.co.uk/the-paper/v28/n16/ian-hacking/making-up-people ; *Rewriting
the Soul*, Princeton UP 1995, p. 21, verified via
https://openlibrary.org/search/inside?q=%22tend+to+conform+to+or+grow+into+the+ways+that+they+are+described%22

**Cynefin: the licensed move depends on the domain, and in the complex domain the
probe comes first.** Verbatim: simple contexts — "leaders **sense, categorize, and
respond**. That is, they assess the facts of a situation—that is, 'sense' it—then
categorize and respond to it." Complicated — "there is a clear relationship
between cause and effect, but not everyone can see it. This is the realm of 'known
unknowns.' Here, leaders must **sense, analyze, and respond**." Complex — "**right
answers can't be ferreted out at all; rather, instructive patterns emerge if the
leader conducts experiments that can safely fail**… Leaders in this context need to
**probe first, then sense, and then respond**." Chaotic — "a leader must first
**act** to establish order, **sense** where stability is present, and then work to
transform the situation from chaos to complexity." The property that forbids
planning in the complex domain: "Though a complex system may, in retrospect, appear
to be ordered and predictable, **hindsight does not lead to foresight**." Two named
failure modes: **entrained thinking**, "a conditioned response that occurs when
people are blinded to new ways of thinking by the perspectives they acquired
through past experience, training, and success"; and the complacency cliff — "the
simple domain lies adjacent to the chaotic—and for good reason. **The most frequent
collapses into chaos occur because success has bred complacency.**" They also name
the oversimplification trigger: "Leaders who constantly ask for **condensed
information**, regardless of the complexity of the situation, particularly run this
risk."
— David J. Snowden & Mary E. Boone, "A Leader's Framework for Decision Making,"
*Harvard Business Review*, November 2007 —
https://web.archive.org/web/2018/https://hbr.org/2007/11/a-leaders-framework-for-decision-making

**Meadows: a ranked list of where to intervene, and the warning that people push
the high-leverage points backwards.** Forrester's story, in Meadows' quotation:
"**People know intuitively where leverage points are**," he says. "Time after time
I've done an analysis of a company, and I've figured out a leverage point… Then
I've gone to the company and discovered that there's already a lot of attention to
that point. **Everyone is trying very hard to push it in the wrong direction!**"
Her twelve, in increasing order of effectiveness: 12 constants/parameters; 11 sizes
of buffers; 10 structure of material stocks and flows; 9 lengths of delays; 8
strength of negative feedback loops; 7 gain around driving positive feedback loops;
**6 the structure of information flows (who does and does not have access to what
kinds of information)**; 5 the rules of the system; 4 the power to add, change,
evolve, or self-organize system structure; **3 the goals of the system**; **2 the
mindset or paradigm out of which the system — its goals, structure, rules, delays,
parameters — arises**; 1 the power to transcend paradigms. On why information flows
rank high: "**Missing feedback is one of the most common causes of system
malfunction. Adding or restoring information can be a powerful intervention,
usually much easier and cheaper than rebuilding physical infrastructure.**" With a
caveat that matters for where a question lands: "It's important that the missing
feedback be restored **to the right place and in compelling form**." On paradigms:
"The shared idea in the minds of society, the great big **unstated assumptions —
unstated because unnecessary to state; everyone already knows them** — constitute
that society's paradigm, or deepest set of beliefs about how the world works."
— Donella H. Meadows, "Leverage Points: Places to Intervene in a System," The
Sustainability Institute, 1999 —
https://donellameadows.org/wp-content/userfiles/Leverage_Points.pdf

**Simon: stable intermediate forms are why complex things can be built under
interruption — and near-decomposability is why they can be described at all.** The
watchmakers: Tempus "had so constructed his [watches] that if he had one partly
assembled and had to put it down—to answer the phone say—**it immediately fell to
pieces and had to be reassembled from the elements**." Hora "had designed them so
that he could put together subassemblies of about ten elements each… Hence, when
Hora had to put down a partly assembled watch in order to answer the phone, **he
lost only a small part of his work**." The moral: "complex systems will evolve from
simple systems much more rapidly **if there are stable intermediate forms** than if
there are not." Near-decomposability, with its two propositions: "**(a) in a nearly
decomposable system, the short-run behavior of each of the component subsystems is
approximately independent of the short-run behavior of the other components; (b) in
the long run, the behavior of any one of the components depends in only an
aggregate way on the behavior of the other components.**" And the epistemic payoff:
"comparatively little information is lost by representing them as hierarchies…
**The fact, then, that many complex systems have a nearly decomposable, hierarchic
structure is a major facilitating factor enabling us to understand, to describe,
and even to 'see' such systems and their parts.** Or perhaps the proposition should
be put the other way round. If there are important systems in the world that are
complex without being hierarchic, **they may to a considerable extent escape our
observation and our understanding.**"
— Herbert A. Simon, "The Architecture of Complexity," *Proceedings of the American
Philosophical Society* 106(6), 1962, pp. 470–473, 477 —
https://www2.econ.iastate.edu/tesfatsi/ArchitectureOfComplexity.HSimon1962.pdf

**Juarrero: constraints enable — the whole gains degrees of freedom precisely
because the parts lose them.** "Context-sensitive constraints are **enabling
constraints** insofar as they precipitate the emergence of a global dynamics with
an **expanded phase space**. The dynamic whole has greater degrees of freedom than
its components individually — **a narrative can tell you more than a Q&A form
can.**" In the 2023 restatement: "Enabling constraints… irreversibly link and
couple previously separate entities… By lowering barriers to energy, matter, and
information flows such that independent entities become conditional on each other,
enabling constraints drive parts-to-whole phase transitions to emergent
coordination patterns… **Enabling constraints are nature's mechanism for
coherence-making, generalization, and emergence.**" And the disclaimer that keeps
the concept honest: top-down constraints "influence their constituents top down,
[but] they do so **as constraints, not efficient causes**," and "authoritarian and
arbitrary fiats… are not the kind of top-down or governing constraints envisioned
here."
— Alicia Juarrero, "Complex Dynamical Systems Theory," Cognitive Edge, 2010 —
https://web.archive.org/web/20220209144109/https://cdn.cognitive-edge.com/wp-content/uploads/sites/2/2020/11/16124004/100608-Complex_Dynamical_Systems_Theory.pdf
; *Context Changes Everything*, MIT Press 2023 (open access) —
https://archive.org/details/mit_press_book_9780262374774

**Schön: the framing is prior to and more consequential than the answering.** "In
real-world practice, problems do not present themselves to the practitioner as
givens. They must be **constructed** from the materials of problematic situations
which are puzzling, troubling, and uncertain." And the definition of the move:
"When we set the problem, we **select what we will treat as the 'things' of the
situation, we set the boundaries of our attention to it, and we impose upon it a
coherence** which allows us to say what is wrong and in what directions the
situation needs to be changed. Problem setting is a process in which,
interactively, we **name** the things to which we will attend and **frame** the
context in which we will attend to them." His chapter title for the practice:
"Design as a Reflective Conversation with the Situation."
— Donald A. Schön, *The Reflective Practitioner*, Basic Books 1983, pp. 39–40, 76.
**Verified by phrase-matching across many independent scans that quote it
directly**, not from the primary scan (lending-restricted) —
https://openlibrary.org/search/inside?q=%22boundaries+of+our+attention+to+it%2C+and+we+impose+upon+it+a+coherence%22

**Two formalisms named but not obtained.** *Restless bandits* (Peter Whittle,
"Restless bandits: activity allocation in a changing world," *Journal of Applied
Probability* 25A, 1988, pp. 287–298) is the correct formal model for Elicit's
revisit problem: unlike the classic Gittins-index bandit where unplayed arms are
frozen, restless-bandit arms **continue to change state while you are not playing
them** — which is exactly what a person's beliefs do between sessions. The problem
is intractable in general (Papadimitriou & Tsitsiklis showed the general case is
PSPACE-hard) and Whittle's index is a heuristic. *Path dependence* (W. Brian
Arthur, "Competing Technologies, Increasing Returns, and Lock-In by Historical
Events," *The Economic Journal* 99, 1989, doi:10.2307/2234208) supplies the claim
that under increasing returns, small early events are not averaged away but
selected and magnified, producing lock-in to a non-predictable and possibly
inefficient attractor. **Both are second-hand**: neither paper was obtainable this
session (Cambridge and Wiley paywalls, exhausted search budget). Cite the claims,
not quoted wording.

---

# Synthesis

## (a) A taxonomy of question sources, with the rule that licenses each

Across all ten literatures the licensing rules fall into two families, and Elicit
should keep them structurally distinct.

**Precondition gating** — a question type unlocks when an *artifact* exists.
Spradley is the purest case: a structural question needs an identified domain, a
contrast question needs a taxonomy, and the artifact is produced by analysing
prior answers, not by elapsed time. VoiceXML's guard conditions are the same idea
made machine-checkable.

**Feature licensing** — the next question is *constructed* from a feature of the
last utterance. Clean Language is the strict form: attributes license "anything
else about X," a thing-like referent licenses "size or shape," an abstraction
licenses "that's X like what," and using a word the person has not said is a rule
violation. Rubin's follow-up, Kvale's "red lights," Spradley's example question,
and Paul & Elder's "base each of your questions on the answer given by the last
student" are looser versions of the same rule.

Eight sources, each with its trigger. The trigger conditions are written in
Elicit's own terms.

**1. Bank draw (deterministic).** A curated opener with Provenance, drawn from the
Question Bank. *Licensed by*: session opening with no live thread; a Direction so
new that no Snippet supports a composed question; a wiki region with no Snippets
at all; the user declining the composed alternative. *Not licensed*: mid-thread,
when the person has just said something a follow-up could work on. The backing is
convergent and strong. Kvale's introducing question sets the agenda for the rest
of the session. Rubin's main question is the schedulable class by definition. CAT
has a formal start-up problem — with no estimate there is nothing to be adaptive
about. Attenberg & Provost show what happens if you try anyway: "early stages of
acquisitions can result in a vicious cycle of uninformative selections." And
Chang & Ying give the deeper reason: greedy selection against a bad provisional
estimate is capitalisation on estimation error, and it *spends your best items on
your worst guesses*. The Question Bank is Elicit's low-discrimination stratum.
Use it first, deliberately, not as a fallback.

**2. Composed follow-up (contextual).** A question built from the exact words of a
Snippet or a live Transcript fragment. *Licensed by*: a red light in what was just
said — an unusual term, a stated-but-unexplored referent, a pole named without its
contrast, an abstraction with no episode under it, a Causal Theory offered without
the event it explains. This is the single highest-yield source, and there is a
number on it: Chopra & Haaland's respondents produced 5.9 codes over a full
interview against 2.3 from the first answer, with the dominant factor appearing in
83.5% of full interviews but only 55.7% of first responses. **Most Snippets will
come from probes, not from openers.** Two construction constraints travel with it.
First, Clean Language's rule — the question is assembled from the person's own
words plus a fixed frame, and paraphrase is a violation because "every paraphrase
introduces something new into the conversation and therefore potentially reframes
it." That is the question-side analogue of Elicit's Sole Authorship invariant
(Q-1), and it is enforceable by the same mechanism: **a composed question must
contain the quoted fragment as an exact substring.** Second, Spradley's length
rule — "expanding the length of the question tends to expand the length of the
response" — which is a lever on Snippet yield, not a stylistic note.

**3. Gap-fill / admissibility repair.** A targeted question generated from a
recorded failure. *Licensed by*: a Bud with a named admissibility failure
(CONTEXT.md already specifies that each failure *is* a question); a Gap in an
Arrangement; a half-Construct (one pole, no contrast pole, no range of
application); a Facet reading the wiki cannot assign. This is the guard-condition
family. GUS and VoiceXML give the exact mechanic: iterate the frame, select the
first item whose guard is false, terminate on exhaustion, and — the part that
matters for a conversational system — **skip the select phase entirely when the
information arrived unprompted.** Never re-ask what the person volunteered. This
is also the cheapest possible answer to "what next" and should be the default when
no stronger signal fires.

**4. Instrument step (Protocol-driven).** One step inside a multi-turn structured
procedure: the five-slot episode probe, triadic elicitation followed by laddering,
the Critical Decision Method, LSI Section E. *Licensed by*: an active Direction
whose target Facet has a matching Protocol, **and** a Mode that satisfies the
Protocol's prerequisites (Conway's 30-second retrieval budget is a hard gate for
episodes, not a preference). *And once entered, the instrument governs.* Paul &
Elder's focused mode "requires preplanning"; Hinkle's ladder has its own stopping
rule at eight to twelve rungs; the five-slot probe has five slots. The design
consequence is that the global selection function is **suspended** for the
duration of an instrument. The CAT analogue is the shadow test: assemble a whole
feasible thing, then administer only its first item, and let the assembly — not a
per-turn re-decision — carry the constraints.

**5. Randomizer draw (out-of-the-blue).** A question outside every active
Direction, sampled to reach old or untouched material. *Licensed by*: a dry spell
(kept-Snippets-per-exchange below the switching threshold already established in
§(c) of the prior research); a Direction that has saturated; a wiki region whose
last touch is old relative to its neighbours; the user's explicit request. *Not
licensed*: at session opening, and not before real work has been done. This is the
finding that should most change the Randomizer's implementation. Sio & Ormerod's
incubation effect is 0.29 overall, and the moderator that survives their
regression is **preparation time** — longer preparation predicts a larger effect
(β = .03), holding for visual and creative problems but not linguistic ones. Eno
says the same thing operationally: the card is drawn "when a dilemma occurs in a
working situation." Fu et al. supply the ceiling — "there is such a thing as too
far" — so the Randomizer needs a distance bound, not unbounded sampling. And Eno
supplies the acceptance rule that a well-behaved agent will otherwise violate:
"the card is trusted even if its appropriateness is quite unclear." If the agent
gets to veto a draw it dislikes, the mechanism is dead, because the agent's
judgment is exactly what the draw is meant to interrupt.

**6. Revisit / still-true check.** A question re-opening settled material.
*Licensed by*: a Snippet whose Stance is avowal or commitment and whose
about-when is old; a wiki claim resting only on seeded material (unconfirmed by
construction); a candidate diachronic Contradiction. The scheduling literature
gives one usable law and one strong prohibition. The law: the optimal gap is a
fraction of the retention interval, and that fraction *declines* — 7% at 350 days
— which means you cannot schedule a revisit without first declaring how long the
claim is supposed to stay true. The prohibition is Ansolabehere's: **an answer
that flips between sessions is more likely one noisy measurement than a changed
belief.** Their intertemporal correlation rises from ~.41 for a single item to .77
when many items on one issue are averaged. So the still-true check must ask the
construct *a different way*, not the same way sooner — and a single flip must not
open a Contradiction on its own. Converse adds the moderator: stability is
substantially higher on topics the person self-starts about, which means the
Randomizer's reach into forgotten material lands exactly where measurement is
noisiest, and Snippets harvested there deserve a weaker prior.

**7. Verification of a low-confidence claim.** *Licensed by*: a wiki claim below a
confidence bar; a claim implicated in a live Emergent Output. But the default is
**not** to ask. Williams & Young's confirm-everything policy performed worst of
three; NELL's human channel is "nearly all negative feedback." The right form is
not a confirmation question but an **open learner model**: write the claim, show
it, and let the user refute it. That is already Elicit's design (the Wiki is
readable and editable, and Propagation turns every edit into a Snippet). The
literature says to lean on it harder — showing a claim costs the user nothing and
recruits their correction; asking for confirmation costs a turn and, per NELL,
mostly returns nothing.

**8. Frame question (the "new way of thinking" source).** The user's fifth
category — general frameworks that elicit new ways of thinking — has been the
hardest to license, because "ask something that changes how they think" is not a
trigger condition. Bateson supplies the missing definition. A question is a *frame
question* when it targets not the answer but **the set of alternatives the answer
is chosen from, or the punctuation of experience that produced the set**. Learning
I questions correct a choice inside a set; Learning II questions move the set.
That gives a real trigger, because Bateson also says where the punctuation is
visible: in **trait words** ("dependent, hostile, fey, finicky, anxious") and in
premises the person states as facts about the world rather than as their own view.
*Licensed by*: a pattern recurring across three or more Snippets that the person
states as a property of the world, not of themselves — that is a punctuation, and
it is the licensed target. Meadows supplies the depth ordering for what such a
question aims at: parameters are the shallowest target, then structure, then
delays, then feedback loops, then **information flows**, then **rules**, then
**goals**, then **the paradigm out of which the goals arise**. Read as a question
ladder about a person, that is: what do you do → how is your life arranged → what
do you notice and when → what do you want → what would have to be true for that to
be worth wanting. Two constraints travel with this source. Bateson's hazard:
Learning III "will throw these unexamined premises open to question and change,"
and "even the attempt at level III can be dangerous, and some fall by the
wayside." Frame questions therefore need explicit consent and a fitting Mode, and
they are the clearest case for Elicit's deferral mechanic. And Paul & Elder's
*focused* Socratic mode — the only one of their three that "requires preplanning"
— is the matching Protocol.

## (b) Interleaving several kinds within one transcript

**No phases.** Spradley's concurrent principle is explicit: "Ask structural
questions concurrently with descriptive questions." Once a source is introduced it
is never retired. A transcript should look like a braid, not a pipeline.

**Funnel within a Direction, not within a session.** Broad before narrow is the
one ordering rule three independent sources state. Kvale postpones direct
questions "until the later parts of the interview, after the subjects have given
their own spontaneous descriptions and thereby indicated what aspects of the
phenomena are central to them" — note the mechanism: ask specifically too early
and you destroy the evidence of what the person considers central. Spradley
orders experience questions after numerous grand and mini tours because
open-ended asks otherwise return atypical events. In Elicit terms: a Direction's
first exchange should be a Bank draw or a grand-tour composed question; instrument
steps and contrast questions come after the Direction has produced Snippets.

**a-stratification within a session.** This is the most transferable CAT result
and it inverts the obvious design. Early in a session the agent's estimate of *who
this person is today* — their Mode, their current preoccupation, what they are
willing to go into — is bad. Spending the sharpest instrument on that bad estimate
wastes it. So: **low-discrimination questions early, high-discrimination
instruments late.** Bank openers and descriptive follow-ups first; laddering,
Contradiction confrontation, and CDM in the second half. This costs nothing to
implement — it is an ordering constraint on the candidate set — and Chang & Ying
report it improved exposure skew while holding efficiency.

**Exposure control, in two places.** Elicit's pool is not items but the person's
territory, and it gets mined in two ways. *Question-form exposure*: the same
composed frame reused until it becomes furniture. The randomesque fix applies
directly — sample uniformly from the top-k candidates rather than taking the
argmax. It needs no simulation, and its known limit ("prevents the same item from
being used repeatedly for test takers with similar proficiency levels") is
precisely the failure Elicit faces across sessions with one person in similar
Modes. *Region exposure*: the Wiki overfitting to well-trodden territory —
CONTEXT.md already names this as the Randomizer's purpose. Both are exposure
control; only the second is serendipity. **Keep them separate in the code**, or
the Randomizer will be tuned for one job and measured on the other.

**Content balancing via a shadow session.** Q-7 says Facet distribution is tracked
per Mode. Tracking is an audit; the shadow-test approach makes it structural. At
each step, assemble a hypothetical full session that satisfies the Facet blueprint
given what has already been asked, then ask only its first question. Van der
Linden & Reese's result is the reassuring part: with 433 constraints on a 753-item
pool, the estimator "did not suffer any loss of efficiency from the presence of
433 constraints." Constraints are cheap. The alternative — Stocking & Swanson's
weighted deviations, which folds constraints into the objective — is simpler but
its authors state its limit themselves: "there is nothing about the WDM or its
algorithm that guarantees this outcome."

**Following the thread versus holding the agenda.** Chu-Carroll & Brown's split is
the right primitive: task initiative (who decides what gets modelled) and dialogue
initiative (who decides the current topic) diverge in about a quarter of turns.
**Elicit should cede dialogue initiative freely and hold task initiative.** The
person picks what we talk about; the agent decides what becomes a Snippet, what
Facet it reads as, and what goes in the queue for later. Tang et al. give the
arbitration mechanically: the agenda is a *filter* on the candidate set,
responsiveness is the *choice within it* — "the above constraint first collects a
set of valid candidates, and the turn-level transition module samples or picks the
most likely one from the set." Guinn adds that the re-evaluation must be
continuous and per-goal: Continuous beat SingleSelection by 15–20%, and picking a
leader once produces master-slave dialogue.

**When to say nothing.** Horvitz's two thresholds give a three-way rule that
Elicit currently lacks: below `p*_¬A,D`, stay quiet and let the person keep
writing; between the thresholds, ask; above `p*_D,A`, just record the reading
without asking. Kvale's *silence* is the same move from the other tradition: "By
allowing pauses in the conversation the subjects have ample time to associate and
reflect and then break the silence themselves with significant information." An
agent that responds to every fragment with a question is at the wrong point on
this curve.

**Session close.** Kvale's *structuring* question is licensed by exhaustion — the
interviewer "should indicate when a theme has been exhausted." A closing move
should be a structuring or interpreting question, not the session's deepest probe.
And a Mode-deferred question is a first-class artifact: CONTEXT.md already says
deferring to a fitting Mode is a legitimate move, and Horvitz's principle 3 —
"consider the costs and benefits of deferring action to a time when action will be
less distracting" — is the formal version.

**The licensed move depends on which domain the material is in.** Cynefin adds a
dimension the interviewing literature lacks: not every region of a person is the
same kind of thing. Retrievable Facts are *simple* — sense, categorize, respond, so
a Bank draw or a direct question is correct and a probe is waste. Procedures and
dateable Episodes are *complicated* — sense, analyze, respond, which is exactly
what an instrument like the Critical Decision Method does. But Constructs, Values,
Causal Theories and self-narrative are *complex*: "right answers can't be ferreted
out at all; rather, instructive patterns emerge if the leader conducts experiments
that can safely fail… probe first, then sense, and then respond." In that region
the question **is** the intervention, its effect is not predictable in advance, and
the correct posture is a cheap probe whose failure costs little. This is the
missing explanation for the finding already established in §(c) of the prior
research — that Protocols differ in *yield*, not in *access*. A Protocol is a
complicated-domain instrument. Applied to complex-domain material it does not
unlock anything, which is precisely what the Nottingham study measured. The
practical rule: **match the move to the domain, and in the complex region prefer
many cheap probes over one expensive instrument.** Snowden's two named failure
modes both apply to an agent: *entrained thinking* ("blinded to new ways of
thinking by the perspectives they acquired through past experience, training, and
success") is exactly what an agent conditioned on its own high-yield Directions
develops, and the *condensed-information* trigger — "leaders who constantly ask for
condensed information, regardless of the complexity of the situation, particularly
run this risk" — is a warning about summarising Transcripts too eagerly.

**Complete a stable subassembly before you get interrupted.** Simon's watchmakers
are, unusually, a direct argument about Elicit's data model rather than an analogy.
Interruption is the normal condition of an elicitation session — energy runs out,
Mode changes, the person stops. Tempus's watch "immediately fell to pieces and had
to be reassembled from the elements"; Hora "lost only a small part of his work."
The Snippet is Elicit's stable intermediate form, and the design consequence is a
sequencing rule: **prefer question sequences that reach an admissible Snippet
quickly over sequences that only pay off if the whole arc completes.** A five-slot
episode probe abandoned at slot three should still leave something citable — which
is what the Bud mechanic is for, and it is worth checking that each Protocol
degrades into Buds rather than into nothing. Simon's near-decomposability gives the
matching rule for Directions: strong interaction within a Direction, weak
interaction between them, so that "the short-run behavior of each of the component
subsystems is approximately independent." A Direction that cannot be worked on
without simultaneously working three others is badly cut.

**Route the person's own stop signal outside the selection function entirely.**
Beer's algedonic channel is the structural mechanism Q-7 currently lacks. Mode is a
constraint, but a constraint is still evaluated inside the loop, and Beer's argument
is that the filters which make the loop efficient are exactly what blind the top
level: "many filters are operating to reduce variety… System Five may easily be
lulled into a sense of false security. Special filters would be needed, working on
collateral information channels, to reinstate requisite variety regarding threats
to survival." Fatigue, distress, and "I don't want to go there" should travel on
their own channel and pre-empt, not be weighed. Two details are directly
implementable. The trigger is failure to self-restore within an agreed time — the
subsystem tries first, and escalates only if it cannot. And the governance
condition is the design requirement: people accept automatic notification of their
difficulties "**provided that they themselves have control of the parameters of the
system under which this will be done**." The user sets the thresholds of their own
stop signal. Rarity is the health metric: "if all concerned do their agreed jobs
properly, algedonic signals will rarely be fired" — so frequent stops mean the
selection function is wrong, not that the user is difficult.

## (c) The selection function

"Deepen the wiki according to the human" needs an operational reading. Four
candidates, and the literature eliminates three.

**Not maximum information at the current estimate.** Known-bad alone in the one
field that deployed it. Han measures a pure maximum-information CAT administering
30 items out of 300.

**Not model uncertainty.** Settles: uncertainty selects outliers — instances that
are "controversial" but not "representative." Dasgupta: worse, it is
self-confirming, and the learner "is not consistent: even with infinitely many
labels, it returns a suboptimal classifier." For a person-model this predicts a
specific pathology — the agent mines whichever corner of the person it finds most
confusing, which is often the corner where its own representation is weakest,
never the corner that matters.

**Not surprise or novelty in the answer.** The noisy-TV result is direct and it
was confirmed empirically. Schmidhuber: "the traditional notion of surprise is
rejected. Neither the arbitrary nor the fully predictable is truly novel or
surprising." Burda et al. generalise the cause to exactly Elicit's case:
"stochasticity caused by a poor learning algorithm, an impoverished model class or
partial observability can lead to exactly the same problem." A person's most
chaotic, least characteristic territory is permanently unpredictable, and a
surprise-seeking agent will live there.

**Yes: learning progress, measured per region, scored against the whole
transcript.** This is the one signal with a clean argument behind it, and Elicit
already has the instrumentation. Hoffman's informative-propositions-per-task-minute
metric — already adopted in §(c) of the prior research as *kept Snippets per
exchange, minus those already implied by existing Wiki claims* — is a
learning-progress measure, not a novelty measure. Three refinements the curiosity
literature adds:

- **Per region, not globally** (Oudeyer's IAC computes progress per region R_n).
  Track yield per Direction, so a stalled Direction is abandoned rather than
  dragging a global average that keeps the agent in place.
- **Re-score the old model on the new data** (Schmidhuber's constraint: "both the
  old and the new model have to be tested on the same data"). The operational
  question is not *was that answer surprising* but *would what I already believed
  have predicted what they just said*. That is also, exactly, Contradiction
  detection — which means Elicit's Contradiction machinery and its progress metric
  are the same computation read two ways.
- **Restrict the prediction target to what the interview can influence** (Pathak's
  inverse-dynamics move). Model stable dispositions, not which anecdote happened to
  surface today.

**And a decision must anchor it, or "information" has no units.** Howard's whole
argument is that information value is decision-relative. Elicit's answer is
already in the domain model: the wiki is not an end in itself; it exists to grow
an Emergent Output. So Boutilier's current-solution heuristic transplants cleanly:
**prefer questions bearing on claims implicated in something live** — a Gap in an
Arrangement, an unconfirmed skill claim awaiting performance evidence, a synchronic
Contradiction blocking a claim the user needs. Boutilier's phrasing is the rule:
"we do not reduce utility uncertainty for its own sake." A wiki claim nobody's
work depends on is cheap to leave uncertain.

Four tempering terms, each with a source.

**Mode is a feasibility filter, never a term in the objective.** Q-7 already says
this; the literature says how to implement it. Mode enters where CAT content
constraints enter the shadow test — as a constraint on the assembled candidate
set, so infeasible questions never reach scoring. It must not be a penalty term,
because a penalty is tradeable against information and a constraint is not.

**Cost is not divisible out.** Settles' negative result is explicit: "simply
dividing the informativeness measure (e.g., entropy) by the cost is not
necessarily an effective" strategy. And cost has a *locality* term that argues for
depth: Chajewska et al. note "a second consecutive question about the same outcome
is cheaper than a question about an outcome discussed a few questions back." So
consecutive probes on one thread are cheap and topic shifts are expensive. That is
a quantitative argument for Elicit's follow-up-heavy shape and against
ping-ponging between Directions.

**Budget: ten to twenty questions per elicitation episode.** Zou et al.: median 15
answered, 71.4% of users willing to answer 10–20. Chajewska's utility elicitation
terminated at 2.3–3.9. This is a design number, not a guess — and it means the
per-question stakes are high enough to justify the shadow-session machinery.

**The person is a fallible oracle whose quality varies with fatigue.** Donmez &
Carbonell name the four standard assumptions — infallible, indefatigable,
individual, insensitive to costs — and every one is false here. Zou et al. measured
a ~5% error floor on questions users rated easy. Settles names the unsolved case
as an open question: "noisy oracles whose quality varies over time." Elicit's
Nisbett-Wilson flag on Causal Theory is one instance of this; the general form is
that a Snippet's evidentiary weight should be discounted by the answering
conditions, which is what Mode-per-Facet tracking is already for.

**And the warning that should be written on the wall.** Bjork: "the typical trainer
is… vulnerable to a type of operant conditioning, where the reinforcing events are
improvements in the performance and/or happiness of trainees. Such a conditioning
process, over time, can act to shift the trainer toward manipulations that
increase the rate of correct responding — that make the trainee's life easier…
Doing that, of course, will move the trainer away from introducing the types of
desirable difficulties." An agent tuned on in-session satisfaction will drift to
easy questions. This is the mechanism behind Elicit's stated non-goal — engagement
is not the target — and it is worth stating in those terms, because it explains
*why* rather than asserting a preference.

**The ceiling on the whole enterprise is the agent's question variety.** Ashby's law
is the hardest constraint in this document, and it sits above the selection
function rather than inside it: "only variety in R can force down the variety due
to D." No selection policy, however clever, can resolve more of a person than the
agent has distinct moves to resolve them with — and "R's capacity as a regulator
cannot exceed R's capacity as a channel of communication." A Question Bank of *n*
openers has variety *n*. This is an independent and much stronger argument for
Q-12: composed questions are not a nicety for rapport, they are **the only
unbounded variety source available**, and the whole ceiling moves with them.
Conant & Ashby add that the model is not optional — "the best regulator of a
system is one which is a model of that system" — and, crucially for a person
elicited over years, that it must be **time-varying**: "as p(S) changes, the
mapping h will change appropriately."

**The deepest argument against argmax selection is 1956 vintage.** Q-13's
constraints-then-chance rule currently rests on CAT exposure control and
active-learning failure modes. Ashby gives it a stronger foundation: a regulator
that succeeds closes its own information channel. "The more successful R is in
keeping E constant, the more does R block the channel by which it is receiving its
necessary information. Clearly, any success by R can at best be partial." The
resolution is to budget for failure deliberately: "**small errors are allowed to
occur; then, by giving their information to R, they make possible a regulation
against great errors.**" Operationally, some fraction of questions should be ones
the agent expects to yield little, precisely because their failure is the only
evidence that the model is wrong. And Ashby licenses the Randomizer in exactly the
terms Q-16 needs: the law "absolutely prohibits any direct and simple magnification
but **it does not prohibit supplementation**," where the supplement must come "from
a system whose behaviour is **uncorrelated with that of the main system**." That is
a precise specification — the Randomizer's sampling distribution must be
uncorrelated with the agent's own model of the person, which rules out the tempting
implementation of "sample randomly, weighted by what looks interesting."

**Reframe the hard filters as enabling, not restricting.** Q-13's stack of gates
(license, Mode, Facet balance, weak-early ordering, exposure) reads like a list of
things the agent may not do. Juarrero's argument is that this reading is backwards:
context-dependent constraints "precipitate the emergence of a global dynamics with
an **expanded phase space**. The dynamic whole has greater degrees of freedom than
its components individually — a narrative can tell you more than a Q&A form can."
Clean Language's licensing rules are the clearest instance: forbidding the
facilitator's own words does not narrow what can be said, it is what makes the
person's own landscape available at all. The design consequence is a test to apply
when a constraint feels expensive: **does removing it increase the agent's options
while decreasing what emerges?** If so it is an enabling constraint and should stay.

**And Beer's dictum should be the acceptance test.** POSIWID — "the purpose of a
system is what it does" — means whatever the selection function actually optimises
*is* Elicit's purpose, regardless of what CONTEXT.md says the purpose is. Combined
with Bjork's operant-conditioning warning, this argues for instrumenting the
realised behaviour (what Facets actually got collected, in what Modes, at what
depth) and treating drift in that distribution as a defect report against the
policy, not as data about the user.

## (d) Where the literature contradicts the obvious design

Ordered by how much it should change what gets built.

**1. "Always ask the most informative question" is known-bad in the one field
that shipped it.** Not merely suboptimal — three separate correction layers exist
because of it. Exposure control (a probabilistic gate between selecting and
administering), stratification (weak questions early), and content balancing
(constraints satisfied regardless of information). Any Elicit design that scores
candidates and takes the argmax has skipped all three.

**2. Use your weakest questions first.** Chang & Ying's a-stratified result is
exactly backwards from intuition and it is the single most useful import here.
Maximum information at a bad provisional estimate is capitalisation on estimation
error. Save the laddering and the Contradiction confrontation for later in the
session.

**3. "Ask where the model is most uncertain" chases outliers and is
self-confirming.** Settles on outliers, Dasgupta on inconsistency with an infinite
budget, Attenberg & Provost on the compounding cold-start damage. The stated fixes
are: weight informativeness by representativeness, and use random or curated draws
early. Both map onto Elicit primitives already in the design (Question Bank,
Randomizer) — but they are needed for *statistical* reasons, not only for the
human-facing reasons currently given.

**4. Surprise is not progress.** A topic where the person's answers are
unpredictable is not a topic where the model is improving. This is the noisy-TV
result, and Burda et al.'s generalisation means it fires whenever the agent's
representation is simply too weak for a region — which for a 27B local model will
be often.

**5. Scoring questions independently and taking the top-k is invalid twice
over.** Howard: joint value differs from the sum of individual values. Guo &
Schuurmans (via Settles, **second-hand**): batch top-k selection is "often much
worse than random sampling." A diversity term is not a refinement; it is load-
bearing.

**6. Do not ask the user to confirm things.** Confirm-everything was the worst of
three policies in Williams & Young; NELL's human feedback is "nearly all negative."
Show the claim and let them refute it. Elicit's open, editable Wiki plus mandatory
Propagation is already the right mechanism — the finding is that it should carry
*more* of the verification load, and confirmation questions should carry less.

**7. Expanding review intervals have little empirical backing.** Cepeda et al.
state it directly of the premise underlying Leitner and SM-2: expanding intervals
"either benefit learning or produce effects similar to studying with fixed
spacing." Worse, any fixed multiplier is silently optimising for an undeclared
retention target — "if you want to know the optimal distribution of study time,
you need to decide how long you wish to remember something." A still-true check
schedule must first say how long the claim was supposed to hold.

**8. Re-asking the same question to detect change mostly detects noise.**
Ansolabehere: single-item intertemporal correlation ~.41 versus .77 for
multi-item aggregates. A flipped answer is weak evidence of a changed belief. **A
single contradictory answer should not open a synchronic Contradiction** — the
cheap correction is to re-measure the construct a different way first. This is a
concrete constraint on Contradiction detection that the current design does not
have.

**9. The default RL reward for dialogue is actively hostile to a thorough
interviewer.** "+20 success, −1 per turn" prices a 15-turn success identically to
immediate abandonment; Williams & Young show the planner learns to quit. And on
the generation side, likelihood objectives select for blandness: Rao & Daumé's MLE
ablation scored *higher on BLEU* while producing "highly generic questions, such
as 'What are the dimensions?'". For Elicit this means **never select a question by
fluency or plausibility** — which happens to be the exact analogue of Q-11's ban on
fluency as a Snippet quality signal, now extended to the question side.

**10. Randomness helping thinking is weakly supported; coverage is strongly
supported.** The incubation effect is d = 0.29 with non-significant subgroup
moderators, conditional on prior preparation, and reversing at large stimulus
distance. No study tests Oblique Strategies; none tests de Bono's random word
against a control. But exposure control and anti-overfitting are well-established
in CAT and active learning. **Defend the Randomizer on coverage grounds, not
creativity grounds** — the argument is stronger and it also tells you how to tune
it (reach untouched regions, bound the distance) rather than leaving it as taste.

**11. Fixed question sequences are practitioner lore.** GROW has never been
compared against a permuted or absent sequence. Grant, from inside the field:
"there has been little or no debate in the literature about the use of session
structures." Import Spradley's sequencing — which is gated on analytic artifacts,
and therefore checkable — not GROW's, which is gated on nothing.

**12. Sometimes the agent must not choose.** Two sources carry an explicit
anti-selection clause. Eno: "the card is trusted even if its appropriateness is
quite unclear." Clean Language: paraphrase is banned, because "every paraphrase
introduces something new into the conversation and therefore potentially reframes
it." In both cases the value comes precisely from the operator not choosing. An
Elicit design where the agent gets the last word on every question loses whatever
these mechanisms were for.

**13. Do not over-invest in the selection function itself.** The closest published
analogue to Elicit's setting — polytomous items, no correct answers, low stakes —
found "no clear benefit from more sophisticated selection criteria," with item
overlap of .84–.90 at five items between plain maximum-information and every
elaborate alternative. And the strongest deployed person-modelling result in the
LLM era (83–85% of human test-retest reliability, versus 74% for demographics)
came from a **fixed script plus adaptive follow-ups plus a time budget** — no
curiosity term, no information-gain computation, no measure of how much the model
changed. Two hours of good questions with competent probing beat a clever
selection function. Build the Question Bank, the composed-follow-up path, and the
budget first; the selection function is a later refinement.

**14. The person is a non-trivial machine, so "ask it again and see" is not a
repeated measurement.** Von Foerster's four properties — "synthetically determined,
dependent on its history, cannot be analytically determined, and is unpredictable"
— mean the state changes with each operation, including the operation of being
asked. Q-14 already forbids opening a Contradiction on one flipped answer, on
Ansolabehere's measurement-error grounds. This is a **second, independent
mechanism** reaching the same rule: the second asking is not a second sample from
the same distribution, because the first asking moved the machine. The rule
survives either way, which is the strongest position a design rule can be in. The
harder corollary is that the analytical problem is "in principle unsolvable" — the
wiki is not an approximation converging on a true model, and any completeness
metric is measuring the wrong thing. Von Foerster also names the error of assuming
otherwise: to treat character as "a purportedly permanent rule of transformation…
the person has to act in a certain manner and is viewed as a trivial machine."

**15. The wiki is an intervention, not a record — and this contaminates later
evidence.** Hacking's looping effect says classifications "interact with them, and
change them," and that people "tend to conform to or grow into the ways that they
are described." Elicit makes the wiki readable and editable, and the prior research
already treats that as an accuracy mechanism (Bull et al.: seeded errors got
corrected and the model improved). The looping effect says it is also a **causal
channel**: a claim the user reads may become true by being read. This is a hazard
the design does not currently have a mechanism for, and the fix is cheap and
structural — **Provenance should record whether the user had read the relevant Wiki
claim before the answer was given.** A Snippet elicited after the user read the
claim it now supports is weaker evidence for that claim than one elicited before,
and only Provenance can tell them apart. Hacking's action clause raises the stakes
and is worth stating as the upside: "if new modes of description come into being,
new possibilities for action come into being in consequence." Elicit's Emergent
Outputs are that claim taken seriously.

**16. Wiki claims shaped like traits are a category error.** Bateson: the adjectives
"which purport to describe individual character are really not strictly applicable
to the individual but rather describe **transactions** between the individual and
his material and human environment. No man is 'resourceful' or 'dependent' or
'fatalistic' in a vacuum." A claim of the form *the user is X* is therefore
malformed regardless of how much evidence cites it; the well-formed version names
the context. This is a constraint on the Wiki's claim grammar, not on question
selection, but it changes what questions are worth asking — a question aimed at
confirming a trait is aimed at nothing. It also explains why Kelly's Construct
(pole, contrast pole, **range of application**) is already the right shape: the
range of application is the context Bateson says cannot be dropped.

**17. The obvious question targets are the low-leverage ones.** Meadows ranks
parameters and stock structures at the bottom and goals and paradigms at the top,
then quotes Forrester's warning that "people know intuitively where leverage points
are… **Everyone is trying very hard to push it in the wrong direction!**" For an
interviewer the low-leverage questions are the comfortable ones — what do you do,
how much, how often — and the high-leverage ones are about goals and about the
"great big unstated assumptions — unstated because unnecessary to state; everyone
already knows them." That is a good operational definition of what a frame question
hunts for, and a warning that it will not be volunteered.

**18. Applying an instrument to complex-domain material is a named failure, not
just low yield.** Snowden's core claim is that using a complicated-domain
procedure — sense, analyze, respond — where the material is complex produces
confident wrong answers, because "hindsight does not lead to foresight." Elicit's
Protocols are complicated-domain instruments. For Constructs, Values and
self-narrative the licensed move is probe-sense-respond: cheap questions whose
failure is affordable, with the pattern read afterwards. This also reframes the
Protocol-switching rule already adopted from Hoffman: a yield drop in the complex
region is not necessarily a signal to switch instruments, because there may be no
instrument that works — it may be a signal to stop instrumenting and start probing.

**19. The revisit problem is formally intractable, so do not build an optimal
scheduler.** Topics about a person keep changing while you are not asking about
them, which makes still-true checks a **restless bandit** rather than a classic
one, and the general problem is PSPACE-hard (**second-hand**; see §10). Combined
with Cepeda's finding that the optimal gap depends on a retention target Elicit has
never declared, and with the absence of any literature on belief re-verification
scheduling, the honest conclusion is that a principled revisit schedule is not
available. Use a crude, legible heuristic, expose it, and let the user override it.

**A convergence worth naming.** Four unrelated literatures say the early period is
disproportionately consequential and that greedy behaviour there is specifically
harmful: CAT's a-stratification (sharp items spent on bad estimates), active
learning's cold start (poor early selections "propagate their harm across the
learning curve"), incubation research (randomness pays only after preparation), and
path dependence (small early events "selected and magnified" into lock-in;
**second-hand**). When four fields with no shared vocabulary converge, the rule is
worth treating as established: **the opening of a corpus, and the opening of each
session, should be deliberately un-greedy.**

---

# Gaps

Named rather than papered over.

- **Funnel structure has no primary source here.** Kvale's postponement rule and
  Spradley's ordering both state the mechanism, but the canonical
  survey-methodology work on question-order contamination was not located. Do not
  cite a funnel source from this document.
- **Rubin & Rubin's five probe kinds** (completeness, clarity, evidence,
  attention, elaboration) were not retrieved verbatim from the 3rd edition. The
  main/probe/follow-up trichotomy and its licensing rule *were* verified.
- **Several CAT primaries are second-hand.** Lord 1980 (book), Sympson & Hetter
  1985 (undigitized proceedings), Kingsbury & Zara 1989 (paywalled), and the
  PROMIS operational parameters. The van der Linden & Pashley item-selection
  chapter in *Computerized Adaptive Testing: Theory and Practice* is the standard
  modern treatment and is worth acquiring if this area gets built out.
- **Belief-decay scheduling does not exist as a literature.** The attitude-stability
  work answers a different question well; nobody has published a rule for when a
  stored belief is due for re-verification. Elicit will be inventing here, and
  should say so.
- **Two 2026 AI-interviewer systems surfaced but were not read**: *AInterviewer*
  (ACL 2026 System Demonstrations, https://aclanthology.org/2026.acl-demo.12.pdf)
  and *SparkMe: Adaptive Semi-Structured Interviewing for Qualitative Insight
  Discovery* (arXiv:2602.21136). Both likely bear directly on probe selection.
- **Xiao et al. 2020** on conversational surveys with adaptive probing (ACM TOCHI
  27(3), https://arxiv.org/abs/1905.10700) is cited second-hand from search
  snippets only; effect sizes need checking before use.
- **Whittle 1988 (restless bandits) and Arthur 1989 (lock-in) were not obtained** —
  Cambridge and Wiley paywalls, with the session's search budget exhausted. Both
  claims as stated are standard and uncontroversial, but no wording from either
  paper is quoted here and none should be.
- **Beer's POSIWID** is verified only against a reproduction of the 2001 Valladolid
  address; *Kybernetes* is closed access and the phrase is absent from *Brain of the
  Firm*. The "inside and now / outside and then" slogans are from *The Heart of
  Enterprise*, also unobtainable; §10 substitutes Beer's first-hand wording from
  *Brain of the Firm* instead.
- **Von Foerster's trivial/non-trivial machine text** is quoted from an English
  translation of a German interview volume, so the wording is the translator's. His
  own English prose is in *Understanding Understanding* (Springer 2003), which was
  not reachable. His combinatorial argument is quoted only in its loose form.
- **Juarrero's 1999 *Dynamics in Action*** was not reachable; her 2010 paper and the
  open-access 2023 book carry the same argument, with the terminology renamed
  (context-free/context-sensitive became context-independent/context-dependent).
- **Schön 1983** was verified by phrase-matching across many independent scans that
  quote it directly, not from the primary scan.
