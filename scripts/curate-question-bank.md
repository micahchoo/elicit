# Curate the Are.na question bank

Input: `data/question-bank.jsonl` — one JSON object per line:
`{question, channel, channelTitle, blockId}`, scraped from Are.na channels.

Output: `data/question-bank.curated.jsonl` — same shape plus a `register`
field. Also write `data/question-bank.rejects.jsonl` with dropped entries
plus a short `reason` field, so the cut is auditable.

## The app's frame

Elicit is an agent that interviews ONE person, in text, to build a model of
their beliefs, contradictions, knowledge, and skills. The territory is NOT
only self-reflection: what the person thinks about the world — their
theories, opinions, tastes, domain expertise, craft — is equally in frame,
because an answer evidences the person's belief system even when the
question is about the world. Keep a question if the agent could pose it
verbatim in that interview and the answer would be evidence ABOUT THE
PERSON — their memories, values, theories, or knowledge.

## Keep / drop

DROP a question when it:
- addresses a couple or group, or asks about the ASKER ("what do you like
  about me?", "where should we go?")
- needs a live partner, a game context, or a prior conversation turn to make
  sense ("what do you mean by that?", "same question back to you?")
- is quiz/trivia with one correct answer, where answering evidences nothing
  about the person ("what is the capital of Peru?") — but opinion, theory,
  and expertise questions are KEEPS, not trivia
- is a business / UX-research / workshop prompt about a product or project
- is rhetorical or poetic fragment with no discrete askable content
  ("and so what?")
- is about a specific third party, artwork, or text the user has not seen
- is not actually a question despite the trailing "?"

KEEP borderline poetic or strange questions IF a person could still answer
them about themselves — strangeness is fine (the app has a Randomizer that
values off-axis questions); only unanswerable-as-self-report is fatal.

KEEP research-spurring questions: open questions about the world that
nobody has a settled answer to ("why do some communities keep their
commons?"). Posed to the user they elicit the person's current theory AND
can seed a Direction — a line of inquiry the person might pursue. Drop them
only when they need apparatus the interview lacks (a dataset, a lab).

## Discreteness

Every output line must hold exactly ONE question. If an entry contains
several ("who have you copied? who copies you?"), split it into one line per
question, all inheriting the same provenance fields. Strip leading numbering
or bullets. Otherwise keep wording verbatim — do not rephrase, fix grammar,
or normalize case.

## Register

Label each kept question with one `register` value — what kind of
person-knowledge an answer would evidence (Elicit's Facet taxonomy, an open
set; `belief` and `knowledge` extend it):

- `episode` — a specific, dateable moment ("tell me about a time...")
- `general-event` — recurring patterns, habits ("what do you do when...")
- `lifetime-period` — an era of life ("what was your childhood like?")
- `fact` — biographical fact ("where did you grow up?")
- `construct` — a personal distinction, poles, contrasts ("how are you
  different from your friends?")
- `intention` — plans, commitments, wants ("what do you want to build?")
- `value` — what matters, priorities, admiration ("what do you get
  complimented on the most?" → self-image; use judgment)
- `causal-theory` — the person's WHY about themselves ("why does the
  commitment scare you?")
- `state` — momentary state, right-now check-ins ("what are you feeling
  right now?")
- `belief` — a theory, opinion, or taste about the world or other people
  ("what do you believe about how people change?", "what makes a city good
  to live in?")
- `knowledge` — domain expertise or craft the person can articulate ("how
  do you decide when a draft is done?", "what do beginners in your field
  get wrong?")
- `research-spur` — an open question that invites investigation beyond the
  interview; answering yields the person's current theory plus a candidate
  Direction ("what would cities look like if children designed them?").
  These fuel Expeditions: assignments that send the person out to read and
  come back with reflection.
- `transformative` — a perspective-shift, inversion, or oblique prompt
  whose value is dislodging the current frame rather than evidencing one
  facet ("what would your 2019 self ask you?", "what are you pretending
  not to know?"). These fuel the Randomizer. A question that merely LOOKS
  weird but really elicits a value or episode gets that register instead.

Use exactly one label. If two fit, prefer the one naming what the ANSWER
would mostly evidence. Use `other` only when nothing fits and the question
is still clearly worth keeping.

## Method

NEVER retype question text — retyping silently normalizes unicode
(curly apostrophes become straight, etc.). Instead: make decisions, apply
them with a script. For each input line, decide
`{line, verdict: keep|drop, register?, reason?, splits?: string[]}` where
each split string must be an EXACT substring of the original question.
A small script applies the decisions, carrying text byte-for-byte from the
input file (for splits: slice the exact substrings).

Work in chunks of ~150 input lines so judgments stay careful. Append
results per chunk. Do not load the whole file into one prompt. At the end,
verify MECHANICALLY (script, not eyeball):

- every output line is valid JSON with the required fields
- every curated question is an exact substring of its source entry's
  question (byte-level check — this is the verbatim gate)
- kept + rejected question count ≥ input line count (splits can exceed it)
- no duplicate questions in the curated file (case/punctuation-insensitive)

Report: input count, kept, rejected, splits performed, register histogram.
