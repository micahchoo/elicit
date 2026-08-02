---
title: "Honesty: Sole Authorship prevents misattribution of WORDING, not AUTHORSHIP"
labels: [wayfinder:task]
status: open
assignee: claude (in flight)
blocked_by: []
---

## Question

The sharpest finding of `docs/eval-2026-08-02-personas.md` (Persona 5):
pasted third-party text — the opening line of *A Tale of Two Cities*, and a
mashup of famous clichés — was proposed as legitimate Snippet material with
agent readings ("The user articulates a long-held personal philosophy").

The code-level guarantee is real and correctly enforced: a Snippet's text is
a verbatim substring of what was submitted. But that is misattribution of
WORDING. The README pitches "misattribution impossible by construction",
which reads as a claim about AUTHORSHIP — that these are the user's own
words in the sense that matters. Nothing in the pipeline can distinguish
the user's own reflection from text the user typed that originated
elsewhere.

Two honest responses, both wanted:

1. **Say what is true.** Fix the README and CONTEXT.md's Sole Authorship
   wording: the guarantee is that the agent never writes the user's prose
   and never alters it — not that the user wrote everything they submit.
   (This is the same class as ticket 036's resonance honesty pass.)
2. **Make the distinction expressible.** Pasted/imported material should be
   able to carry a different provenance from spoken/typed reflection — the
   Seeding design already treats imported corpus as its own kind with dated
   past-self provenance. At minimum, `/api/unprompted` should ask (once,
   quietly) whether what was pasted is the user's own writing, and record
   the answer. Do NOT attempt automated detection of third-party text.

## Resolution (2026-08-01) — half done, ticket stays open

Item 1 (the honesty pass) is done. Item 2 needs `src/server.ts`, owned by
another agent during this pass; it is specified below rather than built.

### 1. Docs now state the guarantee and the limit (done)

**README, opening.** Was: "Every word in the corpus is yours. The agent
contributes questions, placement, and margin notes — never prose. That is not a
style choice; it is the architecture." Now: "Every word in the corpus is one you
submitted, unaltered. The agent contributes questions, placement, and margin
notes — never prose, and never an edit to yours. That is not a style choice; it
is the architecture. The guarantee is about wording, not origin: nothing in your
vault was written or reworded by a model. It is not a guarantee that you are the
author — paste in someone else's sentence and Elicit files it as yours, because
nothing in the pipeline can tell pasted text from your own reflection."

**README, failure-mode table.** "every snippet is a verbatim, code-verified
substring of what you typed" → "every *proposed* snippet is a code-verified
verbatim substring of what you submitted — the model cannot add or change a
word." The claim is now about the model's inability to introduce words, which is
what the check actually enforces.

**README, Status.** Added: provenance records how the words were captured — which
question, which session, or that nothing asked for them — not where they came
from; the "just write" door does not yet ask whether pasted material is the
user's own writing.

**CONTEXT.md, Sole Authorship.** "An architectural guarantee that makes
misattribution impossible by construction" was the sentence the eval quoted. The
invariant now names two halves and grants only one: the agent's non-authorship is
architectural (agent prose cannot enter a Piece, no agent may reword a Snippet),
which makes misattribution *of wording* impossible by construction; the user's
authorship is assumed, not verified — a Snippet is the user's own words in the
sense that the user submitted them, never in the sense that the user composed
them. It closes by naming where the distinction belongs: a Provenance the user
declares, and detection is not a move the agent has.

### 2. Declared authorship on the unprompted route (deferred, specified)

The one new fact in the system is a user-declared answer, asked once per
unprompted entry, recorded in Provenance. Nothing infers it.

(Symbol names, not line numbers — `src/server.ts` and `src/harvester/harvester.ts`
were being edited by other agents while this was written.)

**Type.** `Provenance` in `src/types.ts` gains `authorship?: 'own' | 'other'`.
Absent means *never asked* — every snippet written before this lands, and every
snippet from a question-answering route, has no value. Absent must never be read
as `'own'`; any consumer that treats missing as own has reintroduced the bug this
ticket is about. Do not backfill existing snippets.

**Ask.** The blank page (`renderUnprompted` in `web/main.ts`) carries the
question inline above `done`, in the interface's register — one line of text, two
choices, no preselection: *is this your own writing?* → **mine** / **someone
else's**. `done` stays disabled until one is chosen. No modal, no explanation
paragraph, no second ask on the same entry.

**Route.** The `POST /api/unprompted` handler in `src/server.ts` takes
`{text, authorship}` and 400s on a missing or unrecognized `authorship`, exactly
as it already 400s on missing text. No server-side default — a default is a
silent assertion about the user.

**Carry.** `unpromptedSessions` in `src/server.ts` is a `Set<string>`; make it
`Map<string, 'own' | 'other'>`. `decide()` in `src/harvester/harvester.ts`
already takes an `origin` parameter that stamps `kind: 'unprompted'`; pass the
declaration the same way so every snippet kept from that session carries it.
Restatements are the exception: the restate verb *is* the user composing, so a
restatement carries `authorship: 'own'` whatever the session was declared as.

**Log.** `unprompted-entry` already emits `chars=`; add the declaration to the
detail and to its formatter in `src/log/format.ts`. Content is never logged —
the declaration is one word, not content.

**Never.** No automated detection of third-party text. No classifier, no
perplexity heuristic, no search against a corpus of famous lines — not as a
fallback, not as a warning, not later. A user who answers "mine" about Dickens
has a wrong corpus, and that is the user's business, not the agent's to police.

**Accepted limits, so the next person does not re-derive them.** Answers typed
into the exchange screen are not asked about — a per-turn provenance question
would corrode the interview, and the paste door is the unprompted route. A
declaration covers a whole entry, so a paste mixed with reflection in one blank
page gets one label; splitting that is Seeding's problem, not this ticket's.

**Downstream, recommended but not decided here.** Persona 5's actual damage was
the *reading*: pasted clichés came back as "the user articulates a long-held
personal philosophy." A snippet declared `'other'` evidences the user's choice to
keep those words, not the user's avowal of them — the cheapest honest rule is
that `stance: avowal` is unavailable to it and its reading describes the keeping.
Decide that with the Wiki work, not here. The same field is the natural carrier
for Seeding's dated past-self provenance (CONTEXT, *Seeding*) — one field, two
users; check Seeding's needs before naming the values final.

**Test.** Unprompted POST without `authorship` → 400. Snippets kept from an
`'other'` session carry it in frontmatter; a restatement in that session carries
`'own'`. A pre-existing snippet round-trips with the field still absent.

### Adjacent, unticketed

Persona 5's Test B is a second Sole-Authorship gap and no ticket covers it: the
`restate` case in `decide()` (`src/harvester/harvester.ts`, line 418 as of this
pass) checks only `if (!decision.text) continue`, so invented text that appears
nowhere in the session is written to the vault with
`provenance.kind: 'restatement'`. Verified still present today. Compare `trim`,
which requires
`proposal.text.includes(decision.text)`. It is a provenance-truth bug, not an
agent-authorship bug — the words are the user's either way — but "restatement"
should mean the snippet restates something. Needs its own ticket.
