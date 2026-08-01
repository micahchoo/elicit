# The Shape of the Problem

Nine literatures have already tried to answer Elicit's question: what are the natural
units of person-knowledge, how do you get them out of a person, and what do you do when
the model and the person disagree. This document collects what each field established,
then reads them together against the design decisions currently on the table.

Read the field sections for evidence. Read the synthesis for what to do about it. Read
"Where the literature contradicts the design" if you only have five minutes — that
section is the load-bearing one, because four of the current design choices are
unsupported or actively contradicted, and two of them are cheap to fix.

Vocabulary follows `CONTEXT.md`: Snippet, Provenance, Wiki claim, Contradiction,
User-Attested Claim, Protocol, Mode, Piece, Arrangement, Harvesting, Restatement,
Seeding, Propagation.

---

## 1. Knowledge acquisition and elicitation for expert systems

- **The bottleneck is a measured cost with a stealable metric.** Hoffman et al. score
  techniques in *informative propositions per total task minute (TTM)*, where TTM includes
  elicitor preparation, session time, and transcript analysis, and "informative" means *not
  already present in a first-pass documentation-derived knowledge base*. In Hoffman's
  five-method comparison, unstructured interview yielded under one proposition per TTM,
  structured interview about one, and contrived tasks plus tough-case analysis two to three.
  His stated switching rule: at ~1/TTM, change technique; at 2–3/TTM, you are proceeding
  effectively [Hoffman, Shadbolt, Burton & Klein 1995].

- **The differential access hypothesis fails in its strong form.** The hypothesis — that
  different techniques reach different *kinds* of knowledge — was tested at Nottingham
  (Burton, Shadbolt et al. 1987, n=32 geology students; 1988, n=32 geographers; each subject
  did one natural method and one contrived method against a senior expert's gold-standard
  rule set). Result: **no technique × knowledge-type interaction; "almost all the same
  knowledge was elicited."** Partial support appeared only in genuinely complex
  classification domains (8 expert archaeologists), where contrived techniques gave specific
  knowledge but no domain overview and had to be paired with an interview [Hoffman et al.
  1995; Burton et al. 1990].

- **What survives is differential *utility*, and that is the version worth building on.**
  Hoffman et al.'s own conclusion is that methods "may differ in terms of the kinds of
  knowledge or strategies that they elicit *most effectively or most readily*." Techniques
  mold strategy: Prietula et al. (1989) added cost feedback and flipped experts from
  plan-and-implement to hypothesis-and-test reasoning, changing what surfaced. By 2006
  Hoffman & Lintern restate the field's position: "The hypothetical problem of differential
  access has given way to a practical consideration of differential utility… each knowledge
  elicitation method has its strengths and weaknesses," with techniques acting as
  **scaffolds** that create conditions under which tacit knowledge becomes verbalizable
  [Hoffman & Lintern 2006, quoted in Shadbolt & Smart 2015].

- **Comfort is not yield.** Two findings with direct product consequences: an expert's own
  opinion of a technique's worth is **no guide to its actual value** (Schweikert et al. 1987),
  and contrived tasks — which experts dislike — are often *more* efficient than natural ones
  (Burton et al. 1990). Meanwhile think-aloud plus protocol analysis was the *least* efficient
  technique across all the Nottingham studies, most costly to analyze and least complete, yet
  stays popular because experts are comfortable with it [Shadbolt & Smart 2015].

- **The laddered grid is a literal question generator, ready to lift.** DOWN: "Can you give
  examples of \<ITEM\>?" ACROSS: "What alternative examples of \<CLASS\> are there to
  \<ITEM\>?" UP: "What have \<SAME LEVEL ITEMS\> got in common?" / "What are \<SAME LEVEL
  ITEMS\> examples of?" Essential properties: "How can you tell it is \<ITEM\>?"
  Discrimination: "What is the key difference between \<ITEM 1\> and \<ITEM 2\>?" The Critical
  Decision Method is five steps: select a nonroutine incident → take an unstructured account →
  construct a timeline → identify decision points → probe them with cognitive probes [Klein,
  Calderwood & MacGregor 1989, in Shadbolt & Smart 2015].

- **Concept sorting carries a hard invariant, and CommonKADS carries a task-driven one.**
  "In any sorting session the cards should be of the same knowledge type" — mixed-type
  sorts are invalid. CommonKADS layers knowledge as **domain** (types, rules, facts),
  **inference** (basic inferences and roles), **task** (goals, decomposition, control), plus
  strategic knowledge, and ships reusable domain schemas, an inference-type catalogue, and a
  **library of task templates** — so choosing a task template (diagnosis → hypothesize,
  verify → symptom/complaint/test types) tells you what to elicit next [Schreiber et al.
  2000, in Shadbolt & Smart 2015].

*Not verified:* Cooke 1994's three top-level families (observations-and-interviews,
process-tracing, conceptual techniques) were seen only in derived descriptions, not her own
text — the full paper is paywalled.

### Sources
- Hoffman, R. R., Shadbolt, N. R., Burton, A. M., & Klein, G. — *Eliciting Knowledge from Experts: A Methodological Analysis*, Organizational Behavior and Human Decision Processes 62(2):129–158, 1995. https://eprints.soton.ac.uk/252301/1/El_20Know_20from_20Exp_20OBHD.pdf
- Shadbolt, N. R., & Smart, P. R. — *Knowledge Elicitation: Methods, Tools and Techniques*, in Wilson & Sharples (eds.), *Evaluation of Human Work* (4th ed.), CRC Press, 2015, pp. 163–200. https://eprints.soton.ac.uk/359638/1/Knowledge_20Elicitationv7.pdf
- Cooke, N. J. — *Varieties of knowledge elicitation techniques*, International Journal of Human-Computer Studies 41(6):801–849, 1994. https://doi.org/10.1006/ijhc.1994.1083
- Schreiber, G. et al. — *Knowledge Engineering and Management: The CommonKADS Methodology*, MIT Press, 2000.
- Hoffman, R. R., & Lintern, G. — *Eliciting and Representing the Knowledge of Experts*, in *Cambridge Handbook of Expertise and Expert Performance*, 2006.

---

## 2. Personal construct psychology

- **A construct is a bipolar reference axis the person *devises*, not a category abstracted
  from the world.** Kelly's dichotomy corollary: "A person's construction system is composed
  of a finite number of dichotomous constructs." His gloss: constructs "are imposed upon
  events, not abstracted from them. There is only one place they come from; that is from the
  person who is to use them. He devises them"; and "a construct is not a class of objects, or
  an abstraction of a class, but a **dichotomous reference axis**." Rating scales are
  derivative — "one can scarcely have himself a scale unless he has a construct working for
  him" [Kelly 1966/2017]. This is the theoretical ground for insisting elicited poles be in
  the person's own language.

- **Range of convenience is a first-class field, separate from the poles.** Range corollary:
  "A construct is convenient for the anticipation of a finite range of events only." Kelly
  separates *focus of convenience* (works especially well) from *range of convenience* (works
  reasonably) from out-of-range. Asserting a pole both **denies the contrast pole** and
  **excludes** out-of-range objects. Gaines formalizes it: a construct is "a pair of disjoint
  concepts, both subsumed by a third concept corresponding to what he terms the range of
  convenience… the psychological unit is the **triple** of concepts, rather than the
  individual concept in isolation" [Kelly 1966/2017; Gaines & Shaw 1993].

- **Contradiction is native to the theory, not an error state.** Organization corollary: each
  person evolves "a construction system embracing **ordinal relationships between
  constructs**" — and Kelly is explicit that the system need not be consistent: "Some private
  paradoxes can be allowed to stand indefinitely, and, in the face of them, one can remain
  indecisive or can vacillate between alternative expectations" [Kelly 1966/2017].

- **Triadic elicitation: three elements is the minimum that forces both a likeness and a
  contrast.** In the Minimum Context Card Form the person first names elements from a Role
  Title List (~20+ role titles: a teacher you liked, your mother, a neighbor hard to
  understand), then for each triad states "some important way in which any two of these people
  are alike in contrast to the third," answering in bipolar form, in their own language
  [Kelly 1955]. Gaines & Shaw's practical rule: "When no prior information is available,
  triadic elicitation can be effective… but as more data is obtained other methods become
  possible based on continuous analysis of the knowledge structure" — e.g. show a construct
  match and ask for a new element that would break it, or detect near-identical elements and
  ask for a distinction that separates them [Gaines & Shaw 1993].

- **Laddering up, verbatim, with stopping rules.** After the person marks the preferred pole:
  "on this construct you preferred this side to that side. What I want to understand now is
  **why you would prefer to be here rather than there**. What are the advantages of this side
  in contrast to the disadvantages of that side, as you see it?" The answer is itself a new
  bipolar construct with a preferred side, and the question re-fires on it. Stop when the
  person can no longer generate one, or after ten. People "typically generate about 8 to 12
  such superordinate constructs" before reaching the top, and ladders started from *different*
  subordinate constructs "almost invariably" converged on the same chain [Hinkle 1965]. Hinkle
  also made subjects re-read their list to check no construct was "merely a rewording of some
  other listed construct."

- **Core versus peripheral has numbers: superordinate = implication-rich = resistant to
  change.** Hinkle's implication grid plus resistance-to-change grid (forced pairwise choice:
  on which construct would you rather be shifted to the non-preferred pole?), n=28: resistance
  to change correlated with a construct's superordinate range of implications at **mean
  rho = +0.59 (t=3.708, p<.0005)**; superordinate constructs had 17.89% more superordinate and
  18.89% more subordinate implications than subordinate ones (p<.001); mean resistance rank
  **7.86 for superordinate vs 13.14 for subordinate** (t=10.369, p<.0005) [Hinkle 1965]. His
  aside is a UX finding: subjects "were extremely interested and involved with this part of
  the experimental procedure, because — in effect — they are being asked to delineate some of
  their most fundamental commitments in their present life."

- **The grid bypasses defences, and its known limitation is flatness.** "The repertory grid
  was an instrument designed by Kelly to **bypass cognitive defences**… it is often easier and
  more accurate for the expert to provide critical cases rather than a domain ontology." The
  caveat: "The original repertory grid methodology is based primarily on only one aspect of
  Kelly's personal construct psychology, his dichotomy corollary… a flat structure… that does
  not represent the hierarchical structure of Kelly's organization corollary" — laddering is
  the fix, tooled in ETS, then AQUINAS, then WebGrid. Manual grids "are difficult to undertake
  manually as they require feedback and management from the elicitor while at the same time
  attempting to avoid inter-personal interactions that would **distort the elicitee's
  conceptual structures**" — which is the standing argument for machine elicitation
  [Gaines & Shaw 1993].

*Not verified:* Kelly's own formal definition of core vs peripheral constructs (only Gaines &
Shaw's gloss plus Hinkle's operationalization); the pyramiding/laddering-down literature
(Landfield 1971); and any primary methodological statement *forbidding* elicitor-supplied
poles — supplied constructs do exist in practice.

### Sources
- Kelly, G. A. — *A Brief Introduction to Personal Construct Theory* (1966 lecture; reprinted 2017). https://www.aippc.it/wp-content/uploads/2019/04/2017.01.003.025.pdf
- Kelly, G. A. — *The Psychology of Personal Constructs*, Norton, 1955. RRT procedure reproduced at https://www.idiogrid.com/RRT_Original.htm
- Hinkle, D. N. — *The Change of Personal Constructs from the Viewpoint of a Theory of Construct Implications*, PhD dissertation, Ohio State University, 1965; republished PCTP 7, 2010, Supp. 1. https://www.pcp-net.org/journal/pctp10/hinkle1965.pdf
- Gaines, B. R., & Shaw, M. L. G. — *Knowledge Acquisition Tools based on Personal Construct Psychology*, The Knowledge Engineering Review 8(1):49–85, 1993. https://gaines.library.uvic.ca/pdf/KATPCP93.pdf

---

## 3. Open learner models and negotiated learner modelling

- **SMILI is five questions, three of which are tables crossed against *purposes*.** (1) Context
  — how the open model fits the interaction; (2) how it was evaluated; (3) WHAT is open;
  (4) HOW it is presented; (5) WHO controls access. WHAT/HOW/WHO are filled against the
  purposes: improving model *accuracy*; supporting *planning, monitoring, reflection*;
  facilitating *collaboration/competition*; facilitating *navigation*; respecting the right to
  *access and control*. The 2016 revision promotes WHY to a first-class question and splits
  WHO into who *controls* and who may *access* [Bull & Kay 2007; Bull & Kay 2016].

- **The edit-rights taxonomy is a four-point scale: inspectable / cooperative / negotiated /
  editable.** It sits under HOW as *method of accessing*, alongside *flexibility of access*
  (views, levels of detail). Under WHAT sit *extent of model accessible* (complete vs partial)
  and — notably — *access to uncertainty*, i.e. whether the system's own confidence is shown is
  a named, separate design decision [Bull & Kay 2016].

- **Kay's scrutability rests on accretion–resolution: evidence is appended, never overwritten,
  and values are computed only when asked.** Each piece of evidence is stored against a model
  *component* with a timestamp, source application, and evidence type; on query, a filter
  selects what the asker may see and a *resolver* function interprets it — from a point query
  up to a Bayesian model. The framework's stated stance is "**Embrace inconsistency, multiple
  interpretations!**", and scrutability is defined by the questions it must answer: *Why did
  the system adapt that way? Where does it think I am, and why? What did it think on May 1st
  2001?* [Kay, Kummerfeld & Lauder 2002; Personis documentation].

- **Mr. Collins keeps two parallel belief sets and, when negotiation fails, retains both.** It
  holds the system's inference about the learner's understanding *and* the learner's own
  confidence, with *interaction symmetry* — identical moves for both parties: challenge, offer
  evidence, request explanation, agree, disagree, suggest, accept compromise. Verbatim from
  Bull's review: "If discussion cannot resolve disagreement about the model data, both belief
  sets are retained in the learner model separately" [Bull & Pain 1995, in Bull 2016].

- **STyLE-OLM makes disagreement a stored object, not a UI state.** Eight dialogue moves
  (Inform, Inquire, Challenge, Disagree, Justify, Agree, Suggest, Skip) with rules governing
  which may follow which. Learner and system each own a *commitment store*; a maintainer checks
  for inconsistency, removes conflicting beliefs, adds new ones, and **registers the conflict**,
  which "may trigger a new negotiative game." The model handed downstream is only the
  *agreements*, of three kinds: **implicit** (both stores support it after commonsense
  reasoning), **explicit** (both proclaimed it), **assumed** (one store silent but not
  contradictory — recorded with `none` in the missing slot). Conflicts persist as first-class
  `conflict(learner_belief, system_belief, graph_id)` predicates [Dimitrova 2003].

- **Flat override exists; the cost is that the system loses arbitration, and some designs accept
  that deliberately.** Bull's interaction-strength ladder: direct edit → persuade by
  demonstrating knowledge in a short extra quiz (*system ultimately retains control*, e.g.
  EER-Tutor) → supply extra evidence for integration (Kay 1997) → full negotiation toward an
  *agreed model*. xOLM is the outlier: learners may agree, disagree, or "move on (without
  resolution)", and "xOLM allows the learner's challenge to succeed in cases of unresolved
  disagreement." Empirically: when errors were deliberately seeded, learners corrected them and
  **the model became more accurate** (Bull et al. 2008); open models improved self-assessment
  for weaker university students (Mitrovic & Martin 2007) and for schoolchildren (Kerly & Bull
  2008). Scale caveat: STyLE-OLM's own study was formative with **seven** postgraduates and
  the learning effect was not evaluated [Bull 2016; Dimitrova 2003].

### Sources
- Bull, S. & Kay, J. — *Student Models that Invite the Learner In: The SMILI☺ Open Learner Modelling Framework*, IJAIED 17(2):89–120, 2007. https://journals.sagepub.com/doi/10.3233/IRG-2007-17%282%2902
- Bull, S. & Kay, J. — *SMILI☺: a Framework for Interfaces to Learning Data in Open Learner Models, Learning Analytics and Related Fields*, IJAIED 26:293–331, 2016. https://link.springer.com/article/10.1007/s40593-015-0090-8
- Bull, S. — *Negotiated learner modelling to maintain today's learner models*, RPTEL 11:10, 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC6302918/
- Dimitrova, V. — *STyLE-OLM: Interactive Open Learner Modelling*, IJAIED 13:35–78, 2003. https://telearn.hal.science/hal-00197312/document
- Kay, J., Kummerfeld, B. & Lauder, P. — *Personis: A Server for User Models*, AH 2002, pp. 203–212. https://link.springer.com/chapter/10.1007/3-540-47952-X_22
- Personis User Modeling Framework documentation. https://pythonhosted.org/personis/Intro.html

---

## 4. Memory taxonomy and autobiographical memory

- **Squire's split explains, in one sentence, why skills are unaskable.** Declarative memory has
  two components — semantic (facts about the world) and episodic ("the ability to re-experience
  a time-and-place-specific event in its original context"). Against it: "**Nondeclarative
  memory is dispositional and is expressed through performance rather than recollection.**"
  The habits and preferences it holds "are inaccessible to conscious recollection, but they
  nevertheless are shaped by past events, they influence our current behavior and mental life,
  and they are a fundamental part of who we are." This is an established double dissociation,
  not a modelling convenience [Squire & Dede 2015].

- **Tulving's criteria migrated from materials to phenomenology.** In his own retrospective,
  episodic memory "was defined in terms of materials and tasks" in 1972 and "was subsequently
  refined and elaborated in terms of ideas such as *self*, *subjective time*, and **autonoetic
  consciousness**", supported by dissociation in brain damage (patient K.C.) and by
  neuroimaging [Tulving 2002]. *Verified at abstract level only.*

- **The self-memory system is a three-level partonomy plus a goal-driven gatekeeper — and it
  doubles as an archive of former selves.** Autobiographical *knowledge* is organised life story
  → **lifetime periods** ("At University X") → **general events** ("Taking first-year laboratory
  classes"); *episodic memories* (event-specific knowledge) are sensory-perceptual and
  experience-near. The *working self* is a goal hierarchy that modulates which cues reach the
  knowledge base. Load-bearing for an inspectable model: "when goals change and new themes and
  lifetime periods become central to the working self, **a record of the past concerns of an
  older version of the working self exists** in the form of general events and the colonies of
  episodic memories they access" [Conway & Pleydell-Pearce 2000; Conway 2005].

- **The time you allow determines whether you get an episode or an abstraction — with numbers.**
  All generative retrieval cycles terminate in direct retrieval; direct retrieval merely skips
  the iterative search. With probe deadlines at 2s / 5s / 30s: over **44%** of specific memories
  were already present at **2s**, but about **38%** of responses at 2s were autobiographical
  *knowledge* (general events, lifetime periods) rather than specific memories; by 30s virtually
  all responses were specific memories [Conway 2005, reporting Haque & Conway 2001].

- **Correspondence and coherence compete, and repeated telling pushes toward coherence.**
  Coherence (a stable self with a confirmatory past) and correspondence (accurate record of goal
  processing) are "separate but competing demands"; recent memory is biased toward
  correspondence at the expense of coherence, long-term memory the reverse — extreme decoupling
  yields confabulation. The behavioural counterpart: conversational retellings depend on the
  speaker's goals, the audience, and the social context rather than on accuracy, are "often
  incomplete or distorted", and **this changes later memory** through selective rehearsal and
  the schema activated during retelling [Conway 2005; Marsh 2007].

- **Two instruments worth stealing.** The lifespan retrieval curve has three components —
  childhood amnesia (birth to ~5), the **reminiscence bump (ages 10–30)**, and recency; Conway,
  Wang, Hanyu & Haque (2006) sampled the US, UK, Bangladesh, Japan and China and found bump and
  childhood amnesia statistically reliable in all five. The self-defining-memory task specifies
  its *qualifying conditions* rather than its topic: at least one year old; vivid and still
  important; about an enduring theme, issue or conflict; linked to other memories sharing that
  theme; produces strong feeling; thought about many times — with the instruction to write it
  "as if you were telling them to someone you wanted to get to know you" [Singer & Salovey 1993;
  Blagov et al. 2022].

- **Prospective memory runs on two pathways, and monitoring is a metered cost.** One pathway is
  top-down attentional control that maintains the intention and monitors for target cues; the
  second is bottom-up spontaneous retrieval triggered by the cue, which "is assumed not to
  require monitoring or active maintenance." Focal cues recruit spontaneous retrieval; nonfocal
  cues require strategic monitoring. Empirically sharp: there was **no monitoring cost prior to
  the first prospective cue**, but individuals who spontaneously retrieved the intention then
  began monitoring, and disengaged when cues stopped being expected [McDaniel et al. 2015;
  Scullin, McDaniel & Shelton 2013].

### Sources
- Tulving, E. — *Episodic Memory: From Mind to Brain*, Annual Review of Psychology 53:1–25, 2002. https://www.annualreviews.org/doi/10.1146/annurev.psych.53.100901.135114
- Squire, L. R. & Dede, A. J. O. — *Conscious and Unconscious Memory Systems*, Cold Spring Harbor Perspectives in Biology 7:a021667, 2015. http://whoville.ucsd.edu/PDFs/498_Squire_Dede_CSH_PerspBiol_2015.pdf
- Conway, M. A. & Pleydell-Pearce, C. W. — *The construction of autobiographical memories in the self-memory system*, Psychological Review 107(2):261–288, 2000. https://doi.org/10.1037/0033-295X.107.2.261
- Conway, M. A. — *Memory and the self*, Journal of Memory and Language 53:594–628, 2005. http://www.self-definingmemories.com/Conway_2005.pdf
- Blagov, Singer, Oost & Goodman — *Self-defining memories*, Journal of Personality, 2022 (supplement contains the verbatim task). http://www.self-definingmemories.com/blagov_SDM.pdf
- McDaniel, Umanath, Einstein & Waldum — *Dual pathways to prospective remembering*, Frontiers in Human Neuroscience 9:392, 2015. https://pmc.ncbi.nlm.nih.gov/articles/PMC4500919/
- Scullin, McDaniel & Shelton — *The Dynamic Multiprocess Framework*, Cognitive Psychology 67(1–2):55–71, 2013. https://pmc.ncbi.nlm.nih.gov/articles/PMC3809757/
- Marsh, E. J. — *Retelling Is Not the Same as Recalling*, Current Directions in Psychological Science 16(1):16–20, 2007. https://journals.sagepub.com/doi/10.1111/j.1467-8721.2007.00467.x

---

## 5. Narrative identity and the Life Story Interview

- **The Foley Center protocol has seven lettered sections in fixed order: A. Life Chapters →
  B. Key Scenes → C. Future Script → D. Challenges → E. Personal Ideology → F. Life Theme →
  G. Other.** Section A asks the person to treat life "as if it were a book or novel" with a
  table of contents, title each chapter, and "say a word or two about how we get from one
  chapter to the next" (2–7 chapters, 15–30 minutes). C has three units (next chapter /
  dreams-hopes-plans / life project); D has four (life challenge / health / loss /
  failure-regret); E has five, one of which is explicitly about **change over time** in those
  views [McAdams, LSI-II, 2007].

- **Section B contains exactly eight key scenes: high point, low point, turning point, positive
  childhood memory, negative childhood memory, vivid adult memory, religious/spiritual/mystical
  experience, wisdom event.** A key scene is defined as "an event or specific incident that took
  place at a particular time and place" — an episode, not a period [McAdams 2007].

- **Every scene carries the same five-slot probe, stated once and repeated verbatim per scene:
  what happened / when and where / who was involved / what you were thinking and feeling /
  "what does this memory say about you or about your life?"** The framing instruction is exact
  and directly relevant to Arrangement roles: "In addition, I ask that you tell me why you think
  this particular scene is important or significant in your life. What does the scene say about
  you as a person? Please be specific." [McAdams 2007].

- **Redemption and contamination are defined as *sequences*, and they predict outcomes.** A
  redemption sequence "marks a transition in a life narrative account from an emotionally
  negative scene to a positive outcome or attribution about the self"; contamination is the
  reverse. Midlife adults high in self-reported generativity showed significantly higher
  redemption and lower contamination; redemption was positively associated with psychological
  well-being in both midlife and student samples [McAdams, Reynolds, Lewis, Patten & Bowman
  2001].

- **The three-level model refuses reduction between levels.** Level I = dispositional traits
  ("broad, decontextualized, and relatively nonconditional constructs… a psychology of the
  stranger"); Level II = characteristic adaptations (personal strivings, life tasks, coping
  strategies — contextualized in time, place, role); Level III = identity as "an inner story of
  the self that integrates the reconstructed past, perceived present, and anticipated future to
  provide a life with unity, purpose, and meaning." McAdams argues knowing Levels I and II
  leaves you not knowing the person "well at all" [McAdams 1995].

- **Agency and communion are scored 0–4 on two orthogonal dimensions, with a defined neutral.**
  Agency: 0 = "protagonist is completely powerless, at mercy of circumstances"; 4 = "able to
  affect their own life, initiate changes on their own." Communion: 0 = "completely
  disconnected, isolated, or rejected"; 4 = "rich connection language predominant." **2 is
  reserved for "no code-able language" *or* equal amounts of both** — a genuinely useful pattern
  for any stance scale: absence and balance share the midpoint and must be distinguished
  elsewhere [Foley Center revised A/C manual, Adler; McAdams et al. 1996].

- **The field states its constructivism explicitly and prescribes an iterative reliability
  protocol.** "Like all autobiographical memories, narratives of personal experiences are
  dynamically reconstructed representations of events. Each time a memory is recalled, the
  retrieval process is a complex interaction between the internal neural context and external
  sociocultural context, modulated by the functions that remembering serves in that moment…
  Narratives are subjective constructions that have objective impacts." On coding: two raters
  minimum; raters "rarely achieve appropriate inter-rater reliability on the first attempt," so
  they discuss disagreements, reach consensus, **refine the coding system**, and re-code — a
  process typically consuming 10–25% of the dataset, with periodic re-checks "to avoid coder
  drift" [Adler et al. 2017].

*Not verified:* a primary-source formal definition of *imago*; the redemption/contamination
coding manuals themselves (unpublished Northwestern manuscripts).

### Sources
- McAdams, D. P. — *The Life Story Interview – II*, Foley Center for the Study of Lives, Northwestern University, rev. 2007. https://cpb-us-e1.wpmucdn.com/sites.northwestern.edu/dist/4/3901/files/2020/11/The-Life-Story-Interview-II-2007.pdf
- McAdams, D. P. — *What Do We Know When We Know a Person?*, Journal of Personality 63(3):365–396, 1995. https://simine.com/407/readings/McAdams_1995.pdf
- Adler, J. (dev.) — *Revised Coding System for Agency and Communion*, Study of Lives Research Group, Northwestern. https://cpb-us-e1.wpmucdn.com/sites.northwestern.edu/dist/4/3901/files/2020/11/Revised-Coding-System-for-Agency-and-Communion-developed-by-Jon-Adler.pdf
- McAdams, Reynolds, Lewis, Patten & Bowman — *When Bad Things Turn Good and Good Things Turn Bad*, PSPB 27(4):474–485, 2001. https://journals.sagepub.com/doi/10.1177/0146167201274008
- Adler, Dunlop, Fivush, Lilgendahl, Lodi-Smith, McAdams, McLean, Pasupathi & Syed — *Research Methods for Studying Narrative Identity: A Primer*, SPPS 8(5):519–527, 2017. https://osf.io/cz3q3/download
- McAdams — *Themes of Agency and Communion in Significant Autobiographical Scenes*, Journal of Personality 64(2), 1996. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-6494.1996.tb00514.x

---

## 6. Truth maintenance and belief revision

- **Doyle's TMS uses exactly two justification forms, and assumption-hood is a property of the
  current support, not of the node.** A support-list justification `(SL <inlist> <outlist>)`
  "is valid if and only if each node in its inlist is in, and each node in its outlist is out."
  Empty/empty = a **premise** justification (always valid). Nonempty inlist + empty outlist = a
  monotonic deduction. "We define **assumptions** to be nodes whose supporting-justification has
  a nonempty outlist." Doyle's gloss transfers directly: inlist nodes comprise "the reasons for
  wanting to assume the justified node; the nodes of the outlist represent the specific criteria
  authorizing this assumption" — outlist entries read as *denials*, things whose arrival would
  withdraw the belief [Doyle 1979].

- **The architectural split is a division of inference labor, not of authority.** "The TMS never
  uses or examines the external forms of justifications, but merely records them for use by the
  problem solver." De Kleer restates it: "there are two inference procedures in the reasoning
  system both operating on the same expressions but treating them entirely differently."
  Contradictions are *declared by the problem solver*; dependency-directed backtracking then
  "analyzes the well-founded argument of the contradiction node to locate the assumptions
  occurring in the argument," records the inconsistent set as a **nogood**, and changes one
  assumption (the *culprit*) [Doyle 1979; de Kleer 1986].

- **The ATMS replaces one labeled state with per-datum descriptions of *all* states.** A *node*
  is a datum; an *assumption* is a special node; a *justification* has consequent, antecedents,
  and an **informant**; an *environment* is a set of assumptions; a *context* is a consistent
  environment plus everything derivable; and a node's **label is a set of environments**, each
  consistent and each sufficient to derive the node. "The ATMS associates with every datum a
  parsimonious description of every context in which the datum holds… extremely convenient for
  the problem solver to work in all contexts at once" [de Kleer 1986].

- **De Kleer's two stated reasons for holding contexts open map onto recorded Contradictions
  exactly.** The *single-state problem*: conventional algorithms "only allow one solution to be
  considered at a time… It is impossible to examine both of these solutions together. However,
  this is often exactly what one wants to do in problem solving." *Overzealous contradiction
  avoidance*: "**All a contradiction between A and B indicates is that inferences dependent on
  both A and B be avoided. But it is still important to draw inferences from A and B
  independently.**" Also: in a JTMS "there is no way to go back to a previous state" [de Kleer
  1986].

- **AGM's three operations, and the criterion that drives them.** Over a belief set K closed
  under consequence: expansion `K+φ = Cn(K ∪ {φ})`, revision `K*φ`, contraction `K÷φ`, each
  governed by eight postulates and by the **criterion of informational economy**: "we want to
  retain as much as possible from our old beliefs… unnecessary losses of information are
  therefore to be avoided." Minimality resists quantitative definition, so it is cashed out via
  **epistemic entrenchment**, an ordering axiomatized by transitivity, dominance,
  conjunctiveness, minimality, maximality — and "different belief sets may be associated with
  different orderings of epistemic entrenchment." Interdefinable via the **Levi identity**
  `K*φ = (K÷¬φ)+φ` and the **Harper identity** `K÷φ = K ∩ K*¬φ` [Gärdenfors 1992, restating
  Alchourrón, Gärdenfors & Makinson 1985].

- **Revision and update are different operations for different causes.** "On the one hand there
  is new information about a static world. For this kind of information the revision process…
  is appropriate. On the other hand, there is new information about **changes in the world
  brought about by some agent**" — for that, updating. Formally, revision selects models of φ
  closest to the models of K; update selects, *for each model I of K*, the models of φ closest
  to I, then unions them. Separately, the **foundations/coherence split is exactly the "keep the
  justifications?" question**: foundations theory "holds that one should keep track of the
  justifications for one's beliefs: Propositions that have no justification should not be
  accepted as beliefs," coherence theory "holds that one need not consider the pedigree of one's
  beliefs" [Gärdenfors 1992 on Katsuno & Mendelzon and on Doyle; Harman 1986].

*Not verified:* the often-quoted sentence "the TMS never creates beliefs, only records
justifications" does not appear literally in Doyle 1979 — the architectural claim above is
assembled from Doyle's text plus de Kleer's restatement. AGM formalism is quoted from
Gärdenfors' own 1992 exposition (a co-author), not the 1985 article, whose only free PDF is an
untextured scan.

### Sources
- Doyle, J. — *A Truth Maintenance System*, Artificial Intelligence 12(3):231–272, 1979. https://cse.buffalo.edu/~rapaport/Papers/Papers.by.Others/NONMONOTONIC/doyle79.pdf
- de Kleer, J. — *An Assumption-based TMS*, Artificial Intelligence 28(2):127–162, 1986. https://dekleer.org/Publications/An%20Assumption-Based%20TMS.pdf
- Gärdenfors, P. — *Belief Revision: An Introduction*, in *Belief Revision*, Cambridge UP, 1992. https://www.lucs.lu.se/fileadmin/user_upload/project/lucs/PG/pg-1992d.pdf
- Alchourrón, Gärdenfors & Makinson — *On the Logic of Theory Change: Partial Meet Contraction and Revision Functions*, Journal of Symbolic Logic 50(2):510–530, 1985. https://www.cambridge.org/core/services/aop-cambridge-core/content/view/7ED837BAD5FB6D9A7C77906D73527F9C/S0022481200032849a.pdf/on_the_logic_of_theory_change_partial_meet_contraction_and_revision_functions.pdf
- Doyle, J. — *Reason Maintenance and Belief Revision: Foundations vs. Coherence Theories*, in Gärdenfors (ed.), *Belief Revision*, 1992.

---

## 7. Self-report validity, introspection limits, first-person authority

- **Nisbett & Wilson's claim is about *process*, and is narrower than its reputation.** "There
  may be little or no direct introspective access to higher order cognitive processes… their
  reports are based on a priori, implicit causal theories, or judgments about the extent to
  which a particular stimulus is a plausible cause of a given response." The abstract grants
  that accurate reports occur "when influential stimuli are salient and are plausible causes of
  the responses they produce," and the body adds "We do not wish to imply that all or even most
  a priori causal theories are wrong… they are incorrectly applied in the particular instance"
  [Nisbett & Wilson 1977, pp. 231, 249].

- **The paper contains an explicit section granting privileged access to CONTENT — this is the
  load-bearing passage for Elicit.** Under "Confusion Between Content and Process": a person
  "does indeed have direct access to a great storehouse of private knowledge… he knows a host of
  personal historical facts; he knows the focus of his attention at any given point in time; he
  knows what his current sensations are and has what almost all psychologists and philosophers
  would assert to be 'knowledge' at least quantitatively superior to that of observers
  concerning his **emotions, evaluations, and plans**." They add this content access "will
  sometimes allow him to be more accurate in his reports about the causes of his behavior than
  an observer would be" [Nisbett & Wilson 1977, pp. 255–256].

- **The numbers, and the correct diagnostic.** Stockings: 4 *identical* pairs, 52 passersby; the
  rightmost preferred almost four to one; **no subject spontaneously mentioned position**, and
  when asked directly "virtually all subjects denied it." Insomnia: arousal-attribution subjects
  got to sleep **28% quicker**, relaxation-attribution **42% longer**, and subjects *rejected*
  the mechanism when it was explained. Nisbett & Bellows: subjects' reports about which factors
  drove their *intelligence* judgment correlated **.94** with true effects — but naive
  **observers who never did the task scored .98**; for liking, sympathy, and flexibility,
  subject accuracy was **−.31, .14, .11**, again matched by observers. The diagnostic is not
  "was the subject right" but "**did the subject beat an outsider guessing from a shared folk
  theory**" [Nisbett & Wilson 1977].

- **Ericsson & Simon's counter-position is about report *type*, and the strong form survived
  meta-analysis.** Level 1 = vocalizing already-verbal contents of short-term memory; Level 2 =
  explicating a nonverbal encoding into words (costs time, does not change the course of
  thought); Level 3 = explanation, reasons, filtering — requires processes the task never
  demanded, and is therefore both reactive and non-veridical. Fox, Ericsson & Best tested this
  over **94 studies, ~3,500 participants**: think-aloud effect on accuracy **r = −.03,
  indistinguishable from zero**, while "procedures that entail describing or explaining thoughts
  and actions are significantly reactive, leading to higher performance than silent control
  conditions." Ericsson's own boundary statement: participants "can report only the end-products
  of their cognitive processes… they cannot report why only one of several logically possible
  thoughts entered their attention, [so] they must make inferences or confabulate answers," and
  requests for *general* method descriptions across many trials "often lead to misleading
  summaries or after-the-fact reconstructions" [Ericsson & Simon 1980/1993; Fox et al. 2011;
  Ericsson 2006].

- **Choice blindness supplies the constraint that matters most for Snippet admissibility:
  confabulated reports are indistinguishable from genuine ones on every surface cue.** Of **354
  manipulated trials, only 46 (13%)** were detected concurrently; across all detection routes
  "no more than 26% of all M trials were exposed." Participants then gave reasons for a face
  they had not chosen, and the two report sets **did not differ in emotionality, specificity, or
  certainty** (means ~3.5, 3.1, 3.3 on a 1–5 scale), nor in length, tense, or laughter. **84%**
  of participants who missed every manipulation believed they would have noticed one. Fluency
  and confidence are not evidence of veridicality [Johansson, Hall, Sikström & Olsson 2005].

- **The philosophical literature splits the question in a way that directly justifies the
  Protocol concept.** Schwitzgebel argues even *current conscious experience* is grossly
  misreported "even in favorable circumstances of extended reflection," worst for emotional
  experience, peripheral vision, and the phenomenology of thought — and notes confidence rises
  when people are "queried in a casual and trusting way," which is exactly Elicit's operating
  condition. Moran, from the other direction, distinguishes a **theoretical question** about
  one's own mind ("What *was* my attitude?" — answered by self-observation, defeasible like any
  observation) from a **deliberative question** ("What *is* my attitude toward P?" — answered
  via the Transparency Condition, by addressing whether P is true). An **avowal** is an answer
  obeying Transparency; its authority is *constitutive, not evidential*, so it is not a fallible
  report about an antecedent state at all [Schwitzgebel 2008; Moran 2001/2004].

**Verdict on the design premise.** "Record what the person says as evidence of what they say,
not as evidence of the fact" is well supported for *why*-questions, causal attributions,
covariation claims, and retrospective process summaries. It is **over-strong for content**:
focus of attention, current sensation, personal historical fact, emotion, evaluation, plan, and
idiosyncratic prior reaction are precisely what Nisbett & Wilson concede and what Moran's
avowals cover. The defensible version distinguishes **avowal Snippets** (privileged; the saying
largely constitutes the fact) from **explanation Snippets** (evidence only of the person's own
causal theory — which is itself a real, citable, first-class fact about them).

### Sources
- Nisbett, R. E., & Wilson, T. D. — *Telling more than we can know: Verbal reports on mental processes*, Psychological Review 84(3):231–259, 1977. https://web.mit.edu/curhan/www/docs/Articles/15341_Readings/Social_Cognition/Nisbett_Wilson_1977_Telling_more_than_we_can_know.pdf
- Ericsson, K. A., & Simon, H. A. — *Verbal reports as data*, Psychological Review 87(3):215–251, 1980. https://doi.org/10.1037/0033-295X.87.3.215
- Ericsson, K. A. — *Protocol Analysis and Expert Thought*, in *The Cambridge Handbook of Expertise and Expert Performance*, 2006. https://www.ida.liu.se/~nilda08/Anders_Ericsson/Ericsson_protocol.pdf
- Fox, M. C., Ericsson, K. A., & Best, R. — *Do procedures for verbal reporting of thinking have to be reactive?*, Psychological Bulletin 137(2):316–344, 2011. https://pubmed.ncbi.nlm.nih.gov/21090887/
- Johansson, Hall, Sikström & Olsson — *Failure to detect mismatches between intention and outcome in a simple decision task*, Science 310(5745):116–119, 2005. https://www.lucs.lu.se/fileadmin/user_upload/lucs/2011/01/Johansson-et-al.-2005-Failure-to-Detect-Mismatches-Between-Intention-and-Outcome-in-a-Simple-Decision-Task.pdf
- Schwitzgebel, E. — *The Unreliability of Naive Introspection*, The Philosophical Review 117(2):245–273, 2008. https://gwern.net/doc/philosophy/mind/2008-schwitzgebel.pdf
- Moran, R. — *Précis of Authority and Estrangement: An Essay on Self-Knowledge*, 2004. https://dash.harvard.edu/bitstreams/7312037c-62df-6bd4-e053-0100007fdf3b/download

---

## 8. Experience sampling and ecological momentary assessment

- **The taxonomy is Wheeler & Reis's, and it classifies *what triggers the report*.**
  **Interval-contingent** (fixed regular intervals), **signal-contingent** (when signaled,
  typically at random times), **event-contingent** (whenever a defined event occurs).
  Csikszentmihalyi & Larson's ESM is the signal-contingent case: a pager on a random schedule,
  an Experience Sampling Form completed on the spot; their 1987 paper argues validity by
  correlating ESM measures against physiological measures, one-time psychological tests, and
  behavioral indices [Wheeler & Reis 1991; Csikszentmihalyi & Larson 1987].

- **Retrospective summaries are a different construct, not a noisier version — established, not
  asserted.** Redelmeier & Kahneman recorded real-time pain in **154 colonoscopy and 133
  lithotripsy patients**: remembered total pain tracked **peak intensity** and **the last 3
  minutes** (both P < 0.005), while duration was neglected. Stone, Broderick, Shiffman &
  Schwartz then compared weekly pain recall against averaged momentary reports in **68 chronic
  pain patients over 2 weeks**: between-person correspondence was moderate to high, but
  **within-person correspondence was low**, and judged change was only weakly related to actual
  change — "a serious nonequivalence." Schwarz names the mechanisms: peak-and-end heuristic,
  duration neglect, and theory-driven reconstruction — the last being Nisbett & Wilson's a
  priori causal theory operating on memory: "respondents often draw on naïve theories of
  covariation to reconstruct the relevant behaviors in the first place" [Redelmeier & Kahneman
  1996; Stone et al. 2004; Schwarz 2007].

- **Question *wording* changes validity as much as timing does.** Against same-day momentary
  recordings (**106 participants, 2,852 days**), end-of-day questions phrased "how much / how
  intense / on average" correlated **r = .85–.90 (pain)** and **.81–.83 (fatigue)** with
  momentary aggregates, while "minimum" and "maximum" phrasings correlated only **.73–.80** and
  **.67–.75**. Asking for an extremum recruits the peak-end machinery; asking for an average
  does not [Stone, Broderick & Schwartz 2010].

- **The compliance finding is the field's strongest number, and it is about *faked* compliance.**
  Chronic pain patients made three paper-diary entries per day for 21 days; the binder was
  covertly instrumented with a photosensor. Submitted cards claimed **90%** compliance; actual
  compliance was **11%**. On **32% of all study days the binder was never opened at all**, yet
  reported compliance for those days still exceeded 90%. An electronic diary with
  compliance-enforcing features achieved **94%** [Stone, Shiffman, Schwartz, Broderick &
  Hufford 2002/2003].

- **Two large meta-analyses agree that burden is a weaker lever than intuition suggests.**
  Wrzus & Neubauer coded **k = 477 articles / 496 samples / N = 677,536**: the average EMA study
  scheduled **6 assessments per day for 7 days** and obtained **79% compliance**; critically,
  **the number of assessments per day did not predict compliance or dropout**, and only
  financial incentives significantly raised it. Williams et al. found the same shape in 105
  adult datasets: median **7 days**, median **5 prompts/day**, median **8–10 items per prompt**,
  pooled compliance **81.9% (95% CI 79.1–84.4)**, and "no compelling relationship… between key
  features of mEMA protocols representing burden and mEMA compliance" [Wrzus & Neubauer 2023;
  Williams et al. 2021].

- **Elicit's Mode/Protocol matching has an exact prior term — "receptivity" — but the evidence
  is thin and the field says so.** Nahum-Shani et al. define a JITAI by six elements (distal
  outcome, proximal outcomes, **decision points**, intervention options, **tailoring
  variables**, **decision rules**) plus **states of vulnerability/opportunity**, and define
  **receptivity** as "the individual's transient ability and/or willingness to receive, process,
  and utilize just-in-time support… a function of both internal (e.g., mood) and contextual
  (e.g., location) factors." They then flag their own epistemic status: "**The underlying
  assumption is that** providing support when the person is not receptive will not be beneficial
  and may even have negative implications on engagement." The best direct test found is small:
  a within-subject comparison in **19 smart homes** (536 random-timed vs 537 context-timed
  prompts) raised response rate from **78.62% to 84.26%** (p < .05), improving in 15 of 19 homes
  and *decreasing* in 4. That is a real but modest effect on *response rate*; **no primary
  evidence was found that state-matched timing improves the quality or veridicality of the
  answer** [Nahum-Shani et al. 2018; Aminikhanghahi, Schmitter-Edgecombe & Cook 2019].

*Reactivity note:* Williams et al. report that **95.8% of studies ran no test of measurement
reactivity**. Treat "asking repeatedly does not change the person" as unverified, not as
established. *Not verified:* Csikszentmihalyi & Larson 1987 full text (paywalled — no primary
numbers); the phrase "parking lot compliance" appears to be field folklore, not a term from
Stone et al.

### Sources
- Csikszentmihalyi, M., & Larson, R. — *Validity and Reliability of the Experience-Sampling Method*, Journal of Nervous and Mental Disease 175(9):526–536, 1987. https://pubmed.ncbi.nlm.nih.gov/3655778/
- Wheeler, L., & Reis, H. T. — *Self-Recording of Everyday Life Events: Origins, Types, and Uses*, Journal of Personality 59(3):339–354, 1991. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-6494.1991.tb00252.x
- Shiffman, S., Stone, A. A., & Hufford, M. R. — *Ecological Momentary Assessment*, Annual Review of Clinical Psychology 4:1–32, 2008. https://www.annualreviews.org/content/journals/10.1146/annurev.clinpsy.3.022806.091415
- Redelmeier, D. A., & Kahneman, D. — *Patients' memories of painful medical treatments*, Pain 66(1):3–8, 1996. https://pubmed.ncbi.nlm.nih.gov/8857625/
- Stone, Broderick, Shiffman & Schwartz — *Understanding recall of weekly pain from a momentary assessment perspective*, Pain 107(1–2):61–69, 2004. https://pubmed.ncbi.nlm.nih.gov/14715390/
- Stone, Broderick & Schwartz — *Validity of average, minimum, and maximum end-of-day recall assessments of pain and fatigue*, Contemporary Clinical Trials 31(5):483–490, 2010. https://pubmed.ncbi.nlm.nih.gov/20620239/
- Stone, Shiffman, Schwartz, Broderick & Hufford — *Patient non-compliance with paper diaries*, BMJ 324:1193–1194, 2002. https://pubmed.ncbi.nlm.nih.gov/12016186/
- Schwarz, N. — *Retrospective and Concurrent Self-Reports: The Rationale for Real-Time Data Capture*, 2007. https://dornsife.usc.edu/norbert-schwarz/wp-content/uploads/sites/231/2023/11/schwarz_retrospective_self-reports_mdc_2007.pdf
- Wrzus, C., & Neubauer, A. B. — *Ecological Momentary Assessment: A Meta-Analysis on Designs, Samples, and Compliance*, Assessment 30(3):825–846, 2023. https://pubmed.ncbi.nlm.nih.gov/35016567/
- Williams, Lewthwaite, Fraysse, et al. — *Compliance With Mobile Ecological Momentary Assessment: Systematic Review and Meta-analysis*, JMIR 23(3):e17023, 2021. https://pubmed.ncbi.nlm.nih.gov/33656451/
- Nahum-Shani, Smith, Spring, Collins, Witkiewitz, Tewari & Murphy — *Just-in-Time Adaptive Interventions (JITAIs) in Mobile Health*, Annals of Behavioral Medicine 52(6):446–462, 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/
- Aminikhanghahi, Schmitter-Edgecombe & Cook — *Context-Aware Delivery of Ecological Momentary Assessment*, 2019. https://eecs.wsu.edu/~cook/pubs/jbi19.pdf

---

## 9. LLM user modelling, agent memory, personal knowledge graphs from dialogue

- **Generative Agents' reflection is the closest existing precedent for "every claim cites its
  Snippets."** The paper explicitly prompts the model to "extract insights and **cite the
  particular records that served as evidence** for the insights," producing a reflection tree
  whose leaves are raw observations and whose interior nodes are synthesized inferences pointing
  back at them. Reflection fires when accumulated importance of recent observations crosses a
  threshold (150; ~2–3×/simulated day), and its first step is **generating questions** ("what
  are the 3 most salient high-level questions we can answer about the subjects in the
  statements?") which then serve as retrieval queries — question-driven elicitation,
  structurally identical to Elicit's Provenance-carrying question [Park et al. 2023].

- **The retrieval scoring is less sophisticated than its reputation.** `score = α_recency·recency
  + α_importance·importance + α_relevance·relevance`, min-max normalized to [0,1], with all α
  set to 1 — an unweighted sum of three normalized signals. Each memory object is only a
  natural-language description plus creation and last-access timestamps. *Empirically
  evaluated*: five-condition ablation, 100 participants, TrueSkill ratings, Kruskal-Wallis with
  Holm-Bonferroni correction; observation, planning, and reflection each contributed
  significantly to believability [Park et al. 2023].

- **MemGPT's contribution is the OS analogy — "virtual context management": main context (the
  prompt) vs external context, with the LLM issuing function calls to page data between tiers
  and self-edit its own context** [Packer et al. 2023]. *Empirically evaluated* on
  beyond-context document analysis and multi-session chat. *Only the abstract was verified; the
  core/recall/archival memory naming is Letta's productized vocabulary and was not confirmed
  against a primary source.*

- **Zep/Graphiti is the nearest published architecture to Elicit's immutable versioning: a
  temporally-aware knowledge graph where facts carry validity intervals, so superseded beliefs
  are *invalidated rather than overwritten* — the graph records how knowledge changed, not just
  what is currently true.** *Empirically evaluated*: 94.8% vs MemGPT's 93.4% on Deep Memory
  Retrieval, and up to +18.5% accuracy with 90% lower latency on LongMemEval [Rasmussen et al.
  2025]. Mem0 reports 26% relative improvement over OpenAI's memory on LOCOMO with 91% lower p95
  latency [Chhikara et al. 2025].

- **The current survey framing splits memory into *parametric* vs *contextual* and defines six
  operations: consolidation, updating, indexing, forgetting, retrieval, condensation** [Du et
  al. 2025]. Elicit occupies an unusual cell — contextual, structured, *never updated in place*,
  and deliberately omitting forgetting. Worth naming as a deliberate deviation rather than an
  oversight.

- **The founding PKG paper sets inclusion by personal relevance, not notability:** a personal
  knowledge graph is "structured information about entities personally related to its user,
  **including ones that might not be globally important**" [Balog & Kenter 2019]. *A research
  agenda — proposed only, no system or evaluation.* No specific predicate/attribute taxonomy for
  personal facts was verifiable from it.

- **AIS is the reference attribution framework, and its precondition is Elicit's standalone
  requirement.** Output must be verifiable against an independent provided source, operationalized
  as a two-stage human annotation: **first, is the sentence interpretable standalone? then, is it
  supported?** *Empirically validated* via human evaluation on three generation datasets. The
  standalone-interpretability gate exists in AIS precisely because **un-standalone spans cannot
  be attribution-judged at all** [Rashkin et al. 2023].

- **Citation generation is far from solved.** ALCE evaluates fluency, correctness, and citation
  quality across ASQA/QAMPARI/ELI5; even the best LLMs lacked complete citation support ~50% of
  the time on ELI5 [Gao et al. 2023]. **Directly load-bearing gap: no primary evidence was found
  that requiring verbatim-quote grounding measurably reduces fabrication relative to
  paraphrase-with-citation.** Elicit's "agent never writes prose" constraint sidesteps the
  problem *by construction* rather than being validated by it.

- **Contradiction detection works better when it hinges on utterance structure.** DECODE
  introduces dialogue contradiction detection as its own task with a dedicated dataset and shows
  it supervises the task better than existing NLI data. The architectural result that matters:
  models that explicitly **pair candidate utterances** generalize better out-of-distribution than
  unstructured Transformers over flattened dialogue — an argument for storing Contradictions as
  pairwise objects between identified Snippets rather than detecting them over concatenated text
  [Nie et al. 2021].

- **The industry default is consolidation, and it is the opposite of Elicit's bet.** OpenAI names
  contradiction as the diagnosed failure of its previous design: "The previous saved memories
  system often became stale… Memories could also contradict one another, such as 'I'm training
  for a marathon' and 'I sprained my ankle,' which made personalization less accurate." Their fix
  is automatic overwrite/consolidation into a single memory summary. ChatGPT ships a per-response
  **Sources** affordance and an editable summary, but OpenAI warns the summary "will not include
  everything ChatGPT remembers," and full deletion requires deleting *every source* — there is no
  snippet-level provenance chain [OpenAI Memory FAQ 2026]. Anthropic's memory tool is
  files-in-a-directory with all storage client-side; its recommended system prompt tells the model
  to "keep its content up-to-date, coherent and organized… rename or delete files that are no
  longer relevant" — again mutate-in-place, no versioning or provenance [Anthropic Memory tool
  docs].

- **The strongest empirical result for Elicit's core bet, with an important correction.** Agents
  built from a single **two-hour AI-administered semi-structured interview** (American Voices
  Project schedule, n=1,052 nationally diverse Americans) reproduced held-out General Social
  Survey responses at **83%** of participants' own two-week test-retest consistency, vs **74%**
  for demographics-only agents, **82%** for surveys alone, and **86%** for interviews+surveys. The
  paper was substantially revised (v3, 28 Jun 2026) and retitled; the widely-cited "85%" is
  superseded. The authors note gains from combining sources were modest, "suggesting that
  predictive benefits from data begin to asymptote once the model has observed sufficient evidence
  within a domain," and that interview-grounded agents **reduce accuracy disparities across racial
  and ideological groups**. Read honestly: two hours of a person's own prose buys ~9 points over
  demographics but roughly ties a structured survey — elicitation's advantage is *generality
  across unseen outcomes*, not raw accuracy [Park et al. 2024/2026].

- **AI-led interviewing is being built as infrastructure, and the leading design splits control
  the same way Elicit does.** AInterviewer is an open-source multi-agent platform that deliberately
  combines survey-software-style controlled question administration (fixed wording, fixed order)
  with LLM flexibility *only for follow-ups*, motivated by reproducibility and data-security
  concerns [Gardhus et al. 2026]. *Platform paper; no accuracy evaluation claimed.*

### Sources
- Park, O'Brien, Cai, Morris, Liang & Bernstein — *Generative Agents: Interactive Simulacra of Human Behavior*, UIST 2023. https://arxiv.org/abs/2304.03442
- Packer, Wooders, Lin, Fang, Patil, Stoica & Gonzalez — *MemGPT: Towards LLMs as Operating Systems*, 2023. https://arxiv.org/abs/2310.08560
- Rasmussen, Paliychuk, Beauvais, Ryan & Chalef — *Zep: A Temporal Knowledge Graph Architecture for Agent Memory*, 2025. https://arxiv.org/abs/2501.13956
- Chhikara et al. — *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory*, 2025. https://arxiv.org/abs/2504.19413
- Du et al. — *Rethinking Memory in LLM based Agents: Representations, Operations, and Emerging Topics*, 2025. https://arxiv.org/abs/2505.00675
- Balog & Kenter — *Personal Knowledge Graphs: A Research Agenda*, ICTIR 2019. https://www.tomkenter.nl/pdf/Personal%20Knowledge%20Graphs%20-%20ICTIR%202019.pdf
- Rashkin, Nikolaev, Lamm, Aroyo, Collins, Das, Petrov, Tomar, Turc & Reitter — *Measuring Attribution in Natural Language Generation Models*, Computational Linguistics 49(4), 2023. https://aclanthology.org/2023.cl-4.2/
- Gao, Yen, Yu & Chen — *Enabling Large Language Models to Generate Text with Citations*, EMNLP 2023. https://aclanthology.org/2023.emnlp-main.398/
- Nie, Williamson, Bansal, Kiela & Weston — *I like fish, especially dolphins: Addressing Contradictions in Dialogue Modeling*, ACL 2021. https://aclanthology.org/2021.acl-long.134/
- OpenAI — *Memory FAQ* (official help center, updated 2026). https://help.openai.com/en/articles/8590148-memory-faq
- Anthropic — *Memory tool* (official docs). https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool
- Park, Zou, Kamphorst, Egan, Shaw, Hill, Cai, Morris, Liang, Willer & Bernstein — *LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals* (formerly *Generative Agent Simulations of 1,000 People*), v3, 2026. https://arxiv.org/abs/2411.10109
- Gardhus, Vitsakis, Frederiksen, Rogers & Carlsen — *AInterviewer: A Platform for Designing and Conducting AI-led Qualitative Interviews*, 2026. https://arxiv.org/abs/2606.20588

---

# Synthesis

Nine fields, asked the same four questions the session is asking. They agree more than they
disagree, and where they disagree with Elicit they do so on specific, testable points.

## (a) What makes a Snippet admissible

The session is debating a **Facet + Stance evidentiary test**. The literature says the *shape* is
right and the *fields are incomplete*. Three additions have primary-source force.

**Standalone-interpretability is not a stylistic preference; it is the precondition for
attribution to mean anything.** AIS runs its human annotation in two stages, and the first is
"is the sentence interpretable standalone?", because an un-standalone span cannot be judged
supported-or-not at all [Rashkin et al. 2023]. This retroactively justifies Harvesting's
"cutting at concept boundaries" and the rule that fragments which cannot stand alone get a
question rather than an edit. Make it a hard gate on the admissibility test, ahead of Facet and
Stance: *a fragment that cannot be read without its Transcript is not a Snippet.*

**The question that produced the fragment must be part of the test, because it determines the
fragment's evidentiary weight.** Moran's distinction is the sharpest tool here: a *deliberative*
question ("what is my attitude toward P?") yields an **avowal**, whose authority is constitutive
— the saying largely makes it so. A *theoretical* question ("what was my attitude?", "why did I
do that?") yields a **self-observation**, defeasible like any observation. Nisbett & Wilson land
in the same place from the empirical side: content (attention, sensation, personal historical
fact, emotion, evaluation, plan) is privileged; *process* and causal explanation are not. Elicit
already stores the eliciting question in Provenance. Promote it from metadata to a typed field
that classifies the Snippet.

**Fluency, vividness, specificity, and certainty are forbidden as admissibility signals.** This
is not a soft caution. Johansson et al. showed that reports about a choice the person *did not
make* did not differ from genuine reports in emotionality (~3.5), specificity (~3.1), certainty
(~3.3), length, tense, or laughter — and 84% of undetecting participants were confident they
would have caught the swap. Any Snippet quality heuristic that scores "this sounds like a real
memory" is measuring nothing. The only admissibility signals available are structural: is it
verbatim, is it standalone, what question produced it, when was it captured.

A defensible admissibility test, then:

1. **Verbatim** — an exact substring of the user's prose (product invariant, unchanged).
2. **Standalone-interpretable** — readable without the Transcript [Rashkin et al. 2023].
3. **Facet** — what kind of person-knowledge it is (taxonomy below).
4. **Stance** — the person's relation to the content (taxonomy below). *Stance gates evidentiary
   weight, not admission.*
5. **Question-form** — deliberative/avowal vs theoretical/self-observation vs
   explanation [Moran 2001; Nisbett & Wilson 1977].
6. **Capture time** — timestamped at the exchange, because Stone's 90%-claimed-vs-11%-actual
   result makes moment-of-capture categorically better evidence than later reconstruction.

Note (4)'s qualifier. Stance must not be an admission filter, because Kelly explicitly permits
inconsistency ("some private paradoxes can be allowed to stand indefinitely"), Kay's Personis
framework states "Embrace inconsistency, multiple interpretations!", and de Kleer's whole
argument for the ATMS is that suppressing one side of a contradiction is a problem-solving
error. A Snippet whose Stance is "confabulated causal theory" is still admissible — it is
excellent evidence of the person's *theory of themselves*, which is a first-class fact about
them. It is simply not evidence of the cause.

## (b) A facet and stance taxonomy for Wiki claims

Nothing in the literature offers a ready-made taxonomy of person-knowledge. But four fields
independently carve the same joints, and the intersection is a usable scheme. The Facet axis
answers *what kind of thing is this*; the Stance axis answers *what is the person's relation to
it*; a third derived column records *what evidentiary weight it carries*.

**Facet** — synthesized from Squire's memory systems, Conway's three-level autobiographical
hierarchy, Kelly's construct, McAdams' levels, and CommonKADS' domain/task split:

| Facet | Definition | Source | Elicitation consequence |
|---|---|---|---|
| Episode | Event-specific, dateable, autonoetic | Conway ESK; McAdams key scene | Needs 30s+ retrieval time; five-slot probe |
| General event | Repeated or summarized episode | Conway | What you get at short latency |
| Lifetime period | Bounded era with themes and goals | Conway | LSI Section A (chapters) |
| Fact | Semantic, about self or world | Tulving/Squire | Documentation-first, then laddered grid |
| Construct | Bipolar evaluative axis with poles and range | Kelly | Triadic elicitation, then laddering |
| Procedure | How-to, skill | Squire | **Not self-reportable** — see below |
| Intention | Prospective, event-cued or time-cued | Einstein & McDaniel | Needs cue type recorded |
| Value | Ideology, commitment | McAdams Section E | Includes a change-over-time probe |
| Causal theory | The person's explanation of their own behavior | Nisbett & Wilson | Collect it; flag it |

**Stance** — the person's relation to the content, drawn from Moran, Hinkle, Doyle, and
STyLE-OLM:

- **Avowal** — deliberative first-person answer; constitutive authority [Moran].
- **Self-observation** — theoretical answer about oneself; defeasible [Moran].
- **Report of fact** — about the world, checkable elsewhere.
- **Pole preference** — which side of a construct is preferred [Hinkle; required before
  laddering can start].
- **Commitment** — plan, intention.
- **Uncertainty-marked** — hedged by the person themselves.
- **Superseded** — a prior version, retained, explicitly no longer endorsed.

Two mechanics fall out of this that are worth building.

**A construct Facet needs three fields, not one.** Kelly is emphatic that the psychological unit
is a *triple*: pole, contrast pole, and range of convenience — "a construct is not a class of
objects, or an abstraction of a class, but a dichotomous reference axis," and asserting a pole
both denies the contrast *and* excludes what falls outside the range. A "Stance" recorded as a
single position on a named Facet is, in Kelly's terms, half a construct. If a Wiki claim asserts
the person values directness, the model has not captured the construct until it knows what
directness is being contrasted *with* (bluntness? evasion? tact?) and over what domain it
applies. This is directly elicitable: triadic elicitation exists precisely to force both the
likeness and the contrast into the open.

**Coreness is computable, not askable.** Hinkle showed resistance to change correlates with a
construct's range of implications at rho = +0.59, and that superordinate constructs carry ~18%
more implications in both directions. Elicit already has the graph — Wiki claims cite Snippets,
and claims relate to claims. In-degree in that citation graph is a defensible proxy for
entrenchment, which is exactly what AGM needs and cannot define quantitatively ("different belief
sets may be associated with different orderings of epistemic entrenchment"). Two independent
literatures ask for the same number and Elicit's data model already produces it.

## (c) Matching elicitation technique to knowledge type — the Protocol concept

**The premise Protocols were built on is empirically weak, and the repair is straightforward.**
The strong differential access hypothesis — different knowledge types need different techniques —
was tested directly at Nottingham with 32 geology students and 32 geographers against gold-standard
rule sets, and found **no technique × knowledge-type interaction**: "almost all the same knowledge
was elicited." The field's own current position, from Hoffman & Lintern, is that "the hypothetical
problem of differential access has given way to a practical consideration of **differential
utility**."

This does not kill Protocols. It changes what they optimize. A Protocol is not a key that unlocks
otherwise-inaccessible knowledge; it is a **scaffold that changes the yield rate and the form of
what arrives**. Hoffman's own metric makes this operational: informative propositions per total
task minute, with unstructured interview under 1, structured interview about 1, contrived tasks
2–3, and an explicit switching rule at ~1/TTM. Elicit has the instrumentation to compute the
analogue — Snippets kept per exchange, minus those already implied by existing Wiki claims — and
should, because it turns Protocol selection from a taxonomy question into a measurement question.

With that reframe, the matching is concrete and each row is sourced:

- **Episode** → McAdams' five-slot probe verbatim (what happened / when and where / who was
  involved / what you were thinking and feeling / what does this say about you), and **give the
  person time**. Conway's latency data is the sharpest Protocol parameter available: at a 2s
  deadline, 38% of responses are abstractions rather than specific memories; by 30s virtually all
  are specific. A Protocol that wants episodes must budget reflective time, not just ask an
  episodic question.
- **Construct** → triadic elicitation from three named elements ("some important way in which any
  two of these are alike in contrast to the third"), then Hinkle's ladder verbatim ("why would you
  prefer to be here rather than there? What are the advantages of this side in contrast to the
  disadvantages of that side?"). Stop at ~8–12 rungs — Hinkle found ladders from different
  starting points "almost invariably" converge, which is both a stopping rule and a
  self-consistency check the agent can run.
- **Fact / domain concept** → laddered-grid prompts (examples-of, alternatives-to, how-can-you-tell,
  key-difference-between) and concept sorting, with the hard invariant that **all cards in one sort
  must be the same knowledge type**.
- **Procedure** → Critical Decision Method: select a nonroutine incident, take an unstructured
  account, build a timeline, identify decision points, probe them. But see the contradiction
  section — this Facet has a deeper problem.
- **Value** → LSI Section E, including its explicit "how have these views changed over time" probe,
  which pre-registers diachronic change instead of discovering it later as an apparent
  inconsistency.
- **Causal theory** → collect freely, label as Nisbett-Wilson-flagged, and never let a Wiki claim
  about *causes* rest on it alone.
- **Current state** → signal-contingent momentary probe, short, and phrased as an **average**
  rather than an extremum — Stone's wording comparison found "on average" phrasings correlate
  .85–.90 with momentary aggregates while "maximum" phrasings manage only .67–.75.

One structural borrowing from the LLM literature: Generative Agents' reflection step begins by
**generating the three most salient questions** answerable from recent observations, then uses
those questions as retrieval queries. That is Elicit's Direction mechanism with an implementation
already published and ablated.

## (d) Handling disagreement — Contradictions, User-Attested Claims, negotiation

This is where the literature is richest and Elicit's instincts are best supported.

**Holding contradictions open is the technically correct choice, and de Kleer supplies the
argument the industry default lacks.** The ATMS exists because single-state systems have two
failure modes: you "cannot examine both of these solutions together. However, this is often
exactly what one wants to do in problem solving," and — the sharper one — "**all a contradiction
between A and B indicates is that inferences dependent on both A and B be avoided. But it is
still important to draw inferences from A and B independently.**" Kay's Personis says the same
thing in one line: "Embrace inconsistency, multiple interpretations!" Kelly says it about persons
directly: private paradoxes may stand indefinitely. OpenAI's memory design takes the opposite
side explicitly, naming contradiction as a failure and consolidating it away; Zep/Graphiti takes
Elicit's side and beats MemGPT on the benchmark MemGPT defined.

**But de Kleer also constrains what a Contradiction may do.** If Elicit treats a recorded
Contradiction as poisoning both Snippets — suppressing claims that rest on either one — it commits
exactly the "overzealous contradiction avoidance" error de Kleer built the ATMS to fix. The correct
semantics: a Contradiction between Snippets A and B invalidates only claims whose citation set
contains **both**. Claims resting on A alone, or B alone, remain live. This is a small, precise
mechanic with a canonical source, and it is easy to get wrong by default.

**Contradictions need a type tag, because two different things are being conflated.** Katsuno &
Mendelzon separate *revision* (new information about a static world — I was wrong before) from
*update* (the world itself changed — I was right before and things moved). For a person these are
routinely confused, and Elicit's own Seeding mechanic sits squarely on the fault line: "in 2023 you
wrote X — still true?" is an **update** question, not a revision question. A 2023 Snippet and a
2026 Snippet that disagree are usually not an inconsistency to resolve; they are a biography.
Conway supports this from the memory side — when goals change, "a record of the past concerns of an
older version of the working self exists" in the knowledge base, and that record is data, not
error. Recommend at minimum two Contradiction types: **synchronic** (both claims assert the present;
genuine tension) and **diachronic** (the person changed; the tension *is* the finding). Only the
first should generate a resolution question.

**STyLE-OLM is an off-the-shelf design for the negotiation Elicit needs.** Eight moves (Inform,
Inquire, Challenge, Disagree, Justify, Agree, Suggest, Skip) with legality rules; separate
**commitment stores** for the two parties; conflicts stored as first-class
`conflict(learner_belief, system_belief, graph_id)` predicates rather than as UI state. Most
valuable for Elicit is its three-way agreement typing, which maps onto Wiki claim status directly:
**explicit** (both parties said it), **implicit** (both stores entail it), **assumed** (one party
is silent but not contradictory — recorded with `none` in the missing slot). Elicit's "a claim
resting only on seeded material stays unconfirmed" is the *assumed* case, and STyLE-OLM shows how
to represent it without pretending it is either agreement or conflict.

**When negotiation fails, keep both.** Mr. Collins: "if discussion cannot resolve disagreement
about the model data, both belief sets are retained in the learner model separately." xOLM goes
further and lets the learner "move on (without resolution)", with the learner's challenge
succeeding on unresolved disagreement. Elicit's User-Attested Claim is the xOLM position. The
literature supports it empirically: when Bull et al. (2008) deliberately seeded errors, learners
corrected them and **the model became more accurate**; open models also improved self-assessment
in weaker students. Edit rights are not a concession to user feelings — they are an accuracy
mechanism, and the reflexive benefit (the user learns about themselves from the model) is a
documented finding, not a hoped-for side effect.

**One hazard in the User-Attested Claim design, from Doyle.** In a TMS, a node whose justification
has an empty in-list and empty out-list is a **premise** — always valid, never retractable by
inference. A User-Attested Claim that cites no Snippets is exactly that: unfalsifiable by anything
the system can observe. Over time the Wiki accumulates premises the agent may never challenge and
no evidence may ever contradict. Elicit's **Propagation** mechanic already contains the fix — the
user's edit, being their own prose, "may also be kept as a Snippet." Make that mandatory rather
than optional: **every user edit to a Wiki claim becomes a Snippet, so the claim acquires a
justification and re-enters the evidential system.** This preserves the invariant that the agent
never rewrites the claim while preventing the Wiki from silting up with unassailable premises.

**Store Contradictions as pairs over identified Snippets.** DECODE's out-of-distribution result is
that models "explicitly hinging on utterance structure" — pairing candidate utterances — generalize
better than unstructured Transformers over flattened dialogue. Elicit's data model already does
this; the finding says it will also detect better.

---

# Where the literature contradicts the design

Ordered by how much it should change what gets built.

**1. The Wiki cannot model skills from self-report. This is the hardest contradiction.**
`CONTEXT.md` defines the Wiki as a model of "beliefs, contradictions, knowledge, and skills."
Squire's taxonomy says nondeclarative memory "is dispositional and is **expressed through
performance rather than recollection**," and that its contents "are inaccessible to conscious
recollection." A corpus built entirely from a person's prose can hold their *beliefs about* their
skills, which is a different object and often a wrong one. Two honest resolutions: rename the
facet to something like "self-model of capability," or — better, and already latent in the design
— treat the **Emergent Outputs** (a learned skill, a built capability) as the *performance
evidence* that skill claims must cite. That turns a definitional problem into a feature: skill
claims are the one Facet whose justification is not a Snippet.

**2. Mode-fitting is unvalidated for answer quality, and Conway's latency data suggests it may
actively bias the corpus.** Elicit asks only questions whose Protocol fits the current Mode. The
prior art (JITAI "receptivity") states its own status plainly: "**the underlying assumption is
that** providing support when the person is not receptive will not be beneficial." The best direct
test found — 19 smart homes, 1,073 prompts — moved response rate 78.62% → 84.26%, and *decreased*
it in 4 of 19 homes. No primary evidence was found that state-matched timing improves the *quality*
of the answer. Worse, two meta-analyses (k=477, N=677,536; and 105 datasets, pooled compliance
81.9%) both found that **assessment burden does not predict compliance** — only financial
incentives did. And Conway's deadline study says the low-time, low-energy Mode systematically
yields *abstractions*: 38% of 2-second responses are general events or lifetime periods rather
than episodes. So Mode-fitting plausibly buys a few points of response rate while skewing the
Snippet corpus toward semantic self-description and starving it of the episodes that Pieces need.
This is the single cheapest thing to prototype and measure: track Facet distribution by Mode.

**3. Comfort is not yield, and Mode optimizes comfort.** Two findings collide with Mode's premise.
Schweikert et al. (1987): an expert's own opinion of a technique's worth is **no guide to its
actual value**. Burton et al. (1990): contrived tasks, which experts dislike, are often *more*
efficient than natural ones — and think-aloud, the most comfortable technique, was the *least*
efficient across every Nottingham study, "most costly to analyze, yielding less and less complete
information than any other," yet stays popular because experts like it. Elicit's Mode is a
self-declared comfort signal driving technique selection. That is precisely the loop the KA
literature warns produces pleasant, low-yield sessions. Keep Mode as a *constraint* on what is
askable; do not let it become the *objective*.

**4. Restatement is not evidence-neutral, and the design does not currently say so.**
`CONTEXT.md` frames Restatement as "the product's hidden pedagogy," the always-available
alternative to approving a harvest. Marsh (2007) establishes that retellings depend on the
speaker's goals, audience, and social context rather than accuracy, and **change later memory**
through selective rehearsal. Conway frames the same thing as the correspondence-coherence
trade-off: repeated narration pushes memory toward a coherent self-story and away from accurate
record. Elicit's immutable versioning already captures the *trace* of this correctly. What is
missing is the reading: a Snippet with a long Restatement chain is not a well-polished Snippet,
it is a **drift signal**, and the Wiki should treat successive versions as evidence about the
person's changing self-narrative rather than as successive approximations to a fixed truth.
Marginalia is the natural home for this.

**5. "Self-report is evidence of the saying, not of the fact" is over-strong as a blanket rule.**
If the session is considering that formulation, Nisbett & Wilson themselves block it. Their
"Confusion Between Content and Process" section grants the person direct access to "a host of
personal historical facts… the focus of his attention at any given point in time… his current
sensations," and knowledge "quantitatively superior to that of observers concerning his emotions,
evaluations, and plans." Moran adds that an avowal is not a fallible report about an antecedent
state at all — its authority is constitutive. The blanket rule is right for *why*-questions and
retrospective process summaries; it is wrong for content, and applying it uniformly would
needlessly demote most of what Elicit collects.

**6. Verbatim-quote grounding is a by-construction choice, not an evidence-backed one — say so.**
No primary evidence was found that requiring verbatim quotes reduces fabrication relative to
paraphrase-with-citation. ALCE measures whether generated citations are *supported* (and finds
even the best models lack complete support ~50% of the time on ELI5), not whether quote-first
construction lowers hallucination rate. Sole Authorship is defensible on other grounds —
attribution becomes trivially checkable, AIS's standalone-interpretability gate is satisfied by
construction, and the Stanford interview result shows a person's own prose carries real predictive
signal. But it should be argued as *architecture that makes a class of error impossible*, not as
*a technique shown to reduce error*. The distinction will matter the first time someone asks for
the citation.

**7. A calibration on the headline result Elicit's bet rests on.** The Stanford
thousand-interviews paper was revised (v3, June 2026) and its widely-cited "85%" superseded: a
two-hour interview-grounded agent reaches **83%** of a person's own test-retest consistency,
demographics-only reaches **74%**, and a *structured survey alone* reaches **82%**. Two hours of
elicited prose roughly ties a well-designed questionnaire on predicting survey answers. The real
advantage the authors identify is generality to unseen outcomes and reduced accuracy disparity
across racial and ideological groups — which is a good argument for Elicit, but a different one
than "interviews beat surveys."

---

## Two things the literature offers that the design does not yet use

**Hinkle's convergence check as a free consistency test.** Ladders started from different
subordinate constructs "almost invariably" converged on the same superordinate chain. Elicit can
run this deliberately: ladder up from two unrelated Snippets and see whether they arrive at the
same core claim. Convergence corroborates the Wiki's structure; divergence is a Contradiction the
agent found by construction rather than by noticing.

**The Foley Center's neutral-point convention, for any stance scale Elicit builds.** In the
agency/communion coding system, the scale midpoint (2 of 0–4) is reserved for **"no code-able
language" *or* equal amounts of both** — absence and balance deliberately share a value, with the
distinction pushed elsewhere. Any Stance scale Elicit designs will hit this exact problem: a
Snippet with no stance and a Snippet with a balanced stance are different, and a single scale
cannot hold both. Better to learn it from a coding manual than from a bug report.
