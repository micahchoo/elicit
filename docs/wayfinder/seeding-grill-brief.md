# Seeding — grill brief

Agenda for ticket [013](tickets/013-grill-seeding.md), which gates the build in
[014](tickets/014-build-seeding.md). Nothing here is a ruling.

## What Seeding is, per canon

Seeding is the harvest of a corpus that already exists — journals, vault notes,
old drafts — taken a region at a time, when a Direction reaches toward it or the
person drops material in, and never in bulk (CONTEXT.md, *Seeding*). It runs
through the ordinary harvest path, so every rule that binds a live sitting binds
it: exact substrings, admissibility, Buds for the failures. What it adds is
time — a seeded Snippet carries dated past-self Provenance, and under Q-50 that
date is the only thing that makes nine years of one person's writing into more
than one piece of evidence.

## Where the ground has already moved

By the time this grill runs, ticket 058 will have built `src/import/`: scan →
staging record → extraction in the docket → per-item review → one dated sitting.
Ticket 057 already put 139 snippets across 19 dated sittings in the vault, 062
read all but three of them, and 073 stamped every snippet with a mechanical
context window. Seeding is therefore no longer "build the importer". It is: what
changes when the corpus is a personal vault of thousands of undated notes rather
than 19 dated published posts.

## The seven jobs

| Job | Already ruled | Genuinely open |
|---|---|---|
| **Survey** — coarse map, no deep reading | The scan is model-free and the folder is the manifest (Q-57) | What a region is, what the map renders, and whether completeness is the backlog's boolean |
| **Reach** — region selection | Nothing | Whether the agent may pull a region a Direction touches, or only offer it |
| **Cut** — batch harvest with approval | The whole surface: three verbs, piece rendered whole, cuts marked in place, no batch accept (Q-58); quotes and co-authored items excluded (Q-51) | Whether no-batch-accept survives a corpus 40× larger than the one it was ruled on |
| **Anchor** — written-when and about-when | Frontmatter or refuse; never mtime, never inferred, never asked per item (Q-57); a changed file is a new dated item (Q-59) | Undated corpora — a daily-notes vault refuses whole under today's rule |
| **Repair** — dangling referents to batched Buds | The mechanical context window ships (073); 96 of 139 snippets dangle, 71 resolve from the window alone (074's labelled set) | The residual 25: how a Bud is minted for them and how the rate is bounded |
| **Link** — retellings linked, never deduplicated | Ranked cross-sitting retrieval exists (053, 007, Q-65); identity is the content hash and re-import skips (Q-59) | What a Link *is* in the store, and whether it is anything the contradiction pool does not already produce |
| **Confirm** — weak priors until live elicitation | Status is a four-value enum with no numbers, and transitions are mechanical (Q-21, Q-29) | "Weak prior" has no representation, and Q-50 promotes imported cites to `evidenced` without any live touch |

## The questions, sharpest first

**1. Does "weak prior" exist at all?** Two posts nine years apart are two
sittings, so Q-50 promotes a claim citing both to `evidenced` mechanically —
before you have said a word about it. Canon says seeded readings hold weak
priors until touched by live elicitation. Both cannot be true. *I would default
to deleting the weak prior and keeping Q-50*, because the property Q-50 protects
is "survived being approached again on a different day", and a thing you wrote
in 2018 and wrote again in 2025 satisfies that better than most live pairs do.
Confirm then becomes a licence rather than a status: a seeded claim is what
licenses a Still-true revisit (the Question Source canon already names it),
asked differently under Q-14. The rival — a fifth status, or a discount on
seeded cites — reintroduces confidence numbers under a new name, which Q-21
forbids.

**2. Where does a date come from when there is no frontmatter?** An Obsidian
vault has thousands of notes and almost no `date:` keys, so Q-57 as written
refuses the entire corpus. *I would default to a declared mechanical rule per
region* — a frontmatter key or a filename pattern (`2021-03-04.md`), stated once
when you point at the region, with every non-matching file refused by name.
Reasoning: what Q-57 bans is the guess, and specifically mtime, which is a lie
for anything ever copied. A date you typed into the filename is a declaration you
made at the time, not an inference. The rival is canon's per-item dating
question, which at vault scale is a thousand questions and, worse, asks you in
2026 what you meant in 2019.

**3. Does no-batch-accept survive scale?** Q-58 ruled it over 19 items, where
reading everything is a good evening. A vault is not. *I would default to keeping
the gate untouched and bounding the input instead*: Reach hands you one region,
extraction runs under a live cap (Q-56), and the queue you face is never longer
than the region you chose. The failure the gate exists to catch — misleading
excision — is invisible without reading, so a faster accept is not a smaller gate
but no gate. That makes the real question the one under it: what bounds a region?
*Default: a folder subtree*, because it is your own organisation, needs no model,
and makes the backlog's harvested/unharvested boolean computable.

**4. May the agent reach on its own?** Canon says a region is harvested "when a
Direction reaches toward it". *I would default to offer-only*: a dimmed line on
the waiting surface naming an unharvested region a live Direction touches, in
Q-37's shape. Under Q-62 that ships live from day one, because declining costs a
word and nothing happens on silence. Extraction pulled on the agent's own
judgment is an act, which means shadow-first under Q-35, which means inert — the
failure this project has now hit six times.

**5. How does seeded material declare its authorship?** A vault holds pasted LLM
output, clipped quotes, and half-transcribed conversations; ticket 046 landed an
`authorship` declaration on unprompted entry and left the value set open with a
note to check Seeding's needs first. *I would default to reusing that one field,
declared per region at Reach time, with a third value for machine-assisted*.
Per-item is the review-attention cost Q-60 already refused to pay, and detection
is banned by 046 permanently. The consequence 046 deferred has to land here,
because a vault is where `other` arrives at scale: a snippet you kept but did not
write cannot carry `stance: avowal`, and its reading describes the keeping.

**6. What is a Link?** *I would default to no new object.* A retelling is a
cross-sitting pair the ranked channel already surfaces (Q-65 puts those first),
judged and recorded as diachronic — the type that seeks no resolution, because
the tension is the finding. A second linking store would need its own lint,
surface, and staleness rules to say what the Contradiction plane says already.
What Seeding must add is the negative half: idempotent ingest dedupes on exact
text *within one source path* (Q-59's rule), never across paths, because the same
sentence in two files is precisely the retelling.

**7. How are repairs batched?** 25 of 139 snippets dangle unresolvably. *I would
default to one Bud per unresolvable dangler at commit time, drawn through the
ordinary Queue under a live cap*, and no repair surface of its own. A screen
showing 400 outstanding repairs is debt rendered as a list, which Q-24 forbids;
the Queue's filters are already the rate limiter, and Q-6 already says a Bud
waits without accusing anyone.

## Not on this agenda

Bulk import owns these and re-grilling them costs a decision that is already
paid for: the door and the refusal of sockets (Q-57), frontmatter dates as the
rule (Q-57), item identity by content hash and what a changed file becomes
(Q-59), the review surface entire (Q-58), the absence of Target (Q-60),
separability and cut-level exclusion (Q-51), `channel: 'pasted'` (048), staging
under `vault/imports/` as not-corpus, extraction ahead of review in the docket
(047), and the promotion rule for imported cites (Q-50, subject only to
question 1).
