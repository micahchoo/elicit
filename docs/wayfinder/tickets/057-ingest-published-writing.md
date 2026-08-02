---
title: "Build: ingest nine years of published writing as dated sittings"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

## Question

Micah's published writing — `/mnt/Ghar/2TA/DevStuff/staging-nw/content/posts`,
47 markdown files, 45k words, dated 2017 to 2026 — enters the vault. He
delegated the keep/discard calls; the material runs through the real harvest
path, not a direct write.

### Why the dates are the whole design

Q-50 makes cite independence CROSS-SITTING. Ingested as one blob, nine years
of writing is permanently one sitting — one piece of evidence, no matter how
much of it there is, and no claim drawn from it can ever reach `evidenced`.

So: **one post, one sitting, `started` set to the post's publication date.**
Then a belief stated in 2018 and again in 2025 is two independent cites, and
the diachronic contradiction machinery has, for the first time, something real
to look at. This is the highest-value property of the corpus and it is
destroyed silently by the naive ingest.

`Vault.startTranscript` already takes `started` as a parameter, so backdating
needs no new code. Session ids are opaque strings to everything that consumes
`Provenance.session` — `ulid()` is used where the vault MINTS an id, never
assumed when reading one — so a slug-derived, stable session id is safe and
makes the ingest idempotent and re-runnable.

### The path

Per post, in publication order:

1. Strip YAML frontmatter. It is metadata, never prose.
2. Split the body into turns small enough for one `complete()` call. The
   context window is 16384; the capstone alone is 16.7k WORDS, so it is many
   turns. Split on section boundaries, never mid-sentence — `propose()` makes
   one model call per user turn and verifies each cut as an exact substring of
   ITS OWN turn, so a split that breaks a sentence destroys the cut that
   spanned it.
3. `propose()` over the turns. The 044 admissibility gate and the exact-
   substring check both apply unchanged — this material gets no exemption.
4. Keep/discard per cut (delegated to claude), written to a review file
   BEFORE anything is applied.
5. `decide()` with those decisions. Snippets carry
   `kind: 'unprompted'`, `channel: 'pasted'` (048), and the post's session.

### Constraints

- **`channel: 'pasted'` on every snippet.** Conditional spread only — a
  PRESENT `channel: undefined` key throws in `matter.stringify` and loses the
  whole write (verified 2026-08-02).
- **Q-51: no co-authored material.** The talks are out — Micah's ruling. Any
  piece billed as joint work is excluded WHOLE, not sampled.
- **Cited and quoted passages are excluded at cut level.** The capstone
  carries 25 academic citations; a cut landing on a paraphrase of someone's
  theory files their idea as Micah's belief. That is the Dickens failure from
  the persona eval.
- **Work counts.** Micah's instruction: "some work is also important." A case
  study revealing how he practices is material; a description of deliverables
  is not. Judge by what the prose says about the person, never by
  `content_type`.
- **Dry run first, and it is not optional.** The vault has no backup (ticket
  017, declined knowingly). Every proposed cut and its keep/discard verdict
  goes to a review file Micah can read before a single snippet is written.
- Local model only (ADR-0001). Expect hours: the measured rate is ~40s per
  `complete()` call, and this is many hundreds of calls. The script must be
  resumable and must log what it has already done.

### Acceptance

- Snippet count per sitting matches the review file exactly.
- Every snippet is an exact substring of its post's body. Assert it in code
  over the finished vault, against the source files — not against the
  transcript the ingest itself wrote.
- Session `started` dates span 2017-2026 and match frontmatter.
- Re-running the script ingests nothing twice.

## Resolution (2026-08-02)

**Applied.** 139 snippets across 19 dated sittings, 2017-01-01 to 2026-07-14,
in the vault at `def2b9f` (authored `elicit-import`, so the import is
distinguishable from a hand edit and from the Clerk — Q-61).

Reviewed twice. The real harvest path proposed **295** cuts over 3606s of clerk
model time; triage kept **139** and dropped 149 as world-fact, activity log,
document scaffolding, fragments or product spec. The criterion: *would this
sentence be evidence about the person if you did not know who wrote it?*

**Seven were another person's words** and were caught only on the second pass —
four sentences of Annemarie Mol, one of Sara Ahmed, one of Shreyas, one quoted
message. `dropCitedParagraphs` missed them because its regex required the year
to sit immediately before the closing paren, so `[(Mol 2008, p. 83)]` escaped;
three of the seven sit INSIDE otherwise-authored paragraphs and paragraph-level
filtering cannot reach them at all. Fixed by implementing Q-51 at cut level
(`isQuotedFromSource`, `1b19824`) — exact on the dry run, 7 of 295, no false
positives.

Every snippet verified as an exact substring of its **source file**, never
against the review the importer wrote. `kind: 'unprompted'`, `channel:
'pasted'` (048), no Target (Q-60), `started` set to when the prose was written
rather than when it was imported. Re-running imports nothing.

### What did not land

**No Readings.** The dry run recorded cut TEXT only, so facet, stance and the
reading sentence were not recoverable without the model, and inventing a facet
would be an agent authoring a reading and stamping it under Q-34. The 139
snippets are evidence — they feed resonance and composed openers immediately —
but the Clerk mints Claims from Readings (Q-28), so no Claims appear until a
reading pass runs. That pass is the natural next work and has not started.

**Concentration:** 76 of 139 are the capstone, sharing one session, so under
Q-50 nothing drawn from them reaches `evidenced` alone. The eighteen small
posts are the corpus's only cross-sitting evidence.

## Resolution (2026-08-02)

**Applied.** 139 snippets across 19 dated sittings, 2017-01-01 to 2026-07-14,
in the vault at `def2b9f` (authored `elicit-import`, so the import is
distinguishable from a hand edit and from the Clerk — Q-61).

Reviewed twice. The real harvest path proposed **295** cuts over 3606s of clerk
model time; triage kept **139** and dropped 149 as world-fact, activity log,
document scaffolding, fragments or product spec. The criterion: *would this
sentence be evidence about the person if you did not know who wrote it?*

**Seven were another person's words** and were caught only on the second pass —
four sentences of Annemarie Mol, one of Sara Ahmed, one of Shreyas, one quoted
message. `dropCitedParagraphs` missed them because its regex required the year
to sit immediately before the closing paren, so `[(Mol 2008, p. 83)]` escaped;
three of the seven sit INSIDE otherwise-authored paragraphs and paragraph-level
filtering cannot reach them at all. Fixed by implementing Q-51 at cut level
(`isQuotedFromSource`, `1b19824`) — exact on the dry run, 7 of 295, no false
positives.

Every snippet verified as an exact substring of its **source file**, never
against the review the importer wrote. `kind: 'unprompted'`, `channel:
'pasted'` (048), no Target (Q-60), `started` set to when the prose was written
rather than when it was imported. Re-running imports nothing.

### What did not land

**No Readings.** The dry run recorded cut TEXT only, so facet, stance and the
reading sentence were not recoverable without the model, and inventing a facet
would be an agent authoring a reading and stamping it under Q-34. The 139
snippets are evidence — they feed resonance and composed openers immediately —
but the Clerk mints Claims from Readings (Q-28), so no Claims appear until a
reading pass runs. That pass is the natural next work and has not started.

**Concentration:** 76 of 139 are the capstone, sharing one session, so under
Q-50 nothing drawn from them reaches `evidenced` alone. The eighteen small
posts are the corpus's only cross-sitting evidence.

## Resolution (2026-08-02)

**Applied.** 139 snippets across 19 dated sittings, 2017-01-01 to 2026-07-14,
in the vault at `def2b9f` (authored `elicit-import`, so the import is
distinguishable from a hand edit and from the Clerk — Q-61).

Reviewed twice. The real harvest path proposed **295** cuts over 3606s of clerk
model time; triage kept **139** and dropped 149 as world-fact, activity log,
document scaffolding, fragments or product spec. The criterion: *would this
sentence be evidence about the person if you did not know who wrote it?*

**Seven were another person's words** and were caught only on the second pass —
four sentences of Annemarie Mol, one of Sara Ahmed, one of Shreyas, one quoted
message. `dropCitedParagraphs` missed them because its regex required the year
to sit immediately before the closing paren, so `[(Mol 2008, p. 83)]` escaped;
three of the seven sit INSIDE otherwise-authored paragraphs and paragraph-level
filtering cannot reach them at all. Fixed by implementing Q-51 at cut level
(`isQuotedFromSource`, `1b19824`) — exact on the dry run, 7 of 295, no false
positives.

Every snippet verified as an exact substring of its **source file**, never
against the review the importer wrote. `kind: 'unprompted'`, `channel:
'pasted'` (048), no Target (Q-60), `started` set to when the prose was written
rather than when it was imported. Re-running imports nothing.

### What did not land

**No Readings.** The dry run recorded cut TEXT only, so facet, stance and the
reading sentence were not recoverable without the model, and inventing a facet
would be an agent authoring a reading and stamping it under Q-34. The 139
snippets are evidence — they feed resonance and composed openers immediately —
but the Clerk mints Claims from Readings (Q-28), so no Claims appear until a
reading pass runs. That pass is the natural next work and has not started.

**Concentration:** 76 of 139 are the capstone, sharing one session, so under
Q-50 nothing drawn from them reaches `evidenced` alone. The eighteen small
posts are the corpus's only cross-sitting evidence.
